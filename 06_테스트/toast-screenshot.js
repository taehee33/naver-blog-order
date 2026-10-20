const { chromium } = require('/opt/npm-tools/node_modules/playwright');
const ext='/home/claude/naver-blog-file-order';
(async()=>{
 const ctx=await chromium.launchPersistentContext('/tmp/claude-0/t/p'+Date.now(),{headless:true,channel:'chromium',viewport:{width:900,height:300},args:['--headless=new',`--disable-extensions-except=${ext}`,`--load-extension=${ext}`]});
 await ctx.route('https://blog.naver.com/**',r=>r.fulfill({contentType:'text/html',body:'<input id=f type=file multiple><script>f.addEventListener("change",e=>e.target.files)</script>'}));
 const p=await ctx.newPage(); await p.goto('https://blog.naver.com/x'); await p.waitForTimeout(300);
 await p.setInputFiles('#f',['b.jpg','a.jpg','c.jpg'].map(n=>({name:n,mimeType:'image/jpeg',buffer:Buffer.from(n)})));
 await p.waitForTimeout(200); await p.screenshot({path:'/tmp/claude-0/t/toast.png'}); await ctx.close();})();
