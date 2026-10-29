/* =============================================================================
   遗迹2 · 遗物档案 — item-detail-sections.js
   道具详情的内容区块：描述 / 效果原文 / 效果数值 / 属性 / 套装 / 获取 / 背景 / 数据来源。
   外壳（hero、标签、状态按钮、桌面弹窗 / 移动抽屉）与对外入口留在 item-detail.js；
   本文件只负责「一块内容长什么样」，不持有 URL、不决定浮层形态。
   ========================================================================== */
import { h, fmt, copyText } from '../core/dom.js';
import { icon } from '../core/icons.js';
import { api } from '../core/api.js';
import { store } from '../core/store.js';
import { ui } from '../core/ui.js';
import { itemIconEl } from './item-card.js';
import {
  FAMILY, CONF, DLC_ZH, ACQ, RES_ZH, RES_ICON, RES_COLOR,
  numLabel, fmtNumber, NUM_NOTE, attrKeysShown, EFFECT_CAT_ZH, cleanSummary, zhDisplay,
} from '../core/labels.js';

/* 原始数值表里不展示的引擎字段（对玩家无意义） */
const RAW_NOISE = new Set([
  'UseInteractInfo', 'NetUpdateFrequency', 'MinNetUpdateFrequency', 'MaxStackCount',
  'Unique', 'HideUpdateNotification', 'Scope', 'MaxLevel', 'UpgradeLevel',
  'MinLevelDurationMin', 'MaxLevelDurationMax', 'ReplicateMod', 'PowerBasis',
]);

/* 引擎内部量（距离单位、动画分段、归一化基准）：只在「原始数值」折叠里出现，不进效果列表 */
const ENGINE_KEYS = new Set([
  'PrimaryFalloff', 'SecondaryFalloff', 'Spread', 'CrouchSpreadScalar', 'MaxCritRange',
  'ReloadStartTime', 'ReloadLoopTime', 'ReloadEndTime', 'BurstRateOfFire',
  'HasScope', 'ScopeFOV', 'UseInteractInfo', 'Value', 'MaxStackCount',
]);

/* 纯机制数字（层数上限/堆叠/衰减），没有可读文案时只留在原始数值折叠里 */
const STACK_KEYS = new Set([
  'MaxBuffStacks', 'MaxStackSize', 'MaxStacks', 'StackDecrementTime', 'MaxStackCount',
]);

/* 效果行分类 → 图标（颜色 + 形状双编码，颜色只做辅助） */
const CAT_ICON = { offense: 'sword', defense: 'shield', utility: 'sparkle', status: 'blight', other: 'info' };
const CAT_ORDER = ['offense', 'defense', 'status', 'utility', 'other'];

/* 计数类键：数量不补「+」（「每次装填弹药 1」不是「+1」） */
const COUNT_KEYS = new Set(['AmmoPerReload', 'AmmoPerClip', 'MaxAmmo', 'MaxCharges', 'BurstCount', 'SprayCount', 'MaxSummons']);

/* ----------------------------- 数值展示 ----------------------------- */
/** 数值展示：百分比 / 点数类正数补「+」，倍率（×）与计数类保持原样 */
export function effectValueText(key, raw) {
  const meta = numLabel(key);
  /* 射程在数据里是引擎单位（÷100 = 米），直接显示裸数字会误读 */
  if (key === 'Range' && typeof raw === 'number' && raw > 100) return `${Math.round(raw / 100)} 米`;
  let t = fmtNumber(key, raw);
  if (meta && typeof raw === 'number' && raw > 0 && !COUNT_KEYS.has(key)) {
    const unit = meta[1];
    if ((unit === '%' || unit === 'pt') && !/^[+×]/.test(t)) t = `+${t}`;
  }
  return t;
}

/* ----------------------------- 区块外壳 ----------------------------- */
function section(iconName, title, body, extra) {
  return h('section', { class: 'detail-sec' },
    h('div', { class: 'detail-sec__head' },
      h('h3', { class: 'detail-sec__title' }, icon(iconName, { size: 13 }), title),
      extra || '',
    ),
    h('div', { class: 'detail-sec__body' }, body),
  );
}

/* ----------------------------- 描述（官方文本优先） ----------------------------- */
/** 官方描述缺失时，仅在没有可展示的效果行时才退回机器摘要，避免与效果区重复 */
export function descText(item) {
  const official = zhDisplay(item.descZh) || String(item.descZh || '').trim();
  if (official) return official;
  const hasEffectRows = (item.effectLines || []).length > 0;
  if (hasEffectRows) return '';
  return cleanSummary(item.summaryZh || '');
}

export function descSection(item) {
  const text = descText(item);
  if (text) return section('book', '描述', h('p', { class: 'lore', text }));
  return section('book', '描述',
    h('p', { class: 'muted detail-missing', text: '官方描述未收录；效果与数值见下方区块。' }));
}

/* ----------------------------- 效果原文（首位） ----------------------------- */
/** 官方效果句：必须通过 zhDisplay（无 {占位符} / 无成串英文），否则视为不可用 */
export function effectSentence(item) {
  return zhDisplay(item.effectZh);
}

export function effectTextSection(item) {
  const text = effectSentence(item);
  if (!text) return null;
  const paras = text.split(/[\r\n]+/).map((p) => p.trim()).filter(Boolean).slice(0, 3);
  const body = h('div', { class: 'detail-effect' },
    paras.map((p) => h('p', { text: p })));
  if (item.effectSrc === 'manual') {
    body.append(h('p', { class: 'detail-src', text: '人工整理，非游戏原文' }));
  }
  return section('sparkle', '效果', body);
}

/* ------------------- 效果原文（wiki 整理）：仅官方中文缺失时回退 ------------------- */
/**
 * 官方中文效果句缺失、但 wiki 英文原文可用时，单独渲染一块英文回退。
 * 中文优先：有官方 zh 时永远不出现；英文只作为「原文」展示，不翻译、不改写数字。
 * 用独立 class（不复用 .detail-effect），与「有中文原文」的契约区分开。
 */
export function effectWikiSection(item) {
  if (effectSentence(item)) return null;                       // 官方中文永远优先
  const en = String(item.effectEn || '').trim();
  if (!en) return null;
  if (item.effectSrc !== 'wiki' && item.effectMatch !== 'wiki-only') return null;
  const body = h('div', { class: 'stack-3' },
    h('p', { class: 'lore detail-wiki' }, h('em', { text: en })),
    h('p', { class: 'detail-src', text: '英文原文（wiki 整理，未经翻译）；官方中文效果句暂未收录。' }),
  );
  return section('sparkle', '效果原文（wiki 整理）', body,
    h('span', { class: 'badge badge--neutral', attrs: { style: 'margin-left:auto' }, text: '来源：wiki' }));
}

/** 背景：官方描述段落在前，引号短句（flavor）在后 */
export function backgroundSection(item) {
  const desc = zhDisplay(item.descZh) || String(item.descZh || '').trim();
  const flavor = String(item.flavorZh || '').trim();
  if (!desc && !flavor) return null;
  const body = h('div', { class: 'stack-3' });
  if (desc) body.append(h('p', { class: 'lore', text: desc }));
  if (flavor) body.append(h('p', { class: 'lore lore--flavor', text: flavor }));
  return section('book', '背景', body);
}

/* ----------------------------- 属性（权威数值） ----------------------------- */
export function attrsSection(item) {
  const rows = [];
  const push = (k, v, cls = '') => rows.push(
    h('div', { class: 'kv__k', text: k }),
    h('div', { class: `kv__v ${cls}`, text: v }),
  );
  /* 抗性行带伤害类型图标（形状 + 颜色双重区分） */
  const pushRes = (key, v) => {
    const lbl = h('div', { class: 'kv__k kv__k--ico' },
      icon(RES_ICON[key], { size: 12, cls: 'dmg-ico' }),
      h('span', { text: RES_ZH[key] }),
    );
    lbl.style.setProperty('--c', RES_COLOR[key]);
    rows.push(lbl, h('div', { class: 'kv__v stat--good', text: `${v > 0 ? '+' : ''}${fmt.num(v, 0)}` }));
  };
  const fam = item.family;
  if (['head', 'body', 'legs', 'gloves'].includes(fam)) {
    if (item.armor != null) push('护甲值', fmt.num(item.armor, 1));
    if (item.weight != null) push('负重', fmt.num(item.weight, 1));
    for (const k of ['bleed', 'fire', 'shock', 'corrosive', 'blight']) {
      const v = item.resist[k];
      if (v) pushRes(k, v);
    }
    if (item.resistSum) push('抗性合计', fmt.num(item.resistSum, 0));
    const totals = item.setField?.totals;
    if (totals) {
      const parts = [
        totals.armor != null ? `护甲 ${fmt.num(totals.armor, 1)}` : '',
        totals.encumbrance != null ? `负重 ${fmt.num(totals.encumbrance, 1)}` : '',
        totals.resistance_sum != null ? `抗性 ${fmt.num(totals.resistance_sum, 0)}` : '',
      ].filter(Boolean).join(' · ');
      if (parts) push(`套装合计（${item.setField.parts?.length || 4} 件）`, parts, 'kv__v--wrap');
    }
    if (item.value != null) push('价值', fmt.num(item.value, 0));
  } else if (['longGun', 'handGun', 'melee'].includes(fam)) {
    const isMelee = fam === 'melee';
    const stagger = (item.effectLines || []).find((l) => l.key === 'MeleeStaggerMod');
    if (item.damage != null) push('伤害', fmt.num(item.damage, Number.isInteger(item.damage) ? 0 : 2));
    if (item.rate != null) {
      /* 近战是攻击速度倍率（×1.00），不是百分比；远程是每秒发数 */
      if (isMelee) push('攻击速度', `×${Number(item.rate).toFixed(2)}`);
      else push('射速', fmt.num(item.rate, 2));
    }
    if (item.impact != null) push('冲击系数', fmt.num(item.impact, 2));
    if (isMelee && stagger && stagger.value != null) {
      push('近战硬直', `${stagger.value > 0 ? '+' : ''}${fmt.num(stagger.value, 0)}%`);
    }
    if (item.crit != null) push('暴击率', `${fmt.num(item.crit, 0)}%`);
    if (item.weakspot != null) push('弱点伤害', `${fmt.num(item.weakspot, 0)}%`);
    if (item.ammoPerClip != null) push('弹匣容量', `${fmt.num(item.ammoPerClip, 0)} 发`);
    if (item.maxAmmo != null) push('弹药上限', `${fmt.num(item.maxAmmo, 0)} 发`);
    if (item.range != null && item.range > 100) push('射程', `${Math.round(item.range / 100)} 米`);
    if (item.value != null) push('价值', fmt.num(item.value, 0));
  } else {
    if (item.stack != null) push('堆叠上限', fmt.num(item.stack, 0));
    if (item.value != null) push('价值', fmt.num(item.value, 0));
  }
  if (!rows.length) return null;
  return section('chart', '属性', h('div', { class: 'kv' }, rows));
}

/* ----------------------------- 效果（文案 + 数值） ----------------------------- */
/** 属性区实际展示的键（含本组件新增的武器/护甲行），效果区据此去重 */
export function attrShownKeys(item) {
  const s = attrKeysShown(item);
  const fam = item.family;
  const add = (...ks) => ks.forEach((k) => s.add(k));
  if (['longGun', 'handGun', 'melee'].includes(fam)) {
    add('Damage', 'RateOfFire', 'AttackSpeed', 'CritChance', 'WeakSpotDamageMod',
      'ImpactScalar', 'MeleeStaggerMod', 'AmmoPerClip', 'MaxAmmo', 'Range', 'Value');
  } else if (['head', 'body', 'legs', 'gloves'].includes(fam)) {
    add('Armor', 'Encumbrance', 'Value', 'AllResistance',
      'AcidResistance', 'BleedResistance', 'FireResistance', 'ShockResistance', 'BlightResistance');
  } else {
    add('Value', 'MaxStackCount');
  }
  return s;
}

/** 效果行分类：优先 item 自带 category，缺失时按 key 兜底 */
export function effectCat(ln) {
  const c = ln && ln.category;
  if (EFFECT_CAT_ZH[c]) return c;
  const k = String((ln && ln.key) || '');
  if (/(Damage|Crit|Weak|RateOfFire|AttackSpeed|Reload|Ammo|Impact|Stagger)/i.test(k)) return 'offense';
  if (/(Resistance|Armor|DamageReduction|Health|Shield|Bulwark|Stamina|Evade)/i.test(k)) return 'defense';
  return 'utility';
}

/** 效果行图标：优先按语义键（暴击/弱点/生命/护盾…），其次按分类 */
export function effectIcon(ln, cat) {
  const k = String((ln && ln.key) || '');
  if (/critdamage/i.test(k)) return 'crit';
  if (/crit/i.test(k)) return 'crit';
  if (/weak/i.test(k)) return 'weakspot';
  if (/(damagereduction|resistance|^armor|armor(efficacy|mod|flat)|bulwark)/i.test(k)) return 'resist';
  if (/(health|heal|lifesteal|leech|regen)/i.test(k)) return 'health';
  if (/shield/i.test(k)) return 'shield';
  if (/stamina/i.test(k)) return 'stamina';
  if (/(evade|dodge)/i.test(k)) return 'dodge';
  if (/(movespeed|speed)/i.test(k)) return 'movespeed';
  if (/(rateoffire|firerate|attackspeed|reload)/i.test(k)) return 'firerate';
  if (/(ammo|clip|mag)/i.test(k)) return 'mag';
  if (/(weight|encumbrance)/i.test(k)) return 'weight';
  if (/^mod|modpower|modduration/i.test(k)) return 'mod';
  if (/skill/i.test(k)) return 'skill';
  if (/summon|minion/i.test(k)) return 'archetype';
  if (/relic|fragment/i.test(k)) return 'relic';
  return CAT_ICON[cat] || 'info';
}

export function effectSection(item) {
  const rows = [];
  const fam = item.family;
  const shown = attrShownKeys(item);

  const pushRow = (cat, txt, val, key) => {
    const note = key ? NUM_NOTE[key] : '';
    rows.push(h('div', {
      class: 'eff-row', dataset: { cat },
      attrs: note ? { 'data-tip': note, title: note } : {},
    },
      h('span', { class: 'eff-row__ico', attrs: { 'aria-hidden': 'true' } }, icon(effectIcon({ key }, cat), { size: 13 })),
      h('span', { class: 'eff-row__txt', text: txt }),
      val ? h('span', { class: 'eff-row__val', text: val }) : '',
    ));
  };

  for (const ln of item.effectLines || []) {
    const key = ln.key || '';
    /* 基础数值只进「属性」区；引擎量/层数上限只留在原始数值折叠里 */
    if (!key || ln.source === 'base_stats') continue;
    if (shown.has(key) || ENGINE_KEYS.has(key) || STACK_KEYS.has(key)) continue;
    const raw = ln.value != null ? ln.value : item.numbers?.[key];
    if (typeof raw === 'number' && Math.abs(raw) < 1e-6) continue;
    const meta = numLabel(key);
    const cleanText = zhDisplay(ln.display_zh);
    const cat = effectCat(ln);
    if (meta) {
      /* 有中文键名：左侧键名 + 右侧数值 */
      if (raw == null) { if (cleanText) pushRow(cat, cleanText, '', key); continue; }
      pushRow(cat, meta[0], effectValueText(key, raw), key);
    } else if (cleanText) {
      /* 无键名但有干净文案：整行显示文案，不再重复数值 */
      pushRow(cat, cleanText, '', key);
    }
  }

  /* 效果区只放玩家可读的加成/减益；没有就整块不出现（原始数值在「数据来源」里） */
  const wikiSec = effectWikiSection(item);
  let sec = null;
  if (rows.length) {
    const body = h('div', { class: 'stack-3' });
    body.append(h('div', { class: `eff-list eff-list--${CAT_ORDER.find((c) => rows.some((r) => r.dataset.cat === c)) || 'other'}` }, rows));
    if ((fam === 'perk' || fam === 'trait') && item.maxLevel) {
      body.append(h('p', { class: 'muted', attrs: { style: 'font-size:11px' }, text: `以上为每级数值；等级上限 ${item.maxLevel} 级。` }));
    }
    const title = effectSentence(item) ? '数值明细' : '效果';
    sec = section('sparkle', title, body);
  }
  /* 没有中文效果句时，数值块后补「效果原文（wiki 整理）」；两块各自独立成 section */
  if (!wikiSec) return sec;
  if (!sec) return wikiSec;
  const frag = document.createDocumentFragment();
  frag.append(sec, wikiSec);
  return frag;
}

/* ----------------------------- 套装部件 ----------------------------- */
/**
 * @param {object} item
 * @param {object} deps { openDetail(id, opts) } —— 套装部件点击打开全站详情；
 *   由 item-detail.js 注入，避免区块模块反向依赖浮层入口（循环依赖）。
 */
export function setSection(item, deps = {}) {
  if (!item.setKey) return null;
  const parts = api.itemsSync().filter((it) => it.setKey === item.setKey && it.family !== 'other');
  if (!parts.length) return null;
  const openDetail = deps.openDetail || (() => {});
  const ORDER = { head: 0, body: 1, legs: 2, gloves: 3 };
  parts.sort((a, b) => (ORDER[a.family] ?? 9) - (ORDER[b.family] ?? 9));
  const body = h('div', { class: 'stack-2' },
    h('div', { class: 'row row--wrap muted', attrs: { style: 'font-size:11px;gap:8px' } },
      h('span', { text: `${item.setName || item.setKey} · ${parts.length}/4 件` }),
    ),
    h('div', { class: 'picker-list', attrs: { style: 'padding:0' } },
      parts.map((p) => h('div', {
        class: `picker-row${p.id === item.id ? ' is-cur' : ''}`,
        attrs: { role: 'button', tabindex: '0' },
        on: {
          click: () => openDetail(p.id, { from: item.id }),
          keydown: (e) => { if (e.key === 'Enter') openDetail(p.id, { from: item.id }); },
        },
      },
        h('div', { class: 'picker-row__media' }, itemIconEl(p)),
        h('div', { class: 'picker-row__body' },
          h('div', { class: 'picker-row__name', text: p.zh }),
          h('div', { class: 'picker-row__meta', text: `${FAMILY[p.family]?.zh || ''} · 护甲 ${fmt.num(p.armor ?? 0, 1)} · 负重 ${fmt.num(p.weight ?? 0, 1)}` }),
        ),
        store.isOwned(p.id) ? h('span', { class: 'badge badge--easy', text: '已拥有' }) : '',
      ))),
  );
  return section('layers', '套装', body);
}

/* ----------------------------- 获取途径 ----------------------------- */
export async function acqSection(item) {
  const acqAll = await api.acq().catch(() => null);
  const rec = acqAll?.items?.[item.id] || null;
  const body = h('div', { class: 'stack-2' });
  if (rec?.tags?.length) {
    body.append(h('div', { class: 'row row--wrap' }, rec.tags.map((t) => {
      const meta = ACQ[t] || ACQ.unknown;
      return h('span', { class: `badge badge--${meta.cls}` }, icon(meta.icon, { size: 11 }), h('span', { text: meta.zh }));
    })));
  }
  if (rec?.text) body.append(h('p', { class: 'lore', text: rec.text }));
  if (item.dlc > 0) {
    body.append(h('div', { class: 'row muted', attrs: { style: 'font-size:11.5px;gap:5px' } },
      icon('lock', { size: 12 }), `需要 DLC：${DLC_ZH[item.dlc] || `DLC ${item.dlc}`}`));
  }
  if (!rec?.text && !rec?.tags?.length) {
    body.append(h('p', { class: 'muted detail-missing', text: '获取途径未收录，请查游戏内图鉴。' }));
  }
  return section('compass', '获取途径', body);
}

/* ----------------------------- 背景故事（仅 flavor，描述已在首块） ----------------------------- */
export function flavorSection(item) {
  const flavor = item.flavorZh || '';
  if (!flavor) return null;
  return section('book', '背景故事', h('p', { class: 'lore lore--flavor', text: flavor }));
}

/* ----------------------------- 数据来源（含原始数值折叠） ----------------------------- */
function rawNumberKeys(item) {
  const numbers = item.numbers || {};
  return Object.keys(numbers).filter((k) => (typeof numbers[k] === 'number' || typeof numbers[k] === 'boolean')
    && !RAW_NOISE.has(k) && !/^b[A-Z]/.test(k));
}

export function metaSection(item) {
  const conf = CONF[item.confidence] || CONF.low;
  const rows = [
    ['物品 ID', item.id],
    ['可信度', conf.zh],
    ['资产路径', item.pkg || '—'],
  ];
  return h('details', { class: 'fold' },
    h('summary', {}, h('span', { text: '数据来源与技术信息' })),
    h('div', { class: 'fold__body stack-2' },
      h('div', { class: 'kv' }, rows.flatMap(([k, v]) => [
        h('div', { class: 'kv__k', text: k }),
        h('div', { class: 'kv__v', text: v, attrs: { title: v, style: 'max-width:320px;overflow:hidden;text-overflow:ellipsis' } }),
      ])),
      h('div', { class: 'row' },
        h('button', {
          class: 'btn btn--ghost btn--sm', type: 'button',
          attrs: { title: '复制该道具的原始 JSON', 'aria-label': '复制原始 JSON' },
          on: {
            click: async () => {
              const ok = await copyText(JSON.stringify(item.raw, null, 2));
              ui.toast(ok ? '已复制原始 JSON' : '复制失败', ok ? 'ok' : 'err');
            },
          },
        }, icon('copy', { size: 12 }), h('span', { text: '复制原始 JSON' })),
      ),
      (() => {
        const numbers = item.numbers || {};
        const keys = rawNumberKeys(item);
        if (!keys.length) return '';
        const tbl = h('table', { class: 'tbl tbl--dense' },
          h('thead', {}, h('tr', {}, h('th', { text: '字段' }), h('th', { class: 'tbl__num', text: '原始值' }))),
          h('tbody', {}, keys.map((k) => h('tr', {},
            h('td', { text: k }),
            h('td', { class: 'tbl__num', text: typeof numbers[k] === 'boolean' ? (numbers[k] ? '是' : '否') : fmt.num(numbers[k], Number.isInteger(numbers[k]) ? 0 : 2) }),
          ))),
        );
        return h('details', { class: 'fold', attrs: { style: 'border-top:0' } },
          h('summary', { text: `原始数值（${keys.length} 项，仅供核对）` }),
          h('div', { class: 'fold__body' }, h('div', { class: 'tbl-scroll tbl-scroll--h' }, tbl)),
        );
      })(),
    ));
}
