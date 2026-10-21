// Finesse du décor, fixée au chargement d'après le palier de qualité (voir
// main.js) : le surcoût visuel (PBR des persos, houppiers détaillés,
// corniches, passe matière) est réservé au palier Élevé. Moyen et Bas — les
// tablettes et téléphones — gardent des versions légères. Changer de palier
// en jeu (touche O) ne reconstruit pas la ville : effet au prochain chargement.
export const detail = {
  level: 'moyen',
  get high() { return this.level === 'eleve'; },
};
