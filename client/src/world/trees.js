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

let crownGeo = null;
export function treeCrownGeometry() {
  if (crownGeo) return crownGeo;
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
  const crowns = new THREE.InstancedMesh(treeCrownGeometry(),
    new THREE.MeshLambertMaterial({ color: leaf, vertexColors: true, flatShading: true }), spots.length);
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
