import * as THREE from 'three';

// Avant-bras low-poly en vue subjective : purement cosmétique. Les deux bras
// sont de VRAIS miroirs l'un de l'autre (une seule pose canonique « droite »,
// reflétée en X pour la gauche) — évite l'incohérence d'une paire asymétrique
// réglée à la main des deux côtés séparément.
//
// En mode arme, les mains deviennent de VRAIS enfants du porte-arme
// (weapon.js expose `holder`) au lieu de viser une pose fixe : elles
// héritent alors du recul, du balancement de course, du plongeon de
// rechargement et du coup de marteau sans aucun calcul de synchro — plus
// de main qui reste figée pendant que l'arme part en arrière au tir.
const SKIN = 0xe8c39e;
const SLEEVE = 0x3c4a5e; // manche de blouson, assortie au reste du perso

// Poses canoniques côté DROIT uniquement (position de l'origine du groupe +
// rotation). Le côté gauche est dérivé par mirror() ci-dessous.
// - repos : bras COMPLÈTEMENT baissés le long du corps → hors champ (on ne
//   voit pas ses avant-bras en regardant droit devant, comme en vrai)
// - course : bras remontés qui pompent en alternance (voir update)
const RIGHT_POSES = {
  idle: { pos: [0.26, -0.62, -0.18], rot: [1.25, -0.15, 0.1] }, // baissés, hors champ
  run: { pos: [0.2, -0.34, -0.3], rot: [0.62, -0.2, 0.12] }, // remontés pour courir
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
// NE PAS rallonger le bras pour gagner de la portée : à cette distance de
// la caméra, chaque centimètre de plus se voit énorme à l'écran et les
// poses au repos deviennent des planches (régression déjà vécue). C'est la
// compensation dans update() qui amène le poing au milieu de l'arme, pas
// la longueur du bras.
const HAND_LOCAL_Z = -0.35;

function buildArm(side) {
  const group = new THREE.Group();
  const skinMat = new THREE.MeshLambertMaterial({ color: SKIN });
  const sleeveMat = new THREE.MeshLambertMaterial({ color: SLEEVE });
  // Manche (proche de la caméra, donc de l'épaule)
  const sleeve = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.22), sleeveMat);
  sleeve.position.z = 0.03;
  group.add(sleeve);
  // Avant-bras nu (manche retroussée), puis main légèrement plus large + pouce.
  // Comble tout l'écart entre la manche et la main (voir HAND_LOCAL_Z).
  const forearmLen = (sleeve.position.z - 0.11) - (HAND_LOCAL_Z + 0.06);
  const forearm = new THREE.Mesh(new THREE.BoxGeometry(0.088, 0.088, forearmLen), skinMat);
  forearm.position.z = (sleeve.position.z - 0.11 + HAND_LOCAL_Z + 0.06) / 2;
  group.add(forearm);
  const hand = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.075, 0.12), skinMat);
  hand.position.z = HAND_LOCAL_Z;
  group.add(hand);
  const thumb = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.045, 0.075), skinMat);
  thumb.position.set(0, 0.045, HAND_LOCAL_Z + 0.03);
  group.add(thumb);

  // Équipement propre au jetpack : une petite manette serrée dans la main
  // et une mitraillette fixée sur le côté EXTÉRIEUR de l'avant-bras. Tout
  // reste enfant du bras, donc la bouche du canon visible est aussi la vraie
  // origine des traceurs utilisée par main.js.
  const jetGear = new THREE.Group();
  jetGear.visible = false;
  const controlMat = new THREE.MeshLambertMaterial({ color: 0x202733 });
  const gunMat = new THREE.MeshLambertMaterial({ color: 0x303945 });
  const barrelMat = new THREE.MeshLambertMaterial({ color: 0x11161d });
  const accentMat = new THREE.MeshLambertMaterial({ color: 0xd23b3b });

  const controlBase = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.045, 0.11), controlMat);
  controlBase.position.set(0, -0.055, HAND_LOCAL_Z + 0.025);
  jetGear.add(controlBase);
  const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.028, 0.13, 6), controlMat);
  stick.position.set(0, -0.005, HAND_LOCAL_Z - 0.005);
  stick.rotation.z = side * 0.08;
  jetGear.add(stick);
  const redButton = new THREE.Mesh(new THREE.SphereGeometry(0.022, 6, 4), accentMat);
  redButton.position.set(side * 0.018, 0.066, HAND_LOCAL_Z - 0.01);
  jetGear.add(redButton);

  const gunX = side * 0.082;
  const receiver = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.065, 0.27), gunMat);
  receiver.position.set(gunX, -0.012, -0.2);
  jetGear.add(receiver);
  const brace = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.1, 0.11), accentMat);
  brace.position.set(side * 0.057, -0.005, -0.13);
  jetGear.add(brace);
  for (const dy of [-0.018, 0.018]) {
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.25, 6), barrelMat);
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(gunX, dy - 0.012, -0.43);
    jetGear.add(barrel);
  }
  const muzzle = new THREE.Object3D();
  muzzle.position.set(gunX, -0.012, -0.565);
  jetGear.add(muzzle);
  const flash = new THREE.Mesh(
    new THREE.PlaneGeometry(0.105, 0.105),
    new THREE.MeshBasicMaterial({
      color: 0xffd27a, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false,
    })
  );
  flash.position.copy(muzzle.position);
  jetGear.add(flash);
  group.add(jetGear);
  return { group, jetGear, muzzle, flash };
}

// Poignée pistolet / garde-main de l'AK, repères locaux au porte-arme (voir
// buildAkModel dans weapon.js) : le POING (pas l'origine du groupe bras) doit
// tomber pile sur ces coordonnées — voir la compensation HAND_LOCAL_Z dans
// update(). La main droite/gauche s'accroche en vrai enfant du groupe plutôt
// que de recopier une position à la main chaque frame — elle hérite alors du
// recul/balancement/plongeon de rechargement sans AUCUN calcul de synchro.
// GRIP_R vise le milieu du fusil (boîtier de culasse), pas la poignée
// pistolet toute proche du corps — plus cohérent visuellement pour toutes
// les armes (pas juste l'AK) qui n'ont pas toutes une poignée au même endroit.
// Rotations franches : chaque bras ARRIVE EN BIAIS depuis son épaule (droite
// en bas à droite, gauche en bas à gauche) au lieu de flotter parallèle au
// canon — c'est l'angle qui vend la prise à deux mains.
const GRIP_R = { pos: [0.025, -0.06, -0.06], rot: [0.42, -0.38, 0.1] }; // poignée pistolet
const GRIP_L = { pos: [-0.02, -0.02, -0.38], rot: [0.3, 0.55, -0.12] }; // garde-main
const _fist = new THREE.Vector3();

export function createArms(camera) {
  const rightParts = buildArm(1);
  const leftParts = buildArm(-1);
  const right = rightParts.group;
  const left = leftParts.group;
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
    const jetpackActive = mode === 'jetpack';
    rightParts.jetGear.visible = jetpackActive;
    leftParts.jetGear.visible = jetpackActive;
    for (const flash of [rightParts.flash, leftParts.flash]) {
      flash.material.opacity = Math.max(0, flash.material.opacity - dt * 18);
      const s = 0.8 + flash.material.opacity * 0.8;
      flash.scale.setScalar(s);
    }

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
      // On positionne l'ORIGINE du groupe bras pour que le POING (bout du
      // bras, à HAND_LOCAL_Z le long de son axe TOURNÉ) tombe pile sur le
      // point de préhension — la rotation du bras est donc libre.
      for (const [arm, grip] of [[right, GRIP_R], [left, GRIP_L]]) {
        arm.rotation.set(...grip.rot);
        _fist.set(0, 0, HAND_LOCAL_Z).applyEuler(arm.rotation);
        arm.position.set(grip.pos[0] - _fist.x, grip.pos[1] - _fist.y, grip.pos[2] - _fist.z);
      }
      return;
    }

    if (attachedTo !== camera) {
      camera.add(right, left);
      attachedTo = camera;
    }

    // Au repos les bras tombent le long du corps (hors champ) ; ils ne
    // remontent que pour courir ou tenir quelque chose.
    const target = RIGHT_POSES[mode] ? mode : (isMoving ? 'run' : 'idle');
    lerpTo(cur.r, RIGHT_POSES[target], k);
    lerpTo(cur.l, mirror(RIGHT_POSES[target]), k);

    // En vol, les deux mains restent verrouillées sur leurs manettes : aucun
    // pompage de course, aucun balancement lié à la vitesse du joueur.
    if (jetpackActive) {
      right.position.copy(cur.r.pos);
      right.rotation.copy(cur.r.rot);
      left.position.copy(cur.l.pos);
      left.rotation.copy(cur.l.rot);
      return;
    }

    bobTime += dt * (isMoving ? 9 : 1.6);
    // Pompage de course en OPPOSITION DE PHASE, surtout avant/arrière (z)
    // comme un vrai jogging, avec un peu de vertical — presque rien à l'arrêt.
    const amp = isMoving ? 1 : 0.12;
    const swing = Math.sin(bobTime);
    const zR = swing * 0.085 * amp, zL = -zR;
    const yR = Math.cos(bobTime * 2) * 0.015 * amp;

    right.position.set(cur.r.pos.x, cur.r.pos.y + yR, cur.r.pos.z + zR);
    right.rotation.set(cur.r.rot.x + swing * 0.22 * amp, cur.r.rot.y, cur.r.rot.z);
    left.position.set(cur.l.pos.x, cur.l.pos.y - yR, cur.l.pos.z + zL);
    left.rotation.set(cur.l.rot.x - swing * 0.22 * amp, cur.l.rot.y, cur.l.rot.z);
  }

  return {
    update,
    setVisible(v) { right.visible = v; left.visible = v; },
    getJetpackMuzzles() {
      camera.updateWorldMatrix(true, true);
      return [rightParts.muzzle, leftParts.muzzle]
        .map((muzzle) => muzzle.getWorldPosition(new THREE.Vector3()));
    },
    pulseJetpackGuns() {
      for (const flash of [rightParts.flash, leftParts.flash]) {
        flash.material.opacity = 1;
        flash.rotation.z = Math.random() * Math.PI;
      }
    },
  };
}
