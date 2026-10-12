/**
 * Padding do mundo: preenche o espaco vazio em volta dos mapas com o bloco
 * de borda de cada mapa, como o GBA faz fora dos limites do mapa.
 *
 * O QUE MUDOU EM RELACAO AOS PLANOS POR MAPA
 *   Antes cada mapa desenhava um retangulo inteiro de borda, e os
 *   retangulos se sobrepunham - empilhados em alturas diferentes para nao
 *   brigar por profundidade. Isso deixava buracos de um lado e borda
 *   errada do outro.
 *
 *   Agora o vazio e PARTILHADO: uma expansao (BFS de 8 vizinhos) parte das
 *   celulas de todos os mapas ao mesmo tempo, e cada celula vazia fica com
 *   o mapa que a alcancou primeiro - o mais proximo. Nenhuma celula tem dois
 *   donos, nenhuma celula ate o raio fica sem dono, e o padding nunca cobre
 *   um mapa vizinho.
 *
 * ALINHAMENTO
 *   O jogo escolhe o bloco de borda pela coordenada do mapa com o
 *   deslocamento interno de 7 (MAP_OFFSET) mais 1:
 *     coluna = (mapX + 8) mod larguraDaBorda
 *   Para borda 2x2 isso e (mapX mod 2); para as bordas 3x2 do FRLG faz
 *   diferenca. O padrao continua o da propria borda do mapa.
 *
 * ALTURA
 *   Borda solida (arvores, rochas) vira fileiras de cartoes em pe, como as
 *   arvores do proprio mapa. Borda passavel ou agua fica no chao.
 *
 * Modulo puro: devolve arrays prontos para BufferGeometry, em coordenadas
 * de MUNDO. UVs sao em unidades de bloco de borda, para textura com
 * RepeatWrapping (a textura e so o bloco de borda).
 */

export interface PaddingMapInput {
  key: string;

  // Posicao no mundo, em tiles.
  x: number;
  z: number;
  width: number;
  height: number;

  borderWidth: number;
  borderHeight: number;

  // Mapa espalha padding (ao ar livre e com borda resolvida). Mapas que
  // nao espalham ainda bloqueiam: ninguem pinta por cima deles.
  spreads: boolean;

  // Borda sobe na altura da dobra.
  raised: boolean;

  // Borda de agua: fica na altura da agua do mapa (abaixo do chao).
  lowered?: boolean;

  // Altura da agua (negativa) usada quando lowered.
  waterLevel?: number;
}

export interface PaddingMeshData {
  key: string;
  positions: Float32Array;
  uvs: Float32Array;

  // Brilho por vertice (RGB), o mesmo sombreamento por face da dobra.
  colors: Float32Array;

  indices: Uint32Array;
  cellCount: number;

  // Borda elevada (arvores em cartoes): chao separado debaixo deles, com
  // UV em tiles (1 repeticao por tile) para a textura do tile de chao.
  floor?: {
    positions: Float32Array;
    uvs: Float32Array;
    indices: Uint32Array;
  };
}

// Cartoes de arvore tem luz plena, como os de VoxelFolding.
const SHADE_TOP = 1.0;

// Cartao de arvore no centro da linha, como os objetos em pe do mapa
// (VoxelFolding.buildPropGeometry); o renderizador estica a malha na
// vertical como os sprites.
const CARD_Z = 0.5;

const NO_OWNER = -1;
const BLOCKED = -2;

export function buildPadding(
  maps: PaddingMapInput[],
  radius: number,
  raisedHeight: number,
): PaddingMeshData[] {
  if (maps.length === 0) {
    return [];
  }

  let minX = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxZ = -Infinity;

  for (const map of maps) {
    minX = Math.min(minX, map.x);
    minZ = Math.min(minZ, map.z);
    maxX = Math.max(maxX, map.x + map.width);
    maxZ = Math.max(maxZ, map.z + map.height);
  }

  const originX = minX - radius;
  const originZ = minZ - radius;
  const gridWidth = maxX - minX + radius * 2;
  const gridHeight = maxZ - minZ + radius * 2;

  const owner = new Int32Array(gridWidth * gridHeight).fill(NO_OWNER);
  const distance = new Int32Array(gridWidth * gridHeight);
  const queue = new Int32Array(gridWidth * gridHeight);
  let head = 0;
  let tail = 0;

  // Sementes: todas as celulas de todos os mapas.
  maps.forEach((map, index) => {
    for (let z = 0; z < map.height; z++) {
      for (let x = 0; x < map.width; x++) {
        const cell =
          (map.z + z - originZ) * gridWidth + (map.x + x - originX);

        if (owner[cell] !== NO_OWNER) {
          continue;
        }

        if (map.spreads) {
          owner[cell] = index;
          queue[tail++] = cell;
        } else {
          owner[cell] = BLOCKED;
        }
      }
    }
  });

  // Expansao: celula vazia fica com o mapa mais proximo (8 vizinhos =
  // distancia de Chebyshev, o mesmo "anel" que o GBA mostra em volta).
  const mapCells = new Uint8Array(gridWidth * gridHeight);

  for (let index = 0; index < tail; index++) {
    mapCells[queue[index]] = 1;
  }

  while (head < tail) {
    const cell = queue[head++];
    const cx = cell % gridWidth;
    const cz = (cell - cx) / gridWidth;

    if (distance[cell] >= radius) {
      continue;
    }

    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dz === 0) {
          continue;
        }

        const nx = cx + dx;
        const nz = cz + dz;

        if (nx < 0 || nz < 0 || nx >= gridWidth || nz >= gridHeight) {
          continue;
        }

        const next = nz * gridWidth + nx;

        if (owner[next] !== NO_OWNER) {
          continue;
        }

        owner[next] = owner[cell];
        distance[next] = distance[cell] + 1;
        queue[tail++] = next;
      }
    }
  }

  // Geometria por mapa: faixas horizontais de celulas do mesmo dono.
  const builders = maps.map(() => ({
    positions: [] as number[],
    uvs: [] as number[],
    colors: [] as number[],
    indices: [] as number[],
    cells: 0,
    floorPositions: [] as number[],
    floorUvs: [] as number[],
    floorIndices: [] as number[],
  }));

  const isPadding = (gx: number, gz: number, index: number): boolean => {
    if (gx < 0 || gz < 0 || gx >= gridWidth || gz >= gridHeight) {
      return false;
    }

    const cell = gz * gridWidth + gx;

    return owner[cell] === index && mapCells[cell] === 0;
  };

  const quad = (
    target: (typeof builders)[number],
    corners: number[][],
    cornerUvs: number[][],
    shade = SHADE_TOP,
  ): void => {
    const base = target.positions.length / 3;

    for (let corner = 0; corner < 4; corner++) {
      target.positions.push(...corners[corner]);
      target.uvs.push(...cornerUvs[corner]);
      target.colors.push(shade, shade, shade);
    }

    target.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  };

  for (let gz = 0; gz < gridHeight; gz++) {
    let gx = 0;

    while (gx < gridWidth) {
      const cell = gz * gridWidth + gx;
      const index = owner[cell];

      if (index < 0 || mapCells[cell] === 1) {
        gx++;
        continue;
      }

      let end = gx;

      while (end + 1 < gridWidth && isPadding(end + 1, gz, index)) {
        end++;
      }

      const map = maps[index];
      const target = builders[index];
      const left = originX + gx;
      const right = originX + end + 1;
      const north = originZ + gz;
      const south = north + 1;

      // Coordenada no padrao de borda (ver ALINHAMENTO). v cresce para o
      // norte porque o bloco e assado de baixo para cima.
      const uOf = (worldX: number): number =>
        (worldX - map.x + 8) / map.borderWidth;

      const vOf = (worldZ: number): number =>
        -(worldZ - map.z + 8) / map.borderHeight;

      target.cells += end - gx + 1;

      if (!map.raised) {
        const level =
          map.lowered ? map.waterLevel ?? 0 : 0;

        quad(
          target,
          [
            [left, level, south],
            [right, level, south],
            [right, level, north],
            [left, level, north],
          ],
          [
            [uOf(left), vOf(south)],
            [uOf(right), vOf(south)],
            [uOf(right), vOf(north)],
            [uOf(left), vOf(north)],
          ],
        );
      } else {
        // Borda solida (arvores): cartoes em pe, uma fileira por linha,
        // cada uma mostrando a propria linha e as de cima - o mesmo jeito
        // das arvores do mapa (VoxelFolding), como no Faithful. O chao
        // debaixo e o tile de chao do mapa (grama), em malha propria: o
        // fundo do desenho das arvores e recortado nos cartoes.
        {
          const base = target.floorPositions.length / 3;

          target.floorPositions.push(
            left, 0, south,
            right, 0, south,
            right, 0, north,
            left, 0, north,
          );

          target.floorUvs.push(
            left, -south,
            right, -south,
            right, -north,
            left, -north,
          );

          target.floorIndices.push(base, base + 1, base + 2, base, base + 2, base + 3);
        }

        // Uma arvore por bloco de borda: cartao so na ULTIMA linha do
        // padrao (o tronco), com a altura do bloco. Cartao em toda linha
        // repetia a copa, que aparecia pelos furos do recorte.
        const patternRow =
          (((north - map.z + 8) % map.borderHeight) + map.borderHeight) %
          map.borderHeight;

        const cardRows =
          patternRow === map.borderHeight - 1
            ? Math.max(raisedHeight, map.borderHeight)
            : 0;

        const cardZ = north + CARD_Z;

        for (let level = 0; level < cardRows; level++) {
          // Linha do padrao mostrada neste andar do cartao.
          const rowSouth = south - level;

          quad(
            target,
            [
              [left, level, cardZ],
              [right, level, cardZ],
              [right, level + 1, cardZ],
              [left, level + 1, cardZ],
            ],
            [
              [uOf(left), vOf(rowSouth)],
              [uOf(right), vOf(rowSouth)],
              [uOf(right), vOf(rowSouth - 1)],
              [uOf(left), vOf(rowSouth - 1)],
            ],
          );
        }
      }

      gx = end + 1;
    }
  }

  const result: PaddingMeshData[] = [];

  builders.forEach((builder, index) => {
    if (builder.cells === 0) {
      return;
    }

    result.push({
      key: maps[index].key,
      positions: new Float32Array(builder.positions),
      uvs: new Float32Array(builder.uvs),
      colors: new Float32Array(builder.colors),
      indices: new Uint32Array(builder.indices),
      cellCount: builder.cells,
      floor:
        builder.floorIndices.length > 0
          ? {
              positions: new Float32Array(builder.floorPositions),
              uvs: new Float32Array(builder.floorUvs),
              indices: new Uint32Array(builder.floorIndices),
            }
          : undefined,
    });
  });

  return result;
}

/**
 * O padding deste mapa sobe junto com a dobra?
 *
 * Nao da para usar a colisao do bloco de borda: o jogo grava a borda SEM
 * bits de colisao (forca impassavel na hora de ler fora do mapa). O dado
 * confiavel esta dentro do proprio mapa: os metatiles da borda aparecem
 * nas bordas internas (as arvores em volta de Pallet sao as mesmas da
 * borda). Se a maioria dessas ocorrencias ganhou volume na dobra, o
 * padding sobe junto e continua as arvores em pe. Agua e chao nunca
 * ganham volume, entao bordas de mar e de grama ficam no chao.
 */
export function isBorderRaised(
  borderMetatileIds: readonly number[],
  mapMetatileIds: Uint16Array,
  foldMask: Uint8Array,
): boolean {
  const borderSet = new Set(borderMetatileIds);
  let occurrences = 0;
  let folded = 0;

  for (let index = 0; index < mapMetatileIds.length; index++) {
    if (!borderSet.has(mapMetatileIds[index])) {
      continue;
    }

    occurrences++;

    if (foldMask[index] === 1) {
      folded++;
    }
  }

  return occurrences > 0 && folded * 2 >= occurrences;
}
