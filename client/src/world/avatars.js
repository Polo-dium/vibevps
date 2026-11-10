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

function loadModel(name) {
  if (!models.has(name)) {
    models.set(name, getLoader().then((l) => l.loadAsync(`/avatars/${name}.glb`)).then((g) => {
      // Matériaux plus légers hors palier Élevé (Lambert, comme le décor)
      g.scene.traverse((o) => {
        if (!o.isMesh) return;
        o.castShadow = true;
        o.receiveShadow = false;
        o.frustumCulled = false; // volume fixe posé sur le groupe (voir plus bas)
        if (!detail.high) {
          o.material = [].concat(o.material).map((m) => new THREE.MeshLambertMaterial({
            name: m.name, map: m.map, alphaTest: m.alphaTest, side: m.side,
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
  let last = performance.now(), skip = 0;
  // Marche : la vitesse de lecture suit la vitesse au sol (la marche
  // Rocketbox fait ~1,35 m/s). speed > 0.3 → marche, sinon repos/causette.
  // `speed` arrive au format de human.js (m/s × 2,6) : on le ramène.
  function animate(_phase, speed) {
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
    // loin du joueur : animation mise à jour une image sur trois
    if (group.userData.far && (skip = (skip + 1) % 3) !== 0) return;
    mixer.update(group.userData.far ? dt * 3 : dt);
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
  let armed = false, kick = 0;
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
  function poseArmed() {
    if (!armed || !canPose) return;
    group.getWorldQuaternion(_qg);
    // (repère du groupe : -z = devant, +x = à droite du personnage)
    // + secousse de recul à chaque coup (kick, retombe en ~0,15 s)
    const k = kick;
    kick = Math.max(0, kick - 0.14);
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
  const animate0 = animate;
  const emi = new THREE.Color(0);
  const red = new THREE.Color(0xffffff);
  return {
    armR,
    setArmed(on) { armed = Boolean(on); },
    kickShot() { kick = 1; },
    model, bone,
    animateArmed(phase, speed) { animate0(phase, speed); poseArmed(); },
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
