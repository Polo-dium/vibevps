import * as THREE from 'three';
import { makeRand } from './layout.js';

// LE GRAND THÉÂTRE GALLO-ROMAIN DE FOURVIÈRE (Lugdunum, 15 av. J.-C.), à sa
// vraie place sur la colline : cavea en hémicycle de gradins de pierre,
// orchestre au sol de marbre, pulpitum (mur de scène à niches) et quelques
// colonnes du frons scaenae encore debout. Les gradins regardent l'est : du
// haut de la cavea, on voit la ville par-dessus la scène, comme en vrai.
//
// Tout est PRATICABLE : le relief est réécrit dans l'emprise (ctx.terrain-
// Height renvoie la hauteur du rang sous les pieds), si bien qu'on descend
// et remonte les gradins en marchant. Des collisions ferment les murs qui
// dominent le terrain (arrière de la cavea, flancs) : on entre par
// l'orchestre ou par le haut, pas en se « téléportant » sur un mur.
//
// Deux temps : planTheatre() AVANT le maillage du relief (il doit connaître
// la nouvelle forme du sol), buildTheatre() ensuite pour la géométrie.

// Coordonnées réelles (centre de l'orchestre), même projection que
// tools/fetch-osm.mjs
const LAT = 45.75958, LON = 4.81975;

export function theatreCenter(scale = 0.5) {
  return {
    x: (LON - 4.8320) * 111320 * Math.cos((45.7578 * Math.PI) / 180) * scale,
    z: (45.7578 - LAT) * 111132 * scale,
  };
}

// base(x, z) : relief naturel (colline) — sert à orienter l'hémicycle face
// à la pente et à raccorder l'esplanade au terrain alentour.
export function planTheatre(base, scale = 0.5) {
  const { x: cx, z: cz } = theatreCenter(scale);
  // L'axe suit la pente : la scène en contrebas (vers la ville), les
  // gradins adossés à la colline
  const e = 2;
  const gx = base(cx + e, cz) - base(cx - e, cz);
  const gz = base(cx, cz + e) - base(cx, cz - e);
  const gl = Math.hypot(gx, gz) || 1;
  const fx = -gx / gl, fz = -gz / gl; // vers la scène (descente)
  const sx = -fz, sz = fx; // en travers

  const P = {
    cx, cz, fx, fz, sx, sz,
    // Orchestre creusé de 4 m sous le terrain naturel
    y0: base(cx, cz) - 4,
    R0: 9.5, // rayon de l'orchestre
    N: 28, // rangs de gradins
    depth: 0.92, // profondeur d'un rang
    rise: 0.42, // hauteur d'un rang (une marche franchissable)
    A_END: 1.2, // les gradins s'arrêtent un peu au-delà du diamètre
    A_STAGE: 9, // fond de la scène (pulpitum)
    BW: 13, // demi-largeur de la scène
    A_T: 14, // fond de l'esplanade derrière la scène
    RAMP: 10, // longueur des rampes qui rejoignent le terrain
  };
  P.R = P.R0 + P.N * P.depth;
  P.top = P.y0 + 0.5 + (P.N - 1) * P.rise; // dernier rang
  P.stageY = P.y0 + 1.4;

  P.local = (x, z) => {
    const dx = x - cx, dz = z - cz;
    return [dx * fx + dz * fz, dx * sx + dz * sz];
  };
  P.world = (a, b) => [cx + a * fx + b * sx, cz + a * fz + b * sz];
  P.rowTop = (i) => P.y0 + 0.5 + i * P.rise;
  P.rowAt = (r) => Math.min(P.N - 1, Math.floor((r - P.R0) / P.depth));

  const smooth = (t) => t * t * (3 - 2 * t);
  // Distance à l'esplanade (orchestre + scène + dégagements) pour les rampes
  const terraceDist = (a, b) => {
    const da = a > P.A_T ? a - P.A_T : 0;
    const db = Math.max(0, Math.abs(b) - P.R);
    return Math.hypot(da, db);
  };

  // Hauteur du sol dans l'emprise (null = hors théâtre, relief naturel)
  P.ground = (x, z) => {
    const [a, b] = P.local(x, z);
    if (a < -P.R - 1 || a > P.A_T + P.RAMP + 1 || Math.abs(b) > P.R + P.RAMP + 1) return null;
    const r = Math.hypot(a, b);
    if (a <= P.A_END) {
      if (r < P.R0) return P.y0;
      if (r <= P.R) return P.rowTop(P.rowAt(r));
      return null; // derrière la cavea : la colline
    }
    if (a <= P.A_STAGE && Math.abs(b) <= P.BW) return P.stageY;
    const d = terraceDist(a, b);
    if (d <= 0) return P.y0;
    if (d < P.RAMP) {
      const nat = base(x, z);
      return P.y0 + (nat - P.y0) * smooth(d / P.RAMP);
    }
    return null;
  };

  // Hauteur pour le MAILLAGE du relief (maille ~10 m) : toujours sous les
  // gradins et le dallage, sinon ses grands triangles transperceraient les
  // premiers rangs. Les vraies surfaces visibles sont la géométrie du théâtre.
  P.meshGround = (x, z, h) => {
    const [a, b] = P.local(x, z);
    const r = Math.hypot(a, b);
    if (a <= P.A_END && r <= P.R + 1) {
      // Plafond aussi près du FLANC : les grands triangles qui enjambent le
      // flanc (gradins hauts ↔ dallage bas) ne doivent pas ressortir à côté
      const cone = P.y0 - 1 + Math.max(0, r - P.R0) * (P.rise / P.depth);
      const flank = P.y0 - 1 + (P.A_END - a) * 0.45;
      return Math.min(h, cone, flank);
    }
    if (a > P.A_END - 0.5 && a <= P.A_T + 1 && Math.abs(b) <= P.R + 1) return Math.min(h, P.y0 - 1);
    return h;
  };

  // Emprise à garder libre (bâtiments, arbres, rues, lampadaires)
  P.covers = (x, z) => {
    const [a, b] = P.local(x, z);
    if (a <= P.A_END) return Math.hypot(a, b) <= P.R + 4;
    return a <= P.A_T + P.RAMP && Math.abs(b) <= P.R + P.RAMP;
  };
  const corners = [[-P.R - 4, -P.R - 10], [-P.R - 4, P.R + 10], [P.A_T + P.RAMP, -P.R - 10], [P.A_T + P.RAMP, P.R + 10]]
    .map(([a, b]) => P.world(a, b));
  P.rect = {
    minX: Math.min(...corners.map((c) => c[0])), maxX: Math.max(...corners.map((c) => c[0])),
    minZ: Math.min(...corners.map((c) => c[1])), maxZ: Math.max(...corners.map((c) => c[1])),
    contains: (x, z) => P.covers(x, z),
  };
  P.base = base;
  return P;
}

// --- Textures procédurales -------------------------------------------------

function canvasTex(w, h, draw, repeat = true) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

// Calcaire de Fourvière : assises de blocs, joints, patine et lichens
function stoneTexture() {
  const rand = makeRand(1715);
  return canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = '#bfb197';
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 2600; i++) {
      const v = 150 + rand() * 70;
      g.fillStyle = `rgba(${v},${v * 0.94},${v * 0.82},${0.08 + rand() * 0.12})`;
      g.fillRect(rand() * w, rand() * h, 1 + rand() * 6, 1 + rand() * 3);
    }
    // Assises : 4 rangs de blocs de longueurs variées
    g.strokeStyle = 'rgba(70,60,48,0.55)';
    g.lineWidth = 2;
    for (let row = 0; row < 4; row++) {
      const y = row * 64;
      g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke();
      let x = rand() * 60;
      while (x < w) {
        g.beginPath(); g.moveTo(x, y); g.lineTo(x, y + 64); g.stroke();
        x += 50 + rand() * 90;
      }
    }
    // Usure et taches sombres
    for (let i = 0; i < 40; i++) {
      const x = rand() * w, y = rand() * h, r = 6 + rand() * 22;
      const grad = g.createRadialGradient(x, y, 0, x, y, r);
      grad.addColorStop(0, `rgba(${rand() < 0.3 ? '90,100,70' : '80,70,58'},0.22)`);
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = grad;
      g.fillRect(x - r, y - r, r * 2, r * 2);
    }
  });
}

// Orchestre en opus sectile : dalles de marbre polychrome (comme le sol
// restauré du vrai théâtre)
function marbleTexture() {
  const rand = makeRand(27);
  const cols = ['#d9d2c3', '#c9b48f', '#9a6b5a', '#7d8a7a', '#e8e2d6', '#b68a6b'];
  return canvasTex(256, 256, (g, w, h) => {
    const n = 8, s = w / n;
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        g.fillStyle = cols[Math.floor(rand() * cols.length)];
        g.fillRect(i * s, j * s, s, s);
        // losange central d'une autre teinte
        g.fillStyle = cols[(i + j) % cols.length];
        g.beginPath();
        g.moveTo(i * s + s / 2, j * s + 4); g.lineTo(i * s + s - 4, j * s + s / 2);
        g.lineTo(i * s + s / 2, j * s + s - 4); g.lineTo(i * s + 4, j * s + s / 2);
        g.closePath(); g.fill();
        g.strokeStyle = 'rgba(40,32,26,0.5)';
        g.lineWidth = 1.5;
        g.strokeRect(i * s, j * s, s, s);
      }
    }
    for (let i = 0; i < 900; i++) {
      g.fillStyle = `rgba(255,255,255,${rand() * 0.08})`;
      g.fillRect(rand() * w, rand() * h, 1 + rand() * 3, 1);
    }
  });
}

// Façade extérieure de la cavea : arcades sur pilastres
function arcadeTexture() {
  return canvasTex(128, 128, (g, w, h) => {
    g.fillStyle = '#b8a98d';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#3a3128';
    g.beginPath();
    g.moveTo(26, h);
    g.lineTo(26, 58);
    g.arc(64, 58, 38, Math.PI, 0);
    g.lineTo(102, h);
    g.closePath();
    g.fill();
    g.strokeStyle = 'rgba(70,60,48,0.6)';
    g.lineWidth = 2;
    for (let y = 16; y < h; y += 22) { g.beginPath(); g.moveTo(0, y); g.lineTo(24, y); g.moveTo(104, y); g.lineTo(w, y); g.stroke(); }
    g.lineWidth = 3;
    g.beginPath(); g.arc(64, 58, 44, Math.PI, 0); g.stroke();
  });
}

// Mur du pulpitum : niches alternées rectangulaires et semi-circulaires
function pulpitumTexture() {
  return canvasTex(256, 64, (g, w, h) => {
    g.fillStyle = '#c4b598';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#5b4e40';
    for (let i = 0; i < 4; i++) {
      const x = i * 64 + 16;
      if (i % 2) {
        g.beginPath(); g.moveTo(x, h - 8); g.lineTo(x, 30); g.arc(x + 16, 30, 16, Math.PI, 0); g.lineTo(x + 32, h - 8); g.fill();
      } else {
        g.fillRect(x, 18, 32, h - 26);
      }
    }
    g.fillStyle = '#d8ccb2';
    g.fillRect(0, 0, w, 7); // corniche
  });
}

// --- Géométrie -------------------------------------------------------------

// Accumulateur de quads (triangles non indexés) avec UV + couleur
function builder() {
  const pos = [], uv = [], col = [];
  const tri = (p, t, c) => {
    for (let k = 0; k < 3; k++) {
      pos.push(...p[k]);
      uv.push(...t[k]);
      col.push(c[0], c[1], c[2]);
    }
  };
  return {
    // p0..p3 dans l'ordre anti-horaire vu de la face visible
    quad(p0, p1, p2, p3, t0, t1, t2, t3, c = [1, 1, 1]) {
      tri([p0, p1, p2], [t0, t1, t2], c);
      tri([p0, p2, p3], [t0, t2, t3], c);
    },
    geometry() {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
      g.computeVertexNormals();
      return g;
    },
    get empty() { return pos.length === 0; },
  };
}

export function buildTheatre(ctx, P) {
  const group = new THREE.Group();
  const W = (a, b, y) => { const [x, z] = P.world(a, b); return [x, y, z]; };
  const phiMax = (r) => Math.acos(Math.max(-1, Math.min(1, -P.A_END / r)));
  // Point polaire : φ = 0 au fond de la cavea (direction -f)
  const polar = (r, phi, y) => W(-r * Math.cos(phi), r * Math.sin(phi), y);
  const SEG = 84;

  // GRADINS : assise (dessus) + contremarche (face avant) de chaque rang,
  // flancs fermés le long du diamètre, façade à arcades à l'arrière.
  const stone = builder();
  const rand = makeRand(4403);
  for (let i = 0; i < P.N; i++) {
    const r0 = P.R0 + i * P.depth, r1 = r0 + P.depth;
    const h = P.rowTop(i), hPrev = i === 0 ? P.y0 : P.rowTop(i - 1);
    const p0 = phiMax(r0), p1 = phiMax(r1);
    // Le palier (praecinctio) qui sépare les deux étages est plus clair
    const shade = i === 13 ? 1.12 : 0.93 + rand() * 0.1;
    const cTop = [shade, shade, shade * 0.98];
    const cFront = [shade * 0.82, shade * 0.8, shade * 0.76];
    for (let s = 0; s < SEG; s++) {
      const t0 = -1 + (2 * s) / SEG, t1 = -1 + (2 * (s + 1)) / SEG;
      const a0 = t0 * p0, a1 = t1 * p0, b0 = t0 * p1, b1 = t1 * p1;
      const u0 = (a0 * r0) / 2, u1 = (a1 * r0) / 2;
      // Assise (vue du dessus)
      stone.quad(polar(r0, a0, h), polar(r0, a1, h), polar(r1, b1, h), polar(r1, b0, h),
        [u0, r0 / 2], [u1, r0 / 2], [(b1 * r1) / 2, r1 / 2], [(b0 * r1) / 2, r1 / 2], cTop);
      // Contremarche (regarde l'orchestre)
      stone.quad(polar(r0, a1, hPrev), polar(r0, a0, hPrev), polar(r0, a0, h), polar(r0, a1, h),
        [u1, hPrev / 2], [u0, hPrev / 2], [u0, h / 2], [u1, h / 2], cFront);
    }
    // Flancs : face plane le long du diamètre, du rang jusqu'au dallage
    for (const side of [-1, 1]) {
      const bIn = side * Math.sqrt(Math.max(0, r0 * r0 - P.A_END * P.A_END));
      const bOut = side * Math.sqrt(Math.max(0, r1 * r1 - P.A_END * P.A_END));
      const q = [W(P.A_END, bIn, P.y0 - 0.5), W(P.A_END, bOut, P.y0 - 0.5), W(P.A_END, bOut, h), W(P.A_END, bIn, h)];
      const uv = [[bIn / 2, 0], [bOut / 2, 0], [bOut / 2, h / 2], [bIn / 2, h / 2]];
      if (side > 0) stone.quad(q[0], q[1], q[2], q[3], ...uv, cFront);
      else stone.quad(q[1], q[0], q[3], q[2], uv[1], uv[0], uv[3], uv[2], cFront);
    }
  }
  // Escaliers (scalae) : demi-marches dans 7 allées rayonnantes
  for (let k = 0; k < 7; k++) {
    const phi = (-1 + (2 * (k + 0.5)) / 7) * Math.PI * 0.47;
    for (let i = 0; i < P.N; i++) {
      const r0 = P.R0 + i * P.depth, rm = r0 + P.depth / 2;
      const hPrev = i === 0 ? P.y0 : P.rowTop(i - 1);
      const hs = hPrev + P.rise / 2 + (i === 0 ? 0.04 : 0);
      if (i === 0 && hs <= P.y0) continue;
      const dphi = 0.6 / rm;
      const c = [0.86, 0.84, 0.8];
      // dessus de la demi-marche
      stone.quad(polar(r0 - 0.002, phi - dphi, hs), polar(r0 - 0.002, phi + dphi, hs),
        polar(rm, phi + dphi, hs), polar(rm, phi - dphi, hs), [0, 0], [0.6, 0], [0.6, 0.25], [0, 0.25], c);
      // nez de marche
      stone.quad(polar(r0 - 0.002, phi + dphi, hPrev), polar(r0 - 0.002, phi - dphi, hPrev),
        polar(r0 - 0.002, phi - dphi, hs), polar(r0 - 0.002, phi + dphi, hs), [0, 0], [0.6, 0], [0.6, 0.1], [0, 0.1], c);
      const hTop = P.rowTop(i);
      // contremarche intermédiaire (du dessus de la demi-marche au rang)
      stone.quad(polar(rm, phi + dphi, hs), polar(rm, phi - dphi, hs),
        polar(rm, phi - dphi, hTop), polar(rm, phi + dphi, hTop), [0, 0], [0.6, 0], [0.6, 0.1], [0, 0.1], c);
    }
  }
  // Double face : surfaces ouvertes vues des deux côtés (flancs, parapet) ;
  // three.js retourne la normale côté envers, l'éclairage reste juste
  const stoneMat = new THREE.MeshLambertMaterial({ map: stoneTexture(), vertexColors: true, side: THREE.DoubleSide });
  const cavea = new THREE.Mesh(stone.geometry(), stoneMat);
  cavea.castShadow = true;
  cavea.receiveShadow = true;
  group.add(cavea);

  // FAÇADE ARRIÈRE à arcades + parapet du dernier rang
  const facade = builder();
  const pR = phiMax(P.R);
  for (let s = 0; s < SEG; s++) {
    const t0 = -1 + (2 * s) / SEG, t1 = -1 + (2 * (s + 1)) / SEG;
    const a0 = t0 * pR, a1 = t1 * pR;
    const [x0, , z0] = polar(P.R, a0, 0), [x1, , z1] = polar(P.R, a1, 0);
    const g0 = Math.min(P.top, P.base(x0, z0)) - 1.5, g1 = Math.min(P.top, P.base(x1, z1)) - 1.5;
    const topY = P.top + 1.0; // parapet
    const u0 = (a0 * P.R) / 4.2, u1 = (a1 * P.R) / 4.2;
    const vs = (y) => (y - P.y0) / 4.2;
    // face extérieure (normale vers l'extérieur)
    facade.quad(polar(P.R, a1, g1), polar(P.R, a0, g0), polar(P.R, a0, topY), polar(P.R, a1, topY),
      [u1, vs(g1)], [u0, vs(g0)], [u0, vs(topY)], [u1, vs(topY)]);
    // face intérieure du parapet + chaperon
    facade.quad(polar(P.R - 0.01, a0, P.top), polar(P.R - 0.01, a1, P.top), polar(P.R - 0.01, a1, topY), polar(P.R - 0.01, a0, topY),
      [u0, 0], [u1, 0], [u1, 0.2], [u0, 0.2], [0.9, 0.88, 0.84]);
    facade.quad(polar(P.R - 0.01, a1, topY), polar(P.R - 0.01, a0, topY), polar(P.R + 0.5, a0, topY), polar(P.R + 0.5, a1, topY),
      [u1, 0], [u0, 0], [u0, 0.1], [u1, 0.1], [0.95, 0.93, 0.9]);
  }
  const facadeMesh = new THREE.Mesh(facade.geometry(), new THREE.MeshLambertMaterial({ map: arcadeTexture(), vertexColors: true, side: THREE.DoubleSide }));
  facadeMesh.castShadow = true;
  facadeMesh.receiveShadow = true;
  group.add(facadeMesh);

  // DALLAGE : orchestre en marbre (demi-disque), esplanade en dalles
  const floor = builder();
  const fy = P.y0 + 0.02;
  const pO = phiMax(P.R0);
  for (let s = 0; s < 48; s++) {
    const a0 = (-1 + (2 * s) / 48) * pO, a1 = (-1 + (2 * (s + 1)) / 48) * pO;
    const c = W(0, 0, fy), e0 = polar(P.R0, a0, fy), e1 = polar(P.R0, a1, fy);
    const uvOf = (p) => { const [a, b] = P.local(p[0], p[2]); return [b / 3, a / 3]; };
    floor.quad(c, e1, e0, c, uvOf(c), uvOf(e1), uvOf(e0), uvOf(c));
  }
  const floorMesh = new THREE.Mesh(floor.geometry(), new THREE.MeshLambertMaterial({ map: marbleTexture(), vertexColors: true, side: THREE.DoubleSide }));
  floorMesh.receiveShadow = true;
  group.add(floorMesh);

  const paving = builder();
  const strip = (a0, a1, b0, b1) => paving.quad(W(a0, b0, fy - 0.005), W(a0, b1, fy - 0.005), W(a1, b1, fy - 0.005), W(a1, b0, fy - 0.005),
    [b0 / 4, a0 / 4], [b1 / 4, a0 / 4], [b1 / 4, a1 / 4], [b0 / 4, a1 / 4], [0.92, 0.9, 0.86]);
  // devant les gradins (bande de l'orchestre jusqu'aux flancs), dégagements
  // latéraux et cour derrière la scène
  strip(-0.2, P.A_STAGE, -P.R, -P.BW);
  strip(-0.2, P.A_STAGE, P.BW, P.R);
  strip(0, P.A_END + 0.01, -P.BW, P.BW);
  strip(P.A_STAGE, P.A_T, -P.R, P.R);
  // L'orchestre continue sous la scène jusqu'au diamètre (aucun trou)
  const pavingMesh = new THREE.Mesh(paving.geometry(), stoneMat);
  pavingMesh.receiveShadow = true;
  group.add(pavingMesh);

  // PULPITUM : la scène de pierre, mur avant à niches
  const pul = builder();
  const sy = P.stageY, by = P.y0 - 0.3;
  const A0 = P.A_END, A1 = P.A_STAGE, B = P.BW;
  const pu = (b) => b / 4;
  pul.quad(W(A0, B, by), W(A0, -B, by), W(A0, -B, sy), W(A0, B, sy), [pu(B), 0], [pu(-B), 0], [pu(-B), 1], [pu(B), 1]); // face avant
  pul.quad(W(A1, -B, by), W(A1, B, by), W(A1, B, sy), W(A1, -B, sy), [0, 0], [6, 0], [6, 1], [0, 1]); // arrière
  pul.quad(W(A0, -B, by), W(A1, -B, by), W(A1, -B, sy), W(A0, -B, sy), [0, 0], [2, 0], [2, 1], [0, 1]);
  pul.quad(W(A1, B, by), W(A0, B, by), W(A0, B, sy), W(A1, B, sy), [0, 0], [2, 0], [2, 1], [0, 1]);
  const pulMesh = new THREE.Mesh(pul.geometry(), new THREE.MeshLambertMaterial({ map: pulpitumTexture(), vertexColors: true, side: THREE.DoubleSide }));
  pulMesh.castShadow = true;
  pulMesh.receiveShadow = true;
  group.add(pulMesh);
  // Plancher de scène moderne (noir mat) posé sur le pulpitum
  const deck = new THREE.Mesh(
    new THREE.BoxGeometry(A1 - A0, 0.12, 2 * B),
    new THREE.MeshStandardMaterial({ color: 0x151414, roughness: 0.62, metalness: 0.05 })
  );
  deck.position.set(...W((A0 + A1) / 2, 0, sy - 0.05));
  deck.rotation.y = Math.atan2(-P.fz, P.fx);
  deck.receiveShadow = true;
  group.add(deck);

  // COLONNES du frons scaenae, certaines tronquées (ruines)
  const colRand = makeRand(88);
  const colGeo = new THREE.CylinderGeometry(0.42, 0.46, 1, 14);
  colGeo.translate(0, 0.5, 0);
  const cols = [];
  for (let b = -B + 1; b <= B - 1; b += 3.2) {
    if (Math.abs(b) < 7.5) continue; // l'écran occupe le centre
    cols.push([b, 4 + colRand() * 4.5]);
  }
  const colMesh = new THREE.InstancedMesh(colGeo, new THREE.MeshLambertMaterial({ color: 0x9b8f8c }), cols.length);
  const m = new THREE.Matrix4();
  cols.forEach(([b, h], k) => {
    const [x, , z] = W(A1 + 1.2, b, 0);
    m.compose(new THREE.Vector3(x, P.y0, z), new THREE.Quaternion(), new THREE.Vector3(1, h, 1));
    colMesh.setMatrixAt(k, m);
  });
  colMesh.castShadow = true;
  colMesh.receiveShadow = true;
  group.add(colMesh);

  ctx.scene.add(group);

  // COLLISIONS : murs qui dominent le terrain d'à côté
  const wall = (x, z, half, minY, maxY) => ctx.colliders.push({
    minX: x - half, maxX: x + half, minY, maxY, minZ: z - half, maxZ: z + half,
  });
  // Arrière de la cavea (du dehors, le dernier rang domine la colline)
  const arc = Math.ceil((2 * pR * P.R) / 0.9);
  for (let k = 0; k <= arc; k++) {
    const [x, , z] = polar(P.R + 0.35, (-1 + (2 * k) / arc) * pR, 0);
    wall(x, z, 0.45, P.base(x, z) - 3, P.top + 1.0);
  }
  // Flancs : du dégagement latéral, on ne grimpe pas sur les rangs hauts
  for (const side of [-1, 1]) {
    for (let b = P.R0 + P.depth; b <= P.R; b += 0.8) {
      const r = Math.hypot(P.A_END, b);
      const h = P.rowTop(P.rowAt(r));
      if (h < P.y0 + 0.55) continue;
      const [x, z] = P.world(P.A_END + 0.4, side * b);
      wall(x, z, 0.42, P.y0 - 1, h);
    }
  }
  // Le pulpitum : on y monte par les côtés (1,4 m d'un saut), pas en marchant
  for (let b = -B; b <= B; b += 0.8) {
    const [x, z] = P.world(A0 - 0.3, b);
    wall(x, z, 0.35, P.y0 - 1, P.stageY);
  }
  return group;
}
