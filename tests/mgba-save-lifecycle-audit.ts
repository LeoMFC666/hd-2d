import { Gen3StateAdapter } from '../src/gen3/Gen3StateAdapter';
import type { MemoryReader } from '../src/gen3/MemoryReader';

declare global {
  interface Window {
    createMgbaModule?: (
      overrides: Record<string, unknown>,
    ) => Promise<any>;
  }
}

const EWRAM_START = 0x02000000;
const EWRAM_END = 0x02040000;

class RuntimeMemoryReader implements MemoryReader {
  constructor(
    private readonly module: any,
  ) {}

  readU8(address: number): number {
    return (
      this.module._mgbawasm_bus_read8(
        address,
      ) & 0xff
    );
  }

  readU16(address: number): number {
    return (
      this.module._mgbawasm_bus_read16(
        address,
      ) & 0xffff
    );
  }

  readU32(address: number): number {
    return (
      this.module._mgbawasm_bus_read32(
        address,
      ) >>> 0
    );
  }

  readRange(
    address: number,
    length: number,
  ): Uint8Array {
    const output =
      new Uint8Array(length);

    for (
      let index = 0;
      index < length;
      index++
    ) {
      output[index] =
        this.readU8(
          address + index,
        );
    }

    return output;
  }
}

function assert(
  condition: unknown,
  message: string,
): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function wait(
  milliseconds: number,
): Promise<void> {
  return new Promise(
    resolve =>
      setTimeout(
        resolve,
        milliseconds,
      ),
  );
}

async function loadMgbaScript(): Promise<void> {
  await new Promise<void>(
    (
      resolve,
      reject,
    ) => {
      const script =
        document.createElement(
          'script',
        );

      script.src =
        '/mgba/mgba.js';

      script.onload =
        () => resolve();

      script.onerror =
        () =>
          reject(
            new Error(
              'Failed to load /mgba/mgba.js',
            ),
          );

      document.head.appendChild(
        script,
      );
    },
  );
}

async function runFrames(
  module: any,
  count: number,
): Promise<void> {
  for (
    let index = 0;
    index < count;
    index++
  ) {
    module._mgbawasm_run_frame();
  }

  await wait(50);
}

function inspectEmeraldState(
  stateAdapter: Gen3StateAdapter,
  reader: RuntimeMemoryReader,
): {
  mapGroup: number;
  mapNumber: number;
  layoutId: number;
  saveBlock1Address: number;
  mapDataAddress: number;
  primaryTilesetAddress: number;
  secondaryTilesetAddress: number;
  width: number;
  height: number;
} {
  const state =
    stateAdapter.readState();

  assert(
    state.game.region ===
      'emerald',
    'Expected Emerald state, got ' +
      state.game.region,
  );

  const saveBlock1Address =
    reader.readU32(0x03005d8c) >>> 0;

  assert(
    saveBlock1Address >=
      0x02000000 &&
      saveBlock1Address <
        0x02040000,
    'Emerald SaveBlock1 pointer is invalid: 0x' +
      saveBlock1Address.toString(16),
  );

  const mapGroup =
    reader.readU8(
      saveBlock1Address + 0x04,
    );

  const mapNumber =
    reader.readU8(
      saveBlock1Address + 0x05,
    );

  const layoutId =
    reader.readU16(
      saveBlock1Address + 0x32,
    );

  return {
    mapGroup,
    mapNumber,
    layoutId,
    saveBlock1Address,
    mapDataAddress:
      state.map.mapDataAddress,
    primaryTilesetAddress:
      state.map.primaryTilesetAddress,
    secondaryTilesetAddress:
      state.map.secondaryTilesetAddress,
    width:
      state.map.width,
    height:
      state.map.height,
  };
}

async function main(): Promise<void> {
  const rom =
    new Uint8Array(
      await (
        await fetch(
          '/Pokemon - Emerald Version (USA, Europe).gba',
        )
      ).arrayBuffer(),
    );

  const save =
    new Uint8Array(
      await (
        await fetch(
          '/save.sav',
        )
      ).arrayBuffer(),
    );

  assert(
    rom.length ===
      0x1000000,
    'Unexpected Emerald ROM size: ' +
      rom.length,
  );

  assert(
    save.length ===
      0x20000,
    'Unexpected Emerald save size: ' +
      save.length,
  );

  await loadMgbaScript();

  assert(
    typeof window.createMgbaModule ===
      'function',
    'mGBA createMgbaModule was not exposed',
  );

  const module =
    await window.createMgbaModule({
      locateFile(
        path: string,
      ) {
        return (
          '/mgba/' +
          path
        );
      },
    });

  assert(
    typeof module._mgbawasm_init ===
      'function',
    'mGBA init export missing',
  );

  assert(
    typeof module._mgbawasm_load ===
      'function',
    'mGBA ROM load export missing',
  );

  assert(
    typeof module._mgbawasm_sram_load ===
      'function',
    'mGBA SRAM load export missing',
  );

  assert(
    typeof module._mgbawasm_reset ===
      'function',
    'mGBA reset export missing',
  );

  assert(
    typeof module._mgbawasm_run_frame ===
      'function',
    'mGBA frame export missing',
  );

  module._mgbawasm_init();

  const romPointer =
    module._malloc(
      rom.length,
    );

  module.HEAPU8.set(
    rom,
    romPointer,
  );

  const loaded =
    module._mgbawasm_load(
      romPointer,
      rom.length,
      0,
      0,
      0,
      0,
      1,
    );

  module._free(
    romPointer,
  );

  assert(
    loaded,
    'mGBA rejected Emerald ROM',
  );

  const reader =
    new RuntimeMemoryReader(
      module,
    );

  const stateAdapter =
    new Gen3StateAdapter(
      reader,
      rom,
    );

  await runFrames(
    module,
    240,
  );

  const preSave =
    inspectEmeraldState(
      stateAdapter,
      reader,
    );

  const cycleResults:
    Array<{
      cycle: number;
      mapGroup: number;
      mapNumber: number;
      layoutId: number;
      mapDataAddress: string;
      width: number;
      height: number;
    }> = [];

  for (
    let cycle = 1;
    cycle <= 5;
    cycle++
  ) {
    module._mgbawasm_pause?.();

    const savePointer =
      module._malloc(
        save.length,
      );

    module.HEAPU8.set(
      save,
      savePointer,
    );

    const saveLoaded =
      module._mgbawasm_sram_load(
        savePointer,
        save.length,
      );

    module._free(
      savePointer,
    );

    assert(
      saveLoaded,
      'mGBA rejected Emerald save on cycle ' +
        cycle,
    );

    module._mgbawasm_reset();

    await runFrames(
      module,
      240,
    );

    const state =
      inspectEmeraldState(
        stateAdapter,
        reader,
      );

    const header =
      reader.readRange(
        0x080000a0,
        0x1c,
      );

    const gameCode =
      new TextDecoder().decode(
        header.slice(
          0x0c,
          0x10,
        ),
      );

    assert(
      gameCode ===
        'BPEE',
      'ROM header changed after save cycle ' +
        cycle,
    );

    cycleResults.push({
      cycle,
      mapGroup:
        state.mapGroup,
      mapNumber:
        state.mapNumber,
      layoutId:
        state.layoutId,
      mapDataAddress:
        '0x' +
        state.mapDataAddress.toString(
          16,
        ),
      width:
        state.width,
      height:
        state.height,
    });

    await wait(100);
  }

  module._mgbawasm_reset();

  await runFrames(
    module,
    240,
  );

  const postReset =
    inspectEmeraldState(
      stateAdapter,
      reader,
    );

  assert(
    postReset.mapDataAddress !==
      0,
    'Emerald state became invalid after standalone reset',
  );

  if (
    typeof module._mgbawasm_unload ===
    'function'
  ) {
    module._mgbawasm_unload();
  }

  const result = {
    pass: true,
    rom: {
      gameCode: 'BPEE',
      size: rom.length,
    },
    save: {
      size: save.length,
      cycles: cycleResults,
      preSave,
    },
    postReset,
    ewramRange: [
      EWRAM_START,
      EWRAM_END,
    ],
  };

  document.body.dataset.pass =
    'true';

  document.querySelector(
    '#out',
  )!.textContent =
    JSON.stringify(
      result,
      null,
      2,
    );
}

main().catch(
  error => {
    document.body.dataset.pass =
      'false';

    document.querySelector(
      '#out',
    )!.textContent =
      JSON.stringify(
        {
          pass: false,
          error:
            error instanceof Error
              ? error.stack
              : String(error),
        },
        null,
        2,
      );

    throw error;
  },
);
