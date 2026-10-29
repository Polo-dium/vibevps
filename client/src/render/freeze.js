// Matrices figées pour le décor immobile. Par défaut three.js recompose la
// matrice locale ET remultiplie la matrice monde de CHAQUE objet à chaque
// frame (~4 400 objets ici : ~1,4 ms sur PC, plusieurs ms sur mobile),
// alors que presque tout est immobile. On passe matrixAutoUpdate à false et
// on surveille position / quaternion / échelle (10 nombres par objet,
// comparés à chaque frame) : un objet qui bouge (PNJ, os d'un personnage,
// porte, cabine…) voit sa matrice recalculée dans la même frame, avant le
// rendu. Les objets ajoutés après le démarrage gardent la mise à jour auto.

export function createFreezer(scene) {
  const objs = [];
  // la scène AUSSI : sinon sa propre mise à jour force celle de tout
  // l'arbre. Pas la caméra ni ce qu'elle porte (armes, bras : leur position
  // sert dans la frame même, ex. bouche du canon).
  (function walk(o) {
    if (o.isCamera) return;
    if (o.matrixAutoUpdate) {
      o.updateMatrix();
      o.matrixAutoUpdate = false;
      objs.push(o);
    }
    for (const c of o.children) walk(c);
  })(scene);
  const n = objs.length;
  const snap = new Float32Array(n * 10);
  const save = (i, o) => {
    const k = i * 10, p = o.position, q = o.quaternion, s = o.scale;
    snap[k] = p.x; snap[k + 1] = p.y; snap[k + 2] = p.z;
    snap[k + 3] = q.x; snap[k + 4] = q.y; snap[k + 5] = q.z; snap[k + 6] = q.w;
    snap[k + 7] = s.x; snap[k + 8] = s.y; snap[k + 9] = s.z;
  };
  for (let i = 0; i < n; i++) save(i, objs[i]);
  // Comparaison en float32 (comme le cliché) : pas de faux « a bougé »
  const f = Math.fround;

  function update() {
    for (let i = 0; i < n; i++) {
      const o = objs[i], k = i * 10, p = o.position, q = o.quaternion, s = o.scale;
      if (snap[k] !== f(p.x) || snap[k + 1] !== f(p.y) || snap[k + 2] !== f(p.z) ||
        snap[k + 3] !== f(q.x) || snap[k + 4] !== f(q.y) || snap[k + 5] !== f(q.z) || snap[k + 6] !== f(q.w) ||
        snap[k + 7] !== f(s.x) || snap[k + 8] !== f(s.y) || snap[k + 9] !== f(s.z)) {
        o.updateMatrix(); // → matrixWorldNeedsUpdate : la matrice monde suit
        save(i, o);
      }
    }
  }
  return { update, count: n };
}
