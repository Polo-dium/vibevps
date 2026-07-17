import * as THREE from 'three';

// NÉONS DE QUARTIER 🏪 : la nuit, des enseignes s'allument en pied
// d'immeuble — croix vertes de pharmacie qui clignotent, BOULANGERIE,
// TABAC, KEBAB… Les enseignes sont des potences fixées aux MURS réels :
// on échantillonne les colliders fins des façades (déterministe).
const KINDS = [
  { text: 'PHARMACIE', color: '#3dff7a', cross: true },
  { text: 'BOULANGERIE', color: '#ffcf66' },
  { text: 'TABAC', color: '#ff5252' },
  { text: 'KEBAB', color: '#ff9330' },
  { text: 'HÔTEL', color: '#53c8ff' },
  { text: 'BAR', color: '#ff8bd1' },
  { text: 'PMU', color: '#69f0ae' },
];

function makeRand(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function makeSignTexture(kind) {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 96;
  const g = c.getContext('2d');
  g.fillStyle = '#0a0e16';
  g.fillRect(0, 0, 256, 96);
  g.strokeStyle = kind.color;
  g.lineWidth = 6;
  g.strokeRect(6, 6, 244, 84);
  g.fillStyle = kind.color;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  if (kind.cross) {
    // La croix de pharmacie, évidemment
    g.fillRect(108, 18, 40, 60);
    g.fillRect(98, 28, 60, 40);
  } else {
    let size = 44;
    do {
      g.font = `900 ${size}px system-ui, sans-serif`;
      size -= 3;
    } while (g.measureText(kind.text).width > 230 && size > 16);
    g.fillText(kind.text, 128, 50);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function createNeons(ctx) {
  const rand = makeRand(6902); // Lyon 2e, forcément
  const bound = Math.min(ctx.worldBound ?? 140, 380);
  const signs = [];
  const placed = [];

  // Cherche des murs fins de façade (colliders 0,5 m d'épaisseur, hauts)
  // près de points au sol tirés au hasard — 26 enseignes espacées de 40 m.
  let guard = 0;
  while (signs.length < 26 && guard++ < 900) {
    const x = (rand() * 2 - 1) * bound;
    const z = (rand() * 2 - 1) * bound;
    if (placed.some(([px, pz]) => Math.hypot(px - x, pz - z) < 40)) continue;
    let wall = null;
    for (const c of (ctx.colliders.nearby?.(x, z, 6) ?? [])) {
      const w = c.maxX - c.minX, d = c.maxZ - c.minZ;
      const thinX = w < 1.2 && d > 2.5, thinZ = d < 1.2 && w > 2.5;
      if ((thinX || thinZ) && c.maxY > 7 && (c.minY ?? 0) < 1) {
        wall = { c, thinX };
        break;
      }
    }
    if (!wall) continue;
    const { c, thinX } = wall;
    const wx = (c.minX + c.maxX) / 2, wz = (c.minZ + c.maxZ) / 2;
    const kind = KINDS[signs.length % KINDS.length];
    const sign = new THREE.Mesh(
      new THREE.PlaneGeometry(2.2, 0.85),
      new THREE.MeshBasicMaterial({
        map: makeSignTexture(kind), transparent: true, opacity: 0,
        side: THREE.DoubleSide, depthWrite: false,
      })
    );
    // Potence : l'enseigne sort PERPENDICULAIRE au mur, à 3,6 m de haut,
    // lisible depuis la rue dans les deux sens.
    if (thinX) {
      sign.position.set(wx + (x > wx ? 1.3 : -1.3), 3.6, wz);
      sign.rotation.y = 0; // face aux passants qui longent le mur (axe Z)
    } else {
      sign.position.set(wx, 3.6, wz + (z > wz ? 1.3 : -1.3));
      sign.rotation.y = Math.PI / 2;
    }
    sign.userData.noShadow = true;
    sign.visible = false;
    ctx.scene.add(sign);
    signs.push({ sign, cross: Boolean(kind.cross), phase: rand() * 10 });
    placed.push([x, z]);
  }
  if (!signs.length) return;

  let t = 0;
  ctx.updatables.push((dt) => {
    const night = ctx.env?.night ?? 0;
    const on = night > 0.15;
    t += dt;
    for (const s of signs) {
      s.sign.visible = on;
      if (!on) continue;
      // Croix de pharmacie : clignotement lent ; les autres, fixes
      s.sign.material.opacity = s.cross
        ? night * (Math.sin(t * 2.4 + s.phase) > -0.25 ? 0.95 : 0.2)
        : night * 0.92;
    }
  });
}
