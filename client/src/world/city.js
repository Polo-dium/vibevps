import * as THREE from 'three';
import { addBox, addInvisibleWall, makeTextTexture } from './utils.js';
import {
  WORLD_BOUND, BELLECOUR, ARCADE, RANGE, SAONE, RHONE, BRIDGE, MUR_PEINT, makeRand,
} from './layout.js';

const PALETTE = ['#cbb697', '#d8c3a5', '#c49a7a', '#b98d6f', '#d6a77a', '#bfae9b', '#c9b29b', '#e0cdb2'];

export function buildCity(ctx) {
  const rand = makeRand(1337);
  buildGroundAndRivers(ctx);
  buildBellecour(ctx);
  buildBuildings(ctx, rand);
  buildMurPeint(ctx);
  buildLandmarks(ctx, rand);
  buildDecor(ctx, rand);

  // Limites du monde
  for (const [x, z, w, d] of [
    [0, -WORLD_BOUND - 2, WORLD_BOUND * 2 + 20, 4],
    [0, WORLD_BOUND + 2, WORLD_BOUND * 2 + 20, 4],
    [-WORLD_BOUND - 2, 0, 4, WORLD_BOUND * 2 + 20],
    [WORLD_BOUND + 2, 0, 4, WORLD_BOUND * 2 + 20],
  ]) {
    addInvisibleWall(ctx, { x, z, w, d, h: 30 });
  }
}

function buildGroundAndRivers(ctx) {
  // Sol asphalte
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(560, 560),
    new THREE.MeshLambertMaterial({ color: 0x3c4250 })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = 0;
  ground.userData.taggable = false;
  ctx.scene.add(ground);

  // Eau des deux fleuves (légèrement au-dessus du sol, bordée de parapets)
  const waterMat = new THREE.MeshLambertMaterial({
    color: 0x1d5b66, emissive: 0x06222a, transparent: true, opacity: 0.92,
  });
  for (const river of [SAONE, RHONE]) {
    const w = river.maxX - river.minX;
    const water = new THREE.Mesh(new THREE.PlaneGeometry(w, 560), waterMat);
    water.rotation.x = -Math.PI / 2;
    water.position.set((river.minX + river.maxX) / 2, 0.05, 0);
    ctx.scene.add(water);

    // Parapets de quai, avec une ouverture au niveau du pont (z = 0)
    for (const x of [river.minX, river.maxX]) {
      for (const [zc, len] of [
        [-(WORLD_BOUND + BRIDGE.halfWidth + 1) / 2, WORLD_BOUND - BRIDGE.halfWidth - 1],
        [(WORLD_BOUND + BRIDGE.halfWidth + 1) / 2, WORLD_BOUND - BRIDGE.halfWidth - 1],
      ]) {
        addBox(ctx, { x, z: zc, w: 0.7, h: 1.05, d: len, color: 0x9aa0a8 });
      }
    }

    // Pont à z = 0
    addBox(ctx, {
      x: (river.minX + river.maxX) / 2, z: 0,
      w: w + 6, h: 0.45, d: BRIDGE.halfWidth * 2,
      color: 0x8b8f99,
    });
    for (const zr of [-BRIDGE.halfWidth + 0.4, BRIDGE.halfWidth - 0.4]) {
      addBox(ctx, {
        x: (river.minX + river.maxX) / 2, y: 0.45, z: zr,
        w: w + 6, h: 1.0, d: 0.4, color: 0x6f7884,
      });
    }
  }
}

function buildBellecour(ctx) {
  const plaza = new THREE.Mesh(
    new THREE.PlaneGeometry(BELLECOUR.maxX - BELLECOUR.minX, BELLECOUR.maxZ - BELLECOUR.minZ),
    new THREE.MeshLambertMaterial({ color: 0xc08552 })
  );
  plaza.rotation.x = -Math.PI / 2;
  plaza.position.set(
    (BELLECOUR.minX + BELLECOUR.maxX) / 2, 0.02,
    (BELLECOUR.minZ + BELLECOUR.maxZ) / 2
  );
  ctx.scene.add(plaza);

  // Statue équestre stylisée (Louis XIV)
  addBox(ctx, { x: -2, z: 6, w: 5, h: 2.2, d: 3.4, color: 0x7d7468 }); // socle
  addBox(ctx, { x: -2, y: 2.2, z: 6, w: 3.4, h: 1.6, d: 1.2, color: 0x3f5247, collider: false }); // cheval
  addBox(ctx, { x: -2.9, y: 3.4, z: 6, w: 0.9, h: 1.5, d: 0.8, color: 0x3f5247, collider: false }); // cavalier
  addBox(ctx, { x: -0.6, y: 3.0, z: 6, w: 1.0, h: 0.9, d: 0.7, color: 0x3f5247, collider: false }); // tête du cheval
}

function buildBuildings(ctx, rand) {
  const reserved = [
    { minX: BELLECOUR.minX - 6, maxX: BELLECOUR.maxX + 6, minZ: BELLECOUR.minZ - 6, maxZ: BELLECOUR.maxZ + 6 },
    { minX: ARCADE.x - ARCADE.w / 2 - 8, maxX: ARCADE.x + ARCADE.w / 2 + 8, minZ: ARCADE.z - ARCADE.d / 2 - 12, maxZ: ARCADE.z + ARCADE.d / 2 + 12 },
    { minX: RANGE.x - RANGE.width / 2 - 8, maxX: RANGE.x + RANGE.width / 2 + 8, minZ: RANGE.backZ - 8, maxZ: RANGE.counterZ + 12 },
    { minX: SAONE.minX - 7, maxX: SAONE.maxX + 7, minZ: -300, maxZ: 300 },
    { minX: RHONE.minX - 7, maxX: RHONE.maxX + 7, minZ: -300, maxZ: 300 },
    { minX: -300, maxX: 300, minZ: -9, maxZ: 9 }, // axe est-ouest (ponts)
    { minX: MUR_PEINT.x - 26, maxX: MUR_PEINT.x + 26, minZ: MUR_PEINT.z - 12, maxZ: MUR_PEINT.z + 16 },
    { minX: 105, maxX: 130, minZ: -65, maxZ: -25 }, // tour Part-Dieu
  ];
  const isReserved = (x, z, half) =>
    reserved.some((r) =>
      x + half > r.minX && x - half < r.maxX && z + half > r.minZ && z - half < r.maxZ
    );

  for (let gx = -126; gx <= 126; gx += 26) {
    for (let gz = -126; gz <= 126; gz += 26) {
      const x = gx + (rand() - 0.5) * 5;
      const z = gz + (rand() - 0.5) * 5;
      const w = 13 + rand() * 6;
      const d = 13 + rand() * 6;
      if (isReserved(x, z, Math.max(w, d) / 2 + 1)) continue;
      // Croix-Rousse (nord) et Vieux Lyon (ouest) : immeubles plus hauts/serrés
      const tall = z < -90 || x < -104;
      const h = (tall ? 12 : 8) + rand() * (tall ? 14 : 12);
      const color = new THREE.Color(PALETTE[Math.floor(rand() * PALETTE.length)]);
      const mesh = addBox(ctx, { x, z, w, h, d, color, taggable: true });
      paintFacade(mesh, rand);
      // Toit
      addBox(ctx, { x, y: h, z, w: w + 0.6, h: 0.5, d: d + 0.6, color: 0x6b4f3f, collider: false });
    }
  }
}

// Fenêtres : une texture canvas par immeuble, dimensionnée selon sa taille.
function paintFacade(mesh, rand) {
  const { width, height, depth } = mesh.geometry.parameters;
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const g = canvas.getContext('2d');
  const base = '#' + mesh.material.color.getHexString();
  g.fillStyle = base;
  g.fillRect(0, 0, 64, 64);
  const rows = Math.max(2, Math.floor(height / 3));
  const cols = Math.max(2, Math.floor(Math.max(width, depth) / 3));
  const ch = 64 / rows, cw = 64 / cols;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      g.fillStyle = rand() < 0.25 ? '#ffd98a' : '#222a38';
      g.fillRect(c * cw + cw * 0.25, r * ch + ch * 0.2, cw * 0.5, ch * 0.55);
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  mesh.material = new THREE.MeshLambertMaterial({ map: tex });
}

function buildMurPeint(ctx) {
  // Grande fresque murale à taguer, hommage au mur des Canuts
  const { x, z, w, h } = MUR_PEINT;
  const wall = addBox(ctx, { x, z, w, h, d: 2.5, color: 0xd9cdb8, taggable: true });
  void wall;
  const sign = new THREE.Mesh(
    new THREE.PlaneGeometry(14, 2.4),
    new THREE.MeshBasicMaterial({ map: makeTextTexture('MUR DES LYONNAIS', { color: '#ffb347' }), transparent: true })
  );
  sign.position.set(x, h + 1.6, z + 1.3);
  ctx.scene.add(sign);
}

function buildLandmarks(ctx, rand) {
  // Colline de Fourvière (décor, hors zone jouable)
  const hill = new THREE.Mesh(
    new THREE.SphereGeometry(70, 24, 16),
    new THREE.MeshLambertMaterial({ color: 0x4a6741 })
  );
  hill.scale.set(1.6, 0.55, 1.8);
  hill.position.set(-195, -4, -20);
  ctx.scene.add(hill);

  // Basilique stylisée
  const basGroup = new THREE.Group();
  const white = new THREE.MeshLambertMaterial({ color: 0xe8e2d5 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(18, 12, 30), white);
  body.position.y = 6;
  basGroup.add(body);
  for (const [tx, tz] of [[-7, -13], [7, -13], [-7, 13], [7, 13]]) {
    const tower = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.2, 18, 8), white);
    tower.position.set(tx, 9, tz);
    basGroup.add(tower);
    const top = new THREE.Mesh(new THREE.ConeGeometry(2.6, 4, 8), new THREE.MeshLambertMaterial({ color: 0xc7bba4 }));
    top.position.set(tx, 20, tz);
    basGroup.add(top);
  }
  basGroup.position.set(-185, 32, -30);
  ctx.scene.add(basGroup);

  // Tour métallique de Fourvière (mini tour Eiffel)
  const tower = new THREE.Mesh(
    new THREE.ConeGeometry(5, 34, 4, 1, true),
    new THREE.MeshLambertMaterial({ color: 0x5a4438, wireframe: true })
  );
  tower.position.set(-170, 32 + 17, 10);
  ctx.scene.add(tower);

  // Tour Part-Dieu « Le Crayon »
  const crayonBody = new THREE.Mesh(
    new THREE.CylinderGeometry(9, 9, 62, 18),
    new THREE.MeshLambertMaterial({ color: 0xb05a4a })
  );
  crayonBody.position.set(116, 31, -45);
  ctx.scene.add(crayonBody);
  const crayonTip = new THREE.Mesh(
    new THREE.ConeGeometry(9, 14, 18),
    new THREE.MeshLambertMaterial({ color: 0x8d4538 })
  );
  crayonTip.position.set(116, 62 + 7, -45);
  ctx.scene.add(crayonTip);
  addInvisibleWall(ctx, { x: 116, z: -45, w: 18, h: 62, d: 18 });
  void rand;
}

function buildDecor(ctx, rand) {
  // Arbres
  const trunkMat = new THREE.MeshLambertMaterial({ color: 0x5d4632 });
  const leavesMat = new THREE.MeshLambertMaterial({ color: 0x3f6b35 });
  const treeSpots = [];
  for (let i = 0; i < 26; i++) {
    treeSpots.push([
      BELLECOUR.minX - 3 + rand() * (BELLECOUR.maxX - BELLECOUR.minX + 6),
      rand() < 0.5 ? BELLECOUR.minZ - 3 : BELLECOUR.maxZ + 3,
    ]);
  }
  for (let i = 0; i < 14; i++) {
    treeSpots.push([SAONE.maxX + 4, -120 + i * 18]);
    treeSpots.push([RHONE.minX - 4, -120 + i * 18]);
  }
  for (const [x, z] of treeSpots) {
    if (Math.abs(z) < 7) continue; // pas sur l'axe des ponts
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.3, 2.4, 6), trunkMat);
    trunk.position.set(x, 1.2, z);
    const leaves = new THREE.Mesh(new THREE.ConeGeometry(1.7, 3.6, 7), leavesMat);
    leaves.position.set(x, 4.2, z);
    ctx.scene.add(trunk, leaves);
  }

  // Lampadaires autour de Bellecour
  const poleMat = new THREE.MeshLambertMaterial({ color: 0x2c2f36 });
  const lampMat = new THREE.MeshBasicMaterial({ color: 0xffe3a0 });
  for (let i = 0; i < 8; i++) {
    const x = BELLECOUR.minX + 6 + i * 8.2;
    for (const z of [BELLECOUR.minZ + 1.5, BELLECOUR.maxZ - 1.5]) {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.12, 4.4, 6), poleMat);
      pole.position.set(x, 2.2, z);
      const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.28, 8, 8), lampMat);
      lamp.position.set(x, 4.5, z);
      ctx.scene.add(pole, lamp);
    }
  }
}
