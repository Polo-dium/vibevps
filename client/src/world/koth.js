import * as THREE from 'three';

// ROI DE LA COLLINE 👑 : toutes les 10 minutes, une zone dorée s'allume à
// un endroit connu de la ville (tirage déterministe sur Date.now — même
// zone chez tous les joueurs, zéro réseau). Rester dedans fait grimper ton
// compteur ; les autres joueurs veulent ta place. Le meilleur temps d'un
// tour part au classement 'koth'.
const ROUND_MS = 10 * 60 * 1000;
const ZONE_R = 12;

export function createKoth(ctx, { setBanner, notify, onScore }) {
  // Candidats stables : mêmes ids de POI chez tous les clients (même build,
  // même ville). L'ordre de cette liste fait partie du protocole implicite.
  const IDS = ['roue', 'arcade', 'musee', 'basilique', 'stand', 'bouchon', 'petanque', 'crayon'];
  const spots = [];
  for (const id of IDS) {
    const p = ctx.pois?.find((q) => q.id === id);
    if (p) spots.push({ x: p.x, z: p.z, nom: p.nom });
  }
  if (!spots.length) spots.push({ x: 0, z: 14, nom: 'la statue' });

  const zone = new THREE.Mesh(
    new THREE.CylinderGeometry(ZONE_R, ZONE_R, 2.4, 24, 1, true),
    new THREE.MeshBasicMaterial({
      color: 0xffc94d, transparent: true, opacity: 0.22,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    })
  );
  zone.userData.noShadow = true;
  ctx.scene.add(zone);
  const beam = new THREE.Mesh(
    new THREE.CylinderGeometry(1.4, 2.6, 170, 8, 1, true),
    new THREE.MeshBasicMaterial({
      color: 0xffc94d, transparent: true, opacity: 0.25,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    })
  );
  beam.userData.noShadow = true;
  ctx.scene.add(beam);

  let round = -1;
  let held = 0; // secondes tenues ce tour
  let cur = spots[0];
  let wasInside = false;

  ctx.updatables.push((dt) => {
    const now = Date.now();
    const r = Math.floor(now / ROUND_MS);
    if (r !== round) {
      // Fin de tour : on pousse le temps tenu, puis nouvelle zone
      if (round !== -1 && held > 2) onScore?.(Math.round(held));
      round = r;
      held = 0;
      const h = (r * 2654435761) >>> 0;
      cur = spots[h % spots.length];
      const y = Math.max(0, ctx.terrainHeight?.(cur.x, cur.z) ?? 0);
      zone.position.set(cur.x, y + 1.2, cur.z);
      beam.position.set(cur.x, y + 86, cur.z);
      notify?.(`👑 ROI DE LA COLLINE : la zone est à ${cur.nom} — tiens la position !`);
    }
    zone.rotation.y += dt * 0.4;
    const p = ctx.playerPos();
    const inside = Math.hypot(p.x - cur.x, p.z - cur.z) < ZONE_R &&
      Math.abs(p.y - zone.position.y) < 10;
    if (inside) {
      held += dt;
      const left = Math.ceil((ROUND_MS - (now % ROUND_MS)) / 1000);
      setBanner(`👑 ROI DE LA COLLINE — ${Math.floor(held)} s tenues<br><span style="font-size:13px;">nouvelle zone dans ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}</span>`);
    } else if (wasInside) {
      setBanner(null);
    }
    wasInside = inside;
  });
}
