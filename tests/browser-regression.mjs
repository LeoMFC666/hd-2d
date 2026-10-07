import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const artifacts =
  path.join(
    root,
    'artifacts',
  );

await fs.mkdir(
  artifacts,
  { recursive: true },
);

const cases = [
  {
    name:
      'emerald',
    rom:
      'Pokemon - Emerald Version (USA, Europe).gba',
    save:
      'save.sav',
  },
  {
    name:
      'firered',
    rom:
      'Pokemon - FireRed Version (USA, Europe) (Rev 1).gba',
    save:
      'firered.sav',
  },
];

const browser =
  await chromium.launch({
    headless: true,
    args: [
      '--disable-gpu-sandbox',
      '--use-gl=swiftshader',
    ],
  });

async function readDebug(
  page,
) {
  return page.evaluate(
    () => {
      const debug =
        globalThis.__pkmn25dDebug;

      if (!debug) {
        return null;
      }

      return {
        state:
          debug.getState?.(),
        activeMapKey:
          debug.getActiveMapKey?.(),
        visuals:
          debug.getMapVisuals?.(),
        positioned:
          debug.getPositionedMaps?.(),
        renderInfo:
          debug.getRenderInfo?.(),
      };
    },
  );
}

async function waitForActiveMap(
  page,
  timeout = 30000,
) {
  await page.waitForFunction(
    () => {
      const debug =
        globalThis.__pkmn25dDebug;

      if (!debug) {
        return false;
      }

      const state =
        debug.getState?.();

      const activeMapKey =
        debug.getActiveMapKey?.();

      const visuals =
        debug.getMapVisuals?.() ??
        [];

      return Boolean(
        state?.map
          ?.mapLayoutAddress &&
        state.map.width > 0 &&
        state.map.height > 0 &&
        activeMapKey &&
        visuals.some(
          visual =>
            visual.key ===
              activeMapKey &&
            visual.visible &&
            visual.mapDataAddress !==
              0,
        ),
      );
    },
    undefined,
    { timeout },
  );

  return readDebug(page);
}

async function advanceToField(
  page,
) {
  const before =
    await readDebug(page);

  /*
   * Importing SRAM does not itself select "Continue" on the title screen.
   * Two A presses are harmless in the field and deterministically advance
   * through the title/continue flow when the game is still at its title.
   */
  for (
    let attempt = 0;
    attempt < 2;
    attempt++
  ) {
    await page.keyboard.press(
      'x',
    );

    await new Promise(
      resolve =>
        setTimeout(
          resolve,
          1200,
        ),
    );
  }

  const after =
    await waitForActiveMap(
      page,
      30000,
    );

  return {
    before,
    after,
  };
}

async function captureScene(
  page,
) {
  return page.evaluate(
    () => {
      const canvas =
        document.querySelector(
          '#sceneContainer canvas',
        );

      if (!canvas) {
        return {
          width: 0,
          height: 0,
          coverage: 0,
        };
      }

      const gl =
        canvas.getContext(
          'webgl2',
        ) ||
        canvas.getContext(
          'webgl',
        );

      if (!gl) {
        return {
          width:
            canvas.width,
          height:
            canvas.height,
          coverage: 0,
        };
      }

      gl.finish();

      const width =
        canvas.width;
      const height =
        canvas.height;

      const pixels =
        new Uint8Array(
          width *
            height *
            4,
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
        const r =
          pixels[i];
        const g =
          pixels[i + 1];
        const b =
          pixels[i + 2];

        samples++;

        if (
          Math.max(
            r,
            g,
            b,
          ) > 18 ||
          Math.max(
            r,
            g,
            b,
          ) -
            Math.min(
              r,
              g,
              b,
            ) >
            10
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
            : interesting /
              samples,
      };
    },
  );
}

const results = [];

try {
  for (
    const testCase of cases
  ) {
    let page = null;
    const consoleErrors = [];
    const pageErrors = [];

    try {
      page =
        await browser.newPage({
          viewport: {
            width: 1440,
            height: 1100,
          },
        });

      page.on(
        'console',
        message => {
          if (
            message.type() ===
            'error'
          ) {
            consoleErrors.push(
              message.text(),
            );
          }
        },
      );

      page.on(
        'pageerror',
        error => {
          pageErrors.push(
            String(error),
          );
        },
      );

      await page.goto(
        'http://127.0.0.1:4173/',
        {
          waitUntil:
            'domcontentloaded',
        },
      );

      await page.setInputFiles(
        '#romInput',
        path.join(
          root,
          testCase.rom,
        ),
      );

      await page.waitForFunction(
        () => {
          const value =
            document.querySelector(
              '#status',
            )?.textContent ??
            '';

          return (
            value.startsWith(
              'ROM loaded:',
            ) ||
            value.startsWith(
              'ROM failed to load:',
            )
          );
        },
        undefined,
        { timeout: 120000 },
      );

      const romStatus =
        await page
          .locator('#status')
          .textContent();

      if (
        !romStatus?.startsWith(
          'ROM loaded:',
        )
      ) {
        throw new Error(
          testCase.name +
            ': ROM did not load. ' +
            romStatus +
            ' Console=' +
            consoleErrors.join(
              ' | ',
            ),
        );
      }

      await page.setInputFiles(
        '#saveInput',
        path.join(
          root,
          testCase.save,
        ),
      );

      await page.waitForFunction(
        () => {
          const value =
            document.querySelector(
              '#status',
            )?.textContent ??
            '';

          return (
            value.startsWith(
              'Save loaded:',
            ) ||
            value.startsWith(
              'Save failed to load:',
            )
          );
        },
        undefined,
        { timeout: 60000 },
      );

      const saveStatus =
        await page
          .locator('#status')
          .textContent();

      if (
        !saveStatus?.startsWith(
          'Save loaded:',
        )
      ) {
        throw new Error(
          testCase.name +
            ': save did not load. ' +
            saveStatus +
            ' Console=' +
            consoleErrors.join(
              ' | ',
            ),
        );
      }

      const transition =
        await advanceToField(
          page,
        );

      const finalDebug =
        transition.after;

      const scene =
        await captureScene(
          page,
        );

      await page.screenshot({
        path: path.join(
          artifacts,
          testCase.name +
            '-full.png',
        ),
        fullPage:
          true,
      });

      await page
        .locator(
          '#sceneContainer canvas',
        )
        .screenshot({
          path: path.join(
            artifacts,
            testCase.name +
              '-scene.png',
          ),
        });

      const betaAddress =
        0x08000000 +
        0x00338378;

      const forbiddenVisuals =
        (
          finalDebug
            ?.visuals ??
          []
        ).filter(
          visual =>
            visual.mapDataAddress ===
            betaAddress,
        );

      const forbiddenPositioned =
        (
          finalDebug
            ?.positioned ??
          []
        ).filter(
          map =>
            map.mapDataAddress ===
            betaAddress,
        );

      if (
        pageErrors.length > 0
      ) {
        throw new Error(
          testCase.name +
            ': page errors: ' +
            pageErrors.join(
              '\n',
            ),
        );
      }

      if (
        consoleErrors.some(
          error =>
            /Failed to build map visual|Map render failed|map visual/i.test(
              error,
            ),
        )
      ) {
        throw new Error(
          testCase.name +
            ': map/render console error detected: ' +
            consoleErrors.join(
              '\n',
            ),
        );
      }

      if (
        !finalDebug ||
        !finalDebug.activeMapKey ||
        !finalDebug.state?.map
          ?.mapLayoutAddress ||
        !(
          finalDebug.state
            .map.width > 0
        ) ||
        !(
          finalDebug.state
            .map.height > 0
        )
      ) {
        throw new Error(
          testCase.name +
            ': active map state was not available after title/save advance. Debug=' +
            JSON.stringify(
              finalDebug,
            ),
        );
      }

      const activeVisual =
        finalDebug.visuals?.find(
          visual =>
            visual.key ===
            finalDebug.activeMapKey &&
            visual.visible,
        );

      if (
        !activeVisual
      ) {
        throw new Error(
          testCase.name +
            ': active map has no visible Three.js visual after save load. Debug=' +
            JSON.stringify(
              finalDebug,
            ),
        );
      }

      if (
        forbiddenVisuals.length ||
        forbiddenPositioned.length
      ) {
        throw new Error(
          testCase.name +
            ': forbidden Cinnabar beta map data 0x00338378 is still present. ' +
            JSON.stringify({
              forbiddenVisuals,
              forbiddenPositioned,
            }),
        );
      }

      results.push({
        ...testCase,
        transition,
        scene,
        consoleErrors,
        pageErrors,
      });
    } catch (error) {
      results.push({
        ...testCase,
        failure:
          String(error),
        consoleErrors,
        pageErrors,
      });
    } finally {
      if (page) {
        try {
          await page.close();
        } catch {}
      }
    }
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

const failed =
  results.filter(
    result =>
      result.failure,
  );

console.log(
  JSON.stringify(
    results,
    null,
    2,
  ),
);

if (failed.length) {
  process.exitCode = 1;
}
