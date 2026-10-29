import * as THREE from 'three';
import { roadHalf } from './roadfit.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { detail } from '../render/detail.js';

// VOITURES GARÉES (ville OSM) : en créneau le long des rues qui ont un
// trottoir, d'un côté sur les rues moyennes, des deux sur les larges. Jamais
// dans un carrefour, sur un pont, dans l'eau ni sur une place. Modèle de
// citadine extrudé depuis son profil (capot, pare-brise incliné, coffre),
// vitres sombres, roues, optiques — teinte par instance. InstancedMesh par
// quartier de 120 m, masqué au loin. Placement déterministe (hash).

const TILE = 120;
const SHOW = 230;

function colored(geo, hex) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k);
  if (!g.attributes.normal) g.computeVertexNormals();
  const c = new THREE.Color(hex);
  const arr = new Float32Array(g.attributes.position.count * 3);
  for (let i = 0; i < arr.length; i += 3) { arr[i] = c.r; arr[i + 1] = c.g; arr[i + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return g;
}

// Profil latéral (longueur, hauteur) extrudé sur la largeur ; après rotation
// la longueur suit z et l'AVANT est en +z (phares), l'arrière en -z (feux)
function extrudeProfile(pts, width, color) {
  const s = new THREE.Shape(pts.map(([z, y]) => new THREE.Vector2(z, y)));
  const g = new THREE.ExtrudeGeometry(s, { depth: width, bevelEnabled: true, bevelSize: 0.04, bevelThickness: 0.04, bevelSegments: 1 });
  g.translate(0, 0, -width / 2);
  g.rotateY(Math.PI / 2); // largeur → x, longueur → z (avant du profil en +z)
  return colored(g, color);
}

function carGeometry() {
  const BODY = 0xffffff, GLASS = 0x1a2028, TYRE = 0x18191c;
  const body = extrudeProfile([
    [2.0, 0.3], [-2.0, 0.3], [-2.05, 0.62], [-1.92, 0.8], [-0.85, 0.9],
    [-0.38, 1.36], [0.78, 1.38], [1.45, 0.98], [1.98, 0.9], [2.05, 0.62],
  ], 1.66, BODY);
  const glass = extrudeProfile([
    [-0.8, 0.93], [-0.37, 1.31], [0.74, 1.32], [1.38, 0.99],
  ], 1.7, GLASS);
  const parts = [body, glass];
  for (const [x, z] of [[-0.8, -1.3], [0.8, -1.3], [-0.8, 1.32], [0.8, 1.32]]) {
    const w = new THREE.CylinderGeometry(0.31, 0.31, 0.22, 10);
    w.rotateZ(Math.PI / 2);
    w.translate(x, 0.31, z);
    parts.push(colored(w, TYRE));
  }
  // phares (avant, +z) et feux (arrière)
  for (const x of [-0.6, 0.6]) {
    const h = new THREE.BoxGeometry(0.34, 0.12, 0.05); h.translate(x, 0.7, 2.06); parts.push(colored(h, 0xd8dde0));
    const f = new THREE.BoxGeometry(0.3, 0.12, 0.05); f.translate(x, 0.72, -2.08); parts.push(colored(f, 0xb3241c));
  }
  return mergeGeometries(parts);
}

const PAINTS = [0xf2f2ef, 0xf2f2ef, 0x1d1f22, 0x7d8288, 0xb9bdc1, 0x23344f, 0x8e1f1c, 0xcfc3a5, 0x3e4f3c, 0x5a2f4a];

const hash = (n) => {
  let h = Math.imul(n | 0, 2654435761) >>> 0;
  h ^= h >>> 15; h = Math.imul(h, 2246822519) >>> 0; h ^= h >>> 13;
  return h >>> 0;
};

export function createParkedCars(ctx, roads) {
  if (detail.level === 'bas') return null;
  const nodeKey = (x, z) => `${Math.round(x * 2)},${Math.round(z * 2)}`;
  const nodes = new Map();
  for (const r of roads) {
    for (let i = 0; i + 1 < r.p.length; i += 2) {
      const k = nodeKey(r.p[i], r.p[i + 1]);
      const o = nodes.get(k) ?? { n: 0, w: 0 };
      o.n++; o.w = Math.max(o.w, r.w);
      nodes.set(k, o);
    }
  }
  const blocked = (x, z) => ctx.waterMask?.isWater(x, z) || ctx.theatre?.covers(x, z) ||
    (ctx.parkRects ?? []).some((r) => x > r.minX && x < r.maxX && z > r.minZ && z < r.maxZ) ||
    (ctx.bellecourRect && ctx.belleRot && (() => {
      const B = ctx.bellecourRect;
      return x > B.minX - 30 && x < B.maxX + 30 && z > B.minZ - 30 && z < B.maxZ + 30 && insideBelle(ctx, x, z);
    })());
  const tiles = new Map();
  let total = 0, ri = 0;
  for (const r of roads) {
    ri++;
    if (r.w < 7 || roadHalf(r) < 3.2) continue; // chaussée resserrée : pas la place de se garer
    const sides = r.w >= 10 ? [-1, 1] : [hash(ri) % 2 ? 1 : -1];
    for (let i = 0; i + 3 < r.p.length; i += 2) {
      const x1 = r.p[i], z1 = r.p[i + 1], x2 = r.p[i + 2], z2 = r.p[i + 3];
      const len = Math.hypot(x2 - x1, z2 - z1);
      if (len < 12) continue;
      const ux = (x2 - x1) / len, uz = (z2 - z1) / len;
      const tA = (nodes.get(nodeKey(x1, z1))?.n ?? 0) >= 2 ? (nodes.get(nodeKey(x1, z1)).w / 2 + 5) : 3;
      const tB = (nodes.get(nodeKey(x2, z2))?.n ?? 0) >= 2 ? (nodes.get(nodeKey(x2, z2)).w / 2 + 5) : 3;
      for (const sd of sides) {
        const off = roadHalf(r) - 1.15;
        for (let s = tA + 2.3, k = 0; s < len - tB - 2.3; s += 5.3, k++) {
          const hh = hash(ri * 7919 + i * 131 + k * 17 + (sd > 0 ? 5 : 0));
          if (hh % 100 < 28) continue; // places libres
          const x = x1 + ux * s - uz * off * sd, z = z1 + uz * s + ux * off * sd;
          if (blocked(x, z) || blocked(x + ux * 2, z + uz * 2) || blocked(x - ux * 2, z - uz * 2)) continue;
          const y = Math.max(0, ctx.terrainHeight?.(x, z) ?? 0) + 0.06;
          // le long de la rue, dans le sens de circulation du côté
          const yaw = Math.atan2(ux, uz) + (sd > 0 ? 0 : Math.PI) + ((hh >>> 8) % 7 - 3) * 0.012;
          const tk = `${Math.floor(x / TILE)},${Math.floor(z / TILE)}`;
          if (!tiles.has(tk)) tiles.set(tk, { cx: (Math.floor(x / TILE) + 0.5) * TILE, cz: (Math.floor(z / TILE) + 0.5) * TILE, list: [] });
          tiles.get(tk).list.push([x, y, z, yaw, PAINTS[(hh >>> 12) % PAINTS.length]]);
          // solide : boîte englobante de la voiture tournée
          const ex = Math.abs(Math.sin(yaw)) * 2.05 + Math.abs(Math.cos(yaw)) * 0.85;
          const ez = Math.abs(Math.cos(yaw)) * 2.05 + Math.abs(Math.sin(yaw)) * 0.85;
          ctx.colliders.push({ minX: x - ex, maxX: x + ex, minZ: z - ez, maxZ: z + ez, minY: y, maxY: y + 1.35 });
          total++;
        }
      }
    }
  }
  const geo = carGeometry();
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1);
  const Y = new THREE.Vector3(0, 1, 0), col = new THREE.Color();
  const groups = [];
  for (const T of tiles.values()) {
    const im = new THREE.InstancedMesh(geo, mat, T.list.length);
    T.list.forEach(([x, y, z, yaw, paint], i) => {
      im.setMatrixAt(i, m4.compose(v.set(x, y, z), q.setFromAxisAngle(Y, yaw), one));
      im.setColorAt(i, col.setHex(paint));
    });
    im.instanceMatrix.needsUpdate = true;
    im.computeBoundingSphere();
    im.castShadow = true;
    im.receiveShadow = true;
    ctx.scene.add(im);
    groups.push({ cx: T.cx, cz: T.cz, im, shown: true });
  }
  let timer = 0;
  ctx.updatables.push((dt) => {
    timer -= dt;
    if (timer > 0) return;
    timer = 0.5;
    const p = ctx.playerPos?.();
    if (!p) return;
    for (const g of groups) {
      const d2 = (g.cx - p.x) ** 2 + (g.cz - p.z) ** 2;
      const vis = g.shown ? d2 < (SHOW + 60) ** 2 : d2 < SHOW ** 2;
      if (vis !== g.shown) { g.shown = vis; g.im.visible = vis; }
    }
  });
  console.log(`🚗 Voitures garées : ${total}`);
  return { total };
}

// Bellecour (place tournée) : pas de stationnement sur la place elle-même
function insideBelle(ctx, x, z) {
  const B = ctx.bellecourRect, R = ctx.belleRot;
  const bcx = (B.minX + B.maxX) / 2, bcz = (B.minZ + B.maxZ) / 2;
  const c = Math.cos(R.yaw), sn = Math.sin(R.yaw);
  const dx = x - bcx, dz = z - bcz;
  const lx = bcx + dx * c - dz * sn, lz = bcz + dx * sn + dz * c;
  return lx > B.minX && lx < B.maxX && lz > B.minZ && lz < B.maxZ;
}
