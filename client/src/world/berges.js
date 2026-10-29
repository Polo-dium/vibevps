import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { WATER_Y } from './city.js';
import { riverCx, makeRand } from './layout.js';
import { edgeDist, insidePoly } from './passerelles.js';

// LES BERGES DU RHÔNE (ville OSM) : la rive gauche, quai Victor-Augagneur,
// c'est la file des péniches amarrées — bars, restaurants, salles de
// concert — avec leurs terrasses sur le pont, leurs guirlandes qui
// s'allument le soir et leur passerelle jetée sur le quai. On les aligne le
// long du vrai bord de l'eau (polygones OSM), dans le sens du courant.
//   - 3 modèles de péniche (géométrie fusionnée, couleurs par sommet) en
//     InstancedMesh : quelques draw calls pour toute la file ;
//   - guirlandes : un seul nuage de points additifs, allumé la nuit ;
//   - bollards d'amarrage et passerelles sur le quai.
// Placement déterministe (seed fixe) : même file chez tout le monde.

const L = 21, W = 4.3; // longueur / largeur d'une péniche (m jeu)

function part(parts, geo, x, y, z, hex, ry = 0) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  if (ry) g.rotateY(ry);
  g.translate(x, y, z);
  const c = new THREE.Color(hex), n = g.attributes.position.count;
  const a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  if (g.attributes.uv) g.deleteAttribute('uv');
  parts.push(g);
}

// Coque à étrave relevée : profil extrudé sur la largeur (axe z = longueur)
function hullGeo() {
  const s = new THREE.Shape();
  const h = 1.6;
  s.moveTo(-L / 2 + 0.6, -0.6);
  s.lineTo(L / 2 - 2.4, -0.6);
  s.quadraticCurveTo(L / 2, -0.4, L / 2, h); // étrave
  s.lineTo(-L / 2, h);
  s.lineTo(-L / 2, 0);
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: W, bevelEnabled: false, curveSegments: 6 });
  g.translate(0, 0, -W / 2);
  g.rotateY(Math.PI / 2); // longueur le long de z
  return g;
}

// Trois péniches lyonnaises : bar à terrasse, péniche-restaurant vitrée,
// salle de concert à la timonerie peinte
function bargeGeometry(kind) {
  const parts = [];
  const HULL = [0x1f2a33, 0x5a1f22, 0x24384a][kind];
  const CAB = [0xe8e0cc, 0xf1ede2, 0x2f6b5f][kind];
  part(parts, hullGeo(), 0, 0, 0, HULL);
  // liston clair le long de la coque (ligne de flottaison)
  part(parts, new THREE.BoxGeometry(W + 0.06, 0.18, L - 2.2), 0, 0.05, -0.9, 0xd8d0bf);
  // pont en bois
  part(parts, new THREE.BoxGeometry(W - 0.2, 0.12, L - 1.6), 0, 1.62, -0.6, 0x8a6a48);
  if (kind === 0) {
    // bar : cabine basse à l'arrière, terrasse couverte d'un velum à l'avant
    part(parts, new THREE.BoxGeometry(W - 0.6, 2, 7), 0, 2.68, -5.6, CAB);
    part(parts, new THREE.BoxGeometry(W - 0.4, 0.14, 7.4), 0, 3.75, -5.6, 0x3a3a3a);
    for (let i = 0; i < 4; i++) part(parts, new THREE.BoxGeometry(0.06, 0.8, 1.1), W / 2 - 0.29, 2.9, -8.2 + i * 1.75, 0x2a3540);
    for (const sx of [-1, 1]) for (const sz of [0.6, 6.6]) part(parts, new THREE.CylinderGeometry(0.05, 0.05, 2.2, 5), sx * (W / 2 - 0.35), 2.8, sz, 0x2a2a2a);
    const velum = new THREE.BoxGeometry(W - 0.3, 0.06, 6.6);
    part(parts, velum, 0, 3.9, 3.6, 0xc23b3b);
    // tables et tabourets de la terrasse
    for (let i = 0; i < 3; i++) {
      part(parts, new THREE.CylinderGeometry(0.4, 0.4, 0.06, 10), 0, 2.45, 1.6 + i * 2, 0xd9d2c4);
      part(parts, new THREE.CylinderGeometry(0.05, 0.05, 0.75, 5), 0, 2.05, 1.6 + i * 2, 0x2a2a2a);
    }
  } else if (kind === 1) {
    // restaurant : longue cabine vitrée sur presque toute la longueur
    part(parts, new THREE.BoxGeometry(W - 0.5, 2.1, 14), 0, 2.73, -1.2, CAB);
    for (const sx of [-1, 1]) part(parts, new THREE.BoxGeometry(0.04, 1.1, 13), sx * (W / 2 - 0.24), 2.95, -1.2, 0x324656);
    part(parts, new THREE.BoxGeometry(W - 0.3, 0.16, 14.6), 0, 3.85, -1.2, 0x55606a);
  } else {
    // salle de concert : timonerie haute, cale couverte d'un toit arrondi
    part(parts, new THREE.BoxGeometry(2.8, 2.4, 2.8), 0, 2.9, -7.6, CAB);
    part(parts, new THREE.BoxGeometry(3.2, 0.14, 3.2), 0, 4.15, -7.6, 0x222222);
    const vault = new THREE.CylinderGeometry(W / 2 - 0.25, W / 2 - 0.25, 11, 14, 1, false, 0, Math.PI);
    vault.rotateZ(Math.PI / 2);
    vault.rotateY(Math.PI / 2);
    part(parts, vault, 0, 1.7, 0.8, 0x3c3f46);
    for (const sx of [-1, 1]) part(parts, new THREE.BoxGeometry(0.06, 0.5, 9), sx * (W / 2 - 0.3), 2.5, 0.8, 0xc9a227); // bandeau doré
  }
  // garde-corps tubulaire autour du pont
  for (const sx of [-1, 1]) part(parts, new THREE.BoxGeometry(0.05, 0.05, L - 2), sx * (W / 2 - 0.1), 2.55, -0.6, 0x222222);
  // mât de pavillon à la poupe
  part(parts, new THREE.CylinderGeometry(0.04, 0.04, 2.4, 4), 0, 2.9, -L / 2 + 0.6, 0x222222);
  part(parts, new THREE.BoxGeometry(0.02, 0.5, 0.8), 0, 3.8, -L / 2 + 1.0, [0x1d4aa8, 0xd93a3a, 0xf0d040][kind]);
  return mergeGeometries(parts);
}

// BAS-PORTS DE LA RIVE GAUCHE : au pied du quai, une promenade basse au
// ras de l'eau (comme les berges réaménagées du Rhône) — piste de béton
// clair côté fleuve, bande de pelouse plantée contre le mur de quai,
// bordure de pierre. Posée sur les premiers mètres du lit (polygones OSM),
// praticable via ctx.terrainHeight. Renvoie sa largeur (0 si absente).
const BASPORT_W = 7;
const BASPORT_Y = -0.45; // ~1,15 m au-dessus de l'eau, marche de 45 cm depuis le quai
function buildBasPorts(ctx, rhone, polys) {
  const Z0 = -420, Z1 = 300, ST = 2;
  const edge = new Map(); // tranche de z → abscisse du bord de l'eau (rive gauche)
  const top = [], lawn = [], face = [];
  const trees = [];
  let prev = null;
  for (let z = Z0; z <= Z1; z += ST) {
    const cx = riverCx(rhone, z);
    if (!polys.some((r) => insidePoly(r, cx, z))) { prev = null; continue; }
    const e = edgeDist(polys, cx, z, 1, 0);
    if (!Number.isFinite(e) || e < BASPORT_W + 20) { prev = null; continue; }
    const xe = cx + e;
    edge.set(Math.round(z / ST), xe);
    if (prev) {
      const [za, xa] = prev;
      const quad = (arr, o0, o1, y) => arr.push(
        xa - o1, y, za, xe - o0, y, z, xe - o1, y, z,
        xa - o1, y, za, xa - o0, y, za, xe - o0, y, z
      );
      quad(top, 3.4, BASPORT_W, BASPORT_Y);         // piste côté fleuve
      quad(lawn, 0, 3.4, BASPORT_Y + 0.02);         // pelouse contre le quai
      // parement vertical côté eau, jusque sous la surface
      face.push(
        xa - BASPORT_W, BASPORT_Y, za, xe - BASPORT_W, -2.4, z, xe - BASPORT_W, BASPORT_Y, z,
        xa - BASPORT_W, BASPORT_Y, za, xa - BASPORT_W, -2.4, za, xe - BASPORT_W, -2.4, z
      );
    }
    if (Math.round(z) % 11 === 0) trees.push([xe - 1.7, z]);
    prev = [z, xe];
  }
  if (!top.length) return 0;
  const mk = (arr, color, name) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3));
    g.computeVertexNormals();
    // normales vers le haut quel que soit l'ordre (sauf le parement)
    const mesh = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ color, side: THREE.DoubleSide }));
    mesh.receiveShadow = true;
    mesh.name = name;
    ctx.scene.add(mesh);
    return mesh;
  };
  mk(top, 0xc9c2b2, 'bas-port-piste');
  const lawnMesh = mk(lawn, 0x5c8a45, 'bas-port-pelouse');
  lawnMesh.material.userData.noSeason = true;
  mk(face, 0x9a917f, 'bas-port-parement');
  // platanes du bas-port (troncs + houppiers instanciés)
  const trunk = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.16, 0.22, 3, 6).translate(0, 1.5, 0),
    new THREE.MeshLambertMaterial({ color: 0x6b5a48 }), trees.length);
  const crown = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1.9, 1).translate(0, 4.2, 0),
    new THREE.MeshLambertMaterial({ color: 0x5f8a3e, flatShading: true }), trees.length);
  const m = new THREE.Matrix4(), c = new THREE.Color();
  trees.forEach(([x, z], i) => {
    m.makeTranslation(x, BASPORT_Y, z);
    trunk.setMatrixAt(i, m);
    crown.setMatrixAt(i, m);
    c.setHSL(0.27 + ((i * 37) % 10) * 0.006, 0.4, 0.3 + ((i * 13) % 7) * 0.015);
    crown.setColorAt(i, c);
  });
  trunk.castShadow = crown.castShadow = true;
  ctx.scene.add(trunk, crown);
  // on marche sur le bas-port
  const at = (x, z) => {
    const xe = edge.get(Math.round(z / ST));
    return xe != null && x <= xe + 0.3 && x >= xe - BASPORT_W ? BASPORT_Y : null;
  };
  ctx.basPortAt = at;
  const natural = ctx.terrainHeight;
  ctx.terrainHeight = (x, z) => at(x, z) ?? natural(x, z);
  return BASPORT_W;
}

export function buildBerges(ctx, data) {
  const mask = ctx.waterMask, polys = data.waterPolys;
  if (!mask || !polys?.length) return null;
  // Le Rhône = le plus large des deux fleuves
  const rhone = [...data.water].sort((a, b) => (b.maxX - b.minX) - (a.maxX - a.minX))[0];
  if (!rhone?.cx) return null;
  const rand = makeRand(4703);
  const ground = (x, z) => Math.max(0, ctx.terrainHeight(x, z));
  // Les bas-ports (promenade basse au ras de l'eau) d'abord : les péniches
  // s'amarrent contre leur bord
  const BW = buildBasPorts(ctx, rhone, polys);
  // Rive gauche, du pont Lafayette au sud de la Guillotière (quai Augagneur)
  const Z0 = -300, Z1 = 230, STEP = L + 9;
  const spots = [];
  for (let z = Z0; z < Z1; z += STEP) {
    const zc = z + (rand() - 0.5) * 4;
    const kind = Math.floor(rand() * 3);
    const cx = riverCx(rhone, zc);
    if (!polys.some((r) => insidePoly(r, cx, zc))) continue;
    const e = edgeDist(polys, cx, zc, 1, 0);
    if (!Number.isFinite(e)) continue;
    // sens du courant (tangente au tracé)
    const tx = riverCx(rhone, zc + 6) - riverCx(rhone, zc - 6), tz = 12;
    const tl = Math.hypot(tx, tz);
    const ax = tx / tl, az = tz / tl;
    // pas sous un pont ni contre une passerelle
    const bx = cx + e - BW - (W / 2 + 0.7);
    if ((ctx.realBridges ?? []).some((d) => Math.hypot(d.cx - bx, d.cz - zc) < d.halfW + L * 0.7 + 4)) continue;
    if (ctx.onBridge?.(bx, zc) || ctx.onBridge?.(bx + az * 8, zc + 10) || ctx.onBridge?.(bx, zc - 10)) continue;
    const qx = cx + e + 2.2; // quai
    // (polygones exacts : le masque à 4 m déborde sur le quai)
    if (polys.some((r) => insidePoly(r, qx, zc))) continue;
    spots.push({ x: bx, z: zc, ax, az, kind, qx, qy: ground(qx, zc) });
  }
  if (!spots.length) return null;

  const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), one = new THREE.Vector3(1, 1, 1), v = new THREE.Vector3();
  const UP = new THREE.Vector3(0, 1, 0);
  const bulbs = [], bulbCol = [];
  const quai = [];
  const instances = [];
  for (let kind = 0; kind < 3; kind++) {
    const mine = spots.filter((s) => s.kind === kind);
    if (!mine.length) continue;
    const mesh = new THREE.InstancedMesh(bargeGeometry(kind), mat, mine.length);
    mine.forEach((s, i) => {
      s.yaw = Math.atan2(s.ax, s.az);
      q.setFromAxisAngle(UP, s.yaw);
      m.compose(v.set(s.x, WATER_Y - 0.55, s.z), q, one);
      mesh.setMatrixAt(i, m);
      instances.push({ mesh, i, s });
    });
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.name = 'peniches-amarrees';
    mesh.userData.noCull = true;
    ctx.scene.add(mesh);
  }
  const C = [0xffd27a, 0xff7a5a, 0x9ad8ff, 0xffe9b0];
  for (const s of spots) {
    const ca = Math.cos(s.yaw), sa = Math.sin(s.yaw);
    const P = (lx, ly, lz) => [s.x + lx * ca + lz * sa, ly, s.z - lx * sa + lz * ca];
    // guirlande : deux festons de la poupe à la proue, de chaque bord
    const deckY = WATER_Y - 0.55 + 1.7;
    for (const sx of [-1, 1]) {
      for (let k = 0; k <= 22; k++) {
        const t = k / 22, lz = -L / 2 + 1 + t * (L - 2);
        const sag = Math.sin(((t * 4) % 1) * Math.PI) * 0.35;
        bulbs.push(...P(sx * (W / 2 - 0.15), deckY + 2.3 - sag, lz));
        const c = new THREE.Color(C[(k + (sx > 0 ? 1 : 0)) % C.length]);
        bulbCol.push(c.r, c.g, c.b);
      }
    }
    // passerelle du pont au quai + deux bollards
    const [gx0, , gz0] = P(W / 2 - 0.2, 0, 2);
    // la passerelle rejoint le bas-port (ou le quai s'il n'y en a pas ici)
    const lowX = ctx.basPortAt?.(s.qx - BW - 1, gz0) != null ? s.qx - 2.2 - BW + 1.2 : s.qx;
    const lowY = lowX !== s.qx ? BASPORT_Y : s.qy;
    quai.push({ x0: gx0, z0: gz0, y0: deckY + 0.05, x1: lowX, z1: gz0, y1: lowY + 0.05 });
    for (const lz of [-L / 2 + 2, L / 2 - 3]) {
      const [, , z] = P(0, 0, lz);
      quai.push({ bollard: true, x: lowX - 0.9 + (lowX !== s.qx ? 1.6 : 0), z, y: lowY });
    }
  }
  // passerelles (planches + mains courantes) et bollards : un maillage
  const parts = [];
  for (const g of quai) {
    if (g.bollard) {
      part(parts, new THREE.CylinderGeometry(0.18, 0.22, 0.55, 8), g.x, g.y + 0.27, g.z, 0x2b2b2b);
      part(parts, new THREE.CylinderGeometry(0.26, 0.26, 0.08, 8), g.x, g.y + 0.56, g.z, 0x2b2b2b);
      continue;
    }
    const dx = g.x1 - g.x0, dz = g.z1 - g.z0, dy = g.y1 - g.y0;
    const len = Math.hypot(dx, dz);
    if (len < 0.5 || len > 10) continue;
    const plank = new THREE.BoxGeometry(1.1, 0.08, Math.hypot(len, dy));
    plank.rotateX(-Math.atan2(dy, len));
    plank.rotateY(Math.atan2(dx, dz));
    part(parts, plank, (g.x0 + g.x1) / 2, (g.y0 + g.y1) / 2, (g.z0 + g.z1) / 2, 0x7a6248);
    for (const sv of [-0.55, 0.55]) {
      const r = new THREE.BoxGeometry(0.04, 0.04, Math.hypot(len, dy));
      r.rotateX(-Math.atan2(dy, len));
      r.rotateY(Math.atan2(dx, dz));
      part(parts, r, (g.x0 + g.x1) / 2 + (dz / len) * sv, (g.y0 + g.y1) / 2 + 0.95, (g.z0 + g.z1) / 2 - (dx / len) * sv, 0x222222);
    }
  }
  if (parts.length) {
    const mesh = new THREE.Mesh(mergeGeometries(parts), new THREE.MeshLambertMaterial({ vertexColors: true }));
    mesh.castShadow = true;
    mesh.name = 'berges-passerelles';
    ctx.scene.add(mesh);
  }
  // guirlandes : points additifs, éteints le jour
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(bulbs, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(bulbCol, 3));
  // ampoule : halo rond (sans texture, les points sortaient en carrés)
  const dot = document.createElement('canvas');
  dot.width = dot.height = 32;
  const dg = dot.getContext('2d');
  const grd = dg.createRadialGradient(16, 16, 0, 16, 16, 16);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.25, 'rgba(255,255,255,0.8)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  dg.fillStyle = grd;
  dg.fillRect(0, 0, 32, 32);
  const pm = new THREE.PointsMaterial({
    map: new THREE.CanvasTexture(dot),
    size: 0.45, vertexColors: true, transparent: true, opacity: 0,
    blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true,
  });
  const pts = new THREE.Points(geo, pm);
  pts.name = 'guirlandes';
  pts.frustumCulled = false;
  ctx.scene.add(pts);
  ctx.updatables.push(() => {
    const n = ctx.env?.night ?? 0;
    pm.opacity = Math.max(0, n * 1.2 - 0.15);
    pts.visible = pm.opacity > 0.01;
  });
  // les péniches dansent un peu sur l'eau (une mise à jour tous les 3 frames)
  let tick = 0;
  ctx.updatables.push(() => {
    if (++tick % 3) return;
    const t = performance.now() / 1000;
    const dirty = new Set();
    for (const { mesh, i, s } of instances) {
      q.setFromAxisAngle(UP, s.yaw);
      m.compose(v.set(s.x, WATER_Y - 0.55 + Math.sin(t * 0.8 + s.z) * 0.05, s.z), q, one);
      mesh.setMatrixAt(i, m);
      dirty.add(mesh);
    }
    for (const mesh of dirty) mesh.instanceMatrix.needsUpdate = true;
  });
  ctx.pois?.push({ id: 'peniches', nom: 'Les péniches du quai Augagneur', emoji: '🛥️', x: spots[spots.length >> 1].x, z: spots[spots.length >> 1].z });
  return spots.length;
}
