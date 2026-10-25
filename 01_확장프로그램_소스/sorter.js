// 페이지(MAIN world)에서 실행됩니다.
// 네이버 에디터가 input.files / dataTransfer.files·items / 폴더 내용(readEntries)을 읽을 때
// 정렬된 순서로 돌려주고, 정렬 결과를 알림과 오른쪽 목록 패널로 보여줍니다.
(() => {
  if (window.__nboInstalled) return;
  // 카페 에디터의 숨은 입력 보조 iframe(#input_buffer…)에는 본문 복사본이 있어 중복 처리될 수 있으므로 건너뜀
  try { if (window.frameElement && /^input_buffer/.test(window.frameElement.id || "")) return; } catch (_) {}
  window.__nboInstalled = true;

  // 카페는 사이트 전체에 주입되므로(SPA) 글쓰기·수정 화면에서만 정렬함. 블로그는 기존과 같음
  function pageLoc() { try { return window.top.location; } catch (_) { return location; } }
  const CAFE_EDITOR_PATH = /\/articles\/write|\/articles\/\d+\/modify|ArticleWrite|ArticleModify/i;
  function onEditorPage() {
    const l = pageLoc();
    return l.hostname !== "cafe.naver.com" || CAFE_EDITOR_PATH.test(l.pathname);
  }

  const APP = "네이버 블로그 사진(파일) 업로드 순서 유지 +회전(AI)";
  const APP_SHORT = "사진 업로드 순서 유지 +회전(AI)"; // 화면 표시용 (알림·목록 제목)
  const DEFAULTS = { enabled: true, criterion: "name", order: "asc", toast: true, panel: true, thumbs: true, aiMode: "off" };
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

  const cache = new Map(); // signature -> { ready, sorted, arr, keyOf, promise }

  // 사용자가 파일을 새로 고르거나 끌어다 놓은 순간 표시 → 캐시된 정렬을 다시 쓰더라도 새 업로드로 처리
  let freshPick = false;
  const markFreshPick = (e) => {
    const t = e.target;
    if (e.type === "drop" || (t instanceof HTMLInputElement && t.type === "file")) freshPick = true;
  };
  function remember(sig, entry) {
    cache.set(sig, entry);
    if (cache.size > 30) cache.delete(cache.keys().next().value);
  }

  function prepare(list) {
    const s = settings();
    if (!s.enabled || !onEditorPage() || !list || list.length < 2) return null;
    const sig = signature(list, s);
    let entry = cache.get(sig);
    if (entry) {
      // 같은 파일을 다시 고른 경우(사진을 지우고 다시 올림 등): 정렬은 재사용하되 새 업로드로 알림
      if (freshPick && entry.ready) {
        freshPick = false;
        notify({ arr: entry.arr, s, keyOf: entry.keyOf || new Map(), source: "files" });
      }
      return entry;
    }
    freshPick = false;
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
      entry.keyOf = keyOf;
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
    if (!s.enabled || !onEditorPage() || !entries || entries.length < 2) return entries;
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
  // 에디터 리스너보다 먼저(캡처 단계) "새로 고름"을 표시
  for (const type of ["input", "change", "drop"]) origAdd.call(window, type, markFreshPick, true);
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
    lastResult.preCompIds = snapshotCompIds(); // 이번 업로드 전부터 있던 사진 (AI 회전 대상에서 제외)
    const s = result.s;
    const current = lastResult;
    const run = () => {
      if (s.toast) showToast(result);
      if (s.panel) showPanel(current);
      maybeStartAi(current);
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
    title.textContent = APP_SHORT;
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
    .ai { margin-top: 10px; padding: 10px 12px; border-radius: 10px; background: #f3fbf6; border: 1px solid #d3f0de; }
    .ai-head { font-weight: 700; color: #03a24a; }
    .ai-status { margin-top: 2px; color: #222; font-weight: 600; }
    .ai-status.ai-error { color: #d93025; }
    .ai-status.ai-partial { color: #b06000; }
    .ai-go { all: unset; box-sizing: border-box; display: block; width: 100%; margin: 8px 0 4px; padding: 8px 0; text-align: center;
      background: #03c75a; color: #fff; border-radius: 8px; font-weight: 700; cursor: pointer; }
    .ai-go:hover { background: #02b351; }
    .ai-dbg { all: unset; display: inline-block; margin: 6px 0 2px; padding: 3px 10px; border: 1px solid #ccd; border-radius: 6px;
      font-size: 11px; color: #555; cursor: pointer; background: #fff; }
    .ai-note { margin-top: 4px; color: #667; font-size: 11px; line-height: 1.4; }
    .ai-off { all: unset; box-sizing: border-box; cursor: pointer; display: inline-block; margin-top: 6px; padding: 2px 8px; border-radius: 999px; background: #fff4e0; color: #b06000;
      border: 1px solid #f5d9a8; font-size: 11px; font-weight: 700; }
    .ai-off:hover { background: #ffecc7; }
    .ai-tip[hidden] { display: none; }
    .ai-tip { margin: 6px 0 8px; padding: 7px 10px; border-radius: 8px; background: #f6f8fa; color: #555; font-size: 11px; line-height: 1.45; }
    .ai-tip b { color: #03a24a; }
    .rot { display: inline-block; margin-left: 6px; padding: 0 6px; border-radius: 4px; background: #e6f8ee; color: #03a24a;
      font-weight: 700; cursor: pointer; }
    .rot:empty { display: none; }
    .rot.low { background: #fff4e0; color: #b06000; }
    .rot.skip { background: #f1f3f5; color: #aaa; text-decoration: line-through; }
  `;

  let panelHost = null;

  let aiTipOpen = false; // "회전 AI 꺼짐" 안내 펼침 상태
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
    title.textContent = APP_SHORT;
    const close = document.createElement("button");
    close.className = "close";
    close.title = "닫기";
    close.textContent = "×";
    origAdd.call(close, "click", () => panelHost.remove());
    top.append(title, close);
    const meta = document.createElement("div");
    meta.className = "meta";
    meta.textContent = summary(r);
    header.append(top);
    if (!r.ai && settings().aiMode === "off" && r.arr.some(canDecode)) {
      // 회전 AI를 쓰지 않는 상태: 제목 바로 아래에 상태 배지 + 안내
      // 배지를 누르면 안내가 펼쳐지고 접힘 (기본: 접힘, 이번 페이지에서는 상태 유지)
      const badge = document.createElement("button");
      badge.type = "button";
      badge.className = "ai-off";
      const tip = document.createElement("div");
      tip.className = "ai-tip";
      const b = document.createElement("b");
      b.textContent = "회전 AI";
      tip.append(b, " 모델을 내려받으면 누워 있는 사진을 찾아 회전을 추천해 드려요. 확장 아이콘 → 설정 창의 '사진 방향 추천 (AI)'에서 켤 수 있어요. 사진은 내 컴퓨터 안에서만 분석되고, 외부로 전송되거나 AI 학습에 쓰이지 않아요.");
      const paint = () => {
        badge.textContent = "회전 AI 꺼짐 " + (aiTipOpen ? "▴" : "▾");
        badge.title = aiTipOpen ? "안내 접기" : "안내 펼치기";
        badge.setAttribute("aria-expanded", String(aiTipOpen));
        tip.hidden = !aiTipOpen;
      };
      origAdd.call(badge, "click", () => { aiTipOpen = !aiTipOpen; paint(); });
      paint();
      header.append(badge, tip);
    }
    header.append(meta);
    const miss = missingCount(r);
    const sub = document.createElement("div");
    sub.className = "sub";
    sub.textContent =
      (r.source === "folder" ? "폴더 안 파일 기준 · " : "") +
      (miss ? `촬영일 없는 ${miss}개는 수정일 기준 · ` : "") +
      fmtDate(r.at);
    header.append(sub);
    const aiBox = buildAiBox(r);
    if (aiBox) header.append(aiBox);

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
      attachAiBadge(r, f, val);
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
    paintBadges(r);
  }

  // ======================================================================
  // 사진 방향 추천 (AI)
  // - 확장은 사진을 "읽기만" 합니다. 384×384로 줄인 픽셀을 확장 내부 AI에 넘겨 방향만 판단해요.
  // - 회전은 네이버 에디터의 "사진 편집 → 자르기, 회전" 버튼을 대신 눌러 주는 방식이라
  //   내 컴퓨터의 원본 파일은 바뀌지 않습니다. 마지막 [완료]는 사용자가 확인 후 직접 누릅니다.
  // ======================================================================
  const AI_SIZE = 384;
  const AI_LOW = 0.85; // 이보다 낮으면 "확인 필요"
  // 모델 출력 k = "사진이 반시계 방향으로 k×90° 돌아가 있음" → 바로 세우는 버튼
  const AI_FIX = {
    1: { dir: "right", times: 1, label: "↻ 오른쪽 90°" },
    2: { dir: "left", times: 2, label: "↺ 180°" },
    3: { dir: "left", times: 1, label: "↺ 왼쪽 90°" },
  };
  const AI_NOTE_ROTATE = "회전은 네이버 에디터의 「사진 편집 → 자르기, 회전」 기능으로 해요. 내 컴퓨터의 원본 파일은 건드리지 않아요.";
  const AI_NOTE_CHECK = "AI 판단이라 틀릴 수 있어요. 추천 표시를 눌러 뺄 수 있고, 편집기에서 확인한 뒤 [완료]를 눌러 주세요.";
  const AI_NOTE_LOCAL = "사진은 내 컴퓨터 안에서만 분석되고 어디로도 전송되지 않아요.";

  let aiSeq = 0;
  const aiPending = new Map();
  const aiCache = new Map(); // fileKey -> { cls, conf } (같은 사진을 다시 분석하지 않음)
  const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

  origAdd.call(window, "message", (e) => {
    if (e.source !== window || !e.data || e.data.__nbo !== "ai-result") return;
    const p = aiPending.get(e.data.id);
    if (!p) return;
    aiPending.delete(e.data.id);
    if (e.data.ok && Array.isArray(e.data.probs)) p.resolve(e.data.probs);
    else p.reject(new Error(e.data.error || "분석 실패"));
  });

  const isImageFile = (f) =>
    /^image\//i.test(f.type) || /\.(jpe?g|png|gif|webp|bmp|avif|heic|heif|hif)$/i.test(f.name);

  // 원본 파일은 그대로 두고, 분석용으로 작게 줄인 픽셀만 만듦
  async function aiPixels(f) {
    const bmp = await createImageBitmap(f, { resizeWidth: AI_SIZE, resizeHeight: AI_SIZE, resizeQuality: "high" });
    try {
      const c = document.createElement("canvas");
      c.width = c.height = AI_SIZE;
      const ctx = c.getContext("2d", { willReadFrequently: true });
      ctx.drawImage(bmp, 0, 0);
      const rgba = ctx.getImageData(0, 0, AI_SIZE, AI_SIZE).data;
      const rgb = new Uint8Array(AI_SIZE * AI_SIZE * 3);
      for (let i = 0, j = 0; i < rgba.length; i += 4, j += 3) {
        rgb[j] = rgba[i];
        rgb[j + 1] = rgba[i + 1];
        rgb[j + 2] = rgba[i + 2];
      }
      return rgb.buffer;
    } finally {
      bmp.close();
    }
  }

  function aiAsk(buf) {
    return new Promise((resolve, reject) => {
      const id = ++aiSeq;
      aiPending.set(id, { resolve, reject });
      window.postMessage({ __nbo: "ai-analyze", id, rgb: buf }, location.origin, [buf]);
      setTimeout(() => {
        if (aiPending.delete(id)) reject(new Error("시간 초과"));
      }, 120000);
    });
  }

  const aiInfo = (r, f) => (r.ai ? r.ai.byKey.get(fileKey(f)) : null);
  const aiRecommended = (r) => r.arr.filter((f) => { const a = aiInfo(r, f); return a && AI_FIX[a.cls]; });
  const aiTargets = (r) => aiRecommended(r).filter((f) => !r.ai.skip.has(fileKey(f)) && !r.ai.rotated.has(fileKey(f)));

  function maybeStartAi(r) {
    const s = settings();
    if (r.ai || !s.aiMode || s.aiMode === "off") return;
    if (!s.aiReady) {
      // 모드는 켰는데 모델이 아직 없거나 내려받는 중/실패
      r.ai = { state: "error", done: 0, total: 0, byKey: new Map(), skip: new Set(), rotated: new Set(), run: null,
        error: "AI 모델이 아직 준비되지 않았어요. 확장 아이콘 → 설정 창에서 설치 상태를 확인해 주세요." };
      if (panelHost && panelHost.isConnected && lastResult === r) showPanel(r);
      return;
    }
    const files = r.arr.filter(canDecode); // HEIC 등 브라우저가 열 수 없는 형식은 건너뜀
    if (!files.length) return;
    r.ai = { state: "running", done: 0, total: files.length, byKey: new Map(), skip: new Set(), rotated: new Set(), error: null, run: null };
    if (panelHost && panelHost.isConnected && lastResult === r) showPanel(r); // 열려 있는 목록에 AI 영역 표시
    (async () => {
      // 에디터가 파일 목록을 연달아 여러 번 읽는 경우가 있어, 목록이 정해질 때까지 잠깐 기다림
      await sleep(700);
      if (lastResult !== r) return;
      for (const f of files) {
        if (aiCache.has(fileKey(f))) {
          r.ai.byKey.set(fileKey(f), aiCache.get(fileKey(f)));
          r.ai.done++;
          continue;
        }
        try {
          const probs = await aiAsk(await aiPixels(f));
          const cls = probs.indexOf(Math.max(...probs));
          const info = { cls, conf: probs[cls] };
          r.ai.byKey.set(fileKey(f), info);
          aiCache.set(fileKey(f), info);
          if (aiCache.size > 500) aiCache.delete(aiCache.keys().next().value);
        } catch (e) {
          if (/model-missing/.test(String(e && e.message))) {
            r.ai.state = "error";
            r.ai.error = "AI 모델이 없어요. 확장 설정 창에서 다시 내려받아 주세요.";
            renderAi(r);
            return;
          }
          r.ai.byKey.set(fileKey(f), { cls: -1, conf: 0 });
        }
        r.ai.done++;
        renderAi(r);
      }
      r.ai.state = "done";
      renderAi(r);
      // 돌릴 사진이 있으면 목록 패널을 열어 알려 줌
      if (aiRecommended(r).length && lastResult === r && (!panelHost || !panelHost.isConnected)) showPanel(r);
    })();
  }

  // ----- 패널 UI -----
  function buildAiBox(r) {
    if (!r.ai) return null;
    const box = document.createElement("div");
    box.className = "ai";
    r._ui = { box, badges: new Map() };
    paintAiBox(r);
    return box;
  }

  function paintAiBox(r) {
    const ui = r._ui;
    if (!ui) return;
    const box = ui.box;
    const ai = r.ai;
    box.textContent = "";
    const head = document.createElement("div");
    head.className = "ai-head";
    head.textContent = "사진 방향 추천 (AI)";
    const status = document.createElement("div");
    status.className = "ai-status";
    const recs = aiRecommended(r);
    const low = recs.filter((f) => aiInfo(r, f).conf < AI_LOW).length;
    if (ai.run) {
      status.textContent = ai.run.msg;
      status.classList.add("ai-" + ai.run.state);
    } else if (ai.state === "error") {
      status.textContent = ai.error;
      status.classList.add("ai-error");
    } else if (ai.state === "running") {
      status.textContent = `분석 중 ${ai.done}/${ai.total}`;
    } else if (recs.length) {
      status.textContent = `회전 추천 ${recs.length}장` + (low ? ` · 확인 필요 ${low}장` : "");
    } else {
      status.textContent = `${ai.total}장 모두 방향이 맞아 보여요`;
    }
    box.append(head, status);

    const targets = ai.state === "done" ? aiTargets(r) : [];
    if (targets.length && (!ai.run || ai.run.state === "error" || ai.run.state === "partial")) {
      const btn = document.createElement("button");
      btn.className = "ai-go";
      btn.textContent = ai.rotated.size ? `남은 ${targets.length}장 돌리기` : `네이버 편집기로 ${targets.length}장 돌리기`;
      origAdd.call(btn, "click", () => runRotate(r));
      box.append(btn);
    }
    if (ai.run && (ai.run.state === "error" || ai.run.state === "partial")) {
      const dbg = document.createElement("button");
      dbg.className = "ai-dbg";
      dbg.textContent = "진단 정보 복사";
      origAdd.call(dbg, "click", () => {
        const info = JSON.stringify({ v: "1.3.0", msg: ai.run.msg, debug: ai.debug || null, ua: navigator.userAgent }, null, 1);
        navigator.clipboard.writeText(info).then(
          () => (dbg.textContent = "복사됨 · 개발자에게 붙여넣어 주세요"),
          () => (dbg.textContent = "복사 실패")
        );
      });
      box.append(dbg);
    }
    for (const t of [AI_NOTE_ROTATE, AI_NOTE_CHECK, AI_NOTE_LOCAL]) {
      const n = document.createElement("div");
      n.className = "ai-note";
      n.textContent = t;
      box.append(n);
    }
  }

  function attachAiBadge(r, f, holder) {
    if (!r._ui) return;
    const b = document.createElement("span");
    b.className = "rot";
    origAdd.call(b, "click", () => {
      if (!r.ai || r.ai.run) return;
      const k = fileKey(f);
      r.ai.skip.has(k) ? r.ai.skip.delete(k) : r.ai.skip.add(k);
      renderAi(r);
    });
    holder.append(b);
    r._ui.badges.set(fileKey(f), { el: b, f });
  }

  function paintBadges(r) {
    if (!r._ui) return;
    for (const { el, f } of r._ui.badges.values()) {
      const a = aiInfo(r, f);
      const fix = a && AI_FIX[a.cls];
      el.className = "rot";
      if (!fix) { el.textContent = ""; el.title = ""; continue; }
      const skipped = r.ai.skip.has(fileKey(f));
      el.textContent = `${fix.label} ${Math.round(a.conf * 100)}%` + (a.conf < AI_LOW ? " · 확인 필요" : "");
      el.title = skipped ? "눌러서 다시 넣기" : "눌러서 이 사진은 빼기";
      if (a.conf < AI_LOW) el.classList.add("low");
      if (skipped) el.classList.add("skip");
    }
  }

  function renderAi(r) {
    if (!r._ui || !r._ui.box.isConnected) return;
    paintAiBox(r);
    paintBadges(r);
  }

  // ----- 네이버 에디터 조작 (사진 편집기의 회전 버튼을 대신 누름) -----
  const visible = (el) => { if (!el) return false; const b = el.getBoundingClientRect(); return b.width > 0 && b.height > 0; };
  async function waitFor(fn, ms = 8000, step = 150) {
    const t0 = Date.now();
    for (;;) {
      let v = null;
      try { v = fn(); } catch (_) {}
      if (v) return v;
      if (Date.now() - t0 > ms) return null;
      await sleep(step);
    }
  }
  function editorDocs() {
    const docs = [document];
    for (const f of document.querySelectorAll("iframe")) {
      try { if (f.contentDocument) docs.push(f.contentDocument); } catch (_) {}
    }
    return docs;
  }
  function findVisible(sel) {
    for (const d of editorDocs()) {
      const el = Array.from(d.querySelectorAll(sel)).find(visible);
      if (el) return el;
    }
    return null;
  }
  function compIdOf(c) {
    const e = c.querySelector("[data-compid]");
    return (e && e.getAttribute("data-compid")) || c.id || null;
  }
  // 에디터 본문의 사진 컴포넌트 (문서 순서)
  function imageComponents() {
    for (const d of editorDocs()) {
      const comps = [];
      for (const img of d.querySelectorAll("img.se-image-resource")) {
        const c = img.closest(".se-component");
        if (c && !comps.includes(c)) comps.push(c);
      }
      if (comps.length) return comps;
    }
    return [];
  }
  // 컴포넌트를 가리킬 수 있는 ID 후보 (네이버 화면 구조가 바뀌어도 하나는 맞도록)
  function compKeysOf(c) {
    const keys = [c.id, c.getAttribute("data-compid")];
    for (const e of c.querySelectorAll("[data-compid]")) keys.push(e.getAttribute("data-compid"));
    return keys.filter(Boolean);
  }
  function snapshotCompIds() {
    try { return new Set(imageComponents().map(compIdOf)); } catch (_) { return new Set(); }
  }
  function pressLikeUser(el) {
    const b = el.getBoundingClientRect();
    const opt = { bubbles: true, cancelable: true, view: el.ownerDocument.defaultView, clientX: b.left + b.width / 2, clientY: b.top + b.height / 2, button: 0 };
    const W = el.ownerDocument.defaultView;
    el.dispatchEvent(new W.PointerEvent("pointerdown", opt));
    el.dispatchEvent(new W.MouseEvent("mousedown", opt));
    el.dispatchEvent(new W.PointerEvent("pointerup", opt));
    el.dispatchEvent(new W.MouseEvent("mouseup", opt));
    el.dispatchEvent(new W.MouseEvent("click", opt));
  }
  function editorBanner(doc, text) {
    const el = doc.createElement("div");
    el.textContent = text;
    el.style.cssText =
      "position:fixed;z-index:2147483647;left:50%;top:76px;transform:translateX(-50%);background:#03c75a;color:#fff;" +
      "padding:10px 18px;border-radius:8px;font:600 13px/1.4 -apple-system,'Apple SD Gothic Neo',sans-serif;" +
      "box-shadow:0 4px 16px rgba(0,0,0,.3);pointer-events:none;max-width:calc(100vw - 32px)";
    (doc.body || doc.documentElement).appendChild(el);
    setTimeout(() => el.remove(), 9000);
  }

  async function runRotate(r) {
    const ai = r.ai;
    if (!ai || (ai.run && ai.run.state !== "error" && ai.run.state !== "partial")) return;
    const targets = aiTargets(r);
    if (!targets.length) return;
    const say = (msg, state = "running") => { ai.run = { state, msg }; renderAi(r); };
    try {
      say("에디터에 사진이 다 올라오길 기다리는 중…");
      const imgFiles = r.arr.filter(isImageFile);
      const pre = r.preCompIds || new Set();
      let fresh = [];
      const ready = await waitFor(() => {
        fresh = imageComponents().filter((c) => !pre.has(compIdOf(c)));
        return fresh.length >= imgFiles.length;
      }, 60000, 500);
      if (!ready) throw new Error(`에디터에서 이번에 올린 사진 ${imgFiles.length}장을 찾지 못했어요. 업로드가 끝난 뒤 다시 눌러 주세요.`);
      if (fresh.some((c) => c.querySelectorAll("img.se-image-resource").length > 1)) {
        throw new Error("사진을 '콜라주'나 '슬라이드'로 올리면 자동으로 돌릴 수 없어요. '개별사진'으로 올려 주세요.");
      }
      if (fresh.length !== imgFiles.length) throw new Error("에디터의 사진 수가 올린 사진 수와 달라서 멈췄어요.");
      // 사진마다 ID 후보와 본문 안 순서를 기억 (편집기를 열 때 화면이 다시 그려져도 찾을 수 있게)
      const allAtWait = imageComponents();
      const compOf = new Map(imgFiles.map((f, i) => [fileKey(f), { keys: compKeysOf(fresh[i]), idx: allAtWait.indexOf(fresh[i]) }]));

      if (findVisible(".npe_btn_submit")) {
        throw new Error("사진 편집기가 열려 있어요. 편집기에서 [완료]나 [취소]를 누른 뒤 다시 눌러 주세요.");
      }
      // 돌릴 사진 하나를 선택하고 "사진 편집"을 엶 (네이버가 그 주변 사진들을 편집기에 함께 넣어 줌)
      say("네이버 사진 편집기를 여는 중…");
      const firstComp = fresh[imgFiles.indexOf(targets[0])];
      const img = firstComp.querySelector("img.se-image-resource");
      img.scrollIntoView({ block: "center" });
      await sleep(300);
      pressLikeUser(img);
      const editBtn = await waitFor(() => findVisible("button.se-image-edit-toolbar-button"), 5000);
      if (!editBtn) throw new Error("사진 편집 버튼을 찾지 못했어요. 네이버 화면이 바뀌었을 수 있어요.");
      editBtn.click();
      const submit = await waitFor(() => findVisible(".npe_btn_submit"), 15000);
      if (!submit) throw new Error("네이버 사진 편집기가 열리지 않았어요.");
      const doc = submit.ownerDocument;
      // 썸네일 줄은 늦게 그려지거나 접혀 있을 수 있음 → 기다렸다가, 없으면 "이미지 n / m" 버튼으로 펼침
      say("편집기에 사진 목록이 뜨길 기다리는 중…");
      const countThumbs = () => doc.querySelectorAll(".npe_image_list_thumb_wrap").length;
      let listToggled = false;
      if (!(await waitFor(countThumbs, 4000))) {
        const listBtn = doc.querySelector(".npe_btn_image_list");
        if (listBtn) { listBtn.click(); listToggled = true; }
        await waitFor(countThumbs, 8000);
      }
      // 개수가 더 늘지 않을 때까지 잠깐 기다림
      for (let prev = -1, n = countThumbs(), t = 0; n !== prev && t < 10; t++) { prev = n; await sleep(400); n = countThumbs(); }
      // 편집기 썸네일 찾기: ① 컴포넌트 ID가 같은 썸네일 ② 없으면 본문 사진 순서와 썸네일 순서로 짝짓기
      const thumbs = Array.from(doc.querySelectorAll(".npe_image_list_thumb_wrap"));
      const thumbByKey = new Map(thumbs.map((t) => [t.getAttribute("data-key"), t]));
      const allComps = imageComponents();
      ai.debug = {
        comps: allComps.length,
        thumbs: thumbs.length,
        compKeys: allComps.slice(0, 3).map(compKeysOf),
        thumbKeys: thumbs.slice(0, 3).map((t) => t.getAttribute("data-key")),
        counter: (doc.querySelector(".npe_btn_image_list") || {}).textContent,
        listToggled,
      };
      const thumbFor = (ref) => {
        if (!ref) return null;
        for (const k of ref.keys) if (thumbByKey.has(k)) return thumbByKey.get(k);
        if (ref.idx >= 0 && thumbs.length === allComps.length) return thumbs[ref.idx];
        return null;
      };

      let done = 0;
      const failed = []; // 이번 편집기에 없는 사진
      const stuck = []; // 편집기에는 있는데 회전 버튼을 누르지 못한 사진
      for (let i = 0; i < targets.length; i++) {
        const f = targets[i];
        const fix = AI_FIX[aiInfo(r, f).cls];
        say(`돌리는 중 ${i + 1}/${targets.length} · ${f.name}`);
        const thumb = thumbFor(compOf.get(fileKey(f)));
        if (!thumb) { failed.push(f.name); continue; }
        thumb.scrollIntoView({ block: "nearest", inline: "center" });
        thumb.click();
        await waitFor(() => thumb.classList.contains("on"), 4000);
        await sleep(400);
        // 자르기·회전 패널 열기: [적용] 뒤에는 패널이 닫혀도 버튼 표시(on)가 남아 있을 수 있어
        // 버튼 표시 대신 회전 버튼이 실제로 보이는지로 판단하고, 안 보이면 자르기 버튼을 눌러 엶
        const sel = fix.dir === "left" ? "button.npe_btn_left_rotate" : "button.npe_btn_right_rotate";
        const rotBtn = () => Array.from(doc.querySelectorAll(sel)).find(visible) || null;
        let btn = rotBtn();
        for (let t = 0; !btn && t < 2; t++) {
          const crop = doc.querySelector("button.npe_btn_crop");
          if (!crop) break;
          crop.click();
          btn = await waitFor(rotBtn, 2500);
        }
        if (!btn) { stuck.push(f.name); continue; }
        // 패널이 막 열렸거나 사진을 불러오는 중이면 네이버가 클릭을 무시하므로 잠깐 기다림
        await sleep(900);
        // 실제로 돌았는지 확인: 회전하면 [재설정] 버튼이 활성화됨 (disable 표시가 사라짐)
        const resetBtn = () => doc.querySelector("button.npe_btn_reset");
        const changed = () => { const b = resetBtn(); return b && !b.classList.contains("disable") && !b.disabled; };
        let turned = 0;
        for (let t = 0; t < fix.times; t++) {
          const before = resetBtn() ? changed() : null;
          let ok = false;
          for (let attempt = 0; attempt < 3 && !ok; attempt++) {
            const b = rotBtn();
            if (!b) break;
            b.click();
            if (before === false) ok = !!(await waitFor(changed, 1500));
            else { await sleep(800); ok = true; } // 확인 수단이 없거나 이미 바뀐 상태(두 번째 회전)면 클릭만
            if (!ok) await sleep(700);
          }
          if (!ok) break;
          turned++;
          await sleep(400);
        }
        if (turned < fix.times) { stuck.push(f.name); continue; }
        const confirm = await waitFor(() => Array.from(doc.querySelectorAll("button.npe_btn_confirm")).find(visible) || null, 2000);
        if (!confirm) { stuck.push(f.name); continue; }
        confirm.click();
        // 패널이 닫힐 때까지 잠깐 기다림
        await waitFor(() => !rotBtn(), 2000);
        await sleep(400);
        done++;
        ai.rotated.add(fileKey(f));
      }
      ai.debug.stuck = stuck;
      ai.debug.resetBtn = !!doc.querySelector("button.npe_btn_reset");
      ai.debug.notInEditor = failed;
      if (!done) {
        throw new Error(
          stuck.length
            ? `회전 버튼을 눌렀지만 사진이 돌아간 것을 확인하지 못했어요. [취소]를 누르고 [진단 정보 복사]를 보내 주세요.`
            : `편집기에서 돌릴 사진을 찾지 못했어요 (편집기 사진 ${thumbs.length}장). [취소]를 누르고 [진단 정보 복사]를 보내 주세요.`
        );
      }
      if (stuck.length) {
        say(
          `${done}장을 돌렸어요. ${stuck.length}장(${stuck.join(", ")})은 돌아간 것을 확인하지 못했어요. ` +
            `편집기에서 직접 돌리거나, [취소] 후 [진단 정보 복사]를 보내 주세요.`,
          "partial"
        );
        editorBanner(doc, `${done}장을 돌렸어요 · ${stuck.length}장은 직접 확인해 주세요 · 원본 파일은 그대로예요`);
      } else if (failed.length) {
        say(
          `${done}장을 돌렸어요. 남은 ${failed.length}장은 이번 편집기에 들어 있지 않아요. ` +
            `오른쪽 위 [완료]를 눌러 저장한 뒤 [남은 ${failed.length}장 돌리기]를 눌러 주세요.`,
          "partial"
        );
        editorBanner(doc, `${done}장을 돌렸어요 · [완료]를 누른 뒤 남은 ${failed.length}장도 돌려 주세요 · 원본 파일은 그대로예요`);
      } else {
        say(`${done}장을 네이버 편집기로 돌렸어요. 확인한 뒤 오른쪽 위 [완료]를 눌러 주세요.`, "done");
        editorBanner(doc, `AI 추천대로 ${done}장을 돌렸어요 · 확인 후 [완료]를 눌러 주세요 · 원본 파일은 그대로예요`);
      }
    } catch (e) {
      say(String((e && e.message) || e), "error");
    }
  }

  // 설정 창의 "최근 정렬 결과 보기" 버튼
  origAdd.call(window, "message", (e) => {
    if (e.source !== window || !e.data || e.data.__nbo !== "show-panel") return;
    if (lastResult) showPanel(lastResult);
  });
})();
