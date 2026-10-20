const { chromium } = require('/opt/npm-tools/node_modules/playwright');
const ext = '/home/claude/naver-blog-file-order';
const html = `<html><body style="height:900px"><input id=f type=file multiple><input id=g type=file multiple><div id=drop style="width:200px;height:200px">drop</div>
<script>
window.log=[];
document.getElementById('f').addEventListener('change', e => log.push('input:'+[...e.target.files].map(f=>f.name).join(',')));
document.getElementById('drop').addEventListener('drop', e => { e.preventDefault();
  log.push('drop.files:'+[...e.dataTransfer.files].map(f=>f.name).join(','));
  const it=e.dataTransfer.items; const a=[]; for(let i=0;i<it.length;i++) a.push(it[i].getAsFile().name); log.push('drop.items:'+a.join(','));
});
</script></body></html>`;
const set = (page, s) => page.evaluate(s => document.documentElement.setAttribute('data-nbo-settings', JSON.stringify(Object.assign({enabled:true,criterion:'name',order:'asc',toast:true,panel:true},s))), s);
(async () => {
  const ctx = await chromium.launchPersistentContext('/tmp/claude-0/t/prof'+Date.now(), {headless:true, channel:'chromium', viewport:{width:1280,height:800},
    args:['--headless=new',`--disable-extensions-except=${ext}`,`--load-extension=${ext}`]});
  await ctx.route('https://blog.naver.com/**', r => r.fulfill({contentType:'text/html', body: html}));
  const page = await ctx.newPage(); page.on('pageerror', e=>console.log('ERR', e.message));
  await page.goto('https://blog.naver.com/test'); await page.waitForTimeout(500);
  const names=['IMG_10.jpg','IMG_2.jpg','IMG_1.jpg','img_3.jpg'];
  const drop = (ns) => page.evaluate(ns => { const dt=new DataTransfer(); ns.forEach(n=>dt.items.add(new File([n],n,{lastModified:1000}))); document.getElementById('drop').dispatchEvent(new DragEvent('drop',{dataTransfer:dt,bubbles:true,cancelable:true})); }, ns);
  const flush = async (l) => { await page.waitForTimeout(600); console.log(l, JSON.stringify(await page.evaluate(()=>log.splice(0)))); };

  await page.setInputFiles('#f', names.map(n=>({name:n,mimeType:'image/jpeg',buffer:Buffer.from(n)}))); await drop(names); await flush('1 name asc (input, drop files+items)');
  console.log('  panel rows:', await page.evaluate(()=>{const h=document.getElementById('nbo-panel-host'); return h? [...h.shadowRoot.querySelectorAll('li .name')].map(x=>x.textContent).join(','):'none'}));
  await page.screenshot({path:'/tmp/claude-0/t/panel.png'});
  // close button
  await page.evaluate(()=>document.getElementById('nbo-panel-host').shadowRoot.querySelector('.close').click());
  console.log('  after close:', await page.evaluate(()=>!!document.getElementById('nbo-panel-host')));

  await set(page,{order:'desc', panel:false});
  await drop(names); await flush('2 name desc drop (panel off)');
  console.log('  panel shown?', await page.evaluate(()=>!!document.getElementById('nbo-panel-host')));

  // EXIF: jpg + heic + png, asc. expected: f(2017) c(2019) a(2020) b(2021) e(2022)... d(2018) => f,d,c,a,b,e
  await set(page,{criterion:'exif', order:'asc'});
  const ex=['a_photo.jpg','b_photo.jpg','c_photo.jpg','d_photo.heic','e_photo.heic','f_photo.png'].map(f=>'/tmp/claude-0/t/'+f);
  await page.setInputFiles('#f', ex); await flush('3 exif input (expect f,d,c,a,b,e)');
  // EXIF drop (delayed, fake dataTransfer): put files into #g then build dt in name order
  await page.setInputFiles('#g', ex);
  await page.evaluate(()=>{ const raw=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'files'); const fl=[...document.getElementById('g').files].sort((a,b)=>a.name<b.name?-1:1);
    const dt=new DataTransfer(); fl.forEach(f=>dt.items.add(f)); document.getElementById('drop').dispatchEvent(new DragEvent('drop',{dataTransfer:dt,bubbles:true,cancelable:true})); });
  await flush('4 exif drop delayed (expect f,d,c,a,b,e)');

  // folder: readEntries via sandbox filesystem
  await set(page,{criterion:'name', order:'asc'});
  const r = await page.evaluate(() => new Promise((res) => {
    if (!window.webkitRequestFileSystem) return res('no fs api');
    webkitRequestFileSystem(window.TEMPORARY, 1024*1024, async fs => {
      const mk = n => new Promise(r=>fs.root.getFile(n,{create:true},e=>e.createWriter(w=>{w.onwriteend=()=>r();w.write(new Blob([n]))}),()=>r()));
      for (const n of ['IMG_10.jpg','IMG_2.jpg','IMG_1.jpg']) await mk(n);
      fs.root.getDirectory('sub',{create:true},()=>{
        window.__nboPatchDirEntry(fs.root); fs.root.createReader().readEntries(es => res(es.map(e=>e.name).join(',')));
      });
    }, e=>res('fs error '+e.name));
  }));
  console.log('5 folder readEntries (expect IMG_1,IMG_2,IMG_10,sub):', r);
  await page.waitForTimeout(400); await page.screenshot({path:'/tmp/claude-0/t/panel-folder.png'});
  await ctx.close();
})();
