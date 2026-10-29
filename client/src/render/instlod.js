// Portée d'affichage par instance pour les InstancedMesh qui couvrent toute
// la ville (arbres, stores, enseignes, édicules…). Mettre une instance à
// l'échelle zéro ne coûte presque rien au CPU mais le GPU traite quand même
// tous ses sommets : 2 000 arbres lointains = 2,5 M triangles pour rien. Ici,
// on RANGE en tête les instances à portée (minD ≤ d < maxD du joueur) et on
// réduit im.count : le reste n'est plus du tout soumis au GPU.
// Réévalué 2 à 3 fois par seconde (assez pour un avion à 200 km/h).

const all = [];

// maxD : nombre ou fonction (ex. () => ctx.viewDistance)
export function lodInstances(im, { minD = 0, maxD = 400 } = {}) {
  const e = { im, n: im.count, mats: null, minD, maxD, px: Infinity, pz: Infinity, lastMax: -1 };
  all.push(e);
  return e;
}

// Copie de référence prise au PREMIER tri, pas à l'enregistrement : les
// saisons (world/seasons.js) recolorent les instances après la construction.
function capture(e) {
  const { im, n } = e;
  e.mats = im.instanceMatrix.array.slice(0, n * 16);
  e.cols = im.instanceColor ? im.instanceColor.array.slice(0, n * 3) : null;
  e.xs = new Float32Array(n); e.zs = new Float32Array(n);
  for (let i = 0; i < n; i++) { e.xs[i] = e.mats[i * 16 + 12]; e.zs[i] = e.mats[i * 16 + 14]; }
}

let timer = 0;
export function updateInstanceLods(dt, p) {
  timer -= dt;
  if (timer > 0 || !p) return;
  timer = 0.35;
  for (const e of all) {
    if (!e.mats) capture(e);
    const maxD = typeof e.maxD === 'function' ? e.maxD() : e.maxD;
    // on ne refait le tri que si l'on a bougé (ou la portée changé)
    if (Math.abs(p.x - e.px) + Math.abs(p.z - e.pz) < 6 && maxD === e.lastMax) continue;
    e.px = p.x; e.pz = p.z; e.lastMax = maxD;
    const lo = e.minD * e.minD, hi = maxD * maxD;
    const dst = e.im.instanceMatrix.array, cdst = e.im.instanceColor?.array;
    let k = 0;
    for (let i = 0; i < e.n; i++) {
      const d2 = (e.xs[i] - p.x) ** 2 + (e.zs[i] - p.z) ** 2;
      if (d2 < lo || d2 >= hi) continue;
      dst.set(e.mats.subarray(i * 16, i * 16 + 16), k * 16);
      if (cdst) cdst.set(e.cols.subarray(i * 3, i * 3 + 3), k * 3);
      k++;
    }
    e.im.count = k;
    e.im.instanceMatrix.needsUpdate = true;
    if (cdst) e.im.instanceColor.needsUpdate = true;
    if (e.im.frustumCulled && k) e.im.computeBoundingSphere();
  }
}
