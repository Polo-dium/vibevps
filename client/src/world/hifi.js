import * as THREE from 'three';
import { flattenColored } from './utils.js';

// LES LIEUX EN HAUTE FIDÉLITÉ 🏛️
//
// Entrer dans la zone du Roi de la colline téléporte dans une reconstitution
// dense et soignée du lieu. Le truc : la carte HD est bâtie DANS la même
// scène, très loin de la ville (OFFSET). Le masquage par distance déjà en
// place fait alors tout le travail — la ville entière disparaît d'elle-même
// quand on est là-bas, et la carte HD disparaît quand on est en ville. Pas
// de seconde scène à gréer, pas de lumières ni de ciel à dupliquer.
//
// Le décor fixe est cuit en couleurs de sommets (flattenColored) : on peut
// donc se permettre beaucoup plus de détail qu'en ville pour un coût de
// rendu dérisoire.
const OFFSET = 20000; // en x, bien au-delà de toute portée de vue

// Quels POI du Roi de la colline mènent à quelle carte HD. Les trois points
// situés SUR la place mènent à Bellecour ; les autres restent à bâtir.
const ROUTES = {
  arcade: 'bellecour',
  petanque: 'bellecour',
  roue: 'bellecour',
};

export function createHiFi(ctx, { notify } = {}) {
  const maps = new Map(); // id -> { group, spawn }
  let active = null;      // id de la carte où l'on se trouve
  let backTo = null;      // position de retour en ville

  function build(id) {
    if (maps.has(id)) return maps.get(id);
    const group = new THREE.Group();
    group.position.set(OFFSET, 0, 0);
    ctx.scene.add(group);
    const made = id === 'bellecour' ? buildBellecourHd(ctx, group) : null;
    if (!made) { ctx.scene.remove(group); return null; }
    maps.set(id, made);
    return made;
  }

  function enter(poiId, nom) {
    const mapId = ROUTES[poiId];
    if (!mapId) {
      notify?.(`🚧 ${nom ?? 'Ce lieu'} n'a pas encore sa version haute fidélité — ça arrive !`);
      return false;
    }
    const map = build(mapId);
    if (!map) return false;
    const p = ctx.playerPos();
    backTo = { x: p.x, y: p.y, z: p.z };
    active = mapId;
    ctx.inHiFi = true;
    ctx.teleport?.(OFFSET + map.spawn.x, map.spawn.y, map.spawn.z, map.spawn.ry);
    notify?.('🏛️ Place Bellecour — version haute fidélité. Reviens par le portail doré.');
    return true;
  }

  function exit() {
    if (!active || !backTo) return;
    active = null;
    ctx.inHiFi = false;
    ctx.teleport?.(backTo.x, backTo.y + 0.2, backTo.z);
    notify?.('↩️ Retour dans Lyon.');
  }

  return { enter, exit, get active() { return active; } };
}

// --- La place Bellecour en haute fidélité ---------------------------------
// Même gabarit que la vraie (312 × 212 m, ramenée à l'échelle du jeu), mais
// avec le niveau de détail qu'on ne peut pas se payer sur toute la ville.
function buildBellecourHd(ctx, group) {
  const W = 156, D = 106;           // demi-gabarit ×2 : la place à l'échelle
  const halfW = W / 2, halfD = D / 2;
  const statics = new THREE.Group(); // tout le décor fixe, cuit à la fin

  const put = (mesh, x, y, z, ry = 0) => {
    mesh.position.set(x, y, z);
    mesh.rotation.y = ry;
    statics.add(mesh);
    return mesh;
  };
  const box = (w, h, d, color) => new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshLambertMaterial({ color }));
  const cyl = (rt, rb, h, seg, color) => new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), new THREE.MeshLambertMaterial({ color }));

  // Gravier rouge de Bellecour : texture fine, répétée serré
  const gravel = new THREE.Mesh(
    new THREE.PlaneGeometry(W, D),
    new THREE.MeshLambertMaterial({ map: makeGravelTexture() })
  );
  gravel.rotation.x = -Math.PI / 2;
  gravel.position.y = 0.02;
  group.add(gravel); // texturé : ne peut pas être cuit en couleurs de sommets

  // Bordure de pierre tout autour + trottoir
  for (const [sx, sz, bw, bd] of [
    [0, -halfD, W, 2.4], [0, halfD, W, 2.4],
    [-halfW, 0, 2.4, D], [halfW, 0, 2.4, D],
  ]) {
    put(box(bw, 0.32, bd, 0xd8d2c2), sx, 0.16, sz);
  }

  // Les façades haussmanniennes qui encadrent la place : c'est elles qui
  // donnent le sentiment d'être à Bellecour.
  const facade = makeFacadeTextureHd();
  const facadeMat = new THREE.MeshLambertMaterial({ map: facade });
  for (const [sx, sz, bw, bd, ry] of [
    [0, -halfD - 16, W + 40, 30, 0],
    [0, halfD + 16, W + 40, 30, 0],
    [-halfW - 16, 0, 30, D, 0],
    [halfW + 16, 0, 30, D, 0],
  ]) {
    const H = 26;
    const g2 = new THREE.BoxGeometry(bw, H, bd);
    // UV mises à l'échelle : une cellule de texture ≈ une travée de fenêtres
    const uv = g2.attributes.uv;
    for (let i = 0; i < uv.count; i++) {
      uv.setXY(i, uv.getX(i) * (bw / 5), uv.getY(i) * (H / 4));
    }
    facade.wrapS = facade.wrapT = THREE.RepeatWrapping;
    const b = new THREE.Mesh(g2, facadeMat);
    b.position.set(sx, H / 2, sz);
    b.rotation.y = ry;
    group.add(b);
    ctx.colliders.push({
      minX: 20000 + sx - bw / 2, maxX: 20000 + sx + bw / 2,
      minY: 0, maxY: H,
      minZ: sz - bd / 2, maxZ: sz + bd / 2,
    });
  }

  // Double rangée d'arbres au nord et au sud, comme sur la vraie place
  for (const sz of [-halfD + 9, -halfD + 17, halfD - 9, halfD - 17]) {
    for (let x = -halfW + 12; x <= halfW - 12; x += 9) {
      const jitter = ((x * 7919 + sz * 104729) % 100) / 100 - 0.5;
      const tx = x + jitter * 1.6;
      put(cyl(0.26, 0.36, 3.2, 8, 0x5d4632), tx, 1.6, sz);
      // Houppier en deux étages : bien plus dense que l'arbre de la ville
      const f1 = new THREE.Mesh(new THREE.IcosahedronGeometry(2.5, 1), new THREE.MeshLambertMaterial({ color: 0x4e7d38, flatShading: true }));
      put(f1, tx, 4.6, sz);
      const f2 = new THREE.Mesh(new THREE.IcosahedronGeometry(1.8, 1), new THREE.MeshLambertMaterial({ color: 0x5b8f42, flatShading: true }));
      put(f2, tx, 6.3, sz + 0.4);
    }
  }

  // Lampadaires en fonte, ouvragés (fût cannelé, couronne, globe)
  const globes = [];
  for (const sz of [-halfD + 5, halfD - 5]) {
    for (let x = -halfW + 14; x <= halfW - 14; x += 22) {
      put(cyl(0.9, 1.1, 0.5, 8, 0x3a3f47), x, 0.25, sz);
      put(cyl(0.16, 0.24, 5.2, 8, 0x2e333a), x, 2.85, sz);
      put(cyl(0.42, 0.28, 0.5, 8, 0x2e333a), x, 5.6, sz);
      const globe = new THREE.Mesh(
        new THREE.SphereGeometry(0.42, 12, 10),
        new THREE.MeshBasicMaterial({ color: 0xffe6b0 })
      );
      globe.position.set(x, 6.1, sz);
      globe.userData.noShadow = true;
      group.add(globe); // émissif : hors cuisson
      globes.push(globe);
    }
  }

  // Bancs le long des allées
  for (const sz of [-halfD + 22, halfD - 22]) {
    for (let x = -halfW + 20; x <= halfW - 20; x += 16) {
      put(box(3.2, 0.16, 0.8, 0x7a5433), x, 0.62, sz);
      put(box(3.2, 0.7, 0.14, 0x7a5433), x, 1.0, sz + 0.36);
      for (const dx of [-1.3, 1.3]) put(box(0.16, 0.6, 0.7, 0x3a3f47), x + dx, 0.3, sz);
    }
  }

  // La statue équestre sur son socle monumental
  put(box(9, 1.2, 7, 0xcfc7b2), 0, 0.6, 0);
  put(box(7.4, 4.4, 5.4, 0xbdb49e), 0, 3.4, 0);
  put(box(8.2, 0.5, 6.2, 0xcfc7b2), 0, 5.8, 0);
  const bronze = 0x4a6b52;
  put(box(4.6, 1.7, 1.5, bronze), 0, 7.2, 0);            // corps du cheval
  put(box(1.2, 1.5, 1.1, bronze), 2.0, 8.2, 0);           // encolure + tête
  for (const [dx, dz] of [[-1.6, -0.5], [-1.6, 0.5], [1.4, -0.5], [1.4, 0.5]]) {
    put(box(0.34, 2.2, 0.34, bronze), dx, 5.9, dz);       // jambes
  }
  put(box(0.8, 1.6, 0.7, bronze), -0.2, 8.6, 0);          // le Roi
  put(box(0.5, 0.5, 0.5, bronze), -0.2, 9.6, 0);          // tête

  // Portail doré du retour, bien visible au sud de la place
  const portal = new THREE.Group();
  const ringMat = new THREE.MeshBasicMaterial({ color: 0xffc94d, transparent: true, opacity: 0.85 });
  const ring = new THREE.Mesh(new THREE.TorusGeometry(2.6, 0.26, 10, 28), ringMat);
  ring.position.set(0, 3.2, halfD - 12);
  ring.userData.noShadow = true;
  portal.add(ring);
  const veil = new THREE.Mesh(
    new THREE.CircleGeometry(2.4, 28),
    new THREE.MeshBasicMaterial({
      color: 0xffe08a, transparent: true, opacity: 0.3,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    })
  );
  veil.position.copy(ring.position);
  veil.userData.noShadow = true;
  portal.add(veil);
  group.add(portal);

  // Cuisson du décor fixe : des centaines de pièces → un seul draw call
  const baked = flattenColored(statics);
  if (baked) group.add(baked);

  // Les globes s'allument la nuit, comme en ville
  ctx.updatables.push(() => {
    const n = ctx.env?.night ?? 0;
    const v = 0.35 + 0.65 * n;
    for (const g of globes) g.material.color.setRGB(v, v * 0.92, v * 0.72);
    ring.material.opacity = 0.7 + 0.3 * Math.abs(Math.sin(Date.now() / 700));
  });

  return {
    group,
    // On arrive dos au portail, face à la place et à la statue : le premier
    // regard porte sur le lieu, pas sur la porte de sortie.
    spawn: { x: 0, y: 0, z: halfD - 18, ry: 0 },
    portal: { x: 0, z: halfD - 12 },
  };
}

// Gravier rouge lyonnais : grain fin, quelques cailloux plus clairs
function makeGravelTexture() {
  const S = 256;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  g.fillStyle = '#b5714a';
  g.fillRect(0, 0, S, S);
  for (let i = 0; i < 9000; i++) {
    const v = 120 + Math.random() * 90;
    g.fillStyle = `rgba(${v}, ${v * 0.68}, ${v * 0.5}, 0.5)`;
    g.fillRect(Math.random() * S, Math.random() * S, 2, 2);
  }
  for (let i = 0; i < 400; i++) {
    g.fillStyle = 'rgba(226, 205, 180, 0.5)';
    g.fillRect(Math.random() * S, Math.random() * S, 3, 3);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(26, 18);
  return t;
}

// Façade haussmannienne en 512 px : une travée complète (pierre, refends,
// fenêtre à encadrement, balcon en fer forgé). Quatre fois la définition de
// la texture de ville — c'est tout l'intérêt d'un lieu unique.
function makeFacadeTextureHd() {
  const S = 512;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  g.fillStyle = '#e8dfcb';
  g.fillRect(0, 0, S, S);
  // Grain de pierre
  for (let i = 0; i < 6000; i++) {
    const v = 214 + Math.random() * 34;
    g.fillStyle = `rgba(${v}, ${v - 6}, ${v - 18}, 0.3)`;
    g.fillRect(Math.random() * S, Math.random() * S, 3, 3);
  }
  // Refends horizontaux
  g.fillStyle = 'rgba(120, 110, 92, 0.5)';
  g.fillRect(0, S - 10, S, 7);
  g.fillStyle = 'rgba(255, 255, 255, 0.45)';
  g.fillRect(0, S - 3, S, 3);
  // Fenêtre
  const wx = S * 0.28, ww = S * 0.44, wy = S * 0.14, wh = S * 0.56;
  g.fillStyle = '#f4eee0';
  g.fillRect(wx - 14, wy - 14, ww + 28, wh + 28);
  g.fillStyle = 'rgba(110, 100, 84, 0.4)';
  g.fillRect(wx - 14, wy + wh + 8, ww + 28, 6);
  const grad = g.createLinearGradient(0, wy, 0, wy + wh);
  grad.addColorStop(0, '#55606f');
  grad.addColorStop(0.55, '#39424f');
  grad.addColorStop(1, '#2b323c');
  g.fillStyle = grad;
  g.fillRect(wx, wy, ww, wh);
  // Petits-bois
  g.fillStyle = 'rgba(244, 238, 224, 0.9)';
  g.fillRect(wx + ww / 2 - 3, wy, 6, wh);
  g.fillRect(wx, wy + wh / 2 - 3, ww, 6);
  g.fillStyle = 'rgba(244, 238, 224, 0.45)';
  for (const f of [0.25, 0.75]) {
    g.fillRect(wx + ww * f - 1, wy, 2, wh);
    g.fillRect(wx, wy + wh * f - 1, ww, 2);
  }
  // Clé de voûte + balcon en fer forgé
  g.fillStyle = '#f8f3e8';
  g.fillRect(wx + ww / 2 - 12, wy - 26, 24, 20);
  g.strokeStyle = 'rgba(28, 30, 34, 0.85)';
  g.lineWidth = 3;
  const ry0 = wy + wh + 20, ry1 = ry0 + S * 0.1;
  g.beginPath();
  g.moveTo(wx - 16, ry0); g.lineTo(wx + ww + 16, ry0);
  g.moveTo(wx - 16, ry1); g.lineTo(wx + ww + 16, ry1);
  g.stroke();
  g.lineWidth = 2;
  for (let bx = wx - 12; bx <= wx + ww + 12; bx += 11) {
    g.beginPath(); g.moveTo(bx, ry0); g.lineTo(bx, ry1); g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}
