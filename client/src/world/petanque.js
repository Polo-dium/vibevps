import * as THREE from 'three';

// Pétanque à Bellecour 🎯 : trois boules, un cochonnet, l'honneur des gones.
// E au terrain lance la partie (le cochonnet part tout seul), puis chaque E
// lance une boule dans la DIRECTION DU REGARD — vise haut pour porter loin,
// bas pour pointer court. Quand la 3e boule s'arrête, la meilleure distance
// part au classement 'petanque' (score = 2000 − centimètres).
const G = 12; // gravité de jeu : un peu douce, les boules portent mieux
const BALL_R = 0.11;
const JACK_R = 0.04;

export function createPetanque(ctx, { camera, notify, onScore, audio }) {
  const B = ctx.bellecourRect ?? { minX: -60, maxX: 60, minZ: -40, maxZ: 56 };
  const tx = B.maxX - 24, tz = B.maxZ - 12; // coin sud-est de la place
  const ty = Math.max(0, ctx.terrainHeight?.(tx, tz) ?? 0);

  // Terrain : bande de sable clair bordée de bois, comme au clos de boules
  const sand = new THREE.Mesh(
    new THREE.PlaneGeometry(15, 5),
    new THREE.MeshLambertMaterial({ color: 0xd8c49a })
  );
  sand.rotation.x = -Math.PI / 2;
  sand.position.set(tx, ty + 0.03, tz);
  ctx.scene.add(sand);
  const wood = new THREE.MeshLambertMaterial({ color: 0x6d4a28 });
  for (const [w, d, ox, oz] of [[15.4, 0.2, 0, -2.6], [15.4, 0.2, 0, 2.6], [0.2, 5.2, -7.7, 0], [0.2, 5.2, 7.7, 0]]) {
    const edge = new THREE.Mesh(new THREE.BoxGeometry(w, 0.22, d), wood);
    edge.position.set(tx + ox, ty + 0.11, tz + oz);
    ctx.scene.add(edge);
  }
  ctx.pois?.push({ id: 'petanque', nom: 'Clos de pétanque', emoji: '⚫', x: tx, z: tz });

  const steel = new THREE.MeshPhongMaterial({ color: 0x9aa2ab, shininess: 80, specular: 0xdfe6ec });
  const ballGeo = new THREE.SphereGeometry(BALL_R, 10, 8);
  const jack = new THREE.Mesh(
    new THREE.SphereGeometry(JACK_R, 8, 6),
    new THREE.MeshLambertMaterial({ color: 0xd9822b })
  );
  jack.visible = false;
  ctx.scene.add(jack);

  const balls = [];
  for (let i = 0; i < 3; i++) {
    const m = new THREE.Mesh(ballGeo, steel);
    m.visible = false;
    ctx.scene.add(m);
    balls.push({ mesh: m, vel: new THREE.Vector3(), live: false, resting: false });
  }
  const jackBody = { mesh: jack, vel: new THREE.Vector3(), live: false, resting: false };

  let playing = false;
  let thrown = 0;
  let doneAt = 0;

  function refreshLabel() {
    gate.label = playing
      ? `E — Lancer la boule ${Math.min(3, thrown + 1)}/3 (vise avec le regard)`
      : 'E — Partie de pétanque';
  }

  function throwBody(body, speed, lift) {
    const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
    body.mesh.position.copy(camera.position).addScaledVector(dir, 0.6);
    body.vel.copy(dir).multiplyScalar(speed);
    body.vel.y += lift;
    body.live = true;
    body.resting = false;
    body.mesh.visible = true;
  }

  function start() {
    playing = true;
    thrown = 0;
    balls.forEach((b) => { b.mesh.visible = false; b.live = false; b.resting = false; });
    throwBody(jackBody, 6.5, 2.4);
    notify('🎯 Le cochonnet est parti ! E pour lancer chaque boule — la plus proche gagne.');
    refreshLabel();
  }

  const gate = {
    x: tx - 8.6, z: tz, r: 3,
    label: '',
    action: () => {
      if (!playing) return start();
      if (thrown >= 3) return;
      throwBody(balls[thrown], 7.5, 2.1);
      thrown++;
      audio?.hitmarker?.();
      refreshLabel();
    },
  };
  refreshLabel();
  ctx.interactables.push(gate);

  function settle(body, dt) {
    if (!body.live || body.resting) return;
    body.vel.y -= G * dt;
    body.mesh.position.addScaledVector(body.vel, dt);
    const r = body === jackBody ? JACK_R : BALL_R;
    const ground = Math.max(0, ctx.terrainHeight?.(body.mesh.position.x, body.mesh.position.z) ?? 0) + r + 0.02;
    if (body.mesh.position.y <= ground) {
      body.mesh.position.y = ground;
      if (Math.abs(body.vel.y) > 0.8) {
        body.vel.y *= -0.32; // rebond mat sur le sable
        body.vel.x *= 0.72;
        body.vel.z *= 0.72;
      } else {
        body.vel.y = 0;
        // roulement freiné par le sable
        const k = Math.exp(-1.7 * dt);
        body.vel.x *= k;
        body.vel.z *= k;
        if (body.vel.lengthSq() < 0.02) {
          body.vel.set(0, 0, 0);
          body.resting = true;
        }
      }
    }
  }

  ctx.updatables.push((dt) => {
    if (!playing) return;
    settle(jackBody, dt);
    for (const b of balls) settle(b, dt);

    // Partie finie : les 3 boules lancées et tout le monde à l'arrêt
    if (thrown >= 3 && jackBody.resting && balls.every((b) => b.resting)) {
      if (!doneAt) doneAt = performance.now();
      if (performance.now() - doneAt > 800) {
        playing = false;
        doneAt = 0;
        const cm = Math.round(Math.min(...balls.map((b) =>
          b.mesh.position.distanceTo(jack.position))) * 100);
        const bravo = cm < 30 ? ' — un vrai carreau, gone ! 👏' : cm < 90 ? ' — joli point.' : ' — faut biberonner moins, gone.';
        notify(`🎯 Meilleure boule à ${cm} cm du cochonnet${bravo}`);
        onScore?.(cm);
        refreshLabel();
      }
      return;
    }
    // Le joueur abandonne le clos : on remballe sans bruit
    const p = ctx.playerPos();
    if (Math.hypot(p.x - tx, p.z - tz) > 55) {
      playing = false;
      doneAt = 0;
      jack.visible = false;
      balls.forEach((b) => { b.mesh.visible = false; });
      refreshLabel();
    }
  });
}
