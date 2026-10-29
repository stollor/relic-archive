/* =============================================================================
   遗迹2 · 遗物档案 — lab/wb-cat-relic.js（装配台 v3 · 圣物与碎片）
   圣物行（relic 槽）+ 3 个碎片槽卡片 + 全量碎片表（45 条，颜色筛选）。
   碎片槽写入只经 S.setFragmentSlot / clearFragmentSlot；碎片的颜色 / 属性 / 效果
   全部取 model.gear.all('fragment')，不新增数据口径。右侧推荐由 renderRec(host) 渲染。
   ========================================================================== */
import { h, clear, fmt, frag } from '../core/dom.js';
import { icon } from '../core/icons.js';
import { itemMedia } from './parts.js';
import { SLOT_LABEL } from './model.js';
import { createScorer } from './score.js';
import { createFit } from './fit.js';
import {
  CAT_BY_ID, catShell, catBar, crow, emptyCrow, slotCell, itemCell, effectCell, actsCell,
  catSection, noteLine, recCard, recList, tag, fragColorBadge, iconAct, emptyTab,
} from './wb-parts.js';

const COLOR_ZH = { red: '红', yellow: '黄', blue: '蓝' };
const FILTERS = ['all', 'red', 'yellow', 'blue'];
const SCORE_TOP = 6;

export function createRelicTab(ctx) {
  const { model } = ctx;
  const { store, ui, S } = ctx;
  const gear = model.gear;
  const cat = CAT_BY_ID.get('relic') || { zh: '圣物与碎片', sub: '', icon: 'relic' };
  const shell = catShell({ title: cat.zh, sub: cat.sub, iconName: cat.icon });
  const fragments = gear.all('fragment');

  /* 局部筛选：refresh() 重建 DOM 时保留 */
  let listFilter = 'all';

  let fit = null;
  function ensureFit() {
    if (fit) return fit;
    try { fit = createFit(model, createScorer(gear)); } catch { fit = null; }
    return fit;
  }

  /* ----------------------------- 小工具 ----------------------------- */
  const playstyleId = () => { try { return S.playstyleId() || 'general'; } catch { return 'general'; } };
  const psZh = () => (gear.playstyleById.get(playstyleId()) || {}).zh || '通用';
  const colorZh = (color) => COLOR_ZH[color] || '待验证';
  function gearRec(id, kind) {
    if (!id) return null;
    const g = gear.of(id);
    return g && g.kind === kind ? g : null;
  }
  function dimsOf(rec, n = 3) {
    if (!rec || !rec.dims) return [];
    return Object.entries(rec.dims)
      .filter(([, v]) => typeof v === 'number' && v > 0)
      .sort((a, b) => b[1] - a[1]).slice(0, n)
      .map(([id]) => gear.dimensionZh(id));
  }
  const fragEffectZh = (f) => (f && f.effectZh) || '';
  const fragName = (f, id) => (f && (f.zh || f.en)) || model.nameOf(id) || id;
  /** 只有英文原文的碎片：原文进次要行（10.5px / muted + title），不当中文效果用 */
  function enOriginal(f) {
    const en = (f && f.effectEn) || '';
    if (!en) return '';
    return h('div', { class: 'lab-crow__en muted', text: `原文：${en}`, attrs: { title: en } });
  }
  /** 碎片效果节点：中文效果优先；缺失时主行「效果待验证」+ 次要行英文原文 */
  function effectFragment(f) {
    const zh = fragEffectZh(f);
    return frag(h('span', { class: zh ? '' : 'muted', text: zh || '效果待验证' }), zh ? '' : enOriginal(f));
  }
  function dimCell(rec, stat) {
    const dims = dimsOf(rec, 3);
    return h('div', { class: 'lab-crow__stats', attrs: { role: 'cell', title: stat ? `属性：${stat}（原文）` : '' } },
      dims.length ? dims.map((d) => tag(d)) : tag('维度待验证'));
  }
  function colorChips(selected, onPick, { withCount = true } = {}) {
    return h('div', { class: 'row row--wrap' }, FILTERS.map((key) => {
      const label = key === 'all' ? '全部' : `${colorZh(key)}色`;
      const count = key === 'all' ? fragments.length : fragments.filter((f) => f.color === key).length;
      return h('button', {
        class: `chip chip--sm${selected === key ? ' is-on' : ''}`, type: 'button',
        attrs: { title: key === 'all' ? `显示全部 ${count} 件碎片` : `只显示${label}碎片（${count} 件）` },
        on: { click: () => onPick(key) },
      },
        h('span', { text: label }),
        withCount ? h('span', { class: 'chip__count', text: String(count) }) : '',
      );
    }));
  }

  /* ----------------------------- 圣物行 ----------------------------- */
  function relicRow() {
    const id = store.build.get('relic') || null;
    const label = SLOT_LABEL.relic || '圣物';
    if (!id) {
      return emptyCrow({ label, iconName: 'relic', hint: `点击选择${label}`, onPick: () => ctx.pickForSlot('relic') });
    }
    const rec = gearRec(id, 'relic');
    const item = model.itemsById.get(id) || null;
    const missing = ctx.isMissing(id);
    const effRec = rec || { effectZh: (item && item.effectZh) || '', effectEn: (item && item.effectEn) || '' };
    return crow([
      slotCell(label, 'relic', { badge: missing ? tag('缺件') : null }),
      itemCell({
        iconUrl: model.iconOf(id), zh: model.nameOf(id), en: (item && item.en) || '',
        tags: rec && rec.dlc && rec.dlc !== 'base' ? [tag('DLC')] : [],
        onClick: () => ctx.openDetail(id),
      }),
      dimCell(rec, ''),
      effectCell(effectFragment(effRec)),
      actsCell([
        iconAct('eye', `查看${label}详情`, () => ctx.openDetail(id)),
        iconAct('x-circle', missing ? '取消缺件标记' : `标记${label}为缺件`, () => ctx.toggleMissing(id), { on: missing }),
        iconAct('swap', `更换${label}`, () => ctx.pickForSlot('relic')),
        iconAct('x', `移除${label}`, () => ctx.removeSlot('relic'), { danger: true }),
      ]),
    ], { cls: missing ? 'is-missing' : '' });
  }

  /* ----------------------------- 碎片槽卡片 ----------------------------- */
  function slotCard(id, index) {
    const k = `碎片槽 ${index + 1}`;
    if (!id) {
      return h('button', {
        class: 'lab-relicslot is-empty', type: 'button',
        attrs: { title: `为${k}选择碎片`, 'aria-label': `为${k}选择碎片` },
        on: { click: () => openFragDrawer(index) },
      },
        h('span', { class: 'lab-relicslot__head' },
          h('span', { class: 'lab-tag', text: k }),
          h('span', { class: 'row muted' }, icon('plus', { size: 13 }), h('span', { text: '点击放入' }))),
      );
    }
    const f = gearRec(id, 'fragment');
    const zhEffect = fragEffectZh(f);
    const card = h('div', {
      class: 'lab-relicslot is-on',
      attrs: { role: 'button', tabindex: '0', title: `${k}：点击更换碎片`, 'aria-label': `${k}：点击更换碎片` },
    },
      h('div', { class: 'lab-relicslot__head' },
        fragColorBadge(f ? f.color : ''),
        h('span', { class: 'lab-tag', text: k }),
        h('span', { class: 'grow' }),
        iconAct('swap', `更换${k}`, () => openFragDrawer(index)),
        iconAct('x', `移除${k}的碎片`, () => { S.clearFragmentSlot(index); ui.toast(`已清空${k}`, 'ok'); }, { danger: true }),
      ),
      h('div', { class: 'row' },
        itemMedia(model.iconOf(id), { size: 30, alt: fragName(f, id) }),
        h('div', { class: 'grow' },
          h('div', { class: 'lab-relicslot__name' }, h('span', { text: fragName(f, id) }), f && f.en ? h('span', { class: 'lab-crow__en', text: f.en }) : ''),
          h('div', { class: 'lab-relicslot__eff' }, effectFragment(f)),
        ),
      ),
    );
    card.addEventListener('click', (e) => { if (!e.target.closest('button')) openFragDrawer(index); });
    card.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openFragDrawer(index); } });
    return card;
  }
  function fragSlotsSection() {
    const slots = S.fragmentSlots();
    const host = h('div', { class: 'lab-relicslots' });
    slots.forEach((id, i) => host.append(slotCard(id, i)));
    return catSection(`碎片槽 · ${S.FRAGMENT_SLOTS}`, [host], {
      sub: `红 / 黄 / 蓝 · 已放 ${slots.filter(Boolean).length}/${S.FRAGMENT_SLOTS}`,
    });
  }

  /* ----------------------------- 碎片抽屉 ----------------------------- */
  function drawerRow(f, index) {
    const here = S.fragmentSlots()[index] === f.id;
    const zhEffect = fragEffectZh(f);
    return h('button', {
      class: `lab-attachrow${here ? ' is-on' : ''}`, type: 'button',
      attrs: { title: `${fragName(f, f.id)}${f.en ? `（${f.en}）` : ''} · ${zhEffect || '效果待验证'}` },
      on: {
        click: () => {
          S.setFragmentSlot(index, f.id);
          ui.toast(`已放入碎片槽 ${index + 1}：${fragName(f, f.id)}`, 'ok');
          ui.closeDrawer();
        },
      },
    },
      h('span', { class: 'lab-attachrow__k' }, fragColorBadge(f.color)),
      h('div', {},
        h('div', { class: 'row' },
          h('b', { text: fragName(f, f.id) }),
          f.en ? h('span', { class: 'lab-crow__en', text: f.en }) : '',
          here ? tag('当前') : '',
          dimsOf(f, 2).map((d) => tag(d)),
        ),
        h('div', { class: zhEffect ? '' : 'muted', text: zhEffect || '效果待验证' }),
        zhEffect ? '' : enOriginal(f),
      ),
      h('span', { class: 'lab-attachrow__acts' }, tag(here ? '已在此槽' : '点击放入')),
    );
  }
  function openFragDrawer(index) {
    let filter = 'all';
    const chipsHost = h('div', { class: 'row row--wrap' });
    const listHost = h('div', { class: 'stack-2' });
    const countEl = h('span', { class: 'muted' });
    function renderList() {
      clear(listHost);
      const list = fragments.filter((f) => filter === 'all' || f.color === filter);
      countEl.textContent = `共 ${list.length} 件`;
      if (!list.length) listHost.append(emptyTab('该颜色暂无碎片数据'));
      else list.forEach((f) => listHost.append(drawerRow(f, index)));
    }
    function renderChips() {
      clear(chipsHost);
      chipsHost.append(colorChips(filter, (key) => { filter = key; renderChips(); renderList(); }, { withCount: false }));
    }
    renderChips();
    renderList();
    ui.openDrawer({
      title: `选择碎片 · 碎片槽 ${index + 1}`,
      subtitle: `共 ${fragments.length} 件 · 按颜色筛选后点击即放入`,
      iconName: 'relic',
      body: h('div', { class: 'stack-2' }, chipsHost, countEl, listHost),
      foot: h('div', { class: 'row row--spread grow' },
        h('span', { class: 'muted', text: '颜色加成 / 棱晶机制出处为游戏本地化文本（locres，置信 mid），未证实处标「待验证」。' }),
        h('button', {
          class: 'btn btn--quiet btn--sm', type: 'button', attrs: { title: `清空碎片槽 ${index + 1}` },
          on: { click: () => { S.clearFragmentSlot(index); ui.toast(`已清空碎片槽 ${index + 1}`, 'ok'); ui.closeDrawer(); } },
        }, icon('rotate-ccw', { size: 12 }), h('span', { text: '清空该槽' }))),
    });
  }

  /* ----------------------------- 全部碎片表 ----------------------------- */
  function putButtons(f) {
    const slots = S.fragmentSlots();
    return h('div', { class: 'row' }, [0, 1, 2].map((i) => {
      const here = slots[i] === f.id;
      return h('button', {
        class: `btn btn--quiet btn--sm${here ? ' is-on' : ''}`, type: 'button', disabled: here,
        attrs: { title: here ? `已在碎片槽 ${i + 1}` : `把${fragName(f, f.id)}放入碎片槽 ${i + 1}`, 'aria-label': `放入碎片槽 ${i + 1}` },
        on: {
          click: () => {
            S.setFragmentSlot(i, f.id);
            ui.toast(`已放入碎片槽 ${i + 1}：${fragName(f, f.id)}`, 'ok');
          },
        },
      }, h('span', { text: `槽 ${i + 1}` }));
    }));
  }
  function fragRow(f) {
    const slots = S.fragmentSlots();
    const used = slots.indexOf(f.id);
    return crow([
      h('div', { class: 'lab-crow__slot', attrs: { role: 'cell', title: `${colorZh(f.color)}色碎片` } },
        fragColorBadge(f.color)),
      itemCell({
        iconUrl: model.iconOf(f.id), zh: fragName(f, f.id), en: f.en || '',
        tags: used >= 0 ? [tag(`已在槽 ${used + 1}`)] : [],
      }),
      dimCell(f, f.stat),
      effectCell(effectFragment(f)),
      actsCell([putButtons(f)]),
    ]);
  }
  function fragTableSection() {
    const list = fragments.filter((f) => listFilter === 'all' || f.color === listFilter);
    return catSection('全部碎片', [
      colorChips(listFilter, (key) => { listFilter = key; render(); }),
      h('div', { class: 'lab-bar-title' }, h('span', { text: `共 ${fragments.length} 件 · 当前筛出 ${list.length} 件` })),
      list.length ? h('div', { class: 'lab-cat__scroll' }, list.map(fragRow)) : emptyTab('该颜色暂无碎片数据'),
    ], { sub: '色标 / 名称 / 属性 / 效果 / 快捷放入槽' });
  }

  /* ----------------------------- 右侧推荐面板 ----------------------------- */
  function fillByRecommend(rec) {
    const picks = rec.slice(0, S.FRAGMENT_SLOTS);
    picks.forEach((p, i) => S.setFragmentSlot(i, p.id));
    for (let i = picks.length; i < S.FRAGMENT_SLOTS; i += 1) S.clearFragmentSlot(i);
    ui.toast(`已按推荐填满 ${picks.length} 个碎片槽`, 'ok');
  }
  function putNextEmpty(row) {
    const slots = S.fragmentSlots();
    let index = slots.findIndex((v) => !v);
    if (index < 0) index = 0;
    S.setFragmentSlot(index, row.id);
    ui.toast(`已放入碎片槽 ${index + 1}：${row.zh || model.nameOf(row.id)}`, 'ok');
  }
  function recCardOf(row) {
    const f = gearRec(row.id, 'fragment') || {};
    const color = row.color || f.color || '';
    const zhEffect = row.effectZh || fragEffectZh(f);
    return recCard({
      title: row.zh || fragName(f, row.id),
      sub: f.en || '',
      score: fmt.pct(row.score, 1),
      meta: [fragColorBadge(color)],
      tags: (Array.isArray(row.why) ? row.why : []).slice(0, 2),
      lines: [zhEffect || '效果待验证', zhEffect ? '' : enOriginal(f)].filter(Boolean),
      actions: [h('button', {
        class: 'btn btn--ghost btn--sm', type: 'button',
        attrs: { title: `把${row.zh || fragName(f, row.id)}填入下一个空碎片槽` },
        on: { click: (e) => { e.stopPropagation(); putNextEmpty(row); } },
      }, icon('plus', { size: 12 }), h('span', { text: '填入空槽' }))],
    });
  }
  function renderRec(host) {
    if (!host) return;
    clear(host);
    host.append(h('div', { class: 'lab-bar-title' },
      icon('relic', { size: 13 }), h('span', { text: `当前流派「${psZh()}」· 碎片推荐` })));
    if (!fragments.length) { host.append(emptyTab('碎片数据未载入（data/lab_gear.json），暂时无法推荐')); return; }
    if (!ensureFit()) { host.append(emptyTab('适配模块未就绪，暂时无法推荐')); return; }
    let rec = [];
    try { rec = fit.recommendFragments({ playstyleId: playstyleId(), limit: SCORE_TOP }) || []; } catch { rec = []; }
    if (!rec.length) { host.append(emptyTab('没有可推荐的碎片')); return; }
    host.append(h('div', { class: 'row row--spread' },
      h('span', { class: 'muted', text: `按维度权重排序 · 前 ${rec.length} 件` }),
      h('button', {
        class: 'btn btn--primary btn--sm', type: 'button',
        attrs: { title: `按推荐顺序填满 ${S.FRAGMENT_SLOTS} 个碎片槽` },
        on: { click: () => fillByRecommend(rec) },
      }, icon('sparkle', { size: 12 }), h('span', { text: `按推荐填满 ${S.FRAGMENT_SLOTS} 槽` }))));
    host.append(recList(rec.map(recCardOf)));
    if (rec.note) host.append(noteLine(rec.note));
    host.append(noteLine('口径：按当前流派维度权重对碎片 dims 加权排序（近似），不含技能 / 套装联动；红色 / 黄色 / 蓝色加成机制出处为游戏本地化文本（locres，置信 mid），未证实处标「待验证」。'));
  }

  /* ----------------------------- 组装 ----------------------------- */
  function render() {
    clear(shell.body);
    shell.body.append(catBar([{ zh: '槽位' }, { zh: '圣物 / 碎片' }, { zh: '属性' }, { zh: '效果' }, { zh: '操作' }]));
    shell.body.append(relicRow());
    shell.body.append(fragSlotsSection());
    shell.body.append(fragTableSection());
    clear(shell.foot);
    shell.foot.append(noteLine('圣物碎片共 3 槽、45 件（红 / 黄 / 蓝），颜色与效果取自已收录数据；颜色加成与棱晶机制的出处是游戏本地化文本（locres，置信 mid），红色 / 黄色 / 蓝色加成机制待验证。推荐按当前流派维度权重近似排序，写入后随配装存档。'));
  }

  render();
  return { el: shell.el, refresh: render, renderRec };
}

export default createRelicTab;
