// Usa a CLASSE REAL OverworldSprites e desenha: para cada direcao, o quadro
// parado + 4 instantes da caminhada, para alguns ids. Uma linha por (id,dir).
import { readFileSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { OverworldSprites } from './b5/OverworldSprites.js';
function png(w,h,rgba){const T=new Int32Array(256).map((_,n)=>{let c=n;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;return c;});const crc=b=>{let c=-1;for(const x of b)c=T[(c^x)&255]^(c>>>8);return(c^-1)>>>0;};const ch=(t,d)=>{const b=Buffer.alloc(12+d.length);b.writeUInt32BE(d.length,0);b.write(t,4);d.copy(b,8);b.writeUInt32BE(crc(b.subarray(4,8+d.length)),8+d.length);return b;};const raw=Buffer.alloc((w*4+1)*h);for(let y=0;y<h;y++){raw[y*(w*4+1)]=0;Buffer.from(rgba.buffer,y*w*4,w*4).copy(raw,y*(w*4+1)+1);}const ih=Buffer.alloc(13);ih.writeUInt32BE(w,0);ih.writeUInt32BE(h,4);ih[8]=8;ih[9]=6;return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),ch('IHDR',ih),ch('IDAT',deflateSync(raw)),ch('IEND',Buffer.alloc(0))]);}
const [file, out, ...ids] = process.argv.slice(2);
const rom = new Uint8Array(readFileSync(file));
const s = new OverworldSprites(rom);
const t0 = Date.now(); s.ensureLocated(); console.log('localizacao:', Date.now() - t0, 'ms');
const DIRS = ['DOWN','UP','LEFT','RIGHT'];
const CELL = 36, SC = 1, cols = 5, rows = ids.length * 4;
const W = CELL * cols, H = CELL * rows, sheet = new Uint8Array(W*H*4);
for (let i=0;i<sheet.length;i+=4){sheet[i]=40;sheet[i+1]=44;sheet[i+2]=52;sheet[i+3]=255;}
const keys = [];
ids.map(Number).forEach((id, k) => DIRS.forEach((dir, d) => {
  const shots = [s.getFrame(id, dir, false, 0), ...[0, 9, 17, 25].map(f => s.getFrame(id, dir, true, f * 1000/60 + 1))];
  keys.push(`${id} ${dir.padEnd(5)}: ` + shots.map(f => f ? f.key : 'null').join('  '));
  shots.forEach((f, c) => {
    if (!f) return;
    const ox = c*CELL + 2, oy = (k*4+d)*CELL + 2;
    for (let y=0;y<f.height;y++) for (let x=0;x<f.width;x++) {
      const src = ((f.height-1-y)*f.width + x)*4;   // rgba vem de baixo para cima
      if (!f.rgba[src+3]) continue;
      const px=ox+x, py=oy+y; if (px>=W||py>=H) continue;
      const dd=(py*W+px)*4; sheet[dd]=f.rgba[src]; sheet[dd+1]=f.rgba[src+1]; sheet[dd+2]=f.rgba[src+2]; sheet[dd+3]=255;
    }
  });
}));
writeFileSync(out, png(W, H, sheet));
console.log(keys.join('\n'));
