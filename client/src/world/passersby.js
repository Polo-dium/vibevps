import * as THREE from 'three';
import { roadHalf } from './roadfit.js';
import { buildHuman } from './human.js';
import { detail } from '../render/detail.js';
import { makeRand } from './layout.js';
import { rainAmount } from './weather.js';
import { CROWD, preloadAvatars, buildAvatar, avatarsEnabled } from './avatars.js';

// PASSANTS (ville OSM) : une petite troupe RECYCLÉE autour du joueur, qui
// marche sur les trottoirs des vraies rues. Quand un passant s'éloigne trop
// (ou arrive au bout de sa rue sans suite), il réapparaît plus loin, sur un
// trottoir proche mais pas sous les yeux du joueur. La ville semble habitée
// partout pour le prix de quelques humains (5 meshes chacun).
//
// Trottoirs : les rues OSM décalées de part et d'autre (demi-largeur +
// 1,2 m), découpées en tronçons rangés dans une grille de 40 m.

const CELL = 40;
const NEAR = 30, FAR = 85, DROP = 110; // apparition entre NEAR et FAR, recyclage au-delà de DROP

// Petites phrases des passants (bulle au-dessus de la tête quand on les
// croise) : une bulle à la fois, toutes les ~9 s au plus.
const BARKS = {
  jour: ['Fait beau, on se fait une terrasse ?', 'Y a pas un bouchon dans le coin ?', 'Ça caille ce matin, gone !',
    'T’as vu la ficelle ? Encore en retard…', 'Je file aux Halles, y a des quenelles !', 'Gnafron est déjà au comptoir, tu crois ?',
    'Salut gone !', 'Le Rhône est haut, hein ?', 'On monte à Fourvière ce soir ?', 'Allez l’OL !',
    'Faut que je passe chez le Mère Brazier…', 'Encore des travaux, quelle gabegie !', 'Bonjour la compagnie !'],
  nuit: ['Ça brille, la basilique, la nuit…', 'Un dernier pot de Beaujolais ?', 'Tu rentres comment, toi ?',
    'Bonne nuit gone !', 'Y a du monde au concert, là-haut !'],
  pluie: ['Quel temps de chien !', 'Ça mouille, ça mouille…', 'Encore oublié mon pépin !', 'Vivement la Fête des Lumières.'],
  fuite: ['Au secours !', 'Mais t’es fada ?!', 'Police !!'],
};

export function createPassersby(ctx, data) {
  const count = detail.level === 'eleve' ? 22 : detail.level === 'moyen' ? 12 : 6;
  const rand = makeRand(6070);

  // --- Tronçons de trottoir -------------------------------------------------
  const segs = [];
  const grid = new Map();
  const key = (cx, cz) => cx * 100003 + cz;
  const blocked = (x, z) => {
    if (ctx.waterMask?.isWater(x, z) || ctx.theatre?.covers(x, z)) return true;
    for (const b of ctx.colliders.nearby ? ctx.colliders.nearby(x, z, 1) : []) {
      if (x > b.minX - 0.4 && x < b.maxX + 0.4 && z > b.minZ - 0.4 && z < b.maxZ + 0.4 && b.maxY > 1.5) return true;
    }
    return false;
  };
  for (const road of data.roads ?? []) {
    if (road.w < 4) continue;
    const off = roadHalf(road) + 1.2;
    for (let i = 0; i + 3 < road.p.length; i += 2) {
      const x1 = road.p[i], z1 = road.p[i + 1], x2 = road.p[i + 2], z2 = road.p[i + 3];
      const len = Math.hypot(x2 - x1, z2 - z1);
      if (len < 6) continue;
      const nx = -(z2 - z1) / len, nz = (x2 - x1) / len;
      for (const side of [-1, 1]) {
        const a = [x1 + nx * off * side, z1 + nz * off * side];
        const b = [x2 + nx * off * side, z2 + nz * off * side];
        // tronçon praticable de bout en bout (sondes tous les 4 m)
        let ok = true;
        for (let t = 0; t <= 1; t += 4 / len) {
          if (blocked(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t)) { ok = false; break; }
        }
        if (!ok) continue;
        const seg = { a, b, len };
        const idx = segs.push(seg) - 1;
        const cx = Math.floor((a[0] + b[0]) / 2 / CELL), cz = Math.floor((a[1] + b[1]) / 2 / CELL);
        const k = key(cx, cz);
        if (!grid.has(k)) grid.set(k, []);
        grid.get(k).push(idx);
      }
    }
  }
  if (!segs.length) return null;

  // --- La troupe ----------------------------------------------------------
  const SHIRTS = [0x2f6fb5, 0xc8423a, 0x6a9a4c, 0xe8e3d8, 0x2b2b30, 0xd9a441, 0x7b4a8e, 0x3c8d8a, 0xb5653d, 0x8c8f96];
  const PANTS = [0x2b2f3a, 0x39404e, 0x50463c, 0x1c1c22, 0x5a6270, 0x6e5a44];
  const SKINS = [0xe8c39e, 0x8d5a3b, 0xf0cfb0, 0xc68e63, 0x5c3a26];
  const HAIRS = [0x3a2c1e, 0x111111, 0x8a5a2b, 0xd9c08a, 0x6b6b6b];
  const people = [];
  for (let i = 0; i < count; i++) {
    const h = buildHuman({
      shirt: SHIRTS[Math.floor(rand() * SHIRTS.length)],
      pants: PANTS[Math.floor(rand() * PANTS.length)],
      skin: SKINS[Math.floor(rand() * SKINS.length)],
      hair: HAIRS[Math.floor(rand() * HAIRS.length)],
    });
    h.group.visible = false;
    ctx.scene.add(h.group);
    const p = { h, seg: null, t: 0, dir: 1, speed: 1.2, phase: rand() * 10, flee: 0 };
    arm(p);
    people.push(p);
  }
  // Touché : il s'enfuit en courant, puis disparaît au coin de la rue
  function arm(p) {
    for (const m of p.h.hitMeshes) {
      m.userData.onHit = () => { p.flee = 6; p.speed = 4.2; say(p, pickBark('fuite')); };
      ctx.shootables.push(m);
    }
  }
  // Avatars réalistes (avatars.js) : chargés en fond, chaque passant sculpté
  // est remplacé par l'un d'eux à sa prochaine réapparition (hors champ)
  let avatarNames = [];
  if (avatarsEnabled()) {
    const pool = [];
    for (let i = 0; i < CROWD.f.length; i++) pool.push(CROWD.f[i], CROWD.m[i]);
    const n = detail.level === 'eleve' ? pool.length : 6;
    // un premier lot vite, le reste ensuite
    setTimeout(async () => {
      for (let i = 0; i < n; i += 2) avatarNames = avatarNames.concat(await preloadAvatars(pool.slice(i, i + 2)));
    }, 4000);
  }
  let swapK = 0;
  function upgrade(p) {
    if (p.h.isAvatar || p.pending || !avatarNames.length) return;
    p.pending = true;
    buildAvatar(avatarNames[swapK++ % avatarNames.length]).then((a) => {
      p.pending = false;
      const old = p.h;
      for (const m of old.hitMeshes) {
        const i = ctx.shootables.indexOf(m);
        if (i >= 0) ctx.shootables.splice(i, 1);
      }
      ctx.scene.remove(old.group);
      a.group.visible = old.group.visible;
      a.group.position.copy(old.group.position);
      ctx.scene.add(a.group);
      p.h = a;
      arm(p);
    }, () => { p.pending = false; });
  }

  // Bulle de parole partagée (une texture canvas redessinée à chaque phrase)
  const bc = document.createElement('canvas');
  bc.width = 512; bc.height = 96;
  const btex = new THREE.CanvasTexture(bc);
  btex.colorSpace = THREE.SRGBColorSpace;
  const bubble = new THREE.Sprite(new THREE.SpriteMaterial({ map: btex, transparent: true, depthWrite: false, fog: false }));
  bubble.center.set(0.5, 0);
  bubble.visible = false;
  bubble.userData.noShadow = true;
  ctx.scene.add(bubble);
  let barkT = 4, barkOwner = null, barkLeft = 0;
  function say(p, text) {
    const g = bc.getContext('2d');
    g.clearRect(0, 0, 512, 96);
    g.font = '600 30px system-ui, sans-serif';
    const w = Math.min(500, g.measureText(text).width + 36);
    const x0 = (512 - w) / 2;
    g.fillStyle = 'rgba(255, 255, 255, 0.94)';
    g.beginPath();
    g.roundRect(x0, 4, w, 62, 22);
    g.moveTo(246, 64); g.lineTo(256, 88); g.lineTo(268, 64);
    g.fill();
    g.fillStyle = '#18202a';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(text, 256, 36, 480);
    btex.needsUpdate = true;
    bubble.scale.set(4.2, 4.2 * 96 / 512, 1);
    bubble.visible = true;
    barkOwner = p;
    barkLeft = 3.6;
  }
  const pickBark = (kind) => BARKS[kind][Math.floor(Math.random() * BARKS[kind].length)];

  const look = new THREE.Vector3();
  const fwd = new THREE.Vector3();
  function nearbySegs(px, pz, rMin, rMax) {
    const out = [];
    const r = Math.ceil(rMax / CELL);
    const cx = Math.floor(px / CELL), cz = Math.floor(pz / CELL);
    for (let i = -r; i <= r; i++) {
      for (let j = -r; j <= r; j++) {
        for (const idx of grid.get(key(cx + i, cz + j)) ?? []) {
          const s = segs[idx];
          const mx = (s.a[0] + s.b[0]) / 2, mz = (s.a[1] + s.b[1]) / 2;
          const d = Math.hypot(mx - px, mz - pz);
          if (d >= rMin && d <= rMax) out.push(s);
        }
      }
    }
    return out;
  }
  // Réapparition : un tronçon à bonne distance, de préférence hors du champ
  // de vision (derrière le joueur ou de côté)
  function respawn(p, player, camDir, first) {
    upgrade(p);
    const cand = nearbySegs(player.x, player.z, first ? 8 : NEAR, FAR);
    if (!cand.length) { p.seg = null; p.h.group.visible = false; return; }
    let pick = null;
    for (let k = 0; k < 6; k++) {
      const s = cand[Math.floor(Math.random() * cand.length)];
      const mx = (s.a[0] + s.b[0]) / 2 - player.x, mz = (s.a[1] + s.b[1]) / 2 - player.z;
      const dist = Math.hypot(mx, mz);
      const facing = (mx * camDir.x + mz * camDir.z) / (dist || 1);
      pick = s;
      // Hors du champ, ou assez loin devant pour que l'apparition se fonde
      // dans la distance : on croise ainsi des passants qui VIENNENT vers soi
      if (first || facing < 0.3 || dist > 60) break;
    }
    p.seg = pick;
    p.t = Math.random();
    p.dir = Math.random() < 0.5 ? 1 : -1;
    p.speed = 1.05 + Math.random() * 0.55;
    p.flee = 0;
    p.h.clearTint?.();
    p.h.group.visible = true;
  }

  let started = false;
  ctx.updatables.push((dt) => {
    const player = ctx.playerPos?.();
    if (!player) return;
    const cam = ctx.camera;
    fwd.set(0, 0, -1);
    if (cam) cam.getWorldDirection(fwd);
    for (const p of people) {
      if (!started || !p.seg) {
        respawn(p, player, fwd, !started);
        continue;
      }
      const s = p.seg;
      p.t += (p.dir * p.speed * dt) / s.len;
      if (p.flee > 0) p.flee -= dt;
      const x = s.a[0] + (s.b[0] - s.a[0]) * p.t, z = s.a[1] + (s.b[1] - s.a[1]) * p.t;
      const far = Math.hypot(x - player.x, z - player.z) > DROP;
      if (p.t < 0 || p.t > 1 || far || (p.flee <= 0 && p.speed > 3)) {
        // Bout de rue : la suite la plus proche si elle existe, sinon recyclé
        respawn(p, player, fwd, false);
        continue;
      }
      // pas encore réaliste : on l'échange dès qu'il est loin (invisible à l'œil)
      if (!p.h.isAvatar && avatarNames.length && Math.abs(x - player.x) + Math.abs(z - player.z) > 45) upgrade(p);
      const g = p.h.group;
      const y = Math.max(0, ctx.terrainHeight?.(x, z) ?? 0);
      g.userData.baseY = y;
      g.position.set(x, y, z);
      look.set(s.b[0] - s.a[0], 0, s.b[1] - s.a[1]).multiplyScalar(p.dir);
      g.rotation.y = Math.atan2(-look.x, -look.z); // regard vers -z au repos
      p.phase += dt * p.speed * 4.2;
      g.userData.far = Math.abs(x - player.x) + Math.abs(z - player.z) > 40;
      p.h.animate(p.phase, p.speed * 2.6);
    }
    started = true;

    // Bulle : suit son passant, puis une nouvelle phrase au plus proche
    if (barkLeft > 0) {
      barkLeft -= dt;
      const g = barkOwner?.h.group;
      if (barkLeft <= 0 || !g?.visible) { bubble.visible = false; barkLeft = 0; }
      else bubble.position.set(g.position.x, g.position.y + 2.15, g.position.z);
    } else if ((barkT -= dt) <= 0) {
      barkT = 7 + Math.random() * 5;
      let best = null, bd = 9;
      for (const p of people) {
        if (!p.seg || !p.h.group.visible) continue;
        const d = Math.hypot(p.h.group.position.x - player.x, p.h.group.position.z - player.z);
        if (d < bd) { bd = d; best = p; }
      }
      if (best) {
        const kind = (ctx.env?.daylight ?? 1) < 0.35 ? 'nuit' : rainAmount() > 0.3 && Math.random() < 0.6 ? 'pluie' : 'jour';
        say(best, pickBark(kind));
      }
    }
  });
  ctx.passersby = { people };
  return { people };
}
