import type { MemoryReader } from '../gen3/MemoryReader';

export interface EmulatorAdapter {
  readonly canvas: HTMLCanvasElement;
  loadRom(bytes: ArrayBuffer | Uint8Array): Promise<void>;
  importSave(save: ArrayBuffer | Uint8Array): Promise<void>;
  exportSave(): Promise<Uint8Array>;
  loadPersistedSave(): Promise<boolean>;
  getMemoryReader(): MemoryReader;
  start(): void;
  pause(): void;
  resume(): void;
  reset(): void;
  destroy(): void;
  setInput?(map: Record<string, string>): void;
}
