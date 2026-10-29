/* =============================================================================
   遗迹2 · 遗物档案 — lab/wb-slots.js
   工作台的「15 槽」模块：槽位渲染 / 分组提示 / 槽位摘要 / 选择器分发。
   交互语义按 UX_SPEC §2：点图标/名称=详情（职业=职业选择），×=移除，空槽/更换=选择器。
   共享状态从显式上下文 ctx 读取（由 workbench.js 的 createContext 装配），不依赖跨文件闭包；
   DOM 顺序与 class 与原 workbench 保持一致。
   ========================================================================== */
import { h, clear, fmt } from '../core/dom.js';
import { icon } from '../core/icons.js';
import { openPicker } from '../components/picker.js';
import { SLOT_GROUPS, SLOT_LABEL } from './model.js';
import { SLOT_ICON, itemMedia, emptyState } from './parts.js';
import { effectText } from './text.js';

/** 护甲四槽（工作台合计口径） */
export const ARMOR_SLOTS = ['head', 'body', 'legs', 'gloves'];
/** 饰品五槽（参与合计的项链 / 四枚戒指） */
export const TRINKET_SLOTS = ['amulet', 'ring1', 'ring2', 'ring3', 'ring4'];

/* --------------------------- 物品 / 职业选择 --------------------------- */
export function pickItem(ctx, slot) {
  const { model, store, ui } = ctx;
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
export function openArchetypePicker(ctx, slot) {
  const { model, store, ui, E } = ctx;
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

export function pickForSlot(ctx, slot) {
  if (slot === 'archetype1' || slot === 'archetype2') openArchetypePicker(ctx, slot);
  else pickItem(ctx, slot);
}

export function removeSlot(ctx, slot) {
  const { store, ui, nameOf } = ctx;
  const id = store.build.get(slot);
  if (!id) return;
  const nm = nameOf(id);
  store.build.remove(slot);
  ui.toast(`已移除 ${nm}`, 'ok', { action: { label: '撤销', fn: () => store.build.set(slot, id) } });
}

/* ------------------------------- 槽位卡片 ------------------------------- */
function slotStatText(ctx, slot, id) {
  const { model, E } = ctx;
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

export function buildSlot(ctx, slot) {
  const { model, store, nameOf, iconOf, archOf, isMissing, openDetail, E, S, ui } = ctx;
  const id = store.build.get(slot);
  const label = SLOT_LABEL[slot];
  const isArch = slot === 'archetype1' || slot === 'archetype2';
  const isWeapon = slot === 'longGun' || slot === 'handGun' || slot === 'melee';
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
        on: { click: () => pickForSlot(ctx, slot) },
      }),
    );
  }
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
    : slotStatText(ctx, slot, id);
  /* 武器槽：显示已选突变因子 / 改装（实验室 v2；空则提示去「武器改装」面板） */
  const attach = isWeapon
    ? (() => {
      const a = S.attachmentOf(slot);
      const mut = a.mutator ? `突变 ${nameOf(a.mutator)}` : '';
      const mod = slot !== 'melee' && a.mod ? `改装 ${nameOf(a.mod)}` : '';
      return [mut, mod].filter(Boolean).join(' · ');
    })()
    : '';
  const media = h('div', {
    class: 'slot__media',
    attrs: { role: 'button', tabindex: '0', title: isArch ? `更换${label}` : `查看 ${nm} 详情`, 'aria-label': isArch ? `更换${label}` : `查看 ${nm} 详情` },
    on: {
      click: () => (isArch ? pickForSlot(ctx, slot) : openDetail(id)),
      keydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (isArch) pickForSlot(ctx, slot); else openDetail(id); } },
    },
  }, isArch ? icon('archetype', { size: 20 }) : itemMedia(iconOf(id), { size: 40 }));
  const body = h('div', {
    class: 'slot__body', attrs: { role: 'button', tabindex: '0' },
    on: {
      click: () => (isArch ? pickForSlot(ctx, slot) : openDetail(id)),
      keydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (isArch) pickForSlot(ctx, slot); else openDetail(id); } },
    },
  },
    h('div', { class: 'slot__label' },
      h('span', { text: label }),
      miss ? h('span', { class: 'badge badge--low', text: '缺件' }) : '',
    ),
    h('div', { class: 'slot__name', text: nm }),
    h('div', { class: 'slot__meta' }, h('span', { class: 'muted', attrs: { style: 'font-size:10.5px' }, text: metaText })),
    isWeapon
      ? h('div', { class: 'slot__meta' },
        h('span', { class: 'muted', attrs: { style: 'font-size:10.5px' }, text: attach ? `挂件：${attach}` : '挂件：未选（去「武器改装」面板）' }))
      : '',
    isArch && slot === 'archetype1' ? h('div', { class: 'lab-slotnote', text: '主要专长（Prime Perk）不在防御口径' }) : '',
  );
  const acts = h('div', { class: 'slot__acts' },
    h('button', {
      class: `iconbtn iconbtn--sm${miss ? ' is-on' : ''}`, type: 'button',
      title: miss ? '取消缺件标记' : '标记为缺件（没有这件装备）', 'aria-label': miss ? '取消缺件标记' : `标记${label}为缺件`,
      on: {
        click: (e) => {
          e.stopPropagation();
          const on = S.toggleMissing(id);
          ui.toast(on ? `已标记缺件：${nm}` : `已取消缺件：${nm}`, on ? 'warn' : 'ok');
        },
      },
    }, icon('x-circle', { size: 14 })),
    isWeapon
      ? h('button', {
        class: 'iconbtn iconbtn--sm', type: 'button', title: '打开武器改装面板', 'aria-label': '打开武器改装面板',
        on: { click: (e) => { e.stopPropagation(); ctx.onOpenPanel?.('weapons'); } },
      }, icon('metagem', { size: 14 }))
      : '',
    h('button', {
      class: 'iconbtn iconbtn--sm', type: 'button', title: '更换', 'aria-label': `更换${label}`,
      on: { click: (e) => { e.stopPropagation(); pickForSlot(ctx, slot); } },
    }, icon('swap', { size: 14 })),
    h('button', {
      class: 'iconbtn iconbtn--sm iconbtn--danger', type: 'button', title: '移除', 'aria-label': `移除${label}`,
      on: { click: (e) => { e.stopPropagation(); removeSlot(ctx, slot); } },
    }, icon('x', { size: 14 })),
  );
  const el = h('div', { class: `slot slot--filled${miss ? ' is-missing' : ''}`, dataset: { slot } }, media, body, acts);
  if (miss) el.append(h('span', { class: 'slot__warn', title: '已标记缺件' }, icon('warning', { size: 12 })));
  return el;
}

/* --------------------------------- 分组 --------------------------------- */
export function renderSlots(ctx) {
  const host = ctx.slotsHost;
  clear(host);
  for (const g of SLOT_GROUPS) {
    const grid = h('div', { class: `lab-slots lab-slots--${g.cols}` }, g.slots.map((s) => buildSlot(ctx, s)));
    const group = h('div', { class: 'lab-slotgroup' },
      h('div', { class: 'bar-title' }, `${g.title} · ${g.slots.length} 槽`,
        h('span', { class: 'lab-group-hint', text: g.key === 'archetype' ? '选中职业后防御专长并入合计' : '点击槽位选择装备' })),
      grid,
    );
    if (g.key === 'archetype') {
      group.append(h('div', { class: 'lab-note', attrs: { style: 'padding-top:4px' } },
        icon('info', { size: 12 }),
        h('span', { text: ctx.model.archetypesEmpty ? '职业数据尚未产出（待验证）；职业槽留空不影响防御合计。' : '只计入已收录的防御向职业专长；主要专长（Prime Perk）不在防御口径内。' })));
    }
    host.append(group);
  }
}

/** 槽位工具栏：可用说明 + 缺件摘要 + 清空 + 快捷入口 */
export function renderSlotTools(ctx) {
  const { S, ui, onOpenPanel } = ctx;
  const host = ctx.slotsTools;
  clear(host);
  host.append(h('span', { class: 'chip chip--sm', title: '实验室默认全库可用；没有的装备标为缺件即可' },
    icon('check-circle', { size: 12 }), h('span', { text: '全库可用' })));
  if (S.missingCount()) {
    host.append(h('span', { class: 'chip chip--sm is-on', title: '缺件 = 你没有的装备，推荐/组合/替换都会排除它' }, icon('x-circle', { size: 12 }), h('span', { text: `缺件 ${S.missingCount()}` })));
    host.append(h('button', { class: 'btn btn--quiet btn--sm', type: 'button', text: '清空缺件', on: { click: () => { S.clearMissing(); ui.toast('已清空缺件标记', 'ok'); } } }));
  }
  host.append(h('button', {
    class: 'btn btn--ghost btn--sm', type: 'button',
    on: { click: () => onOpenPanel?.('trinkets') },
  }, icon('gem', { size: 13 }), h('span', { text: '按流派配饰品' })));
  host.append(h('button', {
    class: 'btn btn--ghost btn--sm', type: 'button',
    on: { click: () => onOpenPanel?.('recommend') },
  }, icon('listchecks', { size: 13 }), h('span', { text: '重算推荐' })));
}
