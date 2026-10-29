import * as THREE from 'three';
import { roadHalf } from './roadfit.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { makeRand } from './layout.js';
import { ashlarTexture } from './monuments.js';

// JARDINS DES COLLINES (ville OSM, vrai relief) : sur les plateaux de
// Saint-Just, Saint-Irénée, Fourvière, Sainte-Foy ou la Croix-Rousse, les
// immeubles sont espacés et, entre eux, il ne restait qu'un sol uni. En vrai
// ce sont des jardins clos : murs de pierre dorée le long des montées, haies
// taillées, cyprès, fruitiers, massifs. On les reconstitue :
//   - grille d'occupation à 2 m (bâtiments OSM + rues et trottoirs) ;
//   - clôtures le long des rues, côté jardin : mur de pierre à chaperon,
//     muret surmonté d'une haie, ou haie seule — un style par tronçon de
//     rue (hash), portails de loin en loin ; colliders comme les murs ;
//   - massifs d'arbustes et cyprès en InstancedMesh (2 draw calls) ;
//   - ctx.gardenAt(x, z) : buildGreenery y plante les arbres plus serrés.
// Générateur dédié (seed fixe) : la séquence partagée ne bouge pas.

const RES = 2;          // pas de la grille d'occupation (m jeu)
const MIN_H = 6;        // au-dessus : colline (la plaine garde ses cours)
const SIDE = 1.7;       // trottoir : la clôture est à demi-chaussée + SIDE

// Grille d'occupation : 0 libre, 1 bâti, 2 rue/trottoir
function occupancy(data, bound) {
  const n = Math.ceil((2 * bound) / RES);
  const g = new Uint8Array(n * n);
  const ci = (x) => Math.floor((x + bound) / RES);
  for (const b of data.buildings) {
    const p = b.p;
    let z0 = Infinity, z1 = -Infinity;
    for (let i = 1; i < p.length; i += 2) { z0 = Math.min(z0, p[i]); z1 = Math.max(z1, p[i]); }
    for (let r = Math.max(0, ci(z0)); r <= Math.min(n - 1, ci(z1)); r++) {
      const z = -bound + (r + 0.5) * RES;
      const xs = [];
      for (let i = 0, j = p.length - 2; i < p.length; j = i, i += 2) {
        const za = p[j + 1], zb = p[i + 1];
        if ((za <= z && zb > z) || (zb <= z && za > z)) xs.push(p[j] + ((p[i] - p[j]) * (z - za)) / (zb - za));
      }
      xs.sort((a, c) => a - c);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        // +1 maille autour : la clôture ne vient pas coller les façades
        for (let c = Math.max(0, ci(xs[k]) - 1); c <= Math.min(n - 1, ci(xs[k + 1]) + 1); c++) g[r * n + c] = 1;
      }
    }
  }
  for (const road of data.roads) {
    const r = roadHalf(road) + SIDE - 0.2;
    for (let i = 0; i + 3 < road.p.length; i += 2) {
      const x1 = road.p[i], z1 = road.p[i + 1], x2 = road.p[i + 2], z2 = road.p[i + 3];
      const len = Math.hypot(x2 - x1, z2 - z1), k = Math.max(1, Math.ceil(len / 1));
      for (let t = 0; t <= k; t++) {
        const x = x1 + ((x2 - x1) * t) / k, z = z1 + ((z2 - z1) * t) / k;
        for (let dx = -r; dx <= r; dx += RES) {
          for (let dz = -r; dz <= r; dz += RES) {
            if (dx * dx + dz * dz > r * r) continue;
            const c = ci(x + dx), rr = ci(z + dz);
            if (c >= 0 && rr >= 0 && c < n && rr < n && g[rr * n + c] === 0) g[rr * n + c] = 2;
          }
        }
      }
    }
  }
  return {
    n,
    cell: (x, z) => { const c = ci(x), r = ci(z); return c < 0 || r < 0 || c >= n || r >= n ? -1 : r * n + c; },
    at(x, z) {
      const c = ci(x), r = ci(z);
      return c < 0 || r < 0 || c >= n || r >= n ? 1 : g[r * n + c];
    },
  };
}

function slab(len, w, y0, y1, cx, cz, ax, az) {
  const g = new THREE.BoxGeometry(len, Math.max(0.02, y1 - y0), w);
  g.rotateY(-Math.atan2(az, ax));
  g.translate(cx, (y0 + y1) / 2, cz);
  return g;
}

function hash(a, b) {
  return (((Math.floor(a) * 73856093) ^ (Math.floor(b) * 19349663)) >>> 0) % 1000 / 1000;
}

// Couleur de sol d'un jardin (terrain des collines, world/cityReal.js) :
// parcelles de ~16 m, pelouses plus ou moins vertes, potagers ocre
export function gardenTint(color, x, z) {
  const h = hash(x / 16, z / 16);
  if (h < 0.12) color.offsetHSL(-0.04, -0.05, 0.03); // potager / terre
  else color.offsetHSL((h - 0.5) * 0.03, -0.04, (h - 0.5) * 0.07);
  return color;
}

export function buildJardins(ctx, data) {
  if (!ctx.hasRelief) return null;
  const bound = ctx.worldBound;
  const H = (x, z) => Math.max(0, ctx.terrainHeight(x, z));
  const occ = occupancy(data, bound + 20);
  const blocked = (x, z) => ctx.waterMask?.isWater(x, z) || ctx.theatre?.covers(x, z) ||
    ctx.pentesCovers?.(x, z) ||
    (ctx.parkRects ?? []).some((r) => x > r.minX && x < r.maxX && z > r.minZ && z < r.maxZ) ||
    (ctx.reservedAt?.(x, z) ?? false);
  const slope = (x, z) => Math.hypot(H(x + 3, z) - H(x - 3, z), H(x, z + 3) - H(x, z - 3)) / 6;
  // Jardin : sol libre de la colline, pas trop raide (les balmes restent
  // des bois sauvages, voir buildGreenery)
  const gardenRaw = (x, z) => occ.at(x, z) === 0 && H(x, z) > MIN_H && slope(x, z) < 0.35 && !blocked(x, z);
  // mémoïsé à la maille de 2 m (appelé ~10⁶ fois : clôtures, massifs, sol,
  // arbres de buildGreenery)
  const memo = new Int8Array(occ.n * occ.n).fill(-1);
  const gardenAt = (x, z) => {
    const k = occ.cell(x, z);
    if (k < 0) return false;
    if (memo[k] < 0) memo[k] = gardenRaw(x, z) ? 1 : 0;
    return memo[k] === 1;
  };
  ctx.gardenAt = gardenAt;
  const rand = makeRand(9311);
  const parts = { wall: [], cap: [], hedge: [], gate: [] };
  let nWalls = 0;

  // --- Clôtures le long des rues
  for (const road of data.roads) {
    if (road.w < 4.5) continue; // les ruelles pavées passent entre les murs déjà
    const off = roadHalf(road) + SIDE;
    let acc = 0;
    for (let i = 0; i + 3 < road.p.length; i += 2) {
      const x1 = road.p[i], z1 = road.p[i + 1], x2 = road.p[i + 2], z2 = road.p[i + 3];
      const len = Math.hypot(x2 - x1, z2 - z1);
      if (len < 1) continue;
      const ax = (x2 - x1) / len, az = (z2 - z1) / len;
      // un style par tronçon de rue et par côté
      const k = Math.ceil(len / 3);
      for (let t = 0; t < k; t++, acc++) {
        const s0 = (len * t) / k, s1 = (len * (t + 1)) / k;
        const mx = x1 + (ax * (s0 + s1)) / 2, mz = z1 + (az * (s0 + s1)) / 2;
        if (H(mx, mz) < MIN_H) continue;
        for (const s of [-1, 1]) {
          const ex = mx - az * s * off, ez = mz + ax * s * off;
          // derrière la clôture, il faut un vrai jardin (2 et 5 m plus loin)
          const bx = ex - az * s * 2.5, bz = ez + ax * s * 2.5;
          const cx2 = ex - az * s * 5, cz2 = ez + ax * s * 5;
          if (occ.at(ex, ez) === 1 || !gardenAt(bx, bz) || !gardenAt(cx2, cz2)) continue;
          // portail : une ouverture de loin en loin
          if (hash(acc * 7 + (s > 0 ? 3 : 0), i * 13 + road.p.length) < 0.06) {
            const y = H(ex, ez);
            for (const d of [-1, 1]) {
              const px = ex + ax * d * (s1 - s0) * 0.5, pz = ez + az * d * (s1 - s0) * 0.5;
              parts.wall.push(slab(0.5, 0.5, y - 0.4, y + 2.1, px, pz, ax, az));
              parts.cap.push(slab(0.62, 0.62, y + 2.1, y + 2.25, px, pz, ax, az));
            }
            parts.gate.push(slab((s1 - s0) - 0.5, 0.06, y + 0.1, y + 1.7, ex, ez, ax, az));
            continue;
          }
          const style = hash(Math.floor((i + acc * 0.02) / 3) * 7 + (s > 0 ? 3 : 0), road.p[0] * 0.1);
          const y0 = Math.min(H(x1 - az * s * off, z1 + ax * s * off), H(ex, ez)) - 0.5;
          const y = H(ex, ez);
          const L = s1 - s0 + 0.04;
          if (style < 0.45) {
            // mur de pierre dorée à chaperon
            parts.wall.push(slab(L, 0.45, y0, y + 1.7, ex, ez, ax, az));
            parts.cap.push(slab(L, 0.6, y + 1.7, y + 1.84, ex, ez, ax, az));
          } else if (style < 0.8) {
            // muret + haie taillée par-dessus
            parts.wall.push(slab(L, 0.45, y0, y + 0.7, ex, ez, ax, az));
            parts.cap.push(slab(L, 0.55, y + 0.7, y + 0.8, ex, ez, ax, az));
            parts.hedge.push(slab(L, 0.8, y + 0.8, y + 1.9 + hash(acc, 3) * 0.2, ex - az * s * 0.35, ez + ax * s * 0.35, ax, az));
          } else {
            // haie seule, plus épaisse
            parts.hedge.push(slab(L, 1.1, y0 + 0.4, y + 1.8, ex - az * s * 0.25, ez + ax * s * 0.25, ax, az));
          }
          // collider (comme les murs de la ville)
          const hx = Math.abs(ax) * L / 2 + Math.abs(az) * 0.4, hz = Math.abs(az) * L / 2 + Math.abs(ax) * 0.4;
          ctx.colliders.push({ minX: ex - hx, maxX: ex + hx, minZ: ez - hz, maxZ: ez + hz, minY: y0, maxY: y + 1.8 });
          nWalls++;
        }
      }
    }
  }

  // --- Massifs d'arbustes et cyprès dans les jardins (grille + jitter)
  const shrubs = [], cypress = [];
  const lim = bound - 10, STEP = 4;
  // la plaine est écartée d'emblée par blocs de 16 m (5 sondes de relief
  // par bloc au lieu d'une par point de la grille)
  const B = 16, nb = Math.ceil((2 * lim) / B) + 1;
  const hill = new Uint8Array(nb * nb);
  for (let j = 0; j < nb; j++) {
    for (let i = 0; i < nb; i++) {
      const x = -lim + i * B, z = -lim + j * B;
      hill[j * nb + i] = [[0, 0], [B, 0], [0, B], [B, B], [B / 2, B / 2]].some(([dx, dz]) => H(x + dx, z + dz) > MIN_H - 3) ? 1 : 0;
    }
  }
  for (let gz = -lim; gz < lim; gz += STEP) {
    for (let gx = -lim; gx < lim; gx += STEP) {
      if (!hill[Math.floor((gz + lim) / B) * nb + Math.floor((gx + lim) / B)]) continue;
      const x = gx + (rand() - 0.5) * STEP, z = gz + (rand() - 0.5) * STEP;
      const pick = rand(), sz = rand();
      if (pick > 0.45) continue;
      if (!gardenAt(x, z)) continue;
      // pas en bordure immédiate d'une rue (la clôture y est)
      if (occ.at(x + 2, z) === 2 || occ.at(x - 2, z) === 2 || occ.at(x, z + 2) === 2 || occ.at(x, z - 2) === 2) continue;
      if (pick < 0.05) cypress.push([x, z, H(x, z), 0.8 + sz * 0.5]);
      else shrubs.push([x, z, H(x, z), 0.6 + sz * 0.9, rand()]);
    }
  }
  // plafonds (perf mobile), le cœur de la ville d'abord : Saint-Just,
  // Fourvière et la Croix-Rousse avant les confins de la carte
  const CAP_SHRUB = 8000, CAP_CYP = 1400;
  const core = (t) => Math.hypot(t[0] + 250, t[1] + 200) < 800;
  const keepOf = (arr, cap) => {
    const nc = arr.filter(core).length;
    const kc = Math.min(1, (cap * 0.8) / Math.max(1, nc));
    const ko = Math.min(1, (cap - Math.min(nc, cap * 0.8)) / Math.max(1, arr.length - nc));
    return (t) => (core(t) ? kc : ko);
  };
  const keepS = keepOf(shrubs, CAP_SHRUB), keepC = keepOf(cypress, CAP_CYP);

  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), v = new THREE.Vector3();
  const UP = new THREE.Vector3(0, 1, 0);
  const col = new THREE.Color();
  // arbuste : icosaèdre aplati, teinte par instance
  const shrubGeo = new THREE.IcosahedronGeometry(1, 0);
  shrubGeo.scale(1, 0.75, 1);
  shrubGeo.translate(0, 0.55, 0);
  const shrubMat = new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true });
  const sel = shrubs.filter((t) => rand() < keepS(t));
  const shrubMesh = new THREE.InstancedMesh(shrubGeo, shrubMat, Math.max(1, sel.length));
  sel.forEach(([x, z, y, s, hue], i) => {
    q.setFromAxisAngle(UP, hue * 6.28);
    sc.set(s * (0.9 + hue * 0.5), s, s * (1.3 - hue * 0.4));
    m.compose(v.set(x, y - 0.1, z), q, sc);
    shrubMesh.setMatrixAt(i, m);
    // vert bouteille → vert tendre, quelques massifs fleuris (lavande, rosiers)
    // (teintes données en sRGB : en linéaire elles sortaient vert menthe)
    if (hue > 0.93) col.setHSL(0.76, 0.3, 0.5, THREE.SRGBColorSpace);
    else if (hue > 0.88) col.setHSL(0.97, 0.4, 0.55, THREE.SRGBColorSpace);
    else col.setHSL(0.25 + hue * 0.08, 0.38, 0.2 + hue * 0.12, THREE.SRGBColorSpace);
    shrubMesh.setColorAt(i, col);
  });
  shrubMesh.count = sel.length;
  shrubMesh.castShadow = true;
  shrubMesh.receiveShadow = true;
  shrubMesh.name = 'jardins-arbustes';
  shrubMesh.frustumCulled = false; // instances sur toute la carte
  ctx.scene.add(shrubMesh);

  // cyprès : fuseau sombre (la silhouette des jardins de Fourvière)
  // fuseau tourné : renflé au premier tiers, pointe effilée
  const cypGeo = new THREE.LatheGeometry([
    [0, 0], [0.32, 0.03], [0.48, 0.2], [0.46, 0.45], [0.32, 0.72], [0.12, 0.93], [0, 1],
  ].map(([r, y]) => new THREE.Vector2(r, y)), 7);
  const cypMat = new THREE.MeshLambertMaterial({ color: 0x2a4a2a });
  const selC = cypress.filter((t) => rand() < keepC(t));
  const cypMesh = new THREE.InstancedMesh(cypGeo, cypMat, Math.max(1, selC.length));
  selC.forEach(([x, z, y, s], i) => {
    m.compose(v.set(x, y - 0.2, z), q.identity(), sc.set(1.3 * s, 9 * s, 1.3 * s));
    cypMesh.setMatrixAt(i, m);
  });
  cypMesh.count = selC.length;
  cypMesh.castShadow = true;
  cypMesh.name = 'jardins-cypres';
  cypMesh.frustumCulled = false;
  ctx.scene.add(cypMesh);
  // persistants (buis, lauriers, cyprès) : seasons.js ne les rousit pas
  for (const mat of [shrubMat, cypMat]) mat.userData.noSeason = true;

  // --- Clôtures : un maillage par matériau
  const stoneTex = ashlarTexture();
  const mats = {
    wall: new THREE.MeshLambertMaterial({ color: 0xe0b77a, map: stoneTex }), // pierre dorée
    cap: new THREE.MeshLambertMaterial({ color: 0xd8cbb0 }),
    hedge: new THREE.MeshLambertMaterial({ color: 0x3f6a34 }),
    gate: new THREE.MeshStandardMaterial({ color: 0x24302a, metalness: 0.6, roughness: 0.5 }),
  };
  mats.hedge.userData.noSeason = true;
  for (const [key, geos] of Object.entries(parts)) {
    if (!geos.length) continue;
    const geo = mergeGeometries(geos.map((g) => {
      const ng = g.index ? g.toNonIndexed() : g;
      for (const a of Object.keys(ng.attributes)) if (a !== 'position' && a !== 'normal') ng.deleteAttribute(a);
      return ng;
    }));
    const p = geo.attributes.position, nrm = geo.attributes.normal;
    const uv = new Float32Array(p.count * 2);
    for (let i = 0; i < p.count; i++) {
      const nx = Math.abs(nrm.getX(i)), ny = Math.abs(nrm.getY(i)), nz = Math.abs(nrm.getZ(i));
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      if (ny > 0.7) { uv[i * 2] = x / 3; uv[i * 2 + 1] = z / 3; } else if (nx > nz) { uv[i * 2] = z / 3; uv[i * 2 + 1] = y / 3; } else { uv[i * 2] = x / 3; uv[i * 2 + 1] = y / 3; }
    }
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    const mesh = new THREE.Mesh(geo, mats[key]);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.name = 'jardins-' + key;
    ctx.scene.add(mesh);
  }
  // --- Sol des jardins : le terrain des collines (sommets tous les ~10 m)
  // passe en pelouses, parcelle par parcelle, là où il n'y a ni bâti ni rue
  let lawns = 0;
  const tm = ctx.terrainMesh;
  if (tm) {
    const p = tm.geometry.attributes.position, colA = tm.geometry.attributes.color;
    const lawn = new THREE.Color(0x4f7a3e), c0 = new THREE.Color();
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), z = p.getZ(i);
      if (Math.abs(x) > bound || Math.abs(z) > bound || p.getY(i) < MIN_H) continue;
      // au moins 4 sondes sur 5 en jardin autour du sommet
      let ok = 0;
      for (const [dx, dz] of [[0, 0], [3, 0], [-3, 0], [0, 3], [0, -3]]) if (gardenAt(x + dx, z + dz)) ok++;
      if (ok < 4) continue;
      c0.copy(lawn);
      gardenTint(c0, x, z);
      colA.setXYZ(i, c0.r, c0.g, c0.b);
      lawns++;
    }
    colA.needsUpdate = true;
  }
  ctx.jardinsStats = { clotures: nWalls, arbustes: sel.length, cypres: selC.length, pelouses: lawns };
  return ctx.jardinsStats;
}
