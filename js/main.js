/* =============================================================================
   遗迹2 · 遗物档案 — main.js
   应用外壳：初始化、路由派发、视图生命周期、顶栏状态、错误边界。
   领域清单（导航 / 标题 / 快捷键 / 视图与样式加载）唯一来源：js/domains.js。
   视图契约：mount(rootEl, ctx) -> { onRoute?(ctx), unmount?() }
   ========================================================================== */
import { router } from './core/router.js';
import { api } from './core/api.js';
import { store } from './core/store.js';
import { ui } from './core/ui.js';
import { h, $, clear, fmt } from './core/dom.js';
import { icon } from './core/icons.js';
import { createEpoch } from './core/task.js';
import { loadingState, errorState } from './components/states.js';
import { DOMAINS, DEFAULT_DOMAIN, domainById, domainLabel, isDomain, shortcutDomains } from './domains.js';

const root = $('#view-root');
let mounted = null;
let navBadgeEl = null;
const moduleCache = new Map();
/* 样式 href → 载入 Promise：每个视图样式只注入一次，且 mount 前必须就位 */
const styleLinks = new Map();
/* 派发代际：只有最新一次 dispatch 有权挂载视图，晚返回的旧 dispatch 直接放弃 */
const epoch = createEpoch();
/* Alt+数字 → 领域：由 domains.js 的 shortcut 字段生成 */
const shortcuts = new Map(shortcutDomains().map(({ key, domain }) => [key, domain]));

/* ----------------------------- 顶栏导航 ----------------------------- */
function renderNav() {
  const nav = $('#domnav');
  if (!nav) return;
  clear(nav);
  for (const d of DOMAINS) {
    const link = h('a', {
      class: 'domnav__link',
      dataset: { domain: d.id },
      attrs: { href: `#${d.path}` },
    }, icon(d.icon, { size: 16 }), h('span', { text: d.zh }));
    // badge：'build' = 挂「当前配装已填槽位」计数（updateCounters 填充）
    if (d.badge === 'build') link.append(h('span', { class: 'domnav__count', hidden: true }));
    nav.append(link);
  }
  navBadgeEl = nav.querySelector('.domnav__count');
}

/* --------------------------- 视图样式（懒注入） --------------------------- */
function injectStyle(href) {
  const cached = styleLinks.get(href);
  if (cached) return cached;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = href;
  const done = new Promise((resolve) => {
    link.addEventListener('load', () => resolve(), { once: true });
    // 载入失败不阻塞视图：内容优先，基础样式（tokens/base/components）仍在
    link.addEventListener('error', () => {
      console.warn('[styles] 视图样式载入失败：', href);
      resolve();
    }, { once: true });
  });
  document.head.append(link);
  styleLinks.set(href, done);
  return done;
}

function ensureStyles(domain) {
  const def = domainById(domain);
  return Promise.all(((def && def.styles) || []).map(injectStyle));
}

/* ----------------------------- 状态条 ----------------------------- */
function updateCounters() {
  const owned = $('#statOwned b');
  const fav = $('#statFav b');
  if (owned) owned.textContent = store.ownedCount();
  if (fav) fav.textContent = store.favCount();
  if (navBadgeEl) {
    const n = store.build.filled();
    navBadgeEl.textContent = n ? String(n) : '';
    navBadgeEl.hidden = n === 0;
    navBadgeEl.title = n ? `当前配装已填 ${n} 个槽位` : '';
  }
}

/* ----------------------------- 视图派发 ----------------------------- */
async function loadView(domain) {
  if (moduleCache.has(domain)) return moduleCache.get(domain);
  const def = domainById(domain);
  if (!def || typeof def.load !== 'function') throw new Error(`未知领域：${domain}`);
  // 样式与视图模块并行加载；首次进入领域时两者都就位后才允许 mount（避免无样式首屏）
  const [mod] = await Promise.all([def.load(), ensureStyles(domain)]);
  if (!mod || typeof mod.mount !== 'function') throw new Error(`视图 ${domain} 未导出 mount()`);
  moduleCache.set(domain, mod);
  return mod;
}

/** 进入干净错误态：丢弃已卸载的视图句柄，保证「重试」从零 mount 一次 */
function failDispatch(err, domain, ctx) {
  // 错误态覆盖全屏前，先关掉上/当前视图的浮层：避免 modal / body 滚动锁跨域残留
  closeViewOverlays();
  if (mounted) {
    try { mounted.view.unmount?.(); } catch (e) { console.error('[view unmount]', e); }
    mounted = null;
  }
  clear(root);
  root.append(errorState({
    err,
    onRetry: () => { moduleCache.delete(domain); dispatch(ctx); },
  }));
}

async function dispatch(ctx) {
  const domain = ctx.domain;
  // 未知领域：统一替换到默认领域（replace 不污染前进/后退；isDomain 保证不会循环重定向）
  if (!isDomain(domain)) {
    const fallback = domainById(DEFAULT_DOMAIN);
    if (fallback) router.go(fallback.path, { replace: true });
    return;
  }
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
    // 跨域切换先关掉上一个视图留下的浮层（同领域 onRoute 分支不经过这里，浮层归视图自己管）。
    // 否则 history.back() 回到别的领域后 #modal 还开着、body 滚动锁死（P0 审计）。
    closeViewOverlays();
    if (mounted) {
      try { mounted.view.unmount?.(); } catch (e) { console.error('[view unmount]', e); }
      mounted = null;
    }
    // 无论是否有旧视图都清空容器：错误态重试/并发派发后必须从干净 DOM 开始
    clear(root);
    // 首屏/切换期间保持载入态：视图模块与数据都可能需要等待，不能留空白区
    root.append(loadingState());
    // 模块/样式与数据并行加载；挂载前两者都必须就位（无样式首屏 / 图标先占位再替换都是回归）
    const modP = loadView(domain);
    if (needsReady(domain)) {
      try {
        await api.ready();
      } catch (err) {
        // 数据失败与模块加载互相独立：先吞掉模块侧拒绝，避免未处理拒绝，再由 failDispatch 渲染错误态
        modP.catch(() => {});
        if (!epoch.isCurrent(token)) {
          console.error('[dispatch]', err);
          return;
        }
        console.error('[dispatch]', err);
        failDispatch(readyError(err), domain, ctx);
        return;
      }
      // 页脚事实（footCount/footStamp）非首屏关键路径：就绪后异步填，绝不阻塞 mount
      fillFooterFacts();
    }
    const mod = await modP;
    // 等待模块/样式/数据期间可能已有更新的 dispatch：过期就放弃，绝不能把旧视图挂到新页面上
    if (!epoch.isCurrent(token)) return;
    clear(root);
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
  router.setTitle(domainLabel(domain));
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
  const domainsLine = `四个领域：${DOMAINS.map((d) => `${d.zh}（${d.purpose}）`).join('、')}。`;
  ui.openModal({
    title: '说明与快捷键',
    body: h('div', { class: 'stack-3' },
      h('p', { class: 'lumen dim', attrs: { style: 'font-size:12px' } }, domainsLine),
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
  renderNav();

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
    const target = e.altKey ? shortcuts.get(e.key) : null;
    if (target) {
      e.preventDefault();
      router.go(target.path);
    } else if (e.key === '?' && !e.metaKey && !e.ctrlKey) {
      e.preventDefault();
      openHelp();
    }
  });
}

/* ----------------------------- 数据前置 ----------------------------- */
/**
 * 该领域首屏是否需要全量数据（items + item_effects + icon_index）。
 * 由注册表 js/domains.js 的 bootstrap 字段决定：false 的领域（目前只有 codex）
 * 进入前不调用 api.ready()，直链 #/codex 因此不会下载 7.3MB 的 items。
 */
function needsReady(domain) {
  const def = domainById(domain);
  return !!def && def.bootstrap !== false;
}

/** 全量数据读取失败的统一提示（保留旧 boot 错误态里的本地服务器指引） */
function readyError(err) {
  const out = new Error('无法读取 /data/items.json —— 请用 python serve.py 启动本地服务后访问 http://127.0.0.1:8777/');
  out.cause = err;
  return out;
}

/** 页脚事实：数据就绪后异步填充，绝不阻塞首屏。
 *  codex 直链不会触发（保持 HTML 里的「—」占位），直到用户首次进入需要数据的领域。 */
let footerFilled = false;
async function fillFooterFacts() {
  if (footerFilled) return;
  footerFilled = true;
  try {
    const items = await api.items();
    const meta = api.meta();
    const countEl = $('#footCount');
    const stampEl = $('#footStamp');
    if (countEl) countEl.textContent = fmt.num(items.filter((it) => it.isItem).length);
    if (stampEl && meta && meta.generated_at) {
      stampEl.textContent = String(meta.generated_at).replace('T', ' ').slice(0, 16);
    }
  } catch (err) {
    footerFilled = false;   // 数据暂时不可用：下次进入领域再试，别把页脚永久卡死
    console.warn('[boot] 页脚统计不可用', err);
  }
}

/**
 * 跨域切换 / 进入错误态前，关闭上一个视图自己的浮层（modal / drawer / tip）并归还 body 滚动锁。
 * 统一实现见 core/ui.js 的 closeOverlays；silent: 已卸载视图的 onClose 不得再写 DOM/路由。
 */
function closeViewOverlays() {
  try {
    ui.closeOverlays({ silent: true });
  } catch (err) {
    console.warn('[dispatch] 关闭浮层失败', err);
  }
}

/* ----------------------------- 启动 ----------------------------- */
async function boot() {
  wireShell();
  clear(root);
  root.append(loadingState());
  // boot 不再等待全量数据：路由立即启动，视图各自加载数据。
  // 需要 items+icons 才能正确首屏的领域由 dispatch 在 mount 前等待 api.ready()（见 needsReady）；
  // codex 这类 bootstrap:false 的领域直链不会触发 items/effects/icons 下载。
  router.onChange(dispatch);
  router.start();
}

boot();
