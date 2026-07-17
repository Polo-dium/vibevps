import * as THREE from 'three';
import { WATER_Y } from './city.js';

// La PÊCHE 🎣 : au bord de la Saône, on lance le bouchon, on attend la
// touche (le bouchon plonge), on FERRE dans la seconde — du goujon de
// poche au silure record. Le plus long part au CONCOURS DE PÊCHE
// (leaderboard en centimètres, MAX = record).
const STRIKE_WINDOW = 1.0; // s pour ferrer après la touche

// Distribution lyonnaise : beaucoup de goujons, quelques silures de légende
function drawFish() {
  const r = Math.random();
  if (r < 0.45) return { nom: 'goujon', cm: 8 + Math.round(Math.random() * 17) };
  if (r < 0.72) return { nom: 'perche', cm: 22 + Math.round(Math.random() * 26) };
  if (r < 0.9) return { nom: 'brochet', cm: 48 + Math.round(Math.random() * 62) };
  return { nom: 'SILURE', cm: 120 + Math.round(Math.random() * 140) };
}

export function createFishing(ctx, { notify, onCatch, audio }) {
  // Spots : au bord de l'eau, déduits des contours réels de berge si on les
  // a (points médians de chaînes), sinon repli fixe côté Bellecour.
  const spots = [];
  const contours = ctx.quayContours ?? [];
  for (const chain of contours.slice(0, 3)) {
    const pts = chain.pts ?? chain;
    if (!pts?.length) continue;
    const mid = pts[Math.floor(pts.length / 2)];
    if (mid) spots.push({ x: mid[0] ?? mid.x, z: mid[1] ?? mid.z });
  }
  if (!spots.length) {
    const band = (ctx.waterBands ?? [])[0];
    if (band) {
      const z = 30;
      spots.push({ x: (band.cx ? band.cx(z) : 0) + (band.w ?? 40) / 2 + 3, z });
    } else {
      spots.push({ x: -30, z: 24 });
    }
  }

  const bobber = new THREE.Mesh(
    new THREE.SphereGeometry(0.09, 8, 6),
    new THREE.MeshLambertMaterial({ color: 0xd93a3a })
  );
  bobber.visible = false;
  ctx.scene.add(bobber);
  const lineGeo = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(), new THREE.Vector3(),
  ]);
  const line = new THREE.Line(lineGeo, new THREE.LineBasicMaterial({ color: 0x222831 }));
  line.visible = false;
  ctx.scene.add(line);

  // phase : 'idle' | 'wait' (bouchon posé) | 'bite' (FERRE !)
  let phase = 'idle';
  let biteIn = 0;
  let biteLeft = 0;
  let spot = null;
  let gate = null;

  function labelFor() {
    return phase === 'idle' ? 'E — Pêcher (concours du plus gros)'
      : phase === 'wait' ? 'E — Remonter la ligne'
        : 'E — FERRE, GONE !';
  }

  function cast() {
    phase = 'wait';
    biteIn = 3 + Math.random() * 7;
    // Le bouchon part vers le large, à quelques mètres du quai
    const p = ctx.playerPos();
    const toWater = Math.atan2(spot.wx - p.x, spot.wz - p.z);
    bobber.position.set(
      p.x + Math.sin(toWater) * (5 + Math.random() * 4),
      WATER_Y + 0.06,
      p.z + Math.cos(toWater) * (5 + Math.random() * 4)
    );
    bobber.visible = true;
    line.visible = true;
    audio?.thud?.();
  }

  function stopFishing(msg) {
    phase = 'idle';
    bobber.visible = false;
    line.visible = false;
    if (gate) gate.label = labelFor();
    if (msg) notify(msg);
  }

  for (const s of spots) {
    // point « côté eau » pour orienter le lancer : petit pas au large
    const band = (ctx.waterBands ?? [])[0];
    const cx = band?.cx ? band.cx(s.z) : 0;
    s.wx = s.x + (s.x > cx ? 6 : -6);
    s.wz = s.z;
    const g = {
      x: s.x, z: s.z, r: 3.2,
      label: 'E — Pêcher (concours du plus gros)',
      action: () => {
        spot = s;
        gate = g;
        if (phase === 'idle') {
          cast();
          notify('🎣 Bouchon à l’eau… quand il PLONGE, ferre avec E — t’as une seconde, pas deux.');
        } else if (phase === 'bite') {
          const fish = drawFish();
          stopFishing(`🎣 ${fish.nom === 'SILURE' ? '🐟 UN SILURE !' : `Un ${fish.nom} !`} ${fish.cm} cm${fish.cm > 100 ? ' — la bête de la Saône !' : fish.cm > 45 ? ' — beau poisson.' : ' — ça fera une friture.'}`);
          audio?.reward?.();
          onCatch?.(fish);
        } else {
          stopFishing('🎣 Ligne remontée. Le poisson attendra.');
        }
        g.label = labelFor();
      },
    };
    ctx.interactables.push(g);
  }
  ctx.pois?.push({ id: 'peche', nom: 'Spot de pêche', emoji: '🎣', x: spots[0].x, z: spots[0].z });

  let bob = 0;
  ctx.updatables.push((dt) => {
    if (phase === 'idle') return;
    const p = ctx.playerPos();
    if (spot && Math.hypot(p.x - spot.x, p.z - spot.z) > 9) {
      return stopFishing('🎣 Trop loin du bord : la ligne est remontée.');
    }
    bob += dt;
    // La ligne suit la main du pêcheur
    const pos = line.geometry.attributes.position;
    pos.setXYZ(0, p.x, p.y + 1.1, p.z);
    pos.setXYZ(1, bobber.position.x, bobber.position.y, bobber.position.z);
    pos.needsUpdate = true;

    if (phase === 'wait') {
      bobber.position.y = WATER_Y + 0.06 + Math.sin(bob * 2.2) * 0.03;
      biteIn -= dt;
      if (biteIn <= 0) {
        phase = 'bite';
        biteLeft = STRIKE_WINDOW;
        bobber.position.y = WATER_Y - 0.22; // ça PLONGE
        audio?.hitmarker?.();
        navigator.vibrate?.(35);
        if (gate) gate.label = labelFor();
      }
    } else if (phase === 'bite') {
      biteLeft -= dt;
      if (biteLeft <= 0) {
        cast(); // raté : il est reparti, le bouchon aussi
        notify('🎣 Trop lent, il a recraché ! Le bouchon est reparti à l’eau.');
        if (gate) gate.label = labelFor();
      }
    }
  });
}
