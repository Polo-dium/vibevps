import * as THREE from 'three';

// Dôme de ciel en dégradé + nuages dérivants.
export function buildSky(scene, radius = 470) {
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(radius, 24, 12),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        topColor: { value: new THREE.Color(0x3f74cf) },
        horizonColor: { value: new THREE.Color(0xc9dbef) },
      },
      vertexShader: `
        varying vec3 vPos;
        void main() {
          vPos = position;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: `
        varying vec3 vPos;
        uniform vec3 topColor;
        uniform vec3 horizonColor;
        void main() {
          float h = normalize(vPos).y;
          float t = pow(max(h, 0.0), 0.55);
          gl_FragColor = vec4(mix(horizonColor, topColor, t), 1.0);
        }`,
    })
  );
  dome.renderOrder = -10;
  dome.userData.noShadow = true;
  scene.add(dome);

  // Nuages : sprites doux qui dérivent lentement
  const cloudTex = makeCloudTexture();
  const clouds = [];
  for (let i = 0; i < 12; i++) {
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map: cloudTex,
      transparent: true,
      opacity: 0.5 + Math.random() * 0.3,
      depthWrite: false,
    }));
    const s = 60 + Math.random() * 90;
    sprite.scale.set(s, s * 0.42, 1);
    sprite.position.set(
      (Math.random() - 0.5) * 700,
      90 + Math.random() * 90,
      (Math.random() - 0.5) * 700
    );
    sprite.userData.speed = 1.2 + Math.random() * 1.6;
    scene.add(sprite);
    clouds.push(sprite);
  }

  function update(dt) {
    for (const c of clouds) {
      c.position.x += c.userData.speed * dt;
      if (c.position.x > 420) c.position.x = -420;
    }
  }

  return { update };
}

function makeCloudTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 128;
  const g = canvas.getContext('2d');
  for (let i = 0; i < 14; i++) {
    const x = 40 + Math.random() * 176;
    const y = 45 + Math.random() * 40;
    const r = 18 + Math.random() * 30;
    const grad = g.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, 'rgba(255,255,255,0.55)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 256, 128);
  }
  return new THREE.CanvasTexture(canvas);
}
