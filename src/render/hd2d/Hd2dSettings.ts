/**
 * Ajustes do visual HD-2D (referencia: Octopath Traveler).
 *
 * Ficam salvos no navegador e podem ser sobrescritos pela URL para testes:
 *   ?hd2d=0                 modo classico (sem pos-processamento)
 *   ?hd2d.paletteSize=16    qualquer chave abaixo, com "hd2d." na frente
 */

export interface Hd2dSettings {
  // Liga o pipeline HD-2D. Desligado volta ao render direto de antes.
  enabled: boolean;

  // Pixels da tela por "pixel" da cena. 0 = automatico (cerca de 1 pixel
  // do GBA por celula perto do jogador, como o pixel art pede).
  pixelScale: number;

  // Splat gaussiano duro: raio da elipse em celulas (0 = pixel quadrado),
  // quanto cada splat se desloca/varia de tamanho e o degrau da borda.
  splatRadius: number;
  splatJitter: number;
  splatRelief: number;

  // Paleta pequena tirada do proprio quadro (k-means em OKLab). 0 desliga.
  paletteSize: number;

  // Pontilhado ordenado (Bayer) entre as duas cores mais proximas.
  paletteDither: number;

  // Sombras do sol: escuridao do tom de sombra e densidade do pontilhado
  // na umbra (1 = sombra cheia, 0.5 = xadrez).
  shadowStrength: number;
  shadowDither: number;

  // Direcao do sol (graus): azimute a partir do norte, sentido horario.
  sunAzimuth: number;
  sunElevation: number;

  // Profundidade de campo tilt-shift, brilho (bloom), vinheta e gradacao
  // quente/fria.
  depthOfField: number;
  bloom: number;
  vignette: number;
  warmth: number;

  // Neblina de distancia.
  haze: number;
}

export const HD2D_DEFAULTS: Readonly<Hd2dSettings> = {
  // Desligado por enquanto: o foco agora sao os modelos das construcoes.
  enabled: false,
  pixelScale: 0,
  splatRadius: 0.82,
  splatJitter: 0.3,
  splatRelief: 0.1,
  paletteSize: 32,
  paletteDither: 0.4,
  shadowStrength: 0.6,
  shadowDither: 0.55,
  sunAzimuth: 320,
  sunElevation: 48,
  depthOfField: 0.65,
  bloom: 0.45,
  vignette: 0.55,
  warmth: 0.5,
  haze: 0.35,
};

export const HD2D_LIMITS: Record<Exclude<keyof Hd2dSettings, 'enabled'>, [number, number, number]> = {
  // [minimo, maximo, passo]
  pixelScale: [0, 6, 0.5],
  splatRadius: [0, 1.6, 0.02],
  splatJitter: [0, 1, 0.05],
  splatRelief: [0, 0.35, 0.01],
  paletteSize: [0, 64, 4],
  paletteDither: [0, 1, 0.05],
  shadowStrength: [0, 1, 0.05],
  shadowDither: [0.25, 1, 0.05],
  sunAzimuth: [0, 360, 5],
  sunElevation: [15, 85, 1],
  depthOfField: [0, 1, 0.05],
  bloom: [0, 1, 0.05],
  vignette: [0, 1, 0.05],
  warmth: [0, 1, 0.05],
  haze: [0, 1, 0.05],
};

const STORAGE_KEY = 'pkmn25d:hd2d';

function clampSetting(key: keyof typeof HD2D_LIMITS, value: number): number {
  const [min, max] = HD2D_LIMITS[key];

  return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : HD2D_DEFAULTS[key];
}

/** Ajustes salvos + parametros da URL, sobre os padroes. */
export function loadHd2dSettings(): Hd2dSettings {
  const settings: Hd2dSettings = { ...HD2D_DEFAULTS };

  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as Partial<Hd2dSettings> | null;

    if (stored && typeof stored === 'object') {
      applyPartial(settings, stored);
    }
  } catch {
    // Armazenamento indisponivel: fica com os padroes.
  }

  if (typeof location !== 'undefined') {
    const params = new URLSearchParams(location.search);

    if (params.has('hd2d')) {
      settings.enabled = params.get('hd2d') !== '0';
    }

    const fromUrl: Record<string, unknown> = {};

    for (const [name, value] of params) {
      if (name.startsWith('hd2d.')) {
        fromUrl[name.slice(5)] = Number(value);
      }
    }

    applyPartial(settings, fromUrl as Partial<Hd2dSettings>);
  }

  return settings;
}

export function saveHd2dSettings(settings: Hd2dSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Sem armazenamento: o ajuste vale so nesta sessao.
  }
}

function applyPartial(target: Hd2dSettings, source: Partial<Hd2dSettings>): void {
  if (typeof source.enabled === 'boolean') {
    target.enabled = source.enabled;
  }

  for (const key of Object.keys(HD2D_LIMITS) as Array<keyof typeof HD2D_LIMITS>) {
    const value = source[key];

    if (typeof value === 'number') {
      target[key] = clampSetting(key, value);
    }
  }
}
