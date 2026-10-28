/* =============================================================================
   遗迹2 · 遗物档案 — lab/replace.js（v2）
   逐槽替换：保持其余三件不变，对当前四件逐槽给替代 top3（Δ场景分 / Δ护甲 / Δ负重），
   可应用 + 撤销、可标记缺件。原矩阵 C（缺件怎么办）合并进本面板提示。
   ========================================================================== */
import { h, clear, fmt } from '../core/dom.js';
import { icon } from '../core/icons.js';
import { store } from '../core/store.js';
import { ui } from '../core/ui.js';
import { openItemDetail } from '../components/item-detail.js';
import * as S from './state.js';
import { panel, emptyState, miniPiece, itemMedia } from './parts.js';

const SLOT_LABEL = { head: '头盔', body: '胸甲', legs: '腿甲', gloves: '手甲' };
const SLOT_KEYS = ['head', 'body', 'legs', 'gloves'];
const round1 = (v) => Math.round(v * 10) / 10;

export function createReplace(model, { onOpenPanel = null } = {}) {
  const E = model.engine;
  const root = h('div', { class: 'lab-replace' });
  const host = h('div', { class: 'lab-replace__body' });
  const tools = h('div', { class: 'row', attrs: { style: 'gap:6px' } });
  const nameOf = (id) => {
    const it = model.itemsById.get(id);
    if (it) return it.zh;
    const p = model.pieceById.get(id);
    return p ? p.zh : id;
  };
  const iconOf = (id) => {
    const p = model.pieceById.get(id);
    return p && p.iconUrl ? p.iconUrl : model.itemIcon(model.itemsById.get(id));
  };

  function armorIds() { return SLOT_KEYS.map((s) => store.build.get(s)); }

  function renderTools() {
    clear(tools);
    if (S.missingCount()) {
      tools.append(h('span', { class: 'chip chip--sm is-on' }, icon('x-circle', { size: 12 }), h('span', { text: `缺件 ${S.missingCount()}` })));
      tools.append(h('button', { class: 'btn btn--quiet btn--sm', type: 'button', text: '清空', on: { click: () => { S.clearMissing(); ui.toast('已清空缺件标记', 'ok'); } } }));
    }
    tools.append(h('button', {
      class: 'btn btn--ghost btn--sm', type: 'button',
      on: { click: () => onOpenPanel?.('recommend') },
    }, icon('refresh', { size: 13 }), h('span', { text: '按缺件重算最优' })));
  }

  function applyAlt(slot, alt) {
    const cur = store.build.get(slot);
    store.build.set(slot, alt.id);
    ui.toast(`${SLOT_LABEL[slot]}已换为 ${nameOf(alt.id)}`, 'ok', {
      action: { label: '撤销', fn: () => { if (cur) store.build.set(slot, cur); } },
    });
  }

  function render() {
    clear(host);
    renderTools();
    const ids = armorIds();
    const filled = ids.filter(Boolean).length;
    if (filled < 4) {
      host.append(emptyState('listchecks', '缺件怎么办？先放满四件护甲',
        '放满四件后，这里会「保持其余三件不变」逐槽给出最好的 3 个替代（Δ场景分 / Δ护甲 / Δ负重）。',
        h('div', { class: 'lab-actions', attrs: { style: 'margin-top:10px' } },
          h('button', { class: 'btn btn--primary btn--sm', type: 'button', on: { click: () => onOpenPanel?.('recommend') } },
            icon('listchecks', { size: 13 }), h('span', { text: '去推荐方案按缺件穷举' })),
        )));
      host.append(h('ul', { class: 'lab-hints', attrs: { style: 'max-width:640px;margin:0 auto' } },
        h('li', {}, h('b', { text: '缺件自动重算：' }), h('span', { text: '在推荐方案里开启「隐藏含缺件」，可用池会排除你标记的缺件。' })),
        h('li', {}, h('b', { text: '逐槽替代 top3：' }), h('span', { text: '放满四件后，每个槽给「其余三件不变」时最好的 3 个替代，并标 Δ场景分 / Δ护甲 / Δ负重。' })),
        h('li', {}, h('b', { text: '只买得起商店货：' }), h('span', { text: '推荐方案的「获取难度」筛选可只看「全易获取」或「难点≤1」。' })),
        h('li', {}, h('b', { text: '没有任何 DLC：' }), h('span', { text: '逐槽替代会标注获取难度，可优先挑商店 / 固定拾取的件。' })),
      ));
      return;
    }
    const st = S.workbenchSummary(model);
    const groups = E.substitutesFor(ids, st.acc, st.scenario, { exclude: S.missingSet(), limit: 3 });
    const list = h('div', { class: 'lab-subs' });
    for (const g of groups) {
      const curId = g.cur || ids[SLOT_KEYS.indexOf(g.slot)];
      const curRow = h('div', { class: 'lab-sub__cur' },
        h('span', { class: 'lab-sub__slot', text: SLOT_LABEL[g.slot] }),
        miniPiece(model, curId, { clickable: true, onClick: (p) => openItemDetail(p.id, { route: false, from: 'lab' }) }),
        h('span', { class: 'grow' }),
        h('button', {
          class: `iconbtn iconbtn--sm ${S.isMissing(curId) ? 'is-on' : ''}`, type: 'button',
          title: S.isMissing(curId) ? '取消缺件标记' : '标记缺件（独立于拥有状态）',
          'aria-label': S.isMissing(curId) ? '取消缺件标记' : '标记缺件',
          on: { click: () => { const on = S.toggleMissing(curId); ui.toast(on ? `已标记缺件：${nameOf(curId)}` : `已取消缺件：${nameOf(curId)}`, 'ok'); } },
        }, icon('x-circle', { size: 14 })),
      );
      const alts = h('div', { class: 'lab-sub__alts' });
      if (!g.rows.length) {
        alts.append(h('div', { class: 'muted', attrs: { style: 'font-size:11.5px;padding:4px 2px' }, text: '该槽没有更好的替代（已被缺件排除或数据不足）。' }));
      }
      for (const r of g.rows) {
        const dCls = r.dScore > 0.0005 ? 'is-up' : r.dScore < -0.0005 ? 'is-down' : '';
        alts.append(h('button', {
          class: `lab-sub__alt ${dCls}`, type: 'button', title: `替换为 ${r.zh}`,
          on: { click: () => applyAlt(g.slot, r) },
        },
          itemMedia(iconOf(r.id), { size: 24 }),
          h('span', { class: 'lab-sub__name', text: r.zh }),
          h('span', { class: 'lab-sub__delta', title: '场景分变化（百分点）', text: `场景分 ${r.dScore > 0 ? '+' : ''}${(r.dScore * 100).toFixed(1)} 个百分点` }),
          h('span', { class: 'lab-sub__delta muted', text: `${r.dArmor >= 0 ? '+' : ''}${round1(r.dArmor)} 护甲` }),
          h('span', { class: 'lab-sub__delta muted', text: `${r.dWeight >= 0 ? '+' : ''}${round1(r.dWeight)} 负重` }),
          S.isMissing(r.id) ? h('span', { class: 'badge badge--low', text: '缺件' }) : '',
        ));
      }
      list.append(h('div', { class: 'lab-sub' }, curRow, alts));
    }
    host.append(list,
      h('div', { class: 'lab-note' }, icon('info', { size: 12 }),
        h('span', { text: '逐槽替代保持其余三件不变，由本地引擎实时重算（口径与推荐一致）；缺件只影响候选池，不代表「未拥有」。' })),
    );
  }

  const panelEl = panel('逐槽替换', { iconName: 'swap', sub: '保持其余三件不变', flush: true });
  panelEl.querySelector('.panel__tools').append(tools);
  panelEl.querySelector('.panel__body').append(host);

  const offs = [];
  const refresh = () => render();
  offs.push(S.on((reason) => { if (['missing', 'scenario', 'class-target', 'seed'].includes(reason)) render(); }));
  offs.push(store.on('build', render));
  offs.push(store.on('owned', render));
  render();

  return { el: panelEl, refresh, applyParams() { render(); }, destroy() { for (const off of offs) { try { off(); } catch { /* ignore */ } } } };
}

export default createReplace;
