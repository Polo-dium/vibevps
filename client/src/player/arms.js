import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { PBR } from '../render/materials.js';

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
  // La pose est définie côté droit puis reflétée : seule la main GAUCHE est
  // affichée et tient la radio loin sur le bord gauche de l'écran.
  boombox: { pos: [0.36, -0.25, -0.38], rot: [0.3, -0.12, 0.08] },
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

function buildArm(side, { finger = false } = {}) {
  const group = new THREE.Group();
  const sleeveMat = PBR.fabric(SLEEVE);
  const cuffMat = PBR.fabric(0x2a3444);
  const gloveMat = PBR.glove(0x2b2d31);
  const padMat = PBR.polymer(0x17181b);
  const skinMat = PBR.skin(SKIN);
  const nailMat = finger ? PBR.skin(0xf3c9c0) : null;
  // Toutes les pièces du bras sont FUSIONNÉES par matériau à la fin (5 draw
  // calls par bras, quel que soit le nombre de phalanges).
  const parts = new Map(); // matériau → géométries déjà placées
  const _m4 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler();
  const add = (geo, mat, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) => {
    _m4.compose(new THREE.Vector3(x, y, z), _q.setFromEuler(_e.set(rx, ry, rz)), new THREE.Vector3(sx, sy, sz));
    const g = geo.clone().applyMatrix4(_m4);
    if (!parts.has(mat)) parts.set(mat, []);
    parts.get(mat).push(g);
  };
  // Cylindre couché le long du bras (axe z), r0 côté épaule, r1 côté main ;
  // (ex, ey) = section aplatie (un avant-bras n'est pas un tube)
  const limb = (r0, r1, z0, z1, mat, seg = 14, ex = 1, ey = 1) => {
    add(new THREE.CylinderGeometry(r0, r1, Math.abs(z1 - z0), seg), mat, 0, 0, (z0 + z1) / 2, Math.PI / 2, 0, 0, ex, 1, ey);
  };
  const HZ = HAND_LOCAL_Z;
  // Manche de veste jusqu'au poignet (même emprise qu'avant : de l'épaule
  // au poing), plus large que haute, deux plis de tissu, revers au poignet.
  const zShoulder = 0.14, zWrist = HZ + 0.07;
  limb(0.058, 0.046, zShoulder, zWrist + 0.02, sleeveMat, 16, 1.12, 0.92);
  for (const z of [-0.04, -0.15]) add(new THREE.TorusGeometry(0.05, 0.0055, 6, 18), sleeveMat, 0, 0, z, 0, 0, 0, 1.12, 0.92, 1.6);
  limb(0.05, 0.049, zWrist + 0.035, zWrist + 0.005, cuffMat, 16, 1.1, 0.94);
  limb(0.036, 0.034, zWrist + 0.01, zWrist - 0.012, skinMat, 12, 1.15, 0.85);
  // GANT : manchette resserrée par une patte, dos de main bombé, paume,
  // coque de protection sur les phalanges
  limb(0.041, 0.039, zWrist - 0.008, zWrist - 0.034, gloveMat, 14, 1.18, 0.88);
  add(new THREE.BoxGeometry(0.05, 0.006, 0.016), padMat, 0, 0.036, zWrist - 0.022);          // patte de serrage
  add(new THREE.CapsuleGeometry(0.036, 0.04, 4, 12), gloveMat, 0, 0, HZ, Math.PI / 2, 0, 0, 1.3, 1, 0.9); // paume + dos
  add(new THREE.SphereGeometry(0.03, 10, 8), gloveMat, side * -0.026, -0.012, HZ + 0.006, 0, 0, 0, 1, 0.8, 1.25); // éminence du pouce
  add(new THREE.BoxGeometry(0.078, 0.014, 0.03), padMat, 0, 0.034, HZ - 0.026);               // coque des phalanges
  // DOIGTS : trois phalanges chacun, enroulés autour de la poignée ; longueurs
  // vraies (majeur > index ≈ annulaire > auriculaire), léger éventail.
  // L'INDEX de la main droite reste tendu vers la détente.
  const seg = (r, len, mat, x, y, z, a) => { // phalange dans le plan (y, z), a = angle sous l'horizontale
    const dy = -Math.sin(a), dz = -Math.cos(a);
    add(new THREE.CapsuleGeometry(r, len, 3, 8), mat, x, y + dy * len / 2, z + dz * len / 2, Math.atan2(dz, dy));
    return [y + dy * len, z + dz * len];
  };
  for (let i = 0; i < 4; i++) {
    const k = side > 0 ? i : 3 - i;           // 0 = index (côté pouce) … 3 = auriculaire
    const x = -0.033 + i * 0.022 + (i - 1.5) * 0.0015;
    const L = [1, 1.09, 1, 0.8][k], R = [0.0115, 0.012, 0.0112, 0.0098][k];
    const trigger = side > 0 && k === 0;
    // (variante « doigt d'honneur » : majeur dressé dans l'axe du bras, les
    // autres serrés dans le poing)
    // Le majeur dressé sort NU d'un gant coupé (mitaine) : peau claire sur
    // gant noir, 30 % plus long, ongle — il se lit au premier coup d'œil.
    const bird = finger && k === 1;
    const curl = finger ? (bird ? [-0.04, -0.02, 0] : [1.25, 2.25, 2.9])
      : trigger ? [0.2, 0.75, 1.25] : [0.55 + k * 0.05, 1.6 + k * 0.04, 2.55];
    const fm = bird ? skinMat : gloveMat, Lb = bird ? L * 1.32 : L, Rb = bird ? R * 1.14 : R;
    add(new THREE.SphereGeometry(R * 1.18, 8, 6), gloveMat, x, 0.014, HZ - 0.04);              // articulation
    let [y, z] = seg(Rb, 0.03 * Lb, bird ? gloveMat : fm, x, 0.012, HZ - 0.04, curl[0]);
    if (bird) add(new THREE.TorusGeometry(Rb * 1.05, 0.003, 5, 12), padMat, x, y, z, Math.PI / 2); // bord de la mitaine
    add(new THREE.SphereGeometry(Rb * 1.05, 8, 6), fm, x, y, z);
    [y, z] = seg(Rb * 0.95, 0.021 * Lb, fm, x, y, z, curl[1]);
    add(new THREE.SphereGeometry(Rb * 0.97, 8, 6), fm, x, y, z);
    [y, z] = seg(Rb * 0.9, 0.016 * Lb, fm, x, y, z, curl[2]);
    if (bird) { // bout du doigt + ongle (dos de la main = +y)
      add(new THREE.SphereGeometry(Rb * 0.9, 8, 6), skinMat, x, y, z);
      add(new THREE.SphereGeometry(Rb * 0.78, 8, 6), nailMat, x, y + Rb * 0.42, z + 0.008, 0, 0, 0, 1, 0.35, 1.5);
    } else add(new THREE.SphereGeometry(R * 0.86, 6, 5), padMat, x, y, z);                   // pulpe renforcée
  }
  // POUCE en deux phalanges, rabattu le long de l'index
  add(new THREE.CapsuleGeometry(0.0135, 0.034, 3, 8), gloveMat, side * -0.041, -0.004, HZ - 0.03, Math.PI / 2 + 0.45, 0, side * 0.85);
  add(new THREE.CapsuleGeometry(0.0122, 0.024, 3, 8), gloveMat, side * -0.026, -0.016, HZ - 0.062, Math.PI / 2 + 0.75, 0, side * 0.35);
  add(new THREE.SphereGeometry(0.0115, 6, 5), padMat, side * -0.02, -0.024, HZ - 0.078);
  for (const [mat, geos] of parts) group.add(new THREE.Mesh(mergeGeometries(geos), mat));

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

// Radiocommande de l'avion RC (vue « pilote au sol ») : les poings viennent
// se poser sur les flancs de l'émetteur, pouces vers les manches — même
// compensation du poing que le mode arme, mais dans le repère caméra.
// (Attention : à z≈0.55 devant la caméra, tout ce qui descend sous ~30° de
// l'axe optique sort du champ en FOV 75 — garder l'émetteur vers -0.32.)
// Coudes écartés en bas d'écran, poings convergeant sur les flancs du
// boîtier : les avant-bras arrivent en biais (et pas dressés face à la
// caméra, où ils se liraient comme deux gros panneaux verticaux).
const RC_GRIP_R = { pos: [0.105, -0.33, -0.54], rot: [0.5, 0.47, -0.2] };
const RC_GRIP_L = { pos: [-0.105, -0.33, -0.54], rot: [0.5, -0.47, 0.2] };

// Émetteur : boîtier incliné vers le joueur, deux manches, antenne, diode.
function buildRcTransmitter() {
  const group = new THREE.Group();
  const bodyMat = new THREE.MeshLambertMaterial({ color: 0x2b333f });
  const stickMat = new THREE.MeshLambertMaterial({ color: 0x171c23 });
  const box = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.085, 0.2), bodyMat);
  group.add(box);
  for (const dx of [-0.085, 0.085]) {
    const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.016, 0.085, 6), stickMat);
    stick.position.set(dx, 0.075, 0.02);
    stick.rotation.x = 0.15;
    group.add(stick);
    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.017, 6, 5), stickMat);
    knob.position.set(dx, 0.117, 0.026);
    group.add(knob);
  }
  // Antenne claire, courte et bien penchée vers l'avant : elle ne doit
  // jamais barrer l'écran quand la caméra suit l'avion dans le ciel.
  const antenna = new THREE.Mesh(
    new THREE.CylinderGeometry(0.004, 0.005, 0.2, 5),
    new THREE.MeshLambertMaterial({ color: 0xb9c2cc })
  );
  antenna.position.set(-0.11, 0.1, -0.14);
  antenna.rotation.x = -0.95;
  group.add(antenna);
  const led = new THREE.Mesh(
    new THREE.SphereGeometry(0.011, 6, 5),
    new THREE.MeshBasicMaterial({ color: 0x53ff7a })
  );
  led.position.set(0.115, 0.048, 0.06);
  group.add(led);
  // Réduit et posé bas : l'émetteur occupe le bas de l'écran sans jamais
  // cacher le modèle qu'on suit du regard.
  group.scale.setScalar(0.62);
  group.position.set(0, -0.32, -0.55);
  group.rotation.x = 0.72; // plateau des manches tourné vers le regard
  return group;
}

export function createArms(camera) {
  const rightParts = buildArm(1);
  const leftParts = buildArm(-1);
  const right = rightParts.group;
  const left = leftParts.group;
  camera.add(right, left);
  let attachedTo = camera; // camera (poses lerpées), holder d'arme ou solRig
  let viewVisible = true;

  // Vue « pilote au sol » de l'avion RC : bras + émetteur vivent dans un
  // sous-groupe dédié, enfant de la caméra.
  const solRig = new THREE.Group();
  camera.add(solRig);
  const rcRadio = buildRcTransmitter();
  rcRadio.visible = false;
  solRig.add(rcRadio);

  // DOIGT D'HONNEUR (arène : deux éliminations d'affilée sur le même
  // adversaire) : un bras gauche à part, majeur dressé, qui monte devant
  // l'écran 1,7 s pendant que la main gauche lâche l'arme.
  const fingerArm = buildArm(-1, { finger: true }).group;
  fingerArm.visible = false;
  camera.add(fingerArm);
  let fingerT = 0;
  function updateFinger(dt) {
    if (fingerT <= 0) return;
    fingerT -= dt;
    const t = 1 - fingerT / 1.7;                                   // 0 → 1
    const up = Math.min(1, t / 0.14) * Math.min(1, (1 - t) / 0.16); // monte, tient, redescend
    const e = up * up * (3 - 2 * up);
    fingerArm.visible = fingerT > 0 && viewVisible;
    left.visible = false;
    // avant-bras dressé (poing en haut), dos de la main vers soi, PLEIN
    // CENTRE de l'écran, deux coups de poing secs vers l'adversaire
    const pump = t > 0.18 && t < 0.78 ? Math.max(0, Math.sin((t - 0.18) * Math.PI * 5)) : 0;
    fingerArm.position.set(-0.12, -0.62 + 0.38 * e, -0.4 - 0.05 * pump);
    fingerArm.rotation.set(1.3 + 0.12 * pump, 0.1, Math.PI);
    if (fingerT <= 0) { fingerArm.visible = false; left.visible = viewVisible; }
  }

  // IK de l'avant-bras d'une arme blanche (voir update) — repère monde
  const _F = new THREE.Vector3(), _S = new THREE.Vector3(), _D = new THREE.Vector3();
  const _qa = new THREE.Quaternion(), _qr = new THREE.Quaternion(), _qp = new THREE.Quaternion();
  const _Z = new THREE.Vector3(0, 0, -1), _er = new THREE.Euler();
  function ikArm(arm, pv, grip, side, w) {
    pv.updateWorldMatrix(true, false);
    _F.fromArray(grip.pos).sub(pv.userData.home);
    pv.localToWorld(_F);                                              // poing
    _S.set(side * 0.24, -0.46, 0.12);
    camera.localToWorld(_S);                                          // épaule
    _D.subVectors(_F, _S).normalize();
    pv.getWorldQuaternion(_qp);
    // bras aligné épaule → poing, roulis de la prise conservé
    _qa.setFromUnitVectors(_Z, _D.applyQuaternion(_qr.copy(_qp).invert()));
    _qa.multiply(_qr.setFromEuler(_er.set(0, 0, grip.rot[2])));
    arm.quaternion.slerp(_qa, w);
    // replace l'origine pour garder le poing sur la prise
    _F.fromArray(grip.pos).sub(pv.userData.home);
    _D.set(0, 0, HAND_LOCAL_Z).applyQuaternion(arm.quaternion);
    arm.position.copy(_F).sub(_D);
  }

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

  // mode : 'weapon' | 'boombox' | 'jetpack' | 'radiocommande' | 'idle'
  // weaponHolder : le groupe THREE de l'arme (weapon.js), lu en direct en
  // mode 'weapon' pour un calage parfait avec le recul/balancement/recharge.
  function update(dt, mode, isMoving, weaponHolder) {
    const k = 1 - Math.exp(-9 * dt);
    const jetpackActive = mode === 'jetpack';
    const boomboxActive = mode === 'boombox';
    const rcActive = mode === 'radiocommande';
    rcRadio.visible = rcActive;
    // La radio se porte d'une seule main : le bras droit reste totalement
    // hors champ, le gauche est tendu vers l'extérieur.
    right.visible = viewVisible && !boomboxActive;
    left.visible = viewVisible;
    rightParts.jetGear.visible = jetpackActive;
    leftParts.jetGear.visible = jetpackActive;
    for (const flash of [rightParts.flash, leftParts.flash]) {
      flash.material.opacity = Math.max(0, flash.material.opacity - dt * 18);
      const s = 0.8 + flash.material.opacity * 0.8;
      flash.scale.setScalar(s);
    }

    if (rcActive) {
      // Mains verrouillées sur les flancs de la radiocommande.
      if (attachedTo !== solRig) {
        solRig.add(right, left);
        attachedTo = solRig;
      }
      // Compense le zoom de la vue « pilote au sol » : écraser x et y par
      // 1/zoom en gardant z (la profondeur) rend la projection écran de
      // CHAQUE point identique au rendu sans zoom (x·f·zoom/z inchangé) —
      // bras et manette gardent taille et place quand la caméra zoome.
      const z = camera.zoom || 1;
      solRig.scale.set(1 / z, 1 / z, 1);
      for (const [arm, grip] of [[right, RC_GRIP_R], [left, RC_GRIP_L]]) {
        arm.rotation.set(...grip.rot);
        _fist.set(0, 0, HAND_LOCAL_Z).applyEuler(arm.rotation);
        arm.position.set(grip.pos[0] - _fist.x, grip.pos[1] - _fist.y, grip.pos[2] - _fist.z);
      }
      return;
    }

    if (mode === 'weapon' && weaponHolder) {
      // Les mains deviennent de VRAIS enfants du porte-arme (repères locaux
      // GRIP_R/GRIP_L, à l'échelle interne de holder — voir buildAkModel dans
      // weapon.js) : elles héritent alors automatiquement de tout ce que fait
      // holder chaque frame (bob, recul au tir, plongeon de rechargement,
      // coup de marteau) sans aucun calcul de synchro à maintenir ici.
      attachedTo = weaponHolder;
      // On positionne l'ORIGINE du groupe bras pour que le POING (bout du
      // bras, à HAND_LOCAL_Z le long de son axe TOURNÉ) tombe pile sur le
      // point de préhension — la rotation du bras est donc libre.
      // Une arme peut imposer SES prises (akimbo : chaque main sur son
      // pistolet) via holder.userData.grips, sinon prises fusil par défaut.
      // Armes blanches : `on` accroche la main au PIVOT de sa lame (melee.js,
      // prise exprimée dans le repère du porte-arme, pivot au repos sans
      // rotation) ; `cam` la laisse en garde sur la caméra.
      const custom = weaponHolder.userData?.grips;
      const pivots = weaponHolder.userData?.pivots;
      for (const [arm, grip] of [[right, custom?.r ?? GRIP_R], [left, custom?.l ?? GRIP_L]]) {
        const pv = grip.on ? pivots?.[grip.on] : null;
        const host = grip.cam ? camera : pv ?? weaponHolder;
        if (arm.parent !== host) host.add(arm);
        arm.rotation.set(...grip.rot);
        _fist.set(0, 0, HAND_LOCAL_Z).applyEuler(arm.rotation);
        arm.position.set(grip.pos[0] - _fist.x, grip.pos[1] - _fist.y, grip.pos[2] - _fist.z);
        if (pv) {
          arm.position.sub(pv.userData.home);
          // En plein geste, l'avant-bras ne tourne pas avec la lame : il
          // pointe de l'ÉPAULE vers le poing (IK minimale), seuls poignet
          // et lame pivotent. Mélangé à la prise de repos selon l'écart du
          // pivot (aucun changement à l'arrêt).
          const w = Math.min(1, 2 * Math.acos(Math.min(1, Math.abs(pv.quaternion.w))) / 0.35 +
            pv.position.distanceTo(pv.userData.home) / 0.06);
          if (w > 0.001) ikArm(arm, pv, grip, arm === right ? 1 : -1, w);
        } else if (grip.cam) { // garde : respire à peine, suit le balancement de course
          bobTime += dt * (isMoving ? 4.5 : 0.8);
          arm.position.y += Math.abs(Math.cos(bobTime)) * (isMoving ? 0.012 : 0.003);
        }
      }
      return;
    }

    if (attachedTo !== camera || right.parent !== camera || left.parent !== camera) {
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
    if (jetpackActive || boomboxActive) {
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
    update(...args) { update(...args); updateFinger(args[0]); },
    flipOff() { fingerT = 1.7; },
    setVisible(v) {
      viewVisible = Boolean(v);
      right.visible = viewVisible;
      left.visible = viewVisible;
    },
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
