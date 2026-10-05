# mGBA core ↔ wrapper mapping

Upstream: https://github.com/mgba-emu/mgba (pinned in
[scripts/build-mgba.sh](scripts/build-mgba.sh), see `MGBA_REF`).

mGBA is unusual among the engines in this org: it already publishes the
abstraction the others had to invent. `struct mCore` ([`include/mgba/core/core.h`](https://github.com/mgba-emu/mgba/blob/master/include/mgba/core/core.h))
is a vtable over "load a ROM, run one frame, hand me pixels and samples", and it
is the same struct for the GBA and Game Boy cores. So
[scripts/shim/mgba_shim.c](scripts/shim/mgba_shim.c) is not a reimplemented
frontend — it is a flat C ABI over `mCore`, plus the two things a browser wants
that `mCore` does not provide: a tightly-packed RGBA framebuffer and an
interleaved int16 pull for an AudioWorklet.

None of mGBA's frontends (`qt/`, `sdl/`, `libretro/`, `3ds/`, …) are compiled.

## What is exposed

| Upstream capability | This wrapper |
|---------------------|--------------|
| GBA cartridges, up to 32 MiB (`mCoreFindVF` → `GBACoreCreate`) | ✅ `assets.rom` (`.gba`) |
| Game Boy / Game Boy Color / Super Game Boy (`GBCoreCreate`) | ✅ same asset — the core is chosen from the image, or forced with `options.system` |
| Automatic platform detection from the image | ✅ `options.system: 'auto'` (the default) |
| Game Boy hardware model (`gb.model`: DMG/SGB/CGB/AGB) | ✅ `options.gbModel`, applied at boot |
| GBA BIOS, real 16 KiB dump (`core->loadBIOS`) | ✅ `assets.bios`, optional |
| High-level BIOS replacement | ✅ used whenever no BIOS asset is supplied, which is the normal case |
| `skipBios` | ✅ `options.skipBios`; forced on and hidden from the menu without a real BIOS, since the HLE BIOS has no intro to skip |
| Video: 240×160 (GBA), 160×144 (GB), 256×224 (SGB border) | ✅ built with the default 32-bit `mColor`, repacked to RGBA → 2D canvas; geometry re-read every frame, so a Game Boy switching on an SGB border is followed |
| Audio: PSG + FIFO mixed into an `mAudioBuffer` | ✅ drained per frame, resampled in an AudioWorklet (see below) |
| Idle-loop optimization (`idleOptimization`) | ✅ `options.idleOptimization`, live via `reloadConfigOption` |
| `allowOpposingDirections` | ✅ `options.allowOpposingDirections`, live |
| Save states (`core->stateSize`/`saveState`/`loadState`, no VFS) | ✅ `saveState`/`loadState` — 388 KiB on GBA, 70 KiB on GB |
| Battery-backed savedata (`savedataClone`/`savedataRestore`) | ✅ persisted to OPFS |
| Real-time clock cartridges (`mRTCGenericSource`) | ✅ compiled in; runs off the host clock, no configuration exposed |
| Solar sensor, rumble, gyro, tilt (`setPeripheral`) | ❌ compiled in, no peripheral is wired to a browser API |
| Game Boy Camera / Printer | ❌ compiled in, not wired |
| Cheats (`core->cheatDevice`) | ❌ compiled in, no API exposed |
| Link cable / multiplayer (`sio/lockstep.c`) | ❌ compiled in, single instance only |
| Video/audio logging, rewind | ❌ not wired |
| Debuggers, scripting (Lua), ELF loading | ❌ `ENABLE_DEBUGGERS=OFF`, `ENABLE_SCRIPTING=OFF`, `USE_ELF=OFF` |
| OpenGL video backend | ❌ `BUILD_GL*=OFF`; the SDK blits to a 2D canvas |
| Zipped ROMs (needs libzip/minizip) | ✅ but not by the core — [src/mgba.zip.ts](src/mgba.zip.ts) opens the archive in JS with `DecompressionStream` |

## Timing model

- One `mgbawasm_run_frame()` = one `core->runFrame()` = one emulated frame.
  The host paces; nothing inside the core waits.
- **Audio is where mGBA differs from its siblings: these cores do not
  resample.** The Game Boy core emits a fixed 131072 Hz
  (`_GBCoreAudioSampleRate` returns the constant). The GBA core emits
  `GBA_ARM7TDMI_FREQUENCY / audio.sampleInterval`, which is 32768 Hz out of
  reset and 65536 Hz once a game raises the SOUNDBIAS resolution — **and it
  changes while the game runs**. mGBA's own `sampleRate` option is read only by
  its desktop frontends, which resample themselves.

  So the SDK resamples, in the AudioWorklet, with a fractional read cursor
  retuned by a `rate` message. `mgbawasm_sample_rate()` is re-read every tick,
  so a game changing resolution is a ratio change rather than a glitch.
- Pacing is audio-clocked: frames are produced to keep ~90 ms of audio queued,
  counted in **source** frames, because that is the unit the core produces in.
  When the `AudioContext` is suspended (autoplay policy) **or its clock has
  stalled** — which happens when there is no output device at all, as in a
  headless browser — it falls back to wall-clock pacing so the picture keeps
  moving.

## Build notes

Upstream has never been configured for Emscripten, and three of its assumptions
have to be corrected from the outside. None of them requires patching mGBA.

- **`_GNU_SOURCE` must be defined.** Emscripten satisfies CMake's `if(UNIX)`
  but is not `"Linux"`, which is the only branch that defines it. Without it,
  `CMAKE_C_STANDARD 11` hides `strdup` and `strlcpy` behind `__STRICT_ANSI__`
  and `core/config.c`, `core/cheats.c`, `core/core.c` and `core/interface.c`
  all fail to compile.
- **`BUILD_GL*` must be off.** `src/platform/opengl/gl.c` calls
  `glClearBufferiv`, which is GL ES 3.0, and Emscripten links ES2 by default.
  The SDK never reaches that backend.
- **The shim must be compiled with libmgba's exact defines.** `struct mCore`
  changes shape with them: `ENABLE_VFS` plus `ENABLE_DIRECTORIES` insert an
  `mDirectorySet` early in the struct, and `MINIMAL_CORE` removes an
  `mInputMap`. Get one wrong and every function pointer past that field is read
  from the wrong offset; the failure surfaces as *"null function or function
  signature mismatch"* at the first `core->init()`, nowhere near the cause.
  Rather than restate them, the build lifts `C_DEFINES` out of
  `CMakeFiles/mgba.dir/flags.make` — so an upstream change to the feature set
  cannot silently desynchronize the two halves.

Two more things the core does not do for you:

- **`mCoreInitConfig()` seeds no values.** Every `mCoreOptions` field starts at
  zero, so a frontend that skips `mCoreConfigLoadDefaults()` gets `volume = 0`:
  a perfectly working emulator that is completely silent. The shim installs the
  same defaults mGBA's libretro port does (`useBios = true`, `volume = 0x100`).
- **`gb.model` and `skipBios` are read while the cartridge is mapped.** They
  are arguments to `mgbawasm_load()` rather than setters, because there is no
  point after boot at which changing them would mean anything — which is also
  why the SDK tags them "needs reset" and re-maps the cartridge from `reset()`.

`ENABLE_VFS` is forced ON by mGBA's own CMakeLists and cannot be turned off from
the command line, so `-sFILESYSTEM=0` is not an option: the VFS layer's stdio
calls need something real behind them, even though every asset this port loads
travels through memory.
