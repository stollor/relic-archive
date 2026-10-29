/* =============================================================================
   遗迹2 · 遗物档案 — lab/traits.js（v2）
   特性面板：全量特性（中文名 / 维度 / 效果原文 / 等级步进 0–10），按流派维度排序；
   顶栏一键「流派前 10 满级」与「清空」；装备上限 10 个（游戏规则），超出时给可见提示。
   数值特性（site_data.modifiers 有 perLevel）在等级 > 0 时显示折算效果，并随配装进防御引擎。
   URL：tps（维度筛选，空 = 全部）。
   ============================================================================= */
import { h, clear, fmt } from '../core/dom.js';
import { icon } from '../core/icons.js';
import { store } from '../core/store.js';
import { ui } from '../core/ui.js';
import { openItemDetail } from '../components/item-detail.js';
import { createScope } from '../core/task.js';
import * as S from './state.js';
import { panel, emptyState, emptyLine } from './parts.js';
import { effectText } from './text.js';
import { createScorer } from './score.js';
import { createFit } from './fit.js';

const TRAIT_TOP = 10;

/** effect → 按等级倍数放大（嵌套抗性对象逐层处理）；只处理数字，非数字原样返回 */
function scaleEffect(eff, factor) {
  if (!eff || typeof eff !== 'object') return eff;
  const out = {};
  for (const [k, v] of Object.entries(eff)) {
    if (typeof v === 'number') out[k] = v * factor;
    else if (v && typeof v === 'object') out[k] = scaleEffect(v, factor);
    else out[k] = v;
  }
  return out;
}

export function createTraits(model, deps = {}) {
  const gear = model.gear;
  const setQuery = typeof deps.setQuery === 'function' ? deps.setQuery : null;
  const gearReady = () => gear.trait.length > 0;

  const root = h('div', { class: 'lab-tr' });
  const capHost = h('div', { class: 'lab-tr__capbar' });
  const toolsHost = h('div', { class: 'lab-tr__tools' });
  const filterHost = h('div', { class: 'lab-tr__filters' });
  const listHost = h('div', { class: 'lab-tr__list' });
  const countHost = h('div', { class: 'lab-tr__count muted' });

  const state = {
    playstyle: S.playstyleId(),
    dim: '',        // 维度筛选（URL tps）
    q: '',          // 名称 / 效果搜索（仅本地）
    ordered: [],    // 当前流派下的排序结果（含 why）
  };

  const scope = createScope();
  let destroyed = false;
  /** id → 行更新函数（等级变化时只改这一行，不重建列表、不丢滚动位置） */
  const rowSync = new Map();

  /* ---------------------- 评分 / 适配（懒装配） ---------------------- */
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
      console.error('[lab:traits] 评分模块初始化失败', err);
    }
  }

  /* ---------------------- 排序 / 维度名 ---------------------- */
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

  function orderedTraits() {
    if (!gearReady()) return [];
    ensureEngines();
    if (fit) {
      try {
        const list = fit.recommendTraits({ playstyleId: state.playstyle, limit: gear.trait.length });
        if (Array.isArray(list) && list.length) {
          const byId = new Map(gear.trait.map((t) => [t.id, t]));
          return list.map((r) => Object.assign({}, byId.get(r.id) || { id: r.id }, {
            why: Array.isArray(r.why) ? r.why : [],
            recScore: r.score,
          }));
        }
      } catch (err) {
        console.error('[lab:traits] 特性排序失败，回落到目录顺序', err);
      }
    }
    return gear.trait.slice();
  }

  function filtered() {
    const q = state.q.trim().toLowerCase();
    return state.ordered.filter((rec) => {
      if (state.dim) {
        const v = rec.dims && rec.dims[state.dim];
        if (!(typeof v === 'number' && v > 0)) return false;
      }
      if (q) {
        const hay = `${rec.zh || ''} ${rec.en || ''} ${rec.effectZh || ''} ${rec.effectEn || ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }

  /* ---------------------- 等级读写 ---------------------- */
  function levelOf(id) { return S.traitLevels()[id] || 0; }

  function applyLevel(id, level) {
    const res = S.setTraitLevel(id, level);
    if (res && res.ok === false) {
      if (res.reason === 'cap') {
        ui.toast(`特性最多装备 ${S.TRAIT_CAP} 个：先把已有特性降到 0 级，再启用新的。`, 'warn');
      } else {
        ui.toast('这个特性无法设置等级。', 'warn');
      }
      return false;
    }
    return true;
  }

  function bump(id, delta) {
    if (destroyed) return;
    const cur = levelOf(id);
    const next = Math.max(0, Math.min(S.TRAIT_MAX_LEVEL, cur + delta));
    if (next === cur) return;
    if (!applyLevel(id, next)) return;
  }

  /* ---------------------- 顶栏 ---------------------- */
  function renderCap() {
    clear(capHost);
    const used = S.traitUsed();
    const over = used >= S.TRAIT_CAP;
    capHost.append(
      h('div', { class: 'lab-tr__cap' },
        icon('trait', { size: 13 }),
        h('span', { class: 'lab-tr__capk', text: '已装备特性' }),
        h('b', { class: `lab-tr__capv${over ? ' is-full' : ''}`, text: `${used} / ${S.TRAIT_CAP}` }),
      ),
      h('div', { class: 'lab-tr__meter', attrs: { title: `游戏规则：最多同时装备 ${S.TRAIT_CAP} 个特性；每个特性最多 ${S.TRAIT_MAX_LEVEL} 级` } },
        h('div', { class: 'lab-tr__meterfill', attrs: { style: `--v:${Math.min(1, used / S.TRAIT_CAP).toFixed(4)}` } })),
      over
        ? h('span', { class: 'badge badge--low', text: `已达上限：新的特性需先腾出位置` })
        : h('span', { class: 'muted', attrs: { style: 'font-size:11.5px' }, text: `还能再装备 ${S.TRAIT_CAP - used} 个` }),
    );
  }

  function renderTools() {
    clear(toolsHost);
    const ps = gear.playstyleById.get(state.playstyle);
    toolsHost.append(
      h('button', {
        class: 'btn btn--primary btn--sm', type: 'button',
        disabled: !gearReady(),
        attrs: { title: `按「${(ps && ps.zh) || state.playstyle}」维度把前 ${TRAIT_TOP} 个特性设为满级（会覆盖当前特性配置）` },
        on: { click: () => fillTop() },
      }, icon('sparkle', { size: 13 }), h('span', { text: `流派前 ${TRAIT_TOP} 一键满级` })),
      h('button', {
        class: 'btn btn--quiet btn--sm', type: 'button', attrs: { title: '把所有特性等级清零' },
        on: { click: () => { S.clearTraits(); ui.toast('已清空全部特性等级', 'ok'); } },
      }, icon('rotate-ccw', { size: 13 }), h('span', { text: '清空' })),
    );
  }

  function fillTop() {
    if (!gearReady()) return;
    ensureEngines();
    let picks = [];
    if (fit) {
      try {
        const list = fit.recommendTraits({ playstyleId: state.playstyle, limit: TRAIT_TOP });
        if (Array.isArray(list)) picks = list.slice(0, TRAIT_TOP).map((r) => r.id);
      } catch (err) {
        console.error('[lab:traits] 推荐失败', err);
      }
    }
    if (!picks.length) picks = state.ordered.slice(0, TRAIT_TOP).map((t) => t.id);
    if (!picks.length) { ui.toast('没有可用的特性数据', 'warn'); return; }
    const n = S.fillTraits(picks.map((id) => ({ id })));
    ui.toast(`已把 ${n} 个特性设为 ${S.TRAIT_MAX_LEVEL} 级（流派前 ${TRAIT_TOP}）`, 'ok');
  }

  /* ---------------------- 筛选条 ---------------------- */
  function syncQuery() {
    if (!setQuery) return;
    setQuery({ tps: state.dim || '' });
  }

  function setDim(id) {
    if (id === state.dim) return;
    state.dim = id;
    syncQuery();
    renderFilters();
    renderList();
  }

  function renderFilters() {
    clear(filterHost);
    const chips = h('div', { class: 'lab-chips' },
      h('button', {
        class: `chip chip--sm${state.dim === '' ? ' is-on' : ''}`, type: 'button', text: '全部维度',
        on: { click: () => setDim('') },
      }),
    );
    for (const d of gear.dimensions) {
      chips.append(h('button', {
        class: `chip chip--sm${state.dim === d.id ? ' is-on' : ''}`, type: 'button',
        attrs: { title: `只看有「${d.zh}」维度加成的特性` },
        on: { click: () => setDim(d.id === state.dim ? '' : d.id) },
      }, h('span', { text: d.zh })));
    }
    const search = h('input', {
      class: 'input lab-tr__search', type: 'search', value: state.q,
      attrs: { placeholder: '搜索特性名 / 效果', 'aria-label': '搜索特性' },
      on: {
        input: (e) => {
          state.q = e.target.value || '';
          renderList();
        },
      },
    });
    filterHost.append(chips, h('div', { class: 'lab-tr__searchwrap' }, icon('search', { size: 13 }), search));
  }

  /* ---------------------- 行 ---------------------- */
  function levelText(lv) { return `${lv}`; }

  function row(rec) {
    const id = rec.id;
    const zh = rec.zh || model.nameOf(id) || id;
    const lv = levelOf(id);
    const dims = dimsOf(rec, 3);
    const why = Array.isArray(rec.why) && rec.why.length ? rec.why : dims;
    const known = !!model.itemOf(id);
    const maxLevel = Number(rec.maxLevel) > 0 ? Number(rec.maxLevel) : S.TRAIT_MAX_LEVEL;

    const lvEl = h('span', { class: 'lab-tr__lv', text: levelText(lv), attrs: { title: `等级 ${lv} / ${maxLevel}` } });
    const numEl = h('div', { class: 'lab-tr__num' });
    const rowEl = h('div', { class: `lab-tr__row${lv > 0 ? ' is-on' : ''}`, dataset: { id } });

    const nameEl = known
      ? h('button', {
        class: 'lab-tr__name', type: 'button', attrs: { title: `${zh} · 打开物品详情` },
        on: { click: () => openItemDetail(id, { from: 'lab' }) },
      }, h('span', { text: zh }))
      : h('span', { class: 'lab-tr__name', text: zh });

    // aria-label / title 与工作台旧特性步进器同一措辞（「<特性名> 加一级」），便于交互验收与老用户习惯迁移
    const minus = h('button', {
      class: 'lab-tr__stepbtn', type: 'button', attrs: { 'aria-label': `${zh} 减一级`, title: `${zh} −1` },
      on: { click: () => bump(id, -1) },
    }, icon('minus', { size: 13 }));
    const plus = h('button', {
      class: 'lab-tr__stepbtn', type: 'button', attrs: { 'aria-label': `${zh} 加一级`, title: `${zh} +1（上限 ${maxLevel} 级）` },
      on: { click: () => bump(id, 1) },
    }, icon('plus', { size: 13 }));

    function syncRow() {
      const cur = levelOf(id);
      const on = cur > 0;
      rowEl.classList.toggle('is-on', on);
      lvEl.textContent = levelText(cur);
      lvEl.setAttribute('title', `等级 ${cur} / ${maxLevel}`);
      minus.disabled = cur <= 0;
      plus.disabled = cur >= maxLevel;
      clear(numEl);
      const perLevel = rec.perLevel || (rec.numeric && rec.numeric.effect_per_level) || null;
      if (perLevel && typeof perLevel === 'object') {
        const perText = effectText(perLevel);
        if (perText) {
          numEl.append(h('span', { class: 'lab-tr__numk', text: '每级' }), h('span', { text: perText }));
          if (on) {
            const scaled = effectText(scaleEffect(perLevel, cur));
            if (scaled) numEl.append(h('span', { class: 'lab-tr__numk', text: `${cur} 级折算` }), h('b', { text: scaled }));
          }
        }
      } else if (on) {
        numEl.append(h('span', { class: 'muted', text: '该特性无数值折算（数据待验证）' }));
      }
    }

    rowEl.append(
      h('div', { class: 'lab-tr__rowmain' },
        h('div', { class: 'lab-tr__namewrap' },
          nameEl,
          dims.length ? h('span', { class: 'lab-tr__dims' }, dims.map((d) => h('span', { class: 'lab-tr__dim', text: d }))) : '',
        ),
        h('div', {
          class: `lab-tr__eff${(rec.effectZh || '').trim() ? '' : ' is-en'}`,
          attrs: (rec.effectZh || rec.effectEn) ? { title: rec.effectZh || rec.effectEn } : undefined,
          text: rec.effectZh || rec.effectEn || '效果原文待验证',
        }),
        h('div', { class: 'lab-tr__why muted' },
          icon('target', { size: 11 }),
          h('span', { text: `适配流派：${why.slice(0, 4).join(' · ') || '维度命中较少'}` }),
          rec.recScore != null ? h('span', { class: 'lab-tr__score', text: `适配分 ${fmt.pct(rec.recScore, 1)}` }) : '',
        ),
        numEl,
      ),
      h('div', { class: 'lab-tr__step' }, minus, lvEl, plus),
    );

    rowSync.set(id, syncRow);
    syncRow();
    return rowEl;
  }

  function renderList() {
    clear(listHost);
    rowSync.clear();
    if (!gearReady()) {
      listHost.append(emptyState('info', '特性数据尚未生成',
        '需要 data/lab_gear.json（全量特性 + 维度 + 效果原文）。数据生成链产出后本面板会自动列出特性。'));
      clear(countHost);
      return;
    }
    const rows = filtered();
    clear(countHost);
    countHost.textContent = `共 ${gear.trait.length} 个特性 · 当前筛选 ${rows.length} 个 · 已装备 ${S.traitUsed()} / ${S.TRAIT_CAP}`;
    if (!rows.length) {
      listHost.append(emptyState('filter', '没有匹配的特性',
        '换个维度或者清空搜索词再试。',
        h('button', {
          class: 'btn btn--ghost btn--sm', type: 'button', text: '重置筛选',
          on: { click: () => { state.dim = ''; state.q = ''; syncQuery(); renderFilters(); renderList(); } },
        })));
      return;
    }
    for (const rec of rows) listHost.append(row(rec));
  }

  /* ---------------------- URL ---------------------- */
  function applyParams(p) {
    if (destroyed || !p) return;
    const nextDim = gear.dimensionById.has(p.tps) ? p.tps : '';
    const validPs = gear.playstyleById.has(p.ps) ? p.ps : null;
    const nextPs = validPs || state.playstyle;
    const changed = nextDim !== state.dim || nextPs !== state.playstyle;
    if (!changed) return;
    const dimChanged = nextDim !== state.dim;
    const psChanged = nextPs !== state.playstyle;
    state.dim = nextDim;
    state.playstyle = nextPs;
    if (psChanged && S.playstyleId() !== nextPs) S.setPlaystyle(nextPs);
    if (dimChanged) renderFilters();
    if (psChanged) { state.ordered = orderedTraits(); renderList(); } else if (dimChanged) renderList();
  }

  /* ---------------------- 组装 ---------------------- */
  const shell = panel('特性', {
    iconName: 'trait',
    sub: `全量特性 · 等级 0–${S.TRAIT_MAX_LEVEL} · 装备上限 ${S.TRAIT_CAP} 个`,
    flush: true,
  });
  shell.body.append(
    h('div', { class: 'lab-tr__bar' }, capHost, toolsHost),
    h('div', { class: 'lab-tr__filterbar' }, filterHost),
    countHost,
    listHost,
    h('div', { class: 'lab-note' }, icon('info', { size: 12 }),
      h('span', { text: `特性等级写进配装 meta，随具名存档一起走；数值特性会并入结果面板的防御数值。游戏规则：同时最多装备 ${S.TRAIT_CAP} 个特性、每个 ${S.TRAIT_MAX_LEVEL} 级；顺序按当前流派维度权重排序（同分按维度命中数与 id）。` })),
  );
  root.append(shell.el);

  scope.add(S.on((reason) => {
    if (reason === 'playstyle') {
      const id = S.playstyleId();
      if (id !== state.playstyle) {
        state.playstyle = id;
        state.ordered = orderedTraits();
        renderTools();
        renderList();
      }
    }
    if (reason === 'seed') { renderCap(); renderList(); }
  }));
  scope.add(store.on('build', () => {
    if (destroyed) return;
    renderCap();
    for (const fn of rowSync.values()) fn();
  }));

  /* ---------------------- 首次渲染 ---------------------- */
  renderCap();
  renderTools();
  renderFilters();
  state.ordered = orderedTraits();
  renderList();

  return {
    el: root,
    refresh: () => {
      if (destroyed) return;
      renderCap();
      renderTools();
      renderList();
    },
    applyParams,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      scope.dispose();
      rowSync.clear();
    },
  };
}

export default createTraits;
