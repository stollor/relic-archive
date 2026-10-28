/* =============================================================================
   qa/tests/architecture.test.mjs — 架构边界守卫（node --test，零依赖）

   目的：把「模块职责 / 依赖方向 / 单一权威实现 / 路由归属」从口头约定变成可执行断言。
   违反任何一条都会在这里红，而不是等下次重构时才发现。
   运行：node --test "qa/tests/*.test.mjs"
   ========================================================================== */
import test from 'node:test';
import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const JS = path.join(ROOT, 'js');

/* ------------------------------- 工具 ------------------------------- */

async function walk(dir, out = []) {
  for (const ent of await fsp.readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) await walk(p, out);
    else if (ent.isFile() && ent.name.endsWith('.js')) out.push(p);
  }
  return out;
}

const rel = (abs) => path.relative(ROOT, abs).split(path.sep).join('/');

/** 提取 import / export-from / import() 的 specifier */
function specifiersOf(src) {
  const specs = [];
  const reStatic = /(?:^|\n)\s*(?:import|export)\s[^'"]*?from\s+['"]([^'"]+)['"]/g;
  const reSide = /(?:^|\n)\s*import\s+['"]([^'"]+)['"]/g;
  const reDynamic = /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  for (const re of [reStatic, reSide, reDynamic]) {
    let m;
    while ((m = re.exec(src)) !== null) specs.push(m[1]);
  }
  return specs;
}

function resolveSpec(fromAbs, spec) {
  if (!spec.startsWith('.')) return null;   // 只处理仓库内相对路径（本仓库无裸模块）
  const abs = path.resolve(path.dirname(fromAbs), spec);
  return rel(abs);
}

/** 分层：一个文件属于哪一层 */
function layerOf(relPath) {
  if (relPath === 'js/main.js' || relPath === 'js/domains.js') return 'app';
  if (relPath.startsWith('js/core/')) return 'core';
  if (relPath.startsWith('js/components/')) return 'components';
  if (relPath.startsWith('js/lab/')) return 'lab';
  if (relPath.startsWith('js/views/')) return 'views';
  if (relPath.startsWith('js/builds/')) return 'builds';
  if (relPath.startsWith('js/library/')) return 'library';
  return 'other';
}

/** 允许的依赖方向：key 层 → 可以 import 的层集合 */
const ALLOWED = {
  core: new Set(['core']),
  components: new Set(['core', 'components']),
  lab: new Set(['core', 'components', 'lab']),
  library: new Set(['core', 'library']),
  builds: new Set(['core', 'components', 'builds']),
  views: new Set(['core', 'components', 'views', 'lab', 'builds', 'library']),
  app: new Set(['core', 'components', 'lab', 'library', 'builds', 'views', 'app']),
  other: new Set(['core', 'other']),
};

async function loadGraph() {
  const files = (await walk(JS)).map((abs) => ({ abs, rel: rel(abs) }));
  const graph = new Map();
  for (const f of files) {
    const src = await fsp.readFile(f.abs, 'utf8');
    const edges = [];
    for (const spec of specifiersOf(src)) {
      const target = resolveSpec(f.abs, spec);
      if (target) edges.push(target);
    }
    graph.set(f.rel, { edges, src, abs: f.abs });
  }
  return graph;
}

const graphPromise = loadGraph();

/* ------------------------------- 依赖方向 ------------------------------- */

test('依赖方向：core 不得依赖上层（components / views / lab / builds / library / 应用层）', async () => {
  const graph = await graphPromise;
  const bad = [];
  for (const [file, node] of graph) {
    if (layerOf(file) !== 'core') continue;
    for (const dep of node.edges) {
      const to = layerOf(dep);
      if (!ALLOWED.core.has(to)) bad.push(`${file} → ${dep} (${to})`);
    }
  }
  assert.deepEqual(bad, [], `core 出现了向上依赖：\n${bad.join('\n')}`);
});

test('依赖方向：components 不得依赖 views / lab / builds / library', async () => {
  const graph = await graphPromise;
  const bad = [];
  for (const [file, node] of graph) {
    if (layerOf(file) !== 'components') continue;
    for (const dep of node.edges) {
      const to = layerOf(dep);
      if (!ALLOWED.components.has(to)) bad.push(`${file} → ${dep} (${to})`);
    }
  }
  assert.deepEqual(bad, [], `组件层出现了向上依赖：\n${bad.join('\n')}`);
});

test('依赖方向：lab 不得依赖 views', async () => {
  const graph = await graphPromise;
  const bad = [];
  for (const [file, node] of graph) {
    if (layerOf(file) !== 'lab') continue;
    for (const dep of node.edges) {
      if (layerOf(dep) === 'views') bad.push(`${file} → ${dep}`);
    }
  }
  assert.deepEqual(bad, [], `实验室层反向依赖了视图：\n${bad.join('\n')}`);
});

test('依赖方向：library / builds 领域模块不得依赖 views 与彼此', async () => {
  const graph = await graphPromise;
  const bad = [];
  for (const [file, node] of graph) {
    const layer = layerOf(file);
    if (layer !== 'library' && layer !== 'builds') continue;
    for (const dep of node.edges) {
      const to = layerOf(dep);
      if (to === 'views' || to === 'lab' || (layer === 'library' && to === 'builds')
        || (layer === 'builds' && to === 'library')) {
        bad.push(`${file} → ${dep} (${to})`);
      }
    }
  }
  assert.deepEqual(bad, [], `领域模块跨层依赖：\n${bad.join('\n')}`);
});

test('依赖方向：每个文件都在已知层内（新增顶层文件必须登记分层规则）', async () => {
  const graph = await graphPromise;
  const unknown = [...graph.keys()].filter((f) => layerOf(f) === 'other' && !f.endsWith('theme-boot.js'));
  assert.deepEqual(unknown, [], `未知层级文件（请在 architecture.test.mjs 的 layerOf 里登记）：\n${unknown.join('\n')}`);
});

/* ------------------------------- 循环依赖 ------------------------------- */

test('模块之间不存在循环依赖', async () => {
  const graph = await graphPromise;
  const WHITE = 0; const GRAY = 1; const BLACK = 2;
  const color = new Map([...graph.keys()].map((k) => [k, WHITE]));
  const stack = [];
  const cycles = [];

  function dfs(node) {
    color.set(node, GRAY);
    stack.push(node);
    for (const dep of graph.get(node)?.edges || []) {
      if (!graph.has(dep)) continue;           // 目标文件不存在由下一个用例兜住
      if (color.get(dep) === GRAY) {
        const at = stack.indexOf(dep);
        cycles.push([...stack.slice(at), dep].join(' → '));
      } else if (color.get(dep) === WHITE) {
        dfs(dep);
      }
    }
    stack.pop();
    color.set(node, BLACK);
  }
  for (const node of graph.keys()) if (color.get(node) === WHITE) dfs(node);
  assert.deepEqual(cycles, [], `存在循环依赖：\n${cycles.join('\n')}`);
});

test('所有相对 import 都指向真实存在的文件', async () => {
  const graph = await graphPromise;
  const missing = [];
  for (const [file, node] of graph) {
    for (const dep of node.edges) {
      const abs = path.join(ROOT, dep);
      try { await fsp.access(abs); } catch { missing.push(`${file} → ${dep}`); }
    }
  }
  assert.deepEqual(missing, [], `引用了不存在的模块：\n${missing.join('\n')}`);
});

/* --------------------------- 路由与领域注册 --------------------------- */

test('只有 js/main.js 订阅 router.onChange（路由变化只分发一次）', async () => {
  const graph = await graphPromise;
  const bad = [...graph.entries()]
    .filter(([file, node]) => file !== 'js/main.js' && /router\.onChange\s*\(/.test(node.src))
    .map(([file]) => file);
  assert.deepEqual(bad, [], `除应用壳外还在订阅路由：\n${bad.join('\n')}`);
});

test('只有 js/core/router.js 直接写 location.hash / history（导航统一走 router API）', async () => {
  const graph = await graphPromise;
  const bad = [];
  for (const [file, node] of graph) {
    if (file === 'js/core/router.js') continue;
    if (/\blocation\.hash\s*=/.test(node.src) || /\bhistory\.(pushState|replaceState)\s*\(/.test(node.src)) {
      bad.push(file);
    }
  }
  assert.deepEqual(bad, [], `绕过 router 直接改地址栏：\n${bad.join('\n')}`);
});

test('道具详情组件不拥有 URL（打开/关闭时的路由同步归调用方视图）', async () => {
  const graph = await graphPromise;
  const node = graph.get('js/components/item-detail.js');
  assert.ok(node, '找不到 js/components/item-detail.js');
  assert.doesNotMatch(node.src, /\brouter\.(go|setQuery|replaceSilently)\s*\(/,
    'item-detail.js 不应调用 router 导航 API；URL 由调用方视图负责');
  assert.doesNotMatch(node.src, /\blocation\.hash\b/, 'item-detail.js 不应读写 location.hash');
  assert.doesNotMatch(node.src, /\bhistory\.(pushState|replaceState)\b/, 'item-detail.js 不应直接写 history');
  assert.doesNotMatch(node.src, /\broute\s*[:=]/, 'item-detail.js 不应再有 route 开关，URL 归属已外移');
});

test('领域清单只在 js/domains.js：应用壳不得再维护按领域的映射表', async () => {
  const graph = await graphPromise;
  const main = graph.get('js/main.js');
  assert.ok(main, '找不到 js/main.js');
  assert.doesNotMatch(main.src, /VIEW_FILES|DOMAIN_ZH|DOMAIN_ORDER/,
    'main.js 不应再各自维护 VIEW_FILES / DOMAIN_ZH / DOMAIN_ORDER，一律读 js/domains.js');

  const router = graph.get('js/core/router.js');
  assert.ok(router, '找不到 js/core/router.js');
  assert.doesNotMatch(router.src, /DOMAINS/,
    'router.js 不应知道具体领域（领域校验归应用壳/js/domains.js）');
  const ids = ['items', 'lab', 'builds', 'codex'];
  for (const [file, node] of graph) {
    if (file === 'js/domains.js') continue;
    for (const line of node.src.split('\n')) {
      const hit = ids.filter((id) => new RegExp(`['"\`]${id}['"\`]`).test(line));
      if (hit.length >= 2) assert.fail(`领域清单散落在 ${file}：${line.trim()}`);
    }
  }
});

test('index.html 不硬编码领域导航项与视图样式（由 js/domains.js 驱动）', async () => {
  const html = await fsp.readFile(path.join(ROOT, 'index.html'), 'utf8');
  assert.doesNotMatch(html, /data-domain="/,
    'index.html 不应硬编码领域导航项，导航由 js/main.js 用 DOMAINS 渲染');
  assert.doesNotMatch(html, /css\/view-[a-z]+\.css/,
    'index.html 不应硬编码视图样式表，样式由 js/domains.js 的 styles 注入');
});

/* --------------------------- 单一权威实现 --------------------------- */

async function srcOf(relPath) {
  const graph = await graphPromise;
  const node = graph.get(relPath);
  assert.ok(node, `找不到 ${relPath}`);
  return node.src;
}

test('空/错/载入状态只有 components/states.js 一个实现', async () => {
  const graph = await graphPromise;
  const bad = [];
  for (const [file, node] of graph) {
    if (file === 'js/components/states.js') continue;
    if (/class: 'empty__ico'/.test(node.src)) bad.push(file);
  }
  assert.deepEqual(bad, [], `这些文件还在自己拼空状态标记（改用 components/states.js）：\n${bad.join('\n')}`);
});

test('面板骨架只有 components/panel.js 一个实现', async () => {
  const graph = await graphPromise;
  const bad = [];
  for (const [file, node] of graph) {
    if (file === 'js/components/panel.js') continue;
    if (/class: 'panel__head'/.test(node.src)) bad.push(file);
  }
  assert.deepEqual(bad, [], `这些文件还在自己拼面板骨架（改用 components/panel.js）：\n${bad.join('\n')}`);
});

test('道具展示文本规则只有 core/labels.js 一个实现', async () => {
  const graph = await graphPromise;
  const bad = [];
  for (const [file, node] of graph) {
    if (file === 'js/core/labels.js') continue;
    if (/const EFFECT_CATS =/.test(node.src)) bad.push(`${file}：重复定义 EFFECT_CATS`);
    if (/function zhDisplay\s*\(/.test(node.src)) bad.push(`${file}：重复定义 zhDisplay`);
    if (/function plainText\s*\(/.test(node.src)) bad.push(`${file}：重复定义 plainText（用 core/dom.js 的 stripTags）`);
  }
  assert.deepEqual(bad, [], `道具文本规则重复实现：\n${bad.join('\n')}`);
});

test('纯计算模块不碰 DOM / 存储 / 网络（可被 node --test 直接引用）', async () => {
  const graph = await graphPromise;
  const pure = [
    'js/library/query.js', 'js/library/present.js', 'js/library/export.js',
    'js/core/task.js', 'js/core/labels.js',
  ];
  const banned = /\b(document|window|localStorage|fetch)\s*[.(]/;
  const bad = [];
  for (const file of pure) {
    const node = graph.get(file);
    if (!node) continue;                       // 允许存在性由分布任务决定
    if (banned.test(node.src)) bad.push(file);
  }
  assert.deepEqual(bad, [], `这些模块应保持纯计算（不要直接触 DOM/storage/网络）：\n${bad.join('\n')}`);
});
