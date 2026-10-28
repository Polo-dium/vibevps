import * as THREE from 'three';
import { detail } from '../render/detail.js';
import { sculpt, withDetails, paint, field, onSurface } from '../render/sculpt.js';

// LA CHANTEUSE des clips (« Accept All », « Call Me I, Call Me It »),
// sculptée (render/sculpt.js) d'après les rushs : carré blond platine à
// frange droite, haut blanc zippé à col montant, bretelles-harnais noires,
// badge orange sur cordon, jupe noire courte, bottes hautes noires.
//
// Origine aux pieds, ~1,68 m, regard vers -z. Pièces articulées : corps,
// tête (pivot au cou), bras droit qui tient le micro, bras gauche libre,
// bouche (s'ouvre avec la voix, voir world/concert.js).

const WHITE = 0, WHITE_DARK = 1, BLACK = 2, SKIN = 3, SKIN_DARK = 4, HAIR = 5,
  ORANGE = 6, METAL = 7, EYE_W = 8, EYE = 9, LIP = 10, BROW = 11;

const PALETTE = [];
PALETTE[WHITE] = new THREE.Color(0xeeeae2);
PALETTE[WHITE_DARK] = new THREE.Color(0xc9c4ba);
PALETTE[BLACK] = new THREE.Color(0x17171a);
PALETTE[SKIN] = new THREE.Color(0xf0cdb4);
PALETTE[SKIN_DARK] = new THREE.Color(0xd9ad94);
PALETTE[HAIR] = new THREE.Color(0xf6efd9);
PALETTE[ORANGE] = new THREE.Color(0xff7a1a);
PALETTE[METAL] = new THREE.Color(0xb9bcc2);
PALETTE[EYE_W] = new THREE.Color(0xf4f1ec);
PALETTE[EYE] = new THREE.Color(0x3a4a52);
PALETTE[LIP] = new THREE.Color(0xc77d77);
PALETTE[BROW] = new THREE.Color(0xb59a72);

const NECK_Y = 1.43; // pivot de la tête
const SHOULDER = { x: 0.165, y: 1.36 };

function bodyShape() {
  // Bassin + jupe courte : arasée net au-dessus du genou (la coupe ne touche
  // que ce qui précède — les jambes sont ajoutées après)
  const s = [
    { t: 'ell', c: [0, 0.91, 0.005], r: [0.148, 0.1, 0.105], slot: BLACK, k: 0.04 },
    { t: 'ell', c: [0, 0.845, 0.0], r: [0.16, 0.075, 0.122], slot: BLACK, k: 0.05 },
    { t: 'plane', h: 0.79, sub: true, k: 0.008 },
    // Bottes hautes + jambes nues au-dessus du genou
    ...[-1, 1].flatMap((side) => {
      const x = side * 0.085;
      return [
        { t: 'box', c: [x, 0.045, -0.035], h: [0.042, 0.04, 0.1], round: 0.03, slot: BLACK, k: 0.02 },
        { t: 'cone', a: [x, 0.07, 0.0], b: [x, 0.47, 0.005], r1: 0.046, r2: 0.05, slot: BLACK, k: 0.03 },
        { t: 'ell', c: [x, 0.3, 0.018], r: [0.045, 0.08, 0.044], slot: BLACK, k: 0.04 }, // mollet
        { t: 'cone', a: [x, 0.47, 0.005], b: [x * 0.95, 0.86, 0.0], r1: 0.048, r2: 0.07, slot: SKIN, k: 0.03 },
      ];
    }),
    { t: 'plane', h: 0.0, sub: true, k: 0.005 },
    // Taille fine, buste, épaules : haut blanc zippé
    { t: 'ell', c: [0, 1.06, 0.0], r: [0.118, 0.11, 0.085], slot: WHITE, k: 0.05 },
    { t: 'ell', c: [0, 1.22, 0.0], r: [0.145, 0.14, 0.095], slot: WHITE, k: 0.06 },
    { t: 'ell', c: [-0.055, 1.22, -0.05], r: [0.06, 0.055, 0.05], slot: WHITE, k: 0.04 },
    { t: 'ell', c: [0.055, 1.22, -0.05], r: [0.06, 0.055, 0.05], slot: WHITE, k: 0.04 },
    { t: 'cone', a: [-0.15, 1.34, 0.0], b: [0.15, 1.34, 0.0], r1: 0.055, r2: 0.055, slot: WHITE, k: 0.08 },
    // Col montant
    { t: 'cone', a: [0, 1.36, 0.0], b: [0, 1.45, 0.0], r1: 0.068, r2: 0.06, slot: WHITE, k: 0.03 },
  ];
  // Bretelles-harnais et cordon du badge : posés PILE sur le buste (projetés
  // sur la surface, puis légèrement en relief) — sinon leur teinte bave
  const f = field(s);
  const strap = (pts, r, slot) => {
    const q = pts.map((p) => onSurface(f, p, r * 0.55));
    for (let i = 0; i + 1 < q.length; i++) {
      s.push({ t: 'cone', a: q[i], b: q[i + 1], r1: r, r2: r, slot, k: 0.004 });
    }
  };
  for (const side of [-1, 1]) {
    strap([[side * 0.1, 1.39, 0], [side * 0.092, 1.33, -0.1], [side * 0.085, 1.24, -0.12], [side * 0.078, 1.12, -0.11], [side * 0.072, 0.99, -0.1]], 0.011, BLACK);
    strap([[side * 0.1, 1.39, 0], [side * 0.09, 1.3, 0.1], [side * 0.075, 1.12, 0.1], [side * 0.07, 0.99, 0.1]], 0.011, BLACK);
    strap([[side * 0.058, 1.41, -0.03], [side * 0.045, 1.33, -0.09], [side * 0.012, 1.2, -0.12]], 0.0045, ORANGE);
  }
  return s;
}

// Badge, fermeture éclair, boucles : posés sur la surface du buste
function bodyDetails(shape) {
  const f = field(shape);
  const at = (x, y, z, lift, rx = 0) => new THREE.Matrix4().compose(
    new THREE.Vector3(...onSurface(f, [x, y, z], lift)),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, 0, 0)), new THREE.Vector3(1, 1, 1));
  return [
    { geometry: new THREE.BoxGeometry(0.058, 0.08, 0.008), slot: ORANGE, matrix: at(0, 1.15, -0.12, 0.008, -0.1) }, // badge
    { geometry: new THREE.BoxGeometry(0.04, 0.03, 0.006), slot: WHITE, matrix: at(0, 1.16, -0.12, 0.0125, -0.1) }, // carte
    { geometry: new THREE.BoxGeometry(0.006, 0.36, 0.006), slot: WHITE_DARK, matrix: at(0, 1.2, -0.12, 0.002) }, // fermeture éclair
    { geometry: new THREE.BoxGeometry(0.03, 0.022, 0.01), slot: METAL, matrix: at(-0.085, 1.24, -0.12, 0.016) }, // boucles
    { geometry: new THREE.BoxGeometry(0.03, 0.022, 0.01), slot: METAL, matrix: at(0.085, 1.24, -0.12, 0.016) },
  ];
}

// Tête dans le repère du pivot du cou (y = 0 au cou)
function headShape() {
  const y = (v) => v - NECK_Y;
  return [
    // CARRÉ : volume de cheveux arasé au menton, puis visage dégagé sous une
    // frange bien droite (soustractions : n'entament que les cheveux, le
    // visage est ajouté ensuite)
    { t: 'ell', c: [0, y(1.575), 0.01], r: [0.104, 0.12, 0.116], slot: HAIR, k: 0.02 },
    { t: 'ell', c: [0, y(1.5), 0.02], r: [0.112, 0.115, 0.106], slot: HAIR, k: 0.04 },
    { t: 'plane', h: y(1.455), sub: true, k: 0.01 },
    { t: 'box', c: [0, y(1.49), -0.1], h: [0.072, 0.099, 0.07], round: 0.012, sub: true, k: 0.006 },
    { t: 'box', c: [0, y(1.47), 0.0], h: [0.06, 0.08, 0.07], sub: true, k: 0.01 }, // le cou passe
    // Cou + visage : crâne, mâchoire fine, menton, pommettes, nez, oreilles
    { t: 'cone', a: [0, y(1.4), 0.008], b: [0, y(1.5), 0.0], r1: 0.045, r2: 0.042, slot: SKIN, k: 0.02 },
    { t: 'ell', c: [0, y(1.56), 0.005], r: [0.084, 0.104, 0.097], slot: SKIN, k: 0.03 },
    { t: 'ell', c: [0, y(1.49), -0.028], r: [0.062, 0.05, 0.064], slot: SKIN, k: 0.045 },
    { t: 'ell', c: [0, y(1.462), -0.06], r: [0.024, 0.022, 0.024], slot: SKIN, k: 0.03 },
    { t: 'ell', c: [-0.044, y(1.532), -0.064], r: [0.022, 0.016, 0.02], slot: SKIN, k: 0.03 },
    { t: 'ell', c: [0.044, y(1.532), -0.064], r: [0.022, 0.016, 0.02], slot: SKIN, k: 0.03 },
    { t: 'cone', a: [0, y(1.555), -0.09], b: [0, y(1.52), -0.106], r1: 0.008, r2: 0.011, slot: SKIN, k: 0.012 },
    { t: 'ell', c: [-0.085, y(1.54), 0.008], r: [0.012, 0.026, 0.018], slot: SKIN_DARK, k: 0.01 },
    { t: 'ell', c: [0.085, y(1.54), 0.008], r: [0.012, 0.026, 0.018], slot: SKIN_DARK, k: 0.01 },
    { t: 'sphere', c: [-0.034, y(1.56), -0.094], r: 0.017, sub: true, k: 0.012 },
    { t: 'sphere', c: [0.034, y(1.56), -0.094], r: 0.017, sub: true, k: 0.012 },
  ];
}

function headDetails() {
  const y = (v) => v - NECK_Y;
  const at = (x, yy, z, sx = 1, sy = 1, sz = 1, rz = 0) => new THREE.Matrix4().compose(
    new THREE.Vector3(x, y(yy), z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, rz)), new THREE.Vector3(sx, sy, sz));
  const eye = new THREE.SphereGeometry(0.0135, 10, 8);
  const pupil = new THREE.SphereGeometry(0.0078, 8, 6);
  const brow = new THREE.BoxGeometry(0.036, 0.006, 0.01);
  return [
    { geometry: eye, slot: EYE_W, matrix: at(-0.034, 1.56, -0.083, 1, 0.75, 0.7) },
    { geometry: eye, slot: EYE_W, matrix: at(0.034, 1.56, -0.083, 1, 0.75, 0.7) },
    { geometry: pupil, slot: EYE, matrix: at(-0.034, 1.56, -0.091, 1, 1, 0.6) },
    { geometry: pupil, slot: EYE, matrix: at(0.034, 1.56, -0.091, 1, 1, 0.6) },
    { geometry: brow, slot: BROW, matrix: at(-0.035, 1.584, -0.093, 1, 1, 1, 0.08) },
    { geometry: brow, slot: BROW, matrix: at(0.035, 1.584, -0.093, 1, 1, 1, -0.08) },
  ];
}

// Bras droit (repère de l'épaule) : coude plié, main devant la bouche
const MIC_HAND = new THREE.Vector3(-0.115, 0.04, -0.17);
function micArmShape() {
  const E = [0.04, -0.2, -0.1]; // coude
  const H = MIC_HAND.toArray();
  return [
    { t: 'ell', c: [-0.01, -0.02, 0], r: [0.05, 0.065, 0.055], slot: WHITE, k: 0.03 },
    { t: 'cone', a: [0, -0.02, 0], b: E, r1: 0.044, r2: 0.036, slot: WHITE, k: 0.03 },
    { t: 'sphere', c: E, r: 0.037, slot: WHITE, k: 0.02 },
    { t: 'cone', a: E, b: [H[0] * 0.85, H[1] * 0.85 - 0.02, H[2] * 0.85], r1: 0.035, r2: 0.028, slot: WHITE, k: 0.02 },
    { t: 'ell', c: H, r: [0.024, 0.04, 0.03], slot: SKIN, k: 0.02 }, // poing serré sur le micro
  ];
}
// Bras gauche (repère de l'épaule) : bras tendu le long du corps
function freeArmShape() {
  return [
    { t: 'ell', c: [0.01, -0.02, 0], r: [0.05, 0.065, 0.055], slot: WHITE, k: 0.03 },
    { t: 'cone', a: [0, -0.02, 0], b: [0, -0.26, 0.0], r1: 0.044, r2: 0.034, slot: WHITE, k: 0.03 },
    { t: 'cone', a: [0, -0.26, 0.0], b: [0, -0.48, -0.01], r1: 0.034, r2: 0.027, slot: WHITE, k: 0.03 },
    { t: 'cone', a: [0, -0.48, -0.01], b: [0, -0.5, -0.01], r1: 0.022, r2: 0.022, slot: SKIN, k: 0.01 },
    { t: 'box', c: [0, -0.55, -0.012], h: [0.014, 0.045, 0.032], round: 0.013, slot: SKIN, k: 0.016 },
    { t: 'cone', a: [0.01, -0.52, -0.032], b: [0.022, -0.565, -0.044], r1: 0.011, r2: 0.009, slot: SKIN, k: 0.01 },
  ];
}

let cache = null;
function geometries() {
  if (cache) return cache;
  const cell = detail.high ? 0.012 : 0.022;
  cache = {
    body: (() => { const sh = bodyShape(); return paint(withDetails(sculpt(sh, { cell }), bodyDetails(sh)), PALETTE); })(),
    head: paint(withDetails(sculpt(headShape(), { cell: cell * 0.8 }), headDetails()), PALETTE),
    micArm: paint(sculpt(micArmShape(), { cell }), PALETTE),
    freeArm: paint(sculpt(freeArmShape(), { cell }), PALETTE),
  };
  return cache;
}

export function buildSinger() {
  const g = geometries();
  // « Poursuite » sans lumière dynamique : un apport émissif PROPORTIONNEL à
  // la couleur de chaque sommet (spot.value), monté la nuit — la chanteuse
  // est éclairée comme par un projecteur, sans délaver le noir des bottes.
  const spot = { value: 0 };
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0 });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.spotBoost = spot;
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float spotBoost;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += diffuseColor.rgb * spotBoost;');
  };
  mat.customProgramCacheKey = () => 'chanteuse';

  const group = new THREE.Group();
  const body = new THREE.Mesh(g.body, mat);
  group.add(body);
  const head = new THREE.Group();
  head.position.set(0, NECK_Y, 0);
  head.add(new THREE.Mesh(g.head, mat));
  group.add(head);
  // Bouche : ovale sombre qui s'ouvre avec la voix
  const mouth = new THREE.Mesh(
    new THREE.SphereGeometry(0.013, 12, 8),
    new THREE.MeshBasicMaterial({ color: 0x3a1414 })
  );
  mouth.position.set(0, 1.498 - NECK_Y, -0.088);
  mouth.scale.set(1.25, 0.25, 0.45);
  head.add(mouth);
  const lips = new THREE.Mesh(new THREE.TorusGeometry(0.0165, 0.0045, 6, 16), new THREE.MeshStandardMaterial({ color: PALETTE[LIP], roughness: 0.45 }));
  lips.position.copy(mouth.position).add(new THREE.Vector3(0, 0, -0.004));
  lips.scale.set(1.15, 0.45, 1);
  head.add(lips);

  const armR = new THREE.Group();
  armR.position.set(SHOULDER.x, SHOULDER.y, 0);
  armR.add(new THREE.Mesh(g.micArm, mat));
  group.add(armR);
  // Micro : corps noir + grille argentée, tenu devant la bouche
  const mic = new THREE.Group();
  const micBody = new THREE.Mesh(new THREE.CylinderGeometry(0.013, 0.009, 0.15, 10), new THREE.MeshStandardMaterial({ color: 0x111114, roughness: 0.35, metalness: 0.5 }));
  const grille = new THREE.Mesh(new THREE.SphereGeometry(0.024, 12, 10), new THREE.MeshStandardMaterial({ color: 0xa9adb3, roughness: 0.3, metalness: 0.9 }));
  grille.position.y = 0.085;
  mic.add(micBody, grille);
  mic.position.copy(MIC_HAND);
  mic.rotation.set(-0.5, 0, 0.75);
  armR.add(mic);

  const armL = new THREE.Group();
  armL.position.set(-SHOULDER.x, SHOULDER.y, 0);
  armL.add(new THREE.Mesh(g.freeArm, mat));
  group.add(armL);

  group.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return { group, head, mouth, armL, armR, spot };
}
