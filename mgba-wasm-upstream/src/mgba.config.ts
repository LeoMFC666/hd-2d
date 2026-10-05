import {
  coerceOptionValue,
  mgbaOption,
  MGBA_ENGINE_OPTIONS,
  type MgbaOptionKey,
  type MgbaOptionValue,
} from './mgba.options.js';

/**
 * Pushes a value into the running emulator: an `mCoreConfig` write followed by
 * `reloadConfigOption()`, a canvas style change, a gain node — whatever that
 * option means. Called after the value has been validated and recorded.
 */
export type MgbaApplier = (value: MgbaOptionValue) => void;

/**
 * The appliers the SDK installs for the build it actually loaded. An option
 * with no applier is reported as unsupported and disappears from the menu,
 * which is what keeps this package usable against an `mgba.wasm` built before
 * a given shim setter existed.
 */
export type MgbaAppliers = Partial<Record<MgbaOptionKey, MgbaApplier>>;

/**
 * Typed façade over the emulator's live settings.
 *
 * mGBA does own a configuration object — the `mCoreConfig` embedded in every
 * `mCore` — but it is C-side and the SDK keeps the rest (canvas, audio graph,
 * frame blending) in JS, so `state` is the record both this façade and the
 * running SDK read from, and every write goes through the matching applier.
 */
export interface MgbaConfig {
  supports(key: string): boolean;
  read(key: string): MgbaOptionValue | undefined;
  /** Returns `false` when the key is unknown, unsupported, or the value invalid. */
  write(key: string, value: MgbaOptionValue): boolean;
  /** Current value of every supported option. */
  values(): Record<string, MgbaOptionValue>;
  /** Restores this package's declared defaults. */
  restoreDefaults(): void;
}

export function bindConfig(
  state: Record<string, MgbaOptionValue>,
  appliers: MgbaAppliers,
): MgbaConfig {
  const applierFor = (key: string): MgbaApplier | undefined =>
    appliers[key as MgbaOptionKey];

  const supports = (key: string): boolean =>
    Boolean(mgbaOption(key)) && applierFor(key) !== undefined;

  const read = (key: string): MgbaOptionValue | undefined =>
    mgbaOption(key) ? state[key] : undefined;

  const write = (key: string, value: MgbaOptionValue): boolean => {
    const option = mgbaOption(key);
    const apply = applierFor(key);
    if (!option || !apply) return false;

    const next = coerceOptionValue(option, value);
    if (next === undefined) return false;

    state[key] = next;
    apply(next);
    return true;
  };

  return {
    supports,
    read,
    write,
    values() {
      const snapshot: Record<string, MgbaOptionValue> = {};
      for (const option of MGBA_ENGINE_OPTIONS) {
        if (supports(option.key)) snapshot[option.key] = state[option.key];
      }
      return snapshot;
    },
    restoreDefaults() {
      for (const option of MGBA_ENGINE_OPTIONS) {
        write(option.key, option.default);
      }
    },
  };
}

/** Per-namespace persistence for menu tweaks, so they survive a page reload. */
export interface MgbaSettingsStore {
  load(): Record<string, MgbaOptionValue>;
  save(values: Record<string, MgbaOptionValue>): void;
  clear(): void;
}

export function createSettingsStore(namespace: string): MgbaSettingsStore {
  const storageKey = `mgba:options:${namespace}`;

  // Storage access throws outright in some privacy modes, so every call is
  // guarded — losing persistence must never take the emulator down with it.
  const storage = (): Storage | null => {
    try {
      return typeof localStorage === 'undefined' ? null : localStorage;
    } catch {
      return null;
    }
  };

  return {
    load() {
      try {
        const raw = storage()?.getItem(storageKey);
        if (!raw) return {};
        const parsed: unknown = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};

        // Anything the catalog no longer recognizes is dropped rather than fed
        // back into the core: this is user-writable storage.
        const values: Record<string, MgbaOptionValue> = {};
        for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
          const option = mgbaOption(key);
          if (!option) continue;
          const coerced = coerceOptionValue(option, value);
          if (coerced !== undefined) values[key] = coerced;
        }
        return values;
      } catch {
        return {};
      }
    },
    save(values) {
      try {
        storage()?.setItem(storageKey, JSON.stringify(values));
      } catch {
        // persistence is best-effort
      }
    },
    clear() {
      try {
        storage()?.removeItem(storageKey);
      } catch {
        // persistence is best-effort
      }
    },
  };
}
