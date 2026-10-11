// Renderizador de software: chao plano + dobra, camera igual a do app.
import { readFileSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { Gen3StateAdapter } from './b4/gen3/Gen3StateAdapter.js';
import { MapCatalog } from './b4/gen3/world/MapCatalog.js';
import { buildFoldGeometry, computeFoldMask } from './b6/VoxelFolding.js';
const BASE=0x08000000, PX=16;
const u32=(r,o)=>(r[o]|(r[o+1]<<8)|(r[o+2]<<16)|(r[o+3]<<24))>>>0;
function png(w,h,rgba){const T=new Int32Array(256).map((_,n)=>{let c=n;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;return c;});const crc=b=>{let c=-1;for(const x of b)c=T[(c^x)&255]^(c>>>8);return(c^-1)>>>0;};const ch=(t,d)=>{const b=Buffer.alloc(12+d.length);b.writeUInt32BE(d.length,0);b.write(t,4);d.copy(b,8);b.writeUInt32BE(crc(b.subarray(4,8+d.length)),8+d.length);return b;};const raw=Buffer.alloc((w*4+1)*h);for(let y=0;y<h;y++){raw[y*(w*4+1)]=0;Buffer.from(rgba.buffer,y*w*4,w*4).copy(raw,y*(w*4+1)+1);}const ih=Buffer.alloc(13);ih.writeUInt32BE(w,0);ih.writeUInt32BE(h,4);ih[8]=8;ih[9]=6;return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),ch('IHDR',ih),ch('IDAT',deflateSync(raw)),ch('IEND',Buffer.alloc(0))]);}
function romReader(rom){const u8=a=>a>=BASE&&a-BASE<rom.length?rom[a-BASE]:0;return{readU8:u8,readU16:a=>u8(a)|(u8(a+1)<<8),readU32:a=>(u8(a)|(u8(a+1)<<8)|(u8(a+2)<<16)|(u8(a+3)<<24))>>>0,readRange:(a,n)=>{const o=new Uint8Array(n);for(let i=0;i<n;i++)o[i]=u8(a+i);return o;}};}

const [file, G, M, out, camX, camZ, foldFlag] = process.argv.slice(2);
const rom=new Uint8Array(readFileSync(file));
const ad=new Gen3StateAdapter(romReader(rom),rom); const cat=new MapCatalog();
const groups=cat.findMapGroupsByStructure(rom);
const hdr=u32(rom,u32(rom,groups-BASE+(+G)*4)-BASE+(+M)*4), lo=u32(rom,hdr-BASE)-BASE;
const map={width:u32(rom,lo),height:u32(rom,lo+4),data:u32(rom,lo+12),p:u32(rom,lo+16),s:u32(rom,lo+20)};
const frlg=String.fromCharCode(...rom.slice(0xac,0xaf))==='BPR'||String.fromCharCode(...rom.slice(0xac,0xaf))==='BPG';
const bw=frlg&&rom[lo+0x18]>=1&&rom[lo+0x18]<=8?rom[lo+0x18]:2, bh=frlg&&rom[lo+0x19]>=1&&rom[lo+0x19]<=8?rom[lo+0x19]:2;
const borderAddr=u32(rom,lo+8)-BASE, borderIds=[];for(let i=0;i<bw*bh;i++)borderIds.push((rom[borderAddr+i*2]|(rom[borderAddr+i*2+1]<<8))&0x3ff);
const log=console.log; console.log=()=>{};
const rd=ad.getMapRenderData(map.data,map.width,map.height,map.p,map.s,borderIds); console.log=log;
const TW=map.width*PX, TH=map.height*PX, base=new Uint8Array(TW*TH*4), over=new Uint8Array(TW*TH*4);
for(let y=0;y<map.height;y++)for(let x=0;x<map.width;x++){const b=rd.blocks[y*map.width+x];const g=b&&rd.graphics.get(b.metatileId);if(!g)continue;
 for(let sy=0;sy<PX;sy++){const dy=(map.height-1-y)*PX+PX-1-sy;for(let sx=0;sx<PX;sx++){const so=(sy*PX+sx)*4,d=(dy*TW+x*PX+sx)*4;for(let c=0;c<4;c++){base[d+c]=g.basePixels[so+c];over[d+c]=g.foregroundPixels[so+c];}}}}
// mesma regra de solidez do app
const mask=computeFoldMask(map.width,map.height,(x,y)=>rd.blocks[y*map.width+x]); const solid=(x,y)=>mask[y*map.width+x]===1;
const fold=foldFlag==='0'?{positions:[],uvs:[],indices:[],quadCount:0}:buildFoldGeometry(map.width,map.height,solid,2);

// textura do bloco de borda, de baixo para cima (igual buildPaddingPlane)
const BTW=bw*PX,BTH=bh*PX,btex=new Uint8Array(BTW*BTH*4);
for(let ty=0;ty<bh;ty++)for(let tx=0;tx<bw;tx++){const g=rd.graphics.get(borderIds[ty*bw+tx]);if(!g)continue;
 for(let sy=0;sy<PX;sy++)for(let sx=0;sx<PX;sx++){const so=(sy*PX+sx)*4,dy=(bh-1-ty)*PX+PX-1-sy,d=(dy*BTW+tx*PX+sx)*4;for(let c=0;c<4;c++)btex[d+c]=g.basePixels[so+c];}}
const P=40, mod=(v,n)=>((v%n)+n)%n;
const rep=[(map.width+2*P)/bw,(map.height+2*P)/bh], off=[mod(-P,bw)/bw,(bh-1-mod(map.height+P-1,bh))/bh];
// cena: chao + dobra
const tris=[];
const addTri=(P,U,ia,ib,ic,tex,bias)=>tris.push({p:[P[ia],P[ib],P[ic]],u:[U[ia],U[ib],U[ic]],tex,bias});
const gP=[[0,0,map.height],[map.width,0,map.height],[map.width,0,0],[0,0,0]], gU=[[0,0],[1,0],[1,1],[0,1]];
if(process.argv[9]==='pad'){
 // plano subdividido em pedacos de 4 tiles (o rasterizador de teste nao recorta triangulos atras da camera)
 const PW=map.width+2*P, PH=map.height+2*P, S=4;
 for(let gx=0;gx<PW;gx+=S)for(let gz=0;gz<PH;gz+=S){const x0=-P+gx,x1=Math.min(-P+gx+S,map.width+P),z0=-P+gz,z1=Math.min(-P+gz+S,map.height+P);
  const uv=(x,z)=>[(x+P)/PW,(map.height+P-z)/PH];
  const q=[[x0,-0.02,z1],[x1,-0.02,z1],[x1,-0.02,z0],[x0,-0.02,z0]], qu=q.map(v=>uv(v[0],v[2]));
  tris.push({p:[q[0],q[1],q[2]],u:[qu[0],qu[1],qu[2]],tex:btex,bias:0,pad:true});tris.push({p:[q[0],q[2],q[3]],u:[qu[0],qu[2],qu[3]],tex:btex,bias:0,pad:true});}}
for(const [tex,bias] of [[base,0],[over,1]]){addTri(gP,gU,0,1,2,tex,bias);addTri(gP,gU,0,2,3,tex,bias);}
const FP=[],FU=[];for(let i=0;i<fold.positions.length/3;i++){FP.push([fold.positions[i*3],fold.positions[i*3+1],fold.positions[i*3+2]]);FU.push([fold.uvs[i*2],fold.uvs[i*2+1]]);}
for(const [tex,bias] of [[base,0],[over,1]])for(let i=0;i<fold.indices.length;i+=3)addTri(FP,FU,fold.indices[i],fold.indices[i+1],fold.indices[i+2],tex,bias);

// camera do app
const W=800,H=450, cx=+camX, cz=+camZ;
const eye=[cx,10,cz+11], tgt=[cx,0,cz];
const f=(()=>{const d=[tgt[0]-eye[0],tgt[1]-eye[1],tgt[2]-eye[2]];const l=Math.hypot(...d);return d.map(v=>v/l);})();
const r=[ -f[2]*0+0, 0, 0]; // right = normalize(f x up)
const up0=[0,1,0]; const rx=[f[1]*up0[2]-f[2]*up0[1], f[2]*up0[0]-f[0]*up0[2], f[0]*up0[1]-f[1]*up0[0]]; const rl=Math.hypot(...rx); const R=rx.map(v=>v/rl);
const Uv=[R[1]*f[2]-R[2]*f[1], R[2]*f[0]-R[0]*f[2], R[0]*f[1]-R[1]*f[0]];
const tanH=Math.tan(48*Math.PI/360), aspect=W/H;
const proj=p=>{const d=[p[0]-eye[0],p[1]-eye[1],p[2]-eye[2]];const z=d[0]*f[0]+d[1]*f[1]+d[2]*f[2];const x=d[0]*R[0]+d[1]*R[1]+d[2]*R[2];const y=d[0]*Uv[0]+d[1]*Uv[1]+d[2]*Uv[2];
 return [W/2+(x/(z*tanH*aspect))*W/2, H/2-(y/(z*tanH))*H/2, z];};
const img=new Uint8Array(W*H*4), zb=new Float32Array(W*H).fill(Infinity);
for(let i=0;i<img.length;i+=4){img[i]=11;img[i+1]=18;img[i+2]=32;img[i+3]=255;}
for(const t of tris){
  const s=t.p.map(proj); if(s.some(v=>v[2]<=0.1))continue;
  const minX=Math.max(0,Math.floor(Math.min(...s.map(v=>v[0])))),maxX=Math.min(W-1,Math.ceil(Math.max(...s.map(v=>v[0]))));
  const minY=Math.max(0,Math.floor(Math.min(...s.map(v=>v[1])))),maxY=Math.min(H-1,Math.ceil(Math.max(...s.map(v=>v[1]))));
  const [a,b,c]=s; const area=(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]); if(Math.abs(area)<1e-9)continue;
  for(let y=minY;y<=maxY;y++)for(let x=minX;x<=maxX;x++){
    const px=x+0.5,py=y+0.5;
    let w0=((b[0]-px)*(c[1]-py)-(b[1]-py)*(c[0]-px))/area, w1=((c[0]-px)*(a[1]-py)-(c[1]-py)*(a[0]-px))/area, w2=1-w0-w1;
    if(w0<0||w1<0||w2<0)continue;
    const iz=w0/a[2]+w1/b[2]+w2/c[2], z=1/iz;
    const uu=(w0*t.u[0][0]/a[2]+w1*t.u[1][0]/b[2]+w2*t.u[2][0]/c[2])*z, vv=(w0*t.u[0][1]/a[2]+w1*t.u[1][1]/b[2]+w2*t.u[2][1]/c[2])*z;
    let o;
    if(t.pad){const fu=uu*rep[0]+off[0],fv=vv*rep[1]+off[1];const tx=Math.floor((fu-Math.floor(fu))*BTW),ty=Math.floor((fv-Math.floor(fv))*BTH);o=(ty*BTW+tx)*4;}
    else{const tx=Math.min(TW-1,Math.max(0,Math.floor(uu*TW))), ty=Math.min(TH-1,Math.max(0,Math.floor(vv*TH)));o=(ty*TW+tx)*4;} if(t.tex[o+3]<128)continue;
    const zi=y*W+x, zz=z-t.bias*0.01; if(zz>zb[zi])continue; zb[zi]=zz;
    img[zi*4]=t.tex[o];img[zi*4+1]=t.tex[o+1];img[zi*4+2]=t.tex[o+2];
  }
}
writeFileSync(out,png(W,H,img));
log(`mapa ${G}:${M} ${map.width}x${map.height} | quads da dobra: ${fold.quadCount}`);
