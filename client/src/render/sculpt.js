import * as THREE from 'three';

// SCULPTURE PROCÉDURALE : des formes organiques (corps, chevaux, statues)
// au lieu d'assemblages de cylindres et de sphères qui s'intersectent.
//
// Une forme est décrite comme un champ de distance signée : une liste de
// volumes simples (sphères, ellipsoïdes, cônes arrondis, boîtes arrondies)
// FONDUS les uns dans les autres par une union douce — l'épaule se coule
// dans le torse, l'encolure dans le poitrail, comme de l'argile. Le champ
// est échantillonné sur une grille puis maillé une fois (« surface nets »),
// avec des normales tirées du gradient exact : ombrage parfaitement lisse.
//
// Zéro asset externe, et un coût payé UNE fois au chargement : les
// géométries obtenues sont mises en cache et partagées (seule la couleur
// change d'un personnage à l'autre, voir paint()).
//
// Chaque volume porte un numéro de « teinte » (slot) : la surface prend la
// teinte du volume le plus proche — manches, peau, pantalon, chaussures…

const BIG = 1e3;

// Union / soustraction douces (polynôme de degré 2, k = rayon du congé)
function smin(a, b, k) {
  if (k <= 0) return Math.min(a, b);
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
}

function rotInv(rot) {
  if (!rot) return null;
  const m = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rot[0], rot[1], rot[2]));
  return new THREE.Matrix3().setFromMatrix4(m).transpose().elements; // inverse = transposée
}

// Prépare un volume : distance locale + boîte englobante (pour ne l'évaluer
// que là où il compte).
function prepare(p) {
  const q = { ...p, k: p.k ?? 0.02, slot: p.slot ?? 0, sub: Boolean(p.sub) };
  const R = rotInv(p.rot);
  const local = (x, y, z, c) => {
    let dx = x - c[0], dy = y - c[1], dz = z - c[2];
    if (R) {
      const ox = dx, oy = dy, oz = dz;
      dx = R[0] * ox + R[3] * oy + R[6] * oz;
      dy = R[1] * ox + R[4] * oy + R[7] * oz;
      dz = R[2] * ox + R[5] * oy + R[8] * oz;
    }
    return [dx, dy, dz];
  };
  let ext;
  if (p.t === 'sphere') {
    const [cx, cy, cz] = p.c, r = p.r;
    q.d = (x, y, z) => Math.hypot(x - cx, y - cy, z - cz) - r;
    ext = [cx - r, cy - r, cz - r, cx + r, cy + r, cz + r];
  } else if (p.t === 'ell') {
    const [rx, ry, rz] = p.r;
    const rm = Math.max(rx, ry, rz);
    // Approximation de distance d'un ellipsoïde (borne d'iq) : exacte à la
    // surface, ce qui suffit au maillage et aux congés.
    const [cx, cy, cz] = p.c;
    const ix = 1 / rx, iy = 1 / ry, iz = 1 / rz, ix2 = ix * ix, iy2 = iy * iy, iz2 = iz * iz;
    const rmin = Math.min(rx, ry, rz);
    // Sans allocation : appelée des millions de fois au chargement
    q.d = (x, y, z) => {
      let a = x - cx, b = y - cy, c = z - cz;
      if (R) {
        const ox = a, oy = b, oz = c;
        a = R[0] * ox + R[3] * oy + R[6] * oz;
        b = R[1] * ox + R[4] * oy + R[7] * oz;
        c = R[2] * ox + R[5] * oy + R[8] * oz;
      }
      const k0 = Math.sqrt(a * a * ix2 + b * b * iy2 + c * c * iz2);
      const k1 = Math.sqrt(a * a * ix2 * ix2 + b * b * iy2 * iy2 + c * c * iz2 * iz2);
      return k1 > 1e-9 ? k0 * (k0 - 1) / k1 : -rmin;
    };
    // Boîte serrée par axe quand l'ellipsoïde n'est pas tourné
    const [ex, ey, ez] = R ? [rm, rm, rm] : [rx, ry, rz];
    ext = [cx - ex, cy - ey, cz - ez, cx + ex, cy + ey, cz + ez];
  } else if (p.t === 'cone') {
    // Cône arrondi (capsule à rayons différents) de a (rayon r1) à b (r2)
    const [ax, ay, az] = p.a, [bx, by, bz] = p.b;
    const r1 = p.r1, r2 = p.r2 ?? p.r1;
    const ex = bx - ax, ey = by - ay, ez = bz - az;
    const l2 = ex * ex + ey * ey + ez * ez;
    const rr = r1 - r2, a2 = l2 - rr * rr, il2 = 1 / l2;
    q.d = (x, y, z) => {
      const px = x - ax, py = y - ay, pz = z - az;
      const yv = px * ex + py * ey + pz * ez;
      const zv = yv - l2;
      const wx = px * l2 - ex * yv, wy = py * l2 - ey * yv, wz = pz * l2 - ez * yv;
      const x2 = wx * wx + wy * wy + wz * wz;
      const y2 = yv * yv * l2, z2 = zv * zv * l2;
      const k = Math.sign(rr) * rr * rr * x2;
      if (Math.sign(zv) * a2 * z2 > k) return Math.sqrt(x2 + z2) * il2 - r2;
      if (Math.sign(yv) * a2 * y2 < k) return Math.sqrt(x2 + y2) * il2 - r1;
      return (Math.sqrt(x2 * a2 * il2) + yv * rr) * il2 - r1;
    };
    const r = Math.max(r1, r2);
    ext = [Math.min(ax, bx) - r, Math.min(ay, by) - r, Math.min(az, bz) - r,
      Math.max(ax, bx) + r, Math.max(ay, by) + r, Math.max(az, bz) + r];
  } else if (p.t === 'box') {
    const [hx, hy, hz] = p.h, rr = p.round ?? 0;
    q.d = (x, y, z) => {
      const [a, b, c] = local(x, y, z, p.c);
      const qx = Math.abs(a) - hx + rr, qy = Math.abs(b) - hy + rr, qz = Math.abs(c) - hz + rr;
      return Math.hypot(Math.max(qx, 0), Math.max(qy, 0), Math.max(qz, 0)) +
        Math.min(Math.max(qx, qy, qz), 0) - rr;
    };
    const rm = Math.hypot(hx, hy, hz);
    ext = [p.c[0] - rm, p.c[1] - rm, p.c[2] - rm, p.c[0] + rm, p.c[1] + rm, p.c[2] + rm];
  } else if (p.t === 'plane') {
    // Demi-espace sous y = h (pour araser un socle, une semelle…)
    q.d = (x, y) => y - p.h;
    ext = [-BIG, -BIG, -BIG, BIG, p.h, BIG];
  } else {
    throw new Error(`volume inconnu : ${p.t}`);
  }
  q.ext = ext;
  q.reach = q.k + 0.03;
  return q;
}

// Distance complète en un point (toutes les pièces) + teinte dominante
function evalAll(prims, x, y, z, out) {
  let d = BIG, best = BIG, slot = 0, best2 = BIG, slot2 = 0;
  for (const p of prims) {
    // Hors de portée de la pièce (boîte + congé) : elle ne change rien
    const e = p.ext, m = p.reach;
    if (x < e[0] - m || x > e[3] + m || y < e[1] - m || y > e[4] + m || z < e[2] - m || z > e[5] + m) continue;
    const di = p.d(x, y, z);
    if (p.sub) d = -smin(-d, di, p.k);
    else {
      d = smin(d, di, p.k);
      const a = Math.abs(di);
      if (a < best) {
        if (p.slot !== slot) { best2 = best; slot2 = slot; }
        best = a; slot = p.slot;
      } else if (a < best2 && p.slot !== slot) { best2 = a; slot2 = p.slot; }
    }
  }
  if (out) {
    out.slot = slot;
    out.slot2 = best2 < BIG ? slot2 : slot;
    out.gap = best2 - best; // écart à la teinte voisine (0 = pile à la frontière)
  }
  return d;
}

// prims : liste de volumes ; cell : pas de la grille (m).
// Renvoie une BufferGeometry indexée : position, normal, slot.
export function sculpt(primsIn, { cell = 0.02 } = {}) {
  const prims = primsIn.map(prepare);
  const pad = cell * 2;
  let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
  for (const p of prims) {
    if (p.sub) continue;
    const e = p.ext;
    x0 = Math.min(x0, e[0]); y0 = Math.min(y0, e[1]); z0 = Math.min(z0, e[2]);
    x1 = Math.max(x1, e[3]); y1 = Math.max(y1, e[4]); z1 = Math.max(z1, e[5]);
  }
  x0 -= pad; y0 -= pad; z0 -= pad; x1 += pad; y1 += pad; z1 += pad;
  const nx = Math.ceil((x1 - x0) / cell) + 1;
  const ny = Math.ceil((y1 - y0) / cell) + 1;
  const nz = Math.ceil((z1 - z0) / cell) + 1;
  const N = nx * ny * nz;
  const field = new Float32Array(N).fill(BIG);
  const idx = (i, j, k) => i + nx * (j + ny * k);

  // Remplissage pièce par pièce, seulement dans sa boîte (+ congé) : le coût
  // suit le volume des pièces, pas celui de la grille entière.
  for (const p of prims) {
    const m = p.k + pad;
    const i0 = Math.max(0, Math.floor((p.ext[0] - m - x0) / cell));
    const j0 = Math.max(0, Math.floor((p.ext[1] - m - y0) / cell));
    const k0 = Math.max(0, Math.floor((p.ext[2] - m - z0) / cell));
    const i1 = Math.min(nx - 1, Math.ceil((p.ext[3] + m - x0) / cell));
    const j1 = Math.min(ny - 1, Math.ceil((p.ext[4] + m - y0) / cell));
    const k1 = Math.min(nz - 1, Math.ceil((p.ext[5] + m - z0) / cell));
    for (let k = k0; k <= k1; k++) {
      const z = z0 + k * cell;
      for (let j = j0; j <= j1; j++) {
        const y = y0 + j * cell;
        let n = idx(i0, j, k);
        for (let i = i0; i <= i1; i++, n++) {
          const di = p.d(x0 + i * cell, y, z);
          field[n] = p.sub ? -smin(-field[n], di, p.k) : smin(field[n], di, p.k);
        }
      }
    }
  }

  // Index spatial pour les évaluations ponctuelles (normales, teintes) :
  // chaque case ne connaît que les pièces qui l'atteignent (ordre conservé)
  const B = 10;
  const bw = [(x1 - x0) / B, (y1 - y0) / B, (z1 - z0) / B];
  const bins = [];
  for (let bk = 0; bk < B; bk++) {
    for (let bj = 0; bj < B; bj++) {
      for (let bi = 0; bi < B; bi++) {
        const lo = [x0 + bi * bw[0], y0 + bj * bw[1], z0 + bk * bw[2]];
        bins.push(prims.filter((p) => {
          const e = p.ext, m = p.reach;
          return e[0] - m <= lo[0] + bw[0] && e[3] + m >= lo[0] &&
            e[1] - m <= lo[1] + bw[1] && e[4] + m >= lo[1] &&
            e[2] - m <= lo[2] + bw[2] && e[5] + m >= lo[2];
        }));
      }
    }
  }
  const near = (x, y, z) => {
    const bi = Math.min(B - 1, Math.max(0, Math.floor((x - x0) / bw[0])));
    const bj = Math.min(B - 1, Math.max(0, Math.floor((y - y0) / bw[1])));
    const bk = Math.min(B - 1, Math.max(0, Math.floor((z - z0) / bw[2])));
    return bins[bi + B * (bj + B * bk)];
  };

  // Surface nets : un sommet par cellule traversée par la surface, placé à
  // la moyenne des points de passage sur ses arêtes.
  const cellVert = new Int32Array((nx - 1) * (ny - 1) * (nz - 1)).fill(-1);
  const cidx = (i, j, k) => i + (nx - 1) * (j + (ny - 1) * k);
  const pos = [];
  const corner = new Float32Array(8);
  const EDGES = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
  for (let k = 0; k < nz - 1; k++) {
    for (let j = 0; j < ny - 1; j++) {
      for (let i = 0; i < nx - 1; i++) {
        let mask = 0;
        for (let c = 0; c < 8; c++) {
          const v = field[idx(i + (c & 1), j + ((c >> 1) & 1), k + ((c >> 2) & 1))];
          corner[c] = v;
          if (v < 0) mask |= 1 << c;
        }
        if (mask === 0 || mask === 255) continue;
        let sx = 0, sy = 0, sz = 0, cnt = 0;
        for (const [a, b] of EDGES) {
          const va = corner[a], vb = corner[b];
          if ((va < 0) === (vb < 0)) continue;
          const t = va / (va - vb);
          sx += (a & 1) + t * ((b & 1) - (a & 1));
          sy += ((a >> 1) & 1) + t * (((b >> 1) & 1) - ((a >> 1) & 1));
          sz += ((a >> 2) & 1) + t * (((b >> 2) & 1) - ((a >> 2) & 1));
          cnt++;
        }
        cellVert[cidx(i, j, k)] = pos.length / 3;
        pos.push(x0 + (i + sx / cnt) * cell, y0 + (j + sy / cnt) * cell, z0 + (k + sz / cnt) * cell);
      }
    }
  }

  // Une face (quad) par arête de grille qui traverse la surface, entre les
  // quatre cellules qui la partagent ; orientée vers l'extérieur.
  const index = [];
  const quad = (a, b, c, d, flip) => {
    if (a < 0 || b < 0 || c < 0 || d < 0) return;
    if (flip) index.push(a, c, b, a, d, c);
    else index.push(a, b, c, a, c, d);
  };
  for (let k = 1; k < nz - 1; k++) {
    for (let j = 1; j < ny - 1; j++) {
      for (let i = 1; i < nx - 1; i++) {
        const v0 = field[idx(i, j, k)] < 0;
        if (i < nx - 1 && v0 !== (field[idx(i + 1, j, k)] < 0)) {
          quad(cellVert[cidx(i, j - 1, k - 1)], cellVert[cidx(i, j, k - 1)],
            cellVert[cidx(i, j, k)], cellVert[cidx(i, j - 1, k)], !v0);
        }
        if (j < ny - 1 && v0 !== (field[idx(i, j + 1, k)] < 0)) {
          quad(cellVert[cidx(i - 1, j, k - 1)], cellVert[cidx(i - 1, j, k)],
            cellVert[cidx(i, j, k)], cellVert[cidx(i, j, k - 1)], !v0);
        }
        if (k < nz - 1 && v0 !== (field[idx(i, j, k + 1)] < 0)) {
          quad(cellVert[cidx(i - 1, j - 1, k)], cellVert[cidx(i, j - 1, k)],
            cellVert[cidx(i, j, k)], cellVert[cidx(i - 1, j, k)], !v0);
        }
      }
    }
  }

  // Sommets recollés sur la vraie surface (un pas de Newton) + normales du
  // gradient exact + teinte du volume le plus proche
  const nv = pos.length / 3;
  const position = new Float32Array(pos);
  const normal = new Float32Array(nv * 3);
  const slot = new Float32Array(nv * 3); // teinte, teinte voisine, mélange
  const e = cell * 0.25;
  const info = { slot: 0 };
  // Gradient en tétraèdre : 4 évaluations au lieu de 6
  const grad = (x, y, z, g) => {
    const L = near(x, y, z);
    const a = evalAll(L, x + e, y - e, z - e), b = evalAll(L, x - e, y - e, z + e);
    const c = evalAll(L, x - e, y + e, z - e), d = evalAll(L, x + e, y + e, z + e);
    g[0] = a - b - c + d; g[1] = -a - b + c + d; g[2] = -a + b - c + d;
    const l = Math.hypot(g[0], g[1], g[2]) || 1;
    g[0] /= l; g[1] /= l; g[2] /= l;
  };
  const g = [0, 0, 0];
  // Largeur du fondu : étroite et absolue — une coque fine (cheveux sur le
  // crâne, 1 cm) ne doit pas se teinter du volume qu'elle recouvre
  const blend = Math.min(cell * 0.4, 0.006);
  for (let v = 0; v < nv; v++) {
    let x = position[v * 3], y = position[v * 3 + 1], z = position[v * 3 + 2];
    grad(x, y, z, g);
    const d = Math.max(-cell, Math.min(cell, evalAll(near(x, y, z), x, y, z, info)));
    x -= g[0] * d; y -= g[1] * d; z -= g[2] * d;
    grad(x, y, z, g);
    const gx = g[0], gy = g[1], gz = g[2];
    evalAll(near(x, y, z), x, y, z, info);
    position[v * 3] = x; position[v * 3 + 1] = y; position[v * 3 + 2] = z;
    normal[v * 3] = gx; normal[v * 3 + 1] = gy; normal[v * 3 + 2] = gz;
    // Frontière de teintes fondue sur ~une maille : plus d'escalier de
    // couleurs (ceinture, ligne des cheveux, crinière)
    slot[v * 3] = info.slot;
    slot[v * 3 + 1] = info.slot2;
    slot[v * 3 + 2] = 0.5 * Math.max(0, 1 - info.gap / blend);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(position, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(normal, 3));
  geo.setAttribute('slot', new THREE.BufferAttribute(slot, 3));
  geo.setIndex(nv > 65535 ? new THREE.Uint32BufferAttribute(index, 1) : new THREE.Uint16BufferAttribute(index, 1));
  geo.computeBoundingSphere();
  geo.computeBoundingBox();
  return geo;
}

// Ajoute de petites pièces classiques (yeux, sourcils…) à une géométrie
// sculptée, chacune avec sa teinte : trop fines pour la grille, mais elles
// restent dans le MÊME mesh (aucun draw call en plus).
export function withDetails(geo, details) {
  const parts = [geo];
  for (const { geometry, slot, matrix } of details) {
    let g = geometry.index ? geometry : geometry.clone();
    if (matrix) g = g.clone().applyMatrix4(matrix);
    const out = new THREE.BufferGeometry();
    out.setAttribute('position', g.attributes.position);
    out.setAttribute('normal', g.attributes.normal);
    const sl = new Float32Array(g.attributes.position.count * 3);
    for (let v = 0; v < sl.length; v += 3) { sl[v] = slot; sl[v + 1] = slot; }
    out.setAttribute('slot', new THREE.BufferAttribute(sl, 3));
    out.setIndex(g.index ?? [...Array(g.attributes.position.count).keys()]);
    parts.push(out);
  }
  // Fusion indexée maison (pas d'import d'addon : position/normal/slot/index)
  let nv = 0, ni = 0;
  for (const g of parts) { nv += g.attributes.position.count; ni += g.index.count; }
  const position = new Float32Array(nv * 3), normal = new Float32Array(nv * 3), slot = new Float32Array(nv * 3);
  const index = nv > 65535 ? new Uint32Array(ni) : new Uint16Array(ni);
  let ov = 0, oi = 0;
  for (const g of parts) {
    const n = g.attributes.position.count;
    for (let v = 0; v < n; v++) {
      position[(ov + v) * 3] = g.attributes.position.getX(v);
      position[(ov + v) * 3 + 1] = g.attributes.position.getY(v);
      position[(ov + v) * 3 + 2] = g.attributes.position.getZ(v);
      normal[(ov + v) * 3] = g.attributes.normal.getX(v);
      normal[(ov + v) * 3 + 1] = g.attributes.normal.getY(v);
      normal[(ov + v) * 3 + 2] = g.attributes.normal.getZ(v);
      slot[(ov + v) * 3] = g.attributes.slot.getX(v);
      slot[(ov + v) * 3 + 1] = g.attributes.slot.getY(v);
      slot[(ov + v) * 3 + 2] = g.attributes.slot.getZ(v);
    }
    for (let t = 0; t < g.index.count; t++) index[oi + t] = g.index.getX(t) + ov;
    ov += n;
    oi += g.index.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(position, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(normal, 3));
  out.setAttribute('slot', new THREE.BufferAttribute(slot, 3));
  out.setIndex(new THREE.BufferAttribute(index, 1));
  out.computeBoundingSphere();
  out.computeBoundingBox();
  return out;
}

// Habille une géométrie sculptée : nouvelle géométrie qui PARTAGE positions,
// normales et index (un seul tampon GPU pour tous les personnages du même
// modèle) avec ses propres couleurs de sommets, tirées de la palette.
// Ne JAMAIS appeler dispose() sur ces géométries : cela libérerait les
// tampons partagés par tous les autres personnages.
export function paint(geo, palette) {
  const out = new THREE.BufferGeometry();
  out.setIndex(geo.index);
  out.setAttribute('position', geo.attributes.position);
  out.setAttribute('normal', geo.attributes.normal);
  const slots = geo.attributes.slot.array;
  const n = slots.length / 3;
  const col = new Uint8Array(n * 3);
  for (let v = 0; v < n; v++) {
    const a = palette[slots[v * 3]] ?? palette[0];
    const b = palette[slots[v * 3 + 1]] ?? a;
    const t = slots[v * 3 + 2];
    col[v * 3] = Math.round((a.r + (b.r - a.r) * t) * 255);
    col[v * 3 + 1] = Math.round((a.g + (b.g - a.g) * t) * 255);
    col[v * 3 + 2] = Math.round((a.b + (b.b - a.b) * t) * 255);
  }
  out.setAttribute('color', new THREE.BufferAttribute(col, 3, true));
  out.boundingSphere = geo.boundingSphere;
  out.boundingBox = geo.boundingBox;
  return out;
}

// Champ de distance d'une liste de volumes (sans maillage) : sert à poser
// des détails pile SUR une surface (bretelles, cordons, sangles).
export function field(primsIn) {
  const prims = primsIn.map(prepare);
  return (x, y, z) => evalAll(prims, x, y, z);
}

// Ramène un point sur la surface du champ puis l'écarte de `lift` le long
// de la normale. Renvoie [x, y, z].
export function onSurface(f, p, lift = 0) {
  let [x, y, z] = p;
  const e = 0.002;
  let nx = 0, ny = 0, nz = 0;
  for (let it = 0; it < 6; it++) {
    const d = f(x, y, z);
    nx = f(x + e, y, z) - f(x - e, y, z);
    ny = f(x, y + e, z) - f(x, y - e, z);
    nz = f(x, y, z + e) - f(x, y, z - e);
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l; ny /= l; nz /= l;
    x -= nx * d; y -= ny * d; z -= nz * d;
  }
  return [x + nx * lift, y + ny * lift, z + nz * lift];
}
