/* =============================================================================
   遗迹2 · 遗物档案 — picker.js
   全站唯一装备选择器（抽屉）：点行=选中装备；行内「详情」按钮=看详情（不选中）。

   v2（迭代：选择器筛选与排序）
    顶部：搜索 + 按槽位族动态给出的排序（护甲槽默认护甲值↓ / 武器槽默认伤害↓）
    筛选：类型 chip（families>1 时）+ 游戏标签多选（core/labels.js 的 GAME_TAGS，
          只显示当前候选集里出现的标签并带计数）+ 只看已拥有 + 只看有数值 + 清空筛选
    行：图标 / 中文名 + 英文小字 / 护甲·负重·伤害·射速·弹匣 / 效果预览 / 标签 /
        已拥有 / 当前装备高亮 / 行内 ⓘ 详情
   交互契约不变；样式全部在 css/components-picker.css（不改 components.css）。
   ========================================================================== */
import { h, debounce, clear, fmt, cmpText } from '../core/dom.js';
import { icon } from '../core/icons.js';
import { api } from '../core/api.js';
import { store } from '../core/store.js';
import { ui } from '../core/ui.js';
import {
  FAMILY, SLOT_ACCEPT, SLOT_ZH, GAME_TAGS_BY_GROUP, GAME_TAG_BY_ID,
} from '../core/labels.js';
import { itemIconEl, effectPreview } from './item-card.js';
import { openItemDetail } from './item-detail.js';

const PAGE = 80;

/* 槽位族分组：决定排序项与「只看有数值」的判定口径 */
const ARMOR_FAMILIES = ['head', 'body', 'legs', 'gloves'];
const WEAPON_FAMILIES = ['longGun', 'handGun', 'melee'];
const ACCESSORY_FAMILIES = ['ring', 'amulet', 'relic'];

function modeOf(families) {
  const list = families.filter(Boolean);
  if (!list.length) return 'other';
  if (list.every((f) => ARMOR_FAMILIES.includes(f))) return 'armor';
  if (list.every((f) => WEAPON_FAMILIES.includes(f))) return 'weapon';
  if (list.every((f) => ACCESSORY_FAMILIES.includes(f))) return 'accessory';
  return 'other';
}

/** 可排序项：只给当前槽位族真的有的数值，避免出现空排序 */
const SORT_BY_MODE = {
  armor: [{ id: 'armor', label: '护甲值 ↓' }, { id: 'weight', label: '负重 ↓' }],
  weapon: [{ id: 'damage', label: '伤害 ↓' }, { id: 'rate', label: '射速 ↓' }],
  accessory: [],
  other: [],
};
const DEFAULT_SORT = { armor: 'armor', weapon: 'damage', accessory: 'name', other: 'name' };
const NUMERIC_LABEL = {
  armor: '只看有护甲值', weapon: '只看有伤害', accessory: '只看有效果', other: '只看有数值',
};

function sortOptions(mode) {
  return [...(SORT_BY_MODE[mode] || []), { id: 'name', label: '名称 A→Z' }];
}

function hasNumeric(it, mode) {
  if (mode === 'armor') return it.armor != null;
  if (mode === 'weapon') return it.damage != null;
  if (mode === 'accessory') return (it.effectLines || []).length > 0 || !!it.summaryZh;
  return it.armor != null || it.damage != null
    || (it.effectLines || []).length > 0 || !!it.summaryZh;
}

/** 行内数值小徽章：图标 + 数字 + 单位 */
function statChip(iconName, value, unit = '', hint = '') {
  return h('span', {
    class: 'picker-stat',
    attrs: hint ? { title: hint } : {},
  },
    icon(iconName, { size: 11 }),
    h('b', { text: value }),
    unit ? h('i', { text: unit }) : '',
  );
}

/** 行内数值/预览区：按部位族给最有用的数值 */
function rowFacts(it) {
  const stats = [];
  const fam = it.family;
  if (ARMOR_FAMILIES.includes(fam)) {
    if (it.armor != null) stats.push(statChip('armorstat', fmt.num(it.armor, 1), '', '护甲值'));
    if (it.weight != null) stats.push(statChip('weight', fmt.num(it.weight, 1), '', '负重'));
    if (it.resistSum) stats.push(statChip('resist', `+${fmt.num(it.resistSum, 0)}`, '', '抗性合计'));
  } else if (WEAPON_FAMILIES.includes(fam)) {
    const isMelee = fam === 'melee';
    if (it.damage != null) stats.push(statChip('damage', fmt.num(it.damage, it.damage < 10 ? 2 : 0), '', '伤害'));
    if (!isMelee && it.rate != null) stats.push(statChip('firerate', fmt.num(it.rate, 2), '', '射速'));
    if (!isMelee && it.ammoPerClip != null) stats.push(statChip('mag', fmt.num(it.ammoPerClip, 0), '', '弹匣容量'));
  }
  const preview = effectPreview(it);
  const facts = h('div', { class: 'picker-row__facts' }, stats);
  if (preview) facts.append(h('span', { class: 'picker-row__preview', attrs: { title: preview }, text: preview }));
  return facts;
}

/** 行内游戏标签小胶囊（戒指/项链等带 filter_tags 的条目） */
function rowTags(it) {
  const tags = (it.filterTags || []).map((id) => GAME_TAG_BY_ID.get(id)).filter(Boolean);
  if (!tags.length) return null;
  const wrap = h('div', { class: 'picker-row__tags' });
  for (const t of tags.slice(0, 4)) {
    wrap.append(h('span', { class: 'picker-row__tag', attrs: { title: t.desc } },
      icon(t.icon, { size: 10 }), h('span', { text: t.zh })));
  }
  if (tags.length > 4) wrap.append(h('span', { class: 'picker-row__tag picker-row__tag--more', text: `+${tags.length - 4}` }));
  return wrap;
}

/**
 * @param {object} o { title, slotId, families?, currentId?, onPick(item), onClose? }
 */
export function openPicker(o = {}) {
  const slotId = o.slotId || '';
  const families = o.families || SLOT_ACCEPT[slotId] || [];
  const title = o.title || (slotId ? `选择${SLOT_ZH[slotId] || ''}` : '选择物品');
  const mode = modeOf(families);

  /* ------------------------------ 状态 ------------------------------ */
  let keyword = '';
  let onlyOwned = false;
  let onlyNumeric = false;
  let pickedFamily = '';
  let sortKey = DEFAULT_SORT[mode] || 'name';
  let shown = PAGE;
  const pickedTags = new Set();

  const all = api.itemsSync().filter((it) => it.isItem && families.includes(it.family));
  const famChips = [...new Set(all.map((it) => it.family))];

  /* ------------------------------ 顶部工具条 ------------------------------ */
  const searchInput = h('input', {
    class: 'input', type: 'search', placeholder: '搜索名称 / 效果关键词', autocomplete: 'off',
    attrs: { 'aria-label': '搜索物品' },
  });
  searchInput.addEventListener('input', debounce(() => {
    keyword = searchInput.value.trim().toLowerCase();
    shown = PAGE;
    render();
  }, 120));

  const sortSelect = h('select', {
    class: 'select picker-sort__select', attrs: { 'aria-label': '排序方式' },
    on: { change: (e) => { sortKey = e.target.value || sortKey; shown = PAGE; render(); } },
  }, sortOptions(mode).map((opt) => h('option', { value: opt.id, text: opt.label })));
  sortSelect.value = sortKey;

  const ownBox = h('input', {
    type: 'checkbox',
    on: { change: (e) => { onlyOwned = e.target.checked; shown = PAGE; render(); } },
  });
  const ownSwitch = h('label', { class: 'switch picker-switch' },
    ownBox, h('span', { class: 'switch__track' }), h('span', { text: '只看已拥有' }));

  const numBox = h('input', {
    type: 'checkbox',
    on: { change: (e) => { onlyNumeric = e.target.checked; shown = PAGE; render(); } },
  });
  const numSwitch = h('label', { class: 'switch picker-switch' },
    numBox, h('span', { class: 'switch__track' }), h('span', { text: NUMERIC_LABEL[mode] }));

  const barTop = h('div', { class: 'picker-bar__top' },
    h('div', { class: 'input-group picker-search' }, icon('search', { size: 15 }), searchInput),
    h('label', { class: 'picker-sort' }, icon('sort', { size: 13 }), sortSelect),
  );

  const famRow = h('div', { class: 'picker-fams' });

  const tagBody = h('div', { class: 'picker-tagbox__body' });
  const tagCount = h('b', { class: 'picker-tagbox__count' });
  const tagBox = h('details', { class: 'picker-tagbox' },
    h('summary', { class: 'picker-tagbox__summary' },
      icon('filter', { size: 13 }),
      h('span', { text: '游戏标签' }),
      tagCount,
      h('span', { class: 'picker-tagbox__hint', text: '可多选（同时满足）' }),
      icon('chevron-down', { size: 13, cls: 'picker-tagbox__chev' }),
    ),
    tagBody,
  );
  tagBox.open = window.matchMedia('(min-width: 641px)').matches;

  const activeRow = h('div', { class: 'picker-active', hidden: true });

  const clearBtn = h('button', {
    class: 'btn btn--quiet btn--sm picker-clear', type: 'button', text: '清空筛选',
    attrs: { title: '清空搜索、标签与所有筛选开关' },
    on: { click: () => resetFilters() },
  });

  const switchesRow = h('div', { class: 'picker-bar__switches' },
    ownSwitch, numSwitch, h('span', { class: 'grow' }), clearBtn);

  const bar = h('div', { class: 'picker-bar' },
    barTop, switchesRow, famRow, tagBox, activeRow);

  const list = h('div', { class: 'picker-list' });
  const countEl = h('div', { class: 'picker-count' });

  /* ------------------------------ 筛选逻辑 ------------------------------ */
  const isOwned = (it) => store.isOwned(it.id);

  /** 候选集（不含标签筛选；用于给标签算计数） */
  function baseFiltered() {
    return all.filter((it) => {
      if (pickedFamily && it.family !== pickedFamily) return false;
      if (onlyOwned && !isOwned(it)) return false;
      if (onlyNumeric && !hasNumeric(it, mode)) return false;
      if (keyword && !it.haystack.includes(keyword)) return false;
      return true;
    });
  }

  function filtered() {
    const rows = baseFiltered();
    if (!pickedTags.size) return rows;
    return rows.filter((it) => {
      if (!it.filterTags || !it.filterTags.length) return false;
      const own = new Set(it.filterTags);
      for (const t of pickedTags) if (!own.has(t)) return false; // 多选 = 同时满足
      return true;
    });
  }

  /** 标签 → 当前候选集里的条数 */
  function tagCounts() {
    const counts = new Map();
    for (const it of baseFiltered()) {
      for (const t of new Set(it.filterTags || [])) {
        if (t) counts.set(t, (counts.get(t) || 0) + 1);
      }
    }
    return counts;
  }

  function sortRows(rows) {
    const desc = (key) => (a, b) => {
      const av = a[key];
      const bv = b[key];
      if (av == null && bv == null) return cmpText(a.zh, b.zh);
      if (av == null) return 1;
      if (bv == null) return -1;
      if (bv !== av) return bv - av;
      return cmpText(a.zh, b.zh);
    };
    const cmp = sortKey === 'armor' ? desc('armor')
      : sortKey === 'weight' ? desc('weight')
        : sortKey === 'damage' ? desc('damage')
          : sortKey === 'rate' ? desc('rate')
            : (a, b) => cmpText(a.zh, b.zh);
    return rows.slice().sort(cmp);
  }

  function resetFilters() {
    keyword = '';
    searchInput.value = '';
    onlyOwned = false;
    ownBox.checked = false;
    onlyNumeric = false;
    numBox.checked = false;
    pickedFamily = '';
    pickedTags.clear();
    shown = PAGE;
    render();
  }

  function anyFilter() {
    return !!keyword || onlyOwned || onlyNumeric || !!pickedFamily || pickedTags.size > 0;
  }

  /* ------------------------------ 渲染：类型 chip ------------------------------ */
  function renderFams() {
    clear(famRow);
    if (famChips.length <= 1) {
      famRow.hidden = true;
      return;
    }
    famRow.hidden = false;
    famRow.append(h('button', {
      class: `chip chip--sm${pickedFamily === '' ? ' is-on' : ''}`, type: 'button', text: '全部',
      on: { click: () => { pickedFamily = ''; shown = PAGE; render(); } },
    }));
    for (const f of famChips) {
      famRow.append(h('button', {
        class: `chip chip--sm${pickedFamily === f ? ' is-on' : ''}`, type: 'button',
        on: { click: () => { pickedFamily = f; shown = PAGE; render(); } },
      }, icon(FAMILY[f]?.icon || 'all', { size: 12 }), h('span', { text: FAMILY[f]?.zh || f })));
    }
  }

  /* ------------------------------ 渲染：游戏标签 ------------------------------ */
  function renderTags() {
    clear(tagBody);
    const counts = tagCounts();
    let total = 0;
    for (const group of GAME_TAGS_BY_GROUP) {
      const tags = group.tags.filter((t) => counts.get(t.id) > 0);
      if (!tags.length) continue;
      total += tags.length;
      const row = h('div', { class: 'picker-tagrow' });
      for (const t of tags) {
        const on = pickedTags.has(t.id);
        row.append(h('button', {
          class: `chip chip--sm picker-tagchip${on ? ' is-on' : ''}`, type: 'button',
          attrs: { 'aria-pressed': on ? 'true' : 'false', title: `${t.desc} · ${counts.get(t.id)} 件` },
          on: {
            click: () => {
              if (on) pickedTags.delete(t.id); else pickedTags.add(t.id);
              shown = PAGE;
              render();
            },
          },
        }, icon(t.icon, { size: 12 }), h('span', { text: t.zh }),
        h('span', { class: 'chip__count', text: String(counts.get(t.id)) })));
      }
      tagBody.append(h('div', { class: 'picker-taggroup' },
        h('div', { class: 'picker-taggroup__title', text: group.zh }), row));
    }
    tagBox.hidden = total === 0;
    tagCount.textContent = pickedTags.size ? `已选 ${pickedTags.size}` : `共 ${total}`;
  }

  /* ------------------------------ 渲染：已选条件 pills ------------------------------ */
  function renderActive() {
    clear(activeRow);
    if (!pickedTags.size) {
      activeRow.hidden = true;
      return;
    }
    activeRow.hidden = false;
    activeRow.append(h('span', { class: 'picker-active__label', text: '已选标签' }));
    for (const id of pickedTags) {
      const t = GAME_TAG_BY_ID.get(id);
      if (!t) continue;
      activeRow.append(h('button', {
        class: 'picker-pill', type: 'button', attrs: { title: `移除标签「${t.zh}」` },
        on: { click: () => { pickedTags.delete(id); shown = PAGE; render(); } },
      }, icon(t.icon, { size: 11 }), h('span', { text: t.zh }), icon('x', { size: 11 })));
    }
  }

  function updateClear() {
    clearBtn.disabled = !anyFilter();
  }

  /* ------------------------------ 渲染：列表 ------------------------------ */
  function renderRow(it) {
    const owned = isOwned(it);
    const cur = it.id === o.currentId;
    const titleLine = h('div', { class: 'picker-row__line' },
      h('span', { class: 'picker-row__name', attrs: { title: it.zh }, text: it.zh }),
      it.en && it.en !== it.zh
        ? h('span', { class: 'picker-row__en', attrs: { title: it.en }, text: it.en })
        : '',
    );

    const marks = h('div', { class: 'picker-row__marks' },
      cur ? h('span', { class: 'picker-cur', text: '当前' }) : '',
      owned ? h('span', { class: 'badge badge--easy', text: '已拥有' }) : '',
    );

    return h('div', {
      class: `picker-row${cur ? ' is-cur' : ''}${owned ? ' is-owned' : ''}`,
      dataset: { id: it.id, family: it.family },
      attrs: { role: 'button', tabindex: '0', 'aria-label': `选择 ${it.zh}` },
      on: {
        click: () => { o.onPick?.(it); ui.closeDrawer(); },
        keydown: (e) => { if (e.key === 'Enter') { o.onPick?.(it); ui.closeDrawer(); } },
      },
    },
      h('div', { class: 'picker-row__media' }, itemIconEl(it)),
      h('div', { class: 'picker-row__body' },
        titleLine,
        rowFacts(it),
        rowTags(it) || '',
      ),
      marks,
      h('div', { class: 'picker-row__acts' },
        h('button', {
          class: 'iconbtn iconbtn--sm', type: 'button', title: '查看详情', 'aria-label': '查看详情',
          on: {
            click: (e) => {
              e.stopPropagation();
              openItemDetail(it.id, { route: false });
            },
          },
        }, icon('info', { size: 14 })),
      ),
    );
  }

  function render() {
    renderFams();
    renderTags();
    renderActive();
    updateClear();

    const rows = sortRows(filtered());
    clear(list);
    countEl.textContent = `共 ${rows.length} 件${rows.length > shown ? `（已显示 ${shown}）` : ''}${anyFilter() ? ' · 已筛选' : ''}`;

    if (!rows.length) {
      list.append(h('div', { class: 'empty' },
        h('div', { class: 'empty__ico' }, icon('search', { size: 34 })),
        h('div', { class: 'empty__title', text: '没有匹配的装备' }),
        h('div', { class: 'empty__hint', text: anyFilter() ? '试着减少标签筛选、换个关键词，或点「清空筛选」。' : '换个关键词试试。' }),
      ));
      return;
    }

    for (const it of rows.slice(0, shown)) list.append(renderRow(it));

    if (rows.length > shown) {
      list.append(h('button', {
        class: 'btn btn--ghost btn--block', type: 'button',
        text: `显示更多（还有 ${rows.length - shown} 件）`,
        on: { click: () => { shown += PAGE; render(); } },
      }));
    }
  }

  /* ------------------------------ 抽屉 ------------------------------ */
  const foot = h('div', { class: 'row row--spread grow' },
    h('span', { class: 'muted picker-foot-hint' },
      `点击物品即选中${slotId ? `「${SLOT_ZH[slotId] || slotId}」` : ''}；右侧 ⓘ 只看详情`),
    h('button', { class: 'btn btn--quiet btn--sm', type: 'button', text: '取消', on: { click: () => ui.closeDrawer() } }),
  );

  render();
  ui.openDrawer({
    title,
    subtitle: '选择器',
    iconName: famChips.length ? FAMILY[famChips[0]]?.icon : 'grid',
    body: h('div', { class: 'picker' }, bar, countEl, list),
    foot,
    onClose: o.onClose,
  });
  setTimeout(() => searchInput.focus({ preventScroll: true }), 120);
}

export default openPicker;
