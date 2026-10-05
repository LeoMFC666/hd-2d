export type Direction =
  | 'UP'
  | 'DOWN'
  | 'LEFT'
  | 'RIGHT';

export type MovementState =
  | 'idle'
  | 'turning'
  | 'walking';

export interface PlayerState {
  x: number;
  y: number;
  z: number;
  direction: Direction;
  movementState: MovementState;
}

export interface TilesetState {
  address: number;
  isCompressed: boolean;
  isSecondary: boolean;
  tilesAddress: number;
  palettesAddress: number;
  metatilesAddress: number;
  metatileAttributesAddress: number;
}

export interface MapBlockState {
  raw: number;
  metatileId: number;
  collision: number;
  elevation: number;
}

export interface MetatileTileState {
  raw: number;
  tileId: number;
  hFlip: boolean;
  vFlip: boolean;
  palette: number;
}

export interface TileGraphicsState {
  tileId: number;
  width: number;
  height: number;
  pixels: Uint8Array;
}

export interface MetatileState {
  id: number;
  tiles: MetatileTileState[];
  rawAttribute: number;
  behavior: number;
  layerType: number;
}

export interface MapState {
  mapGroup: number;
  mapNumber: number;
  mapLayoutId: number;

  mapHeaderAddress: number;
  mapLayoutAddress: number;
  mapDataAddress: number;

  primaryTilesetAddress: number;
  secondaryTilesetAddress: number;

  width: number;
  height: number;
  cellCount: number;

  blockSample: MapBlockState[];

  primaryTileset: TilesetState;
  secondaryTileset: TilesetState;

  primaryMetatileSample: MetatileState | null;
  secondaryMetatileSample: MetatileState | null;
}

export interface CameraState {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
}

export interface WorldObject {
  id: number;
  type: string;
  x: number;
  y: number;
  z: number;
  visible: boolean;
  rotation?: number;
}

export interface GameInfo {
  game: string;
  version: string;
  region: string;
  revision: string;
}

export interface GameState {
  game: GameInfo;
  player: PlayerState;
  map: MapState;
  objects: WorldObject[];
  camera: CameraState;
}

const EMPTY_TILESET_STATE: TilesetState = {
  address: 0,
  isCompressed: false,
  isSecondary: false,
  tilesAddress: 0,
  palettesAddress: 0,
  metatilesAddress: 0,
  metatileAttributesAddress: 0,
};

export const EMPTY_GAME_STATE: GameState = {
  game: {
    game: 'GEN 3',
    version: 'unknown',
    region: 'unknown',
    revision: 'unknown',
  },

  player: {
    x: 0,
    y: 0,
    z: 0,
    direction: 'DOWN',
    movementState: 'idle',
  },

  map: {
    mapGroup: 0,
    mapNumber: 0,
    mapLayoutId: 0,

    mapHeaderAddress: 0,
    mapLayoutAddress: 0,
    mapDataAddress: 0,

    primaryTilesetAddress: 0,
    secondaryTilesetAddress: 0,

    width: 0,
    height: 0,
    cellCount: 0,

    blockSample: [],

    primaryTileset: {
      ...EMPTY_TILESET_STATE,
    },

    secondaryTileset: {
      ...EMPTY_TILESET_STATE,
    },

    primaryMetatileSample: null,
    secondaryMetatileSample: null,
  },

  objects: [],

  camera: {
    x: 0,
    y: 0,
    z: 0,
    yaw: 0,
    pitch: 0,
  },
};