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

import {
  GameUiOverlay,
} from './ui/GameUiOverlay';

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

  const stage =
    document.querySelector<HTMLElement>(
      '#stage',
    );

  const uiCanvas =
    document.querySelector<HTMLCanvasElement>(
      '#uiOverlay',
    );

  const pipToggle =
    document.querySelector<HTMLButtonElement>(
      '#togglePip',
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
    !statusEl ||
    !stage ||
    !uiCanvas ||
    !pipToggle
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

  let overlay:
    GameUiOverlay | null =
    null;

  stage.dataset.loaded = 'false';
  stage.dataset.pip = 'visible';

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
          'Formato nao suportado. Escolha um arquivo .gba.',
        );

        return;
      }

      updateStatus(
        `Abrindo ${file.name}...`,
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

        const stateAdapter =
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

        overlay?.destroy();

        const activeScene =
          scene;

        // Interface do jogo por cima do 3D: janelas no overworld, tela
        // inteira em batalha e menus de tela cheia.
        overlay =
          new GameUiOverlay(
            uiCanvas,
            emulator,
            memoryReader,
            () => activeScene.isOverworldVisible(),
            mode => {
              stage.dataset.mode = mode;
            },
          );

        overlay.start();

        stage.dataset.loaded = 'true';

        updateStatus(
          `${file.name} aberto.`,
        );
      } catch (
        error
      ) {
        const message =
          error instanceof Error
            ? error.message
            : 'erro desconhecido';

        updateStatus(
          `Nao foi possivel abrir o ROM: ${message}`,
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
          'Formato nao suportado. Escolha um arquivo .sav.',
        );

        return;
      }

      updateStatus(
        `Importando save ${file.name}...`,
      );

      try {
        const buffer =
          await file.arrayBuffer();

        await emulator.importSave(
          buffer,
        );

        updateStatus(
          `Save ${file.name} importado.`,
        );
      } catch (
        error
      ) {
        const message =
          error instanceof Error
            ? error.message
            : 'erro desconhecido';

        updateStatus(
          `Nao foi possivel importar o save: ${message}`,
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
            'Ainda nao ha save para exportar.',
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
          'Save exportado como save.sav.',
        );
      } catch (
        error
      ) {
        const message =
          error instanceof Error
            ? error.message
            : 'erro desconhecido';

        updateStatus(
          `Nao foi possivel exportar o save: ${message}`,
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

  // O estado vem do atributo, nao do texto do botao (o rotulo e traduzido).
  pauseToggle.addEventListener(
    'click',
    () => {
      if (pauseToggle.dataset.state !== 'paused') {
        emulator.pause();
        pauseToggle.dataset.state = 'paused';
        pauseToggle.textContent = 'Continuar';
        updateStatus('Jogo pausado.');

        return;
      }

      emulator.resume();
      pauseToggle.dataset.state = 'running';
      pauseToggle.textContent = 'Pausar';
      updateStatus('Jogo em andamento.');
    },
  );

  pipToggle.addEventListener(
    'click',
    () => {
      const visible =
        stage.dataset.pip !== 'hidden';

      stage.dataset.pip = visible ? 'hidden' : 'visible';
      pipToggle.setAttribute('aria-pressed', String(!visible));
      pipToggle.textContent = visible ? 'Mostrar tela GBA' : 'Esconder tela GBA';
    },
  );

  resetButton.addEventListener(
    'click',
    () => {
      emulator.reset();

      updateStatus(
        'Jogo reiniciado.',
      );
    },
  );

  window.addEventListener(
    'beforeunload',
    () => {
      overlay?.destroy();
      scene?.destroy();
      emulator.destroy();
    },
  );
}