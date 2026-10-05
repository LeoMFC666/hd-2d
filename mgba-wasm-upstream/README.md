# @wasm-gaming/mgba-wasm

[mGBA](https://github.com/mgba-emu/mgba) — the accuracy-focused **Game Boy
Advance** emulator, which also runs **Game Boy** and **Game Boy Color** —
compiled to WebAssembly via Emscripten and packaged as a wasm-gaming engine SDK.

This subproject follows the same engine-package approach used by snes9x-wasm,
geolith-wasm, fbneo-wasm, jgenesis-wasm, blastem-wasm, and rsdkv*:

- typed `manifest`
- typed `options`
- `load(config)` engine SDK surface
- Makefile-driven build (`build-sdk`, `build-wasm`, `preview`)

It conforms to the [`@wasm-gaming/engine-specs`](https://github.com/wasm-gaming/engine-specs)
contract (`EngineSDK` = `{ manifest, load }`), targeting **0.2.6** — 0.2.5 was the first
version in which the in-game ESC menu belongs to the host's demo shell rather
than to each engine, so this package ships the option rows and applies the
writes instead of drawing a menu itself.

mGBA ships several frontends (`qt/`, `sdl/`, `libretro/`); none of them suit a
browser, so this package supplies its own
([scripts/shim/mgba_shim.c](scripts/shim/mgba_shim.c)) instead of an Emscripten
SDL layer: **no ASYNCIFY, no SDL, no emulated GL**. Because mGBA already
publishes `struct mCore` — a frontend-facing vtable that is identical for both
its cores — the shim is a thin flat-C ABI over it rather than a reimplemented
port. The JS SDK drives one `core->runFrame()` per frame, blits the framebuffer
to a 2D canvas, and streams audio through an `AudioWorklet` ring buffer.
Emulation is **audio-clocked**: frames are produced to keep ~90 ms of audio
queued.

## ROM format

Pass the cartridge image as the `rom` asset: `.gba`, `.gb`, `.gbc` or `.sgb`.
**Zipped dumps work too** — the archive is opened in JS
([src/mgba.zip.ts](src/mgba.zip.ts)) with `DecompressionStream`, since this
build carries no libzip.

The right core is chosen from the image itself, so a Game Boy ROM and a GBA ROM
both just work; force it with `options.system` for headerless or mislabelled
files.

### BIOS

**Optional.** mGBA has a high-level BIOS replacement that runs virtually every
commercial title, so the `bios` asset is only needed for the boot animation and
the handful of games that read the BIOS directly. Supply a 16 KiB GBA BIOS dump
as `assets.bios` if you want it; without one, `skipBios` is forced on and drops
out of the settings menu, because there is no intro to skip.

## Contract surface

```js
import { manifest, load } from '@wasm-gaming/mgba-wasm';

const engine = await load({
  canvasEl: canvas,               // or attachTo: containerEl
  assets: {
    rom: gbaFileBytes,            // .gba/.gb/.gbc image, or a zip of one
    // bios: gbaBiosBytes,        // optional
  },
  options: { system: 'auto', aspect: 'native' },
  persist: 'opfs',
  storageNamespace: 'minish-cap',
  onEvent: (e) => console.log(e),
});
engine.start();

engine.system;                    // 'gba' | 'gb' — which core actually booted
```

### Options

| Option | Default | Description |
|--------|---------|-------------|
| `system` | `auto` | Which core boots the ROM: `auto` (sniffed from the image), `gba`, or `gb`. **Needs reset.** |
| `gbModel` | `auto` | Game Boy hardware: `auto` (from the header), `dmg`, `sgb`, `cgb`, `agb`. Ignored on GBA. **Needs reset.** |
| `idleOptimization` | `remove` | How the GBA core treats busy-wait loops. `remove` is where nearly all the speed comes from; `ignore` emulates them cycle for cycle. |
| `skipBios` | `true` | Skip the boot animation. Forced on, and hidden, when no BIOS image was supplied. **Needs reset.** |
| `allowOpposingDirections` | `false` | Let the D-pad report left+right at once. Real hardware cannot. |
| `renderFilter` | `pixelated` | Canvas scaling filter (`pixelated` or `smooth`). |
| `aspect` | `native` | `native` is square pixels — 3:2 on GBA, 10:9 on Game Boy; `4:3` fills a TV-shaped frame. |
| `interframeBlending` | `false` | Blend consecutive frames, approximating the ghosting of the original unlit LCD. Restores transparency effects games drew by flickering sprites. |
| `volume` | `1.0` | Master audio volume (0–1). |
| `gamepads` | `true` | Poll connected gamepads (standard mapping) each frame. |
| `logLevel` | `error` | Core messages printed to the console (`off`, `error`, `debug`). |
| `escMenu` | `true` | Let the demo shell show its in-game settings menu on Escape. |

## In-game settings menu

As of engine-specs 0.2.5 the ESC menu is a **demo-shell component**, not
something each engine draws. This package supplies the rows and applies the
writes:

```js
demo.init({
  escMenu: {
    optionGroups: toEscMenuGroups(),                 // from ./options
    onOptionChange: (key, value) => engine.config.write(key, value),
    onRestoreDefaults: () => engine.config.restoreDefaults(),
  },
});
```

Most of these apply to the running game: mGBA re-reads its `mCoreConfig` when
the frontend calls `reloadConfigOption()`, which is how its own Qt frontend
applies a settings change mid-play. The ones the core consumes while mapping
the cartridge — `system`, `gbModel`, `skipBios` — are tagged **needs reset**,
and the menu's *Reset game* re-maps it (battery RAM is carried across).

- Changes persist per `storageNamespace` in `localStorage` and are re-applied
  on the next `load()`. Explicit `options` passed by the host still win.
- Settings the loaded `mgba.wasm` cannot apply — a build predating one of the
  shim's setters — are omitted rather than erroring, so the menu degrades
  cleanly against an older artifact.

Every knob is declared once in [src/mgba.options.ts](src/mgba.options.ts); the
manifest's options schema, the defaults and the menu rows are all derived from
that catalog, so a new row there is enough to expose a new setting.

Drive it yourself with `options: { escMenu: false }`:

```js
engine.config.write('interframeBlending', true);
engine.config.read('idleOptimization');            // 'remove'
```

### Sizing the canvas

The presentation ratio is not a constant a host can hardcode: 3:2 on GBA,
10:9 on Game Boy, 8:7 once a Super Game Boy border appears, and 4:3 when the
player picks `aspect: '4:3'`. So `load()` publishes it on the canvas two ways —
`aspect-ratio`, which shapes the element, and `--mgba-aspect`, the same number
in a form arithmetic can use:

```css
.runtime canvas {
  width: min(100%, calc(100% * var(--mgba-aspect)));
  height: auto;
}
```

Both are updated whenever the geometry or the option changes, so a game
switching resolution re-fits without the host doing anything.

### Capabilities

- **Save states**: `saveState()` / `loadState()` via mGBA's in-memory snapshot
  API — 388 KiB on GBA, 70 KiB on Game Boy.
- **SRAM persistence**: battery-backed savedata is persisted to OPFS
  (`mgba/<storageNamespace>/sram.bin`) on pause/destroy and every 15 s;
  `purgeStorage()` removes the active namespace, along with the menu settings
  saved for it.
- **Screenshots**: `screenshot()` returns a PNG blob.
- **`coreSelectable`**: one package, two cores. `options.system` is where a
  host's core choice lands.

### Default controls

| Control | Key |
|---------|-----|
| D-pad | Arrow keys |
| A / B | X / Z |
| L / R | A / S |
| Start | Enter |
| Select | Right Shift |

Gamepads (standard mapping) are polled automatically. Rebind via
`engine.setInput({ 'a': 'KeyJ', ... })` (KeyboardEvent codes); a `p1.` prefix is
accepted but not required, since the handheld has one controller.

## Build

```sh
make build        # Full build: WASM (Docker/Emscripten) + TypeScript SDK
make build-sdk    # TypeScript only (SDK + manifest + demo shell)
make build-wasm   # mGBA WASM only (via Docker)
make preview      # Serve dist/ at :8030 with COOP/COEP headers
make smoke        # Headless boot test (needs a ROM in roms/)
```

The WASM build clones a pinned mGBA revision and builds it with its own CMake —
`DISABLE_FRONTENDS` plus `DISABLE_DEPS` is exactly the "just the emulator"
configuration this needs, and it generates `version.c` and `flags.h` along the
way — then links the shim against the resulting `libmgba.a`. No upstream
patching.

## WASM artifacts

| File | Description |
|------|-------------|
| `mgba.js` | Emscripten module loader (`createMgbaModule`). |
| `mgba.wasm` | Compiled mGBA core + shim (~790 KB). |

No SharedArrayBuffer or COOP/COEP headers are required at runtime (the preview
server sets them anyway for parity with sibling engines).

See [CORE.md](CORE.md) for the mapping between upstream mGBA capabilities and
what this wrapper exposes, and for the Emscripten-specific build traps.

## License

The SDK and shim are MPL-2.0, matching mGBA.
