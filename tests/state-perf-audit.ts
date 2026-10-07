import { Gen3StateAdapter } from '../src/gen3/Gen3StateAdapter';
import type { MemoryReader } from '../src/gen3/MemoryReader';

const BASE=0x08000000;
const EWRAM_START=0x02000000;
const EWRAM_END=0x02040000;

class HybridReader implements MemoryReader{
  private readonly mem=new Map<number,number>();
  constructor(private readonly rom:Uint8Array){}
  setU8(a:number,v:number){this.mem.set(a,v&255)}
  setU16(a:number,v:number){this.setU8(a,v);this.setU8(a+1,v>>8)}
  setU32(a:number,v:number){this.setU8(a,v);this.setU8(a+1,v>>8);this.setU8(a+2,v>>16);this.setU8(a+3,v>>24)}
  readU8(a:number){if(this.mem.has(a))return this.mem.get(a)!;const o=a-BASE;return o>=0&&o<this.rom.length?this.rom[o]:0}
  readU16(a:number){return this.readU8(a)|(this.readU8(a+1)<<8)}
  readU32(a:number){return (this.readU8(a)|this.readU8(a+1)<<8|this.readU8(a+2)<<16|this.readU8(a+3)*0x1000000)>>>0}
  readRange(a:number,n:number){const out=new Uint8Array(n);for(let i=0;i<n;i++)out[i]=this.readU8(a+i);return out}
}

function assert(c:unknown,m:string):asserts c{if(!c)throw new Error(m)}
function stats(ns:number[]){const s=[...ns].sort((a,b)=>a-b);const avg=ns.reduce((a,b)=>a+b,0)/ns.length;return {avgMs:avg,medianMs:s[Math.floor(s.length/2)],p95Ms:s[Math.floor(s.length*.95)],opsPerSec:1000/avg}}

function findAnyMapHeader(rom:Uint8Array){
 const u8=(o:number)=>o>=0&&o<rom.length?rom[o]:0;
 const u32=(o:number)=>(u8(o)|u8(o+1)<<8|u8(o+2)<<16|u8(o+3)*0x1000000)>>>0;
 const isPtr=(a:number,s=1)=>{const o=a-BASE;return o>=0&&o+s<=rom.length};
 for(let off=0;off<=rom.length-0x1c;off+=4){
   const la=u32(off);if(!isPtr(la,0x18))continue;
   const lo=la-BASE,w=u32(lo),h=u32(lo+4);
   if(w<1||w>128||h<1||h>128)continue;
   const md=u32(lo+0xc),p=u32(lo+0x10),s=u32(lo+0x14);
   if(!isPtr(md,w*h*2)||!isPtr(p,8)||!isPtr(s,8))continue;
   return {header:BASE+off,layout:la,layoutId:u8(off+0x12)|u8(off+0x13)<<8,width:w,height:h};
 }
 return null;
}

function configureState(reader:HybridReader,kind:'firered'|'emerald',header:number,layout:number,layoutId:number){
 const save=0x02025000;
 if(kind==='firered'){
   reader.setU32(0x03005008,save);
   reader.setU8(save+4,3);reader.setU8(save+5,0);reader.setU16(save+0x32,layoutId);
   reader.setU32(0x02036dfc,layout);reader.setU16(0x02036dfc+0x12,layoutId);
   reader.setU8(0x02037078+5,0);
   reader.setU16(0x02036e38+0x10,12);reader.setU16(0x02036e38+0x12,10);
   reader.setU8(0x02036e38+0x18,1);reader.setU8(0x02037078+2,0);
 }else{
   reader.setU32(0x03005d8c,save);
   reader.setU8(save+4,0);reader.setU8(save+5,9);reader.setU16(save+0x32,layoutId);
   reader.setU32(0x02037318,layout);reader.setU16(0x02037318+0x12,layoutId);
   reader.setU8(0x02037590+5,0);
   reader.setU16(0x02037350+0x10,12);reader.setU16(0x02037350+0x12,10);
   reader.setU8(0x02037350+0x18,1);reader.setU8(0x02037590+2,0);
 }
 void header;
}

async function bench(path:string,kind:'firered'|'emerald'){
 const rom=new Uint8Array(await(await fetch(path)).arrayBuffer());
 const reader=new HybridReader(rom);
 const candidate=findAnyMapHeader(rom);assert(candidate,'No valid header in '+path);
 configureState(reader,kind,candidate.header,candidate.layout,candidate.layoutId);
 const adapter=new Gen3StateAdapter(reader,rom);
 for(let i=0;i<100;i++)adapter.readState();
 const samples:number[]=[];
 for(let round=0;round<10;round++){
   const start=performance.now();
   for(let i=0;i<500;i++)adapter.readState();
   samples.push((performance.now()-start)/500);
 }
 const stable=adapter.readState();
 return {game:kind,rom:path,layoutId:candidate.layoutId,map:{group:stable.map.mapGroup,num:stable.map.mapNumber,size:[stable.map.width,stable.map.height]},timing:stats(samples)};
}

async function main(){
 const firered=await bench('/Pokemon - FireRed Version (USA, Europe) (Rev 1).gba','firered');
 const emerald=await bench('/Pokemon - Emerald Version (USA, Europe).gba','emerald');
 document.body.dataset.pass='true';
 document.querySelector('#out')!.textContent=JSON.stringify({pass:true,firered,emerald},null,2);
}
main().catch(e=>{document.body.dataset.pass='false';document.querySelector('#out')!.textContent=JSON.stringify({pass:false,error:String(e)},null,2);throw e});