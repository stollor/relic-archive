/* =============================================================================
   qa/tests/router.test.mjs — core/router.js 纯函数 + 应用壳回退契约（node --test）
   运行：node --test "qa/tests/*.test.mjs"

   契约（P1-2）：
     · parse：hash 形态解析（领域/子路由/query/空 hash/尾斜杠/百分号/重复参数/+空格）；
     · setQuery：null 与 '' 删键、保留其他参数、路径不变、replace 模式恰好派发一次；
     · replaceSilently：只同步地址栏、不派发、当前路由上下文不动；
     · go({replace:true}) 派发；非 replace 走地址栏、由 hashchange 派发；
     · 应用壳：未知领域回退默认领域；index.html 不硬编码领域（新增领域不改 HTML）。
   做法：注入 window/location/history/document 桩后，用 ?case=N 动态 import 取独立 router 实例。
   ========================================================================== */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';

const ROUTER_URL = new URL('../../js/core/router.js', import.meta.url);
const DOMAINS_URL = new URL('../../js/domains.js', import.meta.url);
const INDEX_URL = new URL('../../index.html', import.meta.url);

/** 用例结束后还原全局桩（默认按文件进程隔离；--test-isolation=none 时也不污染其他文件） */
const ORIGINAL_GLOBALS = new Map(['window', 'history', 'location', 'document'].map((k) => [k, globalThis[k]]));
after(() => {
  for (const [key, value] of ORIGINAL_GLOBALS) {
    if (value === undefined) delete globalThis[key];
    else globalThis[key] = value;
  }
});

let caseSeq = 0;

/* ----------------------------- 浏览器桩 ----------------------------- */
/**
 * 最小浏览器桩：location.hash 可读写；history.replaceState 只改地址栏（真实浏览器同样不触发 hashchange）；
 * hashchange 由 fireHashChange() 手动触发，保证断言确定；window.scrollTo 记为 no-op。
 */
function browserStub({ hash = '' } = {}) {
  const calls = { replaceState: [], scrollTo: 0 };
  const hashListeners = new Set();
  const location = {
    _hash: hash,
    get hash() { return this._hash; },
    set hash(value) { this._hash = String(value); },
  };
  const history = {
    state: null,
    replaceState(state, _title, url) {
      calls.replaceState.push(String(url));
      history.state = state;
      location._hash = String(url);
    },
  };
  const window = {
    addEventListener(type, fn) { if (type === 'hashchange') hashListeners.add(fn); },
    removeEventListener(type, fn) { hashListeners.delete(fn); },
    scrollTo() { calls.scrollTo += 1; },
  };
  const document = { title: '' };

  globalThis.window = window;
  globalThis.history = history;
  globalThis.location = location;
  globalThis.document = document;

  return {
    window, history, location, document, calls,
    fireHashChange() {
      for (const fn of [...hashListeners]) fn({ type: 'hashchange' });
    },
  };
}

/** 每个用例拿独立模块实例（模块内 currentCtx/listeners 互不串扰） */
async function loadRouter(caseName, options = {}) {
  const stub = browserStub(options);
  const mod = await import(`${ROUTER_URL.href}?case=${encodeURIComponent(caseName)}-${++caseSeq}`);
  return { mod, router: mod.router, stub };
}

/* =============================================================================
   1 · hash 解析
   ========================================================================== */
test('parse：基础路径 / 子路由 / 领域首段', async () => {
  const { router } = await loadRouter('parse-basic');

  const root = router.parse('#/items');
  assert.equal(root.path, '/items');
  assert.equal(root.domain, 'items');
  assert.deepEqual(root.segs, ['items']);
  assert.equal(root.sub, '');
  assert.deepEqual(root.rest, []);
  assert.equal(root.hash, '/items');
  assert.equal(root.query.toString(), '');
  assert.deepEqual(root.params, {});

  const sets = router.parse('#/items/sets');
  assert.equal(sets.path, '/items/sets');
  assert.deepEqual(sets.segs, ['items', 'sets']);
  assert.equal(sets.sub, 'sets');
  assert.deepEqual(sets.rest, ['sets']);

  const detail = router.parse('#/items/Weapon_X');
  assert.equal(detail.domain, 'items');
  assert.equal(detail.sub, 'Weapon_X');
  assert.deepEqual(detail.rest, ['Weapon_X']);

  // 不带 # / 不带前导斜杠同样归一
  assert.equal(router.parse('/items').path, '/items');
  assert.equal(router.parse('items').path, '/items');
});

test('parse：query 解析（重复参数 / 空值 / 百分号编码 / + 与空格）', async () => {
  const { router } = await loadRouter('parse-query');

  const lab = router.parse('#/lab?panel=calc&profile=fortify_sb');
  assert.equal(lab.path, '/lab');
  assert.deepEqual(lab.params, { panel: 'calc', profile: 'fortify_sb' });
  assert.equal(lab.query.get('panel'), 'calc');
  assert.equal(lab.query.get('profile'), 'fortify_sb');

  // 重复参数：params 取最后一个值，query.getAll 保留全部
  const dup = router.parse('#/items?a=1&a=2');
  assert.equal(dup.params.a, '2');
  assert.deepEqual(dup.query.getAll('a'), ['1', '2']);

  // 空值：键存在、值为空字符串
  const emptyValue = router.parse('#/lab?panel=');
  assert.equal(emptyValue.query.has('panel'), true);
  assert.equal(emptyValue.params.panel, '');

  // URLSearchParams 语义：%XX 与 + 都解码为空格/字符
  const spaced = router.parse('#/items?q=%E5%89%91&r=a+b&s=a%20b');
  assert.equal(spaced.params.q, '剑');
  assert.equal(spaced.params.r, 'a b');
  assert.equal(spaced.params.s, 'a b');
});

test('parse：空 hash / "#" / 多余尾斜杠 / 百分号路径保持原始（由消费方解码）', async () => {
  const { router } = await loadRouter('parse-shapes');

  const empty = router.parse('');
  assert.equal(empty.domain, '');
  assert.equal(empty.path, '');
  assert.deepEqual(empty.segs, []);
  assert.equal(empty.hash, '/');

  const justHash = router.parse('#');
  assert.equal(justHash.domain, '');
  assert.equal(justHash.path, '');
  assert.deepEqual(justHash.segs, []);
  assert.equal(justHash.hash, '/');

  const trailing = router.parse('#/items/sets//');
  assert.equal(trailing.path, '/items/sets', '尾部多斜杠被剥掉');
  assert.deepEqual(trailing.segs, ['items', 'sets']);
  assert.equal(trailing.sub, 'sets');
  assert.equal(router.parse('#/items///').path, '/items');

  // 路径段不在这里解码：library 等消费方对 ctx.sub 做 decodeURIComponent（避免二次解码）
  const encoded = router.parse('#/items/%E5%89%91%2Ffoo');
  assert.equal(encoded.sub, '%E5%89%91%2Ffoo');
  assert.equal(decodeURIComponent(encoded.sub), '剑/foo');
});

/* =============================================================================
   2 · start / onChange
   ========================================================================== */
test('start：注册 hashchange 并派发一次；onChange 收到 (ctx, prev) 且可退订', async () => {
  const { router, stub } = await loadRouter('start', { hash: '#/items' });
  const seen = [];
  const off = router.onChange((ctx, prev) => seen.push({ ctx, prev }));

  router.start();
  assert.equal(seen.length, 1, 'start 立即按当前 hash 派发一次');
  assert.equal(seen[0].ctx.path, '/items');
  assert.equal(seen[0].ctx.domain, 'items');
  assert.equal(seen[0].prev, null);
  assert.equal(stub.calls.scrollTo, 1, '首次路由变化回到顶部一次');

  off();
  stub.location.hash = '#/lab';
  stub.fireHashChange();
  assert.equal(seen.length, 1, '退订后不再收到');

  const seen2 = [];
  router.onChange((ctx, prev) => seen2.push({ ctx, prev }));
  stub.location.hash = '#/builds';
  stub.fireHashChange();
  assert.equal(seen2.length, 1);
  assert.equal(seen2[0].ctx.domain, 'builds');
  assert.equal(seen2[0].prev.path, '/lab', '第二个参数是上一次路由');
});

/* =============================================================================
   3 · setQuery（序列化 / 删除 / 保留 / 派发次数）
   ========================================================================== */
test('setQuery：null 与空串删键、保留其他参数、路径不变、每次恰好派发一次', async () => {
  const { router, stub } = await loadRouter('set-query', { hash: '#/items?owned=1&sort=rarity' });
  const seen = [];
  router.onChange((ctx) => seen.push(ctx));
  router.start();
  assert.equal(seen.length, 1);

  const replaceBefore = stub.calls.replaceState.length;
  router.setQuery({ owned: null }); // null → 删键
  assert.equal(seen.length, 2, '恰好派发一次');
  assert.equal(stub.calls.replaceState.length, replaceBefore + 1, '默认 replace 写地址栏');
  assert.equal(stub.location.hash, '#/items?sort=rarity');
  assert.equal(seen[1].path, '/items', '路径不变');
  assert.equal(seen[1].params.owned, undefined);
  assert.equal(seen[1].params.sort, 'rarity', '其他参数保留');

  router.setQuery({ sort: '' }); // '' → 删键
  assert.equal(seen.length, 3);
  assert.equal(stub.location.hash, '#/items');
  assert.deepEqual(seen[2].params, {});

  router.setQuery({ q: '剑', page: 2 }); // 设置值（数字转字符串）
  assert.equal(seen.length, 4);
  assert.equal(seen[3].params.q, '剑');
  assert.equal(seen[3].params.page, '2');
  assert.equal(seen[3].path, '/items');
  assert.equal(stub.location.hash, `#/items?q=${encodeURIComponent('剑')}&page=2`);

  // 只有 null/'' 表示删除；0/false 是合法值
  router.setQuery({ owned: 0, fav: false });
  assert.equal(seen.length, 5);
  assert.equal(seen[4].params.owned, '0');
  assert.equal(seen[4].params.fav, 'false');
  assert.equal(seen[4].params.q, '剑', '之前的参数仍在');

  // replace:false → 只改地址栏，等 hashchange 派发
  const replaceCount = stub.calls.replaceState.length;
  router.setQuery({ panel: 'calc' }, { replace: false });
  assert.equal(seen.length, 5, '非 replace 不立即派发');
  assert.equal(stub.calls.replaceState.length, replaceCount, '非 replace 不写 replaceState');
  stub.fireHashChange();
  assert.equal(seen.length, 6);
  assert.equal(seen[5].params.panel, 'calc');
});

test('setQuery：当前没有路由时回退到根路径 /', async () => {
  const { router, stub } = await loadRouter('set-query-fallback', { hash: '' });
  const seen = [];
  router.onChange((ctx) => seen.push(ctx));

  router.setQuery({ panel: 'calc' });
  assert.equal(seen.length, 1);
  assert.equal(stub.location.hash, '#/?panel=calc', '没有当前路径时落到 /');
  assert.equal(seen[0].path, '');
  assert.equal(seen[0].params.panel, 'calc');
});

/* =============================================================================
   4 · replaceSilently / go
   ========================================================================== */
test('replaceSilently：只同步地址栏、不派发，且当前路由上下文保持不变', async () => {
  const { router, stub } = await loadRouter('silent', { hash: '#/items' });
  const seen = [];
  router.onChange((ctx) => seen.push(ctx));
  router.start();
  assert.equal(seen.length, 1);

  const replaceBefore = stub.calls.replaceState.length;
  assert.equal(router.replaceSilently('/items/Weapon_X'), true);
  assert.equal(stub.calls.replaceState.length, replaceBefore + 1, '写一次地址栏');
  assert.equal(stub.location.hash, '#/items/Weapon_X');
  assert.equal(seen.length, 1, '不派发路由事件');
  assert.equal(router.getRoute().sub, '', '路由上下文不动（详情深链由消费方自己持有）');

  assert.equal(router.replaceSilently('/items/Weapon_X'), false, '地址相同不重复写');
  assert.equal(stub.calls.replaceState.length, replaceBefore + 1);

  assert.equal(router.replaceSilently('items/Other'), true, '自动补前导斜杠');
  assert.equal(stub.location.hash, '#/items/Other');
});

test('go：replace 同步派发一次；非 replace 只改地址栏；同地址直接派发', async () => {
  const { router, stub } = await loadRouter('go', { hash: '#/items' });
  const seen = [];
  router.onChange((ctx) => seen.push(ctx));
  router.start();
  assert.equal(seen.length, 1);

  const replaceBefore = stub.calls.replaceState.length;
  router.go('/builds', { replace: true });
  assert.equal(seen.length, 2, 'replace 立即派发');
  assert.equal(stub.calls.replaceState.length, replaceBefore + 1);
  assert.equal(stub.location.hash, '#/builds');
  assert.equal(seen[1].domain, 'builds');
  assert.equal(router.getRoute().domain, 'builds');

  router.go('codex');
  assert.equal(stub.location.hash, '#/codex', '非 replace 只改地址栏');
  assert.equal(seen.length, 2, '等 hashchange 才派发');
  stub.fireHashChange();
  assert.equal(seen.length, 3);
  assert.equal(seen[2].domain, 'codex');

  router.go('/codex');
  assert.equal(seen.length, 4, '同地址 go 直接派发一次');
  assert.equal(stub.calls.replaceState.length, replaceBefore + 1, '非 replace 不写 replaceState');
});

/* =============================================================================
   5 · 应用壳回退契约
   ========================================================================== */
test('应用壳：未知领域 isDomain=false，默认领域 items 已注册，domainLabel 有 fallback', async () => {
  const domains = await import(`${DOMAINS_URL.href}?case=domains-${++caseSeq}`);

  assert.equal(domains.isDomain('nope'), false);
  assert.equal(domains.isDomain('items'), true);
  assert.equal(domains.DEFAULT_DOMAIN, 'items');
  assert.equal(domains.isDomain(domains.DEFAULT_DOMAIN), true, '默认领域必须在注册表里');

  const fallbackDef = domains.domainById(domains.DEFAULT_DOMAIN);
  assert.ok(fallbackDef);
  assert.equal(fallbackDef.id, 'items');
  assert.equal(fallbackDef.path, '/items', '未知领域重定向目标存在');

  assert.deepEqual([...domains.DOMAIN_IDS], domains.DOMAINS.map((d) => d.id));
  assert.equal(new Set(domains.DOMAIN_IDS).size, domains.DOMAIN_IDS.length, '领域 id 唯一');
  assert.ok(domains.DOMAIN_IDS.includes(domains.DEFAULT_DOMAIN));

  assert.equal(domains.domainById('nope'), null);
  assert.equal(domains.domainLabel('items'), '资料库');
  assert.equal(domains.domainLabel('nope'), '', '未知领域默认 fallback 为空串');
  assert.equal(domains.domainLabel('nope', '未知领域'), '未知领域');
});

test('应用壳：index.html 不含 data-domain=，导航由 domains.js + main.js 渲染', async () => {
  const html = await fsp.readFile(INDEX_URL, 'utf8');
  assert.equal(html.includes('data-domain='), false, '新增领域不应需要改 index.html');
  assert.equal(/data-domain\s*=/.test(html), false);

  const nav = html.match(/<nav\b[^>]*id="domnav"[^>]*>([\s\S]*?)<\/nav>/);
  assert.ok(nav, 'index.html 应有 #domnav 导航容器');
  assert.equal(nav[1].trim(), '', '导航项由 JS 按领域注册表渲染，HTML 里不写死');
});
