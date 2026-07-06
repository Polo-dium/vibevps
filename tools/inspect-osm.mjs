#!/usr/bin/env node
// Diagnostic d'alignement : où sont réellement les fleuves / collines par
// rapport aux bâtiments OSM. À lancer sur le VPS :
//   node tools/inspect-osm.mjs
// puis copier-coller la sortie.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const P = path.join(__dirname, '..', 'client', 'public', 'lyon-osm.json');
const d = JSON.parse(fs.readFileSync(P, 'utf8'));

console.log('=== lyon-osm.json ===');
console.log('scale', d.scale, '| bound', d.bound, '| bâtiments', d.buildings?.length, '| rues', d.roads?.length);

console.log('\n=== FLEUVES (water) ===');
for (const w of d.water || []) {
  const c = w.center;
  let cinfo = 'pas de center (bande droite)';
  if (Array.isArray(c) && c.length) {
    const xs = c.map((p) => p[1]);
    const zs = c.map((p) => p[0]);
    const inMap = c.filter(([z, x]) => Math.abs(z) <= d.bound + 60 && Math.abs(x) <= d.bound + 60);
    cinfo = `center ${c.length} pts | x[${Math.min(...xs).toFixed(0)}..${Math.max(...xs).toFixed(0)}]`
      + ` z[${Math.min(...zs).toFixed(0)}..${Math.max(...zs).toFixed(0)}] | in-map ${inMap.length} pts`;
    if (inMap.length) {
      const ix = inMap.map((p) => p[1]).sort((a, b) => a - b);
      cinfo += ` | x in-map médiane ${ix[ix.length >> 1].toFixed(0)} [${ix[0].toFixed(0)}..${ix[ix.length - 1].toFixed(0)}]`;
    }
  }
  console.log(`- ${w.name}: minX ${w.minX} maxX ${w.maxX} w ${w.w ?? '?'} | ${cinfo}`);
}

console.log('\n=== COLLINES (hills) ===');
for (const h of d.hills || []) {
  console.log(`- cx ${h.cx} cz ${h.cz} | rx ${h.rx} rz ${h.rz} | ry ${h.ry} cap ${h.cap ?? '—'}`);
}
console.log('poi.basilica', JSON.stringify(d.poi?.basilica), '| confluenceZ', d.confluenceZ);

// --- Surfaces d'eau réelles OSM (data.waterPolys) : ce qui sert à placer les
// fleuves. On liste chacune (boîte, aire, étendue z) et on marque celles qui
// traversent le plus la carte = les fleuves retenus.
console.log('\n=== SURFACES D’EAU OSM (waterPolys) ===');
const polys = d.waterPolys || [];
console.log('nombre:', polys.length);
const infos = polys.map((p, i) => {
  const xs = p.map((q) => q[0]), zs = p.map((q) => q[1]);
  let a = 0;
  for (let k = 0; k < p.length; k++) { const [x1, z1] = p[k], [x2, z2] = p[(k + 1) % p.length]; a += x1 * z2 - x2 * z1; }
  return { i, n: p.length, minX: Math.min(...xs), maxX: Math.max(...xs),
    minZ: Math.min(...zs), maxZ: Math.max(...zs), area: Math.abs(a / 2),
    zspan: Math.max(...zs) - Math.min(...zs) };
}).sort((a, b) => b.zspan - a.zspan);
for (const f of infos) {
  const river = f.zspan >= d.bound * 0.6 ? '  <<< FLEUVE (traverse)' : '';
  console.log(`#${f.i} pts${String(f.n).padStart(4)} | x[${f.minX.toFixed(0)}..${f.maxX.toFixed(0)}] z[${f.minZ.toFixed(0)}..${f.maxZ.toFixed(0)}] | aire ${Math.round(f.area)} | zspan ${f.zspan.toFixed(0)}${river}`);
}
// Position en x des surfaces traversantes à quelques profondeurs (scanline)
const rivers = infos.filter((f) => f.zspan >= d.bound * 0.6);
console.log('\n  -- x des surfaces traversantes par tranche de z --');
for (const zc of [-800, -300, 0, 300, 800]) {
  const row = rivers.map((f) => {
    const p = polys[f.i], xs = [];
    for (let k = 0; k < p.length; k++) {
      const a = p[k], b = p[(k + 1) % p.length];
      if ((a[1] <= zc && b[1] > zc) || (b[1] <= zc && a[1] > zc)) xs.push(a[0] + (b[0] - a[0]) * (zc - a[1]) / (b[1] - a[1]));
    }
    xs.sort((u, v) => u - v);
    return `#${f.i}:${xs.length ? '[' + xs.map((x) => x.toFixed(0)).join(',') + ']' : '—'}`;
  }).join('  ');
  console.log(`  z=${String(zc).padStart(5)} | ${row}`);
}

// --- Reproduit EXACTEMENT la logique du client (deriveRiverPaths) sur les
// vraies données, pour voir où le jeu place chaque fleuve vs les couloirs.
function refX(band, bound) {
  if (Array.isArray(band.center) && band.center.length) {
    const xs = band.center
      .filter(([z, x]) => Math.abs(z) <= bound + 60 && Math.abs(x) <= bound + 60)
      .map((p) => p[1]).sort((a, b) => a - b);
    if (xs.length) return xs[xs.length >> 1];
  }
  return (band.minX + band.maxX) / 2;
}
// gaps par tranche de z (mêmes paramètres que le client) + assignation
const XB = 16, ZB = 64, MINRUN = 4, NEAR = 190;
const occ = new Set(), zks = new Set();
for (const b of d.buildings || []) {
  let sx = 0, sz = 0, n = 0;
  for (let i = 0; i < b.p.length; i += 2) { sx += b.p[i]; sz += b.p[i + 1]; n++; }
  occ.add(Math.round((sz / n) / ZB) + ':' + Math.round((sx / n) / XB));
  zks.add(Math.round((sz / n) / ZB));
}
const refs = (d.water || []).map((w) => refX(w, d.bound));
function gapsAtZk(zk) {
  const gaps = [];
  let runStart = null, seen = false;
  const xkMin = Math.round(-d.bound / XB), xkMax = Math.round(d.bound / XB);
  for (let xk = xkMin; xk <= xkMax; xk++) {
    if (occ.has(zk + ':' + xk)) {
      if (runStart !== null && seen && xk - runStart >= MINRUN) gaps.push([runStart * XB, (xk - 1) * XB]);
      runStart = null; seen = true;
    } else if (runStart === null) runStart = xk;
  }
  return gaps;
}
console.log('\n=== ALIGNEMENT : couloirs vides vs fleuve choisi, par tranche de z ===');
console.log('(ref = position connue du fleuve ; choisi = couloir retenu par le jeu)');
console.log('refs:', (d.water || []).map((w, i) => `${w.name}=${refs[i].toFixed(0)}`).join(' '));
for (const zc of [-1200, -800, -400, 0, 400, 800, 1200]) {
  const zk = Math.round(zc / ZB);
  const gaps = gapsAtZk(zk);
  const gStr = gaps.map(([a, b]) => `[${a}..${b}]`).join(' ') || '(aucun)';
  const chosen = (d.water || []).map((w, i) => {
    let best = null, bd = Infinity;
    for (const g of gaps) { const c = (g[0] + g[1]) / 2, dd = Math.abs(c - refs[i]); if (dd < bd) { bd = dd; best = g; } }
    return `${w.name}=${best && bd < NEAR ? Math.round((best[0] + best[1]) / 2) : '—'}`;
  }).join(' ');
  console.log(`z=${String(zc).padStart(5)} | couloirs ${gStr}\n          choisi: ${chosen}`);
}

// Histogramme des bâtiments par tranche de x : les creux = couloirs des fleuves
console.log('\n=== BÂTIMENTS par tranche de x (créneaux vides = fleuves) ===');
const BIN = 20, hist = new Map();
let minX = Infinity, maxX = -Infinity;
for (const b of d.buildings || []) {
  // centre du bâtiment (p = [x0,z0,x1,z1,…])
  let sx = 0, n = 0;
  for (let i = 0; i < b.p.length; i += 2) { sx += b.p[i]; n++; }
  const cx = sx / n;
  minX = Math.min(minX, cx); maxX = Math.max(maxX, cx);
  const k = Math.round(cx / BIN);
  hist.set(k, (hist.get(k) || 0) + 1);
}
const k0 = Math.round(minX / BIN), k1 = Math.round(maxX / BIN);
const max = Math.max(...hist.values());
for (let k = k0; k <= k1; k++) {
  const n = hist.get(k) || 0;
  const bar = '#'.repeat(Math.round((n / max) * 50));
  console.log(`x=${String(k * BIN).padStart(6)} | ${String(n).padStart(4)} ${bar}`);
}
