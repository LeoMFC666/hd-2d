import * as THREE from 'three';
import { MapCatalog } from '../src/gen3/world/MapCatalog';
import { PlayerRenderer } from '../src/render/PlayerRenderer';
import type { Gen3StateAdapter } from '../src/gen3/Gen3StateAdapter';
import type { GameState } from '../src/gen3/GameState';
import type { MemoryReader } from '../src/gen3/MemoryReader';

const BASE=0x08000000;

class Reader implements MemoryReader {
  constructor(private readonly rom: Uint8Array){}
  readU8(address:number){const o=address-BASE;return o>=0&&o<this.rom.length?this.rom[o]:0}
  readU16(address:number){return this.readU8(address)|(this.readU8(address+1)<<8)}
  readU32(address:number){return (this.readU8(address)|(this.readU8(address+1)<<8)|(this.readU8(address+2)<<16)|(this.readU8(address+3)*0x1000000))>>>0}
  readRange(address:number,length:number){const out=new Uint8Array(length);for(let i=0;i<length;i++)out[i]=this.readU8(address+i);return out}
}

function u8(rom:Uint8Array,o:number){return o>=0&&o<rom.length?rom[o]:0}
function u16(rom:Uint8Array,o:number){return u8(rom,o)|(u8(rom,o+1)<<8)}
function u32(rom:Uint8Array,o:number){return (u8(rom,o)|(u8(rom,o+1)<<8)|(u8(rom,o+2)<<16)|(u8(rom,o+3)*0x1000000))>>>0}
function isPtr(rom:Uint8Array,address:number,size=1){const o=address-BASE;return o>=0&&o+size<=rom.length}
function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function derivePalletAnchorFromGlobalTable(rom:Uint8Array){
  const mapGroupsAddress = 0x08352718;
  const group3Address =
    u32(rom, (mapGroupsAddress - BASE) + 3 * 4);
  if (!isPtr(rom, group3Address, 66 * 4)) {
    return null;
  }

  const headerAddress =
    u32(
      rom,
      (group3Address - BASE) + 0 * 4,
    );

  if (!isPtr(rom, headerAddress, 0x1c)) {
    return null;
  }

  const layoutAddress =
    u32(
      rom,
      (headerAddress - BASE) + 0x00,
    );

  if (!isPtr(rom, layoutAddress, 0x18)) {
    return null;
  }

  return {
    mapLayoutAddress: layoutAddress,
    mapLayoutId:
      u16(
        rom,
        (headerAddress - BASE) + 0x12,
      ),
  };
}

function makeState(mapGroup:number,mapNumber:number,cinnabar:any):GameState{
  return {
    game:{game:'GEN 3',version:'Pokémon FireRed',region:'firered',revision:'1'},
    player:{x:12,y:10,z:0,direction:'DOWN',movementState:'idle'},
    map:{
      mapGroup,mapNumber,
      mapLayoutId:cinnabar.mapLayoutId,
      mapHeaderAddress:0,
      mapLayoutAddress:cinnabar.mapLayoutAddress,
      mapDataAddress:cinnabar.mapDataAddress,
      primaryTilesetAddress:cinnabar.primaryTilesetAddress,
      secondaryTilesetAddress:cinnabar.secondaryTilesetAddress,
      width:cinnabar.width,height:cinnabar.height,cellCount:cinnabar.width*cinnabar.height,
      blockSample:[],
      primaryTileset:{address:0,isCompressed:false,isSecondary:false,tilesAddress:0,palettesAddress:0,metatilesAddress:0,metatileAttributesAddress:0},
      secondaryTileset:{address:0,isCompressed:true,isSecondary:true,tilesAddress:0,palettesAddress:0,metatilesAddress:0,metatileAttributesAddress:0},
      primaryMetatileSample:null,secondaryMetatileSample:null
    },
    objects:[],
    camera:{x:0,y:0,z:0,yaw:0,pitch:0}
  };
}

function fakeRenderData(){
  const pixels=new Uint8ClampedArray(16*16*4);
  const graphic={metatileId:0,layerType:1,width:16,height:16,pixels,basePixels:pixels,foregroundPixels:pixels};
  return {blocks:Array.from({length:24*20},()=>({raw:0,metatileId:0,collision:0,elevation:0})),graphics:new Map([[0,graphic]])};
}

function makeDefinition(
  mapGroup: number,
  mapNumber: number,
  mapLayoutAddress: number,
  mapLayoutId: number,
): any {
  return {
    mapGroup,
    mapNumber,
    mapLayoutId,
    mapHeaderAddress: mapLayoutAddress + 0x100,
    mapLayoutAddress,
    mapDataAddress: mapLayoutAddress + 0x200,
    primaryTilesetAddress: mapLayoutAddress + 0x300,
    secondaryTilesetAddress: mapLayoutAddress + 0x400,
    width: 24,
    height: 20,
    worldX: 0,
    worldY: 0,
    connections: [],
  };
}

async function runCase(
  rom: Uint8Array,
  state: GameState,
  definitions: any[],
) {
  const adapter = {
    readState: () => state,
    getMapRenderData: () => fakeRenderData(),
  } as unknown as Gen3StateAdapter;

  const container = document.createElement('div');
  container.style.width = '900px';
  container.style.height = '600px';
  document.querySelector('#scene')!.appendChild(container);

  const renderer = new PlayerRenderer(
    container,
    adapter,
    rom,
  );

  const internal =
    renderer as unknown as {
      activeMapKey: string;
      mapCatalog: MapCatalog;
      mapWorld: {
        getPositionedMaps: () => any[];
      };
    };

  const originalBuild =
    internal.mapCatalog.buildGen3FromRom.bind(
      internal.mapCatalog,
    );

  internal.mapCatalog.buildGen3FromRom =
    (() => 1) as any;

  for (const definition of definitions) {
    internal.mapCatalog.register(
      definition,
    );
  }

  await new Promise(requestAnimationFrame);
  await new Promise(requestAnimationFrame);

  const result = {
    activeMapKey:
      internal.activeMapKey,
    positionedCount:
      internal.mapWorld.getPositionedMaps().length,
  };

  internal.mapCatalog.buildGen3FromRom =
    originalBuild;

  renderer.destroy();
  container.remove();

  return result;
}

async function main() {
  const rom = new Uint8Array(32);
  const cinnabar = makeDefinition(
    3,
    8,
    0x08200000,
    86,
  );
  const ruinValley = makeDefinition(
    3,
    61,
    0x08300000,
    121,
  );
  const viridian = makeDefinition(
    3,
    1,
    0x08400000,
    42,
  );

  const definitions = [
    cinnabar,
    ruinValley,
    viridian,
  ];

  const normalCinnabar =
    makeState(
      3,
      8,
      cinnabar,
    );

  const mismatchedCinnabar =
    makeState(
      3,
      61,
      cinnabar,
    );

  const normalRuin =
    makeState(
      3,
      61,
      ruinValley,
    );

  const normalViridian =
    makeState(
      3,
      1,
      viridian,
    );

  const a =
    await runCase(
      rom,
      normalCinnabar,
      definitions,
    );

  const b =
    await runCase(
      rom,
      mismatchedCinnabar,
      definitions,
    );

  const c =
    await runCase(
      rom,
      normalRuin,
      definitions,
    );

  const d =
    await runCase(
      rom,
      normalViridian,
      definitions,
    );

  assert(
    a.activeMapKey === '3:8',
    'normal Cinnabar changed: ' +
      JSON.stringify(a),
  );

  assert(
    b.activeMapKey === '3:8',
    'mismatched Cinnabar did not resolve: ' +
      JSON.stringify(b),
  );

  assert(
    b.positionedCount === 1,
    'mismatched Cinnabar rebuilt the wrong world: ' +
      JSON.stringify(b),
  );

  assert(
    c.activeMapKey === '3:61',
    'normal Ruin Valley changed: ' +
      JSON.stringify(c),
  );

  assert(
    d.activeMapKey === '3:1',
    'normal Viridian changed: ' +
      JSON.stringify(d),
  );

  const result = {
    pass: true,
    normalCinnabar: a,
    mismatchedCinnabar: b,
    normalRuin: c,
    normalViridian: d,
  };

  document.body.dataset.pass = 'true';
  document.querySelector('#out')!.textContent =
    JSON.stringify(result, null, 2);
}

main().catch(e=>{document.body.dataset.pass='false';document.querySelector('#out')!.textContent=JSON.stringify({pass:false,error:String(e)},null,2);throw e});
