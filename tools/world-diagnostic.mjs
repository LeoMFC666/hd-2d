import fs from 'node:fs';

const BASE = 0x08000000;
const HEADER_SIZE = 0x1c;
const LAYOUT_SIZE = 0x18;
const MAX_DIM = 512;
const CONN_SIZE = 0x0c;

const GROUPS = {
  BPEE: [57,5,5,6,7,8,9,7,7,14,8,17,10,23,13,15,15,2,2,2,3,1,1,1,108,61,89,2,1,13,1,1,1,1],
  BPRE: [5,123,60,66,4,6,8,10,6,8,20,10,8,2,10,4,2,2,2,1,1,2,2,3,2,3,2,1,1,1,1,7,5,5,8,8,5,5,1,1,1,2,1],
};

const ROOTS = {
  BPEE: { group: 0, num: 9, name: 'LittlerootTown' },
  BPRE: { group: 3, num: 0, name: 'PalletTown' },
};

function u8(b,o){ return b[o] ?? 0; }
function u16(b,o){ return u8(b,o) | (u8(b,o+1)<<8); }
function u32(b,o){ return (u8(b,o) | (u8(b,o+1)<<8) | (u8(b,o+2)<<16) | (u8(b,o+3)*0x1000000))>>>0; }
function i32(b,o){ return u32(b,o)|0; }
function inRom(b,a,size=1){ const off=a-BASE; return a>=BASE && off>=0 && off+size<=b.length; }

function validLayout(b,a){
  if(!inRom(b,a,LAYOUT_SIZE)) return false;
  const o=a-BASE;
  const w=u32(b,o), h=u32(b,o+4);
  if(w<1||w>MAX_DIM||h<1||h>MAX_DIM) return false;
  const map=u32(b,o+0x0c), p=u32(b,o+0x10), s=u32(b,o+0x14);
  return inRom(b,map,w*h*2)&&inRom(b,p,4)&&inRom(b,s,4);
}
function validHeader(b,a){
  if(!inRom(b,a,HEADER_SIZE) || (a-BASE)%4!==0) return false;
  const o=a-BASE, l=u32(b,o);
  return validLayout(b,l);
}
function validGroup(b,a,len){
  if(!inRom(b,a,len*4) || (a-BASE)%4!==0) return false;
  for(let i=0;i<len;i++) if(!validHeader(b,u32(b,(a-BASE)+i*4))) return false;
  return true;
}
function findGroups(b,lens){
  const end=b.length-lens.length*4;
  for(let off=0;off<=end;off+=4){
    const table=BASE+off;
    let ok=true;
    for(let g=0;g<lens.length;g++){
      const p=u32(b,off+g*4);
      if(!validGroup(b,p,lens[g])){ ok=false; break; }
    }
    if(ok) return table;
  }
  return 0;
}
function readConn(b,h,lens){
  const hp=h-BASE, ca=u32(b,hp+0x0c);
  if(ca===0||!inRom(b,ca,8)) return [];
  const co=ca-BASE, count=i32(b,co);
  if(count<=0||count>64) return [];
  const data=u32(b,co+4);
  if(!inRom(b,data,count*CONN_SIZE)) return [];
  const out=[];
  for(let i=0;i<count;i++){
    const o=data-BASE+i*CONN_SIZE, d=u8(b,o);
    const dir={1:'SOUTH',2:'NORTH',3:'WEST',4:'EAST'}[d];
    if(!dir) continue;
    const offset=i32(b,o+4), mg=u8(b,o+8), mn=u8(b,o+9);
    if(mg>=lens.length||mn>=lens[mg]) continue;
    out.push({dir,offset,mg,mn});
  }
  return out;
}
function analyze(file){
  const b=fs.readFileSync(file);
  const code=Buffer.from(b.subarray(0xac,0xb0)).toString('ascii');
  const rev=u8(b,0xbc);
  const lens=GROUPS[code];
  if(!lens) return {file,code,rev,error:'unsupported'};
  const table=findGroups(b,lens);
  if(!table) return {file,code,rev,error:'mapGroups table not found'};
  const maps=new Map();
  for(let g=0;g<lens.length;g++){
    const gp=u32(b,table-BASE+g*4);
    for(let n=0;n<lens[g];n++){
      const h=u32(b,gp-BASE+n*4), ho=h-BASE, la=u32(b,ho);
      maps.set(g+':'+n,{group:g,num:n,header:h,layout:la,layoutId:u16(b,ho+0x12),w:u32(b,la-BASE),hgt:u32(b,la-BASE+4),connections:readConn(b,h,lens)});
    }
  }
  const root=ROOTS[code];
  const q=[root.group+':'+root.num], seen=new Set(q);
  while(q.length){
    const k=q.shift(), m=maps.get(k); if(!m) continue;
    for(const c of m.connections){
      const nk=c.mg+':'+c.mn;
      if(!seen.has(nk)){seen.add(nk);q.push(nk);}
    }
  }
  const connMaps=[...maps.values()].filter(m=>m.connections.length>0);
  const edgeCount=connMaps.reduce((n,m)=>n+m.connections.length,0);
  const samples=[];
  for(const k of code==='BPEE'?['0:9','0:16','0:10']:['3:0','3:19','3:37','3:38','3:39']){
    const m=maps.get(k); if(m) samples.push({key:k,layoutId:m.layoutId,size:[m.w,m.hgt],connections:m.connections});
  }
  return {file,code,rev,table:'0x'+table.toString(16),catalogMaps:maps.size,connMaps:connMaps.length,edges:edgeCount,root,rootComponent:seen.size,samples};
}

for(const f of process.argv.slice(2)) console.log(JSON.stringify(analyze(f),null,2));
