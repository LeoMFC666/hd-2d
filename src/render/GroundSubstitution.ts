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

// ------------------------------------------------------------------------
// Composicao das texturas do mapa por tipo de bloco (ver VoxelFolding,
// CELL_*). Tres texturas, todas no layout do mapa (16x16 por bloco, de
// baixo para cima):
//
//   CHAO (base e camada de cima): o que fica deitado. Bloco coberto por
//     modelo recebe o chao do bloco de origem; bloco cujo objeto e so a
//     camada de cima (topo de arvore, flor) fica so com a camada de baixo.
//   MODELOS: o que fica em pe. Estruturas com o desenho inteiro; objetos
//     com o fundo recortado; topos e flores so com a camada de cima.
//
// O animador de tiles recompoe as mesmas receitas (RECIPE_*) quando a VRAM
// muda: agua, flores e animacoes de cidade continuam valendo.
// ------------------------------------------------------------------------

// Mesmos valores de VoxelFolding (CELL_*); repetidos aqui para o modulo
// nao depender dele.
const KIND_GROUND = 0;
const KIND_STRUCTURE = 1;
const KIND_STRUCTURE_TOP = 2;
const KIND_PROP = 3;
const KIND_PROP_TOP = 4;
const KIND_LEDGE = 5;
const KIND_GRASS = 6;
const KIND_FLOWER = 7;

/** Como recompor um bloco numa textura (TileAnimator). */
export const RECIPE_NONE = 0;
// Como o adapter monta a base: fundo (NORMAL) + baixo + cima (COVERED).
export const RECIPE_BASE = 1;
// Camada de cima de NORMAL/SPLIT (overlay do chao).
export const RECIPE_OVERLAY = 2;
// Fundo (NORMAL) + baixo.
export const RECIPE_BOTTOM = 3;
// So a camada de cima.
export const RECIPE_TOP = 4;
// Fundo (NORMAL) + baixo + cima, qualquer layerType.
export const RECIPE_MERGED = 5;
// Camada de cima sem o fundo: recorte a partir da borda dos pixels iguais
// aos da camada de baixo (flor animada sobre a grama).
export const RECIPE_TOP_CUT = 6;

export interface CellArt {
  // 16x16 RGBA, linha de cima primeiro (como o adapter).
  base: Uint8ClampedArray;
  foreground: Uint8ClampedArray;
  bottom: Uint8ClampedArray;
  top: Uint8ClampedArray;
  merged: Uint8ClampedArray;
}

export interface ComposedTextures {
  groundBase: Uint8ClampedArray;
  groundOverlay: Uint8ClampedArray;
  model: Uint8ClampedArray;
}

const CELL_BYTES = TILE * TILE * 4;

function writeCell(
  target: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
  x: number,
  y: number,
  cell: Uint8ClampedArray | Uint8Array,
): void {
  const textureWidth = width * TILE;
  const rowBytes = TILE * 4;

  for (let py = 0; py < TILE; py++) {
    const row = (height - 1 - y) * TILE + (TILE - 1 - py);
    let to = (row * textureWidth + x * TILE) * 4;
    let from = py * rowBytes;

    for (let i = 0; i < rowBytes; i++) {
      target[to++] = cell[from++];
    }
  }
}

function readCell(
  source: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
  x: number,
  y: number,
  out: Uint8ClampedArray,
): void {
  const textureWidth = width * TILE;
  const rowBytes = TILE * 4;

  for (let py = 0; py < TILE; py++) {
    const row = (height - 1 - y) * TILE + (TILE - 1 - py);
    const start = (row * textureWidth + x * TILE) * 4;

    out.set(source.subarray(start, start + rowBytes), py * rowBytes);
  }
}

/**
 * Apaga (alfa 0), a partir da borda de um bloco 16x16 RGBA (linha de cima
 * primeiro), os pixels de fundo conectados a ela. O contorno do desenho
 * segura o preenchimento: o objeto fica inteiro.
 */
export function floodCutout(
  cell: Uint8ClampedArray | Uint8Array,
  isBackground: (offset: number) => boolean,
): void {
  const visited = new Uint8Array(TILE * TILE);
  const stack: number[] = [];

  const consider = (px: number, py: number): void => {
    const key = py * TILE + px;

    if (visited[key]) {
      return;
    }

    visited[key] = 1;

    const offset = key * 4;

    if (cell[offset + 3] >= 128 && isBackground(offset)) {
      stack.push(key);
    }
  };

  for (let i = 0; i < TILE; i++) {
    consider(i, 0);
    consider(i, TILE - 1);
    consider(0, i);
    consider(TILE - 1, i);
  }

  while (stack.length > 0) {
    const key = stack.pop() as number;
    const px = key % TILE;
    const py = (key - px) / TILE;

    cell[key * 4 + 3] = 0;

    if (px > 0) consider(px - 1, py);
    if (px < TILE - 1) consider(px + 1, py);
    if (py > 0) consider(px, py - 1);
    if (py < TILE - 1) consider(px, py + 1);
  }
}

/** Recorte da camada de cima: fundo = pixel igual ao da camada de baixo. */
export function cutTopAgainstBottom(
  top: Uint8ClampedArray | Uint8Array,
  bottom: Uint8ClampedArray | Uint8Array,
): void {
  floodCutout(top, (offset) =>
    bottom[offset + 3] >= 128 &&
    top[offset] === bottom[offset] &&
    top[offset + 1] === bottom[offset + 1] &&
    top[offset + 2] === bottom[offset + 2],
  );
}

/**
 * Monta CHAO e MODELOS a partir do tipo de cada bloco (VoxelFolding.kinds)
 * e do chao de origem dos blocos cobertos (MapVolume.groundSources).
 */
export function composeMapTextures(
  width: number,
  height: number,
  kinds: Uint8Array,
  sources: Int32Array,
  artAt: (x: number, y: number) => CellArt | undefined,
): ComposedTextures {
  const size = width * TILE * height * TILE * 4;
  const groundBase = new Uint8ClampedArray(size);
  const groundOverlay = new Uint8ClampedArray(size);
  const model = new Uint8ClampedArray(size);
  const scratch = new Uint8ClampedArray(CELL_BYTES);

  // 1) Chao dos blocos que nao estao cobertos.
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const kind = kinds[y * width + x];
      const art = artAt(x, y);

      if (!art) {
        continue;
      }

      if (kind === KIND_GROUND) {
        writeCell(groundBase, width, height, x, y, art.base);
        writeCell(groundOverlay, width, height, x, y, art.foreground);
      } else if (
        kind === KIND_STRUCTURE_TOP ||
        kind === KIND_PROP_TOP ||
        kind === KIND_FLOWER
      ) {
        writeCell(groundBase, width, height, x, y, art.bottom);
      }
    }
  }

  // 2) Chao dos cobertos: copia o do bloco de origem (ja composto).
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index = y * width + x;
      const kind = kinds[index];

      if (
        kind !== KIND_STRUCTURE &&
        kind !== KIND_PROP &&
        kind !== KIND_LEDGE &&
        kind !== KIND_GRASS
      ) {
        continue;
      }

      const from = sources[index];

      if (from < 0) {
        const art = artAt(x, y);

        if (art) {
          writeCell(groundBase, width, height, x, y, art.base);
          writeCell(groundOverlay, width, height, x, y, art.foreground);
        }

        continue;
      }

      const fromX = from % width;
      const fromY = (from - fromX) / width;

      readCell(groundBase, width, height, fromX, fromY, scratch);
      writeCell(groundBase, width, height, x, y, scratch);
      readCell(groundOverlay, width, height, fromX, fromY, scratch);
      writeCell(groundOverlay, width, height, x, y, scratch);
    }
  }

  // 3) Modelos.
  const colorsBySource = new Map<number, Set<number>>();

  const groundColors = (source: number): Set<number> => {
    const cached = colorsBySource.get(source);

    if (cached) {
      return cached;
    }

    const colors = new Set<number>();
    const sourceX = source % width;
    const sourceY = (source - sourceX) / width;
    const cell = new Uint8ClampedArray(CELL_BYTES);

    readCell(groundBase, width, height, sourceX, sourceY, cell);

    for (let offset = 0; offset < cell.length; offset += 4) {
      if (cell[offset + 3] >= 128) {
        colors.add((cell[offset] << 16) | (cell[offset + 1] << 8) | cell[offset + 2]);
      }
    }

    colorsBySource.set(source, colors);

    return colors;
  };

  // Matiz do chao de origem (cor mais comum), quando e grama azulada -
  // a grama da Gen 3. -1 para outros chaos (areia, piso): ai so as cores
  // exatas do chao contam como fundo.
  const hueBySource = new Map<number, number>();

  const groundHue = (source: number): number => {
    const cached = hueBySource.get(source);

    if (cached !== undefined) {
      return cached;
    }

    const sourceX = source % width;
    const sourceY = (source - sourceX) / width;
    const cell = new Uint8ClampedArray(CELL_BYTES);
    const counts = new Map<number, number>();

    readCell(groundBase, width, height, sourceX, sourceY, cell);

    for (let offset = 0; offset < cell.length; offset += 4) {
      if (cell[offset + 3] >= 128) {
        const key = (cell[offset] << 16) | (cell[offset + 1] << 8) | cell[offset + 2];
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
    }

    let best = -1;
    let bestCount = 0;

    for (const [key, count] of counts) {
      if (count > bestCount) {
        best = key;
        bestCount = count;
      }
    }

    let hue = -1;

    if (best >= 0) {
      const [h, saturation] = hueOf((best >> 16) & 255, (best >> 8) & 255, best & 255);

      if (saturation >= SHADOW_MIN_SATURATION && h >= TEAL_HUE_MIN && h <= TEAL_HUE_MAX) {
        hue = h;
      }
    }

    hueBySource.set(source, hue);

    return hue;
  };

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index = y * width + x;
      const kind = kinds[index];
      const art = artAt(x, y);

      if (!art || kind === KIND_GROUND) {
        continue;
      }

      if (kind === KIND_STRUCTURE) {
        writeCell(model, width, height, x, y, art.merged);
        continue;
      }

      if (kind === KIND_STRUCTURE_TOP) {
        writeCell(model, width, height, x, y, art.top);
        continue;
      }

      if (kind === KIND_PROP_TOP || kind === KIND_FLOWER) {
        scratch.set(art.top);
        cutTopAgainstBottom(scratch, art.bottom);
        writeCell(model, width, height, x, y, scratch);
        continue;
      }

      // Objeto, grama alta, ledge: desenho inteiro sem o fundo de chao.
      scratch.set(art.merged);

      const source = sources[index];

      if (source >= 0) {
        const colors = groundColors(source);

        // Arvores e cercas: a sombra no chao (tom de grama mais escuro,
        // que nao existe no tile de grama) tambem e fundo. Na grama alta
        // esse tom e o das folhas e fica.
        const shadowHue =
          kind === KIND_PROP ? groundHue(source) : -1;

        floodCutout(scratch, (offset) =>
          colors.has(
            (scratch[offset] << 16) | (scratch[offset + 1] << 8) | scratch[offset + 2],
          ) ||
          (shadowHue >= 0 &&
            isShadowOf(scratch[offset], scratch[offset + 1], scratch[offset + 2], shadowHue)),
        );
      }

      writeCell(model, width, height, x, y, scratch);
    }
  }

  return { groundBase, groundOverlay, model };
}

// Grama da Gen 3 (RSE e FRLG): verde-azulada. A sombra das arvores no
// chao e um tom mais escuro dessa mesma grama; copas sao verde-amareladas.
const TEAL_HUE_MIN = 135;
const TEAL_HUE_MAX = 200;
const SHADOW_HUE_TOLERANCE = 20;
const SHADOW_MIN_SATURATION = 0.25;

/** Matiz (graus) e saturacao (0..1) de uma cor. */
function hueOf(red: number, green: number, blue: number): [number, number] {
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const delta = max - min;

  if (delta === 0 || max === 0) {
    return [0, 0];
  }

  let hue: number;

  if (max === red) {
    hue = 60 * (((green - blue) / delta) % 6);
  } else if (max === green) {
    hue = 60 * ((blue - red) / delta + 2);
  } else {
    hue = 60 * ((red - green) / delta + 4);
  }

  if (hue < 0) {
    hue += 360;
  }

  return [hue, delta / max];
}

function isShadowOf(red: number, green: number, blue: number, groundHue: number): boolean {
  const [hue, saturation] = hueOf(red, green, blue);

  return (
    saturation >= SHADOW_MIN_SATURATION &&
    Math.abs(hue - groundHue) <= SHADOW_HUE_TOLERANCE
  );
}

export interface AnimationLayer {
  // Metatile a recompor em cada bloco (-1 = nenhum) e como (RECIPE_*).
  metatileIds: Int32Array;
  recipes: Uint8Array;
}

/**
 * Receitas do animador para as tres texturas de composeMapTextures. Bloco
 * coberto anima como o bloco de origem do chao (e o desenho dele que esta
 * la); objetos recortados ficam parados (o recorte e feito uma vez).
 */
export function animationLayers(
  width: number,
  height: number,
  kinds: Uint8Array,
  sources: Int32Array,
  metatileAt: (index: number) => number,
): { groundBase: AnimationLayer; groundOverlay: AnimationLayer; model: AnimationLayer } {
  const count = width * height;

  const make = (): AnimationLayer => ({
    metatileIds: new Int32Array(count).fill(-1),
    recipes: new Uint8Array(count),
  });

  const groundBase = make();
  const groundOverlay = make();
  const model = make();

  const groundRecipe = (index: number): void => {
    const kind = kinds[index];
    const id = metatileAt(index);

    if (kind === KIND_GROUND) {
      groundBase.metatileIds[index] = id;
      groundBase.recipes[index] = RECIPE_BASE;
      groundOverlay.metatileIds[index] = id;
      groundOverlay.recipes[index] = RECIPE_OVERLAY;
    } else if (
      kind === KIND_STRUCTURE_TOP ||
      kind === KIND_PROP_TOP ||
      kind === KIND_FLOWER
    ) {
      groundBase.metatileIds[index] = id;
      groundBase.recipes[index] = RECIPE_BOTTOM;
    }
  };

  for (let index = 0; index < count; index++) {
    groundRecipe(index);
  }

  for (let index = 0; index < count; index++) {
    const kind = kinds[index];

    if (
      kind !== KIND_STRUCTURE &&
      kind !== KIND_PROP &&
      kind !== KIND_LEDGE &&
      kind !== KIND_GRASS
    ) {
      continue;
    }

    const from = sources[index];
    const id = metatileAt(index);

    if (from < 0) {
      groundBase.metatileIds[index] = id;
      groundBase.recipes[index] = RECIPE_BASE;
      groundOverlay.metatileIds[index] = id;
      groundOverlay.recipes[index] = RECIPE_OVERLAY;
    } else {
      groundBase.metatileIds[index] = groundBase.metatileIds[from];
      groundBase.recipes[index] = groundBase.recipes[from];
      groundOverlay.metatileIds[index] = groundOverlay.metatileIds[from];
      groundOverlay.recipes[index] = groundOverlay.recipes[from];
    }

    if (kind === KIND_STRUCTURE) {
      model.metatileIds[index] = id;
      model.recipes[index] = RECIPE_MERGED;
    }
  }

  for (let index = 0; index < count; index++) {
    const kind = kinds[index];

    if (kind === KIND_STRUCTURE_TOP) {
      model.metatileIds[index] = metatileAt(index);
      model.recipes[index] = RECIPE_TOP;
    } else if (kind === KIND_FLOWER) {
      model.metatileIds[index] = metatileAt(index);
      model.recipes[index] = RECIPE_TOP_CUT;
    }
  }

  return { groundBase, groundOverlay, model };
}

/**
 * Consulta da textura dos modelos para VoxelFolding.buildPropGeometry: ha
 * pixel opaco na coluna de blocos x, na linha de pixel `row` do mapa
 * (0 = topo do mapa)?
 */
export function modelRowOpaque(
  model: Uint8ClampedArray,
  width: number,
  height: number,
): (x: number, row: number) => boolean {
  const textureWidth = width * TILE;
  const textureRows = height * TILE;

  return (x, row) => {
    if (x < 0 || x >= width || row < 0 || row >= textureRows) {
      return false;
    }

    const start = ((textureRows - 1 - row) * textureWidth + x * TILE) * 4;

    for (let px = 0; px < TILE; px++) {
      if (model[start + px * 4 + 3] >= 128) {
        return true;
      }
    }

    return false;
  };
}
