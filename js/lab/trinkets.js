/* =============================================================================
   遗迹2 · 遗物档案 — lab/trinkets.js（v2）
   饰品组合：1 项链 + 4 戒指，按流派维度权重枚举打分（score.js / combos.js 纯模块）。
   已装备的项链/戒指默认作为「固定件」占位，其余空槽可看边际最优；组合行可写入工作台、
   可整组标记缺件；折叠区给「剩余槽位推荐」与「同槽替换」。
   URL：ps（流派）/ page（页码，1 起）/ fixed（逗号分隔的固定件 id，用于分享）。
   ========================================================================== */
import { h, clear, fmt } from '../core/dom.js';
import { icon } from '../core/icons.js';
import { store } from '../core/store.js';
import { ui } from '../core/ui.js';
import { openItemDetail } from '../components/item-detail.js';
import { createEpoch, createScope } from '../core/task.js';
import * as S from './state.js';
import { panel, emptyState, emptyLine, fold, itemMedia } from './parts.js';
import { SLOT_LABEL } from './model.js';
import { createScorer } from './score.js';
import { createComboSearch } from './combos.js';

const PAGE = 10;
const MAX_COMBOS = PAGE * 20;      // 最多保留 20 页候选，足够翻页又不让列表无限长
const RING_SLOTS = ['ring1', 'ring2', 'ring3', 'ring4'];

/** 组合内 5 件 → 槽位名（用于展示与写入） */
const PIECE_SLOTS = ['amulet', ...RING_SLOTS];

export function createTrinkets(model, deps = {}) {
  const gear = model.gear;
  const setQuery = typeof deps.setQuery === 'function' ? deps.setQuery : null;

  const root = h('div', { class: 'lab-tk' });
  const bar = h('div', { class: 'lab-tk__bar' });
  const statusEl = h('div', { class: 'lab-tk__status' });
  const listHost = h('div', { class: 'lab-tk__list' });
  const pagerHost = h('div', { class: 'lab-tk__pager' });
  const remainHost = h('div', { class: 'lab-tk__foldbody' });
  const swapHost = h('div', { class: 'lab-tk__foldbody' });

  const state = {
    playstyle: S.playstyleId(),
    page: 0,
    fixedExplicit: [],      // URL fixed 里的显式固定件（空 = 用「已装备」）
    lockEquipped: true,     // 未显式固定时，是否把已装备的项链/戒指当固定件
    combos: [],
    stats: null,
    error: '',
    computing: false,
    key: '',
    elapsed: 0,
  };

  const epoch = createEpoch();
  const scope = createScope();
  let destroyed = false;

  /* ---------------------- 评分 / 组合搜索（懒装配） ---------------------- */
  let scorer = null;
  let combo = null;
  let comboError = '';
  function ensureEngines() {
    if (combo || comboError) return;
    try {
      scorer = createScorer(gear);
      combo = createComboSearch(gear, scorer);
    } catch (err) {
      comboError = String((err && err.message) || err || '未知错误');
      console.error('[lab:trinkets] 组合搜索初始化失败', err);
    }
  }

  const gearReady = () => gear.ring.length > 0 && gear.amulet.length > 0;

  /* ---------------------- 固定件 ---------------------- */
  function kindOf(id) { try { return gear.kindOf(id); } catch { return null; } }

  function parseFixedIds(raw) {
    if (!raw) return [];
    const out = [];
    const seen = new Set();
    for (const piece of String(raw).split(',')) {
      const id = piece.trim();
      if (!id || seen.has(id)) continue;
      const kind = kindOf(id);
      if (kind !== 'amulet' && kind !== 'ring') continue;
      seen.add(id);
      out.push(id);
    }
    return out.slice(0, 5);
  }

  function equippedFixed() {
    const slots = store.build.slots();
    return {
      amulet: slots.amulet || null,
      rings: RING_SLOTS.map((s) => slots[s]).filter(Boolean),
    };
  }

  function fixedParts() {
    if (state.fixedExplicit.length) {
      const amulet = state.fixedExplicit.find((id) => kindOf(id) === 'amulet') || null;
      const rings = state.fixedExplicit.filter((id) => kindOf(id) === 'ring').slice(0, 4);
      return { amulet, rings };
    }
    if (!state.lockEquipped) return { amulet: null, rings: [] };
    return equippedFixed();
  }

  function fixedIds() {
    const f = fixedParts();
    return [f.amulet, ...f.rings].filter(Boolean);
  }

  /* ---------------------- 计算调度 ---------------------- */
  function conditionsKey() {
    const f = fixedParts();
    return [
      state.playstyle,
      f.amulet || '',
      f.rings.slice().sort().join(','),
      [...S.missingSet()].sort().join(','),
    ].join('|');
  }

  function requestCompute(force = false) {
    if (destroyed) return;
    if (!gearReady()) { renderStatus(); renderList(); renderPager(); return; }
    const key = conditionsKey();
    if (!force && key === state.key && (state.computing || state.combos.length || state.error)) return;
    state.key = key;
    state.computing = true;
    state.error = '';
    state.page = Math.min(state.page, Math.max(0, Math.ceil(state.combos.length / PAGE) - 1));
    renderStatus();
    renderList();
    const token = epoch.next();
    // 组合枚举是同步纯算术（combos.js 契约 §2.2）：推到下一帧再跑，避免面板挂载阻塞首屏。
    setTimeout(() => {
      if (destroyed || !epoch.isCurrent(token)) return;
      ensureEngines();
      if (!combo) {
        state.computing = false;
        state.error = comboError || '组合搜索模块未就绪';
        renderStatus();
        renderList();
        return;
      }
      const t0 = performance.now();
      try {
        const f = fixedParts();
        const res = combo.recommendTrinkets({
          playstyleId: state.playstyle,
          fixedAmulet: f.amulet,
          fixedRings: f.rings,
          excludeIds: [...S.missingSet()],
          limit: MAX_COMBOS,
        });
        if (res && res.error) {
          state.combos = [];
          state.stats = res.stats || null;
          state.error = String(res.error);
        } else {
          state.combos = Array.isArray(res && res.combos) ? res.combos : [];
          state.stats = (res && res.stats) || null;
          state.error = '';
        }
        state.elapsed = Math.round(performance.now() - t0);
      } catch (err) {
        state.combos = [];
        state.stats = null;
        state.error = String((err && err.message) || err || '未知错误');
        console.error('[lab:trinkets] 组合枚举失败', err);
      }
      state.computing = false;
      renderStatus();
      renderList();
      renderPager();
    }, 0);
  }

  /* ---------------------- 小件：饰品 chip ---------------------- */
  function gearChip(id, slot) {
    const g = gear.of(id);
    const zh = (g && g.zh) || model.nameOf(id) || id;
    const missing = S.isMissing(id);
    const known = !!model.itemOf(id);
    const label = slot ? `${SLOT_LABEL[slot] || slot}：${zh}` : zh;
    const body = [
      itemMedia(model.iconOf(id), { size: 20 }),
      h('span', { class: 'lab-tk__chipname', text: zh }),
      missing ? h('span', { class: 'badge badge--low', text: '缺件' }) : '',
    ];
    const attrs = { title: `${label}${missing ? '（已标记缺件）' : ''}` };
    if (known) {
      return h('button', {
        class: `lab-tk__chip lab-tk__chip--btn${missing ? ' is-missing' : ''}`, type: 'button', attrs,
        on: { click: () => openItemDetail(id, { from: 'lab' }) },
      }, ...body);
    }
    return h('span', { class: `lab-tk__chip${missing ? ' is-missing' : ''}`, attrs }, ...body);
  }

  /* ---------------------- 流派 / 固定条 ---------------------- */
  function choosePlaystyle(id) {
    if (id === state.playstyle) return;
    state.playstyle = id;
    state.page = 0;
    if (S.playstyleId() !== id) S.setPlaystyle(id);
    syncQuery();
    renderBar();
    requestCompute(true);
  }

  function syncQuery(extra = {}) {
    if (!setQuery) return;
    setQuery({
      ps: state.playstyle === 'general' ? '' : state.playstyle,
      page: state.page === 0 ? '' : String(state.page + 1),
      fixed: state.fixedExplicit.join(','),
      ...extra,
    });
  }

  function renderBar() {
    clear(bar);
    // 流派：9 个 chip（与其它面板共享 meta.playstyle）
    const psWrap = h('div', { class: 'lab-tk__ps' },
      h('span', { class: 'lab-tk__pslabel' }, icon('target', { size: 12 }), h('span', { text: '流派' })),
    );
    for (const p of gear.playstyles) {
      psWrap.append(h('button', {
        class: `chip chip--sm${state.playstyle === p.id ? ' is-on' : ''}`,
        type: 'button',
        attrs: p.desc ? { title: p.desc } : undefined,
        on: { click: () => choosePlaystyle(p.id) },
      }, h('span', { text: p.zh })));
    }
    if (!gear.playstyles.length) {
      psWrap.append(h('span', { class: 'muted', attrs: { style: 'font-size:11.5px' }, text: '流派表尚未载入' }));
    }
    bar.append(psWrap);

    // 固定件状态
    const f = fixedParts();
    const fixedList = [f.amulet, ...f.rings].filter(Boolean);
    const fixedWrap = h('div', { class: 'lab-tk__fixed' },
      h('span', { class: 'lab-tk__pslabel' }, icon('pin', { size: 12 }), h('span', { text: '固定件' })),
      fixedList.length
        ? fixedList.map((id) => {
          const g = gear.of(id);
          const zh = (g && g.zh) || model.nameOf(id) || id;
          const slot = PIECE_SLOTS[fixedList.indexOf(id)] || null;
          return h('span', { class: 'lab-tk__fixedchip', attrs: { title: `${slot ? `${SLOT_LABEL[slot] || slot}：` : ''}${zh}` } },
            h('span', { text: zh }));
        })
        : h('span', { class: 'muted', attrs: { style: 'font-size:11.5px' }, text: '无（全部槽位自由组合）' }),
    );
    if (state.fixedExplicit.length) {
      fixedWrap.append(h('button', {
        class: 'btn btn--quiet btn--sm', type: 'button', attrs: { title: '取消 URL 里的固定件，改用工作台已装备的饰品' },
        on: { click: () => { state.fixedExplicit = []; syncQuery(); renderBar(); requestCompute(true); } },
      }, icon('x', { size: 12 }), h('span', { text: '清除分享固定' })));
    } else if (fixedList.length) {
      fixedWrap.append(h('button', {
        class: 'btn btn--quiet btn--sm', type: 'button', attrs: { title: '不固定已装备的饰品，从全部候选里重新组合' },
        on: { click: () => { state.lockEquipped = false; renderBar(); requestCompute(true); } },
      }, icon('swap', { size: 12 }), h('span', { text: '不固定已装备' })));
    } else if (!state.lockEquipped) {
      fixedWrap.append(h('button', {
        class: 'btn btn--quiet btn--sm', type: 'button',
        on: { click: () => { state.lockEquipped = true; renderBar(); requestCompute(true); } },
      }, icon('pin', { size: 12 }), h('span', { text: '固定已装备' })));
    }

    const missing = S.missingCount();
    if (missing) {
      fixedWrap.append(h('span', { class: 'chip chip--sm is-on', attrs: { title: '缺件不参与组合候选' } },
        icon('x-circle', { size: 12 }), h('span', { text: `缺件 ${missing}` })));
    }
    bar.append(fixedWrap);
  }

  /* ---------------------- 状态行 ---------------------- */
  function renderStatus() {
    clear(statusEl);
    if (!gearReady()) {
      statusEl.append(h('span', { class: 'muted', text: '等待装备目录（data/lab_gear.json）…' }));
      return;
    }
    if (state.computing) {
      statusEl.append(icon('refresh', { size: 12 }), h('span', { text: '正在枚举 1 项链 + 4 戒指的组合…' }));
      return;
    }
    if (state.error) {
      statusEl.append(icon('warning', { size: 12 }), h('span', { class: 'lab-tk__err', text: `组合计算未完成：${state.error}` }));
      return;
    }
    const st = state.stats || {};
    const ps = gear.playstyleById.get(state.playstyle);
    const fixedCount = fixedIds().length;
    statusEl.append(
      h('span', { class: 'badge badge--gold', text: `流派：${(ps && ps.zh) || state.playstyle}` }),
      h('span', { text: `展示前 ${fmt.num(state.combos.length)} 组` }),
      st.ringPool != null ? h('span', { text: `戒指候选 ${fmt.num(st.ringPool)} 件` }) : '',
      st.amuletPool != null ? h('span', { text: `项链候选 ${fmt.num(st.amuletPool)} 件` }) : '',
      st.evaluated != null ? h('span', { text: `已评估 ${fmt.num(st.evaluated)} 组` }) : '',
      h('span', { text: `用时 ${state.elapsed} 毫秒` }),
      fixedCount >= 5
        ? h('span', { class: 'lab-tk__rule', text: '5 件都已固定（来自工作台已装备）：组合列表只剩当前这一套。想看更优件用下方「同槽替换」，或点顶栏「不固定已装备」重新组合。' })
        : '',
      h('span', { class: 'lab-tk__rule', text: '组合分 = 0.7 × 单件均分 + 0.3 × 维度覆盖（权重 ≥ 0.6 的 15 维中覆盖占比）；缺件已从候选池排除。' }),
    );
  }

  /** 当前流派是否存在权重 ≥ 0.6 的维度（否则「维度覆盖」无意义，显示不适用） */
  function coverageAvailable() {
    const ps = gear.playstyleById.get(state.playstyle);
    const dims = (ps && ps.dims) || {};
    return Object.values(dims).some((v) => Number(v) >= 0.6);
  }

  /* ---------------------- 组合列表 ---------------------- */
  function comboIds(c) { return [c.amulet, ...(Array.isArray(c.rings) ? c.rings : [])].filter(Boolean); }

  function writeCombo(ids) {
    const prev = store.build.slots();
    const [amulet, ...rings] = ids;
    if (amulet) store.build.set('amulet', amulet);
    RING_SLOTS.forEach((slot, i) => store.build.set(slot, rings[i] || null));
    ui.toast('已写入饰品槽：1 项链 + 4 戒指', 'ok', {
      action: {
        label: '撤销',
        fn: () => {
          store.build.set('amulet', prev.amulet || null);
          RING_SLOTS.forEach((slot) => store.build.set(slot, prev[slot] || null));
        },
      },
    });
  }

  function toggleComboMissing(ids) {
    const allMissing = ids.every((id) => S.isMissing(id));
    for (const id of ids) {
      const on = S.isMissing(id);
      if (allMissing ? on : !on) S.toggleMissing(id);
    }
    ui.toast(allMissing ? '已取消本组合的缺件标记' : '已把本组合的 5 件标为缺件', 'ok');
  }

  function comboRow(c, idx) {
    const ids = comboIds(c);
    const missingCount = ids.filter((id) => S.isMissing(id)).length;
    const covAvailable = coverageAvailable();
    return h('div', { class: 'lab-tk__row' },
      h('span', { class: 'lab-tk__rank', text: `#${idx + 1}` }),
      h('div', { class: 'lab-tk__metrics' },
        h('span', { class: 'lab-score' },
          h('span', { class: 'lab-score__k', text: '组合分' }), h('b', { text: fmt.pct(c.score, 1) })),
        h('span', { class: 'stat', attrs: { title: '5 件单件得分的平均值' } },
          icon('target', { size: 11 }),
          h('span', { class: 'stat__val', text: fmt.num(c.avg, 3) }),
          h('span', { class: 'stat__unit', text: '单件均分' })),
        h('span', {
          class: 'stat',
          attrs: { title: covAvailable ? '权重 ≥ 0.6 的维度里，被组合覆盖的比例' : '该流派的维度权重都低于 0.6，没有「高权重维度」可算覆盖' },
        },
          icon('layers', { size: 11 }),
          h('span', { class: 'stat__val', text: covAvailable ? fmt.pct(c.coverage, 0) : '—' }),
          h('span', { class: 'stat__unit', text: covAvailable ? '维度覆盖' : '覆盖不适用' })),
        missingCount ? h('span', { class: 'badge badge--low', text: `含缺件 ${missingCount}` }) : '',
      ),
      h('div', { class: 'lab-tk__why', text: (Array.isArray(c.why) ? c.why : []).join(' · ') || '维度命中较少' }),
      h('div', { class: 'lab-tk__pieces' },
        ids.map((id, i) => gearChip(id, PIECE_SLOTS[i]))),
      h('div', { class: 'lab-tk__acts' },
        h('button', {
          class: 'btn btn--ghost btn--sm', type: 'button',
          attrs: { title: '把这套 1 项链 + 4 戒指写入工作台饰品槽' },
          on: { click: () => writeCombo(ids) },
        }, icon('flask', { size: 13 }), h('span', { text: '写入饰品槽' })),
        h('button', {
          class: 'btn btn--quiet btn--sm', type: 'button',
          attrs: { title: '把这 5 件加入缺件（再次点击取消），缺件不参与后续组合候选' },
          on: { click: () => toggleComboMissing(ids) },
        }, icon('x-circle', { size: 13 }), h('span', { text: missingCount === ids.length ? '取消缺件' : '标记缺件' })),
      ),
    );
  }

  function renderList() {
    clear(listHost);
    if (!gearReady()) {
      listHost.append(emptyState('info', '装备目录尚未生成',
        '饰品组合需要 data/lab_gear.json（戒指 / 项链 / 维度 / 流派表）。数据生成链产出后本面板会自动列出组合。',
        null));
      return;
    }
    if (state.computing) { listHost.append(emptyLine('正在枚举组合…', 'refresh')); return; }
    if (state.error) { listHost.append(emptyLine('组合未生成，请放宽固定件或清空缺件后重试。', 'warning')); return; }
    if (!state.combos.length) {
      listHost.append(emptyState('filter', '没有可用组合',
        '固定件与缺件过滤后候选不足：可取消固定件、清空缺件，或换一个流派再试。',
        h('div', { class: 'lab-actions', attrs: { style: 'margin-top:10px' } },
          h('button', {
            class: 'btn btn--ghost btn--sm', type: 'button', text: '清空缺件',
            on: { click: () => { S.clearMissing(); } },
          }),
          h('button', {
            class: 'btn btn--ghost btn--sm', type: 'button', text: '不固定已装备',
            on: { click: () => { state.lockEquipped = false; renderBar(); requestCompute(true); } },
          }))));
      return;
    }
    const totalPages = Math.max(1, Math.ceil(state.combos.length / PAGE));
    if (state.page > totalPages - 1) state.page = totalPages - 1;
    const start = state.page * PAGE;
    for (let i = start; i < Math.min(start + PAGE, state.combos.length); i += 1) {
      listHost.append(comboRow(state.combos[i], i));
    }
  }

  function renderPager() {
    clear(pagerHost);
    const totalPages = Math.max(1, Math.ceil(state.combos.length / PAGE));
    if (state.combos.length <= PAGE) return;
    pagerHost.append(h('div', { class: 'lab-pager' },
      h('button', {
        class: 'btn btn--ghost btn--sm', type: 'button', disabled: state.page === 0,
        on: { click: () => goPage(state.page - 1) },
      }, icon('chevron-left', { size: 13 }), h('span', { text: '上一页' })),
      h('span', { class: 'lab-pager__info', text: `第 ${state.page + 1} / ${totalPages} 页 · 每页 ${PAGE} 组 · 展示前 ${state.combos.length} 组` }),
      h('button', {
        class: 'btn btn--ghost btn--sm', type: 'button', disabled: state.page >= totalPages - 1,
        on: { click: () => goPage(state.page + 1) },
      }, h('span', { text: '下一页' }), icon('chevron-right', { size: 13 })),
    ));
  }

  function goPage(page) {
    const totalPages = Math.max(1, Math.ceil(state.combos.length / PAGE));
    const next = Math.max(0, Math.min(totalPages - 1, page));
    if (next === state.page) return;
    state.page = next;
    syncQuery();
    renderList();
    renderPager();
  }

  /* ---------------------- 折叠区：剩余槽位推荐 ---------------------- */
  function renderRemaining() {
    clear(remainHost);
    if (!gearReady()) { remainHost.append(emptyLine('装备目录尚未载入。', 'info')); return; }
    ensureEngines();
    if (!combo) { remainHost.append(emptyLine('组合搜索模块未就绪，暂不能推荐。', 'info')); return; }
    const f = fixedParts();
    const emptySlots = [];
    if (!f.amulet) emptySlots.push('amulet');
    RING_SLOTS.forEach((slot, i) => { if (!f.rings[i]) emptySlots.push(slot); });
    if (!emptySlots.length) {
      remainHost.append(emptyLine('项链与 4 个戒指都已固定，没有空槽。', 'check-circle'));
      return;
    }
    let res = null;
    try {
      res = combo.recommendRemaining({
        playstyleId: state.playstyle,
        fixed: { amulet: f.amulet, rings: f.rings },
        emptySlots,
        excludeIds: [...S.missingSet()],
      });
    } catch (err) {
      remainHost.append(emptyLine(`推荐失败：${String((err && err.message) || err || '未知错误')}`, 'warning'));
      return;
    }
    const slots = Array.isArray(res && res.slots) ? res.slots : [];
    if (!slots.length) { remainHost.append(emptyLine('当前固定件下没有可推荐的空槽。', 'info')); return; }
    const base = res && res.base;
    if (base && base.score != null) {
      remainHost.append(h('div', { class: 'lab-note' }, icon('info', { size: 12 }),
        h('span', { text: `当前固定件基线：组合分 ${fmt.pct(base.score, 1)}（单件均分 ${fmt.num(base.avg, 3)} / 覆盖 ${fmt.pct(base.coverage, 0)}）。下表是「只补这一件」的边际增益。` })));
    }
    for (const group of slots) {
      const slotName = group.slot;
      const rows = h('div', { class: 'lab-tk__remrows' });
      for (const item of (group.items || [])) {
        const g = gear.of(item.id);
        rows.append(h('div', { class: 'lab-tk__remrow' },
          gearChip(item.id, slotName),
          h('span', { class: 'lab-tk__gain', attrs: { title: '放入该槽后组合分的边际增益' },
            text: `边际 ${item.score >= 0 ? '+' : ''}${(item.score * 100).toFixed(1)} 个百分点` }),
          h('span', { class: 'lab-tk__why muted', text: (Array.isArray(item.why) ? item.why : []).join(' · ') }),
          h('button', {
            class: 'btn btn--ghost btn--sm', type: 'button',
            attrs: { title: `把 ${(g && g.zh) || item.id} 写入 ${SLOT_LABEL[slotName] || slotName}` },
            on: { click: () => { store.build.set(slotName, item.id); ui.toast(`已写入 ${SLOT_LABEL[slotName] || slotName}：${(g && g.zh) || item.id}`, 'ok'); } },
          }, icon('flask', { size: 12 }), h('span', { text: '写入' })),
        ));
      }
      remainHost.append(h('div', { class: 'lab-tk__remgroup' },
        h('div', { class: 'lab-tk__remhead' }, icon('plus', { size: 12 }), h('span', { text: `空槽：${SLOT_LABEL[slotName] || slotName}` })),
        rows,
      ));
    }
  }

  /* ---------------------- 折叠区：同槽替换 ---------------------- */
  function renderSwap() {
    clear(swapHost);
    if (!gearReady()) { swapHost.append(emptyLine('装备目录尚未载入。', 'info')); return; }
    ensureEngines();
    if (!combo) { swapHost.append(emptyLine('组合搜索模块未就绪，暂不能推荐。', 'info')); return; }
    const cur = equippedFixed();
    if (!cur.amulet && !cur.rings.length) {
      swapHost.append(emptyLine('工作台还没有已装备的项链/戒指，先在组合行「写入饰品槽」。', 'info'));
      return;
    }
    let rows = [];
    try {
      rows = combo.recommendSwap({
        playstyleId: state.playstyle,
        current: { amulet: cur.amulet, rings: cur.rings },
        excludeIds: [...S.missingSet()],
      });
    } catch (err) {
      swapHost.append(emptyLine(`替换建议失败：${String((err && err.message) || err || '未知错误')}`, 'warning'));
      return;
    }
    if (rows && rows.error) { swapHost.append(emptyLine(String(rows.error), 'warning')); return; }
    const list = Array.isArray(rows) ? rows : [];
    if (!list.length) { swapHost.append(emptyLine('已装备的 5 件在当前流派下没有更优的同槽替代。', 'check-circle')); return; }
    for (const r of list) {
      const toG = gear.of(r.to);
      const fromG = gear.of(r.from);
      swapHost.append(h('div', { class: 'lab-tk__swaprow' },
        h('span', { class: 'lab-tk__slotname', text: SLOT_LABEL[r.slot] || r.slot }),
        h('span', { class: 'lab-tk__swapfrom muted', text: (fromG && fromG.zh) || model.nameOf(r.from) || r.from }),
        icon('arrow-right', { size: 12 }),
        gearChip(r.to),
        h('span', { class: 'lab-tk__gain', text: `组合分 +${(r.gain * 100).toFixed(1)} 个百分点` }),
        h('span', { class: 'lab-tk__why muted', text: (Array.isArray(r.why) ? r.why : []).join(' · ') }),
        h('button', {
          class: 'btn btn--ghost btn--sm', type: 'button',
          attrs: { title: `把 ${(toG && toG.zh) || r.to} 写入 ${SLOT_LABEL[r.slot] || r.slot}` },
          on: { click: () => { store.build.set(r.slot, r.to); ui.toast(`已替换 ${SLOT_LABEL[r.slot] || r.slot}`, 'ok'); } },
        }, icon('swap', { size: 12 }), h('span', { text: '替换' })),
      ));
    }
  }

  /* ---------------------- URL ---------------------- */
  function applyParams(p) {
    if (destroyed || !p) return;
    const validPs = gear.playstyleById.has(p.ps) ? p.ps : null;
    const nextPs = validPs || state.playstyle;
    const nextPage = Math.max(0, (Number(p.page) || 1) - 1);
    const nextFixed = parseFixedIds(p.fixed);
    const psChanged = nextPs !== state.playstyle;
    const fixedChanged = nextFixed.join(',') !== state.fixedExplicit.join(',');
    const pageChanged = nextPage !== state.page;
    if (!psChanged && !fixedChanged && !pageChanged) return;
    state.playstyle = nextPs;
    state.fixedExplicit = nextFixed;
    state.page = nextPage;
    if (psChanged && S.playstyleId() !== nextPs) S.setPlaystyle(nextPs);
    if (psChanged || fixedChanged) {
      renderBar();
      requestCompute(true);
    } else {
      renderList();
      renderPager();
    }
  }

  /* ---------------------- 组装 ---------------------- */
  const shell = panel('饰品组合', {
    iconName: 'gem',
    sub: '1 项链 + 4 戒指 · 按流派维度组合评分',
    flush: true,
  });
  shell.body.append(
    bar,
    h('div', { class: 'lab-tk__statusbar' }, statusEl),
    listHost,
    pagerHost,
    h('div', { class: 'lab-tk__folds' },
      fold('剩余槽位推荐', remainHost, { sub: '已装备固定，对空槽给前 5' }),
      fold('同槽替换', swapHost, { sub: '对已装备的 5 件给更优替代' }),
    ),
    h('div', { class: 'lab-note' }, icon('info', { size: 12 }),
      h('span', { text: '组合分与维度分来自本地纯计算模块（同一口径比较，不是游戏内精确数值）；戒指不可重复，项链与戒指不混淆。缺件默认不参与候选，可在组合行整组标记。' })),
  );
  root.append(shell.el);

  // 折叠区按需计算（打开时才枚举，避免每次切面板都多跑一次组合搜索）
  const foldEls = root.querySelectorAll('.lab-fold');
  const remainFold = foldEls[0];
  const swapFold = foldEls[1];
  if (remainFold) remainFold.addEventListener('toggle', () => { if (remainFold.open) renderRemaining(); });
  if (swapFold) swapFold.addEventListener('toggle', () => { if (swapFold.open) renderSwap(); });

  scope.add(S.on((reason) => {
    if (reason === 'playstyle') {
      const id = S.playstyleId();
      if (id !== state.playstyle) {
        state.playstyle = id;
        state.page = 0;
        renderBar();
        requestCompute(true);
      }
      return;
    }
    if (reason === 'missing') requestCompute();
  }));
  scope.add(store.on('build', () => requestCompute()));

  const refresh = () => {
    if (destroyed) return;
    renderBar();
    renderStatus();
    renderList();
    renderPager();
  };

  refresh();
  requestCompute();

  return {
    el: root,
    refresh,
    applyParams,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      epoch.invalidate();
      scope.dispose();
    },
  };
}

export default createTrinkets;
