/* =============================================================================
   遗迹2 · 遗物档案 — theme.js
   三态主题控制：auto（跟随系统）/ light（白天）/ dark（黑夜）。
   分工：
     · 首屏防闪：index.html 的 head 内联脚本在 CSS 之前写入 html[data-theme] 与 color-scheme；
     · 本模块（head 中 type=module，模块加载即 init）负责后续所有运行时行为：
         1) 同步 <meta name="theme-color">（取 tokens.css 的 --bg-0，唯一色值来源）；
         2) #themeBtn 的图标 / title / aria-label / data-mode；
         3) Alt+T 快捷键（输入框内不触发）与点击循环切换；
         4) auto 模式下监听 prefers-color-scheme 变化并即时生效；
         5) 偏好读写经 store（localStorage["r2.v2.ui"].theme，不新增 key）；
         6) prefers-reduced-motion 下不做视图过渡。
   导出 theme API：theme.init / toggle / set / get / mode
   ========================================================================== */
import { store } from './store.js';

const MODES = ['auto', 'light', 'dark'];
const LABEL = { auto: '自动（跟随系统）', light: '白天', dark: '黑夜' };
/** 三态图标（mode=auto 显示“半明半暗”，light=太阳，dark=月亮） */
const ICONS = {
  auto: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><path d="M12 3.5a8.5 8.5 0 0 1 0 17z" fill="currentColor" stroke="none"/><path d="M12 3.5v17" stroke-width="1.2"/></svg>',
  light: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4.2"/><path d="M12 2.6v2.2M12 19.2v2.2M2.6 12h2.2M19.2 12h2.2M5.4 5.4l1.6 1.6M17 17l1.6 1.6M18.6 5.4 17 7M7 17l-1.6 1.6"/></svg>',
  dark: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20.4 14.3A8.7 8.7 0 0 1 9.7 3.6 8.6 8.6 0 1 0 20.4 14.3z"/></svg>',
};
const NEXT = { auto: 'light', light: 'dark', dark: 'auto' };

const root = document.documentElement;
const mqlLight = window.matchMedia ? window.matchMedia('(prefers-color-scheme: light)') : null;
const mqlMotion = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;

let inited = false;
let applying = false; // set() 写 store 时抑制 'ui' 监听回环

/* ----------------------------- 解析 ----------------------------- */
function systemTheme() { return mqlLight && mqlLight.matches ? 'light' : 'dark'; }
function mode() { return store.ui.theme(); }
function resolve(m) { return m === 'auto' ? systemTheme() : (m === 'light' ? 'light' : 'dark'); }
function get() { return resolve(mode()); }
function prefersReducedMotion() { return !!(mqlMotion && mqlMotion.matches); }

/* ----------------------------- 应用 ----------------------------- */
function syncMeta() {
  const meta = document.getElementById('themeColorMeta');
  if (!meta) return;
  let color = '';
  try {
    // 唯一色值来源：tokens.css 的 --bg-0（亮/暗各自解析后的实际底色）
    color = getComputedStyle(root).getPropertyValue('--bg-0').trim();
  } catch { /* ignore */ }
  if (!color) return; // 样式表未就绪时不写：宁可不更新，也不引入第二份色值
  meta.setAttribute('content', color);
}

function syncButton(m) {
  const btn = document.getElementById('themeBtn');
  if (!btn) return;
  btn.innerHTML = ICONS[m] || ICONS.auto;
  const label = `主题：${LABEL[m] || LABEL.auto}`;
  btn.title = label;
  btn.setAttribute('aria-label', label);
  btn.dataset.mode = m;
  btn.setAttribute('aria-pressed', m === 'dark' ? 'true' : 'false');
}

function paint(m) {
  const resolved = resolve(m);
  root.dataset.theme = resolved;
  root.dataset.themeMode = m;
  try { root.style.colorScheme = resolved; } catch { /* ignore */ }
  syncMeta();
  syncButton(m);
  return resolved;
}

/** 切换应用；支持 View Transitions 时做柔和交叉淡入，reduced-motion / 不支持时直接切换 */
let vt = null; // 进行中的 ViewTransition（避免快速连点时叠加报错）
function apply(m, { animate = true } = {}) {
  if (!animate || prefersReducedMotion() || typeof document.startViewTransition !== 'function') {
    return paint(m);
  }
  if (vt) return paint(m); // 上一段过渡还没结束：本次直接落值，不叠过渡
  let resolved = resolve(m);
  try {
    const t = document.startViewTransition(() => { resolved = paint(m); });
    vt = t;
    const clear = () => { if (vt === t) vt = null; };
    for (const key of ['ready', 'updateCallbackDone', 'finished']) {
      const p = t && t[key];
      if (p && typeof p.catch === 'function') p.catch(() => {}).then(clear, clear);
    }
    // 过渡被浏览器跳过时兜底落值，保证主题状态最终一致
    const done = t && t.finished;
    if (done && typeof done.then === 'function') {
      done.then(() => {}, () => {}).then(() => {
        if (root.dataset.themeMode !== m) paint(m);
      });
    }
  } catch {
    resolved = paint(m);
  }
  return resolved;
}

/* ----------------------------- 对外 API ----------------------------- */
function set(v) {
  const m = MODES.includes(v) ? v : 'auto';
  applying = true;
  try { store.ui.setTheme(m); } finally { applying = false; }
  apply(m);
  return m;
}

function toggle() {
  return set(NEXT[mode()] || 'auto');
}

function init() {
  if (inited) return theme;
  inited = true;

  // 与首屏内联脚本对齐（内联脚本可能因异常未执行，这里兜底重画）
  paint(mode());

  const btn = document.getElementById('themeBtn');
  if (btn) btn.addEventListener('click', () => toggle());

  document.addEventListener('keydown', (e) => {
    if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    if (e.key !== 't' && e.key !== 'T') return;
    const t = e.target;
    if (t instanceof Element && t.matches('input, textarea, select, [contenteditable="true"]')) return;
    e.preventDefault();
    toggle();
  });

  const onSystemChange = () => { if (mode() === 'auto') apply('auto'); };
  if (mqlLight) {
    if (mqlLight.addEventListener) mqlLight.addEventListener('change', onSystemChange);
    else if (mqlLight.addListener) mqlLight.addListener(onSystemChange);
  }

  // 其他模块（如重置偏好）改了 theme 时保持同步；自身写入已在 set() 中即时应用，故按值去重
  store.on('ui', ({ key, value } = {}) => {
    if (applying || key !== 'theme' || !MODES.includes(value)) return;
    if (root.dataset.themeMode === value) return;
    apply(value);
  });

  return theme;
}

export const theme = { init, toggle, set, get, mode };
export default theme;

/* 模块加载即初始化（index.html 在 head 中以 type="module" 引入） */
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init, { once: true });
} else {
  init();
}
