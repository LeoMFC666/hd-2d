import fs from 'node:fs';
import { MapCatalog } from '../src/gen3/world/MapCatalog';

const BASE = 0x08000000;
const rom = new Uint8Array(fs.readFileSync('Pokemon - FireRed Version (USA, Europe) (Rev 1).gba'));

function u8(o:number){return rom[o] ?? 0}
function u16(o:number){return u8(o)|(u8(o+1)<<8)}
function u32(o:number){return (u8(o)|(u8(o+1)<<8)|(u8(o+2)<<16)|(u8(o+3)*0x1000000))>>>0}
function i32(o:number){return u32(o)|0}
function isPtr(a:number,size=1){const o=a-BASE; return o>=0&&o+size<=rom.length}
function conns(header:number){
 const p=u32(header-BASE+0x0c);
 if(!p)return [];
 if(!isPtr(p,8))return null;
 const o=p-BASE,n=i32(o),d=u32(o+4);
 if(n<0||n>64||!isPtr(d,n*0xc))return null;
 const out:any[]=[];
 const doff=d-BASE;
 for(let i=0;i<n;i++){const e=doff+i*0xc;out.push({direction:u8(e),offset:i32(e+4),mapGroup:u8(e+8),mapNumber:u8(e+9)})}
 return out;
}
function findAnchor(){
 for(let o=0;o+0x1c<=rom.length;o+=4){
  const layout=u32(o);
  if(!isPtr(layout,0x18))continue;
  const lo=layout-BASE;
  if(u32(lo)!==24||u32(lo+4)!==20)continue;
  const c=conns(BASE+o);
  if(!c)continue;
  const ok=c.some(x=>x.direction===2&&x.mapGroup===3&&x.mapNumber===19&&x.offset===0)
    && c.some(x=>x.direction===1&&x.mapGroup===3&&x.mapNumber===39&&x.offset===0);
  if(ok)return {mapLayoutAddress:layout,mapLayoutId:u16(o+0x12),header:BASE+o};
 }
 return null;
}
const anchor=findAnchor();
if(!anchor)throw new Error('Pallet anchor not found');
const catalog=new MapCatalog();
const count=catalog.buildGen3FromRom(rom,{
 mapGroup:3,mapNumber:0,mapLayoutId:anchor.mapLayoutId,mapLayoutAddress:anchor.mapLayoutAddress,
});
const maps=[0,1,8,19,38,39,40,61].map(n=>{
 const m=catalog.get(3,n);
 return m?{mapNumber:n,mapHeaderAddress:'0x'+m.mapHeaderAddress.toString(16),mapLayoutAddress:'0x'+m.mapLayoutAddress.toString(16),mapDataAddress:'0x'+m.mapDataAddress.toString(16),width:m.width,height:m.height,primary:'0x'+m.primaryTilesetAddress.toString(16),secondary:'0x'+m.secondaryTilesetAddress.toString(16),connections:m.connections}:null;
});
const beta=BASE+0x00338378;
const matches=[...catalog.getAll()].filter(m=>m.mapDataAddress===beta).map(m=>({group:m.mapGroup,num:m.mapNumber,width:m.width,height:m.height}));
console.log(JSON.stringify({
 gameCode:String.fromCharCode(rom[0xac],rom[0xad],rom[0xae],rom[0xaf]),
 revision:rom[0xbc],
 anchor,
 catalogCount:count,
 betaAddress:'0x'+beta.toString(16),
 betaOffsetMatches:matches,
 maps,
},null,2));
