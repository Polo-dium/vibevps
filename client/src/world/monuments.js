import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { lyonXZ } from './squares.js';
import { makeRand } from './layout.js';
import { sculpt, paint } from '../render/sculpt.js';
import { detail } from '../render/detail.js';
import { landmarkFog } from '../render/atmosphere.js';

// MONUMENTS DE LA PRESQU'ÎLE ET DU VIEUX LYON (ville OSM). Les données OSM
// n'ont que des empreintes + une hauteur : la cathédrale Saint-Jean, l'Hôtel
// de Ville ou l'Opéra sortaient en immeubles de trois étages à fenêtres
// carrées. On repère leur empreinte (un point GPS à l'intérieur), on la retire
// de la ville extrudée (b.monument, voir buildOsmBuildings) et on bâtit à la
// place le vrai profil, orienté sur l'axe principal de l'empreinte :
//   - cathédrale Saint-Jean : façade plate à trois portails et rosace,
//     deux tours carrées, tours du transept, nef haute, abside à chapelles ;
//   - église Saint-Nizier : deux clochers à flèche gothique ;
//   - Hôtel de Ville : quadrilatère à cour, pavillons d'angle coiffés
//     d'ardoise, beffroi à dôme et horloge face aux Terreaux ;
//   - Opéra : socle néoclassique à arcades, huit Muses sur l'attique, voûte
//     de verre noir de Jean Nouvel qui rougeoie la nuit ;
//   - Palais de Justice : péristyle des 24 colonnes face à la Saône ;
//   - Hôtel-Dieu : avant-corps et grand dôme de Soufflot côté Rhône (ajouté
//     sur l'immeuble OSM, gardé tel quel).
// Tout est fusionné par matériau : ~5 draw calls par monument, zéro asset.
//
// Échelle : l'emprise au sol de la ville OSM est à 1/2, les hauteurs des
// immeubles sont à peu près réelles. Les monuments gardent ~0,6 × leur vraie
// hauteur : ils dominent la rue sans écraser leur emprise.

const UP = new THREE.Vector3(0, 1, 0);
// Tuile de la façade à fenêtres : 2 travées × 2 niveaux
const FAC = [5.2, 8];

// ---------------------------------------------------------------- textures

// Pierre de taille : assises régulières, blocs de longueurs variées, joints
// fins, coulures d'usure. Une tuile = 3 m. Teintée par couleur de sommet.
export function ashlarTexture() {
  const S = 256;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  const rand = makeRand(4411);
  g.fillStyle = '#e4ddcf';
  g.fillRect(0, 0, S, S);
  const CH = 32; // 8 assises par tuile (≈ 37 cm)
  for (let r = 0; r < S / CH; r++) {
    let x = -rand() * 60;
    while (x < S) {
      const w = 44 + rand() * 54;
      const v = 228 + (rand() - 0.5) * 20;
      g.fillStyle = `rgb(${v},${v - 4},${v - 11})`;
      // le bloc qui déborde à droite est repeint à gauche (tuile sans raccord)
      for (const off of [0, -S]) g.fillRect(x + off + 1, r * CH + 1, w - 2, CH - 2);
      x += w;
    }
  }
  for (let i = 0; i < 1800; i++) {
    g.fillStyle = rand() < 0.5 ? 'rgba(70,62,50,0.10)' : 'rgba(255,255,248,0.10)';
    g.fillRect(rand() * S, rand() * S, 2, 2);
  }
  // coulures verticales (pluie sur la pierre)
  for (let i = 0; i < 14; i++) {
    const x = rand() * S, w = 3 + rand() * 10;
    const grd = g.createLinearGradient(0, 0, 0, S);
    grd.addColorStop(0, 'rgba(60,55,48,0.10)');
    grd.addColorStop(1, 'rgba(60,55,48,0)');
    g.fillStyle = grd;
    g.fillRect(x, 0, w, S * (0.4 + rand() * 0.6));
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 8;
  return tex;
}

// Façade classique : 2 travées × 2 niveaux par tuile (5,2 m × 8 m) —
// hautes fenêtres à encadrement mouluré, allège, corniche d'étage. La carte
// émissive n'éclaire que certaines vitres, comme les immeubles la nuit.
function classicTextures() {
  const W = 256, H = 394;
  const mk = () => {
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    return [c, c.getContext('2d')];
  };
  const [c, g] = mk();
  const [ce, ge] = mk();
  ge.fillStyle = '#000';
  ge.fillRect(0, 0, W, H);
  g.fillStyle = '#e2d9c6';
  g.fillRect(0, 0, W, H);
  // refends (joints horizontaux en creux)
  g.fillStyle = 'rgba(120,108,90,0.25)';
  for (let y = 0; y < H; y += 24) g.fillRect(0, y, W, 2);
  const lit = [[true, false], [false, true]];
  for (let fl = 0; fl < 2; fl++) {
    const y0 = fl * (H / 2);
    // bandeau d'étage
    g.fillStyle = '#efe8d8';
    g.fillRect(0, y0 + H / 2 - 14, W, 10);
    g.fillStyle = 'rgba(90,80,64,0.35)';
    g.fillRect(0, y0 + H / 2 - 4, W, 3);
    for (let b = 0; b < 2; b++) {
      const x0 = b * (W / 2);
      const wx = x0 + 34, ww = W / 2 - 68, wy = y0 + 34, wh = H / 2 - 74;
      // encadrement + fronton plat
      g.fillStyle = '#f2ecdf';
      g.fillRect(wx - 9, wy - 9, ww + 18, wh + 16);
      g.fillRect(wx - 14, wy - 20, ww + 28, 9);
      g.fillStyle = 'rgba(80,70,55,0.35)';
      g.fillRect(wx - 14, wy - 11, ww + 28, 2);
      // vitre + petits bois
      const grd = g.createLinearGradient(0, wy, 0, wy + wh);
      grd.addColorStop(0, '#3e4a5a');
      grd.addColorStop(1, '#232a35');
      g.fillStyle = grd;
      g.fillRect(wx, wy, ww, wh);
      g.fillStyle = '#d9d2c2';
      g.fillRect(wx + ww / 2 - 2, wy, 4, wh);
      for (let k = 1; k < 4; k++) g.fillRect(wx, wy + (wh * k) / 4 - 1.5, ww, 3);
      // allège à balustres
      g.fillStyle = '#ece5d4';
      g.fillRect(wx - 6, wy + wh + 6, ww + 12, 18);
      g.fillStyle = 'rgba(90,80,64,0.4)';
      for (let k = 0; k < 6; k++) g.fillRect(wx + 2 + k * (ww / 6), wy + wh + 9, 3, 12);
      if (lit[fl][b]) {
        ge.fillStyle = '#ffd9a0';
        ge.fillRect(wx, wy, ww, wh);
        ge.fillStyle = '#000';
        ge.fillRect(wx + ww / 2 - 2, wy, 4, wh);
        for (let k = 1; k < 4; k++) ge.fillRect(wx, wy + (wh * k) / 4 - 1.5, ww, 3);
      }
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const emi = new THREE.CanvasTexture(ce);
  emi.colorSpace = THREE.SRGBColorSpace;
  for (const t of [tex, emi]) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 8;
  }
  return { tex, emi };
}

// Vitraux : moitié gauche = rosace (pétales rayonnants autour d'un oculus),
// moitié droite = verrière de lancette (losanges bleus et rouges, plombs).
function vitrailTexture() {
  const S = 256;
  const c = document.createElement('canvas');
  c.width = S * 2; c.height = S;
  const g = c.getContext('2d');
  const rand = makeRand(912);
  const COLS = ['#1f3f9c', '#2a56c4', '#a3202c', '#c8962a', '#2f7a52', '#5a2a86'];
  g.fillStyle = '#10142a';
  g.fillRect(0, 0, S * 2, S);
  // rosace
  const cx = S / 2, cy = S / 2;
  for (let ring = 3; ring >= 0; ring--) {
    const r0 = 22 + ring * 26, n = 8 + ring * 4;
    for (let k = 0; k < n; k++) {
      const a0 = (k / n) * Math.PI * 2, a1 = ((k + 1) / n) * Math.PI * 2;
      g.beginPath();
      g.moveTo(cx + Math.cos(a0) * r0, cy + Math.sin(a0) * r0);
      g.arc(cx, cy, r0 + 24, a0 + 0.04, a1 - 0.04);
      g.closePath();
      g.fillStyle = COLS[(k + ring * 2) % COLS.length];
      g.fill();
      g.strokeStyle = '#0b0b10';
      g.lineWidth = 4;
      g.stroke();
    }
  }
  g.beginPath();
  g.arc(cx, cy, 22, 0, Math.PI * 2);
  g.fillStyle = '#d8b040';
  g.fill();
  g.lineWidth = 6;
  g.strokeStyle = '#0b0b10';
  g.beginPath();
  g.arc(cx, cy, S / 2 - 6, 0, Math.PI * 2);
  g.stroke();
  // lancettes
  const L = 32;
  for (let j = -1; j < S / L + 1; j++) {
    for (let i = -1; i < S / L + 1; i++) {
      const x = S + i * L + (j % 2 ? L / 2 : 0), y = j * L * 0.75;
      g.beginPath();
      g.moveTo(x, y - L / 2); g.lineTo(x + L / 2, y); g.lineTo(x, y + L / 2); g.lineTo(x - L / 2, y);
      g.closePath();
      const t = rand();
      g.fillStyle = t < 0.5 ? COLS[t < 0.25 ? 0 : 1] : COLS[2 + Math.floor(rand() * 4)];
      g.fill();
      g.strokeStyle = '#0b0b10';
      g.lineWidth = 3;
      g.stroke();
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

// Voûte de l'Opéra : lames de verre sombre, fentes de lumière rouge
function louverTexture() {
  const c = document.createElement('canvas');
  c.width = 64; c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#000';
  g.fillRect(0, 0, 64, 256);
  for (let y = 0; y < 256; y += 16) {
    g.fillStyle = '#ff2f14';
    g.fillRect(0, y + 10, 64, 4);
  }
  g.fillStyle = '#000';
  g.fillRect(30, 0, 4, 256);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

// -------------------------------------------------------------- géométrie

// Profil d'arc brisé (gothique) de largeur w, hauteur h, base à y = 0
function pointedShape(w, h) {
  const s = new THREE.Shape();
  const hs = Math.max(0, h - w * 0.8); // naissance de l'arc
  s.moveTo(-w / 2, 0);
  s.lineTo(w / 2, 0);
  s.lineTo(w / 2, hs);
  s.quadraticCurveTo(w / 2, hs + (h - hs) * 0.62, 0, h);
  s.quadraticCurveTo(-w / 2, hs + (h - hs) * 0.62, -w / 2, hs);
  s.closePath();
  return s;
}

// Plein cintre (arcades de l'Opéra, porte cochère)
function roundShape(w, h) {
  const s = new THREE.Shape();
  const r = w / 2, hs = Math.max(0, h - r);
  s.moveTo(-r, 0);
  s.lineTo(r, 0);
  s.lineTo(r, hs);
  s.absarc(0, hs, r, 0, Math.PI, false);
  s.closePath();
  return s;
}

// Fronton / gâble : prisme triangulaire (base w, hauteur h, épaisseur d),
// face avant vers +z, base à y = 0
function gableGeo(w, h, d) {
  const s = new THREE.Shape();
  s.moveTo(-w / 2, 0); s.lineTo(w / 2, 0); s.lineTo(0, h); s.closePath();
  return new THREE.ExtrudeGeometry(s, { depth: d, bevelEnabled: false }).translate(0, 0, -d / 2);
}

// Verrière de lancette : UV recalées dans la moitié droite de la texture
// des vitraux (la moitié gauche est la rosace)
function lancet(w, h) {
  const g = new THREE.ShapeGeometry(pointedShape(w, h), 6);
  const p = g.attributes.position.array, uv = g.attributes.uv.array;
  for (let i = 0; i < uv.length / 2; i++) {
    uv[i * 2] = 0.5 + (p[i * 3] / w + 0.5) * 0.5;
    uv[i * 2 + 1] = p[i * 3 + 1] / h;
  }
  return g;
}

// Prisme de toit à deux pans (faîtage le long de x), base y = 0. `hip` > 0 :
// croupes aux deux bouts (toit en pavillon).
function roofGeo(len, wid, h, hip = 0) {
  const hw = wid / 2, hl = len / 2;
  const r = Math.max(0, hl - hip);
  const P = [
    [-hl, 0, -hw], [hl, 0, -hw], [hl, 0, hw], [-hl, 0, hw], // base
    [-r, h, 0], [r, h, 0], // faîtage
  ];
  const T = [
    [0, 4, 5], [0, 5, 1], // pan nord (-z)
    [3, 2, 5], [3, 5, 4], // pan sud (+z)
    [0, 3, 4], [1, 5, 2], // croupes / pignons
  ];
  const pos = [];
  for (const t of T) for (const i of t) pos.push(...P[i]);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.computeVertexNormals();
  // sens des faces : on s'assure que chaque normale pointe vers l'extérieur
  const p = geo.attributes.position.array;
  const out = [];
  for (let i = 0; i < p.length; i += 9) {
    const ax = p[i], ay = p[i + 1], az = p[i + 2];
    const ux = p[i + 3] - ax, uy = p[i + 4] - ay, uz = p[i + 5] - az;
    const vx = p[i + 6] - ax, vy = p[i + 7] - ay, vz = p[i + 8] - az;
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const mx = (ax + p[i + 3] + p[i + 6]) / 3, my = (ay + p[i + 4] + p[i + 7]) / 3 - h * 0.3, mz = (az + p[i + 5] + p[i + 8]) / 3;
    if (nx * mx + ny * my + nz * mz < 0) out.push(ax, ay, az, p[i + 6], p[i + 7], p[i + 8], p[i + 3], p[i + 4], p[i + 5]);
    else out.push(...p.slice(i, i + 9));
  }
  const g2 = new THREE.BufferGeometry();
  g2.setAttribute('position', new THREE.Float32BufferAttribute(out, 3));
  g2.computeVertexNormals();
  return g2;
}

// Chantier d'un monument : repère local (u = axe principal, v = travers,
// y = haut, origine au sol), géométries accumulées par matériau, colliders
// découpés en cellules (AABB monde serrées même quand le bâtiment est en
// biais). Partagé avec les passerelles (world/passerelles.js).
export class Kit {
  constructor(ctx, x, z, y0, ax, az) {
    this.ctx = ctx;
    this.o = [x, y0, z];
    this.a = [ax, az];
    this.basis = new THREE.Matrix4().makeBasis(
      new THREE.Vector3(ax, 0, az), UP, new THREE.Vector3(-az, 0, ax)
    ).setPosition(x, y0, z);
    this.parts = new Map();
  }

  world(u, v) {
    const [ax, az] = this.a;
    return [this.o[0] + ax * u - az * v, this.o[2] + az * u + ax * v];
  }

  // geo en coordonnées de pièce (centrée) ; rotation puis translation dans
  // le repère local. UV recalculées en local (sauf keepUV) : chaque face
  // droite reçoit la texture à l'échelle `uvScale` m par tuile (ou
  // [largeur, hauteur] pour la façade à fenêtres).
  add(key, geo, { u = 0, y = 0, v = 0, rx = 0, ry = 0, rz = 0, color = 0xffffff, keepUV = false, uvScale = 3 } = {}) {
    let g = geo.index ? geo.toNonIndexed() : geo.clone();
    for (const k of Object.keys(g.attributes)) {
      if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
    }
    if (!g.attributes.normal) g.computeVertexNormals();
    const m = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rx, ry, rz));
    m.setPosition(u, y, v);
    g.applyMatrix4(m);
    const n = g.attributes.position.count;
    if (!keepUV || !g.attributes.uv) {
      const p = g.attributes.position.array, nn = g.attributes.normal.array;
      const [su, sv] = Array.isArray(uvScale) ? uvScale : [uvScale, uvScale];
      const uv = new Float32Array(n * 2);
      for (let i = 0; i < n; i++) {
        const nx = Math.abs(nn[i * 3]), ny = Math.abs(nn[i * 3 + 1]), nz = Math.abs(nn[i * 3 + 2]);
        const px = p[i * 3], py = p[i * 3 + 1], pz = p[i * 3 + 2];
        if (ny > 0.75) { uv[i * 2] = px / su; uv[i * 2 + 1] = pz / su; }
        else if (nx >= nz) { uv[i * 2] = pz / su; uv[i * 2 + 1] = py / sv; }
        else { uv[i * 2] = px / su; uv[i * 2 + 1] = py / sv; }
      }
      g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    }
    const col = new THREE.Color(color);
    const ca = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { ca[i * 3] = col.r; ca[i * 3 + 1] = col.g; ca[i * 3 + 2] = col.b; }
    g.setAttribute('color', new THREE.BufferAttribute(ca, 3));
    g.applyMatrix4(this.basis);
    if (!this.parts.has(key)) this.parts.set(key, []);
    this.parts.get(key).push(g);
    return this;
  }

  // Pavé [u0,u1] × [y0,y1] × [v0,v1] ; collide : volume plein praticable
  box(key, u0, u1, y0, y1, v0, v1, color, { collide = false, uvScale } = {}) {
    this.add(key, new THREE.BoxGeometry(u1 - u0, y1 - y0, v1 - v0), {
      u: (u0 + u1) / 2, y: (y0 + y1) / 2, v: (v0 + v1) / 2, color, uvScale,
    });
    if (collide) this.solid(u0, u1, y0, y1, v0, v1);
    return this;
  }

  solid(u0, u1, y0, y1, v0, v1) {
    const nu = Math.max(1, Math.ceil((u1 - u0) / 4)), nv = Math.max(1, Math.ceil((v1 - v0) / 4));
    for (let i = 0; i < nu; i++) {
      for (let j = 0; j < nv; j++) {
        const a0 = u0 + ((u1 - u0) * i) / nu, a1 = u0 + ((u1 - u0) * (i + 1)) / nu;
        const b0 = v0 + ((v1 - v0) * j) / nv, b1 = v0 + ((v1 - v0) * (j + 1)) / nv;
        let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
        for (const [uu, vv] of [[a0, b0], [a1, b0], [a1, b1], [a0, b1]]) {
          const [x, z] = this.world(uu, vv);
          minX = Math.min(minX, x); maxX = Math.max(maxX, x);
          minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
        }
        this.ctx.colliders.push({ minX, maxX, minZ, maxZ, minY: this.o[1] + y0, maxY: this.o[1] + y1 });
      }
    }
  }

  build(mats, name) {
    const group = new THREE.Group();
    group.name = name;
    // Repère de la ville : visible de loin, jamais masqué par le culler du
    // petit décor (world/culling.js)
    group.userData.noCull = true;
    for (const [key, geos] of this.parts) {
      const geo = mergeGeometries(geos);
      if (!geo) continue;
      geo.computeBoundingSphere();
      const mesh = new THREE.Mesh(geo, mats[key]);
      mesh.castShadow = key !== 'glass' && key !== 'vault';
      mesh.receiveShadow = true;
      group.add(mesh);
    }
    // perspective aérienne des repères : on les devine encore au loin
    this.ctx.scene.add(landmarkFog(group, 0.5));
    return group;
  }
}

// ----------------------------------------------------------- empreintes

function insideRing(p, x, z) {
  let c = false;
  for (let i = 0, j = p.length - 2; i < p.length; j = i, i += 2) {
    const xi = p[i], zi = p[i + 1], xj = p[j], zj = p[j + 1];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
  }
  return c;
}

function ringArea(p) {
  let a = 0;
  for (let i = 0, j = p.length - 2; i < p.length; j = i, i += 2) a += p[j] * p[i + 1] - p[i] * p[j + 1];
  return Math.abs(a) / 2;
}

// Repère orienté d'une empreinte : direction des murs, puis étendue
// [u0,u1] × [v0,v1] le long de cet axe (u = la plus grande dimension, ou
// l'axe le plus proche de `prefer` quand la façade est connue).
function frameOf(p, prefer = null) {
  let cx = 0, cz = 0, L = 0;
  for (let i = 0, j = p.length - 2; i < p.length; j = i, i += 2) {
    const l = Math.hypot(p[i] - p[j], p[i + 1] - p[j + 1]);
    cx += ((p[i] + p[j]) / 2) * l; cz += ((p[i + 1] + p[j + 1]) / 2) * l; L += l;
  }
  cx /= L; cz /= L;
  // Direction de mur dominante, repliée modulo 90° (murs perpendiculaires) :
  // chaque arête vote pour sa propre direction, pondérée par sa longueur
  let best = 0, bestS = -Infinity;
  for (let k = 0; k < 90; k++) {
    const t = (k * Math.PI) / 180;
    const c = Math.cos(t), s = Math.sin(t);
    let score = 0;
    for (let i = 0, j = p.length - 2; i < p.length; j = i, i += 2) {
      const dx = p[i] - p[j], dz = p[i + 1] - p[j + 1];
      const l = Math.hypot(dx, dz);
      if (l < 1e-6) continue;
      const along = Math.abs((dx * c + dz * s) / l), across = Math.abs((-dx * s + dz * c) / l);
      score += l * Math.pow(Math.max(along, across), 8);
    }
    if (score > bestS) { bestS = score; best = t; }
  }
  let ax = Math.cos(best), az = Math.sin(best);
  const ext = () => {
    let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
    for (let i = 0; i < p.length; i += 2) {
      const dx = p[i] - cx, dz = p[i + 1] - cz;
      const u = dx * ax + dz * az, v = -dx * az + dz * ax;
      u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v);
    }
    return { u0, u1, v0, v1 };
  };
  let e = ext();
  // u = la plus grande dimension
  if (prefer) {
    // u = l'axe de mur le plus proche de la direction voulue (façade connue)
    if (Math.abs(-az * prefer[0] + ax * prefer[1]) > Math.abs(ax * prefer[0] + az * prefer[1])) {
      [ax, az] = [-az, ax]; e = ext();
    }
  } else if (e.v1 - e.v0 > e.u1 - e.u0) { [ax, az] = [-az, ax]; e = ext(); }
  return { cx, cz, ax, az, ...e };
}

// Recentre un repère sur le milieu de son étendue et oriente u vers (dx, dz)
function orient(f, dx, dz) {
  let { ax, az } = f;
  let { u0, u1, v0, v1 } = f;
  if (ax * dx + az * dz < 0) { ax = -ax; az = -az; [u0, u1] = [-u1, -u0]; [v0, v1] = [-v1, -v0]; }
  const um = (u0 + u1) / 2, vm = (v0 + v1) / 2;
  return {
    x: f.cx + ax * um - az * vm, z: f.cz + az * um + ax * vm,
    ax, az, L: u1 - u0, W: v1 - v0,
  };
}

// Sol sous l'emprise : le plus bas (les fondations s'enterrent ailleurs)
function groundUnder(ctx, fr) {
  let y = Infinity;
  for (const su of [-0.5, 0, 0.5]) {
    for (const sv of [-0.5, 0, 0.5]) {
      const x = fr.x + fr.ax * su * fr.L - fr.az * sv * fr.W;
      const z = fr.z + fr.az * su * fr.L + fr.ax * sv * fr.W;
      y = Math.min(y, ctx.terrainHeight?.(x, z) ?? 0);
    }
  }
  return Math.max(0, y);
}

// ------------------------------------------------------------- matériaux

function makeMaterials(ctx) {
  const ashlar = ashlarTexture();
  const { tex, emi } = classicTextures();
  const vit = vitrailTexture();
  const mats = {
    stone: new THREE.MeshLambertMaterial({ map: ashlar, vertexColors: true }),
    facade: new THREE.MeshLambertMaterial({
      map: tex, vertexColors: true, emissive: 0xffffff, emissiveMap: emi, emissiveIntensity: 0,
    }),
    plain: new THREE.MeshLambertMaterial({ vertexColors: true }),
    slate: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.15 }),
    gold: new THREE.MeshStandardMaterial({ color: 0xd8b24a, metalness: 0.9, roughness: 0.3, emissive: 0x2a1e06 }),
    glass: new THREE.MeshLambertMaterial({
      map: vit, emissive: 0xffffff, emissiveMap: vit, emissiveIntensity: 0.08, side: THREE.DoubleSide,
    }),
    vault: new THREE.MeshStandardMaterial({
      color: 0x16181d, metalness: 0.7, roughness: 0.25,
      emissive: 0xffffff, emissiveMap: louverTexture(), emissiveIntensity: 0, side: THREE.DoubleSide,
    }),
    muse: new THREE.MeshLambertMaterial({ vertexColors: true }),
    inscription: new THREE.MeshLambertMaterial({ map: inscriptionTexture('PALAIS DE JUSTICE') }),
  };
  ctx.updatables.push(() => {
    const night = ctx.env?.night ?? 0;
    mats.facade.emissiveIntensity = Math.max(0, night * 1.1 - 0.1) * 0.75;
    mats.glass.emissiveIntensity = 0.08 + night * 0.9;
    // la voûte de Nouvel s'embrase en rouge à la tombée du jour
    mats.vault.emissiveIntensity = night * 1.6;
  });
  return mats;
}

// ----------------------------------------------------------- monuments

const STONE_SJ = 0xf4e3c0; // pierre dorée de Saint-Jean
const SLATE = 0x535b66;
const TILE_ROOF = 0x9a6a52;
const DARK = 0x2a2420;

// Église gothique (Saint-Jean, Saint-Nizier). u = 0 au centre, façade à
// l'ouest (u négatif), chevet à l'est.
function gothicChurch(k, L, W, o) {
  const { stone = STONE_SJ, nave = 18, aisle = 9, tower = 24, spire = 0, roof = TILE_ROOF, roofH = 3.2, portals = 3 } = o;
  const uF = -L / 2 + 2.2;                  // nu de la façade
  const uA = L / 2 - Math.min(W * 0.45, 7); // départ de l'abside
  const nw = Math.min(W * 0.48, 9);         // largeur de la nef haute
  const hw = W / 2;
  const ow = hw - 1.5;                      // nu des bas-côtés
  // bas-côtés + chapelles latérales, toits en appentis
  k.box('stone', uF + 1, uA, -3, aisle, -ow, ow, stone, { collide: true });
  const pw = ow - nw / 2 + 0.8;
  for (const s of [-1, 1]) {
    k.add('slate', new THREE.BoxGeometry(uA - uF - 1, 0.35, pw / Math.cos(0.32)), {
      u: (uF + uA) / 2 + 0.5, y: aisle + Math.tan(0.32) * pw / 2, v: s * (nw / 2 + pw / 2 - 0.4),
      rx: s * 0.32, color: roof,
    });
  }
  // nef haute et son toit
  k.box('stone', uF + 1, uA + 0.5, aisle - 1, nave, -nw / 2, nw / 2, stone, { collide: true });
  k.add('slate', roofGeo(uA - uF, nw + 0.8, roofH, 0), { u: (uF + uA) / 2 + 0.5, y: nave, color: roof });
  k.box('stone', uF + 1, uA + 0.5, nave - 0.4, nave, -nw / 2 - 0.3, nw / 2 + 0.3, stone);
  // travées : contreforts à pinacle, arcs-boutants, vitraux
  const bay = 4.2;
  const nb = Math.floor((uA - uF - 3) / bay);
  const dv = ow - nw / 2, dy = nave - 2.5 - (aisle + 1.8);
  const fly = Math.hypot(dv, dy);
  for (let i = 0; i <= nb; i++) {
    const u = uF + 3 + i * bay;
    for (const s of [-1, 1]) {
      k.box('stone', u - 0.45, u + 0.45, -1, aisle + 2.4, s * ow - 0.75, s * ow + 0.75, stone);
      k.add('stone', new THREE.ConeGeometry(0.55, 2, 4), { u, y: aisle + 3.4, v: s * ow, ry: Math.PI / 4, color: stone });
      // arc-boutant : du contrefort au mur haut de la nef
      k.add('stone', new THREE.BoxGeometry(0.45, 0.55, fly), {
        u, y: aisle + 1.8 + dy / 2, v: s * (nw / 2 + dv / 2), rx: s * Math.atan2(dy, dv), color: stone,
      });
      if (i < nb) {
        const um = u + bay / 2;
        // claire-voie (nef haute) et fenêtre de bas-côté
        k.add('glass', lancet(1.6, 4.8), { u: um, y: aisle + 0.4, v: s * (nw / 2 + 0.05), ry: s > 0 ? 0 : Math.PI, keepUV: true });
        k.add('glass', lancet(1.8, 4.4), { u: um, y: 2.2, v: s * (ow + 0.05), ry: s > 0 ? 0 : Math.PI, keepUV: true });
      }
    }
  }
  // chevet : abside polygonale (8 pans) + couronne de chapelles basses
  const ra = nw / 2 + 0.2;
  k.add('stone', new THREE.CylinderGeometry(ra, ra, nave + 3, 8), { u: uA, y: (nave - 3) / 2, color: stone });
  k.add('slate', new THREE.ConeGeometry(ra + 0.4, roofH + 0.6, 8), { u: uA, y: nave + (roofH + 0.6) / 2, color: roof });
  const rc = Math.min(ow, ra + 3.2);
  k.add('stone', new THREE.CylinderGeometry(rc, rc, aisle + 3, 10, 1, false, 0, Math.PI), { u: uA, y: (aisle - 3) / 2, color: stone });
  k.add('slate', new THREE.ConeGeometry(rc + 0.3, 2.2, 10, 1, false, 0, Math.PI), { u: uA, y: aisle + 1.1, color: roof });
  k.solid(uA, uA + ra, -3, nave, -ra * 0.8, ra * 0.8);
  const ap = ra * Math.cos(Math.PI / 8) + 0.05;
  for (let i = 0; i < 4; i++) {
    const t = ((i + 0.5) * Math.PI) / 4; // centres des pans tournés vers l'est
    k.add('glass', lancet(1.3, 4.6), { u: uA + Math.sin(t) * ap, y: aisle + 0.9, v: Math.cos(t) * ap, ry: t, keepUV: true });
  }

  // tours du transept (Saint-Jean), sur les bas-côtés, de part et d'autre
  if (o.transept) {
    const ut = uF + (uA - uF) * 0.62;
    for (const s of [-1, 1]) {
      const tv = s * (nw / 2 + 2.1);
      k.box('stone', ut - 2.3, ut + 2.3, -2, nave + 3.4, tv - 2.3, tv + 2.3, stone, { collide: true });
      k.box('stone', ut - 2.6, ut + 2.6, nave + 3.4, nave + 3.9, tv - 2.6, tv + 2.6, stone);
      k.add('plain', new THREE.ShapeGeometry(pointedShape(1, 2.8), 6), { u: ut - 2.33, y: nave - 0.5, v: tv, ry: -Math.PI / 2, color: DARK });
    }
  }

  // ---- façade occidentale : écran plat, portails, rosace, galerie, tours
  const fw = Math.min(W, 22) / 2;
  const fh = nave + 1.5;
  const uf = uF - 1.2; // plan de la façade
  k.box('stone', uf, uF + 1.4, -3, fh, -fw, fw, stone, { collide: true });
  // pignon central derrière la galerie
  k.add('stone', gableGeo(nw + 1.2, 3.2, 1.2), { u: uF - 0.4, y: fh, ry: -Math.PI / 2, color: stone });
  // galerie de colonnettes entre deux cordons
  for (let i = -6; i <= 6; i++) {
    k.box('stone', uf - 0.3, uf, fh - 3.6, fh - 1.2, i * (fw / 7) - 0.12, i * (fw / 7) + 0.12, stone);
  }
  k.box('stone', uf - 0.4, uf, fh - 1.2, fh - 0.8, -fw, fw, stone);
  k.box('stone', uf - 0.4, uf, fh - 4, fh - 3.6, -fw, fw, stone);
  // rosace dans son cercle de pierre
  const rr = Math.min(3.2, nw * 0.38);
  const ry = fh - 4.6 - rr;
  const rose = new THREE.CircleGeometry(rr, 28);
  const ruv = rose.attributes.uv.array;
  for (let i = 0; i < ruv.length; i += 2) ruv[i] *= 0.5;
  k.add('glass', rose, { u: uf - 0.04, y: ry, ry: -Math.PI / 2, keepUV: true });
  k.add('stone', new THREE.TorusGeometry(rr + 0.15, 0.3, 6, 28), { u: uf - 0.1, y: ry, ry: -Math.PI / 2, color: stone });
  // portails : voussures emboîtées (la plus grande contre le mur), vantaux
  // sombres, gâble pointu au-dessus
  const pv = portals === 1 ? [0] : [-fw * 0.56, 0, fw * 0.56];
  pv.forEach((v, i) => {
    const w = portals === 1 || i === 1 ? 3.8 : 3;
    const h = w * 1.6;
    for (let r = 0; r < 3; r++) {
      const ww = w + (2 - r) * 0.5, hh = h + (2 - r) * 0.45;
      k.add('stone', new THREE.ExtrudeGeometry(pointedShape(ww, hh), { depth: 0.22, bevelEnabled: false, curveSegments: 6 }), {
        u: uf - r * 0.22, y: 0, v, ry: -Math.PI / 2, color: r % 2 ? 0xd2c6ac : stone,
      });
    }
    k.add('plain', new THREE.ShapeGeometry(pointedShape(w - 0.25, h - 0.2), 6), { u: uf - 0.68, y: 0, v, ry: -Math.PI / 2, color: DARK });
    k.add('stone', gableGeo(w + 1.4, 2, 0.5), { u: uf - 0.3, y: h + 0.5, v, ry: -Math.PI / 2, color: stone });
  });
  // tours de façade : carrées et tronquées à balustrade (Saint-Jean) ou
  // coiffées d'une flèche à clochetons (Saint-Nizier)
  for (const s of [-1, 1]) {
    const tv = s * (fw - 2.6);
    k.box('stone', uf - 0.2, uF + 4, -3, tower, tv - 2.6, tv + 2.6, stone, { collide: true });
    k.box('stone', uf - 0.4, uF + 4.2, tower - 5.2, tower - 4.8, tv - 2.8, tv + 2.8, stone);
    for (const d of [-1, 1]) {
      k.add('plain', new THREE.ShapeGeometry(pointedShape(1.1, 3.2), 6), {
        u: uf - 0.23, y: tower - 4.5, v: tv + d * 1.2, ry: -Math.PI / 2, color: DARK,
      });
    }
    const tc = (uf - 0.2 + uF + 4) / 2;
    if (spire) {
      k.add('stone', new THREE.ConeGeometry(2.1, spire, 8), { u: tc, y: tower + spire / 2, v: tv, ry: Math.PI / 8, color: stone });
      for (const [du, dvv] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        k.add('stone', new THREE.ConeGeometry(0.45, 2.6, 4), { u: tc + du * 2.2, y: tower + 1.3, v: tv + dvv * 2.2, color: stone });
      }
      k.add('gold', new THREE.BoxGeometry(0.16, 1.5, 0.16), { u: tc, y: tower + spire + 0.6, v: tv });
      k.add('gold', new THREE.BoxGeometry(0.16, 0.16, 0.9), { u: tc, y: tower + spire + 0.8, v: tv });
    } else {
      k.box('stone', uf - 0.4, uF + 4.2, tower, tower + 0.35, tv - 2.8, tv + 2.8, stone);
      for (let q = -2; q <= 2; q++) {
        for (const a of [uf - 0.3, uF + 4.1]) {
          k.box('stone', a - 0.15, a + 0.15, tower + 0.35, tower + 1.2, tv + q * 1.1 - 0.15, tv + q * 1.1 + 0.15, stone);
        }
        const b = tc + q * 1.1;
        for (const sv of [-1, 1]) k.box('stone', b - 0.15, b + 0.15, tower + 0.35, tower + 1.2, tv + sv * 2.7 - 0.15, tv + sv * 2.7 + 0.15, stone);
      }
      k.box('slate', tc - 1.8, tc + 1.8, tower, tower + 0.9, tv - 1.8, tv + 1.8, SLATE);
    }
  }
}

function buildSaintJean(k, fr) {
  gothicChurch(k, Math.min(fr.L, 48), Math.min(fr.W, 22), { transept: true, nave: 18, aisle: 9.5, tower: 23.5 });
}

function buildSaintNizier(k, fr) {
  gothicChurch(k, Math.min(fr.L, 44), Math.min(fr.W, 19), {
    stone: 0xe0cdb4, nave: 16, aisle: 8.5, tower: 22, spire: 15, roof: SLATE, roofH: 5.5, portals: 1,
  });
}

// Hôtel de Ville : quadrilatère à cour d'honneur, beffroi face aux Terreaux
// (u négatif = ouest), façade de Mansart côté Comédie
function buildHotelDeVille(k, fr) {
  const L = Math.min(fr.L, 66), W = Math.min(fr.W, 34);
  const H = 13, WING = 8;
  const u0 = -L / 2, u1 = L / 2, v0 = -W / 2, v1 = W / 2;
  const C = 0xffffff;
  const wing = (a0, a1, b0, b1, h = H) => {
    k.box('facade', a0, a1, -3, h, b0, b1, C, { collide: true, uvScale: FAC });
    // toit d'ardoise à brisis (mansarde) : prisme bas à croupes
    const along = a1 - a0 >= b1 - b0;
    const len = along ? a1 - a0 : b1 - b0, wid = along ? b1 - b0 : a1 - a0;
    k.add('slate', roofGeo(len + 0.6, wid + 0.6, 3.6, wid / 2), {
      u: (a0 + a1) / 2, y: h, v: (b0 + b1) / 2, ry: along ? 0 : Math.PI / 2, color: SLATE,
    });
    k.box('stone', a0 - 0.3, a1 + 0.3, h - 0.5, h, b0 - 0.3, b1 + 0.3, 0xece4d2);
  };
  wing(u0, u0 + WING + 2, v0, v1, H + 1);         // aile des Terreaux (plus haute)
  wing(u1 - WING, u1, v0, v1);                    // aile de la Comédie
  wing(u0 + WING + 2, u1 - WING, v0, v0 + WING);  // aile nord
  wing(u0 + WING + 2, u1 - WING, v1 - WING, v1);  // aile sud
  // cour d'honneur pavée
  k.box('stone', u0 + WING + 2, u1 - WING, -0.2, 0.06, v0 + WING, v1 - WING, 0xb8b0a0);
  // pavillons d'angle, hauts toits d'ardoise en pavillon
  for (const [a, b] of [[u0 + 4, v0 + 4], [u0 + 4, v1 - 4], [u1 - 4, v0 + 4], [u1 - 4, v1 - 4]]) {
    k.box('facade', a - 4.6, a + 4.6, -3, H + 2.5, b - 4.6, b + 4.6, C, { collide: true, uvScale: FAC });
    k.add('slate', new THREE.ConeGeometry(6.6, 6.5, 4, 1), { u: a, y: H + 2.5 + 3.25, v: b, ry: Math.PI / 4, color: SLATE });
    k.add('gold', new THREE.ConeGeometry(0.25, 1.8, 6), { u: a, y: H + 9.8, v: b });
  }
  // avant-corps central des Terreaux : porte cochère, horloge, beffroi
  const ub = u0 - 0.9;
  k.box('facade', ub, u0 + WING, -3, H + 3, -5.5, 5.5, C, { collide: true, uvScale: FAC });
  k.add('plain', new THREE.ShapeGeometry(roundShape(3.6, 5.2), 8), { u: ub - 0.04, y: 0, ry: -Math.PI / 2, color: DARK });
  // bas-relief équestre d'Henri IV (doré) au-dessus de la porte
  k.box('gold', ub - 0.18, ub - 0.02, 6, 8.6, -1.8, 1.8);
  // fronton triangulaire
  k.add('stone', gableGeo(11.6, 2.8, 1.2), { u: ub + 0.5, y: H + 3, ry: -Math.PI / 2, color: 0xeee6d4 });
  // beffroi : socle carré, horloge, tambour, dôme d'ardoise, lanterne
  const bu = u0 + 4.2;
  k.box('stone', bu - 3, bu + 3, H + 3, H + 9, -3, 3, 0xefe8d8, { collide: true });
  k.add('plain', new THREE.CircleGeometry(1.5, 24), { u: bu - 3.03, y: H + 6, ry: -Math.PI / 2, color: 0xf4f1e6 });
  k.add('gold', new THREE.TorusGeometry(1.55, 0.12, 4, 24), { u: bu - 3.05, y: H + 6, ry: -Math.PI / 2 });
  // aiguilles : l'heure du jeu (cycle de 10 min) — figées, c'est un décor
  k.add('plain', new THREE.BoxGeometry(0.08, 1.1, 0.14), { u: bu - 3.1, y: H + 6.4, rz: 0, color: 0x111111 });
  k.add('plain', new THREE.BoxGeometry(0.08, 0.14, 0.8), { u: bu - 3.1, y: H + 6, v: 0.3, color: 0x111111 });
  k.add('stone', new THREE.CylinderGeometry(2.4, 2.6, 3.2, 8), { u: bu, y: H + 10.6, color: 0xefe8d8 });
  for (let i = 0; i < 8; i++) {
    const t = ((i + 0.5) * Math.PI * 2) / 8;
    k.add('plain', new THREE.ShapeGeometry(roundShape(0.9, 2), 6), {
      u: bu + Math.sin(t) * 2.38, y: H + 9.4, v: Math.cos(t) * 2.38, ry: t, color: DARK,
    });
  }
  const dome = new THREE.SphereGeometry(2.7, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2);
  k.add('slate', dome, { u: bu, y: H + 12.2, color: SLATE });
  k.add('stone', new THREE.CylinderGeometry(0.7, 0.8, 2, 8), { u: bu, y: H + 15.6, color: 0xefe8d8 });
  k.add('gold', new THREE.ConeGeometry(0.75, 1.6, 8), { u: bu, y: H + 17.4 });
  k.add('gold', new THREE.SphereGeometry(0.3, 8, 6), { u: bu, y: H + 18.4 });
}

// Une Muse drapée (statue de l'attique de l'Opéra), sculptée une fois
let museGeo = null;
function museGeometry() {
  if (museGeo) return museGeo;
  const cell = detail.high ? 0.035 : 0.05;
  museGeo = paint(sculpt([
    // socle + robe tombante évasée
    { t: 'box', c: [0, 0.08, 0], h: [0.32, 0.08, 0.32], round: 0.02, k: 0.02 },
    { t: 'cone', a: [0, 0.16, 0], b: [0, 1.05, 0], r1: 0.3, r2: 0.17, k: 0.08 },
    { t: 'ell', c: [0, 1.25, 0], r: [0.19, 0.24, 0.13], k: 0.08 },
    // tête, chignon
    { t: 'cone', a: [0, 1.45, 0], b: [0, 1.55, 0], r1: 0.06, r2: 0.055, k: 0.03 },
    { t: 'ell', c: [0, 1.66, 0.01], r: [0.09, 0.11, 0.1], k: 0.03 },
    { t: 'sphere', c: [0, 1.73, -0.07], r: 0.06, k: 0.03 },
    // un bras levé (lyre, flambeau…), l'autre le long du drapé
    { t: 'cone', a: [0.17, 1.38, 0], b: [0.3, 1.66, 0.05], r1: 0.055, r2: 0.045, k: 0.04 },
    { t: 'cone', a: [0.3, 1.66, 0.05], b: [0.33, 1.95, 0.02], r1: 0.045, r2: 0.04, k: 0.03 },
    { t: 'ell', c: [0.34, 2.0, 0.02], r: [0.06, 0.1, 0.04], k: 0.02 },
    { t: 'cone', a: [-0.17, 1.38, 0], b: [-0.21, 1.02, 0.06], r1: 0.055, r2: 0.045, k: 0.04 },
  ], { cell }), [new THREE.Color(0xe9e2d2)]);
  return museGeo;
}

// Opéra : socle de 1831 + voûte de verre en demi-cylindre (axe u)
function buildOpera(k, fr, mats, ctx, name) {
  const L = Math.min(fr.L, 32), W = Math.min(fr.W, 23);
  const HB = 14.5;
  const u0 = -L / 2;
  k.box('facade', -L / 2, L / 2, -3, HB, -W / 2, W / 2, 0xf1ece0, { collide: true, uvScale: FAC });
  // rez-de-chaussée à arcades (péristyle) sur la façade et les côtés
  const n = Math.max(5, Math.round(W / 3.4));
  for (let i = 0; i < n; i++) {
    const v = -W / 2 + ((i + 0.5) / n) * W;
    k.add('plain', new THREE.ShapeGeometry(roundShape(2.2, 4.6), 8), { u: u0 - 0.05, y: 0, v, ry: -Math.PI / 2, color: 0x2b211b });
  }
  const m = Math.round(L / 3.4);
  for (let i = 0; i < m; i++) {
    const u = -L / 2 + ((i + 0.5) / m) * L;
    for (const s of [-1, 1]) {
      k.add('plain', new THREE.ShapeGeometry(roundShape(2.2, 4.6), 8), { u, y: 0, v: s * (W / 2 + 0.05), ry: s > 0 ? 0 : Math.PI, color: 0x2b211b });
    }
  }
  // bandeau, corniche, attique
  k.box('stone', u0 - 0.4, L / 2 + 0.4, 5.2, 5.8, -W / 2 - 0.4, W / 2 + 0.4, 0xf6f1e6);
  k.box('stone', u0 - 0.6, L / 2 + 0.6, HB - 0.6, HB, -W / 2 - 0.6, W / 2 + 0.6, 0xf6f1e6);
  // voûte : demi-cylindre noir, pignons vitrés
  const R = W / 2 - 0.3;
  // Les UV du cylindre (u autour, v le long) sont permutées : les lames
  // courent le long de la voûte, fentes horizontales vues de côté
  const vault = new THREE.CylinderGeometry(R, R, L - 0.6, 28, 1, true, 0, Math.PI);
  const vuv = vault.attributes.uv.array;
  for (let i = 0; i < vuv.length; i += 2) [vuv[i], vuv[i + 1]] = [vuv[i + 1] * 4, vuv[i] * 6];
  k.add('vault', vault, { u: 0, y: HB, rz: Math.PI / 2, keepUV: true });
  // pignons vitrés en demi-disque, mêmes lames horizontales
  for (const s of [-1, 1]) {
    const cap = new THREE.CircleGeometry(R, 28, 0, Math.PI);
    const cuv = cap.attributes.uv.array;
    for (let i = 0; i < cuv.length; i += 2) { cuv[i] *= 4; cuv[i + 1] *= 3; }
    k.add('vault', cap, { u: s * (L / 2 - 0.3), y: HB, ry: s > 0 ? Math.PI / 2 : -Math.PI / 2, keepUV: true });
  }
  k.solid(-L / 2, L / 2, HB, HB + R, -R * 0.5, R * 0.5);
  // les huit Muses sur l'attique, face à la Comédie
  const g = museGeometry();
  const geos = [];
  for (let i = 0; i < 8; i++) {
    const v = -W / 2 + 1.4 + (i / 7) * (W - 2.8);
    const [x, z] = k.world(u0 + 0.2, v);
    const mtx = new THREE.Matrix4()
      .makeRotationY(Math.atan2(-k.a[0], -k.a[1]))
      .scale(new THREE.Vector3(1.25, 1.25, 1.25))
      .setPosition(x, k.o[1] + HB, z);
    const c = g.clone();
    c.applyMatrix4(mtx);
    geos.push(c);
  }
  const muses = new THREE.Mesh(mergeGeometries(geos), mats.muse);
  muses.castShadow = true;
  muses.name = name + ' — Muses';
  muses.userData.noCull = true;
  ctx.scene.add(muses);
}

// Dôme de Soufflot sur l'Hôtel-Dieu, au milieu de la façade du Rhône.
// Origine du repère = nu de la façade, v positif = vers le fleuve.
// L'immeuble OSM reste en place : on n'ajoute que l'avant-corps et le dôme.
function buildHotelDieuDome(k, h) {
  const C = 0xece4d2;
  // avant-corps à colonnes et fronton, en légère saillie sur le quai
  k.box('facade', -8, 8, -3, h + 2.5, -2, 1.2, 0xffffff, { collide: true, uvScale: FAC });
  for (let i = 0; i < 6; i++) {
    k.add('stone', new THREE.CylinderGeometry(0.42, 0.48, h - 3.5, 10), { u: -6.5 + i * 2.6, y: 3.5 + (h - 3.5) / 2, v: 1.7, color: C });
  }
  k.box('stone', -8.4, 8.4, 3, 3.5, -2, 2.3, C);
  k.box('stone', -8.4, 8.4, h, h + 0.7, -2, 2.3, C);
  k.add('stone', gableGeo(17.4, 3.2, 1.4), { u: 0, y: h + 0.7, v: 1.5, color: C });
  // tambour à fenêtres, dôme d'ardoise à nervures dorées, lanterne
  const y = h + 2.5, dv = -6.5;
  k.add('stone', new THREE.CylinderGeometry(6.6, 6.6, 3, 16), { u: 0, y: y + 1.5, v: dv, color: C });
  k.add('stone', new THREE.CylinderGeometry(5.4, 5.6, 4.2, 16), { u: 0, y: y + 5.1, v: dv, color: C });
  const ap = 5.5 * Math.cos(Math.PI / 16) + 0.06;
  for (let i = 0; i < 16; i++) {
    const t = ((i + 0.5) * Math.PI * 2) / 16;
    k.add('plain', new THREE.ShapeGeometry(roundShape(1, 2.4), 6), {
      u: Math.sin(t) * ap, y: y + 3.8, v: dv + Math.cos(t) * ap, ry: t, color: 0x2a3038,
    });
  }
  const dome = new THREE.SphereGeometry(5.9, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 1.25, 1);
  k.add('slate', dome, { u: 0, y: y + 7.2, v: dv, color: 0x4b545e });
  for (let i = 0; i < 8; i++) {
    const rib = new THREE.TorusGeometry(5.95, 0.08, 3, 12, Math.PI / 2).scale(1, 1.25, 1);
    k.add('gold', rib, { u: 0, y: y + 7.2, v: dv, ry: (i / 8) * Math.PI * 2 });
  }
  k.add('stone', new THREE.CylinderGeometry(1.1, 1.2, 2.6, 8), { u: 0, y: y + 15.9, v: dv, color: C });
  k.add('slate', new THREE.ConeGeometry(1.3, 1.6, 8), { u: 0, y: y + 18, v: dv, color: 0x4b545e });
  k.add('gold', new THREE.SphereGeometry(0.35, 8, 6), { u: 0, y: y + 19.1, v: dv });
  k.add('gold', new THREE.BoxGeometry(0.14, 1.4, 0.14), { u: 0, y: y + 20, v: dv });
}

// Inscription gravée de l'attique (lettres sombres sur la pierre)
function inscriptionTexture(text) {
  const c = document.createElement('canvas');
  c.width = 1024; c.height = 96;
  const g = c.getContext('2d');
  g.fillStyle = '#e6dfcf';
  g.fillRect(0, 0, c.width, c.height);
  g.font = 'bold 62px Georgia, "Times New Roman", serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = 'rgba(255,255,255,0.6)';
  g.fillText(text, c.width / 2 + 2, c.height / 2 + 3);
  g.fillStyle = '#4a4236';
  g.fillText(text, c.width / 2, c.height / 2 + 1);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

// Palais de Justice historique, « les 24 colonnes » : bloc néoclassique
// sur le quai Romain-Rolland, péristyle de 24 colonnes corinthiennes face
// à la Saône (u positif = est), perron sur toute la largeur, attique
// gravé, et la rangée de coupoles de la salle des pas perdus sur le toit.
function buildPalaisJustice(k, fr) {
  const L = Math.min(fr.L, 46), W = Math.min(fr.W, 46);
  const C = 0xeee7d6;
  const uFront = L / 2;           // bord du perron, sur le nu de l'empreinte
  const uCol = uFront - 3.4;      // axe des colonnes
  const uWall = uFront - 6.2;     // mur du fond du péristyle
  const H = 14;
  // corps du palais
  k.box('facade', -L / 2, uWall, -3, H + 1.5, -W / 2, W / 2, 0xffffff, { collide: true, uvScale: FAC });
  // perron : sept marches sur toute la largeur du péristyle
  const SW = W / 2 - 1;
  for (let i = 0; i < 7; i++) {
    k.box('stone', uWall, uFront - i * 0.42, -1, 0.22 * (i + 1), -SW, SW, 0xd9d1bf, { collide: true });
  }
  const ys = 0.22 * 7; // stylobate
  // portes du fond du péristyle
  for (let i = -2; i <= 2; i++) {
    k.add('plain', new THREE.ShapeGeometry(roundShape(2.2, 4.6), 8), {
      u: uWall + 0.05, y: ys, v: i * 6.5, ry: Math.PI / 2, color: 0x2a221c,
    });
  }
  // les 24 colonnes, fût, base, chapiteau évasé
  const colH = 10.6;
  const n = 24;
  for (let i = 0; i < n; i++) {
    const v = -SW + 0.8 + (i / (n - 1)) * (2 * SW - 1.6);
    k.add('stone', new THREE.CylinderGeometry(0.42, 0.5, colH, 12), { u: uCol, y: ys + 0.3 + colH / 2, v, color: C });
    k.box('stone', uCol - 0.62, uCol + 0.62, ys, ys + 0.3, v - 0.62, v + 0.62, C);
    k.add('stone', new THREE.CylinderGeometry(0.68, 0.44, 0.75, 12), { u: uCol, y: ys + 0.3 + colH + 0.37, v, color: 0xf4eee0 });
    k.solid(uCol - 0.5, uCol + 0.5, ys, ys + colH, v - 0.5, v + 0.5);
  }
  // entablement, corniche, attique avec l'inscription
  const ye = ys + 0.3 + colH + 0.75;
  k.box('stone', uWall, uCol + 0.9, ye, ye + 1.7, -SW - 0.4, SW + 0.4, C, { collide: true });
  k.box('stone', uWall, uCol + 1.4, ye + 1.7, ye + 2.2, -SW - 0.9, SW + 0.9, 0xf4eee0);
  k.box('stone', uWall - 2, uCol, ye + 2.2, ye + 4.4, -SW + 1, SW - 1, C, { collide: true });
  k.add('inscription', new THREE.PlaneGeometry(SW * 1.4, 1.3), { u: uCol + 0.02, y: ye + 3.3, ry: Math.PI / 2, keepUV: true });
  // toit : terrasse et rangée de coupoles d'ardoise (salle des pas perdus)
  for (let i = 0; i < 6; i++) {
    const v = -W / 2 + W * ((i + 0.5) / 6);
    k.add('stone', new THREE.CylinderGeometry(2.3, 2.3, 1.2, 12), { u: -L * 0.08, y: H + 2.1, v, color: C });
    const d = new THREE.SphereGeometry(2.4, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.7, 1);
    k.add('slate', d, { u: -L * 0.08, y: H + 2.7, v, color: 0x55606b });
    k.add('stone', new THREE.CylinderGeometry(0.35, 0.4, 0.8, 8), { u: -L * 0.08, y: H + 4.7, v, color: C });
  }
  // la Justice et sa balance, dorées, au-dessus de l'inscription
  k.add('gold', new THREE.ConeGeometry(0.5, 2.2, 8), { u: uCol - 0.8, y: ye + 5.5 });
  k.add('gold', new THREE.SphereGeometry(0.28, 8, 6), { u: uCol - 0.8, y: ye + 6.85 });
  k.add('gold', new THREE.BoxGeometry(0.08, 0.08, 1.6), { u: uCol - 0.8, y: ye + 6.4 });
}

// ------------------------------------------------------------- entrée

// [id, nom, lat, lon (point DANS l'empreinte), aire min. (m² à l'échelle)]
const DEFS = [
  ['saint-jean', 'Cathédrale Saint-Jean', 45.76073, 4.82757, 400],
  ['saint-nizier', 'Église Saint-Nizier', 45.76478, 4.83367, 300],
  ['hotel-de-ville', 'Hôtel de Ville', 45.76765, 4.83518, 800],
  ['opera', 'Opéra de Lyon', 45.76781, 4.83651, 300],
  ['hotel-dieu', 'Grand Hôtel-Dieu', 45.75874, 4.83643, 3000],
  ['palais-justice', 'Palais de Justice (les 24 colonnes)', 45.76172, 4.82814, 800],
];

// Repère les empreintes, les retire de la ville extrudée et bâtit les
// monuments. À appeler AVANT buildOsmBuildings (qui saute b.monument).
export function buildMonuments(ctx, data) {
  const scale = data.scale ?? 0.5;
  const found = [];
  for (const [id, nom, lat, lon, minArea] of DEFS) {
    const [px, pz] = lyonXZ(lat, lon, scale);
    let best = null;
    for (const b of data.buildings) {
      if (b.p.length < 6 || !insideRing(b.p, px, pz)) continue;
      const a = ringArea(b.p);
      if (a >= minArea && (!best || a > best.a)) best = { b, a };
    }
    if (best) found.push({ id, nom, b: best.b });
  }
  if (!found.length) return;
  const mats = makeMaterials(ctx);

  for (const { id, nom, b } of found) {
    // le péristyle des 24 colonnes regarde la Saône, à l'est
    const f = frameOf(b.p, id === 'palais-justice' ? [1, 0] : null);
    if (id === 'hotel-dieu') {
      // u le long de l'immeuble, v (perpendiculaire) tourné vers le Rhône
      let { ax, az } = f;
      if (-az < 0) { ax = -ax; az = -az; }
      const fr = orient(f, ax, az);
      // nu de la façade : dernier croisement du contour depuis le centre
      const sx = -az, sz = ax;
      let t = -Infinity;
      for (let i = 0, j = b.p.length - 2; i < b.p.length; j = i, i += 2) {
        const ex = b.p[i] - b.p[j], ez = b.p[i + 1] - b.p[j + 1];
        const den = sx * ez - sz * ex;
        if (Math.abs(den) < 1e-9) continue;
        const qx = b.p[j] - fr.x, qz = b.p[j + 1] - fr.z;
        const tt = (qx * ez - qz * ex) / den, w = (qx * sz - qz * sx) / den;
        if (tt > 0 && w >= 0 && w <= 1) t = Math.max(t, tt);
      }
      if (!Number.isFinite(t)) t = fr.W / 2;
      const mx = fr.x + sx * t, mz = fr.z + sz * t;
      const y0 = Math.max(0, ctx.terrainHeight?.(mx, mz) ?? 0);
      const k = new Kit(ctx, mx, mz, y0, ax, az);
      buildHotelDieuDome(k, Math.max(12, b.h));
      k.build(mats, nom);
      ctx.pois?.push({ id, nom, emoji: '🏛️', x: mx, z: mz });
      continue;
    }
    // Retire l'empreinte et tout ce qui est posé dedans (tours, cours…)
    b.monument = true;
    for (const o of data.buildings) {
      if (o === b || o.monument) continue;
      let cx = 0, cz = 0;
      for (let i = 0; i < o.p.length; i += 2) { cx += o.p[i]; cz += o.p[i + 1]; }
      cx /= o.p.length / 2; cz /= o.p.length / 2;
      if (insideRing(b.p, cx, cz)) o.monument = true;
    }
    // u vers l'est : façade à l'ouest (églises orientées, Terreaux, Comédie)
    const fr = orient(f, 1, 0);
    const y0 = groundUnder(ctx, fr);
    const k = new Kit(ctx, fr.x, fr.z, y0, fr.ax, fr.az);
    // dallage sur toute l'emprise OSM : plus de terre nue entre le
    // monument et les rues voisines
    k.box('stone', -fr.L / 2 - 1, fr.L / 2 + 1, -0.4, 0.03, -fr.W / 2 - 1, fr.W / 2 + 1, 0xa39b8c);
    let emoji = '⛪';
    if (id === 'saint-jean') buildSaintJean(k, fr);
    else if (id === 'saint-nizier') buildSaintNizier(k, fr);
    else if (id === 'hotel-de-ville') { buildHotelDeVille(k, fr); emoji = '🏛️'; }
    else if (id === 'opera') { buildOpera(k, fr, mats, ctx, nom); emoji = '🎭'; }
    else if (id === 'palais-justice') { buildPalaisJustice(k, fr); emoji = '⚖️'; }
    k.build(mats, nom);
    ctx.pois?.push({ id, nom, emoji, x: fr.x, z: fr.z });
    if (id === 'saint-jean') {
      // La place Saint-Jean et sa fontaine s'étendent devant la façade
      const L = Math.min(fr.L, 48);
      const d = L / 2 + 12;
      ctx.placeOverrides = ctx.placeOverrides ?? {};
      ctx.placeOverrides['Place Saint-Jean'] = [fr.x - fr.ax * d, fr.z - fr.az * d, Math.atan2(-fr.az, fr.ax)];
    }
  }
}
