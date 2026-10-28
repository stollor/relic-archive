/* =============================================================================
   遗迹2 · 遗物档案 — lab/state.js（v2）
   工作台状态：特性等级 / 碎片 / 消耗品 / 场景 / 档位目标 全部写进 store.build.meta
   （随具名存档一起走）；不再有「增益档 profile」作为状态依赖。
   缺件（可用池）仍独立于 owned，存 store.ui。
   ========================================================================== */
import { store } from '../core/store.js';

const UI = {
  missing: 'lab.missing',
};

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

/* ----------------------------- meta 基础 ----------------------------- */
export function meta() { return (store.build.meta && store.build.meta()) || {}; }
const asObjSet = (list) => {
  const o = {};
  for (const id of list || []) if (id) o[id] = true;
  return o;
};
const asArr = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []);

/* ----------------------------- 特性 ----------------------------- */
export function traitLevels() { return { ...(meta().traitLevels || {}) }; }
export function traitUsed() {
  const tl = traitLevels();
  return Object.keys(tl).filter((k) => tl[k] > 0).length;
}
/** 0~10 级；新增第 11 个特性会被拒绝（返回 {ok:false,reason:'cap'}） */
export function setTraitLevel(id, level) {
  if (!id) return { ok: false, reason: 'bad' };
  const lv = Math.max(0, Math.min(TRAIT_MAX_LEVEL, Math.round(Number(level) || 0)));
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
  (engineTraits || []).slice(0, TRAIT_CAP).forEach((t) => { tl[t.id] = TRAIT_MAX_LEVEL; });
  store.build.setMeta({ traitLevels: tl });
  return Object.keys(tl).length;
}
export function clearTraits() { store.build.setMeta({ traitLevels: {} }); }

/* ----------------------------- 碎片 / 消耗品 ----------------------------- */
export function fragments() { return asArr(meta().fragments); }
export function consumables() { return asArr(meta().consumables); }
export function toggleFragment(id) {
  const set = new Set(fragments());
  if (set.has(id)) set.delete(id); else set.add(id);
  store.build.setMeta({ fragments: [...set] });
  return set.has(id);
}
export function toggleConsumable(id) {
  const set = new Set(consumables());
  if (set.has(id)) set.delete(id); else set.add(id);
  store.build.setMeta({ consumables: [...set] });
  return set.has(id);
}
export function clearFragmentsConsumables() { store.build.setMeta({ fragments: [], consumables: [] }); }

/* ----------------------------- 场景 / 档位目标 ----------------------------- */
export function scenarioId() { return meta().scenario || 'general'; }
export function setScenario(id) {
  if (!id || id === scenarioId()) return;
  store.build.setMeta({ scenario: id });
  emit('scenario', { scenario: id });
}
export function classTarget() { return meta().classTarget || 'free'; }
export function setClassTarget(id) {
  const v = id || 'free';
  if (v === classTarget()) return;
  store.build.setMeta({ classTarget: v });
  emit('class-target', { classTarget: v });
}

/* ----------------------------- 预设增益档种子（折叠区） ----------------------------- */
export function seedProfile() { return meta().seedProfile || null; }
export function seedPerks() { return asArr(meta().seedPerks); }
/**
 * 从旧 11 个 profile 载入为显式设置：traits/fragments/consumables/perks 灌进 meta；
 * profile 里的项链/戒指仍写进槽位（可见、可替换）。profile 不再是状态依赖。
 */
export function applyProfileSeed(model, profileId) {
  const E = model.engine;
  const p = E.profileById.get(profileId);
  if (!p) return null;
  const tl = { ...(p.traits || {}) };
  const keys = Object.keys(tl).filter((k) => tl[k] > 0).slice(0, TRAIT_CAP);
  const traitLevels2 = {};
  for (const k of keys) traitLevels2[k] = tl[k];
  store.build.setMeta({
    traitLevels: traitLevels2,
    fragments: [...(p.fragments || [])],
    consumables: [...(p.consumables || [])],
    seedPerks: [...(p.perks || [])],
    seedProfile: p.id,
    seedProfileZh: p.zh || p.id,
  });
  for (const s of ['amulet', 'ring1', 'ring2', 'ring3', 'ring4']) store.build.remove(s);
  if (p.amulet && model.itemsById.has(p.amulet)) store.build.set('amulet', p.amulet);
  (p.rings || []).slice(0, 4).forEach((id, i) => {
    if (model.itemsById.has(id)) store.build.set(`ring${i + 1}`, id);
  });
  emit('seed', { profile: p.id });
  return { profile: p, traitCount: keys.length };
}
export function clearSeed() {
  store.build.setMeta({ seedPerks: [], seedProfile: null, seedProfileZh: null });
  emit('seed', { profile: null });
}

/** v1 迁移：meta.profile（旧增益档）→ 显式设置（只跑一次） */
export function migrateLegacyMeta(model) {
  const m = meta();
  if (!m.profile) return false;
  applyProfileSeed(model, m.profile);
  store.build.setMeta({ profile: null });
  return true;
}

/* ----------------------------- 缺件（可用池，独立于 owned） ----------------------------- */
const readMissing = () => {
  const v = store.ui.get(UI.missing);
  return new Set(Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []);
};
const missingState = { set: readMissing() };
const saveMissing = () => store.ui.set(UI.missing, [...missingState.set]);

export function isMissing(id) { return missingState.set.has(id); }
export function missingCount() { return missingState.set.size; }
export function missingIds() { return [...missingState.set]; }
export function toggleMissing(id) {
  if (!id) return false;
  if (missingState.set.has(id)) missingState.set.delete(id); else missingState.set.add(id);
  saveMissing();
  emit('missing', { id, missing: missingState.set.has(id) });
  return missingState.set.has(id);
}
export function clearMissing() {
  if (!missingState.set.size) return;
  missingState.set.clear();
  saveMissing();
  emit('missing', { cleared: true });
}
export function missingSet() { return new Set(missingState.set); }

/* ----------------------------- 拥有池 ----------------------------- */
export function ownedSet() { return new Set(store.state.owned); }
export function ownedCount() { return store.state.owned.size; }

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
  ['head', 'body', 'legs', 'gloves'].forEach((slot, i) => { if (ids && ids[i]) store.build.set(slot, ids[i]); });
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
