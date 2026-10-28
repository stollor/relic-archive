/* =============================================================================
   遗迹2 · 遗物档案 — lab/state.js（v2）
   工作台状态：特性等级 / 碎片 / 消耗品 / 场景 / 档位目标 全部写进 store.build.meta
   （随具名存档一起走）；不再有「增益档 profile」作为状态依赖。
   缺件（可用池）仍独立于 owned，存 store.ui。
   meta 读取端防御：脏 meta（非对象 / 错误类型 / 越界等级）归一为合法结构，绝不抛错。
   ========================================================================== */
import { store } from '../core/store.js';

const UI = {
  missing: 'lab.missing',
};
const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

export const TRAIT_CAP = 10;      // 游戏特性装备上限（个），不是等级上限
export const TRAIT_MAX_LEVEL = 10;

const listeners = new Set();
const emit = (reason, payload) => {
  for (const fn of listeners) {
    try { fn(reason, payload); } catch (e) { console.error('[lab:state]', e); }
  }
};
export function on(fn) { listeners.add(fn); return () => listeners.delete(fn); }
export function off(fn) { listeners.delete(fn); }

/* ----------------------------- meta 读取端防御 ----------------------------- */
const clampLevel = (value) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(TRAIT_MAX_LEVEL, Math.round(n)));
};
const asArr = (value) => {
  if (!Array.isArray(value)) return [];
  const out = [];
  const seen = new Set();
  for (const item of value) {
    if (typeof item !== 'string' || !item || seen.has(item)) continue;
    seen.add(item);
    out.push(item);
  }
  return out;
};
const asObjSet = (list) => {
  const o = {};
  if (!Array.isArray(list)) return o;
  for (const id of list) if (typeof id === 'string' && id) o[id] = true;
  return o;
};
const STRING_META_KEYS = new Set(['scenario', 'classTarget', 'seedProfile', 'seedProfileZh', 'profile']);

/** 脏 meta → 合法结构：traitLevels 数值并 clamp[0,TRAIT_MAX_LEVEL]，列表只留字符串，单值键只留字符串 */
function sanitizeMeta(raw) {
  if (!isPlainObject(raw)) return {};
  const metaOut = {};
  for (const [k, v] of Object.entries(raw)) {
    if (DANGEROUS_KEYS.has(k)) continue;
    metaOut[k] = v;
  }
  const rawLevels = metaOut.traitLevels;
  const levels = {};
  if (isPlainObject(rawLevels)) {
    for (const [id, level] of Object.entries(rawLevels)) {
      if (typeof level !== 'number' || !Number.isFinite(level)) continue;
      const clamped = clampLevel(level);
      if (clamped > 0) levels[id] = clamped;
    }
  }
  if (Object.keys(levels).length) metaOut.traitLevels = levels;
  else delete metaOut.traitLevels;
  for (const key of ['fragments', 'consumables', 'seedPerks']) {
    if (key in metaOut) metaOut[key] = asArr(metaOut[key]);
  }
  for (const key of STRING_META_KEYS) {
    if (key in metaOut && typeof metaOut[key] !== 'string') delete metaOut[key];
  }
  return metaOut;
}

export function meta() {
  let raw = null;
  try { raw = store.build && typeof store.build.meta === 'function' ? store.build.meta() : null; } catch { raw = null; }
  return sanitizeMeta(raw);
}

/* ----------------------------- 特性 ----------------------------- */
export function traitLevels() { return { ...(meta().traitLevels || {}) }; }
export function traitUsed() {
  const tl = traitLevels();
  return Object.keys(tl).filter((k) => tl[k] > 0).length;
}
/** 0~10 级；新增第 11 个特性会被拒绝（返回 {ok:false,reason:'cap'}） */
export function setTraitLevel(id, level) {
  if (typeof id !== 'string' || !id) return { ok: false, reason: 'bad' };
  const lv = clampLevel(level);
  const tl = traitLevels();
  const wasOn = (tl[id] || 0) > 0;
  if (lv > 0 && !wasOn && traitUsed() >= TRAIT_CAP) return { ok: false, reason: 'cap' };
  if (lv <= 0) delete tl[id]; else tl[id] = lv;
  store.build.setMeta({ traitLevels: tl });
  return { ok: true, level: lv };
}
export function incTrait(id, delta = 1) { return setTraitLevel(id, (traitLevels()[id] || 0) + delta); }
/** 全满：按 engine.traits 顺序取前 10 个设 10 级（游戏上限 10 个） */
export function fillTraits(engineTraits) {
  const tl = {};
  const list = Array.isArray(engineTraits) ? engineTraits : [];
  list.slice(0, TRAIT_CAP).forEach((t) => {
    const id = typeof t === 'string' ? t : (t && typeof t.id === 'string' ? t.id : null);
    if (id) tl[id] = TRAIT_MAX_LEVEL;
  });
  store.build.setMeta({ traitLevels: tl });
  return Object.keys(tl).length;
}
export function clearTraits() { store.build.setMeta({ traitLevels: {} }); }

/* ----------------------------- 碎片 / 消耗品 ----------------------------- */
export function fragments() { return asArr(meta().fragments); }
export function consumables() { return asArr(meta().consumables); }
export function toggleFragment(id) {
  if (typeof id !== 'string' || !id) return false;
  const set = new Set(fragments());
  if (set.has(id)) set.delete(id); else set.add(id);
  store.build.setMeta({ fragments: [...set] });
  return set.has(id);
}
export function toggleConsumable(id) {
  if (typeof id !== 'string' || !id) return false;
  const set = new Set(consumables());
  if (set.has(id)) set.delete(id); else set.add(id);
  store.build.setMeta({ consumables: [...set] });
  return set.has(id);
}
export function clearFragmentsConsumables() { store.build.setMeta({ fragments: [], consumables: [] }); }

/* ----------------------------- 场景 / 档位目标 ----------------------------- */
export function scenarioId() {
  const value = meta().scenario;
  return typeof value === 'string' ? value : 'general';
}
export function setScenario(id) {
  if (!id || typeof id !== 'string' || id === scenarioId()) return;
  store.build.setMeta({ scenario: id });
  emit('scenario', { scenario: id });
}
export function classTarget() {
  const value = meta().classTarget;
  return typeof value === 'string' ? value : 'free';
}
export function setClassTarget(id) {
  const v = typeof id === 'string' && id ? id : 'free';
  if (v === classTarget()) return;
  store.build.setMeta({ classTarget: v });
  emit('class-target', { classTarget: v });
}

/* ----------------------------- 预设增益档种子（折叠区） ----------------------------- */
export function seedProfile() { const v = meta().seedProfile; return typeof v === 'string' ? v : null; }
export function seedPerks() { return asArr(meta().seedPerks); }
/**
 * 从旧 11 个 profile 载入为显式设置：traits/fragments/consumables/perks 灌进 meta；
 * profile 里的项链/戒指仍写进槽位（可见、可替换）。profile 不再是状态依赖。
 */
export function applyProfileSeed(model, profileId) {
  const E = model && model.engine;
  if (!E || !E.profileById || typeof profileId !== 'string' || !profileId) return null;
  const p = E.profileById.get(profileId);
  if (!p) return null;
  const rawTraits = isPlainObject(p.traits) ? p.traits : {};
  const keys = Object.keys(rawTraits).filter((k) => Number(rawTraits[k]) > 0).slice(0, TRAIT_CAP);
  const traitLevels2 = {};
  for (const k of keys) traitLevels2[k] = clampLevel(rawTraits[k]);
  store.build.setMeta({
    traitLevels: traitLevels2,
    fragments: asArr(p.fragments),
    consumables: asArr(p.consumables),
    seedPerks: asArr(p.perks),
    seedProfile: p.id,
    seedProfileZh: typeof p.zh === 'string' ? p.zh : p.id,
  });
  for (const s of ['amulet', 'ring1', 'ring2', 'ring3', 'ring4']) store.build.remove(s);
  const itemsById = model.itemsById;
  if (itemsById && typeof itemsById.has === 'function') {
    if (p.amulet && itemsById.has(p.amulet)) store.build.set('amulet', p.amulet);
    const rings = Array.isArray(p.rings) ? p.rings : [];
    rings.slice(0, 4).forEach((id, i) => {
      if (itemsById.has(id)) store.build.set(`ring${i + 1}`, id);
    });
  }
  emit('seed', { profile: p.id });
  return { profile: p, traitCount: keys.length };
}
export function clearSeed() {
  store.build.setMeta({ seedPerks: [], seedProfile: null, seedProfileZh: null });
  emit('seed', { profile: null });
}

/** v1 迁移：meta.profile（旧增益档）→ 显式设置（只跑一次） */
export function migrateLegacyMeta(model) {
  const profile = meta().profile;
  if (typeof profile !== 'string' || !profile) return false;
  applyProfileSeed(model, profile);
  store.build.setMeta({ profile: null });
  return true;
}

/* ----------------------------- 缺件（可用池，独立于 owned） ----------------------------- */
/* 唯一权威是 store.ui['lab.missing']；这里只按「数组引用」记忆化读取，不保留可写副本。
   外部写入（resetAll / 其它模块）会换引用 → 下次读取自动同步；本模块写入仍走 saveMissing。
   注意：写入必须经 store.ui.set（会换引用），直接原地修改同一数组不会被感知。 */
const readMissing = (v) => new Set(Array.isArray(v) ? v.filter((x) => typeof x === 'string' && x) : []);
let missingSrc = null;
let missingCache = readMissing(null);
function missingNow() {
  const src = store.ui.get(UI.missing);
  if (src !== missingSrc) { missingSrc = src; missingCache = readMissing(src); }
  return missingCache;
}
const saveMissing = () => store.ui.set(UI.missing, [...missingNow()]);

export function isMissing(id) { return missingNow().has(id); }
export function missingCount() { return missingNow().size; }
export function missingIds() { return [...missingNow()]; }
export function toggleMissing(id) {
  if (typeof id !== 'string' || !id) return false;
  const set = missingNow();
  if (set.has(id)) set.delete(id); else set.add(id);
  saveMissing();
  emit('missing', { id, missing: set.has(id) });
  return set.has(id);
}
export function clearMissing() {
  const set = missingNow();
  if (!set.size) return;
  set.clear();
  saveMissing();
  emit('missing', { cleared: true });
}
export function missingSet() { return new Set(missingNow()); }

/* ----------------------------- 拥有池 ----------------------------- */
export function ownedSet() {
  const owned = store.state && store.state.owned;
  return new Set(owned && typeof owned[Symbol.iterator] === 'function' ? owned : []);
}
export function ownedCount() {
  const owned = store.state && store.state.owned;
  return owned && typeof owned.size === 'number' ? owned.size : 0;
}

/* ----------------------------- 组装 picks ----------------------------- */
/** 工作台当前 15 槽 + meta 设置 → engine.expandMods 的 picks */
export function workbenchPicks(model) {
  const E = model.engine;
  const m = meta();
  const slots = store.build.slots();
  const gearIds = ['amulet', 'ring1', 'ring2', 'ring3', 'ring4'].map((s) => slots[s]).filter(Boolean);
  const gear = E.picksFromGear(gearIds);
  const perks = {};
  for (const slot of ['archetype1', 'archetype2']) {
    const aid = slots[slot];
    if (!aid) continue;
    for (const pid of model.perksOf(aid)) perks[pid] = true;
  }
  for (const pid of asArr(m.seedPerks)) perks[pid] = true;
  return {
    traits: { ...(m.traitLevels || {}) },
    fragments: asObjSet(m.fragments),
    consumables: asObjSet(m.consumables),
    perks,
    rings: gear.rings,
    amulet: gear.amulet,
  };
}

export function workbenchSummary(model) {
  const E = model.engine;
  const slots = store.build.slots();
  const ids = ['head', 'body', 'legs', 'gloves'].map((s) => slots[s] || null);
  const picks = workbenchPicks(model);
  const acc = E.expandMods(picks);
  const sc = E.scenarioById(scenarioId());
  const st = E.comboStats(ids, acc, sc);
  st.ids = ids;
  st.scenario = sc;
  st.filled = ids.filter(Boolean).length;
  st.acc = acc;
  st.picks = picks;
  return st;
}

/** 写入四件护甲（不 toast，调用方提示） */
export function writeArmor(ids) {
  const list = Array.isArray(ids) ? ids : [];
  ['head', 'body', 'legs', 'gloves'].forEach((slot, i) => { if (list[i]) store.build.set(slot, list[i]); });
}

export default {
  on, off, meta,
  traitLevels, traitUsed, setTraitLevel, incTrait, fillTraits, clearTraits,
  fragments, consumables, toggleFragment, toggleConsumable, clearFragmentsConsumables,
  scenarioId, setScenario, classTarget, setClassTarget,
  seedProfile, seedPerks, applyProfileSeed, clearSeed, migrateLegacyMeta,
  isMissing, missingCount, missingIds, toggleMissing, clearMissing, missingSet,
  ownedSet, ownedCount,
  workbenchPicks, workbenchSummary, writeArmor,
};
