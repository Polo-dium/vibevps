import * as THREE from 'three';
import { state } from '../state.js';
import { SPAWN } from '../world/layout.js';

const WALK_SPEED = 6.2;
const SPRINT_SPEED = 10.5;
const ACCEL = 14; // réactivité des déplacements
const JUMP_SPEED = 7.2;
const GRAVITY = 21;
const EYE_HEIGHT = 1.62;
const HALF_W = 0.35; // demi-largeur du joueur
const HEIGHT = 1.75;
const STEP_UP = 0.55; // hauteur de marche franchissable automatiquement

export function createControls(camera, domElement, colliders) {
  const pos = new THREE.Vector3(SPAWN.x, SPAWN.y, SPAWN.z); // position des pieds
  const vel = new THREE.Vector3();
  let yaw = SPAWN.ry;
  let pitch = 0;
  let onGround = true;
  const keys = new Set();

  domElement.addEventListener('click', () => {
    if (!state.overlayOpen && !state.pointerLocked) {
      domElement.requestPointerLock();
    }
  });
  document.addEventListener('pointerlockchange', () => {
    state.pointerLocked = document.pointerLockElement === domElement;
  });
  document.addEventListener('mousemove', (e) => {
    if (!state.pointerLocked) return;
    yaw -= e.movementX * 0.0023;
    pitch -= e.movementY * 0.0023;
    pitch = Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01, pitch));
  });
  // event.code = touche physique : ZQSD sur AZERTY = WASD physique, les deux marchent.
  window.addEventListener('keydown', (e) => {
    if (state.overlayOpen) return;
    keys.add(e.code);
    if (e.code === 'Space') e.preventDefault();
  });
  window.addEventListener('keyup', (e) => keys.delete(e.code));
  window.addEventListener('blur', () => keys.clear());

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
    for (const box of colliders) {
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
    for (const box of colliders) {
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
    const locked = state.pointerLocked && !state.overlayOpen;

    // Direction souhaitée dans le plan horizontal
    let fwd = 0, strafe = 0;
    if (locked) {
      if (keys.has('KeyW') || keys.has('ArrowUp')) fwd += 1;
      if (keys.has('KeyS') || keys.has('ArrowDown')) fwd -= 1;
      if (keys.has('KeyD') || keys.has('ArrowRight')) strafe += 1;
      if (keys.has('KeyA') || keys.has('ArrowLeft')) strafe -= 1;
    }
    const sprint = keys.has('ShiftLeft') || keys.has('ShiftRight');
    const speed = sprint ? SPRINT_SPEED : WALK_SPEED;

    const sin = Math.sin(yaw), cos = Math.cos(yaw);
    let dx = (-sin * fwd + cos * strafe);
    let dz = (-cos * fwd - sin * strafe);
    const len = Math.hypot(dx, dz);
    if (len > 0) { dx /= len; dz /= len; }

    // Accélération horizontale exponentielle (nerveuse mais fluide)
    const k = 1 - Math.exp(-ACCEL * dt);
    vel.x += (dx * speed - vel.x) * k;
    vel.z += (dz * speed - vel.z) * k;

    if (locked && keys.has('Space') && onGround) {
      vel.y = JUMP_SPEED;
      onGround = false;
    }
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
    get position() { return pos; },
    get yaw() { return yaw; },
    isMoving() { return Math.hypot(vel.x, vel.z) > 0.5; },
    isSprinting() { return keys.has('ShiftLeft') || keys.has('ShiftRight'); },
    netState() {
      return {
        p: [Math.round(pos.x * 100) / 100, Math.round(pos.y * 100) / 100, Math.round(pos.z * 100) / 100],
        ry: Math.round(yaw * 1000) / 1000,
        m: this.isMoving() ? 1 : 0,
      };
    },
  };
}
