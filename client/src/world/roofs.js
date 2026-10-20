import * as THREE from 'three';

// TOITURES DE LA VRAIE VILLE 🏠 : à partir de l'empreinte OSM d'un immeuble,
// un toit en pente (bande inclinée du bord du mur vers un polygone rétréci,
// puis terrasson plat) — mansarde de zinc à lucarnes façon Bellecour, ou
// toit de tuiles canal à faible pente, la signature des toits de Lyon.
// Plus une corniche en saillie au sommet des murs. Tout est géométrie cuite
// dans les tuiles de ville existantes (aucun draw call par immeuble).

// Polygone décalé de `d` vers l'INTÉRIEUR (d < 0 : vers l'extérieur).
// Retourne null si le décalage dégénère (empreinte trop étroite, angles
// trop aigus, polygone retourné) — l'appelant garde alors un toit plat.
export function insetPolygon(pts, d) {
  const n = pts.length;
  if (n < 3) return null;
  let area = 0;
  for (let i = 0; i < n; i++) {
    const [x1, z1] = pts[i], [x2, z2] = pts[(i + 1) % n];
    area += x1 * z2 - x2 * z1;
  }
  if (Math.abs(area) < 1e-3) return null;
  const sgn = area > 0 ? 1 : -1; // intérieur à gauche si aire > 0
  const lines = [];
  for (let i = 0; i < n; i++) {
    const [x1, z1] = pts[i], [x2, z2] = pts[(i + 1) % n];
    const len = Math.hypot(x2 - x1, z2 - z1);
    if (len < 0.25) return null;
    const ex = (x2 - x1) / len, ez = (z2 - z1) / len;
    const nx = -ez * sgn, nz = ex * sgn; // normale intérieure
    lines.push({ px: x1 + nx * d, pz: z1 + nz * d, ex, ez, nx, nz });
  }
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = lines[(i - 1 + n) % n], b = lines[i];
    const cr = a.ex * b.ez - a.ez * b.ex;
    let x, z;
    if (Math.abs(cr) < 0.05) {
      x = b.px; z = b.pz; // arêtes quasi alignées
    } else {
      const t = ((b.px - a.px) * b.ez - (b.pz - a.pz) * b.ex) / cr;
      x = a.px + a.ex * t;
      z = a.pz + a.ez * t;
    }
    // Limite d'onglet : un angle très aigu enverrait le sommet au loin
    if (Math.hypot(x - pts[i][0], z - pts[i][1]) > Math.abs(d) * 3.2) return null;
    out.push([x, z]);
  }
  let a2 = 0;
  for (let i = 0; i < n; i++) {
    const [x1, z1] = out[i], [x2, z2] = out[(i + 1) % n];
    a2 += x1 * z2 - x2 * z1;
    // chaque arête garde son sens (sinon le polygone s'est retourné)
    const ox = pts[(i + 1) % n][0] - pts[i][0], oz = pts[(i + 1) % n][1] - pts[i][1];
    if ((x2 - x1) * ox + (z2 - z1) * oz <= 0) return null;
  }
  if (Math.sign(a2) !== Math.sign(area)) return null;
  if (d > 0 && Math.abs(a2) < Math.abs(area) * 0.15) return null;
  return out;
}

// Atlas 2 cases (u ∈ [0;0,5[ zinc + lucarne, [0,5;1[ tuiles canal), en
// niveaux de gris clairs : la couleur de sommet (zinc bleuté, terre cuite)
// donne la teinte, la texture le relief.
function makeRoofAtlas() {
  const W = 512, H = 256;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d');
  // --- Zinc à joints debout + lucarne (case 256×256 = un module de fenêtre)
  g.fillStyle = '#d6dade';
  g.fillRect(0, 0, 256, 256);
  for (let x = 0; x < 256; x += 32) {
    g.fillStyle = 'rgba(70,76,86,0.55)';
    g.fillRect(x, 0, 3, 256);
    g.fillStyle = 'rgba(255,255,255,0.5)';
    g.fillRect(x + 3, 0, 2, 256);
  }
  // Coulures / patine
  for (let i = 0; i < 40; i++) {
    g.fillStyle = `rgba(90,96,104,${0.04 + (i % 5) * 0.012})`;
    g.fillRect((i * 97) % 256, (i * 53) % 200, 6 + (i % 4) * 4, 40 + (i % 7) * 10);
  }
  // Lucarne : jouées de pierre, fronton cintré, vitre sombre à petits bois
  const lx = 92, lw = 72, ly = 70, lh = 120; // canvas : y vers le bas (haut du toit = 0)
  g.fillStyle = 'rgba(40,40,44,0.45)'; // ombre portée sous la lucarne
  g.fillRect(lx + 6, ly + 12, lw, lh);
  g.fillStyle = '#f2ece0';
  g.fillRect(lx, ly, lw, lh);
  g.beginPath();
  g.arc(lx + lw / 2, ly + 2, lw / 2 + 6, Math.PI, 0);
  g.fill();
  g.fillStyle = '#1f2833';
  g.fillRect(lx + 12, ly + 14, lw - 24, lh - 30);
  g.fillStyle = '#e8e2d4';
  g.fillRect(lx + lw / 2 - 2, ly + 14, 4, lh - 30);
  g.fillRect(lx + 12, ly + 50, lw - 24, 4);
  g.fillStyle = '#b9b2a4';
  g.fillRect(lx - 4, ly + lh - 14, lw + 8, 10); // appui
  // --- Tuiles canal : rangées horizontales de tuiles rondes
  const ox = 256;
  g.fillStyle = '#e4d6cc';
  g.fillRect(ox, 0, 256, 256);
  for (let row = 0; row < 8; row++) {
    const y = row * 32;
    g.fillStyle = 'rgba(60,30,20,0.55)';
    g.fillRect(ox, y + 26, 256, 6); // ombre du recouvrement
    for (let k = 0; k < 9; k++) {
      const x = ox + k * 32 + (row % 2 ? 16 : 0) - 16;
      const grad = g.createLinearGradient(x, 0, x + 28, 0);
      grad.addColorStop(0, 'rgba(120,70,50,0.6)');
      grad.addColorStop(0.45, 'rgba(255,240,228,0.35)');
      grad.addColorStop(1, 'rgba(110,60,40,0.6)');
      g.fillStyle = grad;
      g.fillRect(x + 2, y, 26, 27);
      // variations de cuisson d'une tuile à l'autre
      g.fillStyle = `rgba(${150 + ((k * 37 + row * 11) % 60)},${90 + ((k * 13) % 40)},70,0.18)`;
      g.fillRect(x + 2, y, 26, 27);
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

// Matériau des pans de toit : la case d'atlas est choisie par sommet
// (attribut `atlas`), la répétition se fait dans le fragment (fract) avec
// des dérivées explicites pour éviter les liserés de mip aux raccords.
export function makeRoofSlopeMaterial(pbr) {
  const params = { vertexColors: true, map: makeRoofAtlas() };
  const mat = pbr
    ? new THREE.MeshStandardMaterial({ ...params, roughness: 0.78, metalness: 0.05, envMapIntensity: 0.5 })
    : new THREE.MeshLambertMaterial(params);
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float atlas;\nvarying float vAtlas;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\nvAtlas = atlas;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vAtlas;')
      .replace('#include <map_fragment>', `
        #ifdef USE_MAP
          vec2 auv = vec2(fract(vMapUv.x) * 0.5 + vAtlas, fract(vMapUv.y));
          vec4 sampledDiffuseColor = textureGrad(map, auv,
            dFdx(vMapUv) * vec2(0.5, 1.0), dFdy(vMapUv) * vec2(0.5, 1.0));
          diffuseColor *= sampledDiffuseColor;
        #endif`);
  };
  mat.customProgramCacheKey = () => 'roofAtlas';
  return mat;
}

// Ajoute toiture + corniche d'un immeuble dans les accumulateurs de tuile.
// pts : empreinte (sens horaire, comme les murs), y1 : haut des murs.
// Retourne { yTop, inset } (yTop = altitude du terrasson, pour colliders
// et superstructures).
export function addRoof(tile, pts, y1, { kind, roofColor, stoneColor, cornice }) {
  // Points trop proches retirés (les arêtes minuscules cassent le décalage)
  const p = [];
  for (const q of pts) {
    const last = p[p.length - 1];
    if (!last || Math.hypot(q[0] - last[0], q[1] - last[1]) > 0.3) p.push(q);
  }
  if (p.length > 3 && Math.hypot(p[0][0] - p[p.length - 1][0], p[0][1] - p[p.length - 1][1]) < 0.3) p.pop();

  const tri = (arr, col, c, a, b, d, wantY) => {
    // triangle (a, b, d) orienté pour que sa normale ait le signe voulu
    // (wantY : +1 vers le ciel, -1 vers le sol, 0 = face extérieure, gérée
    // par l'ordre fourni)
    let B = b, D = d;
    if (wantY) {
      const ny = (D[2] - a[2]) * (B[0] - a[0]) - (D[0] - a[0]) * (B[2] - a[2]);
      if (Math.sign(ny) !== wantY) { B = d; D = b; }
    }
    arr.push(...a, ...B, ...D);
    for (let k = 0; k < 3; k++) col.push(c.r, c.g, c.b);
  };
  const flat = (poly, y, c) => {
    try {
      const tris = THREE.ShapeUtils.triangulateShape(poly.map(([x, z]) => new THREE.Vector2(x, z)), []);
      for (const [a, b, d] of tris) {
        tri(tile.rp, tile.rc, c, [poly[a][0], y, poly[a][1]], [poly[b][0], y, poly[b][1]], [poly[d][0], y, poly[d][1]], 1);
      }
    } catch { /* empreinte dégénérée */ }
  };
  // Quad vertical comme les murs : (bas1, bas2, haut2) = face extérieure
  const wallQuad = (arr, col, c, a, b, ya, yb, a2 = a, b2 = b) => {
    arr.push(a[0], ya, a[1], b[0], ya, b[1], b2[0], yb, b2[1],
      a[0], ya, a[1], b2[0], yb, b2[1], a2[0], yb, a2[1]);
    for (let k = 0; k < 6; k++) col.push(c.r, c.g, c.b);
  };

  // Corniche : bandeau saillant en pierre au sommet des murs
  if (cornice && p.length >= 3) {
    const out = insetPolygon(p, -0.32);
    if (out) {
      const yc = y1 - 0.34, yt = y1 + 0.05;
      for (let i = 0; i < p.length; i++) {
        const j = (i + 1) % p.length;
        wallQuad(tile.rp, tile.rc, stoneColor, out[i], out[j], yc, yt);
        // sous-face (vers le sol) et dessus (vers le ciel)
        const P1 = [p[i][0], yc, p[i][1]], P2 = [p[j][0], yc, p[j][1]];
        const O1 = [out[i][0], yc, out[i][1]], O2 = [out[j][0], yc, out[j][1]];
        tri(tile.rp, tile.rc, stoneColor, P1, P2, O2, -1);
        tri(tile.rp, tile.rc, stoneColor, P1, O2, O1, -1);
        const T = (q) => [q[0], yt, q[2]];
        tri(tile.rp, tile.rc, stoneColor, T(P1), T(P2), T(O2), 1);
        tri(tile.rp, tile.rc, stoneColor, T(P1), T(O2), T(O1), 1);
      }
    }
  }

  let inset = null, d = 0;
  if (kind !== 'plat' && p.length >= 3) {
    for (const dd of kind === 'zinc' ? [1.5, 1.1] : [3, 2.2, 1.5]) {
      inset = insetPolygon(p, dd);
      if (inset) { d = dd; break; }
    }
  }
  if (!inset) {
    flat(p, y1, roofColor);
    return { yTop: y1, inset: null, poly: p };
  }
  const zinc = kind === 'zinc';
  const mh = zinc ? 2.4 : d * 0.42; // mansarde raide / tuiles à ~23°
  const yTop = y1 + mh;
  const slopeLen = Math.hypot(d, mh);
  const atlas = zinc ? 0 : 0.5;
  for (let i = 0; i < p.length; i++) {
    const j = (i + 1) % p.length;
    const len = Math.hypot(p[j][0] - p[i][0], p[j][1] - p[i][1]);
    // zinc : un module de lucarne par travée de fenêtre (aligné sur la
    // façade) ; tuiles : ~2 m de tuile par répétition
    const u = zinc ? Math.max(1, Math.round(len / 3)) : len / 2;
    const v = zinc ? 1 : slopeLen / 1.6;
    wallQuad(tile.sp, tile.sc, roofColor, p[i], p[j], y1, yTop, inset[i], inset[j]);
    tile.suv.push(0, 0, u, 0, u, v, 0, 0, u, v, 0, v);
    for (let k = 0; k < 6; k++) tile.sa.push(atlas);
  }
  // Terrasson : zinc plus sombre, ou faîtage de tuiles
  const topC = roofColor.clone().multiplyScalar(zinc ? 0.82 : 0.9);
  flat(inset, yTop, topC);
  return { yTop, inset, poly: p };
}
