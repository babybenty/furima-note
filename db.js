"use strict";
// データの保存。IndexedDB に「状態（商品・経費・設定）」と「写真」を分けて保存する。
// 旧バージョン（localStorage）のデータは初回起動時に自動で引き継ぐ。IndexedDB が使えない環境では localStorage に保存する。
window.FurimaDB = (() => {
  const DB_NAME = "furima-note", VERSION = 1, LEGACY_KEY = "furima-note:v1";
  let dbp = null;

  function open() {
    if (dbp) return dbp;
    dbp = new Promise((resolve, reject) => {
      if (!("indexedDB" in window)) return reject(new Error("no indexedDB"));
      const req = indexedDB.open(DB_NAME, VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains("kv")) db.createObjectStore("kv");
        if (!db.objectStoreNames.contains("photos")) db.createObjectStore("photos");
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbp;
  }
  const tx = async (store, mode, fn) => {
    const db = await open();
    return new Promise((resolve, reject) => {
      const t = db.transaction(store, mode), s = t.objectStore(store);
      let out;
      Promise.resolve(fn(s)).then((r) => (out = r));
      t.oncomplete = () => resolve(out);
      t.onerror = t.onabort = () => reject(t.error);
    });
  };
  const reqP = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

  let useLocal = false;

  async function loadState() {
    try {
      const s = await tx("kv", "readonly", (st) => reqP(st.get("state")));
      if (s) return s;
      // 旧バージョンからの引き継ぎ
      const legacy = readLegacy();
      if (legacy) { await saveState(legacy); return legacy; }
      return null;
    } catch (_) {
      useLocal = true;
      return readLegacy();
    }
  }
  function readLegacy() {
    try { return JSON.parse(localStorage.getItem(LEGACY_KEY)); } catch (_) { return null; }
  }

  // 保存は連続で呼ばれても最後の1回だけ書く
  let pending = null, timer = null;
  function saveState(state) {
    pending = state;
    clearTimeout(timer);
    return new Promise((resolve) => { timer = setTimeout(async () => { await flush(); resolve(); }, 150); });
  }
  async function flush() {
    if (!pending) return;
    const data = JSON.parse(JSON.stringify(pending));
    pending = null;
    if (useLocal) { try { localStorage.setItem(LEGACY_KEY, JSON.stringify(data)); } catch (_) { alert("保存できませんでした。端末の空き容量を確認してください。"); } return; }
    try { await tx("kv", "readwrite", (st) => st.put(data, "state")); }
    catch (_) { alert("保存できませんでした。端末の空き容量を確認してください。"); }
  }
  window.addEventListener("pagehide", flush);
  document.addEventListener("visibilitychange", () => document.visibilityState === "hidden" && flush());

  // ---- 写真（縮小した JPEG の dataURL を保存） ----
  const photoCache = new Map();
  async function getPhoto(id) {
    if (photoCache.has(id)) return photoCache.get(id);
    if (useLocal) return null;
    const v = await tx("photos", "readonly", (st) => reqP(st.get(id))).catch(() => null);
    photoCache.set(id, v || null);
    return v || null;
  }
  async function setPhoto(id, dataUrl) {
    photoCache.set(id, dataUrl || null);
    if (useLocal) return;
    await tx("photos", "readwrite", (st) => (dataUrl ? st.put(dataUrl, id) : st.delete(id)));
  }
  async function allPhotos() {
    if (useLocal) return {};
    const out = {};
    await tx("photos", "readonly", (st) => new Promise((res) => {
      const r = st.openCursor();
      r.onsuccess = () => { const c = r.result; if (c) { out[c.key] = c.value; c.continue(); } else res(); };
    }));
    return out;
  }
  async function clearPhotos() {
    photoCache.clear();
    if (!useLocal) await tx("photos", "readwrite", (st) => st.clear());
  }

  // 画像ファイルを長辺 max px の JPEG に縮小
  function compressImage(file, max = 640, quality = 0.8) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file), img = new Image();
      img.onload = () => {
        const s = Math.min(1, max / Math.max(img.width, img.height));
        const c = Object.assign(document.createElement("canvas"), { width: Math.round(img.width * s), height: Math.round(img.height * s) });
        c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        resolve(c.toDataURL("image/jpeg", quality));
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("画像を読み込めませんでした")); };
      img.src = url;
    });
  }

  return { loadState, saveState, flush, getPhoto, setPhoto, allPhotos, clearPhotos, compressImage, get usingLocalStorage() { return useLocal; } };
})();
