/* =============================================================================
   遗迹2 · 遗物档案 — lab/wb-parts.js（装配台 v3）
   装配台 6 个分类页共用的渲染小件与分类登记表。
   只放「结构与组合」，样式全在 css/view-lab.css；颜色只来自 tokens（本文件不写样式）。
   模块契约见 docs/ASSEMBLY_V3.md 与 js/lab/wb-assembly.js 顶部注释。
   ========================================================================== */
import { h, clear, fmt } from '../core/dom.js';
import { icon } from '../core/icons.js';
import { itemMedia } from './parts.js';

/* ----------------------------- 分类登记表（唯一事实源） ----------------------------- */
/** 6 个分类页：顺序 = 装配台 tab 顺序；sub 会显示在标题栏右侧 */
export const CATS = [
  { id: 'armor', zh: '护甲四件', icon: 'armor', sub: '4 槽 · 护甲值 / 负重 / 抗性计入合计' },
  { id: 'weapons', zh: '武器与改装', icon: 'longgun', sub: '3 槽 · 变异器 / 改装挂件' },
  { id: 'archetype', zh: '职业与技能', icon: 'archetype', sub: '主 / 副职业 · 技能 3 选 1' },
  { id: 'trinkets', zh: '饰品', icon: 'gem', sub: '1 项链 + 4 戒指' },
  { id: 'traits', zh: '特性', icon: 'trait', sub: '上限 10 个 · 每个 0–10 级' },
  { id: 'relic', zh: '圣物与碎片', icon: 'relic', sub: '圣物 + 3 碎片槽' },
];
export const CAT_BY_ID = new Map(CATS.map((c) => [c.id, c]));

/* ----------------------------- 基础小件 ----------------------------- */
/** 行内图标按钮（无文字 → 必须 aria-label；title 同名） */
export function iconAct(iconName, title, onClick, { danger = false, on = false, size = 14 } = {}) {
  const cls = `iconbtn iconbtn--sm${danger ? ' iconbtn--danger' : ''}${on ? ' is-on' : ''}`;
  return h('button', {
    class: cls, type: 'button', title, attrs: { 'aria-label': title },
    on: { click: (e) => { e.stopPropagation(); onClick?.(e); } },
  }, icon(iconName, { size }));
}

/** 小标签（非按钮，纯展示） */
export function tag(text, { title = '', cls = '' } = {}) {
  return h('span', { class: `lab-tag ${cls}`.trim(), title, text: String(text == null ? '' : text) });
}

/** 碎片颜色徽标：red / yellow / blue */
const FRAG_COLOR_ZH = { red: '红', yellow: '黄', blue: '蓝' };
export function fragColorBadge(color) {
  const key = FRAG_COLOR_ZH[color] ? color : '';
  return h('span', {
    class: `lab-fragcolor${key ? ` lab-fragcolor--${key}` : ''}`,
    title: key ? `${FRAG_COLOR_ZH[key]}色碎片` : '颜色待验证',
    text: key ? FRAG_COLOR_ZH[key] : '?',
  });
}

/* ----------------------------- 分类页骨架 ----------------------------- */
/**
 * 分类页骨架：{ el, head, body, foot }
 * head = 标题栏（icon + 标题 + 副标题 + 右侧 actions）；body = 表格；foot = 口径注释。
 */
export function catShell({ title, sub = '', iconName = '', actions = [] } = {}) {
  const acts = h('div', { class: 'lab-cat__acts' });
  const head = h('div', { class: 'lab-cat__head' },
    h('div', { class: 'lab-cat__title' },
      iconName ? h('span', { class: 'lab-cat__ico' }, icon(iconName, { size: 15 })) : '',
      h('span', { text: title }),
      sub ? h('span', { class: 'lab-cat__sub', text: sub }) : '',
    ),
    acts,
  );
  const body = h('div', { class: 'lab-cat__body' });
  const foot = h('div', { class: 'lab-cat__foot' });
  const el = h('div', { class: 'lab-cat' }, head, body, foot);
  acts.append(...actions.filter(Boolean));
  return { el, head, body, foot, acts };
}

/** 列头行：cols = [{ zh, w? }]（w 目前仅作数据属性，列宽由分类页 CSS 变量控制） */
export function catBar(cols = []) {
  return h('div', { class: 'lab-cat__bar', attrs: { role: 'row' } },
    cols.map((c) => h('span', { class: 'lab-cat__barcol', dataset: c.w ? { w: c.w } : undefined, text: c.zh || '' })));
}

/** 通用行容器：cells 依次为 槽位 / 装备 / 属性 / 效果 / 操作 */
export function crow(cells, { cls = '' } = {}) {
  return h('div', { class: `lab-crow ${cls}`.trim(), attrs: { role: 'row' } }, cells.filter(Boolean));
}

/** 槽位单元格：名称 + 可选徽标（缺件 / 当前 / 空） */
export function slotCell(label, iconName, { badge = null } = {}) {
  return h('div', { class: 'lab-crow__slot', attrs: { role: 'cell' } },
    iconName ? h('span', { class: 'lab-crow__slotico' }, icon(iconName, { size: 13 })) : '',
    h('span', { class: 'lab-crow__slotk', text: label }),
    badge || '',
  );
}

/**
 * 装备单元格：图标 + 中文名 + 英文小字 + 可选副说明 + 标签。
 * onClick 存在时整块可点（role=button + tabindex + 键盘），用于打开详情。
 */
export function itemCell({ iconUrl = null, zh = '', en = '', sub = '', tags = [], onClick = null } = {}) {
  const media = h('div', { class: 'lab-crow__media' }, itemMedia(iconUrl, { size: 38, alt: zh || '' }));
  const body = h('div', { class: 'lab-crow__body' },
    h('div', { class: 'lab-crow__name' }, h('span', { text: zh || '待验证' }), tags.filter(Boolean)),
    en ? h('div', { class: 'lab-crow__en', text: en }) : '',
    sub ? h('div', { class: 'lab-crow__sub', text: sub }) : '',
  );
  const cell = h('div', { class: `lab-crow__item${onClick ? ' is-click' : ''}`.trim(), attrs: { role: 'cell' } }, media, body);
  if (onClick) {
    cell.setAttribute('role', 'button');
    cell.setAttribute('tabindex', '0');
    cell.addEventListener('click', onClick);
    cell.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(e); } });
  }
  return cell;
}

/** 属性单元格：pairs = [{ k, v, unit?, iconName?, title? }] */
export function statCell(pairs = []) {
  return h('div', { class: 'lab-crow__stats', attrs: { role: 'cell' } },
    pairs.filter(Boolean).map((p) => h('span', { class: 'lab-stat', title: p.title || p.k || '' },
      p.iconName ? icon(p.iconName, { size: 11 }) : '',
      h('span', { class: 'lab-stat__v', text: p.v == null || p.v === '' ? '—' : String(p.v) }),
      p.unit ? h('span', { class: 'lab-stat__u', text: p.unit }) : '',
      h('span', { class: 'lab-stat__k', text: p.k || '' }),
    )));
}

/** 效果单元格：字符串按纯文本；Node 直接放 */
export function effectCell(content) {
  return h('div', { class: 'lab-crow__effect', attrs: { role: 'cell' } },
    content instanceof Node ? content : h('span', { text: content || '无已收录效果' }));
}

/** 操作单元格 */
export function actsCell(buttons = []) {
  return h('div', { class: 'lab-crow__acts', attrs: { role: 'cell' } }, buttons.filter(Boolean));
}

/** 空槽行：整行可点 → onPick；虚线样式 */
export function emptyCrow({ label, iconName = 'plus', hint = '点击选择装备', onPick = null, acts = [] } = {}) {
  const el = h('div', {
    class: 'lab-crow lab-crow--empty', attrs: { role: 'row', tabindex: onPick ? '0' : null },
  },
    slotCell(label, iconName),
    h('div', { class: 'lab-crow__emptyhint' }, icon('plus', { size: 14 }), h('span', { text: hint })),
    actsCell(acts),
  );
  if (onPick) {
    el.addEventListener('click', (e) => { if (e.target.closest('button')) return; onPick(); });
    el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPick(); } });
  }
  return el;
}

/** 子区块（武器挂件 / 职业技能 / 碎片槽等）：标题 + tools + 内容 */
export function catSection(title, children = [], { sub = '', tools = [] } = {}) {
  return h('div', { class: 'lab-catsub' },
    h('div', { class: 'lab-catsub__head' },
      h('span', { class: 'lab-catsub__title', text: title }),
      sub ? h('span', { class: 'lab-catsub__sub', text: sub }) : '',
      tools.length ? h('div', { class: 'lab-catsub__tools' }, ...tools.filter(Boolean)) : '',
    ),
    h('div', { class: 'lab-catsub__body' }, ...children.flat(4).filter((c) => c != null && c !== false && c !== '')),
  );
}

/** 口径注释行（info 图标 + 文案） */
export function noteLine(text) {
  return h('div', { class: 'lab-note' }, icon('info', { size: 12 }), h('span', { text }));
}

/** 空态行 */
export function emptyTab(text) {
  return h('div', { class: 'lab-emptyline' }, icon('info', { size: 14 }), h('span', { text }));
}

/* ----------------------------- 推荐卡片 ----------------------------- */
/**
 * recCard：右侧推荐面板的卡片。
 * { title, sub, score, meta:[string|Node], lines:[string|Node], tags:[string], actions:[Node], onClick }
 */
export function recCard({ title = '', sub = '', score = null, meta = [], lines = [], tags = [], actions = [], onClick = null } = {}) {
  const card = h('article', { class: `lab-recard${onClick ? ' is-click' : ''}`.trim(), attrs: onClick ? { role: 'button', tabindex: '0' } : {} },
    h('div', { class: 'lab-recard__head' },
      h('div', { class: 'lab-recard__title' }, h('span', { text: title }), tags.filter(Boolean).map((t) => tag(t))),
      score != null ? h('span', { class: 'lab-recard__score', text: String(score) }) : '',
    ),
    sub ? h('div', { class: 'lab-recard__sub', text: sub }) : '',
    meta.length ? h('div', { class: 'lab-recard__meta', attrs: { role: 'cell' } }, meta.filter(Boolean)) : '',
    lines.length ? h('div', { class: 'lab-recard__lines' }, lines.filter(Boolean).map((l) => (l instanceof Node ? l : h('div', { class: 'lab-recard__line', text: String(l) })))) : '',
    actions.length ? h('div', { class: 'lab-recard__acts' }, ...actions.filter(Boolean)) : '',
  );
  if (onClick) {
    card.addEventListener('click', (e) => { if (e.target.closest('button')) return; onClick(e); });
    card.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(e); } });
  }
  return card;
}

/** 推荐列表容器 */
export function recList(items = []) {
  return h('div', { class: 'lab-reclist' }, ...items.filter(Boolean));
}

/* ----------------------------- 特性步进器 ----------------------------- */
/** 0–10 等级步进器（特性用）：{ value, onDec, onInc, aria, min=0, max=10 } */
export function stepper({ value = 0, onDec, onInc, aria = '特性', min = 0, max = 10 } = {}) {
  const dec = h('button', {
    class: 'iconbtn iconbtn--sm', type: 'button', title: `${aria} 减一级`, attrs: { 'aria-label': `${aria} 减一级` },
    on: { click: (e) => { e.stopPropagation(); onDec?.(); } },
  }, icon('minus', { size: 12 }));
  const inc = h('button', {
    class: 'iconbtn iconbtn--sm', type: 'button', title: `${aria} 加一级`, attrs: { 'aria-label': `${aria} 加一级` },
    on: { click: (e) => { e.stopPropagation(); onInc?.(); } },
  }, icon('plus', { size: 12 }));
  dec.disabled = value <= min;
  inc.disabled = value >= max;
  return h('div', { class: 'lab-stepper', attrs: { role: 'group', 'aria-label': `${aria} 等级` } },
    dec, h('span', { class: 'lab-stepper__v', text: `${value}` }), inc);
}

/* ----------------------------- 数值格式化（各分类共用） ----------------------------- */
export const U = {
  num: (v, d = 1) => fmt.num(v, d),
  pct: (v, d = 1) => fmt.pct(v, d),
  sign: (v, d = 0) => fmt.sign(v, d),
  int: (v) => fmt.int(v),
};

export { h, clear, fmt, icon };
export default { CATS, catShell, catBar, crow, slotCell, itemCell, statCell, effectCell, actsCell, emptyCrow, catSection, noteLine, recCard, recList, tag, fragColorBadge, iconAct, stepper, emptyTab, U };
