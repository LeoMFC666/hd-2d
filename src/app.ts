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

  let stateAdapter:
    Gen3StateAdapter | null =
    null;

  const updateStatus =
    (
      message: string,
    ): void => {
      statusEl.textContent =
        message;
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
        !extension ||
        ![
          'gba',
          'gb',
          'gbc',
          'zip',
        ].includes(extension)
      ) {
        updateStatus(
          'Unsupported ROM format. Please select a .gba or compatible cartridge image.',
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

        await emulator.loadRom(
          romBytes,
        );

        scene?.destroy();

        const memoryReader =
          emulator.getMemoryReader();

        stateAdapter =
          new Gen3StateAdapter(
            memoryReader,
            romBytes,
          );

        scene =
          new PlayerRenderer(
            sceneContainer,
            stateAdapter,
            romBytes,
          );

        updateStatus(
          `ROM loaded: ${file.name}`,
        );
      } catch (
        error
      ) {
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

        scene?.suspend();

        try {
          await emulator.importSave(
            buffer,
          );

          // Do not let the renderer read the transient memory state while
          // mGBA is executing ContinueSavedGame and rebuilding gMapHeader.
          // Wait on the actual active-map invariant instead of sleeping a
          // fixed amount of time; the renderer resumes only when the map
          // selected by the save is structurally valid in mGBA memory.
          await stateAdapter?.waitForActiveMapReady();
        } finally {
          scene?.resume();
        }

        updateStatus(
          `Save loaded: ${file.name}`,
        );
      } catch (
        error
      ) {
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
      scene?.destroy();
      emulator.destroy();
    },
  );
}