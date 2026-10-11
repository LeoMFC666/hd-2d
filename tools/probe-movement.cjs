// Uso: node tools/probe-movement.cjs <rom> <save> <plano-de-boot> <prefixo>
// (site de teste servido em 127.0.0.1:8080, ver build-test-site.sh)
// Anda/corre e registra, a cada quadro do navegador, a posicao exibida do
// jogador (scene.playerVisual) junto com o tile da RAM e o quadro.
const { chromium } = require('/opt/npm-tools/node_modules/playwright');
const fs = require('fs');
const [rom, save, bootPlan, outPrefix] = process.argv.slice(2);
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
  for (let i = 0; i < 14; i++) {
    const mode = await page.locator('#stage').getAttribute('data-mode');
    if (mode === 'world') break;
    await tap(i % 3 === 2 ? 'KeyZ' : 'KeyX'); await sleep(1500);
  }
  console.log('modo', await page.locator('#stage').getAttribute('data-mode'));
  await sleep(1500);
  const record = (frames) => page.evaluate((frames) => new Promise((resolve) => {
    const out = []; let n = 0;
    const tick = () => {
      const sc = __gen3.scene; const v = sc.playerVisual; const st = sc.currentState;
      const p = st && st.objects.find((o) => o.isPlayer);
      out.push([performance.now() | 0, v ? v.displayX.toFixed(3) : '-', v ? v.displayZ.toFixed(3) : '-', v ? v.mesh.position.y.toFixed(2) : '-', p ? p.x + ',' + p.y : '-', p ? p.previousX + ',' + p.previousY : '-', v ? v.frameKey : '-', v ? (v.calibrated ? 'cal' : 'nocal') : '-'].join(' '));
      if (++n < frames) requestAnimationFrame(tick); else resolve(out);
    };
    tick();
  }), frames);
  // Caminhada: segura direita.
  const walk = record(90);
  await sleep(100);
  await page.keyboard.down('ArrowRight'); await sleep(900); await page.keyboard.up('ArrowRight');
  const walkRows = await walk;
  await page.locator('#stage').screenshot({ path: `${outPrefix}-apos-andar.png` });
  // Corrida: B (Z) + esquerda.
  const run = record(90);
  await sleep(100);
  await page.keyboard.down('KeyZ'); await page.keyboard.down('ArrowLeft');
  await sleep(500);
  await page.locator('#stage').screenshot({ path: `${outPrefix}-correndo.png` });
  await sleep(400);
  await page.keyboard.up('ArrowLeft'); await page.keyboard.up('KeyZ');
  const runRows = await run;
  console.log('--- andando\nt dispX dispZ lift cur prev frame cal\n' + walkRows.join('\n'));
  console.log('--- correndo\n' + runRows.join('\n'));
  fs.writeFileSync(`${outPrefix}-console.txt`, logs.join('\n'));
  console.log(logs.filter((l) => /sprites|pageerror|error/i.test(l)).slice(-10).join('\n'));
  await browser.close();
})().catch((e) => { console.error('FALHOU:', e.message); process.exit(1); });
