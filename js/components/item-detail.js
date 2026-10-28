/* =============================================================================
   遗迹2 · 遗物档案 — item-detail.js
   全站唯一物品详情（桌面 = 居中弹窗，移动 = 右侧全屏抽屉）。
   资料库、实验室、选择器、知识库引用、套装部件全部走这里。
   信息顺序：效果 → 数值明细 → 属性 → 套装 → 获取 → 背景 → 数据来源。
   URL 归属：本组件只负责打开浮层、关闭时回调 onClose；打开/关闭时的地址栏同步归调用方视图。
   ========================================================================== */
import { h } from '../core/dom.js';
import { icon } from '../core/icons.js';
import { api } from '../core/api.js';
import { store } from '../core/store.js';
import { ui } from '../core/ui.js';
import { itemIconEl } from './item-card.js';
import { emptyState } from './states.js';
import {
  FAMILY, CONF, DLC_ZH, slotsForFamily, SLOT_ZH, EFFECT_CATS,
} from '../core/labels.js';
import {
  effectSentence, descSection, effectTextSection, backgroundSection, attrsSection,
  effectSection, setSection, acqSection, flavorSection, metaSection,
} from './item-detail-sections.js';

/* 桌面宽屏走居中弹窗，窄屏保持全屏抽屉 */
const DESKTOP_MQ = '(min-width: 900px)';
const isDesktop = () => window.matchMedia(DESKTOP_MQ).matches;

/* ----------------------------- 状态按钮 / 装备 ----------------------------- */
function stateButtons(item, rerender) {
  const owned = store.isOwned(item.id);
  const fav = store.isFav(item.id);

  const ownedBtn = h('button', {
    class: `statebtn${owned ? ' is-on' : ''}`, type: 'button',
    attrs: { title: '切换拥有状态（与是否装备无关）', 'aria-label': `切换拥有状态：${item.zh}` },
    on: {
      click: () => {
        const v = store.toggleOwned(item.id);
        ui.toast(v ? `已标记已拥有：${item.zh}` : `已标记未拥有：${item.zh}`, 'ok');
        rerender();
      },
    },
  }, icon(owned ? 'owned' : 'unowned', { size: 13 }), h('span', { text: owned ? '已拥有' : '未拥有' }));

  const favBtn = h('button', {
    class: `statebtn${fav ? ' is-on is-on--fav' : ''}`, type: 'button',
    attrs: { title: '收藏（只做标记，不影响配装）', 'aria-label': `切换收藏：${item.zh}` },
    on: {
      click: () => {
        const v = store.toggleFav(item.id);
        ui.toast(v ? `已收藏：${item.zh}` : `已取消收藏：${item.zh}`, v ? 'ok' : 'info');
        rerender();
      },
    },
  }, icon(fav ? 'star-fill' : 'star', { size: 13 }), h('span', { text: fav ? '已收藏' : '收藏' }));

  return [ownedBtn, favBtn];
}

function equipButton(item) {
  if (item.family === 'trait') {
    return h('button', {
      class: 'btn btn--primary btn--sm', type: 'button',
      attrs: { title: '加入配装特性（1 级，可在实验室调整等级）', 'aria-label': `加入特性：${item.zh}` },
      on: {
        click: () => {
          const res = store.build.addTrait(item.id);
          if (!res.ok && res.reason === 'exists') { ui.toast('该特性已在配装中', 'info'); return; }
          if (!res.ok && res.reason === 'cap') { ui.toast('特性已满 10 个，请先移除一个', 'warn'); return; }
          if (!res.ok) { ui.toast('无法加入该特性', 'err'); return; }
          // 与实验室同一事实源（meta.traitLevels），加入后实验室立即可见并可调等级
          ui.toast(`已加入特性：${item.zh}（1 级）`, 'ok');
        },
      },
    }, icon('plus', { size: 13 }), h('span', { text: '加入特性' }));
  }
  const slots = slotsForFamily(item.family);
  if (!slots.length) return null;
  const equippedSlot = () => slots.find((s) => store.build.get(s) === item.id) || null;
  const btn = h('button', {
    class: 'btn btn--primary btn--sm', type: 'button',
    attrs: { title: '装备到配装', 'aria-label': `装备：${item.zh}` },
    on: {
      click: () => {
        const already = equippedSlot();
        if (already) {
          ui.toast(`已在配装中（${SLOT_ZH[already] || already}），不能重复装备同一件`, 'info');
          return;
        }
        const target = slots.find((s) => !store.build.get(s)) || slots[0];
        store.build.set(target, item.id);
        ui.toast(`已装备到「${SLOT_ZH[target] || target}」：${item.zh}`, 'ok');
        sync();
      },
    },
  }, icon('plus', { size: 13 }), h('span', { text: '装备' }));
  const sync = () => {
    const already = equippedSlot();
    btn.classList.toggle('btn--ghost', !!already);
    btn.classList.toggle('btn--primary', !already);
    btn.replaceChildren(icon(already ? 'check' : 'plus', { size: 13 }), h('span', { text: already ? '已装备' : '装备' }));
    btn.title = already ? `已在「${SLOT_ZH[already] || already}」` : '装备到配装';
    btn.setAttribute('aria-label', already ? `已在「${SLOT_ZH[already] || already}」` : `装备：${item.zh}`);
  };
  sync();
  return btn;
}

/* ----------------------------- 渲染 ----------------------------- */
function renderDetail(item, opts = {}) {
  const modal = !!opts.modal;
  const root = h('div', { class: `detail${modal ? ' detail--modal' : ''}` });
  const rerender = () => { root.replaceWith(renderDetail(item, opts)); };

  const fam = FAMILY[item.family] || FAMILY.other;
  const tags = [
    h('span', { class: 'tag' }, icon(fam.icon, { size: 11 }), h('span', { text: fam.zh })),
    item.dlc > 0 ? h('span', { class: 'badge badge--gold', text: DLC_ZH[item.dlc] }) : '',
    item.confidence !== 'high' ? h('span', { class: `badge badge--${CONF[item.confidence]?.cls || 'low'}`, text: CONF[item.confidence]?.zh || '待验证' }) : '',
  ].filter(Boolean);

  const acts = [...stateButtons(item, rerender)];
  const equip = equipButton(item);
  if (equip) acts.push(equip);

  /* 大图：alt 用中文名（占位块无 alt，已有 aria-hidden） */
  const media = itemIconEl(item);
  if (media && media.tagName === 'IMG') {
    media.alt = item.zh || '';
    media.loading = 'eager';
  }

  const hero = h('div', { class: 'detail-hero' },
    h('div', { class: 'detail-hero__media' }, media),
    h('div', { class: 'detail-hero__ident' },
      h('div', {
        class: 'detail-hero__name', text: item.zh,
        attrs: modal ? { role: 'heading', 'aria-level': '2' } : {},
      }),
      h('div', { class: 'detail-hero__en', text: item.en }),
      h('div', { class: 'detail-hero__tags' }, tags),
      h('div', { class: 'detail-hero__acts' }, acts),
    ),
  );

  const main = h('div', { class: 'detail__main' });
  const push = (node) => { if (node) main.append(node); };
  const hasEffectText = !!effectSentence(item);
  const isEffectCat = EFFECT_CATS.includes(item.cat);
  if (hasEffectText) {
    push(effectTextSection(item));       // 官方效果句原文（首位）
    push(effectSection(item));           // 标题自动为「数值明细」
  } else if (isEffectCat) {
    /* 效果类目缺效果句：不渲染「描述」，首块改为数值行「效果」 */
    push(effectSection(item));
  } else {
    /* 武器/护甲/特性等：保持旧行为（描述 → 效果 → …） */
    push(descSection(item));
    push(effectSection(item));
  }
  push(attrsSection(item));
  push(setSection(item, { openDetail: openItemDetail }));
  const acqSlot = h('div');
  main.append(acqSlot);
  acqSection(item).then((sec) => { if (acqSlot.isConnected) acqSlot.replaceWith(sec); });
  if (hasEffectText || isEffectCat) {
    push(backgroundSection(item));       // 描述 + flavor 合并进「背景」（效果类目仅隐藏风味标题，不丢内容）
  } else {
    push(flavorSection(item));
  }
  main.append(metaSection(item));

  root.append(h('div', { class: 'detail__grid' }, hero, main));
  return root;
}

/* ----------------------------- 对外入口 ----------------------------- */
export function renderItemDetail(id) {
  const item = api.item(id);
  if (!item) {
    return emptyState({ title: '找不到该物品', hint: id });
  }
  return renderDetail(item);
}

/**
 * 打开物品详情（全站唯一入口）
 * 桌面：居中弹窗（size:'xl' + .modal__card--detail）；移动：右侧全屏抽屉。
 * 只负责浮层本身；地址栏由调用方视图按自己的路由语义维护（本组件不写 URL）。
 * @param {string} id
 * @param {object} opts { onClose?:Function, from?:string }
 * @returns {boolean|null} 打开成功 true；找不到道具 null
 */
export function openItemDetail(id, opts = {}) {
  const item = api.item(id);
  if (!item) { ui.toast('找不到该物品', 'err'); return null; }
  const onClose = () => { opts.onClose?.(); };
  const fam = FAMILY[item.family] || FAMILY.other;

  if (isDesktop()) {
    ui.openModal({
      title: '物品详情',
      kicker: fam.zh,
      size: 'xl',
      cardClass: 'modal__card--detail',
      body: renderDetail(item, { modal: true }),
      onClose,
    });
  } else {
    ui.openDrawer({
      title: item.zh,
      subtitle: `${fam.zh}${item.subtitle ? ` · ${item.subtitle}` : ''}`,
      iconName: fam.icon,
      body: renderDetail(item, { modal: false }),
      onClose,
    });
  }
  return true;
}

export default openItemDetail;
