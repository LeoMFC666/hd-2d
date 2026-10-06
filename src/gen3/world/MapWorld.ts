import type {
  MapConnection,
  MapDefinition,
} from './MapDefinition';

import {
  MapCatalog,
} from './MapCatalog';

export interface WorldMapPosition {
  x: number;
  y: number;
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

    this.clearPositions();

    this.positions.set(
      this.createKey(
        start.mapGroup,
        start.mapNumber,
      ),
      {
        x: 0,
        y: 0,
      },
    );

    this.positionedOrder.push(
      this.createKey(
        start.mapGroup,
        start.mapNumber,
      ),
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
          this.resolveConnection(
            connection,
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

  private resolveConnection(
    connection: MapConnection,
  ): MapDefinition | null {
    return this.catalog.get(
      connection.mapGroup,
      connection.mapNumber,
    );
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
