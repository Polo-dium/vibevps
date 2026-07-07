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
[out:json][timeout:300];
(
  way["building"](${BBOX});
  way["highway"~"^(primary|secondary|tertiary|residential|pedestrian|living_street|unclassified|service)$"](${BBOX});
  way["waterway"="river"](${BBOX});
  way["natural"="water"](${BBOX});
  way["waterway"="riverbank"](${BBOX});
  relation["natural"="water"](${BBOX});
  relation["waterway"="riverbank"](${BBOX});
);
out body;
>;
out skel qt;
`;

const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];

// Overpass filtre les clients anonymes (HTTP 406) et limite par IP (429) :
// on s'identifie proprement et on réessaie par vagues espacées.
const HEADERS = {
  'Content-Type': 'application/x-www-form-urlencoded',
  Accept: 'application/json',
  'User-Agent': 'vibevps-lyon-arcade/1.0 (+https://github.com/Polo-dium/vibevps)',
};

const sleep = (s) => new Promise((r) => setTimeout(r, s * 1000));

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

// Fleuves : largeur réelle (bande de longitudes), mais tracé courbe récupéré
// depuis les lignes `waterway=river` d'OSM (voir buildRiverCenters plus bas).
// baseCx = longitude centrale, half = demi-largeur (mètres jeu).
const WATER = [
  { name: 'saone', lonW: 4.8249, lonE: 4.8269, match: /sa[oô]ne/i },
  { name: 'rhone', lonW: 4.8362, lonE: 4.8392, match: /rh[oô]ne/i },
].map(({ name, lonW, lonE, match }) => {
  const minX0 = (lonW - LON0) * M_PER_LON * SCALE;
  const maxX0 = (lonE - LON0) * M_PER_LON * SCALE;
  return {
    name, match,
    baseCx: (minX0 + maxX0) / 2,
    half: (maxX0 - minX0) / 2,
    minX: r1(minX0), maxX: r1(maxX0), // recalculés si un tracé courbe existe
  };
});

// Emprise du bbox en coordonnées jeu : IMPORTANT, les lignes `waterway=river`
// d'OSM sont d'immenses polylignes (la Saône/le Rhône font des centaines de
// km) et la récursion `>;` en ramène TOUS les nœuds, très loin hors carte.
// On clippe donc les points à cette boîte avant de reconstruire le tracé.
const [B_S, B_W, B_N, B_E] = BBOX.split(',').map(Number);
const CLIP = {
  minX: (B_W - LON0) * M_PER_LON * SCALE,
  maxX: (B_E - LON0) * M_PER_LON * SCALE,
  minZ: (LAT0 - B_N) * M_PER_LAT * SCALE,
  maxZ: (LAT0 - B_S) * M_PER_LAT * SCALE,
};
// Écart maxi autour de la médiane (mètres jeu) : NE PAS aplatir le vrai
// méandre (le fleuve doit rester dans le couloir laissé par les bâtiments) —
// cette borne large n'écarte qu'un nœud franchement aberrant.
const RIVER_MAXDEV = 160;

// Construit le tracé central [[z, x], …] de chaque fleuve à partir des lignes
// `waterway=river` d'OSM, clippées à la carte. On regroupe les points par
// tranches de z (nord-sud) et on moyenne x : ça lisse les segments multiples
// en une seule courbe triée, ancrée sur la position médiane réelle du fleuve.
function buildRiverCenters(elements, nodeMap) {
  const pointsByRiver = new Map(WATER.map((w) => [w.name, []]));
  for (const el of elements) {
    if (el.type !== 'way' || el.tags?.waterway !== 'river' || !el.nodes) continue;
    const nm = el.tags.name || '';
    const pts = [];
    for (const nid of el.nodes) {
      const n = nodeMap.get(nid);
      if (!n) continue;
      const [x, z] = toXZ(n[0], n[1]);
      // Clip à l'emprise de la carte (± petite marge) : on jette l'amont/aval
      if (x < CLIP.minX - 40 || x > CLIP.maxX + 40 ||
          z < CLIP.minZ - 40 || z > CLIP.maxZ + 40) continue;
      pts.push([x, z]);
    }
    if (pts.length < 2) continue;
    // Classe par nom si dispo, sinon par position moyenne (Saône = ouest)
    const avgX = pts.reduce((s, p) => s + p[0], 0) / pts.length;
    let river = WATER.find((w) => w.match.test(nm));
    if (!river) river = avgX < 0 ? WATER[0] : WATER[1];
    pointsByRiver.get(river.name).push(...pts);
  }
  for (const w of WATER) {
    const pts = pointsByRiver.get(w.name);
    if (pts.length < 4) continue; // pas de données in-map : on garde la bande droite
    // Position médiane réelle du fleuve (robuste aux valeurs aberrantes)
    const xs = pts.map((p) => p[0]).sort((a, b) => a - b);
    const medX = xs[xs.length >> 1];
    // Tranches de z de 12 m, x moyen par tranche → vrai tracé courbe, monotone
    // en z. On écarte seulement les nœuds franchement aberrants (> ±MAXDEV de
    // la médiane) pour NE PAS aplatir le méandre réel.
    const BIN = 12, bins = new Map();
    for (const [x, z] of pts) {
      if (Math.abs(x - medX) > RIVER_MAXDEV) continue;
      const k = Math.round(z / BIN);
      const b = bins.get(k) || [0, 0];
      b[0] += x; b[1] += 1;
      bins.set(k, b);
    }
    const center = [...bins.entries()]
      .map(([k, [sx, n]]) => [r1(k * BIN), r1(sx / n)])
      .sort((a, b) => a[0] - b[0]);
    if (center.length < 2) continue;
    w.center = center;
    // Fleuve repositionné sur son tracé réel : boîte englobante recalculée
    let lo = Infinity, hi = -Infinity;
    for (const [, x] of center) { lo = Math.min(lo, x); hi = Math.max(hi, x); }
    w.minX = r1(lo - w.half);
    w.maxX = r1(hi + w.half);
    console.log(`  ${w.name} : tracé courbe (${center.length} pts, médiane x=${r1(medX)})`);
  }
}

// Nettoie les clés internes avant export (garde name/minX/maxX/center/w)
function cleanWater() {
  return WATER.map((w) => {
    const o = { name: w.name, minX: w.minX, maxX: w.maxX, w: r1(w.half * 2) };
    if (w.center) o.center = w.center;
    return o;
  });
}

// --- Surfaces d'eau réelles (natural=water / waterway=riverbank) --------------
// C'est la source LA PLUS FIABLE pour placer les fleuves : on lit la vraie
// géométrie de l'eau (pas un trou deviné entre bâtiments). On assemble les
// anneaux (ways fermées + relations multipolygones), on les projette, on les
// coupe à l'emprise de la carte et on exporte data.waterPolys.
function interpX(a, b, x) { const t = (x - a[0]) / ((b[0] - a[0]) || 1e-9); return [x, a[1] + (b[1] - a[1]) * t]; }
function interpZ(a, b, z) { const t = (z - a[1]) / ((b[1] - a[1]) || 1e-9); return [a[0] + (b[0] - a[0]) * t, z]; }
function clipPolyToBox(poly, box) {
  const M = 40; // petite marge autour du bbox
  const clips = [
    { in: (q) => q[0] >= box.minX - M, at: (a, b) => interpX(a, b, box.minX - M) },
    { in: (q) => q[0] <= box.maxX + M, at: (a, b) => interpX(a, b, box.maxX + M) },
    { in: (q) => q[1] >= box.minZ - M, at: (a, b) => interpZ(a, b, box.minZ - M) },
    { in: (q) => q[1] <= box.maxZ + M, at: (a, b) => interpZ(a, b, box.maxZ + M) },
  ];
  let p = poly;
  for (const c of clips) {
    if (p.length < 3) return [];
    const res = [];
    for (let i = 0; i < p.length; i++) {
      const cur = p[i], prev = p[(i + p.length - 1) % p.length];
      const ci = c.in(cur), pi = c.in(prev);
      if (ci) { if (!pi) res.push(c.at(prev, cur)); res.push(cur); }
      else if (pi) res.push(c.at(prev, cur));
    }
    p = res;
  }
  return p;
}
function simplifyPoly(poly, eps) {
  const res = [];
  for (const pt of poly) {
    const last = res[res.length - 1];
    if (!last || Math.hypot(pt[0] - last[0], pt[1] - last[1]) > eps) res.push(pt);
  }
  return res;
}
function polyArea(poly) {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x1, z1] = poly[i], [x2, z2] = poly[(i + 1) % poly.length];
    a += x1 * z2 - x2 * z1;
  }
  return a / 2;
}
function buildWaterPolys(elements, nodeMap) {
  const wayNodes = new Map();
  for (const el of elements) if (el.type === 'way' && el.nodes) wayNodes.set(el.id, el.nodes);
  const isWater = (t) => t && (t.natural === 'water' || t.waterway === 'riverbank');
  const project = (nids) => {
    const p = [];
    for (const nid of nids) { const n = nodeMap.get(nid); if (n) p.push(toXZ(n[0], n[1])); }
    return p;
  };
  const ringsNodeIds = [];
  // ways fermées taguées eau
  for (const el of elements) {
    if (el.type === 'way' && el.nodes && isWater(el.tags) &&
        el.nodes.length >= 4 && el.nodes[0] === el.nodes[el.nodes.length - 1]) {
      ringsNodeIds.push(el.nodes);
    }
  }
  // relations multipolygones : on recolle les membres « outer » bout à bout
  for (const el of elements) {
    if (el.type !== 'relation' || !isWater(el.tags) || !el.members) continue;
    const segs = el.members
      .filter((m) => m.type === 'way' && (m.role === 'outer' || m.role === '') && wayNodes.has(m.ref))
      .map((m) => wayNodes.get(m.ref).slice());
    while (segs.length) {
      let ring = segs.shift();
      let changed = true, guard = 0;
      while (changed && ring[0] !== ring[ring.length - 1] && guard++ < 5000) {
        changed = false;
        for (let i = 0; i < segs.length; i++) {
          const w = segs[i], a = ring[ring.length - 1], b = ring[0];
          if (w[0] === a) { ring = ring.concat(w.slice(1)); segs.splice(i, 1); changed = true; break; }
          if (w[w.length - 1] === a) { ring = ring.concat(w.slice().reverse().slice(1)); segs.splice(i, 1); changed = true; break; }
          if (w[w.length - 1] === b) { ring = w.slice(0, -1).concat(ring); segs.splice(i, 1); changed = true; break; }
          if (w[0] === b) { ring = w.slice().reverse().slice(0, -1).concat(ring); segs.splice(i, 1); changed = true; break; }
        }
      }
      if (ring.length >= 4) ringsNodeIds.push(ring);
    }
  }
  const polys = [];
  for (const nids of ringsNodeIds) {
    let poly = clipPolyToBox(project(nids), CLIP);
    if (poly.length < 4) continue;
    poly = simplifyPoly(poly, 2.5);
    if (poly.length < 4 || Math.abs(polyArea(poly)) < 400) continue; // vire les mares
    polys.push(poly.map(([x, z]) => [r1(x), r1(z)]));
  }
  return polys;
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
  for (let round = 1; round <= 3; round++) {
    for (const url of ENDPOINTS) {
      try {
        console.log(`Téléchargement OSM depuis ${url} (vague ${round}/3)…`);
        const res = await fetch(url, {
          method: 'POST',
          headers: HEADERS,
          body: 'data=' + encodeURIComponent(QUERY),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return await res.json();
      } catch (err) {
        console.warn(`Échec : ${err.message}`);
        lastErr = err;
      }
    }
    if (round < 3) {
      console.log('Tous les serveurs ont refusé — nouvelle vague dans 45 s (quotas Overpass)…');
      await sleep(45);
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

// Tracé courbe des fleuves (met à jour WATER[].center + minX/maxX)
console.log('Reconstruction du tracé des fleuves…');
buildRiverCenters(data.elements, nodes);

// Vraies surfaces d'eau OSM (source fiable pour placer les fleuves)
console.log('Extraction des surfaces d’eau (natural=water / riverbank)…');
const waterPolys = buildWaterPolys(data.elements, nodes);
console.log(`  ${waterPolys.length} surface(s) d’eau extraite(s).`);

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
    // NE PAS filtrer par bande d'eau ici : ça effaçait des colonnes entières
    // de bâtiments sur toute la carte (la bande couvre tout le méandre). Le
    // client écarte lui-même, précisément, ceux qui tombent sur l'eau réelle.
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
  water: cleanWater(),
  waterPolys,
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
