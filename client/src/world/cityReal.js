import * as THREE from 'three';
import { addInvisibleWall } from './utils.js';
import { ARCADE, RANGE, MUR_PEINT, BELLECOUR, makeRand } from './layout.js';
import {
  makeWaterTexture, buildBellecour, buildGrandeRoue, buildFountain,
  buildStreetFurniture, buildMurPeint, buildPeniches,
} from './city.js';

// Construit le vrai centre de Lyon à partir des empreintes OpenStreetMap
// (client/public/lyon-osm.json, généré par tools/fetch-osm.mjs).
// Toute la géométrie est fusionnée en tuiles de 80 m : quelques dizaines de
// draw calls pour des milliers de bâtiments, frustum culling gratuit.

const TILE = 80;
const FLOOR_M = 3; // hauteur d'étage pour le calage de la texture fenêtres

const WALL_TINTS = ['#e8ddc8', '#e3d4ba', '#d9c6a8', '#e6d9c4', '#dccab0', '#d5c0a0', '#efe6d4', '#cdb695'];
const ROOF_TINTS = ['#a8543c', '#b05a40', '#9c4e38', '#b46248', '#7e8696', '#6d7585', '#a8543c', '#b05a40'];

export function buildRealCity(ctx, data) {
  const bound = data.bound;
  ctx.worldBound = bound;
  ctx.waterBands = data.water;
  const rand = makeRand(7);

  buildGround(ctx, bound);
  buildWater(ctx, data.water, bound);
  buildOsmBuildings(ctx, data, rand);
  buildOsmRoads(ctx, data);

  // Lieux de gameplay (zones déjà déblayées des bâtiments OSM)
  buildBellecour(ctx);
  buildMurPeint(ctx);
  buildGrandeRoue(ctx);
  buildFountain(ctx);
  buildStreetFurniture(ctx);
  buildPeniches(ctx, data.water);

  // Décor hors zone : Fourvière à l'ouest, le Crayon à l'est
  buildFarLandmarks(ctx, bound);

  for (const [x, z, w, d] of [
    [0, -bound - 2, bound * 2 + 20, 4],
    [0, bound + 2, bound * 2 + 20, 4],
    [-bound - 2, 0, 4, bound * 2 + 20],
    [bound + 2, 0, 4, bound * 2 + 20],
  ]) {
    addInvisibleWall(ctx, { x, z, w, d, h: 40 });
  }
}

function buildGround(ctx, bound) {
  const size = bound * 2 + 400;
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(size, size),
    new THREE.MeshLambertMaterial({ color: 0x4a505d })
  );
  ground.rotation.x = -Math.PI / 2;
  ctx.scene.add(ground);
}

function buildWater(ctx, bands, bound) {
  const waterTex = makeWaterTexture();
  waterTex.wrapS = waterTex.wrapT = THREE.RepeatWrapping;
  waterTex.repeat.set(3, 90);
  const waterMat = new THREE.MeshLambertMaterial({
    map: waterTex, transparent: true, opacity: 0.94,
  });
  ctx.updatables.push((dt) => { waterTex.offset.y -= dt * 0.018; });

  for (const band of bands) {
    const w = band.maxX - band.minX;
    const water = new THREE.Mesh(new THREE.PlaneGeometry(w, bound * 2 + 200), waterMat);
    water.rotation.x = -Math.PI / 2;
    water.position.set((band.minX + band.maxX) / 2, 0.03, 0);
    ctx.scene.add(water);

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
  return [
    { minX: BELLECOUR.minX - 2, maxX: BELLECOUR.maxX + 2, minZ: BELLECOUR.minZ - 2, maxZ: BELLECOUR.maxZ + 2 },
    { minX: ARCADE.x - ARCADE.w / 2 - 9, maxX: ARCADE.x + ARCADE.w / 2 + 9, minZ: ARCADE.z - ARCADE.d / 2 - 11, maxZ: ARCADE.z + ARCADE.d / 2 + 11 },
    { minX: RANGE.x - RANGE.width / 2 - 7, maxX: RANGE.x + RANGE.width / 2 + 7, minZ: RANGE.backZ - 7, maxZ: RANGE.counterZ + 10 },
    { minX: MUR_PEINT.x - MUR_PEINT.w / 2 - 5, maxX: MUR_PEINT.x + MUR_PEINT.w / 2 + 5, minZ: MUR_PEINT.z - 8, maxZ: MUR_PEINT.z + 8 },
  ];
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
      const u = len / FLOOR_M;
      const v = h / FLOOR_M;
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

    // Collision : boîte englobante du bâtiment
    ctx.colliders.push({ minX, maxX, minY: 0, maxY: h, minZ, maxZ });
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
  // Colline de Fourvière + basilique stylisée, à l'ouest hors zone
  const hill = new THREE.Mesh(
    new THREE.SphereGeometry(120, 24, 16),
    new THREE.MeshLambertMaterial({ color: 0x4a6741 })
  );
  hill.scale.set(1.5, 0.42, 1.9);
  hill.position.set(-bound - 90, -6, -120);
  ctx.scene.add(hill);

  const white = new THREE.MeshLambertMaterial({ color: 0xe8e2d5 });
  const bas = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(26, 16, 42), white);
  body.position.y = 8;
  bas.add(body);
  for (const [tx, tz] of [[-10, -18], [10, -18], [-10, 18], [10, 18]]) {
    const tower = new THREE.Mesh(new THREE.CylinderGeometry(3, 3, 24, 8), white);
    tower.position.set(tx, 12, tz);
    bas.add(tower);
    const top = new THREE.Mesh(new THREE.ConeGeometry(3.5, 5, 8), new THREE.MeshLambertMaterial({ color: 0xc7bba4 }));
    top.position.set(tx, 26, tz);
    bas.add(top);
  }
  bas.position.set(-bound - 80, 38, -120);
  ctx.scene.add(bas);

  const tower = new THREE.Mesh(
    new THREE.ConeGeometry(6, 44, 4, 1, true),
    new THREE.MeshLambertMaterial({ color: 0x5a4438, wireframe: true })
  );
  tower.position.set(-bound - 60, 38 + 22, -60);
  ctx.scene.add(tower);

  // Le Crayon, à l'est
  const crayon = new THREE.Mesh(
    new THREE.CylinderGeometry(14, 14, 90, 18),
    new THREE.MeshLambertMaterial({ color: 0xb05a4a })
  );
  crayon.position.set(bound + 100, 45, -70);
  ctx.scene.add(crayon);
  const tip = new THREE.Mesh(
    new THREE.ConeGeometry(14, 20, 18),
    new THREE.MeshLambertMaterial({ color: 0x8d4538 })
  );
  tip.position.set(bound + 100, 100, -70);
  ctx.scene.add(tip);
}

// Cellule de fenêtre unique, répétée tous les 3 m. Quasi blanche : elle est
// multipliée par la teinte (vertex color) de chaque bâtiment.
function makeFacadeTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const g = canvas.getContext('2d');
  g.fillStyle = '#f5f1e9';
  g.fillRect(0, 0, 64, 64);
  // Légère bande d'étage
  g.fillStyle = 'rgba(0, 0, 0, 0.07)';
  g.fillRect(0, 60, 64, 4);
  // Encadrement
  g.fillStyle = 'rgba(255, 255, 255, 0.9)';
  g.fillRect(16, 10, 32, 44);
  // Vitre
  g.fillStyle = '#46505f';
  g.fillRect(19, 13, 26, 38);
  // Reflet de ciel
  g.fillStyle = 'rgba(150, 185, 215, 0.4)';
  g.fillRect(19, 13, 26, 13);
  // Meneau central
  g.fillStyle = 'rgba(245, 241, 233, 0.85)';
  g.fillRect(30.5, 13, 3, 38);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function hash2(n) {
  let h = n | 0;
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return (h ^= h >>> 16) >>> 0;
}
