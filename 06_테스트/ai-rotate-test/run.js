const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
(async () => {
  const ext = path.resolve(process.env.EXT || '../../01_확장프로그램_소스');
  const ctx = await chromium.launchPersistentContext(require('os').tmpdir() + '/nbo-pw-' + Date.now(), {
    channel: 'chromium', headless: true,
    args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
  });
  const logs = [];
  await ctx.route('https://blog.naver.com/**', (route) => {
    const u = route.request().url();
    const body = fs.readFileSync(u.includes('mock-editor') ? 'mock-editor.html' : 'mock-top.html');
    route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body });
  });
  let sw = ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker');
  const id = sw.url().split('/')[2];
  console.log('ext id', id);
  // 1) 설정 창에서 가벼운 모드 선택 → 모델 설치
  const pop = await ctx.newPage();
  await pop.goto(`chrome-extension://${id}/popup.html`);
  await pop.check('input[name=aiMode][value=' + (process.env.AIOFF ? 'off' : 'light') + ']');
  const t0 = Date.now();
  for (;;) {
    const st = await pop.evaluate(() => new Promise(r => chrome.storage.local.get({ aiStatus: {} }, x => r(x.aiStatus))));
    if (process.env.AIOFF || st.state === 'ready' || st.state === 'error' || Date.now() - t0 > 60000) { console.log('status', JSON.stringify(st)); break; }
    await new Promise(r => setTimeout(r, 500));
  }
  console.log('popup text:', (await pop.locator('#aiStatus').innerText()));
  await pop.screenshot({ path: 'popup.png', fullPage: true });
  // 2) 글쓰기 목업 페이지
  const page = await ctx.newPage();
  page.on('console', m => logs.push(m.text()));
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('https://blog.naver.com/mock-write');
  const fr = page.frame({ url: /mock-editor/ });
  await fr.waitForSelector('#up', { state: 'attached' });
  const imgs = fs.readdirSync('imgs').map(f => path.resolve('imgs', f)).reverse(); // 일부러 역순 선택
  await fr.setInputFiles('#up', imgs);
  console.log('upload order', await fr.evaluate(() => window.__uploadOrder));
  // AI 완료 대기
  const host = fr.locator('#nbo-panel-host');
  const t1 = Date.now();
  let txt = '';
  for (;;) {
    txt = await fr.evaluate(() => { const h = document.getElementById('nbo-panel-host'); return h ? h.shadowRoot.textContent : ''; });
    if (/회전 추천|모두 방향|AI 모델이 없|분석 중 6\/6/.test(txt) && !/분석 중/.test(txt) || Date.now() - t1 > (process.env.AIOFF ? 4000 : 60000)) break;
    await new Promise(r => setTimeout(r, 500));
  }
  console.log('analysis ms', Date.now() - t1);
  console.log('PANEL:', txt.slice(0, 900));
  await page.screenshot({ path: 'panel.png' });
  // 3) 28번 추천 표시를 눌러 제외
  if (process.env.SKIP28) await fr.evaluate(() => { const root = document.getElementById('nbo-panel-host').shadowRoot; const li=[...root.querySelectorAll('li')].find(l=>l.textContent.includes('4814_28')); li.querySelector('.rot').click(); });
  console.log('BTN:', await fr.evaluate(() => { const b=document.getElementById('nbo-panel-host').shadowRoot.querySelector('.ai-go'); return b && b.textContent; }));
  if (process.env.AIOFF) { await ctx.close(); return; }
  // 4) 돌리기 버튼
  await fr.evaluate(() => document.getElementById('nbo-panel-host').shadowRoot.querySelector('.ai-go').click());
  for (let i = 0; i < 60; i++) {
    const s = await fr.evaluate(() => document.getElementById('nbo-panel-host').shadowRoot.querySelector('.ai-status').textContent);
    if (/돌렸어요|못|찾지|없어요|멈췄|열리지/.test(s)) { console.log('RUN:', s); break; }
    await new Promise(r => setTimeout(r, 500));
  }
  console.log('rotations', JSON.stringify(await fr.evaluate(() => window.__rot)), 'submitted', await fr.evaluate(() => !!window.__submitted));
  await page.screenshot({ path: 'after.png' });
  console.log(logs.filter(l => /nbo|순서|error|Error/i.test(l)).slice(0, 10).join('\n'));
  await ctx.close();
})().catch(e => { console.error('FAIL', e); process.exit(1); });
