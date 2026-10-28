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
// PERF : 7 meshes par humain (un corps, deux jambes, deux bras et deux
// avant-bras articulés au coude). Les formes ne sont calculées qu'UNE fois par modèle (cache) : tous
// les humains partagent positions, normales et index sur le GPU, seules
// leurs couleurs de sommets diffèrent (voir paint()). Grille plus fine au
// palier Élevé, plus grossière (moins de triangles) ailleurs.
// Tous les meshes d'un humain partagent UN matériau : `shirtMat` le teinte
// en entier (flash de dégâts).

// Teintes (slots) des volumes
const SHIRT = 0, SHIRT_DARK = 1, PANTS = 2, SKIN = 3, SKIN_DARK = 4, HAIR = 5,
  SHOE = 6, SOLE = 7, BELT = 8, METAL = 9, WHITE = 10, EYE = 11, LIP = 12, CAP = 13;

const cache = new Map();
function cached(key, build) {
  if (!cache.has(key)) cache.set(key, build());
  return cache.get(key);
}
const cellSize = () => (detail.high ? 0.023 : 0.038);

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

// Tronc, bassin, cou, tête et coiffure (un seul volume)
function bodyShape(look) {
  const p = [
    // Bassin + ceinture
    { t: 'ell', c: [0, 0.89, 0.005], r: [0.175, 0.12, 0.115], slot: PANTS, k: 0.03 },
    { t: 'ell', c: [0, 0.985, 0.003], r: [0.184, 0.03, 0.124], slot: BELT, k: 0.004 },
    // Taille, cage thoracique, pectoraux, dos, épaules
    { t: 'ell', c: [0, 1.09, 0], r: [0.158, 0.13, 0.1], slot: SHIRT, k: 0.04 },
    { t: 'ell', c: [0, 1.28, 0.0], r: [0.19, 0.17, 0.118], slot: SHIRT, k: 0.06 },
    { t: 'ell', c: [-0.072, 1.3, -0.05], r: [0.08, 0.062, 0.055], slot: SHIRT, k: 0.05 },
    { t: 'ell', c: [0.072, 1.3, -0.05], r: [0.08, 0.062, 0.055], slot: SHIRT, k: 0.05 },
    { t: 'ell', c: [0, 1.3, 0.045], r: [0.175, 0.16, 0.085], slot: SHIRT, k: 0.05 },
    { t: 'cone', a: [-0.18, 1.39, 0.008], b: [0.18, 1.39, 0.008], r1: 0.066, r2: 0.066, slot: SHIRT, k: 0.1 },
    { t: 'cone', a: [-0.07, 1.44, 0.02], b: [0.07, 1.44, 0.02], r1: 0.05, r2: 0.05, slot: SHIRT, k: 0.08 }, // trapèzes
    // Col + cou
    { t: 'cone', a: [0, 1.45, 0.012], b: [0, 1.585, 0.0], r1: 0.054, r2: 0.05, slot: SKIN, k: 0.02 },
    // Tête : crâne, mâchoire, menton, pommettes, arcades, nez, oreilles
    { t: 'ell', c: [0, 1.678, 0.008], r: [0.093, 0.112, 0.104], slot: SKIN, k: 0.03 },
    { t: 'ell', c: [0, 1.605, -0.03], r: [0.072, 0.058, 0.072], slot: SKIN, k: 0.05 },
    { t: 'ell', c: [0, 1.572, -0.072], r: [0.03, 0.026, 0.028], slot: SKIN, k: 0.03 },
    { t: 'ell', c: [-0.052, 1.648, -0.075], r: [0.03, 0.022, 0.025], slot: SKIN, k: 0.025 },
    { t: 'ell', c: [0.052, 1.648, -0.075], r: [0.03, 0.022, 0.025], slot: SKIN, k: 0.025 },
    { t: 'cone', a: [-0.05, 1.703, -0.088], b: [0.05, 1.703, -0.088], r1: 0.016, r2: 0.016, slot: SKIN, k: 0.02 },
    { t: 'cone', a: [0, 1.682, -0.1], b: [0, 1.632, -0.124], r1: 0.011, r2: 0.017, slot: SKIN, k: 0.012 },
    { t: 'ell', c: [-0.094, 1.665, 0.012], r: [0.014, 0.032, 0.022], slot: SKIN_DARK, k: 0.01 },
    { t: 'ell', c: [0.094, 1.665, 0.012], r: [0.014, 0.032, 0.022], slot: SKIN_DARK, k: 0.01 },
    // Orbites légèrement creusées
    { t: 'sphere', c: [-0.038, 1.68, -0.106], r: 0.02, sub: true, k: 0.014 },
    { t: 'sphere', c: [0.038, 1.68, -0.106], r: 0.02, sub: true, k: 0.014 },
  ];
  // Calotte de cheveux : en retrait du front, couvre le haut et la nuque
  p.push({ t: 'ell', c: [0, 1.722, 0.006], r: [0.1, 0.088, 0.11], slot: look === 'casquette' ? CAP : HAIR, k: 0.012 });
  if (look === 'casquette') {
    p.push({ t: 'ell', c: [0, 1.718, 0.012], r: [0.106, 0.072, 0.112], slot: CAP, k: 0.01 });
    p.push({ t: 'ell', c: [0, 1.725, -0.112], r: [0.082, 0.011, 0.068], slot: CAP, k: 0.012 });
    p.push({ t: 'ell', c: [0, 1.665, 0.045], r: [0.088, 0.05, 0.075], slot: HAIR, k: 0.02 }); // nuque
  } else if (look === 'long') {
    p.push({ t: 'ell', c: [0, 1.6, 0.052], r: [0.11, 0.15, 0.07], slot: HAIR, k: 0.04 });
    p.push({ t: 'ell', c: [-0.085, 1.62, 0.0], r: [0.035, 0.1, 0.06], slot: HAIR, k: 0.03 });
    p.push({ t: 'ell', c: [0.085, 1.62, 0.0], r: [0.035, 0.1, 0.06], slot: HAIR, k: 0.03 });
  } else {
    p.push({ t: 'ell', c: [0, 1.645, 0.045], r: [0.09, 0.07, 0.07], slot: HAIR, k: 0.02 }); // nuque
  }
  return p;
}

// Détails trop fins pour la grille : yeux, pupilles, sourcils, bouche, boucle
function faceDetails() {
  const at = (x, y, z, sx = 1, sy = 1, sz = 1, rz = 0) => new THREE.Matrix4().compose(
    new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, rz)), new THREE.Vector3(sx, sy, sz));
  const eye = new THREE.SphereGeometry(0.0145, 10, 8);
  const pupil = new THREE.SphereGeometry(0.0085, 8, 6);
  const brow = new THREE.BoxGeometry(0.044, 0.01, 0.012);
  const lip = new THREE.BoxGeometry(0.046, 0.011, 0.012);
  const buckle = new THREE.BoxGeometry(0.055, 0.036, 0.016);
  return [
    { geometry: eye, slot: WHITE, matrix: at(-0.038, 1.68, -0.092, 1, 0.8, 0.7) },
    { geometry: eye, slot: WHITE, matrix: at(0.038, 1.68, -0.092, 1, 0.8, 0.7) },
    { geometry: pupil, slot: EYE, matrix: at(-0.038, 1.68, -0.1, 1, 1, 0.6) },
    { geometry: pupil, slot: EYE, matrix: at(0.038, 1.68, -0.1, 1, 1, 0.6) },
    { geometry: brow, slot: HAIR, matrix: at(-0.04, 1.707, -0.1, 1, 1, 1, 0.12) },
    { geometry: brow, slot: HAIR, matrix: at(0.04, 1.707, -0.1, 1, 1, 1, -0.12) },
    { geometry: lip, slot: LIP, matrix: at(0, 1.598, -0.103) },
    { geometry: buckle, slot: METAL, matrix: at(0, 0.985, -0.112) },
  ];
}

const legGeo = () => cached(`jambe|${cellSize()}`, () => sculpt(legShape(), { cell: cellSize() }));
// Bras en DEUX pièces articulées au coude (ELBOW, repère de l'épaule) :
// le bras (épaule → coude) et l'avant-bras (coude → main), qui partagent
// la boule du coude pour que la jointure reste pleine quand il se plie
const ELBOW = [0, -0.285, 0.006];
function shiftPrim(p, d) {
  const q = { ...p };
  for (const k of ['c', 'a', 'b']) if (q[k]) q[k] = [q[k][0] - d[0], q[k][1] - d[1], q[k][2] - d[2]];
  return q;
}
const armGeo = (s) => cached(`bras${s}|${cellSize()}`, () => sculpt(armShape(s).slice(0, 4), { cell: cellSize() }));
const foreGeo = (s) => cached(`avantbras${s}|${cellSize()}`,
  () => sculpt(armShape(s).slice(3).map((p) => shiftPrim(p, ELBOW)), { cell: cellSize() }));
const bodyGeo = (look) => cached(`corps|${look}|${cellSize()}`,
  () => withDetails(sculpt(bodyShape(look), { cell: cellSize() }), faceDetails()));

export function buildHuman({ shirt = 0x6b7a8f, pants = 0x39404e, skin = 0xe8c39e, hair = 0x3a2c1e, style } = {}) {
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
  palette[WHITE] = C(0xf2efe8);
  palette[EYE] = C(0x1b1d22);
  palette[LIP] = C(skin).lerp(C(0xa0473d), 0.45);
  palette[CAP] = C(shirt).multiplyScalar(0.72);
  // Coiffure stable pour une même tenue (déterministe) : courte, casquette
  // (gone du quartier) ou longue
  const look = style ?? ['court', 'casquette', 'long'][(shirt ^ (pants >> 3) ^ (hair << 1)) % 3];

  const limb = (geo, x, y) => {
    const pivot = new THREE.Group();
    pivot.position.set(x, y, 0);
    pivot.add(new THREE.Mesh(paint(geo, palette), bodyMat));
    group.add(pivot);
    return pivot;
  };
  // Jambes (pivot à la hanche), bras (pivot à l'épaule)
  const legL = limb(legGeo(), -0.105, 0.86);
  const legR = limb(legGeo(), 0.105, 0.86);
  const armL = limb(armGeo(-1), -0.255, 1.41);
  const armR = limb(armGeo(1), 0.255, 1.41);
  // Avant-bras : pivot au coude, enfant du bras (rotation.x > 0 = plie
  // le coude vers l'avant)
  const fore = (arm, s) => {
    const pivot = new THREE.Group();
    pivot.position.set(...ELBOW);
    pivot.add(new THREE.Mesh(paint(foreGeo(s), palette), bodyMat));
    arm.add(pivot);
    return pivot;
  };
  const foreL = fore(armL, -1);
  const foreR = fore(armR, 1);
  // Tronc, tête, coiffure : rien ne bouge l'un par rapport à l'autre
  const body = new THREE.Mesh(paint(bodyGeo(look), palette), bodyMat);
  group.add(body);

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
    foreR.rotation.x = armR.children.length > 2 ? 0 : 0.12 + Math.max(0, s) * swing * 0.6;
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
      o.receiveShadow = true;
    }
  });

  return {
    group,
    head: body,   // la tête fait partie du mesh du corps
    torso: body,
    // Cibles de tir : le corps et les jambes (mêmes volumes qu'avant, en
    // moins de morceaux — les dégâts n'ont jamais dépendu de la pièce
    // touchée).
    hitMeshes: [body, legL.children[0], legR.children[0]],
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
  };
}
