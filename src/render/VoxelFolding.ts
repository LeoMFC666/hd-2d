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
    x >= 0 && x < width && mask[y * width + x] !== 0;

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
        ny >= 0 && added < maxRows && !mask[ny * width + x] && isOverhang(x, ny);
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

  // Cor por vertice (RGB): sombreamento por direcao da face. Sem ele todas
  // as faces tem a mesma luz e o volume nao le como 3D. Mesma ideia do
  // renderizador voxel do pokeemerald-dualscreen (topo claro, laterais
  // mais escuras).
  colors: Float32Array;

  // Indices: primeiro os quads com as DUAS camadas, depois os que so tem
  // camada de cima (topos de objetos, ver extendFoldMaskUpward). A malha da
  // camada de baixo desenha so os `fullIndexCount` primeiros.
  indices: Uint32Array;
  fullIndexCount: number;

  quadCount: number;
}

export interface FoldOptions {
  // Predio a que o bloco pertence (ver computeBuildingIds), 0 = nenhum.
  // Predio ganha telhado com caimento e uma fachada so; arvores e
  // penhascos ficam com o topo plano.
  buildingAt?: (x: number, y: number) => number;

  // Bloco que so desenha a camada de cima (FOLD_OVERHANG).
  overlayOnly?: (x: number, y: number) => boolean;
}

// Brilho de cada face. Topo pleno; fachada (voltada para a camera) um
// pouco abaixo; laterais mais escuras, oeste mais que leste.
const SHADE_TOP = 1.0;
const SHADE_SOUTH = 0.88;
const SHADE_EAST = 0.8;
const SHADE_WEST = 0.7;

// Quanto o telhado de um predio sobe por linha de telhado, em tiles, e o
// maximo que ele sobe no total. Sem o teto, um predio grande (o laboratorio
// de Littleroot) esticava a textura do telhado.
const ROOF_PITCH = 0.35;
const MAX_ROOF_RISE = 1.0;


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
 * @param isSolid  bloco que deve ganhar volume (mascara != 0)
 * @param maxWallRows  altura maxima da fachada, em blocos
 */
export function buildFoldGeometry(
  width: number,
  height: number,
  isSolid: (x: number, y: number) => boolean,
  maxWallRows: number,
  options: FoldOptions = {},
): FoldGeometryData {
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

  // 1b) Fachada unica por predio. Cada coluna dobrava na propria borda
  //     sul: uma coluna com um tile a mais na frente (a entrada do
  //     laboratorio de Littleroot) dobrava uma linha deslocada e virava uma
  //     faixa torta no meio do telhado. Agora a borda sul do predio e a
  //     mais comum entre as suas colunas; o que passa dela vira cartao.
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
      const key =
        run.y0 + ':' + run.y1 + ':' + (run.card ? 1 : 0) + ':' + run.overhangRows;

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

  for (const run of merged) {
    const rows = run.y1 - run.y0 + 1;
    const wall = Math.min(rows, maxWallRows);
    const roofRows = run.card ? 0 : rows - wall;

    const left = run.x0;
    const right = run.x1 + 1;
    const southZ = run.y1 + 1;
    const northZ = southZ - roofRows;

    const uLeft = u(left);
    const uRight = u(right);

    // Ultima linha (de cima para baixo) que so tem camada de cima.
    const overhangEnd = run.y0 + run.overhangRows - 1;

    const building =
      roofRows > 0 &&
      (buildingAt?.(run.x0, run.y1) ?? 0) > 0;

    // Altura do topo ao longo de z: plana, ou subindo para o norte nos
    // predios (telhado com caimento voltado para a camera).
    const pitch =
      Math.min(ROOF_PITCH, MAX_ROOF_RISE / Math.max(1, roofRows));

    const topAt = (z: number): number =>
      building
        ? wall + (southZ - z) * pitch
        : wall;

    // Parede: linhas (y1-wall+1 .. y1), em pe na borda sul; a linha r fica
    // entre as alturas (y1-r) e (y1-r+1). Linhas so de camada de cima (o
    // topo de uma caixa de correio) vao num quad separado.
    const wallTopRow = run.y1 - wall + 1;
    const wallSplit = Math.min(Math.max(overhangEnd + 1, wallTopRow), run.y1 + 1);

    const wallPiece = (rowTop: number, rowBottom: number, onlyOverlay: boolean): void => {
      if (rowTop > rowBottom) {
        return;
      }

      const hBottom = run.y1 - rowBottom;
      const hTop = run.y1 - rowTop + 1;

      quad(
        [
          [left, hBottom, southZ],
          [right, hBottom, southZ],
          [right, hTop, southZ],
          [left, hTop, southZ],
        ],
        [
          [uLeft, vSouth(rowBottom)],
          [uRight, vSouth(rowBottom)],
          [uRight, vNorth(rowTop)],
          [uLeft, vNorth(rowTop)],
        ],
        SHADE_SOUTH,
        onlyOverlay,
      );
    };

    wallPiece(wallTopRow, wallSplit - 1, true);
    wallPiece(wallSplit, run.y1, false);

    if (roofRows === 0) {
      // Placas, cercas, ledges: cartao fino, sem teto nem laterais.
      continue;
    }

    // Teto: linhas (y0 .. y1-wall), encostado no topo da parede; a linha r
    // fica em z = northZ + (r - y0).
    const roofPiece = (rowTop: number, rowBottom: number, onlyOverlay: boolean): void => {
      if (rowTop > rowBottom) {
        return;
      }

      const zNorth = northZ + (rowTop - run.y0);
      const zSouth = northZ + (rowBottom - run.y0) + 1;

      quad(
        [
          [left, topAt(zSouth), zSouth],
          [right, topAt(zSouth), zSouth],
          [right, topAt(zNorth), zNorth],
          [left, topAt(zNorth), zNorth],
        ],
        [
          [uLeft, vSouth(rowBottom)],
          [uRight, vSouth(rowBottom)],
          [uRight, vNorth(rowTop)],
          [uLeft, vNorth(rowTop)],
        ],
        SHADE_TOP,
        onlyOverlay,
      );
    };

    const roofBottomRow = run.y1 - wall;
    const roofSplit = Math.min(overhangEnd + 1, roofBottomRow + 1);

    roofPiece(run.y0, roofSplit - 1, true);
    roofPiece(Math.max(run.y0, roofSplit), roofBottomRow, false);

    // Laterais, um segmento por tile ao longo de z.
    //
    // Ate a altura da parede a lateral repete a FACHADA da coluna da quina
    // (a parede da casa continua do lado; numa mata, as arvores de pe
    // continuam do lado), espelhada para casar na quina. Antes a lateral
    // usava o tile do telhado em pe e virava listras/escadinha.
    const facadeBottomV = vSouth(run.y1);
    const facadeTopV = vNorth(run.y1 - wall + 1);

    // Empena dos predios (da parede ate o telhado inclinado): cor lisa,
    // o texel do meio do topo da fachada da quina. Repetir textura por
    // segmento num topo inclinado desenhava degraus.
    const gableWestU = u(left) + 0.5 / width;
    const gableEastU = u(right) - 0.5 / width;
    const gableV = facadeTopV - 0.5 / (height * 16);

    // A lateral fica atras do tile so de camada de cima do topo (se houver)
    // e nao precisa ir ate ele: comeca na primeira linha "de verdade".
    const sideNorthZ = northZ + Math.max(0, roofSplit - run.y0);

    for (let z = sideNorthZ; z < southZ; z++) {
      // Oeste (olhando de fora, o norte fica a esquerda). A borda u(left)
      // da fachada encosta na quina, no lado sul do segmento.
      quad(
        [
          [left, 0, z],
          [left, 0, z + 1],
          [left, wall, z + 1],
          [left, wall, z],
        ],
        [
          [u(left + 1), facadeBottomV],
          [uLeft, facadeBottomV],
          [uLeft, facadeTopV],
          [u(left + 1), facadeTopV],
        ],
        SHADE_WEST,
      );

      // Leste (olhando de fora, o sul fica a esquerda).
      quad(
        [
          [right, 0, z + 1],
          [right, 0, z],
          [right, wall, z],
          [right, wall, z + 1],
        ],
        [
          [uRight, facadeBottomV],
          [u(right - 1), facadeBottomV],
          [u(right - 1), facadeTopV],
          [uRight, facadeTopV],
        ],
        SHADE_EAST,
      );

      if (!building) {
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

    // Fundo do predio inclinado: fecha o vao entre o chao e a cumeeira,
    // na mesma cor lisa da empena.
    if (building) {
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
    if (!foldMask[start] || visited[start]) {
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
        if (next >= 0 && foldMask[next] && !visited[next]) {
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
