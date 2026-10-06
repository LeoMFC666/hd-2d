import { MapCatalog } from '../src/gen3/world/MapCatalog';
import { MapWorld } from '../src/gen3/world/MapWorld';

const BASE=0x08000000;
const HEADER_SIZE=0x1c;
const GROUP_LENGTHS=[5,123,60,66,4,6,8,10,6,8,20,10,8,2,10,4,2,2,2,1,1,2,2,3,2,3,2,1,1,1,1,7,5,5,8,8,5,5,1,1,1,2,1];

let rom: Uint8Array;
function u8(o:number){return o>=0&&o<rom.length?rom[o]:0}
function u16(o:number){return u8(o)|(u8(o+1)<<8)}
function u32(o:number){return (u8(o)|u8(o+1)<<8|u8(o+2)<<16|u8(o+3)*0x1000000)>>>0}
function i32(o:number){return u32(o)|0}
function isPtr(a:number,size=1){const o=a-BASE;return o>=0&&o+size<=rom.length}
function readConnections(header:number){
  const p=u32(header-BASE+0x0c);
  if(p===0)return [];
  if(!isPtr(p,8))return null;
  const po=p-BASE,n=i32(po);
  if(n<0||n>64)return null;
  if(n===0)return [];
  const d=u32(po+4),doff=d-BASE;
  if(!isPtr(d,n*0x0c))return null;
  const out:any[]=[];
  for(let i=0;i<n;i++){
    const e=doff+i*0x0c;
    out.push({direction:u8(e),offset:i32(e+4),mapGroup:u8(e+8),mapNumber:u8(e+9)});
  }
  return out;
}
function findAnchor(width:number,height:number,required:any[]){
  for(let off=0;off<=rom.length-HEADER_SIZE;off+=4){
    const layout=u32(off);
    if(!isPtr(layout,0x18))continue;
    const lo=layout-BASE;
    if(u32(lo)!==width||u32(lo+4)!==height)continue;
    const md=u32(lo+0x0c),p=u32(lo+0x10),s=u32(lo+0x14);
    if(!isPtr(md,width*height*2)||!isPtr(p,4)||!isPtr(s,4))continue;
    const header=BASE+off, conns=readConnections(header);
    if(!conns)continue;
    if(!required.every((x:any)=>conns.some((c:any)=>c.direction===x.direction&&c.offset===x.offset&&c.mapGroup===x.mapGroup&&c.mapNumber===x.mapNumber)))continue;
    return {mapLayoutAddress:layout,mapLayoutId:u16(off+0x12),headerAddress:header};
  }
  return null;
}
function key(g:number,n:number){return g+':'+n}
function fp(m:any){return [m.mapHeaderAddress,m.mapLayoutAddress,m.mapDataAddress,m.primaryTilesetAddress,m.secondaryTilesetAddress,m.width,m.height,m.mapLayoutId].join(',')}
function catalogFingerprint(cat:MapCatalog){
  return new Map(cat.getAll().map(m=>[key(m.mapGroup,m.mapNumber),fp(m)]));
}
function diffMaps(a:Map<string,string>,b:Map<string,string>){
  const out:any[]=[];
  const keys=new Set([...a.keys(),...b.keys()]);
  for(const k of keys){
    if(a.get(k)!==b.get(k)) out.push({key:k,a:a.get(k)??null,b:b.get(k)??null});
  }
  return out;
}

async function main(){
 rom=new Uint8Array(await (await fetch('/Pokemon - FireRed Version (USA, Europe) (Rev 1).gba')).arrayBuffer());
 if(String.fromCharCode(rom[0xac],rom[0xad],rom[0xae],rom[0xaf])!=='BPRE'||rom[0xbc]!==1)throw new Error('wrong ROM');

 const specs={
  pallet:{g:3,n:0,w:24,h:20,c:[{direction:2,mapGroup:3,mapNumber:19,offset:0},{direction:1,mapGroup:3,mapNumber:39,offset:0}]},
  route1:{g:3,n:19,w:24,h:40,c:[{direction:2,mapGroup:3,mapNumber:1,offset:-12},{direction:1,mapGroup:3,mapNumber:0,offset:0}]},
  cinnabar:{g:3,n:8,w:24,h:20,c:[{direction:2,mapGroup:3,mapNumber:40,offset:0},{direction:4,mapGroup:3,mapNumber:38,offset:0}]}
 } as const;

 const anchors:any={};
 for(const [name,s] of Object.entries(specs)){
   const a=findAnchor(s.w,s.h,s.c);
   if(!a)throw new Error('independent anchor not found: '+name);
   anchors[name]={...a,g:s.g,n:s.n};
 }

 const catalogs:any={};
 const fingerprints:any={};
 const worlds:any={};
 for(const [name,a] of Object.entries(anchors)){
   const cat=new MapCatalog();
   const count=cat.buildGen3FromRom(rom,{mapGroup:a.g,mapNumber:a.n,mapLayoutId:a.mapLayoutId,mapLayoutAddress:a.mapLayoutAddress});
   if(count!==425)throw new Error(name+' catalog count '+count);
   catalogs[name]=cat;
   fingerprints[name]=catalogFingerprint(cat);
   const world=new MapWorld(cat);
   const connected=world.buildFrom(a.g,a.n);
   worlds[name]={connected,positioned:world.getPositionedMaps().map(m=>key(m.mapGroup,m.mapNumber))};
   if(connected!==37)throw new Error(name+' connected count '+connected);
 }

 const baseline=fingerprints.pallet;
 const anchorComparisons:any={};
 for(const name of Object.keys(fingerprints)){
   const diffs=diffMaps(baseline,fingerprints[name]);
   anchorComparisons[name]={identicalToPallet:diffs.length===0,diffCount:diffs.length,firstDiffs:diffs.slice(0,10)};
 }

 const worldSet=(x:any)=>x.positioned.slice().sort().join('|');
 const worldComparisons:any={};
 for(const name of Object.keys(worlds)){
   worldComparisons[name]={samePositionedSetAsPallet:worldSet(worlds[name])===worldSet(worlds.pallet),positionedCount:worlds[name].positioned.length};
 }

 const result={pass:Object.values(anchorComparisons).every((x:any)=>x.identicalToPallet)&&Object.values(worldComparisons).every((x:any)=>x.samePositionedSetAsPallet),catalogs:{counts:Object.fromEntries(Object.entries(anchors).map(([n])=>[n,catalogs[n].getAll().length]))},anchors,anchorComparisons,worldComparisons};
 document.querySelector('#out')!.textContent=JSON.stringify(result,null,2);
 document.body.dataset.pass=result.pass?'true':'false';
}
main().catch(e=>{document.querySelector('#out')!.textContent=JSON.stringify({pass:false,error:String(e)},null,2);document.body.dataset.pass='false';throw e});