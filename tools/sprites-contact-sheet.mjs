// Localiza as tabelas de sprites do overworld pela estrutura do ROM e gera
// uma folha de contato PNG com o quadro 0 de cada graphicsId - para OLHAR
// e confirmar que tabela, paleta e decodificacao estao certas.
import { readFileSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const BASE = 0x08000000;
const u16 = (r, o) => r[o] | (r[o + 1] << 8);
const s16 = (r, o) => { const v = u16(r, o); return v >= 0x8000 ? v - 0x10000 : v; };
const u32 = (r, o) => (r[o] | (r[o + 1] << 8) | (r[o + 2] << 16) | (r[o + 3] << 24)) >>> 0;
const vp = (r, a, s) => a >= BASE && a - BASE + s <= r.length;

export function validInfo(rom, addr) {
  if (!vp(rom, addr, 0x24)) return false;
  const o = addr - BASE;
  const size = u16(rom, o + 6), w = s16(rom, o + 8), h = s16(rom, o + 10);
  if (w < 8 || h < 8 || w > 128 || h > 128 || w % 8 || h % 8) return false;
  // 'size' e a reserva de VRAM (o jogador reserva o maior quadro de todas
  // as suas formas), nao o tamanho do quadro: so precisa caber o quadro.
  if (size < (w * h) >> 1 || size > 0x2000) return false;
  const oam = u32(rom, o + 0x10), anims = u32(rom, o + 0x18), images = u32(rom, o + 0x1c);
  if (!vp(rom, oam, 8) || !vp(rom, anims, 4) || !vp(rom, images, 8)) return false;
  const io = images - BASE, data = u32(rom, io), isize = u16(rom, io + 4);
  // o QUADRO, este sim, tem exatamente largura x altura / 2 bytes (4bpp)
  return vp(rom, data, isize) && isize === (w * h) >> 1;
}

// Validacao estrutural (sem conferir tamanho de quadro): serve para
// DELIMITAR a tabela. Algumas entradas legitimas tem o quadro 0 menor que
// as dimensoes declaradas (ex.: arvores de berry, cujo primeiro quadro e o
// montinho de terra), e a validacao completa quebraria a sequencia.
export function structuralInfo(rom, addr) {
  if (!vp(rom, addr, 0x24)) return false;
  const o = addr - BASE, w = s16(rom, o + 8), h = s16(rom, o + 10);
  if (w < 8 || h < 8 || w > 128 || h > 128 || w % 8 || h % 8) return false;
  return vp(rom, u32(rom, o + 0x10), 8) && vp(rom, u32(rom, o + 0x18), 4) && vp(rom, u32(rom, o + 0x1c), 8);
}

export function findGraphicsTable(rom) {
  let best = null, start = -1, count = 0, strong = 0;
  const close = () => {
    // exige que a grande maioria passe na validacao completa
    if (count >= 32 && strong / count >= 0.9 && (!best || count > best.count)) best = { addr: BASE + start, count, strong };
    start = -1; count = 0; strong = 0;
  };
  for (let o = 0; o + 4 <= rom.length; o += 4) {
    const a = u32(rom, o);
    if (structuralInfo(rom, a)) { if (start < 0) start = o; count++; if (validInfo(rom, a)) strong++; }
    else close();
  }
  close();
  return best;
}

export function findPaletteTable(rom, tags) {
  let best = null;
  for (let o = 0; o + 8 <= rom.length; o += 4) {
    let n = 0; const seen = new Set();
    while (o + n * 8 + 8 <= rom.length) {
      const p = u32(rom, o + n * 8), tag = u16(rom, o + n * 8 + 4);
      // tags de paleta de objeto ficam em 0x11xx; a tabela tem entradas
      // (reflexo etc.) que nenhum grafico usa diretamente
      if (!vp(rom, p, 32) || (tag & 0xff00) !== 0x1100) break;
      seen.add(tag); n++;
    }
    const covered = [...tags].filter((t) => seen.has(t)).length;
    if (n >= 4 && (!best || covered > best.covered)) best = { addr: BASE + o, count: n, distinct: seen.size, covered };
    if (n) o += (n - 1) * 8; // pula a sequencia ja medida
  }
  return best;
}

function png(w, h, rgba) {
  const crcT = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
  const crc = (b) => { let c = -1; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
  const chunk = (t, d) => { const b = Buffer.alloc(12 + d.length); b.writeUInt32BE(d.length, 0); b.write(t, 4); d.copy(b, 8); b.writeUInt32BE(crc(b.subarray(4, 8 + d.length)), 8 + d.length); return b; };
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 4 + 1)] = 0; Buffer.from(rgba.buffer, rgba.byteOffset + y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1); }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

if (process.argv[2]) {
  for (const file of process.argv.slice(2, -1)) {
    const rom = new Uint8Array(readFileSync(file));
    const code = String.fromCharCode(...rom.slice(0xac, 0xb0));
    const t = findGraphicsTable(rom);
    const infos = [];
    for (let i = 0; i < t.count; i++) infos.push(u32(rom, t.addr - BASE + i * 4));
    const tags = new Set(infos.map((a) => u16(rom, a - BASE + 2)).filter((t) => (t & 0xff00) === 0x1100));
    const pt = findPaletteTable(rom, tags);
    const palByTag = new Map();
    for (let i = 0; i < pt.count; i++) palByTag.set(u16(rom, pt.addr - BASE + i * 8 + 4), u32(rom, pt.addr - BASE + i * 8));
    const before = u32(rom, t.addr - BASE - 4);
    console.log('='.repeat(64));
    console.log(file.split('/').pop(), '|', code);
    console.log(`  graficos : 0x${t.addr.toString(16)}  ${t.count} entradas (${t.strong} com validacao completa)  (anterior estrutural? ${structuralInfo(rom, before)})`);
    console.log(`  paletas  : 0x${pt.addr.toString(16)}  ${pt.count} entradas, ${pt.distinct} tags distintas de ${tags.size} usadas`);
    const missing = [...tags].filter((x) => !palByTag.has(x));
    console.log(`  tags sem paleta: ${missing.length ? missing.map((x) => '0x' + x.toString(16)).join(',') : 'nenhuma'}`);

    // folha de contato: quadro 0 de cada id, em celulas 64x64, 16 por linha
    const CELL = 64, COLS = 16, rows = Math.ceil(t.count / COLS);
    const W = CELL * COLS, H = CELL * rows, sheet = new Uint8Array(W * H * 4);
    for (let i = 0; i < sheet.length; i += 4) { sheet[i] = 40; sheet[i + 1] = 44; sheet[i + 2] = 52; sheet[i + 3] = 255; }
    infos.forEach((info, id) => {
      const o = info - BASE, w = s16(rom, o + 8), h = s16(rom, o + 10), tag = u16(rom, o + 2);
      const img = u32(rom, o + 0x1c) - BASE, data = u32(rom, img) - BASE;
      const pal = palByTag.get(tag); if (pal === undefined) return;
      const cx = (id % COLS) * CELL, cy = Math.floor(id / COLS) * CELL;
      const sc = Math.max(1, Math.floor(Math.min((CELL - 4) / w, (CELL - 4) / h)));
      for (let y = 0; y < Math.min(h, CELL); y++) for (let x = 0; x < Math.min(w, CELL); x++) {
        const tile = (y >> 3) * (w >> 3) + (x >> 3);
        const byte = rom[data + tile * 32 + (y & 7) * 4 + ((x & 7) >> 1)];
        const ci = x & 1 ? byte >> 4 : byte & 15; if (!ci) continue;
        const c = u16(rom, pal - BASE + ci * 2);
        const r5 = c & 31, g5 = (c >> 5) & 31, b5 = (c >> 10) & 31;
        for (let dy = 0; dy < sc; dy++) for (let dx = 0; dx < sc; dx++) {
          const px = cx + 2 + x * sc + dx, py = cy + 2 + y * sc + dy;
          if (px >= cx + CELL || py >= cy + CELL) continue;
          const d = (py * W + px) * 4;
          sheet[d] = (r5 << 3) | (r5 >> 2); sheet[d + 1] = (g5 << 3) | (g5 >> 2); sheet[d + 2] = (b5 << 3) | (b5 >> 2); sheet[d + 3] = 255;
        }
      }
    });
    const out = process.argv[process.argv.length - 1] + '-' + code + '-' + file.split('/').pop().slice(0, 12).replace(/\W/g, '') + '.png';
    writeFileSync(out, png(W, H, sheet));
    console.log('  folha:', out);
  }
}
