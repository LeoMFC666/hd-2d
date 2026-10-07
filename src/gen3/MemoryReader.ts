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

  readRange(
    address: number,
    length: number,
  ): Uint8Array {
    const bytes =
      new Uint8Array(length);

    const runtime =
      this.runtimeModule;

    const read32 =
      runtime?._mgbawasm_bus_read32;

    let index = 0;

    if (
      typeof read32 ===
        'function'
    ) {
      while (
        index < length &&
        (
          (address + index) & 3
        ) !== 0
      ) {
        bytes[index] =
          this.readU8(
            address + index,
          );

        index++;
      }

      while (
        index + 4 <= length
      ) {
        const value =
          read32.call(
            runtime,
            address + index,
          ) >>> 0;

        bytes[index] =
          value & 0xff;
        bytes[index + 1] =
          (value >>> 8) & 0xff;
        bytes[index + 2] =
          (value >>> 16) & 0xff;
        bytes[index + 3] =
          (value >>> 24) & 0xff;

        index += 4;
      }
    }

    for (
      ;
      index < length;
      index++
    ) {
      bytes[index] =
        this.readU8(
          address + index,
        );
    }

    return bytes;
  }
}
