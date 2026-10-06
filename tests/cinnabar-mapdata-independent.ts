import { MapCatalog } from '../src/gen3/world/MapCatalog';

const BASE=0x08000000;
let rom:Uint8Array;
function u8(o:number){return o>=0&&o<rom.length?rom[o]:0}
function u16(o:number){return u8(o)|(u8(o+1)<<8)}
function u32(o:number){return (u8(o)|u8(o+1)<<8|u8(o+2)<<16|u8(o+3)*0x1000000)>>>0}
function isPtr(a:number,size=1){const off=a-BASE;return off>=0&&off+size<=rom.length}
function findPalletAnchor(){
 for(let off=0;off<=rom.length-0x1c;off+=4){
  const la=u32(off); if(!isPtr(la,0x18))continue; const lo=la-BASE;
  if(u32(lo)!==24||u32(lo+4)!==20)continue;
  const cp=u32(off+0x0c); if(!isPtr(cp,8))continue; const co=cp-BASE,n=u32(co)|0;
  if(n<2||n>64)continue; const da=u32(co+4)-BASE; if(da<0||da+n*0xc>rom.length)continue;
  let r1=false,r21=false;
  for(let i=0;i<n;i++){const e=da+i*0xc,d=u8(e),o=u32(e+4)|0,g=u8(e+8),m=u8(e+9);if(d===2&&o===0&&g===3&&m===19)r1=true;if(d===1&&o===0&&g===3&&m===39)r21=true}
  if(r1&&r21)return {mapLayoutAddress:la,mapLayoutId:u16(off+0x12)};
 }
 throw new Error('Pallet anchor not found');
}
function firstDiff(a:Uint8Array,b:Uint8Array){
 const n=Math.min(a.length,b.length);for(let i=0;i<n;i++)if(a[i]!==b[i])return i;return a.length===b.length?-1:n;
}
async function compareMap(path:string, mapData:number, size:number){
 const source=new Uint8Array(await (await fetch('https://raw.githubusercontent.com/pret/pokefirered/master/'+path)).arrayBuffer());
 const ours=rom.slice(mapData-BASE,mapData-BASE+size);
 return {path,sourceBytes:source.length,oursBytes:ours.length,diff:firstDiff(source,ours)};
}
async function main(){
 rom=new Uint8Array(await (await fetch('/Pokemon - FireRed Version (USA, Europe) (Rev 1).gba')).arrayBuffer());
 const a=findPalletAnchor(); const cat=new MapCatalog();
 if(cat.buildGen3FromRom(rom,{mapGroup:3,mapNumber:0,...a})!==425)throw new Error('catalog build failed');
 const cin=cat.get(3,8)!; const pallet=cat.get(3,0)!; const route1=cat.get(3,19)!;
 if(!cin||!pallet||!route1)throw new Error('catalog maps missing');
 const checks=[
  await compareMap('data/layouts/CinnabarIsland/map.bin',cin.mapDataAddress,cin.width*cin.height*2),
  await compareMap('data/layouts/PalletTown/map.bin',pallet.mapDataAddress,pallet.width*pallet.height*2),
  await compareMap('data/layouts/Route1/map.bin',route1.mapDataAddress,route1.width*route1.height*2),
 ];
 const result={pass:checks.every(x=>x.diff===-1),checks,cinnabar:{mapData:'0x'+cin.mapDataAddress.toString(16),size:[cin.width,cin.height]}};
 document.querySelector('#out')!.textContent=JSON.stringify(result,null,2);document.body.dataset.pass=result.pass?'true':'false';
}
main().catch(e=>{document.querySelector('#out')!.textContent=JSON.stringify({pass:false,error:String(e)},null,2);document.body.dataset.pass='false';throw e});
