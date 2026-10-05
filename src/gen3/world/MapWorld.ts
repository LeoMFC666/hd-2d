import type {
  MapConnection,
  MapDefinition,
} from './MapDefinition';

import {
  MapCatalog,
} from './MapCatalog';

export class MapWorld {
  private readonly catalog: MapCatalog;

  constructor(
    catalog: MapCatalog,
  ) {
    this.catalog = catalog;
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

  getWorldPosition(
    mapGroup: number,
    mapNumber: number,
  ): { x: number; y: number } | null {
    const map =
      this.catalog.get(
        mapGroup,
        mapNumber,
      );

    if (!map) {
      return null;
    }

    return {
      x: map.worldX,
      y: map.worldY,
    };
  }

  resolveConnection(
    source: MapDefinition,
    connection: MapConnection,
  ): MapDefinition | null {
    return this.catalog.get(
      connection.mapGroup,
      connection.mapNumber,
    );
  }

  connectMap(
    source: MapDefinition,
    connection: MapConnection,
  ): MapDefinition | null {
    const target =
      this.resolveConnection(
        source,
        connection,
      );

    if (!target) {
      return null;
    }

    switch (
      connection.direction
    ) {
      case 'NORTH':
        target.worldX =
          source.worldX +
          connection.offset;

        target.worldY =
          source.worldY -
          target.height;

        break;

      case 'SOUTH':
        target.worldX =
          source.worldX +
          connection.offset;

        target.worldY =
          source.worldY +
          source.height;

        break;

      case 'WEST':
        target.worldX =
          source.worldX -
          target.width;

        target.worldY =
          source.worldY +
          connection.offset;

        break;

      case 'EAST':
        target.worldX =
          source.worldX +
          source.width;

        target.worldY =
          source.worldY +
          connection.offset;

        break;
    }

    return target;
  }

  buildFrom(
    startMapGroup: number,
    startMapNumber: number,
  ): void {
    const start =
      this.catalog.get(
        startMapGroup,
        startMapNumber,
      );

    if (!start) {
      return;
    }

    const queue: MapDefinition[] = [
      start,
    ];

    const visited =
      new Set<string>();

    while (
      queue.length > 0
    ) {
      const current =
        queue.shift();

      if (!current) {
        continue;
      }

      const currentKey =
        `${current.mapGroup}:${current.mapNumber}`;

      if (
        visited.has(currentKey)
      ) {
        continue;
      }

      visited.add(
        currentKey,
      );

      for (
        const connection of
          current.connections
      ) {
        const target =
          this.connectMap(
            current,
            connection,
          );

        if (!target) {
          continue;
        }

        const targetKey =
          `${target.mapGroup}:${target.mapNumber}`;

        if (
          !visited.has(targetKey)
        ) {
          queue.push(target);
        }
      }
    }
  }

  getBounds(): {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
    width: number;
    height: number;
  } | null {
    const maps =
      this.catalog.getAll();

    if (
      maps.length === 0
    ) {
      return null;
    }

    let minX =
      Number.POSITIVE_INFINITY;

    let minY =
      Number.POSITIVE_INFINITY;

    let maxX =
      Number.NEGATIVE_INFINITY;

    let maxY =
      Number.NEGATIVE_INFINITY;

    for (
      const map of maps
    ) {
      minX =
        Math.min(
          minX,
          map.worldX,
        );

      minY =
        Math.min(
          minY,
          map.worldY,
        );

      maxX =
        Math.max(
          maxX,
          map.worldX +
            map.width,
        );

      maxY =
        Math.max(
          maxY,
          map.worldY +
            map.height,
        );
    }

    return {
      minX,
      minY,
      maxX,
      maxY,
      width:
        maxX - minX,
      height:
        maxY - minY,
    };
  }
}