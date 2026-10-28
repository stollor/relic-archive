/* =============================================================================
   遗迹2 · 遗物档案 — views/codex.js
   知识库领域：#/codex 分类目录、#/codex/<articleId> 条目正文。
   左目录 + 右正文；深链可直达、可返回、刷新保持。
   只读 data/codex/index.json（经 api.codex()），不写任何状态。
   ========================================================================== */

import { h, clear, copyText } from '../core/dom.js';
import { icon } from '../core/icons.js';
import { api } from '../core/api.js';
import { router } from '../core/router.js';
import { ui } from '../core/ui.js';

const DOMAIN = '知识库';

const CONF = {
  high: { zh: '高可信', cls: 'high' },
  mid: { zh: '中可信', cls: 'mid' },
  medium: { zh: '中可信', cls: 'mid' },
  low: { zh: '待验证', cls: 'low' },
};

/* ---------------------------------- 缓存 ---------------------------------- */
let DATA = null;
let PENDING = null;
let EL = null;          // { root, side, tocBox, body, tocBtn, tocBar }
let ARTICLE_BY_ID = new Map();
let CAT_BY_ID = new Map();
let ORDER = [];         // 扁平条目顺序（用于上一篇/下一篇）
let currentId = '';
let INSTANCE = 0;       // 视图实例代号：异步回调落地前校验「我还是当前实例」

/* --------------------------------- 内联标记 -------------------------------- */
/** 支持 **加粗**、`等宽`、[文字](#/路由) 三种标记，其余按纯文本处理 */
function inline(text) {
  const src = String(text == null ? '' : text);
  const out = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g;
  let last = 0;
  let m;
  while ((m = re.exec(src))) {
    if (m.index > last) out.push(src.slice(last, m.index));
    const tok = m[0];
    if (tok.startsWith('**')) {
      out.push(h('strong', { text: tok.slice(2, -2) }));
    } else if (tok.startsWith('`')) {
      out.push(h('code', { class: 'codex-code', text: tok.slice(1, -1) }));
    } else {
      const close = tok.lastIndexOf(')');
      const label = tok.slice(1, tok.indexOf(']'));
      const href = tok.slice(tok.indexOf('](') + 2, close);
      out.push(a(href, label));
    }
    last = m.index + tok.length;
  }
  if (last < src.length) out.push(src.slice(last));
  return out;
}

function a(href, label) {
  const external = /^https?:/i.test(href);
  return h('a', {
    class: external ? 'codex-link codex-link--out' : 'codex-link',
    href,
    text: label,
    ...(external ? { attrs: { target: '_blank', rel: 'noopener noreferrer' } } : {}),
  }, external ? icon('external', { size: 12, cls: 'codex-link__ico' }) : null);
}

/** 可信度文字 → 徽章（文字原样显示，颜色只做分级） */
function confBadge(text) {
  const t = String(text == null ? '' : text).trim();
  let cls = 'mid';
  if (t.includes('待') || t.includes('未取')) cls = 'low';
  else if (t.includes('高') && !t.includes('中')) cls = 'high';
  return h('span', { class: `badge badge--${cls}`, text: t || '—' });
}

function badgeLevel(level) {
  const c = CONF[level] || CONF.mid;
  return h('span', { class: `badge badge--${c.cls}` }, icon('check', { size: 11 }), c.zh);
}

/* --------------------------------- 区块渲染 -------------------------------- */
function block(b) {
  if (!b || !b.t) return null;
  switch (b.t) {
    case 'h':
      return h(`h${Math.min(4, Math.max(2, b.level || 3))}`, { class: 'codex-h' }, inline(b.text));
    case 'p':
      return h('p', { class: 'codex-p' }, inline(b.text));
    case 'formula':
      return formula(b);
    case 'table':
      return table(b);
    case 'list':
      return list(b);
    case 'evidence':
      return evidence(b);
    case 'note':
      return note(b);
    default:
      return null;
  }
}

function formula(b) {
  const code = String(b.code || '');
  const pre = h('pre', { class: 'formula', text: code });
  const btn = h('button', {
    class: 'iconbtn iconbtn--sm codex-formula__copy',
    type: 'button',
    attrs: { title: '复制公式', 'aria-label': '复制公式' },
    on: {
      click: async () => {
        const ok = await copyText(code);
        if (ok) { ui.toast('公式已复制', 'ok'); return; }
        // 兜底：选中公式文本，用户按 Ctrl+C 即可
        try {
          const range = document.createRange();
          range.selectNodeContents(pre);
          const sel = window.getSelection();
          sel.removeAllRanges();
          sel.addRange(range);
          ui.toast('已选中公式，按 Ctrl+C 复制', 'warn');
        } catch { ui.toast('复制失败，请手动选择公式文本', 'err'); }
      },
    },
  }, icon('copy', { size: 14 }));
  return h('div', { class: 'codex-formula' },
    btn,
    pre,
    b.caption ? h('p', { class: 'codex-cap' }, inline(b.caption)) : null);
}

function table(b) {
  const num = Array.isArray(b.num) ? b.num : [];
  const head = Array.isArray(b.head) && b.head.length
    ? h('thead', {}, h('tr', {}, ...b.head.map((c, i) => h('th', { class: num.includes(i) ? 'tbl__num' : '' }, inline(c)))))
    : null;
  const body = h('tbody', {}, ...(b.rows || []).map((r) => h('tr', {},
    ...r.map((c, i) => h('td', { class: num.includes(i) ? 'tbl__num' : '' }, inline(c))))));
  return h('div', { class: 'codex-tbl' },
    h('div', { class: 'tbl-scroll' }, h('table', { class: 'tbl' }, head, body)),
    b.caption ? h('p', { class: 'codex-cap' }, inline(b.caption)) : null);
}

function list(b) {
  const tag = b.ordered ? 'ol' : 'ul';
  return h(tag, { class: `codex-list${b.ordered ? ' codex-list--ol' : ''}` },
    ...(b.items || []).map((it) => h('li', { class: 'codex-list__li' }, inline(it))));
}

function evidence(b) {
  const rows = [h('div', { class: 'evidence__row evidence__row--head' },
    ...(b.head || ['结论', '可信度', '依据']).map((c) => h('span', { text: c })))];
  for (const r of (b.rows || [])) {
    rows.push(h('div', { class: 'evidence__row' },
      h('span', { class: 'evidence__k' }, inline(r[0])),
      h('span', {}, confBadge(r[1])),
      h('span', {}, inline(r[2]))));
  }
  return h('div', { class: 'evidence' }, ...rows);
}

const NOTE_ICON = { info: 'info', warn: 'warning', tip: 'sparkle' };
const NOTE_ZH = { info: '说明', warn: '注意', tip: '提示' };
function note(b) {
  const kind = b.kind && NOTE_ICON[b.kind] ? b.kind : 'info';
  return h('div', { class: `codex-note codex-note--${kind}` },
    h('span', { class: 'codex-note__ico', attrs: { 'aria-hidden': 'true' } }, icon(NOTE_ICON[kind], { size: 15 })),
    h('div', { class: 'codex-note__body' },
      h('b', { class: 'codex-note__k', text: NOTE_ZH[kind] }),
      h('span', {}, inline(b.text))));
}

/* --------------------------------- 目录渲染 -------------------------------- */
function buildToc() {
  const { side } = EL;
  clear(side);
  const nav = h('nav', { class: 'codex-toc', attrs: { 'aria-label': `${DOMAIN}目录` } });
  nav.append(h('div', { class: 'codex-toc__head' },
    h('span', { class: 'codex-toc__title', text: '目录' }),
    h('span', { class: 'codex-toc__count', text: `${ORDER.length} 条` })));

  for (const cat of DATA.categories || []) {
    const arts = ORDER.filter((x) => x.cat === cat.id);
    if (!arts.length) continue;
    const group = h('div', { class: 'codex-toc__cat' },
      h('div', { class: 'codex-toc__cat-h' },
        h('span', { class: 'codex-toc__cat-ico' }, icon(cat.icon || 'info', { size: 14 })),
        h('span', { text: cat.zh }),
        h('span', { class: 'codex-toc__cat-n', text: String(arts.length) })));
    for (const art of arts) {
      const item = h('a', {
        class: 'codex-toc__item',
        href: `#/codex/${art.id}`,
        dataset: { id: art.id },
        on: { click: () => { closeTocOnMobile(); } },
      }, h('span', { class: 'codex-toc__t', text: art.title }));
      group.append(item);
    }
    nav.append(group);
  }
  side.append(nav);
  markToc(currentId);
}

function markToc(id) {
  if (!EL) return;
  const items = EL.side.querySelectorAll('.codex-toc__item');
  for (const el of items) {
    const on = el.dataset.id === id;
    el.classList.toggle('is-on', on);
    if (on) el.setAttribute('aria-current', 'page');
    else el.removeAttribute('aria-current');
  }
  const cur = EL.side.querySelector('.codex-toc__item.is-on');
  if (cur && cur.scrollIntoView) cur.scrollIntoView({ block: 'nearest' });
}

/* --------------------------------- 正文渲染 -------------------------------- */
function catCard(cat) {
  const arts = ORDER.filter((x) => x.cat === cat.id);
  const head = h('div', { class: 'panel__head' },
    h('h2', { class: 'panel__title', attrs: { id: `cat-${cat.id}` } },
      icon(cat.icon || 'info', { size: 15 }), cat.zh),
    h('span', { class: 'panel__sub', text: `${arts.length} 条` }));
  const rows = arts.map((art) => {
    const main = h('span', { class: 'codex-idxrow__main' },
      h('span', { class: 'codex-idxrow__title', text: art.title }),
      h('span', { class: 'codex-idxrow__sum', text: art.brief || art.summary }));
    const row = h('a', { class: 'codex-idxrow', href: `#/codex/${art.id}` },
      main, badgeLevel(art.confidence),
      icon('chevron-right', { size: 14, cls: 'codex-idxrow__chev' }));
    return h('li', {}, row);
  });
  return h('section', { class: 'panel codex-catcard', attrs: { 'aria-labelledby': `cat-${cat.id}` } },
    head, h('ul', { class: 'codex-catcard__list' }, ...rows));
}

function renderIndex() {
  const { body } = EL;
  clear(body);
  const head = h('div', { class: 'codex-idx-head' },
    h('span', { class: 'codex-idx-meta', text: `${ORDER.length} 条机制条目 · 最后核对 ${DATA.updated || '—'}` }));
  const wrap = h('div', { class: 'codex-index' },
    head,
    h('div', { class: 'codex-catgrid' }, ...(DATA.categories || []).map(catCard)),
    h('p', { class: 'codex-foot-note' },
      `游戏版本 ${DATA.game?.patch || '—'}（${DATA.game?.patchDate || '—'}） · 只读离线数据，不启动、不注入、不修改游戏`));
  body.append(wrap);
}

function renderNotFound(id) {
  const { body } = EL;
  clear(body);
  body.append(h('div', { class: 'empty codex-empty' },
    h('div', { class: 'empty__ico' }, icon('search', { size: 40 })),
    h('p', { class: 'empty__title', text: '没有这个条目' }),
    h('p', { class: 'empty__hint', text: `「${id}」不在知识库中，可能是旧链接或拼写错误。` }),
    h('a', { class: 'btn btn--ghost', href: '#/codex' }, icon('chevron-left', { size: 15 }), '返回目录')));
}

function renderArticle(art) {
  const { body } = EL;
  clear(body);

  const cat = CAT_BY_ID.get(art.cat);
  const head = h('header', { class: 'codex-article__head' },
    h('div', { class: 'codex-head-row' },
      h('nav', { class: 'codex-crumb', attrs: { 'aria-label': '面包屑' } },
        h('a', { class: 'codex-crumb__a', href: '#/codex', text: DOMAIN }),
        h('span', { class: 'codex-crumb__sep', text: '/' }),
        h('span', { class: 'codex-crumb__cur', text: cat ? cat.zh : '条目' })),
      h('a', { class: 'btn btn--quiet btn--sm codex-back', href: '#/codex' },
        icon('chevron-left', { size: 14 }), '返回目录')),
    h('h1', { class: 'codex-title', text: art.title }),
    art.subtitle ? h('p', { class: 'codex-sub', text: art.subtitle }) : null,
    h('div', { class: 'codex-meta' },
      badgeLevel(art.confidence),
      h('span', { class: 'tag' }, icon(cat?.icon || 'info', { size: 12 }), cat ? cat.zh : '未分类'),
      h('span', { class: 'codex-meta__sep' }),
      h('span', { class: 'codex-meta__txt', text: `${(art.sources || []).length} 条来源` }),
      h('span', { class: 'codex-meta__txt', text: `更新 ${DATA.updated || '—'}` })));

  const lede = h('div', { class: 'codex-lede' },
    h('span', { class: 'codex-lede__ico' }, icon('target', { size: 16 })),
    h('p', {}, inline(art.summary)));

  const main = h('div', { class: 'codex-article__body' },
    ...(art.blocks || []).map((b) => block(b)).filter(Boolean));

  const { prev, next } = neighbours(art.id);
  const nav = h('nav', { class: 'codex-nav', attrs: { 'aria-label': '条目翻页' } },
    prev ? h('a', { class: 'codex-nav__btn codex-nav__btn--prev', href: `#/codex/${prev.id}` },
      icon('chevron-left', { size: 16 }),
      h('span', { class: 'codex-nav__body' },
        h('span', { class: 'codex-nav__k', text: '上一条' }),
        h('span', { class: 'codex-nav__t', text: prev.title }))) : h('span'),
    next ? h('a', { class: 'codex-nav__btn codex-nav__btn--next', href: `#/codex/${next.id}` },
      h('span', { class: 'codex-nav__body' },
        h('span', { class: 'codex-nav__k', text: '下一条' }),
        h('span', { class: 'codex-nav__t', text: next.title })),
      icon('chevron-right', { size: 16 })) : h('span'));

  const related = (art.related || []).map((id) => ARTICLE_BY_ID.get(id)).filter(Boolean);
  const relatedBox = related.length
    ? h('div', { class: 'codex-related' },
      h('div', { class: 'bar-title', text: '相关条目' }),
      h('div', { class: 'codex-related__list' },
        ...related.map((r) => h('a', { class: 'chip', href: `#/codex/${r.id}` },
          r.title))))
    : null;

  const links = (art.links || []).length
    ? h('div', { class: 'codex-related' },
      h('div', { class: 'bar-title', text: '相关链接' }),
      h('div', { class: 'codex-related__list' },
        ...art.links.map((l) => a(l.href, l.label))))
    : null;

  const sources = (art.sources || []).length
    ? h('section', { class: 'codex-sources', attrs: { 'aria-label': '来源' } },
      h('div', { class: 'bar-title', text: '来源' }),
      h('ol', { class: 'codex-sources__list' },
        ...art.sources.map((s) => h('li', { class: 'codex-sources__li' },
          h('span', { class: 'codex-sources__k', text: s.k }),
          s.v ? h('span', { class: 'codex-sources__v', text: s.v }) : null,
          s.url ? a(s.url, '原始页面') : null))))
    : null;

  body.append(h('article', { class: 'codex-article', dataset: { article: art.id } },
    head, lede, main, relatedBox, links, sources, nav));

  EL.tocBtn?.replaceChildren(
    icon('list', { size: 15 }),
    h('span', { class: 'codex-tocbar__t', text: art.title }),
    icon('chevron-down', { size: 14, cls: 'codex-tocbar__chev' }));
}

function neighbours(id) {
  const i = ORDER.findIndex((x) => x.id === id);
  return { prev: i > 0 ? ORDER[i - 1] : null, next: i >= 0 && i < ORDER.length - 1 ? ORDER[i + 1] : null };
}

/* 标题延后一拍写入：外壳在 onRoute 之后会同步 syncNav 覆盖 title */
function deferTitle(t) {
  const mine = INSTANCE;
  queueMicrotask(() => { if (mine === INSTANCE && EL) router.setTitle(t); });
}

/* ---------------------------------- 路由 ---------------------------------- */
function show(ctx) {
  if (!EL) return;
  const id = (ctx && ctx.sub) || '';
  currentId = id;
  if (!DATA) return;
  markToc(id);
  if (!id) {
    setSubnavTitle(false);
    renderIndex();
    deferTitle('知识库 · 机制与证据');
    return;
  }
  const art = ARTICLE_BY_ID.get(id);
  if (!art) {
    setSubnavTitle(false);
    renderNotFound(id);
    deferTitle('未找到条目 · 知识库');
    return;
  }
  // 条目页：h1 留给正文标题，subnav 标题降级为非标题元素
  setSubnavTitle(true);
  renderArticle(art);
  deferTitle(`${art.title} · 知识库`);
}

/** 整页只允许一个 h1：目录页 subnav 用 h1，条目页 subnav 降级为 div */
function setSubnavTitle(hasArticleH1) {
  if (!EL || !EL.titleSlot) return;
  clear(EL.titleSlot);
  EL.titleSlot.append(h(hasArticleH1 ? 'div' : 'h1', { class: 'subnav__title', text: DOMAIN }));
}

/* -------------------------------- 移动端目录 ------------------------------- */
function closeTocOnMobile() {
  if (!EL || !EL.sideShell) return;
  if (window.matchMedia('(max-width:900px)').matches) {
    EL.sideShell.classList.remove('is-open');
    EL.tocBtn?.setAttribute('aria-expanded', 'false');
  }
}

function toggleToc() {
  if (!EL || !EL.sideShell) return;
  const on = EL.sideShell.classList.toggle('is-open');
  EL.tocBtn?.setAttribute('aria-expanded', on ? 'true' : 'false');
}

/* ---------------------------------- mount --------------------------------- */
export function mount(rootEl, ctx) {
  const mine = ++INSTANCE;
  clear(rootEl);
  rootEl.classList.add('codex-root');

  const tocBtn = h('button', {
    class: 'btn btn--ghost codex-tocbar__btn',
    type: 'button',
    attrs: { 'aria-expanded': 'false', 'aria-controls': 'codex-toc' },
    on: { click: toggleToc },
  }, icon('list', { size: 15 }), h('span', { class: 'codex-tocbar__t', text: '目录' }), icon('chevron-down', { size: 14 }));

  const side = h('aside', { class: 'codex-side', attrs: { id: 'codex-toc' } },
    h('div', { class: 'codex-side__inner' }));
  const body = h('div', { class: 'codex-body', attrs: { id: 'codex-main' } });

  const tocbar = h('div', { class: 'codex-tocbar' }, tocBtn);
  const layout = h('div', { class: 'codex-layout' }, side, body);
  const titleSlot = h('div', { class: 'codex-subnav__slot' });

  const wrap = h('div', { class: 'wrap codex-wrap' },
    h('div', { class: 'subnav codex-subnav' },
      titleSlot,
      h('span', { class: 'codex-subnav__hint', text: '机制 · 公式 · 证据边界' }),
      h('div', { class: 'subnav__tools' },
        h('a', { class: 'btn btn--quiet btn--sm', href: '#/lab/calc' }, icon('calc', { size: 14 }), '计算器'),
        h('a', { class: 'btn btn--quiet btn--sm', href: '#/lab/matrix' }, icon('matrix', { size: 14 }), '情况矩阵'))),
    tocbar,
    layout);

  rootEl.append(wrap);

  // 侧栏里真正的容器（保留 aside 作为 sticky 外壳）
  const tocBox = side.querySelector('.codex-side__inner');
  EL = { root: rootEl, side: tocBox, body, tocBtn, sideShell: side, titleSlot };

  body.append(h('div', { class: 'codex-loading' },
    h('div', { class: 'sk' }, h('div', { class: 'sk__line' }), h('div', { class: 'sk__line sk__line--short' })),
    h('div', { class: 'sk' }, h('div', { class: 'sk__line' }), h('div', { class: 'sk__line' }), h('div', { class: 'sk__line sk__line--short' }))));

  // 路由由 main.js 派发到当前视图的 onRoute（此前这里额外 router.onChange 订阅会导致
  // 每次路由变化 show 两次）；保留 onRoute 单一路径即可覆盖深链/前进后退。
  const onDocClick = (e) => {
    if (!EL || !EL.sideShell.classList.contains('is-open')) return;
    if (EL.sideShell.contains(e.target) || EL.tocBtn.contains(e.target)) return;
    closeTocOnMobile();
  };
  const onKey = (e) => { if (e.key === 'Escape') closeTocOnMobile(); };
  document.addEventListener('click', onDocClick);
  document.addEventListener('keydown', onKey);

  load()
    .then(() => {
      if (mine !== INSTANCE || !EL) return;   // 数据返回前已离开本视图：不得再写 DOM
      buildToc();
      show(ctx && ctx.domain === 'codex' ? ctx : router.getRoute() || { sub: '' });
    })
    .catch((err) => {
      if (mine !== INSTANCE || !EL) return;
      console.error('[codex] 数据加载失败', err);
      clear(body);
      body.append(h('div', { class: 'empty codex-empty' },
        h('div', { class: 'empty__ico' }, icon('warning', { size: 40 })),
        h('p', { class: 'empty__title', text: '知识库数据没加载出来' }),
        h('p', { class: 'empty__hint', text: '数据文件 /data/codex/index.json 可能缺失或格式有误。' }),
        h('button', {
          class: 'btn btn--ghost', type: 'button',
          on: { click: () => { PENDING = null; location.reload(); } },
        }, icon('refresh', { size: 15 }), '重新加载')));
      deferTitle('知识库 · 加载失败');
    });

  return {
    onRoute(next) {
      if (mine === INSTANCE && next && next.domain === 'codex') show(next);
    },
    unmount() {
      if (!EL) return;   // 幂等
      INSTANCE += 1;     // 让挂起的 load 回调立即失效
      document.removeEventListener('click', onDocClick);
      document.removeEventListener('keydown', onKey);
      EL = null;
    },
  };
}

/* --------------------------------- 数据加载 -------------------------------- */
function load() {
  if (DATA) return Promise.resolve(DATA);
  if (PENDING) return PENDING;
  PENDING = api.codex().then((d) => {
    if (!d || !Array.isArray(d.articles)) throw new Error('codex 数据格式不正确');
    const cats = (d.categories || []).slice().sort((x, y) => (x.order || 0) - (y.order || 0));
    DATA = { ...d, categories: cats };
    CAT_BY_ID = new Map(cats.map((c) => [c.id, c]));
    ARTICLE_BY_ID = new Map(DATA.articles.map((x) => [x.id, x]));
    ORDER = [];
    for (const cat of cats) {
      const arts = DATA.articles.filter((x) => x.cat === cat.id).sort((x, y) => (x.order || 0) - (y.order || 0));
      ORDER.push(...arts);
    }
    // 未分类条目兜底（保证目录不漏条目）
    for (const art of DATA.articles) if (!ORDER.includes(art)) ORDER.push(art);
    return DATA;
  }).catch((e) => { PENDING = null; throw e; });
  return PENDING;
}
