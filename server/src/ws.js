import { WebSocketServer } from 'ws';
import crypto from 'node:crypto';
import { q } from './db.js';

const TICK_MS = 66; // ~15 Hz

/** @type {Map<string, {ws: import('ws').WebSocket, name: string, p: number[], ry: number, m: number, dirty: boolean}>} */
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
          p: [0, 2, 0],
          ry: 0,
          m: 0,
          dirty: false,
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

      if (msg.t === 's') {
        const entry = players.get(id);
        if (!entry) return;
        const p = Array.isArray(msg.p) ? msg.p.map(Number) : null;
        const ry = Number(msg.ry);
        if (!p || p.length !== 3 || p.some((v) => !Number.isFinite(v))) return;
        if (!Number.isFinite(ry)) return;
        entry.p = p;
        entry.ry = ry;
        entry.m = msg.m ? 1 : 0;
        entry.dirty = true;
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
}

export function broadcast(obj, exceptId = null) {
  if (!wss) return;
  const data = JSON.stringify(obj);
  for (const [pid, entry] of players) {
    if (pid === exceptId) continue;
    if (entry.ws.readyState === entry.ws.OPEN) entry.ws.send(data);
  }
}
