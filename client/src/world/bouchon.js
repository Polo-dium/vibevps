import * as THREE from 'three';
import { makeTextTexture } from './utils.js';
import { buildHuman } from './human.js';

// Le Bouchon des Gones 🍷 : une guinguette de quai au pied du Vieux Lyon —
// nappes vichy, PNJ à l'apéro, lanternes chaudes, et un patron qui cause
// le vrai parler lyonnais. Ouvert sur la Saône, comme une terrasse.
const PATRON_LINES = [
  'Bienvenue au Bouchon des Gones ! Assieds-toi, la quenelle sort du four.',
  'Goûte-moi ce Côtes-du-Rhône : il rend fort comme le silure du Rhône.',
  'Le tablier de sapeur, c’est pas pour les gnolus — mais toi t’as une bonne tête.',
  'Ici on mange bien, on boit mieux, et on cancane sur toute la Croix-Rousse.',
  'Un p’tit pot de beaujolais pour la fenotte ? C’est ma tournée, enfin presque.',
  'Reviens pour la Fête des Lumières : je sors le vin chaud et les bugnes !',
];

function makeVichyTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = '#e8e4da';
  g.fillRect(0, 0, 64, 64);
  g.fillStyle = 'rgba(190,40,50,0.85)';
  for (let i = 0; i < 8; i++) {
    g.fillRect(i * 16, 0, 8, 64);
    g.fillRect(0, i * 16, 64, 8);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function buildBouchon(ctx, { notify, speak } = {}) {
  // Emplacement : sur le quai rive droite de la Saône (Vieux Lyon), la
  // façade ouverte tournée vers l'eau. Repli à côté de Bellecour sinon.
  const bands = ctx.waterBands ?? [];
  const saone = bands.length ? bands[0] : null;
  let bx, bz, faceEast;
  if (saone) {
    bz = -55;
    const bank = (saone.cx ? saone.cx(bz) : 0) - (saone.w ?? 50) / 2;
    bx = bank - 4.5; // au bord de la promenade, côté terre
    faceEast = true; // le fleuve est à l'est (+x)
  } else {
    bx = -42; bz = 38; faceEast = true;
  }
  const by = Math.max(0, ctx.terrainHeight?.(bx, bz) ?? 0);
  const yaw = faceEast ? -Math.PI / 2 : 0; // ouverture vers +x

  const group = new THREE.Group();
  group.position.set(bx, by, bz);
  group.rotation.y = yaw;
  ctx.scene.add(group);
  const add = (geo, mat, x, y, z, ry = 0) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.rotation.y = ry;
    group.add(m);
    return m;
  };

  const woodMat = new THREE.MeshLambertMaterial({ color: 0x7a5230 });
  const darkWood = new THREE.MeshLambertMaterial({ color: 0x54371e });
  const plaster = new THREE.MeshLambertMaterial({ color: 0xe3c892 });

  // Coque : 3 murs + toit en appentis, façade avant (-z local) OUVERTE
  const W = 9, D = 6.5, H = 3.4;
  add(new THREE.BoxGeometry(W, H, 0.24), plaster, 0, H / 2, D / 2); // fond
  add(new THREE.BoxGeometry(0.24, H, D), plaster, -W / 2, H / 2, 0); // flancs
  add(new THREE.BoxGeometry(0.24, H, D), plaster, W / 2, H / 2, 0);
  const roof = add(new THREE.BoxGeometry(W + 1.2, 0.18, D + 1.6), darkWood, 0, H + 0.16, -0.2);
  roof.rotation.x = 0.07;
  // Plancher de bois
  add(new THREE.BoxGeometry(W, 0.1, D), woodMat, 0, 0.05, 0);
  // Enseigne côté ouverture
  const sign = add(
    new THREE.PlaneGeometry(6.4, 1.05),
    new THREE.MeshBasicMaterial({
      map: makeTextTexture('LE BOUCHON DES GONES', { color: '#ffd77a' }),
      transparent: true,
    }),
    0, H - 0.35, -D / 2 - 0.35
  );
  sign.rotation.y = Math.PI; // face à l'ouverture (le fleuve), pas au mur
  sign.userData.noShadow = true;

  // Lanternes chaudes sous l'avancée (émissif, pas de vraie lumière)
  const lampMat = new THREE.MeshLambertMaterial({ color: 0xffd9a0, emissive: 0xcc8a30 });
  for (const dx of [-3, 0, 3]) {
    add(new THREE.SphereGeometry(0.14, 8, 6), lampMat, dx, H - 0.55, -D / 2 + 0.3);
  }

  // Comptoir au fond + patron derrière
  add(new THREE.BoxGeometry(3.6, 1.05, 0.8), darkWood, 1.6, 0.53, D / 2 - 1.2);
  const patron = buildHuman({ shirt: 0xf0ead8, pants: 0x39404e, hair: 0x6e6e6e }).group;
  patron.position.set(1.6, 0, D / 2 - 2.1);
  patron.rotation.y = Math.PI;
  group.add(patron);

  // Tables vichy + convives debout (l'apéro lyonnais se prend debout)
  const vichy = new THREE.MeshLambertMaterial({ map: makeVichyTexture() });
  const legMat = new THREE.MeshLambertMaterial({ color: 0x2f2f34 });
  const rand = (() => { let s = 69001; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; })();
  for (const [txl, tzl] of [[-2.6, 0.6], [-0.2, -1.2], [2.4, 0.2]]) {
    add(new THREE.CylinderGeometry(0.62, 0.62, 0.06, 10), vichy, txl, 0.95, tzl);
    add(new THREE.CylinderGeometry(0.05, 0.07, 0.92, 6), legMat, txl, 0.48, tzl);
    // un ou deux convives par table
    const n = 1 + Math.round(rand());
    for (let i = 0; i < n; i++) {
      const a = rand() * Math.PI * 2;
      const guest = buildHuman({
        shirt: [0xa04848, 0x4a6f8a, 0x777a52, 0x8a5f88][Math.floor(rand() * 4)],
      }).group;
      guest.position.set(txl + Math.cos(a) * 1.05, 0, tzl + Math.sin(a) * 1.05);
      guest.rotation.y = -a + Math.PI / 2; // tourné vers la table
      group.add(guest);
    }
  }

  // Colliders (murs + comptoir), en coordonnées MONDE après rotation
  const toWorld = (x, z) => {
    const c = Math.cos(yaw), s = Math.sin(yaw);
    return [bx + x * c + z * s, bz - x * s + z * c];
  };
  const addBox = (x, z, hw, hd, h = H) => {
    const [wx, wz] = toWorld(x, z);
    const ex = Math.abs(hw * Math.cos(yaw)) + Math.abs(hd * Math.sin(yaw));
    const ez = Math.abs(hw * Math.sin(yaw)) + Math.abs(hd * Math.cos(yaw));
    ctx.colliders.push({
      minX: wx - ex, maxX: wx + ex, minY: by, maxY: by + h,
      minZ: wz - ez, maxZ: wz + ez,
    });
  };
  addBox(0, D / 2, W / 2, 0.15); // fond
  addBox(-W / 2, 0, 0.15, D / 2); // flancs
  addBox(W / 2, 0, 0.15, D / 2);
  addBox(1.6, D / 2 - 1.2, 1.8, 0.4, 1.1); // comptoir

  // Le patron cause (toast + synthèse vocale, une réplique à la fois)
  let line = 0;
  const [gx, gz] = toWorld(0, -1);
  ctx.interactables.push({
    x: gx, z: gz, r: 4.5,
    label: 'E — Causer avec le patron du bouchon',
    action: () => {
      const text = PATRON_LINES[line % PATRON_LINES.length];
      line++;
      notify?.(`🍷 « ${text} »`);
      speak?.(text, { pitch: 0.6, rate: 0.95, volume: 1 });
    },
  });
  ctx.pois?.push({ id: 'bouchon', nom: 'Le Bouchon des Gones', emoji: '🍷', x: bx, z: bz });
}
