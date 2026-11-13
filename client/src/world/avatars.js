import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { detail } from '../render/detail.js';

// AVATARS RÉALISTES (Microsoft Rocketbox, licence MIT — voir
// client/public/avatars/LICENSE-rocketbox.md) : passants et PNJ causeurs.
// Fichiers GLB préparés hors ligne (maillage soudé, textures 512 px) ; les
// animations (repos, marche sur place, conversation) sont dans UN fichier
// par silhouette (anim_f / anim_m), partagé : même squelette Bip01 pour tous.
// Chargés en tâche de fond après le démarrage ; tant qu'ils ne sont pas là
// (ou au palier Bas), les humains sculptés (human.js) restent en place.

export const CROWD = {
  f: ['female_adult_01', 'female_adult_02', 'female_adult_03', 'female_adult_04', 'female_adult_05', 'female_adult_06'],
  m: ['male_adult_01', 'male_adult_08', 'male_adult_03', 'male_adult_04', 'male_adult_05', 'male_adult_06'],
};
const isFem = (name) => /female/.test(name);
// Hors palier Élevé, on s'en tient à 3 femmes + 3 hommes (+ Lucie et
// Kévin) : un autre nom est ramené au plus proche de ce jeu (même sexe)
const LIGHT = new Set([...CROWD.f.slice(0, 4), ...CROWD.m.slice(0, 4), 'business_female_01', 'sports_male_01', 'military_male_02']);
function pickName(name) {
  if (detail.level === 'eleve' || LIGHT.has(name)) return name;
  if (/military/.test(name)) return 'military_male_02';
  const list = (isFem(name) ? CROWD.f : CROWD.m).slice(0, 4);
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return list[h % list.length];
}

// Distribution des avatars des JOUEURS et des bots : des militaires en
// treillis (Rocketbox « Professions »). Le même pseudo donne toujours le
// même personnage, chez tout le monde — y compris pour soi (corps à la 1re
// personne, killcam). Hors palier Élevé, pickName les ramène tous au modèle
// le plus léger (military_male_02 : 8 000 triangles, 2 textures).
const PLAYER_CAST = ['military_male_02', 'military_male_04', 'military_female_01', 'military_male_01'];
export function avatarFor(pseudo) {
  let h = 0;
  for (const ch of String(pseudo)) h = (h * 31 + ch.codePointAt(0)) >>> 0;
  return PLAYER_CAST[h % PLAYER_CAST.length];
}

let loaderP = null;
const getLoader = () => (loaderP ??= import('three/addons/loaders/GLTFLoader.js').then(({ GLTFLoader }) => new GLTFLoader()));
const models = new Map(); // nom → Promise<{ scene }>
const anims = new Map(); // 'f' | 'm' → Promise<AnimationClip[]>

// Hors palier Élevé : textures ramenées de 512 à 256 px (4 fois moins de
// mémoire vidéo par personnage, invisible à l'échelle d'un passant)
const halved = new Map();
function halfTexture(tex) {
  const img = tex?.image;
  if (!img || (img.width ?? 0) <= 256) return tex ?? null;
  if (halved.has(tex)) return halved.get(tex);
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  c.getContext('2d').drawImage(img, 0, 0, 256, 256);
  const t = new THREE.CanvasTexture(c);
  t.flipY = tex.flipY;
  t.colorSpace = tex.colorSpace;
  t.wrapS = tex.wrapS; t.wrapT = tex.wrapT;
  halved.set(tex, t);
  return t;
}

// Suivi pour le diagnostic (touche le texte en haut à gauche) et les ombres
// de contact : tous les groupes d'avatars vivants, et combien ont été
// animés depuis la dernière lecture.
export const avatarStats = { groups: [], models: [], animated: 0, drawn: 0 };

// TRI DES AVATARS HORS CHAMP. Leurs maillages ne sont pas triés par three.js
// (frustumCulled = false : la boîte englobante d'un maillage à peau ne suit
// pas l'animation) — sans ce tri, CHAQUE avatar de la ville était envoyé au
// GPU à chaque image, même dans le dos du joueur ou à des kilomètres (les
// bots de l'arène vus depuis la ville, et inversement). On masque donc le
// MODÈLE (jamais le groupe, que le code du monde pilote) dès qu'il sort du
// champ de la caméra ou dépasse `maxDist`. À appeler une fois par image.
const _fr = new THREE.Frustum(), _pm = new THREE.Matrix4(), _sp = new THREE.Sphere();
export function cullAvatars(camera, maxDist = 130, radius = 1.6) {
  _pm.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
  _fr.setFromProjectionMatrix(_pm);
  const cp = camera.position, max2 = maxDist * maxDist;
  let drawn = 0;
  const list = avatarStats.models;
  for (let i = list.length - 1; i >= 0; i--) {
    const m = list[i];
    if (!m.parent) { list.splice(i, 1); continue; }
    const e = m.matrixWorld.elements;
    const dx = e[12] - cp.x, dy = e[13] - cp.y, dz = e[14] - cp.z;
    let on = dx * dx + dy * dy + dz * dz < max2;
    if (on) {
      _sp.center.set(e[12], e[13] + 0.95, e[14]);
      _sp.radius = radius;
      on = _fr.intersectsSphere(_sp);
    }
    if (m.visible !== on) m.visible = on;
    if (on) drawn++;
  }
  avatarStats.drawn = drawn;
}
let viewer = null; // () => position du joueur (LOD d'animation)
export function setAvatarViewer(fn) { viewer = fn; }

function loadModel(name) {
  if (!models.has(name)) {
    models.set(name, getLoader().then((l) => l.loadAsync(`/avatars/${name}.glb`)).then((g) => {
      // Matériaux plus légers hors palier Élevé (Lambert, comme le décor)
      g.scene.traverse((o) => {
        if (!o.isMesh) return;
        // Ombre portée au palier Élevé seulement : dans la carte d'ombre,
        // chaque avatar se redessine (3 à 5 draw calls + sa peau recalculée).
        // Ailleurs, une ombre de contact ronde le pose au sol (render/blobs.js).
        o.castShadow = detail.high;
        o.receiveShadow = false;
        o.frustumCulled = false; // volume fixe posé sur le groupe (voir plus bas)
        if (!detail.high) {
          o.material = [].concat(o.material).map((m) => new THREE.MeshLambertMaterial({
            name: m.name, map: halfTexture(m.map), alphaTest: m.alphaTest, side: m.side,
          }));
          if (o.material.length === 1) o.material = o.material[0];
        }
      });
      return g;
    }));
  }
  return models.get(name);
}

function loadAnims(sex) {
  if (!anims.has(sex)) {
    anims.set(sex, getLoader().then((l) => l.loadAsync(`/avatars/anim_${sex}.glb`)).then((g) => g.animations));
  }
  return anims.get(sex);
}

// Précharge : ces avatars (et leurs animations) arrivent l'un après l'autre
export async function preloadAvatars(names) {
  const ok = [];
  for (const n of names) {
    try {
      await Promise.all([loadModel(n), loadAnims(isFem(n) ? 'f' : 'm')]);
      ok.push(n);
    } catch (err) {
      console.warn('Avatar indisponible :', n, err?.message ?? err);
    }
  }
  return ok;
}

// Instance prête à poser : même interface que buildHuman() pour ce que les
// passants et les PNJ utilisent (group, hitMeshes, animate, clearTint,
// shirtMat pour le flash de dégâts) + talk(on) pour gesticuler.
// { seated: true } : assis à une table (clip `sit`, terrasses).
export async function buildAvatar(name0, { seated = false } = {}) {
  const name = pickName(name0);
  const [gltf, clips] = await Promise.all([loadModel(name), loadAnims(isFem(name) ? 'f' : 'm')]);
  const model = cloneSkinned(gltf.scene);
  // les modèles regardent +z ; convention du jeu : regard vers -z au repos
  model.rotation.y = Math.PI;
  const group = new THREE.Group();
  group.add(model);
  const meshes = [];
  // matériaux propres à l'instance (le flash rouge ne doit teinter qu'elle) ;
  // textures et géométries restent partagées
  const tintable = [];
  model.traverse((o) => {
    if (!o.isMesh) return;
    o.material = Array.isArray(o.material) ? o.material.map((m) => m.clone()) : o.material.clone();
    tintable.push(...[].concat(o.material));
    meshes.push(o);
  });
  const mixer = new THREE.AnimationMixer(model);
  const act = {};
  for (const c of clips) act[c.name] = mixer.clipAction(c);
  const rest = (seated && act.sit) || act.idle;
  rest?.play();
  let cur = rest, talking = false;
  // décale chaque instance dans ses boucles (pas de foule synchronisée)
  mixer.setTime(Math.random() * 5);
  const to = (a, fade = 0.35) => {
    if (!a || a === cur) return;
    a.reset().play();
    if (cur) a.crossFadeFrom(cur, fade, true);
    cur = a;
  };
  let last = performance.now(), skip = 0, acc = 0;
  // Marche : la vitesse de lecture suit la vitesse au sol (la marche
  // Rocketbox fait ~1,35 m/s). speed > 0.3 → marche, sinon repos/causette.
  // `speed` arrive au format de human.js (m/s × 2,6) : on le ramène.
  function animate(_phase, speed) {
    if (rag.on) return; // mort : le squelette appartient au ragdoll
    const now = performance.now();
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    const v = speed / 2.6;
    if (seated) { /* reste assis */ } else if (group.userData.crouch && act.crouch) {
      // accroupi (capture de mouvement : le bassin descend vraiment)
      to(act.crouch, 0.18);
    } else if (v > 2.7 && act.run) {
      // course (≈ 3,8 m/s à vitesse de lecture 1) : la foulée suit la vitesse
      to(act.run, 0.18);
      act.run.timeScale = Math.max(0.8, Math.min(1.7, v / 3.8));
    } else if (v > 0.3) {
      to(act.walk, 0.25);
      if (act.walk) act.walk.timeScale = Math.max(0.6, Math.min(2.0, v / 1.35));
    } else to(talking ? act.talk : act.idle);
    // Loin du joueur, l'animation ralentit sa cadence : une image sur trois
    // au-delà de 30 m, une sur huit au-delà de 70 m (le temps écoulé est
    // rattrapé d'un coup : la démarche reste juste, seulement moins fluide)
    let every = !model.visible ? 8 : group.userData.far ? 3 : 1; // hors champ : au ralenti
    const vp = group.parent && viewer?.();
    if (vp) {
      const e = group.matrixWorld.elements;
      const d2 = (e[12] - vp.x) ** 2 + (e[14] - vp.z) ** 2;
      every = d2 > 4900 ? 8 : d2 > 900 ? 3 : every;
    }
    acc += dt;
    if ((skip = (skip + 1) % every) !== 0) return;
    avatarStats.animated++;
    mixer.update(acc);
    acc = 0;
    group.position.y = group.userData.baseY ?? group.position.y;
  }
  // ARME EN MAIN (joueurs distants et bots, voir player/remotes.js) : après
  // l'animation, les deux bras sont ramenés en position de tir — chaque os
  // est tourné pour que son segment pointe dans la direction voulue (aucune
  // hypothèse sur le repère des os). L'arme se pose sur `armR`, un support
  // du groupe recalé sur la main droite, toujours pointé vers l'avant.
  const bone = (n) => model.getObjectByName(n);
  const arm = {
    r: [bone('Bip01_R_UpperArm'), bone('Bip01_R_Forearm'), bone('Bip01_R_Hand')],
    l: [bone('Bip01_L_UpperArm'), bone('Bip01_L_Forearm'), bone('Bip01_L_Hand')],
  };
  const canPose = [...arm.r, ...arm.l].every(Boolean);
  const armR = new THREE.Group();
  armR.position.set(0.16, 1.25, -0.3);
  group.add(armR);
  let armed = false, kick = 0, armKind = 'fusil';
  const bands = [];
  const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _d = new THREE.Vector3();
  const _q = new THREE.Quaternion(), _qw = new THREE.Quaternion(), _qp = new THREE.Quaternion(), _qg = new THREE.Quaternion();
  function aimBone(b, child, x, y, z) {
    b.updateWorldMatrix(true, true);
    b.getWorldPosition(_a);
    child.getWorldPosition(_b);
    _b.sub(_a).normalize();
    _d.set(x, y, z).normalize().applyQuaternion(_qg); // direction voulue, repère du groupe → monde
    _q.setFromUnitVectors(_b, _d);
    b.getWorldQuaternion(_qw).premultiply(_q);
    b.parent.getWorldQuaternion(_qp).invert();
    b.quaternion.copy(_qp.multiply(_qw));
  }
  // RAGDOLL à la mort : 15 points (bassin, cou, tête, épaules, coudes, mains,
  // hanches, genoux, pieds) reliés par des tiges (intégration de Verlet,
  // gravité, sol, frottement). Le tronc est contreventé (il reste d'un bloc),
  // les membres pendent et se plient. Chaque image, le groupe est tourné et
  // déplacé pour que le tronc suive ses points, puis chaque os de membre est
  // pointé le long de sa tige (même principe que aimBone : aucune hypothèse
  // sur le repère des os). ~0,05 ms par corps, 2,6 s au plus.
  const RAG_BONES = ['Bip01_Pelvis', 'Bip01_Neck', 'Bip01_Head',
    'Bip01_L_UpperArm', 'Bip01_L_Forearm', 'Bip01_L_Hand', 'Bip01_R_UpperArm', 'Bip01_R_Forearm', 'Bip01_R_Hand',
    'Bip01_L_Thigh', 'Bip01_L_Calf', 'Bip01_L_Foot', 'Bip01_R_Thigh', 'Bip01_R_Calf', 'Bip01_R_Foot'].map(bone);
  const RAG_LINKS = [[0, 1], [1, 2], [1, 3], [1, 6], [3, 6], [0, 9], [0, 12], [9, 12], [3, 9], [6, 12], [3, 12], [6, 9],
    [3, 4], [4, 5], [6, 7], [7, 8], [9, 10], [10, 11], [12, 13], [13, 14]];
  const RAG_LIMBS = [[1, 2], [3, 4], [4, 5], [6, 7], [7, 8], [9, 10], [10, 11], [12, 13], [13, 14]]; // os → enfant
  const rag = {
    on: false, ok: RAG_BONES.every(Boolean), p: new Float32Array(45), q: new Float32Array(45), len: new Float32Array(RAG_LINKS.length),
    acc: 0, m0: new THREE.Matrix4(), q0: new THREE.Quaternion(),
  };
  const _rx = new THREE.Vector3(), _ry = new THREE.Vector3(), _rz = new THREE.Vector3(), _rm = new THREE.Matrix4(), _rq = new THREE.Quaternion();
  function torsoBasis(P, out) {
    _ry.set(P[3] - P[0], P[4] - P[1], P[5] - P[2]).normalize();          // bassin → cou
    _rx.set(P[18] - P[9], P[19] - P[10], P[20] - P[11]);                  // épaule G → épaule D
    _rx.addScaledVector(_ry, -_rx.dot(_ry)).normalize();
    _rz.crossVectors(_rx, _ry);
    return out.makeBasis(_rx, _ry, _rz);
  }
  function ragStart(dx, dz) {
    if (!rag.ok) return false;
    group.updateWorldMatrix(true, true);
    const P = rag.p, Q = rag.q;
    RAG_BONES.forEach((b, i) => { b.getWorldPosition(_a); P[i * 3] = _a.x; P[i * 3 + 1] = _a.y; P[i * 3 + 2] = _a.z; });
    RAG_LINKS.forEach(([a, b], k) => { rag.len[k] = Math.hypot(P[a * 3] - P[b * 3], P[a * 3 + 1] - P[b * 3 + 1], P[a * 3 + 2] - P[b * 3 + 2]); });
    torsoBasis(P, rag.m0).invert();
    rag.q0.copy(group.quaternion);
    // élan : le haut du corps part dans le sens du tir, les genoux lâchent
    const l = Math.hypot(dx, dz) || 1, ux = dx / l, uz = dz / l, h = 1 / 60;
    for (let i = 0; i < 15; i++) {
      const k = i === 2 ? 3.4 : i === 1 || i === 3 || i === 6 ? 2.7 : i === 0 ? 1.3 : i === 10 || i === 13 ? -0.9 : 0.5;
      Q[i * 3] = P[i * 3] - (ux * k + (Math.random() - 0.5) * 0.7) * h;
      Q[i * 3 + 1] = P[i * 3 + 1] - (i < 9 ? 0.9 : 0) * h;
      Q[i * 3 + 2] = P[i * 3 + 2] - (uz * k + (Math.random() - 0.5) * 0.7) * h;
    }
    rag.acc = 0;
    rag.on = true;
    return true;
  }
  function ragSim(gy) {
    const P = rag.p, Q = rag.q, h = 1 / 60;
    for (let i = 0; i < 15; i++) {
      const o = i * 3;
      const vx = (P[o] - Q[o]) * 0.985, vy = (P[o + 1] - Q[o + 1]) * 0.985 - 15 * h * h, vz = (P[o + 2] - Q[o + 2]) * 0.985;
      Q[o] = P[o]; Q[o + 1] = P[o + 1]; Q[o + 2] = P[o + 2];
      P[o] += vx; P[o + 1] += vy; P[o + 2] += vz;
    }
    for (let it = 0; it < 7; it++) {
      for (let k = 0; k < RAG_LINKS.length; k++) {
        const a = RAG_LINKS[k][0] * 3, b = RAG_LINKS[k][1] * 3;
        const dx = P[b] - P[a], dy = P[b + 1] - P[a + 1], dz = P[b + 2] - P[a + 2];
        const d = Math.hypot(dx, dy, dz) || 1e-6, f = ((d - rag.len[k]) / d) * 0.5;
        P[a] += dx * f; P[a + 1] += dy * f; P[a + 2] += dz * f;
        P[b] -= dx * f; P[b + 1] -= dy * f; P[b + 2] -= dz * f;
      }
      for (let i = 0; i < 15; i++) {
        const o = i * 3, floor = gy + (i === 2 ? 0.11 : 0.07);
        if (P[o + 1] < floor) {
          P[o + 1] = floor;
          // frottement au sol : le corps ne glisse pas comme sur de la glace
          Q[o] += (P[o] - Q[o]) * 0.35; Q[o + 2] += (P[o + 2] - Q[o + 2]) * 0.35;
        }
      }
    }
  }
  function aimWorld(b, child, x, y, z) {
    b.updateWorldMatrix(true, true);
    b.getWorldPosition(_a);
    child.getWorldPosition(_b);
    _b.sub(_a).normalize();
    _d.set(x, y, z).normalize();
    _q.setFromUnitVectors(_b, _d);
    b.getWorldQuaternion(_qw).premultiply(_q);
    b.parent.getWorldQuaternion(_qp).invert();
    b.quaternion.copy(_qp.multiply(_qw));
  }
  function ragStep(dt, gy) {
    if (!rag.on) return;
    rag.acc = Math.min(0.25, rag.acc + dt); // jusqu'à 15 pas d'un coup : la chute ne ralentit pas à bas débit d'images
    while (rag.acc >= 1 / 60) { ragSim(gy); rag.acc -= 1 / 60; }
    const P = rag.p;
    // tronc : rotation du groupe = (repère actuel) × (repère au départ)⁻¹
    torsoBasis(P, _rm).multiply(rag.m0);
    group.quaternion.setFromRotationMatrix(_rm).multiply(rag.q0);
    group.updateWorldMatrix(true, true);
    RAG_BONES[0].getWorldPosition(_a);
    group.position.x += P[0] - _a.x; group.position.y += P[1] - _a.y; group.position.z += P[2] - _a.z;
    for (const [i, j] of RAG_LIMBS) {
      aimWorld(RAG_BONES[i], RAG_BONES[j], P[j * 3] - P[i * 3], P[j * 3 + 1] - P[i * 3 + 1], P[j * 3 + 2] - P[i * 3 + 2]);
    }
  }
  function poseArmed() {
    if (!armed || !canPose || rag.on) return;
    group.getWorldQuaternion(_qg);
    // (repère du groupe : -z = devant, +x = à droite du personnage)
    // + secousse de recul à chaque coup (kick, retombe en ~0,15 s)
    const k = kick;
    kick = Math.max(0, kick - 0.14);
    // UNE POSE PAR FAMILLE D'ARME (armKind, donné par remotes.js) :
    //  fusil  : crosse à l'épaule, main gauche sous le garde-main
    //  double : un pistolet / une dague par main, bras tendus écartés
    //  melee  : arme au poing droit, en garde ; le bras gauche garde son animation
    //  lance  : lance couchée à la hanche, bouclier porté devant par le bras gauche
    const hand = (b) => { b.updateWorldMatrix(true, false); b.getWorldPosition(_a); return group.worldToLocal(_a); };
    if (armKind === 'double') {
      aimBone(arm.r[0], arm.r[1], 0.05, -0.34 + k * 0.2, -0.94);
      aimBone(arm.r[1], arm.r[2], -0.02, 0.06 + k * 0.4, -1);
      aimBone(arm.l[0], arm.l[1], -0.05, -0.34 + k * 0.2, -0.94);
      aimBone(arm.l[1], arm.l[2], 0.02, 0.06 + k * 0.4, -1);
      // les deux armes du modèle sont à ±16 cm : support au milieu des mains
      const r = hand(arm.r[2]).clone(), l = hand(arm.l[2]);
      armR.position.set((r.x + l.x) / 2, (r.y + l.y) / 2 + 0.05, (r.z + l.z) / 2 + 0.1);
      return;
    }
    if (armKind === 'melee') {
      aimBone(arm.r[0], arm.r[1], 0.22, -0.7, -0.68);
      aimBone(arm.r[1], arm.r[2], -0.12, 0.25 + k * 0.5, -0.96);
      const r = hand(arm.r[2]);
      armR.position.set(r.x, r.y + 0.03, r.z - 0.03);
      return;
    }
    if (armKind === 'lance') {
      aimBone(arm.r[0], arm.r[1], 0.25, -0.86, -0.45);
      aimBone(arm.r[1], arm.r[2], 0.0, -0.12, -1);
      aimBone(arm.l[0], arm.l[1], -0.2, -0.62, -0.76);
      aimBone(arm.l[1], arm.l[2], 0.55, 0.3, -0.78);
      const r = hand(arm.r[2]);
      armR.position.set(r.x - 0.1, r.y, r.z);
      return;
    }
    aimBone(arm.r[0], arm.r[1], 0.12, -0.72, -0.68 + k * 0.25);
    aimBone(arm.r[1], arm.r[2], -0.42, 0.18 + k * 0.5, -0.89);
    aimBone(arm.l[0], arm.l[1], 0.1, -0.5, -0.86 + k * 0.2);
    aimBone(arm.l[1], arm.l[2], 0.62, 0.22 + k * 0.5, -0.75);
    // support de l'arme : calé sur la main droite (poignée ≈ origine du modèle)
    arm.r[2].updateWorldMatrix(true, false);
    arm.r[2].getWorldPosition(_a);
    group.worldToLocal(_a);
    armR.position.set(_a.x - 0.03, _a.y + 0.1, _a.z + 0.16);
  }
  // DOIGT D'HONNEUR (deux éliminations d'affilée sur le même adversaire) :
  // le bras gauche se lève, avant-bras dressé, et un poing au majeur tendu
  // vient coiffer la main (les doigts du squelette ne sont pas pilotés un à
  // un : la pièce rapportée fait le geste, lisible de loin).
  let flipT = 0, flipLast = 0, flipProp = null;
  function poseFlip() {
    if (flipT <= 0 || rag.on) { if (flipProp) flipProp.visible = false; return; }
    const now = performance.now();
    flipT -= Math.min(0.1, (now - flipLast) / 1000);
    flipLast = now;
    if (!flipProp) {
      flipProp = new THREE.Group();
      const skin = new THREE.MeshLambertMaterial({ color: 0xcf9f7c });
      const fist = new THREE.Mesh(new THREE.SphereGeometry(0.058, 10, 8), skin);
      fist.scale.set(1.2, 0.95, 0.95);
      // rangée de phalanges repliées (le poing se lit comme un poing) et
      // majeur EXAGÉRÉ, lisible à 30 m
      const knuckles = new THREE.Mesh(new THREE.CapsuleGeometry(0.022, 0.07, 3, 8), skin);
      knuckles.rotation.z = Math.PI / 2;
      knuckles.position.set(0, 0.035, -0.035);
      const majeur = new THREE.Mesh(new THREE.CapsuleGeometry(0.019, 0.13, 3, 8), skin);
      majeur.position.y = 0.12;
      flipProp.add(fist, knuckles, majeur);
      flipProp.traverse((o) => { o.frustumCulled = false; });
      group.add(flipProp);
    }
    const t = 1 - Math.max(0, flipT) / 1.7;
    const up = Math.min(1, t / 0.15) * Math.min(1, (1 - t) / 0.15);
    group.getWorldQuaternion(_qg);
    // (repère du groupe : -z = devant, -x = à gauche du personnage)
    aimBone(arm.l[0], arm.l[1], -0.3, -0.55 + 0.8 * up, -0.75);
    aimBone(arm.l[1], arm.l[2], -0.05, -0.3 + 1.3 * up, -0.35);
    arm.l[2].updateWorldMatrix(true, false);
    arm.l[2].getWorldPosition(_a);
    group.worldToLocal(_a);
    flipProp.position.set(_a.x, _a.y + 0.05, _a.z);
    flipProp.visible = flipT > 0 && up > 0.5;
  }
  const animate0 = animate;
  const emi = new THREE.Color(0);
  const red = new THREE.Color(0xffffff);
  avatarStats.groups.push(group);
  avatarStats.models.push(model);
  return {
    armR,
    // ragdoll : start(dx, dz) = sens de la poussée ; step(dt, solY) ; stop()
    ragdollStart: ragStart,
    ragdollStep: ragStep,
    ragdollStop() { rag.on = false; },
    // hauteur monde de la poitrine (sang, cris)
    chestY() { return rag.ok ? RAG_BONES[1].getWorldPosition(_a).y : group.position.y + 1.3; },
    setArmed(on, kind = 'fusil') { armed = Boolean(on); armKind = kind; },
    // BRASSARD D'ÉQUIPE : un anneau de couleur franche autour de chaque bras
    // (null = retiré). Posé sur l'os du bras, orienté le long du segment
    // bras → avant-bras, dimensionné d'après l'échelle monde de l'os.
    setBand(hex) {
      if (hex == null) { for (const b of bands) b.visible = false; return; }
      if (!bands.length && canPose) {
        const mat = new THREE.MeshBasicMaterial({ color: hex });
        const up = new THREE.Vector3(0, 1, 0), s = new THREE.Vector3();
        for (const side of [arm.r, arm.l]) {
          const [upper, fore] = side;
          upper.updateWorldMatrix(true, false);
          const k = 1 / (upper.getWorldScale(s).x || 1); // mètres → unités de l'os
          const band = new THREE.Mesh(new THREE.CylinderGeometry(0.062 * k, 0.062 * k, 0.07 * k, 12, 1, true), mat);
          band.material.side = THREE.DoubleSide;
          const dir = fore.position.clone();
          band.position.copy(dir).multiplyScalar(0.45);
          band.quaternion.setFromUnitVectors(up, dir.normalize());
          band.userData.noShadow = true;
          band.frustumCulled = false;
          upper.add(band);
          bands.push(band);
        }
      }
      for (const b of bands) { b.visible = true; b.material.color.setHex(hex); }
    },
    kickShot() { kick = 1; },
    model, bone,
    animateArmed(phase, speed) { animate0(phase, speed); poseArmed(); poseFlip(); },
    // doigt d'honneur (1,7 s) : vu par tous les joueurs, voir remotes.js
    flipOff() { if (canPose) { flipT = 1.7; flipLast = performance.now(); } },
    group,
    mesh: meshes[0],
    hitMeshes: meshes,
    animate,
    talk(on) { talking = on; },
    // flash de dégâts : teinte tous les matériaux de l'instance
    shirtMat: {
      color: { set(c) { red.set(c); for (const m of tintable) m.color.copy(red); }, setHex(h) { red.setHex(h); for (const m of tintable) m.color.copy(red); } },
      // lueur (équipes, néon de nuit) : même écriture que sur un matériau
      emissive: {
        copy(c) { emi.copy(c); return this; },
        multiplyScalar(k) { emi.multiplyScalar(k); for (const m of tintable) m.emissive?.copy(emi); return this; },
      },
    },
    clearTint() { for (const m of tintable) m.color.setHex(0xffffff); },
    isAvatar: true,
  };
}

// Avatars activés ? Pas au palier Bas (téléphones modestes) ni sans WebGL2
export const avatarsEnabled = () => detail.level !== 'bas';

// REMPLACEMENT SUR PLACE : l'humain sculpté `human` (objet rendu par
// buildHuman) devient un avatar SANS changer de groupe ni d'objet — le code
// qui le déplace, l'anime, le teinte ou lui a accroché une bulle, un
// parapluie ou une étiquette n'y voit que du feu. On retire son maillage,
// on glisse le modèle de l'avatar dans le même groupe et on rebranche
// animate / shirtMat / clearTint / hitMeshes (les réactions aux tirs
// passent sur les nouveaux maillages). speedScale : 2,6 si l'appelant
// passe des m/s à animate (human.js n'en faisait qu'une amplitude).
// selfAnimated : false → animé par la boucle commune des PNJ fixes.
const inPlace = [];
let inPlaceLoop = false, inPlaceQueued = 0;
export function upgradeInPlace(ctx, human, name, { seated = false, talk = false, speedScale = 1, selfAnimated = true } = {}) {
  if (!avatarsEnabled() || !human || human.isAvatar) return;
  if (!inPlaceLoop) {
    inPlaceLoop = true;
    const w = new THREE.Vector3();
    ctx.updatables.push(() => {
      const p = ctx.playerPos?.();
      if (!p) return;
      for (const e of inPlace) {
        const g = e.human.group;
        if (!g.parent) continue;
        g.getWorldPosition(w);
        const d2 = (w.x - p.x) ** 2 + (w.z - p.z) ** 2;
        g.userData.far = d2 > 900;
        if (!e.selfAnimated && g.visible && d2 < 4900) e.human.animate(0, 0);
      }
    });
  }
  // (échelonné après le démarrage : les modèles se chargent en fond)
  const delay = 5000 + inPlaceQueued++ * 180;
  new Promise((r) => setTimeout(r, delay)).then(() => buildAvatar(name, { seated })).then((av) => {
    const g = human.group;
    const old = human.hitMeshes ?? [];
    const proto = old[0]?.userData ?? {};
    g.remove(human.mesh);
    for (const c of [...av.group.children]) g.add(c);
    av.group.userData = g.userData; // far / crouch / baseY lus par l'animation
    for (const m of av.hitMeshes) {
      if (proto.onHit) m.userData.onHit = proto.onHit;
      if (proto.aimPoint) m.userData.aimPoint = proto.aimPoint;
    }
    const sh = ctx.shootables;
    let shot = false;
    for (const m of old) { const i = sh?.indexOf(m) ?? -1; if (i >= 0) { sh.splice(i, 1); shot = true; } }
    if (shot) sh.push(...av.hitMeshes);
    av.talk(talk);
    Object.assign(human, {
      mesh: av.mesh, hitMeshes: av.hitMeshes, shirtMat: av.shirtMat, clearTint: av.clearTint,
      animate: speedScale === 1 ? av.animate : (t, s) => av.animate(t, s * speedScale),
      talk: av.talk, isAvatar: true,
    });
    inPlace.push({ human, selfAnimated });
    // (le vrai groupe est celui de l'humain d'origine)
    const k = avatarStats.groups.indexOf(av.group);
    if (k >= 0) avatarStats.groups[k] = g;
  }).catch(() => {});
}

// PNJ fixes (marchands, patrons, habitués) : remplace un humain sculpté
// déjà posé par un avatar, au même endroit, dans le même parent, dès que
// le modèle est chargé. Animés par UNE boucle commune (rien au-delà de
// 70 m, une image sur trois au-delà de 25 m).
const statics = [];
let staticLoop = false;
export function swapForAvatar(ctx, old, name, { seated = false, talk = false } = {}) {
  if (!avatarsEnabled() || !old) return;
  if (!staticLoop) {
    staticLoop = true;
    const w = new THREE.Vector3();
    ctx.updatables.push(() => {
      const p = ctx.playerPos?.();
      if (!p) return;
      for (const a of statics) {
        if (!a.group.visible || !a.group.parent) continue;
        a.group.getWorldPosition(w);
        const d2 = (w.x - p.x) ** 2 + (w.z - p.z) ** 2;
        if (d2 > 4900) continue;
        a.group.userData.far = d2 > 625;
        a.animate(0, 0);
      }
    });
  }
  buildAvatar(name, { seated }).then((a) => {
    const parent = old.parent;
    if (!parent) return;
    a.group.position.copy(old.position);
    a.group.rotation.copy(old.rotation);
    a.group.userData.baseY = old.position.y;
    a.group.visible = old.visible;
    a.talk(talk);
    parent.remove(old);
    parent.add(a.group);
    // les tirs visent le nouvel avatar
    const sh = ctx.shootables;
    old.traverse((o) => { const i = sh?.indexOf(o) ?? -1; if (i >= 0) sh.splice(i, 1); });
    statics.push(a);
    old.userData.avatar = a;
  }).catch(() => {});
}
