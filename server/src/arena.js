import { ARENA, arenaBoxes, BASES, TEAM_SPAWNS, FFA_SPAWNS, MEDS, CRATE } from '../../shared/arena-layout.js';
import { NADE, stepNade } from '../../shared/arena-nade.js';

// ARÈNE DE BELLECOUR — MATCHS ET BOTS (autoritatif, côté serveur)
//
// Dès qu'un joueur entre dans l'arène (x ≈ 20000, voir world/hifi.js), une
// partie tourne : mêlée générale, match à mort par équipes, capture du
// drapeau, « snipers » et « couteaux ». Les bots sont simulés ICI et
// diffusés comme de simples joueurs (pjoin / states / shot) : les clients
// les affichent et leur tirent dessus sans code dédié. Un joueur qui arrive
// prend la place d'un bot ; les équipes sont rééquilibrées à chaque manche.
//
// Les bots marchent au sol sur une grille de 1 m (A*), voient par lancer de
// rayon sur les MÊMES boîtes que les collisions du client
// (shared/arena-layout.js), et tirent avec un temps de réaction et une
// précision qui dépendent de la difficulté.

const OX = ARENA.OFFSET;
export const MODES = ['ffa', 'tdm', 'ctf', 'zone', 'sniper', 'couteau'];
const MODE_INFO = {
  ffa: { teams: false, dur: 240, lim: 20 },
  tdm: { teams: true, dur: 300, lim: 25 },
  ctf: { teams: true, dur: 360, lim: 3 },
  zone: { teams: true, dur: 300, lim: 80 }, // zone à tenir : 1 point par seconde de contrôle
  sniper: { teams: false, dur: 240, lim: 15 },
  couteau: { teams: false, dur: 180, lim: 12 },
};
const INTER_MS = 12000;
const RESPAWN_MS = 3000;
const SPAWN_SHIELD_MS = 1800;
// (10 à 17 = armes de la 2e fournée ; grenade et quenelle hors de la plage des armes tenues)
const WPN = { ak: 1, sniper: 8, couteau: 9, lance: 17, grenade: 100, quenelle: 101 };

// Difficulté : facile → réaliste
const DIFFS = [
  { nom: 'facile', acc: 0.16, react: 950, speed: 3.4, view: 45, dmg: 12, pause: [900, 1700], strafe: false, hunt: 0.25, xp: 8, fov: 0.2 },
  { nom: 'normal', acc: 0.3, react: 560, speed: 4.0, view: 62, dmg: 16, pause: [600, 1200], strafe: false, hunt: 0.45, xp: 12, fov: 0.0 },
  { nom: 'difficile', acc: 0.46, react: 330, speed: 4.6, view: 85, dmg: 20, pause: [400, 900], strafe: true, hunt: 0.65, xp: 18, fov: -0.2 },
  { nom: 'réaliste', acc: 0.6, react: 220, speed: 5.0, view: 110, dmg: 20, pause: [300, 700], strafe: true, hunt: 0.8, xp: 25, fov: -0.35 },
];

const BOT_NAMES = [
  'Gnafron', 'Madelon', 'Canut', 'Mâchon', 'Grattons', 'Rosette', 'Bugne', 'Praline',
  'Cervelle', 'Tablier', 'Coussin', 'Fenotte', 'Gadagne', 'Mourguet', 'Jacquard', 'Sapeur',
];

// --- Grille de navigation ---------------------------------------------------
const GX = ARENA.W, GZ = ARENA.D;
const BOXES = arenaBoxes();
const blocked = new Uint8Array(GX * GZ);
const cellX = (i) => -GX / 2 + i + 0.5;
const cellZ = (j) => -GZ / 2 + j + 0.5;
const toI = (x) => Math.max(0, Math.min(GX - 1, Math.floor(x + GX / 2)));
const toJ = (z) => Math.max(0, Math.min(GZ - 1, Math.floor(z + GZ / 2)));
{
  const R = 0.55; // rayon d'un bot + marge
  for (let j = 0; j < GZ; j++) {
    for (let i = 0; i < GX; i++) {
      const x = cellX(i), z = cellZ(j);
      let b = i < 2 || j < 2 || i >= GX - 2 || j >= GZ - 2 ? 1 : 0;
      if (!b) {
        for (const o of BOXES) {
          if (o.y0 < 1.4 && o.y1 > 0.3 && x > o.x0 - R && x < o.x1 + R && z > o.z0 - R && z < o.z1 + R) { b = 1; break; }
        }
      }
      blocked[j * GX + i] = b;
    }
  }
}
const isBlocked = (x, z) => blocked[toJ(z) * GX + toI(x)] === 1;

// Case libre la plus proche (spirale)
function freeNear(x, z) {
  if (!isBlocked(x, z)) return [x, z];
  for (let r = 1; r < 12; r++) {
    for (let a = 0; a < 16; a++) {
      const nx = x + Math.cos(a * Math.PI / 8) * r, nz = z + Math.sin(a * Math.PI / 8) * r;
      if (Math.abs(nx) < GX / 2 - 2 && Math.abs(nz) < GZ / 2 - 2 && !isBlocked(nx, nz)) return [nx, nz];
    }
  }
  return [0, 30];
}

// Ligne droite praticable au sol ?
function walkable(x0, z0, x1, z1) {
  const d = Math.hypot(x1 - x0, z1 - z0);
  const n = Math.max(1, Math.ceil(d / 0.45));
  for (let k = 1; k <= n; k++) {
    const t = k / n;
    if (isBlocked(x0 + (x1 - x0) * t, z0 + (z1 - z0) * t)) return false;
  }
  return true;
}

// A* (8 voisins, pas de coin coupé), tas binaire sur tableaux typés
const gScore = new Float32Array(GX * GZ);
const came = new Int32Array(GX * GZ);
const stamp = new Uint32Array(GX * GZ);
const closed = new Uint32Array(GX * GZ);
let stampId = 0;
function findPath(x0, z0, x1, z1) {
  [x0, z0] = freeNear(x0, z0);
  [x1, z1] = freeNear(x1, z1);
  if (walkable(x0, z0, x1, z1)) return [[x1, z1]];
  const start = toJ(z0) * GX + toI(x0), goal = toJ(z1) * GX + toI(x1);
  stampId++;
  const heap = [], hf = [];
  const push = (n, f) => {
    let i = heap.length;
    heap.push(n); hf.push(f);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (hf[p] <= f) break;
      heap[i] = heap[p]; hf[i] = hf[p];
      i = p;
    }
    heap[i] = n; hf[i] = f;
  };
  const pop = () => {
    const top = heap[0];
    const n = heap.pop(), f = hf.pop();
    const len = heap.length;
    if (len > 0) {
      let i = 0;
      for (;;) {
        let c = i * 2 + 1;
        if (c >= len) break;
        if (c + 1 < len && hf[c + 1] < hf[c]) c++;
        if (hf[c] >= f) break;
        heap[i] = heap[c]; hf[i] = hf[c];
        i = c;
      }
      heap[i] = n; hf[i] = f;
    }
    return top;
  };
  const gi = goal % GX, gj = (goal / GX) | 0;
  const h = (n) => {
    const dx = Math.abs((n % GX) - gi), dz = Math.abs(((n / GX) | 0) - gj);
    return Math.max(dx, dz) + 0.4142 * Math.min(dx, dz);
  };
  gScore[start] = 0; stamp[start] = stampId; came[start] = -1;
  push(start, h(start));
  let found = false, guard = 0;
  while (heap.length && guard++ < 9000) {
    const cur = pop();
    if (cur === goal) { found = true; break; }
    if (closed[cur] === stampId) continue;
    closed[cur] = stampId;
    const ci = cur % GX, cj = (cur / GX) | 0;
    for (let dj = -1; dj <= 1; dj++) {
      for (let di = -1; di <= 1; di++) {
        if (!di && !dj) continue;
        const ni = ci + di, nj = cj + dj;
        if (ni < 0 || nj < 0 || ni >= GX || nj >= GZ) continue;
        const n = nj * GX + ni;
        if (blocked[n] || closed[n] === stampId) continue;
        if (di && dj && (blocked[cj * GX + ni] || blocked[nj * GX + ci])) continue;
        const g = gScore[cur] + (di && dj ? 1.4142 : 1);
        if (stamp[n] !== stampId || g < gScore[n]) {
          stamp[n] = stampId; gScore[n] = g; came[n] = cur;
          push(n, g + h(n));
        }
      }
    }
  }
  if (!found) return [[x1, z1]];
  const cells = [];
  for (let n = goal; n !== -1 && n !== start; n = came[n]) cells.push(n);
  cells.reverse();
  // Lissage : on saute au point le plus lointain atteignable en ligne droite
  const pts = cells.map((n) => [cellX(n % GX), cellZ((n / GX) | 0)]);
  pts.push([x1, z1]);
  const out = [];
  let px = x0, pz = z0, i = 0;
  while (i < pts.length) {
    let k = Math.min(pts.length - 1, i + 14);
    while (k > i && !walkable(px, pz, pts[k][0], pts[k][1])) k--;
    out.push(pts[k]);
    [px, pz] = pts[k];
    i = k + 1;
  }
  return out;
}

// Ligne de tir 3D dégagée ? (segment contre toutes les boîtes)
function clearShot(ax, ay, az, bx, by, bz) {
  const dx = bx - ax, dy = by - ay, dz = bz - az;
  for (const o of BOXES) {
    let t0 = 0, t1 = 1;
    if (Math.abs(dx) < 1e-6) { if (ax < o.x0 || ax > o.x1) continue; } else {
      let a = (o.x0 - ax) / dx, b = (o.x1 - ax) / dx;
      if (a > b) [a, b] = [b, a];
      t0 = Math.max(t0, a); t1 = Math.min(t1, b);
      if (t0 > t1) continue;
    }
    if (Math.abs(dz) < 1e-6) { if (az < o.z0 || az > o.z1) continue; } else {
      let a = (o.z0 - az) / dz, b = (o.z1 - az) / dz;
      if (a > b) [a, b] = [b, a];
      t0 = Math.max(t0, a); t1 = Math.min(t1, b);
      if (t0 > t1) continue;
    }
    if (Math.abs(dy) < 1e-6) { if (ay < o.y0 || ay > o.y1) continue; } else {
      let a = (o.y0 - ay) / dy, b = (o.y1 - ay) / dy;
      if (a > b) [a, b] = [b, a];
      t0 = Math.max(t0, a); t1 = Math.min(t1, b);
      if (t0 > t1) continue;
    }
    return false;
  }
  return true;
}

const rnd = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const yawTo = (dx, dz) => Math.atan2(-dx, -dz); // même convention que la caméra des joueurs

export function createArena({ players, broadcast, q }) {
  const cfg = { mode: 'ffa', bots: 4, diff: 1, chain: 'rotation' };
  const parts = new Map(); // id -> participant (humain ou bot)
  const bots = new Map();  // id -> bot (aussi dans parts)
  let round = null;        // { mode, st, endAt, sc, flags, win }
  let nextMode = null;     // mode demandé à la console pour la manche suivante
  let botSeq = 0;
  let lastSnap = 0, lastCfgAt = 0, tickN = 0;

  const info = () => MODE_INFO[round?.mode ?? cfg.mode];
  const humans = () => [...parts.values()].filter((p) => !p.bot);
  const sendTo = (id, obj) => {
    const e = players.get(id);
    if (e?.ws.readyState === e.ws.OPEN) e.ws.send(JSON.stringify(obj));
  };
  const sendArena = (obj) => {
    const data = JSON.stringify(obj);
    for (const p of parts.values()) {
      if (p.bot) continue;
      const e = players.get(p.id);
      if (e?.ws.readyState === e.ws.OPEN) e.ws.send(data);
    }
  };

  // Position d'un combattant en repère local { x, y, z }
  const posOf = (p) => {
    if (p.bot) return p;
    const e = players.get(p.id);
    // (accroupi : la silhouette visée est 45 cm plus basse)
    return e ? { x: e.p[0] - OX, y: e.p[1] - (e.cr ? 0.45 : 0), z: e.p[2], low: e.cr ? 1 : 0 } : null;
  };
  const enemies = (a, b) => a !== b && (!info().teams || a.team !== b.team);

  // --- Équipes ---------------------------------------------------------------
  function teamCounts(onlyHumans = false) {
    const c = [0, 0];
    for (const p of parts.values()) if (p.team >= 0 && (!onlyHumans || !p.bot)) c[p.team]++;
    return c;
  }
  function smallerTeam(forHuman) {
    const h = teamCounts(true), t = teamCounts(false);
    if (forHuman && h[0] !== h[1]) return h[0] < h[1] ? 0 : 1;
    if (t[0] !== t[1]) return t[0] < t[1] ? 0 : 1;
    return Math.random() < 0.5 ? 0 : 1;
  }
  // Équilibrage de début de manche : humains répartis en serpent d'après
  // leur score de la manche précédente, puis les bots comblent.
  function dealTeams() {
    if (!info().teams) {
      for (const p of parts.values()) p.team = -1;
      return;
    }
    for (const p of parts.values()) p.team = -1;
    const hs = humans().sort((a, b) => (b.lastK ?? 0) - (a.lastK ?? 0) || Math.random() - 0.5);
    const first = Math.random() < 0.5 ? 0 : 1;
    hs.forEach((p, i) => { p.team = (i % 4 === 0 || i % 4 === 3) ? first : 1 - first; });
    for (const b of bots.values()) b.team = smallerTeam(false);
  }
  function rebalanceBots() {
    if (!info().teams) return;
    for (let guard = 0; guard < 12; guard++) {
      const t = teamCounts(false);
      if (Math.abs(t[0] - t[1]) < 2) break;
      const from = t[0] > t[1] ? 0 : 1;
      const b = [...bots.values()].find((x) => x.team === from && round?.flags?.[1 - from]?.by !== x.id);
      if (!b) break;
      b.team = 1 - from;
      killBotSilently(b);
    }
  }

  // --- Points d'apparition -----------------------------------------------------
  function spawnFor(p) {
    let cands = p.team >= 0 ? TEAM_SPAWNS[p.team] : FFA_SPAWNS;
    let best = null, bestD = -1;
    for (const [x, z] of cands) {
      let d = 1e9;
      for (const o of parts.values()) {
        if (!enemies(p, o) || (o.bot && !o.alive)) continue;
        const op = posOf(o);
        if (op) d = Math.min(d, Math.hypot(op.x - x, op.z - z));
      }
      d += Math.random() * 6;
      if (d > bestD) { bestD = d; best = [x, z]; }
    }
    const [x, z] = freeNear(best[0] + rnd(-1.5, 1.5), best[1] + rnd(-1.5, 1.5));
    return { x, z, ry: yawTo(-x, -z) };
  }
  function respawnBot(b, now) {
    const sp = spawnFor(b);
    Object.assign(b, {
      x: sp.x, z: sp.z, y: 0, ry: sp.ry, hp: 100, alive: true, path: null, target: null,
      shieldUntil: now + SPAWN_SHIELD_MS, nextFireAt: now + 600, burst: 0, repathAt: 0,
      nf: 1, ns: 0, nadeAt: now + rnd(8000, 20000), // une seule grenade par vie pour un bot
    });
  }
  function killBotSilently(b) {
    dropFlagOf(b.id, Date.now());
    b.alive = false;
    b.respawnAt = Date.now() + 1200;
  }

  // --- Effectif : un joueur qui entre prend la place d'un bot ----------------
  function syncBots(now) {
    const want = round ? Math.max(0, Math.min(10, cfg.bots + 1 - humans().length)) : 0;
    while (bots.size > want) {
      const b = [...bots.values()].sort((a, c) => a.k - c.k)[0];
      dropFlagOf(b.id, now);
      bots.delete(b.id);
      parts.delete(b.id);
      broadcast({ t: 'pleave', id: b.id });
    }
    while (bots.size < want) {
      const used = new Set([...bots.values()].map((b) => b.base));
      const base = BOT_NAMES.find((n) => !used.has(n)) ?? `Gone ${botSeq}`;
      const b = {
        id: `bot${(botSeq++).toString(36)}`, bot: true, base, name: `🤖 ${base}`,
        team: -1, k: 0, d: 0, caps: 0, x: 0, y: 0, z: 0, ry: 0, hp: 100, alive: true,
        seed: Math.random(),
      };
      b.team = info().teams ? smallerTeam(false) : -1;
      bots.set(b.id, b);
      parts.set(b.id, b);
      respawnBot(b, now);
      broadcast({ t: 'pjoin', id: b.id, name: b.name, p: [b.x + OX, 0, b.z], ry: b.ry, bot: 1 });
    }
    rebalanceBots();
  }

  // --- Manches -----------------------------------------------------------------
  function startRound(mode, now) {
    const m = MODE_INFO[mode] ? mode : 'ffa';
    cfg.mode = m;
    nextMode = null;
    crate.at = now + 25000;
    round = {
      mode: m, st: 'play', endAt: now + MODE_INFO[m].dur * 1000, sc: [0, 0], win: null,
      flags: m === 'ctf' ? BASES.map((b) => ({ st: 0, x: b.x, z: b.z, by: null, dropAt: 0 })) : null,
      zone: m === 'zone' ? { i: -1, x: 0, z: 0, owner: -1, moveAt: 0, acc: 0 } : null,
    };
    if (round.zone) moveZone(now);
    for (const p of parts.values()) { p.lastK = p.k; p.k = 0; p.d = 0; p.caps = 0; p.streak = 0; p.armor = 0; giveNades(p); sendInv(p); }
    nades.length = smokes.length = pending.length = 0;
    dealTeams();
    syncBots(now);
    for (const b of bots.values()) respawnBot(b, now);
    for (const p of humans()) {
      const e = players.get(p.id);
      if (e) e.hp = 100;
      p.shieldUntil = now + SPAWN_SHIELD_MS;
      const sp = spawnFor(p);
      sendTo(p.id, { t: 'arenaSpawn', p: [sp.x + OX, 0.2, sp.z], ry: sp.ry, start: 1 });
    }
    sendTop();
    snapshot(now, true);
  }
  function endRound(now) {
    const m = round.mode;
    round.st = 'inter';
    round.endAt = now + INTER_MS;
    const ranked = [...parts.values()].sort((a, b) => b.k - a.k || a.d - b.d);
    if (info().teams) {
      round.win = round.sc[0] === round.sc[1] ? { draw: 1 } : { team: round.sc[0] > round.sc[1] ? 0 : 1 };
    } else {
      round.win = ranked[0] ? { id: ranked[0].id, name: ranked[0].name } : { draw: 1 };
    }
    // Classement du mode : meilleur score d'une manche (kills + 3 par drapeau)
    for (const p of humans()) {
      const e = players.get(p.id);
      const score = p.k + p.caps * 3;
      if (!e || score <= 0) continue;
      try {
        q.addScore.run(e.playerId, `arena_${m}`, score, null, now);
        const won = info().teams ? round.win.team === p.team : round.win.id === p.id;
        q.addXp.run(won ? 60 : 20, e.playerId);
      } catch (err) {
        console.error('Score d\'arène non enregistré :', err);
      }
    }
    const order = cfg.chain === 'meme' ? m : MODES[(MODES.indexOf(m) + 1) % MODES.length];
    round.next = nextMode ?? order;
    sendTop();
    snapshot(now, true);
  }
  function sendTop(toId = null) {
    const m = round?.mode ?? cfg.mode;
    let rows = [];
    try { rows = q.leaderboard.all(`arena_${m}`).slice(0, 8).map((r) => [r.name, r.score]); } catch { /* base indisponible */ }
    const msg = { t: 'arenaTop', mode: m, rows };
    if (toId) sendTo(toId, msg); else sendArena(msg);
  }
  function snapshot(now, force = false) {
    if (!round) return;
    if (!force && now - lastSnap < 1000) return;
    lastSnap = now;
    sendArena({
      t: 'arena', mode: round.mode, st: round.st, left: Math.max(0, Math.ceil((round.endAt - now) / 1000)),
      lim: info().lim, teams: info().teams ? 1 : 0, sc: round.sc, win: round.win, next: round.next ?? null,
      b: [...parts.values()].map((p) => [p.id, p.name, p.team, p.k, p.d, p.bot ? 1 : 0, p.caps]),
      f: round.flags?.map((f) => [f.st, Math.round(f.x * 10) / 10, Math.round(f.z * 10) / 10, f.by]) ?? null,
      z: round.zone ? [Math.round(round.zone.x * 10) / 10, Math.round(round.zone.z * 10) / 10, ZONE_R, round.zone.owner, Math.max(0, Math.ceil((round.zone.moveAt - now) / 1000))] : null,
      m: meds.map((m) => (now >= m.at ? 1 : 0)),
      c: crateOn(now) ? 1 : 0,
      cfg: { ...cfg, next: nextMode },
    });
  }

  // --- Rosettes de soin ----------------------------------------------------------
  // Quatre caisses dans les allées : +50 PV au premier blessé qui passe
  // dessus (joueur ou bot), de retour 25 s plus tard. État dans l'instantané
  // `arena` (champ `m`), ramassage annoncé par `aevt` `med`.
  const MED_HEAL = 50, MED_BACK = 25000;
  const meds = MEDS.map(([x, z]) => ({ x, z, at: 0 }));
  function tickMeds(now) {
    for (let i = 0; i < meds.length; i++) {
      const m = meds[i];
      if (now < m.at) continue;
      for (const p of parts.values()) {
        const e = p.bot ? null : players.get(p.id);
        const hp = p.bot ? (p.alive ? p.hp : 0) : (e?.hp ?? 0);
        if (hp <= 0 || hp >= 100) continue;
        const q = posOf(p);
        if (!q || Math.hypot(q.x - m.x, q.z - m.z) > 1.7) continue;
        const nh = Math.min(100, hp + MED_HEAL);
        if (p.bot) p.hp = nh; else e.hp = nh;
        sendArena({ t: 'hp', id: p.id, hp: nh, regen: 1 });
        sendArena({ t: 'aevt', k: 'med', i, id: p.id, name: p.name });
        m.at = now + MED_BACK;
        break;
      }
    }
  }

  // --- Caisse du Gros Caillou ----------------------------------------------------
  // Au pied de la statue : la première fois 25 s après le début de la manche,
  // puis 50 s après chaque ramassage. Le premier JOUEUR qui passe dessus
  // reçoit le minigun pour sa vie en cours (côté client : `aevt` `crate`).
  // Pas en modes snipers / couteaux. Champ `c` de l'instantané `arena`.
  const crate = { at: Infinity };
  const crateOn = (now) => round?.st === 'play' && round.mode !== 'sniper' && round.mode !== 'couteau' && now >= crate.at;
  function tickCrate(now) {
    if (!crateOn(now)) return;
    for (const p of parts.values()) {
      if (p.bot) continue;
      const e = players.get(p.id);
      if (!e || e.hp <= 0) continue;
      const q = posOf(p);
      if (!q || Math.hypot(q.x - CRATE.x, q.z - CRATE.z) > 1.8) continue;
      crate.at = now + 50000;
      sendArena({ t: 'aevt', k: 'crate', id: p.id, name: p.name });
      break;
    }
  }

  // --- Zone à tenir ------------------------------------------------------------
  // Un cercle de 7 m qui change de place toutes les 45 s. L'équipe qui y a
  // le plus de monde marque 1 point par seconde ; à égalité, personne.
  const ZONE_R = 7;
  const ZONE_SPOTS = [[-30, -12], [30, 12], [0, -19], [0, 19], [-48, 17], [48, -17], [-16, 4], [16, -4]];
  function moveZone(now) {
    const z = round.zone;
    let i = z.i;
    while (i === z.i) i = Math.floor(Math.random() * ZONE_SPOTS.length);
    z.i = i;
    [z.x, z.z] = freeNear(ZONE_SPOTS[i][0], ZONE_SPOTS[i][1]);
    z.moveAt = now + 45000;
    z.owner = -1;
    sendArena({ t: 'aevt', k: 'zone' });
  }
  function tickZone(now) {
    const z = round.zone;
    if (now >= z.moveAt) moveZone(now);
    const inside = [0, 0];
    for (const c of parts.values()) {
      if (c.team < 0 || (c.bot && !c.alive) || now < (c.shieldUntil ?? 0) - SPAWN_SHIELD_MS) continue;
      const cp = posOf(c);
      if (cp && (cp.y ?? 0) < 1.6 && Math.hypot(cp.x - z.x, cp.z - z.z) < ZONE_R) inside[c.team]++;
    }
    z.owner = inside[0] === inside[1] ? (inside[0] ? 2 : -1) : inside[0] > inside[1] ? 0 : 1;
    if (z.owner === 0 || z.owner === 1) {
      z.acc += 0.066;
      if (z.acc >= 1) { z.acc -= 1; round.sc[z.owner]++; }
    }
  }

  // --- Drapeaux ----------------------------------------------------------------
  const TEAM_NAMES = ['ROUGE', 'BLEUE'];
  function dropFlagOf(id, now) {
    if (!round?.flags) return;
    for (const f of round.flags) {
      if (f.by !== id) continue;
      const p = parts.get(id);
      const pp = p && posOf(p);
      if (pp) [f.x, f.z] = freeNear(pp.x, pp.z);
      f.st = 2; f.by = null; f.dropAt = now;
      sendArena({ t: 'aevt', k: 'drop', team: round.flags.indexOf(f) });
    }
  }
  function tickFlags(now) {
    const fl = round.flags;
    for (let t = 0; t < 2; t++) {
      const f = fl[t];
      if (f.st === 1) {
        const c = parts.get(f.by);
        const cp = c && posOf(c);
        if (!cp || (c.bot && !c.alive)) { dropFlagOf(f.by, now); continue; }
        f.x = cp.x; f.z = cp.z;
      } else if (f.st === 2 && now - f.dropAt > 15000) {
        f.st = 0; f.x = BASES[t].x; f.z = BASES[t].z;
        sendArena({ t: 'aevt', k: 'back', team: t });
      }
    }
    for (const c of parts.values()) {
      if (c.team < 0 || (c.bot && !c.alive)) continue;
      const cp = posOf(c);
      if (!cp || cp.y > 1.6) continue;
      cp.y = Math.max(cp.y, 0);
      const own = fl[c.team], foe = fl[1 - c.team];
      if (foe.st !== 1 && Math.hypot(cp.x - foe.x, cp.z - foe.z) < 1.9) {
        foe.st = 1; foe.by = c.id;
        sendArena({ t: 'aevt', k: 'take', team: 1 - c.team, name: c.name });
      }
      if (own.st === 2 && Math.hypot(cp.x - own.x, cp.z - own.z) < 1.9) {
        own.st = 0; own.x = BASES[c.team].x; own.z = BASES[c.team].z;
        sendArena({ t: 'aevt', k: 'back', team: c.team, name: c.name });
      }
      // (capture validée même si son propre drapeau est en vadrouille :
      // pas de face-à-face bloqué entre deux porteurs)
      if (foe.by === c.id &&
          Math.hypot(cp.x - BASES[c.team].x, cp.z - BASES[c.team].z) < 2.6) {
        foe.st = 0; foe.by = null; foe.x = BASES[1 - c.team].x; foe.z = BASES[1 - c.team].z;
        round.sc[c.team]++;
        c.caps++;
        sendArena({ t: 'aevt', k: 'cap', team: c.team, name: c.name });
        if (!c.bot) {
          const e = players.get(c.id);
          try { if (e) q.addXp.run(40, e.playerId); } catch { /* tant pis */ }
        }
      }
    }
  }

  // --- Grenades, fumigènes, frappes ---------------------------------------------
  const nades = [];   // en vol : { id, k, by, x, y, z, vx, vy, vz, at }
  const smokes = [];  // nuages : { x, z, until }
  const pending = []; // explosions programmées (frappe de quenelles) : { at, x, y, z, by, w }
  let nadeSeq = 0;
  const giveNades = (p) => { p.nf = NADE.perLife.f; p.ns = NADE.perLife.s; };
  const sendInv = (p) => { if (!p.bot) sendTo(p.id, { t: 'nadeInv', f: p.nf ?? 0, s: p.ns ?? 0, armor: p.armor ?? 0 }); };
  // Le segment a→b traverse-t-il un nuage ? (distance point-segment, en plan)
  function smokeBlocks(ax, az, bx, bz, now) {
    for (const sm of smokes) {
      if (now > sm.until) continue;
      const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz || 1;
      const t = Math.max(0, Math.min(1, ((sm.x - ax) * dx + (sm.z - az) * dz) / l2));
      if (Math.hypot(ax + dx * t - sm.x, az + dz * t - sm.z) < NADE.smokeR * 0.8) return true;
    }
    return false;
  }
  // Départ d'une grenade (joueur ou bot) : décompte, annonce, mise en vol
  function nadeStart(pp, d) {
    const l = Math.hypot(d[0], d[1], d[2]) || 1;
    return {
      x: pp.x + (d[0] / l) * 0.5, y: (pp.y ?? 0) + 1.5, z: pp.z + (d[2] / l) * 0.5,
      vx: (d[0] / l) * NADE.speed, vy: (d[1] / l) * NADE.speed + NADE.lift, vz: (d[2] / l) * NADE.speed,
    };
  }
  function launch(part, k, d, now) {
    const pp = posOf(part);
    if (!pp) return;
    part.lastNadeAt = now;
    if (k === 's') part.ns--; else part.nf--;
    sendInv(part);
    const n = { id: `n${(nadeSeq++).toString(36)}`, k, by: part.id, ...nadeStart(pp, d), at: now + NADE.fuse[k] * 1000 };
    sendArena({
      t: 'nade', id: n.id, k, by: part.id,
      p: [Math.round((n.x + OX) * 100) / 100, Math.round(n.y * 100) / 100, Math.round(n.z * 100) / 100],
      v: [n.vx, n.vy, n.vz].map((v) => Math.round(v * 100) / 100),
    });
    nades.push(n);
  }
  // Visée d'un bot : il essaie sept inclinaisons, simule chaque lancer
  // jusqu'à l'explosion (rebonds compris) et garde celle qui finit le plus
  // près de la cible — ou renonce si rien n'arrive à moins de 4 m.
  function aimNade(from, to) {
    const dx = to.x - from.x, dz = to.z - from.z, d = Math.hypot(dx, dz) || 1;
    let best = null, bd = 4;
    for (let i = 0; i < 7; i++) {
      const pitch = -0.15 + i * 0.13;
      const dir = [dx / d * Math.cos(pitch), Math.sin(pitch), dz / d * Math.cos(pitch)];
      const n = nadeStart(from, dir);
      for (let t = 0; t < NADE.fuse.f; t += 0.1) stepNade(n, 0.1, BOXES);
      const miss = Math.hypot(n.x - to.x, n.z - to.z);
      // jamais une grenade qui lui reviendrait dans les pieds
      if (miss < bd && Math.hypot(n.x - from.x, n.z - from.z) > NADE.radius * 0.8) { bd = miss; best = dir; }
    }
    return best;
  }

  // Explosion : dégâts qui décroissent avec la distance, arrêtés par les
  // obstacles — amis, ennemis et lanceur compris (tir ami oblige)
  function explode(x, y, z, byId, weapon, now) {
    const thrower = parts.get(byId) ?? null;
    for (const t of [...parts.values()]) {
      if (t.bot && !t.alive) continue;
      if (now < (t.shieldUntil ?? 0)) continue;
      const tp = posOf(t);
      if (!tp) continue;
      const ty = (tp.y ?? 0) + 1.0;
      const d = Math.hypot(tp.x - x, ty - y, tp.z - z);
      if (d > NADE.radius) continue;
      if (!clearShot(x, y + 0.35, z, tp.x, ty, tp.z)) continue;
      const dmg = Math.round(NADE.damage * (1 - d / NADE.radius));
      if (dmg <= 0) continue;
      if (t.bot) damageBot(thrower, t, dmg, now, weapon);
      else damageHumanBy(thrower, t, dmg, now, weapon);
    }
  }
  function tickNades(now) {
    for (let i = nades.length - 1; i >= 0; i--) {
      const n = nades[i];
      stepNade(n, 0.066, BOXES);
      if (now < n.at) continue;
      nades.splice(i, 1);
      const p = [Math.round((n.x + OX) * 100) / 100, Math.round(n.y * 100) / 100, Math.round(n.z * 100) / 100];
      sendArena({ t: 'boom', id: n.id, k: n.k, p });
      if (n.k === 's') smokes.push({ x: n.x, z: n.z, until: now + NADE.smokeDur * 1000 });
      else explode(n.x, n.y, n.z, n.by, WPN.grenade, now);
    }
    for (let i = pending.length - 1; i >= 0; i--) {
      if (now < pending[i].at) continue;
      const e = pending.splice(i, 1)[0];
      explode(e.x, e.y, e.z, e.by, e.w, now);
    }
    for (let i = smokes.length - 1; i >= 0; i--) if (now > smokes[i].until) smokes.splice(i, 1);
  }

  // --- Séries d'éliminations (joueurs) -----------------------------------------
  // 3 d'affilée : drone-pigeon (ennemis révélés 12 s, côté client) ;
  // 5 : frappe de quenelles (6 impacts sur les adversaires) ;
  // 7 : armure de canut (100 points qui encaissent avant la vie).
  function onStreak(k, now) {
    k.streak = (k.streak ?? 0) + 1;
    if (k.streak !== 3 && k.streak !== 5 && k.streak !== 7) return;
    sendArena({ t: 'aevt', k: 'streak', n: k.streak, id: k.id, name: k.name });
    if (k.streak === 5) {
      const foes = [...parts.values()].filter((o) => enemies(k, o) && !(o.bot && !o.alive));
      for (let i = 0; i < 6 && foes.length; i++) {
        const tp = posOf(foes[i % foes.length]);
        if (!tp) continue;
        const [x, z] = [tp.x + rnd(-2.5, 2.5), tp.z + rnd(-2.5, 2.5)];
        const delay = 1100 + i * 380;
        sendArena({ t: 'boom', k: 'q', p: [Math.round((x + OX) * 100) / 100, 0.1, Math.round(z * 100) / 100], in: delay });
        pending.push({ at: now + delay, x, y: 0.1, z, by: k.id, w: WPN.quenelle });
      }
    } else if (k.streak === 7) {
      k.armor = 100;
      sendInv(k);
    }
  }
  // L'armure encaisse d'abord ; rend les dégâts qui passent à la vie
  function absorb(part, dmg) {
    if (!part || !(part.armor > 0)) return dmg;
    const taken = Math.min(part.armor, dmg);
    part.armor -= taken;
    sendInv(part);
    return dmg - taken;
  }

  // --- Morts et scores ---------------------------------------------------------
  // Retourne le point de réapparition si la victime est un humain de l'arène
  function registerKill(killer, victim, now, weapon) {
    victim.d++;
    dropFlagOf(victim.id, now);
    const counted = killer && killer !== victim && round?.st === 'play';
    // TIR AMI : descendre un coéquipier coûte une élimination et un point…
    const tk = Boolean(counted && info().teams && killer.team === victim.team);
    if (counted && tk) {
      killer.k = Math.max(0, killer.k - 1);
      if (round.mode !== 'ctf' && round.mode !== 'zone') round.sc[killer.team] = Math.max(0, round.sc[killer.team] - 1);
    } else if (counted) {
      killer.k++;
      if (!killer.bot) onStreak(killer, now);
      if (info().teams && round.mode !== 'ctf' && round.mode !== 'zone' && killer.team >= 0) round.sc[killer.team]++;
    }
    sendArena({
      t: 'akill', by: killer?.id ?? null, byName: killer?.name ?? null,
      v: victim.id, vName: victim.name, w: weapon ?? 0,
      bt: killer?.team ?? -1, vt: victim.team, tk: tk ? 1 : undefined,
    });
    // … et la QUENELLE DU KARMA s'abat sur le traître (50 points de vie)
    if (tk && !killer.bot) karma(killer, now);
    snapshot(now, true);
    if (victim.bot) {
      victim.alive = false;
      victim.respawnAt = now + RESPAWN_MS;
      victim.target = null;
      return null;
    }
    victim.shieldUntil = now + RESPAWN_MS + SPAWN_SHIELD_MS;
    victim.streak = 0;
    victim.armor = 0;
    giveNades(victim);
    sendInv(victim);
    const sp = spawnFor(victim);
    return { p: [sp.x + OX, 0.2, sp.z], ry: sp.ry };
  }

  const KARMA = 'la quenelle du karma';
  function karma(part, now) {
    const e = players.get(part.id);
    if (!e) return;
    sendArena({ t: 'aevt', k: 'tk', id: part.id, name: part.name });
    e.hp -= 50;
    e.lastDamagedAt = now;
    if (e.hp > 0) {
      sendArena({ t: 'hp', id: part.id, hp: e.hp });
      return;
    }
    e.hp = 100;
    const sp = registerKill(null, part, now, 0);
    sendTo(part.id, { t: 'death', id: part.id, by: null, byName: KARMA, victimName: part.name, kills: 0, sp });
  }
  const OUCH = ['Hé ! C\'est moi, banane !', 'Oh le gone, on est ensemble !', 'Vise les autres, fenotte !', 'Aïe ! Change de lunettes !', 'Traître ! Je le dirai à Guignol.'];

  // Bouclier de la lance (code 17) : la cible regarde-t-elle vers `from` ?
  function shieldBlocks(e, from) {
    if (!e || e.wpn !== 17 || !e.p || !from) return false;
    const dx = from[0] - e.p[0], dz = from[2] - e.p[2], l = Math.hypot(dx, dz) || 1;
    return (-Math.sin(e.ry ?? 0) * dx - Math.cos(e.ry ?? 0) * dz) / l > 0.42;
  }
  function damageHuman(bot, part, dmg, now) {
    // Balle de bot dans le bouclier : arrêtée net ; couteau : 40 %
    const e = players.get(part.id);
    if (shieldBlocks(e, [bot.x + OX, 0, bot.z])) {
      if (bot.wpn !== WPN.couteau) { sendArena({ t: 'blk', id: part.id, by: bot.id }); return; }
      dmg = Math.ceil(dmg * 0.4);
    }
    damageHumanBy(bot, part, dmg, now, bot.wpn);
  }
  // Dégâts infligés à un humain par n'importe qui (bot, grenade d'un autre
  // joueur ou la sienne, frappe) — `by` peut être null
  function damageHumanBy(by, part, dmg0, now, weapon) {
    const e = players.get(part.id);
    if (!e) return;
    const dmg = absorb(part, dmg0);
    if (dmg <= 0) return;
    e.hp -= dmg;
    e.lastDamagedAt = now;
    if (e.hp > 0) {
      sendArena({ t: 'hp', id: part.id, hp: e.hp, by: by?.id ?? null });
      return;
    }
    e.hp = 100;
    const self = by === part;
    const sp = registerKill(self ? null : by, part, now, weapon);
    sendTo(part.id, {
      t: 'death', id: part.id, by: self ? null : by?.id ?? null,
      byName: self ? 'ta propre grenade' : by?.name ?? 'une explosion', victimName: part.name,
      kills: by?.k ?? 0, sp,
    });
    if (by && !by.bot && !self) {
      sendTo(by.id, { t: 'death', id: part.id, by: by.id, byName: by.name, victimName: part.name, kills: by.k, xp: 0 });
    }
  }
  function damageBot(killer, b, dmg, now, weapon) {
    if (!b.alive || now < (b.shieldUntil ?? 0)) return;
    // un coéquipier lui tire dessus : il râle (bulle au-dessus de sa tête)
    if (killer && !killer.bot && info().teams && killer.team === b.team && now - (b.lastOuchAt ?? 0) > 2500) {
      b.lastOuchAt = now;
      sendArena({ t: 'chat', id: b.id, name: b.name, text: pick(OUCH) });
    }
    b.hp -= dmg;
    b.lastDamagedAt = now;
    b.hurtBy = killer?.id ?? null;
    if (b.hp > 0) {
      sendArena({ t: 'hp', id: b.id, hp: b.hp, by: killer?.id ?? null });
      return;
    }
    const mate = Boolean(killer && info().teams && killer.team === b.team);
    registerKill(killer, b, now, weapon);
    if (killer && !killer.bot && !mate) { // (pas de récompense pour un tir ami)
      const e = players.get(killer.id);
      const xp = DIFFS[cfg.diff].xp;
      try { if (e) q.addXp.run(xp, e.playerId); } catch { /* tant pis */ }
      sendTo(killer.id, {
        t: 'death', id: b.id, by: killer.id, byName: killer.name, victimName: b.name,
        kills: killer.k, xp,
      });
    }
  }

  // --- IA des bots ---------------------------------------------------------------
  // Arme AFFICHÉE du bot (modèle en main, son, icône du fil) : variée d'un
  // bot à l'autre parmi les fusils d'assaut — ses dégâts ne changent pas.
  const BOT_GUNS = [WPN.ak, 10, 11, 12, 13]; // AK, MP5, M16, M4, FAMAS
  function botWeapon(b) {
    if (round.mode === 'sniper') return WPN.sniper;
    if (round.mode === 'couteau') return WPN.couteau;
    return BOT_GUNS[Math.floor((b?.seed ?? 0) * 997) % BOT_GUNS.length];
  }
  function chooseGoal(b, D, now) {
    // amoché : la rosette libre la plus proche d'abord (pas les bots faciles)
    if (b.hp < 45 && cfg.diff > 0) {
      let best = null, bd = 45;
      for (const m of meds) {
        const d = Math.hypot(m.x - b.x, m.z - b.z);
        if (now >= m.at && d < bd) { bd = d; best = m; }
      }
      if (best) return [best.x, best.z];
    }
    if (round.zone) {
      // chacun vise un point à lui dans le cercle (pas tous au centre)
      const a = b.seed * Math.PI * 2, r = ZONE_R * 0.7 * ((b.seed * 7) % 1);
      return [round.zone.x + Math.cos(a) * r, round.zone.z + Math.sin(a) * r];
    }
    const fl = round.flags;
    if (fl) {
      const own = fl[b.team], foe = fl[1 - b.team];
      if (foe.by === b.id) return [BASES[b.team].x, BASES[b.team].z];
      if (own.st === 2) return [own.x, own.z];
      if (own.st === 1 && b.seed > 0.3) return [own.x, own.z]; // on chasse le voleur
      const attacker = b.seed < 0.65;
      if (attacker) return foe.st === 1 ? [BASES[b.team].x + rnd(-8, 8), BASES[b.team].z + rnd(-8, 8)] : [foe.x, foe.z];
      if (own.st === 1) return [own.x, own.z]; // défenseur : chasse le voleur
      return [BASES[b.team].x + rnd(-14, 14) * (b.team ? -1 : 1) + (b.team ? -6 : 6), rnd(-16, 16)];
    }
    // Chasse : vers l'ennemi le plus proche (les bons bots « entendent » le combat)
    if (round.mode === 'couteau' || Math.random() < D.hunt) {
      let best = null, bd = 1e9;
      for (const o of parts.values()) {
        if (!enemies(b, o) || (o.bot && !o.alive)) continue;
        const op = posOf(o);
        if (!op) continue;
        const d = Math.hypot(op.x - b.x, op.z - b.z);
        if (d < bd) { bd = d; best = op; }
      }
      if (best) return [best.x + rnd(-4, 4), best.z + rnd(-4, 4)];
    }
    const [x, z] = pick(FFA_SPAWNS);
    return [x + rnd(-5, 5), z + rnd(-5, 5)];
  }

  function tickBot(b, dt, now, think) {
    const D = DIFFS[cfg.diff];
    b.wpn = botWeapon(b);
    if (!b.alive) {
      if (now >= b.respawnAt) respawnBot(b, now);
      return;
    }
    if (b.hp < 100 && now - (b.lastDamagedAt ?? 0) > 6000) b.hp = Math.min(100, b.hp + 8 * dt);

    // Perception (un tick sur trois, décalé d'un bot à l'autre)
    if (think) {
      let best = null, bd = 1e9;
      const fx = -Math.sin(b.ry), fz = -Math.cos(b.ry);
      for (const o of parts.values()) {
        if (!enemies(b, o) || (o.bot && !o.alive)) continue;
        if (now < (o.shieldUntil ?? 0)) continue;
        const op = posOf(o);
        if (!op) continue;
        const dx = op.x - b.x, dz = op.z - b.z;
        const d = Math.hypot(dx, dz);
        if (d > D.view) continue;
        // champ de vision (sauf tout près, ou si c'est lui qui vient de me toucher)
        const inFov = d < 7 || o.id === b.hurtBy || (dx * fx + dz * fz) / (d || 1) > D.fov;
        if (!inFov) continue;
        if (!clearShot(b.x, 1.55, b.z, op.x, (op.y ?? 0) + 1.2, op.z)) continue;
        if (smokeBlocks(b.x, b.z, op.x, op.z, now)) continue; // nuage de fumigène entre nous
        const score = d - (o.id === b.target ? 6 : 0) - (o.id === b.hurtBy ? 8 : 0);
        if (score < bd) { bd = score; best = o; }
      }
      if (best?.id !== b.target) {
        b.target = best?.id ?? null;
        if (best) b.reactAt = now + D.react * rnd(0.8, 1.3);
      }
      if (best) b.lastSeenAt = now;
    }
    const tgt = b.target ? parts.get(b.target) : null;
    const tp = tgt ? posOf(tgt) : null;
    const melee = b.wpn === WPN.couteau;
    const sniper = b.wpn === WPN.sniper;

    let moving = true;
    if (tp) {
      const dx = tp.x - b.x, dz = tp.z - b.z;
      const d = Math.hypot(dx, dz);
      b.ry = yawTo(dx, dz);
      if (melee) {
        // foncer dessus
        if (now >= b.repathAt) { b.path = findPath(b.x, b.z, tp.x, tp.z); b.pathI = 0; b.repathAt = now + 500; }
        if (d < 2.8 && now >= b.nextFireAt && now >= b.reactAt) {
          b.nextFireAt = now + rnd(550, 800) + (3 - cfg.diff) * 120;
          sendArena({ t: 'shot', id: b.id, a: [b.x + OX, 1.3, b.z], b: [tp.x + OX, (tp.y ?? 0) + 1.2, tp.z], melee: 1 });
          if (Math.random() < 0.45 + D.acc * 0.8) hurt(b, tgt, cfg.diff >= 2 ? 50 : 34, now);
        }
      } else {
        const keep = sniper ? 60 : 20;
        // Capture du drapeau : l'objectif passe avant le duel — attaquants et
        // porteur continuent d'avancer en tirant, seuls les défenseurs tiennent
        const objective = (round.flags && (b.seed < 0.65 || round.flags.some((f) => f.by === b.id))) ||
          // zone à tenir : on y va d'abord, on se bat une fois dedans
          (round.zone && Math.hypot(b.x - round.zone.x, b.z - round.zone.z) > 5);
        if (d < keep && !objective) {
          // en position : on s'arrête (ou on mitraille en pas de côté)
          moving = false;
          if (D.strafe && !sniper) {
            if (now > (b.strafeUntil ?? 0)) { b.strafeDir = Math.random() < 0.5 ? -1 : 1; b.strafeUntil = now + rnd(700, 1500); }
            const sx = -dz / (d || 1) * b.strafeDir, sz = dx / (d || 1) * b.strafeDir;
            const nx = b.x + sx * D.speed * 0.6 * dt, nz = b.z + sz * D.speed * 0.6 * dt;
            if (!isBlocked(nx + sx * 0.5, nz + sz * 0.5)) { b.x = nx; b.z = nz; b.moved = true; } else b.strafeDir *= -1;
          }
          b.path = null;
        } else if (now >= b.repathAt) {
          const g = objective ? chooseGoal(b, D, now) : [tp.x, tp.z];
          b.path = findPath(b.x, b.z, g[0], g[1]); b.pathI = 0; b.repathAt = now + 900;
        }
        // Grenade : à partir de « normal », quand la cible est à bonne portée
        // et plutôt immobile (planquée) — de plus en plus souvent avec la difficulté
        if (think && !sniper && cfg.diff >= 1 && b.nf > 0 && now >= b.nadeAt && now >= b.reactAt &&
            d > 9 && d < 30 && (tgt.speed ?? 0) < 3) {
          b.nadeAt = now + [0, 40000, 24000, 15000][cfg.diff] * rnd(0.8, 1.4);
          const dir = aimNade(b, { x: tp.x, z: tp.z });
          if (dir) launch(b, 'f', dir, now);
        }
        if (now >= b.reactAt && now >= b.nextFireAt) {
          const tSpeed = tgt.speed ?? 0;
          let p = D.acc * Math.max(0.25, Math.min(1, 1 - d / (sniper ? 260 : 95)));
          if (tSpeed > 2.5) p *= 0.7;
          if (tp.low) p *= 0.8; // cible accroupie : plus petite
          if (moving) p *= 0.7;
          if (sniper) {
            p *= 0.75;
            b.nextFireAt = now + rnd(1900, 2600) + (3 - cfg.diff) * 350;
          } else if (b.burst > 0) {
            b.burst--;
            b.nextFireAt = now + 110;
          } else {
            b.burst = 3 + Math.floor(Math.random() * 4);
            b.nextFireAt = now + rnd(D.pause[0], D.pause[1]);
          }
          const hit = Math.random() < p;
          const ty = (tp.y ?? 0) + 1.2;
          const miss = hit ? 0.12 : rnd(0.5, 1.7);
          const a = Math.random() * Math.PI * 2;
          sendArena({
            t: 'shot', id: b.id, a: [b.x + OX, 1.5, b.z],
            b: [tp.x + OX + Math.cos(a) * miss, ty + Math.sin(a) * miss * 0.6, tp.z + Math.sin(a) * miss],
          });
          if (hit) {
            const head = cfg.diff === 3 && Math.random() < 0.18;
            hurt(b, tgt, sniper ? 100 : Math.round(D.dmg * (head ? 1.5 : 1)), now);
          }
        }
      }
    } else if (!b.path || b.pathI >= b.path.length || now >= b.repathAt + 6000) {
      if (now >= b.repathAt) {
        const g = chooseGoal(b, D, now);
        b.path = findPath(b.x, b.z, g[0], g[1]);
        b.pathI = 0;
        b.repathAt = now + (round.flags || round.zone ? 1500 : 1200);
      }
    } else if ((round.flags || round.zone) && now >= b.repathAt) {
      // les objectifs bougent : on recalcule régulièrement
      const g = chooseGoal(b, D, now);
      b.path = findPath(b.x, b.z, g[0], g[1]);
      b.pathI = 0;
      b.repathAt = now + 1500;
    }

    // Déplacement le long du chemin
    b.moved = b.moved || false;
    if (moving && b.path && b.pathI < b.path.length) {
      const [wx, wz] = b.path[b.pathI];
      const dx = wx - b.x, dz = wz - b.z;
      const d = Math.hypot(dx, dz);
      const speed = D.speed * (melee ? 1.12 : 1) * (round.flags?.some((f) => f.by === b.id) ? 0.9 : 1);
      const step = speed * dt;
      if (d <= step) { b.x = wx; b.z = wz; b.pathI++; } else {
        b.x += (dx / d) * step; b.z += (dz / d) * step;
      }
      if (!tp && d > 0.05) b.ry = yawTo(dx, dz);
      b.moved = true;
    }
  }
  function hurt(bot, tgt, dmg, now) {
    if (now < (tgt.shieldUntil ?? 0)) return;
    // entre bots, les balles pèsent moins lourd : sinon la manche se joue sans les joueurs
    if (tgt.bot) damageBot(bot, tgt, Math.ceil(dmg * 0.4), now, bot.wpn);
    else damageHuman(bot, tgt, dmg, now);
  }

  // --- API pour ws.js ------------------------------------------------------------
  return {
    isBot: (id) => bots.has(id),
    shieldBlocks,
    // Bots déjà en jeu, pour le message `hello` d'un nouveau connecté
    roster: () => [...bots.values()].map((b) => ({ id: b.id, name: b.name, p: [b.x + OX, b.alive ? 0 : -60, b.z], ry: b.ry, bot: 1 })),

    tick(now) {
      const dt = 0.066;
      tickN++;
      // Qui est dans l'arène ? (d'après les positions reçues)
      for (const [id, e] of players) {
        const inside = e.p[0] > OX - 400 && e.p[0] < OX + 400;
        const part = parts.get(id);
        if (inside && !part) {
          const p = { id, bot: false, name: e.name, team: -1, k: 0, d: 0, caps: 0, shieldUntil: now + SPAWN_SHIELD_MS };
          giveNades(p);
          parts.set(id, p);
          sendInv(p);
          if (!round) startRound(nextMode ?? cfg.mode, now);
          else {
            if (info().teams) p.team = smallerTeam(true);
            syncBots(now);
            const sp = spawnFor(p);
            sendTo(id, { t: 'arenaSpawn', p: [sp.x + OX, 0.2, sp.z], ry: sp.ry, start: 0 });
            sendTop(id);
            snapshot(now, true);
          }
        } else if (!inside && part) {
          this.leave(id, now);
        } else if (part) {
          // vitesse au sol (les bots visent moins bien une cible qui court)
          const lx = part.lx ?? e.p[0], lz = part.lz ?? e.p[2];
          part.speed = (part.speed ?? 0) * 0.7 + (Math.hypot(e.p[0] - lx, e.p[2] - lz) / dt) * 0.3;
          part.lx = e.p[0]; part.lz = e.p[2];
        }
      }
      if (!round) return;
      if (round.st === 'play') {
        let i = 0;
        for (const b of bots.values()) tickBot(b, dt, now, (tickN + i++) % 3 === 0);
        if (round.flags) tickFlags(now);
        if (round.zone) tickZone(now);
        tickNades(now);
        tickMeds(now);
        tickCrate(now);
        const top = info().teams ? Math.max(round.sc[0], round.sc[1])
          : Math.max(0, ...[...parts.values()].map((p) => p.k));
        if (now >= round.endAt || top >= info().lim) endRound(now);
      } else if (now >= round.endAt) {
        startRound(round.next ?? cfg.mode, now);
      }
      snapshot(now);
    },

    // États des bots à joindre au message `states`
    states() {
      const out = [];
      for (const b of bots.values()) {
        if (!b.moved && b.alive && !b.dirtyOnce) { /* immobile : on envoie quand même le cap */ }
        b.moved = false;
        out.push([
          b.id, Math.round((b.x + OX) * 100) / 100, b.alive ? 0 : -60, Math.round(b.z * 100) / 100,
          Math.round(b.ry * 1000) / 1000, 0, 0, 0, 0, 0, 0, 0, b.wpn ?? 0, 0,
        ]);
      }
      return out;
    },

    leave(id, now = Date.now()) {
      const part = parts.get(id);
      if (!part || part.bot) return;
      dropFlagOf(id, now);
      parts.delete(id);
      if (humans().length === 0) {
        // Plus personne : la partie s'arrête, les bots rentrent au dépôt
        for (const b of bots.values()) broadcast({ t: 'pleave', id: b.id });
        bots.clear();
        parts.clear();
        round = null;
        return;
      }
      syncBots(now);
      snapshot(now, true);
    },

    // Un humain de l'arène peut-il blesser cette cible avec ce qu'il a en main ?
    allowHit(attackerId, targetId, now) {
      const a = parts.get(attackerId), t = parts.get(targetId);
      if (!a && !t) return true; // rien à voir avec l'arène
      if (!a || !t || !round || round.st !== 'play') return false;
      if (a === t) return false; // (tir ami autorisé : voir la quenelle du karma)
      if (now < (t.shieldUntil ?? 0)) return false;
      const e = players.get(attackerId);
      if (round.mode === 'sniper' && e?.wpn !== WPN.sniper) return false;
      if (round.mode === 'couteau') {
        if (e?.wpn !== WPN.couteau) return false;
        const ap = posOf(a), tp = posOf(t);
        if (!ap || !tp || Math.hypot(ap.x - tp.x, ap.z - tp.z) > 5) return false;
      }
      return true;
    },
    hitBot(attackerId, botId, dmg, now) {
      const a = parts.get(attackerId), b = bots.get(botId);
      if (!a || !b) return;
      const e = players.get(attackerId);
      damageBot(a, b, dmg, now, e?.wpn ?? 0);
    },
    // Un humain de l'arène vient de mourir (tué par un autre humain ou tout
    // seul) : score + point de réapparition à joindre au message `death`
    playerDied(victimId, killerId, now) {
      const v = parts.get(victimId);
      if (!v) return null;
      const k = killerId ? parts.get(killerId) : null;
      const e = k && players.get(killerId);
      return registerKill(k ?? null, v, now, e?.wpn ?? 0);
    },

    // Lancer de grenade ('f') ou de fumigène ('s') : { k, d: [dx,dy,dz] regard }
    throwNade(id, msg, now) {
      const part = parts.get(id);
      if (!part || !round || round.st !== 'play') return;
      if (round.mode === 'couteau' || round.mode === 'sniper') return; // modes à arme imposée
      if (now - (part.lastNadeAt ?? 0) < 700) return;
      const k = msg.k === 's' ? 's' : 'f';
      if (!((k === 's' ? part.ns : part.nf) > 0)) return;
      const d = Array.isArray(msg.d) ? msg.d.map(Number) : null;
      if (!d || d.length !== 3 || d.some((v) => !Number.isFinite(v))) return;
      launch(part, k, d, now);
    },
    // Dégâts d'un humain sur un humain (ws.js) : l'armure de canut encaisse d'abord
    absorb(targetId, dmg) { return absorb(parts.get(targetId), dmg); },

    // Console de match : { mode, bots, diff, chain, go }
    configure(id, msg, now) {
      if (!parts.has(id) || now - lastCfgAt < 400) return;
      lastCfgAt = now;
      if (MODES.includes(msg.mode)) nextMode = msg.mode;
      const nb = Math.floor(Number(msg.bots));
      if (nb >= 1 && nb <= 10) cfg.bots = nb;
      const nd = Math.floor(Number(msg.diff));
      if (nd >= 0 && nd <= 3) cfg.diff = nd;
      if (msg.chain === 'meme' || msg.chain === 'rotation') cfg.chain = msg.chain;
      if (msg.go) {
        startRound(nextMode ?? cfg.mode, now);
        sendArena({ t: 'aevt', k: 'cfg', name: parts.get(id).name });
        return;
      }
      if (round?.st === 'inter') round.next = nextMode ?? round.next;
      syncBots(now);
      snapshot(now, true);
    },
  };
}
