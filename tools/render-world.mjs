// Renderiza um mapa + vizinhos conectados, com o volume completo
// (buildMapVolume: arvores em cartoes, predios, ledges, grama, interiores) e o padding, usando a
// camera do app. Rasterizador por software: confere o voxel sem navegador.
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
// Variaveis: DEBUG=1 pinta as faces por direcao; NOPATCH=1 sem remendo;
// NOEXT=1 sem topos de objeto; PROBE=x,y lista triangulos do pixel.
import { readFileSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { Gen3StateAdapter, MapCatalog, buildPadding, isBorderRaised, buildMapVolume, buildGroundGeometry, WATER_DEPTH, markRocksInWater, chooseGroundSources, applyGroundSubstitution, cutoutBackgrounds, cutoutTile, tileColors, findGroundCell } from './b8.mjs';
const BASE=0x08000000, PX=16;
const u16=(r,o)=>r[o]|(r[o+1]<<8), u32=(r,o)=>(r[o]|(r[o+1]<<8)|(r[o+2]<<16)|(r[o+3]<<24))>>>0;
function png(w,h,rgba){const T=new Int32Array(256).map((_,n)=>{let c=n;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;return c;});const crc=b=>{let c=-1;for(const x of b)c=T[(c^x)&255]^(c>>>8);return(c^-1)>>>0;};const ch=(t,d)=>{const b=Buffer.alloc(12+d.length);b.writeUInt32BE(d.length,0);b.write(t,4);d.copy(b,8);b.writeUInt32BE(crc(b.subarray(4,8+d.length)),8+d.length);return b;};const raw=Buffer.alloc((w*4+1)*h);for(let y=0;y<h;y++){raw[y*(w*4+1)]=0;Buffer.from(rgba.buffer,y*w*4,w*4).copy(raw,y*(w*4+1)+1);}const ih=Buffer.alloc(13);ih.writeUInt32BE(w,0);ih.writeUInt32BE(h,4);ih[8]=8;ih[9]=6;return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),ch('IHDR',ih),ch('IDAT',deflateSync(raw)),ch('IEND',Buffer.alloc(0))]);}
function romReader(rom){const u8=a=>a>=BASE&&a-BASE<rom.length?rom[a-BASE]:0;return{readU8:u8,readU16:a=>u8(a)|(u8(a+1)<<8),readU32:a=>(u8(a)|(u8(a+1)<<8)|(u8(a+2)<<16)|(u8(a+3)<<24))>>>0,readRange:(a,n)=>{const o=new Uint8Array(n);for(let i=0;i<n;i++)o[i]=u8(a+i);return o;}};}
const [file, G, M, out, camDX, camDZ, neighborsFlag] = process.argv.slice(2);
const rom=new Uint8Array(readFileSync(file)); const code=String.fromCharCode(...rom.slice(0xac,0xb0));
const frlg=code.startsWith('BPR')||code.startsWith('BPG');
const ad=new Gen3StateAdapter(romReader(rom),rom); const cat=new MapCatalog();
const groups=cat.findMapGroupsByStructure(rom);
const header=(g,m)=>u32(rom,u32(rom,groups-BASE+g*4)-BASE+m*4);
const log=console.log; console.log=()=>{};
function loadMap(g,m,x,z){
  const hdr=header(g,m), lay=u32(rom,hdr-BASE), lo=lay-BASE;
  const W=u32(rom,lo),H=u32(rom,lo+4), border=cat.readBorder(rom,lo,frlg);
  const borderRaw=[];for(let i=0;i<border.borderWidth*border.borderHeight;i++)borderRaw.push(u16(rom,border.borderAddress-BASE+i*2));
  const rd=ad.getMapRenderData(u32(rom,lo+12),W,H,u32(rom,lo+16),u32(rom,lo+20),borderRaw.map(v=>v&0x3ff));
  const TW=W*PX,TH=H*PX, base=new Uint8Array(TW*TH*4), over=new Uint8Array(TW*TH*4);
  for(let y=0;y<H;y++)for(let xx=0;xx<W;xx++){const b=rd.blocks[y*W+xx];const gr=b&&rd.graphics.get(b.metatileId);if(!gr)continue;
    for(let sy=0;sy<PX;sy++){const dy=(H-1-y)*PX+PX-1-sy;for(let sx=0;sx<PX;sx++){const so=(sy*PX+sx)*4,d=(dy*TW+xx*PX+sx)*4;for(let c=0;c<4;c++){base[d+c]=gr.basePixels[so+c];over[d+c]=gr.foregroundPixels[so+c];}}}}
  // textura do bloco de borda (como buildPaddingPlane)
  const bw=border.borderWidth,bh=border.borderHeight,BW=bw*PX,BH=bh*PX,btex=new Uint8Array(BW*BH*4);
  for(let ty=0;ty<bh;ty++)for(let tx=0;tx<bw;tx++){const gr=rd.graphics.get(borderRaw[ty*bw+tx]&0x3ff);if(!gr)continue;
    for(let sy=0;sy<PX;sy++)for(let sx=0;sx<PX;sx++){const so=(sy*PX+sx)*4,dy=(bh-1-ty)*PX+PX-1-sy,d=(dy*BW+tx*PX+sx)*4;for(let c=0;c<4;c++)btex[d+c]=gr.basePixels[so+c];}}
  const op=px=>{for(let i=3;i<px.length;i+=4)if(px[i]>127)return true;return false;};
  const blockAt=(xx,y)=>{const b=rd.blocks[y*W+xx];if(!b)return undefined;const g=rd.graphics.get(b.metatileId);return {...b,behavior:g?.behavior??0,hasForeground:!!g&&op(g.foregroundPixels),basePixels:g?.basePixels,secondary:b.metatileId>=(String.fromCharCode(...rom.slice(0xac,0xaf))==="BPR"||String.fromCharCode(...rom.slice(0xac,0xaf))==="BPG"?640:512)};};
  const type=rom[hdr-BASE+0x17]; const style=(type===8||type===9)?'interior':'outdoor';
  const vol=buildMapVolume(W,H,blockAt,cat.readWarps(rom,hdr),style,2,new Set(borderRaw.map(v=>v&0x3ff)));
  const ids=new Uint16Array(W*H); for(let i=0;i<ids.length;i++)ids[i]=rd.blocks[i]?.metatileId??0;
  const raised=isBorderRaised(borderRaw.map(v=>v&0x3ff),ids,vol.mask);
  const water=new Uint8Array(W*H); const wbs=new Set(); for(let i=0;i<W*H;i++){if(rd.blocks[i]?.elevation===1){water[i]=1;const bh=rd.graphics.get(rd.blocks[i].metatileId)?.behavior;if(bh)wbs.add(bh);}} for(let i=0;i<W*H;i++){const bh=rd.graphics.get(rd.blocks[i]?.metatileId)?.behavior; if(bh!==undefined&&wbs.has(bh))water[i]=1;} markRocksInWater(W,H,water,(xx,y)=>rd.blocks[y*W+xx].collision!==0);
  const wb=new Set(); for(let i=0;i<W*H;i++)if(rd.blocks[i]?.elevation===1){const bh=rd.graphics.get(rd.blocks[i].metatileId)?.behavior; if(bh!==undefined)wb.add(bh);} let wet=0; for(const v of borderRaw){const bh=rd.graphics.get(v&0x3ff)?.behavior; if(bh!==undefined&&wb.has(bh))wet++;} const lowered=borderRaw.length>0&&wet*2>=borderRaw.length; if(process.env.WDBG)console.error(g,m,[...wb],borderRaw.map(v=>(v&0x3ff).toString(16)+":"+rd.graphics.get(v&0x3ff)?.behavior+":"+(v>>10)));
  const srcs=vol.groundSources;
  const gbase=base.slice(), gover=over.slice(); if(!process.env.NOSUB){applyGroundSubstitution(W,H,srcs,gbase,gover); if(style==='outdoor')cutoutBackgrounds(W,H,srcs,(xx,y)=>vol.buildingIds[y*W+xx]===0,base,base);}
  let gtile=null; {const gc=findGroundCell(W,H,vol.mask,(xx,y)=>rd.blocks[y*W+xx]); if(gc){const gp=rd.graphics.get(rd.blocks[gc.y*W+gc.x].metatileId)?.basePixels; if(gp){gtile=new Uint8Array(256*4); for(let r=0;r<16;r++)gtile.set(gp.subarray(r*64,(r+1)*64),(15-r)*64); if(raised){const cols=tileColors(gp); for(let ty=0;ty<bh;ty++)for(let tx=0;tx<bw;tx++)cutoutTile(btex,BW,tx*16,ty*16,cols);}}}}
  const folds=[vol.natural,vol.details,...vol.buildings.map(b=>b.geometry)]; const patch=vol.patch;
  return {gtile,water,lowered,rd,key:`${g}:${m}`,g,m,x,z,W,H,base,over,gbase,gover,TW,TH,btex,BW,BH,bw,bh,raised,folds,patch,type:rom[hdr-BASE+0x17],hdr};
}
const main=loadMap(+G,+M,0,0); const maps=[main];
if(neighborsFlag!=='0'){
  for(const c of cat.readConnections(rom,main.hdr)){
    const t=u32(rom,header(c.mapGroup,c.mapNumber)-BASE)-BASE; const tw=u32(rom,t),th=u32(rom,t+4);
    const pos={NORTH:[c.offset,-th],SOUTH:[c.offset,main.H],WEST:[-tw,c.offset],EAST:[main.W,c.offset]}[c.direction];
    maps.push(loadMap(c.mapGroup,c.mapNumber,pos[0],pos[1]));
  }
}
console.log=log;
const OUT=new Set([1,2,3,5,6]);
const padding=buildPadding(maps.map(m=>({key:m.key,x:m.x,z:m.z,width:m.W,height:m.H,borderWidth:m.bw,borderHeight:m.bh,spreads:OUT.has(m.type),raised:m.raised,lowered:m.lowered,waterLevel:-WATER_DEPTH})),12,2);
// triangulos
const tris=[]; const add=(P,U,I,tex,tw,th,wrap,bias,C)=>{for(let i=0;i<I.length;i+=3)tris.push({p:[P[I[i]],P[I[i+1]],P[I[i+2]]],u:[U[I[i]],U[I[i+1]],U[I[i+2]]],c:C?[C[I[i]],C[I[i+1]],C[I[i+2]]]:null,tex,tw,th,wrap,bias});};
const arr=(f,n)=>{const o=[];for(let i=0;i<f.length/n;i++)o.push(Array.from(f.slice(i*n,i*n+n)));return o;};
for(const m of maps){
  {const gd=buildGroundGeometry(m.W,m.H,(xx,y)=>m.water[y*m.W+xx]===1,0); const GP=arr(gd.positions,3).map(p=>[p[0]+m.x,p[1],p[2]+m.z]), GU=arr(gd.uvs,2), GC=arr(gd.colors,3).map(c=>c[0]), GI=Array.from(gd.indices);
  add(GP,GU,GI,m.gbase,m.TW,m.TH,false,0,GC); add(GP,GU,GI,m.gover,m.TW,m.TH,false,1,GC);}
  for(const fold of m.folds){const FP=arr(fold.positions,3).map(p=>[p[0]+m.x,p[1],p[2]+m.z]), FU=arr(fold.uvs,2);
  const FC=arr(fold.colors,3).map(c=>c[0]); const FI=Array.from(fold.indices);
  add(FP,FU,FI.slice(0,fold.fullIndexCount),m.base,m.TW,m.TH,false,0,FC);
  add(FP,FU,FI,m.over,m.TW,m.TH,false,1,FC);}
  if(m.patch){const PP=arr(m.patch.positions,3).map(p=>[p[0]+m.x,p[1],p[2]+m.z]); add(PP,arr(m.patch.uvs,2),Array.from(m.patch.indices),m.base,m.TW,m.TH,false,1.5);}
}
for(const p of padding){const m=maps.find(x=>x.key===p.key); add(arr(p.positions,3),arr(p.uvs,2),Array.from(p.indices),m.btex,m.BW,m.BH,true,-1,arr(p.colors,3).map(c=>c[0])); if(p.floor){ if(m.gtile) add(arr(p.floor.positions,3),arr(p.floor.uvs,2),Array.from(p.floor.indices),m.gtile,16,16,true,-1.5); else add(arr(p.floor.positions,3),arr(p.floor.uvs,2).map(([a,b])=>[a/m.bw,b/m.bh]),Array.from(p.floor.indices),m.btex,m.BW,m.BH,true,-1.5);}}
log(maps.map(m=>`${m.key} @(${m.x},${m.z}) ${m.W}x${m.H} borda ${m.bw}x${m.bh} ${m.raised?'ELEVADA':'plana'}`).join('\n'));
log('padding:', padding.map(p=>`${p.key}=${p.cellCount} celulas`).join(', '));
// camera
const W=800,H=450, cx=main.W/2+(+camDX), cz=main.H/2+(+camDZ);
const eye=[cx,10,cz+11], tgt=[cx,0,cz];
const d0=[tgt[0]-eye[0],tgt[1]-eye[1],tgt[2]-eye[2]], dl=Math.hypot(...d0), f=d0.map(v=>v/dl);
const rx=[f[1]*0-f[2]*1, f[2]*0-f[0]*0, f[0]*1-f[1]*0], rl=Math.hypot(...rx), R=rx.map(v=>v/rl);
const Uv=[R[1]*f[2]-R[2]*f[1], R[2]*f[0]-R[0]*f[2], R[0]*f[1]-R[1]*f[0]];
const tanH=Math.tan(48*Math.PI/360), aspect=W/H;
const proj=p=>{const d=[p[0]-eye[0],p[1]-eye[1],p[2]-eye[2]];const z=d[0]*f[0]+d[1]*f[1]+d[2]*f[2];const x=d[0]*R[0]+d[1]*R[1]+d[2]*R[2];const y=d[0]*Uv[0]+d[1]*Uv[1]+d[2]*Uv[2];return [W/2+(x/(z*tanH*aspect))*W/2, H/2-(y/(z*tanH))*H/2, z];};
const img=new Uint8Array(W*H*4), zb=new Float32Array(W*H).fill(Infinity);
for(let i=0;i<img.length;i+=4){img[i]=11;img[i+1]=18;img[i+2]=32;img[i+3]=255;}
for(const t of tris){
  const s=t.p.map(proj); if(s.some(v=>v[2]<=0.1))continue;
  const [a,b,c]=s; const area=(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]); if(Math.abs(area)<1e-9)continue;
  const x0=Math.max(0,Math.floor(Math.min(a[0],b[0],c[0]))),x1=Math.min(W-1,Math.ceil(Math.max(a[0],b[0],c[0])));
  const y0=Math.max(0,Math.floor(Math.min(a[1],b[1],c[1]))),y1=Math.min(H-1,Math.ceil(Math.max(a[1],b[1],c[1])));
  for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++){const px=x+.5,py=y+.5;
    const w0=((b[0]-px)*(c[1]-py)-(b[1]-py)*(c[0]-px))/area,w1=((c[0]-px)*(a[1]-py)-(c[1]-py)*(a[0]-px))/area,w2=1-w0-w1; if(w0<0||w1<0||w2<0)continue;
    const z=1/(w0/a[2]+w1/b[2]+w2/c[2]);
    let uu=(w0*t.u[0][0]/a[2]+w1*t.u[1][0]/b[2]+w2*t.u[2][0]/c[2])*z, vv=(w0*t.u[0][1]/a[2]+w1*t.u[1][1]/b[2]+w2*t.u[2][1]/c[2])*z;
    if(t.wrap){uu-=Math.floor(uu);vv-=Math.floor(vv);}
    const tx=Math.min(t.tw-1,Math.max(0,Math.floor(uu*t.tw))),ty=Math.min(t.th-1,Math.max(0,Math.floor(vv*t.th)));
    const o=(ty*t.tw+tx)*4; if(t.tex[o+3]<128)continue;
    const zi=y*W+x, zz=z-t.bias*0.01; if(process.env.PROBE===x+','+y)log('probe',t.bias,zz.toFixed(3),JSON.stringify(t.p)); if(zz>zb[zi])continue; zb[zi]=zz;
    const sh=t.c?(w0*t.c[0]/a[2]+w1*t.c[1]/b[2]+w2*t.c[2]/c[2])*z:1;
    if(process.env.DEBUG&&t.c&&!t.wrap){const k=Math.round(t.c[0]*100);const tint={100:[255,255,0],88:[0,255,0],80:[0,0,255],70:[255,0,0]}[k]||[255,0,255];img[zi*4]=(t.tex[o]+tint[0])/2;img[zi*4+1]=(t.tex[o+1]+tint[1])/2;img[zi*4+2]=(t.tex[o+2]+tint[2])/2;continue;}
    img[zi*4]=t.tex[o]*sh;img[zi*4+1]=t.tex[o+1]*sh;img[zi*4+2]=t.tex[o+2]*sh;}
}
writeFileSync(out,png(W,H,img));
