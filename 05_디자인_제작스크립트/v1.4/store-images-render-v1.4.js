// v1.4.0 스토어 이미지 생성 (정렬 + 사진 방향 추천 AI + 네이버 카페 지원)
// 필요한 파일: 필름 사진 4814_10.jpg(누운 사진)·4814_30.jpg(바로 선 사진), 확장 소스(sorter.js의 PANEL_CSS로 결과 목록을 그림)
// v1.4.0: 예시 사진을 2장(10·30)만 쓰도록 변경, 결과 목록은 실제 확장 CSS로 다시 그림
// 실행: EXT=<확장 소스 폴더> node store-images-render-v1.4.js
const { chromium } = require(process.env.PW || 'playwright');
const fs = require('fs');
const EXT = process.env.EXT || '../01_확장프로그램_소스';
const FONT = `font-family:'Noto Sans CJK KR','Apple SD Gothic Neo',sans-serif;`;
const G = '#03c75a';
const NAME_SHORT = '사진 업로드 순서 유지 +회전(AI)';
const COLORS = ['#f6c177','#9ccfd8','#c4a7e7','#eb6f92','#a3be8c','#88c0d0','#ebcb8b','#d08770'];
const uri = (f) => 'data:image/' + (f.endsWith('jpg') ? 'jpeg' : 'png') + ';base64,' + fs.readFileSync(f).toString('base64');
const thumb = (n, i, w=150) => `<div style="width:${w}px;height:${Math.round(w*0.75)}px;border-radius:10px;background:linear-gradient(135deg,${COLORS[i%8]},${COLORS[(i+3)%8]});position:relative;box-shadow:0 2px 6px rgba(0,0,0,.12)">
  <div style="position:absolute;left:8px;bottom:6px;background:rgba(0,0,0,.6);color:#fff;font-size:${w>120?13:11}px;padding:2px 7px;border-radius:5px">${n}</div></div>`;
const toast = (txt) => `<div style="display:inline-block;background:rgba(30,30,30,.92);color:#fff;padding:12px 20px;border-radius:10px;font-size:17px;box-shadow:0 6px 20px rgba(0,0,0,.25);white-space:nowrap"><b style="color:${G}">${NAME_SHORT}</b>: ${txt}</div>`;
const sorted = ['IMG_1.jpg','IMG_2.jpg','IMG_3.jpg','IMG_4.jpg','IMG_5.jpg','IMG_10.jpg'];
// 필름 사진: 10은 누워 있음(왼쪽 90° 돌리면 바로 섬), 30은 바로 선 사진
const film = { s10: uri('4814_10.jpg'), u30: uri('4814_30.jpg') };
// 누운 사진을 바로 세운 모습 (가로 사진 영역 안에서 -90° 회전)
const photo = (src, w, { rotate = false, tag = '' } = {}) => {
  const h = Math.round(w * 2 / 3);
  const inner = rotate
    ? `<div style="width:${h}px;height:${w}px;position:absolute;left:${(w-h)/2}px;top:${(h-w)/2}px;transform:rotate(-90deg)"><img src="${src}" style="width:${w}px;height:${h}px;object-fit:cover;position:absolute;left:${(h-w)/2}px;top:${(w-h)/2}px"></div>`
    : `<img src="${src}" style="width:100%;height:100%;object-fit:cover;display:block">`;
  const box = rotate ? `width:${h}px;height:${w}px;` : `width:${w}px;height:${h}px;`;
  const content = rotate ? `<img src="${src}" style="width:${w}px;height:${h}px;object-fit:cover;transform:rotate(-90deg);transform-origin:top left;position:absolute;left:0;top:${w}px">` : inner;
  return `<div style="${box}border-radius:10px;overflow:hidden;position:relative;box-shadow:0 4px 14px rgba(0,0,0,.15);background:#ddd">${content}${tag}</div>`;
};
const chip = (txt, color = G, bg = '#e6f8ee') => `<span style="display:inline-block;background:${bg};color:${color};font-weight:700;font-size:15px;padding:3px 10px;border-radius:6px">${txt}</span>`;

(async () => {
  const b = await chromium.launch();
  // 설정 창 캡처 (일반 모드 설치된 상태로 표시)
  const pp = await b.newPage({ viewport: { width: 300, height: 600 }, deviceScaleFactor: 2 });
  await pp.addInitScript(() => {
    const sync = { enabled: true, criterion: 'name', order: 'asc', toast: true, panel: true, thumbs: true, aiMode: 'normal' };
    const local = { aiStatus: { mode: 'normal', state: 'ready', bytes: 40421691 } };
    window.chrome = { storage: { sync: { get: (d, cb) => cb(Object.assign({}, d, sync)), set: (s, cb) => cb && cb() },
      local: { get: (d, cb) => cb(Object.assign({}, d, local)) }, onChanged: { addListener() {} } },
      runtime: { sendMessage() {} }, tabs: { query() {} } };
  });
  await pp.goto('file://' + require('path').resolve(EXT) + '/popup.html');
  await pp.addStyleTag({ content: `body{font-family:"Noto Sans CJK KR",sans-serif}` });
  const ph = await pp.evaluate(() => Math.ceil(document.body.getBoundingClientRect().height));
  await pp.setViewportSize({ width: 300, height: ph });
  await pp.screenshot({ path: 'popup-v1.4.png' });
  // 결과 목록: 확장의 실제 패널 CSS(sorter.js PANEL_CSS)로 2장짜리 목록을 그림
  const src = fs.readFileSync(EXT + '/sorter.js', 'utf8');
  const PANEL_CSS = src.match(/const PANEL_CSS = `([\s\S]*?)`;/)[1].replace(':host { all: initial; }', '')
    .replace('position: fixed; top: 88px; right: 16px;', 'position: static;').replace('max-height: calc(100vh - 120px);', '');
  const row = (n, name, size, rot, img) => `<li class="has-thumb"><span class="n">${n}</span><span class="name">${name}</span>
    <span class="val">${size}${rot ? `<span class="rot">↺ ${rot}</span>` : ''}</span><img class="thumb" src="${img}"></li>`;
  const panelHtml = `<style>${PANEL_CSS} body{margin:0;background:#fff} .wrap{font-family:"Noto Sans CJK KR",sans-serif !important}</style>
   <div class="wrap"><header><div class="top"><span class="title">${NAME_SHORT}</span><button class="close">×</button></div>
     <div class="meta">파일 2개를 파일명 오름차순으로 정리했어요</div><div class="sub">2026.10.25 18:30</div>
     <div class="ai"><div class="ai-head">사진 방향 추천 (AI)</div><div class="ai-status">회전 추천 1장</div>
       <button class="ai-go">네이버 편집기로 1장 돌리기</button>
       <div class="ai-note">회전은 네이버 에디터의 「사진 편집 → 자르기, 회전」 기능으로 해요. 내 컴퓨터의 원본 파일은 건드리지 않아요.</div>
       <div class="ai-note">AI 판단이라 틀릴 수 있어요. 추천 표시를 눌러 뺄 수 있고, 편집기에서 확인한 뒤 [완료]를 눌러 주세요.</div>
       <div class="ai-note">사진은 내 컴퓨터 안에서만 분석되고 어디로도 전송되지 않아요.</div></div></header>
     <ol>${row('01', '4814_10.jpg', '90 KB', '왼쪽 90° 92%', film.s10)}${row('02', '4814_30.jpg', '175 KB', '', film.u30)}</ol>
     <footer><label><input type="checkbox"> 다음부터 자동으로 열지 않기</label></footer></div>`;
  const pg = await b.newPage({ viewport: { width: 342, height: 800 }, deviceScaleFactor: 2 });
  await pg.setContent(panelHtml);
  await pg.waitForTimeout(200);
  await (await pg.$('.wrap')).screenshot({ path: 'cap-panel-v1.4.png' });
  await pg.close();
  const popupImg = (h) => `<img src="${uri('popup-v1.4.png')}" style="height:${h}px;border-radius:10px;box-shadow:0 12px 40px rgba(0,0,0,.18);border:1px solid #e5e5e5;background:#fff">`;
  const panelImg = (w) => `<img src="${uri('cap-panel-v1.4.png')}" style="width:${w}px;border-radius:12px;box-shadow:0 12px 40px rgba(0,0,0,.18);border:1px solid #e3e5e8;background:#fff;display:block">`;
  const bannerImg = (h) => `<img src="${uri('cap-banner.png')}" style="height:${h}px;border-radius:10px;box-shadow:0 8px 24px rgba(0,0,0,.25)">`;
  const icon = uri(EXT + '/icons/icon128.png');
  const recTag = `<div style="position:absolute;left:8px;top:8px">${chip('↺ 회전 추천')}</div>`;
  const sameTag = `<div style="position:absolute;left:8px;top:8px">${chip('그대로 두기', '#555', '#f1f3f5')}</div>`;
  const okTag = `<div style="position:absolute;left:8px;top:8px">${chip('✓ 바로 섰어요', '#fff', G)}</div>`;

  const scenes = {
  // 1) AI 회전 추천 (대표)
  'screenshot-1-ai-rotate.png': [1280, 800, `
   <div style="height:100%;background:#f4f6f8;padding:40px 48px;box-sizing:border-box">
    <div style="font-size:38px;font-weight:800;color:#111">누운 사진, AI가 찾아서 알려줘요</div>
    <div style="font-size:19px;color:#555;margin-top:10px">세로로 찍었는데 가로로 올라간 사진에 회전 추천 · 버튼 한 번이면 네이버 편집기로 돌려요</div>
    <div style="display:flex;gap:32px;margin-top:30px;align-items:flex-start">
      <div style="flex:1;background:#fff;border-radius:16px;box-shadow:0 10px 40px rgba(0,0,0,.08);padding:24px 28px">
        <div style="font-size:14px;color:#999">블로그 글쓰기</div>
        <div style="font-size:24px;font-weight:700;color:#222;border-bottom:1px solid #eee;padding-bottom:12px">필름 사진 한 롤</div>
        <div style="display:flex;gap:20px;margin-top:26px;justify-content:center;align-items:center">
          ${photo(film.s10, 350, { tag: recTag })}${photo(film.u30, 350)}
        </div>
        <div style="font-size:15px;color:#888;margin-top:18px;text-align:center">왼쪽은 누워서 올라간 사진, 오른쪽은 이미 바로 선 사진이에요</div>
      </div>
      ${panelImg(342)}
    </div>
   </div>`],
  // 2) 네이버 편집기로 회전 · 원본은 그대로
  'screenshot-2-rotate-result.png': [1280, 800, `
   <div style="height:100%;background:#fff;padding:0 60px;box-sizing:border-box;display:flex;flex-direction:column;align-items:center;justify-content:center">
    <div style="font-size:38px;font-weight:800;color:#111">확인하고, 한 번에 바로 세우기</div>
    <div style="font-size:19px;color:#555;margin-top:10px">네이버 에디터의 「사진 편집 → 자르기, 회전」 기능으로 돌려요 · 내 컴퓨터의 원본 파일은 그대로</div>
    <div style="display:flex;gap:36px;align-items:center;margin-top:40px">
      <div>
        <div style="font-size:18px;font-weight:700;color:#e5484d;margin-bottom:12px">올린 그대로</div>
        <div style="border:2px solid #e5484d;border-radius:16px;padding:22px;display:flex;gap:16px">${photo(film.s10, 230)}${photo(film.u30, 230)}</div>
      </div>
      <div style="font-size:54px;color:${G};font-weight:800;margin-top:30px">→</div>
      <div>
        <div style="font-size:18px;font-weight:700;color:${G};margin-bottom:12px">네이버 편집기로 회전한 뒤</div>
        <div style="border:2px solid ${G};border-radius:16px;padding:22px;display:flex;gap:16px;align-items:center">${photo(film.s10, 230, { rotate: true, tag: okTag })}${photo(film.u30, 230, { tag: sameTag })}</div>
      </div>
    </div>
    <div style="margin-top:34px;background:#03c75a;color:#fff;padding:12px 22px;border-radius:10px;font-size:17px;font-weight:700;box-shadow:0 6px 18px rgba(0,0,0,.18)">AI 추천대로 1장을 돌렸어요 · 확인 후 [완료]를 눌러 주세요 · 원본 파일은 그대로예요</div>
    <div style="font-size:16px;color:#888;margin-top:16px">AI 판단이라 틀릴 수 있어요 · 추천 표시를 눌러 뺄 수 있고, 마지막 [완료]는 직접 눌러요</div>
   </div>`],
  // 3) 블로그·카페 순서 유지 (v1.4.0 NEW: 카페)
  'screenshot-3-blog-cafe.png': [1280, 800, `
   <div style="height:100%;background:#f4f6f8;display:flex;flex-direction:column;align-items:center;padding-top:40px;box-sizing:border-box">
    <div style="display:flex;align-items:center;gap:14px"><span style="background:${G};color:#fff;font-weight:800;font-size:18px;padding:4px 12px;border-radius:8px">NEW</span><span style="font-size:40px;font-weight:800;color:#111">블로그도 카페도, 보던 순서 그대로</span></div>
    <div style="font-size:21px;color:#555;margin-top:12px">네이버 카페 글쓰기에서도 업로드 순서 정렬과 AI 회전 추천이 똑같이 동작해요</div>
    <div style="display:flex;gap:28px;margin-top:30px">
      ${[['블로그 글쓰기','교토 여행 첫째 날',''],['카페 글쓰기','필름 사진 한 롤 공유해요','게시판을 선택해 주세요.']].map(([where,title,board],k)=>`
      <div style="width:540px;background:#fff;border-radius:16px;box-shadow:0 10px 40px rgba(0,0,0,.08);padding:24px 28px;box-sizing:border-box">
        <div style="display:flex;align-items:center;justify-content:space-between"><div style="font-size:15px;font-weight:700;color:${k?'#2f8f83':'#03a24a'}">${where}</div>${k?'<div style="font-size:13px;color:#999;border:1px solid #e3e5e8;border-radius:6px;padding:2px 10px">'+board+' ▾</div>':''}</div>
        <div style="font-size:24px;font-weight:700;color:#222;border-bottom:1px solid #eee;padding:10px 0 14px">${title}</div>
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-top:16px;justify-items:center">${sorted.map((n,i)=>thumb(n,i+k*2,150)).join('')}</div>
      </div>`).join('')}
    </div>
    <div style="margin-top:30px">${toast('파일 6개를 파일명 오름차순으로 정리했어요')}</div>
    <div style="font-size:16px;color:#888;margin-top:14px">카페 글 목록·글 읽기 화면에서는 동작하지 않아요</div>
   </div>`],
  // 4) 설정: 정렬 기준 + AI 모드
  'screenshot-4-settings.png': [1280, 800, `
   <div style="height:100%;background:linear-gradient(135deg,#eafaf1,#f4f6f8);display:flex;align-items:center;justify-content:center;gap:60px">
    <div style="width:640px">
      <div style="font-size:38px;font-weight:800;color:#111;line-height:1.3">정렬 기준도, AI도<br>원하는 대로</div>
      <div style="margin-top:28px;font-size:19px;color:#333;line-height:1.95">
        <div>📄 <b>파일명</b> · IMG_2 → IMG_10 숫자 순서 인식</div>
        <div>🕒 <b>수정한 날짜</b> · 📷 <b>촬영일</b>(EXIF) · 📦 <b>크기</b> · 🗂 <b>종류</b></div>
        <div>↕️ <b>오름차순 / 내림차순</b></div>
        <div style="margin-top:10px">🤖 <b>사진 방향 추천</b> · <b>일반 모드</b>(약 40MB) / <b>가벼운 모드</b>(약 21MB)</div>
        <div style="color:#666;font-size:17px">처음 켤 때 한 번만 내려받고, 언제든 바꾸거나 삭제할 수 있어요</div>
      </div>
    </div>
    ${popupImg(740)}
   </div>`],
  // 5) 안심 포인트
  'screenshot-5-privacy.png': [1280, 800, `
   <div style="height:100%;background:${G};color:#fff;display:flex;flex-direction:column;justify-content:center;padding:0 110px;box-sizing:border-box">
    <div style="font-size:42px;font-weight:800">내 사진은 내 컴퓨터 안에서만</div>
    <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:24px;margin-top:44px">
      ${[['🔒','외부 전송·학습 없음','AI 분석은 내 컴퓨터 안에서만 해요. 사진을 어디로도 보내지 않고, AI 학습에도 쓰지 않아요.'],
         ['🖼️','원본 파일은 그대로','회전은 네이버 편집기 기능으로 해요. 내 컴퓨터의 파일은 바뀌지 않아요.'],
         ['👀','마지막 확인은 내가','AI가 틀릴 수 있어서 추천만 해요. [완료]는 직접 확인하고 눌러요.'],
         ['🙅','개인정보 수집 없음','계정·방문 기록 등 어떤 개인정보도 모으지 않아요.']]
        .map(([e,t,d])=>`<div style="background:rgba(255,255,255,.14);border-radius:16px;padding:26px 28px"><div style="font-size:30px">${e}</div><div style="font-size:24px;font-weight:800;margin-top:8px">${t}</div><div style="font-size:17px;margin-top:8px;opacity:.95;line-height:1.5">${d}</div></div>`).join('')}
    </div>
   </div>`],
  'promo-small-440x280.png': [440, 280, `
   <div style="height:100%;background:${G};display:flex;flex-direction:column;justify-content:center;padding:0 28px;box-sizing:border-box;color:#fff">
     <img src="${icon}" style="width:52px;height:52px;border-radius:12px;box-shadow:0 2px 8px rgba(0,0,0,.15)">
     <div style="font-size:22px;font-weight:800;margin-top:12px;line-height:1.3">네이버 블로그·카페 사진(파일)<br>업로드 순서 유지 <span style="background:#fff;color:${G};border-radius:6px;padding:0 6px">+회전(AI)</span></div>
     <div style="font-size:15px;margin-top:10px;opacity:.92">보던 순서 그대로, 누운 사진은 AI로 바로</div>
   </div>`],
  'marquee-1400x560.png': [1400, 560, `
   <div style="height:100%;background:${G};display:flex;align-items:center;padding:0 80px;box-sizing:border-box;color:#fff;gap:60px">
     <div style="flex:1">
       <div style="font-size:50px;font-weight:800;line-height:1.25">사진, 보던 순서 그대로<br>누운 사진은 AI가 세워요</div>
       <div style="font-size:21px;margin-top:20px;opacity:.92">네이버 블로그·카페 · 파일명·날짜·촬영일 정렬 · AI 회전 추천 · 원본 그대로</div>
     </div>
     <div style="background:#fff;padding:24px;border-radius:16px;display:flex;gap:18px;align-items:center">
       ${photo(film.s10, 200, { tag: recTag })}
       <div style="font-size:40px;color:${G};font-weight:800">→</div>
       ${photo(film.s10, 200, { rotate: true, tag: okTag })}
     </div>
   </div>`],
  };
  for (const [file, [w, h2, body]] of Object.entries(scenes)) {
    const p = await b.newPage({ viewport: { width: w, height: h2 } });
    await p.setContent(`<html><body style="margin:0;${FONT}width:${w}px;height:${h2}px;overflow:hidden">${body}</body></html>`);
    await p.waitForTimeout(200);
    await p.screenshot({ path: file });
    await p.close();
  }
  await b.close();
})();
