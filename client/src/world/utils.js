import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// APLATISSEMENT PAR COULEURS DE SOMMETS
//
// Un objet fait de N petites pièces de couleurs différentes coûte N draw
// calls. En cuisant la couleur de chaque pièce dans ses sommets, tout tient
// dans UN seul mesh, donc UN draw call — c'est le levier principal sur les
// objets répétés du décor (humains, voitures, terrasses).
//
// Ne prend que les pièces « simples » (matériau uni, sans texture ni
// émissif) : le reste est laissé tel quel par l'appelant, car une texture
// ou une lueur ne se cuit pas dans une couleur de sommet.
// `source` : un tableau de meshes, ou un objet (groupe) dont on prend tout
// le sous-arbre. Les transformations sont figées par rapport à la racine.
export function flattenColored(source, { material } = {}) {
  const geos = [];
  const c = new THREE.Color();
  const meshes = [];
  for (const root of (Array.isArray(source) ? source : [source])) {
    root.updateMatrixWorld(true);
    root.traverse((o) => { if (o.isMesh && !o.isInstancedMesh) meshes.push(o); });
  }
  for (const m of meshes) {
    const mat = Array.isArray(m.material) ? m.material[0] : m.material;
    if (!m.geometry || !mat?.color || mat.map || mat.emissiveMap) continue;
    // Non-indexé pour que toutes les géométries aient la même structure
    // (mergeGeometries refuse un mélange indexé / non indexé).
    const g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone();
    g.applyMatrix4(m.matrixWorld);
    // On ne garde que position + normal : les UV n'ont plus de sens une fois
    // des pièces disparates réunies, et leur absence uniformise la fusion.
    for (const name of Object.keys(g.attributes)) {
      if (name !== 'position' && name !== 'normal') g.deleteAttribute(name);
    }
    if (!g.attributes.normal) g.computeVertexNormals();
    c.copy(mat.color);
    const n = g.attributes.position.count;
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geos.push(g);
  }
  if (!geos.length) return null;
  const merged = geos.length === 1 ? geos[0] : mergeGeometries(geos);
  if (!merged) return null;
  return new THREE.Mesh(merged, material ?? new THREE.MeshLambertMaterial({ vertexColors: true }));
}

// Crée un mesh boîte + son collider AABB, et l'enregistre dans le contexte monde.
// origin = centre au sol (y = bas de la boîte).
export function addBox(ctx, { x, y = 0, z, w, h, d, color = 0x888888, material, taggable = false, collider = true, emissive = 0x000000 }) {
  const geo = new THREE.BoxGeometry(w, h, d);
  const mat =
    material ??
    new THREE.MeshLambertMaterial({ color, emissive });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(x, y + h / 2, z);
  ctx.scene.add(mesh);
  if (collider) {
    ctx.colliders.push({
      minX: x - w / 2, maxX: x + w / 2,
      minY: y, maxY: y + h,
      minZ: z - d / 2, maxZ: z + d / 2,
    });
  }
  if (taggable) {
    mesh.userData.taggable = true;
    ctx.taggables.push(mesh);
  }
  return mesh;
}

export function addInvisibleWall(ctx, { x, y = 0, z, w, h, d }) {
  ctx.colliders.push({
    minX: x - w / 2, maxX: x + w / 2,
    minY: y, maxY: y + h,
    minZ: z - d / 2, maxZ: z + d / 2,
  });
}

// Texture canvas avec du texte néon (pour enseignes et écrans).
export function makeTextTexture(text, { color = '#00ffd5', bg = '#06070f', width = 512, height = 128, font = 'bold 72px "Courier New", monospace' } = {}) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const g = canvas.getContext('2d');
  g.fillStyle = bg;
  g.fillRect(0, 0, width, height);
  g.font = font;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.shadowColor = color;
  g.shadowBlur = 24;
  g.fillStyle = color;
  g.fillText(text, width / 2, height / 2 + 4);
  g.shadowBlur = 8;
  g.fillText(text, width / 2, height / 2 + 4);
  const tex = new THREE.CanvasTexture(canvas);
  tex.anisotropy = 4;
  return tex;
}

// Texture de façade : fenêtres allumées/éteintes.
export function makeWindowsTexture(baseColor = '#b9a88f') {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 256;
  const g = canvas.getContext('2d');
  g.fillStyle = baseColor;
  g.fillRect(0, 0, 128, 256);
  for (let y = 10; y < 246; y += 22) {
    for (let x = 10; x < 118; x += 20) {
      const lit = Math.random() < 0.22;
      g.fillStyle = lit ? '#ffd98a' : '#2a3140';
      g.fillRect(x, y, 11, 14);
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  return tex;
}

export function hashColor(name) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  const c = new THREE.Color();
  c.setHSL((h % 360) / 360, 0.7, 0.55);
  return c;
}
