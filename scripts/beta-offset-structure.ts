import fs from 'node:fs';

const BASE=0x08000000;
const rom=new Uint8Array(fs.readFileSync('Pokemon - FireRed Version (USA, Europe) (Rev 1).gba'));
const A=BASE+0x00338378;

function u8(o:number){return rom[o]??0}
function u16(o:number){return u8(o)|(u8(o+1)<<8)}
function u32(o:number){return (u8(o)|u8(o+1)<<8|u8(o+2)<<16|u8(o+3)*0x1000000)>>>0}
function isPtr(a:number,size=1){const o=a-BASE;return o>=0&&o+size<=rom.length}

function ptrInfo(addr:number){
  if(!isPtr(addr)) return {address:'0x'+addr.toString(16),valid:false};
  const o=addr-BASE;
  return {
    address:'0x'+addr.toString(16),
    valid:true,
    u32:'0x'+u32(o).toString(16),
    u16:'0x'+u16(o).toString(16),
    bytes:Array.from(rom.slice(o,o+32)).map(x=>x.toString(16).padStart(2,'0')).join(' ')
  };
}

const asHeader={
  address:'0x'+A.toString(16),
  layoutPointer:'0x'+u32(A-BASE).toString(16),
  connectionsPointer:'0x'+u32(A-BASE+0x0c).toString(16),
  layoutId:u16(A-BASE+0x12),
  raw:Array.from(rom.slice(A-BASE,A-BASE+0x1c)).map(x=>x.toString(16).padStart(2,'0')).join(' ')
};

const layoutPtr=u32(A-BASE);
const asLayout= isPtr(layoutPtr,0x18) ? {
  address:'0x'+layoutPtr.toString(16),
  width:u32(layoutPtr-BASE),
  height:u32(layoutPtr-BASE+4),
  border:'0x'+u32(layoutPtr-BASE+8).toString(16),
  mapData:'0x'+u32(layoutPtr-BASE+0x0c).toString(16),
  primary:'0x'+u32(layoutPtr-BASE+0x10).toString(16),
  secondary:'0x'+u32(layoutPtr-BASE+0x14).toString(16)
}:null;

let pointersToA:any[]=[];
for(let o=0;o+4<=rom.length;o+=4){
 const v=u32(o);
 if(v===A) pointersToA.push('0x'+(BASE+o).toString(16));
 if(pointersToA.length>=50) break;
}

let pointersToBetaData:any[]=[];
for(let o=0;o+4<=rom.length;o+=4){
 const v=u32(o);
 if(v===A) pointersToBetaData.push('0x'+(BASE+o).toString(16));
 if(pointersToBetaData.length>=200) break;
}

let candidateLayouts:any[]=[];
for(let o=0;o+0x18<=rom.length;o+=4){
 const mapData=u32(o+0x0c);
 if(mapData===A){
   const la=BASE+o;
   candidateLayouts.push({
     address:'0x'+la.toString(16),
     width:u32(o),
     height:u32(o+4),
     border:'0x'+u32(o+8).toString(16),
     primary:'0x'+u32(o+0x10).toString(16),
     secondary:'0x'+u32(o+0x14).toString(16)
   });
 }
 if(candidateLayouts.length>=50) break;
}

let candidateHeaders:any[]=[];
for(let o=0;o+0x1c<=rom.length;o+=4){
 const layout=u32(o);
 const conns=u32(o+0x0c);
 if(layout===A){
   candidateHeaders.push({
     address:'0x'+(BASE+o).toString(16),
     layout:'0x'+layout.toString(16),
     connections:'0x'+conns.toString(16),
     layoutId:u16(o+0x12)
   });
 }
 if(candidateHeaders.length>=50) break;
}

console.log(JSON.stringify({
 gameCode:String.fromCharCode(rom[0xac],rom[0xad],rom[0xae],rom[0xaf]),
 revision:rom[0xbc],
 reportedOffset:'0x00338378',
 reportedAddress:'0x'+A.toString(16),
 rawAtAddress:asHeader,
 interpretedLayoutAtAddress:asLayout,
 pointersToReportedAddress:pointersToA,
 layoutsPointingToReportedAddress:candidateLayouts,
 headersPointingToReportedAddress:candidateHeaders,
 addressMinusBase:'0x'+(A-BASE).toString(16),
},null,2));
