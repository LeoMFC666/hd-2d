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

  // Arvores da borda em cartoes com silhueta, como as matas do mapa
  // (textura de bakeBorderCard: uma arvore inteira, recortada no contorno
  // da copa da frente). Sem isto, o cartao mostra a ultima linha do padrao
  // e as de cima.
  cards?: BorderCardLayout;
}

export interface BorderCardLayout {
  // Linha de base das arvores no padrao da borda (pixels a partir do topo
  // da linha 0 do padrao), repetida a cada spanPx.
  linePx: number;
  spanPx: number;

  // Altura da textura do cartao (pixels): periodo + maior ponta de copa.
  heightPx: number;
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

  // Celula do padding de OUTRO mapa cuja borda nao tem arvores em cartao
  // (pedra, agua): pode receber o resto de uma arvore vizinha.
  const isForeignOpen = (gx: number, gz: number, index: number): boolean => {
    if (gx < 0 || gz < 0 || gx >= gridWidth || gz >= gridHeight) {
      return false;
    }

    const cell = gz * gridWidth + gx;
    const other = owner[cell];

    return (
      other >= 0 &&
      other !== index &&
      mapCells[cell] === 0 &&
      !maps[other].cards
    );
  };

  const emitCardPieces = (
    target: (typeof builders)[number],
    map: PaddingMapInput,
    layout: BorderCardLayout,
    left: number,
    right: number,
    north: number,
    minBase: number,
    uOf: (worldX: number) => number,
  ): void => {
    const { linePx, spanPx, heightPx } = layout;

    // Linhas de base no mundo (pixels): congruentes a esta.
    const lineWorld =
      (((linePx + 16 * map.z - 128) % spanPx) + spanPx) % spanPx;

    const rowTop = north * 16;
    let base =
      rowTop + 1 + ((((lineWorld - rowTop - 1) % spanPx) + spanPx) % spanPx);

    for (; base < rowTop + 16 + heightPx; base += spanPx) {
      if (base <= minBase) {
        continue;
      }

      // Alturas (pixels acima da base) dos pixels desta linha.
      const low = Math.max(0, base - rowTop - 16);
      const high = Math.min(heightPx, base - rowTop);

      if (high <= low) {
        continue;
      }

      const cardZ = base / 16 - 1 + CARD_Z;

      quad(
        target,
        [
          [left, low / 16, cardZ],
          [right, low / 16, cardZ],
          [right, high / 16, cardZ],
          [left, high / 16, cardZ],
        ],
        [
          [uOf(left), low / heightPx],
          [uOf(right), low / heightPx],
          [uOf(right), high / heightPx],
          [uOf(left), high / heightPx],
        ],
      );
    }
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

        // Cartoes com silhueta: cada linha de celulas mostra os pedacos das
        // arvores que caem nela, cada pedaco em pe na linha de base da sua
        // arvore (como os cartoes das matas do mapa). Pedaco por linha de
        // celulas: nenhum pixel sai duas vezes, e a ponta da arvore cuja
        // base ja esta dentro do mapa (acima da borda de cima dele) aparece.
        if (map.cards) {
          const layout = map.cards;

          emitCardPieces(target, map, layout, left, right, north, -Infinity, uOf);

          // Arvore cuja copa sobe para o padding de outro mapa sem arvores
          // (pedra, agua): o resto dela sai aqui mesmo, por cima da outra
          // borda, em vez de ficar cortada reta na divisa.
          const reach = Math.ceil(layout.heightPx / 16);
          let segmentStart = -1;

          for (let rise = 1; rise <= reach; rise++) {
            for (let x = gx; x <= end + 1; x++) {
              let open = x <= end;

              for (let step = 1; open && step <= rise; step++) {
                open = isForeignOpen(x, gz - step, index);
              }

              if (open && segmentStart < 0) {
                segmentStart = x;
              }

              if (!open && segmentStart >= 0) {
                emitCardPieces(
                  target,
                  map,
                  layout,
                  originX + segmentStart,
                  originX + x,
                  north - rise,
                  north * 16,
                  uOf,
                );

                segmentStart = -1;
              }
            }
          }

          gx = end + 1;
          continue;
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

/**
 * Forma das arvores da borda, tirada das matas do proprio mapa: as pilhas
 * com silhueta (VoxelFolding.buildPropGeometry) cujos blocos sao os da
 * borda dao a linha de base no padrao e o contorno de cada coluna. Assim as
 * arvores do padding continuam as do mapa com o mesmo corte. Sem pilha
 * medida que case com a borda, null (fica o cartao antigo).
 */
export function findBorderCardShape(
  shapes: readonly {
    x: number;
    y0: number;
    y1: number;
    period: number;
    phase: number;
    offsets: Uint8Array;
    quality: number;
  }[],
  metatileAt: (x: number, y: number) => number,
  borderIds: readonly number[],
  borderWidth: number,
  borderHeight: number,
): { linePx: number; spanPx: number; offsets: Uint8Array } | null {
  const span = borderHeight * 16;
  const lineVotes = new Map<number, number>();
  const samples: { column: number; line: number; quality: number; offsets: Uint8Array }[] = [];

  for (const shape of shapes) {
    if (shape.period !== borderHeight || shape.quality === 0) {
      continue;
    }

    // Coluna do padrao e deslocamento vertical que casam com os blocos da
    // pilha (a cabeca da mata, ponta sobre o chao, nao casa: maioria).
    let best = { column: -1, shift: 0, matches: 0 };

    for (let column = 0; column < borderWidth; column++) {
      for (let shift = 0; shift < borderHeight; shift++) {
        let matches = 0;

        for (let y = shape.y0; y <= shape.y1; y++) {
          const row = (y + shift) % borderHeight;

          if (metatileAt(shape.x, y) === borderIds[row * borderWidth + column]) {
            matches++;
          }
        }

        if (matches > best.matches) {
          best = { column, shift, matches };
        }
      }
    }

    const rows = shape.y1 - shape.y0 + 1;

    if (best.matches < 2 * borderHeight || best.matches * 10 < rows * 6) {
      continue;
    }

    const line = (((shape.phase + 16 * best.shift) % span) + span) % span;

    lineVotes.set(line, (lineVotes.get(line) ?? 0) + (shape.quality >= 2 ? 3 : 1));
    samples.push({ column: best.column, line, quality: shape.quality, offsets: shape.offsets });
  }

  if (lineVotes.size === 0) {
    return null;
  }

  const line =
    [...lineVotes.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0][0];

  const offsets = new Uint8Array(borderWidth * 16);

  for (let column = 0; column < borderWidth; column++) {
    const own = samples.filter((sample) => sample.column === column && sample.line === line);

    if (own.length === 0) {
      continue;
    }

    // As medidas na propria pilha valem mais; entre elas, a mediana.
    const top = Math.max(...own.map((sample) => sample.quality));
    const chosen = own.filter((sample) => sample.quality === top);

    for (let pixel = 0; pixel < 16; pixel++) {
      const values = chosen.map((sample) => sample.offsets[pixel]).sort((a, b) => a - b);

      offsets[column * 16 + pixel] = values[(values.length - 1) >> 1];
    }
  }

  return { linePx: line, spanPx: span, offsets };
}

/**
 * Textura do cartao das arvores da borda: uma arvore inteira por coluna,
 * de baixo (linha 0 = linha de base) para cima. A coluna de pixel c mostra
 * as linhas do padrao entre (base - periodo - ponta[c]) e (base - ponta[c]),
 * o mesmo recorte dos cartoes das matas do mapa. `artAt` devolve o pixel do
 * padrao (RGBA empacotado, 0 = transparente), com o chao ja recortado.
 */
export function bakeBorderCard(
  shape: { linePx: number; spanPx: number; offsets: Uint8Array },
  borderWidth: number,
  artAt: (px: number, py: number) => number,
): { pixels: Uint8ClampedArray; width: number; height: number } {
  const width = borderWidth * 16;
  const { linePx, spanPx, offsets } = shape;
  let maxOffset = 0;

  for (let column = 0; column < width; column++) {
    maxOffset = Math.max(maxOffset, offsets[column]);
  }

  const height = spanPx + maxOffset;
  const pixels = new Uint8ClampedArray(width * height * 4);

  for (let t = 0; t < height; t++) {
    const patternRow = (((linePx - 1 - t) % spanPx) + spanPx) % spanPx;

    for (let column = 0; column < width; column++) {
      if (t < offsets[column] || t >= offsets[column] + spanPx) {
        continue;
      }

      const color = artAt(column, patternRow);

      if (color === 0) {
        continue;
      }

      const offset = (t * width + column) * 4;

      pixels[offset] = (color >>> 24) & 0xff;
      pixels[offset + 1] = (color >>> 16) & 0xff;
      pixels[offset + 2] = (color >>> 8) & 0xff;
      pixels[offset + 3] = 0xff;
    }
  }

  return { pixels, width, height };
}
