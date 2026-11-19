import * as THREE from 'three';

/**
 * Pecas comuns dos modelos 3D de construcoes.
 *
 * Convencao de todos os modelos: origem no canto noroeste do bloco de
 * metatiles da construcao, x para leste, z para o sul, y para cima, 1
 * unidade = 1 metatile = 16 pixels da arte. A arte chega ja sem o chao
 * (BuildingSubstitution.prepare), em RGBA, linhas de cima para baixo.
 *
 * A regra da "dobra" vale para todos: a fachada (linhas de baixo da arte)
 * fica em pe na borda sul, do chao ate a altura dela em tiles, e o telhado
 * (linhas de cima) vai por cima, deslocado para o sul pela altura da
 * parede. Vista pela camera do jogo, a arte fica no mesmo lugar do GBA.
 * Uma unidade de altura vale 16 pixels da arte: a porta tem 1 tile, como
 * no Centro Pokemon, no Mart e nos ginasios.
 */

export const PX = 16;

/** Arte RGBA de um bloco (largura x altura em pixels). */
export class Art {
  constructor(
    readonly rgba: Uint8Array,
    readonly width: number,
    readonly height: number,
  ) {}

  static ofTiles(rgba: Uint8Array, widthTiles: number, heightTiles: number): Art {
    return new Art(rgba, widthTiles * PX, heightTiles * PX);
  }

  offset(x: number, y: number): number {
    return (y * this.width + x) * 4;
  }

  opaque(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.width && y < this.height && this.rgba[this.offset(x, y) + 3] !== 0;
  }

  rgb(x: number, y: number): number {
    const o = this.offset(x, y);

    return (this.rgba[o] << 16) | (this.rgba[o + 1] << 8) | this.rgba[o + 2];
  }

  color(x: number, y: number): THREE.Color {
    const o = this.offset(x, y);

    return new THREE.Color().setRGB(this.rgba[o] / 255, this.rgba[o + 1] / 255, this.rgba[o + 2] / 255, THREE.SRGBColorSpace);
  }

  /** Brilho (0-765) do pixel. */
  light(x: number, y: number): number {
    const o = this.offset(x, y);

    return this.rgba[o] + this.rgba[o + 1] + this.rgba[o + 2];
  }

  clone(): Art {
    return new Art(this.rgba.slice(), this.width, this.height);
  }

  /**
   * Cobre o retangulo [x0,x1) x [y0,y1) com a arte deslocada (dx, dy) px
   * (copia de x - dx, y - dy): o pedaco de parede ou de laje escondido
   * atras de outra parte do predio, continuado pelo padrao do lado.
   */
  patch(x0: number, y0: number, x1: number, y1: number, dx: number, dy = 0): this {
    const source = this.rgba.slice();

    for (let y = Math.max(0, y0); y < Math.min(this.height, y1); y++) {
      for (let x = Math.max(0, x0); x < Math.min(this.width, x1); x++) {
        const sx = x - dx;
        const sy = y - dy;

        if (sx < 0 || sy < 0 || sx >= this.width || sy >= this.height) {
          continue;
        }

        this.rgba.set(source.subarray(this.offset(sx, sy), this.offset(sx, sy) + 4), this.offset(x, y));
      }
    }

    return this;
  }

  /**
   * Preenche os pixels transparentes com o pixel opaco mais perto na mesma
   * linha (ou na mesma coluna): para superficies curvas mapeadas pela
   * dobra, cuja borda pega um pouco do chao tirado (sem isso, viram furos).
   */
  bleed(): this {
    const source = this.rgba.slice();
    const opaque = (x: number, y: number): boolean => source[this.offset(x, y) + 3] > 0;

    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        if (opaque(x, y)) {
          continue;
        }

        let found = -1;

        for (let d = 1; d < 24 && found < 0; d++) {
          if (x - d >= 0 && opaque(x - d, y)) {
            found = this.offset(x - d, y);
          } else if (x + d < this.width && opaque(x + d, y)) {
            found = this.offset(x + d, y);
          } else if (y - d >= 0 && opaque(x, y - d)) {
            found = this.offset(x, y - d);
          } else if (y + d < this.height && opaque(x, y + d)) {
            found = this.offset(x, y + d);
          }
        }

        if (found >= 0) {
          this.rgba.set(source.subarray(found, found + 4), this.offset(x, y));
        }
      }
    }

    return this;
  }

  /** Pinta o retangulo [x0,x1) x [y0,y1) com a cor do pixel (sx, sy). */
  fill(x0: number, y0: number, x1: number, y1: number, sx: number, sy: number): this {
    const color = this.rgba.slice(this.offset(sx, sy), this.offset(sx, sy) + 4);

    for (let y = Math.max(0, y0); y < Math.min(this.height, y1); y++) {
      for (let x = Math.max(0, x0); x < Math.min(this.width, x1); x++) {
        this.rgba.set(color, this.offset(x, y));
      }
    }

    return this;
  }

  /** Recorte em textura (DataTexture guarda as linhas de baixo para cima). */
  texture(x: number, y: number, w: number, h: number): THREE.DataTexture {
    return dataTexture(this.cut(x, y, w, h), w, h);
  }

  /** Recorte cru, de cima para baixo (pixels fora da arte: transparentes). */
  cut(x: number, y: number, w: number, h: number): Uint8Array {
    const out = new Uint8Array(w * h * 4);

    for (let row = 0; row < h; row++) {
      for (let col = 0; col < w; col++) {
        const sx = x + col;
        const sy = y + row;

        if (sx < 0 || sy < 0 || sx >= this.width || sy >= this.height) {
          continue;
        }

        out.set(this.rgba.subarray(this.offset(sx, sy), this.offset(sx, sy) + 4), (row * w + col) * 4);
      }
    }

    return out;
  }

  /** Cores dos pixels opacos de um retangulo. */
  palette(x0: number, y0: number, x1: number, y1: number): Set<number> {
    const colors = new Set<number>();

    for (let y = Math.max(0, y0); y < Math.min(this.height, y1); y++) {
      for (let x = Math.max(0, x0); x < Math.min(this.width, x1); x++) {
        if (this.opaque(x, y)) {
          colors.add(this.rgb(x, y));
        }
      }
    }

    return colors;
  }

  /**
   * Apaga, num retangulo, os pixels com cor fora da paleta: o chao que
   * sobrou numa celula mista (metade construcao, metade areia).
   */
  keepOnly(x0: number, y0: number, x1: number, y1: number, colors: Set<number>): void {
    for (let y = Math.max(0, y0); y < Math.min(this.height, y1); y++) {
      for (let x = Math.max(0, x0); x < Math.min(this.width, x1); x++) {
        if (this.opaque(x, y) && !colors.has(this.rgb(x, y))) {
          this.rgba[this.offset(x, y) + 3] = 0;
        }
      }
    }
  }

  /** Primeira e ultima linha com pixel opaco entre as colunas [x0, x1). */
  rows(x0: number, x1: number, y0 = 0, y1 = this.height): [number, number] {
    let first = y1;
    let last = y0 - 1;

    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        if (this.opaque(x, y)) {
          first = Math.min(first, y);
          last = y;
          break;
        }
      }
    }

    return [first, last];
  }

  /** Primeira e ultima coluna com pixel opaco entre as linhas [y0, y1). */
  columns(y0: number, y1: number, x0 = 0, x1 = this.width): [number, number] {
    let first = x1;
    let last = x0 - 1;

    for (let x = x0; x < x1; x++) {
      for (let y = y0; y < y1; y++) {
        if (this.opaque(x, y)) {
          first = Math.min(first, x);
          last = x;
          break;
        }
      }
    }

    return [first, last];
  }

  /**
   * Coluna mais lisa (menos cores diferentes) entre [x0, x1) nas linhas
   * [y0, y1): a faixa de parede usada nas laterais e no fundo.
   */
  plainestColumn(x0: number, x1: number, y0: number, y1: number, preferLight = false): number {
    let best = x0;
    let bestCount = Infinity;

    for (let x = x0; x < x1; x++) {
      const colors = new Set<number>();
      let holes = 0;
      let light = 0;

      for (let y = y0; y < y1; y++) {
        if (!this.opaque(x, y)) {
          holes++;
          continue;
        }

        colors.add(this.rgb(x, y));

        if (this.light(x, y) >= 3 * 175) {
          light++;
        }
      }

      // Com preferLight, a parede clara (reboco) ganha da sombra lisa e de
      // uma janela escura que ocupe a coluna toda.
      const fraction = light / Math.max(1, y1 - y0);
      const count = colors.size + holes * 4 - (preferLight ? fraction * 4 : 0) + (preferLight && fraction < 0.3 ? 6 : 0);

      if (count < bestCount) {
        best = x;
        bestCount = count;
      }
    }

    return best;
  }
}

export function dataTexture(data: Uint8Array, w: number, h: number): THREE.DataTexture {
  // Entrada de cima para baixo; a DataTexture le de baixo para cima.
  const flipped = new Uint8Array(w * h * 4);

  for (let row = 0; row < h; row++) {
    flipped.set(data.subarray(row * w * 4, (row + 1) * w * 4), (h - 1 - row) * w * 4);
  }

  const texture = new THREE.DataTexture(flipped, w, h, THREE.RGBAFormat);
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;

  return texture;
}

export function plain(color: THREE.Color, shade = 1): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({ color: color.clone().multiplyScalar(shade) });
}

export function textured(map: THREE.Texture, shade = 1, doubleSided = false): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    map,
    color: new THREE.Color(shade, shade, shade),
    transparent: true,
    alphaTest: 0.5,
    side: doubleSided ? THREE.DoubleSide : THREE.FrontSide,
  });
}

export function invisible(): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({ visible: false });
}

type Vec3 = [number, number, number];
type Vec2 = [number, number];

/**
 * Malha de poligonos (cada um com 3 ou 4 cantos em sentido anti-horario
 * visto de fora) com UV dada por canto.
 */
export function polygons(faces: Array<{ points: Vec3[]; uv: Vec2[] }>, material: THREE.Material): THREE.Mesh {
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  for (const face of faces) {
    const start = positions.length / 3;

    face.points.forEach((point, index) => {
      positions.push(...point);
      uvs.push(...face.uv[index]);
    });

    for (let i = 1; i + 1 < face.points.length; i++) {
      indices.push(start, start + i, start + i + 1);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeBoundingBox();

  return new THREE.Mesh(geometry, material);
}

/**
 * Parede vertical retangular de (x0, z0) a (x1, z1), do chao y0 ate y1,
 * com a textura inteira nela (u ao longo da parede, v para cima). A face
 * visivel e a da esquerda de quem anda de (x0, z0) para (x1, z1): para uma
 * fachada sul, x0 < x1 com z0 = z1.
 */
export function wall(
  x0: number, z0: number, x1: number, z1: number, y0: number, y1: number,
  material: THREE.Material,
  u0 = 0, u1 = 1, v0 = 0, v1 = 1,
): THREE.Mesh {
  return polygons([{
    points: [[x0, y0, z0], [x1, y0, z1], [x1, y1, z1], [x0, y1, z0]],
    uv: [[u0, v0], [u1, v0], [u1, v1], [u0, v1]],
  }], material);
}

export interface TopBounds {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
}

/** UV de um ponto projetado de cima num retangulo (u pelo x, v pelo z). */
export function topUv(bounds: TopBounds, x: number, z: number): Vec2 {
  return [(x - bounds.x0) / (bounds.x1 - bounds.x0), 1 - (z - bounds.z0) / (bounds.z1 - bounds.z0)];
}

export interface RoofOptions {
  // Caixa do telhado no chao (com o beiral) e altura da base.
  bounds: TopBounds;
  y: number;
  // Altura da cumeeira acima da base.
  rise: number;
  // hip: quatro aguas (cumeeira ao longo do x, recuada `inset` dos lados).
  // gable: duas aguas, empenas verticais nos lados leste e oeste.
  // gableZ: duas aguas com a cumeeira ao longo do z (empenas norte e sul).
  // flat: laje.
  kind: 'hip' | 'gable' | 'gableZ' | 'flat';
  inset?: number;
  // Onde fica a cumeeira entre z0 e z1 (0 a 1; padrao no meio).
  ridgeAt?: number;
  // Area da arte (projetada de cima) que vai no telhado: textura e a caixa
  // da arte no chao (padrao: a propria caixa do telhado).
  map: THREE.Texture;
  mapBounds?: TopBounds;
  // Material das empenas (gable).
  gableMaterial?: THREE.Material;
}

/** Telhado com a arte projetada de cima: visto da camera, fica igual ao GBA. */
export function roof(options: RoofOptions): THREE.Group {
  const { bounds, y, rise, kind } = options;
  const mapBounds = options.mapBounds ?? bounds;
  const group = new THREE.Group();
  const { x0, x1, z0, z1 } = bounds;
  const zm = z0 + (z1 - z0) * (options.ridgeAt ?? 0.5);
  const xm = (x0 + x1) / 2;
  const top = y + rise;
  const uv = (x: number, z: number): Vec2 => topUv(mapBounds, x, z);
  const face = (points: Vec3[]): { points: Vec3[]; uv: Vec2[] } => ({ points, uv: points.map(([px, , pz]) => uv(px, pz)) });
  const material = textured(options.map, 1, true);

  if (kind === 'flat') {
    group.add(polygons([face([[x0, y, z1], [x1, y, z1], [x1, y, z0], [x0, y, z0]])], material));

    return group;
  }

  if (kind === 'hip') {
    const inset = Math.min(options.inset ?? 0.6, (x1 - x0) / 2);
    const rx0 = x0 + inset;
    const rx1 = x1 - inset;

    group.add(polygons([
      face([[x0, y, z1], [x1, y, z1], [rx1, top, zm], [rx0, top, zm]]),
      face([[x1, y, z0], [x0, y, z0], [rx0, top, zm], [rx1, top, zm]]),
      face([[x0, y, z0], [x0, y, z1], [rx0, top, zm]]),
      face([[x1, y, z1], [x1, y, z0], [rx1, top, zm]]),
    ], material));

    return group;
  }

  if (kind === 'gable') {
    group.add(polygons([
      face([[x0, y, z1], [x1, y, z1], [x1, top, zm], [x0, top, zm]]),
      face([[x1, y, z0], [x0, y, z0], [x0, top, zm], [x1, top, zm]]),
    ], material));

    if (options.gableMaterial) {
      // Empenas (triangulos) um pouco para dentro do beiral.
      const inset = 0.02;
      const triangle = (x: number, outward: number): THREE.Mesh => polygons([{
        points: outward < 0
          ? [[x, y, z0], [x, y, z1], [x, top, zm]]
          : [[x, y, z1], [x, y, z0], [x, top, zm]],
        uv: outward < 0
          ? [[0, 0], [1, 0], [(zm - z0) / (z1 - z0), 1]]
          : [[0, 0], [1, 0], [(z1 - zm) / (z1 - z0), 1]],
      }], options.gableMaterial!);

      group.add(triangle(x0 + inset, -1));
      group.add(triangle(x1 - inset, 1));
    }

    return group;
  }

  // gableZ: cumeeira ao longo do z, aguas para leste e oeste.
  group.add(polygons([
    face([[x0, y, z0], [x0, y, z1], [xm, top, z1], [xm, top, z0]]),
    face([[x1, y, z1], [x1, y, z0], [xm, top, z0], [xm, top, z1]]),
  ], material));

  if (options.gableMaterial) {
    group.add(polygons([{ points: [[x0, y, z1], [x1, y, z1], [xm, top, z1]], uv: [[0, 0], [1, 0], [0.5, 1]] }], options.gableMaterial));
    group.add(polygons([{ points: [[x1, y, z0], [x0, y, z0], [xm, top, z0]], uv: [[0, 0], [1, 0], [0.5, 1]] }], options.gableMaterial));
  }

  return group;
}

/**
 * Caixa (x0..x1, y0..y1, z0..z1) com um material por face: leste, oeste,
 * topo, base, frente (sul), fundo (norte), como a BoxGeometry.
 */
export function box(
  x0: number, x1: number, y0: number, y1: number, z0: number, z1: number,
  materials: THREE.Material | THREE.Material[],
): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0), materials);
  mesh.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);

  return mesh;
}

/**
 * Plano da porta (animado pelo DoorAnimator): o quadro fechado e o tile
 * de 16x16 da arte em (px, py); o plano fica em (x, z), virado para o sul
 * (ou para `facing`), com `height` de altura.
 */
export function doorPlane(
  art: Art,
  px: number,
  py: number,
  x: number,
  z: number,
  options: { width?: number; height?: number; facing?: 'south' | 'east' | 'west' | 'north' } = {},
): THREE.Mesh {
  const width = options.width ?? 1;
  const height = options.height ?? 1;
  const plane = new THREE.Mesh(
    new THREE.PlaneGeometry(width, height),
    new THREE.MeshBasicMaterial({ transparent: true, alphaTest: 0.5 }),
  );

  plane.position.set(x, height / 2, z);
  plane.rotation.y = { south: 0, east: Math.PI / 2, north: Math.PI, west: -Math.PI / 2 }[options.facing ?? 'south'];
  plane.visible = false;
  plane.userData.door = true;
  plane.userData.closedArt = art.cut(px, py, PX, PX);

  return plane;
}

/** Faixa vertical da arte (1 px de largura) para laterais e fundos. */
export function stripe(art: Art, x: number, y0: number, y1: number): THREE.DataTexture {
  return art.texture(x, y0, 1, Math.max(1, y1 - y0));
}

/**
 * Volume de uma parte de construcao, com as faces tiradas da arte:
 *  - x: colunas da arte (px) - em tiles, px / 16;
 *  - z, y: faixas em tiles (contas da regra da dobra feitas por quem chama);
 *  - front: linhas da arte (px) pintadas na frente (sul), em pe;
 *  - lid: linhas da arte projetadas de cima na tampa (sem ela: sem tampa,
 *    para o que fica debaixo de um telhado);
 *  - sides: material dos lados e do fundo (padrao: a coluna mais lisa da
 *    frente, esticada).
 */
export function artBlock(
  art: Art,
  options: {
    x: [number, number];
    z: [number, number];
    y: [number, number];
    front?: [number, number];
    lid?: [number, number];
    sides?: THREE.Material;
    frontShade?: number;
  },
): THREE.Mesh {
  const [px0, px1] = options.x;
  const width = px1 - px0;
  let sides = options.sides;

  if (!sides) {
    const [r0, r1] = options.front ?? options.lid ?? [0, art.height];
    const column = art.plainestColumn(px0 + 2, Math.max(px0 + 3, px1 - 2), r0, r1, true);

    sides = textured(stripe(art, column, r0, r1), 0.75);
  }

  const front = options.front
    ? textured(art.texture(px0, options.front[0], width, options.front[1] - options.front[0]), options.frontShade ?? 0.97)
    : sides;
  const lid = options.lid ? textured(art.texture(px0, options.lid[0], width, options.lid[1] - options.lid[0])) : invisible();

  return box(px0 / PX, px1 / PX, options.y[0], options.y[1], options.z[0], options.z[1], [
    sides, sides, lid, invisible(), front, sides,
  ]);
}

/** Telhado com as linhas [r0, r1) da arte (colunas px0..px1) projetadas de cima. */
export function artRoof(
  art: Art,
  options: Omit<RoofOptions, 'map' | 'mapBounds'> & { px: [number, number]; rows: [number, number] },
): THREE.Group {
  const [px0, px1] = options.px;
  const [r0, r1] = options.rows;

  return roof({ ...options, map: art.texture(px0, r0, px1 - px0, r1 - r0) });
}
