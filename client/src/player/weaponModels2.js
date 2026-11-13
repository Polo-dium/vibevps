import * as THREE from 'three';

// Armes de l'arène (2e fournée : MP5, M16, M4, FAMAS, Kar98k, épée, doubles
// dagues, lance et bouclier). Modèles en volumes simples — canon vers −z,
// poignée près de l'origine, comme ceux de weaponModels.js. Les finitions
// (profils, animations, sons propres) viendront dans une passe dédiée.
const mats = new Map();
const M = (color, metal = 0.6, rough = 0.5) => {
  const k = `${color}|${metal}|${rough}`;
  if (!mats.has(k)) mats.set(k, new THREE.MeshStandardMaterial({ color, metalness: metal, roughness: rough }));
  return mats.get(k);
};
const box = (g, w, h, d, mat, x, y, z, rx = 0) => {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  m.rotation.x = rx;
  g.add(m);
  return m;
};
const tube = (g, r, len, mat, x, y, z) => {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 10), mat);
  m.rotation.x = Math.PI / 2;
  m.position.set(x, y, z);
  g.add(m);
  return m;
};
const STEEL = 0x25272b, BLACK = 0x141518, WOOD = 0x8a5a2e, TAN = 0x6f6a55;

// Fusil générique : boîtier, canon, garde-main, chargeur, poignée, crosse
function rifle({ body = 0.34, barrel = 0.34, guard = 0.24, stock = 0.24, mag = 0.16, magZ = -0.12, magTilt = 0.18,
  colBody = STEEL, colGuard = BLACK, colStock = BLACK, handle = false, bullpup = false, sight = true }) {
  const g = new THREE.Group();
  box(g, 0.05, 0.075, body, M(colBody), 0, 0, -body / 2 + 0.06);
  tube(g, 0.012, barrel, M(STEEL, 0.8, 0.35), 0, 0.012, -body + 0.06 - barrel / 2);
  box(g, 0.052, 0.058, guard, M(colGuard, 0.2, 0.7), 0, 0.002, -body + 0.06 - guard / 2 + 0.02);
  box(g, 0.036, mag, 0.06, M(BLACK, 0.5, 0.5), 0, -0.05 - mag / 2, bullpup ? 0.16 : magZ, magTilt);
  box(g, 0.036, 0.11, 0.045, M(BLACK, 0.2, 0.8), 0, -0.085, 0.0, -0.3);
  if (stock > 0) box(g, 0.042, 0.07, stock, M(colStock, 0.2, 0.7), 0, -0.012, 0.06 + stock / 2);
  if (handle) {
    box(g, 0.02, 0.012, 0.2, M(colBody), 0, 0.085, -0.12);
    box(g, 0.02, 0.05, 0.02, M(colBody), 0, 0.06, -0.03);
    box(g, 0.02, 0.05, 0.02, M(colBody), 0, 0.06, -0.21);
  }
  if (sight) box(g, 0.012, 0.03, 0.012, M(BLACK), 0, 0.05, -body + 0.06 - barrel + 0.05);
  return g;
}

export const buildMp5Model = () => rifle({ body: 0.3, barrel: 0.1, guard: 0.16, stock: 0.2, mag: 0.19, magTilt: 0.3, colGuard: BLACK });
export const buildM16Model = () => rifle({ body: 0.36, barrel: 0.42, guard: 0.3, stock: 0.28, mag: 0.15, handle: true, colBody: BLACK });
export const buildM4Model = () => rifle({ body: 0.34, barrel: 0.26, guard: 0.22, stock: 0.2, mag: 0.15, colBody: BLACK, colGuard: TAN, colStock: TAN });
export const buildFamasModel = () => rifle({ body: 0.5, barrel: 0.12, guard: 0.14, stock: 0, mag: 0.14, bullpup: true, handle: true, colBody: 0x3a4032, colGuard: 0x3a4032 });
export function buildKar98kModel() {
  const g = new THREE.Group();
  box(g, 0.046, 0.06, 0.9, M(WOOD, 0.05, 0.6), 0, -0.012, -0.2);          // fût en bois d'un seul tenant
  box(g, 0.044, 0.085, 0.26, M(WOOD, 0.05, 0.6), 0, -0.03, 0.3, 0.12);    // crosse
  tube(g, 0.011, 0.62, M(STEEL, 0.8, 0.35), 0, 0.03, -0.42);              // canon
  tube(g, 0.016, 0.16, M(STEEL, 0.8, 0.3), 0, 0.03, 0.0);                 // culasse
  box(g, 0.07, 0.014, 0.014, M(STEEL, 0.8, 0.3), 0.04, 0.03, 0.05);       // levier d'armement
  box(g, 0.01, 0.025, 0.01, M(BLACK), 0, 0.052, -0.7);
  return g;
}
export function buildEpeeModel() {
  const g = new THREE.Group();
  box(g, 0.012, 0.055, 0.92, M(0xc9ced6, 0.95, 0.2), 0, 0.02, -0.56);    // lame
  box(g, 0.2, 0.03, 0.035, M(0xb08d3c, 0.9, 0.35), 0, 0.02, -0.09);      // garde
  box(g, 0.03, 0.035, 0.17, M(0x3a2618, 0.1, 0.8), 0, 0.02, 0.0);        // fusée
  box(g, 0.045, 0.045, 0.045, M(0xb08d3c, 0.9, 0.35), 0, 0.02, 0.1);     // pommeau
  g.rotation.x = 0.5; // tenue pointe relevée
  return g;
}
export function buildDaguesModel() {
  const g = new THREE.Group();
  for (const s of [-1, 1]) {
    const d = new THREE.Group();
    box(d, 0.01, 0.04, 0.3, M(0xc9ced6, 0.95, 0.2), 0, 0, -0.2);
    box(d, 0.07, 0.02, 0.02, M(0x2a2b2f, 0.8, 0.4), 0, 0, -0.045);
    box(d, 0.026, 0.03, 0.1, M(0x1b1c1f, 0.1, 0.9), 0, 0, 0.01);
    d.position.set(0.16 * s, -0.02, -0.16);
    d.rotation.set(0.35, -0.12 * s, 0);
    g.add(d);
  }
  return g;
}
export function buildLanceModel() {
  const g = new THREE.Group();
  const lance = new THREE.Group();
  tube(lance, 0.014, 1.9, M(0x6b4a2a, 0.05, 0.7), 0, 0, -0.55);           // hampe
  const tip = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.28, 8), M(0xc9ced6, 0.95, 0.2));
  tip.rotation.x = -Math.PI / 2;
  tip.position.set(0, 0, -1.62);
  lance.add(tip);
  lance.position.set(0.1, 0.02, 0);
  g.add(lance);
  // bouclier rond au bras gauche, tenu bas à gauche pour ne pas boucher la
  // vue : disque de bois (visible des deux côtés) cerclé de bronze, umbo
  const shMat = new THREE.MeshStandardMaterial({ color: 0x8c2f24, metalness: 0.3, roughness: 0.6, side: THREE.DoubleSide });
  const sh = new THREE.Mesh(new THREE.CircleGeometry(0.3, 24), shMat);
  sh.position.set(-0.36, -0.17, -0.34);
  sh.rotation.y = 0.35;
  g.add(sh);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.016, 6, 28), M(0xb08d3c, 0.9, 0.35));
  rim.position.copy(sh.position);
  rim.rotation.y = 0.35;
  g.add(rim);
  const umbo = new THREE.Mesh(new THREE.SphereGeometry(0.07, 12, 8), M(0xb08d3c, 0.9, 0.35));
  umbo.position.set(-0.37, -0.17, -0.37);
  g.add(umbo);
  return g;
}
