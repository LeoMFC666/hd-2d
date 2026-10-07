import { Gen3StateAdapter } from '../src/gen3/Gen3StateAdapter';
import type { MemoryReader } from '../src/gen3/MemoryReader';
import { MapCatalog } from '../src/gen3/world/MapCatalog';
import { PlayerRenderer } from '../src/render/PlayerRenderer';

const BASE = 0x08000000;

class RomMemoryReader implements MemoryReader {
  constructor(private readonly rom: Uint8Array) {}
  readU8(address: number): number {
    const offset = address - BASE;
    return offset >= 0 && offset < this.rom.length ? this.rom[offset] : 0;
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
    const out = new Uint8Array(length);
    for (let i = 0; i < length; i++) out[i] = this.readU8(address + i);
    return out;
  }
}

function hash(data: Uint8Array): number {
  let h = 2166136261;
  for (const value of data) {
    h ^= value;
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function frames(count: number): Promise<void> {
  for (let i = 0; i < count; i++) {
    await new Promise(requestAnimationFrame);
  }
}

function makeBetaState(
  correctCatalog: MapCatalog,
): any {
  const map = correctCatalog.get(3, 8);
  assert(map, 'Cinnabar definition missing');

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
      mapLayoutId: 86,
      mapHeaderAddress: 0,
      mapLayoutAddress: map.mapLayoutAddress,
      mapDataAddress: 0x08338378,
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
    camera: { x: 0, y: 0, z: 0, yaw: 0, pitch: 0 },
  };
}

function buildCorrectAnchor(
  reader: RomMemoryReader,
  rom: Uint8Array,
): { mapGroup: number; mapNumber: number; mapLayoutId: number; mapLayoutAddress: number } {
  const readConnections = (header: number) => {
    const cp = reader.readU32(header + 0x0c);
    if (cp < BASE || cp >= BASE + rom.length) return null;
    const count = reader.readU32(cp) | 0;
    if (count < 0 || count > 64) return null;
    if (count === 0) return [];
    const data = reader.readU32(cp + 4);
    const dataOffset = data - BASE;
    if (dataOffset < 0 || dataOffset + count * 0x0c > rom.length) return null;
    const out: Array<{direction:number;offset:number;mapGroup:number;mapNumber:number}> = [];
    for (let i = 0; i < count; i++) {
      const e = dataOffset + i * 0x0c;
      out.push({
        direction: reader.readU8(BASE + e),
        offset: reader.readU32(BASE + e + 4) | 0,
        mapGroup: reader.readU8(BASE + e + 8),
        mapNumber: reader.readU8(BASE + e + 9),
      });
    }
    return out;
  };

  for (let offset = 0; offset <= rom.length - 0x1c; offset += 4) {
    const layoutAddress = reader.readU32(BASE + offset);
    if (layoutAddress < BASE || layoutAddress >= BASE + rom.length) continue;

    const width = reader.readU32(layoutAddress);
    const height = reader.readU32(layoutAddress + 4);
    if (width !== 24 || height !== 20) continue;

    const connections = readConnections(BASE + offset);
    if (!connections) continue;

    const ok =
      connections.some(c => c.direction === 2 && c.mapGroup === 3 && c.mapNumber === 19 && c.offset === 0) &&
      connections.some(c => c.direction === 1 && c.mapGroup === 3 && c.mapNumber === 39 && c.offset === 0);

    if (!ok) continue;

    return {
      mapGroup: 3,
      mapNumber: 0,
      mapLayoutId: reader.readU16(BASE + offset + 0x12),
      mapLayoutAddress,
    };
  }

  throw new Error('Pallet anchor not found');
}

async function main(): Promise<void> {
  const rom = new Uint8Array(
    await (await fetch('/Pokemon - FireRed Version (USA, Europe) (Rev 1).gba')).arrayBuffer(),
  );

  const reader = new RomMemoryReader(rom);
  const adapter = new Gen3StateAdapter(reader, rom);

  const correctCatalog = new MapCatalog();
  const anchor = buildCorrectAnchor(reader, rom);
  const count = correctCatalog.buildGen3FromRom(rom, anchor);
  assert(count === 425, 'Expected 425 catalog maps, got ' + count);

  const cinnabar = correctCatalog.get(3, 8);
  assert(cinnabar, 'Cinnabar missing from correct catalog');

  const correctRender = adapter.getMapRenderData(
    cinnabar.mapDataAddress,
    cinnabar.width,
    cinnabar.height,
    cinnabar.primaryTilesetAddress,
    cinnabar.secondaryTilesetAddress,
  );
  assert(correctRender, 'Correct Cinnabar render data missing');

  const betaState = makeBetaState(correctCatalog);

  const fakeAdapter: any = {
    readState: () => betaState,
    getMapRenderData: adapter.getMapRenderData.bind(adapter),
  };

  const container = document.createElement('div');
  container.style.width = '960px';
  container.style.height = '640px';
  document.body.appendChild(container);

  const renderer = new PlayerRenderer(container, fakeAdapter, rom);
  const intern = renderer as any;

  // Simulate the real race: catalog unavailable during the first frames.
  const originalBuild =
    intern.mapCatalog.buildGen3FromRom.bind(intern.mapCatalog);

  intern.mapCatalog.buildGen3FromRom = () => 0;

  await frames(10);

  const betaVisualWasNotCreated =
    !intern.mapVisuals.has('3:8');
  const betaDefinitionWasNotCreated =
    !intern.mapCatalog.has(3, 8);

  // Restore the real catalog implementation and populate it from the valid ROM anchor.
  intern.mapCatalog.buildGen3FromRom = originalBuild;
  const restoredCount = originalBuild(rom, anchor);
  assert(restoredCount === 425, 'Restored catalog count changed: ' + restoredCount);
  intern.worldCatalogBuilt = true;

  await frames(10);

  const visual = intern.mapVisuals.get('3:8');
  assert(visual, 'Cinnabar visual was not created after catalog became available');

  const finalTextureHash = hash(
    visual.baseTexture.image.data as Uint8Array,
  );

  const expectedTexture = (() => {
    const width = cinnabar.width * 16;
    const height = cinnabar.height * 16;
    const pixels = new Uint8ClampedArray(width * height * 4);

    for (let y = 0; y < cinnabar.height; y++) {
      for (let x = 0; x < cinnabar.width; x++) {
        const block = correctRender.blocks[y * cinnabar.width + x];
        const graphics = correctRender.graphics.get(block.metatileId);
        if (!graphics) continue;

        for (let sy = 0; sy < 16; sy++) {
          const destinationY =
            (cinnabar.height - 1 - y) * 16 + 15 - sy;

          for (let sx = 0; sx < 16; sx++) {
            const sourceOffset = (sy * 16 + sx) * 4;
            const destinationX = x * 16 + sx;
            const destinationOffset =
              (destinationY * width + destinationX) * 4;

            pixels[destinationOffset] = graphics.basePixels[sourceOffset];
            pixels[destinationOffset + 1] = graphics.basePixels[sourceOffset + 1];
            pixels[destinationOffset + 2] = graphics.basePixels[sourceOffset + 2];
            pixels[destinationOffset + 3] = graphics.basePixels[sourceOffset + 3];
          }
        }
      }
    }

    return hash(new Uint8Array(pixels.buffer));
  })();

  const connected = intern.mapWorld.buildFrom(3, 0);
  const positioned = intern.mapWorld.getPositionedMaps().length;

  assert(connected === 37, 'Connected world changed: ' + connected);
  assert(positioned === 37, 'Positioned world changed: ' + positioned);
  assert(intern.mapWorld.getWorldPosition(3, 0), 'Pallet not positioned');
  assert(intern.mapWorld.getWorldPosition(3, 19), 'Route 1 not positioned');
  assert(intern.mapWorld.getWorldPosition(3, 1), 'Viridian not positioned');
  assert(intern.mapWorld.getWorldPosition(3, 8), 'Cinnabar not positioned');
  assert(intern.mapWorld.getWorldPosition(3, 61) === null, 'Ruin Valley incorrectly positioned');

  assert(betaVisualWasNotCreated, 'Beta Cinnabar visual was created before catalog load');
  assert(betaDefinitionWasNotCreated, 'Beta Cinnabar definition was registered before catalog load');
  assert(finalTextureHash === expectedTexture, 'Final Cinnabar texture does not match static catalog render');

  renderer.destroy();

  document.body.dataset.pass = 'true';
  document.querySelector('#out')!.textContent = JSON.stringify({
    pass: true,
    catalogCount: count,
    initial: {
      betaMapData: '0x08338378',
      transientBetaVisual: false,
      transientBetaDefinition: false,
    },
    final: {
      cinnabarTextureMatchesStatic: true,
      connectedCount: connected,
      positionedCount: positioned,
      positions: {
        pallet: intern.mapWorld.getWorldPosition(3, 0),
        route1: intern.mapWorld.getWorldPosition(3, 19),
        viridian: intern.mapWorld.getWorldPosition(3, 1),
        cinnabar: intern.mapWorld.getWorldPosition(3, 8),
        ruinValley: intern.mapWorld.getWorldPosition(3, 61),
      },
    },
  }, null, 2);
}

main().catch(error => {
  document.body.dataset.pass = 'false';
  document.querySelector('#out')!.textContent = JSON.stringify({
    pass: false,
    error: error instanceof Error ? error.message : String(error),
  }, null, 2);
});
