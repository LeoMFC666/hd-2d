import { MapCatalog } from '../src/gen3/world/MapCatalog';
const BASE=0x08000000;
function u8(r:Uint8Array,o:number){return o>=0&&o<r.length?r[o]:0}
function u16(r:Uint8Array,o:number){return u8(r,o)|(u8(r,o+1)<<8)}
function u32(r:Uint8Array,o:number){return (u8(r,o)|u8(r,o+1)<<8|u8(r,o+2)<<16|u8(r,o+3)*0x1000000)>>>0}
async function main(){
 const rom=new Uint8Array(await (await fetch('/Pokemon - FireRed Version (USA, Europe) (Rev 1).gba')).arrayBuffer());
 const table=0x08352718;
 const group3=u32(rom,table-BASE+3*4);
 const cinnabarHeader=u32(rom,group3-BASE+8*4);
 const layout=u32(rom,cinnabarHeader-BASE);
 const layoutId=u16(rom,cinnabarHeader-BASE+0x12);
 const expectedMapData=u32(rom,layout-BASE+0x0c);
 const expectedPrimary=u32(rom,layout-BASE+0x10);
 const expectedSecondary=u32(rom,layout-BASE+0x14);
 const catalog=new MapCatalog();
 const count=catalog.buildGen3FromRom(rom,{mapGroup:3,mapNumber:8,mapLayoutId:layoutId,mapLayoutAddress:layout});
 const c=catalog.get(3,8);
 if(!c)throw new Error('catalog missing 3:8');
 const result={
  pass:c.mapDataAddress===expectedMapData&&c.mapHeaderAddress===cinnabarHeader,
  count,
  anchor:{header:'0x'+cinnabarHeader.toString(16),layout:'0x'+layout.toString(16),layoutId},
  expected:{mapData:'0x'+expectedMapData.toString(16),primary:'0x'+expectedPrimary.toString(16),secondary:'0x'+expectedSecondary.toString(16)},
  actual:{header:'0x'+c.mapHeaderAddress.toString(16),layout:'0x'+c.mapLayoutAddress.toString(16),layoutId:c.mapLayoutId,mapData:'0x'+c.mapDataAddress.toString(16),primary:'0x'+c.primaryTilesetAddress.toString(16),secondary:'0x'+c.secondaryTilesetAddress.toString(16)},
  betaAddress:'0x08338378',
  actualIsBeta:c.mapDataAddress===0x08338378,
  connections:c.connections
 };
 document.body.dataset.pass=result.pass?'true':'false';
 document.querySelector('#out')!.textContent=JSON.stringify(result,null,2);
 if(!result.pass)throw new Error('Cinnabar anchor resolved incorrectly');
}
main().catch(e=>{document.body.dataset.pass='false';document.querySelector('#out')!.textContent=JSON.stringify({pass:false,error:String(e)},null,2);throw e});
