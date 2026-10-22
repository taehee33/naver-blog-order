// 확장 저장소의 설정을 페이지(MAIN world) 스크립트가 읽을 수 있도록 <html> 속성에 기록하고,
// 설정 창·페이지 패널·AI 모델(백그라운드)과 메시지를 주고받습니다.
(() => {
  const DEFAULTS = { enabled: true, criterion: "name", order: "asc", toast: true, panel: true, thumbs: true, aiMode: "off" };
  const ALLOWED_FROM_PAGE = ["panel", "toast"]; // 페이지 패널에서 바꿀 수 있는 설정
  let sync = {};
  let aiStatus = {};

  function publish() {
    const s = Object.assign({}, DEFAULTS, sync);
    // 선택한 모드의 모델이 내려받아져 있어야 AI 분석을 켬
    s.aiReady = s.aiMode !== "off" && aiStatus.state === "ready" && aiStatus.mode === s.aiMode;
    document.documentElement.setAttribute("data-nbo-settings", JSON.stringify(s));
  }

  function load() {
    chrome.storage.sync.get(DEFAULTS, (v) => {
      sync = v;
      chrome.storage.local.get({ aiStatus: {} }, (l) => {
        aiStatus = l.aiStatus || {};
        publish();
      });
    });
  }

  publish();
  load();
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "sync" || (area === "local" && changes.aiStatus)) load();
  });

  function toBase64(u8) {
    let s = "";
    for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
    return btoa(s);
  }

  window.addEventListener("message", (e) => {
    if (e.source !== window || !e.data) return;
    const d = e.data;

    // 패널의 "다음부터 자동으로 열지 않기"
    if (d.__nbo === "set") {
      const patch = {};
      for (const k of ALLOWED_FROM_PAGE) {
        if (typeof d.patch?.[k] === "boolean") patch[k] = d.patch[k];
      }
      if (Object.keys(patch).length) chrome.storage.sync.set(patch);
      return;
    }

    // 사진 방향 분석: 페이지가 384×384로 줄인 RGB 픽셀만 넘겨줌 (원본 파일은 넘기지 않음)
    if (d.__nbo === "ai-analyze" && d.rgb instanceof ArrayBuffer) {
      const reply = (r) => window.postMessage(Object.assign({ __nbo: "ai-result", id: d.id }, r), location.origin);
      try {
        chrome.runtime.sendMessage(
          { target: "bg", type: "analyze", mode: sync.aiMode, rgb: toBase64(new Uint8Array(d.rgb)) },
          (r) => reply(chrome.runtime.lastError ? { ok: false, error: chrome.runtime.lastError.message } : r || { ok: false })
        );
      } catch (err) {
        reply({ ok: false, error: String(err) });
      }
    }
  });

  // 설정 창의 "최근 정렬 결과 보기"
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg && msg.type === "nbo-show-panel") {
      window.postMessage({ __nbo: "show-panel" }, location.origin);
    }
  });
})();
