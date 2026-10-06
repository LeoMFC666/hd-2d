declare const createMgbaModule: (args?: any) => Promise<any>;

const BASE = 0x08000000;

function u8(r: Uint8Array, o: number): number {
  return r[o] ?? 0;
}
function u16(r: Uint8Array, o: number): number {
  return u8(r,o) | (u8(r,o+1) << 8);
}
function u32(r: Uint8Array, o: number): number {
  return (u8(r,o) | (u8(r,o+1) << 8) | (u8(r,o+2) << 16) | (u8(r,o+3) * 0x1000000)) >>> 0;
}
function isPtr(r: Uint8Array, a: number, size=1): boolean {
  const o=a-BASE;
  return o>=0 && o+size<=r.length;
}
function hex(n:number){return '0x'+(n>>>0).toString(16);}
function isExpectedConn(c:any,dir:number,g:number,m:number,off:number){
  return c.direction===dir && c.mapGroup===g && c.mapNumber===m && c.offset===off;
}
function getPalletAnchor(r:Uint8Array){
  for(let o=0;o+0x1c<=r.length;o+=4){
    const la=u32(r,o);
    if(!isPtr(r,la,0x18))continue;
    const lo=la-BASE;
    if(u32(r,lo)!==24||u32(r,lo+4)!==20)continue;
    const cp=u32(r,o+0x0c);
    if(!isPtr(r,cp,8))continue;
    const co=cp-BASE,n=u32(r,co)|0,d=u32(r,co+4);
    if(n<2||n>64||!isPtr(r,d,n*0xc))continue;
    const doff=d-BASE;let north=false,south=false;
    for(let i=0;i<n;i++){
      const e=doff+i*0xc;
      const c={direction:u8(r,e),offset:u32(r,e+4)|0,mapGroup:u8(r,e+8),mapNumber:u8(r,e+9)};
      if(isExpectedConn(c,2,3,19,0))north=true;
      if(isExpectedConn(c,1,3,39,0))south=true;
    }
    if(north&&south)return {mapLayoutAddress:la,mapLayoutId:u16(r,o+0x12),header:BASE+o};
  }
  return null;
}
async function main(){
  const out=document.querySelector('#out')!;
  const rom=new Uint8Array(await (await fetch('/Pokemon - FireRed Version (USA, Europe) (Rev 1).gba',{cache:'no-store'})).arrayBuffer());
  const anchor=getPalletAnchor(rom);
  if(!anchor)throw new Error('Pallet anchor not found');

  if(typeof createMgbaModule!=='function')throw new Error('createMgbaModule not found');

  const mod=await createMgbaModule({locateFile:(p:string)=>'/mgba/'+p});
  mod._mgbawasm_init();
  const ptr=mod._malloc(rom.length);
  mod.HEAPU8.set(rom,ptr);
  const ok=mod._mgbawasm_load(ptr,rom.length,0,0,0,0,1);
  mod._free(ptr);
  if(!ok)throw new Error('mGBA load failed: '+ok);

  // Canonical Cinnabar values from the stable raw-ROM catalog.
  const cinnabar={
    header:0x08350768,
    layout:0x082e3b90,
    mapData:0x082e37d0,
    primary:0x082d4b04,
    secondary:0x082d4bdc,
  };
  const beta=BASE+0x00338378;

  const addrs=[
    ['cinnabarHeader',cinnabar.header],
    ['cinnabarLayout',cinnabar.layout],
    ['cinnabarMapData',cinnabar.mapData],
    ['cinnabarPrimary',cinnabar.primary],
    ['cinnabarSecondary',cinnabar.secondary],
    ['betaOffset',beta],
  ] as const;

  const bus=addrs.map(([name,a])=>({
    name,
    address:hex(a),
    raw32:hex(u32(rom,a-BASE)),
    bus8:mod._mgbawasm_bus_read8(a)&255,
    bus16:mod._mgbawasm_bus_read16(a)&65535,
    bus32:hex(mod._mgbawasm_bus_read32(a)),
  }));

  const firstBlocksRaw=Array.from({length:16},(_,i)=>u16(rom,cinnabar.mapData-BASE+i*2));
  const firstBlocksBus=Array.from({length:16},(_,i)=>mod._mgbawasm_bus_read16(cinnabar.mapData+i*2)&65535);

  // Inspect beta offset as raw words; this is intentionally NOT treated as
  // Cinnabar unless the address itself is reached by the bus.
  const betaWords=Array.from({length:16},(_,i)=>u16(rom,beta-BASE+i*2));
  const betaBusWords=Array.from({length:16},(_,i)=>mod._mgbawasm_bus_read16(beta+i*2)&65535);

  const result={
    pass:true,
    anchor,
    cinnabar,
    beta:hex(beta),
    bus,
    firstBlocksRaw,
    firstBlocksBus,
    betaWords,
    betaBusWords,
    rawVsBusCinnabarBlocks:firstBlocksRaw.every((v,i)=>v===firstBlocksBus[i]),
    rawVsBusBeta:betaWords.every((v,i)=>v===betaBusWords[i])
  };
  out.textContent=JSON.stringify(result,null,2);
  document.body.dataset.pass='true';
  mod._mgbawasm_unload();
}
main().catch(e=>{
  document.body.dataset.pass='false';
  document.querySelector('#out')!.textContent=JSON.stringify({pass:false,error:String(e)},null,2);
});