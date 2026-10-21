import * as THREE from 'three';
import { flattenColored } from './utils.js';
import { profileGeo } from '../render/materials.js';
import { detail } from '../render/detail.js';

// Humanoïde articulé (origine aux pieds, ~1,78 m) : silhouette anatomique
// (épaules, coudes, genoux arrondis), visage (yeux, sourcils, bouche,
// oreilles), coiffures, ceinture et chaussures à semelle.
// Retourne les pivots membres pour l'animation de marche.
//
// PERF : les 12 pièces d'origine (un draw call chacune) sont cuites en 5
// meshes à couleurs de sommets — un corps + quatre membres articulés, seuls
// morceaux qui doivent tourner indépendamment. Avec une soixantaine
// d'humains dans la ville (PNJ, terrasses, zombies, joueurs distants), c'est
// ~420 draw calls économisés. Tous les meshes d'un humain partagent UN
// matériau : `shirtMat` le teinte en entier (flash de dégâts).
export function buildHuman({ shirt = 0x6b7a8f, pants = 0x39404e, skin = 0xe8c39e, hair = 0x3a2c1e, style } = {}) {
  const group = new THREE.Group();
  // Matériau unique de CET humain : la couleur multiplie les couleurs de
  // sommets, donc la mettre en rouge teinte tout le personnage (flash).
  // PBR mat (rugosité tissu/peau) : capte l'ambiance du ciel comme le décor.
  // PBR au palier Élevé seulement (Lambert, bien moins cher, ailleurs)
  const bodyMat = detail.high
    ? new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82, metalness: 0 })
    : new THREE.MeshLambertMaterial({ vertexColors: true });
  const shirtMat = new THREE.MeshLambertMaterial({ color: shirt });
  const shirtDark = new THREE.MeshLambertMaterial({ color: new THREE.Color(shirt).multiplyScalar(0.72) });
  const pantsMat = new THREE.MeshLambertMaterial({ color: pants });
  const skinMat = new THREE.MeshLambertMaterial({ color: skin });
  const skinDark = new THREE.MeshLambertMaterial({ color: new THREE.Color(skin).multiplyScalar(0.8) });
  const hairMat = new THREE.MeshLambertMaterial({ color: hair });
  const shoeMat = new THREE.MeshLambertMaterial({ color: 0x23262d });
  const soleMat = new THREE.MeshLambertMaterial({ color: 0xd8d4cc });
  const beltMat = new THREE.MeshLambertMaterial({ color: 0x2a211b });
  const metalMat = new THREE.MeshLambertMaterial({ color: 0xc9c2a8 });
  const eyeMat = new THREE.MeshLambertMaterial({ color: 0x1b1d22 });
  const whiteMat = new THREE.MeshLambertMaterial({ color: 0xf2efe8 });
  const lipMat = new THREE.MeshLambertMaterial({ color: new THREE.Color(skin).lerp(new THREE.Color(0xa0473d), 0.45) });
  // Coiffure stable pour une même tenue (déterministe) : courte, casquette
  // (gone du quartier) ou longue
  const look = style ?? ['court', 'casquette', 'long'][(shirt ^ (pants >> 3) ^ (hair << 1)) % 3];

  // Les pièces sont d'abord posées telles quelles, puis fondues par pivot.
  const piece = (geo, mat, x, y, z, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.rotation.set(rx, ry, rz);
    m.scale.set(sx, sy, sz);
    return m;
  };
  // Segment de membre : tronc de cône vertical de y0 (haut) à y1 (bas)
  const seg = (r0, r1, y0, y1, mat, x = 0, z = 0, n = 10) =>
    piece(new THREE.CylinderGeometry(r0, r1, y0 - y1, n), mat, x, (y0 + y1) / 2, z);
  const ball = (r, mat, x, y, z, sx = 1, sy = 1, sz = 1, w = 10, h = 8) =>
    piece(new THREE.SphereGeometry(r, w, h), mat, x, y, z, 0, 0, 0, sx, sy, sz);
  // Surface de révolution d'UNE pièce (profil [rayon, hauteur] de haut en
  // bas) : pas d'intersections entre sphères et cylindres, donc pas de
  // liserés en dents de scie aux épaules, coudes et genoux.
  const lathe = (profile, mat, x = 0, z = 0, sz = 1, n = 14) => piece(
    new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(r, y)).reverse(), n),
    mat, x, 0, z, 0, 0, 0, 1, 1, sz);

  // Jambes (pivot à la hanche) : cuisse, genou, tibia, chaussure à semelle
  function makeLeg(x) {
    const pivot = new THREE.Group();
    pivot.position.set(x, 0.86, 0);
    const merged = flattenColored([
      lathe([[0, 0.07], [0.06, 0.055], [0.088, 0.0], [0.08, -0.22], [0.068, -0.4], [0.065, -0.45],
        [0.06, -0.6], [0.056, -0.74], [0.0, -0.75]], pantsMat),
      seg(0.062, 0.064, -0.71, -0.76, pantsMat), // ourlet
      // Chaussure : profil biseauté (pointe vers -z, comme le nez)
      piece(profileGeo([[-0.075, -0.835], [0.17, -0.835], [0.185, -0.81], [0.16, -0.78], [0.07, -0.765],
        [0.045, -0.72], [-0.065, -0.72], [-0.085, -0.77]], 0.118, { bevel: 0.014 }), shoeMat, 0, 0, 0),
      piece(new THREE.BoxGeometry(0.124, 0.025, 0.27), soleMat, 0, -0.848, -0.05),
    ], { material: bodyMat });
    pivot.add(merged);
    group.add(pivot);
    return pivot;
  }
  const legL = makeLeg(-0.105);
  const legR = makeLeg(0.105);

  // Bras (pivot à l'épaule) : épaule, bras, coude, avant-bras, main
  function makeArm(x) {
    const pivot = new THREE.Group();
    pivot.position.set(x, 1.42, 0);
    const merged = flattenColored([
      lathe([[0, 0.065], [0.045, 0.05], [0.066, 0.01], [0.062, -0.08], [0.052, -0.27], [0.049, -0.31],
        [0.044, -0.42], [0.04, -0.5], [0.0, -0.505]], shirtMat),
      seg(0.046, 0.046, -0.465, -0.51, shirtDark), // poignet de manche
      ball(0.042, skinMat, 0, -0.57, -0.008, 0.75, 1.25, 1.05), // main
      ball(0.017, skinMat, Math.sign(x) * -0.03, -0.55, -0.025, 1, 1.6, 1), // pouce
    ], { material: bodyMat });
    pivot.add(merged);
    group.add(pivot);
    return pivot;
  }
  const armL = makeArm(-0.3);
  const armR = makeArm(0.3);

  // Tronc, bassin, ceinture, cou, tête, visage, coiffure : rien ne bouge les
  // uns par rapport aux autres, donc tout part dans un seul mesh.
  const parts = [
    // Bassin + ceinture à boucle
    piece(new THREE.CylinderGeometry(0.2, 0.19, 0.2, 12), pantsMat, 0, 0.88, 0, 0, 0, 0, 1, 1, 0.62),
    piece(new THREE.CylinderGeometry(0.205, 0.205, 0.045, 12), beltMat, 0, 0.98, 0, 0, 0, 0, 1, 1, 0.64),
    piece(new THREE.BoxGeometry(0.06, 0.04, 0.02), metalMat, 0, 0.98, -0.13),
    // Torse d'une pièce : taille, poitrine, épaules arrondies, départ du cou
    lathe([[0.07, 1.51], [0.15, 1.475], [0.235, 1.43], [0.255, 1.36], [0.245, 1.24], [0.215, 1.1],
      [0.198, 0.99], [0.2, 0.96], [0, 0.95]], shirtMat, 0, 0, 0.56, 18),
    // Patte de boutonnage / fermeture éclair + col
    piece(new THREE.BoxGeometry(0.018, 0.42, 0.01), shirtDark, 0, 1.2, -0.142),
    piece(new THREE.TorusGeometry(0.068, 0.02, 6, 14), shirtDark, 0, 1.475, 0, Math.PI / 2),
    // Cou + tête (crâne ovale, mâchoire)
    seg(0.052, 0.058, 1.56, 1.46, skinMat),
    ball(0.118, skinMat, 0, 1.655, 0, 0.9, 1.12, 1.02, 16, 12),
    // Oreilles
    ball(0.025, skinDark, -0.112, 1.66, 0.005, 0.5, 1, 0.8, 6, 6),
    ball(0.025, skinDark, 0.112, 1.66, 0.005, 0.5, 1, 0.8, 6, 6),
    // Nez (donne le sens du regard), yeux, sourcils, bouche
    piece(new THREE.ConeGeometry(0.02, 0.05, 6), skinDark, 0, 1.65, -0.122, -Math.PI / 2 + 0.35),
    ball(0.017, whiteMat, -0.041, 1.685, -0.098, 1, 0.75, 0.6, 8, 6),
    ball(0.017, whiteMat, 0.041, 1.685, -0.098, 1, 0.75, 0.6, 8, 6),
    ball(0.01, eyeMat, -0.041, 1.685, -0.108, 1, 1, 0.5, 6, 6),
    ball(0.01, eyeMat, 0.041, 1.685, -0.108, 1, 1, 0.5, 6, 6),
    piece(new THREE.BoxGeometry(0.045, 0.011, 0.012), hairMat, -0.042, 1.712, -0.102, 0, 0, 0.12),
    piece(new THREE.BoxGeometry(0.045, 0.011, 0.012), hairMat, 0.042, 1.712, -0.102, 0, 0, -0.12),
    piece(new THREE.BoxGeometry(0.045, 0.011, 0.01), lipMat, 0, 1.6, -0.108),
  ];
  // Coiffure : calotte de cheveux (+ visière, ou mèches longues)
  // Basculée vers l'arrière : dégage le front et les yeux, couvre la nuque
  parts.push(piece(new THREE.SphereGeometry(0.125, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.5),
    look === 'casquette' ? shirtDark : hairMat, 0, 1.672, 0.01, 0.38, 0, 0, 0.94, 1.05, 1.06));
  if (look === 'casquette') {
    parts.push(piece(new THREE.CylinderGeometry(0.1, 0.1, 0.012, 12, 1, false, Math.PI * 0.5, Math.PI),
      shirtDark, 0, 1.735, -0.1, 0.1, 0, 0, 1, 1, 0.9));
  } else if (look === 'long') {
    parts.push(ball(0.12, hairMat, 0, 1.58, 0.05, 1.02, 1.3, 0.7, 12, 8));
  } else {
    parts.push(ball(0.11, hairMat, 0, 1.64, 0.04, 1, 0.95, 0.9, 12, 8)); // nuque
  }
  const body = flattenColored(parts, { material: bodyMat });
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
