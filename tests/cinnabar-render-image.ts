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
function u8(rom:Uint8Array,o:number){return rom[o]??0}
function u16(rom:Uint8Array,o:number){return u8(rom,o)|(u8(rom,o+1)<<8)}
function u32(rom:Uint8Array,o:number){return (u8(rom,o)|u8(rom,o+1)<<8|u8(rom,o+2)<<16|u8(rom,o+3)*0x1000000)>>>0}
function isPtr(rom:Uint8Array,a:number,size=1){const o=a-BASE;return o>=0&&o+size<=rom.length}
function i32(rom:Uint8Array,o:number){return u32(rom,o)|0}
function findPallet(rom:Uint8Array){
 for(let o=0;o+0x1c<=rom.length;o+=4){
  const la=u32(rom,o); if(!isPtr(rom,la,0x18))continue;
  const lo=la-BASE;if(u32(rom,lo)!==24||u32(rom,lo+4)!==20)continue;
  const p=u32(rom,o+0xc); if(p<BASE||!isPtr(rom,p,8))continue;
  const co=p-BASE,n=i32(rom,co),d=u32(rom,co+4); if(n<2||n>64||!isPtr(rom,d,n*0xc))continue;
  const doff=d-BASE;let a=false,b=false;
  for(let i=0;i<n;i++){const e=doff+i*0xc,dir=u8(rom,e),off=i32(rom,e+4),g=u8(rom,e+8),m=u8(rom,e+9);if(dir===2&&off===0&&g===3&&m===19)a=true;if(dir===1&&off===0&&g===3&&m===39)b=true}
  if(a&&b)return {mapLayoutAddress:la,mapLayoutId:u16(rom,o+0x12)};
 }
 return null;
}
function draw(data:any,width:number,height:number){
 const canvas=document.querySelector<HTMLCanvasElement>('#map')!;
 const ctx=canvas.getContext('2d')!;
 canvas.width=width*16;canvas.height=height*16;
 const image=ctx.createImageData(canvas.width,canvas.height);
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  const block=data.blocks[y*width+x]; if(!block)continue;
  const g=data.graphics.get(block.metatileId); if(!g)continue;
  for(let sy=0;sy<16;sy++)for(let sx=0;sx<16;sx++){
   const sy2=height*16-1-(y*16+16-1-sy); // preserve source orientation exactly
   const dx=x*16+sx;
   const dy=(height-1-y)*16+(15-sy);
   const si=(sy*16+sx)*4,di=(dy*canvas.width+dx)*4;
   image.data[di]=g.pixels[si];image.data[di+1]=g.pixels[si+1];image.data[di+2]=g.pixels[si+2];image.data[di+3]=g.pixels[si+3];
   void sy2;
  }
 }
 ctx.putImageData(image,0,0);
}
async function main(){
 const rom=new Uint8Array(await (await fetch('/Pokemon - FireRed Version (USA, Europe) (Rev 1).gba')).arrayBuffer());
 const a=findPallet(rom);if(!a)throw new Error('Pallet anchor not found');
 const c=new MapCatalog();if(c.buildGen3FromRom(rom,{mapGroup:3,mapNumber:0,...a})!==425)throw new Error('catalog failed');
 const cin=c.get(3,8);if(!cin)throw new Error('Cinnabar missing');
 const adapter=new Gen3StateAdapter(new RomReader(rom),rom);
 const data=adapter.getMapRenderData(cin.mapDataAddress,cin.width,cin.height,cin.primaryTilesetAddress,cin.secondaryTilesetAddress);
 if(!data)throw new Error('Cinnabar render data null');
 draw(data,cin.width,cin.height);
 document.querySelector('#out')!.textContent=JSON.stringify({pass:true,mapData:'0x'+cin.mapDataAddress.toString(16),layout:'0x'+cin.mapLayoutAddress.toString(16),primary:'0x'+cin.primaryTilesetAddress.toString(16),secondary:'0x'+cin.secondaryTilesetAddress.toString(16),beta:'0x'+(BASE+0x338378).toString(16),dimensions:[cin.width,cin.height]},null,2);
 document.body.dataset.pass='true';
}
main().catch(e=>{document.querySelector('#out')!.textContent=JSON.stringify({pass:false,error:String(e)},null,2);document.body.dataset.pass='false';throw e});
