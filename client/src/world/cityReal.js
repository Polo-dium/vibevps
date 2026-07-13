import * as THREE from 'three';
import { addInvisibleWall, addBox } from './utils.js';
import { state } from '../state.js';
import {
  ARCADE, RANGE, MUR_PEINT, BELLECOUR, BELLECOUR_REAL, makeRand,
  makeCenterline, riverCx, riverHalf,
} from './layout.js';
import {
  makeSkylineTexture, buildBellecour,
  buildGrandeRoue, buildFountain, buildStreetFurniture, buildMurPeint,
  buildPeniches, buildSilure, buildFourviere, buildLamps,
  buildTraboules, buildRiverWorks, composeRiverTerrain, buildConfluence,
  buildConfluenceMuseum, buildJetpackPad, buildTerrasse,
  makeWaterTexture, WATER_Y, BED_Y,
} from './city.js';
import { buildTraffic } from './traffic.js';
import { buildRooftopBar } from './rooftops.js';

// Construit le vrai Lyon à partir des empreintes OpenStreetMap
// (client/public/lyon-osm.json, généré par tools/fetch-osm.mjs).
// Toute la géométrie est fusionnée en tuiles : quelques dizaines de
// draw calls pour des milliers de bâtiments, frustum culling gratuit.
//
// Deux régimes selon le JSON :
// - « ville complète » (data.hills présent) : Confluence → Croix-Rousse,
//   collines réelles à l'échelle avec les bâtiments posés dessus, terrain
//   continu, pointe de la Confluence et musée.
// - ancien JSON (Presqu'île seule) : comportement historique conservé.

const FLOOR_M = 3; // hauteur d'étage pour le calage de la texture fenêtres

const WALL_TINTS = ['#e8ddc8', '#e3d4ba', '#d9c6a8', '#e6d9c4', '#dccab0', '#d5c0a0', '#efe6d4', '#cdb695'];
const ROOF_TINTS = ['#a8543c', '#b05a40', '#9c4e38', '#b46248', '#7e8696', '#6d7585', '#a8543c', '#b05a40'];
// Façades Renaissance du Vieux Lyon, rive droite de la Saône : ocres, roses,
// safran — les couleurs de la carte postale
const VIEUX_LYON_TINTS = ['#d99a5b', '#c96f4a', '#e2b04a', '#d4826a', '#c98d3f', '#b85c48', '#e0a26b', '#cc7a52'];

// Zones fixées par buildRealCity, consommées par reservedRects()
let HILL_RECT = null;
let WATER_RECTS = [];
let EXTRA_RECTS = [];
let BELLE_RECT = null; // Bellecour à l'échelle en mode ville complète

// Un point est-il dans (ou au bord de) l'eau, à la profondeur z ? Test par
// distance au tracé central → fonctionne même quand les fleuves se courbent
// et convergent (contrairement à une boîte englobante qui raserait la
// Presqu'île à la Confluence).
function nearRiver(bands, x, z, margin = 0) {
  for (const b of bands) {
    if (!b.cx) continue;
    // IMPORTANT : ne rien exclure au-delà de l'emprise réelle du fleuve.
    // Sans cette borne, le tracé clampé se prolonge en « fleuve fantôme »
    // (bande vide de bâtiments à travers la Croix-Rousse, au nord du vrai
    // bout de la Saône).
    if (b.zMin != null && (z < b.zMin - 30 || z > b.zMax + 30)) continue;
    if (Math.abs(x - riverCx(b, z)) < riverHalf(b) + margin) return true;
  }
  return false;
}

// Collines réelles : max d'ellipsoïdes analytiques (cap = plateau)
function makeHillsFn(hills) {
  return (x, z) => {
    let best = 0;
    for (const d of hills) {
      const u = (x - d.cx) / d.rx;
      const v = (z - d.cz) / d.rz;
      const q = 1 - u * u - v * v;
      if (q <= 0) continue;
      let h = (d.cy ?? -6) + d.ry * Math.sqrt(q);
      if (d.cap != null) h = Math.min(d.cap, h);
      if (h > best) best = h;
    }
    return best;
  };
}

// DÉTECTION DES FLEUVES par l'espace libre. Idée : dans une ville OSM, tout
// est bâti SAUF l'eau. Les fleuves sont donc les couloirs vides nettement plus
// larges qu'une avenue, ET qui traversent la carte du nord au sud. On repère
// ces couloirs par tranche de z, on les relie en chaînes continues, et on
// garde les deux plus longues = la Saône (ouest) et le Rhône (est).
// Renvoie [{pts:[[z,xCentre,largeur],…], avgX}] trié ouest→est (0, 1 ou 2).
function detectRivers(data, bound) {
  const ZB = 36, XB = 6, AVENUE = 50; // > 50 m de vide = plus large qu'une avenue
  const nz = Math.max(1, Math.ceil((2 * bound) / ZB));
  const xkMin = Math.floor(-bound / XB), xkMax = Math.ceil(bound / XB);
  const nx = xkMax - xkMin + 1;
  const occ = Array.from({ length: nz }, () => new Uint8Array(nx));
  const sliceOf = (z) => Math.min(nz - 1, Math.max(0, Math.floor((z + bound) / ZB)));
  for (const b of data.buildings || []) {
    let minX = 1e9, maxX = -1e9, minZ = 1e9, maxZ = -1e9;
    for (let i = 0; i < b.p.length; i += 2) {
      const x = b.p[i], z = b.p[i + 1];
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
    }
    const s0 = sliceOf(minZ), s1 = sliceOf(maxZ);
    const gx0 = Math.max(0, Math.floor(minX / XB) - xkMin);
    const gx1 = Math.min(nx - 1, Math.ceil(maxX / XB) - xkMin);
    for (let s = s0; s <= s1; s++) { const row = occ[s]; for (let gx = gx0; gx <= gx1; gx++) row[gx] = 1; }
  }
  // Couloirs vides larges par tranche (bornés par du bâti des DEUX côtés)
  const runsPer = [];
  for (let s = 0; s < nz; s++) {
    const row = occ[s], runs = [];
    let start = -1, seen = false;
    for (let gx = 0; gx < nx; gx++) {
      if (row[gx]) {
        if (start >= 0 && seen) {
          const w = (gx - start) * XB;
          if (w >= AVENUE) runs.push({ x: ((start + gx - 1) / 2 + xkMin) * XB, w });
        }
        start = -1; seen = true;
      } else if (start < 0) start = gx;
    }
    runsPer.push(runs);
  }
  // Chaînage nord→sud : on prolonge une chaîne tant qu'un couloir proche existe
  // (tolère 2 tranches de trou : ponts, place traversante)
  const active = [], done = [];
  for (let s = 0; s < nz; s++) {
    const z = s * ZB - bound + ZB / 2;
    const used = new Set();
    for (const r of runsPer[s]) {
      let best = -1, bd = 1e9;
      for (let ci = 0; ci < active.length; ci++) {
        if (used.has(ci)) continue;
        const d = Math.abs(active[ci].lastX - r.x);
        if (d < bd && d < 80) { bd = d; best = ci; }
      }
      if (best >= 0) {
        const c = active[best];
        c.pts.push([z, r.x, r.w]); c.lastX = r.x; c.gap = 0; used.add(best);
      } else {
        active.push({ pts: [[z, r.x, r.w]], lastX: r.x, gap: 0 });
      }
    }
    for (let ci = active.length - 1; ci >= 0; ci--) {
      if (!used.has(ci) && ++active[ci].gap > 2) { done.push(active[ci]); active.splice(ci, 1); }
    }
  }
  done.push(...active);
  // On garde les chaînes qui traversent une grande partie de la carte (fleuves,
  // pas places ni parcs compacts).
  const minSpan = 2 * bound * 0.4;
  const spanning = done
    .map((c) => {
      const zs = c.pts.map((p) => p[0]);
      return {
        pts: c.pts,
        span: Math.max(...zs) - Math.min(...zs),
        avgX: c.pts.reduce((a, p) => a + p[1], 0) / c.pts.length,
      };
    })
    .filter((c) => c.span >= minSpan);
  // La Presqu'île (avec Bellecour à x≈0) est ENTRE les deux fleuves : on prend
  // donc le couloir traversant le plus proche du centre de CHAQUE côté (Saône
  // à l'ouest, Rhône à l'est) — et non les deux plus larges, qui pouvaient
  // tomber sur un parc ou une périphérie loin du fleuve.
  const west = spanning.filter((c) => c.avgX < 0).sort((a, b) => b.avgX - a.avgX)[0];
  const east = spanning.filter((c) => c.avgX >= 0).sort((a, b) => a.avgX - b.avgX)[0];
  // Repli : s'il n'y a rien d'un côté, on complète avec les plus longues
  const picked = [west, east].filter(Boolean);
  if (picked.length < 2) {
    for (const c of spanning.sort((a, b) => b.span - a.span)) {
      if (!picked.includes(c)) { picked.push(c); if (picked.length === 2) break; }
    }
  }
  return picked.sort((a, b) => a.avgX - b.avgX);
}

// Fleuves à partir de la VRAIE géométrie d'eau OSM (data.waterPolys : anneaux
// [[x,z],…] des surfaces natural=water / riverbank). Bien plus fiable que les
// couloirs entre bâtiments (les quais/ponts bouchent le trou du fleuve). Pour
// chaque tranche de z, on coupe les polygones (scanline) → intervalles d'eau,
// qu'on relie en chaînes = fleuves. Même format de sortie que detectRivers.
function riversFromPolys(polys, bound) {
  if (!Array.isArray(polys) || !polys.length) return [];
  const ZB = 24; // tranches fines : virages serrés mieux suivis
  const nz = Math.max(1, Math.ceil((2 * bound) / ZB));
  const active = [], done = [];
  for (let s = 0; s < nz; s++) {
    const z = s * ZB - bound + ZB / 2;
    // Intervalles d'eau calculés PAR polygone (even-odd correct à l'intérieur
    // d'un anneau), puis UNION. Crucial : les surfaces OSM se DOUBLONNENT et se
    // CHEVAUCHENT (natural=water + riverbank sur le même fleuve). En poolant
    // tous les bords, les doublons s'annulaient (le Rhône disparaissait).
    let ivs = [];
    for (const ring of polys) {
      const xs = [];
      for (let i = 0; i < ring.length; i++) {
        const a = ring[i], b = ring[(i + 1) % ring.length];
        const za = a[1], zb = b[1];
        if ((za <= z && zb > z) || (zb <= z && za > z)) {
          xs.push(a[0] + (b[0] - a[0]) * (z - za) / (zb - za));
        }
      }
      xs.sort((p, q) => p - q);
      for (let i = 0; i + 1 < xs.length; i += 2) {
        if (xs[i + 1] - xs[i] >= 6) ivs.push([xs[i], xs[i + 1]]);
      }
    }
    ivs.sort((p, q) => p[0] - q[0]);
    const merged = [];
    for (const iv of ivs) {
      const last = merged[merged.length - 1];
      if (last && iv[0] <= last[1] + 20) last[1] = Math.max(last[1], iv[1]);
      else merged.push([iv[0], iv[1]]);
    }
    const cur = merged.filter((m) => m[1] - m[0] >= 14)
      .map((m) => ({ x: (m[0] + m[1]) / 2, w: m[1] - m[0], lo: m[0], hi: m[1] }));
    // Chaînage nord→sud par PROXIMITÉ D'INTERVALLES : un fleuve continu se
    // recouvre (ou presque) d'une tranche à l'autre, même dans un virage très
    // serré (coude de Saint-Georges) où son CENTRE saute de >150 m alors que
    // les intervalles restent quasi contigus. On accepte un petit trou
    // (< 70 m) entre intervalles ; la prédiction par vitesse reste en repli.
    const usedIv = new Set(), usedCh = new Set();
    const cand = [];
    for (let ci = 0; ci < active.length; ci++) {
      const c = active[ci];
      const pred = c.lastX + (c.vel || 0);
      for (let k = 0; k < cur.length; k++) {
        const iv = cur[k];
        const gapX = Math.max(iv.lo - c.hi, c.lo - iv.hi, 0); // 0 = chevauchement
        const d = Math.abs(iv.x - pred);
        if (gapX < 70) cand.push({ ci, k, score: 10000 - gapX });
        else if (d < 150) cand.push({ ci, k, score: 150 - d });
      }
    }
    cand.sort((a, b) => b.score - a.score);
    for (const { ci, k } of cand) {
      if (usedCh.has(ci) || usedIv.has(k)) continue;
      const c = active[ci], iv = cur[k];
      c.vel = 0.6 * (c.vel || 0) + 0.4 * (iv.x - c.lastX);
      c.pts.push([z, iv.x, iv.w]);
      c.lastX = iv.x; c.lo = iv.lo; c.hi = iv.hi; c.gap = 0;
      usedCh.add(ci); usedIv.add(k);
    }
    for (let ci = active.length - 1; ci >= 0; ci--) {
      if (!usedCh.has(ci) && ++active[ci].gap > 3) { done.push(active[ci]); active.splice(ci, 1); }
    }
    for (let k = 0; k < cur.length; k++) {
      if (!usedIv.has(k)) {
        const iv = cur[k];
        active.push({ pts: [[z, iv.x, iv.w]], lastX: iv.x, lo: iv.lo, hi: iv.hi, vel: 0, gap: 0 });
      }
    }
  }
  done.push(...active);
  const minSpan = 2 * bound * 0.3;
  return done
    .map((c) => ({
      pts: c.pts,
      span: Math.max(...c.pts.map((p) => p[0])) - Math.min(...c.pts.map((p) => p[0])),
      avgX: c.pts.reduce((a, p) => a + p[1], 0) / c.pts.length,
    }))
    .filter((c) => c.span >= minSpan && c.pts.length >= 3)
    .sort((a, b) => b.span - a.span)
    .slice(0, 2)
    .sort((a, b) => a.avgX - b.avgX);
}

// Masque d'eau : grille (résolution 4 m) remplie par scanline depuis les
// polygones d'eau OSM. Vérité terrain pour TOUT ce qui doit savoir « ici,
// c'est de l'eau » (lit du terrain, exclusion des bâtiments/arbres, PNJ) —
// contrairement au tracé centerline cx(z), il gère les bras est-ouest du
// fleuve (quai Saint-Vincent) que le balayage nord-sud représente mal.
function buildWaterMask(polys, bound, res = 4) {
  if (!Array.isArray(polys) || !polys.length) return null;
  const n = Math.ceil((2 * bound) / res);
  const grid = new Uint8Array(n * n);
  const extensions = [];
  for (let row = 0; row < n; row++) {
    const z = -bound + (row + 0.5) * res;
    for (const ring of polys) {
      const xs = [];
      for (let i = 0; i < ring.length; i++) {
        const a = ring[i], b = ring[(i + 1) % ring.length];
        if ((a[1] <= z && b[1] > z) || (b[1] <= z && a[1] > z)) {
          xs.push(a[0] + (b[0] - a[0]) * (z - a[1]) / (b[1] - a[1]));
        }
      }
      xs.sort((p, q) => p - q);
      for (let i = 0; i + 1 < xs.length; i += 2) {
        const c0 = Math.max(0, Math.round((xs[i] + bound) / res));
        const c1 = Math.min(n - 1, Math.round((xs[i + 1] + bound) / res));
        for (let c = c0; c <= c1; c++) grid[row * n + c] = 1;
      }
    }
  }
  return {
    res, grid, n, bound,
    extensions,
    isWater(x, z) {
      const c = Math.floor((x + bound) / res), r = Math.floor((z + bound) / res);
      if (c >= 0 && r >= 0 && c < n && r < n && grid[r * n + c] === 1) return true;
      return extensions.some((e) => e.contains(x, z));
    },
  };
}

// Consolide le masque le long des centerlines (évite qu'un grand triangle de
// colline traverse la Saône), puis extrapole le Rhône après la Confluence.
function reinforceRiverWater(mask, bands, rhone, zConf, bound) {
  const { grid, n, res } = mask;
  const paint = (cxAt, half, z0, z1) => {
    const r0 = Math.max(0, Math.floor((z0 + bound) / res));
    const r1 = Math.min(n - 1, Math.ceil((z1 + bound) / res));
    for (let r = r0; r <= r1; r++) {
      const z = -bound + (r + 0.5) * res;
      const cx = cxAt(z);
      const c0 = Math.max(0, Math.floor((cx - half + bound) / res));
      const c1 = Math.min(n - 1, Math.ceil((cx + half + bound) / res));
      for (let c = c0; c <= c1; c++) grid[r * n + c] = 1;
    }
  };

  for (const band of bands) {
    const z0 = Math.max(-bound, band.zMin ?? -bound);
    const z1 = Math.min(bound, band.zMax ?? bound);
    paint((z) => riverCx(band, z), riverHalf(band) + 1.5, z0, z1);
  }

  const zStart = Math.max(-bound, zConf - 24);
  const zEnd = bound + 120;
  const anchorZ = Math.min(zStart, rhone.zMax ?? zStart);
  const anchorX = riverCx(rhone, anchorZ);
  const beforeX = riverCx(rhone, anchorZ - 80);
  const slope = THREE.MathUtils.clamp((anchorX - beforeX) / 80, -0.35, 0.35);
  const half = Math.max(30, riverHalf(rhone));
  const continuation = {
    zStart, zEnd, half,
    cx: (z) => anchorX + slope * (z - anchorZ),
    contains(x, z) {
      return z >= zStart && z <= zEnd && Math.abs(x - this.cx(z)) <= half;
    },
  };
  paint(continuation.cx, half, zStart, bound);
  mask.extensions.push(continuation);
  return continuation;
}

// Murets de quai en pierre le long de la frontière eau/terre du masque :
// ils habillent la transition (le terrain est échantillonné à 4 m, l'eau
// suit les polygones exacts → sans muret, l'eau semble déborder par
// endroits). Un seul mesh fusionné, pas de collider (on les enjambe).
function buildQuayEdges(ctx, mask) {
  const { grid, n, res, bound } = mask;
  const at = (r, c) => (r < 0 || c < 0 || r >= n || c >= n ? 1 : grid[r * n + c]);
  const TOP = 0.42, BOT = BED_Y - 0.3;

  // 1) Soupe de segments : chaque arête de cellule entre eau et terre,
  // en coordonnées de COINS de grille (entiers → chaînage exact).
  const segs = [];
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (grid[r * n + c] !== 1) continue;
      if (!at(r, c - 1)) segs.push([c, r, c, r + 1]);
      if (!at(r, c + 1)) segs.push([c + 1, r, c + 1, r + 1]);
      if (!at(r - 1, c)) segs.push([c, r, c + 1, r]);
      if (!at(r + 1, c)) segs.push([c, r + 1, c + 1, r + 1]);
    }
  }

  // 2) Chaînage des segments en polylignes (par correspondance de coins)
  const key = (x, y) => x * 100000 + y;
  const byEnd = new Map();
  segs.forEach((s, i) => {
    for (const k of [key(s[0], s[1]), key(s[2], s[3])]) {
      if (!byEnd.has(k)) byEnd.set(k, []);
      byEnd.get(k).push(i);
    }
  });
  const used = new Uint8Array(segs.length);
  const chains = [];
  for (let i = 0; i < segs.length; i++) {
    if (used[i]) continue;
    used[i] = 1;
    const chain = [[segs[i][0], segs[i][1]], [segs[i][2], segs[i][3]]];
    for (;;) {
      const tail = chain[chain.length - 1];
      const cands = (byEnd.get(key(tail[0], tail[1])) ?? []).filter((j) => !used[j]);
      if (!cands.length) break;
      const j = cands[0];
      used[j] = 1;
      const s = segs[j];
      chain.push(s[0] === tail[0] && s[1] === tail[1] ? [s[2], s[3]] : [s[0], s[1]]);
    }
    if (chain.length > 3) chains.push(chain);
  }

  // 3) Lissage de Chaikin ×2 : les marches d'escalier de la grille (4 m)
  // deviennent des courbes de berge fluides.
  // Moyenne glissante : un escalier de grille symétrique converge vers SA
  // ligne vraie (droite → droite parfaite), une fenêtre de ±3 points
  // (~12 m) ne touche pas les méandres de 100 m et plus.
  const avg = (pts, w) => pts.map((_, i) => {
    let sx = 0, sz = 0, n2 = 0;
    for (let j = Math.max(0, i - w); j <= Math.min(pts.length - 1, i + w); j++) {
      sx += pts[j][0]; sz += pts[j][1]; n2++;
    }
    return [sx / n2, sz / n2];
  });
  const chaikin = (pts) => {
    const out = [pts[0]];
    for (let i = 0; i + 1 < pts.length; i++) {
      const [ax, ay] = pts[i], [bx, by] = pts[i + 1];
      out.push([ax * 0.75 + bx * 0.25, ay * 0.75 + by * 0.25]);
      out.push([ax * 0.25 + bx * 0.75, ay * 0.25 + by * 0.75]);
    }
    out.push(pts[pts.length - 1]);
    return out;
  };

  // 4) Muret vertical + couvre-mur + PROMENADE DE QUAI (5 m côté terre)
  // le long de chaque contour lissé. Perpendiculaires MOYENNÉES par point
  // (joints biseautés) et côté terre décidé UNE FOIS par chaîne : plus de
  // « dents » ni de quads retournés dans les courbes.
  const wallPos = [], walkPos = [];
  const toWorld = ([cx2, rz]) => [-bound + cx2 * res, -bound + rz * res];
  ctx.quayContours = []; // consommé par lampSpotsOsm : la VRAIE berge
  for (const chainRaw of chains) {
    const pts = chaikin(avg(chaikin(avg(chainRaw, 3)), 2)).map(toWorld);
    // Perpendiculaire moyenne par point
    const perps = pts.map((p, i) => {
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
      const dx = b[0] - a[0], dz = b[1] - a[1];
      const l = Math.hypot(dx, dz) || 1;
      return [-dz / l, dx / l];
    });
    // Côté terre : vote majoritaire sur quelques sondes de la chaîne
    let vote = 0;
    for (let i = 4; i < pts.length - 4; i += Math.max(4, pts.length >> 3)) {
      vote += mask.isWater(pts[i][0] + perps[i][0] * 2.5, pts[i][1] + perps[i][1] * 2.5) ? -1 : 1;
    }
    const sgn = vote >= 0 ? 1 : -1;
    ctx.quayContours.push({ pts, perps, sgn });
    for (let i = 0; i + 1 < pts.length; i++) {
      const [x1, z1] = pts[i], [x2, z2] = pts[i + 1];
      if (Math.hypot(x2 - x1, z2 - z1) < 0.05) continue;
      const [p1x, p1z] = [perps[i][0] * sgn, perps[i][1] * sgn];
      const [p2x, p2z] = [perps[i + 1][0] * sgn, perps[i + 1][1] * sgn];
      wallPos.push(
        x1, BOT, z1, x2, BOT, z2, x2, TOP, z2,
        x1, BOT, z1, x2, TOP, z2, x1, TOP, z1,
        // couvre-mur de 0,55 m côté terre, joints biseautés
        x1, TOP, z1, x2, TOP, z2, x2 + p2x * 0.55, TOP, z2 + p2z * 0.55,
        x1, TOP, z1, x2 + p2x * 0.55, TOP, z2 + p2z * 0.55, x1 + p1x * 0.55, TOP, z1 + p1z * 0.55
      );
      const wy = 0.03;
      walkPos.push(
        x1, wy, z1, x2, wy, z2, x2 + p2x * 5, wy, z2 + p2z * 5,
        x1, wy, z1, x2 + p2x * 5, wy, z2 + p2z * 5, x1 + p1x * 5, wy, z1 + p1z * 5
      );
    }
  }
  if (!wallPos.length) return;
  const mk = (arr, color) => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3));
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({
      color, side: THREE.DoubleSide,
    }));
    mesh.userData.noShadow = true;
    ctx.scene.add(mesh);
  };
  mk(wallPos, 0x968f7d);
  mk(walkPos, 0x9a9383); // dallage de promenade, pierre claire
}

// Rend l'eau DIRECTEMENT depuis les polygones OSM (forme exacte, virages et
// bras est-ouest compris) — plus aucune approximation par ruban.
function buildWaterSurfaces(ctx, polys) {
  // Dédoublonnage : natural=water et riverbank décrivent souvent le même plan
  const seen = new Set(), uniq = [];
  for (const p of polys) {
    const key = p.length + ':' + p[0] + ':' + p[p.length >> 1];
    if (!seen.has(key)) { seen.add(key); uniq.push(p); }
  }
  const tex = makeWaterTexture();
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  const mat = new THREE.MeshPhongMaterial({
    map: tex, transparent: true, opacity: 0.96,
    specular: 0x8fa8c4, shininess: 60, side: THREE.DoubleSide, // reflet bleuté, plus vert
  });
  uniq.forEach((ring, i) => {
    // Forme en (x, −z) puis rotation −90° : géographie préservée, normale
    // vers le haut (une rotation +90° inverserait la carte).
    const shape = new THREE.Shape(ring.map(([x, z]) => new THREE.Vector2(x, -z)));
    const geo = new THREE.ShapeGeometry(shape);
    geo.rotateX(-Math.PI / 2);
    const uv = geo.attributes.uv;
    for (let k = 0; k < uv.count; k++) uv.setXY(k, uv.getX(k) / 18, uv.getY(k) / 18);
    const mesh = new THREE.Mesh(geo, mat);
    // Léger étagement pour éviter le z-fighting entre surfaces qui se chevauchent
    mesh.position.y = WATER_Y + (i % 3) * 0.02;
    ctx.scene.add(mesh);
  });
  ctx.updatables.push((dt) => { tex.offset.y -= dt * 0.012; });
}

// Ruban aval du Rhône : prolonge visuellement et physiquement le fleuve au
// sud de l'emprise OSM. Il chevauche légèrement l'eau réelle à la jonction,
// puis continue derrière la limite jouable pour fermer proprement l'horizon.
function buildRiverContinuation(ctx, continuation) {
  const positions = [], uvs = [];
  const STEP = 12;
  for (let za = continuation.zStart; za < continuation.zEnd; za += STEP) {
    const zb = Math.min(za + STEP, continuation.zEnd);
    const la = continuation.cx(za) - continuation.half;
    const ra = continuation.cx(za) + continuation.half;
    const lb = continuation.cx(zb) - continuation.half;
    const rb = continuation.cx(zb) + continuation.half;
    positions.push(
      la, 0, za, lb, 0, zb, rb, 0, zb,
      la, 0, za, rb, 0, zb, ra, 0, za
    );
    const va = za / 18, vb = zb / 18;
    uvs.push(0, va, 0, vb, 1, vb, 0, va, 1, vb, 1, va);
  }
  const geometry = () => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geo.computeVertexNormals();
    return geo;
  };
  const bed = new THREE.Mesh(geometry(), new THREE.MeshLambertMaterial({ color: 0x27352b }));
  bed.position.y = BED_Y + 0.02;
  ctx.scene.add(bed);

  const tex = makeWaterTexture();
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  const water = new THREE.Mesh(geometry(), new THREE.MeshPhongMaterial({
    map: tex, transparent: true, opacity: 0.96,
    specular: 0x9cb9ce, shininess: 70, side: THREE.DoubleSide,
  }));
  water.position.y = WATER_Y + 0.015;
  ctx.scene.add(water);
  ctx.updatables.push((dt) => { tex.offset.y -= dt * 0.014; });
}

// Basilique Notre-Dame de Fourvière : à sa vraie place sur la colline, à
// l'échelle, et VISITABLE. Entrée par la GRANDE PORTE EN BOIS côté ouest
// (place de Fourvière), comme en vrai ; l'abside regarde la ville à l'est.
// À l'intérieur : sanctuaire (ni tag ni tir) + visite immersive 360°
// (photo réelle chargée à la demande depuis /pano/fourviere.jpg).
function buildBasilica(ctx, bx, bz, by) {
  ctx.pois?.push({ id: 'basilique', nom: 'Basilique de Fourvière', emoji: '⛪', x: bx, z: bz });
  const W = 46, D = 22, H = 14, T = 1.2; // nef est-ouest, portail à l'OUEST
  const stone = 0xf2ead8;
  // Parvis : plateforme qui rattrape la pente de la colline
  addBox(ctx, { x: bx, y: by - 8, z: bz, w: W + 22, h: 8, d: D + 20, color: 0xcfc7b2 });
  // Murs (portail sur la façade ouest, mur plein côté ville à l'est)
  addBox(ctx, { x: bx, y: by, z: bz - D / 2, w: W, h: H, d: T, color: stone });
  addBox(ctx, { x: bx, y: by, z: bz + D / 2, w: W, h: H, d: T, color: stone });
  addBox(ctx, { x: bx + W / 2, y: by, z: bz, w: T, h: H, d: D, color: stone });
  const DOOR = 6;
  for (const s of [-1, 1]) {
    addBox(ctx, {
      x: bx - W / 2, y: by, z: bz + s * (DOOR / 2 + (D - DOOR) / 4),
      w: T, h: H, d: (D - DOOR) / 2, color: stone,
    });
  }
  addBox(ctx, { x: bx - W / 2, y: by + 4.6, z: bz, w: T, h: H - 4.6, d: DOOR + 0.4, color: stone });
  // Grande porte en bois à double battant (entrouverte vers l'intérieur)
  const woodMat = new THREE.MeshLambertMaterial({ color: 0x6b4a2a });
  for (const s of [-1, 1]) {
    const battant = new THREE.Mesh(new THREE.BoxGeometry(0.25, 4.5, 2.9), woodMat);
    battant.position.set(bx - W / 2 + 1.3, by + 2.25, bz + s * (DOOR / 2 - 1.2));
    battant.rotation.y = s * 0.55;
    ctx.scene.add(battant);
  }
  // Marches du parvis devant le portail + rosace + fronton triangulaire
  for (let i = 0; i < 3; i++) {
    addBox(ctx, {
      x: bx - W / 2 - 1.2 - i * 1.1, y: by - 0.3 * (i + 1), z: bz,
      w: 1.2, h: 0.3 * (i + 1), d: DOOR + 4 + i * 1.6, color: 0xd8d0bc,
    });
  }
  const rosace = new THREE.Mesh(
    new THREE.CircleGeometry(1.9, 20),
    new THREE.MeshLambertMaterial({ color: 0x2c4a9e, emissive: 0x1b2f6e, emissiveIntensity: 0.5 })
  );
  rosace.position.set(bx - W / 2 - 0.66, by + 9.6, bz);
  rosace.rotation.y = -Math.PI / 2;
  ctx.scene.add(rosace);
  const fronton = new THREE.Mesh(
    new THREE.CylinderGeometry(5.6, 5.6, 1.4, 3),
    new THREE.MeshLambertMaterial({ color: stone })
  );
  fronton.rotation.z = Math.PI / 2; // axe le long de x (prisme triangulaire)
  fronton.position.set(bx - W / 2, by + H + 1.8, bz);
  ctx.scene.add(fronton);
  // Pilastres, corniche et fenêtres hautes sur les longs murs (décor extérieur)
  const winMat = new THREE.MeshLambertMaterial({ color: 0x39435a });
  for (const s of [-1, 1]) {
    addBox(ctx, { x: bx, y: by + H - 0.7, z: bz + s * (D / 2 + 0.25), w: W + 1.4, h: 0.7, d: 0.5, color: 0xe0d7c2, collider: false });
    for (let i = 0; i < 7; i++) {
      const px = bx - W / 2 + 3 + i * ((W - 6) / 6);
      addBox(ctx, { x: px, y: by, z: bz + s * (D / 2 + 0.15), w: 0.9, h: H - 0.4, d: 0.4, color: 0xe8dfca, collider: false });
      if (i < 6) {
        const win = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 3.8), winMat);
        win.position.set(px + (W - 6) / 12, by + 8.4, bz + s * (D / 2 + 0.65));
        if (s < 0) win.rotation.y = Math.PI;
        ctx.scene.add(win);
      }
    }
  }
  // Toit à faîtage + croix
  addBox(ctx, { x: bx, y: by + H, z: bz, w: W + 1.6, h: 1, d: D + 1.6, color: 0x9aa3ad, collider: false });
  addBox(ctx, { x: bx, y: by + H + 1, z: bz, w: W - 6, h: 2.2, d: D - 9, color: 0xa9b2bc, collider: false });
  addBox(ctx, { x: bx - W / 2 + 3, y: by + H + 3.2, z: bz, w: 0.5, h: 4, d: 0.5, color: 0xd9c98a, collider: false });
  addBox(ctx, { x: bx - W / 2 + 3, y: by + H + 5.6, z: bz, w: 2.2, h: 0.5, d: 0.5, color: 0xd9c98a, collider: false });
  // Quatre tours octogonales d'angle, coiffées en pointe
  const towerMat = new THREE.MeshLambertMaterial({ color: stone });
  const capMat = new THREE.MeshLambertMaterial({ color: 0x8d96a2 });
  for (const [tx, tz] of [
    [bx - W / 2, bz - D / 2], [bx + W / 2, bz - D / 2],
    [bx - W / 2, bz + D / 2], [bx + W / 2, bz + D / 2],
  ]) {
    const tower = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 2.9, 22, 8), towerMat);
    tower.position.set(tx, by + 11, tz);
    ctx.scene.add(tower);
    const cap = new THREE.Mesh(new THREE.ConeGeometry(2.9, 5.5, 8), capMat);
    cap.position.set(tx, by + 24.7, tz);
    ctx.scene.add(cap);
    ctx.colliders.push({ minX: tx - 2.9, maxX: tx + 2.9, minY: by, maxY: by + 22, minZ: tz - 2.9, maxZ: tz + 2.9 });
  }
  // Tour de la Vierge dorée (chapelle Saint-Thomas, au sud-est)
  const vx = bx + W / 2 + 9, vz = bz + D / 2 + 6;
  addBox(ctx, { x: vx, y: by, z: vz, w: 6, h: 16, d: 6, color: 0xe8dfc9 });
  const gold = new THREE.MeshLambertMaterial({ color: 0xd4af37, emissive: 0x6b520f });
  const vierge = new THREE.Mesh(new THREE.CapsuleGeometry(1, 3.4, 4, 8), gold);
  vierge.position.set(vx, by + 18.6, vz);
  ctx.scene.add(vierge);
  // Intérieur : sol, colonnes, abside dorée, autel, vitraux émissifs
  addBox(ctx, { x: bx, y: by, z: bz, w: W - 2, h: 0.12, d: D - 2, color: 0xded5c0, collider: false });
  const colMat = new THREE.MeshLambertMaterial({ color: 0xe9e0cc });
  for (let i = 0; i < 5; i++) {
    const cxp = bx - W / 2 + 8 + i * ((W - 14) / 4);
    for (const s of [-1, 1]) {
      const col = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.8, H - 1.2, 8), colMat);
      col.position.set(cxp, by + (H - 1.2) / 2, bz + s * 4.6);
      ctx.scene.add(col);
      ctx.colliders.push({ minX: cxp - 0.8, maxX: cxp + 0.8, minY: by, maxY: by + H, minZ: bz + s * 4.6 - 0.8, maxZ: bz + s * 4.6 + 0.8 });
    }
  }
  // Abside dorée et autel à l'EST (vers la ville), face au portail
  const apse = new THREE.Mesh(
    new THREE.SphereGeometry(6.5, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2),
    new THREE.MeshLambertMaterial({ color: 0xc9a227, emissive: 0x8a6d1a })
  );
  apse.position.set(bx + W / 2 - 2, by + 3, bz);
  apse.rotation.z = Math.PI / 2;
  ctx.scene.add(apse);
  addBox(ctx, { x: bx + W / 2 - 5, y: by + 0.1, z: bz, w: 3, h: 1.1, d: 1.6, color: 0xf5f0e4 });
  // Vitraux : panneaux colorés émissifs le long des murs
  const VITRAIL_COLORS = [0x3d6fd4, 0xc23b4e, 0xd4a017, 0x3d9970];
  for (let i = 0; i < 6; i++) {
    const wx = bx - W / 2 + 6 + i * ((W - 12) / 5);
    for (const s of [-1, 1]) {
      const v = new THREE.Mesh(
        new THREE.PlaneGeometry(2.2, 5),
        new THREE.MeshLambertMaterial({
          color: VITRAIL_COLORS[(i + (s > 0 ? 2 : 0)) % 4],
          emissive: VITRAIL_COLORS[(i + (s > 0 ? 2 : 0)) % 4],
          emissiveIntensity: 0.55, side: THREE.DoubleSide,
        })
      );
      v.position.set(wx, by + 7.5, bz + s * (D / 2 - T / 2 - 0.05));
      ctx.scene.add(v);
    }
  }
  // Lumière chaude intérieure
  const holy = new THREE.PointLight(0xffe2b0, 22, 40, 1.6);
  holy.position.set(bx, by + H - 3, bz);
  ctx.scene.add(holy);

  // VISITE IMMERSIVE 360° : une vraie photo panoramique de l'intérieur,
  // chargée uniquement à la demande (micro-chargement, zéro impact au boot).
  // Le fichier est servi depuis client/public/pano/fourviere.jpg — s'il
  // manque, on reste dans la nef stylisée avec un message explicite.
  let pano = null, panoOn = false, panoLoading = false;
  const panoGate = {
    x: bx, z: bz, r: 7,
    label: 'E — Visite immersive 360° (photo réelle)',
    action: () => {
      if (panoOn) {
        pano.visible = false; panoOn = false;
        panoGate.label = 'E — Visite immersive 360° (photo réelle)';
        return;
      }
      if (pano) {
        pano.visible = true; panoOn = true;
        panoGate.label = 'E — Quitter la visite 360°';
        return;
      }
      if (panoLoading) return;
      panoLoading = true;
      ctx.notify?.('📷 Chargement du panorama…');
      new THREE.TextureLoader().load('/pano/fourviere.jpg', (tex) => {
        tex.colorSpace = THREE.SRGBColorSpace;
        const sphere = new THREE.Mesh(
          new THREE.SphereGeometry(20, 48, 32),
          new THREE.MeshBasicMaterial({ map: tex, side: THREE.BackSide, depthTest: false, depthWrite: false })
        );
        sphere.renderOrder = 9990; // dessiné par-dessus tout : immersion totale
        sphere.rotation.y = Math.PI;
        sphere.position.set(bx, by + 1.7, bz);
        ctx.scene.add(sphere);
        pano = sphere; panoOn = true; panoLoading = false;
        panoGate.label = 'E — Quitter la visite 360°';
        ctx.notify?.('🌐 Bienvenue dans la vraie basilique — regarde autour de toi ! (E pour sortir)');
      }, undefined, () => {
        panoLoading = false;
        ctx.notify?.('📷 Panorama pas encore installé (client/public/pano/fourviere.jpg sur le serveur).');
      });
    },
  };
  ctx.interactables.push(panoGate);

  // Sanctuaire : ni tag ni tir à l'intérieur (consommé par weapon/spray).
  // Sortir de la nef referme aussi la visite 360°.
  const zone = { minX: bx - W / 2, maxX: bx + W / 2, minY: by - 1, maxY: by + H, minZ: bz - D / 2, maxZ: bz + D / 2 };
  let wasIn = false;
  ctx.updatables.push(() => {
    const p = ctx.playerPos?.();
    if (!p) return;
    const inside = p.x > zone.minX && p.x < zone.maxX && p.z > zone.minZ && p.z < zone.maxZ &&
      p.y > zone.minY && p.y < zone.maxY;
    if (inside !== wasIn) {
      wasIn = inside;
      state.sanctuary = inside;
      if (inside) ctx.notify?.('⛪ Basilique de Fourvière — ici on ne tague pas et on ne tire pas, gone.');
      else if (panoOn) { pano.visible = false; panoOn = false; panoGate.label = 'E — Visite immersive 360° (photo réelle)'; }
    }
  });
  ctx.interactables.push({
    x: bx - W / 2 - 4, z: bz, r: 6,
    label: 'E — Pousser la grande porte',
    action: () => ctx.notify?.('🙏 La basilique veille sur Lyon depuis 1872. Admire les vitraux, gone.'),
  });
}

// Parc du Rosaire : le jardin qui descend de la basilique vers Saint-Jean —
// chemin en lacets posé sur la pente. (Les arbres viennent de buildGreenery,
// via ctx.parkRects ; le terrain y est coloré en herbe.)
function buildParcRosaire(ctx, x0, z0, x1, z1) {
  const N = 34;
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const x = x0 + (x1 - x0) * t;
    const z = z0 + (z1 - z0) * t + Math.sin(t * Math.PI * 3) * 26; // lacets
    const y = Math.max(0, ctx.terrainHeight?.(x, z) ?? 0);
    addBox(ctx, { x, y, z, w: 4, h: 0.14, d: 5.5, color: 0xcfc4a5, collider: false });
  }
}

export function buildRealCity(ctx, data) {
  const bound = data.bound;
  ctx.worldBound = bound;
  ctx.waterBands = data.water;
  ctx.osmScale = data.scale ?? 0.5;

  // ALIGNER L'EAU SUR LA VILLE. Tout est bâti sauf l'eau : on détecte les
  // couloirs vides plus larges qu'une avenue qui traversent la carte → ce sont
  // la Saône (ouest) et le Rhône (est). On les colle sur ces couloirs, à toute
  // profondeur, courbes comprises. (Voir detectRivers.)
  const HALF_CAP = 82;
  // Priorité à la VRAIE forme d'eau OSM si le JSON la fournit (data.waterPolys),
  // sinon repli sur la détection par couloirs entre bâtiments.
  const polyRivers = riversFromPolys(data.waterPolys, bound);
  const rivers = polyRivers.length ? polyRivers : detectRivers(data, bound);
  // Ordre des bandes d'eau ouest→est pour l'appariement avec les fleuves détectés
  const bandsWE = [...data.water].sort((a, b) => (a.minX + a.maxX) - (b.minX + b.maxX));
  bandsWE.forEach((band, i) => {
    const r = rivers[i];
    if (!r || r.pts.length < 3) { delete band.center; return; }
    // Lissage du tracé (moyenne glissante) pour un lit fluide
    const WIN = 6, src = r.pts; // fenêtre large : virages fluides, fini le zigzag
    const pts = src.map((p, k) => {
      let sx = 0, n = 0;
      for (let j = Math.max(0, k - WIN); j <= Math.min(src.length - 1, k + WIN); j++) { sx += src[j][1]; n++; }
      return [p[0], sx / n];
    });
    band.cx = makeCenterline(pts);
    const ws = src.map((p) => p[2]).sort((a, b) => a - b);
    band.w = Math.min(Math.max(ws[ws.length >> 1] - 14, 24), HALF_CAP * 2);
    let lo = Infinity, hi = -Infinity;
    for (const [, x] of pts) { lo = Math.min(lo, x); hi = Math.max(hi, x); }
    band.minX = lo - band.w / 2;
    band.maxX = hi + band.w / 2;
    // Étendue réelle du fleuve (z) : l'eau et les quais ne débordent plus en
    // ligne droite au-delà (fini les « restes de quais » qui prolongeaient
    // le fleuve là où il n'y en a plus).
    band.zMin = pts[0][0];
    band.zMax = pts[pts.length - 1][0];
  });
  const rand = makeRand(7);
  const full = Array.isArray(data.hills) && data.hills.length > 0;

  const sorted = [...data.water].sort((a, b) => a.minX - b.minX);
  const west = sorted[0];
  const east = sorted[sorted.length - 1];

  // (Plus de recalage de Fourvière : il compensait des fleuves mal placés.
  // Maintenant que l'eau vient de la vraie géométrie OSM, les collines codées
  // en dur — issues des mêmes coordonnées OSM — retombent naturellement à leur
  // place par rapport aux fleuves.)

  // Plus de boîte englobante pour l'eau : avec des fleuves courbes qui
  // convergent à la Confluence, une boîte raserait la Presqu'île. L'exclusion
  // des bâtiments/arbres se fait par distance au tracé (nearRiver), par z.
  WATER_RECTS = [];

  let WEST = -(bound + 2);
  const EAST = bound + 2;
  let legacyHill = null;

  // Confluence (les deux régimes) : la Presqu'île finit en pointe entre les
  // deux fleuves, qui fusionnent au sud en un seul fleuve.
  const zConf = full ? (data.confluenceZ ?? bound - 90) : bound - 70;
  const CONF = {
    xL: west.minX, xR: east.maxX,
    x0: west.maxX, x1: east.minX,
    zStart: zConf,
    zTip: zConf + Math.min(130, (east.minX - west.maxX) * 0.7),
    zEnd: bound + 120,
  };
  // Le musée réel se trouve juste au nord de la pointe, entre les deux rives.
  const museumZ = zConf - 58;
  const museumWest = riverCx(west, museumZ) + riverHalf(west);
  const museumEast = riverCx(east, museumZ) - riverHalf(east);
  const museumX = (museumWest + museumEast) / 2;
  const MUSEUM_RECT = {
    minX: museumX - 42, maxX: museumX + 42,
    minZ: museumZ - 28, maxZ: museumZ + 28,
  };
  // Réserve bâtiments : toute la zone de confluence (eau + pointe + musée)
  const CONF_RECT = { minX: west.minX, maxX: east.maxX, minZ: zConf - 30, maxZ: bound + 300 };

  if (full) {
    // --- VILLE COMPLÈTE : le vrai Lyon OSM tel quel. L'eau est rendue
    // DIRECTEMENT depuis les polygones OSM (bras est-ouest du quai
    // Saint-Vincent compris) ; le masque d'eau creuse le lit dans le terrain
    // et sert de vérité pour bâtiments/arbres/PNJ. Les collines réelles
    // (Fourvière, Croix-Rousse — mêmes coordonnées OSM que le reste) posent
    // le relief partout où il n'y a pas d'eau. Aucune zone rasée.
    HILL_RECT = null;
    // Place Bellecour À L'ÉCHELLE, encadrée par les vraies façades OSM.
    // La salle d'arcade devient le pavillon central de la place (comme les
    // vrais pavillons de Bellecour) — déplacée AVANT toute construction pour
    // que zones réservées, portes et bornes suivent.
    BELLE_RECT = BELLECOUR_REAL;
    ctx.bellecourRect = BELLECOUR_REAL;

    // AXE DE LA PRESQU'ÎLE : la vraie place Bellecour n'est pas alignée
    // nord-sud, elle est PERPENDICULAIRE aux fleuves (et aux avenues qui
    // les suivent). On mesure la pente moyenne des deux tracés au niveau
    // de la place et on tourne toute la place de cet angle (voir belleCtx).
    const slopeOf = (b) => (b?.cx ? (b.cx(150) - b.cx(-150)) / 300 : 0); // fenêtre large : l'axe des avenues, pas le méandre local
    const mAvg = (slopeOf(west) + slopeOf(east)) / 2;
    const bcx0 = (BELLECOUR_REAL.minX + BELLECOUR_REAL.maxX) / 2;
    const bcz0 = (BELLECOUR_REAL.minZ + BELLECOUR_REAL.maxZ) / 2;
    const bYaw = Math.atan(mAvg);
    const bCos = Math.cos(bYaw), bSin = Math.sin(bYaw);
    ctx.belleRot = {
      yaw: bYaw,
      apply(x, z) {
        const dx = x - bcx0, dz = z - bcz0;
        return [bcx0 + dx * bCos + dz * bSin, bcz0 - dx * bSin + dz * bCos];
      },
    };

    // Pavillon au centre-OUEST : à bonne distance de la grande roue (20,20)
    // et de la prairie qui occupe l'est de la place. Position tournée avec
    // la place (portes/bornes/zones réservées suivent).
    [ARCADE.x, ARCADE.z] = ctx.belleRot.apply(-48, 3);
    // Basilique RECULÉE de 18 m vers le cœur de la colline (elle débordait
    // dans le vide au bord de la pente) ; esplanade dégagée autour, et parc
    // du Rosaire qui descend vers Saint-Jean (sans bâtiments, planté d'arbres).
    const basPos = data.poi?.basilica ?? [-369, -244.5];
    const basX = basPos[0] - 18, basZ = basPos[1];
    const ESPL = { minX: basX - 44, maxX: basX + 40, minZ: basZ - 32, maxZ: basZ + 32 };
    const PARC = { minX: basX + 40, maxX: -212, minZ: -292, maxZ: -142 };
    // On remplace l'empreinte OSM générique du musée par le grand modèle en
    // verre : sa zone doit être réservée avant la construction des bâtiments.
    EXTRA_RECTS = [ESPL, PARC, MUSEUM_RECT];
    ctx.parkRects = [PARC];
    const mask = buildWaterMask(data.waterPolys, bound);
    // Les polygones Overpass peuvent finir quelques dizaines de mètres avant
    // le bord sud. On renforce les deux lits réels et prolonge le Rhône après
    // la jonction, jusqu'au-delà de la limite visible de la carte.
    const rhoneContinuation = mask
      ? reinforceRiverWater(mask, data.water, east, zConf, bound)
      : null;
    ctx.waterExtensions = rhoneContinuation ? [{
      ...rhoneContinuation,
      name: 'rhone-aval', w: rhoneContinuation.half * 2,
      minX: Math.min(rhoneContinuation.cx(rhoneContinuation.zStart), rhoneContinuation.cx(rhoneContinuation.zEnd)) - rhoneContinuation.half,
      maxX: Math.max(rhoneContinuation.cx(rhoneContinuation.zStart), rhoneContinuation.cx(rhoneContinuation.zEnd)) + rhoneContinuation.half,
      zMin: rhoneContinuation.zStart, zMax: rhoneContinuation.zEnd,
    }] : [];
    ctx.waterMask = mask;
    const hillsBase = Array.isArray(data.hills) && data.hills.length
      ? makeHillsFn(data.hills) : () => 0;
    // Esplanade en plateau : la pente de la colline est écrêtée à la hauteur
    // de la basilique (sinon elle ressort à travers le sol de la nef)
    const basY0 = hillsBase(basX, basZ);
    const ground = (x, z) => {
      let h = hillsBase(x, z);
      if (x > ESPL.minX && x < ESPL.maxX && z > ESPL.minZ && z < ESPL.maxZ) {
        h = Math.min(h, basY0);
      }
      return h;
    };
    if (mask) {
      // ÉCRÊTAGE DES COLLINES PRÈS DE L'EAU : les ellipsoïdes (Fourvière,
      // Sainte-Foy…) chevauchent les polygones du fleuve — sans ça, un mur
      // vert plonge dans la Saône. À ≤16 m de l'eau le sol reste au niveau
      // du quai, jusqu'à 48 m la colline est plafonnée, au-delà elle est
      // libre. (Sondes sur le masque, seulement quand il y a du relief.)
      const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1], [0.7, 0.7], [-0.7, 0.7], [0.7, -0.7], [-0.7, -0.7]];
      const shoreMax = (x, z) => {
        for (const [dx, dz] of DIRS) if (mask.isWater(x + dx * 16, z + dz * 16)) return 0.5;
        for (const [dx, dz] of DIRS) if (mask.isWater(x + dx * 48, z + dz * 48)) return 12;
        return Infinity;
      };
      ctx.terrainHeight = (x, z) => {
        if (mask.isWater(x, z)) return BED_Y;
        const h = ground(x, z);
        return h > 0.5 ? Math.min(h, shoreMax(x, z)) : h;
      };
      buildWaterSurfaces(ctx, data.waterPolys);
      if (rhoneContinuation) buildRiverContinuation(ctx, rhoneContinuation);
      buildQuayEdges(ctx, mask); // murets de pierre : fin des débordements
    } else {
      ctx.terrainHeight = ground;
      composeRiverTerrain(ctx, data.water, [], null);
    }
    buildTerrainMesh(ctx, bound, data);
    // rand DÉDIÉ : ne pas consommer le générateur partagé ici, sinon tout
    // le placement aval (arbres, teintes…) se décale d'une version à l'autre
    buildCountryside(ctx, bound, makeRand(4217));
    buildAlps(ctx, bound, makeRand(74));
  } else {
    // --- ANCIEN JSON : colline synthétique collée à l'ouest de la Saône --
    EXTRA_RECTS = [CONF_RECT];
    legacyHill = {
      cx: (west ? west.minX : -bound) - 112,
      cz: -20, cy: -4, rx: 90, ry: 38.5, rz: 110,
    };
    HILL_RECT = {
      minX: legacyHill.cx - legacyHill.rx - 4, maxX: legacyHill.cx + legacyHill.rx + 6,
      minZ: legacyHill.cz - legacyHill.rz, maxZ: legacyHill.cz + legacyHill.rz,
    };
    WEST = Math.min(-(bound + 2), legacyHill.cx - legacyHill.rx - 12);
    buildGround(ctx, Math.max(bound, -WEST), data.water);
  }

  buildWater(ctx, data.water, bound, zConf);
  buildOsmBuildings(ctx, data, rand, full);
  buildOsmRoads(ctx, data, full);
  buildGreenery(ctx, data, rand, full);
  if (full) buildConfluenceMuseum(ctx, { x: museumX, z: museumZ, scale: 1.08 });

  // Lieux de gameplay (zones déjà déblayées des bâtiments OSM)
  const BELLE = BELLE_RECT ?? BELLECOUR;
  buildBellecour(belleCtx(ctx), BELLE, full);
  // Jetpack sur la place, côté sud-ouest près du jardin (à l'écart du
  // cercle de spawn et du pavillon arcade) — position tournée avec la place
  const [jpX, jpZ] = ctx.belleRot
    ? ctx.belleRot.apply(BELLE.minX + 10, BELLE.maxZ - 10)
    : [full ? BELLE.minX + 10 : BELLE.maxX - 8, BELLE.maxZ - 10];
  buildJetpackPad(ctx, jpX, jpZ);
  buildMurPeint(ctx);
  buildGrandeRoue(ctx);
  buildFountain(ctx);
  buildStreetFurniture(ctx);
  buildPeniches(ctx, data.water);
  // Le silure remonte le plus large des fleuves (le Rhône)
  const widest = [...data.water].sort((a, b) => (b.maxX - b.minX) - (a.maxX - a.minX))[0];
  if (widest) buildSilure(ctx, widest);

  if (full) {
    // Trafic sur les vrais quais courbes ; basilique de Fourvière (reculée
    // sur la colline) + parc du Rosaire qui descend vers Saint-Jean.
    buildTraffic(ctx, data.water, bound - 8);
    // Bars à terrasse sur les quais du fleuve le plus large (le Rhône) :
    // musique, parasols et PNJ installés — chacun son ambiance
    if (widest?.cx) {
      const bars = [
        { z: 92, nom: 'CHEZ GNAFRON', track: 1 },
        { z: -168, nom: 'LE QUAI DES GONES', track: 2 },
        { z: 268, nom: 'LA PÉNICHE ARCADE', track: 3 },
      ];
      const halfW = riverHalf(widest);
      for (const b of bars) {
        // En retrait de l'avenue du quai (voitures garées comprises)
        const bx = riverCx(widest, b.z) - halfW - 27;
        if (ctx.waterMask?.isWater(bx, b.z)) continue; // jamais les pieds dans l'eau
        buildTerrasse(ctx, bx, b.z, Math.PI / 2, b.nom, b.track);
      }
    }
    const basP = data.poi?.basilica ?? [-369, -244.5];
    const bX = basP[0] - 18, bZ = basP[1];
    const basY = Math.max(0, ctx.terrainHeight(bX, bZ));
    buildBasilica(ctx, bX, bZ, basY);
    buildParcRosaire(ctx, bX + 42, bZ, -215, -152);
    // Le Crayon : repéré par nom dans les données OSM, sinon position
    // approximative (calculée avec la même projection que fetch-osm.mjs)
    const [crX, crZ, crH] = data.poi?.crayon ?? [1045, -150, 99];
    buildCrayonLandmark(ctx, crX, crZ, crH, Math.max(0, ctx.terrainHeight(crX, crZ)));
  } else {
    buildFourviere(ctx, legacyHill);
    // Pointe de terre = sol, le reste (fleuves + confluence) = eau
    composeRiverTerrain(ctx, data.water, [], CONF);
    buildTraboules(ctx, osmTraboules(ctx, legacyHill));
    buildConfluence(ctx, CONF);
    buildTraffic(ctx, data.water, zConf - 12);
    // Crayon décoratif hors carte (dans la ville complète, le vrai y est)
    buildFarLandmarks(ctx, bound);
  }
  buildLamps(ctx, lampSpotsOsm(ctx, data, full, zConf));

  for (const [x, z, w, d] of [
    [(WEST + EAST) / 2, -bound - 2, EAST - WEST + 8, 4],
    [(WEST + EAST) / 2, bound + 2, EAST - WEST + 8, 4],
    [WEST, 0, 4, bound * 2 + 20],
    [EAST, 0, 4, bound * 2 + 20],
  ]) {
    addInvisibleWall(ctx, { x, z, w, d, h: 80 });
  }
}

// Champ d'urbanisation CONTINU. L'ancienne grille booléenne de 48 m peignait
// de grands carrés gris parfaitement visibles au niveau du sol. On indexe
// désormais bâtiments et grands axes dans une grille spatiale, mais la
// couleur finale dépend de leur distance réelle avec un fondu doux.
function buildUrbanField(data, bound) {
  const CELL = 72;
  const off = bound + 160;
  const buckets = new Map();
  const key = (cx, cz) => `${cx}:${cz}`;
  const add = (x, z) => {
    if (!Number.isFinite(x) || !Number.isFinite(z)) return;
    const cx = Math.floor((x + off) / CELL), cz = Math.floor((z + off) / CELL);
    const k = key(cx, cz);
    if (!buckets.has(k)) buckets.set(k, []);
    buckets.get(k).push([x, z]);
  };
  for (const b of data.buildings ?? []) {
    let sx = 0, sz = 0, n = 0;
    for (let i = 0; i + 1 < b.p.length; i += 2) {
      sx += b.p[i]; sz += b.p[i + 1]; n++;
    }
    if (n) add(sx / n, sz / n);
  }
  // Les avenues relient naturellement les îlots et évitent des poches de
  // campagne entre deux pâtés de maisons espacés.
  for (const road of data.roads ?? []) {
    if (road.w < 5) continue;
    for (let i = 0; i + 1 < road.p.length; i += 12) add(road.p[i], road.p[i + 1]);
  }
  return (x, z) => {
    const cx = Math.floor((x + off) / CELL), cz = Math.floor((z + off) / CELL);
    let d2 = Infinity;
    for (let dx = -2; dx <= 2; dx++) {
      for (let dz = -2; dz <= 2; dz++) {
        for (const p of buckets.get(key(cx + dx, cz + dz)) ?? []) {
          const px = x - p[0], pz = z - p[1];
          d2 = Math.min(d2, px * px + pz * pz);
        }
      }
    }
    const t = THREE.MathUtils.clamp((Math.sqrt(d2) - 32) / 105, 0, 1);
    return 1 - t * t * (3 - 2 * t); // smoothstep inversé, sans bord carré
  };
}

// Terrain continu de la ville complète : un seul maillage déplacé par la
// fonction de hauteur (collines, lits des fleuves), coloré par altitude.
function buildTerrainMesh(ctx, bound, data) {
  const size = bound * 2 + 240;
  // Maille < 11 m sur le Grand Lyon : assez fine pour qu'aucun triangle de
  // colline ne puisse ponter les 24–60 m d'un fleuve étroit comme la Saône.
  const seg = 320;
  const geo = new THREE.PlaneGeometry(size, size, seg, seg);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  // Socle urbain CLAIR (béton/dalle) : les rubans d'asphalte foncé des rues
  // OSM (buildOsmRoads) ressortent enfin — avant, sol et chaussée avaient
  // quasi la même teinte sombre et les rues étaient invisibles.
  const asphalt = new THREE.Color(0x83817a);
  const grass = new THREE.Color(0x4d6b43);
  const forest = new THREE.Color(0x36512e);
  const bedC = new THREE.Color(0x27352b);
  const meadow = new THREE.Color(0x5d7a4a);
  const parks = ctx.parkRects ?? [];
  const urban = buildUrbanField(data, bound);
  // Berges/quais : bitume conservé près des fleuves même sans bâtiment
  const bands = ctx.waterBands ?? [];
  const quayBlend = (x, z) => {
    let best = 0;
    for (const b of bands) {
      const minX = b.minX ?? Infinity, maxX = b.maxX ?? -Infinity;
      const minZ = b.zMin ?? -bound, maxZ = b.zMax ?? bound;
      const dx = x < minX ? minX - x : x > maxX ? x - maxX : 0;
      const dz = z < minZ ? minZ - z : z > maxZ ? z - maxZ : 0;
      const d = Math.hypot(dx, dz);
      const t = THREE.MathUtils.clamp((d - 10) / 30, 0, 1);
      best = Math.max(best, 1 - t * t * (3 - 2 * t));
    }
    return best * 0.82;
  };
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    const h = ctx.terrainHeight(x, z);
    pos.setY(i, h);
    const inPark = parks.some((r) => x > r.minX && x < r.maxX && z > r.minZ && z < r.maxZ);
    if (h < -0.5) c.copy(bedC);
    else if (inPark) c.copy(grass).lerp(forest, 0.25); // parcs toujours en herbe
    else if (h < 1.4) {
      // Campagne : patchwork de champs, puis transition progressive vers le
      // socle urbain. Plus aucun cadre de cellule visible.
      const hsh = ((Math.floor(x / 64) * 73856093) ^ (Math.floor(z / 64) * 19349663)) >>> 0;
      c.copy(meadow).offsetHSL(((hsh % 13) - 6) * 0.004, 0, ((hsh % 7) - 3) * 0.02);
      c.lerp(asphalt, Math.max(urban(x, z), quayBlend(x, z)));
    } else c.copy(grass).lerp(forest, Math.min(1, (h - 1.4) / 32));
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  // UV planaires + grain procédural répété : les places et esplanades ont un
  // vrai sol dallé au lieu d'un aplat uni (multiplié par la couleur au sommet)
  const uv = geo.attributes.uv;
  for (let i = 0; i < uv.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    uv.setXY(i, x / 14, z / 14);
  }
  const detail = makeGroundDetailTexture();
  const mesh = new THREE.Mesh(
    geo,
    new THREE.MeshLambertMaterial({ vertexColors: true, map: detail })
  );
  ctx.scene.add(mesh);
}

// Une colline d'horizon est très large : son centre peut être hors carte alors
// que sa base remonte jusque dans un fleuve. On teste donc son empreinte contre
// les centerlines, pas uniquement son point central.
function hillTouchesWater(ctx, x, z, radius, bound) {
  const corridors = [...(ctx.waterBands ?? []), ...(ctx.waterExtensions ?? [])];
  for (const band of corridors) {
    if (typeof band.cx !== 'function') continue;
    const zMin = Math.max(z - radius, band.zMin ?? -bound);
    const zMax = Math.min(z + radius, band.zMax ?? bound);
    if (zMin > zMax) continue;
    const steps = Math.max(1, Math.ceil((zMax - zMin) / 24));
    const half = riverHalf(band) + 12; // garde une petite respiration de berge
    for (let i = 0; i <= steps; i++) {
      const sampleZ = zMin + (zMax - zMin) * (i / steps);
      const dz = sampleZ - z;
      const footprint = Math.sqrt(Math.max(0, radius * radius - dz * dz));
      if (Math.abs(x - riverCx(band, sampleZ)) <= footprint + half) return true;
    }
  }
  return false;
}

// Campagne au-delà de la carte : ferme l'horizon au lieu de laisser le vide.
// Un grand disque prairie sous le niveau du terrain + une couronne de
// collines low-poly (les monts du Lyonnais / monts d'Or) en InstancedMesh —
// deux draw calls en tout, pas de collision, pas d'ombre : pur décor. Les
// vallées de la Saône, du Rhône et de leur prolongement restent ouvertes.
function buildCountryside(ctx, bound, rand) {
  const meadow = new THREE.Mesh(
    new THREE.CircleGeometry(bound * 3, 40),
    new THREE.MeshLambertMaterial({ color: 0x5d7a4a })
  );
  meadow.rotation.x = -Math.PI / 2;
  // SOUS le lit des fleuves (BED_Y), pas juste sous le terrain : un disque
  // plein centré sur la carte placé au-dessus de WATER_Y passerait le test
  // de profondeur devant TOUTES les surfaces d'eau — fleuves invisibles.
  meadow.position.y = BED_Y - 0.6;
  meadow.userData.noShadow = true;
  ctx.scene.add(meadow);

  const N = 42;
  const geo = new THREE.ConeGeometry(1, 1, 7); // écrasé/étiré par instance
  geo.translate(0, 0.5, 0); // base du cône au sol
  const mat = new THREE.MeshLambertMaterial({ color: 0x51684a });
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  const matrices = [];
  for (let i = 0; i < N; i++) {
    // Deux rangs de collines qui se chevauchent : silhouette d'horizon
    // continue sans motif répétitif visible
    const ring = i % 2 === 0 ? 1.25 : 1.55;
    const a = (i / N) * Math.PI * 2 + (rand() - 0.5) * 0.12;
    const r = bound * (ring + (rand() - 0.5) * 0.12);
    const w = bound * (0.22 + rand() * 0.2);
    const h = 30 + rand() * 55;
    q.setFromAxisAngle(up, rand() * Math.PI);
    const wz = w * (0.7 + rand() * 0.5);
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    // Le cercle englobant reste sûr malgré la rotation aléatoire de l'ellipse.
    if (hillTouchesWater(ctx, x, z, Math.max(w, wz), bound)) continue;
    s.set(w, h, wz);
    m.compose(new THREE.Vector3(x, BED_Y - 0.6, z), q, s);
    matrices.push(m.clone());
  }
  const hills = new THREE.InstancedMesh(geo, mat, matrices.length);
  matrices.forEach((matrix, i) => hills.setMatrixAt(i, matrix));
  hills.instanceMatrix.needsUpdate = true;
  hills.userData.skippedForWater = N - matrices.length;
  hills.userData.noShadow = true;
  ctx.scene.add(hills);
}

// Les Alpes à l'est, Mont Blanc en majesté — comme depuis les toits de la
// Croix-Rousse par temps clair. Panorama PEINT en canvas (zéro asset, règle
// du projet) sur un arc de cylindre au-delà des collines, hors brume (le
// voile atmosphérique est peint dans la texture), teinté par le cycle
// jour/nuit (voir l'updatable plus bas).
// Facultatif : déposer une vraie photo panoramique dans /pano/alpes.jpg sur
// le VPS (comme /pano/fourviere.jpg) et elle remplace la version peinte.
function buildAlps(ctx, bound, rand) {
  const W = 1024, H = 256;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const g = canvas.getContext('2d');

  // Enveloppe latérale : les sommets culminent vers le centre du panorama
  // et s'affaissent vers les extrémités — la chaîne MEURT à l'horizon au
  // lieu de s'arrêter net, ce qui donne l'impression qu'elle continue.
  function win(x) {
    const t = x / W;
    const s = Math.min(1, Math.min(t, 1 - t) / 0.24);
    return s * s * (3 - 2 * s); // smoothstep
  }

  // Une chaîne = un profil en dents de scie (marche aléatoire × enveloppe),
  // rempli d'un dégradé vertical : neige au sommet → roche → voile bleuté.
  function ridge(baseY, amp, snow, rock, haze, blanc = null, jag = 0.85) {
    const pts = [];
    let h = amp * 0.4; // hauteur au-dessus de la ligne de base (0..amp)
    for (let x = 0; x <= W; x += 10 + Math.floor(rand() * 14)) {
      h = Math.min(amp, Math.max(0, h + (rand() - 0.5) * amp * jag));
      pts.push([x, baseY - h * win(x)]);
    }
    pts.push([W, baseY]);
    // Mont Blanc : un dôme large et haut aux deux tiers du panorama
    if (blanc) {
      const cx = W * 0.64;
      for (const p of pts) {
        const d = Math.abs(p[0] - cx) / (W * 0.075);
        if (d < 1.6) p[1] = Math.min(p[1], baseY - amp * (1.55 - 0.6 * d * d) * win(p[0]));
      }
    }
    let top = baseY;
    for (const p of pts) top = Math.min(top, p[1]);
    const grad = g.createLinearGradient(0, top, 0, H);
    grad.addColorStop(0, snow);
    grad.addColorStop(0.15, snow); // manteau neigeux sur les sommets
    grad.addColorStop(0.42, rock); // la roche affleure sous la neige
    grad.addColorStop(0.85, haze);
    grad.addColorStop(1, 'rgba(190,205,225,0)'); // fond fondu dans le ciel
    g.fillStyle = grad;
    g.beginPath();
    g.moveTo(0, H);
    for (const [x, y2] of pts) g.lineTo(x, y2);
    g.lineTo(W, H);
    g.closePath();
    g.fill();
  }

  // Trois plans de crêtes (du plus lointain au plus proche) : c'est la
  // superposition qui fait la profondeur, donc la crédibilité. Palette
  // volontairement TRÈS claire : matériau non éclairé, teinté jour/nuit
  // plus bas.
  ridge(H * 0.44, H * 0.2, 'rgba(255,255,255,0.55)', 'rgba(214,226,240,0.5)', 'rgba(212,222,236,0.25)');
  ridge(H * 0.52, H * 0.3, 'rgba(255,255,255,0.95)', 'rgba(188,204,226,0.9)', 'rgba(205,218,232,0.4)');
  ridge(H * 0.62, H * 0.42, '#ffffff', '#93a8c2', 'rgba(195,210,228,0.5)', true, 1.2);

  // Fondu d'opacité aux deux bords : même la base de la chaîne disparaît
  // en douceur au lieu de laisser une couture verticale visible.
  g.globalCompositeOperation = 'destination-out';
  const EDGE = W * 0.09;
  for (const [x0, x1] of [[0, EDGE], [W, W - EDGE]]) {
    const fade = g.createLinearGradient(x0, 0, x1, 0);
    fade.addColorStop(0, 'rgba(0,0,0,1)');
    fade.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = fade;
    g.fillRect(Math.min(x0, x1), 0, EDGE + 1, H);
  }
  g.globalCompositeOperation = 'source-over';

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  // Matériau NON éclairé : à cette distance, l'éclairage de scène rendait la
  // neige gris foncé (paroi est jamais face au soleil). La teinte suit le
  // cycle jour/nuit à la main via ctx.env — Alpes blanches en journée,
  // silhouette bleutée au clair de lune.
  const mat = new THREE.MeshBasicMaterial({
    map: tex, transparent: true, fog: false, side: THREE.BackSide, depthWrite: false,
  });
  ctx.updatables.push(() => {
    const d = ctx.env?.daylight ?? 1;
    // mat.color est en LINÉAIRE : pour une silhouette nocturne sombre il
    // faut des valeurs très basses (0,22 linéaire ≈ gris moyen à l'écran).
    // Courbe en d² : les Alpes accrochent la dernière lumière au crépuscule.
    const k = d * d;
    mat.color.setRGB(0.03 + 0.97 * k, 0.035 + 0.965 * k, 0.06 + 0.94 * k);
  });

  // Arc de ~110° centré plein est (+x, côté Part-Dieu/aérodrome), au-delà
  // de la couronne de collines mais dans le champ de la caméra (far = 3×bound)
  // Plus loin, plus bas et beaucoup plus large : depuis les toits, la chaîne
  // paraît désormais posée sur l'horizon au lieu de dominer immédiatement
  // la ville. Les reliefs latéraux décroissants occupent près de 200°.
  const R = bound * 2.2;
  const HGT = bound * 0.2;
  const arc = 3.45;
  const geo = new THREE.CylinderGeometry(R, R, HGT, 32, 1, true, Math.PI / 2 - arc / 2, arc);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.y = HGT / 2 - 6;
  mesh.userData.noShadow = true;
  ctx.scene.add(mesh);

  // Vraie photo des Alpes : panorama COMPOSÉ hors ligne en une seule
  // texture SANS couture (WebP transparent, commité car pas d'accès direct
  // au VPS) — massif central pleine hauteur, chaînes latérales réduites qui
  // se fondent dedans par chevauchement, extrémités qui s'aplatissent puis
  // disparaissent. Plaquage simple, aucune répétition à l'exécution.
  // Si le fichier manque, la version peinte reste en place.
  new THREE.TextureLoader().load('/pano/alpes-v3.webp', (t) => {
    t.colorSpace = THREE.SRGBColorSpace;
    mat.map = t;
    mat.needsUpdate = true;
  }, undefined, () => {});
}

// Texture d'asphalte des chaussées : enrobé sombre, granulats, traces de
// roulement plus claires sur les deux bandes de circulation, fissures.
function makeAsphaltTexture() {
  const S = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = S;
  const g = canvas.getContext('2d');
  g.fillStyle = '#3b3f48';
  g.fillRect(0, 0, S, S);
  // Granulats
  for (let i = 0; i < 1500; i++) {
    const v = 46 + Math.random() * 46;
    g.fillStyle = `rgba(${v}, ${v + 3}, ${v + 8}, 0.5)`;
    g.fillRect(Math.random() * S, Math.random() * S, 1.5, 1.5);
  }
  // Traces de roulement (deux bandes longitudinales légèrement éclaircies)
  for (const u of [0.28, 0.72]) {
    const grad = g.createLinearGradient((u - 0.12) * S, 0, (u + 0.12) * S, 0);
    grad.addColorStop(0, 'rgba(120,124,132,0)');
    grad.addColorStop(0.5, 'rgba(120,124,132,0.16)');
    grad.addColorStop(1, 'rgba(120,124,132,0)');
    g.fillStyle = grad;
    g.fillRect((u - 0.12) * S, 0, 0.24 * S, S);
  }
  // Fissures fines
  g.strokeStyle = 'rgba(24,26,30,0.5)';
  g.lineWidth = 1;
  for (let i = 0; i < 4; i++) {
    let x = Math.random() * S, y = 0;
    g.beginPath();
    g.moveTo(x, y);
    while (y < S) { x += (Math.random() - 0.5) * 14; y += 10 + Math.random() * 16; g.lineTo(x, y); }
    g.stroke();
  }
  const tex2 = new THREE.CanvasTexture(canvas);
  tex2.colorSpace = THREE.SRGBColorSpace;
  tex2.wrapS = tex2.wrapT = THREE.RepeatWrapping;
  return tex2;
}

// Micro-texture de sol SANS CADRE : l'ancienne tuile dessinait une grille de
// dalles complète tous les 14 m, y compris sous l'herbe, ce qui révélait le
// raccord du matériau. Ici le bruit est périodique et les détails restent
// assez fins pour enrichir béton, terre et prairie sans motif lisible.
function makeGroundDetailTexture() {
  const S = 256;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = S;
  const g = canvas.getContext('2d');
  const image = g.createImageData(S, S);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      // Fréquences entières : la valeur est identique aux bords opposés.
      const wave = Math.sin(x / S * Math.PI * 12) * 2.2 +
        Math.sin(y / S * Math.PI * 18) * 1.8 +
        Math.sin((x + y) / S * Math.PI * 8) * 1.4;
      const grain = ((x * 17 + y * 31 + (x * y) % 19) % 11) - 5;
      const v = Math.round(238 + wave + grain * 0.55);
      const i = (y * S + x) * 4;
      image.data[i] = v;
      image.data[i + 1] = v;
      image.data[i + 2] = v - 3;
      image.data[i + 3] = 255;
    }
  }
  g.putImageData(image, 0, 0);
  // Petits granulats sans forme assez grande pour trahir la répétition.
  for (let i = 0; i < 1600; i++) {
    const v = 175 + (i * 37) % 65;
    g.fillStyle = `rgba(${v},${v},${v},0.22)`;
    g.fillRect((i * 73) % S, (i * 151) % S, 1, 1);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

// Béton de trottoir distinct de la chaussée : petites plaques décalées,
// joints fins et teintes chaudes. Les bords opposés utilisent la même base,
// donc le raccord de tuile reste discret.
function makeSidewalkTexture() {
  const S = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = S;
  const g = canvas.getContext('2d');
  g.fillStyle = '#a9a49a';
  g.fillRect(0, 0, S, S);
  for (let y = 0; y < S; y += 32) {
    g.fillStyle = y % 64 === 0 ? '#aaa69e' : '#9e9b94';
    g.fillRect(0, y + 1, S, 30);
    g.strokeStyle = 'rgba(52,52,50,.38)';
    g.lineWidth = 1;
    g.beginPath(); g.moveTo(0, y + 0.5); g.lineTo(S, y + 0.5); g.stroke();
    const off = y % 64 === 0 ? 0 : 24;
    for (let x = off; x < S; x += 48) {
      g.beginPath(); g.moveTo(x + 0.5, y); g.lineTo(x + 0.5, y + 32); g.stroke();
    }
  }
  for (let i = 0; i < 500; i++) {
    const v = 90 + (i * 29) % 80;
    g.fillStyle = `rgba(${v},${v},${v},.16)`;
    g.fillRect((i * 47) % S, (i * 83) % S, 1, 1);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

// Lampadaires du mode OSM : quais des deux fleuves (le long du tracé courbe
// réel), tour de Bellecour, et un échantillon des grands axes routiers.
function lampSpotsOsm(ctx, data, full = false, zConf = null) {
  const spots = [];
  // Vraie berge disponible (contours lissés du masque d'eau) : lampadaires
  // posés LE LONG DU CONTOUR, à 3,5 m côté terre — fini les lampadaires
  // les pieds dans l'eau quand la ligne médiane sous-estime la largeur.
  if (ctx.quayContours?.length) {
    for (const { pts, perps, sgn } of ctx.quayContours) {
      let acc = 0;
      for (let i = 1; i < pts.length; i++) {
        acc += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
        if (acc < 24) continue;
        acc = 0;
        const x = pts[i][0] + perps[i][0] * sgn * 3.5;
        const z = pts[i][1] + perps[i][1] * sgn * 3.5;
        if (!ctx.waterMask?.isWater(x, z)) spots.push([x, z]);
      }
    }
  } else
  for (const band of data.water) {
    const half = riverHalf(band);
    const zLo = Math.max(band.zMin ?? (-ctx.worldBound + 12), -ctx.worldBound + 12);
    const zHi = Math.min(band.zMax ?? (zConf != null ? zConf - 6 : ctx.worldBound - 12), ctx.worldBound - 12);
    for (const side of [-1, 1]) {
      for (let z = zLo + 6; z < zHi; z += 24) {
        if (Math.abs(z) < 6) continue;
        spots.push([riverCx(band, z) + side * (half + 6.5), z]);
      }
    }
  }
  {
    // Tour de Bellecour (petit rect en legacy, place à l'échelle en full)
    const B = ctx.bellecourRect ?? BELLECOUR;
    const n = ctx.bellecourRect ? 11 : 8;
    const rot = ctx.belleRot ? ctx.belleRot.apply : (x, z) => [x, z];
    for (let i = 0; i < n; i++) {
      const x = B.minX + 6 + i * ((B.maxX - B.minX - 12) / (n - 1));
      spots.push(rot(x, B.minZ + 1.5), rot(x, B.maxZ - 1.5));
    }
  }
  const inWater = (x, z) => (ctx.waterMask ? ctx.waterMask.isWater(x, z) : nearRiver(data.water, x, z, 4));
  const cap = full ? 700 : 220;
  let done = false;
  for (const road of data.roads) {
    if (done) break;
    if (road.w < 6) continue; // seulement les grands axes
    for (let i = 0; i + 1 < road.p.length; i += 20) {
      const x = road.p[i], z = road.p[i + 1];
      if (inWater(x, z) || Math.abs(x) > ctx.worldBound - 6 || Math.abs(z) > ctx.worldBound - 6) continue;
      const gy = full ? Math.max(0, ctx.terrainHeight?.(x, z) ?? 0) : 0;
      spots.push([x + road.w / 2 + 1.5, z, gy]);
      if (spots.length > cap) { done = true; break; }
    }
  }
  return spots;
}

// Traboules du mode OSM : uniquement des points sûrs (zones réservées),
// puisque les bâtiments OSM peuvent pousser n'importe où ailleurs.
function osmTraboules(ctx, hillDef) {
  const hx = hillDef.cx + 23, hz = hillDef.cz + 9;
  const hy = Math.max(0, ctx.terrainHeight?.(hx, hz) ?? 0);
  return [
    {
      a: { x: -38, z: 6, ry: Math.PI / 2 },
      b: { x: -30, z: -118, ry: 0 },
      loreAB: '🚪 Tu as traboulé jusqu’aux pentes ! Les canuts passaient par là.',
      loreBA: '🚪 Retour à Bellecour par la traboule des canuts.',
    },
    {
      a: { x: hillDef.cx + hillDef.rx + 2, z: hillDef.cz + 16, ry: Math.PI / 2 },
      b: { x: hx, z: hz, ry: Math.PI / 2, y: hy },
      loreAB: '🚪 La ficelle des pauvres : cette traboule grimpe à Fourvière !',
      loreBA: '🚪 Descente express : te voilà au pied de la colline.',
    },
    {
      a: { x: 52, z: 100, ry: Math.PI },
      // Flanc droit de la salle d'arcade (côté est), pas devant la porte
      b: { x: 13, z: -70, ry: Math.PI / 2 },
      loreAB: '🚪 Raccourci de gone : du stand de tir à la salle d’arcade.',
      loreBA: '🚪 Sortie secrète de l’arcade, côté stand de tir.',
    },
  ];
}

// Sol en bandes : les fleuves sont creusés (l'eau coule en contrebas)
function buildGround(ctx, bound, bands) {
  const size = bound * 2 + 400;
  const edges = [...bands].sort((a, b) => a.minX - b.minX);
  const xs = [-size / 2];
  for (const b of edges) xs.push(b.minX, b.maxX);
  xs.push(size / 2);
  const mat = new THREE.MeshLambertMaterial({ color: 0x4a505d });
  for (let i = 0; i < xs.length; i += 2) {
    const x0 = xs[i], x1 = xs[i + 1];
    if (x1 - x0 < 1) continue;
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0, size), mat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.set((x0 + x1) / 2, 0, 0);
    ctx.scene.add(ground);
  }
}

function buildWater(ctx, bands, bound, zConf = null) {
  for (const band of bands) {
    // Le fleuve ne s'étend qu'à son emprise réelle (band.zMin/zMax issus de la
    // géométrie OSM) ; à défaut, on borne à la Confluence au sud comme avant.
    const zMax = band.zMax != null ? band.zMax : (zConf != null ? zConf : bound + 100);
    const zLo = band.zMin != null ? band.zMin : -bound - 100;
    // Ponts répartis dans l'emprise du fleuve (jamais au-delà)
    const bridgesZ = [0, 170, -170, 340, -340].filter(
      (z) => z > zLo + 40 && z < zMax - 40 && Math.abs(z) < bound - 30
    );
    // Quand l'eau vient des polygones OSM (ctx.waterMask), le ruban centerline
    // ne sert plus qu'aux PONTS — le lit, l'eau, les murs et parapets du ruban
    // seraient faux dans les bras est-ouest.
    buildRiverWorks(ctx, band, {
      halfLength: bound + 100,
      zMin: zLo,
      zMax,
      bridgesZ,
      parapetHalf: bound,
      bridgesOnly: !!ctx.waterMask,
    });
    const quayMat = new THREE.MeshLambertMaterial({ color: 0x8d8676, side: THREE.DoubleSide });
    if (band.cx) {
      // Fleuve courbe : trottoirs de quai en ruban qui suit le méandre.
      // `side` = -1 (rive ouest) / +1 (rive est) ; largeur du trottoir 5 m.
      // Hors de l'eau réelle uniquement (masque) : pas de trottoir en travers
      // d'un bras que le tracé nord-sud représente mal.
      const half = riverHalf(band);
      for (const side of [-1, 1]) {
        const STEP = 6, pos = [];
        for (let z = zLo; z < zMax; z += STEP) {
          const za = z, zb = Math.min(z + STEP, zMax);
          const ia = riverCx(band, za) + side * half, ib = riverCx(band, zb) + side * half;
          const oa = ia + side * 5, ob = ib + side * 5;
          if (ctx.waterMask?.isWater((ia + oa) / 2, za) || ctx.waterMask?.isWater((ib + ob) / 2, zb)) continue;
          // ordre gauche→droite (x croissant) pour une normale vers le haut
          const [la, ra] = side < 0 ? [oa, ia] : [ia, oa];
          const [lb, rb] = side < 0 ? [ob, ib] : [ib, ob];
          pos.push(la, 0.018, za, ra, 0.018, za, rb, 0.018, zb,
                   la, 0.018, za, rb, 0.018, zb, lb, 0.018, zb);
        }
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        geo.computeVertexNormals();
        ctx.scene.add(new THREE.Mesh(geo, quayMat));
      }
    } else {
      const qLen = zMax - zLo;
      for (const x of [band.minX - 2.5, band.maxX + 2.5]) {
        const quay = new THREE.Mesh(new THREE.PlaneGeometry(5, qLen), quayMat);
        quay.rotation.x = -Math.PI / 2;
        quay.position.set(x, 0.018, (zMax + zLo) / 2);
        ctx.scene.add(quay);
      }
    }
  }
}

// Ctx « tourné » pour la place Bellecour : tout ce que buildBellecour ajoute
// (meshes, colliders, interactables, POI) est pivoté de l'angle de la
// Presqu'île autour du centre de la place. Les meshes passent par un groupe
// tourné ; les colliders AABB sont ré-englobés après rotation des coins
// (approximation par excès, très acceptable pour bancs/bornes/statue).
function belleCtx(ctx) {
  const R = ctx.belleRot;
  if (!R || Math.abs(R.yaw) < 0.01) return ctx;
  const group = new THREE.Group();
  // world = C + Ry(yaw)·(p − C)  ⇔  group.rotation.y = yaw,
  // group.position = C − Ry(yaw)·C
  const c = Math.cos(R.yaw), s = Math.sin(R.yaw);
  const [cx0, cz0] = R.apply(0, 0); // = C − Ry·C appliqué à l'origine
  group.rotation.y = R.yaw;
  group.position.set(cx0 - 0, 0, cz0 - 0);
  ctx.scene.add(group);
  return {
    ...ctx,
    scene: group,
    colliders: {
      push(b) {
        const pts = [[b.minX, b.minZ], [b.maxX, b.minZ], [b.minX, b.maxZ], [b.maxX, b.maxZ]]
          .map(([x, z]) => R.apply(x, z));
        ctx.colliders.push({
          minX: Math.min(...pts.map((p) => p[0])), maxX: Math.max(...pts.map((p) => p[0])),
          minZ: Math.min(...pts.map((p) => p[1])), maxZ: Math.max(...pts.map((p) => p[1])),
          minY: b.minY, maxY: b.maxY,
        });
      },
    },
    interactables: {
      push(it) {
        const [x, z] = R.apply(it.x, it.z);
        ctx.interactables.push({ ...it, x, z });
      },
    },
    pois: {
      push(p) {
        const [x, z] = R.apply(p.x, p.z);
        ctx.pois.push({ ...p, x, z });
      },
    },
  };
}

// Zones réservées au gameplay : on retire les bâtiments OSM qui les chevauchent
function reservedRects() {
  const B = BELLE_RECT ?? BELLECOUR;
  // Place à l'échelle : marge élargie — la place est TOURNÉE de l'angle de
  // la Presqu'île, ses coins débordent du rect axial d'environ sin(yaw)·D/2
  const pB = BELLE_RECT ? 24 : 2;
  const rects = [
    { minX: B.minX - pB, maxX: B.maxX + pB, minZ: B.minZ - pB, maxZ: B.maxZ + pB },
    { minX: ARCADE.x - ARCADE.w / 2 - 9, maxX: ARCADE.x + ARCADE.w / 2 + 9, minZ: ARCADE.z - ARCADE.d / 2 - 11, maxZ: ARCADE.z + ARCADE.d / 2 + 11 },
    { minX: RANGE.x - RANGE.width / 2 - 7, maxX: RANGE.x + RANGE.width / 2 + 7, minZ: RANGE.backZ - 7, maxZ: RANGE.counterZ + 10 },
    { minX: MUR_PEINT.x - MUR_PEINT.w / 2 - 5, maxX: MUR_PEINT.x + MUR_PEINT.w / 2 + 5, minZ: MUR_PEINT.z - 8, maxZ: MUR_PEINT.z + 8 },
  ];
  if (HILL_RECT) rects.push(HILL_RECT);
  rects.push(...WATER_RECTS, ...EXTRA_RECTS);
  return rects;
}

function buildOsmBuildings(ctx, data, rand, full = false) {
  const reserved = reservedRects();
  const facadeTex = makeFacadeTexture();
  facadeTex.wrapS = facadeTex.wrapT = THREE.RepeatWrapping;
  // Fenêtres émissives : allumées la nuit via emissiveIntensity animé
  const emiTex = makeFacadeEmissive();
  emiTex.wrapS = emiTex.wrapT = THREE.RepeatWrapping;
  const wallMat = new THREE.MeshLambertMaterial({
    map: facadeTex, vertexColors: true,
    emissive: 0xffffff, emissiveMap: emiTex, emissiveIntensity: 0,
  });
  ctx.updatables.push(() => {
    wallMat.emissiveIntensity = Math.max(0, (ctx.env?.night ?? 0) * 1.1 - 0.1) * 0.8;
  });
  const roofMat = new THREE.MeshLambertMaterial({ vertexColors: true });
  // Devantures séparées, fusionnées dans un unique mesh : la ville prend vie
  // au niveau des yeux sans multiplier les draw calls par immeuble.
  const shopPos = [], shopUv = [];

  // Accumulateurs par tuile spatiale (plus grandes sur la ville complète :
  // moins de draw calls pour une carte 4× plus vaste)
  const TILE = full ? 120 : 80;
  const tiles = new Map(); // key -> { wp, wuv, wc, rp, rc }
  const tileOf = (x, z) => {
    const key = Math.floor(x / TILE) + ',' + Math.floor(z / TILE);
    let t = tiles.get(key);
    if (!t) {
      t = { wp: [], wuv: [], wc: [], rp: [], rc: [] };
      tiles.set(key, t);
    }
    return t;
  };

  const wallColor = new THREE.Color();
  const roofColor = new THREE.Color();
  const roofProps = []; // superstructures de toit (cheminées, édicules)
  const rooftopCandidates = []; // grands toits plats → rooftop bars
  const acroCol = new THREE.Color(0xc9c3b4); // pierre claire de l'acrotère
  let kept = 0;

  // Vieux Lyon : la bande de ~130 m à l'OUEST de la Saône (rive droite),
  // suivie le long du vrai tracé courbe du fleuve (centerline)
  const saone = [...data.water].sort((a, b) => a.minX - b.minX)[0];
  const inVieuxLyon = (x, z) => {
    if (!full || !saone) return false;
    if (saone.zMin != null && (z < saone.zMin || z > saone.zMax)) return false;
    const cxS = saone.cx ? saone.cx(z) : (saone.minX + saone.maxX) / 2;
    const d = cxS - x; // distance à l'ouest du centre du fleuve
    return d > (saone.w ?? 40) * 0.5 - 6 && d < (saone.w ?? 40) * 0.5 + 130;
  };

  for (let bi = 0; bi < data.buildings.length; bi++) {
    const b = data.buildings[bi];
    let h = Math.max(3, b.h);
    const pts = [];
    for (let i = 0; i < b.p.length; i += 2) pts.push([b.p[i], b.p[i + 1]]);
    if (pts.length < 3) continue;

    // AABB + zones réservées
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    let cx = 0, cz = 0;
    for (const [x, z] of pts) {
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
      cx += x; cz += z;
    }
    cx /= pts.length; cz /= pts.length;
    if (reserved.some((r) => maxX > r.minX && minX < r.maxX && maxZ > r.minZ && minZ < r.maxZ)) {
      continue;
    }
    // Pas de bâtiment sur l'eau ni sur l'avenue de quai (distance au tracé, par z)
    if (nearRiver(data.water, cx, cz, 14)) continue;
    // …ni sur l'eau réelle NI À MOINS DE 8 M de la berge (masque dilaté) :
    // la promenade de quai passe entre l'eau et les premières façades.
    if (ctx.waterMask) {
      const nearW = (x, z) => ctx.waterMask.isWater(x, z) ||
        ctx.waterMask.isWater(x + 8, z) || ctx.waterMask.isWater(x - 8, z) ||
        ctx.waterMask.isWater(x, z + 8) || ctx.waterMask.isWater(x, z - 8);
      if (nearW(cx, cz) || nearW(minX, minZ) || nearW(maxX, maxZ) ||
          nearW(minX, maxZ) || nearW(maxX, minZ)) continue;
    }

    // Sens horaire (vu de dessus) pour des normales de murs vers l'extérieur
    let area = 0;
    for (let i = 0; i < pts.length; i++) {
      const [x1, z1] = pts[i];
      const [x2, z2] = pts[(i + 1) % pts.length];
      area += x1 * z2 - x2 * z1;
    }
    if (area > 0) pts.reverse();

    const tile = tileOf(cx, cz);
    // Front bâti de Bellecour : les immeubles qui bordent la place adoptent
    // le style uniforme de la vraie place (façades crème alignées ~6 étages,
    // toits de zinc) — l'écrin haussmannien caractéristique.
    const BB = BELLE_RECT;
    const nearBelle = BB && cx > BB.minX - 34 && cx < BB.maxX + 34 &&
      cz > BB.minZ - 34 && cz < BB.maxZ + 34;
    if (nearBelle) {
      h = 19.2 + (hash2(bi) % 3) * 0.5; // quasi uniforme, ~6 étages
      wallColor.set(0xece3cd).offsetHSL(0, 0, (rand() - 0.5) * 0.015);
      roofColor.set(0x6d7585).offsetHSL(0, 0, (rand() - 0.5) * 0.02);
    } else if (inVieuxLyon(cx, cz)) {
      // Rive droite de la Saône : les façades Renaissance colorées du Vieux
      // Lyon (ocre, rose, safran) — LA carte postale. Chaque branche de ce
      // if consomme EXACTEMENT 2 rand() : la séquence déterministe des
      // bâtiments suivants ne bouge pas.
      wallColor.set(VIEUX_LYON_TINTS[hash2(bi) % VIEUX_LYON_TINTS.length])
        .offsetHSL(0, 0, (rand() - 0.5) * 0.05);
      roofColor.set(0xa8543c).offsetHSL(0, 0, (rand() - 0.5) * 0.05);
    } else {
      wallColor.set(WALL_TINTS[hash2(bi) % WALL_TINTS.length])
        .offsetHSL(0, 0, (rand() - 0.5) * 0.06);
      roofColor.set(ROOF_TINTS[hash2(bi * 7 + 3) % ROOF_TINTS.length])
        .offsetHSL(0, 0, (rand() - 0.5) * 0.05);
    }

    // Sur la ville complète, le bâtiment est posé sur le terrain (pentes de
    // la Croix-Rousse, flanc de Fourvière) avec une jupe enterrée de 2 m
    const yBase = full ? Math.max(0, ctx.terrainHeight?.(cx, cz) ?? 0) : 0;
    const y0 = yBase - (full ? 2 : 0);
    const y1 = yBase + h;

    // Murs
    for (let i = 0; i < pts.length; i++) {
      const [x1, z1] = pts[i];
      const [x2, z2] = pts[(i + 1) % pts.length];
      const len = Math.hypot(x2 - x1, z2 - z1);
      if (len < 0.05) continue;
      // Nombres ENTIERS de fenêtres : plus jamais de dernier étage coupé
      // (la cellule s'étire légèrement au lieu d'être tronquée)
      const u = Math.max(1, Math.round(len / FLOOR_M));
      const v = Math.max(1, Math.round((y1 - y0) / FLOOR_M));
      tile.wp.push(
        x1, y0, z1, x2, y0, z2, x2, y1, z2,
        x1, y0, z1, x2, y1, z2, x1, y1, z1
      );
      tile.wuv.push(0, 0, u, 0, u, v, 0, 0, u, v, 0, v);
      for (let k = 0; k < 6; k++) tile.wc.push(wallColor.r, wallColor.g, wallColor.b);

      // Rez-de-chaussée actif sur une partie déterministe des façades : baie,
      // porte, enseigne et store. Le polygonOffset du matériau évite tout
      // scintillement avec le mur existant.
      if (full && h > 7 && len > 4 && hash2(bi * 37 + i * 11) % 100 < 48) {
        const ys0 = yBase + 0.08;
        const ys1 = Math.min(yBase + 3.15, y1 - 0.15);
        const units = Math.max(1, Math.round(len / 4.5));
        shopPos.push(
          x1, ys0, z1, x2, ys0, z2, x2, ys1, z2,
          x1, ys0, z1, x2, ys1, z2, x1, ys1, z1
        );
        shopUv.push(0, 0, units, 0, units, 1, 0, 0, units, 1, 0, 1);
      }
    }

    // Toit (triangulation de l'empreinte)
    try {
      const shape = pts.map(([x, z]) => new THREE.Vector2(x, z));
      const tris = THREE.ShapeUtils.triangulateShape(shape, []);
      for (const [a, bb, c] of tris) {
        let pa = pts[a], pb = pts[bb], pc = pts[c];
        // Normale vers le haut
        const ny = (pb[1] - pa[1]) * (pc[0] - pa[0]) - (pb[0] - pa[0]) * (pc[1] - pa[1]);
        if (ny < 0) { const t = pb; pb = pc; pc = t; }
        tile.rp.push(pa[0], y1, pa[1], pb[0], y1, pb[1], pc[0], y1, pc[1]);
        for (let k = 0; k < 3; k++) tile.rc.push(roofColor.r, roofColor.g, roofColor.b);
      }
    } catch { /* empreinte dégénérée : murs seuls */ }

    // Acrotère (rebord de toit en pierre) sur les immeubles : rendu dans le
    // mesh de toit (couleur unie, pas de fenêtres). Réaliste + repère de bord.
    const footA = (maxX - minX) * (maxZ - minZ);
    if (footA > 50 && h > 7) {
      const ah = 0.75;
      for (let i = 0; i < pts.length; i++) {
        const [x1, z1] = pts[i];
        const [x2, z2] = pts[(i + 1) % pts.length];
        if (Math.hypot(x2 - x1, z2 - z1) < 0.05) continue;
        tile.rp.push(
          x1, y1, z1, x2, y1, z2, x2, y1 + ah, z2,
          x1, y1, z1, x2, y1 + ah, z2, x1, y1 + ah, z1
        );
        for (let k = 0; k < 6; k++) tile.rc.push(acroCol.r, acroCol.g, acroCol.b);
      }
    }

    // Collision : boîtes fines LE LONG DE CHAQUE MUR (découpé en tronçons de
    // 4 m) au lieu de la boîte englobante du bâtiment — les rues diagonales
    // entre les immeubles ne sont plus barrées par des murs invisibles.
    for (let i = 0; i < pts.length; i++) {
      const [x1, z1] = pts[i];
      const [x2, z2] = pts[(i + 1) % pts.length];
      const len = Math.hypot(x2 - x1, z2 - z1);
      if (len < 0.05) continue;
      const chunks = Math.max(1, Math.ceil(len / 4));
      for (let k = 0; k < chunks; k++) {
        const ax = x1 + ((x2 - x1) * k) / chunks;
        const az = z1 + ((z2 - z1) * k) / chunks;
        const bx = x1 + ((x2 - x1) * (k + 1)) / chunks;
        const bz = z1 + ((z2 - z1) * (k + 1)) / chunks;
        ctx.colliders.push({
          minX: Math.min(ax, bx) - 0.25, maxX: Math.max(ax, bx) + 0.25,
          minY: y0, maxY: y1,
          minZ: Math.min(az, bz) - 0.25, maxZ: Math.max(az, bz) + 0.25,
        });
      }
    }

    // Plateforme de toit : on peut marcher / atterrir dessus (jetpack).
    // Fine (0,7 m) juste sous le toit — les murs gèrent les côtés.
    ctx.colliders.push({
      minX, maxX, minZ, maxZ,
      minY: y1 - 0.7, maxY: y1,
    });

    // Superstructures : cheminées / édicules d'ascenseur sur les grands toits
    const foot = (maxX - minX) * (maxZ - minZ);
    if (foot > 55 && rand() < 0.75) {
      const s = Math.min(3.2, 1.1 + foot / 500);
      roofProps.push({
        x: cx + (rand() - 0.5) * (maxX - minX) * 0.4,
        z: cz + (rand() - 0.5) * (maxZ - minZ) * 0.4,
        y: y1, s, red: rand() < 0.35,
      });
    }

    // Candidat rooftop bar : grand toit plat, accessible et assez rectangulaire
    const realA = Math.abs(area) / 2;
    if (foot > 210 && h >= 12 && h <= 46 && realA / foot > 0.72) {
      rooftopCandidates.push({ cx, cz, y1, w: maxX - minX, d: maxZ - minZ });
    }
    kept += 1;
  }

  // Rooftop bars : on sème quelques terrasses festives sur les grands toits,
  // bien espacées pour ne pas les avoir toutes au même endroit.
  const chosen = [];
  for (const c of rooftopCandidates) {
    if (chosen.length >= 8) break;
    if (chosen.every((o) => Math.hypot(o.cx - c.cx, o.cz - c.cz) > 90)) chosen.push(c);
  }
  ctx.rooftopBars = chosen.map((c) => ({ x: c.cx, z: c.cz, y: c.y1 }));
  for (const c of chosen) {
    const rt = buildRooftopBar(ctx, {
      x: c.cx, z: c.cz, y: c.y1,
      w: Math.min(c.w - 1.5, 22), d: Math.min(c.d - 1.5, 22),
      rand,
    });
    ctx.updatables.push(rt);
  }

  // Pas de cheminée/édicule sous une terrasse rooftop (elle occupe le toit)
  const props = roofProps.filter((p) =>
    !chosen.some((c) => Math.abs(c.cx - p.x) < c.w / 2 && Math.abs(c.cz - p.z) < c.d / 2)
  );
  // Superstructures instanciées : 2 draw calls pour tous les toits
  if (props.length) {
    const chimGeo = new THREE.BoxGeometry(1, 1, 1);
    chimGeo.translate(0, 0.5, 0);
    const edicules = new THREE.InstancedMesh(
      chimGeo, new THREE.MeshLambertMaterial({ color: 0x8a8f98 }), props.length
    );
    const chimneys = new THREE.InstancedMesh(
      chimGeo, new THREE.MeshLambertMaterial({ color: 0xa8543c }), props.length
    );
    const m = new THREE.Matrix4();
    let ne = 0, nc = 0;
    for (const p of props) {
      if (p.red) {
        m.makeScale(0.6 * p.s, 1.5 * p.s, 0.6 * p.s);
        m.setPosition(p.x, p.y, p.z);
        chimneys.setMatrixAt(nc++, m);
      } else {
        m.makeScale(2 * p.s, 1.2 * p.s, 2 * p.s);
        m.setPosition(p.x, p.y, p.z);
        edicules.setMatrixAt(ne++, m);
      }
    }
    edicules.count = ne;
    chimneys.count = nc;
    edicules.instanceMatrix.needsUpdate = true;
    chimneys.instanceMatrix.needsUpdate = true;
    if (ne) ctx.scene.add(edicules);
    if (nc) ctx.scene.add(chimneys);
  }

  for (const t of tiles.values()) {
    if (t.wp.length > 0) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(t.wp, 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(t.wuv, 2));
      geo.setAttribute('color', new THREE.Float32BufferAttribute(t.wc, 3));
      geo.computeVertexNormals();
      const mesh = new THREE.Mesh(geo, wallMat);
      mesh.userData.taggable = true;
      ctx.taggables.push(mesh);
      ctx.scene.add(mesh);
    }
    if (t.rp.length > 0) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(t.rp, 3));
      geo.setAttribute('color', new THREE.Float32BufferAttribute(t.rc, 3));
      geo.computeVertexNormals();
      ctx.scene.add(new THREE.Mesh(geo, roofMat));
    }
  }

  if (shopPos.length) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(shopPos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(shopUv, 2));
    geo.computeVertexNormals();
    const mat = new THREE.MeshLambertMaterial({
      map: makeShopfrontTexture(),
      emissive: 0xffc46b, emissiveIntensity: 0,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    });
    ctx.updatables.push(() => {
      mat.emissiveIntensity = Math.max(0, (ctx.env?.night ?? 0) - 0.15) * 0.38;
    });
    const shops = new THREE.Mesh(geo, mat);
    shops.userData.noShadow = true;
    ctx.scene.add(shops);
  }

  console.log(`Lyon OSM : ${kept} bâtiments dans ${tiles.size} tuiles.`);
}

function buildOsmRoads(ctx, data, full = false) {
  const pos = [];        // chaussée
  const walk = [];       // trottoirs (rubans élargis clairs, sous la chaussée)
  const zebra = [];      // passages piétons (quads rayés)
  const lines = [];      // marquage central pointillé des grands axes
  const walkUv = [];
  const streetDetails = []; // [x,z,y] : plaques au centre de la chaussée
  // Sur la ville complète, les rubans de route épousent le terrain
  const yAt = full
    ? (x, z) => Math.max(0, ctx.terrainHeight?.(x, z) ?? 0) + 0.06
    : () => 0.045;
  const roadUv = []; // UV de la chaussée : u en travers, v le long (asphalte)
  const ribbon = (arr, x1, z1, x2, z2, half, dy, v0 = null, uvTarget = null) => {
    const dx = x2 - x1, dz = z2 - z1;
    const len = Math.hypot(dx, dz);
    if (len < 0.1) return len;
    const px = (-dz / len) * half, pz = (dx / len) * half;
    const ya = yAt(x1, z1) + dy, yb = yAt(x2, z2) + dy;
    arr.push(
      x1 - px, ya, z1 - pz, x2 - px, yb, z2 - pz, x2 + px, yb, z2 + pz,
      x1 - px, ya, z1 - pz, x2 + px, yb, z2 + pz, x1 + px, ya, z1 + pz
    );
    if (v0 != null && uvTarget) {
      const va = v0 / 9, vb = (v0 + len) / 9; // une tuile d'asphalte ≈ 9 m
      uvTarget.push(0, va, 0, vb, 1, vb, 0, va, 1, vb, 1, va);
    }
    return len;
  };
  for (const road of data.roads) {
    const half = road.w / 2;
    let crossingAcc = 0;
    let uvAcc = 0;
    let dashAcc = 0;
    let detailAcc = 0;
    for (let i = 0; i + 3 < road.p.length; i += 2) {
      const x1 = road.p[i], z1 = road.p[i + 1];
      const x2 = road.p[i + 2], z2 = road.p[i + 3];
      // Trottoir un peu plus large et 2 cm plus bas, chaussée par-dessus
      ribbon(walk, x1, z1, x2, z2, half + 1.6, -0.02, uvAcc, walkUv);
      const len = ribbon(pos, x1, z1, x2, z2, half, 0, uvAcc, roadUv);
      uvAcc += len;
      // Passage piéton tous les ~35 m sur les grands axes
      crossingAcc += len;
      if (road.w >= 6 && crossingAcc > 35) {
        crossingAcc = 0;
        const mx = (x1 + x2) / 2, mz = (z1 + z2) / 2;
        ribbon(zebra, mx, mz, mx + (x2 - x1) / (len || 1) * 2.6, mz + (z2 - z1) / (len || 1) * 2.6, half, 0.02);
      }
      // Ligne médiane pointillée : un tiret de 2,6 m tous les ~8 m
      if (road.w >= 6.5 && len > 0.1) {
        const ux = (x2 - x1) / len, uz = (z2 - z1) / len;
        for (let d = dashAcc; d + 2.6 < len; d += 8) {
          ribbon(lines, x1 + ux * d, z1 + uz * d, x1 + ux * (d + 2.6), z1 + uz * (d + 2.6), 0.14, 0.015);
        }
        dashAcc = (dashAcc + len) % 8;
      }
      // Mobilier léger tous les ~48 m : assez dense au niveau de la rue,
      // plafonné implicitement par l'espacement et rendu en deux draw calls.
      detailAcc += len;
      if (full && road.w >= 6 && detailAcc > 48 && len > 0.1) {
        detailAcc = 0;
        const mx = (x1 + x2) / 2, mz = (z1 + z2) / 2;
        streetDetails.push([mx, mz, yAt(mx, mz) + 0.045]);
      }
    }
  }
  if (pos.length === 0) return;
  const addMesh = (arr, mat, uvs = null) => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3));
    if (uvs) geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, mat);
    mesh.userData.noShadow = true;
    ctx.scene.add(mesh);
  };
  const sidewalkTex = makeSidewalkTexture();
  addMesh(walk, new THREE.MeshLambertMaterial({ map: sidewalkTex }), walkUv);
  const asphaltTex = makeAsphaltTexture();
  addMesh(pos, new THREE.MeshLambertMaterial({
    map: asphaltTex,
    polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
  }), roadUv);
  if (zebra.length) {
    addMesh(zebra, new THREE.MeshLambertMaterial({
      color: 0xd7dccb, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    }));
  }
  if (lines.length) {
    addMesh(lines, new THREE.MeshBasicMaterial({
      color: 0xe9e4c8, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3,
    }));
  }
  if (streetDetails.length) {
    const manholeGeo = new THREE.CylinderGeometry(0.42, 0.42, 0.035, 12);
    const manholes = new THREE.InstancedMesh(
      manholeGeo,
      new THREE.MeshStandardMaterial({ color: 0x353b3d, metalness: 0.25, roughness: 0.72 }),
      streetDetails.length
    );
    const m = new THREE.Matrix4();
    streetDetails.forEach(([x, z, y], i) => {
      m.makeTranslation(x, y, z);
      manholes.setMatrixAt(i, m);
    });
    manholes.instanceMatrix.needsUpdate = true;
    manholes.userData.noShadow = true;
    ctx.scene.add(manholes);
  }
}

function buildFarLandmarks(ctx, bound) {
  // Fourvière est désormais une vraie colline jouable (buildFourviere) :
  // il ne reste ici que le décor lointain de l'est.
  buildCrayonLandmark(ctx, bound + 70, -70, 100, 0);
}

// Le Crayon (tour Part-Dieu) : en mode « ville complète », le bâtiment OSM
// existe déjà (extrusion générique, couleur haussmannienne, toit plat) —
// pile ce qu'il ne faut PAS pour la tour la plus reconnaissable de Lyon. On
// pose donc un habillage cylindrique par-dessus, à sa vraie hauteur : la
// silhouette ronde, la teinte cuivrée et la pointe reviennent, et le
// bâtiment OSM en dessous continue de fournir un collider correct.
function buildCrayonLandmark(ctx, x, z, h = 100, groundY = 0) {
  ctx.pois?.push({ id: 'crayon', nom: 'Le Crayon (Part-Dieu)', emoji: '✏️', x, z });
  const R = 15;
  const towerTex = makeSkylineTexture();
  towerTex.wrapS = towerTex.wrapT = THREE.RepeatWrapping;
  towerTex.repeat.set(12, Math.max(4, Math.round(h / 10)));
  const crayon = new THREE.Mesh(
    new THREE.CylinderGeometry(R, R, h, 20),
    new THREE.MeshLambertMaterial({ map: towerTex, color: 0xa9594a, fog: false })
  );
  crayon.position.set(x, groundY + h / 2, z);
  ctx.scene.add(crayon);
  const crown = new THREE.Mesh(
    new THREE.CylinderGeometry(R * 1.04, R * 1.04, h * 0.036, 20),
    new THREE.MeshLambertMaterial({ color: 0xd8cfc2, fog: false })
  );
  crown.position.set(x, groundY + h + h * 0.018, z);
  ctx.scene.add(crown);
  const tip = new THREE.Mesh(
    new THREE.ConeGeometry(R, h * 0.24, 20),
    new THREE.MeshLambertMaterial({ color: 0x8d4538, fog: false })
  );
  tip.position.set(x, groundY + h + h * 0.036 + (h * 0.24) / 2, z);
  ctx.scene.add(tip);
}

// Verdure : parcs, alignements le long des quais et de Bellecour. Tout le
// feuillage en un seul InstancedMesh, les troncs en un autre → 2 draw calls.
function buildGreenery(ctx, data, rand, full = false) {
  const spots = [];
  const reserved = reservedRects();
  const inReserved = (x, z) => reserved.some(
    (r) => x > r.minX && x < r.maxX && z > r.minZ && z < r.maxZ
  );
  const inWater = (x, z) => (ctx.waterMask ? ctx.waterMask.isWater(x, z) : nearRiver(data.water, x, z, 4));

  // Alignements le long des deux rives : on suit le tracé courbe du fleuve
  for (const band of data.water) {
    if (!band.cx) continue;
    const half = riverHalf(band);
    for (const side of [-1, 1]) {
      for (let z = -ctx.worldBound + 10; z < ctx.worldBound - 10; z += 9) {
        if (Math.abs(z) < 6) continue; // dégage les ponts
        spots.push([riverCx(band, z) + side * (half + 4.5), z + (rand() - 0.5) * 2]);
      }
    }
  }
  // Pourtour de Bellecour (petit rect du mode legacy uniquement ; la place à
  // l'échelle a ses doubles rangées intérieures, plantées plus bas)
  if (!ctx.bellecourRect) {
    for (let i = 0; i < 26; i++) {
      const t = i / 26;
      spots.push([BELLECOUR.minX + t * (BELLECOUR.maxX - BELLECOUR.minX), BELLECOUR.minZ - 2]);
      spots.push([BELLECOUR.minX + t * (BELLECOUR.maxX - BELLECOUR.minX), BELLECOUR.maxZ + 2]);
    }
  }
  // Arbres épars dans les rues (et sur les collines en ville complète)
  const scatter = full ? 700 : 140;
  for (let i = 0; i < scatter; i++) {
    spots.push([(rand() - 0.5) * ctx.worldBound * 1.9, (rand() - 0.5) * ctx.worldBound * 1.9]);
  }
  // Arbres d'alignement le long des grands axes OSM (des deux côtés) : le
  // tout reste dans les deux InstancedMesh, donc toujours 2 draw calls
  if (Array.isArray(data.roads)) {
    let planted = 0;
    for (const road of data.roads) {
      if (planted > 900) break;
      if (road.w < 6.5) continue;
      for (let i = 0; i + 1 < road.p.length; i += 16) {
        const x = road.p[i], z = road.p[i + 1];
        if (Math.abs(x) > ctx.worldBound - 8 || Math.abs(z) > ctx.worldBound - 8) continue;
        const side = (i % 32 === 0) ? 1 : -1; // alternance des côtés
        spots.push([x + side * (road.w / 2 + 2.2), z + (rand() - 0.5) * 2]);
        planted++;
      }
    }
  }

  // Filtre : pas dans l'eau, pas dans une zone de jeu, pas dans un bâtiment
  const valid = [];
  for (const [x, z] of spots) {
    if (inWater(x, z) || inReserved(x, z)) continue;
    const ty = full ? (ctx.terrainHeight?.(x, z) ?? 0) : 0;
    if (ty < -0.5) continue; // pas dans les lits des fleuves
    const near = ctx.colliders.nearby ? ctx.colliders.nearby(x, z, 1.5) : [];
    let hit = false;
    for (const b of near) {
      if (x > b.minX - 1 && x < b.maxX + 1 && z > b.minZ - 1 && z < b.maxZ + 1) { hit = true; break; }
    }
    if (!hit) valid.push([x, z, 0.85 + rand() * 0.5, Math.max(0, ty)]);
  }
  // Parcs (jardin du Rosaire…) : plantés dru, sans passer par le filtre des
  // zones réservées (le parc EST une zone réservée aux bâtiments)
  for (const r of ctx.parkRects ?? []) {
    for (let i = 0; i < 120; i++) {
      const x = r.minX + rand() * (r.maxX - r.minX);
      const z = r.minZ + rand() * (r.maxZ - r.minZ);
      if (inWater(x, z)) continue;
      const ty = ctx.terrainHeight?.(x, z) ?? 0;
      if (ty < -0.5) continue;
      valid.push([x, z, 0.8 + rand() * 0.6, Math.max(0, ty)]);
    }
  }
  // Bellecour à l'échelle : DOUBLES rangées d'arbres nord et sud, à
  // l'intérieur de la place, comme en vrai (même bypass que les parcs)
  if (ctx.bellecourRect) {
    const B = ctx.bellecourRect;
    const rot = ctx.belleRot ? ctx.belleRot.apply : (x, z) => [x, z];
    for (let x = B.minX + 6; x < B.maxX - 6; x += 7) {
      for (const off of [4.5, 9.5]) {
        const [xa, za] = rot(x + (rand() - 0.5) * 1.5, B.minZ + off);
        const [xb, zb] = rot(x + (rand() - 0.5) * 1.5, B.maxZ - off);
        valid.push([xa, za, 0.85 + rand() * 0.4, 0]);
        valid.push([xb, zb, 0.85 + rand() * 0.4, 0]);
      }
    }
  }
  if (valid.length === 0) return;

  const trunkMat = new THREE.MeshLambertMaterial({ color: 0x5d4632 });
  const trunkGeo = new THREE.CylinderGeometry(0.22, 0.32, 2.4, 6);
  const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, valid.length);

  const foliageGeo = new THREE.IcosahedronGeometry(1.6, 0); // facetté = feuillage
  const foliageMat = new THREE.MeshLambertMaterial({ color: 0x5b8a3f, flatShading: true });
  const foliage = new THREE.InstancedMesh(foliageGeo, foliageMat, valid.length);

  const m = new THREE.Matrix4();
  const col = new THREE.Color();
  valid.forEach(([x, z, s, ty = 0], i) => {
    m.makeScale(s, s, s);
    m.setPosition(x, ty + 1.2 * s, z);
    trunks.setMatrixAt(i, m);
    m.makeScale(s * 1.6, s * 1.5, s * 1.6);
    m.setPosition(x, ty + 3.6 * s, z);
    foliage.setMatrixAt(i, m);
    col.setHSL(0.28 + rand() * 0.06, 0.45, 0.32 + rand() * 0.12);
    foliage.setColorAt(i, col);
  });
  trunks.instanceMatrix.needsUpdate = true;
  foliage.instanceMatrix.needsUpdate = true;
  if (foliage.instanceColor) foliage.instanceColor.needsUpdate = true;
  ctx.scene.add(trunks, foliage);
}

// Cellule de commerce répétable : vitrine profonde, porte, enseigne et store.
// Une unité représente environ 4,5 m de façade.
function makeShopfrontTexture() {
  const W = 192, H = 128;
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const g = canvas.getContext('2d');
  g.fillStyle = '#77736b'; g.fillRect(0, 0, W, H);
  // Bandeau d'enseigne, suffisamment contrasté pour être lisible de loin
  g.fillStyle = '#26394a'; g.fillRect(3, 5, W - 6, 27);
  g.fillStyle = '#f2c45f';
  for (let x = 14; x < W - 10; x += 22) g.fillRect(x, 14, 12, 4);
  // Store rayé
  for (let x = 3; x < W - 3; x += 16) {
    g.fillStyle = (x / 16) % 2 ? '#c64f45' : '#eee4cf';
    g.fillRect(x, 32, 16, 13);
  }
  // Vitrines, reflets et intérieur chaud
  g.fillStyle = '#182839'; g.fillRect(7, 48, 116, 72);
  const grad = g.createLinearGradient(7, 48, 123, 120);
  grad.addColorStop(0, 'rgba(126,194,220,.7)');
  grad.addColorStop(0.45, 'rgba(28,53,75,.25)');
  grad.addColorStop(1, 'rgba(255,188,92,.45)');
  g.fillStyle = grad; g.fillRect(10, 51, 110, 66);
  g.strokeStyle = '#beb6a6'; g.lineWidth = 4;
  g.strokeRect(7, 48, 116, 72);
  g.beginPath(); g.moveTo(65, 49); g.lineTo(65, 119); g.stroke();
  // Porte vitrée et poignée
  g.fillStyle = '#24323c'; g.fillRect(132, 43, 53, 77);
  g.fillStyle = '#7394a5'; g.fillRect(138, 49, 41, 55);
  g.fillStyle = '#d9c88d'; g.fillRect(141, 108, 35, 5);
  g.fillStyle = '#f0d57b'; g.fillRect(169, 77, 4, 9);
  // Seuil + ombre de contact
  g.fillStyle = '#343331'; g.fillRect(0, 120, W, 8);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

// Cellule de fenêtre unique, répétée tous les 3 m. Quasi blanche : elle est
// multipliée par la teinte (vertex color) de chaque bâtiment.
// Cellule d'étage haussmannien (1 fenêtre, répétée tous les 3 m). Quasi
// blanche : multipliée par la teinte (vertex color) de chaque immeuble.
function makeFacadeTexture() {
  const S = 128;
  const canvas = document.createElement('canvas');
  canvas.width = S;
  canvas.height = S;
  const g = canvas.getContext('2d');

  // Pierre de taille avec léger grain
  g.fillStyle = '#f3eee4';
  g.fillRect(0, 0, S, S);
  for (let i = 0; i < 500; i++) {
    const v = 225 + Math.random() * 25;
    g.fillStyle = `rgba(${v}, ${v - 4}, ${v - 12}, 0.25)`;
    g.fillRect(Math.random() * S, Math.random() * S, 2, 2);
  }
  // Refend horizontal entre étages (joint de pierre + ombre)
  g.fillStyle = 'rgba(120, 110, 92, 0.55)';
  g.fillRect(0, S - 4, S, 3);
  g.fillStyle = 'rgba(255, 255, 255, 0.5)';
  g.fillRect(0, S - 1, S, 1);

  const wx = S * 0.27, ww = S * 0.46;
  const wy = S * 0.12, wh = S * 0.6;

  // Bandeau d'appui sous la fenêtre
  g.fillStyle = 'rgba(150, 140, 120, 0.5)';
  g.fillRect(wx - 6, wy + wh + 2, ww + 12, 4);

  // Encadrement en pierre saillante (clair dessus/gauche, ombré dessous/droite)
  g.fillStyle = '#fbf7ee';
  g.fillRect(wx - 5, wy - 5, ww + 10, wh + 10);
  g.fillStyle = 'rgba(110, 100, 84, 0.45)';
  g.fillRect(wx - 5, wy + wh + 3, ww + 10, 2);
  g.fillRect(wx + ww + 3, wy - 5, 2, wh + 10);
  // Clé de voûte stylisée au-dessus
  g.fillStyle = '#fdfaf2';
  g.fillRect(wx + ww / 2 - 5, wy - 9, 10, 8);

  // Vitre sombre avec dégradé de reflet de ciel
  const grad = g.createLinearGradient(0, wy, 0, wy + wh);
  grad.addColorStop(0, '#5b6675');
  grad.addColorStop(0.5, '#3c4654');
  grad.addColorStop(1, '#2c343f');
  g.fillStyle = grad;
  g.fillRect(wx, wy, ww, wh);
  // Reflet diagonal
  g.fillStyle = 'rgba(170, 200, 225, 0.22)';
  g.beginPath();
  g.moveTo(wx, wy);
  g.lineTo(wx + ww * 0.6, wy);
  g.lineTo(wx, wy + wh * 0.6);
  g.closePath();
  g.fill();
  // Croisée (meneau + traverse)
  g.fillStyle = 'rgba(245, 240, 230, 0.92)';
  g.fillRect(wx + ww / 2 - 1.5, wy, 3, wh);
  g.fillRect(wx, wy + wh / 2 - 1.5, ww, 3);

  // Garde-corps / balconnet en fer forgé devant l'appui
  g.strokeStyle = 'rgba(30, 32, 36, 0.8)';
  g.lineWidth = 1.4;
  const ry0 = wy + wh + 6, ry1 = ry0 + S * 0.12;
  g.beginPath();
  g.moveTo(wx - 6, ry0); g.lineTo(wx + ww + 6, ry0);
  g.moveTo(wx - 6, ry1); g.lineTo(wx + ww + 6, ry1);
  g.stroke();
  g.lineWidth = 1;
  for (let bx = wx - 4; bx <= wx + ww + 4; bx += 5) {
    g.beginPath();
    g.moveTo(bx, ry0); g.lineTo(bx, ry1);
    g.stroke();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

// Carte émissive de façade : une grille de fenêtres, ~60 % allumées au
// hasard (le reste noir), pour que la ville s'illumine la nuit SANS que
// chaque fenêtre soit allumée — comme en vrai. La grille se répète toutes
// les GRID fenêtres (repeat 1/GRID aligné sur les cellules de la façade).
const EMI_GRID = 6;
function makeFacadeEmissive() {
  const cell = 42;
  const S = cell * EMI_GRID;
  const canvas = document.createElement('canvas');
  canvas.width = S;
  canvas.height = S;
  const g = canvas.getContext('2d');
  g.fillStyle = '#000';
  g.fillRect(0, 0, S, S);
  const wx = cell * 0.27, ww = cell * 0.46, wy = cell * 0.12, wh = cell * 0.6;
  for (let gy = 0; gy < EMI_GRID; gy++) {
    for (let gx = 0; gx < EMI_GRID; gx++) {
      if (Math.random() > 0.6) continue; // ~60 % des fenêtres allumées
      const ox = gx * cell, oy = gy * cell;
      const grad = g.createLinearGradient(0, oy + wy, 0, oy + wy + wh);
      grad.addColorStop(0, '#fff1c8');
      grad.addColorStop(1, '#e6a94e');
      g.fillStyle = grad;
      g.fillRect(ox + wx, oy + wy, ww, wh);
      // Croisée sombre pour garder le dessin de la fenêtre
      g.fillStyle = '#000';
      g.fillRect(ox + wx + ww / 2 - 1.2, oy + wy, 2.4, wh);
      g.fillRect(ox + wx, oy + wy + wh / 2 - 1.2, ww, 2.4);
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(1 / EMI_GRID, 1 / EMI_GRID); // 1 cellule = 1 fenêtre de façade
  return tex;
}

function hash2(n) {
  let h = n | 0;
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return (h ^= h >>> 16) >>> 0;
}
