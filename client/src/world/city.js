import * as THREE from 'three';
import { addBox, addInvisibleWall, makeTextTexture } from './utils.js';
import { buildTraffic } from './traffic.js';
import { audio } from '../audio.js';
import {
  WORLD_BOUND, BELLECOUR, ARCADE, RANGE, SAONE, RHONE, BRIDGE, MUR_PEINT, makeRand,
} from './layout.js';

// Teintes réalistes des façades lyonnaises : ocres, crèmes, roses, saumons
const PALETTE = [
  '#d9c49a', '#e3d0ae', '#d8b183', '#cba57e', '#e0b894',
  '#d6c3a4', '#e6d7bb', '#c9a186', '#e2c1a0', '#d3b691',
];

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
  buildSilure(ctx, RHONE);
  buildGrandeRoue(ctx);
  buildFountain(ctx);
  buildStreetFurniture(ctx);
  buildTraboules(ctx, proceduralTraboules());
  buildTraffic(ctx, [SAONE, RHONE]);
  buildConfluence(ctx);
  // Le lit des fleuves (et le plan d'eau de la Confluence) devient le sol
  composeRiverTerrain(ctx, [SAONE, RHONE], [
    { minX: SAONE.maxX + 0.35, maxX: RHONE.minX - 0.35, minZ: CONFLUENCE_Z, maxZ: 280 },
  ]);

  // Limites du monde — étendues à l'ouest pour rendre Fourvière jouable
  const WEST = -330;
  const EAST = WORLD_BOUND + 2;
  const NS = WORLD_BOUND + 2;
  for (const [x, z, w, d] of [
    [(WEST + EAST) / 2, -NS, EAST - WEST + 8, 4],
    [(WEST + EAST) / 2, NS, EAST - WEST + 8, 4],
    [WEST, 0, 4, NS * 2 + 8],
    [EAST, 0, 4, NS * 2 + 8],
  ]) {
    addInvisibleWall(ctx, { x, z, w, d, h: 80 });
  }
}

// Niveau de l'eau et du lit des fleuves : l'eau coule en contrebas des
// quais, les péniches passent sous les ponts, et on peut tomber dedans
// (les escaliers de quai permettent de remonter).
export const WATER_Y = -1.6;
export const BED_Y = -2.6;
// La Confluence : au sud de cette ligne, la Presqu'île s'arrête et l'eau
// des deux fleuves se rejoint en un grand plan d'eau ouvert.
export const CONFLUENCE_Z = 116;

function buildGroundAndRivers(ctx) {
  // Sol asphalte texturé, en trois bandes : les fleuves sont creusés, et la
  // bande centrale (Presqu'île) s'arrête à la Confluence
  const strips = [
    [-280, SAONE.minX, 280],
    [SAONE.maxX, RHONE.minX, CONFLUENCE_Z], // pointe de la Presqu'île
    [RHONE.maxX, 280, 280],
  ];
  for (const [x0, x1, zMax] of strips) {
    const w = x1 - x0;
    const h = zMax + 280;
    const t = makeAsphaltTexture();
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(Math.max(1, Math.round(w / 6.2)), Math.round(h / 6.2));
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.MeshLambertMaterial({ map: t })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.set((x0 + x1) / 2, 0, (zMax - 280) / 2);
    ground.userData.taggable = false;
    ctx.scene.add(ground);
  }

  for (const river of [SAONE, RHONE]) {
    buildRiverWorks(ctx, river, {
      halfLength: 280,
      bridgesZ: [0, 76, -88],
      withArcs: river === SAONE,
      parapetHalf: WORLD_BOUND,
    });

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
  }
}

// Tout l'aménagement d'un fleuve : lit en contrebas, eau animée, murs de
// quai en pierre, escaliers pour remonter de l'eau, parapets troués au
// droit des ponts, et de VRAIS ponts surélevés (rampes, parapets, piles)
// sous lesquels passent les péniches. Partagé procédural / mode OSM.
export function buildRiverWorks(ctx, band, {
  halfLength = 280, bridgesZ = [0], withArcs = false, parapetHalf = 134,
} = {}) {
  const w = band.maxX - band.minX;
  const cx = (band.minX + band.maxX) / 2;
  const L = halfLength * 2;

  // Lit du fleuve (deviné par transparence)
  const bed = new THREE.Mesh(
    new THREE.PlaneGeometry(w, L),
    new THREE.MeshLambertMaterial({ color: 0x27352b })
  );
  bed.rotation.x = -Math.PI / 2;
  bed.position.set(cx, BED_Y + 0.01, 0);
  ctx.scene.add(bed);

  // Eau animée : deux couches qui défilent + reflet spéculaire
  const waterTex = makeWaterTexture();
  waterTex.wrapS = waterTex.wrapT = THREE.RepeatWrapping;
  waterTex.repeat.set(3, 60);
  const waterTex2 = makeWaterTexture();
  waterTex2.wrapS = waterTex2.wrapT = THREE.RepeatWrapping;
  waterTex2.repeat.set(5, 80);
  const water = new THREE.Mesh(
    new THREE.PlaneGeometry(w, L),
    new THREE.MeshPhongMaterial({
      map: waterTex, transparent: true, opacity: 0.93,
      specular: 0xbdd9e2, shininess: 90,
    })
  );
  water.rotation.x = -Math.PI / 2;
  water.position.set(cx, WATER_Y, 0);
  ctx.scene.add(water);
  const shimmer = new THREE.Mesh(
    new THREE.PlaneGeometry(w, L),
    new THREE.MeshPhongMaterial({
      map: waterTex2, transparent: true, opacity: 0.28,
      specular: 0x9fc4d0, shininess: 60, depthWrite: false,
    })
  );
  shimmer.rotation.x = -Math.PI / 2;
  shimmer.position.set(cx, WATER_Y + 0.03, 0);
  shimmer.userData.noShadow = true;
  ctx.scene.add(shimmer);
  ctx.updatables.push((dt) => {
    waterTex.offset.y -= dt * 0.018;
    waterTex2.offset.y += dt * 0.011;
    waterTex2.offset.x += dt * 0.004;
  });

  // Murs de quai en pierre, du lit au niveau de la rue
  const wallMat = new THREE.MeshLambertMaterial({ color: 0x8a8274 });
  for (const [edge, out] of [[band.minX, -1], [band.maxX, 1]]) {
    const wall = new THREE.Mesh(new THREE.BoxGeometry(0.7, -BED_Y + 0.05, L), wallMat);
    wall.position.set(edge + out * 0.35, (BED_Y + 0.05) / 2, 0);
    ctx.scene.add(wall);
    ctx.colliders.push({
      minX: edge + out * 0.35 - 0.35, maxX: edge + out * 0.35 + 0.35,
      minY: BED_Y - 0.1, maxY: 0.02,
      minZ: -halfLength, maxZ: halfLength,
    });

    // Escaliers de quai : pour remonter quand on est tombé à l'eau
    for (const sz of [-56, 56]) {
      for (let i = 0; i < 5; i++) {
        addBox(ctx, {
          x: edge - out * (0.9 + (4 - i) * 0.85),
          y: BED_Y,
          z: sz,
          w: 1.1, h: 0.52 * (i + 1), d: 2.4,
          color: 0x9a9284,
        });
      }
    }
  }

  // Parapets le long des berges, avec des trouées au droit de chaque pont
  const gaps = [...bridgesZ].sort((a, b) => a - b);
  const GAP = 6.2;
  for (const x of [band.minX, band.maxX]) {
    let z0 = -parapetHalf;
    for (const gz of [...gaps, parapetHalf + GAP]) {
      const z1 = Math.min(gz - GAP, parapetHalf);
      if (z1 - z0 > 1.5) {
        addBox(ctx, {
          x, z: (z0 + z1) / 2, w: 0.7, h: 1.05, d: z1 - z0, color: 0x9aa0a8,
        });
      }
      z0 = gz + GAP;
    }
  }

  // Ponts surélevés : tablier + rampes en marches (step-up) + parapets + piles
  const DECK_Y = 1.25; // dessous du tablier : les péniches passent en dessous
  const pileMat = new THREE.MeshLambertMaterial({ color: 0x7a7264 });
  for (const bz of bridgesZ) {
    addBox(ctx, {
      x: cx, y: DECK_Y, z: bz,
      w: w + 9, h: 0.4, d: 9.5, color: 0x8b8f99,
    });
    // Rampes carrossables : marches basses (0,28 m, avalées par le step-up
    // à pied comme en voiture) cachées sous un plan incliné
    for (const [edge, out] of [[band.minX, -1], [band.maxX, 1]]) {
      for (let i = 1; i <= 6; i++) {
        addBox(ctx, {
          x: edge + out * (4.7 + (6 - i) * 0.8),
          z: bz, w: 0.85, h: i * 0.275, d: 9.5,
          color: 0x7d828c,
        });
      }
      const slopeLen = Math.hypot(5.3, 1.65);
      const slope = new THREE.Mesh(
        new THREE.BoxGeometry(slopeLen, 0.12, 9.5),
        new THREE.MeshLambertMaterial({ color: 0x848a94 })
      );
      slope.position.set(edge + out * 6.75, 0.85, bz);
      slope.rotation.z = -out * Math.atan2(1.65, 5.3);
      ctx.scene.add(slope);
    }
    for (const zr of [bz - 4.4, bz + 4.4]) {
      addBox(ctx, { x: cx, y: DECK_Y + 0.4, z: zr, w: w + 9, h: 0.95, d: 0.4, color: 0x6f7884 });
    }
    // Piles écartées du chenal central (les péniches passent entre)
    for (const px of [cx - w / 3, cx + w / 3]) {
      const pile = new THREE.Mesh(
        new THREE.CylinderGeometry(0.9, 1.1, DECK_Y - BED_Y, 8), pileMat
      );
      pile.position.set(px, (DECK_Y + BED_Y) / 2, bz);
      ctx.scene.add(pile);
    }
    // Arcs supérieurs style passerelle Saint-Georges (Saône, pont central)
    if (withArcs && bz === 0) {
      const archMat = new THREE.MeshLambertMaterial({ color: 0x8a93a5 });
      for (const zr of [bz - 4.4, bz + 4.4]) {
        const arc = new THREE.Mesh(
          new THREE.TorusGeometry(((w + 9) / 2) * 0.92, 0.18, 8, 24, Math.PI),
          archMat
        );
        arc.scale.y = 0.42;
        arc.position.set(cx, DECK_Y + 0.6, zr);
        ctx.scene.add(arc);
        for (let k = -2; k <= 2; k++) {
          const hgt = 5.6 * 0.42 * Math.cos(k / 3.4) * 2.3;
          const cable = new THREE.Mesh(
            new THREE.BoxGeometry(0.08, Math.max(0.6, hgt), 0.08), archMat
          );
          cable.position.set(cx + k * 4.2, DECK_Y + 0.6 + Math.max(0.6, hgt) / 2, zr);
          ctx.scene.add(cable);
        }
      }
    }
  }
}

// Compose le terrain : lit des fleuves en contrebas + colline éventuelle
// (+ rectangles d'eau supplémentaires, comme la Confluence).
// À appeler après buildFourviere (qui pose ctx.terrainHeight = colline).
export function composeRiverTerrain(ctx, bands, extraRects = []) {
  const prev = ctx.terrainHeight;
  ctx.terrainHeight = (x, z) => {
    for (const b of bands) {
      if (x > b.minX + 0.35 && x < b.maxX - 0.35) return BED_Y;
    }
    for (const r of extraRects) {
      if (x > r.minX && x < r.maxX && z > r.minZ && z < r.maxZ) return BED_Y;
    }
    return prev ? prev(x, z) : 0;
  };
}

function makeAsphaltTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const g = canvas.getContext('2d');
  g.fillStyle = '#70757f';
  g.fillRect(0, 0, 128, 128);
  // Taches larges très subtiles (usure) puis grain fin
  for (let i = 0; i < 18; i++) {
    const v = 88 + Math.random() * 26;
    g.fillStyle = `rgba(${v}, ${v + 4}, ${v + 10}, ${0.05 + Math.random() * 0.05})`;
    const r = 10 + Math.random() * 26;
    g.beginPath();
    g.arc(Math.random() * 128, Math.random() * 128, r, 0, Math.PI * 2);
    g.fill();
  }
  for (let i = 0; i < 900; i++) {
    const v = 85 + Math.random() * 50;
    g.fillStyle = `rgba(${v + 8}, ${v + 12}, ${v + 20}, 0.4)`;
    g.fillRect(Math.random() * 128, Math.random() * 128, 1.6, 1.6);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// Toits : tuiles rondes lyonnaises (terre cuite) et zinc, partagés entre bâtiments
let tileRoofMat = null;
function getTileRoofMat() {
  if (tileRoofMat) return tileRoofMat;
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const g = canvas.getContext('2d');
  g.fillStyle = '#a8543c';
  g.fillRect(0, 0, 128, 128);
  for (let y = 0; y < 128; y += 10) {
    // Rangée de tuiles : ombre du recouvrement + arrondis
    g.fillStyle = 'rgba(60, 26, 18, 0.4)';
    g.fillRect(0, y + 8, 128, 2);
    for (let x = 0; x < 128; x += 12) {
      const v = Math.random();
      g.fillStyle = `rgba(${180 + v * 40}, ${95 + v * 25}, ${70 + v * 18}, 0.5)`;
      g.fillRect(x + (y % 20 === 0 ? 0 : 6), y, 10, 8);
      g.fillStyle = 'rgba(70, 30, 20, 0.25)';
      g.fillRect(x + (y % 20 === 0 ? 10 : 4), y, 2, 8);
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(3, 2);
  tileRoofMat = new THREE.MeshLambertMaterial({ map: tex });
  return tileRoofMat;
}

let zincRoofMat = null;
function getZincRoofMat() {
  if (zincRoofMat) return zincRoofMat;
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const g = canvas.getContext('2d');
  g.fillStyle = '#5b626f';
  g.fillRect(0, 0, 128, 128);
  // Joints debout verticaux du zinc
  for (let x = 0; x < 128; x += 16) {
    g.fillStyle = 'rgba(30, 34, 42, 0.5)';
    g.fillRect(x, 0, 2, 128);
    g.fillStyle = 'rgba(200, 210, 224, 0.18)';
    g.fillRect(x + 2, 0, 1.5, 128);
  }
  for (let i = 0; i < 300; i++) {
    const v = 90 + Math.random() * 40;
    g.fillStyle = `rgba(${v}, ${v + 6}, ${v + 14}, 0.2)`;
    g.fillRect(Math.random() * 128, Math.random() * 128, 2.5, 2.5);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(2, 2);
  zincRoofMat = new THREE.MeshLambertMaterial({ map: tex });
  return zincRoofMat;
}

// Toit-terrasse gravillonné partagé (face supérieure de tous les immeubles)
let flatRoofMat = null;
function getFlatRoofMat() {
  if (flatRoofMat) return flatRoofMat;
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const g = canvas.getContext('2d');
  g.fillStyle = '#8a8478';
  g.fillRect(0, 0, 64, 64);
  for (let i = 0; i < 500; i++) {
    const v = 115 + Math.random() * 50;
    g.fillStyle = `rgba(${v}, ${v - 4}, ${v - 12}, 0.45)`;
    g.fillRect(Math.random() * 64, Math.random() * 64, 1.4, 1.4);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  flatRoofMat = new THREE.MeshLambertMaterial({ map: tex });
  return flatRoofMat;
}

// Gravier stabilisé rose de la place Bellecour
function makeGravelTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const g = canvas.getContext('2d');
  g.fillStyle = '#c98f60';
  g.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 30; i++) {
    const v = Math.random();
    g.fillStyle = `rgba(${170 + v * 40}, ${115 + v * 30}, ${75 + v * 25}, 0.12)`;
    g.beginPath();
    g.arc(Math.random() * 128, Math.random() * 128, 10 + Math.random() * 24, 0, Math.PI * 2);
    g.fill();
  }
  for (let i = 0; i < 1400; i++) {
    const v = Math.random();
    g.fillStyle = `rgba(${150 + v * 90}, ${100 + v * 70}, ${65 + v * 50}, 0.5)`;
    g.fillRect(Math.random() * 128, Math.random() * 128, 1.4, 1.4);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

// Canopée : taches de verts variés, pour donner un aspect boisé aux collines
export function makeForestTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const g = canvas.getContext('2d');
  g.fillStyle = '#33512a';
  g.fillRect(0, 0, 256, 256);
  // Gros bouquets d'arbres bien contrastés (lisibles même de loin)
  for (let i = 0; i < 240; i++) {
    const v = Math.random();
    g.fillStyle = `rgba(${40 + v * 75}, ${80 + v * 75}, ${35 + v * 45}, ${0.6 + v * 0.4})`;
    const r = 7 + Math.random() * 16;
    g.beginPath();
    g.arc(Math.random() * 256, Math.random() * 256, r, 0, Math.PI * 2);
    g.fill();
  }
  // Ombres entre les frondaisons
  for (let i = 0; i < 160; i++) {
    g.fillStyle = `rgba(14, 26, 12, ${0.25 + Math.random() * 0.3})`;
    g.beginPath();
    g.arc(Math.random() * 256, Math.random() * 256, 3 + Math.random() * 8, 0, Math.PI * 2);
    g.fill();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(3, 2);
  return tex;
}

// Dalles de trottoir claires avec grain
function makeSidewalkTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const g = canvas.getContext('2d');
  g.fillStyle = '#7e838c';
  g.fillRect(0, 0, 64, 64);
  for (let i = 0; i < 400; i++) {
    const v = 110 + Math.random() * 50;
    g.fillStyle = `rgba(${v}, ${v + 3}, ${v + 8}, 0.4)`;
    g.fillRect(Math.random() * 64, Math.random() * 64, 1.3, 1.3);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

export function makeWaterTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const g = canvas.getContext('2d');
  // Vert-bleu profond du Rhône, avec de larges zones plus sombres
  g.fillStyle = '#1a4f5c';
  g.fillRect(0, 0, 64, 64);
  for (let i = 0; i < 8; i++) {
    g.fillStyle = `rgba(10, 40, 52, ${0.1 + Math.random() * 0.12})`;
    g.beginPath();
    g.arc(Math.random() * 64, Math.random() * 64, 8 + Math.random() * 16, 0, Math.PI * 2);
    g.fill();
  }
  for (let i = 0; i < 36; i++) {
    g.strokeStyle = `rgba(${120 + Math.random() * 60}, ${190 + Math.random() * 40}, ${200}, ${0.06 + Math.random() * 0.1})`;
    g.lineWidth = 1 + Math.random() * 1.5;
    const y = Math.random() * 64;
    g.beginPath();
    g.moveTo(0, y);
    g.bezierCurveTo(20, y + 4, 44, y - 4, 64, y);
    g.stroke();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// Péniches qui remontent lentement les fleuves
export function buildPeniches(ctx, bands = [SAONE, RHONE]) {
  const wrap = (ctx.worldBound ?? 140) + 14;
  const configs = [
    { river: bands[0], offset: -5, z: -60, speed: 2.2, hull: 0x7a3b30 },
    { river: bands[0], offset: 5, z: 70, speed: -1.8, hull: 0x2f4f3e },
    { river: bands[1] ?? bands[0], offset: -7, z: 20, speed: 2.6, hull: 0x3e3f59 },
    { river: bands[1] ?? bands[0], offset: 6, z: -90, speed: -2.0, hull: 0x6e5a2e },
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
    // Cabine surbaissée : la péniche passe sous les tabliers des ponts
    const cabin = new THREE.Mesh(
      new THREE.BoxGeometry(3, 1.15, 3),
      new THREE.MeshLambertMaterial({ color: 0xe5e1d4 })
    );
    cabin.position.set(0, 1.55, -5.5);
    group.add(cabin);

    const cx = (cfg.river.minX + cfg.river.maxX) / 2 + cfg.offset;
    group.position.set(cx, WATER_Y + 0.05, cfg.z);
    if (cfg.speed < 0) group.rotation.y = Math.PI;
    ctx.scene.add(group);

    ctx.updatables.push((dt) => {
      group.position.z += cfg.speed * dt;
      if (group.position.z > wrap) group.position.z = -wrap;
      if (group.position.z < -wrap) group.position.z = wrap;
      group.position.y = WATER_Y + 0.05 + Math.sin(performance.now() / 900 + cfg.z) * 0.04;
    });
  }
}

// La Confluence : au sud, la Presqu'île se termine en pointe sur un grand
// plan d'eau où Rhône et Saône se rejoignent — avec le Musée des Confluences
// en cristal low-poly et, au bout, l'emplacement du futur jetpack.
// Paramétrée pour servir la ville procédurale ET le mode OSM.
export function buildConfluence(ctx, {
  x0 = SAONE.maxX, x1 = RHONE.minX, zStart = CONFLUENCE_Z, zEnd = 280,
} = {}) {
  const w = x1 - x0;
  const cx = (x0 + x1) / 2;
  const L = zEnd - zStart;
  const cz = zStart + L / 2;

  // Lit + eau (raccordées au niveau des fleuves : continuité parfaite)
  const bed = new THREE.Mesh(
    new THREE.PlaneGeometry(w, L),
    new THREE.MeshLambertMaterial({ color: 0x27352b })
  );
  bed.rotation.x = -Math.PI / 2;
  bed.position.set(cx, BED_Y + 0.01, cz);
  ctx.scene.add(bed);
  const waterTex = makeWaterTexture();
  waterTex.wrapS = waterTex.wrapT = THREE.RepeatWrapping;
  waterTex.repeat.set(12, 18);
  const water = new THREE.Mesh(
    new THREE.PlaneGeometry(w, L),
    new THREE.MeshPhongMaterial({
      map: waterTex, transparent: true, opacity: 0.93,
      specular: 0xbdd9e2, shininess: 90,
    })
  );
  water.rotation.x = -Math.PI / 2;
  water.position.set(cx, WATER_Y, cz);
  ctx.scene.add(water);
  ctx.updatables.push((dt) => { waterTex.offset.y -= dt * 0.012; });

  // Mur de quai de la pointe (face sud de la Presqu'île) + parapet troué
  // au niveau de l'escalier de berge
  const wallMat = new THREE.MeshLambertMaterial({ color: 0x8a8274 });
  const wall = new THREE.Mesh(new THREE.BoxGeometry(w, -BED_Y + 0.05, 0.7), wallMat);
  wall.position.set(cx, (BED_Y + 0.05) / 2, zStart + 0.35);
  ctx.scene.add(wall);
  ctx.colliders.push({
    minX: x0, maxX: x1, minY: BED_Y - 0.1, maxY: 0.02,
    minZ: zStart, maxZ: zStart + 0.7,
  });
  for (const [px, len] of [[cx - w / 4 - 3, w / 2 - 8], [cx + w / 4 + 3, w / 2 - 8]]) {
    addBox(ctx, { x: px, z: zStart, w: len, h: 1.05, d: 0.7, color: 0x9aa0a8 });
  }
  // Escalier de berge au milieu de la pointe
  for (let i = 0; i < 5; i++) {
    addBox(ctx, {
      x: cx, y: BED_Y, z: zStart + 0.9 + (4 - i) * 0.85,
      w: 2.4, h: 0.52 * (i + 1), d: 1.1, color: 0x9a9284,
    });
  }

  // Musée des Confluences : le « nuage de cristal » déconstructiviste
  const mx = cx, mz = zStart - 13;
  const glassMat = new THREE.MeshPhongMaterial({
    color: 0xaec9d8, specular: 0xe8f4fa, shininess: 80,
    transparent: true, opacity: 0.85,
  });
  const steelMat = new THREE.MeshLambertMaterial({ color: 0xb8bec8 });
  const museum = new THREE.Group();
  const plinth = new THREE.Mesh(new THREE.BoxGeometry(26, 1.2, 14), steelMat);
  plinth.position.y = 0.6;
  museum.add(plinth);
  const hull = new THREE.Mesh(new THREE.BoxGeometry(24, 7, 12), glassMat);
  hull.position.y = 6;
  hull.rotation.z = 0.06;
  hull.rotation.x = -0.05;
  museum.add(hull);
  const crystal = new THREE.Mesh(new THREE.ConeGeometry(5.5, 9, 4), glassMat);
  crystal.position.set(-9, 8.5, 0);
  crystal.rotation.z = 0.5;
  museum.add(crystal);
  const spike = new THREE.Mesh(new THREE.BoxGeometry(10, 2.6, 6), steelMat);
  spike.position.set(10, 9.4, 0);
  spike.rotation.z = -0.22;
  museum.add(spike);
  for (const [lx, lz] of [[-8, -4], [8, -4], [-8, 4], [8, 4]]) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.55, 3.5, 6), steelMat);
    leg.position.set(lx, 1.7, lz);
    museum.add(leg);
  }
  museum.position.set(mx, 0, mz);
  ctx.scene.add(museum);
  ctx.colliders.push({
    minX: mx - 13, maxX: mx + 13, minY: 0, maxY: 12, minZ: mz - 7, maxZ: mz + 7,
  });
  ctx.interactables.push({
    x: mx, z: mz + 9, r: 6,
    label: 'E — Musée des Confluences',
    action: () => ctx.notify?.('🏛️ Le nuage de cristal, posé là où la Saône embrasse le Rhône.'),
  });

  // Au bout de la pointe : l'emplacement du futur JETPACK
  const pad = new THREE.Mesh(
    new THREE.CylinderGeometry(1.6, 1.8, 0.25, 10),
    new THREE.MeshLambertMaterial({ color: 0x2f3542, emissive: 0x101828 })
  );
  pad.position.set(cx, 0.13, zStart - 2.6);
  ctx.scene.add(pad);
  ctx.interactables.push({
    x: cx, z: zStart - 2.6, r: 2.6,
    label: 'E — ??? (prototype)',
    action: () => ctx.notify?.('🚀 Un prototype de jetpack dort ici… Reviens bientôt, gone.'),
  });
}

// Traboules secrètes : des arches de pierre discrètes qui téléportent d'un
// quartier à l'autre, comme les vrais passages cachés des immeubles lyonnais.
// À découvrir en explorant — aucune n'est indiquée sur le HUD.
// Traboules par défaut de la ville procédurale. En mode OSM, cityReal fournit
// ses propres paires (les positions sûres diffèrent). `y` est la hauteur du
// sol au point donné (0 par défaut, la valeur du terrain sur la colline).
export function proceduralTraboules() {
  return [
    {
      a: { x: -38, z: 6, ry: Math.PI / 2 },
      b: { x: -30, z: -118, ry: 0 },
      loreAB: '🚪 Tu as traboulé jusqu’aux pentes ! Les canuts passaient par là.',
      loreBA: '🚪 Retour à Bellecour par la traboule des canuts.',
    },
    {
      a: { x: -119, z: 2, ry: Math.PI / 2 },
      b: { x: -192, z: -8, ry: Math.PI / 2, y: Math.max(0, hillHeight(-192, -8)) },
      loreAB: '🚪 La ficelle des pauvres : cette traboule grimpe à Fourvière !',
      loreBA: '🚪 Descente express : te voilà au pied du Vieux Lyon.',
    },
    {
      a: { x: 48.5, z: -40, ry: -Math.PI / 2 },
      // Flanc droit de la salle d'arcade (côté est), pas devant la porte
      b: { x: 13, z: -70, ry: Math.PI / 2 },
      loreAB: '🚪 Raccourci de gone : direct à la salle d’arcade.',
      loreBA: '🚪 Sortie secrète de l’arcade, quai du Rhône.',
    },
  ];
}

export function buildTraboules(ctx, PAIRS) {
  const stone = new THREE.MeshLambertMaterial({ color: 0x7d7468 });
  const lintelMat = new THREE.MeshLambertMaterial({ color: 0x6b6257 });
  const portalMat = new THREE.MeshBasicMaterial({ color: 0x0a0714 });
  const glowTex = makeLampHaloTexture();
  const glowMats = [];

  function buildArch(spot) {
    const baseY = spot.y ?? 0;
    const g = new THREE.Group();
    for (const dx of [-1.1, 1.1]) {
      const pillar = new THREE.Mesh(new THREE.BoxGeometry(0.5, 3.1, 0.5), stone);
      pillar.position.set(dx, 1.55, 0);
      g.add(pillar);
    }
    const lintel = new THREE.Mesh(new THREE.BoxGeometry(3, 0.55, 0.6), lintelMat);
    lintel.position.y = 3.3;
    g.add(lintel);
    const portal = new THREE.Mesh(new THREE.PlaneGeometry(1.75, 3.05), portalMat);
    portal.position.y = 1.52;
    g.add(portal);
    const back = portal.clone();
    back.rotation.y = Math.PI;
    g.add(back);
    // Lueur violette la nuit : la traboule se repère de loin après le coucher
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTex, color: 0x9a5cff, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    glow.scale.set(5, 5, 1);
    glow.position.y = 1.8;
    glowMats.push(glow.material);
    g.add(glow);
    g.position.set(spot.x, baseY, spot.z);
    g.rotation.y = spot.ry;
    ctx.scene.add(g);
  }

  function teleportTo(spot, lore) {
    ctx.rideTick?.(spot.x, spot.y ?? 0, spot.z + 2.2);
    audio.traboule();
    ctx.notify?.(lore);
  }

  for (const pair of PAIRS) {
    buildArch(pair.a);
    buildArch(pair.b);
    ctx.interactables.push({
      x: pair.a.x, z: pair.a.z, r: 2.6,
      label: 'E — Traboule secrète…',
      action: () => teleportTo(pair.b, pair.loreAB),
    });
    ctx.interactables.push({
      x: pair.b.x, z: pair.b.z, r: 2.6,
      label: 'E — Traboule secrète…',
      action: () => teleportTo(pair.a, pair.loreBA),
    });
  }

  ctx.updatables.push(() => {
    const op = Math.max(0, (ctx.env?.night ?? 0) * 1.2 - 0.2) * 0.6;
    for (const m of glowMats) m.opacity = op;
  });
}

// Le silure géant du Rhône : toutes les 4 minutes (horloge partagée, donc
// tous les joueurs le voient ensemble), un poisson-chat de 14 m remonte le
// fleuve, dos et nageoire hors de l'eau. So bad it's good.
export function buildSilure(ctx, band) {
  const APPEAR_MS = 4 * 60 * 1000;
  const SWIM_MS = 38 * 1000;
  const cx = (band.minX + band.maxX) / 2;
  const span = (ctx.worldBound ?? 140) + 30;

  const fish = new THREE.Group();
  const skin = new THREE.MeshLambertMaterial({ color: 0x3d4a3a });
  const belly = new THREE.MeshLambertMaterial({ color: 0x6a7360 });
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(1.6, 8, 6, 10), skin);
  body.rotation.x = Math.PI / 2;
  fish.add(body);
  const head = new THREE.Mesh(new THREE.SphereGeometry(1.9, 10, 8), skin);
  head.scale.set(1, 0.75, 1.1);
  head.position.z = -4.6;
  fish.add(head);
  const jaw = new THREE.Mesh(new THREE.SphereGeometry(1.5, 8, 6), belly);
  jaw.scale.set(0.95, 0.5, 1);
  jaw.position.set(0, -0.7, -4.9);
  fish.add(jaw);
  // Nageoire dorsale bien visible hors de l'eau
  const fin = new THREE.Mesh(new THREE.ConeGeometry(1.1, 2.2, 4), skin);
  fin.scale.z = 0.25;
  fin.position.set(0, 1.9, -0.5);
  fish.add(fin);
  // Queue
  const tail = new THREE.Mesh(new THREE.ConeGeometry(1.5, 3.4, 6), skin);
  tail.rotation.x = -Math.PI / 2;
  tail.scale.x = 0.35;
  tail.position.z = 6.2;
  fish.add(tail);
  // Moustaches de silure
  const whiskerMat = new THREE.MeshLambertMaterial({ color: 0x2a332a });
  for (const side of [-1, 1]) {
    const w = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.02, 2.6, 4), whiskerMat);
    w.position.set(side * 1.6, 0.2, -5.6);
    w.rotation.z = side * 1.1;
    w.rotation.x = 0.5;
    fish.add(w);
  }
  fish.visible = false;
  fish.traverse((o) => { o.userData.noShadow = true; });
  ctx.scene.add(fish);

  let announced = false;
  ctx.updatables.push(() => {
    const t = Date.now() % APPEAR_MS;
    if (t >= SWIM_MS) {
      fish.visible = false;
      announced = false;
      return;
    }
    const k = t / SWIM_MS; // 0..1 le long du fleuve
    fish.visible = true;
    if (!announced) {
      announced = true;
      ctx.notify?.('🐟 Le silure géant du Rhône est de sortie ! (regarde le fleuve)');
    }
    const wig = Math.sin(t / 180) * 0.5;
    fish.position.set(cx + wig * 2, WATER_Y - 1.2 + Math.sin(t / 400) * 0.25, -span + k * span * 2);
    fish.rotation.y = Math.PI + wig * 0.18; // remonte vers le nord (-z → +z)
    tail.rotation.y = Math.sin(t / 120) * 0.5;
  });
}

// Grande roue de Bellecour
export function buildGrandeRoue(ctx) {
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

  // --- Tour de Grande Roue : le joueur reste dans sa cabine tant qu'il
  // n'appuie pas sur « Descendre » (l'interactable suit la cabine, le prompt
  // E reste donc affiché pendant tout le tour). Rotation purement visuelle
  // (non synchronisée entre clients) : on peut l'accélérer sans rien casser.
  const anchor = new THREE.Object3D();
  anchor.position.set(R, 0, 0); // cabine d'angle 0
  wheel.add(anchor);
  const cabinWorld = new THREE.Vector3();
  let riding = false;

  const gate = {
    x, z: z + 3.2, r: 3.6,
    label: 'E — Monter dans la Grande Roue',
    action: () => {
      if (!riding) {
        riding = true;
        gate.label = 'E — Descendre de la Grande Roue';
        ctx.notify?.('🎡 Tu tournes au-dessus de Bellecour — appuie sur E quand tu veux descendre.');
      } else {
        dismount();
        ctx.notify?.('🎡 Retour au plancher des gones !');
      }
    },
  };
  function dismount() {
    riding = false;
    gate.label = 'E — Monter dans la Grande Roue';
    gate.x = x;
    gate.z = z + 3.2;
    ctx.rideTick?.(x, 0, z + 3.2); // dépose au pied de la roue
  }

  ctx.updatables.push((dt) => {
    const speed = riding ? 0.35 : 0.12;
    wheel.rotation.z += dt * speed;
    if (!riding) return;
    anchor.getWorldPosition(cabinWorld);
    ctx.rideTick?.(cabinWorld.x, cabinWorld.y - 0.45, cabinWorld.z);
    // L'interactable voyage avec la cabine (portée 2D depuis le joueur)
    gate.x = cabinWorld.x;
    gate.z = cabinWorld.z;
  });

  ctx.abortRides?.push(() => {
    if (!riding) return;
    riding = false;
    gate.label = 'E — Monter dans la Grande Roue';
    gate.x = x;
    gate.z = z + 3.2;
  });
  ctx.interactables.push(gate);

  // Socle (collision)
  addInvisibleWall(ctx, { x, z, w: 4.5, h: 3, d: 2.5 });
}

// Fontaine (clin d'œil à Bartholdi)
export function buildFountain(ctx) {
  const x = -22, z = 12;
  const basin = new THREE.Mesh(
    new THREE.CylinderGeometry(2.6, 2.8, 0.7, 14),
    new THREE.MeshLambertMaterial({ color: 0xbab2a2 })
  );
  basin.position.set(x, 0.35, z);
  ctx.scene.add(basin);
  const water = new THREE.Mesh(
    new THREE.CircleGeometry(2.35, 14),
    new THREE.MeshPhongMaterial({
      color: 0x2e7d8c, emissive: 0x14464f,
      specular: 0xbdd9e2, shininess: 90,
    })
  );
  water.rotation.x = -Math.PI / 2;
  water.position.set(x, 0.66, z);
  ctx.scene.add(water);
  const column = new THREE.Mesh(
    new THREE.CylinderGeometry(0.4, 0.55, 1.6, 10),
    new THREE.MeshLambertMaterial({ color: 0xaaa294 })
  );
  column.position.set(x, 1.4, z);
  ctx.scene.add(column);
  const jet = new THREE.Mesh(
    new THREE.ConeGeometry(0.5, 1.6, 10),
    new THREE.MeshLambertMaterial({
      color: 0xe6f3f7, emissive: 0x5a747c, transparent: true, opacity: 0.6,
    })
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
export function buildStreetFurniture(ctx) {
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
    [12, 69, 9, 82, false],     // NS : sud de Bellecour (jusqu'à la Confluence)
    [-50, -75.5, 9, 119, false],
    [-50, 69, 9, 82, false],
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

  // Passages piétons aux abords de Bellecour
  const cwTex = makeCrosswalkTexture();
  for (const [cx, cz] of [[12, -13], [12, 25], [-50, -13], [-50, 25]]) {
    const cw = new THREE.Mesh(
      new THREE.PlaneGeometry(9, 3.2),
      new THREE.MeshLambertMaterial({ map: cwTex, transparent: true })
    );
    cw.rotation.x = -Math.PI / 2;
    cw.position.set(cx, 0.02, cz);
    ctx.scene.add(cw);
  }
}

function makeCrosswalkTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 48;
  const g = canvas.getContext('2d');
  g.fillStyle = 'rgba(230, 232, 226, 0.85)';
  for (let x = 4; x < 128; x += 22) g.fillRect(x, 2, 12, 44);
  return new THREE.CanvasTexture(canvas);
}

function buildSkyline(ctx, rand) {
  // Silhouette urbaine au-delà de la zone jouable : 1 seul draw call
  const positions = [];
  for (let i = 0; i < 70; i++) {
    const angle = rand() * Math.PI * 2;
    const dist = 165 + rand() * 110;
    const x = Math.cos(angle) * dist;
    const z = Math.sin(angle) * dist;
    if (x < -130) continue; // tout l'ouest est à Fourvière, jouable désormais
    positions.push([x, z, 10 + rand() * 16, 15 + rand() * 40]);
  }
  const geo = new THREE.BoxGeometry(1, 1, 1);
  geo.translate(0, 0.5, 0);
  // Texture de fenêtres quasi blanche, teintée par instance : les tours
  // lointaines lisent comme des immeubles et non comme des blocs nus
  const skyTex = makeSkylineTexture();
  const mat = new THREE.MeshLambertMaterial({ map: skyTex });
  const inst = new THREE.InstancedMesh(geo, mat, positions.length);
  const m = new THREE.Matrix4();
  const c = new THREE.Color();
  positions.forEach(([x, z, w, h], i) => {
    m.makeScale(w, h, w);
    m.setPosition(x, 0, z);
    inst.setMatrixAt(i, m);
    // Teintes délavées vers le bleu : perspective atmosphérique
    c.setHSL(0.58, 0.09, 0.38 + rand() * 0.12);
    inst.setColorAt(i, c);
  });
  inst.instanceMatrix.needsUpdate = true;
  ctx.scene.add(inst);
}

// Grille de fenêtres sombres sur fond clair (multiplié par la teinte du matériau)
export function makeSkylineTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 128;
  const g = canvas.getContext('2d');
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, 64, 128);
  for (let y = 6; y < 122; y += 10) {
    for (let x = 5; x < 58; x += 9) {
      const lit = Math.random() < 0.08;
      g.fillStyle = lit ? 'rgba(255, 214, 140, 0.9)' : 'rgba(30, 40, 55, 0.5)';
      g.fillRect(x, y, 5, 6);
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function buildBellecour(ctx) {
  // Gravier stabilisé rose caractéristique de la place
  const gravelTex = makeGravelTexture();
  gravelTex.repeat.set(10, 7);
  const plaza = new THREE.Mesh(
    new THREE.PlaneGeometry(BELLECOUR.maxX - BELLECOUR.minX, BELLECOUR.maxZ - BELLECOUR.minZ),
    new THREE.MeshLambertMaterial({ map: gravelTex })
  );
  plaza.rotation.x = -Math.PI / 2;
  plaza.position.set(
    (BELLECOUR.minX + BELLECOUR.maxX) / 2, 0.02,
    (BELLECOUR.minZ + BELLECOUR.maxZ) / 2
  );
  ctx.scene.add(plaza);

  // Statue équestre de Louis XIV (le « Roi de bronze » de Bellecour)
  buildLouisXIV(ctx, -2, 6);
}

function buildLouisXIV(ctx, x, z) {
  const stone = new THREE.MeshLambertMaterial({ color: 0x9b9384 });
  const stoneLight = new THREE.MeshLambertMaterial({ color: 0xb0a896 });
  // Bronze patiné (vert-de-gris léger) — Phong pour le reflet au soleil
  const bronze = new THREE.MeshPhongMaterial({
    color: 0x3c5a4a, specular: 0x9fb8a8, shininess: 35, emissive: 0x0c1813,
  });

  // --- Piédestal en pierre (base étagée + fût + corniche) ---
  const ped = new THREE.Group();
  const base = new THREE.Mesh(new THREE.BoxGeometry(5.2, 0.5, 3.6), stoneLight);
  base.position.y = 0.25;
  ped.add(base);
  const shaft = new THREE.Mesh(new THREE.BoxGeometry(4.2, 2.4, 2.8), stone);
  shaft.position.y = 1.7;
  ped.add(shaft);
  const cornice = new THREE.Mesh(new THREE.BoxGeometry(4.7, 0.4, 3.2), stoneLight);
  cornice.position.y = 3.1;
  ped.add(cornice);
  ped.position.set(x, 0, z);
  ctx.scene.add(ped);
  ctx.colliders.push({ minX: x - 2.6, maxX: x + 2.6, minY: 0, maxY: 3.3, minZ: z - 1.8, maxZ: z + 1.8 });

  // --- Statue de bronze (cheval + cavalier) au sommet ---
  const st = new THREE.Group();
  st.position.set(x, 3.3, z);

  // Corps du cheval
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.62, 1.7, 6, 12), bronze);
  body.rotation.z = Math.PI / 2;
  body.position.set(0, 1.65, 0);
  st.add(body);
  // Poitrail / arrière
  const chest = new THREE.Mesh(new THREE.SphereGeometry(0.62, 12, 10), bronze);
  chest.position.set(1.15, 1.65, 0);
  st.add(chest);
  const rump = new THREE.Mesh(new THREE.SphereGeometry(0.6, 12, 10), bronze);
  rump.position.set(-1.15, 1.7, 0);
  st.add(rump);
  // Encolure + tête
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.5, 1.2, 10), bronze);
  neck.position.set(1.55, 2.4, 0);
  neck.rotation.z = -0.7;
  st.add(neck);
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.42, 0.4), bronze);
  head.position.set(2.15, 2.75, 0);
  head.rotation.z = -0.35;
  st.add(head);
  for (const dz of [-0.13, 0.13]) {
    const ear = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.22, 5), bronze);
    ear.position.set(1.95, 3.0, dz);
    st.add(ear);
  }
  // Queue
  const tail = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.05, 1.3, 7), bronze);
  tail.position.set(-1.7, 1.4, 0);
  tail.rotation.z = 0.8;
  st.add(tail);
  // Quatre jambes (avant levées façon statue cabrée légère)
  const legPos = [[1.0, 0.2], [1.0, -0.2], [-1.0, 0.2], [-1.0, -0.2]];
  for (const [lx, lz] of legPos) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.1, 1.5, 7), bronze);
    leg.position.set(lx, 0.78, lz);
    st.add(leg);
    const hoof = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.16, 7), bronze);
    hoof.position.set(lx, 0.08, lz);
    st.add(hoof);
  }

  // Cavalier (Louis XIV)
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.28, 0.55, 5, 10), bronze);
  torso.position.set(0.1, 2.85, 0);
  st.add(torso);
  const rhead = new THREE.Mesh(new THREE.SphereGeometry(0.24, 12, 10), bronze);
  rhead.position.set(0.1, 3.5, 0);
  st.add(rhead);
  // Jambes le long du cheval
  for (const dz of [-0.32, 0.32]) {
    const leg = new THREE.Mesh(new THREE.CapsuleGeometry(0.13, 0.55, 4, 8), bronze);
    leg.position.set(0.05, 2.05, dz);
    leg.rotation.x = dz > 0 ? 0.25 : -0.25;
    st.add(leg);
  }
  // Bras droit levé (bâton de commandement)
  const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.1, 0.5, 4, 8), bronze);
  arm.position.set(0.35, 3.2, -0.35);
  arm.rotation.z = -0.9;
  st.add(arm);
  const baton = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.7, 6), bronze);
  baton.position.set(0.75, 3.55, -0.5);
  baton.rotation.z = -0.5;
  st.add(baton);

  st.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  ctx.scene.add(st);

  // Easter egg « VIVE LE ROI » : 5 balles sur la statue et le Roi de bronze
  // se cabre, l'annonceur tonne, les PNJ alentour acclament. Cooldown 30 s.
  let roiHits = 0;
  let roiCooldownUntil = 0;
  let roiAnim = -1; // temps d'animation en cours (-1 = inactif)
  const baseRotY = st.rotation.y;
  st.traverse((o) => {
    if (!o.isMesh) return;
    o.userData.onHit = () => {
      const now = performance.now();
      if (now < roiCooldownUntil || roiAnim >= 0) return;
      roiHits += 1;
      if (roiHits >= 5) {
        roiHits = 0;
        roiCooldownUntil = now + 30000;
        roiAnim = 0;
        ctx.notify?.('👑 « ON NE TIRE PAS SUR LE ROI, GONE ! »');
        ctx.onRoi?.();
      }
    };
    ctx.shootables.push(o);
  });
  ctx.updatables.push((dt) => {
    if (roiAnim < 0) return;
    roiAnim += dt;
    const D = 1.6;
    if (roiAnim >= D) {
      roiAnim = -1;
      st.position.y = 3.3;
      st.rotation.set(0, baseRotY, 0);
      return;
    }
    const k = Math.sin((roiAnim / D) * Math.PI);
    st.position.y = 3.3 + k * 0.9; // le cheval se cabre
    st.rotation.z = k * 0.38;
    st.rotation.y = baseRotY + Math.sin(roiAnim * 14) * 0.05; // frémissement
  });
}

function buildBuildings(ctx, rand) {
  const reserved = [
    { minX: BELLECOUR.minX - 6, maxX: BELLECOUR.maxX + 6, minZ: BELLECOUR.minZ - 6, maxZ: BELLECOUR.maxZ + 6 },
    { minX: ARCADE.x - ARCADE.w / 2 - 8, maxX: ARCADE.x + ARCADE.w / 2 + 8, minZ: ARCADE.z - ARCADE.d / 2 - 12, maxZ: ARCADE.z + ARCADE.d / 2 + 12 },
    { minX: RANGE.x - RANGE.width / 2 - 8, maxX: RANGE.x + RANGE.width / 2 + 8, minZ: RANGE.backZ - 8, maxZ: RANGE.counterZ + 12 },
    // Marge large : quais + avenues + stationnement — aucun bâtiment ne
    // déborde sur l'eau, la chaussée ou les voitures garées
    { minX: SAONE.minX - 18, maxX: SAONE.maxX + 18, minZ: -300, maxZ: 300 },
    { minX: RHONE.minX - 18, maxX: RHONE.maxX + 18, minZ: -300, maxZ: 300 },
    { minX: -300, maxX: 300, minZ: -9, maxZ: 9 }, // axe est-ouest (ponts)
    { minX: MUR_PEINT.x - 26, maxX: MUR_PEINT.x + 26, minZ: MUR_PEINT.z - 12, maxZ: MUR_PEINT.z + 16 },
    { minX: 105, maxX: 130, minZ: -65, maxZ: -25 }, // tour Part-Dieu
    { minX: -400, maxX: -127, minZ: -300, maxZ: 300 }, // pied de Fourvière
    // Pointe de la Confluence : plan d'eau + Musée des Confluences
    { minX: SAONE.maxX, maxX: RHONE.minX, minZ: CONFLUENCE_Z - 34, maxZ: 300 },
  ];
  const isReserved = (x, z, half) =>
    reserved.some((r) =>
      x + half > r.minX && x - half < r.maxX && z + half > r.minZ && z - half < r.maxZ
    );

  const lots = [];
  const antennaMat = new THREE.MeshLambertMaterial({ color: 0x444a55 });
  const acMat = new THREE.MeshLambertMaterial({ color: 0x9aa0a8 });

  // Enseignes néon type Confluence : ternes le jour, éclatantes la nuit
  const NEON_NAMES = [
    'BOUCHON', 'LE GONE', 'CHEZ PAULETTE', 'QUENELLE D’OR', 'PRALINE ROSE',
    'BAR GUIGNOL', 'LA FENOTTE', 'CAFÉ DES CANUTS', 'LE MÂCHON', 'HÔTEL',
    'TRABOULE CLUB', 'PIZZA DES PENTES',
  ];
  const NEON_COLORS = ['#ff3df0', '#00ffd5', '#ffe14d', '#4dff6a', '#ff7a4d', '#4da6ff'];
  const neonMats = [];
  const neonGlows = [];
  const neonGlowTex = makeLampHaloTexture();
  function addNeonSign(x, z, w, d, rand) {
    const name = NEON_NAMES[Math.floor(rand() * NEON_NAMES.length)];
    const color = NEON_COLORS[Math.floor(rand() * NEON_COLORS.length)];
    const sw = Math.min(w * 0.7, 6.5);
    const sy = 4.2 + rand() * 2.2;
    const mat = new THREE.MeshBasicMaterial({
      map: makeTextTexture(name, {
        color, width: 256, height: 64,
        font: 'bold 34px "Courier New", monospace',
      }),
    });
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(sw, sw * 0.25), mat);
    const face = Math.floor(rand() * 4);
    if (face === 0) sign.position.set(x, sy, z + d / 2 + 0.06);
    else if (face === 1) { sign.position.set(x, sy, z - d / 2 - 0.06); sign.rotation.y = Math.PI; }
    else if (face === 2) { sign.position.set(x + w / 2 + 0.06, sy, z); sign.rotation.y = Math.PI / 2; }
    else { sign.position.set(x - w / 2 - 0.06, sy, z); sign.rotation.y = -Math.PI / 2; }
    sign.userData.noShadow = true;
    ctx.scene.add(sign);
    neonMats.push(mat);
    // Halo coloré derrière l'enseigne, la nuit uniquement
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({
      map: neonGlowTex, color: new THREE.Color(color), transparent: true,
      opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    glow.scale.set(sw * 1.7, sw * 0.8, 1);
    glow.position.copy(sign.position);
    ctx.scene.add(glow);
    neonGlows.push(glow.material);
  }

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

      // Silhouettes variées pour casser le côté cubique
      const style = rand();
      if (style < 0.32) {
        // Étage en retrait (attique)
        const tw = w * 0.62, td = d * 0.62, th = 2.6 + rand() * 2.4;
        const top = addBox(ctx, {
          x: x + (rand() - 0.5) * (w - tw) * 0.4,
          y: h + 0.45,
          z: z + (rand() - 0.5) * (d - td) * 0.4,
          w: tw, h: th, d: td,
          color, collider: false,
        });
        paintFacade(top, rand, th + 4);
        addBox(ctx, {
          x: top.position.x, y: h + 0.45 + th, z: top.position.z,
          w: tw + 0.6, h: 0.35, d: td + 0.6, color: 0x7d6a58, collider: false,
        });
      } else if (style < 0.62) {
        // Toiture en pente (tuiles lyonnaises ou zinc parisien)
        const roofH = 2.2 + rand() * 2.2;
        const roof = new THREE.Mesh(
          new THREE.ConeGeometry((w + 0.8) / Math.SQRT2, roofH, 4),
          rand() < 0.65 ? getTileRoofMat() : getZincRoofMat()
        );
        roof.rotation.y = Math.PI / 4;
        roof.scale.z = (d + 0.8) / (w + 0.8);
        roof.position.set(x, h + 0.45 + roofH / 2, z);
        ctx.scene.add(roof);
      }

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
      // Enseigne néon sur ~1 immeuble sur 4
      if (rand() < 0.26 && h >= 8) addNeonSign(x, z, w, d, rand);
    }
  }

  // Les néons s'embrasent à la nuit tombée (et restent ternes le jour)
  ctx.updatables.push(() => {
    const night = ctx.env?.night ?? 0;
    const on = Math.max(0, night * 1.2 - 0.2);
    const v = 0.3 + 0.7 * on;
    for (const m of neonMats) m.color.setScalar(v);
    for (const m of neonGlows) m.opacity = on * 0.5;
  });

  // Trottoirs : un seul InstancedMesh pour tous les îlots
  const walkGeo = new THREE.PlaneGeometry(1, 1);
  walkGeo.rotateX(-Math.PI / 2);
  const walkTex = makeSidewalkTexture();
  walkTex.repeat.set(8, 8);
  const walk = new THREE.InstancedMesh(
    walkGeo,
    new THREE.MeshLambertMaterial({ map: walkTex }),
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

// Façade : texture canvas par immeuble, style haussmannien lyonnais —
// bandeaux d'étage, fenêtres hautes encadrées de pierre avec garde-corps
// fer forgé, balcon filant, rez-de-chaussée commerçant avec auvent coloré.
const AWNING_COLORS = ['#8c2f39', '#2f5d47', '#31466b', '#6d4a2f', '#484f5c'];
function paintFacade(mesh, rand, buildingH) {
  const { width, height, depth } = mesh.geometry.parameters;
  const W = 192, H = 384;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const g = canvas.getContext('2d');
  const baseColor = mesh.material.color;
  g.fillStyle = '#' + baseColor.getHexString();
  g.fillRect(0, 0, W, H);

  // Grain de pierre (léger bruit clair/foncé)
  for (let i = 0; i < 700; i++) {
    const a = 0.04 + rand() * 0.06;
    g.fillStyle = rand() < 0.5 ? `rgba(255,250,240,${a})` : `rgba(70,60,45,${a})`;
    g.fillRect(rand() * W, rand() * H, 2 + rand() * 3, 2 + rand() * 3);
  }

  const storeH = Math.min(80, Math.round(H * (3.4 / buildingH))); // rez-de-chaussée
  const rows = Math.max(2, Math.floor(height / 3));
  const cols = Math.max(2, Math.floor(Math.max(width, depth) / 2.8));
  const usableH = H - storeH - 14;
  const ch = usableH / rows, cw = W / cols;
  const balconyRow = rows >= 4 ? rows - 2 : -1; // balcon filant au « 2e étage »

  for (let r = 0; r < rows; r++) {
    const rowY = 14 + r * ch;
    // Bandeau de refend entre étages (joint + rehaut de lumière)
    g.fillStyle = 'rgba(90, 78, 60, 0.35)';
    g.fillRect(0, rowY - 2, W, 2);
    g.fillStyle = 'rgba(255, 252, 244, 0.30)';
    g.fillRect(0, rowY, W, 1.5);

    for (let c = 0; c < cols; c++) {
      const wx = c * cw + cw * 0.24;
      const wy = rowY + ch * 0.16;
      const ww = cw * 0.52, wh = ch * 0.62;

      // Encadrement en pierre saillante (clair, ombré à droite/dessous)
      g.fillStyle = 'rgba(250, 246, 236, 0.85)';
      g.fillRect(wx - 3, wy - 3, ww + 6, wh + 6);
      g.fillStyle = 'rgba(80, 70, 55, 0.4)';
      g.fillRect(wx + ww + 1, wy - 3, 2, wh + 6);
      g.fillRect(wx - 3, wy + wh + 1, ww + 6, 2);

      // Vitre : dégradé de reflet de ciel, parfois fenêtre allumée
      const lit = rand() < 0.14;
      if (lit) {
        const gl = g.createLinearGradient(0, wy, 0, wy + wh);
        gl.addColorStop(0, '#ffe3a6');
        gl.addColorStop(1, '#e8ab5e');
        g.fillStyle = gl;
      } else {
        const gl = g.createLinearGradient(0, wy, 0, wy + wh);
        gl.addColorStop(0, '#7e8fa3');
        gl.addColorStop(0.45, '#48586b');
        gl.addColorStop(1, '#2e3947');
        g.fillStyle = gl;
      }
      g.fillRect(wx, wy, ww, wh);
      if (!lit) {
        // Reflet diagonal
        g.fillStyle = 'rgba(190, 212, 232, 0.20)';
        g.beginPath();
        g.moveTo(wx, wy);
        g.lineTo(wx + ww * 0.65, wy);
        g.lineTo(wx, wy + wh * 0.65);
        g.closePath();
        g.fill();
      }
      // Croisée à la française (meneau + 2 traverses)
      g.fillStyle = 'rgba(246, 242, 232, 0.95)';
      g.fillRect(wx + ww / 2 - 1.2, wy, 2.4, wh);
      g.fillRect(wx, wy + wh * 0.36 - 1, ww, 2);
      g.fillRect(wx, wy + wh * 0.72 - 1, ww, 2);

      // Garde-corps fer forgé (balconnet) sauf sur le balcon filant
      if (r !== balconyRow) {
        g.strokeStyle = 'rgba(28, 30, 34, 0.75)';
        g.lineWidth = 1.2;
        const ry0 = wy + wh - ch * 0.14;
        g.beginPath();
        g.moveTo(wx - 2, ry0);
        g.lineTo(wx + ww + 2, ry0);
        g.stroke();
        g.lineWidth = 0.8;
        for (let bx = wx; bx <= wx + ww; bx += 4) {
          g.beginPath();
          g.moveTo(bx, ry0);
          g.lineTo(bx, wy + wh);
          g.stroke();
        }
      }
      // Appui de fenêtre (ombre portée)
      g.fillStyle = 'rgba(0, 0, 0, 0.22)';
      g.fillRect(wx - 4, wy + wh + 3, ww + 8, 2.5);
    }

    // Balcon filant : dalle claire + longue grille sur toute la largeur
    if (r === balconyRow) {
      const by = rowY + ch * 0.78;
      g.fillStyle = 'rgba(245, 240, 228, 0.9)';
      g.fillRect(0, by + ch * 0.14, W, 4);
      g.strokeStyle = 'rgba(26, 28, 32, 0.8)';
      g.lineWidth = 1.4;
      g.beginPath();
      g.moveTo(0, by - ch * 0.1);
      g.lineTo(W, by - ch * 0.1);
      g.stroke();
      g.lineWidth = 0.8;
      for (let bx = 2; bx < W; bx += 4) {
        g.beginPath();
        g.moveTo(bx, by - ch * 0.1);
        g.lineTo(bx, by + ch * 0.14);
        g.stroke();
      }
    }
  }

  // Corniche moulurée en haut (double bande claire + ombre)
  g.fillStyle = 'rgba(255, 252, 244, 0.5)';
  g.fillRect(0, 0, W, 7);
  g.fillStyle = 'rgba(70, 60, 46, 0.35)';
  g.fillRect(0, 7, W, 3);

  // Rez-de-chaussée : soubassement pierre + devantures
  const gy = H - storeH;
  g.fillStyle = 'rgba(158, 146, 122, 0.9)'; // pierre de soubassement
  g.fillRect(0, gy, W, storeH);
  for (let i = 0; i < 120; i++) {
    const a = 0.05 + rand() * 0.07;
    g.fillStyle = rand() < 0.5 ? `rgba(255,250,240,${a})` : `rgba(60,52,40,${a})`;
    g.fillRect(rand() * W, gy + rand() * storeH, 3, 3);
  }
  // Deux vitrines + une porte
  const awning = AWNING_COLORS[Math.floor(rand() * AWNING_COLORS.length)];
  for (const [sx, sw] of [[10, 62], [86, 56]]) {
    // Enseigne au-dessus de la vitrine
    g.fillStyle = awning;
    g.fillRect(sx - 4, gy + 4, sw + 8, 13);
    g.fillStyle = 'rgba(255, 244, 214, 0.85)';
    for (let tx = sx + 4; tx < sx + sw - 6; tx += 9) {
      g.fillRect(tx, gy + 8, 6, 5); // lettres stylisées
    }
    // Vitrine sombre reflétante
    const gl = g.createLinearGradient(0, gy + 19, 0, H - 6);
    gl.addColorStop(0, '#3d4756');
    gl.addColorStop(1, '#191f28');
    g.fillStyle = gl;
    g.fillRect(sx, gy + 19, sw, storeH - 25);
    g.fillStyle = 'rgba(190, 212, 232, 0.14)';
    g.beginPath();
    g.moveTo(sx, gy + 19);
    g.lineTo(sx + sw * 0.5, gy + 19);
    g.lineTo(sx, H - 6 - (storeH - 25) * 0.4);
    g.closePath();
    g.fill();
    // Auvent en toile au-dessus (bande + festons)
    g.fillStyle = awning;
    g.fillRect(sx - 3, gy + 17, sw + 6, 5);
    for (let fx = sx - 3; fx < sx + sw + 3; fx += 8) {
      g.beginPath();
      g.arc(fx + 4, gy + 22, 4, 0, Math.PI);
      g.fill();
    }
  }
  // Porte cochère en bois
  g.fillStyle = '#4a3624';
  g.fillRect(150, gy + 19, 26, storeH - 19);
  g.fillStyle = 'rgba(255, 240, 210, 0.25)';
  g.fillRect(152, gy + 22, 10, storeH - 26);
  g.fillRect(164, gy + 22, 10, storeH - 26);

  // Ombre au pied du mur (faux ambient occlusion)
  const grad = g.createLinearGradient(0, gy - 26, 0, H);
  grad.addColorStop(0, 'rgba(0,0,0,0)');
  grad.addColorStop(1, 'rgba(0,0,0,0.3)');
  g.fillStyle = grad;
  g.fillRect(0, gy - 26, W, storeH + 26);
  // AO vertical léger sur les angles du bâtiment
  for (const [ex, dir] of [[0, 1], [W, -1]]) {
    const ecg = g.createLinearGradient(ex, 0, ex + dir * 14, 0);
    ecg.addColorStop(0, 'rgba(0,0,0,0.18)');
    ecg.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = ecg;
    g.fillRect(Math.min(ex, ex + dir * 14), 0, 14, H);
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  // Façades sur les 4 côtés, vrai toit-terrasse dessus (ordre BoxGeometry :
  // +x, -x, +y (toit), -y, +z, -z) — fini les fenêtres coupées sans toit
  const facadeMat = new THREE.MeshLambertMaterial({ map: tex });
  const roof = getFlatRoofMat();
  mesh.material = [facadeMat, facadeMat, roof, roof, facadeMat, facadeMat];
}

export function buildMurPeint(ctx) {
  // Grande fresque murale à taguer, hommage à la Fresque des Lyonnais :
  // fenêtres en trompe-l'œil et personnages célèbres peints sur le mur
  const { x, z, w, h } = MUR_PEINT;
  const wall = addBox(ctx, {
    x, z, w, h, d: 2.5, taggable: true,
    material: new THREE.MeshLambertMaterial({ map: makeFresqueTexture() }),
  });
  void wall;
  const sign = new THREE.Mesh(
    new THREE.PlaneGeometry(14, 2.4),
    new THREE.MeshBasicMaterial({ map: makeTextTexture('MUR DES LYONNAIS', { color: '#ffb347' }), transparent: true })
  );
  sign.position.set(x, h + 1.6, z + 1.3);
  ctx.scene.add(sign);
}

// La ficelle : funiculaire entre le pied du Vieux Lyon et l'esplanade de
// Fourvière. La cabine n'est pas synchronisée entre clients (comme la Grande
// Roue) : chacun voit sa propre montée, aucun trafic réseau.
// A = gare basse, B = gare haute (esplanade) — THREE.Vector3
export function buildFunicular(ctx, A, B) {
  const dir = B.clone().sub(A);
  const RIDE_S = 12;

  // Voie : une poutre inclinée + pylônes plantés dans la pente
  const railMat = new THREE.MeshLambertMaterial({ color: 0x4a4f58 });
  const rail = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.22, dir.length()), railMat);
  rail.position.copy(A).addScaledVector(dir, 0.5);
  rail.lookAt(B);
  ctx.scene.add(rail);
  for (const t of [0.16, 0.36, 0.56, 0.76]) {
    const p = A.clone().addScaledVector(dir, t);
    const gy = Math.max(0, ctx.terrainHeight?.(p.x, p.z) ?? 0);
    const h = Math.max(0.6, p.y - gy);
    const pyl = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.34, h, 6), railMat);
    pyl.position.set(p.x, gy + h / 2, p.z);
    ctx.scene.add(pyl);
  }

  // Quais de gare + enseigne
  const quaiMat = new THREE.MeshLambertMaterial({ color: 0x8d8676 });
  for (const s of [A, B]) {
    const quai = new THREE.Mesh(new THREE.BoxGeometry(5, 0.5, 6), quaiMat);
    quai.position.set(s.x, s.y - 0.55, s.z + 3.4);
    ctx.scene.add(quai);
  }
  const sign = new THREE.Mesh(
    new THREE.PlaneGeometry(6, 1.3),
    new THREE.MeshBasicMaterial({ map: makeTextTexture('LA FICELLE', { color: '#ffe14d' }), transparent: true })
  );
  sign.position.set(A.x, 3.4, A.z + 6.2);
  ctx.scene.add(sign);

  // Cabine rouge de la ficelle
  const cabin = new THREE.Group();
  const red = new THREE.MeshLambertMaterial({ color: 0xb03a30 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(2.2, 2.1, 3.6), red);
  body.position.y = 1.25;
  cabin.add(body);
  const glassMat = new THREE.MeshLambertMaterial({ color: 0x9fc4d8 });
  const glass = new THREE.Mesh(new THREE.BoxGeometry(2.3, 0.8, 3.0), glassMat);
  glass.position.y = 1.7;
  cabin.add(glass);
  const roofC = new THREE.Mesh(new THREE.BoxGeometry(2.35, 0.18, 3.7),
    new THREE.MeshLambertMaterial({ color: 0x6e2a24 }));
  roofC.position.y = 2.4;
  cabin.add(roofC);
  cabin.position.copy(A);
  ctx.scene.add(cabin);

  let t = 0; // 0 = gare basse, 1 = gare haute
  let riding = 0; // 0 : à quai, +1 : montée, -1 : descente
  const pos = new THREE.Vector3();

  ctx.updatables.push((dt) => {
    if (riding === 0) return;
    t = Math.max(0, Math.min(1, t + (riding * dt) / RIDE_S));
    pos.copy(A).addScaledVector(dir, t);
    cabin.position.copy(pos);
    if (t >= 1 || t <= 0) {
      const arrived = riding > 0;
      riding = 0;
      if (arrived) {
        const ex = B.x, ez = B.z + 3.4;
        ctx.rideTick?.(ex, Math.max(0, ctx.terrainHeight?.(ex, ez) ?? 0), ez);
        ctx.notify?.('🚋 Terminus Fourvière ! La basilique est à deux pas.');
      } else {
        ctx.rideTick?.(A.x, 0, A.z + 3.4);
        ctx.notify?.('🚋 Terminus Vieux Lyon, tout le monde descend !');
      }
    } else {
      ctx.rideTick?.(pos.x, pos.y + 0.3, pos.z);
    }
  });
  ctx.abortRides?.push(() => { riding = 0; });

  ctx.interactables.push({
    x: A.x, z: A.z + 3.4, r: 3.6,
    label: 'E — Prendre la ficelle (funiculaire)',
    action: () => {
      if (riding) return;
      t = 0;
      riding = 1;
      ctx.notify?.('🚋 La ficelle s’ébranle… direction Fourvière !');
    },
  });
  ctx.interactables.push({
    x: B.x, z: B.z + 3.4, r: 4,
    label: 'E — Redescendre en ficelle',
    action: () => {
      if (riding) return;
      t = 1;
      riding = -1;
      ctx.notify?.('🚋 Descente sur le Vieux Lyon, accroche-toi gone.');
    },
  });
}

// Fresque des Lyonnais version low-poly : mur crème, fenêtres en trompe-l'œil,
// et personnages naïfs peints aux balcons avec leur nom.
function makeFresqueTexture() {
  const W = 512, H = 256;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const g = canvas.getContext('2d');

  // Mur crème + grain
  g.fillStyle = '#e6dcc4';
  g.fillRect(0, 0, W, H);
  for (let i = 0; i < 900; i++) {
    const a = 0.03 + Math.random() * 0.05;
    g.fillStyle = Math.random() < 0.5 ? `rgba(255,250,240,${a})` : `rgba(90,75,55,${a})`;
    g.fillRect(Math.random() * W, Math.random() * H, 2, 2);
  }
  // Bandeau titre peint en haut
  g.fillStyle = '#a8543c';
  g.fillRect(0, 0, W, 30);
  g.font = 'bold 20px Georgia, serif';
  g.textAlign = 'center';
  g.fillStyle = '#f5ecd8';
  g.fillText('★ LA FRESQUE DES LYONNAIS ★', W / 2, 21);

  const FIGURES = [
    { name: 'GUIGNOL', body: '#c0392b', hat: '#3a2c1e', special: 'guignol' },
    { name: 'BOCUSE', body: '#f4f4f4', hat: '#ffffff', special: 'toque' },
    { name: 'LUMIÈRE', body: '#4a5568', hat: '#2b2b2e', special: 'camera' },
    { name: 'SAINT-EX', body: '#8a6d3b', hat: '#5d4632', special: 'aviateur' },
    { name: 'AMPÈRE', body: '#3d5a80', hat: null, special: null },
    { name: 'FENOTTE', body: '#9b5d8f', hat: null, special: null },
  ];
  const cols = FIGURES.length;
  const cw = W / cols;
  FIGURES.forEach((f, i) => {
    const cx0 = i * cw + cw / 2;
    const wy = 52, wh = 150, ww = cw * 0.62;
    // Fenêtre trompe-l'œil : encadrement + fond sombre
    g.fillStyle = '#c9b896';
    g.fillRect(cx0 - ww / 2 - 6, wy - 6, ww + 12, wh + 12);
    const gl = g.createLinearGradient(0, wy, 0, wy + wh);
    gl.addColorStop(0, '#5a4a3a');
    gl.addColorStop(1, '#332a20');
    g.fillStyle = gl;
    g.fillRect(cx0 - ww / 2, wy, ww, wh);
    // Balcon
    g.fillStyle = '#8a7a62';
    g.fillRect(cx0 - ww / 2 - 8, wy + wh - 8, ww + 16, 8);
    g.strokeStyle = 'rgba(30,30,34,0.85)';
    g.lineWidth = 2;
    for (let bx = cx0 - ww / 2 - 6; bx <= cx0 + ww / 2 + 6; bx += 7) {
      g.beginPath();
      g.moveTo(bx, wy + wh - 30);
      g.lineTo(bx, wy + wh - 8);
      g.stroke();
    }
    g.beginPath();
    g.moveTo(cx0 - ww / 2 - 8, wy + wh - 30);
    g.lineTo(cx0 + ww / 2 + 8, wy + wh - 30);
    g.stroke();

    // Personnage naïf au balcon : buste + tête + attribut
    const py = wy + wh - 34;
    g.fillStyle = f.body;
    g.beginPath();
    g.roundRect(cx0 - 16, py - 40, 32, 42, 8);
    g.fill();
    g.fillStyle = '#e8c39e';
    g.beginPath();
    g.arc(cx0, py - 52, 13, 0, Math.PI * 2);
    g.fill();
    if (f.special === 'toque') {
      g.fillStyle = '#ffffff';
      g.fillRect(cx0 - 10, py - 82, 20, 20);
      g.beginPath();
      g.arc(cx0, py - 82, 11, Math.PI, 0);
      g.fill();
    } else if (f.special === 'guignol') {
      g.fillStyle = f.hat;
      g.beginPath();
      g.moveTo(cx0 - 15, py - 60);
      g.quadraticCurveTo(cx0, py - 84, cx0 + 15, py - 60);
      g.fill(); // bicorne de Guignol
    } else if (f.special === 'camera') {
      g.fillStyle = '#2b2b2e';
      g.fillRect(cx0 + 12, py - 46, 16, 12); // caméra des frères Lumière
      g.beginPath();
      g.arc(cx0 + 30, py - 40, 5, 0, Math.PI * 2);
      g.fill();
    } else if (f.special === 'aviateur') {
      g.fillStyle = f.hat;
      g.beginPath();
      g.arc(cx0, py - 56, 13, Math.PI, 0);
      g.fill(); // casque d'aviateur
      g.fillStyle = '#d9b44a';
      g.beginPath();
      g.arc(cx0 - 20, py - 30, 6, 0, Math.PI * 2); // Petit Prince
      g.fill();
    } else if (f.hat) {
      g.fillStyle = f.hat;
      g.fillRect(cx0 - 12, py - 66, 24, 6);
    }
    // Nom sous la fenêtre
    g.font = 'bold 13px Georgia, serif';
    g.fillStyle = '#6b4a32';
    g.fillText(f.name, cx0, wy + wh + 24);
  });

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

// Colline de Fourvière, recalée à l'ouest : elle n'avale plus le Vieux Lyon
// ni la Saône maintenant qu'on peut la gravir.
export const HILL = { cx: -215, cz: -20, cy: -4, rx: 90, ry: 38.5, rz: 110 };
export function hillHeight(x, z) {
  const u = (x - HILL.cx) / HILL.rx;
  const v = (z - HILL.cz) / HILL.rz;
  const d = 1 - u * u - v * v;
  return d <= 0 ? 0 : HILL.cy + HILL.ry * Math.sqrt(d);
}

// Fourvière complète et JOUABLE, paramétrée par un ellipsoïde `def`
// ({cx, cz, cy, rx, ry, rz}) : colline boisée grimpable (fonction de hauteur
// analytique), basilique et tour métallique solides, esplanade avec point de
// vue, et la ficelle (funiculaire) sur le flanc est. Utilisée par la ville
// procédurale ET par le mode OSM.
export function buildFourviere(ctx, def) {
  const h = (x, z) => {
    const u = (x - def.cx) / def.rx;
    const v = (z - def.cz) / def.rz;
    const d = 1 - u * u - v * v;
    return d <= 0 ? 0 : def.cy + def.ry * Math.sqrt(d);
  };
  const hill = new THREE.Mesh(
    new THREE.SphereGeometry(70, 24, 16),
    new THREE.MeshLambertMaterial({ map: makeForestTexture() })
  );
  hill.scale.set(def.rx / 70, def.ry / 70, def.rz / 70);
  hill.position.set(def.cx, def.cy, def.cz);
  ctx.scene.add(hill);
  ctx.terrainHeight = h;

  // Esplanade : point de vue sur tout Lyon, au sud de la basilique
  const ex = def.cx + 23, ez = def.cz + 9;
  ctx.interactables.push({
    x: ex, z: ez, r: 7,
    label: 'E — Admirer Lyon depuis Fourvière',
    action: () => ctx.notify?.('🌇 Tout Lyon à tes pieds, gone. La plus belle vue du monde, et c’est pas négociable.'),
  });

  // Basilique Notre-Dame de Fourvière — nef allongée EST-OUEST, comme la
  // vraie : depuis la ville on voit son long profil, la rosace et la Vierge
  // dorée qui regardent Lyon.
  const bx = def.cx + 10, bz = def.cz - 5;
  const by = Math.max(0, h(bx, bz)) - 2.2;
  const basGroup = new THREE.Group();
  const white = new THREE.MeshLambertMaterial({ color: 0xe8e2d5 });
  const cream = new THREE.MeshLambertMaterial({ color: 0xc7bba4 });
  // Nef (longue en x)
  const nave = new THREE.Mesh(new THREE.BoxGeometry(30, 11, 15), white);
  nave.position.y = 5.5;
  basGroup.add(nave);
  // Toit en bâtière : boîte pivotée de 45°, moitié basse noyée dans la nef
  const gable = new THREE.Mesh(new THREE.BoxGeometry(27, 10.6, 10.6), cream);
  gable.rotation.x = Math.PI / 4;
  gable.position.y = 11;
  basGroup.add(gable);
  // 4 tours octogonales aux angles + flèches
  for (const [tx, tz] of [[-13, -6.5], [13, -6.5], [-13, 6.5], [13, 6.5]]) {
    const tower = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 2.6, 17, 8), white);
    tower.position.set(tx, 8.5, tz);
    basGroup.add(tower);
    const top = new THREE.Mesh(new THREE.ConeGeometry(2.8, 4.5, 8), cream);
    top.position.set(tx, 19.2, tz);
    basGroup.add(top);
  }
  // Rosace face à la ville (façade est)
  const rose = new THREE.Mesh(
    new THREE.CircleGeometry(2.6, 12),
    new THREE.MeshLambertMaterial({ color: 0x2f4a7a, emissive: 0x14213a })
  );
  rose.position.set(15.05, 7.5, 0);
  rose.rotation.y = Math.PI / 2;
  basGroup.add(rose);
  // Chapelle Saint-Thomas accolée + Vierge dorée qui veille sur Lyon
  const chapel = new THREE.Mesh(new THREE.CylinderGeometry(2, 2.2, 13, 8), white);
  chapel.position.set(16.5, 6.5, -9);
  basGroup.add(chapel);
  const gold = new THREE.MeshPhongMaterial({
    color: 0xd9b44a, emissive: 0x6a5010, specular: 0xffe9a0, shininess: 60,
  });
  const virgin = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.9, 3.2, 6), gold);
  virgin.position.set(16.5, 14.6, -9);
  basGroup.add(virgin);
  const virginHead = new THREE.Mesh(new THREE.SphereGeometry(0.45, 8, 6), gold);
  virginHead.position.set(16.5, 16.5, -9);
  basGroup.add(virginHead);
  basGroup.position.set(bx, by, bz);
  ctx.scene.add(basGroup);
  ctx.colliders.push({
    minX: bx - 16, maxX: bx + 18, minY: by - 2, maxY: by + 13,
    minZ: bz - 9, maxZ: bz + 9,
  });

  // Tour métallique de Fourvière, au NORD de la basilique (à droite vue
  // depuis la ville) : vrai treillis — pieds évasés, deux plateformes,
  // fût et antenne, comme la « petite tour Eiffel » lyonnaise.
  const mx = def.cx + 18, mz = def.cz - 48;
  const my = Math.max(0, h(mx, mz)) - 1;
  const metal = new THREE.MeshLambertMaterial({ color: 0x6b5a4a });
  const tower = new THREE.Group();
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.4, 14.5, 0.4), metal);
    leg.position.set(sx * 2.1, 7, sz * 2.1);
    leg.rotation.z = -sx * 0.17;
    leg.rotation.x = sz * 0.17;
    tower.add(leg);
    const upper = new THREE.Mesh(new THREE.BoxGeometry(0.3, 10.5, 0.3), metal);
    upper.position.set(sx * 0.85, 18.5, sz * 0.85);
    upper.rotation.z = -sx * 0.07;
    upper.rotation.x = sz * 0.07;
    tower.add(upper);
  }
  // Croisillons horizontaux + plateformes
  for (const [py, ps] of [[6.5, 3.4], [13.8, 2.6], [23.5, 1.6]]) {
    const ring = new THREE.Mesh(new THREE.BoxGeometry(ps, 0.35, ps), metal);
    ring.position.y = py;
    tower.add(ring);
  }
  const shaft = new THREE.Mesh(new THREE.BoxGeometry(1.1, 8, 1.1), metal);
  shaft.position.y = 27.5;
  tower.add(shaft);
  const antenna = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.12, 7, 5), metal);
  antenna.position.y = 35;
  tower.add(antenna);
  const beacon = new THREE.Mesh(
    new THREE.SphereGeometry(0.28, 6, 6),
    new THREE.MeshBasicMaterial({ color: 0xff4040 })
  );
  beacon.position.y = 38.6;
  tower.add(beacon);
  tower.position.set(mx, my, mz);
  ctx.scene.add(tower);
  ctx.colliders.push({ minX: mx - 2.6, maxX: mx + 2.6, minY: my - 2, maxY: my + 38, minZ: mz - 2.6, maxZ: mz + 2.6 });

  // La ficelle : du pied du flanc est jusqu'à l'esplanade
  const A = new THREE.Vector3(def.cx + def.rx + 3, 0.7, def.cz);
  const bY = Math.max(0, h(def.cx + 19.5, def.cz + 8));
  const B = new THREE.Vector3(def.cx + 19.5, bY + 0.3, def.cz + 8);
  buildFunicular(ctx, A, B);
}

function buildLandmarks(ctx, rand) {
  // Fourvière jouable (colline, basilique, ficelle…)
  buildFourviere(ctx, HILL);

  // Tour Part-Dieu « Le Crayon » : fût cylindrique quadrillé de fenêtres,
  // couronne technique claire et pointe pyramidale — sa vraie silhouette
  const towerTex = makeSkylineTexture();
  towerTex.wrapS = towerTex.wrapT = THREE.RepeatWrapping;
  towerTex.repeat.set(10, 7);
  const crayonBody = new THREE.Mesh(
    new THREE.CylinderGeometry(9, 9, 62, 18),
    new THREE.MeshLambertMaterial({ map: towerTex, color: 0xb05a4a })
  );
  crayonBody.position.set(116, 31, -45);
  ctx.scene.add(crayonBody);
  const crown = new THREE.Mesh(
    new THREE.CylinderGeometry(9.4, 9.4, 2.4, 18),
    new THREE.MeshLambertMaterial({ color: 0xd8cfc2 })
  );
  crown.position.set(116, 62, -45);
  ctx.scene.add(crown);
  const crayonTip = new THREE.Mesh(
    new THREE.ConeGeometry(9, 14, 18),
    new THREE.MeshLambertMaterial({ color: 0x8d4538 })
  );
  crayonTip.position.set(116, 63.2 + 7, -45);
  ctx.scene.add(crayonTip);
  addInvisibleWall(ctx, { x: 116, z: -45, w: 18, h: 62, d: 18 });
  void rand;
}

function buildDecor(ctx, rand) {
  // Arbres : alignements réguliers autour de Bellecour (comme les vraies
  // allées de platanes) et le long des quais. Le spawn (x≈0, côté sud)
  // reste dégagé pour laisser voir la place et la statue en arrivant.
  const trunkMat = new THREE.MeshLambertMaterial({ color: 0x6b5138 });
  const leavesMat = new THREE.MeshLambertMaterial({ color: 0x4a7038 });
  const treeSpots = [];
  for (let x = BELLECOUR.minX + 2; x <= BELLECOUR.maxX - 2; x += 7) {
    treeSpots.push([x, BELLECOUR.minZ - 3]);
    if (Math.abs(x) > 6) treeSpots.push([x, BELLECOUR.maxZ + 3]); // trouée au spawn
  }
  for (let i = 0; i < 13; i++) {
    const z = -120 + i * 18; // ≤ 96 : on s'arrête avant la Confluence
    treeSpots.push([SAONE.maxX + 4, z]);
    treeSpots.push([RHONE.minX - 4, z]);
  }
  // Feuillages : amas de sphères, plus organique qu'un cône
  const leavesMat2 = new THREE.MeshLambertMaterial({ color: 0x567c3c });
  const leavesMat3 = new THREE.MeshLambertMaterial({ color: 0x63884a });
  let ti = 0;
  for (const [x, z] of treeSpots) {
    if (Math.abs(z) < 7) continue; // pas sur l'axe des ponts
    ti += 1;
    const s = 0.85 + ((ti * 37) % 10) / 26; // variation déterministe simple
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.28, 2.6 * s, 6), trunkMat);
    trunk.position.set(x, 1.3 * s, z);
    const blob1 = new THREE.Mesh(new THREE.SphereGeometry(1.4 * s, 8, 6), leavesMat);
    blob1.position.set(x, 3.3 * s, z);
    const blob2 = new THREE.Mesh(new THREE.SphereGeometry(1.0 * s, 7, 5), [leavesMat2, leavesMat3][ti % 2]);
    blob2.position.set(x + 0.7 * s, 3.9 * s, z + 0.3 * s);
    const blob3 = new THREE.Mesh(new THREE.SphereGeometry(0.85 * s, 7, 5), leavesMat2);
    blob3.position.set(x - 0.6 * s, 4.1 * s, z - 0.3 * s);
    ctx.scene.add(trunk, blob1, blob2, blob3);
  }

  // Lampadaires : Bellecour, quais et grands axes (voir buildLamps)
  const lampSpots = [];
  for (let i = 0; i < 8; i++) {
    const x = BELLECOUR.minX + 6 + i * 8.2;
    lampSpots.push([x, BELLECOUR.minZ + 1.5], [x, BELLECOUR.maxZ - 1.5]);
  }
  for (let i = 0; i < 6; i++) {
    const z = -100 + i * 40;
    if (Math.abs(z) < 7) continue;
    lampSpots.push([SAONE.maxX + 6.5, z], [RHONE.minX - 6.5, z]);
  }
  const inPlaza = (x, z) =>
    x > BELLECOUR.minX - 4 && x < BELLECOUR.maxX + 4 &&
    z > BELLECOUR.minZ - 4 && z < BELLECOUR.maxZ + 4;
  const inRiver = (x) =>
    (x > SAONE.minX - 4 && x < SAONE.maxX + 4) ||
    (x > RHONE.minX - 4 && x < RHONE.maxX + 4);
  // Axes est-ouest (z = ±6.5 de la route centrale), en quinconce
  for (let x = -126; x <= 126; x += 26) {
    if (inRiver(x)) continue;
    lampSpots.push([x, -6.5], [x + 13, 6.5]);
  }
  // Axes nord-sud
  for (const rx of [12, -50, 110, -119]) {
    for (let z = -124; z <= 124; z += 26) {
      if (Math.abs(z) < 10 || inPlaza(rx + 6.5, z) || inPlaza(rx - 6.5, z)) continue;
      lampSpots.push([rx + (((z + 124) / 26) % 2 === 0 ? 6.5 : -6.5), z]);
    }
  }
  buildLamps(ctx, lampSpots);
}

// Lampadaires mutualisés (les deux modes de ville) : mâts et globes en
// InstancedMesh, halos nocturnes en un unique nuage de Points additif
// → 3 draw calls quel que soit le nombre de lampadaires.
export function buildLamps(ctx, spots) {
  const n = spots.length;
  if (n === 0) return;
  const poles = new THREE.InstancedMesh(
    new THREE.CylinderGeometry(0.09, 0.12, 4.4, 6),
    new THREE.MeshLambertMaterial({ color: 0x2c2f36 }),
    n
  );
  const bulbs = new THREE.InstancedMesh(
    new THREE.SphereGeometry(0.28, 8, 8),
    new THREE.MeshBasicMaterial({ color: 0xffe3a0 }),
    n
  );
  const m = new THREE.Matrix4();
  const haloPos = [];
  spots.forEach(([x, z, gy = 0], i) => {
    // gy = altitude du sol (lampadaires posés sur les collines)
    m.makeTranslation(x, gy + 2.2, z);
    poles.setMatrixAt(i, m);
    m.makeTranslation(x, gy + 4.5, z);
    bulbs.setMatrixAt(i, m);
    haloPos.push(x, gy + 4.4, z);
  });
  poles.instanceMatrix.needsUpdate = true;
  bulbs.instanceMatrix.needsUpdate = true;
  ctx.scene.add(poles, bulbs);

  const haloGeo = new THREE.BufferGeometry();
  haloGeo.setAttribute('position', new THREE.Float32BufferAttribute(haloPos, 3));
  const haloMat = new THREE.PointsMaterial({
    map: makeLampHaloTexture(), size: 7, sizeAttenuation: true,
    transparent: true, opacity: 0,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const halos = new THREE.Points(haloGeo, haloMat);
  halos.userData.noShadow = true;
  ctx.scene.add(halos);
  ctx.updatables.push(() => {
    haloMat.opacity = Math.max(0, (ctx.env?.night ?? 0) * 1.2 - 0.2) * 0.85;
    halos.visible = haloMat.opacity > 0.01;
  });
}

// Halo doux de réverbère (dégradé radial chaud)
function makeLampHaloTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const g = canvas.getContext('2d');
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255, 224, 150, 0.9)');
  grad.addColorStop(0.3, 'rgba(255, 205, 120, 0.35)');
  grad.addColorStop(1, 'rgba(255, 195, 100, 0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(canvas);
}
