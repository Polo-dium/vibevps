import * as THREE from 'three';
import { detail } from '../render/detail.js';
import { sculpt, paint } from '../render/sculpt.js';

// LE ROI DE BRONZE de Bellecour, sculpté d'un seul tenant (render/sculpt.js)
// au lieu d'un assemblage de capsules : un cheval au pas, l'antérieur droit
// levé, encolure puissante et crinière, croupe et jarrets dessinés ; Louis
// XIV à cru en costume romain, perruque bouclée, cape qui retombe sur la
// croupe, bâton de commandement tendu vers l'avant.
//
// Repère local : le cheval regarde vers +x, sabots à y = 0, ~3,6 m de haut
// (la statue est ensuite agrandie et posée sur son piédestal par city.js).
// Un seul mesh, calculé une fois au chargement.

const BRONZE = 0, DARK = 1;

function horse() {
  const p = [
    // Tronc : ventre, poitrail, garrot, croupe et cuisses
    { t: 'ell', c: [0, 1.66, 0], r: [1.0, 0.5, 0.42], k: 0.25 },
    { t: 'ell', c: [0.92, 1.62, 0], r: [0.42, 0.5, 0.38], k: 0.25 },
    { t: 'ell', c: [0.68, 2.02, 0], r: [0.34, 0.2, 0.17], k: 0.2 },
    { t: 'ell', c: [-0.92, 1.76, 0], r: [0.48, 0.46, 0.4], k: 0.22 },
    { t: 'ell', c: [-0.98, 1.58, 0.2], r: [0.38, 0.44, 0.2], k: 0.15 },
    { t: 'ell', c: [-0.98, 1.58, -0.2], r: [0.38, 0.44, 0.2], k: 0.15 },
    { t: 'ell', c: [0.85, 1.5, 0.21], r: [0.26, 0.3, 0.15], k: 0.12 }, // épaules
    { t: 'ell', c: [0.85, 1.5, -0.21], r: [0.26, 0.3, 0.15], k: 0.12 },
    // Encolure arquée + crinière
    { t: 'cone', a: [0.95, 1.95, 0], b: [1.42, 2.62, 0], r1: 0.36, r2: 0.22, k: 0.2 },
    { t: 'cone', a: [1.42, 2.62, 0], b: [1.6, 2.86, 0], r1: 0.22, r2: 0.17, k: 0.12 },
    { t: 'cone', a: [0.78, 2.2, 0], b: [1.36, 2.92, 0], r1: 0.1, r2: 0.08, slot: DARK, k: 0.08 },
    { t: 'cone', a: [1.36, 2.92, 0], b: [1.62, 3.08, 0], r1: 0.08, r2: 0.06, slot: DARK, k: 0.06 },
    // Tête inclinée : ganache, chanfrein, bout du nez, oreilles
    { t: 'ell', c: [1.72, 2.8, 0], r: [0.2, 0.17, 0.14], k: 0.08 },
    { t: 'cone', a: [1.75, 2.82, 0], b: [2.18, 2.42, 0], r1: 0.14, r2: 0.1, k: 0.08 },
    { t: 'ell', c: [2.18, 2.38, 0], r: [0.13, 0.11, 0.11], k: 0.06 },
    { t: 'cone', a: [1.66, 2.98, 0.07], b: [1.6, 3.16, 0.09], r1: 0.045, r2: 0.014, k: 0.02 },
    { t: 'cone', a: [1.66, 2.98, -0.07], b: [1.6, 3.16, -0.09], r1: 0.045, r2: 0.014, k: 0.02 },
    { t: 'cone', a: [1.6, 3.0, 0], b: [1.78, 2.9, 0], r1: 0.05, r2: 0.03, slot: DARK, k: 0.03 }, // toupet
    // Yeux et naseaux creusés
    { t: 'sphere', c: [1.8, 2.8, 0.14], r: 0.035, sub: true, k: 0.02 },
    { t: 'sphere', c: [1.8, 2.8, -0.14], r: 0.035, sub: true, k: 0.02 },
    { t: 'sphere', c: [2.27, 2.36, 0.07], r: 0.03, sub: true, k: 0.02 },
    { t: 'sphere', c: [2.27, 2.36, -0.07], r: 0.03, sub: true, k: 0.02 },
    // Queue tombante, épaisse à la base
    { t: 'cone', a: [-1.36, 1.98, 0], b: [-1.6, 1.62, 0], r1: 0.1, r2: 0.13, slot: DARK, k: 0.08 },
    { t: 'cone', a: [-1.6, 1.62, 0], b: [-1.62, 0.95, 0.02], r1: 0.13, r2: 0.07, slot: DARK, k: 0.06 },
  ];
  // Jambe complète : avant-bras/cuisse, genou/jarret, canon, boulet,
  // paturon, sabot. `pts` = articulations de haut en bas.
  const leg = (pts, rads) => {
    for (let i = 0; i < pts.length - 1; i++) {
      p.push({ t: 'cone', a: pts[i], b: pts[i + 1], r1: rads[i], r2: rads[i + 1], k: i === 0 ? 0.14 : 0.04 });
    }
    for (let i = 1; i < pts.length - 2; i++) p.push({ t: 'sphere', c: pts[i], r: rads[i] * 1.12, k: 0.04 });
    const h = pts[pts.length - 1];
    p.push({ t: 'cone', a: [h[0] - 0.01, h[1] + 0.1, h[2]], b: [h[0] + 0.02, h[1] - 0.02, h[2]], r1: 0.075, r2: 0.1, slot: DARK, k: 0.02 });
  };
  // Antérieur gauche, à l'appui (z > 0 = côté gauche du cheval)
  leg([[0.9, 1.45, 0.2], [0.94, 0.82, 0.2], [0.95, 0.3, 0.2], [0.98, 0.17, 0.2], [1.02, 0.07, 0.2]],
    [0.17, 0.085, 0.06, 0.07, 0.06]);
  // Antérieur droit LEVÉ : genou en avant, canon replié vers l'arrière
  leg([[0.9, 1.45, -0.2], [1.26, 1.02, -0.22], [1.08, 0.62, -0.22], [1.04, 0.52, -0.22], [1.1, 0.42, -0.22]],
    [0.17, 0.085, 0.06, 0.07, 0.06]);
  // Postérieurs : grasset, jarret coudé, canon vertical
  leg([[-0.98, 1.5, 0.22], [-1.18, 0.95, 0.22], [-1.14, 0.3, 0.22], [-1.1, 0.17, 0.22], [-1.06, 0.07, 0.22]],
    [0.2, 0.095, 0.06, 0.07, 0.06]);
  leg([[-0.98, 1.5, -0.22], [-1.08, 0.98, -0.22], [-0.95, 0.32, -0.22], [-0.9, 0.18, -0.22], [-0.86, 0.07, -0.22]],
    [0.2, 0.095, 0.06, 0.07, 0.06]);
  // Sabots arasés au sol
  p.push({ t: 'plane', h: 0, sub: true, k: 0.01 });
  return p;
}

function rider() {
  return [
    // Assise et cuisses enveloppant le dos du cheval
    { t: 'ell', c: [0.05, 2.28, 0], r: [0.24, 0.16, 0.26], k: 0.06 },
    { t: 'cone', a: [0.05, 2.28, 0.26], b: [0.42, 1.98, 0.47], r1: 0.13, r2: 0.095, k: 0.06 },
    { t: 'cone', a: [0.05, 2.28, -0.26], b: [0.42, 1.98, -0.47], r1: 0.13, r2: 0.095, k: 0.06 },
    { t: 'cone', a: [0.42, 1.98, 0.47], b: [0.28, 1.45, 0.45], r1: 0.09, r2: 0.065, k: 0.04 },
    { t: 'cone', a: [0.42, 1.98, -0.47], b: [0.28, 1.45, -0.45], r1: 0.09, r2: 0.065, k: 0.04 },
    { t: 'ell', c: [0.36, 1.38, 0.45], r: [0.12, 0.05, 0.055], k: 0.04 },
    { t: 'ell', c: [0.36, 1.38, -0.45], r: [0.12, 0.05, 0.055], k: 0.04 },
    // Buste en cuirasse romaine, droit et cambré
    { t: 'ell', c: [0.04, 2.62, 0], r: [0.19, 0.3, 0.25], k: 0.08 },
    { t: 'ell', c: [0.1, 2.84, 0], r: [0.17, 0.18, 0.27], k: 0.08 },
    { t: 'ell', c: [0.05, 2.4, 0], r: [0.2, 0.08, 0.27], slot: DARK, k: 0.03 }, // lambrequins
    // Cape : du dos à la croupe
    { t: 'ell', c: [-0.14, 2.7, 0], r: [0.06, 0.32, 0.26], slot: DARK, k: 0.05 },
    { t: 'ell', c: [-0.4, 2.3, 0], r: [0.24, 0.07, 0.3], rot: [0, 0, -0.7], slot: DARK, k: 0.08 },
    // Cou, tête, nez, grande perruque bouclée sur les épaules
    { t: 'cone', a: [0.08, 3.0, 0], b: [0.1, 3.2, 0], r1: 0.085, r2: 0.075, k: 0.04 },
    { t: 'ell', c: [0.13, 3.33, 0], r: [0.14, 0.17, 0.13], k: 0.04 },
    { t: 'cone', a: [0.26, 3.36, 0], b: [0.3, 3.3, 0], r1: 0.025, r2: 0.035, k: 0.02 },
    { t: 'ell', c: [0.02, 3.38, 0], r: [0.17, 0.2, 0.18], slot: DARK, k: 0.03 },
    { t: 'ell', c: [-0.02, 3.16, 0.13], r: [0.1, 0.16, 0.08], slot: DARK, k: 0.05 },
    { t: 'ell', c: [-0.02, 3.16, -0.13], r: [0.1, 0.16, 0.08], slot: DARK, k: 0.05 },
    { t: 'ell', c: [-0.08, 3.2, 0], r: [0.08, 0.17, 0.14], slot: DARK, k: 0.05 },
    // Couronne de laurier
    { t: 'ell', c: [0.05, 3.45, 0], r: [0.15, 0.03, 0.15], slot: DARK, k: 0.01 },
    // Bras droit tendu, bâton de commandement vers l'avant
    { t: 'sphere', c: [0.08, 2.96, -0.26], r: 0.1, k: 0.06 },
    { t: 'cone', a: [0.08, 2.96, -0.28], b: [0.34, 2.82, -0.42], r1: 0.08, r2: 0.065, k: 0.04 },
    { t: 'cone', a: [0.34, 2.82, -0.42], b: [0.64, 3.0, -0.46], r1: 0.065, r2: 0.05, k: 0.03 },
    { t: 'sphere', c: [0.69, 3.03, -0.46], r: 0.058, k: 0.03 },
    { t: 'cone', a: [0.6, 2.92, -0.46], b: [0.98, 3.32, -0.48], r1: 0.032, r2: 0.028, k: 0.01 },
    // Bras gauche : rênes en main au-dessus du garrot
    { t: 'sphere', c: [0.08, 2.96, 0.26], r: 0.1, k: 0.06 },
    { t: 'cone', a: [0.08, 2.96, 0.28], b: [0.2, 2.66, 0.38], r1: 0.08, r2: 0.065, k: 0.04 },
    { t: 'cone', a: [0.2, 2.66, 0.38], b: [0.46, 2.52, 0.2], r1: 0.065, r2: 0.05, k: 0.03 },
    { t: 'sphere', c: [0.5, 2.5, 0.18], r: 0.058, k: 0.03 },
  ];
}

export function buildRoyalStatue() {
  // Bronze à patine sombre : PBR métallique, il renvoie le ciel
  // (scene.environment) — reflets mobiles le long des courbes
  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true, metalness: 0.72, roughness: 0.4,
  });
  const cell = detail.high ? 0.028 : 0.045;
  const geo = paint(sculpt([...horse(), ...rider()], { cell }), [
    new THREE.Color(0x5d7462), // bronze vert-de-gris
    new THREE.Color(0x3f5145), // crinière, queue, perruque, cape : plus sombres
  ]);
  const mesh = new THREE.Mesh(geo, mat);
  const group = new THREE.Group();
  group.add(mesh);
  return group;
}

// SAINT-EXUPÉRY ET LE PETIT PRINCE (colonne de Bellecour) : l'aviateur assis
// au sommet, avant-bras sur les genoux, regard au loin ; le Petit Prince
// debout derrière lui, main posée sur son épaule, grande écharpe au vent.
// Repère : centre du sommet de la colonne à l'origine, regard vers -z.
function aviator() {
  return [
    // Bassin assis + cuisses vers l'avant, tibias qui pendent
    { t: 'ell', c: [0, 0.14, 0.05], r: [0.2, 0.13, 0.16], k: 0.06 },
    { t: 'cone', a: [-0.1, 0.16, 0.0], b: [-0.12, 0.2, -0.4], r1: 0.1, r2: 0.075, k: 0.05 },
    { t: 'cone', a: [0.1, 0.16, 0.0], b: [0.12, 0.2, -0.4], r1: 0.1, r2: 0.075, k: 0.05 },
    { t: 'sphere', c: [-0.12, 0.2, -0.41], r: 0.07, k: 0.03 },
    { t: 'sphere', c: [0.12, 0.2, -0.41], r: 0.07, k: 0.03 },
    { t: 'cone', a: [-0.12, 0.18, -0.42], b: [-0.12, -0.24, -0.44], r1: 0.065, r2: 0.05, k: 0.03 },
    { t: 'cone', a: [0.12, 0.18, -0.42], b: [0.12, -0.24, -0.44], r1: 0.065, r2: 0.05, k: 0.03 },
    { t: 'ell', c: [-0.12, -0.27, -0.5], r: [0.055, 0.045, 0.11], k: 0.03 },
    { t: 'ell', c: [0.12, -0.27, -0.5], r: [0.055, 0.045, 0.11], k: 0.03 },
    // Buste un peu penché en avant, veste d'aviateur
    { t: 'ell', c: [0, 0.45, -0.03], r: [0.2, 0.26, 0.15], k: 0.08 },
    { t: 'ell', c: [0, 0.62, -0.05], r: [0.22, 0.13, 0.15], k: 0.08 },
    // Cou, tête, casque de cuir à oreillettes
    { t: 'cone', a: [0, 0.72, -0.06], b: [0, 0.82, -0.09], r1: 0.06, r2: 0.055, k: 0.03 },
    { t: 'ell', c: [0, 0.92, -0.1], r: [0.095, 0.115, 0.105], k: 0.03 },
    { t: 'cone', a: [0, 0.92, -0.2], b: [0, 0.89, -0.225], r1: 0.014, r2: 0.022, k: 0.012 },
    { t: 'ell', c: [0, 0.96, -0.09], r: [0.105, 0.09, 0.11], slot: DARK, k: 0.01 },
    { t: 'ell', c: [-0.095, 0.9, -0.09], r: [0.025, 0.06, 0.04], slot: DARK, k: 0.01 },
    { t: 'ell', c: [0.095, 0.9, -0.09], r: [0.025, 0.06, 0.04], slot: DARK, k: 0.01 },
    // Bras : épaule, coude posé sur le genou, mains jointes devant
    { t: 'cone', a: [-0.21, 0.62, -0.04], b: [-0.18, 0.32, -0.3], r1: 0.07, r2: 0.055, k: 0.05 },
    { t: 'cone', a: [0.21, 0.62, -0.04], b: [0.18, 0.32, -0.3], r1: 0.07, r2: 0.055, k: 0.05 },
    { t: 'cone', a: [-0.18, 0.32, -0.3], b: [-0.04, 0.34, -0.5], r1: 0.05, r2: 0.04, k: 0.03 },
    { t: 'cone', a: [0.18, 0.32, -0.3], b: [0.04, 0.34, -0.5], r1: 0.05, r2: 0.04, k: 0.03 },
    { t: 'ell', c: [0, 0.34, -0.53], r: [0.07, 0.04, 0.05], k: 0.03 },
  ];
}

function littlePrince() {
  // Debout derrière l'aviateur, plus petit (~1 m), sur le rebord
  const o = [0.12, 0, 0.32];
  const P = (x, y, z) => [x + o[0], y + o[1], z + o[2]];
  return [
    { t: 'cone', a: P(-0.06, 0.0, 0), b: P(-0.05, 0.4, 0), r1: 0.045, r2: 0.055, slot: DARK, k: 0.03 },
    { t: 'cone', a: P(0.06, 0.0, 0), b: P(0.05, 0.4, 0), r1: 0.045, r2: 0.055, slot: DARK, k: 0.03 },
    // Manteau long évasé
    { t: 'cone', a: P(0, 0.78, 0), b: P(0, 0.34, 0.01), r1: 0.085, r2: 0.13, slot: DARK, k: 0.04 },
    { t: 'cone', a: P(0, 0.8, 0), b: P(0, 0.9, 0), r1: 0.04, r2: 0.035, slot: DARK, k: 0.02 },
    { t: 'ell', c: P(0, 0.99, 0), r: [0.08, 0.09, 0.08], slot: DARK, k: 0.02 },
    // Cheveux en mèches dressées
    { t: 'cone', a: P(-0.02, 1.05, 0), b: P(-0.07, 1.13, 0.02), r1: 0.03, r2: 0.008, slot: DARK, k: 0.02 },
    { t: 'cone', a: P(0.02, 1.05, 0), b: P(0.06, 1.14, -0.01), r1: 0.03, r2: 0.008, slot: DARK, k: 0.02 },
    { t: 'cone', a: P(0, 1.06, 0.03), b: P(0.0, 1.15, 0.06), r1: 0.03, r2: 0.008, slot: DARK, k: 0.02 },
    // Écharpe qui flotte en arrière
    { t: 'ell', c: P(0.05, 0.83, 0.02), r: [0.07, 0.03, 0.075], slot: DARK, k: 0.02 },
    { t: 'ell', c: P(0.2, 0.8, 0.14), r: [0.16, 0.025, 0.05], rot: [0, -0.7, -0.25], slot: DARK, k: 0.03 },
    // Bras droit posé sur l'épaule de l'aviateur
    { t: 'cone', a: P(-0.09, 0.74, 0), b: P(-0.22, 0.66, -0.2), r1: 0.035, r2: 0.03, slot: DARK, k: 0.03 },
    { t: 'cone', a: P(0.09, 0.74, 0), b: P(0.12, 0.5, 0.02), r1: 0.035, r2: 0.03, slot: DARK, k: 0.03 },
  ];
}

export function buildSaintExupery() {
  const cell = detail.high ? 0.02 : 0.032;
  const bronze = new THREE.Mesh(
    paint(sculpt(aviator(), { cell }), [new THREE.Color(0x5d7462), new THREE.Color(0x3f5145)]),
    new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.72, roughness: 0.4 })
  );
  // Le Petit Prince est doré (comme sur la vraie colonne)
  const gold = new THREE.Mesh(
    sculpt(littlePrince(), { cell }),
    new THREE.MeshStandardMaterial({ color: 0xd9b34a, metalness: 0.9, roughness: 0.3, emissive: 0x2a1e06 })
  );
  const group = new THREE.Group();
  group.add(bronze, gold);
  return group;
}
