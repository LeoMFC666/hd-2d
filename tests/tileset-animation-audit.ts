import * as THREE from 'three';
import { MapCatalog } from '../src/gen3/world/MapCatalog';
import { MapWorld } from '../src/gen3/world/MapWorld';
import { Gen3StateAdapter } from '../src/gen3/Gen3StateAdapter';
import type { MemoryReader } from '../src/gen3/MemoryReader';
import type { GameState } from '../src/gen3/GameState';
import { TilesetAnimationController } from '../src/gen3/TilesetAnimationController';

const BASE = 0x08000000;
const VRAM = 0x06000000;
const TILE_BYTES = 32;
const ANIM_START = 416;
const ANIM_COUNT = 96;

class TestMemoryReader implements MemoryReader {
  private readonly vram = new Uint8Array(0x18000);

  constructor(private readonly rom: Uint8Array) {}

  setAnimatedTile(tileId: number, value: number): void {
    const offset = tileId * TILE_BYTES;
    this.vram.fill(value & 0xff, offset, offset + TILE_BYTES);
  }

  readU8(address: number): number {
    if (address >= VRAM && address < VRAM + this.vram.length) {
      return this.vram[address - VRAM];
    }

    const offset = address - BASE;
    return offset >= 0 && offset < this.rom.length
      ? this.rom[offset]
      : 0;
  }

  readU16(address: number): number {
    return this.readU8(address) | (this.readU8(address + 1) << 8);
  }

  readU32(address: number): number {
    return (
      (
        this.readU8(address) |
        (this.readU8(address + 1) << 8) |
        (this.readU8(address + 2) << 16) |
        (this.readU8(address + 3) * 0x1000000)
      ) >>> 0
    );
  }

  readRange(address: number, length: number): Uint8Array {
    const result = new Uint8Array(length);

    if (address >= VRAM && address + length <= VRAM + this.vram.length) {
      result.set(
        this.vram.subarray(
          address - VRAM,
          address - VRAM + length,
        ),
      );
      return result;
    }

    for (let i = 0; i < length; i++) {
      result[i] = this.readU8(address + i);
    }

    return result;
  }
}

function u8(rom: Uint8Array, offset: number): number {
  return offset >= 0 && offset < rom.length ? rom[offset] : 0;
}

function u16(rom: Uint8Array, offset: number): number {
  return u8(rom, offset) | (u8(rom, offset + 1) << 8);
}

function u32(rom: Uint8Array, offset: number): number {
  return (
    (
      u8(rom, offset) |
      (u8(rom, offset + 1) << 8) |
      (u8(rom, offset + 2) << 16) |
      (u8(rom, offset + 3) * 0x1000000)
    ) >>> 0
  );
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function findPalletAnchor(rom: Uint8Array): {
  mapLayoutAddress: number;
  mapLayoutId: number;
} {
  for (let offset = 0; offset <= rom.length - 0x1c; offset += 4) {
    const layoutAddress = u32(rom, offset);
    const layoutOffset = layoutAddress - BASE;
    if (layoutOffset < 0 || layoutOffset + 0x18 > rom.length) continue;

    const width = u32(rom, layoutOffset);
    const height = u32(rom, layoutOffset + 4);
    if (width !== 24 || height !== 20) continue;

    const dataAddress = u32(rom, layoutOffset + 0x0c);
    const primary = u32(rom, layoutOffset + 0x10);
    const secondary = u32(rom, layoutOffset + 0x14);
    if (
      dataAddress < BASE ||
      primary < BASE ||
      secondary < BASE
    ) continue;

    const connectionsAddress = u32(rom, offset + 0x0c);
    const connectionsOffset = connectionsAddress - BASE;
    if (
      connectionsOffset < 0 ||
      connectionsOffset + 8 > rom.length
    ) continue;

    const count = u32(rom, connectionsOffset) | 0;
    if (count < 2 || count > 64) continue;

    const data = u32(rom, connectionsOffset + 4) - BASE;
    if (data < 0 || data + count * 0x0c > rom.length) continue;

    let route1 = false;
    let route21South = false;

    for (let i = 0; i < count; i++) {
      const entry = data + i * 0x0c;
      const direction = u8(rom, entry);
      const offsetValue = (
        u32(rom, entry + 4) |
        0
      );
      const group = u8(rom, entry + 8);
      const number = u8(rom, entry + 9);

      if (
        direction === 2 &&
        offsetValue === 0 &&
        group === 3 &&
        number === 19
      ) {
        route1 = true;
      }

      if (
        direction === 1 &&
        offsetValue === 0 &&
        group === 3 &&
        number === 39
      ) {
        route21South = true;
      }
    }

    if (route1 && route21South) {
      return {
        mapLayoutAddress: layoutAddress,
        mapLayoutId: u16(rom, offset + 0x12),
      };
    }
  }

  throw new Error('Pallet anchor not found');
}

async function main(): Promise<void> {
  const rom = new Uint8Array(
    await (
      await fetch('/Pokemon - FireRed Version (USA, Europe) (Rev 1).gba')
    ).arrayBuffer(),
  );

  assert(
    String.fromCharCode(
      rom[0xac],
      rom[0xad],
      rom[0xae],
      rom[0xaf],
    ) === 'BPRE',
    'Wrong game code',
  );
  assert(rom[0xbc] === 1, 'Wrong revision');

  const anchor = findPalletAnchor(rom);
  const catalog = new MapCatalog();

  const catalogCount = catalog.buildGen3FromRom(
    rom,
    {
      mapGroup: 3,
      mapNumber: 0,
      ...anchor,
    },
  );

  assert(catalogCount === 425, 'Catalog count: ' + catalogCount);

  const world = new MapWorld(catalog);
  assert(world.buildFrom(3, 0) === 37, 'Connected world count is not 37');

  const reader = new TestMemoryReader(rom);
  const controller = new TilesetAnimationController(
    rom,
    reader,
  );

  let selectedMap: ReturnType<MapCatalog['get']> = null;
  let placements: Map<number, any> = new Map();

  for (const map of world.getPositionedMaps()) {
    const candidate = controller.createPlacements(
      map,
      buildBlocks(rom, map),
    );

    if (candidate.size > 0) {
      selectedMap = map;
      placements = candidate;
      break;
    }
  }

  assert(selectedMap, 'No connected FireRed map uses primary animated tiles');

  const map = selectedMap;
  const width = map.width * 16;
  const height = map.height * 16;

  const baseData = new Uint8Array(width * height * 4);
  const overlayData = new Uint8Array(width * height * 4);
  const baseTexture = new THREE.DataTexture(
    baseData,
    width,
    height,
    THREE.RGBAFormat,
    THREE.UnsignedByteType,
  );
  const overlayTexture = new THREE.DataTexture(
    overlayData,
    width,
    height,
    THREE.RGBAFormat,
    THREE.UnsignedByteType,
  );

  const tileId = Array.from(placements.keys())[0];
  const tilePlacements = placements.get(tileId)!;
  assert(tilePlacements.length > 0, 'No placement for selected animated tile');

  controller.attachMap(
    'selected',
    map,
    baseTexture,
    overlayTexture,
    placements,
  );

  for (let i = 0; i < 4; i++) {
    controller.update(map.primaryTilesetAddress);
  }

  const before = new Uint8Array(baseData);

  // Fill one candidate animated tile in the emulator's VRAM with a solid
  // palette-index-1 tile. The controller must propagate that live VRAM frame
  // only to maps using this same primary tileset.
  for (let x = 0; x < 8; x++) {
    for (let y = 0; y < 8; y++) {
      const byteOffset =
        tileId * TILE_BYTES +
        y * 4 +
        Math.floor(x / 2);
      if (x % 2 === 0) {
        reader.setAnimatedTile(tileId, 0x11);
        break;
      }
    }
  }

  for (let i = 0; i < 4; i++) {
    controller.update(map.primaryTilesetAddress);
  }

  const changedPixels = countChangedRgba(
    before,
    baseData,
  );

  assert(
    changedPixels > 0,
    'VRAM animation frame did not change the map texture',
  );

  const opaquePixels = countOpaquePixels(
    baseData,
  );

  assert(
    opaquePixels >= tilePlacements.length * 64,
    'Animated tile placements were not fully patched',
  );

  // Integration test: actual PlayerRenderer path with the real ROM-backed
  // render-data decoder and the same live-memory reader.
  const realAdapter = new Gen3StateAdapter(reader, rom);
  const state = makeState(map);
  const fakeAdapter = {
    readState: () => state,
    getMapRenderData:
      realAdapter.getMapRenderData.bind(realAdapter),
    getMemoryReader: () => reader,
  } as unknown as Gen3StateAdapter;

  const container = document.createElement('div');
  container.style.width = '1200px';
  container.style.height = '800px';
  document.body.appendChild(container);

  const { PlayerRenderer } = await import('../src/render/PlayerRenderer');
  const renderer = new PlayerRenderer(
    container,
    fakeAdapter,
    rom,
  );

  for (let i = 0; i < 60; i++) {
    await new Promise(requestAnimationFrame);
  }

  const internals = renderer as any;
  const visual = internals.mapVisuals.get(
    map.mapGroup + ':' + map.mapNumber,
  );

  assert(visual, 'PlayerRenderer did not build the selected map visual');

  const rendererController =
    internals.tilesetAnimationController as TilesetAnimationController;

  reader.setAnimatedTile(tileId, 0x11);

  for (let i = 0; i < 8; i++) {
    rendererController.update(map.primaryTilesetAddress);
  }

  renderer.destroy();

  const result = {
    pass: true,
    catalogCount,
    connectedCount: 37,
    selectedMap: {
      key: map.mapGroup + ':' + map.mapNumber,
      width: map.width,
      height: map.height,
      animatedTileCount: placements.size,
      selectedTile: tileId,
      placements: tilePlacements.length,
    },
    controllerChangedPixels: changedPixels,
    controllerOpaquePixels: opaquePixels,
    playerRendererVisualBuilt: true,
    candidateRange: [ANIM_START, ANIM_START + ANIM_COUNT - 1],
    vramAddress: '0x0600' + (ANIM_START * TILE_BYTES).toString(16).padStart(5, '0'),
  };

  document.body.dataset.pass = 'true';
  document.querySelector('#out')!.textContent =
    JSON.stringify(result, null, 2);
}

function buildBlocks(
  rom: Uint8Array,
  map: NonNullable<ReturnType<MapCatalog['get']>>,
): Array<{ raw: number; metatileId: number; collision: number; elevation: number }> {
  const blocks: Array<{ raw: number; metatileId: number; collision: number; elevation: number }> =
    new Array(map.width * map.height);

  const dataOffset = map.mapDataAddress - BASE;

  for (let i = 0; i < blocks.length; i++) {
    const raw = u16(rom, dataOffset + i * 2);
    blocks[i] = {
      raw,
      metatileId: raw & 0x03ff,
      collision: (raw >> 10) & 3,
      elevation: (raw >> 12) & 0x0f,
    };
  }

  return blocks;
}

function makeState(
  map: NonNullable<ReturnType<MapCatalog['get']>>,
): GameState {
  return {
    game: {
      game: 'GEN 3',
      version: 'Pokémon FireRed',
      region: 'firered',
      revision: '1',
    },
    player: {
      x: Math.floor(map.width / 2),
      y: Math.floor(map.height / 2),
      z: 0,
      direction: 'DOWN',
      movementState: 'idle',
    },
    map: {
      mapGroup: map.mapGroup,
      mapNumber: map.mapNumber,
      mapLayoutId: map.mapLayoutId,
      mapHeaderAddress: map.mapHeaderAddress,
      mapLayoutAddress: map.mapLayoutAddress,
      mapDataAddress: map.mapDataAddress,
      primaryTilesetAddress: map.primaryTilesetAddress,
      secondaryTilesetAddress: map.secondaryTilesetAddress,
      width: map.width,
      height: map.height,
      cellCount: map.width * map.height,
      blockSample: [],
      primaryTileset: {
        address: map.primaryTilesetAddress,
        isCompressed: true,
        isSecondary: false,
        tilesAddress: 0,
        palettesAddress: 0,
        metatilesAddress: 0,
        metatileAttributesAddress: 0,
      },
      secondaryTileset: {
        address: map.secondaryTilesetAddress,
        isCompressed: true,
        isSecondary: true,
        tilesAddress: 0,
        palettesAddress: 0,
        metatilesAddress: 0,
        metatileAttributesAddress: 0,
      },
      primaryMetatileSample: null,
      secondaryMetatileSample: null,
    },
    objects: [],
    camera: {
      x: 0,
      y: 0,
      z: 0,
      yaw: 0,
      pitch: 0,
    },
  };
}

function countChangedRgba(
  before: Uint8Array,
  after: Uint8Array,
): number {
  let count = 0;
  for (let i = 0; i < before.length; i += 4) {
    if (
      before[i] !== after[i] ||
      before[i + 1] !== after[i + 1] ||
      before[i + 2] !== after[i + 2] ||
      before[i + 3] !== after[i + 3]
    ) {
      count++;
    }
  }
  return count;
}

function countOpaquePixels(
  data: Uint8Array,
): number {
  let count = 0;
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] !== 0) count++;
  }
  return count;
}

main().catch(error => {
  document.body.dataset.pass = 'false';
  document.querySelector('#out')!.textContent =
    JSON.stringify(
      {
        pass: false,
        error: error instanceof Error ? error.message : String(error),
      },
      null,
      2,
    );
  throw error;
});
