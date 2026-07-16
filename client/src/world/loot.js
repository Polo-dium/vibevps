import * as THREE from 'three';
import { makeRand, RANGE } from './layout.js';
import { WEAPONS, buildWeaponModel } from '../player/weapon.js';
import { QUEST_HAMMER_SPOT } from './weaponQuest.js';

// Armes à ramasser sur la map, du marteau au bazooka : spots DÉTERMINISTES
// (même seed pour tous les joueurs, comme le décor), arme qui flotte et
// tournoie sur un halo lumineux. On marche dessus pour la ramasser ; elle
// réapparaît un peu plus tard (chacun voit son propre loot, comme le trafic).

const RESPAWN_S = 75;
const PICKUP_R = 1.7;
// Rareté : marteau et pompe courants, akimbo et minigun rares, bazooka très rare
const POOL = ['marteau', 'pompe', 'marteau', 'minigun', 'pompe', 'akimbo', 'marteau', 'pompe', 'bazooka'];

export function buildLoot(ctx, { onPickup }) {
  const rand = makeRand(7777);
  const bound = Math.max(60, (ctx.worldBound ?? 134) - 20);
  const count = Math.max(10, Math.min(30, Math.round(bound / 26)));

  const glowMat = new THREE.SpriteMaterial({
    map: makeGlowTexture(),
    color: 0x7fd8ff,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });

  const spots = []; // { id, group, x, y, z, hiddenUntil }

  // Test 2D volontairement plus strict que la collision du joueur : les
  // immeubles OSM ont des murs fins + un collider de toit. Un point tiré au
  // milieu de leur empreinte ne touchait donc aucun mur au niveau du sol et
  // pouvait enfermer une arme à l'intérieur. Le collider du toit nous donne
  // justement toute l'empreinte à exclure, quelle que soit sa hauteur.
  function isOpen(x, z, margin = 0.9) {
    if (Math.abs(x) > bound || Math.abs(z) > bound) return false;
    const y = ctx.terrainHeight?.(x, z) ?? 0;
    if (y < -0.2 || ctx.waterMask?.isWater?.(x, z)) return false;
    for (const b of ctx.colliders.nearby?.(x, z, margin + 1) ?? []) {
      if (
        x > b.minX - margin && x < b.maxX + margin &&
        z > b.minZ - margin && z < b.maxZ + margin
      ) return false;
    }
    return true;
  }

  function nearestOpen(x, z) {
    if (isOpen(x, z)) return { x, z };
    // Spirale déterministe : même solution pour tous les joueurs, sans
    // Math.random(), jusqu'à trouver un trottoir/espace libre voisin.
    for (let radius = 3; radius <= Math.min(48, bound); radius += 3) {
      const steps = Math.max(8, Math.round((Math.PI * 2 * radius) / 3));
      for (let i = 0; i < steps; i++) {
        const a = (i / steps) * Math.PI * 2;
        const sx = x + Math.cos(a) * radius;
        const sz = z + Math.sin(a) * radius;
        if (isOpen(sx, sz)) return { x: sx, z: sz };
      }
    }
    return null;
  }

  function addSpot(id, x, z, phase) {
    const y = ctx.terrainHeight?.(x, z) ?? 0;
    const group = new THREE.Group();
    const model = buildWeaponModel(id);
    model.scale.setScalar(2.4);
    group.add(model);
    const glow = new THREE.Sprite(glowMat);
    glow.scale.set(2.6, 2.6, 1);
    glow.position.y = -0.55;
    group.add(glow);
    group.position.set(x, y + 1.15, z);
    ctx.scene.add(group);
    spots.push({ id, group, x, y, z, hiddenUntil: 0, phase });
  }

  // Premier objectif de la quête : un marteau toujours au pied de la Grande
  // Roue, juste à côté de Momo. Les autres armes restent dispersées dans Lyon.
  addSpot('marteau', QUEST_HAMMER_SPOT.x, QUEST_HAMMER_SPOT.z, rand() * Math.PI * 2);
  // Une minigun est toujours disponible en espace ouvert à côté du stand de
  // tir. Les exemplaires aléatoires restent présents, mais la quête ne peut
  // plus dépendre d'une arme enfermée dans une empreinte OSM.
  const guaranteedMinigun = nearestOpen(RANGE.x + RANGE.width / 2 + 5, RANGE.counterZ + 2);
  if (guaranteedMinigun) {
    addSpot('minigun', guaranteedMinigun.x, guaranteedMinigun.z, rand() * Math.PI * 2);
  }
  let guard = 0;
  while (spots.length < count && guard++ < count * 50) {
    const x = (rand() * 2 - 1) * bound;
    const z = (rand() * 2 - 1) * bound;
    if (!isOpen(x, z)) continue;

    const id = POOL[spots.length % POOL.length];
    addSpot(id, x, z, rand() * Math.PI * 2);
  }

  // Rotation + flottement + ramassage par proximité
  let t = 0;
  ctx.updatables.push((dt) => {
    t += dt;
    const now = performance.now() / 1000;
    const p = ctx.playerPos?.();
    for (const s of spots) {
      if (s.hiddenUntil > 0) {
        if (now >= s.hiddenUntil) {
          s.hiddenUntil = 0;
          s.group.visible = true;
        }
        continue;
      }
      s.group.rotation.y = t * 1.4 + s.phase;
      s.group.position.y = s.y + 1.15 + Math.sin(t * 2 + s.phase) * 0.14;
      if (p && Math.abs(p.x - s.x) < PICKUP_R && Math.abs(p.z - s.z) < PICKUP_R &&
          Math.abs(p.y - s.y) < 2.2) {
        s.hiddenUntil = now + RESPAWN_S;
        s.group.visible = false;
        onPickup?.(s.id, WEAPONS[s.id]);
      }
    }
  });

  // La quête de Momo peut demander la position du ramassage le plus proche
  // pour une arme donnée. On ne révèle pas les coordonnées brutes au joueur :
  // weaponQuest.js les transforme en direction, distance et repère lyonnais.
  // Les spots restent déterministes, donc l'indice pointe toujours vers une
  // arme réellement présente dans le monde affiché.
  function nearest(id, from = ctx.playerPos?.()) {
    const weaponId = String(id).replace(/^weapon:/, '');
    let best = null;
    let bestD2 = Infinity;
    for (const spot of spots) {
      if (spot.id !== weaponId) continue;
      const dx = spot.x - (from?.x ?? 0);
      const dz = spot.z - (from?.z ?? 0);
      const d2 = dx * dx + dz * dz;
      if (d2 >= bestD2) continue;
      bestD2 = d2;
      best = { x: spot.x, z: spot.z, distance: Math.sqrt(d2) };
    }
    return best;
  }

  return { count: spots.length, nearest };
}

// Halo circulaire doux (dégradé radial en canvas)
function makeGlowTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 64;
  const g = canvas.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 2, 32, 32, 30);
  grad.addColorStop(0, 'rgba(255, 255, 255, 0.9)');
  grad.addColorStop(0.4, 'rgba(160, 220, 255, 0.45)');
  grad.addColorStop(1, 'rgba(160, 220, 255, 0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
