/* =============================================================================
   qa/tests/lab-skill.test.mjs — js/lab/skills.js（职业技能推导）单元 + 真实数据集成

   夹具全部在内存构造，不写仓库；真实数据只读 data/items.json + archetypes.json。
   覆盖：空数据不崩 / 子对象过滤（_Action/_Aura/_Buff…）/ 中文名汉字判定
        / 每职业 ≤3 条与固定顺序 / pkg 不可解析与未实装职业跳过
        / Skill 字段形状（冷充伤、nums、summary 兜底链、descEn、iconUrl）
        / 真实数据：已实装职业全覆盖、Hunter 含「猎人标记」、任何职业 ≤3
        / 纯模块守卫：无 import、不触 DOM/存储/网络
   运行：node --test qa/tests/lab-skill.test.mjs
   ========================================================================== */
import test from 'node:test';
import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';

import { deriveSkills, MAX_SKILLS, MAX_NUMS, SKILL_NOTE } from '../../js/lab/skills.js';

/* --------------------------------- 夹具 --------------------------------- */

const ARCH = (id, zh, status = 'released') => ({ id, zh, en: id, status });
const pkg = (archId, dir) => `/Game/World_Base/Items/Archetypes/${archId}/Skills/${dir}/X`;
const sk = (id, zh, archId, dir, numbers = {}, extra = {}) => ({
  id, cat: 'skill', zh, en: extra.en || id, pkg: pkg(archId, dir), numbers, ...extra,
});
function modelOf(items, archetypes, itemIcon) {
  return {
    itemsById: new Map(items.map((it) => [it.id, it])),
    archetypes,
    findArchetype: (id) => archetypes.find((a) => a.id === id) || null,
    itemIcon: itemIcon === undefined
      ? (it) => (it.iconAsset ? `./assets/icons/${it.iconAsset}.png` : null)
      : itemIcon,
  };
}
const ids = (list) => list.map((s) => s.id);
const zhOf = (list) => list.map((s) => s.zh);
const HUNTER = ARCH('Hunter', '猎人');

/* --------------------------------- 单元 --------------------------------- */

test('空 model / 缺字段不崩：空 Map / 空数组 / derived 0', () => {
  for (const model of [null, undefined, {}, { itemsById: null, archetypes: null }]) {
    const result = deriveSkills(model);
    assert.ok(result.byArchetype instanceof Map);
    assert.equal(result.byArchetype.size, 0);
    assert.deepEqual(result.all, []);
    assert.equal(result.derived, 0);
    assert.equal(result.note, SKILL_NOTE);
  }
  const junk = deriveSkills({
    itemsById: new Map([['bad', null], ['bad2', 42], ['ring', { id: 'ring' }]]),
    archetypes: [null, {}, { id: 'Hunter', zh: '猎人' }],
  });
  assert.equal(junk.derived, 0);
  assert.deepEqual(junk.all, []);
});

test('子对象过滤：留本体；整组无本体退回中文名最短 id；无汉字名整组跳过', () => {
  const items = [
    sk('Skill_HuntersMark', '猎人标记', 'Hunter', 'HuntersMark', { CooldownTime: 70 }),
    sk('Skill_HuntersMark_Action', '', 'Hunter', 'HuntersMark'),
    sk('Skill_HuntersMark_Aura_Action', 'Skill Hunters Mark Aura Action', 'Hunter', 'HuntersMark'),
    sk('Skill_SnareTrap_Actor', '', 'Hunter', 'SnareTrap'),
    sk('Skill_SnareTrap_Aura', 'Skill Snare Trap Aura', 'Hunter', 'SnareTrap'),
    sk('Skill_Trap_SelfBuff', '陷阱', 'Hunter', 'Trap', { CooldownTime: 30 }),
  ];
  const result = deriveSkills(modelOf(items, [HUNTER]));
  assert.deepEqual(ids(result.byArchetype.get('Hunter')), ['Skill_HuntersMark', 'Skill_Trap_SelfBuff']);
  assert.deepEqual(zhOf(result.byArchetype.get('Hunter')), ['猎人标记', '陷阱']);
  assert.equal(result.derived, 1);

  // 中文名被 api.normalizeItem 用英文名兜底的子对象，不得当成技能名
  const englishOnly = deriveSkills(modelOf([
    sk('Skill_Only_Action', 'Skill Only Action', 'Hunter', 'Only'),
    sk('Skill_OnlyVisual', '', 'Hunter', 'Only2'),
  ], [HUNTER]));
  assert.equal(englishOnly.byArchetype.size, 0);
});

test('每职业最多 3 条：本体组优先（再目录字典序），回退组只在不足时补位', () => {
  const items = [['Zeta', '甲'], ['Alpha', '乙'], ['Beta', '丙'], ['Gamma', '丁'], ['Delta', '戊']]
    .map(([dir, zh]) => sk(`Skill_${dir}`, zh, 'Challenger', dir));
  items.push(sk('Skill_Fallback_AllyBuff', '转移', 'Challenger', 'Fallback'));
  const many = deriveSkills(modelOf(items, [ARCH('Challenger', '挑战者')]));
  const rows = many.byArchetype.get('Challenger');
  assert.equal(rows.length, MAX_SKILLS);
  assert.deepEqual(zhOf(rows), ['乙', '丙', '戊'], '本体组按目录名排序后截断（Alpha/Beta/Delta）');

  const few = deriveSkills(modelOf([
    sk('Skill_Alpha', '甲', 'Challenger', 'Alpha'),
    sk('Skill_Beta', '乙', 'Challenger', 'Beta'),
    sk('Skill_Fallback_AllyBuff', '转移', 'Challenger', 'Fallback'),
  ], [ARCH('Challenger', '挑战者')]));
  assert.deepEqual(zhOf(few.byArchetype.get('Challenger')), ['甲', '乙', '转移'], '本体不足 3 条时回退组补位');
});

test('pkg 不可解析 / 未实装职业 / 非 skill / 无中文名 → 一律跳过', () => {
  const items = [
    sk('Skill_NoPkg', '无路径', 'Hunter', 'X', {}, { pkg: '' }),
    sk('Skill_BadPkg', '坏路径', 'Hunter', 'X', {}, { pkg: '/Game/World_Base/Items/Skill_BadPkg' }),
    { id: 'Ring_NotSkill', cat: 'ring', zh: '戒指', pkg: pkg('Hunter', 'Ring') },
    sk('Skill_Gambler', '全能', 'Gambler', 'AllIn'),
    sk('Skill_NoZh', 'Skill No Zh', 'Medic', 'MedicDir'),
  ];
  const result = deriveSkills(modelOf(items, [
    HUNTER, ARCH('Gambler', '赌徒', 'unreleased'), ARCH('Medic', '医务兵'),
  ]));
  assert.deepEqual([...result.byArchetype.keys()], []);
  assert.equal(result.derived, 0);
});

test('Skill 字段：冷充伤 / nums 格式化与上限 / summary / descEn / iconUrl', () => {
  const item = sk('Skill_HuntersMark', '猎人标记', 'Hunter', 'HuntersMark', {
    CooldownTime: 70.5, MaxCharges: 2, Charges: 3, Damage: 52, HoldTime: 0.25, Range: 2500, Duration: 5,
  }, {
    en: "Hunter's Mark",
    effect: { summary_zh: '伤害 +15%', summary_en: '+15% Damage', lines: [{ display_zh: '冷却时间 70 秒' }] },
    iconAsset: 'T_UI_Icon_Hunter_HuntersMark',
    text: { description: { en: 'Marks the target.' } },
  });
  const skill = deriveSkills(modelOf([item], [HUNTER])).byArchetype.get('Hunter')[0];
  assert.deepEqual(skill, {
    id: 'Skill_HuntersMark',
    zh: '猎人标记',
    en: "Hunter's Mark",
    archId: 'Hunter',
    archZh: '猎人',
    cooldown: 70.5,
    charges: 2,
    damage: 52,
    nums: [
      { label: '冷却', value: '70.5 秒' },
      { label: '充能', value: '2 次' },
      { label: '伤害', value: '52' },
      { label: '蓄力', value: '0.25 秒' },
    ],
    summary: '伤害 +15%',
    descEn: 'Marks the target.',
    iconUrl: './assets/icons/T_UI_Icon_Hunter_HuntersMark.png',
  });
  assert.equal(skill.nums.length, MAX_NUMS, '关键数值最多 4 条');

  const noIcon = deriveSkills(modelOf([item], [HUNTER], null)).byArchetype.get('Hunter')[0];
  assert.equal(noIcon.iconUrl, null, '模型没有 itemIcon 时为 null');
  const noIconAsset = sk('Skill_Plain', '朴素', 'Hunter', 'Plain');
  assert.equal(deriveSkills(modelOf([noIconAsset], [HUNTER])).byArchetype.get('Hunter')[0].iconUrl, null);
});

test('summary 兜底链：summary_zh → effect.lines → nums 拼 → 效果待验证', () => {
  const rows = deriveSkills(modelOf([
    sk('Skill_A', '甲', 'Hunter', 'A', { CooldownTime: 60 }, { effect: { summary_zh: '精准射击' } }),
    sk('Skill_B', '乙', 'Hunter', 'B', { CooldownTime: 60 }, {
      effect: { lines: [{ display_zh: '冷却时间 60 秒' }, { display_zh: '半径 10' }] },
    }),
    sk('Skill_C', '丙', 'Hunter', 'C', { CooldownTime: 60, MaxCharges: 2 }),
  ], [HUNTER])).byArchetype.get('Hunter');
  assert.deepEqual(rows.map((s) => s.summary), [
    '精准射击', '冷却时间 60 秒；半径 10', '冷却 60 秒、充能 2 次',
  ]);

  const bare = deriveSkills(modelOf([sk('Skill_D', '丁', 'Hunter', 'D')], [HUNTER])).byArchetype.get('Hunter')[0];
  assert.equal(bare.summary, '效果待验证');
  assert.deepEqual(bare.nums, []);
  assert.equal(bare.cooldown, null);
  assert.equal(bare.charges, null);
  assert.equal(bare.damage, null);
  assert.equal(bare.descEn, '');
});

test('同名去重 + all/derived 汇总：与 byArchetype 一致且 id 唯一', () => {
  const items = [
    sk('Skill_A', '同名', 'Hunter', 'A'),
    sk('Skill_B', '同名', 'Hunter', 'B'),
    sk('Skill_C', '别的', 'Hunter', 'C'),
    sk('Skill_D', '第二个职业', 'Medic', 'D'),
  ];
  const result = deriveSkills(modelOf(items, [HUNTER, ARCH('Medic', '医务兵')]));
  assert.deepEqual(zhOf(result.byArchetype.get('Hunter')), ['同名', '别的']);
  assert.equal(result.derived, 2);
  assert.equal(result.all.length, 3);
  assert.equal(new Set(ids(result.all)).size, 3);
  assert.deepEqual(result.all, [...result.byArchetype.values()].flat());
});

test('纯模块守卫：skills.js 零依赖，不碰 DOM / 存储 / 网络', async () => {
  const source = await fsp.readFile(new URL('../../js/lab/skills.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /^\s*import\s/m, '不得出现 import');
  assert.doesNotMatch(source, /js\/(core|components|views)\//, '不得依赖上层模块');
  assert.doesNotMatch(source, /(document|window|localStorage|fetch)\s*[.(]/, '不得触 DOM/存储/网络');
  assert.equal(typeof deriveSkills, 'function');
});

/* ----------------------------- 真实数据集成 ----------------------------- */

/** 按 core/api.js 的 normalizeItem 口径取字段：zh 会用英文名兜底，正是本模块要防的坑 */
function normalizeSkill(raw) {
  const display = raw.display || {};
  const label = (raw.text && raw.text.label) || {};
  const first = (...vals) => {
    for (const v of vals) if (typeof v === 'string' && v.trim()) return v.trim();
    return '';
  };
  const zh = first(display.name_zh, raw.zh_name, label.zh);
  const en = first(display.name_en, raw.label_en, label.en);
  return {
    id: raw.id, cat: raw.cat || '', pkg: raw.pkg || '',
    zh: zh || en || raw.id, en: en || zh || '',
    numbers: raw.numbers || {}, effect: raw.effect || null,
    iconAsset: raw.icon_asset || '', descEn: raw.description_en || '',
  };
}

test('真实数据：已实装职业全部有技能，Hunter 含「猎人标记」，任何职业 ≤ 3 条', async () => {
  const [itemsDoc, archDoc] = await Promise.all([
    fsp.readFile(new URL('../../data/items.json', import.meta.url), 'utf8').then(JSON.parse),
    fsp.readFile(new URL('../../data/archetypes.json', import.meta.url), 'utf8').then(JSON.parse),
  ]);
  const archetypes = (archDoc.archetypes || []).map((a) => ({ id: a.id, zh: a.zh, status: a.status }));
  const model = modelOf(
    (itemsDoc.items || []).map(normalizeSkill), archetypes,
    (it) => (it.iconAsset ? `./assets/icons/${it.iconAsset}.png` : null),
  );
  const result = deriveSkills(model);

  const released = archetypes.filter((a) => String(a.status || '') !== 'unreleased').map((a) => a.id);
  const unreleased = archetypes.filter((a) => String(a.status || '') === 'unreleased').map((a) => a.id);
  assert.equal(result.derived, result.byArchetype.size);
  // 当前数据：14 个已实装职业都有技能行。若上游新增职业暂无技能数据，此处按数据事实调整断言，不改数据。
  assert.ok(result.derived >= released.length, `已实装 ${released.length} 个职业应都有技能，实际 ${result.derived}`);
  for (const archId of released) assert.ok(result.byArchetype.has(archId), `${archId} 应推导出技能`);
  for (const archId of unreleased) assert.ok(!result.byArchetype.has(archId), `${archId} 未实装不得入表`);

  const hunter = result.byArchetype.get('Hunter');
  assert.ok(hunter.length >= 2 && hunter.length <= MAX_SKILLS);
  assert.ok(zhOf(hunter).includes('猎人标记'), `Hunter 应含「猎人标记」，实际 ${zhOf(hunter)}`);
  for (const archId of ['Medic', 'Challenger', 'Alchemist']) {
    assert.ok(result.byArchetype.get(archId).length >= 1, `${archId} 至少有 1 条技能`);
  }

  for (const [archId, skills] of result.byArchetype) {
    assert.ok(skills.length <= MAX_SKILLS, `${archId} 超过 ${MAX_SKILLS} 条`);
    assert.equal(new Set(ids(skills)).size, skills.length, `${archId} 技能 id 不得重复`);
    for (const skill of skills) {
      assert.match(skill.zh, /[\u4e00-\u9fff]/, `${skill.id} 必须有中文名`);
      assert.equal(skill.archId, archId);
      assert.ok(skill.archZh.length > 0);
      assert.ok(skill.nums.length <= MAX_NUMS);
      assert.ok(skill.summary.length > 0);
      assert.equal(typeof skill.descEn, 'string');
      assert.ok(skill.cooldown === null || typeof skill.cooldown === 'number');
      assert.ok(skill.charges === null || typeof skill.charges === 'number');
      assert.ok(skill.damage === null || typeof skill.damage === 'number');
      assert.ok(skill.iconUrl === null || typeof skill.iconUrl === 'string');
    }
  }
  assert.equal(result.all.length, [...result.byArchetype.values()].reduce((n, list) => n + list.length, 0));
  assert.equal(new Set(ids(result.all)).size, result.all.length, 'all 内 id 唯一');
  assert.match(result.note, /技能/);
});
