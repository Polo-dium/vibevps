import * as THREE from 'three';
import { addInvisibleWall } from './utils.js';
import {
  ARCADE, RANGE, MUR_PEINT, BELLECOUR, makeRand,
  makeCenterline, riverCx, riverHalf,
} from './layout.js';
import {
  makeSkylineTexture, buildBellecour,
  buildGrandeRoue, buildFountain, buildStreetFurniture, buildMurPeint,
  buildPeniches, buildSilure, buildFourviere, buildFunicular, buildLamps,
  buildTraboules, buildRiverWorks, composeRiverTerrain, buildConfluence,
  buildJetpackPad,
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

// Zones fixées par buildRealCity, consommées par reservedRects()
let HILL_RECT = null;
let WATER_RECTS = [];
let EXTRA_RECTS = [];

// Un point est-il dans (ou au bord de) l'eau, à la profondeur z ? Test par
// distance au tracé central → fonctionne même quand les fleuves se courbent
// et convergent (contrairement à une boîte englobante qui raserait la
// Presqu'île à la Confluence).
function nearRiver(bands, x, z, margin = 0) {
  for (const b of bands) {
    if (b.cx && Math.abs(x - riverCx(b, z)) < riverHalf(b) + margin) return true;
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
  const ZB = 36;
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
    const cur = merged.filter((m) => m[1] - m[0] >= 14).map((m) => ({ x: (m[0] + m[1]) / 2, w: m[1] - m[0] }));
    // chaînage nord→sud (tolérance large pour suivre les grands coudes)
    const used = new Set();
    for (const iv of cur) {
      let best = -1, bd = 1e9;
      for (let ci = 0; ci < active.length; ci++) {
        if (used.has(ci)) continue;
        const d = Math.abs(active[ci].lastX - iv.x);
        if (d < bd && d < 140) { bd = d; best = ci; }
      }
      if (best >= 0) { const c = active[best]; c.pts.push([z, iv.x, iv.w]); c.lastX = iv.x; c.gap = 0; used.add(best); }
      else active.push({ pts: [[z, iv.x, iv.w]], lastX: iv.x, gap: 0 });
    }
    for (let ci = active.length - 1; ci >= 0; ci--) {
      if (!used.has(ci) && ++active[ci].gap > 3) { done.push(active[ci]); active.splice(ci, 1); }
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
    const WIN = 2, src = r.pts;
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
  });
  const rand = makeRand(7);
  const full = Array.isArray(data.hills) && data.hills.length > 0;

  const sorted = [...data.water].sort((a, b) => a.minX - b.minX);
  const west = sorted[0];
  const east = sorted[sorted.length - 1];

  // Recalage de Fourvière (mode complet) : les lon/lat codées en dur pour la
  // colline et la basilique tombaient DANS la Presqu'île, à l'est de la Saône
  // (la ville OSM ne s'aligne pas exactement sur ces coordonnées). On ancre
  // le flanc EST de la colline sur la rive ouest de la Saône (le fleuve le
  // plus à l'ouest) et on décale la basilique du même montant : Fourvière
  // repasse ainsi côté Vieux Lyon, sous ses bâtiments, à l'ouest du fleuve.
  if (full && data.hills.length) {
    const fourviere = data.hills.reduce((a, b) => (b.cx < a.cx ? b : a));
    const shift = west.minX - (fourviere.cx + fourviere.rx * 0.85);
    if (shift < -20) {
      fourviere.cx += shift;
      if (Array.isArray(data.poi?.basilica)) data.poi.basilica[0] += shift;
    }
  }

  // Plus de boîte englobante pour l'eau : avec des fleuves courbes qui
  // convergent à la Confluence, une boîte raserait la Presqu'île. L'exclusion
  // des bâtiments/arbres se fait par distance au tracé (nearRiver), par z.
  WATER_RECTS = [];

  let WEST = -(bound + 2);
  const EAST = bound + 2;
  let bas = null;
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
  // Réserve bâtiments : toute la zone de confluence (eau + pointe + musée)
  const CONF_RECT = { minX: west.minX, maxX: east.maxX, minZ: zConf - 30, maxZ: bound + 300 };

  if (full) {
    // --- VILLE COMPLÈTE : collines réelles + terrain continu -------------
    HILL_RECT = null;
    bas = data.poi?.basilica ?? [-369, -244];
    EXTRA_RECTS = [
      // Esplanade de la basilique (avec les gares de la ficelle)
      { minX: bas[0] - 26, maxX: bas[0] + 36, minZ: bas[1] - 22, maxZ: bas[1] + 40 },
      CONF_RECT,
    ];
    ctx.terrainHeight = makeHillsFn(data.hills);
    composeRiverTerrain(ctx, data.water, [], CONF);
    buildTerrainMesh(ctx, bound);
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

  // Lieux de gameplay (zones déjà déblayées des bâtiments OSM)
  buildBellecour(ctx);
  // Jetpack disponible sur la place Bellecour (à l'écart du cercle de spawn)
  buildJetpackPad(ctx, BELLECOUR.maxX - 8, BELLECOUR.maxZ - 8);
  buildMurPeint(ctx);
  buildGrandeRoue(ctx);
  buildFountain(ctx);
  buildStreetFurniture(ctx);
  buildPeniches(ctx, data.water);
  // Le silure remonte le plus large des fleuves (le Rhône)
  const widest = [...data.water].sort((a, b) => (b.maxX - b.minX) - (a.maxX - a.minX))[0];
  if (widest) buildSilure(ctx, widest);

  if (full) {
    // Esplanade, ficelle et traboule ancrées sur la VRAIE basilique ;
    // Confluence en pointe au sud, comme en ville procédurale
    const t = ctx.terrainHeight;
    ctx.interactables.push({
      x: bas[0] + 16, z: bas[1] + 22, r: 8,
      label: 'E — Admirer Lyon depuis Fourvière',
      action: () => ctx.notify?.('🌇 Tout Lyon à tes pieds, gone. La plus belle vue du monde, et c’est pas négociable.'),
    });
    const A = new THREE.Vector3(west.minX - 22, 0.7, bas[1] + 12);
    const B = new THREE.Vector3(
      bas[0] + 20,
      Math.max(0, t(bas[0] + 20, bas[1] + 26)) + 0.3,
      bas[1] + 26
    );
    buildFunicular(ctx, A, B);
    buildTraboules(ctx, fullTraboules(ctx, bas, west));
    buildConfluence(ctx, CONF);
    buildTraffic(ctx, data.water, zConf - 12);
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

// Terrain continu de la ville complète : un seul maillage déplacé par la
// fonction de hauteur (collines, lits des fleuves), coloré par altitude.
function buildTerrainMesh(ctx, bound) {
  const size = bound * 2 + 240;
  const seg = 160;
  const geo = new THREE.PlaneGeometry(size, size, seg, seg);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  const asphalt = new THREE.Color(0x4a505d);
  const grass = new THREE.Color(0x4d6b43);
  const forest = new THREE.Color(0x36512e);
  const bedC = new THREE.Color(0x27352b);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    const h = ctx.terrainHeight(x, z);
    pos.setY(i, h);
    if (h < -0.5) c.copy(bedC);
    else if (h < 1.4) c.copy(asphalt);
    else c.copy(grass).lerp(forest, Math.min(1, (h - 1.4) / 32));
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(
    geo,
    new THREE.MeshLambertMaterial({ vertexColors: true })
  );
  ctx.scene.add(mesh);
}

// Traboules de la ville complète : ancrées sur la vraie basilique
function fullTraboules(ctx, bas, west) {
  const hx = bas[0] + 24, hz = bas[1] + 32;
  const hy = Math.max(0, ctx.terrainHeight?.(hx, hz) ?? 0);
  return [
    {
      a: { x: -38, z: 6, ry: Math.PI / 2 },
      b: { x: -30, z: -118, ry: 0 },
      loreAB: '🚪 Tu as traboulé jusqu’aux pentes ! Les canuts passaient par là.',
      loreBA: '🚪 Retour à Bellecour par la traboule des canuts.',
    },
    {
      a: { x: west.minX - 20, z: bas[1] + 30, ry: Math.PI / 2 },
      b: { x: hx, z: hz, ry: Math.PI / 2, y: hy },
      loreAB: '🚪 La ficelle des pauvres : cette traboule grimpe à Fourvière !',
      loreBA: '🚪 Descente express : te voilà au pied de la colline.',
    },
    {
      a: { x: 52, z: 100, ry: Math.PI },
      b: { x: 13, z: -70, ry: Math.PI / 2 },
      loreAB: '🚪 Raccourci de gone : du stand de tir à la salle d’arcade.',
      loreBA: '🚪 Sortie secrète de l’arcade, côté stand de tir.',
    },
  ];
}

// Lampadaires du mode OSM : quais des deux fleuves, tour de Bellecour, et un
// échantillon des grands axes routiers (posés sur les collines si besoin).
function lampSpotsOsm(ctx, data, full = false, zConf = null) {
  const spots = [];
  const zEdge = zConf != null ? zConf - 6 : ctx.worldBound - 12;
  for (const band of data.water) {
    for (const x of [band.minX - 6.5, band.maxX + 6.5]) {
      for (let z = -ctx.worldBound + 12; z < zEdge; z += 24) {
        if (Math.abs(z) < 6) continue;
        spots.push([x, z]);
      }
    }
  }
  for (let i = 0; i < 8; i++) {
    const x = BELLECOUR.minX + 6 + i * 8.2;
    spots.push([x, BELLECOUR.minZ + 1.5], [x, BELLECOUR.maxZ - 1.5]);
  }
  const inWater = (x, z) => nearRiver(data.water, x, z, 4);
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
    // Ponts sur la zone plate du centre (jamais dans les collines) ;
    // en ville complète on en met cinq, tous au nord de la Confluence
    const candidates = zConf != null
      ? [0, 170, -170, 340, -340]
      : [0, Math.round(bound * 0.55), -Math.round(bound * 0.55)];
    const bridgesZ = candidates.filter(
      (z) => Math.abs(z) < bound - 30 && (zConf == null || z < zConf - 30)
    );
    // Les fleuves s'arrêtent à la Confluence (zMax) : ils fusionnent au sud
    const zMax = zConf != null ? zConf : bound + 100;
    buildRiverWorks(ctx, band, {
      halfLength: bound + 100,
      zMax,
      bridgesZ,
      parapetHalf: bound,
    });
    const zLo = -bound - 100;
    const quayMat = new THREE.MeshLambertMaterial({ color: 0x8d8676, side: THREE.DoubleSide });
    if (band.cx) {
      // Fleuve courbe : trottoirs de quai en ruban qui suit le méandre.
      // `side` = -1 (rive ouest) / +1 (rive est) ; largeur du trottoir 5 m.
      const half = riverHalf(band);
      for (const side of [-1, 1]) {
        const STEP = 6, pos = [];
        for (let z = zLo; z < zMax; z += STEP) {
          const za = z, zb = Math.min(z + STEP, zMax);
          const ia = riverCx(band, za) + side * half, ib = riverCx(band, zb) + side * half;
          const oa = ia + side * 5, ob = ib + side * 5;
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

// Zones réservées au gameplay : on retire les bâtiments OSM qui les chevauchent
function reservedRects() {
  const rects = [
    { minX: BELLECOUR.minX - 2, maxX: BELLECOUR.maxX + 2, minZ: BELLECOUR.minZ - 2, maxZ: BELLECOUR.maxZ + 2 },
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

  for (let bi = 0; bi < data.buildings.length; bi++) {
    const b = data.buildings[bi];
    const h = Math.max(3, b.h);
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

    // Sens horaire (vu de dessus) pour des normales de murs vers l'extérieur
    let area = 0;
    for (let i = 0; i < pts.length; i++) {
      const [x1, z1] = pts[i];
      const [x2, z2] = pts[(i + 1) % pts.length];
      area += x1 * z2 - x2 * z1;
    }
    if (area > 0) pts.reverse();

    const tile = tileOf(cx, cz);
    wallColor.set(WALL_TINTS[hash2(bi) % WALL_TINTS.length])
      .offsetHSL(0, 0, (rand() - 0.5) * 0.06);
    roofColor.set(ROOF_TINTS[hash2(bi * 7 + 3) % ROOF_TINTS.length])
      .offsetHSL(0, 0, (rand() - 0.5) * 0.05);

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

  console.log(`Lyon OSM : ${kept} bâtiments dans ${tiles.size} tuiles.`);
}

function buildOsmRoads(ctx, data, full = false) {
  const pos = [];        // chaussée
  const walk = [];       // trottoirs (rubans élargis clairs, sous la chaussée)
  const zebra = [];      // passages piétons (quads rayés)
  // Sur la ville complète, les rubans de route épousent le terrain
  const yAt = full
    ? (x, z) => Math.max(0, ctx.terrainHeight?.(x, z) ?? 0) + 0.06
    : () => 0.045;
  const ribbon = (arr, x1, z1, x2, z2, half, dy) => {
    const dx = x2 - x1, dz = z2 - z1;
    const len = Math.hypot(dx, dz);
    if (len < 0.1) return len;
    const px = (-dz / len) * half, pz = (dx / len) * half;
    const ya = yAt(x1, z1) + dy, yb = yAt(x2, z2) + dy;
    arr.push(
      x1 - px, ya, z1 - pz, x2 - px, yb, z2 - pz, x2 + px, yb, z2 + pz,
      x1 - px, ya, z1 - pz, x2 + px, yb, z2 + pz, x1 + px, ya, z1 + pz
    );
    return len;
  };
  for (const road of data.roads) {
    const half = road.w / 2;
    let acc = 0;
    for (let i = 0; i + 3 < road.p.length; i += 2) {
      const x1 = road.p[i], z1 = road.p[i + 1];
      const x2 = road.p[i + 2], z2 = road.p[i + 3];
      // Trottoir un peu plus large et 2 cm plus bas, chaussée par-dessus
      ribbon(walk, x1, z1, x2, z2, half + 1.6, -0.02);
      const len = ribbon(pos, x1, z1, x2, z2, half, 0);
      // Passage piéton tous les ~35 m sur les grands axes
      acc += len;
      if (road.w >= 6 && acc > 35) {
        acc = 0;
        const mx = (x1 + x2) / 2, mz = (z1 + z2) / 2;
        ribbon(zebra, mx, mz, mx + (x2 - x1) / (len || 1) * 2.6, mz + (z2 - z1) / (len || 1) * 2.6, half, 0.02);
      }
    }
  }
  if (pos.length === 0) return;
  const addMesh = (arr, mat) => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3));
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, mat);
    mesh.userData.noShadow = true;
    ctx.scene.add(mesh);
  };
  addMesh(walk, new THREE.MeshLambertMaterial({ color: 0x7e828b })); // trottoirs
  addMesh(pos, new THREE.MeshLambertMaterial({
    color: 0x343943, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
  }));
  if (zebra.length) {
    addMesh(zebra, new THREE.MeshLambertMaterial({
      color: 0xd7dccb, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    }));
  }
}

function buildFarLandmarks(ctx, bound) {
  // Fourvière est désormais une vraie colline jouable (buildFourviere) :
  // il ne reste ici que le décor lointain de l'est.

  // Le Crayon (tour Part-Dieu), à l'est : fenêtres + couronne + pointe
  const EX = bound + 70;
  const towerTex = makeSkylineTexture();
  towerTex.wrapS = towerTex.wrapT = THREE.RepeatWrapping;
  towerTex.repeat.set(12, 10);
  const crayon = new THREE.Mesh(
    new THREE.CylinderGeometry(15, 15, 100, 20),
    new THREE.MeshLambertMaterial({ map: towerTex, color: 0xa9594a, fog: false })
  );
  crayon.position.set(EX, 50, -70);
  ctx.scene.add(crayon);
  const crown = new THREE.Mesh(
    new THREE.CylinderGeometry(15.6, 15.6, 3.6, 20),
    new THREE.MeshLambertMaterial({ color: 0xd8cfc2, fog: false })
  );
  crown.position.set(EX, 100, -70);
  ctx.scene.add(crown);
  const tip = new THREE.Mesh(
    new THREE.ConeGeometry(15, 24, 20),
    new THREE.MeshLambertMaterial({ color: 0x8d4538, fog: false })
  );
  tip.position.set(EX, 114, -70);
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
  const inWater = (x, z) => nearRiver(data.water, x, z, 4);

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
  // Pourtour de Bellecour
  for (let i = 0; i < 26; i++) {
    const t = i / 26;
    spots.push([BELLECOUR.minX + t * (BELLECOUR.maxX - BELLECOUR.minX), BELLECOUR.minZ - 2]);
    spots.push([BELLECOUR.minX + t * (BELLECOUR.maxX - BELLECOUR.minX), BELLECOUR.maxZ + 2]);
  }
  // Arbres épars dans les rues (et sur les collines en ville complète)
  const scatter = full ? 420 : 140;
  for (let i = 0; i < scatter; i++) {
    spots.push([(rand() - 0.5) * ctx.worldBound * 1.9, (rand() - 0.5) * ctx.worldBound * 1.9]);
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
