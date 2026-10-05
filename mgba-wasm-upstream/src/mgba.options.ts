import type { JSONSchema } from '@wasm-gaming/engine-specs';

/**
 * Which core boots the ROM. `auto` lets `mCoreFindVF()` sniff the image, which
 * is right for every well-formed dump; the forced modes exist for headerless
 * or mislabelled files.
 */
export type MgbaSystem = 'auto' | 'gba' | 'gb';

/**
 * Game Boy hardware model, for ROMs the GB core boots. `auto` follows the
 * cartridge header (a CGB-aware cart gets CGB, everything else DMG).
 * Maps to mGBA's `gb.model` config value.
 */
export type MgbaGbModel = 'auto' | 'dmg' | 'sgb' | 'cgb' | 'agb';

/**
 * GBA idle-loop handling (`idleOptimization` in mGBA's config).
 * `remove` skips the busy-waits most games spin in, which is where nearly all
 * of the emulator's speed comes from; `ignore` emulates them cycle for cycle.
 */
export type MgbaIdleOptimization = 'ignore' | 'remove' | 'detect';

export type MgbaLogLevel = 'off' | 'error' | 'debug';

export interface MgbaOptions {
  /** Which core boots the ROM: auto-detected, or forced GBA / Game Boy. */
  system?: MgbaSystem;
  /** Game Boy hardware model. Ignored when the GBA core is running. */
  gbModel?: MgbaGbModel;
  /**
   * Idle-loop optimization for the GBA core. `remove` is mGBA's own default
   * and what makes full speed reachable; `ignore` is the accurate-but-slow
   * setting a handful of games need.
   */
  idleOptimization?: MgbaIdleOptimization;
  /**
   * Skip the BIOS intro. Without a real BIOS this is forced on — the HLE
   * BIOS has no intro to run.
   */
  skipBios?: boolean;
  /**
   * Let the D-pad report left+right (or up+down) at once. Real hardware
   * cannot, and a few games misbehave when it happens.
   */
  allowOpposingDirections?: boolean;
  /** Canvas scaling filter: `pixelated` for crisp pixels, `smooth` for linear. */
  renderFilter?: 'pixelated' | 'smooth';
  /**
   * Presented aspect ratio. `native` is square pixels — 3:2 on GBA, 10:9 on
   * Game Boy — which is what the LCDs actually had; `4:3` fills a TV-shaped
   * frame instead.
   */
  aspect?: 'native' | '4:3';
  /**
   * Blend each frame with the previous one, approximating the ghosting of the
   * original unlit LCD. Some games (and most transparency effects done by
   * flickering) were drawn expecting it.
   */
  interframeBlending?: boolean;
  /** Master audio volume, 0.0–1.0. */
  volume?: number;
  /** Poll connected gamepads (standard mapping) each frame. */
  gamepads?: boolean;
  /** Core messages printed to the console. */
  logLevel?: MgbaLogLevel;
  /** Show the demo shell's in-game settings menu on Escape. Defaults to `true`. */
  escMenu?: boolean;
}

export const DEFAULT_MGBA_OPTIONS: Required<MgbaOptions> = {
  system: 'auto',
  gbModel: 'auto',
  idleOptimization: 'remove',
  skipBios: true,
  allowOpposingDirections: false,
  renderFilter: 'pixelated',
  aspect: 'native',
  interframeBlending: false,
  volume: 1.0,
  gamepads: true,
  logLevel: 'error',
  escMenu: true,
};

/** Platform ids consumed by `mgbawasm_setup()` (mPLATFORM_* in core/core.h). */
export const MGBA_PLATFORM_IDS: Record<MgbaSystem, number> = {
  auto: -1,
  gba: 0,
  gb: 1,
};

/** Values mGBA's `gb.model` config key takes; `auto` means "leave unset". */
export const MGBA_GB_MODEL_VALUES: Record<MgbaGbModel, string | null> = {
  auto: null,
  dmg: 'DMG',
  sgb: 'SGB',
  cgb: 'CGB',
  agb: 'AGB',
};

export const MGBA_LOG_LEVEL_IDS: Record<MgbaLogLevel, number> = {
  off: 0,
  error: 1,
  debug: 2,
};

// --------------------------------------------------------------- catalog

/**
 * Settings the SDK can change on a running game, described once here.
 *
 * mGBA keeps its configuration in an `mCoreConfig` the core re-reads when the
 * frontend calls `reloadConfigOption()`, so most of these reach the emulation
 * without a restart; the ones that are consumed while the cartridge is being
 * mapped (the system, the Game Boy model, the BIOS) are tagged `requiresReset`.
 * The rest — canvas filtering, aspect, blending, volume — never reach the core
 * at all and are applied by the SDK.
 *
 * `DEFAULT_MGBA_OPTIONS`, the manifest's options schema and the demo shell's
 * ESC menu are all derived from this catalog, so adding a row here is enough to
 * expose a new setting.
 */
export type MgbaOptionKey = Exclude<keyof MgbaOptions, 'escMenu'>;

export type MgbaOptionValue = boolean | string | number;

interface OptionSpecBase {
  /** Option key, as used in `EngineConfig.options` and the manifest schema. */
  key: MgbaOptionKey;
  label: string;
  description: string;
  /**
   * Takes effect on the next power-on rather than immediately — the ESC menu
   * tags these, and the SDK applies them from `reset()`.
   */
  requiresReset?: boolean;
}

/** One selectable value, as offered by the menu. */
export interface MgbaChoice<T> {
  value: T;
  label: string;
}

export type MgbaOptionSpec = OptionSpecBase &
  (
    | { type: 'boolean'; default: boolean }
    | { type: 'enum'; default: string; values: MgbaChoice<string>[] }
    | {
        type: 'number';
        default: number;
        /** Values the menu cycles through; the schema may still take a range. */
        values: MgbaChoice<number>[];
        integer?: boolean;
        /**
         * When set, the schema advertises this range instead of the menu's
         * choices, so hosts can pass values the menu does not offer.
         */
        range?: { minimum: number; maximum: number };
      }
  );

export interface MgbaOptionGroup {
  id: string;
  label: string;
  options: MgbaOptionSpec[];
}

export const MGBA_OPTION_GROUPS: MgbaOptionGroup[] = [
  {
    id: 'video',
    label: 'Video',
    options: [
      {
        key: 'renderFilter',
        label: 'Image filtering',
        description:
          'Scaling filter applied when the picture is stretched to the canvas. Pixelated keeps pixel art crisp; smooth softens it.',
        type: 'enum',
        default: DEFAULT_MGBA_OPTIONS.renderFilter,
        values: [
          { value: 'pixelated', label: 'Pixelated' },
          { value: 'smooth', label: 'Smooth' },
        ],
      },
      {
        key: 'aspect',
        label: 'Aspect ratio',
        description:
          'Native is square pixels, as the handheld LCDs had them: 3:2 on GBA, 10:9 on Game Boy. 4:3 stretches the picture into a TV-shaped frame.',
        type: 'enum',
        default: DEFAULT_MGBA_OPTIONS.aspect,
        values: [
          { value: 'native', label: 'Native' },
          { value: '4:3', label: '4:3' },
        ],
      },
      {
        key: 'interframeBlending',
        label: 'Interframe blending',
        description:
          'Blend each frame with the previous one, approximating the ghosting of the original unlit LCD. Restores transparency effects that games drew by flickering sprites every other frame.',
        type: 'boolean',
        default: DEFAULT_MGBA_OPTIONS.interframeBlending,
      },
    ],
  },
  {
    id: 'audio',
    label: 'Audio',
    options: [
      {
        key: 'volume',
        label: 'Volume',
        description: 'Master audio volume.',
        type: 'number',
        default: DEFAULT_MGBA_OPTIONS.volume,
        values: [
          { value: 0, label: 'Mute' },
          { value: 0.25, label: '25%' },
          { value: 0.5, label: '50%' },
          { value: 0.75, label: '75%' },
          { value: 1, label: '100%' },
        ],
        range: { minimum: 0, maximum: 1 },
      },
    ],
  },
  {
    id: 'emulation',
    label: 'Emulation',
    options: [
      {
        key: 'system',
        label: 'System',
        description:
          'Which core boots the ROM. Auto sniffs the image, which is right for every well-formed dump; force it for headerless or mislabelled files.',
        type: 'enum',
        default: DEFAULT_MGBA_OPTIONS.system,
        requiresReset: true,
        values: [
          { value: 'auto', label: 'Auto' },
          { value: 'gba', label: 'GBA' },
          { value: 'gb', label: 'Game Boy' },
        ],
      },
      {
        key: 'gbModel',
        label: 'Game Boy model',
        description:
          'Hardware the Game Boy core emulates. Auto follows the cartridge header. Ignored when a GBA ROM is loaded.',
        type: 'enum',
        default: DEFAULT_MGBA_OPTIONS.gbModel,
        requiresReset: true,
        values: [
          { value: 'auto', label: 'Auto' },
          { value: 'dmg', label: 'DMG' },
          { value: 'sgb', label: 'Super GB' },
          { value: 'cgb', label: 'Color' },
          { value: 'agb', label: 'GBA' },
        ],
      },
      {
        key: 'idleOptimization',
        label: 'Idle loops',
        description:
          'How the GBA core treats the busy-wait loops games spin in. Remove skips them and is where nearly all of the speed comes from; ignore emulates them cycle for cycle.',
        type: 'enum',
        default: DEFAULT_MGBA_OPTIONS.idleOptimization,
        values: [
          { value: 'remove', label: 'Remove' },
          { value: 'detect', label: 'Detect' },
          { value: 'ignore', label: 'Ignore' },
        ],
      },
      {
        key: 'skipBios',
        label: 'Skip BIOS intro',
        description:
          'Jump straight into the game instead of playing the boot animation. Forced on when no BIOS image was supplied, since the built-in HLE BIOS has no intro.',
        type: 'boolean',
        default: DEFAULT_MGBA_OPTIONS.skipBios,
        requiresReset: true,
      },
    ],
  },
  {
    id: 'controllers',
    label: 'Controllers',
    options: [
      {
        key: 'allowOpposingDirections',
        label: 'Opposing directions',
        description:
          'Let the D-pad report left+right (or up+down) at once. Real hardware cannot, and a few games misbehave when it happens.',
        type: 'boolean',
        default: DEFAULT_MGBA_OPTIONS.allowOpposingDirections,
      },
      {
        key: 'gamepads',
        label: 'Gamepads',
        description: 'Poll connected gamepads (standard mapping) each frame.',
        type: 'boolean',
        default: DEFAULT_MGBA_OPTIONS.gamepads,
      },
    ],
  },
  {
    id: 'debug',
    label: 'Debug',
    options: [
      {
        key: 'logLevel',
        label: 'Core logging',
        description:
          'Core messages printed to the browser console: errors and warnings, or also its informational ones.',
        type: 'enum',
        default: DEFAULT_MGBA_OPTIONS.logLevel,
        values: [
          { value: 'off', label: 'Off' },
          { value: 'error', label: 'Errors' },
          { value: 'debug', label: 'Debug' },
        ],
      },
    ],
  },
];

/** Flat view of every runtime-tweakable option across all groups. */
export const MGBA_ENGINE_OPTIONS: MgbaOptionSpec[] = MGBA_OPTION_GROUPS.flatMap(
  (group) => group.options,
);

const OPTION_BY_KEY = new Map<string, MgbaOptionSpec>(
  MGBA_ENGINE_OPTIONS.map((option) => [option.key, option]),
);

export function mgbaOption(key: string): MgbaOptionSpec | undefined {
  return OPTION_BY_KEY.get(key);
}

/**
 * Coerces a host- or storage-supplied value to what the option accepts,
 * returning `undefined` when it is not a value the option can take. Numbers
 * outside a `range` are clamped rather than rejected; enums are exact.
 */
export function coerceOptionValue(
  option: MgbaOptionSpec,
  value: unknown,
): MgbaOptionValue | undefined {
  if (option.type === 'boolean') {
    return typeof value === 'boolean' ? value : undefined;
  }

  if (option.type === 'enum') {
    const next = String(value);
    return option.values.some((choice) => choice.value === next) ? next : undefined;
  }

  const next = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(next)) return undefined;
  if (option.range) {
    return Math.min(option.range.maximum, Math.max(option.range.minimum, next));
  }
  return option.values.some((choice) => choice.value === next) ? next : undefined;
}

// ------------------------------------------------- engine-specs ESC menu

/** One row as the `esc-menu` component of the demo shell renders it. */
export interface EscMenuOption {
  key: string;
  label: string;
  description: string;
  type: 'boolean' | 'enum';
  value: MgbaOptionValue;
  values?: MgbaChoice<MgbaOptionValue>[];
  requiresReset?: boolean;
}

export interface EscMenuGroup {
  id: string;
  label: string;
  options: EscMenuOption[];
}

/**
 * Projects the catalog onto the shape `@wasm-gaming/engine-specs` (>=0.2.5)
 * feeds its `esc-menu` component.
 *
 * The menu lives in the demo shell now, not in this package: the shell renders
 * the rows and emits `option-change`, and the host writes the value back
 * through `engine.config`. Since the component only draws chips for `boolean`
 * and `enum`, numeric options are handed over as an enum of their menu choices
 * — the numbers survive, because the chips compare values with `===`.
 *
 * Pass the running engine's `config.values()` so the menu opens on what the
 * emulator is actually set to rather than on this package's defaults.
 */
export function toEscMenuGroups(
  values: Record<string, MgbaOptionValue> = {},
): EscMenuGroup[] {
  return MGBA_OPTION_GROUPS.map((group) => ({
    id: group.id,
    label: group.label,
    options: group.options.map((option): EscMenuOption => ({
      key: option.key,
      label: option.label,
      description: option.description,
      type: option.type === 'boolean' ? 'boolean' : 'enum',
      value: values[option.key] ?? option.default,
      ...(option.type === 'boolean' ? {} : { values: option.values }),
      ...(option.requiresReset ? { requiresReset: true } : {}),
    })),
  }));
}

// -------------------------------------------------------------- schema

function schemaForOption(option: MgbaOptionSpec): JSONSchema {
  if (option.type === 'boolean') {
    return { type: 'boolean', default: option.default, description: option.description };
  }
  if (option.type === 'enum') {
    return {
      type: 'string',
      enum: option.values.map((choice) => choice.value),
      default: option.default,
      description: option.description,
    };
  }
  return {
    type: option.integer ? 'integer' : 'number',
    default: option.default,
    ...(option.range
      ? { minimum: option.range.minimum, maximum: option.range.maximum }
      : { enum: option.values.map((choice) => choice.value) }),
    description: option.description,
  };
}

export const MGBA_OPTIONS_SCHEMA: JSONSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    ...Object.fromEntries(
      MGBA_ENGINE_OPTIONS.map((option) => [option.key, schemaForOption(option)]),
    ),
    escMenu: {
      type: 'boolean',
      default: true,
      description: "Show the demo shell's in-game settings menu when the player presses Escape.",
    },
  },
};
