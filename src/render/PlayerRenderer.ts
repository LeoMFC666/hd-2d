import * as THREE from 'three';

// Teto de tentativas de montagem do catalogo e intervalo entre elas.
// Sem isso a montagem (que varre o ROM inteiro) era refeita a cada frame
// enquanto falhasse, travando a thread principal.
// Quantos metatiles de borda desenhar em volta do mapa ativo.
const MAP_PADDING_METATILES =
  12;

// Tipos de mapa (offset 0x17 do cabecalho) que recebem padding.
// 1 TOWN, 2 CITY, 3 ROUTE, 5 UNDERWATER, 6 OCEAN_ROUTE.
// Ficam de fora 4 UNDERGROUND, 8 INDOOR e 9 SECRET_BASE: no jogo original
// o espaco fora desses mapas e preto mesmo.
const OUTDOOR_MAP_TYPES =
  new Set<number>([1, 2, 3, 5, 6]);

const GBA_ROM_BASE_ADDRESS =
  0x08000000;

const METATILE_ID_MASK =
  0x03ff;

const MAX_CATALOG_BUILD_ATTEMPTS =
  8;

const CATALOG_BUILD_RETRY_MS =
  500;

import type {
  Gen3StateAdapter,
  Gen3MetatileGraphics,
} from '../gen3/Gen3StateAdapter';

import type {
  GameState,
} from '../gen3/GameState';

import {
  TileAnimator,
} from './TileAnimator';

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

  // Guardados para a animacao de tiles: ela repinta diretamente neste
  // buffer e marca a textura como suja. Os ids de metatile vao como
  // Uint16Array (2 bytes por bloco) em vez da lista de objetos, que seria
  // pesada demais com dezenas de mapas carregados.
  basePixels: Uint8ClampedArray;

  metatileIds: Uint16Array;

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

  private worldCatalogBuildFailures =
    0;

  private nextCatalogBuildAt =
    0;

  private readonly worldBorderMeshes:
    THREE.Mesh[] = [];

  private readonly tileAnimator:
    TileAnimator;

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

    this.tileAnimator =
      new TileAnimator(
        romBytes,
        stateAdapter.getMemoryReader(),
      );

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
      this.worldCatalogBuilt ||
      this.worldCatalogBuildAttempted
    ) {
      return;
    }

    if (
      this.worldCatalogBuildFailures >=
      MAX_CATALOG_BUILD_ATTEMPTS
    ) {
      return;
    }

    if (
      performance.now() <
      this.nextCatalogBuildAt
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
      // Antes isto zerava worldCatalogBuildAttempted incondicionalmente,
      // e a montagem do catalogo era refeita A CADA FRAME enquanto
      // falhasse. Cada tentativa varre o ROM inteiro (16 MB) duas vezes na
      // thread principal - era essa repeticao a 60fps que travava o app ao
      // carregar save em interior, onde a ancora costumava falhar.
      // Agora ha teto de tentativas e intervalo minimo entre elas.
      this.worldCatalogBuildFailures++;

      if (
        this.worldCatalogBuildFailures >=
        MAX_CATALOG_BUILD_ATTEMPTS
      ) {
        console.warn(
          'Gen 3 map catalog: desistindo apos',
          this.worldCatalogBuildFailures,
          'tentativas.',
        );

        return;
      }

      this.nextCatalogBuildAt =
        performance.now() +
        CATALOG_BUILD_RETRY_MS;

      this.worldCatalogBuildAttempted =
        false;

      console.warn(
        'Unable to build Gen 3 map catalog. Tentativa',
        this.worldCatalogBuildFailures,
      );

      return;
    }

    // VALIDACAO DA ANCORA
    //
    // Este teste so passou a valer alguma coisa agora que gMapGroups e
    // localizada pela estrutura do ROM. Enquanto a tabela era derivada da
    // propria ancora, conferir que o mapa da ancora apontava para o layout
    // da ancora era TAUTOLOGICO: o catalogo era construido exatamente para
    // que isso fosse verdade, e o teste nunca podia falhar.
    //
    // Com a tabela vindo de uma fonte independente, a comparacao passa a
    // ter conteudo: se o mapa registrado na posicao da ancora nao apontar
    // para o layout que a ancora leu da RAM, ou a RAM ainda nao estava
    // valida, ou a tabela nao corresponde a este ROM. Nos dois casos o
    // certo e descartar e tentar de novo, nunca fixar o erro.
    const anchored =
      this.mapCatalog.get(
        state.map.mapGroup,
        state.map.mapNumber,
      );

    if (
      !anchored ||
      anchored.mapLayoutAddress !==
        state.map.mapLayoutAddress
    ) {
      this.mapCatalog.clear();

      this.worldCatalogBuildFailures++;

      if (
        this.worldCatalogBuildFailures <
        MAX_CATALOG_BUILD_ATTEMPTS
      ) {
        this.nextCatalogBuildAt =
          performance.now() +
          CATALOG_BUILD_RETRY_MS;

        this.worldCatalogBuildAttempted =
          false;
      }

      console.warn(
        'Catalogo inconsistente com a ancora; descartado.',
        {
          esperado:
            state.map.mapLayoutAddress,

          obtido:
            anchored?.mapLayoutAddress ?? null,

          tentativa:
            this.worldCatalogBuildFailures,
        },
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
      !this.isFireRedFamily(state) ||
      state.map.mapLayoutAddress === 0 ||
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

    if (existing) {
      return;
    }

    const definition: MapDefinition = {
      mapGroup: state.map.mapGroup,
      mapNumber: state.map.mapNumber,
      // Este caminho monta a definicao a partir do estado vivo, que nao
      // carrega nem o tipo nem o bloco de borda; sem endereco, o
      // renderizador apenas nao desenha padding neste mapa.
      mapType: 0,
      borderAddress: 0,
      borderWidth: 2,
      borderHeight: 2,
      mapLayoutId: state.map.mapLayoutId,
      mapHeaderAddress: state.map.mapHeaderAddress,
      mapLayoutAddress: state.map.mapLayoutAddress,
      mapDataAddress: state.map.mapDataAddress,
      primaryTilesetAddress:
        state.map.primaryTilesetAddress,
      secondaryTilesetAddress:
        state.map.secondaryTilesetAddress,
      width: state.map.width,
      height: state.map.height,
      worldX: 0,
      worldY: 0,
      connections: [],
    };

    this.mapCatalog.register(
      definition,
    );
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

  /**
   * Posiciona o mundo em torno do mapa atual.
   *
   * O descarte das posicoes anteriores e OBRIGATORIO e nao pode ser
   * removido: cada mundo (exterior conectado, interior de casa, centro
   * pokemon) vive em um espaco de coordenadas proprio, todos ancorados
   * perto da origem. Se as posicoes antigas sobrevivem, o mundo anterior
   * continua visivel e ocupa as mesmas coordenadas do novo - os planos
   * ficam coplanares e o resultado e z-fighting (faixas horizontais e
   * triangulos pretos) com o mapa errado na tela no lugar do interior.
   *
   * Quem evita a reconstrucao desnecessaria ao andar entre mapas
   * conectados e o chamador: buildFrom ja posiciona os vizinhos, entao
   * mapas conectados caem em hasPosition() e nunca chegam aqui.
   */
  private rebuildWorldAround(
    state: GameState,
  ): void {
    this.buildQueue.length =
      0;

    this.queuedMaps.clear();

    this.mapWorld.clearPositions();

    this.mapWorld.buildFrom(
      state.map.mapGroup,
      state.map.mapNumber,
    );

    if (
      !this.mapWorld.hasPosition(
        state.map.mapGroup,
        state.map.mapNumber,
      )
    ) {
      // Mapa isolado (sem conexoes resolviveis): ancora na origem para
      // que ao menos ele apareca, em vez de ficar a cena vazia.
      this.mapWorld.setWorldPosition(
        state.map.mapGroup,
        state.map.mapNumber,
        {
          x: 0,
          y: 0,
        },
      );
    }
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

    const sameMap =
      mapKey === this.activeMapKey;

    const positioned =
      this.mapWorld.hasPosition(
        state.map.mapGroup,
        state.map.mapNumber,
      );

    const catalogHasMap =
      this.mapCatalog.get(
        state.map.mapGroup,
        state.map.mapNumber,
      ) !== null;

    // Nada mudou e o mundo ja esta montado: nao ha o que fazer.
    // Esta e a saida do caso comum, avaliado a cada frame.
    if (
      sameMap &&
      positioned
    ) {
      return;
    }

    // Mesmo mapa, mundo ainda nao posicionado: e o primeiro carregamento,
    // em que o catalogo so fica pronto alguns frames depois do estado.
    // Enquanto o catalogo nao chega nao da para montar nada; assim que
    // chega, seguimos para a montagem normal abaixo - antes isto retornava
    // cedo e o mapa so aparecia quando o jogador trocava de rota.
    if (
      sameMap &&
      !catalogHasMap
    ) {
      return;
    }

    this.activeMapKey =
      mapKey;

    if (
      !positioned
    ) {
      this.rebuildWorldAround(
        state,
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

    this.rebuildWorldBorder(
      maps,
      activeMap,
    );

    console.log(
      'Active World:',
      {
        maps:
          maps.length,

        current:
          mapKey,

        rebuilt:
          !positioned,
      },
    );
  }

  /**
   * Monta o padding do mundo: um plano por mapa posicionado, cada um
   * usando o PROPRIO bloco de borda daquele mapa.
   *
   * Por que nao um plano unico para o mundo inteiro (versao anterior):
   * cada mapa define a sua borda. Mauville usa grama, uma rota de mar usa
   * agua, uma area rochosa usa pedra. Pintar o mundo todo com a borda do
   * mapa ativo acerta ao redor do jogador e erra em todo o resto - era o
   * que deixava faixas de agua em volta de areas de terra.
   *
   * Por que os planos nao brigam por profundidade: cada um recebe um y
   * ligeiramente diferente, ordenado pela distancia ate o mapa ativo. O
   * mais proximo fica por cima, entao a regiao em volta do jogador sempre
   * mostra a borda correta, e nunca ha dois planos coplanares - que foi a
   * causa do z-fighting em 597e1b2.
   */
  private rebuildWorldBorder(
    maps: MapDefinition[],
    activeMap: MapDefinition | null,
  ): void {
    this.disposeWorldBorder();

    // Interior, caverna e base secreta nao recebem padding: no jogo
    // original o que existe fora deles e preto mesmo.
    if (
      !activeMap ||
      !this.mapAcceptsPadding(activeMap)
    ) {
      return;
    }

    const activePosition =
      this.mapWorld.getWorldPosition(
        activeMap.mapGroup,
        activeMap.mapNumber,
      );

    if (!activePosition) {
      return;
    }

    const activeCenterX =
      activePosition.x + activeMap.width / 2;

    const activeCenterZ =
      activePosition.y + activeMap.height / 2;

    interface PaddingCandidate {
      map: MapDefinition;
      centerX: number;
      centerZ: number;
      distance: number;
    }

    const candidates: PaddingCandidate[] = [];

    for (
      const map of maps
    ) {
      if (
        !this.mapAcceptsPadding(map)
      ) {
        continue;
      }

      const position =
        this.mapWorld.getWorldPosition(
          map.mapGroup,
          map.mapNumber,
        );

      if (!position) {
        continue;
      }

      const centerX =
        position.x + map.width / 2;

      const centerZ =
        position.y + map.height / 2;

      candidates.push({
        map,
        centerX,
        centerZ,
        distance:
          Math.hypot(
            centerX - activeCenterX,
            centerZ - activeCenterZ,
          ),
      });
    }

    // Mais distante primeiro: o mais proximo do jogador e desenhado por
    // cima e manda na aparencia da area visivel.
    candidates.sort(
      (left, right) =>
        right.distance - left.distance,
    );

    candidates.forEach(
      (candidate, index) => {
        const mesh =
          this.buildPaddingPlane(
            candidate.map,
            candidate.centerX,
            candidate.centerZ,
            -0.4 + index * 0.002,
          );

        if (mesh) {
          this.worldBorderMeshes.push(mesh);
          this.root.add(mesh);
        }
      },
    );
  }

  private mapAcceptsPadding(
    map: MapDefinition,
  ): boolean {
    return (
      OUTDOOR_MAP_TYPES.has(
        map.mapType,
      ) &&
      map.borderAddress !== 0 &&
      map.borderWidth > 0 &&
      map.borderHeight > 0
    );
  }

  /**
   * Plano de padding de um mapa: area do mapa expandida por
   * MAP_PADDING_METATILES, preenchida com o bloco de borda repetido.
   *
   * A textura gerada e apenas o bloco de borda (tipicamente 2x2
   * metatiles); a repeticao fica por conta da GPU via RepeatWrapping.
   * Gerar um bitmap do tamanho da area preenchida seria inviavel para os
   * mapas grandes.
   */
  private buildPaddingPlane(
    map: MapDefinition,
    centerX: number,
    centerZ: number,
    y: number,
  ): THREE.Mesh | null {
    const borderMetatileIds =
      this.readBorderMetatileIds(
        map,
      );

    if (
      borderMetatileIds.length === 0
    ) {
      return null;
    }

    const blockWidth =
      map.borderWidth * GBA_METATILE_PIXELS;

    const blockHeight =
      map.borderHeight * GBA_METATILE_PIXELS;

    const pixels =
      new Uint8ClampedArray(
        blockWidth * blockHeight * 4,
      );

    let painted = false;

    for (
      let tileY = 0;
      tileY < map.borderHeight;
      tileY++
    ) {
      for (
        let tileX = 0;
        tileX < map.borderWidth;
        tileX++
      ) {
        const metatileId =
          borderMetatileIds[
            tileY * map.borderWidth + tileX
          ];

        if (metatileId === undefined) {
          continue;
        }

        const graphics =
          this.stateAdapter.getMetatileGraphics(
            metatileId,
          );

        if (!graphics) {
          continue;
        }

        painted = true;

        for (
          let sourceY = 0;
          sourceY < GBA_METATILE_PIXELS;
          sourceY++
        ) {
          for (
            let sourceX = 0;
            sourceX < GBA_METATILE_PIXELS;
            sourceX++
          ) {
            const sourceOffset =
              (sourceY * GBA_METATILE_PIXELS + sourceX) * 4;

            const destinationY =
              (map.borderHeight - 1 - tileY) *
                GBA_METATILE_PIXELS +
              GBA_METATILE_PIXELS - 1 - sourceY;

            const destinationX =
              tileX * GBA_METATILE_PIXELS + sourceX;

            const destinationOffset =
              (destinationY * blockWidth + destinationX) * 4;

            pixels[destinationOffset] =
              graphics.basePixels[sourceOffset];

            pixels[destinationOffset + 1] =
              graphics.basePixels[sourceOffset + 1];

            pixels[destinationOffset + 2] =
              graphics.basePixels[sourceOffset + 2];

            pixels[destinationOffset + 3] =
              graphics.basePixels[sourceOffset + 3];
          }
        }
      }
    }

    if (!painted) {
      return null;
    }

    const planeWidth =
      map.width + MAP_PADDING_METATILES * 2;

    const planeHeight =
      map.height + MAP_PADDING_METATILES * 2;

    const texture =
      this.createMapTexture(
        pixels,
        blockWidth,
        blockHeight,
      );

    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;

    texture.repeat.set(
      planeWidth / map.borderWidth,
      planeHeight / map.borderHeight,
    );

    texture.needsUpdate = true;

    const geometry =
      new THREE.PlaneGeometry(
        planeWidth,
        planeHeight,
      );

    const mesh =
      new THREE.Mesh(
        geometry,
        new THREE.MeshBasicMaterial({
          map: texture,
          transparent: false,
          depthWrite: true,
          side: THREE.DoubleSide,
        }),
      );

    mesh.rotation.x = -Math.PI / 2;

    mesh.position.set(
      centerX,
      y,
      centerZ,
    );

    mesh.renderOrder = -10;

    return mesh;
  }

  private disposeWorldBorder(): void {
    for (
      const mesh of this.worldBorderMeshes
    ) {
      this.root.remove(mesh);

      const material =
        mesh.material;

      if (Array.isArray(material)) {
        material.forEach(
          entry => {
            (entry as THREE.MeshBasicMaterial).map?.dispose();
            entry.dispose();
          },
        );
      } else {
        (material as THREE.MeshBasicMaterial).map?.dispose();
        material.dispose();
      }

      mesh.geometry.dispose();
    }

    this.worldBorderMeshes.length = 0;
  }

  /**
   * Aponta a animacao de tiles para o mapa ativo. So um mapa anima por vez:
   * registrar o mundo inteiro foi o que derrubou a versao anterior.
   */
  private syncTileAnimation(
    mapKey: string,
    activeMap: MapDefinition | null,
  ): void {
    if (!activeMap) {
      this.tileAnimator.clear();

      return;
    }

    const visual =
      this.mapVisuals.get(
        mapKey,
      );

    if (!visual) {
      // O visual ainda esta na fila; na proxima passagem ele existe.
      return;
    }

    this.tileAnimator.setActiveMap(
      mapKey,
      activeMap,
      visual.metatileIds,
      visual.baseTexture,
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

  /**
   * Le os metatiles do bloco de borda do layout, direto do ROM.
   * Devolve lista vazia quando o layout nao tem borda utilizavel - nesse
   * caso o mapa simplesmente nao ganha padding.
   */
  private readBorderMetatileIds(
    map: MapDefinition,
  ): number[] {
    if (
      map.borderAddress === 0 ||
      map.borderWidth <= 0 ||
      map.borderHeight <= 0
    ) {
      return [];
    }

    const count =
      map.borderWidth *
      map.borderHeight;

    const offset =
      map.borderAddress -
      GBA_ROM_BASE_ADDRESS;

    if (
      offset < 0 ||
      offset + count * 2 >
        this.romBytes.length
    ) {
      return [];
    }

    const ids: number[] = [];

    for (
      let index = 0;
      index < count;
      index++
    ) {
      const value =
        this.romBytes[offset + index * 2] |
        (this.romBytes[offset + index * 2 + 1] << 8);

      ids.push(
        value & METATILE_ID_MASK,
      );
    }

    return ids;
  }

  private buildMapVisual(
    map: MapDefinition,
  ): void {
    type MapRenderData =
      NonNullable<
        ReturnType<
          Gen3StateAdapter['getMapRenderData']
        >
      >;

    let renderData:
      MapRenderData | null =
      null;

    // Metatiles do bloco de borda, lidos direto do ROM. Sao u16 em
    // sequencia; os 10 bits baixos identificam o metatile.
    const borderMetatileIds =
      this.readBorderMetatileIds(
        map,
      );

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
              borderMetatileIds,
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

    const metatileIds =
      new Uint16Array(
        map.width * map.height,
      );

    for (
      let index = 0;
      index < metatileIds.length;
      index++
    ) {
      metatileIds[index] =
        renderData.blocks[index]?.metatileId ?? 0;
    }

    const visual:
      MapVisual = {
        baseMesh,
        overlayMesh,
        basePixels: pixels,
        metatileIds,
        baseTexture,
        overlayTexture,
        geometry,
        mapDataAddress:
          map.mapDataAddress,
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

    // A camera acompanha o jogador de forma rigida. Antes havia uma
    // interpolacao exponencial (fator 0.12 por frame) que fazia a camera
    // "escorregar" atras do personagem a cada passo - o balanco que
    // aparecia sempre que o jogador se movia.
    this.camera.position.x =
      cameraTargetX;

    this.camera.position.y =
      cameraTargetY;

    this.camera.position.z =
      cameraTargetZ;

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

      this.currentState =
        state;

      this.ensureWorldCatalog(
        state,
      );

      if (
        this.isFireRedFamily(state)
      ) {
        this.ensureFireRedCinnabarDefinition(
          state,
        );

        this.ensureCurrentMapDefinition(
          state,
        );

        this.updateActiveWorld(
          state,
        );
      } else if (
        this.worldCatalogBuilt
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

      // Registro da animacao roda TODO FRAME, nao so na troca de mapa.
      // Preso no fim de updateActiveWorld ele nunca pegava: naquele
      // instante o visual do mapa ainda esta na fila de construcao, entao
      // a tentativa falhava, e updateActiveWorld sai cedo nos frames
      // seguintes - a animacao nunca chegava a ser registrada.
      // Aqui a tentativa se repete ate o visual existir; depois disso
      // setActiveMap sai de imediato, entao o custo e desprezivel.
      this.syncTileAnimation(
        this.createMapKey(
          state.map.mapGroup,
          state.map.mapNumber,
        ),
        this.mapCatalog.get(
          state.map.mapGroup,
          state.map.mapNumber,
        ),
      );

      this.tileAnimator.update();

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

    this.disposeWorldBorder();

    this.tileAnimator.clear();

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