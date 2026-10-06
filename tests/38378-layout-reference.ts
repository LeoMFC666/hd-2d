const BASE=0x08000000;
const TARGET=0x08338378;
function u8(r:Uint8Array,o:number){return o>=0&&o<r.length?r[o]:0}
function u16(r:Uint8Array,o:number){return u8(r,o)|(u8(r,o+1)<<8)}
function u32(r:Uint8Array,o:number){return (u8(r,o)|u8(r,o+1)<<8|u8(r,o+2)<<16|u8(r,o+3)*0x1000000)>>>0}
function hex(n:number){return '0x'+n.toString(16).padStart(8,'0')}
function ptr(r:Uint8Array,a:number,size=1){const o=a-BASE;return o>=0&&o+size<=r.length}
async function main(){
 const rom=new Uint8Array(await (await fetch('/Pokemon - FireRed Version (USA, Europe) (Rev 1).gba')).arrayBuffer());
 const layouts:any[]=[];
 for(let o=0;o+0x18<=rom.length;o+=4){
   const mapData=u32(rom,o+0x0c);
   if(mapData!==TARGET)continue;
   const address=BASE+o;
   const width=u32(rom,o),height=u32(rom,o+4),border=u32(rom,o+8),primary=u32(rom,o+0x10),secondary=u32(rom,o+0x14);
   layouts.push({layout:hex(address),width,height,border:hex(border),mapData:hex(mapData),primary:hex(primary),secondary:hex(secondary)});
 }
 const headers:any[]=[];
 for(let o=0;o+0x1c<=rom.length;o+=4){
   const layout=u32(rom,o);
   if(!layouts.some(x=>x.layout===hex(layout)))continue;
   headers.push({header:hex(BASE+o),layout:hex(layout),layoutId:u16(rom,o+0x12),events:hex(u32(rom,o+4)),scripts:hex(u32(rom,o+8)),connections:hex(u32(rom,o+0xc))});
 }
 document.body.dataset.pass='true';
 document.querySelector('#out')!.textContent=JSON.stringify({pass:true,target:'0x08338378',layoutCount:layouts.length,layouts,headerCount:headers.length,headers:headers.slice(0,200)},null,2);
}
main().catch(e=>{document.body.dataset.pass='false';document.querySelector('#out')!.textContent=JSON.stringify({pass:false,error:String(e)},null,2);throw e});
