import { Gen3StateAdapter } from '../src/gen3/Gen3StateAdapter';
import type { MemoryReader } from '../src/gen3/MemoryReader';
import type { GameState } from '../src/gen3/GameState';
import { PlayerRenderer } from '../src/render/PlayerRenderer';

const BASE=0x08000000;
class RomMemoryReader implements MemoryReader{
 constructor(private rom:Uint8Array){}
 readU8(a:number){const o=a-BASE;return o>=0&&o<this.rom.length?this.rom[o]:0}
 readU16(a:number){return this.readU8(a)|(this.readU8(a+1)<<8)}
 readU32(a:number){return (this.readU8(a)|this.readU8(a+1)<<8|this.readU8(a+2)<<16|this.readU8(a+3)*0x1000000)>>>0}
 readRange(a:number,n:number){const r=new Uint8Array(n);for(let i=0;i<n;i++)r[i]=this.readU8(a+i);return r}
}
const state=(data:any):GameState=>data;
function makeState(map:any):GameState{
 return {
  game:{game:'GEN 3',version:'Pokémon FireRed',region:'firered',revision:'1'},
  player:{x:12,y:10,z:0,direction:'DOWN',movementState:'idle'},
  map:{...map,mapGroup:3,mapNumber:8,blockSample:[],cellCount:map.width*map.height,
   primaryTileset:{address:map.primaryTilesetAddress,isCompressed:false,isSecondary:false,tilesAddress:0,palettesAddress:0,metatilesAddress:0,metatileAttributesAddress:0},
   secondaryTileset:{address:map.secondaryTilesetAddress,isCompressed:false,isSecondary:true,tilesAddress:0,palettesAddress:0,metatilesAddress:0,metatileAttributesAddress:0},
   primaryMetatileSample:null,secondaryMetatileSample:null},
  objects:[],camera:{x:0,y:0,z:0,yaw:0,pitch:0}
 };
}
async function main(){
 const rom=new Uint8Array(await (await fetch('/Pokemon - FireRed Version (USA, Europe) (Rev 1).gba')).arrayBuffer());
 const reader=new RomMemoryReader(rom);
 const adapter=new Gen3StateAdapter(reader,rom);
 // Find the real Cinnabar static map definition using the same exact
 // dimensions + connection identity as the game.
 let header=0,layout=0,id=0;
 for(let off=0;off<=rom.length-0x1c;off+=4){
  const la=reader.readU32(BASE+off);
  const lo=la-BASE;
  if(lo<0||lo+0x18>rom.length||reader.readU32(la)!==24||reader.readU32(la+4)!==20)continue;
  const cp=reader.readU32(BASE+off+0xc);if(!cp)continue;
  const co=cp-BASE;if(co<0||co+8>rom.length)continue;
  const n=reader.readU32(cp)|0;if(n<2||n>64)continue;
  const dp=reader.readU32(cp+4);const d=dp-BASE;if(d<0||d+n*0xc>rom.length)continue;
  let north=false,east=false;
  for(let i=0;i<n;i++){const e=d+i*0xc,dir=reader.readU8(BASE+e),ofs=reader.readU32(BASE+e+4)|0,g=reader.readU8(BASE+e+8),m=reader.readU8(BASE+e+9);if(dir===2&&ofs===0&&g===3&&m===40)north=true;if(dir===4&&ofs===0&&g===3&&m===38)east=true}
  if(north&&east){header=BASE+off;layout=la;id=reader.readU16(BASE+off+0x12);break}
 }
 if(!layout)throw new Error('real Cinnabar anchor not found');
 const temp=adapter.getMapRenderData.bind(adapter);
 const renderCalls:{addr:number}[]=[];
 const fake={
  readState:()=>makeState({
   mapLayoutId:id,mapHeaderAddress:header,mapLayoutAddress:layout,
   mapDataAddress:reader.readU32(layout+0xc),
   primaryTilesetAddress:reader.readU32(layout+0x10),
   secondaryTilesetAddress:reader.readU32(layout+0x14),
   width:24,height:20,
  }),
  getMapRenderData:(a:number,w:number,h:number,p:number,s:number)=>{renderCalls.push({addr:a});return temp(a,w,h,p,s)},
  getMemoryReader:()=>reader,
 } as unknown as Gen3StateAdapter;
 const container=document.createElement('div');
 container.style.width='1000px';container.style.height='700px';document.body.appendChild(container);
 const renderer=new PlayerRenderer(container,fake,rom);
 const internal=renderer as any;
 for(let i=0;i<60;i++) await new Promise(requestAnimationFrame);
 const def=internal.mapCatalog.get(3,8);
 const visual=internal.mapVisuals.get('3:8');
 if(!def||!visual)throw new Error('Cinnabar visual did not initialize');
 const beta=0x08338378;
 const correct=def.mapDataAddress;
 if(correct===beta)throw new Error('Test ROM definition unexpectedly equals beta');
 visual.mapDataAddress=beta;
 internal.repairCinnabarVisual(fake.readState());
 for(let i=0;i<60;i++) await new Promise(requestAnimationFrame);
 const repaired=internal.mapVisuals.get('3:8');
 if(!repaired)throw new Error('Cinnabar visual was not rebuilt');
 const result={pass:repaired.mapDataAddress===correct,catalogMapData:'0x'+correct.toString(16),beta:'0x'+beta.toString(16),renderCalls:renderCalls.slice(-5),visualMapData:'0x'+repaired.mapDataAddress.toString(16),catalogCount:internal.mapCatalog.getAll().length,positionedCount:internal.mapWorld.getPositionedMaps().length};
 if(!result.pass)throw new Error(JSON.stringify(result));
 document.body.dataset.pass='true';document.querySelector('#out')!.textContent=JSON.stringify(result,null,2);
 renderer.destroy();
}
main().catch(e=>{document.body.dataset.pass='false';document.querySelector('#out')!.textContent=JSON.stringify({pass:false,error:String(e)},null,2);throw e});