/* =============================================================================
   遗迹2 · 遗物档案 — lab/model.js（v2）
   实验室数据装配层：api.site() + api.itemList() + api.archetypes() → 引擎 / 图标 / 职业表。
   视图只从这里拿数据，不直接 fetch。
   ========================================================================== */
import { api } from '../core/api.js';
import { createEngine } from './engine.js';

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

/** 槽位中文名（与 UX_SPEC §5 一致） */
export const SLOT_LABEL = {
  longGun: '长枪', handGun: '手枪', melee: '近战武器',
  head: '头盔', body: '胸甲', legs: '腿甲', gloves: '手甲',
  amulet: '项链', ring1: '戒指 1', ring2: '戒指 2', ring3: '戒指 3', ring4: '戒指 4',
  relic: '圣物', archetype1: '主职业', archetype2: '副职业',
};

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

/**
 * 载入实验室模型。
 * @returns {Promise<{engine, itemsById, slotPools, archetypes, archetypeById, perksOf}>}
 */
export async function loadLabModel() {
  const [site, itemList, archDoc] = await Promise.all([
    api.site(),
    api.itemList(),
    api.archetypes ? api.archetypes().catch(() => ({ archetypes: [] })) : Promise.resolve({ archetypes: [] }),
  ]);
  await api.icons().catch(() => null);
  const engine = createEngine(site);

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
