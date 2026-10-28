/* =============================================================================
   遗迹2 · 遗物档案 — components/states.js
   全站唯一的「空 / 错误 / 载入」状态渲染。
   视图只提供语义（为什么空、怎么恢复），标记与图标尺寸由这里统一决定。
   ========================================================================== */
import { h } from '../core/dom.js';
import { icon } from '../core/icons.js';

/**
 * 状态内容（不含容器）——用于复用现成的 .empty 容器（如资料库的结果区）。
 * @param {object} o
 * @param {string|null} o.icon      图标名；null = 不要图标（如「找不到物品」）
 * @param {number} o.iconSize       图标像素
 * @param {string} o.title          主标题
 * @param {string} o.hint           说明
 * @param {Node[]} o.actions        按钮等操作
 * @param {string} o.titleTag       'div' | 'h3'（区块内空态用 h3 保留标题层级）
 * @returns {Node[]}
 */
export function emptyBody(o = {}) {
  const {
    icon: iconName = null, iconSize = 40, title = '', hint = '',
    actions = [], titleTag = 'div',
  } = o;
  const out = [];
  if (iconName) out.push(h('div', { class: 'empty__ico' }, icon(iconName, { size: iconSize })));
  if (title) out.push(h(titleTag, { class: 'empty__title', text: title }));
  if (hint) out.push(h('p', { class: 'empty__hint', text: hint }));
  for (const a of actions) if (a) out.push(a);
  return out;
}

/**
 * 独立的空状态容器（.empty）。
 * @param {object} o emptyBody 的字段 + { cls='', padTop=0 }
 * @returns {HTMLElement}
 */
export function emptyState(o = {}) {
  const { cls = '', padTop = 0 } = o;
  const el = h('div', {
    class: `empty${cls ? ` ${cls}` : ''}`,
    attrs: padTop ? { style: `padding-top:${padTop}px` } : undefined,
  });
  el.append(...emptyBody(o));
  return el;
}

/** 载入中（首屏 / 视图切换）。 */
export function loadingState({ text = '正在载入数据…', hint = '数据来自本地 data/，不联网。', padTop = 120 } = {}) {
  return h('div', { class: 'wrap' }, emptyState({ icon: 'library', title: text, hint, padTop }));
}

/**
 * 载入失败 + 重试。
 * @param {object} o { title?, err?, hint?, onRetry?, retryText?, padTop? }
 */
export function errorState(o = {}) {
  const {
    title = '页面载入失败',
    err = null,
    hint = '',
    onRetry = null,
    retryText = '重试',
    padTop = 100,
    iconSize = 40,
  } = o;
  const detail = hint || (err ? String(err && err.message ? err.message : err) : '');
  const actions = onRetry
    ? [h('button', { class: 'btn btn--primary', type: 'button', text: retryText, on: { click: onRetry } })]
    : [];
  return h('div', { class: 'wrap' },
    emptyState({ icon: 'warning', iconSize, title, hint: detail, actions, padTop }));
}
