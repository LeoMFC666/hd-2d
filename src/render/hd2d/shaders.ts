/**
 * Shaders do pipeline HD-2D. GLSL ES 3.00 (o three.js compila
 * ShaderMaterial como #version 300 es no WebGL2): texelFetch e operacoes
 * inteiras estao disponiveis; gl_FragColor e varying sao mapeados pelo
 * prefixo do three.
 */

export const FULLSCREEN_VERTEX = /* glsl */ `
varying vec2 vUv;

void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const COMMON = /* glsl */ `
#define PI 3.14159265359

// Matriz de Bayer 4x4: limiar do pontilhado ordenado.
const float BAYER4[16] = float[16](
  0.0, 8.0, 2.0, 10.0,
  12.0, 4.0, 14.0, 6.0,
  3.0, 11.0, 1.0, 9.0,
  15.0, 7.0, 13.0, 5.0
);

float bayer4(vec2 p) {
  ivec2 q = ivec2(mod(floor(p), 4.0));
  return (BAYER4[q.y * 4 + q.x] + 0.5) / 16.0;
}

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

vec2 hash22(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy);
}

float luma(vec3 c) {
  return dot(c, vec3(0.2126, 0.7152, 0.0722));
}

vec3 linearToSrgb(vec3 c) {
  c = max(c, vec3(0.0));
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(vec3(0.0031308), c));
}

vec3 toOklab(vec3 c) {
  float l = 0.4122214708 * c.r + 0.5363325363 * c.g + 0.0514459929 * c.b;
  float m = 0.2119034982 * c.r + 0.6806995451 * c.g + 0.1073969566 * c.b;
  float s = 0.0883024619 * c.r + 0.2817188376 * c.g + 0.6299787005 * c.b;
  l = pow(max(l, 0.0), 1.0 / 3.0);
  m = pow(max(m, 0.0), 1.0 / 3.0);
  s = pow(max(s, 0.0), 1.0 / 3.0);
  return vec3(
    0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s
  );
}
`;

/**
 * Passo de luz (resolucao interna). Le cor e profundidade da cena e o
 * shadow map do sol; reconstroi posicao e normal no mundo; aplica:
 *   - sombra do sol pontilhada (Bayer ancorado no grid de pixels do GBA
 *     na superficie, entao o padrao nao "nada" quando a camera anda);
 *   - tons quente (luz) e frio (sombra) do HD-2D;
 *   - escuridao de caverna com a luz do jogador em faixas pontilhadas;
 *   - neblina de distancia.
 * O alfa guarda a forma do splat daquela celula: direcao (16 passos) e
 * achatamento (16 passos) da normal projetada na tela.
 */
export const LIGHT_FRAGMENT = /* glsl */ `
${COMMON}

uniform sampler2D tColor;
uniform sampler2D tDepth;
uniform sampler2D tShadow;

uniform vec2 uTexel;
uniform mat4 uProjInv;
uniform mat4 uViewInv;
uniform mat4 uView;
uniform vec3 uCameraPos;

uniform float uShadowEnabled;
uniform mat4 uShadowMatrix;
uniform vec2 uShadowTexel;
uniform float uShadowBias;
uniform vec3 uSunDir;

uniform vec3 uLitTint;
uniform vec3 uShadowTint;
uniform float uShadowDensity;

uniform float uDarkness;
uniform vec3 uFocus;
uniform float uLightRadius;

uniform vec3 uFogColor;
uniform float uFogAmount;
uniform float uFogNear;
uniform float uFogFar;

// Depuracao: 1 = termo de sombra, 2 = normais.
uniform int uDebug;

varying vec2 vUv;

float depthAt(vec2 uv) {
  return texture2D(tDepth, uv).r;
}

vec3 worldAt(vec2 uv, float d) {
  vec4 ndc = vec4(uv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0);
  vec4 view = uProjInv * ndc;
  view /= view.w;
  return (uViewInv * view).xyz;
}

float shadowTap(vec3 sc, vec2 offset) {
  float stored = texture2D(tShadow, sc.xy + offset * uShadowTexel).r;
  return sc.z - uShadowBias > stored ? 1.0 : 0.0;
}

void main() {
  vec4 albedo = texture2D(tColor, vUv);
  float d = depthAt(vUv);

  // Fundo (vazio do GBA, ceu): sem luz nem forma propria.
  if (d >= 1.0) {
    gl_FragColor = vec4(albedo.rgb, 1.0);
    return;
  }

  vec3 P = worldAt(vUv, d);

  // Normal pela profundidade dos vizinhos: em cada eixo, o lado mais
  // continuo (evita bordas de silhueta).
  vec2 tx = vec2(uTexel.x, 0.0);
  vec2 ty = vec2(0.0, uTexel.y);
  float dl = depthAt(vUv - tx);
  float dr = depthAt(vUv + tx);
  float dd = depthAt(vUv - ty);
  float du = depthAt(vUv + ty);
  vec3 ddx = abs(dr - d) < abs(d - dl) ? worldAt(vUv + tx, dr) - P : P - worldAt(vUv - tx, dl);
  vec3 ddy = abs(du - d) < abs(d - dd) ? worldAt(vUv + ty, du) - P : P - worldAt(vUv - ty, dd);
  vec3 N = normalize(cross(ddx, ddy));
  vec3 V = normalize(uCameraPos - P);

  if (dot(N, V) < 0.0) {
    N = -N;
  }

  // Grid de pixels do GBA (16 por tile) no plano da superficie: a sombra e
  // o pontilhado andam no mesmo grid da arte.
  vec3 an = abs(N);
  vec3 Ps = P;
  vec2 surface;

  if (an.y >= an.x && an.y >= an.z) {
    surface = P.xz;
    Ps.xz = (floor(P.xz * 16.0) + 0.5) / 16.0;
  } else if (an.x >= an.z) {
    surface = P.zy;
    Ps.zy = (floor(P.zy * 16.0) + 0.5) / 16.0;
  } else {
    surface = P.xy;
    Ps.xy = (floor(P.xy * 16.0) + 0.5) / 16.0;
  }

  vec2 pixel = floor(surface * 16.0);

  float shade = 0.0;

  // So superficies deitadas (chao, telhados) recebem sombra, como no
  // HD-2D: paredes, sprites e cartoes em pe ficam iluminados (o sol vem de
  // tras e eles nao fazem sombra em si mesmos).
  if (uShadowEnabled > 0.5 && N.y > 0.55) {
    vec4 sc4 = uShadowMatrix * vec4(Ps + N * 0.035, 1.0);
    vec3 sc = sc4.xyz / sc4.w;

    if (all(greaterThan(sc.xy, vec2(0.002))) && all(lessThan(sc.xy, vec2(0.998))) && sc.z < 1.0) {
      shade = 0.25 * (
        shadowTap(sc, vec2(-0.5, -0.5)) +
        shadowTap(sc, vec2(0.5, -0.5)) +
        shadowTap(sc, vec2(-0.5, 0.5)) +
        shadowTap(sc, vec2(0.5, 0.5))
      );
    }

  }

  // Pontilhado: na umbra, a fracao uShadowDensity dos pixels fica com o
  // tom de sombra (0.5 = xadrez); na penumbra, menos.
  float dotted = step(bayer4(pixel), shade * uShadowDensity - 0.001);

  vec3 lit = albedo.rgb * uLitTint;
  vec3 dark = albedo.rgb * uShadowTint;
  vec3 color = mix(mix(lit, dark, 0.2 * shade), dark, dotted);

  // Caverna: escuro com a luz do jogador em 3 faixas pontilhadas.
  if (uDarkness > 0.0) {
    float distance = length(P.xz - uFocus.xz);
    float light = 1.0 - smoothstep(uLightRadius * 0.3, uLightRadius, distance);
    float band = clamp(floor(light * 3.0 + bayer4(pixel + 2.0)) / 3.0, 0.0, 1.0);
    vec3 darkTint = vec3(1.0) - uDarkness * vec3(0.9, 0.88, 0.76);
    color *= mix(darkTint, vec3(1.06, 0.98, 0.86), band);
  }

  float viewDistance = length(P - uCameraPos);
  color = mix(color, uFogColor, uFogAmount * smoothstep(uFogNear, uFogFar, viewDistance));

  // Forma do splat: normal na tela.
  vec3 Nv = mat3(uView) * N;
  float squash = clamp(abs(Nv.z), 0.0, 1.0);
  float angle = length(Nv.xy) > 1e-4 ? atan(Nv.y, Nv.x) : 0.0;

  if (angle < 0.0) {
    angle += PI;
  }

  float angleIndex = min(floor(angle / PI * 16.0), 15.0);
  float squashIndex = floor(squash * 15.0 + 0.5);

  if (uDebug == 1) {
    color = vec3(1.0 - shade);
  } else if (uDebug == 2) {
    color = N * 0.5 + 0.5;
  } else if (uDebug == 3) {
    vec4 sc4 = uShadowMatrix * vec4(Ps, 1.0);
    vec3 sc = sc4.xyz / sc4.w;
    color = vec3(fract(sc.xy * 8.0), texture2D(tShadow, sc.xy).r);
  } else if (uDebug == 4) {
    vec4 sc4 = uShadowMatrix * vec4(Ps, 1.0);
    vec3 sc = sc4.xyz / sc4.w;
    color = vec3((sc.z - texture2D(tShadow, sc.xy).r) * 50.0 + 0.5);
  }

  gl_FragColor = vec4(color, (angleIndex * 16.0 + squashIndex) / 255.0);
}
`;

/** Bloom: so o que passa do limiar, em meia resolucao. */
export const BRIGHT_FRAGMENT = /* glsl */ `
${COMMON}

uniform sampler2D tSource;
uniform vec2 uTexel;
uniform float uThreshold;

varying vec2 vUv;

void main() {
  vec3 c = 0.25 * (
    texture2D(tSource, vUv + vec2(-0.5, -0.5) * uTexel).rgb +
    texture2D(tSource, vUv + vec2(0.5, -0.5) * uTexel).rgb +
    texture2D(tSource, vUv + vec2(-0.5, 0.5) * uTexel).rgb +
    texture2D(tSource, vUv + vec2(0.5, 0.5) * uTexel).rgb
  );

  float weight = smoothstep(uThreshold, uThreshold + 0.25, luma(c));
  gl_FragColor = vec4(c * weight, 1.0);
}
`;

/** Desfoque gaussiano separavel (9 amostras com filtro linear). */
export const BLUR_FRAGMENT = /* glsl */ `
uniform sampler2D tSource;
uniform vec2 uDirection;

varying vec2 vUv;

void main() {
  vec3 sum = texture2D(tSource, vUv).rgb * 0.2270270270;
  sum += texture2D(tSource, vUv + uDirection * 1.3846153846).rgb * 0.3162162162;
  sum += texture2D(tSource, vUv - uDirection * 1.3846153846).rgb * 0.3162162162;
  sum += texture2D(tSource, vUv + uDirection * 3.2307692308).rgb * 0.0702702703;
  sum += texture2D(tSource, vUv - uDirection * 3.2307692308).rgb * 0.0702702703;
  gl_FragColor = vec4(sum, 1.0);
}
`;

/**
 * Composicao (resolucao interna): profundidade de campo tilt-shift (o
 * diorama do Octopath: desfoca longe e perto do jogador e nas bordas de
 * cima/baixo), bloom quente, gradacao quente/fria e vinheta.
 */
export const COMPOSITE_FRAGMENT = /* glsl */ `
${COMMON}

uniform sampler2D tLit;
uniform sampler2D tBloom;
uniform sampler2D tDepth;

uniform vec2 uTexel;
uniform float uNear;
uniform float uFar;
uniform float uFocusDepth;
uniform float uFocusRange;
uniform float uDof;
uniform float uMaxBlur;
uniform float uBloom;
uniform float uVignette;
uniform float uWarmth;
uniform float uAspect;

varying vec2 vUv;

float linearDepth(float d) {
  float z = d * 2.0 - 1.0;
  return 2.0 * uNear * uFar / (uFar + uNear - z * (uFar - uNear));
}

float circleOfConfusion(vec2 uv) {
  float z = linearDepth(texture2D(tDepth, uv).r);
  float depthBlur = smoothstep(uFocusRange, uFocusRange * 4.0, abs(z - uFocusDepth));
  // Faixa nitida maior em cima: o fundo da cena (mais longe) fica visivel.
  float tilt = max(smoothstep(0.4, 0.0, uv.y), smoothstep(0.72, 1.08, uv.y));
  return clamp(max(depthBlur, tilt * 0.85), 0.0, 1.0) * uDof;
}

void main() {
  vec4 center = texture2D(tLit, vUv);
  float coc = circleOfConfusion(vUv);

  vec3 sum = center.rgb;
  float weight = 1.0;

  if (coc > 0.02) {
    float radius = coc * uMaxBlur;

    // Disco de Vogel: 24 amostras bem espalhadas. Uma amostra so entra se
    // ela mesma esta desfocada o bastante para alcancar este pixel - o
    // que esta em foco nao vaza para o fundo desfocado.
    for (int i = 0; i < 24; i++) {
      float fi = float(i) + 0.5;
      float r = sqrt(fi / 24.0) * radius;
      float theta = fi * 2.39996323;
      vec2 uv = vUv + vec2(cos(theta), sin(theta)) * r * uTexel;
      float sampleRadius = circleOfConfusion(uv) * uMaxBlur;
      float w = sampleRadius >= r * 0.75 ? 1.0 : 0.0;
      sum += texture2D(tLit, uv).rgb * w;
      weight += w;
    }
  }

  vec3 color = sum / weight;

  color += texture2D(tBloom, vUv).rgb * uBloom * vec3(1.15, 1.0, 0.78);

  // Luz quente, sombra fria.
  float l = luma(color);
  vec3 grade = mix(vec3(0.86, 0.93, 1.12), vec3(1.08, 1.0, 0.86), smoothstep(0.04, 0.6, l));
  color *= mix(vec3(1.0), grade, uWarmth);
  color = mix(vec3(luma(color)), color, 1.0 + 0.18 * uWarmth);

  // Vinheta escura puxada para o violeta, como nas cenas do Octopath.
  vec2 q = (vUv - 0.5) * vec2(uAspect, 1.0);
  float v = smoothstep(0.3, 1.0, length(q) * 1.1);
  color = mix(color, color * vec3(0.16, 0.11, 0.17), v * uVignette);

  gl_FragColor = vec4(max(color, vec3(0.0)), center.a);
}
`;

/**
 * Splat gaussiano duro + paleta pequena (resolucao de saida).
 *
 * Cada celula da imagem interna vira um splat: uma elipse orientada pela
 * normal da superficie (chao vira elipse deitada, paredes e sprites viram
 * discos), com centro e tamanho levemente variados por um hash preso ao
 * mundo. A gaussiana e cortada num limiar (borda dura) e tem um degrau na
 * borda (relevo). Onde splats se sobrepoem vence o mais perto da camera.
 * A cor vencedora e trocada pela da paleta, com pontilhado ordenado entre
 * as duas cores mais proximas em OKLab.
 */
export const SPLAT_FRAGMENT = /* glsl */ `
${COMMON}

uniform sampler2D tGraded;
uniform sampler2D tDepth;
uniform sampler2D tPalette;
uniform sampler2D tPaletteLab;

uniform int uPaletteSize;
uniform float uPaletteDither;

uniform vec2 uCellSize;
uniform vec2 uOffset;
uniform vec2 uOrigin;
uniform ivec2 uGrid;

uniform float uRadius;
uniform float uJitter;
uniform float uRelief;

// Eixo da elipse para cada um dos 16 angulos guardados no alfa.
const vec2 AXES[16] = vec2[16](
  vec2(0.995185, 0.098017),
  vec2(0.956940, 0.290285),
  vec2(0.881921, 0.471397),
  vec2(0.773010, 0.634393),
  vec2(0.634393, 0.773010),
  vec2(0.471397, 0.881921),
  vec2(0.290285, 0.956940),
  vec2(0.098017, 0.995185),
  vec2(-0.098017, 0.995185),
  vec2(-0.290285, 0.956940),
  vec2(-0.471397, 0.881921),
  vec2(-0.634393, 0.773010),
  vec2(-0.773010, 0.634393),
  vec2(-0.881921, 0.471397),
  vec2(-0.956940, 0.290285),
  vec2(-0.995185, 0.098017)
);

vec3 quantize(vec3 color, vec2 cell) {
  if (uPaletteSize <= 0) {
    return color;
  }

  vec3 lab = toOklab(color);
  float best = 1e9;
  float second = 1e9;
  int bestIndex = 0;
  int secondIndex = 0;

  for (int i = 0; i < 64; i++) {
    if (i >= uPaletteSize) {
      break;
    }

    vec3 e = lab - texelFetch(tPaletteLab, ivec2(i, 0), 0).rgb;
    float distance = dot(e, e);

    if (distance < best) {
      second = best;
      secondIndex = bestIndex;
      best = distance;
      bestIndex = i;
    } else if (distance < second) {
      second = distance;
      secondIndex = i;
    }
  }

  float a = sqrt(best);
  float b = sqrt(second);
  float ratio = a / max(a + b, 1e-6);
  int pick = bayer4(cell) < ratio * uPaletteDither ? secondIndex : bestIndex;

  return texelFetch(tPalette, ivec2(pick, 0), 0).rgb;
}

void main() {
  vec2 position = gl_FragCoord.xy / uCellSize + uOffset;
  ivec2 base = ivec2(floor(position));
  ivec2 bestCell = clamp(base, ivec2(0), uGrid - 1);
  float bestDepth = 2.0;
  float bestQ = 0.0;

  // Alcance maximo de um splat (raio com variacao + deslocamento do
  // centro): 1 celula para os ajustes normais (3x3 vizinhos), 2 no maximo.
  float reachCells = uRadius * (1.0 + uJitter * 0.3) + uJitter * 0.5;
  int reach = clamp(int(ceil(reachCells - 0.5)), 1, 2);

  if (uRadius > 0.0) {
    for (int j = -reach; j <= reach; j++) {
      for (int i = -reach; i <= reach; i++) {
        ivec2 cell = base + ivec2(i, j);

        if (any(lessThan(cell, ivec2(0))) || any(greaterThanEqual(cell, uGrid))) {
          continue;
        }

        vec2 id = vec2(cell) + uOrigin;
        vec2 center = vec2(cell) + 0.5 + (hash22(id) - 0.5) * uJitter;

        int shape = int(texelFetch(tGraded, cell, 0).a * 255.0 + 0.5);
        float squash = mix(0.42, 1.0, float(shape & 15) / 15.0);
        float radius = uRadius * (1.0 + (hash12(id + 17.31) - 0.5) * uJitter * 0.6);

        vec2 delta = position - center;
        vec2 axis = AXES[(shape >> 4) & 15];
        float u = dot(delta, axis) / (radius * squash);
        float v = dot(delta, vec2(-axis.y, axis.x)) / radius;
        float q = u * u + v * v;

        // Gaussiana cortada: dentro do limiar e 1, fora e 0.
        if (q > 1.0) {
          continue;
        }

        float depth = texelFetch(tDepth, cell, 0).r;

        if (depth < bestDepth - 1e-6 || (abs(depth - bestDepth) <= 1e-6 && q < bestQ)) {
          bestDepth = depth;
          bestQ = q;
          bestCell = cell;
        }
      }
    }
  }

  vec3 color = texelFetch(tGraded, bestCell, 0).rgb;

  // Degrau na borda do splat (gaussiana posterizada em 2 niveis).
  color *= 1.0 - uRelief * step(0.6, bestQ);

  color = quantize(color, vec2(bestCell) + uOrigin);

  gl_FragColor = vec4(linearToSrgb(color), 1.0);
}
`;
