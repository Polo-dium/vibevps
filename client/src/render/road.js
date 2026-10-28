import { rainAmount } from '../world/weather.js';

// CHAUSSÉE MOUILLÉE ET FLAQUES : patch de shader des sols de rue (asphalte,
// pavés). Après une averse (horloge partagée de world/weather.js), la
// chaussée fonce et devient satinée, puis sèche lentement ; des flaques —
// surtout le long des caniveaux — deviennent de vrais miroirs du ciel au
// palier Élevé (rugosité ~0 → reflets de scene.environment). Aux autres
// paliers, elles restent des zones sombres. Aucun coût hors du shader.

const wet = { value: 0 };

// Séchage : monte en ~30 s sous la pluie, sèche en ~4 min
export function tickRoadWetness(dt) {
  if (globalThis.__forceWet != null) { wet.value = globalThis.__forceWet; return; } // (débogage)
  const target = rainAmount() > 0.05 ? 1 : 0;
  const rate = target > wet.value ? 1 / 30 : 1 / 240;
  wet.value += Math.sign(target - wet.value) * Math.min(Math.abs(target - wet.value), dt * rate);
}

const NOISE = /* glsl */ `
uniform float roadWet;
float roadHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float roadNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(roadHash(i), roadHash(i + vec2(1, 0)), f.x),
             mix(roadHash(i + vec2(0, 1)), roadHash(i + vec2(1, 1)), f.x), f.y);
}`;

// gutter : u de la texture = travers de la chaussée (0..1) → flaques au bord
export function roadShaderPatch(gutter) {
  return (shader) => {
    shader.uniforms.roadWet = wet;
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\n' + NOISE)
      .replace('#include <color_fragment>', `#include <color_fragment>
float roadPuddle = 0.0;
#ifdef USE_MAP
{
  vec2 q = vMapUv * ${gutter ? 'vec2(2.6, 2.4)' : 'vec2(0.7)'};
  float n = roadNoise(q) * 0.62 + roadNoise(q * 3.7 + 11.0) * 0.38;
  ${gutter ? 'float edge = max(smoothstep(0.16, 0.0, vMapUv.x), smoothstep(0.84, 1.0, vMapUv.x));' : 'float edge = 0.0;'}
  float th = mix(0.88, 0.7, roadWet) - edge * 0.22;
  roadPuddle = smoothstep(th, th + 0.05, n);
  diffuseColor.rgb *= mix(1.0, 0.6, max(roadWet * 0.75, roadPuddle * 0.9));
}
#endif`)
      .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\nnormal = normalize(mix(normal, nonPerturbedNormal, roadPuddle));')
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
roughnessFactor = mix(roughnessFactor, 0.35, roadWet * 0.7);
roughnessFactor = mix(roughnessFactor, 0.03, roadPuddle);`)
      // Reflet rasant = les façades d'en face, pas le ciel : on l'assombrit
      // (le ciel ne se reflète que vers le haut de la flaque)
      .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
{
  vec3 rv = reflect(-geometryViewDir, normal);
  float ry = inverseTransformDirection(rv, viewMatrix).y;
  float sky = smoothstep(0.18, 0.5, ry);
  vec3 bati = vec3(0.13, 0.12, 0.11) * dot(reflectedLight.indirectSpecular, vec3(0.33)) * 1.6;
  reflectedLight.indirectSpecular = mix(bati, reflectedLight.indirectSpecular, sky);
}`);
  };
}
