import { apiFetch } from './state.js';

// --- Niveaux -----------------------------------------------------------
// Courbe douce : niveau 2 à 60 XP (4 tags), niveau 5 à ~960 XP, etc.
export function levelOf(xp) {
  return Math.floor(Math.sqrt(Math.max(0, xp) / 60)) + 1;
}
export function xpForLevel(level) {
  return 60 * (level - 1) * (level - 1);
}

// --- Succès (calculés à partir de la progression serveur) ---------------
export const ACHIEVEMENTS = [
  { id: 'tag1', icon: '🎨', name: 'Premier graff', desc: 'Poser son premier tag', test: (p) => p.tagsPosted >= 1 },
  { id: 'tag25', icon: '🖌️', name: 'Graffeur des pentes', desc: '25 tags posés', test: (p) => p.tagsPosted >= 25 },
  { id: 'tag100', icon: '👑', name: 'Roi du graff', desc: '100 tags posés', test: (p) => p.tagsPosted >= 100 },
  { id: 'kill1', icon: '💥', name: 'Premier duel', desc: 'Abattre un joueur', test: (p) => p.kills >= 1 },
  { id: 'kill10', icon: '🔫', name: 'Terreur de la Presqu’île', desc: '10 joueurs abattus', test: (p) => p.kills >= 10 },
  { id: 'kill50', icon: '🏰', name: 'Roi de Bellecour', desc: '50 joueurs abattus', test: (p) => p.kills >= 50 },
  { id: 'tetris1k', icon: '🧱', name: 'Gone du Tetris', desc: '1 000 pts au Tetris', test: (p) => (p.best?.tetris ?? 0) >= 1000 },
  { id: 'pac2k', icon: '🟡', name: 'Pacman des traboules', desc: '2 000 pts au Pacman', test: (p) => (p.best?.pacman ?? 0) >= 2000 },
  { id: 'range400', icon: '🎯', name: 'Fine gâchette', desc: '400 pts au stand de tir', test: (p) => (p.best?.['shooting-range'] ?? 0) >= 400 },
  { id: 'lvl5', icon: '⭐', name: 'Gone confirmé', desc: 'Atteindre le niveau 5', test: (p) => levelOf(p.xp) >= 5 },
  { id: 'lvl10', icon: '🌟', name: 'Légende de Lyon', desc: 'Atteindre le niveau 10', test: (p) => levelOf(p.xp) >= 10 },
];

const UNLOCK_KEY = 'vibevps_achievements';

function loadUnlocked() {
  try {
    return new Set(JSON.parse(localStorage.getItem(UNLOCK_KEY) ?? '[]'));
  } catch {
    return new Set();
  }
}

export function createProgress({ onXp, onUnlock }) {
  let last = { xp: 0, tagsPosted: 0, kills: 0, best: {} };
  const unlocked = loadUnlocked();
  let firstLoad = true;

  function evaluate(progress) {
    last = progress;
    onXp?.(progress.xp, { silent: firstLoad });
    let dirty = false;
    for (const a of ACHIEVEMENTS) {
      if (unlocked.has(a.id) || !a.test(progress)) continue;
      unlocked.add(a.id);
      dirty = true;
      // Au premier chargement on restaure sans fanfare (succès déjà gagnés)
      if (!firstLoad) onUnlock?.(a);
    }
    if (dirty) localStorage.setItem(UNLOCK_KEY, JSON.stringify([...unlocked]));
    firstLoad = false;
  }

  // Rafraîchit la progression depuis le serveur (après un tag, un kill…)
  let inflight = null;
  async function refresh() {
    if (inflight) return inflight;
    inflight = apiFetch('/progress')
      .then((p) => evaluate(p))
      .catch(() => {})
      .finally(() => { inflight = null; });
    return inflight;
  }

  return {
    refresh,
    evaluate,
    isUnlocked: (id) => unlocked.has(id),
    get progress() { return last; },
  };
}
