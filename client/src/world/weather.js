import * as THREE from 'three';

// Pluie lyonnaise partagée 🌧 : les averses sont calées sur Date.now(),
// comme le cycle jour/nuit et le silure — même météo chez tous les joueurs,
// zéro trafic réseau. Chaque cycle de 40 min contient deux fenêtres de
// pluie déterministes (la graine est le numéro de cycle) : ~20 % du temps
// sous l'averse, jamais deux cycles identiques.
const CYCLE_MS = 40 * 60 * 1000;

export function rainAmount(now = Date.now()) {
  const cycle = Math.floor(now / CYCLE_MS);
  const t = (now % CYCLE_MS) / CYCLE_MS;
  const h1 = ((cycle * 2654435761) >>> 16 & 1023) / 1023;
  const h2 = ((cycle * 1597334677) >>> 16 & 1023) / 1023;
  const a = 0.06 + h1 * 0.28; // première fenêtre, dans la 1re moitié
  const b = 0.55 + h2 * 0.3; // seconde fenêtre, dans la 2de moitié
  const win = (t0, len) => {
    if (t < t0 || t > t0 + len) return 0;
    const u = (t - t0) / len;
    return Math.min(1, Math.min(u, 1 - u) * 6); // fondu d'entrée/sortie
  };
  return Math.max(win(a, 0.13), win(b, 0.08));
}

const DROPS = 460; // gouttes simultanées (boîte locale autour de la caméra)
const BOX = 38; // demi-largeur de la boîte de pluie
const H = 26; // hauteur balayée

export function createWeather(ctx, { audio, camera } = {}) {
  const positions = new Float32Array(DROPS * 2 * 3);
  const drops = [];
  for (let i = 0; i < DROPS; i++) {
    drops.push({
      x: (Math.random() * 2 - 1) * BOX,
      y: Math.random() * H,
      z: (Math.random() * 2 - 1) * BOX,
      v: 34 + Math.random() * 14,
    });
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const mat = new THREE.LineBasicMaterial({
    color: 0xaec4d4, transparent: true, opacity: 0,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const rain = new THREE.LineSegments(geo, mat);
  rain.frustumCulled = false;
  rain.visible = false;
  rain.userData.noShadow = true;
  ctx.scene.add(rain);

  // La brume se resserre sous l'averse : on garde la densité d'origine et
  // on la module (le fog est posé par main.js selon la taille de la carte).
  let baseFog = null;

  ctx.updatables.push((dt) => {
    const amount = rainAmount();
    audio?.rain?.(amount);
    if (ctx.scene.fog?.isFogExp2) {
      if (baseFog == null) baseFog = ctx.scene.fog.density;
      ctx.scene.fog.density = baseFog * (1 + amount * 1.4);
    }
    if (amount <= 0.01) {
      rain.visible = false;
      return;
    }
    rain.visible = true;
    mat.opacity = 0.36 * amount;
    const cam = camera.position;
    rain.position.set(cam.x, cam.y - H * 0.45, cam.z);
    for (let i = 0; i < DROPS; i++) {
      const d = drops[i];
      d.y -= d.v * dt;
      if (d.y < 0) {
        d.y += H;
        d.x = (Math.random() * 2 - 1) * BOX;
        d.z = (Math.random() * 2 - 1) * BOX;
      }
      const o = i * 6;
      positions[o] = d.x; positions[o + 1] = d.y; positions[o + 2] = d.z;
      positions[o + 3] = d.x; positions[o + 4] = d.y + 0.7; positions[o + 5] = d.z;
    }
    geo.attributes.position.needsUpdate = true;
  });
}
