// PLAN DE L'ARÈNE DE BELLECOUR — source unique, lue par le client (décor et
// collisions, world/arena.js) ET par le serveur (navigation et lignes de tir
// des bots, server/src/arena.js). Données pures, aucune dépendance.
// Repère : coordonnées locales de la place (x est-ouest, z nord-sud, centre
// = Louis XIV). Dans la scène, la place est bâtie à x + ARENA.OFFSET.

export const ARENA = {
  OFFSET: 20000,
  W: 156, D: 106,          // la place
  PAD_W: 138, PAD_D: 62,   // la dalle du dépôt
  CL: 6.06, CH: 2.59, CW: 2.44, // conteneur 20 pieds
  GROUND: 0.05,
};

const mirror = (list) => list.flatMap(([x, z, ...rest]) => [[x, z, ...rest], [-x, -z, ...rest]]);

// Conteneurs : [x, z, quart de tour, niveau]. Moitié ouest, l'autre moitié
// est son image par demi-tour autour du Roi (mêmes chances des deux côtés).
export const CANS = mirror([
  [-14, -9, 0, 0], [-14, -9, 0, 1], [-20.4, -9, 0, 0],
  [-11, 13, 1, 0],
  [-29, 3, 1, 0], [-29, 3, 1, 1],
  [-38, -19, 0, 0], [-44.3, -19, 0, 0], [-41, -19, 0, 1],
  [-25, 22, 0, 0], [-31.3, 22, 0, 0],
  [-50, 11, 1, 0], [-52.6, 11, 1, 0], [-51.3, 11, 1, 1],
  [-62, -7, 0, 0], [-62, -7, 0, 1], [-62, -7, 0, 2],
  [-5, -24, 0, 0],
  [-64, 23, 1, 0],
  [-40, 8, 0, 0],
  [-19, -24.5, 1, 0],
]);
// Caisses-marchepieds : [x, z, côté, couleur]
export const CRATES = mirror([
  [-10.4, -9.2, 1.1, 0x8a6a42], [-29, 6.9, 1.1, 0x8a6a42], [-58.2, -6.6, 1.2, 0x8a6a42],
  [-47.6, 14.6, 1.15, 0x8a6a42], [-36, -15.9, 1.0, 0x6d7f4b],
]);
// Glissières béton : [x, z, quart de tour, nombre d'éléments]
export const JERSEYS = mirror([
  [-22, 3, 0, 3], [-8, -15, 1, 2], [-46, -4, 1, 3], [-35, 15, 0, 2], [-58, 5, 1, 2], [-3, 9.5, 1, 2],
]);
// Blocs rayés : [x, z, quart de tour]
export const HAZARDS = mirror([[-17, 6, 0], [-55, -17, 1], [-33, -8, 1]]);
// Fûts : [x, z, couleur]
export const BARRELS = mirror([
  [-24.5, -12.2, 0x2f5f8a], [-25.2, -11.4, 0xa03a2c], [-43, 20, 0x2f5f8a], [-8.6, 20.6, 0xc49a2c],
]);
export const PALLETS = mirror([[-16, 21], [-45, -9.5]]);
export const CONES = mirror([
  [-18, 0.5], [-19.2, 9], [-26, -4], [-33.5, -13], [-9, -19], [-42, 4.5], [-56, 14], [-6.5, 6.4], [-12.5, 18], [-48, -14],
]);
// Chariots élévateurs : [x, z, cap]
export const FORKLIFTS = [[-34, -3, 0.5], [27, 9.5, -2.2]];
// Mâts d'éclairage
export const MASTS = [[-66, -29.5], [66, 29.5], [-66, 29.5], [66, -29.5], [-22, -30], [22, 30]];

// Arbres de la place : [x, z, jitter -0,5..0,5] (jitter déterministe)
export const TREES = (() => {
  const out = [];
  const halfW = ARENA.W / 2, halfD = ARENA.D / 2;
  for (const sz of [-halfD + 5.5, -halfD + 13, halfD - 5.5, halfD - 13]) {
    for (let x = -halfW + 12; x <= halfW - 12; x += 9) {
      if (sz > 0 && Math.abs(x) < 8) continue; // l'allée du portail reste dégagée
      const h = Math.sin(x * 12.9898 + sz * 78.233) * 43758.5453;
      const jitter = h - Math.floor(h) - 0.5;
      out.push([x + jitter * 1.6, sz, jitter]);
    }
  }
  return out;
})();

// Bases et drapeaux (équipe 0 = rouge à l'ouest, 1 = bleue à l'est)
export const BASES = [{ x: -70, z: 0 }, { x: 70, z: 0 }];
export const TEAM_SPAWNS = [
  [[-72, -12], [-72, 12], [-66, 14], [-70, -22], [-68, 26], [-74, 4]],
  [[72, 12], [72, -12], [66, -14], [70, 22], [68, -26], [74, -4]],
];
export const FFA_SPAWNS = [
  [-72, -24], [72, 24], [-72, 26], [72, -26], [0, 28], [0, -28], [-36, 27], [36, -27],
  [-34, -27], [34, 27], [-56, 0], [56, 0], [-18, 16], [18, -16],
];
// Console de match et tableau des meilleurs (près du portail, au sud)
export const CONSOLE = { x: 6.5, z: 38.5 };
export const PORTAL = { x: 0, z: ARENA.D / 2 - 12 };

// Tous les obstacles pleins, en boîtes alignées sur les axes (repère local)
export function arenaBoxes() {
  const { CL, CH, CW, GROUND } = ARENA;
  const out = [];
  const add = (x0, x1, z0, z1, y0, y1) => out.push({ x0, x1, z0, z1, y0, y1 });
  for (const [x, z, q, lv] of CANS) {
    const hx = (q ? CW : CL) / 2, hz = (q ? CL : CW) / 2;
    add(x - hx, x + hx, z - hz, z + hz, GROUND + lv * CH, GROUND + (lv + 1) * CH);
    out[out.length - 1].metal = true; // tôle : étincelles sous les balles
  }
  for (const [x, z, s] of CRATES) add(x - s / 2, x + s / 2, z - s / 2, z + s / 2, 0, GROUND + s);
  for (const [x, z, q, n] of JERSEYS) {
    for (let i = 0; i < n; i++) {
      const o = (i - (n - 1) / 2) * 2.46;
      const jx = x + (q ? o : 0), jz = z + (q ? 0 : o);
      const hx = q ? 1.2 : 0.3, hz = q ? 0.3 : 1.2;
      add(jx - hx, jx + hx, jz - hz, jz + hz, 0, 0.89);
    }
  }
  for (const [x, z, q] of HAZARDS) {
    const hx = q ? 0.9 : 0.35, hz = q ? 0.35 : 0.9;
    add(x - hx, x + hx, z - hz, z + hz, 0, 1.15);
  }
  for (const [x, z] of BARRELS) add(x - 0.3, x + 0.3, z - 0.3, z + 0.3, 0, 0.95);
  for (const [x, z] of FORKLIFTS) add(x - 1.1, x + 1.1, z - 1.1, z + 1.1, 0, 2.3);
  for (const [x, z] of MASTS) add(x - 0.55, x + 0.55, z - 0.55, z + 0.55, 0, 13);
  for (const [x, z] of TREES) add(x - 0.3, x + 0.3, z - 0.3, z + 0.3, 0, 3.4);
  // Louis XIV : emmarchement, socle, statue
  add(-4.7, 4.7, -3.7, 3.7, 0, 0.5);
  add(-4.3, 4.3, -3.3, 3.3, 0.5, 1.0);
  add(-3.95, 3.95, -2.95, 2.95, 1.0, 4.3);
  add(-2.6, 2.6, -0.9, 0.9, 4.3, 8.6);
  // Console de match
  add(CONSOLE.x - 0.45, CONSOLE.x + 0.45, CONSOLE.z - 0.3, CONSOLE.z + 0.3, 0, 1.5);
  return out;
}
