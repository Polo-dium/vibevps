import * as THREE from 'three';
import { makeTextTexture } from './utils.js';

// GUIGNOL 🎭 : le vrai castelet lyonnais, près du bouchon. Toutes les
// 4 minutes (horloge partagée), Guignol et Gnafron montent sur scène pour
// 45 secondes de vannes — voix de synthèse comprise si on est devant. À la
// fin du spectacle, le bâton de Guignol traîne sur le rebord : une arme de
// mêlée rapide à ramasser une fois pour toutes.
const SHOW_MS = 4 * 60 * 1000;
const SHOW_LEN = 45000;
const LINES = [
  ['guignol', 'Salut les gones ! C’est mon bâton qui va causer aux canants !'],
  ['gnafron', 'Guignol, y a plus de beaujolais… c’est une tragédie, ça !'],
  ['guignol', 'Gnafron, t’as le gosier plus profond que la Saône !'],
  ['gnafron', 'Et toi le nez plus rouge que la Grande Roue, mon ami.'],
  ['guignol', 'Le gendarme arrive… un coup de bâton et hop, à la traboule !'],
  ['gnafron', 'Régalez-vous les fenottes, la suite au prochain spectacle !'],
];

function makePuppet({ jacket, hat, nose = 0xe8c39e }) {
  const g = new THREE.Group();
  const head = new THREE.Mesh(
    new THREE.SphereGeometry(0.16, 8, 6),
    new THREE.MeshLambertMaterial({ color: 0xe8c39e })
  );
  head.position.y = 0.55;
  g.add(head);
  const nozzle = new THREE.Mesh(
    new THREE.SphereGeometry(0.05, 6, 5),
    new THREE.MeshLambertMaterial({ color: nose })
  );
  nozzle.position.set(0, 0.53, -0.15);
  g.add(nozzle);
  const body = new THREE.Mesh(
    new THREE.ConeGeometry(0.2, 0.5, 8),
    new THREE.MeshLambertMaterial({ color: jacket })
  );
  body.position.y = 0.22;
  g.add(body);
  const cap = new THREE.Mesh(
    new THREE.CylinderGeometry(0.12, 0.17, 0.14, 8),
    new THREE.MeshLambertMaterial({ color: hat })
  );
  cap.position.y = 0.72;
  g.add(cap);
  return g;
}

export function buildGuignol(ctx, { notify, speak, onBaton, hasBaton } = {}) {
  const bouchon = ctx.pois?.find((p) => p.id === 'bouchon');
  const gx = bouchon ? bouchon.x - 6 : -46, gz = bouchon ? bouchon.z - 16 : 34;
  const gy = Math.max(0, ctx.terrainHeight?.(gx, gz) ?? 0);

  const group = new THREE.Group();
  group.position.set(gx, gy, gz);
  group.rotation.y = Math.PI / 4; // tourné vers le quai
  ctx.scene.add(group);
  const add = (geo, mat, x, y, z) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    group.add(m);
    return m;
  };
  const wood = new THREE.MeshLambertMaterial({ color: 0x6d4a28 });
  const red = new THREE.MeshLambertMaterial({ color: 0xa62633 });
  // Castelet : caisse, cadre de scène, rideaux, fronton
  add(new THREE.BoxGeometry(2.6, 1.25, 1), wood, 0, 0.62, 0);
  add(new THREE.BoxGeometry(0.16, 2.5, 0.16), wood, -1.25, 1.25, 0);
  add(new THREE.BoxGeometry(0.16, 2.5, 0.16), wood, 1.25, 1.25, 0);
  add(new THREE.BoxGeometry(2.66, 0.4, 0.5), red, 0, 2.55, 0);
  add(new THREE.BoxGeometry(0.5, 1.1, 0.14), red, -1.0, 1.85, -0.2);
  add(new THREE.BoxGeometry(0.5, 1.1, 0.14), red, 1.0, 1.85, -0.2);
  const sign = add(
    new THREE.PlaneGeometry(2.2, 0.42),
    new THREE.MeshBasicMaterial({ map: makeTextTexture('GUIGNOL', { color: '#ffd77a' }), transparent: true }),
    0, 2.56, -0.27
  );
  sign.rotation.y = Math.PI;
  sign.userData.noShadow = true;
  ctx.colliders.push({
    minX: gx - 1.6, maxX: gx + 1.6, minY: gy, maxY: gy + 2.6, minZ: gz - 0.8, maxZ: gz + 0.8,
  });

  const guignol = makePuppet({ jacket: 0xa62633, hat: 0x23262d });
  const gnafron = makePuppet({ jacket: 0x4a3524, hat: 0x5a2d2d, nose: 0xc23a3a });
  guignol.position.set(-0.55, 0.7, 0);
  gnafron.position.set(0.55, 0.7, 0);
  group.add(guignol, gnafron);
  ctx.pois?.push({ id: 'guignol', nom: 'Le castelet de Guignol', emoji: '🎭', x: gx, z: gz });

  // Le bâton, posé sur le rebord après chaque spectacle
  ctx.interactables.push({
    x: gx, z: gz + 2, r: 3.4,
    label: 'E — Ramasser le bâton de Guignol',
    action: () => {
      if (hasBaton?.()) notify?.('🎭 T’as déjà le bâton, gone — un seul par canant !');
      else onBaton?.();
    },
  });

  let lastLine = -1;
  ctx.updatables.push(() => {
    const t = Date.now() % SHOW_MS;
    const showing = t < SHOW_LEN;
    // Hors spectacle : marionnettes cachées sous la scène
    const base = showing ? 1.35 : 0.4;
    const beat = t / 1000;
    guignol.position.y = base + (showing ? Math.abs(Math.sin(beat * 2.2)) * 0.12 : 0);
    gnafron.position.y = base + (showing ? Math.abs(Math.sin(beat * 2.2 + 1.4)) * 0.12 : 0);
    guignol.rotation.z = showing ? Math.sin(beat * 3.1) * 0.16 : 0;
    gnafron.rotation.z = showing ? Math.sin(beat * 2.7 + 0.9) * 0.16 : 0;
    if (!showing) { lastLine = -1; return; }

    // Une réplique toutes les ~7 s, jouée seulement si on est au spectacle
    const idx = Math.floor(t / 7200);
    if (idx !== lastLine && idx < LINES.length) {
      lastLine = idx;
      const p = ctx.playerPos();
      if (Math.hypot(p.x - gx, p.z - gz) < 22) {
        const [who, text] = LINES[idx];
        notify?.(`🎭 ${who === 'guignol' ? 'Guignol' : 'Gnafron'} : « ${text} »`);
        speak?.(text, { pitch: who === 'guignol' ? 1.5 : 0.5, rate: 1.05, volume: 1 });
      }
    }
  });
}
