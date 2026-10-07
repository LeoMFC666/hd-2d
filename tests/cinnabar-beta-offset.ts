import { MapCatalog } from '../src/gen3/world/MapCatalog';

const BASE=0x08000000;
const ROM_PATH='/Pokemon - FireRed Version (USA, Europe) (Rev 1).gba';
let rom: Uint8Array;

function u8(o:number){return o>=0&&o<rom.length?rom[o]:0}
function u16(o:number){return u8(o)|(u8(o+1)<<8)}
function u32(o:number){return (u8(o)|(u8(o+1)<<8)|(u8(o+2)<<16)|(u8(o+3)*0x1000000))>>>0}
function i32(o:number){return u32(o)|0}
function ptrOff(a:number){return a-BASE}
function isPtr(a:number,size=1){const o=ptrOff(a);return o>=0&&o+size<=rom.length}
function hex(a:number){return '0x'+a.toString(16).padStart(8,'0')}

function readConnections(headerAddress:number){
 const ho=ptrOff(headerAddress);
 const cp=u32(ho+0x0c);
 if(cp===0)return [];
 if(!isPtr(cp,8))return null;
 const co=ptrOff(cp), count=i32(co);
 if(count<0||count>64)return null;
 if(count===0)return [];
 const dp=u32(co+4);
 if(!isPtr(dp,count*0x0c))return null;
 const d=ptrOff(dp);
 return Array.from({length:count},(_,i)=>{
   const e=d+i*0x0c;
   return {direction:u8(e),offset:i32(e+4),mapGroup:u8(e+8),mapNumber:u8(e+9)};
 });
}

function scanHeadersForLayout(layoutAddress:number){
 const out=[];
 for(let o=0;o<=rom.length-0x1c;o+=4){
   if(u32(o)===layoutAddress) out.push(BASE+o);
 }
 return out;
}

function dumpWords(offset:number,count:number){
 return Array.from({length:count},(_,i)=>u16(offset+i*2));
}

async function main(){
 rom=new Uint8Array(await (await fetch(ROM_PATH)).arrayBuffer());
 const gameCode=String.fromCharCode(rom[0xac],rom[0xad],rom[0xae],rom[0xaf]);
 const revision=rom[0xbc];
 const betaOffset=0x00338378;
 const betaAddress=BASE+betaOffset;
 const betaWords=dumpWords(betaOffset,32);

 const pointerNeedle=betaAddress>>>0;
 const needleBytes=[
   pointerNeedle&0xff,
   (pointerNeedle>>>8)&0xff,
   (pointerNeedle>>>16)&0xff,
   (pointerNeedle>>>24)&0xff,
 ];
 const pointerOccurrences=[];
 for(let o=0;o<=rom.length-4;o+=4){
   if(
     u8(o)===needleBytes[0]&&
     u8(o+1)===needleBytes[1]&&
     u8(o+2)===needleBytes[2]&&
     u8(o+3)===needleBytes[3]
   ) pointerOccurrences.push(BASE+o);
 }

 const candidateLayouts=[];
 for(let o=0;o<=rom.length-0x18;o+=4){
   const layoutAddress=u32(o);
   if(!isPtr(layoutAddress,0x18))continue;
   const lo=ptrOff(layoutAddress);
   const w=u32(lo),h=u32(lo+4);
   if(w!==24||h!==20)continue;
   const mapData=u32(lo+0x0c),primary=u32(lo+0x10),secondary=u32(lo+0x14);
   if(!isPtr(mapData,960*2)||!isPtr(primary,4)||!isPtr(secondary,4))continue;
   candidateLayouts.push({
     headerAddress:BASE+o,
     layoutAddress,
     layoutId:u16(o+0x12),
     mapDataAddress:mapData,
     primaryTilesetAddress:primary,
     secondaryTilesetAddress:secondary,
     connections:readConnections(BASE+o),
   });
 }

 const cands=candidateLayouts.filter(x=>{
   const cs=x.connections;
   if(!cs)return false;
   return cs.some((c:any)=>c.direction===2&&c.mapGroup===3&&c.mapNumber===40&&c.offset===0)&&
          cs.some((c:any)=>c.direction===4&&c.mapGroup===3&&c.mapNumber===38&&c.offset===0);
 });

 const catalog=new MapCatalog();
 let anchor=cands[0];
 if(!anchor)throw new Error('could not independently identify Cinnabar header');
 const count=catalog.buildGen3FromRom(rom,{
   mapGroup:3,mapNumber:8,mapLayoutId:anchor.layoutId,mapLayoutAddress:anchor.layoutAddress
 });
 const pal=catalog.get(3,0);
 const route1=catalog.get(3,19);
 const cinn=catalog.get(3,8);
 const ruin=catalog.get(3,61);

 const result={
  pass:true,
  gameCode,revision,
  betaOffset, betaAddress:hex(betaAddress),
  betaFirstWords:betaWords,
  pointerOccurrences: pointerOccurrences.slice(0,50).map(hex),
  pointerOccurrenceCount:pointerOccurrences.length,
  independentCinnabarCandidates:cands,
  catalogCount:count,
  catalogMaps:{
    pallet:pal,
    route1:route1,
    cinnabar:cinn,
    ruinValley:ruin,
  },
  catalogCinnabarMapDataMatchesBeta:cinn?.mapDataAddress===betaAddress,
  catalogRuinMapDataMatchesBeta:ruin?.mapDataAddress===betaAddress,
 };

 document.body.dataset.pass='true';
 document.querySelector('#out')!.textContent=JSON.stringify(result,null,2);
}
main().catch(e=>{
 document.body.dataset.pass='false';
 document.querySelector('#out')!.textContent=JSON.stringify({pass:false,error:String(e)},null,2);
 throw e;
});
