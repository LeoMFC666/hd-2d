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
      const map of
        this.catalog.getAll()
    ) {
      if (
        this.positions.has(
          this.createKey(
            map.mapGroup,
            map.mapNumber,
          ),
        )
      ) {
        result.push(
          map,
        );
      }
    }

    return result;
  }

  clearPositions(): void {
    this.positions.clear();
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

    this.adjacency.clear();
    this.buildAdjacency();

    const startKey =
      this.createKey(
        start.mapGroup,
        start.mapNumber,
      );

    if (
      !this.positions.has(
        startKey,
      )
    ) {
      this.positions.set(
        startKey,
        {
          x: 0,
          y: 0,
        },
      );
    }

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

      const edges =
        this.adjacency.get(
          currentKey,
        ) ?? [];

      for (
        const edge of
          edges
      ) {
        const target =
          this.catalog.get(
            edge.targetMapGroup,
            edge.targetMapNumber,
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
              edge.connection,
            ),
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

        this.addEdge(
          targetKey,
          {
            targetMapGroup:
              source.mapGroup,

            targetMapNumber:
              source.mapNumber,

            connection: {
              direction:
                this.getOppositeDirection(
                  connection.direction,
                ),

              mapGroup:
                source.mapGroup,

              mapNumber:
                source.mapNumber,

              offset:
                this.getReverseOffset(
                  connection.direction,
                  connection.offset,
                ),
            },
          },
        );
      }
    }
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
      edges.push(
        edge,
      );

      return;
    }

    this.adjacency.set(
      sourceKey,
      [
        edge,
      ],
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

  private getReverseOffset(
    direction:
      MapConnectionDirection,
    offset: number,
  ): number {
    switch (
      direction
    ) {
      case 'NORTH':
      case 'SOUTH':
        return offset;

      case 'WEST':
      case 'EAST':
        return -offset;
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
            sourcePosition.x -
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
            sourcePosition.y -
            connection.offset,
        };

      case 'EAST':
        return {
          x:
            sourcePosition.x +
            source.width,

          y:
            sourcePosition.y -
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
