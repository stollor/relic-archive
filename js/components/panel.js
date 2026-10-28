/* =============================================================================
   遗迹2 · 遗物档案 — components/panel.js
   全站唯一的面板骨架（.panel / .panel__head / .panel__title / .panel__body）。
   实验室面板与流派区块共用：调用方只给标题与内容，不再各自拼标记或反查 DOM。
   ========================================================================== */
import { h } from '../core/dom.js';
import { icon } from '../core/icons.js';

/**
 * @param {object} o
 * @param {string} o.title          面板标题
 * @param {string} o.icon           标题图标名（可空）
 * @param {string} o.sub            标题右侧说明（可空）
 * @param {Node[]} o.tools          标题右侧工具区（按钮等，可空）
 * @param {Node|string|null} o.body 面板主体
 * @param {boolean} o.flush         主体是否去掉内边距（.panel__body--flush）
 * @param {string} o.tag            容器标签，默认 section
 * @returns {{el:HTMLElement, head:HTMLElement, title:HTMLElement, tools:HTMLElement, body:HTMLElement}}
 */
export function panel(o = {}) {
  const {
    title = '', icon: iconName = '', sub = '', tools = [], body = null, flush = false, tag = 'section',
  } = o;
  const titleEl = h('h2', { class: 'panel__title' },
    iconName ? icon(iconName, { size: 15 }) : null,
    h('span', { text: title }));
  const toolsEl = h('div', { class: 'panel__tools' }, ...(tools || []));
  const bodyEl = h('div', { class: `panel__body${flush ? ' panel__body--flush' : ''}` }, body);
  const head = h('div', { class: 'panel__head' },
    titleEl,
    sub ? h('span', { class: 'panel__sub', text: sub }) : null,
    toolsEl);
  const el = h(tag, { class: 'panel' }, head, bodyEl);
  return { el, head, title: titleEl, tools: toolsEl, body: bodyEl };
}

export default panel;
