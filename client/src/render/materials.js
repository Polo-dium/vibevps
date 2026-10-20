import * as THREE from 'three';

// MATÉRIAUX PBR PROCÉDURAUX, partagés (créés une fois, à la demande).
// Zéro image : chaque texture est peinte dans un canvas (bruit déterministe)
// puis convertie en normal map par un filtre de Sobel. Les matériaux
// MeshStandard lisent scene.environment (voir render/envmap.js) : l'acier
// renvoie le ciel, le bois verni accroche un spéculaire doux.

function makeRand(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function canvas(size) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  return c;
}

// Hauteur (canvas en niveaux de gris) → normal map tangentielle
export function heightToNormal(src, strength = 2) {
  const w = src.width, h = src.height;
  const data = src.getContext('2d').getImageData(0, 0, w, h).data;
  const out = canvas(w);
  const g = out.getContext('2d');
  const img = g.createImageData(w, h);
  const H = (x, y) => data[(((y + h) % h) * w + ((x + w) % w)) * 4] / 255;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = (H(x + 1, y) - H(x - 1, y)) * strength;
      const dy = (H(x, y + 1) - H(x, y - 1)) * strength;
      const len = Math.hypot(dx, dy, 1);
      const i = (y * w + x) * 4;
      img.data[i] = ((-dx / len) * 0.5 + 0.5) * 255;
      img.data[i + 1] = ((dy / len) * 0.5 + 0.5) * 255;
      img.data[i + 2] = ((1 / len) * 0.5 + 0.5) * 255;
      img.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  return out;
}

function tex(c, { srgb = false, repeat = 1 } = {}) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.anisotropy = 4;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// Bruit de valeur lissé, tuilable (somme d'octaves)
function paintNoise(g, size, rand, { octaves = 4, base = 128, amp = 60, cell = 32 } = {}) {
  const img = g.createImageData(size, size);
  const acc = new Float32Array(size * size);
  let a = amp;
  for (let o = 0; o < octaves; o++) {
    const n = Math.max(1, Math.round(size / cell));
    const grid = Array.from({ length: n * n }, () => rand() * 2 - 1);
    const at = (x, y) => grid[((y % n) + n) % n * n + (((x % n) + n) % n)];
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const fx = (x / size) * n, fy = (y / size) * n;
        const x0 = Math.floor(fx), y0 = Math.floor(fy);
        const tx = fx - x0, ty = fy - y0;
        const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
        const v = (at(x0, y0) * (1 - sx) + at(x0 + 1, y0) * sx) * (1 - sy) +
          (at(x0, y0 + 1) * (1 - sx) + at(x0 + 1, y0 + 1) * sx) * sy;
        acc[y * size + x] += v * a;
      }
    }
    cell /= 2;
    a /= 2;
  }
  for (let i = 0; i < acc.length; i++) {
    const v = Math.max(0, Math.min(255, base + acc[i]));
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v;
    img.data[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
}

const cache = new Map();
function once(key, make) {
  if (!cache.has(key)) {
    const v = make();
    // Objets manufacturés : la saison (seasons.js) ne doit pas repeindre
    // un bazooka olive en roux d'automne.
    if (v?.isMaterial) v.userData.noSeason = true;
    cache.set(key, v);
  }
  return cache.get(key);
}

// --- Textures de base ---------------------------------------------------

// Métal : micro-rayures + taches d'usure → rugosité + relief fin
function metalMaps() {
  return once('metalMaps', () => {
    const size = 256, rand = makeRand(11);
    const c = canvas(size), g = c.getContext('2d');
    paintNoise(g, size, rand, { base: 120, amp: 50, cell: 64 });
    g.globalAlpha = 0.35;
    for (let i = 0; i < 260; i++) {
      g.strokeStyle = rand() < 0.5 ? '#e0e0e0' : '#303030';
      g.lineWidth = 0.5 + rand();
      const x = rand() * size, y = rand() * size, l = 4 + rand() * 30, a = rand() * Math.PI;
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l);
      g.stroke();
    }
    g.globalAlpha = 1;
    return { rough: tex(c, { repeat: 2 }), normal: tex(heightToNormal(c, 1.2), { repeat: 2 }) };
  });
}

// Bois verni : veines étirées + pores
function woodMaps(hue) {
  return once(`wood${hue}`, () => {
    const size = 256, rand = makeRand(29);
    const col = canvas(size), g = col.getContext('2d');
    const h = canvas(size), gh = h.getContext('2d');
    const img = g.createImageData(size, size), ih = gh.createImageData(size, size);
    const base = new THREE.Color(hue);
    const phase = Array.from({ length: 8 }, () => rand() * 6.28);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        // veines le long de x, ondulées
        const w = y / size * 40 + Math.sin(x / size * 6.28 + phase[0]) * 2.2 +
          Math.sin(x / size * 12.56 * 2 + phase[1] + y * 0.03) * 0.6;
        const ring = 0.5 + 0.5 * Math.sin(w * 2.1);
        const grain = Math.pow(ring, 3);
        const pore = rand() < 0.02 ? 0.25 : 0;
        const k = 0.78 + grain * 0.32 - pore;
        const i = (y * size + x) * 4;
        img.data[i] = Math.min(255, base.r * 255 * k);
        img.data[i + 1] = Math.min(255, base.g * 255 * k);
        img.data[i + 2] = Math.min(255, base.b * 255 * k);
        img.data[i + 3] = 255;
        ih.data[i] = ih.data[i + 1] = ih.data[i + 2] = (grain * 0.6 + 0.4 - pore) * 255;
        ih.data[i + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
    gh.putImageData(ih, 0, 0);
    return { map: tex(col, { srgb: true, repeat: 3 }), normal: tex(heightToNormal(h, 0.8), { repeat: 3 }) };
  });
}

// Grain fin (polymère, caoutchouc, tissu) : petit relief granuleux
function grainMaps() {
  return once('grain', () => {
    const size = 128, rand = makeRand(5);
    const c = canvas(size), g = c.getContext('2d');
    paintNoise(g, size, rand, { base: 128, amp: 90, cell: 8, octaves: 2 });
    return { normal: tex(heightToNormal(c, 1.5), { repeat: 6 }), rough: tex(c, { repeat: 6 }) };
  });
}

// Toile (vêtements) : trame croisée
function fabricMaps() {
  return once('fabric', () => {
    const size = 64;
    const c = canvas(size), g = c.getContext('2d');
    g.fillStyle = '#808080';
    g.fillRect(0, 0, size, size);
    for (let i = 0; i < size; i += 4) {
      g.fillStyle = '#a8a8a8';
      g.fillRect(i, 0, 2, size);
      g.fillStyle = '#5a5a5a';
      g.fillRect(0, i + 2, size, 1);
    }
    return { normal: tex(heightToNormal(c, 1.2), { repeat: 8 }) };
  });
}

// Grain de détail tuilable (niveaux de gris centrés sur 128) : multiplié
// en coordonnées MONDE sur les surfaces du décor (voir render/enhance.js),
// il casse le flou des petites textures quand on les regarde de près.
export function detailNoise() {
  return once('detail', () => {
    const size = 256, rand = makeRand(77);
    const c = canvas(size), g = c.getContext('2d');
    paintNoise(g, size, rand, { base: 128, amp: 70, cell: 32, octaves: 4 });
    // gravillons / pores
    for (let i = 0; i < 900; i++) {
      const v = rand() < 0.5 ? 70 : 190;
      g.fillStyle = `rgba(${v},${v},${v},0.35)`;
      g.fillRect(rand() * size, rand() * size, 1 + rand() * 1.5, 1 + rand() * 1.5);
    }
    return tex(c);
  });
}

// --- Matériaux ---------------------------------------------------------

export const PBR = {
  // Acier bronzé des armes (boîtier, canon)
  gunmetal: (color = 0x2e3034) => once(`gm${color}`, () => {
    const m = metalMaps();
    return new THREE.MeshStandardMaterial({
      color, metalness: 0.7, roughness: 0.45, envMapIntensity: 1,
      roughnessMap: m.rough, normalMap: m.normal, normalScale: new THREE.Vector2(0.35, 0.35),
    });
  }),
  // Métal brut, plus clair et plus brillant (pièces usinées, marteau)
  steel: (color = 0x8a9099) => once(`st${color}`, () => {
    const m = metalMaps();
    return new THREE.MeshStandardMaterial({
      color, metalness: 0.9, roughness: 0.3, envMapIntensity: 1.2,
      roughnessMap: m.rough, normalMap: m.normal, normalScale: new THREE.Vector2(0.25, 0.25),
    });
  }),
  wood: (color = 0x8a4f26) => once(`wd${color}`, () => {
    const m = woodMaps(color);
    return new THREE.MeshStandardMaterial({
      map: m.map, normalMap: m.normal, normalScale: new THREE.Vector2(0.5, 0.5),
      metalness: 0, roughness: 0.5, envMapIntensity: 0.8,
    });
  }),
  polymer: (color = 0x1e1f22) => once(`py${color}`, () => {
    const m = grainMaps();
    return new THREE.MeshStandardMaterial({
      color, metalness: 0.05, roughness: 0.7, envMapIntensity: 0.8,
      normalMap: m.normal, normalScale: new THREE.Vector2(0.4, 0.4),
    });
  }),
  // Peinture militaire / laquée (bazooka, minigun)
  paint: (color) => once(`pt${color}`, () => {
    const m = metalMaps();
    return new THREE.MeshStandardMaterial({
      color, metalness: 0.3, roughness: 0.5, envMapIntensity: 0.9,
      roughnessMap: m.rough, normalMap: m.normal, normalScale: new THREE.Vector2(0.2, 0.2),
    });
  }),
  glass: (color = 0x2a5570) => once(`gl${color}`, () => new THREE.MeshStandardMaterial({
    color, metalness: 0.2, roughness: 0.05,
  })),
  fabric: (color) => once(`fb${color}`, () => new THREE.MeshStandardMaterial({
    color, metalness: 0, roughness: 0.9,
    normalMap: fabricMaps().normal, normalScale: new THREE.Vector2(0.6, 0.6),
  })),
  skin: (color = 0xe0b48e) => once(`sk${color}`, () => new THREE.MeshStandardMaterial({
    color, metalness: 0, roughness: 0.62,
    normalMap: grainMaps().normal, normalScale: new THREE.Vector2(0.15, 0.15),
  })),
  // Gant tactique : cuir synthétique mat
  glove: (color = 0x2a2c30) => once(`gv${color}`, () => new THREE.MeshStandardMaterial({
    color, metalness: 0.05, roughness: 0.66,
    normalMap: grainMaps().normal, normalScale: new THREE.Vector2(0.5, 0.5),
  })),
};

// --- Géométrie : profils extrudés --------------------------------------

// Silhouette de profil (u = vers l'avant/le canon, v = vers le haut)
// extrudée sur `width` (axe x) et biseautée. Le résultat pointe vers -z,
// comme tout ce qui est tenu en vue subjective, centré en x.
export function profileGeo(points, width, { bevel = 0.004, segments = 2, holes = [] } = {}) {
  const shape = new THREE.Shape(points.map(([u, v]) => new THREE.Vector2(u, v)));
  for (const hole of holes) shape.holes.push(new THREE.Path(hole.map(([u, v]) => new THREE.Vector2(u, v))));
  const depth = Math.max(0.001, width - bevel * 2);
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel,
    bevelSegments: segments, curveSegments: 8,
  });
  geo.translate(0, 0, -depth / 2);
  geo.rotateY(Math.PI / 2); // u → -z, épaisseur → x
  geo.computeVertexNormals();
  return geo;
}

// Rectangle aux coins arrondis, en points de profil (u, v)
export function roundedRect(u0, v0, u1, v1, r, steps = 3) {
  const pts = [];
  const corner = (cu, cv, a0) => {
    for (let i = 0; i <= steps; i++) {
      const a = a0 + (i / steps) * (Math.PI / 2);
      pts.push([cu + Math.cos(a) * r, cv + Math.sin(a) * r]);
    }
  };
  corner(u1 - r, v0 + r, -Math.PI / 2);
  corner(u1 - r, v1 - r, 0);
  corner(u0 + r, v1 - r, Math.PI / 2);
  corner(u0 + r, v0 + r, Math.PI);
  return pts;
}
