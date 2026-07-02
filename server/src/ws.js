import { WebSocketServer } from 'ws';
import crypto from 'node:crypto';
import { q } from './db.js';

const TICK_MS = 66; // ~15 Hz
const HIT_DAMAGE = 25;
const HIT_MIN_INTERVAL_MS = 75; // cadence max de l'AK côté serveur
const SHOT_MIN_INTERVAL_MS = 60;
const CHAT_RANGE = 32; // portée du chat de proximité (mètres)
const CHAT_MIN_INTERVAL_MS = 500; // anti-spam

/** @type {Map<string, object>} */
const players = new Map();
let wss = null;

export function setupWs(httpServer) {
  wss = new WebSocketServer({ server: httpServer, path: '/ws' });

  wss.on('connection', (ws) => {
    let id = null;

    ws.on('message', (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }

      if (msg.t === 'join' && !id) {
        const player = q.playerByToken.get(String(msg.token ?? ''));
        if (!player) {
          ws.send(JSON.stringify({ t: 'error', error: 'Token invalide.' }));
          ws.close();
          return;
        }
        id = crypto.randomUUID().slice(0, 8);
        const entry = {
          ws,
          name: player.name,
          playerId: player.id,
          p: [0, 2, 0],
          ry: 0,
          m: 0,
          dirty: false,
          hp: 100,
          kills: 0,
          lastHitAt: 0,
          lastShotAt: 0,
          lastChatAt: 0,
          lastDamagedAt: 0,
        };
        const others = [...players.entries()].map(([oid, o]) => ({
          id: oid, name: o.name, p: o.p, ry: o.ry,
        }));
        players.set(id, entry);
        ws.send(JSON.stringify({ t: 'hello', id, players: others }));
        broadcast({ t: 'pjoin', id, name: player.name, p: entry.p, ry: 0 }, id);
        return;
      }

      if (!id) return;
      const me = players.get(id);
      if (!me) return;

      if (msg.t === 's') {
        const p = Array.isArray(msg.p) ? msg.p.map(Number) : null;
        const ry = Number(msg.ry);
        if (!p || p.length !== 3 || p.some((v) => !Number.isFinite(v))) return;
        if (!Number.isFinite(ry)) return;
        me.p = p;
        me.ry = ry;
        me.m = msg.m ? 1 : 0;
        me.dirty = true;
        return;
      }

      // Trajectoire de balle, relayée aux autres pour les traceurs
      if (msg.t === 'shot') {
        const now = Date.now();
        if (now - me.lastShotAt < SHOT_MIN_INTERVAL_MS) return;
        me.lastShotAt = now;
        const a = Array.isArray(msg.a) ? msg.a.map(Number) : null;
        const b = Array.isArray(msg.b) ? msg.b.map(Number) : null;
        if (!a || !b || a.length !== 3 || b.length !== 3) return;
        if ([...a, ...b].some((v) => !Number.isFinite(v) || Math.abs(v) > 2000)) return;
        broadcast({ t: 'shot', id, a, b }, id);
        return;
      }

      // Un joueur déclare avoir touché un autre joueur
      if (msg.t === 'hit') {
        const now = Date.now();
        if (now - me.lastHitAt < HIT_MIN_INTERVAL_MS) return;
        me.lastHitAt = now;

        const target = players.get(String(msg.target ?? ''));
        if (!target || target === me) return;

        target.hp -= HIT_DAMAGE;
        target.lastDamagedAt = now;
        if (target.hp > 0) {
          broadcast({ t: 'hp', id: msg.target, hp: target.hp, by: id });
        } else {
          target.hp = 100; // respawn
          me.kills += 1;
          try {
            q.addScore.run(me.playerId, 'pvp', me.kills, null, Date.now());
            q.addXp.run(50, me.playerId);
            q.bumpKills.run(me.playerId);
            broadcast({ t: 'leaderboard', gameId: 'pvp', rows: q.leaderboard.all('pvp') });
          } catch (err) {
            console.error('Score PvP non enregistré :', err);
          }
          broadcast({
            t: 'death',
            id: msg.target,
            by: id,
            byName: me.name,
            victimName: target.name,
            kills: me.kills,
          });
        }
        return;
      }

      // Signalisation WebRTC (chat vocal) : relais point à point
      if (msg.t === 'rtc') {
        const target = players.get(String(msg.to ?? ''));
        if (target && target.ws.readyState === target.ws.OPEN) {
          target.ws.send(JSON.stringify({ t: 'rtc', from: id, data: msg.data }));
        }
        return;
      }

      // Chat de proximité : message visible par les joueurs proches uniquement
      if (msg.t === 'chat') {
        const now = Date.now();
        if (now - me.lastChatAt < CHAT_MIN_INTERVAL_MS) return;
        let text = String(msg.text ?? '').replace(/\s+/g, ' ').trim().slice(0, 120);
        if (!text) return;
        me.lastChatAt = now;
        const payload = JSON.stringify({ t: 'chat', id, name: me.name, text });
        for (const [pid, other] of players) {
          if (pid === id) continue;
          const dx = other.p[0] - me.p[0];
          const dz = other.p[2] - me.p[2];
          if (dx * dx + dz * dz <= CHAT_RANGE * CHAT_RANGE &&
              other.ws.readyState === other.ws.OPEN) {
            other.ws.send(payload);
          }
        }
        return;
      }
    });

    ws.on('close', () => {
      if (id && players.delete(id)) {
        broadcast({ t: 'pleave', id });
      }
    });
    ws.on('error', () => {});
  });

  setInterval(() => {
    const states = [];
    for (const [pid, entry] of players) {
      if (!entry.dirty) continue;
      entry.dirty = false;
      states.push([pid, ...entry.p.map((v) => Math.round(v * 100) / 100), Math.round(entry.ry * 1000) / 1000, entry.m]);
    }
    if (states.length > 0) broadcast({ t: 'states', s: states });
  }, TICK_MS);

  // Régénération de vie hors combat : +8 pv/s après 6 s sans dégâts.
  // Envoyé uniquement au joueur concerné (pas de flash chez les autres).
  setInterval(() => {
    const now = Date.now();
    for (const [pid, entry] of players) {
      if (entry.hp >= 100 || entry.hp <= 0) continue;
      if (now - entry.lastDamagedAt < 6000) continue;
      entry.hp = Math.min(100, entry.hp + 8);
      if (entry.ws.readyState === entry.ws.OPEN) {
        entry.ws.send(JSON.stringify({ t: 'hp', id: pid, hp: entry.hp, regen: true }));
      }
    }
  }, 1000);
}

export function broadcast(obj, exceptId = null) {
  if (!wss) return;
  const data = JSON.stringify(obj);
  for (const [pid, entry] of players) {
    if (pid === exceptId) continue;
    if (entry.ws.readyState === entry.ws.OPEN) entry.ws.send(data);
  }
}
