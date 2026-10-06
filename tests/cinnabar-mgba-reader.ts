import { load } from '@wasm-gaming/mgba-wasm';
import { MgbaMemoryReader } from '../src/gen3/MemoryReader';
import { Gen3StateAdapter } from '../src/gen3/Gen3StateAdapter';
import { MapCatalog } from '../src/gen3/world/MapCatalog';

const BASE=0x08000000;
const ROM_PATH='/Pokemon - FireRed Version (USA, Europe) (Rev 1).gba';

class RomReader {
  constructor(private readonly rom: Uint8Array){}
  readU8(a:number){const o=a-BASE;return o>=0&&o<this.rom.length?this.rom[o]:0}
  readU16(a:number){return this.readU8(a)|(this.readU8(a+1)<<8)}
  readU32(a:number){return (this.readU8(a)|this.readU8(a+1)<<8|this.readU8(a+2)<<16|this.readU8(a+3)*0x1000000)>>>0}
  readRange(a:number,n:number){const out=new Uint8Array(n);for(let i=0;i<n;i++)out[i]=this.readU8(a+i);return out}
}
function hex(n:number){return '0x'+n.toString(16)}
function hash(bytes:Uint8Array){let h=2166136261;for(const b of bytes){h^=b;h=Math.imul(h,16777619)}return h>>>0}
function diff(a:Uint8Array,b:Uint8Array){const n=Math.min(a.length,b.length);for(let i=0;i<n;i++)if(a[i]!==b[i])return i;return a.length===b.length?-1:n}

async function main(){
 const rom=new Uint8Array(await (await fetch(ROM_PATH)).arrayBuffer());
 if(String.fromCharCode(rom[0xac],rom[0xad],rom[0xae],rom[0xaf])!=='BPRE'||rom[0xbc]!==1)throw new Error('wrong ROM');

 const romReader=new RomReader(rom);
 const catalog=new MapCatalog();

 // Use the real stable catalog code to identify Cinnabar and a control map.
 const palletAnchor={mapGroup:3,mapNumber:0,mapLayoutId:78,mapLayoutAddress:137221424};
 const count=catalog.buildGen3FromRom(rom,palletAnchor);
 if(count!==425)throw new Error('catalog '+count);
 const cinnabar=catalog.get(3,8)!;
 const route1=catalog.get(3,19)!;
 if(!cinnabar||!route1)throw new Error('missing control maps');

 const canvas=document.createElement('canvas');
 canvas.width=240;canvas.height=160;document.body.appendChild(canvas);

 const engine=await load({
   jsUrl:'/mgba/mgba.js',
   wasmUrl:'/mgba/mgba.wasm',
   canvasEl:canvas,
   assets:{rom},
   options:{
     system:'auto',
     aspect:'native',
     renderFilter:'pixelated',
     skipBios:true,
     idleOptimization:'remove',
     allowOpposingDirections:false,
     gamepads:true,
     volume:0,
     logLevel:'error',
   },
   persist:null,
 });
 const runtime=(engine as any).runtimeModule;
 if(!runtime)throw new Error('runtimeModule missing');
 const mgba=new MgbaMemoryReader(runtime);

 // Start core, then compare ROM-bus reads against raw ROM for both control and Cinnabar.
 engine.start();
 await new Promise(r=>setTimeout(r,2500));

 const addresses=[
   cinnabar.mapLayoutAddress,
   cinnabar.mapDataAddress,
   cinnabar.primaryTilesetAddress,
   cinnabar.secondaryTilesetAddress,
   route1.mapLayoutAddress,
   route1.mapDataAddress,
   route1.primaryTilesetAddress,
   route1.secondaryTilesetAddress,
 ];

 const samples:any[]=[];
 for(const address of addresses){
   const raw=romReader.readRange(address,64);
   const live=mgba.readRange(address,64);
   samples.push({
     address:hex(address),
     diffOffset:diff(raw,live),
     rawHash:hash(raw),
     liveHash:hash(live),
   });
 }

 const adapter=new Gen3StateAdapter(mgba as any,rom);
 const cinnabarRender=adapter.getMapRenderData(
   cinnabar.mapDataAddress,cinnabar.width,cinnabar.height,
   cinnabar.primaryTilesetAddress,cinnabar.secondaryTilesetAddress,
 );
 const route1Render=adapter.getMapRenderData(
   route1.mapDataAddress,route1.width,route1.height,
   route1.primaryTilesetAddress,route1.secondaryTilesetAddress,
 );

 const result={
   pass:samples.every(x=>x.diffOffset===-1)&&!!cinnabarRender&&!!route1Render,
   runtimeFunctions:{
     busRead8:typeof runtime._mgbawasm_bus_read8==='function',
     busRead16:typeof runtime._mgbawasm_bus_read16==='function',
     busRead32:typeof runtime._mgbawasm_bus_read32==='function',
   },
   catalogCount:count,
   maps:{
     cinnabar:{
       mapData:hex(cinnabar.mapDataAddress),
       primary:hex(cinnabar.primaryTilesetAddress),
       secondary:hex(cinnabar.secondaryTilesetAddress),
       size:[cinnabar.width,cinnabar.height],
     },
     route1:{
       mapData:hex(route1.mapDataAddress),
       primary:hex(route1.primaryTilesetAddress),
       secondary:hex(route1.secondaryTilesetAddress),
       size:[route1.width,route1.height],
     },
   },
   samples,
   renderData:{
     cinnabarBlocks:cinnabarRender?.blocks.length??0,
     route1Blocks:route1Render?.blocks.length??0,
   },
 };
 engine.destroy();
 document.querySelector('#out')!.textContent=JSON.stringify(result,null,2);
 document.body.dataset.pass=result.pass?'true':'false';
}
main().catch(e=>{document.querySelector('#out')!.textContent=JSON.stringify({pass:false,error:String(e)},null,2);document.body.dataset.pass='false';throw e});
