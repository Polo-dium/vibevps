import * as THREE from 'three';
import { roadHalf } from './roadfit.js';
import { buildHuman } from './human.js';
import { detail } from '../render/detail.js';
import { makeRand } from './layout.js';

// PASSANTS (ville OSM) : une petite troupe RECYCLÉE autour du joueur, qui
// marche sur les trottoirs des vraies rues. Quand un passant s'éloigne trop
// (ou arrive au bout de sa rue sans suite), il réapparaît plus loin, sur un
// trottoir proche mais pas sous les yeux du joueur. La ville semble habitée
// partout pour le prix de quelques humains (5 meshes chacun).
//
// Trottoirs : les rues OSM décalées de part et d'autre (demi-largeur +
// 1,2 m), découpées en tronçons rangés dans une grille de 40 m.

const CELL = 40;
const NEAR = 30, FAR = 85, DROP = 110; // apparition entre NEAR et FAR, recyclage au-delà de DROP

export function createPassersby(ctx, data) {
  const count = detail.level === 'eleve' ? 22 : detail.level === 'moyen' ? 12 : 6;
  const rand = makeRand(6070);

  // --- Tronçons de trottoir -------------------------------------------------
  const segs = [];
  const grid = new Map();
  const key = (cx, cz) => cx * 100003 + cz;
  const blocked = (x, z) => {
    if (ctx.waterMask?.isWater(x, z) || ctx.theatre?.covers(x, z)) return true;
    for (const b of ctx.colliders.nearby ? ctx.colliders.nearby(x, z, 1) : []) {
      if (x > b.minX - 0.4 && x < b.maxX + 0.4 && z > b.minZ - 0.4 && z < b.maxZ + 0.4 && b.maxY > 1.5) return true;
    }
    return false;
  };
  for (const road of data.roads ?? []) {
    if (road.w < 4) continue;
    const off = roadHalf(road) + 1.2;
    for (let i = 0; i + 3 < road.p.length; i += 2) {
      const x1 = road.p[i], z1 = road.p[i + 1], x2 = road.p[i + 2], z2 = road.p[i + 3];
      const len = Math.hypot(x2 - x1, z2 - z1);
      if (len < 6) continue;
      const nx = -(z2 - z1) / len, nz = (x2 - x1) / len;
      for (const side of [-1, 1]) {
        const a = [x1 + nx * off * side, z1 + nz * off * side];
        const b = [x2 + nx * off * side, z2 + nz * off * side];
        // tronçon praticable de bout en bout (sondes tous les 4 m)
        let ok = true;
        for (let t = 0; t <= 1; t += 4 / len) {
          if (blocked(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t)) { ok = false; break; }
        }
        if (!ok) continue;
        const seg = { a, b, len };
        const idx = segs.push(seg) - 1;
        const cx = Math.floor((a[0] + b[0]) / 2 / CELL), cz = Math.floor((a[1] + b[1]) / 2 / CELL);
        const k = key(cx, cz);
        if (!grid.has(k)) grid.set(k, []);
        grid.get(k).push(idx);
      }
    }
  }
  if (!segs.length) return null;

  // --- La troupe ----------------------------------------------------------
  const SHIRTS = [0x2f6fb5, 0xc8423a, 0x6a9a4c, 0xe8e3d8, 0x2b2b30, 0xd9a441, 0x7b4a8e, 0x3c8d8a, 0xb5653d, 0x8c8f96];
  const PANTS = [0x2b2f3a, 0x39404e, 0x50463c, 0x1c1c22, 0x5a6270, 0x6e5a44];
  const SKINS = [0xe8c39e, 0x8d5a3b, 0xf0cfb0, 0xc68e63, 0x5c3a26];
  const HAIRS = [0x3a2c1e, 0x111111, 0x8a5a2b, 0xd9c08a, 0x6b6b6b];
  const people = [];
  for (let i = 0; i < count; i++) {
    const h = buildHuman({
      shirt: SHIRTS[Math.floor(rand() * SHIRTS.length)],
      pants: PANTS[Math.floor(rand() * PANTS.length)],
      skin: SKINS[Math.floor(rand() * SKINS.length)],
      hair: HAIRS[Math.floor(rand() * HAIRS.length)],
    });
    h.group.visible = false;
    ctx.scene.add(h.group);
    const p = { h, seg: null, t: 0, dir: 1, speed: 1.2, phase: rand() * 10, flee: 0 };
    // Touché : il s'enfuit en courant, puis disparaît au coin de la rue
    for (const m of h.hitMeshes) {
      m.userData.onHit = () => { p.flee = 6; p.speed = 4.2; };
      ctx.shootables.push(m);
    }
    people.push(p);
  }

  const look = new THREE.Vector3();
  const fwd = new THREE.Vector3();
  function nearbySegs(px, pz, rMin, rMax) {
    const out = [];
    const r = Math.ceil(rMax / CELL);
    const cx = Math.floor(px / CELL), cz = Math.floor(pz / CELL);
    for (let i = -r; i <= r; i++) {
      for (let j = -r; j <= r; j++) {
        for (const idx of grid.get(key(cx + i, cz + j)) ?? []) {
          const s = segs[idx];
          const mx = (s.a[0] + s.b[0]) / 2, mz = (s.a[1] + s.b[1]) / 2;
          const d = Math.hypot(mx - px, mz - pz);
          if (d >= rMin && d <= rMax) out.push(s);
        }
      }
    }
    return out;
  }
  // Réapparition : un tronçon à bonne distance, de préférence hors du champ
  // de vision (derrière le joueur ou de côté)
  function respawn(p, player, camDir, first) {
    const cand = nearbySegs(player.x, player.z, first ? 8 : NEAR, FAR);
    if (!cand.length) { p.seg = null; p.h.group.visible = false; return; }
    let pick = null;
    for (let k = 0; k < 6; k++) {
      const s = cand[Math.floor(Math.random() * cand.length)];
      const mx = (s.a[0] + s.b[0]) / 2 - player.x, mz = (s.a[1] + s.b[1]) / 2 - player.z;
      const dist = Math.hypot(mx, mz);
      const facing = (mx * camDir.x + mz * camDir.z) / (dist || 1);
      pick = s;
      // Hors du champ, ou assez loin devant pour que l'apparition se fonde
      // dans la distance : on croise ainsi des passants qui VIENNENT vers soi
      if (first || facing < 0.3 || dist > 60) break;
    }
    p.seg = pick;
    p.t = Math.random();
    p.dir = Math.random() < 0.5 ? 1 : -1;
    p.speed = 1.05 + Math.random() * 0.55;
    p.flee = 0;
    p.h.clearTint?.();
    p.h.group.visible = true;
  }

  let started = false;
  ctx.updatables.push((dt) => {
    const player = ctx.playerPos?.();
    if (!player) return;
    const cam = ctx.camera;
    fwd.set(0, 0, -1);
    if (cam) cam.getWorldDirection(fwd);
    for (const p of people) {
      if (!started || !p.seg) {
        respawn(p, player, fwd, !started);
        continue;
      }
      const s = p.seg;
      p.t += (p.dir * p.speed * dt) / s.len;
      if (p.flee > 0) p.flee -= dt;
      const x = s.a[0] + (s.b[0] - s.a[0]) * p.t, z = s.a[1] + (s.b[1] - s.a[1]) * p.t;
      const far = Math.hypot(x - player.x, z - player.z) > DROP;
      if (p.t < 0 || p.t > 1 || far || (p.flee <= 0 && p.speed > 3)) {
        // Bout de rue : la suite la plus proche si elle existe, sinon recyclé
        respawn(p, player, fwd, false);
        continue;
      }
      const g = p.h.group;
      const y = Math.max(0, ctx.terrainHeight?.(x, z) ?? 0);
      g.userData.baseY = y;
      g.position.set(x, y, z);
      look.set(s.b[0] - s.a[0], 0, s.b[1] - s.a[1]).multiplyScalar(p.dir);
      g.rotation.y = Math.atan2(-look.x, -look.z); // regard vers -z au repos
      p.phase += dt * p.speed * 4.2;
      p.h.animate(p.phase, p.speed * 2.6);
    }
    started = true;
  });
  return { people };
}
