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
  photoMode: false, // mode photo : zoom à la molette, clic = capture
  boombox: 0, // enceinte portable : 0 = coupée, 1..3 = morceau en cours
  driving: false, // au volant d'une décapotable
  inventory: [], // identifiants des objets trouvés, restaurés depuis le compte
  arsenalQuest: 0, // 0 à prendre, 1 active, 2 terminée
  hasJetpack: false, // jetpack ramassé à la Confluence
  hasRcPlane: false, // avion radiocommandé trouvé à l'aéroport
  hasRadio: false, // radio portable récupérée devant la salle d'arcade
  flying: false, // jetpack en cours d'utilisation
};

export async function apiFetch(path, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...(options.headers ?? {}) };
  if (state.auth?.token) headers.Authorization = `Bearer ${state.auth.token}`;
  const res = await fetch(`/api${path}`, { ...options, headers });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `Erreur ${res.status}`);
  return body;
}
