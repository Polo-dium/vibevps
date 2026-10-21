import * as THREE from 'three';
import { state } from '../state.js';
import { IS_TOUCH } from './controls.js';
import { audio } from '../audio.js';
import { buildWeaponModel } from './weaponModels.js';

const RELOAD_TIME = 1.6;
const TRACER_SPEED = 260; // m/s (visuel)
const ROCKET_SPEED = 55; // m/s (la roquette du bazooka, bien visible)
const MAX_SHELLS = 36;
const MAX_ROCKETS = 10;

// L'arsenal, du marteau au bazooka. Les armes (sauf l'AK de départ) se
// ramassent sur la map (voir world/loot.js). `dmg` est une INDICATION envoyée
// au serveur, qui borne et rythme les dégâts : un tricheur n'y gagne rien.
// Barème « nerveux » : 5 balles d'AK au corps (4 à la tête, ×1,5 — voir
// onHitRemote dans main.js), 2 coups de pompe ou de marteau.
export const WEAPONS = {
  ak: {
    nom: 'AK-47', emoji: '🔫',
    fire: 0.1, mag: 30, reload: 1.6, range: 120, dmg: 20,
  },
  marteau: {
    nom: 'Marteau', emoji: '🔨',
    fire: 0.55, mag: 0, reload: 0, range: 3.6, dmg: 50, melee: true,
  },
  pompe: {
    nom: 'Fusil à pompe', emoji: '💥',
    fire: 0.95, mag: 6, reload: 2.4, range: 34, dmg: 50, pellets: 6,
  },
  minigun: {
    nom: 'Minigun', emoji: '🌀',
    fire: 0.05, mag: 120, reload: 3.2, range: 100, dmg: 14,
  },
  bazooka: {
    nom: 'Bazooka', emoji: '🚀',
    fire: 1.8, mag: 1, reload: 2.6, range: 150, dmg: 55, rocket: true,
  },
  akimbo: {
    nom: 'Double pistolets', emoji: '🔫🔫',
    // La cadence de la minigun (0,05 s = 1200 coups/min), 30 balles DANS
    // CHAQUE pistolet (mag = total affiché). Deux détentes indépendantes :
    // clic gauche = pistolet droit, clic droit (ou bouton TIR gauche en
    // tactile) = pistolet gauche ; les deux maintenues = tir alterné.
    fire: 0.05, mag: 60, magSide: 30, reload: 1.9, range: 70, dmg: 13, akimbo: true,
  },
  baton: {
    nom: 'Bâton de Guignol', emoji: '🏏',
    // La tavelle du théâtre : mêlée rapide, gagnée au castelet de Guignol.
    fire: 0.38, mag: 0, reload: 0, range: 3.4, dmg: 34, melee: true,
  },
  sniper: {
    nom: 'Fusil de précision', emoji: '🎯',
    // One-shot : MAINTENIR le tir met en joue (lunette ×6/×12, molette ou
    // bouton pour basculer), RELÂCHER déclenche le coup. Le serveur borne :
    // au-delà de 55 dégâts, 1,4 s minimum entre deux touches.
    fire: 1.5, mag: 5, reload: 3.0, range: 420, dmg: 100, sniper: true,
  },
};

// Prises en main, par arme (repère du porte-arme, voir weaponModels.js) :
// main DROITE sur la poignée pistolet, index vers la détente (paume contre
// le flanc droit de la poignée : roulis ≈ −π/2) ; main GAUCHE sous le
// garde-main / la pompe, DEVANT la droite, paume vers le haut (roulis ≈ π).
// pos = point visé par le poing, rot = orientation du bras (voir arms.js).
const GRIPS = {
  ak: {
    r: { pos: [0.032, -0.095, -0.075], rot: [0.7, 0.25, -1.5] },
    l: { pos: [0, -0.085, -0.46], rot: [0.2, -0.3, 3.1] },
  },
  pompe: {
    r: { pos: [0.032, -0.09, -0.015], rot: [0.7, 0.25, -1.5] },
    l: { pos: [0, -0.09, -0.42], rot: [0.2, -0.3, 3.1] },
  },
  sniper: {
    r: { pos: [0.034, -0.1, -0.07], rot: [0.7, 0.25, -1.5] },
    l: { pos: [0, -0.075, -0.37], rot: [0.2, -0.3, 3.1] },
  },
  // Minigun : poing droit sur le bloc arrière, main gauche sous les canons
  // (sur la poignée de transport, l'avant-bras barrait tout l'écran)
  minigun: {
    r: { pos: [0.06, -0.04, 0.0], rot: [0.6, 0.3, -1.5] },
    l: { pos: [0, -0.1, -0.3], rot: [0.2, -0.3, 3.1] },
  },
  // Bazooka : deux poignées verticales sous le tube (gauche = l'avant)
  bazooka: {
    r: { pos: [0.054, -0.06, -0.095], rot: [0.7, 0.25, -1.5] },
    l: { pos: [-0.014, -0.05, -0.32], rot: [0.6, -0.3, 1.5] },
  },
  // Manches (marteau, bâton) : les deux poings de part et d'autre du manche
  marteau: {
    r: { pos: [-0.015, -0.03, -0.12], rot: [0.5, 0.3, -1.5] },
    l: { pos: [-0.085, -0.03, -0.27], rot: [0.4, -0.3, 1.5] },
  },
  baton: {
    r: { pos: [0.035, -0.03, -0.03], rot: [0.5, 0.3, -1.5] },
    l: { pos: [-0.035, -0.03, -0.17], rot: [0.4, -0.3, 1.5] },
  },
  // Akimbo : chaque main sur SON pistolet
  akimbo: {
    r: { pos: [0.16, -0.05, -0.19], rot: [0.3, -0.06, 0.06] },
    l: { pos: [-0.16, -0.05, -0.19], rot: [0.3, 0.06, -0.06] },
  },
};

// Mapping id ↔ petit entier pour la synchro réseau (voir netState() dans
// main.js et remotes.js) : indice+1, 0 réservé à « pas d'arme en main ».
// Ordre figé — ne jamais réordonner (casserait la compat avec les clients
// déjà connectés), n'ajouter qu'à la fin.
export const WEAPON_IDS = ['ak', 'marteau', 'pompe', 'minigun', 'bazooka', 'akimbo', 'baton', 'sniper'];

export function createWeapon(camera, scene, shootables, {
  onAmmoChange, onShot, onRocketExplosion, getGroundY, onWeaponChange, worldHit,
  onScope,
}) {
  // Porte-arme : un seul modèle visible à la fois, construits à la demande
  const holder = new THREE.Group();
  holder.visible = false;
  camera.add(holder);
  const models = {};
  let curId = 'ak';
  let spec = WEAPONS.ak;
  const owned = ['ak'];
  function modelFor(id) {
    if (!models[id]) {
      models[id] = buildWeaponModel(id);
      holder.add(models[id]);
      models[id].visible = false;
    }
    return models[id];
  }
  modelFor('ak').visible = true;
  holder.userData.grips = GRIPS.ak; // l'AK de départ n'appelle pas select()

  const raycaster = new THREE.Raycaster();
  raycaster.far = spec.range;

  let ammo = spec.mag;
  let reloading = 0;
  let cooldown = 0;
  let triggerDown = false;
  let recoil = 0;
  let swing = 0; // coup de marteau en cours (1 → 0)
  let bobTime = 0;

  // Flash de bouche
  const flash = new THREE.Mesh(
    new THREE.PlaneGeometry(0.16, 0.16),
    new THREE.MeshBasicMaterial({
      color: 0xffd27a, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false,
    })
  );
  const FLASH_HOME = new THREE.Vector3(0.02, 0.013, -0.62);
  flash.position.copy(FLASH_HOME);
  holder.add(flash);
  let akimboSide = 1; // double pistolets : dernier canon parti (1 = droit)
  let triggerLeftDown = false; // détente du pistolet GAUCHE (akimbo)
  const akimboAmmo = { 1: 30, '-1': 30 }; // 30 balles dans CHAQUE pistolet
  function refillAkimbo() {
    akimboAmmo[1] = spec.magSide ?? 30;
    akimboAmmo['-1'] = spec.magSide ?? 30;
  }

  // Fusil de précision : la mise en joue zoome la caméra et remplace
  // l'arme par la lunette (overlay via onScope).
  let aiming = false;
  let scopeZoom = 6; // ×6 ou ×12
  function setAiming(on) {
    if (aiming === on) return;
    aiming = on;
    holder.visible = state.weaponEquipped && !on;
    camera.zoom = on ? scopeZoom : 1;
    camera.updateProjectionMatrix();
    onScope?.(on ? scopeZoom : null);
  }

  // --- Aide à la visée ---
  // Les cibles vivantes (joueurs distants, PNJ) exposent
  // userData.aimPoint(out) → centre du torse (Vector3) ou null si hors jeu.
  // Deux effets discrets : les balles qui FRÔLENT une cible partent vers
  // elle (aimantation), et la visée ralentit quand le réticule passe dessus
  // (friction, lue par controls.js via state.aimFriction). Plus généreux en
  // tactile, jamais à travers un mur, jamais pour le fusil de précision.
  const AIM_CONE = IS_TOUCH ? 0.09 : 0.05; // demi-angle max (rad)
  const AIM_RADIUS = IS_TOUCH ? 1.1 : 0.75; // rattrapage latéral max (m)
  const _aimP = new THREE.Vector3();
  const _aimDir = new THREE.Vector3();
  const _aimBest = new THREE.Vector3();
  const _camPos = new THREE.Vector3();
  const _camFwd = new THREE.Vector3();
  function findAimTarget(range, cone = AIM_CONE, radius = AIM_RADIUS) {
    camera.getWorldPosition(_camPos);
    camera.getWorldDirection(_camFwd);
    let bestAng = Infinity;
    for (const m of shootables) {
      const p = m.userData.aimPoint?.(_aimP);
      if (!p) continue;
      // Point visé = le plus proche du rayon sur l'axe du corps (des genoux
      // au sommet du crâne) : on garde la hauteur choisie par le joueur,
      // un tir à hauteur de tête reste un tir à la tête.
      const t = _aimDir.subVectors(p, _camPos).dot(_camFwd);
      p.y = THREE.MathUtils.clamp(_camPos.y + _camFwd.y * t, p.y - 0.75, p.y + 0.55);
      _aimDir.subVectors(p, _camPos);
      const d = _aimDir.length();
      if (d < 0.4 || d > range) continue;
      _aimDir.divideScalar(d);
      const ang = Math.acos(Math.min(1, _aimDir.dot(_camFwd)));
      if (ang >= bestAng || ang > Math.min(cone, Math.atan2(radius, d))) continue;
      if (worldHit && worldHit(_camPos, _aimDir, d) < d - 0.4) continue; // derrière un mur
      bestAng = ang;
      _aimBest.copy(_aimDir);
    }
    return bestAng < Infinity ? _aimBest : null;
  }
  // Après setFromCamera : si le rayon central ne touche aucune cible avant
  // le premier mur, on le réoriente vers la cible la plus proche du réticule.
  function assistRay(range, cone, radius) {
    const hits = raycaster.intersectObjects(shootables, false);
    const wallD = worldHit
      ? worldHit(raycaster.ray.origin, raycaster.ray.direction, range)
      : Infinity;
    if (hits.length > 0 && hits[0].distance <= Math.min(wallD, range)) return;
    const dir = findAimTarget(range, cone, radius);
    if (dir) raycaster.ray.direction.copy(dir);
  }

  // --- Effets : traceurs et impacts (aussi utilisés pour les tirs des autres) ---
  const tracers = []; // { mesh, dir, remaining }
  const tracerGeo = new THREE.BoxGeometry(0.03, 0.03, 0.9);
  const tracerMat = new THREE.MeshBasicMaterial({
    color: 0xffe9a0, blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const aircraftTracerMat = new THREE.MeshBasicMaterial({
    color: 0xff2020, blending: THREE.AdditiveBlending, depthWrite: false,
  });

  const particles = []; // { mesh, vel, life, maxLife, baseScale }
  const particleGeo = new THREE.SphereGeometry(0.03, 5, 5);
  // Matériaux partagés (pas d'allocation ni de dispose par impact : le fondu
  // se fait par réduction d'échelle, l'additif rend ça invisible)
  const coreMat = new THREE.MeshBasicMaterial({
    color: 0xfff3c0, blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const sparkMats = [
    new THREE.MeshBasicMaterial({ color: 0xffc964, blending: THREE.AdditiveBlending, depthWrite: false }),
    new THREE.MeshBasicMaterial({ color: 0xff8a3d, blending: THREE.AdditiveBlending, depthWrite: false }),
  ];

  // Roquettes de bazooka en vol
  const rockets = []; // { mesh, dir, remaining, trailTimer, onImpact }
  let rocketBodyGeo = null, rocketNoseGeo = null, rocketFinGeo = null, rocketFlameGeo = null;
  const rocketBodyMat = new THREE.MeshLambertMaterial({ color: 0x7f8b75 });
  const rocketNoseMat = new THREE.MeshLambertMaterial({ color: 0x2f3630 });
  const rocketFireMat = new THREE.MeshBasicMaterial({
    color: 0xffb23e, blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const rocketSmokeMat = new THREE.MeshBasicMaterial({
    color: 0x9b9d94, transparent: true, opacity: 0.72, depthWrite: false,
  });

  // Douilles éjectées
  const shells = []; // { mesh, vel, spin, life, bounces }
  const shellGeo = new THREE.CylinderGeometry(0.008, 0.008, 0.04, 6);
  const shellMat = new THREE.MeshLambertMaterial({ color: 0xc9a227 });

  function spawnShell() {
    if (shells.length >= MAX_SHELLS) {
      const old = shells.shift();
      scene.remove(old.mesh);
    }
    const mesh = new THREE.Mesh(shellGeo, shellMat);
    // Éjection depuis la culasse (à droite de l'arme)
    const breech = new THREE.Vector3(0.05, -0.01, -0.2);
    holder.localToWorld(breech);
    mesh.position.copy(breech);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
    const up = new THREE.Vector3(0, 1, 0);
    const vel = right.multiplyScalar(1.6 + Math.random() * 0.8)
      .addScaledVector(up, 2.2 + Math.random() * 0.8);
    vel.x += (Math.random() - 0.5) * 0.6;
    vel.z += (Math.random() - 0.5) * 0.6;
    mesh.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
    scene.add(mesh);
    shells.push({
      mesh, vel,
      spin: new THREE.Vector3(Math.random() * 14 - 7, Math.random() * 14 - 7, Math.random() * 14 - 7),
      life: 2.4,
      bounces: 0,
    });
  }

  function spawnTracer(a, b, aircraft = false) {
    const from = new THREE.Vector3(...a);
    const to = new THREE.Vector3(...b);
    const dir = to.clone().sub(from);
    const dist = dir.length();
    if (dist < 0.5) return;
    dir.normalize();
    const mesh = new THREE.Mesh(tracerGeo, aircraft ? aircraftTracerMat : tracerMat);
    mesh.position.copy(from);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, -1), dir);
    scene.add(mesh);
    tracers.push({ mesh, dir, remaining: dist });
  }

  function spawnImpact(point) {
    const p = Array.isArray(point) ? new THREE.Vector3(...point) : point;
    // Éclair central
    const core = new THREE.Mesh(particleGeo, coreMat);
    core.position.copy(p);
    core.scale.setScalar(2.5);
    scene.add(core);
    particles.push({ mesh: core, vel: new THREE.Vector3(), life: 0.12, maxLife: 0.12, baseScale: 2.5 });
    // Gerbe d'étincelles
    for (let i = 0; i < 7; i++) {
      const m = new THREE.Mesh(particleGeo, sparkMats[i % 2]);
      m.position.copy(p);
      scene.add(m);
      const vel = new THREE.Vector3(
        (Math.random() - 0.5) * 5,
        Math.random() * 4 + 1,
        (Math.random() - 0.5) * 5
      );
      const life = 0.25 + Math.random() * 0.2;
      particles.push({ mesh: m, vel, life, maxLife: life, baseScale: 1 });
    }
  }

  // Explosion de roquette : gros noyau + large gerbe (mêmes matériaux partagés)
  function spawnExplosion(point) {
    const p = Array.isArray(point) ? new THREE.Vector3(...point) : point;
    const core = new THREE.Mesh(particleGeo, coreMat);
    core.position.copy(p);
    core.scale.setScalar(14);
    scene.add(core);
    particles.push({ mesh: core, vel: new THREE.Vector3(), life: 0.28, maxLife: 0.28, baseScale: 14 });
    for (let i = 0; i < 16; i++) {
      const m = new THREE.Mesh(particleGeo, sparkMats[i % 2]);
      m.position.copy(p);
      m.scale.setScalar(3);
      scene.add(m);
      const vel = new THREE.Vector3(
        (Math.random() - 0.5) * 14,
        Math.random() * 9 + 2,
        (Math.random() - 0.5) * 14
      );
      const life = 0.4 + Math.random() * 0.3;
      particles.push({ mesh: m, vel, life, maxLife: life, baseScale: 3 });
    }
    audio.explosion();
    navigator.vibrate?.(60);
  }

  function detonateRocket(point, onImpact) {
    onImpact?.();
    spawnExplosion(point);
    onRocketExplosion?.(point.clone?.() ?? point);
  }

  function fireRocket(from, to, onImpact = null) {
    if (!rocketBodyGeo) {
      rocketBodyGeo = new THREE.CylinderGeometry(0.07, 0.07, 0.36, 8);
      rocketBodyGeo.rotateX(Math.PI / 2);
      rocketNoseGeo = new THREE.ConeGeometry(0.072, 0.19, 8);
      rocketNoseGeo.rotateX(-Math.PI / 2); // pointe vers -z
      rocketFinGeo = new THREE.ConeGeometry(0.14, 0.22, 4);
      rocketFinGeo.rotateX(Math.PI / 2);
      rocketFlameGeo = new THREE.SphereGeometry(0.055, 6, 4);
    }
    const dir = to.clone().sub(from);
    const dist = dir.length();
    if (dist < 1) { detonateRocket(to, onImpact); return; }
    dir.normalize();
    if (rockets.length >= MAX_ROCKETS) {
      const old = rockets.shift();
      scene.remove(old.mesh);
    }
    const mesh = new THREE.Group();
    const body = new THREE.Mesh(rocketBodyGeo, rocketBodyMat);
    body.position.z = -0.015;
    mesh.add(body);
    const nose = new THREE.Mesh(rocketNoseGeo, rocketNoseMat);
    nose.position.z = -0.285;
    mesh.add(nose);
    const fins = new THREE.Mesh(rocketFinGeo, rocketNoseMat);
    fins.position.z = 0.19;
    mesh.add(fins);
    const flame = new THREE.Mesh(rocketFlameGeo, rocketFireMat);
    flame.position.z = 0.25;
    flame.scale.set(0.8, 0.8, 1.8);
    mesh.add(flame);
    mesh.position.copy(from);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, -1), dir);
    scene.add(mesh);
    rockets.push({ mesh, dir, remaining: dist, trailTimer: 0, onImpact });
  }

  // --- Entrées ---
  window.addEventListener('mousedown', (e) => {
    if (IS_TOUCH) return;
    if (e.button === 0) triggerDown = true;
    // Akimbo : clic DROIT = pistolet gauche
    if (e.button === 2 && spec.akimbo && state.weaponEquipped) triggerLeftDown = true;
  });
  window.addEventListener('mouseup', (e) => {
    if (IS_TOUCH) return;
    if (e.button === 0) triggerDown = false;
    if (e.button === 2) triggerLeftDown = false;
  });
  window.addEventListener('contextmenu', (e) => {
    if (spec.akimbo && state.weaponEquipped && state.pointerLocked) e.preventDefault();
  });
  window.addEventListener('keydown', (e) => {
    if (state.overlayOpen) return;
    if (e.code === 'Digit1') toggle();
    if (e.code === 'Digit2') cycle();
    if (e.code === 'KeyR') reload();
  });

  function reload() {
    if (state.weaponEquipped && !spec.melee && reloading <= 0 && ammo < spec.mag) {
      reloading = spec.reload;
      audio.reload();
      onAmmoChange(ammo, true, spec);
    }
  }

  function toggle(force) {
    setAiming(false); // ranger/sortir l'arme désarme toujours la lunette
    state.weaponEquipped = force ?? !state.weaponEquipped;
    holder.visible = state.weaponEquipped;
    onAmmoChange(ammo, reloading > 0, spec);
  }

  // Équipe une arme possédée (ramassée : voir give)
  function select(id) {
    if (!WEAPONS[id] || id === curId) return;
    setAiming(false);
    modelFor(curId).visible = false;
    curId = id;
    spec = WEAPONS[id];
    modelFor(id).visible = true;
    ammo = spec.mag;
    refillAkimbo();
    reloading = 0;
    cooldown = 0;
    flash.position.copy(FLASH_HOME);
    // Akimbo : chaque main sur SON pistolet (arms.js lit ces prises à la
    // place de ses prises fusil par défaut).
    holder.userData.grips = GRIPS[id] ?? null;
    toggle(true);
    onWeaponChange?.(spec);
  }

  function cycle() {
    if (owned.length < 2) return;
    if (!state.weaponEquipped) { toggle(true); return; }
    const next = owned[(owned.indexOf(curId) + 1) % owned.length];
    select(next);
  }

  // Ramassage d'une arme sur la map : ajoutée à l'inventaire et équipée
  function give(id, { equip = true } = {}) {
    if (!WEAPONS[id]) return;
    if (!owned.includes(id)) owned.push(id);
    if (!equip) return;
    if (id === curId) { ammo = spec.mag; refillAkimbo(); onAmmoChange(ammo, reloading > 0, spec); return; }
    select(id);
  }

  function equip(id) {
    if (!owned.includes(id)) return false;
    if (id === curId) toggle(true);
    else select(id);
    return true;
  }

  function shoot() {
    cooldown = spec.fire;
    recoil = 1;
    navigator.vibrate?.(8); // retour haptique sur mobile
    if (state.rangeSession) state.rangeSession.shots += 1;

    // Double pistolets : le flash (donc le départ du traceur) part du canon
    // dont la détente a parlé — akimboSide est fixé par update().
    if (spec.akimbo) flash.position.set(0.16 * akimboSide, 0.025, -0.47);

    raycaster.far = spec.range;
    const muzzle = new THREE.Vector3();
    flash.getWorldPosition(muzzle);

    // --- Marteau : un grand coup devant soi, pas de munitions ---
    if (spec.melee) {
      swing = 1;
      audio.thud();
      raycaster.setFromCamera({ x: 0, y: 0 }, camera);
      assistRay(spec.range + 0.5, 0.4, 1.3); // un moulinet, ça ratisse large
      const hits = raycaster.intersectObjects(shootables, false);
      const wallD = worldHit
        ? worldHit(raycaster.ray.origin, raycaster.ray.direction, spec.range)
        : Infinity;
      if (hits.length > 0 && hits[0].distance <= wallD) {
        hits[0].object.userData.onHit?.(hits[0]);
        spawnImpact(hits[0].point);
        navigator.vibrate?.(24);
      } else if (wallD <= spec.range) {
        spawnImpact(raycaster.ray.at(wallD, new THREE.Vector3())); // toc, le mur
      }
      return;
    }

    if (spec.akimbo) {
      akimboAmmo[akimboSide] -= 1;
      ammo = akimboAmmo[1] + akimboAmmo['-1'];
    } else {
      ammo -= 1;
    }
    flash.material.opacity = 1;
    flash.rotation.z = Math.random() * Math.PI;
    if (spec.rocket) audio.rocket();
    else if (spec.pellets) audio.shotgun();
    else audio.gunshot();
    if (!spec.rocket) spawnShell();
    onAmmoChange(ammo, false, spec);

    // --- Tir(s) : 1 rayon, ou une gerbe de plombs pour le fusil à pompe ---
    // Les rayons s'arrêtent au premier mur (worldHit) : pas de balle ni de
    // roquette qui traverse un immeuble.
    const nRays = spec.pellets ?? 1;
    const hitObjects = new Set(); // un seul onHit par cible et par tir
    let mainEnd = null;
    for (let k = 0; k < nRays; k++) {
      const off = k === 0
        ? { x: 0, y: 0 }
        : { x: (Math.random() - 0.5) * 0.16, y: (Math.random() - 0.5) * 0.12 };
      raycaster.setFromCamera(off, camera);
      if (k === 0 && !spec.sniper) assistRay(spec.range);
      const wallD = worldHit
        ? worldHit(raycaster.ray.origin, raycaster.ray.direction, spec.range)
        : Infinity;
      const hits = raycaster.intersectObjects(shootables, false);
      let end;
      let rocketImpact = null;
      if (hits.length > 0 && hits[0].distance <= wallD) {
        const hit = hits[0];
        end = hit.point.clone();
        if (!hitObjects.has(hit.object)) {
          hitObjects.add(hit.object);
          if (spec.rocket) rocketImpact = () => hit.object.userData.onHit?.(hit);
          else hit.object.userData.onHit?.(hit);
        }
        if (k < 3 && !spec.rocket) spawnImpact(hit.point);
      } else if (wallD <= spec.range) {
        end = raycaster.ray.at(wallD, new THREE.Vector3());
        if (k < 3 && !spec.rocket) spawnImpact(end);
      } else {
        end = raycaster.ray.at(spec.range, new THREE.Vector3());
      }
      if (k === 0) mainEnd = end;
      if (spec.rocket) fireRocket(muzzle, end, rocketImpact);
      else spawnTracer(muzzle.toArray(), end.toArray());
    }
    onShot?.(muzzle.toArray(), mainEnd.toArray());

    if (ammo <= 0) {
      reloading = spec.reload;
      audio.reload();
      onAmmoChange(0, true, spec);
    }
  }

  function update(dt, isMoving) {
    flash.material.opacity = Math.max(0, flash.material.opacity - dt * 14);
    recoil = Math.max(0, recoil - dt * 9);
    swing = Math.max(0, swing - dt * 3.2); // grand moulinet lisible

    // Traceurs en vol
    for (let i = tracers.length - 1; i >= 0; i--) {
      const t = tracers[i];
      const step = TRACER_SPEED * dt;
      t.mesh.position.addScaledVector(t.dir, step);
      t.remaining -= step;
      if (t.remaining <= 0) {
        scene.remove(t.mesh);
        tracers.splice(i, 1);
      }
    }
    // Roquettes : projectile lisible + traînée dense de fumée et d'étincelles.
    for (let i = rockets.length - 1; i >= 0; i--) {
      const r = rockets[i];
      const step = Math.min(ROCKET_SPEED * dt, r.remaining);
      r.mesh.position.addScaledVector(r.dir, step);
      r.remaining -= step;
      r.trailTimer -= dt;
      if (r.trailTimer <= 0 && particles.length < 150) {
        r.trailTimer += 0.025;
        const smoke = new THREE.Mesh(particleGeo, rocketSmokeMat);
        smoke.position.copy(r.mesh.position).addScaledVector(r.dir, -0.18);
        smoke.position.x += (Math.random() - 0.5) * 0.05;
        smoke.position.y += (Math.random() - 0.5) * 0.05;
        smoke.position.z += (Math.random() - 0.5) * 0.05;
        smoke.scale.setScalar(4.6);
        scene.add(smoke);
        particles.push({
          mesh: smoke,
          vel: new THREE.Vector3((Math.random() - 0.5) * 0.4, 0.45, (Math.random() - 0.5) * 0.4),
          life: 0.58, maxLife: 0.58, baseScale: 4.6, gravity: -0.7,
        });
        const spark = new THREE.Mesh(particleGeo, rocketFireMat);
        spark.position.copy(r.mesh.position).addScaledVector(r.dir, -0.22);
        spark.scale.setScalar(2.1);
        scene.add(spark);
        particles.push({
          mesh: spark, vel: r.dir.clone().multiplyScalar(-2.2),
          life: 0.18, maxLife: 0.18, baseScale: 2.1, gravity: 0,
        });
      }
      if (r.remaining <= 0) {
        const impact = r.mesh.position.clone();
        detonateRocket(impact, r.onImpact);
        scene.remove(r.mesh);
        rockets.splice(i, 1);
      }
    }
    // Douilles : chute, rebond métallique, disparition
    const groundY = getGroundY ? getGroundY() : 0;
    for (let i = shells.length - 1; i >= 0; i--) {
      const s = shells[i];
      s.life -= dt;
      s.vel.y -= 18 * dt;
      s.mesh.position.addScaledVector(s.vel, dt);
      s.mesh.rotation.x += s.spin.x * dt;
      s.mesh.rotation.y += s.spin.y * dt;
      s.mesh.rotation.z += s.spin.z * dt;
      if (s.mesh.position.y < groundY + 0.02 && s.vel.y < 0) {
        s.mesh.position.y = groundY + 0.02;
        s.vel.y *= -0.35;
        s.vel.x *= 0.55;
        s.vel.z *= 0.55;
        s.spin.multiplyScalar(0.5);
        if (s.bounces < 2) audio.shellBounce();
        s.bounces += 1;
        if (s.bounces > 3) s.vel.set(0, 0, 0);
      }
      if (s.life <= 0) {
        scene.remove(s.mesh);
        shells.splice(i, 1);
      }
    }

    // Étincelles, fumée et impacts (fondu par échelle : matériaux partagés)
    for (let i = particles.length - 1; i >= 0; i--) {
      const s = particles[i];
      s.life -= dt;
      s.vel.y -= (s.gravity ?? 12) * dt;
      s.mesh.position.addScaledVector(s.vel, dt);
      s.mesh.scale.setScalar(Math.max(0.001, s.baseScale * (s.life / s.maxLife)));
      if (s.life <= 0) {
        scene.remove(s.mesh);
        particles.splice(i, 1);
      }
    }

    if (!state.weaponEquipped) return;

    if (reloading > 0) {
      reloading -= dt;
      if (reloading <= 0) {
        ammo = spec.mag;
        refillAkimbo();
        onAmmoChange(ammo, false, spec);
      }
    }

    // Friction de visée : réticule sur (ou tout près d') une cible → la
    // caméra tourne moins vite, le temps de la suivre.
    state.aimFriction = state.weaponEquipped && !aiming && !state.driving &&
      !state.overlayOpen && findAimTarget(spec.range, AIM_CONE * 0.8)
      ? (IS_TOUCH ? 0.5 : 0.72)
      : 1;

    cooldown -= dt;
    const inputOk = IS_TOUCH || state.pointerLocked;
    const freeToAct =
      inputOk && !state.overlayOpen && !state.tagMode && !state.sanctuary &&
      !state.photoMode && // en mode photo, le clic déclenche l'appareil
      Date.now() >= (state.duelLockUntil ?? 0); // gelé pendant le décompte de duel
    if (spec.sniper && state.weaponEquipped) {
      // Fusil de précision : MAINTENIR met en joue, RELÂCHER tire.
      if (triggerDown && !aiming && freeToAct &&
          cooldown <= 0 && reloading <= 0 && ammo > 0) {
        setAiming(true);
      }
      if (aiming && !triggerDown) {
        setAiming(false);
        if (freeToAct && cooldown <= 0 && reloading <= 0 && ammo > 0) shoot();
      }
      if (aiming && (!freeToAct || reloading > 0)) setAiming(false);
    } else if (spec.akimbo && state.weaponEquipped) {
      // Deux détentes indépendantes : chaque bouton vide SON pistolet.
      // Les deux maintenues ensemble : tir alterné droite/gauche.
      if (freeToAct && cooldown <= 0 && reloading <= 0) {
        let side = 0;
        if (triggerDown && triggerLeftDown) side = -akimboSide;
        else if (triggerDown) side = 1;
        else if (triggerLeftDown) side = -1;
        if (side !== 0 && akimboAmmo[side] <= 0) side = 0; // ce canon est vide
        if (side !== 0) {
          akimboSide = side;
          shoot();
        }
      }
    } else {
      const canShoot = freeToAct &&
        triggerDown && cooldown <= 0 && reloading <= 0 && (spec.melee || ammo > 0);
      if (canShoot) shoot();
    }

    // Animation : balancement de course + recul (+ moulinet de marteau)
    bobTime += dt * (isMoving ? 10 : 2);
    const bobX = Math.sin(bobTime) * (isMoving ? 0.01 : 0.002);
    const bobY = Math.abs(Math.cos(bobTime)) * (isMoving ? 0.008 : 0.002);
    const reloadDip = reloading > 0 ? Math.sin((reloading / (spec.reload || RELOAD_TIME)) * Math.PI) * 0.16 : 0;
    const swingArc = Math.sin(swing * Math.PI); // lève puis abat
    // Marteau : le bras remonte jusqu'EN HAUT de l'écran (grand moulinet)
    // avant de s'abattre. Akimbo : porte-arme centré, un pistolet par côté.
    const lift = spec.melee ? swingArc * 0.55 : swingArc * 0.1;
    const swingTilt = swingArc * (spec.melee ? 2.5 : 1.1);
    holder.position.set(
      (spec.akimbo ? 0 : 0.26) + bobX,
      -0.24 - bobY - reloadDip + lift,
      -0.45 + recoil * 0.06
    );
    holder.rotation.set(recoil * 0.09 - reloadDip * 0.8 - swingTilt, 0, 0);
  }

  return {
    update,
    toggle,
    reload,
    give,
    equip,
    cycle,
    // side 'r' (défaut) = détente principale, 'l' = pistolet gauche akimbo
    setTrigger(down, side = 'r') {
      if (side === 'l') triggerLeftDown = down;
      else triggerDown = down;
    },
    // Lunette du fusil de précision : bascule ×6 ↔ ×12 (molette ou bouton)
    toggleScopeZoom() {
      scopeZoom = scopeZoom === 6 ? 12 : 6;
      if (aiming) {
        camera.zoom = scopeZoom;
        camera.updateProjectionMatrix();
        onScope?.(scopeZoom);
      }
      return scopeZoom;
    },
    get aiming() { return aiming; },
    get id() { return curId; },
    fx: { spawnTracer, spawnImpact, spawnExplosion },
    get ammo() { return ammo; },
    get spec() { return spec; },
    get inventory() {
      return owned.map((id) => ({ id, ...WEAPONS[id], equipped: id === curId && state.weaponEquipped }));
    },
    get damage() { return spec.dmg; },
    // Le porte-arme lui-même : les bras (arms.js) lisent sa position/rotation
    // en direct chaque frame pour rester parfaitement calés sur le recul,
    // le balancement de course et le coup de marteau — pas de resynchro à
    // maintenir en double.
    get holder() { return holder; },
  };
}

// Modèles détaillés (profils extrudés + PBR) : voir weaponModels.js
export { buildWeaponModel };
