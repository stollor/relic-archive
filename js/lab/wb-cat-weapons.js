/* =============================================================================
   遗迹2 · 遗物档案 — lab/wb-cat-weapons.js（装配台 v3 · 武器与改装）
   3 把武器（长枪 / 手枪 / 近战）行 + 每把下方的「挂件」子区块（突变因子 / 改装）。
   挂件候选走 fit.recommendMutators / recommendMods（当前流派 + 武器标签契合近似口径）；
   写入只经 S.setMutator / S.setModOf；右侧推荐面板由 renderRec(host) 渲染。
   数据缺字段一律「待验证」，不编造效果句；同名武器只显示已收录的中文名 + 英文小字。
   ========================================================================== */
import { h, clear, fmt } from '../core/dom.js';
import { icon } from '../core/icons.js';
import { SLOT_LABEL } from './model.js';
import { effectText } from './text.js';
import { createScorer } from './score.js';
import { createFit } from './fit.js';
import {
  CAT_BY_ID, catShell, catBar, crow, emptyCrow, slotCell, itemCell, statCell, effectCell, actsCell,
  catSection, noteLine, recCard, recList, tag, iconAct, emptyTab,
} from './wb-parts.js';

const WEAPON_SLOTS = ['longGun', 'handGun', 'melee'];
const SLOT_ICON = { longGun: 'longgun', handGun: 'handgun', melee: 'sword' };
const WEAPON_ZH = { ranged: '远程', melee: '近战', any: '通用' };
/** 武器原始 tags → 中文小标签（只取有玩法语义的类别） */
const WEAPON_TAG_ZH = {
  Rifle: '步枪', Shotgun: '霰弹枪', Handgun: '手枪', MeleeWeapon: '近战', Bow: '弓', Crossbow: '弩',
};
const TOP = 5;

/** 武器效果句：数值效果对象走 effectText；当前武器数据无该对象时用 summaryZh（官方数值摘要） */
function weaponEffect(item) {
  if (!item) return '';
  return effectText(item.effect) || item.summaryZh || '';
}

export function createWeaponsTab(ctx) {
  const { model } = ctx;
  const { store, ui, S } = ctx;
  const gear = model.gear;
  const cat = CAT_BY_ID.get('weapons') || { zh: '武器与改装', sub: '', icon: 'longgun' };
  const shell = catShell({ title: cat.zh, sub: cat.sub, iconName: cat.icon });

  /* 适配模块：每个分类页只装配一次（createScorer / createFit 有初始化成本） */
  let fit = null;
  function ensureFit() {
    if (fit) return fit;
    try { fit = createFit(model, createScorer(gear)); } catch { fit = null; }
    return fit;
  }

  /* ----------------------------- 小工具 ----------------------------- */
  const slotZh = (slot) => SLOT_LABEL[slot] || slot;
  const weaponId = (slot) => store.build.get(slot) || null;
  const playstyleId = () => { try { return S.playstyleId() || 'general'; } catch { return 'general'; } };
  const psZh = () => (gear.playstyleById.get(playstyleId()) || {}).zh || '通用';
  const ASCII_WORD = /[A-Za-z]{3,}/;
  function attachRec(kind, id) {
    if (!id) return null;
    const g = gear.of(id);
    return g && g.kind === kind ? g : null;
  }
  /** 「像效果句」而非描述 / 风味 / 原始字段名混排：推荐卡只展示这类文本 */
  function cleanEffect(text) {
    const s = String(text || '').trim();
    if (!s || s.length < 8 || ASCII_WORD.test(s)) return '';
    if (/^[“"「]/.test(s) || /[。！？!?]\s*$/.test(s)) return '';  // 引号 / 句末标点 = 描述而不是效果行
    if (!/\d|[+＋%]/.test(s)) return '';
    return s;
  }
  /** 把 summaryZh 里混排的裸字段片段（如「Initial散布 +10」）按分号剔除，只留可读中文段 */
  function readableEffect(text) {
    const parts = String(text || '').split(/[;；]/).map((s) => s.trim()).filter(Boolean);
    return parts.filter((s) => /[\u4e00-\u9fff]/.test(s) && !ASCII_WORD.test(s)).join('；');
  }
  /**
   * 挂件效果句：effectText(引擎数值效果) → item.summaryZh（效果行数值摘要，剔裸字段）
   * → 待验证。行内 / 抽屉走这条；推荐卡额外收窄，避免把原始字段名铺进卡片。
   */
  function attachEffectText(kind, id, { forCard = false } = {}) {
    const rec = attachRec(kind, id);
    const numeric = rec && rec.numeric;
    if (numeric) {
      const fromEffect = effectText(numeric.effect);
      if (fromEffect) return fromEffect;
    }
    if (forCard) return cleanEffect(rec && rec.effectZh);
    const item = model.itemsById.get(id) || (rec && rec.item) || null;
    return readableEffect(item && item.summaryZh) || '';
  }
  function attachInfo(kind, id, { forCard = false } = {}) {
    if (!id) return null;
    const rec = attachRec(kind, id);
    return {
      rec,
      zh: (rec && (rec.zh || rec.en)) || model.nameOf(id) || id,
      en: (rec && rec.en) || '',
      effect: attachEffectText(kind, id, { forCard }),
    };
  }
  function recommend(kind, slot) {
    if (!ensureFit() || (kind === 'mod' && slot === 'melee')) return [];
    try {
      const args = { weaponType: slot, weaponId: weaponId(slot) || undefined, playstyleId: playstyleId(), limit: 10 };
      return (kind === 'mod' ? fit.recommendMods(args) : fit.recommendMutators(args)) || [];
    } catch { return []; }
  }

  /* ----------------------------- 武器行 ----------------------------- */
  function weaponTags(item) {
    const out = [];
    for (const t of item && Array.isArray(item.tags) ? item.tags : []) if (WEAPON_TAG_ZH[t]) out.push(tag(WEAPON_TAG_ZH[t]));
    if (item && item.isAutomatic === true) out.push(tag('自动'));
    return out;
  }
  function weaponStats(item) {
    if (!item) return [{ k: '属性', v: '待验证' }];
    const pairs = [];
    if (item.damage != null) pairs.push({ k: '伤害', v: fmt.num(item.damage, item.damage < 10 ? 1 : 0) });
    if (item.rate != null) pairs.push({ k: '射速', v: fmt.num(item.rate, 2) });
    if (item.crit != null) pairs.push({ k: '暴击', v: fmt.num(item.crit, 1), unit: '%' });
    if (item.ammoPerClip != null) pairs.push({ k: '弹匣', v: fmt.int(item.ammoPerClip) });
    if (item.weakspot != null) pairs.push({ k: '弱点', v: fmt.num(item.weakspot, 0), unit: '%' });
    return pairs.length ? pairs : [{ k: '属性', v: '待验证' }];
  }

  function weaponRow(slot) {
    const id = weaponId(slot);
    const label = slotZh(slot);
    if (!id) {
      return emptyCrow({ label, iconName: SLOT_ICON[slot], hint: `点击选择${label}`, onPick: () => ctx.pickForSlot(slot) });
    }
    const item = model.itemsById.get(id) || null;
    const missing = ctx.isMissing(id);
    return crow([
      slotCell(label, SLOT_ICON[slot], { badge: missing ? tag('缺件') : null }),
      itemCell({
        iconUrl: model.iconOf(id), zh: model.nameOf(id), en: (item && item.en) || '',
        tags: weaponTags(item), onClick: () => ctx.openDetail(id),
      }),
      statCell(weaponStats(item)),
      effectCell(weaponEffect(item) || '无已收录效果'),
      actsCell([
        iconAct('eye', `查看${label}详情`, () => ctx.openDetail(id)),
        iconAct('x-circle', missing ? '取消缺件标记' : `标记${label}为缺件`, () => ctx.toggleMissing(id), { on: missing }),
        iconAct('swap', `更换${label}`, () => ctx.pickForSlot(slot)),
        iconAct('x', `移除${label}`, () => ctx.removeSlot(slot), { danger: true }),
      ]),
    ], { cls: missing ? 'is-missing' : '' });
  }

  /* ----------------------------- 挂件子区块 ----------------------------- */
  function clearAttach(kind, slot) {
    if (kind === 'mod') S.setModOf(slot, null); else S.setMutator(slot, null);
    ui.toast(`已清除${kind === 'mod' ? '改装' : '突变因子'}`, 'ok');
  }
  /* ----------------------------- 挂件子行（单行紧凑） ----------------------------- */
  function attachInline(kind, slot) {
    const isMod = kind === 'mod';
    const label = isMod ? '改装' : '突变因子';
    const currentId = isMod ? S.modOf(slot) : S.mutatorOf(slot);
    const meleeMod = isMod && slot === 'melee';
    const info = currentId ? attachInfo(kind, currentId) : null;
    const disabled = meleeMod;
    return h('div', { class: 'lab-attachline__item' },
      h('span', { class: 'lab-attachline__k', text: label }),
      meleeMod
        ? h('span', { class: 'muted', text: '近战无改装槽' })
        : (info
          ? h('span', { class: 'lab-attachline__v' },
            h('b', { text: info.zh, attrs: info.effect ? { title: info.effect } : undefined }))
          : h('span', { class: 'muted', text: '未选择' })),
      h('button', {
        class: 'btn btn--ghost btn--sm', type: 'button', disabled,
        attrs: { title: disabled ? '近战武器没有改装槽' : `为${slotZh(slot)}选择${label}（按当前流派推荐）` },
        on: { click: (e) => { e.stopPropagation(); openAttachPicker(slot, kind); } },
      }, h('span', { text: info ? '更换' : '选择' })),
      currentId && !disabled ? iconAct('rotate-ccw', `清除${label}`, () => clearAttach(kind, slot), { size: 12 }) : '',
    );
  }
  /** 挂件行：跟随武器行下方，单行显示「突变因子 / 改装」，不再单独占一个带标题的区块 */
  function attachSection(slot) {
    return h('div', { class: 'lab-attachline' }, icon('metagem', { size: 11 }), attachInline('mutator', slot), attachInline('mod', slot));
  }

  /* ----------------------------- 候选抽屉 ----------------------------- */
  function attachOption(slot, kind, row, index, currentId) {
    const info = attachInfo(kind, row.id);
    const zh = row.zh || (info && info.zh) || model.nameOf(row.id) || row.id;
    const en = (info && info.en) || '';
    const effect = (info && info.effect) || '效果原文待验证';
    const why = (Array.isArray(row.why) ? row.why : []).filter(Boolean).slice(0, 2);
    const label = kind === 'mod' ? '改装' : '突变因子';
    return h('button', {
      class: `lab-attachrow${currentId === row.id ? ' is-on' : ''}`, type: 'button',
      attrs: { title: `${zh}${en ? `（${en}）` : ''} · 适配 ${fmt.pct(row.score, 1)}` },
      on: {
        click: () => {
          if (kind === 'mod') S.setModOf(slot, row.id); else S.setMutator(slot, row.id);
          ui.toast(`已装备${label}：${zh}`, 'ok');
          ui.closeDrawer();
        },
      },
    },
      h('span', { class: 'lab-attachrow__k', text: currentId === row.id ? '当前' : `第 ${index + 1} 位` }),
      h('div', {},
        h('div', { class: 'row' }, h('b', { text: zh }), en ? h('span', { class: 'lab-crow__en', text: en }) : '', why.map((w) => tag(w))),
        h('div', { class: 'muted', text: effect, attrs: { title: effect } }),
      ),
      h('span', { class: 'lab-attachrow__acts' }, tag(`适配 ${fmt.pct(row.score, 1)}`)),
    );
  }

  function openAttachPicker(slot, kind) {
    const isMod = kind === 'mod';
    const label = isMod ? '改装' : '突变因子';
    const list = recommend(kind, slot);
    const currentId = isMod ? S.modOf(slot) : S.mutatorOf(slot);
    const body = h('div', { class: 'stack-2' });
    if (!list.length) body.append(emptyTab('没有可用候选（数据未载入、或当前武器类型无对应挂件）'));
    else list.forEach((row, i) => body.append(attachOption(slot, kind, row, i, currentId)));
    ui.openDrawer({
      title: `选择${label} · ${slotZh(slot)}`,
      subtitle: `当前流派「${psZh()}」· 候选 ${list.length} 条（点击即写入）`,
      iconName: isMod ? 'mod' : 'metagem',
      body,
      foot: h('div', { class: 'row row--spread grow' },
        h('span', { class: 'muted', text: isMod
          ? '改装只有远程武器可换；候选已排除近战专用 / 通知类资产行。'
          : '突变因子按武器类型过滤（通用因子任何武器可用）；适配为近似口径。' }),
        currentId ? h('button', {
          class: 'btn btn--quiet btn--sm', type: 'button', attrs: { title: `清除${label}` },
          on: { click: () => { clearAttach(kind, slot); ui.closeDrawer(); } },
        }, icon('rotate-ccw', { size: 12 }), h('span', { text: `清除${label}` })) : ''),
    });
  }

  /* ----------------------------- 右侧推荐面板 ----------------------------- */
  function currentWeaponSlot() {
    for (const slot of WEAPON_SLOTS) if (weaponId(slot)) return slot;
    return null;
  }
  function recCardOf(slot, kind, row, host) {
    const info = attachInfo(kind, row.id, { forCard: true });
    const zh = row.zh || (info && info.zh) || model.nameOf(row.id) || row.id;
    const label = kind === 'mod' ? '改装' : '突变因子';
    const effect = (info && info.effect) || '';
    const tags = kind === 'mod' ? ['远程'] : [WEAPON_ZH[(info && info.rec && info.rec.weapon) || 'any'] || '通用'];
    for (const w of (Array.isArray(row.why) ? row.why : []).slice(0, 2)) tags.push(w);
    if (!effect) tags.push('效果待验证');
    return recCard({
      title: zh,
      sub: (info && info.en) || '',
      score: fmt.pct(row.score, 1),
      tags,
      lines: effect ? [effect] : [],
      actions: [h('button', {
        class: 'btn btn--primary btn--sm', type: 'button',
        attrs: { title: `装备到${slotZh(slot)}的${label}槽` },
        on: {
          click: (e) => {
            e.stopPropagation();
            if (kind === 'mod') S.setModOf(slot, row.id); else S.setMutator(slot, row.id);
            ui.toast(`已装备${label}：${zh}`, 'ok');
            renderRec(host);
          },
        },
      }, icon('flask', { size: 12 }), h('span', { text: '装备' }))],
    });
  }

  function renderRec(host) {
    if (!host) return;
    clear(host);
    const slot = currentWeaponSlot();
    if (!slot) { host.append(emptyTab('先在上方选择武器，再推荐挂件')); return; }
    host.append(h('div', { class: 'lab-bar-title' },
      icon(SLOT_ICON[slot], { size: 13 }),
      h('span', { text: `当前武器：${model.nameOf(weaponId(slot))}（${slotZh(slot)}）· 流派「${psZh()}」` })));
    if (!ensureFit()) { host.append(emptyTab('适配模块未就绪（装备目录未载入），暂时无法推荐挂件')); return; }
    const mutators = recommend('mutator', slot).slice(0, TOP);
    host.append(catSection(`突变因子 · Top ${mutators.length || TOP}`,
      mutators.length ? [recList(mutators.map((row) => recCardOf(slot, 'mutator', row, host)))] : [emptyTab('没有可用突变因子候选')],
      { sub: '点击「装备」写入当前武器' }));
    if (slot === 'melee') {
      host.append(noteLine('近战无改装槽 · 固有改装见详情（数据待验证）'));
    } else {
      const mods = recommend('mod', slot).slice(0, TOP);
      host.append(catSection(`改装 · Top ${mods.length || TOP}`,
        mods.length ? [recList(mods.map((row) => recCardOf(slot, 'mod', row, host)))] : [emptyTab('没有可用改装候选')],
        { sub: '仅远程武器可更换' }));
    }
    host.append(noteLine('适配为近似口径：按当前流派维度权重排序，并对与武器标签契合的候选小幅加成；「契合」不是游戏内评分。'));
  }

  /* ----------------------------- 组装 ----------------------------- */
  function render() {
    clear(shell.body);
    shell.body.append(catBar([{ zh: '槽位' }, { zh: '武器' }, { zh: '属性' }, { zh: '效果' }, { zh: '操作' }]));
    for (const slot of WEAPON_SLOTS) {
      shell.body.append(weaponRow(slot));
      shell.body.append(attachSection(slot));
    }
    clear(shell.foot);
    shell.foot.append(noteLine('改装仅远程武器（长枪 / 手枪）可更换；近战只有固有改装（数据待验证）。突变因子按武器类型过滤（通用因子任何武器可用）。属性与效果取自已收录数据，缺项标「待验证」；适配为近似口径。'));
  }

  render();
  return { el: shell.el, refresh: render, renderRec };
}

export default createWeaponsTab;
