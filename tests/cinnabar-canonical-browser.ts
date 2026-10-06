import { MapCatalog } from '../src/gen3/world/MapCatalog';
import { Gen3StateAdapter } from '../src/gen3/Gen3StateAdapter';
import type { MemoryReader } from '../src/gen3/MemoryReader';

const BASE=0x08000000;
class RomReader implements MemoryReader{
 constructor(private rom:Uint8Array){}
 readU8(a:number){const o=a-BASE;return o>=0&&o<this.rom.length?this.rom[o]:0}
 readU16(a:number){return this.readU8(a)|(this.readU8(a+1)<<8)}
 readU32(a:number){return (this.readU8(a)|this.readU8(a+1)<<8|this.readU8(a+2)<<16|this.readU8(a+3)*0x1000000)>>>0}
 readRange(a:number,n:number){const r=new Uint8Array(n);for(let i=0;i<n;i++)r[i]=this.readU8(a+i);return r}
}
function assert(v:unknown,msg:string):asserts v{if(!v)throw new Error(msg)}
function fnv(bytes:Uint8Array){let h=2166136261;for(const b of bytes){h^=b;h=Math.imul(h,16777619)}return h>>>0}
function draw(data:any,w:number,h:number){
 const c=document.querySelector<HTMLCanvasElement>('#map')!,ctx=c.getContext('2d')!;
 const image=ctx.createImageData(w*16,h*16);
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){
  const block=data.blocks[y*w+x];const g=data.graphics.get(block.metatileId);if(!g)continue;
  for(let sy=0;sy<16;sy++)for(let sx=0;sx<16;sx++){
   const dy=(h-1-y)*16+(15-sy),dx=x*16+sx,si=(sy*16+sx)*4,di=(dy*c.width+dx)*4;
   image.data[di]=g.pixels[si];image.data[di+1]=g.pixels[si+1];image.data[di+2]=g.pixels[si+2];image.data[di+3]=g.pixels[si+3];
  }
 }
 ctx.putImageData(image,0,0);
 return new Uint8Array(image.data.buffer);
}
async function main(){
 const rom=new Uint8Array(await (await fetch('/Pokemon - FireRed Version (USA, Europe) (Rev 1).gba')).arrayBuffer());
 const base=new MapCatalog();
 const baseCount=base.buildGen3FromRom(rom,{mapGroup:3,mapNumber:0,mapLayoutId:78,mapLayoutAddress:0x082dd530});
 assert(baseCount===425,'baseline catalog failed');
 const ruin=base.get(3,61);assert(ruin,'Ruin Valley missing');
 const bad={
   mapGroup:3,mapNumber:8,
   mapLayoutId:ruin.mapLayoutId,
   mapLayoutAddress:ruin.mapLayoutAddress,
 };
 const fixed=new MapCatalog();
 const fixedCount=fixed.buildGen3FromRom(rom,bad);
 assert(fixedCount===425,'fixed catalog count '+fixedCount);
 const cin=fixed.get(3,8);assert(cin,'Cinnabar missing');
 assert(cin.mapHeaderAddress===0x08350768,'wrong Cinnabar header '+cin.mapHeaderAddress.toString(16));
 assert(cin.mapLayoutAddress===0x082e3b90,'wrong Cinnabar layout '+cin.mapLayoutAddress.toString(16));
 assert(cin.mapDataAddress===0x082e37d0,'wrong Cinnabar map data '+cin.mapDataAddress.toString(16));
 assert(cin.secondaryTilesetAddress===0x082d4bdc,'wrong Cinnabar secondary '+cin.secondaryTilesetAddress.toString(16));
 const adapter=new Gen3StateAdapter(new RomReader(rom),rom);
 const rendered=adapter.getMapRenderData(cin.mapDataAddress,cin.width,cin.height,cin.primaryTilesetAddress,cin.secondaryTilesetAddress);
 assert(rendered,'Cinnabar render failed');
 const bytes=draw(rendered,cin.width,cin.height);
 const hash=fnv(bytes);
 assert(hash===1144039168,'visual hash mismatch '+hash);
 const out={pass:true,corruptAnchorAccepted:true,catalogCount:fixedCount,cinnabar:{header:'0x'+cin.mapHeaderAddress.toString(16),layout:'0x'+cin.mapLayoutAddress.toString(16),mapData:'0x'+cin.mapDataAddress.toString(16),secondary:'0x'+cin.secondaryTilesetAddress.toString(16)},visualHash:hash};
 document.querySelector('#out')!.textContent=JSON.stringify(out,null,2);
 document.body.dataset.pass='true';
}
main().catch(e=>{document.querySelector('#out')!.textContent=JSON.stringify({pass:false,error:String(e)},null,2);document.body.dataset.pass='false'});
