import { MapCatalog } from '../src/gen3/world/MapCatalog';
import { MapWorld } from '../src/gen3/world/MapWorld';
import { PlayerRenderer } from '../src/render/PlayerRenderer';
import * as THREE from 'three';
import type { Gen3StateAdapter } from '../src/gen3/Gen3StateAdapter';
import type { MemoryReader } from '../src/gen3/MemoryReader';
import type { GameState } from '../src/gen3/GameState';

const BASE=0x08000000;
const EXPECTED={header:0x08350768,layout:0x082e3b90,mapData:0x082e37d0,primary:0x082d4b04,secondary:0x082d4bdc,layoutId:86,width:24,height:20};
class RomReader implements MemoryReader{
 constructor(private rom:Uint8Array){}
 readU8(a:number){const o=a-BASE;return o>=0&&o<this.rom.length?this.rom[o]:0}
 readU16(a:number){return this.readU8(a)|(this.readU8(a+1)<<8)}
 readU32(a:number){return (this.readU8(a)|this.readU8(a+1)<<8|this.readU8(a+2)<<16|this.readU8(a+3)*0x1000000)>>>0}
 readRange(a:number,n:number){const r=new Uint8Array(n);for(let i=0;i<n;i++)r[i]=this.readU8(a+i);return r}
}
function assert(v:unknown,m:string):asserts v{if(!v)throw new Error(m)}
function fnv(bytes:Uint8Array){let h=2166136261;for(const b of bytes){h^=b;h=Math.imul(h,16777619)}return h>>>0}
function makeState(wrong:any):GameState{
 const map:any={
  mapGroup:3,mapNumber:8,mapLayoutId:wrong.mapLayoutId,mapHeaderAddress:wrong.mapHeaderAddress??0,mapLayoutAddress:wrong.mapLayoutAddress,
  mapDataAddress:wrong.mapDataAddress??0x08338378,
  primaryTilesetAddress:wrong.primaryTilesetAddress??EXPECTED.primary,
  secondaryTilesetAddress:wrong.secondaryTilesetAddress??EXPECTED.secondary,
  width:wrong.width??48,height:wrong.height??40,cellCount:(wrong.width??48)*(wrong.height??40),
  blockSample:[],
  primaryTileset:{address:wrong.primaryTilesetAddress??EXPECTED.primary,isCompressed:true,isSecondary:false,tilesAddress:0,palettesAddress:0,metatilesAddress:0,metatileAttributesAddress:0},
  secondaryTileset:{address:wrong.secondaryTilesetAddress??EXPECTED.secondary,isCompressed:true,isSecondary:true,tilesAddress:0,palettesAddress:0,metatilesAddress:0,metatileAttributesAddress:0},
  primaryMetatileSample:null,secondaryMetatileSample:null
 };
 return {
  game:{game:'GEN 3',version:'Pokémon FireRed',region:'firered',revision:'1'},
  player:{x:12,y:10,z:0,direction:'DOWN',movementState:'idle'},
  map,objects:[],camera:{x:0,y:0,z:0,yaw:0,pitch:0}
 } as GameState;
}
async function main(){
 const rom=new Uint8Array(await (await fetch('/Pokemon - FireRed Version (USA, Europe) (Rev 1).gba')).arrayBuffer());

 // Build the baseline from the real Pallet anchor to obtain a valid unrelated
 // map definition to inject into the simulated bad Cinnabar state.
 const baseCatalog=new MapCatalog();
 const baseCount=baseCatalog.buildGen3FromRom(rom,{
  mapGroup:3,mapNumber:0,mapLayoutId:78,mapLayoutAddress:0x082dd530
 });
 assert(baseCount===425,'baseline catalog build failed');
 const ruin=baseCatalog.get(3,61);
 assert(ruin,'Ruin Valley missing');

 const wrongState=makeState({
  mapLayoutId:ruin.mapLayoutId,
  mapLayoutAddress:ruin.mapLayoutAddress,
  mapDataAddress:0x08338378,
  width:48,
  height:40
 });

 const rawAdapter=new (await import('../src/gen3/Gen3StateAdapter')).Gen3StateAdapter(new RomReader(rom),rom);
 const fakeAdapter={
  readState:()=>wrongState,
  getMapRenderData:rawAdapter.getMapRenderData.bind(rawAdapter)
 } as unknown as Gen3StateAdapter;

 const container=document.querySelector('#sceneContainer') as HTMLElement;
 const renderer=new PlayerRenderer(container,fakeAdapter,rom);

 const internal=renderer as unknown as {
  mapCatalog:MapCatalog;
  mapWorld:MapWorld;
  mapVisuals:Map<string,{baseTexture:THREE.DataTexture;overlayTexture:THREE.DataTexture;}>;
 };

 let visual:any=null;
 for(let i=0;i<180;i++){
  await new Promise(r=>requestAnimationFrame(()=>r(null)));
  visual=internal.mapVisuals.get('3:8') ?? null;
  if(visual)break;
 }

 assert(internal.mapCatalog.getAll().length===425,'catalog did not reach 425');
 const cinnabar=internal.mapCatalog.get(3,8);
 assert(cinnabar,'canonical Cinnabar missing');
 assert(cinnabar.mapHeaderAddress===EXPECTED.header,'wrong canonical Cinnabar header');
 assert(cinnabar.mapLayoutAddress===EXPECTED.layout,'wrong canonical Cinnabar layout');
 assert(cinnabar.mapDataAddress===EXPECTED.mapData,'wrong canonical Cinnabar data');
 assert(cinnabar.primaryTilesetAddress===EXPECTED.primary,'wrong canonical Cinnabar primary');
 assert(cinnabar.secondaryTilesetAddress===EXPECTED.secondary,'wrong canonical Cinnabar secondary');
 assert(cinnabar.width===EXPECTED.width&&cinnabar.height===EXPECTED.height,'wrong canonical Cinnabar dimensions');

 const worldCount=internal.mapWorld.getPositionedMaps().length;
 assert(worldCount===37,'connected world changed: '+worldCount);
 assert(internal.mapWorld.hasPosition(3,8),'Cinnabar lost from connected world');
 assert(!internal.mapWorld.hasPosition(3,61),'Ruin Valley wrongly glued into Kanto');

 assert(visual,'PlayerRenderer did not build Cinnabar visual');
 const bytes=visual.baseTexture.image.data as Uint8Array;
 const hash=fnv(bytes);
 assert(hash===1144039168,'wrong final Cinnabar texture hash: '+hash);

 const result={
  pass:true,
  simulatedBadState:{
   mapGroup:3,mapNumber:8,mapLayoutAddress:'0x'+wrongState.map.mapLayoutAddress.toString(16),
   mapDataAddress:'0x'+wrongState.map.mapDataAddress.toString(16),
   dimensions:[wrongState.map.width,wrongState.map.height]
  },
  repairedCinnabar:{
   header:'0x'+cinnabar.mapHeaderAddress.toString(16),
   layout:'0x'+cinnabar.mapLayoutAddress.toString(16),
   mapData:'0x'+cinnabar.mapDataAddress.toString(16),
   primary:'0x'+cinnabar.primaryTilesetAddress.toString(16),
   secondary:'0x'+cinnabar.secondaryTilesetAddress.toString(16),
   dimensions:[cinnabar.width,cinnabar.height],
   textureHash:hash
  },
  world:{
   positionedCount:worldCount,
   ruinValleyPosition:internal.mapWorld.getWorldPosition(3,61)
  }
 };
 document.querySelector('#out')!.textContent=JSON.stringify(result,null,2);
 document.body.dataset.pass='true';
 renderer.destroy();
}
main().catch(e=>{document.querySelector('#out')!.textContent=JSON.stringify({pass:false,error:String(e)},null,2);document.body.dataset.pass='false'});