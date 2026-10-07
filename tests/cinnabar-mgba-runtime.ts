import { MgbaEmulatorAdapter } from '../src/emulator/Emulator';
import { Gen3StateAdapter } from '../src/gen3/Gen3StateAdapter';
import { PlayerRenderer } from '../src/render/PlayerRenderer';
import { MapCatalog } from '../src/gen3/world/MapCatalog';

function hex(n:number){return '0x'+(n>>>0).toString(16).padStart(8,'0')}
function hash(values:readonly number[]):number{
 let h=2166136261;
 for(const v of values){h^=v&0xff;h=Math.imul(h,16777619);h>>>=0}
 return h>>>0;
}

async function waitFor(fn:()=>boolean,ms:number):Promise<void>{
 const end=performance.now()+ms;
 while(performance.now()<end){
   if(fn())return;
   await new Promise(r=>setTimeout(r,100));
 }
 throw new Error('timeout');
}

async function main(){
 const canvas=document.querySelector('#emulator') as HTMLCanvasElement;
 const out=document.querySelector('#out')!;
 const rom=new Uint8Array(await (await fetch('/Pokemon - FireRed Version (USA, Europe) (Rev 1).gba')).arrayBuffer());
 const save=new Uint8Array(await (await fetch('/firered.sav')).arrayBuffer());

 const emulator=new MgbaEmulatorAdapter(canvas);
 await emulator.loadRom(rom);
 const memory=emulator.getMemoryReader();
 const adapter=new Gen3StateAdapter(memory,rom);

 const preLoadBytes = Array.from({length:16},(_,i)=>memory.readU8(0x082e37d0+i));
 const preBetaBytes = Array.from({length:16},(_,i)=>memory.readU8(0x08338378+i));

 await emulator.importSave(save);

 await waitFor(()=>{
   const s=adapter.readState();
   return s.map.mapGroup===3 && s.map.mapNumber===8 && s.map.width>0;
 },15000);

 const state=adapter.readState();
 const c=state.map;
 const correctAddr=0x082e37d0;
 const betaAddr=0x08338378;

 const correctBytes=Array.from({length:32},(_,i)=>memory.readU8(correctAddr+i));
 const betaBytes=Array.from({length:32},(_,i)=>memory.readU8(betaAddr+i));

 const catalog=new MapCatalog();
 const catalogCount=catalog.buildGen3FromRom(rom,{
   mapGroup:c.mapGroup,
   mapNumber:c.mapNumber,
   mapLayoutId:c.mapLayoutId,
   mapLayoutAddress:c.mapLayoutAddress,
 });
 const cat=catalog.get(3,8);

 let renderer:PlayerRenderer|null=null;
 const container=document.createElement('div');
 container.style.width='900px';container.style.height='600px';
 document.body.appendChild(container);
 renderer=new PlayerRenderer(container,adapter,rom);

 await waitFor(()=>{
   const intern=renderer as any;
   const v=intern.mapVisuals?.get('3:8');
   return !!v;
 },15000);

 const intern=renderer as any;
 const v=intern.mapVisuals.get('3:8');
 const textureBytes=Array.from(v.baseTexture.image.data as Uint8Array);
 const visualPosition=intern.mapWorld.getWorldPosition(3,8);

 const result={
  pass:true,
  state:{
   mapGroup:c.mapGroup,mapNumber:c.mapNumber,mapLayoutId:c.mapLayoutId,
   mapHeaderAddress:hex(c.mapHeaderAddress),
   mapLayoutAddress:hex(c.mapLayoutAddress),
   mapDataAddress:hex(c.mapDataAddress),
   primaryTilesetAddress:hex(c.primaryTilesetAddress),
   secondaryTilesetAddress:hex(c.secondaryTilesetAddress),
   size:[c.width,c.height],
  },
  directMemory:{
   correctAddress:hex(correctAddr),
   correctBytes,
   betaAddress:hex(betaAddr),
   betaBytes,
   correctHash:hash(correctBytes),
   betaHash:hash(betaBytes),
  },
  catalog:{
   count:catalogCount,
   mapDataAddress:cat?hex(cat.mapDataAddress):null,
   mapLayoutAddress:cat?hex(cat.mapLayoutAddress):null,
   secondaryTilesetAddress:cat?hex(cat.secondaryTilesetAddress):null,
  },
  renderer:{
   hasCinnabarVisual:!!v,
   textureHash:hash(textureBytes),
   position:visualPosition,
   visualCount:intern.mapVisuals.size,
  },
  preSaveRead:{
   correctBytes:preLoadBytes,
   betaBytes:preBetaBytes,
  }
 };

 renderer.destroy();
 emulator.destroy();
 document.body.dataset.pass='true';
 out.textContent=JSON.stringify(result,null,2);
}
main().catch(e=>{
 document.body.dataset.pass='false';
 document.querySelector('#out')!.textContent=JSON.stringify({pass:false,error:String(e)},null,2);
});
