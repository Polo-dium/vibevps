// Constantes de placement du monde (mètres). Tout le monde est généré de
// façon déterministe pour que chaque client voie exactement la même ville
// (indispensable pour que les tags soient posés sur les mêmes murs partout).

export const WORLD_BOUND = 134;

// Statue de Louis XIV, cœur de la place — les joueurs apparaissent en
// cercle autour d'elle, face au Roi.
export const STATUE = { x: -2, z: 6 };
export const SPAWN = { x: 0, y: 0, z: 34, ry: 0 }; // secours (ancien spawn)
export function spawnPoint() {
  const a = Math.random() * Math.PI * 2;
  const r = 9;
  const x = STATUE.x + Math.sin(a) * r;
  const z = STATUE.z + Math.cos(a) * r;
  // Orientation face à la statue (yaw 0 = regard vers -z)
  const ry = Math.atan2(x - STATUE.x, z - STATUE.z);
  return { x, y: 0, z, ry };
}

// Place Bellecour (petite version du mode procédural)
export const BELLECOUR = { minX: -34, maxX: 30, minZ: -16, maxZ: 28 };
// Place Bellecour À L'ÉCHELLE pour le vrai Lyon OSM : ~312 × 212 m réels
// (l'une des plus grandes places piétonnes d'Europe), sur son vrai centre.
export const BELLECOUR_REAL = { minX: -92, maxX: 66, minZ: -50, maxZ: 56 };

// Salle d'arcade
export const ARCADE = {
  x: -8, z: -70, // centre du bâtiment
  w: 32, d: 18, h: 9,
  doorWidth: 6, doorHeight: 4, // porte sur la façade sud (z = -61)
};

// Stand de tir (les cibles sont au nord du comptoir, le joueur tire vers -z)
export const RANGE = {
  x: 40, z: 90,
  width: 26, // emprise est-ouest
  counterZ: 96, targetsZ: 74, backZ: 68,
};

// Fleuves : chaque fleuve a une largeur fixe `w` et un tracé central `cx(z)`
// (méandre). minX/maxX = boîte englobante (réservations, placements larges).
// Un fleuve sans `cx` reste une bande droite (rétro-compat mode OSM).
function meander(baseCx, amp, period, phase = 0) {
  return (z) => baseCx + amp * Math.sin((z + phase) / period);
}
export const SAONE = {
  minX: -118, maxX: -62, w: 24, cx: meander(-90, 14, 150, 30),
};
export const RHONE = {
  minX: 44, maxX: 96, w: 30, cx: meander(70, 9, 200, -60),
};
export const BRIDGE = { halfWidth: 5 };

// Centre / demi-largeur d'un fleuve à la profondeur z (courbe ou droit)
export function riverCx(band, z) {
  return band.cx ? band.cx(z) : (band.minX + band.maxX) / 2;
}
export function riverHalf(band) {
  return band.w != null ? band.w / 2 : (band.maxX - band.minX) / 2;
}

// Interpolateur de tracé central à partir d'une polyligne [[z, x], …] triée
// par z (issue des vraies rivières OSM) : cx(z) par interpolation linéaire,
// bornée aux extrémités. Utilisé pour courber les fleuves du mode OSM.
export function makeCenterline(pts) {
  const p = [...pts].sort((a, b) => a[0] - b[0]);
  if (p.length < 2) return null;
  return (z) => {
    if (z <= p[0][0]) return p[0][1];
    if (z >= p[p.length - 1][0]) return p[p.length - 1][1];
    let lo = 0, hi = p.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (p[mid][0] <= z) lo = mid; else hi = mid;
    }
    const [z0, x0] = p[lo], [z1, x1] = p[hi];
    const t = (z - z0) / (z1 - z0 || 1);
    return x0 + (x1 - x0) * t;
  };
}

// Mur peint (style Croix-Rousse / mur des Canuts) — grande surface à taguer
export const MUR_PEINT = { x: -45, z: -125, w: 34, h: 16 };

// Générateur pseudo-aléatoire déterministe (mulberry32)
export function makeRand(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
