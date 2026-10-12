import type {
  MemoryReader,
} from './MemoryReader';

import type {
  OverworldSprites,
  SpriteFrame,
} from './OverworldSprites';

/**
 * Leitura dos sprites VIVOS do jogo (gSprites), para o 3D andar e animar
 * exatamente como o GBA.
 *
 * Antes o renderizador so via o tile atual de cada entidade (que na RAM
 * pula para o destino no inicio do passo) e inventava o resto: deslizava
 * em tempo real ate o tile e escolhia o quadro de caminhada pelo relogio.
 * O passo nao batia com o do jogo (o personagem "patinava") e a corrida
 * nunca aparecia, porque ela e outra animacao do mesmo sprite.
 *
 * Agora vem tudo do proprio sprite do jogo:
 *   - posicao: sprite->x/y (0x20/0x22) anda em pixels do MUNDO, 1 por
 *     quadro caminhando, 2 correndo; a camera do GBA compensa com um
 *     deslocamento global. Medido no navegador (FireRed): parado no tile
 *     y=20 o sprite esta em y=112, no tile 21 em y=128.
 *   - altura do pulo: sprite->y2 (0x26) negativo durante pulos (ledges).
 *   - quadro: anims[animNum][animCmdIndex] (0x08, 0x2A, 0x2B) - o quadro
 *     que esta na tela, inclusive corrida, bike e pulo.
 *
 * gSprites muda de endereco entre jogos (FireRed 0x0202063C) e pode mudar
 * em hackroms. Achado pela estrutura: o sprite do jogador (spriteId do seu
 * ObjectEvent) aponta para a tabela de imagens do seu graphicsId no ROM.
 *
 *   struct Sprite (0x44 bytes)
 *     0x08 anims  | 0x0C images | 0x20 x, y | 0x24 x2, y2
 *     0x2A animNum | 0x2B animCmdIndex | 0x3E bit 0 = inUse
 */

const SPRITE_SIZE =
  0x44;

const MAX_SPRITES =
  64;

const EWRAM_START =
  0x02000000;

const EWRAM_END =
  0x02040000;

// Nova varredura no maximo a cada tanto (ms), enquanto nao achar: fora do
// overworld nao ha sprite do jogador para achar.
const RESCAN_INTERVAL_MS =
  1500;

// VRAM de objetos (tiles 4bpp, mapeamento 1D) e paletas de objetos.
const OBJ_VRAM =
  0x06010000;

const OBJ_PALETTES =
  0x05000200;

// Largura x altura por forma (quadrado, deitado, em pe) e tamanho da OAM.
const OBJ_SIZES: Array<Array<[number, number]>> = [
  [[8, 8], [16, 16], [32, 32], [64, 64]],
  [[16, 8], [32, 8], [32, 16], [64, 32]],
  [[8, 16], [8, 32], [16, 32], [32, 64]],
];

const toSigned8 = (value: number): number =>
  value >= 0x80 ? value - 0x100 : value;

/**
 * Sprite cru de gSprites. Centro (x + x2, y + y2) no espaco do sprite:
 * mundo do jogo quando coordOffset (segue a camera), tela quando nao
 * (passaro do Fly e o jogador montado nele).
 */
export interface RawSprite {
  id: number;
  coordOffset: boolean;
  invisible: boolean;
  centerX: number;
  centerY: number;

  // Deslocamento vertical do jogo (pulo, balanco da prancha do surf).
  y2: number;

  width: number;
  height: number;

  // Centro na TELA do GBA (pela OAM, com a camera aplicada).
  screenCenterX: number;
  screenCenterY: number;

  tileNum: number;
  palette: number;

  // Ordem de desenho do GBA: prioridade menor e subprioridade menor por
  // cima.
  priority: number;
  subpriority: number;

  hFlip: boolean;
  vFlip: boolean;
  eightBit: boolean;
}

export interface LiveSpriteState {
  // Posicao do sprite em pixels (espaco do mundo do jogo).
  x: number;
  y: number;

  // Escondido pelo jogo (piscando, durante o Fly).
  invisible: boolean;

  // Altura acima do chao, em pixels (pulos). 0 no chao.
  lift: number;

  frame: SpriteFrame | null;
}

export class LiveSprites {
  private readonly memory: MemoryReader;

  private readonly sprites: OverworldSprites;

  private base = 0;

  private nextScanAt = 0;

  constructor(
    memory: MemoryReader,
    sprites: OverworldSprites,
  ) {
    this.memory = memory;
    this.sprites = sprites;
  }

  /**
   * Garante a tabela gSprites usando o sprite do jogador como ancora.
   * Devolve false enquanto nao achar (fora do overworld, por exemplo).
   */
  locate(
    playerSpriteId: number,
    playerGraphicsId: number,
    now: number,
  ): boolean {
    const images =
      this.sprites.getImagesAddress(playerGraphicsId);

    if (images === null || playerSpriteId >= MAX_SPRITES) {
      return false;
    }

    if (
      this.base !== 0 &&
      this.matches(this.base, playerSpriteId, images)
    ) {
      return true;
    }

    if (now < this.nextScanAt) {
      return false;
    }

    this.nextScanAt =
      now + RESCAN_INTERVAL_MS;

    const found =
      this.scan(playerSpriteId, images);

    // Varredura sem resultado (sprite ainda sendo recriado depois de um
    // warp, tela fora do overworld) nao apaga o endereco ja conhecido: a
    // tabela nao muda de lugar durante o jogo.
    if (found === 0) {
      return false;
    }

    if (found !== this.base) {
      console.log('[sprites] gSprites em 0x' + found.toString(16));
    }

    this.base = found;

    return true;
  }

  /**
   * Estado do sprite `spriteId`, ou null se a tabela nao foi achada ou o
   * sprite nao e o deste graphicsId (troca de sprite no meio do caminho).
   */
  read(
    spriteId: number,
    graphicsId: number,
  ): LiveSpriteState | null {
    if (this.base === 0 || spriteId >= MAX_SPRITES) {
      return null;
    }

    const images =
      this.sprites.getImagesAddress(graphicsId);

    if (
      images === null ||
      !this.matches(this.base, spriteId, images)
    ) {
      return null;
    }

    const address =
      this.base + spriteId * SPRITE_SIZE;

    const y2 =
      this.s16(address + 0x26);

    return {
      x: this.s16(address + 0x20),
      y: this.s16(address + 0x22),
      invisible: (this.memory.readU8(address + 0x3e) & 0x04) !== 0,
      lift: y2 < 0 ? -y2 : 0,
      frame:
        this.sprites.getFrameFromAnimation(
          graphicsId,
          this.memory.readU32(address + 0x08),
          this.memory.readU8(address + 0x2a),
          this.memory.readU8(address + 0x2b),
        ),
    };
  }

  /**
   * Todos os sprites em uso, crus (para os efeitos de campo: grama, agua,
   * prancha do surf, passaro do Fly). [] enquanto gSprites nao foi achado.
   */
  readAll(): RawSprite[] {
    const sprites: RawSprite[] = [];

    if (this.base === 0) {
      return sprites;
    }

    for (let id = 0; id < MAX_SPRITES; id++) {
      const raw = this.readRaw(id);

      if (raw) {
        sprites.push(raw);
      }
    }

    return sprites;
  }

  /** Sprite cru `id`, ou null se nao esta em uso. */
  readRaw(
    id: number,
  ): RawSprite | null {
    if (this.base === 0 || id >= MAX_SPRITES) {
      return null;
    }

    const address =
      this.base + id * SPRITE_SIZE;

    const flags =
      this.memory.readU8(address + 0x3e);

    if ((flags & 0x01) === 0) {
      return null;
    }

    const attr0 = this.memory.readU16(address);
    const attr1 = this.memory.readU16(address + 2);
    const attr2 = this.memory.readU16(address + 4);
    const affine = (attr0 >> 8) & 3;
    const [width, height] = OBJ_SIZES[(attr0 >> 14) & 3]?.[(attr1 >> 14) & 3] ?? [0, 0];
    const corner = this.memory.readU16(address + 0x28);
    const x2 = this.s16(address + 0x24);
    const y2 = this.s16(address + 0x26);
    const oamX = attr1 & 0x1ff;
    const oamY = attr0 & 0xff;

    return {
      id,
      coordOffset: (flags & 0x02) !== 0,
      invisible: (flags & 0x04) !== 0 || affine === 2,
      centerX: this.s16(address + 0x20) + x2,
      centerY: this.s16(address + 0x22) + y2,
      y2,
      width,
      height,
      // Coordenadas da OAM sao de 9 (x) e 8 (y) bits: acima da tela voltam
      // como numeros altos.
      screenCenterX: (oamX >= 256 ? oamX - 512 : oamX) - toSigned8(corner & 0xff),
      screenCenterY: (oamY >= 192 ? oamY - 256 : oamY) - toSigned8(corner >> 8),
      tileNum: attr2 & 0x3ff,
      palette: attr2 >> 12,
      priority: (attr2 >> 10) & 3,
      subpriority: this.memory.readU8(address + 0x43),
      hFlip: affine === 0 && (attr1 & 0x1000) !== 0,
      vFlip: affine === 0 && (attr1 & 0x2000) !== 0,
      eightBit: (attr0 & 0x2000) !== 0,
    };
  }

  /**
   * Quadro atual de um sprite qualquer, lido como o GBA desenha: tiles da
   * VRAM de objetos e paleta da RAM de paletas. Serve para qualquer efeito
   * sem tabela por jogo. null para 8bpp e tamanhos invalidos.
   */
  frameFromVram(
    raw: RawSprite,
  ): SpriteFrame | null {
    const { width, height } = raw;

    if (width === 0 || height === 0 || raw.eightBit) {
      return null;
    }

    const tileCount = (width >> 3) * (height >> 3);
    const words = new Uint32Array(tileCount * 8);

    for (let index = 0; index < words.length; index++) {
      words[index] = this.memory.readU32(OBJ_VRAM + raw.tileNum * 32 + index * 4);
    }

    const palette = new Uint16Array(16);

    for (let index = 0; index < 16; index++) {
      palette[index] = this.memory.readU16(OBJ_PALETTES + raw.palette * 32 + index * 2);
    }

    // FNV-1a do conteudo: mesma imagem, mesma textura em cache.
    let hash = 0x811c9dc5;

    for (const value of [...words, ...palette, raw.hFlip ? 1 : 0, raw.vFlip ? 1 : 0]) {
      hash = Math.imul(hash ^ value, 0x01000193) >>> 0;
    }

    const rgba = new Uint8Array(width * height * 4);
    const tilesPerRow = width >> 3;

    for (let y = 0; y < height; y++) {
      // Linhas de baixo para cima (flipY = false no DataTexture).
      const row = height - 1 - y;
      const sourceY = raw.vFlip ? height - 1 - y : y;

      for (let x = 0; x < width; x++) {
        const sourceX = raw.hFlip ? width - 1 - x : x;
        const tile = (sourceY >> 3) * tilesPerRow + (sourceX >> 3);
        const word = words[tile * 8 + (sourceY & 7)];
        const colorIndex = (word >>> ((sourceX & 7) * 4)) & 0x0f;

        if (colorIndex === 0) {
          continue;
        }

        const color = palette[colorIndex];
        const offset = (row * width + x) * 4;

        rgba[offset] = ((color & 0x1f) << 3) | ((color & 0x1f) >> 2);
        rgba[offset + 1] = (((color >> 5) & 0x1f) << 3) | (((color >> 5) & 0x1f) >> 2);
        rgba[offset + 2] = (((color >> 10) & 0x1f) << 3) | (((color >> 10) & 0x1f) >> 2);
        rgba[offset + 3] = 255;
      }
    }

    return {
      key: 'vram:' + width + 'x' + height + ':' + hash.toString(16),
      width,
      height,
      rgba,
    };
  }

  private matches(
    base: number,
    spriteId: number,
    images: number,
  ): boolean {
    const address =
      base + spriteId * SPRITE_SIZE;

    return (
      (this.memory.readU16(address + 0x3e) & 0x01) === 1 &&
      this.memory.readU32(address + 0x0c) === images
    );
  }

  private scan(
    spriteId: number,
    images: number,
  ): number {
    for (
      let address = EWRAM_START;
      address < EWRAM_END;
      address += 4
    ) {
      if (this.memory.readU32(address) !== images) {
        continue;
      }

      const base =
        address - 0x0c - spriteId * SPRITE_SIZE;

      if (
        base >= EWRAM_START &&
        this.matches(base, spriteId, images)
      ) {
        return base;
      }
    }

    return 0;
  }

  private s16(
    address: number,
  ): number {
    const value =
      this.memory.readU16(address);

    return value >= 0x8000
      ? value - 0x10000
      : value;
  }
}
