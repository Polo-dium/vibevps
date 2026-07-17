import * as THREE from 'three';
import { BELLECOUR } from './layout.js';

// Le PARKOUR DES TOITS 🏃 : course de checkpoints d'un toit à l'autre,
// taillée pour le saut doublé et la glissade. Le parcours est DÉDUIT des
// boîtes de collision des bâtiments (déterministe : mêmes toits pour tous),
// le jetpack et les véhicules sont interdits — les jambes, gone !
const RING_R = 2.6;
const TIMEOUT_MS = 6 * 60 * 1000;

function buildCourse(ctx) {
  const B = ctx.bellecourRect ?? BELLECOUR;
  // Candidats : des toits ni trop bas ni trop hauts, assez larges pour
  // atterrir dessus. On reste dans le couloir de la Presqu'île si les
  // fleuves sont connus.
  const bands = [...(ctx.waterBands ?? [])].sort((a, b) => a.minX - b.minX);
  const saone = bands[0], rhone = bands[bands.length - 1];
  const inCorridor = (x, z) => {
    if (!saone || saone === rhone) return Math.abs(x) < 260 && Math.abs(z) < 320;
    const left = (saone.cx ? saone.cx(z) : saone.minX) + 30;
    const right = (rhone.cx ? rhone.cx(z) : rhone.maxX) - 30;
    return x > left && x < right;
  };
  const roofs = [];
  for (const c of ctx.colliders) {
    if (!c || c.maxY == null) continue;
    const w = c.maxX - c.minX, d = c.maxZ - c.minZ, h = c.maxY - (c.minY ?? 0);
    // On vise les PLATEFORMES de toit (boîtes fines posées au sommet des
    // bâtiments OSM, marchables), pas les murs ni les blocs pleins.
    if (h > 1.2 || c.maxY < 5 || c.maxY > 24) continue;
    if (w < 6 || d < 6 || w > 90 || d > 90) continue;
    const x = (c.minX + c.maxX) / 2, z = (c.minZ + c.maxZ) / 2;
    if (!inCorridor(x, z)) continue;
    if (z > B.minZ + 30 || z < B.minZ - 420) continue; // au nord de Bellecour
    roofs.push({ x, z, y: c.maxY });
  }

  // Chaîne de toits FAISABLE À PIED : le 1er toit est libre (on y monte
  // comme on veut, jetpack compris — le chrono ne part qu'en le touchant),
  // puis chaque saut est calibré sur le vrai saut + glissade : 8 à 17 m de
  // portée, montée ≤ 1,6 m (on ne grimpe pas), descente libre mais ≤ 12 m.
  const pts = [];
  const startEdge = { x: (B.minX + B.maxX) / 2, z: B.minZ - 4 };
  let cur = null;
  for (const r of roofs) { // 1er toit : le plus proche de Bellecour
    const d = Math.hypot(r.x - startEdge.x, r.z - startEdge.z);
    if (d < 90 && (!cur || d < cur.d)) cur = { ...r, d };
  }
  if (!cur) return [];
  const used = new Set();
  pts.push([cur.x, cur.y + 1.7, cur.z]);
  for (let i = 0; i < 7; i++) {
    let best = null, bestScore = Infinity;
    for (const r of roofs) {
      if (used.has(r)) continue;
      const dxz = Math.hypot(r.x - cur.x, r.z - cur.z);
      const dy = r.y - cur.y;
      if (dxz < 8 || dxz > 17) continue; // portée d'un saut élancé
      if (dy > 1.6 || dy < -12) continue;
      const northward = cur.z - r.z; // on préfère avancer vers le nord
      const score = dxz * 0.5 + Math.abs(dy) - northward * 1.2;
      if (score < bestScore) { bestScore = score; best = r; }
    }
    if (!best) break;
    used.add(best);
    pts.push([best.x, best.y + 1.7, best.z]);
    cur = best;
  }
  // Arrivée : retour au sol, au pied du dernier toit
  if (pts.length) {
    const [lx, , lz] = pts[pts.length - 1];
    pts.push([lx + 14, Math.max(0, ctx.terrainHeight?.(lx + 14, lz + 8) ?? 0) + 1.7, lz + 8]);
  }
  return pts;
}

export function createParkour(ctx, { setBanner, notify, onFinish, audio, blocked }) {
  const course = buildCourse(ctx);
  if (course.length < 3) return; // pas assez de toits (monde minimal)

  const B = ctx.bellecourRect ?? BELLECOUR;
  const startX = (B.minX + B.maxX) / 2, startZ = B.minZ - 2;

  const ringGeo = new THREE.TorusGeometry(RING_R, 0.2, 8, 22);
  const matActive = new THREE.MeshBasicMaterial({
    color: 0x69f0ae, transparent: true, opacity: 0.95,
    blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
  });
  const matNext = new THREE.MeshBasicMaterial({
    color: 0xffd23f, transparent: true, opacity: 0.3,
    blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
  });
  const rings = course.map(([x, y, z], i) => {
    const m = new THREE.Mesh(ringGeo, i ? matNext : matActive);
    m.position.set(x, y, z);
    const [px, , pz] = course[Math.max(0, i - 1)];
    m.rotation.y = Math.atan2(x - px, z - pz);
    m.visible = false;
    m.userData.noShadow = true;
    ctx.scene.add(m);
    return m;
  });
  // Balise au-dessus de l'anneau actif, comme le Grand Prix au sol
  const beam = new THREE.Mesh(
    new THREE.CylinderGeometry(0.7, 1.2, 120, 8, 1, true),
    new THREE.MeshBasicMaterial({
      color: 0x69f0ae, transparent: true, opacity: 0.3,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    })
  );
  beam.visible = false;
  beam.userData.noShadow = true;
  ctx.scene.add(beam);
  ctx.pois?.push({ id: 'parkour', nom: 'Parkour des toits', emoji: '🏃', x: startX, z: startZ });

  let racing = false;
  let cp = 0;
  let t0 = 0;
  let best = null;

  ctx.interactables.push({
    x: startX, z: startZ, r: 5,
    label: 'E — Parkour des toits (sans jetpack !)',
    action: () => (racing ? abort('🏃 Parkour abandonné.') : start()),
  });

  function start() {
    racing = true;
    cp = 0;
    t0 = 0; // le chrono ne part qu'au PREMIER toit
    showRings();
    notify('🏃 PARKOUR DES TOITS ! Monte au premier anneau comme tu veux (jetpack permis) — le chrono part là-haut, ENSUITE jambes seulement.');
    audio?.reward?.();
  }

  function abort(msg) {
    racing = false;
    rings.forEach((r) => { r.visible = false; });
    beam.visible = false;
    setBanner(null);
    if (msg) notify(msg);
  }

  function showRings() {
    rings.forEach((r, i) => {
      r.visible = i === cp || i === cp + 1;
      r.material = i === cp ? matActive : matNext;
    });
    const ring = rings[cp];
    if (ring) {
      beam.position.set(ring.position.x, ring.position.y + 60, ring.position.z);
      beam.visible = true;
    }
  }

  const fmt = (ms) => `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, '0')}.${String(Math.floor((ms % 1000) / 100))}`;

  ctx.updatables.push((dt) => {
    if (!racing) return;
    // La montée au 1er toit est libre ; après, jambes uniquement.
    if (cp > 0 && blocked?.()) return abort('🏃 Jetpack ou véhicule détecté — parkour disqualifié, gone !');
    const elapsed = t0 ? performance.now() - t0 : 0;
    if (t0 && elapsed > TIMEOUT_MS) return abort('🏃 Trop long — parkour abandonné.');
    const ring = rings[cp];
    ring.rotation.z += dt * 1.1;
    const p = ctx.playerPos();
    const d = Math.hypot(ring.position.x - p.x, ring.position.y - (p.y + 1), ring.position.z - p.z);
    setBanner(cp === 0
      ? `🏃 Monte au premier toit (jetpack permis)<br><span style="font-size:13px;">distance : ${Math.round(d)} m</span>`
      : `🏃 ${fmt(elapsed)} — toit ${cp + 1}/${rings.length}<br><span style="font-size:13px;">distance : ${Math.round(d)} m</span>`);
    if (d < RING_R + 1.4) {
      if (cp === 0) t0 = performance.now(); // top départ au sommet
      cp++;
      audio?.hitmarker?.();
      if (cp >= rings.length) {
        racing = false;
        rings.forEach((r) => { r.visible = false; });
        beam.visible = false;
        setBanner(null);
        const ms = Math.round(elapsed);
        const record = best == null || ms < best;
        if (record) best = ms;
        onFinish({ ms, timeText: fmt(ms), record });
      } else {
        showRings();
      }
    }
  });
}
