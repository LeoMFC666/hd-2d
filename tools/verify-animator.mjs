// Harness de verificacao do TileAnimator. Ver relatorios/12. Requer o build
// em JS de Gen3StateAdapter, TileAnimator e MapCatalog numa pasta b4/ ao lado.
// Verificacao do TileAnimator contra o pipeline REAL do mapa.
//
// 1. IDENTIDADE: com VRAM == ROM, recompor todas as celulas tem de dar um
//    resultado byte a byte igual ao mapa assado por buildMapVisual (logica
//    replicada aqui literalmente). Prova que camadas, flips, paletas,
//    divisao primario/secundario e coordenadas estao certas.
// 2. BORDA DA AGUA: simula um quadro de animacao trocando o conteudo de um
//    tile animado. Em toda celula COVERED cuja camada de baixo usa esse
//    tile, os pixels nao-transparentes da camada de cima tem de continuar
//    visiveis e com a cor da camada de cima.
// 3. BATALHA: simula a VRAM sobrescrita nos tiles baixos. Nenhum pixel do
//    mapa pode mudar.
import { readFileSync } from 'node:fs';
import { Gen3StateAdapter } from './b4/gen3/Gen3StateAdapter.js';
import { MapCatalog } from './b4/gen3/world/MapCatalog.js';
import { TileAnimator } from './b4/render/TileAnimator.js';

const BASE = 0x08000000;
const VRAM = 0x06000000;
const PX = 16;

function romReader(rom) {
  const u8 = (a) => (a >= BASE && a - BASE < rom.length ? rom[a - BASE] : 0);
  return {
    readU8: u8,
    readU16: (a) => u8(a) | (u8(a + 1) << 8),
    readU32: (a) => (u8(a) | (u8(a + 1) << 8) | (u8(a + 2) << 16) | (u8(a + 3) << 24)) >>> 0,
    readRange: (a, n) => { const o = new Uint8Array(n); for (let i = 0; i < n; i++) o[i] = u8(a + i); return o; },
  };
}

// VRAM simulada: 1024 tiles x 32 bytes.
function vramReader(vram) {
  const u8 = (a) => (a >= VRAM && a - VRAM < vram.length ? vram[a - VRAM] : 0);
  return {
    readU8: u8,
    readU16: (a) => u8(a) | (u8(a + 1) << 8),
    readU32: (a) => (u8(a) | (u8(a + 1) << 8) | (u8(a + 2) << 16) | (u8(a + 3) << 24)) >>> 0,
    readRange: (a, n) => { const o = new Uint8Array(n); for (let i = 0; i < n; i++) o[i] = u8(a + i); return o; },
  };
}

function packTile(vram, tileId, indices) {
  for (let i = 0; i < 32; i++) vram[tileId * 32 + i] = indices[i * 2] | (indices[i * 2 + 1] << 4);
}

// buildMapVisual, replicado literalmente.
function bake(map, renderData) {
  const w = map.width * PX, h = map.height * PX;
  const base = new Uint8Array(w * h * 4), over = new Uint8Array(w * h * 4);
  for (let y = 0; y < map.height; y++) for (let x = 0; x < map.width; x++) {
    const block = renderData.blocks[y * map.width + x];
    if (!block) continue;
    const g = renderData.graphics.get(block.metatileId);
    if (!g) continue;
    for (let sy = 0; sy < PX; sy++) {
      const dy = (map.height - 1 - y) * PX + PX - 1 - sy;
      for (let sx = 0; sx < PX; sx++) {
        const dx = x * PX + sx, so = (sy * PX + sx) * 4, d = (dy * w + dx) * 4;
        for (let c = 0; c < 4; c++) { base[d + c] = g.basePixels[so + c]; over[d + c] = g.foregroundPixels[so + c]; }
      }
    }
  }
  return { base, over, w, h };
}

const u32 = (r, o) => (r[o] | (r[o + 1] << 8) | (r[o + 2] << 16) | (r[o + 3] << 24)) >>> 0;
const vp = (r, a, s) => a >= BASE && a - BASE + s <= r.length;
const V = { BPRE: 43, BPEE: 34 };

for (const file of process.argv.slice(2)) {
  const rom = new Uint8Array(readFileSync(file));
  const code = String.fromCharCode(...rom.slice(0xac, 0xb0));
  const adapter = new Gen3StateAdapter(romReader(rom), rom);
  const cat = new MapCatalog();
  const groups = cat.findMapGroupsByStructure(rom);
  const lengths = cat.deriveGroupLengths(rom, groups, new Array(V[code] ?? 34).fill(0));

  let maps = 0, identOk = 0, identBad = 0, firstBad = null;
  let borderCells = 0, borderPixels = 0, borderLost = 0;
  let battleMaps = 0, battleChanged = 0;

  for (let g = 0; g < lengths.length; g++) {
    const gp = u32(rom, groups - BASE + g * 4); if (!vp(rom, gp, 4)) continue;
    for (let m = 0; m < lengths[g]; m++) {
      const hdr = u32(rom, gp - BASE + m * 4); if (!cat.isPlausibleMapHeader(rom, hdr)) continue;
      const lay = u32(rom, hdr - BASE), lo = lay - BASE;
      const map = {
        mapGroup: g, mapNumber: m, width: u32(rom, lo), height: u32(rom, lo + 4),
        mapDataAddress: u32(rom, lo + 0x0c), primaryTilesetAddress: u32(rom, lo + 0x10),
        secondaryTilesetAddress: u32(rom, lo + 0x14),
      };
      const rd = adapter.getMapRenderData(map.mapDataAddress, map.width, map.height,
        map.primaryTilesetAddress, map.secondaryTilesetAddress);
      if (!rd) continue;
      maps++;

      const baked = bake(map, rd);
      const ids = new Uint16Array(map.width * map.height);
      for (let i = 0; i < ids.length; i++) ids[i] = rd.blocks[i]?.metatileId ?? 0;

      // VRAM == ROM
      const vram = new Uint8Array(1024 * 32);
      const anim = new TileAnimator(vramReader(vram), adapter);
      const baseTex = { image: { data: new Uint8Array(baked.base.length) }, needsUpdate: false };
      const overTex = { image: { data: new Uint8Array(baked.over.length) }, needsUpdate: false };
      const log = console.log; console.log = () => {};
      anim.setActiveMap(`${g}:${m}`, map, ids, baseTex, overTex);
      console.log = log;
      for (const [t, idx] of anim.romTiles) packTile(vram, t, idx);

      // ---- 1. identidade ----
      for (const r of anim.recipes) anim.paintRecipe(r);
      let diff = 0;
      for (let i = 0; i < baked.base.length; i++) {
        if (baked.base[i] !== baseTex.image.data[i]) diff++;
        if (baked.over[i] !== overTex.image.data[i]) diff++;
      }
      if (diff === 0) identOk++; else { identBad++; if (!firstBad) firstBad = `${g}:${m} (${diff} bytes)`; }

      // ---- 2. borda: trocar conteudo de tiles >= 416 ----
      const animTiles = anim.referencedTiles.filter((t) => t >= 416 && t < 512);
      if (animTiles.length) {
        const before = { base: Uint8Array.from(baseTex.image.data) };
        for (const t of animTiles) {
          const idx = anim.romTiles.get(t);
          const changed = Uint8Array.from(idx, (v) => (v === 0 ? 0 : ((v % 15) + 1))); // outra cor, mesma transparencia
          packTile(vram, t, changed);
        }
        anim.lastPollAt = 0;
        console.log = () => {}; anim.update(); console.log = log;
        // conferir celulas COVERED com camada de baixo animada
        const W = map.width;
        for (const r of anim.recipes) {
          if (r.overlay || r.layers.length < 2) continue;
          const top = r.layers[r.layers.length - 1];
          const bottom = r.layers[r.layers.length - 2];
          if (!animTiles.includes(bottom.tileId) || animTiles.includes(top.tileId)) continue;
          const topIdx = anim.romTiles.get(top.tileId); const pal = anim.palettes[top.palette];
          if (!topIdx || !pal) continue;
          borderCells++;
          for (const bi of r.blocks) {
            const bx = bi % W, by = Math.floor(bi / W);
            const qx = (r.quadrant % 2) * 8, qy = Math.floor(r.quadrant / 2) * 8;
            for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
              const sx = top.hFlip ? 7 - x : x, sy = top.vFlip ? 7 - y : y;
              const ci = topIdx[sy * 8 + sx]; if (ci === 0) continue;
              const ty = (map.height - 1 - by) * PX + PX - 1 - (qy + y), tx = bx * PX + qx + x;
              const o = (ty * baked.w + tx) * 4;
              borderPixels++;
              const d = baseTex.image.data;
              if (d[o] !== pal[ci * 3] || d[o + 1] !== pal[ci * 3 + 1] || d[o + 2] !== pal[ci * 3 + 2]) borderLost++;
            }
          }
        }

        // ---- 3. batalha: tiles baixos sobrescritos ----
        const snapshot = Uint8Array.from(baseTex.image.data);
        // batalha real: a caixa de texto e carregada no inicio do charblock 0,
        // sobrescrevendo a faixa baixa inteira - nao so os tiles que o mapa usa
        for (let t = 0; t < 416; t++) for (let i = 0; i < 32; i++) vram[t * 32 + i] = (t * 7 + i * 13) & 0xff;
        for (const t of animTiles) packTile(vram, t, anim.romTiles.get(t)); // e mais uma mudanca "animada"
        anim.lastPollAt = 0;
        console.log = () => {}; anim.update(); console.log = log;
        battleMaps++;
        for (let i = 0; i < snapshot.length; i++) if (snapshot[i] !== baseTex.image.data[i]) { battleChanged++; break; }
      }
    }
  }
  console.log('='.repeat(70));
  console.log(file.split('/').pop(), '|', code);
  console.log(`  1. IDENTIDADE com o mapa assado: ${identOk}/${maps} mapas identicos byte a byte` +
    (identBad ? `  <<< ${identBad} divergem, ex ${firstBad}` : '  (OK)'));
  console.log(`  2. BORDA (camada de cima COVERED sobre agua animada): ${borderCells} celulas, ` +
    `${borderPixels} pixels, perdidos: ${borderLost}` + (borderLost ? '  <<< BUG' : '  (OK)'));
  console.log(`  3. BATALHA simulada: mapas testados ${battleMaps}, mapas alterados: ${battleChanged}` +
    (battleChanged ? '  <<< BUG' : '  (OK)'));
}
