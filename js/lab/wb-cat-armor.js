/* =============================================================================
   遗迹2 · 遗物档案 — lab/wb-cat-armor.js（装配台：护甲四件）
   v5：4 张并排槽位卡（游戏装备栏式）+ 下方「效果汇总」（逐件抗性 / 套装 / 获取难度 + 四件合计）。
   合计口径：护甲值 / 护甲减伤 / 负重 / 负重档位与闪避惩罚（引擎 comboStats，含场景与职业专长）。
   右侧推荐 = 当前场景前 3 套四件套（引擎穷举，异步计算）。
   数据：护甲数值以 site_data.pieces 为准（引擎 pieceById）；套装加成未收录处标「待验证」。
   ========================================================================== */
import { h, clear, fmt } from '../core/dom.js';
import { icon } from '../core/icons.js';
import { openItemDetail } from '../components/item-detail.js';
import * as S from './state.js';
import { SLOT_LABEL } from './model.js';
import { CLASS_ZH } from './engine.js';
import {
  CAT_BY_ID, catShell, noteLine, recCard, recList, tag,
  slotCard, slotStrip, linkHover, digest, digestRow,
} from './wb-parts.js';
import { ARMOR_SLOTS } from './wb-slots.js';

const RES_ZH = ['流血', '火焰', '电击', '腐蚀', '枯萎'];
const HARD_WORDS = ['头目掉落', '解谜', '随机', 'Boss'];
const REC_TOP = 3;
const CAT = CAT_BY_ID.get('armor') || { zh: '护甲四件', sub: '4 槽 · 护甲值 / 负重 / 抗性计入合计', icon: 'armor' };

/** 获取难度：从 site_data.pieces[].dobtain 里挑「难点」词 */
function hardOf(p) {
  return (p && Array.isArray(p.dobt) ? p.dobt : []).filter((x) => HARD_WORDS.includes(x));
}

export function createArmorTab(ctx) {
  const { model, E, S, store, ui } = ctx;
  const shell = catShell({ title: CAT.zh, sub: CAT.sub || '', iconName: CAT.icon });
  const openDetail = (id) => openItemDetail(id, { from: 'lab' });
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

  /* ------------------------- 数据小件 ------------------------- */
  /** 单件五类抗性一行（护甲值 / 负重 chips 的 title 与汇总行共用同一口径） */
  function resLine(p) {
    const res = Array.isArray(p.res) ? p.res : [];
    return RES_ZH.map((zh, i) => `${zh} ${fmt.num(res[i] || 0, 0)}`).join(' · ');
  }

  /** 套装构成：件数按「当前四槽里是否有该套件」实时算 */
  function setOf(it) {
    const parts = it && it.setField && Array.isArray(it.setField.parts) ? it.setField.parts : [];
    const have = parts.filter((pid) => ARMOR_SLOTS.some((s) => store.build.get(s) === pid)).length;
    return { parts, have };
  }

  function setTag(it, p) {
    const title = p && p.dlc ? `来源：${p.dlc}` : '来源：待验证';
    return it && it.setName ? tag(`套装 · ${it.setName}`, { title }) : tag('套装 · 未收录', { title });
  }

  /* ------------------------- 槽位卡（并排 4 格）+ 效果汇总 ------------------------- */
  function armorCard(slot) {
    const id = store.build.get(slot);
    const label = SLOT_LABEL[slot];
    if (!id) {
      return slotCard({ label, iconName: 'armor', empty: true, onOpen: () => ctx.pickForSlot(slot) });
    }
    const p = model.pieceById.get(id) || {};
    const it = model.itemsById.get(id) || null;
    const miss = ctx.isMissing(id);
    const { parts, have } = setOf(it);
    const zh = p.zh || model.nameOf(id);
    return slotCard({
      label,
      iconName: 'armor',
      iconUrl: p.iconUrl || ctx.iconOf(id),
      zh,
      en: p.en || '',
      stats: [
        { k: '护甲值', v: fmt.num(p.armor, 1), iconName: 'armor', title: resLine(p) },
        { k: '负重', v: fmt.num(p.weight, 1), iconName: 'weight', title: resLine(p) },
      ],
      tags: [
        setTag(it, p),
        parts.length ? tag(`本套 ${have}/${parts.length}`, { title: `四槽中已放入本套 ${have}/${parts.length} 件` }) : '',
      ],
      missing: miss,
      onOpen: () => ctx.pickForSlot(slot),
      actions: [
        { icon: 'eye', title: `查看${label}详情`, onClick: () => openDetail(id) },
        {
          icon: 'x-circle', title: miss ? '取消缺件标记' : '标记为缺件（没有这件）', on: miss,
          onClick: () => {
            const on = S.toggleMissing(id);
            ui.toast(on ? `已标记缺件：${model.nameOf(id)}` : `已取消缺件：${model.nameOf(id)}`, on ? 'warn' : 'ok');
          },
        },
        { icon: 'x', title: `移除${label}`, onClick: () => ctx.removeSlot(slot), danger: true },
      ],
    });
  }

  /** 汇总行：一件一行，槽位 / 图标 / 名称 + 套装、获取难度 + 五类抗性（点行看详情） */
  function armorDigest(slot) {
    const id = store.build.get(slot);
    const label = SLOT_LABEL[slot];
    if (!id) return digestRow({ label, empty: true });
    const p = model.pieceById.get(id) || {};
    const it = model.itemsById.get(id) || null;
    const hard = hardOf(p);
    const tags = [
      setTag(it, p),
      hard.length ? tag(hard.join('、'), { title: `获取难度：${hard.join('、')}` }) : tag('易获取', { title: '获取难度：无难点词条' }),
    ];
    if (ctx.isMissing(id)) tags.push(tag('缺件'));
    return digestRow({
      label,
      iconUrl: p.iconUrl || ctx.iconOf(id),
      zh: p.zh || model.nameOf(id),
      tags,
      lines: [resLine(p)],
      onClick: () => openDetail(id),
    });
  }

  /** 四件合计：护甲值 / 护甲减伤 / 负重 / 负重档位与闪避惩罚（引擎口径） */
  function armorSums() {
    const ids = ARMOR_SLOTS.map((s) => store.build.get(s)).filter(Boolean);
    if (!ids.length) return [];
    const st = S.workbenchSummary(model);
    return [
      { k: '护甲值', v: fmt.num(st.armor, 1), iconName: 'armor', title: '四件护甲值合计（引擎 comboStats 口径）' },
      { k: '护甲减伤', v: fmt.pct(st.adr, 1), iconName: 'shield', title: '四件护甲对应的实际减伤（含当前场景与职业专长）' },
      { k: '负重', v: fmt.num(st.weight, 1), iconName: 'weight', title: '四件负重合计' },
      { k: `负重档位 · 闪避惩罚 ${fmt.pct(E.C.PENALTY[st.cls] || 0, 0)}`, v: CLASS_ZH[st.cls] || st.cls, iconName: 'dodge', title: '负重档位与对应的闪避惩罚' },
    ];
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
    const cards = new Map();
    const rows = new Map();
    const strip = slotStrip(ARMOR_SLOTS.map((slot) => {
      const card = armorCard(slot);
      cards.set(slot, card);
      return card;
    }));
    const filled = ARMOR_SLOTS.filter((slot) => store.build.get(slot)).length;
    const sum = digest({
      title: '效果汇总',
      sub: `4 槽 · 已放入 ${filled}/${ARMOR_SLOTS.length}`,
      iconName: 'armor',
      rows: ARMOR_SLOTS.map((slot) => {
        const row = armorDigest(slot);
        rows.set(slot, row);
        return row;
      }),
      sums: armorSums(),
      foot: [`已放入 ${filled}/${ARMOR_SLOTS.length} 件`],
    });
    shell.body.append(h('div', { class: 'lab-cat__pad' }, strip, sum));
    /* 悬停卡片 ↔ 汇总行双向高亮：一眼看清这件护甲的抗性 / 套装落在哪一行 */
    for (const slot of ARMOR_SLOTS) linkHover(cards.get(slot), rows.get(slot));
    clear(shell.foot);
    shell.foot.append(noteLine('护甲数值来自 site_data.pieces（引擎口径）；抗性为单件加成，套装加成数据未收录处标「待验证」。护甲值 / 护甲减伤 / 负重档位实时计入上方「效果汇总」合计。'));
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
