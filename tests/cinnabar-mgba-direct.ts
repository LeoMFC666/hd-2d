import * as THREE from 'three';
import { Gen3StateAdapter } from '../src/gen3/Gen3StateAdapter';
import type { MemoryReader } from '../src/gen3/MemoryReader';
import { MapCatalog } from '../src/gen3/world/MapCatalog';
import { MapWorld } from '../src/gen3/world/MapWorld';
import { PlayerRenderer } from '../src/render/PlayerRenderer';

const BASE=0x08000000;
const EWRAM_START=0x02000000;
const EWRAM_END=0x02040000;

declare global {
  interface Window {
    createMgbaModule?: (overrides: Record<string, unknown>) => Promise<any>;
  }
}

function hex(n:number):string {
  return '0x'+(n>>>0).toString(16).padStart(8,'0');
}

function hash(values:Uint8Array):number {
  let h=2166136261;
  for(const v of values){
    h^=v;
    h=Math.imul(h,16777619);
    h>>>=0;
  }
  return h>>>0;
}

function wait(ms:number):Promise<void>{
  return new Promise(r=>setTimeout(r,ms));
}

class RuntimeMemoryReader implements MemoryReader {
  constructor(private readonly mod:any){}
  readU8(address:number):number{
    return this.mod._mgbawasm_bus_read8(address)&0xff;
  }
  readU16(address:number):number{
    return this.mod._mgbawasm_bus_read16(address)&0xffff;
  }
  readU32(address:number):number{
    return this.mod._mgbawasm_bus_read32(address)>>>0;
  }
  readRange(address:number,length:number):Uint8Array{
    const out=new Uint8Array(length);
    for(let i=0;i<length;i++) out[i]=this.readU8(address+i);
    return out;
  }
}

async function loadClassicScript(src:string):Promise<void>{
  await new Promise<void>((resolve,reject)=>{
    const s=document.createElement('script');
    s.src=src;
    s.onload=()=>resolve();
    s.onerror=()=>reject(new Error('failed to load '+src));
    document.head.appendChild(s);
  });
}

async function waitFor(
  predicate:()=>boolean,
  timeoutMs:number,
  label:string,
):Promise<void>{
  const deadline=performance.now()+timeoutMs;
  while(performance.now()<deadline){
    if(predicate())return;
    await wait(100);
  }
  throw new Error('timeout waiting for '+label);
}

function readHexBytes(reader:MemoryReader,address:number,length:number):string{
  return Array.from(reader.readRange(address,length))
    .map(b=>b.toString(16).padStart(2,'0')).join(' ');
}

async function main(){
  const rom=new Uint8Array(await (await fetch('/Pokemon - FireRed Version (USA, Europe) (Rev 1).gba')).arrayBuffer());
  const save=new Uint8Array(await (await fetch('/firered.sav')).arrayBuffer());

  await loadClassicScript('/mgba/mgba.js');
  if(typeof window.createMgbaModule!=='function'){
    throw new Error('createMgbaModule was not exposed by mgba.js');
  }

  const mod=await window.createMgbaModule({
    locateFile(path:string){
      return '/mgba/'+path;
    },
  });

  mod._mgbawasm_init();
  const romPtr=mod._malloc(rom.length);
  mod.HEAPU8.set(rom,romPtr);
  const ok=mod._mgbawasm_load(
    romPtr,
    rom.length,
    0,
    0,
    0,
    0,
    1,
  );
  mod._free(romPtr);
  if(!ok) throw new Error('mGBA rejected FireRed ROM');

  const reader=new RuntimeMemoryReader(mod);
  if(
    typeof mod._mgbawasm_bus_read8!=='function' ||
    typeof mod._mgbawasm_bus_read16!=='function' ||
    typeof mod._mgbawasm_bus_read32!=='function'
  ){
    throw new Error('mGBA bus read exports are missing');
  }

  const adapter=new Gen3StateAdapter(reader,rom);

  const preState=adapter.readState();

  const savePtr=mod._malloc(save.length);
  mod.HEAPU8.set(save,savePtr);
  const saveOk=mod._mgbawasm_sram_load(savePtr,save.length);
  mod._free(savePtr);
  if(!saveOk) throw new Error('mGBA rejected firered.sav');

  mod._mgbawasm_reset();

  for(let i=0;i<240;i++){
    mod._mgbawasm_run_frame();
  }

  await waitFor(()=>{
    const state=adapter.readState();
    return state.map.mapGroup===3 && state.map.mapNumber===8 && state.map.mapLayoutAddress!==0;
  },10000,'Cinnabar active state');

  const state=adapter.readState();
  const c=state.map;

  const expectedCinnabarData=0x082e37d0;
  const betaData=0x08338378;

  const activeDataBytes=reader.readRange(c.mapDataAddress,32);
  const expectedDataBytes=reader.readRange(expectedCinnabarData,32);
  const betaBytes=reader.readRange(betaData,32);

  const expectedCinnabarLayout=0x082e3b90;
  const ewramCandidates=[];
  const ewramMatches=[];
  for(let address=EWRAM_START; address<=EWRAM_END-0x1c; address+=2){
    const layoutAddress=reader.readU32(address);
    const layoutId=reader.readU16(address+0x12);
    if(layoutId!==86) continue;
    const mapDataAddress=reader.readU32(layoutAddress+0x0c);
    if(
      layoutAddress>=BASE &&
      layoutAddress<BASE+rom.length &&
      mapDataAddress>=BASE &&
      mapDataAddress<BASE+rom.length
    ){
      const item={
        address:hex(address),
        layoutAddress:hex(layoutAddress),
        mapDataAddress:hex(mapDataAddress),
        connectionsAddress:hex(reader.readU32(address+0x0c)),
      };
      ewramCandidates.push(item);
      if(layoutAddress===expectedCinnabarLayout) ewramMatches.push(item);
    }
  }

  const catalog=new MapCatalog();
  const catalogCount=catalog.buildGen3FromRom(rom,{
    mapGroup:c.mapGroup,
    mapNumber:c.mapNumber,
    mapLayoutId:c.mapLayoutId,
    mapLayoutAddress:c.mapLayoutAddress,
  });

  const catCinnabar=catalog.get(3,8);

  const directRender=catCinnabar
    ? adapter.getMapRenderData(
        catCinnabar.mapDataAddress,
        catCinnabar.width,
        catCinnabar.height,
        catCinnabar.primaryTilesetAddress,
        catCinnabar.secondaryTilesetAddress,
      )
    : null;

  const world=new MapWorld(catalog);
  const connected=world.buildFrom(3,0);

  const container=document.createElement('div');
  container.style.width='960px';
  container.style.height='640px';
  document.body.appendChild(container);

  const renderer=new PlayerRenderer(container,adapter,rom);

  await waitFor(()=>{
    const intern=renderer as any;
    return !!intern.mapVisuals?.get('3:8');
  },15000,'PlayerRenderer Cinnabar visual');

  const intern=renderer as any;
  const visual=intern.mapVisuals.get('3:8');
  const textureData=visual.baseTexture.image.data as Uint8Array;

  const result={
    pass:true,
    runtimeState:{
      game:state.game,
      mapGroup:c.mapGroup,
      mapNumber:c.mapNumber,
      mapLayoutId:c.mapLayoutId,
      mapHeaderAddress:hex(c.mapHeaderAddress),
      mapLayoutAddress:hex(c.mapLayoutAddress),
      mapDataAddress:hex(c.mapDataAddress),
      primaryTilesetAddress:hex(c.primaryTilesetAddress),
      secondaryTilesetAddress:hex(c.secondaryTilesetAddress),
      size:[c.width,c.height],
    },
    memory:{
      expectedCinnabarData:hex(expectedCinnabarData),
      betaData:hex(betaData),
      activeDataHash:hash(activeDataBytes),
      expectedDataHash:hash(expectedDataBytes),
      betaDataHash:hash(betaBytes),
      activeEqualsExpected:hash(activeDataBytes)===hash(expectedDataBytes),
      activeEqualsBeta:hash(activeDataBytes)===hash(betaBytes),
      activeFirst32:Array.from(activeDataBytes),
      expectedFirst32:Array.from(expectedDataBytes),
      betaFirst32:Array.from(betaBytes),
    },
    catalog:{
      count:catalogCount,
      cinnabarData:catCinnabar?hex(catCinnabar.mapDataAddress):null,
      cinnabarLayout:catCinnabar?hex(catCinnabar.mapLayoutAddress):null,
      cinnabarSecondary:catCinnabar?hex(catCinnabar.secondaryTilesetAddress):null,
    },
    render:{
      directAvailable:!!directRender,
      directBlockHash:directRender
        ? hash(new Uint8Array(directRender.blocks.flatMap((b:any)=>[(b.metatileId&255),b.metatileId>>>8])))
        : null,
      playerRendererTextureHash:hash(textureData),
      playerRendererVisualSize:[visual.baseTexture.image.width,visual.baseTexture.image.height],
      visualCount:intern.mapVisuals.size,
      connectedCount:connected,
      cinnabarWorldPosition:intern.mapWorld.getWorldPosition(3,8),
    },
    ewramMapHeaderScan:{
      expectedCinnabarLayout:hex(expectedCinnabarLayout),
      candidateCount:ewramCandidates.length,
      exactCinnabarLayoutMatches:ewramMatches.length,
      candidates:ewramCandidates.slice(0,50),
      exactMatches:ewramMatches,
    },
    preSaveState:{
      mapGroup:preState.map.mapGroup,
      mapNumber:preState.map.mapNumber,
      mapLayoutId:preState.map.mapLayoutId,
    },
  };

  renderer.destroy();
  mod._mgbawasm_unload();

  document.body.dataset.pass='true';
  document.querySelector('#out')!.textContent=JSON.stringify(result,null,2);
}

main().catch(e=>{
  document.body.dataset.pass='false';
  document.querySelector('#out')!.textContent=JSON.stringify({
    pass:false,
    error:e instanceof Error?e.stack:String(e),
  },null,2);
});
