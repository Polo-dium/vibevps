import * as THREE from 'three';
import { addBox, addInvisibleWall, makeTextTexture } from './utils.js';
import {
  WORLD_BOUND, BELLECOUR, ARCADE, RANGE, SAONE, RHONE, BRIDGE, MUR_PEINT, makeRand,
} from './layout.js';

const PALETTE = ['#cbb697', '#d8c3a5', '#c49a7a', '#b98d6f', '#d6a77a', '#bfae9b', '#c9b29b', '#e0cdb2'];

export function buildCity(ctx) {
  const rand = makeRand(1337);
  buildGroundAndRivers(ctx);
  buildRoads(ctx);
  buildBellecour(ctx);
  buildBuildings(ctx, rand);
  buildSkyline(ctx, rand);
  buildMurPeint(ctx);
  buildLandmarks(ctx, rand);
  buildDecor(ctx, rand);
  buildPeniches(ctx);
  buildGrandeRoue(ctx);
  buildFountain(ctx);
  buildStreetFurniture(ctx);

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
  // Sol asphalte texturé (grain procédural)
  const groundTex = makeAsphaltTexture();
  groundTex.wrapS = groundTex.wrapT = THREE.RepeatWrapping;
  groundTex.repeat.set(90, 90);
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(560, 560),
    new THREE.MeshLambertMaterial({ map: groundTex })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = 0;
  ground.userData.taggable = false;
  ctx.scene.add(ground);

  // Eau animée des deux fleuves (texture qui défile lentement)
  const waterTex = makeWaterTexture();
  waterTex.wrapS = waterTex.wrapT = THREE.RepeatWrapping;
  waterTex.repeat.set(3, 60);
  const waterMat = new THREE.MeshLambertMaterial({
    map: waterTex, transparent: true, opacity: 0.94,
  });
  ctx.updatables.push((dt) => { waterTex.offset.y -= dt * 0.018; });
  for (const river of [SAONE, RHONE]) {
    const w = river.maxX - river.minX;
    const water = new THREE.Mesh(new THREE.PlaneGeometry(w, 560), waterMat);
    water.rotation.x = -Math.PI / 2;
    water.position.set((river.minX + river.maxX) / 2, 0.05, 0);
    ctx.scene.add(water);

    // Bandes de quai en pierre claire le long des berges
    for (const x of [river.minX - 2.2, river.maxX + 2.2]) {
      const quay = new THREE.Mesh(
        new THREE.PlaneGeometry(4, 270),
        new THREE.MeshLambertMaterial({ color: 0x8d8676 })
      );
      quay.rotation.x = -Math.PI / 2;
      quay.position.set(x, 0.011, 0);
      ctx.scene.add(quay);
    }

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

function makeAsphaltTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const g = canvas.getContext('2d');
  g.fillStyle = '#414755';
  g.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 900; i++) {
    const v = 50 + Math.random() * 40;
    g.fillStyle = `rgba(${v + 10}, ${v + 14}, ${v + 24}, 0.5)`;
    g.fillRect(Math.random() * 128, Math.random() * 128, 1.6, 1.6);
  }
  return new THREE.CanvasTexture(canvas);
}

function makeWaterTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const g = canvas.getContext('2d');
  g.fillStyle = '#1d5b66';
  g.fillRect(0, 0, 64, 64);
  for (let i = 0; i < 36; i++) {
    g.strokeStyle = `rgba(${120 + Math.random() * 60}, ${190 + Math.random() * 40}, ${200}, ${0.06 + Math.random() * 0.1})`;
    g.lineWidth = 1 + Math.random() * 1.5;
    const y = Math.random() * 64;
    g.beginPath();
    g.moveTo(0, y);
    g.bezierCurveTo(20, y + 4, 44, y - 4, 64, y);
    g.stroke();
  }
  return new THREE.CanvasTexture(canvas);
}

// Péniches qui remontent lentement les fleuves
function buildPeniches(ctx) {
  const configs = [
    { river: SAONE, offset: -5, z: -60, speed: 2.2, hull: 0x7a3b30 },
    { river: SAONE, offset: 5, z: 70, speed: -1.8, hull: 0x2f4f3e },
    { river: RHONE, offset: -7, z: 20, speed: 2.6, hull: 0x3e3f59 },
    { river: RHONE, offset: 6, z: -90, speed: -2.0, hull: 0x6e5a2e },
  ];
  for (const cfg of configs) {
    const group = new THREE.Group();
    const hull = new THREE.Mesh(
      new THREE.BoxGeometry(4.4, 1.1, 16),
      new THREE.MeshLambertMaterial({ color: cfg.hull })
    );
    hull.position.y = 0.55;
    group.add(hull);
    const deck = new THREE.Mesh(
      new THREE.BoxGeometry(3.8, 0.25, 12),
      new THREE.MeshLambertMaterial({ color: 0x9aa0a8 })
    );
    deck.position.y = 1.2;
    deck.position.z = 1;
    group.add(deck);
    const cabin = new THREE.Mesh(
      new THREE.BoxGeometry(3, 1.6, 3),
      new THREE.MeshLambertMaterial({ color: 0xe5e1d4 })
    );
    cabin.position.set(0, 1.9, -5.5);
    group.add(cabin);

    const cx = (cfg.river.minX + cfg.river.maxX) / 2 + cfg.offset;
    group.position.set(cx, 0.05, cfg.z);
    if (cfg.speed < 0) group.rotation.y = Math.PI;
    ctx.scene.add(group);

    ctx.updatables.push((dt) => {
      group.position.z += cfg.speed * dt;
      if (group.position.z > 150) group.position.z = -150;
      if (group.position.z < -150) group.position.z = 150;
      group.position.y = 0.05 + Math.sin(performance.now() / 900 + cfg.z) * 0.04;
    });
  }
}

// Grande roue de Bellecour
function buildGrandeRoue(ctx) {
  const x = 20, z = 20;
  const R = 7.5;
  const hubY = R + 2;

  // Pylônes
  const pylonMat = new THREE.MeshLambertMaterial({ color: 0xdfe3e8 });
  for (const dx of [-1.6, 1.6]) {
    const pylon = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.35, hubY, 8), pylonMat);
    pylon.position.set(x + dx, hubY / 2, z);
    pylon.rotation.z = dx > 0 ? -0.12 : 0.12;
    ctx.scene.add(pylon);
  }

  // Roue (tourne autour de l'axe X)
  const wheel = new THREE.Group();
  const rim = new THREE.Mesh(
    new THREE.TorusGeometry(R, 0.16, 8, 36),
    new THREE.MeshLambertMaterial({ color: 0xffffff, emissive: 0x222a3a })
  );
  wheel.add(rim);
  const spokeMat = new THREE.MeshLambertMaterial({ color: 0xc5ccd6 });
  for (let i = 0; i < 6; i++) {
    const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.1, R * 2, 0.1), spokeMat);
    spoke.rotation.z = (i / 6) * Math.PI;
    wheel.add(spoke);
  }
  const cabinMat = new THREE.MeshLambertMaterial({ color: 0xd9534f });
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1, 0.9), cabinMat);
    cabin.position.set(Math.cos(a) * R, Math.sin(a) * R, 0);
    wheel.add(cabin);
  }
  const holder = new THREE.Group();
  holder.add(wheel);
  holder.rotation.y = Math.PI / 2; // axe de rotation le long de X (face à l'est-ouest)
  holder.position.set(x, hubY, z);
  ctx.scene.add(holder);
  ctx.updatables.push((dt) => { wheel.rotation.z += dt * 0.12; });

  // Socle (collision)
  addInvisibleWall(ctx, { x, z, w: 4.5, h: 3, d: 2.5 });
}

// Fontaine (clin d'œil à Bartholdi)
function buildFountain(ctx) {
  const x = -22, z = 12;
  const basin = new THREE.Mesh(
    new THREE.CylinderGeometry(2.6, 2.8, 0.7, 14),
    new THREE.MeshLambertMaterial({ color: 0x9aa49e })
  );
  basin.position.set(x, 0.35, z);
  ctx.scene.add(basin);
  const water = new THREE.Mesh(
    new THREE.CircleGeometry(2.35, 14),
    new THREE.MeshLambertMaterial({ color: 0x3d8a96, emissive: 0x123238 })
  );
  water.rotation.x = -Math.PI / 2;
  water.position.set(x, 0.66, z);
  ctx.scene.add(water);
  const column = new THREE.Mesh(
    new THREE.CylinderGeometry(0.4, 0.55, 1.6, 10),
    new THREE.MeshLambertMaterial({ color: 0x8a948e })
  );
  column.position.set(x, 1.4, z);
  ctx.scene.add(column);
  const jet = new THREE.Mesh(
    new THREE.ConeGeometry(0.5, 1.6, 10),
    new THREE.MeshLambertMaterial({ color: 0xcfe8ee, transparent: true, opacity: 0.55 })
  );
  jet.position.set(x, 2.8, z);
  ctx.scene.add(jet);
  ctx.updatables.push((dt) => {
    void dt;
    const s = 0.9 + Math.sin(performance.now() / 300) * 0.12;
    jet.scale.set(s, 1 + Math.sin(performance.now() / 410) * 0.1, s);
  });
  ctx.colliders.push({
    minX: x - 2.8, maxX: x + 2.8, minY: 0, maxY: 1.0, minZ: z - 2.8, maxZ: z + 2.8,
  });
}

// Mobilier urbain : bancs et stations Vélo'v
function buildStreetFurniture(ctx) {
  const woodMat = new THREE.MeshLambertMaterial({ color: 0x5d4632 });
  const ironMat = new THREE.MeshLambertMaterial({ color: 0x2c2f36 });
  const benchSpots = [
    [-14, BELLECOUR.minZ + 4], [4, BELLECOUR.minZ + 4],
    [-14, BELLECOUR.maxZ - 4], [4, BELLECOUR.maxZ - 4],
    [SAONE.maxX + 6, 30], [SAONE.maxX + 6, -40],
    [RHONE.minX - 6, 50], [RHONE.minX - 6, -30],
  ];
  for (const [bx, bz] of benchSpots) {
    const seat = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.1, 0.5), woodMat);
    seat.position.set(bx, 0.48, bz);
    const back = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.45, 0.08), woodMat);
    back.position.set(bx, 0.78, bz - 0.24);
    const legs = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.45, 0.4), ironMat);
    legs.position.set(bx, 0.24, bz);
    ctx.scene.add(seat, back, legs);
    ctx.colliders.push({
      minX: bx - 0.95, maxX: bx + 0.95, minY: 0, maxY: 0.85, minZ: bz - 0.3, maxZ: bz + 0.3,
    });
  }

  // Stations Vélo'v (rouge emblématique)
  const veloMat = new THREE.MeshLambertMaterial({ color: 0xc0392b });
  for (const [sx, sz] of [[34, BELLECOUR.maxZ + 3], [-38, BELLECOUR.minZ - 3]]) {
    for (let i = 0; i < 5; i++) {
      const bike = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.85, 1.4), veloMat);
      bike.position.set(sx + i * 0.65, 0.55, sz);
      ctx.scene.add(bike);
      const wheelF = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.04, 6, 10), ironMat);
      wheelF.rotation.y = Math.PI / 2;
      wheelF.position.set(sx + i * 0.65, 0.3, sz + 0.5);
      ctx.scene.add(wheelF);
    }
    const sign = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.5, 0.06), veloMat);
    sign.position.set(sx + 1.3, 2.2, sz - 0.8);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 2.2, 6), ironMat);
    pole.position.set(sx + 1.3, 1.1, sz - 0.8);
    ctx.scene.add(sign, pole);
    ctx.colliders.push({
      minX: sx - 0.4, maxX: sx + 3.4, minY: 0, maxY: 0.9, minZ: sz - 0.4, maxZ: sz + 0.4,
    });
  }
}

function makeRoadTexture() {
  // Bande de route sombre avec ligne centrale en pointillés
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 128;
  const g = canvas.getContext('2d');
  g.fillStyle = '#31363f';
  g.fillRect(0, 0, 64, 128);
  for (let i = 0; i < 200; i++) {
    const v = 40 + Math.random() * 30;
    g.fillStyle = `rgba(${v}, ${v + 4}, ${v + 12}, 0.5)`;
    g.fillRect(Math.random() * 64, Math.random() * 128, 1.5, 1.5);
  }
  g.fillStyle = '#cdd2b8';
  g.fillRect(29, 12, 6, 44); // pointillé central
  g.fillRect(29, 76, 6, 44);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

function buildRoads(ctx) {
  const tex = makeRoadTexture();
  // [cx, cz, largeur, longueur, le long de X ?]
  const segments = [
    [-119, 0, 9, 30, true],   // EW : Vieux Lyon
    [-11, 0, 9, 132, true],   // EW : Presqu'île (entre les deux fleuves)
    [111, 0, 9, 96, true],    // EW : rive gauche du Rhône
    [12, -75.5, 9, 119, false], // NS : nord de Bellecour
    [12, 82, 9, 108, false],    // NS : sud de Bellecour
    [-50, -75.5, 9, 119, false],
    [-50, 82, 9, 108, false],
    [110, -70, 9, 130, false],  // NS : Part-Dieu
  ];
  for (const [cx, cz, w, len, alongX] of segments) {
    const t = tex.clone();
    t.needsUpdate = true;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(1, Math.max(1, Math.round(len / 9)));
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(w, len),
      new THREE.MeshLambertMaterial({ map: t })
    );
    mesh.rotation.x = -Math.PI / 2;
    if (alongX) mesh.rotation.z = Math.PI / 2;
    // Hauteurs distinctes pour éviter le scintillement aux croisements
    mesh.position.set(cx, alongX ? 0.015 : 0.018, cz);
    ctx.scene.add(mesh);
  }
}

function buildSkyline(ctx, rand) {
  // Silhouette urbaine au-delà de la zone jouable : 1 seul draw call
  const positions = [];
  for (let i = 0; i < 70; i++) {
    const angle = rand() * Math.PI * 2;
    const dist = 165 + rand() * 110;
    const x = Math.cos(angle) * dist;
    const z = Math.sin(angle) * dist;
    if (x < -130 && Math.abs(z) < 70) continue; // on laisse la place à Fourvière
    positions.push([x, z, 10 + rand() * 16, 15 + rand() * 40]);
  }
  const geo = new THREE.BoxGeometry(1, 1, 1);
  geo.translate(0, 0.5, 0);
  const mat = new THREE.MeshLambertMaterial({ color: 0xffffff });
  const inst = new THREE.InstancedMesh(geo, mat, positions.length);
  const m = new THREE.Matrix4();
  const c = new THREE.Color();
  positions.forEach(([x, z, w, h], i) => {
    m.makeScale(w, h, w);
    m.setPosition(x, 0, z);
    inst.setMatrixAt(i, m);
    c.setHSL(0.6, 0.12, 0.32 + rand() * 0.12);
    inst.setColorAt(i, c);
  });
  inst.instanceMatrix.needsUpdate = true;
  ctx.scene.add(inst);
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

  const lots = [];
  const antennaMat = new THREE.MeshLambertMaterial({ color: 0x444a55 });
  const acMat = new THREE.MeshLambertMaterial({ color: 0x9aa0a8 });

  for (let gx = -126; gx <= 126; gx += 24) {
    for (let gz = -126; gz <= 126; gz += 24) {
      const x = gx + (rand() - 0.5) * 4;
      const z = gz + (rand() - 0.5) * 4;
      const w = 12 + rand() * 6;
      const d = 12 + rand() * 6;
      if (isReserved(x, z, Math.max(w, d) / 2 + 1)) continue;
      // Croix-Rousse (nord) et Vieux Lyon (ouest) : immeubles plus hauts/serrés
      const tall = z < -90 || x < -104;
      const h = (tall ? 12 : 8) + rand() * (tall ? 14 : 12);
      const color = new THREE.Color(PALETTE[Math.floor(rand() * PALETTE.length)]);
      const mesh = addBox(ctx, { x, z, w, h, d, color, taggable: true });
      paintFacade(mesh, rand, h);
      // Corniche / toit débordant
      addBox(ctx, { x, y: h, z, w: w + 0.8, h: 0.45, d: d + 0.8, color: 0x7d6a58, collider: false });
      lots.push({ x, z, w, d });

      // Détails de toit (pas de collider : purement décoratif)
      if (rand() < 0.45) {
        const ant = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 2 + rand() * 3, 5), antennaMat);
        ant.position.set(x + (rand() - 0.5) * w * 0.5, h + 1.4, z + (rand() - 0.5) * d * 0.5);
        ctx.scene.add(ant);
      }
      if (rand() < 0.35) {
        const ac = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.7, 1.2), acMat);
        ac.position.set(x + (rand() - 0.5) * w * 0.4, h + 0.8, z + (rand() - 0.5) * d * 0.4);
        ctx.scene.add(ac);
      }
      // Cheminées lyonnaises
      if (rand() < 0.5) {
        const chim = new THREE.Mesh(new THREE.BoxGeometry(0.6, 1.4, 0.6),
          new THREE.MeshLambertMaterial({ color: 0xb05a4a }));
        chim.position.set(x + (rand() - 0.5) * w * 0.5, h + 1.1, z + (rand() - 0.5) * d * 0.5);
        ctx.scene.add(chim);
      }
    }
  }

  // Trottoirs : un seul InstancedMesh pour tous les îlots
  const walkGeo = new THREE.PlaneGeometry(1, 1);
  walkGeo.rotateX(-Math.PI / 2);
  const walk = new THREE.InstancedMesh(
    walkGeo,
    new THREE.MeshLambertMaterial({ color: 0x596170 }),
    lots.length
  );
  const m = new THREE.Matrix4();
  lots.forEach((lot, i) => {
    m.makeScale(lot.w + 5, 1, lot.d + 5);
    m.setPosition(lot.x, 0.012, lot.z);
    walk.setMatrixAt(i, m);
  });
  walk.instanceMatrix.needsUpdate = true;
  ctx.scene.add(walk);
}

// Façade : texture canvas par immeuble — fenêtres encadrées avec appuis,
// rez-de-chaussée commerçant, corniche claire et ombrage au pied du mur.
function paintFacade(mesh, rand, buildingH) {
  const { width, height, depth } = mesh.geometry.parameters;
  const canvas = document.createElement('canvas');
  canvas.width = 96;
  canvas.height = 192;
  const g = canvas.getContext('2d');
  const baseColor = mesh.material.color;
  g.fillStyle = '#' + baseColor.getHexString();
  g.fillRect(0, 0, 96, 192);

  const storeH = Math.min(40, Math.round(192 * (3.2 / buildingH))); // rez-de-chaussée
  const rows = Math.max(2, Math.floor(height / 3));
  const cols = Math.max(2, Math.floor(Math.max(width, depth) / 2.6));
  const usableH = 192 - storeH - 8;
  const ch = usableH / rows, cw = 96 / cols;

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const wx = c * cw + cw * 0.22;
      const wy = 8 + r * ch + ch * 0.18;
      const ww = cw * 0.56, wh = ch * 0.6;
      // Encadrement clair
      g.fillStyle = 'rgba(255, 255, 255, 0.35)';
      g.fillRect(wx - 1.5, wy - 1.5, ww + 3, wh + 3);
      // Vitre (allumée ou pas) avec léger dégradé
      const lit = rand() < 0.22;
      g.fillStyle = lit ? '#ffd98a' : '#26303f';
      g.fillRect(wx, wy, ww, wh);
      if (!lit) {
        g.fillStyle = 'rgba(140, 175, 210, 0.35)'; // reflet de ciel
        g.fillRect(wx, wy, ww, wh * 0.35);
      }
      // Appui de fenêtre
      g.fillStyle = 'rgba(0, 0, 0, 0.25)';
      g.fillRect(wx - 2, wy + wh, ww + 4, 2);
    }
  }

  // Bande de corniche claire en haut
  g.fillStyle = 'rgba(255, 255, 255, 0.25)';
  g.fillRect(0, 0, 96, 5);

  // Rez-de-chaussée : devanture sombre + porte
  g.fillStyle = 'rgba(20, 24, 34, 0.85)';
  g.fillRect(0, 192 - storeH, 96, storeH);
  g.fillStyle = 'rgba(255, 220, 150, 0.5)'; // vitrine éclairée
  g.fillRect(8, 192 - storeH + 6, 50, storeH - 12);
  g.fillStyle = '#3a2c1e';
  g.fillRect(68, 192 - storeH + 4, 18, storeH - 4); // porte

  // Ombre au pied du mur (faux ambient occlusion)
  const grad = g.createLinearGradient(0, 192 - storeH - 18, 0, 192);
  grad.addColorStop(0, 'rgba(0,0,0,0)');
  grad.addColorStop(1, 'rgba(0,0,0,0.28)');
  g.fillStyle = grad;
  g.fillRect(0, 192 - storeH - 18, 96, storeH + 18);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
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
