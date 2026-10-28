/* =============================================================================
   遗迹2 · 遗物档案 — main.js
   应用外壳：初始化、路由派发、视图生命周期、顶栏状态、错误边界。
   视图契约：mount(rootEl, ctx) -> { onRoute?(ctx), unmount?() }
   ========================================================================== */
import { router } from './core/router.js';
import { api } from './core/api.js';
import { store } from './core/store.js';
import { ui } from './core/ui.js';
import { h, $, clear, fmt } from './core/dom.js';
import { icon } from './core/icons.js';
import { createEpoch } from './core/task.js';

const VIEW_FILES = {
  items: './views/library.js',
  lab: './views/lab.js',
  builds: './views/builds.js',
  codex: './views/codex.js',
};
const DOMAIN_ZH = { items: '资料库', lab: '实验室', builds: '流派', codex: '知识库' };
const DOMAIN_ORDER = ['items', 'lab', 'builds', 'codex'];

const root = $('#view-root');
let mounted = null;
const moduleCache = new Map();
/* 派发代际：只有最新一次 dispatch 有权挂载视图，晚返回的旧 dispatch 直接放弃 */
const epoch = createEpoch();

/* ----------------------------- 状态条 ----------------------------- */
function updateCounters() {
  const owned = $('#statOwned b');
  const fav = $('#statFav b');
  if (owned) owned.textContent = store.ownedCount();
  if (fav) fav.textContent = store.favCount();
  const navBadge = document.querySelector('.domnav__link[data-domain="lab"] .domnav__count');
  if (navBadge) {
    const n = store.build.filled();
    navBadge.textContent = n ? String(n) : '';
    navBadge.hidden = n === 0;
    navBadge.title = n ? `当前配装已填 ${n} 个槽位` : '';
  }
}

/* ----------------------------- 占位面板 ----------------------------- */
function loadingPanel(text = '正在载入数据…') {
  return h('div', { class: 'wrap' },
    h('div', { class: 'empty', attrs: { style: 'padding-top:120px' } },
      h('div', { class: 'empty__ico' }, icon('library', { size: 40 })),
      h('div', { class: 'empty__title', text }),
      h('div', { class: 'empty__hint', text: '数据来自本地 data/，不联网。' }),
    ),
  );
}

function errorPanel(err, retry) {
  return h('div', { class: 'wrap' },
    h('div', { class: 'empty', attrs: { style: 'padding-top:100px' } },
      h('div', { class: 'empty__ico' }, icon('warning', { size: 40 })),
      h('div', { class: 'empty__title', text: '页面载入失败' }),
      h('div', { class: 'empty__hint', text: String(err && err.message ? err.message : err) }),
      h('button', { class: 'btn btn--primary', type: 'button', text: '重试', on: { click: retry } }),
    ),
  );
}

/* ----------------------------- 视图派发 ----------------------------- */
async function loadView(domain) {
  if (moduleCache.has(domain)) return moduleCache.get(domain);
  const mod = await import(VIEW_FILES[domain]);
  moduleCache.set(domain, mod);
  return mod;
}

/** 进入干净错误态：丢弃已卸载的视图句柄，保证「重试」从零 mount 一次 */
function failDispatch(err, domain, ctx) {
  if (mounted) {
    try { mounted.view.unmount?.(); } catch (e) { console.error('[view unmount]', e); }
    mounted = null;
  }
  clear(root);
  root.append(errorPanel(err, () => { moduleCache.delete(domain); dispatch(ctx); }));
}

async function dispatch(ctx) {
  const domain = ctx.domain;
  // 同一领域：当前视图仍然有效时交给它处理路由，不必重新挂载。
  // 该分支必须自带 try/catch —— dispatch 是 async，这里抛错会变成未处理拒绝。
  if (mounted && epoch.isCurrent(mounted.token)
    && mounted.domain === domain && typeof mounted.view.onRoute === 'function') {
    try {
      mounted.view.onRoute(ctx);
      syncNav(domain);
      return;
    } catch (err) {
      console.error('[dispatch] onRoute', err);
      failDispatch(err, domain, ctx);
      return;
    }
  }
  const token = epoch.next();
  try {
    if (mounted) {
      try { mounted.view.unmount?.(); } catch (e) { console.error('[view unmount]', e); }
      mounted = null;
    }
    // 无论是否有旧视图都清空容器：错误态重试/并发派发后必须从干净 DOM 开始
    clear(root);
    const mod = await loadView(domain);
    // 等待模块期间可能已有更新的 dispatch：过期就放弃，绝不能把旧视图挂到新页面上
    if (!epoch.isCurrent(token)) return;
    if (!mod || typeof mod.mount !== 'function') throw new Error(`视图 ${domain} 未导出 mount()`);
    const viewRoot = h('div', { class: 'view fade-in' });
    root.append(viewRoot);
    const handle = mod.mount(viewRoot, ctx);
    if (!epoch.isCurrent(token)) {
      // mount 同步执行期间路由又变了：撤销本次挂载，交给最新 dispatch
      try { handle?.unmount?.(); } catch (e) { console.error('[view unmount]', e); }
      viewRoot.remove();
      return;
    }
    mounted = { domain, view: handle || {}, root: viewRoot, token };
    syncNav(domain);
  } catch (err) {
    if (!epoch.isCurrent(token)) {
      // 过期派发的失败不应污染当前视图
      console.error('[dispatch]', err);
      return;
    }
    console.error('[dispatch]', err);
    failDispatch(err, domain, ctx);
  }
}

function syncNav(domain) {
  for (const a of document.querySelectorAll('.domnav__link')) {
    a.classList.toggle('is-on', a.dataset.domain === domain);
  }
  router.setTitle(DOMAIN_ZH[domain] || '');
}

/* ----------------------------- 帮助 ----------------------------- */
function openHelp() {
  const rows = [
    ['点击物品图标 / 名称', '打开详情（桌面居中弹窗 / 移动全屏抽屉）'],
    ['×', '从配装移除（不影响拥有状态）'],
    ['拥有 / 收藏按钮', '独立状态；不影响是否装备'],
    ['点击空槽或「更换」', '打开选择器（可搜索 / 标签筛选 / 排序）'],
    ['/ 或 Ctrl+K', '在资料库聚焦搜索'],
    ['Alt + 1 / 2 / 3 / 4', '切换 资料库 / 实验室 / 流派 / 知识库'],
    ['Alt + T', '切换主题：自动（跟随系统）→ 白天 → 黑夜'],
    ['Esc', '关闭抽屉、弹窗或悬浮层'],
    ['?', '打开本说明'],
  ];
  ui.openModal({
    title: '说明与快捷键',
    body: h('div', { class: 'stack-3' },
      h('p', { class: 'lumen dim', attrs: { style: 'font-size:12px' } },
        '四个领域：资料库（这是什么、怎么获得）、实验室（组合起来怎样）、流派（成型的配装怎么玩）、知识库（机制为什么这样）。'),
      h('div', { class: 'evidence' },
        h('div', { class: 'evidence__row evidence__row--head' },
          h('span', { text: '操作' }), h('span', { text: '' }), h('span', { text: '结果' })),
        rows.map(([k, v]) => h('div', { class: 'evidence__row' },
          h('span', { class: 'evidence__k', text: k }), h('span', { text: '' }), h('span', { text: v }))),
      ),
      h('p', { class: 'muted', attrs: { style: 'font-size:11.5px' } },
        '所有状态只保存在本机浏览器；「拥有」与「收藏」与「是否装备」互相独立。'),
    ),
    foot: h('button', { class: 'btn btn--primary', type: 'button', text: '知道了', on: { click: () => ui.closeModal() } }),
  });
}

/* ----------------------------- 顶栏 / 快捷键 ----------------------------- */
function wireShell() {
  ui.initUI();

  $('#helpBtn')?.addEventListener('click', openHelp);
  document.querySelector('[data-modal-close]')?.addEventListener('click', () => ui.closeModal());

  store.on('owned', updateCounters);
  store.on('fav', updateCounters);
  store.on('build', updateCounters);
  // 持久化写入失败要可见（store 按 key 节流后 emit，见 core/store.js 契约）
  store.on('storage-error', () => {
    ui.toast('本地存储写入失败：本次更改可能不会被保存', 'err', { timeout: 5000 });
  });
  updateCounters();

  document.addEventListener('keydown', (e) => {
    const t = e.target;
    const inField = t instanceof Element && t.matches('input, textarea, select, [contenteditable="true"]');
    if (inField && e.key !== 'Escape') return;
    if (e.altKey && ['1', '2', '3', '4'].includes(e.key)) {
      e.preventDefault();
      router.go(`/${DOMAIN_ORDER[Number(e.key) - 1]}`);
    } else if (e.key === '?' && !e.metaKey && !e.ctrlKey) {
      e.preventDefault();
      openHelp();
    }
  });
}

/* ----------------------------- 启动 ----------------------------- */
async function boot() {
  wireShell();
  clear(root);
  root.append(loadingPanel());

  try {
    await api.ready();
  } catch (err) {
    console.error('[boot]', err);
    clear(root);
    root.append(errorPanel(
      new Error(`无法读取 /data/items.json —— 请用 python serve.py 启动本地服务后访问 http://127.0.0.1:8777/`),
      () => location.reload(),
    ));
    return;
  }

  // 页脚事实
  try {
    const meta = api.meta();
    const items = await api.items();
    const real = items.filter((i) => i.isItem).length;
    $('#footCount').textContent = fmt.num(real);
    if (meta && meta.generated_at) {
      $('#footStamp').textContent = String(meta.generated_at).replace('T', ' ').slice(0, 16);
    }
  } catch { /* 页脚信息非关键 */ }

  clear(root);
  router.onChange(dispatch);
  router.start();
}

boot();
