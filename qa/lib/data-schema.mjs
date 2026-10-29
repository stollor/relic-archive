/**
 * qa/lib/data-schema.mjs — data/ 运行时数据的「结构 + 跨文件引用 + 版本」契约（零依赖）。
 *
 * 定位：
 *   - schema.mjs 负责通用规则执行；本文件只放「遗迹档案数据长什么样」的事实契约。
 *   - 契约按**当前真实数据实测**收窄：必要字段只锁视图/生成链真正依赖的；可选字段保留；
 *     未知额外字段默认忽略（上游可先加字段，不阻塞发布）。
 *   - 真实数据里已知的历史缺口用 **warning**，不用 error，更不允许为了通过校验改数据。
 *
 * 错误定位：每条 error/warning = { file, pointer, expected, actual, message }，
 *   pointer 是 RFC6901 JSON Pointer（如 /items/12/id），可直接定位到具体条目。
 *
 * 版本策略：SUPPORTED_VERSIONS 列出当前校验器认识的版本；遇到「比校验器新」的版本时
 *   报错并明确提示「先更新 qa/lib/data-schema.mjs」，避免新版数据被静默放过或旧规则误杀。
 *
 * 用法：
 *   import { loadData, validateAll, formatDiagnostic } from './data-schema.mjs';
 *   const { errors, warnings } = validateAll(loadData());   // 读真实 data/（module 级缓存，每文件只 parse 一次）
 *   validateAll({ ...loadData(), builds: mutatedBuildsDoc }); // 负向夹具：传浅拷贝覆盖个别文件
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createCollector,
  describeValue,
  formatDiagnostic,
  validate,
} from './schema.mjs';

/** 仓库根（qa/lib → ../../） */
export const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));

/** 被校验的 10 个运行时数据文件（key → 仓库相对路径） */
export const DATA_FILES = Object.freeze({
  items: 'data/items.json',
  builds: 'data/builds.json',
  siteData: 'data/site_data.json',
  archetypes: 'data/archetypes.json',
  codex: 'data/codex/index.json',
  terms: 'data/terms.json',
  itemEffects: 'data/item_effects.json',
  iconIndex: 'data/icon_index.json',
  acq: 'data/acq.json',
  labGear: 'data/lab_gear.json',
});
/** 配装源快照只读引用：纯文本实体（碎片/传奇词条）的合法登记处 */
const SOURCE_BUILDS_FILE = 'pipeline/_source/builds.json';

/** 校验器支持的数据版本（新版本数据要同步更新这里） */
export const SUPPORTED_VERSIONS = Object.freeze({
  items: { file: 'items', kind: 'semver', supported: ['1.4.0'], maxKnown: '1.4.0', field: ['meta', 'schema_version'] },
  builds: { file: 'builds', kind: 'number', supported: [1], maxKnown: 1, field: ['meta', 'schema'] },
  siteData: { file: 'siteData', kind: 'number', supported: [1], maxKnown: 1, field: ['meta', 'schema'] },
  archetypes: { file: 'archetypes', kind: 'number', supported: [1], maxKnown: 1, field: ['meta', 'schema'] },
  codex: { file: 'codex', kind: 'number', supported: [1], maxKnown: 1, field: ['version'] },
  terms: { file: 'terms', kind: 'number', supported: [2], maxKnown: 2, field: ['version'] },
  itemEffects: null, // meta 里没有 version/schema 字段，不做版本门
  iconIndex: { file: 'iconIndex', kind: 'number', supported: [1], maxKnown: 1, field: ['version'] },
  acq: { file: 'acq', kind: 'prefixed', prefix: 'acq/', supported: ['acq/1'], maxKnown: 1, field: ['schema'] },
  labGear: { file: 'labGear', kind: 'number', supported: [1], maxKnown: 1, field: ['meta', 'schema'] },
});

/**
 * codex blocks 的类型集合。
 * 必须在 js/views/codex.js 的 switch(b.t) 支持集合内（qa/tests/data-schema.test.mjs 会核对源码）。
 */
export const CODEX_BLOCK_TYPES = Object.freeze(['h', 'p', 'formula', 'table', 'list', 'evidence', 'note']);

/** 枚举契约（来自真实数据实测；未知新值会让校验器报错，提示同步更新本文件） */
export const ITEM_CATS = Object.freeze([
  'action', 'amulet', 'armor', 'consumable', 'relic', 'gem', 'metagem', 'mod',
  'perk', 'ring', 'skill', 'trait', 'weapon', 'engram', 'material',
]);
export const ITEM_KINDS = Object.freeze(['item', 'action', 'unknown', 'asset_variant']);
export const ITEM_SLOTS = Object.freeze([
  'amulet', 'action', 'consumable', 'mod', 'ring', 'body', 'gloves', 'head', 'other',
  'legs', 'relic', 'gem', 'meta_gem', 'perk', 'skill', 'trait', 'melee_weapon',
  'long_gun', 'hand_gun', 'engram', 'material',
]);
/** builds.slots 的合法槽位（与 pipeline/mk_builds_json.py 的 SLOT_ORDER 对应） */
export const BUILD_SLOT_KEYS = Object.freeze([
  'long_gun', 'hand_gun', 'melee_weapon', 'mod', 'meta_gem', 'amulet', 'ring',
  'relic', 'trait', 'perk', 'skill', 'fragment', 'legendary',
]);
export const CLASS_ORDER = Object.freeze(['LIGHT', 'MEDIUM', 'HEAVY', 'ULTRA']);
export const PRESET_CLASSES = Object.freeze([...CLASS_ORDER, 'free']);
export const DLC_IDS = Object.freeze(['base', 'dlc1', 'dlc2', 'dlc3', 'dlc4']);
export const ACQ_TAGS = Object.freeze(['shop', 'pickup', 'craft', 'boss', 'puzzle', 'rng', 'unknown']);
/** 可信度枚举：data 里存在两套写法（items/icon_index/item_effects 用 medium；codex/archetypes 用 mid） */
export const CONFIDENCE = Object.freeze(['high', 'medium', 'low']);
export const CODEX_CONFIDENCE = Object.freeze(['high', 'mid', 'low']);
export const NOTE_KINDS = Object.freeze(['info', 'warn', 'tip']);

/* ----------------------------- 读取（module 级缓存） ----------------------------- */

const dataCache = new Map();

export function readJsonFile(root, relPath) {
  const abs = join(root, relPath);
  let text;
  try {
    text = readFileSync(abs, 'utf8');
  } catch (cause) {
    throw new Error(`读取数据文件失败：${relPath}（${abs}）：${cause.message}`);
  }
  try {
    return JSON.parse(text);
  } catch (cause) {
    throw new Error(`解析数据文件失败：${relPath}（${abs}）：${cause.message}`);
  }
}

/**
 * 读取全部 10 个数据文件 + 配装源快照（只读，module 级缓存）。
 * items.json 7.3MB：整个测试进程只 parse 一次。
 */
export function loadData(root = REPO_ROOT) {
  if (dataCache.has(root)) return dataCache.get(root);
  const docs = { sourceBuilds: readJsonFile(root, SOURCE_BUILDS_FILE) };
  for (const [key, relPath] of Object.entries(DATA_FILES)) docs[key] = readJsonFile(root, relPath);
  dataCache.set(root, docs);
  return docs;
}

/* ------------------------------- 规则小工具 ------------------------------- */

const str = (extra = {}) => ({ type: 'string', ...extra });
const nstr = (extra = {}) => ({ type: 'string', minLength: 1, ...extra });
const strOrNull = (extra = {}) => ({ type: ['string', 'null'], ...extra });
const num = (extra = {}) => ({ type: 'number', ...extra });
const int = (extra = {}) => ({ type: 'integer', ...extra });
const numOrNull = (extra = {}) => ({ type: ['number', 'null'], ...extra });
const intOrNull = (extra = {}) => ({ type: ['integer', 'null'], ...extra });
const bool = (extra = {}) => ({ type: 'boolean', ...extra });
const arr = (items, extra = {}) => ({ type: 'array', items, ...extra });
const obj = (properties, extra = {}) => ({ type: 'object', properties, ...extra });
const map = (values, extra = {}) => ({ type: 'object', additionalProperties: values, ...extra });
const req = (key, why) => ({ key, why });

/* --------------------------------- items ---------------------------------- */

const itemSetRule = obj({
  key: nstr(),
  name_en: nstr(),
  name_zh: strOrNull(),
  slot: nstr(),
  slot_count: int(),
  parts: arr(nstr()),
  parts_missing_stats: arr(nstr()),
  totals: obj({
    armor: num(),
    encumbrance: num(),
    resistance_sum: num(),
    value: num(),
  }, { required: [req('armor', '套装修炼合计用于列表/排序'), req('encumbrance', '套装负重合计'), req('resistance_sum', '套装抗性合计'), req('value', '套装价值合计')] }),
  complete: bool(),
}, {
  required: [
    req('key', '套装分组键（同套多件共享）'),
    req('name_en', '套装英文名'),
    req('name_zh', '套装中文名（Nude 等无官方译文时允许 null）'),
    req('slot', '套装主槽位（视图按部位找套）'),
    req('slot_count', '套装的件数'),
    req('parts', '套装包含的道具 id 列表（跨条目分组）'),
    req('complete', '是否凑齐整套（列表展示「已完整/缺件」）'),
    req('totals', '套装数值合计（排序与摘要）'),
  ],
});

const itemEffectLineRule = obj({
  key: nstr(),
  label_en: nstr(),
  label_zh: nstr(),
  value: { type: ['number', 'boolean'] },
  unit: nstr(),
  display_en: nstr(),
  display_zh: nstr(),
  category: nstr(),
  source: strOrNull(),
}, {
  required: [
    req('key', '效果数值键（与 numbers 对应，去重/合并依据）'),
    req('label_zh', '效果句中的中文字段名'),
    req('value', '效果数值（bool 表示开关型）'),
    req('unit', '数值单位（flat/percent/seconds…）'),
    req('category', '效果分类（归类到输出/防御等）'),
  ],
});

const itemEffectRule = obj({
  lines: arr(itemEffectLineRule),
  summary_en: str(),
  summary_zh: str(),
  source: nstr(),
  confidence: nstr(),
  text_en: strOrNull(),
  text_zh: strOrNull(),
  text_raw: strOrNull(),
}, {
  required: [
    req('lines', '详情页效果区逐行展示的数据源（部分条目以 text_* 原文兜底，lines 为空数组）'),
    req('summary_en', '列表摘要英文'),
    req('summary_zh', '列表摘要中文'),
    req('source', '效果来源（numbers/description…，用于标注可信度）'),
    req('confidence', '效果可信度（官方/派生）'),
  ],
  checks: [(effect, ctx) => {
    if (!effect || typeof effect !== 'object') return;
    const hasLines = Array.isArray(effect.lines) && effect.lines.length > 0;
    const hasText = typeof effect.text_en === 'string' && effect.text_en.length > 0;
    if (!hasLines && !hasText) {
      ctx.fail(['lines'], {
        expected: '非空 lines 数组，或 text_en 原文',
        actual: effect.lines,
        message: 'effect 至少有逐行数值（lines）或官方原文（text_en）之一，否则详情页效果区没有可展示内容',
      });
    }
  }],
});

const itemTextRule = {
  type: ['object', 'null'],
  checks: [(text, ctx) => {
    if (!text) return;
    for (const field of ['label', 'description', 'flavor', 'pickup', 'interact', 'sublabel']) {
      const value = text[field];
      if (value === undefined || value === null) continue;
      if (typeof value !== 'object' || Array.isArray(value)) {
        ctx.fail([field], { expected: '本地化文本对象 {en,zh,zh_hant}', actual: value, message: `text.${field} 应是本地化对象` });
        continue;
      }
      for (const locale of ['en', 'zh', 'zh_hant', 'key']) {
        if (value[locale] !== undefined && value[locale] !== null && typeof value[locale] !== 'string') {
          ctx.fail([field, locale], { expected: '字符串或 null', actual: value[locale], message: `text.${field}.${locale} 应为字符串` });
        }
      }
    }
  }],
};

const itemRule = obj({
  id: nstr(),
  cat: { type: 'string', enum: ITEM_CATS },
  kind: { type: 'string', enum: ITEM_KINDS },
  is_item: bool(),
  pkg: nstr(),
  slot: { type: 'string', enum: ITEM_SLOTS },
  display: obj({
    name_en: strOrNull(),
    name_zh: strOrNull(),
    subtitle_en: strOrNull(),
    subtitle_zh: strOrNull(),
    name_zh_hant: strOrNull(),
  }, {
    required: [
      req('name_en', '英文名（副标题与英文搜索）'),
      req('name_zh', '中文名（列表/详情主标题；无译文允许 null）'),
    ],
  }),
  name: str(),
  zh_name: strOrNull(),
  icon_asset: strOrNull(),
  filter_tags: arr(str()),
  tags: arr(str()),
  unique: bool({ nullable: true }),
  max_stack_count: intOrNull(),
  numbers: obj({}),
  numbers_quality: strOrNull(),
  stats_flat: {
    type: ['object', 'null'],
    checks: [(stats, ctx) => {
      if (!stats || typeof stats !== 'object') return;
      for (const [key, value] of Object.entries(stats)) {
        if (typeof value !== 'number' && typeof value !== 'boolean') {
          ctx.fail([key], { expected: '数字或布尔', actual: value, message: `stats_flat.${key} 是解码数值，应为 number/boolean` });
        }
      }
    }],
  },
  base_stats: {
    type: ['object', 'null'],
    properties: {
      table: str(),
      row: str(),
      match: str(),
      values: obj({}),
      raw_values: obj({}),
    },
  },
  set: { ...itemSetRule, nullable: true },
  effect: { ...itemEffectRule, nullable: true },
  text: itemTextRule,
  flags: obj({}, {
    checks: [(flags, ctx) => {
      if (!flags || typeof flags !== 'object') return;
      if (flags.confidence !== undefined && flags.confidence !== null && !CONFIDENCE.includes(flags.confidence)) {
        ctx.fail(['confidence'], { expected: `高/中/低可信度 ${JSON.stringify(CONFIDENCE)}`, actual: flags.confidence });
      }
    }],
  }),
  decode_status: str(),
}, {
  required: [
    req('id', '主键：builds/item_effects/acq 等跨文件引用都靠它定位'),
    req('cat', '资料库分类（#/items 筛选与分组）按此聚合'),
    req('kind', '区分真道具/动作/资产变体；is_item 的判定依据'),
    req('is_item', '资料库只展示 is_item=true；统计口径（1126 件）依赖它'),
    req('pkg', '资产包路径：每条数据必须可溯源到游戏资产'),
    req('slot', '装备槽位归组（详情/筛选/配装槽位映射）'),
    req('display', '名称展示唯一来源（name_zh/name_en）'),
  ],
});

const itemsRootRule = obj({
  meta: obj({
    schema_version: str(),
    counts: obj({
      total: int(),
      is_item: int(),
      sets: int(),
      sets_complete: int(),
      kind: map(int()),
      cat: map(int()),
      slot: map(int()),
    }, {
      required: [
        req('total', '条目总数自检（与 items.length 对账）'),
        req('is_item', '真道具数自检（资料库入口口径）'),
        req('kind', 'kind 分布自检（生成链质量指标）'),
        req('cat', '分类分布自检'),
        req('slot', '槽位分布自检'),
        req('sets', '护甲套装数自检'),
        req('sets_complete', '已凑齐套装数自检'),
      ],
    }),
  }, {
    required: [
      req('schema_version', 'items.json 数据格式版本；校验器按支持集合决定接受/拒绝'),
      req('counts', '数据自检计数；与实际内容对账后才能发现生成链回归'),
    ],
  }),
  items: arr(itemRule, { minItems: 1, uniqueBy: 'id' }),
}, {
  required: [
    req('meta', '数据集元信息（版本/计数/来源）'),
    req('items', '主数据数组，所有领域都从它派生'),
  ],
});

/* --------------------------------- builds --------------------------------- */

const buildArmorRule = obj({
  weight_class: nstr(),
  total_armor: num(),
  total_weight: num(),
  need: str(),
  note: str(),
}, { required: [req('weight_class', '负重档位展示'), req('total_armor', '护甲值合计'), req('total_weight', '负重合计')] });

const buildArchetypeRule = obj({
  name_en: nstr(),
  name_zh: nstr(),
  role: nstr(),
  why: nstr(),
}, { required: [req('name_en', '职业英文名（引用解析键）'), req('name_zh', '职业中文名'), req('role', '主/副职业标记'), req('why', '选择理由（详情页解释）')] });

const buildWeaponRule = obj({
  id: nstr(),
  name_zh: str(),
  name_en: str(),
  inherent_mod: strOrNull(),
  inherent_mod_item: { type: ['object', 'null'] },
  can_swap_mod: bool(),
  mutator: strOrNull(),
  mod: strOrNull(),
}, { required: [req('id', '武器引用必须能解析到 items.json'), req('can_swap_mod', '决定改装位是否可换')] });

const buildLoadoutRule = obj({
  weapons: map(buildWeaponRule, { propertyNames: { enum: ['long_gun', 'hand_gun', 'melee_weapon'] } }),
  unused_mods: arr(str()),
  fix_reason: str(),
  variants: arr(str()),
  free_mod_slots: arr(nstr()),
}, { required: [req('weapons', '配装武器槽（详情页武器链的输入）'), req('variants', '替换说明（纯文本数组）')] });

const buildEvalRule = obj({
  key: nstr(),
  name: strOrNull(),
  single: num(),
  aoe: num(),
  survival: num(),
  difficulty: num(),
  gear: num(),
  composite: num(),
  trinket_mult: num(),
  trinket_share: num(),
  scenario: str(),
}, { required: [req('key', '与 builds[].key 对应（评分按套关联）'), req('composite', '综合评分（列表排序/展示）')] });

const buildRule = obj({
  key: nstr(),
  order: int(),
  name_zh: nstr(),
  tagline: str(),
  role: str(),
  chain_zh: str(),
  scenario: str(),
  ratings: obj({
    single: num(), aoe: num(), survival: num(), difficulty: num(), gear: num(),
  }, { required: [req('single', '评分维度'), req('aoe', '评分维度'), req('survival', '评分维度'), req('difficulty', '评分维度'), req('gear', '评分维度')] }),
  archetypes: arr(buildArchetypeRule),
  armor: buildArmorRule,
  armor_parts: arr(nstr(), { minItems: 1 }),
  slots: map(arr(nstr()), { propertyNames: { enum: BUILD_SLOT_KEYS } }),
  slot_order: arr(nstr()),
  loop: arr(str()),
  alts: arr(str()),
  evidence: arr(str()),
  trash_plan: arr(str()),
  trash_fix: arr(str()),
  difficulty_notes: arr(str()),
  trinket: obj({
    multiplier: num(),
    note: str(),
    lines: arr(str()),
  }, { required: [req('multiplier', '饰品乘区数值（详情页主统计）'), req('lines', '饰品拆解说明')] }),
  loadout: buildLoadoutRule,
  eval: buildEvalRule,
}, {
  required: [
    req('key', '流派唯一标识（#/builds/<key> 深链与跨文件引用）'),
    req('order', '列表展示顺序（1..N 连续）'),
    req('name_zh', '流派中文名（列表/详情标题）'),
    req('tagline', '一句话定位（列表卡片）'),
    req('ratings', '五维评分（列表排序与徽章）'),
    req('archetypes', '职业组合（详情页职业区）'),
    req('armor', '护甲档位/数值（详情页护甲区）'),
    req('slots', '配装槽位引用（详情页装备区，须可解析）'),
    req('slot_order', '槽位展示顺序（详情页排版）'),
    req('trinket', '饰品乘区（详情页乘区区）'),
    req('loadout', '武器改装/变异器配置（详情页武器链）'),
    req('eval', '评分口径明细（详情页底部）'),
  ],
});

const buildsRootRule = obj({
  meta: obj({
    schema: int(),
    counts: obj({
      builds: int(),
      items: int(),
      i18n: int(),
      rules: int(),
      armor_sets: int(),
    }, {
      required: [
        req('builds', '流派数与 builds.length 对账'),
        req('items', '道具摘要数与 items 键数对账'),
        req('i18n', '纯文本实体数与 i18n 键数对账'),
        req('rules', '规则条数与 rules.length 对账'),
      ],
    }),
  }, {
    required: [req('schema', 'builds.json 数据格式版本'), req('counts', '条目数自检（防生成链漏项）')],
  }),
  builds: arr(buildRule, { minItems: 1, uniqueBy: 'key' }),
  items: map(obj({
    id: strOrNull(),
    key: strOrNull(),
    slot: str(),
    type_zh: str(),
    name_zh: nstr(),
    name_en: strOrNull(),
    icon_asset: strOrNull(),
    effect_zh: strOrNull(),
    effect_en: strOrNull(),
    stats: obj({}),
    level: { type: ['object', 'null'] },
    acq_zh: str(),
    acq_en: str(),
    archetype_zh: strOrNull(),
    inherent_mod_en: strOrNull(),
    dlc: strOrNull(),
    conf: strOrNull(),
  }, { required: [req('name_zh', '摘要展示名（实体解析第二级）')] })),
  i18n: map(nstr()),
  archetype_zh: map(nstr()),
  armor: obj({
    sets: arr(obj({
      key: nstr(),
      name_zh: nstr(),
      name_en: nstr(),
      parts: int(),
      armor: num(),
      weight: num(),
      eff: num(),
      res_str: nstr(),
    }, { required: [req('key', '套装分组键'), req('parts', '套装件数'), req('armor', '套装护甲合计'), req('weight', '套装负重合计')] }), { minItems: 1 }),
    mix_builds: arr(obj({
      name_zh: nstr(),
      weight_class: nstr(),
      armor: num(),
      weight: num(),
      for: nstr(),
      parts: arr(nstr(), { minItems: 1 }),
      res_str: nstr(),
    }, { required: [req('name_zh', '混搭方案名'), req('parts', '混搭护甲 id 列表')] })),
    set_bonus_answer: obj({}),
  }, { required: [req('sets', '护甲套装表（详情页套装区）'), req('mix_builds', '负重档位混搭表')] }),
  rules: arr(obj({ title: nstr(), text: nstr() }, { required: [req('title', '规则标题'), req('text', '规则说明')] })),
  weight_thresholds: obj({}),
  trinket_principles: arr(str()),
  trinket_scarcity: obj({}),
  underrated: arr(obj({ id: nstr(), fit: str(), gain: str(), text: str(), why: str() }, { required: [req('id', '被低估道具的 items id'), req('text', '英文原文')] })),
  data_notes: arr(str()),
  eval_notes: arr(str()),
}, {
  required: [
    req('meta', '流派数据元信息（版本/计数）'),
    req('builds', '7 套流派主数据'),
    req('items', '配装参与道具的 UI 摘要（详情页实体解析第二级）'),
    req('i18n', '无本地 id 的纯文本实体登记（碎片/传奇词条）'),
  ],
});

/* -------------------------------- site_data ------------------------------- */

const classKeyMap = (valueRule) => map(valueRule, { propertyNames: { enum: CLASS_ORDER } });

const formulaRule = obj({
  armor_k: num({ const: 200 }),
  max_total_dr: num({ const: 0.8 }),
  weight_eps: num(),
  base_thresh: arr(num(), { const: [25, 50, 75], minItems: 3, maxItems: 3 }),
  thresh_min: num(),
  thresh_max: num(),
  base_stamina: num(),
  base_stamina_regen: num(),
  base_evade_cost: num(),
  min_evade_stamina: num(),
  frame_rate: num(),
  max_weight: num(),
  class_penalty: classKeyMap(num()),
  class_iframes: classKeyMap(int()),
  class_recovery: classKeyMap(int()),
  neutral_iframes: classKeyMap(int()),
  neutral_recovery: classKeyMap(int()),
  class_sprint: classKeyMap(num()),
  bulwark_table: arr(num(), { minItems: 1 }),
  elemental_types: arr(nstr()),
  res_types: arr(nstr()),
  all_types: arr(nstr()),
  slots: arr(nstr(), { const: ['head', 'body', 'legs', 'gloves'] }),
  class_order: arr(nstr(), { const: [...CLASS_ORDER] }),
  formula_notes: arr(str()),
}, {
  required: [
    req('armor_k', '护甲减伤公式分母常数（200 = DamageResistConstant，codex/armor-dr 与游戏资产一致）'),
    req('max_total_dr', '总减伤 80% 上限（clamp 口径，改了这个页面所有减伤数字都会变）'),
    req('weight_eps', '负重/阈值比较的浮点容差（6.0+10.8+5.4+2.8 类合法组合不被误杀）'),
    req('base_thresh', '负重档位基础阈值 [25,50,75]'),
    req('base_stamina', '体力基数（stamina 面板公式输入）'),
    req('frame_rate', '帧率换算（无敌帧/恢复帧→秒）'),
    req('max_weight', '负重上限（档位判定输入）'),
    req('class_penalty', '各档位耐力惩罚'),
    req('class_iframes', '各档位闪避无敌帧'),
    req('class_recovery', '各档位闪避恢复帧'),
    req('neutral_iframes', '各档位中立翻滚无敌帧'),
    req('neutral_recovery', '各档位中立翻滚恢复帧'),
    req('class_sprint', '各档位冲刺速度'),
    req('class_order', '档位枚举顺序（与 terms.weightClass 对齐）'),
    req('slots', '护甲部位枚举（pieces 的 slot 取值域）'),
    req('all_types', '伤害类型全集（减伤矩阵列）'),
  ],
});

const pieceRule = obj({
  id: nstr(),
  zh: nstr(),
  en: nstr(),
  slot: { type: 'string', enum: ['head', 'body', 'legs', 'gloves'] },
  set: nstr(),
  armor: num(),
  weight: num(),
  res: arr(num(), { minItems: 5, maxItems: 5 }),
  icon: nstr(),
  dobtain: arr(nstr()),
  dlc: nstr(),
}, {
  required: [
    req('id', '护甲道具 id（必须能在 items.json 找到）'),
    req('zh', '中文名'), req('en', '英文名'),
    req('slot', '护甲部位（四件套拼装）'),
    req('set', '套装分组键'), req('armor', '护甲值'), req('weight', '负重'),
    req('res', '五类抗性 [流血,火,电,腐蚀,枯萎]'),
    req('icon', '图标相对路径'), req('dobtain', '获取途径'),
  ],
});

const presetResultRule = obj({
  parts: arr(int(), { minItems: 4, maxItems: 4 }),
  a: num(),
  w: num(),
  cl: nstr(),
  adr: num(),
  tot: arr(num(), { minItems: 5, maxItems: 5 }),
  sc: num(),
  st: arr(num(), { minItems: 8, maxItems: 8 }),
}, {
  required: [
    req('parts', '4 件护甲在 pieces 数组中的下标（0..pieces.length-1）'),
    req('a', '护甲合计'), req('w', '加权负重'), req('cl', '档位'),
    req('adr', '护甲减伤率'), req('tot', '五类总减伤'), req('sc', '场景分'), req('st', '体力/闪避派生值'),
  ],
});

const presetRule = obj({
  p: nstr(),
  c: nstr(),
  s: nstr(),
  best: presetResultRule,
  ba: presetResultRule,
  top: arr(presetResultRule, { minItems: 1 }),
}, {
  required: [
    req('p', 'profile（特性/饰品组合）id'), req('c', '负重档位（含 free）'), req('s', '场景 id'),
    req('best', '场景分最优方案'), req('ba', '负重上限内护甲最大方案'), req('top', '最优候选列表'),
  ],
});

const altPieceRule = obj({
  id: nstr(),
  zh: nstr(),
  icon: str(),
  dob: arr(nstr()),
  dlc: str(),
  dsc: num(),
  da: num(),
  dw: num(),
  dr: arr(num()),
}, { required: [req('id', '替换护甲 id（必须在 pieces 中）'), req('da', '护甲差值'), req('dw', '负重差值')] });

const substituteSlotRule = obj({
  cur: nstr(),
  alts: arr(altPieceRule),
  fb: presetResultRule,
  fbdsc: num(),
  fbdw: num(),
}, { required: [req('cur', '当前护甲 id'), req('alts', '可替换护甲列表'), req('fb', '替换后最优方案')] });

const substituteCellRule = obj({
  head: substituteSlotRule,
  body: substituteSlotRule,
  legs: substituteSlotRule,
  gloves: substituteSlotRule,
}, { required: [req('head', '头盔替换'), req('body', '胸甲替换'), req('legs', '腿甲替换'), req('gloves', '手甲替换')] });

const siteRootRule = obj({
  meta: obj({
    schema: int(),
    counts: obj({
      pieces: int(),
      presets: int(),
      substitutes_cells: int(),
      prev_builds: int(),
      modifiers: obj({
        traits: int(), rings: int(), amulets: int(), fragments: int(), perks: int(), consumables: int(),
      }),
    }, { required: [req('pieces', '护甲件数与 pieces.length 对账'), req('presets', '预设数与 presets.length 对账'), req('substitutes_cells', '替换格数与 substitutes 键数对账'), req('prev_builds', '旧配装数与 prev_builds.length 对账'), req('modifiers', '修正项条数自检')] }),
    formula: formulaRule,
    notes: str(),
    build_schema: obj({}),
  }, {
    required: [
      req('schema', 'site_data.json 数据格式版本'),
      req('formula', '实验室公式常数（页面实时重算的唯一来源）'),
      req('counts', '条目数自检'),
    ],
  }),
  pieces: arr(pieceRule, { minItems: 1, uniqueBy: 'id' }),
  scenarios: arr(obj({
    id: nstr(),
    zh: nstr(),
    desc: str(),
    weights: map(num()),
    mode: { type: 'string', enum: ['maxmin'] },
    types: arr(nstr()),
  }, { required: [req('id', '场景 id（presets.s 引用）'), req('zh', '场景名'), req('desc', '场景说明')] }), { uniqueBy: 'id', minItems: 1 }),
  profiles: arr(obj({
    id: nstr(),
    zh: nstr(),
    traits: map(int()),
    rings: arr(nstr()),
    amulet: strOrNull(),
    perks: arr(nstr()),
    fragments: arr(nstr()),
    consumables: arr(nstr()),
  }, { required: [req('id', 'profile id（presets.p / substitutes 键引用）'), req('zh', 'profile 名'), req('traits', '特性等级表')] }), { uniqueBy: 'id', minItems: 1 }),
  presets: arr(presetRule, {
    uniqueBy: (preset) => `${preset?.p}|${preset?.c}|${preset?.s}`,
    minItems: 1,
  }),
  substitutes: map(substituteCellRule, {
    propertyNames: { pattern: /^[a-z0-9_]+\|(?:LIGHT|MEDIUM|HEAVY|ULTRA|free)\|[a-z0-9_]+$/ },
  }),
  prev_builds: arr(obj({
    key: nstr(),
    name_zh: nstr(),
    tagline: str(),
    role: str(),
    archetypes: arr({ type: 'object' }),
    armor: obj({}),
    slots: map(arr(nstr())),
  }, { required: [req('key', '旧配装键'), req('name_zh', '旧配装名'), req('slots', '旧配装槽位')] })),
  prev_items: map(obj({
    id: nstr(),
    zh: nstr(),
    type: nstr(),
    icon: strOrNull(),
    effect_zh: str(),
  }, { required: [req('id', '道具 id'), req('zh', '中文名')] })),
}, {
  required: [
    req('meta', '实验室数据元信息（版本/公式/计数）'),
    req('pieces', '护甲件数据（实验室 15 槽的护甲来源）'),
    req('scenarios', '场景定义（预设按场景打分）'),
    req('profiles', '特性/饰品 profile（预设的 p 维度）'),
    req('presets', '330 组护甲预设（实验室计算器/档位对照）'),
    req('substitutes', '逐槽替换候选（实验室替换面板）'),
  ],
});

/* ------------------------------- archetypes ------------------------------- */

const archetypeRule = obj({
  id: nstr(),
  en: nstr(),
  zh: nstr(),
  dlc: { type: 'string', enum: DLC_IDS },
  role: strOrNull(),
  status: { type: 'string', enum: ['released', 'unreleased'] },
  confidence: { type: 'string', enum: CODEX_CONFIDENCE },
  zhConfidence: { type: 'string', enum: CODEX_CONFIDENCE },
  zhSource: nstr(),
  trait: {
    type: ['object', 'null'],
    properties: {
      id: nstr(), zh: nstr(), en: nstr(), effectSource: str(), source: str(),
    },
    required: [req('id', '职业特性 id'), req('zh', '特性中文名')],
  },
  perks: arr(obj({
    id: nstr(),
    zh: nstr(),
    effect: obj({}),
    condition: strOrNull(),
    stacks: num(),
    uptime: num(),
    note: str(),
  }, { required: [req('id', '专长 id'), req('zh', '专长中文名'), req('effect', '专长数值效果（实验室建模输入）')] })),
  coreTraits: {
    type: ['object', 'null'],
    additionalProperties: num(),
  },
  engram: obj({
    id: nstr(),
    labelEn: strOrNull(),
    labelZh: strOrNull(),
  }, { required: [req('id', '解锁道具 id（必须能在 items.json 找到）')] }),
  sources: obj({}),
  zhEvidence: arr(obj({})),
  zhConflicts: arr(obj({})),
}, {
  required: [
    req('id', '职业 id（terms.archetypes 与 builds.archetypes.name_en 的引用键）'),
    req('en', '英文名'), req('zh', '官方中文名'),
    req('dlc', 'DLC 归属（过滤/徽章）'),
    req('status', '实装状态（未实装职业不计入推荐）'),
    req('confidence', '数据可信度'),
    req('engram', '职业解锁道具（详情/链接）'),
  ],
});

const archetypesRootRule = obj({
  meta: obj({ schema: int(), updated: str(), source: str() }, {
    required: [req('schema', 'archetypes.json 数据格式版本')],
  }),
  archetypes: arr(archetypeRule, { minItems: 1, uniqueBy: 'id' }),
}, {
  required: [req('meta', '元信息（版本）'), req('archetypes', '16 个职业条目')],
});

/* ---------------------------------- codex --------------------------------- */

const blockRule = obj({
  t: { type: 'string', enum: CODEX_BLOCK_TYPES },
}, {
  required: [req('t', '块类型决定渲染分支（js/views/codex.js 的 switch(b.t)）')],
  checks: [(block, ctx) => {
    if (!block || typeof block !== 'object') return;
    const needString = (key, why) => {
      if (typeof block[key] !== 'string' || block[key].length === 0) {
        ctx.fail([key], { expected: `非空字符串 ${key}${why ? `（${why}）` : ''}`, actual: block[key] });
      }
    };
    const needStringArray = (key, minItems = 1) => {
      if (!Array.isArray(block[key])) {
        ctx.fail([key], { expected: `字符串数组 ${key}`, actual: block[key] });
        return;
      }
      if (block[key].length < minItems) ctx.fail([key], { expected: `至少 ${minItems} 项`, actual: block[key].length, message: `${key} 至少需要 ${minItems} 项` });
      block[key].forEach((value, index) => {
        if (typeof value !== 'string') ctx.fail([key, index], { expected: '字符串单元格', actual: value });
      });
    };
    switch (block.t) {
      case 'h':
        if (!Number.isInteger(block.level)) ctx.fail(['level'], { expected: '整数标题层级', actual: block.level });
        needString('text', '标题文字');
        break;
      case 'p':
        needString('text', '段落文字');
        break;
      case 'formula':
        needString('code', '公式正文');
        needString('caption', '公式说明');
        break;
      case 'table':
        needStringArray('head');
        if (!Array.isArray(block.rows)) {
          ctx.fail(['rows'], { expected: '二维字符串数组', actual: block.rows });
        } else {
          block.rows.forEach((row, rowIndex) => {
            if (!Array.isArray(row)) {
              ctx.fail(['rows', rowIndex], { expected: '字符串数组行', actual: row });
              return;
            }
            row.forEach((cell, colIndex) => {
              if (typeof cell !== 'string') ctx.fail(['rows', rowIndex, colIndex], { expected: '字符串单元格', actual: cell });
            });
          });
        }
        if (block.num !== undefined) {
          if (!Array.isArray(block.num)) ctx.fail(['num'], { expected: '整数下标数组（数值列）', actual: block.num });
          else block.num.forEach((value, index) => {
            if (!Number.isInteger(value) || value < 0) ctx.fail(['num', index], { expected: '非负整数列下标', actual: value });
            else if (Array.isArray(block.head) && value >= block.head.length) ctx.fail(['num', index], { expected: `< head.length(${block.head.length})`, actual: value });
          });
        }
        if (block.caption !== undefined && typeof block.caption !== 'string') ctx.fail(['caption'], { expected: '字符串', actual: block.caption });
        break;
      case 'list':
        needStringArray('items');
        if (block.ordered !== undefined && typeof block.ordered !== 'boolean') ctx.fail(['ordered'], { expected: '布尔', actual: block.ordered });
        break;
      case 'evidence':
        needStringArray('head');
        if (!Array.isArray(block.rows)) ctx.fail(['rows'], { expected: '二维字符串数组', actual: block.rows });
        else block.rows.forEach((row, rowIndex) => {
          if (!Array.isArray(row)) ctx.fail(['rows', rowIndex], { expected: '字符串数组行', actual: row });
          else row.forEach((cell, colIndex) => { if (typeof cell !== 'string') ctx.fail(['rows', rowIndex, colIndex], { expected: '字符串单元格', actual: cell }); });
        });
        break;
      case 'note':
        if (!NOTE_KINDS.includes(block.kind)) ctx.fail(['kind'], { expected: `提示类型 ${JSON.stringify([...NOTE_KINDS])}`, actual: block.kind });
        needString('text', '提示文字');
        break;
      default:
        break; // 未知 t 已由 enum 规则报错
    }
  }],
});

const codexArticleRule = obj({
  id: nstr(),
  cat: nstr(),
  title: nstr(),
  subtitle: nstr(),
  summary: nstr(),
  brief: nstr(),
  confidence: { type: 'string', enum: CODEX_CONFIDENCE },
  order: int(),
  blocks: arr(blockRule, { minItems: 1 }),
  links: arr(obj({ label: nstr(), href: nstr({ pattern: /^#\// }) }, {
    required: [req('label', '链接文字'), req('href', '站内 hash 路由（#/…）')],
  })),
  related: arr(nstr()),
  sources: arr(obj({ k: nstr(), v: nstr(), url: str() }, {
    required: [req('k', '来源名'), req('v', '来源说明')],
  })),
}, {
  required: [
    req('id', '文章唯一 id（#/codex/<id> 深链与 related 引用）'),
    req('cat', '分类 id（必须能在 categories 找到）'),
    req('title', '文章标题'), req('summary', '摘要（目录卡）'),
    req('brief', '一句话结论'), req('confidence', '证据可信度'),
    req('order', '目录排序'), req('blocks', '正文块（渲染唯一输入）'),
    req('links', '站内链接'), req('related', '相关文章 id 列表'), req('sources', '来源清单'),
  ],
});

const codexRootRule = obj({
  version: int(),
  updated: str(),
  game: obj({ name: nstr(), patch: nstr(), patchDate: str(), note: str() }, {
    required: [req('name', '游戏名'), req('patch', '数据对应补丁版本')],
  }),
  _schema: obj({}),
  categories: arr(obj({
    id: nstr(),
    zh: nstr(),
    en: nstr(),
    icon: nstr(),
    desc: str(),
    order: int(),
  }, { required: [req('id', '分类 id（articles.cat 引用）'), req('zh', '分类中文名'), req('order', '目录排序')] }), { uniqueBy: 'id', minItems: 1 }),
  articles: arr(codexArticleRule, { uniqueBy: 'id', minItems: 1 }),
}, {
  required: [
    req('version', 'codex 数据格式版本'),
    req('categories', '分类表（article.cat 的引用域）'),
    req('articles', '13 篇知识库文章'),
  ],
});

/* ---------------------------------- terms --------------------------------- */

const termsRootRule = obj({
  version: int(),
  updated: str(),
  note: str(),
  nameLang: obj({ zh: nstr(), en: nstr() }, { required: [req('zh', '语言显示名'), req('en', '语言显示名')] }),
  damage: arr(obj({
    id: nstr(), zh: nstr(), en: nstr(), icon: nstr(), color: nstr(),
    resistKey: strOrNull(), note: str(),
  }, { required: [req('id', '伤害类型 id'), req('zh', '中文名'), req('en', '英文名')] }), { uniqueBy: 'id', minItems: 1 }),
  resistOrder: arr(nstr(), { minItems: 1 }),
  resistZh: map(nstr()),
  stats: map(obj({ zh: nstr(), en: nstr(), icon: nstr(), verified: nstr() }, {
    required: [req('zh', '属性中文名'), req('en', '属性英文名')],
  })),
  weightClass: arr(obj({
    id: { type: 'string', enum: CLASS_ORDER },
    zh: nstr(), en: nstr(),
    threshold: arr(num(), { minItems: 2, maxItems: 2 }),
    penalty: num(), evade: nstr(), iframe: int(), recovery: int(), evadeCost: num(),
  }, { required: [req('id', '档位 id（与 formula.class_order 对齐）'), req('threshold', '档位负重区间'), req('iframe', '无敌帧'), req('recovery', '恢复帧')] }), { uniqueBy: 'id', minItems: 1 }),
  acquisition: arr(obj({
    id: nstr(), zh: nstr(), icon: nstr(), color: nstr(), difficulty: int(),
  }, { required: [req('id', '获取途径 id（acq.tags 引用）'), req('zh', '中文名')] }), { uniqueBy: 'id', minItems: 1 }),
  confidence: arr(obj({ id: nstr(), zh: nstr(), en: nstr() }, { required: [req('id', '可信度 id')] }), { uniqueBy: 'id' }),
  slots: arr(obj({
    id: nstr(), zh: nstr(), en: nstr(), icon: nstr(), dataSlot: nstr(),
  }, { required: [req('id', '全站槽位 id'), req('dataSlot', '数据层槽位名（items.slot 映射）')] }), { uniqueBy: 'id', minItems: 1 }),
  cats: arr(obj({ id: nstr(), zh: nstr(), icon: nstr() }, { required: [req('id', '分类 id（#/items 筛选用）'), req('zh', '中文名')] }), { uniqueBy: 'id', minItems: 1 }),
  dlc: arr(obj({ id: nstr(), zh: nstr() }, { required: [req('id', 'DLC id（archetypes.dlc 引用）'), req('zh', '中文名')] }), { uniqueBy: 'id', minItems: 1 }),
  gameTags: arr(obj({
    id: nstr(), zh: nstr(), en: nstr(), group: nstr(), icon: nstr(), desc: nstr(),
    verified: nstr(), alias: arr(str()),
  }, { required: [req('id', '标签 id（items.filter_tags 引用）'), req('zh', '标签中文名'), req('group', '标签分组')] }), { uniqueBy: 'id', minItems: 1 }),
  effectCategories: map(nstr()),
  archetypes: map(nstr()),
  relicFragment: obj({}),
}, {
  required: [
    req('version', 'terms 数据格式版本'),
    req('slots', '全站槽位映射表'),
    req('cats', '资料库分类表'),
    req('gameTags', '筛选标签表（items.filter_tags 的引用域）'),
    req('effectCategories', '效果分类词表（items.effect.lines[].category 的引用域）'),
    req('archetypes', '职业官方译名（archetypes.json 的译名来源）'),
  ],
});

/* ------------------------------- item_effects ------------------------------ */

const itemEffectsRootRule = obj({
  meta: obj({
    source: nstr(),
    counts: obj({ none: int(), official: int(), manual: int(), wiki: int() }, {
      required: [req('none', '无任何效果句的道具数'), req('official', '官方效果句条目数'), req('manual', '人工整理条目数')],
    }),
    note: str(),
  }, { required: [req('counts', '效果句覆盖统计（与 items 真道具数对账）')] }),
  items: map(obj({
    zh: str(),
    zhTpl: strOrNull(),
    en: strOrNull(),
    key: strOrNull(),
    src: { type: 'string', enum: ['official', 'manual', 'wiki'] },
    confidence: { type: 'string', enum: CONFIDENCE },
    match: { type: 'string', enum: ['fuzzy', 'exact', 'manual', 'prefix', 'wiki-only'] },
    values: { type: ['array', 'null'] },
  }, { required: [req('src', '来源（官方原文/人工整理/wiki 整理）'), req('confidence', '可信度')] })),
}, {
  required: [
    req('meta', '效果句统计元信息'),
    req('items', '道具 id → 官方效果句'),
  ],
});

/* -------------------------------- icon_index ------------------------------- */

const iconIndexRootRule = obj({
  version: int(),
  generated_at: str(),
  asset_root: str(),
  keyed_by: str(),
  count: int(),
  max_side: int(),
  icons: map(obj({
    file: nstr({ pattern: /^icons\/.+\.png$/ }),
    file_mimocode: nstr(),
    w: int(), h: int(), src_w: int(), src_h: int(),
    fmt: nstr(), png_bytes: int(),
    method: { type: 'string', enum: ['ubulk', 'inline'] },
    confidence: { type: 'string', enum: CONFIDENCE },
    mips: int(), stem: nstr(), src: nstr(),
    inline_off: intOrNull(),
    inline_score: numOrNull(),
    note: strOrNull(),
  }, { required: [req('file', '图标相对路径（api.iconUrl 拼 ./assets/icons/*.png）'), req('w', '像素宽'), req('h', '像素高')] })),
  failures: map(obj({ reason: nstr(), detail: strOrNull(), stem: strOrNull() }, {
    required: [req('reason', '失败原因（missing/ambiguous）')],
  })),
}, {
  required: [
    req('version', 'icon_index 数据格式版本'),
    req('count', '图标总数（必须等于 icons 键数）'),
    req('icons', 'icon_asset → 图标文件映射（详情/列表图标的唯一来源）'),
  ],
});

/* ----------------------------------- acq ---------------------------------- */

const acqRootRule = obj({
  schema: str(),
  generated_at: str(),
  note: str(),
  counts: obj({ total: int(), with_text: int(), with_tags: int(), with_dlc: int() }, {
    required: [req('total', '获取途径条目数（与 items 键数对账）'), req('with_text', '有文本的条目数'), req('with_tags', '有标签的条目数'), req('with_dlc', '有 DLC 归属的条目数')],
  }),
  items: map(obj({
    tags: arr({ type: 'string', enum: ACQ_TAGS }),
    dlc: intOrNull(),
    text: strOrNull(),
  }, { required: [req('tags', '获取途径标签（详情页获取区）')] })),
}, {
  required: [
    req('schema', 'acq 数据格式版本（acq/N）'),
    req('counts', '覆盖统计（与 items 对账）'),
    req('items', '道具 id / 纯文本实体 → 获取途径'),
  ],
});

/* -------------------------------- lab_gear -------------------------------- */

/** 实验室 v2 的 15 个维度 id（契约 LAB_V2.md §1.2，id 不可改；顺序即展示顺序） */
export const LAB_GEAR_DIMENSIONS = Object.freeze([
  'dmg', 'ranged', 'melee', 'crit', 'status', 'mod', 'skill', 'firerate',
  'explosive', 'armor', 'health', 'heal', 'stamina', 'utility', 'summon',
]);
/** 实验室 gear 的 7 个 kind（契约 §1.1） */
export const LAB_GEAR_KINDS = Object.freeze(['ring', 'amulet', 'mutator', 'mod', 'fragment', 'trait', 'relic']);

const labGearDimensionRule = obj({
  id: { type: 'string', enum: LAB_GEAR_DIMENSIONS },
  zh: nstr(),
  order: int(),
}, {
  required: [
    req('id', '维度 id（dims 的键与 playstyles 权重的键，契约固定 15 个）'),
    req('zh', '维度中文名（面板文案）'),
    req('order', '展示顺序'),
  ],
});

const labGearPlaystyleRule = obj({
  id: nstr(),
  zh: nstr(),
  en: nstr(),
  desc: str(),
  dims: map(num({ minimum: 0, maximum: 1 })),
  order: int(),
}, {
  required: [
    req('id', '流派 id（面板选择器与评分输入）'),
    req('zh', '流派中文名'),
    req('dims', '流派维度权重（0–1，键必须是 dimensions[].id）'),
    req('order', '展示顺序'),
  ],
});

const labGearItemRule = obj({
  id: nstr(),
  zh: nstr(),
  en: nstr(),
  dlc: { type: 'string', enum: DLC_IDS },
  tags: arr(str()),
  dims: map(num({ enum: [0.5, 1] })),
  effectZh: nstr(),
  effectZhRaw: nstr(),
  effectEn: nstr(),
  effectSrc: { type: 'string', enum: ['official', 'derived', 'wiki', 'none', 'derived-raw'] },
  effectKeys: arr(nstr()),
  hard: bool(),
  confidence: { type: 'string', enum: CODEX_CONFIDENCE },
  evidence: arr(str()),
  note: str(),
}, {
  required: [
    req('id', '全局唯一主键：实验室按 id 建索引、与 items.json / site_data.modifiers 对齐'),
    req('zh', '中文名（无官方译名时用英文名并标 confidence=low）'),
    req('confidence', '数据可信度（high/mid/low，面板据此标注）'),
  ],
});

const labGearMutatorRule = obj({
  ...labGearItemRule.properties,
  weapon: { type: 'string', enum: ['ranged', 'melee', 'any'] },
}, {
  required: [...labGearItemRule.required, req('weapon', '变异器适配武器类型（fit.recommendMutators 的筛选键）')],
});

const labGearFragmentRule = obj({
  ...labGearItemRule.properties,
  color: { type: 'string', enum: ['red', 'yellow', 'blue'] },
  stat: nstr(),
}, {
  required: [...labGearItemRule.required, req('color', '碎片颜色（红/黄/蓝；面板按颜色分组与均衡提示）')],
});

const labGearTraitRule = obj({
  ...labGearItemRule.properties,
  maxLevel: int({ minimum: 1 }),
  perLevel: map(num()),
}, {
  required: [...labGearItemRule.required, req('maxLevel', '特性等级上限（等级步进器 0–maxLevel）')],
});

const labGearCountsRule = obj({
  dimensions: int(),
  playstyles: int(),
  ring: int(),
  amulet: int(),
  mutator: int(),
  mod: int(),
  fragment: int(),
  trait: int(),
  relic: int(),
}, {
  required: [
    req('dimensions', '维度数与 dimensions.length 对账'),
    req('playstyles', '流派数与 playstyles.length 对账'),
    ...LAB_GEAR_KINDS.map((kind) => req(kind, `gear.${kind}.length 对账（防生成链漏项）`)),
  ],
});

const labGearRootRule = obj({
  meta: obj({
    schema: int(),
    generated: str(),
    generator: nstr(),
    sources: arr(nstr(), { minItems: 1 }),
    notes: arr(str()),
    counts: labGearCountsRule,
  }, {
    required: [req('schema', 'lab_gear 数据格式版本'), req('counts', '条目数自检（与 gear.* 长度对账）')],
  }),
  dimensions: arr(labGearDimensionRule, { minItems: 1, uniqueBy: 'id' }),
  playstyles: arr(labGearPlaystyleRule, { minItems: 1, uniqueBy: 'id' }),
  gear: obj({
    ring: arr(labGearItemRule, { uniqueBy: 'id' }),
    amulet: arr(labGearItemRule, { uniqueBy: 'id' }),
    mutator: arr(labGearMutatorRule, { uniqueBy: 'id' }),
    mod: arr(labGearItemRule, { uniqueBy: 'id' }),
    fragment: arr(labGearFragmentRule, { uniqueBy: 'id' }),
    trait: arr(labGearTraitRule, { uniqueBy: 'id' }),
    relic: arr(labGearItemRule, { uniqueBy: 'id' }),
  }, {
    required: LAB_GEAR_KINDS.map((kind) => req(kind, `gear.${kind} 数组（实验室对应面板的数据源）`)),
  }),
}, {
  required: [
    req('meta', '元信息（版本/来源/计数）'),
    req('dimensions', '维度表（dims 键与流派权重的引用域）'),
    req('playstyles', '流派表（评分权重）'),
    req('gear', '7 类装备目录（面板数据源）'),
  ],
});

/* ------------------------------ 版本 / 计数工具 ------------------------------ */

function getPath(doc, tokens) {
  let current = doc;
  for (const token of tokens) {
    if (current === null || typeof current !== 'object') return undefined;
    current = current[token];
  }
  return current;
}

function compareVersionTuple(a, b) {
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    const left = a[i] ?? 0;
    const right = b[i] ?? 0;
    if (left !== right) return left < right ? -1 : 1;
  }
  return 0;
}

function classifyVersion(spec, actual) {
  if (spec.kind === 'semver') {
    if (typeof actual !== 'string') return 'bad-type';
    if (spec.supported.includes(actual)) return 'ok';
    const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(actual);
    if (!match) return 'unsupported';
    const tuple = [Number(match[1]), Number(match[2]), Number(match[3])];
    const maxMatch = /^(\d+)\.(\d+)\.(\d+)$/.exec(spec.maxKnown);
    const maxTuple = maxMatch ? [Number(maxMatch[1]), Number(maxMatch[2]), Number(maxMatch[3])] : [0, 0, 0];
    return compareVersionTuple(tuple, maxTuple) > 0 ? 'newer' : 'unsupported';
  }
  if (spec.kind === 'number') {
    if (typeof actual !== 'number') return 'bad-type';
    if (spec.supported.includes(actual)) return 'ok';
    return actual > spec.maxKnown ? 'newer' : 'unsupported';
  }
  if (spec.kind === 'prefixed') {
    if (typeof actual !== 'string') return 'bad-type';
    if (spec.supported.includes(actual)) return 'ok';
    if (!actual.startsWith(spec.prefix)) return 'unsupported';
    const suffix = actual.slice(spec.prefix.length);
    const value = Number(suffix);
    if (!Number.isInteger(value)) return 'unsupported';
    return value > spec.maxKnown ? 'newer' : 'unsupported';
  }
  throw new Error(`data-schema.mjs: 未知版本类型 ${spec.kind}`);
}

function versionCheck(key) {
  const spec = SUPPORTED_VERSIONS[key];
  if (!spec) return null;
  return (doc, ctx) => {
    const actual = getPath(doc, spec.field);
    if (actual === undefined) return; // 缺失由 required 规则报
    const result = classifyVersion(spec, actual);
    if (result === 'ok' || result === 'bad-type') return; // bad-type 由 type 规则报
    const expected = `支持的版本 ${spec.supported.join(' / ')}`;
    if (result === 'newer') {
      ctx.fail(spec.field, {
        expected,
        actual,
        message: `数据版本比校验器新（实际 ${describeValue(actual)}，支持到 ${spec.maxKnown}）：先更新 qa/lib/data-schema.mjs 的 SUPPORTED_VERSIONS，再运行校验`,
      });
    } else {
      ctx.fail(spec.field, {
        expected,
        actual,
        message: `不支持的数据版本 ${describeValue(actual)}（支持 ${spec.supported.join(' / ')}）：若是合法新版本，先更新 data-schema.mjs`,
      });
    }
  };
}

function countBy(list, iteratee) {
  const counts = {};
  for (const item of list) {
    const key = iteratee(item);
    if (key === undefined || key === null) continue;
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

function itemsCountsCheck(doc, ctx) {
  const items = Array.isArray(doc?.items) ? doc.items : [];
  const counts = doc?.meta?.counts || {};
  const failIf = (expected, actual, tokens, message) => {
    if (expected !== actual) ctx.fail(tokens, { expected: `count=${expected}`, actual, message });
  };
  failIf(items.length, counts.total, ['meta', 'counts', 'total'], `items 实际 ${items.length} 条，meta.counts.total=${counts.total}`);
  failIf(items.filter((item) => item?.is_item === true).length, counts.is_item, ['meta', 'counts', 'is_item'], 'is_item=true 的实际条数与 meta.counts.is_item 不一致');
  for (const field of ['kind', 'cat', 'slot']) {
    const actual = countBy(items, (item) => item?.[field]);
    const recorded = counts[field] && typeof counts[field] === 'object' ? counts[field] : {};
    for (const key of new Set([...Object.keys(actual), ...Object.keys(recorded)])) {
      if ((actual[key] || 0) !== (recorded[key] || 0)) {
        ctx.fail(['meta', 'counts', field, key], {
          expected: `count=${actual[key] || 0}`,
          actual: recorded[key] || 0,
          message: `meta.counts.${field}.${key}=${recorded[key] || 0}，实际 ${actual[key] || 0}`,
        });
      }
    }
  }
  const setKeys = new Set();
  const completeSetKeys = new Set();
  for (const item of items) {
    const set = item?.set;
    if (set && typeof set === 'object' && typeof set.key === 'string') {
      setKeys.add(set.key);
      if (set.complete === true) completeSetKeys.add(set.key);
    }
  }
  failIf(setKeys.size, counts.sets, ['meta', 'counts', 'sets'], `实际 ${setKeys.size} 个套装 key，meta.counts.sets=${counts.sets}`);
  failIf(completeSetKeys.size, counts.sets_complete, ['meta', 'counts', 'sets_complete'], `实际 ${completeSetKeys.size} 个完整套装 key，meta.counts.sets_complete=${counts.sets_complete}`);
}

function buildsCountsCheck(doc, ctx) {
  const counts = doc?.meta?.counts || {};
  const failIf = (expected, actual, tokens, message) => {
    if (expected !== actual) ctx.fail(tokens, { expected: `count=${expected}`, actual, message });
  };
  failIf(Array.isArray(doc?.builds) ? doc.builds.length : 0, counts.builds, ['meta', 'counts', 'builds'], 'builds.length 与 meta.counts.builds 不一致');
  failIf(Object.keys(doc?.items || {}).length, counts.items, ['meta', 'counts', 'items'], 'items 键数与 meta.counts.items 不一致');
  failIf(Object.keys(doc?.i18n || {}).length, counts.i18n, ['meta', 'counts', 'i18n'], 'i18n 键数与 meta.counts.i18n 不一致');
  failIf(Array.isArray(doc?.rules) ? doc.rules.length : 0, counts.rules, ['meta', 'counts', 'rules'], 'rules.length 与 meta.counts.rules 不一致');
  if (counts.armor_sets !== undefined) {
    failIf(Array.isArray(doc?.armor?.sets) ? doc.armor.sets.length : 0, counts.armor_sets, ['meta', 'counts', 'armor_sets'], 'armor.sets.length 与 meta.counts.armor_sets 不一致');
  }
}

/* ------------------------------- 跨文件检查 ------------------------------- */

const resolveBuildRef = (ref, idx) => idx.itemIds.has(ref) || idx.i18n.has(ref) || idx.archetypeZh.has(ref);
const resolveLoadoutRef = (ref, idx) => idx.itemIds.has(ref) || idx.i18n.has(ref);

function itemsCross(doc, ctx) {
  const items = Array.isArray(doc?.items) ? doc.items : [];
  items.forEach((item, index) => {
    if (!item || typeof item !== 'object') return;
    if (typeof item.cat === 'string' && item.cat !== 'action' && !ctx.idx.catIds.has(item.cat)) {
      ctx.fail(['items', index, 'cat'], { expected: 'terms.cats 中的分类 id（或内部分类 action）', actual: item.cat });
    }
    if (Array.isArray(item.filter_tags)) {
      item.filter_tags.forEach((tag, tagIndex) => {
        if (!ctx.idx.tagIds.has(tag)) {
          ctx.fail(['items', index, 'filter_tags', tagIndex], { expected: 'terms.gameTags 中的标签 id', actual: tag });
        }
      });
    }
    if (Array.isArray(item.effect?.lines)) {
      item.effect.lines.forEach((line, lineIndex) => {
        if (line && typeof line.category === 'string' && !ctx.idx.effectCatIds.has(line.category)) {
          ctx.fail(['items', index, 'effect', 'lines', lineIndex, 'category'], { expected: 'terms.effectCategories 中的分类键', actual: line.category });
        }
      });
    }
    if (Array.isArray(item.set?.parts)) {
      item.set.parts.forEach((part, partIndex) => {
        if (typeof part === 'string' && !ctx.idx.itemIds.has(part)) {
          ctx.fail(['items', index, 'set', 'parts', partIndex], { expected: 'items.json 中存在的道具 id', actual: part });
        }
      });
    }
  });
  const missingIcons = items
    .filter((item) => item && typeof item.icon_asset === 'string' && !ctx.idx.iconKeys.has(item.icon_asset))
    .map((item) => item.id);
  if (missingIcons.length) {
    ctx.warn(['items'], {
      expected: 'icon_asset 全部能在 data/icon_index.json 命中',
      actual: `${missingIcons.length} 条未命中`,
      message: `${missingIcons.length} 条道具的 icon_asset 在 icon_index.json 中不存在（前 5：${missingIcons.slice(0, 5).join(', ')}）——已知数据缺口，视图会回退占位图；不要为通过校验改数据`,
    });
  }
}

function itemEffectsCross(doc, ctx) {
  const entries = doc?.items && typeof doc.items === 'object' ? doc.items : {};
  for (const key of Object.keys(entries)) {
    if (!ctx.idx.itemIds.has(key)) {
      ctx.fail(['items', key], { expected: 'items.json 中存在的道具 id', actual: key });
    }
  }
  const counts = doc?.meta?.counts || {};
  const entryCount = Object.keys(entries).length;
  const sumCounts = (a, b, c) => [a, b, c].every((n) => typeof n === 'number') ? a + b + c : null;
  const wikiCount = typeof counts.wiki === 'number' ? counts.wiki : 0;
  const covered = sumCounts(counts.official, counts.manual, wikiCount);
  if (covered !== null && covered !== entryCount) {
    ctx.fail(['meta', 'counts'], {
      expected: `official+manual+wiki=${entryCount}`,
      actual: covered,
      message: `meta.counts.official+manual+wiki=${covered}，但 items 实际 ${entryCount} 条`,
    });
  }
  if (counts.none !== undefined && covered !== null && ctx.idx.itemTotal !== undefined) {
    const sum = counts.none + covered;
    if (sum !== ctx.idx.itemTotal) {
      ctx.fail(['meta', 'counts'], {
        expected: `none+official+manual+wiki=${ctx.idx.itemTotal}（items 中 is_item=true 的数量）`,
        actual: sum,
        message: `效果句覆盖统计之和 ${sum} 与 items.json 真道具数 ${ctx.idx.itemTotal} 不一致`,
      });
    }
  }
  /* wiki 回退条目的不变量：官方中文为空、英文非空、来源/wiki-only 自洽（不得把英文塞进 zh） */
  for (const [key, entry] of Object.entries(entries)) {
    if (!entry || typeof entry !== 'object' || entry.src !== 'wiki') continue;
    const zh = typeof entry.zh === 'string' ? entry.zh : '';
    const en = typeof entry.en === 'string' ? entry.en : '';
    if (zh.trim()) {
      ctx.fail(['items', key, 'zh'], { expected: 'wiki 回退条目 zh 应为空', actual: zh });
    }
    if (!en.trim()) {
      ctx.fail(['items', key, 'en'], { expected: 'wiki 回退条目必须有英文原文', actual: en });
    }
  }
}

function buildsCross(doc, ctx) {
  const builds = Array.isArray(doc?.builds) ? doc.builds : [];
  builds.forEach((build, index) => {
    if (!build || typeof build !== 'object') return;
    const slotKeys = build.slots && typeof build.slots === 'object' ? Object.keys(build.slots) : [];
    const slotOrder = Array.isArray(build.slot_order) ? build.slot_order : [];
    if (slotOrder.length !== slotKeys.length || slotOrder.some((key, i) => key !== slotKeys[i])) {
      ctx.fail(['builds', index, 'slot_order'], {
        expected: `与 slots 键顺序一致 ${JSON.stringify(slotKeys)}`,
        actual: slotOrder,
        message: 'slot_order 必须是 slots 键的展示顺序（详情页按它排版）',
      });
    }
    for (const [slot, refs] of Object.entries(build.slots || {})) {
      if (!Array.isArray(refs)) continue;
      refs.forEach((ref, refIndex) => {
        if (typeof ref === 'string' && !resolveBuildRef(ref, ctx.idx)) {
          ctx.fail(['builds', index, 'slots', slot, refIndex], { expected: 'items.json id，或在 builds.i18n / _source/builds.json i18n 登记', actual: ref });
        }
      });
    }
    (Array.isArray(build.armor_parts) ? build.armor_parts : []).forEach((ref, refIndex) => {
      if (typeof ref === 'string' && !resolveBuildRef(ref, ctx.idx)) {
        ctx.fail(['builds', index, 'armor_parts', refIndex], { expected: 'items.json id，或在 builds.i18n 登记', actual: ref });
      }
    });
    (Array.isArray(build.archetypes) ? build.archetypes : []).forEach((arch, archIndex) => {
      if (arch && typeof arch.name_en === 'string' && !resolveBuildRef(arch.name_en, ctx.idx)) {
        ctx.fail(['builds', index, 'archetypes', archIndex, 'name_en'], { expected: 'items.json id，或在 builds.i18n / builds.archetype_zh 登记', actual: arch.name_en });
      }
    });
    const weapons = build.loadout?.weapons && typeof build.loadout.weapons === 'object' ? build.loadout.weapons : {};
    for (const [slot, weapon] of Object.entries(weapons)) {
      if (!weapon || typeof weapon !== 'object') continue;
      for (const field of ['id', 'mutator', 'mod']) {
        const ref = weapon[field];
        if (typeof ref === 'string' && !resolveLoadoutRef(ref, ctx.idx)) {
          ctx.fail(['builds', index, 'loadout', 'weapons', slot, field], { expected: 'items.json id，或在 builds.i18n 登记', actual: ref });
        }
      }
    }
    if (build.eval && typeof build.eval.key === 'string' && typeof build.key === 'string' && build.eval.key !== build.key) {
      ctx.fail(['builds', index, 'eval', 'key'], { expected: `与 builds[${index}].key 相同（${build.key}）`, actual: build.eval.key });
    }
  });
  const buildsItems = doc?.items && typeof doc.items === 'object' ? doc.items : {};
  for (const [key, entry] of Object.entries(buildsItems)) {
    if (!resolveBuildRef(key, ctx.idx)) {
      ctx.fail(['items', key], { expected: 'items.json id，或在 builds.i18n / _source/builds.json i18n 登记的道具', actual: key });
    }
    if (entry && typeof entry.id === 'string' && entry.id !== key) {
      ctx.fail(['items', key, 'id'], { expected: `与键相同（${key}）`, actual: entry.id, message: 'items 摘要对象的 id 必须与它的键一致（视图按 id 索引）' });
    }
  }
  const unresolvedInherent = [];
  builds.forEach((build) => {
    const weapons = build?.loadout?.weapons && typeof build.loadout.weapons === 'object' ? build.loadout.weapons : {};
    for (const [slot, weapon] of Object.entries(weapons)) {
      const ref = weapon?.inherent_mod;
      if (typeof ref === 'string' && !ctx.idx.itemIds.has(ref) && !ctx.idx.i18n.has(ref)) {
        unresolvedInherent.push(`${build.key}/${slot}=${ref}`);
      }
    }
  });
  if (unresolvedInherent.length) {
    ctx.warn(['builds'], {
      expected: 'loadout.weapons.*.inherent_mod 均为可解析 id（或 i18n 登记）',
      actual: `${unresolvedInherent.length} 条为英文显示名`,
      message: `${unresolvedInherent.length} 条 inherent_mod 是游戏内固有改装的英文显示名（如 Beta Ray），不是本地 id（${unresolvedInherent.slice(0, 5).join('；')}）——mk_builds_json.py 同样按 warning 处理，详情页用 inherent_mod_item 兜底`,
    });
  }
}

function siteCountsCheck(doc, ctx) {
  const counts = doc?.meta?.counts || {};
  const failIf = (expected, actual, tokens, message) => {
    if (expected !== actual) ctx.fail(tokens, { expected: `count=${expected}`, actual, message });
  };
  failIf(Array.isArray(doc?.pieces) ? doc.pieces.length : 0, counts.pieces, ['meta', 'counts', 'pieces'], 'pieces.length 与 meta.counts.pieces 不一致');
  failIf(Array.isArray(doc?.presets) ? doc.presets.length : 0, counts.presets, ['meta', 'counts', 'presets'], 'presets.length 与 meta.counts.presets 不一致');
  failIf(Object.keys(doc?.substitutes || {}).length, counts.substitutes_cells, ['meta', 'counts', 'substitutes_cells'], 'substitutes 键数与 meta.counts.substitutes_cells 不一致');
  failIf(Array.isArray(doc?.prev_builds) ? doc.prev_builds.length : 0, counts.prev_builds, ['meta', 'counts', 'prev_builds'], 'prev_builds.length 与 meta.counts.prev_builds 不一致');
  const modifierCounts = counts.modifiers && typeof counts.modifiers === 'object' ? counts.modifiers : {};
  for (const [category, value] of Object.entries(modifierCounts)) {
    const actual = Array.isArray(doc?.modifiers?.[category]) ? doc.modifiers[category].length : 0;
    if (actual !== value) {
      ctx.fail(['meta', 'counts', 'modifiers', category], { expected: `count=${actual}`, actual: value, message: `modifiers.${category} 实际 ${actual} 条，meta.counts.modifiers.${category}=${value}` });
    }
  }
}

function siteCross(doc, ctx) {
  siteCountsCheck(doc, ctx);
  const pieces = Array.isArray(doc?.pieces) ? doc.pieces : [];
  const pieceIds = new Set(pieces.map((piece) => piece?.id).filter(Boolean));
  pieces.forEach((piece, index) => {
    if (piece && typeof piece.id === 'string' && !ctx.idx.itemIds.has(piece.id)) {
      ctx.fail(['pieces', index, 'id'], { expected: 'items.json 中存在的护甲道具 id', actual: piece.id });
    }
  });
  const checkPresetParts = (result, tokens) => {
    if (!result || typeof result !== 'object' || !Array.isArray(result.parts)) return;
    result.parts.forEach((part, partIndex) => {
      if (!Number.isInteger(part) || part < 0 || part >= pieces.length) {
        ctx.fail([...tokens, 'parts', partIndex], { expected: `0..${pieces.length - 1} 的 pieces 下标`, actual: part });
      }
    });
  };
  (Array.isArray(doc?.presets) ? doc.presets : []).forEach((preset, index) => {
    if (!preset || typeof preset !== 'object') return;
    if (typeof preset.p === 'string' && !ctx.idx.profileIds.has(preset.p)) {
      ctx.fail(['presets', index, 'p'], { expected: 'profiles[].id', actual: preset.p });
    }
    if (typeof preset.c === 'string' && !ctx.idx.presetClasses.has(preset.c)) {
      ctx.fail(['presets', index, 'c'], { expected: `档位 ∈ ${JSON.stringify([...PRESET_CLASSES])}`, actual: preset.c });
    }
    if (typeof preset.s === 'string' && !ctx.idx.scenarioIds.has(preset.s)) {
      ctx.fail(['presets', index, 's'], { expected: 'scenarios[].id', actual: preset.s });
    }
    checkPresetParts(preset.best, ['presets', index, 'best']);
    checkPresetParts(preset.ba, ['presets', index, 'ba']);
    (Array.isArray(preset.top) ? preset.top : []).forEach((result, topIndex) => checkPresetParts(result, ['presets', index, 'top', topIndex]));
  });
  const MODIFIER_CATEGORIES = { traits: 'trait', rings: 'ring', amulets: 'amulet', fragments: 'fragment', perks: 'perk', consumables: 'consumable' };
  for (const [category, entries] of Object.entries(doc?.modifiers || {})) {
    if (!Array.isArray(entries)) continue;
    const expectedCategory = MODIFIER_CATEGORIES[category] || category;
    entries.forEach((entry, index) => {
      if (!entry || typeof entry !== 'object') return;
      if (typeof entry.category === 'string' && entry.category !== expectedCategory) {
        ctx.fail(['modifiers', category, index, 'category'], { expected: expectedCategory, actual: entry.category });
      }
      if (typeof entry.id === 'string' && expectedCategory !== 'fragment' && !ctx.idx.itemIds.has(entry.id)) {
        ctx.fail(['modifiers', category, index, 'id'], { expected: 'items.json 中存在的道具 id（碎片 category 例外）', actual: entry.id });
      }
    });
  }
  const checkItemRef = (ref, tokens, what) => {
    if (typeof ref === 'string' && !ctx.idx.itemIds.has(ref)) {
      ctx.fail(tokens, { expected: `${what} 必须是 items.json 中存在的道具 id`, actual: ref });
    }
  };
  (Array.isArray(doc?.profiles) ? doc.profiles : []).forEach((profile, index) => {
    if (!profile || typeof profile !== 'object') return;
    for (const trait of Object.keys(profile.traits || {})) checkItemRef(trait, ['profiles', index, 'traits', trait], '特性');
    (profile.rings || []).forEach((ring, ringIndex) => checkItemRef(ring, ['profiles', index, 'rings', ringIndex], '戒指'));
    checkItemRef(profile.amulet, ['profiles', index, 'amulet'], '项链');
    (profile.perks || []).forEach((perk, perkIndex) => checkItemRef(perk, ['profiles', index, 'perks', perkIndex], '专长'));
    (profile.consumables || []).forEach((consumable, consumableIndex) => checkItemRef(consumable, ['profiles', index, 'consumables', consumableIndex], '消耗品'));
  });
  (Array.isArray(doc?.scenarios) ? doc.scenarios : []).forEach((scenario, index) => {
    if (!scenario || typeof scenario !== 'object') return;
    if (scenario.mode === 'maxmin') return;
    const weights = scenario.weights && typeof scenario.weights === 'object' ? scenario.weights : {};
    const values = Object.values(weights);
    if (!values.length) {
      ctx.fail(['scenarios', index, 'weights'], { expected: '非空权重表或 mode=maxmin', actual: weights });
      return;
    }
    const sum = values.reduce((acc, value) => acc + (typeof value === 'number' ? value : 0), 0);
    if (Math.abs(sum - 1) > 1e-6) {
      ctx.fail(['scenarios', index, 'weights'], { expected: '权重和 = 1（±1e-6）', actual: sum, message: `场景 ${scenario.id} 的权重和是 ${sum}，应为 1` });
    }
  });
  for (const [key, cell] of Object.entries(doc?.substitutes || {})) {
    for (const [slot, entry] of Object.entries(cell || {})) {
      if (!entry || typeof entry !== 'object') continue;
      checkItemRef(entry.cur, ['substitutes', key, slot, 'cur'], '当前护甲');
      (entry.alts || []).forEach((alt, altIndex) => {
        if (alt && typeof alt.id === 'string' && !pieceIds.has(alt.id)) {
          ctx.fail(['substitutes', key, slot, 'alts', altIndex, 'id'], { expected: 'pieces[].id', actual: alt.id });
        }
      });
      if (entry.fb) checkPresetParts(entry.fb, ['substitutes', key, slot, 'fb']);
    }
  }
  (Array.isArray(doc?.prev_builds) ? doc.prev_builds : []).forEach((build, index) => {
    for (const [slot, refs] of Object.entries(build?.slots || {})) {
      if (!Array.isArray(refs)) continue;
      refs.forEach((ref, refIndex) => {
        if (typeof ref === 'string' && !resolveBuildRef(ref, ctx.idx)) {
          ctx.fail(['prev_builds', index, 'slots', slot, refIndex], { expected: 'items.json id，或 builds.i18n 登记', actual: ref });
        }
      });
    }
  });
  for (const key of Object.keys(doc?.prev_items || {})) {
    if (!resolveBuildRef(key, ctx.idx)) {
      ctx.fail(['prev_items', key], { expected: 'items.json id，或在 builds.i18n 登记的道具', actual: key });
    }
  }
}

function archetypesCross(doc, ctx) {
  const archetypes = Array.isArray(doc?.archetypes) ? doc.archetypes : [];
  archetypes.forEach((archetype, index) => {
    if (!archetype || typeof archetype !== 'object') return;
    if (archetype.engram && typeof archetype.engram.id === 'string' && !ctx.idx.itemIds.has(archetype.engram.id)) {
      ctx.fail(['archetypes', index, 'engram', 'id'], { expected: 'items.json 中存在的解锁道具 id', actual: archetype.engram.id });
    }
    if (archetype.trait && typeof archetype.trait.id === 'string' && !ctx.idx.itemIds.has(archetype.trait.id)) {
      ctx.warn(['archetypes', index, 'trait', 'id'], {
        expected: 'items.json 中存在的特性 id',
        actual: archetype.trait.id,
        message: `职业 ${archetype.id} 的 trait.id=${archetype.trait.id} 不在 items.json（可能为未收录特性；先确认再决定是否收窄契约）`,
      });
    }
  });
  const archIds = new Set(archetypes.map((archetype) => archetype?.id).filter(Boolean));
  const termIds = new Set(Object.keys(ctx.docs?.terms?.archetypes || {}));
  for (const id of archIds) {
    if (!termIds.has(id)) {
      ctx.fail(['archetypes'], { expected: 'terms.archetypes 中登记的同名键', actual: id, message: `职业 ${id} 未在 terms.archetypes 登记官方译名` });
    }
  }
  for (const id of termIds) {
    if (!archIds.has(id)) {
      ctx.fail(['archetypes'], { expected: 'data/archetypes.json 中存在的职业 id', actual: id, message: `terms.archetypes 的 ${id} 在 archetypes.json 中不存在` });
    }
  }
}

function codexCross(doc, ctx) {
  const categories = Array.isArray(doc?.categories) ? doc.categories : [];
  const articles = Array.isArray(doc?.articles) ? doc.articles : [];
  const categoryIds = new Set(categories.map((category) => category?.id).filter(Boolean));
  const articleIds = new Set(articles.map((article) => article?.id).filter(Boolean));
  articles.forEach((article, index) => {
    if (!article || typeof article !== 'object') return;
    if (typeof article.cat === 'string' && !categoryIds.has(article.cat)) {
      ctx.fail(['articles', index, 'cat'], { expected: 'categories[].id', actual: article.cat });
    }
    (Array.isArray(article.related) ? article.related : []).forEach((related, relatedIndex) => {
      if (!articleIds.has(related)) {
        ctx.fail(['articles', index, 'related', relatedIndex], { expected: 'articles[].id', actual: related });
      }
    });
  });
  for (const [listName, list, label] of [['categories', categories, '分类'], ['articles', articles, '文章']]) {
    const orders = list.map((entry) => entry?.order).filter((order) => order !== undefined);
    if (new Set(orders).size !== orders.length) {
      ctx.fail([listName], { expected: `${label} order 唯一`, actual: orders, message: `${label} order 存在重复，目录排序不稳定` });
    }
  }
}

function iconIndexCross(doc, ctx) {
  const icons = doc?.icons && typeof doc.icons === 'object' ? doc.icons : {};
  const actual = Object.keys(icons).length;
  if (doc?.count !== actual) {
    ctx.fail(['count'], { expected: `icons 键数=${actual}`, actual: doc?.count, message: `icon_index.count=${doc?.count}，icons 实际 ${actual} 个` });
  }
  const failures = doc?.failures && typeof doc.failures === 'object' ? Object.keys(doc.failures) : [];
  if (failures.length) {
    ctx.warn(['failures'], {
      expected: '空对象（全部图标解码成功）',
      actual: `${failures.length} 条`,
      message: `${actual} 条图标索引中有 ${failures.length} 条解码失败/歧义（缺失或候选不唯一，前 3：${failures.slice(0, 3).join(', ')}）——已知数据缺口，视图按无图标处理`,
    });
  }
}

function acqCross(doc, ctx) {
  const entries = doc?.items && typeof doc.items === 'object' ? doc.items : {};
  const entryCount = Object.keys(entries).length;
  for (const [key, entry] of Object.entries(entries)) {
    if (!ctx.idx.itemIds.has(key) && !ctx.idx.i18n.has(key)) {
      ctx.fail(['items', key], {
        expected: 'items.json id，或在 builds.i18n / _source/builds.json i18n 登记的纯文本实体',
        actual: key,
      });
    }
    if (entry && Array.isArray(entry.tags)) {
      entry.tags.forEach((tag, tagIndex) => {
        if (!ctx.idx.acqTagIds.has(tag)) {
          ctx.fail(['items', key, 'tags', tagIndex], { expected: 'terms.acquisition[].id', actual: tag });
        }
      });
    }
  }
  const counts = doc?.counts || {};
  const failIf = (expected, actual, tokens, message) => {
    if (expected !== actual) ctx.fail(tokens, { expected: `count=${expected}`, actual, message });
  };
  failIf(entryCount, counts.total, ['counts', 'total'], 'items 键数与 counts.total 不一致');
  failIf(Object.values(entries).filter((entry) => entry && entry.text !== undefined && entry.text !== null).length, counts.with_text, ['counts', 'with_text'], 'with_text 计数与 items[*].text 非空数量不一致');
  failIf(Object.values(entries).filter((entry) => entry && Array.isArray(entry.tags) && entry.tags.length > 0).length, counts.with_tags, ['counts', 'with_tags'], 'with_tags 计数与 items[*].tags 非空数量不一致');
  failIf(Object.values(entries).filter((entry) => entry && typeof entry.dlc === 'number' && entry.dlc > 0).length, counts.with_dlc, ['counts', 'with_dlc'], 'with_dlc 计数与 items[*].dlc>0 的数量不一致');
}

function labGearCountsCheck(doc, ctx) {
  const counts = doc?.meta?.counts || {};
  const failIf = (expected, actual, tokens, message) => {
    if (expected !== actual) ctx.fail(tokens, { expected: `count=${expected}`, actual, message });
  };
  failIf(Array.isArray(doc?.dimensions) ? doc.dimensions.length : 0, counts.dimensions, ['meta', 'counts', 'dimensions'], 'dimensions.length 与 meta.counts.dimensions 不一致');
  failIf(Array.isArray(doc?.playstyles) ? doc.playstyles.length : 0, counts.playstyles, ['meta', 'counts', 'playstyles'], 'playstyles.length 与 meta.counts.playstyles 不一致');
  for (const kind of LAB_GEAR_KINDS) {
    const rows = Array.isArray(doc?.gear?.[kind]) ? doc.gear[kind] : [];
    failIf(rows.length, counts[kind], ['meta', 'counts', kind], `gear.${kind}.length 与 meta.counts.${kind} 不一致`);
  }
}

function labGearCross(doc, ctx) {
  labGearCountsCheck(doc, ctx);
  const dimensions = Array.isArray(doc?.dimensions) ? doc.dimensions : [];
  const dimIds = new Set(dimensions.map((dimension) => dimension?.id).filter(Boolean));
  const gear = doc?.gear && typeof doc.gear === 'object' ? doc.gear : {};
  const seen = new Map();
  for (const kind of LAB_GEAR_KINDS) {
    const rows = Array.isArray(gear[kind]) ? gear[kind] : [];
    rows.forEach((row, index) => {
      if (!row || typeof row !== 'object') return;
      if (typeof row.id === 'string' && row.id) {
        if (seen.has(row.id)) {
          ctx.fail(['gear', kind, index, 'id'], {
            expected: '全局唯一的道具 id（跨 kind 不重复）',
            actual: row.id,
            message: `id ${row.id} 与 ${seen.get(row.id)} 重复：实验室按 id 建单一索引`,
          });
        } else {
          seen.set(row.id, `gear.${kind}[${index}]`);
        }
        if (kind !== 'fragment' && !ctx.idx.itemIds.has(row.id)) {
          ctx.fail(['gear', kind, index, 'id'], {
            expected: 'items.json 中存在的道具 id（fragment 例外：碎片不是 items 条目）',
            actual: row.id,
          });
        }
      }
      if (row.dims && typeof row.dims === 'object' && !Array.isArray(row.dims)) {
        const keys = Object.keys(row.dims);
        for (const key of keys) {
          if (!dimIds.has(key)) {
            ctx.fail(['gear', kind, index, 'dims', key], {
              expected: 'dimensions[].id（15 维词表）',
              actual: key,
              message: `维度键 ${key} 不在 dimensions 表内：不能自创维度 id（契约 LAB_V2 §1.2）`,
            });
          }
        }
        if (keys.length && !(Array.isArray(row.evidence) && row.evidence.length > 0)) {
          ctx.fail(['gear', kind, index, 'evidence'], {
            expected: '非空 evidence（tag:/kw:/mod: 前缀，维度分必须可回溯）',
            actual: row.evidence,
            message: '有 dims 却没有 evidence：维度分必须能回溯到 tags 或效果关键词（契约 §1.1）',
          });
        }
      }
      // 键名转储清洗契约：derived-raw = 原文进 effectZhRaw、effectZh 置空（面板回退英文原文）
      if (row.effectSrc === 'derived-raw') {
        if (typeof row.effectZhRaw !== 'string' || row.effectZhRaw.length === 0) {
          ctx.fail(['gear', kind, index, 'effectZhRaw'], {
            expected: '非空 effectZhRaw（被清洗掉的原始派生句）',
            actual: row.effectZhRaw,
            message: 'effectSrc=derived-raw 时原文必须保留到 effectZhRaw，否则清洗后的句子无法追溯',
          });
        }
        if (row.effectZh !== undefined && row.effectZh !== null) {
          ctx.fail(['gear', kind, index, 'effectZh'], {
            expected: '缺省（由 effectEn 回退展示）',
            actual: row.effectZh,
            message: 'effectSrc=derived-raw 时不得再提供 effectZh（内部键名转储会直接显示成乱码）',
          });
        }
      }
    });
  }
  const playstyles = Array.isArray(doc?.playstyles) ? doc.playstyles : [];
  playstyles.forEach((playstyle, index) => {
    if (!playstyle || typeof playstyle !== 'object') return;
    const dims = playstyle.dims && typeof playstyle.dims === 'object' ? playstyle.dims : {};
    for (const key of Object.keys(dims)) {
      if (!dimIds.has(key)) {
        ctx.fail(['playstyles', index, 'dims', key], { expected: 'dimensions[].id', actual: key });
      }
    }
  });
}

/** 每文件对应的跨文件检查（规则校验之后执行） */
const FILE_CHECKS = {
  items: [itemsCross],
  builds: [buildsCross],
  siteData: [siteCross],
  archetypes: [archetypesCross],
  codex: [codexCross],
  itemEffects: [itemEffectsCross],
  iconIndex: [iconIndexCross],
  acq: [acqCross],
  labGear: [labGearCross],
};

/** 文件规则表 */
const RULES = {
  items: itemsRootRule,
  builds: buildsRootRule,
  siteData: siteRootRule,
  archetypes: archetypesRootRule,
  codex: codexRootRule,
  terms: termsRootRule,
  itemEffects: itemEffectsRootRule,
  iconIndex: iconIndexRootRule,
  acq: acqRootRule,
  labGear: labGearRootRule,
};

const ROOT_CHECKS = {
  items: [versionCheck('items'), itemsCountsCheck],
  builds: [versionCheck('builds'), buildsCountsCheck],
  siteData: [versionCheck('siteData')],
  archetypes: [versionCheck('archetypes')],
  codex: [versionCheck('codex')],
  terms: [versionCheck('terms')],
  iconIndex: [versionCheck('iconIndex')],
  acq: [versionCheck('acq')],
  labGear: [versionCheck('labGear')],
};

/* --------------------------------- 索引 ---------------------------------- */

export function buildIndexes(docs) {
  const items = Array.isArray(docs?.items?.items) ? docs.items.items : [];
  const itemIds = new Set(items.map((item) => item?.id).filter((id) => typeof id === 'string' && id));
  const builds = docs?.builds && typeof docs.builds === 'object' ? docs.builds : {};
  const sourceBuilds = docs?.sourceBuilds && typeof docs.sourceBuilds === 'object' ? docs.sourceBuilds : {};
  const i18n = new Set([
    ...Object.keys(builds.i18n && typeof builds.i18n === 'object' ? builds.i18n : {}),
    ...Object.keys(sourceBuilds.i18n && typeof sourceBuilds.i18n === 'object' ? sourceBuilds.i18n : {}),
  ]);
  const archetypeZh = new Set(Object.keys(builds.archetype_zh && typeof builds.archetype_zh === 'object' ? builds.archetype_zh : {}));
  const terms = docs?.terms && typeof docs.terms === 'object' ? docs.terms : {};
  const site = docs?.siteData && typeof docs.siteData === 'object' ? docs.siteData : {};
  const codex = docs?.codex && typeof docs.codex === 'object' ? docs.codex : {};
  const iconIndex = docs?.iconIndex && typeof docs.iconIndex === 'object' ? docs.iconIndex : {};
  return {
    itemIds,
    itemTotal: items.filter((item) => item?.is_item === true).length,
    i18n,
    archetypeZh,
    iconKeys: new Set(Object.keys(iconIndex.icons && typeof iconIndex.icons === 'object' ? iconIndex.icons : {})),
    tagIds: new Set((terms.gameTags || []).map((tag) => tag?.id).filter(Boolean)),
    catIds: new Set((terms.cats || []).map((cat) => cat?.id).filter(Boolean)),
    effectCatIds: new Set(Object.keys(terms.effectCategories || {})),
    acqTagIds: new Set((terms.acquisition || []).map((tag) => tag?.id).filter(Boolean)),
    dlcIds: new Set((terms.dlc || []).map((dlc) => dlc?.id).filter(Boolean)),
    categoryIds: new Set((codex.categories || []).map((category) => category?.id).filter(Boolean)),
    articleIds: new Set((codex.articles || []).map((article) => article?.id).filter(Boolean)),
    pieceIds: new Set((site.pieces || []).map((piece) => piece?.id).filter(Boolean)),
    profileIds: new Set((site.profiles || []).map((profile) => profile?.id).filter(Boolean)),
    scenarioIds: new Set((site.scenarios || []).map((scenario) => scenario?.id).filter(Boolean)),
    presetClasses: new Set(Array.isArray(site.meta?.formula?.class_order) ? [...site.meta.formula.class_order, 'free'] : [...PRESET_CLASSES]),
  };
}

/**
 * 校验整份数据快照。
 * @param {object} [docs] loadData() 的结果（可浅拷贝覆盖个别文件做负向夹具）
 * @param {{files?: string[]}} [options]
 * @returns {{errors: object[], warnings: object[], files: string[]}}
 */
export function validateAll(docs = loadData(), options = {}) {
  const errors = [];
  const warnings = [];
  const idx = buildIndexes(docs);
  const fileKeys = options.files || Object.keys(DATA_FILES);
  for (const key of fileKeys) {
    const file = DATA_FILES[key];
    const result = validate(docs[key], RULES[key], { file });
    errors.push(...result.errors);
    warnings.push(...result.warnings);
    const ctx = createCollector(file, errors, warnings);
    ctx.docs = docs;
    ctx.idx = idx;
    for (const check of ROOT_CHECKS[key] || []) check(docs[key], ctx);
    for (const check of FILE_CHECKS[key] || []) check(docs[key], ctx);
  }
  return { errors, warnings, files: fileKeys.map((key) => DATA_FILES[key]) };
}

/** 打印前 limit 条诊断（测试失败时用） */
export function formatDiagnostics(diagnostics, limit = 20) {
  return diagnostics.slice(0, limit).map((diag) => formatDiagnostic(diag)).join('\n');
}

export { formatDiagnostic };
