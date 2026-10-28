/* =============================================================================
   遗迹2 · 遗物档案 — lab/parts.js（v2）
   实验室共用渲染小件（只用 UX_SPEC §3 组件类名；图标只来自 core/icons.js）。
   ========================================================================== */
import { h, fmt } from '../core/dom.js';
import { icon } from '../core/icons.js';
import { TYPE_ZH, CLASS_ZH } from './engine.js';

/** 槽位 → 图标名 */
export const SLOT_ICON = {
  longGun: 'longgun', handGun: 'handgun', melee: 'sword',
  head: 'helmet', body: 'chest', legs: 'legs', gloves: 'gloves',
  amulet: 'amulet', ring1: 'ring', ring2: 'ring', ring3: 'ring', ring4: 'ring',
  relic: 'relic', archetype1: 'archetype', archetype2: 'archetype',
};

/** 物品图标（带兜底占位） */
export function itemMedia(src, { size = 44, alt = '' } = {}) {
  if (src) {
    return h('img', {
      src, alt, loading: 'lazy', width: size, height: size,
      attrs: { style: `width:${size}px;height:${size}px;object-fit:contain` },
      on: { error: (e) => { e.target.style.visibility = 'hidden'; } },
    });
  }
  return h('span', { class: 'card__ph', attrs: { style: `width:${size}px;height:${size}px;font-size:${Math.round(size * 0.34)}px` } }, icon('armor', { size: Math.round(size * 0.42) }));
}

/** 护甲件小图案 + 名称（矩阵/替代件用） */
export function miniPiece(model, id, { clickable = false, onClick = null } = {}) {
  const p = model.pieceById.get(id);
  if (!p) return h('span', { class: 'muted', text: '—' });
  const el = h('span', { class: 'lab-mini', attrs: { title: `${p.zh} · 护甲值 ${fmt.num(p.armor, 1)} · 负重 ${fmt.num(p.weight, 1)}` } },
    itemMedia(p.iconUrl, { size: 22 }),
    h('span', { class: 'lab-mini__name', text: p.zh }),
  );
  if (clickable) {
    el.classList.add('is-click');
    el.addEventListener('click', () => onClick?.(p));
  }
  return el;
}

/** 四件护甲一排小图案 */
export function miniParts(model, ids, opts) {
  return h('span', { class: 'lab-minis' }, ids.map((id) => miniPiece(model, id, opts)));
}

/** .stat 数值行 */
export function statLine(iconName, label, value, { unit = '', cls = '' } = {}) {
  return h('span', { class: `stat ${cls}`.trim() },
    icon(iconName, { size: 12 }),
    h('span', { class: 'stat__val', text: value }),
    unit ? h('span', { class: 'stat__unit', text: unit }) : '',
    h('span', { class: 'muted', attrs: { style: 'font-size:10.5px' }, text: label }),
  );
}

/** `.statbox`：k 标题（可带图标）/ v 主数值 / s 说明 */
export function statbox(k, v, { unit = '', iconName = '', sub = '', cls = '' } = {}) {
  return h('div', { class: `statbox ${cls}`.trim() },
    h('div', { class: 'statbox__v' }, v, unit ? h('small', { text: unit }) : ''),
    h('div', { class: 'statbox__k' }, iconName ? icon(iconName, { size: 11 }) : '', h('span', { text: k })),
    sub ? h('div', { class: 'lab-statbox__sub', text: sub }) : '',
  );
}

/** 一行三列的小数值网格 */
export function statGrid(items, { cols = 2 } = {}) {
  return h('div', { class: `lab-statgrid lab-statgrid--${cols}` },
    items.map((it) => (it instanceof Node ? it : statbox(it.k, it.v, it))));
}

/** `.meter-row`：抗性 / 减伤条（0~1，超过 80% 也按比例显示，封顶画满） */
export function meterRow(iconName, label, value, colorVar = '--gold') {
  const v = Math.max(0, Math.min(1, value || 0));
  return h('div', { class: 'meter-row' },
    h('span', { class: 'row', attrs: { style: 'gap:4px' } }, icon(iconName, { size: 11 }), h('span', { text: label })),
    h('div', { class: 'meter' }, h('div', { class: 'meter__fill', attrs: { style: `--v:${v.toFixed(4)};--meter-c:var(${colorVar})` } })),
    h('span', { class: 'meter-row__val', text: fmt.pct(value, 1) }),
  );
}

/** 伤害类型 → 图标 / 颜色变量 */
export const TYPE_ICON = {
  physical: 'phys', bleed: 'bleed', fire: 'fire', shock: 'shock', corrosive: 'corrode', blight: 'blight',
};
export const TYPE_COLOR = {
  physical: '--dmg-phys', bleed: '--dmg-bleed', fire: '--dmg-fire', shock: '--dmg-shock',
  corrosive: '--dmg-corrode', blight: '--dmg-blight',
};

/** 档位徽章 */
export function classBadge(cls) {
  const map = { LIGHT: 'badge--high', MEDIUM: 'badge--neutral', HEAVY: 'badge--mid', ULTRA: 'badge--low' };
  return h('span', { class: `badge ${map[cls] || 'badge--neutral'}` }, icon('weight', { size: 11 }), h('span', { text: CLASS_ZH[cls] || cls }));
}

/** 获取难度徽章 */
export function acqBadge(acq) {
  const ZH = { 商店: '商店', 固定拾取: '固定拾取', 制作: '制作', 头目掉落: '头目掉落', Boss: '头目掉落', 解谜: '解谜', 随机: '随机' };
  const KIND = { 商店: 'easy', 固定拾取: 'easy', 制作: 'craft', 头目掉落: 'boss', Boss: 'boss', 解谜: 'boss', 随机: 'rng' };
  const kind = KIND[acq] || 'neutral';
  const ic = kind === 'easy' ? 'shop' : kind === 'craft' ? 'craft' : kind === 'boss' ? 'boss' : kind === 'rng' ? 'rng' : 'question';
  return h('span', { class: `badge badge--${kind}` }, icon(ic, { size: 11 }), h('span', { text: ZH[acq] || '未知' }));
}

/** 面板骨架 */
export function panel(title, { iconName = '', sub = '', tools = [], body = null, flush = false } = {}) {
  const head = h('div', { class: 'panel__head' },
    h('h2', { class: 'panel__title' }, iconName ? icon(iconName, { size: 15 }) : '', h('span', { text: title })),
    sub ? h('span', { class: 'panel__sub', text: sub }) : '',
    h('div', { class: 'panel__tools' }, ...tools),
  );
  return h('section', { class: 'panel' }, head, h('div', { class: `panel__body${flush ? ' panel__body--flush' : ''}` }, body));
}

/** 空状态 */
export function emptyState(iconName, title, hint, action = null) {
  return h('div', { class: 'empty' },
    h('div', { class: 'empty__ico' }, icon(iconName, { size: 40 })),
    h('h3', { class: 'empty__title', text: title }),
    h('p', { class: 'empty__hint', text: hint }),
    action || '',
  );
}

/** 紧凑单行空态（≤72px） */
export function emptyLine(text, iconName = 'info') {
  return h('div', { class: 'lab-emptyline' }, icon(iconName, { size: 14 }), h('span', { text }));
}

/** 折叠区 */
export function fold(title, children, { open = false, sub = '', tools = [] } = {}) {
  const d = h('details', { class: 'lab-fold', attrs: open ? { open: '' } : {} },
    h('summary', {},
      icon('chevron-right', { size: 13, cls: 'lab-fold__chev' }),
      h('span', { text: title }),
      sub ? h('span', { class: 'lab-fold__sub', text: sub }) : '',
      tools.length ? h('span', { class: 'lab-fold__tools' }, ...tools) : '',
    ),
    h('div', { class: 'lab-fold__body' }, children),
  );
  return d;
}

/** 多选 chip 组 */
export function chipGroup(items, selected, onToggle, { emptyText = '暂无数据' } = {}) {
  if (!items.length) return h('div', { class: 'muted', attrs: { style: 'font-size:11.5px' }, text: emptyText });
  const wrap = h('div', { class: 'lab-chips' });
  for (const it of items) {
    const on = selected.has ? selected.has(it.id) : !!(selected[it.id]);
    wrap.append(h('button', {
      class: `chip chip--sm${on ? ' is-on' : ''}`, type: 'button', title: it.title || '',
      on: { click: () => onToggle(it) },
    }, h('span', { text: it.zh })));
  }
  return wrap;
}

/** 难度（难点 N 件 / 全易） */
export function hardBadge(hard) {
  return hard
    ? h('span', { class: 'badge badge--boss', title: '本组合里头目掉落 / 解谜 / 随机获取的件数' }, icon('boss', { size: 11 }), h('span', { text: `难点 ${hard} 件` }))
    : h('span', { class: 'badge badge--easy' }, icon('shop', { size: 11 }), h('span', { text: '全易获取' }));
}

/** 写入四件按钮（调用方给 onClick） */
export function writeArmorBtn(onClick) {
  return h('button', { class: 'btn btn--ghost btn--sm', type: 'button', on: { click: onClick } },
    icon('flask', { size: 13 }), h('span', { text: '写入四件' }));
}

export { TYPE_ZH, CLASS_ZH };
