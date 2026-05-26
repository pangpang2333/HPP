(function () {
  "use strict";

  const DB_NAME = "feedback-dashboard-offline";
  const DB_VERSION = 3;
  const CONFIG_KEY = "main";
  const BACKUP_FORMAT = "feedback-dashboard-backup";
  const BACKUP_VERSION = 1;

  let dbPromise = null;
  let state = { categories: [], settings: {}, feedback: [], positiveFeedback: [], otherNeeds: [] };
  let pollTimer = null;
  let adminTab = "feed";
  const noteSaveTimers = {};
  const positiveNoteSaveTimers = {};
  const otherNeedSaveTimers = {};
  let settingsSaveTimer;
  let settingsToastTimer;

  const RESOLVE_STATUS = {
    unresolved: "unresolved",
    progress: "progress",
    resolved: "resolved",
  };

  const RESOLVE_OPTIONS = [
    { value: RESOLVE_STATUS.unresolved, label: "待处理" },
    { value: RESOLVE_STATUS.progress, label: "处理中" },
    { value: RESOLVE_STATUS.resolved, label: "已处理" },
  ];

  function normalizeResolveStatus(v) {
    if (v === RESOLVE_STATUS.progress || v === RESOLVE_STATUS.resolved) return v;
    return RESOLVE_STATUS.unresolved;
  }

  function resolveStatusLabel(v) {
    const st = normalizeResolveStatus(v);
    const hit = RESOLVE_OPTIONS.find((o) => o.value === st);
    return hit ? hit.label : "待处理";
  }

  function syncFbResolveSelectClass(sel) {
    if (!sel || !sel.classList.contains("fb-resolve")) return;
    const st = normalizeResolveStatus(sel.value);
    sel.className = "fb-resolve fb-resolve-sel-" + st;
  }

  function effectiveBoardColumns(raw) {
    const n = Math.min(8, Math.max(2, Number(raw) || 4));
    const w = typeof window !== "undefined" ? window.innerWidth : 1400;
    if (w <= 900) {
      if (n >= 4 && n <= 5) return 2;
    }
    if (w <= 1200) {
      if (n >= 6 && n <= 8) return 4;
    }
    return n;
  }

  let boardMasonryTimer = null;
  let boardMasonryResizeBound = false;
  let boardToolbarTimer = null;

  function scheduleBoardMasonry() {
    const board = document.getElementById("view-board");
    const grid = document.getElementById("grid");
    if (!board || !board.classList.contains("active") || !grid || !grid.classList.contains("board-grid-masonry")) return;
    clearTimeout(boardMasonryTimer);
    boardMasonryTimer = setTimeout(() => layoutBoardMasonry(), 80);
    requestAnimationFrame(() => layoutBoardMasonry());
  }

  function layoutBoardMasonry() {
    const board = document.getElementById("view-board");
    const grid = document.getElementById("grid");
    if (!board || !board.classList.contains("active") || !grid || !grid.classList.contains("board-grid-masonry")) {
      if (grid && !grid.classList.contains("board-grid-masonry")) grid.style.minHeight = "";
      return;
    }

    const cards = grid.querySelectorAll(":scope > .card");
    if (!cards.length) {
      grid.style.minHeight = "";
      return;
    }

    const n = effectiveBoardColumns(state.settings?.boardColumns ?? 4);
    const w = Math.max(0, grid.clientWidth);
    if (w < 1) return;

    const colW = w / n;
    const colHeights = new Array(n).fill(0);

    for (let i = 0; i < cards.length; i++) {
      const card = cards[i];
      let bi = 0;
      for (let j = 1; j < n; j++) {
        if (colHeights[j] < colHeights[bi]) bi = j;
      }
      card.style.position = "absolute";
      card.style.left = bi * colW + "px";
      card.style.top = colHeights[bi] + "px";
      card.style.width = colW + "px";
      card.style.boxSizing = "border-box";
      const h = card.offsetHeight;
      colHeights[bi] += h;
    }

    grid.style.minHeight = Math.max.apply(null, colHeights) + "px";
  }

  function ensureBoardMasonryResizeHook() {
    if (boardMasonryResizeBound) return;
    boardMasonryResizeBound = true;
    window.addEventListener("resize", scheduleBoardMasonry);
    const grid = document.getElementById("grid");
    if (grid && typeof ResizeObserver !== "undefined") {
      const ro = new ResizeObserver(() => scheduleBoardMasonry());
      ro.observe(grid);
    }
  }

  function defaultConfigBody() {
    return {
      categories: [
        { id: "cat-suggest", name: "功能建议", color: "#2563eb", createdAt: "2000-01-01T00:00:00.000Z" },
        { id: "cat-ux", name: "界面与体验", color: "#7c3aed", createdAt: "2000-01-02T00:00:00.000Z" },
        { id: "cat-bug", name: "Bug", color: "#dc2626", createdAt: "2000-01-03T00:00:00.000Z" },
        { id: "cat-other", name: "未分类", color: "#64748b", createdAt: "2000-01-05T00:00:00.000Z" },
      ],
      settings: {
        boardColumns: 4,
        cardSize: "medium",
        theme: "dark",
        showNotes: true,
        boardShowThumbnails: true,
        boardHideResolved: false,
        boardGroupByCategory: false,
      },
    };
  }

  function uid() {
    return Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
  }

  function openDb() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains("config")) {
          db.createObjectStore("config", { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains("items")) {
          db.createObjectStore("items", { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains("positiveItems")) {
          db.createObjectStore("positiveItems", { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains("otherNeeds")) {
          db.createObjectStore("otherNeeds", { keyPath: "id" });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbPromise;
  }

  function idbTx(db, stores, mode, fn) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(stores, mode);
      let out;
      try {
        out = fn(tx);
      } catch (err) {
        reject(err);
        return;
      }
      tx.oncomplete = () => resolve(out);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error("abort"));
    });
  }

  async function getConfigDoc(db) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(["config"], "readonly");
      const r = tx.objectStore("config").get(CONFIG_KEY);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  }

  async function putConfigDoc(db, doc) {
    return idbTx(db, ["config"], "readwrite", (tx) => tx.objectStore("config").put(doc));
  }

  async function getAllItems(db) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(["items"], "readonly");
      const r = tx.objectStore("items").getAll();
      r.onsuccess = () => resolve(r.result || []);
      r.onerror = () => reject(r.error);
    });
  }

  async function putItem(db, item) {
    return idbTx(db, ["items"], "readwrite", (tx) => tx.objectStore("items").put(item));
  }

  async function deleteItem(db, id) {
    return idbTx(db, ["items"], "readwrite", (tx) => tx.objectStore("items").delete(id));
  }

  async function getAllPositive(db) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(["positiveItems"], "readonly");
      const r = tx.objectStore("positiveItems").getAll();
      r.onsuccess = () => resolve(r.result || []);
      r.onerror = () => reject(r.error);
    });
  }

  async function putPositiveItem(db, item) {
    return idbTx(db, ["positiveItems"], "readwrite", (tx) => tx.objectStore("positiveItems").put(item));
  }

  async function deletePositiveItem(db, id) {
    return idbTx(db, ["positiveItems"], "readwrite", (tx) => tx.objectStore("positiveItems").delete(id));
  }

  async function getAllOtherNeeds(db) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(["otherNeeds"], "readonly");
      const r = tx.objectStore("otherNeeds").getAll();
      r.onsuccess = () => resolve(r.result || []);
      r.onerror = () => reject(r.error);
    });
  }

  async function putOtherNeed(db, row) {
    return idbTx(db, ["otherNeeds"], "readwrite", (tx) => tx.objectStore("otherNeeds").put(row));
  }

  async function deleteOtherNeed(db, id) {
    return idbTx(db, ["otherNeeds"], "readwrite", (tx) => tx.objectStore("otherNeeds").delete(id));
  }

  async function clearObjectStore(db, storeName) {
    if (!db.objectStoreNames.contains(storeName)) return;
    return idbTx(db, [storeName], "readwrite", (tx) => tx.objectStore(storeName).clear());
  }

  function downloadJsonFile(obj, filename) {
    const blob = new Blob([JSON.stringify(obj, null, 2)], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  function backupFilename() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    const stamp =
      d.getFullYear() +
      pad(d.getMonth() + 1) +
      pad(d.getDate()) +
      "-" +
      pad(d.getHours()) +
      pad(d.getMinutes());
    return "聚典核校反馈备份-" + stamp + ".json";
  }

  async function buildBackupPayload() {
    const db = await openDb();
    const doc = await ensureConfig(db);
    const payload = {
      format: BACKUP_FORMAT,
      version: BACKUP_VERSION,
      exportedAt: new Date().toISOString(),
      origin: location.href,
      config: {
        id: CONFIG_KEY,
        categories: doc.categories,
        settings: doc.settings,
      },
      feedback: await getAllItems(db),
      positiveFeedback: db.objectStoreNames.contains("positiveItems") ? await getAllPositive(db) : [],
      otherNeeds: db.objectStoreNames.contains("otherNeeds") ? await getAllOtherNeeds(db) : [],
    };
    return payload;
  }

  function parseBackupJson(text) {
    let raw;
    try {
      raw = JSON.parse(text);
    } catch {
      throw new Error("不是有效的 JSON 文件");
    }
    if (!raw || raw.format !== BACKUP_FORMAT) {
      throw new Error("不是本系统的备份文件（缺少 format 标识）");
    }
    if (raw.version !== BACKUP_VERSION) {
      throw new Error("备份版本不兼容：" + raw.version);
    }
    if (!raw.config || !Array.isArray(raw.feedback)) {
      throw new Error("备份内容不完整");
    }
    return raw;
  }

  async function importBackupPayload(payload, mode) {
    const replace = mode === "replace";
    if (replace) {
      const ok = confirm(
        "覆盖导入将清空当前浏览器中的全部反馈、正向反馈、其他需求与分类设置，然后写入备份。确定继续？"
      );
      if (!ok) return { cancelled: true };
    }
    const db = await openDb();
    const stores = ["config", "items"];
    if (db.objectStoreNames.contains("positiveItems")) stores.push("positiveItems");
    if (db.objectStoreNames.contains("otherNeeds")) stores.push("otherNeeds");

    if (replace) {
      await clearObjectStore(db, "items");
      if (db.objectStoreNames.contains("positiveItems")) await clearObjectStore(db, "positiveItems");
      if (db.objectStoreNames.contains("otherNeeds")) await clearObjectStore(db, "otherNeeds");
    }

    const cfg = payload.config;
    await putConfigDoc(db, {
      id: CONFIG_KEY,
      categories: Array.isArray(cfg.categories) ? cfg.categories : defaultConfigBody().categories,
      settings: cfg.settings && typeof cfg.settings === "object" ? cfg.settings : defaultConfigBody().settings,
    });

    const feedback = Array.isArray(payload.feedback) ? payload.feedback : [];
    const positive = Array.isArray(payload.positiveFeedback) ? payload.positiveFeedback : [];
    const other = Array.isArray(payload.otherNeeds) ? payload.otherNeeds : [];

    for (const item of feedback) {
      if (item && item.id) await putItem(db, item);
    }
    if (db.objectStoreNames.contains("positiveItems")) {
      for (const p of positive) {
        if (p && p.id) await putPositiveItem(db, p);
      }
    }
    if (db.objectStoreNames.contains("otherNeeds")) {
      for (const o of other) {
        if (o && o.id) await putOtherNeed(db, o);
      }
    }

    await loadState();
    return {
      cancelled: false,
      counts: { feedback: feedback.length, positive: positive.length, otherNeeds: other.length },
    };
  }

  async function exportAllData() {
    const payload = await buildBackupPayload();
    downloadJsonFile(payload, backupFilename());
    toast(
      "已导出：反馈 " +
        payload.feedback.length +
        " 条，正向 " +
        payload.positiveFeedback.length +
        " 条，其他需求 " +
        payload.otherNeeds.length +
        " 条"
    );
  }

  function bindDataBackupControls() {
    const btnExport = document.getElementById("btnExportData");
    const inputImport = document.getElementById("inputImportData");
    if (btnExport) {
      btnExport.addEventListener("click", () => {
        exportAllData().catch((e) => toast(String(e.message || e)));
      });
    }
    if (inputImport) {
      inputImport.addEventListener("change", async () => {
        const file = inputImport.files && inputImport.files[0];
        inputImport.value = "";
        if (!file) return;
        try {
          const text = await file.text();
          const payload = parseBackupJson(text);
          const modeEl = document.querySelector('input[name="importMode"]:checked');
          const mode = modeEl ? modeEl.value : "merge";
          const result = await importBackupPayload(payload, mode);
          if (result.cancelled) return;
          renderAdminFromState();
          if (document.getElementById("view-board").classList.contains("active")) {
            applyTheme();
            renderBoard();
          }
          toast(
            "导入完成：反馈 " +
              result.counts.feedback +
              " 条，正向 " +
              result.counts.positive +
              " 条，其他需求 " +
              result.counts.otherNeeds +
              " 条"
          );
        } catch (e) {
          toast(String(e.message || e));
        }
      });
    }
  }

  async function ensureConfig(db) {
    let doc = await getConfigDoc(db);
    if (!doc) {
      const d = defaultConfigBody();
      doc = { id: CONFIG_KEY, categories: d.categories, settings: d.settings };
      await putConfigDoc(db, doc);
    } else {
      if (!doc.categories || !doc.categories.length) {
        doc.categories = defaultConfigBody().categories;
        await putConfigDoc(db, doc);
      }
      if (!doc.settings) {
        doc.settings = defaultConfigBody().settings;
        await putConfigDoc(db, doc);
      }
      let migrated = false;
      doc.categories = doc.categories.map((c, i) => {
        if (c.createdAt) {
          if (!("sort" in c)) return c;
          migrated = true;
          const { sort: _omit, ...rest } = c;
          return rest;
        }
        migrated = true;
        const legacy = c.sort != null ? Number(c.sort) : i;
        return {
          id: c.id,
          name: c.name,
          color: c.color,
          createdAt: new Date(2000, 0, 1 + legacy).toISOString(),
        };
      });
      if (migrated) await putConfigDoc(db, doc);
    }
    if (doc && doc.settings) {
      let patch = false;
      if (doc.settings.boardShowThumbnails === undefined) {
        doc.settings.boardShowThumbnails = true;
        patch = true;
      }
      if (doc.settings.boardHideResolved === undefined) {
        doc.settings.boardHideResolved = false;
        patch = true;
      }
      if (doc.settings.boardGroupByCategory === undefined) {
        doc.settings.boardGroupByCategory = false;
        patch = true;
      }
      if (patch) await putConfigDoc(db, doc);
    }
    return doc;
  }

  async function loadState() {
    const db = await openDb();
    const doc = await ensureConfig(db);
    let items = await getAllItems(db);
    items = items.slice().sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    let positive = [];
    if (db.objectStoreNames.contains("positiveItems")) {
      positive = await getAllPositive(db);
      positive = positive.slice().sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    }
    let otherNeeds = [];
    if (db.objectStoreNames.contains("otherNeeds")) {
      otherNeeds = await getAllOtherNeeds(db);
      otherNeeds = otherNeeds.slice().sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    }
    state = {
      categories: doc.categories,
      settings: doc.settings,
      feedback: items,
      positiveFeedback: positive,
      otherNeeds: otherNeeds,
    };
    return state;
  }

  async function saveConfigPartial(partial) {
    const db = await openDb();
    const doc = await ensureConfig(db);
    if (partial.categories) doc.categories = partial.categories;
    if (partial.settings) doc.settings = { ...doc.settings, ...partial.settings };
    await putConfigDoc(db, doc);
    await loadState();
  }

  function toast(msg) {
    const el = document.getElementById("toast");
    if (!el) return;
    el.textContent = msg;
    el.classList.add("show");
    clearTimeout(el._t);
    el._t = setTimeout(() => el.classList.remove("show"), 2600);
  }

  function hexColor(c) {
    if (!c || !c.startsWith("#")) return "#64748b";
    return c.slice(0, 7);
  }

  function clamp01(n, lo, hi) {
    return Math.max(lo, Math.min(hi, n));
  }

  function hexToRgb(hex) {
    const h = hexColor(hex).slice(1);
    return {
      r: parseInt(h.slice(0, 2), 16),
      g: parseInt(h.slice(2, 4), 16),
      b: parseInt(h.slice(4, 6), 16),
    };
  }

  function rgbToHue(r, g, b) {
    const rn = r / 255;
    const gn = g / 255;
    const bn = b / 255;
    const max = Math.max(rn, gn, bn);
    const min = Math.min(rn, gn, bn);
    if (max === min) return 0;
    const d = max - min;
    let h = 0;
    if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) / 6;
    else if (max === gn) h = ((bn - rn) / d + 2) / 6;
    else h = ((rn - gn) / d + 4) / 6;
    return h * 360;
  }

  function hslToHex(hDeg, s, l) {
    let h = ((hDeg % 360) + 360) % 360;
    s = clamp01(s, 0, 1);
    l = clamp01(l, 0, 1);
    const c = (1 - Math.abs(2 * l - 1)) * s;
    const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    const m = l - c / 2;
    let rp = 0,
      gp = 0,
      bp = 0;
    if (h < 60) [rp, gp, bp] = [c, x, 0];
    else if (h < 120) [rp, gp, bp] = [x, c, 0];
    else if (h < 180) [rp, gp, bp] = [0, c, x];
    else if (h < 240) [rp, gp, bp] = [0, x, c];
    else if (h < 300) [rp, gp, bp] = [x, 0, c];
    else [rp, gp, bp] = [c, 0, x];
    const to = (v) =>
      Math.round(clamp01(v + m, 0, 1) * 255)
        .toString(16)
        .padStart(2, "0");
    return ("#" + to(rp) + to(gp) + to(bp)).toLowerCase();
  }

  function hueCircularDist(a, b) {
    let d = Math.abs(a - b);
    if (d > 180) d = 360 - d;
    return d;
  }

  function pickDistinctCategoryColor(existingCategories) {
    const list = existingCategories || [];
    const hues = [];
    for (const c of list) {
      const { r, g, b } = hexToRgb(c.color || "#888888");
      hues.push(rgbToHue(r, g, b));
    }
    let bestHue = (list.length * 47.3) % 360;
    let bestScore = -1;
    for (let step = 0; step < 72; step++) {
      const h = (step * 137.508 + list.length * 29.17) % 360;
      let minD = 360;
      for (const eh of hues) minD = Math.min(minD, hueCircularDist(h, eh));
      if (minD > bestScore) {
        bestScore = minD;
        bestHue = h;
      }
    }
    return hslToHex(bestHue, 0.62, 0.48);
  }

  function categoriesDisplayOrder(cats) {
    return [...(cats || [])].sort((a, b) => {
      const ta = new Date(a.createdAt || 0).getTime();
      const tb = new Date(b.createdAt || 0).getTime();
      if (tb !== ta) return tb - ta;
      return String(a.id || "").localeCompare(String(b.id || ""));
    });
  }

  function orderFeedbackForBoard(items, groupByCategory) {
    const arr = [...(items || [])];
    if (!groupByCategory) {
      return arr.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    }
    const order = categoriesDisplayOrder(state.categories);
    const rank = new Map();
    order.forEach((c, i) => rank.set(c.id, i));
    const unk = order.length;
    arr.sort((a, b) => {
      const ra = rank.has(a.categoryId) ? rank.get(a.categoryId) : unk;
      const rb = rank.has(b.categoryId) ? rank.get(b.categoryId) : unk;
      if (ra !== rb) return ra - rb;
      return new Date(b.createdAt) - new Date(a.createdAt);
    });
    return arr;
  }

  function refreshNewCategoryColorInput() {
    const el = document.getElementById("newCatColor");
    if (!el) return;
    el.value = pickDistinctCategoryColor(state.categories);
  }

  function catById(id) {
    return state.categories.find((c) => c.id === id);
  }

  function formatTime(iso, short) {
    try {
      const d = new Date(iso);
      if (short) {
        return d.toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
      }
      return d.toLocaleString("zh-CN", { hour12: false });
    } catch {
      return iso;
    }
  }

  function isTextEditingTarget(el) {
    if (!el || !el.tagName) return false;
    const tag = el.tagName.toLowerCase();
    if (tag === "textarea") return true;
    if (tag === "input") {
      const ty = (el.type || "").toLowerCase();
      return ["text", "search", "url", "email", "password", ""].includes(ty);
    }
    if (el.isContentEditable) return true;
    return false;
  }

  function isEditingFeedback() {
    const a = document.activeElement;
    return !!(a && (a.classList.contains("fb-note") || a.classList.contains("fb-cat") || a.classList.contains("fb-resolve")));
  }

  function isEditingPositiveNote() {
    const a = document.activeElement;
    return !!(a && a.classList.contains("pf-note"));
  }

  function isEditingOtherNeed() {
    const a = document.activeElement;
    return !!(
      a &&
      (a.classList.contains("on-need-type") ||
        a.classList.contains("on-need-content") ||
        a.classList.contains("on-need-solution"))
    );
  }

  function isEditingSettings() {
    const a = document.activeElement;
    if (!a || !a.id) return false;
    return ["setCols", "setCardSize", "setTheme", "setShowNotes"].indexOf(a.id) !== -1;
  }

  function isEditingCategoryField() {
    const a = document.activeElement;
    if (!a) return false;
    if (a.classList.contains("cat-name")) return true;
    if (a.id === "newCatName") return true;
    return false;
  }

  function adminViewActive() {
    const admin = document.getElementById("view-admin");
    return !!(admin && admin.classList.contains("active"));
  }

  function clipboardFirstImageFile(e) {
    const cd = e.clipboardData;
    if (!cd) return null;
    if (cd.items && cd.items.length) {
      for (let i = 0; i < cd.items.length; i++) {
        const it = cd.items[i];
        if (it.kind === "file" && it.type && it.type.indexOf("image/") === 0) {
          const f = it.getAsFile();
          if (f) return f;
        }
      }
    }
    if (cd.files && cd.files.length) {
      const f = cd.files[0];
      if (f && f.type && f.type.indexOf("image/") === 0) return f;
    }
    return null;
  }

  function fileToDataUrl(file) {
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(fr.result);
      fr.onerror = () => reject(fr.error);
      fr.readAsDataURL(file);
    });
  }

  function flashPasteZoneOk(zoneId) {
    const z = document.getElementById(zoneId || "pasteZone");
    if (!z) return;
    z.classList.remove("flash-ok");
    void z.offsetWidth;
    z.classList.add("flash-ok");
    setTimeout(() => z.classList.remove("flash-ok"), 500);
  }

  function defaultCategoryId() {
    const u = state.categories.find((c) => c.name === "未分类");
    if (u) return u.id;
    const o = state.categories.find((c) => c.id === "cat-other");
    if (o) return o.id;
    return state.categories[0] ? state.categories[0].id : "";
  }

  let saveBusy = false;

  async function saveFeedbackFromDataUrl(dataUrl, opts) {
    opts = opts || {};
    if (typeof dataUrl !== "string" || !dataUrl.startsWith("data:")) {
      toast("无效图片数据");
      return;
    }
    if (saveBusy) return;
    saveBusy = true;
    try {
      const db = await openDb();
      await ensureConfig(db);
      const newId = uid();
      const item = {
        id: newId,
        imageDataUrl: dataUrl,
        categoryId: defaultCategoryId(),
        resolveStatus: RESOLVE_STATUS.unresolved,
        note: "",
        createdAt: new Date().toISOString(),
      };
      await putItem(db, item);
      flashPasteZoneOk("pasteZone");
      if (opts.fromDrop) toast("已从拖放保存截图");
      else if (opts.fromPaste) toast("已从剪贴板保存截图");
      else toast("已保存截图");
      await loadState();
      switchAdminTab("feed");
      if (!isEditingFeedback()) renderAdminFromState();
      else {
        if (document.getElementById("view-board").classList.contains("active")) {
          applyTheme();
          renderBoard();
        }
      }
    } catch (err) {
      toast(err.message || String(err));
    } finally {
      saveBusy = false;
      if (adminViewActive() && adminTab === "feed") {
        requestAnimationFrame(() => {
          const z = document.getElementById("pasteZone");
          if (z) z.focus({ preventScroll: true });
        });
      }
      if (adminViewActive() && adminTab === "positive") {
        requestAnimationFrame(() => {
          const z = document.getElementById("pasteZonePositive");
          if (z) z.focus({ preventScroll: true });
        });
      }
    }
  }

  async function savePositiveFromDataUrl(dataUrl, opts) {
    opts = opts || {};
    if (typeof dataUrl !== "string" || !dataUrl.startsWith("data:")) {
      toast("无效图片数据");
      return;
    }
    if (saveBusy) return;
    saveBusy = true;
    try {
      const db = await openDb();
      await ensureConfig(db);
      const newId = uid();
      const item = {
        id: newId,
        imageDataUrl: dataUrl,
        note: "",
        createdAt: new Date().toISOString(),
      };
      await putPositiveItem(db, item);
      flashPasteZoneOk("pasteZonePositive");
      if (opts.fromDrop) toast("正向反馈：已从拖放保存");
      else if (opts.fromPaste) toast("正向反馈：已从剪贴板保存");
      else toast("正向反馈已保存");
      await loadState();
      switchAdminTab("positive");
      if (!isEditingPositiveNote()) renderAdminFromState();
    } catch (err) {
      toast(err.message || String(err));
    } finally {
      saveBusy = false;
      if (adminViewActive() && adminTab === "positive") {
        requestAnimationFrame(() => {
          const z = document.getElementById("pasteZonePositive");
          if (z) z.focus({ preventScroll: true });
        });
      }
    }
  }

  async function persistFeedbackRow(fid) {
    const tr = document.querySelector('tr[data-fid="' + fid + '"]');
    if (!tr) return;
    const sel = tr.querySelector(".fb-cat");
    const rs = tr.querySelector(".fb-resolve");
    const ta = tr.querySelector(".fb-note");
    if (!sel || !ta) return;
    const categoryId = sel.value;
    const resolveStatus = rs ? normalizeResolveStatus(rs.value) : RESOLVE_STATUS.unresolved;
    const note = ta.value.slice(0, 500);
    const db = await openDb();
    const items = await getAllItems(db);
    const item = items.find((x) => x.id === fid);
    if (!item) return;
    item.categoryId = categoryId;
    item.resolveStatus = resolveStatus;
    item.note = note;
    delete item.ocrStatus;
    await putItem(db, item);
    await loadState();
    if (document.getElementById("view-board").classList.contains("active")) {
      applyTheme();
      renderBoard();
    }
  }

  function debouncedPersistNote(fid) {
    clearTimeout(noteSaveTimers[fid]);
    noteSaveTimers[fid] = setTimeout(() => {
      persistFeedbackRow(fid).catch((e) => toast(String(e.message || e)));
    }, 600);
  }

  function switchAdminTab(tab) {
    adminTab = tab;
    document.querySelectorAll(".admin-subtab").forEach((b) => {
      b.classList.toggle("active", b.getAttribute("data-admin-tab") === tab);
    });
    document.querySelectorAll(".admin-tab-panel").forEach((p) => {
      p.classList.toggle("active", p.id === "admin-panel-" + tab);
    });
    if (tab === "feed") {
      requestAnimationFrame(() => {
        const z = document.getElementById("pasteZone");
        if (z) z.focus({ preventScroll: true });
      });
    }
    if (tab === "positive") {
      requestAnimationFrame(() => {
        const z = document.getElementById("pasteZonePositive");
        if (z) z.focus({ preventScroll: true });
      });
    }
  }

  function setView(name) {
    const admin = document.getElementById("view-admin");
    const board = document.getElementById("view-board");
    const tabAdmin = document.getElementById("tabAdmin");
    const tabBoard = document.getElementById("tabBoard");
    const isAdmin = name === "admin";
    admin.classList.toggle("active", isAdmin);
    board.classList.toggle("active", !isAdmin);
    tabAdmin.classList.toggle("active-tab", isAdmin);
    tabBoard.classList.toggle("active-tab", !isAdmin);
    location.hash = isAdmin ? "#admin" : "#board";
    if (isAdmin) {
      requestAnimationFrame(() => {
        if (adminTab === "feed") {
          const z = document.getElementById("pasteZone");
          if (z) z.focus({ preventScroll: true });
        } else if (adminTab === "positive") {
          const z = document.getElementById("pasteZonePositive");
          if (z) z.focus({ preventScroll: true });
        }
      });
    }
    if (!isAdmin) {
      applyTheme();
      renderBoard();
    }
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(() => {
      (async () => {
        try {
          await loadState();
          if (document.getElementById("view-board").classList.contains("active")) {
            applyTheme();
            renderBoard();
          }
          if (document.getElementById("view-admin").classList.contains("active")) {
            if (
              !isEditingFeedback() &&
              !isEditingPositiveNote() &&
              !isEditingOtherNeed() &&
              !isEditingSettings() &&
              !isEditingCategoryField()
            ) {
              renderAdminFromState();
            }
          }
        } catch (e) {
          console.warn(e);
        }
      })();
    }, 5000);
  }

  function applyTheme() {
    const t = state.settings?.theme || "dark";
    document.documentElement.classList.toggle("theme-light", t === "light");
  }

  function renderAdminFromState() {
    renderCategoryTable();
    renderSettingsForm();
    renderFeedback();
    renderPositiveList();
    renderOtherNeedsList();
  }

  async function refreshAll() {
    await loadState();
    renderAdminFromState();
    if (document.getElementById("view-board").classList.contains("active")) {
      applyTheme();
      renderBoard();
    }
  }

  async function persistCategoryRow(cid) {
    const tr = document.querySelector('tr[data-cid="' + cid + '"]');
    if (!tr) return;
    const name = tr.querySelector(".cat-name").value;
    const color = tr.querySelector(".cat-color").value;
    const cats = state.categories.map((c) => (c.id === cid ? { ...c, name, color } : c));
    await saveConfigPartial({ categories: cats });
  }

  function renderCategoryTable() {
    const tbody = document.getElementById("catRows");
    if (!tbody) return;
    tbody.innerHTML = "";
    const sorted = categoriesDisplayOrder(state.categories);
    for (const c of sorted) {
      const tr = document.createElement("tr");
      tr.dataset.cid = c.id;

      const td1 = document.createElement("td");
      const inName = document.createElement("input");
      inName.type = "text";
      inName.className = "cat-name";
      inName.value = c.name;
      inName.addEventListener("blur", () => {
        persistCategoryRow(c.id).catch((e) => toast(String(e.message || e)));
      });
      td1.appendChild(inName);

      const td2 = document.createElement("td");
      const inColor = document.createElement("input");
      inColor.type = "color";
      inColor.className = "cat-color";
      inColor.value = hexColor(c.color);
      inColor.addEventListener("change", () => {
        persistCategoryRow(c.id).catch((e) => toast(String(e.message || e)));
      });
      td2.appendChild(inColor);

      const td3 = document.createElement("td");
      const btnDel = document.createElement("button");
      btnDel.type = "button";
      btnDel.className = "btn btn-danger btn-del-cat";
      btnDel.dataset.cid = c.id;
      btnDel.textContent = "删除";
      td3.appendChild(btnDel);

      tr.appendChild(td1);
      tr.appendChild(td2);
      tr.appendChild(td3);
      tbody.appendChild(tr);
    }

    refreshNewCategoryColorInput();

    tbody.querySelectorAll(".btn-del-cat").forEach((btn) => {
      btn.onclick = async () => {
        if (!confirm("确定删除该分类？相关反馈会移到其它分类。")) return;
        const cid = btn.getAttribute("data-cid");
        const db = await openDb();
        const doc = await ensureConfig(db);
        if (doc.categories.length <= 1) {
          toast("至少保留一个分类");
          return;
        }
        const fallback = doc.categories.find((c) => c.id !== cid).id;
        const items = await getAllItems(db);
        for (const it of items) {
          if (it.categoryId === cid) {
            it.categoryId = fallback;
            await putItem(db, it);
          }
        }
        doc.categories = doc.categories.filter((c) => c.id !== cid);
        await putConfigDoc(db, doc);
        await refreshAll();
        toast("已删除");
      };
    });
  }

  function renderSettingsForm() {
    const s = state.settings || {};
    const elCols = document.getElementById("setCols");
    if (!elCols) return;
    elCols.value = s.boardColumns ?? 4;
    document.getElementById("setCardSize").value = s.cardSize || "medium";
    document.getElementById("setTheme").value = s.theme || "dark";
    document.getElementById("setShowNotes").checked = s.showNotes !== false;
  }

  function bindSettingsAutoSave() {
    const cols = document.getElementById("setCols");
    const sz = document.getElementById("setCardSize");
    const th = document.getElementById("setTheme");
    const sn = document.getElementById("setShowNotes");
    if (!cols || !sz || !th || !sn) return;
    function scheduleSave() {
      clearTimeout(settingsSaveTimer);
      settingsSaveTimer = setTimeout(() => {
        (async () => {
          try {
            const rawCols = Number(cols.value);
            const settings = {
              boardColumns: Math.min(8, Math.max(2, rawCols || 4)),
              cardSize: sz.value,
              theme: th.value,
              showNotes: sn.checked,
            };
            if (!["small", "medium", "large"].includes(settings.cardSize)) settings.cardSize = "medium";
            if (!["dark", "light"].includes(settings.theme)) settings.theme = "dark";
            await saveConfigPartial({ settings });
            clearTimeout(settingsToastTimer);
            settingsToastTimer = setTimeout(() => toast("展示设置已保存"), 400);
            applyTheme();
            if (document.getElementById("view-board").classList.contains("active")) renderBoard();
          } catch (e) {
            toast(String(e.message || e));
          }
        })();
      }, 450);
    }
    cols.addEventListener("input", scheduleSave);
    sz.addEventListener("change", scheduleSave);
    th.addEventListener("change", scheduleSave);
    sn.addEventListener("change", scheduleSave);
  }

  function bindBoardToolbar() {
    const chkImg = document.getElementById("boardShowScreenshots");
    const chkRes = document.getElementById("boardHideResolved");
    const chkGrp = document.getElementById("boardGroupByCategory");
    if (!chkImg || chkImg._boardBound) return;
    chkImg._boardBound = true;
    function scheduleBoardToolbarSave() {
      clearTimeout(boardToolbarTimer);
      boardToolbarTimer = setTimeout(() => {
        (async () => {
          try {
            await saveConfigPartial({
              settings: {
                boardShowThumbnails: chkImg.checked,
                boardHideResolved: chkRes ? chkRes.checked : false,
                boardGroupByCategory: chkGrp ? chkGrp.checked : false,
              },
            });
            applyTheme();
            if (document.getElementById("view-board").classList.contains("active")) renderBoard();
          } catch (e) {
            toast(String(e.message || e));
          }
        })();
      }, 280);
    }
    chkImg.addEventListener("change", scheduleBoardToolbarSave);
    if (chkRes) chkRes.addEventListener("change", scheduleBoardToolbarSave);
    if (chkGrp) chkGrp.addEventListener("change", scheduleBoardToolbarSave);
  }

  function renderFeedback() {
    const tbody = document.getElementById("fbRows");
    if (!tbody) return;
    tbody.innerHTML = "";
    const catsSorted = categoriesDisplayOrder(state.categories);
    for (const f of state.feedback) {
      const tr = document.createElement("tr");
      tr.dataset.fid = f.id;

      const td0 = document.createElement("td");
      td0.className = "fb-td-preview";
      const img = document.createElement("img");
      img.className = "thumb thumb-feed";
      img.src = f.imageDataUrl || "";
      img.alt = "双击放大";
      img.title = "双击放大查看";
      img.loading = "lazy";
      td0.appendChild(img);

      const td1 = document.createElement("td");
      td1.className = "fb-td-cat";
      const sel = document.createElement("select");
      sel.className = "fb-cat";
      for (const c of catsSorted) {
        const opt = document.createElement("option");
        opt.value = c.id;
        opt.textContent = c.name;
        if (c.id === f.categoryId) opt.selected = true;
        sel.appendChild(opt);
      }
      sel.addEventListener("change", () => {
        persistFeedbackRow(f.id).catch((e) => toast(String(e.message || e)));
      });
      td1.appendChild(sel);

      const tdResolve = document.createElement("td");
      tdResolve.className = "fb-td-resolve";
      const cur = normalizeResolveStatus(f.resolveStatus);
      const selR = document.createElement("select");
      selR.className = "fb-resolve";
      for (const ro of RESOLVE_OPTIONS) {
        const opt = document.createElement("option");
        opt.value = ro.value;
        opt.textContent = ro.label;
        if (ro.value === cur) opt.selected = true;
        selR.appendChild(opt);
      }
      syncFbResolveSelectClass(selR);
      selR.addEventListener("change", () => {
        syncFbResolveSelectClass(selR);
        persistFeedbackRow(f.id).catch((e) => toast(String(e.message || e)));
      });
      tdResolve.appendChild(selR);

      const td2 = document.createElement("td");
      td2.className = "fb-td-time muted";
      td2.textContent = formatTime(f.createdAt);

      const td3 = document.createElement("td");
      td3.className = "fb-td-note";
      const ta = document.createElement("input");
      ta.type = "text";
      ta.className = "fb-note";
      ta.maxLength = 500;
      ta.placeholder = "备注";
      ta.value = String(f.note || "").slice(0, 500);
      ta.addEventListener("input", () => debouncedPersistNote(f.id));
      td3.appendChild(ta);

      const td4 = document.createElement("td");
      td4.className = "fb-td-act";
      const b2 = document.createElement("button");
      b2.type = "button";
      b2.className = "btn btn-danger btn-del-fb btn-icon-del";
      b2.dataset.fid = f.id;
      b2.setAttribute("aria-label", "删除");
      b2.title = "删除";
      b2.innerHTML =
        '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>';
      td4.appendChild(b2);

      tr.appendChild(td0);
      tr.appendChild(td1);
      tr.appendChild(tdResolve);
      tr.appendChild(td2);
      tr.appendChild(td3);
      tr.appendChild(td4);
      tbody.appendChild(tr);
    }

    tbody.querySelectorAll(".btn-del-fb").forEach((btn) => {
      btn.onclick = async () => {
        if (!confirm("确定删除这条反馈？")) return;
        const fid = btn.getAttribute("data-fid");
        const db = await openDb();
        await deleteItem(db, fid);
        await refreshAll();
        toast("已删除");
      };
    });
  }

  async function persistPositiveRow(pid) {
    const tr = document.querySelector('tr[data-pid="' + pid + '"]');
    if (!tr) return;
    const ta = tr.querySelector(".pf-note");
    if (!ta) return;
    const note = ta.value.slice(0, 500);
    const db = await openDb();
    const rows = await getAllPositive(db);
    const item = rows.find((x) => x.id === pid);
    if (!item) return;
    item.note = note;
    await putPositiveItem(db, item);
    await loadState();
  }

  function debouncedPersistPositiveNote(pid) {
    clearTimeout(positiveNoteSaveTimers[pid]);
    positiveNoteSaveTimers[pid] = setTimeout(() => {
      persistPositiveRow(pid).catch((e) => toast(String(e.message || e)));
    }, 600);
  }

  function renderPositiveList() {
    const tbody = document.getElementById("pfRows");
    if (!tbody) return;
    tbody.innerHTML = "";
    const rows = state.positiveFeedback || [];
    for (const p of rows) {
      const tr = document.createElement("tr");
      tr.dataset.pid = p.id;

      const td0 = document.createElement("td");
      td0.className = "pf-td-preview";
      const img = document.createElement("img");
      img.className = "thumb thumb-pf";
      img.src = p.imageDataUrl || "";
      img.alt = "双击放大";
      img.title = "双击放大查看";
      img.loading = "lazy";
      td0.appendChild(img);

      const td1 = document.createElement("td");
      td1.className = "pf-td-time muted";
      td1.textContent = formatTime(p.createdAt);

      const td2 = document.createElement("td");
      td2.className = "pf-td-note";
      const ta = document.createElement("input");
      ta.type = "text";
      ta.className = "pf-note";
      ta.maxLength = 500;
      ta.placeholder = "备注";
      ta.value = String(p.note || "").slice(0, 500);
      ta.addEventListener("input", () => debouncedPersistPositiveNote(p.id));
      td2.appendChild(ta);

      const td3 = document.createElement("td");
      td3.className = "pf-td-act";
      const b2 = document.createElement("button");
      b2.type = "button";
      b2.className = "btn btn-danger btn-del-pf btn-icon-del";
      b2.dataset.pid = p.id;
      b2.setAttribute("aria-label", "删除");
      b2.title = "删除";
      b2.innerHTML =
        '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>';
      td3.appendChild(b2);

      tr.appendChild(td0);
      tr.appendChild(td1);
      tr.appendChild(td2);
      tr.appendChild(td3);
      tbody.appendChild(tr);
    }

    tbody.querySelectorAll(".btn-del-pf").forEach((btn) => {
      btn.onclick = async () => {
        if (!confirm("确定删除这条正向反馈？")) return;
        const pid = btn.getAttribute("data-pid");
        const db = await openDb();
        await deletePositiveItem(db, pid);
        await refreshAll();
        toast("已删除");
      };
    });
  }

  async function persistOtherNeedRow(oid) {
    const tr = document.querySelector('tr[data-oid="' + oid + '"]');
    if (!tr) return;
    const inType = tr.querySelector(".on-need-type");
    const taContent = tr.querySelector(".on-need-content");
    const taSol = tr.querySelector(".on-need-solution");
    if (!inType || !taContent || !taSol) return;
    const needType = inType.value.slice(0, 200);
    const needContent = taContent.value.slice(0, 8000);
    const solution = taSol.value.slice(0, 8000);
    const db = await openDb();
    const rows = await getAllOtherNeeds(db);
    const item = rows.find((x) => x.id === oid);
    if (!item) return;
    item.needType = needType;
    item.needContent = needContent;
    item.solution = solution;
    await putOtherNeed(db, item);
    await loadState();
  }

  function debouncedPersistOtherNeed(oid) {
    clearTimeout(otherNeedSaveTimers[oid]);
    otherNeedSaveTimers[oid] = setTimeout(() => {
      persistOtherNeedRow(oid).catch((e) => toast(String(e.message || e)));
    }, 600);
  }

  function renderOtherNeedsList() {
    const tbody = document.getElementById("otherNeedRows");
    if (!tbody) return;
    tbody.innerHTML = "";
    const rows = state.otherNeeds || [];
    for (const r of rows) {
      const tr = document.createElement("tr");
      tr.dataset.oid = r.id;

      const td0 = document.createElement("td");
      td0.className = "on-td-type";
      const inType = document.createElement("input");
      inType.type = "text";
      inType.className = "on-need-type";
      inType.maxLength = 200;
      inType.placeholder = "如：流程 / 数据 / 权限…";
      inType.value = String(r.needType || "").slice(0, 200);
      inType.addEventListener("input", () => debouncedPersistOtherNeed(r.id));
      td0.appendChild(inType);

      const td1 = document.createElement("td");
      td1.className = "on-td-content";
      const taC = document.createElement("textarea");
      taC.className = "on-need-content";
      taC.rows = 3;
      taC.placeholder = "需求内容";
      taC.value = String(r.needContent || "").slice(0, 8000);
      taC.addEventListener("input", () => debouncedPersistOtherNeed(r.id));
      td1.appendChild(taC);

      const td2 = document.createElement("td");
      td2.className = "on-td-solution";
      const taS = document.createElement("textarea");
      taS.className = "on-need-solution";
      taS.rows = 3;
      taS.placeholder = "解决方案或跟进记录";
      taS.value = String(r.solution || "").slice(0, 8000);
      taS.addEventListener("input", () => debouncedPersistOtherNeed(r.id));
      td2.appendChild(taS);

      const td3 = document.createElement("td");
      td3.className = "on-td-act";
      const bDel = document.createElement("button");
      bDel.type = "button";
      bDel.className = "btn btn-danger btn-del-other btn-icon-del";
      bDel.dataset.oid = r.id;
      bDel.setAttribute("aria-label", "删除");
      bDel.title = "删除";
      bDel.innerHTML =
        '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>';
      td3.appendChild(bDel);

      tr.appendChild(td0);
      tr.appendChild(td1);
      tr.appendChild(td2);
      tr.appendChild(td3);
      tbody.appendChild(tr);
    }

    tbody.querySelectorAll(".btn-del-other").forEach((btn) => {
      btn.onclick = async () => {
        if (!confirm("确定删除这条其他需求？")) return;
        const oid = btn.getAttribute("data-oid");
        const db = await openDb();
        await deleteOtherNeed(db, oid);
        await refreshAll();
        toast("已删除");
      };
    });
  }

  function colsClass(n) {
    const c = Math.min(8, Math.max(2, Number(n) || 4));
    return "cols-" + c;
  }

  function renderBoard() {
    const grid = document.getElementById("grid");
    const empty = document.getElementById("empty");
    if (!grid) return;
    const s = state.settings || {};
    const n = s.boardColumns ?? 4;
    const size = s.cardSize || "medium";
    const showNotes = s.showNotes !== false;
    const showThumbs = s.boardShowThumbnails !== false;
    const hideResolved = s.boardHideResolved === true;
    const groupByCat = s.boardGroupByCategory === true;

    const chkImg = document.getElementById("boardShowScreenshots");
    const chkRes = document.getElementById("boardHideResolved");
    const chkGrp = document.getElementById("boardGroupByCategory");
    if (chkImg) chkImg.checked = showThumbs;
    if (chkRes) chkRes.checked = hideResolved;
    if (chkGrp) chkGrp.checked = groupByCat;

    let list = state.feedback || [];
    if (hideResolved) {
      list = list.filter((f) => normalizeResolveStatus(f.resolveStatus) !== RESOLVE_STATUS.resolved);
    }
    list = orderFeedbackForBoard(list, groupByCat);

    const stat = document.getElementById("statTotal");
    if (stat) {
      let t = "共 " + list.length + " 条";
      if (groupByCat) t += " · 已按分类归并";
      if (hideResolved) t += " · 已隐藏已处理";
      if (!showThumbs) t += " · 文字列表";
      stat.textContent = t;
    }

    grid.innerHTML = "";
    if (!showThumbs) {
      grid.className = "board-grid board-grid-textlist";
    } else {
      grid.className = "board-grid board-grid-masonry " + colsClass(n);
    }

    if (!list.length) {
      grid.style.minHeight = "";
      if (empty) {
        empty.style.display = "block";
        empty.textContent = hideResolved
          ? "当前条件下暂无条目（可能均已处理）。可取消「隐藏已处理」或到「管理」添加反馈。"
          : "暂无反馈，请切换到「管理」→「添加与列表」粘贴截图。";
      }
      return;
    }
    if (empty) {
      empty.style.display = "none";
      empty.textContent = "暂无反馈，请切换到「管理」→「添加与列表」粘贴截图。";
    }

    if (!showThumbs) {
      for (const f of list) {
        const cat = catById(f.categoryId);
        const row = document.createElement("article");
        row.className = "board-text-row";

        const top = document.createElement("div");
        top.className = "board-text-row-top";

        const tag = document.createElement("span");
        tag.className = "tag";
        tag.textContent = cat ? cat.name : "未分类";
        if (cat && cat.color) tag.style.background = cat.color;

        const st = normalizeResolveStatus(f.resolveStatus);
        const stTxt = document.createElement("span");
        stTxt.className = "board-resolve-txt board-resolve-" + st;
        stTxt.textContent = resolveStatusLabel(st);

        const time = document.createElement("span");
        time.className = "muted board-text-time";
        time.textContent = formatTime(f.createdAt, true);

        top.appendChild(tag);
        top.appendChild(stTxt);
        top.appendChild(time);
        row.appendChild(top);

        if (showNotes) {
          const note = document.createElement("div");
          note.className = "board-text-note" + (f.note ? "" : " muted");
          note.textContent = f.note || "（无备注）";
          row.appendChild(note);
        }

        grid.appendChild(row);
      }
      return;
    }

    for (const f of list) {
      const cat = catById(f.categoryId);
      const card = document.createElement("article");
      card.className = "card " + size;

      const im = document.createElement("img");
      im.src = f.imageDataUrl || "";
      im.alt = "反馈截图";
      im.loading = "lazy";
      im.addEventListener("load", scheduleBoardMasonry);
      card.appendChild(im);

      const meta = document.createElement("div");
      meta.className = "meta";

      const metaHead = document.createElement("div");
      metaHead.className = "meta-head";

      const tag = document.createElement("span");
      tag.className = "tag";
      tag.textContent = cat ? cat.name : "未分类";
      if (cat && cat.color) tag.style.background = cat.color;

      const st = normalizeResolveStatus(f.resolveStatus);
      const stTxt = document.createElement("span");
      stTxt.className = "board-resolve-txt board-resolve-" + st;
      stTxt.textContent = resolveStatusLabel(st);

      const time = document.createElement("span");
      time.className = "muted meta-time";
      time.textContent = formatTime(f.createdAt, true);

      metaHead.appendChild(tag);
      metaHead.appendChild(stTxt);
      metaHead.appendChild(time);
      meta.appendChild(metaHead);

      if (showNotes) {
        const note = document.createElement("div");
        note.className = "note" + (f.note ? "" : " muted");
        note.textContent = f.note || "（无备注）";
        meta.appendChild(note);
      }

      card.appendChild(meta);
      grid.appendChild(card);
    }

    ensureBoardMasonryResizeHook();
    grid.querySelectorAll(".card img").forEach((img) => {
      if (img.complete) scheduleBoardMasonry();
    });
    scheduleBoardMasonry();
  }

  function bindImageLightbox() {
    const root = document.getElementById("imgLightbox");
    const img = document.getElementById("imgLightboxImg");
    const backdrop = document.getElementById("imgLightboxBackdrop");
    const btn = document.getElementById("imgLightboxClose");
    if (!root || !img) return;
    function closeLb() {
      root.classList.remove("open");
      root.setAttribute("aria-hidden", "true");
      img.removeAttribute("src");
      document.body.style.overflow = "";
    }
    function openLb(src) {
      if (!src) return;
      img.src = src;
      root.classList.add("open");
      root.setAttribute("aria-hidden", "false");
      document.body.style.overflow = "hidden";
    }
    if (btn) btn.addEventListener("click", (e) => { e.stopPropagation(); closeLb(); });
    if (backdrop) backdrop.addEventListener("click", closeLb);
    const feed = document.getElementById("admin-panel-feed");
    if (feed) {
      feed.addEventListener("dblclick", (e) => {
        const t = e.target;
        if (t && t.tagName === "IMG" && t.classList.contains("thumb-feed")) {
          openLb(t.getAttribute("src") || t.src);
        }
      });
    }
    const posPanel = document.getElementById("admin-panel-positive");
    if (posPanel) {
      posPanel.addEventListener("dblclick", (e) => {
        const t = e.target;
        if (t && t.tagName === "IMG" && t.classList.contains("thumb-pf")) {
          openLb(t.getAttribute("src") || t.src);
        }
      });
    }
  }

  document.querySelectorAll(".admin-subtab").forEach((btn) => {
    btn.addEventListener("click", () => switchAdminTab(btn.getAttribute("data-admin-tab")));
  });

  document.getElementById("tabAdmin").addEventListener("click", () => setView("admin"));
  document.getElementById("tabBoard").addEventListener("click", () => setView("board"));

  document.getElementById("btnReload").addEventListener("click", () => {
    refreshAll().catch((e) => toast(String(e.message || e)));
  });

  window.addEventListener(
    "paste",
    (e) => {
      if (!adminViewActive()) return;
      if (isTextEditingTarget(e.target)) return;
      if (adminTab !== "feed" && adminTab !== "positive") return;
      const file = clipboardFirstImageFile(e);
      if (!file) return;
      e.preventDefault();
      e.stopPropagation();
      fileToDataUrl(file)
        .then((url) => {
          if (adminTab === "positive") return savePositiveFromDataUrl(url, { fromPaste: true });
          return saveFeedbackFromDataUrl(url, { fromPaste: true });
        })
        .catch((err) => toast(String(err.message || err)));
    },
    true
  );

  function bindPasteZoneDnD(zoneId, saveFn) {
    const z = document.getElementById(zoneId);
    if (!z) return;
    z.addEventListener("click", () => z.focus({ preventScroll: true }));
    z.addEventListener("dragenter", (e) => {
      e.preventDefault();
      z.classList.add("dragover");
    });
    z.addEventListener("dragover", (e) => {
      e.preventDefault();
      z.classList.add("dragover");
    });
    z.addEventListener("dragleave", (e) => {
      if (!z.contains(e.relatedTarget)) z.classList.remove("dragover");
    });
    z.addEventListener("drop", async (e) => {
      e.preventDefault();
      z.classList.remove("dragover");
      const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (!f || !f.type.startsWith("image/")) {
        toast("请拖入图片文件");
        return;
      }
      try {
        const dataUrl = await fileToDataUrl(f);
        await saveFn(dataUrl, { fromDrop: true });
      } catch (err) {
        toast(err.message || String(err));
      }
    });
  }

  bindPasteZoneDnD("pasteZone", saveFeedbackFromDataUrl);
  bindPasteZoneDnD("pasteZonePositive", savePositiveFromDataUrl);

  const btnAddOtherNeed = document.getElementById("btnAddOtherNeed");
  if (btnAddOtherNeed) {
    btnAddOtherNeed.addEventListener("click", async () => {
      try {
        const pendingOids = Object.keys(otherNeedSaveTimers);
        for (const oid of pendingOids) {
          clearTimeout(otherNeedSaveTimers[oid]);
          delete otherNeedSaveTimers[oid];
        }
        for (const oid of pendingOids) {
          await persistOtherNeedRow(oid).catch(() => {});
        }
        const db = await openDb();
        const row = {
          id: uid(),
          needType: "",
          needContent: "",
          solution: "",
          createdAt: new Date().toISOString(),
        };
        await putOtherNeed(db, row);
        await loadState();
        switchAdminTab("other");
        if (!isEditingOtherNeed()) renderAdminFromState();
        requestAnimationFrame(() => {
          const inp = document.querySelector('tr[data-oid="' + row.id + '"] .on-need-type');
          if (inp) inp.focus({ preventScroll: true });
        });
        toast("已添加，可直接编辑各列");
      } catch (e) {
        toast(String(e.message || e));
      }
    });
  }

  document.getElementById("formCat").addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = document.getElementById("newCatName").value.trim() || "新分类";
    const colorEl = document.getElementById("newCatColor");
    const color = (colorEl && colorEl.value) || pickDistinctCategoryColor(state.categories);
    const cats = state.categories.concat([
      { id: uid(), name, color, createdAt: new Date().toISOString() },
    ]);
    await saveConfigPartial({ categories: cats });
    document.getElementById("newCatName").value = "";
    toast("分类已添加");
    renderAdminFromState();
    if (document.getElementById("view-board").classList.contains("active")) renderBoard();
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      const lb = document.getElementById("imgLightbox");
      if (lb && lb.classList.contains("open")) {
        lb.classList.remove("open");
        lb.setAttribute("aria-hidden", "true");
        const im = document.getElementById("imgLightboxImg");
        if (im) im.removeAttribute("src");
        document.body.style.overflow = "";
        return;
      }
    }
    if (e.key === "f" || e.key === "F") {
      if (document.getElementById("view-board").classList.contains("active")) {
        const el = document.documentElement;
        if (!document.fullscreenElement) el.requestFullscreen?.();
        else document.exitFullscreen?.();
      }
    }
  });

  function applyHash() {
    const h = (location.hash || "#admin").toLowerCase();
    if (h === "#board") setView("board");
    else setView("admin");
  }

  window.addEventListener("hashchange", applyHash);

  openDb()
    .then(() => loadState())
    .then(() => {
      renderAdminFromState();
      bindSettingsAutoSave();
      bindDataBackupControls();
      bindBoardToolbar();
      bindImageLightbox();
      applyHash();
    })
    .catch((e) => toast("无法打开本地数据库：" + (e.message || String(e))));
})();
