const DEFAULTS = { enabled: true, criterion: "name", order: "asc", toast: true, panel: true, thumbs: true };
const $ = (s) => document.querySelector(s);

chrome.storage.sync.get(DEFAULTS, (s) => {
  $("#enabled").checked = s.enabled;
  $("#toast").checked = s.toast;
  $("#panel").checked = s.panel;
  $("#thumbs").checked = s.thumbs;
  $(`input[name=criterion][value=${s.criterion}]`).checked = true;
  $(`input[name=order][value=${s.order}]`).checked = true;
});

document.addEventListener("change", () => {
  const s = {
    enabled: $("#enabled").checked,
    toast: $("#toast").checked,
    panel: $("#panel").checked,
    thumbs: $("#thumbs").checked,
    criterion: $("input[name=criterion]:checked").value,
    order: $("input[name=order]:checked").value,
  };
  chrome.storage.sync.set(s, () => {
    $("#saved").textContent = "저장됨 · 다음 업로드부터 적용";
    setTimeout(() => ($("#saved").textContent = ""), 1800);
  });
});

$("#show").addEventListener("click", () => {
  chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
    if (!tab) return;
    chrome.tabs.sendMessage(tab.id, { type: "nbo-show-panel" }, () => {
      if (chrome.runtime.lastError) {
        $("#msg").textContent = "네이버 블로그 글쓰기 화면에서 눌러 주세요.";
      } else {
        window.close();
      }
    });
  });
});
