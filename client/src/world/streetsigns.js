import * as THREE from 'three';
import { lyonXZ } from './squares.js';

// PLAQUES DE RUE (ville OSM) : les données OSM du jeu n'ont pas les noms
// des rues. On reconnaît les grandes rues de Lyon à leur tracé réel (points
// GPS ci-dessous) : une rue OSM proche ET parallèle reçoit le nom. Une rue
// non reconnue n'a pas de plaque — jamais de faux nom. À chaque carrefour
// d'une rue nommée, une plaque émaillée bleue est vissée sur l'angle
// d'immeuble le plus proche, face à la rue. Un seul maillage, un atlas.

// [nom, arrondissement, tracé (lat, lon)…]
const RUES = [
  ['RUE DE LA RÉPUBLIQUE', '2e', [45.7586, 4.8340], [45.7618, 4.8358], [45.7638, 4.8363], [45.7668, 4.8360]],
  ['RUE ÉDOUARD HERRIOT', '1er', [45.7593, 4.8327], [45.7640, 4.8339], [45.7664, 4.8343]],
  ['RUE VICTOR HUGO', '2e', [45.7566, 4.8306], [45.7522, 4.8276]],
  ['RUE MERCIÈRE', '2e', [45.7613, 4.8317], [45.7641, 4.8320]],
  ['RUE DE BREST', '2e', [45.7610, 4.8331], [45.7640, 4.8334]],
  ['RUE GRENETTE', '2e', [45.7631, 4.8325], [45.7632, 4.8370]],
  ['RUE SAINT-JEAN', '5e', [45.7608, 4.8277], [45.7640, 4.8282]],
  ['RUE DE LA BARRE', '2e', [45.7570, 4.8355], [45.7556, 4.8400]],
  ['COURS LAFAYETTE', '3e', [45.7637, 4.8410], [45.7633, 4.8560]],
  ['COURS GAMBETTA', '7e', [45.7550, 4.8425], [45.7530, 4.8560]],
  ['QUAI SAINT-ANTOINE', '2e', [45.7605, 4.8297], [45.7650, 4.8302]],
  ['QUAI JULES COURMONT', '2e', [45.7583, 4.8375], [45.7630, 4.8385]],
];

function atlas(names) {
  const W = 512, H = 128;
  const c = document.createElement('canvas');
  c.width = W; c.height = H * names.length;
  const g = c.getContext('2d');
  names.forEach(([nom, arr], i) => {
    const y = i * H;
    g.fillStyle = '#f4f1e8'; g.fillRect(0, y, W, H); // liseré blanc
    g.fillStyle = '#1d3f8a'; g.fillRect(6, y + 6, W - 12, H - 12);
    g.strokeStyle = '#f4f1e8'; g.lineWidth = 3; g.strokeRect(14, y + 14, W - 28, H - 28);
    g.fillStyle = '#f4f1e8';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = 'bold 22px Georgia, serif';
    g.fillText(`${arr} Arr${arr === '1er' ? '' : 't'}`, W / 2, y + 36);
    let px = 46;
    g.font = `bold ${px}px Georgia, serif`;
    while (px > 20 && g.measureText(nom).width > W - 60) { px -= 2; g.font = `bold ${px}px Georgia, serif`; }
    g.fillText(nom, W / 2, y + 80);
  });
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

export function buildStreetSigns(ctx, roads, scale = 0.5) {
  const walls = ctx.wallSegs ?? [];
  if (!walls.length) return null;
  // Tracés réels en repère jeu
  const lines = RUES.map(([nom, arr, ...pts]) => ({ nom, arr, pts: pts.map(([la, lo]) => lyonXZ(la, lo, scale)) }));
  const distTo = (pts, x, z) => {
    let best = Infinity, dir = null;
    for (let i = 0; i + 1 < pts.length; i++) {
      const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
      const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz;
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2));
      const d = Math.hypot(x - ax - dx * t, z - az - dz * t);
      if (d < best) { best = d; dir = [dx / Math.sqrt(l2), dz / Math.sqrt(l2)]; }
    }
    return { d: best, dir };
  };
  // Grille des murs
  const WC = 16, wgrid = new Map();
  walls.forEach((w, i) => {
    const k = `${Math.floor((w[0] + w[2]) / 2 / WC)},${Math.floor((w[1] + w[3]) / 2 / WC)}`;
    if (!wgrid.has(k)) wgrid.set(k, []);
    wgrid.get(k).push(i);
  });
  const nearestWall = (x, z) => {
    let best = null;
    const gx = Math.floor(x / WC), gz = Math.floor(z / WC);
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
      for (const wi of wgrid.get(`${gx + i},${gz + j}`) ?? []) {
        const [ax, az, bx, bz] = walls[wi];
        const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz;
        const t = Math.max(0.08, Math.min(0.92, ((x - ax) * dx + (z - az) * dz) / l2));
        const px = ax + dx * t, pz = az + dz * t;
        const d = Math.hypot(x - px, z - pz);
        if (!best || d < best.d) best = { d, px, pz, w: walls[wi] };
      }
    }
    return best;
  };
  const nodeKey = (x, z) => `${Math.round(x * 2)},${Math.round(z * 2)}`;
  const deg = new Map();
  for (const r of roads) for (let i = 0; i + 1 < r.p.length; i += 2) {
    const k = nodeKey(r.p[i], r.p[i + 1]);
    deg.set(k, (deg.get(k) ?? 0) + 1);
  }

  const pos = [], uv = [], idx = [];
  const placed = [];
  const N = lines.length;
  for (const r of roads) {
    if (r.w < 4) continue;
    // Rue reconnue ? (milieux de tronçons proches et parallèles au tracé)
    let li = -1, score = 0, tot = 0;
    for (let i = 0; i + 3 < r.p.length; i += 2) {
      const x1 = r.p[i], z1 = r.p[i + 1], x2 = r.p[i + 2], z2 = r.p[i + 3];
      const len = Math.hypot(x2 - x1, z2 - z1);
      if (len < 1) continue;
      tot += len;
      let best = -1, bd = 11;
      lines.forEach((L, k) => {
        const { d, dir } = distTo(L.pts, (x1 + x2) / 2, (z1 + z2) / 2);
        const par = Math.abs(((x2 - x1) * dir[0] + (z2 - z1) * dir[1]) / len);
        if (d < bd && par > 0.85) { bd = d; best = k; }
      });
      if (best >= 0) { if (li < 0 || li === best) { li = best; score += len; } }
    }
    if (li < 0 || score < tot * 0.6) continue;
    // Une plaque à chaque carrefour de la rue
    for (let i = 0; i + 1 < r.p.length; i += 2) {
      const x = r.p[i], z = r.p[i + 1];
      if ((deg.get(nodeKey(x, z)) ?? 0) < 2) continue;
      if (placed.some(([px, pz, l]) => l === li && Math.hypot(px - x, pz - z) < 25)) continue;
      // direction locale de la rue
      const j = i + 2 < r.p.length ? i + 2 : i - 2;
      const ex = r.p[j] - x, ez = r.p[j + 1] - z, el = Math.hypot(ex, ez) || 1;
      const ux = ex / el, uz = ez / el;
      // angle d'immeuble : du côté droit, juste après le carrefour
      const side = placed.length % 2 ? 1 : -1;
      const sx = x + ux * (r.w / 2 + 3) - uz * side * (r.w / 2 + 2.5);
      const sz = z + uz * (r.w / 2 + 3) + ux * side * (r.w / 2 + 2.5);
      const W = nearestWall(sx, sz);
      if (!W || W.d > 7) continue;
      const [ax, az, bx, bz, yBase, bcx, bcz] = W.w;
      let nx = -(bz - az), nz = bx - ax;
      const nl = Math.hypot(nx, nz) || 1; nx /= nl; nz /= nl;
      if (nx * (W.px - bcx) + nz * (W.pz - bcz) < 0) { nx = -nx; nz = -nz; } // vers la rue
      const cx = W.px + nx * 0.03, cz = W.pz + nz * 0.03, cy = yBase + 3.3;
      const hw = 0.55, hh = 0.14; // 1,10 m × 0,28 m
      const base = pos.length / 3;
      // droite du passant qui regarde le mur (direction -n) : (nz, -nx) — le
      // texte se lit de gauche à droite, sommets dans le sens trigonométrique
      const rx = nz, rz = -nx;
      for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        pos.push(cx + rx * hw * a, cy + hh * b, cz + rz * hw * a);
      }
      const v0 = 1 - (li + 1) / N, v1 = 1 - li / N;
      uv.push(0, v0, 1, v0, 1, v1, 0, v1);
      idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
      placed.push([x, z, li]);
    }
  }
  if (!pos.length) return null;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  const mesh = new THREE.Mesh(g, new THREE.MeshLambertMaterial({
    map: atlas(RUES), polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3,
  }));
  mesh.name = 'plaques de rue';
  mesh.userData.noShadow = true;
  ctx.scene.add(mesh);
  console.log(`🪧 Plaques de rue : ${placed.length}`);
  return { placed };
}
