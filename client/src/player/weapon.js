import * as THREE from 'three';
import { state } from '../state.js';

const FIRE_INTERVAL = 0.1; // ~600 coups/min
const MAG_SIZE = 30;
const RELOAD_TIME = 1.6;
const RANGE_DIST = 120;

export function createWeapon(camera, scene, shootables, { onAmmoChange, onShot }) {
  const group = buildAkModel();
  group.visible = false;
  camera.add(group);

  const raycaster = new THREE.Raycaster();
  raycaster.far = RANGE_DIST;

  let ammo = MAG_SIZE;
  let reloading = 0;
  let cooldown = 0;
  let triggerDown = false;
  let recoil = 0;
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
  group.add(flash);

  // Impacts (étincelles temporaires)
  const sparks = [];
  const sparkGeo = new THREE.SphereGeometry(0.035, 6, 6);
  const sparkMat = new THREE.MeshBasicMaterial({ color: 0xffe9a0 });

  window.addEventListener('mousedown', (e) => {
    if (e.button === 0) triggerDown = true;
  });
  window.addEventListener('mouseup', (e) => {
    if (e.button === 0) triggerDown = false;
  });
  window.addEventListener('keydown', (e) => {
    if (state.overlayOpen) return;
    if (e.code === 'Digit1' || e.code === 'Ampersand') toggle();
    if (e.code === 'KeyR' && state.weaponEquipped && reloading <= 0 && ammo < MAG_SIZE) {
      reloading = RELOAD_TIME;
      onAmmoChange(ammo, true);
    }
  });

  function toggle(force) {
    state.weaponEquipped = force ?? !state.weaponEquipped;
    group.visible = state.weaponEquipped;
    onAmmoChange(ammo, reloading > 0);
  }

  function shoot() {
    ammo -= 1;
    cooldown = FIRE_INTERVAL;
    recoil = 1;
    flash.material.opacity = 1;
    flash.rotation.z = Math.random() * Math.PI;
    onAmmoChange(ammo, false);

    if (state.rangeSession) state.rangeSession.shots += 1;
    onShot?.();

    raycaster.setFromCamera({ x: 0, y: 0 }, camera);
    const hits = raycaster.intersectObjects(shootables, false);
    if (hits.length > 0) {
      const hit = hits[0];
      hit.object.userData.onHit?.(hit);
      spawnSpark(hit.point);
    }

    if (ammo <= 0) {
      reloading = RELOAD_TIME;
      onAmmoChange(0, true);
    }
  }

  function spawnSpark(point) {
    const mesh = new THREE.Mesh(sparkGeo, sparkMat.clone());
    mesh.position.copy(point);
    scene.add(mesh);
    sparks.push({ mesh, life: 0.18 });
  }

  function update(dt, isMoving, isSprinting) {
    flash.material.opacity = Math.max(0, flash.material.opacity - dt * 14);
    recoil = Math.max(0, recoil - dt * 9);

    for (let i = sparks.length - 1; i >= 0; i--) {
      sparks[i].life -= dt;
      sparks[i].mesh.scale.multiplyScalar(1 + dt * 6);
      sparks[i].mesh.material.opacity = sparks[i].life / 0.18;
      if (sparks[i].life <= 0) {
        scene.remove(sparks[i].mesh);
        sparks.splice(i, 1);
      }
    }

    if (!state.weaponEquipped) return;

    if (reloading > 0) {
      reloading -= dt;
      if (reloading <= 0) {
        ammo = MAG_SIZE;
        onAmmoChange(ammo, false);
      }
    }

    cooldown -= dt;
    const canShoot =
      state.pointerLocked && !state.overlayOpen &&
      triggerDown && cooldown <= 0 && reloading <= 0 && ammo > 0;
    if (canShoot) shoot();

    // Animation : balancement de marche + recul
    bobTime += dt * (isMoving ? (isSprinting ? 11 : 7.5) : 2);
    const bobX = Math.sin(bobTime) * (isMoving ? 0.009 : 0.002);
    const bobY = Math.abs(Math.cos(bobTime)) * (isMoving ? 0.007 : 0.002);
    const reloadDip = reloading > 0 ? Math.sin((reloading / RELOAD_TIME) * Math.PI) * 0.16 : 0;
    group.position.set(0.26 + bobX, -0.24 - bobY - reloadDip, -0.45 + recoil * 0.06);
    group.rotation.set(recoil * 0.09 - reloadDip * 0.8, 0, 0);
  }

  return { update, toggle, get ammo() { return ammo; } };
}

// AK-47 low-poly construite en primitives
function buildAkModel() {
  const group = new THREE.Group();
  const wood = new THREE.MeshLambertMaterial({ color: 0x7a4a26 });
  const metal = new THREE.MeshLambertMaterial({ color: 0x2b2b2e });
  const darkMetal = new THREE.MeshLambertMaterial({ color: 0x1c1c1f });

  const add = (geo, mat, x, y, z, rx = 0, ry = 0, rz = 0) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.rotation.set(rx, ry, rz);
    group.add(m);
    return m;
  };

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

  group.position.set(0.26, -0.24, -0.45);
  return group;
}
