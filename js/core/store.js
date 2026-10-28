/* =============================================================================
   遗迹2 · 遗物档案 — store.js
   全局状态：拥有 / 收藏 / 配装 / 界面偏好。持久化只在这里读写 localStorage。
   事件：'owned' 'fav' 'build' 'saved' 'ui'
        'storage-error' —— 写入失败可见事件（P0-4）
          payload: { key, op:'set'|'remove'|'stringify', error, at, suppressed }
          · 首个订阅者注册时会补投初始化阶段（含旧档迁移写回）暂存的失败（最多 5 条）；
          · 同一 key 5s 内只上报一次，被抑制次数放在下一条的 suppressed 里。
   读取全程做白名单归一：脏 JSON / 错误类型只会被丢弃或回退默认，不抛错、不清空合法数据。
   ========================================================================== */

const KEY = {
  owned: 'r2.v2.owned',
  fav: 'r2.v2.fav',
  build: 'r2.v2.build',
  saved: 'r2.v2.saved',
  ui: 'r2.v2.ui',
};
const LEGACY = {
  build: 'r2archive.build.v1',
  saved: 'r2archive.saved.v1',
  ui: 'r2archive.ui.v1',
};

/** 配装槽位顺序（全站唯一） */
export const BUILD_SLOTS = [
  { group: '武器', ids: ['longGun', 'handGun', 'melee'] },
  { group: '护甲', ids: ['head', 'body', 'legs', 'gloves'] },
  { group: '饰品', ids: ['amulet', 'ring1', 'ring2', 'ring3', 'ring4', 'relic'] },
  { group: '职业', ids: ['archetype1', 'archetype2'] },
];
export const ALL_SLOTS = BUILD_SLOTS.flatMap((g) => g.ids);

export const STORAGE_ERROR_EVENT = 'storage-error';
export const STORAGE_ERROR_THROTTLE_MS = 5000;
const MAX_TRAITS = 10;
const MAX_SAVED = 40;

/* ----------------------------- 基础判定 ----------------------------- */
const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);
const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** 槽位/模组 id：只接受非空字符串，其余一律 null（"未装备"） */
function normalizeId(v) {
  return typeof v === 'string' && v ? v : null;
}

/** 字符串数组：滤掉非字符串/空串，保序去重，可限长 */
function uniqueStrings(list, limit = Number.POSITIVE_INFINITY) {
  if (!Array.isArray(list)) return [];
  const out = [];
  const seen = new Set();
  for (const item of list) {
    if (typeof item !== 'string' || !item || seen.has(item)) continue;
    seen.add(item);
    out.push(item);
    if (out.length >= limit) break;
  }
  return out;
}

/** 浅拷贝普通对象（保留未知字段，跳过原型污染键） */
function copyPlainObject(source) {
  const out = {};
  if (!isPlainObject(source)) return out;
  for (const [k, v] of Object.entries(source)) {
    if (DANGEROUS_KEYS.has(k)) continue;
    out[k] = v;
  }
  return out;
}

/** 浅拷贝“未知字段”：跳过已知字段与危险键，用于格式兼容 */
function copyUnknown(source, knownKeys) {
  const out = {};
  if (!isPlainObject(source)) return out;
  for (const [k, v] of Object.entries(source)) {
    if (DANGEROUS_KEYS.has(k) || knownKeys.has(k)) continue;
    out[k] = v;
  }
  return out;
}

/* ----------------------------- 配装结构 ----------------------------- */
function emptyBuild() {
  const slots = {};
  for (const id of ALL_SLOTS) slots[id] = null;
  return { name: '', slots, traits: [], mods: { longGun: null, handGun: null }, consumables: [], meta: {}, updated: 0 };
}

/** 旧站槽位名 → 当前槽位名 */
const LEGACY_SLOT_ALIASES = { primary: 'longGun', secondary: 'handGun', helmet: 'head' };
const BUILD_KNOWN_KEYS = new Set(['name', 'slots', 'traits', 'mods', 'consumables', 'meta', 'updated', 'mod', 'updatedAt']);

/** 旧格式（或记录级旧 slots）→ 当前 build 结构；供迁移与 saved 兼容读取共用 */
function legacyToBuildSource(raw) {
  const source = {
    name: undefined,
    slots: {},
    traits: raw ? raw.traits : undefined,
    consumables: raw ? raw.consumables : undefined,
    meta: raw ? raw.meta : undefined,
    updated: raw ? raw.updated : undefined,
    updatedAt: raw ? raw.updatedAt : undefined,
  };
  if (!isPlainObject(raw)) return source;
  if (typeof raw.name === 'string') source.name = raw.name;
  if (isPlainObject(raw.mods)) source.mods = raw.mods;
  else if (isPlainObject(raw.mod)) source.mods = raw.mod;
  if (isPlainObject(raw.slots)) {
    for (const [key, value] of Object.entries(raw.slots)) {
      if (DANGEROUS_KEYS.has(key) || hasOwn(LEGACY_SLOT_ALIASES, key)) continue;
      source.slots[key] = value;
    }
    // 旧槽位别名只在目标槽位为空时补位，绝不让旧名覆盖新名
    for (const [legacyKey, currentKey] of Object.entries(LEGACY_SLOT_ALIASES)) {
      const value = raw.slots[legacyKey];
      if (source.slots[currentKey] == null) source.slots[currentKey] = value;
    }
  }
  return source;
}

/** 读取端归一：只保留已知结构，未知顶层字段原样保留（格式兼容） */
function normalizeBuild(raw) {
  const out = emptyBuild();
  if (!isPlainObject(raw)) return out;
  if (typeof raw.name === 'string') out.name = raw.name;
  if (isPlainObject(raw.slots)) {
    for (const slot of ALL_SLOTS) out.slots[slot] = normalizeId(raw.slots[slot]);
  }
  out.traits = uniqueStrings(raw.traits, MAX_TRAITS);
  const mods = isPlainObject(raw.mods) ? raw.mods : (isPlainObject(raw.mod) ? raw.mod : null);
  if (mods) out.mods = { longGun: normalizeId(mods.longGun), handGun: normalizeId(mods.handGun) };
  out.consumables = uniqueStrings(raw.consumables);
  out.meta = copyPlainObject(raw.meta);
  out.updated = Number.isFinite(raw.updated) ? raw.updated : (Number.isFinite(raw.updatedAt) ? raw.updatedAt : 0);
  Object.assign(out, copyUnknown(raw, BUILD_KNOWN_KEYS));
  return out;
}

function isBuildEmpty(build) {
  return !build.name
    && !build.traits.length
    && !build.mods.longGun && !build.mods.handGun
    && !build.consumables.length
    && !Object.keys(build.meta).length
    && Object.values(build.slots).every((v) => !v);
}

function normalizeIdSet(raw) {
  const set = new Set();
  if (!Array.isArray(raw)) return set;
  for (const id of raw) if (typeof id === 'string' && id) set.add(id);
  return set;
}

/* ----------------------------- UI 偏好 ----------------------------- */
const UI_THEMES = new Set(['auto', 'light', 'dark']);
const UI_DEFAULTS = Object.freeze({ density: 'grid', nameLang: 'zh', showAssets: false, listCols: 5, theme: 'auto' });
const UI_RULES = {
  density: (v) => (v === 'grid' || v === 'list' ? v : undefined),
  nameLang: (v) => (v === 'zh' || v === 'en' ? v : undefined),
  showAssets: (v) => (typeof v === 'boolean' ? v : undefined),
  listCols: (v) => (Number.isInteger(v) && v >= 1 && v <= 12 ? v : undefined),
  theme: (v) => (UI_THEMES.has(v) ? v : undefined),
  'lab.missing': (v) => (Array.isArray(v) ? uniqueStrings(v) : undefined),
  'lab.calc': (v) => (isPlainObject(v) ? copyPlainObject(v) : undefined),
};

/** 已知键只接受合法值（非法回退默认），未知键原样保留以兼容未来 */
function normalizeUI(raw) {
  const out = { ...UI_DEFAULTS };
  if (!isPlainObject(raw)) return out;
  for (const [k, v] of Object.entries(raw)) {
    if (DANGEROUS_KEYS.has(k)) continue;
    if (hasOwn(UI_RULES, k)) {
      const value = UI_RULES[k](v);
      if (value !== undefined) out[k] = value;
      continue;
    }
    out[k] = v;
  }
  if (!UI_THEMES.has(out.theme)) out.theme = 'auto';
  return out;
}

/** 新 ui 键是否“可用”：至少有一个合法已知值或未知未来键 */
function isUIUsable(raw) {
  if (!isPlainObject(raw)) return false;
  for (const [k, v] of Object.entries(raw)) {
    if (DANGEROUS_KEYS.has(k)) continue;
    if (!hasOwn(UI_RULES, k)) return true;
    if (UI_RULES[k](v) !== undefined) return true;
  }
  return false;
}

/* ----------------------------- 具名存档 ----------------------------- */
const SAVED_KNOWN_KEYS = new Set(['id', 'name', 'ts', 'savedAt', 'build', 'slots', 'traits', 'meta']);

function normalizeSavedRecord(raw) {
  if (!isPlainObject(raw)) return null;
  const id = normalizeId(raw.id);
  if (!id) return null; // 无 id 无法引用/删除，只能丢弃
  const name = typeof raw.name === 'string' && raw.name.trim() ? raw.name : '未命名配装';
  const ts = Number.isFinite(raw.ts) ? raw.ts : (Number.isFinite(raw.savedAt) ? raw.savedAt : 0);
  const buildSource = isPlainObject(raw.build) ? raw.build : legacyToBuildSource(raw);
  const record = { id, name, ts, build: normalizeBuild(buildSource) };
  Object.assign(record, copyUnknown(raw, SAVED_KNOWN_KEYS));
  return record;
}

function normalizeSavedList(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  const ids = new Set();
  for (const item of raw) {
    const record = normalizeSavedRecord(item);
    if (!record || ids.has(record.id)) continue;
    ids.add(record.id);
    out.push(record);
  }
  return out;
}

/** 旧站 saved 记录（top-level slots/traits + savedAt）→ 当前记录结构 */
function legacyToSavedRecords(raw) {
  if (!Array.isArray(raw)) return [];
  const records = [];
  raw.forEach((item, index) => {
    if (!isPlainObject(item)) return;
    const hasShape = typeof item.id === 'string'
      || typeof item.name === 'string'
      || isPlainObject(item.slots)
      || isPlainObject(item.build);
    if (!hasShape) return;
    const ts = Number.isFinite(item.savedAt) ? item.savedAt : (Number.isFinite(item.ts) ? item.ts : 0);
    records.push(normalizeSavedRecord({
      ...item,
      id: normalizeId(item.id) || `legacy-${ts.toString(36)}-${index}`,
      name: item.name,
      ts,
      build: isPlainObject(item.build) ? item.build : legacyToBuildSource(item),
    }));
  });
  return normalizeSavedList(records).slice(0, MAX_SAVED);
}

/** 旧站 ui 偏好（viewMode/lang/showAssets）→ 当前键 */
function legacyToUI(raw) {
  if (!isPlainObject(raw)) return null;
  const out = {};
  if (raw.viewMode === 'grid' || raw.viewMode === 'list') out.density = raw.viewMode;
  if (raw.lang === 'zh' || raw.lang === 'en') out.nameLang = raw.lang;
  if (typeof raw.showAssets === 'boolean') out.showAssets = raw.showAssets;
  return Object.keys(out).length ? out : null;
}

/* ----------------------------- 事件 ----------------------------- */
const listeners = new Map();

function emit(evt, payload) {
  for (const fn of listeners.get(evt) || []) {
    try { fn(payload); } catch (e) { console.error('[store]', evt, e); }
  }
  for (const fn of listeners.get('*') || []) {
    try { fn(evt, payload); } catch (e) { console.error('[store]', e); }
  }
}

const hasSubscribers = (evt) => (listeners.get(evt)?.size || 0) > 0 || (listeners.get('*')?.size || 0) > 0;

/* ----------------------------- 存取 ----------------------------- */
const storageErrorBook = new Map(); // key -> { lastEmitAt, suppressed }
let pendingStorageErrors = [];      // 初始化阶段无人订阅时暂存（最多 5 条），首个订阅者注册后补投
const MAX_PENDING_STORAGE_ERRORS = 5;

function deliverStorageError(payload) {
  if (hasSubscribers(STORAGE_ERROR_EVENT)) {
    emit(STORAGE_ERROR_EVENT, payload);
    return;
  }
  pendingStorageErrors.push(payload);
  if (pendingStorageErrors.length > MAX_PENDING_STORAGE_ERRORS) pendingStorageErrors = pendingStorageErrors.slice(-MAX_PENDING_STORAGE_ERRORS);
}

/** 记录一次持久化失败：按 key 节流，payload 见文件头契约 */
function reportStorageError(key, error, op) {
  const now = Date.now();
  const book = storageErrorBook.get(key) || { lastEmitAt: 0, suppressed: 0 };
  const payload = { key, op, error, at: now, suppressed: book.suppressed };
  if (book.lastEmitAt && now - book.lastEmitAt < STORAGE_ERROR_THROTTLE_MS) {
    book.suppressed += 1;
    storageErrorBook.set(key, book);
    return payload;
  }
  book.lastEmitAt = now;
  book.suppressed = 0;
  storageErrorBook.set(key, book);
  deliverStorageError(payload);
  return payload;
}

function clearStorageError(key) {
  storageErrorBook.delete(key);
  pendingStorageErrors = pendingStorageErrors.filter((payload) => payload.key !== key);
}

/** 读取原始值：返回 { present, ok, value }；localStorage 不可用/JSON 损坏都不抛错 */
function readRaw(key) {
  let raw;
  try { raw = localStorage.getItem(key); } catch (error) { return { present: false, ok: false, error }; }
  if (raw == null) return { present: false, ok: false };
  try { return { present: true, ok: true, value: JSON.parse(raw) }; } catch (error) { return { present: true, ok: false, error }; }
}

function writeJSON(key, value) {
  let raw;
  try { raw = JSON.stringify(value); } catch (error) { reportStorageError(key, error, 'stringify'); return false; }
  if (typeof raw !== 'string') {
    reportStorageError(key, new TypeError(`值不可序列化：${key}`), 'stringify');
    return false;
  }
  try {
    localStorage.setItem(key, raw);
    clearStorageError(key);
    return true;
  } catch (error) {
    reportStorageError(key, error, 'set');
    return false;
  }
}

function removeRaw(key) {
  try {
    localStorage.removeItem(key);
    clearStorageError(key);
    return true;
  } catch (error) {
    reportStorageError(key, error, 'remove');
    return false;
  }
}

/* ----------------------------- 初始化 ----------------------------- */
const rawOwned = readRaw(KEY.owned);
const rawFav = readRaw(KEY.fav);
const rawBuild = readRaw(KEY.build);
const rawSaved = readRaw(KEY.saved);
const rawUI = readRaw(KEY.ui);

const state = {
  owned: normalizeIdSet(rawOwned.ok ? rawOwned.value : []),
  fav: normalizeIdSet(rawFav.ok ? rawFav.value : []),
  build: normalizeBuild(rawBuild.ok ? rawBuild.value : null),
  ui: normalizeUI(rawUI.ok ? rawUI.value : null),
};

/** 旧档迁移：只在“新键缺失或不可用（解析失败/归一后无内容）”时发生，绝不覆盖有效新数据 */
(function migrateLegacy() {
  const usableBuild = rawBuild.ok && !isBuildEmpty(normalizeBuild(rawBuild.value));
  if (!usableBuild) {
    const legacy = readRaw(LEGACY.build);
    const migrated = legacy.ok ? normalizeBuild(legacyToBuildSource(legacy.value)) : null;
    if (migrated && !isBuildEmpty(migrated)) {
      state.build = migrated;
      writeJSON(KEY.build, migrated);
    }
  }

  const usableSaved = rawSaved.ok && normalizeSavedList(rawSaved.value).length > 0;
  if (!usableSaved) {
    const legacy = readRaw(LEGACY.saved);
    const records = legacy.ok ? legacyToSavedRecords(legacy.value) : [];
    if (records.length) writeJSON(KEY.saved, records);
  }

  const usableUI = rawUI.ok && isUIUsable(rawUI.value);
  if (!usableUI) {
    const legacy = readRaw(LEGACY.ui);
    const migratedUI = legacy.ok ? legacyToUI(legacy.value) : null;
    if (migratedUI) {
      state.ui = normalizeUI({ ...state.ui, ...migratedUI });
      writeJSON(KEY.ui, state.ui);
    }
  }
})();

/* ----------------------------- 对外 API ----------------------------- */
const store = {
  state,
  BUILD_SLOTS,
  ALL_SLOTS,

  on(evt, fn) {
    if (typeof fn !== 'function') return () => {};
    if (!listeners.has(evt)) listeners.set(evt, new Set());
    listeners.get(evt).add(fn);
    // 初始化/迁移阶段的写入失败先暂存，首个订阅者注册后补投，保证“失败可见”
    if (pendingStorageErrors.length && (evt === STORAGE_ERROR_EVENT || evt === '*')) {
      const pending = pendingStorageErrors;
      pendingStorageErrors = [];
      const deliver = () => {
        for (const payload of pending) {
          try {
            if (evt === '*') fn(STORAGE_ERROR_EVENT, payload);
            else fn(payload);
          } catch (e) { console.error('[store]', evt, e); }
        }
      };
      if (typeof queueMicrotask === 'function') queueMicrotask(deliver);
      else Promise.resolve().then(deliver);
    }
    return () => store.off(evt, fn);
  },
  off(evt, fn) { listeners.get(evt)?.delete(fn); },

  /* --- 拥有 --- */
  isOwned(id) { return state.owned.has(id); },
  toggleOwned(id) {
    if (typeof id !== 'string' || !id) return false;
    const v = !state.owned.has(id);
    v ? state.owned.add(id) : state.owned.delete(id);
    writeJSON(KEY.owned, [...state.owned]);
    emit('owned', { id, owned: v });
    return v;
  },
  setOwned(id, v) {
    if (typeof id !== 'string' || !id) return !!v;
    const has = state.owned.has(id);
    if (has === !!v) return !!v;
    v ? state.owned.add(id) : state.owned.delete(id);
    writeJSON(KEY.owned, [...state.owned]);
    emit('owned', { id, owned: !!v });
    return !!v;
  },
  ownedCount() { return state.owned.size; },

  /* --- 收藏 --- */
  isFav(id) { return state.fav.has(id); },
  toggleFav(id) {
    if (typeof id !== 'string' || !id) return false;
    const v = !state.fav.has(id);
    v ? state.fav.add(id) : state.fav.delete(id);
    writeJSON(KEY.fav, [...state.fav]);
    emit('fav', { id, fav: v });
    return v;
  },
  favCount() { return state.fav.size; },

  /* --- 配装 --- */
  build: {
    get(slot) { return hasOwn(state.build.slots, slot) ? normalizeId(state.build.slots[slot]) : null; },
    set(slot, id) {
      if (!hasOwn(state.build.slots, slot)) return;
      state.build.slots[slot] = normalizeId(id);
      state.build.updated = Date.now();
      writeJSON(KEY.build, state.build);
      emit('build', { slot, id: normalizeId(id) });
    },
    remove(slot) { store.build.set(slot, null); },
    clear() {
      const name = state.build.name;
      state.build = emptyBuild();
      state.build.name = name;
      writeJSON(KEY.build, state.build);
      emit('build', { slot: null, id: null, cleared: true });
    },
    setName(name) {
      state.build.name = typeof name === 'string' ? name : '';
      writeJSON(KEY.build, state.build);
    },
    slots() { return { ...state.build.slots }; },
    ids() { return Object.values(state.build.slots).filter(Boolean); },
    filled() { return store.build.ids().length; },
    traits() { return [...state.build.traits]; },
    setTraits(list) {
      state.build.traits = uniqueStrings(list, MAX_TRAITS);
      writeJSON(KEY.build, state.build);
      emit('build', { traits: [...state.build.traits] });
    },
    mods() { return { ...state.build.mods }; },
    /** 附加状态（增益档 / 场景 / 缺件标记等，随配装一起存档） */
    meta() { return copyPlainObject(state.build.meta); },
    setMeta(patch) {
      if (!isPlainObject(patch)) return;
      state.build.meta = { ...copyPlainObject(state.build.meta), ...copyPlainObject(patch) };
      state.build.updated = Date.now();
      writeJSON(KEY.build, state.build);
      emit('build', { meta: copyPlainObject(state.build.meta) });
    },
    setMod(which, id) {
      if (which !== 'longGun' && which !== 'handGun') return;
      state.build.mods[which] = normalizeId(id);
      writeJSON(KEY.build, state.build);
      emit('build', { mod: which, id: normalizeId(id) });
    },
  },

  /* --- 具名配装存档（最多 40 条；持久化只在这里） --- */
  saved: {
    list() {
      const raw = readRaw(KEY.saved);
      return raw.ok ? normalizeSavedList(raw.value) : [];
    },
    /** 把当前配装存为具名存档；重名则覆盖 */
    save(name) {
      const clean = String(name || '').trim() || `配装 ${new Date().toLocaleString('zh-CN', { hour12: false })}`;
      const list = store.saved.list();
      const rec = {
        id: `b${Date.now().toString(36)}`,
        name: clean,
        ts: Date.now(),
        build: JSON.parse(JSON.stringify(state.build)),
      };
      const idx = list.findIndex((x) => x.name === clean);
      if (idx >= 0) list[idx] = { ...rec, id: list[idx].id };
      else list.unshift(rec);
      writeJSON(KEY.saved, list.slice(0, MAX_SAVED));
      emit('saved', { action: 'save', id: idx >= 0 ? list[idx].id : rec.id });
      return idx >= 0 ? list[idx] : rec;
    },
    load(id) {
      const rec = store.saved.list().find((x) => x.id === id);
      if (!rec) return false;
      state.build = normalizeBuild(JSON.parse(JSON.stringify(rec.build)));
      writeJSON(KEY.build, state.build);
      emit('build', { slot: null, id: null, loaded: id });
      return true;
    },
    remove(id) {
      const list = store.saved.list().filter((x) => x.id !== id);
      writeJSON(KEY.saved, list);
      emit('saved', { action: 'remove', id });
      return true;
    },
    rename(id, name) {
      const list = store.saved.list();
      const rec = list.find((x) => x.id === id);
      if (!rec) return false;
      rec.name = String(name || '').trim() || rec.name;
      writeJSON(KEY.saved, list);
      emit('saved', { action: 'rename', id });
      return true;
    },
    count() { return store.saved.list().length; },
  },

  /* --- UI 偏好 --- */
  ui: {
    get(k) { return state.ui[k]; },
    set(k, v) {
      if (typeof k !== 'string' || !k) return;
      const value = hasOwn(UI_RULES, k) ? UI_RULES[k](v) : v;
      if (value === undefined) return;
      state.ui[k] = value;
      writeJSON(KEY.ui, state.ui);
      emit('ui', { key: k, value });
    },
    /** 主题模式：'auto' 跟随系统 | 'light' 白天 | 'dark' 黑夜（默认 auto，存在 r2.v2.ui.theme） */
    theme() { return state.ui.theme; },
    setTheme(v) {
      const mode = UI_THEMES.has(v) ? v : 'auto';
      if (state.ui.theme === mode) return mode;
      state.ui.theme = mode;
      writeJSON(KEY.ui, state.ui);
      emit('ui', { key: 'theme', value: mode });
      return mode;
    },
  },

  /** 一次性重置（危险操作，视图须二次确认）。逐 key 尽力删除，返回是否全部成功；失败走 storage-error */
  resetAll() {
    let ok = true;
    for (const key of [...Object.values(KEY), ...Object.values(LEGACY)]) {
      if (!removeRaw(key)) ok = false;
    }
    state.owned.clear();
    state.fav.clear();
    state.build = emptyBuild();
    state.ui = normalizeUI({});
    emit('owned', {});
    emit('fav', {});
    emit('build', { cleared: true });
    emit('saved', { action: 'reset' });
    emit('ui', { key: 'theme', value: state.ui.theme });
    return ok;
  },
};

export { store, emptyBuild };
export default store;
