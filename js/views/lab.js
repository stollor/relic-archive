/* =============================================================================
   遗迹2 · 遗物档案 — views/lab.js（v2）
   实验室单页：工作台（15 槽 + 配装设置 + 结果面板）+ 下方面板
   [推荐方案 | 逐槽替换 | 档位对照 | 计算器 | 存档导出]，面板用 .seg 切换。
   路由：#/lab（默认推荐面板）· ?panel=recommend|replace|classes|calc|saved 可复现；
   旧路由 #/lab/builds → recommend、#/lab/matrix → classes、#/lab/calc → calc 自动重定向。
   ========================================================================== */
import { h, clear } from '../core/dom.js';
import { icon } from '../core/icons.js';
import { router } from '../core/router.js';
import { store } from '../core/store.js';
import * as S from '../lab/state.js';
import { loadLabModel } from '../lab/model.js';
import { createWorkbench } from '../lab/workbench.js';
import { createRecommend } from '../lab/recommend.js';
import { createReplace } from '../lab/replace.js';
import { createTiers } from '../lab/tiers.js';
import { createCalc } from '../lab/calc.js';
import { createSaved } from '../lab/saved.js';
import { emptyState } from '../lab/parts.js';

const PANELS = [
  { id: 'recommend', zh: '推荐方案', icon: 'listchecks', title: '实验室 · 推荐方案' },
  { id: 'replace', zh: '逐槽替换', icon: 'swap', title: '实验室 · 逐槽替换' },
  { id: 'classes', zh: '档位对照', icon: 'matrix', title: '实验室 · 档位对照' },
  { id: 'calc', zh: '计算器', icon: 'calc', title: '实验室 · 计算器' },
  { id: 'saved', zh: '存档导出', icon: 'save', title: '实验室 · 存档导出' },
];
const PANEL_BY_ID = new Map(PANELS.map((p) => [p.id, p]));
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
  // 旧路由（#/lab/builds|matrix|calc）在 DOM 渲染前就改 URL，避免截图停在旧路径
  {
    const sub = String((ctx && (ctx.sub || (ctx.segs && ctx.segs[1]))) || '');
    if (LEGACY[sub]) {
      // 不能在 mount 内同步 router.go：那会触发重入 dispatch（还没 mounted）→ 双实例
      pendingPanelScroll = true;
      const target = legacyPath(ctx, LEGACY[sub]);
      setTimeout(() => router.go(target, { replace: true }), 0);
    }
    if (ctx && ctx.params && ctx.params.panel) pendingPanelScroll = true;
  }
  const wrap = h('div', { class: 'wrap lab-page' });
  const subTools = h('div', { class: 'subnav__tools' });
  const workbenchHost = h('div', { class: 'lab-page__wb' });
  const panelSeg = h('div', { class: 'seg', attrs: { role: 'tablist', 'aria-label': '实验室面板' } });
  const panelHost = h('div', { class: 'lab-page__panel' });
  wrap.append(
    h('div', { class: 'subnav' },
      h('h1', { class: 'subnav__title', text: '实验室' }),
      subTools,
    ),
    workbenchHost,
    h('section', { class: 'lab-panels' },
      h('div', { class: 'lab-panels__head' }, panelSeg),
      panelHost,
    ),
  );
  rootEl.append(wrap);

  let model = null;
  let workbench = null;
  let dead = false;
  let currentPanel = '';
  const cache = new Map();
  const segBtns = new Map();

  for (const p of PANELS) {
    const b = h('button', {
      class: 'seg__btn', type: 'button', dataset: { panel: p.id }, attrs: { role: 'tab', 'aria-selected': 'false' },
      on: { click: () => { if (currentPanel !== p.id) switchPanel(p.id); } },
    }, icon(p.icon, { size: 13 }), h('span', { text: p.zh }));
    segBtns.set(p.id, b);
    panelSeg.append(b);
  }

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
    let p = null;
    if (id === 'recommend') p = createRecommend(model, { setQuery, active: true });
    else if (id === 'replace') p = createReplace(model, { onOpenPanel: (target) => switchPanel(target) });
    else if (id === 'classes') p = createTiers(model);
    else if (id === 'calc') p = createCalc(model, { query: queryOf(router.getRoute()) });
    else if (id === 'saved') p = createSaved(model);
    if (!p) return null;
    const holder = h('div', { class: 'lab-panel', id: `lab-panel-${id}`, dataset: { panel: id }, hidden: true }, p.el);
    panelHost.append(holder);
    p.holder = holder;
    cache.set(id, p);
    return p;
  }

  function switchPanel(id) {
    if (!PANEL_BY_ID.has(id)) id = 'recommend';
    currentPanel = id;
    const p = ensurePanel(id);
    for (const [pid, panel] of cache) panel.holder.hidden = pid !== id;
    for (const [pid, b] of segBtns) {
      const on = pid === id;
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
    }
    if (id === 'recommend') p?.activate?.();
    else p?.refresh?.();
    // 切换面板时清掉不属于该面板的 query，保持 URL 干净、可分享
    const REC_KEYS = ['sort', 'page', 'ownedOnly', 'hideMissing', 'diff'];
    const CALC_KEYS = ['armor', 'weight', 'flat', 'bleed', 'fire', 'shock', 'corrosive', 'blight'];
    const patch = { panel: id === 'recommend' ? '' : id };
    if (id !== 'recommend') for (const k of REC_KEYS) patch[k] = '';
    if (id !== 'calc') { for (const k of CALC_KEYS) patch[k] = ''; patch.scenario = ''; }
    router.setQuery(patch, { replace: true });
    applyPanelQuery(id, paramsOf(router.getRoute()));
    applyTitle(id);
  }

  function applyPanelQuery(id, params) {
    const p = cache.get(id);
    if (!p) return;
    if (id === 'recommend') p.applyParams?.(params);
    else if (id === 'calc') p.applyParams?.(params);
  }

  function applyTitle(id) {
    const p = PANEL_BY_ID.get(id);
    Promise.resolve().then(() => { if (!dead && p) router.setTitle(p.title); });
  }

  function syncSubTools() {
    clear(subTools);
    const used = S.traitUsed();
    subTools.append(
      h('span', { class: `tag${used >= 10 ? ' lab-tag--warn' : ''}`, title: '游戏特性装备上限 10 个' }, icon('trait', { size: 11 }), h('span', { text: `特性 ${used}/10` })),
      h('span', { class: 'tag' }, icon('x-circle', { size: 11 }), h('span', { text: `缺件 ${S.missingCount()}` })),
      h('span', { class: 'tag' }, icon('check-circle', { size: 11 }), h('span', { text: `已拥有 ${S.ownedCount()}` })),
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

  function routeTo(c, isInit = false) {
    if (dead) return;
    if (redirectLegacy(c)) return;
    if (!model) return;
    const params = paramsOf(c);
    const id = panelFromCtx(c);
    // 直接打开/重定向时也清掉不属于该面板的 query（可分享、可复现）
    {
      const REC_KEYS = ['sort', 'page', 'ownedOnly', 'hideMissing', 'diff'];
      const CALC_KEYS = ['armor', 'weight', 'flat', 'bleed', 'fire', 'shock', 'corrosive', 'blight'];
      const patch = {};
      if (id !== 'recommend') for (const k of REC_KEYS) if (params[k] != null) patch[k] = '';
      if (id !== 'calc') {
        for (const k of CALC_KEYS) if (params[k] != null) patch[k] = '';
        if (params.scenario != null) patch.scenario = '';
      }
      if (Object.keys(patch).length) { router.setQuery(patch, { replace: true }); return; }
    }
    if (id !== currentPanel) {
      currentPanel = id;
      const p = ensurePanel(id);
      for (const [pid, panel] of cache) panel.holder.hidden = pid !== id;
      for (const [pid, b] of segBtns) {
        const on = pid === id;
        b.classList.toggle('is-on', on);
        b.setAttribute('aria-selected', on ? 'true' : 'false');
      }
      if (id === 'recommend') p?.activate?.();
      else p?.refresh?.();
      applyPanelQuery(id, params);
      applyTitle(id);
    } else {
      applyPanelQuery(id, params);
    }
    if (pendingPanelScroll) {
      pendingPanelScroll = false;
      requestAnimationFrame(() => {
        const el = document.querySelector('.lab-panels');
        if (el) window.scrollTo({ top: Math.max(0, el.getBoundingClientRect().top + window.scrollY - 64), behavior: 'auto' });
      });
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
    showLoading();
    try {
      model = await loadLabModel();
      if (dead) return;
      S.migrateLegacyMeta(model);
      clear(workbenchHost);
      workbench = createWorkbench(model, { onOpenPanel: (id) => switchPanel(id) });
      workbenchHost.append(workbench.el);
      panelHost.hidden = false;
      syncSubTools();
      routeTo(router.getRoute() || ctx, true);
      if (!currentPanel) switchPanel('recommend');
    } catch (err) {
      console.error('[lab] 数据载入失败', err);
      clear(workbenchHost);
      workbenchHost.append(emptyState('warning', '实验室数据载入失败',
        String((err && err.message) || err || '未知错误'),
        h('button', { class: 'btn btn--primary', type: 'button', text: '重试', on: { click: () => { clear(workbenchHost); init(); } } })));
      panelHost.hidden = true;
    }
  }

  const offs = [];
  offs.push(store.on('build', syncSubTools));
  offs.push(store.on('owned', syncSubTools));
  offs.push(S.on((reason) => { if (reason === 'missing' || reason === 'seed') syncSubTools(); }));

  init();

  return {
    onRoute(nextCtx) {
      if (!model) return;
      routeTo(nextCtx);
    },
    unmount() {
      dead = true;
      for (const off of offs) { try { off(); } catch { /* ignore */ } }
      try { workbench?.destroy?.(); } catch (e) { console.error('[lab] workbench destroy', e); }
      for (const p of cache.values()) { try { p.destroy?.(); } catch (e) { console.error('[lab] panel destroy', e); } }
      cache.clear();
    },
  };
}

export default { mount };
