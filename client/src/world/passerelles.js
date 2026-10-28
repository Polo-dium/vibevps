import * as THREE from 'three';
import { Kit } from './monuments.js';
import { lyonXZ } from './squares.js';

// PASSERELLES PIÉTONNES DE LA SAÔNE (ville OSM) — les données OSM du jeu
// n'ont que les rues carrossables : les passerelles manquaient. Chacune est
// posée au plus court d'une rive à l'autre (masque d'eau OSM), à sa vraie
// position GPS, tablier légèrement bombé. Les quais lyonnais n'ont qu'un
// trottoir entre l'eau et la chaussée : tablier, escaliers (parallèles au
// fleuve), mâts et ancrages tiennent dans les ~3 m au ras de l'eau.
//   - passerelle du Palais de Justice : haubanée, blanche, dans l'axe des
//     24 colonnes — un mât incliné côté Presqu'île et ses haubans en éventail ;
//   - passerelle Saint-Georges : suspendue, vert sombre, portiques d'acier ;
//   - passerelle Saint-Vincent (1832, la doyenne) : suspendue, portiques de
//     pierre en arc, câbles gris-bleu, au droit du bras est-ouest.
// Praticables (tablier + garde-corps en colliders), lanternes la nuit.
// Une poignée de draw calls par passerelle (géométrie fusionnée du Kit).

const DW = 1.7;     // demi-largeur du tablier
const DECK = 2.0;   // hauteur du tablier au-dessus du quai
const CAMBER = 0.7; // bombement au milieu
const OVER = 2.6;   // le tablier mord sur chaque quai (palier des escaliers)
const STEP = 0.45;  // giron des marches
const STAIR_U = [0.9, 2.6]; // bande du quai (depuis l'eau) occupée par les escaliers

export function insidePoly(r, x, z) {
  let c = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [xi, zi] = r[i], [xj, zj] = r[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
  }
  return c;
}

// Distance exacte jusqu'au bord de l'eau le long d'un rayon parti de l'eau
// (polygones OSM : le masque à 4 m peut se tromper d'une maille, et la
// chaussée du quai commence ~3 m plus loin)
export function edgeDist(polys, x, z, dx, dz) {
  let best = Infinity;
  for (const ring of polys) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [ax, az] = ring[j], [bx, bz] = ring[i];
      const ex = bx - ax, ez = bz - az;
      const den = dx * ez - dz * ex;
      if (Math.abs(den) < 1e-9) continue;
      const qx = ax - x, qz = az - z;
      const t = (qx * ez - qz * ex) / den, w = (qx * dz - qz * dx) / den;
      if (t > 0 && w >= 0 && w <= 1) best = Math.min(best, t);
    }
  }
  return best;
}

// Traversée la plus courte autour d'un point (sur l'eau ou tout près)
function crossing(mask, polys, x0, z0) {
  let sx = x0, sz = z0;
  if (!mask.isWater(sx, sz)) {
    let found = false;
    for (let r = 2; r <= 50 && !found; r += 2) {
      for (let k = 0; k < 24 && !found; k++) {
        const a = (k / 24) * Math.PI * 2;
        if (mask.isWater(x0 + Math.cos(a) * r, z0 + Math.sin(a) * r)) {
          sx = x0 + Math.cos(a) * r; sz = z0 + Math.sin(a) * r; found = true;
        }
      }
    }
    if (!found) return null;
  }
  const reach = (dx, dz) => {
    let s = 0;
    while (s < 220 && mask.isWater(sx + dx * s, sz + dz * s)) s += 1;
    return s;
  };
  let best = null;
  for (let deg = 0; deg < 180; deg += 3) {
    const a = (deg * Math.PI) / 180;
    const dx = Math.cos(a), dz = Math.sin(a);
    const r1 = reach(dx, dz), r2 = reach(-dx, -dz);
    if (!best || r1 + r2 < best.w) best = { w: r1 + r2, dx, dz, r1, r2 };
  }
  if (!best || best.w < 10 || best.w > 200) return null;
  let { dx, dz } = best;
  // Bords exacts sur les polygones : le masque ne donne que la direction
  // (il est consolidé le long du lit et déborde par endroits sous la
  // chaussée du quai — la passerelle finissait au milieu du carrefour)
  if (polys?.length && polys.some((r) => insidePoly(r, sx, sz))) {
    const e1 = edgeDist(polys, sx, sz, dx, dz), e2 = edgeDist(polys, sx, sz, -dx, -dz);
    if (Number.isFinite(e1) && Number.isFinite(e2) && e1 + e2 > 10) {
      best.r1 = e1; best.r2 = e2; best.w = e1 + e2;
    }
  }
  const mid = (best.r1 - best.r2) / 2;
  const cx = sx + dx * mid, cz = sz + dz * mid;
  // u vers l'est (ou le sud quand la passerelle traverse un bras est-ouest)
  if (dx < -0.2 || (Math.abs(dx) <= 0.2 && dz < 0)) { dx = -dx; dz = -dz; }
  return { cx, cz, ax: dx, az: dz, half: best.w / 2 };
}

// Tige (câble, hauban, tube) entre deux points du repère local
function rod(k, key, a, b, r, color) {
  const d = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  const len = d.length();
  if (len < 1e-3) return;
  const g = new THREE.CylinderGeometry(r, r, len, 5, 1, true);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize()));
  g.translate((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2);
  k.add(key, g, { color });
}

// Tablier bombé, poutres de rive, garde-corps, escaliers, colliders.
// Renvoie y(u), la hauteur du dessus du tablier.
function deck(k, ends, yA, yB, { plank, steel, lanterns }) {
  const u0 = ends[0], u1 = ends[1];
  const yOf = (u) => {
    const t = (u - u0) / (u1 - u0);
    return yA + (yB - yA) * t + CAMBER * (1 - (2 * t - 1) ** 2);
  };
  const SEG = 2;
  const n = Math.ceil((u1 - u0) / SEG);
  for (let i = 0; i < n; i++) {
    const a = u0 + ((u1 - u0) * i) / n, b = u0 + ((u1 - u0) * (i + 1)) / n;
    const ya = yOf(a), yb = yOf(b);
    const um = (a + b) / 2, ym = (ya + yb) / 2;
    const tilt = Math.atan2(yb - ya, b - a);
    const len = Math.hypot(b - a, yb - ya) + 0.04;
    k.add('plain', new THREE.BoxGeometry(len, 0.18, DW * 2), { u: um, y: ym - 0.09, rz: tilt, color: plank });
    // aux deux bouts, garde-corps ouvert là où partent les escaliers
    const band = STAIR_U[1] - STAIR_U[0];
    const open = a < u0 + band || b > u1 - band;
    for (const s of [-1, 1]) {
      // poutre de rive + main courante + barreaudage
      k.add('steel', new THREE.BoxGeometry(len, 0.45, 0.16), { u: um, y: ym - 0.25, v: s * (DW + 0.05), rz: tilt, color: steel });
      if (open) continue;
      k.add('steel', new THREE.BoxGeometry(len, 0.07, 0.09), { u: um, y: ym + 1.1, v: s * DW, rz: tilt, color: steel });
      k.add('steel', new THREE.BoxGeometry(len, 0.04, 0.04), { u: um, y: ym + 0.55, v: s * DW, rz: tilt, color: steel });
      k.add('steel', new THREE.BoxGeometry(0.07, 1.1, 0.07), { u: a, y: ya + 0.55, v: s * DW, color: steel });
      k.solid(a, b, Math.min(ya, yb), Math.max(ya, yb) + 1.1, s * DW - 0.06, s * DW + 0.06);
    }
    k.solid(a, b, Math.min(ya, yb) - 0.6, Math.max(ya, yb), -DW, DW);
    if (lanterns && i % 5 === 2) {
      for (const s of [-1, 1]) {
        k.add('steel', new THREE.BoxGeometry(0.08, 1.6, 0.08), { u: um, y: ym + 0.8, v: s * (DW + 0.12), color: steel });
        k.add('lamp', new THREE.BoxGeometry(0.28, 0.4, 0.28), { u: um, y: ym + 1.8, v: s * (DW + 0.12) });
      }
    }
  }
  // bouts du tablier : garde-corps en travers, escaliers de part et
  // d'autre qui descendent LE LONG du quai (sur le trottoir, jamais vers
  // la chaussée), dans la bande STAIR_U depuis le bord de l'eau
  for (const [ue, dir, y] of [[u0, -1, yA], [u1, 1, yB]]) {
    const g = y - DECK; // niveau du quai
    k.add('steel', new THREE.BoxGeometry(0.09, 0.07, DW * 2), { u: ue, y: y + 1.1, color: steel });
    k.add('steel', new THREE.BoxGeometry(0.04, 0.04, DW * 2), { u: ue, y: y + 0.55, color: steel });
    k.solid(Math.min(ue, ue - dir * 0.12), Math.max(ue, ue - dir * 0.12), y, y + 1.1, -DW, DW);
    const ua = ue - dir * (OVER - STAIR_U[0]), ub = ue;
    const steps = Math.ceil(DECK / 0.29);
    for (const sv of [-1, 1]) {
      for (let i = 0; i < steps; i++) {
        const top = y - (i + 1) * (DECK / steps);
        const va = sv * (DW + i * STEP), vb = sv * (DW + (i + 1) * STEP);
        k.box('stone', Math.min(ua, ub), Math.max(ua, ub), g - 0.4, Math.max(g + 0.02, top + DECK / steps * 0.5),
          Math.min(va, vb), Math.max(va, vb), 0xb9b0a0, { collide: true });
      }
      // limon côté eau (on ne tombe pas dans la Saône en descendant)
      const vEnd = sv * (DW + steps * STEP);
      k.box('stone', Math.min(ua, ua - dir * 0.2), Math.max(ua, ua - dir * 0.2), g, y + 0.9,
        Math.min(sv * DW, vEnd), Math.max(sv * DW, vEnd), 0xa59c8c, { collide: true });
    }
  }
  return yOf;
}

// Passerelle suspendue : portiques sur chaque quai, deux câbles porteurs
// en chaînette, suspentes verticales, câbles de retenue ancrés au sol
function suspension(k, c, yA, yB, opts) {
  const ends = [-c.half - OVER, c.half + OVER];
  const yOf = deck(k, ends, yA, yB, opts);
  const uP = c.half + 0.35; // portiques sur le mur de quai, au ras de l'eau
  const H = 8.5;            // hauteur des portiques au-dessus du tablier
  const vc = DW + 0.45;     // plan des câbles
  const tops = [];
  for (const [s, yq] of [[-1, yA], [1, yB]]) {
    const u = s * uP, base = yq - DECK - 0.4, top = yOf(u) + H;
    tops.push([u, top]);
    if (opts.stonePortal) {
      // portique de pierre à arc (Saint-Vincent)
      for (const sv of [-1, 1]) k.box('stone', u - 0.35, u + 0.35, base, top - 1.6, sv * vc - 0.6, sv * vc + 0.6, 0xd8cdb6, { collide: true });
      k.box('stone', u - 0.4, u + 0.4, top - 1.6, top + 0.3, -vc - 0.6, vc + 0.6, 0xd8cdb6);
      k.add('stone', new THREE.BoxGeometry(0.95, 0.35, vc * 2 + 1.6), { u, y: top + 0.48, color: 0xe4dac4 });
      const arch = new THREE.TorusGeometry(vc - 0.75, 0.42, 6, 12, Math.PI);
      k.add('stone', arch, { u, y: top - 1.6, ry: Math.PI / 2, color: 0xd8cdb6 });
    } else {
      // portique d'acier : deux mâts, entretoises, chapeau
      for (const sv of [-1, 1]) {
        k.box('steel', u - 0.3, u + 0.3, base, top, sv * vc - 0.3, sv * vc + 0.3, opts.steel, { collide: true });
        k.add('steel', new THREE.SphereGeometry(0.42, 8, 6), { u, y: top + 0.3, v: sv * vc, color: opts.steel });
      }
      for (const y of [yOf(u) + 3.2, top - 0.6]) {
        k.box('steel', u - 0.2, u + 0.2, y - 0.2, y + 0.2, -vc, vc, opts.steel);
      }
      k.box('stone', u - 0.45, u + 0.45, base - 0.2, yq - DECK + 0.6, -vc - 0.45, vc + 0.45, 0xbcb3a3);
    }
  }
  const [[uA, tA], [uB, tB]] = tops;
  const sagY = yOf(0) + 1.2;
  const cableY = (u) => {
    const t = (u - uA) / (uB - uA);
    const lin = tA + (tB - tA) * t;
    return lin - (lin - sagY) * (1 - (2 * t - 1) ** 2) * 1;
  };
  for (const sv of [-1, 1]) {
    const v = sv * vc;
    const N = 24;
    for (let i = 0; i < N; i++) {
      const a = uA + ((uB - uA) * i) / N, b = uA + ((uB - uA) * (i + 1)) / N;
      rod(k, 'steel', [a, cableY(a), v], [b, cableY(b), v], 0.09, opts.cable);
    }
    // suspentes
    for (let u = uA + 2; u < uB - 1; u += 2) {
      rod(k, 'steel', [u, cableY(u), v], [u, yOf(u) + 0.05, sv * DW], 0.025, opts.cable);
    }
    // câbles de retenue jusqu'aux massifs d'ancrage, au bout du palier
    // (au ras du mur de quai : rien ne déborde sur la chaussée)
    for (const [u, top, s, yq] of [[uA, tA, -1, yA], [uB, tB, 1, yB]]) {
      const ua = s * (c.half + OVER + 0.5), ya = yq - DECK;
      rod(k, 'steel', [u, top, v], [ua, ya + 0.6, v], 0.09, opts.cable);
      k.box('stone', ua - 0.45, ua + 0.45, ya - 0.3, ya + 0.8, v - 0.45, v + 0.45, 0xa9a090, { collide: true });
    }
  }
}

// Passerelle haubanée (Palais de Justice) : un mât incliné côté est, une
// nappe de haubans en éventail vers le tablier, retenue arrière au sol
function cableStayed(k, c, yA, yB, opts) {
  const ends = [-c.half - OVER, c.half + OVER];
  const yOf = deck(k, ends, yA, yB, opts);
  // deux mâts jumeaux de part et d'autre du tablier, sur le mur de quai
  // côté est, légèrement inclinés vers l'arrière
  const uM = c.half + 0.35;
  const base = yB - DECK;
  const vm = DW + 0.45;
  const n = 9;
  for (const sv of [-1, 1]) {
    const top = [uM + 1.4, yOf(uM) + 19, sv * vm];
    rod(k, 'steel', [uM, base, sv * vm], top, 0.32, opts.steel);
    k.box('stone', uM - 0.45, uM + 0.45, base - 0.3, base + 0.5, sv * vm - 0.45, sv * vm + 0.45, 0xc9c2b4, { collide: true });
    k.solid(uM - 0.3, uM + 0.3, base, base + 6, sv * vm - 0.3, sv * vm + 0.3);
    k.add('lamp', new THREE.SphereGeometry(0.25, 8, 6), { u: top[0], y: top[1] + 0.25, v: top[2] });
    // haubans en éventail vers la rive du tablier
    for (let i = 1; i <= n; i++) {
      const u = uM - 1 - (i / n) * (c.half * 2 + 0.5);
      const tt = [top[0] - 0.07 * i, top[1] - 0.45 * i, sv * vm];
      rod(k, 'steel', tt, [u, yOf(u) - 0.1, sv * (DW + 0.05)], 0.04, opts.cable);
    }
    // retenue arrière : ancrée au bout du palier, pas sur la chaussée
    const ua = c.half + OVER + 0.5;
    rod(k, 'steel', [top[0], top[1] - 0.4, sv * vm], [ua, base + 0.5, sv * vm], 0.07, opts.cable);
    k.box('stone', ua - 0.45, ua + 0.45, base - 0.3, base + 0.6, sv * vm - 0.45, sv * vm + 0.45, 0xa9a090, { collide: true });
  }
  // traverse de tête entre les deux mâts
  rod(k, 'steel', [uM + 1.33, yOf(uM) + 18.4, -vm], [uM + 1.33, yOf(uM) + 18.4, vm], 0.18, opts.steel);
}

// [id, nom, lat, lon, type, couleurs]
const DEFS = [
  ['passerelle-palais', 'Passerelle du Palais de Justice', null, null, 'haubans',
    { steel: 0xeef0ee, cable: 0xdfe3e6, plank: 0x8d7a64 }],
  // points pris au milieu de l'eau des données OSM (entre les ponts
  // Bonaparte et Kitchener ; en amont de la Feuillée, au pied de Saint-Paul)
  ['passerelle-saint-georges', 'Passerelle Saint-Georges', 45.75609, 4.82551, 'suspendue',
    { steel: 0x3d5a48, cable: 0x2f4538, plank: 0x7d6a55 }],
  ['passerelle-saint-vincent', 'Passerelle Saint-Vincent', 45.76766, 4.82608, 'suspendue',
    { steel: 0x5d6d7e, cable: 0x4b5a69, plank: 0x7d6a55, stonePortal: true }],
];

// Passerelle « à poutre » (Paul-Couturier, Masaryk…) : tablier sur de
// fines piles dans le fleuve, tous les ~28 m
function girder(k, c, yA, yB, opts) {
  const ends = [-c.half - OVER, c.half + OVER];
  const yOf = deck(k, ends, yA, yB, opts);
  const n = Math.max(1, Math.round((c.half * 2) / 28));
  for (let i = 1; i < n; i++) {
    const u = -c.half + (i * c.half * 2) / n;
    for (const sv of [-1, 1]) {
      const h = yOf(u) - 0.4 + 2.6;
      k.add('stone', new THREE.CylinderGeometry(0.45, 0.55, h, 10), { u, y: yOf(u) - 0.4 - h / 2, v: sv * (DW - 0.4), color: 0xb8b0a2 });
    }
    k.box('steel', u - 0.3, u + 0.3, yOf(u) - 0.75, yOf(u) - 0.35, -DW, DW, opts.steel);
  }
}

// Style d'une passerelle d'après son nom OSM (les lyonnaises connues) ou
// sa structure (bridge:structure)
function styleOf(name, structure) {
  const n = String(name ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ');
  for (const d of DEFS) {
    const tag = d[0].replace('passerelle-', '').replace(/-/g, ' ');
    if (n.includes(tag) || (tag === 'palais' && n.includes('palais de justice'))) return { type: d[4], opts: d[5] };
  }
  if (structure === 'cable-stayed') return { type: 'haubans', opts: { steel: 0xe6e8e8, cable: 0xd5d9dc, plank: 0x8d7a64 } };
  if (structure === 'suspension') return { type: 'suspendue', opts: { steel: 0x5d6d7e, cable: 0x4b5a69, plank: 0x7d6a55 } };
  return { type: 'poutre', opts: { steel: 0x6f7a84, cable: 0x6f7a84, plank: 0x8d7a64 } };
}

function buildOne(ctx, mats, c, type, opts, nom, id) {
  const ground = (x, z) => Math.max(0, ctx.terrainHeight?.(x, z) ?? 0);
  // u vers l'est (ou le sud quand la passerelle traverse un bras est-ouest)
  if (c.ax < -0.2 || (Math.abs(c.ax) <= 0.2 && c.az < 0)) c = { ...c, ax: -c.ax, az: -c.az };
  const k = new Kit(ctx, c.cx, c.cz, 0, c.ax, c.az);
  const [ax0, az0] = k.world(-c.half - OVER, 0);
  const [ax1, az1] = k.world(c.half + OVER, 0);
  const yA = ground(ax0, az0) + DECK, yB = ground(ax1, az1) + DECK;
  const o = { ...opts, lanterns: true };
  if (type === 'haubans') cableStayed(k, c, yA, yB, o);
  else if (type === 'poutre') girder(k, c, yA, yB, o);
  else suspension(k, c, yA, yB, o);
  k.build(mats, nom);
  ctx.pois?.push({ id, nom, emoji: '🌉', x: c.cx, z: c.cz });
}

export function buildPasserelles(ctx, data) {
  const scale = data.scale ?? 0.5;
  const mask = ctx.waterMask;
  if (!mask) return;
  const mats = {
    plain: new THREE.MeshLambertMaterial({ vertexColors: true }),
    stone: new THREE.MeshLambertMaterial({ vertexColors: true }),
    steel: new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.55, roughness: 0.45 }),
    lamp: new THREE.MeshLambertMaterial({ color: 0x3a3428, emissive: 0xffd28a, emissiveIntensity: 0 }),
  };
  ctx.updatables.push(() => { mats.lamp.emissiveIntensity = 0.15 + (ctx.env?.night ?? 0) * 1.4; });

  // Vraies passerelles OSM (data.bridges, world/realBridges.js) : à leur
  // place exacte, style d'après leur nom ou leur structure
  const foot = (ctx.bridgeSpans ?? []).filter((sp) => sp.kind === 'foot');
  if (foot.length) {
    foot.forEach((sp, i) => {
      const { type, opts } = styleOf(sp.n, sp.s);
      const nom = sp.n ?? 'Passerelle';
      buildOne(ctx, mats, { cx: sp.cx, cz: sp.cz, ax: sp.ax, az: sp.az, half: sp.half }, type, opts, nom,
        'passerelle-' + (sp.n ? nom.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\W+/g, '-') : i));
    });
    return;
  }

  // Ancien JSON (sans data.bridges) : positions repérées à la main
  for (const [id, nom, lat, lon, type, opts] of DEFS) {
    let x, z;
    if (lat == null) {
      // dans l'axe du Palais de Justice : on file vers l'est jusqu'à l'eau
      const pj = ctx.pois?.find((p) => p.id === 'palais-justice');
      [x, z] = pj ? [pj.x, pj.z] : lyonXZ(45.76172, 4.82814, scale);
      for (let s = 0; s < 120 && !mask.isWater(x, z); s += 2) x += 2;
      x += 10;
    } else {
      [x, z] = lyonXZ(lat, lon, scale);
    }
    const c = crossing(mask, data.waterPolys, x, z);
    if (c) buildOne(ctx, mats, c, type, opts, nom, id);
  }
}
