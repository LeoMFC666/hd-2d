import type {
  MapConnection,
  MapConnectionDirection,
  MapDefinition,
} from './MapDefinition';

import {
  MapCatalog,
} from './MapCatalog';

export interface WorldMapPosition {
  x: number;
  y: number;
}

interface WorldMapEdge {
  targetMapGroup: number;
  targetMapNumber: number;
  connection: MapConnection;
}

export class MapWorld {
  private readonly catalog:
    MapCatalog;

  private readonly positions =
    new Map<
      string,
      WorldMapPosition
    >();

  private readonly positionedOrder:
    string[] = [];

  private readonly adjacency =
    new Map<
      string,
      WorldMapEdge[]
    >();

  constructor(
    catalog: MapCatalog,
  ) {
    this.catalog =
      catalog;
  }

  getCatalog(): MapCatalog {
    return this.catalog;
  }

  getMap(
    mapGroup: number,
    mapNumber: number,
  ): MapDefinition | null {
    return this.catalog.get(
      mapGroup,
      mapNumber,
    );
  }

  hasPosition(
    mapGroup: number,
    mapNumber: number,
  ): boolean {
    return this.positions.has(
      this.createKey(
        mapGroup,
        mapNumber,
      ),
    );
  }

  getWorldPosition(
    mapGroup: number,
    mapNumber: number,
  ): WorldMapPosition | null {
    return (
      this.positions.get(
        this.createKey(
          mapGroup,
          mapNumber,
        ),
      ) ?? null
    );
  }

  getPositionedMaps():
    MapDefinition[] {
    const result:
      MapDefinition[] = [];

    for (
      const key of
        this.positionedOrder
    ) {
      const separator =
        key.indexOf(':');

      if (
        separator <= 0
      ) {
        continue;
      }

      const mapGroup =
        Number(
          key.slice(
            0,
            separator,
          ),
        );

      const mapNumber =
        Number(
          key.slice(
            separator + 1,
          ),
        );

      const map =
        this.catalog.get(
          mapGroup,
          mapNumber,
        );

      if (map) {
        result.push(
          map,
        );
      }
    }

    return result;
  }

  clearPositions(): void {
    this.positions.clear();
    this.positionedOrder.length = 0;
  }

  buildLargestConnectedWorld(): number {
    this.buildAdjacency();

    let bestKey:
      string | null = null;

    let bestSize =
      0;

    const visitedGlobal =
      new Set<string>();

    for (
      const map of
        this.catalog.getAll()
    ) {
      const startKey =
        this.createKey(
          map.mapGroup,
          map.mapNumber,
        );

      if (
        visitedGlobal.has(
          startKey,
        )
      ) {
        continue;
      }

      const component =
        this.collectComponent(
          startKey,
        );

      for (
        const key of
          component
      ) {
        visitedGlobal.add(
          key,
        );
      }

      if (
        component.length >
        bestSize
      ) {
        bestSize =
          component.length;

        bestKey =
          startKey;
      }
    }

    if (!bestKey) {
      this.clearPositions();
      return 0;
    }

    const separator =
      bestKey.indexOf(':');

    const rootGroup =
      Number(
        bestKey.slice(
          0,
          separator,
        ),
      );

    const rootNumber =
      Number(
        bestKey.slice(
          separator + 1,
        ),
      );

    return this.buildFrom(
      rootGroup,
      rootNumber,
    );
  }

  buildFrom(
    startMapGroup: number,
    startMapNumber: number,
  ): number {
    const start =
      this.catalog.get(
        startMapGroup,
        startMapNumber,
      );

    if (!start) {
      return 0;
    }

    if (
      this.adjacency.size ===
      0
    ) {
      this.buildAdjacency();
    }

    this.clearPositions();

    const startKey =
      this.createKey(
        start.mapGroup,
        start.mapNumber,
      );

    this.positions.set(
      startKey,
      {
        x: 0,
        y: 0,
      },
    );

    this.positionedOrder.push(
      startKey,
    );

    const queue:
      MapDefinition[] = [
        start,
      ];

    const visited =
      new Set<string>();

    let count =
      0;

    while (
      queue.length > 0
    ) {
      const current =
        queue.shift();

      if (!current) {
        continue;
      }

      const currentKey =
        this.createKey(
          current.mapGroup,
          current.mapNumber,
        );

      if (
        visited.has(
          currentKey,
        )
      ) {
        continue;
      }

      visited.add(
        currentKey,
      );

      const sourcePosition =
        this.positions.get(
          currentKey,
        );

      if (!sourcePosition) {
        continue;
      }

      count++;

      for (
        const connection of
          current.connections
      ) {
        const target =
          this.catalog.get(
            connection.mapGroup,
            connection.mapNumber,
          );

        if (!target) {
          continue;
        }

        const targetKey =
          this.createKey(
            target.mapGroup,
            target.mapNumber,
          );

        if (
          !this.positions.has(
            targetKey,
          )
        ) {
          this.positions.set(
            targetKey,
            this.calculatePosition(
              current,
              sourcePosition,
              target,
              connection,
            ),
          );

          this.positionedOrder.push(
            targetKey,
          );
        }

        if (
          !visited.has(
            targetKey,
          )
        ) {
          queue.push(
            target,
          );
        }
      }
    }

    return count;
  }

  private buildAdjacency(): void {
    this.adjacency.clear();

    const declared =
      new Map<
        string,
        MapConnection[]
      >();

    for (
      const source of
        this.catalog.getAll()
    ) {
      declared.set(
        this.createKey(
          source.mapGroup,
          source.mapNumber,
        ),
        source.connections,
      );
    }

    for (
      const source of
        this.catalog.getAll()
    ) {
      const sourceKey =
        this.createKey(
          source.mapGroup,
          source.mapNumber,
        );

      for (
        const connection of
          source.connections
      ) {
        const target =
          this.catalog.get(
            connection.mapGroup,
            connection.mapNumber,
          );

        if (!target) {
          continue;
        }

        this.addEdge(
          sourceKey,
          {
            targetMapGroup:
              target.mapGroup,

            targetMapNumber:
              target.mapNumber,

            connection,
          },
        );

        const targetKey =
          this.createKey(
            target.mapGroup,
            target.mapNumber,
          );

        const reciprocalExists =
          this.hasReciprocalConnection(
            declared.get(
              targetKey,
            ) ?? [],
            source,
            connection,
          );

        if (
          reciprocalExists
        ) {
          continue;
        }

        this.addEdge(
          targetKey,
          {
            targetMapGroup:
              source.mapGroup,

            targetMapNumber:
              source.mapNumber,

            connection:
              this.createReverseConnection(
                source,
                connection,
              ),
          },
        );
      }
    }
  }

  private collectComponent(
    startKey: string,
  ): string[] {
    const result:
      string[] = [];

    const queue:
      string[] = [
        startKey,
      ];

    const visited =
      new Set<string>();

    while (
      queue.length > 0
    ) {
      const currentKey =
        queue.shift();

      if (!currentKey) {
        continue;
      }

      if (
        visited.has(
          currentKey,
        )
      ) {
        continue;
      }

      visited.add(
        currentKey,
      );

      const map =
        this.getMapByKey(
          currentKey,
        );

      if (!map) {
        continue;
      }

      result.push(
        currentKey,
      );

      for (
        const edge of
          this.adjacency.get(
            currentKey,
          ) ?? []
      ) {
        const targetKey =
          this.createKey(
            edge.targetMapGroup,
            edge.targetMapNumber,
          );

        if (
          !visited.has(
            targetKey,
          )
        ) {
          queue.push(
            targetKey,
          );
        }
      }
    }

    return result;
  }

  private hasReciprocalConnection(
    connections:
      MapConnection[],
    source:
      MapDefinition,
    connection:
      MapConnection,
  ): boolean {
    const opposite =
      this.getOppositeDirection(
        connection.direction,
      );

    const reverseOffset =
      -connection.offset;

    return connections.some(
      (
        candidate,
      ) =>
        candidate.direction ===
          opposite &&
        candidate.mapGroup ===
          source.mapGroup &&
        candidate.mapNumber ===
          source.mapNumber &&
        candidate.offset ===
          reverseOffset,
    );
  }

  private createReverseConnection(
    source:
      MapDefinition,
    connection:
      MapConnection,
  ): MapConnection {
    return {
      direction:
        this.getOppositeDirection(
          connection.direction,
        ),

      mapGroup:
        source.mapGroup,

      mapNumber:
        source.mapNumber,

      offset:
        -connection.offset,
    };
  }

  private addEdge(
    sourceKey: string,
    edge: WorldMapEdge,
  ): void {
    const edges =
      this.adjacency.get(
        sourceKey,
      );

    if (edges) {
      const duplicate =
        edges.some(
          (
            existing,
          ) =>
            existing.targetMapGroup ===
              edge.targetMapGroup &&
            existing.targetMapNumber ===
              edge.targetMapNumber &&
            existing.connection.direction ===
              edge.connection.direction &&
            existing.connection.offset ===
              edge.connection.offset,
        );

      if (
        !duplicate
      ) {
        edges.push(
          edge,
        );
      }

      return;
    }

    this.adjacency.set(
      sourceKey,
      [
        edge,
      ],
    );
  }

  private getMapByKey(
    key: string,
  ): MapDefinition | null {
    const separator =
      key.indexOf(':');

    if (
      separator <= 0
    ) {
      return null;
    }

    return this.catalog.get(
      Number(
        key.slice(
          0,
          separator,
        ),
      ),
      Number(
        key.slice(
          separator + 1,
        ),
      ),
    );
  }

  private getOppositeDirection(
    direction:
      MapConnectionDirection,
  ): MapConnectionDirection {
    switch (
      direction
    ) {
      case 'NORTH':
        return 'SOUTH';

      case 'SOUTH':
        return 'NORTH';

      case 'WEST':
        return 'EAST';

      case 'EAST':
        return 'WEST';
    }
  }

  private calculatePosition(
    source: MapDefinition,
    sourcePosition:
      WorldMapPosition,
    target: MapDefinition,
    connection: MapConnection,
  ): WorldMapPosition {
    switch (
      connection.direction
    ) {
      case 'NORTH':
        return {
          x:
            sourcePosition.x +
            connection.offset,

          y:
            sourcePosition.y -
            target.height,
        };

      case 'SOUTH':
        return {
          x:
            sourcePosition.x +
            connection.offset,

          y:
            sourcePosition.y +
            source.height,
        };

      case 'WEST':
        return {
          x:
            sourcePosition.x -
            target.width,

          y:
            sourcePosition.y +
            connection.offset,
        };

      case 'EAST':
        return {
          x:
            sourcePosition.x +
            source.width,

          y:
            sourcePosition.y +
            connection.offset,
        };
    }
  }

  private createKey(
    mapGroup: number,
    mapNumber: number,
  ): string {
    return `${mapGroup}:${mapNumber}`;
  }
}
