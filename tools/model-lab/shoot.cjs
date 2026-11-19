// Captura o laboratorio de modelos (tools/model-lab) num PNG.
// Monte antes: tools/model-lab/build.sh <pasta> <rom>, e sirva a pasta:
//   python3 -m http.server 8090 --directory <pasta>
// Uso: node tools/model-lab/shoot.cjs "map=3.0&box=4,3,9,7&player=6,8" saida.png
const { chromium } = require('/opt/npm-tools/node_modules/playwright');
const [query, out] = process.argv.slice(2);
(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 1900, height: 1000 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(`http://127.0.0.1:${process.env.LAB_PORT || 8090}/lab.html?${query}`);
  await page.waitForFunction(() => window.__labDone === true, null, { timeout: 120000 });
  await page.locator('#lab').screenshot({ path: out });
  console.log((await page.locator('#info').textContent()).trim());
  if (errors.length) console.log('ERROS:\n' + errors.join('\n'));
  await browser.close();
})().catch((e) => { console.error('FALHOU:', e.message); process.exit(1); });
