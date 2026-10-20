import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

// RENDU « CINÉ » (palier Élevé uniquement) : la scène passe par un
// composeur au lieu d'aller droit à l'écran.
//  - MSAA ×4 sur la cible HDR (le composeur perd l'antialias du canvas)
//  - bloom HDR à demi-résolution : néons, lampadaires, soleil, éclairs de
//    bouche bavent comme dans un vrai moteur — seuil relevé le jour pour
//    que les façades blanches au soleil ne s'embrasent pas
//  - étalonnage final : contraste en S, saturation, léger virage
//    ombres froides / hautes lumières chaudes, vignette
// Bas et Moyen gardent le rendu direct : zéro coût ajouté sur mobile.

const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    contrast: { value: 1.08 },
    saturation: { value: 1.1 },
    vignette: { value: 0.32 },
    night: { value: 0 },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform float contrast, saturation, vignette, night;
    varying vec2 vUv;
    void main() {
      vec3 c = texture2D(tDiffuse, vUv).rgb;
      float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
      // Saturation puis contraste en S autour du gris moyen
      c = mix(vec3(l), c, saturation);
      c = clamp((c - 0.5) * contrast + 0.5, 0.0, 1.0);
      c = c * c * (3.0 - 2.0 * c) * 0.18 + c * 0.82;
      // Virage : ombres bleutées, hautes lumières chaudes (moins la nuit)
      vec3 shadowTint = vec3(0.95, 1.0, 1.07);
      vec3 highTint = mix(vec3(1.04, 1.0, 0.94), vec3(1.0), night);
      c *= mix(shadowTint, highTint, smoothstep(0.15, 0.85, l));
      // Vignette douce
      vec2 d = vUv - 0.5;
      c *= 1.0 - vignette * smoothstep(0.25, 0.85, dot(d, d) * 2.2);
      gl_FragColor = vec4(c, 1.0);
    }`,
};

export function createPost(renderer, scene, camera) {
  const size = renderer.getSize(new THREE.Vector2());
  const target = new THREE.WebGLRenderTarget(size.x, size.y, {
    type: THREE.HalfFloatType,
    samples: 4,
  });
  const composer = new EffectComposer(renderer, target);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(size.x / 2, size.y / 2), 0.3, 0.55, 1.0);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
  const grade = new ShaderPass(GradeShader);
  composer.addPass(grade);

  let enabled = false;
  return {
    get enabled() { return enabled; },
    setEnabled(on) { enabled = on; },
    setSize(w, h) {
      composer.setPixelRatio(renderer.getPixelRatio());
      composer.setSize(w, h);
    },
    // Réglages qui suivent l'heure : la nuit, le bloom s'ouvre un peu. Les
    // halos additifs des lampadaires dépassent déjà 1 en HDR : seuil haut,
    // sinon toute la place baigne dans un brouillard lumineux.
    setNight(night) {
      bloom.threshold = 1.0 - 0.05 * night;
      bloom.strength = 0.26 + 0.1 * night;
      bloom.radius = 0.4;
      grade.uniforms.night.value = night;
      grade.uniforms.vignette.value = 0.32 + 0.12 * night;
    },
    render() {
      if (enabled) composer.render();
      else renderer.render(scene, camera);
    },
  };
}
