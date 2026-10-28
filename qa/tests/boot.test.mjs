/* =============================================================================
   qa/tests/boot.test.mjs — 启动 / 数据前置契约（node --test，零依赖）

   背景（P2-2 数据按需加载）：
   boot 曾无条件 `await api.ready()`（items 7.3MB + effects + icons），导致直链
   `#/codex` 也要先等全量数据；现在 boot 立即 router.start()，把「是否需要全量
   数据」交给 dispatch 按 js/domains.js 的 bootstrap 字段判断。

   这些断言防止后续改动把 gating 又搬回 boot、或让视图在数据/图标就绪前 mount
   （图标先占位再替换）——行为级证据由 qa/perf.mjs S1 的 codex 首屏请求数/字节佐证。
   main.js 是有副作用的入口（import 即 boot），所以这里做源码结构断言，不 import 它。
   ========================================================================== */
import test from 'node:test';
import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');

const read = (rel) => fsp.readFile(path.join(ROOT, rel), 'utf8');

/** 按起止标记截取一段源码（标记必须存在，避免正则漂移导致断言空转） */
function sliceOf(src, startMark, endMark) {
  const i = src.indexOf(startMark);
  assert.ok(i >= 0, `源码里找不到起始标记：${startMark}`);
  const j = src.indexOf(endMark, i + startMark.length);
  assert.ok(j > i, `源码里找不到结束标记：${endMark}`);
  return src.slice(i, j);
}

const mainSrc = await read('js/main.js');
const domainsSrc = await read('js/domains.js');

const bootSrc = sliceOf(mainSrc, 'async function boot()', '\nboot();');
const dispatchSrc = sliceOf(mainSrc, 'async function dispatch(', '\nfunction syncNav(');
const failSrc = sliceOf(mainSrc, 'function failDispatch(', '\nasync function dispatch(');
const footerSrc = sliceOf(mainSrc, 'async function fillFooterFacts()', '\nfunction closeViewOverlays()');
const overlaysSrc = sliceOf(mainSrc, 'function closeViewOverlays()', '/* ----------------------------- 启动');
const needsReadySrc = sliceOf(mainSrc, 'function needsReady(', '\n/** 全量数据读取失败的统一提示');

/* ------------------------- 1. 注册表契约 ------------------------- */
test('domains.js：codex 首屏不依赖全量 items（bootstrap: false），其余领域默认等待', async () => {
  const mod = await import(pathToFileURL(path.join(ROOT, 'js/domains.js')).href);
  const byId = new Map(mod.DOMAINS.map((d) => [d.id, d]));
  assert.ok(byId.has('codex'), 'domains.js 缺少 codex 领域');
  assert.equal(byId.get('codex').bootstrap, false,
    'codex 必须 bootstrap: false，否则直链 #/codex 会被 api.ready() 阻塞下载 items');
  for (const id of ['items', 'lab', 'builds']) {
    assert.notEqual(byId.get(id).bootstrap, false,
      `${id} 首屏需要 items/icons，不能被标成 bootstrap: false（否则图标先占位再替换）`);
  }
  // 注册表是唯一来源：字段说明要写进文件头部注释，避免下一个人不知道有它
  assert.match(domainsSrc, /bootstrap/, 'domains.js 字段注释里应说明 bootstrap 的语义');
});

/* ------------------------- 2. boot 不阻塞 ------------------------- */
test('main.js boot：先 router.start()，不再 await api.ready()/api.items()', () => {
  assert.doesNotMatch(bootSrc, /await\s+api\.ready\s*\(/,
    'boot 不得再无条件 await api.ready()——全量数据前置应下沉到 dispatch 按领域判断');
  assert.doesNotMatch(bootSrc, /await\s+api\.items\s*\(/,
    'boot 不得再 await api.items()（页脚统计应改为异步 fillFooterFacts）');
  assert.match(bootSrc, /router\.onChange\(dispatch\)/, 'boot 必须订阅路由派发');
  assert.match(bootSrc, /router\.start\(\)/, 'boot 必须立即启动路由');
  assert.ok(bootSrc.indexOf('router.onChange(dispatch)') < bootSrc.indexOf('router.start()'),
    '先 router.onChange(dispatch) 再 router.start()');
});

/* ------------------- 3. dispatch 的数据前置与并行 ------------------- */
test('main.js dispatch：bootstrap!==false 的领域在 mount 前 await api.ready()', () => {
  assert.match(dispatchSrc, /needsReady\(domain\)/,
    'dispatch 应通过 needsReady(domain) 读取注册表 bootstrap 契约');
  assert.match(needsReadySrc, /bootstrap !== false/,
    'needsReady 的默认语义必须是 bootstrap !== false（默认等待，只有显式 false 才跳过）');
  const readyIdx = dispatchSrc.indexOf('await api.ready()');
  const mountIdx = dispatchSrc.indexOf('mod.mount(');
  assert.ok(readyIdx >= 0, 'dispatch 应在需要数据的领域 mount 前 await api.ready()');
  assert.ok(mountIdx > readyIdx, 'api.ready() 必须在 mod.mount() 之前完成（图标/效果先就位）');
});

test('main.js dispatch：视图模块与数据并行加载（loadView 先启动，不是串行）', () => {
  const loadIdx = dispatchSrc.indexOf('loadView(domain)');
  const readyIdx = dispatchSrc.indexOf('await api.ready()');
  assert.ok(loadIdx >= 0, 'dispatch 必须加载视图模块');
  assert.ok(loadIdx < readyIdx,
    'loadView(domain) 必须在 await api.ready() 之前启动（否则模块/CSS 又要等数据后才发）');
});

test('main.js dispatch：数据等待期间有载入态，mount 前清除', () => {
  const loadingIdx = dispatchSrc.indexOf('loadingState()');
  const readyIdx = dispatchSrc.indexOf('await api.ready()');
  assert.ok(loadingIdx >= 0, 'dispatch 等待模块/数据时应保留 loadingState（不能留空白区）');
  assert.ok(loadingIdx < readyIdx, 'loadingState 应在等待数据之前挂上');
});

/* ------------------- 4. 跨域浮层清理（P0 审计） ------------------- */
test('main.js dispatch/failDispatch：挂载新视图前调用 closeViewOverlays（浮层与滚动锁不跨域残留）', () => {
  assert.match(dispatchSrc, /closeViewOverlays\(\)/,
    'dispatch 在挂载新视图前必须关闭上一个视图的浮层');
  assert.match(failSrc, /closeViewOverlays\(\)/,
    'failDispatch 进入错误态前也必须关闭浮层');
  // 同领域 onRoute 分支（在 dispatch 的 mounted-same-domain 早退分支）不得调用：浮层归视图自己管
  const onRouteIdx = dispatchSrc.indexOf('mounted.view.onRoute(ctx)');
  const tokenIdx = dispatchSrc.indexOf('const token = epoch.next()');
  assert.ok(onRouteIdx >= 0 && onRouteIdx < tokenIdx,
    '同领域 onRoute 早退分支应保持不动（不关浮层）');
  assert.match(overlaysSrc, /ui\.closeOverlays\s*\?|ui\.closeOverlays\(/,
    'closeViewOverlays 应接到 core/ui.js 的统一关闭 API');
  assert.match(overlaysSrc, /silent:\s*true/, '关闭浮层必须是静默的（不触发 toast/动画副作用）');
});

/* ----------------------- 5. 页脚异步、不阻塞 ----------------------- */
test('main.js：页脚统计异步填充，不阻塞首屏，且 boot 不写页脚', () => {
  assert.match(mainSrc, /async function fillFooterFacts\(\)/,
    '页脚统计应是独立异步函数');
  assert.doesNotMatch(mainSrc, /await\s+fillFooterFacts\(/,
    'fillFooterFacts 不得被 await（页脚不是首屏关键路径）');
  assert.match(dispatchSrc, /fillFooterFacts\(\);/,
    'dispatch 应在数据就绪后触发一次异步页脚填充');
  assert.match(footerSrc, /footCount/, '页脚填充函数负责 footCount');
  assert.match(footerSrc, /footStamp/, '页脚填充函数负责 footStamp');
  assert.doesNotMatch(bootSrc, /footCount|footStamp/,
    'boot 不应同步写页脚（codex 直链要保留「—」占位）');
});

/* --------------------- 6. 失败仍可重试错误态 --------------------- */
test('main.js：数据前置失败走既有可重试错误态（failDispatch + readyError）', () => {
  assert.match(dispatchSrc, /failDispatch\(readyError\(err\)/, '数据失败应交给 failDispatch 渲染错误态');
  assert.match(mainSrc, /function readyError\(/, 'readyError 提供与旧 boot 一致的服务器指引文案');
  assert.match(failSrc, /onRetry/, '错误态必须可重试');
});
