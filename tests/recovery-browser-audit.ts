import { MapCatalog } from '../src/gen3/world/MapCatalog';
import { MapWorld } from '../src/gen3/world/MapWorld';
import { Gen3StateAdapter } from '../src/gen3/Gen3StateAdapter';
import type { MemoryReader } from '../src/gen3/MemoryReader';
import { PlayerRenderer } from '../src/render/PlayerRenderer';
import { TilesetAnimationController } from '../src/gen3/TilesetAnimationController';
import { MgbaEmulatorAdapter } from '../src/emulator/Emulator';

const BASE=0x08000000;
class RomMemoryReader implements MemoryReader{
  constructor(private readonly rom:Uint8Array){}
  readU8(a:number){const o=a-BASE;return o>=0&&o<this.rom.length?this.rom[o]:0}
  readU16(a:number){return this.readU8(a)|this.readU8(a+1)<<8}
  readU32(a:number){return (this.readU8(a)|this.readU8(a+1)<<8|this.readU8(a+2)<<16|this.readU8(a+3)*0x1000000)>>>0}
  readRange(a:number,n:number){const r=new Uint8Array(n);for(let i=0;i<n;i++)r[i]=this.readU8(a+i);return r}
}

function assert(v:unknown,msg:string):asserts v{if(!v)throw new Error(msg)}
function fnv(bytes:Uint8Array){let h=2166136261;for(const b of bytes){h^=b;h=Math.imul(h,16777619)}return h>>>0}

function findFireRedAnchor(rom:Uint8Array){
  const u8=(o:number)=>o>=0&&o<rom.length?rom[o]:0;
  const u16=(o:number)=>u8(o)|u8(o+1)<<8;
  const u32=(o:number)=>(u8(o)|u8(o+1)<<8|u8(o+2)<<16|u8(o+3)*0x1000000)>>>0;
  const ptr=(a:number,n=1)=>{const o=a-BASE;return o>=0&&o+n<=rom.length};
  for(let o=0;o<=rom.length-0x1c;o+=4){
    const la=u32(o); if(!ptr(la,0x18))continue;
    const lo=la-BASE; if(u32(lo)!==24||u32(lo+4)!==20)continue;
    const cp=u32(o+0x0c); if(!ptr(cp,8))continue;
    const co=cp-BASE,n=u32(co)|0; if(n<1||n>64)continue;
    const da=u32(co+4); if(!ptr(da,n*0xc))continue;
    let north=false,east=false;
    for(let i=0;i<n;i++){const e=da-BASE+i*0xc;const d=u8(e),of=u32(e+4)|0,g=u8(e+8),m=u8(e+9);
      if(d===2&&of===0&&g===3&&m===40)north=true;
      if(d===4&&of===0&&g===3&&m===38)east=true;
    }
    if(north&&east)return {mapGroup:3,mapNumber:8,mapLayoutId:u16(o+0x12),mapLayoutAddress:la};
  }
  throw new Error('FireRed Cinnabar anchor not found');
}

async function testStaticAndWorld(rom:Uint8Array){
  const reader=new RomMemoryReader(rom), adapter=new Gen3StateAdapter(reader,rom);
  const catalog=new MapCatalog(), anchor=findFireRedAnchor(rom);
  const count=catalog.buildGen3FromRom(rom,{mapGroup:3,mapNumber:0,mapLayoutId:anchor.mapLayoutId,mapLayoutAddress:anchor.mapLayoutAddress});
  assert(count===425,'FireRed catalog expected 425, got '+count);
  const pallet=catalog.get(3,0), route1=catalog.get(3,19), viridian=catalog.get(3,1), cinnabar=catalog.get(3,8), ruin=catalog.get(3,61);
  assert(pallet&&route1&&viridian&&cinnabar&&ruin,'required FireRed maps missing');
  assert(cinnabar.width===24&&cinnabar.height===20,'Cinnabar dimensions wrong');
  assert(catalog.get(3,8)!.mapDataAddress!==ruin.mapDataAddress,'Cinnabar still points to Ruin Valley map data');
  assert(catalog.get(3,8)!.secondaryTilesetAddress!==ruin.secondaryTilesetAddress,'Cinnabar still points to Ruin Valley secondary tileset');
  const world=new MapWorld(catalog); const connected=world.buildFrom(3,0);
  assert(connected===37,'Kanto connected count expected 37, got '+connected);
  assert(world.hasPosition(3,0)&&world.hasPosition(3,19)&&world.hasPosition(3,1)&&world.hasPosition(3,8),'Kanto connection lost');
  assert(!world.hasPosition(3,61),'Ruin Valley incorrectly glued to Kanto');

  const cData=adapter.getMapRenderData(cinnabar.mapDataAddress,cinnabar.width,cinnabar.height,cinnabar.primaryTilesetAddress,cinnabar.secondaryTilesetAddress);
  const rData=adapter.getMapRenderData(ruin.mapDataAddress,ruin.width,ruin.height,ruin.primaryTilesetAddress,ruin.secondaryTilesetAddress);
  assert(cData&&rData,'render data missing');
  const cHash=fnv(new Uint8Array(cData.blocks.flatMap(b=>[b.metatileId&255,b.metatileId>>>8])));
  const rHash=fnv(new Uint8Array(rData.blocks.flatMap(b=>[b.metatileId&255,b.metatileId>>>8])));
  assert(cHash!==rHash,'Cinnabar/Ruin block fingerprints identical');

  const animation=new TilesetAnimationController(rom,reader);
  const routeData=adapter.getMapRenderData(route1.mapDataAddress,route1.width,route1.height,route1.primaryTilesetAddress,route1.secondaryTilesetAddress);
  assert(routeData,'Route1 render data missing');
  const routePlacements=animation.createPlacements(route1,routeData.blocks);
  const cPlacements=animation.createPlacements(cinnabar,cData.blocks);
  assert(routePlacements.size>0||cPlacements.size>0,'No animated primary-tile placements found on Route1/Cinnabar');

  return {catalogCount:count,connectedCount:connected,cinnabar:{mapData:'0x'+cinnabar.mapDataAddress.toString(16),secondary:'0x'+cinnabar.secondaryTilesetAddress.toString(16),blockHash:cHash},ruin:{mapData:'0x'+ruin.mapDataAddress.toString(16),secondary:'0x'+ruin.secondaryTilesetAddress.toString(16),blockHash:rHash},animation:{route1Tiles:routePlacements.size,cinnabarTiles:cPlacements.size}};
}

function makeState(catalog:MapCatalog){
 const m=catalog.get(3,8)!;
 return {game:{game:'GEN 3',version:'Pokémon FireRed',region:'firered',revision:'1'},player:{x:12,y:10,z:0,direction:'DOWN',movementState:'idle'},map:{mapGroup:3,mapNumber:8,mapLayoutId:m.mapLayoutId,mapHeaderAddress:m.mapHeaderAddress,mapLayoutAddress:m.mapLayoutAddress,mapDataAddress:m.mapDataAddress,primaryTilesetAddress:m.primaryTilesetAddress,secondaryTilesetAddress:m.secondaryTilesetAddress,width:m.width,height:m.height,cellCount:m.width*m.height,blockSample:[],primaryTileset:{address:m.primaryTilesetAddress,isCompressed:false,isSecondary:false,tilesAddress:0,palettesAddress:0,metatilesAddress:0,metatileAttributesAddress:0},secondaryTileset:{address:m.secondaryTilesetAddress,isCompressed:false,isSecondary:true,tilesAddress:0,palettesAddress:0,metatilesAddress:0,metatileAttributesAddress:0},primaryMetatileSample:null,secondaryMetatileSample:null},objects:[],camera:{x:0,y:0,z:0,yaw:0,pitch:0}};
}

async function testPlayerRenderer(rom:Uint8Array,baseResult:any){
 const reader=new RomMemoryReader(rom), realAdapter=new Gen3StateAdapter(reader,rom), catalog=new MapCatalog();
 const a=findFireRedAnchor(rom);
 catalog.buildGen3FromRom(rom,{mapGroup:3,mapNumber:0,mapLayoutId:a.mapLayoutId,mapLayoutAddress:a.mapLayoutAddress});
 const cinnabar=catalog.get(3,8)!;
 const direct=realAdapter.getMapRenderData(cinnabar.mapDataAddress,cinnabar.width,cinnabar.height,cinnabar.primaryTilesetAddress,cinnabar.secondaryTilesetAddress);
 assert(direct,'direct Cinnabar render null');
 const fake={
   readState:()=>makeState(catalog),
   getMemoryReader:()=>reader,
   getMapRenderData:realAdapter.getMapRenderData.bind(realAdapter),
   getMapBlocks:()=>[],
   getMetatileGraphics:realAdapter.getMetatileGraphics.bind(realAdapter),
 } as unknown as Gen3StateAdapter;
 const container=document.querySelector('#scene') as HTMLElement;
 const renderer=new PlayerRenderer(container,fake,rom);
 for(let i=0;i<30;i++) await new Promise(requestAnimationFrame);
 const internal=renderer as unknown as {mapVisuals:Map<string,{baseTexture:THREE.DataTexture}>;mapWorld:MapWorld};
 const visual=internal.mapVisuals.get('3:8');
 assert(visual,'PlayerRenderer did not create Cinnabar visual');
 const data=visual.baseTexture.image.data as Uint8Array;
 const finalHash=fnv(data);
 renderer.destroy();
 return {visualCount:internal.mapVisuals.size,finalTextureHash:finalHash,baseResult};
}

async function testMgbaSaveCycle(romUrl:string,saveUrl:string,label:string){
 const canvas=document.querySelector('#emulator') as HTMLCanvasElement;
 const adapter=new MgbaEmulatorAdapter(canvas);
 const rom=new Uint8Array(await (await fetch(romUrl)).arrayBuffer());
 const save=new Uint8Array(await (await fetch(saveUrl)).arrayBuffer());
 const events:string[]=[];
 await adapter.loadRom(rom);
 await new Promise(r=>setTimeout(r,1000));
 for(let i=0;i<2;i++){
   adapter.pause();
   await adapter.importSave(save);
   await new Promise(r=>setTimeout(r,250));
   const state=new Gen3StateAdapter(adapter.getMemoryReader(),rom).readState();
   events.push(label+':cycle'+i+':map='+state.map.mapGroup+':'+state.map.mapNumber+':layout='+state.map.width+'x'+state.map.height);
   adapter.resume();
   await new Promise(r=>setTimeout(r,250));
 }
 adapter.destroy();
 return events;
}

async function main(){
 const fr=new Uint8Array(await (await fetch('/Pokemon - FireRed Version (USA, Europe) (Rev 1).gba')).arrayBuffer());
 const emerald=new Uint8Array(await (await fetch('/Pokemon - Emerald Version (USA, Europe).gba')).arrayBuffer());
 const staticAudit=await testStaticAndWorld(fr);
 const rendererAudit=await testPlayerRenderer(fr,staticAudit);
 let saveAudit:{attempted:boolean;events:string[];error?:string}={attempted:true,events:[]};
 try{
   saveAudit.events.push(...await testMgbaSaveCycle('/Pokemon - Emerald Version (USA, Europe).gba','/save.sav','emerald'));
 }catch(e){saveAudit.error=e instanceof Error?e.message:String(e)}
 const result={pass:!!staticAudit&&!!rendererAudit,catalogWorld:staticAudit,playerRenderer:rendererAudit,saveAudit,romSizes:{fireRed:fr.length,emerald:emerald.length}};
 document.querySelector('#out')!.textContent=JSON.stringify(result,null,2);
 document.body.dataset.pass=result.pass?'true':'false';
}
main().catch(e=>{document.querySelector('#out')!.textContent=JSON.stringify({pass:false,error:e instanceof Error?e.message:String(e)},null,2);document.body.dataset.pass='false';});
