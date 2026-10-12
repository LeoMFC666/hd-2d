/**
 * Chao debaixo dos modelos 3D, como no Faithful.
 *
 * O desenho do GBA tem a casa, a arvore e a cerca pintadas no proprio
 * tile. Com o modelo em pe por cima, o desenho achatado continuava no chao
 * e aparecia pelos lados e pelos furos (o "sprite embaixo do modelo").
 *
 * Aqui o mapa ganha DUAS texturas:
 *   - CHAO: cada bloco coberto por modelo recebe o tile de chao mais
 *     proximo (busca em largura a partir do chao andavel em volta). Grama
 *     vizinha embaixo da arvore, calcada embaixo da casa, piso do comodo
 *     embaixo do movel.
 *   - MODELOS: o desenho original; nos objetos naturais (arvores, cercas,
 *     placas, ledges) o fundo e recortado - os pixels com as cores do chao
 *     que encostam na borda do tile ficam transparentes, e o objeto vira
 *     uma silhueta em pe.
 *
 * Modulo puro sobre os arrays RGBA do mapa (16x16 por bloco, linhas de
 * baixo para cima: o bloco (x, y) ocupa as linhas de textura
 * (H-1-y)*16 .. +15, com a linha de cima do tile na mais alta).
 */

const TILE = 16;

export interface SubstitutionInput {
  width: number;
  height: number;

  // Bloco coberto por modelo (recebe chao novo).
  covered: (x: number, y: number) => boolean;

  // Bloco que serve de chao para os vizinhos.
  isGround: (x: number, y: number) => boolean;
}

/**
 * Para cada bloco coberto, o indice do bloco de chao que vai embaixo
 * (o mais proximo, em passos de 4 vizinhos), ou -1.
 */
export function chooseGroundSources(
  input: SubstitutionInput,
): Int32Array {
  const { width, height } = input;
  const source = new Int32Array(width * height).fill(-1);
  const queue = new Int32Array(width * height);
  let head = 0;
  let tail = 0;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!input.covered(x, y) && input.isGround(x, y)) {
        const index = y * width + x;
        source[index] = index;
        queue[tail++] = index;
      }
    }
  }

  while (head < tail) {
    const index = queue[head++];
    const x = index % width;
    const y = (index - x) / width;

    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx;
      const ny = y + dy;

      if (nx < 0 || ny < 0 || nx >= width || ny >= height) {
        continue;
      }

      const next = ny * width + nx;

      if (source[next] !== -1 || !input.covered(nx, ny)) {
        continue;
      }

      source[next] = source[index];
      queue[tail++] = next;
    }
  }

  // So os cobertos interessam.
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!input.covered(x, y)) {
        source[y * width + x] = -1;
      }
    }
  }

  return source;
}

function texelOffset(
  width: number,
  height: number,
  x: number,
  y: number,
  px: number,
  py: number,
): number {
  const textureWidth = width * TILE;
  const row = (height - 1 - y) * TILE + (TILE - 1 - py);

  return (row * textureWidth + x * TILE + px) * 4;
}

/**
 * Copia o bloco de origem por cima de cada bloco coberto, nas duas
 * camadas do CHAO.
 */
export function applyGroundSubstitution(
  width: number,
  height: number,
  sources: Int32Array,
  basePixels: Uint8ClampedArray,
  foregroundPixels: Uint8ClampedArray,
): void {
  for (let index = 0; index < sources.length; index++) {
    const from = sources[index];

    if (from < 0 || from === index) {
      continue;
    }

    const toX = index % width;
    const toY = (index - toX) / width;
    const fromX = from % width;
    const fromY = (from - fromX) / width;

    for (let py = 0; py < TILE; py++) {
      for (let px = 0; px < TILE; px++) {
        const destination = texelOffset(width, height, toX, toY, px, py);
        const origin = texelOffset(width, height, fromX, fromY, px, py);

        for (let channel = 0; channel < 4; channel++) {
          basePixels[destination + channel] = basePixels[origin + channel];
          foregroundPixels[destination + channel] =
            foregroundPixels[origin + channel];
        }
      }
    }
  }
}

/**
 * Recorta o fundo dos objetos naturais na textura dos MODELOS: a partir
 * da borda do tile, apaga os pixels cujas cores existem no tile de chao
 * que foi para debaixo dele. O contorno escuro do desenho segura o
 * preenchimento, entao a copa e o tronco ficam inteiros.
 *
 * `originalBase` e o desenho original (antes da troca do chao), de onde
 * saem as cores do chao de origem.
 */
export function cutoutBackgrounds(
  width: number,
  height: number,
  sources: Int32Array,
  shouldCut: (x: number, y: number) => boolean,
  modelPixels: Uint8ClampedArray,
  originalBase: Uint8ClampedArray,
): void {
  const colorKey = (pixels: Uint8ClampedArray, offset: number): number =>
    (pixels[offset] << 16) | (pixels[offset + 1] << 8) | pixels[offset + 2];

  const visited = new Uint8Array(TILE * TILE);
  const stack: number[] = [];

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index = y * width + x;
      const from = sources[index];

      if (from < 0 || !shouldCut(x, y)) {
        continue;
      }

      const fromX = from % width;
      const fromY = (from - fromX) / width;
      const groundColors = new Set<number>();

      for (let py = 0; py < TILE; py++) {
        for (let px = 0; px < TILE; px++) {
          const offset = texelOffset(width, height, fromX, fromY, px, py);

          if (originalBase[offset + 3] >= 128) {
            groundColors.add(colorKey(originalBase, offset));
          }
        }
      }

      const isGroundColor = (px: number, py: number): boolean => {
        const offset = texelOffset(width, height, x, y, px, py);

        return (
          modelPixels[offset + 3] >= 128 &&
          groundColors.has(colorKey(modelPixels, offset))
        );
      };

      visited.fill(0);
      stack.length = 0;

      for (let i = 0; i < TILE; i++) {
        for (const [px, py] of [[i, 0], [i, TILE - 1], [0, i], [TILE - 1, i]]) {
          const key = py * TILE + px;

          if (!visited[key] && isGroundColor(px, py)) {
            visited[key] = 1;
            stack.push(key);
          }
        }
      }

      while (stack.length > 0) {
        const key = stack.pop() as number;
        const px = key % TILE;
        const py = (key - px) / TILE;

        modelPixels[texelOffset(width, height, x, y, px, py) + 3] = 0;

        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = px + dx;
          const ny = py + dy;

          if (nx < 0 || ny < 0 || nx >= TILE || ny >= TILE) {
            continue;
          }

          const next = ny * TILE + nx;

          if (!visited[next] && isGroundColor(nx, ny)) {
            visited[next] = 1;
            stack.push(next);
          }
        }
      }
    }
  }
}

/** Cores (RGB) opacas de um tile 16x16 RGBA. */
export function tileColors(
  pixels: Uint8ClampedArray,
): Set<number> {
  const colors = new Set<number>();

  for (let offset = 0; offset < pixels.length; offset += 4) {
    if (pixels[offset + 3] >= 128) {
      colors.add((pixels[offset] << 16) | (pixels[offset + 1] << 8) | pixels[offset + 2]);
    }
  }

  return colors;
}

/**
 * Recorta o fundo de um bloco 16x16 dentro de uma textura qualquer
 * (largura `textureWidth` em texels, bloco a partir do texel
 * (originX, originY)): apaga, a partir da borda do bloco, os pixels com
 * cores de `groundColors`. Usado no bloco de borda do padding.
 */
export function cutoutTile(
  pixels: Uint8ClampedArray,
  textureWidth: number,
  originX: number,
  originY: number,
  groundColors: ReadonlySet<number>,
): void {
  const offsetOf = (px: number, py: number): number =>
    ((originY + py) * textureWidth + originX + px) * 4;

  const isGround = (px: number, py: number): boolean => {
    const offset = offsetOf(px, py);

    return (
      pixels[offset + 3] >= 128 &&
      groundColors.has((pixels[offset] << 16) | (pixels[offset + 1] << 8) | pixels[offset + 2])
    );
  };

  const visited = new Uint8Array(TILE * TILE);
  const stack: number[] = [];

  for (let i = 0; i < TILE; i++) {
    for (const [px, py] of [[i, 0], [i, TILE - 1], [0, i], [TILE - 1, i]]) {
      const key = py * TILE + px;

      if (!visited[key] && isGround(px, py)) {
        visited[key] = 1;
        stack.push(key);
      }
    }
  }

  while (stack.length > 0) {
    const key = stack.pop() as number;
    const px = key % TILE;
    const py = (key - px) / TILE;

    pixels[offsetOf(px, py) + 3] = 0;

    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = px + dx;
      const ny = py + dy;

      if (nx < 0 || ny < 0 || nx >= TILE || ny >= TILE) {
        continue;
      }

      const next = ny * TILE + nx;

      if (!visited[next] && isGround(nx, ny)) {
        visited[next] = 1;
        stack.push(next);
      }
    }
  }
}
