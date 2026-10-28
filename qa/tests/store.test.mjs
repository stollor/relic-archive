/* =============================================================================
   qa/tests/store.test.mjs — core/store.js + lab/state.js 持久化健壮性回归
   运行：node --test qa/tests/store.test.mjs
   契约（P0-4）：
     · 脏 localStorage（非法 JSON / 错误类型）不得让模块初始化抛错；
     · 读取端归一：非法项丢弃/归一，合法数据保留，不整份清空、不静默删除；
     · 旧档迁移只在「新键缺失或不可用」时发生，有效新数据绝不被旧档覆盖；
     · 写失败 emit 'storage-error'（payload: {key, op, error, at, suppressed}，按 key 节流）。
   做法：注入假 globalThis.localStorage，每个用例用带 query 的动态 import 拿独立模块实例。
   ========================================================================== */
import test from 'node:test';
import assert from 'node:assert/strict';

const STORE_URL = new URL('../../js/core/store.js', import.meta.url);
const LAB_STATE_URL = new URL('../../js/lab/state.js', import.meta.url);

const KEY = {
  owned: 'r2.v2.owned',
  fav: 'r2.v2.fav',
  build: 'r2.v2.build',
  saved: 'r2.v2.saved',
  ui: 'r2.v2.ui',
};
const LEGACY = {
  build: 'r2archive.build.v1',
  saved: 'r2archive.saved.v1',
  ui: 'r2archive.ui.v1',
};

let caseSeq = 0;

/** 假 localStorage：seed 值为字符串时按原文存储，其余 JSON.stringify（便于构造非法 JSON） */
function fakeStorage(seed = {}) {
  const map = new Map();
  for (const [k, v] of Object.entries(seed)) {
    if (v === undefined) continue;
    map.set(k, typeof v === 'string' ? v : JSON.stringify(v));
  }
  const ctl = { failSet: null, failRemove: null };
  return {
    ctl,
    getItem(k) { return map.has(k) ? map.get(k) : null; },
    setItem(k, v) {
      if (ctl.failSet && ctl.failSet(k, v)) throw quotaError(k);
      map.set(k, String(v));
    },
    removeItem(k) {
      if (ctl.failRemove && ctl.failRemove(k)) throw quotaError(k);
      map.delete(k);
    },
    clear() { map.clear(); },
    key(i) { return [...map.keys()][i] ?? null; },
    get length() { return map.size; },
    raw(k) { return map.has(k) ? map.get(k) : null; },
    keys() { return [...map.keys()]; },
  };
}

function quotaError(key) {
  const err = new Error(`写入被拒绝：${key}`);
  err.name = 'QuotaExceededError';
  return err;
}

function delay(ms = 0) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 注入假 storage 后，用唯一 query 加载全新 store 模块实例（模块级状态互不串扰） */
async function loadStore(storage, caseName = 'store') {
  assert.ok(storage && typeof storage.getItem === 'function', 'loadStore 需要假 localStorage');
  globalThis.localStorage = storage;
  const mod = await import(`${STORE_URL.href}?case=${encodeURIComponent(caseName)}-${++caseSeq}`);
  return { mod, store: mod.store, storage };
}

/* =============================================================================
   1 · owned / fav
   ========================================================================== */
test('owned/fav：对象/数字/JSON 字符串脏值不崩溃，归一为合法集合', async () => {
  const dirtyStorage = fakeStorage({
    [KEY.owned]: '{"a":1}',
    [KEY.fav]: '123',
  });
  const rawOwnedBefore = dirtyStorage.raw(KEY.owned);
  const rawFavBefore = dirtyStorage.raw(KEY.fav);
  const { store } = await loadStore(dirtyStorage, 'owned-dirty');
  assert.equal(store.ownedCount(), 0);
  assert.equal(store.favCount(), 0);
  assert.equal(store.isOwned('a'), false);
  assert.equal(dirtyStorage.raw(KEY.owned), rawOwnedBefore, '脏数据不静默清空/不改写，留给下次归一');
  assert.equal(dirtyStorage.raw(KEY.fav), rawFavBefore);

  const { store: stringCase } = await loadStore(fakeStorage({ [KEY.owned]: '"abc"' }), 'owned-string');
  assert.equal(stringCase.ownedCount(), 0, 'JSON 字符串不能被拆成单字符集合');

  const { store: mixed } = await loadStore(fakeStorage({
    [KEY.owned]: ['a', 1, null, 'a', '', { x: 1 }],
    [KEY.fav]: ['b', false],
  }), 'owned-mixed');
  assert.deepEqual([...mixed.state.owned], ['a']);
  assert.deepEqual([...mixed.state.fav], ['b']);
  assert.equal(mixed.isOwned('a'), true);
  assert.equal(mixed.isFav('b'), true);
  assert.equal(mixed.toggleOwned(42), false, '非字符串 id 不写入集合');
  assert.equal(mixed.toggleOwned(''), false);
  assert.equal(mixed.ownedCount(), 1);
});

/* =============================================================================
   2 · build 归一
   ========================================================================== */
test('build：slots/mods/traits/meta/name/updated 脏数据归一，未知字段保留', async () => {
  const { store } = await loadStore(fakeStorage({
    [KEY.build]: {
      name: 42,
      slots: { longGun: 'lg', handGun: 42, melee: '', head: null, bogus: 'x', ring1: ['r'] },
      traits: [1, 't1', 't1', null, 't2', 't3', 't4', 't5', 't6', 't7', 't8', 't9', 't10', 't11', 't12'],
      mods: null,
      meta: 'nope',
      updated: 'x',
      futureField: { keep: true },
    },
  }), 'build-dirty');

  const b = store.state.build;
  assert.equal(b.name, '');
  assert.equal(b.slots.longGun, 'lg');
  assert.equal(b.slots.handGun, null);
  assert.equal(b.slots.melee, null);
  assert.equal(b.slots.head, null);
  assert.equal(b.slots.ring1, null);
  assert.equal('bogus' in b.slots, false, '未知槽位键必须丢弃');
  assert.equal(b.traits.length, 10);
  assert.deepEqual(b.traits.slice(0, 3), ['t1', 't2', 't3']);
  assert.equal(new Set(b.traits).size, b.traits.length);
  assert.ok(b.traits.every((t) => typeof t === 'string'));
  assert.deepEqual(b.mods, { longGun: null, handGun: null });
  assert.deepEqual(b.meta, {});
  assert.equal(b.updated, 0);
  assert.deepEqual(b.futureField, { keep: true }, '未知 build 字段保留以兼容未来');
  assert.equal(store.build.get('bogus'), null);
});

test('build：数组型 slots/mods/meta 与字符串 traits 回退默认/空', async () => {
  const { store } = await loadStore(fakeStorage({
    [KEY.build]: { slots: [], mods: [{ longGun: 'x' }], meta: [1, 2], traits: 't1', updated: 12 },
  }), 'build-types');
  const b = store.state.build;
  assert.deepEqual(b.mods, { longGun: null, handGun: null });
  assert.deepEqual(b.meta, {});
  assert.deepEqual(b.traits, []);
  assert.equal(b.updated, 12);
  assert.equal(store.build.filled(), 0);
});

test('build API：非法 slot / id / mods / traits 写不进去，合法值正常', async () => {
  const { store } = await loadStore(fakeStorage({}), 'build-api');
  store.build.set('bogus', 'x');
  assert.equal(store.build.slots().bogus, undefined);
  store.build.set('__proto__', 'x');
  store.build.set('toString', 'x');
  assert.equal(store.build.get('__proto__'), null);
  assert.equal(store.build.get('toString'), null);
  assert.equal(typeof store.build.slots().toString, 'function', '原型链不能被槽位写入污染');
  store.build.set('longGun', 123);
  assert.equal(store.build.get('longGun'), null);
  store.build.set('longGun', 'lg');
  assert.equal(store.build.get('longGun'), 'lg');

  store.build.setTraits('abc');
  assert.deepEqual(store.build.traits(), []);
  store.build.setTraits(['a', 1, 'a', 'b']);
  assert.deepEqual(store.build.traits(), ['a', 'b']);

  store.build.setMod('bogus', 'x');
  assert.deepEqual(store.build.mods(), { longGun: null, handGun: null });
  store.build.setMod('longGun', 7);
  assert.equal(store.build.mods().longGun, null);
  store.build.setMeta('bad-patch');
  assert.deepEqual(store.build.meta(), {});
});

/* =============================================================================
   3 · saved 部分损坏
   ========================================================================== */
test('saved.list：部分损坏保留合法记录、丢弃非法项，读取不写回', async () => {
  const seed = [
    null,
    { id: 'ok1', name: '甲', ts: 11, build: { slots: { longGun: 'lg' }, traits: ['t1'], meta: { scenario: 'boss' } } },
    'garbage',
    { name: '没有 id' },
    { id: 'bad-build', name: '乙', ts: 5, build: 'broken' },
    { id: 'ok1', name: '重复 id', ts: 9, build: {} },
    { id: 'ok2', name: 99, savedAt: 42, slots: { primary: 'p1', ring1: 'r1' }, traits: [1, 't2'] },
    { id: 'ok2', name: '重复 id2', ts: 1 },
  ];
  const storage = fakeStorage({ [KEY.saved]: seed });
  const rawBefore = storage.raw(KEY.saved);
  const { store } = await loadStore(storage, 'saved-partial');

  const list = store.saved.list();
  assert.deepEqual(list.map((rec) => rec.id), ['ok1', 'bad-build', 'ok2'], '合法记录保留，非法项丢弃，重复 id 去重');
  assert.equal(list[0].name, '甲');
  assert.equal(list[0].ts, 11);
  assert.equal(list[0].build.slots.longGun, 'lg');
  assert.deepEqual(list[0].build.meta, { scenario: 'boss' });
  assert.equal(list[1].build.slots.longGun, null, '损坏 build 归空但记录本身保留');
  assert.equal(list[2].name, '未命名配装');
  assert.equal(list[2].ts, 42);
  assert.equal(list[2].build.slots.longGun, 'p1', '记录级旧 slots（primary）按别名归到 longGun');
  assert.deepEqual(list[2].build.traits, ['t2']);
  assert.equal(storage.raw(KEY.saved), rawBefore, 'list() 只读，不得写回或清空数据');

  assert.equal(store.saved.load('bad-build'), true, '损坏 build 的存档载入不抛错');
  assert.equal(store.build.filled(), 0);
  assert.equal(store.saved.load('missing-id'), false);
});

test('saved API：save/load/rename/remove 全程使用归一化数据，同名覆盖不重复', async () => {
  const storage = fakeStorage({});
  const { store } = await loadStore(storage, 'saved-api');
  store.build.set('longGun', 'lg');
  store.build.setTraits(['t1']);

  const rec = store.saved.save('测试配装');
  assert.equal(rec.name, '测试配装');
  assert.equal(typeof rec.id, 'string');
  assert.equal(store.saved.count(), 1);
  assert.equal(store.saved.list()[0].build.slots.longGun, 'lg');
  assert.deepEqual(store.saved.list()[0].build.traits, ['t1']);

  const rec2 = store.saved.save('测试配装');
  assert.equal(store.saved.count(), 1, '同名覆盖不新增');
  assert.equal(rec2.id, rec.id);

  assert.equal(store.saved.rename(rec.id, '改名'), true);
  assert.equal(store.saved.list()[0].name, '改名');

  store.build.clear();
  assert.equal(store.saved.load(rec.id), true);
  assert.equal(store.build.get('longGun'), 'lg');
  assert.equal(store.build.filled(), 1);
  assert.equal(store.saved.remove(rec.id), true);
  assert.equal(store.saved.count(), 0);
});

/* =============================================================================
   4 · ui 偏好
   ========================================================================== */
test('ui：脏值回退默认、未知键保留、lab.missing 归一为字符串数组', async () => {
  const { store } = await loadStore(fakeStorage({
    [KEY.ui]: {
      density: ['grid'],
      nameLang: 123,
      showAssets: 'yes',
      listCols: '5',
      theme: 'neon',
      'lab.missing': [1, 'm1', null, 'm1'],
      'lab.calc': 'broken',
      futurePref: { a: 1 },
    },
  }), 'ui-dirty');

  assert.equal(store.ui.get('density'), 'grid');
  assert.equal(store.ui.get('nameLang'), 'zh');
  assert.equal(store.ui.get('showAssets'), false);
  assert.equal(store.ui.get('listCols'), 5);
  assert.equal(store.ui.theme(), 'auto');
  assert.deepEqual(store.ui.get('lab.missing'), ['m1']);
  assert.equal(store.ui.get('lab.calc'), undefined);
  assert.deepEqual(store.ui.get('futurePref'), { a: 1 }, '未知偏好键保留以兼容未来');

  const { store: arrayCase } = await loadStore(fakeStorage({ [KEY.ui]: '[1,2]' }), 'ui-array');
  assert.equal(arrayCase.ui.theme(), 'auto');
  assert.equal(arrayCase.ui.get('density'), 'grid');

  const { store: valid } = await loadStore(fakeStorage({
    [KEY.ui]: { density: 'list', nameLang: 'en', showAssets: true, listCols: 3, theme: 'dark', futurePref: 1 },
  }), 'ui-valid');
  assert.equal(valid.ui.get('density'), 'list');
  assert.equal(valid.ui.get('nameLang'), 'en');
  assert.equal(valid.ui.get('showAssets'), true);
  assert.equal(valid.ui.get('listCols'), 3);
  assert.equal(valid.ui.theme(), 'dark');
  assert.equal(valid.ui.get('futurePref'), 1);
});

/* =============================================================================
   5 · 旧档迁移
   ========================================================================== */
test('迁移：新键缺失时从旧 build 迁移（含旧槽位别名 primary/secondary/helmet）', async () => {
  const storage = fakeStorage({
    [LEGACY.build]: {
      name: '旧配装',
      slots: { primary: 'lg', secondary: 'hg', helmet: 'h', melee: 'm', ring1: 'r' },
      traits: ['t1', 2, 't2'],
      updatedAt: 1234,
    },
  });
  const { store } = await loadStore(storage, 'migrate-build');

  assert.equal(store.state.build.name, '旧配装');
  assert.equal(store.build.get('longGun'), 'lg');
  assert.equal(store.build.get('handGun'), 'hg');
  assert.equal(store.build.get('head'), 'h');
  assert.equal(store.build.get('melee'), 'm');
  assert.equal(store.build.get('ring1'), 'r');
  assert.deepEqual(store.build.traits(), ['t1', 't2']);
  assert.equal(store.state.build.updated, 1234);
  assert.equal(store.build.filled(), 5);
  const persisted = JSON.parse(storage.raw(KEY.build));
  assert.equal(persisted.slots.longGun, 'lg');
  assert.equal(persisted.slots.head, 'h');
});

test('迁移：有效新数据绝不被旧档覆盖', async () => {
  const storage = fakeStorage({
    [KEY.build]: { name: '新配装', slots: { longGun: 'new-lg' }, traits: ['new-t'] },
    [LEGACY.build]: { name: '旧配装', slots: { primary: 'old-lg' } },
  });
  const rawBefore = storage.raw(KEY.build);
  const { store } = await loadStore(storage, 'migrate-guard');

  assert.equal(store.state.build.name, '新配装');
  assert.equal(store.build.get('longGun'), 'new-lg');
  assert.equal(storage.raw(KEY.build), rawBefore, '迁移不得重写有效新数据');
});

test('迁移：迁移后再次加载读取新数据，不重复迁移、不覆盖后续修改', async () => {
  const storage = fakeStorage({ [LEGACY.build]: { slots: { primary: 'old-lg' } } });
  const { store } = await loadStore(storage, 'migrate-once');
  assert.equal(store.build.get('longGun'), 'old-lg');

  store.build.set('longGun', 'new-lg');
  const { store: reloaded } = await loadStore(storage, 'migrate-once-reload');
  assert.equal(reloaded.build.get('longGun'), 'new-lg');
  assert.equal(JSON.parse(storage.raw(KEY.build)).slots.longGun, 'new-lg');
});

test('迁移：新键损坏 / 归一无内容时才迁移', async () => {
  for (const [label, raw] of [['坏 JSON', '{"slots":'], ['归一为空', '{"slots":{"bogus":"x"}}']]) {
    const storage = fakeStorage({
      [KEY.build]: raw,
      [LEGACY.build]: { slots: { primary: 'legacy-lg' } },
    });
    const { store } = await loadStore(storage, `migrate-${label}`);
    assert.equal(store.build.get('longGun'), 'legacy-lg', `${label} 时应从旧档迁移`);
  }
});

test('迁移：旧档非法时不写回、不抛错', async () => {
  const storage = fakeStorage({
    [LEGACY.build]: 'not-json',
    [LEGACY.saved]: '{"x":1}',
    [LEGACY.ui]: '"bad"',
  });
  const { store } = await loadStore(storage, 'migrate-legacy-bad');
  assert.equal(store.build.filled(), 0);
  assert.deepEqual(storage.keys().sort(), [LEGACY.build, LEGACY.saved, LEGACY.ui].sort());
});

test('迁移：写回失败 emit storage-error（初始化期事件在订阅后补投）', async () => {
  const storage = fakeStorage({ [LEGACY.build]: { slots: { primary: 'lg' } } });
  storage.ctl.failSet = (k) => k === KEY.build;
  const { store } = await loadStore(storage, 'migrate-write-fail');

  assert.equal(store.build.get('longGun'), 'lg', '内存状态仍完成迁移（下次启动可重试）');
  assert.equal(storage.raw(KEY.build), null);

  const events = [];
  store.on('storage-error', (payload) => events.push(payload));
  await delay(0);
  assert.equal(events.length, 1);
  assert.equal(events[0].key, KEY.build);
  assert.equal(events[0].op, 'set');
  assert.ok(events[0].error instanceof Error);
});

test('迁移：多处写回失败在订阅后逐条补投', async () => {
  const storage = fakeStorage({
    [LEGACY.build]: { slots: { primary: 'lg' } },
    [LEGACY.saved]: [{ id: 'old1', name: '旧存档', savedAt: 1, slots: { primary: 'p1' } }],
    [LEGACY.ui]: { viewMode: 'list' },
  });
  storage.ctl.failSet = () => true;
  const { store } = await loadStore(storage, 'migrate-all-fail');
  const events = [];
  store.on('storage-error', (payload) => events.push(payload));
  await delay(0);
  assert.deepEqual(events.map((e) => e.key), [KEY.build, KEY.saved, KEY.ui], '三条迁移写回失败都要可见');
  assert.ok(events.every((e) => e.op === 'set' && e.error instanceof Error));
});

test('迁移：saved 旧档记录转新格式，新档可用时不迁移', async () => {
  const legacySaved = [
    { id: 'old1', name: '旧存档', savedAt: 1000, slots: { primary: 'p1', ring2: 'r2' }, traits: ['t1'] },
    { name: '无 id 旧档', savedAt: 2000, slots: { helmet: 'h1' } },
    'bad',
  ];
  const { store } = await loadStore(fakeStorage({ [LEGACY.saved]: legacySaved }), 'migrate-saved');
  const list = store.saved.list();
  assert.equal(list.length, 2);
  assert.equal(list[0].id, 'old1');
  assert.equal(list[0].name, '旧存档');
  assert.equal(list[0].ts, 1000);
  assert.equal(list[0].build.slots.longGun, 'p1');
  assert.equal(list[0].build.slots.ring2, 'r2');
  assert.deepEqual(list[0].build.traits, ['t1']);
  assert.ok(typeof list[1].id === 'string' && list[1].id.length > 0, '无 id 旧档生成可用 id');
  assert.equal(list[1].build.slots.head, 'h1');

  const storage2 = fakeStorage({
    [KEY.saved]: [{ id: 'new1', name: '新存档', ts: 1, build: {} }],
    [LEGACY.saved]: [{ id: 'old1', name: '旧存档', savedAt: 1, slots: { longGun: 'lg' } }],
  });
  const rawBefore = storage2.raw(KEY.saved);
  const { store: guarded } = await loadStore(storage2, 'migrate-saved-guard');
  assert.deepEqual(guarded.saved.list().map((rec) => rec.id), ['new1']);
  assert.equal(storage2.raw(KEY.saved), rawBefore, '有效新 saved 不被覆盖');
});

test('迁移：ui 旧档映射 density/nameLang/showAssets，新档可用时不迁移', async () => {
  const { store } = await loadStore(fakeStorage({
    [LEGACY.ui]: { viewMode: 'list', lang: 'en', showAssets: true },
  }), 'migrate-ui');
  assert.equal(store.ui.get('density'), 'list');
  assert.equal(store.ui.get('nameLang'), 'en');
  assert.equal(store.ui.get('showAssets'), true);
  assert.equal(store.ui.theme(), 'auto');

  const storage2 = fakeStorage({
    [KEY.ui]: { theme: 'dark' },
    [LEGACY.ui]: { viewMode: 'list' },
  });
  const rawBefore = storage2.raw(KEY.ui);
  const { store: guarded } = await loadStore(storage2, 'migrate-ui-guard');
  assert.equal(guarded.ui.theme(), 'dark');
  assert.equal(guarded.ui.get('density'), 'grid');
  assert.equal(storage2.raw(KEY.ui), rawBefore, '有效新 ui 不被覆盖');
});

/* =============================================================================
   6 · 写失败可见（storage-error 事件契约）
   ========================================================================== */
test('storage-error：写失败 emit 且按 key 节流，成功写后恢复即时上报', async () => {
  const storage = fakeStorage({});
  const { store } = await loadStore(storage, 'storage-error');
  const events = [];
  store.on('storage-error', (payload) => events.push(payload));

  storage.ctl.failSet = () => true;
  assert.equal(store.toggleOwned('a'), true, '内存状态照常更新');
  assert.equal(events.length, 1);
  assert.equal(events[0].key, KEY.owned);
  assert.equal(events[0].op, 'set');
  assert.ok(events[0].error instanceof Error);
  assert.equal(typeof events[0].at, 'number');
  assert.equal(events[0].suppressed, 0);

  assert.equal(store.toggleOwned('b'), true);
  assert.equal(events.length, 1, '同一 key 节流窗口内不重复刷屏');

  const realNow = Date.now;
  Date.now = () => realNow() + 6000;
  try {
    assert.equal(store.toggleOwned('c'), true);
  } finally {
    Date.now = realNow;
  }
  assert.equal(events.length, 2);
  assert.ok(events[1].suppressed >= 1, '窗口结束后的首个事件带上被抑制次数');

  storage.ctl.failSet = null;
  store.toggleOwned('d');
  assert.equal(events.length, 2);

  storage.ctl.failSet = () => true;
  store.toggleOwned('e');
  assert.equal(events.length, 3, '成功写清空节流状态，再次失败立即上报');
});

test('storage-error：通配监听收到 (evt, payload)', async () => {
  const storage = fakeStorage({});
  const { store } = await loadStore(storage, 'storage-wild');
  const seen = [];
  store.on('*', (evt, payload) => seen.push([evt, payload]));
  storage.ctl.failSet = () => true;
  store.toggleFav('f');
  const hit = seen.find(([evt]) => evt === 'storage-error');
  assert.ok(hit, '通配监听应收到 storage-error');
  assert.equal(hit[1].key, KEY.fav);
  assert.equal(hit[1].op, 'set');
});

test('resetAll：删除失败时内存状态仍整体清空、失败逐 key 可见', async () => {
  const storage = fakeStorage({
    [KEY.owned]: ['a'],
    [KEY.ui]: { theme: 'dark' },
    [LEGACY.build]: { slots: { primary: 'lg' } },
  });
  const { store } = await loadStore(storage, 'reset-fail');
  const events = [];
  store.on('storage-error', (payload) => events.push(payload));

  storage.ctl.failRemove = () => true;
  assert.equal(store.resetAll(), false, '有删除失败时返回 false');
  assert.equal(store.ownedCount(), 0);
  assert.equal(store.favCount(), 0);
  assert.equal(store.build.filled(), 0);
  assert.equal(store.ui.theme(), 'auto');
  const expectedKeys = [...Object.values(KEY), ...Object.values(LEGACY)].sort();
  assert.equal(events.length, expectedKeys.length, '每个删除失败的 key 都要可见');
  assert.deepEqual([...new Set(events.map((e) => e.key))].sort(), expectedKeys);
});

test('resetAll：成功时连旧档一起清理，重新加载不会“复活”旧数据', async () => {
  const storage = fakeStorage({
    [KEY.owned]: ['a'],
    [KEY.saved]: [{ id: 's1', name: 'x', ts: 1, build: {} }],
    [LEGACY.build]: { slots: { primary: 'lg' } },
  });
  const { store } = await loadStore(storage, 'reset-ok');
  assert.equal(store.resetAll(), true);
  assert.deepEqual(storage.keys(), [], '包括 LEGACY 键在内全部清理');
  assert.equal(store.ownedCount(), 0);
  assert.equal(store.saved.list().length, 0);

  const { store: reloaded } = await loadStore(storage, 'reset-ok-reload');
  assert.equal(reloaded.ownedCount(), 0);
  assert.equal(reloaded.build.filled(), 0);
  assert.equal(reloaded.saved.count(), 0);
});

/* =============================================================================
   7 · lab/state.js 读取端防御（共享未加 query 的 store 实例）
   ========================================================================== */
async function sharedStore() {
  if (!globalThis.__relicSharedStore) {
    globalThis.localStorage = fakeStorage();
    const mod = await import(STORE_URL.href);
    globalThis.__relicSharedStore = mod.store;
  }
  return globalThis.__relicSharedStore;
}

async function loadLabState(caseName) {
  const store = await sharedStore();
  const mod = await import(`${LAB_STATE_URL.href}?case=${encodeURIComponent(caseName)}-${++caseSeq}`);
  return { store, S: mod };
}

test('lab/state：meta() 非对象不抛错，按空对象处理', async () => {
  const { store, S } = await loadLabState('lab-meta-nonobj');
  const original = store.build.meta;
  try {
    for (const bad of ['garbage', null, 42, [1, 2], undefined]) {
      store.build.meta = () => bad;
      assert.deepEqual(S.meta(), {}, `meta() 遇到 ${String(bad)} 应按空对象处理`);
      assert.deepEqual(S.traitLevels(), {});
      assert.deepEqual(S.fragments(), []);
      assert.deepEqual(S.consumables(), []);
      assert.deepEqual(S.seedPerks(), []);
      assert.equal(S.scenarioId(), 'general');
      assert.equal(S.classTarget(), 'free');
      assert.equal(S.traitUsed(), 0);
    }
  } finally {
    store.build.meta = original;
  }
});

test('lab/state：traitLevels 只保留数值并 clamp 0~TRAIT_MAX_LEVEL，其余字段读端防御', async () => {
  const { store, S } = await loadLabState('lab-meta-dirty');
  const original = store.build.meta;
  try {
    store.build.meta = () => ({
      traitLevels: { a: '7', b: 12, c: -3, d: 7.6, e: NaN, f: Infinity, g: 5, h: null },
      fragments: ['f1', 2, null, 'f1'],
      consumables: 'not-array',
      seedPerks: { x: 1 },
      scenario: 42,
      classTarget: {},
      seedProfile: 7,
      profile: [],
      future: { keep: 1 },
    });

    assert.deepEqual(S.traitLevels(), { b: 10, d: 8, g: 5 });
    assert.deepEqual(S.meta().traitLevels, { b: 10, d: 8, g: 5 });
    assert.equal(S.traitUsed(), 3);
    assert.deepEqual(S.fragments(), ['f1']);
    assert.deepEqual(S.consumables(), []);
    assert.deepEqual(S.seedPerks(), []);
    assert.equal(S.scenarioId(), 'general');
    assert.equal(S.classTarget(), 'free');
    assert.equal(S.seedProfile(), null);
    assert.deepEqual(S.meta().future, { keep: 1 }, '未知 meta 字段保留');
  } finally {
    store.build.meta = original;
  }
});

test('lab/state：脏 meta 下 setTraitLevel 超限 clamp 0~10、fillTraits 防御脏入参', async () => {
  const { store, S } = await loadLabState('lab-set-trait');
  store.build.setMeta({ traitLevels: {}, fragments: [], consumables: [], seedPerks: [] });

  assert.deepEqual(S.setTraitLevel('t1', 99), { ok: true, level: 10 });
  assert.deepEqual(S.setTraitLevel('t1', -5), { ok: true, level: 0 });
  assert.equal(S.traitLevels().t1, undefined);
  assert.equal(S.setTraitLevel('', 3).ok, false);
  assert.equal(S.setTraitLevel(42, 3).ok, false);

  S.fillTraits([...Array.from({ length: 12 }, (_, i) => ({ id: `tr${i}` })), null, 'str']);
  assert.equal(Object.keys(S.traitLevels()).length, 10);
  assert.ok(Object.values(S.traitLevels()).every((level) => level === 10));
});
