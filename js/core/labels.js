/* =============================================================================
   遗迹2 · 遗物档案 — labels.js
   部位族 / 分类 / 可信度 / DLC / 获取难度的中文名与图标映射（与 data/terms.json 对齐）。
   ========================================================================== */

export const FAMILY = {
  longGun: { zh: '长枪', icon: 'longgun', accept: ['longGun'] },
  handGun: { zh: '手枪', icon: 'handgun', accept: ['handGun'] },
  melee: { zh: '近战武器', icon: 'sword', accept: ['melee'] },
  head: { zh: '头盔', icon: 'helmet', accept: ['head'] },
  body: { zh: '胸甲', icon: 'chest', accept: ['body'] },
  legs: { zh: '腿甲', icon: 'legs', accept: ['legs'] },
  gloves: { zh: '手甲', icon: 'gloves', accept: ['gloves'] },
  amulet: { zh: '项链', icon: 'amulet', accept: ['amulet'] },
  ring: { zh: '戒指', icon: 'ring', accept: ['ring'] },
  relic: { zh: '圣物', icon: 'relic', accept: ['relic'] },
  mod: { zh: '武器改装', icon: 'mod', accept: ['mod'] },
  trait: { zh: '特性', icon: 'trait', accept: ['trait'] },
  perk: { zh: '职业专长', icon: 'perk', accept: ['perk'] },
  skill: { zh: '技能', icon: 'skill', accept: ['skill'] },
  consumable: { zh: '消耗品', icon: 'consumable', accept: ['consumable'] },
  gem: { zh: '宝石', icon: 'gem', accept: ['gem'] },
  metagem: { zh: '棱镜宝石', icon: 'metagem', accept: ['metagem'] },
  archetype: { zh: '职业解锁', icon: 'engram', accept: ['archetype'] },
  material: { zh: '制作材料', icon: 'material', accept: ['material'] },
  other: { zh: '其它', icon: 'all', accept: [] },
  action: { zh: '动作/内部', icon: 'all', accept: [] },
};

/** 分类 chip（资料库顶部），与 data/terms.json cats 一致 */
export const CATS = [
  { id: 'all', zh: '全部', icon: 'all' },
  { id: 'weapon', zh: '武器', icon: 'sword' },
  { id: 'armor', zh: '护甲', icon: 'armor' },
  { id: 'ring', zh: '戒指', icon: 'ring' },
  { id: 'amulet', zh: '项链', icon: 'amulet' },
  { id: 'mod', zh: '武器改装', icon: 'mod' },
  { id: 'skill', zh: '技能', icon: 'skill' },
  { id: 'perk', zh: '职业专长', icon: 'perk' },
  { id: 'trait', zh: '特性', icon: 'trait' },
  { id: 'relic', zh: '圣物', icon: 'relic' },
  { id: 'consumable', zh: '消耗品', icon: 'consumable' },
  { id: 'gem', zh: '宝石', icon: 'gem' },
  { id: 'metagem', zh: '棱镜宝石', icon: 'metagem' },
  { id: 'engram', zh: '职业解锁', icon: 'engram' },
  { id: 'material', zh: '制作材料', icon: 'material' },
];
export const CAT_BY_ID = new Map(CATS.map((c) => [c.id, c]));

/** 槽位 → 可接受 family 列表（选择器用） */
export const SLOT_ACCEPT = {
  longGun: ['longGun'], handGun: ['handGun'], melee: ['melee'],
  head: ['head'], body: ['body'], legs: ['legs'], gloves: ['gloves'],
  amulet: ['amulet'], ring1: ['ring'], ring2: ['ring'], ring3: ['ring'], ring4: ['ring'],
  relic: ['relic'], archetype1: ['archetype'], archetype2: ['archetype'],
  modLongGun: ['mod'], modHandGun: ['mod'], trait: ['trait'],
};
export const SLOT_ZH = {
  longGun: '长枪', handGun: '手枪', melee: '近战武器',
  head: '头盔', body: '胸甲', legs: '腿甲', gloves: '手甲',
  amulet: '项链', ring1: '戒指 1', ring2: '戒指 2', ring3: '戒指 3', ring4: '戒指 4',
  relic: '圣物', archetype1: '主职业', archetype2: '副职业',
};

/** 该 family 的物件可以装进哪些槽位 */
export function slotsForFamily(family) {
  const out = [];
  for (const [slot, accepts] of Object.entries(SLOT_ACCEPT)) if (accepts.includes(family)) out.push(slot);
  return out;
}

export const CONF = {
  high: { zh: '高可信', cls: 'high' },
  medium: { zh: '中可信', cls: 'mid' },
  low: { zh: '待验证', cls: 'low' },
};

export const DLC_ZH = { 0: '本体', 1: '真皇的苏醒', 2: '失落的王国', 3: '暗黑地平线' };

export const ACQ = {
  shop: { zh: '商店', icon: 'shop', cls: 'easy' },
  pickup: { zh: '固定拾取', icon: 'pickup', cls: 'easy' },
  craft: { zh: '制作', icon: 'craft', cls: 'craft' },
  boss: { zh: '头目掉落', icon: 'boss', cls: 'boss' },
  puzzle: { zh: '解谜', icon: 'puzzle', cls: 'boss' },
  rng: { zh: '随机', icon: 'rng', cls: 'rng' },
  unknown: { zh: '未收录', icon: 'question', cls: 'neutral' },
};

export const RES_ZH = {
  bleed: '流血抗性', fire: '火焰抗性', shock: '电击抗性', corrosive: '腐蚀抗性', blight: '枯萎抗性',
};
export const RES_ICON = { bleed: 'bleed', fire: 'fire', shock: 'shock', corrosive: 'corrode', blight: 'blight' };
export const RES_COLOR = {
  bleed: 'var(--dmg-bleed)', fire: 'var(--dmg-fire)', shock: 'var(--dmg-shock)',
  corrosive: 'var(--dmg-corrode)', blight: 'var(--dmg-blight)',
};

/** 效果行分类 → 展示顺序 */
export const EFFECT_ORDER = ['offense', 'defense', 'utility', 'status', 'other'];

/* ---------------------------------------------------------------------------
   数据表数值键 → 中文（资料库/详情/实验室共用）。
   只收「玩法有意义」的键；其余键只出现在折叠的原始数值表里。
   unit: '' 无单位；'%' 百分比；'s' 秒；'pt' 点数
   --------------------------------------------------------------------------- */
export const NUM_ZH = {
  /* 伤害 */
  Damage: ['伤害', 'pt'], DamageMod: ['伤害', '%'], DamageBuff: ['伤害', '%'],
  RangedDamageMod: ['远程伤害', '%'], MeleeDamageMod: ['近战伤害', '%'],
  SkillDamageBuff: ['技能伤害', '%'], ElementalDamageBuff: ['元素伤害', '%'],
  FireDamage: ['火焰伤害', 'pt'], BleedDamage: ['流血伤害', 'pt'], ShockDamage: ['电击伤害', 'pt'],
  CorrosiveDamage: ['腐蚀伤害', 'pt'], BlightDamage: ['枯萎伤害', 'pt'],
  StatusEffectDamageMod: ['状态效果伤害', '%'], WeakSpotDamageMod: ['弱点伤害', '%'],
  WeakspotMod: ['弱点伤害', '%'], RangedWeakspotDamageMod: ['远程弱点伤害', '%'],
  CritChance: ['暴击率', '%'], CritChanceMod: ['暴击率', '%'], CritDamage: ['暴击伤害', '%'],
  ImpactScalar: ['冲击系数', ''], ImpactDamage: ['冲击伤害', 'pt'],
  BlastDamage: ['爆炸伤害', 'pt'], BlastRadius: ['爆炸半径', ''], Radius: ['半径', ''],
  /* 防御 */
  Armor: ['护甲值', 'pt'], ArmorMod: ['护甲效果', '%'], Encumbrance: ['负重', 'pt'],
  EncumbranceMod: ['负重', '%'], DamageReductionMod: ['伤害减免', '%'],
  DamageReductionBuff: ['伤害减免', '%'], Bulwark: ['壁垒', '层'],
  HealthMax: ['生命上限', 'pt'], HealthRegen: ['生命回复', 'pt'], HealthThreshold: ['生命阈值', '%'],
  HealthMaxBonus: ['生命最大加成', '%'], HealthPercent: ['生命加成', '%'], MaxHealth: ['生命上限', 'pt'],
  HealAmount: ['治疗量', 'pt'], HealthStealMod: ['生命偷取', '%'], LifestealPassiveBuff: ['生命偷取', '%'],
  ShieldAmount: ['护盾值', '%'], ShieldDuration: ['护盾持续', 's'], MaxSummons: ['召唤上限', '个'],
  BulwarkDuration: ['壁垒持续', 's'], RangedDamageReductionMod: ['远程伤害减免', '%'],
  StaminaDeltaMod: ['体力消耗', 'pt'], MoveSpeedMod: ['移动速度', '%'], HealDuration: ['治疗持续', 's'],
  RelicUseSpeedMod: ['圣物使用速度', '%'], SkillCooldownMod: ['技能冷却', '%'],
  GreyHealthRateMod: ['灰血转化率', '%'], Lifesteal: ['吸血', '%'], Healing: ['治疗', 'pt'],
  HealingMod: ['治疗效率', '%'], Value: ['价值', 'pt'],
  /* 抗性（与官方 locres 一致：酸性=腐蚀） */
  AcidResistance: ['腐蚀抗性', 'pt'], BleedResistance: ['流血抗性', 'pt'],
  FireResistance: ['火焰抗性', 'pt'], ShockResistance: ['电击抗性', 'pt'],
  BlightResistance: ['枯萎抗性', 'pt'], AllResistance: ['全抗性', 'pt'],
  /* 时间 / 资源 */
  Duration: ['持续时间', 's'], BuffDuration: ['增益持续', 's'], AuraDuration: ['光环持续', 's'],
  ModDuration: ['改装持续', 's'], BleedDuration: ['流血持续', 's'], FireDuration: ['燃烧持续', 's'],
  BurningDuration: ['灼烧持续', 's'], AcidDuration: ['腐蚀持续', 's'], ShockDuration: ['电击持续', 's'],
  CooldownTime: ['冷却时间', 's'], CooldownDuration: ['冷却时长', 's'], ChargeTime: ['蓄力时间', 's'],
  MaxCharges: ['充能次数', 'pt'], MaxLevel: ['等级上限', '级'],
  AmmoPerClip: ['弹匣容量', 'pt'], MaxAmmo: ['弹药上限', 'pt'], AmmoPerReload: ['每次装填弹药', 'pt'],
  ReloadSpeed: ['装填速度', '×'], ReloadSpeedMod: ['装填速度', '%'], ReloadTime: ['装填时间', 's'],
  RateOfFire: ['射速', '发/秒'], AttackSpeed: ['攻击速度', '%'],
  Range: ['射程', ''], MaxRange: ['最大射程', ''], Spread: ['散布', ''],
  PrimaryFalloff: ['主要衰减', ''], SecondaryFalloff: ['次要衰减', ''],
  BurstCount: ['点射发数', '发'], SprayCount: ['散射弹数', '发'], ProcChance: ['触发几率', '%'],
  MoveSpeed: ['移动速度', '%'], TotalMoveSpeedScalar: ['移动速度', '%'], EvadeSpeedMod: ['闪避速度', '%'],
  EvadeWindow: ['闪避窗口', ''], Stamina: ['体力', 'pt'], StaminaCost: ['体力消耗', '%'],
  WeaponPowerBuildUpMod: ['改装能量获取', '%'], ModPowerMod: ['改装能量获取', '%'],
  StatusEffectDurationScalar: ['状态效果持续', '%'],
};

/** 该键是否值得在主列表展示 */
export function numLabel(key) { return NUM_ZH[key] || null; }

/** 格式化一个数据表数值 */
export function fmtNumber(key, v) {
  const meta = NUM_ZH[key];
  let n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return String(v);
  // 数据表里百分比常见 0.25 / 10 两种量纲：<1 的百分比按 ×100 展示
  if (meta && meta[1] === '%' && n !== 0 && Math.abs(n) < 1) n *= 100;
  const has = Math.abs(n - Math.round(n)) > 1e-9;
  const s = has ? n.toFixed(2).replace(/\.?0+$/, '') : String(Math.round(n));
  if (!meta) return s;
  const [, unit] = meta;
  if (unit === '%') return `${s}%`;
  if (unit === '×') return `×${s}`;
  if (unit === 's') return `${s} 秒`;
  if (unit === 'pt' || unit === '') return s;
  return `${s} ${unit}`;
}

/** 详情页「效果」主列表只展示这些键（其余只在原始数值表里） */
export const PRIMARY_KEYS = new Set([
  'DamageMod', 'DamageBuff', 'RangedDamageMod', 'MeleeDamageMod', 'SkillDamageBuff',
  'ElementalDamageBuff', 'FireDamage', 'BleedDamage', 'ShockDamage', 'CorrosiveDamage',
  'BlightDamage', 'StatusEffectDamageMod', 'WeakSpotDamageMod', 'WeakspotMod',
  'RangedWeakspotDamageMod', 'WeakspotHitCritChanceMod', 'CritChance', 'CritChanceMod', 'CritDamage', 'WeakSpotDamageMod',
  'ArmorMod', 'EncumbranceMod', 'DamageReductionMod', 'DamageReductionBuff', 'Bulwark',
  'HealthMax', 'HealthRegen', 'HealthThreshold', 'ShieldAmount', 'ShieldDuration',
  'HealthMaxBonus', 'HealthPercent', 'MaxHealth', 'HealAmount', 'HealthStealMod', 'LifestealPassiveBuff',
  'RangedDamageReductionMod', 'StaminaDeltaMod', 'MoveSpeedMod', 'HealDuration',
  'RelicUseSpeedMod', 'SkillCooldownMod', 'MaxSummons', 'BulwarkDuration',
  'GreyHealthRateMod', 'Lifesteal', 'Healing', 'HealingMod', 'MoveSpeed',
  'TotalMoveSpeedScalar', 'EvadeSpeedMod', 'EvadeWindow', 'Stamina', 'StaminaCost',
  'Duration', 'BuffDuration', 'AuraDuration', 'ModDuration', 'CooldownTime', 'CooldownDuration',
  'MaxCharges', 'ReloadSpeed', 'ReloadSpeedMod', 'MaxAmmo', 'AmmoPerClip', 'AmmoPerReload',
  'RateOfFire', 'AttackSpeed', 'StatusEffectDurationScalar', 'WeaponPowerBuildUpMod',
  'ModPowerMod', 'AcidResistance', 'BleedResistance', 'FireResistance', 'ShockResistance',
  'BlightResistance', 'AllResistance',
]);

/** 少数键需要一句语义说明（鼠标悬浮显示） */
export const NUM_NOTE = {
  HealthThreshold: '生命低于该比例时触发',
  ShieldAmount: '按最大生命的比例计算护盾',
  CritChance: '暴击率',
  ArmorMod: '加在护甲值上的乘区（护甲效果）',
  EncumbranceMod: '改变负重的百分比',
  Bulwark: '壁垒层数（按表折算减伤）',
  GreyHealthRateMod: '受伤后转为灰血的比例',
};

/* ---------------------------------------------------------------------------
   机器生成的效果摘要里残留的英文碎片 → 中文（只做常见词，保持原意）
   --------------------------------------------------------------------------- */
export const FRAG_ZH = {
  Haste: '急速', Hit: '命中', Burrow: '钻孔', Stack: '层', Stacks: '层', Buff: '增益',
  Charge: '蓄力', Cast: '施放', Potency: '效力', Mod: '改装', Skill: '技能',
  Weapon: '武器', Damage: '伤害', Chance: '几率', Speed: '速度', Duration: '持续',
  Max: '最大', Min: '最小', Value: '数值', Health: '生命', Stamina: '体力',
  Shield: '护盾', Armor: '护甲', Critical: '暴击', Weakspot: '弱点', Ranged: '远程',
  Melee: '近战', Fire: '火焰', Shock: '电击', Bleed: '流血', Corrosive: '腐蚀',
  Blight: '枯萎', Status: '状态', Effect: '效果', Time: '时间', Range: '距离',
  Radius: '半径', Per: '每', Level: '等级', Total: '总', Bonus: '加成',
  Reduction: '减免', Resistance: '抗性', Cooldown: '冷却', Reload: '装填',
  Ammo: '弹药', Magazine: '弹匣', Shot: '射击', Target: '目标', Enemy: '敌人',
  Ally: '队友', Kill: '击杀', Perfect: '完美', Dodge: '闪避', Evade: '闪避',
};

/** 把「Haste持续时间 10 秒」这类机器摘要清理成可读中文；清不掉的段丢弃 */
const TERM_FIX = {
  '强酸抗性': '腐蚀抗性',
  '强酸伤害': '腐蚀伤害',
  '暴击几率': '暴击率',
  '元宝石': '棱镜宝石',
  '远程武器改装': '武器改装',
};

export function cleanSummary(text) {
  if (!text) return '';
  return String(text)
    .split(/[；;]/)
    .map((seg) => {
      let out = seg;
      for (const [en, zh] of Object.entries(FRAG_ZH)) {
        out = out.replace(new RegExp(`\b${en}\b`, 'g'), zh).replace(new RegExp(en, 'g'), zh);
      }
      out = out.trim();
      for (const [from, to] of Object.entries(TERM_FIX)) out = out.split(from).join(to);
      return out;
    })
    .filter((seg) => seg && !/[A-Za-z]{2,}/.test(seg))
    .join('；');
}

/** 详情「属性」区实际展示的数值键（效果区不再重复） */
export function attrKeysShown(item) {
  const set = new Set();
  const fam = item.family;
  if (['head', 'body', 'legs', 'gloves'].includes(fam)) {
    set.add('Armor'); set.add('Encumbrance'); set.add('Value');
    for (const k of ['AcidResistance', 'BleedResistance', 'FireResistance', 'ShockResistance', 'BlightResistance']) set.add(k);
  } else if (['longGun', 'handGun', 'melee'].includes(fam)) {
    set.add('Damage'); set.add('RateOfFire'); set.add('AttackSpeed'); set.add('CritChance');
    set.add('WeakSpotDamageMod'); set.add('ImpactScalar'); set.add('MeleeStaggerMod');
    set.add('Range'); set.add('AmmoPerClip'); set.add('MaxAmmo'); set.add('Value');
  } else if (item.stack != null || item.value != null) {
    set.add('Value');
  }
  return set;
}

/* ---------------------------------------------------------------------------
   游戏内 FilterTags（items.json 的 filter_tags，23 个）→ 中文 / 分组 / 图标 / 释义
   这是资料库侧栏「效果标签」与选择器标签筛选的唯一来源；禁止在视图里另写译名。
   分组只用于排版：defense=防御与生存，offense=输出与战斗，utility=功能与特殊。
   --------------------------------------------------------------------------- */
export const TAG_GROUP_ZH = { defense: '防御与生存', offense: '输出与战斗', utility: '功能与特殊' };

const TAG_DEFS = [
  /* 防御与生存 */
  ['Defense', '伤害减免', 'defense', 'shield', '影响减伤、护甲、抗性的词条'],
  ['Health', '生命值', 'defense', 'health', '生命上限、生命回复相关'],
  ['Shield', '护盾', 'defense', 'shield', '提供或强化护盾'],
  ['GreyHealth', '灰色生命', 'defense', 'health', '灰色生命缓冲与转化（社区常称灰血）'],
  ['Lifesteal', '吸血', 'defense', 'health', '造成伤害时回复生命'],
  ['Stamina', '体力', 'defense', 'stamina', '体力上限、消耗与回复'],
  ['Evade', '闪避', 'defense', 'dodge', '闪避窗口、距离与速度'],
  ['MoveSpeed', '移动速度', 'defense', 'movespeed', '移动速度与冲刺'],
  /* 输出与战斗 */
  ['Damage', '伤害加成', 'offense', 'damage', '直接提升伤害的词条'],
  ['CritChance', '暴击率', 'offense', 'crit', '提升暴击几率'],
  ['CritDamage', '暴击伤害', 'offense', 'crit', '提升暴击伤害'],
  ['Weakspot', '弱点伤害', 'offense', 'weakspot', '提升弱点伤害'],
  ['FireRate', '射速', 'offense', 'firerate', '射速与攻击速度'],
  ['Ranged', '远程', 'offense', 'longgun', '远程武器相关'],
  ['Melee', '近战', 'offense', 'sword', '近战武器相关'],
  ['Elemental', '元素伤害', 'offense', 'fire', '火焰 / 电击 / 腐蚀元素'],
  ['Status', '状态效果', 'offense', 'sparkle', '流血、燃烧、电击等持续伤害'],
  ['AOE', '范围伤害', 'offense', 'target', '爆炸与范围效果'],
  ['Summon', '召唤物', 'offense', 'archetype', '召唤物与同伴'],
  ['Mod', '武器改装', 'offense', 'mod', '改装能量与改装效果'],
  ['Skill', '技能', 'offense', 'skill', '职业技能相关'],
  /* 功能与特殊 */
  ['Relic', '圣物', 'utility', 'relic', '圣物与圣物充能（社区旧称遗物）'],
  ['Special', '特殊效果', 'utility', 'sparkle', '特殊机制或触发型词条'],
];

export const GAME_TAGS = TAG_DEFS.map(([id, zh, group, icon, desc]) => ({ id, zh, group, icon, desc }));
export const GAME_TAG_BY_ID = new Map(GAME_TAGS.map((t) => [t.id, t]));
export const GAME_TAGS_BY_GROUP = ['defense', 'offense', 'utility'].map((g) => ({
  id: g, zh: TAG_GROUP_ZH[g], tags: GAME_TAGS.filter((t) => t.group === g),
}));

/** 效果行分类（items.json effect.lines[].category）→ 中文 */
export const EFFECT_CAT_ZH = {
  damage: '伤害', defense: '防御', offense: '输出', utility: '功能',
  resource: '资源', status: '状态效果', other: '其它',
};

