import * as THREE from 'three';
import { PBR, roundedRect } from '../render/materials.js';
import { kit, triggerGuard } from './weaponModels.js';

// ARSENAL DE L'ARÈNE — modèles détaillés. Même atelier que l'AK
// (weaponModels.js) : tout se dessine en (u, v) comme sur un plan
// d'armurier — u le long du canon (0 = arrière du boîtier, la bouche vers
// les u positifs), v la hauteur (0 = axe du canon) — par profils extrudés
// et biseautés, puis fusion par matériau (2 à 4 draw calls par arme).

// Optiques : paroi de tube vue des deux côtés, lentille quasi transparente,
// point rouge lumineux
const TUBE = new THREE.MeshStandardMaterial({ color: 0x141517, metalness: 0.6, roughness: 0.5, side: THREE.DoubleSide });
const LENS = new THREE.MeshBasicMaterial({ color: 0x9fc4d8, transparent: true, opacity: 0.08, depthWrite: false });
const DOT = new THREE.MeshBasicMaterial({ color: 0xff2a1a });

// Chargeur droit ou courbe : axe échantillonné, comme celui de l'AK
function magazine(k, mat, { u = 0.2, w = 0.03, len = 0.16, curve = 0.02, top = -0.03, half = 0.028 }) {
  const back = [], front = [];
  for (let i = 0; i <= 8; i++) {
    const t = i / 8;
    const cu = u + curve * Math.pow(t, 1.6), cv = top - len * t;
    back.push([cu - half, cv]);
    front.unshift([cu + half, cv]);
  }
  k.prof([...back, ...front], w, mat, 0, { bevel: 0.003 });
}
// Poignée pistolet inclinée, striée
function grip(k, mat, dark, u = 0.06, v = -0.03) {
  k.prof([[u, v], [u + 0.048, v], [u + 0.03, v - 0.105], [u - 0.004, v - 0.11], [u - 0.02, v - 0.1]], 0.032, mat, 0, { bevel: 0.006, segments: 3 });
  for (let i = 0; i < 4; i++) k.box(u - 0.012 + i * 0.004, u + 0.036 - i * 0.004, v - 0.03 - i * 0.018, v - 0.026 - i * 0.018, 0.0335, dark);
}
// Rail Picatinny (créneaux) de u0 à u1 à la hauteur v
function rail(k, mat, u0, u1, v, w = 0.02) {
  k.box(u0, u1, v, v + 0.006, w, mat);
  for (let u = u0 + 0.004; u < u1 - 0.006; u += 0.012) k.box(u, u + 0.006, v + 0.006, v + 0.011, w, mat);
}
// Cache-flamme à fentes
function flashHider(k, mat, dark, u0, len = 0.045, r = 0.013) {
  k.tube(r, u0, u0 + len, 0, mat, 0, 12);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + 0.4;
    k.box(u0 + 0.01, u0 + len - 0.006, Math.sin(a) * r - 0.002, Math.sin(a) * r + 0.002, 0.004, dark, Math.cos(a) * r);
  }
}

// --- M16 : poignée de transport, garde-main triangulaire, crosse fixe ---------
export function buildM16Model() {
  const k = kit();
  const black = PBR.gunmetal(0x1b1c1f), dark = PBR.gunmetal(0x101113), poly = PBR.polymer(0x1c1d20);
  // carcasses haute et basse
  k.prof([[0, -0.032], [0.2, -0.032], [0.215, -0.044], [0.27, -0.044], [0.27, -0.02], [0.3, -0.02], [0.3, 0.026], [0, 0.026]], 0.04, black, 0, { bevel: 0.003 });
  k.prof(roundedRect(0.02, 0.024, 0.3, 0.036, 0.004), 0.034, black, 0, { bevel: 0.003 });
  k.box(0.13, 0.2, 0.0, 0.016, 0.042, dark); // fenêtre d'éjection
  k.place(new THREE.CylinderGeometry(0.008, 0.008, 0.012, 10), dark, 0.024, 0.0, -0.06, 0, 0, Math.PI / 2); // assistance de culasse
  // poignée de transport + hausse
  k.prof([[0.03, 0.036], [0.05, 0.036], [0.065, 0.07], [0.215, 0.07], [0.235, 0.036], [0.255, 0.036], [0.23, 0.084], [0.05, 0.084]], 0.022, black, 0, { bevel: 0.003 });
  // hausse : œilleton (anneau) entre deux oreilles — on voit le guidon au travers
  for (const x of [-0.011, 0.011]) k.box(0.055, 0.085, 0.084, 0.1, 0.004, dark, x);
  k.place(new THREE.TorusGeometry(0.0055, 0.002, 6, 14), dark, 0, 0.091, -0.07);
  // garde-main triangulaire nervuré
  k.prof([[0.3, -0.04], [0.6, -0.034], [0.6, 0.028], [0.3, 0.03]], 0.05, poly, 0, { bevel: 0.01, segments: 3 });
  for (let u = 0.32; u < 0.59; u += 0.03) k.box(u, u + 0.012, -0.038, 0.027, 0.0525, dark);
  k.tube(0.027, 0.6, 0.612, 0, black, 0, 12); // bague avant
  // canon, tour de guidon, tenon de baïonnette, cache-flamme
  k.tube(0.0095, 0.3, 0.86, 0, dark);
  k.prof([[0.66, -0.012], [0.7, -0.012], [0.692, 0.07], [0.672, 0.07]], 0.018, black, 0, { bevel: 0.002 });
  k.box(0.679, 0.685, 0.07, 0.087, 0.003, dark); // guidon : 4 mm sous la ligne de mire
  k.box(0.7, 0.725, -0.022, -0.012, 0.012, black);
  flashHider(k, black, dark, 0.85);
  // chargeur, poignée, pontet
  magazine(k, PBR.gunmetal(0x26282b), { u: 0.24, len: 0.15, curve: 0.022, top: -0.044, half: 0.026 });
  grip(k, poly, dark, 0.045, -0.032);
  triggerGuard(k, 0.092, 0.2, -0.032, black);
  // tube tampon + crosse fixe + plaque de couche
  k.tube(0.014, -0.06, 0, 0.004, dark);
  k.prof([[0, 0.022], [0, -0.03], [-0.05, -0.036], [-0.25, -0.085], [-0.262, -0.085], [-0.262, 0.03], [-0.05, 0.03]], 0.038, poly, 0, { bevel: 0.007, segments: 3 });
  k.box(-0.27, -0.261, -0.084, 0.029, 0.04, dark);
  return k.bake();
}

// --- M4 : crosse télescopique, rails, poignée avant, viseur point rouge -------
export function buildM4Model() {
  const k = kit();
  const black = PBR.gunmetal(0x1b1c1f), dark = PBR.gunmetal(0x101113), tan = PBR.polymer(0x74694f), poly = PBR.polymer(0x1c1d20);
  k.prof([[0, -0.032], [0.2, -0.032], [0.215, -0.044], [0.27, -0.044], [0.27, -0.02], [0.3, -0.02], [0.3, 0.026], [0, 0.026]], 0.04, black, 0, { bevel: 0.003 });
  k.box(0.13, 0.2, 0.0, 0.016, 0.042, dark);
  rail(k, black, 0.01, 0.3, 0.026);
  // garde-main à quatre rails
  k.prof(roundedRect(0.3, -0.03, 0.5, 0.03, 0.008), 0.046, tan, 0, { bevel: 0.006, segments: 3 });
  rail(k, black, 0.3, 0.5, 0.03);
  k.box(0.31, 0.49, -0.036, -0.03, 0.02, black);
  for (const x of [-0.025, 0.025]) k.box(0.31, 0.49, -0.006, 0.006, 0.006, black, x);
  // poignée avant verticale
  k.prof([[0.37, -0.036], [0.41, -0.036], [0.405, -0.125], [0.375, -0.125]], 0.028, tan, 0, { bevel: 0.006, segments: 3 });
  // viseur point rouge : embase, tube, lentille
  k.box(0.1, 0.19, 0.037, 0.05, 0.03, dark);
  // tube CREUX (ouvert aux deux bouts, paroi visible dedans) : on vise au
  // travers ; lentille presque invisible et point rouge au centre
  k.place(new THREE.CylinderGeometry(0.021, 0.021, 0.11, 18, 1, true), TUBE, 0, 0.073, -0.145, Math.PI / 2);
  for (const u of [0.09, 0.2]) k.place(new THREE.TorusGeometry(0.021, 0.0025, 6, 18), black, 0, 0.073, -u);
  k.place(new THREE.CircleGeometry(0.0195, 18), LENS, 0, 0.073, -0.196);
  k.place(new THREE.CircleGeometry(0.0011, 8), DOT, 0, 0.073, -0.195);
  k.place(new THREE.CylinderGeometry(0.008, 0.008, 0.016, 8), dark, 0, 0.1, -0.145);
  // canon court, guidon rabattable, cache-flamme
  k.tube(0.0095, 0.3, 0.68, 0, dark);
  k.prof([[0.535, -0.012], [0.565, -0.012], [0.56, 0.064], [0.542, 0.064]], 0.018, black, 0, { bevel: 0.002 });
  flashHider(k, black, dark, 0.67);
  magazine(k, PBR.gunmetal(0x26282b), { u: 0.24, len: 0.15, curve: 0.022, top: -0.044, half: 0.026 });
  grip(k, tan, dark, 0.045, -0.032);
  triggerGuard(k, 0.092, 0.2, -0.032, black);
  // tube tampon + crosse télescopique ajourée
  k.tube(0.013, -0.2, 0, 0.004, dark);
  k.prof([[-0.09, 0.03], [-0.09, -0.02], [-0.12, -0.03], [-0.21, -0.085], [-0.225, -0.085], [-0.225, 0.03]], 0.036, tan, 0, { bevel: 0.006, segments: 3 });
  k.box(-0.232, -0.224, -0.084, 0.029, 0.038, dark);
  k.box(-0.14, -0.1, -0.03, -0.024, 0.012, black); // levier de réglage
  return k.bake();
}

// Arc échantillonné (dessus bombé) : points de (u0, v) à (u1, v) avec une flèche h
const arc = (u0, u1, v, h, n = 8) => Array.from({ length: n + 1 }, (_, i) => {
  const t = i / n;
  return [u0 + (u1 - u0) * t, v + h * Math.sin(t * Math.PI)];
});

// --- MP5A2 : boîtier embouti mince, tube d'armement AU-DESSUS du canon avec son
// levier à gauche, guidon sous anneau, hausse tambour, garde-main « tropical »
// galbé, chargeur courbe de 30, bloc détente polymère, crosse fixe pleine ---
export function buildMp5Model() {
  const k = kit();
  const black = PBR.gunmetal(0x1b1c1f), dark = PBR.gunmetal(0x0e0f11), poly = PBR.polymer(0x17181a);
  // boîtier : tôle emboutie mince, nervures horizontales, capot arrière
  k.prof(roundedRect(0, -0.022, 0.31, 0.03, 0.008), 0.036, black, 0, { bevel: 0.005, segments: 3 });
  for (const v of [-0.008, 0.008]) k.box(0.03, 0.2, v, v + 0.003, 0.0375, dark);
  k.box(0.13, 0.2, 0.012, 0.027, 0.0375, dark);                        // fenêtre d'éjection
  k.prof(roundedRect(-0.012, -0.024, 0.004, 0.032, 0.005), 0.04, black, 0, { bevel: 0.003 }); // capot arrière
  // tube d'armement, plus haut et plus long que le boîtier, bouché à l'avant
  k.tube(0.0125, 0.24, 0.52, 0.043, black, 0, 14);
  k.tube(0.0135, 0.515, 0.527, 0.043, dark, 0, 14);
  k.box(0.4, 0.5, 0.039, 0.047, 0.004, dark, -0.0125);                 // lumière du levier
  k.place(new THREE.CylinderGeometry(0.0055, 0.0055, 0.03, 8), dark, -0.028, 0.043, -0.47, 0, 0, Math.PI / 2); // levier (à gauche, vers l'avant)
  k.place(new THREE.SphereGeometry(0.008, 8, 6), dark, -0.044, 0.043, -0.47);
  // hausse à tambour sur son embase
  k.box(0.02, 0.07, 0.03, 0.04, 0.03, black);
  k.place(new THREE.CylinderGeometry(0.014, 0.014, 0.022, 14), dark, 0, 0.052, -0.045);
  // tour de guidon : anneau protecteur + guidon, à cheval sur le tube
  k.prof([[0.488, 0.03], [0.512, 0.03], [0.508, 0.062], [0.492, 0.062]], 0.03, black, 0, { bevel: 0.002 });
  k.place(new THREE.TorusGeometry(0.0125, 0.0035, 6, 16), black, 0, 0.074, -0.5, 0, Math.PI / 2);
  k.box(0.498, 0.502, 0.062, 0.071, 0.003, dark);
  // garde-main « tropical » : large, galbé, strié
  k.prof([[0.31, -0.018], [0.33, -0.042], [0.47, -0.046], [0.49, -0.03], [0.49, 0.026], [0.31, 0.026]], 0.05, poly, 0, { bevel: 0.011, segments: 3 });
  for (let u = 0.34; u < 0.47; u += 0.022) k.box(u, u + 0.007, -0.045, -0.01, 0.0515, dark);
  // canon court qui dépasse, trois tenons
  k.tube(0.0085, 0.31, 0.575, 0.004, dark);
  k.tube(0.0115, 0.545, 0.556, 0.004, black, 0, 10);
  // bloc détente polymère : puits de chargeur à l'avant, poignée galbée, sélecteur
  k.prof([[0.035, -0.022], [0.3, -0.022], [0.3, -0.052], [0.215, -0.056], [0.2, -0.04], [0.035, -0.036]], 0.034, poly, 0, { bevel: 0.004 });
  k.prof([[0.04, -0.034], [0.092, -0.034], [0.07, -0.142], [0.03, -0.148], [0.016, -0.136]], 0.031, poly, 0, { bevel: 0.007, segments: 3 });
  k.place(new THREE.CylinderGeometry(0.007, 0.007, 0.038, 10), dark, 0, -0.028, -0.115, 0, 0, Math.PI / 2); // axe du sélecteur
  k.box(0.105, 0.135, -0.03, -0.026, 0.004, dark, 0.018);
  triggerGuard(k, 0.09, 0.2, -0.036, poly);
  k.box(0.2, 0.214, -0.075, -0.056, 0.012, dark);                      // palette d'arrêtoir de chargeur
  // chargeur courbe de 30 (étroit, nervuré)
  magazine(k, PBR.gunmetal(0x202124), { u: 0.257, len: 0.2, curve: 0.062, top: -0.05, half: 0.019, w: 0.024 });
  // crosse fixe pleine (A2) : col, corps, plaque de couche
  k.prof([[-0.012, 0.03], [-0.012, -0.024], [-0.07, -0.03], [-0.25, -0.078], [-0.268, -0.078], [-0.268, 0.034], [-0.07, 0.032]], 0.036, poly, 0, { bevel: 0.008, segments: 3 });
  k.box(-0.277, -0.267, -0.077, 0.033, 0.038, dark);
  k.box(-0.2, -0.09, -0.01, 0.004, 0.0375, dark);                      // évidement de la crosse
  return k.bake();
}

// --- FAMAS F1 : le « clairon ». Bullpup trapu ; grande poignée de transport
// arquée EN PONT au-dessus du fût (visée logée dedans, levier d'armement
// dessous), appui-joue, chargeur droit de 25 derrière la poignée, bipied
// replié le long du garde-main, canon à bagues de lance-grenades ---------------
export function buildFamasModel() {
  const k = kit();
  const body = PBR.polymer(0x2b2d2e), dark = PBR.gunmetal(0x101113), steel = PBR.gunmetal(0x1d1e21), rubber = PBR.polymer(0x0f0f10);
  // crosse et boîtier d'un seul bloc, dessus droit, dessous qui remonte vers l'avant
  k.prof([[-0.33, -0.085], [-0.31, -0.092], [-0.06, -0.066], [-0.02, -0.046], [0.3, -0.046], [0.4, -0.034], [0.4, 0.03], [-0.33, 0.03]],
    0.05, body, 0, { bevel: 0.009, segments: 3 });
  k.prof(roundedRect(-0.345, -0.09, -0.328, 0.03, 0.006), 0.052, rubber, 0, { bevel: 0.004 }); // plaque de couche caoutchouc
  k.prof(roundedRect(-0.28, 0.02, -0.14, 0.046, 0.01), 0.04, body, 0, { bevel: 0.008, segments: 3 }); // appui-joue
  k.box(-0.13, -0.055, 0.0, 0.02, 0.0515, dark);                       // fenêtre d'éjection
  for (const u of [-0.3, -0.03, 0.2]) k.place(new THREE.CylinderGeometry(0.005, 0.005, 0.054, 8), dark, 0, -0.012, -u, 0, 0, Math.PI / 2); // goupilles
  // garde-main arrondi sous le pont
  k.prof(roundedRect(0.16, -0.05, 0.4, 0.03, 0.014), 0.054, body, 0, { bevel: 0.012, segments: 3 });
  // POIGNÉE DE TRANSPORT en pont : deux montants + arche bombée
  // (montants en DEUX joues : le canal de visée reste ouvert entre elles)
  for (const x of [-0.0105, 0.0105]) {
    k.prof([[-0.1, 0.03], [-0.06, 0.03], [-0.03, 0.082], [-0.062, 0.082]], 0.004, body, x, { bevel: 0.001 });
    k.prof([[0.33, 0.03], [0.37, 0.03], [0.332, 0.082], [0.3, 0.082]], 0.004, body, x, { bevel: 0.001 });
  }
  k.prof([...arc(-0.07, 0.34, 0.082, 0.03), ...arc(-0.05, 0.32, 0.076, 0.022).reverse()], 0.024, body, 0, { bevel: 0.003 });
  k.place(new THREE.TorusGeometry(0.0065, 0.002, 6, 14), dark, 0, 0.068, 0.037); // œilleton (anneau)
  k.box(0.297, 0.303, 0.04, 0.064, 0.003, dark);                       // guidon (sommet 4 mm sous la ligne de mire)
  k.prof([[0.1, 0.03], [0.18, 0.03], [0.17, 0.052], [0.11, 0.052]], 0.014, dark, 0, { bevel: 0.002 }); // levier d'armement sous l'arche
  // canon, bagues de lance-grenades, cache-flamme
  k.tube(0.0095, 0.4, 0.64, 0, dark);
  k.tube(0.0125, 0.47, 0.6, 0, steel, 0, 12);
  for (const u of [0.48, 0.515, 0.55, 0.585]) k.tube(0.0145, u, u + 0.008, 0, dark, 0, 12);
  k.tube(0.012, 0.6, 0.645, 0, steel, 0, 12);
  // bipied replié : deux jambes le long du garde-main, articulées à l'avant
  for (const x of [-0.031, 0.031]) {
    k.place(new THREE.CylinderGeometry(0.0045, 0.0045, 0.3, 6), steel, x, 0.006, -0.25, Math.PI / 2);
    k.place(new THREE.SphereGeometry(0.007, 8, 6), steel, x, 0.006, -0.4);
  }
  // poignée pistolet, pontet, détente
  k.prof([[0.04, -0.046], [0.092, -0.046], [0.072, -0.15], [0.03, -0.156], [0.016, -0.144]], 0.034, body, 0, { bevel: 0.007, segments: 3 });
  triggerGuard(k, 0.09, 0.2, -0.046, body);
  // chargeur droit de 25, derrière la poignée
  magazine(k, PBR.gunmetal(0x232427), { u: -0.13, len: 0.15, curve: 0.004, top: -0.066, half: 0.027, w: 0.028 });
  return k.bake();
}

// --- Kar98k : fût bois d'une pièce, verrou coudé, hausse à curseur, bretelle ---
export function buildKar98kModel(scoped = false) {
  const k = kit();
  const wood = PBR.wood(0x7d4a22), steel = PBR.gunmetal(0x24262a), bright = PBR.steel(0x9aa0a8), dark = PBR.gunmetal(0x111214);
  // crosse à poignée pistolet esquissée + fût long jusqu'à la grenadière
  k.prof([[-0.33, -0.1], [-0.31, -0.105], [-0.08, -0.06], [-0.03, -0.075], [0.03, -0.06], [0.08, -0.034], [0.62, -0.03], [0.62, -0.006],
    [0.12, -0.004], [0.02, 0.004], [-0.06, 0.004], [-0.1, -0.006], [-0.31, 0.012], [-0.33, 0.008]], 0.044, wood, 0, { bevel: 0.009, segments: 3 });
  k.box(-0.338, -0.329, -0.1, 0.008, 0.046, steel); // plaque de couche
  k.prof(roundedRect(0.3, -0.006, 0.52, 0.02, 0.008), 0.036, wood, 0, { bevel: 0.006, segments: 3 }); // garde-main supérieur
  // grenadières (deux bagues) + embouchoir
  for (const u of [0.42, 0.6]) k.prof(roundedRect(u, -0.034, u + 0.018, 0.024, 0.005), 0.05, steel, 0, { bevel: 0.002 });
  // canon, guidon sous tunnel, hausse à curseur
  k.tube(0.0095, 0.1, 0.78, 0.008, steel);
  k.place(new THREE.TorusGeometry(0.012, 0.003, 6, 12), steel, 0, 0.03, -0.75, 0, Math.PI / 2);
  k.box(0.747, 0.753, 0.016, 0.03, 0.003, dark);
  k.prof([[0.26, 0.02], [0.33, 0.02], [0.33, 0.03], [0.26, 0.04]], 0.02, steel, 0, { bevel: 0.002 });
  // boîte de culasse, culasse, levier coudé à boule (flanc droit), sûreté
  k.tube(0.016, 0.0, 0.14, 0.01, steel, 0, 12);
  k.tube(0.012, -0.05, 0.0, 0.01, bright, 0, 10);
  k.place(new THREE.CylinderGeometry(0.005, 0.005, 0.045, 8), bright, 0.03, 0.006, 0.03, 0, 0, Math.PI / 2 - 0.5);
  k.place(new THREE.SphereGeometry(0.011, 10, 8), bright, 0.05, -0.006, 0.03);
  k.box(-0.062, -0.05, 0.01, 0.03, 0.008, steel);
  // magasin interne (plancher), pontet, détente
  k.box(0.1, 0.19, -0.04, -0.033, 0.03, steel);
  triggerGuard(k, 0.03, 0.1, -0.058, steel);
  // lunette de tireur (version à lunette) : deux colliers, tube, bonnettes
  if (scoped) {
    const black = PBR.gunmetal(0x151618);
    for (const u of [0.06, 0.2]) k.prof(roundedRect(u, 0.024, u + 0.018, 0.075, 0.004), 0.03, black, 0, { bevel: 0.002 });
    k.tube(0.013, 0.01, 0.27, 0.062, black, 0, 14);
    k.tube(0.018, -0.03, 0.02, 0.062, black, 0, 14, 0.016);   // oculaire
    k.tube(0.02, 0.26, 0.32, 0.062, black, 0, 14, 0.014);     // objectif
    k.tube(0.0185, 0.316, 0.321, 0.062, PBR.glass(0x2a5570), 0, 14);
    k.place(new THREE.CylinderGeometry(0.008, 0.008, 0.016, 10), black, 0, 0.083, -0.13);
    k.place(new THREE.CylinderGeometry(0.008, 0.008, 0.016, 10), black, 0.02, 0.062, -0.13, 0, 0, Math.PI / 2);
  }
  // bretelle en cuir, du fût à la crosse
  k.prof([[0.42, -0.036], [0.425, -0.04], [-0.2, -0.085], [-0.2, -0.079]], 0.022, PBR.fabric(0x4a3220), 0);
  return k.bake();
}

// --- Épée : lame à gouttière, quillons relevés, fusée gainée de cuir, pommeau ---
export function buildEpeeModel() {
  const k = kit();
  const blade = PBR.steel(0xc4cad2), brass = PBR.steel(0xb38a3a), leather = PBR.fabric(0x3a2416), dark = PBR.gunmetal(0x2a2b2f);
  // lame : profil effilé, vue de chant (large de 5 cm, épaisse de 7 mm)
  k.prof([[0.1, -0.026], [0.86, -0.02], [0.99, 0], [0.86, 0.02], [0.1, 0.026]], 0.007, blade, 0, { bevel: 0.003 });
  k.box(0.12, 0.72, -0.006, 0.006, 0.009, dark); // gouttière
  // garde : quillons relevés vers la lame, écusson
  k.prof([[0.07, -0.1], [0.095, -0.11], [0.105, -0.03], [0.105, 0.03], [0.095, 0.11], [0.07, 0.1], [0.082, 0.03], [0.082, -0.03]], 0.02, brass, 0, { bevel: 0.004, segments: 2 });
  k.prof(roundedRect(0.07, -0.022, 0.115, 0.022, 0.006), 0.03, brass, 0, { bevel: 0.004 });
  // fusée gainée (filigrane torsadé), pommeau
  k.tube(0.015, -0.09, 0.07, 0, leather, 0, 10, 0.013);
  for (let u = -0.08; u < 0.06; u += 0.022) k.tube(0.0162, u, u + 0.004, 0, brass, 0, 10);
  k.place(new THREE.SphereGeometry(0.026, 12, 10), brass, 0, 0, 0.115);
  const g = k.bake();
  g.rotation.x = 0.55; // tenue pointe relevée
  return g;
}

// --- Doubles dagues : lame à double tranchant, garde courte, manche annelé ----
export function buildDaguesModel() {
  const g = new THREE.Group();
  for (const s of [-1, 1]) {
    const k = kit();
    const blade = PBR.steel(0xc4cad2), dark = PBR.gunmetal(0x17181b), grip2 = PBR.polymer(0x1a1b1e);
    k.prof([[0.06, -0.02], [0.27, -0.014], [0.36, 0], [0.27, 0.014], [0.06, 0.02]], 0.006, blade, 0, { bevel: 0.0025 });
    k.box(0.07, 0.25, -0.003, 0.003, 0.0075, dark);
    k.prof(roundedRect(0.04, -0.038, 0.062, 0.038, 0.006), 0.016, dark, 0, { bevel: 0.003 });
    k.tube(0.013, -0.07, 0.04, 0, grip2, 0, 10, 0.012);
    for (let u = -0.06; u < 0.03; u += 0.02) k.tube(0.0142, u, u + 0.005, 0, dark, 0, 10);
    k.place(new THREE.CylinderGeometry(0.016, 0.014, 0.014, 10), dark, 0, 0, 0.077, Math.PI / 2);
    const d = k.bake();
    d.position.set(0.16 * s, -0.02, -0.16);
    d.rotation.set(0.35, -0.12 * s, 0);
    g.add(d);
  }
  return g;
}

// --- Lance et bouclier : fer en feuille, hampe cerclée ; bouclier rond bombé au
// lion (Lyon oblige), tenu bas à gauche pour ne pas boucher la vue ----------------
export function buildLanceModel() {
  const g = new THREE.Group();
  const k = kit();
  const woodM = PBR.wood(0x6b4a2a), blade = PBR.steel(0xc4cad2), brass = PBR.steel(0xb38a3a);
  k.tube(0.014, -0.4, 1.42, 0, woodM, 0, 10);
  k.prof([[1.4, -0.016], [1.5, -0.04], [1.72, 0], [1.5, 0.04], [1.4, 0.016]], 0.008, blade, 0, { bevel: 0.003 }); // fer en feuille
  k.tube(0.02, 1.36, 1.43, 0, brass, 0, 10);     // douille
  for (const u of [0.1, 0.5, 0.9]) k.tube(0.0165, u, u + 0.02, 0, brass, 0, 10); // viroles
  k.place(new THREE.ConeGeometry(0.016, 0.07, 8), brass, 0, 0, 0.43, Math.PI / 2); // talon
  const lance = k.bake();
  lance.position.set(0.1, 0.02, 0);
  g.add(lance);

  const sh = new THREE.Group();
  const rouge = new THREE.MeshStandardMaterial({ color: 0x8c2f24, metalness: 0.25, roughness: 0.6, side: THREE.DoubleSide });
  const dome = new THREE.Mesh(new THREE.SphereGeometry(0.62, 28, 6, 0, Math.PI * 2, 0, 0.5), rouge); // calotte bombée
  dome.rotation.x = -Math.PI / 2;
  dome.position.z = 0.545;
  sh.add(dome);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.297, 0.017, 8, 32), brass);
  sh.add(rim);
  const umbo = new THREE.Mesh(new THREE.SphereGeometry(0.075, 14, 10), brass);
  umbo.position.z = -0.07;
  sh.add(umbo);
  for (let i = 0; i < 8; i++) { // rivets
    const a = (i / 8) * Math.PI * 2;
    const r = new THREE.Mesh(new THREE.SphereGeometry(0.012, 8, 6), brass);
    r.position.set(Math.cos(a) * 0.24, Math.sin(a) * 0.24, -0.03);
    sh.add(r);
  }
  const strap = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.035, 0.012), PBR.fabric(0x3a2416)); // énarme (dos du bouclier)
  strap.position.z = 0.03;
  sh.add(strap);
  sh.position.set(-0.4, -0.25, -0.36);
  sh.rotation.y = 0.35;
  g.add(sh);
  return g;
}
