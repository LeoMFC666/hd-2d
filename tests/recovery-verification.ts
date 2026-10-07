import * as THREE from 'three';
import { MapCatalog } from '../src/gen3/world/MapCatalog';
import { MapWorld } from '../src/gen3/world/MapWorld';
import { Gen3StateAdapter } from '../src/gen3/Gen3StateAdapter';
import { PlayerRenderer } from '../src/render/PlayerRenderer';
import type { MemoryReader } from '../src/gen3/MemoryReader';
import type { GameState } from '../src/gen3/GameState';

const BASE=0x08000000;
const out=document.querySelector('#out') as HTMLElement;

class RomReader implements MemoryReader{
 constructor(private readonly rom:Uint8Array){}
 readU8(a:number){const o=a-BASE;return o>=0&&o<this.rom.length?this.rom[o]:0}
 readU16(a:number){return this.readU8(a)|this.readU8(a+1)<<8}
 readU32(a:number){return (this.readU8(a)|this.readU8(a+1)<<8|this.readU8(a+2)<<16|this.readU8(a+3)*0x1000000)>>>0}
 readRange(a:number,n:number){const r=new Uint8Array(n);for(let i=0;i<n;i++)r[i]=this.readU8(a+i);return r}
}

function assert(v:unknown,msg:string):asserts v{if(!v)throw new Error(msg)}
function fnv(bytes:Uint8Array){let h=2166136261;for(const b of bytes){h^=b;h=Math.imul(h,16777619)}return h>>>0}

function scanAnchor(
 rom:Uint8Array,
 width:number,
 height:number,
 required:Array<{direction:number;mapGroup:number;mapNumber:number;offset:number}>,
){
 const u8=(o:number)=>o>=0&&o<rom.length?rom[o]:0;
 const u16=(o:number)=>u8(o)|u8(o+1)<<8;
 const u32=(o:number)=>(u8(o)|u8(o+1)<<8|u8(o+2)<<16|u8(o+3)*0x1000000)>>>0;
 const isPtr=(a:number,n=1)=>{const o=a-BASE;return o>=0&&o+n<=rom.length};
 for(let o=0;o<=rom.length-0x1c;o+=4){
   const la=u32(o);if(!isPtr(la,0x18))continue;
   const lo=la-BASE;
   if(u32(lo)!==width||u32(lo+4)!==height)continue;
   const md=u32(lo+0xc),p=u32(lo+0x10),s=u32(lo+0x14);
   if(!isPtr(md,width*height*2)||!isPtr(p,4)||!isPtr(s,4))continue;
   const header=BASE+o,cp=u32(o+0xc);
   if(cp===0||!isPtr(cp,8))continue;
   const co=cp-BASE,n=u32(co)|0;if(n<0||n>64)continue;
   if(n===0){continue}
   const da=u32(co+4);if(!isPtr(da,n*0xc))continue;
   let ok=0;
   for(let i=0;i<n;i++){
     const e=da-BASE+i*0xc;
     if(required.some(r=>r.direction===u8(e)&&r.offset===(u32(e+4)|0)&&r.mapGroup===u8(e+8)&&r.mapNumber===u8(e+9)))ok++;
   }
   if(ok===required.length)return {address:header,layoutAddress:la,layoutId:u16(o+0x12)};
 }
 return null;
}

function stateFor(map:any):GameState{
 return {
  game:{game:'GEN 3',version:'Pokémon FireRed',region:'firered',revision:'1'},
  player:{x:12,y:10,z:0,direction:'DOWN',movementState:'idle'},
  map:{mapGroup:3,mapNumber:8,mapLayoutId:map.mapLayoutId,mapHeaderAddress:map.mapHeaderAddress,mapLayoutAddress:map.mapLayoutAddress,mapDataAddress:map.mapDataAddress,primaryTilesetAddress:map.primaryTilesetAddress,secondaryTilesetAddress:map.secondaryTilesetAddress,width:map.width,height:map.height,cellCount:map.width*map.height,blockSample:[],
    primaryTileset:{address:map.primaryTilesetAddress,isCompressed:false,isSecondary:false,tilesAddress:0,palettesAddress:0,metatilesAddress:0,metatileAttributesAddress:0},
    secondaryTileset:{address:map.secondaryTilesetAddress,isCompressed:false,isSecondary:true,tilesAddress:0,palettesAddress:0,metatilesAddress:0,metatileAttributesAddress:0},
    primaryMetatileSample:null,secondaryMetatileSample:null},
  objects:[],camera:{x:0,y:0,z:0,yaw:0,pitch:0}
 };
}

async function auditCinnabar(){
 const response=await fetch('/Pokemon - FireRed Version (USA, Europe) (Rev 1).gba');
 const rom=new Uint8Array(await response.arrayBuffer());
 const anchor=scanAnchor(rom,24,20,[
  {direction:2,mapGroup:3,mapNumber:40,offset:0},
  {direction:4,mapGroup:3,mapNumber:38,offset:0},
 ]);
 assert(anchor,'Cinnabar anchor scan failed');
 const catalog=new MapCatalog();
 const count=catalog.buildGen3FromRom(rom,{mapGroup:3,mapNumber:0,mapLayoutId:anchor.layoutId,mapLayoutAddress:anchor.layoutAddress});
 assert(count===425,'FireRed catalog count '+count);
 const correct=catalog.get(3,8)!;
 const ruin=catalog.get(3,61)!;
 assert(correct&&ruin,'FireRed catalog missing Cinnabar/Ruin');
 assert(correct.mapDataAddress!==ruin.mapDataAddress,'Cinnabar map data equals Ruin Valley');

 const reader=new RomReader(rom);
 const adapter=new Gen3StateAdapter(reader,rom);
 const cData=adapter.getMapRenderData(correct.mapDataAddress,correct.width,correct.height,correct.primaryTilesetAddress,correct.secondaryTilesetAddress);
 const rData=adapter.getMapRenderData(ruin.mapDataAddress,ruin.width,ruin.height,ruin.primaryTilesetAddress,ruin.secondaryTilesetAddress);
 assert(cData&&rData,'Cinnabar/Ruin render data missing');

 const realCinnabar=adapter.getMapRenderData(correct.mapDataAddress,correct.width,correct.height,correct.primaryTilesetAddress,correct.secondaryTilesetAddress);
 assert(realCinnabar,'real Cinnabar render missing');
 const directHash=fnv(new Uint8Array(realCinnabar.blocks.flatMap(b=>[b.metatileId&255,b.metatileId>>>8])));

 const fake={
   readState:()=>stateFor(correct),
   getMemoryReader:()=>reader,
   getMapRenderData:adapter.getMapRenderData.bind(adapter),
   getMapBlocks:()=>[],
   getMetatileGraphics:adapter.getMetatileGraphics.bind(adapter),
 } as unknown as Gen3StateAdapter;

 const container=document.createElement('div');
 container.style.width='640px';container.style.height='480px';
 document.body.appendChild(container);
 const renderer=new PlayerRenderer(container,fake,rom);
 const internal=renderer as unknown as {mapCatalog:MapCatalog;mapWorld:MapWorld;mapVisuals:Map<string,{baseTexture:THREE.DataTexture,mapDataAddress:number}>;worldCatalogBuilt:boolean};

 const current=internal.mapCatalog.get(3,8)!;
 internal.mapCatalog.register({
   ...current,
   mapDataAddress:ruin.mapDataAddress,
   primaryTilesetAddress:ruin.primaryTilesetAddress,
   secondaryTilesetAddress:ruin.secondaryTilesetAddress,
 });

 internal.worldCatalogBuilt=true;

 for(let i=0;i<60;i++)await new Promise(requestAnimationFrame);

 const repaired=internal.mapCatalog.get(3,8)!;
 assert(repaired.mapDataAddress===current.mapDataAddress,'Cinnabar definition was not repaired');
 const visual=internal.mapVisuals.get('3:8');
 assert(visual,'Cinnabar visual missing after repair');
 assert(visual.mapDataAddress===current.mapDataAddress,'Cinnabar visual still uses wrong map data');

 const finalHash=fnv((visual.baseTexture.image.data as Uint8Array));
 renderer.destroy();
 container.remove();

 return {
   catalogCount:count,
   correctedMapData:'0x'+correct.mapDataAddress.toString(16),
   ruinMapData:'0x'+ruin.mapDataAddress.toString(16),
   directBlockHash:directHash,
   finalTextureHash:finalHash,
   repairVerified:true,
 };
}

async function auditAppSaveCycle(){
 const errors:string[]=[];
 window.addEventListener('error',e=>errors.push(String((e as ErrorEvent).error??(e as ErrorEvent).message)));
 window.addEventListener('unhandledrejection',e=>errors.push(String((e as PromiseRejectionEvent).reason)));

 const rom=await (await fetch('/Pokemon - Emerald Version (USA, Europe).gba')).arrayBuffer();
 const save=await (await fetch('/save.sav')).arrayBuffer();
 const romInput=document.querySelector<HTMLInputElement>('#romInput')!;
 const saveInput=document.querySelector<HTMLInputElement>('#saveInput')!;

 await import('/src/main.ts');

 const setFile=async(input:HTMLInputElement,name:string,mime:string,buffer:ArrayBuffer)=>{
   const file=new File([buffer],name,{type:mime});
   const dt=new DataTransfer();dt.items.add(file);
   input.files=dt.files;
   input.dispatchEvent(new Event('change',{bubbles:true}));
 };

 await setFile(romInput,'emerald.gba','application/octet-stream',rom);

 let deadline=Date.now()+15000;
 while(Date.now()<deadline){
   const status=document.querySelector('#status')?.textContent??'';
   if(status.startsWith('ROM loaded:'))break;
   await new Promise(r=>setTimeout(r,100));
 }
 assert((document.querySelector('#status')?.textContent??'').startsWith('ROM loaded:'),'Emerald ROM did not load in browser');

 for(let i=0;i<3;i++){
   await setFile(saveInput,'emerald.sav','application/octet-stream',save);
   deadline=Date.now()+10000;
   while(Date.now()<deadline){
     const status=document.querySelector('#status')?.textContent??'';
     if(status.startsWith('Save loaded:'))break;
     if(status.startsWith('Save failed:'))throw new Error(status);
     await new Promise(r=>setTimeout(r,100));
   }
   assert((document.querySelector('#status')?.textContent??'').startsWith('Save loaded:'),'Save cycle '+i+' did not finish');
   await new Promise(r=>setTimeout(r,500));
   assert(document.querySelector('#sceneContainer canvas')||document.querySelector('#sceneContainer'),'3D scene container missing after save cycle '+i);
 }

 assert(errors.length===0,'Browser errors during ROM/save cycles: '+errors.join(' | '));
 return {saveCycles:3,browserErrors:0};
}

async function main(){
 out.textContent='running Cinnabar audit...';
 const cinnabar=await auditCinnabar();
 out.textContent='running Emerald save lifecycle audit...';
 const saves=await auditAppSaveCycle();
 const result={pass:true,cinnabar,saves};
 out.textContent=JSON.stringify(result,null,2);
 document.body.dataset.pass='true';
}
main().catch(e=>{out.textContent=JSON.stringify({pass:false,error:e instanceof Error?e.message:String(e)},null,2);document.body.dataset.pass='false';});
