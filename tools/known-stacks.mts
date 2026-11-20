/**
 * Gera src/render/KnownStacks.ts: o contorno das matas (linha de base e
 * ponta da copa por coluna de pixel) medido em todos os mapas das ROMs
 * dadas, pelo desenho de um periodo da pilha. Com ele, uma mata que nao
 * mostra cabeca nem frente no proprio mapa (Pallet, Rota 5) e cortada como
 * as outras.
 *
 * Uso: npx tsx tools/known-stacks.mts rom.gba [outra.gba ...]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { Gen3StateAdapter } = await import(`${ROOT}/src/gen3/Gen3StateAdapter.ts`);
const { MapCatalog } = await import(`${ROOT}/src/gen3/world/MapCatalog.ts`);
const VF = await import(`${ROOT}/src/render/VoxelFolding.ts`);
const GS = await import(`${ROOT}/src/render/GroundSubstitution.ts`);
const { substituteBuildings } = await import(`${ROOT}/src/render/buildings/BuildingSubstitution.ts`);

const BASE = 0x08000000;
const INDOOR = 8;
const SECRET_BASE = 9;
const log = console.log;

// chave canonica -> linha -> pontas medidas
const votes = new Map<string, Map<number, Uint8Array[]>>();

for (const romPath of process.argv.slice(2)) {
  const rom = new Uint8Array(readFileSync(romPath));
  const u8 = (a: number) => (a >= BASE && a - BASE < rom.length ? rom[a - BASE] : 0);
  const u16 = (a: number) => u8(a) | (u8(a + 1) << 8);
  const u32 = (a: number) => (u8(a) | (u8(a + 1) << 8) | (u8(a + 2) << 16) | (u8(a + 3) << 24)) >>> 0;
  const isPointer = (value: number) => value >= BASE && value - BASE < rom.length;
  const reader = {
    readU8: u8,
    readU16: u16,
    readU32: u32,
    readRange: (a: number, n: number) => {
      const out = new Uint8Array(n);
      for (let i = 0; i < n; i++) out[i] = u8(a + i);
      return out;
    },
  };

  const code = String.fromCharCode(...rom.slice(0xac, 0xb0));
  const family = code.startsWith('BP') && code !== 'BPEE' ? 'FRLG' : code === 'BPEE' ? 'E' : 'RS';
  const primary = family === 'FRLG' ? 640 : 512;

  console.log = () => {};
  console.warn = () => {};
  const adapter = new Gen3StateAdapter(reader, rom);
  const catalog: any = new MapCatalog();
  const groups = catalog.findMapGroupsByStructure(rom) as number;
  console.log = log;

  const seenHeaders = new Set<number>();
  let maps = 0;
  let measuredShapes = 0;

  for (let group = 0; group < 64; group++) {
    const table = u32(groups + group * 4);

    if (!isPointer(table)) {
      break;
    }

    for (let number = 0; number < 256; number++) {
      const header = u32(table + number * 4);

      if (!isPointer(header) || seenHeaders.has(header)) {
        break;
      }

      seenHeaders.add(header);

      const layout = u32(header);
      const mapType = u8(header + 0x17);

      if (!isPointer(layout) || mapType === INDOOR || mapType === SECRET_BASE) {
        continue;
      }

      const width = u32(layout);
      const height = u32(layout + 4);

      if (width < 1 || height < 1 || width > 255 || height > 255) {
        continue;
      }

      try {
        console.log = () => {};
        console.warn = () => {};

        const border = catalog.readBorder(rom, layout - BASE, family === 'FRLG');
        const borderIds: number[] = [];

        for (let i = 0; i < border.borderWidth * border.borderHeight; i++) {
          borderIds.push(u16(border.borderAddress + i * 2) & 0x3ff);
        }

        const renderData = adapter.getMapRenderData(
          u32(layout + 12), width, height, u32(layout + 16), u32(layout + 20), borderIds,
        );
        const substituted = substituteBuildings(family, width, height, renderData.blocks, renderData.graphics, {
          interior: false,
        });
        const blocks = substituted.blocks;
        const graphics = substituted.graphics;
        const hasForeground = (id: number) => {
          const pixels = graphics.get(id)?.foregroundPixels;
          if (!pixels) return false;
          for (let a = 3; a < pixels.length; a += 4) if (pixels[a] > 127) return true;
          return false;
        };
        const topReachesBottom = (id: number) => {
          const pixels = graphics.get(id)?.topPixels;
          if (!pixels) return false;
          for (let a = 15 * 64 + 3; a < pixels.length; a += 4) if (pixels[a] > 127) return true;
          return false;
        };
        const blockAt = (x: number, y: number) => {
          const block = blocks[y * width + x];
          if (!block) return undefined;
          const metatile = graphics.get(block.metatileId);
          return {
            ...block,
            behavior: metatile?.behavior ?? 0,
            hasForeground: hasForeground(block.metatileId),
            topReachesBottom: metatile ? topReachesBottom(block.metatileId) : undefined,
            flower:
              block.metatileId < primary &&
              (metatile?.topTileIds ?? []).some((tile: number) => tile >= 508 && tile <= 511),
            basePixels: metatile?.basePixels,
            pixels: metatile?.pixels,
            secondary: block.metatileId >= primary,
          };
        };
        const warps = catalog.readWarps(rom, header);
        const volume = VF.buildMapVolume(width, height, blockAt, warps, 'outdoor', 2, new Set(borderIds), {
          rockDoorsAsMountains: family === 'FRLG',
        });
        const artAt = (x: number, y: number) => {
          const block = blocks[y * width + x];
          const art = block ? graphics.get(block.metatileId) : undefined;
          return art
            ? { base: art.basePixels, foreground: art.foregroundPixels, bottom: art.bottomPixels, top: art.topPixels, merged: art.pixels }
            : undefined;
        };
        const composed = GS.composeMapTextures(width, height, volume.kinds, volume.groundSources, artAt);

        // Mede so com o proprio mapa.
        VF.clearKnownStacks();

        const shapes: any[] = [];
        VF.buildPropGeometry(
          width, height, volume.kinds, blockAt,
          GS.modelRowOpaque(composed.model, width, height),
          GS.modelPixelAt(composed.model, width, height),
          shapes,
        );

        console.log = log;
        maps++;

        for (const shape of shapes) {
          if (shape.quality !== 3 || shape.artRow === undefined || shape.lineRel === undefined) {
            continue;
          }

          // Chave canonica: a menor entre as rotacoes do periodo.
          const span = shape.period * 16;
          let best: { key: string; line: number } | null = null;

          for (let k = 0; k < shape.period; k++) {
            const key = VF.periodArtKey(blockAt, shape.x, shape.artRow + k, shape.period);

            if (!key) {
              continue;
            }

            const line = (((shape.lineRel - 16 * k) % span) + span) % span;

            if (!best || key < best.key) {
              best = { key, line };
            }
          }

          if (!best) {
            continue;
          }

          const byLine = votes.get(best.key) ?? new Map<number, Uint8Array[]>();
          const list = byLine.get(best.line) ?? [];

          list.push(Uint8Array.from(shape.offsets));
          byLine.set(best.line, list);
          votes.set(best.key, byLine);
          measuredShapes++;
        }
      } catch (error) {
        console.log = log;
      }
    }
  }

  log(path.basename(romPath), family, 'mapas', maps, 'pilhas medidas', measuredShapes);
}

// Linha mais votada; pontas: mediana por coluna.
const entries: string[] = [];

for (const key of [...votes.keys()].sort()) {
  const byLine = votes.get(key) as Map<number, Uint8Array[]>;
  const [line, list] = [...byLine.entries()].sort((a, b) => b[1].length - a[1].length || a[0] - b[0])[0];
  let packed = line.toString(16).padStart(2, '0');

  for (let column = 0; column < 16; column++) {
    const values = list.map((offsets) => offsets[column]).sort((a, b) => a - b);

    packed += values[(values.length - 1) >> 1].toString(16).padStart(2, '0');
  }

  entries.push(`  '${key}': '${packed}',`);
}

const target = path.join(ROOT, 'src/render/KnownStacks.ts');
const header = readFileSync(target, 'utf8').split('export const KNOWN_STACKS')[0];

writeFileSync(
  target,
  header + 'export const KNOWN_STACKS: Record<string, string> = {\n' + entries.join('\n') + '\n};\n',
);

log('desenhos conhecidos:', entries.length);
