import * as THREE from 'three';
import { Kit } from './monuments.js';
import { lyonXZ } from './squares.js';

// PASSERELLES PIÉTONNES DE LA SAÔNE (ville OSM) — les données OSM du jeu
// n'ont que les rues carrossables : les passerelles manquaient. Chacune est
// posée au plus court d'une rive à l'autre (masque d'eau OSM), à sa vraie
// position GPS, tablier légèrement bombé, escaliers sur les quais :
//   - passerelle du Palais de Justice : haubanée, blanche, dans l'axe des
//     24 colonnes — un mât incliné côté Presqu'île et ses haubans en éventail ;
//   - passerelle Saint-Georges : suspendue, vert sombre, portiques d'acier ;
//   - passerelle Saint-Vincent (1832, la doyenne) : suspendue, portiques de
//     pierre en arc, câbles gris-bleu, au droit du bras est-ouest.
// Praticables (tablier + garde-corps en colliders), lanternes la nuit.
// Une poignée de draw calls par passerelle (géométrie fusionnée du Kit).

const DW = 1.7;     // demi-largeur du tablier
const DECK = 2.6;   // hauteur du tablier au-dessus du quai
const CAMBER = 0.7; // bombement au milieu
const OVER = 4;     // le tablier mord sur chaque quai

// Traversée la plus courte autour d'un point (sur l'eau ou tout près)
function crossing(mask, x0, z0) {
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
    for (const s of [-1, 1]) {
      // poutre de rive + main courante + barreaudage
      k.add('steel', new THREE.BoxGeometry(len, 0.45, 0.16), { u: um, y: ym - 0.25, v: s * (DW + 0.05), rz: tilt, color: steel });
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
  // escaliers aux deux bouts, dans l'axe, jusqu'au quai
  for (const [ue, dir, y] of [[u0, -1, yA], [u1, 1, yB]]) {
    const g = y - DECK; // niveau du quai
    const steps = Math.ceil(DECK / 0.29);
    for (let i = 0; i < steps; i++) {
      const top = y - i * (DECK / steps);
      const ua = ue + dir * i * 0.45, ub = ue + dir * (i + 1) * 0.45;
      k.box('stone', Math.min(ua, ub), Math.max(ua, ub), g - 0.4, top, -DW, DW, 0xb9b0a0, { collide: true });
    }
  }
  return yOf;
}

// Passerelle suspendue : portiques sur chaque quai, deux câbles porteurs
// en chaînette, suspentes verticales, câbles de retenue ancrés au sol
function suspension(k, c, yA, yB, opts) {
  const ends = [-c.half - OVER, c.half + OVER];
  const yOf = deck(k, ends, yA, yB, opts);
  const uP = c.half + 1.5;  // portiques au bord des quais
  const H = 8.5;            // hauteur des portiques au-dessus du tablier
  const vc = DW + 0.45;     // plan des câbles
  const tops = [];
  for (const [s, yq] of [[-1, yA], [1, yB]]) {
    const u = s * uP, base = yq - DECK - 0.4, top = yOf(u) + H;
    tops.push([u, top]);
    if (opts.stonePortal) {
      // portique de pierre à arc (Saint-Vincent)
      for (const sv of [-1, 1]) k.box('stone', u - 0.8, u + 0.8, base, top - 1.6, sv * vc - 0.8, sv * vc + 0.8, 0xd8cdb6, { collide: true });
      k.box('stone', u - 0.85, u + 0.85, top - 1.6, top + 0.3, -vc - 0.85, vc + 0.85, 0xd8cdb6);
      k.add('stone', new THREE.BoxGeometry(1.8, 0.35, vc * 2 + 2.2), { u, y: top + 0.48, color: 0xe4dac4 });
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
      k.box('stone', u - 1.1, u + 1.1, base - 0.2, yq - DECK + 0.6, -vc - 1, vc + 1, 0xbcb3a3);
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
    // câbles de retenue jusqu'aux massifs d'ancrage derrière les quais
    for (const [u, top, s, yq] of [[uA, tA, -1, yA], [uB, tB, 1, yB]]) {
      const ua = u + s * 9, ya = yq - DECK;
      rod(k, 'steel', [u, top, v], [ua, ya + 0.6, v], 0.09, opts.cable);
      k.box('stone', ua - 0.9, ua + 0.9, ya - 0.3, ya + 0.8, v - 0.9, v + 0.9, 0xa9a090, { collide: true });
    }
  }
}

// Passerelle haubanée (Palais de Justice) : un mât incliné côté est, une
// nappe de haubans en éventail vers le tablier, retenue arrière au sol
function cableStayed(k, c, yA, yB, opts) {
  const ends = [-c.half - OVER, c.half + OVER];
  const yOf = deck(k, ends, yA, yB, opts);
  const uM = c.half + 2.2;
  const base = yB - DECK;
  const top = [uM + 3.2, yOf(uM) + 21, 0];
  // mât en caisson qui s'affine, incliné vers l'arrière
  rod(k, 'steel', [uM, base, 0], top, 0.55, opts.steel);
  k.box('stone', uM - 1.3, uM + 1.3, base - 0.3, base + 0.5, -1.3, 1.3, 0xc9c2b4, { collide: true });
  k.solid(uM - 0.6, uM + 0.6, base, base + 6, -0.6, 0.6);
  k.add('lamp', new THREE.SphereGeometry(0.3, 8, 6), { u: top[0], y: top[1] + 0.3 });
  // haubans vers les deux rives du tablier
  const n = 9;
  for (let i = 1; i <= n; i++) {
    const u = uM - 1 - (i / n) * (c.half * 2 + 1.5);
    const tt = [top[0] - 0.12 * i, top[1] - 0.5 * i, 0];
    for (const sv of [-1, 1]) rod(k, 'steel', tt, [u, yOf(u) - 0.1, sv * (DW + 0.05)], 0.04, opts.cable);
  }
  // retenues arrière
  for (const sv of [-1, 1]) {
    const ua = uM + 12;
    rod(k, 'steel', [top[0], top[1] - 0.4, 0], [ua, base + 0.5, sv * 2.2], 0.07, opts.cable);
    k.box('stone', ua - 0.8, ua + 0.8, base - 0.3, base + 0.6, sv * 2.2 - 0.8, sv * 2.2 + 0.8, 0xa9a090, { collide: true });
  }
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

export function buildPasserelles(ctx, scale = 0.5) {
  const mask = ctx.waterMask;
  if (!mask) return;
  const mats = {
    plain: new THREE.MeshLambertMaterial({ vertexColors: true }),
    stone: new THREE.MeshLambertMaterial({ vertexColors: true }),
    steel: new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.55, roughness: 0.45 }),
    lamp: new THREE.MeshLambertMaterial({ color: 0x3a3428, emissive: 0xffd28a, emissiveIntensity: 0 }),
  };
  ctx.updatables.push(() => { mats.lamp.emissiveIntensity = 0.15 + (ctx.env?.night ?? 0) * 1.4; });
  const ground = (x, z) => Math.max(0, ctx.terrainHeight?.(x, z) ?? 0);

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
    const c = crossing(mask, x, z);
    if (!c) continue;
    const k = new Kit(ctx, c.cx, c.cz, 0, c.ax, c.az);
    const [ax0, az0] = k.world(-c.half - OVER, 0);
    const [ax1, az1] = k.world(c.half + OVER, 0);
    const yA = ground(ax0, az0) + DECK, yB = ground(ax1, az1) + DECK;
    if (type === 'haubans') cableStayed(k, c, yA, yB, { ...opts, lanterns: true });
    else suspension(k, c, yA, yB, { ...opts, lanterns: true });
    k.build(mats, nom);
    ctx.pois?.push({ id, nom, emoji: '🌉', x: c.cx, z: c.cz });
  }
}
