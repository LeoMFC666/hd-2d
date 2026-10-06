import { Gen3StateAdapter } from '../src/gen3/Gen3StateAdapter';
import type { MemoryReader } from '../src/gen3/MemoryReader';
import { MapCatalog } from '../src/gen3/world/MapCatalog';
import { MapWorld } from '../src/gen3/world/MapWorld';

const BASE=0x08000000;
class Reader implements MemoryReader{
 constructor(private rom:Uint8Array){}
 readU8(a:number){const o=a-BASE;return o>=0&&o<this.rom.length?this.rom[o]:0}
 readU16(a:number){return this.readU8(a)|(this.readU8(a+1)<<8)}
 readU32(a:number){return (this.readU8(a)|this.readU8(a+1)<<8|this.readU8(a+2)<<16|this.readU8(a+3)*0x1000000)>>>0}
 readRange(a:number,n:number){const o=new Uint8Array(n);for(let i=0;i<n;i++)o[i]=this.readU8(a+i);return o}
}
function u8(rom:Uint8Array,o:number){return o>=0&&o<rom.length?rom[o]:0}
function u16(rom:Uint8Array,o:number){return u8(rom,o)|(u8(rom,o+1)<<8)}
function u32(rom:Uint8Array,o:number){return (u8(rom,o)|u8(rom,o+1)<<8|u8(rom,o+2)<<16|u8(rom,o+3)*0x1000000)>>>0}
function isPtr(rom:Uint8Array,a:number,size=1){const o=a-BASE;return o>=0&&o+size<=rom.length}
function findPallet(rom:Uint8Array){
 for(let off=0;off<=rom.length-0x1c;off+=4){
  const la=u32(rom,off);if(!isPtr(rom,la,0x18))continue;const lo=la-BASE;
  if(u32(rom,lo)!==24||u32(rom,lo+4)!==20)continue;
  const cp=u32(rom,off+0x0c);if(!isPtr(rom,cp,8))continue;const co=cp-BASE,n=u32(rom,co)|0;if(n<2||n>64)continue;
  const da=u32(rom,co+4)-BASE;if(da<0||da+n*0xc>rom.length)continue;
  let r1=false,r21=false;
  for(let i=0;i<n;i++){const e=da+i*0xc,d=u8(rom,e),o=u32(rom,e+4)|0,g=u8(rom,e+8),m=u8(rom,e+9);if(d===2&&g===3&&m===19&&o===0)r1=true;if(d===1&&g===3&&m===39&&o===0)r21=true}
  if(r1&&r21)return {mapLayoutAddress:la,mapLayoutId:u16(rom,off+0x12)};
 }
 throw new Error('Pallet anchor not found');
}
function hashData(data:any,map:any){
 let h=2166136261;
 for(const b of data.blocks){h^=b.metatileId&0xffff;h=Math.imul(h,16777619)}
 for(const id of [...data.graphics.keys()].sort((a:number,b:number)=>a-b)){
  const g=data.graphics.get(id);if(!g)continue;
  for(let i=0;i<g.basePixels.length;i++){h^=g.basePixels[i];h=Math.imul(h,16777619)}
 }
 return h>>>0;
}
async function main(){
 const rom=new Uint8Array(await (await fetch('/Pokemon - FireRed Version (USA, Europe) (Rev 1).gba')).arrayBuffer());
 const cat=new MapCatalog();if(cat.buildGen3FromRom(rom,{mapGroup:3,mapNumber:0,...findPallet(rom)})!==425)throw new Error('catalog failed');
 const world=new MapWorld(cat);if(world.buildFrom(3,0)!==37)throw new Error('world failed');
 const adapter=new Gen3StateAdapter(new Reader(rom),rom);
 const results:any[]=[];
 for(const map of world.getPositionedMaps()){
  const data=adapter.getMapRenderData(map.mapDataAddress,map.width,map.height,map.primaryTilesetAddress,map.secondaryTilesetAddress);
  if(!data)throw new Error('render null '+map.mapGroup+':'+map.mapNumber);
  results.push({key:map.mapGroup+':'+map.mapNumber,width:map.width,height:map.height,hash:hashData(data,map)});
 }
 const cin=results.find(x=>x.key==='3:8')!;
 const matches=results.filter(x=>x.hash===cin.hash).map(x=>x.key);
 const result={pass:matches.length===1,catalogCount:cat.getAll().length,connectedCount:results.length,cinnabar:cin,matches,uniqueCinnabar:matches.length===1,all:results};
 document.querySelector('#out')!.textContent=JSON.stringify(result,null,2);document.body.dataset.pass=result.pass?'true':'false';
}
main().catch(e=>{document.querySelector('#out')!.textContent=JSON.stringify({pass:false,error:String(e)},null,2);document.body.dataset.pass='false';throw e});
