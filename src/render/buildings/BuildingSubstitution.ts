import * as THREE from 'three';

import type { Gen3MetatileGraphics } from '../../gen3/Gen3StateAdapter';

import { buildGatehouseModel, findGatehouses, linkStackedGatehouses } from './GatehouseModel';
import { buildGymModel, findGyms } from './GymModel';
import { buildCityHouse, findCityHouses } from './CityHouseModels';
import { findLandmarks } from './LandmarkModels';

export { landmarkExtraMetatiles } from './LandmarkModels';
import { ROUTE_HOUSE_MOLD, buildRouteHouse, findMold } from './HouseModel';
import { Art } from './ModelKit';

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
  kind: 'gym' | 'gym-small' | 'pokemon-center' | 'poke-mart' | string;
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

/**
 * Arte de uma extensao (metatiles do mapa vizinho, desenho completo) em
 * cima da arte do bloco: as linhas novas vem primeiro.
 */
function withExtension(
  art: Uint8Array,
  w: number,
  rows: readonly (readonly number[])[],
  graphics: ReadonlyMap<number, Gen3MetatileGraphics | null>,
): Uint8Array {
  const top = new Uint8Array(w * PX * rows.length * PX * 4);

  rows.forEach((row, ty) => {
    row.forEach((id, tx) => {
      const pixels = graphics.get(id)?.pixels;

      if (!pixels || tx >= w) {
        return;
      }

      for (let sy = 0; sy < PX; sy++) {
        top.set(pixels.subarray(sy * PX * 4, (sy + 1) * PX * 4), ((ty * PX + sy) * w * PX + tx * PX) * 4);
      }
    });
  });

  const full = new Uint8Array(top.length + art.length);

  full.set(top, 0);
  full.set(art, top.length);

  return full;
}

/** Chao mais comum em volta do bloco (sem a linha de cima: calcada). */
/** Comportamentos de agua (lago, mar, corredeira, cachoeira, poca, alga). */
function isWaterBehavior(behavior: number): boolean {
  return (behavior >= 0x10 && behavior <= 0x1b) || behavior === 0x22;
}

function surroundingGround(
  width: number,
  height: number,
  x0: number,
  y0: number,
  w: number,
  h: number,
  blocks: readonly (Block | undefined)[],
  isWater: (metatileId: number) => boolean = () => false,
): Block | undefined {
  const counts = new Map<number, { block: Block; count: number }>();

  for (let y = y0; y <= y0 + h; y++) {
    for (let x = x0 - 1; x <= x0 + w; x++) {
      const inside = x >= x0 && x < x0 + w && y < y0 + h;

      if (inside || x < 0 || y < 0 || x >= width || y >= height) {
        continue;
      }

      const block = blocks[y * width + x];

      if (!block || block.collision !== 0 || isWater(block.metatileId)) {
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
  isWater: (metatileId: number) => boolean = () => false,
): Block | undefined {
  const counts = new Map<number, { block: Block; count: number }>();
  const visit = (x: number, y: number): void => {
    if (x < 0 || y < 0 || x >= width || y >= height) {
      return;
    }

    const block = blocks[y * width + x];

    // (A agua andavel de surfe nao e chao: a Mansao de Cinnabar, na beira
    // do mar, ficava com o mar debaixo dela.)
    if (!block || block.collision !== 0 || isWater(block.metatileId)) {
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
  const prepare = (
    x0: number,
    y0: number,
    w: number,
    h: number,
    // Celulas do bloco que sao da construcao (padrao: todas). As outras
    // ficam no mapa como estao e saem da arte do modelo (cercas e
    // arvores ao lado de um predio que nao e retangular).
    mask?: (col: number, row: number) => boolean,
    // Chao = so a camada de baixo de blocos ANDAVEIS (do entorno e de
    // dentro do bloco). Sem isso, um tile de parede repetido 3 vezes na
    // largura (portarias, casas compridas) era tomado por chao e sumia.
    walkableGround = false,
  ): Uint8Array => {
    const fallback = surroundingGround(width, height, x0, y0, w, h, blocks, isWaterId);
    const signatures = new Map<number, { count: number; metatileId: number }>();
    const cellSignature: number[] = [];
    const inMask = (col: number, row: number): boolean => !mask || mask(col, row);
    const walkable = new Set<number>();

    if (walkableGround) {
      for (let y = y0 - 1; y <= y0 + h; y++) {
        for (let x = x0 - 1; x <= x0 + w; x++) {
          if (x < 0 || y < 0 || x >= width || y >= height) {
            continue;
          }

          const inside = x >= x0 && y >= y0 && x < x0 + w && y < y0 + h;
          const block = blocks[y * width + x];
          const source = graphicsAt(x, y);

          if (block && source && block.collision === 0 && !isWaterBehavior(source.behavior) && (!inside || inMask(x - x0, y - y0))) {
            walkable.add(hashPixels(source.bottomPixels));
          }
        }
      }
    }

    for (let y = y0; y < y0 + h; y++) {
      for (let x = x0; x < x0 + w; x++) {
        const source = inMask(x - x0, y - y0) ? graphicsAt(x, y) : undefined;
        const signature = source ? hashPixels(source.bottomPixels) : -1;

        cellSignature.push(signature);

        if (source) {
          const entry = signatures.get(signature) ?? { count: 0, metatileId: source.metatileId };

          entry.count++;
          signatures.set(signature, entry);
        }
      }
    }

    const isGround = (signature: number): boolean =>
      walkableGround ? walkable.has(signature) && signatures.has(signature) : (signatures.get(signature)?.count ?? 0) >= 3;

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
    const outside = outsideGround(width, height, x0, y0, w, h, blocks, isWaterId);
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

        if (!inMask(col, row)) {
          for (let sy = 0; sy < PX; sy++) {
            for (let sx = 0; sx < PX; sx++) {
              art[((row * PX + sy) * w * PX + col * PX + sx) * 4 + 3] = 0;
            }
          }

          continue;
        }

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

  function isWaterId(metatileId: number): boolean {
    const behavior = graphics.get(metatileId)?.behavior;

    return behavior !== undefined && isWaterBehavior(behavior);
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

  // Portarias (casas de guarda entre rotas) e entradas do subterraneo.
  const gates = findGatehouses(width, height, metatileAt);

  linkStackedGatehouses(gates);

  for (const gate of gates) {
    if (gate.facadeless && gate.facadeless.wallHeight === 0) {
      continue;
    }

    const art = prepare(gate.x, gate.y, gate.width, gate.height, gate.mask, true);
    const model = buildGatehouseModel(Art.ofTiles(art, gate.width, gate.height), gate);

    model.position.set(gate.x, 0, gate.y);
    buildings.push({ kind: gate.kind, x: gate.x, y: gate.y, model });
  }

  // Casa de rota (tileset primario): Rotas 2, 12 e 16.
  for (const house of findMold(width, height, metatileAt, ROUTE_HOUSE_MOLD)) {
    const doorCol = metatileAt(house.x + 1, house.y + 2) === 0x03d ? 1 : 3;
    const art = prepare(house.x, house.y, 5, 3, undefined, true);
    const model = buildRouteHouse(Art.ofTiles(art, 5, 3), doorCol);

    model.position.set(house.x, 0, house.y);
    buildings.push({ kind: 'route-house', x: house.x, y: house.y, model });
  }

  // Casas das cidades. Nenhuma pode pegar celula de outra construcao ja
  // posta (os moldes de tilesets diferentes podem ter ids parecidos).
  const taken = new Set<number>();

  for (const building of buildings) {
    const bounds = new THREE.Box3().setFromObject(building.model);

    // Sem o beiral e as marquises (que passam um pouco da celula).
    for (let y = Math.floor(bounds.min.z + 0.3); y < Math.ceil(bounds.max.z - 0.3); y++) {
      for (let x = Math.floor(bounds.min.x + 0.3); x < Math.ceil(bounds.max.x - 0.3); x++) {
        taken.add(y * width + x);
      }
    }
  }

  // Construcoes unicas (laboratorio, museu, torre...): molde exato.
  for (const found of findLandmarks(width, height, metatileAt)) {
    const { landmark } = found;
    const inside = (col: number, row: number): boolean => !landmark.outside?.(col, row);
    let free = true;

    for (let row = 0; row < found.height && free; row++) {
      for (let col = 0; col < found.width && free; col++) {
        free = !inside(col, row) || !taken.has((found.y + row) * width + found.x + col);
      }
    }

    if (!free) {
      continue;
    }

    for (let row = 0; row < found.height; row++) {
      for (let col = 0; col < found.width; col++) {
        if (inside(col, row)) {
          taken.add((found.y + row) * width + found.x + col);
        }
      }
    }

    const art = prepare(found.x, found.y, found.width, found.height, landmark.outside ? inside : undefined, true);

    if (landmark.keep?.length) {
      const original = blockArt(width, found.x, found.y, found.width, found.height, blocks, graphics);
      const rowBytes = found.width * PX * 4;

      for (const [x0, y0, x1, y1] of landmark.keep) {
        for (let y = y0; y < y1; y++) {
          art.set(original.subarray(y * rowBytes + x0 * 4, y * rowBytes + x1 * 4), y * rowBytes + x0 * 4);
        }
      }
    }

    const extension = landmark.extension ?? [];
    const full = extension.length ? withExtension(art, found.width, extension, graphics) : art;
    const model = landmark.build(Art.ofTiles(full, found.width, found.height + extension.length));

    if (!model) {
      continue;
    }

    model.position.set(found.x, 0, found.y - extension.length);
    buildings.push({ kind: landmark.kind, x: found.x, y: found.y, model });
  }

  for (const house of findCityHouses(width, height, metatileAt)) {
    let free = true;

    for (let y = house.y; y < house.y + house.height && free; y++) {
      for (let x = house.x; x < house.x + house.width && free; x++) {
        free = !taken.has(y * width + x);
      }
    }

    if (!free) {
      continue;
    }

    for (let y = house.y; y < house.y + house.height; y++) {
      for (let x = house.x; x < house.x + house.width; x++) {
        taken.add(y * width + x);
      }
    }

    const art = prepare(house.x, house.y, house.width, house.height, undefined, true);
    const model = buildCityHouse(Art.ofTiles(art, house.width, house.height), house);

    model.position.set(house.x, 0, house.y);
    buildings.push({ kind: house.kind, x: house.x, y: house.y, model });
  }

  return { blocks: result, graphics: resultGraphics, buildings };
}
