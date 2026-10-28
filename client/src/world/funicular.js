import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { makeTextTexture } from './utils.js';

// LA FICELLE DE FOURVIÈRE (ville OSM) : funiculaire à deux cabines
// contrepoids, de la gare Saint-Jean (pied de la colline, à côté de la
// cathédrale) à l'esplanade de la basilique. La vraie ligne passe en
// tunnel ; ici elle monte à ciel ouvert à travers le parc du Rosaire (zone
// sans immeubles OSM), sur une voie double posée sur la pente.
//
// Horaire partagé sans serveur, calé sur Date.now() comme le jour/nuit :
// tous les joueurs voient les mêmes cabines au même endroit. Une cabine
// stationne en gare pendant que l'autre attend en haut, puis elles se
// croisent à mi-pente.
//
// A = gare basse, B = gare haute : { x, z } (hauteurs tirées du terrain).

const DWELL = 14; // s à quai
const TRAVEL = 22; // s de trajet
const CYCLE = 2 * (DWELL + TRAVEL);
const GAUGE = 1.35; // demi-entraxe des deux voies

// t (0 = bas, 1 = haut) et état d'une cabine à l'instant `sec`
function cabinState(sec, offset) {
  const p = (((sec + offset) % CYCLE) + CYCLE) % CYCLE;
  const ease = (x) => x * x * (3 - 2 * x);
  if (p < DWELL) return { t: 0, dock: 'bas', left: DWELL - p };
  if (p < DWELL + TRAVEL) return { t: ease((p - DWELL) / TRAVEL), dock: null, left: DWELL + TRAVEL - p };
  if (p < 2 * DWELL + TRAVEL) return { t: 1, dock: 'haut', left: 2 * DWELL + TRAVEL - p };
  return { t: 1 - ease((p - 2 * DWELL - TRAVEL) / TRAVEL), dock: null, left: CYCLE - p };
}

export function buildFuniculaire(ctx, A, B) {
  const ground = (x, z) => Math.max(0, ctx.terrainHeight?.(x, z) ?? 0);
  const dx = B.x - A.x, dz = B.z - A.z;
  const len = Math.hypot(dx, dz);
  const ax = dx / len, az = dz / len; // le long de la voie (vers le haut)
  const px = -az, pz = ax;            // en travers

  // Profil de la voie : le terrain + 40 cm, rendu monotone (la pente ne
  // redescend jamais) puis lissé ; des piles là où la voie survole le sol.
  const N = 60;
  const prof = [];
  for (let i = 0; i <= N; i++) {
    const s = (i / N) * len;
    prof.push(ground(A.x + ax * s, A.z + az * s) + 0.4);
  }
  for (let i = 1; i <= N; i++) prof[i] = Math.max(prof[i], prof[i - 1]);
  for (let pass = 0; pass < 3; pass++) {
    for (let i = 1; i < N; i++) prof[i] = (prof[i - 1] + prof[i] * 2 + prof[i + 1]) / 4;
  }
  const yAt = (t) => {
    const f = Math.max(0, Math.min(1, t)) * N;
    const i = Math.min(N - 1, Math.floor(f));
    return prof[i] + (prof[i + 1] - prof[i]) * (f - i);
  };
  const at = (t, side = 0) => new THREE.Vector3(
    A.x + ax * t * len + px * side, yAt(t), A.z + az * t * len + pz * side
  );

  // ---- voie : traverses, rails, piles (géométrie fusionnée, 2 draw calls)
  const wood = [], steel = [];
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
  const place = (geo, pos, yaw, pitch) => {
    e.set(pitch, yaw, 0, 'YXZ');
    q.setFromEuler(e);
    m.compose(pos, q, new THREE.Vector3(1, 1, 1));
    return geo.clone().applyMatrix4(m);
  };
  const yaw = Math.atan2(ax, az);
  const slope = (t0, t1) => -Math.atan2(yAt(t1) - yAt(t0), (t1 - t0) * len);
  const sleeper = new THREE.BoxGeometry(5.6, 0.16, 0.5);
  const NS = Math.floor(len / 1.4);
  for (let i = 0; i <= NS; i++) {
    const t = i / NS;
    wood.push(place(sleeper, at(t).setY(yAt(t) - 0.05), yaw, slope(Math.max(0, t - 0.01), Math.min(1, t + 0.01))));
  }
  for (let i = 0; i < N; i++) {
    const t0 = i / N, t1 = (i + 1) / N;
    const segLen = Math.hypot(len / N, yAt(t1) - yAt(t0));
    const rail = new THREE.BoxGeometry(0.12, 0.14, segLen + 0.02);
    for (const side of [-GAUGE - 0.6, -GAUGE + 0.6, GAUGE - 0.6, GAUGE + 0.6]) {
      const mid = at((t0 + t1) / 2, side);
      mid.y = (yAt(t0) + yAt(t1)) / 2 + 0.1;
      steel.push(place(rail, mid, yaw, slope(t0, t1)));
    }
    // câble de traction entre les rails de chaque voie
    for (const side of [-GAUGE, GAUGE]) {
      const mid = at((t0 + t1) / 2, side);
      mid.y = (yAt(t0) + yAt(t1)) / 2 + 0.05;
      steel.push(place(new THREE.BoxGeometry(0.05, 0.05, segLen), mid, yaw, slope(t0, t1)));
    }
    // pile de maçonnerie sous la voie quand elle quitte le sol
    if (i % 3 === 0) {
      const p = at(t0);
      const gy = ground(p.x, p.z);
      const h = p.y - 0.2 - gy;
      if (h > 0.6) {
        const pile = new THREE.BoxGeometry(5.2, h + 0.6, 0.9).translate(0, (h + 0.6) / 2 - 0.6, 0);
        wood.push(place(pile, new THREE.Vector3(p.x, gy, p.z), yaw, 0));
      }
    }
  }
  const woodMesh = new THREE.Mesh(mergeGeometries(wood.map((g) => g.index ? g.toNonIndexed() : g)),
    new THREE.MeshLambertMaterial({ color: 0x8a7f70 }));
  const steelMesh = new THREE.Mesh(mergeGeometries(steel.map((g) => g.index ? g.toNonIndexed() : g)),
    new THREE.MeshStandardMaterial({ color: 0x9aa0a6, metalness: 0.8, roughness: 0.35 }));
  for (const mesh of [woodMesh, steelMesh]) {
    mesh.receiveShadow = true;
    mesh.userData.noCull = true;
    ctx.scene.add(mesh);
  }

  // ---- gares : quai le long de la voie, auvent de verre, totem « F »
  const stone = new THREE.MeshLambertMaterial({ color: 0xcfc7b6 });
  const glassRoof = new THREE.MeshStandardMaterial({
    color: 0x8fb3c4, metalness: 0.3, roughness: 0.15, transparent: true, opacity: 0.55, depthWrite: false,
  });
  const frame = new THREE.MeshLambertMaterial({ color: 0xb4232a }); // rouge TCL
  const stations = {};
  for (const [id, t, nom] of [['bas', 0, 'SAINT-JEAN'], ['haut', 1, 'FOURVIÈRE']]) {
    const g = new THREE.Group();
    const c = at(t);
    const qx = c.x + px * (GAUGE + 3.1), qz = c.z + pz * (GAUGE + 3.1);
    const qy = c.y + 0.35;
    // quai praticable (côté droit en montant)
    const quai = new THREE.Mesh(new THREE.BoxGeometry(3.2, 1.2, 9), stone);
    quai.position.set(0, qy - 0.6, 0);
    g.add(quai);
    // auvent : poteaux rouges au fond du quai (local +x = côté voie),
    // verrière qui couvre le quai et la cabine à l'arrêt
    for (const s of [-3.6, 3.6]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.2, 3.4, 0.2), frame);
      post.position.set(-1.4, qy + 1.7, s);
      g.add(post);
    }
    const roof = new THREE.Mesh(new THREE.BoxGeometry(6.4, 0.1, 9.4), glassRoof);
    roof.position.set(1.0, qy + 3.6, 0);
    roof.rotation.z = 0.06;
    g.add(roof);
    const beam = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.25, 9.4), frame);
    beam.position.set(-1.4, qy + 3.4, 0);
    g.add(beam);
    // totem du funiculaire
    const sign = new THREE.Mesh(
      new THREE.PlaneGeometry(4.2, 1),
      new THREE.MeshBasicMaterial({ map: makeTextTexture(`F · ${nom}`, { color: '#ffffff', bg: '#b4232a' }) })
    );
    sign.position.set(-1.28, qy + 2.6, 0);
    sign.rotation.y = Math.PI / 2;
    g.add(sign);
    const back = sign.clone();
    back.position.x = -1.52;
    back.rotation.y = -Math.PI / 2;
    g.add(back);
    g.position.set(qx, 0, qz);
    g.rotation.y = yaw;
    g.userData.noCull = true;
    ctx.scene.add(g);
    // collider du quai (boîte axiale englobante, la gare est petite)
    const hx = 4.5 * Math.abs(ax) + 1.6 * Math.abs(az), hz = 4.5 * Math.abs(az) + 1.6 * Math.abs(ax);
    ctx.colliders.push({ minX: qx - hx, maxX: qx + hx, minZ: qz - hz, maxZ: qz + hz, minY: qy - 1.2, maxY: qy });
    stations[id] = { x: qx, y: qy, z: qz };
    ctx.pois?.push({
      id: `ficelle-${id}`, nom: `Funiculaire — gare ${nom === 'SAINT-JEAN' ? 'Saint-Jean' : 'Fourvière'}`,
      emoji: '🚋', x: qx, z: qz,
    });
  }
  // escalier d'accès au quai bas (la gare est à hauteur de voie)
  {
    const s = stations.bas;
    const gy = ground(s.x, s.z);
    const steps = Math.max(0, Math.ceil((s.y - gy) / 0.3));
    for (let i = 0; i < steps; i++) {
      const h = s.y - gy - i * 0.3;
      const st = new THREE.Mesh(new THREE.BoxGeometry(3.2, h, 0.6), stone);
      const off = -4.8 - i * 0.6;
      st.position.set(s.x + ax * off, gy + h / 2, s.z + az * off);
      st.rotation.y = yaw;
      ctx.scene.add(st);
    }
  }

  // ---- cabines : caisse en gradins (plancher horizontal sur la pente),
  // rouge et crème, vitrages éclairés la nuit
  const red = new THREE.MeshLambertMaterial({ color: 0xb4232a });
  const cream = new THREE.MeshLambertMaterial({ color: 0xece4d0 });
  const win = new THREE.MeshLambertMaterial({ color: 0x24313d, emissive: 0xffe2a8, emissiveIntensity: 0 });
  ctx.updatables.push(() => { win.emissiveIntensity = (ctx.env?.night ?? 0) * 0.9; });
  const makeCabin = (num) => {
    const g = new THREE.Group();
    const body = new THREE.Group(); // incliné comme la pente
    const lower = new THREE.Mesh(new THREE.BoxGeometry(2.3, 1.1, 7), red);
    lower.position.y = 0.75;
    const band = new THREE.Mesh(new THREE.BoxGeometry(2.36, 0.95, 6.8), win);
    band.position.y = 1.78;
    const upper = new THREE.Mesh(new THREE.BoxGeometry(2.3, 0.35, 7), cream);
    upper.position.y = 2.42;
    const roof = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.18, 6.9), red);
    roof.position.y = 2.68;
    body.add(lower, band, upper, roof);
    // montants entre les vitres
    for (let i = -3; i <= 3; i++) {
      const p = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.95, 0.12), cream);
      p.position.set(0, 1.78, i * 1.1);
      body.add(p);
    }
    const plate = new THREE.Mesh(
      new THREE.PlaneGeometry(1.6, 0.5),
      new THREE.MeshBasicMaterial({ map: makeTextTexture(`F${num}`, { color: '#ffffff', bg: '#b4232a', width: 256, height: 80 }) })
    );
    plate.position.set(0, 1.0, 3.51);
    body.add(plate);
    g.add(body);
    g.userData.noCull = true;
    g.userData.body = body;
    ctx.scene.add(g);
    return g;
  };
  const cabins = [
    { g: makeCabin(1), side: GAUGE, offset: 0 },
    { g: makeCabin(2), side: -GAUGE, offset: DWELL + TRAVEL }, // contrepoids
  ];

  let riding = null; // { cabin, from }
  const sec = () => Date.now() / 1000;
  ctx.updatables.push(() => {
    const now = sec();
    for (const c of cabins) {
      const st = cabinState(now, c.offset);
      c.st = st;
      const p = at(st.t, c.side);
      c.g.position.set(p.x, p.y + 0.1, p.z);
      c.g.rotation.y = yaw;
      const t0 = Math.max(0, st.t - 0.02), t1 = Math.min(1, st.t + 0.02);
      c.g.userData.body.rotation.x = slope(t0, t1);
    }
    if (!riding) return;
    const st = riding.cabin.st;
    if (st.dock && st.dock !== riding.from) {
      const s = stations[st.dock];
      riding = null;
      ctx.rideTick?.(s.x, s.y + 0.1, s.z);
      ctx.notify?.(st.dock === 'haut'
        ? '🚋 Terminus Fourvière ! La basilique est juste là, gone.'
        : '🚋 Terminus Saint-Jean — tout le monde descend, la cathédrale est en face !');
      return;
    }
    const p = riding.cabin.g.position;
    ctx.rideTick?.(p.x, p.y + 0.6, p.z);
  });
  ctx.abortRides?.push(() => { riding = null; });

  for (const [id, label] of [['bas', 'E — Monter à Fourvière en ficelle'], ['haut', 'E — Redescendre à Saint-Jean en ficelle']]) {
    const s = stations[id];
    ctx.interactables.push({
      x: s.x, z: s.z, r: 4.5, label,
      action: () => {
        if (riding) return;
        const c = cabins.find((cc) => cc.st?.dock === id);
        if (!c) {
          // la prochaine cabine qui sera à quai dans cette gare
          const now = sec();
          let wait = 1;
          while (wait < CYCLE && !cabins.some((cc) => cabinState(now + wait, cc.offset).dock === id)) wait += 1;
          ctx.notify?.(`🚋 La ficelle arrive dans ${Math.ceil(wait)} s… patience, fenotte !`);
          return;
        }
        riding = { cabin: c, from: id };
        ctx.notify?.(`🚋 En voiture ! Départ dans ${Math.ceil(c.st.left)} s, direction ${id === 'bas' ? 'Fourvière' : 'Saint-Jean'}.`);
      },
    });
  }
}
