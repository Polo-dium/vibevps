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
