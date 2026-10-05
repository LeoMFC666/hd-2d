export type MapConnectionDirection =
  | 'NORTH'
  | 'SOUTH'
  | 'WEST'
  | 'EAST';

export interface MapConnection {
  direction: MapConnectionDirection;
  mapGroup: number;
  mapNumber: number;
  offset: number;
}

export interface MapDefinition {
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

  worldX: number;
  worldY: number;

  connections: MapConnection[];
}