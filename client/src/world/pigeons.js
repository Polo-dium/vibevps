import * as THREE from 'three';
import { sculpt, paint } from '../render/sculpt.js';
import { detail } from '../render/detail.js';

// PIGEONS DE LYON 🐦 : deux volées recyclées autour du joueur, posées sur
// les places (Bellecour, la grande roue, le bouchon) et devant les
// terrasses de café. Au sol ils
// trottinent en hochant la tête et picorent ; quand on s'approche (ou qu'on
// tire), toute la volée s'envole, tourne au-dessus des toits puis revient
// se poser. Corps sculpté (sculpt.js) + deux ailes, en InstancedMesh :
// 3 draw calls pour tous les pigeons.

const BODY = 0, NECK = 1, HEAD = 2, BEAK = 3, DARK = 4, WING = 5, LEG = 6;

function pigeonGeometry(cell) {
  return sculpt([
    { t: 'ell', c: [0, 0.13, 0.02], r: [0.07, 0.068, 0.125], slot: BODY, k: 0.03 },
    { t: 'ell', c: [0, 0.145, -0.055], r: [0.064, 0.066, 0.065], slot: NECK, k: 0.03 },
    { t: 'cone', a: [0, 0.16, -0.07], b: [0, 0.215, -0.09], r1: 0.042, r2: 0.03, slot: NECK, k: 0.02 },
    { t: 'sphere', c: [0, 0.232, -0.1], r: 0.033, slot: HEAD, k: 0.015 },
    { t: 'cone', a: [0, 0.229, -0.128], b: [0, 0.222, -0.152], r1: 0.009, r2: 0.004, slot: BEAK, k: 0.005 },
    { t: 'box', c: [0, 0.125, 0.15], h: [0.042, 0.01, 0.07], round: 0.008, rot: [-0.25, 0, 0], slot: DARK, k: 0.015 },
    { t: 'ell', c: [-0.05, 0.15, 0.05], r: [0.026, 0.05, 0.1], slot: WING, k: 0.02 },
    { t: 'ell', c: [0.05, 0.15, 0.05], r: [0.026, 0.05, 0.1], slot: WING, k: 0.02 },
    { t: 'cone', a: [-0.022, 0.08, 0], b: [-0.022, 0.0, -0.006], r1: 0.008, r2: 0.006, slot: LEG, k: 0.005 },
    { t: 'cone', a: [0.022, 0.08, 0], b: [0.022, 0.0, -0.006], r1: 0.008, r2: 0.006, slot: LEG, k: 0.005 },
  ], { cell });
}

// Aile déployée : pivot à l'épaule, s'étend vers +x (l'aile gauche est la
// même retournée), bord de fuite en plumes
function wingGeometry() {
  const s = new THREE.Shape();
  s.moveTo(0, -0.05);
  s.lineTo(0.12, -0.06);
  s.lineTo(0.27, -0.02);
  s.lineTo(0.3, 0.04);
  s.lineTo(0.22, 0.07);
  s.lineTo(0.16, 0.05);
  s.lineTo(0.1, 0.07);
  s.lineTo(0, 0.06);
  s.closePath();
  const g = new THREE.ShapeGeometry(s);
  g.rotateX(-Math.PI / 2); // à plat ; +y du dessin → -z (vers l'avant)
  return g;
}

// Coins à pigeons : les places historiques + une terrasse de café sur trois
function pigeonSpots(ctx) {
  const spots = [];
  const B = ctx.bellecourRect;
  if (B) spots.push({ x: (B.minX + B.maxX) / 2 - 20, z: (B.minZ + B.maxZ) / 2 + 8 });
  else spots.push({ x: -14, z: 18 });
  const roue = ctx.pois?.find((p) => p.id === 'roue');
  if (roue) spots.push({ x: roue.x - 10, z: roue.z - 8 });
  const bouchon = ctx.pois?.find((p) => p.id === 'bouchon');
  if (bouchon) spots.push({ x: bouchon.x + 10, z: bouchon.z + 6 });
  (ctx.terraces?.kept ?? []).forEach((t, i) => {
    if (i % 3 === 0) spots.push({ x: t.x + t.nx * 3.2, z: t.z + t.nz * 3.2 });
  });
  return spots;
}

export function createPigeons(ctx, spots = pigeonSpots(ctx)) {
  const n = detail.level === 'eleve' ? 26 : detail.level === 'moyen' ? 16 : 8;
  if (!spots.length || !n) return null;
  const C = (h) => new THREE.Color(h);
  const palette = [];
  palette[BODY] = C(0x7f8794); palette[NECK] = C(0x5d7468); palette[HEAD] = C(0x6c7480);
  palette[BEAK] = C(0x3b3535); palette[DARK] = C(0x4a505a); palette[WING] = C(0x9aa2ad); palette[LEG] = C(0xb8615e);
  const bodyGeo = paint(pigeonGeometry(detail.level === 'eleve' ? 0.011 : 0.017), palette);
  const mat = detail.high
    ? new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75 })
    : new THREE.MeshLambertMaterial({ vertexColors: true });
  const wingMat = new THREE.MeshLambertMaterial({ color: 0x8e96a2, side: THREE.DoubleSide });
  const bodies = new THREE.InstancedMesh(bodyGeo, mat, n);
  const wingL = new THREE.InstancedMesh(wingGeometry(), wingMat, n);
  const wingR = new THREE.InstancedMesh(wingGeometry(), wingMat, n);
  for (const m of [bodies, wingL, wingR]) {
    m.frustumCulled = false; // volée mobile : boîte englobante recalculée inutilement sinon
    m.castShadow = true;
    ctx.scene.add(m);
  }

  // Deux volées de n/2 oiseaux, chacune attachée à un « coin à pigeons »
  const flocks = [0, 1].map(() => ({ spot: null, mode: 'sol', t: 0 }));
  const birds = [];
  for (let i = 0; i < n; i++) {
    birds.push({
      f: flocks[i % 2], x: 0, y: 0, z: 0, yaw: Math.random() * 6.28, pitch: 0,
      walk: 0, turn: 0, peck: Math.random() * 10, flap: Math.random() * 6,
      ang: Math.random() * 6.28, r: 6 + Math.random() * 8, alt: 7 + Math.random() * 6, vy: 0,
    });
  }
  const ground = (x, z) => Math.max(0, ctx.terrainHeight?.(x, z) ?? 0) + 0.06;
  function settle(f, spot) {
    f.spot = spot;
    f.mode = 'sol';
    for (const b of birds) if (b.f === f) {
      b.x = spot.x + (Math.random() - 0.5) * 5;
      b.z = spot.z + (Math.random() - 0.5) * 5;
      b.y = ground(b.x, b.z);
    }
  }
  // Envol : toute la volée, sur un cercle au-dessus de son coin
  ctx.scareBirds = (x, z, r = 12) => {
    for (const f of flocks) {
      if (f.spot && f.mode === 'sol' && Math.hypot(f.spot.x - x, f.spot.z - z) < r) {
        f.mode = 'vol';
        f.t = 9 + Math.random() * 6;
        for (const b of birds) if (b.f === f) { b.vy = 3 + Math.random() * 2; b.ang = Math.atan2(b.z - f.spot.z, b.x - f.spot.x); }
      }
    }
  };

  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), qw = new THREE.Quaternion();
  const e = new THREE.Euler(0, 0, 0, 'YXZ'), v = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1);
  const zero = new THREE.Vector3(0, 0, 0), sideL = new THREE.Vector3(), tmp = new THREE.Vector3();
  let pickTimer = 0;
  ctx.updatables.push((dt) => {
    const p = ctx.playerPos?.();
    if (!p) return;
    // Les coins les plus proches reçoivent les volées (on ne déplace une
    // volée que si elle est loin du joueur : pas d'apparition sous les yeux)
    pickTimer -= dt;
    if (pickTimer <= 0) {
      pickTimer = 2;
      const near = spots
        .map((s) => ({ s, d: Math.hypot(s.x - p.x, s.z - p.z) }))
        .filter((o) => o.d > 14 || flocks.some((f) => f.spot === o.s))
        .sort((a, b) => a.d - b.d)
        .slice(0, 2)
        .map((o) => o.s);
      for (const f of flocks) {
        const far = !f.spot || Math.hypot(f.spot.x - p.x, f.spot.z - p.z) > 55;
        if (f.spot && near.includes(f.spot)) continue;
        const free = near.find((s) => !flocks.some((g) => g.spot === s));
        if (free && far) settle(f, free);
      }
    }
    for (const f of flocks) {
      if (!f.spot) continue;
      if (f.mode === 'sol' && Math.hypot(f.spot.x - p.x, f.spot.z - p.z) < 6) ctx.scareBirds(f.spot.x, f.spot.z, 1);
      if (f.mode === 'vol') {
        f.t -= dt;
        if (f.t <= 0) f.mode = 'retour';
      } else if (f.mode === 'retour' && birds.every((b) => b.f !== f || b.landed)) {
        f.mode = 'sol';
      }
    }
    for (let i = 0; i < birds.length; i++) {
      const b = birds[i];
      const f = b.f;
      if (!f.spot) {
        m4.compose(zero, q, zero);
        bodies.setMatrixAt(i, m4); wingL.setMatrixAt(i, m4); wingR.setMatrixAt(i, m4);
        continue;
      }
      let flying = false;
      if (f.mode === 'sol' || (f.mode === 'retour' && b.landed)) {
        b.landed = true;
        // Trottine, tourne, picore ; reste près de son coin
        b.walk -= dt;
        if (b.walk <= 0) {
          b.walk = 0.6 + Math.random() * 2.2;
          b.turn = (Math.random() - 0.5) * 3;
          const dx = f.spot.x - b.x, dz = f.spot.z - b.z;
          if (Math.hypot(dx, dz) > 4) b.yaw = Math.atan2(-dx, -dz) + (Math.random() - 0.5);
        }
        b.yaw += b.turn * dt * 0.6;
        b.peck += dt;
        const pecking = Math.sin(b.peck * 1.3) > 0.55;
        const speed = pecking ? 0 : 0.22;
        b.x -= Math.sin(b.yaw) * speed * dt;
        b.z -= Math.cos(b.yaw) * speed * dt;
        b.y = ground(b.x, b.z);
        // hochement de tête en marchant, bascule vers l'avant pour picorer
        b.pitch = pecking ? -0.55 * Math.max(0, Math.sin(b.peck * 9)) : Math.sin(b.peck * 14) * 0.06;
      } else {
        flying = true;
        b.landed = false;
        const sp = 7.5;
        if (f.mode === 'vol') {
          // cercle au-dessus des toits
          b.ang += (sp / b.r) * dt;
          const tx = f.spot.x + Math.cos(b.ang) * b.r, tz = f.spot.z + Math.sin(b.ang) * b.r;
          const ty = ground(f.spot.x, f.spot.z) + b.alt;
          b.y += Math.max(-3, Math.min(b.vy, (ty - b.y) * 1.5)) * dt;
          b.vy = Math.max(0, b.vy - dt * 1.5) + 0.8;
          b.yaw = Math.atan2(-(tx - b.x), -(tz - b.z));
          b.x += (tx - b.x) * Math.min(1, dt * 2);
          b.z += (tz - b.z) * Math.min(1, dt * 2);
          b.pitch = 0.1;
        } else {
          // retour : plané vers un point du coin, puis posé
          if (b.lx == null) { b.lx = f.spot.x + (Math.random() - 0.5) * 5; b.lz = f.spot.z + (Math.random() - 0.5) * 5; }
          const dx = b.lx - b.x, dz = b.lz - b.z, d = Math.hypot(dx, dz);
          const gy = ground(b.lx, b.lz);
          b.yaw = Math.atan2(-dx, -dz);
          const step = Math.min(d, sp * 0.8 * dt);
          b.x += (dx / (d || 1)) * step;
          b.z += (dz / (d || 1)) * step;
          b.y += (gy - b.y) * Math.min(1, dt * (d < 3 ? 4 : 0.9));
          b.pitch = -0.15;
          if (d < 0.15 && b.y - gy < 0.08) { b.landed = true; b.lx = null; b.y = gy; }
        }
      }
      e.set(b.pitch, b.yaw, 0);
      q.setFromEuler(e);
      v.set(b.x, b.y, b.z);
      bodies.setMatrixAt(i, m4.compose(v, q, one));
      if (flying) {
        b.flap += dt * (f.mode === 'retour' ? 9 : 16);
        const a = Math.sin(b.flap) * 0.9;
        for (const [mesh, s] of [[wingR, 1], [wingL, -1]]) {
          // épaule : légèrement au-dessus du dos
          tmp.set(0.04 * s, 0.17, 0.0).applyQuaternion(q).add(v);
          qw.setFromEuler(new THREE.Euler(0, s < 0 ? Math.PI : 0, -a * s * (s < 0 ? -1 : 1)));
          sideL.set(1, 1, 1);
          mesh.setMatrixAt(i, m4.compose(tmp, q.clone().multiply(qw), sideL));
        }
      } else {
        wingL.setMatrixAt(i, m4.compose(zero, q, zero));
        wingR.setMatrixAt(i, m4.compose(zero, q, zero));
      }
    }
    bodies.instanceMatrix.needsUpdate = true;
    wingL.instanceMatrix.needsUpdate = true;
    wingR.instanceMatrix.needsUpdate = true;
  });
  return { birds, flocks };
}
