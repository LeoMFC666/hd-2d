import { MapCatalog } from '../src/gen3/world/MapCatalog';

const BASE=0x08000000;
const HEADER_SIZE=0x1c;

function u8(rom:Uint8Array,o:number){return o>=0&&o<rom.length?rom[o]:0}
function u16(rom:Uint8Array,o:number){return u8(rom,o)|(u8(rom,o+1)<<8)}
function u32(rom:Uint8Array,o:number){return (u8(rom,o)|(u8(rom,o+1)<<8)|(u8(rom,o+2)<<16)|(u8(rom,o+3)*0x1000000))>>>0}
function i32(rom:Uint8Array,o:number){return u32(rom,o)|0}
function isPtr(rom:Uint8Array,address:number,size=1){const o=address-BASE;return o>=0&&o+size<=rom.length}
function readConnections(rom:Uint8Array,headerAddress:number){
 const ho=headerAddress-BASE;
 const cp=u32(rom,ho+0x0c);
 if(cp===0)return [];
 if(!isPtr(rom,cp,8))return null;
 const co=cp-BASE,count=i32(rom,co);
 if(count<0||count>64)return null;
 if(count===0)return [];
 const dp=u32(rom,co+4);
 if(!isPtr(rom,dp,count*0x0c))return null;
 const d=dp-BASE;
 const out=[];
 for(let i=0;i<count;i++){
   const e=d+i*0x0c;
   out.push({direction:u8(rom,e),offset:i32(rom,e+4),mapGroup:u8(rom,e+8),mapNumber:u8(rom,e+9)});
 }
 return out;
}
function findHeader(rom:Uint8Array,width:number,height:number,required:any[]){
 for(let off=0;off<=rom.length-HEADER_SIZE;off+=4){
   const la=u32(rom,off);
   if(!isPtr(rom,la,0x18))continue;
   const lo=la-BASE;
   if(u32(rom,lo)!==width||u32(rom,lo+4)!==height)continue;
   const mapData=u32(rom,lo+0x0c);
   const primary=u32(rom,lo+0x10);
   const secondary=u32(rom,lo+0x14);
   if(!isPtr(rom,mapData,width*height*2)||!isPtr(rom,primary,4)||!isPtr(rom,secondary,4))continue;
   const address=BASE+off;
   const conns=readConnections(rom,address);
   if(!conns)continue;
   const ok=required.every((e:any)=>conns.some((c:any)=>c.direction===e.direction&&c.mapGroup===e.mapGroup&&c.mapNumber===e.mapNumber&&c.offset===e.offset));
   if(!ok)continue;
   return {address,layoutAddress:la,layoutId:u16(rom,off+0x12),connections:conns};
 }
 return null;
}
function snapshot(catalog:MapCatalog){
 return Object.fromEntries(
  [[3,0],[3,19],[3,1],[3,8],[3,38],[3,40]].map(([g,n])=>{
   const m=catalog.get(g,n);
   return [`${g}:${n}`,m?{
     header:m.mapHeaderAddress,
     layout:m.mapLayoutAddress,
     layoutId:m.mapLayoutId,
     data:m.mapDataAddress,
     primary:m.primaryTilesetAddress,
     secondary:m.secondaryTilesetAddress,
     width:m.width,height:m.height,
     connections:m.connections,
   }:null];
  })
 );
}
function assert(v:any,msg:string){if(!v)throw new Error(msg)}

async function main(){
 const rom=new Uint8Array(await (await fetch('/Pokemon - FireRed Version (USA, Europe) (Rev 1).gba')).arrayBuffer());
 assert(String.fromCharCode(rom[0xac],rom[0xad],rom[0xae],rom[0xaf])==='BPRE','wrong game');
 assert(rom[0xbc]===1,'wrong revision');

 const anchors:any={
  pallet:findHeader(rom,24,20,[
    {direction:2,mapGroup:3,mapNumber:19,offset:0},
    {direction:1,mapGroup:3,mapNumber:39,offset:0},
  ]),
  route1:findHeader(rom,24,40,[
    {direction:2,mapGroup:3,mapNumber:1,offset:-12},
    {direction:1,mapGroup:3,mapNumber:0,offset:0},
  ]),
  cinnabar:findHeader(rom,24,20,[
    {direction:2,mapGroup:3,mapNumber:40,offset:0},
    {direction:4,mapGroup:3,mapNumber:38,offset:0},
  ]),
  route20:findHeader(rom,24,30,[
    {direction:3,mapGroup:3,mapNumber:19,offset:0},
    {direction:4,mapGroup:3,mapNumber:37,offset:-40},
  ]),
  route21south:findHeader(rom,24,50,[
    {direction:2,mapGroup:3,mapNumber:8,offset:0},
  ]),
  viridian:findHeader(rom,48,40,[
    {direction:2,mapGroup:3,mapNumber:19,offset:-12},
    {direction:1,mapGroup:3,mapNumber:2,offset:0},
  ]),
 };
 assert(anchors.pallet,'Pallet anchor not found');
 assert(anchors.route1,'Route1 anchor not found');
 assert(anchors.cinnabar,'Cinnabar anchor not found');
 assert(anchors.route20,'Route20 anchor not found');
 assert(anchors.route21south,'Route21 south anchor not found');
 assert(anchors.viridian,'Viridian anchor not found');

 const results:any={};
 for(const [name,a] of Object.entries(anchors)){
   const cat=new MapCatalog();
   const count=cat.buildGen3FromRom(rom,{
     mapGroup:3,
     mapNumber:name==='pallet'?0:name==='route1'?19:name==='cinnabar'?8:name==='route20'?38:name==='route21south'?40:1,
     mapLayoutId:(a as any).layoutId,
     mapLayoutAddress:(a as any).layoutAddress,
   });
   const m=cat.get(3,name==='pallet'?0:name==='route1'?19:name==='cinnabar'?8:name==='route20'?38:name==='route21south'?40:1);
   results[name]={
     count,
     anchor:a,
     target:m?{
       header:m.mapHeaderAddress,
       layout:m.mapLayoutAddress,
       layoutId:m.mapLayoutId,
       data:m.mapDataAddress,
       primary:m.primaryTilesetAddress,
       secondary:m.secondaryTilesetAddress,
       width:m.width,height:m.height,
     }:null,
     cinnabar:cat.get(3,8)?{
       header:cat.get(3,8)!.mapHeaderAddress,
       layout:cat.get(3,8)!.mapLayoutAddress,
       layoutId:cat.get(3,8)!.mapLayoutId,
       data:cat.get(3,8)!.mapDataAddress,
       primary:cat.get(3,8)!.primaryTilesetAddress,
       secondary:cat.get(3,8)!.secondaryTilesetAddress,
     }:null,
     route1:cat.get(3,19)?.mapDataAddress??null,
     pallet:cat.get(3,0)?.mapDataAddress??null,
   };
 }

 const cinnabarData=results.cinnabar.cinnabar.data;
 const cinnabarLayout=results.cinnabar.cinnabar.layout;
 const expectedData=0x082e37d0;
 const expectedLayout=0x082e31d0;
 const unique=new Set(Object.values(results).map((x:any)=>x.cinnabar?.data).filter(Boolean));

 const pass=Object.values(results).every((x:any)=>x.count===425)&&
   cinnabarData===expectedData&&
   unique.size===1;

 document.body.dataset.pass=pass?'true':'false';
 document.querySelector('#out')!.textContent=JSON.stringify({
   pass,
   expected:{
     cinnabarData:'0x082e37d0',
     cinnabarLayout:'0x082e31d0',
     note:'expectedLayout is informational; source-derived catalog value is checked by exact ROM data address',
   },
   anchors:{
     pallet:anchors.pallet,
     route1:anchors.route1,
     cinnabar:anchors.cinnabar,
     route20:anchors.route20,
     route21south:anchors.route21south,
     viridian:anchors.viridian,
   },
   results,
   cinnabarDataAcrossAnchors:[...unique],
 },null,2);
}
main().catch(e=>{
 document.body.dataset.pass='false';
 document.querySelector('#out')!.textContent=JSON.stringify({pass:false,error:String(e)},null,2);
});