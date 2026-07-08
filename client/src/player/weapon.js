import * as THREE from 'three';
import { state } from '../state.js';
import { IS_TOUCH } from './controls.js';
import { audio } from '../audio.js';

const RELOAD_TIME = 1.6;
const TRACER_SPEED = 260; // m/s (visuel)
const ROCKET_SPEED = 55; // m/s (la roquette du bazooka, bien visible)
const MAX_SHELLS = 36;

// L'arsenal, du marteau au bazooka. Les armes (sauf l'AK de départ) se
// ramassent sur la map (voir world/loot.js). `dmg` est une INDICATION envoyée
// au serveur, qui borne et rythme les dégâts : un tricheur n'y gagne rien.
export const WEAPONS = {
  ak: {
    nom: 'AK-47', emoji: '🔫',
    fire: 0.1, mag: 30, reload: 1.6, range: 120, dmg: 10,
  },
  marteau: {
    nom: 'Marteau', emoji: '🔨',
    fire: 0.55, mag: 0, reload: 0, range: 3.6, dmg: 30, melee: true,
  },
  pompe: {
    nom: 'Fusil à pompe', emoji: '💥',
    fire: 0.95, mag: 6, reload: 2.4, range: 34, dmg: 26, pellets: 6,
  },
  minigun: {
    nom: 'Minigun', emoji: '🌀',
    fire: 0.05, mag: 120, reload: 3.2, range: 100, dmg: 9,
  },
  bazooka: {
    nom: 'Bazooka', emoji: '🚀',
    fire: 1.8, mag: 1, reload: 2.6, range: 150, dmg: 55, rocket: true,
  },
};

export function createWeapon(camera, scene, shootables, {
  onAmmoChange, onShot, getGroundY, onWeaponChange, worldHit,
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
  flash.position.set(0.02, 0.013, -0.62);
  holder.add(flash);

  // --- Effets : traceurs et impacts (aussi utilisés pour les tirs des autres) ---
  const tracers = []; // { mesh, dir, remaining }
  const tracerGeo = new THREE.BoxGeometry(0.03, 0.03, 0.9);
  const tracerMat = new THREE.MeshBasicMaterial({
    color: 0xffe9a0, blending: THREE.AdditiveBlending, depthWrite: false,
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
  const rockets = []; // { mesh, dir, remaining }
  let rocketGeo = null, rocketMat = null;

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

  function spawnTracer(a, b) {
    const from = new THREE.Vector3(...a);
    const to = new THREE.Vector3(...b);
    const dir = to.clone().sub(from);
    const dist = dir.length();
    if (dist < 0.5) return;
    dir.normalize();
    const mesh = new THREE.Mesh(tracerGeo, tracerMat);
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

  function fireRocket(from, to) {
    if (!rocketGeo) {
      rocketGeo = new THREE.ConeGeometry(0.09, 0.5, 6);
      rocketGeo.rotateX(-Math.PI / 2); // pointe vers -z
      rocketMat = new THREE.MeshBasicMaterial({ color: 0x9aa38f });
    }
    const dir = to.clone().sub(from);
    const dist = dir.length();
    if (dist < 1) { spawnExplosion(to); return; }
    dir.normalize();
    const mesh = new THREE.Mesh(rocketGeo, rocketMat);
    mesh.position.copy(from);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, -1), dir);
    scene.add(mesh);
    rockets.push({ mesh, dir, remaining: dist });
  }

  // --- Entrées ---
  window.addEventListener('mousedown', (e) => {
    if (e.button === 0 && !IS_TOUCH) triggerDown = true;
  });
  window.addEventListener('mouseup', (e) => {
    if (e.button === 0 && !IS_TOUCH) triggerDown = false;
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
    state.weaponEquipped = force ?? !state.weaponEquipped;
    holder.visible = state.weaponEquipped;
    onAmmoChange(ammo, reloading > 0, spec);
  }

  // Équipe une arme possédée (ramassée : voir give)
  function select(id) {
    if (!WEAPONS[id] || id === curId) return;
    modelFor(curId).visible = false;
    curId = id;
    spec = WEAPONS[id];
    modelFor(id).visible = true;
    ammo = spec.mag;
    reloading = 0;
    cooldown = 0;
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
  function give(id) {
    if (!WEAPONS[id]) return;
    if (!owned.includes(id)) owned.push(id);
    if (id === curId) { ammo = spec.mag; onAmmoChange(ammo, reloading > 0, spec); return; }
    select(id);
  }

  function shoot() {
    cooldown = spec.fire;
    recoil = 1;
    navigator.vibrate?.(8); // retour haptique sur mobile
    if (state.rangeSession) state.rangeSession.shots += 1;

    raycaster.far = spec.range;
    const muzzle = new THREE.Vector3();
    flash.getWorldPosition(muzzle);

    // --- Marteau : un grand coup devant soi, pas de munitions ---
    if (spec.melee) {
      swing = 1;
      audio.thud();
      raycaster.setFromCamera({ x: 0, y: 0 }, camera);
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

    ammo -= 1;
    flash.material.opacity = 1;
    flash.rotation.z = Math.random() * Math.PI;
    if (spec.rocket) audio.rocket();
    else if (spec.pellets) audio.shotgun();
    else audio.gunshot();
    spawnShell();
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
      const wallD = worldHit
        ? worldHit(raycaster.ray.origin, raycaster.ray.direction, spec.range)
        : Infinity;
      const hits = raycaster.intersectObjects(shootables, false);
      let end;
      if (hits.length > 0 && hits[0].distance <= wallD) {
        end = hits[0].point.clone();
        if (!hitObjects.has(hits[0].object)) {
          hitObjects.add(hits[0].object);
          hits[0].object.userData.onHit?.(hits[0]);
        }
        if (k < 3) spawnImpact(hits[0].point);
      } else if (wallD <= spec.range) {
        end = raycaster.ray.at(wallD, new THREE.Vector3());
        if (k < 3 && !spec.rocket) spawnImpact(end);
      } else {
        end = raycaster.ray.at(spec.range, new THREE.Vector3());
      }
      if (k === 0) mainEnd = end;
      if (spec.rocket) fireRocket(muzzle, end);
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
    swing = Math.max(0, swing - dt * 4.5);

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
    // Roquettes : plus lentes, panache d'étincelles, explosion à l'arrivée
    for (let i = rockets.length - 1; i >= 0; i--) {
      const r = rockets[i];
      const step = ROCKET_SPEED * dt;
      r.mesh.position.addScaledVector(r.dir, step);
      r.remaining -= step;
      if (particles.length < 120 && Math.random() < 0.7) {
        const m = new THREE.Mesh(particleGeo, sparkMats[i % 2]);
        m.position.copy(r.mesh.position);
        scene.add(m);
        particles.push({
          mesh: m, vel: new THREE.Vector3(0, 0.5, 0),
          life: 0.3, maxLife: 0.3, baseScale: 1.4,
        });
      }
      if (r.remaining <= 0) {
        spawnExplosion(r.mesh.position);
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

    // Étincelles d'impact (fondu par échelle : matériaux partagés)
    for (let i = particles.length - 1; i >= 0; i--) {
      const s = particles[i];
      s.life -= dt;
      s.vel.y -= 12 * dt;
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
        onAmmoChange(ammo, false, spec);
      }
    }

    cooldown -= dt;
    const inputOk = IS_TOUCH || state.pointerLocked;
    const canShoot =
      inputOk && !state.overlayOpen && !state.tagMode && !state.sanctuary &&
      triggerDown && cooldown <= 0 && reloading <= 0 && (spec.melee || ammo > 0);
    if (canShoot) shoot();

    // Animation : balancement de course + recul (+ moulinet de marteau)
    bobTime += dt * (isMoving ? 10 : 2);
    const bobX = Math.sin(bobTime) * (isMoving ? 0.01 : 0.002);
    const bobY = Math.abs(Math.cos(bobTime)) * (isMoving ? 0.008 : 0.002);
    const reloadDip = reloading > 0 ? Math.sin((reloading / (spec.reload || RELOAD_TIME)) * Math.PI) * 0.16 : 0;
    const swingArc = Math.sin(swing * Math.PI); // lève puis abat
    holder.position.set(0.26 + bobX, -0.24 - bobY - reloadDip + swingArc * 0.1, -0.45 + recoil * 0.06);
    holder.rotation.set(recoil * 0.09 - reloadDip * 0.8 - swingArc * 1.1, 0, 0);
  }

  return {
    update,
    toggle,
    reload,
    give,
    cycle,
    setTrigger(down) { triggerDown = down; },
    fx: { spawnTracer, spawnImpact, spawnExplosion },
    get ammo() { return ammo; },
    get spec() { return spec; },
    get damage() { return spec.dmg; },
  };
}

// --- Modèles d'armes low-poly en primitives ------------------------------
// Tous ancrés pareil : origine à la poignée, canon vers -z. Réutilisés par
// world/loot.js pour les armes qui flottent sur la map.
export function buildWeaponModel(id) {
  switch (id) {
    case 'marteau': return buildMarteauModel();
    case 'pompe': return buildPompeModel();
    case 'minigun': return buildMinigunModel();
    case 'bazooka': return buildBazookaModel();
    default: return buildAkModel();
  }
}

function modelHelpers(group) {
  return (geo, mat, x, y, z, rx = 0, ry = 0, rz = 0) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.rotation.set(rx, ry, rz);
    group.add(m);
    return m;
  };
}

// AK-47 low-poly construite en primitives
function buildAkModel() {
  const group = new THREE.Group();
  const wood = new THREE.MeshLambertMaterial({ color: 0x7a4a26 });
  const metal = new THREE.MeshLambertMaterial({ color: 0x2b2b2e });
  const darkMetal = new THREE.MeshLambertMaterial({ color: 0x1c1c1f });
  const add = modelHelpers(group);

  // Corps / boîtier de culasse
  add(new THREE.BoxGeometry(0.05, 0.07, 0.34), metal, 0, 0, -0.2);
  // Canon
  add(new THREE.CylinderGeometry(0.012, 0.012, 0.34, 8), darkMetal, 0, 0.005, -0.49, Math.PI / 2);
  // Garde-main bois
  add(new THREE.BoxGeometry(0.045, 0.05, 0.18), wood, 0, -0.005, -0.42);
  // Crosse
  add(new THREE.BoxGeometry(0.04, 0.085, 0.22), wood, 0, -0.03, 0.06, -0.08);
  // Chargeur courbé (deux segments)
  add(new THREE.BoxGeometry(0.035, 0.13, 0.06), metal, 0, -0.095, -0.16, 0.35);
  add(new THREE.BoxGeometry(0.035, 0.09, 0.055), metal, 0, -0.175, -0.115, 0.75);
  // Poignée pistolet
  add(new THREE.BoxGeometry(0.035, 0.09, 0.045), wood, 0, -0.075, -0.02, 0.5);
  // Guidon + hausse
  add(new THREE.BoxGeometry(0.012, 0.035, 0.012), darkMetal, 0, 0.05, -0.6);
  add(new THREE.BoxGeometry(0.03, 0.025, 0.02), darkMetal, 0, 0.05, -0.1);

  return group;
}

// Marteau de chantier : manche bois vers l'avant, tête acier en T
function buildMarteauModel() {
  const group = new THREE.Group();
  const wood = new THREE.MeshLambertMaterial({ color: 0x9a6a35 });
  const steel = new THREE.MeshLambertMaterial({ color: 0x6f7681 });
  const add = modelHelpers(group);

  // Manche tendu devant soi, prêt à frapper
  add(new THREE.CylinderGeometry(0.018, 0.023, 0.48, 8), wood, 0, -0.05, -0.3, Math.PI / 2);
  // Tête perpendiculaire au bout du manche : masse d'un côté, panne de l'autre
  add(new THREE.BoxGeometry(0.17, 0.065, 0.065), steel, 0, -0.05, -0.54);
  add(new THREE.CylinderGeometry(0.042, 0.048, 0.05, 8), steel, 0.1, -0.05, -0.54, 0, 0, Math.PI / 2);

  return group;
}

// Fusil à pompe : long canon + tube magasin, pompe et crosse bois
function buildPompeModel() {
  const group = new THREE.Group();
  const wood = new THREE.MeshLambertMaterial({ color: 0x6e4522 });
  const metal = new THREE.MeshLambertMaterial({ color: 0x33363c });
  const darkMetal = new THREE.MeshLambertMaterial({ color: 0x1c1c1f });
  const add = modelHelpers(group);

  // Canon + tube magasin dessous
  add(new THREE.CylinderGeometry(0.016, 0.016, 0.52, 8), darkMetal, 0, 0.01, -0.42, Math.PI / 2);
  add(new THREE.CylinderGeometry(0.013, 0.013, 0.4, 8), metal, 0, -0.03, -0.38, Math.PI / 2);
  // Boîtier
  add(new THREE.BoxGeometry(0.05, 0.07, 0.22), metal, 0, 0, -0.12);
  // Pompe (garde-main coulissant)
  add(new THREE.CylinderGeometry(0.026, 0.026, 0.14, 8), wood, 0, -0.03, -0.45, Math.PI / 2);
  // Crosse
  add(new THREE.BoxGeometry(0.04, 0.09, 0.24), wood, 0, -0.035, 0.09, -0.1);

  return group;
}

// Minigun : bloc moteur + faisceau de canons qui en jette
function buildMinigunModel() {
  const group = new THREE.Group();
  const metal = new THREE.MeshLambertMaterial({ color: 0x3a4048 });
  const darkMetal = new THREE.MeshLambertMaterial({ color: 0x1c1c1f });
  const accent = new THREE.MeshLambertMaterial({ color: 0x8a2f2f });
  const add = modelHelpers(group);

  // Bloc moteur
  add(new THREE.CylinderGeometry(0.06, 0.065, 0.2, 10), metal, 0, 0, -0.1, Math.PI / 2);
  add(new THREE.BoxGeometry(0.08, 0.1, 0.14), accent, 0, -0.02, 0.06);
  // Faisceau de 6 canons autour d'un axe
  add(new THREE.CylinderGeometry(0.012, 0.012, 0.44, 6), darkMetal, 0, 0, -0.42, Math.PI / 2);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    add(
      new THREE.CylinderGeometry(0.011, 0.011, 0.42, 6), metal,
      Math.cos(a) * 0.032, Math.sin(a) * 0.032, -0.4, Math.PI / 2
    );
  }
  // Cerclage avant
  add(new THREE.CylinderGeometry(0.05, 0.05, 0.03, 10), darkMetal, 0, 0, -0.56, Math.PI / 2);

  return group;
}

// Bazooka : gros tube vert olive porté à l'épaule
function buildBazookaModel() {
  const group = new THREE.Group();
  const olive = new THREE.MeshLambertMaterial({ color: 0x5c6b3c });
  const darkMetal = new THREE.MeshLambertMaterial({ color: 0x1c1c1f });
  const warhead = new THREE.MeshLambertMaterial({ color: 0x9aa38f });
  const add = modelHelpers(group);

  // Tube principal (décalé vers l'épaule droite)
  add(new THREE.CylinderGeometry(0.055, 0.055, 0.9, 10), olive, 0.02, 0.06, -0.2, Math.PI / 2);
  // Évasements avant/arrière
  add(new THREE.CylinderGeometry(0.075, 0.055, 0.1, 10), olive, 0.02, 0.06, -0.68, Math.PI / 2);
  add(new THREE.CylinderGeometry(0.055, 0.075, 0.1, 10), olive, 0.02, 0.06, 0.28, Math.PI / 2);
  // Ogive qui dépasse
  add(new THREE.ConeGeometry(0.045, 0.14, 8), warhead, 0.02, 0.06, -0.78, -Math.PI / 2);
  // Poignées + viseur
  add(new THREE.BoxGeometry(0.03, 0.09, 0.04), darkMetal, 0.02, -0.03, -0.1);
  add(new THREE.BoxGeometry(0.03, 0.07, 0.04), darkMetal, 0.02, -0.02, -0.32);
  add(new THREE.BoxGeometry(0.02, 0.06, 0.03), darkMetal, 0.02, 0.14, -0.3);

  return group;
}
