import type {
  Direction,
} from './GameState';

/**
 * Sprites do overworld (jogador, NPCs, caminhao do Emerald, itens, Pokemon
 * de overworld) lidos DIRETO do ROM.
 *
 * Por que do ROM e nao da OAM/VRAM do emulador: a palette RAM ja se
 * mostrou nao confiavel neste build (volta zerada durante transicoes), e o
 * ROM tem tudo de forma estavel - graficos, paletas e animacoes.
 *
 * As duas tabelas sao localizadas pela ESTRUTURA do ROM, como gMapGroups,
 * porque mudam de endereco entre jogos e hackroms (a Perfect Fire Red
 * realocou a de graficos para 0x873EC40). Validado offline gerando folhas
 * de contato dos tres ROMs do projeto e conferindo visualmente: entrada 0
 * e o protagonista (Red / Brendan), paletas corretas, caminhao, navios e
 * Pokemon de overworld presentes. Ver relatorios/13.
 *
 *   gObjectEventGraphicsInfoPointers: ponteiros para
 *     struct ObjectEventGraphicsInfo (0x24 bytes)
 *       0x02 paletteTag | 0x06 size (reserva de VRAM, NAO o quadro)
 *       0x08 width      | 0x0A height
 *       0x0C bit 6 = inanimate
 *       0x18 anims      | 0x1C images (SpriteFrameImage { data, size })
 *
 *   sObjectEventSpritePalettes: struct SpritePalette { data, tag } (8 bytes)
 */

const ROM_BASE =
  0x08000000;

const INFO_SIZE =
  0x24;

const MIN_TABLE_ENTRIES =
  32;

// Fracao minima de entradas com validacao completa dentro da tabela.
// Algumas legitimas tem o quadro 0 menor que as dimensoes (arvores de
// berry comecam pelo montinho de terra), entao nao exigimos 100%.
const MIN_STRONG_RATIO =
  0.9;

const MAX_ANIM_FRAMES =
  16;

// GBA a 60 quadros por segundo; duracoes de animacao vem em quadros.
const GBA_FRAME_MS =
  1000 / 60;

// Indices de animacao padrao (ANIM_STD_*), iguais em RSE e FRLG.
const FACE_ANIM_BY_DIRECTION: Record<Direction, number> = {
  DOWN: 0,
  UP: 1,
  LEFT: 2,
  RIGHT: 3,
};

const WALK_ANIM_OFFSET =
  4;

export interface SpriteFrame {
  // Chave estavel do quadro (id + imagem + espelhamento), para cache de
  // textura do lado do renderizador.
  key: string;
  width: number;
  height: number;

  // RGBA com as linhas DE BAIXO PARA CIMA, prontas para DataTexture com
  // flipY = false (mesma convencao das texturas de mapa).
  rgba: Uint8Array;
}

interface AnimFrame {
  image: number;
  duration: number;
  hFlip: boolean;
}

interface GraphicsInfo {
  width: number;
  height: number;
  paletteTag: number;
  inanimate: boolean;
  animsAddress: number;
  imagesAddress: number;
}

export class OverworldSprites {
  private readonly rom: Uint8Array;

  private located = false;

  private graphicsTable = 0;

  private graphicsCount = 0;

  private readonly palettesByTag =
    new Map<number, Uint8Array>();

  private readonly infoCache =
    new Map<number, GraphicsInfo | null>();

  private readonly animCache =
    new Map<string, AnimFrame[]>();

  private readonly frameCache =
    new Map<string, SpriteFrame>();

  constructor(
    romBytes: Uint8Array,
  ) {
    this.rom = romBytes;
  }

  /**
   * Localiza as tabelas. Varre o ROM uma vez (algumas centenas de ms);
   * chamar depois do mundo montado para nao competir com a inicializacao.
   */
  ensureLocated(): boolean {
    if (this.located) {
      return this.graphicsTable !== 0;
    }

    this.located = true;

    const table =
      this.findGraphicsTable();

    if (!table) {
      console.warn('[sprites] tabela de graficos nao encontrada.');

      return false;
    }

    this.graphicsTable = table.address;
    this.graphicsCount = table.count;

    const usedTags =
      new Set<number>();

    for (
      let id = 0;
      id < this.graphicsCount;
      id++
    ) {
      const info =
        this.getInfo(id);

      if (
        info &&
        (info.paletteTag & 0xff00) === 0x1100
      ) {
        usedTags.add(info.paletteTag);
      }
    }

    this.loadPalettes(
      usedTags,
    );

    console.log(
      '[sprites] graficos em 0x' + this.graphicsTable.toString(16),
      '(' + this.graphicsCount + ' ids) | paletas:',
      this.palettesByTag.size,
    );

    return true;
  }

  /**
   * Quadro a exibir para uma entidade.
   *
   * @param moving  usa a animacao de caminhada (GO_*) em vez da parada
   * @param timeMs  relogio para avancar a animacao de caminhada
   */
  getFrame(
    graphicsId: number,
    direction: Direction,
    moving: boolean,
    timeMs: number,
  ): SpriteFrame | null {
    if (
      !this.ensureLocated() ||
      graphicsId < 0 ||
      graphicsId >= this.graphicsCount
    ) {
      return null;
    }

    const info =
      this.getInfo(graphicsId);

    if (!info) {
      return null;
    }

    let image = 0;
    let hFlip = false;

    if (!info.inanimate) {
      const faceIndex =
        FACE_ANIM_BY_DIRECTION[direction] ?? 0;

      const animIndex =
        moving
          ? faceIndex + WALK_ANIM_OFFSET
          : faceIndex;

      const frames =
        this.getAnim(
          graphicsId,
          info,
          animIndex,
        );

      if (frames.length > 0) {
        let chosen =
          frames[0];

        if (moving && frames.length > 1) {
          const total =
            frames.reduce(
              (sum, frame) => sum + Math.max(1, frame.duration),
              0,
            );

          let tick =
            Math.floor(timeMs / GBA_FRAME_MS) % total;

          for (
            const frame of frames
          ) {
            tick -= Math.max(1, frame.duration);

            if (tick < 0) {
              chosen = frame;

              break;
            }
          }
        }

        image = chosen.image;
        hFlip = chosen.hFlip;
      }
    }

    return this.decodeFrame(
      graphicsId,
      info,
      image,
      hFlip,
    );
  }

  // ----------------------------------------------------------------------

  private getInfo(
    graphicsId: number,
  ): GraphicsInfo | null {
    if (this.infoCache.has(graphicsId)) {
      return this.infoCache.get(graphicsId) ?? null;
    }

    const address =
      this.u32(
        this.graphicsTable - ROM_BASE + graphicsId * 4,
      );

    let info: GraphicsInfo | null = null;

    if (this.structural(address)) {
      const offset =
        address - ROM_BASE;

      info = {
        paletteTag: this.u16(offset + 0x02),
        width: this.s16(offset + 0x08),
        height: this.s16(offset + 0x0a),
        inanimate: (this.rom[offset + 0x0c] & 0x40) !== 0,
        animsAddress: this.u32(offset + 0x18),
        imagesAddress: this.u32(offset + 0x1c),
      };
    }

    this.infoCache.set(graphicsId, info);

    return info;
  }

  private getAnim(
    graphicsId: number,
    info: GraphicsInfo,
    animIndex: number,
  ): AnimFrame[] {
    const key =
      graphicsId + ':' + animIndex;

    const cached =
      this.animCache.get(key);

    if (cached) {
      return cached;
    }

    const frames: AnimFrame[] = [];

    const pointer =
      this.u32(
        info.animsAddress - ROM_BASE + animIndex * 4,
      );

    if (this.valid(pointer, 4)) {
      for (
        let index = 0;
        index < MAX_ANIM_FRAMES;
        index++
      ) {
        const command =
          this.u32(
            pointer - ROM_BASE + index * 4,
          );

        // Comandos especiais (END -1, JUMP -2, LOOP -3) tem o campo de 16
        // bits baixo negativo; quadros tem imageValue >= 0.
        const low =
          command & 0xffff;

        if (low >= 0x8000) {
          break;
        }

        frames.push({
          image: low,
          duration: (command >>> 16) & 0x3f,
          hFlip: ((command >>> 22) & 1) === 1,
        });
      }
    }

    this.animCache.set(key, frames);

    return frames;
  }

  private decodeFrame(
    graphicsId: number,
    info: GraphicsInfo,
    requestedImage: number,
    hFlip: boolean,
  ): SpriteFrame | null {
    const frameBytes =
      (info.width * info.height) >> 1;

    // Quadro pedido invalido (tabela de animacao fora do padrao): cai
    // para o quadro 0 em vez de ler lixo.
    let image =
      requestedImage;

    if (
      !this.validImage(info, image, frameBytes)
    ) {
      image = 0;
    }

    if (
      !this.validImage(info, image, frameBytes)
    ) {
      return null;
    }

    const key =
      graphicsId + ':' + image + ':' + (hFlip ? 1 : 0);

    const cached =
      this.frameCache.get(key);

    if (cached) {
      return cached;
    }

    const palette =
      this.palettesByTag.get(info.paletteTag);

    if (!palette) {
      return null;
    }

    const data =
      this.u32(
        info.imagesAddress - ROM_BASE + image * 8,
      ) - ROM_BASE;

    const { width, height } = info;
    const tilesPerRow = width >> 3;

    const rgba =
      new Uint8Array(width * height * 4);

    for (
      let y = 0;
      y < height;
      y++
    ) {
      // Linhas de baixo para cima (flipY = false no DataTexture).
      const row =
        height - 1 - y;

      for (
        let x = 0;
        x < width;
        x++
      ) {
        const sourceX =
          hFlip
            ? width - 1 - x
            : x;

        // Tiles 8x8 em ordem de linha (mapeamento 1D da OAM), 4bpp com o
        // nibble baixo primeiro.
        const tile =
          (y >> 3) * tilesPerRow + (sourceX >> 3);

        const byte =
          this.rom[
            data + tile * 32 + (y & 7) * 4 + ((sourceX & 7) >> 1)
          ];

        const colorIndex =
          (sourceX & 1) === 1
            ? byte >> 4
            : byte & 0x0f;

        if (colorIndex === 0) {
          continue;
        }

        const offset =
          (row * width + x) * 4;

        rgba[offset] = palette[colorIndex * 3];
        rgba[offset + 1] = palette[colorIndex * 3 + 1];
        rgba[offset + 2] = palette[colorIndex * 3 + 2];
        rgba[offset + 3] = 255;
      }
    }

    const frame: SpriteFrame = {
      key,
      width,
      height,
      rgba,
    };

    this.frameCache.set(key, frame);

    return frame;
  }

  private validImage(
    info: GraphicsInfo,
    image: number,
    frameBytes: number,
  ): boolean {
    const entry =
      info.imagesAddress - ROM_BASE + image * 8;

    if (
      entry < 0 ||
      entry + 8 > this.rom.length
    ) {
      return false;
    }

    return (
      this.valid(this.u32(entry), frameBytes) &&
      this.u16(entry + 4) === frameBytes
    );
  }

  private loadPalettes(
    usedTags: Set<number>,
  ): void {
    // Maior sequencia de { ponteiro, tag 0x11xx } que cubra mais tags
    // usadas pelos graficos.
    let bestAddress = 0;
    let bestCount = 0;
    let bestCovered = -1;

    for (
      let offset = 0;
      offset + 8 <= this.rom.length;
      offset += 4
    ) {
      let count = 0;
      const seen = new Set<number>();

      while (offset + count * 8 + 8 <= this.rom.length) {
        const entry =
          offset + count * 8;

        const tag =
          this.u16(entry + 4);

        if (
          (tag & 0xff00) !== 0x1100 ||
          !this.valid(this.u32(entry), 32)
        ) {
          break;
        }

        seen.add(tag);
        count++;
      }

      if (count >= 4) {
        let covered = 0;

        for (const tag of usedTags) {
          if (seen.has(tag)) {
            covered++;
          }
        }

        if (covered > bestCovered) {
          bestCovered = covered;
          bestAddress = offset;
          bestCount = count;
        }

        offset += (count - 1) * 8;
      }
    }

    for (
      let index = 0;
      index < bestCount;
      index++
    ) {
      const entry =
        bestAddress + index * 8;

      const tag =
        this.u16(entry + 4);

      const paletteOffset =
        this.u32(entry) - ROM_BASE;

      const rgb =
        new Uint8Array(16 * 3);

      for (
        let color = 0;
        color < 16;
        color++
      ) {
        const raw =
          this.u16(paletteOffset + color * 2);

        // Mesma conversao 5 -> 8 bits usada no mapa.
        const r5 = raw & 0x1f;
        const g5 = (raw >> 5) & 0x1f;
        const b5 = (raw >> 10) & 0x1f;

        rgb[color * 3] = (r5 << 3) | (r5 >> 2);
        rgb[color * 3 + 1] = (g5 << 3) | (g5 >> 2);
        rgb[color * 3 + 2] = (b5 << 3) | (b5 >> 2);
      }

      if (!this.palettesByTag.has(tag)) {
        this.palettesByTag.set(tag, rgb);
      }
    }
  }

  private findGraphicsTable(): {
    address: number;
    count: number;
  } | null {
    let best: { address: number; count: number } | null = null;
    let start = -1;
    let count = 0;
    let strong = 0;

    const close = (): void => {
      if (
        count >= MIN_TABLE_ENTRIES &&
        strong / count >= MIN_STRONG_RATIO &&
        (!best || count > best.count)
      ) {
        best = {
          address: ROM_BASE + start,
          count,
        };
      }

      start = -1;
      count = 0;
      strong = 0;
    };

    for (
      let offset = 0;
      offset + 4 <= this.rom.length;
      offset += 4
    ) {
      const address =
        this.u32(offset);

      if (this.structural(address)) {
        if (start < 0) {
          start = offset;
        }

        count++;

        if (this.complete(address)) {
          strong++;
        }
      } else if (start >= 0) {
        close();
      }
    }

    close();

    return best;
  }

  // Validacao estrutural: delimita a tabela.
  private structural(
    address: number,
  ): boolean {
    if (!this.valid(address, INFO_SIZE)) {
      return false;
    }

    const offset =
      address - ROM_BASE;

    const width =
      this.s16(offset + 0x08);

    const height =
      this.s16(offset + 0x0a);

    if (
      width < 8 || height < 8 ||
      width > 128 || height > 128 ||
      width % 8 !== 0 || height % 8 !== 0
    ) {
      return false;
    }

    return (
      this.valid(this.u32(offset + 0x10), 8) &&
      this.valid(this.u32(offset + 0x18), 4) &&
      this.valid(this.u32(offset + 0x1c), 8)
    );
  }

  // Validacao completa: o quadro 0 tem exatamente largura x altura / 2
  // bytes e cabe na reserva declarada.
  private complete(
    address: number,
  ): boolean {
    const offset =
      address - ROM_BASE;

    const width = this.s16(offset + 0x08);
    const height = this.s16(offset + 0x0a);
    const reserve = this.u16(offset + 0x06);
    const frameBytes = (width * height) >> 1;

    if (
      reserve < frameBytes ||
      reserve > 0x2000
    ) {
      return false;
    }

    const images =
      this.u32(offset + 0x1c) - ROM_BASE;

    return (
      this.valid(this.u32(images), frameBytes) &&
      this.u16(images + 4) === frameBytes
    );
  }

  private valid(
    address: number,
    size: number,
  ): boolean {
    return (
      address >= ROM_BASE &&
      address - ROM_BASE + size <= this.rom.length
    );
  }

  private u16(
    offset: number,
  ): number {
    return this.rom[offset] | (this.rom[offset + 1] << 8);
  }

  private s16(
    offset: number,
  ): number {
    const value =
      this.u16(offset);

    return value >= 0x8000
      ? value - 0x10000
      : value;
  }

  private u32(
    offset: number,
  ): number {
    if (
      offset < 0 ||
      offset + 3 >= this.rom.length
    ) {
      return 0;
    }

    return (
      (this.rom[offset] |
        (this.rom[offset + 1] << 8) |
        (this.rom[offset + 2] << 16) |
        (this.rom[offset + 3] << 24)) >>>
      0
    );
  }
}
