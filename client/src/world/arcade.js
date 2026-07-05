import * as THREE from 'three';
import { addBox } from './utils.js';
import { makeTextTexture } from './utils.js';
import { ARCADE } from './layout.js';
import { buildJetpackPad } from './city.js';

const BODY_MAT = new THREE.MeshLambertMaterial({ color: 0x171e30 });
const PANEL_MAT = new THREE.MeshLambertMaterial({ color: 0x2a3550 });
const NEONS = [0x00ffd5, 0xff3df0, 0xffe14d, 0x4dff6a, 0xff7a4d, 0x4da6ff, 0xc44dff];

export function buildArcade(ctx, { onPlayGame, onOpenCreator }) {
  const { x: cx, z: cz, w, d, h, doorWidth, doorHeight } = ARCADE;
  const t = 0.6;
  const south = cz + d / 2, north = cz - d / 2;
  const west = cx - w / 2, east = cx + w / 2;

  const wallColor = 0x8a6f5a;
  // Murs (extérieur ET intérieur taguables)
  addBox(ctx, { x: cx, z: north + t / 2, w, h, d: t, color: wallColor, taggable: true });
  addBox(ctx, { x: west + t / 2, z: cz, w: t, h, d, color: wallColor, taggable: true });
  addBox(ctx, { x: east - t / 2, z: cz, w: t, h, d, color: wallColor, taggable: true });
  // Façade sud avec porte
  const sideW = (w - doorWidth) / 2;
  addBox(ctx, { x: west + sideW / 2, z: south - t / 2, w: sideW, h, d: t, color: wallColor, taggable: true });
  addBox(ctx, { x: east - sideW / 2, z: south - t / 2, w: sideW, h, d: t, color: wallColor, taggable: true });
  addBox(ctx, { x: cx, y: doorHeight, z: south - t / 2, w: doorWidth, h: h - doorHeight, d: t, color: wallColor, taggable: true });
  // Toit
  addBox(ctx, { x: cx, y: h, z: cz, w: w + 1, h: 0.5, d: d + 1, color: 0x3a2f28 });

  // Sol intérieur
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(w - t * 2, d - t * 2),
    new THREE.MeshLambertMaterial({ color: 0x10131f })
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(cx, 0.03, cz);
  ctx.scene.add(floor);

  // Enseigne au-dessus de la porte
  const sign = new THREE.Mesh(
    new THREE.PlaneGeometry(12, 2.2),
    new THREE.MeshBasicMaterial({ map: makeTextTexture('LYON ARCADE', { color: '#ff3df0' }), transparent: true })
  );
  sign.position.set(cx, doorHeight + 2.6, south + 0.05);
  ctx.scene.add(sign);

  // Ambiance intérieure : lumières néon
  for (const [lx, lz, color] of [
    [cx - 9, cz, 0x00ffd5],
    [cx + 9, cz, 0xff3df0],
    [cx, cz - 4, 0x4da6ff],
  ]) {
    const light = new THREE.PointLight(color, 30, 26, 1.8);
    light.position.set(lx, h - 2, lz);
    ctx.scene.add(light);
  }
  // Bandes lumineuses au plafond
  for (const lz of [cz - 5, cz, cz + 5]) {
    const strip = new THREE.Mesh(
      new THREE.PlaneGeometry(w - 4, 0.5),
      new THREE.MeshBasicMaterial({ color: 0x9ef7ff })
    );
    strip.rotation.x = Math.PI / 2;
    strip.position.set(cx, h - 0.6, lz);
    ctx.scene.add(strip);
  }

  // Emplacements de bornes : mur nord, murs latéraux, îlot central
  const slots = [];
  for (let i = 0; i < 10; i++) {
    slots.push({ x: west + 2 + i * 2.85, z: north + 1.4, ry: 0 });
  }
  for (let i = 0; i < 5; i++) {
    slots.push({ x: west + 1.3, z: north + 4.5 + i * 2.7, ry: Math.PI / 2 });
    slots.push({ x: east - 1.3, z: north + 4.5 + i * 2.7, ry: -Math.PI / 2 });
  }
  for (let i = 0; i < 8; i++) {
    slots.push({ x: west + 5 + i * 2.85, z: cz + 0.8, ry: Math.PI });
    slots.push({ x: west + 5 + i * 2.85, z: cz + 2.6, ry: 0 });
  }

  // Borne « créateur » (IA) près de l'entrée
  buildMachine(ctx, {
    x: east - 1.5, z: south - 3.2, ry: -Math.PI / 2,
    title: 'CRÉER',
    accent: 0xffe14d,
    label: 'E — Créer une nouvelle borne (IA)',
    action: onOpenCreator,
    creator: true,
  });

  // Jetpack posé dans la salle, près de l'entrée : on s'équipe et on décolle
  // direct par la porte (plus besoin d'aller jusqu'à la Confluence)
  buildJetpackPad(ctx, cx, south - 4.5);

  const placed = new Map(); // gameId -> true
  let nextSlot = 0;

  function syncMachines(games) {
    for (const game of games) {
      // Le stand de tir, le PvP et la guerre de tags ont un leaderboard
      // mais pas de borne physique dans la salle
      if (game.id === 'shooting-range' || game.id === 'pvp' || game.id === 'graff' ||
          placed.has(game.id)) continue;
      if (nextSlot >= slots.length) return;
      const slot = slots[nextSlot++];
      placed.set(game.id, true);
      buildMachine(ctx, {
        x: slot.x, z: slot.z, ry: slot.ry,
        title: game.title,
        accent: NEONS[(nextSlot - 1) % NEONS.length],
        label: `E — Jouer à ${game.title}` + (game.creator ? ` (par ${game.creator})` : ''),
        action: () => onPlayGame(game),
      });
    }
  }

  return { syncMachines };
}

function buildMachine(ctx, { x, z, ry, title, accent, label, action, creator = false }) {
  const group = new THREE.Group();

  const body = new THREE.Mesh(new THREE.BoxGeometry(1.1, 1.9, 0.9), creator ? PANEL_MAT : BODY_MAT);
  body.position.y = 0.95;
  group.add(body);

  // Côtés colorés
  const sideMat = new THREE.MeshLambertMaterial({ color: accent, emissive: accent, emissiveIntensity: 0.25 });
  for (const sx of [-0.56, 0.56]) {
    const side = new THREE.Mesh(new THREE.BoxGeometry(0.02, 1.9, 0.9), sideMat);
    side.position.set(sx, 0.95, 0);
    group.add(side);
  }

  // Écran
  const screen = new THREE.Mesh(
    new THREE.PlaneGeometry(0.82, 0.62),
    new THREE.MeshBasicMaterial({
      map: makeTextTexture(title, {
        color: '#' + new THREE.Color(accent).getHexString(),
        width: 256, height: 192,
        font: 'bold ' + (title.length > 8 ? 30 : 42) + 'px "Courier New", monospace',
      }),
    })
  );
  screen.position.set(0, 1.32, 0.452);
  screen.rotation.x = -0.1;
  group.add(screen);

  // Marquee lumineux
  const marquee = new THREE.Mesh(
    new THREE.BoxGeometry(1.14, 0.3, 0.92),
    new THREE.MeshLambertMaterial({ color: accent, emissive: accent, emissiveIntensity: 0.55 })
  );
  marquee.position.y = 2.05;
  group.add(marquee);

  // Panneau de commandes
  const panel = new THREE.Mesh(new THREE.BoxGeometry(1.08, 0.12, 0.42), PANEL_MAT);
  panel.position.set(0, 1.02, 0.55);
  panel.rotation.x = 0.25;
  group.add(panel);

  group.position.set(x, 0, z);
  group.rotation.y = ry;
  ctx.scene.add(group);

  ctx.colliders.push({
    minX: x - 0.65, maxX: x + 0.65,
    minY: 0, maxY: 2.2,
    minZ: z - 0.65, maxZ: z + 0.65,
  });
  ctx.interactables.push({ x, z, r: 2.3, label, action });
}
