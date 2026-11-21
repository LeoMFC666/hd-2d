/**
 * Reconstrucao 2.5D por "dobra" (a tecnica dos mods de voxel/Faithful).
 *
 * No GBA uma casa e desenhada de cima: as linhas de baixo do bloco solido
 * sao a FACHADA (parede com porta) e as de cima sao o TELHADO. Aqui, em
 * cada coluna do mapa, cada sequencia vertical de blocos solidos e dobrada:
 *
 *        visto do lado                     textura (coluna do mapa)
 *
 *        teto (linhas de cima) -------+     y0  +---------+  telhado
 *                                     |         |         |
 *                                     | parede  |  ...    |
 *   chao -----------------------------+     y1  +---------+  fachada
 *                         z = y1 + 1 (borda sul)
 *
 *   - as ultimas `wallRows` linhas (fachada) viram uma PAREDE vertical na
 *     borda sul do ultimo bloco, do chao ate a altura `wallRows`;
 *   - as linhas de cima (telhado) viram um TETO horizontal nessa altura,
 *     deslocado para o sul para encostar no topo da parede.
 *
 * Como a camera olha do sul, a projecao preserva o desenho original do
 * GBA, agora com volume. A geometria usa as MESMAS texturas do mapa (base
 * e overlay), entao a animacao de tiles continua valendo nas casas.
 *
 * Modulo puro (sem three.js): devolve arrays prontos para BufferGeometry,
 * em coordenadas LOCAIS do mapa (x de 0 a width, z de 0 a height).
 */

import { chooseGroundSources } from './GroundSubstitution';
import { KNOWN_STACKS } from './KnownStacks';

export interface FoldBlock {
  collision: number;
  elevation: number;
}

/**
 * Quais blocos ganham volume.
 *
 * Bloco impassavel e candidato (colisao != 0, e nao agua: elevacao 1 na
 * grade da Gen 3). Mas so ganha volume o GRUPO conectado de candidatos que
 * encosta em chao andavel (colisao 0, fora da agua) em algum ponto.
 *
 * Por que por grupo: pedras no mar sao impassaveis com elevacao 0, iguais
 * a uma casa - medido em Cinnabar. A diferenca e o entorno: as pedras so
 * encostam em agua. Uma regra por bloco ("tem vizinho andavel") quebraria
 * florestas, cuja coluna mais externa so encosta em outras arvores.
 */
export function computeFoldMask(
  width: number,
  height: number,
  blockAt: (x: number, y: number) => FoldBlock | undefined,
): Uint8Array {
  const WATER_ELEVATION = 1;
  const MIN_GROUND_ELEVATION = 2;
  const candidate = new Uint8Array(width * height);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const block = blockAt(x, y);

      if (
        block &&
        block.collision !== 0 &&
        block.elevation !== WATER_ELEVATION
      ) {
        candidate[y * width + x] = 1;
      }
    }
  }

  const walkableLand = (x: number, y: number): boolean => {
    if (x < 0 || y < 0 || x >= width || y >= height) {
      return false;
    }

    const block = blockAt(x, y);

    // Chao andavel = passavel E num nivel de chao (elevacao >= 2; cidades
    // e rotas usam 3). Elevacao 0 e o nivel de TRANSICAO da Gen 3, que
    // vale para qualquer altura: em Cinnabar ha blocos passaveis de
    // elevacao 0 encostados nas pedras do mar, e conta-los como chao fazia
    // as pedras levantarem como um muro.
    return (
      !!block &&
      block.collision === 0 &&
      block.elevation >= MIN_GROUND_ELEVATION
    );
  };

  const mask = new Uint8Array(width * height);
  const visited = new Uint8Array(width * height);
  const steps = [[1, 0], [-1, 0], [0, 1], [0, -1]];

  for (let start = 0; start < candidate.length; start++) {
    if (!candidate[start] || visited[start]) {
      continue;
    }

    const component: number[] = [];
    const stack = [start];
    let touchesLand = false;
    visited[start] = 1;

    while (stack.length > 0) {
      const index = stack.pop() as number;
      component.push(index);

      const x = index % width;
      const y = Math.floor(index / width);

      for (const [dx, dy] of steps) {
        const nx = x + dx;
        const ny = y + dy;

        if (walkableLand(nx, ny)) {
          touchesLand = true;
        }

        if (nx < 0 || ny < 0 || nx >= width || ny >= height) {
          continue;
        }

        const next = ny * width + nx;

        if (candidate[next] && !visited[next]) {
          visited[next] = 1;
          stack.push(next);
        }
      }
    }

    if (touchesLand) {
      for (const index of component) {
        mask[index] = 1;
      }
    }
  }

  return mask;
}

/**
 * Tira da mascara as colunas finas e soltas (cercas norte-sul, fileiras de
 * postes). Dobradas inteiras viravam uma faixa de grama elevada com os
 * postes em cima; como cartoes, quadrados de grama em pe (o tile da cerca
 * tem fundo de grama opaco). Ficam no chao, como no GBA.
 *
 * Coluna fina: sequencia vertical de pelo menos 3 blocos em que, em 7 de
 * cada 10 linhas, nenhum vizinho leste/oeste tem volume.
 */
export function dropThinColumns(
  width: number,
  height: number,
  mask: Uint8Array,
): void {
  const MIN_ROWS = 3;
  const ISOLATED_TENTHS = 7;
  const solid = (x: number, y: number): boolean =>
    x >= 0 &&
    x < width &&
    mask[y * width + x] !== 0 &&
    mask[y * width + x] !== FOLD_LEDGE;

  const drop: number[] = [];

  for (let x = 0; x < width; x++) {
    let y = 0;

    while (y < height) {
      if (!solid(x, y)) {
        y++;
        continue;
      }

      const y0 = y;

      while (y < height && solid(x, y)) {
        y++;
      }

      const rows = y - y0;

      if (rows < MIN_ROWS) {
        continue;
      }

      let isolated = 0;

      for (let row = y0; row < y; row++) {
        if (!solid(x - 1, row) && !solid(x + 1, row)) {
          isolated++;
        }
      }

      if (isolated * 10 >= rows * ISOLATED_TENTHS) {
        for (let row = y0; row < y; row++) {
          drop.push(row * width + x);
        }
      }
    }
  }

  // Depois da varredura: tirar durante mudaria o teste das colunas
  // vizinhas.
  for (const cell of drop) {
    mask[cell] = 0;
  }
}

/**
 * Sobe junto com a dobra a parte de cima de objetos de 2 tiles.
 *
 * Na Gen 3 o topo de uma casa, de uma arvore ou de uma caixa de correio e
 * um tile PASSAVEL com camada de cima (o jogador passa por tras e some).
 * Sem isto o topo ficava pintado no chao, atras do volume - a "escadinha"
 * ao lado das casas de Littleroot e o telhado cortado. Marca na mascara
 * (valor 2) ate `maxRows` desses tiles logo ao norte de um bloco dobrado.
 * Esses blocos so desenham a camada de cima: a de baixo e chao.
 */
export const FOLD_SOLID = 1;
export const FOLD_OVERHANG = 2;

// Ledge (pulo para o sul): vira uma faixa baixa, nao um muro.
export const FOLD_LEDGE = 3;

/** Bloco com volume de verdade (solido ou topo de objeto). */
export function isVolumeCell(value: number): boolean {
  return value === FOLD_SOLID || value === FOLD_OVERHANG;
}

// Comportamentos de metatile (MB_*), iguais em RSE e FRLG.
export const MB_TALL_GRASS = 0x02;
const MB_JUMP_EAST = 0x38;
const MB_JUMP_WEST = 0x39;
const MB_JUMP_NORTH = 0x3a;
const MB_JUMP_SOUTH = 0x3b;

/**
 * Ledges. No Faithful sao uma faixa marrom baixa; dobrados como o resto
 * viravam um muro de grama de 1 tile. Ledge para o sul vira FOLD_LEDGE;
 * os de outras direcoes (linhas verticais) ficam no chao.
 */
export function classifyLedges(
  width: number,
  height: number,
  mask: Uint8Array,
  behaviorAt: (x: number, y: number) => number,
): void {
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index = y * width + x;

      if (mask[index] === 0) {
        continue;
      }

      const behavior = behaviorAt(x, y);

      if (behavior === MB_JUMP_SOUTH) {
        mask[index] = FOLD_LEDGE;
      } else if (
        behavior === MB_JUMP_EAST ||
        behavior === MB_JUMP_WEST ||
        behavior === MB_JUMP_NORTH
      ) {
        mask[index] = 0;
      }
    }
  }
}

/**
 * Quinas de ledge do tileset geral do FRLG: o ledge para o sul vira para o
 * norte (na grama 0x8D/0x8E, na areia 0xAD/0xAE) e encosta num ledge
 * vertical ou numa construcao (a portaria da Rota 7 / oeste de Saffron).
 * Nao tem comportamento de pulo, entao dobravam como bloco solido: uma
 * peca marrom em pe, da altura de um tile, que parecia uma escada torta na
 * frente da portaria. Viram a ponta do ledge do lado (FOLD_LEDGE: a mesma
 * faixa baixa) e a volta para o norte fica desenhada no chao, como os
 * ledges verticais, ate o que estiver ao norte.
 *
 * Devolve as celulas trocadas: o chao delas fica com o proprio desenho
 * (a volta), em vez do chao copiado de um vizinho.
 */
const LEDGE_CORNERS = new Set([0x08d, 0x08e, 0x0ad, 0x0ae]);

export function classifyLedgeCorners(
  width: number,
  height: number,
  mask: Uint8Array,
  blockAt: (x: number, y: number) => VolumeBlock | undefined,
): number[] {
  const corners: number[] = [];

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index = y * width + x;

      if (mask[index] === 0 || mask[index] === FOLD_LEDGE) {
        continue;
      }

      const block = blockAt(x, y);

      if (!block || block.secondary || block.behavior !== 0 || !LEDGE_CORNERS.has(block.metatileId)) {
        continue;
      }

      const side = [blockAt(x - 1, y), blockAt(x + 1, y)].find(
        (neighbor) => neighbor?.behavior === MB_JUMP_SOUTH,
      );

      if (!side || !sameLedgeFace(block.pixels, side.pixels)) {
        continue;
      }

      mask[index] = FOLD_LEDGE;
      corners.push(index);
    }
  }

  return corners;
}

/**
 * A faixa de baixo da quina e a do ledge vizinho: 90% dos pixels das 4
 * linhas de baixo tem cores da faixa dele (linhas 9-15).
 */
function sameLedgeFace(corner?: Uint8ClampedArray, ledge?: Uint8ClampedArray): boolean {
  if (!corner || !ledge) {
    return false;
  }

  const rgb = (pixels: Uint8ClampedArray, offset: number): number =>
    (pixels[offset] << 16) | (pixels[offset + 1] << 8) | pixels[offset + 2];
  const face = new Set<number>();

  for (let offset = 9 * 16 * 4; offset < 16 * 16 * 4; offset += 4) {
    face.add(rgb(ledge, offset));
  }

  let hits = 0;

  for (let offset = 12 * 16 * 4; offset < 16 * 16 * 4; offset += 4) {
    if (face.has(rgb(corner, offset))) {
      hits++;
    }
  }

  return hits >= 0.9 * 4 * 16;
}

export function extendFoldMaskUpward(
  width: number,
  height: number,
  mask: Uint8Array,
  isOverhang: (x: number, y: number) => boolean,
  maxRows = 2,
): void {
  for (let x = 0; x < width; x++) {
    for (let y = 1; y < height; y++) {
      if (mask[y * width + x] !== FOLD_SOLID || mask[(y - 1) * width + x]) {
        continue;
      }

      for (
        let ny = y - 1, added = 0;
        ny >= 0 && added < maxRows && mask[ny * width + x] === 0 && isOverhang(x, ny);
        ny--, added++
      ) {
        mask[ny * width + x] = FOLD_OVERHANG;
      }
    }
  }
}

export interface FoldGeometryData {
  positions: Float32Array;
  uvs: Float32Array;

  // Cor por vertice (RGB): sombreamento por direcao da face (topo claro,
  // laterais mais escuras), como no pokeemerald-dualscreen.
  colors: Float32Array;

  // Indices: primeiro os quads com as DUAS camadas, depois os que so tem
  // camada de cima (topos de objetos, ver extendFoldMaskUpward). A malha da
  // camada de baixo desenha so os `fullIndexCount` primeiros.
  indices: Uint32Array;
  fullIndexCount: number;

  quadCount: number;
}

export type FoldStyle =
  // Ao ar livre: predios viram caixas com telhado; arvores, pedras e
  // penhascos viram fileiras de cartoes em pe (como no Faithful).
  | 'outdoor'
  // Interior: tudo vira caixa de topo plano. Parede do fundo com 2 tiles
  // de altura; moveis soltos (ate 2 linhas) com 1, mostrando o tampo.
  | 'interior';

export interface FoldOptions {
  style?: FoldStyle;

  // Ao ar livre, tudo vira caixa (montanhas, rochedos): sem cartoes.
  boxes?: boolean;

  // Predio a que o bloco pertence (ver computeBuildingIds), 0 = nenhum.
  // Predio ganha fachada unica e telhado com caimento leve.
  buildingAt?: (x: number, y: number) => number;

  // Bloco que so desenha a camada de cima (FOLD_OVERHANG).
  overlayOnly?: (x: number, y: number) => boolean;

  // Interior: chao andavel. Movel solto tem chao logo acima; a parede do
  // fundo encosta no topo do mapa ou no vazio.
  isFloor?: (x: number, y: number) => boolean;

  // Metatile de cada bloco: a altura das arvores sai da repeticao dele.
  metatileAt?: (x: number, y: number) => number;

  // Linhas de fachada de um trecho de predio (colunas x0..x1, linhas
  // y0..y1). Sem isto vale maxWallRows.
  facadeRowsFor?: (x0: number, x1: number, y0: number, y1: number) => number;

  // Montanhas: trecho de fachada "de dentro" (paredao sem quina) que as
  // laterais da caixa (colunas x0..x1, base y1) repetem, ida e volta.
  // Sem isto a lateral repete a coluna da quina.
  sideStripFor?: (x0: number, x1: number, y1: number) => SideStrip | null;
}

// Trecho de fachada usado nas laterais: colunas x0..x1, base na linha y1.
export interface SideStrip {
  x0: number;
  x1: number;
  y1: number;
}

// Brilho de cada face. Topo pleno; fachada (voltada para a camera) um
// pouco abaixo; laterais mais escuras, oeste mais que leste.
const SHADE_TOP = 1.0;
const SHADE_SOUTH = 0.88;
const SHADE_EAST = 0.8;
const SHADE_WEST = 0.7;

// Quanto o telhado de um predio sobe por linha de telhado, em tiles, e o
// maximo que ele sobe no total.
// 0: telhado plano, como os predios do Faithful (o desenho do GBA ja traz
// o caimento pintado).
const ROOF_PITCH = 0;
const MAX_ROOF_RISE = 1.0;

// Altura dos cartoes de arvore/pedra: cada linha mostra a si mesma e a de
// cima, em pe (2 tiles), como as arvores do Faithful.
const NATURAL_CARD_ROWS = 2;

// Objeto natural solto ate esta altura vira um cartao so; acima disso
// procura a repeticao do desenho (periodo de ate MAX_OBJECT_PERIOD).
const MAX_LONE_OBJECT_ROWS = 4;
const MAX_OBJECT_PERIOD = 4;

// Interior: sequencias com ate tantas linhas sao moveis (caixa de 1 tile).
const INTERIOR_FURNITURE_ROWS = 2;
const INTERIOR_WALL_ROWS = 3;

interface ColumnRun {
  y0: number;
  y1: number;

  // Pedaco que sobra na frente da fachada de um predio (entrada do
  // laboratorio, caixa de correio grudada): vira cartao, sem teto.
  card: boolean;

  // Quantas linhas do topo (a partir de y0) so tem camada de cima.
  overhangRows: number;
}

interface Run extends ColumnRun {
  x0: number;
  x1: number;
}

/**
 * Geometria do volume de um mapa (ou de um predio so).
 *
 * @param isSolid  bloco que deve ganhar volume
 * @param maxWallRows  altura maxima da fachada dos predios, em blocos
 */
export function buildFoldGeometry(
  width: number,
  height: number,
  isSolid: (x: number, y: number) => boolean,
  maxWallRows: number,
  options: FoldOptions = {},
): FoldGeometryData {
  const style = options.style ?? 'outdoor';
  const buildingAt = options.buildingAt;
  const overlayOnly = options.overlayOnly;

  // 1) Sequencias verticais por coluna.
  const columns: ColumnRun[][] = [];

  for (let x = 0; x < width; x++) {
    const runs: ColumnRun[] = [];
    let start = -1;

    for (let y = 0; y <= height; y++) {
      const solid =
        y < height && isSolid(x, y);

      if (solid && start < 0) {
        start = y;
      } else if (!solid && start >= 0) {
        runs.push({ y0: start, y1: y - 1, card: false, overhangRows: 0 });
        start = -1;
      }
    }

    columns.push(runs);
  }

  // 1b) Fachada unica por predio: a borda sul mais comum entre as colunas;
  //     o que passa dela (entrada do laboratorio de Littleroot) vira
  //     cartao. Sem isso a coluna mais comprida dobrava deslocada.
  if (buildingAt) {
    const southVotes = new Map<number, Map<number, number>>();

    for (let x = 0; x < width; x++) {
      for (const run of columns[x]) {
        const id = buildingAt(x, run.y1);

        if (id <= 0) {
          continue;
        }

        const votes = southVotes.get(id) ?? new Map<number, number>();
        votes.set(run.y1, (votes.get(run.y1) ?? 0) + 1);
        southVotes.set(id, votes);
      }
    }

    const southEdge = new Map<number, number>();

    for (const [id, votes] of southVotes) {
      let best = -1;
      let bestCount = 0;

      for (const [y1, count] of votes) {
        if (count > bestCount || (count === bestCount && y1 < best)) {
          best = y1;
          bestCount = count;
        }
      }

      southEdge.set(id, best);
    }

    for (let x = 0; x < width; x++) {
      const split: ColumnRun[] = [];

      for (const run of columns[x]) {
        const edge = southEdge.get(buildingAt(x, run.y1));

        if (edge === undefined || run.y1 <= edge || run.y0 > edge) {
          split.push(run);
          continue;
        }

        split.push({ y0: run.y0, y1: edge, card: false, overhangRows: 0 });
        split.push({ y0: edge + 1, y1: run.y1, card: true, overhangRows: 0 });
      }

      columns[x] = split;
    }
  }

  // 1c) Linhas do topo que so tem camada de cima.
  if (overlayOnly) {
    for (let x = 0; x < width; x++) {
      for (const run of columns[x]) {
        let rows = 0;

        while (run.y0 + rows <= run.y1 && overlayOnly(x, run.y0 + rows)) {
          rows++;
        }

        run.overhangRows = rows;
      }
    }
  }

  // 2) Junta colunas vizinhas com a MESMA sequencia num unico bloco: menos
  //    geometria e sem costura entre colunas da mesma casa.
  const merged: Run[] = [];
  const open = new Map<string, Run>();

  for (let x = 0; x < width; x++) {
    const next = new Map<string, Run>();

    for (const run of columns[x]) {
      const isBuilding =
        (buildingAt?.(x, run.y1) ?? 0) > 0;

      const key =
        run.y0 + ':' + run.y1 + ':' + (run.card ? 1 : 0) + ':' +
        run.overhangRows + ':' + (isBuilding ? 1 : 0);

      const previous = open.get(key);

      if (previous && previous.x1 === x - 1) {
        previous.x1 = x;
        next.set(key, previous);
      } else {
        const created: Run = { ...run, x0: x, x1: x };
        merged.push(created);
        next.set(key, created);
      }
    }

    open.clear();

    for (const [key, run] of next) {
      open.set(key, run);
    }
  }

  // 3) Quads.
  const positions: number[] = [];
  const uvs: number[] = [];
  const colors: number[] = [];
  const fullIndices: number[] = [];
  const overlayIndices: number[] = [];

  // v da textura: o mapa e assado de baixo para cima, entao a borda SUL
  // da linha r fica em v = (H-1-r)/H e a borda NORTE em (H-r)/H.
  const vSouth = (row: number): number => (height - 1 - row) / height;
  const vNorth = (row: number): number => (height - row) / height;
  const u = (column: number): number => column / width;

  const quad = (
    corners: Array<[number, number, number]>,
    cornerUvs: Array<[number, number]>,
    shade: number,
    onlyOverlay = false,
  ): void => {
    const base = positions.length / 3;

    for (let index = 0; index < 4; index++) {
      positions.push(...corners[index]);
      uvs.push(...cornerUvs[index]);
      colors.push(shade, shade, shade);
    }

    (onlyOverlay ? overlayIndices : fullIndices).push(
      base, base + 1, base + 2, base, base + 2, base + 3,
    );
  };

  // Quad em pe, voltado para o sul, mostrando a linha `row` entre as
  // alturas hBottom e hTop no plano z.
  const standing = (
    left: number,
    right: number,
    z: number,
    hBottom: number,
    hTop: number,
    row: number,
    shade: number,
    onlyOverlay: boolean,
  ): void => {
    quad(
      [
        [left, hBottom, z],
        [right, hBottom, z],
        [right, hTop, z],
        [left, hTop, z],
      ],
      [
        [u(left), vSouth(row)],
        [u(right), vSouth(row)],
        [u(right), vNorth(row)],
        [u(left), vNorth(row)],
      ],
      shade,
      onlyOverlay,
    );
  };

  // Altura (em linhas) de cada objeto natural de uma sequencia.
  const objectHeight = (run: Run): number => {
    const rows = run.y1 - run.y0 + 1;
    const metatileAt = options.metatileAt;

    if (rows <= MAX_LONE_OBJECT_ROWS || !metatileAt) {
      return Math.max(1, Math.min(rows, MAX_LONE_OBJECT_ROWS));
    }

    for (let period = 2; period <= MAX_OBJECT_PERIOD; period++) {
      let same = 0;
      let total = 0;

      for (let x = run.x0; x <= run.x1; x++) {
        for (let y = run.y0 + period; y <= run.y1; y++) {
          total++;

          if (metatileAt(x, y) === metatileAt(x, y - period)) {
            same++;
          }
        }
      }

      if (total > 0 && same * 10 >= total * 7) {
        return period;
      }
    }

    return NATURAL_CARD_ROWS;
  };

  for (const run of merged) {
    const left = run.x0;
    const right = run.x1 + 1;

    // Ultima linha (de cima para baixo) que so tem camada de cima.
    const overhangEnd = run.y0 + run.overhangRows - 1;
    const isOverhangRow = (row: number): boolean => row <= overhangEnd;

    const building =
      (buildingAt?.(run.x0, run.y1) ?? 0) > 0;

    // ---- arvores, pedras, penhascos, placas, cercas: cartoes em pe ----
    // Cada objeto vira UM cartao em pe na borda sul da sua linha de baixo.
    // A altura do objeto sai do proprio desenho: numa mata o padrao de
    // metatiles se repete a cada N linhas (arvore de 2 linhas na borda da
    // Route 1, de 3 nas arvores soltas); a sequencia e cortada nesse
    // periodo a partir de baixo (a linha de baixo e sempre tronco). Objeto
    // solto (sem repeticao) e um cartao so com a altura inteira. O fundo
    // do desenho e recortado na textura dos modelos (GroundSubstitution).
    if (style === 'outdoor' && !building && !run.card && !options.boxes) {
      const unit =
        objectHeight(run);

      for (let bottom = run.y1; bottom >= run.y0; bottom -= unit) {
        const z = bottom + 1;

        for (let level = 0; level < unit; level++) {
          const row = bottom - level;

          if (row < run.y0) {
            break;
          }

          standing(left, right, z, level, level + 1, row, 1, isOverhangRow(row));
        }
      }

      continue;
    }

    // ---- caixas: predios (fora) e tudo no interior ----
    const rows = run.y1 - run.y0 + 1;

    const furniture =
      style === 'interior' &&
      rows <= INTERIOR_FURNITURE_ROWS &&
      run.y0 > 0 &&
      !!options.isFloor?.(run.x0, run.y0 - 1);

    // Parede do fundo do interior em pe inteira (ate 3 linhas): os moveis
    // encostados nela entram na mesma sequencia e ficariam deitados no
    // topo de uma parede baixa.
    const wallLimit =
      furniture
        ? 1
        : style === 'interior'
          ? INTERIOR_WALL_ROWS
          : building && options.facadeRowsFor && !run.card
            ? options.facadeRowsFor(run.x0, run.x1, run.y0, run.y1)
            : maxWallRows;

    const wall = Math.min(rows, wallLimit);
    const roofRows = run.card ? 0 : rows - wall;

    const southZ = run.y1 + 1;
    const northZ = southZ - roofRows;

    const pitched =
      ROOF_PITCH > 0 && building && style === 'outdoor' && roofRows > 0;

    const pitch =
      Math.min(ROOF_PITCH, MAX_ROOF_RISE / Math.max(1, roofRows));

    const topAt = (z: number): number =>
      pitched
        ? wall + (southZ - z) * pitch
        : wall;

    // Parede: linhas (y1-wall+1 .. y1), em pe na borda sul; a linha r fica
    // entre as alturas (y1-r) e (y1-r+1).
    const wallTopRow = run.y1 - wall + 1;

    for (let row = wallTopRow; row <= run.y1; row++) {
      standing(
        left,
        right,
        southZ,
        run.y1 - row,
        run.y1 - row + 1,
        row,
        SHADE_SOUTH,
        isOverhangRow(row),
      );
    }

    if (roofRows === 0) {
      continue;
    }

    // Teto: linhas (y0 .. y1-wall), encostado no topo da parede; a linha r
    // fica em z = northZ + (r - y0). Uma faixa por linha (o topo de
    // objeto, so com camada de cima, fica numa faixa propria).
    const roofBottomRow = run.y1 - wall;

    for (let row = run.y0; row <= roofBottomRow; row++) {
      const zNorth = northZ + (row - run.y0);
      const zSouth = zNorth + 1;

      quad(
        [
          [left, topAt(zSouth), zSouth],
          [right, topAt(zSouth), zSouth],
          [right, topAt(zNorth), zNorth],
          [left, topAt(zNorth), zNorth],
        ],
        [
          [u(left), vSouth(row)],
          [u(right), vSouth(row)],
          [u(right), vNorth(row)],
          [u(left), vNorth(row)],
        ],
        SHADE_TOP,
        isOverhangRow(row),
      );
    }

    // Laterais: repetem a FACHADA da coluna da quina, espelhada para casar
    // na quina. Comecam na primeira linha "de verdade" do teto.
    const facadeBottomV = vSouth(run.y1);
    const facadeTopV = vNorth(wallTopRow);

    // Empena (da parede ate o telhado inclinado): cor lisa, o texel do
    // meio do topo da fachada da quina.
    const gableWestU = u(left) + 0.5 / width;
    const gableEastU = u(right) - 0.5 / width;
    const gableV = facadeTopV - 0.5 / (height * 16);

    // Coluna da fachada repetida nas laterais: a segunda a partir da quina
    // (janelas, parede) quando o predio e largo; a quina tem a coluna do
    // canto e repetida virava listras de pilar.
    const runWidth = right - left;
    const sideWest = runWidth >= 3 ? left + 1 : left;
    const sideEast = runWidth >= 3 ? right - 2 : right - 1;

    const firstSolidRoofRow =
      Math.min(Math.max(run.y0, overhangEnd + 1), roofBottomRow + 1);

    const sideNorthZ = northZ + (firstSolidRoofRow - run.y0);

    // Montanha: as laterais continuam o paredao (um trecho de fachada sem
    // quina, ida e volta, sem emenda). Repetir a coluna da quina fazia
    // listras e, na quina arredondada com mar ou areia no desenho,
    // "dentes" pontudos ao longo da lateral.
    const strip =
      options.boxes && !building ? options.sideStripFor?.(run.x0, run.x1, run.y1) ?? null : null;

    const stripLength = strip ? strip.x1 - strip.x0 + 1 : 0;
    const stripBottomV = strip ? vSouth(strip.y1) : facadeBottomV;
    const stripTopV = strip ? vNorth(strip.y1 - wall + 1) : facadeTopV;

    // Coluna do trecho no segmento k (0 = na quina) e o sentido: na ida a
    // borda sul do segmento e a esquerda da coluna; na volta, a direita.
    const stripColumn = (k: number): [number, number] => {
      const t = k % (2 * stripLength);

      if (t < stripLength) {
        const column = (strip as SideStrip).x0 + t;

        return [u(column), u(column + 1)];
      }

      const column = (strip as SideStrip).x1 - (t - stripLength);

      return [u(column + 1), u(column)];
    };

    for (let z = sideNorthZ; z < southZ; z++) {
      const [westSouthU, westNorthU] = strip
        ? stripColumn(southZ - 1 - z)
        : [u(sideWest), u(sideWest + 1)];

      const [eastSouthU, eastNorthU] = strip
        ? stripColumn(southZ - 1 - z)
        : [u(sideEast), u(sideEast + 1)];

      quad(
        [
          [left, 0, z],
          [left, 0, z + 1],
          [left, wall, z + 1],
          [left, wall, z],
        ],
        [
          [westNorthU, stripBottomV],
          [westSouthU, stripBottomV],
          [westSouthU, stripTopV],
          [westNorthU, stripTopV],
        ],
        SHADE_WEST,
      );

      quad(
        [
          [right, 0, z + 1],
          [right, 0, z],
          [right, wall, z],
          [right, wall, z + 1],
        ],
        [
          [eastSouthU, stripBottomV],
          [eastNorthU, stripBottomV],
          [eastNorthU, stripTopV],
          [eastSouthU, stripTopV],
        ],
        SHADE_EAST,
      );

      if (!pitched) {
        continue;
      }

      quad(
        [
          [left, wall, z],
          [left, wall, z + 1],
          [left, topAt(z + 1), z + 1],
          [left, topAt(z), z],
        ],
        [
          [gableWestU, gableV],
          [gableWestU, gableV],
          [gableWestU, gableV],
          [gableWestU, gableV],
        ],
        SHADE_WEST,
      );

      quad(
        [
          [right, wall, z + 1],
          [right, wall, z],
          [right, topAt(z), z],
          [right, topAt(z + 1), z + 1],
        ],
        [
          [gableEastU, gableV],
          [gableEastU, gableV],
          [gableEastU, gableV],
          [gableEastU, gableV],
        ],
        SHADE_EAST,
      );
    }

    // Fundo do predio inclinado, na cor lisa da empena.
    if (pitched) {
      quad(
        [
          [right, 0, sideNorthZ],
          [left, 0, sideNorthZ],
          [left, topAt(sideNorthZ), sideNorthZ],
          [right, topAt(sideNorthZ), sideNorthZ],
        ],
        [
          [gableWestU, gableV],
          [gableWestU, gableV],
          [gableWestU, gableV],
          [gableWestU, gableV],
        ],
        SHADE_WEST,
      );
    }
  }

  return {
    positions: new Float32Array(positions),
    uvs: new Float32Array(uvs),
    colors: new Float32Array(colors),
    indices: new Uint32Array([...fullIndices, ...overlayIndices]),
    fullIndexCount: fullIndices.length,
    quadCount: (fullIndices.length + overlayIndices.length) / 6,
  };
}

// Ledge: faixa em pe com a parte de baixo do tile (a borda marrom).
const LEDGE_TEXTURE_ROWS = 7 / 16;
const LEDGE_HEIGHT = LEDGE_TEXTURE_ROWS;

// Grama alta: tufo em pe na borda sul do tile, cobrindo os pes de quem
// esta nele (como no GBA, onde a grama cobre a metade de baixo).
// Metade de baixo do tile, sem esticar.
const GRASS_TEXTURE_ROWS = 8 / 16;
const GRASS_HEIGHT = GRASS_TEXTURE_ROWS;

/**
 * Detalhes de chao em pe: ledges (faixa baixa) e grama alta (tufos).
 * Quads de duas camadas, na mesma convencao de buildFoldGeometry.
 */
export function buildGroundDetails(
  width: number,
  height: number,
  isLedge: (x: number, y: number) => boolean,
  isTallGrass: (x: number, y: number) => boolean,
): FoldGeometryData {
  const positions: number[] = [];
  const uvs: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];

  const vSouth = (row: number): number => (height - 1 - row) / height;
  const u = (column: number): number => column / width;

  const strip = (
    left: number,
    right: number,
    row: number,
    hTop: number,
    textureRows: number,
  ): void => {
    const base = positions.length / 3;
    const z = row + 1;
    const vBottom = vSouth(row);
    const vTop = vBottom + textureRows / height;

    positions.push(
      left, 0, z,
      right, 0, z,
      right, hTop, z,
      left, hTop, z,
    );

    uvs.push(
      u(left), vBottom,
      u(right), vBottom,
      u(right), vTop,
      u(left), vTop,
    );

    for (let corner = 0; corner < 4; corner++) {
      colors.push(SHADE_SOUTH, SHADE_SOUTH, SHADE_SOUTH);
    }

    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  };

  for (let y = 0; y < height; y++) {
    for (const [test, hTop, textureRows] of [
      [isLedge, LEDGE_HEIGHT, LEDGE_TEXTURE_ROWS],
      [isTallGrass, GRASS_HEIGHT, GRASS_TEXTURE_ROWS],
    ] as const) {
      let x = 0;

      while (x < width) {
        if (!test(x, y)) {
          x++;
          continue;
        }

        const left = x;

        while (x < width && test(x, y)) {
          x++;
        }

        strip(left, x, y, hTop, textureRows);
      }
    }
  }

  return {
    positions: new Float32Array(positions),
    uvs: new Float32Array(uvs),
    colors: new Float32Array(colors),
    indices: new Uint32Array(indices),
    fullIndexCount: indices.length,
    quadCount: indices.length / 6,
  };
}

export interface GroundPatchData {
  positions: Float32Array;
  uvs: Float32Array;
  indices: Uint32Array;
}

// Altura do remendo: acima do chao (0) e da camada de cima do chao (0.002,
// com polygonOffset), com folga para a precisao do depth buffer.
const PATCH_HEIGHT = 0.01;

/**
 * Remendo de chao debaixo do que foi dobrado.
 *
 * O desenho original da casa continua na textura do chao. A parte coberta
 * pelo volume nao aparece, mas a de tras (as linhas do telhado, que
 * subiram e foram para o sul) aparecia pelos lados: uma copia achatada do
 * telhado ao lado da casa 3D. Cobre cada bloco dobrado com o tile de chao
 * `ground` (uma celula do proprio mapa, na mesma textura - a animacao de
 * tiles continua valendo).
 */
export function buildGroundPatch(
  width: number,
  height: number,
  mask: Uint8Array,
  ground: { x: number; y: number },
): GroundPatchData {
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  const u0 = ground.x / width;
  const u1 = (ground.x + 1) / width;
  const vS = (height - 1 - ground.y) / height;
  const vN = (height - ground.y) / height;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!mask[y * width + x]) {
        continue;
      }

      const base = positions.length / 3;

      positions.push(
        x, PATCH_HEIGHT, y + 1,
        x + 1, PATCH_HEIGHT, y + 1,
        x + 1, PATCH_HEIGHT, y,
        x, PATCH_HEIGHT, y,
      );

      uvs.push(u0, vS, u1, vS, u1, vN, u0, vN);
      indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
  }

  return {
    positions: new Float32Array(positions),
    uvs: new Float32Array(uvs),
    indices: new Uint32Array(indices),
  };
}

/**
 * Tile de chao do mapa: o metatile passavel mais comum longe de qualquer
 * bloco dobrado e fora da agua. Devolve uma celula onde ele aparece.
 */
export function findGroundCell(
  width: number,
  height: number,
  mask: Uint8Array,
  blockAt: (x: number, y: number) => { metatileId: number; collision: number; elevation: number } | undefined,
): { x: number; y: number } | null {
  const counts = new Map<number, { count: number; x: number; y: number }>();

  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const block = blockAt(x, y);

      if (!block || block.collision !== 0 || block.elevation === 1) {
        continue;
      }

      let nearFold = false;

      for (let dy = -1; dy <= 1 && !nearFold; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (mask[(y + dy) * width + x + dx]) {
            nearFold = true;
            break;
          }
        }
      }

      if (nearFold) {
        continue;
      }

      const entry = counts.get(block.metatileId);

      if (entry) {
        entry.count++;
      } else {
        counts.set(block.metatileId, { count: 1, x, y });
      }
    }
  }

  let best: { count: number; x: number; y: number } | null = null;

  for (const entry of counts.values()) {
    if (!best || entry.count > best.count) {
      best = entry;
    }
  }

  return best ? { x: best.x, y: best.y } : null;
}

// Maior predio aceito, em tiles. Penhasco com entrada de caverna tambem tem
// warp; o limite evita dar caimento de telhado a uma serra inteira.
const MAX_BUILDING_WIDTH = 16;
const MAX_BUILDING_HEIGHT = 10;

/**
 * Qual PREDIO cada bloco com volume e (1, 2, ...; 0 = nao e predio).
 *
 * Usa um dado do proprio ROM em vez de catalogar tiles de cada jogo: as
 * portas sao warps no cabecalho do mapa. Um grupo conectado de blocos com
 * volume que contem um warp (ou tem um logo ao sul, quando a porta e
 * passavel) e um predio; arvores e penhascos nao tem porta.
 */
export function computeBuildingIds(
  width: number,
  height: number,
  foldMask: Uint8Array,
  warps: ReadonlyArray<{ x: number; y: number }>,
): Int32Array {
  const warpAt = new Uint8Array(width * height);

  for (const warp of warps) {
    if (warp.x >= 0 && warp.y >= 0 && warp.x < width && warp.y < height) {
      warpAt[warp.y * width + warp.x] = 1;
    }
  }

  const building = new Int32Array(width * height);
  const visited = new Uint8Array(width * height);
  let nextId = 1;

  for (let start = 0; start < foldMask.length; start++) {
    if (!isVolumeCell(foldMask[start]) || visited[start]) {
      continue;
    }

    const component: number[] = [];
    const stack = [start];
    visited[start] = 1;

    let hasDoor = false;
    let minX = width;
    let maxX = -1;
    let minY = height;
    let maxY = -1;

    while (stack.length > 0) {
      const cell = stack.pop() as number;
      const x = cell % width;
      const y = (cell - x) / width;

      component.push(cell);
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);

      if (warpAt[cell] || (y + 1 < height && warpAt[cell + width])) {
        hasDoor = true;
      }

      const neighbors = [
        x > 0 ? cell - 1 : -1,
        x + 1 < width ? cell + 1 : -1,
        y > 0 ? cell - width : -1,
        y + 1 < height ? cell + width : -1,
      ];

      for (const next of neighbors) {
        if (next >= 0 && isVolumeCell(foldMask[next]) && !visited[next]) {
          visited[next] = 1;
          stack.push(next);
        }
      }
    }

    if (
      hasDoor &&
      maxX - minX + 1 <= MAX_BUILDING_WIDTH &&
      maxY - minY + 1 <= MAX_BUILDING_HEIGHT
    ) {
      const id = nextId++;

      for (const cell of component) {
        building[cell] = id;
      }
    }
  }

  return building;
}

export interface VolumeBlock {
  metatileId: number;
  collision: number;
  elevation: number;
  behavior: number;

  // O metatile tem pixels na camada de cima.
  hasForeground: boolean;

  // A camada de cima (qualquer layerType) tem pixels na linha de baixo do
  // tile: o desenho continua no bloco de baixo (topo de arvore, de telhado,
  // de vaso). Quando presente, decide os topos de objeto no lugar de
  // hasForeground - topos em metatiles COVERED (copas da Viridian Forest)
  // ficavam no chao.
  topReachesBottom?: boolean;

  // A camada de cima usa os tiles de flor animados do tileset geral.
  flower?: boolean;

  // Pixels da camada de baixo do metatile (16x16 RGBA), para medir quantas
  // linhas de um predio sao fachada.
  basePixels?: Uint8ClampedArray;

  // Desenho completo (as duas camadas), para medir cores e repeticao.
  pixels?: Uint8ClampedArray;

  // Metatile do tileset SECUNDARIO (o da cidade). Na Gen 3 os predios de
  // cada cidade ficam nele; arvores, cercas e placas, no primario.
  secondary?: boolean;

  // Bloco solido que virou chao de um modelo 3D pequeno (cerca, cercado,
  // caixote): sem volume, mas ocupado - nao conta como chao aberto em volta
  // da natureza solta.
  solidModel?: boolean;
}

// Fachada de predio: limites de linhas em pe.
const MIN_FACADE_ROWS = 1;
const MAX_FACADE_ROWS = 6;

// Semelhanca minima (0..1) entre as cores de uma linha e as da linha da
// porta para a linha contar como parede.
const FACADE_SIMILARITY = 0.45;
const FACADE_SECOND_ROW_SIMILARITY = 0.25;

function colorHistogram(
  pixels: Array<Uint8ClampedArray | undefined>,
): Map<number, number> {
  const histogram = new Map<number, number>();

  for (const cell of pixels) {
    if (!cell) {
      continue;
    }

    for (let offset = 0; offset < cell.length; offset += 4) {
      if (cell[offset + 3] < 128) {
        continue;
      }

      // 4 bits por canal: tons quase iguais contam como a mesma cor.
      const key =
        ((cell[offset] >> 4) << 8) |
        ((cell[offset + 1] >> 4) << 4) |
        (cell[offset + 2] >> 4);

      histogram.set(key, (histogram.get(key) ?? 0) + 1);
    }
  }

  return histogram;
}

function histogramSimilarity(
  a: Map<number, number>,
  b: Map<number, number>,
): number {
  let totalA = 0;
  let totalB = 0;
  let shared = 0;

  for (const value of a.values()) {
    totalA += value;
  }

  for (const value of b.values()) {
    totalB += value;
  }

  if (totalA === 0 || totalB === 0) {
    return 0;
  }

  for (const [key, value] of a) {
    const other = b.get(key);

    if (other !== undefined) {
      shared += Math.min(value / totalA, other / totalB);
    }
  }

  return shared;
}

/**
 * Quantas linhas de baixo de um predio sao FACHADA (parede em pe), pelas
 * cores: sobe a partir da linha da porta enquanto a linha se parece com
 * ela. O Centro Pokemon para no telhado vermelho; a loja de departamentos
 * de Celadon sobe andar por andar, como no Faithful.
 */
function measureFacadeRows(
  cells: Array<{ x: number; y: number }>,
  blockAt: (x: number, y: number) => VolumeBlock | undefined,
): number {
  // Borda sul mais comum entre as colunas.
  const bottoms = new Map<number, number>();

  for (const cell of cells) {
    bottoms.set(cell.x, Math.max(bottoms.get(cell.x) ?? -1, cell.y));
  }

  const votes = new Map<number, number>();

  for (const bottom of bottoms.values()) {
    votes.set(bottom, (votes.get(bottom) ?? 0) + 1);
  }

  let edge = -1;
  let best = 0;

  for (const [bottom, count] of votes) {
    if (count > best) {
      edge = bottom;
      best = count;
    }
  }

  const top =
    Math.min(...cells.map((cell) => cell.y));

  const rowCells = (row: number): Array<Uint8ClampedArray | undefined> =>
    cells
      .filter((cell) => cell.y === row)
      .map((cell) => blockAt(cell.x, cell.y)?.basePixels);

  const reference =
    colorHistogram(rowCells(edge));

  let rows = 1;

  for (let row = edge - 1; row > top; row--) {
    // A segunda linha (logo acima da porta) entra com menos semelhanca: em
    // casas pequenas ela mistura parede e beiral. Daí para cima so entra
    // linha bem parecida (andares de predio alto).
    const needed =
      rows === 1 ? FACADE_SECOND_ROW_SIMILARITY : FACADE_SIMILARITY;

    if (
      rows >= MAX_FACADE_ROWS ||
      histogramSimilarity(colorHistogram(rowCells(row)), reference) < needed
    ) {
      break;
    }

    rows++;
  }

  // Sempre sobra pelo menos uma linha de telhado.
  return Math.max(MIN_FACADE_ROWS, Math.min(rows, edge - top));
}

export interface BuildingVolume {
  id: number;

  // Celulas ocupadas (inclusive), em tiles do mapa.
  x0: number;
  y0: number;
  x1: number;
  y1: number;

  // Linhas de fachada em pe (medidas pelas cores).
  facadeRows: number;

  geometry: FoldGeometryData;
}

// O que cada bloco do mapa vira (MapVolume.kinds).
//
// So ESTRUTURAS sao 3D de verdade (caixas): predios, montanhas e rochedos,
// paredes e moveis de interior. Arvores, cercas, placas, grama alta e
// flores sao OBJETOS 2D em pe, como os sprites: o desenho do GBA num
// cartao vertical, esticado na vertical como o personagem (ver
// PlayerRenderer.getUprightSpriteScale), que tapa e e tapado pelo que
// estiver na frente ou atras dele.
export const CELL_GROUND = 0;
export const CELL_STRUCTURE = 1;
// Topo de estrutura que so tem camada de cima (cumeeira do telhado).
export const CELL_STRUCTURE_TOP = 2;
export const CELL_PROP = 3;
// Topo de objeto que so tem camada de cima (copa sobre a grama).
export const CELL_PROP_TOP = 4;
export const CELL_LEDGE = 5;
export const CELL_GRASS = 6;
// Flor: so a camada de cima fica em pe; a de baixo (grama) e chao.
export const CELL_FLOWER = 7;

/** Bloco inteiro coberto por modelo: o chao debaixo dele e trocado. */
export function isCoveredKind(kind: number): boolean {
  return (
    kind === CELL_STRUCTURE ||
    kind === CELL_PROP ||
    kind === CELL_LEDGE ||
    kind === CELL_GRASS
  );
}

/** Bloco cujo chao fica so com a camada de baixo (a de cima subiu). */
export function isTopOnlyKind(kind: number): boolean {
  return (
    kind === CELL_STRUCTURE_TOP ||
    kind === CELL_PROP_TOP ||
    kind === CELL_FLOWER
  );
}

export interface MapVolume {
  // Mascara da dobra (FOLD_*).
  mask: Uint8Array;

  // O que cada bloco virou (CELL_*).
  kinds: Uint8Array;

  // Predio de cada bloco (0 = nenhum).
  buildingIds: Int32Array;

  // Bloco de chao que vai debaixo de cada bloco coberto (-1 = nenhum).
  groundSources: Int32Array;

  // Caixas 3D: predios, montanhas, interiores.
  structures: FoldGeometryData;

  // Ledges (faixa baixa, sem esticar).
  details: FoldGeometryData;

  buildings: BuildingVolume[];
}

function emptyFoldGeometry(): FoldGeometryData {
  return {
    positions: new Float32Array(0),
    uvs: new Float32Array(0),
    colors: new Float32Array(0),
    indices: new Uint32Array(0),
    fullIndexCount: 0,
    quadCount: 0,
  };
}

/**
 * Junta varias geometrias numa so. Com a textura unica dos modelos (os
 * topos ja vem so com a camada de cima) todos os quads usam a mesma
 * textura: os indices de camada de cima viram indices comuns.
 */
export function mergeFoldGeometries(
  parts: FoldGeometryData[],
): FoldGeometryData {
  const used = parts.filter((part) => part.quadCount > 0);

  if (used.length === 0) {
    return emptyFoldGeometry();
  }

  let vertexCount = 0;
  let indexCount = 0;

  for (const part of used) {
    vertexCount += part.positions.length / 3;
    indexCount += part.indices.length;
  }

  const positions = new Float32Array(vertexCount * 3);
  const uvs = new Float32Array(vertexCount * 2);
  const colors = new Float32Array(vertexCount * 3);
  const indices = new Uint32Array(indexCount);
  let vertexOffset = 0;
  let indexOffset = 0;

  for (const part of used) {
    positions.set(part.positions, vertexOffset * 3);
    uvs.set(part.uvs, vertexOffset * 2);
    colors.set(part.colors, vertexOffset * 3);

    for (let index = 0; index < part.indices.length; index++) {
      indices[indexOffset + index] = part.indices[index] + vertexOffset;
    }

    vertexOffset += part.positions.length / 3;
    indexOffset += part.indices.length;
  }

  return {
    positions,
    uvs,
    colors,
    indices,
    fullIndexCount: indices.length,
    quadCount: indices.length / 6,
  };
}

// Montanha/rochedo: desenho com menos que esta fracao de pixels verdes.
const ROCK_GREEN_FRACTION = 0.3;

// Montanha e grande e grossa: pelo menos tantos blocos, com um quadrado
// MASS_CORE x MASS_CORE inteiro. Grupos menores que nao sao verdes (pedra
// solta, bicicletas da loja de Mauville, estatua pequena) ficam objetos em
// pe.
const MASS_MIN_CELLS = 16;
const MASS_CORE = 3;

const rgbKey = (pixels: Uint8ClampedArray, offset: number): number =>
  (pixels[offset] << 16) | (pixels[offset + 1] << 8) | pixels[offset + 2];

/**
 * Blocos que sao MONTANHA ou ROCHEDO (estrutura 3D, nao objeto em pe):
 * grupo de blocos solidos sem predio, com desenho que nao e verde (pedra,
 * terra, penhasco), grande e grosso (ver MASS_MIN_CELLS). Cercas e
 * placas tambem nao sao verdes, mas sao finas: continuam objetos em pe.
 * Os topos (so camada de cima) logo acima entram junto.
 */
/**
 * Trecho de paredao de cada montanha para as laterais: a sequencia mais
 * longa de colunas da fachada (linha de baixo de uma coluna da massa, com
 * a linha de cima tambem na massa) sem quina - massa dos dois lados nas
 * linhas da fachada. Na falta, a mais longa de qualquer montanha do mapa
 * com o mesmo desenho, ou nenhuma (fica a coluna da quina).
 */
function massSideStrips(
  width: number,
  height: number,
  masses: Uint8Array,
  wallRows: number,
  metatileAt: (x: number, y: number) => number,
): (x0: number, x1: number, y1: number) => SideStrip | null {
  const solid = (x: number, y: number): boolean =>
    x >= 0 && y >= 0 && x < width && y < height && masses[y * width + x] === 1;

  // Montanha de cada bloco.
  const component = new Int32Array(width * height).fill(-1);
  let count = 0;

  for (let start = 0; start < masses.length; start++) {
    if (masses[start] !== 1 || component[start] >= 0) {
      continue;
    }

    const stack = [start];
    component[start] = count;

    while (stack.length > 0) {
      const cell = stack.pop() as number;
      const x = cell % width;
      const y = (cell - x) / width;

      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx;
        const ny = y + dy;

        if (solid(nx, ny) && component[ny * width + nx] < 0) {
          component[ny * width + nx] = count;
          stack.push(ny * width + nx);
        }
      }
    }

    count++;
  }

  // Coluna x com fachada "de dentro" na linha y (base da coluna). Na borda
  // de baixo do mapa a montanha continua no vizinho: ali nao ha fachada (o
  // trecho seria o topo da pedra).
  const interior = (x: number, y: number): boolean => {
    if (y >= height - 1 || !solid(x, y) || solid(x, y + 1)) {
      return false;
    }

    for (let row = y - wallRows + 1; row <= y; row++) {
      if (!solid(x - 1, row) || !solid(x, row) || !solid(x + 1, row)) {
        return false;
      }
    }

    return true;
  };

  const best: Array<SideStrip | null> = new Array(count).fill(null);

  for (let y = 0; y < height; y++) {
    let x = 0;

    while (x < width) {
      if (!interior(x, y)) {
        x++;
        continue;
      }

      const x0 = x;

      while (x < width && interior(x, y) && component[y * width + x] === component[y * width + x0]) {
        x++;
      }

      const strip: SideStrip = { x0, x1: x - 1, y1: y };
      const id = component[y * width + x0];
      const current = best[id];

      if (!current || strip.x1 - strip.x0 > current.x1 - current.x0) {
        best[id] = strip;
      }
    }
  }

  // Montanha sem paredao proprio (rochedo pequeno): o de outra montanha
  // com o mesmo metatile na base.
  const byMetatile = new Map<number, SideStrip>();

  for (const strip of best) {
    if (strip) {
      const id = metatileAt(strip.x0, strip.y1);
      const known = byMetatile.get(id);

      if (!known || strip.x1 - strip.x0 > known.x1 - known.x0) {
        byMetatile.set(id, strip);
      }
    }
  }

  return (x0, _x1, y1) => {
    const id = component[y1 * width + x0];

    if (id < 0) {
      return null;
    }

    return best[id] ?? byMetatile.get(metatileAt(x0, y1)) ?? null;
  };
}

function findRockMasses(
  width: number,
  height: number,
  mask: Uint8Array,
  buildingIds: Int32Array,
  blockAt: (x: number, y: number) => VolumeBlock | undefined,
  sources: Int32Array,
): Uint8Array {
  const rocky = new Uint8Array(width * height);
  const colorCache = new Map<number, Set<number>>();
  const verdicts = new Map<number, boolean>();

  const groundColors = (source: number): Set<number> => {
    const cached = colorCache.get(source);

    if (cached) {
      return cached;
    }

    const colors = new Set<number>();
    const block = blockAt(source % width, Math.floor(source / width));
    const pixels = block?.pixels ?? block?.basePixels;

    if (pixels) {
      for (let offset = 0; offset < pixels.length; offset += 4) {
        if (pixels[offset + 3] >= 128) {
          colors.add(rgbKey(pixels, offset));
        }
      }
    }

    colorCache.set(source, colors);

    return colors;
  };

  for (let index = 0; index < mask.length; index++) {
    if (mask[index] !== FOLD_SOLID || buildingIds[index] !== 0) {
      continue;
    }

    const block = blockAt(index % width, Math.floor(index / width));
    const pixels = block?.pixels ?? block?.basePixels;

    if (!pixels) {
      continue;
    }

    // Mesmo metatile sobre o mesmo chao: mesma resposta.
    const sourceId =
      sources[index] >= 0
        ? (blockAt(sources[index] % width, Math.floor(sources[index] / width))?.metatileId ?? -1) + 1
        : 0;

    const key = (block?.metatileId ?? 0) * 4096 + sourceId;
    const known = verdicts.get(key);

    if (known !== undefined) {
      rocky[index] = known ? 1 : 0;
      continue;
    }

    const colors =
      sources[index] >= 0 ? groundColors(sources[index]) : new Set<number>();

    let object = 0;
    let green = 0;

    for (let offset = 0; offset < pixels.length; offset += 4) {
      if (pixels[offset + 3] < 128 || colors.has(rgbKey(pixels, offset))) {
        continue;
      }

      object++;

      const red = pixels[offset];
      const greenChannel = pixels[offset + 1];
      const blue = pixels[offset + 2];

      // Folhagem: verde, ou amarelo-esverdeado (as arvores de outono da
      // Berry Forest viravam uma montanha). Areia e pedra sao mais
      // alaranjadas (G bem abaixo de R).
      if (
        (greenChannel > red + 16 && greenChannel >= blue) ||
        (greenChannel >= red - 10 && greenChannel >= blue + 40 && red >= blue + 40)
      ) {
        green++;
      }
    }

    const isRock = object > 0 && green < object * ROCK_GREEN_FRACTION;

    verdicts.set(key, isRock);

    if (isRock) {
      rocky[index] = 1;
    }
  }

  const mass = new Uint8Array(width * height);
  const visited = new Uint8Array(width * height);
  const isRocky = (x: number, y: number): boolean =>
    x >= 0 && y >= 0 && x < width && y < height && rocky[y * width + x] === 1;

  for (let start = 0; start < rocky.length; start++) {
    if (!rocky[start] || visited[start]) {
      continue;
    }

    const component: number[] = [];
    const stack = [start];
    let thick = false;
    visited[start] = 1;

    while (stack.length > 0) {
      const cell = stack.pop() as number;
      const x = cell % width;
      const y = (cell - x) / width;

      component.push(cell);

      // Grosso: um quadrado 3x3 inteiro de pedra a partir daqui.
      let block = true;

      for (let dy = 0; dy < MASS_CORE && block; dy++) {
        for (let dx = 0; dx < MASS_CORE; dx++) {
          if (!isRocky(x + dx, y + dy)) {
            block = false;
            break;
          }
        }
      }

      if (block) {
        thick = true;
      }

      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        if (!isRocky(x + dx, y + dy)) {
          continue;
        }

        const next = (y + dy) * width + x + dx;

        if (!visited[next]) {
          visited[next] = 1;
          stack.push(next);
        }
      }
    }

    if (thick && component.length >= MASS_MIN_CELLS) {
      for (const cell of component) {
        mass[cell] = 1;
      }

      continue;
    }

    // Pedaco de casa cortado pela borda do mapa: a casa de Five Island
    // continua na Five Isle Meadow, onde nao tem porta e virava objeto em pe
    // (uma torre roxa). Os blocos do tileset da cidade do grupo, encostados
    // na borda, com 2+ colunas e 3+ linhas, viram predio (marcados com 2).
    const isCity = new Set(
      component.filter(
        (cell) => blockAt(cell % width, Math.floor(cell / width))?.secondary === true,
      ),
    );

    // Cada pedaco conexo dos blocos da cidade, compacto (enche 3/4 do seu
    // retangulo): postes soltos ligados por cerca nao contam.
    const seenCity = new Set<number>();

    for (const first of isCity) {
      if (seenCity.has(first)) {
        continue;
      }

      const city: number[] = [];
      const queue = [first];
      seenCity.add(first);

      while (queue.length > 0) {
        const cell = queue.pop() as number;
        const cx = cell % width;

        city.push(cell);

        for (const next of [cell - 1, cell + 1, cell - width, cell + width]) {
          const nx = next % width;

          if (
            next >= 0 &&
            next < mass.length &&
            Math.abs(nx - cx) <= 1 &&
            isCity.has(next) &&
            !seenCity.has(next)
          ) {
            seenCity.add(next);
            queue.push(next);
          }
        }
      }

      if (city.length < 6) {
        continue;
      }

      let x0 = width;
      let x1 = -1;
      let y0 = height;
      let y1 = -1;

      for (const cell of city) {
        const x = cell % width;
        const y = (cell - x) / width;

        x0 = Math.min(x0, x);
        x1 = Math.max(x1, x);
        y0 = Math.min(y0, y);
        y1 = Math.max(y1, y);
      }

      const atEdge = x0 === 0 || y0 === 0 || x1 === width - 1 || y1 === height - 1;
      const compact = city.length * 4 >= (x1 - x0 + 1) * (y1 - y0 + 1) * 3;

      if (atEdge && compact && x1 - x0 + 1 >= 2 && y1 - y0 + 1 >= 3) {
        // 2 = pedaco de casa: buildMapVolume transforma em predio.
        for (const cell of city) {
          mass[cell] = 2;
        }

        // A beirada do telhado (com a copa da arvore por cima, verde) fica
        // acima: entra junto enquanto for solida e da cidade.
        for (let x = x0; x <= x1; x++) {
          for (let y = y0 - 1; y >= 0; y--) {
            const cell = y * width + x;

            if (
              mask[cell] !== FOLD_SOLID ||
              buildingIds[cell] !== 0 ||
              blockAt(x, y)?.secondary !== true
            ) {
              break;
            }

            mass[cell] = 2;
          }
        }
      }
    }
  }

  // Linhas finas (muro de 1 bloco, cerca de pedra) grudadas numa massa:
  // bloco fora de qualquer quadrado 2x2 da massa. Linha de 3 ou mais vira
  // objeto em pe - como caixa ela ficava uma laje alta e fina.
  {
    const inMass = (x: number, y: number): boolean =>
      x >= 0 && y >= 0 && x < width && y < height && mass[y * width + x] === 1;

    const thin = new Uint8Array(width * height);

    for (let cell = 0; cell < mass.length; cell++) {
      // So montanha (1); pedaco de casa (2) vira predio inteiro.
      if (mass[cell] !== 1) {
        continue;
      }

      const x = cell % width;
      const y = (cell - x) / width;
      let thick = false;

      for (const [ox, oy] of [[0, 0], [-1, 0], [0, -1], [-1, -1]]) {
        if (
          inMass(x + ox, y + oy) &&
          inMass(x + ox + 1, y + oy) &&
          inMass(x + ox, y + oy + 1) &&
          inMass(x + ox + 1, y + oy + 1)
        ) {
          thick = true;
          break;
        }
      }

      if (!thick) {
        thin[cell] = 1;
      }
    }

    const seen = new Uint8Array(width * height);

    for (let start = 0; start < thin.length; start++) {
      if (!thin[start] || seen[start]) {
        continue;
      }

      const component: number[] = [];
      const stack = [start];
      seen[start] = 1;

      while (stack.length > 0) {
        const cell = stack.pop() as number;
        const x = cell % width;
        const y = (cell - x) / width;

        component.push(cell);

        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = x + dx;
          const ny = y + dy;

          if (nx < 0 || ny < 0 || nx >= width || ny >= height) {
            continue;
          }

          const next = ny * width + nx;

          if (thin[next] && !seen[next]) {
            seen[next] = 1;
            stack.push(next);
          }
        }
      }

      if (component.length >= 3) {
        for (const cell of component) {
          mass[cell] = 0;
        }
      }
    }
  }

  // Topos (so camada de cima) logo acima das colunas de montanha.
  for (let x = 0; x < width; x++) {
    for (let y = 1; y < height; y++) {
      if (mass[y * width + x] !== 1) {
        continue;
      }

      for (
        let up = y - 1;
        up >= 0 && mask[up * width + x] === FOLD_OVERHANG && !mass[up * width + x];
        up--
      ) {
        mass[up * width + x] = 1;
      }
    }
  }

  return mass;
}

/**
 * Chao unico por grupo: cada grupo conectado de blocos de um tipo (uma
 * mata, um campo de grama alta) recebe o chao andavel mais comum em volta
 * dele. Sem isto a busca do mais proximo misturava areia e grama debaixo
 * da mesma mata, em faixas.
 */
function unifyGroupGround(
  width: number,
  height: number,
  kinds: Uint8Array,
  groupKind: number,
  sources: Int32Array,
  isGround: (x: number, y: number) => boolean,
  metatileAt: (x: number, y: number) => number,
): void {
  const visited = new Uint8Array(width * height);

  for (let start = 0; start < kinds.length; start++) {
    if (kinds[start] !== groupKind || visited[start]) {
      continue;
    }

    const component: number[] = [];
    const stack = [start];
    const counts = new Map<number, { count: number; cell: number }>();
    visited[start] = 1;

    while (stack.length > 0) {
      const cell = stack.pop() as number;
      const x = cell % width;
      const y = (cell - x) / width;

      component.push(cell);

      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx;
        const ny = y + dy;

        if (nx < 0 || ny < 0 || nx >= width || ny >= height) {
          continue;
        }

        const next = ny * width + nx;

        if (kinds[next] === groupKind) {
          if (!visited[next]) {
            visited[next] = 1;
            stack.push(next);
          }

          continue;
        }

        if (!isGround(nx, ny)) {
          continue;
        }

        const id = metatileAt(nx, ny);
        const entry = counts.get(id);

        if (entry) {
          entry.count++;
        } else {
          counts.set(id, { count: 1, cell: next });
        }
      }
    }

    let best: { count: number; cell: number } | null = null;

    for (const entry of counts.values()) {
      if (!best || entry.count > best.count) {
        best = entry;
      }
    }

    if (!best) {
      continue;
    }

    for (const cell of component) {
      sources[cell] = best.cell;
    }
  }
}

// Objetos em pe: posicao do cartao dentro do bloco de baixo (0 = borda
// norte, 1 = borda sul). Objeto no centro, como os sprites; grama alta na
// frente de quem esta nela (cobre os pes, como no GBA); flor atras.
const PROP_OBJECT_Z = 0.5;
const PROP_GRASS_Z = 0.8;
const PROP_FLOWER_Z = 0.35;

// Dois metatiles diferentes contam como o "mesmo desenho" na busca da
// repeticao de uma mata se tantos pixels forem iguais (variantes de
// tronco com grama ou grama alta do lado).
const SIMILAR_ART = 0.75;

// Abaixo disto e outro objeto (cerca colada na base da mata).
const DIFFERENT_ART = 0.35;

interface PropUnit {
  x0: number;
  x1: number;

  // Pixels do mapa (linha 0 = topo do mapa), topo inclusive, base exclusive.
  topPx: number;
  bottomPx: number;

  z: number;
}

/**
 * Pilha de mata com silhueta: coluna x, linhas y0..y1, periodo (linhas),
 * fase das linhas de base (pixels) e quanto a fronteira sobe acima de cada
 * linha, por coluna de pixel. Serve para as arvores da borda (padding).
 */
export interface StackShape {
  x: number;
  y0: number;
  y1: number;
  period: number;
  phase: number;
  offsets: Uint8Array;

  // 3 = contorno medido na propria pilha, 2 = conhecido pelo desenho
  // (KnownStacks), 1 = casado com uma medida, 0 = corte reto (so a fase).
  quality: number;

  // Desenho de um periodo do miolo da pilha (periodArtKey, a partir da
  // linha artRow) e a linha de base contada do topo dele - o que o
  // registro de contornos guarda.
  artKey?: string;
  artRow?: number;
  lineRel?: number;
}

// Cartao de uma coluna de mata cujo topo e base seguem o contorno das
// copas, pixel a pixel.
interface StairCard {
  x: number;

  // Por coluna de pixel do bloco (16): linhas de pixel do mapa, topo
  // inclusive, base exclusive.
  top: Int32Array;
  bottom: Int32Array;

  // Linha de pixel que fica no chao (a profundidade do cartao).
  basePx: number;
}

interface ObjectRun {
  x: number;
  y0: number;
  y1: number;

  // Grupo conectado de blocos de objeto (uma mata, uma arvore solta).
  group: number;

  // Periodo da repeticao (linhas), 0 = objeto unico.
  period: number;

  // Linha de pixel onde o desenho comeca no topo, quando o topo encosta em
  // chao dentro do mapa (-1 = desconhecido: borda do mapa).
  topPx: number;

  // Linhas de baixo que sao outro objeto (cerca colada na base da mata).
  trimmedFrom: number;
}

// Menor pedaco (pixels) que vira cartao proprio num corte de mata.
const MIN_UNIT_PX = 6;

/**
 * Contorno das arvores ja conhecido, pelo DESENHO de um periodo da pilha:
 * o mesmo desenho tem o mesmo contorno em qualquer mapa (e em outra ROM com
 * a mesma arte). Serve as matas sem cabeca nem frente no proprio mapa - em
 * Pallet e na Rota 5 a mata atravessa o mapa de ponta a ponta e nada ali
 * mostra onde uma copa acaba. Semeado com as medidas de todos os mapas das
 * ROMs (KnownStacks.ts, tools/known-stacks.mts) e completado na sessao com
 * as medidas dos mapas montados.
 */
interface KnownStack {
  // Linha de base, em pixels a partir do topo do primeiro bloco do periodo.
  line: number;

  // Ponta da copa da frente acima da linha, por coluna de pixel.
  offsets: Uint8Array;
}

const knownStacks = new Map<string, KnownStack>();
let knownSeeded = false;

function knownStackTable(): Map<string, KnownStack> {
  if (!knownSeeded) {
    knownSeeded = true;

    // Cada valor: linha e 16 pontas, dois digitos hex cada.
    for (const [key, packed] of Object.entries(KNOWN_STACKS)) {
      const offsets = new Uint8Array(16);

      for (let column = 0; column < 16; column++) {
        offsets[column] = parseInt(packed.slice(2 + column * 2, 4 + column * 2), 16);
      }

      knownStacks.set(key, { line: parseInt(packed.slice(0, 2), 16), offsets });
    }
  }

  return knownStacks;
}

/** Esvazia o registro (o gerador da semente mede sem ele). */
export function clearKnownStacks(): void {
  knownSeeded = true;
  knownStacks.clear();
}

/** Chave do desenho de `period` blocos (de cima para baixo): FNV-1a. */
export function periodArtKey(
  blockAt: (x: number, y: number) => VolumeBlock | undefined,
  x: number,
  row: number,
  period: number,
): string | null {
  let hash = 0x811c9dc5;

  for (let k = 0; k < period; k++) {
    const pixels = blockAt(x, row + k)?.pixels;

    if (!pixels) {
      return null;
    }

    for (let index = 0; index < pixels.length; index++) {
      hash = Math.imul(hash ^ pixels[index], 0x01000193);
    }
  }

  return period + ':' + (hash >>> 0).toString(16).padStart(8, '0');
}

/**
 * Cartoes dos objetos em pe (arvores, cercas, placas, pedras, grama alta,
 * flores), alturas em linhas de tile com base em y = 0 - o renderizador
 * estica a malha na vertical como os sprites.
 *
 * Cada coluna de blocos de objeto vira OBJETOS. O que nao se repete (arvore
 * solta, placa, cerca) e um cartao so com a altura inteira. Numa mata o
 * desenho se repete a cada N linhas e as arvores se sobrepoem: a copa de
 * baixo cobre o pe da de cima, e cada copa COMECA NO MEIO de uma linha de
 * tile (na Viridian Forest, 10 pixels abaixo do topo do tile). Cortar nas
 * bordas dos tiles partia as copas - o "bug das arvores". O corte e feito
 * no pixel em que as copas comecam: o topo do desenho da primeira arvore da
 * pilha, medido na textura dos modelos (`rowOpaque`), repetido a cada
 * periodo. A ultima arvore (a da frente, com tronco e sombra) fica inteira.
 * Colunas vizinhas da mesma pilha usam o mesmo corte (o mais alto entre
 * elas: o topo da copa), e quem nao tem topo visivel (mata que continua no
 * mapa vizinho) usa o corte do grupo.
 */
export function buildPropGeometry(
  width: number,
  height: number,
  kinds: Uint8Array,
  blockAt: (x: number, y: number) => VolumeBlock | undefined,
  // Ha pixel opaco na coluna x, linha de pixel `row` do mapa, na textura
  // dos modelos?
  rowOpaque: (x: number, row: number) => boolean,
  // Pixel da textura dos modelos (RGBA empacotado, 0 = transparente), em
  // pixels do mapa. Sem ele, os cortes das matas sao retos.
  pixelAt?: (px: number, py: number) => number,
  // Recebe as pilhas com silhueta (para as arvores da borda).
  shapesOut?: StackShape[],
): FoldGeometryData {
  const isObject = (x: number, y: number): boolean => {
    const kind = kinds[y * width + x];

    return kind === CELL_PROP || kind === CELL_PROP_TOP;
  };

  const artCache = new Map<number, number>();

  // Fracao de pixels iguais entre dois blocos da mesma coluna (1 quando o
  // metatile e o mesmo).
  const similarity = (x: number, y: number, otherY: number): number => {
    const a = blockAt(x, y);
    const b = blockAt(x, otherY);

    if (!a || !b) {
      return 0;
    }

    if (a.metatileId === b.metatileId) {
      return 1;
    }

    const key =
      Math.min(a.metatileId, b.metatileId) * 4096 +
      Math.max(a.metatileId, b.metatileId);

    const cached = artCache.get(key);

    if (cached !== undefined) {
      return cached;
    }

    let same = 0;
    const pa = a.pixels;
    const pb = b.pixels;

    if (pa && pb) {
      for (let offset = 0; offset < pa.length; offset += 4) {
        if (
          pa[offset] === pb[offset] &&
          pa[offset + 1] === pb[offset + 1] &&
          pa[offset + 2] === pb[offset + 2] &&
          pa[offset + 3] === pb[offset + 3]
        ) {
          same++;
        }
      }
    }

    const result = pa ? same / (pa.length / 4) : 0;
    artCache.set(key, result);

    return result;
  };

  // ---- grupos conectados ----
  const groupOf = new Int32Array(width * height).fill(-1);
  let groupCount = 0;

  for (let start = 0; start < kinds.length; start++) {
    const sx = start % width;
    const sy = (start - sx) / width;

    if (groupOf[start] >= 0 || !isObject(sx, sy)) {
      continue;
    }

    const stack = [start];
    groupOf[start] = groupCount;

    while (stack.length > 0) {
      const cell = stack.pop() as number;
      const x = cell % width;
      const y = (cell - x) / width;

      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx;
        const ny = y + dy;

        if (nx < 0 || ny < 0 || nx >= width || ny >= height) {
          continue;
        }

        const next = ny * width + nx;

        if (groupOf[next] < 0 && isObject(nx, ny)) {
          groupOf[next] = groupCount;
          stack.push(next);
        }
      }
    }

    groupCount++;
  }

  // ---- sequencias por coluna: periodo e topo ----
  const runs: ObjectRun[] = [];
  const runsByColumn: ObjectRun[][] = [];

  for (let x = 0; x < width; x++) {
    const column: ObjectRun[] = [];
    let y = 0;

    while (y < height) {
      if (!isObject(x, y)) {
        y++;
        continue;
      }

      const y0 = y;

      while (y < height && isObject(x, y)) {
        y++;
      }

      const y1 = y - 1;

      let first = y0;

      while (first <= y1 && kinds[first * width + x] === CELL_PROP_TOP) {
        first++;
      }

      const solidRows = y1 - first + 1;
      let period = 0;

      // Precisa de pelo menos duas repeticoes inteiras do padrao. Periodo 1:
      // fileira norte-sul de objetos iguais (cerca, arbustos), um cartao
      // por linha - inteira ela virava uma torre em pe.
      for (let candidate = 1; candidate <= MAX_OBJECT_PERIOD; candidate++) {
        if (solidRows < candidate * 2 || (candidate === 1 && solidRows < 3)) {
          continue;
        }

        let same = 0;
        let total = 0;

        for (let row = first + candidate; row <= y1; row++) {
          total++;

          if (similarity(x, row, row - candidate) >= SIMILAR_ART) {
            same++;
          }
        }

        if (total > 0 && same * 10 >= total * 7) {
          period = candidate;
          break;
        }
      }

      // Linhas da base que nao seguem o padrao: objeto proprio.
      let trimmedFrom = y1 + 1;

      if (period > 0) {
        while (
          trimmedFrom - 1 - period >= first &&
          similarity(x, trimmedFrom - 1, trimmedFrom - 1 - period) < DIFFERENT_ART
        ) {
          trimmedFrom--;
        }
      }

      // Topo do desenho, quando o topo da sequencia esta dentro do mapa.
      let topPx = -1;

      if (y0 > 0) {
        for (let row = y0 * 16; row < (y1 + 1) * 16; row++) {
          if (rowOpaque(x, row)) {
            topPx = row;
            break;
          }
        }
      }

      const run: ObjectRun = {
        x,
        y0,
        y1,
        group: groupOf[y0 * width + x],
        period,
        topPx,
        trimmedFrom,
      };

      runs.push(run);
      column.push(run);
    }

    runsByColumn.push(column);
  }

  // ---- periodo aprendido: pilha curta demais para mostrar a repeticao
  // (duas copas so) usa o periodo que os mesmos metatiles tem nas pilhas
  // longas do mapa. A ultima arvore continua inteira (pelo menos um
  // periodo), entao arvore solta nao e cortada. ----
  const learned = new Map<number, Map<number, number>>();

  for (const run of runs) {
    if (run.period === 0) {
      continue;
    }

    for (let row = run.y0; row <= run.y1; row++) {
      const id = blockAt(run.x, row)?.metatileId;

      if (id === undefined) {
        continue;
      }

      const votes = learned.get(id) ?? new Map<number, number>();
      votes.set(run.period, (votes.get(run.period) ?? 0) + 1);
      learned.set(id, votes);
    }
  }

  for (const run of runs) {
    if (run.period !== 0) {
      continue;
    }

    let first = run.y0;

    while (first <= run.y1 && kinds[first * width + run.x] === CELL_PROP_TOP) {
      first++;
    }

    const solidRows = run.y1 - first + 1;
    const votes = new Map<number, number>();

    for (let row = first; row <= run.y1; row++) {
      const id = blockAt(run.x, row)?.metatileId;
      const known = id === undefined ? undefined : learned.get(id);

      if (!known) {
        continue;
      }

      let best = 0;
      let bestCount = 0;

      for (const [candidate, count] of known) {
        if (count > bestCount) {
          best = candidate;
          bestCount = count;
        }
      }

      votes.set(best, (votes.get(best) ?? 0) + 1);
    }

    for (const [candidate, count] of votes) {
      if (solidRows > candidate && count * 10 >= solidRows * 6) {
        run.period = candidate;
      }
    }
  }

  // ---- silhueta das arvores ----
  // Numa mata a copa de baixo cobre o pe da de cima, e o contorno da copa
  // nao e reto: cortar numa linha reta deixava pedaco de uma arvore no
  // cartao da outra (copas achatadas, galhos soltos boiando na frente), e o
  // corte pelo topo do desenho caia no meio das copas quando havia outra
  // coisa por cima da mata (a cerca do Safari). Cada arvore fica com um
  // cartao que vai de uma linha de base a outra (multiplos do periodo), e a
  // fronteira com a arvore da frente sobe, coluna de pixel por coluna, ate
  // onde a copa da frente comeca no desenho.
  //
  // O contorno sai do proprio desenho:
  // - topo da pilha: a primeira arvore, sobre o chao, mostra o contorno
  //   inteiro da copa (o primeiro pixel de cada coluna), desde que o resto
  //   dela seja igual as de baixo;
  // - frente da pilha (so num grupo sem topo medido): o ultimo periodo
  //   (sem arvore na frente) contra o anterior - o que muda e a ponta da
  //   copa da frente.
  // As linhas de base de um grupo seguem a fase mais votada entre as pilhas
  // medidas. As outras pilhas (mata que atravessa o mapa) procuram, em
  // qualquer grupo, um periodo medido com o mesmo desenho e usam o
  // alinhamento e o contorno dele (coluna em duvida segue a vizinha); sem
  // nenhum, o corte e reto na primeira linha em que o desenho passa a se
  // repetir (abaixo da cabeca da mata).
  interface RunShape {
    // Linhas de base: multiplos do periodo a partir desta fase (pixels).
    phase: number;

    // Por coluna de pixel: quanto a fronteira sobe acima da linha (a ponta
    // da copa da frente), 0..periodo.
    offsets: Uint8Array;

    // 3 = medida na propria pilha, 2 = contorno conhecido pelo desenho,
    // 1 = desenho casado com uma medida, 0 = so a fase (corte reto).
    quality: number;
  }

  const runShapes = new Map<ObjectRun, RunShape>();

  const firstSolidRow = (run: ObjectRun): number => {
    let first = run.y0;

    while (first <= run.y1 && kinds[first * width + run.x] === CELL_PROP_TOP) {
      first++;
    }

    return first;
  };

  // Primeira linha de um periodo do miolo da pilha (o periodo seguinte tem
  // os mesmos blocos): o desenho da mata sem a cabeca nem a frente.
  const interiorRow = (run: ObjectRun): number => {
    for (let row = run.y0; row + 2 * run.period <= run.trimmedFrom; row++) {
      let same = true;

      for (let k = 0; k < run.period && same; k++) {
        same =
          blockAt(run.x, row + k)?.metatileId ===
          blockAt(run.x, row + k + run.period)?.metatileId;
      }

      if (same) {
        return row;
      }
    }

    return -1;
  };

  if (pixelAt) {
    const weakVotes = new Map<string, Map<number, number>>();
    const measured = new Map<ObjectRun, { line: number; offsets: Uint8Array }>();

    const vote = (run: ObjectRun, phase: number): void => {
      const key = run.group + ':' + run.period;
      const counts = weakVotes.get(key) ?? new Map<number, number>();

      counts.set(phase, (counts.get(phase) ?? 0) + 1);
      weakVotes.set(key, counts);
    };

    // Fracao dos pixels opacos (de `a`, ou de qualquer um) iguais nos dois
    // trechos de `rows` linhas de pixel das colunas xa e xb.
    const equalFraction = (
      xa: number,
      a: number,
      xb: number,
      b: number,
      rows: number,
      basis: 'a' | 'either',
    ): number => {
      let equal = 0;
      let total = 0;

      for (let column = 0; column < 16; column++) {
        for (let row = 0; row < rows; row++) {
          const pa = pixelAt(xa * 16 + column, a + row);
          const pb = pixelAt(xb * 16 + column, b + row);

          if (pa === 0 && (basis === 'a' || pb === 0)) {
            continue;
          }

          total++;

          if (pa === pb) {
            equal++;
          }
        }
      }

      return total < 8 ? 0 : equal / total;
    };

    // Fronteiras medidas (linha de pixel em cada coluna de pixel, de uma
    // fronteira qualquer da pilha).
    const boundaries = new Map<ObjectRun, Int32Array>();
    const resolvedColumns = new Map<ObjectRun, Uint8Array>();
    const headGroups = new Set<string>();
    const fromFront = new Set<ObjectRun>();

    for (const run of runs) {
      if (run.period === 0) {
        continue;
      }

      const span = run.period * 16;
      const topPx = run.y0 * 16;
      const end = run.trimmedFrom * 16;
      const atBottomEdge = run.trimmedFrom > run.y1 && run.y1 === height - 1;
      const above = run.y0 > 0 ? kinds[(run.y0 - 1) * width + run.x] : -1;
      let boundary: Int32Array | null = null;
      let resolved: Uint8Array | null = null;
      let fromHead = false;

      // Topo valido: chao em cima, a primeira linha de pixel quase toda
      // transparente (a copa comeca dentro do bloco, nao veio de cima) e o
      // resto da primeira arvore igual ao periodo seguinte.
      let openTop = above === 0;

      if (openTop) {
        let opaque = 0;

        for (let px = run.x * 16; px < run.x * 16 + 16; px++) {
          if (pixelAt(px, topPx) !== 0) {
            opaque++;
          }
        }

        openTop = opaque <= 8;
      }

      if (
        openTop &&
        topPx + 2 * span <= end &&
        equalFraction(run.x, topPx, run.x, topPx + span, span, 'a') >= 0.8
      ) {
        // Fronteira no segundo periodo: logo abaixo do ultimo pixel da
        // arvore de cima que fica acima do contorno da copa (o primeiro
        // pixel opaco da coluna no primeiro periodo). Coluna sem nada da
        // arvore de cima ali fica livre e copia a vizinha.
        const rows = new Int32Array(16).fill(-1);
        const limit = new Int32Array(16).fill(span);

        for (let column = 0; column < 16; column++) {
          const px = run.x * 16 + column;
          let first = span;

          for (let row = 0; row < span; row++) {
            if (pixelAt(px, topPx + row) !== 0) {
              first = row;
              break;
            }
          }

          limit[column] = first;

          for (let row = first - 1; row >= 0; row--) {
            if (pixelAt(px, topPx + span + row) !== 0) {
              rows[column] = row + 1;
              break;
            }
          }
        }

        if (rows.some((row) => row >= 0)) {
          fromHead = true;
          boundary = new Int32Array(16);
          resolved = new Uint8Array(16);

          for (let column = 0; column < 16; column++) {
            let row = rows[column];

            resolved[column] = row >= 0 ? 1 : 0;

            for (let distance = 1; row < 0 && distance < 16; distance++) {
              row = Math.max(rows[column - distance] ?? -1, rows[column + distance] ?? -1);
            }

            boundary[column] = topPx + span + Math.min(Math.max(row, 0), limit[column]);
          }
        }
      }

      // Frente valida: o ultimo periodo parecido com o anterior, mas nao
      // igual (igual e a mata que continua, cortada por outra coisa).
      const frontLikeness =
        !boundary && !atBottomEdge && end - 2 * span >= firstSolidRow(run) * 16
          ? equalFraction(run.x, end - span, run.x, end - 2 * span, span, 'either')
          : 0;

      if (frontLikeness >= 0.5 && frontLikeness < 0.995) {
        // Frente: de baixo para cima no periodo anterior ao ultimo, o que
        // difere do ultimo (ou e transparente) e da arvore da frente.
        boundary = new Int32Array(16);
        resolved = new Uint8Array(16);

        const rows = new Int32Array(16).fill(-1);

        for (let column = 0; column < 16; column++) {
          const px = run.x * 16 + column;
          let row = span - 1;
          let seen = false;

          for (; row >= 0; row--) {
            const pixel = pixelAt(px, end - 2 * span + row);

            seen ||= pixel !== 0;

            if (pixel !== 0 && pixel === pixelAt(px, end - span + row)) {
              break;
            }
          }

          // Coluna toda transparente: livre.
          if (seen) {
            rows[column] = row + 1;
          }
        }

        for (let column = 0; column < 16; column++) {
          let row = rows[column];

          resolved[column] = row >= 0 ? 1 : 0;

          for (let distance = 1; row < 0 && distance < 16; distance++) {
            row = Math.max(rows[column - distance] ?? -1, rows[column + distance] ?? -1);
          }

          boundary[column] = end - 2 * span + Math.max(row, 0);
        }
      }

      if (boundary && resolved && resolved.some((value) => value === 1)) {
        boundaries.set(run, boundary);
        resolvedColumns.set(run, resolved);

        if (fromHead) {
          headGroups.add(run.group + ':' + run.period);
        } else {
          fromFront.add(run);
        }

        continue;
      }

      // Primeira linha a partir da qual o desenho se repete (abaixo da
      // cabeca da mata, desenhada diferente).
      if (run.y0 > 0) {
        for (let row = firstSolidRow(run); row + run.period <= run.trimmedFrom - 1; row++) {
          let repeats = true;

          for (let other = row; other + run.period < run.trimmedFrom && repeats; other++) {
            repeats = similarity(run.x, other, other + run.period) >= SIMILAR_ART;
          }

          if (repeats) {
            vote(run, (row * 16) % span);
            break;
          }
        }
      }
    }

    // Num grupo com topo medido, a medida pela frente (mais sujeita a
    // engano: tronco e sombra da arvore da frente) cede lugar a comparacao
    // com os topos.
    for (const run of fromFront) {
      if (headGroups.has(run.group + ':' + run.period)) {
        boundaries.delete(run);
        resolvedColumns.delete(run);
      }
    }

    // Pilhas sem medida aqui: contorno conhecido pelo desenho (medido em
    // outro mapa). Num grupo com medida propria, so entram na conta das
    // linhas de base se o grupo nao tiver voto proprio.
    const fromKnown = new Set<ObjectRun>();
    const table = knownStackTable();
    const ownGroups = new Set<string>();

    for (const run of boundaries.keys()) {
      ownGroups.add(run.group + ':' + run.period);
    }

    if (table.size > 0) {
      for (const run of runs) {
        if (run.period === 0 || boundaries.has(run)) {
          continue;
        }

        const row = interiorRow(run);

        if (row < 0) {
          continue;
        }

        // Qualquer rotacao do periodo: o registro guarda uma so.
        for (let k = 0; k < run.period; k++) {
          const key = periodArtKey(blockAt, run.x, row + k, run.period);
          const known = key ? table.get(key) : undefined;

          if (!known) {
            continue;
          }

          const line = (row + k) * 16 + known.line;
          const boundary = new Int32Array(16);

          for (let column = 0; column < 16; column++) {
            boundary[column] = line - known.offsets[column];
          }

          boundaries.set(run, boundary);
          resolvedColumns.set(run, new Uint8Array(16).fill(1));
          fromKnown.add(run);
          break;
        }
      }
    }

    // Fase das linhas de base por grupo: cada pilha medida vota na linha
    // logo abaixo da sua fronteira mais baixa; vale a mais votada. Assim as
    // colunas de uma mesma arvore ficam na mesma profundidade. A fronteira
    // de cada pilha e medida a partir da linha da fase logo abaixo da
    // mediana dela (coluna que passa da linha fica na linha).
    const phaseVotes = new Map<string, Map<number, number>>();

    for (const [run, boundary] of boundaries) {
      if (fromKnown.has(run) && ownGroups.has(run.group + ':' + run.period)) {
        continue;
      }

      const span = run.period * 16;
      const resolved = resolvedColumns.get(run) as Uint8Array;
      let lowest = -Infinity;

      boundary.forEach((row, column) => {
        if (resolved[column]) {
          lowest = Math.max(lowest, row);
        }
      });

      const key = run.group + ':' + run.period;
      const counts = phaseVotes.get(key) ?? new Map<number, number>();
      const phase = (Math.ceil(lowest / 16) * 16) % span;

      counts.set(phase, (counts.get(phase) ?? 0) + 1);
      phaseVotes.set(key, counts);
    }

    for (const [run, boundary] of boundaries) {
      const span = run.period * 16;
      const resolved = resolvedColumns.get(run) as Uint8Array;
      const counts = phaseVotes.get(run.group + ':' + run.period) as Map<number, number>;
      let phase = 0;
      let best = 0;

      for (const [value, count] of counts) {
        if (count > best || (count === best && value < phase)) {
          phase = value;
          best = count;
        }
      }

      const rows = Array.from(boundary).filter((_, column) => resolved[column] === 1).sort((a, b) => a - b);
      const median = rows[Math.floor(rows.length / 2)];
      const line = median + ((((phase - median) % span) + span) % span);
      const offsets = new Uint8Array(16);

      for (let column = 0; column < 16; column++) {
        offsets[column] = Math.min(span, Math.max(0, line - boundary[column]));
      }

      measured.set(run, { line, offsets });
    }

    // O que este mapa mediu fica conhecido para os proximos (desenho que a
    // semente nao tem: outra ROM, hack).
    for (const [run, shape] of measured) {
      if (fromKnown.has(run)) {
        continue;
      }

      const row = interiorRow(run);
      const key = row < 0 ? null : periodArtKey(blockAt, run.x, row, run.period);

      if (key && !table.has(key)) {
        const span = run.period * 16;

        table.set(key, {
          line: (((shape.line - row * 16) % span) + span) % span,
          offsets: shape.offsets,
        });
      }
    }

    // Periodos medidos, sem repeticao (mesmo desenho), por periodo (de
    // qualquer grupo: a mesma arvore aparece em matas separadas).
    const references = new Map<string, Array<{ x: number; line: number; offsets: Uint8Array }>>();

    for (const [run, measuredShape] of measured) {
      const key = String(run.period);
      const list = references.get(key) ?? [];
      const span = run.period * 16;

      // Periodo de referencia dentro da pilha (o desenho regular da mata).
      let referenceLine = measuredShape.line;

      while (referenceLine > run.trimmedFrom * 16) {
        referenceLine -= span;
      }

      while (referenceLine - span < run.y0 * 16 && referenceLine + span <= run.trimmedFrom * 16) {
        referenceLine += span;
      }

      if (referenceLine - span < run.y0 * 16 || referenceLine > run.trimmedFrom * 16) {
        continue;
      }

      const shape = { line: referenceLine, offsets: measuredShape.offsets };

      if (
        !list.some(
          (other) =>
            equalFraction(run.x, shape.line - span, other.x, other.line - span, span, 'either') ===
              1 && other.offsets.every((offset, column) => offset === shape.offsets[column]),
        )
      ) {
        list.push({ x: run.x, line: shape.line, offsets: shape.offsets });
      }

      references.set(key, list);
    }

    // Pilhas sem medida: o melhor periodo de referencia em cada fase. Uma
    // fase so vale sozinha quando ganha das outras com folga; as colunas
    // em duvida (o meio da copa, parecido nas duas fases) seguem a fase do
    // grupo - sem isso a coluna do meio de uma arvore ficava numa
    // profundidade e as do lado em outra.
    const matches = new Map<ObjectRun, Map<number, { offsets: Uint8Array; score: number }>>();
    const decisiveVotes = new Map<string, Map<number, number>>();

    for (const run of runs) {
      if (run.period === 0) {
        continue;
      }

      const span = run.period * 16;
      const own = measured.get(run);

      if (own) {
        runShapes.set(run, {
          phase: own.line % span,
          offsets: own.offsets,
          quality: fromKnown.has(run) ? 2 : 3,
        });
        continue;
      }

      // Cada linha de bloco da pilha (ate 4 por fase, espalhadas) contra
      // cada periodo de referencia.
      const topPx = run.y0 * 16;
      const end = run.trimmedFrom * 16;
      const byPhase = new Map<number, { offsets: Uint8Array; score: number }>();

      for (let shift = 0; shift < run.period; shift++) {
        const lines: number[] = [];

        for (let line = topPx + span + shift * 16; line <= end; line += span) {
          lines.push(line);
        }

        const step = Math.max(1, Math.ceil(lines.length / 4));

        for (let index = lines.length - 1; index >= 0; index -= step) {
          const line = lines[index];
          const phase = line % span;

          for (const reference of references.get(String(run.period)) ?? []) {
            const score = equalFraction(reference.x, reference.line - span, run.x, line - span, span, 'a');
            const known = byPhase.get(phase);

            if (!known || score > known.score) {
              byPhase.set(phase, { offsets: reference.offsets, score });
            }
          }
        }
      }

      matches.set(run, byPhase);

      const ranked = [...byPhase.entries()].sort((a, b) => b[1].score - a[1].score);

      if (
        ranked.length > 0 &&
        ranked[0][1].score >= 0.8 &&
        (ranked.length === 1 || ranked[0][1].score - ranked[1][1].score >= 0.05)
      ) {
        const key = run.group + ':' + run.period;
        const counts = decisiveVotes.get(key) ?? new Map<number, number>();

        counts.set(ranked[0][0], (counts.get(ranked[0][0]) ?? 0) + 1);
        decisiveVotes.set(key, counts);
      }
    }

    const majorityOf = (counts: Map<number, number> | undefined): number | null => {
      if (!counts) {
        return null;
      }

      let best: number | null = null;
      let total = 0;

      for (const [value, count] of counts) {
        if (count > total) {
          best = value;
          total = count;
        }
      }

      return best;
    };

    const isDecisive = (byPhase: Map<number, { offsets: Uint8Array; score: number }>): boolean => {
      const ranked = [...byPhase.values()].sort((a, b) => b.score - a.score);

      return (
        ranked.length > 0 &&
        ranked[0].score >= 0.8 &&
        (ranked.length === 1 || ranked[0].score - ranked[1].score >= 0.05)
      );
    };

    const settle = (run: ObjectRun, phase: number): void => {
      const match = matches.get(run)?.get(phase);

      const matched = !!match && match.score >= 0.8;

      runShapes.set(run, {
        phase,
        offsets: matched ? match.offsets : new Uint8Array(16),
        quality: matched ? 1 : 0,
      });
    };

    // Decididas primeiro; as em duvida seguem a coluna vizinha da mesma
    // pilha (sobreposta na vertical) que ja tem fase, e so depois a fase do
    // grupo.
    const pending: ObjectRun[] = [];

    for (const [run, byPhase] of matches) {
      if (isDecisive(byPhase)) {
        const best = [...byPhase.entries()].sort((a, b) => b[1].score - a[1].score)[0];

        settle(run, best[0]);
      } else {
        pending.push(run);
      }
    }

    for (let pass = 0; pass < 4 && pending.length > 0; pass++) {
      for (let index = pending.length - 1; index >= 0; index--) {
        const run = pending[index];
        let phase: number | null = null;

        for (const dx of [-1, 1]) {
          for (const other of runsByColumn[run.x + dx] ?? []) {
            const shape = runShapes.get(other);

            if (
              shape &&
              other.group === run.group &&
              other.period === run.period &&
              other.y0 <= run.y1 &&
              run.y0 <= other.y1
            ) {
              phase = shape.phase;
            }
          }
        }

        if (phase !== null) {
          settle(run, phase);
          pending.splice(index, 1);
        }
      }
    }

    for (const run of pending) {
      const key = run.group + ':' + run.period;
      const byPhase = matches.get(run) as Map<number, { offsets: Uint8Array; score: number }>;
      const ranked = [...byPhase.entries()].sort((a, b) => b[1].score - a[1].score);
      const phase =
        majorityOf(phaseVotes.get(key)) ??
        majorityOf(decisiveVotes.get(key)) ??
        (ranked.length > 0 && ranked[0][1].score >= 0.8 ? ranked[0][0] : null) ??
        majorityOf(weakVotes.get(key));

      if (phase !== null) {
        settle(run, phase);
      }
    }
  }

  // ---- fase do corte (pixel em que as copas comecam), por grupo ----
  // Votos do grupo: fase (topo mod periodo) de cada coluna com topo.
  const groupVotes = new Map<string, Map<number, number>>();

  for (const run of runs) {
    if (run.period === 0 || run.topPx < 0) {
      continue;
    }

    const key = run.group + ':' + run.period;
    const votes = groupVotes.get(key) ?? new Map<number, number>();
    const phase = run.topPx % (run.period * 16);

    votes.set(phase, (votes.get(phase) ?? 0) + 1);
    groupVotes.set(key, votes);
  }

  const overlapping = (a: ObjectRun, b: ObjectRun): boolean =>
    a.y0 <= b.y1 && b.y0 <= a.y1;

  const phaseOf = (run: ObjectRun): number | null => {
    const span = run.period * 16;

    // Vizinhos da mesma pilha: o topo mais alto entre eles e o topo da
    // copa (as colunas do lado da copa comecam mais abaixo).
    let best = run.topPx >= 0 ? run.topPx : Number.POSITIVE_INFINITY;

    for (const dx of [-1, 1]) {
      for (const other of runsByColumn[run.x + dx] ?? []) {
        if (
          other.group !== run.group ||
          other.period !== run.period ||
          other.topPx < 0 ||
          !overlapping(run, other)
        ) {
          continue;
        }

        if (run.topPx >= 0 && Math.abs(other.topPx - run.topPx) >= span / 2) {
          continue;
        }

        best = Math.min(best, other.topPx);
      }
    }

    if (Number.isFinite(best)) {
      return best % span;
    }

    const votes = groupVotes.get(run.group + ':' + run.period);

    if (!votes) {
      return null;
    }

    let phase: number | null = null;
    let count = 0;

    for (const [value, total] of votes) {
      if (total > count) {
        phase = value;
        count = total;
      }
    }

    return phase;
  };

  const units: PropUnit[] = [];

  // Cortes por coluna, depois juntados com os vizinhos de mesmo recorte.
  const columnUnits: Array<Array<[number, number]>> = [];

  for (let x = 0; x < width; x++) {
    columnUnits.push([]);
  }

  const stairCards: StairCard[] = [];

  if (shapesOut) {
    for (const [run, shape] of runShapes) {
      const row = interiorRow(run);
      const span = run.period * 16;

      shapesOut.push({
        x: run.x,
        y0: run.y0,
        y1: run.y1,
        period: run.period,
        phase: shape.phase,
        offsets: shape.offsets,
        quality: shape.quality,
        artKey:
          row < 0 ? undefined : periodArtKey(blockAt, run.x, row, run.period) ?? undefined,
        artRow: row < 0 ? undefined : row,
        lineRel:
          row < 0 ? undefined : (((shape.phase - row * 16) % span) + span) % span,
      });
    }
  }

  // Linhas de base de cada pilha com silhueta, de baixo para cima: a da
  // frente deixa pelo menos um periodo embaixo (menos na borda do mapa,
  // onde a mata continua); a de cima deixa pelo menos meio periodo em cima
  // (o que estiver por cima da mata, como a cerca do Safari, fica num
  // cartao proprio).
  const runLines = new Map<ObjectRun, number[]>();

  const endOf = (run: ObjectRun): number =>
    runShapes.has(run) && run.period > 0 && run.y1 + 1 - run.trimmedFrom <= run.period
      ? (run.y1 + 1) * 16
      : run.trimmedFrom * 16;

  for (const run of runs) {
    const shape = runShapes.get(run);

    if (!shape || run.period === 0) {
      continue;
    }

    const span = run.period * 16;
    const topPx = run.y0 * 16;
    const endPx = endOf(run);
    const atBottomEdge = run.y1 === height - 1;
    const lines: number[] = [];

    for (
      let line = endPx - 1 - ((endPx - 1 - shape.phase) % span + span) % span;
      line > topPx;
      line -= span
    ) {
      if (line > endPx - span && !atBottomEdge) {
        continue;
      }

      if (line - topPx < span / 2) {
        break;
      }

      lines.push(line);
    }

    runLines.set(run, lines);
  }

  // A linha de cima com menos de um periodo em cima so vale se uma coluna
  // vizinha da mesma pilha tambem corta ali: a coluna do meio de uma arvore
  // solta, um bloco mais alta (o topo da copa), cortava a copa sozinha.
  for (const [run, lines] of runLines) {
    const top = lines[lines.length - 1];

    if (top === undefined || top - run.y0 * 16 >= run.period * 16) {
      continue;
    }

    let neighbors = 0;
    let agree = 0;

    for (const dx of [-1, 1]) {
      for (const other of runsByColumn[run.x + dx] ?? []) {
        const otherLines = runLines.get(other);

        if (
          otherLines &&
          other.group === run.group &&
          other.period === run.period &&
          other.y0 <= run.y1 &&
          run.y0 <= other.y1
        ) {
          neighbors++;

          if (otherLines.includes(top)) {
            agree++;
          }
        }
      }
    }

    if (neighbors > 0 && agree === 0) {
      lines.pop();
    }
  }

  for (const run of runs) {
    const pieces = columnUnits[run.x];
    const topPx = run.y0 * 16;

    // Com silhueta, a base diferente da arvore da frente (ate um periodo)
    // fica no cartao dela: cortada, uma coluna da arvore acabava numa
    // profundidade e a vizinha (base parecida, sem corte) em outra.
    const endPx = endOf(run);

    if (endPx < (run.y1 + 1) * 16) {
      pieces.push([endPx, (run.y1 + 1) * 16]);
    }

    if (run.period === 0) {
      pieces.push([topPx, endPx]);
      continue;
    }

    const shape = runShapes.get(run);

    if (shape) {
      const span = run.period * 16;
      const lines = (runLines.get(run) ?? []).map((line) => {
        const edge = new Int32Array(16);

        for (let column = 0; column < 16; column++) {
          edge[column] = Math.max(topPx, line - shape.offsets[column]);
        }

        return { line, edge };
      });

      if (lines.length === 0) {
        pieces.push([topPx, endPx]);
        continue;
      }

      if (run.y1 === height - 1 && endPx === height * 16) {
        // A mata continua no mapa de baixo: o que fica abaixo da ultima
        // linha e de arvores com base FORA do mapa. Cada pedaco fica em pe
        // na base da sua arvore (a mesma do mapa vizinho, que desenha o
        // resto dela); em pe na borda daqui, a ponta e o corpo ficavam em
        // profundidades diferentes e se separavam na emenda dos mapas.
        let maxOffset = 0;

        for (let column = 0; column < 16; column++) {
          maxOffset = Math.max(maxOffset, shape.offsets[column]);
        }

        for (
          let base = lines[0].line + span;
          base - span - maxOffset < endPx;
          base += span
        ) {
          const top = new Int32Array(16);
          const bottom = new Int32Array(16);

          for (let column = 0; column < 16; column++) {
            top[column] = Math.max(topPx, base - span - shape.offsets[column]);
            bottom[column] = Math.max(top[column], Math.min(endPx, base - shape.offsets[column]));
          }

          stairCards.push({ x: run.x, top, bottom, basePx: base });
        }
      } else {
        // Cartao da frente ate um periodo abaixo da ultima linha: a coluna
        // que desce mais (tronco ou sombra da arvore da frente so nela)
        // fica na mesma profundidade das vizinhas, e o que sobra embaixo
        // vira um cartao proprio.
        const frontBase = Math.min(endPx, lines[0].line + span);

        stairCards.push({
          x: run.x,
          top: lines[0].edge,
          bottom: new Int32Array(16).fill(frontBase),
          basePx: frontBase,
        });

        if (frontBase < endPx) {
          pieces.push([frontBase, endPx]);
        }
      }

      for (let index = 0; index + 1 < lines.length; index++) {
        stairCards.push({
          x: run.x,
          top: lines[index + 1].edge,
          bottom: lines[index].edge,
          basePx: lines[index].line,
        });
      }

      stairCards.push({
        x: run.x,
        top: new Int32Array(16).fill(topPx),
        bottom: lines[lines.length - 1].edge,
        basePx: lines[lines.length - 1].line,
      });

      continue;
    }

    const span = run.period * 16;
    let phase = phaseOf(run);

    // Sem topo em lugar nenhum: corta nas bordas dos tiles a partir da
    // base (a linha de baixo e tronco).
    if (phase === null) {
      phase = endPx % span;
    }

    const cuts: number[] = [];
    let cut = topPx + ((phase - topPx) % span + span) % span;

    if (cut < topPx + MIN_UNIT_PX) {
      cut += span;
    }

    // A ultima arvore (a da frente) fica inteira: pelo menos um periodo.
    for (; endPx - cut >= span; cut += span) {
      cuts.push(cut);
    }

    let from = topPx;

    for (const position of cuts) {
      pieces.push([from, position]);
      from = position;
    }

    pieces.push([from, endPx]);
  }

  {
    const open = new Map<string, PropUnit>();

    for (let x = 0; x < width; x++) {
      const next = new Map<string, PropUnit>();

      for (const [topPx, bottomPx] of columnUnits[x]) {
        // Pedaco sem nenhum pixel: nao vira cartao.
        let visible = false;

        for (let row = topPx; row < bottomPx && !visible; row++) {
          visible = rowOpaque(x, row);
        }

        if (!visible) {
          continue;
        }

        const key = topPx + ':' + bottomPx;
        const previous = open.get(key);

        if (previous && previous.x1 === x - 1) {
          previous.x1 = x;
          next.set(key, previous);
        } else {
          const unit: PropUnit = {
            x0: x,
            x1: x,
            topPx,
            bottomPx,
            z: bottomPx / 16 - 1 + PROP_OBJECT_Z,
          };

          units.push(unit);
          next.set(key, unit);
        }
      }

      open.clear();

      for (const [key, unit] of next) {
        open.set(key, unit);
      }
    }
  }

  // Grama alta e flores: um cartao de uma linha por trecho da fileira.
  for (const [kind, offset] of [
    [CELL_GRASS, PROP_GRASS_Z],
    [CELL_FLOWER, PROP_FLOWER_Z],
  ] as const) {
    for (let y = 0; y < height; y++) {
      let x = 0;

      while (x < width) {
        if (kinds[y * width + x] !== kind) {
          x++;
          continue;
        }

        const x0 = x;

        while (x < width && kinds[y * width + x] === kind) {
          x++;
        }

        units.push({
          x0,
          x1: x - 1,
          topPx: y * 16,
          bottomPx: (y + 1) * 16,
          z: y + offset,
        });
      }
    }
  }

  const positions: number[] = [];
  const uvs: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];

  // Recuo de uma fracao de texel nas bordas: o filtro NEAREST nao pega a
  // linha vizinha na textura.
  const textureRows = height * 16;
  const insetU = 0.001 / (width * 16);
  const insetV = 0.001 / textureRows;

  for (const unit of units) {
    const left = unit.x0;
    const right = unit.x1 + 1;
    const rows = (unit.bottomPx - unit.topPx) / 16;
    const vBottom = (textureRows - unit.bottomPx) / textureRows + insetV;
    const vTop = (textureRows - unit.topPx) / textureRows - insetV;
    const uLeft = left / width + insetU;
    const uRight = right / width - insetU;
    const base = positions.length / 3;

    positions.push(
      left, 0, unit.z,
      right, 0, unit.z,
      right, rows, unit.z,
      left, rows, unit.z,
    );

    uvs.push(
      uLeft, vBottom,
      uRight, vBottom,
      uRight, vTop,
      uLeft, vTop,
    );

    for (let corner = 0; corner < 4; corner++) {
      colors.push(1, 1, 1);
    }

    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  // Cartoes com o contorno da copa da frente: uma faixa por trecho de
  // colunas de pixel com o mesmo topo e a mesma base.
  for (const card of stairCards) {
    const z = card.basePx / 16 - 1 + PROP_OBJECT_Z;
    let column = 0;

    while (column < 16) {
      const top = card.top[column];
      const bottom = card.bottom[column];
      let next = column + 1;

      while (next < 16 && card.top[next] === top && card.bottom[next] === bottom) {
        next++;
      }

      let visible = false;

      if (top < bottom && pixelAt) {
        for (let px = card.x * 16 + column; px < card.x * 16 + next && !visible; px++) {
          for (let row = top; row < bottom && !visible; row++) {
            visible = pixelAt(px, row) !== 0;
          }
        }
      }

      if (visible) {
        const left = card.x + column / 16;
        const right = card.x + next / 16;
        const vBottom = (textureRows - bottom) / textureRows + insetV;
        const vTop = (textureRows - top) / textureRows - insetV;
        const uLeft = left / width + insetU;
        const uRight = right / width - insetU;
        const yBottom = (card.basePx - bottom) / 16;
        const yTop = (card.basePx - top) / 16;
        const base = positions.length / 3;

        positions.push(
          left, yBottom, z,
          right, yBottom, z,
          right, yTop, z,
          left, yTop, z,
        );

        uvs.push(
          uLeft, vBottom,
          uRight, vBottom,
          uRight, vTop,
          uLeft, vTop,
        );

        for (let corner = 0; corner < 4; corner++) {
          colors.push(1, 1, 1);
        }

        indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
      }

      column = next;
    }
  }

  return {
    positions: new Float32Array(positions),
    uvs: new Float32Array(uvs),
    colors: new Float32Array(colors),
    indices: new Uint32Array(indices),
    fullIndexCount: indices.length,
    quadCount: indices.length / 6,
  };
}

/**
 * Monta todo o volume de um mapa a partir dos blocos. Usado pelo
 * renderizador e pelas ferramentas de conferencia (mesmo codigo).
 */
export function buildMapVolume(
  width: number,
  height: number,
  blockAt: (x: number, y: number) => VolumeBlock | undefined,
  warps: ReadonlyArray<{ x: number; y: number }>,
  style: FoldStyle,
  maxWallRows: number,
  // Metatiles que sao natureza com certeza (os do bloco de borda do mapa:
  // a mata em volta da cidade).
  natureMetatiles: ReadonlySet<number> = new Set(),
  options: {
    // Predio sem nenhum bloco do tileset da cidade (rochedo com caverna:
    // Ilhas Seafoam, Caverna Celeste) vira montanha. No FRLG as casas sao
    // todas do tileset secundario; no RSE nao foi conferido.
    rockDoorsAsMountains?: boolean;
  } = {},
): MapVolume {
  // Cada bloco e consultado muitas vezes: guarda a primeira resposta.
  const rawBlockAt = blockAt;
  const blockCache: Array<VolumeBlock | undefined | null> = new Array(width * height).fill(null);

  blockAt = (x: number, y: number): VolumeBlock | undefined => {
    if (x < 0 || y < 0 || x >= width || y >= height) {
      return undefined;
    }

    const index = y * width + x;
    let block = blockCache[index];

    if (block === null) {
      block = rawBlockAt(x, y);
      blockCache[index] = block;
    }

    return block;
  };

  const mask =
    computeFoldMask(width, height, blockAt);

  // Bloco com comportamento de agua (pedra no mar, borda de mar
  // impassavel) nunca sobe: fica na agua, rebaixado com ela.
  const waterBehaviors = new Set<number>(WATER_BEHAVIORS);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const block = blockAt(x, y);

      if (block && block.elevation === 1 && block.behavior !== 0) {
        waterBehaviors.add(block.behavior);
      }
    }
  }

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const behavior = blockAt(x, y)?.behavior;

      if (behavior !== undefined && waterBehaviors.has(behavior)) {
        mask[y * width + x] = 0;
      }
    }
  }

  classifyLedges(
    width,
    height,
    mask,
    (x, y) => blockAt(x, y)?.behavior ?? 0,
  );

  const ledgeCorners =
    classifyLedgeCorners(width, height, mask, blockAt);

  // Interior: so parede do fundo e moveis (o resto taparia o comodo). Ao
  // ar livre as colunas finas (cercas norte-sul) ficam: viram objetos em
  // pe como o resto.
  // Interior: vasos de planta e outros objetos verdes pequenos, soltos no
  // chao, viram objetos em pe como as arvores; o resto vira caixa.
  const interiorProps =
    style === 'interior'
      ? findInteriorProps(width, height, mask, blockAt)
      : new Uint8Array(width * height);

  if (style === 'interior') {
    keepBackedRuns(width, height, mask, (x, y) => {
      const block = blockAt(x, y);

      return !!block && block.collision === 0;
    });

    for (let index = 0; index < mask.length; index++) {
      if (interiorProps[index]) {
        mask[index] = FOLD_SOLID;
      }
    }
  }

  extendFoldMaskUpward(
    width,
    height,
    mask,
    (x, y) => {
      const block = blockAt(x, y);

      return (
        !!block &&
        block.collision === 0 &&
        block.elevation !== 1 &&
        (block.topReachesBottom ?? block.hasForeground)
      );
    },
  );

  const walkable = (x: number, y: number): boolean => {
    const block = blockAt(x, y);

    return (
      !!block &&
      block.collision === 0 &&
      block.elevation !== 1 &&
      block.behavior !== MB_TALL_GRASS
    );
  };

  // Chao provisorio (o mais proximo), so para saber as cores de fundo de
  // cada desenho na classificacao.
  const provisional =
    chooseGroundSources({
      width,
      height,
      covered: (x, y) => mask[y * width + x] !== 0,
      isGround: walkable,
    });

  const natural =
    style === 'outdoor'
      ? markNaturalCells(width, height, mask, blockAt, provisional, natureMetatiles)
      : new Uint8Array(width * height);

  const buildingIds =
    style === 'outdoor'
      ? findBuildings(
          width,
          height,
          mask,
          natural,
          warps,
          (index) => blockAt(index % width, Math.floor(index / width))?.secondary === true,
          (index) => blockAt(index % width, Math.floor(index / width))?.solidModel === true,
        )
      : new Int32Array(width * height);

  // Rochedo com porta de caverna: como predio ele ganhava telhado de duas
  // aguas e fachadas por coluna (as Ilhas Seafoam viravam cristais
  // pontudos); sem nenhum bloco da cidade, vira montanha como os outros.
  if (style === 'outdoor' && options.rockDoorsAsMountains) {
    const city = new Map<number, number>();

    for (let index = 0; index < buildingIds.length; index++) {
      const id = buildingIds[index];

      if (id !== 0) {
        const secondary = blockAt(index % width, Math.floor(index / width))?.secondary === true;

        city.set(id, (city.get(id) ?? 0) + (secondary ? 1 : 0));
      }
    }

    for (let index = 0; index < buildingIds.length; index++) {
      if (buildingIds[index] !== 0 && city.get(buildingIds[index]) === 0) {
        buildingIds[index] = 0;
      }
    }
  }

  const masses =
    style === 'outdoor'
      ? findRockMasses(width, height, mask, buildingIds, blockAt, provisional)
      : new Uint8Array(width * height);

  // Pedacos de casa na borda do mapa (findRockMasses marca com 2) viram
  // predio, medidos como a outra metade da casa no mapa vizinho.
  {
    let nextId = 0;

    for (const id of buildingIds) {
      nextId = Math.max(nextId, id);
    }

    const seen = new Uint8Array(width * height);

    for (let start = 0; start < masses.length; start++) {
      if (masses[start] !== 2 || seen[start]) {
        continue;
      }

      nextId++;

      const stack = [start];
      seen[start] = 1;

      while (stack.length > 0) {
        const cell = stack.pop() as number;
        const x = cell % width;
        const y = (cell - x) / width;

        buildingIds[cell] = nextId;
        masses[cell] = 0;

        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = x + dx;
          const ny = y + dy;

          if (nx < 0 || ny < 0 || nx >= width || ny >= height) {
            continue;
          }

          const next = ny * width + nx;

          if (masses[next] === 2 && !seen[next]) {
            seen[next] = 1;
            stack.push(next);
          }
        }
      }
    }
  }

  // ---- o que cada bloco vira ----
  const kinds = new Uint8Array(width * height);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index = y * width + x;
      const value = mask[index];

      if (value === FOLD_LEDGE) {
        kinds[index] = CELL_LEDGE;
        continue;
      }

      if (isVolumeCell(value)) {
        // Topo (so camada de cima): segue o bloco solido logo abaixo.
        let below = y;

        while (below < height - 1 && mask[below * width + x] === FOLD_OVERHANG) {
          below++;
        }

        const structure =
          style === 'interior'
            ? interiorProps[below * width + x] === 0
            : buildingIds[index] > 0 || masses[index] === 1;

        kinds[index] =
          structure
            ? value === FOLD_OVERHANG ? CELL_STRUCTURE_TOP : CELL_STRUCTURE
            : value === FOLD_OVERHANG ? CELL_PROP_TOP : CELL_PROP;

        continue;
      }

      if (style !== 'outdoor') {
        continue;
      }

      const block = blockAt(x, y);

      if (!block || block.collision !== 0 || block.elevation === 1) {
        continue;
      }

      if (block.behavior === MB_TALL_GRASS) {
        kinds[index] = CELL_GRASS;
      } else if (block.flower) {
        kinds[index] = CELL_FLOWER;
      }
    }
  }

  // ---- chao debaixo dos modelos ----
  const isGround = (x: number, y: number): boolean => {
    const kind = kinds[y * width + x];

    return (kind === CELL_GROUND || kind === CELL_FLOWER) && walkable(x, y);
  };

  const groundSources =
    chooseGroundSources({
      width,
      height,
      covered: (x, y) => isCoveredKind(kinds[y * width + x]),
      isGround,
    });

  const metatileAt = (x: number, y: number): number =>
    blockAt(x, y)?.metatileId ?? -1;

  unifyGroupGround(width, height, kinds, CELL_PROP, groundSources, isGround, metatileAt);
  unifyGroupGround(width, height, kinds, CELL_GRASS, groundSources, isGround, metatileAt);

  // Quinas de ledge: o chao fica com o proprio desenho (a volta do ledge
  // para o norte); so a faixa de baixo fica em pe.
  for (const index of ledgeCorners) {
    groundSources[index] = -1;
  }

  // ---- estruturas 3D ----
  const overlayOnly = (x: number, y: number): boolean =>
    mask[y * width + x] === FOLD_OVERHANG;

  const parts: FoldGeometryData[] = [];
  const buildings: BuildingVolume[] = [];

  if (style === 'interior') {
    parts.push(
      buildFoldGeometry(
        width,
        height,
        (x, y) => isVolumeCell(mask[y * width + x]),
        maxWallRows,
        {
          style,
          overlayOnly,
          metatileAt,
          isFloor: (x, y) => {
            const block = blockAt(x, y);

            return !!block && block.collision === 0;
          },
        },
      ),
    );
  } else {
    // Predios, um por um (cada um mede a propria fachada).
    const bounds = new Map<number, { x0: number; y0: number; x1: number; y1: number }>();

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const id = buildingIds[y * width + x];

        if (id === 0) {
          continue;
        }

        const box = bounds.get(id);

        if (box) {
          box.x0 = Math.min(box.x0, x);
          box.y0 = Math.min(box.y0, y);
          box.x1 = Math.max(box.x1, x);
          box.y1 = Math.max(box.y1, y);
        } else {
          bounds.set(id, { x0: x, y0: y, x1: x, y1: y });
        }
      }
    }

    for (const [id, box] of bounds) {
      const cells: Array<{ x: number; y: number }> = [];

      for (let y = box.y0; y <= box.y1; y++) {
        for (let x = box.x0; x <= box.x1; x++) {
          if (buildingIds[y * width + x] === id) {
            cells.push({ x, y });
          }
        }
      }

      const facadeRows =
        measureFacadeRows(cells, blockAt);

      const geometry =
        buildFoldGeometry(
          width,
          height,
          (x, y) => buildingIds[y * width + x] === id,
          facadeRows,
          {
            style,
            overlayOnly,
            buildingAt: (x, y) => buildingIds[y * width + x],
            // Cada trecho do predio mede a propria fachada: predios
            // colados (Celadon) tem alturas diferentes.
            facadeRowsFor: (x0, x1, y0, y1) => {
              const part: Array<{ x: number; y: number }> = [];

              for (let y = y0; y <= y1; y++) {
                for (let x = x0; x <= x1; x++) {
                  part.push({ x, y });
                }
              }

              return measureFacadeRows(part, blockAt);
            },
          },
        );

      buildings.push({ id, ...box, facadeRows, geometry });
      parts.push(geometry);
    }

    // Montanhas e rochedos: caixas com a face em pe e o topo deitado.
    parts.push(
      buildFoldGeometry(
        width,
        height,
        (x, y) => masses[y * width + x] === 1,
        maxWallRows,
        {
          style,
          overlayOnly,
          boxes: true,
          sideStripFor: massSideStrips(width, height, masses, maxWallRows, metatileAt),
        },
      ),
    );
  }

  const structures =
    mergeFoldGeometries(parts);

  const details =
    buildGroundDetails(
      width,
      height,
      (x, y) => kinds[y * width + x] === CELL_LEDGE,
      () => false,
    );

  return {
    mask,
    kinds,
    buildingIds,
    groundSources,
    structures,
    details,
    buildings,
  };
}

// Objeto de interior que vira cartao em pe: grupo de ate 4 blocos solidos,
// no maximo 2x2, com chao em volta e desenho verde (planta).
const INTERIOR_PROP_MAX_CELLS = 4;
const INTERIOR_PROP_GREEN = 0.3;

function findInteriorProps(
  width: number,
  height: number,
  mask: Uint8Array,
  blockAt: (x: number, y: number) => VolumeBlock | undefined,
): Uint8Array {
  const props = new Uint8Array(width * height);
  const visited = new Uint8Array(width * height);

  const walkable = (x: number, y: number): boolean => {
    if (x < 0 || y < 0 || x >= width || y >= height) {
      return false;
    }

    const block = blockAt(x, y);

    return !!block && block.collision === 0;
  };

  for (let start = 0; start < mask.length; start++) {
    if (mask[start] !== FOLD_SOLID || visited[start]) {
      continue;
    }

    const component: number[] = [];
    const stack = [start];
    visited[start] = 1;

    while (stack.length > 0) {
      const cell = stack.pop() as number;
      const x = cell % width;
      const y = (cell - x) / width;

      component.push(cell);

      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx;
        const ny = y + dy;

        if (nx < 0 || ny < 0 || nx >= width || ny >= height) {
          continue;
        }

        const next = ny * width + nx;

        if (mask[next] === FOLD_SOLID && !visited[next]) {
          visited[next] = 1;
          stack.push(next);
        }
      }
    }

    if (component.length > INTERIOR_PROP_MAX_CELLS) {
      continue;
    }

    let minX = width;
    let maxX = -1;
    let minY = height;
    let maxY = -1;

    for (const cell of component) {
      const x = cell % width;
      const y = (cell - x) / width;

      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }

    if (maxX - minX > 1 || maxY - minY > 1) {
      continue;
    }

    // Solto: chao dos dois lados ou em cima e embaixo.
    const floorSides =
      (walkable(minX - 1, maxY) ? 1 : 0) +
      (walkable(maxX + 1, maxY) ? 1 : 0) +
      (walkable(minX, minY - 1) ? 1 : 0) +
      (walkable(minX, maxY + 1) ? 1 : 0);

    if (floorSides < 3) {
      continue;
    }

    // Cores do piso em volta (o fundo do desenho).
    const floor = new Set<number>();

    for (const [fx, fy] of [[minX - 1, maxY], [maxX + 1, maxY], [minX, maxY + 1]]) {
      if (!walkable(fx, fy)) {
        continue;
      }

      const pixels = blockAt(fx, fy)?.pixels;

      if (!pixels) {
        continue;
      }

      for (let offset = 0; offset < pixels.length; offset += 4) {
        floor.add(rgbKey(pixels, offset));
      }
    }

    let object = 0;
    let green = 0;

    for (const cell of component) {
      const pixels = blockAt(cell % width, Math.floor(cell / width))?.pixels;

      if (!pixels) {
        continue;
      }

      for (let offset = 0; offset < pixels.length; offset += 4) {
        if (pixels[offset + 3] < 128 || floor.has(rgbKey(pixels, offset))) {
          continue;
        }

        object++;

        if (
          pixels[offset + 1] > pixels[offset] + 16 &&
          pixels[offset + 1] >= pixels[offset + 2]
        ) {
          green++;
        }
      }
    }

    if (object > 0 && green >= object * INTERIOR_PROP_GREEN) {
      for (const cell of component) {
        props[cell] = 1;
      }
    }
  }

  return props;
}

/**
 * Interior: so fica com volume a sequencia vertical que tem chao andavel
 * logo ao sul (parede do fundo, moveis). As laterais e a parede de baixo
 * do comodo encostam no vazio ou na borda do mapa e ficam planas - de pe
 * elas cobririam o comodo diante da camera.
 */
function keepBackedRuns(
  width: number,
  height: number,
  mask: Uint8Array,
  isFloor: (x: number, y: number) => boolean,
): void {
  for (let x = 0; x < width; x++) {
    let y = 0;

    while (y < height) {
      if (!isVolumeCell(mask[y * width + x])) {
        y++;
        continue;
      }

      const y0 = y;

      while (y < height && isVolumeCell(mask[y * width + x])) {
        y++;
      }

      if (y < height && isFloor(x, y)) {
        continue;
      }

      for (let row = y0; row < y; row++) {
        mask[row * width + x] = 0;
      }
    }
  }
}

// Agua fica abaixo do chao, com barranco nas margens (como no Faithful).
export const WATER_DEPTH = 0.3;

/**
 * Comportamentos de agua (MB_*), com os mesmos numeros no RSE e no FRLG:
 * lagoa (10), agua semifunda/funda (11, 12) e mar (15). O mar fundo das
 * Ilhas Sevii, de Navel Rock e da Birth Island tem colisao e elevacao 0
 * (nao da para surfar ali) e sem esta lista subia como um bloco de mar com
 * paredes de agua.
 */
export const WATER_BEHAVIORS: ReadonlySet<number> = new Set([0x10, 0x11, 0x12, 0x15]);

const SHADE_BANK = 0.72;

/**
 * Chao do mapa: terra em 0, agua (elevacao 1 da grade da Gen 3) em
 * -WATER_DEPTH, com barrancos em pe onde terra encosta em agua. Os
 * barrancos usam a fileira de pixels da beira do tile de terra, esticada.
 *
 * Coordenadas locais do mapa (0..width, 0..height); `margin` estende as
 * bordas externas (contra a fresta de 1 pixel entre mapas vizinhos - a
 * textura repete o pixel da borda, ClampToEdge).
 */
export function buildGroundGeometry(
  width: number,
  height: number,
  isWater: (x: number, y: number) => boolean,
  margin: number,
): FoldGeometryData {
  const positions: number[] = [];
  const uvs: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];

  const uOf = (x: number): number => x / width;
  const vOf = (z: number): number => (height - z) / height;

  const quad = (
    corners: Array<[number, number, number]>,
    cornerUvs: Array<[number, number]>,
    shade: number,
  ): void => {
    const base = positions.length / 3;

    for (let corner = 0; corner < 4; corner++) {
      positions.push(...corners[corner]);
      uvs.push(...cornerUvs[corner]);
      colors.push(shade, shade, shade);
    }

    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  };

  const water = (x: number, y: number): boolean =>
    x >= 0 && y >= 0 && x < width && y < height && isWater(x, y);

  // Fora do mapa conta como agua para os barrancos: se o vizinho (outro
  // mapa ou padding) for agua, o barranco fecha o vao; se for terra, ele
  // fica escondido abaixo do chao.
  const lowAt = (x: number, y: number): boolean =>
    x < 0 || y < 0 || x >= width || y >= height || isWater(x, y);

  // Piso: faixas horizontais da mesma altura.
  for (let y = 0; y < height; y++) {
    let x = 0;

    while (x < width) {
      const lowered = water(x, y);
      const start = x;

      while (x < width && water(x, y) === lowered) {
        x++;
      }

      const h = lowered ? -WATER_DEPTH : 0;
      const left = start === 0 ? -margin : start;
      const right = x === width ? width + margin : x;
      const north = y === 0 ? -margin : y;
      const south = y === height - 1 ? height + margin : y + 1;

      quad(
        [
          [left, h, south],
          [right, h, south],
          [right, h, north],
          [left, h, north],
        ],
        [
          [uOf(left), vOf(south)],
          [uOf(right), vOf(south)],
          [uOf(right), vOf(north)],
          [uOf(left), vOf(north)],
        ],
        1,
      );
    }
  }

  // Barrancos: em cada borda entre terra e agua.
  const halfTexelU = 0.5 / (width * 16);
  const halfTexelV = 0.5 / (height * 16);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (water(x, y)) {
        continue;
      }

      // Sul (voltado para a camera): fileira de baixo do tile de terra.
      if (lowAt(x, y + 1)) {
        const v = vOf(y + 1) + halfTexelV;

        quad(
          [
            [x, -WATER_DEPTH, y + 1],
            [x + 1, -WATER_DEPTH, y + 1],
            [x + 1, 0, y + 1],
            [x, 0, y + 1],
          ],
          [
            [uOf(x), v],
            [uOf(x + 1), v],
            [uOf(x + 1), v],
            [uOf(x), v],
          ],
          SHADE_BANK,
        );
      }

      // Norte, oeste e leste.
      if (lowAt(x, y - 1)) {
        const v = vOf(y) - halfTexelV;

        quad(
          [
            [x + 1, -WATER_DEPTH, y],
            [x, -WATER_DEPTH, y],
            [x, 0, y],
            [x + 1, 0, y],
          ],
          [
            [uOf(x + 1), v],
            [uOf(x), v],
            [uOf(x), v],
            [uOf(x + 1), v],
          ],
          SHADE_BANK,
        );
      }

      for (const [dx, edgeX, u] of [
        [-1, x, uOf(x) + halfTexelU],
        [1, x + 1, uOf(x + 1) - halfTexelU],
      ] as const) {
        if (!lowAt(x + dx, y)) {
          continue;
        }

        quad(
          [
            [edgeX, -WATER_DEPTH, y + 1],
            [edgeX, -WATER_DEPTH, y],
            [edgeX, 0, y],
            [edgeX, 0, y + 1],
          ],
          [
            [u, vOf(y + 1)],
            [u, vOf(y)],
            [u, vOf(y)],
            [u, vOf(y + 1)],
          ],
          SHADE_BANK,
        );
      }
    }
  }

  return {
    positions: new Float32Array(positions),
    uvs: new Float32Array(uvs),
    colors: new Float32Array(colors),
    indices: new Uint32Array(indices),
    fullIndexCount: indices.length,
    quadCount: indices.length / 6,
  };
}

/**
 * Bloco impassavel com agua em pelo menos 2 dos 4 vizinhos (pedras no
 * mar, boias) passa a contar como agua: fica na altura da agua.
 */
export function markRocksInWater(
  width: number,
  height: number,
  water: Uint8Array,
  isBlocked: (x: number, y: number) => boolean,
): void {
  // Fora do mapa conta como agua (pedras na beira do mapa de mar), e
  // repete para fileiras de pedras se apoiarem umas nas outras.
  const wetAt = (x: number, y: number): boolean =>
    x < 0 || y < 0 || x >= width || y >= height || water[y * width + x] === 1;

  for (let pass = 0; pass < 12; pass++) {
    const add: number[] = [];

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const index = y * width + x;

        if (water[index] || !isBlocked(x, y)) {
          continue;
        }

        let wet = 0;
        let inside = 0;

        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          if (wetAt(x + dx, y + dy)) {
            wet++;

            const nx = x + dx;
            const ny = y + dy;

            if (nx >= 0 && ny >= 0 && nx < width && ny < height) {
              inside++;
            }
          }
        }

        // Pelo menos 2 vizinhos de agua, um deles dentro do mapa.
        if (wet >= 2 && inside >= 1) {
          add.push(index);
        }
      }
    }

    if (add.length === 0) {
      break;
    }

    for (const index of add) {
      water[index] = 1;
    }
  }
}


// Fracao da borda do tile com cor de chao para o bloco contar como
// natureza (arvore solta, cerca, placa, caixa de correio): o desenho tem
// grama em volta. Parede e telhado de predio sao opacos ate a borda.
const NATURAL_BORDER_FRACTION = 0.2;

// Natureza pelo bloco de borda (certa) ou so pela cor (pode ser quina de
// telhado arredondado - o predio absorve se estiver dentro dele).
const NATURE_CERTAIN = 2;
const NATURE_BY_COLOR = 1;

/**
 * Blocos com volume que sao NATUREZA (1) e nao predio: metatiles do bloco
 * de borda (a mata) ou desenho com fundo de chao encostando na borda.
 */
function markNaturalCells(
  width: number,
  height: number,
  mask: Uint8Array,
  blockAt: (x: number, y: number) => VolumeBlock | undefined,
  groundSources: Int32Array,
  natureMetatiles: ReadonlySet<number>,
): Uint8Array {
  const natural = new Uint8Array(width * height);
  const colorsBySource = new Map<number, Set<number>>();
  const verdicts = new Map<number, boolean>();

  const groundColors = (source: number): Set<number> => {
    const cached = colorsBySource.get(source);

    if (cached) {
      return cached;
    }

    const colors = new Set<number>();
    const pixels = blockAt(source % width, Math.floor(source / width))?.basePixels;

    if (pixels) {
      for (let offset = 0; offset < pixels.length; offset += 4) {
        if (pixels[offset + 3] >= 128) {
          colors.add((pixels[offset] << 16) | (pixels[offset + 1] << 8) | pixels[offset + 2]);
        }
      }
    }

    colorsBySource.set(source, colors);

    return colors;
  };

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index = y * width + x;

      if (!isVolumeCell(mask[index])) {
        continue;
      }

      const block = blockAt(x, y);

      if (!block) {
        continue;
      }

      if (natureMetatiles.has(block.metatileId)) {
        natural[index] = NATURE_CERTAIN;
        continue;
      }

      // Tile da cidade: predio (o teste de cor confundia a calcada cinza
      // de Celadon e os telhados verdes de Viridian com natureza). Cercas
      // da cidade grudadas no predio saem em findBuildings (linhas finas).
      if (block.secondary) {
        continue;
      }

      const source = groundSources[index];
      const pixels = block.basePixels;

      if (source < 0 || !pixels) {
        continue;
      }

      const key =
        block.metatileId * 4096 +
        (blockAt(source % width, Math.floor(source / width))?.metatileId ?? -1) + 1;

      const known = verdicts.get(key);

      if (known !== undefined) {
        if (known) {
          natural[index] = NATURE_BY_COLOR;
        }

        continue;
      }

      const colors = groundColors(source);
      let border = 0;
      let matching = 0;

      for (let i = 0; i < 16; i++) {
        for (const [px, py] of [[i, 0], [i, 15], [0, i], [15, i]]) {
          const offset = (py * 16 + px) * 4;
          border++;

          // So conta fundo VERDE (grama): calcada cinza tem as mesmas
          // cores das paredes de varios predios (Viridian, Celadon).
          const red = pixels[offset];
          const green = pixels[offset + 1];
          const blue = pixels[offset + 2];

          if (
            pixels[offset + 3] >= 128 &&
            green > red + 16 &&
            green >= blue &&
            colors.has((red << 16) | (green << 8) | blue)
          ) {
            matching++;
          }
        }
      }

      verdicts.set(key, matching >= border * NATURAL_BORDER_FRACTION);

      if (matching >= border * NATURAL_BORDER_FRACTION) {
        natural[index] = NATURE_BY_COLOR;
      }
    }
  }

  return natural;
}

// Maior predio aceito (tiles). Penhasco com caverna tambem tem porta.
const MAX_BUILDING_SPAN_X = 32;
const MAX_BUILDING_SPAN_Y = 24;

/**
 * Predios a partir das PORTAS (warps do cabecalho do mapa): cada porta
 * cresce sobre os blocos com volume que nao sao natureza. Arvores e
 * cercas encostadas na casa ficam de fora, e predios colados (Celadon)
 * deixam de virar um bloco gigante sem predio nenhum.
 */
function findBuildings(
  width: number,
  height: number,
  mask: Uint8Array,
  natural: Uint8Array,
  warps: ReadonlyArray<{ x: number; y: number }>,
  // O bloco e do tileset SECUNDARIO (o da cidade, onde ficam as casas).
  isSecondary: (index: number) => boolean = () => false,
  // O bloco virou chao de um modelo 3D solido (cerca): nao e chao aberto.
  isSolidModel: (index: number) => boolean = () => false,
): Int32Array {
  const ids = new Int32Array(width * height);

  // Grupos de natureza pela cor (arvore, arbusto, cerca, caixa de correio)
  // que estao SOLTOS: a maior parte da borda do grupo da para o chao. O
  // teste por bloco falhava em arvores e arbustos de 2x2 colados no predio
  // (o bloco do canto quase nao toca o chao) e em cercas que levam a uma
  // arvore encostada na casa - o predio engolia a mata e a cerca.
  const lone = new Uint8Array(width * height);

  {
    const visited = new Uint8Array(width * height);
    const isColorNature = (x: number, y: number): boolean =>
      x >= 0 &&
      y >= 0 &&
      x < width &&
      y < height &&
      isVolumeCell(mask[y * width + x]) &&
      natural[y * width + x] === NATURE_BY_COLOR;

    for (let start = 0; start < natural.length; start++) {
      const sx = start % width;
      const sy = (start - sx) / width;

      if (visited[start] || !isColorNature(sx, sy)) {
        continue;
      }

      const component: number[] = [];
      const stack = [start];
      let perimeter = 0;
      let open = 0;
      visited[start] = 1;

      while (stack.length > 0) {
        const cell = stack.pop() as number;
        const x = cell % width;
        const y = (cell - x) / width;

        component.push(cell);

        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = x + dx;
          const ny = y + dy;

          if (isColorNature(nx, ny)) {
            const next = ny * width + nx;

            if (!visited[next]) {
              visited[next] = 1;
              stack.push(next);
            }

            continue;
          }

          perimeter++;

          if (
            nx < 0 ||
            ny < 0 ||
            nx >= width ||
            ny >= height ||
            (mask[ny * width + nx] === 0 && !isSolidModel(ny * width + nx))
          ) {
            open++;
          }
        }
      }

      if (open * 2 >= perimeter) {
        for (const cell of component) {
          lone[cell] = 1;
        }
      }
    }
  }

  const candidate = (x: number, y: number): boolean =>
    x >= 0 &&
    y >= 0 &&
    x < width &&
    y < height &&
    isVolumeCell(mask[y * width + x]) &&
    natural[y * width + x] !== NATURE_CERTAIN &&
    // Natureza pela cor so fica de fora quando o grupo dela esta solto ao
    // lado do predio; o teste de cor erra em predios verdes (ginasio de
    // Viridian), cujas paredes nao dao para o chao.
    !(natural[y * width + x] === NATURE_BY_COLOR && lone[y * width + x] === 1);

  let nextId = 1;

  for (const warp of warps) {
    // Porta solida no proprio warp, ou warp passavel logo abaixo dela.
    const seeds = [
      [warp.x, warp.y],
      [warp.x, warp.y - 1],
    ].filter(([x, y]) => candidate(x, y));

    const seed = seeds[0];

    if (!seed || ids[seed[1] * width + seed[0]] !== 0) {
      continue;
    }

    const id = nextId++;
    const seedIndex = seed[1] * width + seed[0];
    const seedSecondary = isSecondary(seedIndex);
    let cells: number[] = [];
    let minX = width;
    let maxX = -1;
    let minY = height;
    let maxY = -1;

    // Cresce o predio a partir da porta. Contido: so blocos do tileset da
    // porta, e sem subir de um beiral (camada de cima, passavel) para um
    // bloco solido - o telhado acaba no beiral.
    const grow = (contained: boolean): void => {
      cells = [];
      minX = width;
      maxX = -1;
      minY = height;
      maxY = -1;

      const stack = [seedIndex];

      ids[seedIndex] = id;

      while (stack.length > 0) {
        const cell = stack.pop() as number;
        const x = cell % width;
        const y = (cell - x) / width;

        cells.push(cell);
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);

        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = x + dx;
          const ny = y + dy;

          if (!candidate(nx, ny)) {
            continue;
          }

          const next = ny * width + nx;

          if (
            contained &&
            (isSecondary(next) !== seedSecondary ||
              (dy === -1 && mask[cell] === FOLD_OVERHANG && mask[next] === FOLD_SOLID))
          ) {
            continue;
          }

          if (ids[next] === 0) {
            ids[next] = id;
            stack.push(next);
          }
        }
      }
    };

    const tooBig = (): boolean =>
      maxX - minX + 1 > MAX_BUILDING_SPAN_X ||
      maxY - minY + 1 > MAX_BUILDING_SPAN_Y;

    // Resultado contido aceito: tamanho de casa (3x3 ate o maximo de
    // predio) com a porta na linha de baixo.
    const houseShaped = (): boolean =>
      maxY === seed[1] &&
      maxX - minX + 1 >= 3 &&
      maxY - minY + 1 >= 3 &&
      maxX - minX + 1 <= MAX_BUILDING_WIDTH &&
      maxY - minY + 1 <= MAX_BUILDING_HEIGHT;

    grow(false);

    // Predio maior que uma casa, ou que engoliu arvores, saindo de uma
    // porta do tileset da cidade: a casa cresceu pela mata, pela cerca e
    // pelo morro em volta (Three Island: casa + arvores + morro num predio
    // so; duas casas e as arvores entre elas). Tenta a versao contida e
    // fica com ela se for uma casa com a porta embaixo.
    if (
      !tooBig() &&
      seedSecondary &&
      (maxX - minX + 1 > MAX_BUILDING_WIDTH ||
        maxY - minY + 1 > MAX_BUILDING_HEIGHT ||
        cells.some((cell) => natural[cell] === NATURE_BY_COLOR))
    ) {
      const wide = cells;

      for (const cell of wide) {
        ids[cell] = 0;
      }

      grow(true);

      if (!houseShaped()) {
        for (const cell of cells) {
          ids[cell] = 0;
        }

        grow(false);
      }
    }

    if (tooBig()) {
      for (const cell of cells) {
        ids[cell] = 0;
      }

      if (!seedSecondary) {
        continue;
      }

      // Segunda tentativa, contida, so para CASAS (porta do tileset da
      // cidade na linha de baixo, tamanho de casa): a casa encostada no
      // penhasco e na beira do mar (Cape Brink) crescia pelo penhasco
      // inteiro, passava do tamanho maximo e virava objeto em pe. Saidas
      // de area (Safari) tambem sao warps, com a mata acima ou abaixo -
      // essas continuam sem predio.
      grow(true);

      if (!houseShaped()) {
        for (const cell of cells) {
          ids[cell] = 0;
        }

        continue;
      }
    }

    const removed = new Set<number>();

    // Linhas finas grudadas no predio (cerca, sebe, fileira de postes do
    // tileset da cidade): bloco solido que nao esta em nenhum quadrado 2x2
    // do predio. Linha de 3 ou mais sai do predio e vira objeto em pe.
    {
      const inside = (x: number, y: number): boolean =>
        x >= 0 && y >= 0 && x < width && y < height && ids[y * width + x] === id;

      const thick = (x: number, y: number): boolean => {
        for (const [ox, oy] of [[0, 0], [-1, 0], [0, -1], [-1, -1]]) {
          const left = x + ox;
          const top = y + oy;

          if (
            inside(left, top) &&
            inside(left + 1, top) &&
            inside(left, top + 1) &&
            inside(left + 1, top + 1)
          ) {
            return true;
          }
        }

        return false;
      };

      const thin = new Set<number>();

      for (const cell of cells) {
        const x = cell % width;
        const y = (cell - x) / width;

        if (mask[cell] === FOLD_SOLID && !thick(x, y)) {
          thin.add(cell);
        }
      }

      const seen = new Set<number>();

      for (const start of thin) {
        if (seen.has(start)) {
          continue;
        }

        const component: number[] = [];
        const stack = [start];
        seen.add(start);

        while (stack.length > 0) {
          const cell = stack.pop() as number;
          const x = cell % width;
          const y = (cell - x) / width;

          component.push(cell);

          for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const nx = x + dx;
            const ny = y + dy;

            if (nx < 0 || ny < 0 || nx >= width || ny >= height) {
              continue;
            }

            const next = ny * width + nx;

            if (thin.has(next) && !seen.has(next)) {
              seen.add(next);
              stack.push(next);
            }
          }
        }

        if (component.length >= 3) {
          for (const cell of component) {
            ids[cell] = 0;
            removed.add(cell);
          }
        }
      }

      // Retangulo do que sobrou do predio.
      minX = width;
      maxX = -1;
      minY = height;
      maxY = -1;

      for (const cell of cells) {
        if (ids[cell] !== id) {
          continue;
        }

        const x = cell % width;
        const y = (cell - x) / width;

        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
      }
    }

    // Linhas de cima so com blocos do tileset PRIMARIO (arvore, grama com
    // colisao, beira de penhasco) num predio feito do tileset da cidade
    // nao sao do predio: em Five Island a arvore encostada no telhado
    // entrava na casa e a casa subia como uma torre. Predios de penhasco
    // (cavernas, ruinas de Tanoby) sao quase todos primarios e ficam como
    // estao.
    {
      let secondaryCells = 0;
      let primaryCells = 0;

      for (const cell of cells) {
        if (ids[cell] === id) {
          if (isSecondary(cell)) {
            secondaryCells++;
          } else {
            primaryCells++;
          }
        }
      }

      if (secondaryCells > primaryCells) {
        for (let y = minY; y <= maxY; y++) {
          const row = cells.filter((cell) => ids[cell] === id && Math.floor(cell / width) === y);

          if (row.length === 0 || row.some((cell) => isSecondary(cell))) {
            break;
          }

          for (const cell of row) {
            ids[cell] = 0;
            removed.add(cell);
          }

          minY = y + 1;
        }
      }
    }

    // Quinas: bloco com volume dentro do retangulo do predio que so foi
    // marcado como natureza pela cor (telhado arredondado do Centro
    // Pokemon do Emerald, com grama no canto) entra no predio.
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const cell = y * width + x;

        if (
          ids[cell] === 0 &&
          !removed.has(cell) &&
          isVolumeCell(mask[cell]) &&
          natural[cell] === NATURE_BY_COLOR
        ) {
          ids[cell] = id;
        }
      }
    }

    // Topo do telhado (so camada de cima) logo acima do predio.
    for (let x = minX; x <= maxX; x++) {
      for (let y = minY - 1; y >= 0; y--) {
        const cell = y * width + x;

        if (mask[cell] !== FOLD_OVERHANG || ids[cell] !== 0) {
          break;
        }

        ids[cell] = id;
      }
    }
  }

  return ids;
}
