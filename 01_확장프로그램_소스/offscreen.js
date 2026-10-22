// 오프스크린 문서: 모델 다운로드·저장·삭제와 방향 분석을 담당합니다.
// 사진은 콘텐츠 스크립트가 384×384로 줄인 픽셀만 받으며, 어디로도 전송하지 않습니다.
ort.env.wasm.wasmPaths = chrome.runtime.getURL("ort/");
ort.env.wasm.numThreads = 1;

const MEAN = [0.485, 0.456, 0.406];
const STD = [0.229, 0.224, 0.225];
const sessions = new Map(); // mode -> Promise<InferenceSession>
let queue = Promise.resolve();

function report(status) {
  return chrome.runtime.sendMessage({ target: "bg", type: "status", status }).catch(() => {});
}

function toHex(buf) {
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
}

async function install(mode) {
  const m = NBO_AI.models[mode];
  try {
    const res = await fetch(m.url, { cache: "no-store" });
    if (!res.ok) throw new Error("다운로드 실패 (HTTP " + res.status + ")");
    const total = Number(res.headers.get("content-length")) || m.bytes;
    const reader = res.body.getReader();
    const chunks = [];
    let got = 0, lastPct = -1;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      got += value.length;
      const pct = Math.min(99, Math.floor((got / total) * 100));
      if (pct >= lastPct + 3) { lastPct = pct; report({ mode, state: "downloading", progress: pct }); }
    }
    const blob = new Blob(chunks);
    const buf = await blob.arrayBuffer();
    const hash = toHex(await crypto.subtle.digest("SHA-256", buf));
    if (hash !== m.sha256) throw new Error("모델 파일 검증 실패 (해시 불일치)");

    // 다른 모드 모델은 지우고 새 모델만 남김
    await caches.delete(NBO_AI.cacheName);
    const cache = await caches.open(NBO_AI.cacheName);
    await cache.put(m.url, new Response(blob, { headers: { "content-type": "application/octet-stream" } }));
    sessions.clear();
    await report({ mode, state: "ready", progress: 100, bytes: buf.byteLength, error: null });
    return { ok: true };
  } catch (e) {
    await report({ mode, state: "error", progress: 0, error: String(e && e.message || e) });
    return { ok: false, error: String(e && e.message || e) };
  }
}

async function remove() {
  sessions.clear();
  await caches.delete(NBO_AI.cacheName);
  return { ok: true };
}

function getSession(mode) {
  if (!sessions.has(mode)) {
    const p = (async () => {
      const m = NBO_AI.models[mode];
      const cache = await caches.open(NBO_AI.cacheName);
      const hit = await cache.match(m.url);
      if (!hit) throw new Error("model-missing");
      const bytes = new Uint8Array(await hit.arrayBuffer());
      return ort.InferenceSession.create(bytes, { executionProviders: ["wasm"] });
    })();
    p.catch(() => sessions.delete(mode));
    sessions.set(mode, p);
  }
  return sessions.get(mode);
}

function fromBase64(b64) {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

async function analyze(mode, rgbB64) {
  const session = await getSession(mode);
  const S = NBO_AI.inputSize, N = S * S;
  const px = fromBase64(rgbB64);
  if (px.length !== N * 3) throw new Error("bad-input");
  const x = new Float32Array(3 * N);
  for (let i = 0; i < N; i++) {
    for (let c = 0; c < 3; c++) x[c * N + i] = (px[i * 3 + c] / 255 - MEAN[c]) / STD[c];
  }
  const out = await session.run({ input: new ort.Tensor("float32", x, [1, 3, S, S]) });
  const logits = Array.from(out.output.data);
  const mx = Math.max(...logits);
  const e = logits.map((v) => Math.exp(v - mx));
  const z = e.reduce((a, b) => a + b, 0);
  return e.map((v) => v / z);
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.target !== "offscreen") return;
  let job;
  if (msg.type === "install") job = install(msg.mode);
  else if (msg.type === "delete") job = remove();
  else if (msg.type === "analyze") {
    // 한 번에 한 장씩
    job = queue = queue.then(() => analyze(msg.mode, msg.rgb)).then(
      (probs) => ({ ok: true, probs }),
      (e) => ({ ok: false, error: String(e && e.message || e) })
    );
  } else return;
  job.then(sendResponse, (e) => sendResponse({ ok: false, error: String(e) }));
  return true;
});
