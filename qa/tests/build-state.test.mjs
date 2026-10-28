/* =============================================================================
   qa/tests/build-state.test.mjs — 配装状态与拥有/收藏的隔离契约（node --test）
   运行：node --test "qa/tests/*.test.mjs"

   契约（P1-2）：五份持久化数据（owned / fav / build / saved / ui）互不串扰——
     · 写 build（槽位 / 特性 / 模组 / meta）不得改 owned/fav 的持久化、状态与事件；
     · toggle owned/fav 不得改 build；build.clear() 不得删 owned/fav/saved；
     · 事件订阅按 key 分开：订阅 'build' 不会被 owned 变化触发，反之亦然；
     · 任一 key 是脏数据时，其他 key 的合法数据保持原样（读取不写回、不整份清空）。
   做法：注入假 localStorage + ?case=N 动态 import 取独立 store 实例（同 store.test.mjs）。
   ========================================================================== */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';

const STORE_URL = new URL('../../js/core/store.js', import.meta.url);

/** 用例结束后还原 globalThis.localStorage（默认按文件进程隔离；--test-isolation=none 时也不污染其他文件） */
const ORIGINAL_LOCAL_STORAGE = globalThis.localStorage;
after(() => {
  if (ORIGINAL_LOCAL_STORAGE === undefined) delete globalThis.localStorage;
  else globalThis.localStorage = ORIGINAL_LOCAL_STORAGE;
});

const KEY = {
  owned: 'r2.v2.owned',
  fav: 'r2.v2.fav',
  build: 'r2.v2.build',
  saved: 'r2.v2.saved',
  ui: 'r2.v2.ui',
};

/** 五份 key 的合法基线（各项都有可断言内容，便于检查「另一个 key 没被动过」） */
const BASELINE = {
  owned: ['o1', 'o2'],
  fav: ['f1'],
  build: {
    name: '基线配装',
    slots: { longGun: 'lg0', head: 'h0' },
    traits: ['t0'],
    mods: { longGun: 'm0', handGun: null },
    meta: { scenario: 'boss' },
  },
  saved: [{ id: 's1', name: '存档一', ts: 1, build: { slots: { handGun: 'hg0' }, traits: ['st0'] } }],
  ui: { theme: 'dark', density: 'list', nameLang: 'en' },
};

/** 各 key 的脏数据形态（合法 JSON 但类型/结构错误） */
const DIRTY = {
  owned: '{"a":1}',
  fav: '123',
  build: '{"slots":"x","mods":null,"traits":"y","meta":"z"}',
  saved: '[{"id":1},null]',
  ui: '[1,2,3]',
};

let caseSeq = 0;

function fakeStorage(seed = {}) {
  const map = new Map();
  for (const [k, v] of Object.entries(seed)) {
    if (v === undefined) continue;
    map.set(k, typeof v === 'string' ? v : JSON.stringify(v));
  }
  return {
    getItem(k) { return map.has(k) ? map.get(k) : null; },
    setItem(k, v) { map.set(k, String(v)); },
    removeItem(k) { map.delete(k); },
    clear() { map.clear(); },
    key(i) { return [...map.keys()][i] ?? null; },
    get length() { return map.size; },
    raw(k) { return map.has(k) ? map.get(k) : null; },
  };
}

async function loadStore(storage, caseName) {
  globalThis.localStorage = storage;
  const mod = await import(`${STORE_URL.href}?case=${encodeURIComponent(caseName)}-${++caseSeq}`);
  return { mod, store: mod.store };
}

/** 断言除 skipKey 外的 key 都保持基线语义 */
function assertOtherKeysBaseline(store, skipKey) {
  if (skipKey !== 'owned') {
    assert.deepEqual([...store.state.owned], BASELINE.owned);
    assert.equal(store.isOwned('o1'), true);
  }
  if (skipKey !== 'fav') {
    assert.deepEqual([...store.state.fav], BASELINE.fav);
    assert.equal(store.isFav('f1'), true);
  }
  if (skipKey !== 'build') {
    assert.equal(store.build.get('longGun'), 'lg0');
    assert.equal(store.build.get('head'), 'h0');
    assert.deepEqual(store.build.traits(), ['t0']);
    assert.deepEqual(store.build.mods(), { longGun: 'm0', handGun: null });
    assert.deepEqual(store.build.meta(), { scenario: 'boss', traitLevels: { t0: 1 } });
    assert.equal(store.state.build.name, '基线配装');
  }
  if (skipKey !== 'saved') {
    const list = store.saved.list();
    assert.equal(list.length, 1);
    assert.equal(list[0].id, 's1');
    assert.equal(list[0].name, '存档一');
    assert.equal(list[0].build.slots.handGun, 'hg0');
    assert.deepEqual(list[0].build.traits, [], 'traits 已迁移为 traitLevels');
    assert.deepEqual(list[0].build.meta.traitLevels, { st0: 1 });
  }
  if (skipKey !== 'ui') {
    assert.equal(store.ui.theme(), 'dark');
    assert.equal(store.ui.get('density'), 'list');
    assert.equal(store.ui.get('nameLang'), 'en');
  }
}

/** 断言脏 key 被归一为安全默认（不抛错、不残留非法值） */
function assertDirtyNormalized(store, dirtyKey) {
  if (dirtyKey === 'owned') assert.equal(store.ownedCount(), 0);
  if (dirtyKey === 'fav') assert.equal(store.favCount(), 0);
  if (dirtyKey === 'build') assert.equal(store.build.filled(), 0);
  if (dirtyKey === 'saved') assert.equal(store.saved.count(), 0);
  if (dirtyKey === 'ui') assert.equal(store.ui.theme(), 'auto');
}

/* =============================================================================
   1 · 写 build 不碰 owned / fav
   ========================================================================== */
test('隔离：设置槽位/特性/模组/meta 不写 owned/fav，也不触发它们的事件', async () => {
  const seed = {
    [KEY.owned]: BASELINE.owned,
    [KEY.fav]: BASELINE.fav,
    [KEY.build]: BASELINE.build,
  };
  const storage = fakeStorage(seed);
  const ownedRaw = storage.raw(KEY.owned);
  const favRaw = storage.raw(KEY.fav);
  const { store } = await loadStore(storage, 'build-to-owned');

  const events = { owned: 0, fav: 0, build: 0 };
  store.on('owned', () => { events.owned += 1; });
  store.on('fav', () => { events.fav += 1; });
  store.on('build', () => { events.build += 1; });

  store.build.set('longGun', 'lg1');
  store.build.setTraits(['t1', 't2']);
  store.build.setMod('longGun', 'mod1');
  store.build.setMeta({ scenario: 'general' });

  assert.ok(events.build >= 4, 'build 事件应逐次触发');
  assert.equal(events.owned, 0, "订阅 'owned' 不应被 build 变更触发");
  assert.equal(events.fav, 0);
  assert.deepEqual([...store.state.owned], BASELINE.owned, 'owned 内存状态不变');
  assert.deepEqual([...store.state.fav], BASELINE.fav);
  assert.equal(storage.raw(KEY.owned), ownedRaw, 'owned 持久化字节不变');
  assert.equal(storage.raw(KEY.fav), favRaw, 'fav 持久化字节不变');

  const persistedBuild = JSON.parse(storage.raw(KEY.build));
  assert.equal(persistedBuild.slots.longGun, 'lg1');
  assert.deepEqual(persistedBuild.traits, [], 'traits 不再持久化');
  assert.deepEqual(persistedBuild.meta.traitLevels, { t1: 1, t2: 1 });
  assert.equal(persistedBuild.mods.longGun, 'mod1');
});

/* =============================================================================
   2 · 写 owned / fav 不碰 build
   ========================================================================== */
test('隔离：toggle owned/fav 不改 build 的内存状态、持久化与事件', async () => {
  const storage = fakeStorage({ [KEY.build]: BASELINE.build });
  const buildRaw = storage.raw(KEY.build);
  const { store } = await loadStore(storage, 'owned-to-build');

  const ownSlots = store.build.slots();
  const ownTraits = store.build.traits();
  const ownMods = store.build.mods();
  const ownMeta = store.build.meta();
  const events = { owned: 0, fav: 0, build: 0 };
  store.on('owned', () => { events.owned += 1; });
  store.on('fav', () => { events.fav += 1; });
  store.on('build', () => { events.build += 1; });

  assert.equal(store.toggleOwned('x'), true);
  assert.equal(store.toggleFav('y'), true);
  assert.equal(store.setOwned('z', true), true);

  assert.equal(events.owned, 2);
  assert.equal(events.fav, 1);
  assert.equal(events.build, 0, "订阅 'build' 不应被 owned/fav 变更触发");
  assert.equal(storage.raw(KEY.build), buildRaw, 'build 持久化字节不变');
  assert.deepEqual(store.build.slots(), ownSlots);
  assert.deepEqual(store.build.traits(), ownTraits);
  assert.deepEqual(store.build.mods(), ownMods);
  assert.deepEqual(store.build.meta(), ownMeta);
  assert.equal(store.state.build.name, '基线配装');
});

/* =============================================================================
   3 · build.clear() 只清 build
   ========================================================================== */
test('隔离：build.clear() 只清配装，不删 owned/fav/saved', async () => {
  const seed = {
    [KEY.owned]: BASELINE.owned,
    [KEY.fav]: BASELINE.fav,
    [KEY.build]: BASELINE.build,
    [KEY.saved]: BASELINE.saved,
  };
  const storage = fakeStorage(seed);
  const raw = {
    owned: storage.raw(KEY.owned),
    fav: storage.raw(KEY.fav),
    saved: storage.raw(KEY.saved),
  };
  const { store } = await loadStore(storage, 'build-clear');

  let buildEvents = 0;
  store.on('build', () => { buildEvents += 1; });
  store.build.clear();

  assert.equal(buildEvents, 1);
  assert.equal(store.build.filled(), 0, '槽位清空');
  assert.deepEqual(store.build.traits(), []);
  assert.equal(store.state.build.name, '基线配装', 'clear 保留配装名（既有语义）');
  assert.equal(store.ownedCount(), BASELINE.owned.length);
  assert.equal(store.favCount(), BASELINE.fav.length);
  assert.equal(store.saved.count(), 1, 'saved 不被清空');
  assert.equal(store.saved.list()[0].build.slots.handGun, 'hg0');
  assert.equal(storage.raw(KEY.owned), raw.owned);
  assert.equal(storage.raw(KEY.fav), raw.fav);
  assert.equal(storage.raw(KEY.saved), raw.saved);
});

/* =============================================================================
   4 · 事件订阅不串
   ========================================================================== */
test('隔离：事件订阅按 key 分开，互不串扰；可退订', async () => {
  const storage = fakeStorage({});
  const { store } = await loadStore(storage, 'events-isolation');
  const got = { owned: [], fav: [], build: [], saved: [] };
  for (const type of Object.keys(got)) store.on(type, (payload) => got[type].push(payload));

  store.toggleOwned('o1');
  assert.equal(got.owned.length, 1);
  assert.equal(got.owned[0].id, 'o1');
  assert.equal(got.owned[0].owned, true);
  assert.deepEqual([got.fav.length, got.build.length, got.saved.length], [0, 0, 0]);

  store.toggleFav('f1');
  assert.equal(got.fav.length, 1);
  assert.equal(got.owned.length, 1, 'owned 订阅不因 fav 触发');
  assert.equal(got.build.length, 0);

  store.build.set('longGun', 'lg');
  assert.equal(got.build.length, 1);
  assert.equal(got.build[0].slot, 'longGun');
  assert.equal(got.build[0].id, 'lg');
  assert.deepEqual([got.owned.length, got.fav.length, got.saved.length], [1, 1, 0]);

  store.saved.save('隔离检查');
  assert.equal(got.saved.length, 1);
  assert.equal(got.saved[0].action, 'save');
  assert.equal(got.build.length, 1, 'saved 订阅不因保存存档触发 build 事件');

  let extraBuild = 0;
  const offBuild = store.on('build', () => { extraBuild += 1; });
  offBuild();
  store.build.set('longGun', null);
  assert.equal(extraBuild, 0, '退订后不再收到 build 事件');
  assert.equal(got.build.length, 2, '未退订的原订阅仍收到 build 事件');
});

/* =============================================================================
   5 · 任一 key 脏不影响其他 key 的合法数据
   ========================================================================== */
test('隔离：任一 key 脏数据不影响其他 key 的合法数据与持久化字节', async () => {
  for (const dirtyKey of Object.keys(DIRTY)) {
    const seed = {};
    for (const [k, value] of Object.entries(BASELINE)) {
      seed[KEY[k]] = k === dirtyKey ? DIRTY[dirtyKey] : value;
    }
    const storage = fakeStorage(seed);
    const rawBefore = Object.fromEntries(Object.keys(KEY).map((k) => [k, storage.raw(KEY[k])]));
    const { store } = await loadStore(storage, `dirty-${dirtyKey}`);

    assertDirtyNormalized(store, dirtyKey);
    assertOtherKeysBaseline(store, dirtyKey);
    for (const [k, rawValue] of Object.entries(rawBefore)) {
      assert.equal(storage.raw(KEY[k]), rawValue, `${dirtyKey} 脏时 ${k} 的原始字节不得被改写`);
    }

    // 恢复写操作也不会顺手覆盖其他 key
    store.toggleOwned('after-dirty');
    for (const [k, rawValue] of Object.entries(rawBefore)) {
      if (k === 'owned') continue; // 本次写操作只允许改 owned
      assert.equal(storage.raw(KEY[k]), rawValue, `${dirtyKey} 脏时一次 owned 写入不应波及其他 key`);
    }
    const ownedAfter = JSON.parse(storage.raw(KEY.owned));
    assert.ok(Array.isArray(ownedAfter) && ownedAfter.includes('after-dirty'), 'owned 被写成合法数组');
  }
});

/* =============================================================================
   6 · saved 操作只动自己的边界
   ========================================================================== */
test('隔离：saved.load 只恢复 build；save 不写 build/owned/fav', async () => {
  const storage = fakeStorage({
    [KEY.owned]: BASELINE.owned,
    [KEY.fav]: BASELINE.fav,
    [KEY.build]: BASELINE.build,
    [KEY.saved]: BASELINE.saved,
  });
  const raw = {
    owned: storage.raw(KEY.owned),
    fav: storage.raw(KEY.fav),
    saved: storage.raw(KEY.saved),
  };
  const { store } = await loadStore(storage, 'saved-boundary');

  // 保存当前配装：只写 saved key
  store.saved.save('新存档');
  const savedAfterSave = storage.raw(KEY.saved);
  assert.equal(store.saved.count(), 2);
  assert.equal(storage.raw(KEY.owned), raw.owned);
  assert.equal(storage.raw(KEY.fav), raw.fav);
  assert.equal(JSON.parse(storage.raw(KEY.build)).slots.longGun, 'lg0', 'save 不改当前 build 持久化');

  // 载入旧存档：只写 build key
  assert.equal(store.saved.load('s1'), true);
  assert.equal(store.build.get('handGun'), 'hg0');
  assert.deepEqual(store.build.traits(), ['st0']);
  assert.equal(store.build.get('longGun'), null);
  assert.equal(storage.raw(KEY.owned), raw.owned);
  assert.equal(storage.raw(KEY.fav), raw.fav);
  assert.equal(storage.raw(KEY.saved), savedAfterSave, 'load 不再写 saved');
  assert.equal(store.saved.list().length, 2);
});

/* =============================================================================
   7 · ui 偏好写不碰 build / owned / fav
   ========================================================================== */
test('隔离：ui 偏好写入不影响 build/owned/fav', async () => {
  const storage = fakeStorage({
    [KEY.owned]: BASELINE.owned,
    [KEY.fav]: BASELINE.fav,
    [KEY.build]: BASELINE.build,
    [KEY.ui]: BASELINE.ui,
  });
  const raw = {
    owned: storage.raw(KEY.owned),
    fav: storage.raw(KEY.fav),
    build: storage.raw(KEY.build),
  };
  const { store } = await loadStore(storage, 'ui-boundary');

  let buildEvents = 0;
  store.on('build', () => { buildEvents += 1; });
  store.ui.setTheme('light');
  store.ui.set('density', 'grid');

  assert.equal(store.ui.theme(), 'light');
  assert.equal(store.ui.get('density'), 'grid');
  assert.equal(buildEvents, 0);
  assert.equal(storage.raw(KEY.owned), raw.owned);
  assert.equal(storage.raw(KEY.fav), raw.fav);
  assert.equal(storage.raw(KEY.build), raw.build);
});
