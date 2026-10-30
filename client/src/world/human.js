import * as THREE from 'three';
import { detail } from '../render/detail.js';
import { sculpt, withDetails, paint } from '../render/sculpt.js';

// Humanoïde articulé (origine aux pieds, ~1,78 m), SCULPTÉ : au lieu de
// cylindres et de sphères empilés, chaque partie est un volume organique
// d'un seul tenant (render/sculpt.js) — deltoïdes, pectoraux, taille,
// mollets, genoux, mâchoire, arcades, nez, oreilles se fondent les uns dans
// les autres. Petits détails du visage (yeux, sourcils, bouche) ajoutés en
// pièces fines dans le même mesh.
//
// PERF : UN maillage à squelette par humain (corps, jambes, bras et
// avant-bras articulés au coude = os). Les formes ne sont calculées qu'UNE fois par modèle (cache) : tous
// les humains partagent positions, normales et index sur le GPU, seules
// leurs couleurs de sommets diffèrent (voir paint()). Grille plus fine au
// palier Élevé, plus grossière (moins de triangles) ailleurs.
// Tous les meshes d'un humain partagent UN matériau : `shirtMat` le teinte
// en entier (flash de dégâts).

// Teintes (slots) des volumes
const SHIRT = 0, SHIRT_DARK = 1, PANTS = 2, SKIN = 3, SKIN_DARK = 4, HAIR = 5,
  SHOE = 6, SOLE = 7, BELT = 8, METAL = 9, WHITE = 10, EYE = 11, LIP = 12, CAP = 13,
  INNER = 14, SKIRT = 15, IRIS = 16;

const cache = new Map();
function cached(key, build) {
  if (!cache.has(key)) cache.set(key, build());
  return cache.get(key);
}
const cellSize = () => (detail.high ? 0.023 : 0.038);
// La TÊTE a sa propre grille, bien plus fine (petit volume : quelques
// milliers de triangles, partagés par tous les humains du même modèle) :
// nez, arcades, mâchoire et oreilles se lisent enfin hors palier Élevé
const headCell = () => (detail.high ? 0.0135 : 0.017);
// Pièce de la tête : tout ce qui est au-dessus du cou
const isHeadPrim = (q) => (q.t === 'cone' ? Math.min(q.a[1], q.b[1]) : q.c?.[1] ?? 0) >= 1.55;

// Jambe, repère du pivot (hanche à l'origine) : cuisse galbée, genou,
// mollet, cheville, chaussure à bout rond sur semelle claire
function legShape() {
  return [
    { t: 'ell', c: [0, -0.02, 0.005], r: [0.092, 0.11, 0.1], slot: PANTS, k: 0.03 },
    { t: 'cone', a: [0, -0.03, 0], b: [0, -0.4, -0.012], r1: 0.086, r2: 0.058, slot: PANTS, k: 0.04 },
    { t: 'ell', c: [0.004, -0.17, -0.014], r: [0.066, 0.14, 0.064], slot: PANTS, k: 0.07 },
    { t: 'sphere', c: [0, -0.42, -0.018], r: 0.058, slot: PANTS, k: 0.03 },
    { t: 'cone', a: [0, -0.43, -0.005], b: [0, -0.74, 0.008], r1: 0.057, r2: 0.044, slot: PANTS, k: 0.03 },
    { t: 'ell', c: [0, -0.54, 0.016], r: [0.046, 0.09, 0.046], slot: PANTS, k: 0.07 },
    // Bas de pantalon un peu évasé sur la chaussure
    { t: 'cone', a: [0, -0.7, 0.005], b: [0, -0.765, 0.005], r1: 0.05, r2: 0.058, slot: PANTS, k: 0.015 },
    // Chaussure : empeigne + bout arrondi, semelle débordante
    { t: 'box', c: [0, -0.8, -0.04], h: [0.052, 0.04, 0.115], round: 0.035, slot: SHOE, k: 0.03 },
    { t: 'ell', c: [0, -0.81, -0.135], r: [0.054, 0.036, 0.06], slot: SHOE, k: 0.03 },
    { t: 'box', c: [0, -0.848, -0.05], h: [0.06, 0.013, 0.14], round: 0.012, slot: SOLE, k: 0.006 },
    { t: 'plane', h: -0.86, sub: true, k: 0.004 },
  ];
}

// Bras, repère du pivot (épaule à l'origine) ; s = côté (-1 gauche, +1 droit)
function armShape(s) {
  return [
    { t: 'ell', c: [-0.012 * s, -0.03, 0.002], r: [0.058, 0.076, 0.066], slot: SHIRT, k: 0.04 },
    { t: 'cone', a: [0, -0.04, 0], b: [0, -0.27, 0.004], r1: 0.052, r2: 0.042, slot: SHIRT, k: 0.03 },
    { t: 'ell', c: [0, -0.15, -0.016], r: [0.04, 0.075, 0.04], slot: SHIRT, k: 0.03 }, // biceps
    { t: 'sphere', c: [0, -0.285, 0.006], r: 0.042, slot: SHIRT, k: 0.04 }, // coude
    { t: 'cone', a: [0, -0.29, 0.004], b: [0, -0.47, -0.008], r1: 0.047, r2: 0.036, slot: SHIRT, k: 0.03 },
    // Poignet de manche, puis poignet nu
    { t: 'cone', a: [0, -0.455, -0.008], b: [0, -0.5, -0.01], r1: 0.04, r2: 0.04, slot: SHIRT_DARK, k: 0.012 },
    { t: 'cone', a: [0, -0.49, -0.01], b: [0, -0.53, -0.01], r1: 0.027, r2: 0.028, slot: SKIN, k: 0.01 },
    // Main : paume, doigts serrés, pouce vers l'intérieur
    { t: 'box', c: [0, -0.567, -0.008], h: [0.017, 0.042, 0.04], round: 0.016, slot: SKIN, k: 0.02 },
    { t: 'box', c: [0, -0.625, -0.012], h: [0.014, 0.028, 0.037], round: 0.013, rot: [0.15, 0, 0], slot: SKIN, k: 0.012 },
    { t: 'cone', a: [-0.012 * s, -0.54, -0.035], b: [-0.03 * s, -0.592, -0.05], r1: 0.014, r2: 0.011, slot: SKIN, k: 0.012 },
  ];
}

// Tronc, bassin, cou, tête et coiffure (un seul volume). Variantes v :
// fem (silhouette : épaules, taille, poitrine, hanches), veste (veste
// ouverte sur la chemise INNER, pans sur les hanches), jupe, barbe.
function bodyShape(look, v = {}) {
  const f = !!v.fem;
  const p = [
    // Bassin + ceinture
    { t: 'ell', c: [0, 0.89, 0.005], r: f ? [0.182, 0.125, 0.12] : [0.175, 0.12, 0.115], slot: PANTS, k: 0.03 },
    { t: 'ell', c: [0, 0.985, 0.003], r: f ? [0.16, 0.026, 0.11] : [0.184, 0.03, 0.124], slot: BELT, k: 0.004 },
    // Taille, cage thoracique, pectoraux (ou poitrine), dos, épaules
    { t: 'ell', c: [0, 1.09, 0], r: f ? [0.132, 0.13, 0.092] : [0.158, 0.13, 0.1], slot: SHIRT, k: 0.04 },
    { t: 'ell', c: [0, 1.28, 0.0], r: f ? [0.162, 0.16, 0.108] : [0.19, 0.17, 0.118], slot: SHIRT, k: 0.06 },
    ...(f ? [
      { t: 'ell', c: [-0.062, 1.265, -0.068], r: [0.066, 0.064, 0.058], slot: SHIRT, k: 0.04 },
      { t: 'ell', c: [0.062, 1.265, -0.068], r: [0.066, 0.064, 0.058], slot: SHIRT, k: 0.04 },
    ] : [
      { t: 'ell', c: [-0.072, 1.3, -0.05], r: [0.08, 0.062, 0.055], slot: SHIRT, k: 0.05 },
      { t: 'ell', c: [0.072, 1.3, -0.05], r: [0.08, 0.062, 0.055], slot: SHIRT, k: 0.05 },
    ]),
    { t: 'ell', c: [0, 1.3, 0.045], r: f ? [0.15, 0.15, 0.08] : [0.175, 0.16, 0.085], slot: SHIRT, k: 0.05 },
    { t: 'cone', a: [f ? -0.16 : -0.18, 1.39, 0.008], b: [f ? 0.16 : 0.18, 1.39, 0.008], r1: f ? 0.056 : 0.066, r2: f ? 0.056 : 0.066, slot: SHIRT, k: 0.1 },
    { t: 'cone', a: [-0.07, 1.44, 0.02], b: [0.07, 1.44, 0.02], r1: f ? 0.042 : 0.05, r2: f ? 0.042 : 0.05, slot: SHIRT, k: 0.08 }, // trapèzes
    // Col + cou
    { t: 'cone', a: [0, 1.45, 0.012], b: [0, 1.585, 0.0], r1: f ? 0.045 : 0.054, r2: f ? 0.042 : 0.05, slot: SKIN, k: 0.02 },
    // Tête : crâne, mâchoire, menton, pommettes, arcades, nez, oreilles
    { t: 'ell', c: [0, 1.678, 0.008], r: [0.093, 0.112, 0.104], slot: SKIN, k: 0.03 },
    { t: 'ell', c: [0, 1.605, -0.03], r: f ? [0.064, 0.054, 0.066] : [0.072, 0.058, 0.072], slot: SKIN, k: 0.05 },
    { t: 'ell', c: [0, 1.572, -0.072], r: [0.03, 0.026, 0.028], slot: SKIN, k: 0.03 },
    // pommettes en SPHÈRES (distance exacte) : les petits ellipsoïdes
    // faussaient les normales et tachaient les joues d'ombres
    { t: 'sphere', c: [-0.05, 1.646, -0.066], r: 0.024, slot: SKIN, k: 0.025 },
    { t: 'sphere', c: [0.05, 1.646, -0.066], r: 0.024, slot: SKIN, k: 0.025 },
    { t: 'cone', a: [-0.05, 1.703, -0.088], b: [0.05, 1.703, -0.088], r1: 0.016, r2: 0.016, slot: SKIN, k: 0.02 },
    { t: 'cone', a: [0, 1.682, -0.1], b: [0, 1.632, -0.124], r1: 0.011, r2: 0.017, slot: SKIN, k: 0.012 },
    { t: 'ell', c: [-0.094, 1.665, 0.012], r: [0.014, 0.032, 0.022], slot: SKIN_DARK, k: 0.01 },
    { t: 'ell', c: [0.094, 1.665, 0.012], r: [0.014, 0.032, 0.022], slot: SKIN_DARK, k: 0.01 },
    // Ailes du nez, lèvres en volume (lisibles avec la grille fine de la tête)
    // (sphères et capsules : distances exactes, normales propres)
    { t: 'sphere', c: [-0.015, 1.636, -0.111], r: 0.0105, slot: SKIN, k: 0.008 },
    { t: 'sphere', c: [0.015, 1.636, -0.111], r: 0.0105, slot: SKIN, k: 0.008 },
    { t: 'cone', a: [-0.019, 1.603, -0.1], b: [0.019, 1.603, -0.1], r1: f ? 0.0075 : 0.0062, r2: f ? 0.0075 : 0.0062, slot: LIP, k: 0.006 },
    { t: 'cone', a: [-0.016, 1.591, -0.098], b: [0.016, 1.591, -0.098], r1: f ? 0.0095 : 0.008, r2: f ? 0.0095 : 0.008, slot: LIP, k: 0.006 },

  ];
  // Veste ouverte : la chemise (INNER) se voit en V sur la poitrine, revers
  // plus sombres, pans de la veste qui couvrent la ceinture
  if (v.veste) {
    p.push({ t: 'ell', c: [0, 1.27, f ? -0.098 : -0.106], r: [0.066, 0.15, 0.03], slot: INNER, k: 0.012 });
    p.push({ t: 'cone', a: [-0.05, 1.42, -0.1], b: [-0.03, 1.13, -0.112], r1: 0.018, r2: 0.012, slot: SHIRT_DARK, k: 0.01 });
    p.push({ t: 'cone', a: [0.05, 1.42, -0.1], b: [0.03, 1.13, -0.112], r1: 0.018, r2: 0.012, slot: SHIRT_DARK, k: 0.01 });
    p.push({ t: 'ell', c: [0, 0.97, 0.004], r: f ? [0.17, 0.085, 0.124] : [0.19, 0.085, 0.13], slot: SHIRT, k: 0.03 });
  }
  // Jupe (évasée, au-dessus du genou)
  if (v.jupe) p.push({ t: 'cone', a: [0, 1.0, 0.004], b: [0, 0.6, 0.012], r1: 0.15, r2: 0.24, slot: SKIRT, k: 0.03 });
  // Barbe courte + moustache
  if (v.barbe) {
    p.push({ t: 'ell', c: [0, 1.595, -0.052], r: [0.08, 0.052, 0.062], slot: HAIR, k: 0.015 });
    p.push({ t: 'ell', c: [0, 1.616, -0.1], r: [0.034, 0.008, 0.012], slot: HAIR, k: 0.006 });
  }
  // Calotte de cheveux : en retrait du front, couvre le haut et la nuque
  p.push({ t: 'ell', c: [0, 1.722, 0.006], r: [0.1, 0.088, 0.11], slot: look === 'casquette' ? CAP : look === 'chauve' ? SKIN : HAIR, k: 0.012 });
  if (look === 'chauve') {
    p.push({ t: 'ell', c: [0, 1.67, 0.04], r: [0.1, 0.05, 0.07], slot: HAIR, k: 0.02 }); // couronne
  } else if (look === 'chignon') {
    p.push({ t: 'ell', c: [0, 1.655, 0.05], r: [0.092, 0.075, 0.07], slot: HAIR, k: 0.02 });
    p.push({ t: 'sphere', c: [0, 1.745, 0.1], r: 0.052, slot: HAIR, k: 0.02 }); // chignon
  } else if (look === 'casquette') {
    p.push({ t: 'ell', c: [0, 1.718, 0.012], r: [0.106, 0.072, 0.112], slot: CAP, k: 0.01 });
    p.push({ t: 'ell', c: [0, 1.725, -0.112], r: [0.082, 0.011, 0.068], slot: CAP, k: 0.012 });
    p.push({ t: 'ell', c: [0, 1.665, 0.045], r: [0.088, 0.05, 0.075], slot: HAIR, k: 0.02 }); // nuque
  } else if (look === 'long') {
    p.push({ t: 'ell', c: [0, 1.6, 0.052], r: [0.11, 0.15, 0.07], slot: HAIR, k: 0.04 });
    p.push({ t: 'ell', c: [-0.085, 1.62, 0.0], r: [0.035, 0.1, 0.06], slot: HAIR, k: 0.03 });
    p.push({ t: 'ell', c: [0.085, 1.62, 0.0], r: [0.035, 0.1, 0.06], slot: HAIR, k: 0.03 });
    // frange (capsule : normales propres) — plus de casque lisse
    p.push({ t: 'cone', a: [-0.068, 1.752, -0.084], b: [0.068, 1.752, -0.084], r1: 0.021, r2: 0.021, slot: HAIR, k: 0.015 });
  } else {
    p.push({ t: 'ell', c: [0, 1.645, 0.045], r: [0.09, 0.07, 0.07], slot: HAIR, k: 0.02 }); // nuque
    // mèche coiffée sur le côté, qui casse la ligne du front
    if (look === 'court') p.push({ t: 'cone', a: [-0.072, 1.775, -0.06], b: [0.045, 1.765, -0.09], r1: 0.024, r2: 0.018, slot: HAIR, k: 0.018 });
  }
  return p;
}

// Détails trop fins pour la grille : yeux, pupilles, sourcils, bouche, boucle
function faceDetails() {
  const at = (x, y, z, sx = 1, sy = 1, sz = 1, rz = 0, rx = 0) => new THREE.Matrix4().compose(
    new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, 0, rz)), new THREE.Vector3(sx, sy, sz));
  // Œil en amande, à fleur de l'orbite : blanc cassé, iris coloré, petite
  // pupille, paupière supérieure (peau) qui coupe le haut du globe — plus
  // de gros yeux ronds écarquillés
  const eye = new THREE.SphereGeometry(0.0125, 12, 8);
  const iris = new THREE.CircleGeometry(0.0068, 12);
  const pupil = new THREE.CircleGeometry(0.0034, 10);
  const lid = new THREE.SphereGeometry(0.0138, 12, 6, 0, Math.PI * 2, 0, Math.PI * 0.42);
  const brow = new THREE.BoxGeometry(0.042, 0.0065, 0.01);
  const buckle = new THREE.BoxGeometry(0.055, 0.036, 0.016);
  const out = [];
  for (const sx of [-1, 1]) {
    const x = 0.036 * sx;
    out.push({ geometry: eye, slot: WHITE, matrix: at(x, 1.681, -0.088, 1.15, 0.7, 0.62) });
    // disques tournés vers l'avant (-z) : rotation x = π
    out.push({ geometry: iris, slot: IRIS, matrix: at(x, 1.6805, -0.0961, 1, 1, 1, 0, Math.PI) });
    out.push({ geometry: pupil, slot: EYE, matrix: at(x, 1.6805, -0.0963, 1, 1, 1, 0, Math.PI) });
    // paupière : calotte de sphère couchée sur le haut de l'œil
    out.push({ geometry: lid, slot: SKIN_DARK, matrix: at(x, 1.6835, -0.0885, 1.2, 0.55, 0.7, 0, -0.35) });
    out.push({ geometry: brow, slot: HAIR, matrix: at(0.039 * sx, 1.705, -0.1, 1, 1, 1, -0.14 * sx) });
  }
  out.push({ geometry: buckle, slot: METAL, matrix: at(0, 0.985, -0.112) });
  return out;
}

const legGeo = () => cached(`jambe|${cellSize()}`, () => sculpt(legShape(), { cell: cellSize() }));
// Bras en DEUX pièces articulées au coude (ELBOW, repère de l'épaule) :
// le bras (épaule → coude) et l'avant-bras (coude → main), qui partagent
// la boule du coude pour que la jointure reste pleine quand il se plie
const ELBOW = [0, -0.285, 0.006];
function shiftPrim(p, d) {
  const q = { ...p };
  for (const k of ['c', 'a', 'b']) if (q[k]) q[k] = [q[k][0] - d[0], q[k][1] - d[1], q[k][2] - d[2]];
  if (q.t === 'plane') q.h -= d[1]; // plan horizontal (semelle) : hauteur absolue
  return q;
}
const armGeo = (s) => cached(`bras${s}|${cellSize()}`, () => sculpt(armShape(s).slice(0, 4), { cell: cellSize() }));
// Jambe articulée au genou (KNEE, repère de la hanche) : variante « assise »
// des clients de terrasse uniquement (2 meshes de plus)
const KNEE = [0, -0.42, -0.018];
const thighGeo = () => cached(`cuisse|${cellSize()}`, () => sculpt(legShape().slice(0, 4), { cell: cellSize() }));
const shinGeo = () => cached(`tibia|${cellSize()}`,
  () => sculpt(legShape().slice(3).map((p) => shiftPrim(p, KNEE)), { cell: cellSize() }));
const foreGeo = (s) => cached(`avantbras${s}|${cellSize()}`,
  () => sculpt(armShape(s).slice(3).map((p) => shiftPrim(p, ELBOW)), { cell: cellSize() }));
// Pivots (repère des pieds) : hanches, épaules
const HIP_L = [-0.105, 0.86, 0], HIP_R = [0.105, 0.86, 0];
const SHOULDER_L = [-0.255, 1.41, 0], SHOULDER_R = [0.255, 1.41, 0];
const add3 = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];

// Toutes les pièces fusionnées dans la pose de repos, chaque sommet lié à
// l'os de sa pièce (ordre des os : voir buildHuman). Calculé une fois par
// modèle, partagé par tous les humains (seules les couleurs diffèrent).
function skinnedGeo(seated, look, v) {
  return cached(`squelette|${seated}|${look}|${v.fem}|${v.veste}|${v.jupe}|${v.barbe}|${cellSize()}`, () => {
    const parts = [
      [bodyGeo(look, v), 1, [0, 0, 0]],
      [seated ? thighGeo() : legGeo(), 2, HIP_L],
      [seated ? thighGeo() : legGeo(), 3, HIP_R],
      [armGeo(-1), 4, SHOULDER_L],
      [armGeo(1), 5, SHOULDER_R],
      [foreGeo(-1), 6, add3(SHOULDER_L, ELBOW)],
      [foreGeo(1), 7, add3(SHOULDER_R, ELBOW)],
    ];
    if (seated) parts.push([shinGeo(), 8, add3(HIP_L, KNEE)], [shinGeo(), 9, add3(HIP_R, KNEE)]);
    let nv = 0, ni = 0;
    for (const [g] of parts) { nv += g.attributes.position.count; ni += g.index.count; }
    const position = new Float32Array(nv * 3), normal = new Float32Array(nv * 3), slot = new Float32Array(nv * 3);
    const skinIndex = new Uint16Array(nv * 4), skinWeight = new Float32Array(nv * 4);
    const index = nv > 65535 ? new Uint32Array(ni) : new Uint16Array(ni);
    let ov = 0, oi = 0;
    for (const [g, b, [dx, dy, dz]] of parts) {
      const P = g.attributes.position, N = g.attributes.normal, S = g.attributes.slot;
      for (let v = 0; v < P.count; v++) {
        const o = (ov + v) * 3;
        position[o] = P.getX(v) + dx; position[o + 1] = P.getY(v) + dy; position[o + 2] = P.getZ(v) + dz;
        normal[o] = N.getX(v); normal[o + 1] = N.getY(v); normal[o + 2] = N.getZ(v);
        slot[o] = S.getX(v); slot[o + 1] = S.getY(v); slot[o + 2] = S.getZ(v);
        skinIndex[(ov + v) * 4] = b;
        skinWeight[(ov + v) * 4] = 1;
      }
      for (let k = 0; k < g.index.count; k++) index[oi + k] = g.index.getX(k) + ov;
      ov += P.count; oi += g.index.count;
    }
    const out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.BufferAttribute(position, 3));
    out.setAttribute('normal', new THREE.BufferAttribute(normal, 3));
    out.setAttribute('slot', new THREE.BufferAttribute(slot, 3));
    out.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinIndex, 4));
    out.setAttribute('skinWeight', new THREE.BufferAttribute(skinWeight, 4));
    out.setIndex(new THREE.BufferAttribute(index, 1));
    out.computeBoundingSphere();
    return out;
  });
}

const bodyGeo = (look, v) => cached(`corps|${look}|${v.fem}|${v.veste}|${v.jupe}|${v.barbe}|${cellSize()}`, () => {
  const prims = bodyShape(look, v);
  const torso = prims.filter((q) => !isHeadPrim(q));
  // la tête garde un bout de cou, un peu plus fin, noyé dans celui du tronc
  const head = [
    { t: 'cone', a: [0, 1.56, 0.006], b: [0, 1.62, 0.002], r1: v.fem ? 0.039 : 0.046, r2: v.fem ? 0.038 : 0.045, slot: SKIN, k: 0.01 },
    ...prims.filter(isHeadPrim),
  ];
  const headGeo = sculpt(head, { cell: headCell() });
  return withDetails(sculpt(torso, { cell: cellSize() }), [{ geometry: headGeo }, ...faceDetails()]);
});

// Vestes et jupes (teintes de la garde-robe lyonnaise)
const JACKETS = [0x1f2a44, 0x2a2a2e, 0xa8865a, 0x5b6068, 0x4a5a3a, 0x6d2430, 0x8a8f96];
const SKIRTS = [0x22252c, 0x6d2430, 0x2f4a6d, 0x9a7a52, 0x3c5a48, 0x5a2f5e];
const TIGHTS = [0x1c1c22, 0x3a2f2a];

// Options facultatives : fem, veste (couleur ou true), jupe, barbe. Non
// précisées, elles se DÉDUISENT des couleurs (même tenue = même personne) :
// la foule est variée sans hasard. Silhouette (taille, carrure) idem.
export function buildHuman({ shirt = 0x6b7a8f, pants = 0x39404e, skin = 0xe8c39e, hair = 0x3a2c1e, style, seated = false,
  fem, veste, jupe, barbe } = {}) {
  let hsh = (shirt * 31 + pants * 17 + hair * 7 + skin) >>> 0;
  hsh = Math.imul(hsh ^ (hsh >>> 15), 2246822507) >>> 0;
  const bit = (k, n) => (hsh >>> k) % n;
  fem ??= bit(0, 2) === 1;
  veste ??= bit(3, 3) === 0;
  jupe ??= fem && !seated && bit(6, 3) === 0;
  barbe ??= !fem && bit(9, 4) === 0;
  if (seated) jupe = false;
  const v = { fem, veste: !!veste, jupe: !!jupe, barbe: !!barbe };
  const group = new THREE.Group();
  // Matériau unique de CET humain : la couleur multiplie les couleurs de
  // sommets, donc la mettre en rouge teinte tout le personnage (flash).
  // PBR au palier Élevé seulement (Lambert, bien moins cher, ailleurs)
  const bodyMat = detail.high
    ? new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82, metalness: 0 })
    : new THREE.MeshLambertMaterial({ vertexColors: true });
  const C = (hex) => new THREE.Color(hex);
  const palette = [];
  palette[SHIRT] = C(shirt);
  palette[SHIRT_DARK] = C(shirt).multiplyScalar(0.72);
  palette[PANTS] = C(pants);
  palette[SKIN] = C(skin);
  palette[SKIN_DARK] = C(skin).multiplyScalar(0.86);
  palette[HAIR] = C(hair);
  palette[SHOE] = C(0x23262d);
  palette[SOLE] = C(0xd8d4cc);
  palette[BELT] = C(0x2a211b);
  palette[METAL] = C(0xc9c2a8);
  palette[EYE] = C(0x101114);
  palette[WHITE] = C(0xe6e0d4);
  palette[IRIS] = C([0x5a3a22, 0x3b2a1c, 0x4a6a8a, 0x5d6b3a, 0x6b4a2a][bit(28, 5)]);
  palette[LIP] = C(skin).lerp(C(0xa0473d), 0.45);
  palette[CAP] = C(shirt).multiplyScalar(0.72);
  // Veste : le tronc et les manches prennent la couleur de la veste, la
  // chemise ne se voit plus que dans l'encolure
  palette[INNER] = C(shirt);
  if (v.veste) {
    const jc = typeof veste === 'number' ? veste : JACKETS[bit(12, JACKETS.length)];
    palette[SHIRT] = C(jc);
    palette[SHIRT_DARK] = C(jc).multiplyScalar(0.7);
  }
  palette[SKIRT] = C(SKIRTS[bit(15, SKIRTS.length)]);
  // jupe : jambes nues ou collants sombres
  if (v.jupe) palette[PANTS] = bit(18, 3) ? C(skin) : C(TIGHTS[bit(21, TIGHTS.length)]);
  // Coiffure stable pour une même tenue (déterministe)
  const look = style ?? (fem
    ? ['long', 'chignon', 'long'][bit(20, 3)]
    : ['court', 'casquette', 'court', 'chauve'][bit(20, 4)]);

  // UN SEUL maillage à squelette par humain (1 draw call au lieu de 7 à
  // 9) : les pièces sont fusionnées, chacune liée à son os ; les os sont
  // les anciens pivots (mêmes positions, même API : armR.rotation.x…).
  const base = skinnedGeo(seated, look, v);
  const geo = paint(base, palette);
  geo.setAttribute('skinIndex', base.attributes.skinIndex);
  geo.setAttribute('skinWeight', base.attributes.skinWeight);
  const mesh = new THREE.SkinnedMesh(geo, bodyMat);
  const bone = (parent, [x, y, z]) => {
    const b = new THREE.Bone();
    b.position.set(x, y, z);
    parent.add(b);
    return b;
  };
  const root = new THREE.Bone();
  mesh.add(root);
  const torso = bone(root, [0, 0, 0]);
  const legL = bone(root, HIP_L), legR = bone(root, HIP_R);
  const armL = bone(root, SHOULDER_L), armR = bone(root, SHOULDER_R);
  // Avant-bras : os au coude, enfant du bras (rotation.x > 0 = plie le
  // coude vers l'avant)
  const foreL = bone(armL, ELBOW), foreR = bone(armR, ELBOW);
  // Assis : tibias articulés au genou (rotation.x < 0 = replie la jambe)
  const kneeL = seated ? bone(legL, KNEE) : null;
  const kneeR = seated ? bone(legR, KNEE) : null;
  const bones = [root, torso, legL, legR, armL, armR, foreL, foreR];
  if (seated) bones.push(kneeL, kneeR);
  // Carrure et taille propres à chacun (±6 %), un peu plus menues pour les
  // silhouettes féminines
  const sy = (0.94 + bit(23, 7) * 0.02) * (fem ? 0.955 : 1);
  const sw = sy * (0.94 + bit(26, 5) * 0.03);
  mesh.scale.set(sw, sy, sw);
  group.add(mesh);
  mesh.updateMatrixWorld(true);
  mesh.bind(new THREE.Skeleton(bones));
  // Volumes fixes (posture comprise) : sans eux, three.js recalculerait
  // chaque sommet déformé au premier rendu / au premier tir
  mesh.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.95, 0), 1.25);
  mesh.boundingBox = new THREE.Box3(new THREE.Vector3(-0.9, -0.1, -0.9), new THREE.Vector3(0.9, 2.1, 0.9));
  const body = torso;

  // Animation de marche : balancement opposé jambes/bras
  function animate(t, speed) {
    const swing = Math.min(1, speed / 4) * 0.65;
    const s = Math.sin(t);
    legL.rotation.x = s * swing;
    legR.rotation.x = -s * swing;
    armL.rotation.x = -s * swing * 0.8;
    armR.rotation.x = s * swing * 0.8;
    // Coudes souples, plus pliés quand le bras part vers l'avant ; avant-bras
    // droit tendu s'il tient une arme (accrochée au bras, voir remotes.js)
    foreL.rotation.x = 0.12 + Math.max(0, -s) * swing * 0.6;
    foreR.rotation.x = armR.children.some((c) => !c.isBone) ? 0 : 0.12 + Math.max(0, s) * swing * 0.6;
    // Léger rebond du corps
    group.position.y = group.userData.baseY ?? 0;
    if (speed > 0.5) {
      group.position.y += Math.abs(Math.cos(t)) * 0.03;
    }
  }

  // Ombres portées (sans effet si les ombres sont désactivées)
  group.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = true;
      // pas d'ombres REÇUES : sur des volumes aussi fins (nez, orbites), la
      // carte d'ombre faisait des taches sombres sur les joues
      o.receiveShadow = false;
    }
  });

  return {
    group,
    head: body,   // os du tronc (tête et torse ne font qu'un)
    torso: body,
    mesh,
    // Cibles de tir : le corps et les jambes (mêmes volumes qu'avant, en
    // moins de morceaux — les dégâts n'ont jamais dépendu de la pièce
    // touchée).
    hitMeshes: [mesh],
    // Teinte l'humain ENTIER : la couleur du matériau multiplie les couleurs
    // de sommets. `shirtMat.color.set(rouge)` marche donc comme avant pour un
    // flash de dégâts — mais pour revenir à la normale il faut clearTint(),
    // PAS `.copy(couleurDeBase)` qui appliquerait la teinte deux fois.
    shirtMat: bodyMat,
    clearTint() { bodyMat.color.setHex(0xffffff); },
    animate,
    // Pivot de l'épaule droite : point d'accroche pour une arme tenue en
    // main (voir player/remotes.js), suit le balancement de marche.
    armR,
    armL, // pivot de l'épaule gauche (fans du concert : bras en l'air)
    foreL, foreR, // pivots des coudes
    legL, legR, kneeL, kneeR, // hanches ; genoux (variante assise seulement)
  };
}
