import { MapCatalog } from '../src/gen3/world/MapCatalog';

type MgbaModule = {
  HEAPU8: Uint8Array;
  _malloc(size:number):number;
  _free(ptr:number):void;
  _mgbawasm_load(romPtr:number,romBytes:number,biosPtr:number,biosBytes:number,platform:number,gbModelPtr:number,skipBios:number):number;
  _mgbawasm_unload():void;
  _mgbawasm_bus_read8(address:number):number;
  _mgbawasm_bus_read16(address:number):number;
  _mgbawasm_bus_read32(address:number):number;
};

declare global {
  interface Window { createMgbaModule?: (args?:any)=>Promise<MgbaModule>; }
}

const BASE=0x08000000;
function raw8(r:Uint8Array,a:number){return r[a-BASE]??0}
function raw16(r:Uint8Array,a:number){return raw8(r,a)|(raw8(r,a+1)<<8)}
function raw32(r:Uint8Array,a:number){return (raw8(r,a)|raw8(r,a+1)<<8|raw8(r,a+2)<<16|raw8(r,a+3)*0x1000000)>>>0}
function toHex(n:number){return '0x'+(n>>>0).toString(16)}
function getAnchor(rom:Uint8Array){
 for(let o=0;o+0x1c<=rom.length;o+=4){
  const la=raw32(rom,BASE+o),lo=la-BASE;
  if(lo<0||lo+0x18>rom.length||raw32(rom,la)!==24||raw32(rom,la+4)!==20)continue;
  const hp=raw32(rom,BASE+o+0xc); if(hp===0||hp<BASE||hp-BASE+8>rom.length)continue;
  const n=raw32(rom,hp)|0,d=raw32(rom,hp+4); if(n<0||n>64||d<BASE||d-BASE+n*0xc>rom.length)continue;
  let north=false,south=false; const doff=d-BASE;
  for(let i=0;i<n;i++){const e=doff+i*0xc,dir=raw8(rom,BASE+e),off=(raw32(rom,BASE+e+4)|0),g=raw8(rom,BASE+e+8),m=raw8(rom,BASE+e+9);if(dir===2&&off===0&&g===3&&m===19)north=true;if(dir===1&&off===0&&g===3&&m===39)south=true}
  if(north&&south)return {mapLayoutAddress:la,mapLayoutId:raw16(rom,BASE+o+0x12),header:BASE+o};
 }
 return null;
}
function stateSnapshot(m:MgbaModule){
 const group=raw8FromBus(m,0x020050?0):0; void group;
 const addrs=[
  0x02036dfc,
  0x02036dfc+0x04,
  0x02036dfc+0x05,
  0x02036dfc+0x32,
  0x02036dfc+0x00,
  0x02036dfc+0x0c,
 ];
 return addrs.map(a=>({address:toHex(a),u8: m._mgbawasm_bus_read8(a)&255,u16: m._mgbawasm_bus_read16(a)&65535,u32:toHex(m._mgbawasm_bus_read32(a))}));
}
function raw8FromBus(m:MgbaModule,a:number){return m._mgbawasm_bus_read8(a)&255}

async function main(){
 const rom=new Uint8Array(await (await fetch('/Pokemon - FireRed Version (USA, Europe) (Rev 1).gba')).arrayBuffer());
 const anchor=getAnchor(rom); if(!anchor)throw new Error('Pallet anchor not found');
 const cat=new MapCatalog(); const count=cat.buildGen3FromRom(rom,{mapGroup:3,mapNumber:0,mapLayoutId:anchor.mapLayoutId,mapLayoutAddress:anchor.mapLayoutAddress});
 if(count!==425)throw new Error('catalog '+count);
 const cin=cat.get(3,8); if(!cin)throw new Error('Cinnabar missing');

 const script=await (await fetch('/mgba/mgba.js')).text();
 // Load the Emscripten module exactly like public/mgba/mgba.js exposes it.
 const moduleTag=document.createElement('script');
 moduleTag.textContent=script;
 document.head.appendChild(moduleTag);
 await new Promise(r=>setTimeout(r,10));
 const factory=(window as any).createMgbaModule as ((args?:any)=>Promise<MgbaModule>)|undefined;
 if(!factory)throw new Error('createMgbaModule missing');
 const m=await factory({locateFile:(p:string)=>'/mgba/'+p});
 const ptr=m._malloc(rom.length); m.HEAPU8.set(rom,ptr);
 const ok=m._mgbawasm_load(ptr,rom.length,0,0,-1,0,1); m._free(ptr);
 if(!ok)throw new Error('mGBA load failed');

 const checks=[
  cin.mapDataAddress,
  cin.mapLayoutAddress,
  cin.mapHeaderAddress,
  cin.primaryTilesetAddress,
  cin.secondaryTilesetAddress,
  BASE+0x00338378,
 ];
 const bus=checks.map(a=>({address:toHex(a),u8: m._mgbawasm_bus_read8(a)&255,u16: m._mgbawasm_bus_read16(a)&65535,u32:toHex(m._mgbawasm_bus_read32(a))}));
 const snapshot=stateSnapshot(m);
 const result={
  pass:true,
  catalogCount:count,
  cinnabar:{
   header:toHex(cin.mapHeaderAddress),layout:toHex(cin.mapLayoutAddress),mapData:toHex(cin.mapDataAddress),primary:toHex(cin.primaryTilesetAddress),secondary:toHex(cin.secondaryTilesetAddress),
   beta:toHex(BASE+0x00338378)
  },
  bus,
  stateSnapshot:snapshot
 };
 m._mgbawasm_unload();
 document.querySelector('#out')!.textContent=JSON.stringify(result,null,2);
 document.body.dataset.pass='true';
}
main().catch(e=>{document.querySelector('#out')!.textContent=JSON.stringify({pass:false,error:String(e)},null,2);document.body.dataset.pass='false';throw e});