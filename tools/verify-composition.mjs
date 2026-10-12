// Confere que as receitas do animador (TileAnimator) reproduzem byte a byte
// as texturas compostas no carregamento (GroundSubstitution.
// composeMapTextures): chao, camada de cima do chao e modelos em pe - com
// a VRAM igual ao ROM, recompor tudo nao pode mudar nenhum pixel. Pega
// receita errada (flor recortada, chao trocado debaixo de arvore).
//
// Monte o pacote b8.mjs como em render-world.mjs, com mais a linha
//   export { TileAnimator } from '<repo>/src/render/TileAnimator';
// Uso: node verify-composition.mjs <rom> <grupo> <mapa> [<grupo> <mapa> ...]
import { readFileSync } from 'node:fs';
import { Gen3StateAdapter, MapCatalog, buildMapVolume, composeMapTextures, animationLayers, TileAnimator } from './b8.mjs';
const BASE=0x08000000;
const u16=(r,o)=>r[o]|(r[o+1]<<8),u32=(r,o)=>(r[o]|(r[o+1]<<8)|(r[o+2]<<16)|(r[o+3]<<24))>>>0;
function romReader(rom){const u8=a=>a>=BASE&&a-BASE<rom.length?rom[a-BASE]:0;return{readU8:u8,readU16:a=>u8(a)|(u8(a+1)<<8),readU32:a=>(u8(a)|(u8(a+1)<<8)|(u8(a+2)<<16)|(u8(a+3)<<24))>>>0,readRange:(a,n)=>{const o=new Uint8Array(n);for(let i=0;i<n;i++)o[i]=u8(a+i);return o;}};}
const [file,...pairs]=process.argv.slice(2);
const rom=new Uint8Array(readFileSync(file)); const cat=new MapCatalog(); const ad=new Gen3StateAdapter(romReader(rom),rom);
const code=String.fromCharCode(...rom.slice(0xac,0xb0)); const frlg=code.startsWith('BPR')||code.startsWith('BPG'); const primaryCount=frlg?640:512;
const groups=cat.findMapGroupsByStructure(rom);
const log=console.log; let failures=0;
for(let p=0;p<pairs.length;p+=2){
  const G=+pairs[p],M=+pairs[p+1];
  const hdr=u32(rom,u32(rom,groups-BASE+G*4)-BASE+M*4), lo=u32(rom,hdr-BASE)-BASE;
  const W=u32(rom,lo),H=u32(rom,lo+4); const border=cat.readBorder(rom,lo,frlg);
  const borderRaw=[];for(let i=0;i<border.borderWidth*border.borderHeight;i++)borderRaw.push(u16(rom,border.borderAddress-BASE+i*2)&0x3ff);
  console.log=()=>{};
  const rd=ad.getMapRenderData(u32(rom,lo+12),W,H,u32(rom,lo+16),u32(rom,lo+20),borderRaw);
  const op=px=>{for(let i=3;i<px.length;i+=4)if(px[i]>127)return true;return false;};
  const reach=px=>{for(let i=15*64+3;i<px.length;i+=4)if(px[i]>127)return true;return false;};
  const blockAt=(xx,y)=>{const b=rd.blocks[y*W+xx];if(!b)return undefined;const gr=rd.graphics.get(b.metatileId);return {...b,behavior:gr?.behavior??0,hasForeground:!!gr&&op(gr.foregroundPixels),topReachesBottom:gr?reach(gr.topPixels):undefined,flower:b.metatileId<primaryCount&&!!gr&&gr.topTileIds.some(t=>t>=508&&t<=511),basePixels:gr?.basePixels,pixels:gr?.pixels,secondary:b.metatileId>=primaryCount};};
  const type=rom[hdr-BASE+0x17]; const style=(type===8||type===9)?'interior':'outdoor';
  const vol=buildMapVolume(W,H,blockAt,cat.readWarps(rom,hdr),style,2,new Set(borderRaw));
  const artAt=(xx,y)=>{const b=rd.blocks[y*W+xx];const gr=b&&rd.graphics.get(b.metatileId);return gr?{base:gr.basePixels,foreground:gr.foregroundPixels,bottom:gr.bottomPixels,top:gr.topPixels,merged:gr.pixels}:undefined;};
  const comp=composeMapTextures(W,H,vol.kinds,vol.groundSources,artAt);
  const layers=animationLayers(W,H,vol.kinds,vol.groundSources,(i)=>rd.blocks[i]?.metatileId??-1);
  const names=['chao','overlay','modelos']; const textures=[comp.groundBase,comp.groundOverlay,comp.model].map(px=>({image:{data:new Uint8Array(px)},needsUpdate:false}));
  const anim=new TileAnimator(romReader(rom),ad);
  anim.setActiveMap(`${G}:${M}`,{width:W,height:H,primaryTilesetAddress:u32(rom,lo+16),secondaryTilesetAddress:u32(rom,lo+20)},[layers.groundBase,layers.groundOverlay,layers.model].map((l,i)=>({texture:textures[i],...l})));
  for(const r of anim.recipes)anim.paintRecipe(r);
  console.log=log;
  const res=[];
  [comp.groundBase,comp.groundOverlay,comp.model].forEach((ref,i)=>{const got=textures[i].image.data;let diff=0,cells=new Set();for(let k=0;k<ref.length;k++)if(ref[k]!==got[k]){diff++;const px=(k>>2)%(W*16),row=Math.floor((k>>2)/(W*16));cells.add(Math.floor(px/16)+','+(H-1-Math.floor(row/16)));}
    res.push(`${names[i]}: ${diff===0?'ok':diff+' bytes diferentes em '+cells.size+' blocos ('+[...cells].slice(0,6).join(' ')+')'}`); if(diff)failures++;});
  const n=[0,0,0,0,0,0,0,0];for(const v of vol.kinds)n[v]++;
  log(`${G}:${M} ${W}x${H} receitas ${anim.recipes.length} flores ${n[7]} | ${res.join(' | ')}`);
}
process.exit(failures?1:0);
