#!/usr/bin/env node
// VRAI RELIEF DE LYON : modèle numérique de terrain tiré des tuiles
// d'altitude ouvertes « Terrarium » (AWS Open Data, SRTM et autres sources,
// ~7 m par pixel au zoom 14), décodées ici sans dépendance (PNG + zlib de
// Node). Remplace les ellipsoïdes de collines : Fourvière avec son
// escarpement sur la Saône et son plateau vers Saint-Just, les pentes de la
// Croix-Rousse, Sainte-Foy, la Duchère au loin…
//
// Utilisé par tools/fetch-osm.mjs (champ `relief` du JSON). Lancé seul, il
// ajoute le relief à un lyon-osm.json existant :
//
//   node tools/relief.mjs [chemin/vers/lyon-osm.json]
//
// Format de `relief` (unités jeu) : grille carrée centrée sur Bellecour,
// { res, n, half, scale, data } — data = base64 d'un Uint16Array n×n
// (ligne par ligne, z croissant puis x croissant), hauteur = valeur / scale,
// 0 = niveau des quais (Saône/Rhône). Les hauteurs sont déjà à l'échelle
// des hauteurs du jeu (relief réel × H_SCALE).

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const LAT0 = 45.7578, LON0 = 4.8320;
const M_PER_LON = 111320 * Math.cos((LAT0 * Math.PI) / 180);
const M_PER_LAT = 111132;
const ZOOM = 14;
const TILE_URL = (z, x, y) => `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`;
// Niveau du sol de la ville (m NGF). Mesuré sur les tuiles : fleuves à
// ~160,5 m, sol réel de la Presqu'île ~168 m, mais le SRTM y lit 173-178 m
// (il voit le dessus des toits). On part de 168 m et on écrase en douceur
// les 10 premiers mètres (FLAT0) : la ville plate reste à 0, les collines
// gardent toutes leurs pentes.
const QUAI_M = 168;
const FLAT0 = 10, FLAT1 = 20;

// ---------------------------------------------------------------- PNG
function paeth(a, b, c) {
  const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

// PNG 8 bits RGB/RGBA non entrelacé → { w, h, bpp, px }
export function decodePng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('pas un PNG');
  let off = 8, w = 0, h = 0, bpp = 3;
  const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    const body = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') {
      w = body.readUInt32BE(0); h = body.readUInt32BE(4);
      const depth = body[8], color = body[9], interlace = body[12];
      if (depth !== 8 || interlace !== 0 || (color !== 2 && color !== 6)) {
        throw new Error(`PNG non géré (profondeur ${depth}, couleur ${color})`);
      }
      bpp = color === 6 ? 4 : 3;
    } else if (type === 'IDAT') idat.push(body);
    else if (type === 'IEND') break;
    off += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = w * bpp;
  const px = new Uint8Array(h * stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)];
    const src = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const row = y * stride, prev = (y - 1) * stride;
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? px[row + i - bpp] : 0;
      const b = y > 0 ? px[prev + i] : 0;
      const c = y > 0 && i >= bpp ? px[prev + i - bpp] : 0;
      let v = src[i];
      if (f === 1) v += a;
      else if (f === 2) v += b;
      else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) v += paeth(a, b, c);
      px[row + i] = v & 255;
    }
  }
  return { w, h, bpp, px };
}

// ------------------------------------------------------------- tuiles
const tileX = (lon, z) => ((lon + 180) / 360) * 2 ** z;
const tileY = (lat, z) => {
  const r = (lat * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z;
};

async function fetchTile(z, x, y) {
  let err;
  for (let k = 0; k < 4; k++) {
    try {
      const res = await fetch(TILE_URL(z, x, y), { signal: AbortSignal.timeout(30000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return decodePng(Buffer.from(await res.arrayBuffer()));
    } catch (e) {
      err = e;
      await new Promise((r) => setTimeout(r, 1500 * (k + 1)));
    }
  }
  throw err;
}

// Altitude (m) en tout point lat/lon de l'emprise : bilinéaire sur les tuiles
export async function loadDem(latS, lonW, latN, lonE) {
  const x0 = Math.floor(tileX(lonW, ZOOM)), x1 = Math.floor(tileX(lonE, ZOOM));
  const y0 = Math.floor(tileY(latN, ZOOM)), y1 = Math.floor(tileY(latS, ZOOM));
  const tiles = new Map();
  for (let ty = y0; ty <= y1; ty++) {
    for (let tx = x0; tx <= x1; tx++) tiles.set(`${tx},${ty}`, await fetchTile(ZOOM, tx, ty));
  }
  console.log(`  Relief : ${tiles.size} tuiles Terrarium (zoom ${ZOOM}).`);
  const pix = (gx, gy) => {
    const tx = Math.floor(gx / 256), ty = Math.floor(gy / 256);
    const t = tiles.get(`${tx},${ty}`);
    if (!t) return NaN;
    const i = ((gy - ty * 256) * t.w + (gx - tx * 256)) * t.bpp;
    return t.px[i] * 256 + t.px[i + 1] + t.px[i + 2] / 256 - 32768;
  };
  return (lat, lon) => {
    const fx = tileX(lon, ZOOM) * 256 - 0.5, fy = tileY(lat, ZOOM) * 256 - 0.5;
    const ix = Math.floor(fx), iy = Math.floor(fy), u = fx - ix, v = fy - iy;
    return (pix(ix, iy) * (1 - u) + pix(ix + 1, iy) * u) * (1 - v) +
      (pix(ix, iy + 1) * (1 - u) + pix(ix + 1, iy + 1) * u) * v;
  };
}

// Flou gaussien séparable (gomme le bruit SRTM : toits, arbres, ±3 m)
function blur(a, n, r) {
  const k = [], s = r / 2;
  let sum = 0;
  for (let i = -r; i <= r; i++) { const w = Math.exp(-(i * i) / (2 * s * s)); k.push(w); sum += w; }
  const tmp = new Float32Array(a.length), out = new Float32Array(a.length);
  for (let pass = 0; pass < 2; pass++) {
    const src = pass ? tmp : a, dst = pass ? out : tmp;
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        let acc = 0;
        for (let t = -r; t <= r; t++) {
          const ii = pass ? i : Math.min(n - 1, Math.max(0, i + t));
          const jj = pass ? Math.min(n - 1, Math.max(0, j + t)) : j;
          acc += src[jj * n + ii] * k[t + r];
        }
        dst[j * n + i] = acc / sum;
      }
    }
  }
  return out;
}

/**
 * Grille de relief en unités jeu. half = demi-côté (jeu), res = pas (jeu),
 * scale = échelle horizontale (jeu/m), hScale = échelle des hauteurs.
 */
export async function buildRelief({ half, res = 10, scale = 0.5, hScale = 0.6 }) {
  const n = Math.ceil((2 * half) / res) + 1;
  const toLat = (z) => LAT0 - z / scale / M_PER_LAT;
  const toLon = (x) => LON0 + x / scale / M_PER_LON;
  const dem = await loadDem(toLat(half + res), toLon(-half - res), toLat(-half - res), toLon(half + res));
  const raw = new Float32Array(n * n);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const x = -half + i * res, z = -half + j * res;
      const e = dem(toLat(z), toLon(x));
      raw[j * n + i] = Number.isFinite(e) ? e : QUAI_M;
    }
  }
  // Flou ~30 m réels (bosses des toits et des arbres), puis la plaine
  // ramenée à 0 : 0 sous FLAT0, raccord parabolique jusqu'à FLAT1, linéaire
  // au-delà (pente continue, pas de marche)
  const sm = blur(raw, n, Math.max(1, Math.round(12 * scale / res * 2)));
  const data = new Uint16Array(n * n);
  const SC = 20; // 5 cm de résolution
  let max = 0;
  for (let k = 0; k < n * n; k++) {
    let d = Math.max(0, sm[k] - QUAI_M);
    d = d < FLAT0 ? 0
      : d < FLAT1 ? ((d - FLAT0) ** 2) / (2 * (FLAT1 - FLAT0))
      : d - (FLAT0 + FLAT1) / 2;
    const h = d * hScale;
    max = Math.max(max, h);
    data[k] = Math.min(65535, Math.round(h * SC));
  }
  console.log(`  Relief : grille ${n}×${n} au pas de ${res} (jeu), point culminant ${max.toFixed(1)} (jeu).`);
  return { res, n, half, scale: SC, data: Buffer.from(data.buffer).toString('base64') };
}

// CLI : ajoute le relief à un JSON existant
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const file = process.argv[2] ?? path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'client', 'public', 'lyon-osm.json');
  const json = JSON.parse(fs.readFileSync(file, 'utf8'));
  json.version = Math.max(json.version ?? 1, 3);
  json.relief = await buildRelief({ half: json.bound + 300, res: 10, scale: json.scale ?? 0.5 });
  fs.writeFileSync(file, JSON.stringify(json));
  console.log(`OK : relief ajouté à ${file} (${(fs.statSync(file).size / 1e6).toFixed(1)} Mo)`);
}
