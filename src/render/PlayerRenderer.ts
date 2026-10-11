import * as THREE from 'three';

// Teto de tentativas de montagem do catalogo e intervalo entre elas.
// Sem isso a montagem (que varre o ROM inteiro) era refeita a cada frame
// enquanto falhasse, travando a thread principal.
// Quantos metatiles de borda desenhar em volta do mapa ativo.
// Alcance do padding alem da borda de cada mapa. Calculado pela camera:
// altura 10, recuo 11, fov 48 -> o raio do topo da tela toca o chao ~20
// tiles ao norte do jogador, e as laterais da tela larga vao alem disso.
// Com 12 o horizonte ficava escuro. A repeticao e feita pela GPU
// (RepeatWrapping), entao alcance maior quase nao custa.
const MAP_PADDING_METATILES =
  40;

// Altura do padding: logo abaixo do chao. Antes ficava em -0.4, e vista a
// 42 graus essa queda deslocava o padding ~0.44 tile para tras da borda
// do mapa - uma costura visivel. A precisao do z-buffer nessa distancia
// (~1e-4) permite degraus de 0.002 entre planos.
const PADDING_TOP_Y =
  -0.02;

const PADDING_STEP_Y =
  0.002;

// Movimento suave das entidades: o jogo move o sprite 1 tile em 16 quadros
// (60 fps) ao caminhar. As coordenadas na RAM pulam para o tile de destino
// no INICIO do passo; o sprite percorre o caminho nesse tempo.
// Desligar (false) volta ao comportamento antigo de pular de tile em tile.
const SMOOTH_ENTITY_MOVEMENT =
  true;

// Reconstrucao 2.5D (dobra de casas, arvores, cercas, ledges).
// false volta ao mapa plano.
const VOXEL_FOLDING =
  true;

// Altura maxima da fachada, em blocos. 2 reproduz bem casas da Gen 3
// (telhado ~2 linhas + fachada ~2 linhas).
const VOXEL_MAX_WALL_ROWS =
  2;

const WALK_TILES_PER_SECOND =
  60 / 16;

// Distancia acima da qual nao ha caminhada possivel: warp, porta,
// reconstrucao do mundo. Teleporta em vez de deslizar.
const ENTITY_SNAP_DISTANCE =
  3;

// Abaixo disto a entidade e considerada parada (animacao de pe).
const ENTITY_MOVING_EPSILON =
  0.02;

// Escala: 16 pixels do GBA = 1 tile = 1 unidade do mundo.
const PIXELS_PER_TILE =
  16;

// Tipos de mapa (offset 0x17 do cabecalho) que recebem padding.
// 1 TOWN, 2 CITY, 3 ROUTE, 5 UNDERWATER, 6 OCEAN_ROUTE.
// Ficam de fora 4 UNDERGROUND, 8 INDOOR e 9 SECRET_BASE: no jogo original
// o espaco fora desses mapas e preto mesmo.
const INDOOR_MAP_TYPE =
  8;

const SECRET_BASE_MAP_TYPE =
  9;

const OUTDOOR_MAP_TYPES =
  new Set<number>([1, 2, 3, 5, 6]);

const GBA_ROM_BASE_ADDRESS =
  0x08000000;

const METATILE_ID_MASK =
  0x03ff;

// Teto alto de proposito: com a espera por ancora plausivel acima, uma
// tentativa so e gasta quando ha dado real para tentar. Parar cedo foi o
// que deixou a Perfect Fire Red sem catalogo.
const MAX_CATALOG_BUILD_ATTEMPTS =
  60;

const CATALOG_BUILD_RETRY_MS =
  250;

import type {
  Gen3StateAdapter,
  Gen3MetatileGraphics,
} from '../gen3/Gen3StateAdapter';

import type {
  Direction,
  GameState,
} from '../gen3/GameState';

import {
  TileAnimator,
} from './TileAnimator';

import {
  buildFoldGeometry,
  computeFoldMask,
} from './VoxelFolding';

import {
  buildPadding,
  isBorderRaised,
  type PaddingMapInput,
} from './PaddingBuilder';

import {
  OverworldSprites,
  type SpriteFrame,
} from '../gen3/OverworldSprites';

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

interface EntityVisual {
  mesh: THREE.Mesh;
  frameKey: string;
  geometryKey: string;

  // Posicao exibida (suavizada) e alvo (tile atual na RAM).
  displayX: number;
  displayZ: number;
  targetX: number;
  targetZ: number;

  moving: boolean;
  walkStartedAt: number;
}

interface MapVisual {
  baseMesh: THREE.Mesh;
  overlayMesh: THREE.Mesh;

  // Ids de metatile por bloco, para a animacao de tiles montar suas
  // receitas. Uint16Array (2 bytes por bloco) em vez da lista de objetos.
  metatileIds: Uint16Array;

  baseTexture:
    THREE.DataTexture;

  overlayTexture:
    THREE.DataTexture;

  geometry:
    THREE.PlaneGeometry;

  // Volume reconstruido (paredes e tetos), mesmas texturas do mapa.
  voxelGroup?:
    THREE.Group;

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

  // Bloco de borda de cada mapa, em textura com repeticao.
  private readonly borderTextures =
    new Map<string, THREE.DataTexture>();

  // O padding de cada mapa sobe com a dobra? (ver isBorderRaised)
  private readonly paddingRaised =
    new Map<string, boolean>();

  // Textura de borda ou elevacao de algum mapa chegou depois da ultima
  // montagem do padding (os mapas sao construidos ao longo de varios
  // quadros): refazer no proximo quadro.
  private paddingDirty = false;

  private readonly tileAnimator:
    TileAnimator;

  // Sprites do overworld lidos do ROM (jogador, NPCs, caminhao, itens).
  private readonly overworldSprites:
    OverworldSprites;

  // Um visual por slot de ObjectEvent, reaproveitado entre frames.
  private readonly entityVisuals =
    new Map<number, EntityVisual>();

  private playerVisual:
    EntityVisual | null = null;

  private readonly spriteTextures =
    new Map<string, THREE.DataTexture>();

  private readonly spriteGeometries =
    new Map<string, THREE.PlaneGeometry>();

  private lastFrameAt = 0;

  private frameDeltaMs = 0;


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

    this.overworldSprites =
      new OverworldSprites(
        romBytes,
      );

    this.tileAnimator =
      new TileAnimator(
        stateAdapter.getMemoryReader(),
        stateAdapter,
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

  /**
   * O jogo esta no overworld, com o mapa que o 3D esta mostrando? Fora
   * disso (batalha, menus de tela cheia, titulo) a interface mostra a tela
   * do GBA inteira por cima.
   */
  isOverworldVisible(): boolean {
    return (
      this.worldCatalogBuilt &&
      this.tileAnimator.isShowingMap()
    );
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

    // Nao gastar tentativa enquanto a ancora nao for plausivel.
    //
    // Era aqui que a Perfect Fire Red voltava a quebrar: logo apos
    // carregar, a RAM do emulador ainda nao tem dado valido, e cada
    // avaliacao consumia uma das 8 tentativas. Com a Perfect demorando
    // mais para estabilizar, as tentativas acabavam ANTES de a RAM ficar
    // boa, o catalogo nunca era montado e caiam junto conexao de mapas e
    // Cinnabar. Carregar o Emerald antes mascarava isso porque a segunda
    // carga estabiliza mais rapido.
    //
    // Um ponteiro de layout fora da faixa do ROM e sinal claro de RAM
    // ainda fria: esperar nao conta como tentativa.
    if (
      state.map.mapLayoutAddress < GBA_ROM_BASE_ADDRESS ||
      state.map.mapLayoutAddress - GBA_ROM_BASE_ADDRESS >=
        this.romBytes.length
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

    // Divergencia entre o layout da ancora (RAM) e o do cabecalho NAO
    // invalida o catalogo: a tabela vem da estrutura do ROM, e a Gen 3
    // carrega o layout do mapa atual a partir do save (mapLayoutId), que
    // pode ser outro (setmaplayoutindex). Medido na Perfect Fire Red em
    // Cinnabar. Antes isto descartava o catalogo a cada tentativa, e com
    // ele todas as conexoes; agora syncActiveMapLayout usa o layout vivo
    // so no mapa ativo.
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

  /**
   * Usa o layout que o JOGO esta usando para o mapa ativo.
   *
   * Na Gen 3 o layout do mapa atual vem do save (mapLayoutId ->
   * gMapLayouts), nao do cabecalho: scripts trocam o visual de um mapa com
   * setmaplayoutindex. Medido na Perfect Fire Red: o cabecalho de Cinnabar
   * (3:8) aponta para o layout 0x082E3B20, mas o save usa 0x08338738 - e
   * a ilha na tela do GBA e a do layout do save. Antes, essa divergencia
   * fazia o catalogo inteiro ser descartado (sem conexoes) ou, com os
   * remendos antigos so para 3:8 no FRLG, o mapa errado aparecia.
   *
   * Agora vale para qualquer mapa e qualquer jogo: a definicao do mapa
   * ativo recebe o layout vivo (mantendo as conexoes do cabecalho) e o
   * visual e reconstruido se ja tinha sido montado com o layout antigo.
   */
  private syncActiveMapLayout(
    state: GameState,
  ): void {
    const live =
      state.map;

    if (
      !this.worldCatalogBuilt ||
      live.mapLayoutAddress < GBA_ROM_BASE_ADDRESS ||
      live.mapLayoutAddress - GBA_ROM_BASE_ADDRESS >= this.romBytes.length ||
      live.width <= 0 ||
      live.height <= 0 ||
      live.mapDataAddress === 0 ||
      live.primaryTilesetAddress === 0 ||
      live.secondaryTilesetAddress === 0
    ) {
      return;
    }

    const key =
      this.createMapKey(live.mapGroup, live.mapNumber);

    let definition =
      this.mapCatalog.get(live.mapGroup, live.mapNumber);

    if (!definition) {
      return;
    }

    if (definition.mapLayoutAddress !== live.mapLayoutAddress) {
      const border =
        this.mapCatalog.readLayoutBorder(
          this.romBytes,
          live.mapLayoutAddress,
          this.isFireRedFamily(state),
        );

      const resized =
        definition.width !== live.width ||
        definition.height !== live.height;

      definition = {
        ...definition,
        mapLayoutId: live.mapLayoutId,
        mapLayoutAddress: live.mapLayoutAddress,
        mapDataAddress: live.mapDataAddress,
        primaryTilesetAddress: live.primaryTilesetAddress,
        secondaryTilesetAddress: live.secondaryTilesetAddress,
        width: live.width,
        height: live.height,
        borderAddress: border.borderAddress,
        borderWidth: border.borderWidth,
        borderHeight: border.borderHeight,
      };

      this.mapCatalog.register(definition);

      console.log(
        '[mapa]',
        key,
        'usa o layout do save (0x' + live.mapLayoutAddress.toString(16) +
          '), diferente do padrao do cabecalho.',
      );

      // Outro tamanho muda a posicao dos vizinhos: remonta o mundo.
      if (resized) {
        this.mapWorld.clearPositions();
        this.activeMapKey = '';
      }

      this.borderTextures.get(key)?.dispose();
      this.borderTextures.delete(key);
      this.paddingDirty = true;
    }

    const visual =
      this.mapVisuals.get(key);

    if (
      !visual ||
      visual.mapDataAddress === definition.mapDataAddress
    ) {
      return;
    }

    this.root.remove(visual.baseMesh);
    this.root.remove(visual.overlayMesh);

    visual.baseTexture.dispose();
    visual.overlayTexture.dispose();
    visual.geometry.dispose();
    visual.overlayMesh.geometry.dispose();

    this.disposeVoxelGroup(visual);

    for (const mesh of [visual.baseMesh, visual.overlayMesh]) {
      const material = mesh.material;

      if (Array.isArray(material)) {
        material.forEach(entry => entry.dispose());
      } else {
        material.dispose();
      }
    }

    this.mapVisuals.delete(key);
    this.tileAnimator.clear();

    this.queuedMaps.delete(key);
    this.buildQueue.push(definition);
    this.queuedMaps.add(key);
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
    this.syncActiveMapLayout(
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
   * Padding do mundo (ver PaddingBuilder): o espaco vazio em volta dos
   * mapas e dividido entre eles - cada celula fica com o mapa mais proximo
   * e recebe a borda DELE, alinhada como no GBA. Sem sobreposicao entre
   * mapas, sem buraco entre eles. Borda de arvores sobe na altura da dobra.
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

    const inputs: PaddingMapInput[] = [];
    const definitions = new Map<string, MapDefinition>();

    for (
      const map of maps
    ) {
      const position =
        this.mapWorld.getWorldPosition(
          map.mapGroup,
          map.mapNumber,
        );

      if (!position) {
        continue;
      }

      const key =
        this.createMapKey(
          map.mapGroup,
          map.mapNumber,
        );

      definitions.set(key, map);

      inputs.push({
        key,
        x: position.x,
        z: position.y,
        width: map.width,
        height: map.height,
        borderWidth: Math.max(1, map.borderWidth),
        borderHeight: Math.max(1, map.borderHeight),
        spreads: this.mapAcceptsPadding(map),
        raised: this.paddingRaised.get(key) ?? false,
      });
    }

    const meshes =
      buildPadding(
        inputs,
        MAP_PADDING_METATILES,
        VOXEL_MAX_WALL_ROWS,
      );

    for (
      const data of meshes
    ) {
      const map =
        definitions.get(data.key);

      // Textura existe quando o visual do mapa ja foi construido; se
      // ainda nao, o padding e refeito quando ele ficar pronto.
      const texture =
        map
          ? this.borderTextures.get(data.key) ?? null
          : null;

      if (!texture) {
        continue;
      }

      const geometry =
        new THREE.BufferGeometry();

      geometry.setAttribute(
        'position',
        new THREE.BufferAttribute(data.positions, 3),
      );

      geometry.setAttribute(
        'uv',
        new THREE.BufferAttribute(data.uvs, 2),
      );

      geometry.setIndex(
        new THREE.BufferAttribute(data.indices, 1),
      );

      const mesh =
        new THREE.Mesh(
          geometry,
          new THREE.MeshBasicMaterial({
            map: texture,
            side: THREE.DoubleSide,
          }),
        );

      // Um pouco abaixo do chao dos mapas: as celulas de padding nunca
      // coincidem com um mapa, mas a margem evita costura na emenda.
      mesh.position.y = -0.02;
      mesh.renderOrder = -10;

      this.worldBorderMeshes.push(mesh);
      this.root.add(mesh);
    }
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
   * Textura do bloco de borda de um mapa (tipicamente 2x2 metatiles), com
   * RepeatWrapping: a repeticao fica na GPU, pelas UVs do PaddingBuilder.
   *
   * Montada em buildMapVisual a partir dos graficos DAQUELE mapa (o
   * renderData ja resolve os metatiles da borda com os tilesets dele).
   * Antes usava getMetatileGraphics, que le dos tilesets do mapa ATIVO:
   * vizinho com outro tileset secundario saia com a borda errada.
   */
  private buildBorderTexture(
    key: string,
    map: MapDefinition,
    graphicsById: ReadonlyMap<number, Gen3MetatileGraphics | null>,
  ): void {
    if (this.borderTextures.has(key)) {
      return;
    }

    const borderMetatileIds =
      this.readBorderMetatileIds(
        map,
      );

    let texture: THREE.DataTexture | null = null;

    if (borderMetatileIds.length > 0) {
      const blockWidth =
        map.borderWidth * GBA_METATILE_PIXELS;

      const blockHeight =
        map.borderHeight * GBA_METATILE_PIXELS;

      const pixels =
        new Uint8ClampedArray(
          blockWidth * blockHeight * 4,
        );

      let painted = false;

      for (let tileY = 0; tileY < map.borderHeight; tileY++) {
        for (let tileX = 0; tileX < map.borderWidth; tileX++) {
          const graphics =
            graphicsById.get(
              borderMetatileIds[tileY * map.borderWidth + tileX],
            );

          if (!graphics) {
            continue;
          }

          painted = true;

          for (let sourceY = 0; sourceY < GBA_METATILE_PIXELS; sourceY++) {
            for (let sourceX = 0; sourceX < GBA_METATILE_PIXELS; sourceX++) {
              const sourceOffset =
                (sourceY * GBA_METATILE_PIXELS + sourceX) * 4;

              // Mesma inversao vertical das texturas de mapa.
              const destinationY =
                (map.borderHeight - 1 - tileY) * GBA_METATILE_PIXELS +
                GBA_METATILE_PIXELS - 1 - sourceY;

              const destinationOffset =
                (destinationY * blockWidth +
                  tileX * GBA_METATILE_PIXELS + sourceX) * 4;

              for (let channel = 0; channel < 4; channel++) {
                pixels[destinationOffset + channel] =
                  graphics.basePixels[sourceOffset + channel];
              }
            }
          }
        }
      }

      if (painted) {
        texture =
          this.createMapTexture(
            pixels,
            blockWidth,
            blockHeight,
          );

        texture.wrapS = THREE.RepeatWrapping;
        texture.wrapT = THREE.RepeatWrapping;
        texture.needsUpdate = true;
      }
    }

    if (texture) {
      this.borderTextures.set(key, texture);

      // O padding foi montado antes deste mapa existir: refaz.
      this.paddingDirty = true;
    }
  }

  private disposeWorldBorder(): void {
    for (
      const mesh of this.worldBorderMeshes
    ) {
      this.root.remove(mesh);

      // A textura fica: e compartilhada pelo cache de bordas.
      (mesh.material as THREE.Material).dispose();
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
      visual.overlayTexture,
    );
  }

  /**
   * NPCs e demais entidades do overworld (caminhao do Emerald, itens,
   * Pokemon de overworld), com o sprite real do ROM.
   */
  private updateEntities(
    state: GameState,
  ): void {
    const now =
      performance.now();

    const seen =
      new Set<number>();

    for (
      const object of state.objects
    ) {
      // O jogador tem visual proprio (updatePlayer) e a camera presa nele.
      if (object.isPlayer) {
        continue;
      }

      // So entidades do mapa onde o jogador esta: as coordenadas sao
      // relativas a ele.
      if (
        object.mapGroup !== state.map.mapGroup ||
        object.mapNumber !== state.map.mapNumber
      ) {
        continue;
      }

      const target =
        this.getEntityWorldPosition(
          state,
          object.x,
          object.y,
        );

      if (!target) {
        continue;
      }

      seen.add(object.id);

      let visual =
        this.entityVisuals.get(object.id) ?? null;

      visual =
        this.updateSpriteVisual(
          visual,
          object.graphicsId ?? 0,
          (object.direction as Direction | undefined) ?? 'DOWN',
          target.x,
          target.z,
          now,
        );

      if (visual) {
        this.entityVisuals.set(object.id, visual);
        visual.mesh.visible = true;
      }
    }

    for (
      const [id, visual] of this.entityVisuals
    ) {
      if (!seen.has(id)) {
        visual.mesh.visible = false;
      }
    }

    // Sprites voltados para a camera (inclusive o do jogador).
    for (
      const visual of this.entityVisuals.values()
    ) {
      visual.mesh.quaternion.copy(this.camera.quaternion);
    }

    if (this.playerVisual) {
      this.playerVisual.mesh.quaternion.copy(this.camera.quaternion);
    }
  }

  /**
   * Cria ou atualiza o visual de uma entidade: quadro do sprite, posicao
   * suavizada e animacao de caminhada. Devolve null se o sprite nao puder
   * ser resolvido (o chamador decide o fallback).
   */
  private updateSpriteVisual(
    visual: EntityVisual | null,
    graphicsId: number,
    direction: Direction,
    targetX: number,
    targetZ: number,
    now: number,
  ): EntityVisual | null {
    // ---- posicao ----
    if (visual) {
      visual.targetX = targetX;
      visual.targetZ = targetZ;

      const dx = targetX - visual.displayX;
      const dz = targetZ - visual.displayZ;
      const distance = Math.hypot(dx, dz);

      if (
        !SMOOTH_ENTITY_MOVEMENT ||
        distance > ENTITY_SNAP_DISTANCE
      ) {
        visual.displayX = targetX;
        visual.displayZ = targetZ;
      } else if (distance > 0) {
        // Velocidade de caminhada; se ficar para tras (corrida, bike),
        // acelera proporcionalmente para nunca acumular atraso.
        const step =
          (WALK_TILES_PER_SECOND * Math.max(1, distance) *
            this.frameDeltaMs) / 1000;

        if (step >= distance) {
          visual.displayX = targetX;
          visual.displayZ = targetZ;
        } else {
          visual.displayX += (dx / distance) * step;
          visual.displayZ += (dz / distance) * step;
        }
      }
    }

    const displayX = visual ? visual.displayX : targetX;
    const displayZ = visual ? visual.displayZ : targetZ;

    const moving =
      Math.hypot(targetX - displayX, targetZ - displayZ) >
      ENTITY_MOVING_EPSILON;

    if (visual && moving && !visual.moving) {
      visual.walkStartedAt = now;
    }

    // ---- quadro ----
    const frame =
      this.overworldSprites.getFrame(
        graphicsId,
        direction,
        moving,
        visual ? now - visual.walkStartedAt : 0,
      );

    if (!frame) {
      return visual;
    }

    const texture =
      this.getSpriteTexture(frame);

    const geometryKey =
      frame.width + 'x' + frame.height;

    if (!visual) {
      const material =
        new THREE.MeshBasicMaterial({
          map: texture,
          transparent: true,
          // Recorte por pixel: borda nitida e profundidade correta entre
          // sprites sobrepostos.
          alphaTest: 0.5,
          side: THREE.DoubleSide,
        });

      const mesh =
        new THREE.Mesh(
          this.getSpriteGeometry(frame),
          material,
        );

      // Depois do mapa (0) e da camada de cima (2): a camada de cima e
      // desenhada sem teste de profundidade e cobriria o sprite.
      mesh.renderOrder = 3;

      this.root.add(mesh);

      visual = {
        mesh,
        frameKey: frame.key,
        geometryKey,
        displayX: targetX,
        displayZ: targetZ,
        targetX,
        targetZ,
        moving: false,
        walkStartedAt: now,
      };
    } else {
      if (visual.frameKey !== frame.key) {
        (visual.mesh.material as THREE.MeshBasicMaterial).map = texture;
        visual.frameKey = frame.key;
      }

      // Bike e surf trocam o tamanho do sprite.
      if (visual.geometryKey !== geometryKey) {
        visual.mesh.geometry = this.getSpriteGeometry(frame);
        visual.geometryKey = geometryKey;
      }
    }

    visual.moving = moving;

    // Pes no chao, no centro do tile.
    visual.mesh.position.set(
      visual.displayX,
      0,
      visual.displayZ,
    );

    return visual;
  }

  private getSpriteTexture(
    frame: SpriteFrame,
  ): THREE.DataTexture {
    const cached =
      this.spriteTextures.get(frame.key);

    if (cached) {
      return cached;
    }

    const texture =
      new THREE.DataTexture(
        frame.rgba,
        frame.width,
        frame.height,
        THREE.RGBAFormat,
        THREE.UnsignedByteType,
      );

    // Mesmos parametros das texturas de mapa.
    texture.magFilter = THREE.NearestFilter;
    texture.minFilter = THREE.NearestFilter;
    texture.generateMipmaps = false;
    texture.flipY = false;
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.needsUpdate = true;

    this.spriteTextures.set(frame.key, texture);

    return texture;
  }

  private getSpriteGeometry(
    frame: SpriteFrame,
  ): THREE.PlaneGeometry {
    const key =
      frame.width + 'x' + frame.height;

    const cached =
      this.spriteGeometries.get(key);

    if (cached) {
      return cached;
    }

    const width =
      frame.width / PIXELS_PER_TILE;

    const height =
      frame.height / PIXELS_PER_TILE;

    const geometry =
      new THREE.PlaneGeometry(width, height);

    // Origem na borda de baixo: os pes ficam no ponto de apoio e o sprite
    // inclina em volta deles ao encarar a camera.
    geometry.translate(0, height / 2, 0);

    this.spriteGeometries.set(key, geometry);

    return geometry;
  }

  private getEntityWorldPosition(
    state: GameState,
    tileX: number,
    tileY: number,
  ): { x: number; z: number } | null {
    const position =
      this.mapWorld.getWorldPosition(
        state.map.mapGroup,
        state.map.mapNumber,
      );

    if (!position) {
      return null;
    }

    return {
      x: position.x + tileX + 0.5,
      z: position.y + tileY + 0.5,
    };
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

      visual.voxelGroup?.position.set(
        position.x,
        0,
        position.y,
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

      if (visual.voxelGroup) {
        visual.voxelGroup.visible =
          visible;
      }

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

  /**
   * Volume 2.5D do mapa (ver VoxelFolding). Duas malhas sobre a MESMA
   * geometria: textura base e camada de cima, como o chao.
   */
  private disposeVoxelGroup(
    visual: MapVisual,
  ): void {
    if (!visual.voxelGroup) {
      return;
    }

    this.root.remove(visual.voxelGroup);

    const meshes =
      visual.voxelGroup.children as THREE.Mesh[];

    // As duas malhas compartilham a geometria.
    meshes[0]?.geometry.dispose();

    for (const mesh of meshes) {
      (mesh.material as THREE.Material).dispose();
    }

    visual.voxelGroup = undefined;
  }

  private buildVoxelGroup(
    map: MapDefinition,
    blocks: readonly { metatileId: number; collision: number; elevation: number }[],
    baseTexture: THREE.DataTexture,
    overlayTexture: THREE.DataTexture,
  ): THREE.Group | undefined {
    // Quem ganha volume: ver computeFoldMask (grupos impassaveis que
    // encostam em chao andavel; pedras no mar ficam planas).
    // Interiores ficam planos: parede de interior dobrada cobriria o
    // comodo inteiro diante da camera.
    if (
      map.mapType === INDOOR_MAP_TYPE ||
      map.mapType === SECRET_BASE_MAP_TYPE
    ) {
      return undefined;
    }

    const mask =
      computeFoldMask(
        map.width,
        map.height,
        (x, y) => blocks[y * map.width + x],
      );

    // A borda deste mapa sobe junto? Decide aqui, onde a mascara existe:
    // os metatiles da borda aparecem dentro do mapa e a dobra ja disse se
    // eles ganharam volume.
    const metatileIds =
      new Uint16Array(map.width * map.height);

    for (let index = 0; index < metatileIds.length; index++) {
      metatileIds[index] = blocks[index]?.metatileId ?? 0;
    }

    const raised =
      isBorderRaised(
        this.readBorderMetatileIds(map),
        metatileIds,
        mask,
      );

    const raisedKey =
      this.createMapKey(map.mapGroup, map.mapNumber);

    if (this.paddingRaised.get(raisedKey) !== raised) {
      this.paddingRaised.set(raisedKey, raised);
      this.paddingDirty = true;
    }

    const data =
      buildFoldGeometry(
        map.width,
        map.height,
        (x, y) => mask[y * map.width + x] === 1,
        VOXEL_MAX_WALL_ROWS,
      );

    if (data.quadCount === 0) {
      return undefined;
    }

    const geometry =
      new THREE.BufferGeometry();

    geometry.setAttribute(
      'position',
      new THREE.BufferAttribute(data.positions, 3),
    );

    geometry.setAttribute(
      'uv',
      new THREE.BufferAttribute(data.uvs, 2),
    );

    geometry.setIndex(
      new THREE.BufferAttribute(data.indices, 1),
    );

    const group =
      new THREE.Group();

    const base =
      new THREE.Mesh(
        geometry,
        new THREE.MeshBasicMaterial({
          map: baseTexture,
          transparent: true,
          alphaTest: 0.5,
          side: THREE.DoubleSide,
        }),
      );

    // Depois do chao, antes da camada de cima e dos sprites.
    base.renderOrder = 1;

    const overlay =
      new THREE.Mesh(
        geometry,
        new THREE.MeshBasicMaterial({
          map: overlayTexture,
          transparent: true,
          alphaTest: 0.5,
          side: THREE.DoubleSide,
          depthWrite: false,
          polygonOffset: true,
          polygonOffsetFactor: -1,
          polygonOffsetUnits: -4,
        }),
      );

    overlay.renderOrder = 2;

    group.add(base);
    group.add(overlay);

    return group;
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

    this.buildBorderTexture(
      this.createMapKey(map.mapGroup, map.mapNumber),
      map,
      renderData.graphics,
    );

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

    // A camada de cima do chao agora TESTA profundidade: com volume, sem
    // isso ela era pintada por cima das paredes. polygonOffset evita a
    // briga com o chao (estao a 0.002 de distancia).
    const overlayMaterial =
      new THREE.MeshBasicMaterial({
        map:
          overlayTexture,

        transparent:
          true,

        depthTest:
          true,

        depthWrite:
          false,

        polygonOffset:
          true,

        polygonOffsetFactor:
          -1,

        polygonOffsetUnits:
          -4,

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

    const voxelGroup =
      VOXEL_FOLDING
        ? this.buildVoxelGroup(
            map,
            renderData.blocks,
            baseTexture,
            overlayTexture,
          )
        : undefined;

    if (voxelGroup) {
      voxelGroup.position.set(
        position.x,
        0,
        position.y,
      );

      this.root.add(
        voxelGroup,
      );
    }

    const visual:
      MapVisual = {
        baseMesh,
        overlayMesh,
        metatileIds,
        baseTexture,
        overlayTexture,
        geometry,
        voxelGroup,
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
    const target =
      this.getPlayerWorldPosition(
        state,
      );

    // O proprio ObjectEvent do jogador traz o graphicsId atual: andando,
    // de bike, surfando, pescando - o sprite acompanha sozinho.
    const playerObject =
      state.objects.find(
        object => object.isPlayer,
      );

    if (playerObject) {
      this.playerVisual =
        this.updateSpriteVisual(
          this.playerVisual,
          playerObject.graphicsId ?? 0,
          state.player.direction,
          target.x,
          target.z,
          performance.now(),
        );
    }

    if (this.playerVisual) {
      this.player.visible = false;
      this.playerVisual.mesh.visible = true;

      // A camera segue a posicao EXIBIDA, presa ao sprite: o mundo rola
      // junto com o passo, como no GBA, sem atraso nem balanco.
      return {
        x: this.playerVisual.displayX,
        z: this.playerVisual.displayZ,
      };
    }

    // Sem sprite (ex.: Ruby/Sapphire ainda sem leitura de ObjectEvent):
    // mantem a caixa antiga como reserva.
    this.player.visible = true;
    this.player.position.x = target.x;
    this.player.position.z = target.z;

    const directionMap = {
      UP: -Math.PI / 2,
      DOWN: Math.PI / 2,
      LEFT: Math.PI,
      RIGHT: 0,
    } satisfies Record<string, number>;

    this.player.rotation.y =
      directionMap[state.player.direction] ?? 0;

    return target;
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

      const frameNow =
        performance.now();

      // Tempo desde o quadro anterior, limitado para a aba voltando do
      // segundo plano nao teleportar tudo de uma vez.
      this.frameDeltaMs =
        this.lastFrameAt === 0
          ? 0
          : Math.min(100, frameNow - this.lastFrameAt);

      this.lastFrameAt =
        frameNow;

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

      if (this.paddingDirty) {
        this.paddingDirty = false;

        this.rebuildWorldBorder(
          this.mapWorld.getPositionedMaps(),
          this.mapCatalog.get(
            state.map.mapGroup,
            state.map.mapNumber,
          ),
        );
      }

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
      // A animacao so entra depois do mundo montado. Durante a montagem
      // do catalogo ela nao disputa CPU - foi essa disputa que derrubou
      // conexao de mapas e Cinnabar na primeira tentativa de animacao.
      if (this.worldCatalogBuilt) {
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

        this.updateEntities(
          state,
        );
      }

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

    for (const texture of this.borderTextures.values()) {
      texture.dispose();
    }

    this.borderTextures.clear();
    this.paddingRaised.clear();

    this.tileAnimator.clear();

    // Sprites: materiais por entidade, texturas e geometrias em cache.
    for (
      const visual of [
        ...this.entityVisuals.values(),
        ...(this.playerVisual ? [this.playerVisual] : []),
      ]
    ) {
      this.root.remove(visual.mesh);
      (visual.mesh.material as THREE.Material).dispose();
    }

    this.entityVisuals.clear();
    this.playerVisual = null;

    for (const texture of this.spriteTextures.values()) {
      texture.dispose();
    }

    for (const geometry of this.spriteGeometries.values()) {
      geometry.dispose();
    }

    this.spriteTextures.clear();
    this.spriteGeometries.clear();

    for (
      const visual of
        this.mapVisuals.values()
    ) {
      visual.baseTexture.dispose();
      visual.overlayTexture.dispose();
      visual.geometry.dispose();

      this.disposeVoxelGroup(visual);


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