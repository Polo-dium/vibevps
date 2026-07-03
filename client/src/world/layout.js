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

// Place Bellecour
export const BELLECOUR = { minX: -34, maxX: 30, minZ: -16, maxZ: 28 };

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

// Fleuves (bandes nord-sud)
export const SAONE = { minX: -102, maxX: -78 };
export const RHONE = { minX: 55, maxX: 85 };
export const BRIDGE = { halfWidth: 5 }; // ponts à z = 0

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
