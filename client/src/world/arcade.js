import * as THREE from 'three';
import { addBox } from './utils.js';
import { makeTextTexture, makeGlowSprite } from './utils.js';
import { ARCADE } from './layout.js';
import { buildJetpackPad } from './city.js';

const BODY_MAT = new THREE.MeshLambertMaterial({ color: 0x171e30 });
const PANEL_MAT = new THREE.MeshLambertMaterial({ color: 0x2a3550 });
const NEONS = [0x00ffd5, 0xff3df0, 0xffe14d, 0x4dff6a, 0xff7a4d, 0x4da6ff, 0xc44dff];

export function buildArcade(realCtx, { onPlayGame, onOpenCreator }) {
  const { x: acx, z: acz, w, d, h, doorWidth, doorHeight } = ARCADE;
  // Pavillon construit dans un repère LOCAL (centre à l'origine, porte vers
  // +z local), puis pivoté d'un seul bloc : sur le vrai Lyon, la porte
  // regarde la statue du Roi (est de la place) et le bâtiment suit l'axe de
  // Bellecour (belleRot). Sans OSM, orientation historique inchangée.
  const yaw = realCtx.belleRot ? realCtx.belleRot.yaw + Math.PI / 2 : 0;
  const yCos = Math.cos(yaw), ySin = Math.sin(yaw);
  const toWorld = (x, z) => [acx + x * yCos + z * ySin, acz - x * ySin + z * yCos];
  const shell = new THREE.Group();
  shell.position.set(acx, 0, acz);
  shell.rotation.y = yaw;
  realCtx.scene.add(shell);
  const ctx = {
    ...realCtx,
    scene: shell,
    colliders: {
      push(b) {
        // Tronçonne en morceaux ≤ 3,5 m avant de ré-englober en AABB monde :
        // l'approximation par excès des coins tournés ne bouche pas la porte.
        const sx = b.maxX - b.minX, sz = b.maxZ - b.minZ;
        const nx = Math.max(1, Math.ceil(sx / 3.5)), nz = Math.max(1, Math.ceil(sz / 3.5));
        for (let i = 0; i < nx; i++) {
          for (let j = 0; j < nz; j++) {
            const p = {
              minX: b.minX + (sx * i) / nx, maxX: b.minX + (sx * (i + 1)) / nx,
              minZ: b.minZ + (sz * j) / nz, maxZ: b.minZ + (sz * (j + 1)) / nz,
            };
            const pts = [[p.minX, p.minZ], [p.maxX, p.minZ], [p.minX, p.maxZ], [p.maxX, p.maxZ]]
              .map(([x, z]) => toWorld(x, z));
            realCtx.colliders.push({
              minX: Math.min(...pts.map((q) => q[0])), maxX: Math.max(...pts.map((q) => q[0])),
              minZ: Math.min(...pts.map((q) => q[1])), maxZ: Math.max(...pts.map((q) => q[1])),
              minY: b.minY, maxY: b.maxY,
            });
          }
        }
      },
    },
    interactables: {
      push(it) {
        const [x, z] = toWorld(it.x, it.z);
        realCtx.interactables.push({ ...it, x, z });
      },
    },
    pois: realCtx.pois && {
      push(p) {
        const [x, z] = toWorld(p.x, p.z);
        realCtx.pois.push({ ...p, x, z });
      },
    },
  };
  const cx = 0, cz = 0;
  ctx.pois?.push({ id: 'arcade', nom: "Salle d'arcade", emoji: '🕹️', x: cx, z: cz });
  const t = 0.6;
  const south = cz + d / 2, north = cz - d / 2;
  const west = cx - w / 2, east = cx + w / 2;

  // Occlusion : les murs/toit/enseigne restent toujours visibles (silhouette
  // de la ville), mais le contenu intérieur (bornes, sol, néons de plafond)
  // ne se dessine que si on est près de la porte — inutile de payer son
  // rendu quand on n'y voit rien depuis l'extérieur. Colliders/interactables
  // restent branchés sur ctx (donc réels) que l'intérieur soit visible ou
  // non : seul le rendu bascule, jamais la physique.
  const interior = new THREE.Group();
  shell.add(interior);
  const ictx = { ...ctx, scene: interior };
  const doorWorld = toWorld(0, south);
  let interiorVisible = true;
  let occlusionTimer = 0;
  ctx.updatables.push((dt) => {
    occlusionTimer -= dt;
    if (occlusionTimer > 0) return;
    occlusionTimer = 0.3;
    const p = realCtx.playerPos?.();
    if (!p) return;
    const dist = Math.hypot(p.x - doorWorld[0], p.z - doorWorld[1]);
    if (interiorVisible && dist > 55) { interiorVisible = false; interior.visible = false; }
    else if (!interiorVisible && dist < 40) { interiorVisible = true; interior.visible = true; }
  });

  // PAVILLON LYONNAIS : pierre de taille, soubassement, grandes baies
  // cintrées (vitrées, elles s'allument néon la nuit), corniche ; toit en
  // croupe de zinc cerné d'un liseré néon. Les murs restent des boîtes
  // taguables à collision (mêmes dimensions qu'avant).
  const facade = makePavilionFacade();
  const lit = [];
  const wallMat = (len) => {
    const m = new THREE.MeshLambertMaterial({
      map: facade.map.clone(), emissiveMap: facade.emissive.clone(),
      emissive: new THREE.Color(1, 1, 1), emissiveIntensity: 0,
    });
    for (const tx of [m.map, m.emissiveMap]) {
      tx.wrapS = THREE.RepeatWrapping;
      tx.repeat.set(Math.max(1, Math.round(len / 4.2)), 1);
      tx.needsUpdate = true;
    }
    lit.push(m);
    return m;
  };
  const plainStone = new THREE.MeshLambertMaterial({ color: 0xc9b896 });
  addBox(ctx, { x: cx, z: north + t / 2, w, h, d: t, material: wallMat(w), taggable: true });
  addBox(ctx, { x: west + t / 2, z: cz, w: t, h, d, material: wallMat(d), taggable: true });
  addBox(ctx, { x: east - t / 2, z: cz, w: t, h, d, material: wallMat(d), taggable: true });
  // Façade sud avec porte
  const sideW = (w - doorWidth) / 2;
  addBox(ctx, { x: west + sideW / 2, z: south - t / 2, w: sideW, h, d: t, material: wallMat(sideW), taggable: true });
  addBox(ctx, { x: east - sideW / 2, z: south - t / 2, w: sideW, h, d: t, material: wallMat(sideW), taggable: true });
  addBox(ctx, { x: cx, y: doorHeight, z: south - t / 2, w: doorWidth, h: h - doorHeight, d: t, material: plainStone, taggable: true });
  // Toit plat (collision, corniche) + croupe de zinc par-dessus
  addBox(ctx, { x: cx, y: h, z: cz, w: w + 1, h: 0.5, d: d + 1, color: 0xd8ccb0 });
  const roof = new THREE.Mesh(
    new THREE.ConeGeometry(Math.SQRT1_2, 1, 4, 1).rotateY(Math.PI / 4),
    new THREE.MeshStandardMaterial({ color: 0x6f7a86, roughness: 0.45, metalness: 0.6 })
  );
  roof.scale.set(w + 0.6, 3.2, d + 0.6);
  roof.position.set(cx, h + 0.5 + 1.6, cz);
  roof.castShadow = true;
  ctx.scene.add(roof);
  // Liseré néon au bord du toit (rose côté porte, cyan ailleurs)
  const neonPink = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 0.4, 1.9) });
  const neonCyan = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.3, 1.9, 1.8) });
  for (const [x0, z0, len, rot, mat] of [
    [cx, south + 0.52, w + 1.05, 0, neonPink], [cx, north - 0.52, w + 1.05, 0, neonCyan],
    [west - 0.52, cz, d + 1.05, Math.PI / 2, neonCyan], [east + 0.52, cz, d + 1.05, Math.PI / 2, neonCyan],
  ]) {
    const bar = new THREE.Mesh(new THREE.BoxGeometry(len, 0.09, 0.09), mat);
    bar.position.set(x0, h + 0.5, z0);
    bar.rotation.y = rot;
    ctx.scene.add(bar);
  }
  // Baies : éteintes le jour, néon la nuit
  ctx.updatables.push(() => {
    const n = realCtx.env?.night ?? 0;
    for (const m of lit) m.emissiveIntensity = 0.15 + 1.1 * n;
  });

  // Sol intérieur
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(w - t * 2, d - t * 2),
    new THREE.MeshLambertMaterial({ color: 0x10131f })
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(cx, 0.03, cz);
  ictx.scene.add(floor);

  // Enseigne au-dessus de la porte
  const sign = new THREE.Mesh(
    new THREE.PlaneGeometry(12, 2.2),
    new THREE.MeshBasicMaterial({ map: makeTextTexture('LYON ARCADE', { color: '#ff3df0' }), transparent: true })
  );
  sign.position.set(cx, doorHeight + 2.6, south + 0.05);
  ctx.scene.add(sign);

  // Panneaux d'expression de chaque côté de l'entrée : les joueurs écrivent
  // dessus À LA BOMBE (surfaces taguables, partagées comme tous les tags).
  // À gauche les bugs, à droite les idées / demandes d'implémentation.
  for (const [side, title, accent] of [
    [-1, '🐛 BUGS ICI', '#ff6b5e'],
    [1, '💡 IDÉES ICI', '#ffe14d'],
  ]) {
    const px = cx + side * (doorWidth / 2 + 4.6);
    addBox(ctx, {
      x: px, y: 0.8, z: south + 0.12, w: 6.4, h: 3.4, d: 0.22,
      color: 0x232a36, taggable: true, collider: false,
    });
    // Cadre clair + titre au-dessus
    addBox(ctx, {
      x: px, y: 0.62, z: south + 0.09, w: 6.8, h: 3.8, d: 0.12,
      color: 0x8d96a2, collider: false,
    });
    const label = new THREE.Mesh(
      new THREE.PlaneGeometry(6.6, 1.1),
      new THREE.MeshBasicMaterial({ map: makeTextTexture(title, { color: accent }), transparent: true })
    );
    label.position.set(px, 4.9, south + 0.16);
    ctx.scene.add(label);
    ctx.interactables.push({
      x: px, z: south + 2, r: 3.5,
      label: side < 0 ? 'Panneau des BUGS — écris à la bombe (F)' : 'Panneau des IDÉES — écris à la bombe (F)',
      action: () => ctx.notify?.(side < 0
        ? '🐛 Un bug ? Tague-le sur le panneau (F pour la bombe, T pour écrire un texte) !'
        : '💡 Une idée pour le jeu ? Tague-la sur le panneau (F pour la bombe, T pour écrire un texte) !'),
    });
  }

  // Ambiance intérieure : halos néon (sprites additifs — de vraies
  // PointLights éclairaient chaque pixel de la ville entière)
  for (const [lx, lz, color] of [
    [cx - 9, cz, 0x00ffd5],
    [cx + 9, cz, 0xff3df0],
    [cx, cz - 4, 0x4da6ff],
  ]) {
    const glow = makeGlowSprite(color, 10, 0.5);
    glow.position.set(lx, h - 2, lz);
    ictx.scene.add(glow);
  }
  // Bandes lumineuses au plafond
  for (const lz of [cz - 5, cz, cz + 5]) {
    const strip = new THREE.Mesh(
      new THREE.PlaneGeometry(w - 4, 0.5),
      new THREE.MeshBasicMaterial({ color: 0x9ef7ff })
    );
    strip.rotation.x = Math.PI / 2;
    strip.position.set(cx, h - 0.6, lz);
    ictx.scene.add(strip);
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
  buildMachine(ictx, {
    x: east - 1.5, z: south - 3.2, ry: -Math.PI / 2,
    title: 'CRÉER',
    accent: 0xffe14d,
    label: 'E — Créer une nouvelle borne (IA)',
    action: onOpenCreator,
    creator: true,
  });

  // Jetpack posé dans la salle, près de l'entrée : on s'équipe et on décolle
  // direct par la porte (plus besoin d'aller jusqu'à la Confluence)
  buildJetpackPad(ictx, cx, south - 4.5);

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
      buildMachine(ictx, {
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

// Façade de pavillon (un module de ~4,2 m × 9 m) : pierre de taille,
// soubassement, baie cintrée vitrée, clé de voûte, corniche. Carte émissive
// assortie : seule la baie s'allume (dégradé rose → cyan, comme des néons
// d'arcade vus à travers la vitre).
function makePavilionFacade() {
  const W = 128, H = 256;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  const e = document.createElement('canvas');
  e.width = W; e.height = H;
  const ge = e.getContext('2d');
  ge.fillStyle = '#000'; ge.fillRect(0, 0, W, H);
  const yOf = (m) => H - (m / 9) * H; // mètres → pixels (0 en bas)
  g.fillStyle = '#cbbb98'; g.fillRect(0, 0, W, H);
  // Assises de pierre
  g.strokeStyle = 'rgba(90,75,55,0.35)'; g.lineWidth = 1;
  for (let m = 0.8; m < 8.3; m += 0.55) { g.beginPath(); g.moveTo(0, yOf(m)); g.lineTo(W, yOf(m)); g.stroke(); }
  // Soubassement plus sombre
  g.fillStyle = '#9d8f74'; g.fillRect(0, yOf(0.8), W, H - yOf(0.8));
  // Pilastres de chaque côté
  g.fillStyle = 'rgba(255,248,230,0.25)';
  g.fillRect(0, yOf(8.3), 10, yOf(0.8) - yOf(8.3));
  g.fillRect(W - 10, yOf(8.3), 10, yOf(0.8) - yOf(8.3));
  // Baie cintrée : encadrement, vitrage, petits bois
  const bx0 = 22, bx1 = W - 22, by0 = yOf(1.2), byT = yOf(5.6), r = (bx1 - bx0) / 2;
  const arch = (ctx2) => {
    ctx2.beginPath();
    ctx2.moveTo(bx0, by0); ctx2.lineTo(bx0, byT);
    ctx2.arc((bx0 + bx1) / 2, byT, r, Math.PI, 0);
    ctx2.lineTo(bx1, by0); ctx2.closePath();
  };
  g.fillStyle = '#e8dcc0'; g.save(); g.translate(0, 0); arch(g); g.lineWidth = 10; g.strokeStyle = '#e8dcc0'; g.stroke(); g.restore();
  const glass = g.createLinearGradient(0, byT - r, 0, by0);
  glass.addColorStop(0, '#2c3550'); glass.addColorStop(1, '#151a29');
  g.fillStyle = glass; arch(g); g.fill();
  g.strokeStyle = 'rgba(30,26,22,0.9)'; g.lineWidth = 3;
  g.beginPath(); g.moveTo((bx0 + bx1) / 2, byT - r); g.lineTo((bx0 + bx1) / 2, by0);
  for (let m = 2.4; m < 5.6; m += 1.1) { g.moveTo(bx0, yOf(m)); g.lineTo(bx1, yOf(m)); }
  g.stroke();
  // Clé de voûte + corniche
  g.fillStyle = '#efe4c8'; g.fillRect((bx0 + bx1) / 2 - 6, byT - r - 10, 12, 14);
  g.fillStyle = '#e2d6b8'; g.fillRect(0, 0, W, yOf(8.3));
  g.fillStyle = 'rgba(80,65,45,0.4)'; g.fillRect(0, yOf(8.3), W, 3);
  // Émissif : la baie seule, néon rose en haut → cyan en bas
  const neon = ge.createLinearGradient(0, byT - r, 0, by0);
  neon.addColorStop(0, '#d0359c'); neon.addColorStop(1, '#1fa3b8');
  ge.fillStyle = neon; arch(ge); ge.fill();
  ge.strokeStyle = '#000'; ge.lineWidth = 3;
  ge.beginPath(); ge.moveTo((bx0 + bx1) / 2, byT - r); ge.lineTo((bx0 + bx1) / 2, by0);
  for (let m = 2.4; m < 5.6; m += 1.1) { ge.moveTo(bx0, yOf(m)); ge.lineTo(bx1, yOf(m)); }
  ge.stroke();
  const map = new THREE.CanvasTexture(c);
  map.colorSpace = THREE.SRGBColorSpace;
  const emissive = new THREE.CanvasTexture(e);
  emissive.colorSpace = THREE.SRGBColorSpace;
  return { map, emissive };
}
