import * as THREE from 'three';
import { roadHalf } from './roadfit.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { riverCx, makeRand } from './layout.js';
import { edgeDist, insidePoly } from './passerelles.js';
import { buildHuman } from './human.js';

// LES MARCHÉS (ville OSM) : le marché du quai Saint-Antoine, le long de la
// Saône face à Saint-Jean, et celui du boulevard de la Croix-Rousse. Étals
// sous bâches rayées, tréteaux, cagettes de fruits et légumes, quelques
// marchands. Installés le jour, remballés la nuit. Instancié : 5 draw calls
// pour tous les étals ; placement déterministe (seed fixe).

const SW = 3.2, SD = 2.2; // étal : largeur le long de l'allée, profondeur

function colored(geo, hex) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const c = new THREE.Color(hex), n = g.attributes.position.count;
  const a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  if (g.attributes.uv) g.deleteAttribute('uv');
  return g;
}

// Emplacements le long de la rive Presqu'île de la Saône (quai Saint-Antoine)
function quaiSaintAntoine(ctx, data) {
  const polys = data.waterPolys;
  const saone = [...data.water].sort((a, b) => a.minX - b.minX)[0];
  if (!saone?.cx || !polys?.length) return [];
  const out = [];
  for (let z = -296; z < -232; z += SW + 0.8) {
    const cx = riverCx(saone, z);
    if (!polys.some((r) => insidePoly(r, cx, z))) continue;
    const e = edgeDist(polys, cx, z, 1, 0);
    if (!Number.isFinite(e)) continue;
    const tx = riverCx(saone, z + 4) - riverCx(saone, z - 4);
    // étal adossé à l'allée, face au parapet (le client vient du quai)
    out.push({ x: cx + e + 4.2, z, yaw: Math.atan2(tx, 8) + Math.PI / 2 });
  }
  return out;
}

// Emplacements le long du boulevard de la Croix-Rousse (côté sud)
function boulevardCroixRousse(ctx, data) {
  const out = [];
  for (const r of data.roads) {
    if (r.w < 7) continue;
    for (let i = 0; i + 3 < r.p.length; i += 2) {
      const x1 = r.p[i], z1 = r.p[i + 1], x2 = r.p[i + 2], z2 = r.p[i + 3];
      if (z1 < -965 || z1 > -885 || x1 < -190 || x1 > 230) continue;
      const len = Math.hypot(x2 - x1, z2 - z1);
      if (len < 2 || Math.abs(x2 - x1) < Math.abs(z2 - z1) * 2) continue; // tronçons est-ouest
      const ax = (x2 - x1) / len, az = (z2 - z1) / len;
      let nx = -az, nz = ax;
      if (nz < 0) { nx = -nx; nz = -nz; } // côté sud (+z)
      const off = roadHalf(r) + 3.2;
      for (let t = 1; t < len - 1; t += SW + 0.8) {
        out.push({ x: x1 + ax * t + nx * off, z: z1 + az * t + nz * off, yaw: Math.atan2(nx, nz) + Math.PI });
      }
    }
  }
  return out;
}

export function buildMarches(ctx, data) {
  if (!ctx.waterMask) return 0;
  const H = (x, z) => Math.max(0, ctx.terrainHeight(x, z));
  const blocked = (x, z) => ctx.waterMask.isWater(x, z) || ctx.onBridge?.(x, z) ||
    (ctx.colliders.nearby ? ctx.colliders.nearby(x, z, 2) : []).some((b) =>
      x + 1.8 > b.minX && x - 1.8 < b.maxX && z + 1.8 > b.minZ && z - 1.8 < b.maxZ && b.maxY - b.minY > 0.5);
  const markets = [
    { nom: 'Marché du quai Saint-Antoine', spots: quaiSaintAntoine(ctx, data) },
    { nom: 'Marché de la Croix-Rousse', spots: boulevardCroixRousse(ctx, data) },
  ];
  const all = [];
  for (const m of markets) {
    m.spots = m.spots.filter((s) => !blocked(s.x, s.z));
    // pas deux étals l'un sur l'autre (tronçons qui se chevauchent)
    const kept = [];
    for (const s of m.spots) if (kept.every((k) => Math.hypot(k.x - s.x, k.z - s.z) > SW)) kept.push(s);
    m.spots = kept;
    all.push(...kept);
    if (kept.length) {
      const mid = kept[kept.length >> 1];
      ctx.pois?.push({ id: 'marche-' + all.length, nom: m.nom, emoji: '🥕', x: mid.x, z: mid.z });
    }
  }
  if (!all.length) return 0;

  const rand = makeRand(6262);
  // local : x le long de l'étal, z vers le client (+z), y vers le haut
  const frame = mergeGeometries([
    ...[-1, 1].flatMap((sx) => [-1, 1].map((sz) =>
      colored(new THREE.CylinderGeometry(0.035, 0.035, 2.4, 5).translate(sx * (SW / 2 - 0.05), 1.2, sz * (SD / 2 - 0.05)), 0x8a8f96))),
    colored(new THREE.BoxGeometry(SW - 0.3, 0.05, 0.9).translate(0, 0.82, 0.45), 0x9a7a52),   // plateau
    colored(new THREE.BoxGeometry(SW - 0.4, 0.78, 0.04).translate(0, 0.41, 0.88), 0xe8e0cc),  // nappe tombante
    ...[-1, 1].map((sx) => colored(new THREE.BoxGeometry(0.05, 0.8, 0.8).translate(sx * (SW / 2 - 0.3), 0.4, 0.45), 0x6b5a46)),
  ]);
  // bâche à deux pans, rayures en couleur d'instance
  const roof = (() => {
    const g = new THREE.PlaneGeometry(SW + 0.2, SD * 0.62, 1, 1);
    const a = g.clone().rotateX(-Math.PI / 2 - 0.42).translate(0, 2.55, -SD * 0.27);
    const b = g.clone().rotateX(-Math.PI / 2 + 0.42).translate(0, 2.55, SD * 0.27);
    const m = mergeGeometries([a.toNonIndexed(), b.toNonIndexed()]);
    const uv = m.attributes.uv, p = m.attributes.position;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, p.getX(i) * 2.4, 0.5);
    return m;
  })();
  const stripe = (() => {
    const c = document.createElement('canvas');
    c.width = 32; c.height = 4;
    const g = c.getContext('2d');
    for (let i = 0; i < 4; i++) { g.fillStyle = i % 2 ? '#ffffff' : '#f6f1e6'; g.fillRect(i * 8, 0, 8, 4); }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = THREE.RepeatWrapping;
    return t;
  })();
  // cagettes de produits (une boîte = une cagette pleine, couleur d'instance)
  const crate = mergeGeometries([
    colored(new THREE.BoxGeometry(0.5, 0.16, 0.36).translate(0, 0.08, 0), 0xb08a5a),
    colored(new THREE.BoxGeometry(0.46, 0.09, 0.32).translate(0, 0.17, 0), 0xffffff),
  ]);
  const PRODUCE = [0xd9332b, 0xf08a24, 0xf2c94c, 0x5aa03c, 0x8a3d8f, 0x3c8a3a, 0xe8d8b0, 0xc7472a, 0x9bc23f];
  const BACHE = [0xc23b3b, 0x2e6fb0, 0x2e8a5a, 0xd99a2a, 0x7a3b8f];
  const n = all.length;
  const frameMesh = new THREE.InstancedMesh(frame, new THREE.MeshLambertMaterial({ vertexColors: true }), n);
  const roofMesh = new THREE.InstancedMesh(roof, new THREE.MeshLambertMaterial({ map: stripe, side: THREE.DoubleSide }), n);
  const crateMesh = new THREE.InstancedMesh(crate, new THREE.MeshLambertMaterial({ vertexColors: true }), n * 6);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1);
  const UP = new THREE.Vector3(0, 1, 0), col = new THREE.Color(), off = new THREE.Vector3();
  let nc = 0;
  all.forEach((s, i) => {
    s.y = H(s.x, s.z);
    q.setFromAxisAngle(UP, s.yaw);
    m.compose(v.set(s.x, s.y, s.z), q, one);
    frameMesh.setMatrixAt(i, m);
    roofMesh.setMatrixAt(i, m);
    roofMesh.setColorAt(i, col.set(BACHE[Math.floor(rand() * BACHE.length)]));
    // deux rangées de cagettes sur le plateau, un peu de désordre
    for (let k = 0; k < 6; k++) {
      off.set(-SW / 2 + 0.55 + (k % 3) * 1.05 + (rand() - 0.5) * 0.08, 0.85, 0.25 + Math.floor(k / 3) * 0.42).applyQuaternion(q);
      m.compose(v.set(s.x + off.x, s.y + off.y, s.z + off.z), q, one);
      crateMesh.setMatrixAt(nc, m);
      // la couleur d'instance teinte le dessus (produits) ET la caisse :
      // on garde la caisse lisible en éclaircissant
      crateMesh.setColorAt(nc++, col.set(PRODUCE[Math.floor(rand() * PRODUCE.length)]).lerp(new THREE.Color(0xffffff), 0.1));
    }
    const hx = SW / 2 + 0.1, hz = 0.5;
    const cx = s.x + Math.sin(s.yaw) * 0.45, cz = s.z + Math.cos(s.yaw) * 0.45;
    const ex = Math.abs(Math.cos(s.yaw)) * hx + Math.abs(Math.sin(s.yaw)) * hz;
    const ez = Math.abs(Math.sin(s.yaw)) * hx + Math.abs(Math.cos(s.yaw)) * hz;
    ctx.colliders.push({ minX: cx - ex, maxX: cx + ex, minZ: cz - ez, maxZ: cz + ez, minY: s.y, maxY: s.y + 0.9 });
  });
  crateMesh.count = nc;
  for (const mesh of [frameMesh, roofMesh, crateMesh]) {
    mesh.castShadow = true;
    mesh.name = 'marches';
    ctx.scene.add(mesh);
  }
  // quelques marchands derrière leurs étals (les plus centraux)
  const vendors = [];
  const SHIRTS = [0xe8e3d8, 0x2f6fb5, 0x6a9a4c, 0xc8423a, 0x3c8d8a];
  for (const mk of markets) {
    const sp = mk.spots;
    for (let k = 0; k < Math.min(5, sp.length); k++) {
      const s = sp[Math.floor((k + 0.5) * sp.length / Math.min(5, sp.length))];
      const h = buildHuman({ shirt: SHIRTS[k % SHIRTS.length], pants: 0x39404e });
      h.group.position.set(s.x - Math.sin(s.yaw) * 0.6, s.y, s.z - Math.cos(s.yaw) * 0.6);
      h.group.rotation.y = s.yaw + Math.PI;
      h.group.userData.baseY = s.y;
      h.armL.rotation.x = h.armR.rotation.x = -0.35;
      h.foreL.rotation.x = h.foreR.rotation.x = 0.9;
      ctx.scene.add(h.group);
      vendors.push(h.group);
    }
  }
  // installés le jour, remballés la nuit
  ctx.updatables.push(() => {
    const on = (ctx.env?.daylight ?? 1) > 0.35;
    frameMesh.visible = roofMesh.visible = crateMesh.visible = on;
    for (const g of vendors) g.visible = on;
  });
  // le cri du marché (E près d'un marchand)
  const CRIS = ['🥕 « Elles sont belles mes tomates, elles sont belles ! »',
    '🍐 « Allez ma p’tite dame, goûtez-moi ces poires ! »',
    '🧀 « Saint-Marcellin bien coulant, pour les gones gourmands ! »',
    '🍒 « Deux barquettes achetées, la troisième c’est cadeau ! »'];
  for (const g of vendors) {
    ctx.interactables?.push({
      x: g.position.x, z: g.position.z, r: 2.6, label: 'E — Causer avec le marchand',
      action: () => {
        const pick = () => CRIS[Math.floor(Date.now() / 20000) % CRIS.length];
        if (ctx.talkTo?.('marchand', {
          title: 'Jojo, marchand du marché', emoji: '🥕',
          greet: 'Approchez, approchez ! Qu’est-ce qui vous ferait plaisir ?', fallback: pick,
        })) return;
        ctx.notify?.(pick());
      },
    });
  }
  return all.length;
}
