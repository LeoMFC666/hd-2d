import { MapCatalog } from '../src/gen3/world/MapCatalog';

const BASE=0x08000000;
function u8(r:Uint8Array,o:number){return o>=0&&o<r.length?r[o]:0}
function u16(r:Uint8Array,o:number){return u8(r,o)|(u8(r,o+1)<<8)}
function u32(r:Uint8Array,o:number){return (u8(r,o)|u8(r,o+1)<<8|u8(r,o+2)<<16|u8(r,o+3)*0x1000000)>>>0}
async function main(){
 const rom=new Uint8Array(await (await fetch('/Pokemon - FireRed Version (USA, Europe) (Rev 1).gba')).arrayBuffer());
 const table=0x08352718;
 const group3=u32(rom,table-BASE+3*4);
 const palletHeader=u32(rom,group3-BASE);
 const palletLayout=u32(rom,palletHeader-BASE);
 const palletLayoutId=u16(rom,palletHeader-BASE+0x12);
 const catalog=new MapCatalog();
 const count=catalog.buildGen3FromRom(rom,{mapGroup:3,mapNumber:0,mapLayoutId:palletLayoutId,mapLayoutAddress:palletLayout});
 const beta=0x08338378;
 const maps=catalog.getAll().filter(m=>m.mapDataAddress===beta).map(m=>({
   key:m.mapGroup+':'+m.mapNumber,
   mapLayoutId:m.mapLayoutId,
   header:'0x'+m.mapHeaderAddress.toString(16),
   layout:'0x'+m.mapLayoutAddress.toString(16),
   mapData:'0x'+m.mapDataAddress.toString(16),
   width:m.width,height:m.height,
   connections:m.connections
 }));
 const result={pass:true,count,betaAddress:'0x08338378',matches:maps.length,maps,three8:{mapData:'0x'+(catalog.get(3,8)?.mapDataAddress??0).toString(16),layout:'0x'+(catalog.get(3,8)?.mapLayoutAddress??0).toString(16),header:'0x'+(catalog.get(3,8)?.mapHeaderAddress??0).toString(16)}};
 document.body.dataset.pass='true';document.querySelector('#out')!.textContent=JSON.stringify(result,null,2);
}
main().catch(e=>{document.body.dataset.pass='false';document.querySelector('#out')!.textContent=JSON.stringify({pass:false,error:String(e)},null,2);throw e});
