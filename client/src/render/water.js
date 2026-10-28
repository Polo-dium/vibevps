import * as THREE from 'three';
import { makeRand } from '../world/layout.js';

// EAU DES FLEUVES (Rhône, Saône) : un seul matériau PBR partagé.
//  - teinte de rivière (vert-gris profond), quasi lisse : le ciel
//    (scene.environment) s'y reflète selon l'angle — très peu à la
//    verticale, beaucoup en rasant (Fresnel du modèle PBR), et le soleil y
//    laisse une traînée d'éclats (spéculaire GGX du soleil, avivée par le
//    bloom du palier Élevé)
//  - vaguelettes : DEUX couches d'une même carte de normales tuilable,
//    échantillonnées en coordonnées MONDE (continuité parfaite d'un
//    polygone OSM à l'autre) et qui dérivent dans deux directions — les
//    rides se croisent comme sur un vrai fleuve
//  - au loin, les rides s'aplatissent et la surface devient un peu plus
//    mate : pas de scintillement, et la brume prend le relais
// Coût : deux lectures de texture par pixel d'eau, aucune passe en plus.

const SIZE = 256;

// Carte de normales calculée ANALYTIQUEMENT depuis une somme de sinus à
// fréquences entières (donc tuilable) — dérivées exactes, pas de bruit
// d'échantillonnage
function waveNormalTexture() {
  const rand = makeRand(918);
  const waves = [];
  for (let i = 0; i < 28; i++) {
    const ang = rand() * Math.PI * 2;
    const f = 1 + Math.floor(rand() * rand() * 14); // surtout des grandes rides
    const kx = Math.round(Math.cos(ang) * f), ky = Math.round(Math.sin(ang) * f);
    if (!kx && !ky) continue;
    waves.push({ kx, ky, a: 1 / Math.pow(Math.hypot(kx, ky), 1.25), ph: rand() * Math.PI * 2 });
  }
  const data = new Uint8Array(SIZE * SIZE * 4);
  const TAU = Math.PI * 2;
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      let dx = 0, dy = 0;
      for (const w of waves) {
        const p = (TAU * (w.kx * x + w.ky * y)) / SIZE + w.ph;
        const c = Math.cos(p) * w.a * TAU;
        dx += c * w.kx;
        dy += c * w.ky;
      }
      const s = 0.09;
      const nx = -dx * s, ny = -dy * s;
      const l = Math.hypot(nx, ny, 1);
      const i = (y * SIZE + x) * 4;
      data[i] = ((nx / l) * 0.5 + 0.5) * 255;
      data[i + 1] = ((ny / l) * 0.5 + 0.5) * 255;
      data[i + 2] = ((1 / l) * 0.5 + 0.5) * 255;
      data[i + 3] = 255;
    }
  }
  const t = new THREE.DataTexture(data, SIZE, SIZE);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = 8;
  t.needsUpdate = true;
  return t;
}

let shared = null;

export function riverWaterMaterial() {
  if (shared) return shared;
  const waveMap = waveNormalTexture();
  const time = { value: 0 };
  const mat = new THREE.MeshStandardMaterial({
    color: 0x1f3a3c,
    roughness: 0.06,
    metalness: 0,
    envMapIntensity: 0.95,
  });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.waveMap = { value: waveMap };
    shader.uniforms.waveTime = time;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWaterPos;')
      .replace('#include <project_vertex>', `#include <project_vertex>
        vWaterPos = (modelMatrix * vec4(transformed, 1.0)).xyz;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform sampler2D waveMap;
        uniform float waveTime;
        varying vec3 vWaterPos;
        vec3 wWaterN = vec3(0.0, 1.0, 0.0);`)
      // Rugosité qui monte avec la distance (anti-scintillement)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        float wDist = length(vWaterPos - cameraPosition);
        roughnessFactor = mix(roughnessFactor, 0.22, smoothstep(40.0, 420.0, wDist));`)
      // Normale : deux couches de rides qui dérivent en sens croisés
      .replace('#include <normal_fragment_maps>', `{
        vec2 p = vWaterPos.xz;
        vec3 n1 = texture2D(waveMap, p * 0.045 + waveTime * vec2(0.011, 0.018)).xyz * 2.0 - 1.0;
        vec3 n2 = texture2D(waveMap, p * 0.13 + waveTime * vec2(-0.024, 0.009)).xyz * 2.0 - 1.0;
        vec2 slope = n1.xy * 0.26 + n2.xy * 0.16; // fleuve calme : rides fines
        slope *= mix(1.0, 0.18, smoothstep(25.0, 380.0, wDist));
        vec3 wn = normalize(vec3(slope.x, 1.0, slope.y));
        wWaterN = wn;
        normal = normalize((viewMatrix * vec4(wn, 0.0)).xyz);
      }`);
  };
  // Les quais d'en face : un reflet RASANT (rayon réfléchi presque à
  // l'horizontale) rencontrerait les façades et la colline de l'autre rive,
  // pas le ciel. On l'assombrit vers une teinte pierre/verdure — c'est ce
  // qui fait « vraie rivière en ville » plutôt que « lac sous le ciel ».
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (shader) => {
    prev(shader);
    shader.fragmentShader = shader.fragmentShader.replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
      {
        vec3 vdir = normalize(vWaterPos - cameraPosition);
        vec3 rdir = reflect(vdir, wWaterN);
        float sky = smoothstep(0.03, 0.2, rdir.y);
        vec3 bank = vec3(0.16, 0.15, 0.12) * dot(reflectedLight.indirectSpecular, vec3(0.33)) * 2.2;
        reflectedLight.indirectSpecular = mix(bank, reflectedLight.indirectSpecular, sky);
      }`);
  };
  mat.customProgramCacheKey = () => 'eau-fleuve';
  mat.userData.tick = (dt) => { time.value += dt; };
  shared = mat;
  return mat;
}
