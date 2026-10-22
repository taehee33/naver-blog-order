// 서비스 워커: 콘텐츠 스크립트·설정 창과 오프스크린 문서(AI 모델 실행) 사이를 연결합니다.
importScripts("ai-config.js");

const OFFSCREEN_URL = "offscreen.html";
let creating = null;

async function ensureOffscreen() {
  const url = chrome.runtime.getURL(OFFSCREEN_URL);
  const existing = await chrome.runtime.getContexts({ contextTypes: ["OFFSCREEN_DOCUMENT"], documentUrls: [url] });
  if (existing.length) return;
  if (!creating) {
    creating = chrome.offscreen
      .createDocument({
        url: OFFSCREEN_URL,
        reasons: ["WORKERS"],
        justification: "사진 방향 추천 AI 모델을 내 컴퓨터 안에서 실행",
      })
      .finally(() => (creating = null));
  }
  await creating;
}

async function toOffscreen(msg) {
  await ensureOffscreen();
  return chrome.runtime.sendMessage(Object.assign({ target: "offscreen" }, msg));
}

function setStatus(patch) {
  return chrome.storage.local.get({ aiStatus: {} }).then(({ aiStatus }) =>
    chrome.storage.local.set({ aiStatus: Object.assign({}, aiStatus, patch, { updatedAt: Date.now() }) })
  );
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.target !== "bg") return;
  (async () => {
    switch (msg.type) {
      case "status": // 오프스크린 → 설치 진행 상황
        await setStatus(msg.status);
        return { ok: true };
      case "install": {
        const mode = msg.mode;
        if (!NBO_AI.models[mode]) return { ok: false, error: "알 수 없는 모드" };
        await setStatus({ mode, state: "downloading", progress: 0, error: null });
        const r = await toOffscreen({ type: "install", mode });
        return r;
      }
      case "delete": {
        const r = await toOffscreen({ type: "delete" });
        await chrome.storage.local.set({ aiStatus: { mode: null, state: "none", progress: 0, error: null, updatedAt: Date.now() } });
        return r;
      }
      case "analyze":
        return await toOffscreen({ type: "analyze", mode: msg.mode, rgb: msg.rgb });
    }
    return { ok: false, error: "unknown" };
  })().then(sendResponse, (e) => sendResponse({ ok: false, error: String(e && e.message || e) }));
  return true;
});
