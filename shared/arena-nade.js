// GRENADES DE L'ARÈNE — physique partagée. Le serveur (qui décide où ça
// explose et qui prend) et chaque client (qui l'affiche) font avancer la
// grenade avec CETTE fonction, sur les mêmes boîtes (arena-layout.js) :
// même rebond partout, sans envoyer la trajectoire sur le réseau.
// Repère local de la place, comme arena-layout.js.
export const NADE = {
  speed: 17, lift: 3.6,        // lancer : vitesse le long du regard + coup de poignet vers le haut
  fuse: { f: 2.3, s: 1.5 },    // secondes avant l'explosion / l'ouverture du fumigène
  radius: 7.5, damage: 115,    // grenade : dégâts au centre, nuls au bord
  smokeR: 6, smokeDur: 13,     // fumigène : rayon du nuage, durée
  perLife: { f: 2, s: 1 },     // dotation à chaque réapparition
};
const R = 0.09, GROUND = 0.05, G = 19;

// n : { x, y, z, vx, vy, vz } — avancé de dt secondes (pas de 1/60 s)
export function stepNade(n, dt, boxes) {
  let left = dt;
  while (left > 1e-5) {
    const h = Math.min(left, 1 / 60);
    left -= h;
    n.vy -= G * h;
    const px = n.x, py = n.y, pz = n.z;
    n.x += n.vx * h; n.y += n.vy * h; n.z += n.vz * h;
    // sol
    if (n.y < GROUND + R) {
      n.y = GROUND + R;
      n.vy = Math.abs(n.vy) > 1.2 ? -n.vy * 0.38 : 0;
      n.vx *= 0.7; n.vz *= 0.7;
    }
    // façades de la place
    if (Math.abs(n.x) > 81) { n.x = Math.sign(n.x) * 81; n.vx *= -0.4; }
    if (Math.abs(n.z) > 56) { n.z = Math.sign(n.z) * 56; n.vz *= -0.4; }
    // obstacles : on rebondit sur la face par laquelle on est entré
    for (const b of boxes) {
      if (n.x < b.x0 - R || n.x > b.x1 + R || n.z < b.z0 - R || n.z > b.z1 + R || n.y < b.y0 - R || n.y > b.y1 + R) continue;
      if (py >= b.y1 + R) {        // tombée sur le dessus
        n.y = b.y1 + R;
        n.vy = Math.abs(n.vy) > 1.2 ? -n.vy * 0.38 : 0;
        n.vx *= 0.7; n.vz *= 0.7;
      } else if (px <= b.x0 - R || px >= b.x1 + R) {
        n.x = px; n.vx *= -0.45; n.vz *= 0.8;
      } else if (pz <= b.z0 - R || pz >= b.z1 + R) {
        n.z = pz; n.vz *= -0.45; n.vx *= 0.8;
      } else if (py <= b.y0 - R) { // par-dessous (pile de conteneurs)
        n.y = py; n.vy = -Math.abs(n.vy) * 0.3;
      } else {                     // née dans un obstacle : on la pose dessus
        n.y = b.y1 + R; n.vy = 0;
      }
    }
  }
}
