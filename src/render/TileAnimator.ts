import type * as THREE from 'three';

import type {
  MemoryReader,
} from '../gen3/MemoryReader';

import type {
  MapDefinition,
} from '../gen3/world/MapDefinition';

import type {
  Gen3StateAdapter,
  TileAnimationSource,
} from '../gen3/Gen3StateAdapter';

import {
  RECIPE_BASE,
  RECIPE_BOTTOM,
  RECIPE_MERGED,
  RECIPE_OVERLAY,
  RECIPE_TOP,
  RECIPE_TOP_CUT,
  cutTopAgainstBottom,
} from './GroundSubstitution';

/**
 * Animacao de tiles (agua, borda da agua, flores, plantas e as animacoes
 * dos tilesets secundarios).
 *
 * PRINCIPIO: o animador nunca "pinta um tile por cima" do mapa. Ele
 * RECOMPOE a celula 8x8 inteira, camada por camada, com exatamente as
 * mesmas regras que Gen3StateAdapter usou para assar o mapa:
 *
 *   textura base   : [fundo 0x14, se NORMAL] -> camada de baixo ->
 *                    [camada de cima, se COVERED]
 *   textura overlay: [camada de cima, se NORMAL ou SPLIT]
 *
 * Com o voxel o mapa tem TRES texturas (chao, camada de cima do chao e
 * modelos em pe - ver GroundSubstitution.composeMapTextures), e cada bloco
 * diz em cada uma o que recompor (RECIPE_*): o chao debaixo de uma arvore
 * anima como o bloco de grama de onde veio, a flor em pe anima recortada.
 *
 * Pintar por cima foi o que apagava a borda da agua: a borda fica na
 * camada de CIMA de metatiles COVERED, e repintar o tile de agua animado
 * da camada de baixo depois cobria a borda. Recompondo a celula, a camada
 * de cima e reaplicada em seguida, como no jogo.
 *
 * DE ONDE VEM CADA COISA
 *   - estrutura dos metatiles, camadas, paletas, divisao primario/
 *     secundario (512 no RSE, 640 no FRLG): Gen3StateAdapter, as mesmas
 *     rotinas que montam o mapa. Nada disso e reimplementado aqui.
 *   - conteudo atual de cada tile: VRAM do emulador. Qualquer tile que o
 *     jogo anime aparece la, seja do tileset primario ou do secundario -
 *     nao ha faixa fixa de tiles "animaveis".
 *
 * PROTECAO CONTRA BATALHA/MENUS
 *   Fora do overworld a VRAM de tiles e reaproveitada (caixa de texto de
 *   batalha, telas de bolsa e party). Antes de repintar, o animador
 *   confere os tiles de numero baixo (abaixo de 416, onde o jogo nao
 *   anima nada) contra o ROM: se divergirem, a VRAM nao esta mostrando
 *   este mapa e o quadro e ignorado. Assim o mapa 3D nunca recebe lixo.
 */

const GBA_VRAM_BASE =
  0x06000000;

const TILE_BYTES =
  32;

const TILE_PIXELS =
  8;

const TILE_AREA =
  TILE_PIXELS * TILE_PIXELS;

const METATILE_PIXELS =
  16;

const LAYER_TYPE_NORMAL =
  0;

const LAYER_TYPE_COVERED =
  1;

const LAYER_TYPE_SPLIT =
  2;

// Abaixo deste tile o jogo nao anima nada nos tilesets gerais (RSE e FRLG
// animam a partir do 416). Divergencia aqui significa que a VRAM nao esta
// com o mapa: batalha, menu de tela cheia ou transicao.
const FIRST_ANIMATED_GENERAL_TILE =
  416;

// Tolerancia de tiles baixos divergentes antes de considerar que a VRAM
// nao e do overworld (hackroms as vezes animam algo fora do padrao).
const LOW_TILE_MISMATCH_ABSOLUTE =
  2;

const LOW_TILE_MISMATCH_RATIO =
  0.05;

const POLL_INTERVAL_MS =
  50;

interface LayerRef {
  tileId: number;
  palette: number;
  hFlip: boolean;
  vFlip: boolean;
}

// Uma celula 8x8 de um metatile numa das texturas. Todos os blocos do
// mapa que usam o mesmo metatile compartilham a receita: a celula e
// composta uma vez e copiada para cada bloco.
interface CellRecipe {
  // Textura (indice em targets).
  target: number;

  // Quadrante 8x8 (0-3), ou -1 para o bloco 16x16 inteiro (recorte).
  quadrant: number;
  layers: LayerRef[];

  // Bloco inteiro: camadas de cima e de baixo por quadrante; o resultado e
  // a de cima sem os pixels iguais aos da de baixo (a partir da borda).
  cutTop?: LayerRef[][];
  cutBottom?: LayerRef[][];

  blocks: number[];
}

/** Uma textura animada e, por bloco, o metatile e a receita. */
export interface AnimatedTarget {
  texture: THREE.DataTexture;
  metatileIds: Int32Array;
  recipes: Uint8Array;
}

interface TargetState {
  texture: THREE.DataTexture;
  pixels: Uint8Array | null;
}

export class TileAnimator {
  private readonly memoryReader: MemoryReader;

  private readonly adapter: Gen3StateAdapter;

  private activeKey: string | null = null;

  private mapWidth = 0;

  private mapHeight = 0;

  private targets: TargetState[] = [];

  private recipes: CellRecipe[] = [];

  private recipesByTile =
    new Map<number, number[]>();

  // Verdade do ROM para cada tile referenciado (indices 0-15).
  private romTiles =
    new Map<number, Uint8Array>();

  // O que esta pintado AGORA nas texturas, por tile. Comeca igual ao ROM,
  // porque o mapa foi assado a partir do ROM.
  private paintedTiles =
    new Map<number, Uint8Array>();

  private palettes: Array<Uint8Array | null> = [];

  private referencedTiles: number[] = [];

  // Tiles abaixo de 416 com verdade no ROM: os do mapa mais as sentinelas
  // do inicio do tileset. Usados so para decidir se a VRAM e do overworld.
  private gateTiles: number[] = [];

  private lastPollAt = 0;

  private disabled = false;

  // Resultado da ultima verificacao da VRAM contra o ROM: a tela do GBA
  // esta mostrando este mapa (overworld)? Usado pela interface para saber
  // quando sobrepor so as janelas e quando mostrar a tela inteira.
  private gateOpen = false;

  private gateReported = false;

  private firstFrameReported = false;

  private readonly vramScratch =
    new Uint8Array(TILE_AREA);

  private readonly cellScratch =
    new Uint8Array(TILE_AREA * 4);

  private readonly blockTop =
    new Uint8Array(METATILE_PIXELS * METATILE_PIXELS * 4);

  private readonly blockBottom =
    new Uint8Array(METATILE_PIXELS * METATILE_PIXELS * 4);

  constructor(
    memoryReader: MemoryReader,
    adapter: Gen3StateAdapter,
  ) {
    this.memoryReader = memoryReader;
    this.adapter = adapter;
  }

  /**
   * Passa a animar este mapa. Chamar todo frame e seguro: sai na hora se
   * o mapa ja e o ativo.
   */
  setActiveMap(
    key: string,
    map: MapDefinition,
    targets: AnimatedTarget[],
  ): void {
    if (this.activeKey === key) {
      return;
    }

    this.clear();

    this.activeKey = key;

    const used =
      new Set<number>();

    for (const target of targets) {
      for (const id of target.metatileIds) {
        if (id >= 0) {
          used.add(id);
        }
      }
    }

    const source =
      this.adapter.getTileAnimationSource(
        map.primaryTilesetAddress,
        map.secondaryTilesetAddress,
        used,
      );

    if (!source) {
      console.warn(
        '[anim] mapa',
        key,
        '- tilesets nao resolvidos; sem animacao.',
      );

      return;
    }

    this.targets =
      targets.map((target) => ({
        texture: target.texture,
        pixels:
          (target.texture.image as { data?: Uint8Array }).data ?? null,
      }));

    this.mapWidth = map.width;
    this.mapHeight = map.height;

    this.buildRecipes(
      targets,
      source,
    );

    console.log(
      '[anim] mapa',
      key,
      '- celulas:',
      this.recipes.length,
      '| tiles referenciados:',
      this.referencedTiles.length,
    );
  }

  /**
   * A tela do GBA mostra o overworld deste mapa? (false em batalha, bolsa,
   * party, tela titulo, ou antes de qualquer mapa ser registrado)
   */
  isShowingMap(): boolean {
    return (
      !this.disabled &&
      this.referencedTiles.length > 0 &&
      this.gateOpen
    );
  }

  clear(): void {
    this.activeKey = null;
    this.targets = [];
    this.recipes = [];
    this.recipesByTile = new Map();
    this.romTiles = new Map();
    this.paintedTiles = new Map();
    this.palettes = [];
    this.referencedTiles = [];
    this.gateTiles = [];
    this.gateReported = false;
    this.firstFrameReported = false;
  }

  /**
   * Seguro de chamar todo frame: limita a frequencia e, se algo der
   * errado, desliga a animacao em vez de derrubar o loop de render.
   */
  update(): void {
    if (
      this.disabled ||
      this.referencedTiles.length === 0
    ) {
      return;
    }

    const now =
      performance.now();

    if (
      now - this.lastPollAt < POLL_INTERVAL_MS
    ) {
      return;
    }

    this.lastPollAt = now;

    try {
      this.poll();
    } catch (error) {
      this.disabled = true;

      console.warn(
        '[anim] desligada apos erro:',
        error,
      );
    }
  }

  // ----------------------------------------------------------------------

  private buildRecipes(
    targets: AnimatedTarget[],
    source: TileAnimationSource,
  ): void {
    const background: LayerRef = {
      tileId: source.backgroundTileId,
      palette: source.backgroundPalette,
      hFlip: false,
      vFlip: false,
    };

    targets.forEach((target, targetIndex) => {
      // Blocos por (metatile, receita): a celula e composta uma vez.
      const groups =
        new Map<number, number[]>();

      for (
        let blockIndex = 0;
        blockIndex < target.metatileIds.length;
        blockIndex++
      ) {
        const metatileId =
          target.metatileIds[blockIndex];

        const recipe =
          target.recipes[blockIndex];

        if (metatileId < 0 || recipe === 0) {
          continue;
        }

        const groupKey =
          metatileId * 16 + recipe;

        let blocks =
          groups.get(groupKey);

        if (!blocks) {
          blocks = [];
          groups.set(groupKey, blocks);
        }

        blocks.push(blockIndex);
      }

      for (
        const [groupKey, blocks] of groups
      ) {
        const metatileId =
          Math.floor(groupKey / 16);

        const recipe =
          groupKey % 16;

        const layout =
          source.layouts.get(metatileId);

        if (!layout) {
          continue;
        }

        const layerType =
          layout.layerType;

        // Outros layerTypes nao sao desenhados pelo adapter; mantem igual.
        if (
          layerType !== LAYER_TYPE_NORMAL &&
          layerType !== LAYER_TYPE_COVERED &&
          layerType !== LAYER_TYPE_SPLIT
        ) {
          continue;
        }

        const bottomLayers = (quadrant: number): LayerRef[] =>
          layerType === LAYER_TYPE_NORMAL
            ? [background, layout.tiles[quadrant]]
            : [layout.tiles[quadrant]];

        if (recipe === RECIPE_TOP_CUT) {
          this.addRecipe({
            target: targetIndex,
            quadrant: -1,
            layers: [],
            cutTop: [0, 1, 2, 3].map((quadrant) => [layout.tiles[quadrant + 4]]),
            cutBottom: [0, 1, 2, 3].map(bottomLayers),
            blocks,
          });

          continue;
        }

        for (
          let quadrant = 0;
          quadrant < 4;
          quadrant++
        ) {
          const top =
            layout.tiles[quadrant + 4];

          let layers: LayerRef[] | null = null;

          if (recipe === RECIPE_BASE) {
            layers =
              layerType === LAYER_TYPE_COVERED
                ? [...bottomLayers(quadrant), top]
                : bottomLayers(quadrant);
          } else if (recipe === RECIPE_OVERLAY) {
            layers =
              layerType === LAYER_TYPE_NORMAL ||
              layerType === LAYER_TYPE_SPLIT
                ? [top]
                : null;
          } else if (recipe === RECIPE_BOTTOM) {
            layers = bottomLayers(quadrant);
          } else if (recipe === RECIPE_TOP) {
            layers = [top];
          } else if (recipe === RECIPE_MERGED) {
            layers = [...bottomLayers(quadrant), top];
          }

          if (!layers) {
            continue;
          }

          this.addRecipe({
            target: targetIndex,
            quadrant,
            layers,
            blocks,
          });
        }
      }
    });

    this.palettes =
      source.palettes;

    this.romTiles =
      source.romTiles;

    // So tiles com verdade no ROM entram: o adapter nao desenha tile que
    // nao resolve, entao o animador tambem nao.
    for (
      const tileId of this.recipesByTile.keys()
    ) {
      const rom =
        source.romTiles.get(tileId);

      if (!rom) {
        continue;
      }

      this.paintedTiles.set(tileId, Uint8Array.from(rom));
      this.referencedTiles.push(tileId);
    }

    for (
      const tileId of source.romTiles.keys()
    ) {
      if (tileId < FIRST_ANIMATED_GENERAL_TILE) {
        this.gateTiles.push(tileId);
      }
    }
  }

  private addRecipe(
    recipe: CellRecipe,
  ): void {
    const index =
      this.recipes.length;

    this.recipes.push(recipe);

    const allLayers = [
      ...recipe.layers,
      ...(recipe.cutTop ?? []).flat(),
      ...(recipe.cutBottom ?? []).flat(),
    ];

    for (
      const layer of allLayers
    ) {
      let list =
        this.recipesByTile.get(layer.tileId);

      if (!list) {
        list = [];
        this.recipesByTile.set(layer.tileId, list);
      }

      if (list[list.length - 1] !== index) {
        list.push(index);
      }
    }
  }

  private poll(): void {
    // 1) A VRAM esta mostrando este mapa? Confere os tiles que nunca
    //    animam contra o ROM antes de tocar em qualquer textura.
    let lowMismatch = 0;

    for (
      const tileId of this.gateTiles
    ) {
      const rom =
        this.romTiles.get(tileId);

      if (
        rom &&
        !sameIndices(this.readVramTile(tileId), rom)
      ) {
        lowMismatch++;
      }
    }

    const tolerance =
      Math.max(
        LOW_TILE_MISMATCH_ABSOLUTE,
        Math.ceil(this.gateTiles.length * LOW_TILE_MISMATCH_RATIO),
      );

    this.gateOpen =
      lowMismatch <= tolerance;

    if (lowMismatch > tolerance) {
      if (!this.gateReported) {
        this.gateReported = true;

        console.log(
          '[anim] VRAM fora do overworld (',
          lowMismatch,
          'tiles base divergem do ROM ); aguardando.',
        );
      }

      return;
    }

    // 2) Quais tiles do mapa mudaram desde a ultima pintura.
    const changedTiles: number[] = [];

    const freshTiles =
      new Map<number, Uint8Array>();

    for (
      const tileId of this.referencedTiles
    ) {
      const vram =
        this.readVramTile(tileId);

      const painted =
        this.paintedTiles.get(tileId);

      if (
        painted &&
        !sameIndices(vram, painted)
      ) {
        changedTiles.push(tileId);
        freshTiles.set(tileId, Uint8Array.from(vram));
      }
    }

    if (changedTiles.length === 0) {
      return;
    }

    for (
      const [tileId, indices] of freshTiles
    ) {
      this.paintedTiles.set(tileId, indices);
    }

    const dirty =
      new Set<number>();

    for (
      const tileId of changedTiles
    ) {
      for (
        const recipeIndex of this.recipesByTile.get(tileId) ?? []
      ) {
        dirty.add(recipeIndex);
      }
    }

    const touched =
      new Set<number>();

    for (
      const recipeIndex of dirty
    ) {
      const recipe =
        this.recipes[recipeIndex];

      if (
        this.paintRecipe(recipe)
      ) {
        touched.add(recipe.target);
      }
    }

    for (const targetIndex of touched) {
      this.targets[targetIndex].texture.needsUpdate = true;
    }

    if (!this.firstFrameReported) {
      this.firstFrameReported = true;

      console.log(
        '[anim] primeiro quadro aplicado:',
        changedTiles.length,
        'tiles mudaram,',
        dirty.size,
        'celulas recompostas.',
      );
    }
  }

  /**
   * Compoe a celula 8x8 e copia para todos os blocos que usam o metatile.
   */
  private paintRecipe(
    recipe: CellRecipe,
  ): boolean {
    const target =
      this.targets[recipe.target]?.pixels;

    if (!target) {
      return false;
    }

    if (recipe.quadrant < 0) {
      return this.paintCutRecipe(recipe, target);
    }

    const cell =
      this.cellScratch;

    // Celula comeca transparente, exatamente como o buffer do adapter.
    cell.fill(0);

    this.composeLayers(recipe.layers, cell, TILE_PIXELS, 0, 0);

    const quadrantX =
      (recipe.quadrant % 2) * TILE_PIXELS;

    const quadrantY =
      Math.floor(recipe.quadrant / 2) * TILE_PIXELS;

    this.copyToBlocks(cell, TILE_PIXELS, quadrantX, quadrantY, recipe.blocks, target);

    return true;
  }

  /** Flor em pe: camada de cima sem o fundo igual a camada de baixo. */
  private paintCutRecipe(
    recipe: CellRecipe,
    target: Uint8Array,
  ): boolean {
    const top = this.blockTop;
    const bottom = this.blockBottom;

    top.fill(0);
    bottom.fill(0);

    for (let quadrant = 0; quadrant < 4; quadrant++) {
      const x = (quadrant % 2) * TILE_PIXELS;
      const y = Math.floor(quadrant / 2) * TILE_PIXELS;

      this.composeLayers(recipe.cutTop?.[quadrant] ?? [], top, METATILE_PIXELS, x, y);
      this.composeLayers(recipe.cutBottom?.[quadrant] ?? [], bottom, METATILE_PIXELS, x, y);
    }

    cutTopAgainstBottom(top, bottom);

    this.copyToBlocks(top, METATILE_PIXELS, 0, 0, recipe.blocks, target);

    return true;
  }

  /** Compoe camadas 8x8 (indices da VRAM) num buffer RGBA de largura `stride`. */
  private composeLayers(
    layers: LayerRef[],
    out: Uint8Array,
    stride: number,
    originX: number,
    originY: number,
  ): void {
    for (
      const layer of layers
    ) {
      const indices =
        this.paintedTiles.get(layer.tileId);

      const palette =
        this.palettes[layer.palette];

      if (!indices || !palette) {
        continue;
      }

      for (
        let y = 0;
        y < TILE_PIXELS;
        y++
      ) {
        const sourceY =
          layer.vFlip
            ? TILE_PIXELS - 1 - y
            : y;

        for (
          let x = 0;
          x < TILE_PIXELS;
          x++
        ) {
          const sourceX =
            layer.hFlip
              ? TILE_PIXELS - 1 - x
              : x;

          const colorIndex =
            indices[sourceY * TILE_PIXELS + sourceX];

          // Indice 0 e transparente: deixa aparecer a camada de baixo.
          if (colorIndex === 0) {
            continue;
          }

          const offset =
            ((originY + y) * stride + originX + x) * 4;

          out[offset] = palette[colorIndex * 3];
          out[offset + 1] = palette[colorIndex * 3 + 1];
          out[offset + 2] = palette[colorIndex * 3 + 2];
          out[offset + 3] = 255;
        }
      }
    }
  }

  /**
   * Copia um pedaco composto (size x size, a partir de (offsetX, offsetY)
   * dentro do metatile) para todos os blocos da receita.
   */
  private copyToBlocks(
    cell: Uint8Array,
    size: number,
    offsetX: number,
    offsetY: number,
    blocks: number[],
    target: Uint8Array,
  ): void {
    const textureWidth =
      this.mapWidth * METATILE_PIXELS;

    for (
      const blockIndex of blocks
    ) {
      const blockX =
        blockIndex % this.mapWidth;

      const blockY =
        Math.floor(blockIndex / this.mapWidth);

      for (
        let y = 0;
        y < size;
        y++
      ) {
        // MESMA inversao vertical de PlayerRenderer.buildMapVisual:
        // pixel (mx, my) do metatile vai para
        // (bx*16 + mx, (H-1-by)*16 + 15 - my).
        const metatileY =
          offsetY + y;

        const textureY =
          (this.mapHeight - 1 - blockY) * METATILE_PIXELS +
          METATILE_PIXELS - 1 - metatileY;

        const rowStart =
          (textureY * textureWidth +
            blockX * METATILE_PIXELS +
            offsetX) * 4;

        target.set(
          cell.subarray(
            y * size * 4,
            (y + 1) * size * 4,
          ),
          rowStart,
        );
      }
    }
  }

  /**
   * Le um tile 4bpp da VRAM e devolve 64 indices, no mesmo layout de
   * TileGraphicsDecoder.decode4bppTile (nibble baixo primeiro).
   */
  private readVramTile(
    tileId: number,
  ): Uint8Array {
    const out =
      this.vramScratch;

    const address =
      GBA_VRAM_BASE + tileId * TILE_BYTES;

    for (
      let word = 0;
      word < 8;
      word++
    ) {
      const value =
        this.memoryReader.readU32(
          address + word * 4,
        );

      // Cada palavra de 32 bits = uma linha de 8 pixels.
      for (
        let pixel = 0;
        pixel < 8;
        pixel++
      ) {
        out[word * 8 + pixel] =
          (value >>> (pixel * 4)) & 0x0f;
      }
    }

    return out;
  }
}

function sameIndices(
  left: Uint8Array,
  right: Uint8Array,
): boolean {
  if (left.length !== right.length) {
    return false;
  }

  for (
    let index = 0;
    index < left.length;
    index++
  ) {
    if (left[index] !== right[index]) {
      return false;
    }
  }

  return true;
}
