import * as THREE from 'three';
import { Gen3StateAdapter } from '../src/gen3/Gen3StateAdapter';
import type { MemoryReader } from '../src/gen3/MemoryReader';
import { MapCatalog } from '../src/gen3/world/MapCatalog';
import { MapWorld } from '../src/gen3/world/MapWorld';
import { PlayerRenderer } from '../src/render/PlayerRenderer';
import type { GameState } from '../src/gen3/GameState';

const BASE = 0x08000000;
const HEADER_SIZE = 0x1c;
const MT_PIXELS = 16;

class RomMemoryReader implements MemoryReader {
  constructor(private readonly rom: Uint8Array) {}
  readU8(address: number): number {
    const o = address - BASE;
    return o >= 0 && o < this.rom.length ? this.rom[o] : 0;
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
    for (let i = 0; i < length; i++) result[i] = this.readU8(address + i);
    return result;
  }
}

function fnv1a(bytes: Uint8Array): number {
  let hash = 2166136261;
  for (const byte of bytes) {
    hash ^= byte;
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function assembleBaseTexture(
  data: NonNullable<ReturnType<Gen3StateAdapter['getMapRenderData']>>,
  width: number,
  height: number,
): Uint8ClampedArray {
  const textureWidth = width * MT_PIXELS;
  const pixels = new Uint8ClampedArray(textureWidth * height * MT_PIXELS * 4);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const block = data.blocks[y * width + x];
      if (!block) continue;

      const graphics = data.graphics.get(block.metatileId);
      if (!graphics) continue;

      for (let sourceY = 0; sourceY < MT_PIXELS; sourceY++) {
        const destinationY =
          (height - 1 - y) * MT_PIXELS +
          MT_PIXELS -
          1 -
          sourceY;

        for (let sourceX = 0; sourceX < MT_PIXELS; sourceX++) {
          const sourceOffset = (sourceY * MT_PIXELS + sourceX) * 4;
          const destinationOffset =
            (destinationY * textureWidth + x * MT_PIXELS + sourceX) * 4;

          pixels[destinationOffset] = graphics.basePixels[sourceOffset];
          pixels[destinationOffset + 1] = graphics.basePixels[sourceOffset + 1];
          pixels[destinationOffset + 2] = graphics.basePixels[sourceOffset + 2];
          pixels[destinationOffset + 3] = graphics.basePixels[sourceOffset + 3];
        }
      }
    }
  }

  return pixels;
}

function makeCinnabarState(
  catalog: MapCatalog,
): GameState {
  const map = catalog.get(3, 8);
  if (!map) throw new Error('Catalog has no Cinnabar map');

  return {
    game: {
      game: 'GEN 3',
      version: 'Pokémon FireRed',
      region: 'firered',
      revision: '1',
    },
    player: {
      x: 12,
      y: 10,
      z: 0,
      direction: 'DOWN',
      movementState: 'idle',
    },
    map: {
      mapGroup: 3,
      mapNumber: 8,
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
        isCompressed: false,
        isSecondary: false,
        tilesAddress: 0,
        palettesAddress: 0,
        metatilesAddress: 0,
        metatileAttributesAddress: 0,
      },
      secondaryTileset: {
        address: map.secondaryTilesetAddress,
        isCompressed: false,
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
      x: 0, y: 0, z: 0, yaw: 0, pitch: 0,
    },
  };
}

async function main(): Promise<void> {
  const rom = new Uint8Array(
    await (await fetch('/Pokemon - FireRed Version (USA, Europe) (Rev 1).gba')).arrayBuffer(),
  );

  if (
    String.fromCharCode(rom[0xac], rom[0xad], rom[0xae], rom[0xaf]) !== 'BPRE' ||
    rom[0xbc] !== 1
  ) {
    throw new Error('Unexpected FireRed ROM header');
  }

  const reader = new RomMemoryReader(rom);
  const adapter = new Gen3StateAdapter(reader, rom);

  const catalog = new MapCatalog();
  const anchor = {
    mapGroup: 3,
    mapNumber: 8,
    mapLayoutId: 0,
    mapLayoutAddress: 0,
  };

  // Obtain the active Cinnabar layout from an independent local scan using
  // the exact known dimensions and connection signatures.
  for (let offset = 0; offset <= rom.length - HEADER_SIZE; offset += 4) {
    const layoutAddress = reader.readU32(BASE + offset);
    if (layoutAddress < BASE) continue;

    const lo = layoutAddress - BASE;
    if (lo < 0 || lo + 0x18 > rom.length) continue;

    const width = reader.readU32(layoutAddress);
    const height = reader.readU32(layoutAddress + 4);
    if (width !== 24 || height !== 20) continue;

    const mapData = reader.readU32(layoutAddress + 0x0c);
    const primary = reader.readU32(layoutAddress + 0x10);
    const secondary = reader.readU32(layoutAddress + 0x14);
    if (
      mapData < BASE ||
      primary < BASE ||
      secondary < BASE
    ) continue;

    const headerAddress = BASE + offset;
    const connectionsPtr = reader.readU32(
      headerAddress + 0x0c,
    );

    if (connectionsPtr < BASE) {
      continue;
    }

    const connectionsOffset = connectionsPtr - BASE;
    if (connectionsOffset < 0 || connectionsOffset + 8 > rom.length) {
      continue;
    }

    const connectionCount = reader.readU32(connectionsPtr) | 0;
    if (connectionCount < 0 || connectionCount > 64) {
      continue;
    }

    const required = [
      { direction: 2, mapGroup: 3, mapNumber: 40, offset: 0 },
      { direction: 4, mapGroup: 3, mapNumber: 38, offset: 0 },
    ];

    let matched = 0;
    if (connectionCount > 0) {
      const dataAddress = reader.readU32(connectionsPtr + 4);
      const dataOffset = dataAddress - BASE;
      if (
        dataAddress < BASE ||
        dataOffset < 0 ||
        dataOffset + connectionCount * 0x0c > rom.length
      ) {
        continue;
      }

      for (let index = 0; index < connectionCount; index++) {
        const entry = dataOffset + index * 0x0c;
        const direction = reader.readU8(BASE + entry);
        const offsetValue = reader.readU32(BASE + entry + 4) | 0;
        const mapGroup = reader.readU8(BASE + entry + 8);
        const mapNumber = reader.readU8(BASE + entry + 9);

        if (
          required.some(
            c =>
              c.direction === direction &&
              c.mapGroup === mapGroup &&
              c.mapNumber === mapNumber &&
              c.offset === offsetValue,
          )
        ) {
          matched++;
        }
      }
    }

    if (matched !== required.length) {
      continue;
    }

    const mapLayoutId = reader.readU16(headerAddress + 0x12);
    anchor.mapLayoutAddress = layoutAddress;
    anchor.mapLayoutId = mapLayoutId;
    break;
  }

  if (anchor.mapLayoutAddress === 0) {
    throw new Error('Could not find a 24x20 Cinnabar layout anchor');
  }

  const catalogCount = catalog.buildGen3FromRom(rom, anchor);
  if (catalogCount !== 425) {
    throw new Error('Catalog count expected 425, got ' + catalogCount);
  }

  const pallet = catalog.get(3, 0);
  const route1 = catalog.get(3, 19);
  const viridian = catalog.get(3, 1);
  const cinnabar = catalog.get(3, 8);
  const ruin = catalog.get(3, 61);
  if (!pallet || !route1 || !viridian || !cinnabar || !ruin) {
    throw new Error('Required catalog maps are missing');
  }

  const world = new MapWorld(catalog);
  const connected = world.buildFrom(3, 0);

  if (connected !== 37) {
    throw new Error('Connected world expected 37 maps, got ' + connected);
  }

  if (
    !world.hasPosition(3, 0) ||
    !world.hasPosition(3, 19) ||
    !world.hasPosition(3, 1) ||
    !world.hasPosition(3, 8) ||
    world.hasPosition(3, 61)
  ) {
    throw new Error('World positioning regression detected');
  }

  // Render Cinnabar, then a different map, then Cinnabar again.
  // The hashes must remain identical: this detects cross-map adapter/cache
  // contamination.
  const firstCinnabar = adapter.getMapRenderData(
    cinnabar.mapDataAddress,
    cinnabar.width,
    cinnabar.height,
    cinnabar.primaryTilesetAddress,
    cinnabar.secondaryTilesetAddress,
  );
  if (!firstCinnabar) throw new Error('First Cinnabar render data is null');

  const firstPixels = assembleBaseTexture(
    firstCinnabar,
    cinnabar.width,
    cinnabar.height,
  );
  const firstHash = fnv1a(new Uint8Array(firstPixels.buffer));

  const ruinRender = adapter.getMapRenderData(
    ruin.mapDataAddress,
    ruin.width,
    ruin.height,
    ruin.primaryTilesetAddress,
    ruin.secondaryTilesetAddress,
  );
  if (!ruinRender) throw new Error('Ruin render data is null');

  const secondCinnabar = adapter.getMapRenderData(
    cinnabar.mapDataAddress,
    cinnabar.width,
    cinnabar.height,
    cinnabar.primaryTilesetAddress,
    cinnabar.secondaryTilesetAddress,
  );
  if (!secondCinnabar) throw new Error('Second Cinnabar render data is null');

  const secondPixels = assembleBaseTexture(
    secondCinnabar,
    cinnabar.width,
    cinnabar.height,
  );
  const secondHash = fnv1a(new Uint8Array(secondPixels.buffer));

  if (firstHash !== secondHash) {
    throw new Error(
      'Cinnabar render is not stable across another-map render: ' +
      firstHash + ' vs ' + secondHash,
    );
  }

  // Instantiate the actual PlayerRenderer with the real adapter's static
  // renderer and a synthetic FireRed state. This exercises the final
  // MapCatalog -> MapWorld -> queue -> texture -> THREE.DataTexture path.
  const state = makeCinnabarState(catalog);
  const fakeAdapter = {
    readState: () => state,
    getMapRenderData: adapter.getMapRenderData.bind(adapter),
  } as unknown as Gen3StateAdapter;

  const container = document.querySelector('#sceneContainer') as HTMLElement;
  const playerRenderer = new PlayerRenderer(container, fakeAdapter, rom);

  await new Promise(requestAnimationFrame);
  for (let i = 0; i < 100; i++) {
    await new Promise(requestAnimationFrame);
  }

  const internal = playerRenderer as unknown as {
    mapVisuals: Map<string, {
      baseTexture: THREE.DataTexture;
      overlayTexture: THREE.DataTexture;
      baseMesh: THREE.Mesh;
    }>;
    mapWorld: MapWorld;
    mapCatalog: MapCatalog;
  };

  const visual = internal.mapVisuals.get('3:8');
  if (!visual) {
    playerRenderer.destroy();
    throw new Error('PlayerRenderer did not create Cinnabar visual');
  }

  const textureData = visual.baseTexture.image.data as Uint8Array;
  const finalHash = fnv1a(textureData);

  if (finalHash !== firstHash) {
    playerRenderer.destroy();
    throw new Error(
      'Final PlayerRenderer Cinnabar texture differs from direct render: ' +
      finalHash + ' vs ' + firstHash,
    );
  }

  const positionedCount = internal.mapWorld.getPositionedMaps().length;
  const visualCount = internal.mapVisuals.size;

  if (positionedCount !== 37) {
    playerRenderer.destroy();
    throw new Error(
      'PlayerRenderer world positioning expected 37, got ' + positionedCount,
    );
  }

  if (visualCount !== 37) {
    playerRenderer.destroy();
    throw new Error(
      'PlayerRenderer visual count expected 37, got ' + visualCount,
    );
  }

  const result = {
    pass: true,
    catalogCount,
    connectedCount: connected,
    positionedCount,
    visualCount,
    maps: {
      pallet: { size: [pallet.width, pallet.height] },
      route1: { size: [route1.width, route1.height] },
      viridian: { size: [viridian.width, viridian.height] },
      cinnabar: {
        size: [cinnabar.width, cinnabar.height],
        position: world.getWorldPosition(3, 8),
        hash: firstHash,
      },
      ruinValley: {
        size: [ruin.width, ruin.height],
        position: world.getWorldPosition(3, 61),
      },
    },
    renderHashStableAfterRuin: firstHash === secondHash,
    playerRendererHashMatchesDirect: finalHash === firstHash,
    texture: {
      width: visual.baseTexture.image.width,
      height: visual.baseTexture.image.height,
      bytes: textureData.length,
    },
  };

  playerRenderer.destroy();
  document.body.dataset.pass = 'true';
  document.querySelector('#output')!.textContent =
    JSON.stringify(result, null, 2);
}

main().catch(error => {
  const message = error instanceof Error ? error.message : String(error);
  document.body.dataset.pass = 'false';
  document.querySelector('#output')!.textContent =
    JSON.stringify({ pass: false, error: message }, null, 2);
  throw error;
});
