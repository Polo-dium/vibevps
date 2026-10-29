import * as THREE from 'three';

// Dôme de ciel en dégradé 3 tons (zénith / mi-hauteur / horizon) avec un
// voile chaud du côté du soleil, + nuages dérivants.
export function buildSky(scene, radius = 470) {
  const uniforms = {
    topColor: { value: new THREE.Color(0x2e63b8) },
    midColor: { value: new THREE.Color(0x7fa8dd) },
    horizonColor: { value: new THREE.Color(0xdce6ee) },
    sunDir: { value: new THREE.Vector3(-90, 130, 50).normalize() },
    sunTint: { value: new THREE.Color(0xffe0b0) },
    starAmount: { value: 0 },
    dayAmount: { value: 1 },
    moonDir: { value: new THREE.Vector3(0.5, 0.4, -0.3).normalize() },
  };
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(radius, 24, 12),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms,
      vertexShader: `
        varying vec3 vPos;
        void main() {
          vPos = position;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: `
        varying vec3 vPos;
        uniform vec3 topColor;
        uniform vec3 midColor;
        uniform vec3 horizonColor;
        uniform vec3 sunDir;
        uniform vec3 sunTint;
        uniform float starAmount;
        uniform float dayAmount;
        uniform vec3 moonDir;
        // Bruit de hachage bon marché pour les étoiles
        float hash(vec3 p) {
          p = fract(p * 0.3183099 + 0.1);
          p *= 17.0;
          return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
        }
        void main() {
          vec3 dir = normalize(vPos);
          float h = max(dir.y, 0.0);
          // Dégradé en deux temps : horizon -> mi-hauteur -> zénith
          vec3 col = mix(horizonColor, midColor, smoothstep(0.0, 0.28, h));
          col = mix(col, topColor, smoothstep(0.28, 0.85, h));
          // Voile chaud autour du soleil, surtout près de l'horizon
          float s = pow(max(dot(dir, sunDir), 0.0), 6.0);
          col = mix(col, sunTint, s * 0.5 * (1.0 - smoothstep(0.0, 0.5, h)) + s * 0.15);
          // DISQUE du soleil : cœur brûlant + petite couronne, le jour
          float sunDot = dot(dir, sunDir);
          float disc = smoothstep(0.99955, 0.99985, sunDot);
          float corona = pow(max(sunDot, 0.0), 900.0);
          col += (vec3(1.0, 0.92, 0.72) * disc * 1.6 + sunTint * corona * 0.8) * dayAmount;
          // LUNE : disque pâle avec un « grignotage » qui suggère la phase
          float moonDot = dot(dir, moonDir);
          float moon = smoothstep(0.99965, 0.99985, moonDot);
          float bite = smoothstep(0.99965, 0.99985, dot(dir, normalize(moonDir + vec3(0.006, 0.004, 0.0))));
          col += vec3(0.86, 0.9, 0.98) * max(0.0, moon - bite * 0.55) * (1.0 - dayAmount);
          col += vec3(0.5, 0.55, 0.7) * pow(max(moonDot, 0.0), 700.0) * 0.3 * (1.0 - dayAmount);
          // Étoiles la nuit (seuil sur un bruit fixe : elles ne scintillent pas)
          if (starAmount > 0.01 && h > 0.05) {
            float st = step(0.9975, hash(floor(dir * 220.0)));
            col += vec3(st) * starAmount * smoothstep(0.05, 0.3, h);
            // VOIE LACTÉE : une écharpe laiteuse inclinée, granuleuse — un
            // cœur dense et brillant dans un voile plus large et diffus
            float bd = dot(dir, normalize(vec3(0.55, 0.25, 0.8)));
            float band = exp(-bd * bd * 18.0);
            float core = exp(-bd * bd * 60.0);
            float grain = 0.62 + 0.38 * hash(floor(dir * 120.0));
            col += (vec3(0.5, 0.56, 0.72) * band * 0.3 + vec3(0.72, 0.76, 0.9) * core * grain * 0.34)
              * starAmount * smoothstep(0.05, 0.3, h);
            // Sur-densité d'étoiles dans l'écharpe
            float stMw = step(0.985, hash(floor(dir * 300.0))) * band;
            col += vec3(0.9) * stMw * starAmount * smoothstep(0.05, 0.3, h);
          }
          gl_FragColor = vec4(col, 1.0);
        }`,
    })
  );
  dome.renderOrder = -10;
  dome.userData.noShadow = true;
  scene.add(dome);

  // Nuages : cumulus peints (sommets éclairés, base plate et grise),
  // répartis sur toute la carte. Placement par seed fixe et dérive calée
  // sur Date.now() : le même ciel chez tous les joueurs, sans réseau.
  // Panneaux qui ne pivotent QU'AUTOUR DE LA VERTICALE (calculé dans le
  // shader) : en avion, quand on s'incline, les nuages restent posés sur
  // l'horizon au lieu de tourner avec la caméra comme des sprites.
  // Un InstancedMesh par texture : 4 draw calls pour 42 nuages.
  const R = Math.max(700, radius * 0.8);
  const crand = mulberry(9157);
  const texs = [0, 1, 2, 3].map((k) => makeCloudTexture(mulberry(311 + k * 97), k));
  const cloudU = { uBright: { value: 1 }, uFade: { value: 1 } };
  const plane = new THREE.PlaneGeometry(1, 1);
  const packs = texs.map((map) => {
    const mat = new THREE.ShaderMaterial({
      uniforms: { map: { value: map }, ...cloudU },
      transparent: true,
      depthWrite: false,
      vertexShader: /* glsl */`
        varying vec2 vUv;
        varying float vA;
        void main() {
          vec3 c = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
          float sx = length(instanceMatrix[0].xyz), sy = length(instanceMatrix[1].xyz);
          vec2 to = cameraPosition.xz - c.xz;
          vec2 rt = normalize(vec2(to.y, -to.x) + vec2(1e-5, 0.0));
          vec3 p = c + vec3(rt.x, 0.0, rt.y) * position.x * sx + vec3(0.0, position.y * sy, 0.0);
          gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
          vUv = uv;
          vA = instanceColor.r; // opacité propre au nuage
        }`,
      fragmentShader: /* glsl */`
        uniform sampler2D map;
        uniform float uBright;
        uniform float uFade;
        varying vec2 vUv;
        varying float vA;
        void main() {
          vec4 t = texture2D(map, vUv);
          gl_FragColor = vec4(t.rgb * vec3(uBright, uBright, uBright * 1.06), t.a * vA * uFade);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    const im = new THREE.InstancedMesh(plane, mat, 11);
    im.count = 0;
    im.frustumCulled = false; // positions recalculées dans le shader
    im.renderOrder = -6;
    im.userData.noCull = true;
    im.userData.noShadow = true;
    im.name = 'nuages';
    scene.add(im);
    return im;
  });
  const clouds = [];
  const _c = new THREE.Color();
  for (let i = 0; i < 42; i++) {
    const far = i % 3 === 0; // quelques nuages plus hauts et plus pâles
    const opacity = far ? 0.55 + crand() * 0.2 : 0.8 + crand() * 0.2;
    const sz = (far ? 260 : 170) + crand() * 220;
    const x0 = (crand() - 0.5) * 2 * R;
    const y = (far ? 340 : 230) + crand() * 110;
    const z = (crand() - 0.5) * 2 * R;
    const speed = 2 + crand() * 2.5;
    const im = packs[i % 4], k = im.count++;
    im.setColorAt(k, _c.setRGB(opacity, 0, 0));
    clouds.push({ im, k, x0, y, z, speed, sx: sz, sy: sz * 0.42 });
  }
  const _m = new THREE.Matrix4();

  // daylight ∈ [0,1] : les nuages s'estompent et s'assombrissent la nuit.
  // pos : le dôme suit le joueur (horizontalement) pour que son disque
  // solaire coïncide toujours avec le soleil 3D, sans parallaxe.
  function update(dt, daylight = 1, pos = null) {
    if (pos) dome.position.set(pos.x, 0, pos.z);
    const t = Date.now() / 1000;
    const span = 4 * R;
    for (const c of clouds) {
      // dérive d'ouest en est, bouclée sur la largeur du ciel
      const x = ((((c.x0 + R * 2 + c.speed * t) % span) + span) % span) - R * 2;
      _m.makeScale(c.sx, c.sy, 1).setPosition(x, c.y, c.z);
      c.im.setMatrixAt(c.k, _m);
    }
    for (const im of packs) im.instanceMatrix.needsUpdate = true;
    cloudU.uFade.value = 0.2 + 0.8 * daylight;
    cloudU.uBright.value = 0.28 + 0.72 * daylight;
  }

  return { update, uniforms };
}

// Générateur pseudo-aléatoire local (seed fixe : le même ciel pour tous)
function mulberry(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Cumulus : amas de bulles (silhouette), puis ombrage — un pixel dont le
// dessus est encore « dans » le nuage est à l'ombre (lumière du haut) :
// sommets blancs, ventre gris-bleu, base plate coupée net.
function makeCloudTexture(rand, kind) {
  const W = 256, H = 128;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  const base = 92 + kind * 3; // ligne de base (px)
  const n = 26 + kind * 4;
  for (let i = 0; i < n; i++) {
    const x = 34 + rand() * 188;
    const mid = 1 - Math.abs(x - 128) / 110; // plus haut au centre
    const r = 10 + rand() * 16 + mid * 18;
    const y = base - r * (0.5 + rand() * 0.6) - mid * 22;
    const grad = g.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.7, 'rgba(255,255,255,0.85)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
  }
  const img = g.getImageData(0, 0, W, H), d = img.data;
  const A = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) A[i] = d[i * 4 + 3] / 255;
  const at = (x, y) => (x < 0 || y < 0 || x >= W || y >= H ? 0 : A[y * W + x]);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      let a = Math.min(1, Math.max(0, (A[i] - 0.06) / 0.75));
      // base plate : fondu net sous la ligne de base
      a *= Math.min(1, Math.max(0, (base + 4 - y) / 10));
      // ombre propre : densité au-dessus du point
      const occ = (at(x, y - 6) + at(x - 3, y - 12) + at(x + 3, y - 18)) / 3;
      const sh = Math.min(1, occ * 1.1) * 0.75 + Math.max(0, (y - base + 30) / 30) * 0.25;
      const r = 255 - sh * 80, gg = 255 - sh * 70, b = 255 - sh * 50;
      d[i * 4] = r; d[i * 4 + 1] = gg; d[i * 4 + 2] = b;
      d[i * 4 + 3] = a * 255;
    }
  }
  g.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
