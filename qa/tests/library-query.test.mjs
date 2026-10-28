/* =============================================================================
   qa/tests/library-query.test.mjs — 资料库拆分后的纯函数回归（node --test，零依赖）

   覆盖：
     · 状态 schema：parse / serialize 往返、脏参数过滤、isActive
     · 排序：分类可用项（无数据的数值排序隐藏）、normalize、多口径排序
     · 过滤：owned / fav / tags / conf / dlc / set / icon / stats / 数值区间 / 多词关键词
     · 计数：computeAll 的 skipCat 口径；套装关键词检索
     · 展示模型：rowDesc 降级链、rowStatsSpec、cardDescSpec、套装合计/资料片
     · 导出：CLI 查询映射、payload 结构、PowerShell/JSON 文本
     · 排序池缓存：冷/热一致、Collator 与 cmpText 口径逐项等价、数据快照隔离、不可用排序回落
   运行：node --test qa/tests/library-query.test.mjs
   ========================================================================== */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  defaultState, parseState, serialize, stateKey, isActive,
  SORT_DEFS, NUM_SORT, METRICS, METRIC_BY_ID, TRINKET_CATS,
  sortGroupForCat, sortOptionsForCat, isValidSort,
  availableSortIds, normalizeSort, sortList,
  hasStatValue, metricValue, keywords, matches, counts, computeAll, computeSets,
} from '../../js/library/query.js';
import {
  effectSentence, rowDesc, cardDescSpec, rowStatsSpec,
  setTotals, setDlc, setSummary,
} from '../../js/library/present.js';
import {
  SORT_MAP, buildCliQuery, exportPayload, cliJsonText, powershellText,
} from '../../js/library/export.js';
import { cmpText } from '../../js/core/dom.js';

/* ------------------------------- 假数据 ------------------------------- */

function item(over = {}) {
  return {
    id: 'x', zh: '测试', en: 'Test', cat: 'ring', family: 'ring', isItem: true,
    dlc: 0, confidence: 'high', filterTags: [], tags: [], setKey: '',
    haystack: '测试 test', order: 1,
    ...over,
  };
}

const ARMOR_A = item({
  id: 'armor-a', zh: '甲', en: 'Armor A', cat: 'armor', family: 'head',
  armor: 30.5, weight: 12.25, resistSum: 15, order: 3,
});
const ARMOR_B = item({
  id: 'armor-b', zh: '乙甲', en: 'Armor B', cat: 'armor', family: 'body',
  armor: 50, weight: 9, resistSum: 20, order: 1, dlc: 1,
});
const WEAPON = item({
  id: 'weapon-a', zh: '枪', en: 'Gun', cat: 'weapon', family: 'longGun',
  damage: 120, rate: 4.5, ammoPerClip: 6, crit: 5, order: 2,
  haystack: '枪 gun 伤害',
});
const RING = item({
  id: 'ring-a', zh: '戒', en: 'Ring', cat: 'ring', family: 'ring', value: 25,
  effectZh: '造成 5% 伤害', setKey: 'set-a', filterTags: ['Damage'], order: 4,
});
/** 没有官方效果句的效果类目条目（验证「数值摘要 / 待核实」降级链） */
const RING_NO_EFFECT = item({
  id: 'ring-b', zh: '戒二', en: 'Ring B', cat: 'ring', family: 'ring', value: 25, order: 6,
});
const ASSET = item({
  id: 'asset-a', zh: '资源', en: 'Asset', cat: 'action', family: 'other',
  isItem: false, order: 5, haystack: '资源 asset',
});
const ITEMS = [ARMOR_A, ARMOR_B, WEAPON, RING, ASSET];

const DEPS = {
  isOwned: (id) => id === 'armor-a' || id === 'weapon-a',
  isFav: (id) => id === 'ring-a',
  hasIcon: (it) => it.id !== 'asset-a',
};

function stateOf(over = {}) { return Object.assign(defaultState(), over); }

/* ------------------------------- 状态 schema ------------------------------- */

test('defaultState / serialize：默认态不写参数，key 即查询串', () => {
  const s = defaultState();
  assert.equal(serialize(s), '');
  assert.equal(stateKey(s), '');
  assert.equal(s.cat, 'all');
  assert.equal(s.sort, 'default');
  assert.equal(s.view, 'grid');
  assert.equal(s.metric, 'armor');
  assert.deepEqual(s.tags, []);
});

test('parseState ⇄ serialize：完整状态往返一致', () => {
  const s = stateOf({
    q: '阿哈内', cat: 'weapon', sort: 'damage', view: 'list',
    owned: true, fav: true,
    tags: ['Damage', 'Health'], confs: ['high', 'low'], dlcs: ['1', '3'],
    set: 'set-a', icon: true, stats: true,
    metric: 'weight', min: '1.5', max: '10', assets: true,
  });
  const url = serialize(s);
  assert.match(url, /q=%E9%98%BF%E5%93%88%E5%86%85/);
  assert.match(url, /tag=Damage%2CHealth/);
  assert.deepEqual(parseState(new URLSearchParams(url)), s);
  // 空查询串 → 默认态
  assert.deepEqual(parseState(new URLSearchParams('')), defaultState());
  assert.deepEqual(parseState(null), defaultState());
});

test('parseState：脏参数只接受已知值，非法数值/超长关键词被丢弃', () => {
  const qp = new URLSearchParams([
    ['q', '   ' + 'x'.repeat(200) + '   '],
    ['cat', 'nope'], ['sort', 'not-a-sort'], ['view', 'huge'],
    ['tag', 'Bad,Health'], ['conf', 'high,bogus'], ['dlc', '9,2'],
    ['metric', 'nope'], ['min', 'abc'], ['max', '5'],
    ['owned', 'yes'], ['fav', '1'], ['family', 'longGun'],
  ]);
  const s = parseState(qp);
  assert.equal(s.q.length, 120, '关键词应截断到 120 字符');
  assert.equal(s.cat, 'all');
  assert.equal(s.sort, 'default');
  assert.equal(s.view, 'grid');
  assert.deepEqual(s.tags, ['Health']);
  assert.deepEqual(s.confs, ['high']);
  assert.deepEqual(s.dlcs, ['2']);
  assert.equal(s.metric, 'armor');
  assert.equal(s.min, '', 'min=abc 应忽略');
  assert.equal(s.max, '5');
  assert.equal(s.owned, false, 'owned=yes 不是 1');
  assert.equal(s.fav, true);
});

test('isActive：仅筛选维度触发，排序/视图不算筛选', () => {
  assert.equal(isActive(defaultState()), false);
  for (const over of [
    { q: 'x' }, { cat: 'ring' },
    { owned: true }, { fav: true }, { tags: ['Damage'] }, { confs: ['high'] },
    { dlcs: ['1'] }, { set: 's' }, { icon: true }, { stats: true }, { assets: true },
    { min: '1' }, { max: '2' },
  ]) {
    assert.equal(isActive(stateOf(over)), true, `应算作激活：${JSON.stringify(over)}`);
  }
  assert.equal(isActive(stateOf({ sort: 'name', view: 'list' })), false);
});

/* ------------------------------- 排序 ------------------------------- */

test('排序定义：分类 → 排序组；无数据的数值排序项被隐藏', () => {
  assert.equal(sortGroupForCat('weapon'), 'weapon');
  assert.equal(sortGroupForCat('armor'), 'armor');
  assert.ok(TRINKET_CATS.has('ring') && TRINKET_CATS.has('amulet') && TRINKET_CATS.has('relic'));
  assert.equal(sortGroupForCat('ring'), 'trinket');
  assert.equal(sortGroupForCat('all'), 'default');

  assert.equal(isValidSort('weapon', 'damage'), true);
  assert.equal(isValidSort('weapon', 'value'), false);
  assert.equal(isValidSort('ring', 'value'), true);
  assert.equal(isValidSort('all', 'damage'), false);
  assert.deepEqual(sortOptionsForCat('weapon').map(([id]) => id),
    SORT_DEFS.weapon.map(([id]) => id));

  // 只有 damage/rate/ammoPerClip/crit 有数：mag 有数列，maxammo/weakspot 无数据 → 隐藏
  const ids = availableSortIds('weapon', false, ITEMS);
  assert.ok(ids.has('damage') && ids.has('mag') && ids.has('crit'));
  assert.ok(!ids.has('maxammo') && !ids.has('weakspot'), `不应出现无数据排序：${[...ids]}`);
  // 护甲：resist 有数；weight 有数
  const armorIds = availableSortIds('armor', false, ITEMS);
  assert.ok(armorIds.has('armor') && armorIds.has('weight') && armorIds.has('resist'));
  // 缓存：同一数组第二次调用返回同一 Set（避免重复扫描）
  assert.equal(availableSortIds('weapon', false, ITEMS), ids);
  // 空数据：只保留不需要数值的排序项
  assert.deepEqual([...availableSortIds('weapon', false, [])],
    ['default', 'name']);
});

test('availableSortIds：assets 开关影响候选池，非道具资产默认不参与', () => {
  const onlyAsset = [item({
    id: 'z', cat: 'weapon', family: 'longGun', isItem: false, damage: 99, order: 1,
  })];
  assert.equal(availableSortIds('weapon', false, onlyAsset).has('damage'), false);
  assert.equal(availableSortIds('weapon', true, onlyAsset).has('damage'), true);
});

test('normalizeSort：URL 带入不可用排序时回落到默认', () => {
  const unavailable = stateOf({ cat: 'weapon', sort: 'weakspot' });
  normalizeSort(unavailable, ITEMS);
  assert.equal(unavailable.sort, 'default');

  const ok = stateOf({ cat: 'weapon', sort: 'damage' });
  normalizeSort(ok, ITEMS);
  assert.equal(ok.sort, 'damage');

  const ring = stateOf({ cat: 'ring', sort: 'value' });
  normalizeSort(ring, ITEMS);
  assert.equal(ring.sort, 'value');
});

test('sortList：数值降序（缺数据排后）、名称/dlc/新增/default 口径', () => {
  const ids = (arr) => arr.map((it) => it.id);
  const availWeapon = availableSortIds('weapon', false, ITEMS);
  const weaponPool = ITEMS.filter((it) => it.cat === 'weapon');
  assert.deepEqual(ids(sortList([...weaponPool], stateOf({ cat: 'weapon', sort: 'damage' }), availWeapon)),
    ['weapon-a']);

  const mixed = [
    item({ id: 'm1', zh: 'B', armor: 10, order: 1 }),
    item({ id: 'm2', zh: 'A', armor: 50, order: 2 }),
    item({ id: 'm3', zh: 'C', order: 3, dlc: 2 }),
  ];
  const avail = new Set(['default', 'armor', 'name', 'order', 'dlc']);
  assert.deepEqual(ids(sortList([...mixed], stateOf({ sort: 'armor' }), avail)),
    ['m2', 'm1', 'm3'], '数值降序，无数据排后');
  assert.deepEqual(ids(sortList([...mixed], stateOf({ sort: 'name' }), avail)),
    ['m2', 'm1', 'm3'], '名称 A<B<C');
  assert.deepEqual(ids(sortList([...mixed], stateOf({ sort: 'dlc' }), avail)),
    ['m2', 'm1', 'm3'], '资料片升序，同资料片按名称');
  assert.deepEqual(ids(sortList([...mixed], stateOf({ sort: 'order' }), avail)),
    ['m3', 'm2', 'm1'], '新增按 order 降序');
  assert.deepEqual(ids(sortList([...mixed], stateOf({ sort: 'default' }), avail)),
    ['m1', 'm2', 'm3'], 'default 按 order 升序');
  // sort 不在可用集合 → 同样回落到默认 order 升序
  assert.deepEqual(ids(sortList([...mixed], stateOf({ sort: 'resist' }), new Set(['default']))),
    ['m1', 'm2', 'm3']);
});

/* ------------------------------- 过滤 ------------------------------- */

test('matches：owned/fav/set/tags/conf/dlc 组合口径', () => {
  const base = stateOf({});
  assert.equal(matches(ARMOR_A, base, DEPS), true);
  assert.equal(matches(ASSET, base, DEPS), false, '默认排除非道具资产');
  assert.equal(matches(ASSET, stateOf({ assets: true }), DEPS), true);

  assert.equal(matches(ARMOR_A, stateOf({ owned: true }), DEPS), true);
  assert.equal(matches(ARMOR_B, stateOf({ owned: true }), DEPS), false);
  assert.equal(matches(ARMOR_A, stateOf({ owned: true }), {}), false, '缺 deps 不得误放行');
  assert.equal(matches(RING, stateOf({ fav: true }), DEPS), true);
  assert.equal(matches(ARMOR_A, stateOf({ fav: true }), DEPS), false);

  assert.equal(matches(RING, stateOf({ tags: ['Damage'] }), DEPS), true);
  assert.equal(matches(RING, stateOf({ tags: ['Health'] }), DEPS), false);
  assert.equal(matches(ARMOR_A, stateOf({ confs: ['high'] }), DEPS), true);
  assert.equal(matches(ARMOR_A, stateOf({ confs: ['low'] }), DEPS), false);
  assert.equal(matches(ARMOR_B, stateOf({ dlcs: ['1'] }), DEPS), true);
  assert.equal(matches(ARMOR_A, stateOf({ dlcs: ['1'] }), DEPS), false);
  assert.equal(matches(RING, stateOf({ set: 'set-a' }), DEPS), true);
  assert.equal(matches(ARMOR_A, stateOf({ set: 'set-a' }), DEPS), false);
});

test('matches：icon / stats / 数值区间 / 关键词', () => {
  assert.equal(matches(ARMOR_A, stateOf({ icon: true }), DEPS), true);
  assert.equal(matches(ASSET, stateOf({ icon: true, assets: true }), DEPS), false);
  assert.equal(matches(ASSET, stateOf({ icon: true, assets: true }), { hasIcon: () => true }), true);

  assert.equal(hasStatValue(ARMOR_A), true);
  assert.equal(hasStatValue(item({ cat: 'skill', family: 'skill', effectLines: [] })), false);
  assert.equal(matches(item({ id: 'e', cat: 'skill', family: 'skill' }), stateOf({ stats: true }), DEPS), false);
  assert.equal(matches(ARMOR_A, stateOf({ stats: true }), DEPS), true);
  // resistSum 非 0 也算有数值
  assert.equal(hasStatValue(item({ resistSum: 12 })), true);

  assert.equal(metricValue(ARMOR_A, 'armor'), 30.5);
  assert.equal(metricValue(ARMOR_A, 'damage'), undefined);
  assert.equal(metricValue(ARMOR_A, 'nope'), null);
  assert.equal(matches(ARMOR_A, stateOf({ min: '30', max: '31' }), DEPS), true);
  assert.equal(matches(ARMOR_A, stateOf({ min: '31' }), DEPS), false);
  assert.equal(matches(ARMOR_A, stateOf({ max: '30' }), DEPS), false);
  assert.equal(matches(RING, stateOf({ min: '0', metric: 'armor' }), DEPS), false, '无该数值的条目被排除');

  assert.deepEqual(keywords(''), []);
  assert.deepEqual(keywords('  A  b  '), ['a', 'b']);
  assert.equal(matches(WEAPON, stateOf({ q: '枪 伤害' }), DEPS), true, 'haystack 多词');
  assert.equal(matches(WEAPON, stateOf({ q: '枪 不存在' }), DEPS), false);
  // 关键词可命中 FilterTags 中文名（Damage → 伤害加成）
  assert.equal(matches(RING, stateOf({ q: '伤害加成' }), DEPS), true);
  assert.equal(matches(RING, stateOf({ q: '护盾' }), DEPS), false);
});

test('matches：分类条件可被 skipCat 跳过（分类计数口径）', () => {
  const ringState = stateOf({ cat: 'ring' });
  assert.equal(matches(ARMOR_A, ringState, DEPS), false);
  assert.equal(matches(ARMOR_A, ringState, DEPS, { skipCat: true }), true);
});

/* ------------------------------- 计数 / 聚合 ------------------------------- */

test('counts：skipCat 计数口径（全部分类都计入，分类条件不算）', () => {
  const cnt = counts({ items: ITEMS, state: stateOf({ owned: true }), deps: DEPS });
  assert.equal(cnt.get('all'), 2, 'owned 命中 armor-a / weapon-a');
  assert.equal(cnt.get('armor'), 1);
  assert.equal(cnt.get('weapon'), 1);
  assert.equal(cnt.get('ring'), undefined);

  const catOnly = counts({ items: ITEMS, state: stateOf({ cat: 'ring' }), deps: DEPS });
  assert.equal(catOnly.get('all'), 4, '分类 chip 数字不应被当前分类裁剪');
  assert.equal(catOnly.get('armor'), 2);
});

test('computeAll：结果按分类裁剪、计数按 skipCat、排序可用项生效', () => {
  const all = computeAll({ items: ITEMS, state: stateOf({}), deps: DEPS });
  assert.equal(all.list.length, 4, '默认排除非道具资产');
  assert.equal(all.list[0].id, 'armor-b', '默认 order 升序');
  assert.equal(all.counts.get('all'), 4);

  const rings = computeAll({ items: ITEMS, state: stateOf({ cat: 'ring' }), deps: DEPS });
  assert.deepEqual(rings.list.map((it) => it.id), ['ring-a']);
  assert.equal(rings.counts.get('all'), 4);

  const withAssets = computeAll({ items: ITEMS, state: stateOf({ assets: true }), deps: DEPS });
  assert.equal(withAssets.list.length, 5);

  const q = computeAll({ items: ITEMS, state: stateOf({ q: '枪' }), deps: DEPS });
  assert.deepEqual(q.list.map((it) => it.id), ['weapon-a']);
  assert.equal(q.counts.get('all'), 1);

  const empty = computeAll({ items: null, state: stateOf({}), deps: DEPS });
  assert.deepEqual(empty.list, []);
  assert.equal(empty.counts.get('all'), 0);
});

test('computeSets：套装名/英文名/部件名多词检索', () => {
  const sets = [
    { key: 's1', name: '莱托', nameEn: 'Leto', parts: [{ zh: '头盔', en: 'Helmet' }] },
    { key: 's2', name: '阿卡里', nameEn: 'Akari', parts: [{ zh: '胸甲', en: 'Chest' }] },
  ];
  assert.equal(computeSets({ sets }).length, 2);
  assert.deepEqual(computeSets({ sets, keywords: ['莱托'] }).map((s) => s.key), ['s1']);
  assert.deepEqual(computeSets({ sets, keywords: ['头盔'] }).map((s) => s.key), ['s1']);
  assert.deepEqual(computeSets({ sets, keywords: ['akari'] }).map((s) => s.key), ['s2'], '英文名小写检索');
  assert.deepEqual(computeSets({ sets, keywords: ['莱托', '头盔'] }).map((s) => s.key), ['s1']);
  assert.deepEqual(computeSets({ sets, keywords: ['莱托', '胸甲'] }), []);
  assert.deepEqual(computeSets({ sets: null }), []);
});

/* ------------------------------- 展示模型 ------------------------------- */

test('effectSentence / rowDesc：官方效果句优先，效果类目不拿风味段充数', () => {
  assert.equal(effectSentence(item({ effectZh: '造成 5% 伤害' })), '造成 5% 伤害');
  assert.equal(effectSentence(item({ effectZh: '造成 {Damage} 伤害' })), '', '未替换占位符不展示');
  assert.equal(effectSentence(item({ effectZh: 'Deal 5% Damage' })), '', '成串英文不展示');
  assert.equal(effectSentence(item({ effectZh: '' })), '');

  // 1) 效果句优先（连武器也一样）
  assert.equal(rowDesc(item({ cat: 'weapon', family: 'longGun', effectZh: '效果句', descZh: '描述' })), '效果句');
  // 2) 效果类目：无效果句 → 「数值：…」
  assert.equal(rowDesc(RING_NO_EFFECT, { preview: '价值 25' }), '数值：价值 25');
  // 3) 效果类目：无效果句无数值摘要 → 待核实（即使有风味 descZh 也不用）
  assert.equal(rowDesc(item({ cat: 'ring', family: 'ring', descZh: '据说来自远方' })),
    '效果数据待核实（官方效果未收录）');
  // 4) 非效果类目：descZh 优先（去标签、压缩空白）
  assert.equal(rowDesc(item({ cat: 'weapon', family: 'longGun', descZh: '<b>一把</b>   好枪' })), '一把 好枪');
  // 5) 非效果类目：无 descZh 时用数值摘要
  assert.equal(rowDesc(item({ cat: 'weapon', family: 'longGun' }), { preview: '伤害 120' }), '伤害 120');
  // 6) 只剩机器摘要：明确标注待核实
  assert.equal(rowDesc(item({ cat: 'weapon', family: 'longGun', summaryZh: 'Haste持续时间 0 秒' })),
    '效果数据待核实（官方描述未收录）');
  // 7) 什么都没有
  assert.equal(rowDesc(item({ cat: 'weapon', family: 'longGun' })), '');
});

test('cardDescSpec：护甲/武器删描述；效果类目用效果句或数值摘要；其它保留原卡', () => {
  assert.deepEqual(cardDescSpec(ARMOR_A), { remove: true });
  assert.deepEqual(cardDescSpec(WEAPON), { remove: true }, '武器属性行足够，不重复预览');
  assert.deepEqual(cardDescSpec(item({ cat: 'ring', family: 'ring', effectZh: '效果句' })), { text: '效果句' });
  assert.deepEqual(cardDescSpec(RING_NO_EFFECT, { preview: () => '价值 25' }), { text: '数值：价值 25' });
  assert.deepEqual(cardDescSpec(item({ cat: 'mod', family: 'mod' }), { preview: () => '' }), { remove: true });
  assert.equal(cardDescSpec(item({ cat: 'trait', family: 'trait' })), null, '非效果类目保留 itemCard 自己的描述');
});

test('rowStatsSpec：按部位族挑数值（图标/位数/单位/label），最多 4 项', () => {
  const armor = rowStatsSpec(ARMOR_A);
  assert.deepEqual(armor.map((s) => s.icon), ['armorstat', 'weight', 'resist']);
  assert.equal(armor[0].value, 30.5);
  assert.equal(armor[0].digits, 1);
  assert.equal(armor[0].label, '护甲值');
  assert.equal(armor[2].unit, '抗');

  const weapon = rowStatsSpec(WEAPON);
  assert.deepEqual(weapon.map((s) => s.icon), ['damage', 'firerate', 'mag', 'crit']);
  assert.equal(weapon[1].digits, 2);
  assert.equal(weapon[2].unit, '发');
  assert.equal(weapon[3].unit, '%');

  assert.deepEqual(rowStatsSpec(RING).map((s) => s.icon), ['relic']);
  assert.deepEqual(rowStatsSpec(item({ cat: 'trait', family: 'trait', maxLevel: 20 }))
    .map((s) => s.icon), ['trait']);
  assert.deepEqual(rowStatsSpec(item({ cat: 'material', family: 'other', value: 3, stack: 7 }))
    .map((s) => s.icon), ['material', 'stack']);

  // 无关键数值 → 效果条数兜底
  const manyEffects = item({ cat: 'skill', family: 'skill', effectLines: [{}, {}, {}] });
  assert.deepEqual(rowStatsSpec(manyEffects), [{ icon: 'info', text: '3 条效果' }]);
  // → 抗性合计兜底
  const resistOnly = item({ cat: 'material', family: 'other', resistSum: 18 });
  assert.deepEqual(rowStatsSpec(resistOnly).map((s) => s.icon), ['resist']);
  // 完全无数据 → 空
  assert.deepEqual(rowStatsSpec(item({ cat: 'skill', family: 'skill' })), []);
});

test('套装：setTotals 回退求和、setDlc 中文名、setSummary 三格规格', () => {
  const parts = [
    { zh: '头', en: 'Head', family: 'head', dlc: 0, armor: 10, weight: 2, resistSum: 3 },
    { zh: '身', en: 'Body', family: 'body', dlc: 2, armor: 20, weight: 4, resistSum: 5 },
  ];
  // totals 缺失 → 按部件求和
  assert.deepEqual(setTotals({ parts }), { armor: 30, weight: 6, res: 8 });
  // totals 有值优先；armor=0 视为缺失回退
  assert.deepEqual(setTotals({ parts, totals: { armor: 0, encumbrance: 9, resistance_sum: 11 } }),
    { armor: 30, weight: 9, res: 11 });
  assert.deepEqual(setTotals({ parts: [] }), { armor: null, weight: null, res: null });

  assert.equal(setDlc({ parts }), '失落的王国');
  assert.equal(setDlc({ parts: [{ dlc: 0 }, { dlc: 0 }] }), '本体');
  assert.equal(setDlc({ parts: [{ dlc: 1 }, { dlc: 2 }] }), '真皇的苏醒 / 失落的王国');
  assert.equal(setDlc({ parts: [{ dlc: null }, {}] }), '本体');

  const summary = setSummary({ parts: [{ armor: 10.5, weight: 2, resistSum: 2 }] });
  assert.deepEqual(summary.map((x) => x.label), ['合计护甲值', '负重', '抗性合计']);
  assert.equal(summary[0].value, 10.5);
  assert.equal(summary[0].digits, 1);
  assert.equal(summary[2].value, 2);
  assert.equal(summary[2].digits, 0);
  assert.equal(setSummary({ parts: [] })[0].value, null);
});

/* ------------------------------- 导出 ------------------------------- */

test('buildCliQuery：筛选 → CLI 查询对象（含 sortMap / limit 200）', () => {
  const def = buildCliQuery(defaultState());
  assert.deepEqual(def, { kind: ['item'], limit: 200 });

  const q = buildCliQuery(stateOf({
    cat: 'weapon', set: 'set-a', tags: ['Damage'], confs: ['high'],
    icon: true, stats: true, q: '枪', metric: 'damage', min: '10', max: '99',
    sort: 'damage',
  }));
  assert.deepEqual(q.cat, ['weapon']);
  assert.equal(q.include_assets, undefined);
  assert.deepEqual(q.kind, ['item']);
  assert.equal(q.set, 'set-a');
  assert.deepEqual(q.tag, ['Damage']);
  assert.deepEqual(q.confidence, ['high']);
  assert.equal(q.has_icon, true);
  assert.equal(q.has_effect, true);
  assert.equal(q.text, '枪');
  assert.deepEqual(q.base_stat, ['Damage>=10', 'Damage<=99']);
  assert.equal(q.sort, '-damage');
  assert.equal(q.limit, 200);

  const assets = buildCliQuery(stateOf({ assets: true }));
  assert.equal(assets.include_assets, true);
  assert.equal(assets.kind, undefined);

  const mapped = buildCliQuery(stateOf({ sort: 'resist' }));
  assert.equal(mapped.sort, SORT_MAP.resist);
  assert.equal(buildCliQuery(stateOf({ sort: 'default' })).sort, undefined);
  // 非法 metric 回退 armor 键
  assert.deepEqual(buildCliQuery(stateOf({ metric: 'nope', min: '1' })).base_stat, ['Armor>=1']);
});

test('exportPayload：schema / from / web 快照 / count / ids 上限 400', () => {
  const list = ITEMS.slice();
  const p = exportPayload(stateOf({ cat: 'weapon' }), list);
  assert.equal(p.schema, 'rmn2.cli/1-query');
  assert.equal(p.from, 'web/items');
  assert.equal(p.count, list.length);
  assert.equal(p.query.cat[0], 'weapon');
  assert.deepEqual(p.ids, list.map((it) => it.id));
  assert.match(p.generated_at, /^\d{4}-\d{2}-\d{2}T/);
  // web 是快照：改它不影响外部 state
  const state = stateOf({ cat: 'weapon' });
  const p2 = exportPayload(state, list);
  p2.web.cat = 'ring';
  assert.equal(state.cat, 'weapon');

  const big = Array.from({ length: 500 }, (_, i) => ({ id: `id-${i}` }));
  assert.equal(exportPayload(defaultState(), big).ids.length, 400);
  assert.equal(exportPayload(defaultState(), []).ids.length, 0);
});

test('cliJsonText / powershellText：可直接复制的文本形态', () => {
  const state = stateOf({ cat: 'weapon', sort: 'damage' });
  const txt = cliJsonText(state, ITEMS);
  const parsed = JSON.parse(txt);
  assert.equal(parsed.schema, 'rmn2.cli/1-query');
  assert.equal(parsed.query.limit, 200);

  const ps = powershellText(state);
  assert.match(ps, /Set-Content -Path query\.json/);
  assert.ok(ps.includes('search --query-json @query.json --json'), 'CLI 调用参数逐字保留');
  assert.match(ps, /"limit": 200/);
  assert.ok(ps.includes('mimocode'), 'CLI 路径仍在脚本里');
  assert.ok(ps.includes('@'), 'PowerShell here-string 终止符');
  // 回归：JS 字符串里的 \b / \r 曾把复制出去的 CLI 路径变成控制字符（Windows 路径必须原样）
  assert.ok(ps.includes(String.raw`.\mimocode\bin\rmn2.ps1`), 'CLI 路径必须是可用的 Windows 相对路径');
  assert.doesNotMatch(ps, /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/, '复制出的脚本不得含控制字符');
});

/* ------------------------- 排序池缓存（性能优化 P1） ------------------------- */

/** 参考实现：用 core/dom 的 cmpText（每次 localeCompare）复现排序口径，作为「顺序快照」基准 */
function referenceSort(pool, sort) {
  const arr = [...pool];
  const numRef = (a, b, getter) => {
    const av = getter(a); const bv = getter(b);
    const an = typeof av === 'number'; const bn = typeof bv === 'number';
    if (an && bn) return bv - av;
    if (an) return -1;
    if (bn) return 1;
    return 0;
  };
  if (sort === 'name') arr.sort((a, b) => cmpText(a.zh, b.zh));
  else if (sort === 'dlc') arr.sort((a, b) => (a.dlc - b.dlc) || cmpText(a.zh, b.zh));
  else if (sort === 'order') arr.sort((a, b) => (b.order - a.order) || cmpText(a.zh, b.zh));
  else {
    const get = NUM_SORT[sort];
    if (get) arr.sort((a, b) => numRef(a, b, get) || cmpText(a.zh, b.zh));
    else arr.sort((a, b) => a.order - b.order);
  }
  return arr;
}
const ids = (arr) => arr.map((it) => it.id);
const poolOf = (cat, assets, items) => items.filter((it) => (assets || it.isItem) && (cat === 'all' || it.cat === cat));

test('computeAll：排序池缓存冷/热结果 deepEqual，重复触发结果稳定', () => {
  const s = stateOf({ q: '测试', sort: 'name' });
  const cold = computeAll({ items: ITEMS, state: s, deps: DEPS });
  const hot = computeAll({ items: ITEMS, state: s, deps: DEPS });
  assert.deepEqual(ids(hot.list), ids(cold.list), '缓存命中与首次构建必须逐项一致');
  const third = computeAll({ items: ITEMS, state: s, deps: DEPS });
  assert.deepEqual(ids(third.list), ids(cold.list), '多次调用不得漂移');

  // 顺序快照：与「cmpText 参考排序 → 过滤」的完整 id 序列逐项相等
  const expected = ids(referenceSort(poolOf('all', false, ITEMS), 'name')
    .filter((it) => matches(it, s, DEPS)));
  assert.deepEqual(ids(cold.list), expected, '排序池缓存结果必须与 cmpText 参考口径完全一致');
});

test('排序池缓存：Collator 复用与 cmpText 全量顺序逐项一致（混合池 × 各排序口径）', () => {
  // 覆盖 ASCII/中文/数字后缀/大小写/平局/缺数值：任何顺序差异都会被逐项比较抓到
  const zhPool = ['Alpha 2', 'alpha 10', '甲', '乙甲', '丙', 'Ring 3号', '戒 10', '戒 2',
    '测试', 'Zeta', 'zeta', 'Ammo 1', 'Ammo 10', 'B 2', 'b 10', ''];
  const mixed = [];
  for (let i = 0; i < 96; i += 1) {
    mixed.push(item({
      id: `mix-${i}`,
      zh: zhPool[i % zhPool.length],
      en: `EN ${i}`,
      order: (i * 7) % 11,
      dlc: i % 4,
      armor: i % 5 === 0 ? undefined : i * 3.5,
      weight: i % 3 === 0 ? undefined : i * 1.25,
      value: i % 2 === 0 ? i : undefined,
      damage: i % 4 === 0 ? undefined : i * 2,
      haystack: '',
    }));
  }
  const avail = new Set(['default', 'name', 'dlc', 'order', 'armor', 'weight', 'value', 'damage']);
  for (const sort of [...avail]) {
    const got = sortList([...mixed], stateOf({ sort }), avail);
    const want = referenceSort(mixed, sort);
    assert.deepEqual(ids(got), ids(want), `排序口径「${sort}」与 cmpText 参考实现不一致`);
  }
  // 缓存池路径（computeAll）对同一混合池也必须遵循同一顺序（「全部」分类合法的排序项）
  for (const sort of ['default', 'name', 'dlc', 'order']) {
    const viaAll = computeAll({ items: mixed, state: stateOf({ sort, assets: true }), deps: {} });
    const want = ids(referenceSort(mixed, sort));
    assert.deepEqual(ids(viaAll.list), want, `computeAll 排序池缓存对「${sort}」顺序漂移`);
  }
  // 分类专属排序项（armor）走同一条缓存路径时同样逐项一致
  const armorPool = Array.from({ length: 24 }, (_, i) => item({
    id: `arm-${i}`,
    zh: zhPool[i % zhPool.length],
    cat: 'armor', family: 'head',
    order: i % 7,
    armor: i % 4 === 0 ? undefined : (24 - i) * 2.5,
  }));
  const gotArmor = computeAll({ items: armorPool, state: stateOf({ cat: 'armor', sort: 'armor' }), deps: {} });
  assert.deepEqual(ids(gotArmor.list), ids(referenceSort(armorPool, 'armor')),
    'computeAll 对分类专属排序项（armor）顺序漂移');
});

test('computeAll：items 数据快照隔离（新数组 → 新缓存，互不污染）', () => {
  const A = [item({ id: 'a1', zh: '乙', order: 2 }), item({ id: 'a2', zh: '甲', order: 1 })];
  const B = [item({ id: 'b1', zh: '甲', order: 2 }), item({ id: 'b2', zh: '乙', order: 1 })];
  const s = stateOf({ sort: 'name' });
  assert.deepEqual(ids(computeAll({ items: A, state: s, deps: {} }).list), ['a2', 'a1']);
  assert.deepEqual(ids(computeAll({ items: B, state: s, deps: {} }).list), ['b1', 'b2']);
  // 回到 A（缓存命中）：仍是 A 自己的顺序，不能串成 B 的
  assert.deepEqual(ids(computeAll({ items: A, state: s, deps: {} }).list), ['a2', 'a1']);
});

test('computeAll：URL 带入不可用排序项时回落 default（与 sortList 回落口径一致）', () => {
  const bad = stateOf({ cat: 'weapon', sort: 'weakspot' });
  assert.equal(availableSortIds('weapon', false, ITEMS).has('weakspot'), false, '前置：weapon 池无 weakspot 数据');
  const got = computeAll({ items: ITEMS, state: bad, deps: DEPS });
  const def = computeAll({ items: ITEMS, state: stateOf({ cat: 'weapon', sort: 'default' }), deps: DEPS });
  assert.deepEqual(ids(got.list), ids(def.list), '不可用排序必须回落 default');
  const ref = sortList([...poolOf('weapon', false, ITEMS)], bad, new Set(['default']));
  assert.deepEqual(ids(got.list), ids(ref), '与 sortList 的回落口径一致');
});
