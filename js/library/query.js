/* =============================================================================
   遗迹2 · 遗物档案 — library/query.js
   资料库的查询层：URL 状态 ⇄ 筛选 / 排序 / 计数（纯函数，不碰 DOM / 存储 / 网络）。
   与 store / api 的耦合通过 deps 注入：{ isOwned(id), isFav(id), hasIcon(item) }，
   视图传入真实实现，qa 用例传假实现即可独立验证筛选口径。
   ========================================================================== */
import { cmpText } from '../core/dom.js';
import {
  CAT_BY_ID, CONF, GAME_TAG_BY_ID, GAME_TAGS,
} from '../core/labels.js';

/* ------------------------------- 状态 schema ------------------------------- */

/** 游戏内效果标签 / 可信度 / 资料片：URL 只接受已知值（与 data/terms.json 对齐） */
const TAG_IDS = new Set(GAME_TAGS.map((t) => t.id));
const CONF_IDS = new Set(Object.keys(CONF));
const DLC_IDS = new Set(['0', '1', '2', '3']);

export function defaultState() {
  return {
    q: '', cat: 'all', sort: 'default', view: 'grid',
    owned: false, fav: false,
    tags: [], confs: [], dlcs: [],
    set: '', icon: false, stats: false,
    metric: 'armor', min: '', max: '', assets: false,
  };
}

/* 把 URLSearchParams 解析成状态（只接受已知值，防止脏参数） */
export function parseState(qp) {
  const s = defaultState();
  if (!qp) return s;
  const listOf = (key, valid) => (qp.get(key) || '').split(',')
    .map((x) => x.trim()).filter((x) => x && (!valid || valid.has(x)));
  const q = (qp.get('q') || '').trim();
  if (q) s.q = q.slice(0, 120);
  const cat = qp.get('cat');
  if (cat && CAT_BY_ID.has(cat)) s.cat = cat;
  const sort = qp.get('sort');
  if (sort && isValidSort(s.cat, sort)) s.sort = sort;
  const view = qp.get('view');
  if (view === 'list' || view === 'grid') s.view = view;
  s.owned = qp.get('owned') === '1';
  s.fav = qp.get('fav') === '1';
  // 旧链接的 family=… 参数忽略（类型已由顶部 chip 覆盖）
  s.tags = listOf('tag', TAG_IDS);
  s.confs = listOf('conf', CONF_IDS);
  s.dlcs = listOf('dlc', DLC_IDS);
  const set = qp.get('set');
  if (set) s.set = set;
  s.icon = qp.get('icon') === '1';
  s.stats = qp.get('stats') === '1';
  s.assets = qp.get('assets') === '1';
  const metric = qp.get('metric');
  if (metric && METRIC_BY_ID.has(metric)) s.metric = metric;
  const min = qp.get('min'); const max = qp.get('max');
  if (min != null && min !== '' && Number.isFinite(Number(min))) s.min = String(Number(min));
  if (max != null && max !== '' && Number.isFinite(Number(max))) s.max = String(Number(max));
  return s;
}

/* 状态 → URL 查询串（默认值不写，保持旧链接语义） */
export function serialize(s) {
  const q = new URLSearchParams();
  if (s.q) q.set('q', s.q);
  if (s.cat !== 'all') q.set('cat', s.cat);
  if (s.sort !== 'default') q.set('sort', s.sort);
  if (s.view !== 'grid') q.set('view', s.view);
  if (s.owned) q.set('owned', '1');
  if (s.fav) q.set('fav', '1');
  if (s.tags.length) q.set('tag', s.tags.join(','));
  if (s.confs.length) q.set('conf', s.confs.join(','));
  if (s.dlcs.length) q.set('dlc', s.dlcs.join(','));
  if (s.set) q.set('set', s.set);
  if (s.icon) q.set('icon', '1');
  if (s.stats) q.set('stats', '1');
  if (s.assets) q.set('assets', '1');
  if (s.min !== '' || s.max !== '') {
    q.set('metric', s.metric);
    if (s.min !== '') q.set('min', s.min);
    if (s.max !== '') q.set('max', s.max);
  }
  return q.toString();
}

export function stateKey(s) { return serialize(s); }

/** 是否有任何「非默认」筛选（决定重置按钮可用态 / 筛选按钮高亮 / pills 显隐） */
export function isActive(s) {
  return !!(s.q || s.cat !== 'all' || s.owned || s.fav
    || s.tags.length || s.confs.length || s.dlcs.length || s.set
    || s.icon || s.stats || s.assets || s.min !== '' || s.max !== '');
}

/* ------------------------------- 排序 ------------------------------- */

/* 排序项按分类动态生成（task-13）；id 即 URL 的 sort 短值 */
export const TRINKET_CATS = new Set(['ring', 'amulet', 'relic']);
export const SORT_DEFS = {
  default: [['default', '默认'], ['name', '名称'], ['dlc', '资料片'], ['order', '新增']],
  weapon: [
    ['default', '默认'], ['damage', '伤害 ↓'], ['rate', '射速 ↓'], ['mag', '弹匣容量 ↓'],
    ['maxammo', '弹药上限 ↓'], ['crit', '暴击率 ↓'], ['weakspot', '弱点伤害 ↓'], ['name', '名称'],
  ],
  armor: [['default', '默认'], ['armor', '护甲值 ↓'], ['weight', '负重 ↓'], ['resist', '抗性合计 ↓'], ['name', '名称']],
  trinket: [['default', '默认'], ['value', '价值 ↓'], ['name', '名称'], ['dlc', '资料片']],
};
export const NUM_SORT = {
  damage: (x) => x.damage,
  rate: (x) => x.rate,
  mag: (x) => x.ammoPerClip,
  maxammo: (x) => x.maxAmmo,
  crit: (x) => x.crit,
  weakspot: (x) => x.weakspot,
  armor: (x) => x.armor,
  weight: (x) => x.weight,
  resist: (x) => x.resistSum,
  value: (x) => x.value,
};

export const METRICS = [
  ['armor', '护甲值', 'Armor'], ['weight', '负重', 'Encumbrance'],
  ['damage', '伤害', 'Damage'], ['rate', '射速', 'RateOfFire'],
];
export const METRIC_BY_ID = new Map(METRICS.map(([id, zh, key]) => [id, { id, zh, key }]));

export function sortGroupForCat(cat) {
  if (cat === 'weapon') return 'weapon';
  if (cat === 'armor') return 'armor';
  if (TRINKET_CATS.has(cat)) return 'trinket';
  return 'default';
}
export function sortOptionsForCat(cat) { return SORT_DEFS[sortGroupForCat(cat)]; }
export function isValidSort(cat, sort) { return sortOptionsForCat(cat).some(([id]) => id === sort); }

/* 当前分类池里某项数值是否真的存在：没有数据的排序项不显示（避免「价值↓」这种测不出效果的选项） */
function poolForSort(cat, assets, items) {
  return (items || []).filter((it) => (assets || it.isItem) && (cat === 'all' || it.cat === cat));
}

/* 缓存按 items 数组身份隔离：不同数据快照（或 qa 用假数据）不会互相污染 */
const availSortCache = new WeakMap();

/** 当前数据下可用的排序项集合（无数据的数值排序项被隐藏） */
export function availableSortIds(cat, assets, items) {
  const arr = items || [];
  let cache = availSortCache.get(arr);
  if (!cache) { cache = new Map(); availSortCache.set(arr, cache); }
  const key = `${cat}|${assets ? 1 : 0}`;
  if (cache.has(key)) return cache.get(key);
  const ids = new Set();
  const pool = poolForSort(cat, assets, arr);
  for (const [id] of SORT_DEFS[sortGroupForCat(cat)]) {
    const get = NUM_SORT[id];
    if (!get) { ids.add(id); continue; }
    if (pool.some((it) => typeof get(it) === 'number')) ids.add(id);
  }
  cache.set(key, ids);
  return ids;
}

/** 把 state.sort 收敛到当前数据可用的排序项（URL 里带了不存在的数据排序时回默认） */
export function normalizeSort(target, items) {
  if (!availableSortIds(target.cat, target.assets, items).has(target.sort)) target.sort = 'default';
}

function compareNum(a, b, getter) {
  const av = getter(a); const bv = getter(b);
  const an = typeof av === 'number'; const bn = typeof bv === 'number';
  if (an && bn) return bv - av;
  if (an) return -1;
  if (bn) return 1;
  return 0;
}

/**
 * 就地排序并返回同一数组。
 * @param {object[]} arr       结果行
 * @param {object} state       当前状态（用 sort）
 * @param {Set<string>} availIds  可用排序项（availableSortIds 的结果）
 */
export function sortList(arr, state, availIds) {
  const sort = availIds.has(state.sort) ? state.sort : 'default';
  if (sort === 'name') {
    arr.sort((a, b) => cmpText(a.zh, b.zh));
  } else if (sort === 'dlc') {
    arr.sort((a, b) => (a.dlc - b.dlc) || cmpText(a.zh, b.zh));
  } else if (sort === 'order') {
    arr.sort((a, b) => (b.order - a.order) || cmpText(a.zh, b.zh));
  } else {
    const get = NUM_SORT[sort];
    if (get) arr.sort((a, b) => compareNum(a, b, get) || cmpText(a.zh, b.zh));
    else arr.sort((a, b) => a.order - b.order);
  }
  return arr;
}

/* ------------------------------- 过滤 ------------------------------- */

export function hasStatValue(it) {
  return [it.armor, it.weight, it.damage, it.rate, it.crit, it.weakspot, it.maxLevel]
    .some((v) => typeof v === 'number') || (it.resistSum || 0) !== 0;
}
export function metricValue(it, metric) {
  switch (metric) {
    case 'armor': return it.armor;
    case 'weight': return it.weight;
    case 'damage': return it.damage;
    case 'rate': return it.rate;
    default: return null;
  }
}

/** 关键词分词（搜索框空格分词，大小写不敏感；空串 → 空数组） */
export function keywords(q) {
  return q ? q.toLowerCase().split(/\s+/).filter(Boolean) : [];
}

function kwMatchItem(it, kws) {
  for (const kw of kws) {
    if (String(it.haystack || '').includes(kw)) continue;
    let hit = false;
    for (const tag of it.filterTags || []) {
      const meta = GAME_TAG_BY_ID.get(tag);
      if (meta && meta.zh.includes(kw)) { hit = true; break; }
    }
    if (!hit) return false;
  }
  return true;
}

/**
 * 单项是否命中当前筛选。
 * @param {object} it
 * @param {object} state
 * @param {{isOwned?:Function,isFav?:Function,hasIcon?:Function}} deps
 * @param {{skipCat?:boolean,kws?:string[]}} opts  skipCat=true 只算分类外的条件（用于分类计数）
 */
export function matches(it, state, deps = {}, opts = {}) {
  const { skipCat = false, kws = keywords(state.q) } = opts;
  if (!state.assets && !it.isItem) return false;
  if (!skipCat && state.cat !== 'all' && it.cat !== state.cat) return false;
  if (state.owned && !(deps.isOwned && deps.isOwned(it.id))) return false;
  if (state.fav && !(deps.isFav && deps.isFav(it.id))) return false;
  if (state.tags.length) {
    const own = it.filterTags || [];
    if (!state.tags.some((t) => own.includes(t) || (it.tags || []).includes(t))) return false;
  }
  if (state.confs.length && !state.confs.includes(it.confidence)) return false;
  if (state.dlcs.length && !state.dlcs.includes(String(it.dlc))) return false;
  if (state.set && it.setKey !== state.set) return false;
  if (state.icon && !(deps.hasIcon && deps.hasIcon(it))) return false;
  if (state.stats && !hasStatValue(it)) return false;
  if (state.min !== '' || state.max !== '') {
    const v = metricValue(it, state.metric);
    if (typeof v !== 'number') return false;
    if (state.min !== '' && v < Number(state.min)) return false;
    if (state.max !== '' && v > Number(state.max)) return false;
  }
  if (kws.length && !kwMatchItem(it, kws)) return false;
  return true;
}

/**
 * 分类计数（侧栏 chip 上的数字）：分类维度被跳过（skipCat），其余筛选照常生效。
 * @returns {Map<string,number>}  key 为 cat，'all' 为总数
 */
export function counts({ items, state, deps = {} }) {
  const out = new Map();
  const kws = keywords(state.q);
  let base = 0;
  for (const it of (items || [])) {
    if (!matches(it, state, deps, { skipCat: true, kws })) continue;
    base += 1;
    if (it.cat) out.set(it.cat, (out.get(it.cat) || 0) + 1);
  }
  out.set('all', base);
  return out;
}

/**
 * 当前筛选的完整结果。
 * @param {{items:object[],state:object,deps?:object}} p
 * @returns {{counts:Map<string,number>, list:object[]}}
 */
export function computeAll({ items, state, deps = {} }) {
  if (!items) return { counts: new Map([['all', 0]]), list: [] };
  const pool = state.assets ? items : items.filter((it) => it.isItem);
  const kws = keywords(state.q);
  const cnt = counts({ items: pool, state, deps });
  const out = [];
  for (const it of pool) {
    if (state.cat !== 'all' && it.cat !== state.cat) continue;
    if (!matches(it, state, deps, { kws })) continue;
    out.push(it);
  }
  sortList(out, state, availableSortIds(state.cat, state.assets, items));
  return { counts: cnt, list: out };
}

/* ------------------------------- 套装检索 ------------------------------- */

function setHaystack(s) {
  return `${s.name} ${s.nameEn} ${s.parts.map((p) => `${p.zh} ${p.en}`).join(' ')}`.toLowerCase();
}

/**
 * 套装列表（套装页只有关键词过滤，排序走 api 的完整度/护甲值默认序）。
 * @param {{sets:object[],keywords?:string[]}} p
 */
export function computeSets({ sets, keywords: kws = [] }) {
  const out = [];
  for (const s of (sets || [])) {
    if (kws.length) {
      const hay = setHaystack(s);
      if (!kws.every((kw) => hay.includes(kw))) continue;
    }
    out.push(s);
  }
  return out;
}
