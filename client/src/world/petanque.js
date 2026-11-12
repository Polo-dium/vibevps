import * as THREE from 'three';
import { buildHuman } from './human.js';
import { CROWD, upgradeInPlace } from './avatars.js';

// Pétanque à Bellecour 🎯 : une MÈNE en tête-à-tête contre Dédé le bouliste
// (3 boules chacun), l'honneur des gones.
//  · E au cercle : la partie commence, et c'est TOI qui lances le cochonnet
//    (dans la direction du regard — vise haut pour porter loin).
//  · Ensuite, comme au vrai jeu : c'est à l'équipe qui n'a PAS le point de
//    jouer, tant qu'il lui reste des boules. Dédé lance tout seul.
//  · Les boules se cognent (on peut tirer celle de Dédé, ou pousser le
//    cochonnet). À la fin de la mène, le plus près marque 1 point par boule
//    mieux placée que la meilleure adverse ; premier à 13.
// La meilleure distance du joueur part toujours au classement 'petanque'
// (score = 2000 − centimètres).
const G = 12; // gravité de jeu : un peu douce, les boules portent mieux
const BALL_R = 0.11;
const JACK_R = 0.04;
const GOAL = 13;

export function createPetanque(ctx, { camera, notify, onScore, audio }) {
  const B = ctx.bellecourRect ?? { minX: -60, maxX: 60, minZ: -40, maxZ: 56 };
  // Ville OSM : clos posé dans le repère TOURNÉ de la place (au sud, entre
  // la statue et la pelouse), dans l'axe de la place. Ville procédurale :
  // coin sud-est, droit.
  const R = ctx.belleRot;
  const yaw = R?.yaw ?? 0;
  const [tx, tz] = R ? R.apply(-10, B.maxZ - 16) : [B.maxX - 24, B.maxZ - 12];
  const ty = Math.max(0, ctx.terrainHeight?.(tx, tz) ?? 0);
  const c = Math.cos(yaw), s = Math.sin(yaw);
  // repère local du clos (x = grand axe) → monde
  const toWorld = (lx, lz) => [tx + lx * c + lz * s, tz - lx * s + lz * c];

  const clos = new THREE.Group();
  clos.name = 'clos-petanque';
  clos.position.set(tx, ty, tz);
  clos.rotation.y = yaw;
  ctx.scene.add(clos);
  // Terrain : bande de sable clair bordée de bois, comme au clos de boules
  const sand = new THREE.Mesh(
    new THREE.PlaneGeometry(15, 5),
    new THREE.MeshLambertMaterial({ color: 0xd8c49a })
  );
  sand.rotation.x = -Math.PI / 2;
  sand.position.y = 0.045;
  clos.add(sand);
  const wood = new THREE.MeshLambertMaterial({ color: 0x6d4a28 });
  for (const [w, d, ox, oz] of [[15.4, 0.2, 0, -2.6], [15.4, 0.2, 0, 2.6], [0.2, 5.2, -7.7, 0], [0.2, 5.2, 7.7, 0]]) {
    const edge = new THREE.Mesh(new THREE.BoxGeometry(w, 0.22, d), wood);
    edge.position.set(ox, 0.11, oz);
    clos.add(edge);
  }
  // Cercle de lancer, devant le petit côté ouest
  const rond = new THREE.Mesh(
    new THREE.RingGeometry(0.42, 0.5, 20),
    new THREE.MeshBasicMaterial({ color: 0xf2efe6 })
  );
  rond.rotation.x = -Math.PI / 2;
  rond.position.set(-8.6, 0.05, 0);
  clos.add(rond);
  ctx.pois?.push({ id: 'petanque', nom: 'Clos de pétanque', emoji: '⚫', x: tx, z: tz });
  const [gx, gz] = toWorld(-8.6, 0);

  // Dédé, l'adversaire : planté à côté du cercle, tourné vers le terrain
  const [dx0, dz0] = toWorld(-8.9, 1.7);
  const dede = buildHuman({ shirt: 0x8a3b2e, pants: 0x4a4436, hair: 0xb9b4a8, style: 'casquette', barbe: true });
  dede.group.position.set(dx0, ty, dz0);
  dede.group.rotation.y = yaw - Math.PI / 2;
  ctx.scene.add(dede.group);
  upgradeInPlace(ctx, dede, CROWD.m[3]);

  const steel = new THREE.MeshPhongMaterial({ color: 0x9aa2ab, shininess: 80, specular: 0xdfe6ec });
  const bronze = new THREE.MeshPhongMaterial({ color: 0xb07a3c, shininess: 70, specular: 0xf0d9a8 });
  const ballGeo = new THREE.SphereGeometry(BALL_R, 10, 8);
  const mkBody = (geo, mat, r, mass, team) => {
    const mesh = new THREE.Mesh(geo, mat);
    mesh.visible = false;
    mesh.name = 'boule';
    ctx.scene.add(mesh);
    return { mesh, vel: new THREE.Vector3(), live: false, resting: false, r, mass, team };
  };
  const jackBody = mkBody(new THREE.SphereGeometry(JACK_R, 8, 6), new THREE.MeshLambertMaterial({ color: 0xd9822b }), JACK_R, 0.15, null);
  const jack = jackBody.mesh;
  const mine = [0, 1, 2].map(() => mkBody(ballGeo, steel, BALL_R, 1, 'moi'));
  const his = [0, 1, 2].map(() => mkBody(ballGeo, bronze, BALL_R, 1, 'dede'));
  const bodies = [jackBody, ...mine, ...his];

  let phase = 'idle'; // idle | jack (cochonnet à lancer) | play
  let turn = 'moi';
  let thrown = { moi: 0, dede: 0 };
  let moving = false; // quelque chose roule encore
  let stillSince = 0;
  let aiAt = 0;
  const score = { moi: 0, dede: 0 };

  function refreshLabel() {
    const pts = score.moi || score.dede ? ` (toi ${score.moi} – ${score.dede} Dédé)` : '';
    gate.label = phase === 'idle' ? `E — Partie de pétanque contre Dédé${pts}`
      : phase === 'jack' ? 'E — Lancer le cochonnet (vise avec le regard)'
        : moving ? 'Ça roule…'
          : turn === 'moi' ? `E — Lancer ta boule ${Math.min(3, thrown.moi + 1)}/3 (vise avec le regard)`
            : 'Dédé se concentre…';
  }

  function launch(body, pos, vel) {
    body.mesh.position.copy(pos);
    body.vel.copy(vel);
    body.live = true;
    body.resting = false;
    body.mesh.visible = true;
    moving = true;
    stillSince = 0;
  }
  const _d = new THREE.Vector3(), _p = new THREE.Vector3();
  function throwFromCamera(body, speed, lift) {
    _d.set(0, 0, -1).applyQuaternion(camera.quaternion);
    _p.copy(camera.position).addScaledVector(_d, 0.6);
    _d.multiplyScalar(speed);
    _d.y += lift;
    launch(body, _p, _d);
  }

  const groundAt = (x, z, r) => Math.max(0, ctx.terrainHeight?.(x, z) ?? 0) + r + 0.02;

  // Un pas de physique pour un corps (rebond mat, roulement freiné)
  function settle(body, dt, flatY = null) {
    if (!body.live || body.resting) return;
    body.vel.y -= G * dt;
    body.mesh.position.addScaledVector(body.vel, dt);
    const ground = flatY ?? groundAt(body.mesh.position.x, body.mesh.position.z, body.r);
    if (body.mesh.position.y <= ground) {
      body.mesh.position.y = ground;
      if (Math.abs(body.vel.y) > 0.8) {
        body.vel.y *= -0.32; // rebond mat sur le sable
        body.vel.x *= 0.72;
        body.vel.z *= 0.72;
      } else {
        body.vel.y = 0;
        const k = Math.exp(-1.7 * dt); // roulement freiné par le sable
        body.vel.x *= k;
        body.vel.z *= k;
        if (body.vel.lengthSq() < 0.02) {
          body.vel.set(0, 0, 0);
          body.resting = true;
        }
      }
    }
  }

  // Chocs entre boules (et cochonnet) : échange de l'élan le long de l'axe
  function collide() {
    for (let i = 0; i < bodies.length; i++) {
      const a = bodies[i];
      if (!a.live) continue;
      for (let j = i + 1; j < bodies.length; j++) {
        const b = bodies[j];
        if (!b.live || (a.resting && b.resting)) continue;
        _d.subVectors(b.mesh.position, a.mesh.position);
        const dist = _d.length(), min = a.r + b.r;
        if (dist >= min || dist < 1e-5) continue;
        _d.multiplyScalar(1 / dist);
        const rel = (b.vel.x - a.vel.x) * _d.x + (b.vel.y - a.vel.y) * _d.y + (b.vel.z - a.vel.z) * _d.z;
        const push = min - dist, tm = a.mass + b.mass;
        a.mesh.position.addScaledVector(_d, -push * (b.mass / tm));
        b.mesh.position.addScaledVector(_d, push * (a.mass / tm));
        if (rel < 0) {
          const jn = (-(1 + 0.55) * rel) / (1 / a.mass + 1 / b.mass);
          a.vel.addScaledVector(_d, -jn / a.mass);
          b.vel.addScaledVector(_d, jn / b.mass);
          if (rel < -1.5) audio?.hitmarker?.(); // le « clac » du carreau
        }
        a.resting = b.resting = false;
      }
    }
  }

  // Dédé choisit sa force en SIMULANT le lancer (même physique, sol plat) :
  // il garde la vitesse dont la boule s'arrête le plus près de la cible.
  const sim = { mesh: { position: new THREE.Vector3() }, vel: new THREE.Vector3(), live: true, resting: false, r: BALL_R };
  function aiThrow() {
    const body = his[thrown.dede];
    const from = new THREE.Vector3(gx + s * 0.5, ty + 1.1, gz + c * 0.5);
    // tirer la boule du joueur si elle tient le point de très près, sinon pointer
    const myBest = bestOf(mine);
    const tir = myBest && myBest.d < 0.3 && Math.random() < 0.4;
    const target = (tir ? myBest.b.mesh.position : jack.position).clone();
    const err = tir ? 0.16 : 0.34; // Dédé est bon, pas infaillible
    target.x += (Math.random() + Math.random() - 1) * err;
    target.z += (Math.random() + Math.random() - 1) * err;
    const hx = target.x - from.x, hz = target.z - from.z, hl = Math.hypot(hx, hz) || 1;
    const ang = tir ? 0.2 : 0.5, flat = ty + BALL_R + 0.02;
    let bestV = 6, bestD = Infinity;
    for (let v = 3; v <= 13; v += 0.25) {
      sim.mesh.position.copy(from);
      sim.vel.set((hx / hl) * v * Math.cos(ang), v * Math.sin(ang), (hz / hl) * v * Math.cos(ang));
      sim.resting = false;
      for (let k = 0; k < 900 && !sim.resting; k++) settle(sim, 1 / 60, flat);
      const d = Math.hypot(sim.mesh.position.x - target.x, sim.mesh.position.z - target.z);
      if (d < bestD) { bestD = d; bestV = v; }
    }
    launch(body, from, new THREE.Vector3((hx / hl) * bestV * Math.cos(ang), bestV * Math.sin(ang), (hz / hl) * bestV * Math.cos(ang)));
    thrown.dede++;
    notify(tir ? '💥 Dédé tire !' : '🎯 Dédé pointe…');
    refreshLabel();
  }

  const distJack = (b) => Math.hypot(b.mesh.position.x - jack.position.x, b.mesh.position.z - jack.position.z);
  function bestOf(list) {
    let best = null;
    for (const b of list) {
      if (!b.live) continue;
      const d = distJack(b);
      if (!best || d < best.d) best = { b, d };
    }
    return best;
  }

  function endMene() {
    const m = bestOf(mine), h = bestOf(his);
    const win = !h || (m && m.d <= h.d) ? 'moi' : 'dede';
    const lim = win === 'moi' ? (h?.d ?? Infinity) : (m?.d ?? Infinity);
    const pts = (win === 'moi' ? mine : his).filter((b) => b.live && distJack(b) < lim).length || 1;
    score[win] += pts;
    const cm = Math.round((m?.d ?? 20) * 100);
    onScore?.(cm);
    phase = 'idle';
    const s2 = `toi ${score.moi} – ${score.dede} Dédé`;
    if (score[win] >= GOAL) {
      notify(win === 'moi'
        ? `🏆 ${s2} : partie gagnée ! Dédé paie sa tournée, gone.`
        : `😅 ${s2} : Dédé gagne la partie. Fanny n'est pas loin…`);
      score.moi = score.dede = 0;
    } else {
      notify(win === 'moi'
        ? `🎯 Mène pour toi : +${pts} (meilleure boule à ${cm} cm). ${s2}`
        : `🎯 Mène pour Dédé : +${pts}. ${s2} — faut biberonner moins, gone.`);
    }
    refreshLabel();
  }

  // Tout s'est arrêté : à qui de jouer ?
  function next() {
    if (phase === 'jack') return; // (le cochonnet vient d'être relancé)
    const d = Math.hypot(jack.position.x - gx, jack.position.z - gz);
    if (!thrown.moi && !thrown.dede && (d < 3 || d > 14)) {
      phase = 'jack';
      jackBody.live = false;
      jack.visible = false;
      notify(d < 3 ? '🤏 Cochonnet trop court — relance-le (entre 3 et 14 m).' : '🚀 Cochonnet trop loin — relance-le (entre 3 et 14 m).');
      return refreshLabel();
    }
    if (thrown.moi >= 3 && thrown.dede >= 3) return endMene();
    const m = bestOf(mine), h = bestOf(his);
    // l'équipe qui n'a pas le point rejoue ; au tout début, le joueur ouvre
    const holder = !m && !h ? 'dede' : !h ? 'moi' : !m ? 'dede' : (m.d <= h.d ? 'moi' : 'dede');
    const other = holder === 'moi' ? 'dede' : 'moi';
    turn = thrown[other] < 3 ? other : holder;
    if (turn === 'dede') aiAt = performance.now() + 1300;
    refreshLabel();
  }

  function start() {
    phase = 'jack';
    thrown = { moi: 0, dede: 0 };
    turn = 'moi';
    moving = false;
    for (const b of bodies) { b.mesh.visible = false; b.live = false; b.resting = false; }
    notify('🎯 À toi l’honneur : lance le cochonnet, puis tes boules. Dédé te répond !');
    refreshLabel();
  }

  const gate = {
    x: gx, z: gz, r: 3,
    label: '',
    action: () => {
      if (phase === 'idle') return start();
      if (moving) return;
      if (phase === 'jack') {
        phase = 'play';
        throwFromCamera(jackBody, 6.5, 2.4);
        return refreshLabel();
      }
      if (turn !== 'moi' || thrown.moi >= 3) return;
      throwFromCamera(mine[thrown.moi], 7.5, 2.1);
      thrown.moi++;
      audio?.hitmarker?.();
      refreshLabel();
    },
  };
  refreshLabel();
  ctx.interactables.push(gate);

  ctx.updatables.push((dt) => {
    if (phase === 'idle') return;
    const step = Math.min(dt, 0.05);
    for (const b of bodies) settle(b, step);
    collide();
    if (moving) {
      if (bodies.every((b) => !b.live || b.resting)) {
        stillSince += dt;
        if (stillSince > 0.7) { moving = false; next(); }
      } else stillSince = 0;
    } else if (phase === 'play' && turn === 'dede' && thrown.dede < 3 && performance.now() > aiAt) {
      aiThrow();
    }
    // Le joueur abandonne le clos : on remballe sans bruit (le score reste)
    const p = ctx.playerPos();
    if (Math.hypot(p.x - tx, p.z - tz) > 55) {
      phase = 'idle';
      moving = false;
      for (const b of bodies) { b.mesh.visible = false; b.live = false; }
      refreshLabel();
    }
  });
}
