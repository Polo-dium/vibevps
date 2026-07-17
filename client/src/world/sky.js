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
            // VOIE LACTÉE : une écharpe laiteuse inclinée, granuleuse
            float band = exp(-pow(dot(dir, normalize(vec3(0.55, 0.25, 0.8))), 2.0) * 26.0);
            float grain = 0.5 + 0.5 * hash(floor(dir * 38.0));
            col += vec3(0.55, 0.6, 0.75) * band * grain * starAmount * 0.13 * smoothstep(0.05, 0.3, h);
          }
          gl_FragColor = vec4(col, 1.0);
        }`,
    })
  );
  dome.renderOrder = -10;
  dome.userData.noShadow = true;
  scene.add(dome);

  // Nuages : sprites doux qui dérivent lentement, à plusieurs altitudes
  const cloudTex = makeCloudTexture();
  const clouds = [];
  for (let i = 0; i < 16; i++) {
    const far = i % 3 === 0; // quelques nuages plus hauts et plus pâles
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map: cloudTex,
      transparent: true,
      opacity: far ? 0.3 + Math.random() * 0.2 : 0.45 + Math.random() * 0.3,
      depthWrite: false,
    }));
    const s = (far ? 90 : 55) + Math.random() * 90;
    sprite.scale.set(s, s * 0.36, 1);
    sprite.position.set(
      (Math.random() - 0.5) * 700,
      (far ? 150 : 85) + Math.random() * 80,
      (Math.random() - 0.5) * 700
    );
    sprite.userData.speed = 1.2 + Math.random() * 1.6;
    sprite.userData.baseOpacity = sprite.material.opacity;
    scene.add(sprite);
    clouds.push(sprite);
  }

  // daylight ∈ [0,1] : les nuages s'estompent et s'assombrissent la nuit
  function update(dt, daylight = 1) {
    for (const c of clouds) {
      c.position.x += c.userData.speed * dt;
      if (c.position.x > 420) c.position.x = -420;
      c.material.opacity = c.userData.baseOpacity * (0.25 + 0.75 * daylight);
      const v = 0.35 + 0.65 * daylight;
      c.material.color.setRGB(v, v, v * 1.05);
    }
  }

  return { update, uniforms };
}

function makeCloudTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 128;
  const g = canvas.getContext('2d');
  // Cumulus doux : gros amas central + franges plus fines, base plus plate
  for (let i = 0; i < 22; i++) {
    const t = i / 22;
    const x = 30 + Math.random() * 196;
    const y = 50 + Math.random() * 30 + t * 8;
    const r = (i < 8 ? 24 : 12) + Math.random() * 22;
    const grad = g.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, `rgba(255,255,255,${i < 8 ? 0.5 : 0.3})`);
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 256, 128);
  }
  return new THREE.CanvasTexture(canvas);
}
