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
  quadrant: number;
  overlay: boolean;
  layers: LayerRef[];
  blocks: number[];
}

export class TileAnimator {
  private readonly memoryReader: MemoryReader;

  private readonly adapter: Gen3StateAdapter;

  private activeKey: string | null = null;

  private mapWidth = 0;

  private mapHeight = 0;

  private baseTexture: THREE.DataTexture | null = null;

  private overlayTexture: THREE.DataTexture | null = null;

  private basePixels: Uint8Array | null = null;

  private overlayPixels: Uint8Array | null = null;

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
    metatileIds: Uint16Array,
    baseTexture: THREE.DataTexture,
    overlayTexture: THREE.DataTexture,
  ): void {
    if (this.activeKey === key) {
      return;
    }

    this.clear();

    this.activeKey = key;

    const source =
      this.adapter.getTileAnimationSource(
        map.primaryTilesetAddress,
        map.secondaryTilesetAddress,
        metatileIds,
      );

    if (!source) {
      console.warn(
        '[anim] mapa',
        key,
        '- tilesets nao resolvidos; sem animacao.',
      );

      return;
    }

    this.baseTexture = baseTexture;
    this.overlayTexture = overlayTexture;

    this.basePixels =
      (baseTexture.image as { data?: Uint8Array }).data ?? null;

    this.overlayPixels =
      (overlayTexture.image as { data?: Uint8Array }).data ?? null;

    this.mapWidth = map.width;
    this.mapHeight = map.height;

    this.buildRecipes(
      metatileIds,
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
    this.baseTexture = null;
    this.overlayTexture = null;
    this.basePixels = null;
    this.overlayPixels = null;
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
    metatileIds: Uint16Array,
    source: TileAnimationSource,
  ): void {
    const blocksByMetatile =
      new Map<number, number[]>();

    for (
      let blockIndex = 0;
      blockIndex < metatileIds.length;
      blockIndex++
    ) {
      const metatileId =
        metatileIds[blockIndex];

      let blocks =
        blocksByMetatile.get(metatileId);

      if (!blocks) {
        blocks = [];
        blocksByMetatile.set(metatileId, blocks);
      }

      blocks.push(blockIndex);
    }

    const background: LayerRef = {
      tileId: source.backgroundTileId,
      palette: source.backgroundPalette,
      hFlip: false,
      vFlip: false,
    };

    for (
      const [metatileId, blocks] of blocksByMetatile
    ) {
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

      for (
        let quadrant = 0;
        quadrant < 4;
        quadrant++
      ) {
        const bottom =
          layout.tiles[quadrant];

        const top =
          layout.tiles[quadrant + 4];

        const baseLayers: LayerRef[] = [];

        if (layerType === LAYER_TYPE_NORMAL) {
          baseLayers.push(background);
        }

        baseLayers.push(bottom);

        if (layerType === LAYER_TYPE_COVERED) {
          baseLayers.push(top);
        }

        this.addRecipe({
          quadrant,
          overlay: false,
          layers: baseLayers,
          blocks,
        });

        if (
          layerType === LAYER_TYPE_NORMAL ||
          layerType === LAYER_TYPE_SPLIT
        ) {
          this.addRecipe({
            quadrant,
            overlay: true,
            layers: [top],
            blocks,
          });
        }
      }
    }

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

    for (
      const layer of recipe.layers
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

    let touchedBase = false;
    let touchedOverlay = false;

    for (
      const recipeIndex of dirty
    ) {
      const recipe =
        this.recipes[recipeIndex];

      if (
        this.paintRecipe(recipe)
      ) {
        if (recipe.overlay) {
          touchedOverlay = true;
        } else {
          touchedBase = true;
        }
      }
    }

    if (touchedBase && this.baseTexture) {
      this.baseTexture.needsUpdate = true;
    }

    if (touchedOverlay && this.overlayTexture) {
      this.overlayTexture.needsUpdate = true;
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
      recipe.overlay
        ? this.overlayPixels
        : this.basePixels;

    if (!target) {
      return false;
    }

    const cell =
      this.cellScratch;

    // Celula comeca transparente, exatamente como o buffer do adapter.
    cell.fill(0);

    for (
      const layer of recipe.layers
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
            (y * TILE_PIXELS + x) * 4;

          cell[offset] = palette[colorIndex * 3];
          cell[offset + 1] = palette[colorIndex * 3 + 1];
          cell[offset + 2] = palette[colorIndex * 3 + 2];
          cell[offset + 3] = 255;
        }
      }
    }

    const textureWidth =
      this.mapWidth * METATILE_PIXELS;

    const quadrantX =
      (recipe.quadrant % 2) * TILE_PIXELS;

    const quadrantY =
      Math.floor(recipe.quadrant / 2) * TILE_PIXELS;

    for (
      const blockIndex of recipe.blocks
    ) {
      const blockX =
        blockIndex % this.mapWidth;

      const blockY =
        Math.floor(blockIndex / this.mapWidth);

      for (
        let y = 0;
        y < TILE_PIXELS;
        y++
      ) {
        // MESMA inversao vertical de PlayerRenderer.buildMapVisual:
        // pixel (mx, my) do metatile vai para
        // (bx*16 + mx, (H-1-by)*16 + 15 - my).
        const metatileY =
          quadrantY + y;

        const textureY =
          (this.mapHeight - 1 - blockY) * METATILE_PIXELS +
          METATILE_PIXELS - 1 - metatileY;

        const rowStart =
          (textureY * textureWidth +
            blockX * METATILE_PIXELS +
            quadrantX) * 4;

        target.set(
          cell.subarray(
            y * TILE_PIXELS * 4,
            (y + 1) * TILE_PIXELS * 4,
          ),
          rowStart,
        );
      }
    }

    return true;
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
