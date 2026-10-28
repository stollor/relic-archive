/* =============================================================================
   遗迹2 · 遗物档案 — ui.js
   全站唯一浮层基础设施：Toast / 确认框 / 抽屉 / 弹窗 / 悬浮说明。
   视图禁止自建这五类组件。DOM 宿主：#scrim #drawer #modal #toasts #tip（index.html 内）
   ========================================================================== */
import { h, $, clear, esc } from './dom.js';
import { icon } from './icons.js';

/* ----------------------------- 宿主 ----------------------------- */
const host = {};
function ensureHost() {
  if (!host.toasts) host.toasts = $('#toasts');
  if (!host.tip) host.tip = $('#tip');
  if (!host.scrim) host.scrim = $('#scrim');
  if (!host.drawer) host.drawer = $('#drawer');
  if (!host.modal) host.modal = $('#modal');
}
const getHost = () => { ensureHost(); return host; };

/* ----------------------------- 焦点管理 ----------------------------- */
let lastFocus = null;
function saveFocus() { if (document.activeElement && document.activeElement !== document.body) lastFocus = document.activeElement; }
function restoreFocus() { try { lastFocus?.focus?.({ preventScroll: true }); } catch { /* ignore */ } lastFocus = null; }

/* ============================ Toast ============================ */
const TOAST_ICON = { ok: 'check-circle', warn: 'warning', err: 'x-circle', info: 'info' };
let toastSeq = 0;

export function toast(msg, kind = 'info', opts = {}) {
  const { toasts } = getHost();
  if (!toasts) return () => {};
  const id = `t${++toastSeq}`;
  const el = h('div', { class: `toast toast--${kind}`, attrs: { role: 'status' } },
    icon(TOAST_ICON[kind] || 'info', { size: 14 }),
    h('span', { text: msg }),
  );
  if (opts.action) {
    el.append(h('button', {
      class: 'toast__act', type: 'button', text: opts.action.label,
      on: { click: () => { opts.action.fn(); close(); } },
    }));
  }
  const close = () => {
    if (!el.isConnected) return;
    el.style.opacity = '0';
    el.style.transform = 'translateY(4px)';
    setTimeout(() => el.remove(), 160);
  };
  toasts.append(el);
  // 最多 3 条
  while (toasts.children.length > 3) toasts.firstElementChild.remove();
  const timer = setTimeout(close, opts.timeout ?? (opts.action ? 6000 : 2600));
  el.addEventListener('mouseenter', () => clearTimeout(timer));
  return close;
}

/* ============================ 抽屉 ============================ */
const drawerState = { open: false, onClose: null, key: null };

export function openDrawer({
  title = '', subtitle = '', iconName = '', tools = [], body = null, foot = null,
  width = '', onClose = null, route = '', closeOnScrim = true,
} = {}) {
  const { drawer, scrim } = getHost();
  saveFocus();
  clear(drawer.querySelector('.drawer__head'));
  clear(drawer.querySelector('.drawer__body'));
  clear(drawer.querySelector('.drawer__foot'));

  const head = drawer.querySelector('.drawer__head');
  head.append(
    iconName ? icon(iconName, { size: 17, cls: 'drawer__ico' }) : '',
    h('div', { class: 'grow drawer__titles' },
      h('div', { class: 'drawer__title', text: title }),
      subtitle ? h('div', { class: 'drawer__sub muted', text: subtitle }) : '',
    ),
  );
  const toolWrap = h('div', { class: 'drawer__tools' });
  for (const t of tools) toolWrap.append(t);
  toolWrap.append(h('button', {
    class: 'iconbtn', type: 'button', title: '关闭（Esc）', 'aria-label': '关闭',
    on: { click: () => closeDrawer() },
  }, icon('x', { size: 16 })));
  head.append(toolWrap);

  const bodyEl = drawer.querySelector('.drawer__body');
  if (body) bodyEl.append(body);
  const footEl = drawer.querySelector('.drawer__foot');
  if (foot) { footEl.append(foot); footEl.hidden = false; } else footEl.hidden = true;

  if (width) drawer.style.width = width;
  drawer.hidden = false;
  scrim.hidden = false;
  // 强制回流后再加 class，保证过渡
  void drawer.offsetWidth;
  drawer.classList.add('is-open');
  scrim.classList.add('is-open');
  drawerState.open = true;
  drawerState.onClose = onClose;
  document.body.style.overflow = 'hidden';

  if (route) history.replaceState(history.state, '', `#${route}`);

  const firstFocusable = drawer.querySelector('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
  firstFocusable?.focus({ preventScroll: true });
  return { close: closeDrawer };
}

export function closeDrawer({ silent = false } = {}) {
  const { drawer, scrim } = getHost();
  if (!drawer || drawer.hidden) return;
  drawer.classList.remove('is-open');
  scrim.classList.remove('is-open');
  const done = () => {
    drawer.hidden = true;
    if (!modalState.open) { scrim.hidden = true; document.body.style.overflow = ''; }
    drawerState.open = false;
    const cb = drawerState.onClose;
    drawerState.onClose = null;
    restoreFocus();
    if (!silent && cb) cb();
  };
  setTimeout(done, 200);
}

/* ============================ 弹窗 ============================ */
const modalState = { open: false, onClose: null };

const MODAL_SIZES = new Set(['lg', 'xl']);
let modalCardExtra = '';

export function openModal({
  title = '', kicker = '', body = null, foot = null, wide = false, size = '', cardClass = '', onClose = null,
} = {}) {
  const { modal, scrim } = getHost();
  saveFocus();
  const card = modal.querySelector('.modal__card');
  // wide 为旧参数，等价 size:'lg'；size 只影响宽度档位，不改结构
  const sizeCls = MODAL_SIZES.has(size) ? size : (wide ? 'lg' : '');
  card.classList.toggle('modal__card--wide', sizeCls === 'lg');
  card.classList.toggle('modal__card--xl', sizeCls === 'xl');
  if (modalCardExtra) card.classList.remove(modalCardExtra);
  modalCardExtra = cardClass && /^modal__card--[a-z0-9-]+$/.test(cardClass) ? cardClass : '';
  if (modalCardExtra) card.classList.add(modalCardExtra);
  const kickerEl = modal.querySelector('.modal__kicker');
  kickerEl.textContent = kicker || '';
  kickerEl.hidden = !kicker;
  modal.querySelector('.modal__title').textContent = title;

  const bodyEl = modal.querySelector('.modal__body');
  clear(bodyEl);
  if (body) bodyEl.append(body);

  const footEl = modal.querySelector('.modal__foot');
  clear(footEl);
  if (foot) {
    footEl.hidden = false;
    (Array.isArray(foot) ? foot : [foot]).forEach((f) => footEl.append(f));
  } else footEl.hidden = true;

  if (!modal.querySelector('.modal__scrim')) {
    const sc = h('div', { class: 'modal__scrim' });
    sc.addEventListener('click', () => closeModal());
    modal.prepend(sc);
  }
  modal.hidden = false;
  scrim.hidden = true;
  modalState.open = true;
  modalState.onClose = onClose;
  document.body.style.overflow = 'hidden';

  const focusable = card.querySelector('button, input, select, textarea, [href]');
  focusable?.focus({ preventScroll: true });
  return { close: closeModal };
}

export function closeModal({ silent = false } = {}) {
  const { modal, scrim } = getHost();
  if (!modal || modal.hidden) return;
  modal.hidden = true;
  modalState.open = false;
  if (drawerState.open) { scrim.hidden = false; } else { scrim.hidden = true; document.body.style.overflow = ''; }
  const cb = modalState.onClose;
  modalState.onClose = null;
  restoreFocus();
  if (!silent && cb) cb();
}

/* ============================ 确认框 ============================ */
export function confirm({
  title = '确认操作', body = '', ok = '确定', cancel = '取消', danger = false,
} = {}) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (val) => {
      if (settled) return;
      settled = true;
      closeModal();
      resolve(val);
    };
    const bodyEl = h('div', { class: 'stack-3' });
    if (body) bodyEl.append(typeof body === 'string' ? h('p', { class: 'dim', html: body }) : body);
    openModal({
      title,
      body: bodyEl,
      onClose: () => finish(false),
      foot: [
        h('button', { class: 'btn btn--quiet', type: 'button', text: cancel, on: { click: () => finish(false) } }),
        h('button', {
          class: `btn ${danger ? 'btn--danger' : 'btn--primary'}`, type: 'button', text: ok,
          on: { click: () => finish(true) },
        }),
      ],
    });
  });
}

/* ============================ 悬浮说明 ============================ */
let tipTimer = 0;
let tipTarget = null;

function placeTip(el, x, y) {
  const { tip } = getHost();
  if (!tip) return;
  const pad = 10;
  const r = tip.getBoundingClientRect();
  let left = x + 14;
  let top = y - r.height - 12;
  if (left + r.width > window.innerWidth - pad) left = x - r.width - 14;
  if (left < pad) left = pad;
  if (top < pad) top = y + 20;
  tip.style.left = `${Math.round(left)}px`;
  tip.style.top = `${Math.round(top)}px`;
}

export function showTip(anchor, html, { x, y } = {}) {
  const { tip } = getHost();
  if (!tip) return;
  tip.innerHTML = html;
  tip.hidden = false;
  const r = anchor?.getBoundingClientRect?.();
  placeTip(tip, x ?? (r ? r.left + r.width / 2 : 0), y ?? (r ? r.top : 0));
  tip.classList.add('is-on');
  tipTarget = anchor;
}
export function hideTip() {
  const { tip } = getHost();
  if (!tip) return;
  tip.classList.remove('is-on');
  tip.hidden = true;
  tipTarget = null;
}

/** 全局 data-tip 绑定（一次）：鼠标悬浮/键盘聚焦显示 */
function bindGlobalTip() {
  const LOOKUP = () => document.querySelector('[data-tip]:hover');
  document.addEventListener('mouseover', (e) => {
    const el = e.target.closest('[data-tip]');
    if (!el || el === tipTarget) return;
    clearTimeout(tipTimer);
    tipTimer = setTimeout(() => showTip(el, el.dataset.tip, { x: e.clientX, y: e.clientY }), 380);
  });
  document.addEventListener('mousemove', (e) => {
    const el = e.target.closest('[data-tip]');
    if (el && tipTarget === el) placeTip(el, e.clientX, e.clientY);
  });
  document.addEventListener('mouseout', (e) => {
    if (!e.target.closest('[data-tip]')) return;
    clearTimeout(tipTimer);
    hideTip();
  });
  document.addEventListener('focusin', (e) => {
    const el = e.target.closest?.('[data-tip]');
    if (el) { clearTimeout(tipTimer); showTip(el, el.dataset.tip); }
  });
  document.addEventListener('focusout', hideTip);
  window.addEventListener('scroll', hideTip, { passive: true });
}

/* ============================ 全局按键 ============================ */
function bindKeys() {
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (modalState.open) { closeModal(); e.preventDefault(); return; }
    if (drawerState.open) { closeDrawer(); e.preventDefault(); }
  });
}

/* ============================ 初始化 ============================ */
let inited = false;
export function initUI() {
  if (inited) return;
  inited = true;
  ensureHost();
  const { scrim } = host;
  scrim?.addEventListener('click', () => {
    if (modalState.open) closeModal(); else closeDrawer();
  });
  bindGlobalTip();
  bindKeys();
}

/** 简写：危险确认 */
export async function confirmDanger(title, body, ok = '删除') {
  return confirm({ title, body, ok, danger: true });
}

export const ui = {
  toast, confirm, confirmDanger,
  openDrawer, closeDrawer, openModal, closeModal,
  showTip, hideTip, initUI,
  get isDrawerOpen() { return drawerState.open; },
  get isModalOpen() { return modalState.open; },
  esc,
};
export default ui;
