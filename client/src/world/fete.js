import * as THREE from 'three';

// La Fête des Lumières 🏮 : une nuit sur trois (horloge partagée Date.now,
// même motif que le silure et la quenelle — aucun trafic réseau), Lyon
// s'illumine : lumignons chauds sur les façades du centre, projections
// colorées sur la basilique de Fourvière et feux d'artifice au-dessus de
// la colline. Tout en sprites/points additifs, zéro vraie lumière.
const DAY_MS = 600000; // durée du cycle jour/nuit (main.js)

function makeRand(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const COLORS = [0xff5252, 0xffd23f, 0x53c8ff, 0xb06bff, 0x69f0ae, 0xff8bd1];

export function createFete(ctx, { notify } = {}) {
  const rand = makeRand(1208); // le 8 décembre, évidemment
  const bound = ctx.worldBound ?? 140;
  const basilique = ctx.pois?.find((p) => p.id === 'basilique');
  const bx = basilique?.x ?? -60, bz = basilique?.z ?? -40;
  const by = Math.max(0, ctx.terrainHeight?.(bx, bz) ?? 0);

  const isFeteNight = () =>
    Math.floor(Date.now() / DAY_MS) % 3 === 2 && (ctx.env?.night ?? 0) > 0.35;

  // --- Lumignons : petites flammes chaudes semées sur le centre ----------
  const lumiCount = 420;
  const lumiPos = new Float32Array(lumiCount * 3);
  const spread = Math.min(bound * 0.5, 320);
  for (let i = 0; i < lumiCount; i++) {
    lumiPos[i * 3] = (rand() * 2 - 1) * spread;
    lumiPos[i * 3 + 1] = 2.5 + rand() * 16;
    lumiPos[i * 3 + 2] = (rand() * 2 - 1) * spread;
  }
  const lumiGeo = new THREE.BufferGeometry();
  lumiGeo.setAttribute('position', new THREE.BufferAttribute(lumiPos, 3));
  const lumiMat = new THREE.PointsMaterial({
    color: 0xffb347, size: 0.85, transparent: true, opacity: 0,
    blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true,
  });
  const lumignons = new THREE.Points(lumiGeo, lumiMat);
  lumignons.visible = false;
  lumignons.userData.noShadow = true;
  ctx.scene.add(lumignons);

  // --- Projections : halos colorés qui tournent sur la basilique ---------
  const glowTex = (() => {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d');
    const grad = g.createRadialGradient(32, 32, 2, 32, 32, 30);
    grad.addColorStop(0, 'rgba(255,255,255,0.9)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
    return new THREE.CanvasTexture(c);
  })();
  const glows = [];
  for (let i = 0; i < 5; i++) {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTex, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    sp.position.set(bx + (rand() * 2 - 1) * 16, by + 12 + rand() * 22, bz + (rand() * 2 - 1) * 16);
    sp.scale.setScalar(14 + rand() * 10);
    sp.userData.noShadow = true;
    ctx.scene.add(sp);
    glows.push(sp);
  }

  // --- Feux d'artifice : 4 gerbes en pool au-dessus de Fourvière ---------
  const bursts = [];
  for (let b = 0; b < 4; b++) {
    const n = 70;
    const dirs = [];
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      // direction aléatoire sur la sphère
      const u = rand() * 2 - 1, a = rand() * Math.PI * 2;
      const r = Math.sqrt(1 - u * u);
      dirs.push([r * Math.cos(a), u, r * Math.sin(a)]);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.PointsMaterial({
      color: COLORS[b % COLORS.length], size: 1.7, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const points = new THREE.Points(geo, mat);
    points.visible = false;
    points.frustumCulled = false;
    points.userData.noShadow = true;
    ctx.scene.add(points);
    bursts.push({ points, dirs, pos, t: 1 + b * 0.6, colorIdx: b });
  }

  let wasFete = false;
  let hue = 0;

  ctx.updatables.push((dt) => {
    const fete = isFeteNight();
    if (fete && !wasFete) {
      notify?.('🏮 FÊTE DES LUMIÈRES ! Lumignons, projections sur Fourvière et feu d’artifice — lève les yeux, gone.');
    }
    wasFete = fete;
    lumignons.visible = fete;
    if (fete) {
      // scintillement doux des lumignons
      lumiMat.opacity = 0.75 + Math.sin(Date.now() / 260) * 0.15;
    }
    hue += dt * 0.05;
    for (let i = 0; i < glows.length; i++) {
      const m = glows[i].material;
      m.opacity += ((fete ? 0.5 : 0) - m.opacity) * Math.min(1, dt * 2);
      if (fete) m.color.setHSL((hue + i / glows.length) % 1, 0.85, 0.62);
    }
    for (const burst of bursts) {
      burst.t += dt * 0.6;
      if (burst.t >= 1) {
        if (!fete) { burst.points.visible = false; continue; }
        // relance : nouveau départ au-dessus de la colline, nouvelle couleur
        burst.t = -rand() * 0.8; // petit délai aléatoire entre les gerbes
        burst.colorIdx = (burst.colorIdx + 1) % COLORS.length;
        burst.points.material.color.setHex(COLORS[burst.colorIdx]);
        burst.points.position.set(
          bx + (rand() * 2 - 1) * 40, by + 55 + rand() * 25, bz + (rand() * 2 - 1) * 40
        );
      }
      if (burst.t < 0) { burst.points.visible = false; continue; }
      burst.points.visible = true;
      const r = burst.t * 24;
      const fall = burst.t * burst.t * 7; // les étincelles retombent
      for (let i = 0; i < burst.dirs.length; i++) {
        const d = burst.dirs[i];
        burst.pos[i * 3] = d[0] * r;
        burst.pos[i * 3 + 1] = d[1] * r - fall;
        burst.pos[i * 3 + 2] = d[2] * r;
      }
      burst.points.geometry.attributes.position.needsUpdate = true;
      burst.points.material.opacity = Math.max(0, 1 - burst.t);
    }
  });
}
