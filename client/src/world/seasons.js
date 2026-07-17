import * as THREE from 'three';

// Les SAISONS RÉELLES 🍂 : la ville suit le calendrier du joueur. Été =
// les verts d'origine ; automne = feuillages roux ; hiver = végétation
// pâle et givrée ; printemps = verts frais et clairs. On recolore d'un
// seul passage tous les « verts végétaux » de la scène (matériaux ET
// couleurs d'instances) — arbres, prairies, collines suivent ensemble.
export function currentSeason(date = new Date()) {
  const m = date.getMonth(); // 0 = janvier
  if (m === 11 || m <= 1) return 'hiver';
  if (m <= 4) return 'printemps';
  if (m <= 7) return 'ete';
  return 'automne';
}

const _hsl = { h: 0, s: 0, l: 0 };
function recolor(color, season) {
  color.getHSL(_hsl);
  // Feuillage/herbe : teinte franchement verte et un minimum saturée.
  if (_hsl.h < 0.17 || _hsl.h > 0.45 || _hsl.s < 0.15) return false;
  if (season === 'automne') {
    color.setHSL(0.06 + (_hsl.h - 0.17) * 0.12, Math.min(1, _hsl.s * 1.05), _hsl.l);
  } else if (season === 'hiver') {
    color.setHSL(_hsl.h, _hsl.s * 0.22, Math.min(0.82, _hsl.l * 1.45));
  } else { // printemps
    color.setHSL(_hsl.h + 0.02, Math.min(1, _hsl.s * 1.12), Math.min(0.72, _hsl.l * 1.15));
  }
  return true;
}

export function applySeason(ctx) {
  const season = currentSeason();
  if (season === 'ete') return season;
  const done = new Set();
  const c = new THREE.Color();
  ctx.scene.traverse((o) => {
    const mats = Array.isArray(o.material) ? o.material : (o.material ? [o.material] : []);
    for (const m of mats) {
      if (!m?.color || done.has(m)) continue;
      done.add(m);
      recolor(m.color, season);
    }
    if (o.isInstancedMesh && o.instanceColor) {
      let changed = false;
      for (let i = 0; i < o.count; i++) {
        o.getColorAt(i, c);
        if (recolor(c, season)) {
          o.setColorAt(i, c);
          changed = true;
        }
      }
      if (changed) o.instanceColor.needsUpdate = true;
    }
  });
  return season;
}
