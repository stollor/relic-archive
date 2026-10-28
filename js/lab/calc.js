/* =============================================================================
   遗迹2 · 遗物档案 — lab/calc.js（v2）
   计算器：护甲值 → 减伤率（三类乘算 + 80% 上限）、负重 → 负重档位 / 体力 / 闪避；
   可选择「套用工作台当前增益」（特性/职业专长/碎片/消耗品/饰品），与推荐/工作台同引擎。
   支持 URL 参数代入：?panel=calc&armor=&weight=&flat=&bleed=&fire=&shock=&corrosive=&blight=
   ========================================================================== */
import { h, clear, fmt } from '../core/dom.js';
import { icon } from '../core/icons.js';
import { store } from '../core/store.js';
import { ui } from '../core/ui.js';
import * as S from './state.js';
import { panel, meterRow, classBadge, statGrid, TYPE_ICON, TYPE_COLOR, TYPE_ZH, CLASS_ZH } from './parts.js';
import { effectText } from './text.js';

const NUM_KEYS = ['bleed', 'fire', 'shock', 'corrosive', 'blight'];
const UI_KEY = 'lab.calc';

const DEFAULTS = {
  armor: 176.8, weight: 90, res: [10, 10, 10, 10, 10], flatDR: 0,
  scenario: 'general', useWorkbench: true,
};

function loadCalc() {
  const saved = store.ui.get(UI_KEY);
  const c = Object.assign({}, DEFAULTS, saved || {});
  if (!Array.isArray(c.res) || c.res.length !== 5) c.res = [...DEFAULTS.res];
  return c;
}
function saveCalc(c) { store.ui.set(UI_KEY, c); }

export function createCalc(model, { query = null } = {}) {
  const E = model.engine;
  const calc = loadCalc();
  if (!calc.scenario) calc.scenario = S.scenarioId();
  const root = h('div', { class: 'lab-calc' });
  const outHost = h('div', { class: 'lab-calc__out' });
  const inputHost = h('div');

  function applyQuery(q) {
    if (!q) return false;
    const get = (k) => (q.get ? q.get(k) : q[k]);
    const toNum = (v) => (v == null || v === '' ? null : Number(v));
    let touched = false;
    const a = toNum(get('armor')); if (a != null && Number.isFinite(a)) { calc.armor = a; touched = true; }
    const w = toNum(get('weight')); if (w != null && Number.isFinite(w)) { calc.weight = w; touched = true; }
    const f = toNum(get('flat')); if (f != null && Number.isFinite(f)) { calc.flatDR = f / 100; touched = true; }
    NUM_KEYS.forEach((k, i) => { const v = toNum(get(k)); if (v != null && Number.isFinite(v)) { calc.res[i] = v; touched = true; } });
    const sc = get('scenario');
    if (sc && E.scenarios.some((x) => x.id === sc)) { calc.scenario = sc; touched = true; }
    if (touched) { saveCalc(calc); syncInputs(); renderOut(); }
    return touched;
  }

  /* --------------------------- 输入 --------------------------- */
  const inputs = { res: [] };
  function numField(label, value, onInput, { unit = '', step = 1, min = null, max = null } = {}) {
    const inp = h('input', {
      class: 'input input--num', type: 'number', value: String(value), step: String(step),
      attrs: { 'aria-label': label, min: min == null ? null : String(min), max: max == null ? null : String(max) },
    });
    inp.addEventListener('input', () => { const v = Number(inp.value); if (Number.isFinite(v)) { onInput(v); renderOut(); } });
    return h('div', { class: 'field lab-field--num' },
      h('label', { class: 'field__label', text: label }),
      h('div', { class: 'field__row' }, inp, unit ? h('span', { class: 'muted', text: unit }) : ''),
    );
  }

  const scenarioSel = h('select', { class: 'select', attrs: { 'aria-label': '场景' } },
    E.scenarios.map((s) => h('option', { value: s.id, text: s.zh })));
  scenarioSel.addEventListener('change', () => { calc.scenario = scenarioSel.value; saveCalc(calc); renderOut(); });

  const useWorkbench = h('input', {
    type: 'checkbox', checked: calc.useWorkbench,
    on: { change: (e) => { calc.useWorkbench = e.target.checked; saveCalc(calc); renderOut(); } },
  });

  function buildInputs() {
    clear(inputHost);
    inputs.armor = numField('护甲值（不含护甲效果）', calc.armor, (v) => { calc.armor = v; saveCalc(calc); }, { step: 0.1, min: 0 });
    inputs.weight = numField('负重', calc.weight, (v) => { calc.weight = v; saveCalc(calc); }, { step: 0.1, min: 0 });
    inputs.flat = numField('固定减伤', Math.round(calc.flatDR * 1000) / 10, (v) => { calc.flatDR = v / 100; saveCalc(calc); }, { unit: '%', step: 0.5, min: -95, max: 95 });
    inputs.res = NUM_KEYS.map((k, i) => numField(`${TYPE_ZH[k]}抗性`, calc.res[i], (v) => { calc.res[i] = v; saveCalc(calc); }, { step: 1 }));
    for (const r of inputs.res) r.querySelector('.field__label').prepend(icon(TYPE_ICON[NUM_KEYS[inputs.res.indexOf(r)]], { size: 11 }));
    inputHost.append(
      h('div', { class: 'lab-calc__grid' }, inputs.armor, inputs.weight, inputs.flat),
      h('div', { class: 'lab-bar-title', attrs: { style: 'margin-top:8px' } }, '五类抗性'),
      h('div', { class: 'lab-calc__grid' }, ...inputs.res),
      h('div', { class: 'lab-bar-title', attrs: { style: 'margin-top:8px' } }, '场景与增益'),
      h('div', { class: 'lab-calc__grid lab-calc__grid--2' },
        h('div', { class: 'field' }, h('label', { class: 'field__label', text: '场景' }), scenarioSel),
        h('label', { class: 'switch', attrs: { style: 'align-self:end;padding-bottom:6px' } },
          useWorkbench, h('span', { class: 'switch__track' }),
          h('span', { text: '套用工作台当前增益（特性 / 职业 / 碎片 / 消耗品 / 饰品）' })),
      ),
      h('div', { class: 'lab-actions', attrs: { style: 'margin-top:10px' } },
        h('button', {
          class: 'btn btn--quiet btn--sm', type: 'button',
          on: {
            click: () => {
              const st = S.workbenchSummary(model);
              if (!st.filled) { ui.toast('工作台还没有护甲，先放入至少一件', 'warn'); return; }
              calc.armor = Math.round(st.sumA * 10) / 10;
              calc.weight = Math.round(st.sumW * 10) / 10;
              calc.res = st.sumR.map((x) => Math.round(x * 10) / 10);
              calc.flatDR = Math.round(st.acc.flatDR * 1000) / 1000;
              calc.scenario = S.scenarioId();
              calc.useWorkbench = false; // 已代入基础值，避免重复计入增益
              saveCalc(calc);
              syncInputs(); renderOut();
              ui.toast('已代入工作台四件护甲的基础数值（增益开关已关闭，避免重复计算）', 'ok');
            },
          },
        }, icon('flask', { size: 13 }), h('span', { text: '代入工作台基础值' })),
        h('button', {
          class: 'btn btn--quiet btn--sm', type: 'button',
          on: { click: () => { Object.assign(calc, { ...DEFAULTS, res: [...DEFAULTS.res] }); saveCalc(calc); syncInputs(); renderOut(); ui.toast('计算器已重置', 'ok'); } },
        }, icon('rotate-ccw', { size: 13 }), h('span', { text: '重置' })),
      ),
      h('div', { class: 'lab-note' }, icon('info', { size: 12 }),
        h('span', { text: '链接可直接带参数：?panel=calc&armor=265.2&weight=90&flat=15&bleed=10&scenario=losomn；旧「增益档」参数不再使用。' })),
    );
  }

  function syncInputs() {
    const set = (wrap, v) => { const i = wrap && wrap.querySelector('input'); if (i && document.activeElement !== i) i.value = String(v); };
    set(inputs.armor, calc.armor);
    set(inputs.weight, calc.weight);
    set(inputs.flat, Math.round(calc.flatDR * 1000) / 10);
    inputs.res.forEach((w, i) => set(w, calc.res[i]));
    scenarioSel.value = calc.scenario;
    useWorkbench.checked = calc.useWorkbench;
  }

  /* --------------------------- 输出 --------------------------- */
  const revState = { dr: 60 };
  function renderOut() {
    clear(outHost);
    const picks = calc.useWorkbench ? S.workbenchPicks(model) : {};
    const acc = E.expandMods(picks);
    acc.flatDR += Number(calc.flatDR) || 0;
    const sc = E.scenarioById(calc.scenario || 'general');
    const res = Array.isArray(calc.res) ? calc.res : [0, 0, 0, 0, 0];
    const st = E.statsFor(Number(calc.armor) || 0, Number(calc.weight) || 0, res, acc, sc);

    const defense = statGrid([
      { k: '总护甲（含护甲效果）', v: fmt.num(st.armor, 1), iconName: 'armor' },
      { k: '护甲减伤', v: fmt.pct(st.adr, 1), iconName: 'shield' },
      { k: '固定减伤（乘区）', v: fmt.pct(st.fdr, 1), iconName: 'shield' },
      { k: '物理总减伤', v: fmt.pct(st.totals.physical, 1), iconName: 'phys' },
      { k: '最坏情况减伤', v: fmt.pct(st.worst, 1), iconName: 'warning' },
      { k: '场景分', v: fmt.pct(st.score, 1), iconName: 'chart' },
    ]);
    const bars = h('div', { class: 'panel lab-calc__panel' },
      h('div', { class: 'panel__head' }, h('h2', { class: 'panel__title' }, icon('resist', { size: 15 }), h('span', { text: '五类总减伤' }))),
      h('div', { class: 'panel__body' },
        meterRow(TYPE_ICON.physical, TYPE_ZH.physical, st.totals.physical, TYPE_COLOR.physical),
        ...E.RES.map((t) => meterRow(TYPE_ICON[t], TYPE_ZH[t], st.totals[t], TYPE_COLOR[t])),
      ),
    );
    const survival = h('div', { class: 'panel lab-calc__panel' },
      h('div', { class: 'panel__head' }, h('h2', { class: 'panel__title' }, icon('health', { size: 15 }), h('span', { text: '生存' }))),
      h('div', { class: 'panel__body' },
        statGrid([
          { k: '有效生命 EHP', v: fmt.num(st.ehp, 1), iconName: 'health', sub: '基础生命 100 假设' },
          { k: '生命上限', v: fmt.num(st.hpTotal, 1), iconName: 'health' },
          { k: '护盾', v: fmt.pct(st.shieldPct, 1), iconName: 'shield' },
          { k: '生命回复', v: `${fmt.num(st.hpRegen, 1)}/s`, iconName: 'health' },
        ]),
      ),
    );
    const mobility = h('div', { class: 'panel lab-calc__panel' },
      h('div', { class: 'panel__head' }, h('h2', { class: 'panel__title' }, icon('dodge', { size: 15 }), h('span', { text: '机动' }))),
      h('div', { class: 'panel__body' },
        statGrid([
          { k: '负重档位', v: CLASS_ZH[st.cls], iconName: 'weight', sub: `负重 ${fmt.num(st.weight, 1)} · 阈值 ${st.T.map(Math.round).join(' / ')}` },
          { k: '体力上限', v: fmt.num(st.stam, 0), iconName: 'stamina' },
          { k: '单次闪避', v: fmt.num(st.evade, 1), iconName: 'dodge' },
          { k: '可闪次数', v: `${st.dodges} 次`, iconName: 'stamina' },
          { k: '体力回复', v: `${fmt.num(st.regen, 1)}/s`, iconName: 'stamina' },
          { k: '闪避无敌 / 恢复', v: `${st.iframes} / ${st.recovery} 帧`, iconName: 'dodge' },
        ]),
      ),
    );

    const revInput = h('input', { class: 'input input--num', type: 'number', value: String(revState.dr), step: '0.5', min: '1', max: '95', attrs: { 'aria-label': '目标护甲减伤' } });
    const revOut = h('b', { class: 'lab-gold', text: fmt.num(E.reverseDR(revState.dr / 100), 1) });
    revInput.addEventListener('input', () => {
      const v = Number(revInput.value);
      if (!Number.isFinite(v)) return;
      revState.dr = v;
      revOut.textContent = fmt.num(E.reverseDR(v / 100), 1);
    });
    const rev = h('div', { class: 'panel lab-calc__panel' },
      h('div', { class: 'panel__head' }, h('h2', { class: 'panel__title' }, icon('target', { size: 15 }), h('span', { text: '反算：目标护甲减伤需要多少护甲' }))),
      h('div', { class: 'panel__body' },
        h('div', { class: 'row row--wrap' },
          h('span', { class: 'muted', text: '目标护甲减伤' }), revInput,
          h('span', { class: 'muted', text: '% → 需要护甲值' }), revOut,
        ),
        h('pre', { class: 'formula', attrs: { style: 'margin-top:8px' }, text: '所需护甲值 = 200 × 目标护甲减伤 ÷ (1 − 目标护甲减伤)' }),
      ),
    );

    const formula = h('div', { class: 'panel lab-calc__panel' },
      h('div', { class: 'panel__head' }, h('h2', { class: 'panel__title' }, icon('book', { size: 15 }), h('span', { text: '本例代数过程' }))),
      h('div', { class: 'panel__body' },
        h('pre', { class: 'formula', text: [
          `总护甲   = ${fmt.num(Number(calc.armor) || 0, 1)} × (1 + ${fmt.num((st.armor / (Number(calc.armor) || 1) - 1) * 100, 0)}%) = ${fmt.num(st.armor, 1)}`,
          `护甲减伤 = ${fmt.num(st.armor, 1)} / (${fmt.num(st.armor, 1)} + ${fmt.num(E.K, 0)}) = ${fmt.pct(st.adr, 2)}`,
          `固定减伤 = ${fmt.num(st.fdr * 100, 1)}%    抗性 = ${E.RES.map((t, i) => `${TYPE_ZH[t]} ${fmt.num(st.res[i], 1)}`).join(' · ')}`,
          `物理总减伤 = 1-(1-${fmt.pct(st.adr, 2)})(1-${fmt.pct(st.fdr, 2)}) = ${fmt.pct(st.totals.physical, 2)}`,
          `火焰总减伤 = 1-(1-${fmt.pct(st.adr, 2)})(1-${fmt.pct(st.fdr, 2)})(1-${fmt.num(st.res[1], 1)}/100) = ${fmt.pct(st.totals.fire, 2)}`,
          `（三类乘算封顶 ${fmt.pct(E.C.CAP, 0)}；元素减伤为独立第 4 乘区，封顶后可超过 ${fmt.pct(E.C.CAP, 0)}）`,
          `负重 ${fmt.num(st.weight, 1)} → 阈值 ${st.T.map(Math.round).join(' / ')} → ${CLASS_ZH[st.cls]}`,
          `单次闪避 = ${fmt.num(E.C.EVADE_BASE, 0)} × (1 + 档位惩罚 ${fmt.num(E.C.PENALTY[st.cls] || 0, 2)} + 加成 0) = ${fmt.num(st.evade, 2)}`,
          `有效生命 EHP = (100 + ${fmt.num(st.hpMax - 100, 0)}) × (1+${fmt.pct(acc.hpPct, 1)}) / (1-${fmt.pct(st.totals.physical, 2)}) = ${fmt.num(st.ehp, 1)}`,
        ].join('\n') }),
      ),
    );

    outHost.append(defense, bars, survival, mobility, rev, formula);
  }

  buildInputs();
  applyQuery(query);
  syncInputs();
  renderOut();

  const panelEl = panel('计算器', { iconName: 'calc', sub: '与工作台同一引擎' });
  panelEl.querySelector('.panel__body').append(
    h('div', { class: 'lab-calc__wrap' }, inputHost, h('div', { class: 'lab-calc__side' }, outHost)),
  );

  return {
    el: panelEl,
    applyQuery,
    applyParams(p) { if (p && (p.armor || p.weight || p.flat || p.bleed || p.fire || p.shock || p.corrosive || p.blight || p.scenario)) applyQuery(new URLSearchParams(p)); },
    refresh() { syncInputs(); renderOut(); },
    destroy() {},
  };
}

export default createCalc;
