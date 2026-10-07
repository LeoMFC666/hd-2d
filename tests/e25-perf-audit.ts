import * as THREE from 'three';
import { Gen3StateAdapter } from '../src/gen3/Gen3StateAdapter';
import { MapCatalog } from '../src/gen3/world/MapCatalog';
import { MapWorld } from '../src/gen3/world/MapWorld';

const BASE = 0x08000000;
const BETA_CINNABAR_OFFSET = 0x00338378;

class RomReader {
  constructor(private readonly rom: Uint8Array) {}
  readU8(address: number) {
    const o = address - BASE;
    return o >= 0 && o < this.rom.length ? this.rom[o] : 0;
  }
  readU16(address: number) {
    return this.readU8(address) | (this.readU8(address + 1) << 8);
  }
  readU32(address: number) {
    return (this.readU8(address) |
      (this.readU8(address + 1) << 8) |
      (this.readU8(address + 2) << 16) |
      (this.readU8(address + 3) * 0x1000000)) >>> 0;
  }
  readRange(address: number, length: number) {
    const out = new Uint8Array(length);
    for (let i = 0; i < length; i++) out[i] = this.readU8(address + i);
    return out;
  }
}

function findCinnabarAnchor(rom: Uint8Array) {
  const r = new RomReader(rom);
  for (let o = 0; o <= rom.length - 0x1c; o += 4) {
    const layout = r.readU32(BASE + o);
    const lo = layout - BASE;
    if (lo < 0 || lo + 0x18 > rom.length) continue;
    if (r.readU32(layout) !== 24 || r.readU32(layout + 4) !== 20) continue;
    const cp = r.readU32(BASE + o + 0x0c);
    const co = cp - BASE;
    if (co < 0 || co + 8 > rom.length) continue;
    const count = r.readU32(cp);
    if (count < 2 || count > 64) continue;
    const data = r.readU32(cp + 4) - BASE;
    if (data < 0 || data + count * 0x0c > rom.length) continue;

    let north = false;
    let east = false;
    for (let i = 0; i < count; i++) {
      const e = data + i * 0x0c;
      const direction = r.readU8(BASE + e);
      const offset = r.readU32(BASE + e + 4) | 0;
      const group = r.readU8(BASE + e + 8);
      const number = r.readU8(BASE + e + 9);
      north ||= direction === 2 && offset === 0 && group === 3 && number === 40;
      east ||= direction === 4 && offset === 0 && group === 3 && number === 38;
    }
    if (north && east) {
      return {
        mapLayoutAddress: layout,
        mapLayoutId: r.readU16(BASE + o + 0x12),
      };
    }
  }
  throw new Error('Cinnabar anchor not found');
}

async function main() {
  const rom = new Uint8Array(
    await (await fetch('/Pokemon - FireRed Version (USA, Europe) (Rev 1).gba')).arrayBuffer(),
  );
  const code = String.fromCharCode(rom[0xac], rom[0xad], rom[0xae], rom[0xaf]);
  if (code !== 'BPRE' || rom[0xbc] !== 1) throw new Error('wrong ROM');

  const anchor = findCinnabarAnchor(rom);
  const catalog = new MapCatalog();
  const count = catalog.buildGen3FromRom(rom, {
    mapGroup: 3,
    mapNumber: 8,
    mapLayoutId: anchor.mapLayoutId,
    mapLayoutAddress: anchor.mapLayoutAddress,
  });

  const cinnabar = catalog.get(3, 8);
  if (!cinnabar) throw new Error('Cinnabar missing from catalog');

  const reader = new RomReader(rom);
  const adapter = new Gen3StateAdapter(reader, rom);
  const render = adapter.getMapRenderData(
    cinnabar.mapDataAddress,
    cinnabar.width,
    cinnabar.height,
    cinnabar.primaryTilesetAddress,
    cinnabar.secondaryTilesetAddress,
  );
  if (!render) throw new Error('Cinnabar render failed');

  const world = new MapWorld(catalog);
  const connected = world.buildFrom(3, 0);
  if (connected !== 37) throw new Error('connected world changed: ' + connected);

  const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
  const gl = renderer.getContext();
  const result = {
    pass:
      cinnabar.mapDataAddress - BASE !== BETA_CINNABAR_OFFSET &&
      cinnabar.width === 24 &&
      cinnabar.height === 20 &&
      cinnabar.connections.some(c => c.direction === 'NORTH' && c.mapGroup === 3 && c.mapNumber === 40) &&
      cinnabar.connections.some(c => c.direction === 'EAST' && c.mapGroup === 3 && c.mapNumber === 38) &&
      render.blocks.length === 480 &&
      render.graphics.size > 0 &&
      connected === 37 &&
      gl instanceof WebGL2RenderingContext,
    catalogCount: count,
    connectedCount: connected,
    cinnabar: {
      mapDataOffset: '0x' + (cinnabar.mapDataAddress - BASE).toString(16),
      width: cinnabar.width,
      height: cinnabar.height,
      primaryTileset: '0x' + cinnabar.primaryTilesetAddress.toString(16),
      secondaryTileset: '0x' + cinnabar.secondaryTilesetAddress.toString(16),
      connections: cinnabar.connections,
      blockCount: render.blocks.length,
      graphicsCount: render.graphics.size,
    },
    webgl: {
      version: gl.getParameter(gl.VERSION),
      renderer: gl.getParameter(gl.RENDERER),
      webgl2: gl instanceof WebGL2RenderingContext,
    },
  };
  renderer.dispose();
  document.body.dataset.pass = result.pass ? 'true' : 'false';
  document.querySelector('#out')!.textContent = JSON.stringify(result, null, 2);
}
main().catch(error => {
  document.body.dataset.pass = 'false';
  document.querySelector('#out')!.textContent = String(error);
});
