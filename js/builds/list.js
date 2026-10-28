/* =============================================================================
   遗迹2 · 遗物档案 — builds/list.js
   流派列表页：简介、按目标选、7 张流派卡、横向对比、配装规则、评分/数据口径。
   数据由视图注入（data = builds.json，order = 按 order 升序的 7 套），本模块不持有视图状态。
   ========================================================================== */
import { h, clear, fmt } from '../core/dom.js';
import { icon } from '../core/icons.js';
import {
  RATINGS, GOALS, panel, tagEl, ratingCell, weightClassZh, archPairText,
} from './ui.js';

export function renderList(body, { data, order }) {
  clear(body);
  const meta = data.meta || {};
  const counts = meta.counts || {};
  const builtAt = String(meta.generated_at || meta.generated || '').slice(0, 10);
  body.append(
    h('div', { class: 'bintro' },
      h('p', { class: 'bintro__lede', text: meta.subtitle || '' }),
      h('p', { class: 'bintro__meta', text: `${order.length} 套 · ${counts.items || '—'} 条道具摘要 · 生成 ${builtAt || '—'} · 评分为数据口径评估，不是游戏内数值` })),
    goalPanel(order),
    h('div', { class: 'bgrid' }, ...order.map((b) => buildCard(b))),
    comparePanel(order),
    rulesPanel(data),
    notesPanel(data),
  );
}

function goalPanel(order) {
  return panel('target', '按目标选', h('div', { class: 'bgoals' }, ...GOALS.map((g) => goalCard(g, order))),
    { sub: '按对应评分排序取前三，点流派名进入详情' });
}

function goalCard(g, order) {
  const ranked = order.slice()
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

function comparePanel(order) {
  const head = h('thead', {}, h('tr', {},
    h('th', { class: 'btbl__num', text: '#' }),
    h('th', { text: '流派' }),
    h('th', { text: '定位' }),
    h('th', { text: '职业（主 / 副）' }),
    ...RATINGS.map((d) => h('th', { class: 'btbl__num', attrs: { title: d.tip }, text: d.zh })),
    h('th', { class: 'btbl__num', text: '综合' }),
    h('th', { class: 'btbl__num', text: '饰品乘区' }),
    h('th', { class: 'btbl__num', text: '饰品贡献' })));
  const rows = order.map((b) => {
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
  return panel('scale', '横向对比',
    [
      h('div', { class: 'tbl-scroll' },
        h('table', { class: 'tbl btbl' }, head, h('tbody', {}, ...rows))),
      h('p', { class: 'bcap', text: '饰品乘区 = 只保留 5 件饰品时的近似伤害倍率；饰品贡献 = 去掉饰品后失去的输出占比。两者都是模型估算，用来说明相对权重。' }),
    ],
    { sub: '评分 1~5；难度 / 门槛越高越吃操作与特定装备' });
}

function rulesPanel(data) {
  const rules = data.rules || [];
  if (!rules.length) return null;
  return panel('listchecks', '配装规则', h('ol', { class: 'brules' }, ...rules.map((r) => h('li', { class: 'brule' },
    h('b', { class: 'brule__t', text: r.title || '' }),
    h('p', { class: 'brule__x', text: r.text || '' })))), { sub: `${rules.length} 条` });
}

function trinketScarcityFold(data) {
  const sc = data.trinket_scarcity;
  if (!sc) return null;
  const principles = data.trinket_principles || [];
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

function notesPanel(data) {
  const evalNotes = data.eval_notes || [];
  const dataNotes = data.data_notes || [];
  const meta = data.meta || {};
  const body = h('div', { class: 'bnotes' });
  if (evalNotes.length) {
    body.append(h('div', { class: 'bsub' },
      h('div', { class: 'bsub__t', text: '评分口径' }),
      h('ul', { class: 'blist' }, ...evalNotes.map((t) => h('li', { class: 'blist__li', text: t })))));
  }
  const scFold = trinketScarcityFold(data);
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
