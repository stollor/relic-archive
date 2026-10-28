/* =============================================================================
   遗迹2 · 遗物档案 — views/library.js
   资料库领域：道具（默认）/ 套装。路由 #/items、#/items/sets、#/items/<itemId>
   视图契约：mount(rootEl, ctx) -> { onRoute(ctx), unmount() }
   只用 core API 与 §3 组件类；不直接 fetch / localStorage / 自建浮层。
   ========================================================================== */
import {
  h, clear, fmt, cmpText, copyText, downloadText,
} from '../core/dom.js';
import { icon } from '../core/icons.js';
import { api } from '../core/api.js';
import { store, ALL_SLOTS } from '../core/store.js';
import { ui } from '../core/ui.js';
import { router } from '../core/router.js';
import {
  CATS, CAT_BY_ID, FAMILY, CONF, DLC_ZH,
  GAME_TAGS, GAME_TAG_BY_ID, GAME_TAGS_BY_GROUP, TAG_GROUP_ZH,
} from '../core/labels.js';
import { itemCard, itemIconEl, effectPreview } from '../components/item-card.js';
import { openItemDetail } from '../components/item-detail.js';

/* ------------------------------- 常量 ------------------------------- */
const BATCH = 60;
const MODE_ITEMS = 'items';
const MODE_SETS = 'sets';

/* 游戏内效果标签（FilterTags）：中文/分组/图标/说明统一来自 core/labels.js */
const TAG_IDS = new Set(GAME_TAGS.map((t) => t.id));
const CONF_IDS = new Set(Object.keys(CONF));
const DLC_IDS = new Set(['0', '1', '2', '3']);

/* 排序项按分类动态生成（task-13）；id 即 URL 的 sort 短值 */
const TRINKET_CATS = new Set(['ring', 'amulet', 'relic']);
const SORT_DEFS = {
  default: [['default', '默认'], ['name', '名称'], ['dlc', '资料片'], ['order', '新增']],
  weapon: [
    ['default', '默认'], ['damage', '伤害 ↓'], ['rate', '射速 ↓'], ['mag', '弹匣容量 ↓'],
    ['maxammo', '弹药上限 ↓'], ['crit', '暴击率 ↓'], ['weakspot', '弱点伤害 ↓'], ['name', '名称'],
  ],
  armor: [['default', '默认'], ['armor', '护甲值 ↓'], ['weight', '负重 ↓'], ['resist', '抗性合计 ↓'], ['name', '名称']],
  trinket: [['default', '默认'], ['value', '价值 ↓'], ['name', '名称'], ['dlc', '资料片']],
};
const NUM_SORT = {
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
function sortGroupForCat(cat) {
  if (cat === 'weapon') return 'weapon';
  if (cat === 'armor') return 'armor';
  if (TRINKET_CATS.has(cat)) return 'trinket';
  return 'default';
}
function sortOptionsForCat(cat) { return SORT_DEFS[sortGroupForCat(cat)]; }
function isValidSort(cat, sort) { return sortOptionsForCat(cat).some(([id]) => id === sort); }

/* 当前分类池里某项数值是否真的存在：没有数据的排序项不显示（避免「价值↓」这种测不出效果的选项） */
function poolForSort(cat, assets) {
  return ITEMS.filter((it) => (assets || it.isItem) && (cat === 'all' || it.cat === cat));
}
const availSortCache = new Map();
function availableSortIds(cat, assets) {
  const key = `${cat}|${assets ? 1 : 0}`;
  if (availSortCache.has(key)) return availSortCache.get(key);
  const ids = new Set();
  const pool = poolForSort(cat, assets);
  for (const [id] of SORT_DEFS[sortGroupForCat(cat)]) {
    const get = NUM_SORT[id];
    if (!get) { ids.add(id); continue; }
    if (pool.some((it) => typeof get(it) === 'number')) ids.add(id);
  }
  availSortCache.set(key, ids);
  return ids;
}
function normalizeSortFor(target) {
  if (!availableSortIds(target.cat, target.assets).has(target.sort)) target.sort = 'default';
}
function normalizeSort() { normalizeSortFor(state); }

const METRICS = [
  ['armor', '护甲值', 'Armor'], ['weight', '负重', 'Encumbrance'],
  ['damage', '伤害', 'Damage'], ['rate', '射速', 'RateOfFire'],
];
const METRIC_BY_ID = new Map(METRICS.map(([id, zh, key]) => [id, { id, zh, key }]));

/* ------------------------------- 状态 ------------------------------- */
function defaultState() {
  return {
    q: '', cat: 'all', sort: 'default', view: 'grid',
    owned: false, fav: false,
    tags: [], confs: [], dlcs: [],
    set: '', icon: false, stats: false,
    metric: 'armor', min: '', max: '', assets: false,
  };
}

let ITEMS = null;          // 全部规范化条目（含非道具资产）
let SETS = null;           // api.sets()
let LOAD_PROMISE = null;
let MODE = MODE_ITEMS;
let state = defaultState();
let list = [];             // 当前结果（已排序）
let rendered = 0;
let io = null;
let detailOpenId = null;
let detailReturnPath = '/items';
let EL = null;             // DOM 引用与控件映射
let INSTANCE = 0;          // 视图实例代号：异步回调落地前校验「我还是当前实例」

/* 把 URLSearchParams 解析成状态（只接受已知值，防止脏参数） */
function parseState(qp) {
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

/* 状态 → URL 查询串 */
function serialize(s) {
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
function stateKey(s) { return serialize(s); }
function listPath() { return MODE === MODE_SETS ? '/items/sets' : '/items'; }

/* ------------------------------- 数据加载 ------------------------------- */
function load() {
  if (LOAD_PROMISE) return LOAD_PROMISE;
  LOAD_PROMISE = Promise.all([api.items(), api.sets()]).then(([items, sets]) => {
    ITEMS = items;
    SETS = sets;
    return { items, sets };
  });
  return LOAD_PROMISE;
}

/* ------------------------------- 过滤 ------------------------------- */
function hasStatValue(it) {
  return [it.armor, it.weight, it.damage, it.rate, it.crit, it.weakspot, it.maxLevel]
    .some((v) => typeof v === 'number') || (it.resistSum || 0) !== 0;
}
function metricValue(it, metric) {
  switch (metric) {
    case 'armor': return it.armor;
    case 'weight': return it.weight;
    case 'damage': return it.damage;
    case 'rate': return it.rate;
    default: return null;
  }
}
function keywords() {
  return state.q ? state.q.toLowerCase().split(/\s+/).filter(Boolean) : [];
}
function kwMatchItem(it, kws) {
  for (const kw of kws) {
    if (it.haystack.includes(kw)) continue;
    let hit = false;
    for (const tag of it.filterTags || []) {
      const meta = GAME_TAG_BY_ID.get(tag);
      if (meta && meta.zh.includes(kw)) { hit = true; break; }
    }
    if (!hit) return false;
  }
  return true;
}
function matches(it, kws, skipCat) {
  if (!state.assets && !it.isItem) return false;
  if (!skipCat && state.cat !== 'all' && it.cat !== state.cat) return false;
  if (state.owned && !store.isOwned(it.id)) return false;
  if (state.fav && !store.isFav(it.id)) return false;
  if (state.tags.length) {
    const own = it.filterTags || [];
    if (!state.tags.some((t) => own.includes(t) || (it.tags || []).includes(t))) return false;
  }
  if (state.confs.length && !state.confs.includes(it.confidence)) return false;
  if (state.dlcs.length && !state.dlcs.includes(String(it.dlc))) return false;
  if (state.set && it.setKey !== state.set) return false;
  if (state.icon && !api.iconUrl(it)) return false;
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

function compareNum(a, b, getter) {
  const av = getter(a); const bv = getter(b);
  const an = typeof av === 'number'; const bn = typeof bv === 'number';
  if (an && bn) return bv - av;
  if (an) return -1;
  if (bn) return 1;
  return 0;
}
function sortList(arr) {
  const sort = availableSortIds(state.cat, state.assets).has(state.sort) ? state.sort : 'default';
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

function computeAll() {
  const pool = state.assets ? ITEMS : ITEMS.filter((it) => it.isItem);
  const kws = keywords();
  const counts = new Map();
  let base = 0;
  for (const it of pool) {
    if (!matches(it, kws, true)) continue;
    base += 1;
    if (it.cat) counts.set(it.cat, (counts.get(it.cat) || 0) + 1);
  }
  counts.set('all', base);
  const out = [];
  for (const it of pool) {
    if (state.cat !== 'all' && it.cat !== state.cat) continue;
    if (!matches(it, kws, false)) continue;
    out.push(it);
  }
  sortList(out);
  return { counts, list: out };
}

/* 套装搜索/排序 */
function setKeys(s) { return `${s.name} ${s.nameEn} ${s.parts.map((p) => `${p.zh} ${p.en}`).join(' ')}`.toLowerCase(); }
function computeSets() {
  const kws = keywords();
  const out = [];
  for (const s of SETS || []) {
    if (kws.length) {
      const hay = setKeys(s);
      if (!kws.every((kw) => hay.includes(kw))) continue;
    }
    out.push(s);
  }
  return out;
}

/* ------------------------------- 小工具 ------------------------------- */
function deferTitle(t) {
  const mine = INSTANCE;
  queueMicrotask(() => { if (mine === INSTANCE && EL) router.setTitle(t); });
}
function dash(v) { return typeof v === 'number' && Number.isFinite(v) ? v : null; }
function statNum(v, d, icoName, unit) {
  if (typeof v !== 'number' || !Number.isFinite(v)) return '';
  return h('span', { class: 'stat' },
    icon(icoName, { size: 12 }),
    h('b', { class: 'stat__val', text: fmt.num(v, d) }),
    unit ? h('i', { class: 'stat__unit', text: unit }) : '');
}
function setDlc(s) {
  const list2 = [...new Set(s.parts.map((p) => p.dlc).filter((d) => typeof d === 'number'))];
  const nonBase = list2.filter((d) => d > 0).sort((a, b) => a - b);
  if (!nonBase.length) return DLC_ZH[0] || '本体';
  return nonBase.map((d) => DLC_ZH[d] || `DLC${d}`).join(' / ');
}
function setTotals(s) {
  const t = s.totals || {};
  let armor = dash(t.armor); let weight = dash(t.encumbrance); let res = dash(t.resistance_sum);
  const sum = (key) => {
    const vals = s.parts.map((p) => p[key]).filter((v) => typeof v === 'number');
    return vals.length ? vals.reduce((a, b) => a + b, 0) : null;
  };
  if (armor == null || armor === 0) armor = sum('armor');
  if (weight == null || weight === 0) weight = sum('weight');
  if (res == null) res = sum('resistSum');
  return { armor, weight, res };
}
function isActive() {
  return !!(state.q || state.cat !== 'all' || state.owned || state.fav
    || state.tags.length || state.confs.length || state.dlcs.length || state.set
    || state.icon || state.stats || state.assets || state.min !== '' || state.max !== '');
}
function resetFilters() {
  state = Object.assign(defaultState(), { sort: state.sort, view: state.view });
  syncControls();
  renderAll();
  scheduleUrl();
}

/* ------------------------------- URL 同步 ------------------------------- */
let urlTimer = 0;
function scheduleUrl() {
  clearTimeout(urlTimer);
  urlTimer = setTimeout(pushUrl, 260);
}
function pushUrl() {
  const qs = serialize(state);
  const target = `${listPath()}${qs ? `?${qs}` : ''}`;
  const cur = String(location.hash || '').replace(/^#/, '');
  if (cur !== target) router.go(target, { replace: true });
}

/* ------------------------------- 外壳 ------------------------------- */
function chip(label, ico, opts = {}) {
  const { on = false, count = null, cls = '', title = '', tip = '', onClick } = opts;
  const btn = h('button', {
    class: `chip${on ? ' is-on' : ''}${cls ? ` ${cls}` : ''}`, type: 'button',
    attrs: {
      title: title || label,
      'aria-pressed': on ? 'true' : 'false',
    },
    on: onClick ? { click: onClick } : undefined,
  });
  if (tip) {
    btn.setAttribute('data-tip', tip);
    btn.setAttribute('aria-label', `${label}：${tip}`);
  }
  if (ico) btn.append(icon(ico, { size: 13 }));
  btn.append(h('span', { text: label }));
  if (count != null) btn.append(h('span', { class: 'chip__count', text: fmt.num(count) }));
  return btn;
}

function buildShell(rootEl) {
  const R = {};
  EL = R;
  rootEl.classList.add('lib-root');

  /* subnav */
  R.search = h('input', {
    class: 'input lib-search__input', type: 'search', id: 'libSearch',
    attrs: {
      placeholder: '搜索名称 / 效果 / 标签（空格分词）', autocomplete: 'off',
      'aria-label': '搜索道具', spellcheck: 'false',
    },
    on: { input: (e) => { state.q = e.target.value.trim(); renderAll(); scheduleUrl(); } },
  });
  R.searchWrap = h('div', { class: 'input-group lib-search' }, icon('search', { size: 15 }), R.search);

  R.sort = h('select', {
    class: 'select lib-sort', attrs: { 'aria-label': '排序' },
    on: {
      change: (e) => {
        state.sort = e.target.value;
        renderAll();
        scheduleUrl();
      },
    },
  });
  R.sortWrap = h('div', { class: 'lib-tool lib-tool--sort' },
    icon('sort', { size: 14 }), R.sort);

  R.viewSeg = h('div', { class: 'seg lib-viewseg', attrs: { role: 'group', 'aria-label': '视图' } });
  R.viewBtns = {};
  for (const v of ['grid', 'list']) {
    const b = h('button', {
      class: 'seg__btn', type: 'button',
      attrs: { title: v === 'grid' ? '卡片视图' : '列表视图', 'aria-label': v === 'grid' ? '卡片视图' : '列表视图', 'aria-pressed': 'false' },
      on: {
        click: () => {
          if (state.view === v) return;
          state.view = v;
          syncViewSeg();
          renderAll();
          scheduleUrl();
        },
      },
    }, icon(v === 'grid' ? 'grid' : 'list', { size: 15 }));
    R.viewBtns[v] = b;
    R.viewSeg.append(b);
  }

  R.moreMenu = h('div', { class: 'lib-menu', hidden: true, attrs: { role: 'menu' } });
  R.moreBtn = h('button', {
    class: 'iconbtn', type: 'button', id: 'libMore',
    attrs: { title: '更多', 'aria-label': '更多', 'aria-haspopup': 'true', 'aria-expanded': 'false' },
    on: { click: (e) => { e.stopPropagation(); toggleMore(); } },
  }, icon('more-h', { size: 16 }));
  R.moreWrap = h('div', { class: 'lib-more' }, R.moreBtn, R.moreMenu);

  const modeSeg = h('div', { class: 'seg lib-mode', attrs: { role: 'group', 'aria-label': '资料库视图' } },
    h('a', { class: 'seg__btn', href: '#/items', dataset: { mode: 'items' }, text: '道具' }),
    h('a', { class: 'seg__btn', href: '#/items/sets', dataset: { mode: 'sets' }, text: '套装' }));
  R.modeSeg = modeSeg;

  R.subnav = h('div', { class: 'subnav lib-subnav' },
    h('h1', { class: 'subnav__title', text: '资料库' }),
    modeSeg,
    h('div', { class: 'subnav__tools' }, R.searchWrap, R.sortWrap, R.viewSeg, R.moreWrap));

  /* 分类 chip 行 */
  R.cats = h('div', {
    class: 'lib-cats',
    attrs: { role: 'group', 'aria-label': '分类', tabindex: '0' },
  });
  R.catChips = new Map();
  for (const c of CATS) {
    const b = chip(c.zh, c.icon, {
      count: 0,
      onClick: () => {
        state.cat = c.id;
        if (!isValidSort(c.id, state.sort)) state.sort = 'default';
        renderAll();
        scheduleUrl();
      },
    });
    R.catChips.set(c.id, { btn: b, count: b.querySelector('.chip__count') });
    R.cats.append(b);
  }

  /* 左侧筛选栏 */
  R.minInput = h('input', {
    class: 'input input--num', type: 'number', attrs: { placeholder: '最小', 'aria-label': '最小值', step: '0.1' },
    on: { input: (e) => { state.min = e.target.value; renderAll(); scheduleUrl(); } },
  });
  R.maxInput = h('input', {
    class: 'input input--num', type: 'number', attrs: { placeholder: '最大', 'aria-label': '最大值', step: '0.1' },
    on: { input: (e) => { state.max = e.target.value; renderAll(); scheduleUrl(); } },
  });
  R.metric = h('select', {
    class: 'select lib-range__sel', attrs: { 'aria-label': '数值项' },
    on: {
      change: (e) => {
        state.metric = e.target.value;
        renderAll();
        scheduleUrl();
      },
    },
  });
  for (const [id, zh] of METRICS.map((m) => [m[0], m[1]])) R.metric.append(h('option', { value: id, text: zh }));

  R.switches = {};
  const switchRow = (key, label, tip) => {
    const input = h('input', {
      type: 'checkbox',
      on: {
        change: (e) => {
          state[key] = e.target.checked;
          renderAll();
          scheduleUrl();
        },
      },
    });
    const row = h('label', { class: 'switch lib-switch', attrs: { title: tip || label } },
      input, h('span', { class: 'switch__track' }), h('span', { class: 'lib-switch__t', text: label }));
    R.switches[key] = input;
    return row;
  };

  R.tagGroups = h('div', { class: 'lib-taggroups' });
  R.confBox = h('div', { class: 'lib-chips' });
  R.dlcBox = h('div', { class: 'lib-chips' });
  R.tagChips = new Map();
  R.confChips = new Map();
  R.dlcChips = new Map();

  R.setSel = h('select', {
    class: 'select', attrs: { 'aria-label': '套装' },
    on: {
      change: (e) => {
        state.set = e.target.value;
        renderAll();
        scheduleUrl();
      },
    },
  });

  R.resetBtn = h('button', {
    class: 'btn btn--ghost btn--sm lib-reset', type: 'button',
    on: { click: () => { resetFilters(); ui.toast('已重置筛选', 'info'); } },
  }, icon('rotate-ccw', { size: 13 }), h('span', { text: '重置全部' }));

  R.filtersDone = h('button', {
    class: 'btn btn--primary btn--sm lib-filters__done', type: 'button',
    on: { click: () => R.filters.classList.remove('is-open') },
  }, h('span', { text: '完成' }));

  R.filters = h('aside', { class: 'lib-filters', attrs: { id: 'libFilters', 'aria-label': '筛选' } },
    h('div', { class: 'lib-filters__head' },
      h('span', { class: 'lib-filters__title', text: '筛选' }),
      R.filtersDone),
    h('section', { class: 'lib-fsec' },
      h('div', { class: 'lib-fsec__head' }, h('span', { class: 'lib-fsec__t', text: '状态' })),
      h('div', { class: 'lib-fsec__body' },
        switchRow('owned', '仅已拥有', '只显示标记为已拥有的道具'),
        switchRow('fav', '仅收藏', '只显示收藏的道具'),
        switchRow('icon', '有图标', '只显示有图标资源的条目'),
        switchRow('stats', '有数值', '只显示带数值（护甲/负重/伤害等）的条目'))),
    h('section', { class: 'lib-fsec' },
      h('div', { class: 'lib-fsec__head' }, h('span', { class: 'lib-fsec__t', text: '效果标签' })),
      h('div', { class: 'lib-fsec__body' }, R.tagGroups)),
    h('section', { class: 'lib-fsec' },
      h('div', { class: 'lib-fsec__head' }, h('span', { class: 'lib-fsec__t', text: '套装' })),
      h('div', { class: 'lib-fsec__body' }, R.setSel)),
    h('section', { class: 'lib-fsec' },
      h('div', { class: 'lib-fsec__head' }, h('span', { class: 'lib-fsec__t', text: '可信度' })),
      h('div', { class: 'lib-fsec__body' }, R.confBox)),
    h('section', { class: 'lib-fsec' },
      h('div', { class: 'lib-fsec__head' }, h('span', { class: 'lib-fsec__t', text: '资料片' })),
      h('div', { class: 'lib-fsec__body' }, R.dlcBox)),
    h('section', { class: 'lib-fsec' },
      h('div', { class: 'lib-fsec__head' }, h('span', { class: 'lib-fsec__t', text: '数值范围' })),
      h('div', { class: 'lib-fsec__body' },
        h('div', { class: 'lib-range' }, R.metric, h('div', { class: 'lib-range__nums' }, R.minInput, h('span', { class: 'lib-range__dash', text: '–' }), R.maxInput)))),
    h('section', { class: 'lib-fsec lib-fsec--foot' },
      h('div', { class: 'lib-fsec__body' },
        switchRow('assets', '非道具资产', '显示 Action / 变体等非道具条目（默认只显示真道具）'),
        R.resetBtn)));

  /* 结果区 */
  R.count = h('b', { class: 'lib-count__v', text: '—' });
  R.countWrap = h('div', { class: 'lib-count' },
    R.count, h('span', { class: 'lib-count__u', text: '件' }));
  R.pills = h('div', { class: 'lib-pills' });
  R.filterToggle = h('button', {
    class: 'btn btn--ghost btn--sm lib-filtertoggle', type: 'button',
    attrs: { 'aria-expanded': 'false', 'aria-controls': 'libFilters' },
    on: {
      click: () => {
        const on = R.filters.classList.toggle('is-open');
        R.filterToggle.setAttribute('aria-expanded', on ? 'true' : 'false');
      },
    },
  }, icon('filter', { size: 14 }), h('span', { text: '筛选' }));
  R.bar = h('div', { class: 'lib-bar' }, R.countWrap, R.pills,
    h('span', { class: 'grow' }), R.filterToggle);

  R.grid = h('div', { class: 'lib-grid' });
  R.sentinel = h('div', { class: 'lib-sentinel', attrs: { 'aria-hidden': 'true' } });
  R.empty = h('div', { class: 'empty lib-empty', hidden: true });

  R.results = h('section', { class: 'lib-results', attrs: { 'aria-label': '结果' } },
    R.bar, R.grid, R.sentinel, R.empty);

  R.layout = h('div', { class: 'lib-layout' }, R.filters, R.results);

  R.wrap = h('div', { class: 'wrap lib-wrap' }, R.subnav, R.cats, R.layout);
  rootEl.append(R.wrap);
}

/* 数据到位后按实际分布生成 部位族 / 标签 / 套装 控件 */
function buildDynamicControls() {
  const R = EL;
  if (R.dynamicReady) return;
  R.dynamicReady = true;
  const tagCount = new Map();
  for (const it of ITEMS) {
    if (!it.isItem) continue;
    for (const t of it.filterTags || []) tagCount.set(t, (tagCount.get(t) || 0) + 1);
  }
  // 效果标签：3 组分区，组内按数量降序，chip 带计数与 data-tip 说明
  for (const g of GAME_TAGS_BY_GROUP) {
    const items = g.tags
      .map((tag) => [tag, tagCount.get(tag.id) || 0])
      .filter(([, n]) => n > 0)
      .sort((a, b) => b[1] - a[1]);
    if (!items.length) continue;
    const chips = h('div', { class: 'lib-chips' });
    for (const [tag, n] of items) {
      const b = chip(tag.zh, tag.icon, {
        count: n,
        tip: tag.desc,
        onClick: () => { toggleIn('tags', tag.id); },
      });
      R.tagChips.set(tag.id, b);
      chips.append(b);
    }
    R.tagGroups.append(h('div', { class: 'lib-taggroup' },
      h('div', { class: 'lib-taggroup__t', text: TAG_GROUP_ZH[g.id] || g.zh }),
      chips));
  }
  for (const [id, zh] of Object.entries(CONF)) {
    const b = chip(zh.zh, null, { onClick: () => { toggleIn('confs', id); } });
    R.confChips.set(id, b);
    R.confBox.append(b);
  }
  for (const id of ['0', '1', '2', '3']) {
    const b = chip(DLC_ZH[id] || `DLC${id}`, null, {
      cls: 'chip--sm',
      title: DLC_ZH[id] || `DLC${id}`,
      onClick: () => { toggleIn('dlcs', id); },
    });
    R.dlcChips.set(id, b);
    R.dlcBox.append(b);
  }
  R.setSel.append(h('option', { value: '', text: '全部套装' }));
  for (const s of (SETS || []).slice().sort((a, b) => cmpText(a.name, b.name))) {
    R.setSel.append(h('option', { value: s.key, text: `${s.name}（${s.parts.length} 件）` }));
  }
}

function toggleIn(field, value) {
  const arr = state[field];
  const i = arr.indexOf(value);
  if (i >= 0) arr.splice(i, 1); else arr.push(value);
  renderAll();
  scheduleUrl();
}

/* ------------------------------- 控件同步 ------------------------------- */
function rebuildSortOptions() {
  const R = EL;
  if (!R || !R.sort) return;
  normalizeSort();
  const ids = availableSortIds(state.cat, state.assets);
  const cur = state.sort;
  clear(R.sort);
  for (const [id, zh] of sortOptionsForCat(state.cat)) {
    if (!ids.has(id)) continue;
    R.sort.append(h('option', { value: id, text: zh }));
  }
  R.sort.value = cur;
}
function syncViewSeg() {
  const R = EL;
  for (const v of ['grid', 'list']) {
    const b = R.viewBtns[v];
    const on = state.view === v;
    b.classList.toggle('is-on', on);
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
  }
  R.grid.classList.toggle('is-list', state.view === 'list');
}
function syncControls() {
  if (!EL) return;
  const R = EL;
  if (R.modeSeg) {
    for (const a of R.modeSeg.querySelectorAll('.seg__btn')) {
      const on = a.dataset.mode === MODE;
      a.classList.toggle('is-on', on);
      if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    }
  }
  for (const [id, ref] of R.catChips) {
    ref.btn.classList.toggle('is-on', state.cat === id);
    ref.btn.setAttribute('aria-pressed', state.cat === id ? 'true' : 'false');
  }
  for (const [id, b] of R.tagChips) b.classList.toggle('is-on', state.tags.includes(id));
  for (const [id, b] of R.confChips) b.classList.toggle('is-on', state.confs.includes(id));
  for (const [id, b] of R.dlcChips) b.classList.toggle('is-on', state.dlcs.includes(id));
  for (const key of ['owned', 'fav', 'icon', 'stats', 'assets']) {
    if (R.switches[key]) R.switches[key].checked = !!state[key];
  }
  if (R.setSel) R.setSel.value = state.set || '';
  if (R.metric) R.metric.value = state.metric;
  if (R.minInput && document.activeElement !== R.minInput) R.minInput.value = state.min;
  if (R.maxInput && document.activeElement !== R.maxInput) R.maxInput.value = state.max;
  if (R.search && document.activeElement !== R.search) R.search.value = state.q;
  if (R.sort) {
    const sortKey = `${state.cat}|${state.assets ? 1 : 0}`;
    if (R.sortKey !== sortKey) { rebuildSortOptions(); R.sortKey = sortKey; }
    R.sort.value = state.sort;
  }
  syncViewSeg();
  R.resetBtn.disabled = !isActive();
  R.filterToggle.classList.toggle('is-on', MODE !== MODE_SETS && isActive());
}

/* ------------------------------- 已生效筛选 pills ------------------------------- */
function pill(label, onRemove) {
  const b = h('button', {
    type: 'button', attrs: { title: `移除：${label}`, 'aria-label': `移除筛选 ${label}` },
    on: { click: onRemove },
  }, icon('x', { size: 10 }));
  return h('span', { class: 'pill' }, h('span', { text: label }), b);
}
function renderPills() {
  const R = EL;
  clear(R.pills);
  const add = (label, fn) => R.pills.append(pill(label, () => { fn(); syncControls(); renderAll(); scheduleUrl(); }));
  if (state.q) add(`搜索：${state.q}`, () => { state.q = ''; });
  if (state.cat !== 'all') add(CAT_BY_ID.get(state.cat)?.zh || state.cat, () => { state.cat = 'all'; });
  if (state.owned) add('仅已拥有', () => { state.owned = false; });
  if (state.fav) add('仅收藏', () => { state.fav = false; });
  for (const t of state.tags) add(GAME_TAG_BY_ID.get(t)?.zh || t, () => { removeFrom('tags', t); });
  for (const c of state.confs) add(CONF[c]?.zh || c, () => { removeFrom('confs', c); });
  for (const d of state.dlcs) add(DLC_ZH[d] || d, () => { removeFrom('dlcs', d); });
  if (state.set) {
    const s = (SETS || []).find((x) => x.key === state.set);
    add(`套装：${s ? s.name : state.set}`, () => { state.set = ''; });
  }
  if (state.icon) add('有图标', () => { state.icon = false; });
  if (state.stats) add('有数值', () => { state.stats = false; });
  if (state.assets) add('含非道具资产', () => { state.assets = false; });
  if (state.min !== '' || state.max !== '') {
    const m = METRIC_BY_ID.get(state.metric);
    const txt = `${m.zh} ${state.min !== '' ? `≥${state.min}` : ''}${state.min !== '' && state.max !== '' ? ' 且 ' : ''}${state.max !== '' ? `≤${state.max}` : ''}`;
    add(txt, () => { state.min = ''; state.max = ''; });
  }
  R.pills.hidden = R.pills.children.length === 0;
}
function removeFrom(field, value) {
  const arr = state[field];
  const i = arr.indexOf(value);
  if (i >= 0) arr.splice(i, 1);
}

/* ------------------------------- 渲染：结果 ------------------------------- */
function ensureObserver() {
  if (io) { io.disconnect(); io = null; }
  if (!EL || !EL.sentinel) return;
  io = new IntersectionObserver((entries) => {
    if (entries.some((e) => e.isIntersecting)) appendBatch();
  }, { rootMargin: '640px 0px' });
  io.observe(EL.sentinel);
}
const ARMOR_FAMS = new Set(['head', 'body', 'legs', 'gloves']);
const WEAPON_FAMS = new Set(['longGun', 'handGun', 'melee']);

function plainText(v) {
  return String(v == null ? '' : v).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

function rowStat(ico, val, digits, unit, label) {
  if (typeof val !== 'number' || !Number.isFinite(val)) return null;
  const num = fmt.num(val, digits == null ? 0 : digits);
  return h('span', {
    class: `lib-row__stat lib-row__stat--${ico}`,
    attrs: { title: label ? `${label} ${num}${unit || ''}` : undefined },
  },
  icon(ico, { size: 11 }),
  h('b', { class: 'stat__val', text: num }),
  unit ? h('i', { class: 'stat__unit', text: unit }) : '');
}

/** 列表行关键数值：按部位族挑最有用的 2–4 个（护甲/武器/饰品…） */
function rowStats(it) {
  const out = [];
  // 少数道具的 slot 归在 other（如部署型武器），用 cat 兜底，保证关键数值仍有列
  const isArmor = ARMOR_FAMS.has(it.family) || it.cat === 'armor';
  const isWeapon = WEAPON_FAMS.has(it.family) || it.cat === 'weapon';
  if (isArmor) {
    out.push(rowStat('armorstat', it.armor, 1, '', '护甲值'), rowStat('weight', it.weight, 1, '', '负重'),
      rowStat('resist', it.resistSum, 0, '抗', '抗性合计'));
  } else if (isWeapon) {
    out.push(rowStat('damage', it.damage, 0, '', '伤害'), rowStat('firerate', it.rate, 2, '', '射速'),
      rowStat('mag', it.ammoPerClip, 0, '发', '弹匣容量'), rowStat('crit', it.crit, 0, '%', '暴击率'));
  } else if (it.cat === 'ring' || it.cat === 'amulet' || it.cat === 'relic') {
    out.push(rowStat('relic', it.value, 0, '', '价值'));
  } else if (it.family === 'trait' || it.family === 'perk') {
    out.push(rowStat('trait', it.maxLevel, 0, '级', '等级'));
  } else {
    out.push(rowStat('material', it.value, 0, '', '价值'), rowStat('stack', it.stack, 0, '堆', '堆叠'));
  }
  const arr = out.filter(Boolean).slice(0, 4);
  if (!arr.length) {
    const n = (it.effectLines || []).length;
    if (n) {
      arr.push(h('span', { class: 'lib-row__stat' },
        icon('info', { size: 11 }),
        h('b', { class: 'stat__val', text: `${n} 条效果` })));
    } else if (it.resistSum) {
      arr.push(rowStat('resist', it.resistSum, 0, '抗', '抗性合计'));
    } else if (typeof it.value === 'number') {
      arr.push(rowStat('material', it.value, 0, '', '价值'));
    }
  }
  return arr;
}

/** 需要「效果句」而非风味描述的类别（道具记录的 cat 字段，不是 family） */
const EFFECT_CATS = ['ring', 'amulet', 'relic', 'consumable', 'mod', 'metagem', 'gem', 'material'];

/** 官方效果句（与详情 zhDisplay 同规则：无未替换占位符、无成串英文） */
function effectSentence(it) {
  const raw = String(it.effectZh == null ? '' : it.effectZh).trim();
  if (!raw) return '';
  const t = plainText(raw);
  if (!t) return '';
  if (/\{[^}]*\}/.test(t)) return '';
  if (/[A-Za-z]{2,}/.test(t)) return '';
  return t;
}

/** 列表行描述：效果句原文优先；
 *  效果类目（饰品/消耗品/改装…）绝不拿风味段落充数：effectZh → effectPreview 数值摘要 → 待核实；
 *  武器/护甲/特性/技能等仍走 descZh → effectPreview 兜底链。 */
function rowDesc(it) {
  const effect = effectSentence(it);
  if (effect) return effect;
  const preview = plainText(effectPreview(it));
  if (EFFECT_CATS.includes(it.cat)) {
    // 没有官方效果句时，退到数值摘要并显式标注「数值」，避免被误读成效果原文
    return preview ? `数值：${preview}` : '效果数据待核实（官方效果未收录）';
  }
  const own = plainText(it.descZh);
  if (own) return own;
  if (preview) return preview;
  // 有摘要但全是 0 值/机器噪声（如 denormal 浮点）：明确标注待核实，不展示 0 值
  if (plainText(it.summaryZh)) return '效果数据待核实（官方描述未收录）';
  return '';
}

function rowStateBtn(kind, item, row) {
  const owned = kind === 'owned';
  const on = owned ? store.isOwned(item.id) : store.isFav(item.id);
  const ico = owned ? (on ? 'owned' : 'unowned') : (on ? 'star-fill' : 'star');
  const label = owned
    ? (on ? '取消「已拥有」' : '标记为已拥有')
    : (on ? '取消收藏' : '收藏');
  const btn = h('button', {
    class: `iconbtn iconbtn--sm lib-row__act lib-row__act--${kind}${on ? ' is-on' : ''}`,
    type: 'button',
    attrs: { title: label, 'aria-label': label },
  }, icon(ico, { size: 13 }));
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (owned) {
      const v = store.toggleOwned(item.id);
      ui.toast(v ? `已标记「已拥有」：${item.zh}` : `已标记「未拥有」：${item.zh}`, v ? 'ok' : 'info');
    } else {
      const v = store.toggleFav(item.id);
      ui.toast(v ? `已收藏：${item.zh}` : `已取消收藏：${item.zh}`, v ? 'ok' : 'info');
    }
    const fresh = makeRow(item, new Set(store.build.ids()));
    row.replaceWith(fresh);
    fresh.focus?.({ preventScroll: true });
  });
  return btn;
}

function safeOpenItemDetail(id, opts) {
  try {
    return openItemDetail(id, opts);
  } catch (err) {
    // item-detail 由全站维护，短暂异常时不拖垮资料库视图（QA 也不应记成 0 error 之外的新错误）
    console.warn('[detail]', err);
    detailOpenId = null;
    ui.toast('详情面板暂时打不开，请稍后重试', 'err');
    return null;
  }
}

function makeRow(it, buildIds) {
  const fam = FAMILY[it.family] || FAMILY.other;
  const tagMeta = (it.family === 'other' && it.cat && CAT_BY_ID.has(it.cat))
    ? CAT_BY_ID.get(it.cat) : fam;
  const desc = rowDesc(it);
  const isEffect = !!effectSentence(it);
  const row = h('div', {
    class: 'lib-row', dataset: { id: it.id },
    attrs: { role: 'button', tabindex: '0', 'aria-label': `${it.zh} 详情` },
  });
  const open = () => {
    detailOpenId = it.id;
    safeOpenItemDetail(it.id, { onClose: () => { detailOpenId = null; } });
  };
  row.addEventListener('click', open);
  row.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); }
  });

  const acts = h('div', { class: 'lib-row__acts' });
  const badges = h('div', { class: 'lib-row__badges' });
  if (store.isOwned(it.id)) {
    badges.append(h('span', { class: 'badge badge--high' }, icon('check', { size: 11 }), h('span', { text: '已拥有' })));
  } else if (buildIds.has(it.id)) {
    badges.append(h('span', { class: 'badge badge--low' }, icon('warning', { size: 11 }), h('span', { text: '缺件' })));
  } else {
    badges.append(h('span', { class: 'lib-row__state' }, icon('unowned', { size: 11 }), h('span', { text: '未拥有' })));
  }
  acts.append(badges, rowStateBtn('owned', it, row), rowStateBtn('fav', it, row));

  row.append(
    h('div', { class: 'lib-row__media' }, itemIconEl(it)),
    h('div', { class: 'lib-row__ident' },
      h('div', { class: 'lib-row__name', attrs: { title: it.zh }, text: it.zh }),
      h('div', { class: 'lib-row__en', attrs: { title: it.en }, text: it.en }),
      h('span', { class: 'tag lib-row__tag' },
        icon(tagMeta.icon, { size: 11 }), h('span', { text: tagMeta.zh }))),
    h('div', { class: 'lib-row__stats' }, rowStats(it)),
    h('div', {
      class: `lib-row__desc${isEffect ? ' lib-row__desc--effect' : ''}`,
      attrs: { title: desc || '' },
      text: desc || '—',
    }),
    acts,
  );
  return row;
}

function appendBatch() {
  const R = EL;
  if (MODE === MODE_SETS) { renderSetCards(list); return; }
  if (rendered >= list.length) {
    if (io) { io.disconnect(); io = null; }
    R.sentinel.hidden = true;
    return;
  }
  const frag = document.createDocumentFragment();
  const next = list.slice(rendered, rendered + BATCH);
  if (state.view === 'list') {
    const buildIds = new Set(store.build.ids());
    for (const it of next) frag.append(makeRow(it, buildIds));
  } else {
    for (const it of next) {
      const card = itemCard(it, {
        mode: 'grid',
        showState: true,
        onClick: (item) => {
          detailOpenId = item.id;
          safeOpenItemDetail(item.id, { onClose: () => { detailOpenId = null; } });
        },
      });
      // 护甲/武器属性行已足够，不重复预览；其它预览优先官方效果句，其次 effectPreview
      const statOnly = ARMOR_FAMS.has(it.family) || WEAPON_FAMS.has(it.family);
      const descEl = card.querySelector('.card__desc');
      const effect = effectSentence(it);
      if (descEl) {
        if (statOnly) descEl.remove();
        else if (effect) descEl.textContent = effect;
        else if (EFFECT_CATS.includes(it.cat)) {
          // 效果类目没有效果句时，不展示风味段落；只保留数值摘要或干脆不留
          const preview = plainText(effectPreview(it));
          if (preview) descEl.textContent = `数值：${preview}`;
          else descEl.remove();
        } else if (!descEl.textContent.trim()) descEl.remove();
      }
      frag.append(card);
    }
  }
  R.grid.append(frag);
  rendered += next.length;
  R.sentinel.hidden = rendered >= list.length;
}

function renderEmpty(kind) {
  const R = EL;
  if (!R) return;
  clear(R.empty);
  R.empty.hidden = false;
  R.grid.hidden = true;
  R.sentinel.hidden = true;
  if (kind === 'error') {
    R.empty.append(
      h('div', { class: 'empty__ico' }, icon('warning', { size: 40 })),
      h('div', { class: 'empty__title', text: '数据没有载入' }),
      h('div', { class: 'empty__hint', text: '请确认 python serve.py 正在运行，然后重试。' }),
      h('button', {
        class: 'btn btn--ghost', type: 'button',
        on: {
          click: () => {
            const mine = INSTANCE;
            LOAD_PROMISE = null;
            load()
              .then(() => { if (mine === INSTANCE && EL) bootView(); })
              .catch(() => { if (mine === INSTANCE && EL) renderEmpty('error'); });
          },
        },
      }, icon('refresh', { size: 15 }), h('span', { text: '重试' })));
    return;
  }
  R.empty.append(
    h('div', { class: 'empty__ico' }, icon('filter', { size: 40 })),
    h('div', { class: 'empty__title', text: '没有符合条件的道具' }),
    h('div', { class: 'empty__hint', text: '试试减少关键词、切换分类，或清空全部筛选。' }),
    h('button', {
      class: 'btn btn--ghost', type: 'button',
      on: { click: () => { resetFilters(); } },
    }, icon('rotate-ccw', { size: 15 }), h('span', { text: '重置筛选' })));
}
function renderResults() {
  const R = EL;
  R.empty.hidden = true;
  R.grid.hidden = false;
  clear(R.grid);
  rendered = 0;
  if (!list.length) { renderEmpty('empty'); return; }
  appendBatch();
  if (rendered < list.length) {
    R.sentinel.hidden = false;
    ensureObserver();
  } else {
    R.sentinel.hidden = true;
  }
}

/* ------------------------------- 渲染：套装卡 ------------------------------- */
function setCard(s) {
  const totals = setTotals(s);
  const byFamily = {};
  for (const p of s.parts) byFamily[p.family] = p;
  const slots = ['head', 'body', 'legs', 'gloves'];
  const media = h('div', { class: 'lib-setcard__media' });
  for (const slot of slots) {
    const p = byFamily[slot];
    const cell = h('div', {
      class: `lib-setcard__slot${p ? '' : ' is-empty'}`,
      attrs: { title: p ? `${FAMILY[slot]?.zh || slot}：${p.zh}` : `${FAMILY[slot]?.zh || slot}：缺件` },
    });
    if (p) cell.append(itemIconEl(p, 'sm'));
    else cell.append(icon(FAMILY[slot]?.icon || 'armor', { size: 16 }));
    media.append(cell);
  }
  const complete = s.parts.length >= 4;
  const statLine = h('div', { class: 'lib-setcard__stats' },
    statNum(totals.armor, 1, 'armorstat', ''),
    statNum(totals.weight, 1, 'weight', ''),
    statNum(totals.res, 0, 'resist', ''));
  const card = h('article', {
    class: 'card lib-setcard', attrs: { role: 'button', tabindex: '0', 'aria-label': `套装 ${s.name}` },
    on: {
      click: () => openSetDrawer(s),
      keydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openSetDrawer(s); } },
    },
  },
  media,
  h('div', { class: 'lib-setcard__body' },
    h('div', { class: 'lib-setcard__name', attrs: { title: s.name }, text: s.name }),
    h('div', { class: 'lib-setcard__en', text: s.nameEn || '' }),
    statLine,
    h('div', { class: 'lib-setcard__badges' },
      h('span', { class: `badge ${complete ? 'badge--high' : 'badge--low'}` },
        icon(complete ? 'check' : 'warning', { size: 11 }),
        h('span', { text: complete ? '完整' : `缺件 ${s.parts.length}/4` })),
      h('span', { class: 'badge badge--neutral' }, h('span', { text: setDlc(s) })),
      h('span', { class: 'badge badge--gold' }, h('span', { text: `${s.parts.length} 件` })))));
  return card;
}
function renderSetCards(arr) {
  const R = EL;
  clear(R.grid);
  const frag = document.createDocumentFragment();
  for (const s of arr) frag.append(setCard(s));
  R.grid.append(frag);
  R.sentinel.hidden = true;
}

function openSetDrawer(s) {
  const totals = setTotals(s);
  const body = h('div', { class: 'lib-setdrawer' });
  body.append(h('div', { class: 'lib-setdrawer__sum' },
    h('div', { class: 'statbox' },
      h('span', { class: 'statbox__k' }, icon('armorstat', { size: 11 }), h('span', { text: '合计护甲值' })),
      h('span', { class: 'statbox__v', text: totals.armor == null ? '—' : fmt.num(totals.armor, 1) })),
    h('div', { class: 'statbox' },
      h('span', { class: 'statbox__k' }, icon('weight', { size: 11 }), h('span', { text: '负重' })),
      h('span', { class: 'statbox__v', text: totals.weight == null ? '—' : fmt.num(totals.weight, 1) })),
    h('div', { class: 'statbox' },
      h('span', { class: 'statbox__k' }, icon('resist', { size: 11 }), h('span', { text: '抗性合计' })),
      h('span', { class: 'statbox__v', text: totals.res == null ? '—' : fmt.num(totals.res, 0) }))));
  body.append(h('div', { class: 'lib-setdrawer__parts' },
    s.parts.map((p) => {
      const row = h('div', {
        class: 'lib-setrow', attrs: { role: 'button', tabindex: '0', 'aria-label': `查看 ${p.zh}` },
        on: {
          click: () => safeOpenItemDetail(p.id),
          keydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); safeOpenItemDetail(p.id); } },
        },
      },
      h('div', { class: 'lib-setrow__media' }, itemIconEl(p)),
      h('div', { class: 'lib-setrow__body' },
        h('div', { class: 'lib-setrow__name', text: p.zh }),
        h('div', { class: 'lib-setrow__meta' },
          h('span', { class: 'tag' }, icon(FAMILY[p.family]?.icon || 'armor', { size: 11 }), h('span', { text: FAMILY[p.family]?.zh || p.family })),
          typeof p.armor === 'number' ? h('span', { class: 'stat' }, icon('armorstat', { size: 11 }), h('b', { class: 'stat__val', text: fmt.num(p.armor, 1) })) : '',
          typeof p.weight === 'number' ? h('span', { class: 'stat' }, icon('weight', { size: 11 }), h('b', { class: 'stat__val', text: fmt.num(p.weight, 1) })) : '',
          store.isOwned(p.id) ? h('span', { class: 'badge badge--high' }, icon('check', { size: 11 }), h('span', { text: '已拥有' })) : '')),
      icon('chevron-right', { size: 14, cls: 'lib-setrow__chev' }));
      return row;
    })));
  const install = h('button', {
    class: 'btn btn--primary', type: 'button',
    on: { click: () => installSet(s) },
  }, icon('flask', { size: 15 }), h('span', { text: '整套装入实验室' }));
  ui.openDrawer({
    title: s.name,
    subtitle: `${s.parts.length} 件 · 护甲套装`,
    iconName: 'armor',
    body,
    foot: h('div', { class: 'row' }, install,
      h('button', { class: 'btn btn--quiet', type: 'button', on: { click: () => ui.closeDrawer() } }, h('span', { text: '关闭' }))),
  });
}
function installSet(s) {
  let n = 0;
  for (const p of s.parts) {
    if (!ALL_SLOTS.includes(p.family)) continue;
    store.build.set(p.family, p.id);
    n += 1;
  }
  if (!n) { ui.toast('该套装没有可装入的护甲槽位', 'warn'); return; }
  ui.toast(`已装入 ${n} 件：${s.name}`, 'ok');
  ui.closeDrawer();
  router.go('/lab');
}

/* ------------------------------- 渲染总入口 ------------------------------- */
function renderAll() {
  if (!EL || !ITEMS) return;
  const R = EL;
  const isSets = MODE === MODE_SETS;
  R.cats.hidden = isSets;
  R.filters.hidden = isSets;
  R.filterToggle.hidden = isSets;
  R.sortWrap.hidden = isSets;
  R.viewSeg.hidden = isSets;
  R.layout.classList.toggle('is-sets', isSets);
  R.grid.classList.toggle('lib-grid--sets', isSets);
  R.grid.classList.toggle('is-list', !isSets && state.view === 'list');
  syncControls();

  if (isSets) {
    list = computeSets();
    R.countWrap.querySelector('.lib-count__u').textContent = '套';
    R.count.textContent = fmt.num(list.length);
    clear(R.pills);
    R.pills.hidden = true;
    R.grid.classList.add('lib-grid--sets');
    renderSetCards(list);
    R.empty.hidden = true;
    R.grid.hidden = false;
    if (!list.length) renderEmpty('empty');
    deferTitle('套装 · 资料库');
    return;
  }

  const { counts, list: next } = computeAll();
  list = next;
  R.countWrap.querySelector('.lib-count__u').textContent = '件';
  R.count.textContent = fmt.num(list.length);
  for (const [id, ref] of R.catChips) {
    if (ref.count) ref.count.textContent = fmt.num(counts.get(id) || 0);
  }
  renderPills();
  R.grid.classList.remove('lib-grid--sets');
  renderResults();
  deferTitle(state.q ? `搜索「${state.q}」· 资料库` : '资料库');
}

/* ------------------------------- 路由 ------------------------------- */
function handleRoute(ctx) {
  if (!ctx || ctx.domain !== 'items') return;
  const sub = ctx.sub || '';
  if (sub && sub !== 'sets') {
    // 深链 #/items/<itemId>?q=… ：先把 query 落到筛选态，关闭抽屉后参数不丢
    const nextDetail = parseState(ctx.query);
    normalizeSortFor(nextDetail);
    MODE = MODE_ITEMS;
    state = nextDetail;
    EL.ready = true;
    syncControls();
    renderAll();
    openDetailRoute(decodeURIComponent(sub));
    return;
  }
  const mode = sub === 'sets' ? MODE_SETS : MODE_ITEMS;
  const next = parseState(ctx.query);
  normalizeSortFor(next);
  const canon = serialize(next);
  const curQs = ctx.query ? ctx.query.toString() : '';
  if (mode === MODE && canon === stateKey(state) && EL && EL.ready) {
    if (canon !== curQs) pushUrl();   // 旧 family / 非法 sort 自动清理地址栏
    return;
  }
  MODE = mode;
  state = next;
  if (EL) EL.ready = true;
  syncControls();
  renderAll();
  if (canon !== curQs) pushUrl();
  if (detailOpenId) {
    detailOpenId = null;
    closeDetailLayers();
  }
}

function closeDetailLayers() {
  try { ui.closeDrawer({ silent: true }); } catch { /* 旧版 ui 无抽屉 */ }
  try { ui.closeModal({ silent: true }); } catch { /* 旧版 ui 无弹窗 */ }
}

function openDetailRoute(id) {
  if (detailOpenId === id) return;
  const item = api.item(id);
  if (!item) {
    const qs = serialize(state);
    router.go(`/items${qs ? `?${qs}` : ''}`, { replace: true });
    return;
  }
  if (detailOpenId) { detailOpenId = null; closeDetailLayers(); }
  detailOpenId = id;
  detailReturnPath = `${listPath()}${serialize(state) ? `?${serialize(state)}` : ''}`;
  safeOpenItemDetail(id, {
    route: false,
    onClose: () => {
      detailOpenId = null;
      router.go(detailReturnPath, { replace: true });
    },
  });
  deferTitle(`${item.zh} · 资料库`);
}

/* ------------------------------- 更多菜单：导出查询串 ------------------------------- */
function toggleMore(force) {
  const R = EL;
  if (!R) return;
  const open = force != null ? force : R.moreMenu.hidden;
  R.moreMenu.hidden = !open;
  R.moreBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
  R.moreBtn.classList.toggle('is-on', open);
}
function buildCliQuery() {
  const q = {};
  if (state.cat !== 'all') q.cat = [state.cat];
  if (state.assets) q.include_assets = true; else q.kind = ['item'];
  if (state.set) q.set = state.set;
  if (state.tags.length) q.tag = [...state.tags];
  if (state.confs.length) q.confidence = [...state.confs];
  if (state.icon) q.has_icon = true;
  if (state.stats) q.has_effect = true;
  if (state.q) q.text = state.q;
  const metric = METRIC_BY_ID.get(state.metric) || METRIC_BY_ID.get('armor');
  const baseStat = [];
  if (state.min !== '') baseStat.push(`${metric.key}>=${state.min}`);
  if (state.max !== '') baseStat.push(`${metric.key}<=${state.max}`);
  if (baseStat.length) q.base_stat = baseStat;
  const sortMap = {
    name: 'zh', armor: '-armor', weight: '-weight', damage: '-damage', rate: '-rof',
    mag: '-stat:AmmoPerClip', maxammo: '-stat:MaxAmmo', crit: '-stat:CritChance',
    weakspot: '-stat:WeakSpotDamageMod', resist: '-base:ResistanceSum',
    value: '-value', dlc: 'dlc', order: 'id',
  };
  if (sortMap[state.sort]) q.sort = sortMap[state.sort];
  q.limit = 200;
  return q;
}
function exportPayload() {
  const query = buildCliQuery();
  return {
    schema: 'rmn2.cli/1-query',
    generated_at: new Date().toISOString(),
    from: 'web/items',
    web: Object.assign(JSON.parse(JSON.stringify(state)), {}),
    query,
    count: list.length,
    ids: list.slice(0, 400).map((it) => it.id),
  };
}
function cliJsonText() { return JSON.stringify(exportPayload(), null, 2); }
function powershellText() {
  const json = JSON.stringify(buildCliQuery(), null, 2);
  return [
    '# 1) 把当前筛选写成 query.json（PowerShell）',
    "$json = @'",
    json,
    "'@",
    "Set-Content -Path query.json -Value $json -Encoding utf8",
    '',
    '# 2) 用本地 CLI 查询（默认只返回真道具，与页面默认一致）',
    '.\mimocode\bin\rmn2.ps1 search --query-json @query.json --json',
  ].join('\n');
}
function downloadPayload() {
  const p = exportPayload();
  downloadText(`rmn2-query-${p.count}.json`, JSON.stringify(p, null, 2));
}
function buildMoreMenu() {
  const R = EL;
  const item = (icoName, label, hint, fn) => h('button', {
    class: 'lib-menu__item', type: 'button', role: 'menuitem',
    on: { click: () => { toggleMore(false); fn(); } },
  }, icon(icoName, { size: 14 }),
  h('span', { class: 'lib-menu__label' },
    h('span', { text: label }),
    hint ? h('span', { class: 'lib-menu__hint', text: hint }) : ''));
  R.moreMenu.append(
    h('div', { class: 'lib-menu__head', text: '导出查询串' }),
    item('hash', '复制 CLI JSON', 'rmn2.cli/1 查询对象', async () => {
      const ok = await copyText(cliJsonText());
      ui.toast(ok ? '已复制 CLI JSON' : '复制失败', ok ? 'ok' : 'err');
    }),
    item('clipboard', '复制 PowerShell', '写入 query.json 并查询', async () => {
      const ok = await copyText(powershellText());
      ui.toast(ok ? '已复制 PowerShell 脚本' : '复制失败', ok ? 'ok' : 'err');
    }),
    item('download', '下载查询 JSON', '含当前 Web 筛选态', () => {
      downloadPayload();
      ui.toast('已下载查询 JSON', 'ok');
    }),
    h('hr', { class: 'lib-menu__sep' }),
    item('rotate-ccw', '重置全部筛选', '', () => { resetFilters(); }));
}
function bindGlobal() {
  const R = EL;
  const onDocClick = (e) => {
    if (R.moreWrap.contains(e.target)) return;
    if (!R.moreMenu.hidden) toggleMore(false);
    if (R.filters.classList.contains('is-open')
      && !R.filters.contains(e.target)
      && !(R.filterToggle && R.filterToggle.contains(e.target))) {
      R.filters.classList.remove('is-open');
      R.filterToggle.setAttribute('aria-expanded', 'false');
    }
  };
  const onKey = (e) => {
    const tag = (e.target && e.target.tagName) || '';
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(tag) || (e.target && e.target.isContentEditable);
    if ((e.key === '/' && !typing) || ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K'))) {
      e.preventDefault();
      R.search.focus();
      R.search.select?.();
      return;
    }
    if (e.key === 'Escape') {
      if (!R.moreMenu.hidden) { toggleMore(false); return; }
      if (R.filters.classList.contains('is-open')) {
        R.filters.classList.remove('is-open');
        R.filterToggle.setAttribute('aria-expanded', 'false');
      }
    }
  };
  document.addEventListener('click', onDocClick);
  document.addEventListener('keydown', onKey);
  R._cleanup = () => {
    document.removeEventListener('click', onDocClick);
    document.removeEventListener('keydown', onKey);
  };
}

/* ------------------------------- 启动 / 生命周期 ------------------------------- */
function bootView() {
  const R = EL;
  if (!R) return;
  if (!ITEMS || !SETS) {
    clear(R.grid);
    renderEmpty('error');
    return;
  }
  // 幂等：只有实例首次 boot 才创建控件/绑定 document 监听，避免重复订阅
  if (!R.controlsBuilt) { buildDynamicControls(); R.controlsBuilt = true; }
  if (!R.globalBound) { bindGlobal(); R.globalBound = true; }
  if (!R.menuBuilt) { buildMoreMenu(); R.menuBuilt = true; }
  const ctx = router.getRoute() || { domain: 'items', sub: '', query: new URLSearchParams() };
  handleRoute(ctx);
}

export function mount(rootEl, ctx) {
  const mine = ++INSTANCE;
  clear(rootEl);
  buildShell(rootEl);
  const offStore = [
    store.on('owned', () => {
      if (mine === INSTANCE && ITEMS && MODE === MODE_ITEMS && state.owned) renderAll();
    }),
    store.on('fav', () => {
      if (mine === INSTANCE && ITEMS && MODE === MODE_ITEMS && state.fav) renderAll();
    }),
  ];
  load()
    .then(() => {
      if (mine !== INSTANCE || !EL) return;   // 数据返回前已离开本视图：不得再写 DOM/绑监听
      try {
        bootView();
      } catch (err) {
        console.warn('[library] 视图初始化异常', err);
        renderEmpty('error');
      }
    })
    .catch((err) => {
      if (mine !== INSTANCE || !EL) return;
      console.error('[library] 数据加载失败', err);
      renderEmpty('error');
    });
  return {
    onRoute(next) { if (mine === INSTANCE) handleRoute(next); },
    unmount() {
      if (!EL) { INSTANCE += 1; return; }   // 幂等：重复 unmount 不重复清理
      INSTANCE += 1;   // 让所有挂起的异步回调（load / 重试）立即失效
      offStore.forEach((fn) => fn && fn());
      clearTimeout(urlTimer);
      if (io) { io.disconnect(); io = null; }
      if (EL && EL._cleanup) EL._cleanup();
      if (detailOpenId) { detailOpenId = null; closeDetailLayers(); }
      ITEMS = null; SETS = null; LOAD_PROMISE = null;
      list = []; rendered = 0; detailOpenId = null;
      EL = null;
      clear(rootEl);
    },
  };
}

export default mount;
