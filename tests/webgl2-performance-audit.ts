import * as THREE from 'three';
import { Gen3StateAdapter } from '../src/gen3/Gen3StateAdapter';
import { MapCatalog } from '../src/gen3/world/MapCatalog';
import { MapWorld } from '../src/gen3/world/MapWorld';
import { PlayerRenderer } from '../src/render/PlayerRenderer';
import type { MemoryReader } from '../src/gen3/MemoryReader';
import type { GameState } from '../src/gen3/GameState';

const BASE=0x08000000, BAD=0x00338378;
class RomReader implements MemoryReader{
 constructor(private readonly b:Uint8Array){}
 readU8(a:number){const o=a-BASE;return o>=0&&o<this.b.length?this.b[o]:0}
 readU16(a:number){return this.readU8(a)|this.readU8(a+1)<<8}
 readU32(a:number){return (this.readU8(a)|this.readU8(a+1)<<8|this.readU8(a+2)<<16|this.readU8(a+3)*0x1000000)>>>0}
 readRange(a:number,n:number){const r=new Uint8Array(n);for(let i=0;i<n;i++)r[i]=this.readU8(a+i);return r}
}
function u8(b:Uint8Array,o:number){return b[o]??0}
function u16(b:Uint8Array,o:number){return u8(b,o)|u8(b,o+1)<<8}
function u32(b:Uint8Array,o:number){return (u8(b,o)|u8(b,o+1)<<8|u8(b,o+2)<<16|u8(b,o+3)*0x1000000)>>>0}
function i32(b:Uint8Array,o:number){return u32(b,o)|0}
function ptr(b:Uint8Array,a:number,n=1){const o=a-BASE;return o>=0&&o+n<=b.length}
function findCinnabarHeader(b:Uint8Array){
 for(let o=0;o<=b.length-0x1c;o+=4){
  const la=u32(b,o); if(!ptr(b,la,0x18))continue;
  const lo=la-BASE; if(u32(b,lo)!==24||u32(b,lo+4)!==20)continue;
  const ca=u32(b,o+0xc); if(!ptr(b,ca,8))continue;
  const co=ca-BASE,n=i32(b,co); if(n<2||n>64)continue;
  const da=u32(b,co+4); if(!ptr(b,da,n*0xc))continue;
  let north=false,east=false;
  const d=da-BASE;
  for(let i=0;i<n;i++){const e=d+i*0xc,dir=u8(b,e),off=i32(b,e+4),g=u8(b,e+8),m=u8(b,e+9);if(dir===2&&off===0&&g===3&&m===40)north=true;if(dir===4&&off===0&&g===3&&m===38)east=true}
  if(north&&east)return{layoutAddress:la,layoutId:u16(b,o+0x12)}
 }
 throw new Error('real Cinnabar header not found')
}
function state(c:MapCatalog):GameState{
 const m=c.get(3,8);if(!m)throw new Error('Cinnabar missing');
 return {game:{game:'GEN 3',version:'Pokémon FireRed',region:'firered',revision:'1'},player:{x:12,y:10,z:0,direction:'DOWN',movementState:'idle'},map:{mapGroup:3,mapNumber:8,mapLayoutId:m.mapLayoutId,mapHeaderAddress:m.mapHeaderAddress,mapLayoutAddress:m.mapLayoutAddress,mapDataAddress:m.mapDataAddress,primaryTilesetAddress:m.primaryTilesetAddress,secondaryTilesetAddress:m.secondaryTilesetAddress,width:m.width,height:m.height,cellCount:m.width*m.height,blockSample:[],primaryTileset:{address:m.primaryTilesetAddress,isCompressed:false,isSecondary:false,tilesAddress:0,palettesAddress:0,metatilesAddress:0,metatileAttributesAddress:0},secondaryTileset:{address:m.secondaryTilesetAddress,isCompressed:false,isSecondary:true,tilesAddress:0,palettesAddress:0,metatilesAddress:0,metatileAttributesAddress:0},primaryMetatileSample:null,secondaryMetatileSample:null},objects:[],camera:{x:0,y:0,z:0,yaw:0,pitch:0}}
}
async function main(){
 const rom=new Uint8Array(await(await fetch('/Pokemon - FireRed Version (USA, Europe) (Rev 1).gba')).arrayBuffer());
 if(String.fromCharCode(rom[0xac],rom[0xad],rom[0xae],rom[0xaf])!=='BPRE'||rom[0xbc]!==1)throw new Error('wrong FireRed ROM');
 const a=findCinnabarHeader(rom), catalog=new MapCatalog();
 if(catalog.buildGen3FromRom(rom,{mapGroup:3,mapNumber:8,mapLayoutId:a.layoutId,mapLayoutAddress:a.layoutAddress})!==425)throw new Error('catalog != 425');
 const m=catalog.get(3,8)!; const bad=BASE+BAD;
 if(m.mapDataAddress===bad||m.mapLayoutAddress===bad||m.mapHeaderAddress===bad)throw new Error('Cinnabar uses forbidden beta $00338378');
 const world=new MapWorld(catalog);if(world.buildFrom(3,0)!==37||!world.hasPosition(3,8)||world.hasPosition(3,61))throw new Error('world regression');
 const adapter=new Gen3StateAdapter(new RomReader(rom),rom);
 if(!adapter.getMapRenderData(m.mapDataAddress,m.width,m.height,m.primaryTilesetAddress,m.secondaryTilesetAddress))throw new Error('Cinnabar render data failed');
 const fake={readState:()=>state(catalog),getMapRenderData:adapter.getMapRenderData.bind(adapter),getMemoryReader:()=>new RomReader(rom)} as unknown as Gen3StateAdapter;
 const pr=new PlayerRenderer(document.querySelector('#sceneContainer') as HTMLElement,fake,rom);
 await new Promise<void>(r=>requestAnimationFrame(()=>r())); for(let i=0;i<120;i++)await new Promise<void>(r=>requestAnimationFrame(()=>r()));
 const internal=pr as unknown as {renderer:THREE.WebGLRenderer,mapVisuals:Map<string,unknown>};
 if(!(internal.renderer.getContext() instanceof WebGL2RenderingContext))throw new Error('renderer is not WebGL2');
 if(!internal.mapVisuals.has('3:8')||internal.mapVisuals.size!==37)throw new Error('Cinnabar/world visuals regression');
 const warm=internal.renderer.info.render.calls;
 for(let i=0;i<60;i++)await new Promise<void>(r=>requestAnimationFrame(()=>r()));
 const idle=internal.renderer.info.render.calls;
 if(idle!==warm)throw new Error('idle rendering did not stop');
 const out={pass:true,webgl2:true,catalog:425,connectedMaps:37,renderedMaps:internal.mapVisuals.size,cinnabar:{mapHeaderAddress:'0x'+m.mapHeaderAddress.toString(16),mapLayoutAddress:'0x'+m.mapLayoutAddress.toString(16),mapDataAddress:'0x'+m.mapDataAddress.toString(16),primaryTilesetAddress:'0x'+m.primaryTilesetAddress.toString(16),secondaryTilesetAddress:'0x'+m.secondaryTilesetAddress.toString(16),forbiddenBetaAddress:'0x'+bad.toString(16)},drawCallsWarmup:warm,drawCallsIdle:idle,pixelRatio:internal.renderer.getPixelRatio()};
 pr.destroy();document.body.dataset.pass='true';document.querySelector('#output')!.textContent=JSON.stringify(out,null,2)
}
main().catch(e=>{document.body.dataset.pass='false';document.querySelector('#output')!.textContent=JSON.stringify({pass:false,error:String(e)},null,2);throw e});
