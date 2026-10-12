// Anda passo a passo (Tecla:passos[:s], s = captura) a partir do save e imprime
// a posicao do jogador (mapa e tile) depois de cada trecho. Site de teste em
// 127.0.0.1:8080 (tools/build-test-site.sh).
// Uso: node tools/walk-browser.cjs <rom> <save> <prefixo> "ArrowUp:3:s,ArrowLeft:2"
const { chromium } = require('/opt/npm-tools/node_modules/playwright');
const [rom, save, prefix, plan] = process.argv.slice(2);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 1100, height: 800 } });
  const logs = []; let pos = '';
  page.on('console', (m) => { const t = m.text(); logs.push(t); });
  page.on('pageerror', (e) => logs.push('[pageerror] ' + e.message));
  await page.goto('http://127.0.0.1:8080/');
  const tap = async (key, hold = 90) => { await page.keyboard.down(key); await sleep(hold); await page.keyboard.up(key); };
  await page.setInputFiles('#romInput', rom);
  await page.waitForFunction(() => /aberto|Nao foi/.test(document.querySelector('#status').textContent), null, { timeout: 90000 });
  await page.setInputFiles('#saveInput', save);
  await page.waitForFunction(() => /importado|Nao foi/.test(document.querySelector('#status').textContent), null, { timeout: 30000 });
  await page.locator('#stage').click({ position: { x: 5, y: 5 } }).catch(() => {});
  for (const step of ['Enter:3000','Enter:3000','KeyX:2500']) { const [key, wait] = step.split(':'); await tap(key); await sleep(Number(wait)); }
  for (let i = 0; i < 24; i++) { const mode = await page.locator('#stage').getAttribute('data-mode'); if (mode === 'world') break; await tap(['Enter','KeyX','KeyX','KeyZ'][i % 4]); await sleep(1800); }
  await sleep(3000);
  const where = async () => page.evaluate(() => { const g = window.__gen3; try { const s = g.scene.currentState; return s ? `${s.map.mapGroup}:${s.map.mapNumber} (${s.player.x},${s.player.y}) ${s.player.direction}` : '?'; } catch (e) { return 'erro ' + e.message; } });
  console.log('inicio', await where());
  await page.locator('#stage').screenshot({ path: `${prefix}-0.png` });
  let k = 1;
  for (const mv of plan.split(',').filter(Boolean)) {
    const [key, n, shot] = mv.split(':');
    for (let i = 0; i < Number(n); i++) { await tap(key, 60); await sleep(320); }
    await sleep(500);
    console.log(mv, '->', await where());
    if (shot) { await page.locator('#stage').screenshot({ path: `${prefix}-${k++}.png` }); }
  }
  console.log(logs.filter((l) => /error|pageerror|anim\]/i.test(l)).slice(-8).join('\n'));
  await browser.close();
})().catch((e) => { console.error('FALHOU:', e.message); process.exit(1); });
