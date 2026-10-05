import { load } from '@wasm-gaming/mgba-wasm';
import { MgbaMemoryReader } from '../gen3/MemoryReader';
import type { EmulatorAdapter } from './EmulatorAdapter';
import { detectGen3Game } from '../gen3/GameProfile';

const LOCAL_SAVE_KEY = 'pkmn25d:last-save';

export class MgbaEmulatorAdapter implements EmulatorAdapter {
  readonly canvas: HTMLCanvasElement;

  private engine: Awaited<ReturnType<typeof load>> | null = null;
  private runtimeModule: any = null;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
  }

  async loadRom(bytes: ArrayBuffer | Uint8Array): Promise<void> {
    this.destroy();

    const romBytes =
      bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);

    try {
      const loadedEngine = await load({
        jsUrl: '/mgba/mgba.js',
        wasmUrl: '/mgba/mgba.wasm',
        canvasEl: this.canvas,
        assets: {
          rom: romBytes,
        },
        options: {
          system: 'auto',
          aspect: 'native',
          renderFilter: 'pixelated',
          skipBios: true,
          idleOptimization: 'remove',
          allowOpposingDirections: false,
          gamepads: true,
          volume: 0.35,
          logLevel: 'error',
        },
        persist: null,
      });

      this.engine = loadedEngine;

      this.runtimeModule =
        (loadedEngine as any).runtimeModule ?? null;

      if (!this.runtimeModule) {
        throw new Error(
          'mGBA runtimeModule não foi exposto pelo SDK. ' +
            'Verifique a resolução do pacote pelo Vite.',
        );
      }
    } catch (error) {
      this.engine = null;
      this.runtimeModule = null;
      throw error;
    }

    const memory = new MgbaMemoryReader(this.runtimeModule);

    const title = new TextDecoder().decode(
      memory.readRange(0x080000A0, 12),
    );

    const gameCode = new TextDecoder().decode(
      memory.readRange(0x080000AC, 4),
    );

    const revision = memory.readU8(0x080000BC);

    const profile = detectGen3Game(gameCode, revision);

    console.log('Gen 3 Game Profile:', {
      title,
      gameCode,
      revision,
      profile,
    });

    console.log('mGBA runtime:', {
      available: true,
      busRead8:
        typeof this.runtimeModule._mgbawasm_bus_read8 === 'function',
      busRead16:
        typeof this.runtimeModule._mgbawasm_bus_read16 === 'function',
      busRead32:
        typeof this.runtimeModule._mgbawasm_bus_read32 === 'function',
      sramLoad:
        typeof this.runtimeModule._mgbawasm_sram_load === 'function',
    });

    this.engine.start();
  }

  async importSave(save: ArrayBuffer | Uint8Array): Promise<void> {
    const bytes =
      save instanceof Uint8Array ? save : new Uint8Array(save);

    const mod = this.getRuntimeModule();
    const ptr = mod._malloc(bytes.length);

    try {
      mod.HEAPU8.set(bytes, ptr);

      const ok = mod._mgbawasm_sram_load(ptr, bytes.length);

      if (!ok) {
        throw new Error('mGBA rejected the imported save data.');
      }

      this.engine?.reset();
      this.persistSaveLocally(bytes);
    } finally {
      mod._free(ptr);
    }
  }

  async exportSave(): Promise<Uint8Array> {
    const mod = this.getRuntimeModule();

    const size = mod._mgbawasm_sram_save();
    const ptr = mod._mgbawasm_sram_ptr();

    if (!size || !ptr) {
      return new Uint8Array(0);
    }

    const bytes = new Uint8Array(size);
    bytes.set(mod.HEAPU8.subarray(ptr, ptr + size));

    this.persistSaveLocally(bytes);

    return bytes;
  }

  async loadPersistedSave(): Promise<boolean> {
    const persisted = localStorage.getItem(LOCAL_SAVE_KEY);

    if (!persisted) {
      return false;
    }

    try {
      const decoded = Uint8Array.from(
        atob(persisted),
        (char) => char.charCodeAt(0),
      );

      await this.importSave(decoded);

      return true;
    } catch {
      localStorage.removeItem(LOCAL_SAVE_KEY);
      return false;
    }
  }

  getMemoryReader() {
    return new MgbaMemoryReader(this.runtimeModule);
  }

  private persistSaveLocally(bytes: Uint8Array): void {
    if (bytes.length === 0) {
      return;
    }

    try {
      const encoded = btoa(
        Array.from(
          bytes,
          (value) => String.fromCharCode(value),
        ).join(''),
      );

      localStorage.setItem(LOCAL_SAVE_KEY, encoded);
    } catch {
      // Ignore local persistence failures; explicit export/import still works.
    }
  }

  private getRuntimeModule(): any {
    if (
      !this.runtimeModule ||
      typeof this.runtimeModule._mgbawasm_sram_load !== 'function'
    ) {
      throw new Error(
        'mGBA runtime is not available for save operations.',
      );
    }

    return this.runtimeModule;
  }

  start(): void {
    this.engine?.start();
  }

  pause(): void {
    this.engine?.pause();
  }

  resume(): void {
    this.engine?.resume();
  }

  reset(): void {
    this.engine?.reset();
  }

  destroy(): void {
    this.engine?.destroy();
    this.engine = null;
    this.runtimeModule = null;
  }

  setInput(map: Record<string, string>): void {
    this.engine?.setInput(map);
  }
}