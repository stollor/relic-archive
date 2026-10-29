/* =============================================================================
   遗迹2 · 遗物档案 — lab/wb-cat-traits.js（装配台：特性）
   全量特性表（43 条，顺序 = 当前流派 fit.recommendTraits 的契合排序）：
   名称 / 效果（带每级数值的按当前等级折算）/ 维度标签 / 0–10 等级步进器 / 移除。
   顶部：已用 X/10 徽章 + 筛选（全部 / 已启用 / 防御向）+ 搜索 + 清空（二次确认）。
   右侧推荐：fit.recommendTraits 前 8 + 「一键填满推荐 10 条」。
   ========================================================================== */
import { h, clear, fmt } from '../core/dom.js';
import { icon } from '../core/icons.js';
import { effectText } from './text.js';
import { createScorer } from './score.js';
import { createFit } from './fit.js';
import {
  CAT_BY_ID, catShell, catSection, noteLine, recCard, recList, tag, iconAct, stepper, emptyTab,
} from './wb-parts.js';

const DEF_DIMS = new Set(['armor', 'health', 'heal', 'stamina']);
const FILTERS = [
  { id: 'all', zh: '全部', title: '全部特性，按当前流派的契合度排序' },
  { id: 'on', zh: '已启用', title: '只看等级 > 0 的已启用特性' },
  { id: 'def', zh: '防御向', title: '只看带护甲 / 生命 / 治疗 / 体力维度的特性' },
];
const REC_COUNT = 8;
const CAT = CAT_BY_ID.get('traits') || { zh: '特性', sub: '', icon: 'trait' };
const BTN = 'btn btn--ghost btn--sm';

export function createTraitsTab(ctx) {
  const { model, S, ui } = ctx;
  const gear = model.gear;
  const allTraits = () => gear.all('trait');
  const state = { filter: 'all', q: '' };
  let destroyed = false;
  let scorer = null;
  let fit = null;
  let engineError = '';

  function ensureEngines() {
    if (fit || engineError) return;
    try { scorer = createScorer(gear); fit = createFit(model, scorer); }
    catch (err) { engineError = String((err && err.message) || err || '未知错误'); }
  }

  const levelOf = (id) => S.traitLevels()[id] || 0;
  const psZh = () => { const p = gear.playstyleById.get(S.playstyleId()); return (p && p.zh) || S.playstyleId(); };
  const perLevelOf = (t) => {
    const per = t.perLevel || (t.numeric && t.numeric.effect_per_level);
    return per && typeof per === 'object' ? per : null;
  };
  function scaleEffect(eff, factor) {
    if (!eff || typeof eff !== 'object') return eff;
    const out = {};
    for (const [k, v] of Object.entries(eff)) out[k] = typeof v === 'number' ? v * factor : (v && typeof v === 'object' ? scaleEffect(v, factor) : v);
    return out;
  }
  /** 效果句：带每级数值的按当前等级折算；否则用中文效果原文；都没有标「待验证」 */
  function effectAt(t, lv) {
    const per = perLevelOf(t);
    if (per) {
      const perText = effectText(per);
      if (perText) {
        if (lv > 0) { const scaled = effectText(scaleEffect(per, lv)); if (scaled) return `${scaled}（${lv} 级折算）`; }
        return `每级 ${perText}`;
      }
    }
    return t.effectZh || effectText(t.effect || (t.numeric && t.numeric.effect)) || '效果待验证';
  }
  function dimsOf(t, n = 3) {
    try {
      const top = scorer ? scorer.topDims(t.dims || {}, n) : [];
      if (top.length) return top.map((d) => d.zh || gear.dimensionZh(d.id));
    } catch { /* 回落维度表 */ }
    return Object.entries(t.dims || {}).filter(([, v]) => Number(v) > 0)
      .sort((a, b) => b[1] - a[1]).slice(0, n).map(([id]) => gear.dimensionZh(id));
  }

  /** 写等级：超上限（第 11 个特性）时给可见提示，不静默失败 */
  function setLevel(id, lv) {
    const res = S.setTraitLevel(id, lv);
    if (res && res.ok === false) {
      ui.toast(res.reason === 'cap'
        ? `特性最多同时装备 ${S.TRAIT_CAP} 个：先把其它特性降到 0 级，再启用新的。`
        : '该特性等级无法设置。', 'warn');
      return false;
    }
    return true;
  }

  /* ------------------------- 排序（按流派契合） ------------------------- */
  let orderedPs = null;
  let orderedList = [];
  function orderedTraits() {
    ensureEngines();
    const ps = S.playstyleId();
    if (orderedPs === ps) return orderedList;
    const all = allTraits();
    const byId = new Map(all.map((t) => [t.id, t]));
    let list = all;
    if (fit) {
      try {
        const recs = fit.recommendTraits({ playstyleId: ps, limit: all.length });
        if (Array.isArray(recs) && recs.length) {
          list = recs.map((r) => ({ ...(byId.get(r.id) || { id: r.id, zh: r.zh }), why: Array.isArray(r.why) ? r.why : [], score: r.score }));
        }
      } catch { /* 回落目录顺序 */ }
    }
    orderedPs = ps;
    orderedList = list;
    return list;
  }

  /* ------------------------- 行 ------------------------- */
  function traitRow(t) {
    const id = t.id;
    const lv = levelOf(id);
    const name = t.zh || model.nameOf(id) || id;
    const max = Number(t.maxLevel) > 0 ? Number(t.maxLevel) : S.TRAIT_MAX_LEVEL;
    const dims = dimsOf(t);
    return h('div', { class: 'lab-trrow', dataset: { id } },
      h('div', { class: 'lab-trrow__name' },
        h('span', { text: name }),
        t.en ? h('span', { class: 'lab-crow__en', text: t.en }) : '',
        lv > 0 ? h('span', { class: 'badge badge--gold', text: '已启用' }) : ''),
      h('div', { class: 'lab-trrow__eff', attrs: { title: t.effectZh || '效果原文待验证' }, text: effectAt(t, lv) }),
      h('div', { class: 'lab-trrow__dims' }, dims.length ? dims.map((d) => tag(d)) : tag('维度待验证')),
      h('div', { class: 'lab-trrow__ctrl' },
        stepper({ value: lv, aria: name, max, onDec: () => setLevel(id, lv - 1), onInc: () => setLevel(id, lv + 1) }),
        iconAct('x', `移除特性「${name}」（等级清零）`, () => {
          if (setLevel(id, 0)) ui.toast(`已移除特性：${name}`, 'ok');
        }, { danger: true })),
    );
  }

  /* ------------------------- 顶栏：徽章 / 筛选 / 搜索 / 清空 ------------------------- */
  const shell = catShell({
    title: CAT.zh,
    sub: CAT.sub || `上限 ${S.TRAIT_CAP} 个 · 每个 0–${S.TRAIT_MAX_LEVEL} 级`,
    iconName: CAT.icon,
  });
  const capBadge = h('span', { class: 'badge badge--gold', attrs: { title: `游戏规则：最多同时装备 ${S.TRAIT_CAP} 个特性，每个最多 ${S.TRAIT_MAX_LEVEL} 级` } });
  shell.acts.append(
    capBadge,
    h('button', {
      class: 'btn btn--quiet btn--sm', type: 'button', attrs: { title: '把所有特性等级清零（具名存档不受影响）' },
      on: { click: () => clearAll() },
    }, icon('rotate-ccw', { size: 13 }), h('span', { text: '清空特性' })),
  );

  const chipsHost = h('div', { class: 'lab-chips' });
  const searchInput = h('input', {
    class: 'input', type: 'search', value: state.q, style: { flex: '1 1 180px', maxWidth: '260px' },
    attrs: { placeholder: '搜索特性名 / 英文 / 效果', 'aria-label': '搜索特性' },
    on: { input: (e) => { state.q = e.target.value || ''; renderRows(); } },
  });
  const countEl = h('span', { class: 'muted' });
  const filtersBar = h('div', { class: 'lab-catsub__head' }, chipsHost, searchInput, countEl);
  const listHost = h('div');
  const defCount = () => allTraits().filter((t) => Object.keys(t.dims || {}).some((k) => DEF_DIMS.has(k) && Number(t.dims[k]) > 0)).length;
  const counts = () => ({ all: allTraits().length, on: S.traitUsed(), def: defCount() });

  function renderFilters() {
    clear(chipsHost);
    const n = counts();
    for (const f of FILTERS) {
      chipsHost.append(h('button', {
        class: `chip chip--sm${state.filter === f.id ? ' is-on' : ''}`, type: 'button',
        attrs: { title: f.title, 'aria-pressed': state.filter === f.id ? 'true' : 'false' },
        on: { click: () => { if (state.filter === f.id) return; state.filter = f.id; renderFilters(); renderRows(); } },
      }, h('span', { text: f.zh }), h('span', { class: 'chip__count', text: String(n[f.id]) })));
    }
    const used = S.traitUsed();
    capBadge.className = `badge ${used >= S.TRAIT_CAP ? 'badge--low' : 'badge--gold'}`;
    capBadge.textContent = `已用 ${used} / ${S.TRAIT_CAP}`;
    countEl.textContent = `共 ${n.all} 个特性 · 当前筛出 ${state.filter === 'all' ? n.all : state.filter === 'on' ? n.on : n.def} 个`;
  }

  function matches(t) {
    if (state.filter === 'on' && levelOf(t.id) <= 0) return false;
    if (state.filter === 'def') {
      const dims = t.dims || {};
      if (!Object.keys(dims).some((k) => DEF_DIMS.has(k) && Number(dims[k]) > 0)) return false;
    }
    const q = state.q.trim().toLowerCase();
    if (!q) return true;
    return `${t.zh || ''} ${t.en || ''} ${t.effectZh || ''} ${t.effectEn || ''}`.toLowerCase().includes(q);
  }

  function renderRows() {
    clear(listHost);
    if (!allTraits().length) { listHost.append(emptyTab('特性数据（lab_gear.json）尚未生成，暂不能列出。')); return; }
    const rows = orderedTraits().filter(matches);
    if (!rows.length) {
      listHost.append(emptyTab(state.filter === 'on' ? '还没有启用任何特性：用行内步进器把特性升到 1 级即可启用。' : '没有匹配的特性：换个筛选或清空搜索词。'));
      return;
    }
    for (const t of rows) listHost.append(traitRow(t));
  }

  async function clearAll() {
    if (!S.traitUsed()) { ui.toast('当前没有启用任何特性', 'info'); return; }
    const ok = await ui.confirm({ title: '清空全部特性？', body: '把所有特性等级清零（具名存档不受影响）。', ok: '清空', danger: true });
    if (!ok) return;
    S.clearTraits();
    ui.toast('已清空全部特性等级', 'ok');
  }

  /* ------------------------- 推荐 ------------------------- */
  function fillTop() {
    ensureEngines();
    if (!fit) { ui.toast(`推荐模块未就绪：${engineError || '未知错误'}`, 'warn'); return; }
    let list = [];
    try { list = fit.recommendTraits({ playstyleId: S.playstyleId(), limit: S.TRAIT_CAP }) || []; } catch { list = []; }
    if (!list.length) { ui.toast('没有可用的推荐特性', 'warn'); return; }
    let n = 0;
    for (const row of list) {
      const res = S.setTraitLevel(row.id, S.TRAIT_MAX_LEVEL);
      if (res && res.ok === false) {
        if (res.reason === 'cap') { ui.toast(`已写入 ${n} 个特性；特性上限 ${S.TRAIT_CAP} 个，其余推荐未写入。`, 'warn'); return; }
        continue;
      }
      n += 1;
    }
    ui.toast(n ? `已按推荐把 ${n} 个特性设为 ${S.TRAIT_MAX_LEVEL} 级` : '没有可写入的特性', n ? 'ok' : 'info');
  }

  function renderRec(host) {
    if (!host) return;
    clear(host);
    ensureEngines();
    if (!allTraits().length) { host.append(emptyTab('特性数据尚未载入，暂不能推荐。')); return; }
    if (!fit) { host.append(emptyTab(`推荐模块未就绪：${engineError || '未知错误'}`)); return; }
    let list = [];
    try { list = fit.recommendTraits({ playstyleId: S.playstyleId(), limit: REC_COUNT }) || []; } catch { list = []; }
    if (!list.length) { host.append(emptyTab('当前流派下没有可推荐的特性。')); return; }
    const cards = list.map((row) => {
      const t = gear.of(row.id) || { id: row.id, zh: row.zh };
      const name = row.zh || t.zh || row.id;
      const full = levelOf(row.id) >= S.TRAIT_MAX_LEVEL;
      const action = full
        ? h('button', { class: 'btn btn--quiet btn--sm', type: 'button', disabled: true, text: '已满级' })
        : h('button', {
          class: BTN, type: 'button', text: '设为满级', attrs: { title: `把「${name}」设为 ${S.TRAIT_MAX_LEVEL} 级` },
          on: { click: () => {
            const res = S.setTraitLevel(row.id, S.TRAIT_MAX_LEVEL);
            if (res && res.ok === false) ui.toast(res.reason === 'cap' ? `特性上限 ${S.TRAIT_CAP} 个：先移除一个已启用特性。` : '该特性等级无法设置。', 'warn');
            else ui.toast(`已把「${name}」设为 ${S.TRAIT_MAX_LEVEL} 级`, 'ok');
          } },
        });
      const why = Array.isArray(row.why) && row.why.length ? row.why.slice(0, 3) : dimsOf(t);
      return recCard({
        title: name,
        score: fmt.num(row.score, 2),
        tags: why,
        lines: [effectAt(t, S.TRAIT_MAX_LEVEL)],
        actions: [action],
      });
    });
    host.append(catSection('按流派推荐特性', [recList(cards)], { sub: `前 ${cards.length} · 契合近似小分`, tools: [
      h('button', {
        class: BTN, type: 'button',
        attrs: { title: `按推荐顺序把前 ${S.TRAIT_CAP} 个特性设为 ${S.TRAIT_MAX_LEVEL} 级（超出上限时停止并提示）` },
        on: { click: () => fillTop() },
      }, icon('sparkle', { size: 13 }), h('span', { text: `一键填满推荐 ${S.TRAIT_CAP} 条` })),
    ] }));
    host.append(h('div', { class: 'lab-recn__foot muted' },
      h('span', { text: `口径：契合小分 = 对「${psZh()}」流派的 0–1 近似比较值（同分按维度命中数与 id 排序），不是游戏内精确数值；带每级数值的特性按满级折算展示。` })));
  }

  /* ------------------------- 组装 / 刷新 ------------------------- */
  function render() {
    if (destroyed) return;
    renderFilters();
    renderRows();
    clear(shell.foot);
    const numericCount = allTraits().filter(perLevelOf).length;
    shell.foot.append(
      noteLine(`游戏上限：同时装备 ${S.TRAIT_CAP} 个特性，每个 ${S.TRAIT_MAX_LEVEL} 级；等级 0 视为未装备。`),
      noteLine(`带每级数值的特性（当前 ${numericCount} 个）按当前等级折算后并入下方「本套效果」的防御合计；其余特性只记录，不参与数值计算。`),
      noteLine('行顺序 = 当前流派的契合度排序；维度标签来自 filter_tags / 关键词映射（近似排序），不是游戏内精确数值。'),
    );
  }

  shell.body.append(filtersBar, listHost);
  render();
  return {
    el: shell.el,
    refresh: render,
    renderRec,
    destroy() { destroyed = true; },
  };
}

export default createTraitsTab;
