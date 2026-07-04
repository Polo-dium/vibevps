#!/usr/bin/env node
// Récupère les bâtiments et rues réels du centre de Lyon depuis OpenStreetMap
// (API Overpass) et produit client/public/lyon-osm.json, utilisé par le jeu
// pour construire la vraie ville. À lancer UNE FOIS sur le VPS :
//
//   node tools/fetch-osm.mjs
//
// Données © les contributeurs OpenStreetMap (ODbL).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, '..', 'client', 'public', 'lyon-osm.json');

// Centre du monde = place Bellecour
const LAT0 = 45.7578;
const LON0 = 4.8320;
const SCALE = 0.5; // ville réduite de moitié pour des trajets de jeu agréables
const M_PER_LON = 111320 * Math.cos((LAT0 * Math.PI) / 180);
const M_PER_LAT = 111132;
const H_SCALE = 0.6;

// Emprise : LE GRAND LYON — de la pointe de la Confluence (sud) au plateau
// de la Croix-Rousse (nord), de Fourvière (ouest) à Part-Dieu (est).
// ~2,3 × 2,8 km en jeu (échelle 0,5). Le JSON pèse plusieurs Mo : il est
// servi une fois puis mis en cache par le navigateur.
const BBOX = '45.7310,4.8080,45.7790,4.8600'; // S, O, N, E

const QUERY = `
[out:json][timeout:120];
(
  way["building"](${BBOX});
  way["highway"~"^(primary|secondary|tertiary|residential|pedestrian|living_street|unclassified|service)$"](${BBOX});
);
out body;
>;
out skel qt;
`;

const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];

function toXZ(lat, lon) {
  return [
    (lon - LON0) * M_PER_LON * SCALE,
    (LAT0 - lat) * M_PER_LAT * SCALE,
  ];
}

function r1(v) { return Math.round(v * 10) / 10; }

function hashCode(s) {
  let h = 0;
  for (let i = 0; i < String(s).length; i++) h = (h * 31 + String(s).charCodeAt(i)) >>> 0;
  return h;
}

function buildingHeight(tags, id) {
  if (tags?.height) {
    const h = parseFloat(String(tags.height).replace(',', '.'));
    if (Number.isFinite(h) && h > 2) return h * H_SCALE;
  }
  if (tags?.['building:levels']) {
    const lv = parseFloat(tags['building:levels']);
    if (Number.isFinite(lv) && lv > 0) return (lv * 3.1 + 2) * H_SCALE;
  }
  // Haussmannien par défaut, varié de façon déterministe
  return (15 + (hashCode(id) % 9)) * H_SCALE;
}

function roadWidth(tags) {
  const t = tags.highway;
  if (t === 'primary') return 8 * 1;
  if (t === 'secondary') return 7;
  if (t === 'tertiary' || t === 'residential' || t === 'unclassified') return 5.5;
  if (t === 'pedestrian' || t === 'living_street') return 4.5;
  return 3;
}

// Fleuves : bandes nord-sud aux longitudes réelles (la donnée eau OSM est en
// multipolygones complexes ; des bandes suffisent visuellement).
const WATER = [
  { name: 'saone', lonW: 4.8249, lonE: 4.8269 },
  { name: 'rhone', lonW: 4.8362, lonE: 4.8392 },
].map(({ name, lonW, lonE }) => ({
  name,
  minX: r1((lonW - LON0) * M_PER_LON * SCALE),
  maxX: r1((lonE - LON0) * M_PER_LON * SCALE),
}));

function inWater(x) {
  return WATER.some((w) => x > w.minX - 2 && x < w.maxX + 2);
}

// Collines réelles, à l'échelle : ellipsoïdes analytiques (cap = plateau).
// Hauteurs en unités jeu (relief réel × H_SCALE).
function hillDef(lonC, latC, rLon, rLat, ry, cap = null) {
  const [cx, cz] = toXZ(latC, lonC);
  return {
    cx: r1(cx), cz: r1(cz),
    rx: r1(rLon * M_PER_LON * SCALE),
    rz: r1(rLat * M_PER_LAT * SCALE),
    ry, cap,
  };
}
const HILLS = [
  // Fourvière : la colline qui prie (~100 m de relief réel)
  hillDef(4.8187, 45.7585, 0.0057, 0.0095, 85),
  // Croix-Rousse : la colline qui travaille — plateau au nord, pentes au sud
  hillDef(4.8325, 45.7760, 0.0095, 0.0090, 60, 42),
];

// Pointe de la Confluence : au sud de cette ligne, les deux fleuves
// se rejoignent (le client y construit la pointe et le musée).
const CONFLUENCE_Z = r1((LAT0 - 45.7330) * M_PER_LAT * SCALE);
// Basilique de Fourvière (position réelle) : sert d'ancre au funiculaire,
// à l'esplanade et aux traboules côté client.
const BASILICA = toXZ(45.7622, 4.8225).map(r1);

async function fetchOsm() {
  let lastErr;
  for (const url of ENDPOINTS) {
    try {
      console.log(`Téléchargement OSM depuis ${url}…`);
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'data=' + encodeURIComponent(QUERY),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      console.warn(`Échec : ${err.message}`);
      lastErr = err;
    }
  }
  throw lastErr;
}

const data = await fetchOsm();
console.log(`${data.elements.length} éléments reçus.`);

const nodes = new Map();
for (const el of data.elements) {
  if (el.type === 'node') nodes.set(el.id, [el.lat, el.lon]);
}

const buildings = [];
const roads = [];
let bound = 200;

for (const el of data.elements) {
  if (el.type !== 'way' || !el.nodes) continue;
  const pts = [];
  for (const nid of el.nodes) {
    const n = nodes.get(nid);
    if (!n) continue;
    const [x, z] = toXZ(n[0], n[1]);
    pts.push([r1(x), r1(z)]);
  }
  if (pts.length < 2) continue;

  if (el.tags?.building) {
    // Anneau fermé : on retire le doublon final
    if (pts.length > 3 &&
        pts[0][0] === pts[pts.length - 1][0] &&
        pts[0][1] === pts[pts.length - 1][1]) {
      pts.pop();
    }
    if (pts.length < 3) continue;
    // Aire (shoelace) : on jette les micro-bâtiments
    let area = 0;
    for (let i = 0; i < pts.length; i++) {
      const [x1, z1] = pts[i];
      const [x2, z2] = pts[(i + 1) % pts.length];
      area += x1 * z2 - x2 * z1;
    }
    area = Math.abs(area) / 2;
    if (area < 8) continue;
    const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length;
    if (inWater(cx)) continue; // donnée douteuse sur l'eau
    const h = r1(buildingHeight(el.tags, el.id));
    buildings.push({ h, p: pts.flat() });
    for (const [x, z] of pts) bound = Math.max(bound, Math.abs(x), Math.abs(z));
  } else if (el.tags?.highway) {
    roads.push({ w: roadWidth(el.tags), p: pts.flat() });
  }
}

const out = {
  attribution: '© les contributeurs OpenStreetMap (ODbL)',
  scale: SCALE,
  bound: Math.ceil(bound + 10),
  water: WATER,
  hills: HILLS,
  confluenceZ: CONFLUENCE_Z,
  poi: { basilica: BASILICA },
  buildings,
  roads,
};

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(out));
const sizeMb = (fs.statSync(OUT).size / 1e6).toFixed(1);
console.log(`OK : ${buildings.length} bâtiments, ${roads.length} rues → ${OUT} (${sizeMb} Mo)`);
console.log('Relance un build pour l’intégrer : npm run build && systemctl restart vibevps');
console.log('(ou attends simplement le prochain déploiement automatique)');
