import * as THREE from 'three';

import type { Gen3MetatileGraphics } from '../../gen3/Gen3StateAdapter';

import { buildGymModel, findGyms } from './GymModel';

import {
  buildPokemonCenterModel,
  findPokemonCenters,
  POKEMON_CENTER_HEIGHT,
  POKEMON_CENTER_WIDTH,
} from './PokemonCenterModel';

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
  kind: 'gym' | 'gym-small' | 'pokemon-center';
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

  // Chao no lugar de uma construcao: a camada de BAIXO dos proprios tiles
  // dela. O desenho do predio fica na camada de cima; a de baixo e o chao
  // do lugar (grama em Pewter e Fuchsia; calcada em Saffron, que troca
  // alguns tiles por variantes da cidade). Cada tile vira um metatile
  // sintetico so com essa camada.
  const clearGround = (x0: number, y0: number, w: number, h: number): void => {
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
  };

  const metatileAt = (x: number, y: number): number => blocks[y * width + x]?.metatileId ?? -1;

  for (const gym of findGyms(width, height, metatileAt)) {
    const art = blockArt(width, gym.x, gym.y, gym.width, GYM_HEIGHT, blocks, graphics);

    clearGround(gym.x, gym.y, gym.width, GYM_HEIGHT);

    const model = buildGymModel({ rgba: art, width: gym.width, door: gym.door });

    model.position.set(gym.x, 0, gym.y);
    buildings.push({ kind: gym.kind === 'viridian' ? 'gym-small' : 'gym', x: gym.x, y: gym.y, model });
  }

  for (const center of findPokemonCenters(width, height, metatileAt)) {
    const art = blockArt(
      width, center.x, center.y, POKEMON_CENTER_WIDTH, POKEMON_CENTER_HEIGHT, blocks, graphics,
    );

    clearGround(center.x, center.y, POKEMON_CENTER_WIDTH, POKEMON_CENTER_HEIGHT);

    const model = buildPokemonCenterModel({ rgba: art });

    model.position.set(center.x, 0, center.y);
    buildings.push({ kind: 'pokemon-center', x: center.x, y: center.y, model });
  }

  return { blocks: result, graphics: resultGraphics, buildings };
}
