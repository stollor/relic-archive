/* =============================================================================
   遗迹2 · 遗物档案 — api.js
   唯一数据入口：加载 ./data/*.json（相对站点根，根路径/子路径部署通用）、规范化、缓存、派生（套装/分类/搜索索引）。
   视图禁止直接 fetch；一律 api.xxx()。
   ========================================================================== */

import { stripTags } from './dom.js';

const URLS = {
  items: './data/items.json',
  icons: './data/icon_index.json',
  site: './data/site_data.json',
  terms: './data/terms.json',
  acq: './data/acq.json',
  codex: './data/codex/index.json',
  archetypes: './data/archetypes.json',
  effects: './data/item_effects.json',
  builds: './data/builds.json',
  labGear: './data/lab_gear.json',
};

/* 数据侧 slot → 全站槽位族 */
const SLOT_FAMILY = {
  head: 'head', body: 'body', legs: 'legs', gloves: 'gloves',
  long_gun: 'longGun', hand_gun: 'handGun', melee_weapon: 'melee',
  ring: 'ring', amulet: 'amulet', relic: 'relic',
  mod: 'mod', trait: 'trait', perk: 'perk', skill: 'skill',
  consumable: 'consumable', gem: 'gem', meta_gem: 'metagem',
  engram: 'archetype', material: 'material', other: 'other', action: 'action',
};
const TYPE_FAMILY = {
  ItemType_Helmet: 'head', ItemType_Body: 'body', ItemType_Legs: 'legs', ItemType_Gloves: 'gloves',
  ItemType_LongGun: 'longGun', ItemType_HandGun: 'handGun', ItemType_Melee: 'melee',
  ItemType_Ring: 'ring', ItemType_Amulet: 'amulet', ItemType_Relic: 'relic',
  ItemType_DragonHeart: 'relic', ItemType_HiddenContainer: 'relic',
  ItemType_RangedWeaponMod: 'mod', ItemType_Consumable: 'consumable',
  ItemType_Gem_Melee: 'gem', ItemType_Gem_Ranged: 'gem',
  ItemType_MetaGem_Melee: 'metagem', ItemType_MetaGem_Ranged: 'metagem',
  TraitType_Character: 'trait', TraitType_Perk: 'perk',
};

export const RES_KEYS = ['bleed', 'fire', 'shock', 'corrosive', 'blight'];
const RES_FIELDS = {
  bleed: 'bleed_resistance', fire: 'fire_resistance', shock: 'shock_resistance',
  corrosive: 'acid_resistance', blight: 'blight_resistance',
};

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const str = (v) => (typeof v === 'string' ? v : '');
const firstText = (...vals) => { for (const v of vals) { const s = str(v).trim(); if (s) return s; } return ''; };
const lang = (o, k) => (o && typeof o === 'object' ? str(o[k]) : '');

/* ----------------------------- 规范化 ----------------------------- */
function normalizeItem(raw, order) {
  if (!raw || typeof raw !== 'object') return null;
  const display = raw.display || {};
  const text = raw.text || {};
  const effect = raw.effect || null;
  const setField = raw.set || null;
  const sf = raw.stats_flat || null;
  const baseValues = (raw.base_stats && raw.base_stats.values) || {};
  const numbers = raw.numbers || {};
  const cat = str(raw.cat) || 'unknown';
  const slotRaw = str(raw.slot);
  const typeId = str((raw.type || {}).id);
  const family = SLOT_FAMILY[slotRaw] || TYPE_FAMILY[typeId] || 'other';
  const pkg = str(raw.pkg);

  const zh = firstText(display.name_zh, raw.zh_name, lang(text.label, 'zh'));
  const en = firstText(display.name_en, raw.label_en, lang(text.label, 'en'));

  /* 抗性 / 护甲 / 负重 / 武器数值 */
  const resist = {};
  for (const k of RES_KEYS) resist[k] = isNum(sf && sf[RES_FIELDS[k]]) ? sf[RES_FIELDS[k]] : 0;
  const resistSum = isNum(sf && sf.resistance_sum) ? sf.resistance_sum : RES_KEYS.reduce((s, k) => s + resist[k], 0);

  const dlcMatch = pkg.match(/World_DLC(\d)/);
  const rec = {
    id: str(raw.id) || `item-${order}`,
    order,
    cat,
    family,
    slotRaw,
    typeId,
    pkg,
    isItem: raw.is_item === true,
    kind: str(raw.kind),
    zh: zh || en || str(raw.id),
    en: en || zh,
    subtitle: firstText(display.subtitle_zh, display.subtitle_en, raw.sublabel_en),
    descZh: firstText(lang(text.description, 'zh'), lang(text.description, 'zh_hant'), raw.description_zh),
    descEn: firstText(lang(text.description, 'en'), raw.description_en),
    flavorZh: firstText(lang(text.flavor, 'zh'), lang(text.flavor, 'zh_hant'), raw.flavor_text_zh),
    flavorEn: firstText(lang(text.flavor, 'en'), raw.flavor_text_en),
    effect,
    effectLines: Array.isArray(effect && effect.lines) ? effect.lines : [],
    summaryZh: str(effect && effect.summary_zh),
    summaryEn: str(effect && effect.summary_en),
    effectSource: str(effect && effect.source),
    setField,
    setKey: str(setField && setField.key),
    setName: firstText(setField && setField.name_zh, setField && setField.name_en),
    iconAsset: str(raw.icon_asset),
    confidence: str((raw.flags || {}).confidence) || 'low',
    decode: str(raw.decode_status),
    numbers,
    statsFlat: sf,
    baseStats: raw.base_stats || null,
    weaponProfile: raw.weapon_profile || null,
    tags: [...new Set([...(raw.tags || []), ...(raw.filter_tags || [])].map(str).filter(Boolean))],
    filterTags: (raw.filter_tags || []).map(str),
    dlc: dlcMatch ? Number(dlcMatch[1]) : 0,
    unique: raw.unique === true,
    stack: isNum(raw.max_stack_count) ? raw.max_stack_count : null,
    source: raw.source || {},
    /* 常用数值 */
    armor: isNum(sf && sf.armor) ? sf.armor : (isNum(baseValues.Armor) ? baseValues.Armor : null),
    weight: isNum(sf && sf.encumbrance) ? sf.encumbrance : (isNum(baseValues.Encumbrance) ? baseValues.Encumbrance : null),
    value: isNum(sf && sf.value) ? sf.value : null,
    resist,
    resistSum,
    damage: isNum(sf && sf.damage) ? sf.damage : (isNum(baseValues.Damage) ? baseValues.Damage : null),
    rate: isNum(sf && sf.rate_of_fire) ? sf.rate_of_fire
      : (isNum(baseValues.RateOfFire) ? baseValues.RateOfFire
        : (isNum(sf && sf.attack_speed) ? sf.attack_speed : (isNum(baseValues.AttackSpeed) ? baseValues.AttackSpeed : null))),
    crit: isNum(sf && sf.crit_chance) ? sf.crit_chance : (isNum(baseValues.CritChance) ? baseValues.CritChance : null),
    weakspot: isNum(numbers.WeakSpotDamageMod) ? numbers.WeakSpotDamageMod
      : (isNum(sf && sf.weak_spot_damage_mod) ? sf.weak_spot_damage_mod
        : (isNum(baseValues.WeakSpotDamageMod) ? baseValues.WeakSpotDamageMod : null)),
    maxAmmo: isNum(sf && sf.max_ammo) ? sf.max_ammo : (isNum(baseValues.MaxAmmo) ? baseValues.MaxAmmo : null),
    ammoPerClip: isNum(sf && sf.ammo_per_clip) ? sf.ammo_per_clip
      : (isNum(baseValues.AmmoPerClip) ? baseValues.AmmoPerClip : null),
    impact: isNum(sf && sf.impact_scalar) ? sf.impact_scalar
      : (isNum(baseValues.ImpactScalar) ? baseValues.ImpactScalar : null),
    range: isNum(sf && sf.range) ? sf.range : (isNum(baseValues.Range) ? baseValues.Range : null),
    spread: isNum(sf && sf.spread) ? sf.spread : (isNum(baseValues.Spread) ? baseValues.Spread : null),
    procChance: isNum(sf && sf.proc_chance) ? sf.proc_chance
      : (isNum(baseValues.ProcChance) ? baseValues.ProcChance : null),
    isAutomatic: sf && sf.is_automatic != null ? !!sf.is_automatic
      : (baseValues.IsAutomatic != null ? !!baseValues.IsAutomatic : null),
    maxLevel: isNum(numbers.MaxLevel) ? numbers.MaxLevel : null,
    raw,
  };
  /* 中文效果文本兜底（effect.lines 的 display_zh） */
  if (!rec.summaryZh && rec.effectLines.length) {
    const parts = rec.effectLines.map((l) => str(l && l.display_zh)).filter(Boolean);
    rec.summaryZh = parts.join('；');
  }
  /* 官方文本里带 <span color=...> 标记：统一去标签，避免样式污染 */
  /* 官方中文里有个别未解析的占位符（如「使  米范围内」），统一成可读表述 */
  rec.descZh = stripTags(rec.descZh)
    .replace(/使\s*米范围内/g, '使一定范围内的')
    .replace(/\s{2,}/g, ' ');
  rec.descEn = stripTags(rec.descEn);
  rec.flavorZh = stripTags(rec.flavorZh);
  rec.flavorEn = stripTags(rec.flavorEn);
  rec.summaryZh = stripTags(rec.summaryZh);
  rec.summaryEn = stripTags(rec.summaryEn);
  rec.haystack = [
    rec.zh, rec.en, rec.subtitle, rec.summaryZh, rec.summaryEn,
    rec.descZh, rec.descEn, rec.flavorZh, rec.flavorEn, rec.id,
    rec.tags.join(' '), rec.setName,
  ].join(' ').toLowerCase();
  return rec;
}

/* ----------------------------- 图标 ----------------------------- */
function buildIconMap(index) {
  const map = new Map();
  const icons = (index && index.icons) || {};
  for (const [key, val] of Object.entries(icons)) {
    if (!val || !val.file) continue;
    map.set(key.toLowerCase(), `./assets/${val.file}`);
    if (val.stem) map.set(`stem:${String(val.stem).toLowerCase()}`, `./assets/${val.file}`);
  }
  return map;
}
function iconUrlOf(item, iconMap) {
  if (!item || !item.iconAsset) return null;
  const key = item.iconAsset.toLowerCase();
  return iconMap.get(key) || iconMap.get(`stem:${key}`) || null;
}

/* ----------------------------- 套装派生 ----------------------------- */
function buildSets(items) {
  const byKey = new Map();
  for (const it of items) {
    if (!it.isItem || !it.setKey) continue;
    if (!byKey.has(it.setKey)) {
      byKey.set(it.setKey, {
        key: it.setKey,
        name: it.setName || it.setKey,
        parts: [],
        totals: (it.setField && it.setField.totals) || null,
        complete: !!(it.setField && it.setField.complete),
        slotCount: (it.setField && it.setField.slot_count) || 0,
      });
    }
    byKey.get(it.setKey).parts.push(it);
  }
  const ORDER = { head: 0, body: 1, legs: 2, gloves: 3 };
  const sets = [...byKey.values()];
  for (const s of sets) {
    s.parts.sort((a, b) => (ORDER[a.family] ?? 9) - (ORDER[b.family] ?? 9));
    if (!s.totals) {
      s.totals = {
        armor: s.parts.reduce((n, p) => n + (p.armor || 0), 0),
        encumbrance: s.parts.reduce((n, p) => n + (p.weight || 0), 0),
        resistance_sum: s.parts.reduce((n, p) => n + (p.resistSum || 0), 0),
      };
    }
    s.partCount = s.parts.length;
    s.complete = s.partCount >= 4;
    s.nameEn = (s.parts.find((p) => p.en) || {}).en || '';
  }
  sets.sort((a, b) => (b.complete - a.complete) || ((b.totals?.armor || 0) - (a.totals?.armor || 0)));
  return sets;
}

/* ----------------------------- 加载器 ----------------------------- */
const cache = new Map();
async function loadJSON(url) {
  if (cache.has(url)) return cache.get(url);
  const p = fetch(url, { cache: 'no-cache' }).then(async (res) => {
    if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
    return res.json();
  });
  cache.set(url, p);
  p.catch(() => cache.delete(url));
  return p;
}

const S = {
  items: null, byId: new Map(), sets: null, iconMap: null, iconIndex: null,
  site: null, terms: null, acq: null, codex: null, archetypes: null, meta: null,
  effectMeta: null,
  builds: null, buildByKey: new Map(), buildEntityCache: new Map(),
  labGear: null,
};

async function loadItems() {
  if (S.items) return S.items;
  const [data, effects] = await Promise.all([
    loadJSON(URLS.items),
    loadJSON(URLS.effects).catch((e) => { console.warn('[api] 效果原文不可用', e); return null; }),
  ]);
  const eff = (effects && effects.items) || {};
  S.effectMeta = (effects && effects.meta) || null;
  S.meta = (Array.isArray(data) ? null : data.meta) || null;
  const rawList = Array.isArray(data) ? data : (data.items || []);
  const items = [];
  for (let i = 0; i < rawList.length; i += 1) {
    const rec = normalizeItem(rawList[i], i);
    if (!rec) continue;
    /* 官方效果原文（游戏内「效果」句，不是风味描述） */
    const e = eff[rec.id];
    if (e && e.zh) {
      rec.effectZh = stripTags(String(e.zh)).trim();
      rec.effectEn = stripTags(String(e.en || '')).trim();
      rec.effectSrc = str(e.src) || 'official';
      rec.effectMatch = str(e.match);
      if (rec.effectZh) rec.haystack += ' ' + rec.effectZh.toLowerCase();
    } else {
      rec.effectZh = '';
      rec.effectEn = '';
      rec.effectSrc = '';
      rec.effectMatch = '';
    }
    items.push(rec);
    S.byId.set(rec.id, rec);
  }
  S.items = items;
  return items;
}

/* ----------------------------- 流派（配装推荐） ----------------------------- */
/** 去掉「（wiki-only …）」这类来源后缀，保留可解析的实体名 */
function buildRefBase(ref) {
  return String(ref == null ? '' : ref).replace(/\s*\([^)]*\)\s*$/, '').trim();
}

function buildItemEntity(raw, item, extraZh) {
  return {
    key: raw,
    id: item.id,
    kind: 'item',                 // 可点开全站统一详情
    zh: item.zh,
    en: item.en,
    effectZh: item.effectZh || extraZh || item.summaryZh || '',
    item,
    slot: '',
    typeZh: '',
  };
}

/**
 * 流派里的道具引用 → 展示实体（供视图渲染 chip / 文本行）。
 * 解析顺序：data/items.json 真实道具 → builds.json 的 items 摘要 → i18n 文本实体 → 原文兜底。
 * kind：item=真实道具（有图标、可开详情）；text=纯文本实体（碎片 / 棱镜传奇词条，无 id）；
 *       unknown=只有名字（数据里未收录中文名）。
 */
function resolveBuildEntity(raw) {
  const base = buildRefBase(raw);
  if (!base) return null;
  const data = S.builds || {};
  const items = data.items || {};
  const i18n = data.i18n || {};
  const extraZh = i18n[base] || i18n[raw] || '';
  const hit = (id) => S.byId.get(id) || null;
  const real = hit(raw) || hit(base);
  if (real) return buildItemEntity(raw, real, extraZh);

  const sum = items[base] || items[raw] || null;
  if (sum) {
    const sumReal = sum.id ? hit(sum.id) : null;
    if (sumReal) return buildItemEntity(raw, sumReal, extraZh);
    return {
      key: raw,
      id: null,
      kind: 'text',
      zh: firstText(sum.name_zh, base),
      en: str(sum.name_en),
      effectZh: firstText(sum.effect_zh, extraZh),
      item: null,
      slot: str(sum.slot),
      typeZh: str(sum.type_zh),
    };
  }
  if (extraZh) {
    return { key: raw, id: null, kind: 'text', zh: base, en: '', effectZh: extraZh, item: null, slot: '', typeZh: '' };
  }
  return { key: raw, id: null, kind: 'unknown', zh: base, en: '', effectZh: '', item: null, slot: '', typeZh: '' };
}

async function loadBuilds() {
  if (S.builds) return S.builds;
  const data = await loadJSON(URLS.builds);
  if (!data || !Array.isArray(data.builds)) throw new Error('data/builds.json 格式不正确');
  const builds = data.builds.slice().sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0));
  S.builds = { ...data, builds };
  S.buildByKey = new Map(builds.map((b) => [b.key, b]));
  S.buildEntityCache = new Map();
  return S.builds;
}

/* ----------------------------- 对外 API ----------------------------- */
export const api = {
  /** 全部道具（含非道具资产；视图用 items() 自行 filter isItem） */
  async items() { return loadItems(); },

  /** 只含可浏览道具（1126 条） */
  async itemList() { return (await loadItems()).filter((it) => it.isItem); },

  item(id) { return S.byId.get(id) || null; },

  /** items.json 的 meta（schema 版本 / 生成时间 / counts） */
  meta() { return S.meta || {}; },

  /** 已载入的规范化 item 数组（同步；未载入返回空数组） */
  itemsSync() { return S.items || []; },

  async sets() {
    if (S.sets) return S.sets;
    S.sets = buildSets(await loadItems());
    return S.sets;
  },

  async icons() {
    if (S.iconIndex) return S.iconIndex;
    try {
      S.iconIndex = await loadJSON(URLS.icons);
      S.iconMap = buildIconMap(S.iconIndex);
    } catch (e) {
      console.warn('[api] 图标索引不可用', e);
      S.iconIndex = { icons: {} };
      S.iconMap = new Map();
    }
    return S.iconIndex;
  },

  iconUrl(item) { return iconUrlOf(item, S.iconMap || new Map()); },

  /** 确保图标索引已载入（视图首屏渲染前调用一次） */
  async ready() {
    await Promise.all([loadItems(), api.icons()]);
    return true;
  },

  async site() {
    if (!S.site) S.site = await loadJSON(URLS.site);
    return S.site;
  },

  async terms() {
    if (!S.terms) S.terms = await loadJSON(URLS.terms).catch(() => null);
    return S.terms;
  },

  async acq() {
    if (S.acq === null) {
      S.acq = await loadJSON(URLS.acq).catch(() => ({}));
    }
    return S.acq;
  },

  /** 职业表（data/archetypes.json）：{archetypes:[{id,en,zh,dlc,role,perks,trait,...}]} */
  async archetypes() {
    if (!S.archetypes) {
      S.archetypes = await loadJSON(URLS.archetypes).catch(() => ({ archetypes: [] }));
      if (!Array.isArray(S.archetypes.archetypes)) S.archetypes.archetypes = [];
    }
    return S.archetypes;
  },

  /** 同步版本（未载入返回空数组） */
  archetypesSync() { return (S.archetypes && S.archetypes.archetypes) || []; },

  archetype(id) {
    return ((S.archetypes && S.archetypes.archetypes) || []).find((a) => a.id === id) || null;
  },

  /** 按英文职业名找（site_data.modifiers.perks[].archetype 用的就是英文名） */
  archetypeByEn(en) {
    if (!en) return null;
    const list = (S.archetypes && S.archetypes.archetypes) || [];
    return list.find((a) => a.en === en || a.id === en) || null;
  },

  async codex() {
    if (!S.codex) S.codex = await loadJSON(URLS.codex);
    return S.codex;
  },

  /* --- 流派（配装推荐） --- */
  /** data/builds.json（懒加载 + 缓存；builds 已按 order 升序） */
  async builds() { return loadBuilds(); },

  /** 同步：已载入的 builds 数据（未载入返回 null） */
  buildData() { return S.builds; },

  /** 按 key 取一套流派（未载入 / 不存在返回 null） */
  build(key) { return S.buildByKey.get(String(key == null ? '' : key)) || null; },

  /** 流派里的道具 / 文本实体（解析结果按引用字符串缓存） */
  buildEntity(ref) {
    const raw = String(ref == null ? '' : ref);
    if (!raw) return null;
    if (S.buildEntityCache.has(raw)) return S.buildEntityCache.get(raw);
    const ent = resolveBuildEntity(raw);
    if (S.builds) S.buildEntityCache.set(raw, ent);
    return ent;
  },

  /* --- 实验室 v2：装备目录（维度/流派/全量饰品与挂件） --- */
  /**
   * data/lab_gear.json（schema 1）：由工作区 build/mk_lab_gear.py 生成。
   * 结构见 docs/LAB_V2.md §1；失败时抛错，由实验室显示「数据载入失败」可重试态。
   */
  async labGear() {
    if (!S.labGear) {
      const doc = await loadJSON(URLS.labGear);
      if (!doc || typeof doc !== 'object' || !doc.gear) throw new Error('data/lab_gear.json 格式不正确');
      S.labGear = doc;
    }
    return S.labGear;
  },

  /** 同步：已载入的实验室装备目录（未载入返回 null） */
  labGearSync() { return S.labGear; },

  /** 全站计数（顶栏展示） */
  async stats() {
    const items = await loadItems();
    const real = items.filter((i) => i.isItem);
    return {
      total: items.length,
      items: real.length,
      assets: items.length - real.length,
      categories: new Set(real.map((i) => i.cat)).size,
    };
  },
};

export default api;
