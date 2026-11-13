import * as THREE from 'three';
import { hashColor, makeGlowSprite } from '../world/utils.js';
import { buildHuman } from '../world/human.js';
import { buildAvatar, avatarsEnabled, avatarFor } from '../world/avatars.js';
import { buildMirageModel, buildPlaneModel } from '../world/aviation.js';
import { buildVelovModel } from '../world/velov.js';
import { createMusicSource, gainForDistance } from '../music.js';
import { buildWeaponModel, WEAPON_IDS } from './weapon.js';
import * as net from '../net.js';
import { state } from '../state.js';
import { audio } from '../audio.js';

const INTERP_DELAY = 0.12; // secondes de retard de rendu pour interpoler

const PANTS = [0x39404e, 0x4e4439, 0x2e3a4e, 0x44394e];


export function createRemotePlayers(scene, shootables, { onHitRemote, getListenerPos, gore = null } = {}) {
  const remotes = new Map();

  function spawn(id, name, p, ry) {
    if (remotes.has(id)) return;
    const baseColor = hashColor(name);
    const human = buildHuman({
      shirt: baseColor.getHex(),
      pants: PANTS[name.length % PANTS.length],
      fem: false, veste: false, jupe: false, barbe: false, // avatar de joueur : tenue fixe
    });
    const nameplate = makeNameplate(name);
    human.group.add(nameplate);
    human.group.position.set(p[0], p[1], p[2]);
    human.group.rotation.y = ry;
    scene.add(human.group);

    // headshot = impact au-dessus du cou (tête : 1,50 → 1,82 m)
    for (const mesh of human.hitMeshes) {
      mesh.userData.onHit = (hit) => onHitRemote?.(
        id, hit, Boolean(hit?.point) && hit.point.y - human.group.position.y > 1.5 * human.group.scale.y
      );
      shootables?.push(mesh);
    }
    // Aide à la visée (voir weapon.js) : centre du torse, sauf en véhicule
    human.hitMeshes[0].userData.aimPoint = (out) => {
      const r = remotes.get(id);
      if (!r || r.inVehicle || !human.group.visible) return null;
      return out.copy(human.group.position).setY(human.group.position.y + 1.15);
    };

    const bubble = makeChatBubble();
    bubble.visible = false;
    human.group.add(bubble);

    // Personnage réaliste (avatars Rocketbox) : l'humain sculpté tient la
    // place le temps du chargement, puis on l'échange (sauf palier Bas)
    if (avatarsEnabled()) {
      buildAvatar(avatarFor(name)).then((av) => swapIn(id, human, av)).catch(() => {});
    }

    remotes.set(id, {
      human, name, baseColor, bubble, nameplate, team: -1,
      buffer: [{ t: performance.now() / 1000, p, ry }],
      flashUntil: 0,
      bubbleUntil: 0,
      animTime: Math.random() * 10,
      prevPos: new THREE.Vector3(p[0], p[1], p[2]),
    });
  }

  function swapIn(id, old, av) {
    const r = remotes.get(id);
    if (!r || r.human !== old) return; // parti (ou déjà échangé) entre-temps
    const g = av.group, og = old.group;
    g.position.copy(og.position);
    g.rotation.copy(og.rotation);
    g.scale.copy(og.scale);
    // étiquette, bulle, losange d'équipe… suivent ; l'arme sera rebâtie
    if (r.weapon) { old.armR.remove(r.weapon); r.weapon = null; r.muzzle = null; r.weaponCode = 0; }
    for (const c of [...og.children]) if (c.isSprite) g.add(c);
    for (const mesh of old.hitMeshes) {
      const i = shootables?.indexOf(mesh) ?? -1;
      if (i >= 0) shootables.splice(i, 1);
    }
    for (const mesh of av.hitMeshes) {
      mesh.userData.onHit = (hit) => onHitRemote?.(
        id, hit, Boolean(hit?.point) && hit.point.y - g.position.y > 1.5 * g.scale.y
      );
      shootables?.push(mesh);
    }
    av.hitMeshes[0].userData.aimPoint = (out) => {
      const rr = remotes.get(id);
      if (!rr || rr.inVehicle || !g.visible) return null;
      return out.copy(g.position).setY(g.position.y + 1.15);
    };
    av.animate = av.animateArmed; // bras en position de tir quand l'arme est sortie
    g.visible = og.visible;
    scene.remove(og);
    scene.add(g);
    r.human = av;
    if (r.team >= 0) av.setBand(TEAM_COLORS[r.team].getHex());
    r.glow = -1; // lueur (nuit, équipe) à reposer sur les nouveaux matériaux
  }

  // ÉQUIPES DE L'ARÈNE : losange de couleur au-dessus de la tête (il ne
  // traverse pas les murs) + brassard aux deux bras sur les avatars. Plus
  // de lueur sur le corps. L'étiquette de nom se voit à travers tout :
  // on la cache aux adversaires (hideName) pour ne pas offrir un radar.
  const TEAM_COLORS = [new THREE.Color(0xe23a2e), new THREE.Color(0x2f76f0)];
  function setTeam(id, team, hideName = false) {
    const r = remotes.get(id);
    if (!r) return;
    r.nameplate.visible = !hideName;
    if (r.team === team) return;
    r.team = team;
    r.glow = -1; // force le recalcul de la lueur (voir update)
    r.human.setBand?.(team >= 0 ? TEAM_COLORS[team].getHex() : null);
    if (team >= 0 && !r.teamMark) {
      r.teamMark = new THREE.Sprite(new THREE.SpriteMaterial({ rotation: Math.PI / 4 }));
      r.teamMark.scale.setScalar(0.2);
      r.teamMark.position.y = 2.02;
      r.human.group.add(r.teamMark);
    }
    if (r.teamMark) {
      r.teamMark.visible = team >= 0;
      if (team >= 0) r.teamMark.material.color.copy(TEAM_COLORS[team]);
    }
  }
  function resetTeams() {
    for (const id of remotes.keys()) setTeam(id, -1, false);
  }

  function showChat(id, text) {
    const r = remotes.get(id);
    if (!r) return;
    setBubbleText(r.bubble, text, r.name);
    r.bubble.visible = true;
    r.bubbleUntil = performance.now() / 1000 + 6;
  }

  function remove(id) {
    const r = remotes.get(id);
    if (!r) return;
    if (r.car) scene.remove(r.car);
    if (r.plane) scene.remove(r.plane);
    if (r.jet) scene.remove(r.jet);
    r.music?.stop();
    scene.remove(r.human.group);
    if (shootables) {
      for (const mesh of r.human.hitMeshes) {
        const i = shootables.indexOf(mesh);
        if (i !== -1) shootables.splice(i, 1);
      }
    }
    remotes.delete(id);
  }

  // MORT : le personnage s'écroule sur place (2,6 s) au lieu de disparaître
  // d'un coup — sa position est figée là où il est tombé pendant ce temps.
  // `by` = tueur (id) : le corps part dans le sens du tir. Avatars : vrai
  // RAGDOLL (world/avatars.js) ; humains sculptés : bascule en arrière.
  function fall(id, by = null) {
    const r = remotes.get(id);
    const t = performance.now() / 1000;
    if (!r || (r.deadUntil ?? 0) > t) return;
    const g = r.human.group;
    r.deadAt = t;
    r.deadUntil = t + 2.6;
    r.deadPos = g.position.clone();
    r.deadRy = g.rotation.y;
    const from = by != null ? (remotes.get(by)?.human.group.position ?? getListenerPos?.()) : null;
    let dx = Math.sin(r.deadRy), dz = Math.cos(r.deadRy); // à défaut : à la renverse
    if (from) { dx = g.position.x - from.x; dz = g.position.z - from.z; }
    const l = Math.hypot(dx, dz) || 1;
    r.rag = Boolean(r.human.ragdollStart?.(dx / l, dz / l));
    r.ragLast = t;
    const cy = r.human.chestY?.() ?? g.position.y + 1.3;
    gore?.burst(g.position.x, cy, g.position.z, dx / l, dz / l, 26);
    r.poolAt = t + 0.9; // la flaque vient quand le corps est au sol
    // cri : plus fort de près, inaudible au-delà de 60 m
    const lp = getListenerPos?.();
    const d = lp ? Math.hypot(lp.x - g.position.x, lp.z - g.position.z) : 30;
    if (d < 60) audio.scream?.(Math.max(0.05, 1 - d / 60), (id.length * 7 + id.charCodeAt(id.length - 1)) % 5);
  }

  function flash(id) {
    const r = remotes.get(id);
    if (!r) return;
    r.human.shirtMat.color.set(0xff2222);
    r.flashUntil = performance.now() / 1000 + 0.25;
  }

  // Éclair de bouche bref quand un joueur distant tire — le serveur ne
  // broadcast jamais le 'shot' à son propre auteur (voir ws.js), donc ceci
  // ne se déclenche que pour de VRAIS tireurs distants.
  function muzzleFlash(id) {
    const r = remotes.get(id);
    if (!r?.muzzle) return;
    r.muzzleUntil = performance.now() / 1000 + 0.06;
    r.human.kickShot?.(); // secousse de recul dans les bras
  }
  net.on('shot', (msg) => { if (!msg.melee) muzzleFlash(msg.id); });

  net.on('hello', (msg) => {
    for (const pl of msg.players) spawn(pl.id, pl.name, pl.p, pl.ry);
  });
  net.on('pjoin', (msg) => spawn(msg.id, msg.name, msg.p, msg.ry));
  net.on('pleave', (msg) => remove(msg.id));
  net.on('hp', (msg) => {
    flash(msg.id);
    // touché : petite gerbe de sang (pas pour un soin)
    const r = msg.regen ? null : remotes.get(msg.id);
    if (r && gore) {
      const g = r.human.group, from = msg.by != null ? (remotes.get(msg.by)?.human.group.position ?? getListenerPos?.()) : null;
      let dx = 0, dz = 0;
      if (from) { dx = g.position.x - from.x; dz = g.position.z - from.z; const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l; }
      gore.burst(g.position.x, g.position.y + 1.25, g.position.z, dx, dz, 9);
    }
  });
  net.on('death', (msg) => { flash(msg.id); fall(msg.id, msg.by); });
  net.on('akill', (msg) => fall(msg.v, msg.by));
  net.on('chat', (msg) => showChat(msg.id, msg.text));
  net.on('states', (msg) => {
    const now = performance.now() / 1000;
    for (const [id, x, y, z, ry, , veh, vry, mus, vpx, vrz, vjet, wpn, cr] of msg.s) {
      const r = remotes.get(id);
      if (!r) continue;
      r.buffer.push({
        t: now, p: [x, y, z], ry,
        veh: veh ?? 0, vry: vry ?? 0, mus: mus ?? 0,
        vpx: vpx ?? 0, vrz: vrz ?? 0, vjet: vjet ?? 0, wpn: wpn ?? 0, cr: cr ?? 0,
      });
      if (r.buffer.length > 30) r.buffer.shift();
    }
  });

  let lastFrame = performance.now() / 1000;

  function update() {
    const nowSec = performance.now() / 1000;
    const frameDt = Math.min(0.1, nowSec - lastFrame);
    lastFrame = nowSec;
    const renderTime = nowSec - INTERP_DELAY;

    // La nuit, les autres joueurs luisent de leur couleur (émissif, pas de
    // vraie lumière) : repérables dans les rues sombres, comme en néon.
    const glow = 0.5 * (state.night ?? 0);
    for (const r of remotes.values()) {
      if (r.glow !== glow) {
        r.glow = glow;
        // lueur de nuit : seulement les personnages sculptés hors équipe
        // (ni halo d'équipe, ni halo sur les avatars réalistes)
        r.human.shirtMat.emissive.copy(r.baseColor).multiplyScalar(r.team >= 0 || r.human.isAvatar ? 0 : glow);
      }
      if (r.flashUntil && nowSec > r.flashUntil) {
        r.human.clearTint();
        r.flashUntil = 0;
      }
      if (r.bubbleUntil && nowSec > r.bubbleUntil) {
        r.bubble.visible = false;
        r.bubbleUntil = 0;
      }
      const buf = r.buffer;
      if (buf.length === 0) continue;
      let a = buf[0], b = buf[buf.length - 1];
      for (let i = buf.length - 1; i >= 0; i--) {
        if (buf[i].t <= renderTime) {
          a = buf[i];
          b = buf[Math.min(i + 1, buf.length - 1)];
          break;
        }
      }
      const span = b.t - a.t;
      const alpha = span > 0 ? Math.min(1, (renderTime - a.t) / span) : 1;
      const g = r.human.group;
      g.position.set(
        a.p[0] + (b.p[0] - a.p[0]) * alpha,
        a.p[1] + (b.p[1] - a.p[1]) * alpha,
        a.p[2] + (b.p[2] - a.p[2]) * alpha
      );
      let dry = b.ry - a.ry;
      while (dry > Math.PI) dry -= Math.PI * 2;
      while (dry < -Math.PI) dry += Math.PI * 2;
      g.rotation.y = a.ry + dry * alpha;

      // Véhicule visible quand le joueur conduit : cabriolet fantôme (1)
      // ou avion fantôme (2), teintés à la couleur du joueur
      const vehCode = b.veh ?? a.veh ?? 0;
      const jetCode = b.vjet ?? a.vjet ?? 0;
      const veh = vehCode > 0;
      r.inVehicle = veh && vehCode !== 3; // à vélo, on reste une cible
      if (vehCode === 1 && !r.car) {
        r.car = makeGhostCabrio(r.baseColor);
        scene.add(r.car);
      }
      if (vehCode === 2 && !jetCode && !r.plane) {
        r.plane = makeGhostPlane(r.baseColor);
        scene.add(r.plane);
      }
      if (vehCode === 2 && jetCode && !r.jet) {
        r.jet = makeGhostMirage(r.baseColor);
        scene.add(r.jet);
      }
      // 3 = Vélo'v : le vélo apparaît sous l'avatar, qui reste visible
      if (vehCode === 3 && !r.bike) {
        r.bike = buildVelovModel();
        scene.add(r.bike);
      }
      if (r.bike) {
        r.bike.visible = vehCode === 3;
        if (r.bike.visible) {
          r.bike.position.copy(g.position);
          r.bike.rotation.y = (b.vry ?? a.vry ?? 0);
        }
      }

      // Arme tenue en main : on voit un autre joueur la sortir, la ranger,
      // et l'éclair de bouche quand il tire (voir muzzleFlash/net.on('shot')).
      // Rien en véhicule/avion — les mains sont sur les commandes.
      // Mort récente : figé à l'endroit de la chute, le corps bascule en arrière
      const dead = (r.deadUntil ?? 0) > nowSec;
      if (dead) {
        if (r.rag) {
          // ragdoll : le groupe et les os sont pilotés par la simulation
          r.human.ragdollStep(Math.min(0.25, nowSec - r.ragLast), r.deadPos.y);
          r.ragLast = nowSec;
          if (r.weapon) r.weapon.visible = false; // l'arme ne reste pas plantée en l'air
        } else {
          g.position.copy(r.deadPos);
          const k = Math.min(1, (nowSec - r.deadAt) / 0.5);
          g.rotation.order = 'YXZ';
          g.rotation.set(-k * k * 1.5, r.deadRy, 0);
          g.position.y += k * 0.12; // le dos repose sur le sol, pas dedans
        }
        if (r.poolAt && nowSec > r.poolAt) {
          r.poolAt = 0;
          gore?.pool(g.position.x + (r.rag ? 0 : -Math.sin(r.deadRy) * 0.6), r.deadPos.y, g.position.z + (r.rag ? 0 : -Math.cos(r.deadRy) * 0.6));
        }
      } else if (r.deadUntil) {
        r.deadUntil = 0;
        if (r.rag) { r.human.ragdollStop(); r.rag = false; }
        if (r.weapon) r.weapon.visible = true;
        g.rotation.order = 'YXZ';
        g.rotation.set(0, r.deadRy, 0);
      }
      // Accroupi : vraie posture pour les avatars, silhouette tassée sinon
      const crouching = !veh && !dead && Boolean(b.cr ?? 0);
      g.userData.crouch = crouching;
      const squat = crouching && !r.human.isAvatar ? 0.7 : 1;
      if (Math.abs(g.scale.y - squat) > 0.005) g.scale.y += (squat - g.scale.y) * 0.3;
      const wpnCode = veh ? 0 : (b.wpn ?? a.wpn ?? 0);
      if (wpnCode !== (r.weaponCode ?? 0)) {
        if (r.weapon) { r.human.armR.remove(r.weapon); r.weapon = null; r.muzzle = null; }
        const wid = WEAPON_IDS[wpnCode - 1];
        if (wid) {
          r.weapon = buildWeaponModel(wid);
          if (r.human.isAvatar) {
            r.weapon.position.set(0, 0, 0); // support déjà calé sur la main, pointé devant
          } else {
            r.weapon.position.set(0.02, -0.5, -0.06);
            r.weapon.rotation.set(-1.15, 0, 0);
          }
          // lueur ronde (texture de halo partagée), pas un carré blanc
          r.muzzle = makeGlowSprite(0xfff2b0, 0.4, 0);
          r.muzzle.position.set(0, 0, -0.5);
          r.muzzle.userData.noShadow = true;
          r.weapon.add(r.muzzle);
          r.human.armR.add(r.weapon);
        }
        r.weaponCode = wpnCode;
      }
      if (r.muzzle) {
        r.muzzle.material.opacity = (r.muzzleUntil && nowSec < r.muzzleUntil) ? 1 : 0;
      }
      let dvry = (b.vry ?? 0) - (a.vry ?? 0);
      while (dvry > Math.PI) dvry -= Math.PI * 2;
      while (dvry < -Math.PI) dvry += Math.PI * 2;
      const vry = (a.vry ?? 0) + dvry * alpha;
      let dvpx = (b.vpx ?? 0) - (a.vpx ?? 0);
      let dvrz = (b.vrz ?? 0) - (a.vrz ?? 0);
      while (dvpx > Math.PI) dvpx -= Math.PI * 2;
      while (dvpx < -Math.PI) dvpx += Math.PI * 2;
      while (dvrz > Math.PI) dvrz -= Math.PI * 2;
      while (dvrz < -Math.PI) dvrz += Math.PI * 2;
      const vpx = (a.vpx ?? 0) + dvpx * alpha;
      const vrz = (a.vrz ?? 0) + dvrz * alpha;
      if (r.car) {
        r.car.visible = vehCode === 1;
        if (r.car.visible) {
          r.car.position.copy(g.position);
          r.car.rotation.y = vry;
        }
      }
      if (r.plane) {
        r.plane.visible = vehCode === 2 && !jetCode;
        if (r.plane.visible) {
          r.plane.position.copy(g.position);
          r.plane.rotation.set(vpx, vry, vrz, 'YXZ');
          r.plane.userData.prop.rotation.z += frameDt * 25;
        }
      }
      if (r.jet) {
        r.jet.visible = vehCode === 2 && Boolean(jetCode);
        if (r.jet.visible) {
          r.jet.position.copy(g.position);
          r.jet.rotation.set(vpx, vry, vrz, 'YXZ');
        }
      }

      // Enceinte portable du joueur distant : musique positionnelle
      // (volume par distance ; une source lointaine ne programme rien)
      const musCode = b.mus ?? a.mus ?? 0;
      if (musCode > 0) {
        if (!r.music) r.music = createMusicSource();
        if (r.music.track !== musCode) {
          r.music.setVolume(0);
          r.music.start(musCode);
        }
        const lp = getListenerPos?.();
        const d = lp ? Math.hypot(lp.x - g.position.x, lp.z - g.position.z) : 999;
        r.music.setVolume(gainForDistance(d, 0.32, 36));
      } else if (r.music?.track) {
        r.music.stop();
      }

      // Animation de marche selon la vitesse réelle observée (figée en voiture)
      const speed = frameDt > 0 ? g.position.distanceTo(r.prevPos) / frameDt : 0;
      r.prevPos.copy(g.position);
      r.animTime += frameDt * (3 + Math.min(speed, 12) * 0.9);
      r.human.group.userData.baseY = g.position.y;
      if (r.human.isAvatar) {
        // avatar réaliste : bras en position de tir si l'arme est sortie,
        // animation allégée au-delà de 40 m, vitesse au format des avatars
        r.human.setArmed(Boolean(r.weapon) && !dead);
        const lp = getListenerPos?.();
        g.userData.far = lp ? g.position.distanceToSquared(lp) > 1600 : false;
        r.human.animate(r.animTime, veh || dead ? 0 : speed * 2.6);
      } else {
        r.human.animate(r.animTime, veh ? 0 : speed);
      }
    }
  }

  function count() { return remotes.size; }
  function getPos(id) { return remotes.get(id)?.human.group.position ?? null; }
  function getGroup(id) { return remotes.get(id)?.human.group ?? null; } // (killcam)
  function getHuman(id) { return remotes.get(id)?.human ?? null; } // (hook de debug : ragdoll)
  function weaponIdOf(id) { return WEAPON_IDS[(remotes.get(id)?.weaponCode ?? 0) - 1] ?? null; } // arme en main (son des tirs)
  // Joueur distant le plus proche (défi en duel : E près de quelqu'un)
  function nearest(pos, maxD = 4) {
    let best = null;
    for (const [id, r] of remotes) {
      const d = r.human.group.position.distanceTo(pos);
      if (d < maxD && (!best || d < best.d)) best = { id, name: r.name ?? '?', d };
    }
    return best;
  }

  // Positions de tous les joueurs distants (carte M)
  function list() {
    const out = [];
    for (const r of remotes.values()) {
      const p = r.human.group.position;
      out.push({ x: p.x, z: p.z, name: r.name, color: `#${r.baseColor.getHexString()}` });
    }
    return out;
  }

  const colorOf = (id) => remotes.get(id)?.baseColor.getHex();

  return { update, count, showChat, getPos, nearest, list, colorOf, setTeam, resetTeams, getGroup, getHuman, weaponIdOf };
}

// Avion fantôme des pilotes distants (veh: 2), teinté à leur couleur
function makeGhostPlane(tint) {
  return buildPlaneModel(tint.clone().multiplyScalar(0.9).getHex());
}

function makeGhostMirage(tint) {
  return buildMirageModel(tint.clone().multiplyScalar(0.85).getHex());
}

// Cabriolet fantôme affiché sous les joueurs distants qui conduisent —
// teinté à la couleur du joueur, géométrie minimale.
const GHOST_DARK = new THREE.MeshLambertMaterial({ color: 0x1c1e24 });
function makeGhostCabrio(tint) {
  const car = new THREE.Group();
  const bodyMat = new THREE.MeshLambertMaterial({ color: tint.clone().multiplyScalar(0.85) });
  const body = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.55, 4.1), bodyMat);
  body.position.y = 0.62;
  car.add(body);
  const windshield = new THREE.Mesh(
    new THREE.PlaneGeometry(1.6, 0.6),
    new THREE.MeshLambertMaterial({
      color: 0x9fc4d8, transparent: true, opacity: 0.55, side: THREE.DoubleSide,
    })
  );
  windshield.position.set(0, 1.25, -0.7);
  windshield.rotation.x = -0.35;
  car.add(windshield);
  for (const off of [1.3, -1.3]) {
    const axle = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.5, 0.6), GHOST_DARK);
    axle.position.set(0, 0.26, off);
    car.add(axle);
  }
  car.visible = false;
  return car;
}

function makeChatBubble() {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 200;
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(canvas), transparent: true, depthTest: false })
  );
  sprite.scale.set(4, 1.56, 1);
  sprite.position.y = 2.6;
  sprite.userData.canvas = canvas;
  return sprite;
}

function setBubbleText(sprite, text, name) {
  const canvas = sprite.userData.canvas;
  const g = canvas.getContext('2d');
  g.clearRect(0, 0, canvas.width, canvas.height);
  g.font = '600 34px "Segoe UI", sans-serif';
  // Découpe en lignes (max ~22 caractères)
  const words = String(text).split(' ');
  const lines = [];
  let line = '';
  for (const w of words) {
    if ((line + ' ' + w).trim().length > 22) { lines.push(line.trim()); line = w; }
    else line += ' ' + w;
  }
  if (line.trim()) lines.push(line.trim());
  const shown = lines.slice(0, 3);
  const lh = 40;
  const boxH = shown.length * lh + 24;
  const boxY = canvas.height - boxH - 8;
  let maxW = 0;
  for (const l of shown) maxW = Math.max(maxW, g.measureText(l).width);
  const boxW = Math.min(canvas.width - 12, maxW + 44);
  const bx = (canvas.width - boxW) / 2;
  g.fillStyle = 'rgba(255, 255, 255, 0.95)';
  g.beginPath();
  g.roundRect(bx, boxY, boxW, boxH, 16);
  g.fill();
  // Pointe de la bulle
  g.beginPath();
  g.moveTo(canvas.width / 2 - 12, boxY + boxH);
  g.lineTo(canvas.width / 2 + 12, boxY + boxH);
  g.lineTo(canvas.width / 2, boxY + boxH + 18);
  g.closePath();
  g.fill();
  g.fillStyle = '#16203a';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  shown.forEach((l, i) => g.fillText(l, canvas.width / 2, boxY + 12 + lh / 2 + i * lh));
  // Pseudo de l'émetteur au-dessus de la bulle
  if (name) {
    g.font = '700 26px "Segoe UI", sans-serif';
    g.fillStyle = '#ffd56b';
    g.strokeStyle = 'rgba(0,0,0,0.6)';
    g.lineWidth = 4;
    g.strokeText(name, canvas.width / 2, boxY - 14);
    g.fillText(name, canvas.width / 2, boxY - 14);
  }
  sprite.material.map.needsUpdate = true;
}

function makeNameplate(name) {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 64;
  const g = canvas.getContext('2d');
  g.font = 'bold 34px "Segoe UI", sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.shadowColor = '#000';
  g.shadowBlur = 8;
  g.fillStyle = '#ffffff';
  g.fillText(name, 128, 32);
  const tex = new THREE.CanvasTexture(canvas);
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false })
  );
  sprite.scale.set(1.8, 0.45, 1);
  sprite.position.y = 2.15;
  return sprite;
}
