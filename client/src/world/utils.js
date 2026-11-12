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
    // Couleurs de sommets déjà présentes (ombrage cuit, ex. houppiers) :
    // multipliées par la couleur du matériau au lieu d'être écrasées.
    const own = mat.vertexColors ? g.attributes.color : null;
    for (const name of Object.keys(g.attributes)) {
      if (name !== 'position' && name !== 'normal') g.deleteAttribute(name);
    }
    if (!g.attributes.normal) g.computeVertexNormals();
    c.copy(mat.color);
    const n = g.attributes.position.count;
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const k = own ? own.getX(i) : 1;
      col[i * 3] = c.r * k; col[i * 3 + 1] = c.g * (own ? own.getY(i) : 1); col[i * 3 + 2] = c.b * (own ? own.getZ(i) : 1);
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geos.push(g);
  }
  if (!geos.length) return null;
  const merged = geos.length === 1 ? geos[0] : mergeGeometries(geos);
  if (!merged) return null;
  return new THREE.Mesh(merged, material ?? new THREE.MeshLambertMaterial({ vertexColors: true }));
}

// Contexte « tourné » : tout ce qu'un constructeur écrit en coordonnées
// droites (maillages, colliders, interactions, POI) est pivoté de `yaw`
// autour de (cx, cz) — stand de tir et clos de pétanque alignés sur la place
// Bellecour, qui suit l'axe de la Presqu'île. Les colliders restent des
// boîtes alignées sur les axes : un mur long est donc découpé en cellules
// d'environ 1 m AVANT rotation (sinon sa boîte englobante barrerait tout).
export function rotatedCtx(ctx, cx, cz, yaw) {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  const apply = (x, z) => [cx + (x - cx) * c + (z - cz) * s, cz - (x - cx) * s + (z - cz) * c];
  const group = new THREE.Group();
  const [ox, oz] = apply(0, 0);
  group.rotation.y = yaw;
  group.position.set(ox, 0, oz);
  ctx.scene.add(group);
  const pushBox = (b) => {
    const pts = [[b.minX, b.minZ], [b.maxX, b.minZ], [b.minX, b.maxZ], [b.maxX, b.maxZ]].map(([x, z]) => apply(x, z));
    ctx.colliders.push({
      ...b,
      minX: Math.min(...pts.map((p) => p[0])), maxX: Math.max(...pts.map((p) => p[0])),
      minZ: Math.min(...pts.map((p) => p[1])), maxZ: Math.max(...pts.map((p) => p[1])),
    });
  };
  return {
    ...ctx,
    scene: group,
    rot: { yaw, apply, group },
    colliders: {
      push(b) {
        const w = b.maxX - b.minX, d = b.maxZ - b.minZ;
        const nx = Math.max(1, Math.round(w / Math.max(1, Math.min(w, d)))), nz = Math.max(1, Math.round(d / Math.max(1, Math.min(w, d))));
        for (let i = 0; i < nx; i++) {
          for (let k = 0; k < nz; k++) {
            pushBox({ ...b, minX: b.minX + (w * i) / nx, maxX: b.minX + (w * (i + 1)) / nx, minZ: b.minZ + (d * k) / nz, maxZ: b.minZ + (d * (k + 1)) / nz });
          }
        }
      },
    },
    interactables: { push(it) { const [x, z] = apply(it.x, it.z); ctx.interactables.push(Object.assign(it, { x, z })); } },
    pois: { push(p) { const [x, z] = apply(p.x, p.z); ctx.pois.push({ ...p, x, z }); } },
  };
}

// CUISSON DU PETIT DÉCOR d'un groupe (place Bellecour : fleurs, bancs,
// bornes, socles, allées… une centaine de maillages, chacun son draw call,
// doublé par la carte d'ombre). Les pièces simples — Lambert uni, opaque,
// sans texture, non taguables, peu de sommets — sont fusionnées en DEUX
// maillages à couleurs par sommet : le « plat » (allées, pelouses, fleurs :
// ne porte pas d'ombre) et le « relief ». Le reste (statues sculptées,
// textures, instances) n'est pas touché. À appeler APRÈS les saisons (les
// verts sont alors déjà recolorés) et avant le premier rendu.
export function bakeSmallDecor(group, { maxVerts = 700 } = {}) {
  group.updateMatrixWorld(true);
  const flat = [], tall = [];
  const box = new THREE.Box3();
  group.traverse((o) => {
    if (!o.isMesh || o.isInstancedMesh || o.isSkinnedMesh || o.children.length) return;
    const m = o.material;
    if (!m || Array.isArray(m) || m.type !== 'MeshLambertMaterial') return;
    if (m.map || m.transparent || m.vertexColors || m.side !== THREE.FrontSide) return;
    if (Object.keys(o.userData).length || o.name) return; // pièce repérée par le jeu
    if (!o.geometry?.attributes.position || o.geometry.attributes.position.count > maxVerts) return;
    box.setFromObject(o);
    (box.max.y - box.min.y < 0.75 && box.max.y < 1.1 ? flat : tall).push(o);
  });
  const out = [];
  for (const [list, shadow] of [[flat, false], [tall, true]]) {
    if (list.length < 2) continue;
    const mesh = flattenColored(list);
    if (!mesh) continue;
    // flattenColored cuit les matrices MONDE : le maillage va à la racine
    mesh.castShadow = shadow; mesh.receiveShadow = true;
    if (!shadow) mesh.userData.noShadow = true;
    for (const o of list) { o.parent?.remove(o); o.geometry.dispose(); }
    out.push(mesh);
  }
  return out;
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
  // Texte trop long pour le panneau : on réduit la police au lieu de le
  // laisser déborder (« MUR DES LYONNAIS » s'affichait « R DES LYONNA »)
  let px = Number(/(\d+)px/.exec(font)?.[1] ?? 0);
  while (px > 14 && g.measureText(text).width > width * 0.92) {
    px -= 4;
    g.font = font.replace(/\d+px/, `${px}px`);
  }
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

// LUEUR ADDITIVE (à la place d'une vraie PointLight). Une lumière ponctuelle
// coûte sur CHAQUE pixel éclairé de la ville, même loin et même éteinte, et
// en ajouter/retirer une recompile tous les shaders de la scène (gel). Un
// sprite additif donne l'impression de lumière pour le prix d'un quad.
let glowTex = null;
export function makeGlowSprite(color, size, opacity = 1) {
  if (!glowTex) {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d');
    const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.35, 'rgba(255,255,255,0.45)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
    glowTex = new THREE.CanvasTexture(c);
  }
  const s = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glowTex, color, transparent: true, opacity,
    blending: THREE.AdditiveBlending, depthWrite: false,
  }));
  s.scale.set(size, size, 1);
  s.userData.noShadow = true;
  return s;
}
