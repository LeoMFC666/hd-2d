import { MapCatalog } from '../src/gen3/world/MapCatalog';
import { MapWorld } from '../src/gen3/world/MapWorld';
import { Gen3StateAdapter } from '../src/gen3/Gen3StateAdapter';
import { PlayerRenderer } from '../src/render/PlayerRenderer';
import type { MemoryReader } from '../src/gen3/MemoryReader';
import type { GameState } from '../src/gen3/GameState';
import * as THREE from 'three';

const BASE = 0x08000000;
const BETA_MAP_DATA = BASE + 0x00338378;

class RomReader implements MemoryReader {
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
    const out = new Uint8Array(length);
    for (let i = 0; i < length; i++) out[i] = this.readU8(address + i);
    return out;
  }
}

function hash(bytes: Uint8Array): number {
  let h = 2166136261;
  for (const b of bytes) {
    h ^= b;
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function assembleBaseTexture(
  data: NonNullable<ReturnType<Gen3StateAdapter['getMapRenderData']>>,
  width: number,
  height: number,
): Uint8Array {
  const tw = width * 16;
  const out = new Uint8Array(tw * height * 16 * 4);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const block = data.blocks[y * width + x];
      const graphics = block
        ? data.graphics.get(block.metatileId)
        : null;
      if (!graphics) continue;

      for (let sy = 0; sy < 16; sy++) {
        const dy = (height - 1 - y) * 16 + 15 - sy;
        for (let sx = 0; sx < 16; sx++) {
          const so = (sy * 16 + sx) * 4;
          const dx = x * 16 + sx;
          const d = (dy * tw + dx) * 4;
          out[d] = graphics.basePixels[so];
          out[d + 1] = graphics.basePixels[so + 1];
          out[d + 2] = graphics.basePixels[so + 2];
          out[d + 3] = graphics.basePixels[so + 3];
        }
      }
    }
  }

  return out;
}

function makeState(map: any): GameState {
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

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function main(): Promise<void> {
  const rom = new Uint8Array(
    await (await fetch('/Pokemon - FireRed Version (USA, Europe) (Rev 1).gba')).arrayBuffer(),
  );
  assert(String.fromCharCode(rom[0xac], rom[0xad], rom[0xae], rom[0xaf]) === 'BPRE', 'Wrong ROM');
  assert(rom[0xbc] === 1, 'Wrong revision');

  const reader = new RomReader(rom);
  const adapter = new Gen3StateAdapter(reader, rom);

  const globalTable = 0x08352718;
  const group3Address = reader.readU32(globalTable + 3 * 4);
  const cinnabarHeaderAddress =
    reader.readU32(group3Address + 8 * 4);
  const cinnabarLayoutAddress =
    reader.readU32(cinnabarHeaderAddress);
  const cinnabarLayoutId =
    reader.readU16(cinnabarHeaderAddress + 0x12);
  const cinnabarMapDataAddress =
    reader.readU32(cinnabarLayoutAddress + 0x0c);
  const cinnabarPrimary =
    reader.readU32(cinnabarLayoutAddress + 0x10);
  const cinnabarSecondary =
    reader.readU32(cinnabarLayoutAddress + 0x14);

  const correctMap = {
    mapGroup: 3,
    mapNumber: 8,
    mapLayoutId: cinnabarLayoutId,
    mapHeaderAddress: cinnabarHeaderAddress,
    mapLayoutAddress: cinnabarLayoutAddress,
    mapDataAddress: cinnabarMapDataAddress,
    primaryTilesetAddress: cinnabarPrimary,
    secondaryTilesetAddress: cinnabarSecondary,
    width: reader.readU32(cinnabarLayoutAddress),
    height: reader.readU32(cinnabarLayoutAddress + 4),
    connections: [],
  };

  const betaMap = {
    ...correctMap,
    mapDataAddress: BETA_MAP_DATA,
    connections: [],
  };

  const directCorrect =
    adapter.getMapRenderData(
      correctMap.mapDataAddress,
      correctMap.width,
      correctMap.height,
      correctMap.primaryTilesetAddress,
      correctMap.secondaryTilesetAddress,
    );
  const directBeta =
    adapter.getMapRenderData(
      betaMap.mapDataAddress,
      betaMap.width,
      betaMap.height,
      betaMap.primaryTilesetAddress,
      betaMap.secondaryTilesetAddress,
    );

  assert(directCorrect, 'Correct Cinnabar render data is null');
  assert(directBeta, 'Beta render data is null');

  const correctHash =
    hash(
      assembleBaseTexture(
        directCorrect,
        correctMap.width,
        correctMap.height,
      ),
    );
  const betaHash =
    hash(
      assembleBaseTexture(
        directBeta,
        betaMap.width,
        betaMap.height,
      ),
    );

  assert(correctHash !== betaHash, 'Correct and beta maps unexpectedly match');

  const state = makeState(correctMap);
  const fakeAdapter = {
    readState: () => state,
    getMapRenderData: adapter.getMapRenderData.bind(adapter),
  } as unknown as Gen3StateAdapter;

  const container = document.createElement('div');
  container.style.width = '900px';
  container.style.height = '600px';
  document.body.appendChild(container);

  const renderer =
    new PlayerRenderer(
      container,
      fakeAdapter,
      rom,
    );

  const internal =
    renderer as unknown as {
      mapCatalog: MapCatalog;
      mapWorld: MapWorld;
      mapVisuals: Map<string, {
        baseTexture: THREE.DataTexture;
      }>;
      queueMapBuild: (map: any) => void;
    };

  const originalBuild =
    internal.mapCatalog.buildGen3FromRom.bind(
      internal.mapCatalog,
    );

  internal.mapCatalog.buildGen3FromRom =
    (() => 0) as any;

  // Simulate the bad first visual: key 3:8 exists, but its data is the beta map.
  const betaDefinition = {
    ...betaMap,
    worldX: 0,
    worldY: 0,
  };

  internal.mapCatalog.register(betaDefinition);

  for (let i = 0; i < 8; i++) {
    await new Promise(requestAnimationFrame);
  }

  const staleVisual =
    internal.mapVisuals.get('3:8');

  assert(staleVisual, 'Could not create the simulated stale 3:8 visual');

  const staleHash =
    hash(
      staleVisual.baseTexture.image.data as Uint8Array,
    );

  // Now the catalog gets the real Cinnabar definition, exactly like the
  // correct ROM catalog does after initialization.
  internal.mapCatalog.register({
    ...correctMap,
    worldX: 0,
    worldY: 0,
  });

  internal.queueMapBuild({
    ...correctMap,
    worldX: 0,
    worldY: 0,
  });

  await new Promise(requestAnimationFrame);
  await new Promise(requestAnimationFrame);

  const finalVisual =
    internal.mapVisuals.get('3:8');

  assert(finalVisual, 'Final 3:8 visual disappeared');
  const finalHash =
    hash(
      finalVisual.baseTexture.image.data as Uint8Array,
    );

  const staleMatchesBeta = staleHash === betaHash;
  const finalMatchesCorrect = finalHash === correctHash;
  const visualWidth = finalVisual.baseTexture.image.width;
  const visualHeight = finalVisual.baseTexture.image.height;

  const result = {
    pass: finalMatchesCorrect && staleMatchesBeta,
    betaMapData: '0x08338378',
    correctCinnabarMapData:
      '0x' + cinnabarMapDataAddress.toString(16),
    betaHash,
    staleHash,
    correctHash,
    finalHash,
    staleMatchesBeta,
    finalMatchesCorrect,
    finalTexture: [visualWidth, visualHeight],
  };

  internal.mapCatalog.buildGen3FromRom =
    originalBuild;

  renderer.destroy();
  container.remove();

  document.body.dataset.pass =
    result.pass ? 'true' : 'false';
  document.querySelector('#out')!.textContent =
    JSON.stringify(result, null, 2);

  if (!result.pass) {
    throw new Error(
      'Stale visual reproduction/fix assertion failed: ' +
      JSON.stringify(result),
    );
  }
}

main().catch(error => {
  document.body.dataset.pass = 'false';
  document.querySelector('#out')!.textContent =
    JSON.stringify({
      pass: false,
      error: error instanceof Error ? error.message : String(error),
    }, null, 2);
  throw error;
});
