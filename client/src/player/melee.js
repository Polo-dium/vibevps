import * as THREE from 'three';

// ARMES BLANCHES — gestes variés, seule la main qui frappe bouge.
//
// Chaque modèle de mêlée est « pivoté » au chargement (pivotize) : la lame
// est rangée dans un groupe PIVOT posé sur le poing qui la tient (R, et L
// pour la 2e dague). arms.js accroche la main sur ce pivot (prise `on`), si
// bien qu'un coup ne fait tourner QUE la lame et son poignet ; l'autre main
// reste en garde (prise `cam` : sur la caméra) ou sur le bouclier.
//
// Une attaque = un ARMÉ (wind) puis une FRAPPE (end), en coordonnées du
// pivot : p = décalage du poing (m), r = rotation (x : pointe vers le haut,
// y : pointe vers la gauche, z : roulis). Coups rapprochés = ENCHAÎNEMENT
// (la frappe suivante repart d'où la précédente a fini : les lames se
// croisent), sinon une ouverture tirée au hasard. Les dagues alternent les
// mains, chacune son geste (miroir pour la gauche).

const A = (wind, end, dur = 0.34) => ({ wind, end, dur });
const K = (p, r) => ({ p, r });

const ATTACKS = {
  // Épée : tailles en diagonale, revers, coups de taille à plat, coup
  // vertical, estoc — chaque fin de geste prépare l'armé du suivant
  epee: [
    A(K([0.14, 0.2, 0.12], [1.25, -0.85, -0.7]), K([-0.32, -0.14, -0.16], [-0.7, 0.95, 0.55])),   // taille ↘ (droite haute → gauche basse)
    A(K([-0.24, -0.04, 0.0], [-0.3, 0.9, 1.25]), K([0.16, 0.22, -0.14], [0.95, -0.9, -1.0])),     // revers ↗ (gauche basse → droite haute)
    A(K([0.16, 0.06, 0.04], [-0.1, -0.95, -1.5]), K([-0.34, 0.03, -0.14], [-0.15, 1.25, -1.5])),   // taille à plat →←
    A(K([-0.26, 0.08, 0.02], [-0.1, 0.95, 1.5]), K([0.18, 0.02, -0.16], [-0.15, -1.25, 1.5])),      // revers à plat ←→
    A(K([0.02, 0.28, 0.16], [1.65, -0.05, 0]), K([-0.06, -0.22, -0.18], [-0.95, 0.12, 0.1])),       // coup vertical
    A(K([0.03, 0.0, 0.2], [-0.5, 0.02, 0]), K([-0.07, 0.05, -0.4], [-0.55, 0.1, 0]), 0.28),         // estoc
    A(K([0.16, -0.14, 0.08], [-0.5, -0.9, 0.9]), K([-0.28, 0.22, -0.16], [1.0, 0.9, -0.5])),       // taille ↗ (droite basse → gauche haute)
  ],
  // Couteau / dague (main droite ; la gauche est jouée en miroir)
  couteau: [
    A(K([0.02, 0.0, 0.12], [-0.35, 0, 0]), K([-0.04, 0.04, -0.3], [-0.4, 0.08, 0]), 0.24),          // estoc
    A(K([0.12, 0.08, 0.06], [0.1, -0.9, -1.4]), K([-0.24, -0.02, -0.12], [-0.1, 0.9, -1.3]), 0.26),   // entaille vers l'intérieur (croise)
    A(K([-0.14, -0.04, 0.02], [0.0, 0.8, 1.3]), K([0.16, 0.06, -0.12], [0.0, -0.8, 1.2]), 0.26),       // revers vers l'extérieur
    A(K([0.04, -0.14, 0.08], [-0.9, 0.1, 0.2]), K([-0.08, 0.14, -0.22], [0.7, 0.2, 0.1]), 0.26),       // remontée sous les côtes
    A(K([0.06, 0.18, 0.1], [1.4, -0.2, 0]), K([-0.06, -0.08, -0.2], [-0.8, 0.25, 0]), 0.28),           // coup de haut en bas (prise inversée)
  ],
  // Marteau, bâton : à deux mains, grands moulinets
  marteau: [
    A(K([0.04, 0.3, 0.14], [1.9, -0.1, 0]), K([-0.06, -0.22, -0.16], [-0.9, 0.15, 0.1]), 0.4),       // coup de masse vertical
    A(K([0.22, 0.08, 0.1], [0.2, -1.3, -1.4]), K([-0.3, -0.02, -0.14], [-0.1, 1.2, -1.4]), 0.38),      // balayage →←
    A(K([-0.26, 0.06, 0.06], [0.2, 1.2, 1.4]), K([0.2, -0.02, -0.14], [-0.1, -1.2, 1.4]), 0.38),       // revers ←→
    A(K([0.08, -0.2, 0.1], [-1.0, -0.3, 0.3]), K([-0.08, 0.24, -0.16], [1.2, 0.3, -0.2]), 0.36),       // uppercut
  ],
  // Lance : estocs à hauteurs variées, coup de hampe en travers
  lance: [
    A(K([0, 0, 0.22], [0, 0, 0]), K([-0.02, 0.02, -0.5], [0.02, 0.03, 0]), 0.32),                   // estoc droit
    A(K([0.02, -0.06, 0.2], [0.18, 0, 0]), K([-0.02, 0.1, -0.46], [0.14, 0.04, 0]), 0.32),          // estoc remontant (visage)
    A(K([0.02, 0.06, 0.2], [-0.12, 0, 0]), K([0, -0.06, -0.46], [-0.16, 0.02, 0]), 0.32),          // estoc bas (jambes)
    A(K([0.1, 0.04, 0.1], [0.05, -0.55, -0.3]), K([-0.2, 0.02, -0.2], [0.02, 0.55, 0.3]), 0.36),    // coup de taille en travers
  ],
};
ATTACKS.baton = ATTACKS.marteau;
ATTACKS.dagues = ATTACKS.couteau;

// Pivots (repère du porte-arme) : le poing qui tient la lame — doivent
// correspondre aux prises GRIPS de weapon.js
export const MELEE_IDS = new Set(Object.keys(ATTACKS));

const ease = (t) => t * t * (3 - 2 * t);
const strike = (t) => 1 - Math.pow(1 - t, 3); // départ sec, arrivée amortie

// Range la lame dans un pivot posé sur la prise `grip` (repère du modèle,
// = repère du porte-arme). `parts` : enfants à déplacer (défaut : tous).
function wrap(model, at, parts) {
  const pivot = new THREE.Group();
  pivot.position.fromArray(at);
  pivot.userData.home = pivot.position.clone();
  for (const c of parts) {
    pivot.add(c);
    c.position.sub(pivot.position);
  }
  model.add(pivot);
  // Pointe de la lame (sommet le plus loin du poing) : la traînée part de là
  pivot.updateMatrixWorld(true);
  const inv = pivot.matrixWorld.clone().invert(), m = new THREE.Matrix4(), v = new THREE.Vector3();
  let best = 0;
  const tip = new THREE.Vector3();
  for (const c of parts) c.traverse((o) => {
    const pos = o.geometry?.attributes?.position;
    if (!pos) return;
    m.multiplyMatrices(inv, o.matrixWorld);
    const step = Math.max(1, Math.floor(pos.count / 400));
    for (let i = 0; i < pos.count; i += step) {
      v.fromBufferAttribute(pos, i).applyMatrix4(m);
      const d = v.lengthSq();
      if (d > best) { best = d; tip.copy(v); }
    }
  });
  pivot.userData.tip = tip;
  return pivot;
}

// Prépare un modèle de mêlée : renvoie le groupe à poser dans le porte-arme
// (userData.pivots = { R, L? })
export function pivotize(id, model, grips) {
  if (!MELEE_IDS.has(id) || !grips) return model;
  const pivots = {};
  if (id === 'dagues') {
    const [dl, dr] = model.children.slice();
    pivots.L = wrap(model, grips.l.pos, [dl]);
    pivots.R = wrap(model, grips.r.pos, [dr]);
    model.userData.pivots = pivots;
    return model;
  }
  if (id === 'lance') {
    pivots.R = wrap(model, grips.r.pos, [model.children[0]]); // la lance seule, le bouclier reste
    model.userData.pivots = pivots;
    return model;
  }
  // modèle d'un bloc (rotation propre conservée) : on l'enveloppe
  const outer = new THREE.Group();
  outer.add(model);
  pivots.R = wrap(outer, grips.r.pos, [model]);
  outer.userData.pivots = pivots;
  return outer;
}

// Animation : un état par main
// TRAÎNÉE DE LAME : ruban additif entre la pointe et le tiers de la lame,
// échantillonné à chaque image pendant la frappe, qui s'efface en 0,12 s
// (repère caméra ; 1 draw call par main, seulement pendant le geste)
const TRAIL_N = 14, TRAIL_LIFE = 0.12;
function makeTrail(camera, color) {
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(TRAIL_N * 2 * 3), col = new Float32Array(TRAIL_N * 2 * 3);
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const idx = [];
  for (let i = 0; i < TRAIL_N - 1; i++) {
    const a = i * 2;
    idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  geo.setIndex(idx);
  const mat = new THREE.MeshBasicMaterial({
    vertexColors: true, transparent: true, blending: THREE.AdditiveBlending,
    depthWrite: false, side: THREE.DoubleSide, fog: false,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 5;
  mesh.visible = false;
  camera.add(mesh);
  const samples = []; // { tip, base, age }
  const c = new THREE.Color(color);
  const _t = new THREE.Vector3(), _b = new THREE.Vector3();
  return {
    // active : la lame frappe ; pv : son pivot
    step(dt, active, pv) {
      for (const sm of samples) sm.age += dt;
      while (samples.length && samples[samples.length - 1].age > (globalThis.__trailLife ?? TRAIL_LIFE)) samples.pop();
      if (active && pv?.userData.tip) {
        pv.updateMatrixWorld(true);
        _t.copy(pv.userData.tip);
        _b.copy(_t).multiplyScalar(0.4);
        pv.localToWorld(_t); pv.localToWorld(_b);
        camera.worldToLocal(_t); camera.worldToLocal(_b);
        samples.unshift({ tip: _t.clone(), base: _b.clone(), age: 0 });
        if (samples.length > TRAIL_N) samples.pop();
      }
      mesh.visible = samples.length > 1;
      if (!mesh.visible) return;
      for (let i = 0; i < TRAIL_N; i++) {
        const sm = samples[Math.min(i, samples.length - 1)];
        const f = i < samples.length ? Math.max(0, 1 - sm.age / (globalThis.__trailLife ?? TRAIL_LIFE)) * (1 - i / TRAIL_N) : 0;
        pos.set([sm.tip.x, sm.tip.y, sm.tip.z, sm.base.x, sm.base.y, sm.base.z], i * 6);
        col.set([c.r * f * 0.55, c.g * f * 0.55, c.b * f * 0.55, 0, 0, 0], i * 6);
      }
      geo.attributes.position.needsUpdate = true;
      geo.attributes.color.needsUpdate = true;
    },
  };
}

export function createMeleeAnimator(camera = null) {
  const trails = camera ? { R: makeTrail(camera, 0xcfe6ff), L: makeTrail(camera, 0xcfe6ff) } : null;
  const hands = { R: { t: 1, atk: null, last: -1, at: -10 }, L: { t: 1, atk: null, last: -1, at: -10 } };
  let side = 'L';
  globalThis.__meleeHands = hands; globalThis.__meleeAtk = ATTACKS; // ?debug
  const tmpE = new THREE.Euler();
  const tmpQ = new THREE.Quaternion();

  // Nouveau coup : renvoie la main qui frappe
  function attack(id, now) {
    const list = ATTACKS[id];
    if (!list) return null;
    side = id === 'dagues' ? (side === 'R' ? 'L' : 'R') : 'R';
    const h = hands[side];
    let i;
    // enchaînement : on frappe dans la foulée → geste suivant (les
    // ouvertures et fins de geste sont rangées pour se croiser)
    if (now - h.at < 0.75 && h.last >= 0) i = (h.last + 1 + (Math.random() < 0.3 ? 1 : 0)) % list.length;
    else { do i = Math.floor(Math.random() * list.length); while (list.length > 1 && i === h.last); }
    h.last = i;
    h.at = now;
    h.atk = list[i];
    h.t = 0;
    return side;
  }

  // Pose du pivot `p` à l'instant t (0 → 1) de l'attaque
  function poseOf(atk, t, mirror, out) {
    const P = out.p, R = out.r;
    let a, b, k;
    const rest = REST;
    if (t < 0.32) { a = rest; b = atk.wind; k = ease(t / 0.32); }
    else if (t < 0.6) { a = atk.wind; b = atk.end; k = strike((t - 0.32) / 0.28); }
    else { a = atk.end; b = rest; k = ease((t - 0.6) / 0.4); }
    for (let j = 0; j < 3; j++) {
      P[j] = a.p[j] + (b.p[j] - a.p[j]) * k;
      R[j] = a.r[j] + (b.r[j] - a.r[j]) * k;
    }
    if (mirror) { P[0] = -P[0]; R[1] = -R[1]; R[2] = -R[2]; }
    return out;
  }
  const REST = K([0, 0, 0], [0, 0, 0]);
  const pose = { p: [0, 0, 0], r: [0, 0, 0] };

  // Applique les gestes en cours aux pivots du modèle ; renvoie l'élan du
  // corps (0..1) pour un léger avancé du porte-arme
  function update(dt, pivots) {
    let lunge = 0;
    for (const s of ['R', 'L']) {
      const h = hands[s];
      const pv = pivots?.[s];
      if (globalThis.__meleeT != null && h.atk && h.at > 0) h.t = globalThis.__meleeT; // ?debug : geste figé
      else if (h.t < 1 && h.atk) h.t = Math.min(1, h.t + dt / h.atk.dur);
      if (!pv || h.t >= 1 || !h.atk) {
        trails?.[s].step(dt, false, null);
        if (!pv) continue;
        pv.position.copy(pv.userData.home);
        pv.quaternion.identity();
        continue;
      }
      poseOf(h.atk, h.t, s === 'L', pose);
      pv.position.copy(pv.userData.home);
      pv.position.x += pose.p[0]; pv.position.y += pose.p[1]; pv.position.z += pose.p[2];
      tmpE.set(pose.r[0], pose.r[1], pose.r[2], 'YXZ');
      pv.quaternion.copy(tmpQ.setFromEuler(tmpE));
      trails?.[s].step(dt, h.t > 0.3 && h.t < 0.66, pv);
      lunge = Math.max(lunge, Math.sin(Math.min(1, h.t / 0.6) * Math.PI));
    }
    return lunge;
  }

  return { attack, update, get busy() { return hands.R.t < 1 || hands.L.t < 1; } };
}
