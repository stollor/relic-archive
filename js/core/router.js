/* =============================================================================
   遗迹2 · 遗物档案 — router.js
   hash 路由（file:// 也能用；无需服务端重写）。
   路由形如 #/items  #/items/sets  #/items/<itemId>  #/lab/calc?profile=fortify_sb
   视图契约：mount(rootEl, ctx) -> { onRoute?(ctx), unmount?() }
   ========================================================================== */

const DOMAINS = new Set(['items', 'lab', 'builds', 'codex']);

let listeners = new Set();
let currentCtx = null;

function parse(hash) {
  let raw = String(hash || '').replace(/^#/, '');
  if (!raw) raw = '/items';
  if (!raw.startsWith('/')) raw = `/${raw}`;
  const qi = raw.indexOf('?');
  const path = (qi >= 0 ? raw.slice(0, qi) : raw).replace(/\/+$/, '') || '/items';
  const query = new URLSearchParams(qi >= 0 ? raw.slice(qi + 1) : '');
  const segs = path.split('/').filter(Boolean);
  const domain = DOMAINS.has(segs[0]) ? segs[0] : 'items';
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

export function setQuery(obj, { replace = true } = {}) {
  const ctx = currentCtx;
  const q = new URLSearchParams(ctx ? ctx.query : undefined);
  for (const [k, v] of Object.entries(obj)) {
    if (v == null || v === '') q.delete(k); else q.set(k, String(v));
  }
  const s = q.toString();
  go(`${ctx ? ctx.path : '/items'}${s ? `?${s}` : ''}`, { replace });
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
  if (!location.hash) history.replaceState(history.state, '', '#/items');
  handleHash();
}

/** 路由 → 文档标题 */
export function setTitle(title) {
  document.title = title ? `${title} · 遗物档案` : '遗物档案 · 遗迹2 数据库';
}

export const router = { start, go, getRoute, onChange, setQuery, setTitle, parse };
export default router;
