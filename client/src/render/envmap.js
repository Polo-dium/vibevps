import * as THREE from 'three';

// Carte d'environnement procédurale : un mini-ciel (dégradé zénith →
// horizon → sol + disque solaire) filtré par PMREM, posé en
// scene.environment. Les matériaux PBR (métal des armes, carrosseries,
// vitres) y prennent reflets et spéculaire crédibles — zéro asset, et
// régénéré quand la lumière du jour a assez bougé (quelques ms, rare).
// L'ambiance DIFFUSE vient déjà de la lumière hémisphérique (réglée par le
// cycle jour/nuit, partagée avec les matériaux Lambert) : l'environnement ne
// sert qu'aux REFLETS. Sans ça, l'ambiance compte double sur les matériaux
// PBR (sols délavés, armes bleuies).
THREE.ShaderChunk.lights_fragment_maps = THREE.ShaderChunk.lights_fragment_maps
  .replace('iblIrradiance += getIBLIrradiance( geometryNormal );', '');

export function createEnvMap(renderer, scene) {
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envScene = new THREE.Scene();

  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      top: { value: new THREE.Color() },
      horizon: { value: new THREE.Color() },
      ground: { value: new THREE.Color() },
      sunDir: { value: new THREE.Vector3(0, 1, 0) },
      sunColor: { value: new THREE.Color() },
    },
    vertexShader: /* glsl */`
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */`
      uniform vec3 top, horizon, ground, sunDir, sunColor;
      varying vec3 vDir;
      void main() {
        float y = vDir.y;
        vec3 sky = mix(horizon, top, pow(max(y, 0.0), 0.6));
        // Sol : façades et pavés sombres, raccordés à l'horizon
        vec3 col = y > 0.0 ? sky : mix(horizon * 0.55, ground, smoothstep(0.0, -0.25, y));
        col += sunColor * pow(max(dot(vDir, sunDir), 0.0), 900.0) * 30.0;
        col += sunColor * pow(max(dot(vDir, sunDir), 0.0), 12.0) * 0.25;
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  envScene.add(new THREE.Mesh(new THREE.SphereGeometry(10, 32, 16), skyMat));

  let rt = null;
  let lastKey = '';
  let lastAt = 0;
  const u = skyMat.uniforms;
  return {
    // top/horizon : couleurs courantes du dôme ; daylight ∈ [0,1]
    update(top, horizon, sunDir, daylight) {
      // Régénérer coûte une allocation GPU + 6 rendus + flou : seulement
      // par paliers nets de luminosité (≈16 fois par cycle, aux aubes et
      // crépuscules — jamais en plein jour ni en pleine nuit) et au plus
      // toutes les 3 s. La direction du soleil seule ne compte pas : elle
      // bouge en continu et provoquait des micro-gels réguliers.
      const key = `${Math.round(daylight * 8)}`;
      if (key === lastKey) return;
      const now = performance.now();
      if (lastKey !== '' && now - lastAt < 3000) return;
      lastKey = key;
      lastAt = now;
      // Ciel désaturé (moyenne zénith/horizon) : l'éclairage d'ambiance des
      // matériaux PBR ne doit pas tout teinter de bleu.
      u.top.value.copy(top).lerp(horizon, 0.55);
      u.horizon.value.copy(horizon);
      u.ground.value.setRGB(0.2, 0.16, 0.12).multiplyScalar(0.25 + 0.75 * daylight);
      u.sunDir.value.copy(sunDir).normalize();
      u.sunColor.value.setRGB(1, 0.93, 0.8).multiplyScalar(daylight);
      const next = pmrem.fromScene(envScene, 0, 0.1, 100);
      scene.environment = next.texture;
      rt?.dispose();
      rt = next;
    },
  };
}
