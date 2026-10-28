/* =============================================================================
   遗迹2 · 遗物档案 — lab/recommend.js（v2）
   推荐方案：基于当前工作台设置（特性 / 职业专长 / 碎片 / 消耗品 / 饰品 + 场景 + 档位目标）
   实时穷举 812,224 组合，取「场景分前 300 名候选」，再按用户选择的指标排序。
   ========================================================================== */
import { h, clear, fmt } from '../core/dom.js';
import { icon } from '../core/icons.js';
import { store } from '../core/store.js';
import { ui } from '../core/ui.js';
import { openItemDetail } from '../components/item-detail.js';
import { createEpoch, createScope, createTaskRunner } from '../core/task.js';
import * as S from './state.js';
import { panel, emptyState, emptyLine, miniPiece, classBadge, hardBadge, writeArmorBtn } from './parts.js';

const PAGE = 10;
const TOP = 300;

export const SORTS = [
  { id: 'score', zh: '场景分（默认）', desc: true },
  { id: 'phys', zh: '物理总减伤', desc: true },
  { id: 'worst', zh: '最坏情况减伤', desc: true },
  { id: 'armor', zh: '护甲值', desc: true },
  { id: 'ehp', zh: '有效生命 EHP', desc: true },
  { id: 'weight', zh: '负重（升序）', desc: false },
];
const SORT_BY_ID = new Map(SORTS.map((s) => [s.id, s]));

const DIFFS = [
  { id: '', zh: '全部' },
  { id: 'easy', zh: '全易获取' },
  { id: 'low1', zh: '难点≤1' },
];

function hardCount(model, ids) {
  return ids.filter((id) => {
    const p = model.pieceById.get(id);
    return !!(p && (p.dobt || []).some((x) => x === '头目掉落' || x === 'Boss' || x === '解谜' || x === '随机'));
  }).length;
}

function metricValue(entry, sortId) {
  const st = entry.stats;
  switch (sortId) {
    case 'phys': return st.totals.physical;
    case 'worst': return st.worst;
    case 'armor': return st.armor;
    case 'ehp': return st.ehp;
    case 'weight': return st.weight;
    default: return st.score;
  }
}

export function createRecommend(model, { params = {}, setQuery = null, active = false } = {}) {
  const E = model.engine;
  const root = h('div', { class: 'lab-rec' });
  const listHost = h('div', { class: 'lab-rec__list' });
  const statusEl = h('div', { class: 'lab-rec__status muted' });
  const pagerHost = h('div', { class: 'lab-rec__pager' });
  const toolbar = h('div', { class: 'lab-rec__bar' });

  const state = {
    sort: SORT_BY_ID.has(params.sort) ? params.sort : 'score',
    ownedOnly: params.ownedOnly === '1',
    hideMissing: params.hideMissing !== '0',
    diff: ['easy', 'low1'].includes(params.diff) ? params.diff : '',
    page: Math.max(0, (Number(params.page) || 1) - 1),
    pendingPage: null,
    running: false,
    dirty: true,
    error: null,
    elapsed: 0,
    candidates: [],
    result: null,
  };

  function syncQuery(patch) {
    if (!setQuery) return;
    setQuery({
      sort: state.sort === 'score' ? '' : state.sort,
      ownedOnly: state.ownedOnly ? '1' : '',
      hideMissing: state.hideMissing ? '' : '0',
      diff: state.diff,
      page: state.page === 0 ? '' : String(state.page + 1),
      ...patch,
    });
  }

  /* --------------------------- 穷举（版本化调度） --------------------------- */
  // 分帧穷举本身不变；调度交给 core/task.js：
  //   · 条件一变就 start()，runner.run 会先取消上一次分帧并让其代际失效；
  //   · 完成/失败回调只在「仍是当前代际」时落地，过期任务不写 state、不碰 DOM；
  //   · destroy() → epoch.invalidate + runner.cancel + cleanup.dispose，之后的回调全部短路。
  const epoch = createEpoch();
  const cleanup = createScope();
  let destroyed = false;
  const runner = createTaskRunner({
    onError: (err) => { console.error('[lab:recommend]', err); if (!destroyed) failRun(err); },
  });

  function requestRun() {
    if (destroyed) return;
    if (active) start();
    else state.dirty = true;
  }

  function failRun(err) {
    if (destroyed) return;
    epoch.invalidate();
    state.running = false;
    state.dirty = true;
    state.error = String((err && err.message) || err || '未知错误');
    state.result = null;
    state.candidates = [];
    renderBar();
    renderStatus();
    renderList();
  }

  function start() {
    if (destroyed) return;
    state.running = true;
    state.dirty = false;
    state.error = null;
    state.result = null;
    state.candidates = [];
    renderBar();   // 运行中禁用「重新穷举」，结束后恢复
    renderStatus();
    renderList();
    const token = epoch.next();
    let en = null;
    let t0 = 0;
    try {
      en = E.createEnumeration({
        picks: S.workbenchPicks(model),
        scenarioId: S.scenarioId(),
        classTarget: S.classTarget(),
        exclude: state.hideMissing ? S.missingSet() : null,
        owned: state.ownedOnly ? S.ownedSet() : null,
        top: TOP,
      });
      t0 = performance.now();
    } catch (err) {
      failRun(err);
      return;
    }
    const isCurrent = () => !destroyed && epoch.isCurrent(token);
    const stepFrame = () => {
      if (!isCurrent()) return false;   // 已被新条件取代 / 已取消：不再推进
      let more;
      try {
        more = en.step(8);
      } catch (err) {
        failRun(err);
        return false;
      }
      if (!isCurrent()) return false;
      if (more) {
        statusEl.textContent = `穷举中 ${Math.round(en.progress() * 100)}%…`;
        return true;
      }
      return false;
    };
    try {
      runner.run(stepFrame, () => {
        if (!isCurrent()) return;   // 过期任务的完成回调不落地（防旧结果覆盖新条件）
        const res = en.result();
        state.elapsed = Math.round(performance.now() - t0);
        state.candidates = res.top.map((entry) => ({ ...entry, hard: hardCount(model, entry.ids) }));
        state.result = {
          feasible: res.feasible, total: res.total, poolSize: res.poolSize,
          excluded: res.excluded, pools: res.pools, classTarget: res.classTarget,
        };
        state.running = false;
        if (state.pendingPage != null) {
          state.page = state.pendingPage;
          state.pendingPage = null;
        } else {
          state.page = 0;
        }
        syncQuery({ page: state.page === 0 ? '' : String(state.page + 1) });
        renderBar();
        renderStatus();
        renderList();
      });
    } catch (err) {
      failRun(err);
    }
  }

  /* --------------------------- 排序 / 过滤 --------------------------- */
  function sorted() {
    const sort = SORT_BY_ID.get(state.sort) || SORTS[0];
    const arr = state.candidates.slice();
    arr.sort((a, b) => {
      const va = metricValue(a, state.sort);
      const vb = metricValue(b, state.sort);
      const d = sort.desc ? (vb - va) : (va - vb);
      if (Math.abs(d) > 1e-9) return d;
      if (b.stats.score !== a.stats.score) return b.stats.score - a.stats.score;
      return b.stats.armor - a.stats.armor;
    });
    return arr;
  }

  function filtered() {
    let rows = sorted();
    if (state.diff === 'easy') rows = rows.filter((r) => r.hard === 0);
    else if (state.diff === 'low1') rows = rows.filter((r) => r.hard <= 1);
    return rows;
  }

  /* --------------------------- 渲染 --------------------------- */
  function sortSelect() {
    const sel = h('select', { class: 'select', attrs: { 'aria-label': '推荐排序' } },
      SORTS.map((s) => h('option', { value: s.id, text: s.zh })));
    sel.value = state.sort;
    sel.addEventListener('change', () => {
      state.sort = sel.value;
      state.page = 0;
      syncQuery({ sort: state.sort === 'score' ? '' : state.sort, page: '' });
      renderStatus();
      renderList();
    });
    return h('div', { class: 'field lab-field--sm' }, h('label', { class: 'field__label', text: '排序（前 300 候选内）' }), sel);
  }

  function diffSeg() {
    const seg = h('div', { class: 'seg', attrs: { role: 'group', 'aria-label': '获取难度筛选' } });
    for (const d of DIFFS) {
      seg.append(h('button', {
        class: `seg__btn${state.diff === d.id ? ' is-on' : ''}`, type: 'button', text: d.zh,
        on: {
          click: () => {
            state.diff = d.id; state.page = 0;
            syncQuery({ diff: d.id, page: '' });
            renderBar(); renderStatus(); renderList();
          },
        },
      }));
    }
    return h('div', { class: 'field lab-field--sm' }, h('label', { class: 'field__label', text: '获取难度' }), seg);
  }

  function switchEl(label, checked, onChange, title = '') {
    return h('label', { class: 'switch', attrs: title ? { title } : {} },
      h('input', { type: 'checkbox', checked, on: { change: (e) => onChange(e.target.checked) } }),
      h('span', { class: 'switch__track' }),
      h('span', { text: label }),
    );
  }

  function renderBar() {
    clear(toolbar);
    const owned = S.ownedCount();
    toolbar.append(
      h('div', { class: 'lab-rec__barrow' },
        sortSelect(),
        diffSeg(),
        h('div', { class: 'grow' }),
        switchEl('仅用我已拥有', state.ownedOnly, (v) => {
          state.ownedOnly = v; state.page = 0; syncQuery({ ownedOnly: v ? '1' : '', page: '' });
          requestRun();
        }, '可用池只保留已拥有护甲'),
        switchEl('隐藏含缺件', state.hideMissing, (v) => {
          state.hideMissing = v; state.page = 0; syncQuery({ hideMissing: v ? '' : '0', page: '' });
          requestRun();
        }, '开启时把缺件从可用池排除；关闭时保留但标记'),
        h('button', {
          class: 'btn btn--ghost btn--sm', type: 'button',
          disabled: state.running,
          on: { click: () => start() },
        }, icon('refresh', { size: 13 }), h('span', { text: '重新穷举' })),
      ),
    );
  }

  function renderStatus() {
    clear(statusEl);
    if (state.running) { statusEl.textContent = '穷举中…'; return; }
    if (state.error) { statusEl.textContent = `穷举失败：${state.error}。修改设置或点「重新穷举」可重试。`; return; }
    const r = state.result;
    if (!r) { statusEl.textContent = '点「重新穷举」或在下方修改设置后自动重算。'; return; }
    const sort = SORT_BY_ID.get(state.sort) || SORTS[0];
    statusEl.append(
      h('span', { class: 'badge badge--gold', text: `候选池：场景分前 ${Math.min(TOP, state.candidates.length)}` }),
      h('span', { text: `穷举 ${fmt.num(r.feasible)} / ${fmt.num(r.total)} 组合` }),
      h('span', { text: `用时 ${state.elapsed} 毫秒` }),
      h('span', { text: `可用池 ${r.poolSize} 件` }),
      r.excluded ? h('span', { class: 'badge badge--low', text: `已排除 ${r.excluded} 件` }) : '',
      h('span', { text: `当前排序：${sort.zh}` }),
      h('span', { class: 'lab-rec__rule', text: '候选池规则：枚举按场景分取前 300，再按所选指标排序；「最坏情况」已在候选内计算。' }),
    );
  }

  function row(entry, idx) {
    const st = entry.stats;
    const missingCount = entry.ids.filter((id) => S.isMissing(id)).length;
    const drSame = Math.abs(st.adr - st.totals.physical) < 0.0005;
    return h('div', { class: 'lab-rec__row' },
      h('span', { class: 'lab-rec__rank', text: `#${idx + 1}` }),
      h('div', { class: 'lab-rec__nums' },
        h('span', { class: 'lab-score' }, h('span', { class: 'lab-score__k', text: '场景分' }), h('b', { text: fmt.pct(st.score, 1) })),
        h('span', { class: 'stat' }, icon('armor', { size: 11 }), h('span', { class: 'stat__val', text: fmt.num(st.armor, 1) }), h('span', { class: 'stat__unit', text: '护甲' })),
        drSame
          ? h('span', { class: 'stat' }, icon('shield', { size: 11 }), h('span', { class: 'stat__val', text: fmt.pct(st.totals.physical, 1) }), h('span', { class: 'stat__unit', text: '总减伤' }))
          : [
            h('span', { class: 'stat' }, icon('shield', { size: 11 }), h('span', { class: 'stat__val', text: fmt.pct(st.adr, 1) }), h('span', { class: 'stat__unit', text: '护甲减伤' })),
            h('span', { class: 'stat' }, icon('phys', { size: 11 }), h('span', { class: 'stat__val', text: fmt.pct(st.totals.physical, 1) }), h('span', { class: 'stat__unit', text: '物理总减伤' })),
          ],
        h('span', { class: 'stat' }, icon('warning', { size: 11 }), h('span', { class: 'stat__val', text: fmt.pct(st.worst, 1) }), h('span', { class: 'stat__unit', text: '最坏减伤' })),
        h('span', { class: 'stat' }, icon('weight', { size: 11 }), h('span', { class: 'stat__val', text: fmt.num(st.weight, 1) }), h('span', { class: 'stat__unit', text: '负重' })),
        classBadge(st.cls),
        h('span', { class: 'stat' }, icon('health', { size: 11 }), h('span', { class: 'stat__val', text: fmt.num(st.ehp, 1) }), h('span', { class: 'stat__unit', text: 'EHP' })),
        hardBadge(entry.hard),
        missingCount ? h('span', { class: 'badge badge--low', text: `含缺件 ${missingCount}` }) : '',
      ),
      h('div', { class: 'lab-rec__pieces' }, entry.ids.map((id) => miniPiece(model, id, {
        clickable: true,
        onClick: (pc) => openItemDetail(pc.id, { route: false, from: 'lab' }),
      }))),
      writeArmorBtn(() => {
        S.writeArmor(entry.ids);
        ui.toast('已写入四件护甲', 'ok');
      }),
    );
  }

  function renderList() {
    clear(listHost);
    if (state.running) { listHost.append(emptyLine('正在穷举 812,224 组四件护甲…', 'refresh')); return; }
    if (state.error) { listHost.append(emptyLine('穷举失败，未生成候选。修改设置或点「重新穷举」重试。', 'warning')); return; }
    const rows = filtered();
    if (!state.candidates.length) {
      const r = state.result;
      const emptyPool = r && r.pools && r.pools.some((n) => n === 0);
      if (emptyPool) {
        listHost.append(emptyState('unowned', state.ownedOnly ? '「仅用我已拥有」池里某个槽位没有护甲' : '可用池里某个槽位没有护甲',
          state.ownedOnly
            ? `已拥有 ${S.ownedCount()} 件护甲，不足以凑齐一个槽位；去资料库标记已拥有，或关闭「仅用我已拥有」。`
            : '缺件太多或档位目标过严，请放宽筛选。',
          h('div', { class: 'lab-actions' },
            h('button', { class: 'btn btn--ghost btn--sm', type: 'button', text: '关闭仅用我已拥有', on: { click: () => { state.ownedOnly = false; syncQuery({ ownedOnly: '' }); start(); } } }),
            h('button', { class: 'btn btn--quiet btn--sm', type: 'button', text: '清空缺件', on: { click: () => { S.clearMissing(); start(); } } }),
          )));
      } else {
        listHost.append(emptyState('filter', '没有符合条件的候选',
          '试试放宽获取难度筛选、关闭「仅用我已拥有」或清空缺件。'));
      }
      return;
    }
    if (!rows.length) {
      listHost.append(emptyState('filter', '当前排序/筛选下没有候选',
        '试试把「获取难度」切回「全部」。'));
      return;
    }
    const totalPages = Math.max(1, Math.ceil(rows.length / PAGE));
    if (state.page > totalPages - 1) state.page = totalPages - 1;
    const start = state.page * PAGE;
    for (let i = start; i < Math.min(start + PAGE, rows.length); i += 1) listHost.append(row(rows[i], i));
    clear(pagerHost);
    pagerHost.append(h('div', { class: 'lab-pager' },
      h('button', {
        class: 'btn btn--ghost btn--sm', type: 'button', disabled: state.page === 0,
        on: { click: () => { state.page -= 1; syncQuery({ page: state.page === 0 ? '' : String(state.page + 1) }); renderList(); pagerHost.scrollIntoView({ behavior: 'auto', block: 'nearest' }); } },
      }, icon('chevron-left', { size: 13 }), h('span', { text: '上一页' })),
      h('span', { class: 'lab-pager__info', text: `第 ${state.page + 1} / ${totalPages} 页 · 每页 ${PAGE} 组 · 筛出 ${rows.length} 组` }),
      h('button', {
        class: 'btn btn--ghost btn--sm', type: 'button', disabled: state.page >= totalPages - 1,
        on: { click: () => { state.page += 1; syncQuery({ page: String(state.page + 1) }); renderList(); pagerHost.scrollIntoView({ behavior: 'auto', block: 'nearest' }); } },
      }, h('span', { text: '下一页' }), icon('chevron-right', { size: 13 })),
    ));
  }

  /* --------------------------- 外部接口 --------------------------- */
  function applyParams(p) {
    if (destroyed) return;
    const next = {
      sort: SORT_BY_ID.has(p.sort) ? p.sort : state.sort,
      ownedOnly: p.ownedOnly === '1',
      hideMissing: p.hideMissing !== '0',
      diff: ['easy', 'low1'].includes(p.diff) ? p.diff : '',
      page: Math.max(0, (Number(p.page) || 1) - 1),
    };
    const needRerun = next.ownedOnly !== state.ownedOnly || next.hideMissing !== state.hideMissing;
    const hadPageParam = p.page != null && p.page !== '';
    Object.assign(state, next);
    if ((needRerun || state.running) && hadPageParam) state.pendingPage = next.page;
    if (needRerun) { requestRun(); return; }
    renderBar();
    renderStatus();
    if (!state.running) renderList();
  }

  function activate() {
    if (!active) {
      active = true;
      if (state.dirty || !state.result) start();
    }
  }

  const panelEl = panel('推荐方案', {
    iconName: 'listchecks',
    sub: '按当前工作台设置实时穷举',
    flush: true,
    body: h('div', {}, toolbar, h('div', { class: 'lab-rec__statusbar' }, statusEl), listHost, pagerHost,
      h('div', { class: 'lab-note', attrs: { style: 'padding:0 12px 12px' } },
        icon('info', { size: 12 }),
        h('span', { text: '推荐不是预设网格，而是按你当前的职业专长 / 特性 / 碎片 / 消耗品 / 饰品 / 场景 / 档位目实时穷举。候选池 = 场景分前 300 名，再按所选指标排序；特性上限 10 个不影响候选池。' }),
      ),
    ),
  });
  root.append(panelEl);

  cleanup.add(S.on((reason) => {
    if (!['missing', 'scenario', 'class-target', 'seed'].includes(reason)) return;
    requestRun();
  }));
  let timer = 0;
  cleanup.add(() => clearTimeout(timer));
  cleanup.add(store.on('build', () => {
    clearTimeout(timer);
    timer = setTimeout(requestRun, 220);
  }));
  cleanup.add(store.on('owned', () => {
    if (active && state.ownedOnly) requestRun(); else state.dirty = true;
  }));

  renderBar();
  renderStatus();
  renderList();
  if (active) start();

  return {
    el: root,
    activate,
    applyParams,
    refresh: () => requestRun(),
    start,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      epoch.invalidate();
      runner.cancel();
      cleanup.dispose();
      state.running = false;
    },
  };
}

export default createRecommend;
