import * as THREE from 'three';

import type {
  MapBlockState,
} from './GameState';

import type {
  MemoryReader,
} from './MemoryReader';

import type {
  MapDefinition,
} from './world/MapDefinition';

const GBA_ROM_BASE =
  0x08000000;

const GBA_VRAM_BASE =
  0x06000000;

const ANIMATED_PRIMARY_TILE_START =
  416;

const ANIMATED_PRIMARY_TILE_END =
  512;

const ANIMATED_PRIMARY_TILE_COUNT =
  ANIMATED_PRIMARY_TILE_END -
  ANIMATED_PRIMARY_TILE_START;

const TILE_BYTES =
  32;

const TILE_SIZE =
  8;

const METATILE_SIZE =
  16;

const METATILE_TILE_COUNT =
  8;

const TILESET_PALETTES_OFFSET =
  0x08;

const TILESET_METATILES_OFFSET =
  0x0c;

const EMERALD_METATILE_ATTRIBUTES_OFFSET =
  0x10;

const FRLG_METATILE_ATTRIBUTES_OFFSET =
  0x14;

const FRLG_PRIMARY_PALETTE_COUNT =
  7;

const GBA_PALETTE_COLORS =
  16;

const GBA_PALETTE_COLOR_BYTES =
  2;

const RGBA_CHANNEL_COUNT =
  4;

const POLL_EVERY_FRAMES =
  4;

type TextureData =
  Uint8Array |
  Uint8ClampedArray;

interface AnimatedTile {
  tileId:
    number;

  paletteIndex:
    number;

  hFlip:
    boolean;

  vFlip:
    boolean;

  target:
    'base' |
    'overlay';

  x:
    number;

  y:
    number;

  secondary:
    boolean;

  restorePixels:
    Uint8Array | null;
}

interface AnimatedMapTarget {
  key:
    string;

  map:
    MapDefinition;

  baseTexture:
    THREE.DataTexture;

  overlayTexture:
    THREE.DataTexture;

  placementsByTile:
    Map<
      number,
      AnimatedTile[]
    >;
}

interface CachedMetatile {
  layerType:
    number;

  tiles:
    Array<{
      tileId:
        number;

      paletteIndex:
        number;

      hFlip:
        boolean;

      vFlip:
        boolean;
    }>;
}

interface RgbaColor {
  r: number;
  g: number;
  b: number;
}

export class TilesetAnimationController {
  private readonly romBytes:
    Uint8Array;

  private readonly memoryReader:
    MemoryReader;

  private readonly isFireRedFamily:
    boolean;

  private readonly targets =
    new Map<
      string,
      AnimatedMapTarget
    >();

  private readonly metatileCache =
    new Map<
      string,
      CachedMetatile | null
    >();

  private readonly paletteCache =
    new Map<
      string,
      RgbaColor[]
    >();

  private activePrimaryTilesetAddress =
    0;

  private liveRange:
    Uint8Array | null =
    null;

  private liveRangeTilesetAddress =
    0;

  private readonly liveTiles =
    new Map<
      number,
      Uint8Array
    >();

  private activeSecondaryTilesetAddress =
    0;

  private frameCounter =
    0;

  constructor(
    romBytes: Uint8Array,
    memoryReader: MemoryReader,
  ) {
    this.romBytes =
      romBytes;

    this.memoryReader =
      memoryReader;

    const gameCode =
      this.readRomAscii(
        0xac,
        4,
      );

    this.isFireRedFamily =
      gameCode === 'BPRE' ||
      gameCode === 'BPRP' ||
      gameCode === 'BPRJ' ||
      gameCode === 'BPGE' ||
      gameCode === 'BPGP' ||
      gameCode === 'BPGJ';
  }

  createPlacements(
    map: MapDefinition,
    blocks:
      readonly MapBlockState[],
  ): Map<number, AnimatedTile[]> {
    return this.buildPlacements(
      map,
      blocks,
    );
  }

  attachMap(
    key: string,
    map: MapDefinition,
    baseTexture:
      THREE.DataTexture,
    overlayTexture:
      THREE.DataTexture,
    placementsByTile:
      Map<number, AnimatedTile[]>,
  ): void {
    const target: AnimatedMapTarget = {
      key,
      map,
      baseTexture,
      overlayTexture,
      placementsByTile,
    };

    this.targets.set(
      key,
      target,
    );

    for (
      const placements of
        placementsByTile.values()
    ) {
      for (
        const placement of
          placements
      ) {
        placement.restorePixels =
          placement.target ===
          'base'
            ? this.captureBaseRestorePixels(
                target,
                placement,
              )
            : null;
      }
    }

    for (
      const [tileId, tileBytes] of
        this.liveTiles
    ) {
      if (
        placementsByTile.has(
          tileId,
        )
      ) {
        this.patchTarget(
          target,
          tileId,
          tileBytes,
        );
      }
    }
  }

  unregisterMap(
    key: string,
  ): void {
    this.targets.delete(
      key,
    );
  }

  clear(): void {
    this.targets.clear();
    this.metatileCache.clear();
    this.paletteCache.clear();
    this.liveRange = null;
    this.liveRangeTilesetAddress = 0;
    this.activePrimaryTilesetAddress = 0;
    this.frameCounter = 0;
  }

  suspend(): void {
    this.liveTiles.clear();
    this.liveRange = null;
    this.liveRangeTilesetAddress = 0;
    this.activePrimaryTilesetAddress = 0;
    this.activeSecondaryTilesetAddress = 0;
    this.frameCounter = 0;
  }

  update(
    primaryTilesetAddress:
      number,
    secondaryTilesetAddress:
      number,
  ): void {
    if (
      primaryTilesetAddress <= 0 &&
      secondaryTilesetAddress <= 0
    ) {
      return;
    }

    const primaryChanged =
      primaryTilesetAddress !==
      this.activePrimaryTilesetAddress;

    const secondaryChanged =
      secondaryTilesetAddress !==
      this.activeSecondaryTilesetAddress;

    if (
      primaryChanged ||
      secondaryChanged
    ) {
      this.liveTiles.clear();
    }

    this.activePrimaryTilesetAddress =
      primaryTilesetAddress;

    this.activeSecondaryTilesetAddress =
      secondaryTilesetAddress;

    this.frameCounter++;

    if (
      this.frameCounter %
        POLL_EVERY_FRAMES !==
      0
    ) {
      return;
    }

    const watched =
      new Set<number>();

    for (
      const target of
        this.targets.values()
    ) {
      if (
        target.map.primaryTilesetAddress ===
          primaryTilesetAddress
      ) {
        for (
          const tileId of
            target.placementsByTile.keys()
        ) {
          if (
            tileId >=
              ANIMATED_PRIMARY_TILE_START &&
            tileId <
              ANIMATED_PRIMARY_TILE_END
          ) {
            watched.add(
              tileId,
            );
          }
        }
      }

      if (
        target.map.secondaryTilesetAddress ===
          secondaryTilesetAddress
      ) {
        for (
          const tileId of
            target.placementsByTile.keys()
        ) {
          if (
            this.isAnimatedSecondaryTile(
              tileId,
            )
          ) {
            watched.add(
              tileId,
            );
          }
        }
      }
    }

    if (
      watched.size === 0
    ) {
      return;
    }

    for (
      const tileId of watched
    ) {
      const tileBytes =
        this.memoryReader.readRange(
          GBA_VRAM_BASE +
            tileId *
              TILE_BYTES,
          TILE_BYTES,
        );

      const previous =
        this.liveTiles.get(
          tileId,
        );

      let changed =
        previous === undefined;

      if (
        !changed &&
        previous
      ) {
        changed = false;

        for (
          let index = 0;
          index < TILE_BYTES;
          index++
        ) {
          if (
            tileBytes[index] !==
            previous[index]
          ) {
            changed = true;
            break;
          }
        }
      }

      if (
        changed
      ) {
        for (
          const target of
            this.targets.values()
        ) {
          if (
            target.placementsByTile.has(
              tileId,
            ) &&
            (
              target.map.primaryTilesetAddress ===
                primaryTilesetAddress ||
              target.map.secondaryTilesetAddress ===
                secondaryTilesetAddress
            )
          ) {
            this.patchTarget(
              target,
              tileId,
              tileBytes,
            );
          }
        }
      }

      this.liveTiles.set(
        tileId,
        tileBytes,
      );
    }
  }

  private patchTarget(
    target:
      AnimatedMapTarget,
    tileId:
      number,
    tileBytes:
      Uint8Array,
  ): void {
    const placements =
      target.placementsByTile.get(
        tileId,
      );

    if (!placements) {
      return;
    }

    let baseDirty =
      false;

    let overlayDirty =
      false;

    const decodedPixels =
      new Uint8Array(64);

    for (
      let sourceY = 0;
      sourceY < TILE_SIZE;
      sourceY++
    ) {
      for (
        let sourceX = 0;
        sourceX < TILE_SIZE;
        sourceX++
      ) {
        decodedPixels[
          sourceY * TILE_SIZE +
          sourceX
        ] =
          this.read4BppPixel(
            tileBytes,
            sourceX,
            sourceY,
          );
      }
    }

    for (
      const placement of
        placements
    ) {
      const palette =
        this.readPaletteForPlacement(
          target.map,
          placement,
        );

      if (!palette) {
        continue;
      }

      const textureData =
        placement.target ===
        'base'
          ? (
              target.baseTexture
                .image.data as TextureData
            )
          : (
              target.overlayTexture
                .image.data as TextureData
            );

      const textureWidth =
        target.map.width *
        METATILE_SIZE;

      const blockY =
        Math.floor(
          placement.y /
            METATILE_SIZE,
        );

      const localY =
        placement.y %
        METATILE_SIZE;

      const textureBaseY =
        (
          target.map.height -
          1 -
          blockY
        ) *
          METATILE_SIZE +
        15 -
        localY;

      for (
        let sourceY = 0;
        sourceY < TILE_SIZE;
        sourceY++
      ) {
        const pixelY =
          placement.vFlip
            ? TILE_SIZE -
              1 -
              sourceY
            : sourceY;

        const destinationY =
          textureBaseY -
          pixelY;

        for (
          let sourceX = 0;
          sourceX < TILE_SIZE;
          sourceX++
        ) {
          const pixelX =
            placement.hFlip
              ? TILE_SIZE -
                1 -
                sourceX
              : sourceX;

          // IMPORTANT: source coordinates index the live GBA tile.
          // h/v flips affect only the destination coordinate.
          const paletteIndex =
            decodedPixels[
              sourceY *
                TILE_SIZE +
              sourceX
            ];

          const x =
            placement.x +
            pixelX;

          const y =
            destinationY;

          const offset =
            (
              y *
                textureWidth +
              x
            ) *
            RGBA_CHANNEL_COUNT;

          if (
            offset < 0 ||
            offset + 3 >=
              textureData.length
          ) {
            continue;
          }

          if (
            paletteIndex === 0
          ) {
            if (
              placement.target ===
                'base' &&
              placement.restorePixels
            ) {
              const restoreOffset =
                (
                  sourceY *
                    TILE_SIZE +
                  sourceX
                ) *
                RGBA_CHANNEL_COUNT;

              textureData[offset] =
                placement.restorePixels[
                  restoreOffset
                ];
              textureData[offset + 1] =
                placement.restorePixels[
                  restoreOffset + 1
                ];
              textureData[offset + 2] =
                placement.restorePixels[
                  restoreOffset + 2
                ];
              textureData[offset + 3] =
                placement.restorePixels[
                  restoreOffset + 3
                ];
            } else {
              textureData[offset] = 0;
              textureData[offset + 1] = 0;
              textureData[offset + 2] = 0;
              textureData[offset + 3] = 0;
            }
          } else {
            const color =
              palette[
                paletteIndex
              ];

            if (!color) {
              continue;
            }

            textureData[offset] =
              color.r;
            textureData[offset + 1] =
              color.g;
            textureData[offset + 2] =
              color.b;
            textureData[offset + 3] =
              255;
          }

          if (
            placement.target ===
            'base'
          ) {
            baseDirty = true;
          } else {
            overlayDirty = true;
          }
        }
      }
    }

    if (baseDirty) {
      target.baseTexture.needsUpdate =
        true;
    }

    if (overlayDirty) {
      target.overlayTexture.needsUpdate =
        true;
    }
  }

  private captureBaseRestorePixels(
    target:
      AnimatedMapTarget,
    placement:
      AnimatedTile,
  ): Uint8Array {
    const restore =
      new Uint8Array(
        TILE_SIZE *
          TILE_SIZE *
          RGBA_CHANNEL_COUNT,
      );

    const textureData =
      target.baseTexture
        .image.data as TextureData;

    const textureWidth =
      target.map.width *
      METATILE_SIZE;

    const blockY =
      Math.floor(
        placement.y /
          METATILE_SIZE,
      );

    const localY =
      placement.y %
      METATILE_SIZE;

    const textureBaseY =
      (
        target.map.height -
        1 -
        blockY
      ) *
        METATILE_SIZE +
      15 -
      localY;

    for (
      let sourceY = 0;
      sourceY < TILE_SIZE;
      sourceY++
    ) {
      const pixelY =
        placement.vFlip
          ? TILE_SIZE -
            1 -
            sourceY
          : sourceY;

      const destinationY =
        textureBaseY -
        pixelY;

      for (
        let sourceX = 0;
        sourceX < TILE_SIZE;
        sourceX++
      ) {
        const pixelX =
          placement.hFlip
            ? TILE_SIZE -
              1 -
              sourceX
            : sourceX;

        const x =
          placement.x +
          pixelX;

        const y =
          destinationY;

        const destinationOffset =
          (
            y *
              textureWidth +
            x
          ) *
            RGBA_CHANNEL_COUNT;

        const restoreOffset =
          (
            sourceY *
              TILE_SIZE +
            sourceX
          ) *
            RGBA_CHANNEL_COUNT;

        if (
          destinationOffset >= 0 &&
          destinationOffset + 3 <
            textureData.length
        ) {
          restore[restoreOffset] =
            textureData[
              destinationOffset
            ];
          restore[restoreOffset + 1] =
            textureData[
              destinationOffset + 1
            ];
          restore[restoreOffset + 2] =
            textureData[
              destinationOffset + 2
            ];
          restore[restoreOffset + 3] =
            textureData[
              destinationOffset + 3
            ];
        }
      }
    }

    return restore;
  }

  private read4BppPixel(
    tileBytes: Uint8Array,
    x: number,
    y: number,
  ): number {
    const value =
      tileBytes[
        y * 4 +
        Math.floor(
          x / 2,
        )
      ];

    return x % 2 === 0
      ? value & 0x0f
      : (
          value >> 4
        ) & 0x0f;
  }

  private buildPlacements(
    map: MapDefinition,
    blocks:
      readonly MapBlockState[],
  ):
    Map<number, AnimatedTile[]> {
    const placementsByTile =
      new Map<
        number,
        AnimatedTile[]
      >();

    const primaryMetatileCount =
      this.getNumMetatilesInPrimary();

    const primaryTileCount =
      this.getNumTilesInPrimary();

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
        const block =
          blocks[
            blockY * map.width +
            blockX
          ];

        if (!block) {
          continue;
        }

        const isPrimary =
          block.metatileId <
            primaryMetatileCount;

        const tilesetAddress =
          isPrimary
            ? map.primaryTilesetAddress
            : map.secondaryTilesetAddress;

        const localMetatileId =
          isPrimary
            ? block.metatileId
            : block.metatileId -
              primaryMetatileCount;

        const metatile =
          this.readPrimaryMetatile(
            tilesetAddress,
            localMetatileId,
          );

        if (!metatile) {
          continue;
        }

        const layerTileIndex =
          (tileIndex: number) =>
            tileIndex % 4;

        for (
          let tileIndex = 0;
          tileIndex <
            METATILE_TILE_COUNT;
          tileIndex++
        ) {
          const tile =
            metatile.tiles[
              tileIndex
            ];

          if (!tile) {
            continue;
          }

          const globalTileId =
            isPrimary
              ? tile.tileId
              : primaryTileCount +
                tile.tileId;

          const animated =
            isPrimary
              ? (
                  globalTileId >=
                    ANIMATED_PRIMARY_TILE_START &&
                  globalTileId <
                    ANIMATED_PRIMARY_TILE_END
                )
              : this.isAnimatedSecondaryTile(
                  globalTileId,
                );

          if (!animated) {
            continue;
          }

          const target =
            this.resolveTextureTarget(
              metatile.layerType,
              layerTileIndex(
                tileIndex,
              ),
            );

          if (!target) {
            continue;
          }

          const localTileIndex =
            layerTileIndex(
              tileIndex,
            );

          const localX =
            (
              localTileIndex %
              2
            ) *
            TILE_SIZE;

          const localY =
            Math.floor(
              localTileIndex / 2,
            ) *
            TILE_SIZE;

          const placement:
            AnimatedTile = {
            tileId:
              globalTileId,
            paletteIndex:
              tile.paletteIndex,
            hFlip:
              tile.hFlip,
            vFlip:
              tile.vFlip,
            target,
            x:
              blockX *
                METATILE_SIZE +
              localX,
            y:
              blockY *
                METATILE_SIZE +
              localY,
            secondary:
              !isPrimary,
            restorePixels:
              null,
          };

          const bucket =
            placementsByTile.get(
              globalTileId,
            ) ?? [];

          bucket.push(
            placement,
          );

          placementsByTile.set(
            globalTileId,
            bucket,
          );
        }
      }
    }

    return placementsByTile;
  }

  private isAnimatedSecondaryTile(
    tileId: number,
  ): boolean {
    if (
      tileId < 512 ||
      tileId >= 1024
    ) {
      return false;
    }

    if (this.isFireRedFamily) {
      return (
        (
          tileId >= 739 &&
          tileId <= 751
        ) ||
        (
          tileId >= 880 &&
          tileId <= 886
        ) ||
        (
          tileId >= 896 &&
          tileId <= 903
        ) ||
        (
          tileId >= 976 &&
          tileId <= 983
        )
      );
    }

    const local =
      tileId -
      512;

    return (
      (
        local >= 96 &&
        local <= 163
      ) ||
      (
        local >= 170 &&
        local <= 175
      ) ||
      (
        local >= 218 &&
        local <= 335
      ) ||
      (
        local >= 416 &&
        local <= 419
      ) ||
      (
        local >= 448 &&
        local <= 451
      ) ||
      (
        local >= 464 &&
        local <= 499
      ) ||
      local === 504
    );
  }

  private resolveTextureTarget(
    layerType: number,
    tileIndex: number,
  ):
    'base' |
    'overlay' |
    null {
    const isTopLayer =
      tileIndex >= 4;

    if (
      layerType === 1
    ) {
      return 'base';
    }

    if (
      layerType === 0 ||
      layerType === 2
    ) {
      return isTopLayer
        ? 'overlay'
        : 'base';
    }

    return null;
  }

  private readPrimaryMetatile(
    tilesetAddress: number,
    metatileId: number,
  ):
    CachedMetatile | null {
    const key =
      `${tilesetAddress}:${metatileId}`;

    if (
      this.metatileCache.has(key)
    ) {
      return (
        this.metatileCache.get(
          key,
        ) ?? null
      );
    }

    const metatilesAddress =
      this.readRomU32(
        tilesetAddress +
          TILESET_METATILES_OFFSET,
      );

    if (
      !this.isValidRomPointer(
        metatilesAddress,
      )
    ) {
      this.metatileCache.set(
        key,
        null,
      );
      return null;
    }

    const metatileAddress =
      metatilesAddress +
      metatileId *
        METATILE_TILE_COUNT *
        2;

    if (
      !this.isValidRomPointer(
        metatileAddress,
        METATILE_TILE_COUNT * 2,
      )
    ) {
      this.metatileCache.set(
        key,
        null,
      );
      return null;
    }

    const tiles:
      CachedMetatile['tiles'] = [];

    for (
      let tileIndex = 0;
      tileIndex <
        METATILE_TILE_COUNT;
      tileIndex++
    ) {
      const raw =
        this.readRomU16(
          metatileAddress +
            tileIndex * 2,
        );

      tiles.push({
        tileId:
          raw & 0x03ff,
        hFlip:
          (
            raw & 0x0400
          ) !== 0,
        vFlip:
          (
            raw & 0x0800
          ) !== 0,
        paletteIndex:
          (
            raw >> 12
          ) & 0x0f,
      });
    }

    const attributesOffset =
      this.isFireRedFamily
        ? FRLG_METATILE_ATTRIBUTES_OFFSET
        : EMERALD_METATILE_ATTRIBUTES_OFFSET;

    const attributesAddress =
      this.readRomU32(
        tilesetAddress +
          attributesOffset,
      );

    if (
      !this.isValidRomPointer(
        attributesAddress,
      )
    ) {
      this.metatileCache.set(
        key,
        null,
      );
      return null;
    }

    const rawAttribute =
      this.isFireRedFamily
        ? this.readRomU32(
            attributesAddress +
              metatileId * 4,
          )
        : this.readRomU16(
            attributesAddress +
              metatileId * 2,
          );

    const layerType =
      this.isFireRedFamily
        ? (
            rawAttribute &
            0x60000000
          ) >>> 29
        : (
            rawAttribute &
            0xf000
          ) >>> 12;

    const result: CachedMetatile = {
      layerType,
      tiles,
    };

    this.metatileCache.set(
      key,
      result,
    );

    return result;
  }

  private readPaletteForPlacement(
    map: MapDefinition,
    placement: AnimatedTile,
  ): RgbaColor[] | null {
    const primaryPaletteAddress =
      this.readRomU32(
        map.primaryTilesetAddress +
          TILESET_PALETTES_OFFSET,
      );

    const secondaryPaletteAddress =
      this.readRomU32(
        map.secondaryTilesetAddress +
          TILESET_PALETTES_OFFSET,
      );

    const primaryPaletteCount =
      this.isFireRedFamily
        ? FRLG_PRIMARY_PALETTE_COUNT
        : 6;

    const palettesAddress =
      placement.secondary
        ? secondaryPaletteAddress
        : primaryPaletteAddress;

    if (
      !this.isValidRomPointer(
        palettesAddress,
      )
    ) {
      return null;
    }

    const key =
      `${palettesAddress}:${placement.paletteIndex}`;

    const cached =
      this.paletteCache.get(key);

    if (cached) {
      return cached;
    }

    const colors:
      RgbaColor[] = [];

    const paletteAddress =
      palettesAddress +
      placement.paletteIndex *
        GBA_PALETTE_COLORS *
        GBA_PALETTE_COLOR_BYTES;

    for (
      let index = 0;
      index <
        GBA_PALETTE_COLORS;
      index++
    ) {
      const raw =
        this.readRomU16(
          paletteAddress +
            index *
              GBA_PALETTE_COLOR_BYTES,
        );

      const r5 =
        raw & 0x1f;

      const g5 =
        (
          raw >> 5
        ) & 0x1f;

      const b5 =
        (
          raw >> 10
        ) & 0x1f;

      colors.push({
        r:
          (r5 << 3) |
          (r5 >> 2),
        g:
          (g5 << 3) |
          (g5 >> 2),
        b:
          (b5 << 3) |
          (b5 >> 2),
      });
    }

    this.paletteCache.set(
      key,
      colors,
    );

    return colors;
  }

  private readRomU16(
    address: number,
  ): number {
    const offset =
      address -
      GBA_ROM_BASE;

    if (
      offset < 0 ||
      offset + 2 >
        this.romBytes.length
    ) {
      return 0;
    }

    return (
      this.romBytes[offset] |
      (
        this.romBytes[
          offset + 1
        ] <<
        8
      )
    );
  }

  private readRomU32(
    address: number,
  ): number {
    const offset =
      address -
      GBA_ROM_BASE;

    if (
      offset < 0 ||
      offset + 4 >
        this.romBytes.length
    ) {
      return 0;
    }

    return (
      (
        this.romBytes[offset] |
        (
          this.romBytes[
            offset + 1
          ] <<
          8
        ) |
        (
          this.romBytes[
            offset + 2
          ] <<
          16
        ) |
        (
          this.romBytes[
            offset + 3
          ] *
          0x1000000
        )
      ) >>> 0
    );
  }

  private readRomAscii(
    offset: number,
    length: number,
  ): string {
    return String.fromCharCode(
      ...this.romBytes.slice(
        offset,
        offset + length,
      ),
    );
  }

  private isValidRomPointer(
    address: number,
    size = 1,
  ): boolean {
    const offset =
      address -
      GBA_ROM_BASE;

    return (
      address >=
        GBA_ROM_BASE &&
      offset >= 0 &&
      offset + size <=
        this.romBytes.length
    );
  }
}
