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

const GBA_METATILE_PIXELS =
  16;

interface MapVisual {
  baseMesh: THREE.Mesh;
  overlayMesh: THREE.Mesh;

  baseTexture:
    THREE.DataTexture;

  overlayTexture:
    THREE.DataTexture;

  geometry:
    THREE.PlaneGeometry;
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

  private worldCatalogBuilt =
    false;

  private worldCatalogBuildAttempted =
    false;

  private worldCatalogLastAttemptKey =
    '';

  private worldCatalogLastAttemptAt =
    0;

  private liveMapSignature =
    '';

  private activeMapKey =
    '';

  private worldRootKey =
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
      });

    this.renderer.setPixelRatio(
      Math.min(
        window.devicePixelRatio,
        2,
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
      this.worldCatalogBuilt
    ) {
      return;
    }

    if (
      state.map.mapLayoutAddress === 0
    ) {
      return;
    }

    const attemptKey =
      [
        state.map.mapGroup,
        state.map.mapNumber,
        state.map.mapLayoutId,
        state.map.mapLayoutAddress,
      ].join(':');

    const now =
      performance.now();

    if (
      this.worldCatalogBuildAttempted &&
      this.worldCatalogLastAttemptKey ===
        attemptKey &&
      now - this.worldCatalogLastAttemptAt <
        1000
    ) {
      return;
    }

    this.worldCatalogBuildAttempted =
      true;

    this.worldCatalogLastAttemptKey =
      attemptKey;

    this.worldCatalogLastAttemptAt =
      now;

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
      this.worldCatalogBuilt =
        false;

      console.warn(
        'Unable to build Gen 3 map catalog; retrying.',
        {
          game:
            state.game.region,

          mapGroup:
            state.map.mapGroup,

          mapNumber:
            state.map.mapNumber,

          mapLayoutId:
            state.map.mapLayoutId,

          mapLayoutAddress:
            `0x${state.map.mapLayoutAddress.toString(16)}`,
        },
      );

      return;
    }

    this.worldCatalogBuilt =
      true;

    this.activeMapKey =
      '';

    this.worldRootKey =
      '';

    this.liveMapSignature =
      '';

    this.buildQueue.length =
      0;

    this.queuedMaps.clear();

    this.mapWorld.clearPositions();

    console.log(
      'Gen 3 Map Catalog:',
      count,
      'maps',
    );
  }

  private ensureCurrentMapDefinition(
    state: GameState,
  ): void {
    if (
      state.map.mapLayoutAddress === 0
    ) {
      return;
    }

    if (
      state.map.width <= 0 ||
      state.map.height <= 0 ||
      state.map.mapDataAddress === 0 ||
      state.map.primaryTilesetAddress === 0 ||
      state.map.secondaryTilesetAddress === 0
    ) {
      return;
    }

    const existing =
      this.mapCatalog.get(
        state.map.mapGroup,
        state.map.mapNumber,
      );

    const connections =
      existing?.connections ??
      [];

    const signature =
      [
        state.map.mapGroup,
        state.map.mapNumber,
        state.map.mapLayoutId,
        state.map.mapHeaderAddress,
        state.map.mapLayoutAddress,
        state.map.mapDataAddress,
        state.map.primaryTilesetAddress,
        state.map.secondaryTilesetAddress,
        state.map.width,
        state.map.height,
      ].join(':');

    if (
      signature ===
      this.liveMapSignature
    ) {
      return;
    }

    const definition: MapDefinition = {
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
        existing?.worldX ?? 0,

      worldY:
        existing?.worldY ?? 0,

      connections,
    };

    this.mapCatalog.register(
      definition,
    );

    this.liveMapSignature =
      signature;

    console.log(
      'Live Gen 3 map synchronized:',
      {
        key:
          this.createMapKey(
            state.map.mapGroup,
            state.map.mapNumber,
          ),

        layoutId:
          state.map.mapLayoutId,

        mapDataAddress:
          `0x${state.map.mapDataAddress.toString(16)}`,

        preservedConnections:
          connections.length,
      },
    );
  }

  private updateActiveWorld(
    state: GameState,
  ): void {
    const mapKey =
      this.createMapKey(
        state.map.mapGroup,
        state.map.mapNumber,
      );

    if (
      mapKey ===
      this.activeMapKey
    ) {
      return;
    }

    this.activeMapKey =
      mapKey;

    const alreadyPositioned =
      this.mapWorld.hasPosition(
        state.map.mapGroup,
        state.map.mapNumber,
      );

    const needsWorldRebuild =
      this.worldRootKey === '' ||
      !alreadyPositioned;

    let rebuilt =
      false;

    if (
      needsWorldRebuild
    ) {
      this.buildQueue.length =
        0;

      this.queuedMaps.clear();

      this.mapWorld.clearPositions();

      const positionedCount =
        this.mapWorld.buildFrom(
          state.map.mapGroup,
          state.map.mapNumber,
        );

      if (
        positionedCount > 0
      ) {
        this.worldRootKey =
          mapKey;

        rebuilt =
          true;
      }
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

        root:
          this.worldRootKey,

        rebuilt,
      },
    );
  }

  private queueMapBuild(
    map: MapDefinition,
  ): void {
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

    this.buildMapVisual(
      map,
    );
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
    const renderData =
      this.stateAdapter
        .getMapRenderData(
          map.mapDataAddress,
          map.width,
          map.height,
          map.primaryTilesetAddress,
          map.secondaryTilesetAddress,
        );

    if (!renderData) {
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

    const visual:
      MapVisual = {
        baseMesh,
        overlayMesh,
        baseTexture,
        overlayTexture,
        geometry,
      };

    const mapKey =
      this.createMapKey(
        map.mapGroup,
        map.mapNumber,
      );

    this.mapVisuals.set(
      mapKey,
      visual,
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

      this.ensureWorldCatalog(
        state,
      );

      this.ensureCurrentMapDefinition(
        state,
      );

      if (
        state.map.mapLayoutAddress !==
        0
      ) {
        this.updateActiveWorld(
          state,
        );
      }

      this.processMapBuildQueue();

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