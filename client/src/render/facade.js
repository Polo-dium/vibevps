// FAÇADES VIVANTES : la texture de façade est UNE fenêtre répétée (une
// cellule d'UV = une fenêtre d'un étage). Ce patch de shader la décline,
// fenêtre par fenêtre, sans un triangle de plus :
//  - persiennes lyonnaises (couleur propre à chaque immeuble) ouvertes de
//    part et d'autre de la baie, ou fermées par-dessus (et alors éteintes
//    la nuit)
//  - vitres en RETRAIT de 30 cm par parallaxe : selon l'angle de vue, on
//    voit le tableau, l'appui et le dessous du linteau ; voilages derrière
//    certaines vitres
//  - balcons filants haussmanniens aux 2e et 5e étages de certains
//    immeubles (dalle de pierre + garde-corps en fer forgé sur toute la
//    largeur), et des fenêtres sans balconnet ailleurs
// Le hasard vient de la cellule (floor(uv)) et de la teinte de l'immeuble
// (couleur de sommet) : stable, identique chez tous les joueurs.
// Repères (v vers le haut) : vitre u 0,27–0,73 / v 0,28–0,88 ; garde-corps
// v 0,113–0,233.

const GLSL = /* glsl */ `
float facadeShut = 0.0;
float facadeFlat = 0.0; // 1 = surface peinte ici : ni relief ni brillance d'origine
float facadeEmi = 1.0;  // 0 = embrasure : pas de lumière de fenêtre la nuit
#if defined( USE_MAP ) && defined( USE_COLOR )
// (dérivées hors de tout branchement)
vec2 facadeDx = dFdx(vMapUv), facadeDy = dFdy(vMapUv);
vec2 facadeOff = vec2(0.0);
float facadeBarW = fwidth(vMapUv.x * 25.0); // finesse des barreaux à l'écran
{
  vec3 Nv = normalize(vNormal);
  vec3 Uv = normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz);
  vec3 Tv = normalize(cross(Uv, Nv));
  vec3 q0 = dFdx(-vViewPosition), q1 = dFdy(-vViewPosition);
  if (dot(Tv, q0) * facadeDx.x + dot(Tv, q1) * facadeDy.x < 0.0) Tv = -Tv;
  vec3 Vv = normalize(-vViewPosition);
  float vn = min(dot(Vv, Nv), -0.08);
  facadeOff = vec2(dot(Vv, Tv), dot(Vv, Uv)) / -vn * 0.1; // 0,3 m = 0,1 cellule
}
{
  vec2 wc = floor(vMapUv);
  vec2 f = fract(vMapUv);
  float bseed = dot(vColor.rgb, vec3(12.9898, 78.233, 37.719)) * 7.0;
  float hb = fract(sin(bseed) * 43758.5453);
  float hb2 = fract(sin(bseed * 1.37 + 4.1) * 24634.6345);
  float hw = fract(sin(dot(wc, vec2(127.1, 311.7)) + bseed) * 43758.5453);
  float hw2 = fract(sin(dot(wc, vec2(269.5, 183.3)) + bseed) * 24634.6345);
  bool glassZ = f.x > 0.27 && f.x < 0.73 && f.y > 0.28 && f.y < 0.88;
  bool upper = wc.y >= 1.0; // pas au rez-de-chaussée (devantures, portes)

  // --- Balconnet : supprimé sur une partie des fenêtres (on recopie le mur
  // pris à côté, hors garde-corps), ou balcon FILANT sur tout l'étage
  bool railZ = f.y > 0.105 && f.y < 0.24;
  bool filant = upper && hb > 0.35 && (wc.y == 2.0 || (wc.y == 5.0 && hb2 > 0.4));
  if (railZ && !filant && hw2 < 0.4) {
    vec4 wall = texture2D(map, vec2(wc.x + 0.1, vMapUv.y));
    diffuseColor.rgb = diffuse * vColor.rgb * wall.rgb;
  }
  if (filant) {
    if (f.y > 0.113 && f.y < 0.233) {
      // fer forgé : lisses haute/basse + barreaux tous les ~4 cm de texture
      float bar = step(0.75, fract(f.x * 25.0));
      float lisse = step(f.y, 0.123) + step(0.222, f.y);
      float iron = clamp(bar + lisse, 0.0, 1.0);
      iron = mix(iron, 0.35 + lisse * 0.5, clamp(facadeBarW * 1.5 - 0.3, 0.0, 1.0)); // au loin : grisé moyen, pas de moiré
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.07, 0.075, 0.08), iron * 0.92);
      facadeFlat = 1.0;
    } else if (f.y > 0.085 && f.y <= 0.113) {
      diffuseColor.rgb = diffuse * vColor.rgb * vec3(0.95, 0.93, 0.88) * (0.8 + 0.2 * smoothstep(0.085, 0.113, f.y)); // dalle
    } else if (f.y > 0.03 && f.y <= 0.085) {
      diffuseColor.rgb *= mix(0.55, 1.0, smoothstep(0.085, 0.03, f.y) * 0.6 + 0.4 * step(f.y, 0.03)); // ombre portée
    }
  }

  // --- Vitre EN RETRAIT de 30 cm (parallaxe) : le rayon de vue traverse le
  // plan du mur jusqu'à la vitre ; s'il sort de la baie avant, on voit
  // l'embrasure (tableau, appui éclairé, dessous de linteau dans l'ombre).
  // Repère tangent tiré des dérivées écran (mur vertical : u horizontal).
  if (glassZ) {
    vec2 h = f + facadeOff;
    bool inside = h.x > 0.27 && h.x < 0.73 && h.y > 0.28 && h.y < 0.88;
    if (inside) {
      vec3 g = textureGrad(map, wc + h, facadeDx, facadeDy).rgb;
      diffuseColor.rgb = diffuse * vColor.rgb * g;
      if (hw > 0.55 && upper) {
        float side = max(smoothstep(0.37, 0.29, h.x), smoothstep(0.63, 0.71, h.x));
        float folds = 0.85 + 0.15 * sin(h.x * 160.0);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.86, 0.83, 0.76) * folds, side * 0.85);
        facadeFlat = max(facadeFlat, side * 0.7);
      }
      // ombre de l'embrasure sur la vitre, plus marquée sous le linteau
      float e = min(min(h.x - 0.27, 0.73 - h.x), h.y - 0.28);
      diffuseColor.rgb *= mix(0.6, 1.0, smoothstep(0.0, 0.05, e)) * mix(0.55, 1.0, smoothstep(0.0, 0.07, 0.88 - h.y));
    } else {
      vec3 stone = diffuse * vColor.rgb * vec3(0.94, 0.91, 0.85);
      float sh = h.y <= 0.28 ? 1.0 : h.y >= 0.88 ? 0.4 : (h.x <= 0.27 ? 0.72 : 0.62);
      diffuseColor.rgb = stone * sh;
      facadeFlat = 1.0;
      facadeEmi = 0.0;
    }
  }

  // --- Persiennes (70 % des immeubles, jamais au rez-de-chaussée)
  if (upper && hb < 0.7) {
    vec3 sc = hb2 < 0.3 ? vec3(0.42, 0.5, 0.47)   // vert sauge
            : hb2 < 0.55 ? vec3(0.55, 0.57, 0.6)  // gris lyonnais
            : hb2 < 0.75 ? vec3(0.45, 0.33, 0.24) // brun
            : hb2 < 0.9 ? vec3(0.86, 0.83, 0.74)  // crème
            : vec3(0.32, 0.42, 0.55);             // bleu
    float slat = 0.78 + 0.22 * smoothstep(0.2, 0.8, fract(f.y * 36.0));
    if (hw < 0.16) {
      // fermées : deux vantaux sur la vitre
      if (f.x > 0.255 && f.x < 0.745 && f.y > 0.27 && f.y < 0.89) {
        float joint = smoothstep(0.004, 0.0, abs(f.x - 0.5));
        diffuseColor.rgb = sc * slat * (1.0 - joint * 0.5);
        facadeShut = 1.0;
        facadeFlat = 1.0;
      }
    } else if (hw < 0.82) {
      // ouvertes, rabattues contre le mur de chaque côté
      float d = min(abs(f.x - 0.13), abs(f.x - 0.87));
      if (d < 0.095 && f.y > 0.27 && f.y < 0.89) {
        float edge = smoothstep(0.095, 0.085, d);
        diffuseColor.rgb = mix(diffuseColor.rgb * 0.6, sc * slat, edge);
        facadeFlat = 1.0;
      } else if (d < 0.11 && f.y > 0.25 && f.y < 0.9) {
        diffuseColor.rgb *= 0.75; // ombre du vantail sur la pierre
      }
    }
  }
}
#endif
`;

export function facadeShaderPatch(shader) {
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <color_fragment>', '#include <color_fragment>\n' + GLSL)
    .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\nnormal = normalize(mix(normal, nonPerturbedNormal, facadeFlat));')
    .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.85, facadeFlat);')
    .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance *= (1.0 - facadeShut) * facadeEmi;');
}
