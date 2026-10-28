import { buildStoneBridge } from './bridge.js';
import { WATER_Y, BED_Y } from './city.js';
import { edgeDist, insidePoly } from './passerelles.js';

// LES VRAIS PONTS (ville OSM). Les rues OSM qui franchissent la Saône et le
// Rhône n'étaient que des rubans d'asphalte posés sur l'eau (on passait au
// travers), et des ponts de pierre génériques étaient semés à intervalles
// fixes, sans rapport avec les vrais. Ici chaque franchissement réel devient
// un pont de pierre à SA place, dans SON axe, de la largeur de sa chaussée,
// en dos d'âne :
//   - source : data.bridges (tools/fetch-osm.mjs : ways taguées bridge=*,
//     avec nom, structure, pont routier ou passerelle) ; à défaut (ancien
//     JSON), les tronçons de rue dont le milieu tombe dans l'eau ;
//   - le tablier est praticable : ctx.terrainHeight y renvoie la chaussée
//     cintrée (comme les gradins du théâtre), garde-corps en colliders ;
//   - le ruban de rue OSM n'est plus dessiné sur l'eau (ctx.onBridge), le
//     pont a sa propre chaussée ;
//   - les passerelles piétonnes partent vers world/passerelles.js.

const OVER = 6;          // le pont mord sur chaque quai
const MIN_WATER = 10;    // franchissement minimal (m jeu)

function key(n) {
  return String(n ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

// Tronçons d'une polyligne au-dessus de l'eau → franchissements candidats
function spansOf(p, w, meta, mask, polys) {
  const out = [];
  let i0 = -1;
  const n = p.length / 2;
  const flush = (i1) => {
    if (i0 < 0) return;
    const ax0 = p[i0 * 2], az0 = p[i0 * 2 + 1], bx = p[i1 * 2], bz = p[i1 * 2 + 1];
    i0 = -1;
    const len = Math.hypot(bx - ax0, bz - az0);
    if (len < MIN_WATER || len > 320) return;
    const ax = (bx - ax0) / len, az = (bz - az0) / len;
    // milieu de l'eau le long de l'axe : bords exacts sur les polygones
    const mx = (ax0 + bx) / 2, mz = (az0 + bz) / 2;
    if (!polys.some((r) => insidePoly(r, mx, mz))) return;
    const e1 = edgeDist(polys, mx, mz, ax, az), e2 = edgeDist(polys, mx, mz, -ax, -az);
    if (!Number.isFinite(e1) || !Number.isFinite(e2)) return;
    const water = e1 + e2;
    // une rue de quai qui longe le fleuve n'est pas un pont : le
    // franchissement doit tenir dans le tronçon
    if (water < MIN_WATER || water > len + 12) return;
    out.push({
      cx: mx + (ax * (e1 - e2)) / 2, cz: mz + (az * (e1 - e2)) / 2,
      ax, az, half: water / 2, w, ...meta,
    });
  };
  for (let i = 0; i + 1 < n; i++) {
    const x = (p[i * 2] + p[i * 2 + 2]) / 2, z = (p[i * 2 + 1] + p[i * 2 + 3]) / 2;
    if (mask.isWater(x, z)) { if (i0 < 0) i0 = i; }
    else flush(i);
  }
  flush(n - 1);
  return out;
}

// Chaussées doubles (deux ways à sens unique sur un même pont) : on fusionne
// les franchissements parallèles et voisins en un seul pont plus large
function merge(spans) {
  const out = [];
  for (const s of spans) {
    // une voie piétonne marquée pont ET franchie par une passerelle : la
    // passerelle l'emporte (même endroit, même axe)
    const foot = out.find((t) => t.kind === 'foot' && s.kind === 'road' && s.w <= 4.5 &&
      Math.abs(t.ax * s.ax + t.az * s.az) > 0.94 && Math.hypot(t.cx - s.cx, t.cz - s.cz) < 12);
    if (foot) continue;
    const o = out.find((t) => t.kind === s.kind &&
      Math.abs(t.ax * s.ax + t.az * s.az) > 0.94 &&
      Math.hypot(t.cx - s.cx, t.cz - s.cz) < 18);
    if (!o) { out.push({ ...s, wide: s.w / 2 }); continue; }
    const d = Math.abs(-(s.cx - o.cx) * o.az + (s.cz - o.cz) * o.ax); // écart en travers
    o.wide = Math.max(o.wide, d / 2 + Math.max(o.w, s.w) / 2);
    o.cx = (o.cx + s.cx) / 2; o.cz = (o.cz + s.cz) / 2;
    o.half = Math.max(o.half, s.half);
    o.n = o.n ?? s.n; o.s = o.s ?? s.s;
  }
  return out;
}

export function collectBridgeSpans(ctx, data) {
  const mask = ctx.waterMask, polys = data.waterPolys;
  if (!mask || !polys?.length) return [];
  const spans = [];
  // Ways taguées bridge d'abord (noms, structure, passerelles), puis les
  // rues qui franchissent l'eau : rattrape un pont mal tagué, et c'est la
  // seule source des anciens JSON. merge() dédoublonne (le premier garde
  // son nom).
  for (const b of data.bridges ?? []) spans.push(...spansOf(b.p, b.w, { kind: b.kind, n: b.n, s: b.s }, mask, polys));
  for (const r of data.roads) spans.push(...spansOf(r.p, r.w, { kind: 'road' }, mask, polys));
  return merge(spans);
}

// Ponts routiers : pierre en dos d'âne + chaussée praticable
export function buildRealBridges(ctx, spans) {
  const roads = spans.filter((s) => s.kind === 'road');
  const local = (d, x, z) => {
    const dx = x - d.cx, dz = z - d.cz;
    return [dx * d.ax + dz * d.az, -dx * d.az + dz * d.ax];
  };
  // emprises des passerelles (bâties par world/passerelles.js)
  const feet = spans.filter((s) => s.kind === 'foot').map((s) => ({ ...s, L2: s.half + 3, halfW: 2 }));
  if (!roads.length) {
    if (feet.length) ctx.onBridge = (x, z) => ctx.waterMask.isWater(x, z) && feet.some((d) => {
      const [u, v] = local(d, x, z);
      return Math.abs(u) <= d.L2 && Math.abs(v) <= d.halfW + 2;
    });
    return;
  }
  const natural = ctx.terrainHeight;
  const ground = (x, z) => Math.max(0, natural(x, z));
  const decks = [];
  ctx.bridgeLamps = ctx.bridgeLamps ?? [];
  const seen = new Set();
  for (const s of roads) {
    const L2 = s.half + OVER;
    const halfW = Math.max(4.75, s.wide + 1.6);
    const hump = Math.min(1.6, Math.max(0.6, 0.4 + s.half * 0.024));
    const base = Math.max(ground(s.cx - s.ax * L2, s.cz - s.az * L2), ground(s.cx + s.ax * L2, s.cz + s.az * L2)) + 0.04;
    const top = base;
    ctx.bridgeLamps.push(...buildStoneBridge(ctx, {
      cx0: s.cx, cz0: s.cz, yaw: Math.atan2(-s.az, s.ax), len: L2 * 2, over: OVER,
      deckY: top - 0.2, bedY: BED_Y, waterY: WATER_Y, halfW, hump,
    }));
    const deck = { ...s, L2, halfW, hump, top };
    decks.push(deck);
    // garde-corps (1,1 m) en tronçons de 4 m de part et d'autre
    for (let u = -L2; u < L2; u += 4) {
      const u1 = Math.min(L2, u + 4);
      const y = top + Math.max(deckHump(deck, u), deckHump(deck, u1));
      for (const sv of [-1, 1]) {
        let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
        for (const [uu, vv] of [[u, sv * (halfW - 0.3)], [u1, sv * (halfW - 0.3)], [u, sv * halfW], [u1, sv * halfW]]) {
          const x = s.cx + s.ax * uu - s.az * vv, z = s.cz + s.az * uu + s.ax * vv;
          minX = Math.min(minX, x); maxX = Math.max(maxX, x); minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
        }
        ctx.colliders.push({ minX, maxX, minZ, maxZ, minY: y - 0.5, maxY: y + 1.1 });
      }
    }
    const k = key(s.n);
    if (s.n && !seen.has(k)) {
      seen.add(k);
      ctx.pois?.push({ id: 'pont-' + k.replace(/\W+/g, '-'), nom: s.n, emoji: '🌉', x: s.cx, z: s.cz });
    }
  }
  // Le tablier est le sol : on marche (et roule) sur la chaussée cintrée
  ctx.terrainHeight = (x, z) => {
    for (const d of decks) {
      const [u, v] = local(d, x, z);
      if (Math.abs(u) <= d.L2 && Math.abs(v) <= d.halfW) return d.top + deckHump(d, u);
    }
    return natural(x, z);
  };
  // Les rubans de rue OSM ne sont plus tracés sur l'eau d'un pont
  ctx.onBridge = (x, z) => ctx.waterMask.isWater(x, z) && [...decks, ...feet].some((d) => {
    const [u, v] = local(d, x, z);
    return Math.abs(u) <= d.L2 + 1 && Math.abs(v) <= d.halfW + 2;
  });
  ctx.realBridges = decks;
}

function deckHump(d, u) {
  return d.hump * Math.max(0, 1 - (u / d.L2) ** 2);
}
