import * as THREE from 'three';

// DÉCOUPAGE EN TUILES DES MAILLAGES À L'ÉCHELLE DE LA VILLE.
// Pavés, trottoirs, murs et haies des jardins, escaliers, sol… sont chacun
// UN maillage fusionné de 40 000 à 200 000 triangles qui couvre toute la
// carte : sa sphère englobante contient toujours la caméra, il n'est donc
// JAMAIS trié — le GPU en traite chaque triangle à chaque image (et une
// seconde fois dans la carte d'ombre), même ceux qui sont à 2 km dans le dos.
// Ici, juste avant le premier rendu, chacun est redistribué en tuiles
// carrées (mêmes matériau, drapeaux d'ombre et userData) : three.js ne
// dessine plus que celles qui sont dans le champ, et la carte d'ombre celles
// qui touchent sa boîte de 190 m. Plus de draw calls, beaucoup moins de
// triangles. L'original quitte la scène mais reste vivant (les références
// que le monde garde vers lui — hauteur du sol, tags — continuent de marcher).
// Tuiles de 520 m : mesuré à Bellecour, des tuiles de 260 m ajoutaient 400
// draw calls pour 0,5 M de triangles en moins — trop cher côté processeur.
const allTiles = [];

export function tileBigMeshes(scene, { minTris = 30000, minRadius = 350, size = 520, lists = [] } = {}) {
  let split = 0, made = 0;
  for (const o of [...scene.children]) {
    if (!o.isMesh || o.isInstancedMesh || o.isSkinnedMesh || Array.isArray(o.material)) continue;
    if (o.userData.cityTile || o.userData.noTile || o.children.length) continue;
    const g = o.geometry;
    const pos = g?.attributes?.position;
    if (!pos || pos.isInterleavedBufferAttribute) continue;
    if ((g.groups?.length ?? 0) > 1 || Object.keys(g.morphAttributes ?? {}).length) continue;
    const idx = g.index?.array ?? null;
    const nTri = (idx ? idx.length : pos.count) / 3;
    if (nTri < minTris) continue;
    if (!g.boundingSphere) g.computeBoundingSphere();
    if (g.boundingSphere.radius < minRadius) continue;
    const names = Object.keys(g.attributes);
    if (names.some((n) => g.attributes[n].isInterleavedBufferAttribute)) continue;

    // Triangles rangés par tuile (d'après leur centre, en x/z)
    const P = pos.array, st = pos.itemSize;
    const buckets = new Map();
    for (let t = 0; t < nTri; t++) {
      const a = idx ? idx[t * 3] : t * 3, b = idx ? idx[t * 3 + 1] : t * 3 + 1, c = idx ? idx[t * 3 + 2] : t * 3 + 2;
      const cx = (P[a * st] + P[b * st] + P[c * st]) / 3;
      const cz = (P[a * st + 2] + P[b * st + 2] + P[c * st + 2]) / 3;
      const key = Math.floor(cx / size) * 4096 + Math.floor(cz / size);
      let list = buckets.get(key);
      if (!list) buckets.set(key, list = []);
      list.push(a, b, c);
    }
    if (buckets.size < 3) continue;

    const tiles = [];
    for (const verts of buckets.values()) {
      // sommets compactés : chaque tuile ne garde que les siens
      const remap = new Map();
      const order = [];
      const index = new (verts.length > 65535 ? Uint32Array : Uint16Array)(verts.length);
      for (let i = 0; i < verts.length; i++) {
        let k = remap.get(verts[i]);
        if (k === undefined) { k = order.length; remap.set(verts[i], k); order.push(verts[i]); }
        index[i] = k;
      }
      const geo = new THREE.BufferGeometry();
      for (const name of names) {
        const src = g.attributes[name], n = src.itemSize;
        const arr = new src.array.constructor(order.length * n);
        for (let i = 0; i < order.length; i++) {
          const s = order[i] * n;
          for (let j = 0; j < n; j++) arr[i * n + j] = src.array[s + j];
        }
        geo.setAttribute(name, new THREE.BufferAttribute(arr, n, src.normalized));
      }
      geo.setIndex(new THREE.BufferAttribute(index, 1));
      geo.computeBoundingSphere();
      const m = new THREE.Mesh(geo, o.material);
      m.name = o.name;
      m.userData = { ...o.userData, tileOf: o };
      m.castShadow = o.castShadow;
      m.receiveShadow = o.receiveShadow;
      m.renderOrder = o.renderOrder;
      m.position.copy(o.position);
      m.quaternion.copy(o.quaternion);
      m.scale.copy(o.scale);
      m.customDepthMaterial = o.customDepthMaterial;
      m.onBeforeRender = o.onBeforeRender;
      scene.add(m);
      tiles.push(m);
      allTiles.push(m);
    }
    scene.remove(o);
    o.userData.tiles = tiles;
    // listes de cibles (tags, tirs) : les tuiles remplacent l'original
    for (const list of lists) {
      const i = list?.indexOf?.(o) ?? -1;
      if (i >= 0) list.splice(i, 1, ...tiles);
    }
    split++;
    made += tiles.length;
  }
  return { split, made };
}

// Tuiles au-delà de la portée de vue (noyées dans la brume) : masquées.
// À appeler de temps en temps (2 fois par seconde suffisent).
const _c = new THREE.Vector3();
export function cullTiles(p, viewDistance) {
  for (const m of allTiles) {
    const bs = m.geometry.boundingSphere;
    _c.copy(bs.center).applyMatrix4(m.matrixWorld);
    const d = Math.hypot(_c.x - p.x, _c.z - p.z) - bs.radius;
    const on = d < viewDistance;
    if (m.visible !== on) m.visible = on;
  }
}
