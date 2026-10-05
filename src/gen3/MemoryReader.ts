export type MemoryWordSize = 8 | 16 | 32;

export interface MemoryReader {
  readU8(address: number): number;
  readU16(address: number): number;
  readU32(address: number): number;
  readRange(address: number, length: number): Uint8Array;
}

export class MgbaMemoryReader implements MemoryReader {
  private readonly runtimeModule: any;

  constructor(runtimeModule: any) {
    this.runtimeModule = runtimeModule;
  }

  readU8(address: number): number {
    const runtime = this.runtimeModule;
    if (typeof runtime?._mgbawasm_bus_read8 === 'function') {
      return runtime._mgbawasm_bus_read8(address) & 0xff;
    }
    return runtime?.HEAPU8?.[address] ?? 0;
  }

  readU16(address: number): number {
    const runtime = this.runtimeModule;
    if (typeof runtime?._mgbawasm_bus_read16 === 'function') {
      return runtime._mgbawasm_bus_read16(address) & 0xffff;
    }
    return runtime?.HEAP16?.[address >> 1] ?? 0;
  }

  readU32(address: number): number {
    const runtime = this.runtimeModule;
    if (typeof runtime?._mgbawasm_bus_read32 === 'function') {
      return runtime._mgbawasm_bus_read32(address) >>> 0;
    }
    return runtime?.HEAPU32?.[address >> 2] ?? 0;
  }

  readRange(address: number, length: number): Uint8Array {
    const bytes = new Uint8Array(length);
    for (let i = 0; i < length; i++) {
      bytes[i] = this.readU8(address + i);
    }
    return bytes;
  }
}
