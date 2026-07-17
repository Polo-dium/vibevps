import * as THREE from 'three';
import { audio } from '../audio.js';
import { createMusicSource } from '../music.js';
import { makeRand, riverCx, riverHalf } from './layout.js';

// Circulation des quais : avenues le long des berges — qui SUIVENT le tracé
// courbe des fleuves —, trafic de voitures low-poly (tout en InstancedMesh :
// 3 draw calls pour l'ensemble), voitures garées déterministes, et des
// décapotables qu'on peut vraiment conduire.
//
// La conduite passe par ctx.startDrive / ctx.stopDrive (branchés dans
// main.js sur controls.setVehicle). Les voitures ne sont pas synchronisées
// entre clients : chacun voit son propre trafic, comme les péniches.

const CAR_COLORS = [0xc0392b, 0x2c6ebb, 0xe8e6df, 0x5b6470, 0xd9a441, 0x3f7a4d, 0x8a4d9e];
const CABRIO_COLORS = [0xd9333f, 0x00b8a9, 0xffd23f, 0xff7a4d, 0x4da6ff, 0xc44dff];

const LANE = 1.7; // demi-écart des deux voies
const AVENUE_W = 7;

export function buildTraffic(ctx, bands, maxHalf = 110) {
  const rand = makeRand(4242);
  const L = Math.min((ctx.worldBound ?? 134) - 6, maxHalf);

  // --- Avenues : une chaussée de chaque côté de chaque fleuve. Si les
  // contours RÉELS de berge existent (ctx.quayContours, mode OSM), l'avenue
  // suit la berge : promenade piétonne de 6 m au bord de l'eau, puis la
  // route — plus jamais de voitures qui roulent au-dessus de l'eau là où
  // la ligne médiane sous-estime la largeur réelle du fleuve.
  // side = côté immeubles (pour y ranger les voitures garées).
  const W0 = ctx.worldBound ?? 200;
  const bankLookup = (band, side) => {
    if (!ctx.quayContours?.length) return null;
    const res = 8;
    const n = Math.ceil((2 * W0) / res);
    const arr = new Float32Array(n).fill(NaN);
    const half = riverHalf(band);
    for (const { pts } of ctx.quayContours) {
      for (const [x, z] of pts) {
        const cx = riverCx(band, z);
        if (Math.abs(x - cx) > half + 50) continue; // autre bande / trop loin
        if (side > 0 ? x < cx : x > cx) continue; // mauvaise rive
        const i = Math.floor((z + W0) / res);
        if (i < 0 || i >= n) continue;
        // bord d'eau le plus EXTÉRIEUR à ce z : la route passe derrière
        if (Number.isNaN(arr[i]) || (side > 0 ? x > arr[i] : x < arr[i])) arr[i] = x;
      }
    }
    // bouche-trous : report avant/arrière
    for (let i = 1; i < n; i++) if (Number.isNaN(arr[i])) arr[i] = arr[i - 1];
    for (let i = n - 2; i >= 0; i--) if (Number.isNaN(arr[i])) arr[i] = arr[i + 1];
    if (Number.isNaN(arr[0])) return null;
    return (z) => arr[Math.max(0, Math.min(n - 1, Math.floor((z + W0) / res)))];
  };
  const avenues = [];
  for (const band of bands) {
    const half = riverHalf(band);
    const zLo = Math.max(band.zMin ?? -L, -L);
    const zHi = Math.min(band.zMax ?? L, L);
    if (zHi - zLo < 60) continue;
    for (const side of [-1, 1]) {
      const bank = bankLookup(band, side);
      avenues.push({
        side,
        zLo, zHi,
        ax: bank
          ? (z) => bank(z) + side * (6 + AVENUE_W / 2)
          : (z) => riverCx(band, z) + side * (half + 11.5),
      });
    }
  }
  const roadTex = makeAvenueTexture();
  const roadMat = new THREE.MeshLambertMaterial({ map: roadTex, color: 0x6e7176 }); // enrobé sombre, vraie route noire
  for (const av of avenues) {
    // Ruban de chaussée tessellé le long de la courbe
    const STEP = 8, pos = [], uv = [];
    for (let z = av.zLo; z < av.zHi; z += STEP) {
      const za = z, zb = Math.min(z + STEP, av.zHi);
      const xa = av.ax(za), xb = av.ax(zb);
      pos.push(
        xa - AVENUE_W / 2, 0.019, za, xa + AVENUE_W / 2, 0.019, za, xb + AVENUE_W / 2, 0.019, zb,
        xa - AVENUE_W / 2, 0.019, za, xb + AVENUE_W / 2, 0.019, zb, xb - AVENUE_W / 2, 0.019, zb
      );
      const va = za / 14, vb = zb / 14;
      uv.push(0, va, 1, va, 1, vb, 0, va, 1, vb, 0, vb);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.computeVertexNormals();
    const strip = new THREE.Mesh(geo, roadMat);
    strip.userData.noShadow = true;
    ctx.scene.add(strip);
  }

  // --- Flotte instanciée : carrosseries, cabines, essieux -----------------
  // (trafic roulant + voitures garées dans les mêmes InstancedMesh)
  const moving = []; // { i, av, z, dir, speed }
  const parked = []; // { i, x, z, ry }

  for (const av of avenues) {
    const len = av.zHi - av.zLo;
    // Densité de trafic proportionnelle à la longueur d'avenue
    const perLane = Math.max(2, Math.min(8, Math.round(len / 110)));
    for (const dir of [1, -1]) {
      for (let k = 0; k < perLane; k++) {
        moving.push({
          av,
          z: av.zLo + rand() * len,
          dir,
          speed: 8 + rand() * 4,
        });
      }
    }
    // Stationnement le long du bord extérieur (côté immeubles)
    for (let z = av.zLo + 8; z < av.zHi - 8; z += 13) {
      if (Math.abs(z) < 9 || rand() < 0.4) continue; // ponts + trous
      const px = av.ax(z) + av.side * (AVENUE_W / 2 + 1.1);
      const box = {
        minX: px - 1.1, maxX: px + 1.1, minY: 0, maxY: 1.4,
        minZ: z - 2.2, maxZ: z + 2.2,
      };
      parked.push({ x: px, z: z + (rand() - 0.5) * 2, ry: rand() < 0.1 ? 0.2 : 0, box });
      // Les voitures garées sont solides (tant que personne ne les conduit)
      ctx.colliders.push(box);
    }
  }

  const n = moving.length + parked.length;
  const bodyGeo = new THREE.BoxGeometry(1.9, 0.6, 4.2);
  bodyGeo.translate(0, 0.62, 0);
  const bodies = new THREE.InstancedMesh(
    bodyGeo, new THREE.MeshLambertMaterial({ color: 0xffffff }), n
  );
  const cabinGeo = new THREE.BoxGeometry(1.7, 0.55, 2.1);
  cabinGeo.translate(0, 1.18, -0.25);
  const cabins = new THREE.InstancedMesh(
    cabinGeo, new THREE.MeshLambertMaterial({ color: 0x2a3340 }), n
  );
  const axleGeo = new THREE.BoxGeometry(2.0, 0.5, 0.62);
  axleGeo.translate(0, 0.26, 0);
  const axleMat = new THREE.MeshLambertMaterial({ color: 0x1c1e24 });
  const axles = new THREE.InstancedMesh(axleGeo, axleMat, n * 2);

  const _m = new THREE.Matrix4();
  const _q = new THREE.Quaternion();
  const _e = new THREE.Euler();
  const _p = new THREE.Vector3();
  const _s = new THREE.Vector3(1, 1, 1);
  const _c = new THREE.Color();

  function setCar(i, x, z, ry, y = 0) {
    _e.set(0, ry, 0);
    _q.setFromEuler(_e);
    _m.compose(_p.set(x, y, z), _q, _s);
    bodies.setMatrixAt(i, _m);
    cabins.setMatrixAt(i, _m);
    // Essieux avant/arrière, décalés dans le repère de la voiture
    for (const [k, off] of [[0, 1.35], [1, -1.35]]) {
      _p.set(x - Math.sin(ry) * off, y, z - Math.cos(ry) * off);
      _m.compose(_p, _q, _s);
      axles.setMatrixAt(i * 2 + k, _m);
    }
  }

  // Position/orientation d'une voiture de trafic sur son avenue courbe :
  // x = chaussée à ce z + déport de voie ; cap = tangente de la courbe.
  function placeCar(car) {
    car.x = car.av.ax(car.z) + LANE * car.dir;
    const ahead = car.av.ax(car.z + car.dir * 4) + LANE * car.dir;
    car.ry = Math.atan2(ahead - car.x, car.dir * 4) + Math.PI;
  }

  moving.forEach((car, idx) => {
    car.i = idx;
    placeCar(car);
    _c.setHex(CAR_COLORS[Math.floor(rand() * CAR_COLORS.length)]);
    bodies.setColorAt(idx, _c);
    setCar(idx, car.x, car.z, car.ry);
  });
  parked.forEach((car, k) => {
    const idx = moving.length + k;
    _c.setHex(CAR_COLORS[Math.floor(rand() * CAR_COLORS.length)]);
    bodies.setColorAt(idx, _c);
    setCar(idx, car.x, car.z, car.ry);
    // TOUTES les berlines garées sont conduisibles (caméra de poursuite)
    makeBerline(ctx, car, idx, setCar);
  });
  bodies.instanceColor.needsUpdate = true;
  ctx.scene.add(bodies, cabins, axles);

  // --- Trafic roulant + gare au piéton ------------------------------------
  let runOverCd = 0;
  let tick = 0;
  ctx.updatables.push((dt) => {
    runOverCd -= dt;
    tick++;
    const p = ctx.playerPos?.();
    for (const car of moving) {
      car.z += car.dir * car.speed * dt;
      if (car.z > car.av.zHi + 2) car.z = car.av.zLo - 2;
      if (car.z < car.av.zLo - 2) car.z = car.av.zHi + 2;
      // Veille au loin : à +160 m, la voiture avance mais son placement
      // (berge, cap, matrices) n'est recalculé qu'à ~6 Hz — invisible à
      // cette distance, et le CPU respire sur les grandes cartes.
      const far = p && Math.abs(p.x - car.x) + Math.abs(p.z - car.z) > 160;
      if (far && (tick + car.i) % 10 !== 0) continue;
      placeCar(car);
      setCar(car.i, car.x, car.z, car.ry);

      // Écrasé par un chauffard : dégâts (validés côté serveur) + klaxon
      if (p && !far && runOverCd <= 0 && !ctx.isDriving?.()) {
        if (Math.abs(p.x - car.x) < 1.5 && Math.abs(p.z - car.z) < 2.5 && p.y < 1.6) {
          runOverCd = 1.6;
          audio.horn();
          audio.crash();
          ctx.onRunOver?.();
        }
      }
    }
    bodies.instanceMatrix.needsUpdate = true;
    cabins.instanceMatrix.needsUpdate = true;
    axles.instanceMatrix.needsUpdate = true;
  });

  // --- Décapotables conduisibles ------------------------------------------
  // Garées le long des accotements côté quai (jamais dans un bâtiment) :
  // plusieurs par avenue, réparties sur la longueur de la courbe.
  const spots = [];
  for (const av of avenues) {
    const len = av.zHi - av.zLo;
    for (let k = 1; k <= 4; k++) {
      const z = av.zLo + (len * k) / 5 + 3; // décalé des ponts
      const sx = av.ax(z) - av.side * (AVENUE_W / 2 + 1.1); // accotement côté quai
      spots.push({ x: sx, z, ry: k % 2 ? Math.PI : 0 });
    }
  }
  // Une décapotable sur deux a l'autoradio (stations 1/2/3 en alternance)
  spots.forEach((s, i) => {
    if (i % 2 === 0) s.radio = 1 + (i / 2) % 3;
    buildCabrio(ctx, s, CABRIO_COLORS[i % CABRIO_COLORS.length]);
  });
}

// Berline garée conduisible : on réutilise l'instance des InstancedMesh
// (zéro géométrie en plus) et on retire/repose son collider quand on
// entre/sort. Caméra de poursuite (thirdPerson) — en décapotable on reste
// en 1re personne, cheveux au vent.
function makeBerline(ctx, p, idx, setCar) {
  const car = { heading: p.ry, speed: 0, thirdPerson: true };
  // Pseudo-groupe : startDrive/stopDrive ne lisent que .position
  const anchor = { position: new THREE.Vector3(p.x, 0, p.z) };
  let driving = false;

  // Repose la voiture là où elle s'est arrêtée (collider approché par le cap)
  function park() {
    driving = false;
    gate.label = 'E — Conduire la berline';
    p.x = anchor.position.x;
    p.z = anchor.position.z;
    gate.x = p.x;
    gate.z = p.z;
    const s = Math.abs(Math.sin(car.heading)), c = Math.abs(Math.cos(car.heading));
    p.box = {
      minX: p.x - (1.1 * c + 2.1 * s), maxX: p.x + (1.1 * c + 2.1 * s),
      minY: 0, maxY: 1.4,
      minZ: p.z - (2.1 * c + 1.1 * s), maxZ: p.z + (2.1 * c + 1.1 * s),
    };
    ctx.colliders.push(p.box);
    setCar(idx, p.x, p.z, car.heading, anchor.position.y);
  }

  const gate = {
    x: p.x, z: p.z, r: 2.8,
    label: 'E — Conduire la berline',
    action: () => {
      if (!driving) {
        driving = true;
        ctx.colliders.remove?.(p.box); // plus un obstacle : c'est NOTRE voiture
        gate.label = 'E — Couper le moteur et sortir';
        anchor.position.set(p.x, 0, p.z);
        ctx.startDrive?.(car, anchor);
        ctx.notify?.('🚗 Berline empruntée ! ZQSD pour conduire, Espace pour klaxonner.');
      } else {
        park();
        ctx.stopDrive?.(car, anchor);
      }
    },
  };
  ctx.interactables.push(gate);

  // Mort au volant : la berline reste sur place, moteur coupé
  ctx.abortRides?.push(() => {
    if (driving) park();
  });

  // Tant qu'on conduit : l'instance et l'interactable suivent le joueur
  ctx.updatables.push(() => {
    if (!driving) return;
    const q = ctx.playerPos?.();
    if (!q) return;
    anchor.position.set(q.x, q.y, q.z);
    setCar(idx, q.x, q.z, car.heading, q.y);
    gate.x = q.x;
    gate.z = q.z;
  });
}

function buildCabrio(ctx, spot, color) {
  const group = new THREE.Group();
  const bodyMat = new THREE.MeshLambertMaterial({ color });
  const darkMat = new THREE.MeshLambertMaterial({ color: 0x1c1e24 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.55, 4.1), bodyMat);
  body.position.y = 0.62;
  group.add(body);
  // Capot légèrement plongeant + coffre
  const hood = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.18, 1.2), bodyMat);
  hood.position.set(0, 0.95, -1.35);
  group.add(hood);
  // Pare-brise
  const windshield = new THREE.Mesh(
    new THREE.PlaneGeometry(1.6, 0.6),
    new THREE.MeshLambertMaterial({
      color: 0x9fc4d8, transparent: true, opacity: 0.55, side: THREE.DoubleSide,
    })
  );
  windshield.position.set(0, 1.25, -0.7);
  windshield.rotation.x = -0.35;
  group.add(windshield);
  // Banquette + volant (c'est une décapotable : on voit l'intérieur)
  const seat = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.55, 0.3), darkMat);
  seat.position.set(0, 1.05, 0.6);
  group.add(seat);
  const wheelRim = new THREE.Mesh(new THREE.TorusGeometry(0.18, 0.035, 6, 12), darkMat);
  wheelRim.position.set(-0.45, 1.05, -0.35);
  wheelRim.rotation.x = -0.9;
  group.add(wheelRim);
  // Essieux
  for (const off of [1.3, -1.3]) {
    const axle = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.5, 0.6), darkMat);
    axle.position.set(0, 0.26, off);
    group.add(axle);
  }
  group.position.set(spot.x, 0, spot.z);
  group.rotation.y = spot.ry;
  ctx.scene.add(group);

  // 1re personne assumée : en décapotable on veut le vent dans les cheveux
  const car = { heading: spot.ry, speed: 0, thirdPerson: false };
  let driving = false;

  // Autoradio : chaque décapotable a sa station (boucle procédurale, voir
  // music.js) — allumée au volant, coupée à la descente. Coût quasi nul.
  let radio = null;

  const gate = {
    x: spot.x, z: spot.z, r: 3,
    label: 'E — Conduire la décapotable',
    action: () => {
      if (!driving) {
        driving = true;
        gate.label = 'E — Couper le moteur et sortir';
        ctx.startDrive?.(car, group);
        if (spot.radio) {
          radio ??= createMusicSource();
          radio.setVolume(0.26);
          radio.start(spot.radio);
          ctx.notify?.('🚗📻 Vroum ! Autoradio à fond, ZQSD pour conduire, Espace pour klaxonner.');
        } else {
          ctx.notify?.('🚗 Vroum ! ZQSD pour conduire, Espace pour klaxonner.');
        }
      } else {
        driving = false;
        gate.label = 'E — Conduire la décapotable';
        radio?.stop();
        ctx.stopDrive?.(car, group);
        gate.x = group.position.x;
        gate.z = group.position.z;
      }
    },
  };
  ctx.interactables.push(gate);

  // Mort au volant (ou autre interruption) : la voiture reste sur place
  ctx.abortRides?.push(() => {
    if (!driving) return;
    driving = false;
    gate.label = 'E — Conduire la décapotable';
    radio?.stop();
    gate.x = group.position.x;
    gate.z = group.position.z;
  });

  // Tant qu'on conduit : la carrosserie et l'interactable suivent le joueur
  ctx.updatables.push(() => {
    if (!driving) return;
    const p = ctx.playerPos?.();
    if (!p) return;
    group.position.set(p.x, p.y, p.z);
    group.rotation.y = car.heading;
    gate.x = p.x;
    gate.z = p.z;
  });
}

// Chaussée d'avenue : bitume + ligne centrale discontinue + bandes de rive
function makeAvenueTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 128;
  const g = canvas.getContext('2d');
  g.fillStyle = '#383d47';
  g.fillRect(0, 0, 64, 128);
  for (let i = 0; i < 260; i++) {
    const v = 60 + Math.random() * 36;
    g.fillStyle = `rgba(${v}, ${v + 4}, ${v + 12}, 0.4)`;
    g.fillRect(Math.random() * 64, Math.random() * 128, 1.5, 1.5);
  }
  g.fillStyle = '#cdd2b8';
  g.fillRect(30, 10, 4, 46); // pointillés centraux
  g.fillRect(30, 74, 4, 46);
  g.fillStyle = 'rgba(210, 214, 200, 0.7)';
  g.fillRect(2, 0, 2, 128); // rives
  g.fillRect(60, 0, 2, 128);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}
