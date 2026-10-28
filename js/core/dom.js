/* =============================================================================
   遗迹2 · 遗物档案 — dom.js
   极简 DOM 工具：h() 建元素、查询、事件委托、格式化。零依赖。
   ========================================================================== */

const SVG_NS = 'http://www.w3.org/2000/svg';

/* ----------------------------- 元素创建 ----------------------------- */
/**
 * h('div', {class:'a', on:{click:fn}, dataset:{id:'x'}, text:'hi'}, child1, child2, ...)
 * child 可为 Node / 字符串 / 数字 / 数组 / null
 */
export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v == null || v === false) continue;
      if (k === 'class' || k === 'className') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k === 'html') el.innerHTML = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k === 'on' && typeof v === 'object') {
        for (const [ev, fn] of Object.entries(v)) el.addEventListener(ev, fn);
      } else if (k === 'attrs' && typeof v === 'object') {
        for (const [a, av] of Object.entries(v)) if (av != null && av !== false) el.setAttribute(a, av === true ? '' : av);
      } else if (k in el && k !== 'list' && typeof v !== 'object') {
        try { el[k] = v; } catch { el.setAttribute(k, v); }
      } else el.setAttribute(k, v === true ? '' : v);
    }
  }
  append(el, children);
  return el;
}

export function append(el, children) {
  for (const c of children.flat(6)) {
    if (c == null || c === false || c === '') continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export function frag(...children) {
  const f = document.createDocumentFragment();
  append(f, children);
  return f;
}

/* SVG 元素（图标外的手绘图表用） */
export function svg(tag, attrs = {}, ...children) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) el.setAttribute(k, v);
  for (const c of children.flat(4)) if (c != null) el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return el;
}

/* ----------------------------- 查询 / 操作 ----------------------------- */
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
export const clear = (el) => { while (el.firstChild) el.removeChild(el.firstChild); return el; };
export const on = (el, type, sel, fn) => el.addEventListener(type, (e) => {
  const t = e.target.closest(sel);
  if (t && el.contains(t)) fn(e, t);
});
export const off = (el, type, fn) => el.removeEventListener(type, fn);

/* ----------------------------- 文本 ----------------------------- */
const ESC_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ESC_MAP[c]);
export const stripTags = (s) => String(s == null ? '' : s).replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
export const attr = (s) => esc(s).replace(/`/g, '&#96;');

/* ----------------------------- 格式化 ----------------------------- */
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
export const fmt = {
  num(v, d = 0) {
    if (!isNum(v)) return '—';
    return v.toLocaleString('zh-CN', { minimumFractionDigits: d, maximumFractionDigits: d });
  },
  int(v) { return isNum(v) ? Math.round(v).toLocaleString('zh-CN') : '—'; },
  pct(v, d = 1) { return isNum(v) ? `${(v * 100).toFixed(d)}%` : '—'; },
  pp(v, d = 1) { return isNum(v) ? `${v > 0 ? '+' : ''}${(v * 100).toFixed(d)}pp` : '—'; },
  kg(v, d = 1) { return isNum(v) ? `${v.toFixed(d)}` : '—'; },
  sign(v, d = 0) { return isNum(v) ? `${v > 0 ? '+' : ''}${fmt.num(v, d)}` : '—'; },
  /** 毫秒 → 可读 */
  ms(v) { return isNum(v) ? (v >= 1000 ? `${(v / 1000).toFixed(1)}s` : `${Math.round(v)}ms`) : '—'; },
};

/* ----------------------------- 杂项 ----------------------------- */
export function debounce(fn, ms = 160) {
  let t = 0;
  const wrapped = (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
  wrapped.cancel = () => clearTimeout(t);
  return wrapped;
}

export function raf(fn) { return requestAnimationFrame(fn); }

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

export function cmpText(a, b) {
  return String(a || '').localeCompare(String(b || ''), 'zh-Hans-CN', { numeric: true, sensitivity: 'base' });
}

export function unique(arr) { return Array.from(new Set(arr)); }

export function groupBy(arr, keyFn) {
  const m = new Map();
  for (const it of arr) {
    const k = keyFn(it);
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(it);
  }
  return m;
}

/** 复制到剪贴板（带降级） */
export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;left:-9999px;top:0';
    document.body.append(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { ok = false; }
    ta.remove();
    return ok;
  }
}

/** 下载文本文件 */
export function downloadText(filename, text, mime = 'application/json') {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** 让元素可点击/可聚焦（div 当按钮用时的可访问性补齐） */
export function clickable(el, fn, label) {
  el.tabIndex = 0;
  el.setAttribute('role', 'button');
  if (label) el.setAttribute('aria-label', label);
  el.addEventListener('click', fn);
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fn(e); }
  });
  return el;
}
