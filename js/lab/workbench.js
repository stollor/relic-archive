/* =============================================================================
   遗迹2 · 遗物档案 — lab/workbench.js（v3 装配台）
   实验台主区：装配台（6 分类页）+ 本套效果（防御/生存/机动 + 构成明细 + 输出）
   + 本类推荐（随分类 / 配装实时更新）+ 配装设置（消耗品 / 预设种子）。

   布局：
     .lab-wb
       ├─ 装配台 panel（wb-assembly）
       ├─ .lab-wb__bottom：本套效果（wb-result）+ 推荐（分类模块 renderRec）
       └─ 配装设置 panel（wb-settings：只留消耗品 / 种子；场景/档位/流派在装配台工具栏）

   订阅与刷新调度在本文件；模块之间只通过显式 ctx 取共享状态，不靠闭包互访。
   ========================================================================== */
import { h } from '../core/dom.js';
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

/** 面板实例契约（views/lab.js 与各模块共用）：{ el, refresh?, destroy? }；本工作台公开 { el, refresh, destroy }。 */
export function createWorkbench(model, { onOpenPanel = null } = {}) {
  const E = model.engine;
  const root = h('div', { class: 'lab-wb' });
  const recHost = h('div', { class: 'lab-wb__rechost' });
  const bottom = h('div', { class: 'lab-wb__bottom' });
  let destroyed = false;
  /** 刷新器在 ctx / settings / result 之后才创建；这里先给一个惰性入口，避免初始化期 TDZ */
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
    refresh: scheduleRefresh,
  };

  const settings = createSettings(ctx);
  const result = createResult(ctx);
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
  });

  /* --------------------------- 组装 --------------------------- */
  const assemblyPanel = panel('装配台', { iconName: 'grid', sub: '6 类装备 · 点行装 / 换 / 卸 · 实时合计', flush: true });
  assemblyPanel.body.append(assembly.el);

  const resultPanel = panel('本套效果', { iconName: 'chart', sub: '防御 / 生存 / 机动 · 当前整套实时合计' });
  resultPanel.el.classList.add('lab-wb__side');
  resultPanel.body.append(...result.body);

  const recPanel = panel('本类推荐', { iconName: 'sparkle', sub: '随分类与配装实时更新' });
  recPanel.el.classList.add('lab-wb__rec');
  recPanel.body.append(recHost);

  bottom.append(resultPanel.el, recPanel.el);

  const settingsPanel = panel('配装设置', { iconName: 'trait', sub: '消耗品 / 预设种子 · 写入存档 meta' });
  settingsPanel.body.append(...settings.body);

  root.append(assemblyPanel.el, bottom, settingsPanel.el);

  /* --------------------------- 订阅 / 初始渲染 --------------------------- */
  const cleanup = createScope();
  cleanup.add(S.on((reason) => {
    if (['missing', 'scenario', 'class-target', 'seed', 'playstyle', 'fragment', 'attachment'].includes(reason)) refresh.schedule();
  }));
  cleanup.add(store.on('build', () => refresh.schedule()));
  cleanup.add(store.on('owned', () => refresh.schedule()));

  renderPools();
  renderResult();

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
