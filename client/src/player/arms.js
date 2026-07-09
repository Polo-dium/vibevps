import * as THREE from 'three';

// Avant-bras low-poly en vue subjective : purement cosmétique. Les deux bras
// sont de VRAIS miroirs l'un de l'autre (une seule pose canonique « droite »,
// reflétée en X pour la gauche) — évite l'incohérence d'une paire asymétrique
// réglée à la main des deux côtés séparément.
//
// En mode arme, la main droite ne vise plus une pose fixe : elle recopie
// CHAQUE FRAME la position/rotation réelle du porte-arme (weapon.js expose
// `holder`), donc elle suit pile le recul, le balancement de course, le
// plongeon de rechargement et le coup de marteau — plus de main qui reste
// figée pendant que l'arme part en arrière au tir.
const SKIN = 0xe8c39e;
const SLEEVE = 0x3c4a5e; // manche de blouson, assortie au reste du perso

// Poses canoniques côté DROIT uniquement (position du poignet + rotation).
// Le côté gauche est dérivé par mirror() ci-dessous.
const RIGHT_POSES = {
  idle: { pos: [0.15, -0.32, -0.32], rot: [0.5, -0.2, 0.12] },
  boombox: { pos: [-0.14, -0.28, -0.5], rot: [0.4, -0.55, 0.18] },
  jetpack: { pos: [0.14, -0.16, -0.28], rot: [0.15, -0.35, 0.22] },
};

function mirror(pose) {
  return {
    pos: [-pose.pos[0], pose.pos[1], pose.pos[2]],
    rot: [pose.rot[0], -pose.rot[1], -pose.rot[2]],
  };
}

// Le poing est le bout de l'avant-bras (z le plus négatif, donc le plus
// proche du canon) ; le reste (avant-bras puis manche) remonte vers la
// caméra, donc vers l'épaule — c'est ce décalage qu'il faut compenser
// quand on accroche le poing pile sur un point de préhension de l'arme.
const HAND_LOCAL_Z = -0.35;

function buildArm() {
  const group = new THREE.Group();
  const skinMat = new THREE.MeshLambertMaterial({ color: SKIN });
  const sleeveMat = new THREE.MeshLambertMaterial({ color: SLEEVE });
  // Manche (proche de la caméra, donc de l'épaule)
  const sleeve = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.22), sleeveMat);
  sleeve.position.z = 0.03;
  group.add(sleeve);
  // Avant-bras nu (manche retroussée), puis main légèrement plus large + pouce
  const forearm = new THREE.Mesh(new THREE.BoxGeometry(0.088, 0.088, 0.2), skinMat);
  forearm.position.z = -0.2;
  group.add(forearm);
  const hand = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.075, 0.12), skinMat);
  hand.position.z = HAND_LOCAL_Z;
  group.add(hand);
  const thumb = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.045, 0.075), skinMat);
  thumb.position.set(0, 0.045, HAND_LOCAL_Z + 0.03);
  group.add(thumb);
  return group;
}

// Poignée pistolet / garde-main de l'AK, repères locaux au porte-arme (voir
// buildAkModel dans weapon.js) : le POING (pas l'origine du groupe bras) doit
// tomber pile sur ces coordonnées — voir la compensation HAND_LOCAL_Z dans
// update(). La main droite/gauche s'accroche en vrai enfant du groupe plutôt
// que de recopier une position à la main chaque frame — elle hérite alors du
// recul/balancement/plongeon de rechargement sans AUCUN calcul de synchro.
const GRIP_R = { pos: [0.02, -0.09, -0.02], rot: [0.15, -0.1, 0] }; // poignée pistolet
const GRIP_L = { pos: [-0.01, -0.03, -0.4], rot: [0.1, 0.15, 0] }; // garde-main

export function createArms(camera) {
  const right = buildArm();
  const left = buildArm();
  camera.add(right, left);
  let attachedTo = camera; // camera (poses lerpées) ou le holder d'une arme

  let bobTime = 0;
  const cur = {
    r: { pos: new THREE.Vector3(...RIGHT_POSES.idle.pos), rot: new THREE.Euler(...RIGHT_POSES.idle.rot) },
    l: { pos: new THREE.Vector3(...mirror(RIGHT_POSES.idle).pos), rot: new THREE.Euler(...mirror(RIGHT_POSES.idle).rot) },
  };

  function lerpTo(cur3, target, k) {
    cur3.pos.x += (target.pos[0] - cur3.pos.x) * k;
    cur3.pos.y += (target.pos[1] - cur3.pos.y) * k;
    cur3.pos.z += (target.pos[2] - cur3.pos.z) * k;
    cur3.rot.x += (target.rot[0] - cur3.rot.x) * k;
    cur3.rot.y += (target.rot[1] - cur3.rot.y) * k;
    cur3.rot.z += (target.rot[2] - cur3.rot.z) * k;
  }

  // mode : 'weapon' | 'boombox' | 'jetpack' | 'idle'
  // weaponHolder : le groupe THREE de l'arme (weapon.js), lu en direct en
  // mode 'weapon' pour un calage parfait avec le recul/balancement/recharge.
  function update(dt, mode, isMoving, weaponHolder) {
    const k = 1 - Math.exp(-9 * dt);

    if (mode === 'weapon' && weaponHolder) {
      // Les mains deviennent de VRAIS enfants du porte-arme (repères locaux
      // GRIP_R/GRIP_L, à l'échelle interne de holder — voir buildAkModel dans
      // weapon.js) : elles héritent alors automatiquement de tout ce que fait
      // holder chaque frame (bob, recul au tir, plongeon de rechargement,
      // coup de marteau) sans aucun calcul de synchro à maintenir ici.
      if (attachedTo !== weaponHolder) {
        weaponHolder.add(right, left);
        attachedTo = weaponHolder;
      }
      // On positionne l'ORIGINE du groupe bras (pas le poing) : décalée en
      // arrière de HAND_LOCAL_Z pour que ce soit bien le poing qui tombe sur
      // le point de préhension, et pas le milieu de l'avant-bras.
      right.position.set(GRIP_R.pos[0], GRIP_R.pos[1], GRIP_R.pos[2] - HAND_LOCAL_Z);
      right.rotation.set(...GRIP_R.rot);
      left.position.set(GRIP_L.pos[0], GRIP_L.pos[1], GRIP_L.pos[2] - HAND_LOCAL_Z);
      left.rotation.set(...GRIP_L.rot);
      return;
    }

    if (attachedTo !== camera) {
      camera.add(right, left);
      attachedTo = camera;
    }

    const target = RIGHT_POSES[mode] ? mode : 'idle';
    lerpTo(cur.r, RIGHT_POSES[target], k);
    lerpTo(cur.l, mirror(RIGHT_POSES[target]), k);

    bobTime += dt * (isMoving ? 9 : 1.6);
    const bobAmp = isMoving ? 0.012 : 0.003;
    const bobX = Math.sin(bobTime) * bobAmp;
    // Bras en opposition de phase : quand l'un descend l'autre remonte,
    // comme un vrai balancement de marche — au lieu de plonger ensemble.
    const bobYr = Math.sin(bobTime) * bobAmp;
    const bobYl = -bobYr;

    right.position.set(cur.r.pos.x + bobX, cur.r.pos.y + bobYr, cur.r.pos.z);
    right.rotation.set(cur.r.rot.x, cur.r.rot.y, cur.r.rot.z);
    left.position.set(cur.l.pos.x - bobX, cur.l.pos.y + bobYl, cur.l.pos.z);
    left.rotation.set(cur.l.rot.x, cur.l.rot.y, cur.l.rot.z);
  }

  return {
    update,
    setVisible(v) { right.visible = v; left.visible = v; },
  };
}
