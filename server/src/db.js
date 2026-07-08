import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(__dirname, '..', 'data');
fs.mkdirSync(dataDir, { recursive: true });

export const db = new Database(path.join(dataDir, 'vibevps.db'));
db.pragma('journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS players (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  token TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS games (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  builtin INTEGER NOT NULL DEFAULT 0,
  prompt TEXT,
  html TEXT,
  creator_id TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS scores (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  player_id TEXT NOT NULL,
  game_id TEXT NOT NULL,
  score INTEGER NOT NULL,
  accuracy REAL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (player_id) REFERENCES players(id),
  FOREIGN KEY (game_id) REFERENCES games(id)
);
CREATE INDEX IF NOT EXISTS idx_scores_game ON scores(game_id, score DESC);

CREATE TABLE IF NOT EXISTS tag_images (
  id TEXT PRIMARY KEY,
  player_id TEXT NOT NULL,
  name TEXT NOT NULL,
  data TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS tags (
  id TEXT PRIMARY KEY,
  player_id TEXT NOT NULL,
  image TEXT NOT NULL,
  px REAL NOT NULL, py REAL NOT NULL, pz REAL NOT NULL,
  qx REAL NOT NULL, qy REAL NOT NULL, qz REAL NOT NULL, qw REAL NOT NULL,
  size REAL NOT NULL,
  created_at INTEGER NOT NULL
);
`);

// Bornes intégrées : le HTML vit côté client, on ne stocke que les
// métadonnées pour les leaderboards et l'affichage.
const BUILTINS = [
  ['tetris', 'TETRIS'],
  ['pacman', 'PACMAN'],
  ['snake', 'SNAKE'],
  ['breakout', 'BREAKOUT'],
  ['shooting-range', 'STAND DE TIR'],
  ['pvp', 'DUELS DE RUE'],
  ['graff', 'ROI DU GRAFF'], // guerre de tags : score = total de tags posés
];
const insertBuiltin = db.prepare(
  `INSERT OR IGNORE INTO games (id, title, builtin, created_at) VALUES (?, ?, 1, ?)`
);
for (const [id, title] of BUILTINS) insertBuiltin.run(id, title, Date.now());

// Migrations : colonnes ajoutées au fil des versions
for (const col of [
  `is_admin INTEGER NOT NULL DEFAULT 0`,
  `xp INTEGER NOT NULL DEFAULT 0`,
  `tags_posted INTEGER NOT NULL DEFAULT 0`,
  `kills_total INTEGER NOT NULL DEFAULT 0`,
  `pin_hash TEXT`, // code secret (haché) pour retrouver son pseudo ailleurs
]) {
  try {
    db.exec(`ALTER TABLE players ADD COLUMN ${col}`);
  } catch { /* colonne déjà présente */ }
}

const MAX_TAGS = 600;

export const q = {
  createPlayer: db.prepare(
    `INSERT INTO players (id, name, token, created_at) VALUES (?, ?, ?, ?)`
  ),
  playerByName: db.prepare(`SELECT * FROM players WHERE name = ?`),
  playerByToken: db.prepare(`SELECT * FROM players WHERE token = ?`),
  setPin: db.prepare(`UPDATE players SET pin_hash = ? WHERE id = ?`),

  listGames: db.prepare(
    `SELECT g.id, g.title, g.builtin, g.prompt, g.created_at, p.name AS creator
     FROM games g LEFT JOIN players p ON p.id = g.creator_id
     ORDER BY g.created_at ASC`
  ),
  gameById: db.prepare(`SELECT * FROM games WHERE id = ?`),
  createGame: db.prepare(
    `INSERT INTO games (id, title, builtin, prompt, html, creator_id, created_at)
     VALUES (?, ?, 0, ?, ?, ?, ?)`
  ),
  countCustomGames: db.prepare(`SELECT COUNT(*) AS n FROM games WHERE builtin = 0`),
  lastGameByCreator: db.prepare(
    `SELECT MAX(created_at) AS t FROM games WHERE creator_id = ?`
  ),

  addScore: db.prepare(
    `INSERT INTO scores (player_id, game_id, score, accuracy, created_at)
     VALUES (?, ?, ?, ?, ?)`
  ),
  leaderboard: db.prepare(
    `SELECT p.name, MAX(s.score) AS score, s.accuracy
     FROM scores s JOIN players p ON p.id = s.player_id
     WHERE s.game_id = ?
     GROUP BY s.player_id
     ORDER BY score DESC
     LIMIT 10`
  ),

  createTagImage: db.prepare(
    `INSERT INTO tag_images (id, player_id, name, data, created_at) VALUES (?, ?, ?, ?, ?)`
  ),
  tagImagesByPlayer: db.prepare(
    `SELECT id, name, data, created_at FROM tag_images WHERE player_id = ? ORDER BY created_at DESC`
  ),
  tagImageById: db.prepare(`SELECT * FROM tag_images WHERE id = ?`),

  createTag: db.prepare(
    `INSERT INTO tags (id, player_id, image, px, py, pz, qx, qy, qz, qw, size, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ),
  listTags: db.prepare(
    `SELECT t.id, t.image, t.px, t.py, t.pz, t.qx, t.qy, t.qz, t.qw, t.size, p.name AS author
     FROM tags t JOIN players p ON p.id = t.player_id
     ORDER BY t.created_at ASC`
  ),
  countTags: db.prepare(`SELECT COUNT(*) AS n FROM tags`),
  pruneOldestTag: db.prepare(
    `DELETE FROM tags WHERE id = (SELECT id FROM tags ORDER BY created_at ASC LIMIT 1)`
  ),

  setAdmin: db.prepare(`UPDATE players SET is_admin = 1 WHERE id = ?`),
  deleteTag: db.prepare(`DELETE FROM tags WHERE id = ?`),
  deleteAllTags: db.prepare(`DELETE FROM tags`),

  // Progression : XP et compteurs cumulés
  addXp: db.prepare(`UPDATE players SET xp = xp + ? WHERE id = ?`),
  bumpTagsPosted: db.prepare(`UPDATE players SET tags_posted = tags_posted + 1 WHERE id = ?`),
  bumpKills: db.prepare(`UPDATE players SET kills_total = kills_total + 1 WHERE id = ?`),
  playerProgress: db.prepare(
    `SELECT xp, tags_posted, kills_total FROM players WHERE id = ?`
  ),
  bestScoresByPlayer: db.prepare(
    `SELECT game_id, MAX(score) AS score FROM scores WHERE player_id = ? GROUP BY game_id`
  ),
};

export function insertTagWithLimit(args) {
  const tx = db.transaction(() => {
    if (q.countTags.get().n >= MAX_TAGS) q.pruneOldestTag.run();
    q.createTag.run(...args);
  });
  tx();
}
