# 사진 방향 추천 AI 모델

확장 프로그램의 "사진 방향 추천 (AI)" 기능이 처음 켜질 때 이 폴더의 모델을 한 번 내려받습니다.
사진은 사용자 컴퓨터 안에서만 분석되며 어디로도 전송되지 않습니다.

| 파일 | 모드 | 크기 | SHA-256 |
|---|---|---|---|
| `orientation-fp16.onnx` | 일반 모드 | 40.4MB | `af0fa16ceaaf1d0c9889c5f2d233604cbeb3c4112842b4ad90c2235a0a7a146a` |
| `orientation-int8.onnx` | 가벼운 모드 | 21.0MB | `3db1a8d5dc9038395bf559624d2bd17464dafd168d9a8c18525f116bc8600b6c` |

## 출처와 라이선스

- 원본: [DuarteBarbosa/deep-image-orientation-detection](https://huggingface.co/DuarteBarbosa/deep-image-orientation-detection) (EfficientNetV2, MIT License)
- 위 두 파일은 원본 ONNX(`orientation_model_v2_0.9882.onnx`)를 변환한 것입니다.
  - fp16: `onnxconverter_common.float16` (입출력은 float32 유지)
  - int8: `onnxruntime.quantization.quantize_dynamic` (가중치 QUInt8)
- 입력: `input` [N,3,384,384] float32. 384×384로 리사이즈한 뒤 ImageNet 정규화를 적용한다.
- 출력: `output` [N,4]. k번째 값은 "이미지가 반시계 방향으로 k×90° 돌아가 있음"을 뜻한다.

## 모델 파일을 바꿀 때

`01_확장프로그램_소스/ai-config.js`의 `sha256`과 `bytes`를 같이 바꿀 것. 해시가 다르면 확장이 설치를 거부한다.
