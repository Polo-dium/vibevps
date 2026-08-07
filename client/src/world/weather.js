import * as THREE from 'three';
import { currentSeason } from './seasons.js';

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
  // En HIVER, l'averse partagée devient NEIGE : flocons blancs qui tombent
  // lentement, sans bruit de pluie. Même horloge, même fenêtres.
  const snow = currentSeason() === 'hiver';
  const positions = new Float32Array(DROPS * 2 * 3);
  const drops = [];
  for (let i = 0; i < DROPS; i++) {
    drops.push({
      x: (Math.random() * 2 - 1) * BOX,
      y: Math.random() * H,
      z: (Math.random() * 2 - 1) * BOX,
      v: snow ? 6 + Math.random() * 4 : 34 + Math.random() * 14,
      sway: Math.random() * Math.PI * 2,
    });
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const mat = new THREE.LineBasicMaterial({
    color: snow ? 0xeef4fb : 0xaec4d4, transparent: true, opacity: 0,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const rain = new THREE.LineSegments(geo, mat);
  rain.frustumCulled = false;
  rain.visible = false;
  rain.userData.noShadow = true;
  ctx.scene.add(rain);

  // Gros nuages d'averse : des sprites doux gris sombre très haut, en
  // grappes — 30 sprites au total, coût GPU dérisoire. Ils se lèvent avec
  // la pluie (opacité = amount) et dérivent lentement.
  const cloudTex = (() => {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d');
    for (const [cx2, cy2, r] of [[46, 74, 42], [82, 66, 46], [64, 52, 38]]) {
      const grad = g.createRadialGradient(cx2, cy2, 6, cx2, cy2, r);
      grad.addColorStop(0, 'rgba(74,80,90,0.55)');
      grad.addColorStop(1, 'rgba(74,80,90,0)');
      g.fillStyle = grad;
      g.fillRect(0, 0, 128, 128);
    }
    return new THREE.CanvasTexture(c);
  })();
  const clouds = [];
  const bound = ctx.worldBound ?? 200;
  let cseed = 4807; // le sommet du Mont Blanc, forcément
  const crand = () => { cseed = (cseed * 1664525 + 1013904223) >>> 0; return cseed / 4294967296; };
  for (let i = 0; i < 10; i++) {
    const gx = (crand() * 2 - 1) * bound * 0.9;
    const gz = (crand() * 2 - 1) * bound * 0.9;
    for (let j = 0; j < 3; j++) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({
        map: cloudTex, transparent: true, opacity: 0, depthWrite: false,
      }));
      const s = 90 + crand() * 120;
      sp.scale.set(s * (1.3 + crand() * 0.6), s * 0.5, 1);
      sp.position.set(gx + (crand() * 2 - 1) * 70, 185 + crand() * 45, gz + (crand() * 2 - 1) * 70);
      sp.userData.noShadow = true;
      ctx.scene.add(sp);
      clouds.push({ sp, drift: 1.2 + crand() * 1.6 });
    }
  }

  // La brume se resserre sous l'averse : on garde la densité d'origine et
  // on la module (le fog est posé par main.js selon la taille de la carte).
  let baseFog = null;

  // FEUILLES D'AUTOMNE : un petit nuage de points roux qui tombe en
  // tourbillonnant autour de la caméra, toute la saison.
  let leaves = null;
  if (currentSeason() === 'automne') {
    const N = 90;
    const lp = new Float32Array(N * 3);
    const lv = [];
    for (let i = 0; i < N; i++) {
      lv.push({
        x: (Math.random() * 2 - 1) * 24, y: Math.random() * 16,
        z: (Math.random() * 2 - 1) * 24, sway: Math.random() * Math.PI * 2,
      });
    }
    const lgeo = new THREE.BufferGeometry();
    lgeo.setAttribute('position', new THREE.BufferAttribute(lp, 3));
    leaves = {
      lv, lp, lgeo,
      mesh: new THREE.Points(lgeo, new THREE.PointsMaterial({
        color: 0xc26a2a, size: 0.22, transparent: true, opacity: 0.85, depthWrite: false,
      })),
    };
    leaves.mesh.frustumCulled = false;
    leaves.mesh.userData.noShadow = true;
    ctx.scene.add(leaves.mesh);
  }

  ctx.updatables.push((dt) => {
    const amount = rainAmount();
    audio?.rain?.(snow ? 0 : amount); // la neige tombe en silence

    if (leaves) {
      const cam = camera.position;
      leaves.mesh.position.set(cam.x, cam.y - 6, cam.z);
      for (let i = 0; i < leaves.lv.length; i++) {
        const l = leaves.lv[i];
        l.sway += dt * 1.6;
        l.y -= dt * (1.1 + Math.sin(l.sway * 0.7) * 0.3);
        if (l.y < 0) { l.y += 16; l.x = (Math.random() * 2 - 1) * 24; l.z = (Math.random() * 2 - 1) * 24; }
        leaves.lp[i * 3] = l.x + Math.sin(l.sway) * 0.8;
        leaves.lp[i * 3 + 1] = l.y;
        leaves.lp[i * 3 + 2] = l.z + Math.cos(l.sway * 0.8) * 0.6;
      }
      leaves.lgeo.attributes.position.needsUpdate = true;
    }
    // La pluie épaissit la brume PAR-DESSUS la densité du palier de qualité.
    // Cette densité de base change quand le joueur change de palier (portée
    // de vue) : on la relit à chaque fois au lieu de la figer une fois pour
    // toutes, sinon la pluie verrouille la brume d'un ancien palier.
    if (ctx.scene.fog?.isFogExp2) {
      const base = ctx.fogBaseDensity ?? (baseFog ??= ctx.scene.fog.density);
      ctx.scene.fog.density = base * (1 + amount * 1.4);
    }
    for (const c of clouds) {
      c.sp.material.opacity = amount * 0.6;
      c.sp.visible = amount > 0.01;
      if (c.sp.visible) {
        c.sp.position.x += c.drift * dt;
        if (c.sp.position.x > bound * 1.1) c.sp.position.x = -bound * 1.1;
      }
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
      if (snow) d.sway += dt * 1.3;
      const sx = snow ? d.x + Math.sin(d.sway) * 0.5 : d.x;
      const o = i * 6;
      positions[o] = sx; positions[o + 1] = d.y; positions[o + 2] = d.z;
      positions[o + 3] = sx; positions[o + 4] = d.y + (snow ? 0.14 : 0.7); positions[o + 5] = d.z;
    }
    geo.attributes.position.needsUpdate = true;
  });
}
