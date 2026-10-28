import * as THREE from 'three';
import { heightToNormal, detailNoise } from './materials.js';

// PASSE « MATIÈRE » SUR LE DÉCOR DÉJÀ CONSTRUIT (une fois, après la ville).
// Chaque matériau Lambert texturé par un canvas procédural (sols, pavés,
// façades, toits…) est remplacé par un MeshStandard qui garde sa texture
// et y ajoute, dérivés de la même image :
//  - une normal map (relief des joints de pavés, du crépi, des tuiles)
//  - une carte de rugosité : les zones sombres et bleutées (vitres) sont
//    lisses et renvoient le ciel de scene.environment, le reste est mat.
// Les deux villes en profitent sans retoucher leurs générateurs. Réservé
// au palier Élevé (décidé au chargement : changer de matériau à
// chaud recompilerait tous les shaders).

function readCanvas(tex) {
  const img = tex.image;
  if (!img || !(img instanceof HTMLCanvasElement) || img.width < 16) return null;
  return img;
}

// Rugosité depuis la couleur : bleu foncé (vitre) → lisse, le reste mat
function roughnessFrom(src) {
  const w = src.width, h = src.height;
  const data = src.getContext('2d').getImageData(0, 0, w, h).data;
  const out = document.createElement('canvas');
  out.width = w;
  out.height = h;
  const g = out.getContext('2d');
  const img = g.createImageData(w, h);
  let glossy = 0;
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i], gg = data[i + 1], b = data[i + 2];
    const lum = (r * 0.3 + gg * 0.59 + b * 0.11) / 255;
    const blue = Math.max(0, Math.min(1, (b - r - 8) / 50));
    const glass = blue * (1 - Math.max(0, lum - 0.35) * 2);
    if (glass > 0.5) glossy++;
    // vert = rugosité (canal lu par three.js)
    const rough = 0.92 - Math.max(0, glass) * 0.55; // vitre satinée, pas miroir
    img.data[i] = img.data[i + 1] = img.data[i + 2] = rough * 255;
    img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return { canvas: out, glossy: glossy / (w * h) };
}

// Texture de détail en coordonnées monde (projection selon la face :
// sol → xz, murs → xy ou zy), fondue au-delà de ~40 m pour éviter le moiré.
function addDetail(mat) {
  const detailMap = detailNoise();
  const extra = mat.userData.shaderPatch; // patch propre au matériau d'origine
  mat.onBeforeCompile = (shader) => {
    extra?.(shader);
    shader.uniforms.detailMap = { value: detailMap };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vDWPos;\nvarying vec3 vDWN;')
      .replace('#include <project_vertex>', `#include <project_vertex>
        vec4 dwp = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          dwp = instanceMatrix * dwp;
        #endif
        vDWPos = (modelMatrix * dwp).xyz;
        vDWN = normalize(mat3(modelMatrix) * objectNormal);`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2D detailMap;\nvarying vec3 vDWPos;\nvarying vec3 vDWN;')
      .replace('#include <map_fragment>', `#include <map_fragment>
        {
          vec3 an = abs(vDWN);
          vec2 duv = an.y > 0.6 ? vDWPos.xz : (an.x > an.z ? vDWPos.zy : vDWPos.xy);
          float dd = texture2D(detailMap, duv * 0.45).r * 0.55 + texture2D(detailMap, duv * 2.3).r * 0.45;
          float fade = 1.0 - smoothstep(12.0, 45.0, length(vViewPosition));
          diffuseColor.rgb *= mix(1.0, 0.72 + dd * 0.56, fade);
        }`);
  };
  mat.customProgramCacheKey = () => 'detail' + (extra ? '|' + mat.userData.shaderPatchKey : '');
}

const done = new Map(); // ancien matériau → nouveau

function upgrade(mat) {
  if (done.has(mat)) return done.get(mat);
  let next = mat;
  const tex = mat.map;
  const src = tex && readCanvas(tex);
  if (mat.isMeshLambertMaterial && src && !mat.transparent && !mat.alphaTest) {
    const normal = new THREE.CanvasTexture(heightToNormal(src, Math.max(1, src.width / 128) * 1.6));
    const rough = roughnessFrom(src);
    const roughTex = new THREE.CanvasTexture(rough.canvas);
    for (const t of [normal, roughTex]) {
      t.wrapS = tex.wrapS;
      t.wrapT = tex.wrapT;
      t.repeat.copy(tex.repeat);
      t.offset.copy(tex.offset);
      t.anisotropy = 4;
    }
    tex.anisotropy = Math.max(tex.anisotropy, 8);
    tex.needsUpdate = true;
    next = new THREE.MeshStandardMaterial({
      map: tex, color: mat.color, vertexColors: mat.vertexColors,
      emissive: mat.emissive, emissiveMap: mat.emissiveMap, emissiveIntensity: mat.emissiveIntensity,
      side: mat.side, fog: mat.fog, polygonOffset: mat.polygonOffset,
      polygonOffsetFactor: mat.polygonOffsetFactor, polygonOffsetUnits: mat.polygonOffsetUnits,
      normalMap: normal, normalScale: new THREE.Vector2(0.8, 0.8),
      roughnessMap: roughTex, roughness: 1,
      metalness: 0,
      // les vitres renvoient le ciel ; le diffus garde l'éclairage d'origine
      envMapIntensity: rough.glossy > 0.02 ? 0.75 : 0.6,
    });
    next.name = mat.name;
    next.userData = mat.userData;
    addDetail(next);
    // Le code du monde garde une référence vers l'ANCIEN matériau et
    // l'anime (fenêtres allumées la nuit, devantures, flash…) : couleurs
    // partagées par référence, intensité émissive et opacité relayées.
    next.color = mat.color;
    next.emissive = mat.emissive;
    for (const key of ['emissiveIntensity', 'opacity']) {
      next[key] = mat[key];
      Object.defineProperty(mat, key, {
        configurable: true,
        get: () => next[key],
        set: (v) => { next[key] = v; },
      });
    }
  }
  done.set(mat, next);
  return next;
}

// maxAniso : filtrage anisotrope maximal du GPU (16 en général) sur TOUTES
// les textures du décor — sols et façades vus en biais restent nets jusqu'au
// fond de la place au lieu de baver (le flou rasant typique du low-cost).
// Coût négligeable sur une carte graphique de PC, d'où le palier Élevé.
export function enhanceScene(scene, maxAniso = 8) {
  let n = 0;
  const sharpen = (m) => {
    for (const key of ['map', 'normalMap', 'roughnessMap']) {
      const t = m?.[key];
      if (t && t.anisotropy < maxAniso) {
        t.anisotropy = maxAniso;
        t.needsUpdate = true;
      }
    }
  };
  scene.traverse((o) => {
    if (!o.isMesh) return;
    if (o.isInstancedMesh && !o.material?.map) return;
    if (Array.isArray(o.material)) {
      o.material = o.material.map((m) => {
        const u = upgrade(m);
        if (u !== m) n++;
        return u;
      });
    } else if (o.material) {
      const u = upgrade(o.material);
      if (u !== o.material) n++;
      o.material = u;
    }
    if (Array.isArray(o.material)) o.material.forEach(sharpen);
    else sharpen(o.material);
  });
  return n;
}
