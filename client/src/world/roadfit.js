// Ajustement des rues OSM aux façades réelles. OSM ne donne que l'axe des
// rues (largeur estimée par type : 3 à 8 m) : par endroits la chaussée
// mordait sur les immeubles, ailleurs un vide restait devant les façades.
// On mesure, par lancer de rayons sur les empreintes des bâtiments, la
// distance aux façades de chaque côté de chaque tronçon, puis :
//   - road.rw : largeur de chaussée rendue (resserrée si elle touche les
//     murs, élargie un peu sur les grands axes bordés de façades lointaines) ;
//   - road.sw : [gauche, droite] par tronçon, largeur des trottoirs jusqu'aux
//     façades (ruelles pavées : de mur à mur) ;
// road.w reste la CLASSE de la rue (seuils de circulation, stationnement…) ;
// les décalages latéraux (voitures garées, lampadaires…) lisent roadHalf().
// Le tracé n'est pas déplacé : carrefours et réseau restent connectés.
// Déterministe (même ville chez tout le monde, les tags restent en place).

const CELL = 8;
const REACH = 22; // au-delà, pas de façade « en vis-à-vis »
const SIDEWALK = 1.6; // trottoir par défaut (buildOsmRoads)

export const roadHalf = (r) => (r.rw ?? r.w) / 2;

export function fitRoadsToFacades(data, opts = {}) {
  const roads = data.roads ?? [], buildings = data.buildings ?? [];
  if (!roads.length || !buildings.length) return { roads: 0 };
  // Index des arêtes de façade
  const ex = [], grid = new Map();
  const key = (cx, cz) => cx * 100003 + cz;
  for (const b of buildings) {
    const p = b.p, n = p.length >> 1;
    if (n < 3) continue;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const x1 = p[i * 2], z1 = p[i * 2 + 1], x2 = p[j * 2], z2 = p[j * 2 + 1];
      const e = ex.push(x1, z1, x2, z2) / 4 - 1;
      const c0 = Math.floor(Math.min(x1, x2) / CELL), c1 = Math.floor(Math.max(x1, x2) / CELL);
      const r0 = Math.floor(Math.min(z1, z2) / CELL), r1 = Math.floor(Math.max(z1, z2) / CELL);
      for (let cx = c0; cx <= c1; cx++) for (let cz = r0; cz <= r1; cz++) {
        const k = key(cx, cz);
        let l = grid.get(k);
        if (!l) grid.set(k, (l = []));
        l.push(e);
      }
    }
  }
  // Distance jusqu'à la première façade le long d'un rayon (Infinity sinon)
  let stamp = 0;
  const seen = new Uint32Array(ex.length / 4);
  function cast(ox, oz, dx, dz) {
    stamp++;
    let best = Infinity;
    for (let s = 0; s <= REACH + CELL; s += CELL / 2) {
      if (s > best) break;
      const l = grid.get(key(Math.floor((ox + dx * s) / CELL), Math.floor((oz + dz * s) / CELL)));
      if (!l) continue;
      for (const e of l) {
        if (seen[e] === stamp) continue;
        seen[e] = stamp;
        const ax = ex[e * 4], az = ex[e * 4 + 1], bx = ex[e * 4 + 2], bz = ex[e * 4 + 3];
        const sx = bx - ax, sz = bz - az;
        const den = dx * sz - dz * sx;
        if (Math.abs(den) < 1e-9) continue;
        const t = ((ax - ox) * sz - (az - oz) * sx) / den; // le long du rayon
        const u = ((ax - ox) * dz - (az - oz) * dx) / den; // le long de l'arête
        if (t >= 0 && u >= 0 && u <= 1 && t < best) best = t;
      }
    }
    return best <= REACH ? best : Infinity;
  }
  const median = (a) => {
    if (!a.length) return Infinity;
    const s = [...a].sort((x, y) => x - y);
    return s[s.length >> 1];
  };

  let fitted = 0;
  for (const road of roads) {
    const p = road.p, nseg = (p.length >> 1) - 1;
    if (nseg < 1) continue;
    const half0 = road.w / 2;
    const L = [], R = [];
    const allL = [], allR = [];
    for (let i = 0; i < nseg; i++) {
      const x1 = p[i * 2], z1 = p[i * 2 + 1], x2 = p[i * 2 + 2], z2 = p[i * 2 + 3];
      const len = Math.hypot(x2 - x1, z2 - z1);
      const sl = [], sr = [];
      if (len > 2) {
        const ux = (x2 - x1) / len, uz = (z2 - z1) / len;
        const nx = -uz, nz = ux; // gauche (même normale que buildOsmRoads)
        // échantillons au cœur du tronçon (pas dans les carrefours)
        const k = Math.min(5, Math.max(1, Math.floor(len / 8)));
        for (let j = 0; j < k; j++) {
          const t = len * (0.2 + (0.6 * (j + 0.5)) / k);
          const x = x1 + ux * t, z = z1 + uz * t;
          const dl = cast(x, z, nx, nz), dr = cast(x, z, -nx, -nz);
          // axe collé à un mur (passage sous immeuble, erreur OSM) : ignoré
          if (dl < 0.8 || dr < 0.8) continue;
          sl.push(dl); sr.push(dr);
        }
      }
      L.push(median(sl)); R.push(median(sr));
      allL.push(...sl.filter(Number.isFinite)); allR.push(...sr.filter(Number.isFinite));
    }
    const both = [];
    for (let i = 0; i < nseg; i++) if (Number.isFinite(L[i]) && Number.isFinite(R[i])) both.push(Math.min(L[i], R[i]));
    // Chaussée : une largeur par rue (bordures continues)
    let half = half0;
    if (road.w >= 5.5 && both.length) {
      const tight = [...both].sort((a, b) => a - b)[Math.floor(both.length * 0.25)];
      if (tight < half0 + 0.9) half = Math.max(2.0, tight - 0.9); // mord sur les murs → resserrée
      else if (road.w >= 7) half = Math.min(half0 * 1.5, Math.max(half0, tight - 3.5)); // grand axe
    }
    // Trottoirs (ou pavés de mur à mur) par tronçon et par côté
    const pave = road.w < 5.5;
    const dflt = pave ? 1.0 : SIDEWALK;
    // Façade proche : on comble jusqu'au mur. Façade en retrait (jardin,
    // cour, parvis) : trottoir normal, le sol du lieu reste visible.
    const fill = (d) => {
      if (!Number.isFinite(d)) return dflt;
      const room = d - half;
      if (pave) return room <= 3.5 ? Math.max(0.2, room) : dflt;
      return room <= 4.5 ? Math.max(0.6, room) : dflt;
    };
    if (opts.debug) road._d = L.map((d, i) => [d, R[i]]); // distances aux façades (tests)
    road.rw = half * 2;
    road.sw = L.map((d, i) => [fill(d), fill(R[i])]);
    if (half !== half0 || road.sw.some(([a, b]) => a !== dflt || b !== dflt)) fitted++;
  }
  return { roads: fitted };
}
