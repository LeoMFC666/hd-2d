import {
  EMPTY_GAME_STATE,
  type Direction,
  type GameState,
  type MapBlockState,
  type MetatileState,
  type MetatileTileState,
  type MovementState,
  type TilesetState,
} from './GameState';

import type { MemoryReader } from './MemoryReader';

import { TileGraphicsDecoder } from './TileGraphicsDecoder';

import {
  detectGen3Game,
  type Gen3GameProfile,
  type Gen3ObjectStateLayout,
} from './GameProfile';

const GBA_ROM_HEADER_GAME_CODE =
  0x080000ac;

const GBA_ROM_BASE =
  0x08000000;

const GBA_ROM_HEADER_REVISION =
  0x080000bc;

const EWRAM_START =
  0x02000000;

const EWRAM_END =
  0x02040000;

const MAP_HEADER_MAP_LAYOUT_OFFSET =
  0x00;

const MAP_HEADER_MAP_LAYOUT_ID_OFFSET =
  0x12;

const MAP_GRID_BORDER_OFFSET =
  7;

const MAP_LAYOUT_WIDTH_OFFSET =
  0x00;

const MAP_LAYOUT_HEIGHT_OFFSET =
  0x04;

const MAP_LAYOUT_BORDER_OFFSET =
  0x08;

const MAP_LAYOUT_MAP_OFFSET =
  0x0c;

const MAP_LAYOUT_PRIMARY_TILESET_OFFSET =
  0x10;

const MAP_LAYOUT_SECONDARY_TILESET_OFFSET =
  0x14;

const TILESET_IS_COMPRESSED_OFFSET =
  0x00;

const TILESET_IS_SECONDARY_OFFSET =
  0x01;

const TILESET_TILES_OFFSET =
  0x04;

const TILESET_PALETTES_OFFSET =
  0x08;

const TILESET_METATILES_OFFSET =
  0x0c;

const EMERALD_TILESET_METATILE_ATTRIBUTES_OFFSET =
  0x10;

const FRLG_TILESET_METATILE_ATTRIBUTES_OFFSET =
  0x14;

const METATILE_TILE_COUNT =
  8;

const METATILE_LAYER_TYPE_NORMAL =
  0;

const METATILE_LAYER_TYPE_COVERED =
  1;

const METATILE_LAYER_TYPE_SPLIT =
  2;

const NUM_METATILES_TOTAL =
  1024;

const NUM_TILES_TOTAL =
  1024;

const EMERALD_NUM_TILES_IN_PRIMARY =
  512;

const FRLG_NUM_TILES_IN_PRIMARY =
  640;

const EMERALD_NUM_METATILES_IN_PRIMARY =
  512;

const FRLG_NUM_METATILES_IN_PRIMARY =
  640;

const EMERALD_NUM_PALS_IN_PRIMARY =
  6;

const FRLG_NUM_PALS_IN_PRIMARY =
  7;

const NUM_PALS_TOTAL =
  13;

const MAPGRID_METATILE_ID_MASK =
  0x03ff;

const MAPGRID_COLLISION_MASK =
  0x0c00;

const MAPGRID_ELEVATION_MASK =
  0xf000;

const MAPGRID_COLLISION_SHIFT =
  10;

const MAPGRID_ELEVATION_SHIFT =
  12;

const EMERALD_METATILE_ATTRIBUTE_BEHAVIOR_MASK =
  0x00ff;

const EMERALD_METATILE_ATTRIBUTE_LAYER_TYPE_MASK =
  0xf000;

const EMERALD_METATILE_ATTRIBUTE_LAYER_TYPE_SHIFT =
  12;

const FRLG_METATILE_ATTRIBUTE_BEHAVIOR_MASK =
  0x000001ff;

const FRLG_METATILE_ATTRIBUTE_LAYER_TYPE_MASK =
  0x60000000;

const FRLG_METATILE_ATTRIBUTE_LAYER_TYPE_SHIFT =
  29;

const TILE_ID_MASK =
  0x03ff;

const TILE_HFLIP_MASK =
  0x0400;

const TILE_VFLIP_MASK =
  0x0800;

const TILE_PALETTE_MASK =
  0xf000;

const TILE_PALETTE_SHIFT =
  12;

const NORMAL_METATILE_BACKGROUND_TILE_ID =
  0x14;

const NORMAL_METATILE_BACKGROUND_PALETTE =
  3;

const GBA_PALETTE_COLORS =
  16;

const GBA_PALETTE_COLOR_BYTES =
  2;

const GBA_TILE_SIZE =
  8;

const METATILE_SIZE =
  16;

const RGBA_CHANNEL_COUNT =
  4;

export interface Gen3MetatileGraphics {
  metatileId: number;
  layerType: number;
  width: number;
  height: number;
  pixels: Uint8ClampedArray;
  basePixels: Uint8ClampedArray;
  foregroundPixels: Uint8ClampedArray;
}

const PLAYER_AVATAR_STATE_NOT_MOVING =
  0;

const PLAYER_AVATAR_STATE_TURN_DIRECTION =
  1;

const PLAYER_AVATAR_STATE_MOVING =
  2;

const DIR_SOUTH = 1;
const DIR_NORTH = 2;
const DIR_WEST = 3;
const DIR_EAST = 4;

export class Gen3StateAdapter {
  private readonly memoryReader: MemoryReader;

  private readonly profile:
    Gen3GameProfile | null;

  private readonly tileGraphicsDecoder:
    TileGraphicsDecoder;

  private previous: GameState =
    structuredClone(
      EMPTY_GAME_STATE,
    );

  private mapHeaderAddress = 0;

  private mapHeaderLayoutId = 0;

  private mapHeaderMapGroup = -1;

  private mapHeaderMapNumber = -1;

  private lastMapHeaderLookupKey = '';

  private lastMapHeaderLookupAt = 0;

  private lastLoggedMapDataAddress = 0;

  private lastLoggedPrimaryTilesetAddress = 0;

  private lastLoggedSecondaryTilesetAddress = 0;

  private lastLoggedMetatileId = -1;

  private lastLoggedTileId = -1;

  private lastLoggedMetatileGraphicsKey = '';

  private primaryMetatileGraphics: Gen3MetatileGraphics | null = null;

  private readonly romBytes: Uint8Array | null;

  private readonly romDataView: DataView | null;

  private mapLayoutsTableOffset = -1;

  private mapLayoutsTableLength = 0;

  private mapLayoutsTableSearchCompleted = false;

  private mapBlocks: MapBlockState[] = [];

  private mapBlocksWidth = 0;

  private mapBlocksHeight = 0;

  private mapBlocksPrimaryTilesetAddress = 0;

  private mapBlocksSecondaryTilesetAddress = 0;

  private currentPrimaryTileset: TilesetState | null = null;

  private currentSecondaryTileset: TilesetState | null = null;

  private cachedMapState:
    GameState['map'] | null =
    null;

  private cachedMapStateKey =
    '';

  private readonly runtimeState:
    GameState =
    structuredClone(
      EMPTY_GAME_STATE,
    );

  private metatileGraphicsCache = new Map<
    string,
    Gen3MetatileGraphics | null
  >();

  constructor(
    memoryReader: MemoryReader,
    romBytes?: Uint8Array,
  ) {
    this.memoryReader =
      memoryReader;

    this.romBytes =
      romBytes ?? null;

    this.romDataView =
      romBytes
        ? new DataView(
            romBytes.buffer,
            romBytes.byteOffset,
            romBytes.byteLength,
          )
        : null;

    this.profile =
      this.detectProfile();

    this.tileGraphicsDecoder =
      new TileGraphicsDecoder(
        memoryReader,
        this.romBytes ?? undefined,
      );
  }

  readState(): GameState {
    const state =
      this.runtimeState;

    if (!this.profile) {
      return state;
    }

    const saveBlock1Address =
      this.resolveSaveBlock1Address();

    this.readMapState(
      state,
      saveBlock1Address,
    );

    this.readPlayerPositionFromSaveBlock(
      state,
      saveBlock1Address,
    );

    if (
      this.profile.memory.objectState
    ) {
      this.readPlayerObjectState(
        state,
        this.profile.memory.objectState,
      );
    } else {
      state.player.direction =
        this.readDirectionFromPosition(
          state.player.x,
          state.player.y,
        );

      state.player.movementState =
        this.readMovementStateFromPosition(
          state.player.x,
          state.player.y,
        );
    }

    state.game = {
      game: 'GEN 3',
      version:
        this.profile.title,
      region:
        this.profile.id,
      revision:
        String(
          this.profile.revision,
        ),
    };

    this.previous =
      state;

    return state;
  }

  getPrimaryMetatileGraphics(): Gen3MetatileGraphics | null {
    return this.primaryMetatileGraphics;
  }

  getMemoryReader(): MemoryReader {
    return this.memoryReader;
  }

  private readMapState(
    state: GameState,
    saveBlock1Address: number,
  ): void {
    const layout =
      this.profile?.memory.mapState;

    if (
      !layout ||
      !this.isValidEwramPointer(
        saveBlock1Address,
      )
    ) {
      return;
    }

    const mapGroup =
      this.memoryReader.readU8(
        saveBlock1Address +
          layout.locationMapGroupOffset,
      );

    const mapNumber =
      this.memoryReader.readU8(
        saveBlock1Address +
          layout.locationMapNumOffset,
      );

    const mapLayoutId =
      this.memoryReader.readU16(
        saveBlock1Address +
          layout.mapLayoutIdOffset,
      );

    const key =
      String(mapGroup) +
      ':' +
      String(mapNumber) +
      ':' +
      String(mapLayoutId);

    if (
      this.cachedMapState &&
      this.cachedMapStateKey ===
        key
    ) {
      state.map =
        this.cachedMapState;

      return;
    }

    state.map =
      structuredClone(
        EMPTY_GAME_STATE.map,
      );

    state.map.mapGroup =
      mapGroup;

    state.map.mapNumber =
      mapNumber;

    state.map.mapLayoutId =
      mapLayoutId;

    this.readLoadedMapLayout(
      state,
      mapLayoutId,
      mapGroup,
      mapNumber,
    );

    if (
      state.map.mapLayoutAddress !==
        0 &&
      state.map.width > 0 &&
      state.map.height > 0 &&
      state.map.mapDataAddress !==
        0
    ) {
      this.cachedMapState =
        state.map;

      this.cachedMapStateKey =
        key;
    } else {
      this.cachedMapState =
        null;

      this.cachedMapStateKey =
        '';
    }
  }

  private readLoadedMapLayout(
    state: GameState,
    mapLayoutId: number,
    mapGroup: number,
    mapNumber: number,
  ): void {
    if (mapLayoutId === 0) {
      this.mapHeaderAddress = 0;
      this.mapHeaderLayoutId = 0;
      this.mapHeaderMapGroup = -1;
      this.mapHeaderMapNumber = -1;
      this.lastMapHeaderLookupKey = '';
      this.lastMapHeaderLookupAt = 0;
      return;
    }

    const activeMapHeaderAddress =
      this.profile?.memory.activeMapHeaderAddress;

    if (
      activeMapHeaderAddress !== undefined &&
      this.isValidEwramPointer(
        activeMapHeaderAddress,
      ) &&
      this.memoryReader.readU16(
        activeMapHeaderAddress +
          MAP_HEADER_MAP_LAYOUT_ID_OFFSET,
      ) === mapLayoutId
    ) {
      this.mapHeaderAddress =
        activeMapHeaderAddress;

      this.mapHeaderLayoutId =
        mapLayoutId;

      this.mapHeaderMapGroup =
        mapGroup;

      this.mapHeaderMapNumber =
        mapNumber;

      this.readMapLayoutFromHeader(
        state,
        activeMapHeaderAddress,
      );

      if (state.map.width > 0) {
        return;
      }
    }

    if (
      this.mapHeaderAddress !== 0 &&
      this.mapHeaderLayoutId ===
        mapLayoutId &&
      this.mapHeaderMapGroup ===
        mapGroup &&
      this.mapHeaderMapNumber ===
        mapNumber
    ) {
      this.readMapLayoutFromHeader(
        state,
        this.mapHeaderAddress,
      );

      if (state.map.width > 0) {
        return;
      }
    }

    const now = performance.now();
    const lookupKey =
      `${mapGroup}:${mapNumber}:${mapLayoutId}`;

    if (
      this.lastMapHeaderLookupKey ===
        lookupKey &&
      now - this.lastMapHeaderLookupAt < 1000
    ) {
      return;
    }

    this.lastMapHeaderLookupKey =
      lookupKey;

    this.lastMapHeaderLookupAt =
      now;

    const mapHeaderAddress =
      this.findMapHeaderAddress(
        mapLayoutId,
      );

    if (mapHeaderAddress !== 0) {
      this.mapHeaderAddress =
        mapHeaderAddress;

      this.mapHeaderLayoutId =
        mapLayoutId;

      this.mapHeaderMapGroup =
        mapGroup;

      this.mapHeaderMapNumber =
        mapNumber;

      this.readMapLayoutFromHeader(
        state,
        mapHeaderAddress,
      );
    }

    if (state.map.width === 0) {
      const mapLayoutAddress =
        this.findMapLayoutAddress(
          mapLayoutId,
        );

      if (mapLayoutAddress !== 0) {
        this.readMapLayout(
          state,
          0,
          mapLayoutAddress,
        );
      }
    }
  }

  private readMapLayoutFromHeader(
    state: GameState,
    mapHeaderAddress: number,
  ): void {
    const mapLayoutAddress =
      this.memoryReader.readU32(
        mapHeaderAddress +
          MAP_HEADER_MAP_LAYOUT_OFFSET,
      );

    if (
      !this.isValidRomPointer(
        mapLayoutAddress,
      )
    ) {
      return;
    }

    this.readMapLayout(
      state,
      mapHeaderAddress,
      mapLayoutAddress,
    );
  }

  private readMapLayout(
    state: GameState,
    mapHeaderAddress: number,
    mapLayoutAddress: number,
  ): void {
    const width =
      this.memoryReader.readU32(
        mapLayoutAddress +
          MAP_LAYOUT_WIDTH_OFFSET,
      );

    const height =
      this.memoryReader.readU32(
        mapLayoutAddress +
          MAP_LAYOUT_HEIGHT_OFFSET,
      );

    if (
      !this.isValidMapDimension(
        width,
      ) ||
      !this.isValidMapDimension(
        height,
      )
    ) {
      return;
    }

    const mapDataAddress =
      this.memoryReader.readU32(
        mapLayoutAddress +
          MAP_LAYOUT_MAP_OFFSET,
      );

    const primaryTilesetAddress =
      this.memoryReader.readU32(
        mapLayoutAddress +
          MAP_LAYOUT_PRIMARY_TILESET_OFFSET,
      );

    const secondaryTilesetAddress =
      this.memoryReader.readU32(
        mapLayoutAddress +
          MAP_LAYOUT_SECONDARY_TILESET_OFFSET,
      );

    if (
      !this.isValidRomPointer(
        mapDataAddress,
      ) ||
      !this.isValidRomPointer(
        primaryTilesetAddress,
      ) ||
      !this.isValidRomPointer(
        secondaryTilesetAddress,
      )
    ) {
      return;
    }

    state.map.mapHeaderAddress =
      mapHeaderAddress;

    state.map.mapLayoutAddress =
      mapLayoutAddress;

    state.map.mapDataAddress =
      mapDataAddress;

    state.map.primaryTilesetAddress =
      primaryTilesetAddress;

    state.map.secondaryTilesetAddress =
      secondaryTilesetAddress;

    state.map.width =
      width;

    state.map.height =
      height;

    state.map.cellCount =
      width * height;

    const currentMapCacheKey =
      String(
        state.map.mapGroup,
      ) +
      ':' +
      String(
        state.map.mapNumber,
      ) +
      ':' +
      String(
        state.map.mapLayoutId,
      );

    if (
      this.cachedMapStateKey !==
        currentMapCacheKey ||
      this.cachedMapState?.mapLayoutAddress !==
        mapLayoutAddress ||
      this.cachedMapState?.mapDataAddress !==
        mapDataAddress ||
      this.cachedMapState?.primaryTilesetAddress !==
        primaryTilesetAddress ||
      this.cachedMapState?.secondaryTilesetAddress !==
        secondaryTilesetAddress
    ) {
      this.cachedMapState =
        null;

      this.cachedMapStateKey =
        '';
    }

    state.map.blockSample =
      this.readMapSample(
        mapDataAddress,
        width,
        height,
      );

    state.map.primaryTileset =
      this.readTileset(
        primaryTilesetAddress,
      );

    state.map.secondaryTileset =
      this.readTileset(
        secondaryTilesetAddress,
      );

    this.currentPrimaryTileset =
      state.map.primaryTileset;

    this.currentSecondaryTileset =
      state.map.secondaryTileset;

    if (
      mapDataAddress !==
        this.lastLoggedMapDataAddress ||
      width !== this.mapBlocksWidth ||
      height !== this.mapBlocksHeight ||
      primaryTilesetAddress !==
        this.mapBlocksPrimaryTilesetAddress ||
      secondaryTilesetAddress !==
        this.mapBlocksSecondaryTilesetAddress
    ) {
      this.mapBlocks =
        this.readMapBlocks(
          mapDataAddress,
          width,
          height,
        );

      this.mapBlocksWidth =
        width;

      this.mapBlocksHeight =
        height;

      this.mapBlocksPrimaryTilesetAddress =
        primaryTilesetAddress;

      this.mapBlocksSecondaryTilesetAddress =
        secondaryTilesetAddress;

    }

    const firstBlock =
      this.mapBlocks[0];

    if (firstBlock) {
      const source =
        this.resolveMetatileSource(
          firstBlock.metatileId,
        );

      state.map.primaryMetatileSample =
        source?.tileset ===
          state.map.primaryTileset
          ? this.readMetatile(
              source.tileset,
              source.localId,
            )
          : null;

      state.map.secondaryMetatileSample =
        source?.tileset ===
          state.map.secondaryTileset
          ? this.readMetatile(
              source.tileset,
              source.localId,
            )
          : null;
    }

    if (
      mapDataAddress !==
      this.lastLoggedMapDataAddress
    ) {
      console.log(
        'Map Data:',
        {
          address:
            `0x${mapDataAddress.toString(16)}`,

          width,
          height,

          cellCount:
            width * height,

          sample:
            state.map.blockSample,
        },
      );

      this.lastLoggedMapDataAddress =
        mapDataAddress;
    }

    if (
      primaryTilesetAddress !==
        this.lastLoggedPrimaryTilesetAddress ||
      secondaryTilesetAddress !==
        this.lastLoggedSecondaryTilesetAddress
    ) {
      console.log(
        'Tilesets:',
        {
          primary:
            this.formatTileset(
              state.map.primaryTileset,
            ),

          secondary:
            this.formatTileset(
              state.map.secondaryTileset,
            ),
        },
      );

      this.lastLoggedPrimaryTilesetAddress =
        primaryTilesetAddress;

      this.lastLoggedSecondaryTilesetAddress =
        secondaryTilesetAddress;
    }

    const metatileId =
      state.map.blockSample[0]?.metatileId ??
      -1;

    if (
      metatileId !==
      this.lastLoggedMetatileId
    ) {
      const primaryMetatile =
        state.map.primaryMetatileSample;

      const secondaryMetatile =
        state.map.secondaryMetatileSample;

      console.log(
        'Metatile Sample:',
        {
          metatileId,

          primary: primaryMetatile
            ? {
                id:
                  primaryMetatile.id,

                rawAttribute:
                  primaryMetatile.rawAttribute,

                behavior:
                  primaryMetatile.behavior,

                layerType:
                  primaryMetatile.layerType,

                tiles:
                  primaryMetatile.tiles,
              }
            : null,

          secondary: secondaryMetatile
            ? {
                id:
                  secondaryMetatile.id,

                rawAttribute:
                  secondaryMetatile.rawAttribute,

                behavior:
                  secondaryMetatile.behavior,

                layerType:
                  secondaryMetatile.layerType,

                tiles:
                  secondaryMetatile.tiles,
              }
            : null,
        },
      );

      this.lastLoggedMetatileId =
        metatileId;
    }

    if (firstBlock) {
      const graphics =
        this.getMetatileGraphics(
          firstBlock.metatileId,
        );

      if (graphics) {
        this.primaryMetatileGraphics =
          graphics;

        const graphicsKey =
          `${graphics.metatileId}:${graphics.layerType}`;

        if (
          graphicsKey !==
          this.lastLoggedMetatileGraphicsKey
        ) {
          console.log(
            'Metatile Graphics:',
            {
              ...graphics,
              rows:
                this.formatRgbaPixels(
                  graphics.pixels,
                  METATILE_SIZE,
                ),
            },
          );

          this.lastLoggedMetatileGraphicsKey =
            graphicsKey;
        }
      }
    }
  }

    getMapRenderData(
    mapDataAddress: number,
    width: number,
    height: number,
    primaryTilesetAddress: number,
    secondaryTilesetAddress: number,
  ): {
    blocks: MapBlockState[];
    graphics: Map<
      number,
      Gen3MetatileGraphics | null
    >;
  } | null {
    if (
      width <= 0 ||
      height <= 0
    ) {
      return null;
    }

    const previousPrimary =
      this.currentPrimaryTileset;

    const previousSecondary =
      this.currentSecondaryTileset;

    try {
      const primaryTileset =
        this.readTileset(
          primaryTilesetAddress,
        );

      const secondaryTileset =
        this.readTileset(
          secondaryTilesetAddress,
        );

      if (
        primaryTileset.address === 0 ||
        secondaryTileset.address === 0
      ) {
        return null;
      }

      this.currentPrimaryTileset =
        primaryTileset;

      this.currentSecondaryTileset =
        secondaryTileset;

      const blocks =
        this.readMapBlocks(
          mapDataAddress,
          width,
          height,
        );

      const usedMetatiles =
        new Set<number>();

      for (
        const block of blocks
      ) {
        usedMetatiles.add(
          block.metatileId,
        );
      }

      const graphics =
        new Map<
          number,
          Gen3MetatileGraphics | null
        >();

      for (
        const metatileId of
          usedMetatiles
      ) {
        graphics.set(
          metatileId,
          this.getMetatileGraphics(
            metatileId,
          ),
        );
      }

      return {
        blocks,
        graphics,
      };
    } finally {
      this.currentPrimaryTileset =
        previousPrimary;

      this.currentSecondaryTileset =
        previousSecondary;

      // Persistent graphics cache is keyed by both tilesets and metatile ID.
    }
  }
  
  getMapBlocks(): readonly MapBlockState[] {
    return this.mapBlocks;
  }


  getMetatileGraphics(
    metatileId: number,
  ): Gen3MetatileGraphics | null {
    if (
      metatileId < 0 ||
      metatileId >= NUM_METATILES_TOTAL
    ) {
      return null;
    }

    const cacheKey =
      this.createMetatileGraphicsCacheKey(
        metatileId,
      );

    if (
      this.metatileGraphicsCache.has(
        cacheKey,
      )
    ) {
      return (
        this.metatileGraphicsCache.get(
          cacheKey,
        ) ?? null
      );
    }

    const source =
      this.resolveMetatileSource(
        metatileId,
      );

    if (!source) {
      this.metatileGraphicsCache.set(
        cacheKey,
        null,
      );

      return null;
    }

    const metatile =
      this.readMetatile(
        source.tileset,
        source.localId,
      );

    if (!metatile) {
      this.metatileGraphicsCache.set(
        cacheKey,
        null,
      );

      return null;
    }

    const layers =
      this.readMetatileRgba(
        metatile,
      );

    if (!layers) {
      this.metatileGraphicsCache.set(
        cacheKey,
        null,
      );

      return null;
    }

    const graphics: Gen3MetatileGraphics = {
      metatileId,
      layerType:
        metatile.layerType,
      width:
        METATILE_SIZE,
      height:
        METATILE_SIZE,
      ...layers,
    };

    this.metatileGraphicsCache.set(
      cacheKey,
      graphics,
    );

    return graphics;
  }

  private resolveMetatileSource(
    metatileId: number,
  ): {
    tileset: TilesetState;
    localId: number;
  } | null {
    if (
      metatileId < 0 ||
      metatileId >= NUM_METATILES_TOTAL
    ) {
      return null;
    }

    if (
      metatileId <
      this.getNumMetatilesInPrimary()
    ) {
      if (!this.currentPrimaryTileset) {
        return null;
      }

      return {
        tileset:
          this.currentPrimaryTileset,
        localId:
          metatileId,
      };
    }

    if (!this.currentSecondaryTileset) {
      return null;
    }

    return {
      tileset:
        this.currentSecondaryTileset,
      localId:
        metatileId -
        this.getNumMetatilesInPrimary(),
    };
  }

  private readMapBlocks(
    mapDataAddress: number,
    width: number,
    height: number,
  ): MapBlockState[] {
    const cellCount =
      width * height;

    const bytes =
      this.memoryReader.readRange(
        mapDataAddress,
        cellCount * 2,
      );

    const blocks: MapBlockState[] =
      new Array(cellCount);

    for (
      let index = 0;
      index < cellCount;
      index++
    ) {
      const offset =
        index * 2;

      const raw =
        bytes[offset] |
        (
          bytes[offset + 1] <<
          8
        );

      blocks[index] = {
        raw,
        metatileId:
          raw &
          MAPGRID_METATILE_ID_MASK,
        collision:
          (
            raw &
            MAPGRID_COLLISION_MASK
          ) >>
          MAPGRID_COLLISION_SHIFT,
        elevation:
          (
            raw &
            MAPGRID_ELEVATION_MASK
          ) >>
          MAPGRID_ELEVATION_SHIFT,
      };
    }

    return blocks;
  }

  private logSampleTileGraphics(
    tileset: TilesetState,
    metatile: MetatileState | null,
  ): void {
    if (
      tileset.tilesAddress === 0 ||
      !metatile
    ) {
      return;
    }

    const tile =
      metatile.tiles.find(
        (entry) =>
          entry.tileId !== 0,
      );

    if (!tile) {
      return;
    }

    if (
      tile.tileId ===
      this.lastLoggedTileId
    ) {
      return;
    }

    const graphics =
      this.tileGraphicsDecoder.readTile(
        tileset.tilesAddress,
        tile.tileId,
        tileset.isCompressed,
      );

    if (!graphics) {
      return;
    }

    const paletteSource =
      this.resolvePaletteSource(
        tile.palette,
      );
    const palette =
      paletteSource
        ? this.readPalette(
            paletteSource.palettesAddress,
            paletteSource.paletteIndex,
          )
        : null;

    console.log(
      'Tile Graphics:',
      {
        tileId:
          graphics.tileId,

        address:
          `0x${
            (
              tileset.tilesAddress +
              graphics.tileId * 32
            ).toString(16)
          }`,

        width:
          graphics.width,

        height:
          graphics.height,

        paletteIndex:
          tile.palette,

        pixels:
          graphics.pixels,

        rows:
          this.formatTilePixels(
            graphics.pixels,
          ),

        palette,
      },
    );

    this.lastLoggedTileId =
      tile.tileId;
  }

  private resolvePaletteSource(
    paletteIndex: number,
  ): {
    palettesAddress: number;
    paletteIndex: number;
  } | null {
    if (
      paletteIndex < 0 ||
      paletteIndex >= NUM_PALS_TOTAL
    ) {
      return null;
    }

    const numPalsInPrimary =
      this.getNumPalsInPrimary();

    if (
      paletteIndex < numPalsInPrimary
    ) {
      if (
        !this.currentPrimaryTileset ||
        this.currentPrimaryTileset.palettesAddress === 0
      ) {
        return null;
      }

      return {
        palettesAddress:
          this.currentPrimaryTileset.palettesAddress,
        paletteIndex,
      };
    }

    if (
      !this.currentSecondaryTileset ||
      this.currentSecondaryTileset.palettesAddress === 0
    ) {
      return null;
    }

    return {
      palettesAddress:
        this.currentSecondaryTileset.palettesAddress,
      paletteIndex,
    };
  }

  private createMetatileGraphicsCacheKey(
    metatileId: number,
  ): string {
    return (
      String(
        this.currentPrimaryTileset?.address ??
        0,
      ) +
      ':' +
      String(
        this.currentSecondaryTileset?.address ??
        0,
      ) +
      ':' +
      String(metatileId)
    );
  }

  private readRomU16(
    address: number,
  ): number {
    if (
      !this.romDataView ||
      address < 0x08000000
    ) {
      return this.memoryReader.readU16(
        address,
      );
    }

    const offset =
      address -
      0x08000000;

    if (
      offset < 0 ||
      offset + 2 >
        this.romDataView.byteLength
    ) {
      return 0;
    }

    return this.romDataView.getUint16(
      offset,
      true,
    );
  }

  private readPalette(
    palettesAddress: number,
    paletteIndex: number,
  ): Array<{
    index: number;
    raw: number;
    r: number;
    g: number;
    b: number;
  }> | null {
    if (
      !this.isValidRomPointer(
        palettesAddress,
      ) ||
      paletteIndex < 0 ||
      paletteIndex >= NUM_PALS_TOTAL
    ) {
      return null;
    }

    const paletteAddress =
      palettesAddress +
      paletteIndex *
        GBA_PALETTE_COLORS *
        GBA_PALETTE_COLOR_BYTES;

    const colors = [];

    for (
      let i = 0;
      i < GBA_PALETTE_COLORS;
      i++
    ) {
      const raw =
        this.readRomU16(
          paletteAddress +
            i * GBA_PALETTE_COLOR_BYTES,
        );

      const r5 =
        raw & 0x1f;

      const g5 =
        (raw >> 5) & 0x1f;

      const b5 =
        (raw >> 10) & 0x1f;

      colors.push({
        index: i,
        raw,
        r: (r5 << 3) | (r5 >> 2),
        g: (g5 << 3) | (g5 >> 2),
        b: (b5 << 3) | (b5 >> 2),
      });
    }

    return colors;
  }

  private readMetatileRgba(
    metatile: MetatileState,
  ): {
    pixels: Uint8ClampedArray;
    basePixels: Uint8ClampedArray;
    foregroundPixels: Uint8ClampedArray;
  } | null {
    const basePixels =
      new Uint8ClampedArray(
        METATILE_SIZE *
          METATILE_SIZE *
          RGBA_CHANNEL_COUNT,
      );

    const foregroundPixels =
      new Uint8ClampedArray(
        basePixels.length,
      );

    if (
      metatile.tiles.length !==
      METATILE_TILE_COUNT
    ) {
      return null;
    }

    if (
      metatile.layerType ===
      METATILE_LAYER_TYPE_NORMAL
    ) {
      this.drawMetatileLayer(
        basePixels,
        Array.from(
          { length: 4 },
          () => ({
            raw:
              (
                NORMAL_METATILE_BACKGROUND_PALETTE <<
                TILE_PALETTE_SHIFT
              ) |
              NORMAL_METATILE_BACKGROUND_TILE_ID,
            tileId:
              NORMAL_METATILE_BACKGROUND_TILE_ID,
            hFlip: false,
            vFlip: false,
            palette:
              NORMAL_METATILE_BACKGROUND_PALETTE,
          }),
        ),
      );
    }

    this.drawMetatileLayer(
      basePixels,
      metatile.tiles.slice(0, 4),
    );

    const topTiles =
      metatile.tiles.slice(4, 8);

    if (
      metatile.layerType ===
      METATILE_LAYER_TYPE_COVERED
    ) {
      this.drawMetatileLayer(
        basePixels,
        topTiles,
      );
    } else if (
      metatile.layerType ===
        METATILE_LAYER_TYPE_NORMAL ||
      metatile.layerType ===
        METATILE_LAYER_TYPE_SPLIT
    ) {
      this.drawMetatileLayer(
        foregroundPixels,
        topTiles,
      );
    } else {
      return null;
    }

    const pixels =
      new Uint8ClampedArray(
        basePixels,
      );

    for (
      let i = 0;
      i < pixels.length;
      i += RGBA_CHANNEL_COUNT
    ) {
      if (foregroundPixels[i + 3] === 0) {
        continue;
      }

      pixels[i] = foregroundPixels[i];
      pixels[i + 1] = foregroundPixels[i + 1];
      pixels[i + 2] = foregroundPixels[i + 2];
      pixels[i + 3] = foregroundPixels[i + 3];
    }

    return {
      pixels,
      basePixels,
      foregroundPixels,
    };
  }

  private drawMetatileLayer(
    target: Uint8ClampedArray,
    tiles: MetatileTileState[],
  ): void {
    const positions = [
      { x: 0, y: 0 },
      { x: 8, y: 0 },
      { x: 0, y: 8 },
      { x: 8, y: 8 },
    ];

    for (
      let tileIndex = 0;
      tileIndex < 4;
      tileIndex++
    ) {
      const tile =
        tiles[tileIndex];

      if (!tile) {
        continue;
      }

      const source =
        this.resolveTileSource(
          tile.tileId,
        );

      if (!source) {
        continue;
      }

      const graphics =
        this.tileGraphicsDecoder.readTile(
          source.tileset.tilesAddress,
          source.localTileId,
          source.tileset.isCompressed,
        );

      if (!graphics) {
        continue;
      }

      const paletteSource =
        this.resolvePaletteSource(
          tile.palette,
        );

      if (!paletteSource) {
        continue;
      }

      const palette =
        this.readPalette(
          paletteSource.palettesAddress,
          paletteSource.paletteIndex,
        );

      if (!palette) {
        continue;
      }

      const position =
        positions[tileIndex];

      for (
        let sourceY = 0;
        sourceY < GBA_TILE_SIZE;
        sourceY++
      ) {
        for (
          let sourceX = 0;
          sourceX < GBA_TILE_SIZE;
          sourceX++
        ) {
          const pixelX =
            tile.hFlip
              ? GBA_TILE_SIZE -
                1 -
                sourceX
              : sourceX;

          const pixelY =
            tile.vFlip
              ? GBA_TILE_SIZE -
                1 -
                sourceY
              : sourceY;

          const palettePixelIndex =
            graphics.pixels[
              sourceY *
                GBA_TILE_SIZE +
                sourceX
            ];

          if (
            palettePixelIndex === 0
          ) {
            continue;
          }

          const color =
            palette[
              palettePixelIndex
            ];

          if (!color) {
            continue;
          }

          const x =
            position.x +
            pixelX;

          const y =
            position.y +
            pixelY;

          const offset =
            (
              y *
                METATILE_SIZE +
              x
            ) *
            RGBA_CHANNEL_COUNT;

          target[offset] =
            color.r;
          target[offset + 1] =
            color.g;
          target[offset + 2] =
            color.b;
          target[offset + 3] =
            255;
        }
      }
    }
  }

  private resolveTileSource(
    tileId: number,
  ): {
    tileset: TilesetState;
    localTileId: number;
  } | null {
    if (
      tileId < 0 ||
      tileId >= 1024
    ) {
      return null;
    }

    if (
      tileId < this.getNumTilesInPrimary()
    ) {
      if (
        !this.currentPrimaryTileset ||
        this.currentPrimaryTileset.tilesAddress === 0
      ) {
        return null;
      }

      return {
        tileset:
          this.currentPrimaryTileset,
        localTileId:
          tileId,
      };
    }

    if (
      !this.currentSecondaryTileset ||
      this.currentSecondaryTileset.tilesAddress === 0
    ) {
      return null;
    }

    return {
      tileset:
        this.currentSecondaryTileset,
      localTileId:
        tileId -
        this.getNumTilesInPrimary(),
    };
  }

  private getNumTilesInPrimary(): number {
    if (
      this.profile?.id === 'firered' ||
      this.profile?.id === 'leafgreen'
    ) {
      return FRLG_NUM_TILES_IN_PRIMARY;
    }

    return EMERALD_NUM_TILES_IN_PRIMARY;
  }

  private getNumMetatilesInPrimary(): number {
    if (
      this.profile?.id === 'firered' ||
      this.profile?.id === 'leafgreen'
    ) {
      return FRLG_NUM_METATILES_IN_PRIMARY;
    }

    return EMERALD_NUM_METATILES_IN_PRIMARY;
  }

  private getNumPalsInPrimary(): number {
    if (
      this.profile?.id === 'firered' ||
      this.profile?.id === 'leafgreen'
    ) {
      return FRLG_NUM_PALS_IN_PRIMARY;
    }

    return EMERALD_NUM_PALS_IN_PRIMARY;
  }

  private formatRgbaPixels(
    pixels: Uint8ClampedArray,
    width: number,
  ): number[][] {
    const rows: number[][] = [];

    for (
      let y = 0;
      y < width;
      y++
    ) {
      const row: number[] = [];

      for (
        let x = 0;
        x < width;
        x++
      ) {
        const offset =
          (
            y * width +
            x
          ) *
          RGBA_CHANNEL_COUNT;

        row.push(
          pixels[offset],
          pixels[offset + 1],
          pixels[offset + 2],
          pixels[offset + 3],
        );
      }

      rows.push(row);
    }

    return rows;
  }

  private formatTilePixels(
    pixels: Uint8Array,
  ): number[][] {
    const rows:
      number[][] = [];

    for (
      let y = 0;
      y < 8;
      y++
    ) {
      rows.push(
        Array.from(
          pixels.slice(
            y * 8,
            y * 8 + 8,
          ),
        ),
      );
    }

    return rows;
  }

  private readMapSample(
    mapDataAddress: number,
    width: number,
    height: number,
  ): MapBlockState[] {
    const sampleWidth =
      Math.min(
        width,
        8,
      );

    const sampleHeight =
      Math.min(
        height,
        4,
      );

    const sample:
      MapBlockState[] = [];

    for (
      let y = 0;
      y < sampleHeight;
      y++
    ) {
      for (
        let x = 0;
        x < sampleWidth;
        x++
      ) {
        const address =
          mapDataAddress +
          (
            (y * width + x) *
            2
          );

        const raw =
          this.memoryReader.readU16(
            address,
          );

        const metatileId =
          raw &
          MAPGRID_METATILE_ID_MASK;

        const collision =
          (
            raw &
            MAPGRID_COLLISION_MASK
          ) >>
          MAPGRID_COLLISION_SHIFT;

        const elevation =
          (
            raw &
            MAPGRID_ELEVATION_MASK
          ) >>
          MAPGRID_ELEVATION_SHIFT;

        sample.push({
          raw,
          metatileId,
          collision,
          elevation,
        });
      }
    }

    return sample;
  }

  private readTileset(
    tilesetAddress: number,
  ): TilesetState {
    if (
      !this.isValidRomPointer(
        tilesetAddress,
      )
    ) {
      return {
        address: 0,
        isCompressed: false,
        isSecondary: false,
        tilesAddress: 0,
        palettesAddress: 0,
        metatilesAddress: 0,
        metatileAttributesAddress: 0,
      };
    }

    const isCompressed =
      this.memoryReader.readU8(
        tilesetAddress +
          TILESET_IS_COMPRESSED_OFFSET,
      ) !== 0;

    const isSecondary =
      this.memoryReader.readU8(
        tilesetAddress +
          TILESET_IS_SECONDARY_OFFSET,
      ) !== 0;

    const tilesAddress =
      this.memoryReader.readU32(
        tilesetAddress +
          TILESET_TILES_OFFSET,
      );

    const palettesAddress =
      this.memoryReader.readU32(
        tilesetAddress +
          TILESET_PALETTES_OFFSET,
      );

    const metatilesAddress =
      this.memoryReader.readU32(
        tilesetAddress +
          TILESET_METATILES_OFFSET,
      );

    const metatileAttributesOffset =
      this.profile?.id === 'firered' ||
      this.profile?.id === 'leafgreen'
        ? FRLG_TILESET_METATILE_ATTRIBUTES_OFFSET
        : EMERALD_TILESET_METATILE_ATTRIBUTES_OFFSET;

    const metatileAttributesAddress =
      this.memoryReader.readU32(
        tilesetAddress +
          metatileAttributesOffset,
      );

    return {
      address:
        tilesetAddress,

      isCompressed,

      isSecondary,

      tilesAddress:
        this.isValidRomPointer(
          tilesAddress,
        )
          ? tilesAddress
          : 0,

      palettesAddress:
        this.isValidRomPointer(
          palettesAddress,
        )
          ? palettesAddress
          : 0,

      metatilesAddress:
        this.isValidRomPointer(
          metatilesAddress,
        )
          ? metatilesAddress
          : 0,

      metatileAttributesAddress:
        this.isValidRomPointer(
          metatileAttributesAddress,
        )
          ? metatileAttributesAddress
          : 0,
    };
  }

  private readMetatile(
    tileset: TilesetState,
    metatileId: number,
  ): MetatileState | null {
    if (
      tileset.metatilesAddress === 0 ||
      tileset.metatileAttributesAddress === 0
    ) {
      return null;
    }

    if (
      metatileId < 0 ||
      metatileId > 0x03ff
    ) {
      return null;
    }

    const metatileAddress =
      tileset.metatilesAddress +
      metatileId *
        METATILE_TILE_COUNT *
        2;

    const tiles:
      MetatileTileState[] = [];

    for (
      let i = 0;
      i < METATILE_TILE_COUNT;
      i++
    ) {
      const rawTile =
        this.memoryReader.readU16(
          metatileAddress +
            i * 2,
        );

      const tileId =
        rawTile &
        TILE_ID_MASK;

      const hFlip =
        (
          rawTile &
          TILE_HFLIP_MASK
        ) !== 0;

      const vFlip =
        (
          rawTile &
          TILE_VFLIP_MASK
        ) !== 0;

      const palette =
        (
          rawTile &
          TILE_PALETTE_MASK
        ) >>
        TILE_PALETTE_SHIFT;

      tiles.push({
        raw: rawTile,
        tileId,
        hFlip,
        vFlip,
        palette,
      });
    }

    let rawAttribute = 0;
    let behavior = 0;
    let layerType = 0;

    if (
      this.profile?.id ===
        'firered' ||
      this.profile?.id ===
        'leafgreen'
    ) {
      rawAttribute =
        this.memoryReader.readU32(
          tileset.metatileAttributesAddress +
            metatileId * 4,
        );

      behavior =
        rawAttribute &
        FRLG_METATILE_ATTRIBUTE_BEHAVIOR_MASK;

      layerType =
        (
          rawAttribute &
          FRLG_METATILE_ATTRIBUTE_LAYER_TYPE_MASK
        ) >>
        FRLG_METATILE_ATTRIBUTE_LAYER_TYPE_SHIFT;
    } else {
      rawAttribute =
        this.memoryReader.readU16(
          tileset.metatileAttributesAddress +
            metatileId * 2,
        );

      behavior =
        rawAttribute &
        EMERALD_METATILE_ATTRIBUTE_BEHAVIOR_MASK;

      layerType =
        (
          rawAttribute &
          EMERALD_METATILE_ATTRIBUTE_LAYER_TYPE_MASK
        ) >>
        EMERALD_METATILE_ATTRIBUTE_LAYER_TYPE_SHIFT;
    }

    return {
      id: metatileId,
      tiles,
      rawAttribute,
      behavior,
      layerType,
    };
  }

  private formatTileset(
    tileset: TilesetState,
  ) {
    return {
      address:
        `0x${tileset.address.toString(16)}`,

      isCompressed:
        tileset.isCompressed,

      isSecondary:
        tileset.isSecondary,

      tilesAddress:
        `0x${tileset.tilesAddress.toString(16)}`,

      palettesAddress:
        `0x${tileset.palettesAddress.toString(16)}`,

      metatilesAddress:
        `0x${tileset.metatilesAddress.toString(16)}`,

      metatileAttributesAddress:
        `0x${tileset.metatileAttributesAddress.toString(16)}`,
    };
  }

  private findMapHeaderAddress(
    mapLayoutId: number,
  ): number {
    for (
      let address = EWRAM_START;
      address <=
        EWRAM_END - 0x20;
      address += 2
    ) {
      const candidateLayoutId =
        this.memoryReader.readU16(
          address +
            MAP_HEADER_MAP_LAYOUT_ID_OFFSET,
        );

      if (
        candidateLayoutId !==
        mapLayoutId
      ) {
        continue;
      }

      const mapLayoutAddress =
        this.memoryReader.readU32(
          address +
            MAP_HEADER_MAP_LAYOUT_OFFSET,
        );

      if (
        !this.isValidRomPointer(
          mapLayoutAddress,
        )
      ) {
        continue;
      }

      const width =
        this.memoryReader.readU32(
          mapLayoutAddress +
            MAP_LAYOUT_WIDTH_OFFSET,
        );

      const height =
        this.memoryReader.readU32(
          mapLayoutAddress +
            MAP_LAYOUT_HEIGHT_OFFSET,
        );

      if (
        !this.isValidMapDimension(
          width,
        ) ||
        !this.isValidMapDimension(
          height,
        )
      ) {
        continue;
      }

      const mapData =
        this.memoryReader.readU32(
          mapLayoutAddress +
            MAP_LAYOUT_MAP_OFFSET,
        );

      const primaryTileset =
        this.memoryReader.readU32(
          mapLayoutAddress +
            MAP_LAYOUT_PRIMARY_TILESET_OFFSET,
        );

      const secondaryTileset =
        this.memoryReader.readU32(
          mapLayoutAddress +
            MAP_LAYOUT_SECONDARY_TILESET_OFFSET,
        );

      if (
        !this.isValidRomPointer(
          mapData,
        ) ||
        !this.isValidRomPointer(
          primaryTileset,
        ) ||
        !this.isValidRomPointer(
          secondaryTileset,
        )
      ) {
        continue;
      }

      return address;
    }

    return 0;
  }

  private findMapLayoutAddress(
    mapLayoutId: number,
  ): number {
    const dataView = this.romDataView;
    const romBytes = this.romBytes;

    if (
      !dataView ||
      !romBytes ||
      mapLayoutId <= 0
    ) {
      return 0;
    }

    if (!this.mapLayoutsTableSearchCompleted) {
      const table =
        this.findMapLayoutsTable();

      this.mapLayoutsTableOffset =
        table?.offset ?? -1;

      this.mapLayoutsTableLength =
        table?.length ?? 0;

      this.mapLayoutsTableSearchCompleted =
        true;
    }

    if (
      this.mapLayoutsTableOffset < 0 ||
      mapLayoutId > this.mapLayoutsTableLength
    ) {
      return 0;
    }

    const entryOffset =
      this.mapLayoutsTableOffset +
      (mapLayoutId - 1) * 4;

    if (entryOffset + 4 > romBytes.length) {
      return 0;
    }

    const mapLayoutAddress =
      dataView.getUint32(
        entryOffset,
        true,
      );

    return this.isRomMapLayoutPointer(
      mapLayoutAddress,
    )
      ? mapLayoutAddress
      : 0;
  }

  private findMapLayoutsTable():
    { offset: number; length: number } | null {
    const dataView = this.romDataView;
    const romBytes = this.romBytes;

    if (!dataView || !romBytes) {
      return null;
    }

    let runStart = -1;
    let runLength = 0;
    let bestRunStart = -1;
    let bestRunLength = 0;

    for (
      let offset = 0;
      offset + 4 <= romBytes.length;
      offset += 4
    ) {
      const mapLayoutAddress =
        dataView.getUint32(
          offset,
          true,
        );

      if (
        this.isRomMapLayoutPointer(
          mapLayoutAddress,
        )
      ) {
        if (runLength === 0) {
          runStart = offset;
        }

        runLength++;
        continue;
      }

      if (
        runLength > bestRunLength
      ) {
        bestRunStart = runStart;
        bestRunLength = runLength;
      }

      runStart = -1;
      runLength = 0;
    }

    if (
      runLength > bestRunLength
    ) {
      bestRunStart = runStart;
      bestRunLength = runLength;
    }

    return bestRunStart < 0
      ? null
      : {
          offset: bestRunStart,
          length: bestRunLength,
        };
  }

  private isRomMapLayoutPointer(
    address: number,
  ): boolean {
    const dataView = this.romDataView;
    const romBytes = this.romBytes;

    if (
      !dataView ||
      !romBytes ||
      !this.isValidRomPointer(address)
    ) {
      return false;
    }

    const layoutOffset =
      address - GBA_ROM_BASE;

    if (
      layoutOffset < 0 ||
      layoutOffset + 24 > romBytes.length
    ) {
      return false;
    }

    const width =
      dataView.getUint32(
        layoutOffset +
          MAP_LAYOUT_WIDTH_OFFSET,
        true,
      );

    const height =
      dataView.getUint32(
        layoutOffset +
          MAP_LAYOUT_HEIGHT_OFFSET,
        true,
      );

    if (
      !this.isValidMapDimension(width) ||
      !this.isValidMapDimension(height)
    ) {
      return false;
    }

    for (const fieldOffset of [
      MAP_LAYOUT_BORDER_OFFSET,
      MAP_LAYOUT_MAP_OFFSET,
      MAP_LAYOUT_PRIMARY_TILESET_OFFSET,
      MAP_LAYOUT_SECONDARY_TILESET_OFFSET,
    ]) {
      const pointer =
        dataView.getUint32(
          layoutOffset + fieldOffset,
          true,
        );

      if (
        pointer < GBA_ROM_BASE ||
        pointer >=
          GBA_ROM_BASE +
            romBytes.length
      ) {
        return false;
      }
    }

    return true;
  }

  private isValidMapDimension(
    value: number,
  ): boolean {
    return (
      value > 0 &&
      value <= 512
    );
  }

  private isValidRomPointer(
    address: number,
  ): boolean {
    return (
      address >= 0x08000000 &&
      address < 0x0a000000
    );
  }

  private readPlayerPositionFromSaveBlock(
    state: GameState,
    saveBlock1Address: number,
  ): void {
    if (
      !this.isValidEwramPointer(
        saveBlock1Address,
      )
    ) {
      return;
    }

    const positionAddress =
      saveBlock1Address +
      this.profile!.memory
        .playerPositionOffset;

    state.player.x =
      this.readMapCoordinate(
        positionAddress,
      );

    state.player.y =
      this.readMapCoordinate(
        positionAddress + 2,
      );
  }

  private readPlayerObjectState(
    state: GameState,
    layout: Gen3ObjectStateLayout,
  ): void {
    const playerAvatarAddress =
      layout.playerAvatarAddress;

    const objectEventId =
      this.memoryReader.readU8(
        playerAvatarAddress +
          layout.playerAvatarObjectEventIdOffset,
      );

    if (
      objectEventId >= 16
    ) {
      return;
    }

    const objectEventAddress =
      layout.objectEventsAddress +
      objectEventId *
        layout.objectEventSize;

    const currentCoordsAddress =
      objectEventAddress +
      layout.objectEventCurrentCoordsOffset;

    state.player.x =
      this.readMapCoordinate(
        currentCoordsAddress,
      );

    state.player.y =
      this.readMapCoordinate(
        currentCoordsAddress + 2,
      );

    const facingAndMovement =
      this.memoryReader.readU8(
        objectEventAddress +
          layout.objectEventFacingDirectionOffset,
      );

    const facingDirection =
      facingAndMovement &
      0x0f;

    const movementDirection =
      (
        facingAndMovement >>
        4
      ) &
      0x0f;

    state.player.direction =
      this.decodeDirection(
        facingDirection,
        movementDirection,
      );

    const runningState =
      this.memoryReader.readU8(
        playerAvatarAddress +
          layout.playerAvatarRunningStateOffset,
      );

    state.player.movementState =
      this.decodeMovementState(
        runningState,
      );
  }

  private decodeDirection(
    facingDirection: number,
    movementDirection: number,
  ): Direction {
    return (
      this.directionFromGen3Value(
        facingDirection,
      ) ??
      this.directionFromGen3Value(
        movementDirection,
      ) ??
      this.previous.player.direction
    );
  }

  private directionFromGen3Value(
    value: number,
  ): Direction | null {
    switch (value) {
      case DIR_SOUTH:
        return 'DOWN';

      case DIR_NORTH:
        return 'UP';

      case DIR_WEST:
        return 'LEFT';

      case DIR_EAST:
        return 'RIGHT';

      default:
        return null;
    }
  }

  private decodeMovementState(
    runningState: number,
  ): MovementState {
    switch (runningState) {
      case PLAYER_AVATAR_STATE_MOVING:
        return 'walking';

      case PLAYER_AVATAR_STATE_TURN_DIRECTION:
        return 'turning';

      case PLAYER_AVATAR_STATE_NOT_MOVING:
      default:
        return 'idle';
    }
  }

  private readDirectionFromPosition(
    nextX: number,
    nextY: number,
  ): Direction {
    const dx =
      nextX -
      this.previous.player.x;

    const dy =
      nextY -
      this.previous.player.y;

    if (
      Math.abs(dx) >
      Math.abs(dy)
    ) {
      return dx >= 0
        ? 'RIGHT'
        : 'LEFT';
    }

    if (dy !== 0) {
      return dy >= 0
        ? 'DOWN'
        : 'UP';
    }

    return this.previous.player.direction;
  }

  private readMovementStateFromPosition(
    x: number,
    y: number,
  ): MovementState {
    if (
      x !== this.previous.player.x ||
      y !== this.previous.player.y
    ) {
      return 'walking';
    }

    return 'idle';
  }

  private detectProfile():
    Gen3GameProfile | null {
    const gameCodeBytes =
      this.memoryReader.readRange(
        GBA_ROM_HEADER_GAME_CODE,
        4,
      );

    const gameCode =
      new TextDecoder().decode(
        gameCodeBytes,
      );

    const revision =
      this.memoryReader.readU8(
        GBA_ROM_HEADER_REVISION,
      );

    return detectGen3Game(
      gameCode,
      revision,
    );
  }

  private resolveSaveBlock1Address(): number {
    const memory =
      this.profile?.memory;

    if (!memory) {
      return 0;
    }

    if (
      memory.saveBlock1AddressMode ===
      'FIXED'
    ) {
      return (
        memory.saveBlock1FixedAddress ??
        0
      );
    }

    if (
      memory.saveBlock1AddressMode ===
      'POINTER'
    ) {
      const pointerAddress =
        memory.saveBlock1PointerAddress;

      if (
        pointerAddress ===
        undefined
      ) {
        return 0;
      }

      return this.memoryReader.readU32(
        pointerAddress,
      );
    }

    return 0;
  }

  private readSigned16(
    address: number,
  ): number {
    const value =
      this.memoryReader.readU16(
        address,
      );

    return value & 0x8000
      ? value - 0x10000
      : value;
  }

  private readMapCoordinate(
    address: number,
  ): number {
    return (
      this.readSigned16(address) -
      MAP_GRID_BORDER_OFFSET
    );
  }

  private isValidEwramPointer(
    address: number,
  ): boolean {
    return (
      address >= EWRAM_START &&
      address < EWRAM_END
    );
  }
}