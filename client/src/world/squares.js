import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { makeRand } from './layout.js';

// PLACES ET REPÈRES DU VRAI LYON (ville OSM) : les données OSM n'ont que
// les bâtiments et les rues — les grandes places restaient en sol nu (en
// herbe au pied de la Croix-Rousse !). On les dalle à leur vraie position
// (coordonnées GPS → repère du jeu, même projection que tools/fetch-osm.mjs)
// et on y pose leurs fontaines : Bartholdi aux Terreaux, les Jacobins,
// Saint-Jean. Plus la tour métallique de Fourvière, absente des données.
// Les immeubles OSM recouvrent naturellement le dallage là où ils sont :
// pas besoin de découper les places au contour exact.

const LAT0 = 45.7578, LON0 = 4.8320;
export function lyonXZ(lat, lon, scale = 0.5) {
  return [
    (lon - LON0) * 111320 * Math.cos((LAT0 * Math.PI) / 180) * scale,
    (LAT0 - lat) * 111132 * scale,
  ];
}

// [nom, lat, lon, largeur réelle (m, est-ouest), profondeur réelle (nord-sud), rotation (°), fontaine]
const PLACES = [
  ['Place des Terreaux', 45.76742, 4.83345, 105, 82, 0, 'bartholdi'],
  ['Place de la Comédie', 45.76765, 4.83585, 50, 38, 0, null],
  ['Place des Jacobins', 45.76075, 4.83340, 64, 56, 0, 'jacobins'],
  ['Place de la République', 45.76175, 4.83585, 46, 110, 14, 'jets'],
  ['Place Saint-Jean', 45.76075, 4.82810, 44, 36, 0, 'saintjean'],
  ['Place des Célestins', 45.76005, 4.83270, 42, 38, 0, null],
  ['Place Sathonay', 45.76965, 4.83020, 48, 52, 0, null],
  ['Place Carnot', 45.75065, 4.82755, 150, 105, 20, null],
];

function slabTexture() {
  const S = 256;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  const rand = makeRand(2207);
  g.fillStyle = '#9a958b';
  g.fillRect(0, 0, S, S);
  // grandes dalles de granit clair (4 × 4 par tuile de 3 m) en quinconce
  const n = 4, w = S / n;
  for (let r = 0; r < n; r++) {
    for (let k = 0; k < n + 1; k++) {
      const x = k * w - (r % 2) * w * 0.5;
      const t = rand();
      const v = 176 + t * 26;
      g.fillStyle = `rgb(${v},${v - 4},${v - 12})`;
      g.fillRect(x + 1.5, r * w + 1.5, w - 3, w - 3);
      for (let i = 0; i < 70; i++) {
        g.fillStyle = rand() < 0.5 ? 'rgba(60,55,50,0.12)' : 'rgba(255,255,250,0.1)';
        g.fillRect(x + rand() * w, r * w + rand() * w, 1.5, 1.5);
      }
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 8;
  return tex;
}

// Dallage : grille de 2 m qui épouse le terrain, UV en coordonnées monde
function paving(ctx, cx, cz, w, d, yaw) {
  const STEP = 2;
  const nx = Math.max(1, Math.ceil(w / STEP)), nz = Math.max(1, Math.ceil(d / STEP));
  const c = Math.cos(yaw), s = Math.sin(yaw);
  const pos = [], uv = [], idx = [];
  for (let j = 0; j <= nz; j++) {
    for (let i = 0; i <= nx; i++) {
      const lx = -w / 2 + (w * i) / nx, lz = -d / 2 + (d * j) / nz;
      const x = cx + lx * c + lz * s, z = cz - lx * s + lz * c;
      const y = Math.max(0, ctx.terrainHeight?.(x, z) ?? 0) + 0.035;
      pos.push(x, y, z);
      uv.push(x / 3, z / 3);
    }
  }
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const a = j * (nx + 1) + i, b = a + 1, e = a + nx + 1, f = e + 1;
      idx.push(a, e, b, b, e, f);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

const STONE = 0xc9c0ae;
function fountain(ctx, x, z, kind, waterMat) {
  const y = Math.max(0, ctx.terrainHeight?.(x, z) ?? 0);
  const stone = new THREE.MeshLambertMaterial({ color: STONE });
  const bronze = new THREE.MeshStandardMaterial({ color: 0x3e3a33, metalness: 0.7, roughness: 0.45 });
  const lead = new THREE.MeshStandardMaterial({ color: 0x8f969c, metalness: 0.6, roughness: 0.4 });
  const g = new THREE.Group();
  const add = (geo, mat, px, py, pz) => { const m = new THREE.Mesh(geo, mat); m.position.set(px, py, pz); m.castShadow = true; g.add(m); return m; };
  const jets = [];
  const jet = (px, py, pz, h, r) => {
    const m = add(new THREE.ConeGeometry(r, h, 8, 1, true), waterMat.jet, px, py + h / 2, pz);
    m.castShadow = false;
    jets.push(m);
  };
  if (kind === 'bartholdi') {
    // La fontaine Bartholdi : grand bassin, rocher, char de la Garonne tiré
    // par quatre chevaux cabrés (stylisés), vasques de plomb
    const R = 8;
    add(new THREE.CylinderGeometry(R, R + 0.3, 0.7, 28), stone, 0, 0.35, 0);
    add(new THREE.CircleGeometry(R - 0.45, 28).rotateX(-Math.PI / 2), waterMat.pool, 0, 0.62, 0).castShadow = false;
    add(new THREE.CylinderGeometry(2.6, 3.4, 2.2, 10), stone, 0, 1.6, 0);
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * Math.PI * 2 + Math.PI / 4;
      const hx = Math.cos(a) * 3.3, hz = Math.sin(a) * 3.3;
      const horse = new THREE.Group();
      const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.5, 1.5, 4, 8), lead);
      body.rotation.z = Math.PI / 2 - 0.6; // cabré
      body.position.y = 0.7;
      const neck = new THREE.Mesh(new THREE.CapsuleGeometry(0.28, 0.9, 4, 8), lead);
      neck.position.set(0.85, 1.55, 0);
      neck.rotation.z = -0.3;
      const head = new THREE.Mesh(new THREE.CapsuleGeometry(0.2, 0.5, 4, 6), lead);
      head.position.set(1.2, 2.0, 0);
      head.rotation.z = -1.1;
      horse.add(body, neck, head);
      horse.position.set(hx, 2.4, hz);
      horse.rotation.y = -a;
      g.add(horse);
      jet(Math.cos(a) * 1.6, 2.7, Math.sin(a) * 1.6, 1.4, 0.25);
    }
    // char + figure allégorique
    add(new THREE.BoxGeometry(2.4, 1.0, 1.6), lead, 0, 3.2, 0);
    add(new THREE.CapsuleGeometry(0.45, 1.6, 4, 10), lead, 0, 4.9, 0);
    add(new THREE.SphereGeometry(0.32, 10, 8), lead, 0, 6.1, 0);
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      jet(Math.cos(a) * (R - 1.6), 0.6, Math.sin(a) * (R - 1.6), 1.0, 0.18);
    }
  } else if (kind === 'jacobins' || kind === 'saintjean') {
    // Fontaine à vasques superposées (Jacobins : quatre statues autour)
    const big = kind === 'jacobins';
    const R = big ? 5 : 3.2;
    add(new THREE.CylinderGeometry(R, R + 0.25, 0.6, 24), stone, 0, 0.3, 0);
    add(new THREE.CircleGeometry(R - 0.35, 24).rotateX(-Math.PI / 2), waterMat.pool, 0, 0.55, 0).castShadow = false;
    add(new THREE.CylinderGeometry(0.5, 0.8, big ? 3.2 : 2.2, 10), stone, 0, big ? 1.9 : 1.4, 0);
    add(new THREE.CylinderGeometry(big ? 2.2 : 1.5, 0.6, 0.45, 18), stone, 0, big ? 3.4 : 2.5, 0);
    add(new THREE.CylinderGeometry(0.35, 0.5, 1.6, 10), stone, 0, big ? 4.4 : 3.3, 0);
    add(new THREE.CylinderGeometry(big ? 1.1 : 0.8, 0.35, 0.3, 14), stone, 0, big ? 5.2 : 4.1, 0);
    jet(0, big ? 5.3 : 4.2, 0, 1.2, 0.22);
    if (big) {
      for (let k = 0; k < 4; k++) {
        const a = (k / 4) * Math.PI * 2;
        add(new THREE.CapsuleGeometry(0.3, 1.0, 4, 8), bronze, Math.cos(a) * 1.5, 2.4, Math.sin(a) * 1.5);
        add(new THREE.SphereGeometry(0.22, 8, 6), bronze, Math.cos(a) * 1.5, 3.2, Math.sin(a) * 1.5);
      }
    }
  } else if (kind === 'jets') {
    // jets d'eau au ras du dallage (place de la République)
    for (let k = 0; k < 10; k++) {
      const pz = -18 + k * 4;
      add(new THREE.CircleGeometry(0.35, 10).rotateX(-Math.PI / 2), waterMat.pool, 0, 0.045, pz).castShadow = false;
      jet(0, 0.04, pz, 1.1 + (k % 3) * 0.4, 0.14);
    }
  }
  g.position.set(x, y, z);
  ctx.scene.add(g);
  if (kind !== 'jets') {
    const r = kind === 'bartholdi' ? 8.3 : kind === 'jacobins' ? 5.3 : 3.5;
    ctx.colliders.push({ minX: x - r * 0.75, maxX: x + r * 0.75, minZ: z - r * 0.75, maxZ: z + r * 0.75, minY: y, maxY: y + 0.7 });
  }
  return jets;
}

// Tour métallique de Fourvière (1894, 86 m) : treillis effilé à quatre
// pieds, deux plateformes, fût et antenne — absente des données OSM
function tourMetallique(ctx, x, z, H) {
  const y0 = Math.max(0, ctx.terrainHeight?.(x, z) ?? 0) - 0.5;
  const parts = [];
  const beam = (ax, ay, az, bx, by, bz, r) => {
    const a = new THREE.Vector3(ax, ay, az), b = new THREE.Vector3(bx, by, bz);
    const len = a.distanceTo(b);
    const g = new THREE.CylinderGeometry(r, r, len, 4, 1, true);
    g.translate(0, len / 2, 0);
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize()));
    g.translate(ax, ay, az);
    parts.push(g);
  };
  // demi-largeur du fût en fonction de la hauteur : évasé en bas, effilé
  const half = (h) => 0.35 + 3.6 * Math.pow(1 - h / H, 2.2);
  const LEV = 14;
  for (let i = 0; i < LEV; i++) {
    const h0 = (H * 0.86 * i) / LEV, h1 = (H * 0.86 * (i + 1)) / LEV;
    const w0 = half(h0), w1 = half(h1);
    const C = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
    for (let k = 0; k < 4; k++) {
      const [sx, sz] = C[k], [tx, tz] = C[(k + 1) % 4];
      beam(sx * w0, h0, sz * w0, sx * w1, h1, sz * w1, 0.16);     // montant
      beam(sx * w0, h0, sz * w0, tx * w1, h1, tz * w1, 0.07);     // croix de Saint-André
      beam(tx * w0, h0, tz * w0, sx * w1, h1, sz * w1, 0.07);
      beam(sx * w1, h1, sz * w1, tx * w1, h1, tz * w1, 0.08);     // ceinture
    }
  }
  const plat = (h, w) => { const g = new THREE.BoxGeometry(w * 2 + 1, 0.25, w * 2 + 1); g.translate(0, h, 0); parts.push(g); };
  plat(H * 0.3, half(H * 0.3));
  plat(H * 0.62, half(H * 0.62));
  beam(0, H * 0.86, 0, 0, H, 0, 0.18); // antenne
  const geo = mergeGeometries(parts.map((p) => (p.index ? p.toNonIndexed() : p)).map((p) => {
    for (const k of Object.keys(p.attributes)) if (k !== 'position' && k !== 'normal') p.deleteAttribute(k);
    return p;
  }));
  const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color: 0x8a7a66 }));
  mesh.position.set(x, y0, z);
  mesh.castShadow = true;
  ctx.scene.add(mesh);
  // feu rouge de balisage au sommet
  const light = new THREE.Mesh(new THREE.SphereGeometry(0.35, 8, 6), new THREE.MeshBasicMaterial({ color: 0xff3020 }));
  light.position.set(x, y0 + H + 0.3, z);
  light.userData.noShadow = true;
  ctx.scene.add(light);
  ctx.colliders.push({ minX: x - 3.8, maxX: x + 3.8, minZ: z - 3.8, maxZ: z + 3.8, minY: y0, maxY: y0 + 2 });
  ctx.pois?.push({ id: 'tour-metallique', nom: 'Tour métallique de Fourvière', emoji: '🗼', x, z });
}

export function buildPlacesLyon(ctx, scale = 0.5) {
  const mat = new THREE.MeshLambertMaterial({
    map: slabTexture(), polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
  });
  const waterMat = {
    pool: new THREE.MeshStandardMaterial({ color: 0x24494f, roughness: 0.08, metalness: 0, envMapIntensity: 1 }),
    jet: new THREE.MeshLambertMaterial({ color: 0xe8f4f8, emissive: 0x4a6870, transparent: true, opacity: 0.55, depthWrite: false }),
  };
  const geos = [];
  const jets = [];
  for (const [nom, lat, lon, w, d, rot, kind] of PLACES) {
    const [x, z] = lyonXZ(lat, lon, scale);
    if (ctx.waterMask?.isWater(x, z)) continue;
    geos.push(paving(ctx, x, z, w * scale, d * scale, (rot * Math.PI) / 180));
    if (kind) {
      // Bartholdi : côté nord de la place, face à l'Hôtel de Ville
      const fz = kind === 'bartholdi' ? z - d * scale * 0.18 : z;
      jets.push(...fountain(ctx, x, fz, kind, waterMat));
    }
    ctx.pois?.push({ id: nom.toLowerCase().replace(/\W+/g, '-'), nom, emoji: '⛲', x, z });
  }
  const mesh = new THREE.Mesh(mergeGeometries(geos), mat);
  mesh.receiveShadow = true;
  mesh.name = 'places';
  ctx.scene.add(mesh);
  // Jets d'eau qui pulsent doucement
  let t = 0;
  ctx.updatables.push((dt) => {
    t += dt;
    for (let i = 0; i < jets.length; i++) jets[i].scale.y = 0.85 + 0.15 * Math.sin(t * 3 + i * 1.7);
  });
  // Tour métallique : ~47 m à l'ouest et ~33 m au nord de la basilique —
  // écart réel reporté depuis la basilique DU JEU (reculée de 18 m vers
  // l'ouest dans cityReal.js), sinon la tour lui rentrerait dedans
  const [tx, tz] = lyonXZ(45.76250, 4.82190, scale);
  const [bx, bz] = lyonXZ(45.76220, 4.82250, scale);
  const bas = ctx.pois?.find((p) => p.id === 'basilique');
  tourMetallique(ctx, (bas?.x ?? bx) + (tx - bx), (bas?.z ?? bz) + (tz - bz), 86 * 0.6);
}
