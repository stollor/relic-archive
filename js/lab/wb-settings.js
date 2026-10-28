/* =============================================================================
   遗迹2 · 遗物档案 — lab/wb-settings.js
   工作台的「配装设置」模块：场景 / 档位目标 / 特性等级 / 圣物碎片 / 消耗品 /
   预设增益档种子。设置全部写进 store.build.meta（随具名存档一起走）。
   共享状态从显式上下文 ctx 读取（由 workbench.js 的 createContext 装配）。
   ========================================================================== */
import { h, clear } from '../core/dom.js';
import { icon } from '../core/icons.js';
import { TRAIT_CAP, TRAIT_MAX_LEVEL } from './state.js';
import { chipGroup, fold } from './parts.js';
import { CLASS_ZH } from './engine.js';
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

  /* --------------------------- 场景 / 档位 --------------------------- */
  const scenarioSel = h('select', { class: 'select', attrs: { 'aria-label': '场景' } },
    E.scenarios.map((s) => h('option', { value: s.id, text: s.zh })));
  scenarioSel.addEventListener('change', () => { S.setScenario(scenarioSel.value); ui.toast(`场景：${E.scenarioById(scenarioSel.value).zh}`, 'ok'); });
  const classSel = h('select', { class: 'select', attrs: { 'aria-label': '档位目标' } },
    [{ id: 'free', zh: '不限' }, ...E.CLASS_ORDER.map((c) => ({ id: c, zh: CLASS_ZH[c] }))]
      .map((o) => h('option', { value: o.id, text: o.zh })));
  classSel.addEventListener('change', () => S.setClassTarget(classSel.value));
  function syncSelects() { scenarioSel.value = S.scenarioId(); classSel.value = S.classTarget(); }

  /* ----------------------------- 特性等级 ----------------------------- */
  const traitsHost = h('div', { class: 'lab-traits' });
  const traitCountEl = h('span', { class: 'lab-traits__count' });

  function traitRow(t) {
    const lv = (S.traitLevels()[t.id] || 0);
    const eff = lv > 0 ? effectText(scaledEffect(E.traitPerLevel(t), lv)) : '';
    const dec = h('button', {
      class: 'iconbtn iconbtn--sm', type: 'button', title: `${t.zh} −1`, 'aria-label': `${t.zh} 减一级`,
      disabled: lv <= 0, on: { click: () => S.incTrait(t.id, -1) },
    }, icon('minus', { size: 13 }));
    const inc = h('button', {
      class: 'iconbtn iconbtn--sm', type: 'button', title: `${t.zh} +1`, 'aria-label': `${t.zh} 加一级`,
      disabled: lv >= TRAIT_MAX_LEVEL,
      on: { click: () => { const r = S.incTrait(t.id, 1); if (!r.ok && r.reason === 'cap') ui.toast(`特性最多同时启用 ${TRAIT_CAP} 个（游戏上限）`, 'warn'); } },
    }, icon('plus', { size: 13 }));
    return h('div', { class: `lab-trait${lv > 0 ? ' is-on' : ''}` },
      h('div', { class: 'lab-trait__main' },
        h('div', { class: 'lab-trait__name', text: t.zh }),
        h('div', { class: `lab-trait__eff${lv > 0 ? '' : ' muted'}`, title: eff || '未启用', text: lv > 0 ? eff : '未启用' }),
      ),
      h('div', { class: 'lab-stepper' }, dec, h('span', { class: 'lab-stepper__v', text: `${lv}` }), inc),
    );
  }

  function renderTraits() {
    clear(traitsHost);
    const used = S.traitUsed();
    clear(traitCountEl);
    traitCountEl.append(h('span', { class: `badge ${used >= TRAIT_CAP ? 'badge--mid' : 'badge--neutral'}`, text: `已用特性 ${used}/${TRAIT_CAP}` }));
    for (const t of E.traits) traitsHost.append(traitRow(t));
  }

  /* ----------------------- 碎片 / 消耗品 / 预设种子 ----------------------- */
  const fragHost = h('div');
  const consHost = h('div');
  const seedHost = h('div');

  function renderPools() {
    clear(fragHost);
    fragHost.append(chipGroup(
      E.fragments.map((m) => ({ id: m.id, zh: m.zh, title: effectText(m.effect) || '无防御词条' })),
      new Set(S.fragments()),
      (it) => { S.toggleFragment(it.id); ui.toast(S.fragments().includes(it.id) ? `已启用碎片：${it.zh}` : `已取消碎片：${it.zh}`, 'ok'); },
      { emptyText: '碎片数据未收录' },
    ));
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
    h('div', { class: 'lab-fieldrow' },
      h('div', { class: 'field' }, h('label', { class: 'field__label', text: '场景' }), scenarioSel),
      h('div', { class: 'field' }, h('label', { class: 'field__label', text: '档位目标（推荐 / 重算用）' }), classSel),
    ),
    h('div', { class: 'lab-traitshead' },
      h('div', { class: 'bar-title' }, '特性等级', traitCountEl),
      h('div', { class: 'row', attrs: { style: 'gap:4px' } },
        h('button', {
          class: 'btn btn--quiet btn--sm', type: 'button', text: '全满',
          on: { click: () => { S.fillTraits(E.traits); ui.toast(`已将前 ${TRAIT_CAP} 个防御特性设为满级（游戏上限 ${TRAIT_CAP} 个）`, 'ok'); } },
        }),
        h('button', { class: 'btn btn--quiet btn--sm', type: 'button', text: '清空', on: { click: () => { S.clearTraits(); ui.toast('已清空特性', 'ok'); } } }),
      ),
    ),
    traitsHost,
    fold('圣物碎片', fragHost, { sub: '勾选参与合计' }),
    fold('消耗品', consHost, { sub: '勾选参与合计' }),
    fold('从预设增益档载入', seedHost, { sub: '仅作起点' }),
  ];

  return { body, syncSelects, renderTraits, renderPools };
}
