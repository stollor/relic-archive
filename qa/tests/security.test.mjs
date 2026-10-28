/* =============================================================================
   qa/tests/security.test.mjs — 安全边界守卫（node --test，零依赖、无浏览器）

   目的：把「不引入原始 HTML 入口 / 危险协议 / 导入脏数据」从口头约定变成可执行断言。
   对应 P2-4 修复：
     · ui.confirm(string body) 不再当 HTML（真实存储型 XSS：lab/saved.js 把用户命名存档名
       插进确认框；名字写 `<img src=x onerror=...>` 即可执行）；
     · ui.showTip 不再 innerHTML；实测页面 data-tip：8 个路由 / 244 个唯一值 / 239 个含
       HTML，标签集合仅 {b, br}（取证于 2026-10-28，builds 列表 + 7 套详情），
       故保留白名单渲染器（b/strong/i/em/br/code，无属性，其余标签按文本，实体解码）；
     · h() 删除 `html:` 原始 HTML 入口（唯一旧使用点就是 confirm）；
     · h() 的 href 落点统一 safeHref() 协议白名单（#/相对/根路径/http(s)）；
     · store 读取 saved 记录时截断异常超长名称（合法名称语义不变）并拒绝危险键。
   运行：node --test "qa/tests/*.test.mjs"
   ========================================================================== */
import test from 'node:test';
import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const JS_DIR = path.join(ROOT, 'js');
const DOM_URL = new URL('../../js/core/dom.js', import.meta.url);
const STORE_URL = new URL('../../js/core/store.js', import.meta.url);

/* ----------------------------- 源码工具 ----------------------------- */
async function walkJs(dir, out = []) {
  for (const ent of await fsp.readdir(dir, { withFileTypes: true })) {
    const abs = path.join(dir, ent.name);
    if (ent.isDirectory()) await walkJs(abs, out);
    else if (ent.isFile() && ent.name.endsWith('.js')) out.push(abs);
  }
  return out;
}

const rel = (abs) => path.relative(ROOT, abs).split(path.sep).join('/');
const FILE_LIST = (await walkJs(JS_DIR)).sort();
const SOURCE = new Map();
for (const abs of FILE_LIST) SOURCE.set(rel(abs), await fsp.readFile(abs, 'utf8'));

/** 读取单文件源码（不存在直接失败，避免守卫静默失效） */
function sourceOf(file) {
  const src = SOURCE.get(file);
  assert.ok(src != null, `守卫文件不存在：${file}`);
  return src;
}

/** 返回 [行号, 行文本] */
function lineHits(src, re) {
  const hits = [];
  src.split('\n').forEach((line, i) => { if (re.test(line)) hits.push([i + 1, line.trim()]); });
  return hits;
}

/* ----------------------------- 1 · 危险 API ----------------------------- */
test('安全守卫：产品代码禁止 eval / new Function / document.write / insertAdjacentHTML / srcdoc', () => {
  const banned = [
    [/new\s+Function\s*\(/, 'new Function('],
    [/(?<![\w.$])eval\s*\(/, 'eval('],
    [/document\.write\s*\(/, 'document.write('],
    [/insertAdjacentHTML\s*\(/, 'insertAdjacentHTML('],
    [/\bsrcdoc\b/, 'srcdoc'],
  ];
  for (const [file, src] of SOURCE) {
    for (const [re, label] of banned) {
      const hits = lineHits(src, re);
      assert.equal(hits.length, 0, `${file} 命中禁用 API ${label}：${JSON.stringify(hits)}`);
    }
  }
});

/* ----------------------------- 2 · innerHTML 白名单 ----------------------------- */
test('安全守卫：innerHTML/outerHTML 只允许 icons.js / theme.js 的静态常量表', () => {
  const allowed = new Set(['js/core/icons.js', 'js/core/theme.js']);
  const found = [];
  for (const [file, src] of SOURCE) {
    for (const [lineNo, line] of lineHits(src, /innerHTML|outerHTML/)) found.push({ file, lineNo, line });
  }
  const files = [...new Set(found.map((h) => h.file))].sort();
  assert.deepEqual(files, [...allowed].sort(), `innerHTML 使用文件必须收敛到白名单，实际：${files}`);
  for (const hit of found) {
    // 只允许把静态常量写进 innerHTML，禁止拼接变量/用户数据
    assert.match(hit.line, /innerHTML\s*=\s*(body|ICONS\[)/,
      `${hit.file}:${hit.lineNo} 的 innerHTML 赋值不是静态常量表：${hit.line}`);
  }
  // 修复后 ui.js / dom.js 不得再有 innerHTML
  assert.equal(lineHits(sourceOf('js/core/ui.js'), /innerHTML|outerHTML/).length, 0);
  assert.equal(lineHits(sourceOf('js/core/dom.js'), /innerHTML|outerHTML/).length, 0);
});

/* ----------------------------- 3 · confirm / showTip / h 守卫 ----------------------------- */
test('安全守卫：h() 不再接受 html: 原始 HTML 入口，ui 不再有字符串→HTML', () => {
  for (const [file, src] of SOURCE) {
    const hits = lineHits(src, /\bhtml\s*:/);
    assert.equal(hits.length, 0, `${file} 仍有 html: 原始 HTML 入口：${JSON.stringify(hits)}`);
  }

  const domSrc = sourceOf('js/core/dom.js');
  assert.match(domSrc, /export function richTextParts\s*\(/, 'dom.js 应导出 richTextParts（纯函数，可单测）');
  assert.match(domSrc, /export function richText\s*\(/, 'dom.js 应导出 richText（白名单渲染）');
  assert.match(domSrc, /export function safeHref\s*\(/, 'dom.js 应导出 safeHref');
  assert.match(domSrc, /k === 'href'/, "h() 应对 href 单独收口");
  assert.match(domSrc, /safeHref\((?:v|value)\)/, "h() 的 href 必须经过 safeHref");
  assert.match(domSrc, /noopener/, '外部 http(s) 链接应带 noopener 策略');

  const uiSrc = sourceOf('js/core/ui.js');
  assert.equal(lineHits(uiSrc, /innerHTML|outerHTML/).length, 0, 'ui.js 不得再直接写 innerHTML');
  assert.match(uiSrc, /richText\(/ , 'showTip 应走 richText 白名单渲染');
  assert.match(uiSrc, /typeof body === 'string'[\s\S]{0,120}text:\s*body/, 'confirm 的 string body 必须按纯文本渲染');
  assert.doesNotMatch(uiSrc, /html:\s*body/, 'confirm 不得再把字符串 body 交给 html:');
});

/* ----------------------------- 4 · href 协议白名单 ----------------------------- */
test('安全守卫：所有 href 生成只允许安全协议/相对路径', () => {
  // 直接写 href 属性只允许两处：dom.js downloadText（内部 blob URL）与 main.js 领域注册表（静态表）
  const direct = [];
  for (const [file, src] of SOURCE) {
    for (const [lineNo, line] of lineHits(src, /\.href\s*=/)) direct.push({ file, lineNo, line });
  }
  const allowedDirect = new Set(['js/core/dom.js', 'js/main.js']);
  for (const hit of direct) {
    assert.ok(allowedDirect.has(hit.file), `${hit.file}:${hit.lineNo} 直接写 href 未经 safeHref：${hit.line}`);
  }
  // setAttribute('href') 只允许在 dom.js 内部
  for (const [file, src] of SOURCE) {
    for (const [lineNo, line] of lineHits(src, /setAttribute\(\s*['"]href['"]/)) {
      assert.equal(file, 'js/core/dom.js', `${file}:${lineNo} 绕过 h() 直接 setAttribute('href')`);
    }
  }
});

/* ----------------------------- 5 · safeHref 行为 ----------------------------- */
test('safeHref：http(s)/hash/相对路径放行，javascript:/data:/vbscript: 等一律拒绝', async () => {
  const { safeHref } = await import(DOM_URL);
  assert.equal(typeof safeHref, 'function', 'dom.js 必须导出 safeHref');
  for (const ok of ['#/items', '#/items/Weapon_X', '/items', './x', '../x', 'x/y', '?panel=calc', 'https://remnant2.wiki.gg/wiki/X', 'http://127.0.0.1:8777/']) {
    assert.equal(safeHref(ok), ok, `应放行：${ok}`);
  }
  for (const bad of [
    'javascript:alert(1)', 'JavaScript:alert(1)', ' javascript:alert(1)',
    'data:text/html,<script>alert(1)</script>', 'vbscript:msgbox(1)',
    'file:///C:/Windows/win.ini', 'blob:http://x/y', 'java\nscript:alert(1)',
    'jav\tascript:alert(1)', 'jAvAsCrIpT:alert(1)',
  ]) {
    assert.equal(safeHref(bad), null, `必须拒绝危险协议：${JSON.stringify(bad)}`);
  }
});

/* ----------------------------- 6 · richTextParts 白名单 ----------------------------- */
test('richTextParts：恶意标签只作为文本，不产生元素 token；实体正确解码', async () => {
  const { richTextParts } = await import(DOM_URL);
  assert.equal(typeof richTextParts, 'function', 'dom.js 必须导出 richTextParts');

  const elementTokens = (parts) => parts.filter((p) => p.type === 'open' || p.type === 'br');
  const textOf = (parts) => parts.map((p) => (p.type === 'text' ? p.value : '')).join('');

  for (const payload of [
    '<img src=x onerror=alert(1)>',
    '<script>alert(1)</script>',
    '<a href="javascript:alert(1)">x</a>',
    '<b onclick="alert(1)">x</b>',
    '<iframe srcdoc="<script>x</script>"></iframe>',
    '<svg onload="alert(1)">',
  ]) {
    const parts = richTextParts(payload);
    assert.deepEqual(elementTokens(parts), [], `恶意标签不得产生新元素：${payload} → ${JSON.stringify(parts)}`);
    assert.ok(textOf(parts).includes(payload.slice(1, 4)), `恶意标签应作为文本保留：${payload}`);
  }

  // 真实使用的强化标签：只认 b/br，且无属性
  const rich = richTextParts('<b>动量</b><br>暴击命中共 +1~2%');
  assert.deepEqual(rich, [
    { type: 'open', tag: 'b' },
    { type: 'text', value: '动量' },
    { type: 'close', tag: 'b' },
    { type: 'br' },
    { type: 'text', value: '暴击命中共 +1~2%' },
  ]);

  // 实体解码：生产点先用 esc() 转义，再拼固定标签；渲染时文本要还原
  const escaped = richTextParts('&lt;b&gt; &amp; &quot;x&quot; &#39;y&#39;');
  assert.equal(textOf(escaped), '<b> & "x" \'y\'');
  assert.deepEqual(elementTokens(escaped), [], '转义后的文本不得变成元素');

  // 大小写/嵌套
  const nested = richTextParts('<B>外<i>内</i></B>');
  assert.deepEqual(nested.map((p) => p.type + (p.tag || '')), ['openb', 'text', 'openi', 'text', 'closei', 'closeb']);
});

/* ----------------------------- 7 · store 导入/读取校验 ----------------------------- */
function fakeStorage(seed = {}) {
  const map = new Map();
  for (const [k, v] of Object.entries(seed)) map.set(k, typeof v === 'string' ? v : JSON.stringify(v));
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

let storeSeq = 0;
async function loadStore(storage, caseName) {
  globalThis.localStorage = storage;
  const mod = await import(`${STORE_URL.href}?case=${encodeURIComponent(caseName)}-${++storeSeq}`);
  return mod.store;
}

const KEY = { saved: 'r2.v2.saved' };

test('store：saved 名称读取只截断异常超长值，合法名称/恶意文本语义不变', async () => {
  const longName = `长`.repeat(300);
  const legalName = '护卫者重装 · 洛斯曼'; // ≤80，必须原样保留
  const xssName = '<img src=x onerror=alert(1)>';
  const storage = fakeStorage({
    [KEY.saved]: [
      { id: 's-long', name: longName, ts: 1, build: {} },
      { id: 's-legal', name: legalName, ts: 2, build: {} },
      { id: 's-xss', name: xssName, ts: 3, build: {} },
    ],
  });
  const store = await loadStore(storage, 'security-name');
  const list = store.saved.list();
  const byId = new Map(list.map((rec) => [rec.id, rec]));
  assert.equal(byId.get('s-long').name.length, 80, '异常超长名称读取时应截断到 80');
  assert.ok(byId.get('s-long').name.startsWith('长长'), '截断保留前缀');
  assert.equal(byId.get('s-legal').name, legalName, '合法名称不得被改写');
  assert.equal(byId.get('s-xss').name, xssName, '名称作为纯数据保留，不在这里改写（显示层负责转义）');

  // 保存 / 改名同样只截断超长（用另一个前缀避免与既有被截断记录重名覆盖）
  const longName2 = `另`.repeat(300);
  store.saved.save(longName2);
  const savedLong = store.saved.list().find((rec) => rec.id !== 's-long' && rec.name.startsWith('另'));
  assert.ok(savedLong, 'save() 写入的超长名称应截断到 80');
  assert.equal(savedLong.name.length, 80);
  assert.equal(store.saved.rename('s-legal', legalName), true);
  assert.equal(store.saved.list().find((rec) => rec.id === 's-legal').name, legalName);
  store.saved.rename('s-legal', longName);
  assert.equal(store.saved.list().find((rec) => rec.id === 's-legal').name.length, 80);
});

test('store：saved 记录中的危险键不得污染原型，脏类型/非法记录不拖垮整份数据', async () => {
  const storage = fakeStorage({
    [KEY.saved]: [
      JSON.parse('{"id":"s1","name":"ok","ts":1,"build":{},"__proto__":{"polluted":true},"constructor":{"prototype":{"polluted2":true}}}'),
      { id: 's2', name: 123, ts: 'x', build: 'bad' },
      null,
      { name: '没有 id' },
    ],
  });
  const store = await loadStore(storage, 'security-proto');
  assert.equal({}.polluted, undefined, '__proto__ 不得污染 Object.prototype');
  assert.equal({}.polluted2, undefined, 'constructor.prototype 不得污染 Object.prototype');
  const list = store.saved.list();
  assert.deepEqual(list.map((rec) => rec.id), ['s1', 's2'], '合法记录保留，非法项丢弃');
  assert.equal(list[0].name, 'ok');
  assert.equal(typeof list[1].name, 'string', '错误类型 name 归一为字符串');
  assert.equal(typeof list[1].ts, 'number', '错误类型 ts 归一为数字');
});
