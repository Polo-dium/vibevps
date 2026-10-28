import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { detail } from '../render/detail.js';
import { makeRand } from './layout.js';

// PONTS DE PIERRE (ville OSM) : à la place de la dalle grise, un vrai pont
// lyonnais en calcaire doré — arches surbaissées entre des piles à becs
// (avant-becs contre le courant), bandeau d'arc en claveaux plus clairs,
// corniche qui dessine une ligne d'ombre, balustrade à balustres tournés
// (palier Élevé ; parapet plein sinon) et lampadaires tous les ~16 m.
// Par pont : UN maillage de pierre fusionné (+ chaussée + balustres
// instanciés) ; UV en mètres projetés selon la face, comme le reste du décor.

let stoneMat = null, roadMat = null, balusterGeo = null;

function stoneTexture() {
  const S = 256; // 256 px = 3 m
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  const rand = makeRand(4417);
  g.fillStyle = '#9c8f78';
  g.fillRect(0, 0, S, S);
  const course = S / 6; // assises de 50 cm
  for (let r = 0; r < 6; r++) {
    let x = -rand() * 40;
    while (x < S) {
      const w = 50 + rand() * 60;
      const t = rand();
      const base = [180 + t * 18, 171 + t * 16, 150 + t * 14];
      g.fillStyle = `rgb(${base.map((v) => Math.round(v - rand() * 16)).join(',')})`;
      g.fillRect(x + 1.5, r * course + 1.5, w - 3, course - 3);
      // patine : léger dégradé vers le bas de chaque bloc
      const gr = g.createLinearGradient(0, r * course, 0, (r + 1) * course);
      gr.addColorStop(0, 'rgba(255,255,255,0.06)');
      gr.addColorStop(1, 'rgba(60,50,35,0.12)');
      g.fillStyle = gr;
      g.fillRect(x + 1.5, r * course + 1.5, w - 3, course - 3);
      // raccord horizontal : le même bloc réapparaît de l'autre côté
      if (x + w > S) {
        g.fillStyle = `rgb(${base.map((v) => Math.round(v - 8)).join(',')})`;
        g.fillRect(x + 1.5 - S, r * course + 1.5, w - 3, course - 3);
      }
      x += w;
    }
  }
  // grain de la pierre
  for (let i = 0; i < 2600; i++) {
    g.fillStyle = rand() < 0.5 ? 'rgba(70,60,45,0.10)' : 'rgba(255,250,235,0.08)';
    g.fillRect(rand() * S, rand() * S, 1 + rand() * 2, 1 + rand() * 2);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(1 / 3, 1 / 3);
  tex.anisotropy = 8;
  return tex;
}

function materials() {
  if (stoneMat) return;
  stoneMat = new THREE.MeshLambertMaterial({ map: stoneTexture() });
  stoneMat.name = 'pierre-pont';
  roadMat = new THREE.MeshLambertMaterial({
    color: 0x3c3e43, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  });
  // Balustre tourné : piédouche, panse, col, chapiteau
  const prof = [
    [0.0, 0], [0.085, 0], [0.085, 0.06], [0.05, 0.1], [0.075, 0.22], [0.085, 0.3],
    [0.045, 0.45], [0.04, 0.5], [0.075, 0.54], [0.075, 0.6], [0.0, 0.6],
  ].map(([r, y]) => new THREE.Vector2(r, y));
  balusterGeo = new THREE.LatheGeometry(prof, 6);
}

// UV en mètres, projetés selon l'orientation de chaque face (repère local)
function metricUv(geo) {
  const p = geo.attributes.position, n = geo.attributes.normal;
  const uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    const nx = Math.abs(n.getX(i)), ny = Math.abs(n.getY(i)), nz = Math.abs(n.getZ(i));
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    if (ny > 0.6) { uv[i * 2] = x; uv[i * 2 + 1] = z; }
    else if (nz >= nx) { uv[i * 2] = x; uv[i * 2 + 1] = y; }
    else { uv[i * 2] = z; uv[i * 2 + 1] = y; }
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return geo;
}

function prep(geo) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k);
  if (!g.attributes.normal) g.computeVertexNormals();
  return g;
}

// (les pièces longues sont découpées tous les ~2 m pour suivre le dos d'âne)
function box(w, h, d, x, y, z, ry = 0) {
  const g = new THREE.BoxGeometry(w, h, d, w > 4 ? Math.ceil(w / 2) : 1);
  if (ry) g.rotateY(ry);
  g.translate(x, y, z);
  return g;
}

// Arc de cercle d'une arche surbaissée : corde `span`, flèche `rise`
function arcPoints(x0, span, ySpring, rise, segs, extra = 0) {
  const R = (span * span) / 4 / rise / 2 + rise / 2;
  const cy = ySpring + rise - R, cx = x0 + span / 2;
  const half = Math.asin(Math.min(1, span / 2 / R));
  const pts = [];
  for (let i = 0; i <= segs; i++) {
    const a = -half + (2 * half * i) / segs; // de gauche à droite
    pts.push([cx - Math.sin(-a) * (R + extra), cy + Math.cos(a) * (R + extra)]);
  }
  return { pts, R, cx, cy, half };
}

/**
 * Pont de pierre posé au centre (cx0, cz0), tablier orienté `yaw`, de
 * longueur `len` dont `over` m mordent sur chaque berge, demi-largeur
 * `halfW`. `hump` : flèche du dos d'âne au milieu (0 = tablier plat) —
 * la chaussée suit humpAt(s) = hump · (1 − (2s/len)²), s le long du pont.
 * Retourne les emplacements de lampadaires [x, z, y].
 */
export function buildStoneBridge(ctx, { cx0, cz0, yaw, len, over, deckY, bedY, waterY, halfW = 4.75, hump = 0 }) {
  materials();
  const HALF_W = halfW;
  const top = deckY + 0.2;
  const L2 = len / 2;
  const wSpan = len - over * 2; // emprise de l'eau
  const n = Math.max(1, Math.round(wSpan / 24));
  const PIER = 2.6;
  const inset = 0.6; // culées : l'arche démarre un peu dans la berge
  const span = (wSpan + inset * 2 - (n - 1) * PIER) / n;
  const ySpring = waterY + 0.25;
  const rise = Math.min(span * 0.28, deckY - 0.75 - ySpring);
  const humpAt = (x) => hump * Math.max(0, 1 - (x / L2) ** 2);

  // --- Corps du pont : profil percé d'arches, extrudé sur la largeur ------
  const shape = new THREE.Shape();
  const yBot = bedY - 0.3;
  shape.moveTo(-L2, yBot);
  shape.lineTo(L2, yBot);
  shape.lineTo(L2, top);
  // dessus du profil découpé tous les 2 m : il épousera le dos d'âne
  for (let x = L2 - 2; x > -L2 + 0.5; x -= 2) shape.lineTo(x, top);
  shape.lineTo(-L2, top);
  shape.closePath();
  const arches = [];
  for (let k = 0; k < n; k++) {
    const x0 = -wSpan / 2 - inset + k * (span + PIER);
    const a = arcPoints(x0, span, ySpring, rise, 18);
    arches.push({ x0, ...a });
    const hole = new THREE.Path();
    hole.moveTo(x0, bedY - 0.1);
    for (const [x, y] of a.pts) hole.lineTo(x, y);
    hole.lineTo(x0 + span, bedY - 0.1);
    hole.closePath();
    shape.holes.push(hole);
  }
  const body = new THREE.ExtrudeGeometry(shape, { depth: HALF_W * 2, bevelEnabled: false, curveSegments: 1 });
  body.translate(0, 0, -HALF_W);
  const parts = [prep(body)];

  // Bandeau d'arc : claveaux en saillie de 12 cm sur chaque tête
  for (const a of arches) {
    const inner = a.pts;
    const outer = arcPoints(a.x0, span, ySpring, rise, 18, 0.55).pts;
    const ring = new THREE.Shape();
    ring.moveTo(inner[0][0], inner[0][1]);
    for (const [x, y] of inner) ring.lineTo(x, y);
    for (let i = outer.length - 1; i >= 0; i--) ring.lineTo(outer[i][0], outer[i][1]);
    ring.closePath();
    for (const zs of [-1, 1]) {
      const g = new THREE.ExtrudeGeometry(ring, { depth: 0.12, bevelEnabled: false });
      g.translate(0, 0, zs > 0 ? HALF_W : -HALF_W - 0.12);
      parts.push(prep(g));
    }
  }

  // Piles : avant-becs triangulaires (amont/aval) coiffés d'un chaperon
  for (let k = 1; k < n; k++) {
    const px = -wSpan / 2 - inset + k * (span + PIER) - PIER / 2;
    const hb = ySpring + 0.9 - yBot;
    for (const zs of [-1, 1]) {
      const d = PIER / Math.SQRT2;
      parts.push(prep(box(d, hb, d, px, yBot + hb / 2, zs * HALF_W, Math.PI / 4)));
      const cap = new THREE.ConeGeometry(PIER / 2 + 0.05, 1.1, 4, 1);
      cap.translate(px, yBot + hb + 0.55, zs * HALF_W);
      parts.push(prep(cap));
    }
  }

  // Corniche (ligne d'ombre sous le parapet) + plinthe + parapet
  const eleve = detail.level === 'eleve';
  parts.push(prep(box(len, 0.28, HALF_W * 2 + 0.5, 0, deckY + 0.06, 0)));
  for (const zs of [-1, 1]) {
    const zr = zs * (HALF_W - 0.05);
    if (eleve) {
      parts.push(prep(box(len, 0.22, 0.5, 0, top + 0.11, zr)));          // plinthe
      parts.push(prep(box(len, 0.16, 0.56, 0, top + 0.22 + 0.6 + 0.08, zr))); // main courante
    } else {
      parts.push(prep(box(len, 0.98, 0.42, 0, top + 0.49, zr)));          // parapet plein
      parts.push(prep(box(len, 0.12, 0.54, 0, top + 1.0, zr)));
    }
    // Dés de balustrade au droit des piles et tous les ~4 m
    for (let x = -L2 + 0.4; x <= L2 - 0.3; x += (len - 0.8) / Math.max(1, Math.round((len - 0.8) / 4.2))) {
      parts.push(prep(box(0.5, 1.06, 0.6, x, top + 0.53, zr)));
    }
  }
  const merged = mergeGeometries(parts);
  if (hump > 0) {
    // Dos d'âne : tout ce qui est au-dessus des naissances des arches monte
    // avec le tablier (progressivement entre naissance et chaussée) ; piles
    // et fondations restent en place
    const p = merged.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const y = p.getY(i);
      if (y <= ySpring) continue;
      const t = Math.min(1, (y - ySpring) / Math.max(0.1, top - ySpring));
      p.setY(i, y + humpAt(p.getX(i)) * t);
    }
    merged.computeVertexNormals();
  }
  const geo = metricUv(merged);
  const mesh = new THREE.Mesh(geo, stoneMat);
  mesh.position.set(cx0, 0, cz0);
  mesh.rotation.y = yaw;
  mesh.castShadow = mesh.receiveShadow = true;
  ctx.scene.add(mesh);

  // Chaussée (bande d'asphalte entre deux trottoirs de pierre)
  const roadGeo = new THREE.PlaneGeometry(len, Math.max(3, HALF_W * 2 - 3.3), Math.ceil(len / 2), 1);
  roadGeo.rotateX(-Math.PI / 2);
  {
    const p = roadGeo.attributes.position;
    for (let i = 0; i < p.count; i++) p.setY(i, top + 0.005 + humpAt(p.getX(i)));
    roadGeo.computeVertexNormals();
  }
  const road = new THREE.Mesh(roadGeo, roadMat);
  const roadG = new THREE.Group();
  roadG.add(road);
  roadG.position.set(cx0, 0, cz0);
  roadG.rotation.y = yaw;
  road.receiveShadow = true;
  ctx.scene.add(roadG);

  // Balustres instanciés entre les dés (palier Élevé)
  if (eleve) {
    const STEP = 0.3;
    const count = Math.floor((len - 1) / STEP) * 2;
    const inst = new THREE.InstancedMesh(balusterGeo, stoneMat, count);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
    const v = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1);
    let i = 0;
    for (const zs of [-1, 1]) {
      for (let x = -L2 + 0.6; x < L2 - 0.5 && i < count; x += STEP) {
        v.set(x, top + 0.22 + humpAt(x), zs * (HALF_W - 0.05)).applyQuaternion(q);
        m.compose(v.set(v.x + cx0, v.y, v.z + cz0), q, one);
        inst.setMatrixAt(i++, m);
      }
    }
    inst.count = i;
    inst.instanceMatrix.needsUpdate = true;
    inst.castShadow = true;
    ctx.scene.add(inst);
  }

  // Lampadaires sur les deux trottoirs, en quinconce
  const lamps = [];
  const nl = Math.max(2, Math.round(len / 16));
  const px = Math.cos(yaw), pz = -Math.sin(yaw);
  for (let k = 0; k <= nl; k++) {
    const s = -L2 + 1.5 + ((len - 3) * k) / nl;
    const side = k % 2 ? 1 : -1;
    const off = side * (HALF_W - 0.75);
    lamps.push([cx0 + px * s - pz * off, cz0 + pz * s + px * off, top + humpAt(s)]);
  }
  return lamps;
}
