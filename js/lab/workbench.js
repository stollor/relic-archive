/* =============================================================================
   遗迹2 · 遗物档案 — lab/workbench.js（v3）
   工作台装配：15 槽（wb-slots）+ 配装设置（wb-settings）+ 结果面板（wb-result）
   装配 + 共享上下文 + 订阅 + 刷新调度 + destroy 都在这里，模块之间不靠闭包互访。
   交互语义按 UX_SPEC §2：点图标/名称=详情（职业=职业选择），×=移除，空槽/更换=选择器。
   ========================================================================== */
import { h } from '../core/dom.js';
import { store } from '../core/store.js';
import { ui } from '../core/ui.js';
import { openItemDetail } from '../components/item-detail.js';
import { createRefresh, createScope } from '../core/task.js';
import * as S from './state.js';
import { panel } from './parts.js';
import { TRINKET_SLOTS, renderSlotTools, renderSlots } from './wb-slots.js';
import { createSettings } from './wb-settings.js';
import { createResult } from './wb-result.js';

/** 面板实例契约（views/lab.js 与各模块共用）：
 *  { el, mount?, refresh?, applyParams?(params), activate?, destroy? }
 *  本工作台的公开形状：{ el, refresh, destroy }。
 */
export function createWorkbench(model, { onOpenPanel = null } = {}) {
  const E = model.engine;
  const root = h('div', { class: 'lab-wb' });
  const slotsHost = h('div', { class: 'lab-wb__slots' });
  const slotsTools = h('div', { class: 'row', attrs: { style: 'gap:6px' } });
  let destroyed = false;

  /* --------------------------- 共享上下文 --------------------------- */
  // 模块只从这里取共享状态/服务；不依赖 workbench 的内部闭包变量。
  const ctx = {
    model, E, S, store, ui,
    slotsHost, slotsTools,
    nameOf: (id) => model.nameOf(id),
    iconOf: (id) => model.iconOf(id),
    archOf: (id) => (id ? model.findArchetype(id) : null),
    isOwned: (id) => store.isOwned(id),
    isMissing: (id) => S.isMissing(id),
    trinketIds: () => TRINKET_SLOTS.map((s) => store.build.get(s)).filter(Boolean),
    openDetail: (id) => { if (id) openItemDetail(id, { from: 'lab' }); },
    onOpenPanel,
    refresh: () => refresh.schedule(),
  };

  const settings = createSettings(ctx);
  const result = createResult(ctx);
  const { syncSelects, renderPools } = settings;
  const { renderResult } = result;

  /* --------------------------- 刷新调度 --------------------------- */
  const refresh = createRefresh(() => {
    if (destroyed) return;
    syncSelects();
    renderSlotTools(ctx);
    renderSlots(ctx);
    renderPools();
    renderResult();
  });

  /* --------------------------- 组装 --------------------------- */
  const slotsPanel = panel('配装槽位', { iconName: 'grid', sub: '15 槽 · 职业 + 特性实时生效' });
  slotsPanel.tools.append(slotsTools);
  slotsPanel.body.append(slotsHost);

  const settingsPanel = panel('配装设置', { iconName: 'trait', sub: '场景 / 档位 / 消耗品 · 写入存档 meta' });
  settingsPanel.body.append(...settings.body);

  const resultPanel = panel('结果面板', { iconName: 'chart', sub: '防御 / 生存 / 机动' });
  resultPanel.body.append(...result.body);

  root.append(h('div', { class: 'lab-wb__main' }, slotsPanel.el, settingsPanel.el), h('aside', { class: 'lab-wb__side' }, resultPanel.el));

  /* --------------------------- 订阅 / 初始渲染 --------------------------- */
  const cleanup = createScope();
  cleanup.add(S.on((reason) => {
    if (['missing', 'scenario', 'class-target', 'seed', 'playstyle', 'fragment', 'attachment'].includes(reason)) refresh.schedule();
  }));
  cleanup.add(store.on('build', () => refresh.schedule()));
  cleanup.add(store.on('owned', () => refresh.schedule()));

  syncSelects();
  renderSlotTools(ctx);
  renderSlots(ctx);
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
    },
  };
}

export default createWorkbench;
