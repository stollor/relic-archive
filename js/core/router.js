/* =============================================================================
   遗迹2 · 遗物档案 — router.js
   hash 路由（file:// 也能用；无需服务端重写）。
   路由形如 #/items  #/items/sets  #/items/<itemId>  #/lab/calc?profile=fortify_sb
   领域清单与默认领域归应用壳（js/domains.js）；router 只解析路由形态、不校验领域。
   视图契约：mount(rootEl, ctx) -> { onRoute?(ctx), unmount?() }
   ========================================================================== */

let listeners = new Set();
let currentCtx = null;

function parse(hash) {
  let raw = String(hash || '').replace(/^#/, '');
  if (!raw.startsWith('/')) raw = `/${raw}`;
  const qi = raw.indexOf('?');
  const path = (qi >= 0 ? raw.slice(0, qi) : raw).replace(/\/+$/, '');
  const query = new URLSearchParams(qi >= 0 ? raw.slice(qi + 1) : '');
  const segs = path.split('/').filter(Boolean);
  const domain = segs[0] || '';
  const params = {};
  for (const [k, v] of query.entries()) params[k] = v;
  return {
    path,
    domain,
    segs,
    sub: segs[1] || '',
    rest: segs.slice(1),
    query,
    params,
    hash: raw,
  };
}

export function getRoute() { return currentCtx; }

export function go(path, { replace = false } = {}) {
  const target = `#${path.startsWith('/') ? path : `/${path}`}`;
  if (replace) {
    history.replaceState(history.state, '', target);
    handleHash();
  } else if (location.hash !== target) {
    location.hash = target;
  } else {
    handleHash();
  }
}

/**
 * 只改地址栏、不触发派发：用于「详情打开」这类装饰性 URL 同步
 * （不能让地址栏变化重置视图状态，也不该消费一次路由事件）。
 * 真正的导航一律用 go()。
 */
export function replaceSilently(path) {
  const target = `#${path.startsWith('/') ? path : `/${path}`}`;
  if (location.hash === target) return false;
  history.replaceState(history.state, '', target);
  return true;
}

export function setQuery(obj, { replace = true } = {}) {
  const ctx = currentCtx;
  const q = new URLSearchParams(ctx ? ctx.query : undefined);
  for (const [k, v] of Object.entries(obj)) {
    if (v == null || v === '') q.delete(k); else q.set(k, String(v));
  }
  const s = q.toString();
  go(`${ctx ? ctx.path : '/'}${s ? `?${s}` : ''}`, { replace });
}

export function onChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function handleHash() {
  const prev = currentCtx;
  const ctx = parse(location.hash);
  currentCtx = ctx;
  // 路由变化时回到顶部（同一子路由内的参数变化不回顶）
  if (!prev || prev.path !== ctx.path) window.scrollTo({ top: 0, behavior: 'instant' in window ? 'auto' : 'auto' });
  for (const fn of listeners) {
    try { fn(ctx, prev); } catch (e) { console.error('[router]', e); }
  }
}

export function start() {
  window.addEventListener('hashchange', handleHash);
  // 空 hash 不在这里兜底：parse() 给出 domain=''，由应用壳统一重定向到默认领域
  handleHash();
}

/** 路由 → 文档标题 */
export function setTitle(title) {
  document.title = title ? `${title} · 遗物档案` : '遗物档案 · 遗迹2 数据库';
}

export const router = {
  start, go, getRoute, onChange, setQuery, setTitle, parse, replaceSilently,
};
export default router;
