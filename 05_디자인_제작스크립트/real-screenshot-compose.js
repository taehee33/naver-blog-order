const { chromium } = require('/opt/npm-tools/node_modules/playwright');
const fs=require('fs'); const d=f=>'data:image/'+(f.endsWith('jpg')?'jpeg':'png')+';base64,'+fs.readFileSync(f).toString('base64');
(async()=>{const b=await chromium.launch();const p=await b.newPage({viewport:{width:1280,height:800}});
await p.setContent(`<body style="margin:0;font-family:'Noto Sans CJK KR',sans-serif;width:1280px;height:800px;overflow:hidden;background:#f4f6f8">
<div style="text-align:center;padding-top:30px"><div style="font-size:34px;font-weight:800;color:#111">실제 사용 화면</div>
<div style="font-size:18px;color:#555;margin-top:6px">사진 39장을 한 번에 올려도 파일명 순서대로 들어가요</div></div>
<div style="position:relative;width:1180px;margin:22px auto 0">
 <img src="${d('editor.png')}" style="width:1180px;display:block;border-radius:12px;box-shadow:0 10px 32px rgba(0,0,0,.14)">
 <img src="${d('toast-clean.png')}" style="position:absolute;left:50%;bottom:22px;transform:translateX(-50%);height:52px;border-radius:12px;box-shadow:0 8px 24px rgba(0,0,0,.3)">
</div></body>`);await p.waitForTimeout(200);await p.screenshot({path:'screenshot-0-real.png'});await b.close();})();
