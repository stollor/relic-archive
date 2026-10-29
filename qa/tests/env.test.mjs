/* =============================================================================
   qa/tests/env.test.mjs — 环境自适应纯逻辑回归（node:test，零依赖，无浏览器）

   覆盖：
     · resolveChrome：CHROME_PATH/CHROME_BIN → 平台候选 → where/which 的完整优先级
     · 全失败错误：ChromeNotFoundError 含搜索清单 + CHROME_PATH 设置建议
     · win32 / darwin / linux 三平台默认候选
     · prefixOf / pageUrl：根部署、子路径部署与边界
     · deriveRoutes：可被 node import，纯数据推导（注入 fetch，不联网）
     · 静态回归守卫：shot.js/interactions.js 不再硬编码 Chrome 路径或页面根绝对路径
   运行：node --test "qa/tests/*.test.mjs"
   ========================================================================== */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { resolveChrome, candidatesFor, ChromeNotFoundError } = require('../lib/cdp.js');
const { prefixOf, pageUrl } = require('../lib/base.js');

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../..');
const read = (rel) => fs.readFileSync(path.join(REPO, rel), 'utf8');
const win = path.win32;

/* ----------------------------- Chrome 探测 ----------------------------- */

test('resolveChrome：CHROME_PATH 命中（来源 CHROME_PATH，不再探测候选）', () => {
  const found = resolveChrome({
    env: { CHROME_PATH: 'C:\\Custom\\chrome.exe' },
    platform: 'win32',
    candidates: ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'],
    existsSync: (p) => p === 'C:\\Custom\\chrome.exe',
    which: () => { throw new Error('命中环境变量后不应执行 where/which'); },
  });
  assert.deepEqual(found, { path: 'C:\\Custom\\chrome.exe', source: 'CHROME_PATH' });
});

test('resolveChrome：CHROME_PATH 不存在时回退 CHROME_BIN', () => {
  const found = resolveChrome({
    env: { CHROME_PATH: 'C:\\Nope\\chrome.exe', CHROME_BIN: '/opt/chrome' },
    platform: 'linux',
    candidates: [],
    existsSync: (p) => p === '/opt/chrome',
    which: () => '',
  });
  assert.deepEqual(found, { path: '/opt/chrome', source: 'CHROME_BIN' });
});

test('resolveChrome：环境变量指向不存在的文件时继续回退到平台候选', () => {
  const found = resolveChrome({
    env: { CHROME_PATH: '/nope/chrome' },
    platform: 'linux',
    candidates: ['/nope/a', '/usr/bin/chromium'],
    existsSync: (p) => p === '/usr/bin/chromium',
    which: () => '',
  });
  assert.deepEqual(found, { path: '/usr/bin/chromium', source: 'candidates' });
});

test('resolveChrome：候选按顺序取第一个存在的（先命中先生效）', () => {
  const order = [];
  const found = resolveChrome({
    env: {},
    platform: 'linux',
    candidates: ['/a/chrome', '/b/chrome', '/c/chrome'],
    existsSync: (p) => { order.push(p); return p === '/b/chrome' || p === '/c/chrome'; },
    which: () => '',
  });
  assert.deepEqual(found, { path: '/b/chrome', source: 'candidates' });
  assert.deepEqual(order, ['/a/chrome', '/b/chrome'], '应只探测到首个存在项为止');
});

test('resolveChrome：全失败抛 ChromeNotFoundError，含搜索清单与 CHROME_PATH 建议', () => {
  assert.throws(
    () => resolveChrome({
      env: { CHROME_PATH: '/missing/chrome' },
      platform: 'linux',
      candidates: ['/missing/候选'],
      existsSync: () => false,
      which: () => '',
    }),
    (err) => {
      assert.ok(err instanceof ChromeNotFoundError, '应抛 ChromeNotFoundError');
      assert.equal(err.name, 'ChromeNotFoundError');
      assert.equal(err.code, 'CHROME_NOT_FOUND');
      assert.match(err.message, /找不到可用的 Chrome/);
      assert.match(err.message, /设置环境变量 CHROME_PATH/);
      assert.match(err.message, /\/missing\/candidate|\/missing\/候选/);
      assert.ok(err.searchPaths.includes('/missing/chrome'), '搜索清单应含尝试过的 CHROME_PATH');
      assert.ok(err.searchPaths.includes('/missing/候选'), '搜索清单应含候选路径');
      return true;
    },
  );
});

test('resolveChrome：Windows 候选全无 → where 兜底（source=where）', () => {
  const calls = [];
  const found = resolveChrome({
    env: {},
    platform: 'win32',
    candidates: [],
    existsSync: () => false,
    which: (cmd, name) => {
      calls.push([cmd, name]);
      return name === 'chrome.exe' ? 'C:\\Somewhere\\chrome.exe\r\nC:\\Other\\chrome.exe\r\n' : '';
    },
  });
  assert.deepEqual(found, { path: 'C:\\Somewhere\\chrome.exe', source: 'where' });
  assert.equal(calls[0][0], 'where');
  assert.equal(calls[0][1], 'chrome.exe');
});

test('resolveChrome：macOS/Linux 候选全无 → which 兜底（source=which）', () => {
  const seen = [];
  const found = resolveChrome({
    env: {},
    platform: 'linux',
    candidates: [],
    existsSync: () => false,
    which: (cmd, name) => {
      seen.push(`${cmd}:${name}`);
      return name === 'chromium' ? '/usr/bin/chromium\n' : '';
    },
  });
  assert.deepEqual(found, { path: '/usr/bin/chromium', source: 'which' });
  assert.ok(seen.every((s) => s.startsWith('which:')), `应使用 which：${seen.join(',')}`);
});

test('candidatesFor：win32 顺序 Program Files → Program Files(x86) → LocalAppData → Edge 兜底', () => {
  const env = { PROGRAMFILES: 'C:\\PF', 'PROGRAMFILES(X86)': 'C:\\PFx', LOCALAPPDATA: 'C:\\Local' };
  const list = candidatesFor('win32', env);
  assert.deepEqual(list.slice(0, 3), [
    win.join('C:\\PF', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    win.join('C:\\PFx', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    win.join('C:\\Local', 'Google', 'Chrome', 'Application', 'chrome.exe'),
  ]);
  assert.ok(list.some((p) => p.endsWith('msedge.exe')), '应包含 Edge 兜底');
  assert.ok(!list.includes('/usr/bin/google-chrome'), 'win32 不应包含 Linux 路径');
});

test('candidatesFor：win32 缺环境变量时用标准安装目录兜底', () => {
  const list = candidatesFor('win32', {});
  assert.ok(list.includes('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'));
  assert.ok(list.includes('C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'));
  assert.ok(list.includes('C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'));
});

test('candidatesFor：darwin 先 .app 再 /usr/bin；linux 为标准路径顺序', () => {
  const mac = candidatesFor('darwin', {});
  assert.equal(mac[0], '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
  assert.ok(mac.includes('/usr/bin/google-chrome'));
  assert.ok(mac.includes('/snap/bin/chromium'));

  const linux = candidatesFor('linux', {});
  assert.ok(linux.indexOf('/usr/bin/google-chrome') < linux.indexOf('/usr/bin/google-chrome-stable'), 'google-chrome 应先于 stable');
  assert.ok(linux.indexOf('/usr/bin/chromium') < linux.indexOf('/usr/bin/chromium-browser'));
  assert.ok(linux.includes('/snap/bin/chromium'));
  assert.ok(!linux.some((p) => p.startsWith('C:\\')), 'linux 不应包含 Windows 路径');
});

test('resolveChrome：平台注入 + 该平台默认候选可组合使用', () => {
  const local = win.join('C:\\Local', 'Google', 'Chrome', 'Application', 'chrome.exe');
  const env = { LOCALAPPDATA: 'C:\\Local' };
  const found = resolveChrome({
    env,
    platform: 'win32',
    candidates: candidatesFor('win32', env),
    existsSync: (p) => p === local,
  });
  assert.deepEqual(found, { path: local, source: 'candidates' });
});

/* --------------------------- 部署前缀 / URL --------------------------- */

test('prefixOf：根部署返回空串（含尾斜杠 / 空值）', () => {
  assert.equal(prefixOf('http://127.0.0.1:8777'), '');
  assert.equal(prefixOf('http://127.0.0.1:8777/'), '');
  assert.equal(prefixOf('http://127.0.0.1:8777//'), '');
  assert.equal(prefixOf(''), '');
  assert.equal(prefixOf(null), '');
});

test('prefixOf：子路径部署取无尾斜杠前缀（含 query/hash 与多层前缀）', () => {
  assert.equal(prefixOf('http://127.0.0.1:8793/relic-archive'), '/relic-archive');
  assert.equal(prefixOf('http://127.0.0.1:8793/relic-archive/'), '/relic-archive');
  assert.equal(prefixOf('http://127.0.0.1:8793/relic-archive/?a=1#x'), '/relic-archive');
  assert.equal(prefixOf('https://stollor.github.io/relic-archive/'), '/relic-archive');
  assert.equal(prefixOf('http://host/a/b/'), '/a/b');
});

test('prefixOf：非法地址抛 TypeError', () => {
  assert.throws(() => prefixOf('not a url'), /无效的站点地址/);
  assert.throws(() => prefixOf('127.0.0.1:8777/relic-archive'), TypeError);
});

test('pageUrl：根部署/子路径部署 + hash 规范化', () => {
  assert.equal(pageUrl('http://127.0.0.1:8777', '#/items'), 'http://127.0.0.1:8777/#/items');
  assert.equal(pageUrl('http://127.0.0.1:8777/', '#/items?x=1'), 'http://127.0.0.1:8777/#/items?x=1');
  assert.equal(
    pageUrl('http://127.0.0.1:8793/relic-archive', '#/lab?panel=calc'),
    'http://127.0.0.1:8793/relic-archive/#/lab?panel=calc',
  );
  assert.equal(
    pageUrl('http://127.0.0.1:8793/relic-archive/', '/items'),
    'http://127.0.0.1:8793/relic-archive/#/items',
  );
  assert.equal(pageUrl('http://host/relic-archive', 'items'), 'http://host/relic-archive/#/items');
});

test('pageUrl：空 hash/空 base 边界', () => {
  assert.equal(pageUrl('http://host/relic-archive', ''), 'http://host/relic-archive/');
  assert.equal(pageUrl('http://host/relic-archive', '#'), 'http://host/relic-archive/');
  assert.throws(() => pageUrl('', '#/items'), /base 不能为空/);
});

/* ------------------------- 路由表（可 node import） ------------------------- */

test('deriveRoutes：ESM 可 import，纯数据推导（注入 fetch，不联网）', async () => {
  const realFetch = globalThis.fetch;
  const requested = [];
  const jsonFor = (url) => {
    const u = String(url);
    if (u.includes('/data/codex/index.json')) return { articles: [{ id: 'a 1' }, { id: 'a2' }] };
    if (u.includes('/data/items.json')) return { items: [
      { id: 'Armor_Head_X', cat: 'armor' },
      { id: 'Weapon_One', cat: 'weapon' },
      { id: 'Trinket_One', cat: 'ring' },
    ] };
    if (u.includes('/data/builds.json')) return { builds: [{ key: 'k1' }, { key: 'k2' }] };
    throw new Error(`unexpected fetch: ${u}`);
  };
  globalThis.fetch = async (url) => {
    requested.push(String(url));
    return { json: async () => jsonFor(url) };
  };
  try {
    const mod = await import(pathToFileURL(path.join(REPO, 'qa/lib/routes.mjs')).href);
    assert.equal(typeof mod.deriveRoutes, 'function', 'routes.mjs 应导出 deriveRoutes');
    const routes = await mod.deriveRoutes('http://example.test/relic-archive/');
    // 18 条固定路由（14 + 实验室 v2 的 4 个新面板）+ codex 深链 + 2 条详情深链 + owned + builds + 2 套详情 + 404 = 26
    assert.equal(routes.length, 26, `路由数=${routes.length}`);
    assert.deepEqual(routes[0], { name: 'items', path: '#/items' });
    assert.deepEqual(routes[1], { name: 'items-sets', path: '#/items/sets' });
    assert.ok(requested.every((u) => u.startsWith('http://example.test/relic-archive/data/')), `数据请求应带部署前缀：${requested.join(',')}`);
    assert.ok(requested.every((u) => !u.includes('relic-archive//data')), '不应出现双斜杠');
    const names = routes.map((r) => r.name);
    for (const want of ['lab-recommend', 'lab-trinkets', 'lab-weapons', 'lab-traits', 'lab-fragments', 'lab-legacy-calc', 'codex-article', 'item-detail', 'item-detail-2', 'items-owned', 'builds', 'builds-k1', 'builds-k2', 'builds-404']) {
      assert.ok(names.includes(want), `缺少路由：${want}`);
    }
    const codexRoute = routes.find((r) => r.name === 'codex-article');
    assert.equal(codexRoute.path, '#/codex/a%201', 'CMS id 应 encodeURIComponent');
    const detail = routes.find((r) => r.name === 'item-detail');
    assert.ok(detail.waitFor && /#modal|#drawer/.test(detail.waitFor), '详情深链应带浮层 waitFor');
  } finally {
    globalThis.fetch = realFetch;
  }
});

/* --------------------------- 静态回归守卫 --------------------------- */

test('静态守卫：qa/shot.js 不再硬编码 Chrome 安装路径，改用探测 + --chrome', () => {
  const src = read('qa/shot.js');
  assert.doesNotMatch(src, /Google[\\/]+Chrome[\\/]+Application/i, 'shot.js 不应再硬编码 Chrome 安装路径');
  assert.doesNotMatch(src, /CHROME_DEFAULT/, 'shot.js 不应引用具体默认路径常量');
  assert.match(src, /--chrome/, 'shot.js 应提供 --chrome 选项');
  assert.match(src, /resolveChrome\(\)/, 'shot.js 应使用 resolveChrome() 自动探测');
  assert.match(src, /lib\/routes\.mjs/, 'shot.js 应从 lib/routes.mjs 取默认路由表');
  assert.doesNotMatch(src, /async function deriveRoutes/, '路由推导不应再内联在 shot.js');
});

test('静态守卫：qa/interactions.js 页面内不再使用根绝对路径', () => {
  const src = read('qa/interactions.js');
  assert.doesNotMatch(src, /import\('\/js\//, "interactions.js 不应再有 import('/js/…')");
  assert.doesNotMatch(src, /fetch\('\/data\//, "interactions.js 不应再有 fetch('/data/…')");
  assert.doesNotMatch(src, /fetch\('\/api\//, "interactions.js 不应再有 fetch('/api/…')");
  assert.match(src, /const PFX = prefixOf\(BASE\)/, 'interactions.js 应计算部署前缀 PFX');
  assert.match(src, /pageUrl\(BASE, hash\)/, 'interactions.js 应用 pageUrl 拼页面地址');
});

test('静态守卫：Chrome 探测集中在 qa/lib/cdp.js，launchChrome 默认走 resolveChrome', () => {
  const src = read('qa/lib/cdp.js');
  assert.match(src, /function resolveChrome\(/, 'cdp.js 应导出 resolveChrome 实现');
  assert.match(src, /class ChromeNotFoundError/, 'cdp.js 应定义 ChromeNotFoundError');
  assert.match(src, /chromePath \|\| resolveChrome\(\)\.path/, 'launchChrome 默认应调用 resolveChrome()');
  assert.match(src, /CHROME_PATH/, '错误提示应包含 CHROME_PATH 建议');
});
