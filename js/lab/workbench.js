/* =============================================================================
   遗迹2 · 遗物档案 — lab/workbench.js（v4 静默版）
   实验台主区只保留三层信息：
     ① 装配台（6 分类页，行内只显示关键属性，详情在统一详情浮层）
     ② 本套效果（一行关键数值 + 可展开的完整数值/构成明细/输出）
     ③ 本类推荐（分类模块的 renderRec，压缩高度、内部滚动）
   配装设置（流派 / 场景 / 档位 / 缺件 / 消耗品 / 预设种子）收进装配台的「设置」抽屉；
   九个进阶面板由视图层的「高级工具」折叠区承载（本文件不再渲染它们）。
   ========================================================================== */
import { h, clear, fmt } from '../core/dom.js';
import { icon } from '../core/icons.js';
import { store } from '../core/store.js';
import { ui } from '../core/ui.js';
import { openItemDetail } from '../components/item-detail.js';
import { createRefresh, createScope } from '../core/task.js';
import * as S from './state.js';
import { panel } from './parts.js';
import { TRINKET_SLOTS, pickForSlot, removeSlot } from './wb-slots.js';
import { SLOT_LABEL } from './model.js';
import { createAssembly } from './wb-assembly.js';
import { createSettings } from './wb-settings.js';
import { createResult } from './wb-result.js';
import { CLASS_ZH } from './engine.js';

export function createWorkbench(model, { onOpenPanel = null } = {}) {
  const E = model.engine;
  const root = h('div', { class: 'lab-wb' });
  const recHost = h('div', { class: 'lab-wb__rechost' });
  const summaryHost = h('div', { class: 'lab-summary' });
  let destroyed = false;
  let refresh = null;
  const scheduleRefresh = () => refresh?.schedule();

  /* --------------------------- 共享上下文 --------------------------- */
  const ctx = {
    model, E, S, store, ui,
    nameOf: (id) => model.nameOf(id),
    iconOf: (id) => model.iconOf(id),
    archOf: (id) => (id ? model.findArchetype(id) : null),
    isOwned: (id) => store.isOwned(id),
    isMissing: (id) => S.isMissing(id),
    pickForSlot: (slot) => pickForSlot(ctx, slot),
    removeSlot: (slot) => removeSlot(ctx, slot),
    openDetail: (id) => { if (id) openItemDetail(id, { from: 'lab' }); },
    trinketIds: () => TRINKET_SLOTS.map((s) => store.build.get(s)).filter(Boolean),
    onOpenPanel,
    openPanel: onOpenPanel,
    slotLabel: SLOT_LABEL,
    settingsBody: [],                 // 由装配台的「设置」抽屉渲染（消耗品 / 预设种子）
    refresh: scheduleRefresh,
  };

  const settings = createSettings(ctx);
  const result = createResult(ctx);
  ctx.settingsBody = settings.body;
  const { renderPools } = settings;
  const { renderResult } = result;

  /* --------------------------- 装配台 --------------------------- */
  const assembly = createAssembly(ctx, { recHost, onCategoryChange: scheduleRefresh });

  /* --------------------------- 刷新调度 --------------------------- */
  refresh = createRefresh(() => {
    if (destroyed) return;
    assembly.refresh();
    renderPools();
    renderResult();
    renderSummary();
  });

  /* --------------------------- 本套效果（一行关键数值 + 展开） --------------------------- */
  function renderSummary() {
    clear(summaryHost);
    const st = S.workbenchSummary(model);
    const scenario = E.scenarioById(S.scenarioId());
    if (st.filled === 0) {
      summaryHost.append(
        h('span', { class: 'lab-summary__hint', text: '放入护甲后显示实时合计（职业 / 特性 / 饰品 / 碎片已计入）。' }),
      );
      return;
    }
    const items = [
      { k: '场景分', v: fmt.pct(st.score, 1), cls: 'is-gold' },
      { k: '护甲值', v: fmt.num(st.armor, 1) },
      { k: '护甲减伤', v: fmt.pct(st.adr, 1) },
      { k: '物理总减伤', v: fmt.pct(st.totals.physical, 1) },
      { k: '负重', v: `${fmt.num(st.weight, 1)} · ${CLASS_ZH[st.cls] || st.cls}` },
      { k: '有效生命', v: fmt.num(st.ehp, 0) },
    ];
    summaryHost.append(
      h('div', { class: 'lab-summary__grid' },
        items.map((it) => h('div', { class: `lab-summary__item${it.cls ? ` ${it.cls}` : ''}` },
          h('b', { text: it.v }),
          h('span', { text: it.k }),
        )),
      ),
      h('span', { class: 'lab-summary__scene', text: scenario.zh }),
    );
  }

  /* --------------------------- 组装（只三层） --------------------------- */
  const assemblyCard = h('div', { class: 'lab-asm-card' }, assembly.el);

  const summaryPanel = panel('本套效果', { iconName: 'chart', sub: '当前整套实时合计' });
  summaryPanel.el.classList.add('lab-wb__side');
  const expand = h('details', { class: 'lab-expand' },
    h('summary', {}, icon('listchecks', { size: 13 }), h('span', { text: '完整数值 / 构成明细 / 输出' })),
    h('div', { class: 'lab-expand__body' }, ...result.body),
  );
  summaryPanel.body.append(summaryHost, expand);

  const recPanel = panel('本类推荐', { iconName: 'sparkle', sub: '随分类与配装实时更新' });
  recPanel.el.classList.add('lab-wb__rec');
  recPanel.body.append(recHost);

  root.append(assemblyCard, summaryPanel.el, recPanel.el);

  /* --------------------------- 订阅 / 初始渲染 --------------------------- */
  const cleanup = createScope();
  cleanup.add(S.on((reason) => {
    if (['missing', 'scenario', 'class-target', 'seed', 'playstyle', 'fragment', 'attachment'].includes(reason)) refresh.schedule();
  }));
  cleanup.add(store.on('build', () => refresh.schedule()));
  cleanup.add(store.on('owned', () => refresh.schedule()));

  renderPools();
  renderResult();
  renderSummary();

  return {
    el: root,
    refresh() { refresh.schedule(); },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      cleanup.dispose();
      refresh.cancel();
      try { assembly.destroy?.(); } catch (err) { console.error('[lab] 装配台销毁失败', err); }
    },
  };
}

export default createWorkbench;
