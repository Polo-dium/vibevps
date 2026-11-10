import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { flattenColored, makeGlowSprite } from './utils.js';
import { treeCrownGeometry, treeFoliageMaterial } from './trees.js';
import { makeRand } from './layout.js';
import { makeFacadeTexture, makeFacadeEmissive } from './cityReal.js';
import { buildRoyalStatue } from './statue.js';
import { facadeShaderPatch } from '../render/facade.js';
import { roadShaderPatch } from '../render/road.js';
import { enhanceScene } from '../render/enhance.js';
import { detail } from '../render/detail.js';

// L'ARÈNE DE BELLECOUR ⛈️ (carte haute fidélité de world/hifi.js)
//
// La place fermée devient une arène de tir sous l'orage : un dépôt de
// conteneurs débarqué du port Édouard-Herriot s'est installé autour de
// Louis XIV. Couverts à toutes les hauteurs (conteneurs empilés où l'on
// grimpe, glissières béton, chariot élévateur), dalle d'enrobé détrempée
// qui renvoie le ciel, mâts d'éclairage allumés sous la pluie.
//
// Autour, les immeubles de la place : les MÊMES façades vivantes que la
// ville (render/facade.js : vitres en retrait, persiennes, balcons filants,
// rez-de-chaussée à bossages), découpées immeuble par immeuble avec leurs
// corniches, toits à la Mansart, lucarnes et souches de cheminée.
//
// Budget : ~12 draw calls pour tout le lieu. Le décor fixe est cuit en
// couleurs de sommets, les conteneurs sont UN InstancedMesh, les murs UN
// maillage. Placement 100 % déterministe (makeRand) : mêmes couverts chez
// tous les joueurs.

const FLOOR_M = 3;      // hauteur d'étage (même calage que la ville)
const W = 156, D = 106; // la place à l'échelle du jeu
const FACADE_GAP = 5;   // trottoir entre la bordure de la place et les façades
const ROOF_RUN = 2.4, ROOF_RISE = 3.4, BLOCK_DEPTH = 13;

// Conteneur 20 pieds
const CL = 6.06, CH = 2.59, CW = 2.44;

export function buildBellecourArena(ctx, group, OFFSET) {
  const halfW = W / 2, halfD = D / 2;
  const rand = makeRand(6902); // 69002 : le 2e arrondissement, à un zéro près
  const statics = new THREE.Group(); // tout le décor fixe, cuit à la fin
  const mats = new Map();
  const lam = (color) => {
    if (!mats.has(color)) mats.set(color, new THREE.MeshLambertMaterial({ color }));
    return mats.get(color);
  };
  const put = (mesh, x, y, z, ry = 0) => {
    mesh.position.set(x, y, z);
    mesh.rotation.y = ry;
    statics.add(mesh);
    return mesh;
  };
  const box = (w, h, d, color) => new THREE.Mesh(new THREE.BoxGeometry(w, h, d), lam(color));
  const cyl = (rt, rb, h, seg, color) => new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), lam(color));
  const collide = (x0, x1, z0, z1, y0, y1) => ctx.colliders.push({
    minX: OFFSET + Math.min(x0, x1), maxX: OFFSET + Math.max(x0, x1),
    minY: y0, maxY: y1,
    minZ: Math.min(z0, z1), maxZ: Math.max(z0, z1),
  });
  const shadow = (m, cast = true) => { m.castShadow = cast; m.receiveShadow = true; return m; };

  // --- Sols ---------------------------------------------------------------
  // Trottoir de pierre sous toute l'emprise, gravier rouge de Bellecour,
  // puis la dalle d'enrobé du dépôt. Gravier et enrobé se mouillent
  // (render/road.js) : flaques-miroirs au palier Élevé.
  const groundPlane = (w, d, tex, tile, y, key) => {
    const g = new THREE.PlaneGeometry(w, d);
    const uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * (w / tile), uv.getY(i) * (d / tile));
    const mat = new THREE.MeshLambertMaterial({ map: tex });
    const patch = roadShaderPatch(false);
    mat.userData.shaderPatch = patch;
    mat.userData.shaderPatchKey = key;
    mat.onBeforeCompile = patch;
    mat.customProgramCacheKey = () => key;
    const m = new THREE.Mesh(g, mat);
    m.rotation.x = -Math.PI / 2;
    m.position.y = y;
    m.receiveShadow = true;
    group.add(m);
    return m;
  };
  put(box(W + FACADE_GAP * 2 + 2, 0.3, D + FACADE_GAP * 2 + 2, 0xb9b3a6), 0, -0.14, 0);
  groundPlane(W, D, makeGravelTexture(rand), 6, 0.02, 'arenaGravel');
  const PAD_W = 138, PAD_D = 62;
  groundPlane(PAD_W, PAD_D, makeAsphaltTexture(rand), 5, 0.045, 'arenaPad');
  // Marquage au sol jaune du dépôt (liseré + travées)
  const paint = 0xd9a81e;
  for (const sz of [-PAD_D / 2 + 0.6, PAD_D / 2 - 0.6]) put(box(PAD_W - 1.2, 0.02, 0.22, paint), 0, 0.062, sz);
  for (const sx of [-PAD_W / 2 + 0.6, PAD_W / 2 - 0.6]) put(box(0.22, 0.02, PAD_D - 1.2, paint), sx, 0.062, 0);
  for (let x = -60; x <= 60; x += 20) {
    if (Math.abs(x) < 8) continue;
    for (const sz of [-1, 1]) put(box(0.16, 0.02, 9, 0xd8d6cf), x, 0.062, sz * (PAD_D / 2 - 6));
  }

  // Bordure de pierre de la place
  for (const [sx, sz, bw, bd] of [
    [0, -halfD, W, 1.6], [0, halfD, W, 1.6],
    [-halfW, 0, 1.6, D], [halfW, 0, 1.6, D],
  ]) {
    put(box(bw, 0.24, bd, 0xd8d2c2), sx, 0.12, sz);
  }

  // --- Les immeubles de la place -------------------------------------------
  const wall = { p: [], uv: [], c: [] };
  const wallColor = new THREE.Color();
  // Quad de mur orienté vers (nx, nz) ; u0 < 0 = mur aveugle pour le shader
  const wallQuad = (ax, az, bx, bz, y0, y1, nx, nz, u0, u1, v0, v1) => {
    if (-(bz - az) * nx + (bx - ax) * nz < 0) { [ax, bx] = [bx, ax]; [az, bz] = [bz, az]; }
    wall.p.push(ax, y0, az, bx, y0, bz, bx, y1, bz, ax, y0, az, bx, y1, bz, ax, y1, az);
    wall.uv.push(u0, v0, u1, v0, u1, v1, u0, v0, u1, v1, u0, v1);
    for (let k = 0; k < 6; k++) wall.c.push(wallColor.r, wallColor.g, wallColor.b);
  };
  const wallTri = (a, b, c2) => {
    wall.p.push(...a, ...b, ...c2);
    wall.uv.push(-0.9, a[1] / FLOOR_M, -0.6, b[1] / FLOOR_M, -0.6, c2[1] / FLOOR_M);
    for (let k = 0; k < 3; k++) wall.c.push(wallColor.r, wallColor.g, wallColor.b);
  };
  const TINTS = [0xefe4cf, 0xe6d6ba, 0xdccbb0, 0xeddccb, 0xd8c6a6, 0xe9d7c1, 0xe2cfb6];
  const ZINC = [0x5d6875, 0x66717d, 0x56616e];
  const roofQuads = []; // pans de zinc : [a, b, c, d, couleur]

  // Une rangée d'immeubles le long d'un côté. (ox, oz) = départ de la ligne
  // de façade, (dx, dz) = sens de marche, (nx, nz) = normale vers la place.
  const row = (ox, oz, dx, dz, nx, nz, length) => {
    let t = 0, prevH = 0;
    while (t < length - 0.01) {
      let w = 13 + Math.floor(rand() * 4) * 3; // 13 à 22 m : travées entières
      if (length - t - w < 11) w = length - t;
      const floors = 6 + Math.floor(rand() * 3);
      const h = floors * FLOOR_M;
      wallColor.set(TINTS[Math.floor(rand() * TINTS.length)]).offsetHSL(0, 0, (rand() - 0.5) * 0.04);
      const zinc = ZINC[Math.floor(rand() * ZINC.length)];
      const ax = ox + dx * t, az = oz + dz * t;
      const bx = ox + dx * (t + w), bz = oz + dz * (t + w);
      const cols = Math.max(1, Math.round(w / FLOOR_M));
      wallQuad(ax, az, bx, bz, 0, h, nx, nz, 0, cols, 0, floors);
      // Pignons (murs mitoyens aveugles) : visibles au-dessus du voisin
      const yTop = h + ROOF_RISE;
      for (const [px, pz, sgn] of [[ax, az, -1], [bx, bz, 1]]) {
        const qx = px - nx * BLOCK_DEPTH, qz = pz - nz * BLOCK_DEPTH;
        const rx = px - nx * ROOF_RUN, rz = pz - nz * ROOF_RUN;
        wallQuad(px, pz, qx, qz, 0, h, dx * sgn, dz * sgn, -0.9, -0.6, 0, floors);
        wallQuad(rx, rz, qx, qz, h, yTop, dx * sgn, dz * sgn, -0.9, -0.6, floors, floors + 1);
        const tri = [[px, h, pz], [rx, h, rz], [rx, yTop, rz]];
        // sens du triangle : même orientation que la normale voulue
        const e1x = tri[1][0] - tri[0][0], e1z = tri[1][2] - tri[0][2];
        const facing = (0 * 0 - e1z * (yTop - h)) * dx * sgn + (e1x * (yTop - h)) * dz * sgn;
        if (facing < 0) wallTri(tri[0], tri[2], tri[1]); else wallTri(tri[0], tri[1], tri[2]);
      }
      // Corniche, bandeau du rez-de-chaussée, bandeau d'attique
      const mx = (ax + bx) / 2, mz = (az + bz) / 2;
      const along = Math.abs(dx) > 0.5;
      const band = (y, hh, out, color) => put(
        box(along ? w : out, hh, along ? out : w, color),
        mx + nx * out / 2, y, mz + nz * out / 2
      );
      const stone = wallColor.clone().multiplyScalar(0.96).getHex();
      band(h + 0.05, 0.42, 0.75, stone);
      band(h - 0.3, 0.2, 0.4, stone);
      band(FLOOR_M + 0.02, 0.2, 0.3, stone);
      band(h - FLOOR_M, 0.16, 0.28, stone);
      // Toit à la Mansart : brisis de zinc + terrasson
      const s0 = [ax, h + 0.2, az], s1 = [bx, h + 0.2, bz];
      const s2 = [bx - nx * ROOF_RUN, yTop, bz - nz * ROOF_RUN], s3 = [ax - nx * ROOF_RUN, yTop, az - nz * ROOF_RUN];
      roofQuads.push([s0, s1, s2, s3, zinc]);
      roofQuads.push([s3, s2,
        [bx - nx * BLOCK_DEPTH, yTop, bz - nz * BLOCK_DEPTH],
        [ax - nx * BLOCK_DEPTH, yTop, az - nz * BLOCK_DEPTH], 0x4d5661]);
      // Lucarnes à l'aplomb des travées (une sur deux pour les plus larges)
      const ry = along ? 0 : Math.PI / 2;
      for (let c2 = 0; c2 < cols; c2++) {
        const u = (c2 + 0.5) / cols;
        const lx = ax + (bx - ax) * u - nx * 0.75, lz = az + (bz - az) * u - nz * 0.75;
        put(box(1.25, 1.7, 1.5, stone), lx, h + 1.15, lz, ry);
        put(box(0.8, 1.05, 0.08, 0x2c333d), lx + nx * 0.76, h + 1.2, lz + nz * 0.76, ry);
        put(box(1.45, 0.14, 1.7, zinc), lx, h + 2.06, lz, ry);
      }
      // Souches de cheminée sur les mitoyens
      const chim = (px, pz) => {
        const cx = px - nx * (ROOF_RUN + 1.6), cz = pz - nz * (ROOF_RUN + 1.6);
        put(box(along ? 0.9 : 2.6, 2.3, along ? 2.6 : 0.9, 0xa5654a), cx, yTop + 1.15, cz);
        for (const o of [-0.8, 0, 0.8]) {
          put(cyl(0.14, 0.17, 0.5, 6, 0xb97a5b), cx + (along ? 0 : o), yTop + 2.5, cz + (along ? o : 0));
        }
      };
      if (t > 0 || prevH === 0) chim(ax + dx * 0.5, az + dz * 0.5);
      prevH = h;
      t += w;
    }
  };
  const fz = halfD + FACADE_GAP, fx = halfW + FACADE_GAP;
  const ext = fx + BLOCK_DEPTH;
  row(-ext, -fz, 1, 0, 0, 1, ext * 2);   // nord
  row(ext, fz, -1, 0, 0, -1, ext * 2);   // sud
  row(-fx, fz, 0, -1, 1, 0, fz * 2);     // ouest
  row(fx, -fz, 0, 1, -1, 0, fz * 2);     // est
  collide(-ext, ext, -fz - BLOCK_DEPTH, -fz, 0, 40);
  collide(-ext, ext, fz, fz + BLOCK_DEPTH, 0, 40);
  collide(-fx - BLOCK_DEPTH, -fx, -fz, fz, 0, 40);
  collide(fx, fx + BLOCK_DEPTH, -fz, fz, 0, 40);

  {
    const facadeTex = makeFacadeTexture();
    facadeTex.wrapS = facadeTex.wrapT = THREE.RepeatWrapping;
    const emiTex = makeFacadeEmissive();
    const wallMat = new THREE.MeshLambertMaterial({
      map: facadeTex, vertexColors: true,
      emissive: 0xffffff, emissiveMap: emiTex, emissiveIntensity: 0,
    });
    wallMat.userData.shaderPatch = facadeShaderPatch;
    wallMat.userData.shaderPatchKey = 'facade';
    wallMat.onBeforeCompile = facadeShaderPatch;
    wallMat.customProgramCacheKey = () => 'facade';
    // Sous l'orage, des fenêtres s'allument même en plein jour
    ctx.updatables.push(() => {
      if (!ctx.inHiFi) return;
      wallMat.emissiveIntensity = Math.max(0.22, Math.max(0, (ctx.env?.night ?? 0) * 1.1 - 0.1) * 0.8);
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(wall.p, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(wall.uv, 2));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(wall.c, 3));
    geo.computeVertexNormals();
    const walls = shadow(new THREE.Mesh(geo, wallMat));
    walls.userData.taggable = true;
    ctx.taggables?.push(walls);
    group.add(walls);
  }
  for (const [a, b, c2, d, color] of roofQuads) {
    // sens des triangles : la normale d'un pan de toit regarde vers le haut
    const ny = (b[2] - a[2]) * (c2[0] - a[0]) - (b[0] - a[0]) * (c2[2] - a[2]);
    const v = ny >= 0 ? [...a, ...b, ...c2, ...a, ...c2, ...d] : [...a, ...c2, ...b, ...a, ...d, ...c2];
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
    g.computeVertexNormals();
    statics.add(new THREE.Mesh(g, lam(color)));
  }

  // --- Arbres et lampadaires de la place -----------------------------------
  // (houppiers texturés : hors cuisson, UN InstancedMesh)
  const crownMat = treeFoliageMaterial(0x4a7a3c);
  const crowns = [];
  for (const sz of [-halfD + 5.5, -halfD + 13, halfD - 5.5, halfD - 13]) {
    for (let x = -halfW + 12; x <= halfW - 12; x += 9) {
      if (sz > 0 && Math.abs(x) < 8) continue; // l'allée du portail reste dégagée
      const jitter = rand() - 0.5;
      const tx = x + jitter * 1.6;
      put(cyl(0.26, 0.36, 3.2, 8, 0x4f3c2c), tx, 1.6, sz);
      crowns.push([tx, sz, jitter * 6, 1.4 + rand() * 0.35]);
      collide(tx - 0.3, tx + 0.3, sz - 0.3, sz + 0.3, 0, 3.4);
    }
  }
  {
    const im = new THREE.InstancedMesh(treeCrownGeometry(), crownMat, crowns.length);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), sc = new THREE.Vector3();
    crowns.forEach(([x, z, ry, k], i) => {
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), ry);
      im.setMatrixAt(i, m.compose(p.set(x, 5.2, z), q, sc.setScalar(k)));
    });
    im.instanceMatrix.needsUpdate = true;
    im.computeBoundingSphere();
    group.add(shadow(im));
  }
  const glows = [];
  const globes = [];
  for (const sz of [-halfD + 9.5, halfD - 9.5]) {
    for (let x = -halfW + 14; x <= halfW - 14; x += 22) {
      put(cyl(0.5, 0.62, 0.5, 8, 0x30353c), x, 0.25, sz);
      put(cyl(0.11, 0.18, 5.2, 8, 0x262b31), x, 2.85, sz);
      put(cyl(0.34, 0.2, 0.4, 8, 0x262b31), x, 5.6, sz);
      globes.push(new THREE.SphereGeometry(0.36, 12, 10).translate(x, 6.05, sz));
    }
  }

  // --- Louis XIV, sculpté (world/statue.js), sur son socle -----------------
  put(box(9.4, 0.5, 7.4, 0xc9c1ae), 0, 0.25, 0);
  put(box(8.6, 0.5, 6.6, 0xd3ccb9), 0, 0.75, 0);
  put(box(7.2, 2.9, 5.2, 0xbdb49e), 0, 2.45, 0);
  put(box(6.6, 0.12, 4.6, 0xa9a08b), 0, 2.45, 0.34);
  put(box(7.9, 0.4, 5.9, 0xd3ccb9), 0, 4.1, 0);
  collide(-4.7, 4.7, -3.7, 3.7, 0, 0.5);
  collide(-4.3, 4.3, -3.3, 3.3, 0.5, 1.0);
  collide(-3.95, 3.95, -2.95, 2.95, 1.0, 4.3);
  const king = buildRoyalStatue();
  king.position.set(0, 4.3, 0);
  king.scale.setScalar(1.3);
  king.traverse((o) => { if (o.isMesh) shadow(o); });
  group.add(king);
  collide(-2.6, 2.6, -0.9, 0.9, 4.3, 8.6);

  // --- Le dépôt de conteneurs ----------------------------------------------
  // [x, z, quart de tour, niveau] — moitié ouest ; l'autre moitié est son
  // image par demi-tour autour du Roi (mêmes chances des deux côtés).
  const HALF = [
    [-14, -9, 0, 0], [-14, -9, 0, 1], [-20.4, -9, 0, 0],
    [-11, 13, 1, 0],
    [-29, 3, 1, 0], [-29, 3, 1, 1],
    [-38, -19, 0, 0], [-44.3, -19, 0, 0], [-41, -19, 0, 1],
    [-25, 22, 0, 0], [-31.3, 22, 0, 0],
    [-50, 11, 1, 0], [-52.6, 11, 1, 0], [-51.3, 11, 1, 1],
    [-62, -7, 0, 0], [-62, -7, 0, 1], [-62, -7, 0, 2],
    [-5, -24, 0, 0],
    [-64, 23, 1, 0],
    [-40, 8, 0, 0],
    [-19, -24.5, 1, 0],
  ];
  const cans = [];
  for (const [x, z, q, lv] of HALF) { cans.push([x, z, q, lv]); cans.push([-x, -z, q, lv]); }
  const CAN_TINTS = [0xc2523f, 0x4a86b8, 0x5a9a78, 0xd9803c, 0xb4bac0, 0x3f74a8, 0xa8483e, 0xdcb445, 0x6f9aa0];
  const canGeo = containerGeometry();
  const canMat = new THREE.MeshLambertMaterial({ map: makeContainerTexture(rand) });
  const canMesh = shadow(new THREE.InstancedMesh(canGeo, canMat, cans.length));
  const m4 = new THREE.Matrix4(), q4 = new THREE.Quaternion(), v3 = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1);
  const tint = new THREE.Color();
  const UP = new THREE.Vector3(0, 1, 0);
  cans.forEach(([x, z, q, lv], i) => {
    // les étages ne sont pas tout à fait d'aplomb : empilés par un grutier pressé
    const skew = lv ? (rand() - 0.5) * 0.06 : 0;
    q4.setFromAxisAngle(UP, q * Math.PI / 2 + skew + (i % 2 ? Math.PI : 0));
    m4.compose(v3.set(x, 0.05 + lv * CH + CH / 2, z), q4, one);
    canMesh.setMatrixAt(i, m4);
    tint.set(CAN_TINTS[Math.floor(rand() * CAN_TINTS.length)]).offsetHSL(0, 0, (rand() - 0.5) * 0.06);
    canMesh.setColorAt(i, tint);
    const hx = (q ? CW : CL) / 2, hz = (q ? CL : CW) / 2;
    collide(x - hx, x + hx, z - hz, z + hz, 0.05 + lv * CH, 0.05 + (lv + 1) * CH);
  });
  canMesh.instanceMatrix.needsUpdate = true;
  canMesh.instanceColor.needsUpdate = true;
  canMesh.computeBoundingSphere();
  canMesh.userData.taggable = true;
  ctx.taggables?.push(canMesh);
  group.add(canMesh);

  // Marchepieds : une caisse et un fût au pied de quelques piles → on monte
  const crate = (x, z, s = 1.1, color = 0x8a6a42) => {
    put(box(s, s, s, color), x, 0.05 + s / 2, z, (rand() - 0.5) * 0.3);
    for (const dy of [0.12, s - 0.12]) put(box(s + 0.06, 0.08, s + 0.06, 0x6f5433), x, 0.05 + dy, z);
    collide(x - s / 2, x + s / 2, z - s / 2, z + s / 2, 0, 0.05 + s);
  };
  const pallet = (x, z) => {
    for (const dz of [-0.45, 0, 0.45]) put(box(1.2, 0.1, 0.12, 0x9b7b52), x, 0.1, z + dz);
    for (let i = 0; i < 5; i++) put(box(0.2, 0.03, 1.02, 0xab8a5e), x - 0.5 + i * 0.25, 0.165, z);
  };
  // Glissière béton (profil New Jersey extrudé)
  const jerseyGeo = (() => {
    const s = new THREE.Shape();
    const pts = [[-0.3, 0], [0.3, 0], [0.3, 0.18], [0.13, 0.42], [0.08, 0.84], [-0.08, 0.84], [-0.13, 0.42], [-0.3, 0.18]];
    s.moveTo(...pts[0]);
    for (const p of pts.slice(1)) s.lineTo(...p);
    const g = new THREE.ExtrudeGeometry(s, { depth: 2.4, bevelEnabled: false });
    g.translate(0, 0, -1.2);
    return g;
  })();
  const jersey = (x, z, q, n = 1) => {
    for (let i = 0; i < n; i++) {
      const o = (i - (n - 1) / 2) * 2.46;
      const jx = x + (q ? o : 0), jz = z + (q ? 0 : o);
      const m = new THREE.Mesh(jerseyGeo, lam(i % 2 ? 0xb4b1a9 : 0xa9a69e));
      put(m, jx, 0.05, jz, q ? Math.PI / 2 : 0);
      const hx = q ? 1.2 : 0.3, hz = q ? 0.3 : 1.2;
      collide(jx - hx, jx + hx, jz - hz, jz + hz, 0, 0.89);
    }
  };
  // Bloc de chantier rayé jaune et noir
  const hazard = (x, z, q) => {
    for (let i = 0; i < 6; i++) {
      put(box(q ? 0.3 : 0.7, 1.1, q ? 0.7 : 0.3, i % 2 ? 0x1b1c1f : 0xe2b01f), x + (q ? (i - 2.5) * 0.3 : 0), 0.6, z + (q ? 0 : (i - 2.5) * 0.3));
    }
    const hx = q ? 0.9 : 0.35, hz = q ? 0.35 : 0.9;
    collide(x - hx, x + hx, z - hz, z + hz, 0, 1.15);
  };
  const cone = (x, z) => {
    put(box(0.36, 0.04, 0.36, 0x1c1d20), x, 0.07, z, rand());
    put(cyl(0.035, 0.15, 0.52, 10, 0xe8601c), x, 0.35, z);
    put(cyl(0.085, 0.108, 0.1, 10, 0xf2f0ea), x, 0.36, z);
  };
  const barrel = (x, z, color) => {
    put(cyl(0.3, 0.3, 0.9, 12, color), x, 0.5, z);
    for (const dy of [0.2, 0.5, 0.8]) put(cyl(0.315, 0.315, 0.04, 12, 0x2a2d31), x, 0.05 + dy, z);
    collide(x - 0.3, x + 0.3, z - 0.3, z + 0.3, 0, 0.95);
  };
  // Chariot élévateur (le Fenwick du dépôt)
  const forklift = (x, z, ry) => {
    const g = new THREE.Group();
    const add = (m, px, py, pz) => { m.position.set(px, py, pz); g.add(m); };
    const Y = 0xe3b21c, K = 0x1d1e21;
    add(box(1.15, 0.6, 1.9, Y), 0, 0.62, 0);
    add(box(1.15, 0.75, 0.6, 0x2a2c30), 0, 0.95, -0.85); // contrepoids
    add(box(0.9, 0.12, 0.7, K), 0, 1.0, 0.05);            // siège
    add(box(0.9, 0.5, 0.1, K), 0, 1.25, -0.3);
    for (const [px, pz] of [[-0.5, -0.45], [0.5, -0.45], [-0.5, 0.75], [0.5, 0.75]]) add(box(0.07, 1.3, 0.07, K), px, 1.55, pz);
    add(box(1.14, 0.06, 1.34, K), 0, 2.22, 0.15);         // toit de protection
    for (const px of [-0.36, 0.36]) add(box(0.1, 2.5, 0.12, K), px, 1.4, 1.05); // mât
    add(box(0.82, 0.1, 0.12, K), 0, 2.6, 1.05);
    add(box(0.9, 0.5, 0.06, 0x3a3d42), 0, 0.5, 1.14);     // tablier
    for (const px of [-0.28, 0.28]) add(box(0.1, 0.05, 1.1, 0x8a8d92), px, 0.2, 1.7); // fourches
    for (const [px, pz, r] of [[-0.58, 0.6, 0.32], [0.58, 0.6, 0.32], [-0.55, -0.7, 0.26], [0.55, -0.7, 0.26]]) {
      const w = cyl(r, r, 0.24, 14, 0x17181a);
      w.rotation.z = Math.PI / 2;
      add(w, px, r, pz);
    }
    add(box(0.12, 0.12, 0.06, 0xff7a1a), 0.4, 2.3, 0.8);  // gyrophare
    g.position.set(x, 0.05, z);
    g.rotation.y = ry;
    statics.add(g);
    collide(x - 1.1, x + 1.1, z - 1.1, z + 1.1, 0, 2.3);
  };

  const mirror = (fn) => (x, z, ...a) => { fn(x, z, ...a); fn(-x, -z, ...a); };
  mirror(crate)(-10.4, -9.2);            // → pile A
  mirror(crate)(-29, 6.9);               // → pile C
  mirror(crate)(-58.2, -6.6, 1.2);       // → tour G
  mirror(crate)(-47.6, 14.6, 1.15);      // → pile F
  mirror(crate)(-36, -15.9, 1.0, 0x6d7f4b);
  mirror(jersey)(-22, 3, 0, 3);
  mirror(jersey)(-8, -15, 1, 2);
  mirror(jersey)(-46, -4, 1, 3);
  mirror(jersey)(-35, 15, 0, 2);
  mirror(jersey)(-58, 5, 1, 2);
  mirror(jersey)(-3, 9.5, 1, 2);
  mirror(hazard)(-17, 6, 0);
  mirror(hazard)(-55, -17, 1);
  mirror(hazard)(-33, -8, 1);
  mirror(barrel)(-24.5, -12.2, 0x2f5f8a);
  mirror(barrel)(-25.2, -11.4, 0xa03a2c);
  mirror(barrel)(-43, 20, 0x2f5f8a);
  mirror(barrel)(-8.6, 20.6, 0xc49a2c);
  mirror(pallet)(-16, 21);
  mirror(pallet)(-45, -9.5);
  for (const [x, z] of [[-18, 0.5], [-19.2, 9], [-26, -4], [-33.5, -13], [-9, -19], [-42, 4.5], [-56, 14], [-6.5, 6.4], [-12.5, 18], [-48, -14]]) {
    cone(x, z); cone(-x, -z);
  }
  forklift(-34, -3, 0.5);
  forklift(27, 9.5, -2.2);

  // --- Mâts d'éclairage du dépôt -------------------------------------------
  const lampHeads = [];
  for (const [mx, mz] of [[-66, -29.5], [66, 29.5], [-66, 29.5], [66, -29.5], [-22, -30], [22, 30]]) {
    put(box(1.1, 0.6, 1.1, 0x8f8c84), mx, 0.3, mz);
    put(cyl(0.12, 0.2, 13, 8, 0x4b5057), mx, 6.8, mz);
    put(box(2.6, 0.14, 0.14, 0x4b5057), mx, 13.2, mz);
    collide(mx - 0.55, mx + 0.55, mz - 0.55, mz + 0.55, 0, 13);
    const toward = Math.atan2(-mx, -mz);
    for (const o of [-0.95, 0, 0.95]) {
      const hx = mx + Math.cos(toward) * o, hz = mz - Math.sin(toward) * o;
      put(box(0.6, 0.42, 0.3, 0x2b2e33), hx, 13.05, hz, toward);
      lampHeads.push(new THREE.PlaneGeometry(0.5, 0.32)
        .applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(-0.35, toward, 0, 'YXZ')))
        .translate(hx + Math.sin(toward) * 0.16, 13.02, hz + Math.cos(toward) * 0.16));
    }
    const glow = makeGlowSprite(0xffe2b4, 9, 0.5);
    glow.position.set(mx + Math.sin(toward) * 0.5, 13, mz + Math.cos(toward) * 0.5);
    glow.userData.noShadow = true;
    group.add(glow);
    glows.push(glow);
  }

  // Globes et projecteurs : émissifs (hors cuisson), fusionnés → 2 draw calls
  const globeMat = new THREE.MeshBasicMaterial({ color: 0xffe6b0 });
  for (const [geos, mat] of [[globes, globeMat], [lampHeads, new THREE.MeshBasicMaterial({ color: 0xfff1d6 })]]) {
    const m = new THREE.Mesh(mergeGeometries(geos), mat);
    m.userData.noShadow = true;
    group.add(m);
  }

  // --- Portail doré du retour, au sud ----------------------------------------
  const ringMat = new THREE.MeshBasicMaterial({ color: 0xffc94d, transparent: true, opacity: 0.85 });
  const ring = new THREE.Mesh(new THREE.TorusGeometry(2.6, 0.26, 10, 28), ringMat);
  ring.position.set(0, 3.2, halfD - 12);
  ring.userData.noShadow = true;
  group.add(ring);
  const veil = new THREE.Mesh(
    new THREE.CircleGeometry(2.4, 28),
    new THREE.MeshBasicMaterial({
      color: 0xffe08a, transparent: true, opacity: 0.3,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    })
  );
  veil.position.copy(ring.position);
  veil.userData.noShadow = true;
  group.add(veil);

  // Cuisson du décor fixe : un millier de pièces → un seul draw call
  const baked = flattenColored(statics);
  if (baked) group.add(shadow(baked));

  // Palier Élevé : passe matière (relief et rugosité tirés des textures,
  // sols PBR → flaques-miroirs, tôle ondulée en relief)
  if (detail.high) {
    enhanceScene(group, 8);
    // tôle peinte mouillée : un peu de satiné sur les conteneurs
    canMesh.material.roughness = 0.7;
    canMesh.material.envMapIntensity = 0.9;
  }

  // Les lumières vivent avec l'heure ; sous l'orage, les mâts restent allumés
  ctx.updatables.push(() => {
    if (!ctx.inHiFi) return;
    const n = ctx.env?.night ?? 0;
    const v = 0.5 + 0.5 * n;
    globeMat.color.setRGB(v, v * 0.92, v * 0.72);
    for (const g of glows) g.material.opacity = 0.28 + 0.5 * n;
    ring.material.opacity = 0.7 + 0.3 * Math.abs(Math.sin(Date.now() / 700));
  });

  return {
    group,
    // On arrive dos au portail, face au dépôt et à la statue
    spawn: { x: 0, y: 0, z: halfD - 18, ry: 0 },
    portal: { x: 0, z: halfD - 12 },
  };
}

// Conteneur : boîte dont les UV piochent dans l'atlas (flancs ondulés avec
// marquage / portes à crémones / toit)
function containerGeometry() {
  const g = new THREE.BoxGeometry(CL, CH, CW);
  const uv = g.attributes.uv;
  // BoxGeometry : faces +x, -x, +y, -y, +z, -z (4 sommets chacune)
  const zone = [[0.75, 1.0], [0.5, 0.75], [0.5, 0.75], [0.5, 0.75], [0, 0.5], [0, 0.5]];
  const vz = [[0, 1], [0, 1], [0.5, 0.56], [0.5, 0.56], [0, 1], [0, 1]];
  for (let f = 0; f < 6; f++) {
    for (let k = 0; k < 4; k++) {
      const i = f * 4 + k;
      uv.setXY(i,
        zone[f][0] + uv.getX(i) * (zone[f][1] - zone[f][0]),
        vz[f][0] + uv.getY(i) * (vz[f][1] - vz[f][0]));
    }
  }
  return g;
}

// Atlas 1024×256 en niveaux de gris clairs (teinté par la couleur
// d'instance) : [flanc ondulé + marquage | bout plein | portes]
function makeContainerTexture(rand) {
  const Wt = 1024, Ht = 256;
  const c = document.createElement('canvas');
  c.width = Wt; c.height = Ht;
  const g = c.getContext('2d');
  g.fillStyle = '#e6e6e6';
  g.fillRect(0, 0, Wt, Ht);
  // Tôle ondulée : nervures verticales, crête claire / creux sombre
  const ribs = (x0, x1, pitch) => {
    for (let x = x0; x < x1; x += pitch) {
      const gr = g.createLinearGradient(x, 0, x + pitch, 0);
      gr.addColorStop(0, '#fbfbfb');
      gr.addColorStop(0.3, '#ececec');
      gr.addColorStop(0.5, '#b6b6b6');
      gr.addColorStop(0.72, '#d0d0d0');
      gr.addColorStop(1, '#f4f4f4');
      g.fillStyle = gr;
      g.fillRect(x, 0, Math.min(pitch, x1 - x), Ht);
    }
  };
  ribs(0, 512, 16);
  ribs(512, 768, 16);
  // Cadre : longerons haut et bas, montants d'angle
  const frame = (x0, x1) => {
    g.fillStyle = '#b4b4b4';
    g.fillRect(x0, 0, x1 - x0, 12);
    g.fillRect(x0, Ht - 14, x1 - x0, 14);
    g.fillRect(x0, 0, 9, Ht);
    g.fillRect(x1 - 9, 0, 9, Ht);
    g.fillStyle = 'rgba(0,0,0,0.28)';
    g.fillRect(x0, 12, x1 - x0, 3);
    g.fillRect(x0, Ht - 17, x1 - x0, 3);
  };
  frame(0, 512); frame(512, 768);
  // Marquage d'armateur (blanc cassé, pochoir) + matricule
  g.fillStyle = 'rgba(255,255,255,0.92)';
  g.font = '900 64px "Arial Narrow", Arial, sans-serif';
  g.textBaseline = 'middle';
  g.fillText('QUENELLE', 34, 92);
  g.font = '700 30px "Arial Narrow", Arial, sans-serif';
  g.fillText('LINE — LYON', 36, 140);
  g.font = '700 17px monospace';
  g.fillText('GONU 690 002 1', 360, 40);
  g.fillText('22G1', 440, 62);
  g.fillStyle = 'rgba(255,255,255,0.8)';
  for (let i = 0; i < 4; i++) g.fillRect(36 + i * 22, 168, 14, 14);
  // Portes : deux vantaux, quatre crémones, plaque
  const dx0 = 768, dx1 = 1024;
  g.fillStyle = '#d2d2d2';
  g.fillRect(dx0, 0, dx1 - dx0, Ht);
  for (let x = dx0 + 14; x < dx1 - 10; x += 30) {
    g.fillStyle = 'rgba(0,0,0,0.08)';
    g.fillRect(x, 16, 12, Ht - 34);
  }
  frame(dx0, dx1);
  g.fillStyle = '#8a8a8a';
  g.fillRect((dx0 + dx1) / 2 - 2, 12, 4, Ht - 26);
  for (const bx of [dx0 + 44, dx0 + 100, dx1 - 104, dx1 - 48]) {
    g.fillStyle = '#f6f6f6';
    g.fillRect(bx, 14, 6, Ht - 30);
    g.fillStyle = '#7d7d7d';
    g.fillRect(bx - 6, Ht * 0.52, 18, 8);
    g.fillRect(bx - 3, 20, 12, 7);
    g.fillRect(bx - 3, Ht - 30, 12, 7);
  }
  g.fillStyle = 'rgba(255,255,255,0.85)';
  g.font = '700 13px monospace';
  g.fillText('MAX GROSS 30 480 KG', dx1 - 118, 70);
  g.fillText('TARE     2 200 KG', dx1 - 118, 88);
  // Usure : coulures de rouille sous les longerons, éraflures, crasse au sol
  for (let i = 0; i < 70; i++) {
    const x = rand() * Wt, len = 20 + rand() * 90;
    const gr = g.createLinearGradient(0, 12, 0, 12 + len);
    gr.addColorStop(0, `rgba(96, 52, 26, ${0.22 + rand() * 0.25})`);
    gr.addColorStop(1, 'rgba(96, 52, 26, 0)');
    g.fillStyle = gr;
    g.fillRect(x, 12, 2 + rand() * 5, len);
  }
  for (let i = 0; i < 46; i++) {
    g.fillStyle = `rgba(${rand() < 0.5 ? '70,40,22' : '245,245,245'}, ${0.15 + rand() * 0.25})`;
    g.fillRect(rand() * Wt, 20 + rand() * (Ht - 50), 6 + rand() * 30, 1 + rand() * 3);
  }
  const dirt = g.createLinearGradient(0, Ht - 60, 0, Ht);
  dirt.addColorStop(0, 'rgba(40, 34, 28, 0)');
  dirt.addColorStop(1, 'rgba(40, 34, 28, 0.42)');
  g.fillStyle = dirt;
  g.fillRect(0, Ht - 60, Wt, 60);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

// Gravier rouge lyonnais : grain fin, quelques cailloux plus clairs
function makeGravelTexture(rand) {
  const S = 256;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  g.fillStyle = '#a5694a';
  g.fillRect(0, 0, S, S);
  for (let i = 0; i < 9000; i++) {
    const v = 110 + rand() * 90;
    g.fillStyle = `rgba(${v}, ${v * 0.66}, ${v * 0.5}, 0.5)`;
    g.fillRect(rand() * S, rand() * S, 2, 2);
  }
  for (let i = 0; i < 400; i++) {
    g.fillStyle = 'rgba(222, 200, 176, 0.5)';
    g.fillRect(rand() * S, rand() * S, 3, 3);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

// Enrobé du dépôt : granulats, reprises plus sombres, fissures, taches d'huile
function makeAsphaltTexture(rand) {
  const S = 512;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  g.fillStyle = '#4b4d50';
  g.fillRect(0, 0, S, S);
  for (let i = 0; i < 14; i++) {
    const x = rand() * S, y = rand() * S, r = 50 + rand() * 120;
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    const d = rand() < 0.5;
    gr.addColorStop(0, d ? 'rgba(30,31,34,0.35)' : 'rgba(110,110,108,0.2)');
    gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, S, S);
  }
  for (let i = 0; i < 26000; i++) {
    const v = 40 + rand() * 110;
    g.fillStyle = `rgba(${v}, ${v}, ${v + 4}, 0.4)`;
    g.fillRect(rand() * S, rand() * S, 1.5, 1.5);
  }
  g.strokeStyle = 'rgba(18, 18, 20, 0.6)';
  g.lineWidth = 1.2;
  for (let i = 0; i < 7; i++) {
    let x = rand() * S, y = rand() * S;
    g.beginPath();
    g.moveTo(x, y);
    for (let k = 0; k < 9; k++) {
      x += (rand() - 0.5) * 60; y += (rand() - 0.5) * 60;
      g.lineTo(x, y);
    }
    g.stroke();
  }
  for (let i = 0; i < 5; i++) {
    const x = rand() * S, y = rand() * S, r = 10 + rand() * 26;
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, 'rgba(12,12,14,0.55)');
    gr.addColorStop(1, 'rgba(12,12,14,0)');
    g.fillStyle = gr;
    g.fillRect(x - r, y - r, r * 2, r * 2);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}
