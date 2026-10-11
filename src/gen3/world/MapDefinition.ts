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

  // Tipo do mapa (offset 0x17 do cabecalho). Decide, entre outras coisas,
  // se o mapa recebe padding: interior e caverna nao recebem.
  mapType: number;

  // Bloco de borda do layout: os metatiles que o jogo repete em volta do
  // mapa. Em Ruby/Sapphire/Emerald e sempre 2x2; em FireRed/LeafGreen as
  // dimensoes ficam no proprio layout (offsets 0x18 e 0x19).
  borderAddress: number;
  borderWidth: number;
  borderHeight: number;

  worldX: number;
  worldY: number;

  connections: MapConnection[];
}