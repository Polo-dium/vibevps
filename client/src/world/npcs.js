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
];
const HURT_PHRASES = ['Aïe !', 'Hé oh, ça va pas ?!', 'Mais arrête !'];
const DEATH_PHRASES = ['Aaaaah !', 'Au secours !', 'Noooon !'];

const CIVIL_COLORS = [0x6b7a8f, 0x8f6b6b, 0x6b8f74, 0x8f836b, 0x726b8f, 0x4f6272, 0x7d6754];

let lastSpeechAt = 0; // anti-cacophonie global

export function createNpcs(ctx, { getPlayerPos, onNpcHit }) {
  const npcs = [];

  function blocked(x, z) {
    const bound = Math.min(ctx.worldBound ?? 130, 200); // les PNJ restent au centre
    if (Math.abs(x) > bound || Math.abs(z) > bound) return true;
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
    npc.mode = 'walk';
    npc.speed = 1.0 + Math.random() * 0.8;
    npc.human.shirtMat.color.copy(npc.baseColor);
    npc.bubble.visible = false;
  }

  function update(dt) {
    const playerPos = getPlayerPos();
    const now = performance.now();

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
        // Il s'effondre…
        npc.group.rotation.x = -Math.min(1, npc.timer / 0.5) * Math.PI / 2;
        if (npc.timer > 3.2) {
          npc.group.position.y -= dt * 0.8; // s'enfonce doucement
          if (npc.timer > 4.5) respawn(npc);
        }
        continue;
      }
      if (npc.mode !== 'walk') continue;

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
          say(npc, PHRASES[Math.floor(Math.random() * PHRASES.length)]);
          npc.talkCd = 12 + Math.random() * 12;
        } else {
          npc.talkCd = 1 + Math.random();
        }
      }
    }
  }

  return { update };
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
