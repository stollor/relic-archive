/* =============================================================================
   遗迹2 · 遗物档案 — lab/wb-cat-trinkets.js（装配台：饰品）
   5 行：项链 / 戒指 1–4，每行给维度标签与「契合」小分（0–1 近似比较值，不是游戏数值）。
   右侧推荐三块：补齐空槽（每槽 Top3）/ 同槽更优（增益 Top3）/ 整组组合 Top3。
   计算：组合搜索用 createTaskRunner 分三帧跑（补齐 → 替换 → 组合枚举），先出部分结果；
   结果按 (流派, 已装备 id 串, 缺件集合) 缓存，条件不变不重算。
   ========================================================================== */
import { h, clear, fmt } from '../core/dom.js';
import { icon } from '../core/icons.js';
import { openItemDetail } from '../components/item-detail.js';
import { createTaskRunner } from '../core/task.js';
import { SLOT_LABEL } from './model.js';
import { effectText } from './text.js';
import { createScorer } from './score.js';
import { createComboSearch } from './combos.js';
import {
  CAT_BY_ID, catShell, catBar, crow, slotCell, itemCell, effectCell, actsCell, emptyCrow,
  catSection, noteLine, recCard, recList, tag, iconAct, emptyTab,
} from './wb-parts.js';

const SLOTS = ['amulet', 'ring1', 'ring2', 'ring3', 'ring4'];
const RING_SLOTS = SLOTS.slice(1);
const REC_TOP = 3;
const CACHE_MAX = 8;
const BTN = 'btn btn--ghost btn--sm';
const CAT = CAT_BY_ID.get('trinkets') || { zh: '饰品', sub: '', icon: 'gem' };
const openDetail = (id) => openItemDetail(id, { from: 'lab' });

export function createTrinketsTab(ctx) {
  const { model, S, store, ui } = ctx;
  const gear = model.gear;
  const labelOf = (slot) => SLOT_LABEL[slot] || slot;
  const slotIcon = (slot) => (slot === 'amulet' ? 'amulet' : 'ring');
  const zhOf = (id) => { const g = gear.of(id); return (g && g.zh) || model.nameOf(id) || id; };
  const psZh = (id) => { const p = gear.playstyleById.get(id); return (p && p.zh) || id; };
  const gearReady = () => gear.amulet.length > 0 && gear.ring.length > 0;
  const btn = (text, title, onClick, cls = BTN) => h('button', {
    class: cls, type: 'button', text, attrs: { title, 'aria-label': title }, on: { click: onClick },
  });
  const whyOf = (row) => (Array.isArray(row.why) ? row.why.slice(0, 3) : []);
  const card = (title, score, sub, rest = {}) => recCard({ title, score, sub, ...rest });

  let destroyed = false;
  let scorer = null;
  let combo = null;
  let comboError = '';
  function ensureEngines() {
    if (combo || comboError) return;
    try { scorer = createScorer(gear); combo = createComboSearch(gear, scorer); }
    catch (err) { comboError = String((err && err.message) || err || '未知错误'); }
  }

  /* ------------------------- 槽位（可留空；组合模块按紧凑序号推断） ------------------------- */
  function emptyPlan() {
    const slots = store.build.slots();
    const fixed = { amulet: slots.amulet || null, rings: RING_SLOTS.map((s) => slots[s]).filter(Boolean) };
    // 组合模块按「紧凑序号」推断空槽（ring 槽可留空：推断名 ringN 与实际槽位分开映射）
    const inferred = (fixed.amulet ? [] : ['amulet']).concat(RING_SLOTS.slice(fixed.rings.length));
    const actual = (slots.amulet ? [] : ['amulet']).concat(RING_SLOTS.filter((s) => !slots[s]));
    return { fixed, inferred, actual };
  }
  function realSlotOf(compactSlot) {
    if (compactSlot === 'amulet') return 'amulet';
    const n = Number(String(compactSlot).replace('ring', ''));
    return RING_SLOTS.filter((slot) => store.build.get(slot))[n - 1] || `ring${n}`;
  }

  /* ------------------------- 行渲染 ------------------------- */
  function dimsOf(g, n = 3) {
    if (!g) return [];
    try {
      const top = scorer ? scorer.topDims(g.dims || {}, n) : [];
      if (top.length) return top.map((d) => ({ zh: d.zh || gear.dimensionZh(d.id), v: d.v }));
    } catch { /* 回落维度表 */ }
    return Object.entries(g.dims || {}).filter(([, v]) => Number(v) > 0)
      .sort((a, b) => b[1] - a[1]).slice(0, n).map(([id, v]) => ({ zh: gear.dimensionZh(id), v }));
  }

  function statsCell(kind, g) {
    const ps = S.playstyleId();
    const tags = dimsOf(g).map((d) => tag(d.zh, { title: `${d.zh} · 维度强度 ${fmt.num(d.v, 2)}（近似映射）` }));
    const score = g && scorer ? scorer.itemScore(kind, g, ps).score : 0;
    return h('div', { class: 'lab-crow__stats', attrs: { role: 'cell' } },
      tags.length ? tags : tag('维度待验证'),
      h('span', { class: 'lab-stat', title: `对「${psZh(ps)}」流派的契合度（0–1 近似比较值：没有命中该流派维度时显示 —）` },
        icon('target', { size: 11 }),
        h('span', { class: 'lab-stat__v', text: score > 0 ? fmt.num(score, 2) : '—' }),
        h('span', { class: 'lab-stat__k', text: '契合' })));
  }

  function trinketRow(slot) {
    const id = store.build.get(slot);
    const label = labelOf(slot);
    if (!id) return emptyCrow({ label, iconName: slotIcon(slot), hint: `点击选择${label}`, onPick: () => ctx.pickForSlot(slot) });
    ensureEngines();
    const g = gear.of(id);
    const it = model.itemOf(id) || null;
    const kind = slot === 'amulet' ? 'amulet' : 'ring';
    const miss = typeof ctx.isMissing === 'function' ? ctx.isMissing(id) : S.isMissing(id);
    const zh = (g && g.zh) || model.nameOf(id) || id;
    const effect = (g && (g.effectZh || effectText(g.effect) || effectText(g.numeric && g.numeric.effect)))
      || (it && (it.effectZh || it.summaryZh)) || '效果原文待验证';
    return crow([
      slotCell(label, slotIcon(slot), { badge: miss ? h('span', { class: 'badge badge--low', text: '缺件' }) : null }),
      itemCell({ iconUrl: ctx.iconOf(id), zh, en: (g && g.en) || (it && it.en) || '', sub: g && g.dlc ? `来源：${g.dlc}` : '', onClick: () => openDetail(id) }),
      statsCell(kind, g),
      effectCell(effect),
      actsCell([
        iconAct('eye', '查看详情', () => openDetail(id)),
        iconAct('x-circle', miss ? '取消缺件标记' : '标记为缺件（没有这件）', () => {
          const on = S.toggleMissing(id);
          ui.toast(on ? `已标记缺件：${zh}` : `已取消缺件：${zh}`, on ? 'warn' : 'ok');
        }, { on: miss }),
        iconAct('swap', `更换${label}`, () => ctx.pickForSlot(slot)),
        iconAct('x', '移除', () => ctx.removeSlot(slot), { danger: true }),
      ]),
    ], { cls: miss ? 'is-missing' : '' });
  }

  /* ------------------------- 标题栏：流派 / 按流派补空槽 ------------------------- */
  const shell = catShell({ title: CAT.zh, sub: CAT.sub || '1 项链 + 4 戒指', iconName: CAT.icon });
  /* 流派切换的唯一入口在装配台工具栏（上方）；这里只回显当前流派，避免两套下拉各写一遍状态 */
  const psTag = h('span', { class: 'lab-tag', attrs: { title: '流派决定维度权重与「契合」小分；在装配台工具栏切换' } });
  shell.acts.append(
    psTag,
    h('button', {
      class: BTN, type: 'button', attrs: { title: '按当前流派给每个空槽挑边际增益最高的一件' }, on: { click: () => fillEmptySlots() },
    }, icon('sparkle', { size: 13 }), h('span', { text: '按流派补空槽' })),
  );

  function syncPlaystyleSelect() {
    clear(psTag);
    psTag.append(h('span', { text: `契合流派 · ${psZh(S.playstyleId())}` }));
  }

  function fillEmptySlots() {
    if (!gearReady()) { ui.toast('饰品数据尚未载入，暂不能补齐', 'warn'); return; }
    ensureEngines();
    if (!combo) { ui.toast(`组合搜索未就绪：${comboError || '未知错误'}`, 'warn'); return; }
    const plan = emptyPlan();
    if (!plan.inferred.length) { ui.toast('5 个饰品槽都已放满', 'info'); return; }
    let res = null;
    try {
      res = combo.recommendRemaining({ playstyleId: S.playstyleId(), fixed: plan.fixed, emptySlots: plan.inferred, excludeIds: [...S.missingSet()] });
    } catch { ui.toast('补齐计算失败，请稍后重试', 'warn'); return; }
    if (res && res.error) { ui.toast(`补齐失败：${res.error}`, 'warn'); return; }
    const bySlot = new Map((Array.isArray(res && res.slots) ? res.slots : []).map((group) => [group.slot, group]));
    const used = new Set();
    let n = 0;
    plan.inferred.forEach((compactSlot, i) => {
      const actual = plan.actual[i];
      const items = bySlot.get(compactSlot) && Array.isArray(bySlot.get(compactSlot).items) ? bySlot.get(compactSlot).items : [];
      const item = items.find((row) => !used.has(row.id));
      if (!actual || !item) return;
      used.add(item.id);
      store.build.set(actual, item.id);
      n += 1;
    });
    ui.toast(n ? `已按「${psZh(S.playstyleId())}」补齐 ${n} 个空槽` : '当前条件下没有可补齐的空槽', n ? 'ok' : 'info');
  }
  /* ------------------------- 推荐：分帧计算 + 缓存 ------------------------- */
  const recCache = new Map();
  const newState = (key, busy) => ({ key, busy, error: '', remaining: null, swap: null, combos: null, stats: null });
  let recState = newState('', false);
  let recHost = null;
  const runner = createTaskRunner({ onError: () => { recState.busy = false; recState.error = '推荐计算中断'; paintRec(); } });
  const condKey = () => [S.playstyleId(), SLOTS.map((slot) => store.build.get(slot) || '').join(','), [...S.missingSet()].sort().join(',')].join('|');

  function computeRec(key) {
    const plan = emptyPlan();
    const ps = S.playstyleId();
    const excludeIds = [...S.missingSet()];
    const state = newState(key, true);
    const stages = [
      () => { state.remaining = combo.recommendRemaining({ playstyleId: ps, fixed: plan.fixed, emptySlots: plan.inferred, excludeIds }); },
      () => { const rows = combo.recommendSwap({ playstyleId: ps, current: plan.fixed, excludeIds }); state.swap = Array.isArray(rows) ? rows : []; if (rows && rows.error) state.error = String(rows.error); },
      () => { const res = combo.recommendTrinkets({ playstyleId: ps, fixedAmulet: plan.fixed.amulet, fixedRings: plan.fixed.rings, excludeIds, limit: REC_TOP }); state.combos = res && Array.isArray(res.combos) ? res.combos : []; state.stats = (res && res.stats) || null; if (res && res.error) state.error = String(res.error); },
    ];
    let step = 0;
    runner.run(() => {
      if (step >= stages.length) return false;
      try { stages[step](); } catch (err) { state.error = String((err && err.message) || err || '未知错误'); }
      step += 1;
      recState = state;
      paintRec();
      return step < stages.length;
    }, () => {
      state.busy = false;
      recState = state;
      if (recCache.size >= CACHE_MAX) recCache.delete(recCache.keys().next().value);
      recCache.set(key, state);
      paintRec();
    });
  }

  /* ------------------------- 推荐：三块 ------------------------- */
  function writeCombo(ids) {
    const prev = store.build.slots();
    store.build.set('amulet', ids[0] || null);
    RING_SLOTS.forEach((slot, i) => store.build.set(slot, ids[i + 1] || null));
    ui.toast('已整组写入饰品槽（1 项链 + 4 戒指）', 'ok', {
      action: { label: '撤销', fn: () => { store.build.set('amulet', prev.amulet || null); RING_SLOTS.forEach((slot) => store.build.set(slot, prev[slot] || null)); } },
    });
  }

  function remainSection(st, plan) {
    const slotMap = new Map(plan.inferred.map((slot, i) => [slot, plan.actual[i]]));
    const groups = st.remaining && Array.isArray(st.remaining.slots) ? st.remaining.slots.filter((g) => (g.items || []).length) : [];
    if (!groups.length) return catSection('补齐空槽', [emptyTab('5 个饰品槽都已放满，没有空槽可补。')], { sub: '每空槽 Top3' });
    return groups.map((group) => {
      const actual = slotMap.get(group.slot) || group.slot;
      const label = labelOf(actual);
      const cards = group.items.slice(0, REC_TOP).map((row) => card(zhOf(row.id), fmt.pp(row.score, 2), `${label} · 写入后的组合分边际增益`, {
        tags: whyOf(row),
        actions: [btn('装入', `把「${zhOf(row.id)}」写入${label}`, () => {
          if (SLOTS.some((s) => s !== actual && store.build.get(s) === row.id)) { ui.toast(`「${zhOf(row.id)}」已装备在其它槽位（戒指不可重复）`, 'warn'); return; }
          store.build.set(actual, row.id);
          ui.toast(`已写入${label}：${zhOf(row.id)}`, 'ok');
        })],
      }));
      return catSection(`补齐空槽 · ${label}`, [recList(cards)], { sub: `边际增益 Top${cards.length}` });
    });
  }

  function swapSection(st, plan) {
    const rows = Array.isArray(st.swap) ? st.swap.slice(0, REC_TOP) : [];
    if (!rows.length) {
      const hint = (plan.fixed.amulet || plan.fixed.rings.length)
        ? '当前流派下，已装备的饰品没有增益更高的同槽替代。'
        : '还没有已装备的项链 / 戒指：先放入，或用「按流派补空槽」。';
      return catSection('同槽更优', [emptyTab(hint)], { sub: '替换后组合分 Top3' });
    }
    const curIds = [plan.fixed.amulet, ...plan.fixed.rings].filter(Boolean);
    let base = null;
    try { base = scorer && curIds.length ? scorer.loadoutScore(curIds, S.playstyleId()).score : null; } catch { base = null; }
    const cards = rows.map((row) => {
      const slot = realSlotOf(row.slot);
      const from = zhOf(row.from);
      const to = zhOf(row.to);
      const after = base == null ? null : base + row.gain;
      return card(`${from} → ${to}`,
        after == null ? fmt.pp(row.gain, 2) : fmt.num(after, 3),
        after == null ? `${labelOf(slot)} · 替换后组合分` : `${labelOf(slot)} · 替换后组合分（当前 ${fmt.num(base, 3)}）`, {
          tags: whyOf(row),
          actions: [btn('替换', `把${labelOf(slot)}换成「${to}」`, () => { store.build.set(slot, row.to); ui.toast(`已替换${labelOf(slot)}：${from} → ${to}`, 'ok'); }, 'btn btn--primary btn--sm')],
        });
    });
    return catSection('同槽更优', [
      recList(cards),
      noteLine('同槽建议按整组重算：不同槽位可能给出同一件最佳替代（换掉一件后其它槽的条件也会变），这些组合分不能相加。'),
    ], { sub: '替换后组合分 Top3' });
  }

  function combosSection(st, plan) {
    if (!Array.isArray(st.combos) || !st.combos.length) {
      return catSection('整组组合 Top3', [emptyTab('当前固定件与缺件过滤下没有可用组合：可清空缺件，或先补空槽。')], { sub: '1 项链 + 4 戒指' });
    }
    const cards = st.combos.map((c, i) => {
      const ids = [c.amulet, ...(Array.isArray(c.rings) ? c.rings : [])].filter(Boolean);
      const pieces = ids.map((id, k) => h('span', { class: 'lab-mini', title: `${labelOf(k ? RING_SLOTS[k - 1] || 'ring' : 'amulet')}：${zhOf(id)}` },
        h('span', { class: 'lab-mini__name', text: zhOf(id) })));
      return card(`组合 #${i + 1}`, fmt.num(c.score, 3), `组合分 · 单件均分 ${fmt.num(c.avg, 3)} · 维度覆盖 ${fmt.pct(c.coverage, 0)}`, {
        tags: whyOf(c),
        lines: [h('div', { class: 'lab-recard__pieces' }, pieces)],
        actions: [btn('整组写入', '把这 1 项链 + 4 戒指写入饰品槽', () => writeCombo(ids))],
      });
    });
    const fixedAll = plan.fixed.amulet && plan.fixed.rings.length === RING_SLOTS.length;
    const sub = fixedAll ? '5 件已固定 · 仅当前一套' : (plan.fixed.amulet || plan.fixed.rings.length ? '固定已装备项，补未固定槽' : '全部槽位自由组合');
    return catSection('整组组合 Top3', [recList(cards)], { sub });
  }

  function paintRec() {
    if (destroyed || !recHost) return;
    clear(recHost);
    const st = recState;
    const plan = emptyPlan();
    if (st.busy) recHost.append(h('div', { class: 'lab-recload' }, icon('refresh', { size: 13 }), h('span', { text: `按「${psZh(S.playstyleId())}」计算推荐…` })));
    if (st.error) recHost.append(noteLine(`部分推荐未完成：${st.error}`));
    if (st.remaining) recHost.append(...[].concat(remainSection(st, plan)));
    if (st.swap) recHost.append(swapSection(st, plan));
    if (!st.combos) return;
    recHost.append(combosSection(st, plan));
    if (st.stats) recHost.append(noteLine(`本次评估 ${fmt.int(st.stats.evaluated)} 组（候选池：项链 ${st.stats.amuletPool} / 戒指 ${st.stats.ringPool}）；组合分 = 0.7 × 单件均分 + 0.3 × 维度覆盖。`));
  }

  function renderRec(host) {
    if (!host) return;
    recHost = host;
    if (!gearReady()) { clear(host); host.append(emptyTab('饰品数据（lab_gear.json）尚未载入，暂不能推荐。')); return; }
    ensureEngines();
    if (!combo) { clear(host); host.append(emptyTab(`组合搜索模块未就绪：${comboError || '未知错误'}`)); return; }
    const key = condKey();
    if (recState.key !== key) {
      const cached = recCache.get(key);
      if (cached) recState = cached;
      else { recState = newState(key, true); computeRec(key); }
    }
    paintRec();
  }

  /* ------------------------- 组装 / 刷新 ------------------------- */
  function render() {
    if (destroyed) return;
    ensureEngines();
    syncPlaystyleSelect();
    clear(shell.body);
    shell.body.append(
      catBar([{ zh: '槽位' }, { zh: '饰品' }, { zh: '维度 · 契合' }, { zh: '效果' }, { zh: '操作' }]),
      ...SLOTS.map(trinketRow),
    );
    clear(shell.foot);
    shell.foot.append(
      noteLine('维度标签与「契合」来自 filter_tags / 关键词映射的维度权重（0–1 近似比较值），不是游戏内精确数值。'),
      noteLine('戒指不可重复：同一枚戒指放在两个戒指槽不会重复计入契合与组合分；组合推荐已排除缺件。'));
  }

  render();
  return {
    el: shell.el,
    refresh: render,
    renderRec,
    destroy() { destroyed = true; runner.cancel(); recHost = null; },
  };
}

export default createTrinketsTab;
