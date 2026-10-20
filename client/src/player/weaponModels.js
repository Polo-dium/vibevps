import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { PBR, profileGeo, roundedRect } from '../render/materials.js';

// --- Modèles d'armes détaillés -------------------------------------------
// Silhouettes en PROFILS EXTRUDÉS biseautés (crosse, carcasse, chargeur
// courbe…) plutôt qu'en boîtes, matériaux PBR procéduraux (acier bronzé,
// bois verni, polymère grainé — voir render/materials.js). Chaque modèle
// est ensuite « cuit » : une géométrie fusionnée par matériau, donc 3 à 5
// draw calls par arme, y compris dans les mains des joueurs distants.
// Repère : -z = vers le canon, y = haut, x = droite. u = distance vers
// l'avant (u > 0 → z < 0), v = hauteur.

export function buildWeaponModel(id) {
  switch (id) {
    case 'marteau': return buildMarteauModel();
    case 'pompe': return buildPompeModel();
    case 'minigun': return buildMinigunModel();
    case 'bazooka': return buildBazookaModel();
    case 'akimbo': return buildAkimboModel();
    case 'sniper': return buildSniperModel();
    case 'baton': return buildBatonModel();
    default: return buildAkModel();
  }
}

// Outils de modelage : tout s'exprime en (u, v) comme sur un plan d'armurier
function kit() {
  const parts = []; // { geo, mat }
  const place = (geo, mat, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) => {
    const m = new THREE.Matrix4().compose(
      new THREE.Vector3(x, y, z),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)),
      new THREE.Vector3(1, 1, 1)
    );
    parts.push({ geo: geo.applyMatrix4(m), mat });
  };
  return {
    place,
    prof(points, width, mat, x = 0, opts) { place(profileGeo(points, width, opts), mat, x); },
    // Cylindre couché le long du canon, de u0 à u1, à la hauteur v ;
    // r = rayon côté bouche (u1), r2 = rayon côté crosse (u0)
    tube(r, u0, u1, v, mat, x = 0, seg = 14, r2 = r) {
      place(new THREE.CylinderGeometry(r2, r, u1 - u0, seg), mat, x, v, -(u0 + u1) / 2, Math.PI / 2);
    },
    box(u0, u1, v0, v1, w, mat, x = 0) {
      place(new THREE.BoxGeometry(w, v1 - v0, u1 - u0), mat, x, (v0 + v1) / 2, -(u0 + u1) / 2);
    },
    bake() {
      const byMat = new Map();
      for (const { geo, mat } of parts) {
        const g = geo.index ? geo.toNonIndexed() : geo;
        for (const name of Object.keys(g.attributes)) {
          if (!['position', 'normal', 'uv'].includes(name)) g.deleteAttribute(name);
        }
        if (!byMat.has(mat)) byMat.set(mat, []);
        byMat.get(mat).push(g);
      }
      const group = new THREE.Group();
      for (const [mat, geos] of byMat) {
        const mesh = new THREE.Mesh(mergeGeometries(geos), mat);
        group.add(mesh);
      }
      return group;
    },
  };
}

// Pontet en U (profil) entre u0 et u1, sous la carcasse à v0
function triggerGuard(k, u0, u1, v0, mat, t = 0.006) {
  const d = 0.034;
  k.prof([
    [u0, v0], [u0 + t, v0], [u0 + t, v0 - d + t], [u1 - t, v0 - d + t],
    [u1 - t, v0], [u1, v0], [u1, v0 - d], [u0, v0 - d],
  ], 0.012, mat, 0, { bevel: 0.002 });
  const um = (u0 + u1) / 2;
  k.prof([[um - 0.004, v0], [um + 0.005, v0], [um, v0 - 0.024], [um - 0.007, v0 - 0.021]], 0.008, mat, 0, { bevel: 0.0015 });
}

// AK-47 : boîtier embouti, couvercle de culasse bombé, bois verni,
// chargeur « banane » en bakélite, frein de bouche, guidon à oreilles.
function buildAkModel() {
  const k = kit();
  const steel = PBR.gunmetal(0x2a2b2f);
  const black = PBR.gunmetal(0x17181b);
  const wood = PBR.wood(0xa8642c);
  const bakelite = PBR.polymer(0x7a3a1c);

  // Boîtier + couvercle de culasse
  k.prof([[0, -0.034], [0.34, -0.034], [0.34, 0.02], [0.02, 0.022], [0, 0.016]], 0.046, steel, 0, { bevel: 0.003 });
  k.prof(roundedRect(0.015, 0.012, 0.31, 0.044, 0.013), 0.042, steel, 0, { bevel: 0.005, segments: 3 });
  k.box(0.04, 0.29, 0.043, 0.047, 0.006, black); // nervure du couvercle
  // Bloc de hausse + feuille de hausse
  k.prof([[0.33, -0.02], [0.4, -0.02], [0.4, 0.034], [0.37, 0.05], [0.33, 0.05]], 0.038, steel, 0, { bevel: 0.003 });
  k.box(0.35, 0.375, 0.05, 0.057, 0.03, black);
  // Garde-mains bois (bas + haut autour du tube emprunt de gaz)
  k.prof(roundedRect(0.4, -0.042, 0.545, 0.012, 0.013), 0.054, wood, 0, { bevel: 0.008, segments: 3 });
  k.prof(roundedRect(0.4, 0.02, 0.525, 0.05, 0.013), 0.04, wood, 0, { bevel: 0.006, segments: 3 });
  for (const v of [-0.026, -0.01]) k.box(0.415, 0.53, v, v + 0.004, 0.0565, black); // rainures
  k.tube(0.011, 0.4, 0.6, 0.035, steel);
  // Canon, bloc de guidon, frein de bouche
  k.tube(0.0095, 0.34, 0.66, 0, black);
  k.prof([[0.575, -0.013], [0.615, -0.013], [0.615, 0.046], [0.6, 0.06], [0.59, 0.06], [0.58, 0.046], [0.575, 0.046]],
    0.026, steel, 0, { bevel: 0.003 });
  for (const x of [-0.011, 0.011]) k.box(0.594, 0.606, 0.046, 0.074, 0.004, black, x); // oreilles
  k.box(0.597, 0.603, 0.046, 0.068, 0.003, black); // guidon
  k.tube(0.014, 0.655, 0.71, 0, black, 0, 14);
  // Chargeur courbe : axe incurvé échantillonné
  const back = [], front = [];
  for (let i = 0; i <= 10; i++) {
    const t = i / 10;
    const cu = 0.165 + 0.1 * Math.pow(t, 1.5), cv = -0.03 - 0.19 * t;
    back.push([cu - 0.038, cv]);
    front.unshift([cu + 0.038 + 0.004 * t, cv]);
  }
  k.prof([...back, ...front], 0.032, bakelite, 0, { bevel: 0.004 });
  k.box(0.17, 0.205, -0.05, -0.034, 0.034, black); // lèvres du chargeur
  // Poignée pistolet + pontet + détente
  k.prof([[0.055, -0.034], [0.105, -0.034], [0.085, -0.148], [0.05, -0.153], [0.033, -0.142]], 0.034, bakelite, 0, { bevel: 0.007, segments: 3 });
  triggerGuard(k, 0.098, 0.168, -0.034, black);
  // Crosse bois + plaque de couche
  k.prof([[0, 0.026], [0, -0.034], [-0.04, -0.05], [-0.2, -0.1], [-0.214, -0.1], [-0.214, 0.012], [-0.2, 0.016], [-0.05, 0.019]],
    0.04, wood, 0, { bevel: 0.008, segments: 3 });
  k.box(-0.222, -0.213, -0.099, 0.011, 0.042, black);
  // Levier d'armement + sélecteur (flanc droit)
  k.place(new THREE.CylinderGeometry(0.006, 0.007, 0.03, 8), steel, 0.036, 0.012, -0.28, 0, 0, Math.PI / 2);
  k.box(0.05, 0.22, -0.006, 0.001, 0.004, steel, 0.025);
  // Rivets du boîtier
  for (const u of [0.05, 0.12, 0.26, 0.31]) {
    k.place(new THREE.CylinderGeometry(0.004, 0.004, 0.05, 6), black, 0, -0.022, -u, 0, 0, Math.PI / 2);
  }
  return k.bake();
}

// Fusil à pompe : carcasse usinée, pompe striée, tube magasin, crosse bois
function buildPompeModel() {
  const k = kit();
  const steel = PBR.gunmetal(0x2d2f33);
  const black = PBR.gunmetal(0x18191c);
  const wood = PBR.wood(0x9a5a28);
  const poly = PBR.polymer(0x232427);

  k.prof([[-0.01, -0.038], [0.22, -0.038], [0.22, 0.026], [0.2, 0.034], [0.02, 0.034], [-0.01, 0.02]], 0.05, steel, 0, { bevel: 0.004 });
  k.box(0.04, 0.16, 0.008, 0.02, 0.051, black); // fenêtre d'éjection
  k.tube(0.0135, 0.22, 0.68, 0.012, black);
  k.tube(0.0125, 0.22, 0.6, -0.022, steel);
  k.tube(0.0145, 0.585, 0.605, -0.022, black); // bouchon de magasin
  k.place(new THREE.SphereGeometry(0.004, 8, 6), PBR.steel(0xd8d0b0), 0, 0.028, -0.67); // guidon bille
  // Pompe striée
  k.prof(roundedRect(0.33, -0.05, 0.5, 0.004, 0.018), 0.056, poly, 0, { bevel: 0.006, segments: 3 });
  for (let u = 0.345; u < 0.49; u += 0.018) k.box(u, u + 0.007, -0.048, 0.002, 0.0585, black);
  // Poignée, pontet, crosse
  k.prof([[0.0, -0.035], [0.05, -0.035], [0.035, -0.12], [0.0, -0.13], [-0.02, -0.11]], 0.034, wood, 0, { bevel: 0.007, segments: 3 });
  triggerGuard(k, 0.05, 0.12, -0.038, black);
  k.prof([[-0.01, 0.02], [-0.01, -0.06], [-0.22, -0.11], [-0.235, -0.11], [-0.235, 0.012], [-0.22, 0.016]], 0.042, wood, 0, { bevel: 0.009, segments: 3 });
  k.box(-0.245, -0.234, -0.11, 0.012, 0.044, poly); // talon caoutchouc
  return k.bake();
}

// Fusil de précision : châssis vert olive à crosse évidée, canon lourd,
// frein de bouche, lunette avec tourelles et objectif, verrou à boule.
function buildSniperModel() {
  const k = kit();
  const olive = PBR.paint(0x4a5536);
  const steel = PBR.gunmetal(0x26282c);
  const black = PBR.gunmetal(0x141518);
  const lens = PBR.glass(0x3d7fa6);

  // Châssis : crosse évidée (trou de pouce) jusqu'au fût
  k.prof([[-0.2, -0.11], [-0.2, 0.026], [0.0, 0.03], [0.4, 0.03], [0.43, 0.005], [0.43, -0.03], [0.12, -0.035],
    [0.085, -0.14], [0.045, -0.14], [0.03, -0.06], [-0.07, -0.07], [-0.19, -0.11]], 0.05, olive, 0,
  { bevel: 0.007, segments: 3, holes: [[[-0.1, -0.045], [-0.02, -0.035], [0.01, -0.02], [-0.1, -0.025]]] });
  k.box(-0.21, -0.198, -0.11, 0.026, 0.052, PBR.polymer(0x1a1a1a)); // talon
  // Boîtier + verrou
  k.tube(0.022, 0.0, 0.3, 0.04, steel);
  k.place(new THREE.CylinderGeometry(0.005, 0.005, 0.06, 8), steel, 0.04, 0.04, -0.06, 0, 0, Math.PI / 2);
  k.place(new THREE.SphereGeometry(0.011, 10, 8), black, 0.07, 0.04, -0.06);
  triggerGuard(k, 0.1, 0.16, -0.033, black);
  // Canon lourd + frein de bouche
  k.tube(0.012, 0.3, 0.98, 0.032, black, 0, 14, 0.0145);
  k.tube(0.02, 0.98, 1.05, 0.032, black);
  for (const u of [0.995, 1.015, 1.035]) k.box(u, u + 0.008, 0.026, 0.038, 0.042, steel);
  // Lunette : tube, objectif évasé, oculaire, tourelles, colliers
  k.tube(0.018, 0.02, 0.32, 0.098, black);
  k.tube(0.03, 0.32, 0.39, 0.098, black, 0, 16, 0.018);
  k.tube(0.018, -0.03, 0.03, 0.098, black, 0, 16, 0.024);
  k.tube(0.027, 0.385, 0.392, 0.098, lens, 0, 16);
  k.tube(0.021, -0.035, -0.03, 0.098, lens, 0, 16);
  k.place(new THREE.CylinderGeometry(0.012, 0.012, 0.022, 12), steel, 0, 0.125, -0.17);
  k.place(new THREE.CylinderGeometry(0.012, 0.012, 0.022, 12), steel, 0.028, 0.098, -0.17, 0, 0, Math.PI / 2);
  for (const u of [0.06, 0.25]) k.box(u, u + 0.018, 0.06, 0.084, 0.03, steel);
  // Bipied replié
  for (const sx of [-1, 1]) {
    k.place(new THREE.CylinderGeometry(0.005, 0.005, 0.18, 8), black, sx * 0.014, -0.04, -0.5, Math.PI / 2 - 0.12);
  }
  return k.bake();
}

// Deux pistolets polymère (un par poing, x = ±0,16 — voir les prises akimbo
// posées sur holder.userData.grips dans weapon.js)
function buildAkimboModel() {
  const k = kit();
  const slide = PBR.gunmetal(0x2c2e33);
  const frame = PBR.polymer(0x1d1e21);
  const black = PBR.gunmetal(0x121316);
  for (const side of [-1, 1]) {
    const x = side * 0.16;
    const y = 0.0;
    // Culasse avec stries de préhension
    k.prof(roundedRect(0.195, y + 0.012, 0.405, y + 0.05, 0.006), 0.03, slide, x, { bevel: 0.003 });
    for (let u = 0.205; u < 0.25; u += 0.009) k.box(u, u + 0.004, y + 0.016, y + 0.046, 0.0315, black, x);
    k.box(0.36, 0.37, y + 0.05, y + 0.056, 0.004, black, x); // guidon
    k.box(0.205, 0.215, y + 0.05, y + 0.056, 0.02, black, x); // hausse
    k.tube(0.007, 0.4, 0.425, y + 0.028, black, x);
    // Carcasse + poignée inclinée
    k.prof([[0.2, y + 0.012], [0.4, y + 0.012], [0.4, y - 0.004], [0.28, y - 0.01], [0.255, y - 0.012],
      [0.235, y - 0.11], [0.195, y - 0.113], [0.185, y - 0.1], [0.195, y - 0.02]], 0.028, frame, x, { bevel: 0.005, segments: 2 });
    triggerGuard(k, 0.255, 0.31, y - 0.006, frame);
  }
  return k.bake();
}

// Marteau de chantier : manche bois, tête acier en T (posée de chant)
function buildMarteauModel() {
  const k = kit();
  const wood = PBR.wood(0x9a6a35);
  const steel = PBR.steel(0x7d848e);
  const grip = PBR.polymer(0x9b2a22);
  k.tube(0.019, 0.06, 0.56, -0.05, wood, 0, 12, 0.023);
  k.tube(0.025, 0.06, 0.2, -0.05, grip, 0, 12); // poignée caoutchouc
  k.place(new THREE.BoxGeometry(0.17, 0.062, 0.062), steel, 0, -0.05, -0.54);
  k.place(new THREE.CylinderGeometry(0.042, 0.048, 0.05, 14), steel, 0.1, -0.05, -0.54, 0, 0, Math.PI / 2);
  k.place(new THREE.CylinderGeometry(0.046, 0.046, 0.012, 14), steel, 0.13, -0.05, -0.54, 0, 0, Math.PI / 2);
  k.place(new THREE.ConeGeometry(0.03, 0.08, 4), steel, -0.12, -0.05, -0.54, 0, 0, Math.PI / 2);
  const g = k.bake();
  g.rotation.z = -Math.PI / 2; // tête verticale, on frappe à plat
  return g;
}

// La tavelle de Guignol : bâton de théâtre, poignée gainée, ruban rouge
function buildBatonModel() {
  const k = kit();
  k.tube(0.02, 0.0, 0.72, -0.03, PBR.wood(0xa87b42), 0, 10, 0.024);
  k.tube(0.028, -0.03, 0.11, -0.03, PBR.fabric(0x54371e), 0, 10);
  k.tube(0.026, 0.62, 0.66, -0.03, PBR.fabric(0xa62633), 0, 10);
  return k.bake();
}

// Minigun : moteur, poignée de transport, faisceau de 6 canons cerclés
function buildMinigunModel() {
  const k = kit();
  const body = PBR.paint(0x3a4048);
  const black = PBR.gunmetal(0x18191c);
  const accent = PBR.paint(0x8a2f2f);
  k.tube(0.062, -0.02, 0.2, 0, body, 0, 18, 0.066);
  k.prof(roundedRect(-0.08, -0.07, 0.04, 0.04, 0.015), 0.085, accent, 0, { bevel: 0.006 });
  k.prof([[-0.04, 0.04], [-0.03, 0.1], [0.12, 0.1], [0.13, 0.06], [0.11, 0.06], [0.1, 0.085], [-0.01, 0.085], [-0.02, 0.04]], 0.016, black, 0, { bevel: 0.003 });
  k.tube(0.012, 0.2, 0.64, 0, black);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    k.tube(0.011, 0.2, 0.62, Math.sin(a) * 0.032, black, Math.cos(a) * 0.032, 8);
  }
  for (const u of [0.3, 0.6]) k.tube(0.05, u - 0.015, u + 0.015, 0, body, 0, 18);
  return k.bake();
}

// Bazooka : tube olive, évasements, ogive, poignées, viseur rabattable
function buildBazookaModel() {
  const k = kit();
  const olive = PBR.paint(0x5c6b3c);
  const black = PBR.gunmetal(0x1a1b1e);
  const warhead = PBR.paint(0x9aa38f);
  const x = 0.02, v = 0.06;
  k.tube(0.055, -0.25, 0.65, v, olive, x, 20);
  k.tube(0.075, 0.63, 0.73, v, olive, x, 20, 0.055);
  k.tube(0.055, -0.33, -0.23, v, olive, x, 20, 0.075);
  for (const u of [-0.15, 0.2, 0.5]) k.tube(0.059, u, u + 0.02, v, black, x, 20);
  k.place(new THREE.ConeGeometry(0.045, 0.14, 12), warhead, x, v, -0.8, -Math.PI / 2);
  k.prof([[0.08, -0.0], [0.12, 0.0], [0.105, -0.1], [0.07, -0.1]], 0.03, black, x, { bevel: 0.005 });
  k.prof([[0.3, 0.0], [0.34, 0.0], [0.33, -0.08], [0.295, -0.08]], 0.03, black, x, { bevel: 0.005 });
  k.box(0.28, 0.32, v + 0.055, v + 0.11, 0.004, black, x);
  k.prof(roundedRect(-0.1, 0.0, 0.1, 0.03, 0.01), 0.05, PBR.polymer(0x2a2a2a), x, { bevel: 0.006 }); // épaulière
  return k.bake();
}
