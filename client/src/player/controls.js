import * as THREE from 'three';
import { state } from '../state.js';
import { spawnPoint } from '../world/layout.js';

const MOVE_SPEED = 10.0; // sprint automatique : on court tout le temps
const ACCEL = 14; // réactivité des déplacements
const JUMP_SPEED = 7.2;
const GRAVITY = 21;
const EYE_HEIGHT = 1.62;
const HALF_W = 0.35; // demi-largeur du joueur
const HEIGHT = 1.75;
const STEP_UP = 0.55; // hauteur de marche franchissable automatiquement

export const IS_TOUCH = window.matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;

export function createControls(camera, domElement, colliders, terrain = null) {
  const sp = spawnPoint();
  const pos = new THREE.Vector3(sp.x, sp.y, sp.z); // position des pieds
  const vel = new THREE.Vector3();
  let yaw = sp.ry;
  let pitch = 0;
  let onGround = true;
  const keys = new Set();
  // Entrées tactiles (mobile)
  const touchMove = { fwd: 0, strafe: 0 };
  let wantJump = false;
  // Mode véhicule : quand il est défini, update() conduit au lieu de marcher
  // ({ heading, speed, onHorn, onCrash } — la position reste `pos`)
  let vehicle = null;
  let bodyHalf = HALF_W; // s'élargit au volant

  if (!IS_TOUCH) {
    domElement.addEventListener('click', () => {
      if (!state.overlayOpen && !state.pointerLocked) {
        domElement.requestPointerLock();
      }
    });
  }
  document.addEventListener('pointerlockchange', () => {
    state.pointerLocked = document.pointerLockElement === domElement;
  });
  document.addEventListener('mousemove', (e) => {
    if (!state.pointerLocked) return;
    addLook(e.movementX, e.movementY);
  });
  // event.code = touche physique : ZQSD sur AZERTY = WASD physique, les deux marchent.
  window.addEventListener('keydown', (e) => {
    if (state.overlayOpen) return;
    keys.add(e.code);
    if (e.code === 'Space') e.preventDefault();
  });
  window.addEventListener('keyup', (e) => keys.delete(e.code));
  window.addEventListener('blur', () => keys.clear());

  function addLook(dx, dy) {
    yaw -= dx * 0.0023;
    pitch -= dy * 0.0023;
    pitch = Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01, pitch));
  }

  function inputActive() {
    return !state.overlayOpen && (IS_TOUCH || state.pointerLocked);
  }

  // Liste de colliders proches, rafraîchie à chaque frame (grille spatiale)
  let activeColliders = colliders;

  function overlaps(box) {
    return (
      pos.x + bodyHalf > box.minX && pos.x - bodyHalf < box.maxX &&
      pos.y + HEIGHT > box.minY && pos.y < box.maxY &&
      pos.z + bodyHalf > box.minZ && pos.z - bodyHalf < box.maxZ
    );
  }

  function resolveAxis(axis, delta) {
    if (delta === 0) return;
    pos[axis] += delta;
    for (const box of activeColliders) {
      if (!overlaps(box)) continue;
      if (axis === 'y') {
        if (delta < 0) {
          pos.y = box.maxY;
          vel.y = 0;
          onGround = true;
        } else {
          pos.y = box.minY - HEIGHT;
          vel.y = 0;
        }
      } else {
        // Petite marche : on monte automatiquement dessus
        const stepH = box.maxY - pos.y;
        if (stepH > 0 && stepH <= STEP_UP && canStandAt(pos.x, box.maxY, pos.z, box)) {
          pos.y = box.maxY;
          onGround = true;
          continue;
        }
        const half = bodyHalf;
        if (axis === 'x') {
          pos.x = delta > 0 ? box.minX - half : box.maxX + half;
        } else {
          pos.z = delta > 0 ? box.minZ - half : box.maxZ + half;
        }
        if (vehicle) hitWall = true;
      }
    }
  }

  function canStandAt(x, y, z, ignore) {
    for (const box of activeColliders) {
      if (box === ignore) continue;
      if (
        x + bodyHalf > box.minX && x - bodyHalf < box.maxX &&
        y + HEIGHT > box.minY && y < box.maxY &&
        z + bodyHalf > box.minZ && z - bodyHalf < box.maxZ
      ) return false;
    }
    return true;
  }

  // Collision latérale du véhicule pendant la frame en cours
  let hitWall = false;

  function update(dt) {
    const active = inputActive();
    if (colliders.nearby) {
      activeColliders = colliders.nearby(pos.x, pos.z, 4);
    }

    // Direction souhaitée dans le plan horizontal
    let fwd = 0, strafe = 0;
    if (active) {
      if (keys.has('KeyW') || keys.has('ArrowUp')) fwd += 1;
      if (keys.has('KeyS') || keys.has('ArrowDown')) fwd -= 1;
      if (keys.has('KeyD') || keys.has('ArrowRight')) strafe += 1;
      if (keys.has('KeyA') || keys.has('ArrowLeft')) strafe -= 1;
      fwd += touchMove.fwd;
      strafe += touchMove.strafe;
    }

    if (vehicle) {
      // --- Conduite : W/S accélère et freine, A/D braque, Espace klaxonne
      const v = vehicle;
      const braking = fwd < 0 && v.speed > 0.5;
      v.speed += fwd * (braking ? 16 : 9) * dt;
      v.speed *= 1 - 1.1 * dt; // frottements
      v.speed = Math.max(-7, Math.min(19, v.speed));
      if (Math.abs(v.speed) < 0.04 && fwd === 0) v.speed = 0;
      // Braquage proportionnel à la vitesse (pas de rotation à l'arrêt)
      const grip = Math.min(1, Math.abs(v.speed) / 5);
      v.heading -= strafe * 1.9 * grip * Math.sign(v.speed || 1) * dt;

      if (active && (keys.has('Space') || wantJump)) {
        if (!v._hornAt || performance.now() - v._hornAt > 350) {
          v._hornAt = performance.now();
          v.onHorn?.();
        }
      }
      wantJump = false;

      vel.x = -Math.sin(v.heading) * v.speed;
      vel.z = -Math.cos(v.heading) * v.speed;
      vel.y -= GRAVITY * dt;

      onGround = false;
      hitWall = false;
      resolveAxis('y', vel.y * dt);
      // Le terrain peut être NÉGATIF (lit des fleuves en contrebas)
      const gLevel = terrain ? terrain(pos.x, pos.z) : 0;
      if (pos.y <= gLevel) { pos.y = gLevel; vel.y = 0; onGround = true; }
      resolveAxis('x', vel.x * dt);
      resolveAxis('z', vel.z * dt);
      if (hitWall && Math.abs(v.speed) > 2.5) {
        v.speed *= -0.28; // rebond de tôle
        v.onCrash?.();
      } else if (hitWall) {
        v.speed = 0;
      }

      camera.position.set(pos.x, pos.y + 1.15, pos.z); // assis au volant
      camera.rotation.order = 'YXZ';
      camera.rotation.set(pitch, yaw, 0);
      return;
    }

    const sin = Math.sin(yaw), cos = Math.cos(yaw);
    let dx = (-sin * fwd + cos * strafe);
    let dz = (-cos * fwd - sin * strafe);
    const len = Math.hypot(dx, dz);
    if (len > 1) { dx /= len; dz /= len; }

    // Accélération horizontale exponentielle (nerveuse mais fluide)
    const k = 1 - Math.exp(-ACCEL * dt);
    vel.x += (dx * MOVE_SPEED - vel.x) * k;
    vel.z += (dz * MOVE_SPEED - vel.z) * k;

    if (active && (keys.has('Space') || wantJump) && onGround) {
      vel.y = JUMP_SPEED;
      onGround = false;
    }
    wantJump = false;
    vel.y -= GRAVITY * dt;

    onGround = false;
    resolveAxis('y', vel.y * dt);
    // Sol : terrain (colline de Fourvière, lit des fleuves en contrebas) ou 0
    const groundLevel = terrain ? terrain(pos.x, pos.z) : 0;
    if (pos.y <= groundLevel) { pos.y = groundLevel; vel.y = 0; onGround = true; }
    resolveAxis('x', vel.x * dt);
    resolveAxis('z', vel.z * dt);

    camera.position.set(pos.x, pos.y + EYE_HEIGHT, pos.z);
    camera.rotation.order = 'YXZ';
    camera.rotation.set(pitch, yaw, 0);
  }

  return {
    update,
    addLook,
    get position() { return pos; },
    get yaw() { return yaw; },
    isMoving() { return Math.hypot(vel.x, vel.z) > 0.5; },
    speed() { return Math.hypot(vel.x, vel.z); },
    get onGround() { return onGround; },
    setTouchMove(fwd, strafe) {
      touchMove.fwd = fwd;
      touchMove.strafe = strafe;
    },
    jump() { wantJump = true; },
    // Entrer/sortir du mode véhicule ({ heading, speed, onHorn, onCrash })
    setVehicle(v) {
      vehicle = v;
      bodyHalf = v ? 1.05 : HALF_W;
      if (v) yaw = v.heading; // on regarde d'abord la route
    },
    get vehicle() { return vehicle; },
    teleport(x, y, z, ry) {
      pos.set(x, y, z);
      vel.set(0, 0, 0);
      if (ry !== undefined) yaw = ry;
    },
    netState() {
      const s = {
        p: [Math.round(pos.x * 100) / 100, Math.round(pos.y * 100) / 100, Math.round(pos.z * 100) / 100],
        ry: Math.round(yaw * 1000) / 1000,
        m: this.isMoving() ? 1 : 0,
      };
      // Au volant : les autres joueurs voient la voiture (champs optionnels,
      // ignorés par les anciens clients/serveurs)
      if (vehicle) {
        s.veh = 1;
        s.vry = Math.round(vehicle.heading * 1000) / 1000;
      }
      return s;
    },
  };
}
