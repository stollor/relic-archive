/* =============================================================================
   遗迹2 · 遗物档案 — dom.js
   极简 DOM 工具：h() 建元素、查询、事件委托、格式化。零依赖。
   安全边界（P2-4）：
     · h() 不提供原始 HTML 入口；文本一律 textContent/文本节点；
     · 富文本（提示气泡等）走 richText() 白名单：只认 b/strong/i/em/br/code，
       无属性，其余标签按纯文本，实体解码；禁止用原始 HTML 写入拼数据；
     · href 统一 safeHref() 协议白名单（#/相对/根路径/http(s)），非法协议不写 href；
       http(s) 外链自动补 target=_blank / rel=noopener noreferrer。
   ========================================================================== */

const SVG_NS = 'http://www.w3.org/2000/svg';

/* ----------------------------- 安全 URL ----------------------------- */
const HREF_SCHEME_RE = /^([a-z][a-z0-9+.-]*):/i;
const SAFE_HREF_SCHEMES = new Set(['http', 'https']);
const RELATIVE_HREF_RE = /^(?:#|\?|\.{0,2}\/|\/)/; // #锚点 / ?query / ./ ../ / /根路径
const CONTROL_CHAR_RE = /[\u0000-\u001F\u007F]/;

/**
 * 链接协议白名单：只放行 #、相对路径、/、? 与 http(s)。
 * javascript:/data:/vbscript:/file:/blob: 等一律返回 null（调用方不写 href）。
 */
export function safeHref(value) {
  const raw = String(value == null ? '' : value).trim();
  if (!raw || CONTROL_CHAR_RE.test(raw)) return null;
  if (raw.startsWith('//')) return null; // 协议相对外链：站点不使用，按不安全处理
  const schemeMatch = raw.match(HREF_SCHEME_RE);
  if (schemeMatch) {
    const scheme = schemeMatch[1].toLowerCase();
    return SAFE_HREF_SCHEMES.has(scheme) ? raw : null;
  }
  if (RELATIVE_HREF_RE.test(raw)) return raw;
  if (raw.includes(':')) return null; // 未知协议/带冒号路径
  return raw; // 普通相对路径（x/y）
}

/* 白名单富文本：仅这些标签 + br；其余标签当纯文本 */
const RICH_TAGS = new Set(['b', 'strong', 'i', 'em', 'code']);
const RICH_VOID = new Set(['br']);
const RICH_TAG_RE = /<(\/?)(b|strong|i|em|code|br)\s*>/gi;
const ENTITY_RE = /&(?:#(\d+)|#x([0-9a-f]+)|([a-z]+));/gi;
const NAMED_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00A0' };

function decodeEntities(text) {
  if (!text.includes('&')) return text;
  return text.replace(ENTITY_RE, (whole, dec, hex, name) => {
    if (dec) {
      const code = Number(dec);
      return code > 0 && code <= 0x10FFFF ? String.fromCodePoint(code) : whole;
    }
    if (hex) {
      const code = Number.parseInt(hex, 16);
      return code > 0 && code <= 0x10FFFF ? String.fromCodePoint(code) : whole;
    }
    return Object.prototype.hasOwnProperty.call(NAMED_ENTITIES, name.toLowerCase())
      ? NAMED_ENTITIES[name.toLowerCase()]
      : whole;
  });
}

/**
 * 富文本 → token 数组（纯函数，便于 node 单测）：
 *   {type:'text',value} | {type:'br'} | {type:'open',tag} | {type:'close',tag}
 * 非白名单标签（<img>/<script>/带属性标签…）都留在文本 token 里，绝不会变成元素。
 */
export function richTextParts(input) {
  const src = String(input == null ? '' : input);
  const parts = [];
  const re = new RegExp(RICH_TAG_RE.source, 'gi');
  let last = 0;
  let m;
  while ((m = re.exec(src)) !== null) {
    if (m.index > last) parts.push({ type: 'text', value: decodeEntities(src.slice(last, m.index)) });
    const tag = m[2].toLowerCase();
    if (RICH_VOID.has(tag)) {
      if (!m[1]) parts.push({ type: 'br' });
    } else {
      parts.push({ type: m[1] ? 'close' : 'open', tag });
    }
    last = m.index + m[0].length;
  }
  if (last < src.length) parts.push({ type: 'text', value: decodeEntities(src.slice(last)) });
  return parts;
}

/** 富文本 → DocumentFragment（只创建白名单元素 + 文本节点） */
export function richText(input) {
  const frag = document.createDocumentFragment();
  const stack = [frag];
  for (const part of richTextParts(input)) {
    const parent = stack[stack.length - 1];
    if (part.type === 'text') parent.append(document.createTextNode(part.value));
    else if (part.type === 'br') parent.append(document.createElement('br'));
    else if (part.type === 'open') {
      const el = document.createElement(part.tag);
      parent.append(el);
      stack.push(el);
    } else {
      let match = -1;
      for (let i = stack.length - 1; i >= 1; i -= 1) {
        if (stack[i].tagName.toLowerCase() === part.tag) { match = i; break; }
      }
      if (match > 0) stack.length = match;
    }
  }
  return frag;
}

/** http(s) 外链统一安全策略（供 h() 与调用方复用） */
export function applyExternalLinkPolicy(el) {
  if (!el || typeof el.getAttribute !== 'function') return el;
  const href = String(el.getAttribute('href') || '');
  if (!/^https?:\/{2}/i.test(href)) return el;
  if (!el.getAttribute('target')) el.setAttribute('target', '_blank');
  const rel = new Set(String(el.getAttribute('rel') || '').split(/\s+/).filter(Boolean));
  rel.add('noopener');
  rel.add('noreferrer');
  el.setAttribute('rel', [...rel].join(' '));
  return el;
}

function setHref(el, value) {
  const href = safeHref(value);
  if (href == null) return false;
  el.setAttribute('href', href);
  applyExternalLinkPolicy(el);
  return true;
}

/* ----------------------------- 元素创建 ----------------------------- */
/**
 * h('div', {class:'a', on:{click:fn}, dataset:{id:'x'}, text:'hi'}, child1, child2, ...)
 * child 可为 Node / 字符串 / 数字 / 数组 / null
 * 注意：不支持 html 原始 HTML 属性；需要富文本时显式使用 richText()。
 */
export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v == null || v === false) continue;
      if (k === 'class' || k === 'className') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k === 'href') setHref(el, v);
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k === 'on' && typeof v === 'object') {
        for (const [ev, fn] of Object.entries(v)) el.addEventListener(ev, fn);
      } else if (k === 'attrs' && typeof v === 'object') {
        for (const [a, av] of Object.entries(v)) {
          if (av == null || av === false) continue;
          if (a === 'href') setHref(el, av);
          else el.setAttribute(a, av === true ? '' : av);
        }
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
  /** 定点小数（四舍五入）；非数字给 '—' */
  round(v, d = 1) { return isNum(v) ? Number(v.toFixed(d)) : '—'; },
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
