// Dirige o app num Chromium headless: abre ROM e save, chega ao overworld,
// tira capturas do palco e da tela GBA, anda e abre o menu Start.
const { chromium } = require('/opt/npm-tools/node_modules/playwright');
const fs = require('fs');
const [rom, save, outPrefix, bootPlan] = process.argv.slice(2);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const browser = await chromium.launch({
    headless: true,
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist',
           '--autoplay-policy=no-user-gesture-required'],
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const logs = [];
  page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
  page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
  await page.goto('http://127.0.0.1:8080/');
  const tap = async (key, hold = 90) => { await page.keyboard.down(key); await sleep(hold); await page.keyboard.up(key); };
  const shot = async (name) => {
    await page.locator('#stage').screenshot({ path: `${outPrefix}-${name}-stage.png` });
    await page.locator('#emulator').screenshot({ path: `${outPrefix}-${name}-gba.png` });
    const mode = await page.locator('#stage').getAttribute('data-mode');
    const status = await page.locator('#status').textContent();
    console.log(`captura ${name}: modo=${mode} status="${status}"`);
  };
  await page.setInputFiles('#romInput', rom);
  await page.waitForFunction(() => document.querySelector('#status').textContent.includes('aberto') || document.querySelector('#status').textContent.includes('Nao foi'), null, { timeout: 90000 });
  console.log('status:', await page.locator('#status').textContent());
  if (save && save !== '-') {
    await page.setInputFiles('#saveInput', save);
    await page.waitForFunction(() => /importado|Nao foi/.test(document.querySelector('#status').textContent), null, { timeout: 30000 });
    console.log('status:', await page.locator('#status').textContent());
  }
  await page.locator('#stage').click({ position: { x: 5, y: 5 } }).catch(() => {});
  // Passa intro e titulo: Start/A espacados; depois B para pular resumo.
  for (const step of bootPlan.split(',')) {
    const [key, wait] = step.split(':');
    await tap(key); await sleep(Number(wait));
  }
  await shot('chegada');
  await sleep(3000);
  await shot('estavel');
  for (let i = 0; i < 4; i++) { await tap('ArrowDown', 250); await sleep(200); }
  await sleep(1500);
  await shot('andou');
  await tap('Enter'); await sleep(1500);
  await shot('menu');
  // BAG: terceira opcao do menu Start (FRLG e Emerald)
  await tap('ArrowDown'); await sleep(400); await tap('ArrowDown'); await sleep(400);
  await tap('KeyX'); await sleep(4000);
  await shot('bolsa');
  await tap('KeyZ'); await sleep(4000);
  await shot('voltou');
  await tap('KeyZ'); await sleep(1500);
  await shot('final');
  fs.writeFileSync(`${outPrefix}-console.txt`, logs.join('\n'));
  await browser.close();
})().catch((e) => { console.error('FALHOU:', e.message); process.exit(1); });
