import {
  HD2D_DEFAULTS,
  HD2D_LIMITS,
  saveHd2dSettings,
  type Hd2dSettings,
} from '../render/hd2d/Hd2dSettings';

/**
 * Painel de ajustes do visual HD-2D. Muda o objeto de ajustes em uso (o
 * pipeline le a cada quadro) e salva no navegador.
 */

type NumericKey = keyof typeof HD2D_LIMITS;

interface Control {
  key: NumericKey;
  label: string;
  format?: (value: number) => string;
}

const GROUPS: Array<{ title: string; controls: Control[] }> = [
  {
    title: 'Splat e paleta',
    controls: [
      { key: 'splatRadius', label: 'Raio do splat', format: v => (v === 0 ? 'pixel' : v.toFixed(2)) },
      { key: 'splatJitter', label: 'Variação do splat' },
      { key: 'splatRelief', label: 'Relevo da borda' },
      { key: 'paletteSize', label: 'Cores na paleta', format: v => (v < 2 ? 'livre' : String(v)) },
      { key: 'paletteDither', label: 'Pontilhado da paleta' },
      { key: 'pixelScale', label: 'Tamanho do pixel', format: v => (v === 0 ? 'auto' : `${v}×`) },
    ],
  },
  {
    title: 'Luz e sombra',
    controls: [
      { key: 'shadowStrength', label: 'Sombra' },
      { key: 'shadowDither', label: 'Densidade do pontilhado' },
      { key: 'sunAzimuth', label: 'Direção do sol', format: v => `${Math.round(v)}°` },
      { key: 'sunElevation', label: 'Altura do sol', format: v => `${Math.round(v)}°` },
    ],
  },
  {
    title: 'Câmera',
    controls: [
      { key: 'depthOfField', label: 'Profundidade de campo' },
      { key: 'bloom', label: 'Brilho (bloom)' },
      { key: 'vignette', label: 'Vinheta' },
      { key: 'warmth', label: 'Quente / frio' },
      { key: 'haze', label: 'Neblina' },
    ],
  },
];

const defaultFormat = (value: number): string => `${Math.round(value * 100)}%`;

export class Hd2dPanel {
  private readonly settings: Hd2dSettings;

  private readonly toggle: HTMLButtonElement;

  private readonly body: HTMLElement;

  private readonly inputs = new Map<NumericKey, { input: HTMLInputElement; output: HTMLOutputElement }>();

  constructor(toggle: HTMLButtonElement, panel: HTMLElement, settings: Hd2dSettings) {
    this.settings = settings;
    this.toggle = toggle;
    this.body = panel;

    toggle.addEventListener('click', () => {
      settings.enabled = !settings.enabled;
      this.commit();
    });

    this.build();
    this.sync();
  }

  private build(): void {
    const form = document.createElement('form');

    form.className = 'hd2d-form';
    form.addEventListener('submit', event => event.preventDefault());

    for (const group of GROUPS) {
      const fieldset = document.createElement('fieldset');
      const legend = document.createElement('legend');

      legend.textContent = group.title;
      fieldset.append(legend);

      for (const control of group.controls) {
        const [min, max, step] = HD2D_LIMITS[control.key];
        const id = `hd2d-${control.key}`;
        const row = document.createElement('div');
        const label = document.createElement('label');
        const input = document.createElement('input');
        const output = document.createElement('output');

        row.className = 'hd2d-row';
        label.htmlFor = id;
        label.textContent = control.label;

        input.type = 'range';
        input.id = id;
        input.min = String(min);
        input.max = String(max);
        input.step = String(step);

        output.htmlFor.add(id);

        input.addEventListener('input', () => {
          this.settings[control.key] = Number(input.value);
          output.textContent = (control.format ?? defaultFormat)(Number(input.value));
          this.commit(false);
        });

        row.append(label, input, output);
        fieldset.append(row);

        this.inputs.set(control.key, { input, output });
      }

      form.append(fieldset);
    }

    const reset = document.createElement('button');

    reset.type = 'button';
    reset.className = 'hd2d-reset';
    reset.textContent = 'Restaurar padrões';
    reset.addEventListener('click', () => {
      Object.assign(this.settings, HD2D_DEFAULTS, { enabled: this.settings.enabled });
      this.commit();
    });

    form.append(reset);
    this.body.append(form);
  }

  private commit(resync = true): void {
    saveHd2dSettings(this.settings);

    if (resync) {
      this.sync();
    } else {
      this.syncToggle();
    }
  }

  private sync(): void {
    for (const group of GROUPS) {
      for (const control of group.controls) {
        const entry = this.inputs.get(control.key);

        if (!entry) {
          continue;
        }

        entry.input.value = String(this.settings[control.key]);
        entry.output.textContent = (control.format ?? defaultFormat)(this.settings[control.key]);
      }
    }

    this.syncToggle();
  }

  private syncToggle(): void {
    const on = this.settings.enabled;

    this.toggle.setAttribute('aria-pressed', String(on));
    this.toggle.textContent = on ? 'Visual: HD-2D' : 'Visual: clássico';
    this.body.toggleAttribute('data-disabled', !on);
  }
}
