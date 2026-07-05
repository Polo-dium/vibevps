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
