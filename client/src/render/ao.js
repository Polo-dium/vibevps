import * as THREE from 'three';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

// OCCLUSION AMBIANTE EN ESPACE ÉCRAN (palier Élevé, rendu ciné) — ce qui
// donne le « poids » des vrais moteurs : coins de murs, pieds de façade,
// dessous des bancs et des voitures, creux des corniches s'assombrissent.
//
// Pensée pour coûter le moins possible :
//  - AUCUN rendu supplémentaire de la scène (pas de passe de normales) :
//    tout part du tampon de profondeur que le rendu principal produit de
//    toute façon ; les normales sont reconstruites depuis la profondeur.
//  - calcul à DEMI-résolution, 8 échantillons en spirale tournée par pixel,
//    puis flou de 5 lectures qui respecte les bords (profondeur) en
//    recomposant à pleine résolution.
//  - estompée au-delà de ~90 m (là où la brume prend le relais) et ignorée
//    sur l'arme en main et le ciel.
// La boucle principale la coupe dès que la résolution dynamique doit
// baisser la définition (machine qui peine) — voir post.setAO.

const AOShader = {
  uniforms: {
    tDepth: { value: null },
    projInv: { value: new THREE.Matrix4() },
    resolution: { value: new THREE.Vector2(1, 1) },
    proj11: { value: 1 },
    radius: { value: 0.9 },
    intensity: { value: 0.9 },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = vec4(position.xy, 0.0, 1.0);
    }`,
  fragmentShader: /* glsl */`
    uniform sampler2D tDepth;
    uniform mat4 projInv;
    uniform vec2 resolution;
    uniform float proj11, radius, intensity;
    varying vec2 vUv;
    vec3 viewPos(vec2 uv) {
      float d = texture2D(tDepth, uv).x;
      vec4 p = projInv * vec4(uv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0);
      return p.xyz / p.w;
    }
    void main() {
      float d = texture2D(tDepth, vUv).x;
      vec3 P = viewPos(vUv);
      float z = -P.z;
      // Ciel, arme en main, ou trop loin : rien à assombrir
      if (d >= 0.99999 || z < 0.6 || z > 95.0) { gl_FragColor = vec4(1.0, z, 0.0, 1.0); return; }
      // Normale depuis la profondeur : on garde, de chaque côté, le voisin
      // le plus proche en profondeur (évite les normales fausses aux bords)
      vec2 px = 1.0 / resolution;
      vec3 r = viewPos(vUv + vec2(px.x, 0.0)) - P;
      vec3 l = P - viewPos(vUv - vec2(px.x, 0.0));
      vec3 u = viewPos(vUv + vec2(0.0, px.y)) - P;
      vec3 b = P - viewPos(vUv - vec2(0.0, px.y));
      vec3 dx = abs(r.z) < abs(l.z) ? r : l;
      vec3 dy = abs(u.z) < abs(b.z) ? u : b;
      vec3 n = normalize(cross(dx, dy));
      // Rayon écran du voisinage (en pixels), plafonné pour le cache texture
      float rPx = min(radius * proj11 * 0.5 * resolution.y / z, 70.0);
      if (rPx < 1.5) { gl_FragColor = vec4(1.0, z, 0.0, 1.0); return; }
      // Bruit de gradient entrelacé : rotation propre à chaque pixel
      float noise = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
      float ang = noise * 6.2831853;
      float r2 = radius * radius;
      float sum = 0.0;
      for (int i = 0; i < 8; i++) {
        float t = (float(i) + 0.5 + noise * 0.5) / 8.0;
        ang += 2.3999632; // angle d'or
        vec2 off = vec2(cos(ang), sin(ang)) * rPx * t * px;
        // Bord d'écran : l'échantillon est ramené DANS l'image (sinon la
        // profondeur répétée du bord se lit comme un mur → bandes sombres)
        vec3 v = viewPos(clamp(vUv + off, px * 0.5, 1.0 - px * 0.5)) - P;
        float vv = dot(v, v);
        float f = max(r2 - vv, 0.0);
        sum += f * f * f * max((dot(v, n) - 0.02 - 0.015 * z) / (vv + 0.02), 0.0);
      }
      float ao = max(0.0, 1.0 - sum * intensity * 5.0 / (r2 * r2 * r2 * 8.0));
      // Estompée tout près (sol vu en rasant sous les pieds : la profondeur
      // y manque de précision et dessinait des bandes) et au loin
      ao = mix(1.0, ao, smoothstep(2.0, 4.5, z) * (1.0 - smoothstep(55.0, 95.0, z)));
      gl_FragColor = vec4(ao, z, 0.0, 1.0);
    }`,
};

const CompositeShader = {
  uniforms: {
    tDiffuse: { value: null },
    tAO: { value: null },
    aoTexel: { value: new THREE.Vector2(1, 1) },
    strength: { value: 0.7 },
  },
  vertexShader: AOShader.vertexShader,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse, tAO;
    uniform vec2 aoTexel;
    uniform float strength;
    varying vec2 vUv;
    void main() {
      vec4 col = texture2D(tDiffuse, vUv);
      vec2 c = texture2D(tAO, vUv).xy;
      // Flou en croix diagonale pondéré par l'écart de profondeur : le
      // bruit de rotation disparaît sans baver d'un objet sur l'autre
      float sum = c.x, w = 1.0;
      vec2 o[4];
      o[0] = vec2(1.0, 1.0); o[1] = vec2(-1.0, 1.0); o[2] = vec2(1.0, -1.0); o[3] = vec2(-1.0, -1.0);
      for (int i = 0; i < 4; i++) {
        vec2 s = texture2D(tAO, vUv + o[i] * aoTexel).xy;
        float k = max(0.0, 1.0 - abs(s.y - c.y) / (0.06 * c.y + 0.05));
        sum += s.x * k;
        w += k;
      }
      float ao = sum / w;
      // Les sources de lumière (néons, halos, soleil) ne s'assombrissent pas
      float lum = dot(col.rgb, vec3(0.2126, 0.7152, 0.0722));
      col.rgb *= mix(1.0, ao, strength * (1.0 - smoothstep(1.2, 3.0, lum)));
      gl_FragColor = col;
    }`,
};

export class AOPass extends Pass {
  constructor(camera) {
    super();
    this.camera = camera;
    this.aoTarget = new THREE.WebGLRenderTarget(1, 1, {
      type: THREE.HalfFloatType, depthBuffer: false,
      minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
    });
    this.aoMat = new THREE.ShaderMaterial({ ...AOShader, uniforms: THREE.UniformsUtils.clone(AOShader.uniforms), depthTest: false, depthWrite: false });
    this.compMat = new THREE.ShaderMaterial({ ...CompositeShader, uniforms: THREE.UniformsUtils.clone(CompositeShader.uniforms), depthTest: false, depthWrite: false });
    this.quad = new FullScreenQuad(this.aoMat);
  }

  setSize(w, h) {
    const hw = Math.max(1, Math.ceil(w / 2)), hh = Math.max(1, Math.ceil(h / 2));
    this.aoTarget.setSize(hw, hh);
    this.aoMat.uniforms.resolution.value.set(w, h);
    this.compMat.uniforms.aoTexel.value.set(1 / hw, 1 / hh);
  }

  render(renderer, writeBuffer, readBuffer) {
    const u = this.aoMat.uniforms;
    u.tDepth.value = readBuffer.depthTexture;
    u.projInv.value.copy(this.camera.projectionMatrixInverse);
    u.proj11.value = this.camera.projectionMatrix.elements[5];
    renderer.setRenderTarget(this.aoTarget);
    this.quad.material = this.aoMat;
    this.quad.render(renderer);

    const c = this.compMat.uniforms;
    c.tDiffuse.value = readBuffer.texture;
    c.tAO.value = this.aoTarget.texture;
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.quad.material = this.compMat;
    this.quad.render(renderer);
  }

  dispose() {
    this.aoTarget.dispose();
    this.aoMat.dispose();
    this.compMat.dispose();
    this.quad.dispose();
  }
}
