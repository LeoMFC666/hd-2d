import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const artifacts = path.join(root, 'artifacts');
await fs.mkdir(artifacts, { recursive: true });

const cases = [
  {
    name: 'emerald',
    rom: 'Pokemon - Emerald Version (USA, Europe).gba',
    save: 'save.sav',
  },
  {
    name: 'firered',
    rom: 'Pokemon - FireRed Version (USA, Europe) (Rev 1).gba',
    save: 'firered.sav',
  },
];

const browser = await chromium.launch({
  headless: true,
  args: ['--disable-gpu-sandbox'],
});

async function readDebug(page) {
  return page.evaluate(() => {
    const debug = globalThis.__pkmn25dDebug;
    if (!debug) return null;
    return {
      state: debug.getState?.(),
      activeMapKey: debug.getActiveMapKey?.(),
      visuals: debug.getMapVisuals?.(),
      positioned: debug.getPositionedMaps?.(),
      renderInfo: debug.getRenderInfo?.(),
    };
  });
}

async function advanceToField(page) {
  for (let attempt = 0; attempt < 6; attempt++) {
    await page.keyboard.press('Enter');
    await new Promise(resolve => setTimeout(resolve, 700));
    await page.keyboard.press('x');
    await new Promise(resolve => setTimeout(resolve, 900));

    const debug = await readDebug(page);
    const state = debug?.state;

    if (
      state?.map?.mapLayoutAddress &&
      state.map.width > 0 &&
      state.map.height > 0 &&
      debug?.activeMapKey &&
      debug.visuals?.some(
        visual =>
          visual.key === debug.activeMapKey &&
          visual.visible,
      )
    ) {
      return debug;
    }
  }

  return readDebug(page);
}

const results = [];

try {
  for (const testCase of cases) {
    const page = await browser.newPage({
      viewport: {
        width: 1440,
        height: 1100,
      },
    });

    const consoleErrors = [];
    const pageErrors = [];

    page.on('console', message => {
      if (message.type() === 'error') {
        consoleErrors.push(message.text());
      }
    });

    page.on('pageerror', error => {
      pageErrors.push(String(error));
    });

    await page.goto(
      'http://127.0.0.1:4173/',
      { waitUntil: 'domcontentloaded' },
    );

    await page.setInputFiles(
      '#romInput',
      path.join(root, testCase.rom),
    );

    await page.waitForFunction(
      () => {
        const value =
          document.querySelector('#status')?.textContent ??
          '';

        return (
          value.startsWith('ROM loaded:') ||
          value.startsWith('ROM failed to load:')
        );
      },
      undefined,
      { timeout: 120000 },
    );

    const romStatus =
      await page.locator('#status').textContent();

    if (
      !romStatus?.startsWith('ROM loaded:')
    ) {
      throw new Error(
        testCase.name +
          ': ROM did not load. Status=' +
          romStatus +
          ' Console=' +
          consoleErrors.join(' | '),
      );
    }

    await new Promise(resolve => setTimeout(resolve, 800));

    await page.setInputFiles(
      '#saveInput',
      path.join(root, testCase.save),
    );

    await page.waitForFunction(
      () => {
        const value =
          document.querySelector('#status')?.textContent ??
          '';

        return (
          value.startsWith('Save loaded:') ||
          value.startsWith('Save failed to load:')
        );
      },
      undefined,
      { timeout: 60000 },
    );

    const saveStatus =
      await page.locator('#status').textContent();

    if (
      !saveStatus?.startsWith('Save loaded:')
    ) {
      throw new Error(
        testCase.name +
          ': save did not load. Status=' +
          saveStatus +
          ' Console=' +
          consoleErrors.join(' | '),
      );
    }

    const initialDebug =
      await advanceToField(page);

    await new Promise(resolve => setTimeout(resolve, 3500));

    const finalDebug =
      await readDebug(page);

    const scene = await page.evaluate(() => {
      const canvas =
        document.querySelector('#sceneContainer canvas');

      if (!canvas) {
        return {
          width: 0,
          height: 0,
          coverage: 0,
        };
      }

      const gl =
        canvas.getContext('webgl2') ||
        canvas.getContext('webgl');

      if (!gl) {
        return {
          width: canvas.width,
          height: canvas.height,
          coverage: 0,
        };
      }

      gl.finish();

      const width = canvas.width;
      const height = canvas.height;
      const pixels =
        new Uint8Array(
          width * height * 4,
        );

      gl.readPixels(
        0,
        0,
        width,
        height,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        pixels,
      );

      let interesting = 0;
      let samples = 0;

      for (
        let i = 0;
        i < pixels.length;
        i += 16
      ) {
        const r = pixels[i];
        const g = pixels[i + 1];
        const b = pixels[i + 2];

        samples++;

        if (
          Math.max(r, g, b) > 42 ||
          Math.max(r, g, b) - Math.min(r, g, b) > 18
        ) {
          interesting++;
        }
      }

      return {
        width,
        height,
        coverage:
          samples === 0
            ? 0
            : interesting / samples,
      };
    });

    await page.screenshot({
      path: path.join(
        artifacts,
        testCase.name + '-full.png',
      ),
      fullPage: true,
    });

    await page.locator('#sceneContainer canvas').screenshot({
      path: path.join(
        artifacts,
        testCase.name + '-scene.png',
      ),
    });

    const status =
      await page.locator('#status').textContent();

    results.push({
      ...testCase,
      status,
      initialDebug,
      finalDebug,
      scene,
      consoleErrors,
      pageErrors,
    });

    if (
      pageErrors.length > 0
    ) {
      throw new Error(
        testCase.name +
          ': page errors: ' +
          pageErrors.join('\n'),
      );
    }

    if (
      consoleErrors.some(error =>
        /Failed to build map visual|Map render failed|map visual/i.test(
          error,
        ),
      )
    ) {
      throw new Error(
        testCase.name +
          ': map/render console error detected: ' +
          consoleErrors.join('\n'),
      );
    }

    if (
      !finalDebug ||
      !finalDebug.activeMapKey ||
      !finalDebug.finalDebug
    ) {
      // no-op; retained for backwards-compatible diagnostics
    }

    const activeVisual =
      finalDebug?.visuals?.find(
        visual =>
          visual.key ===
          finalDebug.activeMapKey,
      );

    if (
      !finalDebug ||
      !finalDebug.state?.map?.mapLayoutAddress ||
      finalDebug.state.map.width <= 0 ||
      finalDebug.state.map.height <= 0 ||
      !activeVisual ||
      !activeVisual.visible
    ) {
      throw new Error(
        testCase.name +
          ': active map is not rendered after save/title advance. Debug=' +
          JSON.stringify(finalDebug),
      );
    }

    if (
      scene.coverage === 0 &&
      !activeVisual
    ) {
      throw new Error(
        testCase.name +
          ': scene appears blank and no active visual exists.',
      );
    }

    await page.close();
  } catch (error) {
    results.push({
      ...testCase,
      failure:
        String(error),
    });

    try {
      await page.close();
    } catch {}
  }
} finally {
  await browser.close();
}

await fs.writeFile(
  path.join(
    artifacts,
    'results.json',
  ),
  JSON.stringify(
    results,
    null,
    2,
  ),
);

console.log(
  JSON.stringify(
    results,
    null,
    2,
  ),
);
