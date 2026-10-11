import type {
  MemoryReader,
} from '../gen3/MemoryReader';

/**
 * Interface do jogo por cima da cena 3D, como no FireRed Faithful 2.5D.
 *
 * Dois modos, decididos a cada quadro:
 *
 *   JANELAS (overworld): caixas de texto, menu Start, escolhas sim/nao. Na
 *   Gen 3 elas vivem no BG0 do GBA. O tilemap do BG0 e lido direto da VRAM
 *   (endereco pelo registrador BG0CNT) e so as celulas 8x8 com tile sao
 *   copiadas do quadro do GBA para cima do 3D. O resto fica transparente e
 *   o mundo 3D aparece. Celula vazia do BG0 usa o tile 0.
 *
 *   TELA INTEIRA (batalha, bolsa, party, Pokedex, titulo, transicoes): a
 *   tela do GBA inteira cobre o palco. Quem decide e a mesma verificacao
 *   de VRAM que protege a animacao de tiles (tiles do mapa conferidos
 *   contra o ROM) - testada com batalha simulada em todos os mapas.
 *
 * Os pixels vem do framebuffer do emulador (o mesmo buffer que o SDK
 * copia para o canvas), entao funciona qualquer que seja o canvas.
 */

const IO_DISPCNT = 0x04000000;
const IO_BG0CNT = 0x04000008;
const DISPCNT_BG0_ENABLE = 0x0100;
const VRAM_BASE = 0x06000000;
const SCREENBLOCK_BYTES = 0x800;
const CHARBLOCK_BYTES = 0x4000;

const SCREEN_COLUMNS = 30;
const SCREEN_ROWS = 20;
const TILEMAP_COLUMNS = 32;
const CELL = 8;

// Acima desta fracao de celulas com janela, e uma tela cheia que reusa o
// BG0 (ex.: algumas telas de texto); mostra o quadro inteiro.
const FULL_SCREEN_CELL_RATIO = 0.85;

// off: sem jogo | world: overworld sem janela | windows: overworld com
// janela aberta | full: tela inteira do GBA
export type OverlayMode = 'off' | 'world' | 'windows' | 'full';

export interface VideoFrameSource {
  getVideoFrame?(): { width: number; height: number; rgba: Uint8Array } | null;
}

export class GameUiOverlay {
  private readonly canvas: HTMLCanvasElement;

  private readonly context: CanvasRenderingContext2D;

  private readonly source: VideoFrameSource;

  private readonly memory: MemoryReader;

  private readonly isOverworld: () => boolean;

  private readonly onModeChange: (mode: OverlayMode) => void;

  private image: ImageData | null = null;

  private readonly mask =
    new Uint8Array(SCREEN_COLUMNS * SCREEN_ROWS);

  // Mascara por PIXEL das celulas com janela: so os pixels do proprio
  // tile do BG0 com cor != 0. Copiar a celula inteira trazia junto o mapa
  // 2D que aparece pelos pixels transparentes da moldura.
  private readonly pixelMask =
    new Uint8Array(SCREEN_COLUMNS * CELL * SCREEN_ROWS * CELL);

  private mode: OverlayMode = 'off';

  private frameId = 0;

  private lastReportedCells = -1;

  constructor(
    canvas: HTMLCanvasElement,
    source: VideoFrameSource,
    memory: MemoryReader,
    isOverworld: () => boolean,
    onModeChange: (mode: OverlayMode) => void,
  ) {
    this.canvas = canvas;
    this.source = source;
    this.memory = memory;
    this.isOverworld = isOverworld;
    this.onModeChange = onModeChange;

    const context =
      canvas.getContext('2d');

    if (!context) {
      throw new Error('Canvas 2D indisponivel para a interface do jogo.');
    }

    this.context = context;
  }

  start(): void {
    const loop = (): void => {
      this.frameId = requestAnimationFrame(loop);

      try {
        this.render();
      } catch (error) {
        // A interface nunca derruba o jogo: desliga e avisa.
        cancelAnimationFrame(this.frameId);
        this.setMode('off');
        console.warn('[ui] sobreposicao desligada apos erro:', error);
      }
    };

    loop();
  }

  destroy(): void {
    cancelAnimationFrame(this.frameId);
    this.setMode('off');
  }

  private render(): void {
    const frame =
      this.source.getVideoFrame?.() ?? null;

    if (!frame) {
      this.setMode('off');

      return;
    }

    if (
      this.canvas.width !== frame.width ||
      this.canvas.height !== frame.height ||
      !this.image
    ) {
      this.canvas.width = frame.width;
      this.canvas.height = frame.height;
      this.image = this.context.createImageData(frame.width, frame.height);
    }

    const output =
      this.image.data;

    if (!this.isOverworld()) {
      output.set(frame.rgba);
      this.forceOpaque(output);
      this.context.putImageData(this.image, 0, 0);
      this.setMode('full');

      return;
    }

    const cells =
      this.readWindowMask();

    if (cells === 0) {
      this.setMode('world');
      output.fill(0);
      this.context.putImageData(this.image, 0, 0);

      return;
    }

    if (cells >= SCREEN_COLUMNS * SCREEN_ROWS * FULL_SCREEN_CELL_RATIO) {
      output.set(frame.rgba);
      this.forceOpaque(output);
      this.context.putImageData(this.image, 0, 0);
      this.setMode('full');

      return;
    }

    output.fill(0);

    const width =
      frame.width;

    for (let row = 0; row < SCREEN_ROWS; row++) {
      for (let column = 0; column < SCREEN_COLUMNS; column++) {
        if (!this.mask[row * SCREEN_COLUMNS + column]) {
          continue;
        }

        for (let y = 0; y < CELL; y++) {
          const pixelRow =
            row * CELL + y;

          for (let x = 0; x < CELL; x++) {
            const pixelX =
              column * CELL + x;

            if (!this.pixelMask[pixelRow * SCREEN_COLUMNS * CELL + pixelX]) {
              continue;
            }

            const offset =
              (pixelRow * width + pixelX) * 4;

            output[offset] = frame.rgba[offset];
            output[offset + 1] = frame.rgba[offset + 1];
            output[offset + 2] = frame.rgba[offset + 2];
            output[offset + 3] = 255;
          }
        }
      }
    }

    this.context.putImageData(this.image, 0, 0);
    this.setMode('windows');
  }

  /**
   * Marca as celulas da tela com tile no BG0. Devolve quantas.
   */
  private readWindowMask(): number {
    this.mask.fill(0);
    this.pixelMask.fill(0);

    const dispcnt =
      this.memory.readU16(IO_DISPCNT);

    if ((dispcnt & DISPCNT_BG0_ENABLE) === 0) {
      return 0;
    }

    const bg0cnt =
      this.memory.readU16(IO_BG0CNT);

    const tilemap =
      VRAM_BASE + ((bg0cnt >> 8) & 0x1f) * SCREENBLOCK_BYTES;

    const charBase =
      VRAM_BASE + ((bg0cnt >> 2) & 0x03) * CHARBLOCK_BYTES;

    // Texto da Gen 3 e 4bpp; em 8bpp (nao esperado) copia a celula toda.
    const fourBpp =
      (bg0cnt & 0x80) === 0;

    let cells = 0;

    for (let row = 0; row < SCREEN_ROWS; row++) {
      // Duas entradas de 16 bits por leitura de 32.
      for (let column = 0; column < SCREEN_COLUMNS; column += 2) {
        const pair =
          this.memory.readU32(
            tilemap + (row * TILEMAP_COLUMNS + column) * 2,
          );

        for (let half = 0; half < 2; half++) {
          const entry =
            half === 0 ? pair & 0xffff : pair >>> 16;

          if ((entry & 0x3ff) === 0) {
            continue;
          }

          const cellColumn =
            column + half;

          this.mask[row * SCREEN_COLUMNS + cellColumn] = 1;
          cells++;

          this.markTilePixels(
            row,
            cellColumn,
            entry,
            charBase,
            fourBpp,
          );
        }
      }
    }

    // Diagnostico: so quando a quantidade muda, para nao inundar o console.
    if (cells !== this.lastReportedCells) {
      this.lastReportedCells = cells;
      console.log('[ui] celulas de janela no BG0:', cells);
    }

    return cells;
  }

  /**
   * Marca, na mascara por pixel, os pixels opacos (cor != 0) do tile do
   * BG0 nesta celula, respeitando os espelhamentos da entrada do tilemap.
   */
  private markTilePixels(
    row: number,
    column: number,
    entry: number,
    charBase: number,
    fourBpp: boolean,
  ): void {
    const stride =
      SCREEN_COLUMNS * CELL;

    if (!fourBpp) {
      for (let y = 0; y < CELL; y++) {
        for (let x = 0; x < CELL; x++) {
          this.pixelMask[(row * CELL + y) * stride + column * CELL + x] = 1;
        }
      }

      return;
    }

    const tileAddress =
      charBase + (entry & 0x3ff) * 32;

    const hFlip = (entry & 0x0400) !== 0;
    const vFlip = (entry & 0x0800) !== 0;

    for (let sourceY = 0; sourceY < CELL; sourceY++) {
      // Uma linha do tile = 32 bits = 8 pixels de 4 bits.
      const line =
        this.memory.readU32(tileAddress + sourceY * 4);

      if (line === 0) {
        continue;
      }

      const y =
        vFlip ? CELL - 1 - sourceY : sourceY;

      for (let sourceX = 0; sourceX < CELL; sourceX++) {
        if (((line >>> (sourceX * 4)) & 0x0f) === 0) {
          continue;
        }

        const x =
          hFlip ? CELL - 1 - sourceX : sourceX;

        this.pixelMask[(row * CELL + y) * stride + column * CELL + x] = 1;
      }
    }
  }

  private forceOpaque(
    pixels: Uint8ClampedArray,
  ): void {
    for (let index = 3; index < pixels.length; index += 4) {
      pixels[index] = 255;
    }
  }

  private setMode(
    mode: OverlayMode,
  ): void {
    if (mode === this.mode) {
      return;
    }

    this.mode = mode;
    this.onModeChange(mode);
  }
}
