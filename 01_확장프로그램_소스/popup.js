const DEFAULTS = { enabled: true, criterion: "name", order: "asc", toast: true, panel: true, thumbs: true, aiMode: "off" };
const $ = (s) => document.querySelector(s);

chrome.storage.sync.get(DEFAULTS, (s) => {
  $("#enabled").checked = s.enabled;
  $("#toast").checked = s.toast;
  $("#panel").checked = s.panel;
  $("#thumbs").checked = s.thumbs;
  $(`input[name=criterion][value=${s.criterion}]`).checked = true;
  $(`input[name=order][value=${s.order}]`).checked = true;
  $(`input[name=aiMode][value=${s.aiMode}]`).checked = true;
});

function savedNote() {
  $("#saved").textContent = "저장됨 · 다음 업로드부터 적용";
  setTimeout(() => ($("#saved").textContent = ""), 1800);
}

document.addEventListener("change", (e) => {
  const s = {
    enabled: $("#enabled").checked,
    toast: $("#toast").checked,
    panel: $("#panel").checked,
    thumbs: $("#thumbs").checked,
    criterion: $("input[name=criterion]:checked").value,
    order: $("input[name=order]:checked").value,
    aiMode: $("input[name=aiMode]:checked").value,
  };
  chrome.storage.sync.set(s, savedNote);
  if (e.target.name === "aiMode" && s.aiMode !== "off") ensureModel(s.aiMode);
});

// ----- 사진 방향 추천(AI) 모델 -----
let aiStatus = {};

function ensureModel(mode) {
  if (aiStatus.mode === mode && (aiStatus.state === "ready" || aiStatus.state === "downloading")) return;
  chrome.runtime.sendMessage({ target: "bg", type: "install", mode }, () => void chrome.runtime.lastError);
  paintAi(Object.assign({}, aiStatus, { mode, state: "downloading", progress: 0, error: null }));
}

function paintAi(st) {
  aiStatus = st || {};
  const el = $("#aiStatus");
  const m = NBO_AI.models[aiStatus.mode];
  const label = m ? m.label : "";
  el.classList.remove("err");
  $("#aiBarWrap").classList.remove("on");
  if (aiStatus.state === "downloading") {
    el.textContent = `${label} 모델 내려받는 중 ${aiStatus.progress || 0}%`;
    $("#aiBarWrap").classList.add("on");
    $("#aiBar").style.width = (aiStatus.progress || 0) + "%";
  } else if (aiStatus.state === "ready") {
    const mb = Math.round((aiStatus.bytes || (m && m.bytes) || 0) / 1e6);
    el.textContent = `설치됨: ${label} (${mb}MB)`;
  } else if (aiStatus.state === "error") {
    el.textContent = `설치 실패: ${aiStatus.error || "알 수 없는 오류"} · 모드를 다시 골라 주세요`;
    el.classList.add("err");
  } else {
    el.textContent = "설치된 모델 없음";
  }
  $("#aiDelete").disabled = !(aiStatus.state === "ready" || aiStatus.state === "error");
}

chrome.storage.local.get({ aiStatus: {} }, ({ aiStatus }) => paintAi(aiStatus));
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.aiStatus) paintAi(changes.aiStatus.newValue);
});

$("#aiDelete").addEventListener("click", () => {
  chrome.runtime.sendMessage({ target: "bg", type: "delete" }, () => void chrome.runtime.lastError);
  chrome.storage.sync.set({ aiMode: "off" });
  $("input[name=aiMode][value=off]").checked = true;
  paintAi({ state: "none" });
});

$("#show").addEventListener("click", () => {
  chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
    if (!tab) return;
    chrome.tabs.sendMessage(tab.id, { type: "nbo-show-panel" }, () => {
      if (chrome.runtime.lastError) {
        $("#msg").textContent = "네이버 블로그·카페 글쓰기 화면에서 눌러 주세요.";
      } else {
        window.close();
      }
    });
  });
});
