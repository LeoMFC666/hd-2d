import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const artifacts = path.join(root, 'artifacts');
await fs.mkdir(artifacts, { recursive: true });

const cases = [
  ['emerald', 'Pokemon - Emerald Version (USA, Europe).gba', 'save.sav'],
  ['firered', 'Pokemon - FireRed Version (USA, Europe) (Rev 1).gba', 'firered.sav'],
];

const browser = await chromium.launch({
  headless: true,
});

const results = [];

for (const [name, rom, save] of cases) {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });

  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', msg => {
    if (msg.type() === 'error') errors.push(msg.text());
  });

  try {
    await page.goto('http://127.0.0.1:4173/', {
      waitUntil: 'domcontentloaded',
    });

    await page.setInputFiles('#romInput', path.join(root, rom));

    await page.waitForTimeout(20000);

    const romStatus =
      await page.locator('#status').textContent();

    if (
      !romStatus?.startsWith('ROM loaded:')
    ) {
      await page.screenshot({
        path: path.join(
          artifacts,
          name + '-rom-failure.png',
        ),
        fullPage: true,
      });

      throw new Error(
        name +
          ': ROM load did not reach ready state after 20s. ' +
          'status=' +
          romStatus +
          ' errors=' +
          JSON.stringify(errors),
      );
    }

    await page.setInputFiles('#saveInput', path.join(root, save));

    await page.waitForFunction(
      () => document.querySelector('#status')?.textContent?.startsWith('Save loaded:'),
      undefined,
      { timeout: 60000 },
    );

    let debug = null;

    // SRAM import resets the emulated core to the title screen.
    // Start the saved game using the real mGBA keyboard path.
    for (let attempt = 0; attempt < 20; attempt++) {
      await page.locator('#emulator').focus();
      await page.keyboard.press('a');
      await page.waitForTimeout(500);

      debug = await page.evaluate(() => {
        const d = globalThis.__pkmn25dDebug;
        if (!d) return null;
        return {
          state: d.getState?.(),
          activeMapKey: d.getActiveMapKey?.(),
          visuals: d.getMapVisuals?.(),
          renderInfo: d.getRenderInfo?.(),
        };
      });

      if (
        debug?.state?.map?.mapLayoutAddress &&
        debug.state.map.mapDataAddress &&
        debug.state.map.width > 0 &&
        debug.state.map.height > 0 &&
        debug.activeMapKey &&
        debug.visuals?.some(
          visual =>
            visual.key === debug.activeMapKey &&
            visual.visible,
        )
      ) {
        break;
      }
    }

    await page.waitForTimeout(1200);

    debug = await page.evaluate(() => {
      const d = globalThis.__pkmn25dDebug;
      if (!d) return null;
      return {
        state: d.getState?.(),
        activeMapKey: d.getActiveMapKey?.(),
        visuals: d.getMapVisuals?.(),
        renderInfo: d.getRenderInfo?.(),
      };
    });

    await page.screenshot({
      path: path.join(artifacts, name + '.png'),
      fullPage: true,
    });

    if (!debug) {
      throw new Error(name + ': renderer debug API unavailable');
    }

    if (
      !debug.state?.map ||
      debug.state.map.mapLayoutAddress === 0 ||
      debug.state.map.mapDataAddress === 0 ||
      debug.state.map.width <= 0 ||
      debug.state.map.height <= 0
    ) {
      throw new Error(name + ': invalid active map state after save load: ' + JSON.stringify(debug));
    }

    const activeVisual =
      debug.visuals?.find(v => v.key === debug.activeMapKey);

    if (!activeVisual || !activeVisual.visible) {
      throw new Error(name + ': active map visual is missing/invisible after save load: ' + JSON.stringify(debug));
    }

    if (name === 'firered') {
      const beta = 0x08000000 + 0x00338378;
      if (activeVisual.mapDataAddress === beta) {
        throw new Error(name + ': forbidden Cinnabar map data selected');
      }
      for (const visual of debug.visuals ?? []) {
        if (visual.mapDataAddress === beta) {
          throw new Error(name + ': forbidden beta map visual present');
        }
      }
    }

    if (errors.length) {
      throw new Error(name + ': browser errors: ' + errors.join(' | '));
    }

    results.push({ name, ok: true, debug });
  } catch (error) {
    results.push({ name, ok: false, error: String(error), errors });
  } finally {
    await page.close();
  }
}

await browser.close();

await fs.writeFile(
  path.join(artifacts, 'results.json'),
  JSON.stringify(results, null, 2),
);

console.log(JSON.stringify(results, null, 2));

if (results.some(r => !r.ok)) {
  process.exit(1);
}
