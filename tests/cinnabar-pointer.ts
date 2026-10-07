import { MapCatalog } from '../src/gen3/world/MapCatalog';

const BASE=0x08000000;
function u8(rom:Uint8Array,o:number){return rom[o]??0}
function u16(rom:Uint8Array,o:number){return u8(rom,o)|(u8(rom,o+1)<<8)}
function u32(rom:Uint8Array,o:number){return (u8(rom,o)|u8(rom,o+1)<<8|u8(rom,o+2)<<16|u8(rom,o+3)*0x1000000)>>>0}
function i32(rom:Uint8Array,o:number){return u32(rom,o)|0}
function ptr(rom:Uint8Array,a:number,s=1){const o=a-BASE;return o>=0&&o+s<=rom.length}
function conns(rom:Uint8Array,ha:number){
 const p=u32(rom,ha-BASE+0xc); if(!p)return [];
 if(!ptr(rom,p,8))return null;
 const po=p-BASE,n=i32(rom,po),d=u32(rom,po+4);
 if(n<0||n>64||!ptr(rom,d,n*0xc))return null;
 const out:any[]=[]; const o=d-BASE;
 for(let i=0;i<n;i++){const e=o+i*0xc;out.push({dir:u8(rom,e),off:i32(rom,e+4),g:u8(rom,e+8),n:u8(rom,e+9)})}
 return out;
}
const rom=new Uint8Array(await (await fetch('/Pokemon - FireRed Version (USA, Europe) (Rev 1).gba')).arrayBuffer());
let anchor:any=null;
for(let o=0;o<=rom.length-0x1c;o+=4){
 const la=u32(rom,o); if(!ptr(rom,la,0x18))continue;
 const lo=la-BASE,w=u32(rom,lo),h=u32(rom,lo+4);
 if(w!==24||h!==20)continue;
 const cs=conns(rom,BASE+o); if(!cs)continue;
 if(cs.some((c:any)=>c.dir===2&&c.g===3&&c.n===40&&c.off===0)&&cs.some((c:any)=>c.dir===4&&c.g===3&&c.n===38&&c.off===0)){
  anchor={mapGroup:3,mapNumber:8,mapLayoutId:u16(rom,o+0x12),mapLayoutAddress:la,header:BASE+o,connections:cs};break;
 }
}
if(!anchor)throw new Error('Cinnabar header not found');
const cat=new MapCatalog();
const count=cat.buildGen3FromRom(rom,anchor);
const c=cat.get(3,8), p=cat.get(3,0), r=cat.get(3,61);
if(!c||!p||!r)throw new Error('missing maps');
const beta=0x08338378;
const bytes=Array.from({length:32},(_,i)=>u8(rom,beta-BASE+i).toString(16).padStart(2,'0')).join(' ');
const out={
 pass:true,count,
 anchor,
 cinnabar:{
  header:'0x'+c.mapHeaderAddress.toString(16),
  layout:'0x'+c.mapLayoutAddress.toString(16),
  mapData:'0x'+c.mapDataAddress.toString(16),
  primary:'0x'+c.primaryTilesetAddress.toString(16),
  secondary:'0x'+c.secondaryTilesetAddress.toString(16),
  size:[c.width,c.height],
  equalsBeta: c.mapDataAddress===beta
 },
 pallet:{header:'0x'+p.mapHeaderAddress.toString(16),mapData:'0x'+p.mapDataAddress.toString(16)},
 ruin:{header:'0x'+r.mapHeaderAddress.toString(16),mapData:'0x'+r.mapDataAddress.toString(16)},
 betaAt:'0x'+beta.toString(16),betaBytes:bytes
};
document.body.dataset.pass='true';document.querySelector('#out')!.textContent=JSON.stringify(out,null,2);