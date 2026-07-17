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

  // --- Avions de ligne + traînées de condensation --------------------------
  // QUATRE vols très haut, caps « au hasard » mais déterministes (l'index
  // sème l'angle) : leur position ne dépend que de l'horloge, tout le monde
  // voit les mêmes chemtrails. La traînée court sur TOUTE la traversée : un
  // plan couché étiré du point d'entrée jusqu'à l'avion.
  const liners = [];
  const linerGeo = new THREE.BoxGeometry(7, 0.7, 5);
  const linerMat = new THREE.MeshBasicMaterial({ color: 0xe8edf2 });
  const trailGeo = new THREE.PlaneGeometry(1, 3.8);
  for (let i = 0; i < 4; i++) {
    const mesh = new THREE.Mesh(linerGeo, linerMat);
    mesh.userData.noShadow = true;
    ctx.scene.add(mesh);
    const trailMesh = new THREE.Mesh(trailGeo, new THREE.MeshBasicMaterial({
      color: 0xffffff, transparent: true, opacity: 0.14,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    }));
    trailMesh.userData.noShadow = true;
    ctx.scene.add(trailMesh);
    liners.push({
      mesh, trailMesh,
      heading: i * 1.83 + 0.65, // caps bien répartis, figés par l'index
      lateral: (i - 1.5) * bound * 0.42, // décalé du centre, couvre la carte
      alt: 430 + i * 28,
      period: 200000 + i * 41000,
      phase: i * 67000,
    });
  }

  // --- Montgolfières : trois ballons qui dérivent au-dessus des collines --
  // Position = pure fonction de l'horloge (cercles lents) : mêmes ballons
  // au même endroit chez tous les joueurs.
  const balloons = [];
  const balloonColors = [0xd9333f, 0xffd23f, 0x4da6ff];
  const basketMat = new THREE.MeshLambertMaterial({ color: 0x7a5230 });
  for (let i = 0; i < 3; i++) {
    const g = new THREE.Group();
    const envelope = new THREE.Mesh(
      new THREE.SphereGeometry(7, 10, 8),
      new THREE.MeshLambertMaterial({ color: balloonColors[i] })
    );
    envelope.scale.y = 1.18;
    g.add(envelope);
    const skirt = new THREE.Mesh(
      new THREE.ConeGeometry(4.2, 4.5, 10, 1, true),
      new THREE.MeshLambertMaterial({ color: 0xf0ead8, side: THREE.DoubleSide })
    );
    skirt.position.y = -8.4;
    g.add(skirt);
    const basket = new THREE.Mesh(new THREE.BoxGeometry(2.4, 1.7, 2.4), basketMat);
    basket.position.y = -11.6;
    g.add(basket);
    ctx.scene.add(g);
    balloons.push({
      g,
      cx: -bound * 0.45 + i * bound * 0.22,
      cz: -bound * 0.3 + i * bound * 0.24,
      alt: 150 + i * 24,
      w: 0.000028 + i * 0.000009,
      phase: i * 2.1,
    });
  }

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

    // Chaque vol traverse la carte en ligne droite selon SON cap, la
    // traînée s'étirant du bord d'entrée jusqu'à l'avion.
    const R = bound * 1.35;
    for (const l of liners) {
      const lt = ((now + l.phase) % l.period) / l.period;
      const dirX = Math.sin(l.heading), dirZ = Math.cos(l.heading);
      // point d'entrée décalé latéralement, trajet 2R le long du cap
      const sx = -dirX * R + dirZ * l.lateral;
      const sz = -dirZ * R - dirX * l.lateral;
      const dist = lt * 2 * R;
      const lx = sx + dirX * dist, lz = sz + dirZ * dist;
      l.mesh.position.set(lx, l.alt, lz);
      l.mesh.rotation.y = Math.atan2(dirX, dirZ);
      // traînée : plan couché du départ à l'avion (léger retrait au nez)
      const half = Math.max(1, dist - 12) / 2;
      l.trailMesh.scale.x = half * 2;
      l.trailMesh.position.set(sx + dirX * half, l.alt - 0.6, sz + dirZ * half);
      l.trailMesh.rotation.set(-Math.PI / 2, 0, Math.PI / 2 - l.mesh.rotation.y);
      l.trailMesh.material.opacity = 0.14 * Math.min(1, lt * 8);
    }

    // Montgolfières : dérive circulaire lente + respiration verticale
    for (const bl of balloons) {
      const a = now * bl.w + bl.phase;
      bl.g.position.set(
        bl.cx + Math.cos(a) * 55,
        bl.alt + Math.sin(now / 4200 + bl.phase) * 4,
        bl.cz + Math.sin(a) * 55
      );
    }

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
