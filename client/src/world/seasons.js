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
// Automne d'un arbre à l'autre : on ne passe pas tout au même roux. Par
// hash de l'indice : ~15 % restent verts (platanes tardifs), puis jaune
// d'or, orangé, cuivre et quelques rouges francs (érables).
function autumnVariant(color, i) {
  const h = (((i * 2654435761) >>> 0) % 1000) / 1000;
  color.getHSL(_hsl);
  if (h < 0.15) return false; // encore vert
  const l = Math.min(0.58, 0.34 + _hsl.l * 0.6);
  if (h < 0.45) color.setHSL(0.12 + (h - 0.15) * 0.06, 0.75, l + 0.04);   // or
  else if (h < 0.75) color.setHSL(0.075 + (h - 0.45) * 0.08, 0.78, l);    // orangé
  else if (h < 0.92) color.setHSL(0.045, 0.6, l - 0.06);                  // cuivre
  else color.setHSL(0.005, 0.7, l - 0.04);                                 // rouge
  return true;
}

function recolor(color, season) {
  color.getHSL(_hsl);
  // Feuillage/herbe : teinte franchement verte et un minimum saturée.
  if (_hsl.h < 0.17 || _hsl.h > 0.45 || _hsl.s < 0.15) return false;
  if (season === 'automne') {
    // roux → or selon la teinte d'origine, plus lumineux qu'un vert d'été
    color.setHSL(0.055 + (_hsl.h - 0.17) * 0.25, Math.min(1, _hsl.s * 1.35 + 0.1), Math.min(0.6, _hsl.l * 1.3));
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
    const perInstance = o.isInstancedMesh && o.instanceColor;
    // couleurs d'instance : même drapeau noSeason (persistants des jardins)
    const evergreen = mats.some((m) => m?.userData?.noSeason);
    for (const m of mats) {
      if (!m?.color || done.has(m) || m.userData?.noSeason) continue;
      done.add(m);
      // Un matériau teinté PAR INSTANCE : seule la couleur d'instance
      // change. Recolorer les deux multipliait roux × roux = brun sombre
      // (les arbres sortaient en boules marron à l'automne).
      if (perInstance && season === 'automne') {
        m.color.getHSL(_hsl);
        if (_hsl.h > 0.17 && _hsl.h < 0.45) m.color.setHSL(0, 0, Math.min(0.8, 0.45 + _hsl.l));
        continue;
      }
      recolor(m.color, season);
    }
    if (perInstance && !evergreen) {
      let changed = false;
      for (let i = 0; i < o.count; i++) {
        o.getColorAt(i, c);
        if (!(c.getHSL(_hsl), _hsl.h >= 0.17 && _hsl.h <= 0.45 && _hsl.s >= 0.15)) continue;
        if (season === 'automne' ? autumnVariant(c, i) : recolor(c, season)) {
          o.setColorAt(i, c);
          changed = true;
        }
      }
      if (changed) o.instanceColor.needsUpdate = true;
    }
  });
  return season;
}
