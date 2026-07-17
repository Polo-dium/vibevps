import * as THREE from 'three';
import { buildHuman } from './human.js';

// L'INVASION DES GONES ZOMBIES 🧟 : une nuit sur trois (cycle jour % 3 = 1,
// jamais la même nuit que la Fête des Lumières qui tombe sur % 3 = 2), des
// gones verdâtres sortent des traboules — c'est bien connu, elles mènent
// partout — et marchent sur le joueur. 30 HP pièce, dégâts au contact
// arbitrés par le serveur (canal « ouch » borné). Compteur de kills de la
// nuit envoyé au classement 'invasion' quand le jour se lève.
const DAY_MS = 600000;
const MAX_ZOMBIES = 9;
const ZOMBIE_HP = 30;
const SPEED = 2.6;
const ATTACK_RANGE = 1.7;
const ATTACK_EVERY = 1.3;

const SHIRTS = [0x4a6b3a, 0x5d5a34, 0x3f5d46, 0x6b5a3a];

export function createInvasion(ctx, { notify, setBanner, onAttack, onEnd, getDamage, audio }) {
  const zombies = [];
  let active = false;
  let kills = 0;
  let spawnCooldown = 0;

  const isInvasionNight = () =>
    Math.floor(Date.now() / DAY_MS) % 3 === 1 && (ctx.env?.night ?? 0) > 0.35;

  function spawn() {
    const p = ctx.playerPos();
    const a = Math.random() * Math.PI * 2; // spawn : pas de décor persistant
    const d = 26 + Math.random() * 16;
    const x = p.x + Math.cos(a) * d, z = p.z + Math.sin(a) * d;
    const human = buildHuman({
      shirt: SHIRTS[Math.floor(Math.random() * SHIRTS.length)],
      skin: 0x9fb886, hair: 0x2c331f,
    });
    const g = human.group;
    g.position.set(x, Math.max(0, ctx.terrainHeight?.(x, z) ?? 0), z);
    ctx.scene.add(g);
    const zombie = { g, human, hp: ZOMBIE_HP, t: Math.random() * 10, attackIn: 1, dead: 0 };
    for (const mesh of human.hitMeshes) {
      mesh.userData.onHit = () => {
        if (zombie.dead) return;
        zombie.hp -= getDamage?.() ?? 10;
        if (zombie.hp <= 0) {
          zombie.dead = 0.001;
          kills++;
          audio?.hitmarker?.();
          setBanner(`🧟 ${kills} gone${kills > 1 ? 's' : ''} zombie${kills > 1 ? 's' : ''} dégommé${kills > 1 ? 's' : ''} cette nuit`);
        }
      };
      ctx.shootables.push(mesh);
    }
    zombies.push(zombie);
  }

  function despawn(zombie) {
    ctx.scene.remove(zombie.g);
    for (const mesh of zombie.human.hitMeshes) {
      const i = ctx.shootables.indexOf(mesh);
      if (i >= 0) ctx.shootables.splice(i, 1);
    }
    const i = zombies.indexOf(zombie);
    if (i >= 0) zombies.splice(i, 1);
  }

  ctx.updatables.push((dt) => {
    const want = isInvasionNight();
    if (want && !active) {
      active = true;
      kills = 0;
      notify('🧟 INVASION ! Les gones zombies sortent des traboules — défends la Presqu’île, gone !');
    } else if (!want && active) {
      active = false;
      while (zombies.length) despawn(zombies[0]);
      setBanner(null);
      if (kills > 0) {
        notify(`🌅 Le jour se lève : ${kills} zombie${kills > 1 ? 's' : ''} au tapis. Chapeau bas.`);
        onEnd?.(kills);
      }
    }
    if (!active) return;

    spawnCooldown -= dt;
    if (zombies.length < MAX_ZOMBIES && spawnCooldown <= 0) {
      spawnCooldown = 1.6;
      spawn();
    }

    const p = ctx.playerPos();
    for (let i = zombies.length - 1; i >= 0; i--) {
      const zb = zombies[i];
      if (zb.dead) {
        // il s'effondre, puis la traboule le reprend
        zb.dead += dt;
        zb.g.rotation.x = Math.min(Math.PI / 2, zb.dead * 4);
        if (zb.dead > 2) despawn(zb);
        continue;
      }
      const dx = p.x - zb.g.position.x, dz = p.z - zb.g.position.z;
      const dist = Math.hypot(dx, dz);
      if (dist > 90) { despawn(zb); continue; } // largué : recyclé ailleurs
      zb.g.rotation.y = Math.atan2(dx, dz);
      if (dist > ATTACK_RANGE) {
        const step = (SPEED * dt) / Math.max(dist, 0.01);
        const nx = zb.g.position.x + dx * step;
        const nz = zb.g.position.z + dz * step;
        zb.g.position.set(nx, Math.max(0, ctx.terrainHeight?.(nx, nz) ?? 0), nz);
        zb.t += dt * 6;
        zb.human.animate(zb.t, SPEED);
      } else {
        zb.attackIn -= dt;
        if (zb.attackIn <= 0) {
          zb.attackIn = ATTACK_EVERY;
          onAttack?.(); // dégâts bornés côté serveur (comme la Garde Royale)
        }
      }
    }
  });
}
