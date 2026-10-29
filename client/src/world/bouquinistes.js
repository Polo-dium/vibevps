import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { riverCx, makeRand } from './layout.js';
import { edgeDist, insidePoly } from './passerelles.js';

// LES BOUQUINISTES DU QUAI DE LA PÊCHERIE (ville OSM) : sur la rive
// Presqu'île de la Saône, face au Vieux Lyon, une file de boîtes vertes
// posées contre le parapet. Le jour (et le week-end en vrai…) elles sont
// ouvertes : couvercle relevé, livres alignés, quelques cartes postales ;
// le soir elles se referment. Tout est instancié : 4 draw calls.
// Placement déterministe le long du vrai bord de l'eau (polygones OSM).

const BW = 2.0, BD = 0.75; // boîte : longueur le long du quai, profondeur

function colored(geo, hex) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const c = new THREE.Color(hex), n = g.attributes.position.count;
  const a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  if (g.attributes.uv) g.deleteAttribute('uv');
  return g;
}

// Tranches de livres : bandes de couleurs serrées (texture canvas)
function booksTexture() {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 64;
  const g = c.getContext('2d');
  const rand = makeRand(5150);
  const COLS = ['#7a2e2a', '#2c4a6e', '#c9a227', '#3b5d3a', '#e8e0cc', '#5a3a6e', '#a8543c', '#20242c', '#d9c08a'];
  let x = 0;
  while (x < 256) {
    const w = 3 + rand() * 7;
    g.fillStyle = COLS[Math.floor(rand() * COLS.length)];
    g.fillRect(x, 6 + rand() * 6, w - 0.6, 58);
    g.fillStyle = 'rgba(255,255,255,0.25)';
    g.fillRect(x + w * 0.3, 20 + rand() * 20, w * 0.4, 2);
    x += w;
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  return t;
}

export function buildBouquinistes(ctx, data) {
  const polys = data.waterPolys;
  if (!ctx.waterMask || !polys?.length) return 0;
  const saone = [...data.water].sort((a, b) => a.minX - b.minX)[0];
  if (!saone?.cx) return 0;
  const ground = (x, z) => Math.max(0, ctx.terrainHeight(x, z));
  const rand = makeRand(8821);
  // Quai de la Pêcherie : du pont de la Feuillée vers le sud (Presqu'île)
  const Z0 = -480, Z1 = -315, STEP = BW + 0.9;
  const spots = [];
  for (let z = Z0; z < Z1; z += STEP) {
    const cx = riverCx(saone, z);
    if (!polys.some((r) => insidePoly(r, cx, z))) continue;
    const e = edgeDist(polys, cx, z, 1, 0); // bord de l'eau côté Presqu'île
    if (!Number.isFinite(e)) continue;
    const x = cx + e + 1.15; // contre le parapet, sur le trottoir du quai
    if (ctx.onBridge?.(x - 2, z) || (ctx.realBridges ?? []).some((d) => Math.hypot(d.cx - x, d.cz - z) < d.halfW + 14)) continue;
    if (polys.some((r) => insidePoly(r, x, z))) continue;
    // pas sur un escalier de passerelle ni un collider existant
    if ((ctx.colliders.nearby ? ctx.colliders.nearby(x, z, 1.5) : []).some((b) =>
      x + 1.1 > b.minX && x - 1.1 < b.maxX && z + 1.1 > b.minZ && z - 1.1 < b.maxZ)) continue;
    if (rand() < 0.12) continue; // une place vide de temps en temps
    // le quai suit la rive : orientation de la tangente
    const tx = riverCx(saone, z + 4) - riverCx(saone, z - 4);
    spots.push({ x, z, y: ground(x, z), yaw: Math.atan2(tx, 8) });
  }
  if (!spots.length) return 0;

  const green = 0x1f4a35, dark = 0x173527;
  // caisse + pieds
  const body = mergeGeometries([
    colored(new THREE.BoxGeometry(BD, 0.62, BW).translate(0, 0.95, 0), green),
    colored(new THREE.BoxGeometry(BD + 0.04, 0.05, BW + 0.04).translate(0, 1.27, 0), dark),
    ...[-1, 1].flatMap((sx) => [-1, 1].map((sz) =>
      colored(new THREE.BoxGeometry(0.06, 0.64, 0.06).translate(sx * (BD / 2 - 0.05), 0.32, sz * (BW / 2 - 0.06)), dark))),
  ]);
  // couvercle ouvert : relevé côté parapet (vers la rivière, -x local)
  const lidOpen = colored(new THREE.BoxGeometry(0.05, 0.6, BW).translate(-BD / 2 - 0.02, 1.6, 0), green);
  lidOpen.rotateZ(0); // vertical, adossé au fond
  const lidClosed = colored(new THREE.BoxGeometry(BD + 0.06, 0.06, BW + 0.04).translate(0, 1.32, 0), green);
  // rangée de livres sur le dessus (ouvert)
  const books = new THREE.BoxGeometry(BD - 0.12, 0.18, BW - 0.1).translate(0, 1.36, 0);
  const bmat = new THREE.MeshLambertMaterial({ map: booksTexture() });
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
  const meshes = {
    body: new THREE.InstancedMesh(body, mat, spots.length),
    open: new THREE.InstancedMesh(lidOpen, mat, spots.length),
    closed: new THREE.InstancedMesh(lidClosed, mat, spots.length),
    books: new THREE.InstancedMesh(books, bmat, spots.length),
  };
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1);
  const UP = new THREE.Vector3(0, 1, 0);
  spots.forEach((s, i) => {
    q.setFromAxisAngle(UP, s.yaw);
    m.compose(v.set(s.x, s.y, s.z), q, one);
    for (const mesh of Object.values(meshes)) mesh.setMatrixAt(i, m);
    const hx = 0.45, hz = 1.05;
    ctx.colliders.push({ minX: s.x - hx, maxX: s.x + hx, minZ: s.z - hz, maxZ: s.z + hz, minY: s.y, maxY: s.y + 1.3 });
  });
  for (const [k, mesh] of Object.entries(meshes)) {
    mesh.castShadow = true;
    mesh.name = 'bouquinistes-' + k;
    ctx.scene.add(mesh);
  }
  // ouvertes de jour, fermées la nuit
  ctx.updatables.push(() => {
    const open = (ctx.env?.daylight ?? 1) > 0.35;
    meshes.open.visible = meshes.books.visible = open;
    meshes.closed.visible = !open;
  });
  const mid = spots[spots.length >> 1];
  ctx.pois?.push({ id: 'bouquinistes', nom: 'Bouquinistes du quai de la Pêcherie', emoji: '📚', x: mid.x, z: mid.z });
  ctx.interactables?.push({
    x: mid.x, z: mid.z, r: 3, label: 'E — Fouiller chez le bouquiniste',
    action: () => {
      const T = ['« Les Mystères de Lyon », édition de 1890 — 3 €, pour toi gone.',
        'Un vieux Guignol illustré… Gnafron a l’air déjà pompette.',
        '« Recettes de la Mère Brazier » — la quenelle, la vraie.',
        'Une carte postale de la Croix-Rousse en 1905. Les canuts te saluent.'];
      const pick = () => T[Math.floor(Date.now() / 60000) % T.length];
      if (ctx.talkTo?.('bouquiniste', {
        title: 'Monsieur Gaspard, bouquiniste', emoji: '📚',
        greet: 'Bonjour. Vous cherchez un livre, ou une histoire de Lyon ?', fallback: pick,
      })) return;
      ctx.notify?.('📚 ' + pick());
    },
  });
  return spots.length;
}
