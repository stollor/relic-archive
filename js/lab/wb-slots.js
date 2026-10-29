/* =============================================================================
   遗迹2 · 遗物档案 — lab/wb-slots.js（v3）
   槽位选择动作（唯一实现）：空槽 / 更换 → 同一个选择器；职业槽 → 职业抽屉；
   移除槽位 → 带「撤销」的 Toast。装配台的 6 个分类页都从这里取动作，不各写一份。
   渲染已迁到 wb-parts.js + wb-cat-*.js；本文件不再持有 DOM 结构。
   ========================================================================== */
import { h } from '../core/dom.js';
import { icon } from '../core/icons.js';
import { openPicker } from '../components/picker.js';
import { SLOT_LABEL } from './model.js';
import { effectText } from './text.js';
import { emptyState } from './parts.js';

/** 护甲四槽（工作台合计口径） */
export const ARMOR_SLOTS = ['head', 'body', 'legs', 'gloves'];
/** 饰品五槽（参与合计的项链 / 四枚戒指） */
export const TRINKET_SLOTS = ['amulet', 'ring1', 'ring2', 'ring3', 'ring4'];
/** 武器三槽 */
export const WEAPON_SLOTS = ['longGun', 'handGun', 'melee'];
/** 职业两槽 */
export const ARCH_SLOTS = ['archetype1', 'archetype2'];

/* --------------------------- 物品选择 --------------------------- */
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
      const perkText = perkIds.map((pid) => {
        const pm = E.modById.get(pid) || {};
        return pm.zh ? `${pm.zh}（${effectText(pm.effect) || '无防御词条'}）` : '';
      }).filter(Boolean).join('、');
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
          a.trait && a.trait.zh ? h('div', { class: 'lab-archrow__perks muted', text: `关联特性：${a.trait.zh}（可在特性页升级）` }) : '',
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

export default { ARMOR_SLOTS, TRINKET_SLOTS, WEAPON_SLOTS, ARCH_SLOTS, pickItem, openArchetypePicker, pickForSlot, removeSlot };
