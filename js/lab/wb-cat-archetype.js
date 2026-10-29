/* =============================================================================
   遗迹2 · 遗物档案 — lab/wb-cat-archetype.js（装配台 v5 · 职业与技能）
   主 / 副职业 = 2 张并排槽位卡：名 + 英文 + DLC 徽章，卡底技能记录条（选择 / 清除）。
   卡下方「效果汇总」逐职业列定位、防御专长（专长名 + effectText）与关联特性；
   技能由 skills.js 从解包数据按职业推导，只做配装记录，不参与防御合计；
   英文原文放折叠区 / 待验证标记不变。右侧推荐 = 防御向职业 Top4（逻辑不动）。
   数据口径见页脚与推荐脚注；本文件不新增数据、不改 CSS。
   ========================================================================== */
import { h, clear, fmt } from '../core/dom.js';
import { icon } from '../core/icons.js';
import { SLOT_LABEL } from './model.js';
import { effectText, condShort } from './text.js';
import { deriveSkills } from './skills.js';
import {
  CAT_BY_ID, catShell, noteLine, recCard, recList, tag, iconAct, emptyTab,
  slotCard, slotStrip, linkHover, digest, digestRow,
} from './wb-parts.js';

const REC_TOP = 4;
const MAX_REC_PERKS = 3;
const ARCH_SLOTS = ['archetype1', 'archetype2'];

/** 防御贡献分（透明权重，只用于本页排序；不是游戏内精确数值） */
function defenseScore(acc) {
  return acc.ae * 100 + acc.armorFlat + acc.flatDR * 100 + acc.hpMax
    + acc.hpPct * 100 + acc.shieldPct * 100 + acc.resFlat.reduce((n, v) => n + v, 0);
}

/** 贡献分构成（只列非 0 项，作为推荐卡片的 chips，便于核对） */
function scoreParts(acc) {
  const parts = [];
  if (acc.ae) parts.push(`护甲效果 ${fmt.pct(acc.ae, 0)}`);
  if (acc.armorFlat) parts.push(`护甲值 ${fmt.sign(acc.armorFlat, 1)}`);
  if (acc.flatDR) parts.push(`固定减伤 ${fmt.pct(acc.flatDR, 1)}`);
  if (acc.hpMax) parts.push(`生命 ${fmt.sign(acc.hpMax, 1)}`);
  if (acc.hpPct) parts.push(`生命 ${fmt.pct(acc.hpPct, 0)}`);
  if (acc.shieldPct) parts.push(`护盾 ${fmt.pct(acc.shieldPct, 0)}`);
  const res = acc.resFlat.reduce((n, v) => n + v, 0);
  if (res) parts.push(`五类抗性合计 ${fmt.sign(res, 1)}`);
  return parts;
}

export function createArchetypeTab(ctx) {
  const { model, E, store, ui, S } = ctx;
  const skills = deriveSkills(model);
  const skillMap = skills.byArchetype;
  const cat = CAT_BY_ID.get('archetype') || { zh: '职业与技能', sub: '', icon: 'archetype' };
  const shell = catShell({ title: cat.zh, sub: cat.sub, iconName: cat.icon });

  /* ----------------------------- 状态：技能记录 ----------------------------- */
  /** meta.skills = { archetype1: skillId, archetype2: skillId }；脏数据一律当空 */
  function marks() {
    const raw = S.meta().skills;
    return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  }
  /** 槽位当前记录的技能 id；不属于该职业技能表（旧数据 / 已换职业）→ 忽略 */
  function markedId(slot, list) {
    const id = marks()[slot];
    if (typeof id !== 'string' || !id) return null;
    return list.some((skill) => skill.id === id) ? id : null;
  }
  function toggleSkill(slot, skill, list) {
    const next = { ...marks() };
    const on = markedId(slot, list) === skill.id;
    next[slot] = on ? null : skill.id;
    store.build.setMeta({ skills: next });
    ui.toast(on ? `已取消技能记录：${skill.zh}` : `${SLOT_LABEL[slot]}技能：${skill.zh}（不参与防御合计）`, 'ok');
  }

  /* ----------------------------- 职业小件 ----------------------------- */
  function archIconUrl(a) {
    const engram = a && a.raw && a.raw.engram;
    const engramId = engram && typeof engram.id === 'string' ? engram.id : '';
    return engramId ? (ctx.iconOf(engramId) || null) : null;
  }
  function dlcBadge(a) {
    const zh = a.dlcZh || '未知来源';
    return h('span', { class: 'badge badge--neutral', title: `内容来源：${zh}`, text: zh });
  }
  /** 防御专长逐条（汇总行）：专长名 + effectText + 触发条件 */
  function perkLine(pm) {
    const cond = condShort(pm);
    return h('div', { class: 'lab-digest__line' },
      h('b', { text: `${pm.zh || pm.id || '未知专长'}：` }),
      h('span', { text: effectText(pm.effect) || '无防御词条' }),
      cond ? h('span', { class: 'muted', text: `（${cond}）` }) : '',
    );
  }
  /** 关联特性（汇总行）：特性名 + 满级效果（未收录处标待验证） */
  function traitLine(a) {
    const trait = a.trait;
    const eff = trait && trait.raw && trait.raw.effect_at_max ? effectText(trait.raw.effect_at_max) : '';
    return h('div', { class: 'lab-digest__line' },
      h('b', { text: `关联特性：${trait && trait.zh ? trait.zh : '待验证'}` }),
      h('span', { class: 'muted', text: eff ? ` · ${eff}` : ' · 特性数值未收录（待验证）' }),
    );
  }

  /* ----------------------------- 技能卡 ----------------------------- */
  /** 摘要可读性：裸解包字段（HasActive / StateMachine / Full 等 ASCII 片段）不直接展示 */
  const SUMMARY_JUNK = /[A-Za-z]{2,}/;
  const NUM_TOKEN = /\d+(?:\.\d+)?/g;
  /** null = 摘要含裸解包字段不可读；[] = 空 / 待验证 / 全被 nums 覆盖；数组 = 可展示的中文摘要段 */
  function summarySegments(skill) {
    const raw = String(skill.summary || '');
    if (!raw || raw === '效果待验证') return [];
    if (SUMMARY_JUNK.test(raw)) return null;
    const covered = new Set(skill.nums.flatMap((row) => String(row.value).match(NUM_TOKEN) || []));
    return raw.split(/[；;]/).map((seg) => seg.trim()).filter((seg) => {
      if (!seg) return false;
      const tokens = seg.match(NUM_TOKEN) || [];
      return !tokens.some((tok) => covered.has(tok));
    });
  }
  function skillIcon(skill) {
    if (!skill.iconUrl) return h('span', { class: 'lab-crow__slotico' }, icon('skill', { size: 13 }));
    return h('img', {
      class: 'lab-skillcard__ico', src: skill.iconUrl, alt: `${skill.zh} 图标`, width: 18, height: 18, loading: 'lazy',
      on: { error: (e) => { e.currentTarget.style.visibility = 'hidden'; } },
    });
  }
  function skillCard(slot, skill, list, { inDrawer = false } = {}) {
    const on = markedId(slot, list) === skill.id;
    const segments = summarySegments(skill);
    const junk = segments === null;
    const missingAll = !skill.nums.length && !junk;
    const chips = skill.nums.length
      ? skill.nums.map((row) => tag(`${row.label} ${row.value}`))
      : (missingAll ? [tag('数值与效果均未收录（待验证）')] : []);
    const sumText = junk ? '效果原文待验证' : (segments || []).join('；');
    const card = h('button', {
      class: `lab-skillcard${on ? ' is-on' : ''}`,
      type: 'button',
      attrs: {
        'aria-pressed': on ? 'true' : 'false',
        'aria-label': `${skill.zh}：${on ? '已记录，点击取消' : '点击记录为本槽技能'}`,
        title: on ? '点击取消该技能记录' : '点击记录该技能（不参与防御合计）',
      },
    },
      h('div', { class: 'lab-skillcard__name' }, skillIcon(skill), h('span', { text: skill.zh })),
      skill.en ? h('div', { class: 'lab-crow__en', text: skill.en }) : '',
      chips.length ? h('div', { class: 'lab-skillcard__meta' }, chips) : '',
      sumText ? h('div', { class: 'lab-skillcard__sum', text: sumText }) : '',
      h('div', { class: 'lab-skillcard__foot' },
        on
          ? h('span', { class: 'badge badge--gold', text: `已选 · ${SLOT_LABEL[slot] || '技能'}` })
          : h('span', { class: 'lab-skillcard__src', text: '点击选择' }),
      ),
      skill.descEn
        ? h('details', { class: 'lab-fold' },
          h('summary', {}, icon('chevron-right', { size: 11, cls: 'lab-fold__chev' }), h('span', { text: '英文原文' })),
          h('div', { class: 'lab-fold__body', text: skill.descEn }),
        )
        : null,
    );
    // 原生 button 自带键盘激活；只排除折叠区点击，避免展开英文原文时误改选择
    card.addEventListener('click', (e) => {
      if (e.target.closest('details')) return;
      toggleSkill(slot, skill, list);
      if (inDrawer) ui.closeDrawer();
    });
    return card;
  }

  /** 技能抽屉：3 选 1 的完整信息（行内只显示已记录的那一条，避免技能卡占半屏） */
  function openSkillDrawer(slot, a) {
    const list = skillMap.get(a.id) || [];
    const selId = markedId(slot, list);
    const body = h('div', { class: 'lab-skillgrid lab-skillgrid--drawer' },
      list.map((skill) => skillCard(slot, skill, list, { inDrawer: true })));
    ui.openDrawer({
      title: `技能 · ${a.zh}`, subtitle: '3 选 1 · 卷轴记录，不参与防御合计', iconName: 'skill',
      body: list.length ? body : emptyTab('该职业技能数据未收录（待验证）'),
      foot: h('div', { class: 'row row--spread grow' },
        h('span', { class: 'muted', text: '点击卡片记录 / 再点取消；技能不影响下方数值合计。' }),
        selId ? h('button', {
          class: 'btn btn--quiet btn--sm', type: 'button', text: '清除记录',
          on: { click: () => { toggleSkill(slot, list.find((s) => s.id === selId), list); ui.closeDrawer(); } },
        }) : ''),
    });
  }

  /** 职业卡底技能记录条：技能名 + 摘要 + [选择/更换] + 清除（卡内单行，窄屏自动换行） */
  function skillLine(slot, a) {
    const list = skillMap.get(a.id) || [];
    const selId = markedId(slot, list);
    const sel = selId ? list.find((skill) => skill.id === selId) : null;
    if (!list.length) {
      return h('div', { class: 'lab-attachline' },
        h('div', { class: 'row row--wrap' },
          icon('skill', { size: 11 }),
          h('span', { class: 'lab-attachline__k', text: '技能' }),
          h('span', { class: 'muted', text: a.status === 'unreleased' ? '未实装 · 技能数据待验证' : '技能数据未收录（待验证）' })));
    }
    return h('div', { class: 'lab-attachline' },
      h('div', { class: 'row row--wrap' },
        icon('skill', { size: 11 }),
        h('span', { class: 'lab-attachline__k', text: '技能' }),
        sel
          ? h('span', { class: 'lab-attachline__v' },
            h('b', { text: sel.zh }),
            h('span', { class: 'lab-attachline__eff', text: sel.summary || sel.nums.map((n) => `${n.label} ${n.value}`).join(' · '), attrs: { title: sel.summary || '' } }))
          : h('span', { class: 'muted', text: '未记录（可选）' }),
        h('button', {
          class: 'btn btn--ghost btn--sm', type: 'button',
          attrs: { title: `查看${a.zh}的 3 个技能并记录一个` },
          on: { click: (e) => { e.stopPropagation(); openSkillDrawer(slot, a); } },
        }, h('span', { text: sel ? '更换' : '选择' })),
        sel ? iconAct('rotate-ccw', '清除技能记录', () => toggleSkill(slot, sel, list), { size: 12 }) : '',
      ),
    );
  }

  /* ----------------------------- 槽位卡（主 / 副职业 = 2 张并排） ----------------------------- */
  function archCard(slot) {
    const label = SLOT_LABEL[slot] || slot;
    const id = store.build.get(slot);
    if (!id) {
      return slotCard({ label, iconName: 'archetype', empty: true, onOpen: () => ctx.pickForSlot(slot) });
    }
    const a = model.findArchetype(id);
    const actions = [
      { icon: 'swap', title: `更换${label}`, onClick: () => ctx.pickForSlot(slot) },
      { icon: 'x', title: `移除${label}`, danger: true, onClick: () => ctx.removeSlot(slot) },
    ];
    if (!a) {
      return slotCard({
        label, iconName: 'archetype', zh: model.nameOf(id) || id,
        tags: [tag('职业数据未收录（待验证）')],
        onOpen: () => ctx.pickForSlot(slot),
        actions,
      });
    }
    const unreleased = a.status === 'unreleased';
    const tags = [dlcBadge(a)];
    if (unreleased) tags.push(h('span', { class: 'badge badge--low', text: '未实装（待验证）' }));
    return slotCard({
      label,
      iconName: 'archetype',
      iconUrl: archIconUrl(a),
      zh: a.zh,
      en: a.en,
      tags,
      onOpen: () => ctx.pickForSlot(slot),
      actions,
      extra: h('div', { class: 'lab-slot__extra' }, skillLine(slot, a)),
    });
  }

  /* ----------------------------- 效果汇总 ----------------------------- */
  function archDigestRow(slot) {
    const label = SLOT_LABEL[slot] || slot;
    const id = store.build.get(slot);
    if (!id) return digestRow({ label, empty: true });
    const a = model.findArchetype(id);
    if (!a) {
      return digestRow({
        label,
        zh: model.nameOf(id) || id,
        tags: [tag('职业数据未收录（待验证）')],
        lines: ['职业数据未收录（待验证）'],
      });
    }
    const tags = [tag(a.role ? `定位：${a.role}` : '定位：待验证')];
    if (a.status === 'unreleased') tags.push(tag('未实装（待验证）'));
    const perkIds = model.perksOf(a.id);
    const lines = perkIds.length
      ? perkIds.map((pid) => perkLine(E.modById.get(pid) || { id: pid }))
      : [h('div', { class: 'lab-digest__line muted', text: '防御专长未收录（待验证）' })];
    lines.push(traitLine(a));
    return digestRow({ label, iconUrl: archIconUrl(a), zh: a.zh, tags, lines });
  }

  /** 汇总合计：已记录技能数 + DLC 来源职业数（均取自已选职业与 meta.skills） */
  function archSums() {
    const filled = ARCH_SLOTS.filter((slot) => store.build.get(slot)).length;
    if (!filled) return [];
    let skillCount = 0;
    let dlcCount = 0;
    for (const slot of ARCH_SLOTS) {
      const id = store.build.get(slot);
      const a = id ? model.findArchetype(id) : null;
      const list = a ? (skillMap.get(a.id) || []) : [];
      if (markedId(slot, list)) skillCount += 1;
      if (a && a.dlc && a.dlc !== 'base') dlcCount += 1;
    }
    return [
      {
        k: '已记录技能', v: `${skillCount}/${ARCH_SLOTS.length}`, iconName: 'skill',
        title: '主 / 副职业各自记录 1 个技能；只做配装记录，不参与防御合计',
      },
      {
        k: 'DLC 来源', v: `${dlcCount}/${ARCH_SLOTS.length}`, iconName: 'archetype',
        title: '主 / 副职业中内容来源为 DLC 的数量',
      },
    ];
  }

  /* ----------------------------- 推荐：防御贡献 Top4 ----------------------------- */
  function recRows() {
    const archetypes = Array.isArray(model.selectableArchetypes) ? model.selectableArchetypes : [];
    const rows = archetypes.map((a, order) => {
      const perkIds = model.perksOf(a.id);
      const perks = {};
      for (const pid of perkIds) perks[pid] = true;
      const acc = E.expandMods({ perks });
      return { a, order, perkIds, acc, score: Math.round(defenseScore(acc) * 10) / 10 };
    });
    rows.sort((x, y) => (y.score - x.score) || (x.order - y.order));
    return rows.slice(0, REC_TOP);
  }
  function assignBtn(slot, text, onText, a) {
    const on = store.build.get(slot) === a.id;
    return h('button', {
      class: `btn btn--sm${on ? ' btn--quiet' : ' btn--primary'}`, type: 'button',
      text: on ? onText : text, disabled: on,
      on: { click: () => { store.build.set(slot, a.id); ui.toast(`${SLOT_LABEL[slot]}：${a.zh}`, 'ok'); } },
    });
  }
  function recCardOf(row) {
    const { a, perkIds, acc, score } = row;
    const tags = [a.en || '', a.dlcZh && a.dlc !== 'base' ? a.dlcZh : ''].filter(Boolean);
    if (store.build.get('archetype1') === a.id) tags.push('当前主职业');
    if (store.build.get('archetype2') === a.id) tags.push('当前副职业');
    const shownPerks = perkIds.slice(0, MAX_REC_PERKS);
    const lines = perkIds.length
      ? shownPerks.map((pid) => {
        const pm = E.modById.get(pid) || {};
        const cond = condShort(pm);
        return `${pm.zh || pid}：${effectText(pm.effect) || '无防御词条'}${cond ? `（${cond}）` : ''}`;
      })
      : ['防御专长未收录（待验证）：已收录的防御向专长里没有该职业条目，不代表游戏内没有防御专长。'];
    if (perkIds.length > MAX_REC_PERKS) lines.push(`等共 ${perkIds.length} 条已收录防御专长（逐条见上方职业卡汇总）`);
    const traitZh = a.trait && a.trait.zh;
    if (traitZh) lines.push(`关联特性：${traitZh}`);
    const parts = scoreParts(acc);
    return recCard({
      title: a.zh,
      sub: a.role ? `定位：${a.role}` : '定位：待验证',
      score: fmt.num(score, 1),
      tags,
      meta: parts.length ? parts.map((part) => tag(part)) : [tag('无计入项 · 专长未收录')],
      lines,
      actions: [
        assignBtn('archetype1', '设为主职业', '当前主职业', a),
        assignBtn('archetype2', '设为副职业', '当前副职业', a),
      ],
    });
  }
  function renderRec(host) {
    clear(host);
    if (!Array.isArray(model.selectableArchetypes) || !model.selectableArchetypes.length) {
      host.append(emptyTab('职业数据尚未载入（data/archetypes.json），暂时无法推荐。'));
      return;
    }
    const rows = recRows();
    host.append(h('div', { class: 'lab-recn' },
      h('div', { class: 'lab-recn__head' },
        h('div', { class: 'lab-recn__title', text: '防御向职业推荐' }),
        tag(`Top ${rows.length}`), tag('按防御贡献分排序'),
      ),
      recList(rows.map(recCardOf)),
      h('div', { class: 'lab-recn__foot muted' },
        h('span', { text: '口径：防御贡献 = 护甲效果%×100 + 护甲值 + 固定减伤%×100 + 生命上限 + 生命%×100 + 护盾%×100 + 五类抗性合计；按引擎口径折算 stacks×uptime 期望；不含体力 / 闪避 / 敌人减伤 / 元素减伤。只统计已收录的防御向专长（非每职业全部专长），未收录职业为 0 / 待验证；该分仅用于本页排序，不是游戏内精确数值。' }),
      ),
    ));
  }

  /* ----------------------------- 组装 / 刷新 ----------------------------- */
  function render() {
    clear(shell.body);
    const cards = new Map();
    const rows = new Map();
    const strip = slotStrip(ARCH_SLOTS.map((slot) => {
      const card = archCard(slot);
      cards.set(slot, card);
      return card;
    }));
    const filled = ARCH_SLOTS.filter((slot) => store.build.get(slot)).length;
    const sum = digest({
      title: '效果汇总',
      sub: `主 / 副职业 · 已选 ${filled}/${ARCH_SLOTS.length}`,
      iconName: 'archetype',
      rows: ARCH_SLOTS.map((slot) => {
        const row = archDigestRow(slot);
        rows.set(slot, row);
        return row;
      }),
      sums: archSums(),
      foot: filled ? [] : ['选择主 / 副职业后，这里逐条列出定位、防御专长与关联特性。'],
    });
    shell.body.append(h('div', { class: 'lab-cat__pad' }, strip, sum));
    /* 悬停卡片 ↔ 汇总行双向高亮 */
    for (const slot of ARCH_SLOTS) linkHover(cards.get(slot), rows.get(slot));
    clear(shell.foot);
    shell.foot.append(
      noteLine(`技能不参与防御合计，仅为配装记录。${skills.note}。`),
      noteLine('职业定位与防御专长取 archetypes.json + site_data.modifiers.perks 的防御向子集（非每职业全部专长）；数值缺口与未收录处标「待验证」，不编造。'),
    );
  }

  render();
  return { el: shell.el, refresh: render, renderRec };
}

export default createArchetypeTab;
