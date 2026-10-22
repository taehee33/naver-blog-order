// 사진 방향 추천(AI) 모델 정보. background.js(importScripts), offscreen.html, popup.html에서 함께 씁니다.
// 모델 파일은 GitHub Pages(docs/models)에 올려 두고, 기능을 처음 켤 때 한 번만 내려받습니다.
self.NBO_AI = {
  cacheName: "nbo-ai-models-v1",
  models: {
    normal: {
      label: "일반 모드",
      url: "https://taehee33.github.io/naver-blog-order/models/orientation-fp16.onnx",
      bytes: 40421691,
      sha256: "af0fa16ceaaf1d0c9889c5f2d233604cbeb3c4112842b4ad90c2235a0a7a146a",
      accuracy: "약 98%",
    },
    light: {
      label: "가벼운 모드",
      url: "https://taehee33.github.io/naver-blog-order/models/orientation-int8.onnx",
      bytes: 21032577,
      sha256: "3db1a8d5dc9038395bf559624d2bd17464dafd168d9a8c18525f116bc8600b6c",
      accuracy: "약 96%",
    },
  },
  inputSize: 384,
  // 이 값보다 확신도가 낮으면 "확인 필요"로 표시
  lowConfidence: 0.85,
};
