import * as THREE from 'three';
import { makeTextTexture } from './utils.js';

// L'aviation lyonnaise ✈️
// - L'avion-banderole qui tourne au-dessus de la ville, calé sur Date.now()
//   (horloge partagée : même position chez tous les joueurs, zéro trafic
//   réseau — même motif que le silure et le cycle jour/nuit).
// - L'aérodrome de l'Est (le Lyon-Bron du pauvre) : piste, tour, hangar,
//   manche à air, et des avions PILOTABLES à quatre axes : gaz, lacet,
//   tangage et roulis (physique dans player/controls.js, branche `v.plane`).

// Clin d'œil au silure géant qui remonte le Rhône toutes les 4 minutes
const BANNER_TEXT = 'BAIGNADE INTERDITE : LE SILURE A ENCORE FAIM 🐟';

// Petit coucou low-poly en primitives, nez vers -z (comme les voitures).
// Réutilisé par remotes.js pour afficher les pilotes distants (veh: 2).
export function buildPlaneModel(color = 0xd23b3b) {
  const group = new THREE.Group();
  const body = new THREE.MeshLambertMaterial({ color });
  const cream = new THREE.MeshLambertMaterial({ color: 0xf0ead8 });
  const dark = new THREE.MeshLambertMaterial({ color: 0x2a2e36 });

  const add = (geo, mat, x, y, z, rx = 0, ry = 0, rz = 0) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.rotation.set(rx, ry, rz);
    group.add(m);
    return m;
  };

  // Fuselage + capot + nez
  add(new THREE.CylinderGeometry(0.55, 0.4, 4.6, 8), body, 0, 1.15, 0.2, Math.PI / 2);
  add(new THREE.SphereGeometry(0.56, 8, 6), body, 0, 1.15, -2.05);
  // Verrière
  add(new THREE.SphereGeometry(0.42, 8, 6), dark, 0, 1.62, -0.7);
  // Ailes hautes + haubans
  add(new THREE.BoxGeometry(7.4, 0.14, 1.5), cream, 0, 1.85, -0.6);
  add(new THREE.BoxGeometry(0.09, 0.8, 0.09), cream, -1.6, 1.4, -0.6, 0, 0, 0.5);
  add(new THREE.BoxGeometry(0.09, 0.8, 0.09), cream, 1.6, 1.4, -0.6, 0, 0, -0.5);
  // Empennage : dérive + plan fixe
  add(new THREE.BoxGeometry(0.12, 1.05, 0.9), body, 0, 1.85, 2.25);
  add(new THREE.BoxGeometry(2.5, 0.1, 0.8), cream, 0, 1.45, 2.3);
  // Hélice (tourne : voir les updatables) + casserole
  const prop = new THREE.Mesh(new THREE.BoxGeometry(0.16, 2.3, 0.06), dark);
  prop.position.set(0, 1.15, -2.55);
  group.add(prop);
  group.userData.prop = prop;
  add(new THREE.SphereGeometry(0.18, 6, 6), dark, 0, 1.15, -2.6);
  // Deux mitrailleuses de capot, derrière le disque de l'hélice. Les points
  // de sortie servent aussi à faire partir les traceurs exactement des tubes.
  for (const dx of [-0.23, 0.23]) {
    add(new THREE.CylinderGeometry(0.055, 0.065, 0.72, 8), dark,
      dx, 1.42, -2.18, Math.PI / 2);
  }
  group.userData.gunMuzzles = [
    new THREE.Vector3(-0.23, 1.42, -2.58),
    new THREE.Vector3(0.23, 1.42, -2.58),
  ];
  // Train d'atterrissage
  for (const dx of [-0.85, 0.85]) {
    add(new THREE.BoxGeometry(0.08, 0.7, 0.08), dark, dx, 0.5, -0.9, 0, 0, dx > 0 ? -0.35 : 0.35);
    add(new THREE.CylinderGeometry(0.26, 0.26, 0.16, 8), dark, dx * 1.1, 0.26, -0.9, 0, 0, Math.PI / 2);
  }
  add(new THREE.CylinderGeometry(0.14, 0.14, 0.1, 8), dark, 0, 0.16, 2.3, 0, 0, Math.PI / 2);

  return group;
}

// Mirage 2000 low-poly : fuselage long, aile delta, entrées d'air latérales
// et tuyère. Le nez pointe vers -z, comme les autres véhicules du jeu.
export function buildMirageModel(color = 0xb8c5d2) {
  const group = new THREE.Group();
  const body = new THREE.MeshPhongMaterial({ color, shininess: 65, specular: 0xdde8ef });
  const dark = new THREE.MeshLambertMaterial({ color: 0x252d36 });
  const glass = new THREE.MeshPhongMaterial({ color: 0x315a72, shininess: 95, specular: 0xccecff });
  const accent = new THREE.MeshLambertMaterial({ color: 0x6f7f8d });
  const add = (geo, mat, x, y, z, rx = 0, ry = 0, rz = 0) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.rotation.set(rx, ry, rz);
    group.add(m);
    return m;
  };

  add(new THREE.CylinderGeometry(0.55, 0.82, 7.2, 10), body, 0, 0.92, -0.25, Math.PI / 2);
  add(new THREE.ConeGeometry(0.55, 3.1, 10), body, 0, 0.92, -5.25, -Math.PI / 2);
  add(new THREE.CylinderGeometry(0.72, 0.62, 0.65, 12), dark, 0, 0.92, 3.7, Math.PI / 2);
  add(new THREE.SphereGeometry(0.48, 10, 7), glass, 0, 1.48, -1.35, 0.15, 0, 0);

  const wingGeo = new THREE.BufferGeometry();
  wingGeo.setAttribute('position', new THREE.Float32BufferAttribute([
    0, 0, -2.6,  -5.1, 0, 2.25,  0, 0, 1.25,
    0, 0, -2.6,   0, 0, 1.25,   5.1, 0, 2.25,
  ], 3));
  wingGeo.computeVertexNormals();
  add(wingGeo, body, 0, 0.83, 0);
  add(new THREE.BoxGeometry(0.13, 1.9, 2.35), body, 0, 1.75, 2.25, -0.08);
  add(new THREE.BoxGeometry(1.15, 0.42, 1.55), accent, -0.86, 0.82, -0.55, 0.08, 0, 0.04);
  add(new THREE.BoxGeometry(1.15, 0.42, 1.55), accent, 0.86, 0.82, -0.55, 0.08, 0, -0.04);
  add(new THREE.CylinderGeometry(0.05, 0.06, 0.95, 8), dark, -0.44, 0.77, -4.0, Math.PI / 2);
  add(new THREE.CylinderGeometry(0.05, 0.06, 0.95, 8), dark, 0.44, 0.77, -4.0, Math.PI / 2);
  group.userData.gunMuzzles = [
    new THREE.Vector3(-0.44, 0.77, -4.55),
    new THREE.Vector3(0.44, 0.77, -4.55),
  ];
  return group;
}

// Modèle réduit d'environ un mètre d'envergure, lisible malgré sa petite
// taille grâce au contraste rouge/blanc. Ne possède aucun armement.
export function buildRcPlaneModel() {
  const group = new THREE.Group();
  const red = new THREE.MeshLambertMaterial({ color: 0xe63832 });
  const white = new THREE.MeshLambertMaterial({ color: 0xf0eee5 });
  const dark = new THREE.MeshLambertMaterial({ color: 0x20252b });
  const glass = new THREE.MeshPhongMaterial({ color: 0x4b768b, shininess: 80 });
  const add = (geo, mat, x, y, z, rx = 0, ry = 0, rz = 0) => {
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, y, z);
    mesh.rotation.set(rx, ry, rz);
    group.add(mesh);
    return mesh;
  };
  add(new THREE.CylinderGeometry(0.065, 0.09, 0.68, 8), red, 0, 0.13, 0, Math.PI / 2);
  add(new THREE.SphereGeometry(0.07, 8, 6), red, 0, 0.13, -0.36);
  add(new THREE.BoxGeometry(1.0, 0.025, 0.18), white, 0, 0.18, -0.05);
  add(new THREE.BoxGeometry(0.34, 0.018, 0.12), white, 0, 0.17, 0.3);
  add(new THREE.BoxGeometry(0.025, 0.22, 0.16), red, 0, 0.27, 0.29);
  add(new THREE.SphereGeometry(0.055, 8, 5), glass, 0, 0.205, -0.13);
  const prop = add(new THREE.BoxGeometry(0.025, 0.32, 0.012), dark, 0, 0.13, -0.43);
  group.userData.prop = prop;
  for (const dx of [-0.16, 0.16]) {
    add(new THREE.CylinderGeometry(0.025, 0.025, 0.018, 8), dark, dx, 0.035, 0.05, 0, 0, Math.PI / 2);
  }
  return group;
}

// --- L'avion-banderole ----------------------------------------------------
export function buildBannerPlane(ctx) {
  const bound = ctx.worldBound ?? 140;
  const R = Math.max(110, Math.min(bound * 0.45, 430)); // rayon du circuit
  const ALT = bound > 600 ? 150 : 92;

  const plane = buildPlaneModel(0xe8b73a); // jaune poste, ça se voit de loin
  plane.scale.setScalar(1.7);
  ctx.scene.add(plane);

  // Deux faces séparées (et pas DoubleSide) : le texte se lit à l'endroit
  // des deux côtés de la banderole. Format GÉANT, lisible depuis Bellecour.
  const bannerGeo = new THREE.PlaneGeometry(80, 9.2);
  const bannerMat = new THREE.MeshBasicMaterial({ map: makeBannerTexture(BANNER_TEXT) });
  const banner = new THREE.Group();
  for (const s of [1, -1]) {
    const face = new THREE.Mesh(bannerGeo, bannerMat);
    face.position.z = s * 0.05;
    face.rotation.y = s > 0 ? 0 : Math.PI;
    face.userData.noShadow = true;
    banner.add(face);
  }
  ctx.scene.add(banner);
  // Corde entre la queue et la banderole
  const rope = new THREE.Mesh(
    new THREE.BoxGeometry(0.08, 0.08, 12),
    new THREE.MeshBasicMaterial({ color: 0x333333 })
  );
  ctx.scene.add(rope);

  const PERIOD = 150000; // un tour de ville en 2 min 30
  ctx.updatables.push((dt) => {
    const now = Date.now();
    const t = ((now % PERIOD) / PERIOD) * Math.PI * 2;
    const x = Math.cos(t) * R, z = Math.sin(t) * R;
    const ry = Math.PI - t; // cap tangent au cercle (nez vers -z quand ry=0)
    const alt = ALT + Math.sin(now / 4000) * 3; // léger vol ondulé
    plane.position.set(x, alt, z);
    plane.rotation.set(0, ry, 0.16); // inclinaison dans le virage
    plane.userData.prop.rotation.z += dt * 32;

    // La banderole (géante) suit, 50 m derrière, avec un petit flottement
    const fx = -Math.sin(ry), fz = -Math.cos(ry); // direction de vol
    const flap = Math.sin(now / 700) * 0.05;
    banner.position.set(x - fx * 50, alt + 0.4 + Math.sin(now / 900) * 0.5, z - fz * 50);
    banner.rotation.set(0, ry + Math.PI / 2 + flap, 0);
    rope.position.set(x - fx * 7, alt + 0.9, z - fz * 7);
    rope.rotation.set(0, ry, 0);
  });
}

// --- L'aérodrome de l'Est + avions pilotables ------------------------------
export function buildAirport(ctx) {
  const bound = ctx.worldBound ?? 140;
  const big = bound > 600;
  const ax = big ? bound - 280 : 132; // bien à l'EST de la ville
  const az = big ? 280 : 60;
  const L = big ? 230 : 130; // longueur de piste (nord-sud)

  ctx.pois?.push({ id: 'aeroport', nom: "Aérodrome de l'Est", emoji: '✈️', x: ax, z: az });

  // Tarmac (plateforme légèrement surélevée : couvre l'herbe en dessous)
  const tarmac = new THREE.Mesh(
    new THREE.BoxGeometry(64, 0.16, L + 36),
    new THREE.MeshLambertMaterial({ color: 0x565b60 })
  );
  tarmac.position.set(ax - 8, 0.08, az);
  ctx.scene.add(tarmac);

  // Piste + ligne médiane pointillée + seuils
  const runway = new THREE.Mesh(
    new THREE.PlaneGeometry(13, L),
    new THREE.MeshLambertMaterial({ color: 0x33373b })
  );
  runway.rotation.x = -Math.PI / 2;
  runway.position.set(ax, 0.18, az);
  ctx.scene.add(runway);
  const dashMat = new THREE.MeshBasicMaterial({ color: 0xe8e8e0 });
  const dashGeo = new THREE.PlaneGeometry(0.6, 4);
  for (let z = az - L / 2 + 8; z < az + L / 2 - 8; z += 11) {
    const dash = new THREE.Mesh(dashGeo, dashMat);
    dash.rotation.x = -Math.PI / 2;
    dash.position.set(ax, 0.2, z);
    dash.userData.noShadow = true;
    ctx.scene.add(dash);
  }
  const seuilGeo = new THREE.PlaneGeometry(11, 2.2);
  for (const s of [-1, 1]) {
    const seuil = new THREE.Mesh(seuilGeo, dashMat);
    seuil.rotation.x = -Math.PI / 2;
    seuil.position.set(ax, 0.2, az + s * (L / 2 - 3));
    ctx.scene.add(seuil);
  }
  // Balisage : plots émissifs le long des bords (visibles de nuit)
  const lampGeo = new THREE.BoxGeometry(0.35, 0.3, 0.35);
  const lampMat = new THREE.MeshLambertMaterial({ color: 0xffc24d, emissive: 0xcc8a20 });
  for (let z = az - L / 2; z <= az + L / 2; z += 14) {
    for (const s of [-7.2, 7.2]) {
      const lamp = new THREE.Mesh(lampGeo, lampMat);
      lamp.position.set(ax + s, 0.3, z);
      ctx.scene.add(lamp);
    }
  }

  // Tour de contrôle
  const tx = ax - 26, tz = az - L / 2 + 26;
  const fut = new THREE.Mesh(
    new THREE.CylinderGeometry(1.6, 2, 11, 8),
    new THREE.MeshLambertMaterial({ color: 0xd8d3c6 })
  );
  fut.position.set(tx, 5.5, tz);
  ctx.scene.add(fut);
  const vigie = new THREE.Mesh(
    new THREE.CylinderGeometry(3, 2.2, 2.6, 8),
    new THREE.MeshPhongMaterial({ color: 0x7fb8d8, specular: 0xe8f4fa, shininess: 70 })
  );
  vigie.position.set(tx, 12, tz);
  ctx.scene.add(vigie);
  const toit = new THREE.Mesh(
    new THREE.ConeGeometry(3.2, 1.2, 8),
    new THREE.MeshLambertMaterial({ color: 0xb0432f })
  );
  toit.position.set(tx, 13.9, tz);
  ctx.scene.add(toit);
  ctx.colliders.push({ minX: tx - 2, maxX: tx + 2, minY: 0, maxY: 13, minZ: tz - 2, maxZ: tz + 2 });

  // Hangar en tôle + enseigne
  const hx = ax - 28, hz = az + 14;
  const hangar = new THREE.Mesh(
    new THREE.CylinderGeometry(6.5, 6.5, 18, 10, 1, false, 0, Math.PI),
    new THREE.MeshLambertMaterial({ color: 0x8a9099 })
  );
  hangar.rotation.x = Math.PI / 2; // demi-cylindre couché, axe nord-sud
  hangar.position.set(hx, 0.1, hz);
  ctx.scene.add(hangar);
  ctx.colliders.push({ minX: hx - 6.5, maxX: hx + 6.5, minY: 0, maxY: 6.5, minZ: hz - 9, maxZ: hz + 9 });
  const enseigne = new THREE.Mesh(
    new THREE.PlaneGeometry(12, 1.6),
    new THREE.MeshBasicMaterial({ map: makeTextTexture('AÉRO-GONES', { color: '#7fd8ff' }), transparent: true })
  );
  enseigne.position.set(hx + 6.6, 5, hz);
  enseigne.rotation.y = Math.PI / 2;
  enseigne.userData.noShadow = true;
  ctx.scene.add(enseigne);

  // Manche à air
  const mat = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 6, 6),
    new THREE.MeshLambertMaterial({ color: 0xcfd4da }));
  mat.position.set(ax + 12, 3, az - L / 2 + 10);
  ctx.scene.add(mat);
  const manche = new THREE.Mesh(new THREE.ConeGeometry(0.55, 2.2, 8, 1, true),
    new THREE.MeshLambertMaterial({ color: 0xff7a1a, side: THREE.DoubleSide }));
  manche.rotation.z = Math.PI / 2;
  manche.position.set(ax + 13.2, 5.8, az - L / 2 + 10);
  ctx.scene.add(manche);
  ctx.updatables.push(() => {
    manche.rotation.y = Math.sin(Date.now() / 2600) * 0.5; // le vent tourne
  });

  // Les coucous pilotables, garés face à la piste
  const colors = [0xd23b3b, 0x2e6fd8, 0x3da05a];
  colors.forEach((c, i) => {
    makeFlyablePlane(ctx, ax - 17, az - 22 + i * 22, -Math.PI / 2, c);
  });
  // Le Mirage est garé plus loin sur le tarmac pour rester accessible sans
  // bloquer les trois avions à hélice.
  makeFlyablePlane(ctx, ax - 18, az + 70, -Math.PI / 2, 0xb7c4cf, { jet: true });
  // Petit terrain d'aéromodélisme sur le bord du tarmac.
  makeRemoteControlPlane(ctx, ax - 29, az - 45, -Math.PI / 2);
}

function makeRemoteControlPlane(ctx, px, pz, ry) {
  const group = buildRcPlaneModel();
  const ground = ctx.terrainHeight?.(px, pz) ?? 0;
  const launch = new THREE.Vector3(px, ground + 0.04, pz);
  let launchHeading = ry;
  group.position.copy(launch);
  group.rotation.y = ry;
  ctx.scene.add(group);

  // Pupitre de radiocommande placé à côté du modèle.
  const consoleGroup = new THREE.Group();
  const consoleMat = new THREE.MeshLambertMaterial({ color: 0x303944 });
  const screenMat = new THREE.MeshLambertMaterial({ color: 0x4dd9ca, emissive: 0x0b514c });
  const panel = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.18, 0.46), consoleMat);
  panel.position.y = 1.05;
  panel.rotation.x = -0.22;
  consoleGroup.add(panel);
  const screen = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.025, 0.22), screenMat);
  screen.position.set(0, 1.15, -0.03);
  screen.rotation.x = -0.22;
  consoleGroup.add(screen);
  for (const x of [-0.24, 0.24]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.07, 1.0, 0.07), consoleMat);
    leg.position.set(x, 0.5, 0);
    consoleGroup.add(leg);
  }
  const antenna = new THREE.Mesh(
    new THREE.CylinderGeometry(0.012, 0.012, 0.75, 6),
    new THREE.MeshLambertMaterial({ color: 0xd7dde3 })
  );
  antenna.position.set(0.28, 1.48, 0.12);
  antenna.rotation.z = -0.22;
  consoleGroup.add(antenna);
  consoleGroup.position.set(px - 1.6, ground, pz + 0.4);
  ctx.scene.add(consoleGroup);

  const car = {
    heading: ry, speed: 0, pitch: 0, roll: 0, throttle: 0,
    plane: true, rcPlane: true, remoteControl: true,
    position: launch.clone(), velocity: new THREE.Vector3(),
    thirdPerson: false, camBack: 2.8, camUp: 1.15,
    cameraEyeForward: 0.25, cameraEyeUp: 0.13,
    maxSpeed: 14, acceleration: 1.6, ceiling: 180,
    controlSpeed: 5, takeoffSpeed: 4, groundPitchMax: 0.42,
    stallSpeed: 2.5, liftRange: 5.5, velocityResponse: 3.2,
    collisionRadius: 0.36,
  };
  let controlling = false;

  function resetModel() {
    car.speed = 0;
    car.throttle = 0;
    car.velocity.set(0, 0, 0);
    car.position.copy(launch);
    car.heading = launchHeading;
    car.pitch = car.roll = 0;
    car.orientation = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(0, launchHeading, 0, 'YXZ')
    );
    car.thirdPerson = false;
    group.position.copy(launch);
    group.quaternion.copy(car.orientation);
  }

  function refreshGateLabel() {
    gate.label = controlling
      ? 'E — Ranger la radiocommande'
      : ctx.hasInventoryItem?.('rc-plane')
        ? 'E — Piloter l’avion radiocommandé'
        : 'E — Récupérer l’avion radiocommandé';
  }

  function startAt(x = px, z = pz, heading = ry) {
    if (controlling) return;
    launchHeading = heading;
    launch.set(x, (ctx.terrainHeight?.(x, z) ?? 0) + 0.04, z);
    controlling = true;
    resetModel();
    refreshGateLabel();
    ctx.startDrive?.(car, group);
    ctx.notify?.('📡 Avion RC : mêmes manches, 50 km/h max · CAM pour vue poursuite · SAUTER pour revenir au joueur.');
  }

  function stop() {
    if (!controlling) return;
    controlling = false;
    ctx.stopDrive?.(car, group);
    resetModel();
    refreshGateLabel();
  }

  const gate = {
    x: consoleGroup.position.x, z: consoleGroup.position.z, r: 4.5,
    label: '',
    action: () => {
      if (!controlling) {
        if (!ctx.hasInventoryItem?.('rc-plane')) ctx.onRcPlanePickup?.();
        startAt(px, pz, ry);
      } else {
        stop();
      }
    },
  };
  refreshGateLabel();
  // L'inventaire peut déployer le modèle devant le joueur sans qu'il ait à
  // retourner au pupitre de l'aéroport. Il reste toutefois nécessaire de le
  // découvrir une première fois sur place.
  ctx.rcPlaneController = {
    startAt,
    stop,
    get active() { return controlling; },
  };
  ctx.interactables.push(gate);
  ctx.pois?.push({ id: 'avion-rc', nom: 'Avion radiocommandé', emoji: '📡', x: px, z: pz });
  ctx.abortRides?.push(() => {
    if (!controlling) return;
    controlling = false;
    resetModel();
    refreshGateLabel();
  });

  ctx.updatables.push((dt) => {
    group.userData.prop.rotation.z += dt * (controlling ? 12 + car.speed * 4 : 2);
    if (!controlling) return;
    group.position.copy(car.position);
    if (car.orientation) group.quaternion.copy(car.orientation);
  });
}

// Avion pilotable : même recette que les voitures (ctx.startDrive/stopDrive,
// caméra de poursuite), mais la branche `plane` de controls.js donne les gaz
// et l'altitude. Le modèle suit le joueur pendant le vol.
function makeFlyablePlane(ctx, px, pz, ry, color, { jet = false } = {}) {
  const group = jet ? buildMirageModel(color) : buildPlaneModel(color);
  const gy = ctx.terrainHeight?.(px, pz) ?? 0;
  group.position.set(px, gy, pz);
  group.rotation.y = ry;
  ctx.scene.add(group);

  let box = planeBox(px, pz, gy);
  ctx.colliders.push(box);

  const car = {
    heading: ry, speed: 0,
    pitch: 0, roll: 0, throttle: 0,
    plane: true, jet, thirdPerson: true,
    camBack: jet ? 18 : 13, camUp: jet ? 6.5 : 5.2,
    maxSpeed: jet ? 220 : 68,
    acceleration: jet ? 1.05 : 0.72,
    ceiling: jet ? 900 : 520,
  };
  let driving = false;
  let gunCooldown = 0;
  let lastBombAt = -Infinity;
  const bombs = [];
  const gunDirection = new THREE.Vector3();

  function park() {
    driving = false;
    car.trigger = false;
    gate.label = jet ? 'E — Piloter le Mirage 2000' : "E — Piloter l'avion";
    // L'avion se pose là où on l'a laissé (au sol, même si on saute en vol)
    const gx = group.position.x, gz = group.position.z;
    const ground = ctx.terrainHeight?.(gx, gz) ?? 0;
    group.position.y = Math.max(0, ground);
    group.rotation.set(0, car.heading, 0);
    gate.x = gx;
    gate.z = gz;
    box = planeBox(gx, gz, group.position.y);
    ctx.colliders.push(box);
  }

  const gate = {
    x: px, z: pz, r: 4.2,
    label: jet ? 'E — Piloter le Mirage 2000' : "E — Piloter l'avion",
    action: () => {
      if (!driving) {
        driving = true;
        ctx.colliders.remove?.(box);
        gate.label = 'E — Sauter de l’avion';
        car.speed = 0;
        ctx.startDrive?.(car, group);
        ctx.notify?.(jet
          ? '✈️ Mirage 2000 : 790 km/h · double TIR · BOMBE (rayon létal 50 m). Tire le manche vers toi pour monter !'
          : '🛩️ Gauche : gaz/lacet · droite : tangage/roulis · double TIR. Tire le manche vers toi après 60 km/h !');
      } else {
        // On saute : l'avion redescend se poser, le joueur tombe (jetpack ?)
        park();
        ctx.stopDrive?.(car, group);
      }
    },
  };
  ctx.interactables.push(gate);

  ctx.abortRides?.push(() => {
    if (driving) park();
  });

  car.dropBomb = () => {
    if (!driving || !jet) return;
    const now = performance.now();
    if (now - lastBombAt < 3000) {
      ctx.notify?.('Bombe en rechargement…');
      return;
    }
    lastBombAt = now;
    const mesh = new THREE.Mesh(
      new THREE.CylinderGeometry(0.22, 0.3, 1.35, 8),
      new THREE.MeshLambertMaterial({ color: 0x2d3431 })
    );
    mesh.rotation.x = Math.PI / 2;
    mesh.position.copy(group.localToWorld(new THREE.Vector3(0, -0.15, 0.55)));
    const velocity = new THREE.Vector3(0, 0, -1)
      .applyQuaternion(group.quaternion)
      .multiplyScalar(Math.max(35, car.speed * 0.96));
    velocity.y -= 5;
    ctx.scene.add(mesh);
    bombs.push({ mesh, velocity, life: 14 });
  };

  ctx.updatables.push((dt) => {
    for (let i = bombs.length - 1; i >= 0; i--) {
      const bomb = bombs[i];
      bomb.life -= dt;
      bomb.velocity.y -= 18 * dt;
      bomb.mesh.position.addScaledVector(bomb.velocity, dt);
      bomb.mesh.rotateY(dt * 4);
      const ground = ctx.terrainHeight?.(bomb.mesh.position.x, bomb.mesh.position.z) ?? 0;
      if (bomb.mesh.position.y <= ground + 0.22 || bomb.life <= 0) {
        const impact = bomb.mesh.position.clone();
        impact.y = Math.max(ground + 0.25, impact.y);
        ctx.scene.remove(bomb.mesh);
        bombs.splice(i, 1);
        if (bomb.life > 0) ctx.onPlaneBomb?.(impact);
      }
    }
    // Hélice : ralenti au sol, plein régime en vol
    if (group.userData.prop) {
      group.userData.prop.rotation.z += dt * (driving ? 10 + car.speed : 1.2);
    }
    if (!driving) return;
    const q = ctx.playerPos?.();
    if (!q) return;
    group.position.set(q.x, q.y, q.z);
    if (car.orientation) group.quaternion.copy(car.orientation);
    else group.rotation.set(car.pitch ?? 0, car.heading, car.roll ?? 0, 'YXZ');
    gate.x = q.x;
    gate.z = q.z;

    gunCooldown -= dt;
    if (car.trigger && gunCooldown <= 0) {
      gunCooldown = jet ? 0.075 : 0.09;
      group.updateMatrixWorld(true);
      const origins = group.userData.gunMuzzles.map((p) => group.localToWorld(p.clone()));
      gunDirection.set(0, 0, -1).applyQuaternion(group.quaternion).normalize();
      ctx.onPlaneVolley?.(origins, gunDirection, car);
    }
  });
}

function planeBox(x, z, y) {
  return { minX: x - 3.2, maxX: x + 3.2, minY: y, maxY: y + 2.3, minZ: z - 3.2, maxZ: z + 3.2 };
}

// Banderole en canvas : toile claire, liseré et texte rouge, police adaptée
// à la longueur pour que tout tienne.
function makeBannerTexture(text) {
  const c = document.createElement('canvas');
  c.width = 4096;
  c.height = 470;
  const g = c.getContext('2d');
  g.fillStyle = '#f7f2e2';
  g.fillRect(0, 0, c.width, c.height);
  g.strokeStyle = '#c22030';
  g.lineWidth = 26;
  g.strokeRect(14, 14, c.width - 28, c.height - 28);
  g.fillStyle = '#c22030';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  let size = 210;
  do {
    g.font = `900 ${size}px system-ui, sans-serif`;
    size -= 6;
  } while (g.measureText(text).width > c.width - 160 && size > 40);
  g.fillText(text, c.width / 2, c.height / 2 + 10);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}
