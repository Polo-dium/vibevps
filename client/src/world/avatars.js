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
const LIGHT = new Set([...CROWD.f.slice(0, 3), ...CROWD.m.slice(0, 3), 'business_female_01', 'sports_male_01']);
function pickName(name) {
  if (detail.level === 'eleve' || LIGHT.has(name)) return name;
  const list = (isFem(name) ? CROWD.f : CROWD.m).slice(0, 3);
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return list[h % list.length];
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
    if (seated) { /* reste assis */ } else if (v > 0.3) {
      to(act.walk, 0.25);
      if (act.walk) act.walk.timeScale = Math.max(0.6, Math.min(2.4, v / 1.35));
    } else to(talking ? act.talk : act.idle);
    // loin du joueur : animation mise à jour une image sur trois
    if (group.userData.far && (skip = (skip + 1) % 3) !== 0) return;
    mixer.update(group.userData.far ? dt * 3 : dt);
    group.position.y = group.userData.baseY ?? group.position.y;
  }
  const red = new THREE.Color(0xffffff);
  return {
    group,
    mesh: meshes[0],
    hitMeshes: meshes,
    animate,
    talk(on) { talking = on; },
    // flash de dégâts : teinte tous les matériaux de l'instance
    shirtMat: { color: { set(c) { red.set(c); for (const m of tintable) m.color.copy(red); }, setHex(h) { red.setHex(h); for (const m of tintable) m.color.copy(red); } } },
    clearTint() { for (const m of tintable) m.color.setHex(0xffffff); },
    isAvatar: true,
  };
}

// Avatars activés ? Pas au palier Bas (téléphones modestes) ni sans WebGL2
export const avatarsEnabled = () => detail.level !== 'bas';

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
