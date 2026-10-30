import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { ashlarTexture } from './monuments.js';
import { lyonXZ } from './squares.js';

// LES PENTES (ville OSM, vrai relief) : ce qui fait gravir Lyon à pied.
//   - Escaliers : chaque `highway=steps` OSM (data.steps, tools/fetch-osm.mjs)
//     devient un vrai escalier de pierre posé sur la pente — marches de
//     ~16 cm, paliers, limons et main courante. À défaut (ancien JSON), les
//     tronçons de voies piétonnes très raides en reçoivent un.
//   - Montée de la Grande-Côte : en haut de la montée pavée, le jardin en
//     terrasses (murs de soutènement, pelouses, escalier central) et le
//     balcon-panorama sur la Presqu'île et Fourvière.
// On marche VRAIMENT sur les marches : ctx.terrainHeight renvoie la hauteur
// de la marche dans l'emprise des escaliers et des terrasses (comme le
// tablier des ponts), sans un seul collider de plus.

const RISE = 0.16;      // hauteur de marche (m jeu)
const LANDING = 10;     // un palier toutes les N marches
const STONE = 0xd6cbb4;
const STEP_STONE = 0xc4b9a2;

// Index spatial des emprises praticables (segments épais à hauteur fixe)
function makeIndex() {
  const C = 4, cells = new Map();
  const items = [];
  return {
    add(it) {
      items.push(it);
      const r = it.half + 0.5;
      const x0 = Math.floor((Math.min(it.ax, it.bx) - r) / C), x1 = Math.floor((Math.max(it.ax, it.bx) + r) / C);
      const z0 = Math.floor((Math.min(it.az, it.bz) - r) / C), z1 = Math.floor((Math.max(it.az, it.bz) + r) / C);
      for (let i = x0; i <= x1; i++) {
        for (let j = z0; j <= z1; j++) {
          const k = i + ',' + j;
          if (!cells.has(k)) cells.set(k, []);
          cells.get(k).push(it);
        }
      }
    },
    // hauteur du sol praticable en (x, z), ou null
    at(x, z) {
      const list = cells.get(Math.floor(x / C) + ',' + Math.floor(z / C));
      if (!list) return null;
      let best = null;
      for (const it of list) {
        if (it.rect) {
          if (x >= it.rect[0] && x <= it.rect[1] && z >= it.rect[2] && z <= it.rect[3]) best = Math.max(best ?? -Infinity, it.y);
          continue;
        }
        const ex = it.bx - it.ax, ez = it.bz - it.az;
        const l2 = ex * ex + ez * ez || 1;
        const t = ((x - it.ax) * ex + (z - it.az) * ez) / l2;
        if (t < 0 || t > 1) continue;
        const d = Math.hypot(it.ax + ex * t - x, it.az + ez * t - z);
        if (d <= it.half) best = Math.max(best ?? -Infinity, it.y);
      }
      return best;
    },
    get size() { return items.length; },
  };
}

// Pièce orientée : boîte de longueur `len` le long de (ax, az), largeur w,
// du sol y0 au dessus y1, centrée en (cx, cz)
function slab(len, w, y0, y1, cx, cz, ax, az) {
  const g = new THREE.BoxGeometry(len, Math.max(0.02, y1 - y0), w);
  g.rotateY(-Math.atan2(az, ax));
  g.translate(cx, (y0 + y1) / 2, cz);
  return g;
}

/**
 * Escalier drapé sur la pente le long d'une polyligne [[x, z], …].
 * Remplit `parts` (géométries par matériau) et `idx` (sol praticable).
 * Renvoie { climb, len, top: [x, z] } ou null si la pente est trop douce.
 */
function stairway(ground, pts, width, parts, idx, { minClimb = 0.8, cheeks = true } = {}) {
  // ré-échantillonnage tous les 0,45 m le long du tracé
  const S = [];
  for (let i = 0; i + 1 < pts.length; i++) {
    const [x1, z1] = pts[i], [x2, z2] = pts[i + 1];
    const l = Math.hypot(x2 - x1, z2 - z1);
    const n = Math.max(1, Math.ceil(l / 0.45));
    for (let k = i ? 1 : 0; k <= n; k++) S.push([x1 + ((x2 - x1) * k) / n, z1 + ((z2 - z1) * k) / n]);
  }
  if (S.length < 3) return null;
  let y = S.map(([x, z]) => ground(x, z));
  // on monte toujours : le bas de l'escalier en premier
  if (y[0] > y[y.length - 1]) { S.reverse(); y.reverse(); }
  const climb = y[y.length - 1] - y[0];
  if (climb < minClimb) return null;
  // profil lissé et monotone, jamais SOUS le sol (le lissage creusait les
  // bosses : les marches disparaissaient dans l'herbe) — marge de 15 cm
  // pour le maillage du terrain, plus grossier que la fonction de hauteur
  const raw = y.slice();
  for (let pass = 0; pass < 4; pass++) for (let i = 1; i + 1 < y.length; i++) y[i] = (y[i - 1] + y[i] * 2 + y[i + 1]) / 4;
  for (let i = 0; i < y.length; i++) {
    const [x, z] = S[i];
    y[i] = Math.max(y[i], raw[i], ground(x - 1, z), ground(x + 1, z), ground(x, z - 1), ground(x, z + 1)) + 0.15;
  }
  for (let i = 1; i < y.length; i++) y[i] = Math.max(y[i], y[i - 1]);
  // marches : une contremarche dès que le profil dépasse le niveau courant
  const half = width / 2;
  let level = y[0], start = 0, count = 0;
  const treads = [];
  for (let i = 1; i < S.length; i++) {
    const last = i === S.length - 1;
    if (y[i] - level >= RISE || last) {
      treads.push([start, i, level]);
      const n = Math.max(1, Math.floor((y[i] - level) / RISE));
      level += n * RISE;
      count++;
      // palier : la marche suivante est plus longue (on « saute » un pas)
      start = i;
      if (count % LANDING === 0 && i + 3 < S.length) { i += 2; }
    }
  }
  let len = 0;
  for (const [a, b, lv] of treads) {
    const [xa, za] = S[a], [xb, zb] = S[b];
    const l = Math.hypot(xb - xa, zb - za);
    if (l < 0.05) continue;
    len += l;
    const ax = (xb - xa) / l, az = (zb - za) / l;
    const cx = (xa + xb) / 2, cz = (za + zb) / 2;
    const gLow = Math.min(ground(xa, za), ground(xb, zb), ground(xa - az * half, za + ax * half), ground(xa + az * half, za - ax * half));
    // bloc de la marche (+ nez de marche qui déborde de 3 cm)
    parts.step.push(slab(l + 0.06, width, gLow - 0.5, lv, cx, cz, ax, az));
    idx.add({ ax: xa, az: za, bx: xb, bz: zb, half, y: lv });
  }
  // limons de pierre de part et d'autre : rampants continus (une pièce
  // inclinée toutes les ~8 marches au lieu d'un bloc par marche)
  if (cheeks) {
    for (let t = 0; t < treads.length; t += 8) {
      const a = treads[t], b = treads[Math.min(treads.length - 1, t + 8)];
      const [xa, za] = S[a[0]], [xb, zb] = S[b === a ? a[1] : b[0]];
      const ya = a[2] + 0.45, yb = (b === a ? a[2] : b[2]) + 0.45;
      const l = Math.hypot(xb - xa, zb - za);
      if (l < 0.2) continue;
      const ax = (xb - xa) / l, az = (zb - za) / l;
      const tilt = Math.atan2(yb - ya, l);
      for (const s of [-1, 1]) {
        const ox = -az * s * (half + 0.15), oz = ax * s * (half + 0.15);
        const g = new THREE.BoxGeometry(Math.hypot(l, yb - ya) + 0.3, 1.6, 0.3);
        g.translate(0, -0.8, 0);
        g.rotateZ(tilt);
        g.rotateY(-Math.atan2(az, ax));
        g.translate((xa + xb) / 2 + ox, (ya + yb) / 2, (za + zb) / 2 + oz);
        parts.stone.push(g);
      }
    }
  }
  // main courante continue (tube) sur un côté
  const rail = [];
  for (const [a, , lv] of treads) {
    const [x, z] = S[a];
    rail.push([x, lv + 1.0, z]);
  }
  const [xe, ze] = S[S.length - 1];
  rail.push([xe, level + 1.0, ze]);
  for (let i = 0; i + 1 < rail.length; i += 3) {
    const a = rail[i], b = rail[Math.min(rail.length - 1, i + 3)];
    const d = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    const l = d.length();
    if (l < 0.1) continue;
    const ax = (b[0] - a[0]), az = (b[2] - a[2]), lh = Math.hypot(ax, az) || 1;
    const off = [-az / lh * (half - 0.1), ax / lh * (half - 0.1)];
    const g = new THREE.CylinderGeometry(0.035, 0.035, l, 4, 1, true);
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize()));
    g.translate((a[0] + b[0]) / 2 + off[0], (a[1] + b[1]) / 2, (a[2] + b[2]) / 2 + off[1]);
    parts.iron.push(g);
    if (i % 6 === 0) {
      const post = new THREE.CylinderGeometry(0.03, 0.03, 1.0, 4, 1, true);
      post.translate(a[0] + off[0], a[1] - 0.5, a[2] + off[1]);
      parts.iron.push(post);
    }
  }
  return { climb, len, top: [xe, ze], bottom: S[0] };
}

// Jardin en terrasses en haut de la montée de la Grande-Côte : rect
// [x0, x1] × [z0, z1] (le bas au sud, z1), étagé du bas vers le haut (nord)
function terraceGarden(ground, rect, parts, idx, n = 5) {
  const [x0, x1, z0, z1] = rect;
  const cxm = (x0 + x1) / 2;
  const depth = (z1 - z0) / n;
  let prevTop = null;
  const levels = [];
  for (let k = 0; k < n; k++) {
    // terrasse k : du sud (k = 0, en bas) au nord
    const za = z1 - (k + 1) * depth, zb = z1 - k * depth;
    let top = -Infinity, low = Infinity;
    for (let x = x0; x <= x1; x += 2) {
      for (let z = za; z <= zb; z += 2) {
        const h = ground(x, z);
        top = Math.max(top, h); low = Math.min(low, h);
      }
    }
    top += 0.25; // remblai : la pelouse passe partout au-dessus du sol
    if (prevTop != null) top = Math.max(top, prevTop + 0.6);
    levels.push({ za, zb, top, low });
    // massif de terre + pelouse (bande de gravier au pied du mur suivant)
    parts.lawn.push(slab(x1 - x0 - 3.6, zb - za - 1.6, low - 1, top, cxm, (za + zb) / 2 + 0.3, 1, 0));
    parts.gravel.push(slab(x1 - x0, 1.6, low - 1, top + 0.02, cxm, za + 0.8, 1, 0));
    parts.gravel.push(slab(x1 - x0, zb - za, low - 1.2, top - 0.02, cxm, (za + zb) / 2, 1, 0));
    // mur de soutènement au sud de la terrasse (face à la pente), couronné
    // d'une tablette, et murs latéraux
    const wallBase = prevTop ?? (low - 0.6);
    parts.stone.push(slab(x1 - x0 + 0.6, 0.6, Math.min(wallBase, low) - 1, top + 0.55, cxm, zb, 1, 0));
    parts.cap.push(slab(x1 - x0 + 0.8, 0.8, top + 0.55, top + 0.68, cxm, zb, 1, 0));
    for (const xs of [x0, x1]) parts.stone.push(slab(zb - za, 0.6, low - 1, top + 0.4, xs, (za + zb) / 2, 0, 1));
    idx.add({ rect: [x0, x1, za, zb], ax: x0, az: za, bx: x1, bz: zb, half: 0, y: top });
    prevTop = top;
  }
  return levels;
}

// Pentes de la ville OSM. À appeler APRÈS le maillage du sol, les rues et
// les bâtiments (colliders), avant les arbres.
export function buildPentes(ctx, data) {
  if (!ctx.hasRelief) return;
  const natural = ctx.terrainHeight;
  const ground = (x, z) => Math.max(0, natural(x, z));
  const idx = makeIndex();
  const parts = { step: [], stone: [], cap: [], iron: [], lawn: [], gravel: [], wall: [] };
  const scale = data.scale ?? 0.5;

  // --- Montée de la Grande-Côte : jardin en terrasses + panorama
  const gc = ctx.grandeCote;
  if (gc) {
    const [x0, x1, z0, z1] = gc.rect;
    const levels = terraceGarden(ground, gc.rect, parts, idx);
    // escalier central qui relie les terrasses (une volée par mur)
    const xm = (x0 + x1) / 2;
    for (let k = 0; k < levels.length; k++) {
      const L = levels[k], below = k ? levels[k - 1].top : ground(xm, z1 + 2);
      const n = Math.max(2, Math.ceil((L.top - below) / RISE));
      const run = n * 0.34;
      for (let i = 0; i < n; i++) {
        const y = below + ((i + 1) * (L.top - below)) / n;
        const za = L.zb + run - (i + 1) * 0.34, zb = L.zb + run - i * 0.34;
        parts.step.push(slab(3.2, zb - za + 0.04, Math.min(below, L.low) - 1, y, xm, (za + zb) / 2, 1, 0));
        idx.add({ rect: [xm - 1.6, xm + 1.6, za, zb], ax: xm, az: za, bx: xm, bz: zb, half: 0, y });
      }
    }
    // balcon-panorama au sommet : dallage, balustrade face au sud
    const top = levels[levels.length - 1].top;
    for (let x = x0 + 0.6; x <= x1 - 0.6; x += 0.45) {
      const b = new THREE.CylinderGeometry(0.07, 0.09, 0.62, 6);
      b.translate(x, top + 0.31 + 0.55, levels[levels.length - 1].zb - 0.1);
      parts.cap.push(b);
    }
    parts.cap.push(slab(x1 - x0, 0.3, top + 1.17, top + 1.29, xm, levels[levels.length - 1].zb - 0.1, 1, 0));
    // table d'orientation au centre du belvédère
    const tz = (levels[levels.length - 1].za + levels[levels.length - 1].zb) / 2;
    const ped = new THREE.CylinderGeometry(0.45, 0.6, 1.0, 10);
    ped.translate(xm, top + 0.5, tz);
    parts.stone.push(ped);
    const tab = new THREE.CylinderGeometry(0.8, 0.8, 0.08, 20);
    tab.rotateX(-0.35);
    tab.translate(xm, top + 1.05, tz);
    parts.iron.push(tab);
    ctx.pois?.push({ id: 'grande-cote', nom: 'Montée de la Grande-Côte (panorama)', emoji: '🌄', x: xm, z: tz });
    ctx.interactables?.push({
      x: xm, z: tz, r: 2.5, label: 'E — Table d\'orientation',
      action: () => ctx.notify?.('🌄 Face à toi : la Presqu\'île, Fourvière et sa basilique, et par beau temps le Mont Blanc. Les canuts montaient ça tous les jours, gone !'),
    });
  }

  // --- Escaliers OSM (ou, à défaut, voies piétonnes très raides)
  const named = new Set();
  let nStairs = 0;
  const stairsSrc = Array.isArray(data.steps) && data.steps.length
    ? data.steps.map((s) => ({ p: s.p, w: Math.max(2, Math.min(5, s.w ?? 2.4)), n: s.n }))
    : data.roads.filter((r) => r.w === 4.5).map((r) => ({ p: r.p, w: 3.2, steepOnly: true }));
  const inGarden = (x, z) => gc && x > gc.rect[0] - 2 && x < gc.rect[1] + 2 && z > gc.rect[2] - 2 && z < gc.rect[3] + 2;
  for (const st of stairsSrc) {
    const pts = [];
    for (let i = 0; i + 1 < st.p.length; i += 2) pts.push([st.p[i], st.p[i + 1]]);
    if (pts.length < 2 || pts.some(([x, z]) => inGarden(x, z))) continue;
    // voies piétonnes : seulement les tronçons à plus de 18 % de pente
    const runs = [];
    if (st.steepOnly) {
      let cur = [];
      for (let i = 0; i + 1 < pts.length; i++) {
        const [xa, za] = pts[i], [xb, zb] = pts[i + 1];
        const l = Math.hypot(xb - xa, zb - za);
        const steep = l > 2 && Math.abs(ground(xb, zb) - ground(xa, za)) / l > 0.18;
        if (steep) { if (!cur.length) cur.push(pts[i]); cur.push(pts[i + 1]); }
        else if (cur.length) { runs.push(cur); cur = []; }
      }
      if (cur.length) runs.push(cur);
    } else runs.push(pts);
    for (const run of runs) {
      if (run.some(([x, z]) => ctx.waterMask?.isWater(x, z) || ctx.theatre?.covers(x, z))) continue;
      const r = stairway(ground, run, st.w, parts, idx, { minClimb: st.steepOnly ? 1.2 : 0.5 });
      if (!r) continue;
      nStairs++;
      // sur la carte : les montées et traboules seulement (une notification
      // par escalier nommé noyait l'écran en traversant les pentes)
      if (st.n && !named.has(st.n) && /^(mont[ée]e|.*traboule)/i.test(st.n) && r.climb > 2) {
        named.add(st.n);
        ctx.pois?.push({ id: 'escalier-' + st.n.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\W+/g, '-'), nom: st.n, emoji: '🪜', x: r.bottom[0], z: r.bottom[1] });
      }
    }
  }

  // --- Maillages (un par matériau)
  const stoneTex = ashlarTexture();
  const mats = {
    step: new THREE.MeshLambertMaterial({ color: STEP_STONE, map: stoneTex }),
    stone: new THREE.MeshLambertMaterial({ color: STONE, map: stoneTex }),
    wall: new THREE.MeshLambertMaterial({ color: 0xc9bda3, map: stoneTex }),
    cap: new THREE.MeshLambertMaterial({ color: 0xe6dcc6 }),
    iron: new THREE.MeshStandardMaterial({ color: 0x2b2f33, metalness: 0.7, roughness: 0.45 }),
    lawn: new THREE.MeshLambertMaterial({ color: 0x5a8a45 }),
    gravel: new THREE.MeshLambertMaterial({ color: 0xc9bfa6 }),
  };
  mats.lawn.userData.noSeason = true;
  for (const [key, geos] of Object.entries(parts)) {
    if (!geos.length) continue;
    const prepared = geos.map((g) => {
      const ng = g.index ? g.toNonIndexed() : g;
      for (const k of Object.keys(ng.attributes)) if (k !== 'position' && k !== 'normal') ng.deleteAttribute(k);
      return ng;
    });
    const geo = mergeGeometries(prepared);
    // UV en mètres projetées selon la face (pierre de taille à l'échelle)
    const p = geo.attributes.position, nrm = geo.attributes.normal;
    const uv = new Float32Array(p.count * 2);
    for (let i = 0; i < p.count; i++) {
      const nx = Math.abs(nrm.getX(i)), ny = Math.abs(nrm.getY(i)), nz = Math.abs(nrm.getZ(i));
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      if (ny > 0.7) { uv[i * 2] = x / 3; uv[i * 2 + 1] = z / 3; }
      else if (nx > nz) { uv[i * 2] = z / 3; uv[i * 2 + 1] = y / 3; }
      else { uv[i * 2] = x / 3; uv[i * 2 + 1] = y / 3; }
    }
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    const mesh = new THREE.Mesh(geo, mats[key]);
    mesh.castShadow = key !== 'lawn' && key !== 'gravel';
    mesh.receiveShadow = true;
    mesh.name = 'pentes-' + key;
    ctx.scene.add(mesh);
  }

  // --- On marche sur les marches et les terrasses
  ctx.pentesCovers = (x, z) => idx.at(x, z) != null;
  if (idx.size) {
    ctx.terrainHeight = (x, z) => {
      const h = idx.at(x, z);
      return h ?? natural(x, z);
    };
  }
  ctx.pentesStats = { stairs: nStairs, named: named.size, walls: parts.wall.length };
  return ctx.pentesStats;
}

// Emprise du jardin de la Grande-Côte (à réserver AVANT les bâtiments OSM) :
// en haut de la montée, entre la montée pavée et la rue transversale
export function planGrandeCote(scale = 0.5) {
  const [x, z] = lyonXZ(45.77245, 4.83246, scale); // milieu du jardin
  const rect = [x - 15, x + 15, z - 24, z + 26];
  return { rect, reserve: { minX: rect[0] - 1, maxX: rect[1] + 1, minZ: rect[2] - 1, maxZ: rect[3] + 1 } };
}
