/* =============================================================================
   遗迹2 · 遗物档案 — lab/tiers.js（v2）
   档位对照：engine.frontier(当前阈值) 给出四档「极限护甲配置」，可一键载入；
   再折叠保留原矩阵 B（场景 × 抗性特化，engine.tableB()）。
   ========================================================================== */
import { h, clear, fmt } from '../core/dom.js';
import { icon } from '../core/icons.js';
import { store } from '../core/store.js';
import { ui } from '../core/ui.js';
import { openItemDetail } from '../components/item-detail.js';
import * as S from './state.js';
import { createRefresh, createScope } from '../core/task.js';
import { panel, miniPiece, classBadge, emptyLine, TYPE_ZH } from './parts.js';
import { CLASS_ZH } from './engine.js';

export function createTiers(model) {
  const E = model.engine;
  const root = h('div', { class: 'lab-tiers' });
  const host = h('div');
  const tableBHost = h('div');
  let tableBStarted = false;
  /** 矩阵 B 的分帧计算（812,224 组合）：合并调度，卸载时可取消 */
  const tableBRefresh = createRefresh(() => {
    if (!tableBStarted) return;
    const rows = E.tableB();
    clear(tableBHost);
    tableBHost.append(h('div', { class: 'tbl-scroll' }, h('table', { class: 'tbl' },
      h('thead', {}, h('tr', {},
        h('th', { text: '抗性特化' }), h('th', { text: '四件' }), h('th', { text: '护甲（含坚韧）' }),
        h('th', { text: '该类型总减伤' }), h('th', { text: '负重 · 档位' }), h('th', { text: '说明' }),
      )),
      h('tbody', {}, rows.map((r) => h('tr', {},
        h('td', {}, h('b', { text: TYPE_ZH[r.type] })),
        h('td', {}, h('div', { class: 'lab-cell__pieces' }, r.ids.map((id) => miniPiece(model, id, { clickable: true, onClick: clickDetail })))),
        h('td', { class: 'tbl__num' }, `${fmt.num(r.armor, 1)} `, h('span', { class: 'muted', text: `(${fmt.pct(r.adr, 1)})` })),
        h('td', { class: 'tbl__num' }, h('b', { class: 'lab-gold', text: fmt.pct(r.total, 1) }), h('span', { class: 'muted', text: ` 抗性 ${fmt.num(r.res, 1)}` })),
        h('td', { class: 'tbl__num', text: `${fmt.num(r.weight, 1)} · ${CLASS_ZH[r.cls] || r.cls}` }),
        h('td', { class: 'muted', text: `只在「${TYPE_ZH[r.type]}」伤害命中时有效` }),
      ))),
    )));
  });

  const clickDetail = (p) => openItemDetail(p.id, { from: 'lab' });

  function loadRow(ids) {
    S.writeArmor(ids);
    ui.toast('已载入这四件护甲', 'ok');
  }

  function renderFrontier() {
    const stNow = S.workbenchSummary(model);
    const acc = stNow.acc;
    const sc = stNow.scenario;
    const T = E.thresholds(acc);
    const fr = E.frontier(T);
    const curCls = stNow.filled === 4 ? stNow.cls : null;
    const rows = [];
    for (let ci = 0; ci < 4; ci += 1) {
      const b = fr[ci];
      const cls = E.CLASS_ORDER[ci];
      if (!b) {
        rows.push(h('tr', {}, h('td', {}, classBadge(cls)), h('td', { text: '—' }), h('td', { text: '该档无解' }), h('td', { text: '—' }), h('td', { text: '—' }), h('td', { text: '—' }), h('td', { text: '—' })));
        continue;
      }
      const st = E.comboStats(b.ids, acc, sc);
      const isCur = curCls === cls;
      const dArmor = stNow.filled ? st.armor - stNow.armor : null;
      const dWeight = stNow.filled ? st.weight - stNow.weight : null;
      rows.push(h('tr', { class: isCur ? 'is-hi' : '' },
        h('td', {}, classBadge(cls), isCur ? h('span', { class: 'badge badge--gold', attrs: { style: 'margin-left:4px' }, text: '当前' }) : ''),
        h('td', { class: 'tbl__num' }, ci < 3 ? Math.round(T[ci]) : `${Math.round(T[2])}+`),
        h('td', { class: 'tbl__num' }, `${fmt.num(st.armor, 1)} `, h('span', { class: 'muted', text: `(基础 ${fmt.num(b.armor, 1)})` })),
        h('td', { class: 'tbl__num' }, fmt.pct(st.adr, 1)),
        h('td', { class: 'tbl__num' }, fmt.num(st.weight, 1)),
        h('td', { class: 'tbl__num' }, dArmor == null ? '—' : `${dArmor >= 0 ? '+' : ''}${fmt.num(dArmor, 1)} / ${dWeight >= 0 ? '+' : ''}${fmt.num(dWeight, 1)}`),
        h('td', {}, h('div', { class: 'row', attrs: { style: 'gap:4px;flex-wrap:wrap' } },
          b.ids.length ? h('div', { class: 'lab-cell__pieces' }, b.ids.map((id) => miniPiece(model, id, { clickable: true, onClick: clickDetail }))) : '',
          h('button', { class: 'btn btn--ghost btn--sm', type: 'button', on: { click: () => loadRow(b.ids) } },
            icon('flask', { size: 12 }), h('span', { text: '载入这四件' })),
        )),
      ));
    }
    return h('div', {},
      h('div', { class: 'tbl-scroll' }, h('table', { class: 'tbl' },
        h('thead', {}, h('tr', {},
          h('th', { text: '档位' }), h('th', { text: '阈值' }), h('th', { text: '极限护甲（含护甲效果）' }),
          h('th', { text: '护甲减伤' }), h('th', { text: '负重' }), h('th', { text: '与当前对比（护甲 / 负重）' }),
          h('th', { text: '四件 / 操作' }),
        )),
        h('tbody', {}, rows),
      )),
      h('div', { class: 'lab-note' }, icon('info', { size: 12 }),
        h('span', { text: `阈值按当前特性/碎片/消耗品实时计算：${T.map((x) => Math.round(x)).join(' / ')}。四档极限护甲 = 该档负重上限内护甲最大的四件组合（引擎穷举，不排除缺件；缺件请用推荐方案）。` })),
    );
  }

  function renderTableB() {
    if (tableBStarted) return;
    tableBStarted = true;
    clear(tableBHost);
    tableBHost.append(emptyLine('正在穷举抗性特化（812,224 组合）…', 'refresh'));
    tableBRefresh.schedule();
  }

  function render() {
    clear(host);
    host.append(renderFrontier());
    tableBStarted = false;
    clear(tableBHost);
    host.append(h('details', { class: 'lab-details', attrs: { style: 'margin-top:12px' } },
      h('summary', {}, icon('matrix', { size: 14 }), h('span', { text: '展开矩阵 B：场景 × 抗性特化（坚韧满级口径）' })),
      h('div', { class: 'lab-details__body' }, tableBHost),
    ));
    const det = host.querySelector('details');
    if (det) det.addEventListener('toggle', () => { if (det.open) renderTableB(); }, { once: false });
  }

  const shell = panel('档位对照', { iconName: 'matrix', sub: '四档极限护甲 + 抗性特化矩阵' });
  shell.body.append(host);
  root.append(shell.el);

  const scope = createScope();
  scope.add(S.on((reason) => { if (['missing', 'scenario', 'class-target', 'seed'].includes(reason)) render(); }));
  scope.add(store.on('build', render));
  render();
  return { el: root, refresh: render, applyParams() { render(); }, destroy() { scope.dispose(); tableBRefresh.cancel(); } };
}

export default createTiers;
