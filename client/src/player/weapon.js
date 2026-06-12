import * as THREE from 'three';
import { state } from '../state.js';
import { IS_TOUCH } from './controls.js';
import { audio } from '../audio.js';

const FIRE_INTERVAL = 0.1; // ~600 coups/min
const MAG_SIZE = 30;
const RELOAD_TIME = 1.6;
const RANGE_DIST = 120;
const TRACER_SPEED = 260; // m/s (visuel)
const MAX_SHELLS = 36;

export function createWeapon(camera, scene, shootables, { onAmmoChange, onShot, getGroundY }) {
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

  // --- Effets : traceurs et impacts (aussi utilisés pour les tirs des autres) ---
  const tracers = []; // { mesh, dir, remaining }
  const tracerGeo = new THREE.BoxGeometry(0.03, 0.03, 0.9);
  const tracerMat = new THREE.MeshBasicMaterial({
    color: 0xffe9a0, blending: THREE.AdditiveBlending, depthWrite: false,
  });

  const particles = []; // { mesh, vel, life, maxLife }
  const particleGeo = new THREE.SphereGeometry(0.03, 5, 5);

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
    group.localToWorld(breech);
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
    const core = new THREE.Mesh(
      particleGeo,
      new THREE.MeshBasicMaterial({
        color: 0xfff3c0, transparent: true, opacity: 1,
        blending: THREE.AdditiveBlending, depthWrite: false,
      })
    );
    core.position.copy(p);
    core.scale.setScalar(2.5);
    scene.add(core);
    particles.push({ mesh: core, vel: new THREE.Vector3(), life: 0.12, maxLife: 0.12 });
    // Gerbe d'étincelles
    for (let i = 0; i < 7; i++) {
      const m = new THREE.Mesh(
        particleGeo,
        new THREE.MeshBasicMaterial({
          color: i % 2 ? 0xffc964 : 0xff8a3d, transparent: true, opacity: 1,
          blending: THREE.AdditiveBlending, depthWrite: false,
        })
      );
      m.position.copy(p);
      scene.add(m);
      const vel = new THREE.Vector3(
        (Math.random() - 0.5) * 5,
        Math.random() * 4 + 1,
        (Math.random() - 0.5) * 5
      );
      const life = 0.25 + Math.random() * 0.2;
      particles.push({ mesh: m, vel, life, maxLife: life });
    }
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
    if (e.code === 'KeyR') reload();
  });

  function reload() {
    if (state.weaponEquipped && reloading <= 0 && ammo < MAG_SIZE) {
      reloading = RELOAD_TIME;
      audio.reload();
      onAmmoChange(ammo, true);
    }
  }

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
    audio.gunshot();
    spawnShell();
    onAmmoChange(ammo, false);

    if (state.rangeSession) state.rangeSession.shots += 1;

    raycaster.setFromCamera({ x: 0, y: 0 }, camera);
    const hits = raycaster.intersectObjects(shootables, false);

    const muzzle = new THREE.Vector3();
    flash.getWorldPosition(muzzle);
    let end;
    if (hits.length > 0) {
      const hit = hits[0];
      end = hit.point.clone();
      hit.object.userData.onHit?.(hit);
      spawnImpact(hit.point);
    } else {
      end = raycaster.ray.at(RANGE_DIST, new THREE.Vector3());
    }
    spawnTracer(muzzle.toArray(), end.toArray());
    onShot?.(muzzle.toArray(), end.toArray());

    if (ammo <= 0) {
      reloading = RELOAD_TIME;
      audio.reload();
      onAmmoChange(0, true);
    }
  }

  function update(dt, isMoving) {
    flash.material.opacity = Math.max(0, flash.material.opacity - dt * 14);
    recoil = Math.max(0, recoil - dt * 9);

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

    // Étincelles d'impact
    for (let i = particles.length - 1; i >= 0; i--) {
      const s = particles[i];
      s.life -= dt;
      s.vel.y -= 12 * dt;
      s.mesh.position.addScaledVector(s.vel, dt);
      s.mesh.material.opacity = Math.max(0, s.life / s.maxLife);
      if (s.life <= 0) {
        scene.remove(s.mesh);
        s.mesh.material.dispose();
        particles.splice(i, 1);
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
    const inputOk = IS_TOUCH || state.pointerLocked;
    const canShoot =
      inputOk && !state.overlayOpen && !state.tagMode &&
      triggerDown && cooldown <= 0 && reloading <= 0 && ammo > 0;
    if (canShoot) shoot();

    // Animation : balancement de course + recul
    bobTime += dt * (isMoving ? 10 : 2);
    const bobX = Math.sin(bobTime) * (isMoving ? 0.01 : 0.002);
    const bobY = Math.abs(Math.cos(bobTime)) * (isMoving ? 0.008 : 0.002);
    const reloadDip = reloading > 0 ? Math.sin((reloading / RELOAD_TIME) * Math.PI) * 0.16 : 0;
    group.position.set(0.26 + bobX, -0.24 - bobY - reloadDip, -0.45 + recoil * 0.06);
    group.rotation.set(recoil * 0.09 - reloadDip * 0.8, 0, 0);
  }

  return {
    update,
    toggle,
    reload,
    setTrigger(down) { triggerDown = down; },
    fx: { spawnTracer, spawnImpact },
    get ammo() { return ammo; },
  };
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
