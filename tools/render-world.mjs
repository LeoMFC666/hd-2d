// Renderiza um mapa + vizinhos conectados com o volume completo do app
// (buildMapVolume: estruturas 3D, objetos em pe, ledges; composeMapTextures:
// chao e modelos) e o padding, usando a camera do app. Rasterizador por
// software: confere o voxel sem navegador.
//
// Monte antes o pacote com o codigo atual do app, num arquivo entry8.ts
// na pasta deste script contendo:
//   export { Gen3StateAdapter } from '<repo>/src/gen3/Gen3StateAdapter';
//   export { MapCatalog } from '<repo>/src/gen3/world/MapCatalog';
//   export * from '<repo>/src/render/VoxelFolding';
//   export { buildPadding, isBorderRaised } from '<repo>/src/render/PaddingBuilder';
//   export * from '<repo>/src/render/GroundSubstitution';
// e depois:
//   esbuild entry8.ts --bundle --format=esm --platform=node --outfile=b8.mjs
//
// Uso: node render-world.mjs <rom> <grupo> <mapa> <saida.png> <dx> <dz> [vizinhos 0|1]
// Variaveis:
//   DEBUG=1       pinta estruturas (vermelho) e objetos em pe (azul)
//   PLAYER=x,y    jogador (retangulo 16x32) no tile x,y do mapa principal,
//                 com o raio-x atras das estruturas
//   CAM=x,y       centro da camera no tile x,y (em vez do centro + dx,dz)
//   W=800 H=450   tamanho da imagem
import { readFileSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { Gen3StateAdapter, MapCatalog, buildPadding, isBorderRaised, buildMapVolume, buildGroundGeometry, WATER_DEPTH, markRocksInWater, composeMapTextures, cutoutTile, tileColors, findGroundCell, buildPropGeometry, modelRowOpaque } from './b8.mjs';
const BASE=0x08000000, PX=16;
const u16=(r,o)=>r[o]|(r[o+1]<<8), u32=(r,o)=>(r[o]|(r[o+1]<<8)|(r[o+2]<<16)|(r[o+3]<<24))>>>0;
function png(w,h,rgba){const T=new Int32Array(256).map((_,n)=>{let c=n;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;return c;});const crc=b=>{let c=-1;for(const x of b)c=T[(c^x)&255]^(c>>>8);return(c^-1)>>>0;};const ch=(t,d)=>{const b=Buffer.alloc(12+d.length);b.writeUInt32BE(d.length,0);b.write(t,4);d.copy(b,8);b.writeUInt32BE(crc(b.subarray(4,8+d.length)),8+d.length);return b;};const raw=Buffer.alloc((w*4+1)*h);for(let y=0;y<h;y++){raw[y*(w*4+1)]=0;Buffer.from(rgba.buffer,y*w*4,w*4).copy(raw,y*(w*4+1)+1);}const ih=Buffer.alloc(13);ih.writeUInt32BE(w,0);ih.writeUInt32BE(h,4);ih[8]=8;ih[9]=6;return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),ch('IHDR',ih),ch('IDAT',deflateSync(raw)),ch('IEND',Buffer.alloc(0))]);}
function romReader(rom){const u8=a=>a>=BASE&&a-BASE<rom.length?rom[a-BASE]:0;return{readU8:u8,readU16:a=>u8(a)|(u8(a+1)<<8),readU32:a=>(u8(a)|(u8(a+1)<<8)|(u8(a+2)<<16)|(u8(a+3)<<24))>>>0,readRange:(a,n)=>{const o=new Uint8Array(n);for(let i=0;i<n;i++)o[i]=u8(a+i);return o;}};}
const [file, G, M, out, camDX, camDZ, neighborsFlag] = process.argv.slice(2);
const rom=new Uint8Array(readFileSync(file)); const code=String.fromCharCode(...rom.slice(0xac,0xb0));
const frlg=code.startsWith('BPR')||code.startsWith('BPG');
const primaryCount=frlg?640:512;
const ad=new Gen3StateAdapter(romReader(rom),rom); const cat=new MapCatalog();
const groups=cat.findMapGroupsByStructure(rom);
const header=(g,m)=>u32(rom,u32(rom,groups-BASE+g*4)-BASE+m*4);
const log=console.log; console.log=()=>{};
// Camera do app: olho 10 acima e 11 atras; sprites e objetos em pe esticados por 1/cos(inclinacao).
const UPRIGHT=Math.hypot(10,11)/11;
function loadMap(g,m,x,z){
  const hdr=header(g,m), lay=u32(rom,hdr-BASE), lo=lay-BASE;
  const W=u32(rom,lo),H=u32(rom,lo+4), border=cat.readBorder(rom,lo,frlg);
  const borderRaw=[];for(let i=0;i<border.borderWidth*border.borderHeight;i++)borderRaw.push(u16(rom,border.borderAddress-BASE+i*2));
  const rd=ad.getMapRenderData(u32(rom,lo+12),W,H,u32(rom,lo+16),u32(rom,lo+20),borderRaw.map(v=>v&0x3ff));
  const TW=W*PX,TH=H*PX;
  // textura do bloco de borda (como buildBorderTexture: desenho completo)
  const bw=border.borderWidth,bh=border.borderHeight,BW=bw*PX,BH=bh*PX,btex=new Uint8Array(BW*BH*4);
  for(let ty=0;ty<bh;ty++)for(let tx=0;tx<bw;tx++){const gr=rd.graphics.get(borderRaw[ty*bw+tx]&0x3ff);if(!gr)continue;
    for(let sy=0;sy<PX;sy++)for(let sx=0;sx<PX;sx++){const so=(sy*PX+sx)*4,dy=(bh-1-ty)*PX+PX-1-sy,d=(dy*BW+tx*PX+sx)*4;for(let c=0;c<4;c++)btex[d+c]=gr.pixels[so+c];}}
  const op=px=>{for(let i=3;i<px.length;i+=4)if(px[i]>127)return true;return false;};
  const reach=px=>{for(let i=15*64+3;i<px.length;i+=4)if(px[i]>127)return true;return false;};
  const blockAt=(xx,y)=>{const b=rd.blocks[y*W+xx];if(!b)return undefined;const gr=rd.graphics.get(b.metatileId);return {...b,behavior:gr?.behavior??0,hasForeground:!!gr&&op(gr.foregroundPixels),topReachesBottom:gr?reach(gr.topPixels):undefined,flower:b.metatileId<primaryCount&&!!gr&&gr.topTileIds.some(t=>t>=508&&t<=511),basePixels:gr?.basePixels,pixels:gr?.pixels,secondary:b.metatileId>=primaryCount};};
  const type=rom[hdr-BASE+0x17]; const style=(type===8||type===9)?'interior':'outdoor';
  const vol=buildMapVolume(W,H,blockAt,cat.readWarps(rom,hdr),style,2,new Set(borderRaw.map(v=>v&0x3ff)));
  const ids=new Uint16Array(W*H); for(let i=0;i<ids.length;i++)ids[i]=rd.blocks[i]?.metatileId??0;
  const raised=isBorderRaised(borderRaw.map(v=>v&0x3ff),ids,vol.mask);
  const water=new Uint8Array(W*H); const wbs=new Set(); for(let i=0;i<W*H;i++){if(rd.blocks[i]?.elevation===1){water[i]=1;const bh2=rd.graphics.get(rd.blocks[i].metatileId)?.behavior;if(bh2)wbs.add(bh2);}} for(let i=0;i<W*H;i++){const bh2=rd.graphics.get(rd.blocks[i]?.metatileId)?.behavior; if(bh2!==undefined&&wbs.has(bh2))water[i]=1;} markRocksInWater(W,H,water,(xx,y)=>rd.blocks[y*W+xx].collision!==0);
  const wb=new Set(); for(let i=0;i<W*H;i++)if(rd.blocks[i]?.elevation===1){const bh2=rd.graphics.get(rd.blocks[i].metatileId)?.behavior; if(bh2!==undefined)wb.add(bh2);} let wet=0; for(const v of borderRaw){const bh2=rd.graphics.get(v&0x3ff)?.behavior; if(bh2!==undefined&&wb.has(bh2))wet++;} const lowered=borderRaw.length>0&&wet*2>=borderRaw.length;
  const artAt=(xx,y)=>{const b=rd.blocks[y*W+xx];const gr=b&&rd.graphics.get(b.metatileId);return gr?{base:gr.basePixels,foreground:gr.foregroundPixels,bottom:gr.bottomPixels,top:gr.topPixels,merged:gr.pixels}:undefined;};
  const comp=composeMapTextures(W,H,vol.kinds,vol.groundSources,artAt);
  const props=true?buildPropGeometry(W,H,vol.kinds,blockAt,modelRowOpaque(comp.model,W,H)):{positions:new Float32Array(0),uvs:new Float32Array(0),colors:new Float32Array(0),indices:new Uint32Array(0),quadCount:0};
  let gtile=null; {const gc=findGroundCell(W,H,vol.mask,(xx,y)=>rd.blocks[y*W+xx]); if(gc){const gp=rd.graphics.get(rd.blocks[gc.y*W+gc.x].metatileId)?.basePixels; if(gp){gtile=new Uint8Array(256*4); for(let r=0;r<16;r++)gtile.set(gp.subarray(r*64,(r+1)*64),(15-r)*64); if(raised){const cols=tileColors(gp); for(let ty=0;ty<bh;ty++)for(let tx=0;tx<bw;tx++)cutoutTile(btex,BW,tx*16,ty*16,cols);}}}}
  return {gtile,water,lowered,rd,vol,props,key:`${g}:${m}`,g,m,x,z,W,H,comp,TW,TH,btex,BW,BH,bw,bh,raised,type,hdr};
}
const main=loadMap(+G,+M,0,0); const maps=[main];
if(neighborsFlag!=='0'){
  for(const c of cat.readConnections(rom,main.hdr)){
    const t=u32(rom,header(c.mapGroup,c.mapNumber)-BASE)-BASE; const tw=u32(rom,t),th=u32(rom,t+4);
    const pos={NORTH:[c.offset,-th],SOUTH:[c.offset,main.H],WEST:[-tw,c.offset],EAST:[main.W,c.offset]}[c.direction];
    if(!pos)continue;
    maps.push(loadMap(c.mapGroup,c.mapNumber,pos[0],pos[1]));
  }
}
console.log=log;
const OUT=new Set([1,2,3,5,6]);
const padding=OUT.has(main.type)?buildPadding(maps.map(m=>({key:m.key,x:m.x,z:m.z,width:m.W,height:m.H,borderWidth:m.bw,borderHeight:m.bh,spreads:OUT.has(m.type),raised:m.raised,lowered:m.lowered,waterLevel:-WATER_DEPTH})),24,2):[];
// triangulos: kind 0 chao, 1 estrutura, 2 objeto em pe, 3 jogador
const tris=[]; const add=(P,U,I,tex,tw,th,wrap,bias,C,kind=0)=>{for(let i=0;i<I.length;i+=3)tris.push({p:[P[I[i]],P[I[i+1]],P[I[i+2]]],u:[U[I[i]],U[I[i+1]],U[I[i+2]]],c:C?[C[I[i]],C[I[i+1]],C[I[i+2]]]:null,tex,tw,th,wrap,bias,kind,quad:Math.floor(i/6)});};
const arr=(f,n)=>{const o=[];for(let i=0;i<f.length/n;i++)o.push(Array.from(f.slice(i*n,i*n+n)));return o;};
const geo=(m,data,tex,kind,scaleY)=>{const P=arr(data.positions,3).map(p=>[p[0]+m.x,p[1]*scaleY,p[2]+m.z]);add(P,arr(data.uvs,2),Array.from(data.indices),tex,m.TW,m.TH,false,0,arr(data.colors,3).map(c=>c[0]),kind);};
for(const m of maps){
  {const gd=buildGroundGeometry(m.W,m.H,(xx,y)=>m.water[y*m.W+xx]===1,0); const GP=arr(gd.positions,3).map(p=>[p[0]+m.x,p[1],p[2]+m.z]), GU=arr(gd.uvs,2), GC=arr(gd.colors,3).map(c=>c[0]), GI=Array.from(gd.indices);
  add(GP,GU,GI,m.comp.groundBase,m.TW,m.TH,false,0,GC); add(GP,GU,GI,m.comp.groundOverlay,m.TW,m.TH,false,1,GC);}
  geo(m,m.vol.structures,m.comp.model,1,1);
  geo(m,m.props,m.comp.model,2,UPRIGHT);
  geo(m,m.vol.details,m.comp.model,2,1);
}
for(const p of padding){const m=maps.find(x=>x.key===p.key); const sy=p.floor?UPRIGHT:1; add(arr(p.positions,3).map(q=>[q[0],q[1]*sy,q[2]]),arr(p.uvs,2),Array.from(p.indices),m.btex,m.BW,m.BH,true,-1,arr(p.colors,3).map(c=>c[0]),p.floor?2:0); if(p.floor){ if(m.gtile) add(arr(p.floor.positions,3),arr(p.floor.uvs,2),Array.from(p.floor.indices),m.gtile,16,16,true,-1.5); else add(arr(p.floor.positions,3),arr(p.floor.uvs,2).map(([a,b])=>[a/m.bw,b/m.bh]),Array.from(p.floor.indices),m.btex,m.BW,m.BH,true,-1.5);}}
// jogador de teste: retangulo 16x32 (vermelho com contorno), em pe no centro do tile
let player=null;
if(process.env.PLAYER){const [px,py]=process.env.PLAYER.split(',').map(Number); const tex=new Uint8Array(16*32*4); for(let y=0;y<32;y++)for(let x=0;x<16;x++){const o=(y*16+x)*4; const edge=x<3||x>12||y<1||y>30; tex[o]=edge?30:235;tex[o+1]=edge?30:70;tex[o+2]=edge?30:70;tex[o+3]=(x>=2&&x<=13)?255:0;}
  const cx=main.x+px+0.5, cz=main.z+py+0.5, h=2*UPRIGHT; player={tex,P:[[cx-0.5,0,cz],[cx+0.5,0,cz],[cx+0.5,h,cz],[cx-0.5,h,cz]],U:[[0,0],[1,0],[1,1],[0,1]]};
  add(player.P,player.U,[0,1,2,0,2,3],tex,16,32,false,0,null,3);}
log(maps.map(m=>`${m.key} @(${m.x},${m.z}) ${m.W}x${m.H} borda ${m.bw}x${m.bh} ${m.raised?'ELEVADA':'plana'}`).join('\n'));
{const k=main.vol.kinds;const n=[0,0,0,0,0,0,0,0];for(const v of k)n[v]++;log('tipos: chao',n[0],'estrutura',n[1],'topo-estr',n[2],'objeto',n[3],'topo-obj',n[4],'ledge',n[5],'grama',n[6],'flor',n[7],'| quads: estruturas',main.vol.structures.quadCount,'objetos',main.props.quadCount);}
// camera
const W=+(process.env.W||800),H=+(process.env.H||450);
let cx=main.W/2+(+camDX), cz=main.H/2+(+camDZ);
if(process.env.CAM){const [a,b]=process.env.CAM.split(',').map(Number);cx=a+0.5;cz=b+0.5;}
const eye=[cx,10,cz+11], tgt=[cx,0,cz];
const d0=[tgt[0]-eye[0],tgt[1]-eye[1],tgt[2]-eye[2]], dl=Math.hypot(...d0), f=d0.map(v=>v/dl);
const rx=[f[1]*0-f[2]*1, f[2]*0-f[0]*0, f[0]*1-f[1]*0], rl=Math.hypot(...rx), R=rx.map(v=>v/rl);
const Uv=[R[1]*f[2]-R[2]*f[1], R[2]*f[0]-R[0]*f[2], R[0]*f[1]-R[1]*f[0]];
const tanH=Math.tan(48*Math.PI/360), aspect=W/H;
const proj=p=>{const d=[p[0]-eye[0],p[1]-eye[1],p[2]-eye[2]];const z=d[0]*f[0]+d[1]*f[1]+d[2]*f[2];const x=d[0]*R[0]+d[1]*R[1]+d[2]*R[2];const y=d[0]*Uv[0]+d[1]*Uv[1]+d[2]*Uv[2];return [W/2+(x/(z*tanH*aspect))*W/2, H/2-(y/(z*tanH))*H/2, z];};
const interior=!OUT.has(main.type);
const img=new Uint8Array(W*H*4), zb=new Float32Array(W*H).fill(Infinity), front=new Uint8Array(W*H);
for(let i=0;i<img.length;i+=4){img[i]=interior?0:11;img[i+1]=interior?0:18;img[i+2]=interior?0:32;img[i+3]=255;}
const raster=(t,xray)=>{
  const s=t.p.map(proj); if(s.some(v=>v[2]<=0.1))return;
  const [a,b,c]=s; const area=(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]); if(Math.abs(area)<1e-9)return;
  const x0=Math.max(0,Math.floor(Math.min(a[0],b[0],c[0]))),x1=Math.min(W-1,Math.ceil(Math.max(a[0],b[0],c[0])));
  const y0=Math.max(0,Math.floor(Math.min(a[1],b[1],c[1]))),y1=Math.min(H-1,Math.ceil(Math.max(a[1],b[1],c[1])));
  for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++){const px=x+.5,py=y+.5;
    const w0=((b[0]-px)*(c[1]-py)-(b[1]-py)*(c[0]-px))/area,w1=((c[0]-px)*(a[1]-py)-(c[1]-py)*(a[0]-px))/area,w2=1-w0-w1; if(w0<0||w1<0||w2<0)continue;
    const z=1/(w0/a[2]+w1/b[2]+w2/c[2]);
    let uu=(w0*t.u[0][0]/a[2]+w1*t.u[1][0]/b[2]+w2*t.u[2][0]/c[2])*z, vv=(w0*t.u[0][1]/a[2]+w1*t.u[1][1]/b[2]+w2*t.u[2][1]/c[2])*z;
    if(t.wrap){uu-=Math.floor(uu);vv-=Math.floor(vv);}
    const tx=Math.min(t.tw-1,Math.max(0,Math.floor(uu*t.tw))),ty=Math.min(t.th-1,Math.max(0,Math.floor(vv*t.th)));
    const o=(ty*t.tw+tx)*4; if(t.tex[o+3]<128)continue;
    const zi=y*W+x, zz=z-t.bias*0.01;
    if(xray){ if(!(zz>zb[zi]&&front[zi]===1))continue; for(let k=0;k<3;k++)img[zi*4+k]=img[zi*4+k]*0.45+t.tex[o+k]*0.55; continue; }
    if(zz>zb[zi])continue; zb[zi]=zz; front[zi]=t.kind;
    const sh=t.c?(w0*t.c[0]/a[2]+w1*t.c[1]/b[2]+w2*t.c[2]/c[2])*z:1;
    let r=t.tex[o]*sh,g=t.tex[o+1]*sh,bl=t.tex[o+2]*sh;
    if(process.env.DEBUG==='2'&&t.kind===2){const pal=[[255,0,0],[0,90,255],[255,220,0],[0,220,90],[220,0,220],[0,220,220]];const tint=pal[t.quad%6];r=(r*2+tint[0])/3;g=(g*2+tint[1])/3;bl=(bl*2+tint[2])/3;}
    else if(process.env.DEBUG&&(t.kind===1||t.kind===2)){const tint=t.kind===1?[255,0,0]:[0,80,255];r=(r+tint[0])/2;g=(g+tint[1])/2;bl=(bl+tint[2])/2;}
    img[zi*4]=r;img[zi*4+1]=g;img[zi*4+2]=bl;}
};
// ordem do app: chao, objetos, sprites e depois estruturas; o raio-x por ultimo
for(const kind of [0,2,3,1])for(const t of tris)if(t.kind===kind)raster(t,false);
if(player)for(const t of tris)if(t.kind===3)raster(t,true);
writeFileSync(out,png(W,H,img));
