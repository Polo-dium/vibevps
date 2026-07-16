import { WebSocketServer } from 'ws';
import crypto from 'node:crypto';
import { q } from './db.js';
import { bumpDaily } from './daily.js';

const TICK_MS = 66; // ~15 Hz
const QUENELLE_ROUND_MS = 5 * 60 * 1000; // rotation de la Quenelle dorée
const QUENELLE_XP = 150;
const SILURE_ROUND_MS = 4 * 60 * 1000; // passage du silure géant
const SILURE_SWIM_MS = 38 * 1000; // fenêtre où il est attaquable
const SILURE_HP = 400;
const SILURE_XP = 120;
const HIT_DAMAGE = 25;
const HIT_MIN_INTERVAL_MS = 75; // cadence max de l'AK côté serveur
const SHOT_MIN_INTERVAL_MS = 60;
const TAG_HITS_TO_BREAK = 4;
const TAG_HIT_MIN_INTERVAL_MS = 45;
const BOMB_RADIUS = 50;
const BOMB_MIN_INTERVAL_MS = 3000;
const CHAT_RANGE = 32; // portée du chat de proximité (mètres)
const CHAT_MIN_INTERVAL_MS = 500; // anti-spam

/** @type {Map<string, object>} */
const players = new Map();
let wss = null;
let quenelleClaimedRound = -1; // un seul gagnant par tour de Quenelle dorée
let silureRound = -1, silureHp = 0, silureDead = false; // HP partagée du silure
const tagDamage = new Map(); // tagId -> nombre d'impacts reçus

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
          lastTagHitAt: 0,
          lastBombAt: 0,
          lastChatAt: 0,
          lastDamagedAt: 0,
        };
        const others = [...players.entries()].map(([oid, o]) => ({
          id: oid, name: o.name, p: o.p, ry: o.ry,
        }));

        // Lien d'invitation (?ami=Pseudo) : si l'ami est déjà en ligne, on
        // renvoie sa position pour que le nouveau venu atterrisse à côté de
        // lui, et on le prévient directement — l'arrivée par lien devient
        // instantanée, ni recherche ni rendez-vous à l'aveugle.
        let friend = null;
        const wantedAmi = String(msg.ami ?? '').trim().toLowerCase().slice(0, 16);
        if (wantedAmi) {
          for (const [oid, o] of players) {
            if (o.name.toLowerCase() === wantedAmi) { friend = { id: oid, name: o.name, p: o.p }; break; }
          }
        }

        players.set(id, entry);
        ws.send(JSON.stringify({ t: 'hello', id, players: others, friend }));
        broadcast({ t: 'pjoin', id, name: player.name, p: entry.p, ry: 0 }, id);
        if (friend) {
          const friendEntry = players.get(friend.id);
          if (friendEntry?.ws.readyState === friendEntry.ws.OPEN) {
            friendEntry.ws.send(JSON.stringify({ t: 'friendArrived', name: player.name }));
          }
        }
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
        // Véhicule (optionnel) : relayé pour afficher la voiture chez les autres
        // 0 = à pied, 1 = voiture, 2 = avion (champ optionnel, borné)
        me.veh = Math.min(2, Math.max(0, Math.floor(Number(msg.veh) || 0)));
        // Enceinte portable : morceau 1..4, 0 = coupée (optionnel, borné).
        // La quatrième piste est le vrai enregistrement de Clair de Lune.
        me.mus = Math.min(4, Math.max(0, Math.floor(Number(msg.mus) || 0)));
        const vry = Number(msg.vry);
        me.vry = Number.isFinite(vry) ? vry : 0;
        // Assiette de l'avion (champs optionnels rétro-compatibles) : permet
        // aux autres joueurs de voir loopings et tonneaux, pas un avion plat.
        const vpx = Number(msg.vpx), vrz = Number(msg.vrz);
        me.vpx = Number.isFinite(vpx) ? vpx : 0;
        me.vrz = Number.isFinite(vrz) ? vrz : 0;
        me.vjet = me.veh === 2 && msg.vjet ? 1 : 0;
        if (me.vjet) me.lastJetAt = Date.now();
        me.dirty = true;
        return;
      }

      // Trajectoire de balle, relayée aux autres pour les traceurs
      if (msg.t === 'shot') {
        const now = Date.now();
        if (now - me.lastShotAt < SHOT_MIN_INTERVAL_MS) return;
        const a = Array.isArray(msg.a) ? msg.a.map(Number) : null;
        const b = Array.isArray(msg.b) ? msg.b.map(Number) : null;
        if (!a || !b || a.length !== 3 || b.length !== 3) return;
        if ([...a, ...b].some((v) => !Number.isFinite(v) || Math.abs(v) > 2000)) return;
        me.lastShotAt = now;
        const aircraft = me.veh === 2 && msg.aircraft ? 1 : 0;
        broadcast({ t: 'shot', id, a, b, aircraft }, id);
        return;
      }

      // Les graffitis sont de vraies cibles : quatre balles les arrachent,
      // même si leur plan n'est plus posé contre une géométrie de mur. Le
      // serveur garde les dégâts partagés et exige un tir relayé juste avant.
      if (msg.t === 'tagHit') {
        const now = Date.now();
        if (now - me.lastTagHitAt < TAG_HIT_MIN_INTERVAL_MS) return;
        if (now - me.lastShotAt > 800) return;
        const tagId = String(msg.id ?? '');
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(tagId)) return;
        me.lastTagHitAt = now;
        if (!q.tagById.get(tagId)) {
          tagDamage.delete(tagId);
          return;
        }
        const hits = (tagDamage.get(tagId) ?? 0) + 1;
        if (hits < TAG_HITS_TO_BREAK) {
          tagDamage.set(tagId, hits);
          return;
        }
        tagDamage.delete(tagId);
        const info = q.deleteTag.run(tagId);
        if (info.changes) broadcast({ t: 'tagDel', id: tagId });
        return;
      }

      // Bombe du Mirage : le client transmet uniquement le point d'impact,
      // puis le serveur applique lui-même le rayon létal exact de 50 m à
      // tous les joueurs. Une bombe déjà lâchée reste valide si le pilote
      // quitte l'avion pendant sa chute.
      if (msg.t === 'bomb') {
        const now = Date.now();
        if (now - me.lastBombAt < BOMB_MIN_INTERVAL_MS) return;
        if (now - (me.lastJetAt ?? 0) > 15000) return;
        const p = Array.isArray(msg.p) ? msg.p.map(Number) : null;
        if (!p || p.length !== 3) return;
        if (p.some((v) => !Number.isFinite(v) || Math.abs(v) > 4000)) return;
        if (Math.hypot(p[0] - me.p[0], p[1] - me.p[1], p[2] - me.p[2]) > 2800) return;
        me.lastBombAt = now;
        broadcast({ t: 'explosion', p, by: id }, id);

        let awarded = 0;
        for (const [targetId, target] of players) {
          const distance = Math.hypot(
            target.p[0] - p[0], target.p[1] - p[1], target.p[2] - p[2]
          );
          if (distance > BOMB_RADIUS) continue;
          target.hp = 100;
          target.lastDamagedAt = now;
          const selfKill = target === me;
          if (!selfKill) {
            me.kills += 1;
            awarded += 1;
            try {
              q.addScore.run(me.playerId, 'pvp', me.kills, null, now);
              q.addXp.run(50, me.playerId);
              q.bumpKills.run(me.playerId);
              const daily = bumpDaily(me.playerId, 'kill');
              if (daily && me.ws.readyState === me.ws.OPEN) {
                me.ws.send(JSON.stringify({ t: 'daily', ...daily }));
              }
            } catch (err) {
              console.error('Score de bombardement non enregistré :', err);
            }
          }
          broadcast({
            t: 'death',
            id: targetId,
            by: selfKill ? null : id,
            byName: selfKill ? 'sa propre bombe' : me.name,
            victimName: target.name,
            kills: me.kills,
          });
        }
        if (awarded) {
          try {
            broadcast({ t: 'leaderboard', gameId: 'pvp', rows: q.leaderboard.all('pvp') });
          } catch (err) {
            console.error('Classement après bombardement indisponible :', err);
          }
        }
        return;
      }

      // Un joueur déclare avoir touché un autre joueur
      if (msg.t === 'hit') {
        const now = Date.now();
        if (now - me.lastHitAt < HIT_MIN_INTERVAL_MS) return;
        me.lastHitAt = now;

        const target = players.get(String(msg.target ?? ''));
        if (!target || target === me) return;

        // dmg optionnel selon l'arme (marteau → bazooka), borné : combiné à
        // la cadence max, un client trafiqué ne fait pas mieux qu'un bazooka
        const dmg = Math.min(55, Math.max(1, Math.floor(Number(msg.dmg) || HIT_DAMAGE)));
        target.hp -= dmg;
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
            // Défi quotidien « duels » : notifié seulement au tueur (les
            // autres champs de `daily` ne les concernent pas)
            const daily = bumpDaily(me.playerId, 'kill');
            if (daily && me.ws.readyState === me.ws.OPEN) {
              me.ws.send(JSON.stringify({ t: 'daily', ...daily }));
            }
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

      // Dégâts d'environnement auto-déclarés (la Garde Royale des PNJ…).
      // Borné et limité en cadence : au pire un tricheur se suicide.
      if (msg.t === 'ouch') {
        const now = Date.now();
        if (now - (me.lastOuchAt ?? 0) < 350) return;
        me.lastOuchAt = now;
        // Une chute mortelle (saut d'avion sans parachute) tue net : seul ce
        // motif autorise 100 points, les autres restent bornés à 25.
        const cap = msg.cause === 'chute' ? 100 : 25;
        const dmg = Math.min(cap, Math.max(1, Math.floor(Number(msg.dmg) || 0)));
        me.hp -= dmg;
        me.lastDamagedAt = now;
        if (me.hp > 0) {
          broadcast({ t: 'hp', id, hp: me.hp });
        } else {
          me.hp = 100; // respawn
          broadcast({
            t: 'death',
            id,
            by: null,
            byName: String(msg.by ?? 'la ville de Lyon').slice(0, 32),
            victimName: me.name,
            kills: 0,
          });
        }
        return;
      }

      // Quenelle dorée : premier joueur du tour à la réclamer la gagne.
      // Le tour est calé sur Date.now() (même horloge que le client) ; on ne
      // vérifie pas la position (le serveur ne connaît pas le décor) — dégât
      // borné : au pire un tricheur gratte 150 XP toutes les 5 minutes.
      if (msg.t === 'quenelle') {
        const round = Math.floor(Date.now() / QUENELLE_ROUND_MS);
        // Tolérance ±1 tour : l'horloge du joueur peut être décalée de
        // quelques minutes par rapport au serveur — sans ça, il verrait la
        // quenelle mais ne pourrait JAMAIS la gagner. Le serveur reste seul
        // maître du tour effectivement réclamé (le sien).
        const asked = Math.floor(Number(msg.round));
        if (!Number.isFinite(asked) || Math.abs(asked - round) > 1) return;
        if (quenelleClaimedRound === round) {
          if (me.ws.readyState === me.ws.OPEN) {
            me.ws.send(JSON.stringify({ t: 'quenelle', taken: true, round }));
          }
          return;
        }
        quenelleClaimedRound = round;
        try {
          q.addXp.run(QUENELLE_XP, me.playerId);
        } catch (err) {
          console.error('XP quenelle non créditée :', err);
        }
        broadcast({ t: 'quenelle', by: me.name, round, xp: QUENELLE_XP });
        return;
      }

      // Chasse au silure : HP partagée entre tous les joueurs pendant la
      // fenêtre de nage (calée sur Date.now(), comme côté client). Dégâts
      // bornés + cadence limitée : un tricheur ne fait pas mieux qu'un
      // bazooka. Le coup de grâce empoche l'XP.
      if (msg.t === 'silure') {
        const now = Date.now();
        if (now - (me.lastSilureAt ?? 0) < 90) return;
        me.lastSilureAt = now;
        if (now % SILURE_ROUND_MS > SILURE_SWIM_MS) return; // pas dans l'eau
        const round = Math.floor(now / SILURE_ROUND_MS);
        if (round !== silureRound) {
          silureRound = round;
          silureHp = SILURE_HP;
          silureDead = false;
        }
        if (silureDead) return;
        const dmg = Math.min(55, Math.max(1, Math.floor(Number(msg.dmg) || 10)));
        silureHp -= dmg;
        if (silureHp > 0) {
          broadcast({ t: 'silure', hp: silureHp, max: SILURE_HP, round });
        } else {
          silureDead = true;
          try {
            q.addXp.run(SILURE_XP, me.playerId);
          } catch (err) {
            console.error('XP silure non créditée :', err);
          }
          broadcast({ t: 'silure', dead: true, by: me.name, round, xp: SILURE_XP });
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
      states.push([
        pid, ...entry.p.map((v) => Math.round(v * 100) / 100),
        Math.round(entry.ry * 1000) / 1000, entry.m,
        entry.veh ?? 0, Math.round((entry.vry ?? 0) * 1000) / 1000,
        entry.mus ?? 0, // enceinte portable (les vieux clients l'ignorent)
        Math.round((entry.vpx ?? 0) * 1000) / 1000,
        Math.round((entry.vrz ?? 0) * 1000) / 1000,
        entry.vjet ?? 0,
      ]);
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
