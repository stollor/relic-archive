/* =============================================================================
   遗迹2 · 遗物档案 — lab/wb-settings.js（v3）
   装配台的「配装设置」模块：只保留消耗品（参与合计）与预设增益档种子。
   场景 / 档位目标 / 流派已上移到装配台工具栏（唯一入口，避免两套下拉各写一遍状态）；
   特性等级在「特性」分类页维护，圣物碎片在「圣物与碎片」分类页维护。
   共享状态从显式上下文 ctx 读取（由 workbench.js 装配）。
   ========================================================================== */
import { h, clear } from '../core/dom.js';
import { icon } from '../core/icons.js';
import { chipGroup, fold } from './parts.js';
import { effectText } from './text.js';

/** site_data.profiles 里残留的旧译名 → 官方 locres 译名（只影响显示） */
export const OFFICIAL_ZH = (s) => String(s || '')
  .replace(/守望者/g, '护卫者')
  .replace(/医师/g, '医务兵')
  .replace(/仪式师/g, '祭祀者');

/** 特性效果按等级放大（数值字段一律乘 factor；用于特性行与构成明细） */
export function scaledEffect(eff, factor) {
  const out = {};
  for (const [k, v] of Object.entries(eff || {})) {
    if (typeof v === 'number') out[k] = v * factor;
    else if (v && typeof v === 'object') {
      out[k] = {};
      for (const [rk, rv] of Object.entries(v)) out[k][rk] = typeof rv === 'number' ? rv * factor : rv;
    }
  }
  return out;
}

export function createSettings(ctx) {
  const { model, E, S, ui } = ctx;

  /* ----------------------- 消耗品 / 预设种子 ----------------------- */
  const consHost = h('div');
  const seedHost = h('div');

  function renderPools() {
    clear(consHost);
    consHost.append(chipGroup(
      E.consumables.map((m) => ({ id: m.id, zh: m.zh, title: effectText(m.effect) || '无防御词条' })),
      new Set(S.consumables()),
      (it) => { S.toggleConsumable(it.id); ui.toast(S.consumables().includes(it.id) ? `已启用消耗品：${it.zh}` : `已取消消耗品：${it.zh}`, 'ok'); },
      { emptyText: '消耗品数据未收录' },
    ));
    clear(seedHost);
    const active = S.seedProfile();
    const wrap = h('div', { class: 'lab-chips' });
    for (const p of E.profiles) {
      wrap.append(h('button', {
        class: `chip chip--sm${active === p.id ? ' is-on' : ''}`, type: 'button',
        title: '把该增益档的特性 / 碎片 / 消耗品 / 职业专长灌入显式设置，并把项链戒指写入槽位',
        on: {
          click: () => {
            const r = S.applyProfileSeed(model, p.id);
            ui.toast(r ? `已载入增益档：${p.zh}（特性 ${r.traitCount} 个）` : '载入失败', r ? 'ok' : 'warn');
          },
        },
      }, h('span', { text: OFFICIAL_ZH(String(p.zh).replace(/（[^）]*）/g, '').trim() || p.zh) })));
    }
    seedHost.append(wrap,
      active ? h('div', { class: 'lab-note' },
        icon('info', { size: 12 }),
        h('span', { text: `当前种子：${(E.profileById.get(active) || {}).zh || active}。种子里的职业专长会计入合计；清除种子不会改已经灌入的特性等级。` }),
        h('button', { class: 'btn btn--quiet btn--sm', type: 'button', text: '清除种子', on: { click: () => { S.clearSeed(); ui.toast('已清除增益档种子', 'ok'); } } }),
      ) : '');
  }

  /* ----------------------------- 面板主体 ----------------------------- */
  const body = [
    h('div', { class: 'lab-note' },
      icon('info', { size: 12 }),
      h('span', { text: '场景 / 档位 / 流派在装配台工具栏切换；特性等级在「特性」页，圣物碎片在「圣物与碎片」页，均实时计入下方本套效果。' }),
    ),
    fold('消耗品', consHost, { sub: '勾选参与合计' }),
    fold('从预设增益档载入', seedHost, { sub: '仅作起点' }),
  ];

  return { body, renderPools };
}
