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
  // Aile parasol + haubans — montée haut exprès : depuis le siège (œil à
  // 1,74, bord d'attaque à ~31° au-dessus de l'axe), elle n'occupe que le
  // tout haut de l'écran, au niveau du bouton caméra, sans gêner l'horizon.
  add(new THREE.BoxGeometry(7.4, 0.14, 1.5), cream, 0, 2.26, -0.5);
  // Intrados teinté + bord d'attaque sombre : vus du siège à contre-jour,
  // ils empêchent l'aile de se fondre dans le bleu du ciel.
  const underside = add(
    new THREE.PlaneGeometry(7.4, 1.5),
    new THREE.MeshLambertMaterial({ color: 0xcfc8b4 }),
    0, 2.185, -0.5, Math.PI / 2
  );
  underside.userData.noShadow = true;
  add(new THREE.BoxGeometry(7.4, 0.06, 0.08), dark, 0, 2.21, -1.24);
  add(new THREE.BoxGeometry(0.09, 1.3, 0.09), cream, -1.6, 1.62, -0.5, 0, 0, 0.5);
  add(new THREE.BoxGeometry(0.09, 1.3, 0.09), cream, 1.6, 1.62, -0.5, 0, 0, -0.5);
  // Empennage : dérive + plan fixe
  add(new THREE.BoxGeometry(0.12, 1.05, 0.9), body, 0, 1.85, 2.25);
  add(new THREE.BoxGeometry(2.5, 0.1, 0.8), cream, 0, 1.45, 2.3);
  // Poste de pilotage, visible en vue embarquée (l'œil est DANS la
  // verrière : ses faces arrière sont éliminées, la vue reste dégagée) :
  // tableau de bord penché vers le pilote, trois cadrans et le manche.
  // (Le tableau dépasse du DOS du fuselage — dessous il serait invisible,
  // caché par la peau de la carlingue dont le haut culmine vers y=1,6.)
  const dash = add(new THREE.BoxGeometry(0.5, 0.14, 0.07), dark, 0, 1.58, -0.98, -0.3);
  const gaugeMat = new THREE.MeshLambertMaterial({ color: 0xd8e4d8, emissive: 0x2c4030 });
  for (const dx of [-0.14, 0, 0.14]) {
    const gauge = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.02, 10), gaugeMat);
    gauge.position.set(dx, 1.62, -0.935);
    gauge.rotation.x = Math.PI / 2 - 0.3;
    group.add(gauge);
  }
  group.userData.dash = dash;
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
  const body = new THREE.MeshPhongMaterial({
    color, shininess: 65, specular: 0xdde8ef, side: THREE.DoubleSide,
  });
  const dark = new THREE.MeshLambertMaterial({ color: 0x252d36 });
  const glass = new THREE.MeshPhongMaterial({ color: 0x315a72, shininess: 95, specular: 0xccecff });
  const accent = new THREE.MeshLambertMaterial({ color: 0x6f7f8d });
  const exhaust = new THREE.MeshBasicMaterial({
    color: 0xff7b2f, transparent: true, opacity: 0.38,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const flameOuterMat = new THREE.MeshBasicMaterial({
    color: 0xff6b20, transparent: true, opacity: 0,
    blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
  });
  const flameInnerMat = new THREE.MeshBasicMaterial({
    color: 0xb9eaff, transparent: true, opacity: 0,
    blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
  });
  const add = (geo, mat, x, y, z, rx = 0, ry = 0, rz = 0) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.rotation.set(rx, ry, rz);
    group.add(m);
    return m;
  };

  add(new THREE.CylinderGeometry(0.55, 0.82, 7.2, 12), body, 0, 0.92, -0.25, Math.PI / 2);
  // La base du nez reprend exactement le rayon avant (0,82) et rejoint le
  // fuselage à z=-3,85 : plus de disque plat ni de marche entre les deux.
  add(new THREE.ConeGeometry(0.82, 3.3, 12), body, 0, 0.92, -5.5, -Math.PI / 2);
  add(new THREE.CylinderGeometry(0.72, 0.62, 0.65, 12), dark, 0, 0.92, 3.7, Math.PI / 2);
  // Bulle du cockpit posée SUR le dos du fuselage (sommet ~1,65) : la tête
  // du pilote loge dans le verre, à l'extérieur du cylindre.
  const canopy = add(new THREE.SphereGeometry(0.5, 12, 8), glass, 0, 1.62, -1.45, 0.12, 0, 0);
  canopy.scale.set(0.78, 0.72, 1.55);
  // Poste de pilotage (vue embarquée : l'œil est dans la bulle, dont les
  // faces arrière sont éliminées) : casquette d'instruments au ras du
  // fuselage (le corps est DoubleSide : plus bas, le tableau serait noyé
  // dans la peau de la carlingue) + petite glace de HUD.
  add(new THREE.BoxGeometry(0.44, 0.12, 0.07), dark, 0, 1.68, -1.98, -0.35);
  const hudMat = new THREE.MeshLambertMaterial({ color: 0x9fe8c0, emissive: 0x1f5c38 });
  add(new THREE.PlaneGeometry(0.12, 0.09), hudMat, 0, 1.82, -1.92, -0.25);

  const wingGeo = new THREE.BufferGeometry();
  wingGeo.setAttribute('position', new THREE.Float32BufferAttribute([
    0, 0, -2.6,  -5.1, 0, 2.25,  0, 0, 1.25,
    0, 0, -2.6,   0, 0, 1.25,   5.1, 0, 2.25,
  ], 3));
  wingGeo.computeVertexNormals();
  add(wingGeo, body, 0, 0.83, 0);
  // Dérive en prisme triangulaire rectangle : base horizontale, bord de
  // fuite vertical et bord d'attaque incliné, au lieu de l'ancien pavé qui
  // se lisait comme un trapèze depuis l'arrière.
  const tailGeo = new THREE.BufferGeometry();
  const tx = 0.085, tailH = 2.15, tailL = 2.4;
  tailGeo.setAttribute('position', new THREE.Float32BufferAttribute([
    -tx, 0, -tailL / 2,  -tx, 0, tailL / 2,  -tx, tailH, tailL / 2,
     tx, 0, -tailL / 2,   tx, 0, tailL / 2,   tx, tailH, tailL / 2,
  ], 3));
  tailGeo.setIndex([
    0, 2, 1,  3, 4, 5,
    0, 1, 4,  0, 4, 3,
    1, 2, 5,  1, 5, 4,
    2, 0, 3,  2, 3, 5,
  ]);
  tailGeo.computeVertexNormals();
  add(tailGeo, body, 0, 0.86, 2.2);
  add(new THREE.BoxGeometry(1.15, 0.42, 1.55), accent, -0.86, 0.82, -0.55, 0.08, 0, 0.04);
  add(new THREE.BoxGeometry(1.15, 0.42, 1.55), accent, 0.86, 0.82, -0.55, 0.08, 0, -0.04);
  // Bouches sombres des entrées d'air, lisibles de face.
  add(new THREE.BoxGeometry(0.72, 0.25, 0.035), dark, -0.86, 0.83, -1.34, 0, 0.05, 0.03);
  add(new THREE.BoxGeometry(0.72, 0.25, 0.035), dark, 0.86, 0.83, -1.34, 0, -0.05, -0.03);
  // Anneau de tuyère et cœur chaud visible depuis l'arrière.
  add(new THREE.TorusGeometry(0.43, 0.075, 8, 18), dark, 0, 0.92, 4.03);
  add(new THREE.CircleGeometry(0.35, 18), exhaust, 0, 0.92, 4.035);
  // Deux cônes additifs forment la postcombustion. Leur base est recalée sur
  // la tuyère pendant l'animation pour que la flamme s'allonge sans flotter.
  const flameOuter = add(
    new THREE.ConeGeometry(0.43, 2.2, 12, 1, true), flameOuterMat,
    0, 0.92, 5.135, Math.PI / 2
  );
  const flameInner = add(
    new THREE.ConeGeometry(0.25, 1.55, 10, 1, true), flameInnerMat,
    0, 0.92, 4.81, Math.PI / 2
  );
  flameOuter.visible = false;
  flameInner.visible = false;
  flameOuter.userData.noShadow = true;
  flameInner.userData.noShadow = true;
  group.userData.jetFlames = {
    outer: flameOuter, inner: flameInner, power: 0, time: Math.random() * 10,
  };
  // Feux de navigation aux extrémités de l'aile delta.
  add(new THREE.SphereGeometry(0.075, 7, 5), new THREE.MeshBasicMaterial({ color: 0x46ff74 }), -5.02, 0.86, 2.19);
  add(new THREE.SphereGeometry(0.075, 7, 5), new THREE.MeshBasicMaterial({ color: 0xff3b36 }), 5.02, 0.86, 2.19);
  add(new THREE.CylinderGeometry(0.05, 0.06, 0.95, 8), dark, -0.44, 0.77, -4.0, Math.PI / 2);
  add(new THREE.CylinderGeometry(0.05, 0.06, 0.95, 8), dark, 0.44, 0.77, -4.0, Math.PI / 2);
  group.userData.gunMuzzles = [
    new THREE.Vector3(-0.44, 0.77, -4.55),
    new THREE.Vector3(0.44, 0.77, -4.55),
  ];
  return group;
}

export function updateMirageFlame(group, targetPower, dt) {
  const flame = group?.userData?.jetFlames;
  if (!flame) return;
  const target = THREE.MathUtils.clamp(Number(targetPower) || 0, 0, 1);
  flame.power += (target - flame.power) * (1 - Math.exp(-7 * Math.max(0, dt)));
  flame.time += Math.max(0, dt);
  const power = flame.power;
  const visible = power > 0.012;
  flame.outer.visible = visible;
  flame.inner.visible = visible;
  if (!visible) return;

  const flicker = 0.94 + Math.sin(flame.time * 31) * 0.035 + Math.sin(flame.time * 53) * 0.025;
  const outerLength = (0.1 + power * 0.9) * flicker;
  const innerLength = (0.13 + power * 0.87) * (1.02 - Math.sin(flame.time * 43) * 0.035);
  const outerRadius = 0.67 + power * 0.35;
  const innerRadius = 0.62 + power * 0.28;
  flame.outer.scale.set(outerRadius, outerLength, outerRadius);
  flame.inner.scale.set(innerRadius, innerLength, innerRadius);
  flame.outer.position.z = 4.035 + 1.1 * outerLength;
  flame.inner.position.z = 4.04 + 0.775 * innerLength;
  flame.outer.material.opacity = 0.12 + power * 0.5;
  flame.inner.material.opacity = 0.18 + power * 0.58;
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
  ctx.airport = { x: ax, z: az }; // consommé par le Grand Prix du ciel

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
  group.scale.setScalar(1.5); // envergure ~1,5 m : le modèle se voit de loin
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
    thirdPerson: false, camMode: 'sol', camBack: 3.8, camUp: 1.5,
    // Vue embarquée : caméra reculée derrière la dérive, tout le modèle
    // (carlingue + ailes) reste visible devant, solidaire de la cellule.
    // (Cotes ×1,5 : le modèle fait maintenant 1,5 m d'envergure.)
    cockpit: { x: 0, y: 0.78, z: 1.85 },
    maxSpeed: 14, acceleration: 1.6, ceiling: 180,
    controlSpeed: 5, takeoffSpeed: 4, groundPitchMax: 0.42,
    stallSpeed: 2.5, liftRange: 5.5, velocityResponse: 3.2,
    collisionRadius: 0.55,
  };
  let controlling = false;

  // École de pilotage, étape 1 : le premier vol valide chaque commande puis
  // le décollage. Le brevet RC ouvre ensuite les avions grandeur nature.
  const training = { gaz: false, lacet: false, tangage: false, roulis: false, decollage: false };
  const trainingDone = () => Object.values(training).every(Boolean);

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
    car.camMode = 'sol'; // on redécolle toujours avec la vue du pilote au sol
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
    ctx.notify?.(ctx.hasInventoryItem?.('brevet-rc')
      ? '📡 Avion RC : mêmes manches, 50 km/h max · H/CAM change de vue (pilote au sol, poursuite, embarquée) · SAUTER pour revenir au joueur.'
      : '🎓 Leçon de pilotage — GAZ : Z/S (manche gauche ↕) · LACET : Q/D (manche gauche ↔) · TANGAGE/ROULIS : flèches (manche droit). Décolle et essaie chaque commande pour obtenir ton brevet !');
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

    // Validation de la leçon : les taux ne montent que sous une vraie
    // commande, l'élève doit donc réellement toucher à tout pour valider.
    if (!ctx.hasInventoryItem?.('brevet-rc') && !trainingDone()) {
      const check = (key, ok, label) => {
        if (training[key] || !ok) return;
        training[key] = true;
        if (!trainingDone()) ctx.notify?.(`✅ ${label}`);
      };
      check('gaz', car.throttle > 0.3, 'Gaz maîtrisés');
      check('lacet', Math.abs(car.yawRate ?? 0) > 0.22, 'Lacet testé');
      check('tangage', Math.abs(car.pitchRate ?? 0) > 0.3, 'Tangage testé');
      check('roulis', Math.abs(car.rollRate ?? 0) > 0.5, 'Roulis testé');
      check('decollage', car.position.y > launch.y + 6, 'Décollage réussi');
      if (trainingDone()) ctx.onBrevet?.('rc');
    }
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
    // Siège du pilote, dans la verrière : capot/nez visibles devant, ailes
    // sur les côtés, tableau de bord au premier plan (vue embarquée).
    // L'œil reste DANS la verrière (faces arrière éliminées → vue dégagée)
    // et sous l'aile haute du coucou pour la garder visible en plafond.
    // L'œil doit rester AU-DESSUS du dos du fuselage (~1,65) : plus bas, on
    // se retrouve dans la peau de la carlingue (DoubleSide sur le Mirage).
    // Sur le Mirage, la tête loge dans la bulle posée sur le fuselage.
    cockpit: jet ? { x: 0, y: 1.78, z: -1.35 } : { x: 0, y: 1.74, z: -0.5 },
    maxSpeed: jet ? 220 : 68,
    acceleration: jet ? 1.05 : 0.72,
    ceiling: jet ? 900 : 520,
  };
  let driving = false;
  let gunCooldown = 0;
  let lastBombAt = -Infinity;
  const bombs = [];
  const gunDirection = new THREE.Vector3();
  // Avion abandonné en plein vol : il continue seul sur sa trajectoire
  // (balistique) puis explose à l'impact, comme la bombe du Mirage.
  let ditch = null;

  function park() {
    driving = false;
    car.trigger = false;
    ctx.ejectPlane = null;
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
        // École de pilotage : RC → avion à hélice → Mirage. Les brevets sont
        // des objets d'inventaire persistants (suivent le compte).
        if (!jet && !ctx.hasInventoryItem?.('brevet-rc')) {
          ctx.notify?.('🎓 Apprends d’abord à voler : décolle l’avion radiocommandé du terrain d’aéromodélisme (bord du tarmac) et essaie toutes les commandes.');
          return;
        }
        if (jet && !ctx.hasInventoryItem?.('brevet-avion')) {
          ctx.notify?.('🎓 Le Mirage 2000 ne se prête pas aux débutants : décolle d’abord un avion à hélice pour obtenir ton brevet de pilote.');
          return;
        }
        driving = true;
        ctx.colliders.remove?.(box);
        // Éjection d'urgence (avion criblé en dogfight) : main.js appelle
        // ce hook, qui rejoue exactement le saut en plein vol.
        ctx.ejectPlane = () => { if (driving) gate.action(); };
        gate.label = 'E — Sauter de l’avion';
        car.speed = 0;
        ctx.startDrive?.(car, group);
        ctx.notify?.(jet
          ? '✈️ Mirage 2000 : 790 km/h · double TIR · BOMBE (rayon létal 50 m) · H/CAM : vue cockpit ou poursuite. Tire le manche vers toi pour monter !'
          : '🛩️ Gauche : gaz/lacet · droite : tangage/roulis · double TIR · H/CAM : vue cockpit ou poursuite. Tire le manche vers toi après 60 km/h !');
      } else {
        const groundHere = ctx.terrainHeight?.(group.position.x, group.position.z) ?? 0;
        if (group.position.y > groundHere + 5) {
          // Saut en plein vol : le pilote part en chute libre (voir
          // controls.startSkydive côté main.js) et l'avion, livré à
          // lui-même, poursuit sa trajectoire jusqu'au crash.
          ctx.stopDrive?.(car, group); // téléporte le joueur À L'ALTITUDE actuelle
          driving = false;
          car.trigger = false;
          ctx.ejectPlane = null;
          ditch = {
            vel: new THREE.Vector3(0, 0, -1)
              .applyQuaternion(group.quaternion)
              .multiplyScalar(Math.max(8, car.speed)),
          };
          gate.r = 0; // borne injoignable le temps du crash
        } else {
          // Au sol : l'avion se gare simplement là où on le laisse.
          park();
          ctx.stopDrive?.(car, group);
        }
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
    if (jet) {
      // Une petite veilleuse au ralenti, puis une postcombustion dont longueur,
      // largeur et luminosité suivent directement la manette des gaz.
      updateMirageFlame(group, driving ? 0.06 + car.throttle * 0.94 : 0, dt);
    }
    if (ditch) {
      // Balistique simple : l'avion garde son élan, pique sous la gravité,
      // et le nez suit doucement la trajectoire de chute.
      ditch.vel.y -= 9.81 * dt;
      group.position.addScaledVector(ditch.vel, dt);
      group.rotateX(-Math.min(0.25 * dt, 0.02)); // rotation.x négative = nez qui pique
      const groundHere = ctx.terrainHeight?.(group.position.x, group.position.z) ?? 0;
      if (group.position.y <= groundHere + 0.4) {
        // Impact : même champignon (et même rayon létal serveur) que la
        // bombe du Mirage, puis l'avion réapparaît à son parking d'origine.
        ctx.onPlaneBomb?.(new THREE.Vector3(
          group.position.x, groundHere + 0.3, group.position.z
        ));
        ditch = null;
        car.heading = ry;
        group.position.set(px, gy, pz);
        group.rotation.set(0, ry, 0);
        gate.x = px;
        gate.z = pz;
        gate.r = 4.2;
        gate.label = jet ? 'E — Piloter le Mirage 2000' : "E — Piloter l'avion";
        box = planeBox(px, pz, gy);
        ctx.colliders.push(box);
      }
      return;
    }
    if (!driving) return;
    const q = ctx.playerPos?.();
    if (!q) return;
    // Brevet de pilote : délivré au premier vrai décollage en avion à hélice
    // (12 m sol), il ouvre l'accès au Mirage.
    if (!jet && !ctx.hasInventoryItem?.('brevet-avion') &&
        q.y > (ctx.terrainHeight?.(q.x, q.z) ?? 0) + 12) {
      ctx.onBrevet?.('avion');
    }
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
