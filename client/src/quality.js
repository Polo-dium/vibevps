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
//
// viewDistance (mètres) : rayon au-delà duquel les tuiles de ville ne sont
// plus dessinées. C'est LE réglage qui décide du nombre de draw calls sur
// le Grand Lyon — sans lui, toute la ville (~2,3 × 2,8 km) est soumise au
// GPU depuis n'importe où. La brume est calée dessus (voir fogDensity) pour
// que la coupure tombe là où tout est déjà noyé de gris : on ne voit pas
// les bâtiments disparaître, on voit juste plus loin ou moins loin.
const PRESETS = {
// postfx : rendu « ciné » (bloom HDR, étalonnage, MSAA — voir render/post.js)
// viewFloor : plancher de la portée adaptative (main.js la rogne quand le
// fps baisse). En Élevé elle ne descend plus sous 0,75 × 2 400 m : c'est le
// palier « on voit loin » (le Crayon depuis Fourvière, les Alpes).
  bas: { pixelRatio: 1, shadows: false, shadowMapSize: 1024, viewDistance: 420, viewFloor: 0.45, postfx: false },
  moyen: { pixelRatio: 1.25, shadows: true, shadowMapSize: 1024, viewDistance: 850, viewFloor: 0.6, postfx: false },
  eleve: { pixelRatio: 2, shadows: true, shadowMapSize: 2048, viewDistance: 2400, viewFloor: 0.75, postfx: true },
};

// Densité de brume qui rend une tuile ~90 % grise à la distance de coupure :
// exp(-(d·x)²) ≈ 0,12 pour d·x = 1,45. On vise un peu avant la coupure pour
// que le dernier rang de bâtiments soit déjà fondu quand il disparaît.
export function fogDensityFor(viewDistance) {
  return 1.6 / Math.max(120, viewDistance);
}

const STORAGE_KEY = 'lyon_quality';

const MANUAL_KEY = 'lyon_quality_manual'; // palier choisi à la main (touche O / réglages)

function weakGpu() {
  try {
    const gl = document.createElement('canvas').getContext('webgl');
    const ext = gl?.getExtension('WEBGL_debug_renderer_info');
    const name = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : '';
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
    if (/\bArc\b/i.test(name)) return false; // Intel Arc : vraie carte
    return /Intel|SwiftShader|llvmpipe|Basic Render/i.test(name);
  } catch { return false; }
}

function autoDetect(isTouch) {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored && PRESETS[stored]) return stored;
  const cores = navigator.hardwareConcurrency || 4;
  if (isTouch) return cores <= 4 ? 'bas' : 'moyen';
  // Puce graphique INTÉGRÉE (Intel UHD/HD/Iris des PC de bureau, rendu
  // logiciel) : le palier Élevé y tombait à 20 images/s — beaucoup de cœurs
  // ne dit rien de la carte graphique. Moyen d'office ; la touche O reste là.
  if (weakGpu()) return 'moyen';
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
    // vrai si le joueur a choisi lui-même : on ne redescend alors jamais
    // le palier à sa place (voir la garde de fluidité dans main.js)
    get manual() { return localStorage.getItem(MANUAL_KEY) === '1'; },
    lower() { return LEVELS[Math.max(0, LEVELS.indexOf(level) - 1)]; },
    onChange(fn) { listeners.push(fn); },
    set(next) {
      if (!PRESETS[next] || next === level) return level;
      level = next;
      notify();
      return level;
    },
    cycle() {
      localStorage.setItem(MANUAL_KEY, '1');
      level = LEVELS[(LEVELS.indexOf(level) + 1) % LEVELS.length];
      notify();
      return level;
    },
  };
}
