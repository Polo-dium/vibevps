import * as THREE from 'three';

// Vélo'v 🚲 : les vélos rouges en libre-service, comme les vrais. Des
// stations aux points connus de la ville, chaque vélo s'emprunte (E), se
// conduit en vue subjective (guidon et panier devant soi) et se repose où
// on veut — il redevient alors empruntable sur place, par soi comme par
// les autres sessions locales (les vélos ne sont pas synchronisés, comme
// les voitures).
const VELOV_RED = 0xb8353f;
const SILVER = 0xb9c0c8;

export function buildVelovModel() {
  const group = new THREE.Group();
  const red = new THREE.MeshLambertMaterial({ color: VELOV_RED });
  const silver = new THREE.MeshLambertMaterial({ color: SILVER });
  const dark = new THREE.MeshLambertMaterial({ color: 0x23262d });
  const add = (geo, mat, x, y, z, rx = 0, ry = 0, rz = 0) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.rotation.set(rx, ry, rz);
    group.add(m);
    return m;
  };
  // Roues (nez du vélo vers -z, comme tout le monde)
  const wheelGeo = new THREE.TorusGeometry(0.34, 0.045, 6, 14);
  add(wheelGeo, dark, 0, 0.34, -0.62);
  add(wheelGeo, dark, 0, 0.34, 0.62);
  // Cadre col de cygne (la signature Vélo'v) + tube de selle
  add(new THREE.BoxGeometry(0.07, 0.09, 1.05), red, 0, 0.6, 0, 0.12);
  add(new THREE.BoxGeometry(0.07, 0.5, 0.09), red, 0, 0.72, 0.5, -0.25);
  add(new THREE.BoxGeometry(0.07, 0.55, 0.09), silver, 0, 0.72, -0.58, 0.18);
  // Guidon + panier gris (l'autre signature)
  add(new THREE.BoxGeometry(0.52, 0.05, 0.05), silver, 0, 1.06, -0.66);
  add(new THREE.BoxGeometry(0.34, 0.16, 0.26), silver, 0, 0.92, -0.82);
  // Selle + garde-boue arrière
  add(new THREE.BoxGeometry(0.24, 0.06, 0.3), dark, 0, 1.02, 0.48);
  add(new THREE.BoxGeometry(0.1, 0.04, 0.5), red, 0, 0.72, 0.68, 0.25);
  return group;
}

function makeVelov(ctx, x0, z0, ry0) {
  const group = buildVelovModel();
  const y0 = Math.max(0, ctx.terrainHeight?.(x0, z0) ?? 0);
  group.position.set(x0, y0, z0);
  group.rotation.y = ry0;
  ctx.scene.add(group);

  const car = {
    heading: ry0, speed: 0, thirdPerson: false, bike: true,
    maxSpeed: 11, maxReverse: 3, acceleration: 9,
  };
  let driving = false;

  function park() {
    driving = false;
    if (ctx.activeBike === group) ctx.activeBike = null;
    gate.label = 'E — Emprunter le Vélo’v';
    gate.x = group.position.x;
    gate.z = group.position.z;
    group.position.y = Math.max(0, ctx.terrainHeight?.(gate.x, gate.z) ?? 0);
    group.rotation.set(0, car.heading, 0);
  }

  const gate = {
    x: x0, z: z0, r: 2.6,
    label: 'E — Emprunter le Vélo’v',
    action: () => {
      if (!driving) {
        driving = true;
        gate.label = 'E — Poser le Vélo’v';
        car.speed = 0;
        ctx.activeBike = group; // main.js y pose l'enceinte, dans le panier
        ctx.startDrive?.(car, group);
        ctx.notify?.('🚲 Vélo’v : Z/S pédale et freine, Q/D braque — repose-le où tu veux (E).');
      } else {
        ctx.stopDrive?.(car, group);
        park();
      }
    },
  };
  ctx.interactables.push(gate);
  ctx.abortRides?.push(() => { if (driving) park(); });

  ctx.updatables.push(() => {
    if (!driving) return;
    const q = ctx.playerPos?.();
    if (!q) return;
    group.position.set(q.x, q.y, q.z);
    group.rotation.set(0, car.heading, 0);
    // léger penché dans les virages, cosmétique
    group.rotation.z = THREE.MathUtils.clamp(-car.speed * 0.004, -0.12, 0.12);
    gate.x = q.x;
    gate.z = q.z;
  });
}

export function buildVelovStations(ctx) {
  // Une borne + 3 vélos par station, aux endroits qui comptent.
  const spots = [];
  const poi = (id) => ctx.pois?.find((p) => p.id === id);
  const roue = poi('roue');
  if (roue) spots.push([roue.x + 14, roue.z + 10]);
  const musee = poi('musee');
  if (musee) spots.push([musee.x + 18, musee.z]);
  const ficelle = poi('ficelle');
  if (ficelle) spots.push([ficelle.x + 10, ficelle.z + 12]);
  const aero = ctx.airport;
  if (aero) spots.push([aero.x - 40, aero.z - 60]);
  if (!spots.length) spots.push([24, 30]);
  spots.push([-18, 34]); // et toujours une station à Bellecour, côté sud

  const borneMat = new THREE.MeshLambertMaterial({ color: 0x8a2430 });
  for (const [sx, sz] of spots) {
    const sy = Math.max(0, ctx.terrainHeight?.(sx, sz) ?? 0);
    // Totem de la station
    const borne = new THREE.Mesh(new THREE.BoxGeometry(0.5, 2.1, 0.34), borneMat);
    borne.position.set(sx, sy + 1.05, sz);
    ctx.scene.add(borne);
    const panel = new THREE.Mesh(
      new THREE.PlaneGeometry(0.42, 0.5),
      new THREE.MeshLambertMaterial({ color: 0xdfe6ec, emissive: 0x30414f })
    );
    panel.position.set(sx, sy + 1.55, sz - 0.18);
    ctx.scene.add(panel);
    ctx.colliders.push({
      minX: sx - 0.3, maxX: sx + 0.3, minY: sy, maxY: sy + 2.1, minZ: sz - 0.2, maxZ: sz + 0.2,
    });
    for (let i = 0; i < 3; i++) {
      makeVelov(ctx, sx + 1.1 + i * 0.9, sz + 0.4, 0);
    }
    ctx.pois?.push({ id: `velov-${Math.round(sx)}`, nom: 'Station Vélo’v', emoji: '🚲', x: sx, z: sz });
  }
}
