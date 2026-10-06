import * as THREE from 'three';
import { MapCatalog } from '../src/gen3/world/MapCatalog';
import { MapWorld } from '../src/gen3/world/MapWorld';
import { Gen3StateAdapter } from '../src/gen3/Gen3StateAdapter';
import { PlayerRenderer } from '../src/render/PlayerRenderer';
import type { MemoryReader } from '../src/gen3/MemoryReader';
import type { GameState } from '../src/gen3/GameState';

const BASE=0x08000000;

class RomReader implements MemoryReader {
  constructor(private readonly rom:Uint8Array){}
  readU8(a:number){const o=a-BASE;return o>=0&&o<this.rom.length?this.rom[o]:0}
  readU16(a:number){return this.readU8(a)|(this.readU8(a+1)<<8)}
  readU32(a:number){return (this.readU8(a)|this.readU8(a+1)<<8|this.readU8(a+2)<<16|this.readU8(a+3)*0x1000000)>>>0}
  readRange(a:number,n:number){const out=new Uint8Array(n);for(let i=0;i<n;i++)out[i]=this.readU8(a+i);return out}
}

function u8(r:RomReader,a:number){return r.readU8(a)}
function u32(r:RomReader,a:number){return r.readU32(a)}
function fnv(data:Uint8Array){let h=2166136261;for(const b of data){h^=b;h=Math.imul(h,16777619)}return h>>>0}
function makeState(map:any,region='firered'):GameState{return {
 game:{game:'GEN 3',version:'Pokémon FireRed',region,revision:'1'},
 player:{x:12,y:10,z:0,direction:'DOWN',movementState:'idle'},
 map:{mapGroup:map.mapGroup,mapNumber:map.mapNumber,mapLayoutId:map.mapLayoutId,mapHeaderAddress:map.mapHeaderAddress,mapLayoutAddress:map.mapLayoutAddress,mapDataAddress:map.mapDataAddress,primaryTilesetAddress:map.primaryTilesetAddress,secondaryTilesetAddress:map.secondaryTilesetAddress,width:map.width,height:map.height,cellCount:map.width*map.height,blockSample:[],primaryTileset:{address:map.primaryTilesetAddress,isCompressed:true,isSecondary:false,tilesAddress:0,palettesAddress:0,metatilesAddress:0,metatileAttributesAddress:0},secondaryTileset:{address:map.secondaryTilesetAddress,isCompressed:true,isSecondary:true,tilesAddress:0,palettesAddress:0,metatilesAddress:0,metatileAttributesAddress:0},primaryMetatileSample:null,secondaryMetatileSample:null},
 objects:[],camera:{x:0,y:0,z:0,yaw:0,pitch:0}
}}
async function main(){
 const rom=new Uint8Array(await (await fetch('/Pokemon - FireRed Version (USA, Europe) (Rev 1).gba')).arrayBuffer());
 const reader=new RomReader(rom);
 if(String.fromCharCode(rom[0xac],rom[0xad],rom[0xae],rom[0xaf])!=='BPRE'||rom[0xbc]!==1)throw new Error('Wrong ROM');

 // Pallet is used only as a valid, independent anchor for the global catalog.
 // Find its layout/header through the same real map connection signatures.
 let palletLayout=0,palletId=0;
 for(let o=0;o+0x1c<=rom.length;o+=4){
   const h=BASE+o, la=u32(reader,h);
   if(la<BASE||la>=BASE+rom.length)continue;
   const lo=la-BASE;if(u32(reader,la)!==24||u32(reader,la+4)!==20)continue;
   const cp=u32(reader,h+0x0c);if(cp<BASE||cp>=BASE+rom.length)continue;
   const co=cp-BASE,n=reader.readU32(cp)|0;if(n<1||n>64)continue;
   const da=reader.readU32(cp+4)-BASE;if(da<0||da+n*0xc>rom.length)continue;
   let a=false,b=false;
   for(let i=0;i<n;i++){const e=da+i*0xc;const d=reader.readU8(BASE+e),off=reader.readU32(BASE+e+4)|0,g=reader.readU8(BASE+e+8),m=reader.readU8(BASE+e+9);if(d===2&&g===3&&m===19&&off===0)a=true;if(d===1&&g===3&&m===39&&off===0)b=true}
   if(a&&b){palletLayout=la;palletId=reader.readU16(h+0x12);break}
 }
 if(!palletLayout)throw new Error('Pallet anchor not found');

 const catalog=new MapCatalog();
 const count=catalog.buildGen3FromRom(rom,{mapGroup:3,mapNumber:0,mapLayoutId:palletId,mapLayoutAddress:palletLayout});
 if(count!==425)throw new Error('Catalog count '+count);

 const pallet=catalog.get(3,0),route1=catalog.get(3,19),viridian=catalog.get(3,1),cinnabar=catalog.get(3,8),ruin=catalog.get(3,61);
 if(!pallet||!route1||!viridian||!cinnabar||!ruin)throw new Error('Required map missing');

 const badAddress=BASE+0x00338378;
 if(cinnabar.mapDataAddress===badAddress)throw new Error('Cinnabar still points to beta map 0x00338378');

 if(cinnabar.mapLayoutId!==86)throw new Error('Cinnabar layout id '+cinnabar.mapLayoutId);
 if(cinnabar.width!==24||cinnabar.height!==20)throw new Error('Cinnabar dimensions wrong');

 const connKey=(c:any)=>c.direction+':'+c.mapGroup+':'+c.mapNumber+':'+c.offset;
 const gotCinnabar=new Set(cinnabar.connections.map(connKey));
 for(const expected of ['NORTH:3:40:0','EAST:3:38:0'])if(!gotCinnabar.has(expected))throw new Error('Missing Cinnabar connection '+expected);

 if(pallet.width!==24||pallet.height!==20)throw new Error('Pallet regressed');
 if(route1.width!==24||route1.height!==40)throw new Error('Route1 regressed');
 if(viridian.width!==48||viridian.height!==40)throw new Error('Viridian regressed');

 const world=new MapWorld(catalog);
 const connected=world.buildFrom(3,0);
 if(connected!==37)throw new Error('Connected count '+connected);
 if(!world.getWorldPosition(3,8))throw new Error('Cinnabar not positioned');
 if(world.getWorldPosition(3,61)!==null)throw new Error('Ruin Valley incorrectly glued');

 const adapter=new Gen3StateAdapter(reader,rom);
 const render=adapter.getMapRenderData(cinnabar.mapDataAddress,cinnabar.width,cinnabar.height,cinnabar.primaryTilesetAddress,cinnabar.secondaryTilesetAddress);
 const betaRender=adapter.getMapRenderData(badAddress,cinnabar.width,cinnabar.height,cinnabar.primaryTilesetAddress,cinnabar.secondaryTilesetAddress);
 if(!render)throw new Error('Cinnabar render null');
 if(!betaRender)throw new Error('Beta comparison render null');

 const visualData=new Uint8Array(render.blocks.length*2);
 new DataView(visualData.buffer).setUint16(0,render.blocks[0]?.metatileId??0,true);
 const cinnabarFingerprint=fnv(new Uint8Array(render.blocks.map(b=>b.metatileId&255)));
 const betaFingerprint=fnv(new Uint8Array(betaRender.blocks.map(b=>b.metatileId&255)));
 if(cinnabarFingerprint===betaFingerprint)throw new Error('Cinnabar still fingerprints exactly like beta map data');

 const container=document.createElement('div');container.style.width='1200px';container.style.height='800px';document.body.appendChild(container);
 const fake={readState:()=>makeState(pallet),getMapRenderData:adapter.getMapRenderData.bind(adapter)} as unknown as Gen3StateAdapter;
 const renderer=new PlayerRenderer(container,fake,rom);
 for(let i=0;i<30;i++)await new Promise(requestAnimationFrame);
 const internal=renderer as unknown as {mapVisuals:Map<string,{baseTexture:THREE.DataTexture}>,mapWorld:MapWorld};
 const cinnabarVisual=internal.mapVisuals.get('3:8');
 if(!cinnabarVisual)throw new Error('PlayerRenderer did not build Cinnabar');
 if(internal.mapVisuals.size!==37)throw new Error('PlayerRenderer visual count '+internal.mapVisuals.size);
 if(cinnabarVisual.baseTexture.image.width!==384||cinnabarVisual.baseTexture.image.height!==320)throw new Error('Cinnabar texture size wrong');
 renderer.destroy();

 const result={pass:true,catalogCount:count,connectedCount:connected,visualCount:37,cinnabar:{mapDataAddress:'0x'+cinnabar.mapDataAddress.toString(16),betaAddress:'0x'+badAddress.toString(16),layoutId:cinnabar.mapLayoutId,size:[cinnabar.width,cinnabar.height],connections:cinnabar.connections,blockFingerprint:cinnabarFingerprint,betaFingerprint},pallet:{size:[pallet.width,pallet.height]},route1:{size:[route1.width,route1.height]},viridian:{size:[viridian.width,viridian.height]},ruinValleyPosition:world.getWorldPosition(3,61)};
 document.body.dataset.pass='true';document.querySelector('#out')!.textContent=JSON.stringify(result,null,2);
}
main().catch(e=>{document.body.dataset.pass='false';document.querySelector('#out')!.textContent=JSON.stringify({pass:false,error:String(e)},null,2);throw e})
