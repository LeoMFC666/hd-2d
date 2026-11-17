import * as THREE from 'three';

import type { Gen3MetatileGraphics } from '../../gen3/Gen3StateAdapter';

import { buildGymModel, findGyms, FRLG_GYM_TEMPLATE } from './GymModel';

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
  kind: 'gym';
  // Canto noroeste do bloco, em metatiles do mapa.
  x: number;
  y: number;
  model: THREE.Group;
}

const PX = 16;

const GYM_WIDTH = FRLG_GYM_TEMPLATE[0].length;

const GYM_HEIGHT = FRLG_GYM_TEMPLATE.length;

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
): { blocks: (T | undefined)[]; buildings: PlacedBuilding[] } {
  const result = blocks.slice();
  const buildings: PlacedBuilding[] = [];

  // Os metatiles do ginasio sao do tileset primario do FRLG.
  if (family !== 'FRLG') {
    return { blocks: result, buildings };
  }

  const gyms = findGyms(width, height, (x, y) => blocks[y * width + x]?.metatileId ?? -1);

  for (const gym of gyms) {
    const art = blockArt(width, gym.x, gym.y, GYM_WIDTH, GYM_HEIGHT, blocks, graphics);
    const ground = surroundingGround(width, height, gym.x, gym.y, GYM_WIDTH, GYM_HEIGHT, blocks);

    for (let y = gym.y; y < gym.y + GYM_HEIGHT; y++) {
      for (let x = gym.x; x < gym.x + GYM_WIDTH; x++) {
        const original = blocks[y * width + x];

        // Linha 0 (beirada): o tile de cima tem calcada na parte de cima;
        // vira o que esta logo acima dela. O resto vira o chao em volta.
        const above = y === gym.y && y > 0 ? blocks[(y - 1) * width + x] : undefined;
        const replacement = above ?? ground;

        if (original && replacement) {
          result[y * width + x] = { ...original, metatileId: replacement.metatileId, collision: 0 } as T;
        }
      }
    }

    const model = buildGymModel({ rgba: art });

    model.position.set(gym.x, 0, gym.y);
    buildings.push({ kind: 'gym', x: gym.x, y: gym.y, model });
  }

  return { blocks: result, buildings };
}
