/* =============================================================================
   qa/tests/lab-score.test.mjs — 实验室 v2 纯计算模块（score / combos / fit）确定性单测

   全部 fixture 在内存构造，不读 data/ 真实文件；纯 node:test，不启浏览器、不写仓库。
   覆盖（LAB_V2 §2 / §6）：
     · 空数据 / 缺字段不崩，安全空值
     · itemScore 公式（Σ dims·w / Σ w）、脏 dims 防御、3 位小数
     · loadoutScore：avg / coverage（权重≥0.6） / 0.7·avg+0.3·coverage
     · 组合搜索：固定件占位、戒指不可重复、缺件（excludeIds）过滤、池上限 24/12、
       枚举量 12×C(24,4)、固定件非法 → error 字符串、确定性排序
     · recommendRemaining 边际增益、recommendSwap 同槽替换
     · fit：weapon 类型过滤、武器标签契合加成（+0.05/维，上限 +0.15）、
       近战改装空 + note、碎片/特性排序与颜色统计
     · 零依赖守卫：三个模块无 import、不触 DOM / 存储 / 网络
   运行：node --test qa/tests/lab-score.test.mjs
   ========================================================================== */
import test from 'node:test';
import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';

import { createScorer, COVERAGE_WEIGHT, SCORE_DIGITS } from '../../js/lab/score.js';
import { createComboSearch } from '../../js/lab/combos.js';
import { createFit } from '../../js/lab/fit.js';

/* ------------------------------- 最小 fixture ------------------------------- */

const DIMENSIONS = [
  { id: 'dmg', zh: '通用伤害', order: 1 },
  { id: 'ranged', zh: '远程', order: 2 },
  { id: 'crit', zh: '暴击/弱点', order: 3 },
  { id: 'status', zh: '状态/元素', order: 4 },
  { id: 'mod', zh: '改装', order: 5 },
  { id: 'armor', zh: '护甲/减伤', order: 6 },
  { id: 'health', zh: '生命/护盾', order: 7 },
  { id: 'heal', zh: '治疗/吸血/圣物', order: 8 },
  { id: 'utility', zh: '资源/功能', order: 9 },
  { id: 'melee', zh: '近战', order: 10 },
];

const PLAYSTYLES = [
  { id: 'general', zh: '通用', dims: { dmg: 0.5, armor: 0.4, health: 0.4, utility: 0.2 }, order: 1 },
  { id: 'ranged_crit', zh: '远程暴击', dims: { dmg: 0.6, ranged: 0.8, crit: 0.9, utility: 0.2 }, order: 2 },
  { id: 'tank', zh: '生存坦克', dims: { armor: 0.9, health: 0.8, heal: 0.5 }, order: 3 },
];

const item = (id, zh, dims, extra = {}) => ({ id, zh, ...(dims ? { dims } : {}), ...extra });

const RINGS = [
  item('Ring_Crit', '暴击之戒', { crit: 1, ranged: 1 }),
  item('Ring_Dmg', '伤害之戒', { dmg: 1 }),
  item('Ring_Armor', '护甲之戒', { armor: 1 }),
  item('Ring_Health', '生命之戒', { armor: 1 }),
  item('Ring_Blank', '空戒', null),
  item('Ring_Zero', '零分戒', { crit: 0, ranged: 0 }),
];

const AMULETS = [
  item('Amu_Crit', '暴击项链', { crit: 1 }),
  item('Amu_Dmg', '伤害项链', { dmg: 1 }),
  item('Amu_Tank', '坦克项链', { armor: 1, health: 1 }),
];

const MUTATORS = [
  item('Mut_AnyDmg', '通用伤害', { dmg: 1 }, { weapon: 'any' }),
  item('Mut_RangedCrit', '远程暴击', { crit: 1 }, { weapon: 'ranged' }),
  item('Mut_Melee', '近战突变', { melee: 1 }, { weapon: 'melee' }),
  item('Mut_NoType', '无类型突变', { ranged: 1 }),
];

const MODS = [
  item('Mod_ModDmg', '改装伤害', { mod: 1 }, { tags: [] }),
  item('Mod_Crit', '暴击改装', { crit: 1 }, { tags: ['Mod'] }),
  item('Mod_MeleeAsset', '近战资产', { mod: 1 }, { tags: ['MeleeWeaponMod'] }),
  item('Mod_Notify', '通知资产', { dmg: 1 }, { tags: ['Notify'] }),
  item('Mod_Shared', '拾取资产', { utility: 1 }, { tags: ['SharedPickup'] }),
];

const FRAGMENTS = [
  item('Frag_RedCrit', '红暴击碎片', { crit: 1 }, { color: 'red', effectZh: '暴击 +10%' }),
  item('Frag_YellowRanged', '黄远程碎片', { ranged: 1 }, { color: 'yellow', effectZh: '远程 +10%' }),
  item('Frag_BlueArmor', '蓝护甲碎片', { armor: 1 }, { color: 'blue', effectZh: '护甲 +10%' }),
  item('Frag_RedDmg', '红伤害碎片', { dmg: 1 }, { color: 'red', effectZh: '伤害 +5%' }),
];

const TRAITS = [
  item('Trait_Armor', '护甲特性', { armor: 1 }, { maxLevel: 10, perLevel: { armor_efficacy: 0.05 } }),
  item('Trait_Dmg', '伤害特性', { dmg: 1 }, { maxLevel: 10, perLevel: { damage_pct: 0.01 } }),
  item('Trait_Blank', '无维度特性', null, { maxLevel: 10 }),
];

const KINDS = ['ring', 'amulet', 'mutator', 'mod', 'fragment', 'trait', 'relic'];

function makeDoc(patch = {}) {
  return {
    meta: { schema: 1 },
    dimensions: patch.dimensions || DIMENSIONS,
    playstyles: patch.playstyles || PLAYSTYLES,
    gear: {
      ring: patch.rings || RINGS,
      amulet: patch.amulets || AMULETS,
      mutator: patch.mutators || MUTATORS,
      mod: patch.mods || MODS,
      fragment: patch.fragments || FRAGMENTS,
      trait: patch.traits || TRAITS,
      relic: patch.relics || [],
    },
  };
}

/** 仿模型层 model.gear（契约 §3.2）：数组 + byId + kindOf + playstyles */
function makeGear(doc) {
  const byId = new Map();
  const kindById = new Map();
  const lists = {};
  for (const kind of KINDS) {
    const list = Array.isArray(doc.gear[kind]) ? doc.gear[kind] : [];
    lists[kind] = list;
    for (const entry of list) {
      if (!entry || typeof entry.id !== 'string') continue;
      if (!byId.has(entry.id)) byId.set(entry.id, entry);
      if (!kindById.has(entry.id)) kindById.set(entry.id, kind);
    }
  }
  return {
    doc,
    dimensions: doc.dimensions,
    dimensionById: new Map(doc.dimensions.map((d) => [d.id, d])),
    dimensionZh: (id) => {
      const dim = doc.dimensions.find((d) => d.id === id);
      return dim ? dim.zh : id;
    },
    playstyles: doc.playstyles,
    playstyleById: new Map(doc.playstyles.map((p) => [p.id, p])),
    ...lists,
    lists,
    byId,
    kindOf: (id) => kindById.get(id) || null,
    all: (kind) => lists[kind] || [],
    of: (id) => byId.get(id) || null,
  };
}

const DOC = makeDoc();
const GEAR = makeGear(DOC);
const SCORER = createScorer(DOC);         // 契约用法：整份 lab_gear 文档
const SCORER_MODEL = createScorer(GEAR);  // 兼容：模型层 model.gear
const COMBOS = createComboSearch(GEAR, SCORER);
const FIT = createFit(GEAR, SCORER);

const round3 = (value) => Math.round(value * 1000) / 1000;

function loadoutOf(ids, playstyleId = 'ranged_crit') {
  return SCORER.loadoutScore(ids, playstyleId);
}

function hitsOfCombo(combo, playstyleId = 'ranged_crit') {
  let hits = 0;
  for (const id of [combo.amulet, ...combo.rings]) {
    const kind = GEAR.kindOf(id);
    const result = SCORER.itemScore(kind, GEAR.of(id), playstyleId);
    hits += Object.keys(result.dims).length;
  }
  return hits;
}

/* ------------------------------- score.js ------------------------------- */

test('createScorer：空文档 / 缺字段不崩，返回安全空值', () => {
  const empty = createScorer({});
  assert.deepEqual(empty.itemScore('ring', { id: 'x', dims: { crit: 1 } }, 'general'), {
    score: 0, dims: {}, why: [],
  });
  assert.deepEqual(empty.itemScore('ring', null, 'general'), { score: 0, dims: {}, why: [] });
  assert.equal(empty.itemScores('ring', 'general').size, 0);
  assert.deepEqual(empty.loadoutScore(['a'], 'general'), { score: 0, avg: 0, coverage: 0, dims: {} });
  assert.deepEqual(empty.topDims({}, 3), []);
  assert.deepEqual(empty.playstylesFor('ring', { id: 'x' }), []);
  assert.deepEqual(empty.weightsOf('general'), {});

  const nullScorer = createScorer(null);
  assert.equal(nullScorer.itemScore('ring', { id: 'x', dims: { crit: 1 } }, 'ranged_crit').score, 0);
  assert.equal(COVERAGE_WEIGHT, 0.6);
  assert.equal(SCORE_DIGITS, 3);
});

test('createScorer：整份文档与 model.gear 两种入参评分一致', () => {
  for (const ringItem of RINGS) {
    for (const psId of ['general', 'ranged_crit', 'tank']) {
      assert.deepEqual(
        SCORER_MODEL.itemScore('ring', ringItem, psId),
        SCORER.itemScore('ring', ringItem, psId),
        `${ringItem.id} / ${psId} 两种入参应一致`,
      );
    }
  }
  assert.deepEqual(
    SCORER_MODEL.loadoutScore(['Ring_Crit', 'Amu_Crit'], 'ranged_crit'),
    SCORER.loadoutScore(['Ring_Crit', 'Amu_Crit'], 'ranged_crit'),
  );
});

test('itemScore：无 dims / 全非正 / 维度表外 → 0', () => {
  const noDims = SCORER.itemScore('ring', RINGS.find((r) => r.id === 'Ring_Blank'), 'ranged_crit');
  assert.equal(noDims.score, 0);
  assert.deepEqual(noDims.dims, {});

  const zeroDims = SCORER.itemScore('ring', RINGS.find((r) => r.id === 'Ring_Zero'), 'ranged_crit');
  assert.equal(zeroDims.score, 0, 'dims 值 0 不参与');

  const negative = SCORER.itemScore('ring', { id: 'R_Neg', dims: { crit: -1, ranged: 1 } }, 'ranged_crit');
  assert.equal(negative.score, 0.32, '负值忽略，只剩 ranged 0.8/2.5');

  const outside = SCORER.itemScore('ring', { id: 'R_Out', dims: { unknownDim: 1 } }, 'ranged_crit');
  assert.equal(outside.score, 0, '流派权重表外的维度不计分');
  assert.deepEqual(outside.why, []);
});

test('itemScore：Σ dims·w / Σ w 手算对照 + 大于 1 的脏值按 1 处理', () => {
  // ranged_crit 权重和 = 0.6+0.8+0.9+0.2 = 2.5
  const ringCrit = SCORER.itemScore('ring', RINGS[0], 'ranged_crit');
  assert.equal(ringCrit.score, 0.68, '(0.9·1 + 0.8·1) / 2.5 = 0.68');
  assert.equal(ringCrit.dims.crit, 0.9);
  assert.equal(ringCrit.dims.ranged, 0.8);
  assert.deepEqual(ringCrit.why, ['暴击/弱点', '远程'], 'why 按维度贡献降序');

  const dirty = SCORER.itemScore('ring', { id: 'R_Dirty', dims: { crit: 2 } }, 'ranged_crit');
  assert.equal(dirty.score, 0.36, 'v>1 防御性按 1 处理：0.9/2.5');

  // general 权重和 = 1.5；Ring_Dmg dmg=1 → 0.5/1.5
  assert.equal(SCORER.itemScore('ring', RINGS[1], 'general').score, 0.333);
});

test('itemScore：支持直接传 id 字符串，并四舍五入到 3 位', () => {
  const byId = SCORER.itemScore('ring', 'Ring_Crit', 'ranged_crit');
  assert.equal(byId.score, SCORER.itemScore('ring', RINGS[0], 'ranged_crit').score);
  assert.equal(byId.score, 0.68);

  const score = SCORER.itemScore('ring', RINGS[1], 'general').score;
  assert.equal(score, Number(score.toFixed(SCORE_DIGITS)), '分数应等于自身 3 位小数');

  // 未指定流派 / 非法流派 → 0（不抛异常）
  assert.equal(SCORER.itemScore('ring', RINGS[0], 'no_such_ps').score, 0);
  assert.equal(SCORER.itemScore('ring', RINGS[0], undefined).score, 0);
});

test('topDims：按 v 降序、同分 id 序、zh 映射与上限', () => {
  const dims = { dmg: 0.5, crit: 0.2, ranged: 0.2, armor: 0.1 };
  assert.deepEqual(SCORER.topDims(dims, 2), [
    { id: 'dmg', zh: '通用伤害', v: 0.5 },
    { id: 'crit', zh: '暴击/弱点', v: 0.2 },
  ]);
  assert.deepEqual(SCORER.topDims(dims), [
    { id: 'dmg', zh: '通用伤害', v: 0.5 },
    { id: 'crit', zh: '暴击/弱点', v: 0.2 },
    { id: 'ranged', zh: '远程', v: 0.2 },
  ], '默认取前 3');
  assert.deepEqual(SCORER.topDims(dims, 0), []);
  assert.deepEqual(SCORER.topDims(null, 3), []);
  assert.deepEqual(SCORER.topDims({ crit: 0 }, 3), [], '非正贡献不上榜');
  assert.deepEqual(SCORER.topDims([{ id: 'crit', v: 0.4 }], 1), [{ id: 'crit', zh: '暴击/弱点', v: 0.4 }]);
});

test('itemScores：预算缓存与 itemScore 一致、空 kind 安全', () => {
  const map = SCORER.itemScores('ring', 'ranged_crit');
  assert.ok(map instanceof Map);
  for (const ringItem of RINGS) {
    assert.equal(map.get(ringItem.id), SCORER.itemScore('ring', ringItem, 'ranged_crit').score);
  }
  assert.equal(SCORER.itemScores('ring', 'ranged_crit'), map, '预算结果应按 (kind, 流派) 缓存复用');
  assert.equal(SCORER.itemScores('relic', 'ranged_crit').size, 0);
  assert.equal(SCORER.itemScores('no_such_kind', 'ranged_crit').size, 0);
  assert.equal(SCORER.itemScores('ring', 'no_such_ps').get('Ring_Crit'), 0);
});

test('loadoutScore：avg 平均 / coverage 只算权重≥0.6 / 0.7·avg+0.3·coverage', () => {
  // ranged_crit 高权重维度 = dmg(.6) / ranged(.8) / crit(.9)，共 3 个
  const result = SCORER.loadoutScore(['Ring_Crit', 'Amu_Crit'], 'ranged_crit');
  assert.equal(result.avg, 0.52, '(0.68 + 0.36) / 2');
  assert.equal(result.coverage, 0.667, '覆盖 crit / ranged 两个高权重维度 = 2/3');
  assert.equal(result.score, 0.564, '0.7·0.52 + 0.3·(2/3)');
  assert.equal(result.dims.crit, 1.8, 'Ring_Crit 0.9 + Amu_Crit 0.9');
  assert.equal(result.dims.ranged, 0.8);
});

test('loadoutScore：覆盖加成生效（coverage=0 只有 avg；coverage=1 加满 0.3）', () => {
  const zeroCoverage = SCORER.loadoutScore(['Ring_Dmg'], 'general');
  assert.equal(zeroCoverage.coverage, 0, 'general 没有权重≥0.6 的维度');
  assert.equal(zeroCoverage.score, round3(0.7 * zeroCoverage.avg), 'coverage=0 时只剩 0.7·avg');

  const fullCoverage = SCORER.loadoutScore(['Ring_Crit', 'Ring_Dmg', 'Amu_Crit'], 'ranged_crit');
  assert.equal(fullCoverage.coverage, 1, 'dmg/ranged/crit 全部被覆盖');
  assert.equal(fullCoverage.avg, 0.427);
  assert.equal(fullCoverage.score, round3(0.7 * (1.28 / 3) + 0.3));

  const half = SCORER.loadoutScore(['Ring_Crit', 'Amu_Crit'], 'ranged_crit');
  assert.ok(half.score > round3(0.7 * half.avg) + 0.15, '覆盖加成确实抬高了总分');
});

test('loadoutScore：同一 id 只算一次、未知 id 跳过不崩', () => {
  const once = SCORER.loadoutScore(['Ring_Crit'], 'ranged_crit');
  const twice = SCORER.loadoutScore(['Ring_Crit', 'Ring_Crit'], 'ranged_crit');
  assert.deepEqual(twice, once, '重复 id 不重复计分');

  const withUnknown = SCORER.loadoutScore(['Ring_Crit', 'No_Such_Item'], 'ranged_crit');
  assert.equal(withUnknown.avg, once.avg, '未知 id 不参与平均（也不伪造 0 分）');
  assert.equal(withUnknown.coverage, once.coverage);
  assert.deepEqual(SCORER.loadoutScore([], 'ranged_crit'), { score: 0, avg: 0, coverage: 0, dims: {} });
});

test('playstylesFor：返回前 2 个流派，按分数降序（含 0 分兜底）', () => {
  const top = SCORER.playstylesFor('ring', RINGS[1]); // Ring_Dmg
  assert.deepEqual(top.map((row) => row.id), ['general', 'ranged_crit']);
  assert.deepEqual(top.map((row) => row.zh), ['通用', '远程暴击']);
  assert.deepEqual(top.map((row) => row.score), [0.333, 0.24]);

  const zero = SCORER.playstylesFor('ring', RINGS[4]); // Ring_Blank 无 dims
  assert.equal(zero.length, 2);
  assert.deepEqual(zero.map((row) => row.id), ['general', 'ranged_crit'], '同分 0 时按流派 id 字典序');

  const noPs = createScorer(makeDoc({ playstyles: [] }));
  assert.deepEqual(noPs.playstylesFor('ring', RINGS[0]), []);
});

/* ------------------------------- combos.js ------------------------------- */

test('combos：空 gear 不崩、返回安全空结果', () => {
  const emptyDoc = { dimensions: DIMENSIONS, playstyles: PLAYSTYLES, gear: {} };
  const emptyGear = makeGear(emptyDoc);
  const emptyScorer = createScorer(emptyDoc);
  const search = createComboSearch(emptyGear, emptyScorer);

  const trinkets = search.recommendTrinkets({ playstyleId: 'ranged_crit' });
  assert.deepEqual(trinkets.combos, []);
  assert.equal(trinkets.stats.evaluated, 0);
  assert.equal(trinkets.stats.ringPool, 0);
  assert.equal(trinkets.stats.amuletPool, 0);
  assert.equal(trinkets.error, undefined);

  const remaining = search.recommendRemaining({ playstyleId: 'ranged_crit' });
  assert.equal(remaining.slots.length, 5, '空装备时 1 项链 + 4 戒指都是空槽');
  for (const slot of remaining.slots) assert.equal(slot.items.length, 0);
  assert.equal(remaining.base.score, 0);

  assert.deepEqual(search.recommendSwap({ playstyleId: 'ranged_crit' }), []);

  const bare = createComboSearch(null, null);
  assert.deepEqual(bare.recommendTrinkets({}).combos, []);
  assert.deepEqual(bare.recommendRemaining({}).slots.length, 5);
  assert.deepEqual(bare.recommendSwap({}), []);
});

test('combos：固定件组合包含固定件，分数与 loadoutScore 一致', () => {
  const result = COMBOS.recommendTrinkets({
    playstyleId: 'ranged_crit',
    fixedAmulet: 'Amu_Crit',
    fixedRings: ['Ring_Crit', 'Ring_Dmg'],
    limit: 10,
  });
  assert.equal(result.error, undefined);
  assert.equal(result.combos.length, 6, '候选 4 戒指中选 2：C(4,2)=6');
  assert.equal(result.stats.evaluated, 6);
  assert.equal(result.stats.fixedRings, 2);
  assert.equal(result.stats.need, 2);
  assert.equal(result.stats.returned, 6);

  for (const combo of result.combos) {
    assert.equal(combo.amulet, 'Amu_Crit');
    assert.equal(combo.rings.length, 4);
    assert.ok(combo.rings.includes('Ring_Crit') && combo.rings.includes('Ring_Dmg'), '固定件必须留在组合里');
    const expected = SCORER.loadoutScore([combo.amulet, ...combo.rings], 'ranged_crit');
    assert.equal(combo.score, expected.score);
    assert.equal(combo.avg, expected.avg);
    assert.equal(combo.coverage, expected.coverage);
    assert.deepEqual(combo.dims, expected.dims);
    assert.ok(Array.isArray(combo.why) && combo.why.includes('暴击/弱点'));
  }

  const best = result.combos[0];
  assert.equal(best.score, 0.479);
  assert.deepEqual(best.rings, ['Ring_Crit', 'Ring_Dmg', 'Ring_Armor', 'Ring_Blank']);
});

test('combos：戒指不可重复，候选池排除固定件', () => {
  const result = COMBOS.recommendTrinkets({
    playstyleId: 'ranged_crit',
    fixedAmulet: 'Amu_Crit',
    fixedRings: ['Ring_Crit', 'Ring_Dmg'],
    limit: 100,
  });
  for (const combo of result.combos) {
    assert.equal(new Set(combo.rings).size, 4, '戒指不可重复');
    assert.equal(combo.rings.length, 4);
    assert.ok(!combo.rings.includes('Amu_Crit'), '项链与戒指不混淆');
  }
  // 候选池 4 个（6 - 2 固定），不会出现第 5 个戒指
  assert.equal(result.stats.ringPool, 4);
});

test('combos：excludeIds 过滤缺件（数组 / Set 等价）', () => {
  const result = COMBOS.recommendTrinkets({
    playstyleId: 'ranged_crit',
    excludeIds: ['Ring_Crit', 'Amu_Dmg'],
    limit: 100,
  });
  assert.equal(result.stats.ringPool, 5, '6 戒指排除 1 个缺件');
  assert.equal(result.stats.amuletPool, 2, '3 项链排除 1 个缺件');
  assert.equal(result.stats.evaluated, 2 * 5, 'C(5,4)=5 × 2 项链');
  for (const combo of result.combos) {
    assert.ok(!combo.rings.includes('Ring_Crit'), '缺件不得进组合');
    assert.notEqual(combo.amulet, 'Amu_Dmg');
  }

  const asSet = COMBOS.recommendTrinkets({
    playstyleId: 'ranged_crit',
    excludeIds: new Set(['Ring_Crit', 'Amu_Dmg']),
    limit: 100,
  });
  assert.deepEqual(asSet, result, 'excludeIds 传 Set 与数组结果一致');
});

test('combos：池上限 ring 24 / amulet 12，枚举量 = 12×C(24,4)', () => {
  const manyRings = Array.from({ length: 30 }, (_, i) => item(`Ring_${String(i).padStart(2, '0')}`, `戒指${i}`, { dmg: 1 }));
  const manyAmulets = Array.from({ length: 20 }, (_, i) => item(`Amu_${String(i).padStart(2, '0')}`, `项链${i}`, { crit: 1 }));
  const bigDoc = makeDoc({ rings: manyRings, amulets: manyAmulets });
  const bigGear = makeGear(bigDoc);
  const search = createComboSearch(bigGear, createScorer(bigGear));

  const result = search.recommendTrinkets({ playstyleId: 'ranged_crit', limit: 1 });
  assert.equal(result.stats.ringPool, 24, 'ring 池截断为前 24');
  assert.equal(result.stats.amuletPool, 12, 'amulet 池截断为前 12');
  assert.equal(result.stats.evaluated, 12 * 10626, '12 × C(24,4) = 126,720 组');
  assert.equal(result.combos.length, 1);
  assert.equal(result.combos[0].amulet, 'Amu_00', '同分按 id 字典序取池');
  assert.ok(result.combos[0].rings.every((id) => /^Ring_(0[0-9]|1[0-9]|2[0-3])$/.test(id)), '戒指只来自前 24');
});

test('combos：固定 4 戒时剩余槽为 0，只枚举项链', () => {
  const first = RINGS.slice(0, 4).map((row) => row.id);
  const result = COMBOS.recommendTrinkets({
    playstyleId: 'ranged_crit',
    fixedRings: first,
    limit: 3,
  });
  assert.equal(result.stats.need, 0);
  assert.equal(result.stats.evaluated, AMULETS.length, '只有 3 个项链候选');
  assert.equal(result.stats.returned, 3);
  for (const combo of result.combos) assert.deepEqual(combo.rings, first);
});

test('combos：固定件非法（重复/类型错/不存在/超额）→ error 字符串不抛异常', () => {
  const cases = [
    { label: '重复戒指', opts: { fixedRings: ['Ring_Crit', 'Ring_Crit'] }, match: /重复/ },
    { label: '类型不符', opts: { fixedAmulet: 'Ring_Crit' }, match: /类型不符/ },
    { label: '不存在', opts: { fixedAmulet: 'No_Such_Amulet' }, match: /不存在/ },
    {
      label: '戒指超额',
      opts: { fixedRings: ['Ring_Crit', 'Ring_Dmg', 'Ring_Armor', 'Ring_Health', 'Ring_Blank'] },
      match: /超过/,
    },
  ];
  for (const testCase of cases) {
    let result;
    assert.doesNotThrow(() => {
      result = COMBOS.recommendTrinkets({ playstyleId: 'ranged_crit', ...testCase.opts });
    }, testCase.label);
    assert.deepEqual(result.combos, [], `${testCase.label}：组合应为空`);
    assert.equal(typeof result.error, 'string', `${testCase.label}：应返回 error 字符串`);
    assert.match(result.error, testCase.match);
  }

  const remaining = COMBOS.recommendRemaining({
    playstyleId: 'ranged_crit',
    fixed: { amulet: null, rings: ['Ring_Crit', 'Ring_Crit'] },
  });
  assert.deepEqual(remaining.slots, []);
  assert.match(remaining.error, /重复/);

  const swap = COMBOS.recommendSwap({
    playstyleId: 'ranged_crit',
    current: { amulet: null, rings: ['Ring_Crit', 'Ring_Crit'] },
  });
  assert.deepEqual([...swap], []);
  assert.match(swap.error, /重复/);
});

test('combos：确定性（两次调用 / 独立实例一致；同分按 key 字典序）', () => {
  const options = { playstyleId: 'ranged_crit', fixedAmulet: 'Amu_Crit', fixedRings: ['Ring_Crit', 'Ring_Dmg'], limit: 10 };
  const first = COMBOS.recommendTrinkets(options);
  const second = COMBOS.recommendTrinkets({ ...options });
  assert.deepEqual(second, first, '同输入两次结果应完全一致');

  const otherGear = makeGear(makeDoc());
  const otherSearch = createComboSearch(otherGear, createScorer(otherGear));
  assert.deepEqual(otherSearch.recommendTrinkets({ ...options }), first, '独立实例结果应一致');

  assert.equal('elapsedMs' in first.stats, false, 'stats 不含真实耗时（保证确定性）');

  // 排序：score↓ → 命中维度数↓ → id 字典序（key = 项链 + 4 戒指 id）
  for (let i = 1; i < first.combos.length; i += 1) {
    const prev = first.combos[i - 1];
    const next = first.combos[i];
    const prevHits = hitsOfCombo(prev);
    const nextHits = hitsOfCombo(next);
    assert.ok(prev.score >= next.score, '组合分数应降序');
    if (prev.score === next.score && prevHits === nextHits) {
      const prevKey = [prev.amulet, ...prev.rings].join('\u0000');
      const nextKey = [next.amulet, ...next.rings].join('\u0000');
      assert.ok(prevKey < nextKey, '同分同命中数时按 id 字典序');
    }
  }

  // 直接传 lab_gear 文档（而非 model.gear）也应可用
  const fromDoc = createComboSearch(DOC, SCORER);
  assert.deepEqual(fromDoc.recommendTrinkets({ ...options }), first);
});

test('combos：recommendRemaining 空槽推荐 + 边际增益公式', () => {
  const fixed = { amulet: 'Amu_Crit', rings: ['Ring_Crit'] };
  const baseIds = [fixed.amulet, ...fixed.rings];
  const base = SCORER.loadoutScore(baseIds, 'ranged_crit');

  const result = COMBOS.recommendRemaining({ playstyleId: 'ranged_crit', fixed, emptySlots: 2 });
  assert.deepEqual(result.slots.map((slot) => slot.slot), ['ring2', 'ring3']);
  assert.deepEqual(result.base, base, 'base 应等于当前装备的 loadoutScore');

  for (const slot of result.slots) {
    assert.ok(slot.items.length > 0 && slot.items.length <= 5, '每空槽前 5');
    let prevGain = Infinity;
    for (const candidate of slot.items) {
      assert.equal(candidate.kind, 'ring');
      assert.ok(!baseIds.includes(candidate.id), '候选不得与已装备重复');
      const next = SCORER.loadoutScore([...baseIds, candidate.id], 'ranged_crit');
      assert.equal(candidate.score, round3(next.score - base.score), 'score = 放入该槽的边际增益');
      assert.ok(Array.isArray(candidate.why));
      assert.ok(candidate.score <= prevGain, '边际增益应降序');
      prevGain = candidate.score;
    }
  }

  // emptySlots 传槽名数组时与真实空槽取交集（已装备的 amulet 不会出现）
  const bySlot = COMBOS.recommendRemaining({
    playstyleId: 'ranged_crit',
    fixed,
    emptySlots: ['amulet', 'ring2'],
  });
  assert.deepEqual(bySlot.slots.map((slot) => slot.slot), ['ring2']);

  // 空槽全空（无固定）时推断 1 项链 + 4 戒指
  const allEmpty = COMBOS.recommendRemaining({ playstyleId: 'ranged_crit' });
  assert.deepEqual(allEmpty.slots.map((slot) => slot.slot), ['amulet', 'ring1', 'ring2', 'ring3', 'ring4']);
});

test('combos：recommendSwap 同槽更优替换', () => {
  const current = { amulet: 'Amu_Dmg', rings: ['Ring_Blank', 'Ring_Zero', 'Ring_Dmg', 'Ring_Health'] };
  const base = SCORER.loadoutScore([current.amulet, ...current.rings], 'ranged_crit');
  const swaps = COMBOS.recommendSwap({ playstyleId: 'ranged_crit', current });
  assert.equal(swaps.length, 5, '5 个已装备槽各给一个更优替换');
  assert.equal(swaps.error, undefined);

  let prevGain = Infinity;
  for (const swap of swaps) {
    assert.ok(swap.gain > 0, '只返回有提升的替换');
    assert.ok(swap.gain <= prevGain, '按增益降序');
    prevGain = swap.gain;

    let ids;
    if (swap.slot === 'amulet') {
      assert.equal(swap.from, current.amulet);
      ids = [swap.to, ...current.rings];
    } else {
      const index = Number(swap.slot.slice(4)) - 1;
      assert.equal(swap.from, current.rings[index]);
      const rings = current.rings.slice();
      rings[index] = swap.to;
      ids = [current.amulet, ...rings];
    }
    assert.ok(!ids.filter((id) => id === swap.to).length || swap.to !== swap.from, '替换目标不应是原装备');
    const next = SCORER.loadoutScore(ids, 'ranged_crit');
    assert.equal(swap.gain, round3(next.score - base.score), 'gain = 替换后 − 当前');
    assert.ok(Array.isArray(swap.why));
  }

  const ringSwaps = swaps.filter((swap) => swap.slot !== 'amulet');
  assert.ok(ringSwaps.every((swap) => swap.to === 'Ring_Crit'), '戒指槽最优替换应为最高分戒指');
  assert.equal(swaps.find((swap) => swap.slot === 'amulet').to, 'Amu_Crit');
});

/* ------------------------------- fit.js ------------------------------- */

test('fit：突变因子按武器类型过滤（longGun/handGun → ranged；melee；any 通用）', () => {
  const ids = (list) => list.map((row) => row.id);

  const longGun = FIT.recommendMutators({ weaponType: 'longGun', playstyleId: 'ranged_crit', limit: 10 });
  assert.deepEqual(ids(longGun), ['Mut_RangedCrit', 'Mut_NoType', 'Mut_AnyDmg'], '只含 any / ranged，按分降序');
  assert.ok(!ids(longGun).includes('Mut_Melee'));

  const handGun = FIT.recommendMutators({ weaponType: 'handGun', playstyleId: 'ranged_crit', limit: 10 });
  assert.deepEqual(ids(handGun), ids(longGun), 'handGun 与 longGun 同属 ranged');

  const melee = FIT.recommendMutators({ weaponType: 'melee', playstyleId: 'ranged_crit', limit: 10 });
  assert.deepEqual(ids(melee), ['Mut_NoType', 'Mut_AnyDmg', 'Mut_Melee'], 'melee + any');
  assert.ok(!ids(melee).includes('Mut_RangedCrit'));
  assert.ok(melee.every((row) => row.weapon === 'any' || row.weapon === 'melee'));

  // 类型未知 → 不做过滤（全量按分排序），默认 limit 5
  const unknown = FIT.recommendMutators({ playstyleId: 'ranged_crit' });
  assert.equal(unknown.length, MUTATORS.length);
  assert.deepEqual(FIT.recommendMutators({ weaponType: 'melee', playstyleId: 'ranged_crit', limit: 0 }), []);
});

test('fit：武器标签契合 +0.05/维度、上限 +0.15、why 注明', () => {
  const bonusDoc = makeDoc({
    playstyles: [
      {
        id: 'weapon_test',
        zh: '武器测试',
        dims: { crit: 0.1, ranged: 0.1, dmg: 0.1, status: 0.1, armor: 1, health: 1 },
        order: 1,
      },
    ],
    mutators: [
      item('Mut_Four', '四维突变', { crit: 1, ranged: 1, dmg: 1, status: 1 }, { weapon: 'any' }),
      item('Mut_Two', '二维突变', { crit: 1, ranged: 1 }, { weapon: 'any' }),
      item('Mut_None', '无关突变', { mod: 1 }, { weapon: 'any' }),
    ],
  });
  const bonusGear = makeGear(bonusDoc);
  // 模型层武器索引（真实用法里来自 itemList / slotPools；这里用 itemsById 模拟）
  bonusGear.itemsById = new Map([
    ['W_Long', { id: 'W_Long', zh: '测试长枪', family: 'longGun', tags: ['Ranged', 'CritChance', 'Damage', 'Status'] }],
  ]);
  const bonusScorer = createScorer(bonusGear);
  const fit = createFit(bonusGear, bonusScorer);

  const rows = fit.recommendMutators({
    weaponType: 'longGun',
    weaponId: 'W_Long',
    playstyleId: 'weapon_test',
    limit: 10,
  });
  assert.deepEqual(rows.map((row) => row.id), ['Mut_Four', 'Mut_Two', 'Mut_None']);

  // weapon_test 权重和 = 2.4：四维突变基础分 0.4/2.4 = 0.167，命中 4 维 → 加成封顶 +0.15
  assert.equal(rows[0].score, 0.317);
  assert.ok(rows[0].why.includes('与武器标签契合'));
  // 二维突变基础分 0.2/2.4 = 0.083，命中 2 维 → +0.10
  assert.equal(rows[1].score, 0.183);
  // 无关突变维度不匹配武器 → 无加成
  assert.equal(rows[2].score, 0);
  assert.ok(!rows[2].why.includes('与武器标签契合'));

  // 不传 weaponId（解析不到武器）→ 无加成，排序仍确定
  const noWeapon = fit.recommendMutators({ weaponType: 'longGun', playstyleId: 'weapon_test', limit: 10 });
  assert.equal(noWeapon.find((row) => row.id === 'Mut_Four').score, 0.167);
  assert.equal(noWeapon.find((row) => row.id === 'Mut_Two').score, 0.083);

  // 只传 weaponId：类型从 family 解析为 ranged，过滤与加成一致
  const byWeapon = fit.recommendMutators({ weaponId: 'W_Long', playstyleId: 'weapon_test', limit: 10 });
  assert.deepEqual(byWeapon, rows);
});

test('fit：改装近战空数组 + note；远程排除资产标签', () => {
  const melee = FIT.recommendMods({ weaponType: 'melee', playstyleId: 'ranged_crit' });
  assert.equal(melee.length, 0);
  assert.match(melee.note, /近战/);
  assert.equal(melee.weaponType, 'melee');

  const ranged = FIT.recommendMods({ weaponType: 'longGun', playstyleId: 'ranged_crit', limit: 10 });
  assert.deepEqual(ranged.map((row) => row.id), ['Mod_Crit', 'Mod_ModDmg'], '按 itemScore 降序');
  for (const row of ranged) {
    assert.ok(!['Mod_MeleeAsset', 'Mod_Notify', 'Mod_Shared'].includes(row.id), '资产行应被排除');
    assert.ok(Array.isArray(row.why));
  }

  // 类型未知 → 不做近战判定，但仍排除资产标签
  const unknown = FIT.recommendMods({ playstyleId: 'ranged_crit', limit: 10 });
  assert.equal(unknown.length, 2);
  assert.equal(unknown.note, undefined);
});

test('fit：碎片/特性按 itemScore 降序，颜色计数与 perLevel/maxLevel', () => {
  const fragments = FIT.recommendFragments({ playstyleId: 'ranged_crit' });
  assert.deepEqual(fragments.map((row) => row.id), [
    'Frag_RedCrit', 'Frag_YellowRanged', 'Frag_RedDmg', 'Frag_BlueArmor',
  ]);
  for (let i = 1; i < fragments.length; i += 1) assert.ok(fragments[i - 1].score >= fragments[i].score);
  assert.deepEqual(fragments.colorCounts, { red: 2, yellow: 1, blue: 1 });
  assert.equal(fragments.note, undefined, '三色齐全时无均衡提示');
  assert.ok(fragments.every((row) => typeof row.effectZh === 'string' && row.effectZh.length > 0));
  assert.equal(fragments[0].color, 'red');

  const topTwo = FIT.recommendFragments({ playstyleId: 'ranged_crit', limit: 2 });
  assert.equal(topTwo.length, 2);
  assert.deepEqual(topTwo.map((row) => row.id), ['Frag_RedCrit', 'Frag_YellowRanged']);
  assert.match(topTwo.note, /蓝/, '缺蓝色碎片时给出颜色均衡提示');

  const traits = FIT.recommendTraits({ playstyleId: 'ranged_crit' });
  assert.equal(traits.length, TRAITS.length, '默认返回全量特性');
  assert.deepEqual(traits.map((row) => row.id), ['Trait_Dmg', 'Trait_Armor', 'Trait_Blank']);
  assert.equal(traits[0].score, 0.24);
  assert.equal(traits[0].maxLevel, 10);
  assert.deepEqual(traits[0].perLevel, { damage_pct: 0.01 });
  assert.deepEqual(traits[1].perLevel, { armor_efficacy: 0.05 });
  assert.equal(traits[2].perLevel, undefined);

  const one = FIT.recommendTraits({ playstyleId: 'ranged_crit', limit: 1 });
  assert.equal(one.length, 1);
  assert.equal(one[0].id, 'Trait_Dmg');
});

test('fit：空 gear 不崩，四个入口都返回安全空数组', () => {
  const emptyFit = createFit({}, createScorer({}));
  assert.deepEqual([...emptyFit.recommendMutators({ weaponType: 'longGun' })], []);
  assert.equal(emptyFit.recommendMods({ weaponType: 'longGun' }).length, 0);
  assert.deepEqual([...emptyFit.recommendFragments({})], []);
  assert.deepEqual([...emptyFit.recommendTraits({})], []);
  const bareFit = createFit(null, null);
  assert.deepEqual([...bareFit.recommendMutators({})], []);
  assert.deepEqual([...bareFit.recommendTraits({})], []);
});

/* ------------------------------- 纯模块守卫 ------------------------------- */

test('纯计算：三个模块零依赖，不碰 DOM / 存储 / 网络', async () => {
  const LAB = new URL('../../js/lab/', import.meta.url);
  for (const name of ['score.js', 'combos.js', 'fit.js']) {
    const source = await fsp.readFile(new URL(name, LAB), 'utf8');
    assert.doesNotMatch(source, /^\s*import\s/m, `${name} 应零依赖（不得出现 import）`);
    assert.doesNotMatch(source, /js\/(core|components)\//, `${name} 不得依赖 core/components`);
    assert.doesNotMatch(source, /(document|window|localStorage|fetch)\s*[.(]/, `${name} 不得触 DOM/存储/网络`);
  }
  assert.equal(typeof createScorer, 'function');
  assert.equal(typeof createComboSearch, 'function');
  assert.equal(typeof createFit, 'function');
});
