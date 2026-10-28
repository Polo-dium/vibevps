import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { detail } from '../render/detail.js';

// ARBRES PARTAGÉS (les deux villes + Bellecour HD) : un houppier en grappe
// de lobes bosselés, ombré en couleurs de sommets (dessous sombre, cime
// éclairée = occlusion ambiante « cuite »), et un tronc qui se divise en
// charpentières qui montent dans le feuillage. Géométries uniques,
// partagées par tous les InstancedMesh — rayon ≈ 1,6 et hauteur 2,4 comme
// les primitives qu'elles remplacent (mêmes matrices d'instance).

function makeRand(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

// FEUILLAGE EN CARTES (paliers Élevé et Moyen) : ~60 petits plans portant
// une grappe de feuilles découpées (texture canvas, alphaTest), répartis
// dans l'ellipsoïde du houppier, + un cœur sombre qui bouche les jours.
// Normales « sphériques » (du centre vers l'extérieur, un peu vers le ciel)
// : l'arbre s'éclaire comme un volume rond et doux, pas comme 60 plans.
// Moins de triangles que les lobes à facettes (≈150 contre ≈640), et une
// silhouette dentelée crédible. Mêmes dimensions que l'ancien houppier
// (mêmes matrices d'instance partout).
const CORE_UV = 0.02; // coin opaque de la texture réservé au cœur
let leafTex = null;
function leafTexture() {
  if (leafTex) return leafTex;
  const S = 256;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  const rand = makeRand(777);
  // Fond transparent mais de la couleur moyenne des feuilles : les mipmaps
  // ne virent pas au noir sur les bords découpés
  g.fillStyle = 'rgba(205,210,195,0)';
  g.fillRect(0, 0, S, S);
  for (let i = 0; i < 150; i++) {
    // Feuilles serrées au centre, plus éparses vers le bord de la grappe
    const a = rand() * Math.PI * 2, r = Math.sqrt(rand()) * S * 0.42;
    const x = S / 2 + Math.cos(a) * r, y = S / 2 + Math.sin(a) * r;
    const len = 14 + rand() * 16, wid = 6 + rand() * 6;
    const v = 185 + rand() * 70, warm = rand() * 20;
    g.save();
    g.translate(x, y);
    g.rotate(rand() * Math.PI * 2);
    g.fillStyle = `rgb(${v - 10 + warm},${v},${v - 25})`;
    g.beginPath();
    g.ellipse(0, 0, len / 2, wid / 2, 0, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = `rgba(60,70,40,0.35)`; // nervure
    g.lineWidth = 1;
    g.beginPath(); g.moveTo(-len / 2, 0); g.lineTo(len / 2, 0); g.stroke();
    g.restore();
  }
  // Coin opaque pour le cœur sombre du houppier
  g.fillStyle = 'rgb(120,125,110)';
  g.fillRect(0, S - 12, 12, 12);
  leafTex = new THREE.CanvasTexture(c);
  leafTex.colorSpace = THREE.SRGBColorSpace;
  leafTex.anisotropy = 4;
  return leafTex;
}

function cardsCrownGeometry(n) {
  const rand = makeRand(4243);
  const R = [1.9, 1.5, 1.9];
  const pos = [], nor = [], uv = [], col = [];
  const v3 = (x, y, z) => new THREE.Vector3(x, y, z);
  const sphereN = (p) => v3(p.x / (R[0] * R[0]), p.y / (R[1] * R[1]) + 0.25, p.z / (R[2] * R[2])).normalize();
  const shade = (p) => {
    const rr = Math.hypot(p.x / R[0], p.y / R[1], p.z / R[2]);
    return THREE.MathUtils.clamp(0.72 + rr * 0.4 + (p.y / R[1]) * 0.14, 0.62, 1.28);
  };
  for (let i = 0; i < n; i++) {
    // Plutôt vers la surface (cœur rempli par le noyau sombre)
    const dir = v3(rand() * 2 - 1, rand() * 2 - 1, rand() * 2 - 1).normalize();
    const rr = 0.55 + 0.45 * Math.cbrt(rand());
    const c = v3(dir.x * R[0] * rr, dir.y * R[1] * rr, dir.z * R[2] * rr);
    const nrm = dir.clone().add(v3(rand() - 0.5, rand() - 0.5, rand() - 0.5).multiplyScalar(1.2)).normalize();
    const t1 = v3(0, 1, 0).cross(nrm);
    if (t1.lengthSq() < 1e-4) t1.set(1, 0, 0);
    t1.normalize().applyAxisAngle(nrm, rand() * Math.PI * 2);
    const t2 = nrm.clone().cross(t1).normalize();
    const h = 0.6 + rand() * 0.25;
    const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => c.clone().addScaledVector(t1, a * h).addScaledVector(t2, b * h));
    const uvs = [[0.06, 0.06], [0.94, 0.06], [0.94, 0.94], [0.06, 0.94]];
    for (const k of [0, 1, 2, 0, 2, 3]) {
      const p = corners[k];
      pos.push(p.x, p.y, p.z);
      const sn = sphereN(p);
      nor.push(sn.x, sn.y, sn.z);
      uv.push(...uvs[k]);
      const v = shade(p);
      col.push(v, v, v);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  // Cœur sombre (bouche les trous entre les cartes)
  const core = new THREE.IcosahedronGeometry(1, 1).toNonIndexed();
  core.scale(R[0] * 0.62, R[1] * 0.6, R[2] * 0.62);
  const cp = core.attributes.position;
  const cuv = new Float32Array(cp.count * 2).fill(CORE_UV);
  const ccol = new Float32Array(cp.count * 3).fill(0.45);
  core.setAttribute('uv', new THREE.BufferAttribute(cuv, 2));
  core.setAttribute('color', new THREE.BufferAttribute(ccol, 3));
  core.computeVertexNormals();
  return mergeGeometries([geo, core]);
}

const useCards = () => detail.level !== 'bas';

// Matériau de feuillage assorti à treeCrownGeometry() (à utiliser partout)
export function treeFoliageMaterial(color) {
  if (!useCards()) return new THREE.MeshLambertMaterial({ color, flatShading: true, vertexColors: true });
  const m = new THREE.MeshLambertMaterial({
    color, vertexColors: true, map: leafTexture(), alphaTest: 0.5, side: THREE.DoubleSide,
  });
  // Double face SANS retourner la normale côté envers : les normales
  // sphériques valent pour les deux faces d'une carte
  m.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_begin>',
      THREE.ShaderChunk.normal_fragment_begin.replace(/normal \*= faceDirection;/g, ''));
  };
  m.customProgramCacheKey = () => 'feuillage-cartes';
  return m;
}

let crownGeo = null;
export function treeCrownGeometry() {
  if (crownGeo) return crownGeo;
  if (useCards()) {
    crownGeo = cardsCrownGeometry(detail.high ? 64 : 42);
    return crownGeo;
  }
  const rand = makeRand(4242);
  const lobes = [
    [0, 0, 0, 1.15], [0.75, 0.25, 0.2, 0.8], [-0.7, 0.2, -0.25, 0.82], [0.15, 0.3, 0.8, 0.75],
    [-0.2, 0.35, -0.8, 0.72], [0.1, 0.85, 0.05, 0.78], [0.55, -0.35, -0.5, 0.6], [-0.5, -0.3, 0.55, 0.6],
  ];
  const parts = lobes.map(([x, y, z, r]) => {
    // 80 triangles par lobe en Élevé, 20 ailleurs (×8 lobes × centaines d'arbres)
    const g = new THREE.IcosahedronGeometry(r, detail.high ? 1 : 0);
    const p = g.attributes.position;
    // Bosselage déterministe : chaque sommet poussé/rentré un peu
    for (let i = 0; i < p.count; i++) {
      const k = 0.86 + rand() * 0.28;
      p.setXYZ(i, p.getX(i) * k, p.getY(i) * k, p.getZ(i) * k);
    }
    g.translate(x, y, z);
    return g.toNonIndexed();
  });
  const geo = mergeGeometries(parts);
  geo.scale(1.35, 1.25, 1.35);
  // Occlusion cuite : sombre en dessous et au cœur, clair en haut
  const p = geo.attributes.position;
  const col = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i), r = Math.hypot(p.getX(i), p.getZ(i));
    const v = THREE.MathUtils.clamp(0.55 + (y + 1.2) * 0.22 + r * 0.06, 0.45, 1.12);
    col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = v;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.computeVertexNormals(); // facettes (non indexé) = feuillage lisible
  crownGeo = geo;
  return geo;
}

let trunkGeo = null;
export function treeTrunkGeometry() {
  if (trunkGeo) return trunkGeo;
  const parts = [];
  const trunk = new THREE.CylinderGeometry(0.2, 0.32, 2.4, 8);
  parts.push(trunk);
  // Collet évasé au pied
  const flare = new THREE.CylinderGeometry(0.32, 0.46, 0.3, 8);
  flare.translate(0, -1.05, 0);
  parts.push(flare);
  // Charpentières : trois branches qui partent en biais dans le houppier
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + 0.4;
    const b = new THREE.CylinderGeometry(0.07, 0.13, 1.6, 6);
    b.translate(0, 0.8, 0);
    b.rotateZ(0.55);
    b.rotateY(a);
    b.translate(0, 0.9, 0);
    parts.push(b);
  }
  trunkGeo = mergeGeometries(parts.map((g) => g.toNonIndexed()));
  trunkGeo.computeVertexNormals();
  return trunkGeo;
}

// Plantation instanciée : spots = [[x, z, échelle, sol]...]. Même gabarit
// que l'arbre de la vraie ville (tronc centré à 1,2·s, houppier à 3,6·s).
export function plantTrees(ctx, spots, { leaf = 0x4f7d3a, seed = 7 } = {}) {
  if (!spots.length) return null;
  const rand = makeRand(seed);
  const trunks = new THREE.InstancedMesh(treeTrunkGeometry(),
    new THREE.MeshLambertMaterial({ color: 0x5d4632 }), spots.length);
  const crowns = new THREE.InstancedMesh(treeCrownGeometry(), treeFoliageMaterial(leaf), spots.length);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const col = new THREE.Color();
  spots.forEach(([x, z, s = 1, y = 0], i) => {
    q.setFromAxisAngle(up, rand() * Math.PI * 2);
    m.compose(new THREE.Vector3(x, y + 1.2 * s, z), q, new THREE.Vector3(s, s, s));
    trunks.setMatrixAt(i, m);
    m.compose(new THREE.Vector3(x, y + 3.6 * s, z), q, new THREE.Vector3(s, s * 0.95, s));
    crowns.setMatrixAt(i, m);
  });
  // La couleur du matériau porte déjà la teinte : les couleurs d'instance
  // ne sont que des variations relatives (≈ blanc ± 15 %).
  for (let i = 0; i < spots.length; i++) {
    const v = 0.85 + rand() * 0.3;
    crowns.setColorAt(i, col.setRGB(v * (0.95 + rand() * 0.1), v, v * (0.95 + rand() * 0.1)));
  }
  trunks.instanceMatrix.needsUpdate = true;
  crowns.instanceMatrix.needsUpdate = true;
  crowns.instanceColor.needsUpdate = true;
  trunks.castShadow = crowns.castShadow = true;
  trunks.receiveShadow = crowns.receiveShadow = true;
  ctx.scene.add(trunks, crowns);
  return { trunks, crowns };
}
