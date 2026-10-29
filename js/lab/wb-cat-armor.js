/* =============================================================================
   遗迹2 · 遗物档案 — lab/wb-cat-armor.js（装配台：护甲四件）
   4 行：槽位 / 护甲件（图标+名）/ 护甲值·负重·五类抗性 / 套装与获取 / 操作。
   表尾给合计（护甲值 / 负重 / 负重档位）；右侧推荐 = 当前场景前 3 套四件套（引擎穷举，异步计算）。
   数据：护甲数值以 site_data.pieces 为准（引擎 pieceById）；套装加成未收录处标「待验证」。
   ========================================================================== */
import { h, clear, fmt } from '../core/dom.js';
import { icon } from '../core/icons.js';
import { openItemDetail } from '../components/item-detail.js';
import * as S from './state.js';
import { SLOT_LABEL } from './model.js';
import { CLASS_ZH } from './engine.js';
import {
  catShell, catBar, crow, slotCell, itemCell, statCell, effectCell, actsCell, emptyCrow,
  noteLine, recCard, recList, iconAct, tag, U,
} from './wb-parts.js';
import { ARMOR_SLOTS } from './wb-slots.js';

const RES_ZH = ['流血', '火焰', '电击', '腐蚀', '枯萎'];
const RES_ICON = ['bleed', 'fire', 'shock', 'corrode', 'blight'];
const HARD_WORDS = ['头目掉落', '解谜', '随机', 'Boss'];
const REC_TOP = 3;

/** 获取难度：从 site_data.pieces[].dobtain 里挑「难点」词 */
function hardOf(p) {
  return (p && Array.isArray(p.dobt) ? p.dobt : []).filter((x) => HARD_WORDS.includes(x));
}

export function createArmorTab(ctx) {
  const { model, E, S, store, ui } = ctx;
  const shell = catShell({
    title: '护甲四件',
    sub: '4 槽 · 护甲值 / 负重 / 抗性计入合计',
    iconName: 'armor',
  });
  shell.acts.append(
    h('button', {
      class: 'btn btn--quiet btn--sm', type: 'button', text: '清空四件',
      on: {
        click: async () => {
          if (!ARMOR_SLOTS.some((s) => store.build.get(s))) { ui.toast('四件护甲已经是空的', 'ok'); return; }
          const ok = await ui.confirm({ title: '清空四件护甲？', body: '只清空头盔 / 胸甲 / 腿甲 / 手甲四个槽，其它槽位与特性不受影响。', ok: '清空', danger: true });
          if (!ok) return;
          for (const s of ARMOR_SLOTS) store.build.remove(s);
          ui.toast('已清空四件护甲', 'ok');
        },
      },
    }),
  );

  /* ------------------------- 行渲染 ------------------------- */
  function resLine(p) {
    const res = Array.isArray(p.res) ? p.res : [];
    return h('div', { class: 'lab-resmini' },
      RES_ZH.map((zh, i) => h('span', { class: 'lab-resmini__i', title: `${zh}抗性` },
        icon(RES_ICON[i], { size: 10 }),
        h('span', { text: `${fmt.num(res[i] || 0, 0)}` }),
      )),
    );
  }

  function armorRow(slot) {
    const id = store.build.get(slot);
    const label = SLOT_LABEL[slot];
    if (!id) {
      return emptyCrow({
        label, iconName: 'armor', hint: `选择${label}`,
        onPick: () => ctx.pickForSlot(slot),
      });
    }
    const p = model.pieceById.get(id) || {};
    const it = model.itemsById.get(id) || null;
    const miss = ctx.isMissing(id);
    const stats = statCell([
      { k: '护甲值', v: fmt.num(p.armor, 1), iconName: 'armor' },
      { k: '负重', v: fmt.num(p.weight, 1), iconName: 'weight' },
    ]);
    stats.append(resLine(p));

    const setParts = it && it.setField && Array.isArray(it.setField.parts) ? it.setField.parts : [];
    const setHave = setParts.filter((pid) => ARMOR_SLOTS.some((s) => store.build.get(s) === pid)).length;
    const hard = hardOf(p);
    const effect = h('div', { class: 'lab-armoreff' },
      h('div', { class: 'lab-armoreff__line' },
        it && it.setName ? tag(`套装 · ${it.setName}`) : tag('套装 · 未收录'),
        setParts.length ? tag(`本套 ${setHave}/${setParts.length}`) : '',
        hard.length ? h('span', { class: 'badge badge--boss', title: `获取难度：${hard.join('、')}` }, icon('boss', { size: 10 }), h('span', { text: hard.join('、') })) : h('span', { class: 'badge badge--easy', text: '易获取' }),
      ),
      h('div', { class: 'lab-armoreff__note muted', text: p.dlc ? `来源：${p.dlc}` : '套装加成数据未收录（待验证）' }),
    );

    return crow([
      slotCell(label, 'armor', { badge: miss ? h('span', { class: 'badge badge--low', text: '缺件' }) : null }),
      itemCell({
        iconUrl: p.iconUrl || ctx.iconOf(id), zh: p.zh || model.nameOf(id), en: p.en || '',
        sub: it && it.setName ? it.setName : '', onClick: () => openItemDetail(id, { from: 'lab' }),
      }),
      stats,
      effectCell(effect),
      actsCell([
        iconAct('eye', '查看详情', () => openItemDetail(id, { from: 'lab' })),
        iconAct('x-circle', miss ? '取消缺件标记' : '标记为缺件（没有这件）', () => {
          const on = S.toggleMissing(id);
          ui.toast(on ? `已标记缺件：${model.nameOf(id)}` : `已取消缺件：${model.nameOf(id)}`, on ? 'warn' : 'ok');
        }, { on: miss }),
        iconAct('swap', `更换${label}`, () => ctx.pickForSlot(slot)),
        iconAct('x', '移除', () => ctx.removeSlot(slot), { danger: true }),
      ]),
    ], { cls: miss ? 'is-missing' : '' });
  }

  function totalLine() {
    const slots = store.build.slots();
    const ids = ARMOR_SLOTS.map((s) => slots[s]).filter(Boolean);
    if (!ids.length) return h('div', { class: 'lab-cat__total muted', text: '尚未放入护甲；放入后此处显示四件合计与实际减伤。' });
    const st = S.workbenchSummary(model);
    return h('div', { class: 'lab-cat__total' },
      h('span', { class: 'lab-cat__totalitem' }, icon('armor', { size: 12 }), h('b', { text: fmt.num(st.armor, 1) }), h('span', { text: '护甲值' })),
      h('span', { class: 'lab-cat__totalitem' }, icon('shield', { size: 12 }), h('b', { text: fmt.pct(st.adr, 1) }), h('span', { text: '护甲减伤' })),
      h('span', { class: 'lab-cat__totalitem' }, icon('weight', { size: 12 }), h('b', { text: fmt.num(st.weight, 1) }), h('span', { text: '负重' })),
      h('span', { class: 'lab-cat__totalitem' }, icon('dodge', { size: 12 }), h('b', { text: CLASS_ZH[st.cls] || st.cls }), h('span', { text: `负重档位 · 闪避惩罚 ${fmt.pct((E.C.PENALTY[st.cls] || 0), 0)}` })),
      h('span', { class: 'lab-cat__totalitem muted' }, h('span', { text: `已放入 ${st.filled}/4 件` })),
    );
  }

  /* ------------------------- 推荐（异步枚举 + 缓存） ------------------------- */
  const recCache = new Map();
  let recKey = '';
  let recTimer = 0;
  let recBusy = false;
  let destroyed = false;

  function recommendKey() {
    const picks = S.workbenchPicks(model);
    const ids = (o) => Object.keys(o || {}).sort().join(',');
    return [
      S.scenarioId(), S.classTarget(), 'armor',
      ids(picks.traits), ids(picks.fragments), ids(picks.consumables), ids(picks.perks),
      ids(picks.rings), picks.amulet || '',
      [...S.missingSet()].sort().join(','),
    ].join('|');
  }

  function computeRecommend(key) {
    if (recCache.has(key)) return recCache.get(key);
    const picks = S.workbenchPicks(model);
    const res = E.enumerateTop({
      picks,
      scenarioId: S.scenarioId(),
      classTarget: S.classTarget(),
      exclude: S.missingSet(),
      top: REC_TOP,
    });
    recCache.set(key, res);
    if (recCache.size > 6) recCache.delete(recCache.keys().next().value);
    return res;
  }

  function recCardFor(entry, index, scenarioZh) {
    const st = entry.stats;
    const ids = Array.isArray(entry.ids) ? entry.ids : [];
    const hard = ids.reduce((n, id) => n + (hardOf(model.pieceById.get(id)).length ? 1 : 0), 0);
    return recCard({
      title: `第 ${index + 1} 套`,
      score: fmt.pct(st.score, 1),
      sub: scenarioZh,
      meta: [
        tag(`护甲值 ${fmt.num(st.armor, 1)}`),
        tag(`物理减伤 ${fmt.pct(st.totals.physical, 1)}`),
        tag(`负重 ${fmt.num(st.weight, 1)}`),
        tag(`档位 ${CLASS_ZH[st.cls] || st.cls}`),
        hard ? h('span', { class: 'badge badge--boss', text: `难点 ${hard} 件` }) : h('span', { class: 'badge badge--easy', text: '全易获取' }),
      ],
      lines: [
        h('div', { class: 'lab-recard__pieces' },
          ids.map((id) => {
            const p = model.pieceById.get(id) || {};
            return h('span', { class: 'lab-mini', title: `${p.zh || id} · 护甲值 ${fmt.num(p.armor, 1)} · 负重 ${fmt.num(p.weight, 1)}` },
              h('span', { class: 'lab-mini__name', text: p.zh || id }));
          })),
      ],
      actions: [
        h('button', {
          class: 'btn btn--primary btn--sm', type: 'button', text: '写入四件',
          on: { click: () => { S.writeArmor(ids); ui.toast(`已写入第 ${index + 1} 套（场景分 ${fmt.pct(st.score, 1)}）`, 'ok'); } },
        }),
      ],
    });
  }

  function renderRec(host) {
    clear(host);
    const key = recommendKey();
    if (key !== recKey) {
      recKey = key;
      recBusy = true;
      host.append(h('div', { class: 'lab-recload' }, icon('refresh', { size: 13 }), h('span', { text: '按当前设置穷举四件套…' })));
      if (recTimer) clearTimeout(recTimer);
      recTimer = setTimeout(() => {
        recTimer = 0;
        if (destroyed) return;
        try { computeRecommend(key); } catch (err) { console.error('[lab:assembly] 护甲推荐失败', err); }
        recBusy = false;
        renderRec(host);
      }, 30);
      return;
    }
    const res = recCache.get(key);
    if (!res || recBusy) { host.append(h('div', { class: 'lab-recload' }, h('span', { text: '计算中…' }))); return; }
    const scenarioZh = E.scenarioById(S.scenarioId()).zh;
    host.append(h('div', { class: 'lab-recn' },
      h('div', { class: 'lab-recn__head' },
        h('div', { class: 'lab-recn__title', text: '本场景推荐四件套' }),
        tag(scenarioZh),
      ),
      recList(res.top.map((e, i) => recCardFor(e, i, `场景分 · ${scenarioZh}`))),
      h('div', { class: 'lab-recn__foot muted' },
        h('span', { text: `口径：按「${scenarioZh}」权重穷举全部护甲组合（${fmt.int(res.total)} 组），取前 ${REC_TOP}；缺件已排除；特性 / 碎片 / 饰品 / 职业专长已计入。` })),
    ));
  }

  /* ------------------------- 组装 / 刷新 ------------------------- */
  function render() {
    clear(shell.body);
    shell.body.append(
      catBar([
        { zh: '槽位' }, { zh: '护甲件' }, { zh: '数值（护甲 / 负重 / 抗性）' }, { zh: '套装与获取' }, { zh: '操作' },
      ]),
      ...ARMOR_SLOTS.map(armorRow),
      totalLine(),
    );
    clear(shell.foot);
    shell.foot.append(noteLine('护甲数值来自 site_data.pieces（引擎口径）；抗性为单件加成，套装加成数据未收录处标「待验证」。护甲效果与负重档位实时计入下方「本套效果」。'));
  }

  render();
  return {
    el: shell.el,
    refresh: render,
    renderRec,
    destroy() { destroyed = true; if (recTimer) clearTimeout(recTimer); },
  };
}

export default createArmorTab;
