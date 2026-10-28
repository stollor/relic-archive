/* =============================================================================
   遗迹2 · 遗物档案 — store.js
   全局状态：拥有 / 收藏 / 配装 / 界面偏好。持久化只在这里读写 localStorage。
   事件：'owned' 'fav' 'build' 'ui'
   ========================================================================== */
import { h } from './dom.js';

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

/* ----------------------------- 存取 ----------------------------- */
function readJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch { return fallback; }
}
function writeJSON(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)); } catch { /* 配额/隐私模式：静默降级 */ }
}

const listeners = new Map();
function emit(evt, payload) {
  for (const fn of listeners.get(evt) || []) {
    try { fn(payload); } catch (e) { console.error('[store]', evt, e); }
  }
  for (const fn of listeners.get('*') || []) {
    try { fn(evt, payload); } catch (e) { console.error('[store]', e); }
  }
}

function emptyBuild() {
  const slots = {};
  for (const id of ALL_SLOTS) slots[id] = null;
  return { name: '', slots, traits: [], mods: { longGun: null, handGun: null }, consumables: [], meta: {}, updated: 0 };
}

/* ----------------------------- 初始化 ----------------------------- */
const UI_THEMES = new Set(['auto', 'light', 'dark']);
const state = {
  owned: new Set(readJSON(KEY.owned, [])),
  fav: new Set(readJSON(KEY.fav, [])),
  build: Object.assign(emptyBuild(), readJSON(KEY.build, {})),
  ui: Object.assign({ density: 'grid', nameLang: 'zh', showAssets: false, listCols: 5, theme: 'auto' }, readJSON(KEY.ui, {})),
};
// 主题模式兜底：旧值缺失 / 脏数据 → auto（跟随系统）
if (!UI_THEMES.has(state.ui.theme)) state.ui.theme = 'auto';
// 旧版数据迁移（只做一次）
(function migrate() {
  const legacy = readJSON(LEGACY.build, null);
  if (legacy && !localStorage.getItem(KEY.build)) {
    const b = emptyBuild();
    if (legacy.slots) for (const [k, v] of Object.entries(legacy.slots)) if (k in b.slots) b.slots[k] = v;
    if (Array.isArray(legacy.traits)) b.traits = legacy.traits.slice(0, 10);
    if (legacy.mod) b.mods = Object.assign(b.mods, legacy.mod);
    b.name = legacy.name || '';
    state.build = b;
    writeJSON(KEY.build, b);
  }
})();

/* ----------------------------- 拥有 / 收藏 ----------------------------- */
const store = {
  state,
  BUILD_SLOTS,
  ALL_SLOTS,

  on(evt, fn) {
    if (!listeners.has(evt)) listeners.set(evt, new Set());
    listeners.get(evt).add(fn);
    return () => store.off(evt, fn);
  },
  off(evt, fn) { listeners.get(evt)?.delete(fn); },

  /* --- 拥有 --- */
  isOwned(id) { return state.owned.has(id); },
  toggleOwned(id) {
    const v = !state.owned.has(id);
    v ? state.owned.add(id) : state.owned.delete(id);
    writeJSON(KEY.owned, [...state.owned]);
    emit('owned', { id, owned: v });
    return v;
  },
  setOwned(id, v) {
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
    const v = !state.fav.has(id);
    v ? state.fav.add(id) : state.fav.delete(id);
    writeJSON(KEY.fav, [...state.fav]);
    emit('fav', { id, fav: v });
    return v;
  },
  favCount() { return state.fav.size; },

  /* --- 配装 --- */
  build: {
    get(slot) { return state.build.slots[slot] || null; },
    set(slot, id) {
      if (!(slot in state.build.slots)) return;
      state.build.slots[slot] = id || null;
      state.build.updated = Date.now();
      writeJSON(KEY.build, state.build);
      emit('build', { slot, id: id || null });
    },
    remove(slot) { store.build.set(slot, null); },
    clear() {
      const name = state.build.name;
      state.build = emptyBuild();
      state.build.name = name;
      writeJSON(KEY.build, state.build);
      emit('build', { slot: null, id: null, cleared: true });
    },
    setName(name) { state.build.name = name; writeJSON(KEY.build, state.build); },
    slots() { return { ...state.build.slots }; },
    ids() { return Object.values(state.build.slots).filter(Boolean); },
    filled() { return store.build.ids().length; },
    traits() { return [...state.build.traits]; },
    setTraits(list) {
      state.build.traits = [...new Set(list)].slice(0, 10);
      writeJSON(KEY.build, state.build);
      emit('build', { traits: state.build.traits });
    },
    mods() { return { ...state.build.mods }; },
    /** 附加状态（增益档 / 场景 / 缺件标记等，随配装一起存档） */
    meta() { return { ...(state.build.meta || {}) }; },
    setMeta(patch) {
      state.build.meta = { ...(state.build.meta || {}), ...patch };
      state.build.updated = Date.now();
      writeJSON(KEY.build, state.build);
      emit('build', { meta: state.build.meta });
    },
    setMod(which, id) {
      state.build.mods[which] = id || null;
      writeJSON(KEY.build, state.build);
      emit('build', { mod: which, id: id || null });
    },
  },

  /* --- 具名配装存档（最多 40 条；持久化只在这里） --- */
  saved: {
    list() {
      const arr = readJSON(KEY.saved, []);
      return Array.isArray(arr) ? arr : [];
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
      writeJSON(KEY.saved, list.slice(0, 40));
      emit('saved', { action: 'save', id: idx >= 0 ? list[idx].id : rec.id });
      return idx >= 0 ? list[idx] : rec;
    },
    load(id) {
      const rec = store.saved.list().find((x) => x.id === id);
      if (!rec) return false;
      state.build = Object.assign(emptyBuild(), JSON.parse(JSON.stringify(rec.build)));
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
      state.ui[k] = v;
      writeJSON(KEY.ui, state.ui);
      emit('ui', { key: k, value: v });
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

  /** 一次性重置（危险操作，视图须二次确认） */
  resetAll() {
    state.owned.clear();
    state.fav.clear();
    state.build = emptyBuild();
    for (const k of Object.values(KEY)) localStorage.removeItem(k);
    emit('owned', {}); emit('fav', {}); emit('build', { cleared: true });
  },
};

export { store, emptyBuild };
export default store;
