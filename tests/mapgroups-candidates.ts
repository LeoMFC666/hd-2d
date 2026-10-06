const BASE=0x08000000;
const LENGTHS=[5,123,60,66,4,6,8,10,6,8,20,10,8,2,10,4,2,2,2,1,1,2,2,3,2,3,2,1,1,1,1,7,5,5,8,8,5,5,1,1,1,2,1];
const TARGET=0x08338378;
function u8(r:Uint8Array,o:number){return o>=0&&o<r.length?r[o]:0}
function u16(r:Uint8Array,o:number){return u8(r,o)|(u8(r,o+1)<<8)}
function u32(r:Uint8Array,o:number){return (u8(r,o)|u8(r,o+1)<<8|u8(r,o+2)<<16|u8(r,o+3)*0x1000000)>>>0}
function i32(r:Uint8Array,o:number){return u32(r,o)|0}
function ptr(r:Uint8Array,a:number,size=1){const o=a-BASE;return o>=0&&o+size<=r.length}
function hex(n:number){return '0x'+n.toString(16).padStart(8,'0')}
function headerInfo(r:Uint8Array,h:number){
 if(!ptr(r,h,0x1c))return null;
 const ho=h-BASE,layout=u32(r,ho),id=u16(r,ho+0x12);
 if(!ptr(r,layout,0x18))return {layout:hex(layout),id,width:null,height:null,mapData:null};
 const lo=layout-BASE;
 return {layout:hex(layout),id,width:u32(r,lo),height:u32(r,lo+4),mapData:hex(u32(r,lo+0xc)),primary:hex(u32(r,lo+0x10)),secondary:hex(u32(r,lo+0x14))};
}
function validTable(r:Uint8Array,table:number){
 if(!ptr(r,table,LENGTHS.length*4))return false;
 for(let g=0;g<LENGTHS.length;g++){
  const group=u32(r,(table-BASE)+g*4);
  if(!ptr(r,group,LENGTHS[g]*4))return false;
 }
 return true;
}
async function main(){
 const rom=new Uint8Array(await (await fetch('/Pokemon - FireRed Version (USA, Europe) (Rev 1).gba')).arrayBuffer());
 const realTable=0x08352718;
 const realGroup3=u32(rom,(realTable-BASE)+3*4);
 const realHeader=u32(rom,(realGroup3-BASE)+8*4);
 const real=headerInfo(rom,realHeader);
 const candidates:any[]=[];
 for(let off=0;off<=rom.length-LENGTHS.length*4;off+=4){
  const table=BASE+off;
  if(!validTable(rom,table))continue;
  const group3=u32(rom,off+3*4);
  if(!ptr(rom,group3,66*4))continue;
  const header=u32(rom,(group3-BASE)+8*4);
  const info=headerInfo(rom,header);
  if(!info)continue;
  const matchesRealLayout=info.layout===real?.layout&&info.id===real?.id;
  const pointsBeta=info.mapData===hex(TARGET);
  candidates.push({table:hex(table),group3:hex(group3),header:hex(header),...info,matchesRealLayout,pointsBeta});
 }
 const exact=candidates.filter(x=>x.matchesRealLayout);
 const beta=candidates.filter(x=>x.pointsBeta);
 const result={pass:true,romBytes:rom.length,knownRealTable:hex(realTable),knownRealGroup3:hex(realGroup3),knownRealCinnabarHeader:hex(realHeader),knownRealCinnabar:real,targetBetaOffset:'0x00338378',targetBetaAddress:hex(TARGET),candidateCount:candidates.length,exactRealLayoutCandidates:exact,betaCandidates:beta,allCandidates:candidates};
 document.body.dataset.pass='true';document.querySelector('#out')!.textContent=JSON.stringify(result,null,2);
}
main().catch(e=>{document.body.dataset.pass='false';document.querySelector('#out')!.textContent=JSON.stringify({pass:false,error:String(e)},null,2);throw e});
