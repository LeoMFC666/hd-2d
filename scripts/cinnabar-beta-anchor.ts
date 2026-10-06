import fs from 'node:fs';
import { MapCatalog } from '../src/gen3/world/MapCatalog';

const BASE=0x08000000;
const rom=new Uint8Array(fs.readFileSync('Pokemon - FireRed Version (USA, Europe) (Rev 1).gba'));
function u8(o:number){return rom[o]??0}
function u16(o:number){return u8(o)|(u8(o+1)<<8)}
function u32(o:number){return (u8(o)|u8(o+1)<<8|u8(o+2)<<16|u8(o+3)*0x1000000)>>>0}
function isPtr(a:number,size=1){const o=a-BASE;return o>=0&&o+size<=rom.length}

const beta=BASE+0x00338378;
let betaLayout:any=null;
let cinnabar:any=null;
for(let o=0;o+0x18<=rom.length;o+=4){
 const w=u32(o),h=u32(o+4);
 // This is a fast scan of the ROM for layout structs whose map-data pointer
 // exactly targets the reported beta offset.
 const mapData=u32(o+0x0c), primary=u32(o+0x10), secondary=u32(o+0x14);
 if(mapData===beta && isPtr(BASE+o,0x18)){
   betaLayout={
     address:BASE+o,width:w,height:h,
     mapData:'0x'+mapData.toString(16),
     primary:'0x'+primary.toString(16),
     secondary:'0x'+secondary.toString(16)
   };
 }
}
function readConnections(header:number){
 const p=u32(header-BASE+0x0c); if(!p)return [];
 if(!isPtr(p,8))return null;
 const po=p-BASE,n=u32(po)|0,d=u32(po+4);
 if(n<0||n>64||!isPtr(d,n*0xc))return null;
 const out:any[]=[];const doff=d-BASE;
 for(let i=0;i<n;i++){const e=doff+i*0xc;out.push({direction:u8(e),offset:u32(e+4)|0,mapGroup:u8(e+8),mapNumber:u8(e+9)})}
 return out;
}
for(let o=0;o+0x1c<=rom.length;o+=4){
 const la=u32(o);
 if(!isPtr(la,0x18))continue;
 const lo=la-BASE;
 if(u32(lo)!==24||u32(lo+4)!==20)continue;
 const c=readConnections(BASE+o); if(!c)continue;
 if(c.some((x:any)=>x.direction===2&&x.offset===0&&x.mapGroup===3&&x.mapNumber===40)&&c.some((x:any)=>x.direction===4&&x.offset===0&&x.mapGroup===3&&x.mapNumber===38)){
   cinnabar={address:BASE+o,layoutAddress:la,layoutId:u16(o+0x12),mapData:u32(lo+0x0c),primary:u32(lo+0x10),secondary:u32(lo+0x14)};
   break;
 }
}
const stable = new MapCatalog();
const stableCount=stable.buildGen3FromRom(rom,{
 mapGroup:3,mapNumber:0,
 mapLayoutId:78,
 mapLayoutAddress:0x082dd530,
});
const canon=stable.get(3,8);

let betaAnchorResult:any=null;
if(betaLayout){
 const cat=new MapCatalog();
 const count=cat.buildGen3FromRom(rom,{
   mapGroup:3,mapNumber:8,
   mapLayoutId:betaLayout.width===0?0:u16(betaLayout.address-BASE+0x12),
   mapLayoutAddress:betaLayout.address,
 });
 const m=cat.get(3,8);
 betaAnchorResult={
   count,
   resolved:m?{
     header:'0x'+m.mapHeaderAddress.toString(16),
     layout:'0x'+m.mapLayoutAddress.toString(16),
     mapData:'0x'+m.mapDataAddress.toString(16),
     width:m.width,height:m.height,
     secondary:'0x'+m.secondaryTilesetAddress.toString(16)
   }:null
 };
}
console.log(JSON.stringify({
 betaAddress:'0x'+beta.toString(16),
 betaLayout,
 cinnabar,
 normalCatalogCinnabar:canon?{
   header:'0x'+canon.mapHeaderAddress.toString(16),
   layout:'0x'+canon.mapLayoutAddress.toString(16),
   mapData:'0x'+canon.mapDataAddress.toString(16),
   width:canon.width,height:canon.height,
   secondary:'0x'+canon.secondaryTilesetAddress.toString(16)
 }:null,
 betaAnchorResult
},null,2));