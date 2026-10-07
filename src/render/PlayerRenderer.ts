import * as THREE from 'three';

import type {
  Gen3StateAdapter,
  Gen3MetatileGraphics,
} from '../gen3/Gen3StateAdapter';

import type {
  GameState,
} from '../gen3/GameState';

import type {
  MapDefinition,
} from '../gen3/world/MapDefinition';

import {
  MapCatalog,
} from '../gen3/world/MapCatalog';

import {
  MapWorld,
} from '../gen3/world/MapWorld';

import {
  TilesetAnimationController,
} from '../gen3/TilesetAnimationController';

const GBA_METATILE_PIXELS =
  16;

const FRLG_BETA_CINNABAR_MAP_DATA =
  0x08000000 +
  0x00338378;

interface MapVisual {
  baseMesh: THREE.Mesh;
  overlayMesh: THREE.Mesh;

  baseTexture:
    THREE.DataTexture;

  overlayTexture:
    THREE.DataTexture;

  geometry:
    THREE.PlaneGeometry;

  mapDataAddress:
    number;
}

export class PlayerRenderer {
  private readonly container:
    HTMLElement;

  private readonly stateAdapter:
    Gen3StateAdapter;

  private readonly romBytes:
    Uint8Array;

  private readonly mapCatalog:
    MapCatalog;

  private readonly mapWorld:
    MapWorld;

  private readonly tilesetAnimationController:
    TilesetAnimationController;

  private readonly scene:
    THREE.Scene;

  private readonly camera:
    THREE.PerspectiveCamera;

  private readonly renderer:
    THREE.WebGLRenderer;

  private readonly root:
    THREE.Group;

  private readonly player:
    THREE.Mesh;

  private readonly mapVisuals =
    new Map<
      string,
      MapVisual
    >();

  private readonly buildQueue:
    MapDefinition[] = [];

  private readonly queuedMaps =
    new Set<string>();

  private currentState:
    GameState | null =
    null;

  private worldCatalogBuilt =
    false;

  private worldCatalogBuildAttempted =
    false;

  private cinnabarDefinitionChecked =
    false;

  private activeMapKey =
    '';

  private frameId =
    0;

  private lastPlayerX =
    -1;

  private lastPlayerY =
    -1;

  private lastDirection =
    '';

  private lastMovementState =
    '';

  private lastMapGroup =
    -1;

  private lastMapNumber =
    -1;

  private lastMapLayoutId =
    -1;

  private resizeHandler:
    () => void;

  constructor(
    container: HTMLElement,
    stateAdapter: Gen3StateAdapter,
    romBytes: Uint8Array,
  ) {
    this.container =
      container;

    this.stateAdapter =
      stateAdapter;

    this.romBytes =
      romBytes;

    this.mapCatalog =
      new MapCatalog();

    this.mapWorld =
      new MapWorld(
        this.mapCatalog,
      );

    this.tilesetAnimationController =
      new TilesetAnimationController(
        this.romBytes,
        this.stateAdapter
          .getMemoryReader(),
      );

    this.scene =
      new THREE.Scene();

    this.scene.background =
      new THREE.Color(
        '#0b1220',
      );

    this.camera =
      new THREE.PerspectiveCamera(
        48,
        1,
        0.1,
        3000,
      );

    this.camera.position.set(
      0,
      12,
      12,
    );

    this.root =
      new THREE.Group();

    this.scene.add(
      this.root,
    );

    const playerMaterial =
      new THREE.MeshStandardMaterial({
        color:
          0x5ec6ff,

        emissive:
          0x1f4d63,

        roughness:
          0.45,

        metalness:
          0.2,
      });

    this.player =
      new THREE.Mesh(
        new THREE.BoxGeometry(
          0.55,
          1.0,
          0.55,
        ),
        playerMaterial,
      );

    this.player.position.y =
      0.5;

    this.root.add(
      this.player,
    );

    const ambient =
      new THREE.AmbientLight(
        0xffffff,
        1.5,
      );

    this.scene.add(
      ambient,
    );

    const sun =
      new THREE.DirectionalLight(
        0xffffff,
        1.2,
      );

    sun.position.set(
      8,
      16,
      8,
    );

    this.scene.add(
      sun,
    );

    this.renderer =
      new THREE.WebGLRenderer({
        antialias: false,
        alpha: true,
        powerPreference:
          'high-performance',
      });

    this.renderer.setPixelRatio(
      Math.min(
        window.devicePixelRatio,
        1.5,
      ),
    );

    this.renderer.setClearColor(
      0x000000,
      0,
    );

    this.container.appendChild(
      this.renderer.domElement,
    );

    this.resize();

    this.resizeHandler =
      () => {
        this.resize();
      };

    window.addEventListener(
      'resize',
      this.resizeHandler,
    );

    (
      globalThis as any
    ).__pkmn25dDebug = {
      getState: () =>
        this.currentState,

      getActiveMapKey: () =>
        this.activeMapKey,

      getMapVisuals: () =>
        Array.from(
          this.mapVisuals.entries(),
        ).map(
          ([key, visual]) => ({
            key,
            mapDataAddress:
              visual.mapDataAddress,
            visible:
              visual.baseMesh.visible,
          }),
        ),

      getPositionedMaps: () =>
        this.mapWorld
          .getPositionedMaps()
          .map(
            map => ({
              key:
                this.createMapKey(
                  map.mapGroup,
                  map.mapNumber,
                ),
              width:
                map.width,
              height:
                map.height,
              mapDataAddress:
                map.mapDataAddress,
              world:
                this.mapWorld
                  .getWorldPosition(
                    map.mapGroup,
                    map.mapNumber,
                  ),
            }),
          ),

      getRenderInfo: () => ({
        calls:
          this.renderer.info.render.calls,

        triangles:
          this.renderer.info.render.triangles,

        textures:
          this.renderer.info.memory.textures,

        geometries:
          this.renderer.info.memory.geometries,
      }),
    };
    this.animate();
  }

  private resize(): void {
    const width =
      this.container
        .clientWidth ||
      320;

    const height =
      this.container
        .clientHeight ||
      220;

    this.camera.aspect =
      width /
      height;

    this.camera.updateProjectionMatrix();

    this.renderer.setSize(
      width,
      height,
      false,
    );
  }

  private ensureWorldCatalog(
    state: GameState,
  ): void {
    if (
      this.worldCatalogBuilt ||
      this.worldCatalogBuildAttempted
    ) {
      return;
    }

    if (
      state.map
        .mapLayoutAddress === 0
    ) {
      return;
    }

    this.worldCatalogBuildAttempted =
      true;

    const count =
      this.mapCatalog
        .buildGen3FromRom(
          this.romBytes,
          {
            mapGroup:
              state.map.mapGroup,

            mapNumber:
              state.map.mapNumber,

            mapLayoutId:
              state.map.mapLayoutId,

            mapLayoutAddress:
              state.map
                .mapLayoutAddress,
          },
        );

    if (
      count <= 0
    ) {
      this.worldCatalogBuildAttempted =
        false;

      console.warn(
        'Unable to build Gen 3 map catalog.',
      );

      return;
    }

    this.worldCatalogBuilt =
      true;

    console.log(
      'Gen 3 Map Catalog:',
      count,
      'maps',
    );
  }

  private isFireRedFamily(
    state: GameState,
  ): boolean {
    return (
      state.game.region === 'firered' ||
      state.game.region === 'leafgreen'
    );
  }

  private ensureFireRedCinnabarDefinition(
    state: GameState,
  ): void {
    if (
      this.cinnabarDefinitionChecked ||
      !this.isFireRedFamily(state) ||
      state.map.mapGroup !== 3 ||
      state.map.mapNumber !== 8
    ) {
      return;
    }

    const existing =
      this.mapCatalog.get(
        3,
        8,
      );

    if (!existing) {
      return;
    }

    this.cinnabarDefinitionChecked =
      true;

    const headerSize =
      0x1c;

    const layoutSize =
      0x18;

    const romBase =
      0x08000000;

    const isValidPointer = (
      address: number,
      size: number,
    ): boolean => {
      if (
        address <
        romBase
      ) {
        return false;
      }

      const offset =
        address -
        romBase;

      return (
        offset >= 0 &&
        offset + size <=
          this.romBytes.length
      );
    };

    const readU8 = (
      offset: number,
    ): number => {
      if (
        offset < 0 ||
        offset >=
          this.romBytes.length
      ) {
        return 0;
      }

      return this.romBytes[offset];
    };

    const readU16 = (
      offset: number,
    ): number => {
      return (
        readU8(offset) |
        (
          readU8(offset + 1) <<
          8
        )
      );
    };

    const readU32 = (
      offset: number,
    ): number => {
      return (
        (
          readU8(offset) |
          (
            readU8(offset + 1) <<
            8
          ) |
          (
            readU8(offset + 2) <<
            16
          ) |
          (
            readU8(offset + 3) *
            0x1000000
          )
        ) >>> 0
      );
    };

    const readI32 = (
      offset: number,
    ): number => {
      return (
        readU32(offset) |
        0
      );
    };

    const hasCinnabarConnections = (
      headerAddress: number,
    ): boolean => {
      const headerOffset =
        headerAddress -
        romBase;

      const connectionsAddress =
        readU32(
          headerOffset +
          0x0c,
        );

      if (
        connectionsAddress === 0
      ) {
        return false;
      }

      if (
        !isValidPointer(
          connectionsAddress,
          8,
        )
      ) {
        return false;
      }

      const connectionsOffset =
        connectionsAddress -
        romBase;

      const count =
        readI32(
          connectionsOffset,
        );

      if (
        count < 0 ||
        count > 64
      ) {
        return false;
      }

      if (
        count === 0
      ) {
        return false;
      }

      const dataAddress =
        readU32(
          connectionsOffset +
          4,
        );

      if (
        !isValidPointer(
          dataAddress,
          count * 0x0c,
        )
      ) {
        return false;
      }

      const dataOffset =
        dataAddress -
        romBase;

      let north =
        false;

      let east =
        false;

      for (
        let index = 0;
        index < count;
        index++
      ) {
        const entry =
          dataOffset +
          index * 0x0c;

        const direction =
          readU8(
            entry,
          );

        const offset =
          readI32(
            entry + 4,
          );

        const mapGroup =
          readU8(
            entry + 8,
          );

        const mapNumber =
          readU8(
            entry + 9,
          );

        if (
          direction === 2 &&
          offset === 0 &&
          mapGroup === 3 &&
          mapNumber === 40
        ) {
          north = true;
        }

        if (
          direction === 4 &&
          offset === 0 &&
          mapGroup === 3 &&
          mapNumber === 38
        ) {
          east = true;
        }
      }

      return (
        north &&
        east
      );
    };

    for (
      let offset = 0;
      offset <=
        this.romBytes.length -
          headerSize;
      offset += 4
    ) {
      const headerAddress =
        romBase +
        offset;

      const mapLayoutAddress =
        readU32(
          offset,
        );

      if (
        !isValidPointer(
          mapLayoutAddress,
          layoutSize,
        )
      ) {
        continue;
      }

      const layoutOffset =
        mapLayoutAddress -
        romBase;

      const width =
        readU32(
          layoutOffset,
        );

      const height =
        readU32(
          layoutOffset + 4,
        );

      if (
        width !== 24 ||
        height !== 20
      ) {
        continue;
      }

      const mapDataAddress =
        readU32(
          layoutOffset + 0x0c,
        );

      if (
        mapDataAddress ===
        FRLG_BETA_CINNABAR_MAP_DATA
      ) {
        continue;
      }

      const primaryTilesetAddress =
        readU32(
          layoutOffset + 0x10,
        );

      const secondaryTilesetAddress =
        readU32(
          layoutOffset + 0x14,
        );

      if (
        !isValidPointer(
          mapDataAddress,
          width *
          height *
          2,
        ) ||
        !isValidPointer(
          primaryTilesetAddress,
          4,
        ) ||
        !isValidPointer(
          secondaryTilesetAddress,
          4,
        )
      ) {
        continue;
      }

      if (
        !hasCinnabarConnections(
          headerAddress,
        )
      ) {
        continue;
      }

      const mapLayoutId =
        readU16(
          offset + 0x12,
        );

      const corrected: MapDefinition = {
        ...existing,
        mapLayoutId,
        mapHeaderAddress:
          headerAddress,
        mapLayoutAddress,
        mapDataAddress,
        primaryTilesetAddress,
        secondaryTilesetAddress,
        width,
        height,
        connections:
          existing.connections,
      };

      if (
        existing.mapHeaderAddress ===
          corrected.mapHeaderAddress &&
        existing.mapLayoutAddress ===
          corrected.mapLayoutAddress &&
        existing.mapDataAddress ===
          corrected.mapDataAddress &&
        existing.primaryTilesetAddress ===
          corrected.primaryTilesetAddress &&
        existing.secondaryTilesetAddress ===
          corrected.secondaryTilesetAddress
      ) {
        return;
      }

      this.mapCatalog.register(
        corrected,
      );

      return;
    }
  }

  private ensureCurrentMapDefinition(
    state: GameState,
  ): void {
    if (
      state.map.mapLayoutAddress === 0 ||
      state.map.width <= 0 ||
      state.map.height <= 0 ||
      state.map.mapDataAddress === 0 ||
      state.map.primaryTilesetAddress === 0 ||
      state.map.secondaryTilesetAddress === 0
    ) {
      return;
    }

    if (
      this.isForbiddenFireRedMapData({
        mapGroup:
          state.map.mapGroup,
        mapNumber:
          state.map.mapNumber,
        mapLayoutId:
          state.map.mapLayoutId,
        mapHeaderAddress:
          state.map.mapHeaderAddress,
        mapLayoutAddress:
          state.map.mapLayoutAddress,
        mapDataAddress:
          state.map.mapDataAddress,
        primaryTilesetAddress:
          state.map.primaryTilesetAddress,
        secondaryTilesetAddress:
          state.map.secondaryTilesetAddress,
        width:
          state.map.width,
        height:
          state.map.height,
        worldX: 0,
        worldY: 0,
        connections: [],
      })
    ) {
      return;
    }

    const existing =
      this.mapCatalog.get(
        state.map.mapGroup,
        state.map.mapNumber,
      );

    if (
      existing &&
      existing.mapLayoutAddress ===
        state.map.mapLayoutAddress &&
      existing.mapDataAddress ===
        state.map.mapDataAddress &&
      existing.primaryTilesetAddress ===
        state.map.primaryTilesetAddress &&
      existing.secondaryTilesetAddress ===
        state.map.secondaryTilesetAddress
    ) {
      return;
    }

    this.mapCatalog.register({
      mapGroup:
        state.map.mapGroup,
      mapNumber:
        state.map.mapNumber,
      mapLayoutId:
        state.map.mapLayoutId,
      mapHeaderAddress:
        state.map.mapHeaderAddress,
      mapLayoutAddress:
        state.map.mapLayoutAddress,
      mapDataAddress:
        state.map.mapDataAddress,
      primaryTilesetAddress:
        state.map.primaryTilesetAddress,
      secondaryTilesetAddress:
        state.map.secondaryTilesetAddress,
      width:
        state.map.width,
      height:
        state.map.height,
      worldX:
        0,
      worldY:
        0,
      connections:
        existing?.connections ?? [],
    });
  }

  private repairCinnabarVisual(
    state: GameState,
  ): void {
    if (
      !this.isFireRedFamily(state) ||
      state.map.mapGroup !== 3 ||
      state.map.mapNumber !== 8
    ) {
      return;
    }

    const definition =
      this.mapCatalog.get(
        3,
        8,
      );

    const visual =
      this.mapVisuals.get(
        '3:8',
      );

    if (
      definition &&
      (
        this.isForbiddenFireRedMapData(
          definition,
        ) ||
        (
          visual &&
          this.isForbiddenFireRedMapData({
            mapGroup: 3,
            mapNumber: 8,
            mapLayoutId:
              definition.mapLayoutId,
            mapHeaderAddress:
              visual.mapDataAddress,
            mapLayoutAddress:
              definition.mapLayoutAddress,
            mapDataAddress:
              visual.mapDataAddress,
            primaryTilesetAddress:
              definition.primaryTilesetAddress,
            secondaryTilesetAddress:
              definition.secondaryTilesetAddress,
            width:
              definition.width,
            height:
              definition.height,
            worldX:
              definition.worldX,
            worldY:
              definition.worldY,
            connections:
              definition.connections,
          })
        )
      )
    ) {
      if (visual) {
        this.root.remove(
          visual.baseMesh,
        );
        this.root.remove(
          visual.overlayMesh,
        );
        visual.baseTexture.dispose();
        visual.overlayTexture.dispose();
        visual.geometry.dispose();
        visual.overlayMesh.geometry.dispose();

        const baseMaterial =
          visual.baseMesh.material;

        if (
          Array.isArray(
            baseMaterial,
          )
        ) {
          baseMaterial.forEach(
            material =>
              material.dispose(),
          );
        } else {
          baseMaterial.dispose();
        }

        const overlayMaterial =
          visual.overlayMesh.material;

        if (
          Array.isArray(
            overlayMaterial,
          )
        ) {
          overlayMaterial.forEach(
            material =>
              material.dispose(),
          );
        } else {
          overlayMaterial.dispose();
        }

        this.mapVisuals.delete(
          '3:8',
        );

        this.tilesetAnimationController
          .unregisterMap(
            '3:8',
          );
      }

      this.queuedMaps.delete(
        '3:8',
      );

      return;
    }

    if (
      !definition ||
      !visual ||
      visual.mapDataAddress ===
        definition.mapDataAddress
    ) {
      return;
    }

    this.root.remove(
      visual.baseMesh,
    );

    this.root.remove(
      visual.overlayMesh,
    );

    visual.baseTexture.dispose();
    visual.overlayTexture.dispose();
    visual.geometry.dispose();
    visual.overlayMesh.geometry.dispose();

    const baseMaterial =
      visual.baseMesh.material;

    if (
      Array.isArray(
        baseMaterial,
      )
    ) {
      baseMaterial.forEach(
        material =>
          material.dispose(),
      );
    } else {
      baseMaterial.dispose();
    }

    const overlayMaterial =
      visual.overlayMesh.material;

    if (
      Array.isArray(
        overlayMaterial,
      )
    ) {
      overlayMaterial.forEach(
        material =>
          material.dispose(),
      );
    } else {
      overlayMaterial.dispose();
    }

    this.mapVisuals.delete(
      '3:8',
    );

    this.tilesetAnimationController
      .unregisterMap(
        '3:8',
      );

    this.queuedMaps.delete(
      '3:8',
    );

    this.buildQueue.push(
      definition,
    );

    this.queuedMaps.add(
      '3:8',
    );
  }

  private updateActiveWorld(
    state: GameState,
  ): void {
    this.repairCinnabarVisual(
      state,
    );

    const mapKey =
      this.createMapKey(
        state.map.mapGroup,
        state.map.mapNumber,
      );

    if (
      mapKey ===
      this.activeMapKey
    ) {
      const activeMap =
        this.mapCatalog.get(
          state.map.mapGroup,
          state.map.mapNumber,
        );

      if (
        activeMap &&
        !this.mapVisuals.has(
          mapKey,
        ) &&
        !this.queuedMaps.has(
          mapKey,
        )
      ) {
        this.queueMapBuild(
          activeMap,
        );
      }

      return;
    }

    this.activeMapKey =
      mapKey;

    const alreadyPositioned =
      this.mapWorld.hasPosition(
        state.map.mapGroup,
        state.map.mapNumber,
      );

    if (
      !alreadyPositioned
    ) {
      this.buildQueue.length =
        0;

      this.queuedMaps.clear();

      this.mapWorld.clearPositions();

      this.mapWorld.setWorldPosition(
        state.map.mapGroup,
        state.map.mapNumber,
        {
          x: 0,
          y: 0,
        },
      );

      this.mapWorld.buildFrom(
        state.map.mapGroup,
        state.map.mapNumber,
      );
    }

    const maps =
      this.mapWorld
        .getPositionedMaps();

    const activeMap =
      this.mapCatalog.get(
        state.map.mapGroup,
        state.map.mapNumber,
      );

    if (activeMap) {
      this.queueMapBuild(
        activeMap,
      );
    }

    for (
      const map of maps
    ) {
      this.queueMapBuild(
        map,
      );
    }

    this.syncMapVisualPositions(
      maps,
    );

    this.updateWorldVisibility(
      maps,
    );

    console.log(
      'Active World:',
      {
        maps:
          maps.length,

        current:
          mapKey,

        rebuilt:
          !alreadyPositioned,
      },
    );
  }

  private queueMapBuild(
    map: MapDefinition,
  ): void {
    if (
      this.isForbiddenFireRedMapData(
        map,
      )
    ) {
      return;
    }

    const key =
      this.createMapKey(
        map.mapGroup,
        map.mapNumber,
      );

    if (
      this.mapVisuals.has(
        key,
      )
    ) {
      return;
    }

    if (
      this.queuedMaps.has(
        key,
      )
    ) {
      return;
    }

    this.queuedMaps.add(
      key,
    );

    this.buildQueue.push(
      map,
    );
  }

  private processMapBuildQueue():
    void {
    const map =
      this.buildQueue.shift();

    if (!map) {
      return;
    }

    const key =
      this.createMapKey(
        map.mapGroup,
        map.mapNumber,
      );

    this.queuedMaps.delete(
      key,
    );

    if (
      this.mapVisuals.has(
        key,
      )
    ) {
      return;
    }

    try {
      this.buildMapVisual(
        map,
      );
    } catch (error) {
      console.error(
        'Failed to build map visual.',
        {
          key,
          error,
        },
      );
    }
  }

  private syncMapVisualPositions(
    maps: MapDefinition[],
  ): void {
    for (
      const map of maps
    ) {
      const visual =
        this.mapVisuals.get(
          this.createMapKey(
            map.mapGroup,
            map.mapNumber,
          ),
        );

      if (!visual) {
        continue;
      }

      const position =
        this.mapWorld
          .getWorldPosition(
            map.mapGroup,
            map.mapNumber,
          );

      if (!position) {
        continue;
      }

      const centerX =
        position.x +
        map.width / 2;

      const centerZ =
        position.y +
        map.height / 2;

      visual.baseMesh.position.set(
        centerX,
        0,
        centerZ,
      );

      visual.overlayMesh.position.set(
        centerX,
        0.002,
        centerZ,
      );
    }
  }

  private updateWorldVisibility(
    maps: MapDefinition[],
  ): void {
    const positionedKeys =
      new Set<string>();

    for (
      const map of maps
    ) {
      positionedKeys.add(
        this.createMapKey(
          map.mapGroup,
          map.mapNumber,
        ),
      );
    }

    for (
      const [
        key,
        visual,
      ] of this.mapVisuals
    ) {
      const visible =
        positionedKeys.has(
          key,
        );

      visual.baseMesh.visible =
        visible;

      visual.overlayMesh.visible =
        visible;
    }
  }

  private buildMapVisual(
    map: MapDefinition,
  ): void {
    if (
      this.isForbiddenFireRedMapData(
        map,
      )
    ) {
      return;
    }
    type MapRenderData =
      NonNullable<
        ReturnType<
          Gen3StateAdapter['getMapRenderData']
        >
      >;

    let renderData:
      MapRenderData | null =
      null;

    if (
      !renderData
    ) {
      try {
        renderData =
          this.stateAdapter
            .getMapRenderData(
              map.mapDataAddress,
              map.width,
              map.height,
              map.primaryTilesetAddress,
              map.secondaryTilesetAddress,
            );
      } catch (error) {
        console.warn(
          'Static FireRed/LeafGreen map render failed.',
          {
            key:
              this.createMapKey(
                map.mapGroup,
                map.mapNumber,
              ),
            error,
          },
        );
      }
    }

    if (
      !renderData
    ) {
      return;
    }

    const textureWidth =
      map.width *
      GBA_METATILE_PIXELS;

    const textureHeight =
      map.height *
      GBA_METATILE_PIXELS;

    const pixels =
      new Uint8ClampedArray(
        textureWidth *
        textureHeight *
        4,
      );

    const foregroundPixels =
      new Uint8ClampedArray(
        pixels.length,
      );

    const drawPixels = (
      destination:
        Uint8ClampedArray,
      graphics:
        Gen3MetatileGraphics,
      sourceY: number,
      sourceX: number,
      destinationX: number,
      destinationY: number,
    ): void => {
      const sourceOffset =
        (
          sourceY *
            GBA_METATILE_PIXELS +
          sourceX
        ) * 4;

      const destinationOffset =
        (
          destinationY *
            textureWidth +
          destinationX
        ) * 4;

      destination[
        destinationOffset
      ] =
        graphics.basePixels[
          sourceOffset
        ];

      destination[
        destinationOffset + 1
      ] =
        graphics.basePixels[
          sourceOffset + 1
        ];

      destination[
        destinationOffset + 2
      ] =
        graphics.basePixels[
          sourceOffset + 2
        ];

      destination[
        destinationOffset + 3
      ] =
        graphics.basePixels[
          sourceOffset + 3
        ];

      foregroundPixels[
        destinationOffset
      ] =
        graphics.foregroundPixels[
          sourceOffset
        ];

      foregroundPixels[
        destinationOffset + 1
      ] =
        graphics.foregroundPixels[
          sourceOffset + 1
        ];

      foregroundPixels[
        destinationOffset + 2
      ] =
        graphics.foregroundPixels[
          sourceOffset + 2
        ];

      foregroundPixels[
        destinationOffset + 3
      ] =
        graphics.foregroundPixels[
          sourceOffset + 3
        ];
    };

    for (
      let y = 0;
      y < map.height;
      y++
    ) {
      for (
        let x = 0;
        x < map.width;
        x++
      ) {
        const block =
          renderData.blocks[
            y * map.width + x
          ];

        if (!block) {
          continue;
        }

        const graphics =
          renderData.graphics.get(
            block.metatileId,
          );

        if (!graphics) {
          continue;
        }

        for (
          let sourceY = 0;
          sourceY <
            GBA_METATILE_PIXELS;
          sourceY++
        ) {
          const destinationY =
            (
              map.height -
              1 -
              y
            ) *
              GBA_METATILE_PIXELS +
            GBA_METATILE_PIXELS -
            1 -
            sourceY;

          for (
            let sourceX = 0;
            sourceX <
              GBA_METATILE_PIXELS;
            sourceX++
          ) {
            const destinationX =
              x *
                GBA_METATILE_PIXELS +
              sourceX;

            drawPixels(
              pixels,
              graphics,
              sourceY,
              sourceX,
              destinationX,
              destinationY,
            );
          }
        }
      }
    }

    const baseTexture =
      this.createMapTexture(
        pixels,
        textureWidth,
        textureHeight,
      );

    const overlayTexture =
      this.createMapTexture(
        foregroundPixels,
        textureWidth,
        textureHeight,
      );

    const geometry =
      new THREE.PlaneGeometry(
        map.width,
        map.height,
      );

    const baseMaterial =
      new THREE.MeshBasicMaterial({
        map:
          baseTexture,

        transparent:
          true,

        depthWrite:
          true,

        side:
          THREE.DoubleSide,
      });

    const overlayMaterial =
      new THREE.MeshBasicMaterial({
        map:
          overlayTexture,

        transparent:
          true,

        depthTest:
          false,

        depthWrite:
          false,

        side:
          THREE.DoubleSide,
      });

    const baseMesh =
      new THREE.Mesh(
        geometry,
        baseMaterial,
      );

    const overlayMesh =
      new THREE.Mesh(
        geometry.clone(),
        overlayMaterial,
      );

    baseMesh.rotation.x =
      -Math.PI / 2;

    overlayMesh.rotation.x =
      -Math.PI / 2;

    const position =
      this.mapWorld
        .getWorldPosition(
          map.mapGroup,
          map.mapNumber,
        );

    if (!position) {
      geometry.dispose();
      baseTexture.dispose();
      overlayTexture.dispose();
      baseMaterial.dispose();
      overlayMaterial.dispose();
      overlayMesh.geometry.dispose();

      return;
    }

    const centerX =
      position.x +
      map.width / 2;

    const centerZ =
      position.y +
      map.height / 2;

    baseMesh.position.set(
      centerX,
      0,
      centerZ,
    );

    overlayMesh.position.set(
      centerX,
      0.002,
      centerZ,
    );

    overlayMesh.renderOrder =
      2;

    this.root.add(
      baseMesh,
    );

    this.root.add(
      overlayMesh,
    );

    const mapKey =
      this.createMapKey(
        map.mapGroup,
        map.mapNumber,
      );

    const animatedPlacements =
      this.tilesetAnimationController
        .createPlacements(
          map,
          renderData.blocks,
        );

    const visual:
      MapVisual = {
        baseMesh,
        overlayMesh,
        baseTexture,
        overlayTexture,
        geometry,
        mapDataAddress:
          map.mapDataAddress,
      };

    this.mapVisuals.set(
      mapKey,
      visual,
    );

    this.tilesetAnimationController
      .attachMap(
        mapKey,
        map,
        baseTexture,
        overlayTexture,
        animatedPlacements,
      );

    const visible =
      this.mapWorld.hasPosition(
        map.mapGroup,
        map.mapNumber,
      );

    baseMesh.visible =
      visible;

    overlayMesh.visible =
      visible;
  }

  private createMapTexture(
    pixels:
      Uint8ClampedArray,
    width: number,
    height: number,
  ): THREE.DataTexture {
    const texture =
      new THREE.DataTexture(
        new Uint8Array(
          pixels,
        ),
        width,
        height,
        THREE.RGBAFormat,
        THREE.UnsignedByteType,
      );

    texture.magFilter =
      THREE.NearestFilter;

    texture.minFilter =
      THREE.NearestFilter;

    texture.generateMipmaps =
      false;

    texture.flipY =
      false;

    texture.colorSpace =
      THREE.SRGBColorSpace;

    texture.needsUpdate =
      true;

    return texture;
  }

  private getPlayerWorldPosition(
    state: GameState,
  ): {
    x: number;
    z: number;
  } {
    const mapPosition =
      this.mapWorld
        .getWorldPosition(
          state.map.mapGroup,
          state.map.mapNumber,
        );

    if (!mapPosition) {
      return {
        x:
          state.player.x +
          0.5,

        z:
          state.player.y +
          0.5,
      };
    }

    return {
      x:
        mapPosition.x +
        state.player.x +
        0.5,

      z:
        mapPosition.y +
        state.player.y +
        0.5,
    };
  }

  private updatePlayer(
    state: GameState,
  ): {
    x: number;
    z: number;
  } {
    const position =
      this.getPlayerWorldPosition(
        state,
      );

    this.player.position.x =
      position.x;

    this.player.position.z =
      position.z;

    const directionMap = {
      UP:
        -Math.PI / 2,

      DOWN:
        Math.PI / 2,

      LEFT:
        Math.PI,

      RIGHT:
        0,
    } satisfies Record<
      string,
      number
    >;

    this.player.rotation.y =
      directionMap[
        state.player.direction
      ] ?? 0;

    return position;
  }

  private updateCamera(
    position: {
      x: number;
      z: number;
    },
  ): void {
    const targetX =
      position.x;

    const targetZ =
      position.z;

    const cameraTargetX =
      targetX;

    const cameraTargetY =
      10;

    const cameraTargetZ =
      targetZ + 11;

    this.camera.position.x +=
      (
        cameraTargetX -
        this.camera.position.x
      ) * 0.12;

    this.camera.position.y +=
      (
        cameraTargetY -
        this.camera.position.y
      ) * 0.12;

    this.camera.position.z +=
      (
        cameraTargetZ -
        this.camera.position.z
      ) * 0.12;

    this.camera.lookAt(
      targetX,
      0,
      targetZ,
    );
  }

  private updateDebug(
    state: GameState,
  ): void {
    if (
      state.player.x !==
        this.lastPlayerX ||
      state.player.y !==
        this.lastPlayerY ||
      state.player.direction !==
        this.lastDirection ||
      state.player
        .movementState !==
        this.lastMovementState
    ) {
      console.log(
        'Player State:',
        {
          x:
            state.player.x,

          y:
            state.player.y,

          direction:
            state.player.direction,

          movementState:
            state.player.movementState,
        },
      );

      this.lastPlayerX =
        state.player.x;

      this.lastPlayerY =
        state.player.y;

      this.lastDirection =
        state.player.direction;

      this.lastMovementState =
        state.player.movementState;
    }

    if (
      state.map.mapGroup !==
        this.lastMapGroup ||
      state.map.mapNumber !==
        this.lastMapNumber ||
      state.map.mapLayoutId !==
        this.lastMapLayoutId
    ) {
      console.log(
        'Map State:',
        {
          mapGroup:
            state.map.mapGroup,

          mapNumber:
            state.map.mapNumber,

          mapLayoutId:
            state.map.mapLayoutId,
        },
      );

      this.lastMapGroup =
        state.map.mapGroup;

      this.lastMapNumber =
        state.map.mapNumber;

      this.lastMapLayoutId =
        state.map.mapLayoutId;
    }
  }

  private isForbiddenFireRedMapData(
    map: MapDefinition,
  ): boolean {
    return (
      (
        map.mapGroup === 3 &&
        map.mapNumber === 8
      ) &&
      (
        map.mapDataAddress ===
        FRLG_BETA_CINNABAR_MAP_DATA
      )
    );
  }

  private createMapKey(
    mapGroup: number,
    mapNumber: number,
  ): string {
    return `${mapGroup}:${mapNumber}`;
  }

  private animate =
    (): void => {
      this.frameId =
        requestAnimationFrame(
          this.animate,
        );

      const state =
        this.stateAdapter
          .readState();

      this.currentState =
        state;

      this.ensureWorldCatalog(
        state,
      );

      this.ensureCurrentMapDefinition(
        state,
      );

      if (
        this.isFireRedFamily(state)
      ) {
        this.ensureFireRedCinnabarDefinition(
          state,
        );
      }

      this.updateActiveWorld(
        state,
      );

      this.processMapBuildQueue();

      this.tilesetAnimationController.update(
        state.map.primaryTilesetAddress,
        state.map.secondaryTilesetAddress,
      );

      const playerPosition =
        this.updatePlayer(
          state,
        );

      this.updateCamera(
        playerPosition,
      );

      this.updateDebug(
        state,
      );

      this.renderer.render(
        this.scene,
        this.camera,
      );
    };

  destroy(): void {
    cancelAnimationFrame(
      this.frameId,
    );

    window.removeEventListener(
      'resize',
      this.resizeHandler,
    );

    for (
      const visual of
        this.mapVisuals.values()
    ) {
      visual.baseTexture.dispose();
      visual.overlayTexture.dispose();
      visual.geometry.dispose();

      visual.overlayMesh
        .geometry
        .dispose();

      const baseMaterial =
        visual.baseMesh.material;

      const overlayMaterial =
        visual.overlayMesh.material;

      if (
        Array.isArray(
          baseMaterial,
        )
      ) {
        baseMaterial.forEach(
          (
            material,
          ) =>
            material.dispose(),
        );
      } else {
        baseMaterial.dispose();
      }

      if (
        Array.isArray(
          overlayMaterial,
        )
      ) {
        overlayMaterial.forEach(
          (
            material,
          ) =>
            material.dispose(),
        );
      } else {
        overlayMaterial.dispose();
      }
    }

    this.mapVisuals.clear();

    this.tilesetAnimationController
      .clear();

    this.player.geometry.dispose();

    if (
      Array.isArray(
        this.player.material,
      )
    ) {
      this.player.material.forEach(
        (
          material,
        ) =>
          material.dispose(),
      );
    } else {
      this.player.material.dispose();
    }

    this.renderer.dispose();

    this.container.innerHTML =
      '';
  }
}