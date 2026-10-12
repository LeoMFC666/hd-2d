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

    for (let z = sideNorthZ; z < southZ; z++) {
      quad(
        [
          [left, 0, z],
          [left, 0, z + 1],
          [left, wall, z + 1],
          [left, wall, z],
        ],
        [
          [u(sideWest + 1), facadeBottomV],
          [u(sideWest), facadeBottomV],
          [u(sideWest), facadeTopV],
          [u(sideWest + 1), facadeTopV],
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
          [u(sideEast + 1), facadeBottomV],
          [u(sideEast), facadeBottomV],
          [u(sideEast), facadeTopV],
          [u(sideEast + 1), facadeTopV],
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

      if (
        pixels[offset + 1] > pixels[offset] + 16 &&
        pixels[offset + 1] >= pixels[offset + 2]
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
      if (!mass[cell]) {
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
      if (!mass[y * width + x]) {
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

  for (const run of runs) {
    const pieces = columnUnits[run.x];
    const topPx = run.y0 * 16;
    const endPx = run.trimmedFrom * 16;

    if (run.trimmedFrom <= run.y1) {
      pieces.push([endPx, (run.y1 + 1) * 16]);
    }

    if (run.period === 0) {
      pieces.push([topPx, endPx]);
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
  const waterBehaviors = new Set<number>();

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
      ? findBuildings(width, height, mask, natural, warps)
      : new Int32Array(width * height);

  const masses =
    style === 'outdoor'
      ? findRockMasses(width, height, mask, buildingIds, blockAt, provisional)
      : new Uint8Array(width * height);

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
        { style, overlayOnly, boxes: true },
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
            mask[ny * width + nx] === 0
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
    const stack = [seed[1] * width + seed[0]];
    const cells: number[] = [];
    let minX = width;
    let maxX = -1;
    let minY = height;
    let maxY = -1;

    ids[stack[0]] = id;

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

        if (ids[next] === 0) {
          ids[next] = id;
          stack.push(next);
        }
      }
    }

    if (
      maxX - minX + 1 > MAX_BUILDING_SPAN_X ||
      maxY - minY + 1 > MAX_BUILDING_SPAN_Y
    ) {
      for (const cell of cells) {
        ids[cell] = 0;
      }

      continue;
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
