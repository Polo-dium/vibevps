import * as THREE from 'three';

// DIFFUSION ATMOSPHÉRIQUE DANS LA BRUME (tous paliers, coût quasi nul) :
// la brume n'est plus un aplat gris uniforme — elle s'illumine en direction
// du soleil, exactement comme le voile chaud du dôme de ciel (sky.js). Les
// façades lointaines se fondent donc dans un horizon qui rougeoie côté
// soleil au lieu de découper une silhouette grise sur un ciel orangé, et le
// contre-jour gagne ce halo doré « moteur de jeu ».
//
// Branché une fois pour toutes sur les morceaux de shader de la brume de
// three.js : toutes les variantes de matériaux en profitent sans retouche.
// Les deux uniformes sont des objets simples PARTAGÉS par référence entre
// tous les programmes (cloneUniforms ne copie que les Vector/Color de
// three.js) : une seule mise à jour par image, aucune recompilation.
const sunState = { x: 0, y: 1, z: 0, w: 0 }; // direction monde + intensité
const sunColor = { r: 1, g: 0.88, b: 0.69 };

const extra = {
  fogSun: { value: sunState },
  fogSunColor: { value: sunColor },
};
Object.assign(THREE.UniformsLib.fog, extra);
for (const lib of Object.values(THREE.ShaderLib)) {
  if (lib.uniforms?.fogColor) Object.assign(lib.uniforms, extra);
}

const C = THREE.ShaderChunk;
C.fog_pars_vertex = C.fog_pars_vertex.replace(
  'varying float vFogDepth;',
  'varying float vFogDepth;\n\tvarying vec3 vFogDir;'
);
// Direction monde du fragment vue depuis la caméra : rotation inverse de
// la matrice de vue appliquée au vecteur caméra → sommet (pas d'inverse à
// calculer, la transposée d'une rotation suffit).
C.fog_vertex = C.fog_vertex.replace(
  'vFogDepth = - mvPosition.z;',
  'vFogDepth = - mvPosition.z;\n\tvFogDir = ( vec4( mvPosition.xyz, 0.0 ) * viewMatrix ).xyz;'
);
C.fog_pars_fragment = C.fog_pars_fragment.replace(
  'varying float vFogDepth;',
  'varying float vFogDepth;\n\tvarying vec3 vFogDir;\n\tuniform vec4 fogSun;\n\tuniform vec3 fogSunColor;'
);
// Même loi que le voile du dôme (pow 6, ×0,65) + un cœur plus serré :
// au ras de l'horizon, brume et ciel ont la même teinte.
C.fog_fragment = C.fog_fragment.replace(
  'gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );',
  `float fogSd = max( dot( normalize( vFogDir ), fogSun.xyz ), 0.0 );
	float fogGlow = ( pow( fogSd, 6.0 ) * 0.65 + pow( fogSd, 48.0 ) * 0.5 ) * fogSun.w;
	gl_FragColor.rgb = mix( gl_FragColor.rgb, mix( fogColor, fogSunColor, min( fogGlow, 1.0 ) ), fogFactor );`
);

// dir : direction du soleil (monde) ; tint : teinte du voile (THREE.Color) ;
// amount ∈ [0,1] : 1 en plein jour, 0 la nuit (la lune ne fait pas de halo).
export function setAtmosphere(dir, tint, amount) {
  sunState.x = dir.x;
  sunState.y = dir.y;
  sunState.z = dir.z;
  sunState.w = amount;
  sunColor.r = tint.r;
  sunColor.g = tint.g;
  sunColor.b = tint.b;
}

// PERSPECTIVE AÉRIENNE DES GRANDS REPÈRES (le Crayon, la basilique, la tour
// métallique…) : la brume est calée sur la portée de vue de la ville (voir
// quality.js), qui noie tout à ~1 km sur les petits paliers. Un repère doit
// pourtant se lire de loin : on ne lui applique qu'une FRACTION de la
// profondeur de brume (k ∈ ]0;1]) — il pâlit avec la distance sans jamais
// disparaître ni découper l'horizon comme un aplat sans brume (fog: false).
// Compatible avec la passe matière du palier Élevé (enhance.js reprend
// userData.shaderPatch). Rend aussi le mesh insensible aux cullers.
export function landmarkFog(mesh, k = 0.35) {
  mesh.userData.noCull = true;
  mesh.traverse?.((o) => {
    if (!o.isMesh) return;
    o.userData.noCull = true;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of mats) {
      if (!m || m.userData.landmarkFog) continue;
      m.fog = true;
      m.userData.landmarkFog = k;
      const prev = m.userData.shaderPatch;
      const patch = (shader) => {
        prev?.(shader);
        shader.vertexShader = shader.vertexShader.replace(
          '#include <fog_vertex>',
          `#include <fog_vertex>\n#ifdef USE_FOG\n\tvFogDepth *= ${k.toFixed(3)};\n#endif`
        );
      };
      const key = (m.userData.shaderPatchKey ?? '') + '|repere' + k;
      m.userData.shaderPatch = patch;
      m.userData.shaderPatchKey = key;
      m.onBeforeCompile = patch;
      m.customProgramCacheKey = () => key;
      m.needsUpdate = true;
    }
  });
  return mesh;
}
