const BASE=0x08000000;
function u8(r:Uint8Array,o:number){return o>=0&&o<r.length?r[o]:0}
function u16(r:Uint8Array,o:number){return u8(r,o)|(u8(r,o+1)<<8)}
function u32(r:Uint8Array,o:number){return (u8(r,o)|u8(r,o+1)<<8|u8(r,o+2)<<16|u8(r,o+3)*0x1000000)>>>0}
function ptr(r:Uint8Array,address:number,size=1){const o=address-BASE;return o>=0&&o+size<=r.length}
function hex(n:number){return '0x'+n.toString(16).padStart(8,'0')}
function words(r:Uint8Array,start:number,count:number){return Array.from({length:count},(_,i)=>hex(u32(r,start+i*4)))}
async function main(){
 const rom=new Uint8Array(await (await fetch('/Pokemon - FireRed Version (USA, Europe) (Rev 1).gba')).arrayBuffer());
 const targetOffset=0x00338378;
 const target=BASE+targetOffset;
 const table=0x08352718;
 const g3=u32(rom,table-BASE+3*4);
 const cinnabarHeader=u32(rom,g3-BASE+8*4);
 const cinnabarLayout=ptr(rom,cinnabarHeader,0x1c)?u32(rom,cinnabarHeader-BASE):0;
 const cinnabarLayoutOffset=cinnabarLayout-BASE;
 const result:any={
  romBytes:rom.length,
  gameCode:String.fromCharCode(rom[0xac],rom[0xad],rom[0xae],rom[0xaf]),
  revision:rom[0xbc],
  table:hex(table),
  group3:hex(g3),
  cinnabar:{header:hex(cinnabarHeader),layout:hex(cinnabarLayout),layoutId:ptr(rom,cinnabarHeader,0x1c)?u16(rom,cinnabarHeader-BASE+0x12):null},
  target:{romOffset:'0x00338378',gbaAddress:hex(target),words:words(rom,targetOffset,8)}
 };
 if(ptr(rom,target,0x1c)){
  const ho=targetOffset;
  result.target.asMapHeader={
   layout:hex(u32(rom,ho)),
   events:hex(u32(rom,ho+4)),
   scripts:hex(u32(rom,ho+8)),
   connections:hex(u32(rom,ho+0xc)),
   layoutId:u16(rom,ho+0x12)
  };
 }
 if(ptr(rom,target,0x18)){
  const lo=targetOffset;
  result.target.asMapLayout={
   width:u32(rom,lo),
   height:u32(rom,lo+4),
   border:hex(u32(rom,lo+8)),
   map:hex(u32(rom,lo+0xc)),
   primaryTileset:hex(u32(rom,lo+0x10)),
   secondaryTileset:hex(u32(rom,lo+0x14))
  };
 }
 if(ptr(rom,cinnabarHeader,0x1c)&&ptr(rom,cinnabarLayout,0x18)){
  const ho=cinnabarHeader-BASE, lo=cinnabarLayout-BASE;
  result.cinnabar.fields={
   mapData:hex(u32(rom,lo+0xc)),
   primaryTileset:hex(u32(rom,lo+0x10)),
   secondaryTileset:hex(u32(rom,lo+0x14)),
   targetEqualsHeader:cinnabarHeader===target,
   targetEqualsLayout:cinnabarLayout===target,
   targetEqualsMapData:u32(rom,lo+0xc)===target
  };
 }
 document.body.dataset.pass='true';
 document.querySelector('#out')!.textContent=JSON.stringify(result,null,2);
}
main().catch(e=>{document.body.dataset.pass='false';document.querySelector('#out')!.textContent=JSON.stringify({pass:false,error:String(e)},null,2);throw e});
