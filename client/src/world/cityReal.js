import * as THREE from 'three';
import { addInvisibleWall } from './utils.js';
import { ARCADE, RANGE, MUR_PEINT, BELLECOUR, makeRand } from './layout.js';
import {
  makeSkylineTexture, buildBellecour,
  buildGrandeRoue, buildFountain, buildStreetFurniture, buildMurPeint,
  buildPeniches, buildSilure, buildFourviere, buildLamps, buildTraboules,
  buildRiverWorks, composeRiverTerrain,
} from './city.js';
import { buildTraffic } from './traffic.js';

// Construit le vrai centre de Lyon à partir des empreintes OpenStreetMap
// (client/public/lyon-osm.json, généré par tools/fetch-osm.mjs).
// Toute la géométrie est fusionnée en tuiles de 80 m : quelques dizaines de
// draw calls pour des milliers de bâtiments, frustum culling gratuit.

const TILE = 80;
const FLOOR_M = 3; // hauteur d'étage pour le calage de la texture fenêtres

const WALL_TINTS = ['#e8ddc8', '#e3d4ba', '#d9c6a8', '#e6d9c4', '#dccab0', '#d5c0a0', '#efe6d4', '#cdb695'];
const ROOF_TINTS = ['#a8543c', '#b05a40', '#9c4e38', '#b46248', '#7e8696', '#6d7585', '#a8543c', '#b05a40'];

// Emprise de la colline de Fourvière et des fleuves (fixées par
// buildRealCity) : les bâtiments et la verdure OSM n'y poussent pas.
let HILL_RECT = null;
let WATER_RECTS = [];

export function buildRealCity(ctx, data) {
  const bound = data.bound;
  ctx.worldBound = bound;
  ctx.waterBands = data.water;
  ctx.osmScale = data.scale ?? 0.5;
  const rand = makeRand(7);

  // Fourvière jouable : collée à l'ouest de la bande d'eau la plus à l'ouest
  // (la Saône), le pied de la colline s'arrête ~22 m avant le quai.
  const west = [...data.water].sort((a, b) => a.minX - b.minX)[0];
  const hillDef = {
    cx: (west ? west.minX : -bound) - 112,
    cz: -20, cy: -4, rx: 90, ry: 38.5, rz: 110,
  };
  HILL_RECT = {
    minX: hillDef.cx - hillDef.rx - 4, maxX: hillDef.cx + hillDef.rx + 6,
    minZ: hillDef.cz - hillDef.rz, maxZ: hillDef.cz + hillDef.rz,
  };
  // Aucun bâtiment sur l'eau NI sur les avenues des quais (± 18 m)
  WATER_RECTS = data.water.map((w) => ({
    minX: w.minX - 18, maxX: w.maxX + 18, minZ: -bound - 200, maxZ: bound + 200,
  }));
  const WEST = Math.min(-(bound + 2), hillDef.cx - hillDef.rx - 12);
  const EAST = bound + 2;

  buildGround(ctx, Math.max(bound, -WEST), data.water);
  buildWater(ctx, data.water, bound);
  buildOsmBuildings(ctx, data, rand);
  buildOsmRoads(ctx, data);
  buildGreenery(ctx, data, rand);

  // Lieux de gameplay (zones déjà déblayées des bâtiments OSM)
  buildBellecour(ctx);
  buildMurPeint(ctx);
  buildGrandeRoue(ctx);
  buildFountain(ctx);
  buildStreetFurniture(ctx);
  buildPeniches(ctx, data.water);
  // Le silure remonte le plus large des fleuves (le Rhône)
  const widest = [...data.water].sort((a, b) => (b.maxX - b.minX) - (a.maxX - a.minX))[0];
  if (widest) buildSilure(ctx, widest);

  // Fourvière complète (colline grimpable, basilique, ficelle) + lampadaires
  // + traboules — partagés avec la ville procédurale
  buildFourviere(ctx, hillDef);
  buildLamps(ctx, lampSpotsOsm(ctx, data));
  buildTraboules(ctx, osmTraboules(ctx, hillDef));
  buildTraffic(ctx, data.water);
  // Le lit des fleuves devient le sol quand on tombe à l'eau
  composeRiverTerrain(ctx, data.water);

  // Décor hors zone : le Crayon à l'est
  buildFarLandmarks(ctx, bound);

  for (const [x, z, w, d] of [
    [(WEST + EAST) / 2, -bound - 2, EAST - WEST + 8, 4],
    [(WEST + EAST) / 2, bound + 2, EAST - WEST + 8, 4],
    [WEST, 0, 4, bound * 2 + 20],
    [EAST, 0, 4, bound * 2 + 20],
  ]) {
    addInvisibleWall(ctx, { x, z, w, d, h: 80 });
  }
}

// Lampadaires du mode OSM : quais des deux fleuves, tour de Bellecour, et un
// échantillon des grands axes routiers.
function lampSpotsOsm(ctx, data) {
  const spots = [];
  for (const band of data.water) {
    for (const x of [band.minX - 6.5, band.maxX + 6.5]) {
      for (let z = -ctx.worldBound + 12; z < ctx.worldBound - 12; z += 24) {
        if (Math.abs(z) < 6) continue;
        spots.push([x, z]);
      }
    }
  }
  for (let i = 0; i < 8; i++) {
    const x = BELLECOUR.minX + 6 + i * 8.2;
    spots.push([x, BELLECOUR.minZ + 1.5], [x, BELLECOUR.maxZ - 1.5]);
  }
  const inWater = (x) => data.water.some((w) => x > w.minX - 4 && x < w.maxX + 4);
  let done = false;
  for (const road of data.roads) {
    if (done) break;
    if (road.w < 6) continue; // seulement les grands axes
    for (let i = 0; i + 1 < road.p.length; i += 20) {
      const x = road.p[i], z = road.p[i + 1];
      if (inWater(x) || Math.abs(x) > ctx.worldBound - 6 || Math.abs(z) > ctx.worldBound - 6) continue;
      spots.push([x + road.w / 2 + 1.5, z]);
      if (spots.length > 220) { done = true; break; }
    }
  }
  return spots;
}

// Traboules du mode OSM : uniquement des points sûrs (zones réservées),
// puisque les bâtiments OSM peuvent pousser n'importe où ailleurs.
function osmTraboules(ctx, hillDef) {
  const hx = hillDef.cx + 23, hz = hillDef.cz + 9;
  const hy = Math.max(0, ctx.terrainHeight?.(hx, hz) ?? 0);
  return [
    {
      a: { x: -38, z: 6, ry: Math.PI / 2 },
      b: { x: -30, z: -118, ry: 0 },
      loreAB: '🚪 Tu as traboulé jusqu’aux pentes ! Les canuts passaient par là.',
      loreBA: '🚪 Retour à Bellecour par la traboule des canuts.',
    },
    {
      a: { x: hillDef.cx + hillDef.rx + 2, z: hillDef.cz + 16, ry: Math.PI / 2 },
      b: { x: hx, z: hz, ry: Math.PI / 2, y: hy },
      loreAB: '🚪 La ficelle des pauvres : cette traboule grimpe à Fourvière !',
      loreBA: '🚪 Descente express : te voilà au pied de la colline.',
    },
    {
      a: { x: 52, z: 100, ry: Math.PI },
      // Flanc droit de la salle d'arcade (côté est), pas devant la porte
      b: { x: 13, z: -70, ry: Math.PI / 2 },
      loreAB: '🚪 Raccourci de gone : du stand de tir à la salle d’arcade.',
      loreBA: '🚪 Sortie secrète de l’arcade, côté stand de tir.',
    },
  ];
}

// Sol en bandes : les fleuves sont creusés (l'eau coule en contrebas)
function buildGround(ctx, bound, bands) {
  const size = bound * 2 + 400;
  const edges = [...bands].sort((a, b) => a.minX - b.minX);
  const xs = [-size / 2];
  for (const b of edges) xs.push(b.minX, b.maxX);
  xs.push(size / 2);
  const mat = new THREE.MeshLambertMaterial({ color: 0x4a505d });
  for (let i = 0; i < xs.length; i += 2) {
    const x0 = xs[i], x1 = xs[i + 1];
    if (x1 - x0 < 1) continue;
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0, size), mat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.set((x0 + x1) / 2, 0, 0);
    ctx.scene.add(ground);
  }
}

function buildWater(ctx, bands, bound) {
  for (const band of bands) {
    // Ponts : un au centre, deux autres à mi-chemin des bords
    const bz = Math.round(bound * 0.55);
    buildRiverWorks(ctx, band, {
      halfLength: bound + 100,
      bridgesZ: [0, bz, -bz],
      parapetHalf: bound,
    });
    for (const x of [band.minX - 2.5, band.maxX + 2.5]) {
      const quay = new THREE.Mesh(
        new THREE.PlaneGeometry(5, bound * 2 + 200),
        new THREE.MeshLambertMaterial({ color: 0x8d8676 })
      );
      quay.rotation.x = -Math.PI / 2;
      quay.position.set(x, 0.018, 0);
      ctx.scene.add(quay);
    }
  }
}

// Zones réservées au gameplay : on retire les bâtiments OSM qui les chevauchent
function reservedRects() {
  const rects = [
    { minX: BELLECOUR.minX - 2, maxX: BELLECOUR.maxX + 2, minZ: BELLECOUR.minZ - 2, maxZ: BELLECOUR.maxZ + 2 },
    { minX: ARCADE.x - ARCADE.w / 2 - 9, maxX: ARCADE.x + ARCADE.w / 2 + 9, minZ: ARCADE.z - ARCADE.d / 2 - 11, maxZ: ARCADE.z + ARCADE.d / 2 + 11 },
    { minX: RANGE.x - RANGE.width / 2 - 7, maxX: RANGE.x + RANGE.width / 2 + 7, minZ: RANGE.backZ - 7, maxZ: RANGE.counterZ + 10 },
    { minX: MUR_PEINT.x - MUR_PEINT.w / 2 - 5, maxX: MUR_PEINT.x + MUR_PEINT.w / 2 + 5, minZ: MUR_PEINT.z - 8, maxZ: MUR_PEINT.z + 8 },
  ];
  if (HILL_RECT) rects.push(HILL_RECT);
  rects.push(...WATER_RECTS);
  return rects;
}

function buildOsmBuildings(ctx, data, rand) {
  const reserved = reservedRects();
  const facadeTex = makeFacadeTexture();
  facadeTex.wrapS = facadeTex.wrapT = THREE.RepeatWrapping;
  const wallMat = new THREE.MeshLambertMaterial({ map: facadeTex, vertexColors: true });
  const roofMat = new THREE.MeshLambertMaterial({ vertexColors: true });

  // Accumulateurs par tuile spatiale
  const tiles = new Map(); // key -> { wp, wuv, wc, rp, rc }
  const tileOf = (x, z) => {
    const key = Math.floor(x / TILE) + ',' + Math.floor(z / TILE);
    let t = tiles.get(key);
    if (!t) {
      t = { wp: [], wuv: [], wc: [], rp: [], rc: [] };
      tiles.set(key, t);
    }
    return t;
  };

  const wallColor = new THREE.Color();
  const roofColor = new THREE.Color();
  let kept = 0;

  for (let bi = 0; bi < data.buildings.length; bi++) {
    const b = data.buildings[bi];
    const h = Math.max(3, b.h);
    const pts = [];
    for (let i = 0; i < b.p.length; i += 2) pts.push([b.p[i], b.p[i + 1]]);
    if (pts.length < 3) continue;

    // AABB + zones réservées
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    let cx = 0, cz = 0;
    for (const [x, z] of pts) {
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
      cx += x; cz += z;
    }
    cx /= pts.length; cz /= pts.length;
    if (reserved.some((r) => maxX > r.minX && minX < r.maxX && maxZ > r.minZ && minZ < r.maxZ)) {
      continue;
    }

    // Sens horaire (vu de dessus) pour des normales de murs vers l'extérieur
    let area = 0;
    for (let i = 0; i < pts.length; i++) {
      const [x1, z1] = pts[i];
      const [x2, z2] = pts[(i + 1) % pts.length];
      area += x1 * z2 - x2 * z1;
    }
    if (area > 0) pts.reverse();

    const tile = tileOf(cx, cz);
    wallColor.set(WALL_TINTS[hash2(bi) % WALL_TINTS.length])
      .offsetHSL(0, 0, (rand() - 0.5) * 0.06);
    roofColor.set(ROOF_TINTS[hash2(bi * 7 + 3) % ROOF_TINTS.length])
      .offsetHSL(0, 0, (rand() - 0.5) * 0.05);

    // Murs
    for (let i = 0; i < pts.length; i++) {
      const [x1, z1] = pts[i];
      const [x2, z2] = pts[(i + 1) % pts.length];
      const len = Math.hypot(x2 - x1, z2 - z1);
      if (len < 0.05) continue;
      // Nombres ENTIERS de fenêtres : plus jamais de dernier étage coupé
      // (la cellule s'étire légèrement au lieu d'être tronquée)
      const u = Math.max(1, Math.round(len / FLOOR_M));
      const v = Math.max(1, Math.round(h / FLOOR_M));
      tile.wp.push(
        x1, 0, z1, x2, 0, z2, x2, h, z2,
        x1, 0, z1, x2, h, z2, x1, h, z1
      );
      tile.wuv.push(0, 0, u, 0, u, v, 0, 0, u, v, 0, v);
      for (let k = 0; k < 6; k++) tile.wc.push(wallColor.r, wallColor.g, wallColor.b);
    }

    // Toit (triangulation de l'empreinte)
    try {
      const shape = pts.map(([x, z]) => new THREE.Vector2(x, z));
      const tris = THREE.ShapeUtils.triangulateShape(shape, []);
      for (const [a, bb, c] of tris) {
        let pa = pts[a], pb = pts[bb], pc = pts[c];
        // Normale vers le haut
        const ny = (pb[1] - pa[1]) * (pc[0] - pa[0]) - (pb[0] - pa[0]) * (pc[1] - pa[1]);
        if (ny < 0) { const t = pb; pb = pc; pc = t; }
        tile.rp.push(pa[0], h, pa[1], pb[0], h, pb[1], pc[0], h, pc[1]);
        for (let k = 0; k < 3; k++) tile.rc.push(roofColor.r, roofColor.g, roofColor.b);
      }
    } catch { /* empreinte dégénérée : murs seuls */ }

    // Collision : boîtes fines LE LONG DE CHAQUE MUR (découpé en tronçons de
    // 4 m) au lieu de la boîte englobante du bâtiment — les rues diagonales
    // entre les immeubles ne sont plus barrées par des murs invisibles.
    for (let i = 0; i < pts.length; i++) {
      const [x1, z1] = pts[i];
      const [x2, z2] = pts[(i + 1) % pts.length];
      const len = Math.hypot(x2 - x1, z2 - z1);
      if (len < 0.05) continue;
      const chunks = Math.max(1, Math.ceil(len / 4));
      for (let k = 0; k < chunks; k++) {
        const ax = x1 + ((x2 - x1) * k) / chunks;
        const az = z1 + ((z2 - z1) * k) / chunks;
        const bx = x1 + ((x2 - x1) * (k + 1)) / chunks;
        const bz = z1 + ((z2 - z1) * (k + 1)) / chunks;
        ctx.colliders.push({
          minX: Math.min(ax, bx) - 0.25, maxX: Math.max(ax, bx) + 0.25,
          minY: 0, maxY: h,
          minZ: Math.min(az, bz) - 0.25, maxZ: Math.max(az, bz) + 0.25,
        });
      }
    }
    kept += 1;
  }

  for (const t of tiles.values()) {
    if (t.wp.length > 0) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(t.wp, 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(t.wuv, 2));
      geo.setAttribute('color', new THREE.Float32BufferAttribute(t.wc, 3));
      geo.computeVertexNormals();
      const mesh = new THREE.Mesh(geo, wallMat);
      mesh.userData.taggable = true;
      ctx.taggables.push(mesh);
      ctx.scene.add(mesh);
    }
    if (t.rp.length > 0) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(t.rp, 3));
      geo.setAttribute('color', new THREE.Float32BufferAttribute(t.rc, 3));
      geo.computeVertexNormals();
      ctx.scene.add(new THREE.Mesh(geo, roofMat));
    }
  }

  console.log(`Lyon OSM : ${kept} bâtiments dans ${tiles.size} tuiles.`);
}

function buildOsmRoads(ctx, data) {
  const pos = [];
  for (const road of data.roads) {
    const half = road.w / 2;
    for (let i = 0; i + 3 < road.p.length; i += 2) {
      const x1 = road.p[i], z1 = road.p[i + 1];
      const x2 = road.p[i + 2], z2 = road.p[i + 3];
      const dx = x2 - x1, dz = z2 - z1;
      const len = Math.hypot(dx, dz);
      if (len < 0.1) continue;
      // Perpendiculaire au segment
      const px = (-dz / len) * half, pz = (dx / len) * half;
      const y = 0.045;
      // Deux triangles formant le ruban
      pos.push(
        x1 - px, y, z1 - pz, x2 - px, y, z2 - pz, x2 + px, y, z2 + pz,
        x1 - px, y, z1 - pz, x2 + px, y, z2 + pz, x1 + px, y, z1 + pz
      );
    }
  }
  if (pos.length === 0) return;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(
    geo,
    new THREE.MeshLambertMaterial({
      color: 0x343943,
      polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
    })
  );
  mesh.userData.noShadow = true; // ne projette pas, reçoit via le sol
  ctx.scene.add(mesh);
}

function buildFarLandmarks(ctx, bound) {
  // Fourvière est désormais une vraie colline jouable (buildFourviere) :
  // il ne reste ici que le décor lointain de l'est.

  // Le Crayon (tour Part-Dieu), à l'est : fenêtres + couronne + pointe
  const EX = bound + 70;
  const towerTex = makeSkylineTexture();
  towerTex.wrapS = towerTex.wrapT = THREE.RepeatWrapping;
  towerTex.repeat.set(12, 10);
  const crayon = new THREE.Mesh(
    new THREE.CylinderGeometry(15, 15, 100, 20),
    new THREE.MeshLambertMaterial({ map: towerTex, color: 0xa9594a, fog: false })
  );
  crayon.position.set(EX, 50, -70);
  ctx.scene.add(crayon);
  const crown = new THREE.Mesh(
    new THREE.CylinderGeometry(15.6, 15.6, 3.6, 20),
    new THREE.MeshLambertMaterial({ color: 0xd8cfc2, fog: false })
  );
  crown.position.set(EX, 100, -70);
  ctx.scene.add(crown);
  const tip = new THREE.Mesh(
    new THREE.ConeGeometry(15, 24, 20),
    new THREE.MeshLambertMaterial({ color: 0x8d4538, fog: false })
  );
  tip.position.set(EX, 114, -70);
  ctx.scene.add(tip);
}

// Verdure : parcs, alignements le long des quais et de Bellecour. Tout le
// feuillage en un seul InstancedMesh, les troncs en un autre → 2 draw calls.
function buildGreenery(ctx, data, rand) {
  const spots = [];
  const reserved = reservedRects();
  const inReserved = (x, z) => reserved.some(
    (r) => x > r.minX && x < r.maxX && z > r.minZ && z < r.maxZ
  );
  const inWater = (x) => data.water.some((w) => x > w.minX - 4 && x < w.maxX + 4);

  // Alignements le long des deux rives
  for (const band of data.water) {
    for (const x of [band.minX - 4.5, band.maxX + 4.5]) {
      for (let z = -ctx.worldBound + 10; z < ctx.worldBound - 10; z += 9) {
        if (Math.abs(z) < 6) continue; // dégage les ponts
        spots.push([x, z + (rand() - 0.5) * 2]);
      }
    }
  }
  // Pourtour de Bellecour
  for (let i = 0; i < 26; i++) {
    const t = i / 26;
    spots.push([BELLECOUR.minX + t * (BELLECOUR.maxX - BELLECOUR.minX), BELLECOUR.minZ - 2]);
    spots.push([BELLECOUR.minX + t * (BELLECOUR.maxX - BELLECOUR.minX), BELLECOUR.maxZ + 2]);
  }
  // Quelques arbres épars dans les rues
  for (let i = 0; i < 140; i++) {
    spots.push([(rand() - 0.5) * ctx.worldBound * 1.9, (rand() - 0.5) * ctx.worldBound * 1.9]);
  }

  // Filtre : pas dans l'eau, pas dans une zone de jeu, pas dans un bâtiment
  const valid = [];
  for (const [x, z] of spots) {
    if (inWater(x) || inReserved(x, z)) continue;
    const near = ctx.colliders.nearby ? ctx.colliders.nearby(x, z, 1.5) : [];
    let hit = false;
    for (const b of near) {
      if (x > b.minX - 1 && x < b.maxX + 1 && z > b.minZ - 1 && z < b.maxZ + 1) { hit = true; break; }
    }
    if (!hit) valid.push([x, z, 0.85 + rand() * 0.5]);
  }
  if (valid.length === 0) return;

  const trunkMat = new THREE.MeshLambertMaterial({ color: 0x5d4632 });
  const trunkGeo = new THREE.CylinderGeometry(0.22, 0.32, 2.4, 6);
  const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, valid.length);

  const foliageGeo = new THREE.IcosahedronGeometry(1.6, 0); // facetté = feuillage
  const foliageMat = new THREE.MeshLambertMaterial({ color: 0x5b8a3f, flatShading: true });
  const foliage = new THREE.InstancedMesh(foliageGeo, foliageMat, valid.length);

  const m = new THREE.Matrix4();
  const col = new THREE.Color();
  valid.forEach(([x, z, s], i) => {
    m.makeScale(s, s, s);
    m.setPosition(x, 1.2 * s, z);
    trunks.setMatrixAt(i, m);
    m.makeScale(s * 1.6, s * 1.5, s * 1.6);
    m.setPosition(x, 3.6 * s, z);
    foliage.setMatrixAt(i, m);
    col.setHSL(0.28 + rand() * 0.06, 0.45, 0.32 + rand() * 0.12);
    foliage.setColorAt(i, col);
  });
  trunks.instanceMatrix.needsUpdate = true;
  foliage.instanceMatrix.needsUpdate = true;
  if (foliage.instanceColor) foliage.instanceColor.needsUpdate = true;
  ctx.scene.add(trunks, foliage);
}

// Cellule de fenêtre unique, répétée tous les 3 m. Quasi blanche : elle est
// multipliée par la teinte (vertex color) de chaque bâtiment.
// Cellule d'étage haussmannien (1 fenêtre, répétée tous les 3 m). Quasi
// blanche : multipliée par la teinte (vertex color) de chaque immeuble.
function makeFacadeTexture() {
  const S = 128;
  const canvas = document.createElement('canvas');
  canvas.width = S;
  canvas.height = S;
  const g = canvas.getContext('2d');

  // Pierre de taille avec léger grain
  g.fillStyle = '#f3eee4';
  g.fillRect(0, 0, S, S);
  for (let i = 0; i < 500; i++) {
    const v = 225 + Math.random() * 25;
    g.fillStyle = `rgba(${v}, ${v - 4}, ${v - 12}, 0.25)`;
    g.fillRect(Math.random() * S, Math.random() * S, 2, 2);
  }
  // Refend horizontal entre étages (joint de pierre + ombre)
  g.fillStyle = 'rgba(120, 110, 92, 0.55)';
  g.fillRect(0, S - 4, S, 3);
  g.fillStyle = 'rgba(255, 255, 255, 0.5)';
  g.fillRect(0, S - 1, S, 1);

  const wx = S * 0.27, ww = S * 0.46;
  const wy = S * 0.12, wh = S * 0.6;

  // Bandeau d'appui sous la fenêtre
  g.fillStyle = 'rgba(150, 140, 120, 0.5)';
  g.fillRect(wx - 6, wy + wh + 2, ww + 12, 4);

  // Encadrement en pierre saillante (clair dessus/gauche, ombré dessous/droite)
  g.fillStyle = '#fbf7ee';
  g.fillRect(wx - 5, wy - 5, ww + 10, wh + 10);
  g.fillStyle = 'rgba(110, 100, 84, 0.45)';
  g.fillRect(wx - 5, wy + wh + 3, ww + 10, 2);
  g.fillRect(wx + ww + 3, wy - 5, 2, wh + 10);
  // Clé de voûte stylisée au-dessus
  g.fillStyle = '#fdfaf2';
  g.fillRect(wx + ww / 2 - 5, wy - 9, 10, 8);

  // Vitre sombre avec dégradé de reflet de ciel
  const grad = g.createLinearGradient(0, wy, 0, wy + wh);
  grad.addColorStop(0, '#5b6675');
  grad.addColorStop(0.5, '#3c4654');
  grad.addColorStop(1, '#2c343f');
  g.fillStyle = grad;
  g.fillRect(wx, wy, ww, wh);
  // Reflet diagonal
  g.fillStyle = 'rgba(170, 200, 225, 0.22)';
  g.beginPath();
  g.moveTo(wx, wy);
  g.lineTo(wx + ww * 0.6, wy);
  g.lineTo(wx, wy + wh * 0.6);
  g.closePath();
  g.fill();
  // Croisée (meneau + traverse)
  g.fillStyle = 'rgba(245, 240, 230, 0.92)';
  g.fillRect(wx + ww / 2 - 1.5, wy, 3, wh);
  g.fillRect(wx, wy + wh / 2 - 1.5, ww, 3);

  // Garde-corps / balconnet en fer forgé devant l'appui
  g.strokeStyle = 'rgba(30, 32, 36, 0.8)';
  g.lineWidth = 1.4;
  const ry0 = wy + wh + 6, ry1 = ry0 + S * 0.12;
  g.beginPath();
  g.moveTo(wx - 6, ry0); g.lineTo(wx + ww + 6, ry0);
  g.moveTo(wx - 6, ry1); g.lineTo(wx + ww + 6, ry1);
  g.stroke();
  g.lineWidth = 1;
  for (let bx = wx - 4; bx <= wx + ww + 4; bx += 5) {
    g.beginPath();
    g.moveTo(bx, ry0); g.lineTo(bx, ry1);
    g.stroke();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function hash2(n) {
  let h = n | 0;
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return (h ^= h >>> 16) >>> 0;
}
