import type {
  EmulatorAdapter,
} from './emulator/EmulatorAdapter';

import {
  MgbaEmulatorAdapter,
} from './emulator/Emulator';

import {
  Gen3StateAdapter,
} from './gen3/Gen3StateAdapter';

import {
  PlayerRenderer,
} from './render/PlayerRenderer';

export function setupApp(): void {
  const canvas =
    document.querySelector<HTMLCanvasElement>(
      '#emulator',
    );

  const sceneContainer =
    document.querySelector<HTMLElement>(
      '#sceneContainer',
    );

  const romInput =
    document.querySelector<HTMLInputElement>(
      '#romInput',
    );

  const saveInput =
    document.querySelector<HTMLInputElement>(
      '#saveInput',
    );

  const loadRomButton =
    document.querySelector<HTMLButtonElement>(
      '#loadRom',
    );

  const importSaveButton =
    document.querySelector<HTMLButtonElement>(
      '#importSave',
    );

  const exportSaveButton =
    document.querySelector<HTMLButtonElement>(
      '#exportSave',
    );

  const pauseToggle =
    document.querySelector<HTMLButtonElement>(
      '#pauseToggle',
    );

  const resetButton =
    document.querySelector<HTMLButtonElement>(
      '#resetGame',
    );

  const statusEl =
    document.querySelector<HTMLElement>(
      '#status',
    );

  if (
    !canvas ||
    !sceneContainer ||
    !romInput ||
    !saveInput ||
    !loadRomButton ||
    !importSaveButton ||
    !exportSaveButton ||
    !pauseToggle ||
    !resetButton ||
    !statusEl
  ) {
    throw new Error(
      'Missing required app elements.',
    );
  }

  const emulator:
    EmulatorAdapter =
    new MgbaEmulatorAdapter(
      canvas,
    );

  let scene:
    PlayerRenderer | null =
    null;

  let currentRomBytes:
    Uint8Array | null =
    null;

  const updateStatus =
    (
      message: string,
    ): void => {
      statusEl.textContent =
        message;
    };

  const destroyScene =
    (): void => {
      scene?.destroy();
      scene = null;
    };

  const createScene =
    (): void => {
      if (
        !currentRomBytes
      ) {
        throw new Error(
          'No ROM is loaded.',
        );
      }

      destroyScene();

      const memoryReader =
        emulator.getMemoryReader();

      const stateAdapter =
        new Gen3StateAdapter(
          memoryReader,
          currentRomBytes,
        );

      scene =
        new PlayerRenderer(
          sceneContainer,
          stateAdapter,
          currentRomBytes,
        );
    };

  const waitForStableGameplayState =
    async (
      timeoutMs = 3000,
    ): Promise<boolean> => {
      if (
        !currentRomBytes
      ) {
        return false;
      }

      const stateAdapter =
        new Gen3StateAdapter(
          emulator.getMemoryReader(),
          currentRomBytes,
        );

      const startedAt =
        performance.now();

      let previousKey =
        '';

      let stableReads =
        0;

      while (
        performance.now() -
          startedAt <
        timeoutMs
      ) {
        const state =
          stateAdapter.readState();

        const validMap =
          state.map.mapLayoutAddress !== 0 &&
          state.map.mapDataAddress !== 0 &&
          state.map.primaryTilesetAddress !== 0 &&
          state.map.secondaryTilesetAddress !== 0 &&
          state.map.width > 0 &&
          state.map.height > 0;

        if (
          validMap
        ) {
          const key =
            [
              state.map.mapGroup,
              state.map.mapNumber,
              state.map.mapLayoutId,
              state.map.mapLayoutAddress,
              state.map.mapDataAddress,
              state.map.width,
              state.map.height,
            ].join(':');

          if (
            key ===
            previousKey
          ) {
            stableReads++;
          } else {
            previousKey =
              key;
            stableReads =
              1;
          }

          if (
            stableReads >=
            3
          ) {
            return true;
          }
        } else {
          previousKey =
            '';
          stableReads =
            0;
        }

        await new Promise<void>(
          resolve => {
            window.setTimeout(
              resolve,
              50,
            );
          },
        );
      }

      return false;
    };

  const readRomFile =
    async (
      file: File,
    ): Promise<void> => {
      const extension =
        file.name
          .split('.')
          .pop()
          ?.toLowerCase();

      if (
        extension !==
        'gba'
      ) {
        updateStatus(
          'Please extract the ROM and select the .gba file.',
        );

        return;
      }

      updateStatus(
        `Loading ${file.name}...`,
      );

      try {
        const buffer =
          await file.arrayBuffer();

        const romBytes =
          new Uint8Array(
            buffer,
          );

        emulator.pause();
        destroyScene();

        currentRomBytes =
          null;

        await emulator.loadRom(
          romBytes,
        );

        currentRomBytes =
          romBytes;

        await waitForStableGameplayState();

        createScene();

        updateStatus(
          `ROM loaded: ${file.name}`,
        );
      } catch (
        error
      ) {
        currentRomBytes =
          null;

        destroyScene();

        const message =
          error instanceof Error
            ? error.message
            : 'Unknown ROM load error.';

        updateStatus(
          `ROM failed to load: ${message}`,
        );
      }
    };

  const readSaveFile =
    async (
      file: File,
    ): Promise<void> => {
      const extension =
        file.name
          .split('.')
          .pop()
          ?.toLowerCase();

      if (
        !extension ||
        !['sav'].includes(
          extension,
        )
      ) {
        updateStatus(
          'Unsupported save format. Please select a .sav file.',
        );

        return;
      }

      updateStatus(
        `Loading save ${file.name}...`,
      );

      try {
        const buffer =
          await file.arrayBuffer();

        if (
          !currentRomBytes
        ) {
          throw new Error(
            'Load a .gba ROM before importing a save.',
          );
        }

        emulator.pause();

        destroyScene();

        await emulator.importSave(
          buffer,
        );

        emulator.resume();

        await waitForStableGameplayState();

        createScene();

        updateStatus(
          `Save loaded: ${file.name}`,
        );
      } catch (
        error
      ) {
        emulator.resume();

        try {
          if (
            currentRomBytes &&
            !scene
          ) {
            createScene();
          }
        } catch {
          // Keep the original save error visible.
        }

        const message =
          error instanceof Error
            ? error.message
            : 'Unknown save load error.';

        updateStatus(
          `Save failed to load: ${message}`,
        );
      }
    };

  const downloadSave =
    async (): Promise<void> => {
      try {
        const bytes =
          await emulator.exportSave();

        if (
          !bytes.length
        ) {
          updateStatus(
            'No save data is available to export yet.',
          );

          return;
        }

        const saveBuffer =
          new ArrayBuffer(
            bytes.length,
          );

        new Uint8Array(
          saveBuffer,
        ).set(bytes);

        const blob =
          new Blob(
            [saveBuffer],
            {
              type:
                'application/octet-stream',
            },
          );

        const url =
          URL.createObjectURL(
            blob,
          );

        const link =
          document.createElement(
            'a',
          );

        link.href =
          url;

        link.download =
          'save.sav';

        link.click();

        URL.revokeObjectURL(
          url,
        );

        updateStatus(
          'Save exported as save.sav',
        );
      } catch (
        error
      ) {
        const message =
          error instanceof Error
            ? error.message
            : 'Unknown save export error.';

        updateStatus(
          `Save failed to export: ${message}`,
        );
      }
    };

  loadRomButton.addEventListener(
    'click',
    () => {
      romInput.click();
    },
  );

  importSaveButton.addEventListener(
    'click',
    () => {
      saveInput.click();
    },
  );

  exportSaveButton.addEventListener(
    'click',
    () => {
      void downloadSave();
    },
  );

  romInput.addEventListener(
    'change',
    async () => {
      const file =
        romInput.files?.[0];

      if (!file) {
        return;
      }

      await readRomFile(
        file,
      );

      romInput.value =
        '';
    },
  );

  saveInput.addEventListener(
    'change',
    async () => {
      const file =
        saveInput.files?.[0];

      if (!file) {
        return;
      }

      await readSaveFile(
        file,
      );

      saveInput.value =
        '';
    },
  );

  pauseToggle.addEventListener(
    'click',
    () => {
      if (
        pauseToggle.textContent ===
        'Pause'
      ) {
        emulator.pause();

        pauseToggle.textContent =
          'Resume';

        updateStatus(
          'Emulator paused.',
        );

        return;
      }

      emulator.resume();

      pauseToggle.textContent =
        'Pause';

      updateStatus(
        'Emulator resumed.',
      );
    },
  );

  resetButton.addEventListener(
    'click',
    () => {
      emulator.reset();

      updateStatus(
        'Emulator reset.',
      );
    },
  );

  window.addEventListener(
    'beforeunload',
    () => {
      destroyScene();
      emulator.destroy();
    },
  );
}