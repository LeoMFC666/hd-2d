import * as THREE from 'three';
import type { Gen3StateAdapter } from '../gen3/Gen3StateAdapter';
import type { GameState } from '../gen3/GameState';

const GBA_METATILE_PIXELS = 16;

export class PlayerRenderer {
  private readonly container: HTMLElement;
  private readonly stateAdapter: Gen3StateAdapter;
  private readonly scene: THREE.Scene;
  private readonly camera: THREE.PerspectiveCamera;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly player: THREE.Mesh;
  private readonly root: THREE.Group;

  private readonly mapMesh: THREE.Mesh;
  private readonly mapMaterial: THREE.MeshBasicMaterial;
  private readonly mapOverlayMesh: THREE.Mesh;
  private readonly mapOverlayMaterial: THREE.MeshBasicMaterial;

  private mapTexture: THREE.DataTexture | null = null;
  private mapOverlayTexture: THREE.DataTexture | null = null;
  private mapGeometry: THREE.PlaneGeometry | null = null;

  private lastMapKey = '';

  private frameId = 0;

  private lastDebugX = -1;
  private lastDebugY = -1;
  private lastDebugDirection = '';
  private lastDebugMovementState = '';

  private lastDebugMapGroup = -1;
  private lastDebugMapNumber = -1;
  private lastDebugMapLayoutId = -1;

  private lastDebugMapHeaderAddress = -1;
  private lastDebugMapLayoutAddress = -1;
  private lastDebugMapWidth = -1;
  private lastDebugMapHeight = -1;

  constructor(
    container: HTMLElement,
    stateAdapter: Gen3StateAdapter,
  ) {
    this.container = container;
    this.stateAdapter = stateAdapter;

    this.scene = new THREE.Scene();
    this.scene.background =
      new THREE.Color('#0b1220');

    this.camera =
      new THREE.PerspectiveCamera(
        48,
        1,
        0.1,
        5000,
      );

    this.camera.position.set(
      0,
      8,
      10,
    );

    this.root =
      new THREE.Group();

    this.scene.add(this.root);

    this.mapMaterial =
      new THREE.MeshBasicMaterial({
        transparent: true,
        depthWrite: true,
        side: THREE.DoubleSide,
      });

    this.mapMesh =
      new THREE.Mesh(
        new THREE.PlaneGeometry(
          1,
          1,
        ),
        this.mapMaterial,
      );

    this.mapMesh.rotation.x =
      -Math.PI / 2;

    this.mapMesh.position.y = 0;
    this.mapMesh.renderOrder = 0;

    this.root.add(
      this.mapMesh,
    );

    this.mapOverlayMaterial =
      new THREE.MeshBasicMaterial({
        transparent: true,
        depthTest: false,
        depthWrite: false,
        side: THREE.DoubleSide,
      });

    this.mapOverlayMesh =
      new THREE.Mesh(
        new THREE.PlaneGeometry(
          1,
          1,
        ),
        this.mapOverlayMaterial,
      );

    this.mapOverlayMesh.rotation.x =
      -Math.PI / 2;

    this.mapOverlayMesh.position.y =
      0.002;

    this.mapOverlayMesh.renderOrder =
      2;

    this.root.add(
      this.mapOverlayMesh,
    );

    const bodyMaterial =
      new THREE.MeshStandardMaterial({
        color: 0x5ec6ff,
        emissive: 0x1f4d63,
        roughness: 0.45,
        metalness: 0.2,
      });

    this.player =
      new THREE.Mesh(
        new THREE.BoxGeometry(
          0.55,
          1.0,
          0.55,
        ),
        bodyMaterial,
      );

    this.player.position.y =
      0.5;
    this.player.renderOrder = 1;

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

    window.addEventListener(
      'resize',
      () => this.resize(),
    );

    this.animate();
  }

  private resize(): void {
    const width =
      this.container.clientWidth ||
      320;

    const height =
      this.container.clientHeight ||
      220;

    this.camera.aspect =
      width / height;

    this.camera.updateProjectionMatrix();

    this.renderer.setSize(
      width,
      height,
      false,
    );
  }

  private updateMap(state: GameState): void {
    if (
      state.map.width <= 0 ||
      state.map.height <= 0
    ) {
      return;
    }

    const mapKey =
      [
        state.map.mapGroup,
        state.map.mapNumber,
        state.map.mapLayoutId,
        state.map.mapDataAddress,
        state.map.primaryTilesetAddress,
        state.map.secondaryTilesetAddress,
      ].join(':');

    if (
      mapKey === this.lastMapKey
    ) {
      return;
    }

    const blocks =
      this.stateAdapter.getMapBlocks();

    const expectedBlockCount =
      state.map.width *
      state.map.height;

    if (
      blocks.length !==
      expectedBlockCount
    ) {
      return;
    }

    const textureWidth =
      state.map.width *
      GBA_METATILE_PIXELS;

    const textureHeight =
      state.map.height *
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

    const graphicsCache =
      new Map<
        number,
        ReturnType<
          Gen3StateAdapter[
            'getMetatileGraphics'
          ]
        >
      >();

    for (
      let y = 0;
      y < state.map.height;
      y++
    ) {
      for (
        let x = 0;
        x < state.map.width;
        x++
      ) {
        const block =
          blocks[
            y * state.map.width + x
          ];

        if (!block) {
          continue;
        }

        let graphics =
          graphicsCache.get(
            block.metatileId,
          );

        if (
          graphics === undefined
        ) {
          graphics =
            this.stateAdapter
              .getMetatileGraphics(
                block.metatileId,
              );

          graphicsCache.set(
            block.metatileId,
            graphics,
          );
        }

        if (!graphics) {
          continue;
        }

        for (
          let sourceY = 0;
          sourceY < GBA_METATILE_PIXELS;
          sourceY++
        ) {
          const destinationY =
            (state.map.height - 1 - y) *
              GBA_METATILE_PIXELS +
            GBA_METATILE_PIXELS -
            1 -
            sourceY;

          for (
            let sourceX = 0;
            sourceX < GBA_METATILE_PIXELS;
            sourceX++
          ) {
            const sourceOffset =
              (
                sourceY *
                  GBA_METATILE_PIXELS +
                sourceX
              ) * 4;

            const destinationX =
              x *
                GBA_METATILE_PIXELS +
              sourceX;

            const destinationOffset =
              (
                destinationY *
                  textureWidth +
                destinationX
              ) * 4;

            pixels[
              destinationOffset
            ] =
              graphics.basePixels[
                sourceOffset
              ];

            pixels[
              destinationOffset + 1
            ] =
              graphics.basePixels[
                sourceOffset + 1
              ];

            pixels[
              destinationOffset + 2
            ] =
              graphics.basePixels[
                sourceOffset + 2
              ];

            pixels[
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
          }
        }
      }
    }

    if (this.mapTexture) {
      this.mapTexture.dispose();
    }

    if (this.mapOverlayTexture) {
      this.mapOverlayTexture.dispose();
    }

    if (this.mapGeometry) {
      this.mapGeometry.dispose();
    }

    this.mapTexture =
      this.createMapTexture(
        pixels,
        textureWidth,
        textureHeight,
      );

    this.mapMaterial.map =
      this.mapTexture;

    this.mapMaterial.needsUpdate =
      true;

    this.mapOverlayTexture =
      this.createMapTexture(
        foregroundPixels,
        textureWidth,
        textureHeight,
      );

    this.mapOverlayMaterial.map =
      this.mapOverlayTexture;

    this.mapOverlayMaterial.needsUpdate =
      true;

    this.mapGeometry =
      new THREE.PlaneGeometry(
        state.map.width,
        state.map.height,
      );

    this.mapMesh.geometry =
      this.mapGeometry;

    this.mapOverlayMesh.geometry =
      this.mapGeometry;

    this.mapMesh.position.set(
      state.map.width / 2,
      0,
      state.map.height / 2,
    );

    this.mapOverlayMesh.position.set(
      state.map.width / 2,
      0.002,
      state.map.height / 2,
    );

    this.lastMapKey =
      mapKey;

    console.log(
      'Three.js Map:',
      {
        width:
          state.map.width,
        height:
          state.map.height,
        blocks:
          expectedBlockCount,
        textureWidth,
        textureHeight,
      },
    );
  }

  private createMapTexture(
    pixels: Uint8ClampedArray,
    width: number,
    height: number,
  ): THREE.DataTexture {
    const texture =
      new THREE.DataTexture(
        new Uint8Array(pixels),
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

  private animate = (): void => {
    this.frameId =
      requestAnimationFrame(
        this.animate,
      );

    const state =
      this.stateAdapter.readState();

    this.updateMap(state);

    if (
      state.player.x !==
        this.lastDebugX ||
      state.player.y !==
        this.lastDebugY ||
      state.player.direction !==
        this.lastDebugDirection ||
      state.player.movementState !==
        this.lastDebugMovementState
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

      this.lastDebugX =
        state.player.x;

      this.lastDebugY =
        state.player.y;

      this.lastDebugDirection =
        state.player.direction;

      this.lastDebugMovementState =
        state.player.movementState;
    }

    if (
      state.map.mapGroup !==
        this.lastDebugMapGroup ||
      state.map.mapNumber !==
        this.lastDebugMapNumber ||
      state.map.mapLayoutId !==
        this.lastDebugMapLayoutId
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

      this.lastDebugMapGroup =
        state.map.mapGroup;

      this.lastDebugMapNumber =
        state.map.mapNumber;

      this.lastDebugMapLayoutId =
        state.map.mapLayoutId;
    }

    if (
      state.map.mapHeaderAddress !==
        this.lastDebugMapHeaderAddress ||
      state.map.mapLayoutAddress !==
        this.lastDebugMapLayoutAddress ||
      state.map.width !==
        this.lastDebugMapWidth ||
      state.map.height !==
        this.lastDebugMapHeight
    ) {
      console.log(
        'Map Layout:',
        {
          mapHeaderAddress:
            `0x${state.map.mapHeaderAddress.toString(16)}`,

          mapLayoutAddress:
            `0x${state.map.mapLayoutAddress.toString(16)}`,

          width:
            state.map.width,

          height:
            state.map.height,
        },
      );

      this.lastDebugMapHeaderAddress =
        state.map.mapHeaderAddress;

      this.lastDebugMapLayoutAddress =
        state.map.mapLayoutAddress;

      this.lastDebugMapWidth =
        state.map.width;

      this.lastDebugMapHeight =
        state.map.height;
    }

    const x =
      state.player.x + 0.5;

    const z =
      state.player.y + 0.5;

    this.player.position.x =
      x;

    this.player.position.z =
      z;

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

    const mapCenterX =
      state.map.width / 2;

    const mapCenterZ =
      state.map.height / 2;

    const verticalFov =
      THREE.MathUtils.degToRad(
        this.camera.fov,
      );

    const halfVerticalFovTangent =
      Math.tan(verticalFov / 2);

    const cameraElevationSin =
      0.82;

    const cameraElevationCos =
      Math.sqrt(
        1 -
        cameraElevationSin *
          cameraElevationSin,
      );

    const verticalFitDistance =
      state.map.height /
      (
        2 *
        halfVerticalFovTangent *
        cameraElevationSin
      );

    const horizontalFitDistance =
      state.map.width /
      (
        2 *
        halfVerticalFovTangent *
        this.camera.aspect
      );

    const cameraDistance =
      Math.max(
        verticalFitDistance,
        horizontalFitDistance,
      ) * 1.2;

    const cameraX =
      mapCenterX;

    const cameraY =
      cameraDistance *
      cameraElevationSin;

    const cameraZ =
      mapCenterZ +
      cameraDistance *
        cameraElevationCos;

    this.camera.position.x +=
      (
        cameraX -
        this.camera.position.x
      ) * 0.08;

    this.camera.position.y +=
      (
        cameraY -
        this.camera.position.y
      ) * 0.08;

    this.camera.position.z +=
      (
        cameraZ -
        this.camera.position.z
      ) * 0.08;

    this.camera.lookAt(
      mapCenterX,
      0,
      mapCenterZ,
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

    if (this.mapTexture) {
      this.mapTexture.dispose();
    }

    if (this.mapOverlayTexture) {
      this.mapOverlayTexture.dispose();
    }

    if (this.mapGeometry) {
      this.mapGeometry.dispose();
    }

    this.mapMaterial.dispose();
    this.mapOverlayMaterial.dispose();
    this.player.geometry.dispose();
    if (Array.isArray(this.player.material)) {
      this.player.material.forEach(
        (material) => material.dispose(),
      );
    } else {
      this.player.material.dispose();
    }

    this.renderer.dispose();

    this.container.innerHTML =
      '';
  }
}
