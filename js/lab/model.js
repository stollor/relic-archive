/* =============================================================================
   遗迹2 · 遗物档案 — lab/model.js（v2）
   实验室数据装配层：api.site() + api.itemList() + api.archetypes() → 引擎 / 图标 / 职业表。
   视图只从这里拿数据，不直接 fetch。
   ========================================================================== */
import { api } from '../core/api.js';
import { SLOT_ZH } from '../core/labels.js';
import { createEngine } from './engine.js';

/**
 * 引擎按 site 数据对象缓存：api.site() 在同一页面会话内返回同一引用，而 createEngine 是
 * 纯装配（只读 site、无外部状态），其派生缓存（tableA/B/C、frontier 等）可跨 #/lab 挂载复用。
 * 这样「离开实验室再回来，首次展开档位对照」不再重跑 tableB（812,224 组合，实测 105~190ms 长任务）。
 * WeakMap 以 site 引用为键：页面刷新 / 数据对象被替换时自动失效，不引入版本号或全局状态。
 */
const ENGINE_CACHE = new WeakMap();
function engineFor(site) {
  let engine = ENGINE_CACHE.get(site);
  if (!engine) {
    engine = createEngine(site);
    ENGINE_CACHE.set(site, engine);
  }
  return engine;
}

/** site_data.pieces[].icon 是相对 assets/ 的路径（icons/xxx.png） */
function assetUrl(rel) {
  if (!rel) return null;
  const s = String(rel);
  if (s.startsWith('data:') || s.startsWith('/')) return s;
  return `/assets/${s.replace(/^\.?\/*/, '')}`;
}

/** 可放入配装槽位的物品族（15 槽口径，职业由 archetypes.json 另行提供） */
export const SLOT_FAMILIES = {
  longGun: 'longGun', handGun: 'handGun', melee: 'melee',
  head: 'head', body: 'body', legs: 'legs', gloves: 'gloves',
  amulet: 'amulet', ring1: 'ring', ring2: 'ring', ring3: 'ring', ring4: 'ring', relic: 'relic',
};

/** 槽位中文名：唯一来源是 core/labels.js 的 SLOT_ZH（与 UX_SPEC §5 一致） */
export const SLOT_LABEL = SLOT_ZH;

/** 15 槽分组（工作台视觉） */
export const SLOT_GROUPS = [
  { key: 'weapon', title: '武器', cols: 3, slots: ['longGun', 'handGun', 'melee'] },
  { key: 'armor', title: '护甲四件', cols: 4, slots: ['head', 'body', 'legs', 'gloves'] },
  { key: 'trinket', title: '饰品', cols: 3, slots: ['amulet', 'ring1', 'ring2', 'ring3', 'ring4', 'relic'] },
  { key: 'archetype', title: '职业', cols: 2, slots: ['archetype1', 'archetype2'] },
];

function normPerkIds(perks) {
  const ids = [];
  for (const p of perks || []) {
    if (typeof p === 'string') ids.push(p);
    else if (p && typeof p === 'object') { if (p.id) ids.push(String(p.id)); else if (p.perk) ids.push(String(p.perk)); }
  }
  return [...new Set(ids)];
}

/* ------------------------- 实验室 v2：装备目录 ------------------------- */
/** gearDoc（data/lab_gear.json）→ 可直接消费的索引；字段契约见 docs/LAB_V2.md §1 */
function buildGear(gearDoc, itemsById, engine) {
  const doc = gearDoc || {};
  const bySort = (a, b) => (Number(a.order) || 0) - (Number(b.order) || 0);
  const dimensions = Array.isArray(doc.dimensions) ? doc.dimensions.slice().sort(bySort) : [];
  const playstyles = Array.isArray(doc.playstyles) ? doc.playstyles.slice().sort(bySort) : [];
  const raw = doc.gear || {};
  const KINDS = ['ring', 'amulet', 'mutator', 'mod', 'fragment', 'trait', 'relic'];
  const lists = {};
  const byId = new Map();
  for (const kind of KINDS) {
    const arr = Array.isArray(raw[kind]) ? raw[kind] : [];
    lists[kind] = arr.map((it) => {
      const base = it && typeof it === 'object' ? it : { id: String(it || '') };
      const item = itemsById.get(base.id) || null;
      const numeric = engine.modById.get(base.id) || null;
      const rec = {
        ...base,
        kind,
        zh: String(base.zh || (item && item.zh) || base.id || '待验证'),
        en: String(base.en || (item && item.en) || ''),
        tags: Array.isArray(base.tags) ? base.tags : [],
        dims: base.dims && typeof base.dims === 'object' ? base.dims : {},
        effectZh: String(base.effectZh || (item && (item.effectZh || item.summaryZh)) || ''),
        effectEn: String(base.effectEn || (item && (item.effectEn || item.summaryEn)) || ''),
        effectSrc: String(base.effectSrc || (item && item.effectSrc) || ''),
        confidence: String(base.confidence || 'low'),
        evidence: Array.isArray(base.evidence) ? base.evidence : [],
        hard: base.hard === true,
        numeric: numeric || null,
        item,
      };
      if (kind === 'trait' && numeric) {
        rec.maxLevel = Number(rec.maxLevel || numeric.max_level || 10) || 10;
        if (!rec.perLevel && numeric.effect_per_level) rec.perLevel = numeric.effect_per_level;
      }
      if (byId.has(rec.id)) return rec;
      byId.set(rec.id, rec);
      return rec;
    });
  }
  const dimensionById = new Map(dimensions.map((d) => [d.id, d]));
  const playstyleById = new Map(playstyles.map((p) => [p.id, p]));
  return {
    doc,
    dimensions,
    dimensionById,
    playstyles,
    playstyleById,
    ...lists,
    lists,
    byId,
    kinds: KINDS,
    dimensionZh: (id) => (dimensionById.get(id) || {}).zh || String(id || ''),
    of(id) { return byId.get(id) || null; },
    kindOf(id) { const g = byId.get(id); return g ? g.kind : null; },
    /** 指定类型的全部条目（空类型返回 []） */
    all(kind) { return lists[kind] || []; },
  };
}

/**
 * 载入实验室模型。
 * @returns {Promise<{engine, itemsById, slotPools, archetypes, archetypeById, perksOf, gear}>}
 */
export async function loadLabModel() {
  const [site, itemList, archDoc, gearDoc] = await Promise.all([
    api.site(),
    api.itemList(),
    api.archetypes ? api.archetypes().catch(() => ({ archetypes: [] })) : Promise.resolve({ archetypes: [] }),
    api.labGear(),
  ]);
  await api.icons().catch(() => null);
  const engine = engineFor(site);

  const itemsById = new Map(itemList.map((it) => [it.id, it]));
  const itemIcon = (it) => (it ? api.iconUrl(it) : null);

  /* 护甲件：数值以 site_data.pieces 为准（Python 引擎产出），图标/名称用 items.json 兜底 */
  const pieceById = new Map();
  for (const p of engine.pieces) {
    const it = itemsById.get(p.id) || null;
    p.item = it;
    p.zh = p.zh || (it && it.zh) || p.id;
    p.en = p.en || (it && it.en) || '';
    p.iconUrl = itemIcon(it) || assetUrl(p.icon);
    p.hard = (p.dobt || []).some((x) => x === '头目掉落' || x === 'Boss' || x === '解谜' || x === '随机');
    pieceById.set(p.id, p);
  }

  /* 实验室 v2 装备目录：维度/流派/全量饰品与挂件/碎片/特性 */
  const gear = buildGear(gearDoc, itemsById, engine);

  /* 职业表：文件缺失/未产出时为空数组，视图显示「职业数据载入中 / 待验证」 */
  const DLC_ZH = { base: '本体', dlc1: '真皇的苏醒', dlc2: '失落的王国', dlc3: '暗黑地平线', dlc4: 'DLC4' };
  const rawArch = Array.isArray(archDoc && archDoc.archetypes) ? archDoc.archetypes : [];
  const archetypes = rawArch.map((a, i) => {
    const unreleased = String(a.status || '') === 'unreleased';
    const trait = a.trait && typeof a.trait === 'object'
      ? { id: String(a.trait.id || ''), zh: String(a.trait.zh || ''), en: String(a.trait.en || ''), raw: a.trait }
      : null;
    return {
      id: String(a.id || a.en || `archetype-${i}`),
      en: String(a.en || a.id || ''),
      zh: String(a.zh || a.en || a.id || '待验证'),
      dlc: String(a.dlc || ''),
      dlcZh: DLC_ZH[a.dlc] || '未知',
      role: String(a.role || ''),
      status: unreleased ? 'unreleased' : 'released',
      statusZh: unreleased ? '未实装' : '',
      trait,
      perksRaw: Array.isArray(a.perks) ? a.perks : [],
      perkIds: normPerkIds(a.perks),
      raw: a,
    };
  });
  const archetypeById = new Map(archetypes.map((a) => [a.id, a]));
  /** 可选职业（未实装的不进选择器，但保留数据用于展示） */
  const selectableArchetypes = archetypes.filter((a) => a.status !== 'unreleased');
  const archetypeByEn = new Map(archetypes.map((a) => [a.en, a]));
  const findArchetype = (id) => archetypeById.get(id) || archetypeByEn.get(id) || null;
  /** 该职业里「已收录的防御向专长」id（交集 engine.modifiers.perks） */
  const perksOf = (archetypeId) => {
    const a = findArchetype(archetypeId);
    if (!a) return [];
    return a.perkIds.filter((pid) => engine.modById.has(pid));
  };

  /* ------------------------- 身份解析（唯一实现） ------------------------- */
  // 解析顺序：items.json → archetypes.json → site_data.pieces（护甲件兜底）。
  // saved / replace / workbench 一律调用这两个方法，不再各自拼。
  const nameOf = (id) => {
    if (!id) return '';
    const it = itemsById.get(id);
    if (it) return it.zh;
    const a = findArchetype(id);
    if (a) return a.zh;
    const p = pieceById.get(id);
    return p ? (p.zh || id) : id;
  };
  const iconOf = (id) => {
    const it = itemsById.get(id);
    const iconUrl = it ? itemIcon(it) : null;
    if (iconUrl) return iconUrl;
    const p = pieceById.get(id);
    return p && p.iconUrl ? p.iconUrl : null;
  };

  /* 各槽位可选池 */
  const byFamily = (fam) => itemList.filter((it) => it.family === fam);
  const slotPools = {
    longGun: byFamily('longGun'),
    handGun: byFamily('handGun'),
    melee: byFamily('melee'),
    head: engine.pieces.filter((p) => p.slot === 'head').map((p) => p.item).filter(Boolean),
    body: engine.pieces.filter((p) => p.slot === 'body').map((p) => p.item).filter(Boolean),
    legs: engine.pieces.filter((p) => p.slot === 'legs').map((p) => p.item).filter(Boolean),
    gloves: engine.pieces.filter((p) => p.slot === 'gloves').map((p) => p.item).filter(Boolean),
    amulet: byFamily('amulet'),
    ring1: byFamily('ring'), ring2: byFamily('ring'), ring3: byFamily('ring'), ring4: byFamily('ring'),
    relic: byFamily('relic'),
  };

  return {
    engine,
    site,
    gear,
    meta: site.meta || {},
    itemsById,
    itemIcon,
    itemOf: (id) => itemsById.get(id) || null,
    pieceById,
    armorById: pieceById,
    slotPools,
    archetypes,
    selectableArchetypes,
    archetypeById,
    archetypeByEn,
    archetypesEmpty: archetypes.length === 0,
    findArchetype,
    perksOf,
    /** 统一身份解析：id → 中文名（空 id 返回空串；未知 id 原样返回） */
    nameOf,
    /** 统一图标解析：id → 图标 URL（无图标返回 null） */
    iconOf,
    /** 槽位里的职业 */
    archetypeOfSlot(slot, slots) {
      const id = slots ? slots[slot] : null;
      return id ? findArchetype(id) : null;
    },
    isArmor: (id) => pieceById.has(id),
    isArchetype: (id) => archetypeById.has(id),
  };
}

export default loadLabModel;
