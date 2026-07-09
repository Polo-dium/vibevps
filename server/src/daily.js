import { q } from './db.js';

// Défis quotidiens : 3 objectifs qui s'appuient sur des actions DÉJÀ
// validées ailleurs (tag posé, victoire PvP, score d'arcade envoyé) — pas
// de nouvelle surface d'anti-triche à maintenir. Remis à zéro chaque jour
// (date UTC), avec une série façon Wordle quand les 3 sont bouclés le
// même jour, y compris deux jours d'affilée.
export const DAILY_TARGETS = { tag: 2, kill: 2, arcade: 1 };
const DAILY_META = {
  tag: { icon: '🎨', label: (t) => `Poser ${t} tag${t > 1 ? 's' : ''}` },
  kill: { icon: '⚔️', label: (t) => `Remporter ${t} duel${t > 1 ? 's' : ''} PvP` },
  arcade: { icon: '🕹️', label: (t) => `Terminer ${t} partie${t > 1 ? 's' : ''} d'arcade` },
};
const STREAK_XP_BONUS = 60;

export function todayKey() {
  return new Date().toISOString().slice(0, 10); // AAAA-MM-JJ (UTC)
}
function yesterdayKey() {
  return new Date(Date.now() - 86400_000).toISOString().slice(0, 10);
}

function computeChallenges(row) {
  return Object.entries(DAILY_TARGETS).map(([type, target]) => {
    const progress = Math.min(target, row?.[type] ?? 0);
    return {
      type, target, progress,
      icon: DAILY_META[type].icon,
      label: DAILY_META[type].label(target),
      done: progress >= target,
    };
  });
}

export function getDailyStatus(playerId) {
  const date = todayKey();
  const row = q.dailyProgress.get(playerId, date);
  const player = q.playerById.get(playerId);
  const challenges = computeChallenges(row);
  return {
    date,
    challenges,
    allDone: challenges.every((c) => c.done),
    streak: player?.streak_current ?? 0,
    bestStreak: player?.streak_best ?? 0,
  };
}

// Fait avancer un compteur du jour (appelé depuis les points déjà validés :
// POST /tags, POST /scores, kill PvP dans ws.js). Retourne les défis qui
// viennent de passer à « done » et si la série a avancé, pour que
// l'appelant puisse notifier le joueur (toast + confettis côté client).
export function bumpDaily(playerId, type) {
  if (!(type in DAILY_TARGETS)) return null;
  const date = todayKey();
  const before = q.dailyProgress.get(playerId, date);
  const wasDone = new Set(computeChallenges(before).filter((c) => c.done).map((c) => c.type));

  q.bumpDailyProgress.run(
    playerId, date,
    type === 'tag' ? 1 : 0, type === 'kill' ? 1 : 0, type === 'arcade' ? 1 : 0
  );

  const status = getDailyStatus(playerId);
  const justCompleted = status.challenges.filter((c) => c.done && !wasDone.has(c.type)).map((c) => c.type);

  let streakBonus = false;
  if (status.allDone) streakBonus = advanceStreak(playerId, date);

  return { status: streakBonus ? getDailyStatus(playerId) : status, justCompleted, streakBonus };
}

// Avance la série si ce n'est pas déjà fait aujourd'hui. Renvoie true si la
// série vient d'être incrémentée à l'instant (pour le bonus XP + la fanfare).
function advanceStreak(playerId, date) {
  const player = q.playerById.get(playerId);
  if (!player || player.streak_last_date === date) return false; // déjà compté
  const isContinuation = player.streak_last_date === yesterdayKey();
  const current = isContinuation ? (player.streak_current || 0) + 1 : 1;
  const best = Math.max(current, player.streak_best || 0);
  q.setStreak.run(current, best, date, playerId);
  q.addXp.run(STREAK_XP_BONUS, playerId);
  return true;
}
