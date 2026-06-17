import * as THREE from 'three';
import { hashColor } from '../world/utils.js';
import { buildHuman } from '../world/human.js';
import * as net from '../net.js';

const INTERP_DELAY = 0.12; // secondes de retard de rendu pour interpoler

const PANTS = [0x39404e, 0x4e4439, 0x2e3a4e, 0x44394e];

export function createRemotePlayers(scene, shootables, { onHitRemote } = {}) {
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
    for (const [id, x, y, z, ry] of msg.s) {
      const r = remotes.get(id);
      if (!r) continue;
      r.buffer.push({ t: now, p: [x, y, z], ry });
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

      // Animation de marche selon la vitesse réelle observée
      const speed = frameDt > 0 ? g.position.distanceTo(r.prevPos) / frameDt : 0;
      r.prevPos.copy(g.position);
      r.animTime += frameDt * (3 + Math.min(speed, 12) * 0.9);
      r.human.group.userData.baseY = g.position.y;
      r.human.animate(r.animTime, speed);
    }
  }

  function count() { return remotes.size; }
  function getPos(id) { return remotes.get(id)?.human.group.position ?? null; }

  return { update, count, showChat, getPos };
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
