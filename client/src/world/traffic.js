import * as THREE from 'three';
import { audio } from '../audio.js';
import { makeRand } from './layout.js';

// Circulation des quais : avenues le long des berges, trafic de voitures
// low-poly (tout en InstancedMesh : 3 draw calls pour l'ensemble), voitures
// garées déterministes, et des décapotables qu'on peut vraiment conduire.
//
// La conduite passe par ctx.startDrive / ctx.stopDrive (branchés dans
// main.js sur controls.setVehicle). Les voitures ne sont pas synchronisées
// entre clients : chacun voit son propre trafic, comme les péniches.

const CAR_COLORS = [0xc0392b, 0x2c6ebb, 0xe8e6df, 0x5b6470, 0xd9a441, 0x3f7a4d, 0x8a4d9e];
const CABRIO_COLORS = [0xd9333f, 0x00b8a9, 0xffd23f, 0xff7a4d, 0x4da6ff, 0xc44dff];

const LANE = 1.7; // demi-écart des deux voies
const AVENUE_W = 7;

export function buildTraffic(ctx, bands) {
  const rand = makeRand(4242);
  const L = (ctx.worldBound ?? 134) - 6;

  // --- Avenues : une chaussée de chaque côté de chaque fleuve -------------
  // side = côté immeubles (pour y ranger les voitures garées)
  const avenues = [];
  for (const band of bands) {
    avenues.push({ x: band.minX - 11.5, side: -1 }, { x: band.maxX + 11.5, side: 1 });
  }
  const roadTex = makeAvenueTexture();
  roadTex.repeat.set(1, Math.round((L * 2) / 14));
  const roadMat = new THREE.MeshLambertMaterial({ map: roadTex });
  for (const av of avenues) {
    const strip = new THREE.Mesh(new THREE.PlaneGeometry(AVENUE_W, L * 2), roadMat);
    strip.rotation.x = -Math.PI / 2;
    strip.position.set(av.x, 0.019, 0);
    strip.userData.noShadow = true;
    ctx.scene.add(strip);
  }

  // --- Flotte instanciée : carrosseries, cabines, essieux -----------------
  // (trafic roulant + voitures garées dans les mêmes InstancedMesh)
  const moving = []; // { i, x, z, dir, speed, lastHitAt }
  const parked = []; // { i, x, z, ry }

  for (const av of avenues) {
    // 2 voies × 2 voitures par avenue
    for (const dir of [1, -1]) {
      for (let k = 0; k < 2; k++) {
        moving.push({
          x: av.x + LANE * dir, // conduite à droite
          z: -L + rand() * L * 2,
          dir,
          speed: 8 + rand() * 4,
          lastHitAt: 0,
        });
      }
    }
    // Stationnement le long du bord extérieur (côté immeubles)
    const px = av.x + av.side * (AVENUE_W / 2 + 1.1);
    for (let z = -L + 8; z < L - 8; z += 13) {
      if (Math.abs(z) < 9 || rand() < 0.4) continue; // ponts + trous
      parked.push({ x: px, z: z + (rand() - 0.5) * 2, ry: rand() < 0.1 ? 0.2 : 0 });
      // Les voitures garées sont solides
      ctx.colliders.push({
        minX: px - 1.1, maxX: px + 1.1, minY: 0, maxY: 1.4,
        minZ: z - 2.2, maxZ: z + 2.2,
      });
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

  function setCar(i, x, z, ry) {
    _e.set(0, ry, 0);
    _q.setFromEuler(_e);
    _m.compose(_p.set(x, 0, z), _q, _s);
    bodies.setMatrixAt(i, _m);
    cabins.setMatrixAt(i, _m);
    // Essieux avant/arrière, décalés dans le repère de la voiture
    for (const [k, off] of [[0, 1.35], [1, -1.35]]) {
      _p.set(x - Math.sin(ry) * off, 0, z - Math.cos(ry) * off);
      _m.compose(_p, _q, _s);
      axles.setMatrixAt(i * 2 + k, _m);
    }
  }

  moving.forEach((car, idx) => {
    car.i = idx;
    _c.setHex(CAR_COLORS[Math.floor(rand() * CAR_COLORS.length)]);
    bodies.setColorAt(idx, _c);
    setCar(idx, car.x, car.z, car.dir > 0 ? Math.PI : 0);
  });
  parked.forEach((car, k) => {
    const idx = moving.length + k;
    _c.setHex(CAR_COLORS[Math.floor(rand() * CAR_COLORS.length)]);
    bodies.setColorAt(idx, _c);
    setCar(idx, car.x, car.z, car.ry);
  });
  bodies.instanceColor.needsUpdate = true;
  ctx.scene.add(bodies, cabins, axles);

  // --- Trafic roulant + gare au piéton ------------------------------------
  let runOverCd = 0;
  ctx.updatables.push((dt) => {
    runOverCd -= dt;
    for (const car of moving) {
      car.z += car.dir * car.speed * dt;
      if (car.z > L + 6) car.z = -L - 6;
      if (car.z < -L - 6) car.z = L + 6;
      setCar(car.i, car.x, car.z, car.dir > 0 ? Math.PI : 0);

      // Écrasé par un chauffard : dégâts (validés côté serveur) + klaxon
      const p = ctx.playerPos?.();
      if (p && runOverCd <= 0 && !ctx.isDriving?.()) {
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
  // Garées aux extrémités des avenues, côté ville : toujours sur la chaussée
  // qu'on vient de créer, donc jamais dans un bâtiment (les deux modes).
  const spots = [];
  for (const av of avenues) {
    const sx = av.x - av.side * (AVENUE_W / 2 + 1.1); // accotement côté quai
    spots.push({ x: sx, z: 24, ry: 0 });
    if (spots.length < CABRIO_COLORS.length) {
      spots.push({ x: sx, z: -32, ry: Math.PI });
    }
  }
  spots.length = Math.min(spots.length, CABRIO_COLORS.length);
  spots.forEach((s, i) => buildCabrio(ctx, s, CABRIO_COLORS[i]));
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

  const car = { heading: spot.ry, speed: 0 };
  let driving = false;

  const gate = {
    x: spot.x, z: spot.z, r: 3,
    label: 'E — Conduire la décapotable',
    action: () => {
      if (!driving) {
        driving = true;
        gate.label = 'E — Couper le moteur et sortir';
        ctx.startDrive?.(car, group);
        ctx.notify?.('🚗 Vroum ! ZQSD pour conduire, Espace pour klaxonner.');
      } else {
        driving = false;
        gate.label = 'E — Conduire la décapotable';
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
