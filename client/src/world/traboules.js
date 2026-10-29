import * as THREE from 'three';
import { Kit, ashlarTexture } from './monuments.js';
import { lyonXZ } from './squares.js';
import { makeGlowSprite, makeTextTexture } from './utils.js';
import { audio } from '../audio.js';

// LES TRABOULES VISITABLES (ville OSM). Une traboule, c'est une porte
// d'immeuble qui ne mène pas chez quelqu'un mais de l'autre côté de l'îlot :
// couloir voûté, cour intérieure, escaliers, puis la rue d'à côté. Les
// immeubles OSM étant des volumes pleins, chaque traboule est bâtie dans une
// « poche » hors carte, sous le sol (ctx.pockets) : on pousse la porte de la
// vraie adresse, on traverse le couloir et la cour à pied, et la porte du
// fond débouche sur la vraie rue d'arrivée.
//   - longue traboule du Vieux Lyon (54 rue Saint-Jean → 27 rue du Bœuf),
//     avec la cour de la Tour Rose et ses galeries Renaissance ;
//   - cour des Voraces (9 place Colbert → montée Saint-Sébastien), et son
//     escalier monumental sur six niveaux.
// Les poches sont aussi utilisées par l'intérieur du bouchon (cafes.js).

const POCKET_Y = -300;

// Poche : rectangle hors carte où ctx.terrainHeight renvoie le plancher.
// Une seule surcharge du terrain pour toutes les poches.
export function makePocket(ctx, w, d) {
  if (!ctx.pockets) {
    ctx.pockets = [];
    const natural = ctx.terrainHeight;
    ctx.terrainHeight = (x, z) => {
      for (const p of ctx.pockets) {
        if (x > p.minX && x < p.maxX && z > p.minZ && z < p.maxZ) return p.y;
      }
      return natural(x, z);
    };
    // dans une poche ? (pas de « Glagla, tu es dans le fleuve » à −300 m)
    ctx.inPocket = (x, z) => ctx.pockets.some((p) => x > p.minX && x < p.maxX && z > p.minZ && z < p.maxZ);
  }
  const k = ctx.pockets.length;
  const ox = -(ctx.worldBound ?? 1500) - 600 - k * 90, oz = 0;
  const p = { ox, oz, y: POCKET_Y, minX: ox - w / 2 - 2, maxX: ox + w / 2 + 2, minZ: oz - 2, maxZ: oz + d + 2 };
  ctx.pockets.push(p);
  return p;
}

function mats() {
  const ashlar = ashlarTexture();
  return {
    stone: new THREE.MeshLambertMaterial({ map: ashlar, vertexColors: true }),
    plain: new THREE.MeshLambertMaterial({ vertexColors: true }),
    vault: new THREE.MeshLambertMaterial({ map: ashlar, vertexColors: true, side: THREE.DoubleSide }),
  };
}

// Fenêtres à meneaux sur un mur de cour (u le long de la cour, v = mur)
function windows(k, u0, u1, v, side, y0, y1, color = 0x2a2420) {
  for (let y = y0; y < y1 - 2; y += 3.2) {
    for (let u = u0 + 1.4; u < u1 - 1; u += 2.6) {
      k.box('plain', u - 0.45, u + 0.45, y + 0.6, y + 2.1, v - side * 0.02, v + side * 0.02, color);
      k.box('stone', u - 0.6, u + 0.6, y + 0.45, y + 0.6, v - side * 0.12, v + side * 0.12, 0xe6dcc6);
      k.box('stone', u - 0.04, u + 0.04, y + 0.6, y + 2.1, v - side * 0.05, v + side * 0.05, 0xe6dcc6);
    }
  }
}

// Intérieur commun : couloir voûté, cour, couloir, deux portes.
// Repère Kit : u = profondeur (0 → L), v = travers.
function buildInterior(ctx, kind, M) {
  const L = 34, CW = 1.5, CH = 2.6; // couloirs : demi-largeur, hauteur des murs
  const pocket = makePocket(ctx, 14, L);
  const k = new Kit(ctx, pocket.ox, pocket.oz, pocket.y, 0, 1);
  const WALL = kind === 'tourrose' ? 0xffd9a8 : 0xf6e8cc; // (la pierre de taille assombrit)
  const DOOR = 0x4a3020;
  // sol pavé
  k.box('stone', 0, L, -0.3, 0, -7, 7, 0x8f877a);
  const corridor = (u0, u1) => {
    for (const s of [-1, 1]) k.box('stone', u0, u1, 0, CH + 1.6, s * CW, s * (CW + 0.6), WALL, { collide: true });
    // voûte en berceau
    // demi-cylindre : axe le long du couloir (x local), moitié haute
    const vault = new THREE.CylinderGeometry(CW + 0.3, CW + 0.3, u1 - u0, 12, 1, true, 0, Math.PI);
    vault.rotateZ(Math.PI / 2);
    k.add('vault', vault, { u: (u0 + u1) / 2, y: CH, color: 0xc9b89a });
    k.box('stone', u0, u1, CH + 1.6, CH + 2, -CW - 0.6, CW + 0.6, WALL);
    // lanternes
    for (let u = u0 + 2.5; u < u1; u += 4.5) {
      const [x, z] = k.world(u, CW - 0.1);
      const glow = makeGlowSprite(0xffc070, 2.2, 0.75);
      glow.position.set(x, pocket.y + 2.3, z);
      ctx.scene.add(glow);
      k.box('plain', u - 0.12, u + 0.12, 2.1, 2.45, CW - 0.25, CW - 0.05, 0x2b2b2b);
    }
  };
  corridor(0, 10);
  corridor(L - 10, L);
  // portes du bout (vantaux de bois) et murs de fond
  for (const u of [-0.3, L + 0.05]) {
    k.box('plain', u, u + 0.25, 0, CH + 0.4, -CW, CW, DOOR);
    k.box('stone', u - 0.2, u + 0.45, CH + 0.4, CH + 2, -CW - 0.6, CW + 0.6, WALL, { collide: true });
  }
  k.solid(-0.6, -0.3, 0, 4, -CW, CW);
  k.solid(L + 0.3, L + 0.6, 0, 4, -CW, CW);
  // la cour : quatre façades de 15 m, ouvertes sur les deux couloirs
  const HC = 15, c0 = 10, c1 = L - 10, CWD = 6;
  for (const s of [-1, 1]) k.box('stone', c0, c1, 0, HC, s * CWD, s * (CWD + 0.6), WALL, { collide: true });
  for (const [u, du] of [[c0 - 0.6, c0], [c1, c1 + 0.6]]) {
    for (const s of [-1, 1]) k.box('stone', u, du, 0, HC, s * CW, s * CWD, WALL, { collide: true });
    k.box('stone', u, du, CH + 1.6, HC, -CW, CW, WALL);
  }
  windows(k, c0, c1, CWD - 0.01, -1, 0, HC);
  // toit de tuiles au-dessus des façades (silhouette de ciel)
  for (const s of [-1, 1]) k.box('plain', c0 - 1, c1 + 1, HC, HC + 0.4, s * (CWD - 0.4), s * (CWD + 1.4), 0xa8543c);

  if (kind === 'tourrose') {
    // La Tour Rose : cage d'escalier ronde, ocre rose, fenêtres en
    // hélice, adossée au mur est de la cour
    const tu = (c0 + c1) / 2, tv = -CWD + 1.6;
    k.add('stone', new THREE.CylinderGeometry(2.1, 2.2, 19, 18), { u: tu, y: 9.5, v: tv, color: 0xe08f74 });
    k.add('stone', new THREE.CylinderGeometry(2.4, 2.4, 0.5, 18), { u: tu, y: 19.2, v: tv, color: 0xcf7d62 });
    k.solid(tu - 1.6, tu + 1.6, 0, 19, tv - 1.6, tv + 1.6);
    for (let i = 0; i < 9; i++) {
      const a = 1.2 + i * 0.85, y = 1.8 + i * 1.9;
      const r = 2.18;
      k.add('plain', new THREE.BoxGeometry(0.55, 1.1, 0.08), {
        u: tu + Math.sin(a) * r, y, v: tv + Math.cos(a) * r, ry: a, color: 0x2a2420,
      });
    }
    k.add('plain', new THREE.BoxGeometry(0.9, 2.1, 0.08), { u: tu, y: 1.05, v: tv + 2.17, color: DOOR });
    // galeries Renaissance sur trois niveaux (mur ouest), arcs en plein cintre
    for (let lvl = 0; lvl < 3; lvl++) {
      const y = 3.4 + lvl * 3.6;
      k.box('stone', c0 + 0.5, c1 - 0.5, y - 0.15, y + 0.1, CWD - 2.2, CWD, 0xe6dcc6, lvl === 0 ? {} : {});
      for (let u = c0 + 1.2; u <= c1 - 1; u += 2.4) {
        k.add('stone', new THREE.CylinderGeometry(0.16, 0.18, 2.6, 8), { u, y: y + 1.4, v: CWD - 2.05, color: 0xefe6d2 });
        k.add('stone', new THREE.TorusGeometry(1.05, 0.12, 5, 10, Math.PI), { u: u + 1.2, y: y + 2.7, v: CWD - 2.05, color: 0xefe6d2 });
      }
      // balustrade
      k.box('stone', c0 + 0.5, c1 - 0.5, y + 0.1, y + 0.9, CWD - 2.2, CWD - 2.05, 0xe6dcc6);
    }
    // puits au milieu de la cour
    k.add('stone', new THREE.CylinderGeometry(0.9, 0.95, 0.9, 14), { u: tu, y: 0.45, v: 1.2, color: 0xcfc3a9 });
    k.solid(tu - 0.9, tu + 0.9, 0, 0.9, 0.3, 2.1);
  } else {
    // Cour des Voraces : l'escalier monumental à jour, six paliers d'arcades
    const v0 = -CWD, depth = 2.6;
    for (let lvl = 0; lvl < 6; lvl++) {
      const y = lvl * 2.5;
      k.box('stone', c0 + 1, c1 - 1, y + 2.3, y + 2.55, v0, v0 + depth, 0xe9dfca);
      for (let u = c0 + 1; u <= c1 - 1; u += (c1 - c0 - 2) / 4) {
        k.box('stone', u - 0.25, u + 0.25, y, y + 2.3, v0 + depth - 0.5, v0 + depth, 0xe9dfca);
      }
      // volée d'escalier en diagonale (une planche inclinée par niveau)
      const run = new THREE.BoxGeometry(5.5, 0.22, 1.1);
      k.add('stone', run, { u: (c0 + c1) / 2 + (lvl % 2 ? 1.8 : -1.8), y: y + 1.25, v: v0 + 1.1, rz: lvl % 2 ? 0.42 : -0.42, color: 0xd8ccb4 });
    }
    k.box('plain', (c0 + c1) / 2 - 3.5, (c0 + c1) / 2 + 3.5, 0, 15, v0 + 0.02, v0 + 0.05, 0x3a3128);
    k.solid(c0, c1, 0, 15, v0, v0 + depth);
  }
  k.build(M, kind === 'tourrose' ? 'traboule-tour-rose' : 'traboule-voraces');
  // plaque « TRABOULE » à chaque entrée (côté couloir)
  return {
    pocket,
    a: { x: pocket.ox, z: pocket.oz + 1.6, ry: Math.PI },       // entrée côté A, regard vers le fond
    b: { x: pocket.ox, z: pocket.oz + L - 1.6, ry: 0 },         // entrée côté B, regard vers l'entrée
    trigA: (x, z) => Math.abs(x - pocket.ox) < CW && z < pocket.oz + 0.6,
    trigB: (x, z) => Math.abs(x - pocket.ox) < CW && z > pocket.oz + L - 0.6,
  };
}

// Porte sur rue : encadrement de pierre, vantaux, plaque émaillée
function streetDoor(ctx, spot, M) {
  const k = new Kit(ctx, spot.x, spot.z, spot.y, spot.ax, spot.az);
  // u = profondeur vers la rue (négatif = dans le mur), v = largeur
  k.box('stone', -0.25, 0.12, 0, 3.4, -1.25, -0.85, 0xd8c8a8);
  k.box('stone', -0.25, 0.12, 0, 3.4, 0.85, 1.25, 0xd8c8a8);
  k.box('stone', -0.25, 0.14, 3.1, 3.55, -1.3, 1.3, 0xcbb994);
  k.box('plain', -0.22, -0.12, 0, 3.1, -0.85, 0.85, 0x4a3020);
  k.box('plain', -0.1, -0.08, 1.4, 1.6, 0.55, 0.7, 0xc9a227); // poignée
  k.build(M, 'porte-traboule');
  // plaque bleue « TRABOULE »
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 0.32),
    new THREE.MeshBasicMaterial({ map: makeTextTexture('TRABOULE', { color: '#ffffff', bg: '#1d3f8a', width: 256, height: 80 }) }));
  const [x, z] = k.world(0.14, 1.9);
  sign.position.set(x, spot.y + 2.4, z);
  sign.rotation.y = Math.atan2(spot.ax, spot.az);
  ctx.scene.add(sign);
}

// Point de rue au pied de l'adresse : la porte se pose au bord du trottoir,
// face à la chaussée
function doorSpot(ctx, data, lat, lon) {
  const [x, z] = lyonXZ(lat, lon, data.scale ?? 0.5);
  let best = null;
  for (const r of data.roads) {
    for (let i = 0; i + 3 < r.p.length; i += 2) {
      const ax = r.p[i], az = r.p[i + 1], ex = r.p[i + 2] - ax, ez = r.p[i + 3] - az;
      const l2 = ex * ex + ez * ez || 1;
      const t = Math.max(0, Math.min(1, ((x - ax) * ex + (z - az) * ez) / l2));
      const px = ax + ex * t, pz = az + ez * t, d = Math.hypot(px - x, pz - z);
      if (!best || d < best.d) best = { d, px, pz, w: r.w };
    }
  }
  if (!best) return null;
  let nx = x - best.px, nz = z - best.pz;
  const nl = Math.hypot(nx, nz) || 1;
  nx /= nl; nz /= nl;
  const off = best.w / 2 + 1.2;
  const sx = best.px + nx * off, sz = best.pz + nz * off;
  // ax/az : vers la rue (la porte regarde la chaussée)
  return { x: sx, z: sz, y: Math.max(0, ctx.terrainHeight(sx, sz)), ax: -nx, az: -nz };
}

const TRABOULES = [
  {
    kind: 'tourrose', nom: 'Longue traboule & Tour Rose',
    a: [45.76262, 4.82750], b: [45.76285, 4.82690],
    loreIn: '🚪 La longue traboule : quatre immeubles, deux cours, la Tour Rose… Chut, des gens habitent ici, gone !',
    loreA: '🚪 Rue Saint-Jean. Les soyeux passaient par là pour garder leurs étoffes au sec.',
    loreB: '🚪 Rue du Bœuf ! La traboule t’a fait traverser tout l’îlot.',
  },
  {
    kind: 'voraces', nom: 'Cour des Voraces',
    a: [45.77120, 4.83510], b: [45.77040, 4.83580],
    loreIn: '🚪 La cour des Voraces : l’escalier des canuts révoltés de 1848. Six étages de courage !',
    loreA: '🚪 Place Colbert. Les canuts surveillaient la ville d’ici.',
    loreB: '🚪 Montée Saint-Sébastien : la traboule t’a descendu d’un étage de pente.',
  },
];

export function buildTraboulesReelles(ctx, data) {
  const M = mats();
  let n = 0;
  for (const T of TRABOULES) {
    const A = doorSpot(ctx, data, ...T.a), B = doorSpot(ctx, data, ...T.b);
    if (!A || !B) continue;
    const I = buildInterior(ctx, T.kind, M);
    streetDoor(ctx, A, M);
    streetDoor(ctx, B, M);
    ctx.pois?.push({ id: 'traboule-' + T.kind, nom: T.nom, emoji: '🚪', x: A.x, z: A.z });
    const enter = (to) => {
      ctx.teleport?.(to.x, I.pocket.y + 0.05, to.z, to.ry);
      audio.traboule?.();
      ctx.notify?.(T.loreIn);
    };
    // sortie : un pas sur le trottoir devant la porte
    const leave = (S, lore) => {
      ctx.teleport?.(S.x + S.ax * 1.6, S.y + 0.05, S.z + S.az * 1.6, Math.atan2(-S.ax, -S.az));
      audio.traboule?.();
      ctx.notify?.(lore);
    };
    ctx.interactables.push({ x: A.x, z: A.z, r: 2.4, label: 'E — Pousser la porte de la traboule', action: () => enter(I.a) });
    ctx.interactables.push({ x: B.x, z: B.z, r: 2.4, label: 'E — Pousser la porte de la traboule', action: () => enter(I.b) });
    let cool = 0;
    ctx.updatables.push((dt) => {
      cool -= dt;
      const p = ctx.playerPos?.();
      if (!p || cool > 0 || Math.abs(p.y - I.pocket.y) > 6) return;
      if (I.trigA(p.x, p.z)) { cool = 1; leave(A, T.loreA); } else if (I.trigB(p.x, p.z)) { cool = 1; leave(B, T.loreB); }
    });
    n++;
  }
  return n;
}
