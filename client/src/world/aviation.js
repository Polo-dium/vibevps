import * as THREE from 'three';
import { makeTextTexture } from './utils.js';

// L'aviation lyonnaise ✈️
// - L'avion-banderole qui tourne au-dessus de la ville, calé sur Date.now()
//   (horloge partagée : même position chez tous les joueurs, zéro trafic
//   réseau — même motif que le silure et le cycle jour/nuit).
// - L'aérodrome de l'Est (le Lyon-Bron du pauvre) : piste, tour, hangar,
//   manche à air, et des avions PILOTABLES (gaz Z, virage Q/D, ESPACE pour
//   monter — physique dans player/controls.js, branche `v.plane`).

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
  // Train d'atterrissage
  for (const dx of [-0.85, 0.85]) {
    add(new THREE.BoxGeometry(0.08, 0.7, 0.08), dark, dx, 0.5, -0.9, 0, 0, dx > 0 ? -0.35 : 0.35);
    add(new THREE.CylinderGeometry(0.26, 0.26, 0.16, 8), dark, dx * 1.1, 0.26, -0.9, 0, 0, Math.PI / 2);
  }
  add(new THREE.CylinderGeometry(0.14, 0.14, 0.1, 8), dark, 0, 0.16, 2.3, 0, 0, Math.PI / 2);

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
}

// Avion pilotable : même recette que les voitures (ctx.startDrive/stopDrive,
// caméra de poursuite), mais la branche `plane` de controls.js donne les gaz
// et l'altitude. Le modèle suit le joueur pendant le vol.
function makeFlyablePlane(ctx, px, pz, ry, color) {
  const group = buildPlaneModel(color);
  const gy = ctx.terrainHeight?.(px, pz) ?? 0;
  group.position.set(px, gy, pz);
  group.rotation.y = ry;
  ctx.scene.add(group);

  let box = planeBox(px, pz, gy);
  ctx.colliders.push(box);

  const car = {
    heading: ry, speed: 0,
    plane: true, thirdPerson: true, camBack: 13, camUp: 5.2,
  };
  let driving = false;
  let prevY = gy;

  function park() {
    driving = false;
    gate.label = "E — Piloter l'avion";
    // L'avion se pose là où on l'a laissé (au sol, même si on saute en vol)
    const gx = group.position.x, gz = group.position.z;
    const ground = ctx.terrainHeight?.(gx, gz) ?? 0;
    group.position.y = Math.max(0, ground);
    group.rotation.x = 0;
    group.rotation.z = 0;
    gate.x = gx;
    gate.z = gz;
    box = planeBox(gx, gz, group.position.y);
    ctx.colliders.push(box);
  }

  const gate = {
    x: px, z: pz, r: 4.2,
    label: "E — Piloter l'avion",
    action: () => {
      if (!driving) {
        driving = true;
        ctx.colliders.remove?.(box);
        gate.label = 'E — Sauter de l’avion';
        car.speed = 0;
        ctx.startDrive?.(car, group);
        ctx.notify?.('🛩️ Plein gaz avec Z, vire avec Q/D — au-dessus de 60 km/h, ESPACE pour prendre les airs !');
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

  ctx.updatables.push((dt) => {
    // Hélice : ralenti au sol, plein régime en vol
    group.userData.prop.rotation.z += dt * (driving ? 10 + car.speed : 1.2);
    if (!driving) return;
    const q = ctx.playerPos?.();
    if (!q) return;
    group.position.set(q.x, q.y, q.z);
    group.rotation.y = car.heading;
    // Assiette : cabré quand ça monte, piqué quand ça descend (visuel)
    const vy = dt > 0 ? (q.y - prevY) / dt : 0;
    prevY = q.y;
    const pitch = THREE.MathUtils.clamp(vy / 16, -1, 1) * 0.38;
    group.rotation.x += (-pitch - group.rotation.x) * Math.min(1, 4 * dt);
    gate.x = q.x;
    gate.z = q.z;
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
