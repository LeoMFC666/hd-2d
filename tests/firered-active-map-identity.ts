import * as THREE from 'three';
import { MapCatalog } from '../src/gen3/world/MapCatalog';
import { PlayerRenderer } from '../src/render/PlayerRenderer';
import type { Gen3StateAdapter } from '../src/gen3/Gen3StateAdapter';
import type { GameState } from '../src/gen3/GameState';
import type { MemoryReader } from '../src/gen3/MemoryReader';

const BASE=0x08000000;

class Reader implements MemoryReader {
  constructor(private readonly rom: Uint8Array){}
  readU8(address:number){const o=address-BASE;return o>=0&&o<this.rom.length?this.rom[o]:0}
  readU16(address:number){return this.readU8(address)|(this.readU8(address+1)<<8)}
  readU32(address:number){return (this.readU8(address)|(this.readU8(address+1)<<8)|(this.readU8(address+2)<<16)|(this.readU8(address+3)*0x1000000))>>>0}
  readRange(address:number,length:number){const out=new Uint8Array(length);for(let i=0;i<length;i++)out[i]=this.readU8(address+i);return out}
}

function u8(rom:Uint8Array,o:number){return o>=0&&o<rom.length?rom[o]:0}
function u16(rom:Uint8Array,o:number){return u8(rom,o)|(u8(rom,o+1)<<8)}
function u32(rom:Uint8Array,o:number){return (u8(rom,o)|(u8(rom,o+1)<<8)|(u8(rom,o+2)<<16)|(u8(rom,o+3)*0x1000000))>>>0}
function isPtr(rom:Uint8Array,address:number,size=1){const o=address-BASE;return o>=0&&o+size<=rom.length}
function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function findPalletAnchor(rom:Uint8Array){
  for(let off=0;off<=rom.length-0x1c;off+=4){
    const layout=u32(rom,off);
    if(!isPtr(rom,layout,0x18))continue;
    const lo=layout-BASE;
    if(u32(rom,lo)!==24||u32(rom,lo+4)!==20)continue;
    const mapData=u32(rom,lo+0x0c);
    const primary=u32(rom,lo+0x10);
    const secondary=u32(rom,lo+0x14);
    if(
      !isPtr(rom,mapData,24*20*2) ||
      !isPtr(rom,primary,4) ||
      !isPtr(rom,secondary,4)
    ) continue;
    const cp=u32(rom,off+0x0c);
    if(!isPtr(rom,cp,8))continue;
    const co=cp-BASE,n=u32(rom,co)|0;
    if(n<2||n>64)continue;
    const dp=u32(rom,co+4);
    if(!isPtr(rom,dp,n*0xc))continue;
    let north=false,south=false;
    for(let i=0;i<n;i++){
      const e=dp-BASE+i*0xc;
      const dir=u8(rom,e),ofs=u32(rom,e+4)|0,g=u8(rom,e+8),m=u8(rom,e+9);
      if(dir===2&&ofs===0&&g===3&&m===19)north=true;
      if(dir===1&&ofs===0&&g===3&&m===39)south=true;
    }
    if(north&&south)return {mapLayoutAddress:layout,mapLayoutId:u16(rom,off+0x12)};
  }
  return null;
}

function makeState(mapGroup:number,mapNumber:number,cinnabar:any):GameState{
  return {
    game:{game:'GEN 3',version:'Pokémon FireRed',region:'firered',revision:'1'},
    player:{x:12,y:10,z:0,direction:'DOWN',movementState:'idle'},
    map:{
      mapGroup,mapNumber,
      mapLayoutId:cinnabar.mapLayoutId,
      mapHeaderAddress:0,
      mapLayoutAddress:cinnabar.mapLayoutAddress,
      mapDataAddress:cinnabar.mapDataAddress,
      primaryTilesetAddress:cinnabar.primaryTilesetAddress,
      secondaryTilesetAddress:cinnabar.secondaryTilesetAddress,
      width:cinnabar.width,height:cinnabar.height,cellCount:cinnabar.width*cinnabar.height,
      blockSample:[],
      primaryTileset:{address:0,isCompressed:false,isSecondary:false,tilesAddress:0,palettesAddress:0,metatilesAddress:0,metatileAttributesAddress:0},
      secondaryTileset:{address:0,isCompressed:true,isSecondary:true,tilesAddress:0,palettesAddress:0,metatilesAddress:0,metatileAttributesAddress:0},
      primaryMetatileSample:null,secondaryMetatileSample:null
    },
    objects:[],
    camera:{x:0,y:0,z:0,yaw:0,pitch:0}
  };
}

function fakeRenderData(){
  const pixels=new Uint8ClampedArray(16*16*4);
  const graphic={metatileId:0,layerType:1,width:16,height:16,pixels,basePixels:pixels,foregroundPixels:pixels};
  return {blocks:Array.from({length:24*20},()=>({raw:0,metatileId:0,collision:0,elevation:0})),graphics:new Map([[0,graphic]])};
}

async function runCase(
  rom:Uint8Array,
  catalog:MapCatalog,
  state:GameState,
){
  let current=state;
  const adapter={
    readState:()=>current,
    getMapRenderData:()=>fakeRenderData(),
  } as unknown as Gen3StateAdapter;
  const container=document.createElement('div');
  container.style.width='900px'; container.style.height='600px';
  document.querySelector('#scene')!.appendChild(container);
  const renderer=new PlayerRenderer(container,adapter,rom);
  await new Promise(requestAnimationFrame);
  await new Promise(requestAnimationFrame);
  const internal=renderer as unknown as {
    activeMapKey:string;
    mapWorld:{getPositionedMaps:()=>any[]};
  };
  const result={activeMapKey:internal.activeMapKey,positionedCount:internal.mapWorld.getPositionedMaps().length};
  renderer.destroy();
  container.remove();
  return result;
}

async function main(){
  const rom=new Uint8Array(await (await fetch('/Pokemon - FireRed Version (USA, Europe) (Rev 1).gba')).arrayBuffer());
  assert(String.fromCharCode(rom[0xac],rom[0xad],rom[0xae],rom[0xaf])==='BPRE','wrong ROM');
  assert(rom[0xbc]===1,'wrong revision');

  const anchor=findPalletAnchor(rom);
  assert(anchor,'Pallet anchor not found independently');

  const catalog=new MapCatalog();
  assert(catalog.buildGen3FromRom(rom,anchor)===425,'catalog failed');
  const cinnabar=catalog.get(3,8);
  const ruin=catalog.get(3,61);
  assert(cinnabar&&ruin,'required maps missing');

  const normalCinnabar=makeState(3,8,cinnabar);
  const mismatch=makeState(3,61,cinnabar);
  const normalRuin=makeState(3,61,ruin);

  const a=await runCase(rom,catalog,normalCinnabar);
  const b=await runCase(rom,catalog,mismatch);
  const c=await runCase(rom,catalog,normalRuin);

  assert(a.activeMapKey==='3:8','normal Cinnabar changed: '+JSON.stringify(a));
  assert(b.activeMapKey==='3:8','mismatched Cinnabar did not resolve: '+JSON.stringify(b));
  assert(b.positionedCount===37,'mismatched Cinnabar did not build Kanto world: '+JSON.stringify(b));
  assert(c.activeMapKey==='3:61','normal Ruin Valley changed: '+JSON.stringify(c));

  const result={pass:true,normalCinnabar:a,mismatchedCinnabar:b,normalRuin:c};
  document.body.dataset.pass='true';
  document.querySelector('#out')!.textContent=JSON.stringify(result,null,2);
}
main().catch(e=>{document.body.dataset.pass='false';document.querySelector('#out')!.textContent=JSON.stringify({pass:false,error:String(e)},null,2);throw e});
