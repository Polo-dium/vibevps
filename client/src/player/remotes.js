import * as THREE from 'three';
import { hashColor } from '../world/utils.js';
import { buildHuman } from '../world/human.js';
import { buildPlaneModel } from '../world/aviation.js';
import { createMusicSource, gainForDistance } from '../music.js';
import * as net from '../net.js';

const INTERP_DELAY = 0.12; // secondes de retard de rendu pour interpoler

const PANTS = [0x39404e, 0x4e4439, 0x2e3a4e, 0x44394e];

export function createRemotePlayers(scene, shootables, { onHitRemote, getListenerPos } = {}) {
  const remotes = new Map();

  function spawn(id, name, p, ry) {
    if (remotes.has(id)) return;
    const baseColor = hashColor(name);
    const human = buildHuman({
      shirt: baseColor.getHex(),
      pants: PANTS[name.length % PANTS.length],
    });
    human.group.add(makeNameplate(name));
    human.group.position.set(p[0], p[1], p[2]);
    human.group.rotation.y = ry;
    scene.add(human.group);

    for (const mesh of human.hitMeshes) {
      mesh.userData.onHit = () => onHitRemote?.(id);
      shootables?.push(mesh);
    }

    const bubble = makeChatBubble();
    bubble.visible = false;
    human.group.add(bubble);

    remotes.set(id, {
      human, name, baseColor, bubble,
      buffer: [{ t: performance.now() / 1000, p, ry }],
      flashUntil: 0,
      bubbleUntil: 0,
      animTime: Math.random() * 10,
      prevPos: new THREE.Vector3(p[0], p[1], p[2]),
    });
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

  function flash(id) {
    const r = remotes.get(id);
    if (!r) return;
    r.human.shirtMat.color.set(0xff2222);
    r.flashUntil = performance.now() / 1000 + 0.25;
  }

  net.on('hello', (msg) => {
    for (const pl of msg.players) spawn(pl.id, pl.name, pl.p, pl.ry);
  });
  net.on('pjoin', (msg) => spawn(msg.id, msg.name, msg.p, msg.ry));
  net.on('pleave', (msg) => remove(msg.id));
  net.on('hp', (msg) => flash(msg.id));
  net.on('death', (msg) => flash(msg.id));
  net.on('chat', (msg) => showChat(msg.id, msg.text));
  net.on('states', (msg) => {
    const now = performance.now() / 1000;
    for (const [id, x, y, z, ry, , veh, vry, mus, vpx, vrz] of msg.s) {
      const r = remotes.get(id);
      if (!r) continue;
      r.buffer.push({
        t: now, p: [x, y, z], ry,
        veh: veh ?? 0, vry: vry ?? 0, mus: mus ?? 0,
        vpx: vpx ?? 0, vrz: vrz ?? 0,
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

    for (const r of remotes.values()) {
      if (r.flashUntil && nowSec > r.flashUntil) {
        r.human.shirtMat.color.copy(r.baseColor);
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
      const veh = vehCode > 0;
      if (vehCode === 1 && !r.car) {
        r.car = makeGhostCabrio(r.baseColor);
        scene.add(r.car);
      }
      if (vehCode === 2 && !r.plane) {
        r.plane = makeGhostPlane(r.baseColor);
        scene.add(r.plane);
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
        r.plane.visible = vehCode === 2;
        if (r.plane.visible) {
          r.plane.position.copy(g.position);
          r.plane.rotation.set(vpx, vry, vrz, 'YXZ');
          r.plane.userData.prop.rotation.z += frameDt * 25;
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
      r.human.animate(r.animTime, veh ? 0 : speed);
    }
  }

  function count() { return remotes.size; }
  function getPos(id) { return remotes.get(id)?.human.group.position ?? null; }

  return { update, count, showChat, getPos };
}

// Avion fantôme des pilotes distants (veh: 2), teinté à leur couleur
function makeGhostPlane(tint) {
  return buildPlaneModel(tint.clone().multiplyScalar(0.9).getHex());
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
