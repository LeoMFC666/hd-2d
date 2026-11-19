import * as THREE from 'three';

import type { Gen3MetatileGraphics } from '../../gen3/Gen3StateAdapter';

import { buildGymModel, findGyms } from './GymModel';

import {
  buildPokemonCenterModel,
  findPokemonCenters,
  POKEMON_CENTER_HEIGHT,
  POKEMON_CENTER_WIDTH,
} from './PokemonCenterModel';

import {
  buildPokeMartModel,
  findPokeMarts,
  POKE_MART_HEIGHT,
  POKE_MART_WIDTH,
} from './PokeMartModel';

/**
 * Troca construcoes conhecidas por modelos 3D.
 *
 * Antes de montar o mapa, cada construcao reconhecida pelos metatiles
 * (por enquanto: ginasio do FRLG) sai do chao - os blocos dela viram o
 * chao em volta (grama) e deixam de contar para a dobra 2.5D - e um modelo
 * 3D feito com a propria arte do tileset vai no lugar.
 */

interface Block {
  metatileId: number;
  collision: number;
  elevation: number;
}

export interface PlacedBuilding {
  // gym = tipo Pewter (completo); gym-small = tipo Viridian (sem o trecho
  // da janela da direita).
  kind: 'gym' | 'gym-small' | 'pokemon-center' | 'poke-mart';
  // Canto noroeste do bloco, em metatiles do mapa.
  x: number;
  y: number;
  model: THREE.Group;
}

const PX = 16;

const GYM_HEIGHT = 5;

// Ids sinteticos para "so a camada de baixo deste metatile" (os reais vao
// ate 0x3FF).
const GROUND_ONLY_BASE = 0x4000;

/** Hash FNV-1a dos pixels (identifica camadas de baixo iguais). */
function hashPixels(pixels: Uint8ClampedArray): number {
  let hash = 0x811c9dc5;

  for (let index = 0; index < pixels.length; index++) {
    hash ^= pixels[index];
    hash = Math.imul(hash, 0x01000193);
  }

  return hash >>> 0;
}

/** Arte do bloco (largura x altura em metatiles), linhas de cima para baixo. */
function blockArt(
  width: number,
  x0: number,
  y0: number,
  w: number,
  h: number,
  blocks: readonly (Block | undefined)[],
  graphics: ReadonlyMap<number, Gen3MetatileGraphics | null>,
): Uint8Array {
  const art = new Uint8Array(w * PX * h * PX * 4);

  for (let ty = 0; ty < h; ty++) {
    for (let tx = 0; tx < w; tx++) {
      const block = blocks[(y0 + ty) * width + x0 + tx];
      const pixels = block ? graphics.get(block.metatileId)?.pixels : undefined;

      if (!pixels) {
        continue;
      }

      for (let sy = 0; sy < PX; sy++) {
        art.set(
          pixels.subarray(sy * PX * 4, (sy + 1) * PX * 4),
          ((ty * PX + sy) * w * PX + tx * PX) * 4,
        );
      }
    }
  }

  return art;
}

/** Chao mais comum em volta do bloco (sem a linha de cima: calcada). */
function surroundingGround(
  width: number,
  height: number,
  x0: number,
  y0: number,
  w: number,
  h: number,
  blocks: readonly (Block | undefined)[],
): Block | undefined {
  const counts = new Map<number, { block: Block; count: number }>();

  for (let y = y0; y <= y0 + h; y++) {
    for (let x = x0 - 1; x <= x0 + w; x++) {
      const inside = x >= x0 && x < x0 + w && y < y0 + h;

      if (inside || x < 0 || y < 0 || x >= width || y >= height) {
        continue;
      }

      const block = blocks[y * width + x];

      if (!block || block.collision !== 0) {
        continue;
      }

      const entry = counts.get(block.metatileId) ?? { block, count: 0 };

      entry.count++;
      counts.set(block.metatileId, entry);
    }
  }

  let best: { block: Block; count: number } | undefined;

  for (const entry of counts.values()) {
    if (!best || entry.count > best.count) {
      best = entry;
    }
  }

  return best?.block;
}

/**
 * Chao do entorno do bloco: o bloco andavel mais comum na linha de cima e
 * nas colunas dos lados (sem a linha de baixo, que costuma ser a calcada da
 * frente). E o chao que aparece atras e dos lados do modelo.
 */
function outsideGround(
  width: number,
  height: number,
  x0: number,
  y0: number,
  w: number,
  h: number,
  blocks: readonly (Block | undefined)[],
): Block | undefined {
  const counts = new Map<number, { block: Block; count: number }>();
  const visit = (x: number, y: number): void => {
    if (x < 0 || y < 0 || x >= width || y >= height) {
      return;
    }

    const block = blocks[y * width + x];

    if (!block || block.collision !== 0) {
      return;
    }

    const entry = counts.get(block.metatileId) ?? { block, count: 0 };

    entry.count++;
    counts.set(block.metatileId, entry);
  };

  for (let x = x0 - 1; x <= x0 + w; x++) {
    visit(x, y0 - 1);
  }

  for (let y = y0; y < y0 + h; y++) {
    visit(x0 - 1, y);
    visit(x0 + w, y);
  }

  let best: { block: Block; count: number } | undefined;

  for (const entry of counts.values()) {
    if (!best || entry.count > best.count) {
      best = entry;
    }
  }

  return best?.block;
}

/**
 * Procura as construcoes do mapa, devolve os blocos com o chao no lugar
 * delas e os modelos (posicionados no espaco do mapa: x leste, z sul).
 */
export function substituteBuildings<T extends Block>(
  family: string | null,
  width: number,
  height: number,
  blocks: readonly (T | undefined)[],
  graphics: ReadonlyMap<number, Gen3MetatileGraphics | null>,
): {
  blocks: (T | undefined)[];
  graphics: Map<number, Gen3MetatileGraphics | null>;
  buildings: PlacedBuilding[];
} {
  const result = blocks.slice();
  const resultGraphics = new Map(graphics);
  const buildings: PlacedBuilding[] = [];

  // Os metatiles do ginasio e do Centro Pokemon sao do tileset primario do
  // FRLG.
  if (family !== 'FRLG') {
    return { blocks: result, graphics: resultGraphics, buildings };
  }

  /**
   * (Centro Pokemon.) Prepara uma construcao: devolve a arte do predio SEM o chao e troca os
   * tiles dela pelo chao do lugar.
   *
   * O chao do lugar e a camada de BAIXO dos proprios tiles (grama em
   * Pewter e Fuchsia, calcada em Saffron). Mas alguns tiles desenham parte
   * do predio na camada de baixo (no Centro Pokemon a porta e o meio do
   * telhado estao nela). Por isso so conta como chao uma camada de baixo
   * que se repete em 3 ou mais tiles do bloco; os outros tiles recebem o
   * chao mais comum da mesma linha (ou do bloco). Na arte do modelo, todo
   * pixel que e igual ao chao escolhido para aquele tile (e sem nada da
   * camada de cima) vira transparente: nao sobra grama no telhado nem na
   * fachada.
   */
  const prepare = (x0: number, y0: number, w: number, h: number): Uint8Array => {
    const fallback = surroundingGround(width, height, x0, y0, w, h, blocks);
    const signatures = new Map<number, { count: number; metatileId: number }>();
    const cellSignature: number[] = [];

    for (let y = y0; y < y0 + h; y++) {
      for (let x = x0; x < x0 + w; x++) {
        const source = graphicsAt(x, y);
        const signature = source ? hashPixels(source.bottomPixels) : -1;

        cellSignature.push(signature);

        if (source) {
          const entry = signatures.get(signature) ?? { count: 0, metatileId: source.metatileId };

          entry.count++;
          signatures.set(signature, entry);
        }
      }
    }

    const isGround = (signature: number): boolean => (signatures.get(signature)?.count ?? 0) >= 3;

    const mostCommonGround = (cells: number[]): number | undefined => {
      let best: number | undefined;
      let bestCount = 0;

      for (const signature of cells) {
        const count = signatures.get(signature)?.count ?? 0;

        if (isGround(signature) && count > bestCount) {
          best = signature;
          bestCount = count;
        }
      }

      return best;
    };

    const blockGround = mostCommonGround(cellSignature);
    const art = blockArt(width, x0, y0, w, h, blocks, graphics);

    // O chao do proprio molde (camada de baixo dos tiles) serve para limpar
    // a arte; o que vai no CHAO do mapa segue o entorno quando ele e outro
    // (o Centro Pokemon de Saffron tem grama debaixo do telhado, mas a
    // cidade e calcada: sem isso aparecia uma faixa de grama atras dele).
    const outside = outsideGround(width, height, x0, y0, w, h, blocks);
    const outsideSource = outside ? graphics.get(outside.metatileId) : undefined;
    const ownGroundSource =
      blockGround === undefined ? undefined : graphics.get(signatures.get(blockGround)!.metatileId);
    const placeGround =
      outsideSource && ownGroundSource && hashPixels(outsideSource.bottomPixels) !== blockGround
        ? outsideSource
        : undefined;

    for (let row = 0; row < h; row++) {
      const rowCells = cellSignature.slice(row * w, row * w + w);
      const rowGround = mostCommonGround(rowCells) ?? blockGround;

      for (let col = 0; col < w; col++) {
        const x = x0 + col;
        const y = y0 + row;
        const original = blocks[y * width + x];
        const signature = rowCells[col];
        const groundSignature = isGround(signature) ? signature : rowGround;
        const groundEntry = groundSignature === undefined ? undefined : signatures.get(groundSignature);
        const groundSource = groundEntry ? graphics.get(groundEntry.metatileId) : undefined;

        if (!original) {
          continue;
        }

        if (!groundSource) {
          if (fallback) {
            result[y * width + x] = { ...original, metatileId: fallback.metatileId, collision: 0 } as T;
          }

          continue;
        }

        const floor = placeGround ?? groundSource;
        const id = GROUND_ONLY_BASE + floor.metatileId;

        if (!resultGraphics.has(id)) {
          const empty = new Uint8ClampedArray(floor.topPixels.length);

          resultGraphics.set(id, {
            ...floor,
            metatileId: id,
            layerType: 0,
            behavior: 0,
            pixels: floor.bottomPixels,
            basePixels: floor.bottomPixels,
            foregroundPixels: empty,
            topPixels: empty,
            topTileIds: [],
          });
        }

        result[y * width + x] = { ...original, metatileId: id, collision: 0 } as T;

        // Tira da arte o que e chao neste tile: pixels sem camada de cima
        // que sao do chao escolhido - ou de qualquer lugar da camada de
        // baixo, se ela propria e chao (grama com tufos diferentes).
        const own = graphicsAt(x, y);
        const ownIsGround = isGround(signature);
        const ground = groundSource.bottomPixels;

        for (let sy = 0; sy < PX; sy++) {
          for (let sx = 0; sx < PX; sx++) {
            const p = (sy * PX + sx) * 4;

            if (own && own.topPixels[p + 3] !== 0) {
              continue;
            }

            const a = ((row * PX + sy) * w * PX + col * PX + sx) * 4;

            if (ownIsGround) {
              art[a + 3] = 0;
              continue;
            }

            if (
              art[a] === ground[p] &&
              art[a + 1] === ground[p + 1] &&
              art[a + 2] === ground[p + 2]
            ) {
              art[a + 3] = 0;
            }
          }
        }
      }
    }

    // Tufos de grama desenhados na camada de cima no pe da fachada (ginasio
    // de Pewter): na ultima linha, pixel com cor da grama do chao (verde)
    // sai. As construcoes nao tem verde, e a calcada (Saffron) nao e verde.
    const groundColors = new Set<number>();
    const blockGroundSource =
      blockGround === undefined ? undefined : graphics.get(signatures.get(blockGround)!.metatileId);

    if (blockGroundSource) {
      const pixels = blockGroundSource.bottomPixels;

      for (let p = 0; p < pixels.length; p += 4) {
        if (pixels[p + 1] > pixels[p] + 16 && pixels[p + 1] > pixels[p + 2]) {
          groundColors.add((pixels[p] << 16) | (pixels[p + 1] << 8) | pixels[p + 2]);
        }
      }
    }

    {
      for (let y = (h - 1) * PX; y < h * PX; y++) {
        for (let x = 0; x < w * PX; x++) {
          const a = (y * w * PX + x) * 4;

          const green = art[a + 1] > art[a] + 16 && art[a + 1] > art[a + 2];

          if (green || groundColors.has((art[a] << 16) | (art[a + 1] << 8) | art[a + 2])) {
            art[a + 3] = 0;
          }
        }
      }
    }

    return art;
  };

  // Chao do ginasio: a camada de BAIXO dos proprios tiles dele (grama em
  // Pewter e Fuchsia; calcada em Saffron). Cada tile vira um metatile
  // sintetico so com essa camada.
  function groundFromOwnBottom(x0: number, y0: number, w: number, h: number): void {
    const ground = surroundingGround(width, height, x0, y0, w, h, blocks);

    for (let y = y0; y < y0 + h; y++) {
      for (let x = x0; x < x0 + w; x++) {
        const original = blocks[y * width + x];
        const source = original ? graphics.get(original.metatileId) : undefined;

        if (!original || !source) {
          if (original && ground) {
            result[y * width + x] = { ...original, metatileId: ground.metatileId, collision: 0 } as T;
          }

          continue;
        }

        const id = GROUND_ONLY_BASE + original.metatileId;

        if (!resultGraphics.has(id)) {
          const empty = new Uint8ClampedArray(source.topPixels.length);

          resultGraphics.set(id, {
            ...source,
            metatileId: id,
            layerType: 0,
            behavior: 0,
            pixels: source.bottomPixels,
            basePixels: source.bottomPixels,
            foregroundPixels: empty,
            topPixels: empty,
            topTileIds: [],
          });
        }

        result[y * width + x] = { ...original, metatileId: id, collision: 0 } as T;
      }
    }
  }

  function graphicsAt(x: number, y: number): Gen3MetatileGraphics | null | undefined {
    const block = blocks[y * width + x];

    return block ? graphics.get(block.metatileId) : undefined;
  }

  const metatileAt = (x: number, y: number): number => blocks[y * width + x]?.metatileId ?? -1;

  for (const gym of findGyms(width, height, metatileAt)) {
    // Ginasio: do jeito anterior (independente do Centro Pokemon) - arte
    // inteira e, no chao, a camada de baixo de cada tile dele.
    const art = blockArt(width, gym.x, gym.y, gym.width, GYM_HEIGHT, blocks, graphics);

    groundFromOwnBottom(gym.x, gym.y, gym.width, GYM_HEIGHT);

    const model = buildGymModel({ rgba: art, width: gym.width, door: gym.door });

    model.position.set(gym.x, 0, gym.y);
    buildings.push({ kind: gym.kind === 'viridian' ? 'gym-small' : 'gym', x: gym.x, y: gym.y, model });
  }

  for (const center of findPokemonCenters(width, height, metatileAt)) {
    const art = prepare(center.x, center.y, POKEMON_CENTER_WIDTH, POKEMON_CENTER_HEIGHT);

    const model = buildPokemonCenterModel({ rgba: art });

    model.position.set(center.x, 0, center.y);
    buildings.push({ kind: 'pokemon-center', x: center.x, y: center.y, model });
  }

  // Poke Mart: mesmo preparo do Centro Pokemon (chao por repeticao, arte
  // sem o chao); posicao e alturas saem da arte no proprio modelo.
  for (const mart of findPokeMarts(width, height, metatileAt)) {
    const art = prepare(mart.x, mart.y, POKE_MART_WIDTH, POKE_MART_HEIGHT);
    const model = buildPokeMartModel({ rgba: art });

    model.position.set(mart.x, 0, mart.y);
    buildings.push({ kind: 'poke-mart', x: mart.x, y: mart.y, model });
  }

  return { blocks: result, graphics: resultGraphics, buildings };
}
