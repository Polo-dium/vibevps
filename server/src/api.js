import { Router } from 'express';
import crypto from 'node:crypto';
import { db, q, insertTagWithLimit } from './db.js';
import { aiAvailable, generateGame } from './ai.js';
import { broadcast } from './ws.js';
import { bumpDaily, getDailyStatus } from './daily.js';

export const api = Router();

const GAME_COOLDOWN_MS = 120_000;
const MAX_CUSTOM_GAMES = 30;
const MAX_IMAGE_BYTES = 400_000;
const INVENTORY_ITEMS = new Set([
  'jetpack', 'rc-plane', 'radio',
  'weapon:marteau', 'weapon:pompe', 'weapon:minigun', 'weapon:bazooka',
  'weapon:akimbo', // double pistolets (hors quête d'arsenal, volontairement)
  'weapon:sniper', // fusil de précision (idem)
  // École de pilotage : brevets délivrés côté client (progression douce,
  // pas d'enjeu compétitif), conservés avec le compte.
  'brevet-rc', 'brevet-avion',
]);
const ARSENAL_ITEMS = [
  'weapon:marteau', 'weapon:pompe', 'weapon:minigun', 'weapon:bazooka', 'radio',
];
const ARSENAL_XP = 150;

function playerInventory(player) {
  try {
    const items = JSON.parse(player?.inventory || '[]');
    return Array.isArray(items)
      ? [...new Set(items.filter((id) => typeof id === 'string' && INVENTORY_ITEMS.has(id)))]
      : [];
  } catch {
    return [];
  }
}

function auth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  const player = token ? q.playerByToken.get(token) : null;
  if (!player) return res.status(401).json({ error: 'Non authentifié.' });
  req.player = player;
  next();
}

function validImageDataUrl(data) {
  return (
    typeof data === 'string' &&
    /^data:image\/(png|webp);base64,[A-Za-z0-9+/=]+$/.test(data) &&
    data.length <= MAX_IMAGE_BYTES
  );
}

// --- Joueurs -------------------------------------------------------------

// Le code secret (facultatif) protège le pseudo : haché avec l'id du joueur
// en sel, jamais stocké en clair.
function hashPin(playerId, pin) {
  return crypto.createHash('sha256').update(`${playerId}:${pin}`).digest('hex');
}
function validPin(pin) {
  return typeof pin === 'string' && pin.length >= 4 && pin.length <= 24;
}

api.post('/register', (req, res) => {
  const name = String(req.body?.name ?? '').trim();
  const pin = String(req.body?.pin ?? '').trim();
  if (!/^[\p{L}\p{N} _.-]{2,16}$/u.test(name)) {
    return res.status(400).json({ error: 'Pseudo invalide (2 à 16 caractères).' });
  }
  if (pin && !validPin(pin)) {
    return res.status(400).json({ error: 'Code secret : 4 à 24 caractères.' });
  }
  const existing = q.playerByName.get(name);
  if (existing) {
    // Pseudo protégé + bon code secret → c'est une CONNEXION
    if (pin && existing.pin_hash && existing.pin_hash === hashPin(existing.id, pin)) {
      return res.json({
        id: existing.id, name: existing.name, token: existing.token,
        inventory: playerInventory(existing),
        arsenalQuest: existing.arsenal_quest ?? 0,
      });
    }
    return res.status(409).json({
      error: existing.pin_hash
        ? 'Ce pseudo est protégé — entre son code secret pour le récupérer.'
        : 'Ce pseudo est déjà pris.',
    });
  }
  const id = crypto.randomUUID();
  const token = crypto.randomBytes(24).toString('hex');
  q.createPlayer.run(id, name, token, Date.now());
  if (pin) q.setPin.run(hashPin(id, pin), id);
  res.json({ id, name, token, inventory: [], arsenalQuest: 0 });
});

// Protéger (ou changer le code de) son pseudo une fois connecté
api.post('/me/pin', auth, (req, res) => {
  const pin = String(req.body?.pin ?? '').trim();
  if (!validPin(pin)) {
    return res.status(400).json({ error: 'Code secret : 4 à 24 caractères.' });
  }
  q.setPin.run(hashPin(req.player.id, pin), req.player.id);
  res.json({ ok: true });
});

api.get('/me', auth, (req, res) => {
  res.json({
    id: req.player.id,
    name: req.player.name,
    admin: Boolean(req.player.is_admin),
    protected: Boolean(req.player.pin_hash),
    inventory: playerInventory(req.player),
    arsenalQuest: req.player.arsenal_quest ?? 0,
  });
});

// Un objet est ajouté une seule fois. Le serveur garde la source de vérité
// afin que l'inventaire suive un pseudo protégé sur un nouvel appareil.
api.post('/me/inventory', auth, (req, res) => {
  const id = String(req.body?.id ?? '');
  if (!INVENTORY_ITEMS.has(id)) {
    return res.status(400).json({ error: 'Objet inconnu.' });
  }
  const inventory = playerInventory(req.player);
  if (!inventory.includes(id)) {
    inventory.push(id);
    q.setInventory.run(JSON.stringify(inventory), req.player.id);
  }
  res.json({ ok: true, inventory });
});

// Quête de l'armurier : le serveur vérifie les quatre armes et la radio avant de
// verser la récompense. L'UPDATE conditionnel rend les +150 XP impossibles à
// réclamer deux fois, même avec deux requêtes simultanées.
api.post('/quests/arsenal', auth, (req, res) => {
  const action = String(req.body?.action ?? '');
  let xpGain = 0;
  if (action === 'start') {
    q.startArsenalQuest.run(req.player.id);
  } else if (action === 'complete') {
    const fresh = q.playerById.get(req.player.id);
    if ((fresh?.arsenal_quest ?? 0) < 1) {
      return res.status(409).json({ error: 'Parle d’abord à l’armurier.' });
    }
    const inventory = playerInventory(fresh);
    const missing = ARSENAL_ITEMS.filter((id) => !inventory.includes(id));
    if (missing.length) {
      return res.status(409).json({ error: 'Il reste de l’équipement à retrouver.', missing });
    }
    const info = q.completeArsenalQuest.run(ARSENAL_XP, req.player.id);
    if (info.changes) xpGain = ARSENAL_XP;
  } else {
    return res.status(400).json({ error: 'Action de quête inconnue.' });
  }
  const player = q.playerById.get(req.player.id);
  res.json({
    ok: true,
    status: player.arsenal_quest ?? 0,
    xp: player.xp,
    xpGain,
  });
});

// --- Administration -------------------------------------------------------

function adminOnly(req, res, next) {
  if (!req.player.is_admin) return res.status(403).json({ error: 'Réservé aux admins.' });
  next();
}

api.post('/admin/login', auth, (req, res) => {
  const key = process.env.ADMIN_KEY;
  if (!key) {
    return res.status(503).json({ error: "ADMIN_KEY n'est pas configurée sur le serveur." });
  }
  if (String(req.body?.key ?? '') !== key) {
    return res.status(403).json({ error: 'Clé admin incorrecte.' });
  }
  q.setAdmin.run(req.player.id);
  res.json({ ok: true });
});

api.delete('/tags/:id', auth, adminOnly, (req, res) => {
  const info = q.deleteTag.run(req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: 'Tag introuvable.' });
  broadcast({ t: 'tagDel', id: req.params.id });
  res.json({ ok: true });
});

api.delete('/tags', auth, adminOnly, (req, res) => {
  const info = q.deleteAllTags.run();
  broadcast({ t: 'tagsClear' });
  res.json({ ok: true, deleted: info.changes });
});

// --- État du monde -------------------------------------------------------

api.get('/state', (req, res) => {
  const games = q.listGames.all();
  const leaderboards = {};
  for (const g of games) leaderboards[g.id] = q.leaderboard.all(g.id);
  res.json({ games, tags: q.listTags.all(), leaderboards });
});

api.get('/games/:id', (req, res) => {
  const game = q.gameById.get(req.params.id);
  if (!game) return res.status(404).json({ error: 'Borne introuvable.' });
  res.json({
    id: game.id,
    title: game.title,
    builtin: Boolean(game.builtin),
    html: game.builtin ? null : game.html,
  });
});

// --- Scores --------------------------------------------------------------

api.post('/scores', auth, (req, res) => {
  const { gameId, score, accuracy } = req.body ?? {};
  const game = q.gameById.get(String(gameId ?? ''));
  if (!game) return res.status(404).json({ error: 'Borne introuvable.' });

  const s = Math.floor(Number(score));
  if (!Number.isFinite(s) || s < 0 || s > 1_000_000_000) {
    return res.status(400).json({ error: 'Score invalide.' });
  }
  let acc = null;
  if (accuracy !== undefined && accuracy !== null) {
    acc = Number(accuracy);
    if (!Number.isFinite(acc) || acc < 0 || acc > 100) acc = null;
  }

  q.addScore.run(req.player.id, game.id, s, acc, Date.now());
  // XP proportionnelle au score, bornée pour rester saine
  const xpGain = Math.max(2, Math.min(80, Math.floor(s / 100)));
  q.addXp.run(xpGain, req.player.id);
  const leaderboard = q.leaderboard.all(game.id);
  broadcast({ t: 'leaderboard', gameId: game.id, rows: leaderboard });
  const daily = bumpDaily(req.player.id, 'arcade');
  res.json({
    ok: true, leaderboard, xpGain, daily,
    xp: q.playerProgress.get(req.player.id).xp,
  });
});

// Progression du joueur : XP + compteurs + meilleurs scores par borne
api.get('/progress', auth, (req, res) => {
  const p = q.playerProgress.get(req.player.id);
  const best = {};
  for (const row of q.bestScoresByPlayer.all(req.player.id)) {
    best[row.game_id] = row.score;
  }
  res.json({
    xp: p.xp,
    tagsPosted: p.tags_posted,
    kills: p.kills_total,
    best,
  });
});

api.get('/leaderboard/:gameId', (req, res) => {
  res.json({ rows: q.leaderboard.all(req.params.gameId) });
});

// --- Tags (graffiti) -----------------------------------------------------

api.post('/tag-images', auth, (req, res) => {
  const name = String(req.body?.name ?? 'tag').trim().slice(0, 24) || 'tag';
  const data = req.body?.data;
  if (!validImageDataUrl(data)) {
    return res.status(400).json({ error: 'Image de tag invalide ou trop lourde.' });
  }
  const id = crypto.randomUUID();
  q.createTagImage.run(id, req.player.id, name, data, Date.now());
  res.json({ id, name, data });
});

api.get('/tag-images', auth, (req, res) => {
  res.json({ images: q.tagImagesByPlayer.all(req.player.id) });
});

api.post('/tags', auth, (req, res) => {
  const { image, p, quat, size } = req.body ?? {};
  if (!validImageDataUrl(image)) {
    return res.status(400).json({ error: 'Image de tag invalide.' });
  }
  const pos = Array.isArray(p) ? p.map(Number) : [];
  const rot = Array.isArray(quat) ? quat.map(Number) : [];
  const sz = Number(size);
  if (
    pos.length !== 3 || rot.length !== 4 ||
    pos.some((v) => !Number.isFinite(v) || Math.abs(v) > 2000) ||
    rot.some((v) => !Number.isFinite(v) || Math.abs(v) > 1.001) ||
    !Number.isFinite(sz) || sz < 0.4 || sz > 6
  ) {
    return res.status(400).json({ error: 'Placement de tag invalide.' });
  }

  const id = crypto.randomUUID();
  insertTagWithLimit([id, req.player.id, image, ...pos, ...rot, sz, Date.now()]);
  const tag = {
    id, image,
    px: pos[0], py: pos[1], pz: pos[2],
    qx: rot[0], qy: rot[1], qz: rot[2], qw: rot[3],
    size: sz,
    author: req.player.name,
  };
  broadcast({ t: 'tag', tag });

  // Progression : +15 XP par tag, et la guerre de tags « ROI DU GRAFF »
  // réutilise le circuit des scores (score = total de tags posés)
  q.addXp.run(15, req.player.id);
  q.bumpTagsPosted.run(req.player.id);
  const progress = q.playerProgress.get(req.player.id);
  q.addScore.run(req.player.id, 'graff', progress.tags_posted, null, Date.now());
  broadcast({ t: 'leaderboard', gameId: 'graff', rows: q.leaderboard.all('graff') });
  const daily = bumpDaily(req.player.id, 'tag');

  res.json({ tag, xp: progress.xp, xpGain: 15, daily });
});

// --- Défis quotidiens ------------------------------------------------------

api.get('/daily', auth, (req, res) => {
  res.json(getDailyStatus(req.player.id));
});

// --- Génération IA de nouvelles bornes -----------------------------------

api.post('/games', auth, async (req, res) => {
  if (!aiAvailable()) {
    return res.status(503).json({
      error: "L'éditeur IA est désactivé : ANTHROPIC_API_KEY n'est pas configurée sur le serveur.",
    });
  }
  const title = String(req.body?.title ?? '').trim();
  const prompt = String(req.body?.prompt ?? '').trim();
  if (title.length < 2 || title.length > 32) {
    return res.status(400).json({ error: 'Titre invalide (2 à 32 caractères).' });
  }
  if (prompt.length < 10 || prompt.length > 2000) {
    return res.status(400).json({ error: 'Description invalide (10 à 2000 caractères).' });
  }
  if (q.countCustomGames.get().n >= MAX_CUSTOM_GAMES) {
    return res.status(409).json({ error: 'La salle d’arcade est pleine (30 bornes créées).' });
  }
  const last = q.lastGameByCreator.get(req.player.id)?.t ?? 0;
  const wait = last + GAME_COOLDOWN_MS - Date.now();
  if (wait > 0) {
    return res.status(429).json({
      error: `Patiente ${Math.ceil(wait / 1000)}s avant de créer une nouvelle borne.`,
    });
  }

  try {
    const html = await generateGame(title, prompt);
    const id = 'g_' + crypto.randomUUID().slice(0, 8);
    q.createGame.run(id, title.toUpperCase(), prompt, html, req.player.id, Date.now());
    const meta = {
      id, title: title.toUpperCase(), builtin: 0, prompt,
      created_at: Date.now(), creator: req.player.name,
    };
    broadcast({ t: 'game', game: meta });
    res.json({ game: meta });
  } catch (err) {
    console.error('Génération de borne échouée :', err);
    res.status(502).json({
      error: 'La génération du jeu a échoué : ' + (err?.message ?? 'erreur inconnue'),
    });
  }
});
