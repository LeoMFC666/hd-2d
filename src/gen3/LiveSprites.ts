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

export interface LiveSpriteState {
  // Posicao do sprite em pixels (espaco do mundo do jogo).
  x: number;
  y: number;

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
