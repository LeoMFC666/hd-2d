import { MapCatalog } from '../src/gen3/world/MapCatalog';
import { MapWorld } from '../src/gen3/world/MapWorld';
import { Gen3StateAdapter } from '../src/gen3/Gen3StateAdapter';
import type { MemoryReader } from '../src/gen3/MemoryReader';

const BASE = 0x08000000;
const HEADER_SIZE = 0x1c;

interface Conn {
  direction: number;
  mapGroup: number;
  mapNumber: number;
  offset: number;
}

interface HeaderInfo {
  address: number;
  layoutAddress: number;
  layoutId: number;
  width: number;
  height: number;
  mapDataAddress: number;
  primaryTilesetAddress: number;
  secondaryTilesetAddress: number;
  connections: Conn[];
}

class RomMemoryReader implements MemoryReader {
  constructor(private readonly rom: Uint8Array) {}

  readU8(address: number): number {
    const offset = address - BASE;
    return offset >= 0 && offset < this.rom.length ? this.rom[offset] : 0;
  }

  readU16(address: number): number {
    return (
      this.readU8(address) |
      (this.readU8(address + 1) << 8)
    );
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

function i32(rom: Uint8Array, offset: number): number {
  return u32(rom, offset) | 0;
}

function isPtr(rom: Uint8Array, address: number, size = 1): boolean {
  const offset = address - BASE;
  return offset >= 0 && offset + size <= rom.length;
}

function readConnections(rom: Uint8Array, headerAddress: number): Conn[] | null {
  const headerOffset = headerAddress - BASE;
  const connectionsAddress = u32(rom, headerOffset + 0x0c);

  if (connectionsAddress === 0) {
    return [];
  }

  if (!isPtr(rom, connectionsAddress, 8)) {
    return null;
  }

  const offset = connectionsAddress - BASE;
  const count = i32(rom, offset);

  if (count < 0 || count > 64) {
    return null;
  }

  if (count === 0) {
    return [];
  }

  const dataAddress = u32(rom, offset + 4);

  if (!isPtr(rom, dataAddress, count * 0x0c)) {
    return null;
  }

  const dataOffset = dataAddress - BASE;
  const result: Conn[] = [];

  for (let i = 0; i < count; i++) {
    const entry = dataOffset + i * 0x0c;
    result.push({
      direction: u8(rom, entry),
      offset: i32(rom, entry + 4),
      mapGroup: u8(rom, entry + 8),
      mapNumber: u8(rom, entry + 9),
    });
  }

  return result;
}

function hasConnection(
  connections: Conn[],
  expected: Conn,
): boolean {
  return connections.some(
    connection =>
      connection.direction === expected.direction &&
      connection.mapGroup === expected.mapGroup &&
      connection.mapNumber === expected.mapNumber &&
      connection.offset === expected.offset,
  );
}

function findHeader(
  rom: Uint8Array,
  width: number,
  height: number,
  requiredConnections: Conn[],
): HeaderInfo | null {
  for (let offset = 0; offset <= rom.length - HEADER_SIZE; offset += 4) {
    const layoutAddress = u32(rom, offset);

    if (!isPtr(rom, layoutAddress, 0x18)) {
      continue;
    }

    const layoutOffset = layoutAddress - BASE;
    const candidateWidth = u32(rom, layoutOffset);
    const candidateHeight = u32(rom, layoutOffset + 4);

    if (candidateWidth !== width || candidateHeight !== height) {
      continue;
    }

    const mapDataAddress = u32(rom, layoutOffset + 0x0c);
    const primaryTilesetAddress = u32(rom, layoutOffset + 0x10);
    const secondaryTilesetAddress = u32(rom, layoutOffset + 0x14);

    if (
      !isPtr(rom, mapDataAddress, width * height * 2) ||
      !isPtr(rom, primaryTilesetAddress, 4) ||
      !isPtr(rom, secondaryTilesetAddress, 4)
    ) {
      continue;
    }

    const address = BASE + offset;
    const connections = readConnections(rom, address);

    if (!connections) {
      continue;
    }

    if (!requiredConnections.every(c => hasConnection(connections, c))) {
      continue;
    }

    return {
      address,
      layoutAddress,
      layoutId: u16(rom, offset + 0x12),
      width,
      height,
      mapDataAddress,
      primaryTilesetAddress,
      secondaryTilesetAddress,
      connections,
    };
  }

  return null;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function equalAddress(
  actual: number,
  expected: number,
  label: string,
): void {
  assert(
    actual === expected,
    label + ': expected 0x' + expected.toString(16) +
      ', got 0x' + actual.toString(16),
  );
}

function hashBlocks(blocks: readonly { metatileId: number }[]): number {
  let hash = 2166136261;
  for (const block of blocks) {
    hash ^= block.metatileId & 0xffff;
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

async function main(): Promise<void> {
  const rom = new Uint8Array(
    await (await fetch('/Pokemon - FireRed Version (USA, Europe) (Rev 1).gba')).arrayBuffer(),
  );

  const gameCode = String.fromCharCode(
    rom[0xac],
    rom[0xad],
    rom[0xae],
    rom[0xaf],
  );

  const revision = rom[0xbc];
  assert(gameCode === 'BPRE', 'Unexpected game code: ' + gameCode);
  assert(revision === 1, 'Unexpected revision: ' + revision);

  const expected = {
    pallet: findHeader(rom, 24, 20, [
      { direction: 2, mapGroup: 3, mapNumber: 19, offset: 0 },
      { direction: 1, mapGroup: 3, mapNumber: 39, offset: 0 },
    ]),
    route1: findHeader(rom, 24, 40, [
      { direction: 2, mapGroup: 3, mapNumber: 1, offset: -12 },
      { direction: 1, mapGroup: 3, mapNumber: 0, offset: 0 },
    ]),
    cinnabar: findHeader(rom, 24, 20, [
      { direction: 2, mapGroup: 3, mapNumber: 40, offset: 0 },
      { direction: 4, mapGroup: 3, mapNumber: 38, offset: 0 },
    ]),
    ruin: findHeader(rom, 48, 40, [
      { direction: 4, mapGroup: 3, mapNumber: 60, offset: -80 },
    ]),
  };

  for (const [name, info] of Object.entries(expected)) {
    assert(info, 'Independent ROM scan could not locate ' + name);
  }

  const catalog = new MapCatalog();
  const count = catalog.buildGen3FromRom(rom, {
    mapGroup: 3,
    mapNumber: 0,
    mapLayoutId: expected.pallet!.layoutId,
    mapLayoutAddress: expected.pallet!.layoutAddress,
  });

  assert(count === 425, 'Catalog count expected 425, got ' + count);

  const catalogPallet = catalog.get(3, 0);
  const catalogRoute1 = catalog.get(3, 19);
  const catalogViridian = catalog.get(3, 1);
  const catalogCinnabar = catalog.get(3, 8);
  const catalogRuin = catalog.get(3, 61);

  assert(catalogPallet, 'Catalog missing 3:0 Pallet');
  assert(catalogRoute1, 'Catalog missing 3:19 Route1');
  assert(catalogViridian, 'Catalog missing 3:1 Viridian');
  assert(catalogCinnabar, 'Catalog missing 3:8 Cinnabar');
  assert(catalogRuin, 'Catalog missing 3:61 Ruin Valley');

  const comparisons: Record<string, string> = {};

  const pairs: Array<[string, any, HeaderInfo]> = [
    ['Pallet', catalogPallet, expected.pallet!],
    ['Route1', catalogRoute1, expected.route1!],
    ['Cinnabar', catalogCinnabar, expected.cinnabar!],
    ['RuinValley', catalogRuin, expected.ruin!],
  ];

  for (const [name, actual, independent] of pairs) {
    equalAddress(actual.mapHeaderAddress, independent.address, name + ' header');
    equalAddress(actual.mapLayoutAddress, independent.layoutAddress, name + ' layout');
    equalAddress(actual.mapDataAddress, independent.mapDataAddress, name + ' map data');
    equalAddress(actual.primaryTilesetAddress, independent.primaryTilesetAddress, name + ' primary tileset');
    equalAddress(actual.secondaryTilesetAddress, independent.secondaryTilesetAddress, name + ' secondary tileset');
    assert(actual.width === independent.width, name + ' width mismatch');
    assert(actual.height === independent.height, name + ' height mismatch');
    comparisons[name] = 'catalog matches independent ROM scan';
  }

  const world = new MapWorld(catalog);
  const connectedCount = world.buildFrom(3, 0);

  assert(connectedCount === 37, 'Expected 37 connected maps from Pallet, got ' + connectedCount);
  assert(world.getWorldPosition(3, 0), 'Pallet has no world position');
  assert(world.getWorldPosition(3, 19), 'Route1 has no world position');
  assert(world.getWorldPosition(3, 1), 'Viridian has no world position');
  assert(world.getWorldPosition(3, 8), 'Cinnabar has no world position');
  assert(world.getWorldPosition(3, 61) === null, 'Ruin Valley must not be glued into Kanto world');

  const adapter = new Gen3StateAdapter(
    new RomMemoryReader(rom),
    rom,
  );

  const cinnabarRender = adapter.getMapRenderData(
    catalogCinnabar.mapDataAddress,
    catalogCinnabar.width,
    catalogCinnabar.height,
    catalogCinnabar.primaryTilesetAddress,
    catalogCinnabar.secondaryTilesetAddress,
  );

  const ruinRender = adapter.getMapRenderData(
    catalogRuin.mapDataAddress,
    catalogRuin.width,
    catalogRuin.height,
    catalogRuin.primaryTilesetAddress,
    catalogRuin.secondaryTilesetAddress,
  );

  assert(cinnabarRender, 'Cinnabar getMapRenderData returned null');
  assert(ruinRender, 'Ruin Valley getMapRenderData returned null');
  assert(cinnabarRender.blocks.length === 24 * 20, 'Cinnabar block count mismatch');
  assert(ruinRender.blocks.length === 48 * 40, 'Ruin Valley block count mismatch');

  const cinnabarHash = hashBlocks(cinnabarRender.blocks);
  const ruinHash = hashBlocks(ruinRender.blocks);

  assert(cinnabarHash !== ruinHash, 'Cinnabar and Ruin Valley block fingerprints are identical');

  const result = {
    gameCode,
    revision,
    catalogCount: count,
    connectedCount,
    maps: {
      pallet: { width: catalogPallet.width, height: catalogPallet.height },
      route1: { width: catalogRoute1.width, height: catalogRoute1.height },
      viridian: { width: catalogViridian.width, height: catalogViridian.height },
      cinnabar: {
        width: catalogCinnabar.width,
        height: catalogCinnabar.height,
        connections: catalogCinnabar.connections,
        blockHash: cinnabarHash,
      },
      ruinValley: {
        width: catalogRuin.width,
        height: catalogRuin.height,
        blockHash: ruinHash,
      },
    },
    comparisons,
    pass: true,
  };

  document.querySelector('#output')!.textContent =
    JSON.stringify(result, null, 2);
  document.body.dataset.pass = 'true';
}

main().catch(error => {
  const message = error instanceof Error ? error.message : String(error);
  document.querySelector('#output')!.textContent =
    JSON.stringify({ pass: false, error: message }, null, 2);
  document.body.dataset.pass = 'false';
  throw error;
});
