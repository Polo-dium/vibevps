// Réglage de qualité graphique : 3 paliers (bas/moyen/élevé). Choisi
// automatiquement au démarrage (aucune API fiable ne donne le niveau du GPU,
// on se base sur le nombre de coeurs CPU comme indice grossier), ajustable à
// la volée avec la touche O, mémorisé en localStorage. Chaque palier ne
// pilote que des réglages de rendu globaux (résolution interne, ombres) :
// zéro géométrie alternative à maintenir, la ville reste identique à tous
// les niveaux — seul le coût de calcul par pixel/frame change.
const LEVELS = ['bas', 'moyen', 'eleve'];
const LABELS = { bas: 'Bas', moyen: 'Moyen', eleve: 'Élevé' };

// mapSize petit sur bas/moyen : la carte d'ombre est le plus gros poste de
// coût sur les GPU intégrés (Intel UHD et consorts) — bien plus que le
// nombre de triangles de la ville, qui reste identique partout.
const PRESETS = {
  bas: { pixelRatio: 1, shadows: false, shadowMapSize: 1024 },
  moyen: { pixelRatio: 1.25, shadows: true, shadowMapSize: 1024 },
  eleve: { pixelRatio: 2, shadows: true, shadowMapSize: 2048 },
};

const STORAGE_KEY = 'lyon_quality';

function autoDetect(isTouch) {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored && PRESETS[stored]) return stored;
  const cores = navigator.hardwareConcurrency || 4;
  if (isTouch) return cores <= 4 ? 'bas' : 'moyen';
  return cores <= 4 ? 'moyen' : 'eleve';
}

export function createQuality(isTouch) {
  let level = autoDetect(isTouch);
  const listeners = [];
  function notify() {
    localStorage.setItem(STORAGE_KEY, level);
    listeners.forEach((fn) => fn(PRESETS[level], level));
  }
  return {
    get level() { return level; },
    get preset() { return PRESETS[level]; },
    get label() { return LABELS[level]; },
    onChange(fn) { listeners.push(fn); },
    set(next) {
      if (!PRESETS[next] || next === level) return level;
      level = next;
      notify();
      return level;
    },
    cycle() {
      level = LEVELS[(LEVELS.indexOf(level) + 1) % LEVELS.length];
      notify();
      return level;
    },
  };
}
