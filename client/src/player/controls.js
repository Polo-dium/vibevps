import * as THREE from 'three';
import { state } from '../state.js';
import { SPAWN } from '../world/layout.js';

const MOVE_SPEED = 10.0; // sprint automatique : on court tout le temps
const ACCEL = 14; // réactivité des déplacements
const JUMP_SPEED = 7.2;
const GRAVITY = 21;
const EYE_HEIGHT = 1.62;
const HALF_W = 0.35; // demi-largeur du joueur
const HEIGHT = 1.75;
const STEP_UP = 0.55; // hauteur de marche franchissable automatiquement

export const IS_TOUCH = window.matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;

export function createControls(camera, domElement, colliders) {
  const pos = new THREE.Vector3(SPAWN.x, SPAWN.y, SPAWN.z); // position des pieds
  const vel = new THREE.Vector3();
  let yaw = SPAWN.ry;
  let pitch = 0;
  let onGround = true;
  const keys = new Set();
  // Entrées tactiles (mobile)
  const touchMove = { fwd: 0, strafe: 0 };
  let wantJump = false;

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
      pos.x + HALF_W > box.minX && pos.x - HALF_W < box.maxX &&
      pos.y + HEIGHT > box.minY && pos.y < box.maxY &&
      pos.z + HALF_W > box.minZ && pos.z - HALF_W < box.maxZ
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
        const half = HALF_W;
        if (axis === 'x') {
          pos.x = delta > 0 ? box.minX - half : box.maxX + half;
        } else {
          pos.z = delta > 0 ? box.minZ - half : box.maxZ + half;
        }
      }
    }
  }

  function canStandAt(x, y, z, ignore) {
    for (const box of activeColliders) {
      if (box === ignore) continue;
      if (
        x + HALF_W > box.minX && x - HALF_W < box.maxX &&
        y + HEIGHT > box.minY && y < box.maxY &&
        z + HALF_W > box.minZ && z - HALF_W < box.maxZ
      ) return false;
    }
    return true;
  }

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
    if (pos.y <= 0) { pos.y = 0; vel.y = 0; onGround = true; }
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
    teleport(x, y, z) {
      pos.set(x, y, z);
      vel.set(0, 0, 0);
    },
    netState() {
      return {
        p: [Math.round(pos.x * 100) / 100, Math.round(pos.y * 100) / 100, Math.round(pos.z * 100) / 100],
        ry: Math.round(yaw * 1000) / 1000,
        m: this.isMoving() ? 1 : 0,
      };
    },
  };
}
