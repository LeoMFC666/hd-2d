import fs from 'node:fs';
import { MapCatalog } from '../src/gen3/world/MapCatalog';
import { MapWorld } from '../src/gen3/world/MapWorld';
import { Gen3StateAdapter } from '../src/gen3/Gen3StateAdapter';
import type { MemoryReader } from '../src/gen3/MemoryReader';

const BASE=0x08000000;
const EXPECTED_CINNABAR={
 header:0x08350768,
 layout:0x082e3b90,
 mapData:0x082e37d0,
 primary:0x082d4b04,
 secondary:0x082d4bdc,
 layoutId:86,
 width:24,
 height:20,
};
class RomReader implements MemoryReader{
 constructor(private rom:Uint8Array){}
 readU8(a:number){const o=a-BASE;return o>=0&&o<this.rom.length?this.rom[o]:0}
 readU16(a:number){return this.readU8(a)|(this.readU8(a+1)<<8)}
 readU32(a:number){return (this.readU8(a)|this.readU8(a+1)<<8|this.readU8(a+2)<<16|this.readU8(a+3)*0x1000000)>>>0}
 readRange(a:number,n:number){const r=new Uint8Array(n);for(let i=0;i<n;i++)r[i]=this.readU8(a+i);return r}
}
function assert(v:unknown,msg:string):asserts v{if(!v)throw new Error(msg)}
function assertEq(a:unknown,b:unknown,msg:string){assert(a===b,msg+': got '+String(a)+' expected '+String(b))}
function fnv(blocks:readonly {metatileId:number}[]){let h=2166136261;for(const b of blocks){h^=b.metatileId&0xffff;h=Math.imul(h,16777619)}return h>>>0}
function findPalletAnchor(rom:Uint8Array){
 const rr=new RomReader(rom);
 for(let o=0;o+0x1c<=rom.length;o+=4){
  const la=rr.readU32(BASE+o),lo=la-BASE;if(lo<0||lo+0x18>rom.length||rr.readU32(la)!==24||rr.readU32(la+4)!==20)continue;
  const cp=rr.readU32(BASE+o+0xc);if(cp<BASE)continue;const co=cp-BASE;if(co<0||co+8>rom.length)continue;
  const n=rr.readU32(cp)|0,d=rr.readU32(cp+4);if(n<2||n>64||d<BASE||d-BASE+n*0xc>rom.length)continue;
  const doff=d-BASE;let north=false,south=false;
  for(let i=0;i<n;i++){const e=doff+i*0xc,dir=rr.readU8(BASE+e),off=rr.readU32(BASE+e+4)|0,g=rr.readU8(BASE+e+8),m=rr.readU8(BASE+e+9);if(dir===2&&off===0&&g===3&&m===19)north=true;if(dir===1&&off===0&&g===3&&m===39)south=true}
  if(north&&south)return {mapGroup:3,mapNumber:0,mapLayoutId:rr.readU16(BASE+o+0x12),mapLayoutAddress:la};
 }
 return null;
}
function canonicalAnchorFromExpected(){return {mapGroup:3,mapNumber:8,mapLayoutId:EXPECTED_CINNABAR.layoutId,mapLayoutAddress:EXPECTED_CINNABAR.layout}}
function snapshot(c:MapCatalog){
 return c.getAll().map(m=>[m.mapGroup,m.mapNumber,m.mapLayoutId,m.mapHeaderAddress,m.mapLayoutAddress,m.mapDataAddress,m.primaryTilesetAddress,m.secondaryTilesetAddress,m.width,m.height,JSON.stringify(m.connections)] as const)
 .sort((a,b)=>(a[0]-b[0])||(a[1]-b[1]));
}
async function main(){
 const rom=new Uint8Array(fs.readFileSync('Pokemon - FireRed Version (USA, Europe) (Rev 1).gba'));
 assertEq(String.fromCharCode(rom[0xac],rom[0xad],rom[0xae],rom[0xaf]),'BPRE','Game code');
 assertEq(rom[0xbc],1,'Revision');

 // Baseline build from Pallet — must remain unchanged in the fix.
 const pallet=findPalletAnchor(rom);assert(pallet,'Pallet anchor missing');
 const base=new MapCatalog();assertEq(base.buildGen3FromRom(rom,pallet),425,'Pallet build count');
 const baseSnapshot=snapshot(base);
 const baseCinnabar=base.get(3,8);assert(baseCinnabar,'Baseline Cinnabar missing');
 assertEq(baseCinnabar.mapHeaderAddress,EXPECTED_CINNABAR.header,'Baseline Cinnabar header');
 assertEq(baseCinnabar.mapLayoutAddress,EXPECTED_CINNABAR.layout,'Baseline Cinnabar layout');
 assertEq(baseCinnabar.mapDataAddress,EXPECTED_CINNABAR.mapData,'Baseline Cinnabar data');

 // Deliberately lie about 3:8's layout. Use a valid but unrelated map layout.
 const wrong=base.get(3,61);assert(wrong,'Ruin Valley missing');
 const corruptAnchor={
   mapGroup:3,mapNumber:8,
   mapLayoutId:wrong.mapLayoutId,
   mapLayoutAddress:wrong.mapLayoutAddress,
 };
 const repaired=new MapCatalog();
 const repairedCount=repaired.buildGen3FromRom(rom,corruptAnchor);
 assertEq(repairedCount,425,'Corrupt-anchor repaired count');
 const repairedCinnabar=repaired.get(3,8);assert(repairedCinnabar,'Repaired Cinnabar missing');
 assertEq(repairedCinnabar.mapHeaderAddress,EXPECTED_CINNABAR.header,'Repaired Cinnabar header');
 assertEq(repairedCinnabar.mapLayoutAddress,EXPECTED_CINNABAR.layout,'Repaired Cinnabar layout');
 assertEq(repairedCinnabar.mapDataAddress,EXPECTED_CINNABAR.mapData,'Repaired Cinnabar data');
 assertEq(repairedCinnabar.primaryTilesetAddress,EXPECTED_CINNABAR.primary,'Repaired Cinnabar primary');
 assertEq(repairedCinnabar.secondaryTilesetAddress,EXPECTED_CINNABAR.secondary,'Repaired Cinnabar secondary');

 const repairedSnapshot=snapshot(repaired);
 const diff=baseSnapshot.filter((v,i)=>JSON.stringify(v)!==JSON.stringify(repairedSnapshot[i]));
 assertEq(diff.length,0,'All 425 catalog entries unchanged between Pallet and corrupted Cinnabar anchor');

 const world=new MapWorld(repaired);
 assertEq(world.buildFrom(3,0),37,'World connected count');
 assert(world.hasPosition(3,8),'Cinnabar positioned');
 assert(!world.hasPosition(3,61),'Ruin Valley must stay outside Kanto world');

 const adapter=new Gen3StateAdapter(new RomReader(rom),rom);
 const render=adapter.getMapRenderData(
   repairedCinnabar.mapDataAddress,repairedCinnabar.width,repairedCinnabar.height,
   repairedCinnabar.primaryTilesetAddress,repairedCinnabar.secondaryTilesetAddress,
 );
 assert(render,'Cinnabar render');
 const hash=fnv(render.blocks);
 assertEq(hash,2260859561,'Cinnabar block hash');

 console.log(JSON.stringify({
   pass:true,
   repairedFromCorruptAnchor:true,
   catalogCount:repairedCount,
   catalogDiffCount:diff.length,
   connectedCount:37,
   cinnabar:{
     header:'0x'+repairedCinnabar.mapHeaderAddress.toString(16),
     layout:'0x'+repairedCinnabar.mapLayoutAddress.toString(16),
     mapData:'0x'+repairedCinnabar.mapDataAddress.toString(16),
     primary:'0x'+repairedCinnabar.primaryTilesetAddress.toString(16),
     secondary:'0x'+repairedCinnabar.secondaryTilesetAddress.toString(16),
     renderBlockHash:hash
   }
 },null,2));
}
main().catch(e=>{console.error(e);process.exit(1)});
