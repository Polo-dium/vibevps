import * as THREE from 'three';

// Avant-bras low-poly en vue subjective : purement cosmétique (aucune
// interaction), attachés à la caméra comme l'arme/l'enceinte. La pose se
// détend vers une position différente selon ce que le joueur tient
// (arme, enceinte, jetpack) ou rien — lerp simple, pas d'IK.
const SKIN = 0xe8c39e;
const SLEEVE = 0x3c4a5e; // manche de blouson, assortie au reste du perso

const POSES = {
  idle: {
    r: { pos: [0.17, -0.36, -0.34], rot: [0.55, -0.25, 0.1] },
    l: { pos: [-0.17, -0.37, -0.35], rot: [0.55, 0.25, -0.1] },
  },
  weapon: {
    r: { pos: [0.24, -0.28, -0.44], rot: [0.35, -0.1, 0.05] },
    l: { pos: [0.06, -0.33, -0.58], rot: [0.5, 0.15, -0.05] },
  },
  boombox: {
    r: { pos: [-0.16, -0.32, -0.5], rot: [0.4, -0.5, 0.15] },
    l: { pos: [-0.48, -0.3, -0.54], rot: [0.4, 0.5, -0.15] },
  },
  jetpack: {
    r: { pos: [0.15, -0.18, -0.3], rot: [0.15, -0.35, 0.2] },
    l: { pos: [-0.15, -0.18, -0.3], rot: [0.15, 0.35, -0.2] },
  },
};

function buildArm(mirror) {
  const group = new THREE.Group();
  const skinMat = new THREE.MeshLambertMaterial({ color: SKIN });
  const sleeveMat = new THREE.MeshLambertMaterial({ color: SLEEVE });
  const sleeve = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.26), sleeveMat);
  sleeve.position.z = -0.02;
  group.add(sleeve);
  const forearm = new THREE.Mesh(new THREE.BoxGeometry(0.085, 0.085, 0.22), skinMat);
  forearm.position.z = -0.24;
  group.add(forearm);
  const hand = new THREE.Mesh(new THREE.BoxGeometry(0.095, 0.075, 0.11), skinMat);
  hand.position.z = -0.37;
  group.add(hand);
  group.userData.mirror = mirror;
  return group;
}

export function createArms(camera) {
  const right = buildArm(1);
  const left = buildArm(-1);
  camera.add(right, left);

  let bobTime = 0;
  const cur = {
    r: { pos: new THREE.Vector3(...POSES.idle.r.pos), rot: new THREE.Euler(...POSES.idle.r.rot) },
    l: { pos: new THREE.Vector3(...POSES.idle.l.pos), rot: new THREE.Euler(...POSES.idle.l.rot) },
  };

  function lerpSide(side, target, k) {
    const t = POSES[target][side];
    const c = cur[side];
    c.pos.x += (t.pos[0] - c.pos.x) * k;
    c.pos.y += (t.pos[1] - c.pos.y) * k;
    c.pos.z += (t.pos[2] - c.pos.z) * k;
    c.rot.x += (t.rot[0] - c.rot.x) * k;
    c.rot.y += (t.rot[1] - c.rot.y) * k;
    c.rot.z += (t.rot[2] - c.rot.z) * k;
  }

  // mode : 'weapon' | 'boombox' | 'jetpack' | 'idle'
  function update(dt, mode, isMoving) {
    const target = POSES[mode] ? mode : 'idle';
    const k = 1 - Math.exp(-9 * dt);
    lerpSide('r', target, k);
    lerpSide('l', target, k);

    bobTime += dt * (isMoving ? 9 : 1.6);
    const bobX = Math.sin(bobTime) * (isMoving ? 0.012 : 0.003);
    const bobY = Math.abs(Math.cos(bobTime)) * (isMoving ? 0.01 : 0.003);

    right.position.set(cur.r.pos.x + bobX, cur.r.pos.y - bobY, cur.r.pos.z);
    right.rotation.set(cur.r.rot.x, cur.r.rot.y, cur.r.rot.z);
    left.position.set(cur.l.pos.x - bobX, cur.l.pos.y - bobY, cur.l.pos.z);
    left.rotation.set(cur.l.rot.x, cur.l.rot.y, cur.l.rot.z);
  }

  return {
    update,
    setVisible(v) { right.visible = v; left.visible = v; },
  };
}
