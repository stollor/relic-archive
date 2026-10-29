/* =============================================================================
   遗迹2 · 遗物档案 — views/lab.js（v3）
   实验室单页：工作台（15 槽 + 配装设置 + 结果面板）+ 下方面板
   [推荐方案 | 逐槽替换 | 档位对照 | 计算器 | 存档导出]，面板用 .seg 切换。
   路由：#/lab（默认推荐面板）· ?panel=recommend|replace|classes|calc|saved 可复现；
   旧路由 #/lab/builds → recommend、#/lab/matrix → classes、#/lab/calc → calc 自动重定向。

   面板注册表：PANELS 是唯一事实源 —— seg 按钮、标题、懒创建、隐藏切换、
   URL 参数清理/下发全部由它驱动；新增面板只在表里加一条并新建模块。
   ========================================================================== */
import { h, clear } from '../core/dom.js';
import { icon } from '../core/icons.js';
import { router } from '../core/router.js';
import { store } from '../core/store.js';
import { createRefresh, createScope } from '../core/task.js';
import * as S from '../lab/state.js';
import { loadLabModel } from '../lab/model.js';
import { createWorkbench } from '../lab/workbench.js';
import { createRecommend } from '../lab/recommend.js';
import { createTrinkets } from '../lab/trinkets.js';
import { createWeapons } from '../lab/weapons.js';
import { createTraits } from '../lab/traits.js';
import { createFragments } from '../lab/fragments.js';
import { createReplace } from '../lab/replace.js';
import { createTiers } from '../lab/tiers.js';
import { createCalc } from '../lab/calc.js';
import { createSaved } from '../lab/saved.js';
import { emptyState } from '../lab/parts.js';

/**
 * 面板注册表（唯一事实源）。
 * 每项：{ id, zh, icon, title, paramKeys, create(model, deps) }
 *  - id/zh/icon → seg 按钮；title → 文档标题
 *  - paramKeys → 该面板消费的 URL query 键（切走自动清理、切来收到 applyParams）
 *  - create 只在首次切到该面板时调用（懒创建），deps = { setQuery, openPanel, query }
 *
 * 面板实例契约（所有面板统一）：
 *  { el, mount?, refresh?, applyParams?(params), activate?, destroy? }
 *   el        面板根节点（视图负责套 .lab-panel 容器）
 *   refresh   可见时状态变化后的同步渲染
 *   applyParams(URL 参数对象)  仅 paramKeys 非空的面板会收到
 *   activate  首次展示时的启动钩子（推荐面板用）
 *   destroy   取消订阅 / 停帧（视图 unmount 时调用，恰好一次）
 */
/**
 * 面板分组（一级 tab）：把 9 个面板压成 3 组，降低单屏信息密度。
 * group 是唯一事实源：一级 tab 的顺序/名称、二级面板的显隐都由它驱动。
 */
export const PANEL_GROUPS = [
  { id: 'plan', zh: '推荐', icon: 'listchecks' },
  { id: 'gear', zh: '装备', icon: 'grid' },
  { id: 'data', zh: '数据与存档', icon: 'chart' },
];

const PANELS = [
  {
    id: 'recommend', group: 'plan', zh: '推荐方案', icon: 'listchecks', title: '实验室 · 推荐方案',
    paramKeys: ['sort', 'page', 'hideMissing', 'diff'],
    create: (model, deps) => createRecommend(model, { setQuery: deps.setQuery, active: true }),
  },
  {
    id: 'trinkets', group: 'plan', zh: '饰品组合', icon: 'gem', title: '实验室 · 饰品组合',
    paramKeys: ['ps', 'page', 'fixed'],
    create: (model, deps) => createTrinkets(model, deps),
  },
  {
    id: 'weapons', group: 'plan', zh: '武器改装', icon: 'metagem', title: '实验室 · 武器改装',
    paramKeys: ['ps', 'wslot'],
    create: (model, deps) => createWeapons(model, deps),
  },
  {
    id: 'traits', group: 'gear', zh: '特性', icon: 'trait', title: '实验室 · 特性',
    paramKeys: ['tps'],
    create: (model, deps) => createTraits(model, deps),
  },
  {
    id: 'fragments', group: 'gear', zh: '圣物碎片', icon: 'relic', title: '实验室 · 圣物碎片',
    paramKeys: [],
    create: (model, deps) => createFragments(model, deps),
  },
  {
    id: 'replace', group: 'gear', zh: '逐槽替换', icon: 'swap', title: '实验室 · 逐槽替换',
    paramKeys: [],
    create: (model, deps) => createReplace(model, { onOpenPanel: deps.openPanel }),
  },
  {
    id: 'classes', group: 'data', zh: '档位对照', icon: 'matrix', title: '实验室 · 档位对照',
    paramKeys: [],
    create: (model) => createTiers(model),
  },
  {
    id: 'calc', group: 'data', zh: '计算器', icon: 'calc', title: '实验室 · 计算器',
    paramKeys: ['armor', 'weight', 'flat', 'bleed', 'fire', 'shock', 'corrosive', 'blight', 'scenario'],
    create: (model, deps) => createCalc(model, { query: deps.query }),
  },
  {
    id: 'saved', group: 'data', zh: '存档导出', icon: 'save', title: '实验室 · 存档导出',
    paramKeys: [],
    create: (model) => createSaved(model),
  },
];
const PANEL_BY_ID = new Map(PANELS.map((p) => [p.id, p]));
/** 所有面板声明的 URL 参数键（用于单一实现的面板参数清理） */
const PANEL_PARAM_KEYS = [...new Set(PANELS.flatMap((p) => p.paramKeys))];
const PANEL_OWN_KEYS = new Map(PANELS.map((p) => [p.id, new Set(p.paramKeys)]));
const LEGACY = { builds: 'recommend', matrix: 'classes', calc: 'calc' };

function paramsOf(ctx) {
  const q = ctx && ctx.query;
  if (!q) return {};
  const out = {};
  for (const [k, v] of q.entries()) out[k] = v;
  return out;
}
function queryOf(ctx) {
  if (!ctx) return null;
  if (ctx.query instanceof URLSearchParams) return ctx.query;
  return new URLSearchParams(paramsOf(ctx));
}

export function mount(rootEl, ctx) {
  let pendingPanelScroll = false;
  let legacyTimer = 0;   // 旧路由重定向定时器：卸载后必须作废，否则会劫持下一个页面
  let dead = false;      // 先声明：旧路由定时器回调要读它
  // 旧路由（#/lab/builds|matrix|calc）在 DOM 渲染前就改 URL，避免截图停在旧路径
  {
    const sub = String((ctx && (ctx.sub || (ctx.segs && ctx.segs[1]))) || '');
    if (LEGACY[sub]) {
      // 不能在 mount 内同步 router.go：那会触发重入 dispatch（还没 mounted）→ 双实例
      pendingPanelScroll = true;
      const target = legacyPath(ctx, LEGACY[sub]);
      legacyTimer = setTimeout(() => { if (!dead) router.go(target, { replace: true }); }, 0);
    }
    if (ctx && ctx.params && ctx.params.panel) pendingPanelScroll = true;
  }
  const wrap = h('div', { class: 'wrap lab-page' });
  const subTools = h('div', { class: 'subnav__tools' });
  const workbenchHost = h('div', { class: 'lab-page__wb' });
  const groupSeg = h('div', { class: 'seg lab-tabs__groups', attrs: { role: 'tablist', 'aria-label': '实验室分区' } });
  const panelSeg = h('div', { class: 'seg lab-tabs__panels', attrs: { role: 'tablist', 'aria-label': '实验室面板' } });
  const tabBar = h('div', { class: 'lab-tabs' }, groupSeg, panelSeg);
  const panelHost = h('div', { class: 'lab-page__panel' });
  // 持有滚动锚点引用：不再用 document.querySelector('.lab-panels')
  const panelSection = h('section', { class: 'lab-panels' },
    h('div', { class: 'lab-panels__head' }, tabBar),
    panelHost,
  );
  wrap.append(
    h('div', { class: 'subnav' },
      h('h1', { class: 'subnav__title', text: '实验室' }),
      subTools,
    ),
    workbenchHost,
    panelSection,
  );
  rootEl.append(wrap);

  let model = null;
  let workbench = null;
  let currentPanel = '';
  const cache = new Map();
  const segBtns = new Map();
  const groupBtns = new Map();
  const lastPanelByGroup = new Map();
  let currentGroup = 'plan';
  const scope = createScope();
  /** 面板滚动定位：合并到一帧，卸载时可取消 */
  const scrollRefresh = createRefresh(() => {
    if (dead) return;
    window.scrollTo({ top: Math.max(0, panelSection.getBoundingClientRect().top + window.scrollY - 64), behavior: 'auto' });
  });

  const firstPanelOf = (groupId) => {
    const p = PANELS.find((x) => x.group === groupId);
    return p ? p.id : 'recommend';
  };
  for (const g of PANEL_GROUPS) {
    const b = h('button', {
      class: 'seg__btn', type: 'button', dataset: { group: g.id }, attrs: { role: 'tab', 'aria-selected': 'false' },
      on: { click: () => { if (currentGroup !== g.id) switchPanel(lastPanelByGroup.get(g.id) || firstPanelOf(g.id)); } },
    }, icon(g.icon, { size: 13 }), h('span', { text: g.zh }));
    groupBtns.set(g.id, b);
    groupSeg.append(b);
  }

  for (const p of PANELS) {
    const b = h('button', {
      class: 'seg__btn', type: 'button', dataset: { panel: p.id }, attrs: { role: 'tab', 'aria-selected': 'false' },
      on: { click: () => { if (currentPanel !== p.id) switchPanel(p.id); } },
    }, icon(p.icon, { size: 13 }), h('span', { text: p.zh }));
    b.hidden = p.group !== 'plan';
    segBtns.set(p.id, b);
    panelSeg.append(b);
  }

  /** 面板创建依赖：URL 写入 / 切面板 / 当前 URL 查询串 */
  const deps = {
    setQuery,
    openPanel: (id) => switchPanel(id),
    get query() { return queryOf(router.getRoute()); },
  };

  /* ----------------------------- 面板创建 ----------------------------- */
  function setQuery(patch) {
    // 显式深链带 panel 时保留 panel 参数；否则默认面板（推荐）省略参数保持 URL 干净
    const cur = router.getRoute();
    const hasPanelParam = !!(cur && cur.query && cur.query.has('panel'));
    const panelVal = hasPanelParam ? currentPanel : (currentPanel === 'recommend' ? '' : currentPanel);
    router.setQuery({ panel: panelVal, ...patch }, { replace: true });
  }

  function ensurePanel(id) {
    if (cache.has(id)) return cache.get(id);
    const def = PANEL_BY_ID.get(id);
    if (!def) return null;
    const p = def.create(model, deps);
    if (!p || !p.el) return null;
    const holder = h('div', { class: 'lab-panel', id: `lab-panel-${id}`, dataset: { panel: id }, hidden: true }, p.el);
    panelHost.append(holder);
    p.holder = holder;   // 隐藏切换由视图负责（面板本身不关心自己是否可见）
    cache.set(id, p);
    return p;
  }

  /** 不属于该面板的 URL 参数 → 清空 patch（switchPanel 用，无条件清） */
  function cleanPanelQuery(id) {
    const own = PANEL_OWN_KEYS.get(id) || new Set();
    const patch = {};
    for (const k of PANEL_PARAM_KEYS) if (!own.has(k)) patch[k] = '';
    return patch;
  }
  /** 当前 URL 里属于其它面板的参数 → 清空 patch（routeTo 用，只清实际出现的） */
  function foreignPanelParams(id, params) {
    const own = PANEL_OWN_KEYS.get(id) || new Set();
    const patch = {};
    for (const k of PANEL_PARAM_KEYS) if (!own.has(k) && params[k] != null) patch[k] = '';
    return patch;
  }

  function syncPanelVisibility(id) {
    for (const [pid, panel] of cache) panel.holder.hidden = pid !== id;
    for (const [pid, b] of segBtns) {
      const on = pid === id;
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
    }
  }

  /** 一级分组 tab + 二级面板 tab 的显隐/选中同步（group 由 PANELS 驱动） */
  function syncTabs(id) {
    const def = PANEL_BY_ID.get(id);
    const gid = (def && def.group) || 'plan';
    currentGroup = gid;
    lastPanelByGroup.set(gid, id);
    for (const [g, b] of groupBtns) {
      const on = g === gid;
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
    }
    for (const [pid, b] of segBtns) b.hidden = (PANEL_BY_ID.get(pid) || {}).group !== gid;
  }

  function switchPanel(id) {
    if (!PANEL_BY_ID.has(id)) id = 'recommend';
    currentPanel = id;
    const p = ensurePanel(id);
    syncTabs(id);
    syncPanelVisibility(id);
    if (id === 'recommend') p?.activate?.();
    else p?.refresh?.();
    // 切换面板时清掉不属于该面板的 query，保持 URL 干净、可分享
    router.setQuery({ panel: id === 'recommend' ? '' : id, ...cleanPanelQuery(id) }, { replace: true });
    applyPanelQuery(id, paramsOf(router.getRoute()));
    applyTitle(id);
  }

  function applyPanelQuery(id, params) {
    const def = PANEL_BY_ID.get(id);
    if (!def || !def.paramKeys.length) return;   // 不消费 URL 参数的面板不接收 params
    cache.get(id)?.applyParams?.(params);
  }

  function applyTitle(id) {
    const p = PANEL_BY_ID.get(id);
    Promise.resolve().then(() => { if (!dead && p) router.setTitle(p.title); });
  }

  function syncSubTools() {
    clear(subTools);
    const used = S.traitUsed();
    const ps = model && model.gear ? model.gear.playstyleById.get(S.playstyleId()) : null;
    subTools.append(
      h('span', { class: `tag${used >= 10 ? ' lab-tag--warn' : ''}`, title: '游戏特性装备上限 10 个' }, icon('trait', { size: 11 }), h('span', { text: `特性 ${used}/10` })),
      h('span', { class: 'tag', title: '装备默认全部可用；没有的标记为缺件' }, icon('x-circle', { size: 11 }), h('span', { text: `缺件 ${S.missingCount()}` })),
      h('span', { class: 'tag', title: '当前流派：推荐 / 组合评分口径' }, icon('gem', { size: 11 }), h('span', { text: `流派 ${ps ? ps.zh : '通用'}` })),
    );
  }

  /* ----------------------------- 路由 ----------------------------- */
  function panelFromCtx(c) {
    const params = paramsOf(c);
    if (params.panel && PANEL_BY_ID.has(params.panel)) return params.panel;
    const sub = String((c && (c.sub || (c.segs && c.segs[1]))) || '');
    if (LEGACY[sub]) return LEGACY[sub];
    return 'recommend';
  }

  /** 旧路由 → 新 URL：保留原 query（如 #/lab/calc?armor=...）并补 panel */
  function legacyPath(c, target) {
    const q = (c && c.query instanceof URLSearchParams) ? new URLSearchParams(c.query) : new URLSearchParams();
    q.set('panel', target);
    return `/lab?${q.toString()}`;
  }

  /** 旧路由立即改 URL（不等数据载入，截图/深链都能落到对应面板） */
  function redirectLegacy(c) {
    const sub = String((c && (c.sub || (c.segs && c.segs[1]))) || '');
    if (!LEGACY[sub]) return false;
    pendingPanelScroll = true;
    router.go(legacyPath(c, LEGACY[sub]), { replace: true });
    return true;
  }

  function routeTo(c) {
    if (dead) return;
    if (redirectLegacy(c)) return;
    if (!model) return;
    const params = paramsOf(c);
    const id = panelFromCtx(c);
    // 直接打开/重定向时也清掉不属于该面板的 query（可分享、可复现）
    const foreign = foreignPanelParams(id, params);
    if (Object.keys(foreign).length) { router.setQuery(foreign, { replace: true }); return; }
    if (id !== currentPanel) {
      currentPanel = id;
      const p = ensurePanel(id);
      syncTabs(id);
      syncPanelVisibility(id);
      if (id === 'recommend') p?.activate?.();
      else p?.refresh?.();
      applyPanelQuery(id, params);
      applyTitle(id);
    } else {
      applyPanelQuery(id, params);
    }
    if (pendingPanelScroll) {
      pendingPanelScroll = false;
      scrollRefresh.schedule();
    }
  }

  /* ----------------------------- 加载 ----------------------------- */
  function showLoading() {
    clear(workbenchHost);
    workbenchHost.append(
      h('div', { class: 'lab-skeleton' },
        h('div', { class: 'sk' }, h('div', { class: 'sk__media' }), h('div', { class: 'sk__line' })),
        h('div', { class: 'sk' }, h('div', { class: 'sk__media' }), h('div', { class: 'sk__line' })),
        h('div', { class: 'sk' }, h('div', { class: 'sk__media' }), h('div', { class: 'sk__line' })),
      ),
      h('p', { class: 'muted', attrs: { style: 'font-size:12px;margin-top:12px' }, text: '正在读取 site_data.json / items.json / archetypes.json…' }),
    );
    panelHost.hidden = true;
  }

  async function init() {
    if (dead) return;
    showLoading();
    try {
      model = await loadLabModel();
      if (dead) return;
      S.migrateLegacyMeta(model);
      S.migrateFragments();
      clear(workbenchHost);
      workbench = createWorkbench(model, { onOpenPanel: (id) => switchPanel(id) });
      workbenchHost.append(workbench.el);
      panelHost.hidden = false;
      syncSubTools();
      routeTo(router.getRoute() || ctx);
      if (!currentPanel) switchPanel('recommend');
    } catch (err) {
      if (dead) return;   // 卸载后才失败：不得再写（已脱离文档的）DOM
      console.error('[lab] 数据载入失败', err);
      clear(workbenchHost);
      workbenchHost.append(emptyState('warning', '实验室数据载入失败',
        String((err && err.message) || err || '未知错误'),
        h('button', { class: 'btn btn--primary', type: 'button', text: '重试', on: { click: () => { if (dead) return; clear(workbenchHost); init(); } } })));
      panelHost.hidden = true;
    }
  }

  scope.add(store.on('build', syncSubTools));
  scope.add(store.on('owned', syncSubTools));
  scope.add(S.watchMissingBridge());
  scope.add(S.on((reason) => { if (reason === 'missing' || reason === 'seed' || reason === 'playstyle' || reason === 'fragment' || reason === 'attachment') syncSubTools(); }));

  init();

  return {
    onRoute(nextCtx) {
      if (!model || dead) return;
      routeTo(nextCtx);
    },
    unmount() {
      if (dead) return;   // 幂等：workbench / 面板 destroy 恰好一次
      dead = true;
      if (legacyTimer) { clearTimeout(legacyTimer); legacyTimer = 0; }
      scrollRefresh.cancel();
      scope.dispose();
      try { workbench?.destroy?.(); } catch (e) { console.error('[lab] workbench destroy', e); }
      workbench = null;
      for (const p of cache.values()) { try { p.destroy?.(); } catch (e) { console.error('[lab] panel destroy', e); } }
      cache.clear();
    },
  };
}

export default { mount };
