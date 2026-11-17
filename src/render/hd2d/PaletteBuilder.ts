import * as THREE from 'three';

/**
 * Paleta pequena tirada do proprio quadro.
 *
 * Em vez de uma paleta fixa por jogo, as cores sao agrupadas (k-means em
 * OKLab, espaco perceptual) a partir do quadro ja iluminado: sombras frias,
 * luz quente, neblina e bloom entram na conta. Assim a mesma regra serve
 * para Ruby, Sapphire, Emerald, FireRed, LeafGreen e qualquer hack.
 *
 * A cada atualizacao o k-means parte da paleta anterior (as entradas
 * mantem o indice) e as cores na GPU vao ate as novas aos poucos: trocar
 * de mapa nao faz a imagem piscar.
 */

const MAX_COLORS = 64;

const MAX_SAMPLES = 6000;

const ITERATIONS = 7;

// Tempo da transicao entre paletas (ms).
const BLEND_MS = 450;

function srgbToLinear(value: number): number {
  const c = value / 255;

  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

const SRGB_TO_LINEAR = new Float32Array(256).map((_, index) => srgbToLinear(index));

function linearToOklab(r: number, g: number, b: number, out: Float32Array, offset: number): void {
  const l = Math.cbrt(Math.max(0, 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b));
  const m = Math.cbrt(Math.max(0, 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b));
  const s = Math.cbrt(Math.max(0, 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b));

  out[offset] = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  out[offset + 1] = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  out[offset + 2] = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
}

function oklabToLinear(L: number, a: number, b: number, out: Float32Array, offset: number): void {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;

  out[offset] = Math.max(0, 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s);
  out[offset + 1] = Math.max(0, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s);
  out[offset + 2] = Math.max(0, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s);
}

export class PaletteBuilder {
  // Cor linear (para pintar) e OKLab (para comparar), 64 x 1, RGBA float.
  readonly colorTexture: THREE.DataTexture;

  readonly labTexture: THREE.DataTexture;

  private readonly colorData = new Float32Array(MAX_COLORS * 4);

  private readonly labData = new Float32Array(MAX_COLORS * 4);

  // Centroides atuais (alvo) e os que estao na GPU (em transicao).
  private target: Float32Array = new Float32Array(0);

  private shown: Float32Array = new Float32Array(0);

  private from: Float32Array = new Float32Array(0);

  private blendStartedAt = 0;

  private blending = false;

  private size = 0;

  private seed = 0x9e3779b9;

  constructor() {
    this.colorTexture = this.createTexture(this.colorData);
    this.labTexture = this.createTexture(this.labData);
  }

  /** Quantas cores a paleta tem agora (0 = ainda nao montada). */
  get count(): number {
    return this.size;
  }

  reset(): void {
    this.size = 0;
    this.target = new Float32Array(0);
    this.shown = new Float32Array(0);
  }

  /**
   * Agrupa as cores de um quadro (RGBA sRGB, 8 bits) em `k` cores.
   */
  fit(pixels: Uint8Array, width: number, height: number, k: number): void {
    k = Math.max(2, Math.min(MAX_COLORS, Math.round(k)));

    const samples = this.sample(pixels, width, height);
    const count = samples.length / 3;

    if (count < k) {
      return;
    }

    const centroids: Float32Array =
      this.target.length === k * 3 ? this.target.slice() : this.seedCentroids(samples, k);

    const sums = new Float64Array(k * 3);
    const members = new Uint32Array(k);
    const assignment = new Uint16Array(count);

    for (let iteration = 0; iteration < ITERATIONS; iteration++) {
      sums.fill(0);
      members.fill(0);

      let farthest = 0;
      let farthestDistance = -1;

      for (let index = 0; index < count; index++) {
        const o = index * 3;
        let best = 0;
        let bestDistance = Infinity;

        for (let c = 0; c < k; c++) {
          const dl = samples[o] - centroids[c * 3];
          const da = samples[o + 1] - centroids[c * 3 + 1];
          const db = samples[o + 2] - centroids[c * 3 + 2];
          const distance = dl * dl + da * da + db * db;

          if (distance < bestDistance) {
            bestDistance = distance;
            best = c;
          }
        }

        assignment[index] = best;
        members[best]++;
        sums[best * 3] += samples[o];
        sums[best * 3 + 1] += samples[o + 1];
        sums[best * 3 + 2] += samples[o + 2];

        if (bestDistance > farthestDistance) {
          farthestDistance = bestDistance;
          farthest = index;
        }
      }

      for (let c = 0; c < k; c++) {
        if (members[c] === 0) {
          // Cor sem uso: vai para a amostra mais mal representada.
          centroids[c * 3] = samples[farthest * 3];
          centroids[c * 3 + 1] = samples[farthest * 3 + 1];
          centroids[c * 3 + 2] = samples[farthest * 3 + 2];
          continue;
        }

        centroids[c * 3] = sums[c * 3] / members[c];
        centroids[c * 3 + 1] = sums[c * 3 + 1] / members[c];
        centroids[c * 3 + 2] = sums[c * 3 + 2] / members[c];
      }
    }

    const now = performance.now();

    this.from = this.shown.length === k * 3 ? this.shown.slice() : centroids.slice();
    this.target = centroids;
    this.size = k;
    this.blendStartedAt = now;
    this.blending = true;
    this.update(now);
  }

  /** Avanca a transicao e sobe as cores para a GPU. */
  update(now: number): void {
    if (this.size === 0) {
      return;
    }

    if (!this.blending) {
      return;
    }

    const t = Math.min(1, (now - this.blendStartedAt) / BLEND_MS);

    this.blending = t < 1;

    const eased = t * t * (3 - 2 * t);
    const shown = new Float32Array(this.target.length);

    for (let index = 0; index < shown.length; index++) {
      shown[index] = this.from[index] + (this.target[index] - this.from[index]) * eased;
    }

    this.shown = shown;

    const linear = new Float32Array(3);

    for (let c = 0; c < this.size; c++) {
      this.labData[c * 4] = shown[c * 3];
      this.labData[c * 4 + 1] = shown[c * 3 + 1];
      this.labData[c * 4 + 2] = shown[c * 3 + 2];
      this.labData[c * 4 + 3] = 1;

      oklabToLinear(shown[c * 3], shown[c * 3 + 1], shown[c * 3 + 2], linear, 0);

      this.colorData[c * 4] = linear[0];
      this.colorData[c * 4 + 1] = linear[1];
      this.colorData[c * 4 + 2] = linear[2];
      this.colorData[c * 4 + 3] = 1;
    }

    this.colorTexture.needsUpdate = true;
    this.labTexture.needsUpdate = true;
  }

  dispose(): void {
    this.colorTexture.dispose();
    this.labTexture.dispose();
  }

  /** Amostras em OKLab numa grade com deslocamento, ate MAX_SAMPLES. */
  private sample(pixels: Uint8Array, width: number, height: number): Float32Array {
    const total = width * height;
    const step = Math.max(1, Math.floor(Math.sqrt(total / MAX_SAMPLES)));
    const samples = new Float32Array(Math.ceil(width / step) * Math.ceil(height / step) * 3);
    let count = 0;

    for (let y = 0; y < height; y += step) {
      for (let x = 0; x < width; x += step) {
        const jx = Math.min(width - 1, x + (this.random() * step) | 0);
        const jy = Math.min(height - 1, y + (this.random() * step) | 0);
        const o = (jy * width + jx) * 4;

        linearToOklab(
          SRGB_TO_LINEAR[pixels[o]],
          SRGB_TO_LINEAR[pixels[o + 1]],
          SRGB_TO_LINEAR[pixels[o + 2]],
          samples,
          count * 3,
        );

        count++;
      }
    }

    return samples.subarray(0, count * 3);
  }

  /** k-means++: cada nova cor nasce longe das ja escolhidas. */
  private seedCentroids(samples: Float32Array, k: number): Float32Array {
    const count = samples.length / 3;
    const centroids = new Float32Array(k * 3);
    const distances = new Float64Array(count).fill(Infinity);

    let pick = (this.random() * count) | 0;

    for (let c = 0; c < k; c++) {
      centroids[c * 3] = samples[pick * 3];
      centroids[c * 3 + 1] = samples[pick * 3 + 1];
      centroids[c * 3 + 2] = samples[pick * 3 + 2];

      let total = 0;

      for (let index = 0; index < count; index++) {
        const dl = samples[index * 3] - centroids[c * 3];
        const da = samples[index * 3 + 1] - centroids[c * 3 + 1];
        const db = samples[index * 3 + 2] - centroids[c * 3 + 2];
        const distance = dl * dl + da * da + db * db;

        if (distance < distances[index]) {
          distances[index] = distance;
        }

        total += distances[index];
      }

      let threshold = this.random() * total;

      pick = count - 1;

      for (let index = 0; index < count; index++) {
        threshold -= distances[index];

        if (threshold <= 0) {
          pick = index;
          break;
        }
      }
    }

    return centroids;
  }

  // xorshift32 com semente fixa: a mesma cena da a mesma paleta.
  private random(): number {
    let x = this.seed;

    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;

    this.seed = x >>> 0;

    return this.seed / 0x100000000;
  }

  private createTexture(data: Float32Array): THREE.DataTexture {
    const texture = new THREE.DataTexture(data, MAX_COLORS, 1, THREE.RGBAFormat, THREE.FloatType);

    texture.minFilter = THREE.NearestFilter;
    texture.magFilter = THREE.NearestFilter;
    texture.generateMipmaps = false;
    texture.colorSpace = THREE.NoColorSpace;
    texture.needsUpdate = true;

    return texture;
  }
}
