import type {
  MapConnection,
  MapConnectionDirection,
  MapDefinition,
} from './MapDefinition';

const GBA_ROM_BASE =
  0x08000000;

const GAME_CODE_OFFSET =
  0xac;

const REVISION_OFFSET =
  0xbc;

const MAP_HEADER_SIZE =
  0x1c;

const MAP_HEADER_LAYOUT_OFFSET =
  0x00;

const MAP_HEADER_CONNECTIONS_OFFSET =
  0x0c;

const MAP_HEADER_LAYOUT_ID_OFFSET =
  0x12;

const MAP_LAYOUT_SIZE =
  0x18;

const MAP_LAYOUT_WIDTH_OFFSET =
  0x00;

const MAP_LAYOUT_HEIGHT_OFFSET =
  0x04;

const MAP_LAYOUT_MAP_OFFSET =
  0x0c;

const MAP_LAYOUT_PRIMARY_TILESET_OFFSET =
  0x10;

const MAP_LAYOUT_SECONDARY_TILESET_OFFSET =
  0x14;

const MAP_CONNECTIONS_SIZE =
  0x08;

const MAP_CONNECTIONS_COUNT_OFFSET =
  0x00;

const MAP_CONNECTIONS_DATA_OFFSET =
  0x04;

const MAP_CONNECTION_SIZE =
  0x0c;

const MAX_MAP_DIMENSION =
  512;

const MAX_CONNECTION_COUNT =
  64;

const MAP_DIRECTION_BY_VALUE:
  Record<
    number,
    MapConnectionDirection | null
  > = {
    1:
      'SOUTH',

    2:
      'NORTH',

    3:
      'WEST',

    4:
      'EAST',

    5:
      null,

    6:
      null,
  };

const FRLG_GAME_CODES =
  new Set([
    'BPRE',
    'BPGE',
    'BPRP',
    'BPRJ',
    'BPGP',
    'BPGJ',
  ]);

const FRLG_MAP_GROUP_LENGTHS =
  [
    5,
    123,
    60,
    66,
    4,
    6,
    8,
    10,
    6,
    8,
    20,
    10,
    8,
    2,
    10,
    4,
    2,
    2,
    2,
    1,
    1,
    2,
    2,
    3,
    2,
    3,
    2,
    1,
    1,
    1,
    1,
    7,
    5,
    5,
    8,
    8,
    5,
    5,
    1,
    1,
    1,
    2,
    1,
  ] as const;

const MAP_GROUP_LENGTHS:
  Record<
    string,
    readonly number[]
  > = {
    BPEE: [
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
    ],

    BPRE: FRLG_MAP_GROUP_LENGTHS,
    BPRP: FRLG_MAP_GROUP_LENGTHS,
    BPRJ: FRLG_MAP_GROUP_LENGTHS,
    BPGE: FRLG_MAP_GROUP_LENGTHS,
    BPGP: FRLG_MAP_GROUP_LENGTHS,
    BPGJ: FRLG_MAP_GROUP_LENGTHS,

    AXVE: [
      54,
      5,
      5,
      6,
      7,
      7,
      8,
      7,
      7,
      13,
      8,
      17,
      10,
      24,
      13,
      13,
      14,
      2,
      2,
      2,
      3,
      1,
      1,
      1,
      86,
      44,
      12,
      2,
      1,
      13,
      1,
      1,
      3,
      1,
    ],

    AXPE: [
      54,
      5,
      5,
      6,
      7,
      7,
      8,
      7,
      7,
      13,
      8,
      17,
      10,
      24,
      13,
      13,
      14,
      2,
      2,
      2,
      3,
      1,
      1,
      1,
      86,
      44,
      12,
      2,
      1,
      13,
      1,
      1,
      3,
      1,
    ],
  };

export interface Gen3MapCatalogAnchor {
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

  buildGen3FromRom(
    romBytes: Uint8Array,
    anchor: Gen3MapCatalogAnchor,
  ): number {
    this.clear();

    const gameCode =
      this.readAscii(
        romBytes,
        GAME_CODE_OFFSET,
        4,
      );

    const revision =
      this.readU8(
        romBytes,
        REVISION_OFFSET,
      );

    const isFireRedLeafGreenGameCode =
      FRLG_GAME_CODES.has(
        gameCode,
      );

    const supportedRevision =
      isFireRedLeafGreenGameCode
        ? revision === 0 ||
          revision === 1
        : revision === 0;

    if (
      !supportedRevision ||
      !MAP_GROUP_LENGTHS[
        gameCode
      ]
    ) {
      return 0;
    }

    const groupLengths =
      MAP_GROUP_LENGTHS[
        gameCode
      ];

    if (
      anchor.mapGroup < 0 ||
      anchor.mapGroup >=
        groupLengths.length
    ) {
      return 0;
    }

    const groupLength =
      groupLengths[
        anchor.mapGroup
      ];

    if (
      anchor.mapNumber < 0 ||
      anchor.mapNumber >=
        groupLength
    ) {
      return 0;
    }

    if (
      !this.isValidRomPointer(
        romBytes,
        anchor.mapLayoutAddress,
        MAP_LAYOUT_SIZE,
      )
    ) {
      return 0;
    }

    let mapGroupsAddress =
      0;

    if (
      isFireRedLeafGreenGameCode
    ) {
      mapGroupsAddress =
        this.findFireRedMapGroupsAddress(
          romBytes,
          anchor,
          groupLengths,
        );
    } else {
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

      mapGroupsAddress =
        this.findMapGroupsAddress(
          romBytes,
          staticHeader,
          anchor.mapGroup,
          anchor.mapNumber,
          groupLengths,
        );
    }

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
        groupLengths.length;
      mapGroup++
    ) {
      const currentGroupLength =
        groupLengths[
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
          currentGroupLength * 4,
        )
      ) {
        continue;
      }

      for (
        let mapNumber = 0;
        mapNumber <
          currentGroupLength;
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
            MAP_HEADER_SIZE,
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
            MAP_LAYOUT_SIZE,
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

        if (
          !this.isValidRomPointer(
            romBytes,
            primaryTilesetAddress,
            0x04,
          ) ||
          !this.isValidRomPointer(
            romBytes,
            secondaryTilesetAddress,
            0x04,
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
            groupLengths,
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

  private findFireRedMapGroupsAddress(
    romBytes: Uint8Array,
    anchor: Gen3MapCatalogAnchor,
    groupLengths:
      readonly number[],
  ): number {
    const tableSize =
      groupLengths.length * 4;

    for (
      let offset = 0;
      offset <=
        romBytes.length -
          tableSize;
      offset += 4
    ) {
      const tableAddress =
        GBA_ROM_BASE +
        offset;

      const groupAddress =
        this.readU32(
          romBytes,
          offset +
            anchor.mapGroup * 4,
        );

      if (
        !this.validateFireRedMapGroup(
          romBytes,
          groupAddress,
          anchor.mapGroup,
          anchor.mapNumber,
          groupLengths,
        )
      ) {
        continue;
      }

      if (
        this.validateFireRedMapGroupsTable(
          romBytes,
          tableAddress,
          groupLengths,
        )
      ) {
        return tableAddress;
      }
    }

    return 0;
  }

  private validateFireRedMapGroup(
    romBytes: Uint8Array,
    groupAddress: number,
    mapGroup: number,
    mapNumber: number,
    groupLengths:
      readonly number[],
  ): boolean {
    const groupLength =
      groupLengths[
        mapGroup
      ];

    if (
      groupLength ===
      undefined
    ) {
      return false;
    }

    if (
      !this.isValidRomPointer(
        romBytes,
        groupAddress,
        groupLength * 4,
      )
    ) {
      return false;
    }

    for (
      let currentMapNumber = 0;
      currentMapNumber <
        groupLength;
      currentMapNumber++
    ) {
      const mapHeaderAddress =
        this.readU32(
          romBytes,
          (
            groupAddress -
            GBA_ROM_BASE
          ) +
            currentMapNumber * 4,
        );

      if (
        !this.isValidFireRedMapHeader(
          romBytes,
          mapHeaderAddress,
        )
      ) {
        return false;
      }
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

    return this.isValidFireRedMapHeader(
      romBytes,
      targetHeader,
    );
  }

  private isValidFireRedMapHeader(
    romBytes: Uint8Array,
    mapHeaderAddress: number,
  ): boolean {
    if (
      !this.isValidRomPointer(
        romBytes,
        mapHeaderAddress,
        MAP_HEADER_SIZE,
      )
    ) {
      return false;
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

    const mapLayoutId =
      this.readU16(
        romBytes,
        headerOffset +
          MAP_HEADER_LAYOUT_ID_OFFSET,
      );

    if (
      mapLayoutId > 0xff ||
      !this.isValidRomPointer(
        romBytes,
        mapLayoutAddress,
        MAP_LAYOUT_SIZE,
      )
    ) {
      return false;
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
      return false;
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

    return (
      this.isValidRomPointer(
        romBytes,
        mapDataAddress,
        width *
          height *
          2,
      ) &&
      this.isValidRomPointer(
        romBytes,
        primaryTilesetAddress,
        0x04,
      ) &&
      this.isValidRomPointer(
        romBytes,
        secondaryTilesetAddress,
        0x04,
      )
    );
  }

  private findStaticMapHeader(
    romBytes: Uint8Array,
    anchor: Gen3MapCatalogAnchor,
  ): number {
    for (
      let offset = 0;
      offset <=
        romBytes.length -
          MAP_HEADER_SIZE;
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
    groupLengths:
      readonly number[],
  ): number {
    for (
      let offset = 0;
      offset + 4 <=
        romBytes.length;
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
          groupLengths,
        )
      ) {
        continue;
      }

      for (
        let tableOffset = 0;
        tableOffset <=
          romBytes.length -
            groupLengths.length * 4;
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
            groupLengths,
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
    groupLengths:
      readonly number[],
  ): boolean {
    const groupLength =
      groupLengths[
        mapGroup
      ];

    if (
      groupLength ===
      undefined
    ) {
      return false;
    }

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

    return this.isValidRomPointer(
      romBytes,
      targetHeader,
      MAP_HEADER_SIZE,
    );
  }

  private validateMapGroupsTable(
    romBytes: Uint8Array,
    tableAddress: number,
    groupLengths:
      readonly number[],
  ): boolean {
    if (
      !this.isValidRomPointer(
        romBytes,
        tableAddress,
        groupLengths.length * 4,
      )
    ) {
      return false;
    }

    for (
      let mapGroup = 0;
      mapGroup <
        groupLengths.length;
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
        groupLengths[
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

  private validateFireRedMapGroupsTable(
    romBytes: Uint8Array,
    tableAddress: number,
    groupLengths:
      readonly number[],
  ): boolean {
    if (
      !this.isValidRomPointer(
        romBytes,
        tableAddress,
        groupLengths.length * 4,
      )
    ) {
      return false;
    }

    for (
      let mapGroup = 0;
      mapGroup <
        groupLengths.length;
      mapGroup++
    ) {
      const groupLength =
        groupLengths[
          mapGroup
        ];

      const groupAddress =
        this.readU32(
          romBytes,
          (
            tableAddress -
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
        return false;
      }

      for (
        let mapNumber = 0;
        mapNumber <
          groupLength;
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
          !this.isValidFireRedMapHeader(
            romBytes,
            mapHeaderAddress,
          )
        ) {
          return false;
        }
      }
    }

    return true;
  }

  private readConnections(
    romBytes: Uint8Array,
    mapHeaderAddress: number,
    groupLengths:
      readonly number[],
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
        MAP_CONNECTIONS_SIZE,
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
      const connectionOffset =
        dataOffset +
        index *
          MAP_CONNECTION_SIZE;

      const directionValue =
        this.readU8(
          romBytes,
          connectionOffset,
        );

      const direction =
        MAP_DIRECTION_BY_VALUE[
          directionValue
        ];

      if (!direction) {
        continue;
      }

      const connectionOffsetValue =
        this.readI32(
          romBytes,
          connectionOffset + 4,
        );

      const mapGroup =
        this.readU8(
          romBytes,
          connectionOffset + 8,
        );

      const mapNumber =
        this.readU8(
          romBytes,
          connectionOffset + 9,
        );

      if (
        mapGroup <
          0 ||
        mapGroup >=
          groupLengths.length
      ) {
        continue;
      }

      if (
        mapNumber <
          0 ||
        mapNumber >=
          groupLengths[
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
          connectionOffsetValue,
      });
    }

    return result;
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
        ) <<
        8
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
        ) <<
        8
      ) |
      (
        this.readU8(
          romBytes,
          offset + 2,
        ) <<
        16
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