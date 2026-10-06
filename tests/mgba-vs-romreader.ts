import { MgbaEmulatorAdapter } from '../src/emulator/Emulator';
import { Gen3StateAdapter } from '../src/gen3/Gen3StateAdapter';
import type { MemoryReader } from '../src/gen3/MemoryReader';

const BASE=0x08000000;
class RomReader implements MemoryReader{
 constructor(private rom:Uint8Array){}
 readU8(a:number){const o=a-BASE;return o>=0&&o<this.rom.length?this.rom[o]:0}
 readU16(a:number){return this.readU8(a)|(this.readU8(a+1)<<8)}
 readU32(a:number){return (this.readU8(a)|this.readU8(a+1)<<8|this.readU8(a+2)<<16|this.readU8(a+3)*0x1000000)>>>0}
 readRange(a:number,n:number){const r=new Uint8Array(n);for(let i=0;i<n;i++)r[i]=this.readU8(a+i);return r}
}
function fnv(blocks:readonly {metatileId:number}[]){let h=2166136261;for(const b of blocks){h^=b.metatileId&0xffff;h=Math.imul(h,16777619)}return h>>>0}
function anchor(rom:Uint8Array){
 const rr=new RomReader(rom);
 for(let o=0;o+0x1c<=rom.length;o+=4){
  const la=rr.readU32(BASE+o); const lo=la-BASE;
  if(lo<0||lo+0x18>rom.length)continue;
  if(rr.readU32(la)!==24||rr.readU32(la+4)!==20)continue;
  const h=BASE+o, cp=rr.readU32(h+0xc); if(cp<BASE)continue;
  const co=cp-BASE; if(co<0||co+8>rom.length)continue;
  const n=rr.readU32(cp)|0;if(n<0||n>64)continue;
  const d=rr.readU32(cp+4),doff=d-BASE;if(d<BASE||doff<0||doff+n*0xc>rom.length)continue;
  let north=false,south=false;
  for(let i=0;i<n;i++){const e=doff+i*0xc,dir=rr.readU8(BASE+e),ofs=rr.readU32(BASE+e+4)|0,g=rr.readU8(BASE+e+8),m=rr.readU8(BASE+e+9);
   if(dir===2&&ofs===0&&g===3&&m===19)north=true;
   if(dir===1&&ofs===0&&g===3&&m===39)south=true;
  }
  if(north&&south)return {mapLayoutAddress:la,mapLayoutId:rr.readU16(h+0x12)};
 }
 return null;
}
async function main(){
 const rom=new Uint8Array(await (await fetch('/Pokemon - FireRed Version (USA, Europe) (Rev 1).gba')).arrayBuffer());
 const a=anchor(rom); if(!a)throw new Error('anchor not found');
 const canvas=document.querySelector('#emu') as HTMLCanvasElement;
 const emu=new MgbaEmulatorAdapter(canvas);
 await emu.loadRom(rom);
 await new Promise(r=>setTimeout(r,500));
 const live=new Gen3StateAdapter(emu.getMemoryReader(),rom);
 const raw=new Gen3StateAdapter(new RomReader(rom),rom);
 const catalog=new (await import('../src/gen3/world/MapCatalog')).MapCatalog();
 const count=catalog.buildGen3FromRom(rom,{mapGroup:3,mapNumber:0,...a});
 if(count!==425)throw new Error('catalog '+count);
 const cin=catalog.get(3,8);if(!cin)throw new Error('Cinnabar missing');
 const addresses=[cin.mapDataAddress,cin.primaryTilesetAddress,cin.secondaryTilesetAddress,cin.mapLayoutAddress,cin.mapHeaderAddress];
 const comparisons=addresses.map(address=>({
   address:'0x'+address.toString(16),
   rom:'0x'+((new RomReader(rom)).readU32(address)>>>0).toString(16),
   live:'0x'+(live['memoryReader']?.readU32?.(address)??0).toString(16),
 }));
 const rawData=raw.getMapRenderData(cin.mapDataAddress,cin.width,cin.height,cin.primaryTilesetAddress,cin.secondaryTilesetAddress);
 const liveData=live.getMapRenderData(cin.mapDataAddress,cin.width,cin.height,cin.primaryTilesetAddress,cin.secondaryTilesetAddress);
 if(!rawData||!liveData)throw new Error('render data null');
 const blockDiffs:number[]=[];
 for(let i=0;i<rawData.blocks.length;i++)if(rawData.blocks[i].raw!==liveData.blocks[i].raw)blockDiffs.push(i);
 const result={
  pass:true,
  catalogCount:count,
  cinnabar:{
   mapData:'0x'+cin.mapDataAddress.toString(16),
   beta:'0x'+(BASE+0x338378).toString(16),
   primary:'0x'+cin.primaryTilesetAddress.toString(16),
   secondary:'0x'+cin.secondaryTilesetAddress.toString(16),
   dimensions:[cin.width,cin.height]
  },
  busComparisons:comparisons,
  blockCount:rawData.blocks.length,
  blockDiffCount:blockDiffs.length,
  firstBlockRaw:{rom:rawData.blocks[0].raw,live:liveData.blocks[0].raw},
  rawBlockHash:fnv(rawData.blocks),
  liveBlockHash:fnv(liveData.blocks),
 };
 document.querySelector('#out')!.textContent=JSON.stringify(result,null,2);
 document.body.dataset.pass='true';
 emu.destroy();
}
main().catch(e=>{document.querySelector('#out')!.textContent=JSON.stringify({pass:false,error:String(e)},null,2);document.body.dataset.pass='false';throw e});