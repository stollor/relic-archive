/**
 * qa/tests/data-schema.test.mjs — 数据契约库回归测试（node:test，零依赖）。
 *
 * 原则：
 *   - 真实数据只读：真实快照必须 errors === 0；已知历史缺口只允许 warning（不阻断门禁）。
 *   - 负向夹具全部在内存里做：structuredClone 后篡改，再传给 validateAll，绝不写盘。
 *   - 断言精确到「文件 + JSON Pointer」，防止校验器只喊「有错」却定位不到条目。
 *   - items.json 7.3MB 由 data-schema.mjs 做 module 级缓存，整个进程只 parse 一次。
 *
 * 运行：
 *   node --test qa/tests/data-schema.test.mjs
 *   node --test "qa/tests/*.test.mjs"      # 全量 JS 单元（含本文件）
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  CODEX_BLOCK_TYPES,
  DATA_FILES,
  SUPPORTED_VERSIONS,
  formatDiagnostics,
  loadData,
  validateAll,
} from '../lib/data-schema.mjs';

const BASE = loadData();

/** 深拷贝一个数据文件并篡改，返回 validateAll 结果（其余文件用真实数据） */
function mutate(fileKey, mutateFn) {
  const doc = structuredClone(BASE[fileKey]);
  mutateFn(doc);
  return validateAll({ ...BASE, [fileKey]: doc });
}

/** 在结果里找指定「文件 + JSON Pointer」的诊断；找不到直接失败并打印前 20 条 */
function assertFinding(result, kind, fileKey, pointer, messagePattern) {
  const list = kind === 'warning' ? result.warnings : result.errors;
  const label = kind === 'warning' ? 'warning' : 'error';
  const hit = list.find((diag) => diag.file === DATA_FILES[fileKey] && diag.pointer === pointer);
  if (!hit) {
    assert.fail(`未找到 ${label}：${DATA_FILES[fileKey]} ${pointer}\n实际诊断（前 20 条）：\n${formatDiagnostics(list, 20)}`);
  }
  if (messagePattern) assert.match(hit.message, messagePattern);
  return hit;
}

function assertNoErrors(result, label = '') {
  assert.equal(result.errors.length, 0, `${label}\n不应报错，但得到（前 20 条）：\n${formatDiagnostics(result.errors, 20)}`);
}

/* ------------------------------ 真实数据（只读） ------------------------------ */

test('真实数据：10 个运行时文件的结构/引用/版本契约 errors === 0', () => {
  const result = validateAll(loadData());
  assert.equal(
    result.errors.length,
    0,
    () => `真实数据违反契约（前 20 条）：\n${formatDiagnostics(result.errors, 20)}`,
  );
});

test('真实数据：已知历史缺口只以 warning 呈现（不阻断，也不允许改数据）', () => {
  const { warnings } = validateAll(loadData());
  assert.ok(Array.isArray(warnings));
  const text = warnings.map((diag) => `${diag.pointer} ${diag.message}`).join('\n');
  assert.match(text, /icon_asset/, '应报告 items.icon_asset 23 条在 icon_index 缺失');
  assert.match(text, /inherent_mod/, '应报告 builds inherent_mod 纯显示名');
  assert.match(text, /解码失败|failures/, '应报告 icon_index.failures');
  // warning 不进入 errors
  assert.equal(warnings.filter((diag) => diag.message === '').length, 0);
});

test('loadData 有 module 级缓存：items.json 只解析一次', () => {
  const first = loadData();
  const second = loadData();
  assert.equal(first, second, '重复 loadData 必须返回同一个对象（缓存）');
  assert.equal(first.items, second.items);
  assert.equal(first.items.items.length, 1894);
});

/* ------------------------------ items.json ------------------------------ */

test('items：缺必填字段 → /items/0/id（含 why）', () => {
  const result = mutate('items', (doc) => { delete doc.items[0].id; });
  const hit = assertFinding(result, 'error', 'items', '/items/0/id', /缺少必填字段 id/);
  assert.match(hit.message, /主键/, '必填原因要写进错误信息');
});

test('items：字段类型错误 → /items/1/is_item', () => {
  const result = mutate('items', (doc) => { doc.items[1].is_item = 'yes'; });
  const hit = assertFinding(result, 'error', 'items', '/items/1/is_item', /期望 布尔/);
  assert.equal(hit.actual, 'yes');
});

test('items：id 重复 → /items/1/id', () => {
  const result = mutate('items', (doc) => { doc.items[1].id = doc.items[0].id; });
  assertFinding(result, 'error', 'items', '/items/1/id', /重复值|唯一/);
});

test('items：非法分类枚举 → /items/2/cat', () => {
  const result = mutate('items', (doc) => { doc.items[2].cat = 'not-a-real-cat'; });
  assertFinding(result, 'error', 'items', '/items/2/cat', /枚举值/);
});

test('items：meta.counts.total 与实际不一致 → /meta/counts/total', () => {
  const result = mutate('items', (doc) => { doc.meta.counts.total = 1; });
  assertFinding(result, 'error', 'items', '/meta/counts/total', /实际 1894/);
});

test('items：set.parts 引用不存在的道具 → /items/0/set/parts/2', () => {
  const result = mutate('items', (doc) => {
    const withSet = doc.items.find((item) => item.set && Array.isArray(item.set.parts) && item.set.parts.length > 2);
    assert.ok(withSet, '真实数据应存在带 set.parts 的道具');
    withSet.set.parts[2] = 'Armor_DoesNotExist';
    doc.__fixtureId = withSet.id; // 仅测试内标记
  });
  const hit = result.errors.find((diag) => diag.file === DATA_FILES.items && /\/set\/parts\/2$/.test(diag.pointer) && /DoesNotExist/.test(diag.message));
  assert.ok(hit, `应报告 set.parts 坏引用：\n${formatDiagnostics(result.errors, 20)}`);
});

test('items：合法可选字段缺失不报错', () => {
  const result = mutate('items', (doc) => {
    for (const key of ['unique', 'icon_asset', 'effect', 'set', 'stats_flat', 'base_stats', 'text', 'max_stack_count', 'numbers_quality']) {
      delete doc.items[0][key];
    }
  });
  assertNoErrors(result, 'items 的可选字段缺失应合法');
});

test('items：未知额外字段不报错（向后兼容）', () => {
  const result = mutate('items', (doc) => {
    doc.items[0].__future_field = { any: 'shape' };
    doc.meta.__future_meta = 1;
  });
  assertNoErrors(result, '未知额外字段应被忽略');
});

/* ------------------------------ builds.json ----------------------------- */

test('builds：meta.counts.builds 与实际不一致 → /meta/counts/builds', () => {
  const result = mutate('builds', (doc) => { doc.meta.counts.builds = 6; });
  assertFinding(result, 'error', 'builds', '/meta/counts/builds', /builds\.length/);
});

test('builds：槽位坏引用 → /builds/0/slots/ring/0', () => {
  const result = mutate('builds', (doc) => { doc.builds[0].slots.ring[0] = 'Ring_DoesNotExist'; });
  assertFinding(result, 'error', 'builds', '/builds/0/slots/ring/0', /items\.json id/);
});

test('builds：缺必填字段 → /builds/0/name_zh', () => {
  const result = mutate('builds', (doc) => { delete doc.builds[0].name_zh; });
  assertFinding(result, 'error', 'builds', '/builds/0/name_zh', /缺少必填字段 name_zh/);
});

test('builds：key 重复 → /builds/1/key', () => {
  const result = mutate('builds', (doc) => { doc.builds[1].key = doc.builds[0].key; });
  assertFinding(result, 'error', 'builds', '/builds/1/key', /重复值|唯一/);
});

test('builds：loadout 武器坏引用 → /builds/0/loadout/weapons/hand_gun/mod', () => {
  const result = mutate('builds', (doc) => { doc.builds[0].loadout.weapons.hand_gun.mod = 'Mod_DoesNotExist'; });
  assertFinding(result, 'error', 'builds', '/builds/0/loadout/weapons/hand_gun/mod', /items\.json id/);
});

/* ----------------------------- site_data.json ---------------------------- */

test('site_data：formula 关键常数被改 → /meta/formula/armor_k', () => {
  const result = mutate('siteData', (doc) => { doc.meta.formula.armor_k = 201; });
  assertFinding(result, 'error', 'siteData', '/meta/formula/armor_k', /常量 200/);
});

test('site_data：pieces id 重复 → /pieces/1/id', () => {
  const result = mutate('siteData', (doc) => { doc.pieces[1].id = doc.pieces[0].id; });
  assertFinding(result, 'error', 'siteData', '/pieces/1/id', /重复值|唯一/);
});

test('site_data：presets 护甲下标越界 → /presets/0/best/parts/0', () => {
  const result = mutate('siteData', (doc) => { doc.presets[0].best.parts[0] = 9999; });
  assertFinding(result, 'error', 'siteData', '/presets/0/best/parts/0', /pieces 下标/);
});

/* ----------------------------- archetypes.json --------------------------- */

test('archetypes：id 重复 → /archetypes/1/id', () => {
  const result = mutate('archetypes', (doc) => { doc.archetypes[1].id = doc.archetypes[0].id; });
  assertFinding(result, 'error', 'archetypes', '/archetypes/1/id', /重复值|唯一/);
});

test('archetypes：缺必填字段 → /archetypes/0/engram', () => {
  const result = mutate('archetypes', (doc) => { delete doc.archetypes[0].engram; });
  assertFinding(result, 'error', 'archetypes', '/archetypes/0/engram', /缺少必填字段 engram/);
});

/* ------------------------------- codex/index ----------------------------- */

test('codex：article.cat 引用未知分类 → /articles/0/cat', () => {
  const result = mutate('codex', (doc) => { doc.articles[0].cat = 'no-such-category'; });
  assertFinding(result, 'error', 'codex', '/articles/0/cat', /categories/);
});

test('codex：不支持的 block 类型 → /articles/0/blocks/0/t', () => {
  const result = mutate('codex', (doc) => { doc.articles[0].blocks[0].t = 'video'; });
  assertFinding(result, 'error', 'codex', '/articles/0/blocks/0/t', /枚举值/);
});

test('codex：related 坏引用 → /articles/0/related/N', () => {
  const relatedIndex = BASE.codex.articles[0].related.length;
  const result = mutate('codex', (doc) => { doc.articles[0].related.push('no-such-article'); });
  assertFinding(result, 'error', 'codex', `/articles/0/related/${relatedIndex}`, /articles\[\]\.id/);
});

test('codex：文章 id 重复 → /articles/1/id', () => {
  const result = mutate('codex', (doc) => { doc.articles[1].id = doc.articles[0].id; });
  assertFinding(result, 'error', 'codex', '/articles/1/id', /重复值|唯一/);
});

test('codex：block 结构错误 → /articles/0/blocks/0/level', () => {
  const result = mutate('codex', (doc) => {
    const heading = doc.articles[0].blocks.find((block) => block.t === 'h');
    assert.ok(heading, '真实 codex 文章应有 h 块');
    delete heading.level;
  });
  const hit = result.errors.find((diag) => diag.file === DATA_FILES.codex && /\/blocks\/\d+\/level$/.test(diag.pointer));
  assert.ok(hit, `应报告 h 块 level 缺失：\n${formatDiagnostics(result.errors, 20)}`);
});

test('codex blocks 支持集合与 js/views/codex.js 的 switch 一致', () => {
  const source = readFileSync(new URL('../../js/views/codex.js', import.meta.url), 'utf8');
  const switchBody = /switch \(b\.t\) \{([\s\S]*?)\n  \}/.exec(source);
  assert.ok(switchBody, '未找到 js/views/codex.js 的 switch (b.t) 渲染分支');
  const supported = [...switchBody[1].matchAll(/case '([a-z]+)':/g)].map((match) => match[1]).sort();
  assert.deepEqual(supported, [...CODEX_BLOCK_TYPES].sort(), 'data-schema 的 block 类型集合必须与视图渲染分支同步');
});

/* -------------------------------- terms.json ----------------------------- */

test('terms：未知新版本 → /version，并提示先更新校验器', () => {
  const result = mutate('terms', (doc) => { doc.version = 99; });
  assertFinding(result, 'error', 'terms', '/version', /数据版本比校验器新.*先更新 qa\/lib\/data-schema\.mjs/);
});

test('terms：slots id 重复 → /slots/1/id', () => {
  const result = mutate('terms', (doc) => { doc.slots[1].id = doc.slots[0].id; });
  assertFinding(result, 'error', 'terms', '/slots/1/id', /重复值|唯一/);
});

/* --------------------------- item_effects / acq -------------------------- */

test('item_effects：key 不在 items.json → /items/NoSuchItem', () => {
  const result = mutate('itemEffects', (doc) => {
    doc.items.NoSuchItem = structuredClone(Object.values(doc.items)[0]);
  });
  assertFinding(result, 'error', 'itemEffects', '/items/NoSuchItem', /items\.json 中存在的道具 id/);
});

test('JSON Pointer 按 RFC6901 转义：/ → ~1、~ → ~0', () => {
  const result = mutate('itemEffects', (doc) => {
    const sample = structuredClone(Object.values(doc.items)[0]);
    doc.items['Bad/Key'] = sample;
    doc.items['Bad~Key'] = sample;
  });
  assertFinding(result, 'error', 'itemEffects', '/items/Bad~1Key');
  assertFinding(result, 'error', 'itemEffects', '/items/Bad~0Key');
});

test('acq：合法的 i18n 纯文本实体 key 允许（不报错）', () => {
  const entityKey = Object.keys(BASE.builds.i18n).find((key) => !(key in BASE.acq.items));
  assert.ok(entityKey, '夹具假设：builds.i18n 中存在 acq 尚未收录的纯文本实体');
  const result = mutate('acq', (doc) => {
    doc.items[entityKey] = { tags: [], dlc: null, text: null };
    doc.counts.total += 1;
  });
  assertNoErrors(result, 'acq 的 i18n 纯文本实体（无本地 id）应被允许');
});

test('acq：未知实体 key → /items/UnknownEntity', () => {
  const result = mutate('acq', (doc) => {
    doc.items.UnknownEntity = { tags: [], dlc: null, text: null };
    doc.counts.total += 1;
  });
  assertFinding(result, 'error', 'acq', '/items/UnknownEntity', /items\.json id/);
});

/* ------------------------------- lab_gear.json --------------------------- */

test('lab_gear：缺必填字段 → /gear/ring/0/id', () => {
  const result = mutate('labGear', (doc) => { delete doc.gear.ring[0].id; });
  const hit = assertFinding(result, 'error', 'labGear', '/gear/ring/0/id', /缺少必填字段 id/);
  assert.match(hit.message, /全局唯一主键/, '必填原因要写进错误信息');
});

test('lab_gear：dims 自创维度 → /gear/ring/0/dims/nope', () => {
  const result = mutate('labGear', (doc) => {
    doc.gear.ring[0].dims = { ...doc.gear.ring[0].dims, nope: 1 };
    doc.gear.ring[0].evidence = ['tag:fixture'];
  });
  assertFinding(result, 'error', 'labGear', '/gear/ring/0/dims/nope', /不能自创维度 id/);
});

test('lab_gear：有 dims 却没有 evidence → /gear/ring/0/evidence', () => {
  const result = mutate('labGear', (doc) => {
    const ring = doc.gear.ring.find((entry) => entry.dims && Object.keys(entry.dims).length > 0);
    assert.ok(ring, '真实数据应有带 dims 的戒指');
    ring.evidence = [];
  });
  const hit = result.errors.find((diag) => diag.file === DATA_FILES.labGear && /\/evidence$/.test(diag.pointer) && /维度分必须能回溯/.test(diag.message));
  assert.ok(hit, `应报告「有 dims 无 evidence」：\n${formatDiagnostics(result.errors, 20)}`);
});

test('lab_gear：fragment 缺 color → /gear/fragment/0/color', () => {
  const result = mutate('labGear', (doc) => { delete doc.gear.fragment[0].color; });
  assertFinding(result, 'error', 'labGear', '/gear/fragment/0/color', /缺少必填字段 color/);
});

test('lab_gear：mutator.weapon 非法枚举 → /gear/mutator/0/weapon', () => {
  const result = mutate('labGear', (doc) => { doc.gear.mutator[0].weapon = 'longGun'; });
  assertFinding(result, 'error', 'labGear', '/gear/mutator/0/weapon', /枚举值/);
});

test('lab_gear：trait 缺 maxLevel → /gear/trait/0/maxLevel', () => {
  const result = mutate('labGear', (doc) => { delete doc.gear.trait[0].maxLevel; });
  assertFinding(result, 'error', 'labGear', '/gear/trait/0/maxLevel', /缺少必填字段 maxLevel/);
});

test('lab_gear：meta.counts.ring 与实际不一致 → /meta/counts/ring', () => {
  const result = mutate('labGear', (doc) => { doc.meta.counts.ring = 1; });
  assertFinding(result, 'error', 'labGear', '/meta/counts/ring', /gear\.ring\.length/);
});

test('lab_gear：非 fragment 的 id 不在 items.json → /gear/ring/0/id', () => {
  const result = mutate('labGear', (doc) => { doc.gear.ring[0].id = 'Ring_DoesNotExist'; });
  assertFinding(result, 'error', 'labGear', '/gear/ring/0/id', /items\.json 中存在的道具 id/);
});

test('lab_gear：跨 kind id 重复 → /gear/amulet/0/id', () => {
  const result = mutate('labGear', (doc) => { doc.gear.amulet[0].id = doc.gear.ring[0].id; });
  assertFinding(result, 'error', 'labGear', '/gear/amulet/0/id', /重复/);
});

test('lab_gear：更高 schema → /meta/schema，并提示先更新校验器', () => {
  const result = mutate('labGear', (doc) => { doc.meta.schema = 2; });
  assertFinding(result, 'error', 'labGear', '/meta/schema', /数据版本比校验器新.*先更新 qa\/lib\/data-schema\.mjs/);
});

test('lab_gear：derived-raw 必须把原文放 effectZhRaw 且不提供 effectZh → /gear/ring/N/effectZh', () => {
  const result = mutate('labGear', (doc) => {
    const target = doc.gear.ring.find((entry) => entry.effectSrc === 'derived-raw');
    assert.ok(target, '真实数据应存在 derived-raw 条目（内部键名转储清洗）');
    target.effectZh = target.effectZhRaw;
  });
  const hit = result.errors.find((diag) => diag.file === DATA_FILES.labGear && /\/effectZh$/.test(diag.pointer) && /derived-raw/.test(diag.message));
  assert.ok(hit, `应报告 derived-raw 不得再提供 effectZh：\n${formatDiagnostics(result.errors, 20)}`);
});

test('lab_gear：未知额外字段不报错（向后兼容）', () => {
  const result = mutate('labGear', (doc) => {
    doc.gear.ring[0].__future_field = { any: 'shape' };
    doc.meta.__future_meta = 1;
  });
  assertNoErrors(result, 'lab_gear 未知额外字段应被忽略');
});

/* ------------------------------- icon_index ------------------------------ */

test('icon_index：count 与 icons 数量不一致 → /count', () => {
  const result = mutate('iconIndex', (doc) => { doc.count += 1; });
  assertFinding(result, 'error', 'iconIndex', '/count', /icons 实际/);
});

/* ------------------------------- 版本策略 -------------------------------- */

test('items：更高版本 → /meta/schema_version 且提示「数据比校验器新」', () => {
  const result = mutate('items', (doc) => { doc.meta.schema_version = '1.5.0'; });
  assertFinding(result, 'error', 'items', '/meta/schema_version', /先更新 qa\/lib\/data-schema\.mjs/);
});

test('builds：更高 schema → /meta/schema 且提示「数据比校验器新」', () => {
  const result = mutate('builds', (doc) => { doc.meta.schema = 99; });
  assertFinding(result, 'error', 'builds', '/meta/schema', /数据版本比校验器新/);
});

test('SUPPORTED_VERSIONS 覆盖关键版本字段（items/codex/acq/terms）', () => {
  assert.deepEqual(SUPPORTED_VERSIONS.items.supported, ['1.4.0']);
  assert.deepEqual(SUPPORTED_VERSIONS.codex.supported, [1]);
  assert.deepEqual(SUPPORTED_VERSIONS.acq.supported, ['acq/1']);
  assert.deepEqual(SUPPORTED_VERSIONS.terms.supported, [2]);
  assert.deepEqual(SUPPORTED_VERSIONS.labGear.supported, [1]);
});

/* ------------------------------ 诊断结构统一 ------------------------------ */

test('所有诊断都含 file / RFC6901 pointer / expected / actual / message', () => {
  const result = mutate('codex', (doc) => {
    doc.articles[0].cat = 'nope';
    doc.articles[0].blocks[0].t = 'nope';
  });
  assert.ok(result.errors.length >= 2);
  for (const diag of result.errors) {
    assert.equal(typeof diag.file, 'string');
    assert.ok(diag.file.startsWith('data/'), 'file 必须是仓库相对路径');
    assert.equal(typeof diag.message, 'string');
    assert.ok(diag.message.length > 0);
    assert.match(diag.expected, /\S/);
    assert.ok(Object.prototype.hasOwnProperty.call(diag, 'actual'));
    assert.ok(diag.pointer === '' || diag.pointer.startsWith('/'), `pointer 必须是 RFC6901：${diag.pointer}`);
  }
});
