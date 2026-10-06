import fs from 'node:fs';
import { MapCatalog } from '../src/gen3/world/MapCatalog';
import { MapWorld } from '../src/gen3/world/MapWorld';

const BASE=0x08000000;
const rom=new Uint8Array(fs.readFileSync('Pokemon - FireRed Version (USA, Europe) (Rev 1).gba'));
function u8(o:number){return rom[o]??0}
function u16(o:number){return u8(o)|(u8(o+1)<<8)}
function u32(o:number){return (u8(o)|(u8(o+1)<<8)|(u8(o+2)<<16)|(u8(o+3)*0x1000000))>>>0}
function i32(o:number){return u32(o)|0}
function isPtr(a:number,size=1){const o=a-BASE;return o>=0&&o+size<=rom.length}
function readConns(h:number){
 const p=u32(h-BASE+0x0c); if(!p)return [];
 if(!isPtr(p,8))return null;
 const o=p-BASE,n=i32(o),d=u32(o+4); if(n<0||n>64||!isPtr(d,n*0xc))return null;
 const out:any[]=[]; const doff=d-BASE;
 for(let i=0;i<n;i++){const e=doff+i*0xc;out.push({direction:u8(e),offset:i32(e+4),mapGroup:u8(e+8),mapNumber:u8(e+9)})}
 return out;
}
let anchor:any=null;
for(let o=0;o+0x1c<=rom.length;o+=4){
 const la=u32(o); if(!isPtr(la,0x18))continue;
 const lo=la-BASE; if(u32(lo)!==24||u32(lo+4)!==20)continue;
 const c=readConns(BASE+o); if(!c)continue;
 if(c.some((x:any)=>x.direction===2&&x.mapGroup===3&&x.mapNumber===19&&x.offset===0)&&c.some((x:any)=>x.direction===1&&x.mapGroup===3&&x.mapNumber===39&&x.offset===0)){
  anchor={mapGroup:3,mapNumber:0,mapLayoutId:u16(o+0x12),mapLayoutAddress:la,header:BASE+o};break;
 }
}
if(!anchor)throw new Error('anchor missing');
const catalog=new MapCatalog(); const count=catalog.buildGen3FromRom(rom,anchor);
const world=new MapWorld(catalog); const connected=world.buildFrom(3,0);
const rects=world.getPositionedMaps().map(m=>{const p=world.getWorldPosition(m.mapGroup,m.mapNumber)!;return {key:m.mapGroup+':'+m.mapNumber,x:p.x,y:p.y,w:m.width,h:m.height,mapData:'0x'+m.mapDataAddress.toString(16)}})
const overlaps:any[]=[];
for(let i=0;i<rects.length;i++)for(let j=i+1;j<rects.length;j++){
 const a=rects[i],b=rects[j];
 const ox=Math.min(a.x+a.w,b.x+b.w)-Math.max(a.x,b.x);
 const oy=Math.min(a.y+a.h,b.y+b.h)-Math.max(a.y,b.y);
 if(ox>0&&oy>0)overlaps.push({a,b,overlapX:ox,overlapY:oy});
}
const cin=rects.find(r=>r.key==='3:8');
console.log(JSON.stringify({count,connected,cin,overlapCount:overlaps.length,overlaps},null,2));
