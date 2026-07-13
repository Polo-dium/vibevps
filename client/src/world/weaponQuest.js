import * as THREE from 'three';
import { audio } from '../audio.js';
import { buildHuman } from './human.js';

export const QUEST_HAMMER_SPOT = { x: 28, z: 18 };
const NPC_SPOT = { x: 31.5, z: 19 };
const QUEST_ITEMS = [
  { id: 'weapon:marteau', label: 'Marteau', emoji: '🔨', article: 'le' },
  { id: 'weapon:pompe', label: 'Fusil à pompe', emoji: '💥', article: 'le' },
  { id: 'weapon:minigun', label: 'Minigun', emoji: '🌀', article: 'le' },
  { id: 'weapon:bazooka', label: 'Bazooka', emoji: '🚀', article: 'le' },
  { id: 'radio', label: 'Radio portable', emoji: '📻', article: 'la' },
];

// Repères assez connus pour donner un indice parlant sans transformer la
// quête en GPS. Les petites activités répétées (traboules, jetpacks...) sont
// volontairement ignorées afin de garder des formulations stables.
const CLUE_LANDMARKS = new Set([
  'roue', 'roi', 'saintex', 'arcade', 'stand', 'musee', 'crayon',
  'basilique', 'ficelle', 'aeroport', 'avion-rc',
]);

// Momo reste au pied de la Grande Roue, à côté du marteau garanti par
// loot.js. La progression se déduit de l'inventaire persistant : aucun
// doublon de logique entre le HUD, le PNJ et la sauvegarde serveur.
export function buildWeaponQuest(ctx, {
  getStatus, hasItem, getItemTarget, startQuest, completeQuest, onProgress, onReward,
}) {
  const y = Math.max(0, ctx.terrainHeight?.(NPC_SPOT.x, NPC_SPOT.z) ?? 0);
  const human = buildHuman({
    shirt: 0xd89a2b, pants: 0x273244, hair: 0x24201c, skin: 0xd8aa7f,
  });
  const group = human.group;
  group.position.set(NPC_SPOT.x, y, NPC_SPOT.z);
  group.userData.baseY = y;
  group.rotation.y = Math.atan2(
    NPC_SPOT.x - QUEST_HAMMER_SPOT.x,
    NPC_SPOT.z - QUEST_HAMMER_SPOT.z
  );

  // Tablier sombre + petite caisse à outils : silhouette identifiable sans
  // texture externe, y compris avec les graphismes réglés sur Bas.
  const apron = new THREE.Mesh(
    new THREE.BoxGeometry(0.38, 0.5, 0.035),
    new THREE.MeshLambertMaterial({ color: 0x27303a })
  );
  apron.position.set(0, 1.12, -0.15);
  group.add(apron);
  const label = makeLabel('MOMO L’ARMURIER', 'QUÊTE D’ÉQUIPEMENT');
  label.position.y = 2.18;
  group.add(label);
  const marker = makeMarker();
  marker.position.y = 2.95;
  group.add(marker);
  ctx.scene.add(group);

  const toolbox = new THREE.Group();
  const boxMat = new THREE.MeshLambertMaterial({ color: 0xb8352b });
  const metalMat = new THREE.MeshLambertMaterial({ color: 0x9eabb5 });
  const box = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.34, 0.38), boxMat);
  box.position.y = 0.17;
  toolbox.add(box);
  const handle = new THREE.Mesh(new THREE.TorusGeometry(0.18, 0.025, 5, 10, Math.PI), metalMat);
  handle.position.y = 0.42;
  handle.rotation.x = Math.PI / 2;
  toolbox.add(handle);
  toolbox.position.set(NPC_SPOT.x + 0.8, y, NPC_SPOT.z + 0.25);
  ctx.scene.add(toolbox);

  function items() {
    return QUEST_ITEMS.map((item) => ({ ...item, done: hasItem(item.id) }));
  }
  function missing() {
    return QUEST_ITEMS.filter((item) => !hasItem(item.id));
  }
  function clueFor(item) {
    const target = getItemTarget?.(item.id);
    if (!target) return 'cherche le halo lumineux qui brille au sol dans les rues de Lyon';

    const player = ctx.playerPos?.() ?? { x: 0, z: 0 };
    const dx = target.x - player.x;
    const dz = target.z - player.z;
    const distance = Number.isFinite(target.distance)
      ? target.distance
      : Math.hypot(dx, dz);
    const direction = compassDirection(dx, dz);
    const roundedDistance = approximateDistance(distance);

    if (item.id === 'weapon:marteau') {
      return `${direction}, à environ ${roundedDistance} m, au pied de la Grande Roue juste à côté de Momo`;
    }
    if (item.id === 'radio') {
      return `${direction}, à environ ${roundedDistance} m, devant la salle d’arcade`;
    }

    const landmark = nearestLandmark(ctx.pois, target);
    const landmarkDistance = landmark
      ? Math.hypot(target.x - landmark.x, target.z - landmark.z)
      : Infinity;
    let near = '';
    if (landmarkDistance <= 35) near = `, tout près de ${landmark.nom}`;
    else if (landmarkDistance <= 100) near = `, dans les environs de ${landmark.nom}`;
    return `${direction}, à environ ${roundedDistance} m${near}`;
  }
  function currentClue() {
    const item = missing()[0];
    if (!item) return null;
    return {
      item,
      text: clueFor(item),
    };
  }

  let lastHudSignature = '';
  function pushHud() {
    if (getStatus() !== 1) {
      if (lastHudSignature === 'hidden') return;
      lastHudSignature = 'hidden';
      onProgress?.(null);
      return;
    }
    const questItems = items();
    const clue = currentClue();
    const hint = clue ? `${clue.item.emoji} ${clue.item.label} — ${clue.text}` : null;
    const signature = `${questItems.map((item) => Number(item.done)).join('')}|${hint ?? ''}`;
    if (signature === lastHudSignature) return;
    lastHudSignature = signature;
    onProgress?.({
      icon: '🔧', title: 'LA CHASSE À L’ÉQUIPEMENT', items: questItems, hint,
    });
  }
  function refreshLabel() {
    const status = getStatus();
    gate.label = status === 0
      ? 'E — Parler à Momo l’armurier'
      : status === 1
        ? missing().length
          ? 'E — Faire le point avec Momo'
          : 'E — Terminer la quête de Momo'
        : 'E — Saluer Momo l’armurier';
    marker.visible = status !== 2;
  }

  let busy = false;
  async function finishQuest() {
    const res = await completeQuest();
    pushHud();
    refreshLabel();
    if (res.status === 2) {
      ctx.notify?.(res.xpGain
        ? '🏆 Momo : Équipement complet, gone ! Voilà 150 XP pour le travail.'
        : '🔧 Momo : Cette quête est déjà validée, ton équipement est au complet !');
      audio.npcSay(res.xpGain ? 'Équipement complet, gone ! Beau travail.' : 'Ton équipement est déjà au complet !');
      onReward?.(res);
    }
  }

  const gate = {
    x: NPC_SPOT.x, z: NPC_SPOT.z, r: 4.2, label: '',
    action: async () => {
      if (busy) return;
      busy = true;
      try {
        const status = getStatus();
        if (status === 0) {
          await startQuest();
          refreshLabel();
          pushHud();
          if (getStatus() === 2) {
            ctx.notify?.('🔧 Momo : Ton équipement est déjà au complet !');
          } else if (!missing().length) {
            await finishQuest();
          } else {
            const clue = currentClue();
            ctx.notify?.(`🔧 Momo : Retrouve les quatre armes et la radio ! Commence par ${clue.item.emoji} ${clue.item.label} : ${clue.text}.`);
            audio.npcSay(`Commence par ${clue.item.article} ${clue.item.label}. ${clue.text}.`);
          }
        } else if (status === 1) {
          const left = missing();
          if (!left.length) {
            await finishQuest();
          } else {
            const names = left.map((item) => `${item.emoji} ${item.label}`).join(' · ');
            const clue = currentClue();
            ctx.notify?.(`🔧 Momo : Il te manque ${names}. Indice pour ${clue.item.label} : ${clue.text}.`);
            audio.npcSay(`Il t’en manque encore ${left.length}, gone ! Pour ${clue.item.article} ${clue.item.label}, va ${clue.text}.`);
          }
        } else {
          ctx.notify?.('🔧 Momo : Ton équipement est complet. Fais-en bon usage, gone !');
          audio.npcSay('Fais-en bon usage, gone !');
        }
      } catch (err) {
        ctx.notify?.(`Quête impossible : ${err.message}`);
      } finally {
        busy = false;
      }
    },
  };
  refreshLabel();
  pushHud();
  ctx.interactables.push(gate);
  ctx.pois?.push({ id: 'armurier', nom: 'Momo l’armurier', emoji: '🔧', x: NPC_SPOT.x, z: NPC_SPOT.z });

  let t = 0;
  let hintRefresh = 0;
  let previous = items().filter((item) => item.done).map((item) => item.id).join('|');
  let readyAnnounced = false;
  ctx.updatables.push((dt) => {
    t += dt;
    marker.position.y = 2.95 + Math.sin(t * 2.4) * 0.1;
    marker.material.rotation = Math.sin(t * 0.8) * 0.08;
    human.animate(t * 1.4, 0);
    refreshLabel();
    if (getStatus() !== 1) return;
    hintRefresh -= dt;
    if (hintRefresh <= 0) {
      hintRefresh = 0.8;
      pushHud();
    }
    const currentItems = items();
    const signature = currentItems.filter((item) => item.done).map((item) => item.id).join('|');
    if (signature === previous) return;
    const oldIds = new Set(previous ? previous.split('|') : []);
    const newlyFound = currentItems.filter((item) => item.done && !oldIds.has(item.id));
    previous = signature;
    pushHud();
    if (newlyFound.length) {
      const item = newlyFound[newlyFound.length - 1];
      ctx.notify?.(`🔧 Quête de Momo : ${item.emoji} ${item.label} récupéré !`);
    }
    if (!readyAnnounced && currentItems.every((item) => item.done)) {
      readyAnnounced = true;
      ctx.notify?.('✅ Équipement complet ! Retourne voir Momo près de la Grande Roue.');
      audio.reward();
    }
  });
}

function compassDirection(dx, dz) {
  if (Math.hypot(dx, dz) < 8) return 'à quelques pas de toi';
  // Dans le monde, +x = est et -z = nord.
  const names = [
    'vers le nord', 'vers le nord-est', 'vers l’est', 'vers le sud-est',
    'vers le sud', 'vers le sud-ouest', 'vers l’ouest', 'vers le nord-ouest',
  ];
  const angle = Math.atan2(dx, -dz);
  const index = (Math.round(angle / (Math.PI / 4)) + names.length) % names.length;
  return names[index];
}

function approximateDistance(distance) {
  const step = distance >= 500 ? 50 : distance >= 120 ? 25 : distance >= 35 ? 10 : 5;
  return Math.max(step, Math.round(distance / step) * step);
}

function nearestLandmark(pois = [], target) {
  let nearest = null;
  let bestD2 = Infinity;
  for (const poi of pois) {
    if (!CLUE_LANDMARKS.has(poi.id)) continue;
    const dx = target.x - poi.x;
    const dz = target.z - poi.z;
    const d2 = dx * dx + dz * dz;
    if (d2 >= bestD2) continue;
    bestD2 = d2;
    nearest = poi;
  }
  return nearest;
}

function makeLabel(title, subtitle) {
  const canvas = document.createElement('canvas');
  canvas.width = 512; canvas.height = 128;
  const g = canvas.getContext('2d');
  g.fillStyle = 'rgba(5, 11, 22, .88)';
  g.beginPath(); g.roundRect(16, 12, 480, 102, 18); g.fill();
  g.strokeStyle = '#ffc64a'; g.lineWidth = 4; g.stroke();
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillStyle = '#fff0bd'; g.font = '800 34px monospace'; g.fillText(title, 256, 48);
  g.fillStyle = '#ffc64a'; g.font = '700 22px monospace'; g.fillText(subtitle, 256, 84);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false }));
  sprite.scale.set(4.6, 1.15, 1);
  return sprite;
}

function makeMarker() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  const g = canvas.getContext('2d');
  g.shadowColor = '#ffb52e'; g.shadowBlur = 20;
  g.fillStyle = '#ffc64a';
  g.beginPath(); g.arc(64, 64, 43, 0, Math.PI * 2); g.fill();
  g.shadowBlur = 0; g.fillStyle = '#2a1b05';
  g.font = '900 76px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('!', 64, 67);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false }));
  sprite.scale.set(0.8, 0.8, 1);
  return sprite;
}
