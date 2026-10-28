/* =============================================================================
   遗迹2 · 遗物档案 — views/builds.js
   流派领域：#/builds 列表、#/builds/<key> 详情。
   只读 data/builds.json（经 api.builds()）；道具引用一律走 api.buildEntity()：
   真实道具 → 图标 + 全站统一详情弹窗；碎片 / 棱镜传奇词条等纯文本实体 → 只读 chip。
   「装入实验室」把可解析的真实 id 写入 store.build 的 15 个槽位，然后跳 #/lab。
   ========================================================================== */

import { h, clear, fmt, esc } from '../core/dom.js';
import { icon } from '../core/icons.js';
import { api } from '../core/api.js';
import { router } from '../core/router.js';
import { ui } from '../core/ui.js';
import { store } from '../core/store.js';
import { itemIconEl } from '../components/item-card.js';
import { openItemDetail } from '../components/item-detail.js';

const DOMAIN = '流派';

/* 五项评分（数据口径：1~5；难度 / 门槛越高越吃操作与特定装备） */
const RATINGS = [
  { key: 'single', zh: '单体', icon: 'target', tip: '单体目标（首领 / 精英）的输出能力，5 最强' },
  { key: 'aoe', zh: '清群', icon: 'damage', tip: '一次面对 5~10 个普通怪的处理速度，5 最强' },
  { key: 'survival', zh: '生存', icon: 'shield', tip: '减伤 / 护盾 / 吸血带来的容错，5 最强' },
  { key: 'difficulty', zh: '难度', icon: 'dodge', tip: '操作难度：越高越依赖弱点瞄准与窗口维持' },
  { key: 'gear', zh: '门槛', icon: 'weight', tip: '装备门槛：越高越依赖特定道具与高强化' },
];

/* 数据侧槽位键 → 中文 / 图标（与 UX_SPEC §5 对齐） */
const SLOT_META = {
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
const ARMOR_SLOTS = ['head', 'body', 'legs', 'gloves'];
const WEIGHT_CLASS_ZH = { 轻: '轻量', 中: '中量', 重: '重量', 超重: '超重' };

/* 「按目标选」的排序目标（用数据自带评分算，不手填名次） */
const GOALS = [
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

/* ---------------------------------- 状态 ---------------------------------- */
let DATA = null;
let PENDING = null;
let EL = null;                 // { root, body, titleSlot }
let ORDER = [];                // 按 order 升序的 7 套
let BY_KEY = new Map();

/* --------------------------------- 小工具 -------------------------------- */
function deferTitle(t) { queueMicrotask(() => router.setTitle(t)); }

/** 整页只允许一个 h1：列表页 subnav 用 h1，详情页 subnav 降级为 div（正文有 h1） */
function setSubnavTitle(hasArticleH1) {
  if (!EL || !EL.titleSlot) return;
  clear(EL.titleSlot);
  EL.titleSlot.append(h(hasArticleH1 ? 'div' : 'h1', { class: 'subnav__title', text: DOMAIN }));
}

function weightClassZh(b) {
  const raw = String((b.armor && b.armor.weight_class) || '').trim();
  const first = raw.split(/\s+/)[0] || '';
  if (WEIGHT_CLASS_ZH[first]) return WEIGHT_CLASS_ZH[first];
  const w = Number(b.armor && b.armor.total_weight);
  if (Number.isFinite(w)) return w <= 25 ? '轻量' : w <= 50 ? '中量' : w <= 75 ? '重量' : '超重';
  return '—';
}

/* 职业：官方译名以 data/archetypes.json 为准，缺失才回退 builds.json */
function archOfficial(a) { return a ? api.archetypeByEn(a.name_en) : null; }
function archZh(a) {
  const off = archOfficial(a);
  return (off && off.zh) || (a && a.name_zh) || (a && a.name_en) || '—';
}
function archPairText(b) {
  const names = (b.archetypes || []).slice(0, 2).map(archZh);
  return names.length ? names.join(' · ') : '—';
}

/* -------------------------------- 星级评分 ------------------------------- */
function stars(val) {
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

function ratingCell(def, v) {
  return h('div', { class: 'brate', attrs: { 'data-tip': def.tip } },
    h('span', { class: 'brate__k', text: def.zh }),
    stars(v),
    h('span', { class: 'brate__v', text: fmt.num(v, 1) }));
}

function tagEl(label, iconName) {
  return h('span', { class: 'tag' }, iconName ? icon(iconName, { size: 11 }) : null, h('span', { text: label }));
}

function statbox(k, v, sub, iconName) {
  return h('div', { class: 'statbox' },
    h('span', { class: 'statbox__k' }, icon(iconName, { size: 11 }), h('span', { text: k })),
    h('span', { class: 'statbox__v' }, h('span', { text: v }), sub ? h('small', { text: sub }) : null));
}

function panel(iconName, title, body, opts = {}) {
  return h('section', { class: 'panel' },
    h('div', { class: 'panel__head' },
      h('h2', { class: 'panel__title' }, icon(iconName, { size: 15 }), title),
      opts.sub ? h('span', { class: 'panel__sub', text: opts.sub }) : null),
    h('div', { class: 'panel__body' }, body));
}

/* ----------------------------- 道具引用 → chip ---------------------------- */
function entity(ref) { return api.buildEntity(ref); }

function mediaFor(e, slot, size) {
  if (e && e.item) return itemIconEl(e.item);
  const meta = SLOT_META[slot] || SLOT_META[(e && e.slot) || ''] || null;
  return icon(meta ? meta.icon : 'info', { size });
}

/**
 * 道具 chip：真实道具 = 可点按钮（打开全站统一详情弹窗）；
 * 纯文本实体（碎片 / 棱镜传奇词条）= 只读 chip，data-tip 给中文效果。
 */
function chipEl(ref, slot, opts = {}) {
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

function chipGroup(title, refs, slot) {
  const list = (refs || []).map((r) => chipEl(r, slot)).filter(Boolean);
  if (!list.length) return null;
  return h('div', { class: 'bgroup' },
    h('div', { class: 'bar-title' },
      h('span', { text: title }),
      h('span', { class: 'bgroup__n', text: String(list.length) })),
    h('div', { class: 'bchips' }, list));
}

/* -------------------------------- 列表页 --------------------------------- */
function renderList() {
  clear(EL.body);
  const meta = DATA.meta || {};
  const counts = meta.counts || {};
  const builtAt = String(meta.generated_at || meta.generated || '').slice(0, 10);
  EL.body.append(
    h('div', { class: 'bintro' },
      h('p', { class: 'bintro__lede', text: meta.subtitle || '' }),
      h('p', { class: 'bintro__meta', text: `${ORDER.length} 套 · ${counts.items || '—'} 条道具摘要 · 生成 ${builtAt || '—'} · 评分为数据口径评估，不是游戏内数值` })),
    goalPanel(),
    h('div', { class: 'bgrid' }, ...ORDER.map((b) => buildCard(b))),
    comparePanel(),
    rulesPanel(),
    notesPanel(),
  );
}

function goalPanel() {
  return panel('target', '按目标选', h('div', { class: 'bgoals' }, ...GOALS.map(goalCard)),
    { sub: '按对应评分排序取前三，点流派名进入详情' });
}

function goalCard(g) {
  const ranked = ORDER.slice()
    .sort((a, b) => g.val(b) - g.val(a) || (Number(a.order) || 0) - (Number(b.order) || 0))
    .slice(0, 3);
  return h('div', { class: 'bgoal' },
    h('div', { class: 'bgoal__head' },
      h('span', { class: 'bgoal__ico' }, icon(g.icon, { size: 16 })),
      h('span', { class: 'bgoal__title', text: g.zh })),
    h('p', { class: 'bgoal__desc', text: g.desc }),
    h('ol', { class: 'bgoal__list' }, ...ranked.map((b, i) => h('li', {},
      h('a', { class: 'bgoal__row', href: `#/builds/${encodeURIComponent(b.key)}` },
        h('span', { class: 'bgoal__rank', text: String(i + 1) }),
        h('span', { class: 'bgoal__name', text: b.name_zh }),
        h('span', { class: 'bgoal__val', text: g.valText(b) }))))));
}

function buildCard(b) {
  const ratings = b.ratings || {};
  const ev = b.eval || {};
  const composite = ev.composite;
  const mult = b.trinket && b.trinket.multiplier;
  const share = ev.trinket_share;
  return h('a', {
    class: 'bcard',
    href: `#/builds/${encodeURIComponent(b.key)}`,
    attrs: { 'aria-label': `第 ${b.order} 套：${b.name_zh}，${b.role || ''}` },
  },
  h('div', { class: 'bcard__top' },
    h('span', { class: 'bcard__no', text: `#${b.order}` }),
    h('div', { class: 'bcard__ident' },
      h('span', { class: 'bcard__name', text: b.name_zh }),
      h('span', { class: 'bcard__role', text: b.role || '—' })),
    h('span', { class: 'bcard__chev', attrs: { 'aria-hidden': 'true' } }, icon('chevron-right', { size: 16 }))),
  h('p', { class: 'bcard__tagline', text: b.tagline || '' }),
  h('div', { class: 'bcard__tags' },
    tagEl(archPairText(b), 'archetype'),
    tagEl(weightClassZh(b), 'armor'),
    mult != null
      ? h('span', { class: 'tag btag--gold' }, icon('trophy', { size: 11 }), h('span', { text: `饰品 ×${fmt.num(mult, 2)}` }))
      : null),
  h('div', { class: 'bcard__rates' }, ...RATINGS.map((d) => ratingCell(d, Number(ratings[d.key]) || 0))),
  h('div', { class: 'bcard__foot' },
    h('span', { class: 'bcard__stat' },
      h('span', { class: 'bcard__statk', text: '综合' }),
      h('b', { class: 'bcard__statv', text: composite == null ? '—' : fmt.num(composite, 2) })),
    share != null
      ? h('span', { class: 'bcard__stat' },
        h('span', { class: 'bcard__statk', text: '饰品贡献' }),
        h('b', { class: 'bcard__statv', text: fmt.pct(share, 1) }))
      : null,
    h('span', { class: 'bcard__more' }, '查看详情', icon('arrow-right', { size: 13 }))));
}

function comparePanel() {
  const head = h('thead', {}, h('tr', {},
    h('th', { class: 'btbl__num', text: '#' }),
    h('th', { text: '流派' }),
    h('th', { text: '定位' }),
    h('th', { text: '职业（主 / 副）' }),
    ...RATINGS.map((d) => h('th', { class: 'btbl__num', attrs: { title: d.tip }, text: d.zh })),
    h('th', { class: 'btbl__num', text: '综合' }),
    h('th', { class: 'btbl__num', text: '饰品乘区' }),
    h('th', { class: 'btbl__num', text: '饰品贡献' })));
  const rows = ORDER.map((b) => {
    const r = b.ratings || {};
    const ev = b.eval || {};
    return h('tr', {},
      h('td', { class: 'btbl__num', text: String(b.order) }),
      h('td', {}, h('a', { class: 'btbl__name', href: `#/builds/${encodeURIComponent(b.key)}`, text: b.name_zh })),
      h('td', { text: b.role || '—' }),
      h('td', { text: archPairText(b) }),
      ...RATINGS.map((d) => h('td', { class: 'btbl__num', text: fmt.num(Number(r[d.key]) || 0, 1) })),
      h('td', { class: 'btbl__num', text: ev.composite == null ? '—' : fmt.num(ev.composite, 2) }),
      h('td', { class: 'btbl__num', text: b.trinket && b.trinket.multiplier != null ? `×${fmt.num(b.trinket.multiplier, 2)}` : '—' }),
      h('td', { class: 'btbl__num', text: ev.trinket_share == null ? '—' : fmt.pct(ev.trinket_share, 1) }));
  });
  return h('section', { class: 'panel' },
    h('div', { class: 'panel__head' },
      h('h2', { class: 'panel__title' }, icon('scale', { size: 15 }), '横向对比'),
      h('span', { class: 'panel__sub', text: '评分 1~5；难度 / 门槛越高越吃操作与特定装备' })),
    h('div', { class: 'panel__body' },
      h('div', { class: 'tbl-scroll' },
        h('table', { class: 'tbl btbl' }, head, h('tbody', {}, ...rows))),
      h('p', { class: 'bcap', text: '饰品乘区 = 只保留 5 件饰品时的近似伤害倍率；饰品贡献 = 去掉饰品后失去的输出占比。两者都是模型估算，用来说明相对权重。' })));
}

function rulesPanel() {
  const rules = DATA.rules || [];
  if (!rules.length) return null;
  return panel('listchecks', '配装规则', h('ol', { class: 'brules' }, ...rules.map((r) => h('li', { class: 'brule' },
    h('b', { class: 'brule__t', text: r.title || '' }),
    h('p', { class: 'brule__x', text: r.text || '' })))), { sub: `${rules.length} 条` });
}

function trinketScarcityFold() {
  const sc = DATA.trinket_scarcity;
  if (!sc) return null;
  const principles = DATA.trinket_principles || [];
  const rings = sc.rings || {};
  const amulets = sc.amulets || {};
  const keys = [...new Set([...Object.keys(rings), ...Object.keys(amulets)])];
  const rows = keys.map((k) => ({ k, r: Number(rings[k]) || 0, a: Number(amulets[k]) || 0 }))
    .sort((x, y) => x.r - y.r || x.a - y.a);
  return h('details', { class: 'fold' },
    h('summary', {}, h('span', { text: `饰品乘区原则与稀缺统计（戒指 ${sc.rings_total} 枚 / 项链 ${sc.amulets_total} 条）` })),
    h('div', { class: 'fold__body stack-3' },
      h('ul', { class: 'blist' }, ...principles.map((t) => h('li', { class: 'blist__li', text: t }))),
      h('div', { class: 'tbl-scroll tbl-scroll--h' },
        h('table', { class: 'tbl tbl--dense' },
          h('thead', {}, h('tr', {},
            h('th', { text: '词条' }),
            h('th', { class: 'btbl__num', text: '戒指' }),
            h('th', { class: 'btbl__num', text: '项链' }))),
          h('tbody', {}, ...rows.map((r) => h('tr', { class: r.r <= 3 ? 'is-hi' : '' },
            h('td', { text: r.k }),
            h('td', { class: 'btbl__num', text: String(r.r) }),
            h('td', { class: 'btbl__num', text: String(r.a) }))))))));
}

function notesPanel() {
  const evalNotes = DATA.eval_notes || [];
  const dataNotes = DATA.data_notes || [];
  const meta = DATA.meta || {};
  const body = h('div', { class: 'bnotes' });
  if (evalNotes.length) {
    body.append(h('div', { class: 'bsub' },
      h('div', { class: 'bsub__t', text: '评分口径' }),
      h('ul', { class: 'blist' }, ...evalNotes.map((t) => h('li', { class: 'blist__li', text: t })))));
  }
  const scFold = trinketScarcityFold();
  if (scFold) body.append(scFold);
  if (dataNotes.length) {
    body.append(h('details', { class: 'fold' },
      h('summary', {}, h('span', { text: `数据说明（${dataNotes.length} 条）` })),
      h('div', { class: 'fold__body' },
        h('ul', { class: 'blist' }, ...dataNotes.map((t) => h('li', { class: 'blist__li', text: t }))))));
  }
  body.append(h('p', { class: 'bfoot', text: `数据源：${meta.source || '—'} · 生成 ${String(meta.generated_at || '—').replace('T', ' ').slice(0, 16)} · 只读离线数据，不启动、不注入、不修改游戏` }));
  return panel('info', '评分与数据口径', body, { sub: '读这些分数之前先知道它怎么来的' });
}

/* -------------------------------- 详情页 --------------------------------- */
function renderDetail(b) {
  clear(EL.body);
  const ev = b.eval || {};
  const hero = h('article', { class: 'bhero panel' },
    h('div', { class: 'bhero__head' },
      h('nav', { class: 'bcrumb', attrs: { 'aria-label': '面包屑' } },
        h('a', { class: 'bcrumb__a', href: '#/builds', text: DOMAIN }),
        h('span', { class: 'bcrumb__sep', text: '/' }),
        h('span', { class: 'bcrumb__cur', text: `#${b.order} ${b.name_zh}` })),
      h('a', { class: 'btn btn--quiet btn--sm bhero__back', href: '#/builds' },
        icon('chevron-left', { size: 14 }), '全部流派')),
    h('div', { class: 'bhero__top' },
      h('span', { class: 'bhero__no', text: `#${b.order}` }),
      h('div', { class: 'bhero__ident' },
        h('h1', { class: 'bhero__name', text: b.name_zh }),
        h('p', { class: 'bhero__tagline', text: b.tagline || '' }),
        h('div', { class: 'bhero__tags' },
          tagEl(b.role || '—', 'target'),
          tagEl(weightClassZh(b), 'armor'),
          ...(b.archetypes || []).slice(0, 2).map((a) => tagEl(archZh(a), 'archetype')))),
      h('div', { class: 'bhero__acts' },
        h('button', {
          class: 'btn btn--primary', type: 'button',
          attrs: { title: '把本套可解析的装备写入实验室 15 个槽位' },
          on: { click: () => loadIntoLab(b) },
        }, icon('flask', { size: 15 }), '装入实验室'))),
    h('p', { class: 'bhero__scenario' },
      h('span', { class: 'bhero__scenario-ico' }, icon('info', { size: 14 })),
      h('span', {}, h('b', { text: '适用场景：' }), b.scenario || '—')),
    h('div', { class: 'bhero__stats' },
      statbox('综合评分', ev.composite == null ? '—' : fmt.num(ev.composite, 2), '/ 5', 'trophy'),
      statbox('护甲值', b.armor && b.armor.total_armor != null ? fmt.num(b.armor.total_armor, 1) : '—', '', 'armor'),
      statbox('总负重', b.armor && b.armor.total_weight != null ? fmt.num(b.armor.total_weight, 1) : '—', weightClassZh(b), 'weight')));

  const main = h('div', { class: 'bmain' },
    chainPanel(b),
    weaponPanel(b),
    armorPanel(b),
    trinketPanel(b),
    archetypePanel(b),
    assemblyPanel(b),
    loopPanel(b),
    altPanel(b),
    trashPanel(b),
    difficultyPanel(b),
    trinketMathPanel(b),
    detailNotesPanel(b));
  const aside = h('aside', { class: 'baside' }, ratingPanel(b), adjacentPanel(b));
  EL.body.append(hero, h('div', { class: 'bdetail' }, main, aside));
}

function chainPanel(b) {
  if (!b.chain_zh) return null;
  return panel('hash', '伤害链条', h('div', { class: 'bchain' },
    h('span', { class: 'bchain__ico' }, icon('hash', { size: 16 })),
    h('p', { class: 'bchain__t', text: b.chain_zh })),
  { sub: '同一乘区相加、不同乘区相乘' });
}

/* 武器：名称 + 固有改装 / 变异器 / 改装，全部可点真实道具 */
function weaponPanel(b) {
  const w = (b.loadout && b.loadout.weapons) || {};
  const rows = [
    weaponRow('long_gun', w.long_gun),
    weaponRow('hand_gun', w.hand_gun),
    weaponRow('melee_weapon', w.melee_weapon),
  ].filter(Boolean);
  if (!rows.length) return null;
  return panel('longgun', '武器', h('div', { class: 'bweps' }, ...rows),
    { sub: '点名称看全站详情；改装与变异器同样可点' });
}

function weaponBit(label, node) {
  return h('span', { class: 'bwep__bit' }, h('span', { class: 'bwep__bitk', text: label }), node);
}

function weaponRow(slot, w) {
  if (!w) return null;
  const meta = SLOT_META[slot] || { zh: '武器', icon: 'sword' };
  const item = w.id ? api.item(w.id) : null;
  const media = h('div', { class: 'bwep__media' }, item ? itemIconEl(item) : icon(meta.icon, { size: 20 }));
  const name = item
    ? h('button', {
      class: 'bwep__name', type: 'button',
      attrs: { 'aria-label': `查看 ${item.zh} 详情` },
      on: { click: () => openItemDetail(item.id) },
    }, item.zh)
    : h('span', { class: 'bwep__name', text: w.name_zh || '—' });
  const bits = [];
  if (w.inherent_mod_item && w.inherent_mod_item.id) {
    const c = chipEl(w.inherent_mod_item.id, 'mod', { sm: true });
    if (c) bits.push(weaponBit('固有改装', c));
  } else if (w.inherent_mod) {
    bits.push(weaponBit('固有改装', h('span', { class: 'btag btag--muted', text: '不可更换' })));
  }
  if (w.mutator) {
    const c = chipEl(w.mutator, 'meta_gem', { sm: true });
    if (c) bits.push(weaponBit('变异器', c));
  }
  if (w.mod) {
    const c = chipEl(w.mod, 'mod', { sm: true });
    if (c) bits.push(weaponBit('改装', c));
  } else if (w.can_swap_mod) {
    bits.push(weaponBit('改装', h('span', { class: 'btag btag--muted', text: '空闲' })));
  }
  return h('div', { class: 'bwep' }, media,
    h('div', { class: 'bwep__body' },
      h('div', { class: 'bwep__label', text: meta.zh }),
      name,
      w.name_en ? h('div', { class: 'bwep__en', text: w.name_en }) : null,
      bits.length ? h('div', { class: 'bwep__bits' }, ...bits) : null));
}

/* 护甲：档位 / 总护甲 / 总负重 + 四件混搭 */
function armorPanel(b) {
  const a = b.armor || {};
  const parts = b.armor_parts || [];
  const head = h('div', { class: 'barmor__head' },
    h('div', { class: 'barmor__need' }, icon('info', { size: 13 }), h('span', { text: a.need || '—' })),
    h('div', { class: 'barmor__stats' },
      h('span', { class: 'barmor__stat' }, h('span', { class: 'barmor__statk', text: '档位' }), h('b', { text: weightClassZh(b) })),
      h('span', { class: 'barmor__stat' }, h('span', { class: 'barmor__statk', text: '护甲值' }), h('b', { text: a.total_armor != null ? fmt.num(a.total_armor, 1) : '—' })),
      h('span', { class: 'barmor__stat' }, h('span', { class: 'barmor__statk', text: '总负重' }), h('b', { text: a.total_weight != null ? fmt.num(a.total_weight, 1) : '—' }))));
  const grid = h('div', { class: 'barmor__grid' }, ...ARMOR_SLOTS.map((slot, i) => armorPiece(parts[i], slot)).filter(Boolean));
  return panel('armor', '护甲', h('div', { class: 'stack-3' },
    head, grid,
    a.note ? h('p', { class: 'bnote', text: a.note }) : null),
  { sub: '本作护甲没有套装效果，四件按负重档位混搭' });
}

function armorPiece(id, slot) {
  if (!id) return null;
  const meta = SLOT_META[slot] || { zh: '', icon: 'armor' };
  const item = api.item(id);
  if (!item) {
    return h('div', { class: 'bpiece' },
      h('span', { class: 'bpiece__media' }, icon(meta.icon, { size: 16 })),
      h('div', { class: 'bpiece__body' },
        h('span', { class: 'bpiece__label', text: meta.zh }),
        h('span', { class: 'bpiece__name', text: id })));
  }
  const stats = [];
  if (item.armor != null) stats.push(`护甲 ${fmt.num(item.armor, 1)}`);
  if (item.weight != null) stats.push(`负重 ${fmt.num(item.weight, 1)}`);
  if (item.resistSum) stats.push(`抗性 +${fmt.num(item.resistSum, 0)}`);
  return h('button', {
    class: 'bpiece', type: 'button',
    attrs: { 'aria-label': `查看 ${item.zh} 详情` },
    on: { click: () => openItemDetail(item.id) },
  },
  h('span', { class: 'bpiece__media' }, itemIconEl(item)),
  h('div', { class: 'bpiece__body' },
    h('span', { class: 'bpiece__label', text: meta.zh }),
    h('span', { class: 'bpiece__name', text: item.zh }),
    stats.length ? h('span', { class: 'bpiece__stats', text: stats.join(' · ') }) : null));
}

/* 饰品：项链 + 4 戒指 + 圣物；碎片 / 棱镜传奇词条单列 */
function trinketPanel(b) {
  const slots = b.slots || {};
  const rows = [];
  if (slots.amulet && slots.amulet[0]) rows.push(trinketRow(slots.amulet[0], 'amulet', '项链'));
  (slots.ring || []).forEach((id, i) => { if (id) rows.push(trinketRow(id, 'ring', `戒指 ${i + 1}`)); });
  if (slots.relic && slots.relic[0]) rows.push(trinketRow(slots.relic[0], 'relic', '圣物'));
  const groups = [
    chipGroup('圣物碎片', slots.fragment, 'fragment'),
    chipGroup('棱镜传奇词条', slots.legendary, 'legendary'),
  ].filter(Boolean);
  if (!rows.length && !groups.length) return null;
  return panel('ring', '饰品', h('div', { class: 'stack-3' },
    rows.length ? h('div', { class: 'btrinkets' }, ...rows) : null,
    groups.length ? h('div', { class: 'bgroups' }, ...groups) : null),
  { sub: '项链 + 4 戒指 + 圣物；碎片与棱镜词条只作说明' });
}

function trinketRow(ref, slot, label) {
  const e = entity(ref);
  if (!e) return null;
  const media = h('span', { class: 'btrinket__media' }, e.item ? itemIconEl(e.item) : icon((SLOT_META[slot] || {}).icon || 'info', { size: 16 }));
  const body = h('div', { class: 'btrinket__body' },
    h('span', { class: 'btrinket__label', text: label }),
    h('span', { class: 'btrinket__name', text: e.zh }),
    e.effectZh ? h('span', { class: 'btrinket__effect', text: e.effectZh }) : null);
  if (e.item && e.id) {
    return h('button', {
      class: 'btrinket', type: 'button',
      attrs: { 'aria-label': `查看 ${e.zh} 详情` },
      on: { click: () => openItemDetail(e.id) },
    }, media, body);
  }
  return h('div', { class: 'btrinket' }, media, body);
}

/* 职业与天赋 */
function archetypePanel(b) {
  const archs = b.archetypes || [];
  const slots = b.slots || {};
  const groups = [
    chipGroup('特性（最多 10 个）', slots.trait, 'trait'),
    chipGroup('职业专长', slots.perk, 'perk'),
    chipGroup('技能', slots.skill, 'skill'),
  ].filter(Boolean);
  if (!archs.length && !groups.length) return null;
  return panel('archetype', '职业与天赋', h('div', { class: 'stack-3' },
    archs.length ? h('div', { class: 'barchs' }, ...archs.map((a, i) => archetypeBlock(a, i))) : null,
    groups.length ? h('div', { class: 'bgroups' }, ...groups) : null));
}

function archetypeBlock(a, i) {
  const off = archOfficial(a);
  const roleZh = a.role === '主' || a.role === '副' ? a.role : (i === 0 ? '主' : '副');
  return h('div', { class: 'barch' },
    h('div', { class: 'barch__head' },
      h('span', { class: 'barch__ico' }, icon('archetype', { size: 17 })),
      h('div', { class: 'barch__ident' },
        h('span', { class: 'barch__name', text: archZh(a) }),
        off ? h('span', { class: 'barch__en', text: off.en }) : null),
      h('span', { class: `badge ${roleZh === '主' ? 'badge--gold' : 'badge--neutral'}`, text: `${roleZh}职业` })),
    h('p', { class: 'barch__why', text: a.why || '' }));
}

/* 装配说明：改装分配 / fix_reason / 可换槽 / 变体 / 未用改装 */
function assemblyPanel(b) {
  const lo = b.loadout || {};
  const kids = [];
  if (lo.fix_reason) kids.push(h('p', { class: 'bnote', text: lo.fix_reason }));
  const free = (lo.free_mod_slots || []).map((s) => (SLOT_META[s] ? SLOT_META[s].zh : s));
  if (free.length) {
    kids.push(h('p', { class: 'bnote' },
      h('b', { text: '可换改装的位置：' }),
      h('span', { text: free.join('、') })));
  }
  const unused = (lo.unused_mods || []).map((ref) => {
    if (typeof ref === 'string') return chipEl(ref, 'mod');
    if (ref && ref.id) return chipEl(ref.id, 'mod');
    return null;
  }).filter(Boolean);
  if (unused.length) {
    kids.push(h('div', { class: 'bsub' },
      h('div', { class: 'bsub__t', text: '未使用的改装' }),
      h('div', { class: 'bchips' }, ...unused)));
  }
  if ((lo.variants || []).length) {
    kids.push(h('div', { class: 'bsub' },
      h('div', { class: 'bsub__t', text: '变体' }),
      h('ul', { class: 'blist' }, ...lo.variants.map((t) => h('li', { class: 'blist__li', text: t })))));
  }
  if (!kids.length) return null;
  return panel('swap', '装配说明', h('div', { class: 'stack-3' }, ...kids),
    { sub: '改装 / 变异器怎么分、哪些位置可以换' });
}

/* 循环 / 替换 / 清群 / 难点 */
function loopPanel(b) {
  const loop = b.loop || [];
  if (!loop.length) return null;
  return panel('loop', '输出循环', h('ol', { class: 'blist blist--ol' },
    ...loop.map((t) => h('li', { class: 'blist__li', text: t }))),
  { sub: `${loop.length} 步` });
}

function altPanel(b) {
  const alts = b.alts || [];
  if (!alts.length) return null;
  return panel('swap', '替换方案', h('ul', { class: 'blist' },
    ...alts.map((t) => h('li', { class: 'blist__li', text: t }))),
  { sub: `${alts.length} 条` });
}

function trashPanel(b) {
  const plan = b.trash_plan || [];
  const fix = b.trash_fix || [];
  if (!plan.length && !fix.length) return null;
  const kids = [];
  if (plan.length) {
    kids.push(h('div', { class: 'bsub' },
      h('div', { class: 'bsub__t' }, icon('warning', { size: 13 }), h('span', { text: '为什么清群吃力' })),
      h('ul', { class: 'blist' }, ...plan.map((t) => h('li', { class: 'blist__li', text: t })))));
  }
  if (fix.length) {
    kids.push(h('div', { class: 'bsub' },
      h('div', { class: 'bsub__t' }, icon('sparkle', { size: 13 }), h('span', { text: '怎么补清群' })),
      h('ul', { class: 'blist' }, ...fix.map((t) => h('li', { class: 'blist__li', text: t })))));
  }
  return panel('target', '清群诊断', h('div', { class: 'stack-3' }, ...kids));
}

function difficultyPanel(b) {
  const notes = b.difficulty_notes || [];
  if (!notes.length) return null;
  return panel('warning', '难点与注意事项', h('ul', { class: 'blist' },
    ...notes.map((t) => h('li', { class: 'blist__li', text: t }))),
  { sub: `${notes.length} 条` });
}

/* 饰品乘区（独立分区：乘区、贡献占比、拆解） */
function trinketMathPanel(b) {
  const t = b.trinket || {};
  const ev = b.eval || {};
  const share = ev.trinket_share;
  const kids = [];
  kids.push(h('div', { class: 'btrinket-sum' },
    h('div', { class: 'btrinket-sum__mult' },
      h('span', { class: 'btrinket-sum__k', text: '饰品乘区' }),
      h('span', { class: 'btrinket-sum__v', text: t.multiplier != null ? `×${fmt.num(t.multiplier, 2)}` : '—' })),
    share != null
      ? h('div', { class: 'btrinket-sum__side' },
        h('div', { class: 'meter' }, h('div', { class: 'meter__fill', attrs: { style: `--v:${Math.max(0, Math.min(1, Number(share) || 0))}` } })),
        h('span', { class: 'btrinket-sum__share', text: `饰品贡献 ${fmt.pct(share, 1)}（去掉 5 件饰品后只剩 ${fmt.pct(Math.max(0, 1 - share), 1)}）` }))
      : null));
  if (t.note) kids.push(h('p', { class: 'bnote', text: t.note }));
  if ((t.lines || []).length) {
    kids.push(h('ul', { class: 'blist' }, ...t.lines.map((line) => h('li', { class: 'blist__li', text: line }))));
  }
  if (!kids.length) return null;
  return panel('trophy', '饰品乘区', h('div', { class: 'stack-3' }, ...kids),
    { sub: '口径：只保留 5 件饰品时的近似伤害倍率' });
}

/* 口径与证据 */
function detailNotesPanel(b) {
  const evalNotes = DATA.eval_notes || [];
  const dataNotes = DATA.data_notes || [];
  const evidence = (b.evidence || []).filter(Boolean);
  const meta = DATA.meta || {};
  const kids = [];
  if (evalNotes.length) {
    kids.push(h('div', { class: 'bsub' },
      h('div', { class: 'bsub__t', text: '评分口径' }),
      h('ul', { class: 'blist' }, ...evalNotes.map((t) => h('li', { class: 'blist__li', text: t })))));
  }
  if (evidence.length) {
    kids.push(h('details', { class: 'fold' },
      h('summary', {}, h('span', { text: `数据证据（${evidence.length} 条引用）` })),
      h('div', { class: 'fold__body' },
        h('div', { class: 'bchips' }, ...evidence.map((ref) => chipEl(ref, '')).filter(Boolean)))));
  }
  if (dataNotes.length) {
    kids.push(h('details', { class: 'fold' },
      h('summary', {}, h('span', { text: `数据说明（${dataNotes.length} 条）` })),
      h('div', { class: 'fold__body' },
        h('ul', { class: 'blist' }, ...dataNotes.map((t) => h('li', { class: 'blist__li', text: t }))))));
  }
  kids.push(h('p', { class: 'bfoot', text: `数据源：${meta.source || '—'} · 生成 ${String(meta.generated_at || '—').replace('T', ' ').slice(0, 16)} · 只读离线数据，不启动、不注入、不修改游戏` }));
  return panel('info', '口径与证据', h('div', { class: 'stack-3' }, ...kids),
    { sub: '分数怎么来的、引用了哪些道具' });
}

/* --------------------------------- 侧栏 --------------------------------- */
function ratingPanel(b) {
  const r = b.ratings || {};
  const rows = RATINGS.map((d) => h('div', { class: 'brate-row', attrs: d.tip ? { 'data-tip': d.tip } : {} },
    h('span', { class: 'brate-row__k' }, icon(d.icon, { size: 12 }), h('span', { text: d.zh })),
    stars(Number(r[d.key]) || 0),
    h('span', { class: 'brate-row__v', text: fmt.num(Number(r[d.key]) || 0, 1) })));
  return panel('chart', '评分', h('div', { class: 'brating' },
    rows,
    h('p', { class: 'bnote bnote--tiny', text: '难度 / 门槛越高，越吃操作与特定装备。' })));
}

function adjacentPanel(b) {
  const i = ORDER.findIndex((x) => x.key === b.key);
  const prev = i > 0 ? ORDER[i - 1] : null;
  const next = i >= 0 && i < ORDER.length - 1 ? ORDER[i + 1] : null;
  const mk = (t, dir) => {
    if (!t) {
      return h('span', { class: 'badj__row badj__row--empty', text: dir === 'prev' ? '已经是第一套' : '已经是最后一套' });
    }
    return h('a', { class: 'badj__row', href: `#/builds/${encodeURIComponent(t.key)}` },
      dir === 'prev' ? icon('chevron-left', { size: 14 }) : null,
      h('span', { class: 'badj__body' },
        h('span', { class: 'badj__k', text: `${dir === 'prev' ? '上一套' : '下一套'} · #${t.order}` }),
        h('span', { class: 'badj__t', text: t.name_zh })),
      dir === 'next' ? icon('chevron-right', { size: 14 }) : null);
  };
  return panel('loop', '切换流派', h('div', { class: 'badj' }, mk(prev, 'prev'), mk(next, 'next')),
    { sub: `${ORDER.length} 套按序号排列` });
}

/* ------------------------------ 装入实验室 ------------------------------ */
/** 把可解析的真实 id 写入 store.build 的 15 个槽位（未映射的改装 / 天赋 / 碎片跳过） */
function loadIntoLab(b) {
  const slots = b.slots || {};
  const first = (arr) => (Array.isArray(arr) ? arr[0] : '');
  const pairs = [];
  const addItem = (slot, id) => { if (id && api.item(id)) pairs.push([slot, id]); };
  addItem('longGun', first(slots.long_gun));
  addItem('handGun', first(slots.hand_gun));
  addItem('melee', first(slots.melee_weapon));
  ARMOR_SLOTS.forEach((slot, i) => addItem(slot, (b.armor_parts || [])[i]));
  addItem('amulet', first(slots.amulet));
  (slots.ring || []).slice(0, 4).forEach((id, i) => addItem(`ring${i + 1}`, id));
  addItem('relic', first(slots.relic));
  const archs = b.archetypes || [];
  const arch1 = archOfficial(archs[0]);
  const arch2 = archOfficial(archs[1]);
  if (arch1) pairs.push(['archetype1', arch1.id]);
  if (arch2) pairs.push(['archetype2', arch2.id]);

  for (const [slot, id] of pairs) store.build.set(slot, id);
  if (b.name_zh) store.build.setName(b.name_zh);
  const skipped = ['mod', 'meta_gem', 'trait', 'perk', 'skill', 'fragment', 'legendary']
    .reduce((n, k) => n + (Array.isArray(slots[k]) ? slots[k].length : 0), 0);
  ui.toast(`已装入实验室：${pairs.length} 个槽位${skipped ? `（另有 ${skipped} 项改装 / 天赋 / 碎片未映射，已跳过）` : ''}`,
    'ok', { timeout: 4200 });
  router.go('/lab');
}

/* ------------------------------ 404 / 错误态 ----------------------------- */
function renderNotFound(key) {
  clear(EL.body);
  EL.body.append(h('div', { class: 'empty b404' },
    h('div', { class: 'empty__ico' }, icon('search', { size: 40 })),
    h('p', { class: 'empty__title', text: '没有这套流派' }),
    h('p', { class: 'empty__hint', text: `「${key}」不在 ${ORDER.length} 套推荐配装里，可能是旧链接或拼写错误。` }),
    h('a', { class: 'btn btn--ghost', href: '#/builds' }, icon('chevron-left', { size: 15 }), '返回流派列表')));
}

function renderError(err) {
  clear(EL.body);
  EL.body.append(h('div', { class: 'empty b404' },
    h('div', { class: 'empty__ico' }, icon('warning', { size: 40 })),
    h('p', { class: 'empty__title', text: '流派数据没加载出来' }),
    h('p', { class: 'empty__hint', text: `数据文件 /data/builds.json 可能缺失或格式有误。${err && err.message ? `（${err.message}）` : ''}` }),
    h('button', {
      class: 'btn btn--ghost', type: 'button',
      on: {
        click: () => {
          PENDING = null;
          renderLoading();
          load().then(() => { if (EL) show(router.getRoute()); }).catch((e) => { if (EL) renderError(e); });
        },
      },
    }, icon('refresh', { size: 15 }), '重新加载')));
}

function renderLoading() {
  clear(EL.body);
  EL.body.append(h('div', { class: 'bskel' },
    h('div', { class: 'sk' },
      h('div', { class: 'sk__line' }),
      h('div', { class: 'sk__line sk__line--short' })),
    h('div', { class: 'sk' },
      h('div', { class: 'sk__line' }),
      h('div', { class: 'sk__line' }),
      h('div', { class: 'sk__line sk__line--short' }))));
}

/* --------------------------------- 路由 --------------------------------- */
function show(ctx) {
  if (!EL || !DATA) return;
  const key = String((ctx && ctx.sub) || '');
  if (!key) {
    setSubnavTitle(false);
    renderList();
    deferTitle('流派 · 7 套推荐配装');
    return;
  }
  const b = BY_KEY.get(key);
  if (!b) {
    setSubnavTitle(false);
    renderNotFound(key);
    deferTitle('未找到流派 · 流派');
    return;
  }
  setSubnavTitle(true);
  renderDetail(b);
  deferTitle(`${b.name_zh} · 流派`);
}

/* ---------------------------------- mount --------------------------------- */
export function mount(rootEl, ctx) {
  clear(rootEl);
  rootEl.classList.add('builds-root');

  const titleSlot = h('div', { class: 'builds-subnav__slot' });
  const body = h('div', { class: 'builds-body', attrs: { id: 'builds-main' } });
  const wrap = h('div', { class: 'wrap builds-wrap' },
    h('div', { class: 'subnav builds-subnav' },
      titleSlot,
      h('span', { class: 'builds-subnav__hint', text: '7 套推荐配装 · 目标 · 乘区 · 口径' }),
      h('div', { class: 'subnav__tools' },
        h('a', { class: 'btn btn--quiet btn--sm', href: '#/lab' }, icon('flask', { size: 14 }), '实验室'),
        h('a', { class: 'btn btn--quiet btn--sm', href: '#/codex' }, icon('book', { size: 14 }), '乘区机制'))),
    body);
  rootEl.append(wrap);
  EL = { root: rootEl, body, titleSlot };
  setSubnavTitle(false);
  renderLoading();

  load()
    .then(() => {
      if (!EL) return;
      const cur = router.getRoute();
      const next = cur && cur.domain === 'builds' ? cur : (ctx && ctx.domain === 'builds' ? ctx : { domain: 'builds', sub: '' });
      show(next);
    })
    .catch((err) => {
      if (!EL) return;
      console.error('[builds] 数据加载失败', err);
      renderError(err);
      deferTitle('流派 · 加载失败');
    });

  return {
    onRoute(next) {
      if (next && next.domain === 'builds') show(next);
    },
    unmount() {
      EL = null;
    },
  };
}

/* --------------------------------- 数据加载 -------------------------------- */
function load() {
  if (DATA) return Promise.resolve(DATA);
  if (PENDING) return PENDING;
  PENDING = Promise.all([api.builds(), api.ready(), api.archetypes()])
    .then(([data]) => {
      if (!data || !Array.isArray(data.builds) || !data.builds.length) throw new Error('流派数据为空');
      ORDER = data.builds.slice().sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0));
      BY_KEY = new Map(ORDER.map((x) => [x.key, x]));
      DATA = data;
      return DATA;
    })
    .catch((err) => { PENDING = null; throw err; });
  return PENDING;
}
