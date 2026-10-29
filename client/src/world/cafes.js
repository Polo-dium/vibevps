import * as THREE from 'three';
import { Kit } from './monuments.js';
import { makePocket } from './traboules.js';
import { buildHuman } from './human.js';
import { makeGlowSprite, makeTextTexture } from './utils.js';

// L'INTÉRIEUR DES CAFÉS (ville OSM) : une poignée de devantures « café » /
// « bouchon » de la ville s'ouvrent (E sur le pas de porte) sur une même
// salle de bouchon lyonnais, bâtie dans une poche hors carte
// (world/traboules.js) : comptoir en zinc, étagère de bouteilles, ardoise
// du jour, tables à nappes vichy et habitués attablés, banquettes,
// suspensions chaudes. On ressort par la porte du fond… sur la rue d'où
// l'on venait. Le patron cause (E au comptoir).

const W = 12, D = 16; // salle : largeur (v), profondeur (u)

function vichy() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = '#efe9dc';
  g.fillRect(0, 0, 64, 64);
  g.fillStyle = 'rgba(190,40,50,0.8)';
  for (let i = 0; i < 4; i++) { g.fillRect(i * 16, 0, 8, 64); g.fillRect(0, i * 16, 64, 8); }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

function ardoise() {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 320;
  const g = c.getContext('2d');
  g.fillStyle = '#1f2421';
  g.fillRect(0, 0, 256, 320);
  g.strokeStyle = '#8a6a48'; g.lineWidth = 14; g.strokeRect(0, 0, 256, 320);
  g.fillStyle = '#f2efe4';
  g.font = 'bold 30px Georgia, serif';
  g.textAlign = 'center';
  g.fillText('Menu du jour', 128, 50);
  g.font = '22px Georgia, serif';
  ['Salade lyonnaise', 'Quenelle sauce Nantua', 'Tablier de sapeur', 'Andouillette 5A', 'Saint-Marcellin', 'Tarte aux pralines'].forEach((l, i) => g.fillText(l, 128, 100 + i * 34));
  g.font = 'italic 20px Georgia, serif';
  g.fillText('Pot de Côtes : 9 €', 128, 304);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const PATRON = [
  '🍷 « Assieds-toi gone, la quenelle sort du four ! »',
  '🍷 « Un pot de Côtes ? Ici on boit pas, on déguste… beaucoup. »',
  '🍷 « Le tablier de sapeur, c’est pas pour les gnolus. »',
  '🍷 « La fenotte du fond ? C’est la reine de la cervelle de canut. »',
  '🍷 « Chez nous la mâchon c’est à 9 h, et ça repart pas avant midi. »',
];

function buildSalle(ctx) {
  const pocket = makePocket(ctx, W, D);
  const M = {
    plain: new THREE.MeshLambertMaterial({ vertexColors: true }),
    stone: new THREE.MeshLambertMaterial({ vertexColors: true }),
    zinc: new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.75, roughness: 0.3 }),
    vichy: new THREE.MeshLambertMaterial({ map: vichy() }),
    glass: new THREE.MeshLambertMaterial({ vertexColors: true, emissive: 0x332010, transparent: true, opacity: 0.85 }),
  };
  const k = new Kit(ctx, pocket.ox, pocket.oz, pocket.y, 0, 1);
  const hw = W / 2, H = 3.6;
  // sol en tomettes, murs crème à boiseries, plafond à poutres
  k.box('plain', 0, D, -0.2, 0, -hw, hw, 0xa8543c);
  for (const s of [-1, 1]) {
    k.box('plain', 0, D, 0, H, s * hw, s * (hw + 0.3), 0xe9dcc0, { collide: true });
    k.box('plain', 0, D, 0, 1.1, s * (hw - 0.04), s * hw, 0x6b4428); // lambris
  }
  for (const u of [-0.3, D]) k.box('plain', u, u + 0.3, 0, H, -hw, hw, 0xe9dcc0, { collide: true });
  k.box('plain', 0, D, H, H + 0.2, -hw, hw, 0xd8ccb0);
  for (let u = 1.5; u < D; u += 2.5) k.box('plain', u - 0.15, u + 0.15, H - 0.3, H, -hw, hw, 0x4a3020);
  // porte d'entrée (u = 0) et sa vitre
  k.box('plain', 0.3, 0.36, 0, 2.5, -0.7, 0.7, 0x4a3020);
  k.box('glass', 0.28, 0.3, 1.2, 2.3, -0.5, 0.5, 0xffd9a0);
  // comptoir en zinc le long du mur gauche (v −)
  const cv = -hw + 1.4;
  k.box('plain', 4, 12, 0, 1.05, cv - 0.45, cv + 0.45, 0x5a3a22, { collide: true });
  k.box('zinc', 3.9, 12.1, 1.05, 1.12, cv - 0.55, cv + 0.55, 0xc8ccd0);
  // étagère et bouteilles derrière le comptoir
  for (const y of [1.6, 2.2, 2.8]) {
    k.box('plain', 4.5, 11.5, y - 0.04, y, -hw + 0.05, -hw + 0.4, 0x4a3020);
    for (let u = 4.8; u < 11.3; u += 0.32) {
      const hue = (Math.sin(u * 7.1 + y * 3) + 1) / 2;
      const c = hue < 0.4 ? 0x2f5a2a : hue < 0.7 ? 0x6b1f22 : 0xb88a3a;
      k.add('glass', new THREE.CylinderGeometry(0.06, 0.07, 0.36, 6), { u, y: y + 0.18, v: -hw + 0.22, color: c });
    }
  }
  // tables à nappe vichy + chaises, banquette le long du mur droit
  const tables = [];
  for (let r = 0; r < 3; r++) {
    for (const v of [1.2, hw - 1.6]) {
      const u = 4 + r * 4;
      tables.push([u, v]);
      k.add('vichy', new THREE.BoxGeometry(1.3, 0.04, 1.0), { u, y: 0.78, v, keepUV: true });
      k.box('plain', u - 0.05, u + 0.05, 0, 0.76, v - 0.05, v + 0.05, 0x2b2b2b);
      k.add('glass', new THREE.CylinderGeometry(0.05, 0.05, 0.22, 6), { u: u + 0.2, y: 0.91, v, color: 0x6b1f22 });
      k.solid(u - 0.65, u + 0.65, 0, 0.8, v - 0.5, v + 0.5);
    }
  }
  k.box('plain', 1.5, 14.5, 0, 0.5, hw - 0.7, hw - 0.05, 0x7a2e2a); // banquette
  k.box('plain', 1.5, 14.5, 0.5, 1.2, hw - 0.2, hw - 0.05, 0x7a2e2a);
  // porte du fond (sortie)
  k.box('plain', D - 0.06, D, 0, 2.4, -0.7, 0.7, 0x3a2416);
  k.build(M, 'cafe-salle');
  // ardoise du jour au-dessus du comptoir
  const board = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 1.5), new THREE.MeshLambertMaterial({ map: ardoise() }));
  const [bx, bz] = k.world(13.5, -hw + 0.06);
  board.position.set(bx, pocket.y + 2.1, bz);
  board.rotation.y = -Math.PI / 2; // (v − = côté +x du monde) : face à la salle
  ctx.scene.add(board);
  // enseigne néon (identité arcade !)
  const neon = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 0.7),
    new THREE.MeshBasicMaterial({ map: makeTextTexture('CAFÉ DES GONES', { color: '#ff4fd8' }), transparent: true }));
  const [nx, nz] = k.world(D - 0.08, 0);
  neon.position.set(nx, pocket.y + 3, nz);
  neon.rotation.y = Math.PI;
  ctx.scene.add(neon);
  // suspensions : halos chauds
  for (let u = 3; u < D; u += 4) {
    for (const v of [-1.5, 2.5]) {
      const [x, z] = k.world(u, v);
      const g = makeGlowSprite(0xffc070, 3.5, 0.8);
      g.position.set(x, pocket.y + 2.9, z);
      ctx.scene.add(g);
    }
  }
  // habitués attablés + patron derrière le comptoir
  const SH = [0x2f6fb5, 0xc8423a, 0x6a9a4c, 0xe8e3d8, 0x7b4a8e, 0xd9a441];
  tables.forEach(([u, v], i) => {
    if (i % 3 === 2) return;
    for (const side of [-1, 1]) {
      if ((i + side) % 2) continue;
      const h = buildHuman({ shirt: SH[(i * 2 + side + 6) % SH.length], seated: true });
      const [x, z] = k.world(u + side * 0.85, v);
      h.group.position.set(x, pocket.y + 0.02, z);
      h.group.rotation.y = side > 0 ? 0 : Math.PI; // face à la table (repos : regard vers −z)
      h.legL.rotation.x = h.legR.rotation.x = 1.35;
      h.kneeL.rotation.x = h.kneeR.rotation.x = -1.35;
      h.armL.rotation.x = h.armR.rotation.x = 0.6;
      h.foreL.rotation.x = h.foreR.rotation.x = 0.9;
      ctx.scene.add(h.group);
    }
  });
  const patron = buildHuman({ shirt: 0xf2efe8, pants: 0x1c1c22 });
  const [px, pz] = k.world(8, -hw + 0.8);
  patron.group.position.set(px, pocket.y, pz);
  patron.group.rotation.y = Math.PI / 2; // face au comptoir et à la salle
  ctx.scene.add(patron.group);
  const [ix, iz] = k.world(8, cv + 1.2);
  ctx.interactables.push({
    x: ix, z: iz, r: 2.4, label: 'E — Causer avec le patron',
    action: () => {
      const pick = () => PATRON[Math.floor(Date.now() / 15000) % PATRON.length];
      if (ctx.talkTo?.('patronne', {
        title: 'La Mère Fanchon, patronne du Café des Gones', emoji: '☕',
        greet: 'Entre, ma poule ! Un petit pot, des gratons ?', fallback: pick,
      })) return;
      ctx.notify?.(pick());
    },
  });
  return {
    pocket,
    inside: { x: pocket.ox, z: pocket.oz + 1.6, ry: Math.PI },
    exitAt: (x, z) => Math.abs(x - pocket.ox) < 1 && z > pocket.oz + D - 0.9,
    entryAt: (x, z) => Math.abs(x - pocket.ox) < 1 && z < pocket.oz + 0.7,
  };
}

// spots : ctx.terraceSpots (devantures café/bouchon : x, z, nx, nz vers la rue)
export function buildCafes(ctx, spots) {
  if (!spots?.length) return 0;
  // une poignée de portes, réparties (les plus proches des grands lieux)
  const anchors = [[0, 0], [125, -545], [-175, -270], [60, -400], [40, -800]];
  const doors = [];
  for (const [ax, az] of anchors) {
    let best = null;
    for (const s of spots) {
      const d = Math.hypot(s.x - ax, s.z - az);
      if (d < 160 && (!best || d < best.d) && doors.every((o) => Math.hypot(o.x - s.x, o.z - s.z) > 40)) best = { ...s, d };
    }
    if (best) doors.push(best);
  }
  if (!doors.length) return 0;
  const salle = buildSalle(ctx);
  let from = doors[0];
  const enter = (door) => {
    from = door;
    ctx.teleport?.(salle.inside.x, salle.pocket.y + 0.05, salle.inside.z, salle.inside.ry);
    ctx.notify?.('☕ Café des Gones : ça sent la quenelle et le Côtes-du-Rhône.');
  };
  for (const d of doors) {
    ctx.interactables.push({ x: d.x + d.nx * 0.8, z: d.z + d.nz * 0.8, r: 2, label: 'E — Entrer au café', action: () => enter(d) });
    ctx.pois?.push({ id: 'cafe-' + doors.indexOf(d), nom: 'Café des Gones (on peut entrer)', emoji: '☕', x: d.x, z: d.z });
  }
  let cool = 0;
  ctx.updatables.push((dt) => {
    cool -= dt;
    const p = ctx.playerPos?.();
    if (!p || cool > 0 || Math.abs(p.y - salle.pocket.y) > 6) return;
    if (salle.exitAt(p.x, p.z) || salle.entryAt(p.x, p.z)) {
      cool = 1;
      const x = from.x + from.nx * 2.2, z = from.z + from.nz * 2.2;
      ctx.teleport?.(x, Math.max(0, ctx.terrainHeight(x, z)) + 0.05, z, Math.atan2(-from.nx, -from.nz) + Math.PI);
      ctx.notify?.('☕ À la revoyure, gone !');
    }
  });
  return doors.length;
}
