import * as THREE from 'three';

// Le Grand Prix du CIEL ✈️ : course chrono à anneaux GÉANTS au-dessus de
// Lyon, réservée aux pilotes. Pas de touche à presser : on lance le chrono
// en traversant le portique doré qui flotte au-dessus de la piste de
// l'aérodrome — même recette que le Grand Prix au sol (anneaux additifs,
// chrono local, score arbitré serveur), mais en trois dimensions.
const RING_R = 15;
const TIMEOUT_MS = 6 * 60 * 1000;

function buildCourse(ctx) {
  const ap = ctx.airport ?? { x: 132, z: 60 };
  const poi = (id) => ctx.pois?.find((p) => p.id === id);
  const g = (x, z) => Math.max(0, ctx.terrainHeight?.(x, z) ?? 0);
  const pts = [];
  const add = (x, z, alt) => pts.push([x, g(x, z) + alt, z]);

  add(ap.x, ap.z - 110, 55); // montée dans l'axe de la piste
  const crayon = poi('crayon');
  if (crayon) add(crayon.x, crayon.z, 125); // au ras de la pointe du Crayon
  const roue = poi('roue');
  if (roue) add(roue.x, roue.z, 55); // rase-mottes sur la Grande Roue
  const basilique = poi('basilique');
  if (basilique) add(basilique.x, basilique.z, 85); // par-dessus Fourvière
  // Grand virage sud au-dessus du fleuve, si les fleuves existent
  const bands = ctx.waterBands ?? [];
  if (bands.length) {
    const b = bands[bands.length - 1];
    const z = Math.min(380, b.zMax ?? 300);
    add(b.cx ? b.cx(z) : 0, z, 70);
  }
  add(ap.x - 80, ap.z + 170, 80); // retour plein est
  add(ap.x, ap.z + 70, 32); // longue finale dans l'axe
  add(ap.x, ap.z - 30, 22); // ligne d'arrivée au-dessus de la piste
  return pts;
}

export function createAirRace(ctx, { setBanner, notify, onFinish, audio, inPlane }) {
  const ap = ctx.airport ?? { x: 132, z: 60 };
  const course = buildCourse(ctx);

  const ringGeo = new THREE.TorusGeometry(RING_R, 1.1, 8, 28);
  const matActive = new THREE.MeshBasicMaterial({
    color: 0xff9330, transparent: true, opacity: 0.95,
    blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
  });
  const matNext = new THREE.MeshBasicMaterial({
    color: 0x53c8ff, transparent: true, opacity: 0.3,
    blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
  });
  const rings = course.map(([x, y, z], i) => {
    const m = new THREE.Mesh(ringGeo, i ? matNext : matActive);
    m.position.set(x, y, z);
    const [px, , pz] = course[Math.max(0, i - 1)];
    m.rotation.y = Math.atan2(x - px, z - pz);
    m.visible = false;
    m.userData.noShadow = true;
    ctx.scene.add(m);
    return m;
  });

  // Portique de départ doré, en travers de l'axe de piste : le chrono part
  // quand un AVION le traverse (aucune touche, on est aux commandes).
  const gY = Math.max(0, ctx.terrainHeight?.(ap.x, ap.z + 40) ?? 0) + 34;
  const gate = new THREE.Mesh(
    new THREE.TorusGeometry(16, 1.3, 8, 28),
    new THREE.MeshBasicMaterial({
      color: 0xffd23f, transparent: true, opacity: 0.75,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    })
  );
  gate.position.set(ap.x, gY, ap.z + 40);
  gate.userData.noShadow = true;
  ctx.scene.add(gate);
  ctx.pois?.push({ id: 'grand-prix-ciel', nom: 'Grand Prix du ciel', emoji: '✈️', x: ap.x, z: ap.z + 40 });

  let racing = false;
  let cp = 0;
  let t0 = 0;
  let best = null;
  let cooldown = 0; // évite de relancer dans la frame qui suit l'arrivée

  function start() {
    racing = true;
    cp = 0;
    t0 = performance.now();
    showRings();
    notify('✈️ GRAND PRIX DU CIEL ! Enfile les anneaux géants — sauter de l’avion abandonne la course.');
    audio?.reward?.();
  }

  function abort(msg) {
    racing = false;
    rings.forEach((r) => { r.visible = false; });
    setBanner(null);
    if (msg) notify(msg);
  }

  function showRings() {
    rings.forEach((r, i) => {
      r.visible = i === cp || i === cp + 1;
      r.material = i === cp ? matActive : matNext;
    });
  }

  const fmt = (ms) => `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, '0')}.${String(Math.floor((ms % 1000) / 100))}`;

  let t = 0;
  ctx.updatables.push((dt) => {
    t += dt;
    gate.rotation.z += dt * 0.35;
    cooldown = Math.max(0, cooldown - dt);
    const p = ctx.playerPos();

    if (!racing) {
      // Départ au vol : traverser le portique doré aux commandes d'un avion
      if (cooldown <= 0 && inPlane?.()) {
        const d = Math.hypot(gate.position.x - p.x, gate.position.y - p.y, gate.position.z - p.z);
        if (d < 16 + 6) start();
      }
      return;
    }
    if (!inPlane?.()) return abort('✈️ Tu as quitté ton avion — course du ciel abandonnée.');
    const elapsed = performance.now() - t0;
    if (elapsed > TIMEOUT_MS) return abort('✈️ Trop long, gone — course du ciel abandonnée.');

    const ring = rings[cp];
    ring.rotation.z += dt * 0.9;
    const d = Math.hypot(ring.position.x - p.x, ring.position.y - p.y, ring.position.z - p.z);
    setBanner(`✈️ ${fmt(elapsed)} — anneau ${cp + 1}/${rings.length}<br><span style="font-size:13px;">distance : ${Math.round(d)} m · alt ${Math.round(ring.position.y)} m</span>`);
    if (d < RING_R + 6) {
      cp++;
      audio?.hitmarker?.();
      if (cp >= rings.length) {
        racing = false;
        cooldown = 5;
        rings.forEach((r) => { r.visible = false; });
        setBanner(null);
        const ms = Math.round(elapsed);
        const record = best == null || ms < best;
        if (record) best = ms;
        onFinish({ ms, timeText: fmt(ms), record });
      } else {
        showRings();
      }
    }
  });
}
