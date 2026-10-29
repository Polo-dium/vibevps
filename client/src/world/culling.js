import * as THREE from 'three';

// MASQUAGE PAR DISTANCE DU PETIT DÉCOR
//
// Mesuré sur le Grand Lyon : les bâtiments ne coûtent que ~35 draw calls
// (ils sont groupés en tuiles, et three.js frustum-cull le reste), mais le
// petit décor en coûte ~700 — près de 2 700 meshes individuels (mobilier
// urbain, PNJ, bornes, terrasses, néons…), chacun son propre draw call.
// C'est LE poste qui met les petites configurations à genoux.
//
// On masque donc tout objet « petit » (rayon < BIG) au-delà de la portée de
// vue. Rien d'autre ne change : les colliders, les interactions et les tirs
// ne regardent pas la visibilité — seul le RENDU est coupé.
const BIG = 70; // au-delà, c'est du décor de fond (terrain, ville, ciel, collines)
const HYST = 60; // marge anti-clignotement à la frontière
// Taille apparente : au-delà de 100·r m, un objet de rayon r ne fait plus
// qu'une dizaine de pixels dans la brume — un passant (1 m) disparaît à
// 150 m, un kiosque (5 m) à 500 m. Un objet fait de beaucoup de pièces
// (n draw calls) part plus tôt, en 1/√n : un stand de 46 pièces de 9 m à
// ~375 m. En avion, c'était ~800 draw calls de petit décor jusqu'à 2 km.
// Plancher à 150 m.
const sizeView = (view, r, n = 1) =>
  Math.min(view, Math.max(150, r * 100 * Math.max(0.35, Math.min(1, Math.sqrt(8 / Math.max(1, n))))));

export function createDistanceCuller(scene, playerPos) {
  const items = [];
  const box = new THREE.Box3();
  const sphere = new THREE.Sphere();

  // On mesure chaque enfant direct de la scène (au démarrage, puis toutes
  // les 2 s pour ceux ajoutés plus tard : stands, modèles chargés à la
  // volée…). On retient le décalage entre son origine et le centre de son
  // volume englobant, pour que les objets qui BOUGENT (voitures, PNJ,
  // avions) restent correctement situés sans tout recalculer.
  const seen = new Set();
  function track(o) {
    if (o.isLight || o.isCamera || o.userData?.noCull) { seen.add(o); return; }
    // Volumes recalculés : une géométrie partagée (humains sculptés) dont la
    // boîte avait été mesurée VIDE avant d'être remplie restait invisible au
    // masquage — ~120 personnages dessinés jusqu'à 2,4 km.
    o.traverse((m) => {
      if (!m.geometry || m.isInstancedMesh) return;
      if (m.geometry.boundingBox?.isEmpty()) m.geometry.computeBoundingBox();
      if (m.geometry.boundingSphere && !(m.geometry.boundingSphere.radius > 0)) m.geometry.computeBoundingSphere();
    });
    box.setFromObject(o);
    if (box.isEmpty()) return; // pas encore rempli : on repassera
    seen.add(o);
    box.getBoundingSphere(sphere);
    if (sphere.radius > BIG || !Number.isFinite(sphere.radius)) return;
    let n = 0;
    o.traverse((m) => { if (m.isMesh || m.isPoints || m.isLine) n++; });
    items.push({
      o,
      n,
      ox: sphere.center.x - o.position.x,
      oz: sphere.center.z - o.position.z,
      r: sphere.radius,
      shown: o.visible,
      // On ne touche jamais à un objet déjà masqué par une autre logique
      // (intérieur de l'arcade, avion pris par un autre joueur…) : on ne
      // gère que ceux qu'on a nous-mêmes masqués.
      owned: false,
    });
  }
  for (const o of scene.children) track(o);

  let timer = 0, rescan = 2;
  function update(dt, viewDistance) {
    timer -= dt;
    if (timer > 0) return;
    timer = 0.25;
    rescan -= 0.25;
    if (rescan <= 0) {
      rescan = 2;
      for (const o of scene.children) if (!seen.has(o)) track(o);
    }
    const p = playerPos();
    if (!p) return;
    const view0 = viewDistance ?? 99999;
    for (const it of items) {
      const cx = it.o.position.x + it.ox, cz = it.o.position.z + it.oz;
      const d = Math.hypot(cx - p.x, cz - p.z) - it.r;
      const view = sizeView(view0, it.r, it.n);
      if (d > view + HYST) {
        if (it.o.visible) { it.o.visible = false; it.owned = true; }
      } else if (d < view && it.owned) {
        // forceHidden : un autre système veut cet objet masqué (avion pris
        // par un autre joueur…). On lui rend la main sans le réafficher.
        if (!it.o.userData?.forceHidden) it.o.visible = true;
        it.owned = false;
      }
    }
  }

  // Exposé pour les tests : permet de vérifier l'invariant « rien de masqué
  // par nous ne doit se trouver à portée de vue ».
  function audit(p, view) {
    let owned = 0, faute = 0, pireEcart = 0;
    const ex = [];
    for (const it of items) {
      if (!it.owned) continue;
      owned++;
      const cx = it.o.position.x + it.ox, cz = it.o.position.z + it.oz;
      const d = Math.hypot(cx - p.x, cz - p.z) - it.r;
      const v = sizeView(view, it.r, it.n);
      if (d < v) {
        faute++;
        pireEcart = Math.max(pireEcart, v - d);
        if (ex.length < 5) {
          ex.push({
            type: it.o.type, nom: it.o.name || '(sans nom)', visible: it.o.visible,
            d: Math.round(d), r: Math.round(it.r),
            pos: [Math.round(it.o.position.x), Math.round(it.o.position.z)],
            centre: [Math.round(cx), Math.round(cz)],
            enfants: it.o.children?.length ?? 0,
          });
        }
      }
    }
    return { total: items.length, masques: owned, fautes: faute, pireEcart: Math.round(pireEcart), exemples: ex };
  }

  return { update, audit, count: items.length };
}
