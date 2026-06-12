import * as THREE from 'three';

// Humanoïde low-poly articulé (origine aux pieds, ~1,78 m).
// Retourne les pivots membres pour l'animation de marche.
export function buildHuman({ shirt = 0x6b7a8f, pants = 0x39404e, skin = 0xe8c39e, hair = 0x3a2c1e } = {}) {
  const group = new THREE.Group();
  const shirtMat = new THREE.MeshLambertMaterial({ color: shirt });
  const pantsMat = new THREE.MeshLambertMaterial({ color: pants });
  const skinMat = new THREE.MeshLambertMaterial({ color: skin });
  const hairMat = new THREE.MeshLambertMaterial({ color: hair });
  const shoeMat = new THREE.MeshLambertMaterial({ color: 0x23262d });

  // Jambes (pivot à la hanche)
  function makeLeg(x) {
    const pivot = new THREE.Group();
    pivot.position.set(x, 0.86, 0);
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.74, 0.19), pantsMat);
    leg.position.y = -0.37;
    pivot.add(leg);
    // La pointe du pied part vers -z, comme le nez
    const shoe = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.1, 0.3), shoeMat);
    shoe.position.set(0, -0.78, -0.05);
    pivot.add(shoe);
    group.add(pivot);
    return pivot;
  }
  const legL = makeLeg(-0.11);
  const legR = makeLeg(0.11);

  // Torse
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.6, 0.26), shirtMat);
  torso.position.y = 1.16;
  group.add(torso);
  // Bassin
  const hips = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.18, 0.24), pantsMat);
  hips.position.y = 0.82;
  group.add(hips);

  // Bras (pivot à l'épaule)
  function makeArm(x) {
    const pivot = new THREE.Group();
    pivot.position.set(x, 1.42, 0);
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.56, 0.14), shirtMat);
    arm.position.y = -0.26;
    pivot.add(arm);
    const hand = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.12, 0.12), skinMat);
    hand.position.y = -0.58;
    pivot.add(hand);
    group.add(pivot);
    return pivot;
  }
  const armL = makeArm(-0.31);
  const armR = makeArm(0.31);

  // Tête
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.28, 0.26), skinMat);
  head.position.y = 1.64;
  group.add(head);
  const hairMesh = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.12, 0.28), hairMat);
  hairMesh.position.y = 1.76;
  group.add(hairMesh);
  // Nez (donne le sens du regard)
  const nose = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.06, 0.06), skinMat);
  nose.position.set(0, 1.62, -0.15);
  group.add(nose);

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
    head,
    torso,
    hitMeshes: [torso, head, legL.children[0], legR.children[0]],
    shirtMat,
    animate,
  };
}
