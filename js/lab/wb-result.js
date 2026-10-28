/* =============================================================================
   遗迹2 · 遗物档案 — lab/wb-result.js
   工作台的「结果面板」模块：防御 / 生存 / 机动三组 + 构成明细 + 口径公式。
   数值口径来自 engine（与 Python 对拍），这里只负责渲染；共享状态从显式上下文 ctx 读取。
   ========================================================================== */
import { h, clear, fmt } from '../core/dom.js';
import { icon } from '../core/icons.js';
import { TRAIT_CAP, TRAIT_MAX_LEVEL } from './state.js';
import {
  miniPiece, statGrid, meterRow, classBadge, emptyLine,
  TYPE_ICON, TYPE_COLOR, TYPE_ZH, CLASS_ZH,
} from './parts.js';
import { effectText, condShort } from './text.js';
import { SLOT_LABEL } from './model.js';
import { ARMOR_SLOTS } from './wb-slots.js';
import { scaledEffect } from './wb-settings.js';

export function createResult(ctx) {
  const { model, E, S, store } = ctx;

  const resultSeg = h('div', { class: 'seg', attrs: { role: 'group', 'aria-label': '结果分组' } });
  const resultBody = h('div', { class: 'lab-resultbody' });
  const resultHead = h('div', { class: 'lab-reshead' });
  const breakdownHost = h('div', { class: 'lab-breakdownhost' });
  let resultTab = 'defense';
  for (const t of [{ id: 'defense', zh: '防御' }, { id: 'survival', zh: '生存' }, { id: 'mobility', zh: '机动' }]) {
    resultSeg.append(h('button', {
      class: 'seg__btn', type: 'button', dataset: { tab: t.id }, text: t.zh,
      on: { click: () => { resultTab = t.id; renderResult(); } },
    }));
  }

  function renderResultHead(st) {
    clear(resultHead);
    const empty = st.filled === 0;
    resultHead.append(
      h('div', { class: 'lab-reshead__score' },
        h('b', { text: empty ? '—' : fmt.pct(st.score, 1) }),
        h('span', { class: 'muted', text: empty ? '放入护甲后计算' : `场景分 · ${st.scenario.zh}` }),
      ),
      h('div', { class: 'lab-reshead__meta' },
        empty ? '' : classBadge(st.cls),
        empty ? '' : h('span', { class: 'stat' }, icon('weight', { size: 11 }), h('span', { class: 'stat__val', text: fmt.num(st.weight, 1) }), h('span', { class: 'stat__unit', text: '负重' })),
        st.filled < 4 ? h('span', { class: 'badge badge--mid', text: `缺 ${4 - st.filled} 件护甲` }) : '',
      ),
    );
  }

  function groupDefense(st) {
    const acc = st.acc;
    const drSame = Math.abs(st.adr - st.totals.physical) < 0.0005;
    return h('div', { class: 'stack-2' },
      statGrid([
        { k: '护甲值', v: fmt.num(st.armor, 1), iconName: 'armor', sub: `基础 ${fmt.num(st.sumA, 1)} × (1+${fmt.pct(acc.ae, 0)} 护甲效果)` },
        { k: '护甲减伤', v: fmt.pct(st.adr, 1), iconName: 'shield', sub: `${fmt.num(st.armor, 1)} / (${fmt.num(st.armor, 1)}+${fmt.num(E.K, 0)})` },
        { k: '固定减伤', v: fmt.pct(st.fdr, 1), iconName: 'shield', sub: '固定减伤乘区（含壁垒/药剂）' },
        { k: '物理总减伤', v: fmt.pct(st.totals.physical, 1), iconName: 'phys', sub: '三类乘算，封顶 80%' },
        { k: '最坏情况减伤', v: fmt.pct(st.worst, 1), iconName: 'warning', sub: '六类总减伤里的最小值' },
        { k: '场景分', v: fmt.pct(st.score, 1), iconName: 'chart', sub: `按「${st.scenario.zh}」权重加权` },
      ]),
      h('div', { class: 'lab-bars' },
        meterRow(TYPE_ICON.physical, TYPE_ZH.physical, st.totals.physical, TYPE_COLOR.physical),
        ...E.RES.map((t) => meterRow(TYPE_ICON[t], TYPE_ZH[t], st.totals[t], TYPE_COLOR[t])),
      ),
      h('div', { class: 'lab-resline' },
        h('span', { class: 'muted', attrs: { style: 'font-size:10.5px' }, text: '五类抗性' }),
        ...E.RES.map((t, i) => h('span', { class: 'stat' },
          icon(TYPE_ICON[t], { size: 11, title: `${TYPE_ZH[t]}抗性` }),
          h('span', { class: 'stat__val', text: fmt.num(st.res[i], 1) }),
        )),
      ),
      drSame ? h('div', { class: 'lab-note' }, icon('info', { size: 12 }), h('span', { text: '当前无固定减伤，护甲减伤 = 物理总减伤。' })) : '',
    );
  }

  function groupSurvival(st) {
    const acc = st.acc;
    return h('div', { class: 'stack-2' },
      statGrid([
        { k: '有效生命 EHP', v: fmt.num(st.ehp, 1), iconName: 'health', sub: '假设基础生命 100：(100+生命加成)/(1−物理总减伤)' },
        { k: '生命上限', v: fmt.num(st.hpTotal, 1), iconName: 'health', sub: `${fmt.num(st.hpMax, 0)} × (1+${fmt.pct(acc.hpPct, 1)})` },
        { k: '生命上限加成', v: `+${fmt.num(acc.hpMax, 0)}`, iconName: 'health', sub: 'health_max 加算' },
        { k: '护盾', v: fmt.pct(st.shieldPct, 1), iconName: 'shield', sub: st.shieldPct > 0 ? '按最大生命百分比' : '无护盾词条' },
        { k: '生命回复', v: `${fmt.num(st.hpRegen, 1)}/s`, iconName: 'health', sub: st.hpRegen > 0 ? 'health_regen 加算' : '无回复词条' },
        { k: '吸血', v: st.lifesteal == null ? '—' : fmt.pct(st.lifesteal, 1), iconName: 'bleed', sub: st.lifesteal == null ? '数据未收录' : 'lifesteal 加算' },
        { k: '敌人减伤', v: fmt.pct(st.edr, 1), iconName: 'shield', sub: 'enemy_damage_reduction 独立乘区' },
      ]),
      h('div', { class: 'lab-note' }, icon('info', { size: 12 }),
        h('span', { text: 'EHP 口径：以基础生命 100 为假设，只考虑物理总减伤；护盾 / 回复 / 吸血单列，方便横向比较。' })),
    );
  }

  function groupMobility(st) {
    const acc = st.acc;
    return h('div', { class: 'stack-2' },
      statGrid([
        { k: '负重', v: fmt.num(st.weight, 1), iconName: 'weight', sub: `阈值 ${st.T.map((x) => Math.round(x)).join(' / ')}` },
        { k: '负重档位', v: CLASS_ZH[st.cls], iconName: 'weight', sub: `闪避惩罚 ${fmt.pct(E.C.PENALTY[st.cls] || 0, 0)}` },
        { k: '体力上限', v: fmt.num(st.stam, 0), iconName: 'stamina', sub: `回复 ${fmt.num(st.regen, 1)}/s` },
        { k: '单次闪避消耗', v: fmt.num(st.evade, 1), iconName: 'dodge', sub: '25 × (1+档位惩罚+加成)' },
        { k: '可闪次数', v: `${st.dodges} 次`, iconName: 'stamina', sub: `体力 ${fmt.num(st.stam, 0)} / 单闪 ${fmt.num(st.evade, 1)}` },
        { k: '闪避无敌', v: `${st.iframes} 帧`, iconName: 'dodge', sub: `≈ ${(st.iframes / E.C.FRAME_RATE).toFixed(2)} 秒` },
        { k: '闪避恢复', v: `${st.recovery} 帧`, iconName: 'refresh', sub: `≈ ${(st.recovery / E.C.FRAME_RATE).toFixed(2)} 秒` },
        { k: '冲刺速度', v: fmt.num(st.sprint, 0), iconName: 'movespeed', sub: '负重档位基础值' },
        { k: '闪避窗口加成', v: fmt.pct(acc.evadeWin, 1), iconName: 'dodge', sub: 'evade_window_pct' },
        { k: '闪避距离加成', v: fmt.pct(acc.evadeDist, 1), iconName: 'dodge', sub: 'evade_distance_pct' },
        { k: '闪避速度加成', v: fmt.pct(acc.evadeSpd, 1), iconName: 'dodge', sub: 'evade_speed_pct' },
      ]),
    );
  }

  function renderBreakdown(st) {
    const slots = store.build.slots();
    const armorRows = ARMOR_SLOTS.map((slot, i) => {
      const id = st.ids[i];
      if (!id) return h('div', { class: 'lab-brow muted', text: `${SLOT_LABEL[slot]}：空` });
      const p = model.pieceById.get(id);
      return h('div', { class: 'lab-brow' },
        miniPiece(model, id),
        h('span', { class: 'muted', attrs: { style: 'font-size:11px' }, text: p ? `护甲值 ${fmt.num(p.armor, 1)} · 负重 ${fmt.num(p.weight, 1)}` : '' }),
        ctx.isMissing(id) ? h('span', { class: 'badge badge--low', text: '缺件' }) : '',
        !ctx.isOwned(id) ? h('span', { class: 'badge badge--neutral', text: '未拥有' }) : '',
      );
    });
    const perkRows = [];
    for (const slot of ['archetype1', 'archetype2']) {
      const aid = slots[slot];
      if (!aid) continue;
      const a = ctx.archOf(aid);
      const pids = model.perksOf(aid);
      perkRows.push(h('div', { class: 'lab-brow' },
        h('span', { class: 'lab-brow__k', text: `${SLOT_LABEL[slot]}：${a ? a.zh : aid}` }),
        h('span', { class: 'muted', attrs: { style: 'font-size:11px' }, text: pids.length
          ? pids.map((pid) => { const pm = E.modById.get(pid) || {}; return `${pm.zh}（${effectText(pm.effect) || '无'}${condShort(pm) ? ` · ${condShort(pm)}` : ''}）`; }).join('；')
          : '无已收录防御专长' }),
      ));
    }
    const seedPerks = S.seedPerks();
    if (seedPerks.length) {
      perkRows.push(h('div', { class: 'lab-brow' },
        h('span', { class: 'lab-brow__k', text: '预设种子 · 职业专长' }),
        h('span', { class: 'muted', attrs: { style: 'font-size:11px' }, text: seedPerks.map((pid) => (E.modById.get(pid) || {}).zh || pid).join('、') }),
      ));
    }
    const traitRows = [];
    const tl = S.traitLevels();
    for (const t of E.traits) {
      const lv = tl[t.id] || 0;
      if (!lv) continue;
      traitRows.push(h('div', { class: 'lab-brow' },
        h('span', { class: 'lab-brow__k', text: `${t.zh} ${lv}/${TRAIT_MAX_LEVEL}` }),
        h('span', { class: 'muted', attrs: { style: 'font-size:11px' }, text: effectText(scaledEffect(E.traitPerLevel(t), lv)) }),
      ));
    }
    const modRows = [];
    const pushMod = (id) => {
      const mm = E.modById.get(id);
      if (!mm) return;
      modRows.push(h('div', { class: 'lab-brow' },
        h('span', { class: 'lab-brow__k', text: mm.zh }),
        h('span', { class: 'muted', attrs: { style: 'font-size:11px' }, text: `${effectText(mm.effect) || '无防御词条'}${condShort(mm) ? ` · ${condShort(mm)}` : ''}` }),
      ));
    };
    for (const id of S.fragments()) pushMod(id);
    for (const id of S.consumables()) pushMod(id);
    for (const id of ctx.trinketIds()) pushMod(id);

    const section = (title, children, emptyText) => h('div', { class: 'lab-bsection' },
      h('div', { class: 'bar-title' }, title),
      children.length ? children : h('div', { class: 'lab-brow muted', text: emptyText }),
    );

    clear(breakdownHost);
    breakdownHost.append(h('details', { class: 'lab-details' },
      h('summary', {}, icon('listchecks', { size: 14 }), h('span', { text: '构成明细（装备 / 职业 / 特性 / 碎片 / 饰品）' })),
      h('div', { class: 'lab-details__body' },
        section('四件护甲贡献', armorRows, '未放入护甲'),
        section('职业专长', perkRows, '未选择职业'),
        section('特性贡献', traitRows, '未启用特性'),
        section('碎片 / 消耗品 / 饰品', modRows, '未启用'),
      ),
    ));
  }

  function renderFormula() {
    const C = E.C;
    return h('details', { class: 'lab-details' },
      h('summary', {}, icon('book', { size: 14 }), h('span', { text: '口径与来源（与 site_data.meta.formula 一致）' })),
      h('div', { class: 'lab-details__body' },
        h('pre', { class: 'formula', text: [
          `护甲减伤 = 护甲值 / (护甲值 + ${fmt.num(C.K, 0)})`,
          `总减伤_i = min(${fmt.pct(C.CAP, 0)}, 1-(1-护甲减伤)(1-固定减伤)(1-抗性_i/100))`,
          `元素减伤 = 独立乘区（火焰 / 电击 / 腐蚀），封顶后可超过 ${fmt.pct(C.CAP, 0)}`,
          `负重 = max(0, Σ负重 × (1+负重%) + 负重固定)；阈值 = ${C.THR_BASE.map((x) => Math.round(x)).join(' / ')} + Σ阈值平移（clamp ${Math.round(C.THR_MIN)}~${Math.round(C.THR_MAX)}）`,
          `体力 = (${fmt.num(C.STAM_BASE, 0)}+Σ体力上限) × (1+Σ体力%)；单闪 = ${fmt.num(C.EVADE_BASE, 0)} × (1+档位惩罚+Σ消耗%)；回复 = ${fmt.num(C.REGEN_BASE, 0)}+Σ回复`,
          `有效生命 EHP = (100 + Σ生命上限) × (1+Σ生命%) / (1 − 物理总减伤)`,
          `特性上限：同时启用 ${TRAIT_CAP} 个；每个 ${TRAIT_MAX_LEVEL} 级；推荐枚举 key = 场景分，前 300 名候选内再排序`,
        ].join('\n') }),
        h('div', { class: 'lab-note' }, icon('info', { size: 12 }),
          h('span', { text: `当前：场景 ${E.scenarioById(S.scenarioId()).zh} · 档位目标 ${S.classTarget() === 'free' ? '不限' : (CLASS_ZH[S.classTarget()] || S.classTarget())} · 缺件 ${S.missingCount()} 件 · 已拥有 ${S.ownedCount()} 件` })),
      ),
    );
  }

  function renderResult() {
    for (const b of resultSeg.children) b.classList.toggle('is-on', b.dataset.tab === resultTab);
    const st = S.workbenchSummary(model);
    renderResultHead(st);
    clear(resultBody);
    if (st.filled === 0) {
      // 空态：一句提示 + 最多 3 个核心指标占位，不堆 20 个 0 卡片
      resultBody.append(
        emptyLine('放入四件护甲后显示实时合计（职业 / 特性 / 饰品已计入）', 'flask'),
        statGrid([
          { k: '护甲值', v: '—', iconName: 'armor' },
          { k: '护甲减伤', v: '—', iconName: 'shield' },
          { k: '场景分', v: '—', iconName: 'chart' },
        ]),
      );
      clear(breakdownHost);
      return;
    }
    if (resultTab === 'defense') resultBody.append(groupDefense(st));
    else if (resultTab === 'survival') resultBody.append(groupSurvival(st));
    else resultBody.append(groupMobility(st));
    renderBreakdown(st);
  }

  const body = [
    resultHead,
    h('div', { class: 'lab-resseg' }, resultSeg),
    resultBody,
    breakdownHost,
    renderFormula(),
  ];

  return { body, renderResult };
}
