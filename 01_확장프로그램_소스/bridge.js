// 확장 저장소의 설정을 페이지(MAIN world) 스크립트가 읽을 수 있도록 <html> 속성에 기록하고,
// 설정 창·페이지 패널과 메시지를 주고받습니다.
(() => {
  const DEFAULTS = { enabled: true, criterion: "name", order: "asc", toast: true, panel: true, thumbs: true };
  const ALLOWED_FROM_PAGE = ["panel", "toast"]; // 페이지 패널에서 바꿀 수 있는 설정

  function publish(settings) {
    const s = Object.assign({}, DEFAULTS, settings);
    document.documentElement.setAttribute("data-nbo-settings", JSON.stringify(s));
  }

  publish({});
  chrome.storage.sync.get(DEFAULTS, publish);
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "sync") return;
    chrome.storage.sync.get(DEFAULTS, publish);
  });

  // 패널의 "다음부터 자동으로 열지 않기"
  window.addEventListener("message", (e) => {
    if (e.source !== window || !e.data || e.data.__nbo !== "set") return;
    const patch = {};
    for (const k of ALLOWED_FROM_PAGE) {
      if (typeof e.data.patch?.[k] === "boolean") patch[k] = e.data.patch[k];
    }
    if (Object.keys(patch).length) chrome.storage.sync.set(patch);
  });

  // 설정 창의 "최근 정렬 결과 보기"
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg && msg.type === "nbo-show-panel") {
      window.postMessage({ __nbo: "show-panel" }, location.origin);
    }
  });
})();
