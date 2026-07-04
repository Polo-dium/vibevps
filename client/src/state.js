// État global partagé de l'application.
export const state = {
  auth: null, // { id, name, token }
  isAdmin: false,
  games: [], // métadonnées des bornes
  leaderboards: {}, // gameId -> rows
  tags: [], // tags déjà posés dans le monde
  activeTagImage: null, // dataURL du tag sélectionné pour le spray
  overlayOpen: false, // un overlay UI est ouvert (jeu, éditeur, etc.)
  chatOpen: false, // saisie du chat de proximité en cours
  pointerLocked: false,
  weaponEquipped: false,
  tagMode: false, // bombe de peinture en main
  rangeSession: null, // session de stand de tir en cours
  xp: 0, // progression du joueur (source de vérité : serveur)
  level: 1,
  driving: false, // au volant d'une décapotable
};

export async function apiFetch(path, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...(options.headers ?? {}) };
  if (state.auth?.token) headers.Authorization = `Bearer ${state.auth.token}`;
  const res = await fetch(`/api${path}`, { ...options, headers });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `Erreur ${res.status}`);
  return body;
}
