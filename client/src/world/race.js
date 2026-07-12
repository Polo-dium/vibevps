import * as THREE from 'three';
import { BELLECOUR } from './layout.js';

// Le Grand Prix de Lyon 🏁 : course chrono à checkpoints, en solo contre le
// classement. Départ à Bellecour, boucle « Les Deux Fleuves » : quai de
// Saône, pont, Vieux Lyon, re-pont, traversée de la Presqu'île, quai du
// Rhône, pont, retour à la statue. À pied, en jetpack ou en voiture — les
// anneaux sont tous à hauteur d'homme, chacun sa stratégie.
//
// Le parcours est CALCULÉ depuis le vrai tracé des fleuves (ctx.waterBands),
// donc déterministe et identique pour tous — comme le reste du monde.
const RING_R = 3.2; // rayon de passage (m)
const TIMEOUT_MS = 8 * 60 * 1000; // au-delà, la course est abandonnée

function buildCourse(ctx) {
  const B = ctx.bellecourRect ?? BELLECOUR;
  const bands = [...(ctx.waterBands ?? [])].sort((a, b) => a.minX - b.minX);
  const saone = bands[0], rhone = bands[bands.length - 1];
  const cxOf = (b, z) => (b?.cx ? b.cx(z) : ((b?.minX ?? 0) + (b?.maxX ?? 0)) / 2);
  const halfOf = (b) => ((b?.w ?? 50) / 2);
  const pts = [];
  const ground = (x, z) => Math.max(0, ctx.terrainHeight?.(x, z) ?? 0);
  const add = (x, z, y = null) => pts.push([x, y ?? ground(x, z) + 1.8, z]);

  if (saone && rhone && saone !== rhone) {
    // Boucle LOGIQUE, sans retour en arrière : ouest vers la Saône, remontée
    // du Vieux Lyon plein nord, re-traversée, diagonale de Presqu'île vers le
    // Rhône, redescente du quai plein sud, re-traversée, retour à la statue.
    add(B.minX + 20, B.minZ + 14); // sortie nord-ouest de la place
    add(cxOf(saone, 20) + halfOf(saone) + 5, 20); // quai est de la Saône
    add(cxOf(saone, 0), 0, 3.4); // pont de la Saône
    add(cxOf(saone, -80) - halfOf(saone) - 6, -80); // Vieux Lyon, plein nord
    add(cxOf(saone, -170), -170, 3.4); // re-pont, toujours vers le nord
    add((cxOf(saone, -140) + cxOf(rhone, -140)) / 2, -140); // Presqu'île, cap est
    add(cxOf(rhone, -90) - halfOf(rhone) - 5, -90); // quai ouest du Rhône
    add(cxOf(rhone, -40) - halfOf(rhone) - 5, -40); // on redescend plein sud
    add(cxOf(rhone, 0), 0, 3.4); // pont du Rhône
    add(B.maxX - 16, B.minZ + 20); // retour sur la place
  } else {
    // Monde minimal (tests) : petite boucle autour de Bellecour
    add(B.minX + 10, B.minZ + 10);
    add(B.maxX - 10, B.minZ + 10);
    add(B.maxX - 10, B.maxZ - 10);
    add(B.minX + 10, B.maxZ - 10);
  }
  add(-2, 14); // arrivée : la statue de Louis XIV
  return pts;
}

export function createRace(ctx, { setBanner, notify, onFinish, audio }) {
  const course = buildCourse(ctx);

  // Anneaux : l'actif en orange vif, le suivant en fantôme — les autres
  // cachés. Matériaux additifs partagés, zéro vraie lumière.
  const ringGeo = new THREE.TorusGeometry(RING_R, 0.22, 8, 24);
  const matActive = new THREE.MeshBasicMaterial({
    color: 0xff9330, transparent: true, opacity: 0.95,
    blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
  });
  const matNext = new THREE.MeshBasicMaterial({
    color: 0x53c8ff, transparent: true, opacity: 0.3,
    blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
  });
  const rings = course.map(([x, y, z], i) => {
    const m = new THREE.Mesh(ringGeo, matActive);
    m.position.set(x, y, z);
    // face au checkpoint précédent (ou au départ) pour se traverser de face
    const [px, , pz] = course[Math.max(0, i - 1)];
    m.rotation.y = Math.atan2(x - px, z - pz);
    m.visible = false;
    m.userData.noShadow = true;
    ctx.scene.add(m);
    return m;
  });

  // Portique de départ à Bellecour
  const B = ctx.bellecourRect ?? BELLECOUR;
  const startX = B.minX + 26, startZ = B.minZ + 26;
  const gate = new THREE.Mesh(
    new THREE.TorusGeometry(3.4, 0.3, 8, 24),
    new THREE.MeshBasicMaterial({ color: 0xffd23f, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide })
  );
  gate.position.set(startX, 3.4, startZ);
  gate.userData.noShadow = true;
  ctx.scene.add(gate);
  ctx.pois?.push({ id: 'grand-prix', nom: 'Grand Prix de Lyon', emoji: '🏁', x: startX, z: startZ });

  // Colonne de lumière vers le ciel au-dessus de l'anneau actif : visible
  // de loin par-dessus les toits — fini les anneaux introuvables.
  const beam = new THREE.Mesh(
    new THREE.CylinderGeometry(0.9, 1.6, 160, 8, 1, true),
    new THREE.MeshBasicMaterial({
      color: 0xffb050, transparent: true, opacity: 0.32,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    })
  );
  beam.visible = false;
  beam.userData.noShadow = true;
  ctx.scene.add(beam);

  let racing = false;
  let cp = 0;
  let t0 = 0;
  let best = null;

  ctx.interactables.push({
    x: startX, z: startZ, r: 6,
    label: 'E — Grand Prix de Lyon (course chrono)',
    action: () => (racing ? abort('🏁 Course abandonnée.') : start()),
  });

  function start() {
    racing = true;
    cp = 0;
    t0 = performance.now();
    showRings();
    notify('🏁 GRAND PRIX DE LYON ! Traverse les anneaux orange — à pied, en jetpack ou en voiture. E au portique pour abandonner.');
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
      beam.position.set(ring.position.x, ring.position.y + 80, ring.position.z);
      beam.visible = true;
    }
  }

  const fmt = (ms) => `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, '0')}.${String(Math.floor((ms % 1000) / 100))}`;

  let t = 0;
  ctx.updatables.push((dt) => {
    t += dt;
    gate.rotation.y = Math.sin(t * 0.6) * 0.25;
    if (!racing) return;
    const elapsed = performance.now() - t0;
    if (elapsed > TIMEOUT_MS) return abort('🏁 Trop long, gone — course abandonnée. Retente ta chance !');
    const ring = rings[cp];
    ring.rotation.z += dt * 1.2;
    const p = ctx.playerPos();
    const d = Math.hypot(ring.position.x - p.x, ring.position.y - (p.y + 1), ring.position.z - p.z);
    setBanner(`🏁 ${fmt(elapsed)} — anneau ${cp + 1}/${rings.length}<br><span style="font-size:13px;">distance : ${Math.round(d)} m</span>`);
    if (d < RING_R + 1.2) {
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
