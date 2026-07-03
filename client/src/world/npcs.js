import * as THREE from 'three';
import { audio } from '../audio.js';
import { SAONE, RHONE } from './layout.js';
import { buildHuman } from './human.js';

const NPC_COUNT = 18;
const NPC_HP = 50; // deux balles

const PHRASES = [
  'Salut gone !',
  'Il fait beau sur la Presqu’île.',
  'Allez l’OL !',
  'Tu connais un bon bouchon dans le coin ?',
  'C’est par où la rue de la Ré ?',
  'Je vais voir le mur des Canuts.',
  'Le funiculaire est encore en panne…',
  'T’as testé la borne Tetris ?',
  'La Saône est belle aujourd’hui.',
  'Y’a un de ces mondes à Bellecour !',
  'Une praline et ça repart.',
  'Fais gaffe, ça tire dans le quartier…',
  'T’es un vrai gone, toi.',
  'Ma fenotte m’attend au mâchon.',
  'J’ai débaroulé les pentes en Vélo’v.',
  'Le silure ? Il a mangé mon caniche.',
  'Entre Rhône et Saône, mon cœur balance.',
  'Guignol aurait pas fait mieux.',
  'La quenelle, c’est la vie.',
  'Un jour j’irai à Paris. Ou pas.',
  'Regarde le cul de la Grande Roue !',
  'Il est pas là, le gnôlu qui tague tout ?',
];
// Running gag : à proximité de la statue de Louis XIV
const ROI_PHRASES = ['Vive le Roi !', 'Le Roi vous regarde, gone.', 'On s’incline devant le Roi de bronze.'];
const ROI_SPOT = { x: -2, z: 6, r: 22 };
const HURT_PHRASES = [
  'Aïe !', 'Hé oh, ça va pas ?!', 'Mais arrête !',
  'Oh le gone, ça va pas la tête ?!', 'Mes pralines !!',
  'J’appelle Guignol !', 'Gnôlu, va !',
];
const DEATH_PHRASES = [
  'Aaaaah !', 'Au secours !', 'Noooon !',
  'Adieu, belle Presqu’île…', 'Dites à ma fenotte que je l’aime !',
  'Je rejoins Guignol…', 'Même pas mal… si.',
];

const CIVIL_COLORS = [0x6b7a8f, 0x8f6b6b, 0x6b8f74, 0x8f836b, 0x726b8f, 0x4f6272, 0x7d6754];

let lastSpeechAt = 0; // anti-cacophonie global

const ANGRY_PHRASES = ['POUR LE ROI !!', 'SUS AU RÉGICIDE !', 'ATTRAPEZ-LE, GONES !', 'LE ROI SERA VENGÉ !'];

export function createNpcs(ctx, { getPlayerPos, onNpcHit, onNpcAttack }) {
  const npcs = [];
  let enrageUntil = 0; // la Garde Royale est en chasse jusqu'à cet instant

  function blocked(x, z) {
    const bound = Math.min(ctx.worldBound ?? 130, 200); // les PNJ restent au centre
    if (Math.abs(x) > bound || Math.abs(z) > bound) return true;
    // Les PNJ ne grimpent pas Fourvière (ils marchent à plat, y = 0)
    if ((ctx.terrainHeight?.(x, z) ?? 0) > 0.5) return true;
    // Fleuves infranchissables (sauf l'axe des ponts en ville procédurale)
    const water = ctx.waterBands ?? [SAONE, RHONE];
    const bridgeOk = !ctx.waterBands; // ponts garantis à z=0 en mode procédural
    for (const r of water) {
      if (x > r.minX - 1 && x < r.maxX + 1 && (!bridgeOk || Math.abs(z) > 4.2)) return true;
    }
    const boxes = ctx.colliders.nearby
      ? ctx.colliders.nearby(x, z, 1)
      : ctx.colliders;
    for (const b of boxes) {
      if (
        x + 0.45 > b.minX && x - 0.45 < b.maxX &&
        1.0 > b.minY && 0.1 < b.maxY &&
        z + 0.45 > b.minZ && z - 0.45 < b.maxZ
      ) return true;
    }
    return false;
  }

  function freeSpot() {
    for (let i = 0; i < 60; i++) {
      const x = (Math.random() - 0.5) * 220;
      const z = (Math.random() - 0.5) * 220;
      if (!blocked(x, z)) return [x, z];
    }
    return [0, 40];
  }

  for (let i = 0; i < NPC_COUNT; i++) {
    const color = CIVIL_COLORS[i % CIVIL_COLORS.length];
    const human = buildHuman({
      shirt: color,
      pants: [0x39404e, 0x4e4439, 0x57514a][i % 3],
      hair: Math.random() < 0.5 ? 0x3a2c1e : 0x55514c,
    });
    const group = human.group;

    const bubble = makeBubble();
    bubble.visible = false;
    group.add(bubble);

    const [x, z] = freeSpot();
    group.position.set(x, 0, z);
    group.userData.baseY = 0;
    ctx.scene.add(group);

    const npc = {
      group, human, bubble,
      baseColor: new THREE.Color(color),
      dir: Math.random() * Math.PI * 2,
      speed: 1.0 + Math.random() * 0.8,
      hp: NPC_HP,
      mode: 'walk', // walk | dying | dead
      timer: 0,
      animTime: Math.random() * 10,
      turnTimer: 2 + Math.random() * 5,
      talkCd: Math.random() * 12,
      bubbleTimer: 0,
      flashUntil: 0,
      lungeCd: 0, // cadence d'attaque en mode Garde Royale
    };

    for (const mesh of human.hitMeshes) {
      mesh.userData.onHit = () => hitNpc(npc);
      ctx.shootables.push(mesh);
    }
    npcs.push(npc);
  }

  function say(npc, text, { hurt = false } = {}) {
    setBubble(npc.bubble, text);
    npc.bubble.visible = true;
    npc.bubbleTimer = 3;
    const playerPos = getPlayerPos();
    const dist = npc.group.position.distanceTo(playerPos);
    const now = performance.now();
    if (dist < 9 && (hurt || now - lastSpeechAt > 3500)) {
      lastSpeechAt = now;
      audio.npcSay(text, { hurt });
    }
  }

  function hitNpc(npc) {
    if (npc.mode !== 'walk') return;
    npc.hp -= 25;
    npc.human.shirtMat.color.set(0xff3333);
    npc.flashUntil = performance.now() + 220;
    onNpcHit?.();
    if (npc.hp <= 0) {
      npc.mode = 'dying';
      npc.timer = 0;
      // Ragdoll de comédie : le PNJ s'envole loin du tireur en vrille
      const away = npc.group.position.clone().sub(getPlayerPos());
      away.y = 0;
      away.normalize();
      const punch = 4.5 + Math.random() * 3;
      npc.fly = {
        vx: away.x * punch, vz: away.z * punch,
        vy: 6 + Math.random() * 3,
        spinX: (Math.random() - 0.5) * 12,
        spinZ: (Math.random() - 0.5) * 12,
        bounces: 0,
      };
      say(npc, DEATH_PHRASES[Math.floor(Math.random() * DEATH_PHRASES.length)], { hurt: true });
    } else {
      say(npc, HURT_PHRASES[Math.floor(Math.random() * HURT_PHRASES.length)], { hurt: true });
      // Il s'enfuit !
      npc.speed = 3.4;
      npc.turnTimer = 4;
    }
  }

  function respawn(npc) {
    const [x, z] = freeSpot();
    npc.group.position.set(x, 0, z);
    npc.group.rotation.set(0, 0, 0);
    npc.hp = NPC_HP;
    npc.fly = null;
    npc.mode = 'walk';
    npc.speed = 1.0 + Math.random() * 0.8;
    npc.human.shirtMat.color.copy(npc.baseColor);
    npc.bubble.visible = false;
  }

  function update(dt) {
    const playerPos = getPlayerPos();
    const now = performance.now();

    // Fin de la chasse : la Garde redevient de paisibles gones
    if (enrageUntil > 0 && now >= enrageUntil) {
      enrageUntil = 0;
      for (const npc of npcs) {
        if (npc.mode !== 'walk') continue;
        npc.human.shirtMat.color.copy(npc.baseColor);
        npc.speed = 1.0 + Math.random() * 0.8;
      }
    }

    for (const npc of npcs) {
      if (npc.flashUntil && now > npc.flashUntil && npc.mode === 'walk') {
        npc.human.shirtMat.color.copy(npc.baseColor);
        npc.flashUntil = 0;
      }

      if (npc.bubbleTimer > 0) {
        npc.bubbleTimer -= dt;
        if (npc.bubbleTimer <= 0) npc.bubble.visible = false;
      }

      if (npc.mode === 'dying') {
        npc.timer += dt;
        const fly = npc.fly;
        if (fly) {
          // Vol plané ridicule + vrille, avec rebond
          fly.vy -= 17 * dt;
          const g = npc.group;
          g.position.x += fly.vx * dt;
          g.position.z += fly.vz * dt;
          g.position.y += fly.vy * dt;
          g.rotation.x += fly.spinX * dt;
          g.rotation.z += fly.spinZ * dt;
          if (g.position.y <= 0 && fly.vy < 0) {
            g.position.y = 0;
            fly.bounces += 1;
            if (fly.bounces >= 2) {
              npc.fly = null;
              g.rotation.set(-Math.PI / 2, g.rotation.y, 0); // à plat dos
              npc.timer = Math.max(npc.timer, 1.2);
            } else {
              fly.vy *= -0.42;
              fly.vx *= 0.55;
              fly.vz *= 0.55;
              fly.spinX *= 0.6;
              fly.spinZ *= 0.6;
            }
          }
        }
        if (!npc.fly && npc.timer > 3.2) {
          npc.group.position.y -= dt * 0.8; // s'enfonce doucement
          if (npc.timer > 4.5) respawn(npc);
        }
        continue;
      }
      if (npc.mode !== 'walk') continue;

      // Garde Royale : les PNJ proches chassent le régicide jusqu'à la mort
      if (now < enrageUntil) {
        const g = npc.group.position;
        const dist = g.distanceTo(playerPos);
        if (dist < 70) {
          npc.dir = Math.atan2(playerPos.x - g.x, playerPos.z - g.z);
          npc.speed = 4.6;
          npc.human.shirtMat.color.set(0xaa1f1f); // uniformes rouges de rage
          npc.lungeCd -= dt;
          if (dist < 1.5 && npc.lungeCd <= 0) {
            npc.lungeCd = 0.9;
            onNpcAttack?.();
            say(npc, ANGRY_PHRASES[Math.floor(Math.random() * ANGRY_PHRASES.length)], { hurt: true });
          }
          const dxx = Math.sin(npc.dir) * npc.speed * dt;
          const dzz = Math.cos(npc.dir) * npc.speed * dt;
          const nxx = g.x + dxx, nzz = g.z + dzz;
          if (!blocked(nxx, nzz)) {
            g.x = nxx;
            g.z = nzz;
          }
          npc.group.rotation.y = npc.dir + Math.PI;
          npc.animTime += dt * (3 + npc.speed * 2.4);
          npc.human.animate(npc.animTime, npc.speed);
          continue;
        }
      }

      // Errance
      npc.turnTimer -= dt;
      if (npc.turnTimer <= 0) {
        npc.dir += (Math.random() - 0.5) * 2.2;
        npc.turnTimer = 2.5 + Math.random() * 5;
        if (npc.speed > 2.5) npc.speed = 1.0 + Math.random() * 0.8; // fin de fuite
      }
      const dx = Math.sin(npc.dir) * npc.speed * dt;
      const dz = Math.cos(npc.dir) * npc.speed * dt;
      const nx = npc.group.position.x + dx;
      const nz = npc.group.position.z + dz;
      if (blocked(nx, nz)) {
        npc.dir += Math.PI / 2 + Math.random() * Math.PI;
      } else {
        npc.group.position.x = nx;
        npc.group.position.z = nz;
        npc.group.rotation.y = npc.dir + Math.PI; // nez face à la marche
      }
      npc.animTime += dt * (3 + npc.speed * 2.2);
      npc.human.animate(npc.animTime, npc.speed);

      // Bavardage quand le joueur est proche
      npc.talkCd -= dt;
      if (npc.talkCd <= 0) {
        const dist = npc.group.position.distanceTo(playerPos);
        if (dist < 6.5) {
          // Près de la statue, le running gag prend le dessus
          const dRoi = Math.hypot(npc.group.position.x - ROI_SPOT.x, npc.group.position.z - ROI_SPOT.z);
          const pool = dRoi < ROI_SPOT.r && Math.random() < 0.4 ? ROI_PHRASES : PHRASES;
          say(npc, pool[Math.floor(Math.random() * pool.length)]);
          npc.talkCd = 12 + Math.random() * 12;
        } else {
          npc.talkCd = 1 + Math.random();
        }
      }
    }
  }

  // La Garde Royale se lève : chasse au régicide pendant `seconds` secondes
  // (ou jusqu'à ce que la mort du joueur y mette fin via calm()).
  function enrage(seconds = 18) {
    enrageUntil = performance.now() + seconds * 1000;
  }
  function calm() {
    enrageUntil = 1; // sera remis à zéro (et couleurs restaurées) au prochain update
  }

  // Clameur collective : les PNJ proches du joueur crient tous le même texte
  function shout(text, radius = 45) {
    const playerPos = getPlayerPos();
    let spoken = 0;
    for (const npc of npcs) {
      if (npc.mode !== 'walk') continue;
      if (npc.group.position.distanceTo(playerPos) > radius) continue;
      setBubble(npc.bubble, text);
      npc.bubble.visible = true;
      npc.bubbleTimer = 3.5;
      if (spoken < 2) {
        spoken += 1;
        audio.npcSay(text, {});
      }
    }
  }

  return { update, shout, enrage, calm };
}

function makeBubble() {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 128;
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: new THREE.CanvasTexture(canvas),
      transparent: true,
      depthTest: false,
    })
  );
  sprite.scale.set(3.2, 0.8, 1);
  sprite.position.y = 2.25;
  sprite.userData.canvas = canvas;
  return sprite;
}

function setBubble(sprite, text) {
  const canvas = sprite.userData.canvas;
  const g = canvas.getContext('2d');
  g.clearRect(0, 0, canvas.width, canvas.height);
  g.font = '600 38px "Segoe UI", sans-serif';
  const w = Math.min(490, g.measureText(text).width + 50);
  const x = (canvas.width - w) / 2;
  g.fillStyle = 'rgba(255, 255, 255, 0.93)';
  g.beginPath();
  g.roundRect(x, 18, w, 78, 20);
  g.fill();
  g.fillStyle = '#1a2233';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, canvas.width / 2, 58, 470);
  sprite.material.map.needsUpdate = true;
}
