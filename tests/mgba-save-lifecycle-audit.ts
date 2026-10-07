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

function validateEmeraldState(
  stateAdapter: Gen3StateAdapter,
): {
  mapGroup: number;
  mapNumber: number;
  layoutId: number;
  mapDataAddress: number;
  primaryTilesetAddress: number;
  secondaryTilesetAddress: number;
  width: number;
  height: number;
} {
  const state =
    stateAdapter.readState();

  assert(
    state.game.game ===
      'GEN 3',
    'Unexpected game family after save/reset',
  );

  assert(
    state.game.region ===
      'emerald',
    'Expected Emerald state, got ' +
      state.game.region,
  );

  assert(
    state.map.mapLayoutId !== 0 ||
      state.map.mapLayoutAddress !== 0,
    'Emerald did not reach a valid map state',
  );

  assert(
    state.map.mapDataAddress !== 0,
    'Emerald map data address is zero',
  );

  assert(
    state.map.primaryTilesetAddress !== 0 &&
      state.map.secondaryTilesetAddress !== 0,
    'Emerald tileset address is zero',
  );

  assert(
    state.map.width > 0 &&
      state.map.height > 0,
    'Emerald map dimensions are invalid',
  );

  return {
    mapGroup:
      state.map.mapGroup,
    mapNumber:
      state.map.mapNumber,
    layoutId:
      state.map.mapLayoutId,
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
    stateAdapter.readState();

  assert(
    preSave.game.region ===
      'emerald',
    'Pre-save game was not detected as Emerald',
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
      validateEmeraldState(
        stateAdapter,
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
    validateEmeraldState(
      stateAdapter,
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
