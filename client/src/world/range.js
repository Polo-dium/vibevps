import * as THREE from 'three';
import { addBox, makeTextTexture } from './utils.js';
import { RANGE } from './layout.js';
import { state } from '../state.js';

const SESSION_DURATION = 45;
const TARGET_UP_TIME = 2.2;
const SPAWN_INTERVAL = 0.85;
const MAX_UP = 3;

export function buildRange(ctx, { onSessionEnd, onEquipWeapon }) {
  const { x: cx, width, counterZ, targetsZ, backZ } = RANGE;
  ctx.pois?.push({ id: 'stand', nom: 'Stand de tir', emoji: '🎯', x: cx, z: counterZ });
  const west = cx - width / 2, east = cx + width / 2;

  // Mur de fond (pare-balles) — taguable, évidemment
  addBox(ctx, { x: cx, z: backZ, w: width, h: 5, d: 1.2, color: 0x7a6a55, taggable: true });
  // Murs latéraux
  addBox(ctx, { x: west, z: (backZ + counterZ + 3) / 2, w: 1, h: 3.5, d: counterZ + 3 - backZ, color: 0x6b5d4b });
  addBox(ctx, { x: east, z: (backZ + counterZ + 3) / 2, w: 1, h: 3.5, d: counterZ + 3 - backZ, color: 0x6b5d4b });
  // Comptoir de tir
  addBox(ctx, { x: cx, z: counterZ, w: width - 2, h: 1.1, d: 0.8, color: 0x4a3b2d });
  // Auvent au-dessus du comptoir
  const roof = new THREE.Mesh(
    new THREE.BoxGeometry(width, 0.25, 6),
    new THREE.MeshLambertMaterial({ color: 0x394150 })
  );
  roof.position.set(cx, 3.4, counterZ + 1);
  ctx.scene.add(roof);
  for (const px of [west + 1.5, east - 1.5]) {
    const post = new THREE.Mesh(
      new THREE.CylinderGeometry(0.12, 0.12, 3.4, 6),
      new THREE.MeshLambertMaterial({ color: 0x2c2f36 })
    );
    post.position.set(px, 1.7, counterZ + 3.5);
    ctx.scene.add(post);
  }

  // Enseigne
  const sign = new THREE.Mesh(
    new THREE.PlaneGeometry(11, 1.8),
    new THREE.MeshBasicMaterial({ map: makeTextTexture('STAND DE TIR', { color: '#ff5252' }), transparent: true })
  );
  sign.position.set(cx, 5.9, backZ + 0.7);
  ctx.scene.add(sign);

  // Cibles
  const targetTexture = makeTargetTexture();
  const targets = [];
  for (let i = 0; i < 6; i++) {
    const x = west + 3 + i * ((width - 6) / 5);
    const group = new THREE.Group();
    const post = new THREE.Mesh(
      new THREE.CylinderGeometry(0.07, 0.07, 1.1, 6),
      new THREE.MeshLambertMaterial({ color: 0x444a55 })
    );
    post.position.y = 0.55;
    group.add(post);

    const disc = new THREE.Mesh(
      new THREE.CircleGeometry(0.48, 24),
      new THREE.MeshBasicMaterial({ map: targetTexture, side: THREE.DoubleSide })
    );
    disc.position.y = 1.6;
    group.add(disc);

    group.position.set(x, 0, targetsZ);
    group.scale.y = 0.01; // baissée au départ
    ctx.scene.add(group);

    const target = { group, disc, up: false, timer: 0, anim: 0 };
    disc.userData.onHit = () => hitTarget(target);
    ctx.shootables.push(disc);
    targets.push(target);
  }

  let spawnTimer = 0;

  function startSession() {
    if (state.rangeSession) return;
    state.rangeSession = { timeLeft: SESSION_DURATION, hits: 0, shots: 0, score: 0 };
    spawnTimer = 0.3;
    for (const t of targets) { t.up = false; t.timer = 0; }
    onEquipWeapon();
  }

  function hitTarget(target) {
    const s = state.rangeSession;
    if (!s || !target.up) return;
    target.up = false;
    s.hits += 1;
    s.score += 100;
  }

  function endSession() {
    const s = state.rangeSession;
    state.rangeSession = null;
    for (const t of targets) t.up = false;
    const accuracy = s.shots > 0 ? Math.round((s.hits / s.shots) * 1000) / 10 : 0;
    onSessionEnd({ score: s.score, hits: s.hits, shots: s.shots, accuracy });
  }

  function update(dt) {
    const s = state.rangeSession;
    if (s) {
      s.timeLeft -= dt;
      if (s.timeLeft <= 0) {
        endSession();
      } else {
        spawnTimer -= dt;
        const upCount = targets.filter((t) => t.up).length;
        if (spawnTimer <= 0 && upCount < MAX_UP) {
          spawnTimer = SPAWN_INTERVAL;
          const down = targets.filter((t) => !t.up);
          if (down.length > 0) {
            const t = down[Math.floor(Math.random() * down.length)];
            t.up = true;
            t.timer = TARGET_UP_TIME;
          }
        }
        for (const t of targets) {
          if (t.up) {
            t.timer -= dt;
            if (t.timer <= 0) t.up = false;
          }
        }
      }
    }
    // Animation lever/baisser
    for (const t of targets) {
      const targetScale = t.up ? 1 : 0.01;
      t.group.scale.y += (targetScale - t.group.scale.y) * Math.min(1, dt * 14);
    }
  }

  ctx.interactables.push({
    x: cx, z: counterZ + 1.5, r: 3.5,
    label: 'E — Démarrer le stand de tir (45 s)',
    action: startSession,
  });

  return { update };
}

function makeTargetTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const g = canvas.getContext('2d');
  const rings = ['#ff3030', '#ffffff', '#ff3030', '#ffffff', '#ff3030'];
  for (let i = 0; i < rings.length; i++) {
    g.fillStyle = rings[i];
    g.beginPath();
    g.arc(64, 64, 62 - i * 12, 0, Math.PI * 2);
    g.fill();
  }
  return new THREE.CanvasTexture(canvas);
}
