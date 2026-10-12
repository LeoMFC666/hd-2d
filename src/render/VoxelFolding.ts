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

  // Predio a que o bloco pertence (ver computeBuildingIds), 0 = nenhum.
  // Predio ganha fachada unica e telhado com caimento leve.
  buildingAt?: (x: number, y: number) => number;

  // Bloco que so desenha a camada de cima (FOLD_OVERHANG).
  overlayOnly?: (x: number, y: number) => boolean;

  // Interior: chao andavel. Movel solto tem chao logo acima; a parede do
  // fundo encosta no topo do mapa ou no vazio.
  isFloor?: (x: number, y: number) => boolean;
}

// Brilho de cada face. Topo pleno; fachada (voltada para a camera) um
// pouco abaixo; laterais mais escuras, oeste mais que leste.
const SHADE_TOP = 1.0;
const SHADE_SOUTH = 0.88;
const SHADE_EAST = 0.8;
const SHADE_WEST = 0.7;

// Quanto o telhado de um predio sobe por linha de telhado, em tiles, e o
// maximo que ele sobe no total.
const ROOF_PITCH = 0.35;
const MAX_ROOF_RISE = 1.0;

// Altura dos cartoes de arvore/pedra: cada linha mostra a si mesma e a de
// cima, em pe (2 tiles), como as arvores do Faithful.
const NATURAL_CARD_ROWS = 2;

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

  for (const run of merged) {
    const left = run.x0;
    const right = run.x1 + 1;

    // Ultima linha (de cima para baixo) que so tem camada de cima.
    const overhangEnd = run.y0 + run.overhangRows - 1;
    const isOverhangRow = (row: number): boolean => row <= overhangEnd;

    const building =
      (buildingAt?.(run.x0, run.y1) ?? 0) > 0;

    // ---- arvores, pedras, penhascos, placas, cercas: cartoes em pe ----
    if (style === 'outdoor' && !building && !run.card) {
      for (let row = run.y0; row <= run.y1; row++) {
        const z = row + 1;

        // A linha em si, do chao ate 1. Topo de objeto (so camada de cima)
        // nao ganha cartao proprio: ele ja aparece no cartao da linha de
        // baixo, e repetido apareceria pelos furos da copa.
        if (!isOverhangRow(row)) {
          standing(left, right, z, 0, 1, row, 1, false);
        }

        // As linhas de cima, empilhadas no mesmo cartao.
        for (let above = 1; above < NATURAL_CARD_ROWS; above++) {
          const upper = row - above;

          if (upper < run.y0) {
            break;
          }

          standing(left, right, z, above, above + 1, upper, 1, isOverhangRow(upper));
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
          : maxWallRows;

    const wall = Math.min(rows, wallLimit);
    const roofRows = run.card ? 0 : rows - wall;

    const southZ = run.y1 + 1;
    const northZ = southZ - roofRows;

    const pitched =
      building && style === 'outdoor' && roofRows > 0;

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
          [u(left + 1), facadeBottomV],
          [u(left), facadeBottomV],
          [u(left), facadeTopV],
          [u(left + 1), facadeTopV],
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
          [u(right), facadeBottomV],
          [u(right - 1), facadeBottomV],
          [u(right - 1), facadeTopV],
          [u(right), facadeTopV],
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
}

export interface BuildingVolume {
  id: number;

  // Celulas ocupadas (inclusive), em tiles do mapa.
  x0: number;
  y0: number;
  x1: number;
  y1: number;

  geometry: FoldGeometryData;
}

export interface MapVolume {
  // Mascara final (FOLD_*), para quem precisa saber o que subiu.
  mask: Uint8Array;

  // Arvores, pedras, cercas (ou, no interior, paredes e moveis).
  natural: FoldGeometryData;

  // Cada predio separado: o renderizador deixa transparente o que tapa o
  // jogador, como no Faithful.
  buildings: BuildingVolume[];

  // Ledges e grama alta em pe.
  details: FoldGeometryData;

  // Remendo de chao debaixo dos predios.
  patch: GroundPatchData | null;
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
): MapVolume {
  const mask =
    computeFoldMask(width, height, blockAt);

  classifyLedges(
    width,
    height,
    mask,
    (x, y) => blockAt(x, y)?.behavior ?? 0,
  );

  if (style === 'interior') {
    keepBackedRuns(width, height, mask, (x, y) => {
      const block = blockAt(x, y);

      return !!block && block.collision === 0;
    });
  } else {
    dropThinColumns(width, height, mask);
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
        block.hasForeground
      );
    },
  );

  const buildingIds =
    style === 'outdoor'
      ? computeBuildingIds(width, height, mask, warps)
      : new Int32Array(width * height);

  const overlayOnly = (x: number, y: number): boolean =>
    mask[y * width + x] === FOLD_OVERHANG;

  const natural =
    buildFoldGeometry(
      width,
      height,
      (x, y) =>
        isVolumeCell(mask[y * width + x]) &&
        buildingIds[y * width + x] === 0,
      maxWallRows,
      {
        style,
        overlayOnly,
        isFloor: (x, y) => {
          const block = blockAt(x, y);

          return !!block && block.collision === 0;
        },
      },
    );

  // Predios, um por um.
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

  const buildings: BuildingVolume[] = [];

  for (const [id, box] of bounds) {
    buildings.push({
      id,
      ...box,
      geometry:
        buildFoldGeometry(
          width,
          height,
          (x, y) => buildingIds[y * width + x] === id,
          maxWallRows,
          {
            style,
            overlayOnly,
            buildingAt: (x, y) => buildingIds[y * width + x],
          },
        ),
    });
  }

  const details =
    buildGroundDetails(
      width,
      height,
      (x, y) => mask[y * width + x] === FOLD_LEDGE,
      (x, y) =>
        style === 'outdoor' &&
        mask[y * width + x] === 0 &&
        blockAt(x, y)?.behavior === MB_TALL_GRASS,
    );

  // Remendo so debaixo dos predios: e onde a copia achatada aparecia. Em
  // arvores ele trocava a grama em volta por outro tile (manchas claras
  // em volta das ledges da Route 1).
  let patch: GroundPatchData | null = null;

  if (buildings.length > 0) {
    const ground =
      findGroundCell(width, height, mask, blockAt);

    if (ground) {
      const buildingMask = new Uint8Array(width * height);

      for (let index = 0; index < buildingMask.length; index++) {
        buildingMask[index] = buildingIds[index] > 0 ? 1 : 0;
      }

      patch = buildGroundPatch(width, height, buildingMask, ground);
    }
  }

  return { mask, natural, buildings, details, patch };
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
