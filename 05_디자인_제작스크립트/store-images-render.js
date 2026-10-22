const { chromium } = require('/opt/npm-tools/node_modules/playwright');
const fs = require('fs');
const EXT = '/home/claude/naver-blog-file-order';
const FONT = `font-family:'Noto Sans CJK KR',sans-serif;`;
const G = '#03c75a';
const COLORS = ['#f6c177','#9ccfd8','#c4a7e7','#eb6f92','#a3be8c','#88c0d0','#ebcb8b','#d08770'];
const thumb = (n, i, w=150) => `<div style="width:${w}px;height:${Math.round(w*0.75)}px;border-radius:10px;background:linear-gradient(135deg,${COLORS[i%8]},${COLORS[(i+3)%8]});position:relative;box-shadow:0 2px 6px rgba(0,0,0,.12)">
  <div style="position:absolute;left:8px;bottom:6px;background:rgba(0,0,0,.6);color:#fff;font-size:${w>120?13:11}px;padding:2px 7px;border-radius:5px">${n}</div></div>`;
const toast = (txt) => `<div style="display:inline-block;background:rgba(30,30,30,.92);color:#fff;padding:12px 20px;border-radius:10px;font-size:17px;box-shadow:0 6px 20px rgba(0,0,0,.25);white-space:nowrap"><b style="color:${G}">네이버 블로그 사진(파일) 업로드 순서 유지</b>: ${txt}</div>`;
const sorted = ['IMG_1.jpg','IMG_2.jpg','IMG_3.jpg','IMG_4.jpg','IMG_5.jpg','IMG_10.jpg'];
const mixed = ['IMG_4.jpg','IMG_10.jpg','IMG_1.jpg','IMG_5.jpg','IMG_2.jpg','IMG_3.jpg'];
const idx = n => sorted.indexOf(n);

(async () => {
  const b = await chromium.launch();
  // 1) popup capture
  const pp = await b.newPage({ viewport:{width:280,height:340}, deviceScaleFactor:2 });
  await pp.addInitScript(() => { window.chrome = { storage: { sync: { get:(d,cb)=>cb(d), set:(s,cb)=>cb&&cb() } } }; });
  await pp.goto('file://' + EXT + '/popup.html');
  await pp.addStyleTag({content:`body{font-family:"Noto Sans CJK KR",sans-serif}`});
  const h = await pp.evaluate(() => Math.ceil(document.body.getBoundingClientRect().height));
  await pp.setViewportSize({width:280,height:h});
  await pp.screenshot({ path:'popup.png' });
  const popupB64 = fs.readFileSync('popup.png').toString('base64');
  const popupImg = (w) => `<img src="data:image/png;base64,${popupB64}" style="width:${w}px;border-radius:10px;box-shadow:0 12px 40px rgba(0,0,0,.18);border:1px solid #e5e5e5;background:#fff">`;
  const icon = 'data:image/png;base64,' + fs.readFileSync(EXT+'/icons/icon128.png').toString('base64');

  const scenes = {
  'screenshot-1-main.png': [1280,800, `
   <div style="height:100%;background:#f4f6f8;display:flex;flex-direction:column;align-items:center;padding-top:40px;box-sizing:border-box">
    <div style="font-size:40px;font-weight:800;color:#111">사진, 보던 순서 그대로 블로그에</div>
    <div style="font-size:21px;color:#555;margin-top:12px">여러 장을 한 번에 올려도 파일명 순서대로 들어가요</div>
    <div style="margin-top:30px;width:960px;background:#fff;border-radius:16px;box-shadow:0 10px 40px rgba(0,0,0,.08);padding:28px 36px;box-sizing:border-box">
      <div style="font-size:15px;color:#999;margin-bottom:6px">블로그 글쓰기</div>
      <div style="font-size:28px;font-weight:700;color:#222;border-bottom:1px solid #eee;padding-bottom:16px">교토 여행 첫째 날</div>
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin-top:18px;justify-items:center">${sorted.map((n,i)=>thumb(n,i,220)).join('')}</div>
    </div>
    <div style="margin-top:28px">${toast('파일 6개를 파일명 오름차순으로 정리했어요')}</div>
   </div>`],
  'screenshot-2-before-after.png': [1280,800, `
   <div style="height:100%;background:#fff;padding:0 70px;box-sizing:border-box;display:flex;flex-direction:column;justify-content:center">
    <div style="font-size:38px;font-weight:800;color:#111;text-align:center">뒤죽박죽 순서, 이제 그만</div>
    <div style="font-size:20px;color:#555;margin-top:12px;text-align:center">같은 사진 6장을 올렸을 때</div>
    <div style="display:flex;gap:50px;margin-top:50px;justify-content:center">
     ${[['확장 없이', mixed, '#e5484d'],['확장 사용', sorted, G]].map(([t,arr,c])=>`
     <div style="width:540px;border:2px solid ${c};border-radius:16px;padding:26px;box-sizing:border-box">
       <div style="font-size:22px;font-weight:700;color:${c};margin-bottom:20px">${t}</div>
       <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:14px">${arr.map(n=>thumb(n,idx(n),150)).join('')}</div>
     </div>`).join('')}
    </div>
    <div style="font-size:15px;color:#999;margin-top:28px;text-align:center">* 순서가 섞이는 정도는 업로드 상황에 따라 달라요</div>
   </div>`],
  'screenshot-3-settings.png': [1280,800, `
   <div style="height:100%;background:linear-gradient(135deg,#eafaf1,#f4f6f8);display:flex;align-items:center;justify-content:center;gap:90px">
    <div style="width:520px">
      <div style="font-size:38px;font-weight:800;color:#111;line-height:1.3">원하는 기준으로<br>골라서 정렬</div>
      <div style="margin-top:30px;font-size:20px;color:#333;line-height:2">
        <div>📄 <b>파일명</b> · IMG_2 → IMG_10 숫자 순서 인식</div>
        <div>🕒 <b>수정한 날짜</b></div>
        <div>📷 <b>촬영일</b> · 사진 속 EXIF 정보</div>
        <div>📦 <b>크기</b> · 🗂 <b>종류</b></div>
        <div>↕️ <b>오름차순 / 내림차순</b></div>
      </div>
    </div>
    ${popupImg(380)}
   </div>`],

  'screenshot-4-panel.png': [1280,800, `
   <div style="height:100%;background:#f4f6f8;padding:40px 48px;box-sizing:border-box">
    <div style="font-size:36px;font-weight:800;color:#111">정렬 결과를 한눈에 확인</div>
    <div style="font-size:19px;color:#555;margin-top:10px">올린 순서가 오른쪽 목록에 바로 떠요 · 닫기, 자동 열기 끄기 가능</div>
    <div style="display:flex;gap:28px;margin-top:30px">
      <div style="flex:1;background:#fff;border-radius:16px;box-shadow:0 10px 40px rgba(0,0,0,.08);padding:24px 28px">
        <div style="font-size:14px;color:#999">블로그 글쓰기</div>
        <div style="font-size:24px;font-weight:700;color:#222;border-bottom:1px solid #eee;padding-bottom:12px">교토 여행 둘째 날</div>
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-top:16px">${sorted.map((n,i)=>thumb(n,i,230)).join('')}</div>
      </div>
      <div style="width:350px;background:#fff;border-radius:14px;box-shadow:0 10px 32px rgba(0,0,0,.16);border:1px solid #e3e5e8;overflow:hidden;align-self:flex-start">
        <div style="padding:14px 16px 12px;border-bottom:1px solid #eef0f2">
          <div style="display:flex;justify-content:space-between"><b style="color:${G};font-size:15px">네이버 블로그 사진(파일) 업로드 순서 유지</b><span style="color:#666;font-size:20px;line-height:18px">×</span></div>
          <div style="color:#555;font-size:13px;margin-top:4px">파일 6개를 촬영일 오름차순으로 정리했어요</div>
          <div style="color:#999;font-size:12px;margin-top:2px">2026.10.18 17:05</div>
        </div>
        ${sorted.map((n,i)=>`<div style="display:grid;grid-template-columns:34px 1fr;align-items:center;padding:6px 16px;${i%2?'':'background:#fafbfc'}"><b style="color:${G};font-size:13px">${String(i+1).padStart(2,'0')}</b><div style="display:flex;align-items:center;justify-content:space-between;gap:8px"><div><div style="font-size:13px;color:#222">${n}</div><div style="font-size:11px;color:#999">2026.10.1${i>4?8:7} ${String(9+i).padStart(2,'0')}:2${i}</div></div><div style="width:40px;height:40px;border-radius:6px;background:linear-gradient(135deg,${COLORS[i%8]},${COLORS[(i+3)%8]})"></div></div></div>`).join('')}
        <div style="padding:10px 16px;border-top:1px solid #eef0f2;color:#777;font-size:12px">☐ 다음부터 자동으로 열지 않기</div>
      </div>
    </div>
   </div>`],
  'promo-small-440x280.png': [440,280, `
   <div style="height:100%;background:${G};display:flex;flex-direction:column;justify-content:center;padding:0 30px;box-sizing:border-box;color:#fff">
     <img src="${icon}" style="width:56px;height:56px;border-radius:12px;box-shadow:0 2px 8px rgba(0,0,0,.15)">
     <div style="font-size:25px;font-weight:800;margin-top:14px;line-height:1.25">네이버 블로그<br>사진(파일) 업로드 순서 유지</div>
     <div style="font-size:15px;margin-top:10px;opacity:.92">사진, 보던 순서 그대로 블로그에</div>
   </div>`],
  'marquee-1400x560.png': [1400,560, `
   <div style="height:100%;background:${G};display:flex;align-items:center;padding:0 90px;box-sizing:border-box;color:#fff;gap:70px">
     <div style="flex:1">
       <div style="font-size:52px;font-weight:800;line-height:1.25">사진, 보던 순서<br>그대로 블로그에</div>
       <div style="font-size:22px;margin-top:20px;opacity:.92">파일명 · 날짜 · 촬영일 기준 정렬 · 오름/내림차순</div>
     </div>
     <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:14px;background:#fff;padding:22px;border-radius:16px">${sorted.map((n,i)=>thumb(n,i,170)).join('')}</div>
   </div>`],
  };
  for (const [file,[w,h2,body]] of Object.entries(scenes)) {
    const p = await b.newPage({ viewport:{width:w,height:h2} });
    await p.setContent(`<html><body style="margin:0;${FONT}width:${w}px;height:${h2}px;overflow:hidden">${body}</body></html>`);
    await p.waitForTimeout(150);
    await p.screenshot({ path:file });
    await p.close();
  }
  await b.close();
})();
