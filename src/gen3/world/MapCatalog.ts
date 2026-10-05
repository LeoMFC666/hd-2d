import type {
  MapConnection,
  MapConnectionDirection,
  MapDefinition,
} from './MapDefinition';

const GBA_ROM_BASE =
  0x08000000;

const GAME_CODE_OFFSET =
  0xAC;

const REVISION_OFFSET =
  0xBC;

const MAP_HEADER_LAYOUT_OFFSET =
  0x00;

const MAP_HEADER_CONNECTIONS_OFFSET =
  0x0C;

const MAP_HEADER_LAYOUT_ID_OFFSET =
  0x12;

const MAP_LAYOUT_WIDTH_OFFSET =
  0x00;

const MAP_LAYOUT_HEIGHT_OFFSET =
  0x04;

const MAP_LAYOUT_MAP_OFFSET =
  0x0C;

const MAP_LAYOUT_PRIMARY_TILESET_OFFSET =
  0x10;

const MAP_LAYOUT_SECONDARY_TILESET_OFFSET =
  0x14;

const MAP_CONNECTIONS_COUNT_OFFSET =
  0x00;

const MAP_CONNECTIONS_DATA_OFFSET =
  0x04;

const MAP_CONNECTION_SIZE =
  0x0C;

const EMERALD_GAME_CODE =
  'BPEE';

const EMERALD_REVISION =
  0;

const MAX_MAP_DIMENSION =
  512;

const MAX_CONNECTION_COUNT =
  64;

const EMERALD_MAP_GROUP_LENGTHS:
  readonly number[] = [
    57,
    5,
    5,
    6,
    7,
    8,
    9,
    7,
    7,
    14,
    8,
    17,
    10,
    23,
    13,
    15,
    15,
    2,
    2,
    2,
    3,
    1,
    1,
    1,
    108,
    61,
    89,
    2,
    1,
    13,
    1,
    1,
    1,
    1,
  ];

const EMERALD_MAP_GROUP_COUNT =
  EMERALD_MAP_GROUP_LENGTHS.length;

const MAP_DIRECTION_BY_VALUE:
  Record<
    number,
    MapConnectionDirection | null
  > = {
    1: 'SOUTH',
    2: 'NORTH',
    3: 'WEST',
    4: 'EAST',
    5: null,
    6: null,
  };

export interface EmeraldMapCatalogAnchor {
  mapGroup: number;
  mapNumber: number;
  mapLayoutId: number;
  mapLayoutAddress: number;
}

export class MapCatalog {
  private readonly maps =
    new Map<
      string,
      MapDefinition
    >();

  register(
    definition: MapDefinition,
  ): void {
    this.maps.set(
      this.createKey(
        definition.mapGroup,
        definition.mapNumber,
      ),
      definition,
    );
  }

  get(
    mapGroup: number,
    mapNumber: number,
  ): MapDefinition | null {
    return (
      this.maps.get(
        this.createKey(
          mapGroup,
          mapNumber,
        ),
      ) ?? null
    );
  }

  has(
    mapGroup: number,
    mapNumber: number,
  ): boolean {
    return this.maps.has(
      this.createKey(
        mapGroup,
        mapNumber,
      ),
    );
  }

  getAll(): MapDefinition[] {
    return Array.from(
      this.maps.values(),
    );
  }

  clear(): void {
    this.maps.clear();
  }

  buildEmeraldFromRom(
    romBytes: Uint8Array,
    anchor: EmeraldMapCatalogAnchor,
  ): number {
    this.clear();

    if (
      !this.isEmeraldRom(
        romBytes,
      )
    ) {
      return 0;
    }

    if (
      anchor.mapGroup < 0 ||
      anchor.mapGroup >=
        EMERALD_MAP_GROUP_COUNT
    ) {
      return 0;
    }

    const groupLength =
      EMERALD_MAP_GROUP_LENGTHS[
        anchor.mapGroup
      ];

    if (
      anchor.mapNumber < 0 ||
      anchor.mapNumber >=
        groupLength
    ) {
      return 0;
    }

    const staticHeader =
      this.findStaticMapHeader(
        romBytes,
        anchor,
      );

    if (
      staticHeader === 0
    ) {
      return 0;
    }

    const mapGroupsAddress =
      this.findMapGroupsAddress(
        romBytes,
        staticHeader,
        anchor.mapGroup,
        anchor.mapNumber,
      );

    if (
      mapGroupsAddress === 0
    ) {
      return 0;
    }

    let count =
      0;

    for (
      let mapGroup = 0;
      mapGroup <
        EMERALD_MAP_GROUP_COUNT;
      mapGroup++
    ) {
      const groupLength =
        EMERALD_MAP_GROUP_LENGTHS[
          mapGroup
        ];

      const groupAddress =
        this.readU32(
          romBytes,
          (
            mapGroupsAddress -
            GBA_ROM_BASE
          ) +
          mapGroup * 4,
        );

      if (
        !this.isValidRomPointer(
          romBytes,
          groupAddress,
          groupLength * 4,
        )
      ) {
        continue;
      }

      for (
        let mapNumber = 0;
        mapNumber < groupLength;
        mapNumber++
      ) {
        const mapHeaderAddress =
          this.readU32(
            romBytes,
            (
              groupAddress -
              GBA_ROM_BASE
            ) +
            mapNumber * 4,
          );

        if (
          !this.isValidRomPointer(
            romBytes,
            mapHeaderAddress,
            0x1C,
          )
        ) {
          continue;
        }

        const headerOffset =
          mapHeaderAddress -
          GBA_ROM_BASE;

        const mapLayoutAddress =
          this.readU32(
            romBytes,
            headerOffset +
            MAP_HEADER_LAYOUT_OFFSET,
          );

        if (
          !this.isValidRomPointer(
            romBytes,
            mapLayoutAddress,
            0x18,
          )
        ) {
          continue;
        }

        const layoutOffset =
          mapLayoutAddress -
          GBA_ROM_BASE;

        const width =
          this.readU32(
            romBytes,
            layoutOffset +
            MAP_LAYOUT_WIDTH_OFFSET,
          );

        const height =
          this.readU32(
            romBytes,
            layoutOffset +
            MAP_LAYOUT_HEIGHT_OFFSET,
          );

        if (
          !this.isValidMapDimension(
            width,
          ) ||
          !this.isValidMapDimension(
            height,
          )
        ) {
          continue;
        }

        const mapDataAddress =
          this.readU32(
            romBytes,
            layoutOffset +
            MAP_LAYOUT_MAP_OFFSET,
          );

        const primaryTilesetAddress =
          this.readU32(
            romBytes,
            layoutOffset +
            MAP_LAYOUT_PRIMARY_TILESET_OFFSET,
          );

        const secondaryTilesetAddress =
          this.readU32(
            romBytes,
            layoutOffset +
            MAP_LAYOUT_SECONDARY_TILESET_OFFSET,
          );

        if (
          !this.isValidRomPointer(
            romBytes,
            mapDataAddress,
            width *
            height *
            2,
          )
        ) {
          continue;
        }

        const mapLayoutId =
          this.readU16(
            romBytes,
            headerOffset +
            MAP_HEADER_LAYOUT_ID_OFFSET,
          );

        const connections =
          this.readConnections(
            romBytes,
            mapHeaderAddress,
          );

        this.register({
          mapGroup,
          mapNumber,
          mapLayoutId,

          mapHeaderAddress,
          mapLayoutAddress,
          mapDataAddress,

          primaryTilesetAddress,
          secondaryTilesetAddress,

          width,
          height,

          worldX: 0,
          worldY: 0,

          connections,
        });

        count++;
      }
    }

    return count;
  }

  private findStaticMapHeader(
    romBytes: Uint8Array,
    anchor: EmeraldMapCatalogAnchor,
  ): number {
    for (
      let offset = 0;
      offset <=
        romBytes.length - 0x1C;
      offset += 4
    ) {
      const layoutAddress =
        this.readU32(
          romBytes,
          offset +
          MAP_HEADER_LAYOUT_OFFSET,
        );

      if (
        layoutAddress !==
        anchor.mapLayoutAddress
      ) {
        continue;
      }

      const mapLayoutId =
        this.readU16(
          romBytes,
          offset +
          MAP_HEADER_LAYOUT_ID_OFFSET,
        );

      if (
        mapLayoutId !==
        anchor.mapLayoutId
      ) {
        continue;
      }

      return (
        GBA_ROM_BASE +
        offset
      );
    }

    return 0;
  }

  private findMapGroupsAddress(
    romBytes: Uint8Array,
    staticHeaderAddress: number,
    mapGroup: number,
    mapNumber: number,
  ): number {
    for (
      let offset = 0;
      offset <=
        romBytes.length - 4;
      offset += 4
    ) {
      const value =
        this.readU32(
          romBytes,
          offset,
        );

      if (
        value !==
        staticHeaderAddress
      ) {
        continue;
      }

      const groupAddress =
        GBA_ROM_BASE +
        offset -
        mapNumber * 4;

      if (
        !this.validateMapGroup(
          romBytes,
          groupAddress,
          mapGroup,
          mapNumber,
        )
      ) {
        continue;
      }

      for (
        let tableOffset = 0;
        tableOffset <=
          romBytes.length -
          EMERALD_MAP_GROUP_COUNT *
          4;
        tableOffset += 4
      ) {
        if (
          this.readU32(
            romBytes,
            tableOffset,
          ) !==
          groupAddress
        ) {
          continue;
        }

        const tableAddress =
          GBA_ROM_BASE +
          tableOffset -
          mapGroup * 4;

        if (
          this.validateMapGroupsTable(
            romBytes,
            tableAddress,
          )
        ) {
          return tableAddress;
        }
      }
    }

    return 0;
  }

  private validateMapGroup(
    romBytes: Uint8Array,
    groupAddress: number,
    mapGroup: number,
    mapNumber: number,
  ): boolean {
    const groupLength =
      EMERALD_MAP_GROUP_LENGTHS[
        mapGroup
      ];

    if (
      !this.isValidRomPointer(
        romBytes,
        groupAddress,
        groupLength * 4,
      )
    ) {
      return false;
    }

    const targetHeader =
      this.readU32(
        romBytes,
        (
          groupAddress -
          GBA_ROM_BASE
        ) +
        mapNumber * 4,
      );

    if (
      !this.isValidRomPointer(
        romBytes,
        targetHeader,
        0x1C,
      )
    ) {
      return false;
    }

    return true;
  }

  private validateMapGroupsTable(
    romBytes: Uint8Array,
    tableAddress: number,
  ): boolean {
    if (
      !this.isValidRomPointer(
        romBytes,
        tableAddress,
        EMERALD_MAP_GROUP_COUNT * 4,
      )
    ) {
      return false;
    }

    for (
      let mapGroup = 0;
      mapGroup <
        EMERALD_MAP_GROUP_COUNT;
      mapGroup++
    ) {
      const groupAddress =
        this.readU32(
          romBytes,
          (
            tableAddress -
            GBA_ROM_BASE
          ) +
          mapGroup * 4,
        );

      const groupLength =
        EMERALD_MAP_GROUP_LENGTHS[
          mapGroup
        ];

      if (
        !this.isValidRomPointer(
          romBytes,
          groupAddress,
          groupLength * 4,
        )
      ) {
        return false;
      }
    }

    return true;
  }

  private readConnections(
    romBytes: Uint8Array,
    mapHeaderAddress: number,
  ): MapConnection[] {
    const headerOffset =
      mapHeaderAddress -
      GBA_ROM_BASE;

    const connectionsAddress =
      this.readU32(
        romBytes,
        headerOffset +
        MAP_HEADER_CONNECTIONS_OFFSET,
      );

    if (
      connectionsAddress === 0
    ) {
      return [];
    }

    if (
      !this.isValidRomPointer(
        romBytes,
        connectionsAddress,
        8,
      )
    ) {
      return [];
    }

    const connectionsOffset =
      connectionsAddress -
      GBA_ROM_BASE;

    const count =
      this.readI32(
        romBytes,
        connectionsOffset +
        MAP_CONNECTIONS_COUNT_OFFSET,
      );

    if (
      count <= 0 ||
      count >
        MAX_CONNECTION_COUNT
    ) {
      return [];
    }

    const dataAddress =
      this.readU32(
        romBytes,
        connectionsOffset +
        MAP_CONNECTIONS_DATA_OFFSET,
      );

    if (
      !this.isValidRomPointer(
        romBytes,
        dataAddress,
        count *
        MAP_CONNECTION_SIZE,
      )
    ) {
      return [];
    }

    const dataOffset =
      dataAddress -
      GBA_ROM_BASE;

    const result:
      MapConnection[] = [];

    for (
      let index = 0;
      index < count;
      index++
    ) {
      const offset =
        dataOffset +
        index *
        MAP_CONNECTION_SIZE;

      const directionValue =
        this.readU8(
          romBytes,
          offset,
        );

      const direction =
        MAP_DIRECTION_BY_VALUE[
          directionValue
        ];

      if (!direction) {
        continue;
      }

      const connectionOffset =
        this.readI32(
          romBytes,
          offset + 4,
        );

      const mapGroup =
        this.readU8(
          romBytes,
          offset + 8,
        );

      const mapNumber =
        this.readU8(
          romBytes,
          offset + 9,
        );

      if (
        mapGroup >=
        EMERALD_MAP_GROUP_COUNT
      ) {
        continue;
      }

      if (
        mapNumber >=
        EMERALD_MAP_GROUP_LENGTHS[
          mapGroup
        ]
      ) {
        continue;
      }

      result.push({
        direction,
        mapGroup,
        mapNumber,
        offset:
          connectionOffset,
      });
    }

    return result;
  }

  private isEmeraldRom(
    romBytes: Uint8Array,
  ): boolean {
    return (
      this.readAscii(
        romBytes,
        GAME_CODE_OFFSET,
        4,
      ) ===
        EMERALD_GAME_CODE &&
      this.readU8(
        romBytes,
        REVISION_OFFSET,
      ) ===
        EMERALD_REVISION
    );
  }

  private isValidMapDimension(
    value: number,
  ): boolean {
    return (
      value >= 1 &&
      value <=
        MAX_MAP_DIMENSION
    );
  }

  private isValidRomPointer(
    romBytes: Uint8Array,
    address: number,
    size: number,
  ): boolean {
    if (
      address <
      GBA_ROM_BASE
    ) {
      return false;
    }

    const offset =
      address -
      GBA_ROM_BASE;

    return (
      offset >= 0 &&
      offset + size <=
        romBytes.length
    );
  }

  private readU8(
    romBytes: Uint8Array,
    offset: number,
  ): number {
    if (
      offset < 0 ||
      offset >=
        romBytes.length
    ) {
      return 0;
    }

    return romBytes[
      offset
    ];
  }

  private readU16(
    romBytes: Uint8Array,
    offset: number,
  ): number {
    return (
      this.readU8(
        romBytes,
        offset,
      ) |
      (
        this.readU8(
          romBytes,
          offset + 1,
        ) << 8
      )
    );
  }

  private readU32(
    romBytes: Uint8Array,
    offset: number,
  ): number {
    return (
      (
        this.readU8(
          romBytes,
          offset,
        )
      ) |
      (
        this.readU8(
          romBytes,
          offset + 1,
        ) << 8
      ) |
      (
        this.readU8(
          romBytes,
          offset + 2,
        ) << 16
      ) |
      (
        this.readU8(
          romBytes,
          offset + 3,
        ) *
        0x1000000
      )
    ) >>> 0;
  }

  private readI32(
    romBytes: Uint8Array,
    offset: number,
  ): number {
    return (
      this.readU32(
        romBytes,
        offset,
      ) | 0
    );
  }

  private readAscii(
    romBytes: Uint8Array,
    offset: number,
    length: number,
  ): string {
    let value =
      '';

    for (
      let index = 0;
      index < length;
      index++
    ) {
      value +=
        String.fromCharCode(
          this.readU8(
            romBytes,
            offset + index,
          ),
        );
    }

    return value;
  }

  private createKey(
    mapGroup: number,
    mapNumber: number,
  ): string {
    return `${mapGroup}:${mapNumber}`;
  }
}