const { chromium } = require('/opt/npm-tools/node_modules/playwright');
const fs=require('fs');
const ext = '/home/claude/naver-blog-file-order';
(async () => {
  const ctx = await chromium.launchPersistentContext('/tmp/claude-0/t/prof'+Date.now(), {headless:true, channel:'chromium', viewport:{width:1280,height:900},
    args:['--headless=new','--enable-precise-memory-info',`--disable-extensions-except=${ext}`,`--load-extension=${ext}`]});
  await ctx.route('https://blog.naver.com/**', r => r.fulfill({contentType:'text/html', body:'<body style="background:#f4f6f8"><input id=f type=file multiple><script>f.addEventListener("change",e=>e.target.files)</script></body>'}));
  const page = await ctx.newPage(); page.on('pageerror', e=>console.log('ERR', e.message));
  await page.goto('https://blog.naver.com/x'); await page.waitForTimeout(500);
  const files = fs.readdirSync('big').sort(()=>Math.random()-0.5).map(f=>'/tmp/claude-0/t/big/'+f);
  const m0 = await page.evaluate(()=>performance.memory.usedJSHeapSize);
  const t0=Date.now();
  await page.setInputFiles('#f', files);
  // wait until visible thumbs loaded
  let n=0; for(let i=0;i<100;i++){ n=await page.evaluate(()=>{const h=document.getElementById('nbo-panel-host');return h?h.shadowRoot.querySelectorAll('img.thumb').length:0}); if(n>=10) break; await page.waitForTimeout(100); }
  console.log('visible thumbs', n, 'after', Date.now()-t0, 'ms');
  await page.waitForTimeout(800);
  await page.screenshot({path:'/tmp/claude-0/t/thumbs.png'});
  // scroll to bottom to load rest
  await page.evaluate(()=>{const ol=document.getElementById('nbo-panel-host').shadowRoot.querySelector('ol'); ol.scrollTop=99999;});
  for(let i=0;i<100;i++){ n=await page.evaluate(()=>document.getElementById('nbo-panel-host').shadowRoot.querySelectorAll('img.thumb').length); if(n>=24) break; await page.waitForTimeout(100);}
  console.log('all thumbs', n, 'after', Date.now()-t0, 'ms', 'heap delta MB', ((await page.evaluate(()=>performance.memory.usedJSHeapSize))-m0)/1e6);
  console.log('placeholder(s):', await page.evaluate(()=>[...document.getElementById('nbo-panel-host').shadowRoot.querySelectorAll('.thumb.ph')].map(x=>x.textContent)));
  await page.screenshot({path:'/tmp/claude-0/t/thumbs-bottom.png'});
  await ctx.close();
})();
