/* =============================================================================
   遗迹2 · 遗物档案 — item-card.js
   全站唯一物品卡组件（资料库网格/列表、选择器、推荐配装里的部件共用）。
   ========================================================================== */
import { h, fmt } from '../core/dom.js';
import { icon } from '../core/icons.js';
import { api } from '../core/api.js';
import { store } from '../core/store.js';
import { FAMILY, numLabel, fmtNumber, PRIMARY_KEYS, cleanSummary, attrKeysShown } from '../core/labels.js';

/** 图标（真图优先，缺图用首字占位） */
export function itemIconEl(item, size = 'md') {
  const url = api.iconUrl(item);
  if (url) {
    return h('img', {
      src: url, alt: '', loading: 'lazy', decoding: 'async',
      on: { error: (e) => { e.currentTarget.replaceWith(placeholderEl(item)); } },
    });
  }
  return placeholderEl(item);
}
function placeholderEl(item) {
  const ch = (item?.zh || item?.en || '?').slice(0, 1);
  return h('span', { class: 'card__ph', attrs: { 'aria-hidden': 'true' } }, ch);
}

/** 关键数值（按部位族给最有用的 2–3 个） */
function metaStats(item) {
  const out = [];
  const push = (ico, val, unit = '', cls = '') => out.push(h('span', { class: `stat ${cls}` },
    icon(ico, { size: 12 }), h('b', { class: 'stat__val', text: val }), unit ? h('i', { class: 'stat__unit', text: unit }) : ''));

  if (item.family === 'longGun' || item.family === 'handGun' || item.family === 'melee') {
    if (item.damage != null) push('damage', fmt.num(item.damage, item.damage < 10 ? 2 : 0));
    if (item.rate != null) push('firerate', fmt.num(item.rate, 2), '', '');
    if (item.crit != null) push('crit', `${fmt.num(item.crit, 0)}%`);
  } else if (['head', 'body', 'legs', 'gloves'].includes(item.family)) {
    if (item.armor != null) push('armor', fmt.num(item.armor, 1));
    if (item.weight != null) push('weight', fmt.num(item.weight, 1));
    const rs = item.resistSum;
    if (rs) push('resist', `+${fmt.num(rs, 0)}`);
  } else if (item.family === 'relic') {
    if (item.effectLines?.length) push('relic', `${item.effectLines.length} 条效果`, '', '');
  } else if (item.family === 'trait' || item.family === 'perk') {
    if (item.maxLevel) push('trait', `${item.maxLevel} 级`, '', '');
  }
  return out;
}

function stateFlags(item, showState) {
  const wrap = h('div', { class: 'card__flags' });
  if (!showState) return wrap;
  if (store.isFav(item.id)) {
    wrap.append(h('span', { class: 'card__flag card__flag--fav', attrs: { title: '已收藏' } }, icon('star-fill', { size: 11 })));
  }
  if (store.isOwned(item.id)) {
    wrap.append(h('span', { class: 'card__flag card__flag--owned', attrs: { title: '已拥有' } }, icon('check', { size: 11 })));
  }
  return wrap;
}

/**
 * @param {object} item   api 规范化后的 item
 * @param {object} opts   { mode, onClick, showState, quickState }
 */
export function itemCard(item, opts = {}) {
  const { mode = 'grid', onClick, showState = true, quickState = true } = opts;
  const fam = FAMILY[item.family] || FAMILY.other;

  const card = h('div', {
    class: `card card--${mode}${store.isOwned(item.id) ? '' : ''}`,
    dataset: { id: item.id },
    attrs: { role: 'button', tabindex: '0', 'aria-label': item.zh },
    on: {
      click: () => onClick ? onClick(item) : null,
      keydown: (e) => { if ((e.key === 'Enter' || e.key === ' ') && onClick) { e.preventDefault(); onClick(item); } },
    },
  });

  const media = h('div', { class: 'card__media' }, itemIconEl(item), stateFlags(item, showState));
  if (quickState) media.append(quickActions(item, card));
  card.append(media);

  const ident = h('div', { class: 'card__ident' },
    h('div', { class: 'card__name', attrs: { title: item.zh }, text: item.zh }),
    h('div', { class: 'card__en', attrs: { title: item.en }, text: item.en }),
  );

  const meta = h('div', { class: 'card__meta' }, metaStats(item));

  const body = h('div', { class: 'card__body' });
  if (mode === 'list') {
    body.append(ident, meta);
    body.append(h('div', { class: 'card__desc', text: shortEffect(item) }));
  } else {
    const typeTag = h('span', { class: 'tag' }, icon(fam.icon, { size: 11 }), h('span', { text: fam.zh }));
    body.append(ident, h('div', { class: 'card__badges' }, typeTag), meta);
    const prev = effectPreview(item);
    if (prev) body.append(h('div', { class: 'card__desc', text: prev }));
  }
  card.append(body);
  return card;
}

/** 悬浮快捷状态按钮：拥有 / 收藏（点击不打开详情） */
function quickActions(item, card) {
  const wrap = h('div', { class: 'card__quick' });
  const mk = (kind, ico, on, title) => {
    const btn = h('button', {
      class: `card__quickbtn${on ? ' is-on' : ''}`, type: 'button',
      attrs: { title, 'aria-label': title, tabindex: '-1' },
      dataset: { kind },
    }, icon(ico, { size: 12 }));
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (kind === 'owned') {
        const v = store.toggleOwned(item.id);
        btn.classList.toggle('is-on', v);
        btn.replaceChildren(icon(v ? 'owned' : 'unowned', { size: 12 }));
        btn.title = v ? '取消「已拥有」' : '标记为已拥有';
        card.querySelectorAll('.card__flag--owned').forEach((n) => n.remove());
        if (v) card.querySelector('.card__media').append(h('span', { class: 'card__flag card__flag--owned', attrs: { title: '已拥有' } }, icon('check', { size: 11 })));
      } else {
        const v = store.toggleFav(item.id);
        btn.classList.toggle('is-on', v);
        btn.replaceChildren(icon(v ? 'star-fill' : 'star', { size: 12 }));
        btn.title = v ? '取消收藏' : '收藏';
        card.querySelectorAll('.card__flag--fav').forEach((n) => n.remove());
        if (v) card.querySelector('.card__media').append(h('span', { class: 'card__flag card__flag--fav', attrs: { title: '已收藏' } }, icon('star-fill', { size: 11 })));
      }
    });
    return btn;
  };
  wrap.append(
    mk('owned', store.isOwned(item.id) ? 'owned' : 'unowned', store.isOwned(item.id), store.isOwned(item.id) ? '取消「已拥有」' : '标记为已拥有'),
    mk('fav', store.isFav(item.id) ? 'star-fill' : 'star', store.isFav(item.id), store.isFav(item.id) ? '取消收藏' : '收藏'),
  );
  return wrap;
}

/** 一句话效果预览：优先中文映射数值 → 官方文本 → 清理后的摘要 → 兜底 */
export function effectPreview(item) {
  const rows = [];
  const shown = attrKeysShown(item);
  for (const ln of item.effectLines || []) {
    const key = ln.key;
    if (!key || !PRIMARY_KEYS.has(key) || shown.has(key) || !numLabel(key)) continue;
    const raw = ln.value != null ? ln.value : item.numbers?.[key];
    if (raw == null) continue;
    if (typeof raw === 'number' && Math.abs(raw) < 1e-6) continue; // 数据里有 ~1e-294 的「伪 0」
    rows.push(`${numLabel(key)[0]} ${fmtNumber(key, raw)}`);
    if (rows.length >= 3) break;
  }
  if (rows.length) return rows.join('；');
  if (item.effectSource === 'description_clean' && (item.descZh || item.descEn)) {
    return (item.descZh || item.descEn).slice(0, 60);
  }
  let cleaned = cleanSummary(item.summaryZh);
  if (cleaned) {
    // 去掉「属性」区已经展示过的同名项，避免重复
    const shownZh = [...shown].map((k) => (numLabel(k) ? numLabel(k)[0] : '')).filter(Boolean);
    const hit = (seg) => shownZh.some((z) => seg.startsWith(z) || seg.startsWith(z.replace(/值$/, '')));
    // 全为 0 的段（如「持续时间 0 秒」）没有信息量，丢掉
    const allZero = (seg) => {
      const nums = (seg.match(/-?\d+(?:\.\d+)?/g) || []).map(Number);
      return nums.length > 0 && nums.every((n) => n === 0);
    };
    const segs = cleaned.split('；').filter((seg) => !hit(seg) && !allZero(seg));
    cleaned = segs.join('；');
  }
  if (cleaned) return cleaned;
  if (item.family === 'material') return '制作材料';
  return '';
}

/** 兼容旧名 */
export const shortEffect = effectPreview;

export default itemCard;
