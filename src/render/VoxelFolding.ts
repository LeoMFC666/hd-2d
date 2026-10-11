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

export interface FoldGeometryData {
  positions: Float32Array;
  uvs: Float32Array;
  indices: Uint32Array;
  quadCount: number;
}

interface Run {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

/**
 * @param isSolid  bloco que deve ganhar volume (ver PlayerRenderer)
 * @param maxWallRows  altura maxima da fachada, em blocos
 */
export function buildFoldGeometry(
  width: number,
  height: number,
  isSolid: (x: number, y: number) => boolean,
  maxWallRows: number,
): FoldGeometryData {
  // 1) Sequencias verticais por coluna.
  const columns: Array<Array<{ y0: number; y1: number }>> = [];

  for (let x = 0; x < width; x++) {
    const runs: Array<{ y0: number; y1: number }> = [];
    let start = -1;

    for (let y = 0; y <= height; y++) {
      const solid =
        y < height && isSolid(x, y);

      if (solid && start < 0) {
        start = y;
      } else if (!solid && start >= 0) {
        runs.push({ y0: start, y1: y - 1 });
        start = -1;
      }
    }

    columns.push(runs);
  }

  // 2) Junta colunas vizinhas com a MESMA sequencia num unico bloco: menos
  //    geometria e sem costura entre colunas da mesma casa.
  const merged: Run[] = [];
  const open = new Map<string, Run>();

  for (let x = 0; x < width; x++) {
    const next = new Map<string, Run>();

    for (const run of columns[x]) {
      const key = run.y0 + ':' + run.y1;
      const previous = open.get(key);

      if (previous && previous.x1 === x - 1) {
        previous.x1 = x;
        next.set(key, previous);
      } else {
        const created: Run = { x0: x, x1: x, y0: run.y0, y1: run.y1 };
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
  const indices: number[] = [];

  // v da textura: o mapa e assado de baixo para cima, entao a borda SUL
  // da linha r fica em v = (H-1-r)/H e a borda NORTE em (H-r)/H.
  const vSouth = (row: number): number => (height - 1 - row) / height;
  const vNorth = (row: number): number => (height - row) / height;
  const u = (column: number): number => column / width;

  const quad = (
    corners: Array<[number, number, number]>,
    cornerUvs: Array<[number, number]>,
  ): void => {
    const base = positions.length / 3;

    for (let index = 0; index < 4; index++) {
      positions.push(...corners[index]);
      uvs.push(...cornerUvs[index]);
    }

    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  };

  for (const run of merged) {
    const rows = run.y1 - run.y0 + 1;
    const wall = Math.min(rows, maxWallRows);
    const roofRows = rows - wall;

    const left = run.x0;
    const right = run.x1 + 1;
    const southZ = run.y1 + 1;

    const uLeft = u(left);
    const uRight = u(right);

    // Parede: linhas (y1-wall+1 .. y1), em pe na borda sul.
    const wallBottomV = vSouth(run.y1);
    const wallTopV = vNorth(run.y1 - wall + 1);

    quad(
      [
        [left, 0, southZ],
        [right, 0, southZ],
        [right, wall, southZ],
        [left, wall, southZ],
      ],
      [
        [uLeft, wallBottomV],
        [uRight, wallBottomV],
        [uRight, wallTopV],
        [uLeft, wallTopV],
      ],
    );

    // Teto: linhas (y0 .. y1-wall), na altura da parede, encostado nela.
    if (roofRows > 0) {
      const roofNorthZ = southZ - roofRows;
      const roofSouthV = vSouth(run.y1 - wall);
      const roofNorthV = vNorth(run.y0);

      quad(
        [
          [left, wall, southZ],
          [right, wall, southZ],
          [right, wall, roofNorthZ],
          [left, wall, roofNorthZ],
        ],
        [
          [uLeft, roofSouthV],
          [uRight, roofSouthV],
          [uRight, roofNorthV],
          [uLeft, roofNorthV],
        ],
      );
    }

    // Laterais: fecham o volume para a perspectiva nao mostrar o chao por
    // dentro. So existem quando ha teto - placas, cercas e ledges sao
    // cartoes finos, sem interior para esconder (lateral neles virava uma
    // "aba" escura esticando o contorno do sprite).
    //
    // Amostram a coluna CENTRAL do bloco da borda, esticada em z: no
    // contorno a arvore e quase toda transparente e virava uma "caixa de
    // vidro"; no centro ha folhagem, parede ou madeira opacas.
    if (roofRows > 0) {
      const northZ = southZ - roofRows;
      const westU = u(left + 0.5);
      const eastU = u(right - 0.5);

      quad(
        [
          [left, 0, northZ],
          [left, 0, southZ],
          [left, wall, southZ],
          [left, wall, northZ],
        ],
        [
          [westU, wallBottomV],
          [westU, wallBottomV],
          [westU, wallTopV],
          [westU, wallTopV],
        ],
      );

      quad(
        [
          [right, 0, southZ],
          [right, 0, northZ],
          [right, wall, northZ],
          [right, wall, southZ],
        ],
        [
          [eastU, wallBottomV],
          [eastU, wallBottomV],
          [eastU, wallTopV],
          [eastU, wallTopV],
        ],
      );
    }
  }

  return {
    positions: new Float32Array(positions),
    uvs: new Float32Array(uvs),
    indices: new Uint32Array(indices),
    quadCount: indices.length / 6,
  };
}
