import * as THREE from 'three';

import type {
  MemoryReader,
} from '../gen3/MemoryReader';

import type {
  MapDefinition,
} from '../gen3/world/MapDefinition';

/**
 * Animacao de tiles escrita do zero, substituindo
 * TilesetAnimationController (desligado em 6752e21 por regressao).
 *
 * O que deu errado no anterior, e que este evita por construcao:
 *
 *  1. Tiles duplicados na tela. O anterior escrevia na textura sem usar a
 *     MESMA inversao vertical que PlayerRenderer.buildMapVisual aplica ao
 *     assar o mapa. Aqui a formula de destino e copiada literalmente de la
 *     (ver writeSubtile) - se uma mudar, a outra tem de mudar junto.
 *
 *  2. Custo que derrubava o resto. O anterior registrava TODOS os mapas do
 *     mundo (medido: 197 mil posicoes animadas em Emerald) e repintava na
 *     thread principal, o que atrasava a montagem do catalogo a ponto de
 *     estourar o limite de tentativas - e ai caiam junto conexao de mapas,
 *     Cinnabar e padding. Aqui so o mapa ATIVO e animado, e um mapa acima
 *     de MAX_ANIMATED_POSITIONS e descartado inteiro em vez de travar.
 *
 *  3. Ambiguidade de camada. O anterior mexia nas duas camadas do metatile;
 *     a composicao de camada depende do layerType e divergir dela produz
 *     artefato. Aqui so a camada de baixo (subtiles 0-3) e animada - e onde
 *     ficam agua e vegetacao, que e o caso de uso real.
 *
 * O animador e puramente visual: le VRAM e paleta, escreve em texturas.
 * Nao toca em MapCatalog, MapWorld nem em nada do pipeline de mundo, entao
 * nao tem como reintroduzir aquelas regressoes.
 */

const GBA_VRAM_BASE =
  0x06000000;

const GBA_PALETTE_RAM_BASE =
  0x05000000;

// Faixa de tiles do tileset primario que o jogo usa para animacao.
const ANIMATED_TILE_START =
  416;

const ANIMATED_TILE_END =
  512;

const ANIMATED_TILE_COUNT =
  ANIMATED_TILE_END - ANIMATED_TILE_START;

const TILE_BYTES =
  32;

const TILE_PIXELS =
  8;

const METATILE_PIXELS =
  16;

// Metatiles do tileset primario; acima disso e secundario, que nao anima.
const PRIMARY_METATILE_COUNT =
  512;

const METATILE_ENTRY_BYTES =
  16;

// Offset do ponteiro de metatiles na struct de tileset. Vale tanto para
// RSE quanto para FRLG - as structs so divergem depois deste campo.
const TILESET_METATILES_OFFSET =
  0x0c;

const GBA_ROM_BASE =
  0x08000000;

const BG_PALETTE_BYTES =
  512;

// Teto de posicoes animadas por mapa. Acima disso o mapa nao anima: e
// preferivel perder a animacao de um mapa a comprometer a taxa de quadros.
const MAX_ANIMATED_POSITIONS =
  6000;

// Intervalo minimo entre leituras da VRAM.
const POLL_INTERVAL_MS =
  60;

interface AnimatedPosition {
  // Onde escrever, em pixels da textura do mapa.
  destinationX: number;
  destinationY: number;

  tileId: number;
  palette: number;
  hFlip: boolean;
  vFlip: boolean;
}

export class TileAnimator {
  private readonly romBytes: Uint8Array;

  private readonly memoryReader: MemoryReader;

  private positions: AnimatedPosition[] = [];

  private texture: THREE.DataTexture | null = null;

  private texturePixels: Uint8ClampedArray | null = null;

  private textureWidth = 0;

  private activeKey: string | null = null;

  private lastPollAt = 0;

  private lastTileSignature = '';

  // Desarme automatico: se a animacao lancar, ela se desliga em vez de
  // derrubar o loop de render. Nenhuma falha aqui pode parar o jogo.
  private disabled = false;

  constructor(
    romBytes: Uint8Array,
    memoryReader: MemoryReader,
  ) {
    this.romBytes = romBytes;
    this.memoryReader = memoryReader;
  }

  /**
   * Passa a animar este mapa, descartando o anterior. Chamar sempre que o
   * mapa ativo mudar.
   */
  setActiveMap(
    key: string,
    map: MapDefinition,
    metatileIds: Uint16Array,
    texture: THREE.DataTexture,
    texturePixels: Uint8ClampedArray,
  ): void {
    if (this.activeKey === key) {
      return;
    }

    this.activeKey = key;
    this.texture = texture;
    this.texturePixels = texturePixels;
    this.textureWidth = map.width * METATILE_PIXELS;
    this.lastTileSignature = '';

    this.positions =
      this.collectPositions(
        map,
        metatileIds,
      );
  }

  clear(): void {
    this.activeKey = null;
    this.texture = null;
    this.texturePixels = null;
    this.positions = [];
    this.lastTileSignature = '';
  }

  /**
   * Repinta as posicoes animadas, se a VRAM mudou desde a ultima leitura.
   * Seguro de chamar todo frame: faz throttle e sai cedo quando nao ha o
   * que fazer.
   */
  update(): void {
    if (this.disabled) {
      return;
    }

    try {
      this.updateInternal();
    } catch (error) {
      this.disabled = true;

      console.warn(
        'Animacao de tiles desligada apos erro:',
        error,
      );
    }
  }

  private updateInternal(): void {
    if (
      this.positions.length === 0 ||
      !this.texture ||
      !this.texturePixels
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

    const tileBytes =
      this.memoryReader.readRange(
        GBA_VRAM_BASE +
          ANIMATED_TILE_START * TILE_BYTES,
        ANIMATED_TILE_COUNT * TILE_BYTES,
      );

    if (
      tileBytes.length <
      ANIMATED_TILE_COUNT * TILE_BYTES
    ) {
      return;
    }

    // Assinatura barata: so repinta quando os tiles realmente mudaram.
    // Evita trabalho em mapas sem animacao ativa no momento.
    const signature =
      this.buildSignature(
        tileBytes,
      );

    if (
      signature === this.lastTileSignature
    ) {
      return;
    }

    this.lastTileSignature = signature;

    const paletteBytes =
      this.memoryReader.readRange(
        GBA_PALETTE_RAM_BASE,
        BG_PALETTE_BYTES,
      );

    if (
      paletteBytes.length < BG_PALETTE_BYTES
    ) {
      return;
    }

    for (
      const position of this.positions
    ) {
      this.writeSubtile(
        position,
        tileBytes,
        paletteBytes,
      );
    }

    this.texture.needsUpdate = true;
  }

  /**
   * Varre o mapa e anota cada subtile da camada de baixo que usa um tile
   * da faixa animada, ja convertendo para coordenada de pixel na textura.
   */
  private collectPositions(
    map: MapDefinition,
    metatileIds: Uint16Array,
  ): AnimatedPosition[] {
    const metatilesAddress =
      this.readU32(
        map.primaryTilesetAddress -
          GBA_ROM_BASE +
          TILESET_METATILES_OFFSET,
      );

    if (
      metatilesAddress < GBA_ROM_BASE
    ) {
      return [];
    }

    const metatilesOffset =
      metatilesAddress - GBA_ROM_BASE;

    const result: AnimatedPosition[] = [];

    for (
      let blockY = 0;
      blockY < map.height;
      blockY++
    ) {
      for (
        let blockX = 0;
        blockX < map.width;
        blockX++
      ) {
        const metatileId =
          metatileIds[blockY * map.width + blockX];

        if (
          metatileId === undefined ||
          metatileId >= PRIMARY_METATILE_COUNT
        ) {
          continue;
        }

        const entryOffset =
          metatilesOffset +
          metatileId * METATILE_ENTRY_BYTES;

        if (
          entryOffset + METATILE_ENTRY_BYTES >
          this.romBytes.length
        ) {
          continue;
        }

        // Apenas a camada de baixo: subtiles 0 a 3.
        for (
          let subtile = 0;
          subtile < 4;
          subtile++
        ) {
          const raw =
            this.readU16(
              entryOffset + subtile * 2,
            );

          const tileId =
            raw & 0x03ff;

          if (
            tileId < ANIMATED_TILE_START ||
            tileId >= ANIMATED_TILE_END
          ) {
            continue;
          }

          if (
            result.length >= MAX_ANIMATED_POSITIONS
          ) {
            // Mapa denso demais: desiste da animacao dele inteiro em vez
            // de arrastar a taxa de quadros.
            return [];
          }

          const columnInMetatile =
            subtile % 2;

          const rowInMetatile =
            Math.floor(subtile / 2);

          // Origem do subtile dentro do metatile, em pixels.
          const sourceX =
            columnInMetatile * TILE_PIXELS;

          const sourceY =
            rowInMetatile * TILE_PIXELS;

          // MESMA formula de buildMapVisual. A textura do mapa e assada
          // invertida na vertical; escrever sem esta inversao foi o que
          // duplicava os tiles na versao anterior.
          const destinationX =
            blockX * METATILE_PIXELS + sourceX;

          const destinationY =
            (map.height - 1 - blockY) * METATILE_PIXELS +
            METATILE_PIXELS - 1 - sourceY -
            (TILE_PIXELS - 1);

          result.push({
            destinationX,
            destinationY,
            tileId,
            palette: (raw >> 12) & 0x0f,
            hFlip: (raw & 0x0400) !== 0,
            vFlip: (raw & 0x0800) !== 0,
          });
        }
      }
    }

    return result;
  }

  /**
   * Decodifica um tile 4bpp da VRAM e escreve seus 8x8 pixels na textura.
   */
  private writeSubtile(
    position: AnimatedPosition,
    tileBytes: Uint8Array,
    paletteBytes: Uint8Array,
  ): void {
    const pixels =
      this.texturePixels;

    if (!pixels) {
      return;
    }

    const tileOffset =
      (position.tileId - ANIMATED_TILE_START) *
      TILE_BYTES;

    const paletteOffset =
      position.palette * 32;

    for (
      let y = 0;
      y < TILE_PIXELS;
      y++
    ) {
      for (
        let x = 0;
        x < TILE_PIXELS;
        x++
      ) {
        const sampleX =
          position.hFlip
            ? TILE_PIXELS - 1 - x
            : x;

        const sampleY =
          position.vFlip
            ? TILE_PIXELS - 1 - y
            : y;

        // 4bpp: dois pixels por byte, nibble baixo primeiro.
        const byteIndex =
          tileOffset +
          sampleY * 4 +
          (sampleX >> 1);

        if (
          byteIndex >= tileBytes.length
        ) {
          continue;
        }

        const byte =
          tileBytes[byteIndex];

        const colorIndex =
          (sampleX & 1) === 0
            ? byte & 0x0f
            : (byte >> 4) & 0x0f;

        const colorOffset =
          paletteOffset + colorIndex * 2;

        if (
          colorOffset + 1 >= paletteBytes.length
        ) {
          continue;
        }

        const color =
          paletteBytes[colorOffset] |
          (paletteBytes[colorOffset + 1] << 8);

        // BGR555 -> RGB888
        const red =
          Math.round(((color & 0x1f) * 255) / 31);

        const green =
          Math.round((((color >> 5) & 0x1f) * 255) / 31);

        const blue =
          Math.round((((color >> 10) & 0x1f) * 255) / 31);

        // A textura e invertida na vertical, entao a linha do tile tambem
        // cresce ao contrario dentro do bloco de destino.
        const targetY =
          position.destinationY +
          (TILE_PIXELS - 1 - y);

        const targetX =
          position.destinationX + x;

        const destinationOffset =
          (targetY * this.textureWidth + targetX) * 4;

        if (
          destinationOffset < 0 ||
          destinationOffset + 3 >= pixels.length
        ) {
          continue;
        }

        pixels[destinationOffset] = red;
        pixels[destinationOffset + 1] = green;
        pixels[destinationOffset + 2] = blue;
        pixels[destinationOffset + 3] = 255;
      }
    }
  }

  /**
   * Amostra barata dos bytes de tile, so para detectar mudanca.
   */
  private buildSignature(
    tileBytes: Uint8Array,
  ): string {
    let signature = '';

    for (
      let index = 0;
      index < tileBytes.length;
      index += 256
    ) {
      signature += tileBytes[index].toString(16);
    }

    return signature;
  }

  private readU16(
    offset: number,
  ): number {
    return (
      this.romBytes[offset] |
      (this.romBytes[offset + 1] << 8)
    );
  }

  private readU32(
    offset: number,
  ): number {
    if (
      offset < 0 ||
      offset + 3 >= this.romBytes.length
    ) {
      return 0;
    }

    return (
      (this.romBytes[offset] |
        (this.romBytes[offset + 1] << 8) |
        (this.romBytes[offset + 2] << 16) |
        (this.romBytes[offset + 3] << 24)) >>>
      0
    );
  }
}
