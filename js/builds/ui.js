/* =============================================================================
   遗迹2 · 遗物档案 — builds/ui.js
   流派领域的共用小件与数据表：评分星条、标签、数值盒、面板骨架、道具 chip。
   列表页与详情页都从这里取，避免两边各写一份。
   ========================================================================== */
import { h, fmt, esc } from '../core/dom.js';
import { icon } from '../core/icons.js';
import { api } from '../core/api.js';
import { itemIconEl } from '../components/item-card.js';
import { panel as panelBase } from '../components/panel.js';
import { openItemDetail } from '../components/item-detail.js';

/* 领域名（subnav 标题 / 详情面包屑共用） */
export const DOMAIN = '流派';

/* 五项评分（数据口径：1~5；难度 / 门槛越高越吃操作与特定装备） */
export const RATINGS = [
  { key: 'single', zh: '单体', icon: 'target', tip: '单体目标（首领 / 精英）的输出能力，5 最强' },
  { key: 'aoe', zh: '清群', icon: 'damage', tip: '一次面对 5~10 个普通怪的处理速度，5 最强' },
  { key: 'survival', zh: '生存', icon: 'shield', tip: '减伤 / 护盾 / 吸血带来的容错，5 最强' },
  { key: 'difficulty', zh: '难度', icon: 'dodge', tip: '操作难度：越高越依赖弱点瞄准与窗口维持' },
  { key: 'gear', zh: '门槛', icon: 'weight', tip: '装备门槛：越高越依赖特定道具与高强化' },
];

/* 数据侧槽位键 → 中文 / 图标（与 UX_SPEC §5 对齐） */
export const SLOT_META = {
  long_gun: { zh: '主武器', icon: 'longgun' },
  hand_gun: { zh: '副武器', icon: 'handgun' },
  melee_weapon: { zh: '近战武器', icon: 'sword' },
  mod: { zh: '武器改装', icon: 'mod' },
  meta_gem: { zh: '变异器', icon: 'metagem' },
  amulet: { zh: '项链', icon: 'amulet' },
  ring: { zh: '戒指', icon: 'ring' },
  relic: { zh: '圣物', icon: 'relic' },
  trait: { zh: '特性', icon: 'trait' },
  perk: { zh: '职业专长', icon: 'perk' },
  skill: { zh: '技能', icon: 'skill' },
  fragment: { zh: '圣物碎片', icon: 'relic' },
  legendary: { zh: '棱镜传奇词条', icon: 'sparkle' },
};
export const ARMOR_SLOTS = ['head', 'body', 'legs', 'gloves'];
const WEIGHT_CLASS_ZH = { 轻: '轻量', 中: '中量', 重: '重量', 超重: '超重' };

/* 「按目标选」的排序目标（用数据自带评分算，不手填名次） */
export const GOALS = [
  {
    key: 'single', zh: '打单体首领', icon: 'target',
    desc: '看单体分：首领 / 精英的输出上限。',
    val: (b) => Number((b.ratings || {}).single) || 0,
    valText: (b) => `单体 ${fmt.num(Number((b.ratings || {}).single) || 0, 1)}`,
  },
  {
    key: 'aoe', zh: '清群刷图', icon: 'damage',
    desc: '看清群分：5~10 只普通怪的处理速度。',
    val: (b) => Number((b.ratings || {}).aoe) || 0,
    valText: (b) => `清群 ${fmt.num(Number((b.ratings || {}).aoe) || 0, 1)}`,
  },
  {
    key: 'survival', zh: '稳一点、能容错', icon: 'shield',
    desc: '看生存分：减伤 / 护盾 / 吸血撑起来的容错。',
    val: (b) => Number((b.ratings || {}).survival) || 0,
    valText: (b) => `生存 ${fmt.num(Number((b.ratings || {}).survival) || 0, 1)}`,
  },
  {
    key: 'easy', zh: '想轻松上手', icon: 'dodge',
    desc: '看操作难度：越低越不需要瞄准与卡窗口。',
    val: (b) => -(Number((b.ratings || {}).difficulty) || 0),
    valText: (b) => `难度 ${fmt.num(Number((b.ratings || {}).difficulty) || 0, 1)}`,
  },
  {
    key: 'gear', zh: '装备不全也能玩', icon: 'weight',
    desc: '看装备门槛：越低越不吃特定道具。',
    val: (b) => -(Number((b.ratings || {}).gear) || 0),
    valText: (b) => `门槛 ${fmt.num(Number((b.ratings || {}).gear) || 0, 1)}`,
  },
  {
    key: 'composite', zh: '综合最强', icon: 'trophy',
    desc: '看综合分：五项评分折算后的总分。',
    val: (b) => Number((b.eval || {}).composite) || 0,
    valText: (b) => `综合 ${fmt.num(Number((b.eval || {}).composite) || 0, 2)}`,
  },
];

/* --------------------------------- 分类名 --------------------------------- */
export function weightClassZh(b) {
  const raw = String((b.armor && b.armor.weight_class) || '').trim();
  const first = raw.split(/\s+/)[0] || '';
  if (WEIGHT_CLASS_ZH[first]) return WEIGHT_CLASS_ZH[first];
  const w = Number(b.armor && b.armor.total_weight);
  if (Number.isFinite(w)) return w <= 25 ? '轻量' : w <= 50 ? '中量' : w <= 75 ? '重量' : '超重';
  return '—';
}

/* 职业：官方译名以 data/archetypes.json 为准，缺失才回退 builds.json */
export function archOfficial(a) { return a ? api.archetypeByEn(a.name_en) : null; }
export function archZh(a) {
  const off = archOfficial(a);
  return (off && off.zh) || (a && a.name_zh) || (a && a.name_en) || '—';
}
export function archPairText(b) {
  const names = (b.archetypes || []).slice(0, 2).map(archZh);
  return names.length ? names.join(' · ') : '—';
}

/* -------------------------------- 星级评分 ------------------------------- */
export function stars(val) {
  const v = Number(val) || 0;
  const out = [];
  for (let i = 0; i < 5; i += 1) {
    const full = v >= i + 1 - 1e-9;
    const half = !full && v >= i + 0.5 - 1e-9;
    out.push(h('span', { class: `bstar${full ? ' bstar--on' : ''}${half ? ' bstar--half' : ''}`, attrs: { 'aria-hidden': 'true' } },
      half ? icon('star', { size: 12 }) : icon(full ? 'star-fill' : 'star', { size: 12 }),
      half ? h('span', { class: 'bstar__clip' }, icon('star-fill', { size: 12 })) : null));
  }
  return h('span', { class: 'bstars', attrs: { role: 'img', 'aria-label': `${fmt.num(v, 1)} / 5` } }, out);
}

export function ratingCell(def, v) {
  return h('div', { class: 'brate', attrs: { 'data-tip': def.tip } },
    h('span', { class: 'brate__k', text: def.zh }),
    stars(v),
    h('span', { class: 'brate__v', text: fmt.num(v, 1) }));
}

/* --------------------------------- 小件 --------------------------------- */
export function tagEl(label, iconName) {
  return h('span', { class: 'tag' }, iconName ? icon(iconName, { size: 11 }) : null, h('span', { text: label }));
}

export function statbox(k, v, sub, iconName) {
  return h('div', { class: 'statbox' },
    h('span', { class: 'statbox__k' }, icon(iconName, { size: 11 }), h('span', { text: k })),
    h('span', { class: 'statbox__v' }, h('span', { text: v }), sub ? h('small', { text: sub }) : null));
}

/** 面板骨架：统一走 components/panel.js（本函数只保留领域侧的旧调用形态）。 */
export function panel(iconName, title, body, opts = {}) {
  return panelBase({
    icon: iconName,
    title,
    sub: opts.sub || '',
    body,
  }).el;
}

/* ----------------------------- 道具引用 → chip ---------------------------- */
export function entity(ref) { return api.buildEntity(ref); }

export function mediaFor(e, slot, size) {
  if (e && e.item) return itemIconEl(e.item);
  const meta = SLOT_META[slot] || SLOT_META[(e && e.slot) || ''] || null;
  return icon(meta ? meta.icon : 'info', { size });
}

/**
 * 道具 chip：真实道具 = 可点按钮（打开全站统一详情弹窗）；
 * 纯文本实体（碎片 / 棱镜传奇词条）= 只读 chip，data-tip 给中文效果。
 */
export function chipEl(ref, slot, opts = {}) {
  const e = entity(ref);
  if (!e) return null;
  const sm = !!opts.sm;
  const media = h('span', { class: 'bchip__ico', attrs: { 'aria-hidden': 'true' } }, mediaFor(e, slot, sm ? 12 : 13));
  const kids = [media, h('span', { class: 'bchip__name', text: e.zh })];
  if (opts.sub) kids.push(h('span', { class: 'bchip__sub', text: opts.sub }));
  const attrs = {};
  const tip = e.effectZh ? `<b>${esc(e.zh)}</b><br>${esc(e.effectZh)}` : (e.en ? esc(e.en) : '');
  if (tip) attrs['data-tip'] = tip;
  const cls = `chip bchip${sm ? ' bchip--sm' : ''}${e.item ? '' : ' bchip--text'}`;
  if (e.item && e.id) {
    attrs['aria-label'] = `查看 ${e.zh} 详情`;
    return h('button', { class: cls, type: 'button', attrs, on: { click: () => openItemDetail(e.id) } }, kids);
  }
  return h('span', { class: cls, attrs }, kids);
}

export function chipGroup(title, refs, slot) {
  const list = (refs || []).map((r) => chipEl(r, slot)).filter(Boolean);
  if (!list.length) return null;
  return h('div', { class: 'bgroup' },
    h('div', { class: 'bar-title' },
      h('span', { text: title }),
      h('span', { class: 'bgroup__n', text: String(list.length) })),
    h('div', { class: 'bchips' }, list));
}
