// Abre o app (site de teste em 127.0.0.1:8080, ver tools/build-test-site.sh),
// chega ao overworld com o save e imprime o que o localizador da Gen 3
// achou na RAM, comparando o SaveBlock1 com o ObjectEvent do jogador.
// Tira capturas do palco no caminho.
//
// Uso: node tools/probe-gen3.cjs <rom> <save|-> <prefixo> [query] [plano]
//   query: parametros da URL, ex. "gen3discover=1&hd2d=0"
//   plano: Tecla:vezes[:s], ex. "ArrowDown:3:s,espera:2000:s,evalfile:/tmp/x.js:0"
const { chromium } = require('/opt/npm-tools/node_modules/playwright');
const [rom, save, prefix, query = '', plan = '', viewport = '1100x800'] = process.argv.slice(2);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const [vw, vh] = viewport.split('x').map(Number);

(async () => {
  const browser = await chromium.launch({
    headless: true,
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  });
  const page = await browser.newPage({ viewport: { width: vw, height: vh } });
  const logs = [];
  page.on('console', (m) => logs.push(m.text()));
  page.on('pageerror', (e) => logs.push('[pageerror] ' + e.message));
  await page.goto('http://127.0.0.1:8080/' + (query ? '?' + query : ''));
  const tap = async (key, hold = 90) => { await page.keyboard.down(key); await sleep(hold); await page.keyboard.up(key); };
  await page.setInputFiles('#romInput', rom);
  await page.waitForFunction(() => /aberto|Nao foi/.test(document.querySelector('#status').textContent), null, { timeout: 90000 });
  if (save && save !== '-') {
    await page.setInputFiles('#saveInput', save);
    await page.waitForFunction(() => /importado|Nao foi/.test(document.querySelector('#status').textContent), null, { timeout: 30000 });
  }
  await page.locator('#stage').click({ position: { x: 5, y: 5 } }).catch(() => {});
  for (const step of ['Enter:4000', 'Enter:4000', 'Enter:4000']) { const [key, wait] = step.split(':'); await tap(key); await sleep(Number(wait)); }
  // Overworld de verdade: modo 'world' E o jogador lido da RAM (na tela de
  // titulo do FRLG o save ja esta carregado e engana o modo).
  const inWorld = async () => page.evaluate(() => {
    const g = window.__gen3;
    const s = g && g.scene && g.scene.currentState;
    const player = s && s.objects.find((o) => o.isPlayer);
    // gSprites so e achado com o sprite do jogador vivo (overworld de fato).
    const sprite = player && g.scene.liveSprites.readRaw(player.spriteId);
    return document.querySelector('#stage').dataset.mode === 'world' && !!sprite && !sprite.invisible;
  });
  // Precisa ficar no overworld por 3 conferencias seguidas (menus de
  // continuar passam por 'world' por um instante).
  for (let i = 0; i < 30; i++) {
    let stable = 0;
    for (let c = 0; c < 3 && (await inWorld()); c++) { stable++; await sleep(1000); }
    if (process.env.PROBE_DEBUG) console.log("boot", i, stable, await page.locator("#stage").getAttribute("data-mode"));
    if (stable === 3) break;
    // So A depois do titulo: B voltaria do menu de continuar.
    await tap('KeyX', 150); await sleep(3500);
  }
  await sleep(3000);

  const probe = async () => page.evaluate(() => {
    const g = window.__gen3;
    const adapter = g.scene.stateAdapter;
    const report = adapter.getLocatorReport();
    const s = g.scene.currentState;
    const m = g.memory;
    const s16 = (a) => { const v = m.readU16(a); return v >= 0x8000 ? v - 0x10000 : v; };
    const sb = parseInt(report.saveBlock1, 16);
    const oe = parseInt(report.objectEvents, 16);
    const av = parseInt(report.playerAvatar, 16);
    let check = '';
    if (sb && oe && av) {
      const idx = m.readU8(av + 5);
      const p = oe + idx * 0x24;
      check = `save pos=(${s16(sb)},${s16(sb + 2)}) mapa=${m.readU8(sb + 4)}:${m.readU8(sb + 5)} | ` +
        `objeto[${idx}] coords=(${s16(p + 0x10)},${s16(p + 0x12)}) mapa=${m.readU8(p + 0xa)}:${m.readU8(p + 9)}`;
    }
    return { family: adapter.getFamily(), report, state: s ? `${s.map.mapGroup}:${s.map.mapNumber} (${s.player.x},${s.player.y}) ${s.player.direction}` : '?', check };
  });

  console.log(JSON.stringify(await probe(), null, 1));
  await page.locator('#stage').screenshot({ path: `${prefix}-0.png` });

  let k = 1;
  for (const mv of plan.split(',').filter(Boolean)) {
    const [key, n, shot] = mv.split(':');
    if (key === 'espera') { await sleep(Number(n)); }
    else if (key === 'evalfile') { console.log(await page.evaluate(require('fs').readFileSync(n, 'utf8'))); }
    else for (let i = 0; i < Number(n); i++) { await tap(key, 60); await sleep(320); }
    await sleep(400);
    if (shot) {
      await page.locator('#stage').screenshot({ path: `${prefix}-${k++}.png` });
      console.log(mv, '->', (await probe()).state);
    }
  }

  console.log(logs.filter((l) => /\[gen3\]|error|pageerror|hd2d|Profile/i.test(l)).slice(-14).join('\n'));
  await browser.close();
})().catch((e) => { console.error('FALHOU:', e.message); process.exit(1); });
