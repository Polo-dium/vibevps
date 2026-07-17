import * as THREE from 'three';
import { WATER_Y } from './city.js';

// REFLETS NOCTURNES ✨ : des traînées dorées qui ondulent sur l'eau le long
// des berges la nuit — la carte postale lyonnaise. Un seul BufferGeometry
// fusionné + un matériau additif dont seule l'opacité bouge : un draw call.
export function createReflections(ctx) {
  const spots = [];
  const isWaterAt = (x, z) => (ctx.terrainHeight?.(x, z) ?? 0) < -1;

  const contours = ctx.quayContours ?? [];
  for (const chain of contours) {
    const pts = chain.pts ?? [];
    const perps = chain.perps ?? [];
    for (let i = 4; i < pts.length - 4; i += 7) {
      const [x, z] = pts[i];
      const [px, pz] = perps[i] ?? [0, 0];
      // On cherche le côté EAU de la berge en sondant le terrain
      for (const s of [1, -1]) {
        const wx = x + px * s * 4.5, wz = z + pz * s * 4.5;
        if (isWaterAt(wx, wz)) {
          spots.push([wx, wz, Math.atan2(px * s, pz * s)]);
          break;
        }
      }
      if (spots.length >= 120) break;
    }
    if (spots.length >= 120) break;
  }
  if (!spots.length) {
    // Repli procédural : le long des bords des bandes d'eau
    for (const band of (ctx.waterBands ?? []).slice(0, 2)) {
      for (let z = -120; z <= 120; z += 24) {
        const cx = band.cx ? band.cx(z) : 0;
        for (const s of [-1, 1]) {
          spots.push([cx + s * ((band.w ?? 40) / 2 - 4), z, s > 0 ? Math.PI / 2 : -Math.PI / 2]);
        }
      }
    }
  }
  if (!spots.length) return;

  // Quads couchés sur l'eau : longs dans le sens berge → large (le reflet
  // « coule » du lampadaire vers le fleuve).
  const positions = [];
  for (const [x, z, a] of spots) {
    const dx = Math.sin(a), dz = Math.cos(a); // vers le large
    const wx = -dz * 0.7, wz = dx * 0.7; // demi-largeur
    const L = 5 + (Math.abs(Math.sin(x * 12.9898 + z * 78.233)) * 4); // longueur pseudo-aléatoire stable
    const y = WATER_Y + 0.045;
    const ax = x - wx, az = z - wz, bx = x + wx, bz = z + wz;
    const cx2 = x + dx * L + wx, cz2 = z + dz * L + wz;
    const dx2 = x + dx * L - wx, dz2 = z + dz * L - wz;
    positions.push(
      ax, y, az, bx, y, bz, cx2, y, cz2,
      ax, y, az, cx2, y, cz2, dx2, y, dz2
    );
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  const mat = new THREE.MeshBasicMaterial({
    color: 0xffbe5c, transparent: true, opacity: 0,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.userData.noShadow = true;
  mesh.visible = false;
  ctx.scene.add(mesh);

  let t = 0;
  ctx.updatables.push((dt) => {
    const night = ctx.env?.night ?? 0;
    mesh.visible = night > 0.12;
    if (!mesh.visible) return;
    t += dt;
    // scintillement doux : l'eau bouge, le reflet ondule
    mat.opacity = night * (0.2 + Math.sin(t * 1.7) * 0.035 + Math.sin(t * 4.3) * 0.02);
  });
}
