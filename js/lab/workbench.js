/* =============================================================================
   遗迹2 · 遗物档案 — lab/workbench.js（v2）
   工作台主体：15 槽（武器 3 / 护甲 4 / 饰品 6 / 职业 2）+ 配装设置（特性 stepper /
   碎片 / 消耗品 / 场景 / 档位目标 / 预设增益档种子）+ 结果面板（防御 / 生存 / 机动）。
   交互语义按 UX_SPEC §2：点图标/名称=详情（职业=职业选择），×=移除，空槽/更换=选择器。
   ========================================================================== */
import { h, clear, fmt } from '../core/dom.js';
import { icon } from '../core/icons.js';
import { store } from '../core/store.js';
import { ui } from '../core/ui.js';
import { openPicker } from '../components/picker.js';
import { openItemDetail } from '../components/item-detail.js';
import { SLOT_GROUPS, SLOT_LABEL } from './model.js';
import * as S from './state.js';
import {
  SLOT_ICON, itemMedia, miniPiece, meterRow, classBadge, panel, emptyState, emptyLine, fold,
  statGrid, chipGroup, TYPE_ICON, TYPE_COLOR, TYPE_ZH, CLASS_ZH,
} from './parts.js';
import { effectText, condShort } from './text.js';
import { TRAIT_CAP, TRAIT_MAX_LEVEL } from './state.js';

const ARMOR_SLOTS = ['head', 'body', 'legs', 'gloves'];
/** site_data.profiles 里残留的旧译名 → 官方 locres 译名（只影响显示） */
const OFFICIAL_ZH = (s) => String(s || '')
  .replace(/守望者/g, '护卫者')
  .replace(/医师/g, '医务兵')
  .replace(/仪式师/g, '祭祀者')
  .replace(/挑战者/g, '挑战者');
const TRINKET_SLOTS = ['amulet', 'ring1', 'ring2', 'ring3', 'ring4'];

function scaledEffect(eff, factor) {
  const out = {};
  for (const [k, v] of Object.entries(eff || {})) {
    if (typeof v === 'number') out[k] = v * factor;
    else if (v && typeof v === 'object') {
      out[k] = {};
      for (const [rk, rv] of Object.entries(v)) out[k][rk] = typeof rv === 'number' ? rv * factor : rv;
    }
  }
  return out;
}

export function createWorkbench(model, { onOpenPanel = null } = {}) {
  const E = model.engine;
  const root = h('div', { class: 'lab-wb' });
  const slotsHost = h('div', { class: 'lab-wb__slots' });
  const resultHost = h('div', { class: 'lab-wb__result' });

  /* --------------------------- 取名 / 图标 --------------------------- */
  const nameOf = (id) => {
    if (!id) return '';
    const it = model.itemsById.get(id);
    if (it) return it.zh;
    const a = model.findArchetype(id);
    if (a) return a.zh;
    return (model.pieceById.get(id) || {}).zh || id;
  };
  const iconOf = (id) => {
    const p = model.pieceById.get(id);
    if (p && p.iconUrl) return p.iconUrl;
    return model.itemIcon(model.itemsById.get(id));
  };
  const archOf = (id) => (id ? model.findArchetype(id) : null);
  const isOwned = (id) => store.isOwned(id);
  const isMissing = (id) => S.isMissing(id);
  const trinketIds = () => TRINKET_SLOTS.map((s) => store.build.get(s)).filter(Boolean);

  function openDetail(id) { if (id) openItemDetail(id, { route: false, from: 'lab' }); }

  /* --------------------------- 物品 / 职业选择 --------------------------- */
  function pickItem(slot) {
    openPicker({
      slotId: slot,
      currentId: store.build.get(slot) || '',
      title: `选择${SLOT_LABEL[slot]}`,
      onPick(item) {
        if (!item) return;
        if (ARMOR_SLOTS.includes(slot) && !model.isArmor(item.id)) {
          ui.toast(`「${item.zh}」缺少基础护甲数值，无法计入合计`, 'warn');
          return;
        }
        store.build.set(slot, item.id);
        ui.toast(`已装备${SLOT_LABEL[slot]}：${item.zh}`, 'ok');
      },
    });
  }

  /** 职业选择抽屉（数据缺失时给「待验证」容错，不崩） */
  function openArchetypePicker(slot) {
    const label = SLOT_LABEL[slot];
    const body = h('div', { class: 'stack-2' });
    if (!model.archetypes.length) {
      body.append(emptyState('warning', '职业数据载入中',
        'data/archetypes.json 尚未产出（15 个职业正由数据策展人补）。职业槽可先留空，防御合计不受影响。'));
    } else {
      const released = model.archetypes.filter((a) => a.status !== 'unreleased');
      const unreleasedList = model.archetypes.filter((a) => a.status === 'unreleased');
      const archRow = (a) => {
        const perkIds = model.perksOf(a.id);
        const perkText = perkIds.map((pid) => (E.modById.get(pid) || {}).zh).filter(Boolean).join('、');
        const unreleased = a.status === 'unreleased';
        return h('button', {
          class: `lab-archrow${unreleased ? ' is-disabled' : ''}`, type: 'button',
          attrs: unreleased ? { 'aria-disabled': 'true' } : {},
          on: {
            click: () => {
              if (unreleased) { ui.toast(`${a.zh}：DLC4 未实装（待验证），暂不可选`, 'warn'); return; }
              store.build.set(slot, a.id);
              ui.toast(`${label}：${a.zh}`, 'ok');
              ui.closeDrawer();
            },
          },
        },
          h('span', { class: 'lab-archrow__ico' }, icon('archetype', { size: 18 })),
          h('div', { class: 'lab-archrow__body' },
            h('div', { class: 'lab-archrow__name' }, a.zh,
              h('span', { class: 'muted', attrs: { style: 'font-size:10.5px' } }, a.en ? ` · ${a.en}` : ''),
              a.dlcZh && a.dlc !== 'base' ? h('span', { class: 'badge badge--neutral', text: a.dlcZh }) : '',
              unreleased ? h('span', { class: 'badge badge--low', text: '未实装' }) : '',
            ),
            h('div', { class: 'lab-archrow__meta muted', text: a.role ? `定位：${a.role}` : '定位：待验证' }),
            h('div', { class: 'lab-archrow__perks muted', text: perkText ? `防御专长：${perkText}` : '防御专长：未收录' }),
            a.trait && a.trait.zh ? h('div', { class: 'lab-archrow__perks muted', text: `关联特性：${a.trait.zh}（可在特性区块升级）` }) : '',
          ),
          store.build.get(slot) === a.id ? h('span', { class: 'badge badge--gold', text: '当前' }) : '',
        );
      };
      for (const a of released) body.append(archRow(a));
      if (unreleasedList.length) {
        body.append(h('div', { class: 'lab-bar-title', attrs: { style: 'margin-top:10px' } }, '未实装（DLC4 · 待验证）'));
        for (const a of unreleasedList) body.append(archRow(a));
      }
    }
    ui.openDrawer({
      title: `选择${label}`, subtitle: '职业设置 · 数据来自 archetypes.json', iconName: 'archetype',
      body,
      foot: h('div', { class: 'row row--spread grow' },
        h('span', { class: 'muted', attrs: { style: 'font-size:11.5px' } }, '选中后该职业已收录的防御向专长并入合计；主要专长（Prime Perk）不计入防御口径。'),
        h('button', {
          class: 'btn btn--quiet btn--sm', type: 'button', text: '清空该槽',
          on: { click: () => { store.build.remove(slot); ui.toast(`已清空${label}`, 'ok'); ui.closeDrawer(); } },
        }),
      ),
    });
  }

  function pickForSlot(slot) {
    if (slot === 'archetype1' || slot === 'archetype2') openArchetypePicker(slot);
    else pickItem(slot);
  }

  function removeSlot(slot) {
    const id = store.build.get(slot);
    if (!id) return;
    const nm = nameOf(id);
    store.build.remove(slot);
    ui.toast(`已移除 ${nm}`, 'ok', { action: { label: '撤销', fn: () => store.build.set(slot, id) } });
  }

  function slotStatText(slot, id) {
    const p = model.pieceById.get(id);
    if (p && ARMOR_SLOTS.includes(slot)) return `护甲值 ${fmt.num(p.armor, 1)} · 负重 ${fmt.num(p.weight, 1)}`;
    const m = E.modById.get(id);
    if (m && m.category !== 'trait' && m.category !== 'perk') return effectText(m.effect) || '无防御词条';
    const it = model.itemsById.get(id);
    if (it) {
      if (it.summaryZh) return it.summaryZh;
      if (['longGun', 'handGun', 'melee'].includes(it.family)) {
        const bits = [];
        if (it.damage != null) bits.push(`伤害 ${fmt.num(it.damage, it.damage < 10 ? 2 : 0)}`);
        if (it.rate != null) bits.push(`射速 ${fmt.num(it.rate, 1)}`);
        return bits.join(' · ') || '武器';
      }
      return (it.subtitle || '').trim();
    }
    return '';
  }

  function buildSlot(slot) {
    const id = store.build.get(slot);
    const label = SLOT_LABEL[slot];
    const isArch = slot === 'archetype1' || slot === 'archetype2';
    if (!id) {
      const emptyHint = isArch ? (model.archetypesEmpty ? '职业数据载入中' : '点击选择职业') : '点击选择装备';
      return h('div', { class: 'slot slot--empty', dataset: { slot } },
        h('div', { class: 'slot__media' }, icon(SLOT_ICON[slot], { size: 18 })),
        h('div', { class: 'slot__body' },
          h('div', { class: 'slot__label', text: label }),
          h('div', { class: 'slot__name', text: emptyHint }),
        ),
        h('button', {
          class: 'slot__pick', type: 'button', title: `选择${label}`, attrs: { 'aria-label': `选择${label}` },
          on: { click: () => pickForSlot(slot) },
        }),
      );
    }
    const owned = isOwned(id);
    const miss = isMissing(id);
    const arch = isArch ? archOf(id) : null;
    const nm = arch ? arch.zh : nameOf(id);
    const metaText = arch
      ? (() => {
        const perks = model.perksOf(id).map((pid) => (E.modById.get(pid) || {}).zh).filter(Boolean);
        const role = arch.role ? `${arch.role} · ` : '';
        const tr = arch.trait && arch.trait.zh ? ` · 特性 ${arch.trait.zh}` : '';
        return `${role}${perks.length ? `防御专长：${perks.join('、')}` : '防御专长：未收录'}${tr}`;
      })()
      : slotStatText(slot, id);
    const media = h('div', {
      class: 'slot__media',
      attrs: { role: 'button', tabindex: '0', title: isArch ? `更换${label}` : `查看 ${nm} 详情`, 'aria-label': isArch ? `更换${label}` : `查看 ${nm} 详情` },
      on: {
        click: () => (isArch ? pickForSlot(slot) : openDetail(id)),
        keydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (isArch) pickForSlot(slot); else openDetail(id); } },
      },
    }, isArch ? icon('archetype', { size: 20 }) : itemMedia(iconOf(id), { size: 40 }));
    const body = h('div', {
      class: 'slot__body', attrs: { role: 'button', tabindex: '0' },
      on: {
        click: () => (isArch ? pickForSlot(slot) : openDetail(id)),
        keydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (isArch) pickForSlot(slot); else openDetail(id); } },
      },
    },
      h('div', { class: 'slot__label' },
        h('span', { text: label }),
        !isArch && !owned ? h('span', { class: 'badge badge--neutral', text: '未拥有' }) : '',
        miss ? h('span', { class: 'badge badge--low', text: '缺件' }) : '',
      ),
      h('div', { class: 'slot__name', text: nm }),
      h('div', { class: 'slot__meta' }, h('span', { class: 'muted', attrs: { style: 'font-size:10.5px' }, text: metaText })),
      isArch && slot === 'archetype1' ? h('div', { class: 'lab-slotnote', text: '主要专长（Prime Perk）不在防御口径' }) : '',
    );
    const acts = h('div', { class: 'slot__acts' },
      h('button', {
        class: 'iconbtn iconbtn--sm', type: 'button', title: '更换', 'aria-label': `更换${label}`,
        on: { click: (e) => { e.stopPropagation(); pickForSlot(slot); } },
      }, icon('swap', { size: 14 })),
      h('button', {
        class: 'iconbtn iconbtn--sm iconbtn--danger', type: 'button', title: '移除', 'aria-label': `移除${label}`,
        on: { click: (e) => { e.stopPropagation(); removeSlot(slot); } },
      }, icon('x', { size: 14 })),
    );
    const el = h('div', { class: `slot slot--filled${miss ? ' is-missing' : ''}`, dataset: { slot } }, media, body, acts);
    if (miss) el.append(h('span', { class: 'slot__warn', title: '已标记缺件' }, icon('warning', { size: 12 })));
    return el;
  }

  function renderSlots() {
    clear(slotsHost);
    for (const g of SLOT_GROUPS) {
      const grid = h('div', { class: `lab-slots lab-slots--${g.cols}` }, g.slots.map((s) => buildSlot(s)));
      const group = h('div', { class: 'lab-slotgroup' },
        h('div', { class: 'bar-title' }, `${g.title} · ${g.slots.length} 槽`,
          h('span', { class: 'lab-group-hint', text: g.key === 'archetype' ? '选中职业后防御专长并入合计' : '点击槽位选择装备' })),
        grid,
      );
      if (g.key === 'archetype') {
        group.append(h('div', { class: 'lab-note', attrs: { style: 'padding-top:4px' } },
          icon('info', { size: 12 }),
          h('span', { text: model.archetypesEmpty ? '职业数据尚未产出（待验证）；职业槽留空不影响防御合计。' : '只计入已收录的防御向职业专长；主要专长（Prime Perk）不在防御口径内。' })));
      }
      slotsHost.append(group);
    }
  }

  /* --------------------------- 设置：场景 / 档位 --------------------------- */
  const scenarioSel = h('select', { class: 'select', attrs: { 'aria-label': '场景' } },
    E.scenarios.map((s) => h('option', { value: s.id, text: s.zh })));
  scenarioSel.addEventListener('change', () => { S.setScenario(scenarioSel.value); ui.toast(`场景：${E.scenarioById(scenarioSel.value).zh}`, 'ok'); });
  const classSel = h('select', { class: 'select', attrs: { 'aria-label': '档位目标' } },
    [{ id: 'free', zh: '不限' }, ...E.CLASS_ORDER.map((c) => ({ id: c, zh: CLASS_ZH[c] }))]
      .map((o) => h('option', { value: o.id, text: o.zh })));
  classSel.addEventListener('change', () => S.setClassTarget(classSel.value));
  function syncSelects() { scenarioSel.value = S.scenarioId(); classSel.value = S.classTarget(); }

  /* --------------------------- 设置：特性 --------------------------- */
  const traitsHost = h('div', { class: 'lab-traits' });
  const traitCountEl = h('span', { class: 'lab-traits__count' });

  function traitRow(t) {
    const lv = (S.traitLevels()[t.id] || 0);
    const eff = lv > 0 ? effectText(scaledEffect(E.traitPerLevel(t), lv)) : '';
    const dec = h('button', {
      class: 'iconbtn iconbtn--sm', type: 'button', title: `${t.zh} −1`, 'aria-label': `${t.zh} 减一级`,
      disabled: lv <= 0, on: { click: () => S.incTrait(t.id, -1) },
    }, icon('minus', { size: 13 }));
    const inc = h('button', {
      class: 'iconbtn iconbtn--sm', type: 'button', title: `${t.zh} +1`, 'aria-label': `${t.zh} 加一级`,
      disabled: lv >= TRAIT_MAX_LEVEL,
      on: { click: () => { const r = S.incTrait(t.id, 1); if (!r.ok && r.reason === 'cap') ui.toast(`特性最多同时启用 ${TRAIT_CAP} 个（游戏上限）`, 'warn'); } },
    }, icon('plus', { size: 13 }));
    return h('div', { class: `lab-trait${lv > 0 ? ' is-on' : ''}` },
      h('div', { class: 'lab-trait__main' },
        h('div', { class: 'lab-trait__name', text: t.zh }),
        h('div', { class: `lab-trait__eff${lv > 0 ? '' : ' muted'}`, title: eff || '未启用', text: lv > 0 ? eff : '未启用' }),
      ),
      h('div', { class: 'lab-stepper' }, dec, h('span', { class: 'lab-stepper__v', text: `${lv}` }), inc),
    );
  }

  function renderTraits() {
    clear(traitsHost);
    const used = S.traitUsed();
    clear(traitCountEl);
    traitCountEl.append(h('span', { class: `badge ${used >= TRAIT_CAP ? 'badge--mid' : 'badge--neutral'}`, text: `已用特性 ${used}/${TRAIT_CAP}` }));
    for (const t of E.traits) traitsHost.append(traitRow(t));
  }

  /* --------------------------- 设置：碎片 / 消耗品 / 预设 --------------------------- */
  const fragHost = h('div');
  const consHost = h('div');
  const seedHost = h('div');

  function renderPools() {
    clear(fragHost);
    fragHost.append(chipGroup(
      E.fragments.map((m) => ({ id: m.id, zh: m.zh, title: effectText(m.effect) || '无防御词条' })),
      new Set(S.fragments()),
      (it) => { S.toggleFragment(it.id); ui.toast(S.fragments().includes(it.id) ? `已启用碎片：${it.zh}` : `已取消碎片：${it.zh}`, 'ok'); },
      { emptyText: '碎片数据未收录' },
    ));
    clear(consHost);
    consHost.append(chipGroup(
      E.consumables.map((m) => ({ id: m.id, zh: m.zh, title: effectText(m.effect) || '无防御词条' })),
      new Set(S.consumables()),
      (it) => { S.toggleConsumable(it.id); ui.toast(S.consumables().includes(it.id) ? `已启用消耗品：${it.zh}` : `已取消消耗品：${it.zh}`, 'ok'); },
      { emptyText: '消耗品数据未收录' },
    ));
    clear(seedHost);
    const active = S.seedProfile();
    const wrap = h('div', { class: 'lab-chips' });
    for (const p of E.profiles) {
      wrap.append(h('button', {
        class: `chip chip--sm${active === p.id ? ' is-on' : ''}`, type: 'button',
        title: '把该增益档的特性 / 碎片 / 消耗品 / 职业专长灌入显式设置，并把项链戒指写入槽位',
        on: {
          click: () => {
            const r = S.applyProfileSeed(model, p.id);
            ui.toast(r ? `已载入增益档：${p.zh}（特性 ${r.traitCount} 个）` : '载入失败', r ? 'ok' : 'warn');
          },
        },
      }, h('span', { text: OFFICIAL_ZH(String(p.zh).replace(/（[^）]*）/g, '').trim() || p.zh) })));
    }
    seedHost.append(wrap,
      active ? h('div', { class: 'lab-note' },
        icon('info', { size: 12 }),
        h('span', { text: `当前种子：${(E.profileById.get(active) || {}).zh || active}。种子里的职业专长会计入合计；清除种子不会改已经灌入的特性等级。` }),
        h('button', { class: 'btn btn--quiet btn--sm', type: 'button', text: '清除种子', on: { click: () => { S.clearSeed(); ui.toast('已清除增益档种子', 'ok'); } } }),
      ) : '');
  }

  /* --------------------------- 结果面板 --------------------------- */
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
        isMissing(id) ? h('span', { class: 'badge badge--low', text: '缺件' }) : '',
        !isOwned(id) ? h('span', { class: 'badge badge--neutral', text: '未拥有' }) : '',
      );
    });
    const perkRows = [];
    for (const slot of ['archetype1', 'archetype2']) {
      const aid = slots[slot];
      if (!aid) continue;
      const a = archOf(aid);
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
    for (const id of trinketIds()) pushMod(id);

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

  /* --------------------------- 组装 --------------------------- */
  const slotsTools = h('div', { class: 'row', attrs: { style: 'gap:6px' } });
  function renderSlotTools() {
    clear(slotsTools);
    if (S.missingCount()) {
      slotsTools.append(h('span', { class: 'chip chip--sm is-on', title: '缺件独立于拥有状态' }, icon('x-circle', { size: 12 }), h('span', { text: `缺件 ${S.missingCount()}` })));
      slotsTools.append(h('button', { class: 'btn btn--quiet btn--sm', type: 'button', text: '清空', on: { click: () => { S.clearMissing(); ui.toast('已清空缺件标记', 'ok'); } } }));
    }
    slotsTools.append(h('button', {
      class: 'btn btn--ghost btn--sm', type: 'button',
      on: { click: () => onOpenPanel?.('recommend') },
    }, icon('listchecks', { size: 13 }), h('span', { text: '按缺件重算最优' })));
  }

  const slotsPanel = panel('配装槽位', { iconName: 'grid', sub: '15 槽 · 职业 + 特性实时生效' });
  slotsPanel.querySelector('.panel__tools').append(slotsTools);
  slotsPanel.querySelector('.panel__body').append(slotsHost);

  const settingsPanel = panel('配装设置', { iconName: 'trait', sub: '写入存档 meta，随配装一起保存' });
  settingsPanel.querySelector('.panel__body').append(
    h('div', { class: 'lab-fieldrow' },
      h('div', { class: 'field' }, h('label', { class: 'field__label', text: '场景' }), scenarioSel),
      h('div', { class: 'field' }, h('label', { class: 'field__label', text: '档位目标（推荐 / 重算用）' }), classSel),
    ),
    h('div', { class: 'lab-traitshead' },
      h('div', { class: 'bar-title' }, '特性等级', traitCountEl),
      h('div', { class: 'row', attrs: { style: 'gap:4px' } },
        h('button', {
          class: 'btn btn--quiet btn--sm', type: 'button', text: '全满',
          on: { click: () => { S.fillTraits(E.traits); ui.toast(`已将前 ${TRAIT_CAP} 个防御特性设为满级（游戏上限 ${TRAIT_CAP} 个）`, 'ok'); } },
        }),
        h('button', { class: 'btn btn--quiet btn--sm', type: 'button', text: '清空', on: { click: () => { S.clearTraits(); ui.toast('已清空特性', 'ok'); } } }),
      ),
    ),
    traitsHost,
    fold('圣物碎片', fragHost, { sub: '勾选参与合计' }),
    fold('消耗品', consHost, { sub: '勾选参与合计' }),
    fold('从预设增益档载入', seedHost, { sub: '仅作起点' }),
  );

  const resultPanel = panel('结果面板', { iconName: 'chart', sub: '防御 / 生存 / 机动' });
  resultPanel.querySelector('.panel__body').append(
    resultHead,
    h('div', { class: 'lab-resseg' }, resultSeg),
    resultBody,
    breakdownHost,
    renderFormula(),
  );

  root.append(h('div', { class: 'lab-wb__main' }, slotsPanel, settingsPanel), h('aside', { class: 'lab-wb__side' }, resultPanel));

  /* --------------------------- 刷新调度 --------------------------- */
  let raf = 0;
  function refresh() {
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      syncSelects();
      renderSlotTools();
      renderSlots();
      renderTraits();
      renderPools();
      renderResult();
    });
  }

  const offs = [];
  offs.push(S.on((reason) => {
    if (['missing', 'scenario', 'class-target', 'seed'].includes(reason)) refresh();
  }));
  offs.push(store.on('build', refresh));
  offs.push(store.on('owned', () => refresh()));

  syncSelects();
  renderSlotTools();
  renderSlots();
  renderTraits();
  renderPools();
  renderResult();

  return {
    el: root,
    refresh,
    destroy() {
      for (const off of offs) { try { off(); } catch { /* ignore */ } }
      if (raf) cancelAnimationFrame(raf);
    },
  };
}

export default createWorkbench;
