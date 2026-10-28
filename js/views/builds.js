/* =============================================================================
   遗迹2 · 遗物档案 — views/builds.js
   流派领域的装配层：#/builds 列表、#/builds/<key> 详情。
   只负责数据加载、路由、生命周期与 subnav 外壳；列表内容在 builds/list.js，
   详情内容在 builds/detail.js，共用小件与数据表在 builds/ui.js。
   只读 data/builds.json（经 api.builds()）；道具引用一律走 api.buildEntity()。
   ========================================================================== */
import { h, clear } from '../core/dom.js';
import { icon } from '../core/icons.js';
import { api } from '../core/api.js';
import { router } from '../core/router.js';
import { emptyState } from '../components/states.js';
import { DOMAIN } from '../builds/ui.js';
import { renderList } from '../builds/list.js';
import { renderDetail } from '../builds/detail.js';

/* ---------------------------------- 状态 ---------------------------------- */
let DATA = null;
let PENDING = null;
let EL = null;                 // { root, body, titleSlot }
let ORDER = [];                // 按 order 升序的 7 套
let BY_KEY = new Map();
let INSTANCE = 0;              // 视图实例代号：异步回调落地前校验「我还是当前实例」

/* --------------------------------- 小工具 -------------------------------- */
function deferTitle(t) {
  const mine = INSTANCE;
  queueMicrotask(() => { if (mine === INSTANCE && EL) router.setTitle(t); });
}

/** 整页只允许一个 h1：列表页 subnav 用 h1，详情页 subnav 降级为 div（正文有 h1） */
function setSubnavTitle(hasArticleH1) {
  if (!EL || !EL.titleSlot) return;
  clear(EL.titleSlot);
  EL.titleSlot.append(h(hasArticleH1 ? 'div' : 'h1', { class: 'subnav__title', text: DOMAIN }));
}

/* ------------------------------ 404 / 错误态 ----------------------------- */
function renderNotFound(key) {
  clear(EL.body);
  EL.body.append(emptyState({
    cls: 'b404',
    icon: 'search',
    iconSize: 40,
    titleTag: 'p',
    title: '没有这套流派',
    hint: `「${key}」不在 ${ORDER.length} 套推荐配装里，可能是旧链接或拼写错误。`,
    actions: [h('a', { class: 'btn btn--ghost', href: '#/builds' }, icon('chevron-left', { size: 15 }), '返回流派列表')],
  }));
}

function renderError(err) {
  clear(EL.body);
  EL.body.append(emptyState({
    cls: 'b404',
    icon: 'warning',
    iconSize: 40,
    titleTag: 'p',
    title: '流派数据没加载出来',
    hint: `数据文件 /data/builds.json 可能缺失或格式有误。${err && err.message ? `（${err.message}）` : ''}`,
    actions: [h('button', {
      class: 'btn btn--ghost', type: 'button',
      on: {
        click: () => {
          const mine = INSTANCE;
          PENDING = null;
          renderLoading();
          load()
            .then(() => { if (mine === INSTANCE && EL) show(router.getRoute()); })
            .catch((e) => { if (mine === INSTANCE && EL) renderError(e); });
        },
      },
    }, icon('refresh', { size: 15 }), '重新加载')],
  }));
}

function renderLoading() {
  clear(EL.body);
  EL.body.append(h('div', { class: 'bskel' },
    h('div', { class: 'sk' },
      h('div', { class: 'sk__line' }),
      h('div', { class: 'sk__line sk__line--short' })),
    h('div', { class: 'sk' },
      h('div', { class: 'sk__line' }),
      h('div', { class: 'sk__line' }),
      h('div', { class: 'sk__line sk__line--short' }))));
}

/* --------------------------------- 路由 --------------------------------- */
function show(ctx) {
  if (!EL || !DATA) return;
  const key = String((ctx && ctx.sub) || '');
  if (!key) {
    setSubnavTitle(false);
    renderList(EL.body, { data: DATA, order: ORDER });
    deferTitle('流派 · 7 套推荐配装');
    return;
  }
  const b = BY_KEY.get(key);
  if (!b) {
    setSubnavTitle(false);
    renderNotFound(key);
    deferTitle('未找到流派 · 流派');
    return;
  }
  setSubnavTitle(true);
  renderDetail(EL.body, b, { data: DATA, order: ORDER });
  deferTitle(`${b.name_zh} · 流派`);
}

/* ---------------------------------- mount --------------------------------- */
export function mount(rootEl, ctx) {
  const mine = ++INSTANCE;
  clear(rootEl);
  rootEl.classList.add('builds-root');

  const titleSlot = h('div', { class: 'builds-subnav__slot' });
  const body = h('div', { class: 'builds-body', attrs: { id: 'builds-main' } });
  const wrap = h('div', { class: 'wrap builds-wrap' },
    h('div', { class: 'subnav builds-subnav' },
      titleSlot,
      h('span', { class: 'builds-subnav__hint', text: '7 套推荐配装 · 目标 · 乘区 · 口径' }),
      h('div', { class: 'subnav__tools' },
        h('a', { class: 'btn btn--quiet btn--sm', href: '#/lab' }, icon('flask', { size: 14 }), '实验室'),
        h('a', { class: 'btn btn--quiet btn--sm', href: '#/codex' }, icon('book', { size: 14 }), '乘区机制'))),
    body);
  rootEl.append(wrap);
  EL = { root: rootEl, body, titleSlot };
  setSubnavTitle(false);
  renderLoading();

  load()
    .then(() => {
      if (mine !== INSTANCE || !EL) return;   // 已卸载/已被新实例取代：不得再写旧或新 DOM
      const cur = router.getRoute();
      const next = cur && cur.domain === 'builds' ? cur : (ctx && ctx.domain === 'builds' ? ctx : { domain: 'builds', sub: '' });
      show(next);
    })
    .catch((err) => {
      if (mine !== INSTANCE || !EL) return;
      console.error('[builds] 数据加载失败', err);
      renderError(err);
      deferTitle('流派 · 加载失败');
    });

  return {
    onRoute(next) {
      if (mine === INSTANCE && next && next.domain === 'builds') show(next);
    },
    unmount() {
      if (!EL) return;   // 幂等
      INSTANCE += 1;     // 让挂起的 load 回调立即失效
      EL = null;
    },
  };
}

/* --------------------------------- 数据加载 -------------------------------- */
function load() {
  if (DATA) return Promise.resolve(DATA);
  if (PENDING) return PENDING;
  PENDING = Promise.all([api.builds(), api.ready(), api.archetypes()])
    .then(([data]) => {
      if (!data || !Array.isArray(data.builds) || !data.builds.length) throw new Error('流派数据为空');
      ORDER = data.builds.slice().sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0));
      BY_KEY = new Map(ORDER.map((x) => [x.key, x]));
      DATA = data;
      return DATA;
    })
    .catch((err) => { PENDING = null; throw err; });
  return PENDING;
}
