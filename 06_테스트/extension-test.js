const { chromium } = require('/opt/npm-tools/node_modules/playwright');
const ext = '/home/claude/naver-blog-file-order';
const html = `<html><body><input id=f type=file multiple><div id=drop style="width:200px;height:200px">drop</div>
<script>
window.log=[];
document.getElementById('f').addEventListener('change', e => log.push('input:'+[...e.target.files].map(f=>f.name).join(',')));
document.getElementById('drop').addEventListener('drop', e => { e.preventDefault(); log.push('drop:'+[...e.dataTransfer.files].map(f=>f.name).join(',')); });
// detached input like many editors
window.detached = document.createElement('input'); detached.type='file'; detached.multiple=true;
detached.addEventListener('change', e => log.push('detached:'+[...e.currentTarget.files].map(f=>f.name).join(',')));
</script></body></html>`;
(async () => {
  const ctx = await chromium.launchPersistentContext('/tmp/claude-0/t/prof'+Date.now(), {
    headless: true, channel: 'chromium', args: ['--headless=new', `--disable-extensions-except=${ext}`, `--load-extension=${ext}`]});
  await ctx.route('https://blog.naver.com/**', r => r.fulfill({contentType:'text/html', body: html}));
  let [sw] = ctx.serviceWorkers(); // none in MV3 w/o background; get ext id via page
  const page = await ctx.newPage(); page.on('pageerror', e=>console.log('ERR', e.message)); page.on('console', m=>console.log('CON', m.text()));
  await page.goto('https://blog.naver.com/test');
  await page.waitForTimeout(500);
  const mk = (name, ts) => ({name, mimeType:'text/plain', buffer: Buffer.from(name)});
  const names = ['IMG_10.jpg','IMG_2.jpg','IMG_1.jpg','img_3.jpg'];
  async function setSettings(s){ await page.evaluate(s => document.documentElement.setAttribute('data-nbo-settings', JSON.stringify(s)), s); }
  async function run(label){
    await page.setInputFiles('#f', names.map(n=>mk(n)));
    await page.evaluate(names => { const dt=new DataTransfer(); names.forEach(n=>dt.items.add(new File([n],n,{lastModified: 1000+n.length}))); document.getElementById('drop').dispatchEvent(new DragEvent('drop',{dataTransfer:dt,bubbles:true,cancelable:true})); }, names);
    const h = await page.evaluateHandle(() => detached);
    await h.asElement().setInputFiles(names.map(n=>mk(n)));
    await page.waitForTimeout(300);
    console.log(label, await page.evaluate(() => log.splice(0)));
  }
  console.log('installed?', await page.evaluate(()=>[window.__nboInstalled, document.documentElement.getAttribute('data-nbo-settings')]));
  await run('default name asc');
  await setSettings({enabled:true,criterion:'name',order:'desc',toast:true}); await run('name desc');
  await setSettings({enabled:true,criterion:'size',order:'asc',toast:true}); await run('size asc');
  await setSettings({enabled:false,criterion:'name',order:'asc'}); await run('disabled');
  await setSettings({enabled:true,criterion:'exif',order:'asc',toast:true});
  const jp = ['a_photo.jpg','b_photo.jpg','c_photo.jpg'].map(f=>'/tmp/claude-0/t/'+f);
  await page.setInputFiles('#f', jp);
  const h = await page.evaluateHandle(() => detached); await h.asElement().setInputFiles(jp);
  await page.waitForTimeout(500);
  console.log('exif asc (expect c,a,b)', await page.evaluate(() => log.splice(0)));
  await ctx.close();
})();
