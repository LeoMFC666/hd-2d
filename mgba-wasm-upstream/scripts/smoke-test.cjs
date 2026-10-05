#!/usr/bin/env node
/* Headless smoke test: boot the WASM core in Node, run frames, verify that
   video output is non-trivial, that audio is being produced at the rate the
   model predicts, and that a savestate round-trips.

   Usage: node scripts/smoke-test.cjs [rom] [system]
   Defaults: the first file in roms/, system auto(-1)

   Zipped ROMs are accepted and go through the SDK's own zip reader, so this
   also covers the path the browser takes.
*/

const fs = require('node:fs');
const path = require('node:path');

const projectDir = path.resolve(__dirname, '..');

const ROM_EXTENSIONS = ['.gba', '.gb', '.gbc', '.sgb', '.zip'];

function defaultRom() {
  const dir = path.join(projectDir, 'roms');
  if (!fs.existsSync(dir)) return null;
  const found = fs
    .readdirSync(dir)
    .filter((name) => ROM_EXTENSIONS.includes(path.extname(name).toLowerCase()))
    .sort();
  return found.length ? path.join(dir, found[0]) : null;
}

const romPath = process.argv[2] ?? defaultRom();
const systemArg = process.argv[3];
const PLATFORMS = { auto: -1, gba: 0, gb: 1 };
const platform = systemArg ? (PLATFORMS[systemArg] ?? -1) : -1;

const FRAMES = 600; // ~10s of emulated time

async function main() {
  if (!romPath) {
    throw new Error('no ROM given and roms/ has none — pass one as the first argument');
  }

  // package.json declares "type": "module", so require() the UMD loader via a
  // .cjs copy; locateFile still resolves the wasm from dist/.
  const cjsCopy = path.join(projectDir, '.tmp/mgba.smoke.cjs');
  fs.mkdirSync(path.dirname(cjsCopy), { recursive: true });
  fs.copyFileSync(path.join(projectDir, 'dist/mgba/mgba.js'), cjsCopy);
  const createMgbaModule = require(cjsCopy);
  const mod = await createMgbaModule({
    locateFile: (p) => path.join(projectDir, 'dist/mgba', p),
  });

  // The compiled SDK's zip reader, so a zipped dump is opened exactly the way
  // the browser would open it.
  const { extractRom } = await import(
    require('node:url').pathToFileURL(path.join(projectDir, 'dist/mgba/mgba.zip.js')).href
  );
  const raw = new Uint8Array(fs.readFileSync(romPath));
  const { bytes: rom, name: inner } = await extractRom(raw, ['.gba', '.gb', '.gbc', '.sgb']);

  mod._mgbawasm_init();
  mod._mgbawasm_set_log_level(1);

  const romPtr = mod._malloc(rom.length);
  mod.HEAPU8.set(rom, romPtr);
  const ok = mod._mgbawasm_load(romPtr, rom.length, 0, 0, platform, 0, 1 /* skipBios */);
  mod._free(romPtr);
  if (!ok) throw new Error('ROM load failed');

  const detected = mod._mgbawasm_platform();
  const framerate = mod._mgbawasm_framerate_micro() / 1e6;
  console.log(
    `loaded "${inner ?? path.basename(romPath)}" — ${(rom.length / 1024).toFixed(0)}KB, ` +
      `${detected === 1 ? "Game Boy" : "GBA"} core @ ${framerate.toFixed(3)}Hz, ` +
      `audio ${mod._mgbawasm_sample_rate()}Hz`,
  );

  const scratchFrames = 8192;
  const audioPtr = mod._malloc(scratchFrames * 2 * 2);

  // The core's output rate is not ours to pick and does not stay put: the GBA
  // doubles it to 65536 Hz the moment a game raises the SOUNDBIAS resolution.
  // So the expected sample count is accumulated against the rate in force at
  // each frame rather than against one number decided up front.
  let expectedFrames = 0;
  let audioFrames = 0;
  let energy = 0;

  const drain = () => {
    for (;;) {
      const got = mod._mgbawasm_read_audio(audioPtr, scratchFrames);
      if (got <= 0) return;
      audioFrames += got;
      const start = audioPtr >> 1;
      const chunk = mod.HEAP16.subarray(start, start + got * 2);
      for (let i = 0; i < chunk.length; i += 64) energy += Math.abs(chunk[i]);
      if (got < scratchFrames) return;
    }
  };

  const t0 = process.hrtime.bigint();
  for (let i = 0; i < FRAMES; i++) {
    mod._mgbawasm_run_frame();
    expectedFrames += mod._mgbawasm_sample_rate() / framerate;
    drain();
  }
  const elapsedMs = Number(process.hrtime.bigint() - t0) / 1e6;

  // Latched here: the savestate check below runs more frames through the same
  // drain, and reporting the running total would overstate this measurement.
  const producedFrames = audioFrames;
  if (Math.abs(producedFrames - expectedFrames) > expectedFrames * 0.05) {
    throw new Error(
      `produced ${producedFrames} stereo frames, expected ~${expectedFrames.toFixed(0)}`,
    );
  }

  // Inspect the visible frame: count distinct colors and non-black pixels.
  const w = mod._mgbawasm_video_width();
  const h = mod._mgbawasm_video_height();
  const framePtr = mod._mgbawasm_video_ptr();
  const frame = mod.HEAPU8.subarray(framePtr, framePtr + w * h * 4);
  const colors = new Set();
  let nonBlack = 0;
  let opaque = true;
  for (let i = 0; i < frame.length; i += 4) {
    const rgb = (frame[i] << 16) | (frame[i + 1] << 8) | frame[i + 2];
    colors.add(rgb);
    if (rgb !== 0) nonBlack++;
    if (frame[i + 3] !== 255) opaque = false;
  }

  // Savestate round-trip. Emulation is deterministic, so the frame produced by
  // the run right after a restore must be byte-identical to the one produced
  // by the run right after the save — comparing against the frame at save time
  // would instead just measure one frame of animation.
  const stateSize = mod._mgbawasm_state_size();
  const statePtr = mod._malloc(stateSize);
  if (!mod._mgbawasm_state_save(statePtr)) throw new Error('savestate failed');
  const state = mod.HEAPU8.slice(statePtr, statePtr + stateSize);
  mod._free(statePtr);

  mod._mgbawasm_run_frame();
  const expected = mod.HEAPU8.slice(
    mod._mgbawasm_video_ptr(),
    mod._mgbawasm_video_ptr() + w * h * 4,
  );

  for (let i = 0; i < 60; i++) {
    mod._mgbawasm_run_frame();
    drain();
  }

  const loadPtr = mod._malloc(state.length);
  mod.HEAPU8.set(state, loadPtr);
  const loaded = mod._mgbawasm_state_load(loadPtr);
  mod._free(loadPtr);
  if (!loaded) throw new Error('savestate load failed');

  mod._mgbawasm_run_frame();
  const restored = mod.HEAPU8.subarray(
    mod._mgbawasm_video_ptr(),
    mod._mgbawasm_video_ptr() + w * h * 4,
  );
  let diff = 0;
  for (let i = 0; i < expected.length; i += 4) {
    if (expected[i] !== restored[i]) diff++;
  }

  const sramSize = mod._mgbawasm_sram_save();

  const fps = (FRAMES / (elapsedMs / 1000)).toFixed(0);
  console.log(`ran ${FRAMES} frames in ${elapsedMs.toFixed(0)}ms (${fps} fps headless)`);
  console.log(
    `audio: ${producedFrames} stereo frames vs ~${expectedFrames.toFixed(0)} expected, ` +
      `now ${mod._mgbawasm_sample_rate()}Hz, energy=${energy}`,
  );
  console.log(`video: ${w}x${h}, ${colors.size} distinct colors, ${nonBlack}/${w * h} non-black`);
  console.log(`state: ${stateSize} bytes, ${diff}/${w * h} pixels differ after restore`);
  console.log(`sram: ${sramSize} bytes`);

  // A DMG picture has exactly four shades, so "lots of colors" is not a test
  // that spans both cores. A flat fill is: it is what a dead pipeline produces.
  if (colors.size < 2) throw new Error('framebuffer is a flat fill — video pipeline broken?');
  if (nonBlack === 0) throw new Error('framebuffer is entirely black — video pipeline broken?');
  if (!opaque) throw new Error('framebuffer alpha is not opaque — the shim is not setting it');
  if (energy === 0) throw new Error('audio is silent — APU pipeline broken?');
  if (diff !== 0) throw new Error(`savestate restore diverged on ${diff} pixels`);
  console.log('SMOKE TEST PASS');
}

main().catch((err) => {
  console.error('SMOKE TEST FAIL:', err.message);
  process.exit(1);
});
