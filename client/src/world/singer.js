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

// --- Modèle 3D réaliste (Rodin, image → 3D, squelette humanoïde) ----------
// EXCEPTION au « zéro asset » validée par Polo : public/models/chanteuse.glb
// (~4 Mo, 30 k triangles, textures WebP). Chargé à l'approche du théâtre ;
// la chanteuse sculptée ci-dessus reste en secours (échec, palier Bas).
//
// Pas d'animation fournie : on pilote les os directement (balancement,
// hochements, bras au micro, bras levé au refrain), comme la version
// sculptée. Chaque rotation est exprimée dans le repère du MODÈLE puis
// ramenée dans celui du parent (pose de repos), d'où des réglages lisibles :
// « bras vers le bas », « vers l'avant », indépendants des axes de Rodin.
// Rig automatique : des sommets des doigts « collés » à la cuisse voisine
// (et inversement) s'étirent en longs fils dès que la main bouge. On coupe
// les influences entre chaînes qui ne se touchent pas : bras ↔ jambes,
// bras gauche ↔ bras droit, et le tronc pour l'avant-bras et la main.
function chainOf(name) {
  const side = name.startsWith('Left') ? 'G' : name.startsWith('Right') ? 'D' : '';
  if (/Hand|ForeArm/.test(name)) return 'bras-bas' + side;
  if (/Arm|Shoulder/.test(name)) return 'bras-haut' + side;
  if (/UpLeg|Leg|Foot|Toe/.test(name)) return 'jambe' + side;
  return 'tronc';
}
function compatible(a, b) {
  if (a === b) return true;
  const arm = (c) => c.startsWith('bras');
  if (arm(a) && arm(b)) return a.slice(-1) === b.slice(-1); // même côté
  if (a === 'tronc' || b === 'tronc') {
    const other = a === 'tronc' ? b : a;
    return !other.startsWith('bras-bas'); // le tronc ne tire pas la main
  }
  return false;
}
function cleanWeights(mesh) {
  const idx = mesh.geometry.attributes.skinIndex, w = mesh.geometry.attributes.skinWeight;
  const chains = mesh.skeleton.bones.map((b) => chainOf(b.name));
  const dom = new Array(w.count);
  for (let i = 0; i < w.count; i++) {
    const ws = [w.getX(i), w.getY(i), w.getZ(i), w.getW(i)];
    const js = [idx.getX(i), idx.getY(i), idx.getZ(i), idx.getW(i)];
    let top = 0;
    for (let k = 1; k < 4; k++) if (ws[k] > ws[top]) top = k;
    const main = chains[js[top]];
    let sum = 0;
    for (let k = 0; k < 4; k++) {
      if (!compatible(main, chains[js[k]])) ws[k] = 0;
      sum += ws[k];
    }
    if (sum > 0) w.setXYZW(i, ws[0] / sum, ws[1] / sum, ws[2] / sum, ws[3] / sum);
    dom[i] = main;
  }
  w.needsUpdate = true;
  // Triangles « pont » entre deux chaînes qui ne se touchent pas (main ↔
  // cuisse…) : invisibles au repos, ils deviennent de longues lames dès que
  // le bras bouge. On les retire de l'index.
  const index = mesh.geometry.index;
  if (index) {
    const keep = [];
    for (let t = 0; t < index.count; t += 3) {
      const a = dom[index.getX(t)], b = dom[index.getX(t + 1)], c = dom[index.getX(t + 2)];
      if (compatible(a, b) && compatible(b, c) && compatible(a, c)) keep.push(index.getX(t), index.getX(t + 1), index.getX(t + 2));
    }
    mesh.geometry.setIndex(keep);
  }
}

export async function loadSingerModel(url) {
  const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
  const gltf = await new GLTFLoader().loadAsync(url);
  const model = gltf.scene;
  model.updateMatrixWorld(true);
  const spot = { value: 0 };
  const bones = {};
  const meshes = [];
  model.traverse((o) => {
    if (o.isBone) bones[o.name] = o;
    if (o.isMesh) {
      meshes.push(o);
      o.castShadow = true;
      o.receiveShadow = true;
      o.frustumCulled = false; // boîte du maillage skinné peu fiable
      if (o.isSkinnedMesh) cleanWeights(o);
      const m = o.material;
      // La carte métal/rugosité de Rodin rend la peau grise : tissu et peau
      // ne sont pas métalliques
      m.metalness = 0;
      // « Poursuite » : apport émissif proportionnel à la texture (voir spot)
      m.emissive = new THREE.Color(1, 1, 1);
      m.emissiveMap = m.map;
      m.emissiveIntensity = 0;
    }
  });
  const need = ['Hips', 'Spine1', 'Neck', 'Head', 'LeftArm', 'RightArm', 'LeftForeArm', 'RightForeArm', 'RightHand'];
  if (need.some((n) => !bones[n])) throw new Error('squelette inattendu');

  // Pose de repos + repère (modèle) des parents
  const inv = new THREE.Quaternion();
  const rest = new Map();
  const restParent = new Map();
  for (const b of Object.values(bones)) {
    rest.set(b, b.quaternion.clone());
    const pq = new THREE.Quaternion();
    b.parent.getWorldQuaternion(pq);
    restParent.set(b, pq);
  }
  const side = (b) => Math.sign(b.getWorldPosition(new THREE.Vector3()).x) || 1;
  const R = new THREE.Quaternion();
  const AX = { x: new THREE.Vector3(1, 0, 0), y: new THREE.Vector3(0, 1, 0), z: new THREE.Vector3(0, 0, 1) };
  // bone.q = Pp⁻¹ · (rotations modèle) · Pp · q_repos
  function pose(b, rots) {
    const pp = restParent.get(b);
    const q = b.quaternion.copy(rest.get(b));
    for (const [axis, ang] of rots) {
      if (!ang) continue;
      R.setFromAxisAngle(AX[axis], ang);
      inv.copy(pp).invert();
      q.premultiply(inv.clone().multiply(R).multiply(pp));
    }
  }

  // Positions de repos (repère du modèle) pour la cinématique inverse du bras
  // qui tient le micro
  const wp = (b) => b.getWorldPosition(new THREE.Vector3());
  const S0 = wp(bones.RightArm), E0 = wp(bones.RightForeArm), H0 = wp(bones.RightHand);
  const LU = S0.distanceTo(E0), LF = E0.distanceTo(H0);
  const head0 = wp(bones.Head);
  // Bouche ≈ 6 cm au-dessus et 11 cm devant l'os de la tête (base du crâne)
  const MOUTH = head0.clone().add(new THREE.Vector3(0, 0.055, 0.11));

  // POING SERRÉ sur le micro : l'axe de flexion des doigts dépend du rig ;
  // on essaie les quatre possibilités et on garde celle qui rapproche le
  // plus le bout de l'index du poignet (fait une fois, au chargement)
  const fingers = Object.values(bones).filter((b) => /^RightHand(Index|Middle|Ring|Pinky)[123]$/.test(b.name));
  const thumb = Object.values(bones).filter((b) => /^RightHandThumb[23]$/.test(b.name));
  const tip = bones.RightHandIndex3, wrist = bones.RightHand;
  let curl = null;
  if (tip && fingers.length) {
    let best = Infinity;
    for (const [ax, sg] of [['x', 1], ['x', -1], ['z', 1], ['z', -1]]) {
      const qa = new THREE.Quaternion().setFromAxisAngle(AX[ax], sg * 1.2);
      for (const f of fingers) f.quaternion.copy(rest.get(f)).multiply(qa);
      model.updateMatrixWorld(true);
      const dist = wp(tip).distanceTo(wp(wrist));
      if (dist < best) { best = dist; curl = qa; }
    }
    for (const f of fingers) f.quaternion.copy(rest.get(f)).multiply(curl);
    for (const t of thumb) t.quaternion.copy(rest.get(t)).multiply(new THREE.Quaternion().slerpQuaternions(new THREE.Quaternion(), curl, 0.5));
    model.updateMatrixWorld(true);
  }

  // Micro dans la main droite
  const mic = new THREE.Group();
  const micBody = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.01, 0.16, 10), new THREE.MeshStandardMaterial({ color: 0x111114, roughness: 0.35, metalness: 0.5 }));
  const grille = new THREE.Mesh(new THREE.SphereGeometry(0.026, 12, 10), new THREE.MeshStandardMaterial({ color: 0xa9adb3, roughness: 0.3, metalness: 0.9 }));
  grille.position.y = 0.09;
  mic.add(micBody, grille);
  model.add(mic); // placé à chaque image (repère du modèle), tourné vers la bouche

  // Côtés mesurés AVANT de retourner le modèle
  const sL = side(bones.LeftArm), sR = side(bones.RightArm);
  // Le modèle regarde +z (glTF) ; le jeu attend -z
  const group = new THREE.Group();
  model.rotation.y = Math.PI;
  group.add(model);

  // Interface identique à buildSinger() : concert.js anime ces champs
  const head = { rotation: { x: 0, y: 0 } };
  const armL = { rotation: { x: 0, z: 0 } };
  const armR = { rotation: { x: 0 } };
  const mouth = { scale: { y: 0.25 } };
  const WRIST_OFF = new THREE.Vector3(-0.055 * -sR, -0.2, 0.09);
  const tmpT = new THREE.Vector3();
  const POLE = new THREE.Vector3(0.6 * sR, -1, -0.2).normalize(); // coude : bas, dehors
  const qU = new THREE.Quaternion(), qF = new THREE.Quaternion(), qTmp = new THREE.Quaternion();
  const vA = new THREE.Vector3(), vB = new THREE.Vector3(), vC = new THREE.Vector3(), vE = new THREE.Vector3();
  const UP = new THREE.Vector3(0, 1, 0);
  // Pose d'un os à partir d'une rotation EXPRIMÉE dans le repère modèle
  function poseQ(b, Rq) {
    const pp = restParent.get(b);
    inv.copy(pp).invert();
    b.quaternion.copy(rest.get(b)).premultiply(inv.clone().multiply(Rq).multiply(pp));
  }
  function ik(T) {
    const d = Math.min(S0.distanceTo(T), LU + LF - 1e-3);
    const u = vA.subVectors(T, S0).normalize();
    const v = vB.copy(POLE).addScaledVector(u, -POLE.dot(u)).normalize();
    const cosA = (LU * LU + d * d - LF * LF) / (2 * LU * d);
    const sinA = Math.sqrt(Math.max(0, 1 - cosA * cosA));
    const E = vE.copy(S0).addScaledVector(u, LU * cosA).addScaledVector(v, LU * sinA);
    const T2 = vC.copy(S0).addScaledVector(u, d);
    // Bras : direction de repos → nouvelle direction épaule-coude
    qU.setFromUnitVectors(vA.subVectors(E0, S0).normalize(), vB.subVectors(E, S0).normalize());
    poseQ(bones.RightArm, qU);
    // Avant-bras : direction (déjà tournée par le bras) → coude-poignet
    const fRest = vA.subVectors(H0, E0).normalize().applyQuaternion(qU);
    qF.setFromUnitVectors(fRest, vB.subVectors(T2, E).normalize());
    // rotation propre à l'avant-bras dans le repère de repos : qU⁻¹·qF·qU
    qTmp.copy(qU).invert().multiply(qF).multiply(qU);
    poseQ(bones.RightForeArm, qTmp);
    // Micro : dans la paume, grille vers la bouche
    const dir = vA.subVectors(MOUTH, T2).normalize();
    mic.position.copy(T2).addScaledVector(dir, 0.07);
    mic.quaternion.setFromUnitVectors(UP, dir);
  }
  return {
    group, head, armL, armR, mouth, spot, meshes, mic,
    // Appliqué à chaque image après que concert.js a réglé les champs
    apply() {
      for (const m of meshes) m.material.emissiveIntensity = spot.value * 0.9;
      const sway = group.rotation.z;
      pose(bones.Spine1, [['z', sway * 1.2]]);
      pose(bones.Head, [['x', -head.rotation.x], ['y', head.rotation.y]]);
      // Bras gauche : le long du corps, levé au refrain (armL.rotation.x < 0)
      const up = Math.max(0, -armL.rotation.x);
      // (au repos, les bras sont déjà à ~63° sous l'horizontale)
      pose(bones.LeftArm, [['z', -sL * (0.38 - up * 1.1)], ['x', -up * 0.45]]);
      pose(bones.LeftForeArm, [['x', -0.15 - up * 0.25]]);
      // Bras droit : coude au corps, avant-bras relevé, micro à la bouche
      // Cinématique inverse à deux os : poignet sous le menton, coude en bas
      // et vers l'extérieur
      const T = tmpT.copy(MOUTH).add(WRIST_OFF);
      T.y += armR.rotation.x * 0.15; // petit mouvement du micro sur les temps
      ik(T);
    },
  };
}
