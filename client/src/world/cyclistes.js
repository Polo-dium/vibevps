import * as THREE from 'three';
import { buildHuman } from './human.js';
import { buildVelovModel } from './velov.js';
import { detail } from '../render/detail.js';
import { makeRand } from './layout.js';

// CYCLISTES (ville OSM) : quelques Lyonnais à Vélo'v, recyclés autour du
// joueur comme les passants (world/passersby.js), qui roulent à droite sur
// les vraies rues, pédalent, se penchent un peu et s'enchaînent de tronçon
// en tronçon. Visuels seulement (pas de collision), touchés → ils filent.

const CELL = 50;
const NEAR = 25, FAR = 110, DROP = 150;

export function createCyclistes(ctx, data) {
  const count = detail.level === 'eleve' ? 9 : detail.level === 'moyen' ? 5 : 3;
  const rand = makeRand(7341);
  // Voies : demi-chaussée de droite des rues carrossables (sens de tracé)
  const segs = [], grid = new Map();
  const key = (cx, cz) => cx * 100003 + cz;
  const ends = new Map(); // nœud → tronçons qui en partent (enchaînement)
  const nk = (x, z) => `${Math.round(x)},${Math.round(z)}`;
  for (const road of data.roads ?? []) {
    if (road.w < 5.5) continue;
    for (let i = 0; i + 3 < road.p.length; i += 2) {
      const x1 = road.p[i], z1 = road.p[i + 1], x2 = road.p[i + 2], z2 = road.p[i + 3];
      const len = Math.hypot(x2 - x1, z2 - z1);
      if (len < 3) continue;
      if (ctx.waterMask?.isWater((x1 + x2) / 2, (z1 + z2) / 2) && !ctx.onBridge?.((x1 + x2) / 2, (z1 + z2) / 2)) continue;
      for (const dir of [1, -1]) {
        const a = dir > 0 ? [x1, z1] : [x2, z2], b = dir > 0 ? [x2, z2] : [x1, z1];
        const s = { a, b, len, lane: Math.min(road.w * 0.3, (road.rw ?? road.w) * 0.3) };
        const idx = segs.push(s) - 1;
        const k = key(Math.floor((a[0] + b[0]) / 2 / CELL), Math.floor((a[1] + b[1]) / 2 / CELL));
        if (!grid.has(k)) grid.set(k, []);
        grid.get(k).push(idx);
        const ka = nk(a[0], a[1]);
        if (!ends.has(ka)) ends.set(ka, []);
        ends.get(ka).push(s);
      }
    }
  }
  if (!segs.length) return null;

  const SHIRTS = [0xc8423a, 0x2f6fb5, 0xe8e3d8, 0xd9a441, 0x3c8d8a, 0x2b2b30, 0x7b4a8e];
  const riders = [];
  for (let i = 0; i < count; i++) {
    const g = new THREE.Group();
    const bike = buildVelovModel();
    const h = buildHuman({ shirt: SHIRTS[i % SHIRTS.length], pants: [0x2b2f3a, 0x39404e, 0x50463c][i % 3], seated: true });
    // en selle : hanches sur la selle, buste penché vers le guidon
    h.group.position.set(0, 0.16, 0.42);
    h.group.rotation.x = -0.22;
    h.armL.rotation.x = h.armR.rotation.x = 0.95;
    h.foreL.rotation.x = h.foreR.rotation.x = 0.35;
    g.add(bike, h.group);
    g.visible = false;
    ctx.scene.add(g);
    const r = { g, h, seg: null, t: 0, speed: 4, phase: rand() * 6, flee: 0 };
    for (const m of h.hitMeshes) {
      m.userData.onHit = () => { r.flee = 4; };
      ctx.shootables.push(m);
    }
    riders.push(r);
  }

  const fwd = new THREE.Vector3();
  function near(px, pz, rMin, rMax) {
    const out = [], R = Math.ceil(rMax / CELL);
    const cx = Math.floor(px / CELL), cz = Math.floor(pz / CELL);
    for (let i = -R; i <= R; i++) for (let j = -R; j <= R; j++) {
      for (const idx of grid.get(key(cx + i, cz + j)) ?? []) {
        const s = segs[idx];
        const d = Math.hypot((s.a[0] + s.b[0]) / 2 - px, (s.a[1] + s.b[1]) / 2 - pz);
        if (d >= rMin && d <= rMax) out.push(s);
      }
    }
    return out;
  }
  function respawn(r, p, first) {
    const cand = near(p.x, p.z, first ? 10 : NEAR, FAR);
    if (!cand.length) { r.seg = null; r.g.visible = false; return; }
    let pick = cand[0];
    for (let k = 0; k < 6; k++) {
      pick = cand[Math.floor(Math.random() * cand.length)];
      const mx = (pick.a[0] + pick.b[0]) / 2 - p.x, mz = (pick.a[1] + pick.b[1]) / 2 - p.z;
      const dist = Math.hypot(mx, mz);
      if (first || (mx * fwd.x + mz * fwd.z) / (dist || 1) < 0.3 || dist > 70) break;
    }
    r.seg = pick; r.t = Math.random() * 0.5;
    r.speed = 3.6 + Math.random() * 2.2;
    r.flee = 0;
    r.g.visible = true;
  }
  let started = false, prevYaw = new Map();
  ctx.updatables.push((dt) => {
    const p = ctx.playerPos?.();
    if (!p) return;
    if (ctx.camera) ctx.camera.getWorldDirection(fwd);
    for (const r of riders) {
      if (!started || !r.seg) { respawn(r, p, !started); continue; }
      const sp = r.speed * (r.flee > 0 ? 2.2 : 1);
      if (r.flee > 0) r.flee -= dt;
      r.t += (sp * dt) / r.seg.len;
      if (r.t > 1) {
        // carrefour : on enchaîne sur un tronçon qui part d'ici (pas de demi-tour)
        const s = r.seg;
        const next = (ends.get(nk(s.b[0], s.b[1])) ?? []).filter((n) =>
          Math.hypot(n.b[0] - s.a[0], n.b[1] - s.a[1]) > 1);
        if (next.length) { r.seg = next[Math.floor(Math.random() * next.length)]; r.t = 0; } else { respawn(r, p, false); continue; }
      }
      const s = r.seg;
      const dx = (s.b[0] - s.a[0]) / s.len, dz = (s.b[1] - s.a[1]) / s.len;
      // à droite dans le sens de marche (z vers le bas : droite = (-dz, dx))
      const x = s.a[0] + (s.b[0] - s.a[0]) * r.t - dz * s.lane;
      const z = s.a[1] + (s.b[1] - s.a[1]) * r.t + dx * s.lane;
      if (Math.hypot(x - p.x, z - p.z) > DROP) { respawn(r, p, false); continue; }
      const y = Math.max(0, ctx.terrainHeight?.(x, z) ?? 0);
      r.g.position.set(x, y, z);
      const yaw = Math.atan2(-dx, -dz);
      // virage → léger penché, lissé
      const prev = prevYaw.get(r) ?? yaw;
      let dy = yaw - prev;
      dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      r.g.rotation.set(0, prev + dy * Math.min(1, dt * 6), THREE.MathUtils.clamp(-dy * 3, -0.25, 0.25), 'YXZ');
      prevYaw.set(r, r.g.rotation.y);
      // pédalage
      r.phase += dt * sp * 1.6;
      const c = Math.sin(r.phase), d = Math.cos(r.phase);
      r.h.legL.rotation.x = 1.15 + c * 0.38;
      r.h.legR.rotation.x = 1.15 - c * 0.38;
      r.h.kneeL.rotation.x = -1.25 - d * 0.42;
      r.h.kneeR.rotation.x = -1.25 + d * 0.42;
    }
    started = true;
  });
  return { riders };
}
