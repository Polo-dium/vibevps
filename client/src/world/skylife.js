import * as THREE from 'three';

// La vie dans le ciel 🕊 : mouettes qui tournoient le long des fleuves,
// avions de ligne très haut avec leur traînée de condensation, fumées de
// cheminée aux heures dorées. Tout est déterministe (Date.now / positions
// dérivées du monde) et léger : quelques dizaines de triangles animés.

function makeRand(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export function createSkylife(ctx) {
  const bound = ctx.worldBound ?? 140;
  const rand = makeRand(80085);

  // --- Mouettes : 3 vols de 5 oiseaux, en ronde au-dessus des berges -----
  const gullMat = new THREE.MeshBasicMaterial({ color: 0xf2f4f6 });
  const wingGeo = new THREE.BufferGeometry();
  // deux ailes en V (4 triangles fins), origine au corps
  wingGeo.setAttribute('position', new THREE.Float32BufferAttribute([
    0, 0, -0.18, -0.85, 0.1, 0.05, 0, 0, 0.12,
    0, 0, -0.18, 0, 0, 0.12, 0.85, 0.1, 0.05,
  ], 3));
  wingGeo.computeVertexNormals();

  // Points d'ancrage : le long des fleuves si on les connaît, sinon autour
  // du centre-ville.
  const anchors = [];
  const bands = ctx.waterBands ?? [];
  for (const band of bands.slice(0, 2)) {
    for (const z of [-bound * 0.3, bound * 0.25]) {
      const x = band.cx ? band.cx(z) : 0;
      anchors.push([x, z]);
    }
  }
  if (!anchors.length) anchors.push([30, 20], [-40, -30], [60, -60]);

  const flocks = [];
  for (let f = 0; f < Math.min(3, anchors.length); f++) {
    const [ax, az] = anchors[f];
    const group = new THREE.Group();
    const birds = [];
    for (let i = 0; i < 5; i++) {
      const bird = new THREE.Mesh(wingGeo, gullMat);
      bird.userData.noShadow = true;
      const s = 0.8 + rand() * 0.5;
      bird.scale.setScalar(s);
      group.add(bird);
      birds.push({
        mesh: bird,
        r: 6 + rand() * 10, // rayon de ronde propre à l'oiseau
        phase: rand() * Math.PI * 2,
        speed: 0.5 + rand() * 0.35,
        h: rand() * 5,
        flap: 4 + rand() * 3,
      });
    }
    group.position.set(ax, 22 + rand() * 10, az);
    ctx.scene.add(group);
    flocks.push({ group, birds, drift: rand() * Math.PI * 2 });
  }

  // --- Avion de ligne + traînée de condensation ---------------------------
  // Une croix minuscule très haut, dont la position ne dépend que de
  // l'horloge : tout le monde voit le même vol au même endroit.
  const LINER_PERIOD = 210000; // une traversée toutes les 3 min 30
  const liner = new THREE.Mesh(
    new THREE.BoxGeometry(7, 0.7, 5),
    new THREE.MeshBasicMaterial({ color: 0xe8edf2 })
  );
  liner.userData.noShadow = true;
  ctx.scene.add(liner);
  const trail = new THREE.Mesh(
    new THREE.PlaneGeometry(320, 3.4),
    new THREE.MeshBasicMaterial({
      color: 0xffffff, transparent: true, opacity: 0.16,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    })
  );
  trail.userData.noShadow = true;
  ctx.scene.add(trail);

  // --- Fumées de cheminée aux transitions jour/nuit -----------------------
  const smokeTex = (() => {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d');
    const grad = g.createRadialGradient(32, 32, 4, 32, 32, 30);
    grad.addColorStop(0, 'rgba(235,235,235,0.8)');
    grad.addColorStop(1, 'rgba(235,235,235,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
    return new THREE.CanvasTexture(c);
  })();
  const smokes = [];
  for (let i = 0; i < 5; i++) {
    const x = (rand() * 2 - 1) * bound * 0.35;
    const z = (rand() * 2 - 1) * bound * 0.35;
    const baseY = Math.max(0, ctx.terrainHeight?.(x, z) ?? 0) + 17 + rand() * 8;
    const puffs = [];
    const g = new THREE.Group();
    for (let j = 0; j < 3; j++) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({
        map: smokeTex, transparent: true, opacity: 0, depthWrite: false,
      }));
      sp.scale.setScalar(2 + j * 1.4);
      g.add(sp);
      puffs.push({ sp, t: j / 3 });
    }
    g.position.set(x, baseY, z);
    ctx.scene.add(g);
    smokes.push({ group: g, puffs, speed: 0.16 + rand() * 0.1 });
  }

  ctx.updatables.push((dt) => {
    const now = Date.now();

    for (const flock of flocks) {
      flock.drift += dt * 0.03;
      for (const b of flock.birds) {
        b.phase += dt * b.speed;
        const a = b.phase + flock.drift;
        b.mesh.position.set(Math.cos(a) * b.r, b.h + Math.sin(b.phase * 0.7) * 1.2, Math.sin(a) * b.r);
        b.mesh.rotation.y = -a - Math.PI / 2; // tangent à la ronde
        // battement : les ailes montent/descendent par rotation en Z
        b.mesh.rotation.z = Math.sin(b.phase * b.flap) * 0.45;
      }
    }

    // Ligne droite nord-ouest → sud-est, très haut, cap constant
    const lt = (now % LINER_PERIOD) / LINER_PERIOD;
    const lx = -bound * 1.2 + lt * bound * 2.4;
    const lz = -bound * 0.8 + lt * bound * 1.3;
    liner.position.set(lx, 470, lz);
    liner.rotation.y = Math.atan2(bound * 2.4, bound * 1.3);
    trail.position.set(lx - 170 * Math.sin(liner.rotation.y), 470, lz - 170 * Math.cos(liner.rotation.y));
    trail.rotation.set(-Math.PI / 2, 0, Math.PI / 2 - liner.rotation.y);
    // La traînée s'estompe en début de traversée (elle « naît » avec l'avion)
    trail.material.opacity = 0.16 * Math.min(1, lt * 5);

    // Fumées : visibles surtout aux transitions (aube/crépuscule)
    const glow = ctx.env?.dusk ?? 0;
    for (const s of smokes) {
      for (const p of s.puffs) {
        p.t += dt * s.speed;
        if (p.t > 1) p.t -= 1;
        p.sp.position.set(Math.sin(p.t * 9) * 0.7, p.t * 9, 0);
        p.sp.material.opacity = glow * 0.5 * (1 - p.t) * Math.min(1, p.t * 4);
      }
    }
  });
}
