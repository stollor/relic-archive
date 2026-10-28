/* =============================================================================
   遗迹2 · 遗物档案 — library/present.js
   资料库的展示模型：列表行 / 网格卡 / 套装卡的文案与数值规格（纯函数，不生成 DOM）。
   视图只负责把这里的 spec 渲染成节点；文案规则唯一来源仍是 core/labels.js。
   ========================================================================== */
import { stripTags } from '../core/dom.js';
import { DLC_ZH, EFFECT_CATS, effectZhSentence } from '../core/labels.js';

export const ARMOR_FAMS = new Set(['head', 'body', 'legs', 'gloves']);
export const WEAPON_FAMS = new Set(['longGun', 'handGun', 'melee']);

/* ------------------------------- 效果 / 描述 ------------------------------- */

/** 官方效果句（规则同在 labels.effectZhSentence：无占位符、无成串英文） */
export function effectSentence(item) {
  return effectZhSentence(item);
}

/**
 * 数值摘要（与 components/item-card.js 的 effectPreview 同一口径）。
 * 注意：present 层不 import components（层规则），由视图把 effectPreview 注入过来。
 * @param {object} item
 * @param {Function} effectPreview  (item) => string
 */
export function effectPreviewText(item, effectPreview) {
  if (typeof effectPreview !== 'function') return '';
  return stripTags(effectPreview(item));
}

/**
 * 列表行描述。
 * 降级链：官方效果句 → 效果类目（数值摘要 / 待核实）→ descZh → 数值摘要 → 待核实 → ''。
 * @param {object} item
 * @param {{preview?:string}} deps preview = effectPreviewText(...) 的结果
 */
export function rowDesc(item, { preview = '' } = {}) {
  const effect = effectSentence(item);
  if (effect) return effect;
  if (EFFECT_CATS.includes(item.cat)) {
    // 没有官方效果句时，退到数值摘要并显式标注「数值」，避免被误读成效果原文
    return preview ? `数值：${preview}` : '效果数据待核实（官方效果未收录）';
  }
  const own = stripTags(item.descZh);
  if (own) return own;
  if (preview) return preview;
  // 有摘要但全是 0 值/机器噪声（如 denormal 浮点）：明确标注待核实，不展示 0 值
  if (stripTags(item.summaryZh)) return '效果数据待核实（官方描述未收录）';
  return '';
}

/**
 * 网格卡描述区的处理规格（卡片原文由 itemCard 生成）。
 * @returns {{remove:true}|{text:string}|null} null = 保留 itemCard 自己的描述
 */
export function cardDescSpec(item, { preview = () => '' } = {}) {
  if (ARMOR_FAMS.has(item.family) || WEAPON_FAMS.has(item.family)) return { remove: true };
  const effect = effectSentence(item);
  if (effect) return { text: effect };
  if (EFFECT_CATS.includes(item.cat)) {
    // 效果类目没有效果句时，不展示风味段落；只保留数值摘要或干脆不留
    const pv = preview();
    return pv ? { text: `数值：${pv}` } : { remove: true };
  }
  return null;
}

/* ------------------------------- 行关键数值 ------------------------------- */

function statSpec(iconName, value, digits, unit, label) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return {
    icon: iconName, value, digits: digits == null ? 0 : digits, unit, label,
  };
}

/**
 * 列表行关键数值：按部位族挑最有用的 2–4 个（护甲/武器/饰品…）。
 * 返回可序列化规格；数字项 {icon,value,digits,unit,label}，文本项 {icon,text}。
 */
export function rowStatsSpec(it) {
  const out = [];
  // 少数道具的 slot 归在 other（如部署型武器），用 cat 兜底，保证关键数值仍有列
  const isArmor = ARMOR_FAMS.has(it.family) || it.cat === 'armor';
  const isWeapon = WEAPON_FAMS.has(it.family) || it.cat === 'weapon';
  if (isArmor) {
    out.push(statSpec('armorstat', it.armor, 1, '', '护甲值'), statSpec('weight', it.weight, 1, '', '负重'),
      statSpec('resist', it.resistSum, 0, '抗', '抗性合计'));
  } else if (isWeapon) {
    out.push(statSpec('damage', it.damage, 0, '', '伤害'), statSpec('firerate', it.rate, 2, '', '射速'),
      statSpec('mag', it.ammoPerClip, 0, '发', '弹匣容量'), statSpec('crit', it.crit, 0, '%', '暴击率'));
  } else if (it.cat === 'ring' || it.cat === 'amulet' || it.cat === 'relic') {
    out.push(statSpec('relic', it.value, 0, '', '价值'));
  } else if (it.family === 'trait' || it.family === 'perk') {
    out.push(statSpec('trait', it.maxLevel, 0, '级', '等级'));
  } else {
    out.push(statSpec('material', it.value, 0, '', '价值'), statSpec('stack', it.stack, 0, '堆', '堆叠'));
  }
  const arr = out.filter(Boolean).slice(0, 4);
  if (!arr.length) {
    const n = (it.effectLines || []).length;
    if (n) {
      arr.push({ icon: 'info', text: `${n} 条效果` });
    } else {
      const fallback = it.resistSum
        ? statSpec('resist', it.resistSum, 0, '抗', '抗性合计')
        : (typeof it.value === 'number' ? statSpec('material', it.value, 0, '', '价值') : null);
      if (fallback) arr.push(fallback);
    }
  }
  return arr;
}

/* ------------------------------- 套装 ------------------------------- */

function dash(v) { return typeof v === 'number' && Number.isFinite(v) ? v : null; }

/** 套装合计：优先数据里的 totals，缺失/为 0 时按部件求和 */
export function setTotals(s) {
  const t = s.totals || {};
  let armor = dash(t.armor); let weight = dash(t.encumbrance); let res = dash(t.resistance_sum);
  const sum = (key) => {
    const vals = s.parts.map((p) => p[key]).filter((v) => typeof v === 'number');
    return vals.length ? vals.reduce((a, b) => a + b, 0) : null;
  };
  if (armor == null || armor === 0) armor = sum('armor');
  if (weight == null || weight === 0) weight = sum('weight');
  if (res == null) res = sum('resistSum');
  return { armor, weight, res };
}

/** 套装涉及资料片的中文名（本体 / 多资料片用「 / 」连接） */
export function setDlc(s) {
  const dlcs = [...new Set(s.parts.map((p) => p.dlc).filter((d) => typeof d === 'number'))];
  const nonBase = dlcs.filter((d) => d > 0).sort((a, b) => a - b);
  if (!nonBase.length) return DLC_ZH[0] || '本体';
  return nonBase.map((d) => DLC_ZH[d] || `DLC${d}`).join(' / ');
}

/** 套装抽屉顶部合计三格（数字 null 由视图渲染成「—」） */
export function setSummary(s) {
  const totals = setTotals(s);
  return [
    { label: '合计护甲值', icon: 'armorstat', value: totals.armor, digits: 1 },
    { label: '负重', icon: 'weight', value: totals.weight, digits: 1 },
    { label: '抗性合计', icon: 'resist', value: totals.res, digits: 0 },
  ];
}
