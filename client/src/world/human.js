import * as THREE from 'three';
import { flattenColored } from './utils.js';

// Humanoïde low-poly articulé (origine aux pieds, ~1,78 m).
// Retourne les pivots membres pour l'animation de marche.
//
// PERF : les 12 pièces d'origine (un draw call chacune) sont cuites en 5
// meshes à couleurs de sommets — un corps + quatre membres articulés, seuls
// morceaux qui doivent tourner indépendamment. Avec une soixantaine
// d'humains dans la ville (PNJ, terrasses, zombies, joueurs distants), c'est
// ~420 draw calls économisés. Tous les meshes d'un humain partagent UN
// matériau : `shirtMat` le teinte en entier (flash de dégâts).
export function buildHuman({ shirt = 0x6b7a8f, pants = 0x39404e, skin = 0xe8c39e, hair = 0x3a2c1e } = {}) {
  const group = new THREE.Group();
  // Matériau unique de CET humain : la couleur multiplie les couleurs de
  // sommets, donc la mettre en rouge teinte tout le personnage (flash).
  const bodyMat = new THREE.MeshLambertMaterial({ vertexColors: true });
  const shirtMat = new THREE.MeshLambertMaterial({ color: shirt });
  const pantsMat = new THREE.MeshLambertMaterial({ color: pants });
  const skinMat = new THREE.MeshLambertMaterial({ color: skin });
  const hairMat = new THREE.MeshLambertMaterial({ color: hair });
  const shoeMat = new THREE.MeshLambertMaterial({ color: 0x23262d });

  // Les pièces sont d'abord posées telles quelles (mêmes cotes qu'avant),
  // puis fondues par pivot. `piece` ne fait que préparer la géométrie.
  const piece = (geo, mat, x, y, z) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    return m;
  };

  // Jambes (pivot à la hanche) : cuisse + chaussure en un seul mesh
  function makeLeg(x) {
    const pivot = new THREE.Group();
    pivot.position.set(x, 0.86, 0);
    const merged = flattenColored([
      piece(new THREE.BoxGeometry(0.16, 0.74, 0.19), pantsMat, 0, -0.37, 0),
      // La pointe du pied part vers -z, comme le nez
      piece(new THREE.BoxGeometry(0.17, 0.1, 0.3), shoeMat, 0, -0.78, -0.05),
    ], { material: bodyMat });
    pivot.add(merged);
    group.add(pivot);
    return pivot;
  }
  const legL = makeLeg(-0.11);
  const legR = makeLeg(0.11);

  // Bras (pivot à l'épaule) : bras + main en un seul mesh
  function makeArm(x) {
    const pivot = new THREE.Group();
    pivot.position.set(x, 1.42, 0);
    const merged = flattenColored([
      piece(new THREE.BoxGeometry(0.12, 0.56, 0.14), shirtMat, 0, -0.26, 0),
      piece(new THREE.BoxGeometry(0.11, 0.12, 0.12), skinMat, 0, -0.58, 0),
    ], { material: bodyMat });
    pivot.add(merged);
    group.add(pivot);
    return pivot;
  }
  const armL = makeArm(-0.31);
  const armR = makeArm(0.31);

  // Tronc, bassin, tête, cheveux et nez : rien ne bouge les uns par rapport
  // aux autres, donc tout part dans un seul mesh.
  const body = flattenColored([
    piece(new THREE.BoxGeometry(0.46, 0.6, 0.26), shirtMat, 0, 1.16, 0),
    piece(new THREE.BoxGeometry(0.4, 0.18, 0.24), pantsMat, 0, 0.82, 0),
    piece(new THREE.BoxGeometry(0.26, 0.28, 0.26), skinMat, 0, 1.64, 0),
    piece(new THREE.BoxGeometry(0.28, 0.12, 0.28), hairMat, 0, 1.76, 0),
    // Nez (donne le sens du regard)
    piece(new THREE.BoxGeometry(0.05, 0.06, 0.06), skinMat, 0, 1.62, -0.15),
  ], { material: bodyMat });
  group.add(body);

  // Animation de marche : balancement opposé jambes/bras
  function animate(t, speed) {
    const swing = Math.min(1, speed / 4) * 0.65;
    const s = Math.sin(t);
    legL.rotation.x = s * swing;
    legR.rotation.x = -s * swing;
    armL.rotation.x = -s * swing * 0.8;
    armR.rotation.x = s * swing * 0.8;
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
  };
}
