// 페이지(MAIN world)에서 실행됩니다.
// 네이버 에디터가 input.files / dataTransfer.files·items / 폴더 내용(readEntries)을 읽을 때
// 정렬된 순서로 돌려주고, 정렬 결과를 알림과 오른쪽 목록 패널로 보여줍니다.
(() => {
  if (window.__nboInstalled) return;
  window.__nboInstalled = true;

  const APP = "네이버 블로그 파일 순서 유지";
  const DEFAULTS = { enabled: true, criterion: "name", order: "asc", toast: true, panel: true, thumbs: true };
  const LABEL = { name: "파일명", lastModified: "수정한 날짜", exif: "촬영일", size: "크기", type: "종류" };
  const collator = new Intl.Collator("ko", { numeric: true, sensitivity: "base" });

  function settings() {
    try {
      const raw = document.documentElement && document.documentElement.getAttribute("data-nbo-settings");
      return Object.assign({}, DEFAULTS, raw ? JSON.parse(raw) : {});
    } catch (_) {
      return DEFAULTS;
    }
  }

  // ======================================================================
  // 촬영일 읽기: JPEG(EXIF), HEIC/HEIF(Exif 아이템), PNG(eXIf 청크)
  // ======================================================================
  const isJpeg = (f) => /jpe?g$/i.test(f.type) || /\.jpe?g$/i.test(f.name);
  const isHeif = (f) => /hei[cf]/i.test(f.type) || /\.(heic|heif|hif)$/i.test(f.name);
  const isPng = (f) => /png$/i.test(f.type) || /\.png$/i.test(f.name);

  async function readExifDate(file) {
    try {
      if (isJpeg(file)) return parseJpegDate(new DataView(await file.slice(0, 256 * 1024).arrayBuffer()));
      if (isHeif(file)) return await parseHeifDate(file);
      if (isPng(file)) return parsePngDate(new DataView(await file.slice(0, 1024 * 1024).arrayBuffer()));
    } catch (_) {}
    return null;
  }

  function parseJpegDate(v) {
    if (v.byteLength < 4 || v.getUint16(0) !== 0xffd8) return null;
    let off = 2;
    while (off + 4 <= v.byteLength) {
      if (v.getUint8(off) !== 0xff) return null;
      const marker = v.getUint8(off + 1);
      const len = v.getUint16(off + 2);
      if (marker === 0xe1 && off + 10 <= v.byteLength && v.getUint32(off + 4) === 0x45786966 /* Exif */) {
        return parseTiff(v, off + 10);
      }
      if (marker === 0xda) return null;
      off += 2 + len;
    }
    return null;
  }

  function parsePngDate(v) {
    if (v.byteLength < 8 || v.getUint32(0) !== 0x89504e47) return null;
    let off = 8;
    while (off + 8 <= v.byteLength) {
      const len = v.getUint32(off);
      const type = v.getUint32(off + 4);
      if (type === 0x65584966 /* eXIf */) return parseTiff(v, off + 8);
      if (type === 0x49454e44 /* IEND */) return null;
      off += 12 + len;
    }
    return null;
  }

  // HEIC/HEIF: meta 박스 → iinf에서 'Exif' 아이템 ID → iloc에서 위치 → 해당 구간의 TIFF 파싱
  async function parseHeifDate(file) {
    const head = new DataView(await file.slice(0, 512 * 1024).arrayBuffer());
    const meta = findBox(head, 0, head.byteLength, "meta");
    if (!meta) return null;
    const kids = meta.start + 4; // FullBox(version+flags)
    const iinf = findBox(head, kids, meta.end, "iinf");
    const iloc = findBox(head, kids, meta.end, "iloc");
    if (!iinf || !iloc) return null;

    // iinf → infe 목록에서 item_type == 'Exif'
    let exifId = null;
    {
      const ver = head.getUint8(iinf.start);
      let p = iinf.start + 4 + (ver === 0 ? 2 : 4);
      while (p + 8 <= iinf.end && exifId === null) {
        const b = boxAt(head, p);
        if (!b) break;
        if (b.type === "infe") {
          const iv = head.getUint8(b.start);
          if (iv >= 2) {
            let q = b.start + 4;
            const id = iv === 2 ? head.getUint16(q) : head.getUint32(q);
            q += iv === 2 ? 2 : 4;
            q += 2; // item_protection_index
            if (fourcc(head, q) === "Exif") exifId = id;
          }
        }
        p = b.end;
      }
    }
    if (exifId === null) return null;

    // iloc에서 아이템 위치
    const ver = head.getUint8(iloc.start);
    let p = iloc.start + 4;
    const s1 = head.getUint8(p), s2 = head.getUint8(p + 1);
    p += 2;
    const offSize = s1 >> 4, lenSize = s1 & 15, baseSize = s2 >> 4, idxSize = ver >= 1 ? s2 & 15 : 0;
    const count = ver < 2 ? head.getUint16(p) : head.getUint32(p);
    p += ver < 2 ? 2 : 4;
    for (let i = 0; i < count; i++) {
      const id = ver < 2 ? head.getUint16(p) : head.getUint32(p);
      p += ver < 2 ? 2 : 4;
      let method = 0;
      if (ver >= 1) { method = head.getUint16(p) & 15; p += 2; }
      p += 2; // data_reference_index
      const base = readN(head, p, baseSize); p += baseSize;
      const extents = head.getUint16(p); p += 2;
      let first = null;
      for (let e = 0; e < extents; e++) {
        if (ver >= 1 && idxSize) p += idxSize;
        const eo = readN(head, p, offSize); p += offSize;
        const el = readN(head, p, lenSize); p += lenSize;
        if (!first) first = { off: base + eo, len: el };
      }
      if (id === exifId && first && method === 0) {
        const len = first.len || 64 * 1024;
        const v = new DataView(await file.slice(first.off, first.off + len).arrayBuffer());
        const tiff = 4 + v.getUint32(0);
        return parseTiff(v, tiff);
      }
    }
    return null;
  }

  function fourcc(v, o) {
    return String.fromCharCode(v.getUint8(o), v.getUint8(o + 1), v.getUint8(o + 2), v.getUint8(o + 3));
  }
  function readN(v, o, n) {
    if (n === 0) return 0;
    if (n === 4) return v.getUint32(o);
    if (n === 8) return v.getUint32(o) * 4294967296 + v.getUint32(o + 4);
    if (n === 2) return v.getUint16(o);
    return 0;
  }
  function boxAt(v, p) {
    if (p + 8 > v.byteLength) return null;
    let size = v.getUint32(p);
    const type = fourcc(v, p + 4);
    let hdr = 8;
    if (size === 1) { size = readN(v, p + 8, 8); hdr = 16; }
    else if (size === 0) size = v.byteLength - p;
    if (size < hdr) return null;
    return { type, start: p + hdr, end: Math.min(p + size, v.byteLength) };
  }
  function findBox(v, from, to, type) {
    let p = from;
    while (p + 8 <= to) {
      const b = boxAt(v, p);
      if (!b) return null;
      if (b.type === type) return b;
      p = b.end;
    }
    return null;
  }

  function parseTiff(v, start) {
    const bo = v.getUint16(start);
    if (bo !== 0x4949 && bo !== 0x4d4d) return null;
    const le = bo === 0x4949;
    const u16 = (o) => v.getUint16(start + o, le);
    const u32 = (o) => v.getUint32(start + o, le);
    const str = (o, n) => {
      let s = "";
      for (let i = 0; i < n && start + o + i < v.byteLength; i++) {
        const c = v.getUint8(start + o + i);
        if (c === 0) break;
        s += String.fromCharCode(c);
      }
      return s;
    };
    const readIfd = (ifdOff) => {
      const out = {};
      if (start + ifdOff + 2 > v.byteLength) return out;
      const n = u16(ifdOff);
      for (let i = 0; i < n; i++) {
        const e = ifdOff + 2 + i * 12;
        if (start + e + 12 > v.byteLength) break;
        const tag = u16(e);
        if (tag === 0x8769) out.exifPtr = u32(e + 8);
        else if (tag === 0x9003 || tag === 0x9004 || tag === 0x0132) {
          const count = u32(e + 4);
          out[tag] = str(count > 4 ? u32(e + 8) : e + 8, count);
        }
      }
      return out;
    };
    const ifd0 = readIfd(u32(4));
    const exif = ifd0.exifPtr ? readIfd(ifd0.exifPtr) : {};
    const s = exif[0x9003] || exif[0x9004] || ifd0[0x0132];
    const m = s && s.match(/^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})/);
    if (!m) return null;
    return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
  }

  // ======================================================================
  // 정렬
  // ======================================================================
  function compareBy(criterion, keyOf) {
    return (a, b) => {
      let r = 0;
      if (criterion === "name") r = collator.compare(a.name, b.name);
      else if (criterion === "lastModified") r = a.lastModified - b.lastModified;
      else if (criterion === "size") r = a.size - b.size;
      else if (criterion === "type") r = collator.compare(a.type || "", b.type || "");
      else if (criterion === "exif") r = (keyOf.get(a) ?? a.lastModified) - (keyOf.get(b) ?? b.lastModified);
      return r || collator.compare(a.name, b.name);
    };
  }

  function sortFiles(files, s, keyOf) {
    const arr = files.slice().sort(compareBy(s.criterion, keyOf || new Map()));
    if (s.order === "desc") arr.reverse();
    return arr;
  }

  // 촬영일 기준이면 비동기로 날짜를 읽은 뒤 정렬
  async function sortFilesAsync(files, s) {
    const keyOf = new Map();
    if (s.criterion === "exif") {
      const dates = await Promise.all(files.map(readExifDate));
      files.forEach((f, i) => { if (dates[i] != null) keyOf.set(f, dates[i]); });
    }
    return { arr: sortFiles(files, s, keyOf), keyOf };
  }

  const fileKey = (f) => f.name + ":" + f.size + ":" + f.lastModified;

  const inputDesc = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "files");
  const dtFilesDesc = Object.getOwnPropertyDescriptor(DataTransfer.prototype, "files");
  const dtItemsDesc = Object.getOwnPropertyDescriptor(DataTransfer.prototype, "items");

  function toFileList(files) {
    const dt = new DataTransfer();
    files.forEach((f) => dt.items.add(f));
    return dtFilesDesc.get.call(dt); // 패치된 getter를 거치지 않도록 원본 사용
  }

  function signature(list, s) {
    let sig = s.criterion + "|" + s.order;
    for (let i = 0; i < list.length; i++) sig += "|" + fileKey(list[i]);
    return sig;
  }

  const cache = new Map(); // signature -> { ready, sorted, arr, promise }
  function remember(sig, entry) {
    cache.set(sig, entry);
    if (cache.size > 30) cache.delete(cache.keys().next().value);
  }

  function prepare(list) {
    const s = settings();
    if (!s.enabled || !list || list.length < 2) return null;
    const sig = signature(list, s);
    let entry = cache.get(sig);
    if (entry) return entry;
    const files = Array.from(list);
    if (s.criterion !== "exif") {
      const arr = sortFiles(files, s);
      entry = { ready: true, sorted: toFileList(arr), arr };
      remember(sig, entry);
      notify({ arr, s, keyOf: new Map(), source: "files" });
      return entry;
    }
    entry = { ready: false, sorted: null };
    entry.promise = sortFilesAsync(files, s).then(({ arr, keyOf }) => {
      entry.sorted = toFileList(arr);
      entry.arr = arr;
      entry.ready = true;
      notify({ arr, s, keyOf, source: "files" });
    });
    remember(sig, entry);
    return entry;
  }

  function sortedOrSame(list) {
    const entry = prepare(list);
    return entry && entry.ready ? entry.sorted : list;
  }

  // ======================================================================
  // files / items 속성 가로채기
  // ======================================================================
  Object.defineProperty(HTMLInputElement.prototype, "files", {
    configurable: true,
    enumerable: inputDesc.enumerable,
    get() {
      const list = inputDesc.get.call(this);
      return this.type === "file" ? sortedOrSame(list) : list;
    },
    set(v) { inputDesc.set.call(this, v); },
  });

  // 대신 넘겨줄 DataTransfer (촬영일 기준으로 드롭 처리를 미룬 경우 사용)
  const replacedDt = new WeakMap();

  Object.defineProperty(DataTransfer.prototype, "files", {
    configurable: true,
    enumerable: dtFilesDesc.enumerable,
    get() { return sortedOrSame(dtFilesDesc.get.call(this)); },
  });

  // 끌어다 놓기에서 에디터가 items(webkitGetAsEntry 등)를 쓰는 경우에도 같은 순서로
  if (dtItemsDesc) {
    Object.defineProperty(DataTransfer.prototype, "items", {
      configurable: true,
      enumerable: dtItemsDesc.enumerable,
      get() {
        const real = dtItemsDesc.get.call(this);
        try {
          const s = settings();
          if (!s.enabled || real.length < 2) return real;
          const entry = prepare(dtFilesDesc.get.call(this));
          if (!entry || !entry.ready) return real;
          const rank = new Map(entry.arr.map((f, i) => [fileKey(f), i]));
          const idx = [];
          for (let i = 0; i < real.length; i++) {
            const it = real[i];
            const f = it.kind === "file" ? it.getAsFile() : null;
            idx.push({ i, r: f && rank.has(fileKey(f)) ? rank.get(fileKey(f)) : 1e9 + i });
          }
          idx.sort((a, b) => a.r - b.r);
          const order = idx.map((x) => x.i);
          return reorderedList(real, order);
        } catch (_) {
          return real;
        }
      },
    });
  }

  function reorderedList(real, order) {
    return new Proxy(real, {
      get(t, p) {
        if (typeof p === "string" && /^\d+$/.test(p)) return t[order[+p]];
        if (p === Symbol.iterator) return function* () { for (const i of order) yield t[i]; };
        if (p === "length") return t.length;
        const v = Reflect.get(t, p, t);
        return typeof v === "function" ? v.bind(t) : v;
      },
    });
  }

  // ======================================================================
  // 폴더째 끌어다 놓기: 폴더 안 목록(readEntries)을 정렬
  // ======================================================================
  // 크롬은 디렉터리 리더 클래스를 전역에 노출하지 않으므로, 폴더 항목을 처음 만났을 때 그 프로토타입을 패치
  const patchedReaderProtos = new WeakSet();
  function patchReaderFrom(dirEntry) {
    if (!dirEntry || !dirEntry.isDirectory || typeof dirEntry.createReader !== "function") return;
    const proto = Object.getPrototypeOf(dirEntry.createReader());
    if (!proto || patchedReaderProtos.has(proto) || typeof proto.readEntries !== "function") return;
    patchedReaderProtos.add(proto);
    const origRead = proto.readEntries;
    proto.readEntries = function (success, error) {
      const ok = typeof success === "function" ? success : success && success.handleEvent && ((x) => success.handleEvent(x));
      return origRead.call(this, (entries) => {
        sortEntries(entries).then((sorted) => ok && ok(sorted), () => ok && ok(entries));
      }, error);
    };
  }
  if (window.DataTransferItem && DataTransferItem.prototype.webkitGetAsEntry) {
    const origGetEntry = DataTransferItem.prototype.webkitGetAsEntry;
    DataTransferItem.prototype.webkitGetAsEntry = function () {
      const entry = origGetEntry.call(this);
      try { patchReaderFrom(entry); } catch (_) {}
      return entry;
    };
  }
  Object.defineProperty(window, "__nboPatchDirEntry", { value: patchReaderFrom }); // 테스트용

  async function sortEntries(entries) {
    const s = settings();
    if (!s.enabled || !entries || entries.length < 2) return entries;
    const fileEntries = entries.filter((e) => e.isFile);
    const dirEntries = entries.filter((e) => !e.isFile).sort((a, b) => collator.compare(a.name, b.name));
    if (fileEntries.length < 2) return fileEntries.concat(dirEntries);
    const files = await Promise.all(fileEntries.map((e) => new Promise((res, rej) => e.file(res, rej))));
    const byFile = new Map(files.map((f, i) => [f, fileEntries[i]]));
    const { arr, keyOf } = await sortFilesAsync(files, s);
    notify({ arr, s, keyOf, source: "folder" });
    return arr.map((f) => byFile.get(f)).concat(dirEntries);
  }

  // ======================================================================
  // 촬영일 기준일 때: 정렬이 끝날 때까지 리스너 실행을 잠시 미룸
  // ======================================================================
  function rawListOf(e) {
    if (e.type === "drop") return e.dataTransfer ? dtFilesDesc.get.call(e.dataTransfer) : null;
    const t = e.target;
    if (t instanceof HTMLInputElement && t.type === "file") return inputDesc.get.call(t);
    return null;
  }

  // 드롭 이벤트가 끝나면 원래 dataTransfer는 비워지므로, 내용을 미리 복사해 둔 대체 객체를 만듦
  function snapshotDrop(realDt) {
    const items = [];
    const realItems = dtItemsDesc ? dtItemsDesc.get.call(realDt) : [];
    for (let i = 0; i < realItems.length; i++) {
      const it = realItems[i];
      items.push({
        kind: it.kind,
        type: it.type,
        file: it.kind === "file" ? it.getAsFile() : null,
        entry: it.webkitGetAsEntry ? it.webkitGetAsEntry() : null,
      });
    }
    return {
      items,
      types: Array.from(realDt.types || []),
      dropEffect: realDt.dropEffect,
      effectAllowed: realDt.effectAllowed,
    };
  }

  function fakeDataTransfer(snap, entry) {
    const rank = new Map(entry.arr.map((f, i) => [fileKey(f), i]));
    const items = snap.items
      .map((it, i) => ({ it, r: it.file && rank.has(fileKey(it.file)) ? rank.get(fileKey(it.file)) : 1e9 + i }))
      .sort((a, b) => a.r - b.r)
      .map(({ it }) => ({
        kind: it.kind,
        type: it.type,
        getAsFile: () => it.file,
        webkitGetAsEntry: () => it.entry,
        getAsString: (cb) => cb && cb(""),
      }));
    const itemList = Object.assign(items.slice(), { add() {}, remove() {}, clear() {} });
    return {
      files: entry.sorted,
      items: itemList,
      types: snap.types,
      dropEffect: snap.dropEffect,
      effectAllowed: snap.effectAllowed,
      getData: () => "",
      setData() {},
      clearData() {},
      setDragImage() {},
    };
  }

  const WATCH = { change: 1, input: 1, drop: 1 };
  const wrappers = new WeakMap();
  const origAdd = EventTarget.prototype.addEventListener;
  const origRemove = EventTarget.prototype.removeEventListener;

  function wrap(listener) {
    let w = wrappers.get(listener);
    if (w) return w;
    w = function (e) {
      const call = (thisArg, ev) =>
        typeof listener === "function" ? listener.call(thisArg, ev) : listener.handleEvent(ev);
      const list = rawListOf(e);
      const entry = list && prepare(list);
      if (!entry || entry.ready) return call(this, e);

      const self = this;
      const currentTarget = e.currentTarget;
      let snap = null;
      if (e.type === "drop") {
        e.preventDefault();
        snap = replacedDt.get(e) || snapshotDrop(e.dataTransfer);
        replacedDt.set(e, snap);
      }
      entry.promise.then(() => {
        const dt = snap ? fakeDataTransfer(snap, entry) : null;
        const proxy = new Proxy(e, {
          get(target, prop) {
            if (prop === "currentTarget") return currentTarget;
            if (prop === "dataTransfer" && dt) return dt;
            const val = Reflect.get(target, prop, target);
            return typeof val === "function" ? val.bind(target) : val;
          },
        });
        call(self, proxy);
      });
    };
    wrappers.set(listener, w);
    return w;
  }

  EventTarget.prototype.addEventListener = function (type, listener, opts) {
    if (listener && WATCH[type] && (typeof listener === "function" || typeof listener.handleEvent === "function")) {
      return origAdd.call(this, type, wrap(listener), opts);
    }
    return origAdd.call(this, type, listener, opts);
  };
  EventTarget.prototype.removeEventListener = function (type, listener, opts) {
    if (listener && WATCH[type] && wrappers.has(listener)) {
      origRemove.call(this, type, wrappers.get(listener), opts);
    }
    return origRemove.call(this, type, listener, opts);
  };

  // ======================================================================
  // 알림 + 정렬 결과 목록 패널
  // ======================================================================
  let lastResult = null;
  let lastNotify = 0;

  function notify(result) {
    const now = Date.now();
    // 같은 묶음을 여러 리스너가 읽어도 한 번만 표시
    if (lastResult && now - lastNotify < 800 && lastResult.arr.length === result.arr.length) return;
    lastNotify = now;
    lastResult = Object.assign({ at: now }, result);
    const s = result.s;
    const run = () => {
      if (s.toast) showToast(result);
      if (s.panel) showPanel(lastResult);
    };
    document.body ? run() : origAdd.call(document, "DOMContentLoaded", run, { once: true });
    console.info("[" + APP + "]", result.arr.map((f) => f.name));
  }

  function summary(r) {
    const dir = r.s.order === "desc" ? "내림차순" : "오름차순";
    return `파일 ${r.arr.length}개를 ${LABEL[r.s.criterion]} ${dir}으로 정리했어요`;
  }
  function missingCount(r) {
    return r.s.criterion === "exif" ? r.arr.filter((f) => !r.keyOf.has(f)).length : 0;
  }

  function showToast(r) {
    const el = document.createElement("div");
    const title = document.createElement("strong");
    title.textContent = APP;
    title.style.cssText = "color:#03c75a";
    let msg = summary(r);
    const miss = missingCount(r);
    if (miss) msg += ` (촬영일 없는 ${miss}개는 수정일 기준)`;
    el.append(title, ": " + msg);
    el.style.cssText =
      "position:fixed;z-index:2147483647;left:50%;bottom:32px;transform:translateX(-50%);" +
      "background:rgba(30,30,30,.92);color:#fff;padding:10px 16px;border-radius:8px;" +
      "font:13px/1.4 -apple-system,'Apple SD Gothic Neo',sans-serif;box-shadow:0 4px 16px rgba(0,0,0,.25);" +
      "pointer-events:none;white-space:nowrap;max-width:calc(100vw - 32px);overflow:hidden;text-overflow:ellipsis";
    (document.body || document.documentElement).appendChild(el);
    setTimeout(() => el.remove(), 2600);
  }

  const fmtDate = (ms) => {
    const d = new Date(ms);
    const p = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}.${p(d.getMonth() + 1)}.${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  };
  const fmtUtcDate = (ms) => {
    const d = new Date(ms);
    const p = (n) => String(n).padStart(2, "0");
    return `${d.getUTCFullYear()}.${p(d.getUTCMonth() + 1)}.${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
  };
  const fmtSize = (b) => (b >= 1048576 ? (b / 1048576).toFixed(1) + " MB" : Math.max(1, Math.round(b / 1024)) + " KB");

  function valueOf(r, f) {
    switch (r.s.criterion) {
      case "lastModified": return fmtDate(f.lastModified);
      case "exif": return r.keyOf.has(f) ? fmtUtcDate(r.keyOf.get(f)) : "촬영일 없음 · " + fmtDate(f.lastModified);
      case "size": return fmtSize(f.size);
      case "type": return f.type || "알 수 없음";
      default: return fmtSize(f.size);
    }
  }

  // ======================================================================
  // 썸네일: 원본을 작게 줄인 그림만 남기고, 한 장씩 차례로 처리
  // ======================================================================
  const THUMB_PX = 96; // 40px 칸 × 고해상도 화면 여유
  const thumbCache = new Map(); // fileKey -> Promise<objectURL|null>
  let thumbChain = Promise.resolve();

  function extLabel(f) {
    const m = f.name.match(/\.([a-z0-9]{1,5})$/i);
    return m ? m[1].toUpperCase() : "FILE";
  }

  function canDecode(f) {
    return /^image\/(jpeg|png|gif|webp|bmp|avif)$/i.test(f.type) || /\.(jpe?g|png|gif|webp|bmp|avif)$/i.test(f.name);
  }

  function makeThumb(f) {
    return new Promise((resolve) => {
      // 앞 작업이 끝난 뒤 실행 → 동시에 한 장만 디코딩
      thumbChain = thumbChain.then(async () => {
        let bmp = null;
        try {
          bmp = await createImageBitmap(f, { resizeWidth: THUMB_PX, resizeQuality: "medium" });
          const side = Math.min(bmp.width, bmp.height);
          const c = document.createElement("canvas");
          c.width = c.height = Math.min(THUMB_PX, side);
          c.getContext("2d").drawImage(
            bmp, (bmp.width - side) / 2, (bmp.height - side) / 2, side, side, 0, 0, c.width, c.height
          );
          const blob = await new Promise((r) => c.toBlob(r, "image/jpeg", 0.8));
          resolve(blob ? URL.createObjectURL(blob) : null);
        } catch (_) {
          resolve(null);
        } finally {
          if (bmp) bmp.close();
        }
        await new Promise((r) => setTimeout(r, 0)); // 에디터 작업에 틈 주기
      });
    });
  }

  function getThumb(f) {
    if (!canDecode(f)) return Promise.resolve(null);
    const k = fileKey(f);
    if (!thumbCache.has(k)) {
      thumbCache.set(k, makeThumb(f));
      // 오래된 썸네일 정리 (최근 200장만 유지)
      if (thumbCache.size > 200) {
        const [oldKey, oldP] = thumbCache.entries().next().value;
        thumbCache.delete(oldKey);
        oldP.then((u) => u && URL.revokeObjectURL(u));
      }
    }
    return thumbCache.get(k);
  }

  const PANEL_CSS = `
    :host { all: initial; }
    .wrap { position: fixed; top: 88px; right: 16px; z-index: 2147483646; width: 340px; max-height: calc(100vh - 120px);
      display: flex; flex-direction: column; background: #fff; color: #222; border-radius: 12px;
      box-shadow: 0 10px 32px rgba(0,0,0,.18); border: 1px solid #e3e5e8;
      font: 12px/1.45 -apple-system, "Apple SD Gothic Neo", "Malgun Gothic", sans-serif; overflow: hidden; }
    header { padding: 12px 14px 10px; border-bottom: 1px solid #eef0f2; }
    .top { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
    .title { font-weight: 700; color: #03c75a; font-size: 13px; }
    .close { all: unset; cursor: pointer; width: 24px; height: 24px; border-radius: 6px; text-align: center;
      line-height: 24px; font-size: 18px; color: #666; }
    .close:hover { background: #f1f3f5; color: #111; }
    .meta { margin-top: 4px; color: #555; }
    .sub { margin-top: 2px; color: #999; font-size: 11px; }
    ol { list-style: none; margin: 0; padding: 6px 0; overflow-y: auto; flex: 1; }
    li { display: grid; grid-template-columns: 30px 1fr; column-gap: 4px; align-items: center; padding: 5px 14px; }
    li.has-thumb { grid-template-columns: 30px 1fr 44px; }
    .thumb { grid-column: 3; grid-row: 1 / 3; width: 40px; height: 40px; border-radius: 6px; background: #eef0f2;
      object-fit: cover; display: block; justify-self: end; }
    .thumb.ph { display: flex; align-items: center; justify-content: center; color: #aab0b6; font-size: 10px; font-weight: 600; }
    li:nth-child(odd) { background: #fafbfc; }
    .n { grid-row: 1 / 3; align-self: start; color: #03c75a; font-weight: 700; font-variant-numeric: tabular-nums; }
    .name { grid-column: 2; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #222; }
    .val { grid-column: 2; color: #999; font-size: 11px; }
    footer { padding: 8px 14px 10px; border-top: 1px solid #eef0f2; color: #777; font-size: 11px; }
    footer label { cursor: pointer; display: inline-flex; align-items: center; gap: 6px; }
  `;

  let panelHost = null;

  function showPanel(r) {
    if (!r) return;
    if (!panelHost || !panelHost.isConnected) {
      panelHost = document.createElement("div");
      panelHost.id = "nbo-panel-host";
      panelHost.attachShadow({ mode: "open" });
      (document.body || document.documentElement).appendChild(panelHost);
    }
    const root = panelHost.shadowRoot;
    root.textContent = "";
    const style = document.createElement("style");
    style.textContent = PANEL_CSS;
    const wrap = document.createElement("div");
    wrap.className = "wrap";

    const header = document.createElement("header");
    const top = document.createElement("div");
    top.className = "top";
    const title = document.createElement("div");
    title.className = "title";
    title.textContent = APP;
    const close = document.createElement("button");
    close.className = "close";
    close.title = "닫기";
    close.textContent = "×";
    origAdd.call(close, "click", () => panelHost.remove());
    top.append(title, close);
    const meta = document.createElement("div");
    meta.className = "meta";
    meta.textContent = summary(r);
    header.append(top, meta);
    const miss = missingCount(r);
    const sub = document.createElement("div");
    sub.className = "sub";
    sub.textContent =
      (r.source === "folder" ? "폴더 안 파일 기준 · " : "") +
      (miss ? `촬영일 없는 ${miss}개는 수정일 기준 · ` : "") +
      fmtDate(r.at);
    header.append(sub);

    const ol = document.createElement("ol");
    const showThumbs = settings().thumbs !== false;
    const thumbSlots = new Map();
    // 화면에 보이는 줄만 썸네일 생성
    const io = new IntersectionObserver((entries) => {
      for (const en of entries) {
        if (!en.isIntersecting) continue;
        io.unobserve(en.target);
        const f = thumbSlots.get(en.target);
        getThumb(f).then((url) => {
          if (!url || !en.target.isConnected) return;
          const img = document.createElement("img");
          img.className = "thumb";
          img.alt = "";
          img.src = url;
          en.target.replaceWith(img);
        });
      }
    }, { root: ol, rootMargin: "120px 0px" });
    r.arr.forEach((f, i) => {
      const li = document.createElement("li");
      const n = document.createElement("span");
      n.className = "n";
      n.textContent = String(i + 1).padStart(2, "0");
      const name = document.createElement("span");
      name.className = "name";
      name.textContent = f.name;
      name.title = f.name;
      const val = document.createElement("span");
      val.className = "val";
      val.textContent = valueOf(r, f);
      li.append(n, name, val);
      if (showThumbs) {
        li.classList.add("has-thumb");
        const ph = document.createElement("div");
        ph.className = "thumb ph";
        ph.textContent = extLabel(f);
        li.append(ph);
        thumbSlots.set(ph, f);
        io.observe(ph);
      }
      ol.append(li);
    });

    const footer = document.createElement("footer");
    const label = document.createElement("label");
    const cb = document.createElement("input");
    cb.type = "checkbox";
    origAdd.call(cb, "change", () => {
      window.postMessage({ __nbo: "set", patch: { panel: !cb.checked } }, location.origin);
    });
    label.append(cb, "다음부터 자동으로 열지 않기");
    footer.append(label);

    wrap.append(header, ol, footer);
    root.append(style, wrap);
  }

  // 설정 창의 "최근 정렬 결과 보기" 버튼
  origAdd.call(window, "message", (e) => {
    if (e.source !== window || !e.data || e.data.__nbo !== "show-panel") return;
    if (lastResult) showPanel(lastResult);
  });
})();
