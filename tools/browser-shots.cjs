// Uso: node tools/browser-shots.cjs <rom> <save> <plano-de-boot> <prefixo> [Tecla:ms,...]
// Abre o app (site de teste em 127.0.0.1:8080), chega ao overworld e tira
// uma captura do palco depois de cada movimento.
const { chromium } = require('/opt/npm-tools/node_modules/playwright');
const [rom, save, bootPlan, prefix, moves] = process.argv.slice(2);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 1100, height: 800 } });
  const logs = []; page.on('console', (m) => logs.push(m.text())); page.on('pageerror', (e) => logs.push('[pageerror] ' + e.message));
  await page.goto('http://127.0.0.1:8080/');
  const tap = async (key, hold = 90) => { await page.keyboard.down(key); await sleep(hold); await page.keyboard.up(key); };
  await page.setInputFiles('#romInput', rom);
  await page.waitForFunction(() => /aberto|Nao foi/.test(document.querySelector('#status').textContent), null, { timeout: 90000 });
  await page.setInputFiles('#saveInput', save);
  await page.waitForFunction(() => /importado|Nao foi/.test(document.querySelector('#status').textContent), null, { timeout: 30000 });
  await page.locator('#stage').click({ position: { x: 5, y: 5 } }).catch(() => {});
  for (const step of bootPlan.split(',')) { const [key, wait] = step.split(':'); await tap(key); await sleep(Number(wait)); }
  for (let i = 0; i < 24; i++) { const mode = await page.locator('#stage').getAttribute('data-mode'); if (mode === 'world') break; await tap(['Enter','KeyX','KeyX','KeyZ'][i % 4]); await sleep(1800); }
  await sleep(2500);
  await page.locator('#stage').screenshot({ path: `${prefix}-0.png` });
  let k = 1;
  for (const mv of (moves || '').split(',').filter(Boolean)) {
    const [key, ms] = mv.split(':'); await page.keyboard.down(key); await sleep(Number(ms)); await page.keyboard.up(key); await sleep(1500);
    await page.locator('#stage').screenshot({ path: `${prefix}-${k++}.png` });
  }
  console.log(logs.filter((l) => /error|warn|voxel/i.test(l)).slice(-10).join('\n'));
  await browser.close();
})().catch((e) => { console.error('FALHOU:', e.message); process.exit(1); });
