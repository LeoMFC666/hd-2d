import * as THREE from 'three';
import { Gen3StateAdapter } from '../src/gen3/Gen3StateAdapter';
import type { MemoryReader } from '../src/gen3/MemoryReader';
import { MapCatalog } from '../src/gen3/world/MapCatalog';
import { MapWorld } from '../src/gen3/world/MapWorld';
import { PlayerRenderer } from '../src/render/PlayerRenderer';
import type { GameState } from '../src/gen3/GameState';

const BASE=0x08000000;

class RomReader implements MemoryReader{
  constructor(private readonly rom:Uint8Array){}
  readU8(address:number){const o=address-BASE;return o>=0&&o<this.rom.length?this.rom[o]:0}
  readU16(address:number){return this.readU8(address)|(this.readU8(address+1)<<8)}
  readU32(address:number){return (this.readU8(address)|this.readU8(address+1)<<8|this.readU8(address+2)<<16|this.readU8(address+3)*0x1000000)>>>0}
  readRange(address:number,length:number){const out=new Uint8Array(length);for(let i=0;i<length;i++)out[i]=this.readU8(address+i);return out}
}

function assert(condition:unknown,message:string):asserts condition{if(!condition)throw new Error(message)}

function makeState(catalog:MapCatalog):GameState{
  const map=catalog.get(3,0); assert(map,'Pallet missing');
  return {
    game:{game:'GEN 3',version:'Pokémon FireRed',region:'firered',revision:'1'},
    player:{x:12,y:10,z:0,direction:'DOWN',movementState:'idle'},
    map:{
      mapGroup:3,mapNumber:0,mapLayoutId:map.mapLayoutId,mapHeaderAddress:map.mapHeaderAddress,
      mapLayoutAddress:map.mapLayoutAddress,mapDataAddress:map.mapDataAddress,
      primaryTilesetAddress:map.primaryTilesetAddress,secondaryTilesetAddress:map.secondaryTilesetAddress,
      width:map.width,height:map.height,cellCount:map.width*map.height,blockSample:[],
      primaryTileset:{address:map.primaryTilesetAddress,isCompressed:false,isSecondary:false,tilesAddress:0,palettesAddress:0,metatilesAddress:0,metatileAttributesAddress:0},
      secondaryTileset:{address:map.secondaryTilesetAddress,isCompressed:false,isSecondary:true,tilesAddress:0,palettesAddress:0,metatilesAddress:0,metatileAttributesAddress:0},
      primaryMetatileSample:null,secondaryMetatileSample:null
    },
    objects:[],camera:{x:0,y:0,z:0,yaw:0,pitch:0}
  }
}

async function nextFrames(count:number){
  for(let i=0;i<count;i++) await new Promise(requestAnimationFrame);
}

function stats(samples:number[]){
  const sorted=[...samples].sort((a,b)=>a-b);
  const avg=samples.reduce((a,b)=>a+b,0)/samples.length;
  const median=sorted[Math.floor(sorted.length/2)];
  const p95=sorted[Math.floor(sorted.length*0.95)];
  return {avgMs:avg,medianMs:median,p95Ms:p95,fpsFromAvg:1000/avg,fpsFromMedian:1000/median};
}

async function main(){
 const rom=new Uint8Array(await(await fetch('/Pokemon - FireRed Version (USA, Europe) (Rev 1).gba')).arrayBuffer());
 assert(String.fromCharCode(rom[0xac],rom[0xad],rom[0xae],rom[0xaf])==='BPRE','wrong ROM');
 assert(rom[0xbc]===1,'wrong revision');

 const reader=new RomReader(rom);
 const adapter=new Gen3StateAdapter(reader,rom);
 const catalog=new MapCatalog();
 const probe=0;
 // Known FireRed Rev 1 Pallet layout from the real catalog pipeline.
 // Discover it by scanning map headers for Pallet's dimensions and connections.
 function u8(o:number){return o>=0&&o<rom.length?rom[o]:0}
 function u32(o:number){return (u8(o)|u8(o+1)<<8|u8(o+2)<<16|u8(o+3)*0x1000000)>>>0}
 function isPtr(a:number,s=1){const o=a-BASE;return o>=0&&o+s<=rom.length}
 function findPallet(){
   for(let off=0;off<=rom.length-0x1c;off+=4){
     const la=u32(off); if(!isPtr(la,0x18))continue;
     const lo=la-BASE; if(u32(lo)!==24||u32(lo+4)!==20)continue;
     const cp=u32(off+0x0c); if(!isPtr(cp,8))continue;
     const co=cp-BASE,n=u32(co)|0;if(n<1||n>64)continue;
     const da=u32(co+4);if(!isPtr(da,n*0xc))continue;
     let a=false,b=false;
     for(let i=0;i<n;i++){const e=da-BASE+i*0xc;const d=u8(e),o=(u8(e+4)|u8(e+5)<<8|u8(e+6)<<16|u8(e+7)*0x1000000)|0,g=u8(e+8),m=u8(e+9);if(d===2&&o===0&&g===3&&m===19)a=true;if(d===1&&o===0&&g===3&&m===39)b=true}
     if(a&&b)return {layoutAddress:la,layoutId:u8(off+0x12)|u8(off+0x13)<<8};
   }
   return null;
 }
 const anchor=findPallet(); assert(anchor,'Pallet anchor missing');
 const count=catalog.buildGen3FromRom(rom,{mapGroup:3,mapNumber:0,mapLayoutId:anchor.layoutId,mapLayoutAddress:anchor.layoutAddress});
 assert(count===425,'catalog count '+count);
 const world=new MapWorld(catalog);
 assert(world.buildFrom(3,0)===37,'connected world regression');

 const state=makeState(catalog);
 const fake={readState:()=>state,getMapRenderData:adapter.getMapRenderData.bind(adapter)} as unknown as Gen3StateAdapter;
 const container=document.querySelector('#sceneContainer') as HTMLElement;
 const player=new PlayerRenderer(container,fake,rom);

 await nextFrames(180);
 const samples:number[]=[];
 let last=performance.now();
 await new Promise<void>(resolve=>{
   let n=0;
   const tick=(now:number)=>{
     if(n>0)samples.push(now-last);
     last=now;n++;
     if(n<=361)requestAnimationFrame(tick); else resolve();
   };
   requestAnimationFrame(tick);
 });
 const renderer=(player as unknown as {renderer:THREE.WebGLRenderer}).renderer;
 const gl=renderer.getContext();
 const result={
   pass:true,
   catalogCount:count,
   connectedCount:world.getPositionedMaps().length,
   sampleCount:samples.length,
   frame:stats(samples),
   renderer:{
     webgl2:typeof WebGL2RenderingContext!=='undefined'&&gl instanceof WebGL2RenderingContext,
     pixelRatio:renderer.getPixelRatio(),
     calls:renderer.info.render.calls,
     triangles:renderer.info.render.triangles,
     textures:renderer.info.memory.textures,
     geometries:renderer.info.memory.geometries
   }
 };
 player.destroy();
 document.body.dataset.pass='true';
 document.querySelector('#out')!.textContent=JSON.stringify(result,null,2);
}
main().catch(e=>{document.body.dataset.pass='false';document.querySelector('#out')!.textContent=JSON.stringify({pass:false,error:String(e)},null,2);throw e});
