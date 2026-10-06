import { MapCatalog } from '../src/gen3/world/MapCatalog';
import { MapWorld } from '../src/gen3/world/MapWorld';

const BASE=0x08000000;
let rom:Uint8Array;
function u8(o:number){return o>=0&&o<rom.length?rom[o]:0}
function u32(o:number){return (u8(o)|u8(o+1)<<8|u8(o+2)<<16|u8(o+3)*0x1000000)>>>0}
function isPtr(a:number,size=1){const o=a-BASE;return o>=0&&o+size<=rom.length}
function anchor(){
 for(let off=0;off<=rom.length-0x1c;off+=4){
  const la=u32(off);
  if(!isPtr(la,0x18))continue;
  const lo=la-BASE;
  if(u32(lo)!==24||u32(lo+4)!==20)continue;
  const cp=u32(off+0x0c);
  if(!isPtr(cp,8))continue;
  const co=cp-BASE,n=u32(co)|0;if(n<2||n>64)continue;
  const da=u32(co+4)-BASE;if(da<0||da+n*0xc>rom.length)continue;
  let r1=false,r21=false;
  for(let i=0;i<n;i++){const e=da+i*0xc;const d=u8(e),o=u32(e+4)|0,g=u8(e+8),m=u8(e+9);if(d===2&&g===3&&m===19&&o===0)r1=true;if(d===1&&g===3&&m===39&&o===0)r21=true}
  if(r1&&r21)return {mapLayoutAddress:la,mapLayoutId:u8(off+0x12)|u8(off+0x13)<<8};
 }
 throw new Error('Pallet anchor not found');
}
async function main(){
 rom=new Uint8Array(await (await fetch('/Pokemon - FireRed Version (USA, Europe) (Rev 1).gba')).arrayBuffer());
 const a=anchor();const cat=new MapCatalog();const count=cat.buildGen3FromRom(rom,{mapGroup:3,mapNumber:0,...a});
 if(count!==425)throw new Error('catalog='+count);
 const world=new MapWorld(cat);const connected=world.buildFrom(3,0);
 if(connected!==37)throw new Error('connected='+connected);
 const rects=world.getPositionedMaps().map(m=>{const p=world.getWorldPosition(m.mapGroup,m.mapNumber)!;return {key:m.mapGroup+':'+m.mapNumber,x:p.x,y:p.y,w:m.width,h:m.height}});
 const overlaps:any[]=[];
 for(let i=0;i<rects.length;i++)for(let j=i+1;j<rects.length;j++){const a=rects[i],b=rects[j];const ox=Math.min(a.x+a.w,b.x+b.w)-Math.max(a.x,b.x),oy=Math.min(a.y+a.h,b.y+b.h)-Math.max(a.y,b.y);if(ox>0&&oy>0)overlaps.push({a:a.key,b:b.key,ox,oy})}
 const cin=rects.find(x=>x.key==='3:8')!;
 const result={pass:overlaps.length===0,catalogCount:count,connectedCount:connected,overlapCount:overlaps.length,cinnabar:cin,overlaps:overlaps.slice(0,20)};
 document.querySelector('#out')!.textContent=JSON.stringify(result,null,2);document.body.dataset.pass=result.pass?'true':'false';
}
main().catch(e=>{document.querySelector('#out')!.textContent=JSON.stringify({pass:false,error:String(e)},null,2);document.body.dataset.pass='false';throw e});
