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

const FRLG_NUM_TILES_IN_PRIMARY =
  640;

const EMERALD_NUM_TILES_IN_PRIMARY =
  512;

const FRLG_NUM_METATILES_IN_PRIMARY =
  640;

const EMERALD_NUM_METATILES_IN_PRIMARY =
  512;

const NUM_PALS_TOTAL =
  13;

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

  visible:
    boolean;

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

  private readonly liveTiles =
    new Map<
      string,
      Uint8Array
    >();

  private readonly animatedTileIndex =
    new Map<
      string,
      number[]
    >();

  private animatedTileIndexDirty =
    true;

  private activePrimaryTilesetAddress =
    0;

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
      visible: true,
      placementsByTile,
    };

    this.targets.set(
      key,
      target,
    );

    this.patchCurrentSnapshots(
      target,
    );

    this.animatedTileIndexDirty =
      true;
  }

  unregisterMap(
    key: string,
  ): void {
    this.targets.delete(
      key,
    );

    this.animatedTileIndexDirty =
      true;
  }

  setMapVisibility(
    key: string,
    visible: boolean,
  ): void {
    const target =
      this.targets.get(
        key,
      );

    if (!target) {
      return;
    }

    target.visible = visible;
  }

  clear(): void {
    this.targets.clear();
    this.metatileCache.clear();
    this.paletteCache.clear();
    this.liveTiles.clear();
    this.animatedTileIndex.clear();
    this.animatedTileIndexDirty =
      true;
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
    const primaryChanged =
      primaryTilesetAddress !==
      this.activePrimaryTilesetAddress;

    const secondaryChanged =
      secondaryTilesetAddress !==
      this.activeSecondaryTilesetAddress;

    this.activePrimaryTilesetAddress =
      primaryTilesetAddress;

    this.activeSecondaryTilesetAddress =
      secondaryTilesetAddress;

    if (primaryChanged) {
      this.invalidateTilesetSnapshots(
        primaryTilesetAddress,
        false,
      );
    }

    if (secondaryChanged) {
      this.invalidateTilesetSnapshots(
        secondaryTilesetAddress,
        true,
      );
    }

    if (
      primaryTilesetAddress <= 0 &&
      secondaryTilesetAddress <= 0
    ) {
      return;
    }

    this.frameCounter++;

    if (
      this.frameCounter %
        POLL_EVERY_FRAMES !==
      0
    ) {
      return;
    }

    this.updateTileset(
      primaryTilesetAddress,
      false,
    );

    this.updateTileset(
      secondaryTilesetAddress,
      true,
    );
  }

  private updateTileset(
    tilesetAddress:
      number,
    secondary:
      boolean,
  ): void {
    if (
      tilesetAddress <= 0
    ) {
      return;
    }

    const watched =
      this.collectAnimatedTileIds(
        tilesetAddress,
        secondary,
      );

    if (
      watched.length === 0
    ) {
      return;
    }

    const snapshots =
      this.readAnimatedTileSnapshots(
        watched,
      );

    for (
      const [tileId, tileBytes] of
        snapshots
    ) {
      const key =
        this.liveTileKey(
          tilesetAddress,
          tileId,
        );

      const previous =
        this.liveTiles.get(
          key,
        );

      if (
        previous === undefined ||
        !this.tileBytesEqual(
          previous,
          tileBytes,
        )
      ) {
        this.patchTargetsForTile(
          tilesetAddress,
          tileId,
          tileBytes,
        );

        this.liveTiles.set(
          key,
          tileBytes,
        );
      }
    }
  }

  private patchCurrentSnapshots(
    target:
      AnimatedMapTarget,
  ): void {
    const primary =
      target.map.primaryTilesetAddress;

    const secondary =
      target.map.secondaryTilesetAddress;

    for (
      const [tileId] of
        target.placementsByTile
    ) {
      const usesSecondary =
        target.placementsByTile
          .get(tileId)
          ?.some(
            placement =>
              placement.secondary,
          ) ?? false;

      const tilesetAddress =
        usesSecondary
          ? secondary
          : primary;

      const live =
        this.liveTiles.get(
          this.liveTileKey(
            tilesetAddress,
            tileId,
          ),
        );

      if (live) {
        this.patchTarget(
          target,
          tileId,
          live,
        );
      }
    }
  }

  private invalidateTilesetSnapshots(
    tilesetAddress:
      number,
    secondary:
      boolean,
  ): void {
    if (
      tilesetAddress <= 0
    ) {
      return;
    }

    const prefix =
      tilesetAddress.toString(16) +
      ':';

    for (
      const key of
        this.liveTiles.keys()
    ) {
      if (
        key.startsWith(
          prefix,
        )
      ) {
        this.liveTiles.delete(
          key,
        );
      }
    }
  }

  private collectAnimatedTileIds(
    tilesetAddress:
      number,
    secondary:
      boolean,
  ): number[] {
    const indexKey =
      this.liveTileKey(
        tilesetAddress,
        secondary ? 1 : 0,
      );

    if (
      !this.animatedTileIndexDirty
    ) {
      return (
        this.animatedTileIndex.get(
          indexKey,
        ) ?? []
      );
    }

    this.animatedTileIndex.clear();

    for (
      const target of
        this.targets.values()
    ) {
      const addPlacements =
        (
          placements:
            Map<
              number,
              AnimatedTile[]
            >,
          address:
            number,
          isSecondary:
            boolean,
        ): void => {
          const ids =
            new Set<number>(
              this.animatedTileIndex.get(
                this.liveTileKey(
                  address,
                  isSecondary
                    ? 1
                    : 0,
                ),
              ) ?? [],
            );

          for (
            const [tileId, entries] of
              placements
          ) {
            if (
              entries.some(
                entry =>
                  entry.secondary ===
                  isSecondary,
              )
            ) {
              ids.add(
                tileId,
              );
            }
          }

          this.animatedTileIndex.set(
            this.liveTileKey(
              address,
              isSecondary
                ? 1
                : 0,
            ),
            Array.from(
              ids,
            ).sort(
              (a, b) =>
                a - b,
            ),
          );
        };

      addPlacements(
        target.placementsByTile,
        target.map.primaryTilesetAddress,
        false,
      );

      addPlacements(
        target.placementsByTile,
        target.map.secondaryTilesetAddress,
        true,
      );
    }

    this.animatedTileIndexDirty =
      false;

    return (
      this.animatedTileIndex.get(
        indexKey,
      ) ?? []
    );
  }

  private readAnimatedTileSnapshots(
    tileIds:
      readonly number[],
  ): Map<
    number,
    Uint8Array
  > {
    const snapshots =
      new Map<
        number,
        Uint8Array
      >();

    let index = 0;

    while (
      index < tileIds.length
    ) {
      const first =
        tileIds[index];

      let last =
        first;

      index++;

      while (
        index < tileIds.length &&
        tileIds[index] ===
          last + 1
      ) {
        last =
          tileIds[index];

        index++;
      }

      const count =
        last -
        first +
        1;

      const bytes =
        this.memoryReader.readRange(
          GBA_VRAM_BASE +
            first *
              TILE_BYTES,
          count *
            TILE_BYTES,
        );

      for (
        let tileIndex = 0;
        tileIndex < count;
        tileIndex++
      ) {
        const start =
          tileIndex *
          TILE_BYTES;

        snapshots.set(
          first + tileIndex,
          bytes.slice(
            start,
            start +
              TILE_BYTES,
          ),
        );
      }
    }

    return snapshots;
  }

  private patchTargetsForTile(
    tilesetAddress:
      number,
    tileId:
      number,
    tileBytes:
      Uint8Array,
  ): void {
    for (
      const target of
        this.targets.values()
    ) {
      const placements =
        target.placementsByTile.get(
          tileId,
        );

      if (
        !placements ||
        placements.length ===
          0
      ) {
        continue;
      }

      if (!target.visible) {
        continue;
      }

      const mapUsesTileset =
        target.map.primaryTilesetAddress ===
          tilesetAddress ||
        target.map.secondaryTilesetAddress ===
          tilesetAddress;

      if (!mapUsesTileset) {
        continue;
      }

      this.patchTarget(
        target,
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

    const decodedPixels =
      new Uint8Array(64);

    for (
      let y = 0;
      y < TILE_SIZE;
      y++
    ) {
      for (
        let x = 0;
        x < TILE_SIZE;
        x++
      ) {
        decodedPixels[
          y * TILE_SIZE + x
        ] =
          this.read4BppPixel(
            tileBytes,
            x,
            y,
          );
      }
    }

    let baseDirty =
      false;

    let overlayDirty =
      false;

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

      const texture =
        placement.target ===
        'base'
          ? target.baseTexture
          : target.overlayTexture;

      const textureData =
        texture.image
          .data as TextureData;

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
          const destinationX =
            placement.x +
            (
              placement.hFlip
                ? TILE_SIZE -
                  1 -
                  sourceX
                : sourceX
            );

          const offset =
            (
              destinationY *
                textureWidth +
              destinationX
            ) *
            RGBA_CHANNEL_COUNT;

          if (
            offset < 0 ||
            offset + 3 >=
              textureData.length
          ) {
            continue;
          }

          const paletteIndex =
            decodedPixels[
              sourceY * TILE_SIZE +
              sourceX
            ];

          if (
            paletteIndex ===
            0
          ) {
            // The GBA replaces this tile in VRAM. Do not reveal the
            // stale static frame underneath transparent pixels.
            textureData[offset] = 0;
            textureData[offset + 1] = 0;
            textureData[offset + 2] = 0;
            textureData[offset + 3] = 0;
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

  getDebugAnimationPlacements(
    mapKey?: string,
  ): Array<{
    mapKey: string;
    tileId: number;
    x: number;
    y: number;
    hFlip: boolean;
    vFlip: boolean;
    target: string;
    secondary: boolean;
  }> {
    const result: Array<{
      mapKey: string;
      tileId: number;
      x: number;
      y: number;
      hFlip: boolean;
      vFlip: boolean;
      target: string;
      secondary: boolean;
    }> = [];

    for (
      const [key, target] of
        this.targets
    ) {
      if (
        mapKey &&
        key !== mapKey
      ) {
        continue;
      }

      for (
        const placements of
          target.placementsByTile.values()
      ) {
        for (
          const placement of
            placements
        ) {
          result.push({
            mapKey: key,
            tileId:
              placement.tileId,
            x:
              placement.x,
            y:
              placement.y,
            hFlip:
              placement.hFlip,
            vFlip:
              placement.vFlip,
            target:
              placement.target,
            secondary:
              placement.secondary,
          });
        }
      }
    }

    return result;
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

    const primaryCount =
      this.getNumTilesInPrimary();

    const metatilePrimaryCount =
      this.getNumMetatilesInPrimary();

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

        const secondary =
          block.metatileId >=
          metatilePrimaryCount;

        const tilesetAddress =
          secondary
            ? map.secondaryTilesetAddress
            : map.primaryTilesetAddress;

        const localMetatileId =
          secondary
            ? block.metatileId -
              metatilePrimaryCount
            : block.metatileId;

        const metatile =
          this.readPrimaryMetatile(
            tilesetAddress,
            localMetatileId,
          );

        if (!metatile) {
          continue;
        }

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
            secondary
              ? primaryCount +
                tile.tileId
              : tile.tileId;

          if (
            !this.isAnimatedTileForGame(
              globalTileId,
              secondary,
            )
          ) {
            continue;
          }

          const localTileIndex =
            tileIndex %
            4;

          const target =
            this.resolveTextureTarget(
              metatile.layerType,
              tileIndex,
            );

          if (!target) {
            continue;
          }

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
              (
                localTileIndex %
                2
              ) *
              TILE_SIZE,
            y:
              blockY *
                METATILE_SIZE +
              Math.floor(
                localTileIndex /
                2,
              ) *
              TILE_SIZE,
            secondary,
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

  private isAnimatedTileForGame(
    globalTileId:
      number,
    secondary:
      boolean,
  ): boolean {
    if (
      !secondary
    ) {
      if (
        this.isFireRedFamily
      ) {
        return (
          (
            globalTileId >=
              416 &&
            globalTileId <
              482
          ) ||
          (
            globalTileId >=
              508 &&
            globalTileId <
              512
          )
        );
      }

      return (
        (
          globalTileId >=
            432 &&
          globalTileId <
            462
        ) ||
        (
          globalTileId >=
            464 &&
          globalTileId <
            474
        ) ||
        (
          globalTileId >=
            480 &&
          globalTileId <
            490
        ) ||
        (
          globalTileId >=
            496 &&
          globalTileId <
            502
        ) ||
        (
          globalTileId >=
            508 &&
          globalTileId <
            512
        )
      );
    }

    const localId =
      globalTileId -
      this.getNumTilesInPrimary();

    if (
      localId < 0
    ) {
      return false;
    }

    if (
      this.isFireRedFamily
    ) {
      return (
        (
          localId >= 99 &&
          localId < 112
        ) ||
        (
          localId >= 240 &&
          localId < 247
        ) ||
        (
          localId >= 256 &&
          localId < 264
        ) ||
        (
          localId >= 336 &&
          localId < 344
        )
      );
    }

    return (
      (
        localId >= 96 &&
        localId < 164
      ) ||
      (
        localId >= 170 &&
        localId < 176
      ) ||
      (
        localId >= 218 &&
        localId < 228
      ) ||
      (
        localId >= 240 &&
        localId < 336
      ) ||
      (
        localId >= 416 &&
        localId < 420
      ) ||
      (
        localId >= 448 &&
        localId < 452
      ) ||
      (
        localId >= 464 &&
        localId < 494
      ) ||
      (
        localId >= 496 &&
        localId < 508
      )
    );
  }

  private getNumTilesInPrimary():
    number {
    return this.isFireRedFamily
      ? FRLG_NUM_TILES_IN_PRIMARY
      : EMERALD_NUM_TILES_IN_PRIMARY;
  }

  private getNumMetatilesInPrimary():
    number {
    return this.isFireRedFamily
      ? FRLG_NUM_METATILES_IN_PRIMARY
      : EMERALD_NUM_METATILES_IN_PRIMARY;
  }

  private readPrimaryMetatile(
    tilesetAddress: number,
    metatileId: number,
  ):
    CachedMetatile | null {
    const key =
      `${tilesetAddress}:${metatileId}`;

    if (
      this.metatileCache.has(
        key,
      )
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
          ) >>>
          29
        : (
            rawAttribute &
            0xf000
          ) >>>
          12;

    const result:
      CachedMetatile = {
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
  ):
    RgbaColor[] | null {
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

    const palettesAddress =
      placement.secondary
        ? secondaryPaletteAddress
        : primaryPaletteAddress;

    const paletteIndex =
      placement.paletteIndex;

    if (
      !this.isValidRomPointer(
        palettesAddress,
      ) ||
      paletteIndex < 0 ||
      paletteIndex >=
        NUM_PALS_TOTAL
    ) {
      return null;
    }

    const key =
      `${palettesAddress}:${paletteIndex}`;

    const cached =
      this.paletteCache.get(
        key,
      );

    if (cached) {
      return cached;
    }

    const paletteAddress =
      palettesAddress +
      paletteIndex *
        GBA_PALETTE_COLORS *
        GBA_PALETTE_COLOR_BYTES;

    const colors:
      RgbaColor[] = [];

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
          this.romBytes[offset + 2]
          <<
          16
        ) |
        (
          this.romBytes[offset + 3]
          *
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

  private tileBytesEqual(
    a:
      Uint8Array,
    b:
      Uint8Array,
  ): boolean {
    if (
      a.length !==
      b.length
    ) {
      return false;
    }

    for (
      let index = 0;
      index <
        a.length;
      index++
    ) {
      if (
        a[index] !==
        b[index]
      ) {
        return false;
      }
    }

    return true;
  }

  private liveTileKey(
    tilesetAddress:
      number,
    tileId:
      number,
  ): string {
    return (
      tilesetAddress.toString(16) +
      ':' +
      tileId.toString(16)
    );
  }
}
