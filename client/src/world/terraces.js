import * as THREE from 'three';
import { roadHalf } from './roadfit.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { buildHuman } from './human.js';
import { detail } from '../render/detail.js';
import { makeRand } from './layout.js';

// TERRASSES DE CAFÉ (ville OSM) : devant chaque devanture « café » ou
// « bouchon » qui a la place (trottoir libre, pas de chaussée, pas d'eau),
// deux guéridons au plateau de marbre, des chaises bistrot en rotin et
// l'ardoise du plat du jour. Mobilier en InstancedMesh par quartier (masqué
// au loin). Les CLIENTS attablés sont une petite troupe recyclée : elle
// s'installe aux terrasses les plus proches du joueur (comme les passants).
// Placement déterministe : mêmes terrasses chez tout le monde.

const TILE = 120;
const SHOW = 260; // distance d'affichage du mobilier

function colored(geo, hex) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k);
  const c = new THREE.Color(hex);
  const arr = new Float32Array(g.attributes.position.count * 3);
  for (let i = 0; i < arr.length; i += 3) { arr[i] = c.r; arr[i + 1] = c.g; arr[i + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return g;
}
const at = (geo, x, y, z, rx = 0) => { if (rx) geo.rotateX(rx); geo.translate(x, y, z); return geo; };

// Guéridon : pied en fonte, plateau de marbre
function tableGeo() {
  const IRON = 0x2a2a2d;
  return mergeGeometries([
    colored(at(new THREE.CylinderGeometry(0.2, 0.24, 0.03, 10), 0, 0.015, 0), IRON),
    colored(at(new THREE.CylinderGeometry(0.028, 0.035, 0.7, 6, 1, true), 0, 0.37, 0), IRON),
    colored(at(new THREE.CylinderGeometry(0.33, 0.33, 0.03, 16), 0, 0.735, 0), 0xe9e5dc),
  ]);
}
// Chaise bistrot : assise et dossier cintré en rotin, pieds noirs (le
// client assis regarde vers -z, le dossier est en +z)
function chairGeo() {
  const RATTAN = 0x9c6b3c, IRON = 0x2a2a2d;
  const parts = [colored(at(new THREE.CylinderGeometry(0.2, 0.2, 0.05, 10), 0, 0.45, 0), RATTAN)];
  for (const [x, z] of [[-0.14, -0.14], [0.14, -0.14], [-0.14, 0.14], [0.14, 0.14]]) {
    parts.push(colored(at(new THREE.CylinderGeometry(0.014, 0.014, 0.45, 4, 1, true), x, 0.225, z), IRON));
  }
  const back = new THREE.TorusGeometry(0.19, 0.022, 4, 10, Math.PI);
  parts.push(colored(at(back, 0, 0.5, 0.17, -0.12), RATTAN));
  parts.push(colored(at(new THREE.BoxGeometry(0.3, 0.12, 0.025), 0, 0.62, 0.18), RATTAN));
  return mergeGeometries(parts);
}
// Ardoise en chevalet (A) : le plat du jour
function boardGeo() {
  const g = new THREE.BoxGeometry(0.55, 0.85, 0.03);
  g.translate(0, 0.42, 0);
  g.rotateX(-0.22);
  return g;
}
function boardTexture() {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 192;
  const g = c.getContext('2d');
  g.fillStyle = '#7a5532'; g.fillRect(0, 0, 128, 192);
  g.fillStyle = '#1f2322'; g.fillRect(8, 8, 112, 176);
  g.fillStyle = '#f2efe6';
  g.textAlign = 'center';
  g.font = 'bold 15px Georgia, serif';
  g.fillText('PLAT DU JOUR', 64, 34);
  g.font = 'italic 14px Georgia, serif';
  g.fillText('Quenelle', 64, 70);
  g.fillText('de brochet', 64, 88);
  g.fillText('sauce Nantua', 64, 106);
  g.font = 'bold 18px Georgia, serif';
  g.fillStyle = '#f2cf72';
  g.fillText('14 €', 64, 140);
  g.font = '11px Georgia, serif';
  g.fillStyle = '#c9d6cf';
  g.fillText('Pot de côtes 9 €', 64, 168);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/**
 * spots : modules de devanture café/bouchon, { x, z, nx, nz } = milieu du
 * module au pied du mur et normale SORTANTE. roads : rues OSM ({ p, w }).
 */
export function createTerraces(ctx, spots, roads) {
  if (!spots.length) return null;
  // --- Chaussées à éviter (grille de tronçons) ------------------------
  const RC = 24, grid = new Map();
  const key = (x, z) => `${Math.floor(x / RC)},${Math.floor(z / RC)}`;
  for (const r of roads ?? []) {
    if (r.w < 5.5) continue; // ruelle pavée piétonne : on peut s'y installer
    for (let i = 0; i + 3 < r.p.length; i += 2) {
      const seg = [r.p[i], r.p[i + 1], r.p[i + 2], r.p[i + 3], roadHalf(r) + 0.3];
      const x0 = Math.min(seg[0], seg[2]) - 6, x1 = Math.max(seg[0], seg[2]) + 6;
      const z0 = Math.min(seg[1], seg[3]) - 6, z1 = Math.max(seg[1], seg[3]) + 6;
      for (let gx = Math.floor(x0 / RC); gx <= Math.floor(x1 / RC); gx++) {
        for (let gz = Math.floor(z0 / RC); gz <= Math.floor(z1 / RC); gz++) {
          const k = `${gx},${gz}`;
          if (!grid.has(k)) grid.set(k, []);
          grid.get(k).push(seg);
        }
      }
    }
  }
  const onRoad = (x, z) => {
    for (const [ax, az, bx, bz, h] of grid.get(key(x, z)) ?? []) {
      const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz || 1;
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2));
      if (Math.hypot(x - ax - dx * t, z - az - dz * t) < h) return true;
    }
    return false;
  };
  const blocked = (x, z) => {
    if (ctx.waterMask?.isWater(x, z) || ctx.theatre?.covers(x, z) || onRoad(x, z)) return true;
    for (const b of ctx.colliders.nearby ? ctx.colliders.nearby(x, z, 1) : []) {
      if (x > b.minX && x < b.maxX && z > b.minZ && z < b.maxZ && b.maxY > 0.5) return true;
    }
    return false;
  };

  // --- Terrasses retenues -------------------------------------------------
  const kept = [];
  for (const s of spots) {
    if (kept.length >= 420) break;
    if (kept.some((o) => Math.abs(o.x - s.x) < 7 && Math.abs(o.z - s.z) < 7)) continue;
    const tx = -s.nz, tz = s.nx; // le long du mur
    let ok = true;
    for (const d of [0.5, 1.4, 2.4]) {
      for (const l of [-2, 0, 2]) {
        if (blocked(s.x + s.nx * d + tx * l, s.z + s.nz * d + tz * l)) { ok = false; break; }
      }
      if (!ok) break;
    }
    if (ok) kept.push(s);
  }
  if (!kept.length) return null;

  // --- Mobilier, par quartier -------------------------------------------
  const tiles = new Map();
  const chairs = []; // { x, y, z, yaw } : places assises (vers la table)
  const rand = makeRand(7311);
  for (const s of kept) {
    const tx = -s.nz, tz = s.nx;
    const y = Math.max(0, ctx.terrainHeight?.(s.x, s.z) ?? 0) + 0.06;
    const tk = `${Math.floor(s.x / TILE)},${Math.floor(s.z / TILE)}`;
    if (!tiles.has(tk)) tiles.set(tk, { cx: (Math.floor(s.x / TILE) + 0.5) * TILE, cz: (Math.floor(s.z / TILE) + 0.5) * TILE, t: [], c: [], b: [] });
    const T = tiles.get(tk);
    const wallYaw = Math.atan2(s.nx, s.nz); // +z local → dehors
    for (const l of [-1.1, 1.1]) {
      const cx = s.x + s.nx * 1.45 + tx * l, cz = s.z + s.nz * 1.45 + tz * l;
      T.t.push([cx, y, cz, rand() * 6]);
      ctx.colliders.push({ minX: cx - 0.34, maxX: cx + 0.34, minZ: cz - 0.34, maxZ: cz + 0.34, minY: y, maxY: y + 0.76 });
      // deux chaises face à face, dans l'axe de la rue (un peu de désordre)
      for (const side of [-1, 1]) {
        const jit = (rand() - 0.5) * 0.25;
        const ch = { x: cx + tx * side * 0.62, y, z: cz + tz * side * 0.62, yaw: 0 };
        // dossier côté extérieur : le client regarde la table
        ch.yaw = Math.atan2(ch.x - cx, ch.z - cz) + jit;
        T.c.push([ch.x, y, ch.z, ch.yaw]);
        if (rand() < 0.7) chairs.push(ch);
      }
    }
    // ardoise à côté de la porte, face à la rue
    T.b.push([s.x + s.nx * 0.5 + tx * 2.0, y, s.z + s.nz * 0.5 + tz * 2.0, wallYaw]);
  }
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
  const boardMat = new THREE.MeshLambertMaterial({ map: boardTexture() });
  const geos = { t: tableGeo(), c: chairGeo(), b: boardGeo() };
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1);
  const Y = new THREE.Vector3(0, 1, 0);
  const groups = [];
  for (const T of tiles.values()) {
    const meshes = [];
    for (const kind of ['t', 'c', 'b']) {
      const list = T[kind];
      if (!list.length) continue;
      const im = new THREE.InstancedMesh(geos[kind], kind === 'b' ? boardMat : mat, list.length);
      list.forEach(([x, y, z, yaw], i) => {
        m4.compose(v.set(x, y, z), q.setFromAxisAngle(Y, yaw), one);
        im.setMatrixAt(i, m4);
      });
      im.instanceMatrix.needsUpdate = true;
      im.computeBoundingSphere();
      im.castShadow = true;
      ctx.scene.add(im);
      meshes.push(im);
    }
    groups.push({ cx: T.cx, cz: T.cz, meshes, shown: true });
  }

  // --- Les clients ----------------------------------------------------------
  const count = detail.level === 'eleve' ? 14 : detail.level === 'moyen' ? 8 : 0;
  const SHIRTS = [0xb0413e, 0x3d6b9e, 0x7a5ba8, 0x4e7a4a, 0xe8e3d8, 0x2b2b30, 0xd9a441, 0x3c8d8a];
  const PANTS = [0x2b2f3a, 0x39404e, 0x50463c, 0x1c1c22, 0x6e5a44];
  const SKINS = [0xe8c39e, 0x8d5a3b, 0xf0cfb0, 0xc68e63, 0x5c3a26];
  const HAIRS = [0x3a2c1e, 0x111111, 0x8a5a2b, 0xd9c08a, 0x6b6b6b];
  const crowd = [];
  for (let i = 0; i < count; i++) {
    const h = buildHuman({
      shirt: SHIRTS[i % SHIRTS.length], pants: PANTS[(i * 3) % PANTS.length],
      skin: SKINS[(i * 7) % SKINS.length], hair: HAIRS[(i * 5) % HAIRS.length], seated: true,
    });
    // Pose assise : cuisses à l'horizontale, tibias à la verticale, avant-bras
    // posés vers la table
    h.legL.rotation.x = h.legR.rotation.x = 1.35;
    h.kneeL.rotation.x = h.kneeR.rotation.x = -1.35;
    h.armL.rotation.x = h.armR.rotation.x = 0.35;
    h.foreL.rotation.x = h.foreR.rotation.x = 1.05;
    h.group.visible = false;
    ctx.scene.add(h.group);
    crowd.push({ h, chair: null, phase: i * 1.7 });
  }

  let timer = 0, time = 0;
  ctx.updatables.push((dt) => {
    time += dt;
    const p = ctx.playerPos?.();
    if (!p) return;
    timer -= dt;
    if (timer <= 0) {
      timer = 0.5;
      const show = SHOW * SHOW, hide = (SHOW + 60) ** 2;
      for (const g of groups) {
        const d2 = (g.cx - p.x) ** 2 + (g.cz - p.z) ** 2;
        if (g.shown && d2 > hide) { g.shown = false; for (const m of g.meshes) m.visible = false; }
        else if (!g.shown && d2 < show) { g.shown = true; for (const m of g.meshes) m.visible = true; }
      }
      if (crowd.length) {
        // les places les plus proches (à moins de 60 m) sont occupées
        const near = chairs
          .map((c) => ({ c, d: (c.x - p.x) ** 2 + (c.z - p.z) ** 2 }))
          .filter((o) => o.d < 3600)
          .sort((a, b) => a.d - b.d)
          .slice(0, crowd.length)
          .map((o) => o.c);
        const taken = new Set();
        for (const m of crowd) if (m.chair && near.includes(m.chair)) taken.add(m.chair);
        for (const m of crowd) {
          if (m.chair && near.includes(m.chair)) continue;
          m.chair = near.find((c) => !taken.has(c)) ?? null;
          if (m.chair) {
            taken.add(m.chair);
            const c = m.chair;
            m.h.group.position.set(c.x, c.y - 0.31, c.z);
            // les humains regardent -z au repos
            m.h.group.rotation.y = c.yaw;
          }
          m.h.group.visible = !!m.chair;
        }
      }
    }
    // De temps en temps, on lève son verre
    for (const m of crowd) {
      if (!m.chair) continue;
      const s = Math.sin(time * 0.6 + m.phase);
      const sip = Math.max(0, s - 0.85) / 0.15; // 0..1, ~10 % du temps
      m.h.armR.rotation.x = 0.35 + sip * 0.5;
      m.h.foreR.rotation.x = 1.05 + sip * 1.0;
    }
  });
  console.log(`☕ Terrasses : ${kept.length} (sur ${spots.length} devantures café/bouchon), ${chairs.length} places.`);
  return { kept, chairs };
}
