import * as THREE from 'three';
import { state } from '../state.js';
import { spawnPoint } from '../world/layout.js';

const MOVE_SPEED = 10.0; // sprint automatique : on court tout le temps
const ACCEL = 17; // réactivité des déplacements (relevée : plus nerveux)
const JUMP_SPEED = 10.2; // ×√2 vs 7,2 : hauteur de saut DOUBLÉE (h = v²/2g)
const SLIDE_TIME = 0.62; // glissade à l'atterrissage quand on pousse encore
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
  // Avion : manche gauche = gaz/lacet, manche droit = tangage/roulis.
  // Les gaz sont une commande de variation : le régime reste là où on l'a
  // réglé lorsque le pouce revient au centre.
  const touchPlane = { throttle: 0, yaw: 0, pitch: 0, roll: 0 };
  let wantJump = false;
  // Mode véhicule : quand il est défini, update() conduit au lieu de marcher
  // ({ heading, speed, onHorn, onCrash } — la position reste `pos`)
  let vehicle = null;
  let bodyHalf = HALF_W; // s'élargit au volant
  // Mode jetpack : vol libre, propulsion sur Espace
  let flying = false;
  let hover = false; // HOLD : maintien d'altitude (glissière tactile)
  let flyThrust = false; // poussée active cette frame (pour les particules)
  let touchThrust = false; // bouton de poussée tactile
  // Objets temporaires réutilisés par la physique de vol (zéro allocation
  // par frame, important sur mobile).
  const planeEuler = new THREE.Euler(0, 0, 0, 'YXZ');
  const planeDelta = new THREE.Quaternion();
  const planeForward = new THREE.Vector3(0, 0, -1);
  const planeUp = new THREE.Vector3(0, 1, 0);
  const planeDesired = new THREE.Vector3();
  const planeCamTarget = new THREE.Vector3();
  // Vue embarquée des avions : regard libre du pilote (offsets de « cou »
  // clampés, relatifs à la cellule) + repères réutilisés chaque frame.
  let lookYaw = 0, lookPitch = 0;
  const headEuler = new THREE.Euler(0, 0, 0, 'YXZ');
  const headQuat = new THREE.Quaternion();
  const seatOffset = new THREE.Vector3();
  // Vue « pilote au sol » : zoom auto fluide jusqu'à ×3 quand le modèle
  // s'éloigne. camera.zoom multiplie aussi l'écart angulaire à l'axe : les
  // bras et la radiocommande (enfants de la caméra) compensent par une
  // échelle transverse (1/zoom, 1/zoom, 1) — voir arms.js.
  let rcZoomOn = false;
  function clearRcZoom() {
    if (!rcZoomOn) return;
    rcZoomOn = false;
    camera.zoom = 1;
    camera.updateProjectionMatrix();
  }
  // Chute libre après un saut d'avion en plein vol : vraie gravité (9,81),
  // parachute dirigeable sur ESPACE — ou mort à l'impact si trop rapide.
  let skydive = false;
  let parachute = false;
  let onParachuteCb = null;
  let onFallDeathCb = null;
  // Glissade : déclenchée à l'atterrissage d'un vrai saut si on pousse
  // encore vers l'avant — élan bonus, caméra qui s'abaisse, cap verrouillé.
  let slide = 0;
  const slideDir = new THREE.Vector3();
  let slideCrouch = 0; // abaissement de caméra lissé
  let airTime = 0;

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
  window.addEventListener('mousedown', (e) => {
    if (e.button === 0 && vehicle?.plane) vehicle.trigger = true;
  });
  window.addEventListener('mouseup', (e) => {
    if (e.button === 0 && vehicle?.plane) vehicle.trigger = false;
  });

  function addLook(dx, dy) {
    if (vehicle?.plane) {
      // En vue embarquée, la souris tourne la TÊTE du pilote dans le cockpit
      // (limites d'un cou humain) ; dans les autres vues elle ne fait rien.
      const cockpitView = vehicle.remoteControl
        ? vehicle.camMode === 'fpv'
        : !vehicle.thirdPerson;
      if (cockpitView) {
        lookYaw = THREE.MathUtils.clamp(lookYaw - dx * 0.0023, -2.7, 2.7);
        lookPitch = THREE.MathUtils.clamp(lookPitch - dy * 0.0023, -1.05, 1.2);
      }
      return;
    }
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
      if (keys.has('KeyW') || (!vehicle?.plane && keys.has('ArrowUp'))) fwd += 1;
      if (keys.has('KeyS') || (!vehicle?.plane && keys.has('ArrowDown'))) fwd -= 1;
      if (keys.has('KeyD') || (!vehicle?.plane && keys.has('ArrowRight'))) strafe += 1;
      if (keys.has('KeyA') || (!vehicle?.plane && keys.has('ArrowLeft'))) strafe -= 1;
      fwd += touchMove.fwd;
      strafe += touchMove.strafe;
    }

    if (vehicle) {
      const v = vehicle;
      // Un modèle radiocommandé possède sa propre position/vitesse : le corps
      // du joueur reste au sol pendant que la caméra et la physique suivent
      // l'appareil. Les véhicules classiques continuent d'utiliser pos/vel.
      const craftPos = v.remoteControl ? v.position : pos;
      const craftVel = v.remoteControl ? v.velocity : vel;
      // Le terrain peut être NÉGATIF (lit des fleuves en contrebas)
      const gLevel = terrain ? terrain(craftPos.x, craftPos.z) : 0;

      if (v.plane) {
        // --- Avion 4 axes -------------------------------------------------
        // W/S ou manche gauche vertical : régime moteur persistant.
        // A/D ou manche gauche horizontal : lacet.
        // Flèches / manche droit : tangage et roulis continus, donc loopings
        // et tonneaux complets au lieu d'une simple montée artificielle.
        const clampInput = (n) => THREE.MathUtils.clamp(n, -1, 1);
        const throttleCmd = active ? clampInput(fwd + touchPlane.throttle) : 0;
        const yawCmd = active ? clampInput(strafe + touchPlane.yaw) : 0;
        const pitchKeys = (keys.has('ArrowDown') ? 1 : 0) - (keys.has('ArrowUp') ? 1 : 0);
        const rollKeys = (keys.has('ArrowRight') ? 1 : 0) - (keys.has('ArrowLeft') ? 1 : 0);
        const pitchCmd = active ? clampInput(pitchKeys + touchPlane.pitch) : 0;
        const rollCmd = active ? clampInput(rollKeys + touchPlane.roll) : 0;

        v.throttle = THREE.MathUtils.clamp((v.throttle ?? 0) + throttleCmd * 0.48 * dt, 0, 1);
        const maxSpeed = v.maxSpeed ?? 68;
        const targetSpeed = v.throttle * maxSpeed;
        const speedResponse = targetSpeed > v.speed ? (v.acceleration ?? 0.72) : 0.42;
        v.speed += (targetSpeed - v.speed) * (1 - Math.exp(-speedResponse * dt));
        v.speed = THREE.MathUtils.clamp(v.speed, 0, maxSpeed * 1.06);

        const grounded = craftPos.y <= gLevel + 0.16;
        const authority = THREE.MathUtils.clamp(v.speed / (v.controlSpeed ?? 18), 0.12, 1);
        const rateResponse = 1 - Math.exp(-5.5 * dt);
        v.pitchRate = (v.pitchRate ?? 0) +
          (pitchCmd * 1.5 * authority - (v.pitchRate ?? 0)) * rateResponse;
        // Manche à droite = aile droite qui descend, donc rotation Z négative.
        v.rollRate = (v.rollRate ?? 0) +
          (-rollCmd * 2.45 * authority - (v.rollRate ?? 0)) * rateResponse;
        v.yawRate = (v.yawRate ?? 0) +
          (-yawCmd * 0.95 * authority - (v.yawRate ?? 0)) * rateResponse;
        if (grounded) {
          // Sur la piste, le train impose encore un repère horizontal.
          v.pitch = (v.pitch ?? 0) + v.pitchRate * dt;
          v.roll = (v.roll ?? 0) + v.rollRate * dt;
          v.heading += v.yawRate * dt;
          v.roll *= Math.exp(-7 * dt);
          const takeoffSpeed = v.takeoffSpeed ?? 15;
          v.pitch = THREE.MathUtils.clamp(
            v.pitch, -0.08, v.speed > takeoffSpeed ? (v.groundPitchMax ?? 0.36) : 0.12
          );
          planeEuler.set(v.pitch, v.heading, v.roll, 'YXZ');
          v.orientation.setFromEuler(planeEuler);
        } else {
          // En vol, les trois rotations sont appliquées dans le REPÈRE LOCAL
          // de la cellule. Ainsi, après un roulis de 90°, tirer le manche
          // courbe la trajectoire horizontalement au lieu de monter sur un
          // axe fixe du monde. Le quaternion reste la source de vérité.
          planeEuler.set(
            v.pitchRate * dt,
            v.yawRate * dt,
            v.rollRate * dt,
            'YXZ'
          );
          planeDelta.setFromEuler(planeEuler);
          v.orientation.multiply(planeDelta).normalize();

          // Angles dérivés uniquement pour le réseau, l'interface et le
          // stationnement ; ils ne pilotent plus l'orientation en vol.
          planeEuler.setFromQuaternion(v.orientation, 'YXZ');
          v.pitch = planeEuler.x;
          v.heading = planeEuler.y;
          v.roll = planeEuler.z;
        }
        if (Math.abs(v.heading) > Math.PI * 2) v.heading %= Math.PI * 2;

        planeForward.set(0, 0, -1).applyQuaternion(v.orientation).normalize();
        planeUp.set(0, 1, 0).applyQuaternion(v.orientation).normalize();

        const airflow = THREE.MathUtils.clamp(
          (v.speed - (v.stallSpeed ?? 10)) / (v.liftRange ?? 20), 0, 1
        );
        planeDesired.copy(planeForward).multiplyScalar(v.speed);
        // L'inertie augmente en vol ; au sol l'avion colle encore à la piste.
        const velocityResponse = grounded ? 8 : (v.velocityResponse ?? 1.7) + airflow * 1.8;
        craftVel.lerp(planeDesired, 1 - Math.exp(-velocityResponse * dt));
        if (!grounded) {
          // Sous la vitesse de portance, le nez reste contrôlable mais la
          // cellule s'enfonce franchement : vrai risque de décrochage.
          // À vitesse de portance, la trajectoire suit vraiment le nez sans
          // descente verticale artificielle. La chute revient au décrochage.
          craftVel.y -= (1 - airflow) * 14 * dt;
        } else if (craftVel.y < 0) {
          craftVel.y = 0;
        }
        wantJump = false;
      } else {
        // --- Voiture : W/S accélère et freine, A/D braque, Espace klaxonne
        // (un Vélo'v est une « voiture » lente : accélération et plafond
        // propres au véhicule, mêmes commandes)
        const braking = fwd < 0 && v.speed > 0.5;
        v.speed += fwd * (braking ? 32 : (v.acceleration ?? 18)) * dt;
        v.speed *= 1 - 1.1 * dt; // frottements
        const capF = v.maxSpeed ?? 38;
        v.speed = Math.max(-(v.maxReverse ?? 14), Math.min(capF, v.speed));
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
        vel.y -= GRAVITY * dt;
      }

      if (!v.plane) {
        vel.x = -Math.sin(v.heading) * v.speed;
        vel.z = -Math.cos(v.heading) * v.speed;
      }

      onGround = false;
      hitWall = false;
      if (v.plane && v.remoteControl) {
        const ox = craftPos.x, oy = craftPos.y, oz = craftPos.z;
        craftPos.addScaledVector(craftVel, dt);
        const nextGround = terrain ? terrain(craftPos.x, craftPos.z) : 0;
        if (craftPos.y <= nextGround) {
          craftPos.y = nextGround;
          craftVel.y = Math.max(0, craftVel.y);
          onGround = true;
        }
        const ceiling = v.ceiling ?? 180;
        if (craftPos.y > ceiling) {
          craftPos.y = ceiling;
          craftVel.y = Math.min(craftVel.y, 0);
        }
        // Petite sphère de collision adaptée au modèle d'un mètre : elle peut
        // passer dans les rues, mais rebondit encore sur façades et obstacles.
        const r = v.collisionRadius ?? 0.38;
        for (const b of colliders.nearby?.(craftPos.x, craftPos.z, 2) ?? colliders) {
          if (craftPos.x + r > b.minX && craftPos.x - r < b.maxX &&
              craftPos.y + r > b.minY && craftPos.y - r < b.maxY &&
              craftPos.z + r > b.minZ && craftPos.z - r < b.maxZ) {
            hitWall = true;
            break;
          }
        }
        if (hitWall) {
          craftPos.set(ox, oy, oz);
          craftVel.multiplyScalar(0.08);
          v.speed *= 0.12;
          v.throttle *= 0.35;
          const now = performance.now();
          if (!v._lastCrashAt || now - v._lastCrashAt > 450) {
            v._lastCrashAt = now;
            v.onCrash?.();
          }
        }
      } else {
        resolveAxis('y', vel.y * dt);
        if (pos.y <= gLevel) { pos.y = gLevel; vel.y = 0; onGround = true; }
        const ceiling = v.ceiling ?? 520;
        if (v.plane && pos.y > ceiling) { pos.y = ceiling; vel.y = Math.min(vel.y, 0); }
        resolveAxis('x', vel.x * dt);
        resolveAxis('z', vel.z * dt);
        if (hitWall && Math.abs(v.speed) > 2.5) {
          v.speed *= v.plane ? 0.15 : -0.28; // rebond de tôle
          v.onCrash?.();
        } else if (hitWall) {
          v.speed = 0;
        }
      }

      const viewPos = v.remoteControl ? v.position : pos;
      if (v.remoteControl && (v.camMode ?? 'sol') === 'sol') {
        // Vue d'aéromodélisme : la caméra reste dans les yeux du joueur
        // resté au sol avec la radiocommande, et suit le modèle du regard.
        // Le zoom accompagne en douceur l'éloignement du modèle.
        camera.up.set(0, 1, 0);
        camera.position.set(pos.x, pos.y + EYE_HEIGHT, pos.z);
        const dist = camera.position.distanceTo(viewPos);
        const targetZoom = THREE.MathUtils.clamp(dist / 40, 1, 3);
        camera.zoom += (targetZoom - camera.zoom) * (1 - Math.exp(-2.5 * dt));
        camera.updateProjectionMatrix();
        rcZoomOn = true;
        planeCamTarget.copy(viewPos);
        camera.lookAt(planeCamTarget);
      } else if (v.thirdPerson) {
        clearRcZoom();
        // Caméra de poursuite (berlines, avions) : derrière et au-dessus,
        // regard sur le véhicule — le braquage tourne la caméra avec le cap
        const back = v.camBack ?? 8.2, up = v.camUp ?? 3.4;
        if (v.plane && v.orientation) {
          // Caméra solidaire de la cellule : elle suit tangage et roulis,
          // indispensable pour lire un looping ou un tonneau.
          camera.up.copy(planeUp);
          camera.position.copy(viewPos)
            .addScaledVector(planeForward, -back)
            .addScaledVector(planeUp, up);
          planeCamTarget.copy(viewPos)
            .addScaledVector(planeForward, 8)
            .addScaledVector(planeUp, 1.1);
          camera.lookAt(planeCamTarget);
        } else {
          camera.up.set(0, 1, 0);
          camera.position.set(
            pos.x + Math.sin(v.heading) * back,
            pos.y + up,
            pos.z + Math.cos(v.heading) * back
          );
          camera.rotation.order = 'YXZ';
          camera.lookAt(pos.x, pos.y + 1.3, pos.z);
        }
      } else if (v.plane && v.orientation) {
        // Vue embarquée : assis DANS le cockpit (siège défini par l'avion,
        // carlingue et ailes visibles autour), tête libre à la souris.
        clearRcZoom();
        const seat = v.cockpit ?? { x: 0, y: 0.2, z: 0 };
        seatOffset.set(seat.x, seat.y, seat.z).applyQuaternion(v.orientation);
        camera.position.copy(viewPos).add(seatOffset);
        headEuler.set(lookPitch, lookYaw, 0);
        headQuat.setFromEuler(headEuler);
        camera.quaternion.copy(v.orientation).multiply(headQuat);
        camera.up.copy(planeUp);
      } else {
        // Assis au volant (décapotables) : caméra relevée, côté conducteur.
        // Sur un Vélo'v on est au centre, en selle, un peu plus haut.
        clearRcZoom();
        const seatSide = v.bike ? 0 : 0.45;
        camera.position.set(
          pos.x - Math.cos(v.heading) * seatSide,
          pos.y + (v.bike ? 1.55 : 1.42),
          pos.z + Math.sin(v.heading) * seatSide
        );
        camera.rotation.order = 'YXZ';
        camera.rotation.set(pitch, yaw, 0);
      }
      return;
    }

    if (flying) {
      // --- Jetpack : ZQSD vole dans la direction du regard, Espace pousse
      // vers le haut, gravité douce sinon. Poussée = Espace maintenu.
      const sinF = Math.sin(yaw), cosF = Math.cos(yaw);
      let fx = (-sinF * fwd + cosF * strafe);
      let fz = (-cosF * fwd - sinF * strafe);
      const flen = Math.hypot(fx, fz);
      if (flen > 1) { fx /= flen; fz /= flen; }
      const FLY_SPEED = 16;
      const kf = 1 - Math.exp(-8 * dt);
      vel.x += (fx * FLY_SPEED - vel.x) * kf;
      vel.z += (fz * FLY_SPEED - vel.z) * kf;

      const thrusting = active && (keys.has('Space') || wantJump || touchThrust);
      flyThrust = thrusting;
      if (thrusting) {
        hover = false; // pousser reprend la main sur le maintien d'altitude
        vel.y += 26 * dt;
        vel.y = Math.min(vel.y, 15);
      }
      if (hover && !thrusting) {
        // HOLD : le jetpack tient l'altitude tout seul, on circule à plat
        vel.y += (0 - vel.y) * (1 - Math.exp(-7 * dt));
      } else {
        vel.y -= 11 * dt; // gravité de vol, plus douce
      }
      vel.y = Math.max(vel.y, -14);
      wantJump = false;

      onGround = false;
      resolveAxis('y', vel.y * dt);
      const gLev = terrain ? terrain(pos.x, pos.z) : 0;
      if (pos.y <= gLev) { pos.y = gLev; vel.y = 0; onGround = true; }
      resolveAxis('x', vel.x * dt);
      resolveAxis('z', vel.z * dt);

      camera.position.set(pos.x, pos.y + EYE_HEIGHT, pos.z);
      camera.rotation.order = 'YXZ';
      camera.rotation.set(pitch, yaw, 0);
      return;
    }

    if (skydive) {
      // --- Chute libre après avoir sauté d'un avion ----------------------
      if (active && (keys.has('Space') || wantJump) && !parachute) {
        parachute = true;
        onParachuteCb?.();
      }
      wantJump = false;
      if (parachute) {
        // Voile ouverte : descente plafonnée en douceur, dérive dirigeable
        // (ZQSD / joystick) dans la direction du regard.
        vel.y += (-6 - vel.y) * (1 - Math.exp(-1.8 * dt));
        const sinP = Math.sin(yaw), cosP = Math.cos(yaw);
        let fx = (-sinP * fwd + cosP * strafe);
        let fz = (-cosP * fwd - sinP * strafe);
        const fl = Math.hypot(fx, fz);
        if (fl > 1) { fx /= fl; fz /= fl; }
        const ks = 1 - Math.exp(-1.2 * dt);
        vel.x += (fx * 11 - vel.x) * ks;
        vel.z += (fz * 11 - vel.z) * ks;
      } else {
        vel.y -= 9.81 * dt; // vraie gravité terrestre, pas celle du jeu
        const drag = Math.exp(-0.12 * dt); // léger freinage aérodynamique
        vel.x *= drag;
        vel.z *= drag;
      }
      const impact = -vel.y;
      onGround = false;
      resolveAxis('y', vel.y * dt);
      const gSky = terrain ? terrain(pos.x, pos.z) : 0;
      if (pos.y <= gSky) {
        pos.y = gSky;
        vel.y = 0;
        onGround = true;
        skydive = false;
        parachute = false;
        // Trop rapide à l'impact (voile fermée, ou ouverte trop tard) : mort.
        if (impact > 14) onFallDeathCb?.(impact);
      }
      resolveAxis('x', vel.x * dt);
      resolveAxis('z', vel.z * dt);
      camera.position.set(pos.x, pos.y + EYE_HEIGHT, pos.z);
      camera.rotation.order = 'YXZ';
      camera.rotation.set(pitch, yaw, 0);
      return;
    }

    const sin = Math.sin(yaw), cos = Math.cos(yaw);
    let dx = (-sin * fwd + cos * strafe);
    let dz = (-cos * fwd - sin * strafe);
    const len = Math.hypot(dx, dz);
    if (len > 1) { dx /= len; dz /= len; }

    // Accélération horizontale exponentielle (nerveuse mais fluide).
    // En glissade, le cap est verrouillé et l'élan bonus s'éteint tout seul.
    const k = 1 - Math.exp(-ACCEL * dt);
    if (slide > 0) {
      slide -= dt;
      const boost = MOVE_SPEED * (1.9 * Math.max(0, slide / SLIDE_TIME) + 0.4);
      vel.x += (slideDir.x * boost - vel.x) * k;
      vel.z += (slideDir.z * boost - vel.z) * k;
      if (fwd <= 0.05) slide = 0; // on cesse de pousser → fin de glissade
    } else {
      vel.x += (dx * MOVE_SPEED - vel.x) * k;
      vel.z += (dz * MOVE_SPEED - vel.z) * k;
    }

    if (active && (keys.has('Space') || wantJump) && onGround) {
      vel.y = JUMP_SPEED;
      onGround = false;
      slide = 0;
    }
    wantJump = false;
    vel.y -= GRAVITY * dt;

    const wasGrounded = onGround;
    onGround = false;
    resolveAxis('y', vel.y * dt);
    // Sol : terrain (colline de Fourvière, lit des fleuves en contrebas) ou 0
    const groundLevel = terrain ? terrain(pos.x, pos.z) : 0;
    if (pos.y <= groundLevel) { pos.y = groundLevel; vel.y = 0; onGround = true; }
    if (!onGround) {
      airTime += dt;
    } else {
      // Atterrissage d'un vrai saut, ZQSD encore vers l'avant → glissade
      if (!wasGrounded && airTime > 0.22 && fwd > 0.4 &&
          Math.hypot(vel.x, vel.z) > 6) {
        slide = SLIDE_TIME;
        slideDir.set(vel.x, 0, vel.z).normalize();
      }
      airTime = 0;
    }
    resolveAxis('x', vel.x * dt);
    resolveAxis('z', vel.z * dt);

    // La caméra s'abaisse pendant la glissade (et remonte en douceur)
    slideCrouch += (((slide > 0) ? 0.72 : 0) - slideCrouch) * (1 - Math.exp(-10 * dt));
    camera.position.set(pos.x, pos.y + EYE_HEIGHT - slideCrouch, pos.z);
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
    setTouchPlane(throttle, yaw, planePitch, roll) {
      touchPlane.throttle = THREE.MathUtils.clamp(throttle, -1, 1);
      touchPlane.yaw = THREE.MathUtils.clamp(yaw, -1, 1);
      touchPlane.pitch = THREE.MathUtils.clamp(planePitch, -1, 1);
      touchPlane.roll = THREE.MathUtils.clamp(roll, -1, 1);
    },
    setPlaneTrigger(on) {
      if (vehicle?.plane) vehicle.trigger = Boolean(on);
    },
    dropPlaneBomb() {
      if (vehicle?.plane && vehicle.jet) vehicle.dropBomb?.();
    },
    // Regard du pilote au doigt (mobile) : mêmes offsets de cou que la
    // souris — n'agit qu'en vue embarquée d'un avion (voir addLook).
    planeLook(dx, dy) {
      if (!vehicle?.plane) return;
      addLook(dx, dy);
    },
    togglePlaneCamera() {
      if (!vehicle?.plane) return null;
      lookYaw = 0;
      lookPitch = 0; // la tête se recentre à chaque changement de vue
      if (vehicle.remoteControl) {
        // Avion RC : trois vues en cycle — pilote au sol (réaliste, on suit
        // le modèle du regard), poursuite, puis caméra embarquée.
        const modes = ['sol', 'poursuite', 'fpv'];
        const next = modes[(modes.indexOf(vehicle.camMode ?? 'sol') + 1) % modes.length];
        vehicle.camMode = next;
        vehicle.thirdPerson = next === 'poursuite';
        return next;
      }
      vehicle.thirdPerson = !vehicle.thirdPerson;
      return vehicle.thirdPerson ? 'poursuite' : 'cockpit';
    },
    jump() { wantJump = true; },
    // Entrer/sortir du mode véhicule ({ heading, speed, onHorn, onCrash })
    setVehicle(v) {
      if (vehicle?.plane) vehicle.trigger = false;
      vehicle = v;
      bodyHalf = v ? 1.05 : HALF_W;
      camera.up.set(0, 1, 0);
      clearRcZoom();
      lookYaw = 0;
      lookPitch = 0;
      if (v) {
        skydive = false;
        parachute = false;
        yaw = v.heading; // on regarde d'abord la route
        if (v.plane) {
          v.pitch = 0;
          v.roll = 0;
          v.pitchRate = 0;
          v.rollRate = 0;
          v.yawRate = 0;
          v.throttle = 0;
          v.orientation = new THREE.Quaternion().setFromEuler(
            new THREE.Euler(0, v.heading, 0, 'YXZ')
          );
        }
      } else {
        touchPlane.throttle = touchPlane.yaw = touchPlane.pitch = touchPlane.roll = 0;
      }
    },
    get vehicle() { return vehicle; },
    get flightTelemetry() {
      if (!vehicle?.plane) return null;
      const p = vehicle.remoteControl ? vehicle.position : pos;
      return {
        throttle: vehicle.throttle ?? 0,
        speed: vehicle.speed ?? 0,
        altitude: Math.max(0, p.y - (terrain ? terrain(p.x, p.z) : 0)),
      };
    },
    // Jetpack
    setFlying(on) {
      flying = on;
      if (!on) { flyThrust = false; hover = false; }
      if (on) { skydive = false; parachute = false; } // le jetpack rattrape la chute
    },
    setHover(on) { hover = Boolean(on) && flying; },
    get hovering() { return hover; },
    get flying() { return flying; },
    get flyThrust() { return flyThrust; },
    setTouchThrust(on) { touchThrust = on; },
    // Saut d'un avion en plein vol : on hérite d'une partie de sa vitesse.
    startSkydive(vx = 0, vy = 0, vz = 0) {
      skydive = true;
      parachute = false;
      onGround = false;
      vel.set(vx, vy, vz);
    },
    get skydiving() { return skydive; },
    get parachuteOpen() { return parachute; },
    // Éjection d'urgence : la voile s'ouvre toute seule.
    openParachute() {
      if (!skydive || parachute) return;
      parachute = true;
      onParachuteCb?.();
    },
    setSkydiveHooks({ onParachute, onFallDeath } = {}) {
      onParachuteCb = onParachute ?? null;
      onFallDeathCb = onFallDeath ?? null;
    },
    teleport(x, y, z, ry) {
      pos.set(x, y, z);
      vel.set(0, 0, 0);
      if (ry !== undefined) yaw = ry;
      skydive = false;
      parachute = false;
    },
    netState() {
      const s = {
        p: [Math.round(pos.x * 100) / 100, Math.round(pos.y * 100) / 100, Math.round(pos.z * 100) / 100],
        ry: Math.round(yaw * 1000) / 1000,
        m: this.isMoving() ? 1 : 0,
      };
      // Au volant : les autres joueurs voient la voiture (champs optionnels,
      // ignorés par les anciens clients/serveurs). 2 = avion.
      if (vehicle && !vehicle.remoteControl) {
        s.veh = vehicle.plane ? 2 : vehicle.bike ? 3 : 1; // 3 = Vélo'v
        s.vry = Math.round(vehicle.heading * 1000) / 1000;
        if (vehicle.plane) {
          s.vpx = Math.round((vehicle.pitch ?? 0) * 1000) / 1000;
          s.vrz = Math.round((vehicle.roll ?? 0) * 1000) / 1000;
          s.vjet = vehicle.jet ? 1 : 0;
        }
      }
      // Enceinte portable allumée : les autres l'entendent (champ optionnel)
      if (state.boombox) s.mus = state.boombox;
      return s;
    },
  };
}
