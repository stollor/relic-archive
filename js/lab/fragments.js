/* =============================================================================
   遗迹2 · 遗物档案 — lab/fragments.js（v2）
   圣物碎片：圣物 3 个碎片槽 + 全量碎片列表（红 / 黄 / 蓝）。
   槽位写入写 meta.fragmentSlots（state.js 唯一入口）；顶栏可「按流派推荐 3 件」一键填入。
   颜色加成 / 棱晶机制的出处是游戏本地化文本（locres，置信 mid），未证实处标「待验证」。
   ============================================================================= */
import { h, clear, fmt } from '../core/dom.js';
import { icon } from '../core/icons.js';
import { store } from '../core/store.js';
import { ui } from '../core/ui.js';
import { createScope } from '../core/task.js';
import * as S from './state.js';
import { panel, emptyState, emptyLine, itemMedia } from './parts.js';
import { createScorer } from './score.js';
import { createFit } from './fit.js';

const COLOR_ZH = { red: '红', yellow: '黄', blue: '蓝' };
const COLOR_ORDER = ['red', 'yellow', 'blue'];

export function createFragments(model, deps = {}) {
  const gear = model.gear;
  const gearReady = () => gear.fragment.length > 0;

  const root = h('div', { class: 'lab-fg' });
  const slotHost = h('div', { class: 'lab-fg__slots' });
  const legendHost = h('div', { class: 'lab-fg__legend' });
  const listHost = h('div', { class: 'lab-fg__list' });
  const countHost = h('div', { class: 'lab-fg__count muted' });
  const tools = h('div', { class: 'lab-fg__tools' });

  const state = { playstyle: S.playstyleId() };

  const scope = createScope();
  let destroyed = false;

  /* ---------------------- 适配模块（懒装配） ---------------------- */
  let scorer = null;
  let fit = null;
  let fitError = '';
  function ensureEngines() {
    if (fit || fitError) return;
    try {
      scorer = createScorer(gear);
      fit = createFit(model, scorer);
    } catch (err) {
      fitError = String((err && err.message) || err || '未知错误');
      console.error('[lab:fragments] 适配模块初始化失败', err);
    }
  }

  /* ---------------------- 工具 ---------------------- */
  function fragOf(id) { return gear.of(id) || null; }
  function colorOf(id) {
    const g = fragOf(id);
    return g && COLOR_ZH[g.color] ? g.color : null;
  }
  function colorBadge(color) {
    const zh = COLOR_ZH[color];
    if (!zh) {
      return h('span', { class: 'lab-fg__badge', attrs: { title: '颜色待验证' }, text: '？' });
    }
    return h('span', {
      class: `lab-fg__badge lab-fg__badge--${color}`,
      attrs: { title: `碎片颜色：${zh}（出处 locres，未证实处待验证）` },
      text: zh,
    });
  }
  function dimsOf(rec, n = 3) {
    if (scorer && typeof scorer.topDims === 'function') {
      try {
        const top = scorer.topDims(rec.dims || {}, n);
        if (Array.isArray(top) && top.length) return top.map((d) => d.zh || gear.dimensionZh(d.id));
      } catch { /* 回落到本地标签映射 */ }
    }
    return Object.entries(rec.dims || {})
      .filter(([, v]) => typeof v === 'number' && v > 0)
      .sort((a, b) => b[1] - a[1])
      .slice(0, n)
      .map(([id]) => gear.dimensionZh(id));
  }
  function slotIndexOf(id) {
    const slots = S.fragmentSlots();
    const i = slots.indexOf(id);
    return i >= 0 ? i : -1;
  }

  /* ---------------------- 槽位卡片 ---------------------- */
  function renderSlots() {
    clear(slotHost);
    const slots = S.fragmentSlots();
    slots.forEach((id, i) => {
      const g = id ? fragOf(id) : null;
      const color = id ? colorOf(id) : null;
      const dims = g ? dimsOf(g, 2) : [];
      const card = h('div', { class: `lab-fg__slot${id ? ' is-filled' : ''}` });
      card.append(h('div', { class: 'lab-fg__slothead' },
        h('span', { class: 'lab-fg__slotidx', text: `碎片槽 ${i + 1}` }),
        id ? colorBadge(color) : h('span', { class: 'badge badge--neutral', text: '空槽' }),
        h('div', { class: 'grow' }),
        id
          ? h('button', {
            class: 'iconbtn iconbtn--sm', type: 'button',
            attrs: { title: `清空碎片槽 ${i + 1}`, 'aria-label': `清空碎片槽 ${i + 1}` },
            on: { click: () => { S.clearFragmentSlot(i); ui.toast(`已清空碎片槽 ${i + 1}`, 'ok'); } },
          }, icon('x', { size: 13 }))
          : '',
      ));
      if (id) {
        card.append(
          h('div', { class: 'lab-fg__slotbody' },
            itemMedia(model.iconOf(id), { size: 32 }),
            h('div', { class: 'lab-fg__slottext' },
              h('div', { class: 'lab-fg__slotname', text: (g && g.zh) || id }),
              h('div', {
                class: `lab-fg__sloteff${(g && (g.effectZh || '')).trim() ? '' : ' is-en'}`,
                attrs: (g && (g.effectZh || g.effectEn)) ? { title: g.effectZh || g.effectEn } : undefined,
                text: (g && (g.effectZh || g.effectEn)) || '效果原文待验证',
              }),
              dims.length ? h('div', { class: 'lab-fg__dims' }, dims.map((d) => h('span', { class: 'lab-fg__dim', text: d }))) : '',
            ),
          ),
        );
      } else {
        card.append(h('div', { class: 'lab-fg__slotempty' },
          icon('plus', { size: 16 }),
          h('span', { text: '从下方列表点「槽 ' + (i + 1) + '」放入' }),
        ));
      }
      slotHost.append(card);
    });
  }

  /* ---------------------- 颜色构成 / 图例 ---------------------- */
  function renderLegend() {
    clear(legendHost);
    const counts = { red: 0, yellow: 0, blue: 0, unknown: 0 };
    for (const f of gear.fragment) {
      const c = COLOR_ZH[f.color] ? f.color : 'unknown';
      counts[c] += 1;
    }
    const slots = S.fragmentSlots();
    const usedColors = { red: 0, yellow: 0, blue: 0 };
    for (const id of slots) {
      if (!id) continue;
      const c = colorOf(id);
      if (c) usedColors[c] += 1;
    }
    const legend = h('div', { class: 'lab-fg__legendrow' });
    for (const c of COLOR_ORDER) {
      legend.append(h('span', { class: 'lab-fg__legenditem' },
        colorBadge(c), h('span', { text: `全库 ${fmt.num(counts[c])} 件 · 已装 ${usedColors[c]} 件` })));
    }
    if (counts.unknown) {
      legend.append(h('span', { class: 'lab-fg__legenditem' },
        h('span', { class: 'lab-fg__badge', text: '？' }),
        h('span', { text: `颜色待验证 ${fmt.num(counts.unknown)} 件` })));
    }
    legendHost.append(legend);
    const filled = slots.filter(Boolean).length;
    legendHost.append(h('div', { class: 'lab-fg__legendnote muted' },
      icon('info', { size: 12 }),
      h('span', { text: `已放入 ${filled} / ${S.FRAGMENT_SLOTS} 件。同色 2 件 / 3 件是否有额外「棱晶」加成：出处为游戏本地化文本（locres，置信 mid），未证实处标「待验证」。` })));
  }

  /* ---------------------- 列表 ---------------------- */
  function putButtons(id) {
    const slots = S.fragmentSlots();
    const wrap = h('div', { class: 'lab-fg__acts' });
    for (let i = 0; i < S.FRAGMENT_SLOTS; i += 1) {
      const here = slots[i] === id;
      wrap.append(h('button', {
        class: `lab-fg__put${here ? ' is-on' : ''}`, type: 'button',
        disabled: here,
        attrs: { title: here ? `已在碎片槽 ${i + 1}` : `放入碎片槽 ${i + 1}`, 'aria-label': here ? `已在碎片槽 ${i + 1}` : `放入碎片槽 ${i + 1}` },
        on: {
          click: () => {
            S.setFragmentSlot(i, id);
            const g = fragOf(id);
            ui.toast(`已放入碎片槽 ${i + 1}：${(g && g.zh) || id}`, 'ok');
          },
        },
      }, icon(here ? 'check' : 'plus', { size: 12 }), h('span', { text: `槽 ${i + 1}` })));
    }
    return wrap;
  }

  /** fit 结果 → 展示用记录（颜色 / 效果原文 / 维度都回到 gear 条目里取，避免字段口径分叉） */
  function normalize(f) {
    const g = fragOf(f.id) || {};
    return {
      id: f.id,
      zh: f.zh || g.zh || model.nameOf(f.id) || f.id,
      en: g.en || '',
      color: f.color || g.color || null,
      effectZh: f.effectZh || g.effectZh || '',
      effectEn: g.effectEn || '',
      dims: g.dims || {},
      score: f.score,
      why: Array.isArray(f.why) ? f.why : [],
    };
  }

  function row(f, slots) {
    const color = COLOR_ZH[f.color] ? f.color : null;
    const dims = dimsOf(f, 3);
    const usedSlot = slots.indexOf(f.id);
    return h('div', { class: `lab-fg__row${usedSlot >= 0 ? ' is-used' : ''}` },
      colorBadge(color),
      h('div', { class: 'lab-fg__main' },
        h('div', { class: 'lab-fg__namerow' },
          h('span', { class: 'lab-fg__name', text: f.zh }),
          f.en ? h('span', { class: 'lab-fg__en', text: f.en }) : '',
          usedSlot >= 0 ? h('span', { class: 'badge badge--gold', text: `已在槽 ${usedSlot + 1}` }) : '',
        ),
        h('div', {
          class: `lab-fg__eff${f.effectZh.trim() ? '' : ' is-en'}`,
          attrs: (f.effectZh || f.effectEn) ? { title: f.effectZh || f.effectEn } : undefined,
          text: f.effectZh || f.effectEn || '效果原文待验证',
        }),
        h('div', { class: 'lab-fg__metarow' },
          dims.length ? h('div', { class: 'lab-fg__dims' }, dims.map((d) => h('span', { class: 'lab-fg__dim', text: d }))) : '',
          f.score != null ? h('span', { class: 'lab-fg__score', text: `适配分 ${fmt.pct(f.score, 1)}` }) : '',
        ),
      ),
      putButtons(f.id),
    );
  }

  function renderList() {
    clear(listHost);
    if (!gearReady()) {
      listHost.append(emptyState('info', '碎片数据尚未生成',
        '需要 data/lab_gear.json（圣物碎片 + 颜色 + 效果原文）。数据生成链产出后本面板会自动列出碎片。'));
      clear(countHost);
      return;
    }
    ensureEngines();
    let list = [];
    if (fit) {
      try {
        const rec = fit.recommendFragments({ playstyleId: state.playstyle, limit: gear.fragment.length });
        if (Array.isArray(rec) && rec.length) list = rec.map(normalize);
      } catch (err) {
        console.error('[lab:fragments] 碎片排序失败，回落到目录顺序', err);
      }
    }
    if (!list.length) list = gear.fragment.map(normalize);
    clear(countHost);
    countHost.textContent = `共 ${gear.fragment.length} 件碎片 · 按当前流派维度权重排序`;
    const slots = S.fragmentSlots();
    for (const f of list) listHost.append(row(f, slots));
  }

  /* ---------------------- 推荐 3 件 ---------------------- */
  function recommendThree() {
    if (!gearReady()) return;
    ensureEngines();
    if (!fit) { ui.toast(`适配模块未就绪：${fitError || '未知原因'}`, 'err'); return; }
    let picks = [];
    let note = '';
    try {
      const rec = fit.recommendFragments({ playstyleId: state.playstyle, limit: S.FRAGMENT_SLOTS });
      picks = Array.isArray(rec) ? rec.slice(0, S.FRAGMENT_SLOTS) : [];
      note = (rec && typeof rec.note === 'string') ? rec.note : '';
    } catch (err) {
      ui.toast(`推荐失败：${String((err && err.message) || err || '未知错误')}`, 'err');
      return;
    }
    if (!picks.length) { ui.toast('没有可推荐的碎片', 'warn'); return; }
    picks.forEach((p, i) => S.setFragmentSlot(i, p.id));
    for (let i = picks.length; i < S.FRAGMENT_SLOTS; i += 1) S.clearFragmentSlot(i);
    const colors = picks.map((p) => COLOR_ZH[p.color] || '？').join(' / ');
    ui.toast(`已按流派推荐 ${picks.length} 件碎片（颜色：${colors}）${note ? `。${note}` : ''}`, 'ok');
  }

  /* ---------------------- 顶栏 ---------------------- */
  function renderTools() {
    clear(tools);
    const ps = gear.playstyleById.get(state.playstyle);
    tools.append(
      h('button', {
        class: 'btn btn--primary btn--sm', type: 'button',
        disabled: !gearReady(),
        attrs: { title: `按「${(ps && ps.zh) || state.playstyle}」维度权重推荐 ${S.FRAGMENT_SLOTS} 件碎片并填入` },
        on: { click: () => recommendThree() },
      }, icon('sparkle', { size: 13 }), h('span', { text: `按流派推荐 ${S.FRAGMENT_SLOTS} 件` })),
      h('button', {
        class: 'btn btn--quiet btn--sm', type: 'button', attrs: { title: '清空全部碎片槽' },
        on: {
          click: () => {
            for (let i = 0; i < S.FRAGMENT_SLOTS; i += 1) S.clearFragmentSlot(i);
            ui.toast('已清空全部碎片槽', 'ok');
          },
        },
      }, icon('rotate-ccw', { size: 13 }), h('span', { text: '清空槽位' })),
    );
  }

  /* ---------------------- 组装 ---------------------- */
  const shell = panel('圣物碎片', {
    iconName: 'relic',
    sub: `圣物 ${S.FRAGMENT_SLOTS} 碎片槽 · 红 / 黄 / 蓝`,
    flush: true,
  });
  shell.tools.append(tools);
  shell.body.append(
    h('div', { class: 'lab-fg__note' }, icon('info', { size: 13 }),
      h('span', { text: `圣物有 ${S.FRAGMENT_SLOTS} 个碎片槽；碎片分红 / 黄 / 蓝三色，颜色加成与棱晶机制的出处是游戏本地化文本（locres，置信 mid），未证实部分标「待验证」。槽位写入随配装一起存档，并计入结果面板的防御数值。` })),
    slotHost,
    legendHost,
    countHost,
    listHost,
  );
  root.append(shell.el);

  scope.add(S.on((reason) => {
    if (reason === 'fragment') {
      renderSlots();
      renderLegend();
      renderList();
      return;
    }
    if (reason === 'playstyle') {
      const id = S.playstyleId();
      if (id !== state.playstyle) {
        state.playstyle = id;
        renderTools();
        renderList();
      }
    }
  }));
  scope.add(store.on('build', () => {
    if (destroyed) return;
    renderSlots();
    renderLegend();
  }));

  function renderAll() {
    renderTools();
    renderSlots();
    renderLegend();
    renderList();
  }

  renderAll();

  return {
    el: root,
    refresh: renderAll,
    applyParams() { if (!destroyed) renderAll(); },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      scope.dispose();
    },
  };
}

export default createFragments;
