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

// --- Comparaison tranche par tranche (z) : couloir vide des bâtiments vs eau
// Reproduit l'interpolation du client pour placer l'eau à un z donné.
function makeCx(center, bound) {
  if (!Array.isArray(center) || center.length < 2) return null;
  const inMap = center.filter(([z, x]) => Math.abs(z) <= bound + 60 && Math.abs(x) <= bound + 60);
  if (inMap.length < 2) return null;
  const p = [...inMap].sort((a, b) => a[0] - b[0]);
  return (z) => {
    if (z <= p[0][0]) return p[0][1];
    if (z >= p[p.length - 1][0]) return p[p.length - 1][1];
    let lo = 0, hi = p.length - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (p[m][0] <= z) lo = m; else hi = m; }
    const [z0, x0] = p[lo], [z1, x1] = p[hi];
    return x0 + (x1 - x0) * ((z - z0) / (z1 - z0 || 1));
  };
}
const cxFns = (d.water || []).map((w) => ({ name: w.name, w, cx: makeCx(w.center, d.bound) }));

// bâtiments par (tranche z, tranche x) pour repérer le couloir vide à chaque z
function gapsAtZ(zc, zw = 120) {
  const bx = new Map();
  for (const b of d.buildings || []) {
    let sx = 0, sz = 0, n = 0;
    for (let i = 0; i < b.p.length; i += 2) { sx += b.p[i]; sz += b.p[i + 1]; n++; }
    if (Math.abs(sz / n - zc) > zw) continue;
    bx.set(Math.round((sx / n) / 20), true);
  }
  // trouve les runs vides (>= 3 tranches consécutives = ~60 m) dans [-bound,bound]
  const gaps = [];
  let start = null;
  for (let k = Math.round(-d.bound / 20); k <= Math.round(d.bound / 20); k++) {
    if (!bx.has(k)) { if (start === null) start = k; }
    else { if (start !== null && k - start >= 3) gaps.push([start * 20, (k - 1) * 20]); start = null; }
  }
  return gaps;
}
console.log('\n=== ALIGNEMENT eau vs couloir bâtiments, par tranche de z ===');
for (const zc of [-1000, -600, -200, 0, 200, 600, 1000]) {
  const gaps = gapsAtZ(zc).map(([a, b]) => `[${a}..${b}]`).join(' ');
  const waters = cxFns.filter((f) => f.cx).map((f) => {
    const c = f.cx(zc), h = (f.w.w ?? (f.w.maxX - f.w.minX)) / 2;
    return `${f.name}~${c.toFixed(0)}[${(c - h).toFixed(0)}..${(c + h).toFixed(0)}]`;
  }).join(' ');
  console.log(`z=${String(zc).padStart(6)} | couloirs bât ${gaps || '(aucun)'} | eau ${waters}`);
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
