#!/usr/bin/env node
/* =============================================================================
   遗迹2 · 遗物档案 — 性能基准工具（P2-1，零依赖）
   固定 1440×1000 / dark / 新 Chrome profile（冷缓存）/ 每个场景默认 3 次取中位数，
   输出机器可读 qa/results/perf.json（gitignored）+ 中文摘要；支持基线对比。

   场景：
     S1 首次访问（冷启）：#/items #/lab #/builds #/codex，firstView/DCL/FCP/请求数/字节/JSON 耗时
     S2 JSON 解析/归一化：fetch/Response.json/JSON.parse 注入，每资源 fetch+parse 耗时、解析完成→首屏
     S3 各领域首开（warm 页面懒加载 module/css/data）
     S4 页面切换：items→lab→builds→codex ×6 轮逐次耗时
     S5 搜索/分类/排序/组合筛选：事件→DOM 更新（下一帧）
     S6 内存：首屏 GC 后 vs 20 次切换后 GC（JSHeapUsedSize/Nodes/Documents/图片数）
     S7 实验室穷举：状态栏「用时 N 毫秒」+ 墙钟 + rAF 帧间隔
     S8 低性能/移动：390×844 + CPU 4× 复用 S1(items)/S3/S4 少量样本

   用法：
     node qa/perf.mjs --all --update-baseline
     node qa/perf.mjs                       # 默认全部场景（不写基线）
     node qa/perf.mjs --scenario S1,S3 --repeat 3
     node qa/perf.mjs --base http://127.0.0.1:8777
     node qa/perf.mjs --compare [qa/perf-baseline.json]
     node qa/perf.mjs --json qa/results/perf.json --quiet
   退出码：0 正常（--compare 变慢不算失败）；1 脚本自身错误；2 用法错误/Chrome 缺失
   ========================================================================== */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { CDP, launchChrome, cleanupChrome, sleep } = require('./lib/cdp.js');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..');
const BASELINE_DEFAULT = path.join(REPO, 'qa', 'perf-baseline.json');
const JSON_DEFAULT = path.join(REPO, 'qa', 'results', 'perf.json');
const VIEWPORT = { width: 1440, height: 1000, deviceScaleFactor: 1 };
const MOBILE = { width: 390, height: 844, deviceScaleFactor: 1, mobile: true };
const THEME_FEATURE = [{ name: 'prefers-color-scheme', value: 'dark' }];
const SCENARIO_IDS = ['S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'S8'];

/* ------------------------------ 参数解析 ------------------------------ */
function parseArgs(argv) {
  const out = {
    all: false, scenarios: null, repeat: 3, base: null, updateBaseline: false,
    compare: null, comparePath: null, compareOnly: false, json: JSON_DEFAULT, quiet: false, help: false, routes: null,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--all') out.all = true;
    else if (a === '--help' || a === '-h') out.help = true;
    else if (a === '--quiet' || a === '-q') out.quiet = true;
    else if (a === '--update-baseline') out.updateBaseline = true;
    else if (a === '--repeat') {
      const v = Number(argv[++i]);
      if (!Number.isFinite(v) || v < 1) { console.error('[perf] --repeat 需要正整数'); process.exit(2); }
      out.repeat = Math.min(10, Math.floor(v));
    } else if (a === '--scenario') {
      const raw = String(argv[++i] || '');
      const ids = raw.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
      const bad = ids.filter((id) => !SCENARIO_IDS.includes(id));
      if (bad.length) { console.error(`[perf] 未知场景：${bad.join(',')}（可选 ${SCENARIO_IDS.join(',')}）`); process.exit(2); }
      out.scenarios = ids;
    } else if (a === '--base') {
      out.base = String(argv[++i] || '').trim() || null;
    } else if (a === '--route') {
      const raw = String(argv[++i] || '');
      const ids = raw.split(',').map((s) => s.trim()).filter(Boolean);
      const bad = ids.filter((id) => !['items', 'lab', 'builds', 'codex'].includes(id));
      if (bad.length) { console.error(`[perf] 未知路由：${bad.join(',')}（可选 items,lab,builds,codex）`); process.exit(2); }
      out.routes = ids;
    } else if (a === '--json') {
      out.json = path.resolve(REPO, String(argv[++i] || JSON_DEFAULT));
    } else if (a === '--compare-only') {
      out.compareOnly = true;
    } else if (a === '--compare') {
      out.compare = true;
      const next = argv[i + 1];
      if (next && !next.startsWith('-')) { out.comparePath = path.resolve(REPO, next); i += 1; }
    } else if (a.startsWith('-')) {
      console.error(`[perf] 未知选项：${a}`);
      process.exit(2);
    } else {
      console.error(`[perf] 未知参数：${a}`);
      process.exit(2);
    }
  }
  if (!out.scenarios) out.scenarios = out.all ? [...SCENARIO_IDS] : [...SCENARIO_IDS];
  return out;
}

function printHelp() {
  console.log([
    '遗迹2 · 遗物档案 — 性能基准（零依赖）',
    '',
    '用法：node qa/perf.mjs [选项]',
    '',
    '  --all                  跑全部场景（默认）',
    '  --scenario S1,S3       只跑指定场景（S1..S8）',
    '  --repeat <n>           每个场景重复次数（默认 3，取中位数）',
    '  --base <url>           复用已运行站点；省略则自动起 serve.py --port 0',
    '  --update-baseline      把本轮结果写入 qa/perf-baseline.json',
    '  --compare [path]       与基线对比（默认 qa/perf-baseline.json），只打印不判失败',
  '  --compare-only         不测量，直接对比已产出的 --json 结果与基线（after 报告用）',
    '  --json <path>          结果 JSON 路径（默认 qa/results/perf.json）',
    '  --quiet                精简输出',
    '',
    '示例：node qa/perf.mjs --all --update-baseline && node qa/perf.mjs --compare',
    '退出码：0 正常；1 脚本错误；2 用法错误',
  ].join('\n'));
}

const opts = parseArgs(process.argv.slice(2));
if (opts.help) { printHelp(); process.exit(0); }
const SELECTED = SCENARIO_IDS.filter((id) => opts.scenarios.includes(id));
const log = (...a) => { if (!opts.quiet) console.log(...a); };
/** PERF_DEBUG=1 时打印每一步（定位挂起点），默认不刷屏 */
const dbg = (...a) => { if (process.env.PERF_DEBUG) console.error('[perf:debug]', ...a); };

/** 单个场景的硬预算：超时直接报错（不会无限挂） */
const SCENARIO_BUDGET_MS = {
  S1: 12 * 60_000,
  S2: 1000,
  S3: 6 * 60_000,
  S4: 6 * 60_000,
  S5: 5 * 60_000,
  S6: 6 * 60_000,
  S7: 6 * 60_000,
  S8: 10 * 60_000,
};

/* ------------------------------ 数值工具 ------------------------------ */
/** 给任意 Promise 加硬超时（防止 CDP/导航/GC 在异常机器上永久挂起） */
class PerfTimeoutError extends Error {
  constructor(label, ms) { super(`超时：${label}（>${ms}ms）`); this.name = 'PerfTimeoutError'; this.label = label; this.timeoutMs = ms; }
}
function withTimeout(promise, ms, label) {
  let timer = null;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new PerfTimeoutError(label, ms)), ms);
    if (timer.unref) timer.unref();
  });
  return Promise.race([promise, timeout]).finally(() => { if (timer) clearTimeout(timer); });
}

function median(arr) {
  const a = (arr || []).filter((x) => Number.isFinite(x)).slice().sort((x, y) => x - y);
  if (!a.length) return null;
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}
function percentile(arr, p) {
  const a = (arr || []).filter((x) => Number.isFinite(x)).slice().sort((x, y) => x - y);
  if (!a.length) return null;
  const idx = Math.min(a.length - 1, Math.max(0, Math.ceil((p / 100) * a.length) - 1));
  return a[idx];
}
const round = (v, d = 1) => (v == null || !Number.isFinite(v) ? null : Math.round(v * 10 ** d) / 10 ** d);
const roundAll = (obj, d = 1) => {
  const out = {};
  for (const [k, v] of Object.entries(obj)) out[k] = typeof v === 'number' ? round(v, d) : v;
  return out;
};
function spreadPct(values) {
  const a = (values || []).filter((x) => Number.isFinite(x));
  if (a.length < 2) return null;
  const med = median(a);
  if (!med) return null;
  return round(((Math.max(...a) - Math.min(...a)) / med) * 100, 1);
}

/* ------------------------------ Python / 服务器 ------------------------------ */
function detectPython() {
  const candidates = [];
  if (process.env.PYTHON) candidates.push({ cmd: process.env.PYTHON, args: [] });
  candidates.push({ cmd: 'python', args: [] }, { cmd: 'py', args: ['-3'] }, { cmd: 'python3', args: [] });
  for (const c of candidates) {
    try {
      const r = spawnSync(c.cmd, [...c.args, '--version'], { windowsHide: true, encoding: 'utf8', timeout: 8000 });
      if (r.status === 0 && /Python\s+3\./i.test(String(r.stdout || r.stderr))) return c;
    } catch { /* 继续尝试 */ }
  }
  return null;
}

class LocalServer {
  constructor({ base = null } = {}) {
    this.external = base;
    this.base = base;
    this.proc = null;
    this.logs = [];
  }

  async start() {
    if (this.external) { this.base = this.external.replace(/\/+$/, ''); return this.base; }
    const python = detectPython();
    if (!python) throw new Error('找不到 Python 3（设置 PYTHON 或把 python 加入 PATH），也可用 --base 复用已运行站点');
    const args = [...python.args, 'serve.py', '--host', '127.0.0.1', '--port', '0'];
    const proc = spawn(python.cmd, args, {
      cwd: REPO, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUNBUFFERED: '1' },
    });
    this.proc = proc;
    const url = await new Promise((resolve, reject) => {
      let buf = '';
      const timer = setTimeout(() => reject(new Error(`等待 serve.py 就绪超时（20s）。输出：\n${buf.slice(-800)}`)), 20000);
      const onData = (chunk) => {
        buf += chunk.toString();
        this.logs.push(chunk.toString());
        const m = buf.match(/访问地址\s*:\s*(http:\/\/[^\s]+)/);
        if (m) { clearTimeout(timer); resolve(m[1]); }
      };
      proc.stdout.on('data', onData);
      proc.stderr.on('data', (chunk) => { buf += chunk.toString(); this.logs.push(chunk.toString()); });
      proc.on('exit', (code) => { clearTimeout(timer); reject(new Error(`serve.py 提前退出 code=${code}\n${buf.slice(-800)}`)); });
      proc.on('error', (err) => { clearTimeout(timer); reject(err); });
    });
    this.base = url.replace(/\/+$/, '');
    return this.base;
  }

  stop() {
    try { this.proc?.kill(); } catch { /* ignore */ }
    this.proc = null;
  }
}

/* ------------------------------ 页面注入脚本 ------------------------------ */
/* 在文档开始执行：记录首屏时间、包装 fetch/Response.json/JSON.parse、提供 warm 导航与 rAF 采样助手。
   注意：不使用模板字符串/反引号，避免与 String.raw 冲突。 */
const PAGE_SRC = String.raw`(() => {
  if (window.__perf) return;
  const P = window.__perf = {
    t0: performance.now(),
    firstViewAt: null,
    json: [],
    jsonParse: { count: 0, totalMs: 0 },
    allParse: { count: 0, totalMs: 0 },
    rafActive: null,
  };
  try { localStorage.setItem('r2.v2.ui.theme', 'dark'); } catch (e) { /* about:blank 等无 origin 场景 */ }

  /* --- fetch：记录 JSON 资源请求（响应头到达时间） --- */
  const origFetch = window.fetch;
  window.fetch = function (input, init) {
    const url = typeof input === 'string' ? input : ((input && input.url) || '');
    const start = performance.now();
    const p = origFetch.apply(this, arguments);
    p.then(function (res) {
      try {
        const ct = (res.headers && res.headers.get && res.headers.get('content-type')) || '';
        if (/\.json(\?|#|$)/i.test(url) || /json/i.test(ct)) {
          let abs = url;
          try { abs = new URL(url, location.href).href; } catch (e) { /* ignore */ }
          P.json.push({ url: abs, start: start, responseEnd: performance.now(), status: res.status, mime: ct, parse: null });
        }
      } catch (e) { /* ignore */ }
    }).catch(function () { /* app 自己处理 */ });
    return p;
  };

  /* --- Response.json：按资源记录解析耗时 --- */
  const origJson = Response.prototype.json;
  Response.prototype.json = function () {
    const self = this;
    const start = performance.now();
    return origJson.apply(this, arguments).then(function (value) {
      const end = performance.now();
      P.jsonParse.count += 1;
      P.jsonParse.totalMs += end - start;
      for (let i = P.json.length - 1; i >= 0; i -= 1) {
        const rec = P.json[i];
        if (rec.url === self.url && !rec.parse) { rec.parse = { start: start, end: end, ms: end - start }; break; }
      }
      return value;
    });
  };

  /* --- JSON.parse：全局解析总量/次数 --- */
  const origParse = JSON.parse;
  JSON.parse = function () {
    const start = performance.now();
    try { return origParse.apply(this, arguments); }
    finally { P.allParse.count += 1; P.allParse.totalMs += performance.now() - start; }
  };

  /* --- 首屏（第一个 .view 插入）--- */
  const checkView = function () {
    if (P.firstViewAt != null) return;
    if (document.querySelector('#view-root > .view')) P.firstViewAt = performance.now();
  };
  try {
    const mo = new MutationObserver(checkView);
    mo.observe(document, { childList: true, subtree: true });
  } catch (e) { /* ignore */ }
  checkView();

  /* --- warm 导航：改 hash 并等目标选择器出现（单 .view）--- */
  P.navTo = function (hash, selector) {
    return new Promise(function (resolve) {
      const t0 = performance.now();
      location.hash = hash;
      const tick = function () {
        let ok = false;
        try {
          ok = document.querySelectorAll(selector).length > 0
            && document.querySelectorAll('#view-root > .view').length === 1;
        } catch (e) { /* ignore */ }
        if (ok) resolve(performance.now() - t0);
        else requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
  };

  /* --- DOM 签名 & 事件→DOM 更新耗时 --- */
  P.sig = function () {
    const r = document.querySelector('#view-root');
    return [location.hash, r ? r.textContent.length : -1,
      document.querySelectorAll('#view-root .card, #view-root .lib-row').length].join('|');
  };
  P.measureAction = function (fn) {
    return new Promise(function (resolve) {
      const before = P.sig();
      const t0 = performance.now();
      try { fn(); } catch (e) { resolve({ ms: null, error: String(e && e.message) }); return; }
      let frames = 0;
      const tick = function () {
        frames += 1;
        if (P.sig() !== before || frames > 180) {
          requestAnimationFrame(function () { resolve({ ms: performance.now() - t0, frames: frames }); });
        } else {
          requestAnimationFrame(tick);
        }
      };
      requestAnimationFrame(tick);
    });
  };

  /* --- rAF 帧采样（含 p95 帧间隔 / longtask）--- */
  P.startRaf = function () {
    const s = {
      frames: 0, gaps: [], maxGapMs: 0, longFrames: 0, longTasks: 0,
      last: performance.now(), startedAt: performance.now(), stopped: false, po: null,
    };
    try {
      s.po = new PerformanceObserver(function (list) { s.longTasks += list.getEntries().length; });
      s.po.observe({ type: 'longtask', buffered: false });
    } catch (e) { s.po = null; }
    let id = 0;
    const tick = function () {
      const now = performance.now();
      const gap = now - s.last;
      s.last = now;
      if (s.frames > 0) {
        s.gaps.push(gap);
        if (gap > s.maxGapMs) s.maxGapMs = gap;
        if (gap > 50) s.longFrames += 1;
      }
      s.frames += 1;
      if (!s.stopped) id = requestAnimationFrame(tick);
    };
    id = requestAnimationFrame(tick);
    P.rafActive = s;
    return true;
  };
  P.stopRaf = function () {
    const s = P.rafActive;
    P.rafActive = null;
    if (!s) return null;
    s.stopped = true;
    try { s.po && s.po.disconnect(); } catch (e) { /* ignore */ }
    const gaps = s.gaps.slice().sort(function (a, b) { return a - b; });
    const p95 = gaps.length ? gaps[Math.min(gaps.length - 1, Math.ceil(gaps.length * 0.95) - 1)] : null;
    return {
      frames: s.frames,
      maxGapMs: Math.round(s.maxGapMs * 10) / 10,
      p95GapMs: p95 == null ? null : Math.round(p95 * 10) / 10,
      longFrames: s.longFrames,
      longTasks: s.longTasks,
      durationMs: Math.round(performance.now() - s.startedAt),
    };
  };

  /* --- 实验室穷举：点「重新穷举」，等状态栏出现「用时 N 毫秒」，返回墙钟+状态栏数字+rAF 统计 --- */
  P.runEnumeration = function () {
    return new Promise(function (resolve) {
      const root = document.querySelector('.lab-panel[data-panel="recommend"]') || document.querySelector('.lab-page');
      const statusOf = function () { const el = document.querySelector('.lab-rec__status'); return el ? (el.textContent || '') : ''; };
      const findBtn = function () {
        const scope = root || document;
        return Array.from(scope.querySelectorAll('button')).find(function (b) { return (b.textContent || '').includes('重新穷举'); }) || null;
      };
      const fail = function (msg) { P.stopRaf(); resolve({ error: msg, wallMs: null, reportedMs: null }); };
      const deadline = performance.now() + 120000;
      let timer = null;
      const waitBtn = function () {
        const btn = findBtn();
        if (btn && !btn.disabled) return start(btn);
        if (performance.now() > deadline) return fail('等待「重新穷举」按钮可点超时');
        requestAnimationFrame(waitBtn);
      };
      const start = function (btn) {
        P.startRaf();
        const t0 = performance.now();
        timer = setTimeout(function () { fail('穷举完成等待超时（120s）'); }, 120000);
        const done = function (payload) { clearTimeout(timer); resolve(payload); };
        const mo = new MutationObserver(function () {
          const t = statusOf();
          if (/用时\s*\d+\s*毫秒/.test(t) && !/穷举中/.test(t)) {
            mo.disconnect();
            const raf = P.stopRaf();
            const m = t.match(/用时\s*(\d+)\s*毫秒/);
            done({ wallMs: performance.now() - t0, reportedMs: Number(m[1]), statusText: t, raf: raf || null });
          }
        });
        try { mo.observe(root || document.body, { subtree: true, childList: true, characterData: true }); } catch (e) { /* ignore */ }
        btn.click();
      };
      waitBtn();
    });
  };

  /* --- 首屏元素/图片数 --- */
  P.screen = function () {
    const els = Array.from(document.querySelectorAll('#view-root .card, #view-root .lib-row, #view-root .bcard'));
    const visible = els.filter(function (e) {
      const r = e.getBoundingClientRect();
      return r.top < window.innerHeight && r.bottom > 0;
    }).length;
    return {
      renderedCards: els.length,
      visibleCards: visible,
      imgElements: document.images.length,
      imgTags: document.querySelectorAll('img').length,
      h1: document.querySelectorAll('h1').length,
    };
  };

  /* --- 汇总（导航计时/绘制/JSON）--- */
  P.summary = function () {
    const nav = performance.getEntriesByType('navigation')[0] || null;
    const fcp = performance.getEntriesByType('paint').filter(function (e) { return e.name === 'first-contentful-paint'; })[0] || null;
    return {
      firstViewAt: P.firstViewAt,
      theme: (document.documentElement && document.documentElement.dataset.theme) || '',
      domContentLoadedMs: nav ? nav.domContentLoadedEventEnd : null,
      loadMs: nav ? nav.loadEventEnd : null,
      responseEndMs: nav ? nav.responseEnd : null,
      fcpMs: fcp ? fcp.startTime : null,
      json: P.json.map(function (r) { return { url: r.url, start: r.start, responseEnd: r.responseEnd, status: r.status, mime: r.mime, parse: r.parse }; }),
      jsonParse: P.jsonParse,
      allParse: P.allParse,
    };
  };

  P.mem = function () {
    return {
      jsHeapBytes: null,
      images: document.images.length,
      imgTags: document.querySelectorAll('img').length,
      cardNodes: document.querySelectorAll('#view-root .card, #view-root .lib-row').length,
      domNodes: document.getElementsByTagName('*').length,
    };
  };
})()`;

/* ------------------------------ CDP 页面会话 ------------------------------ */
class NetCollector {
  constructor(root, sid) {
    this.root = root;
    this.sid = sid;
    this.offs = [];
    this.reset();
  }

  reset() {
    this.req = new Map();
    this.byId = new Map();
    this.fin = new Map();
    this.failed = [];
    this.startedAt = Date.now();
  }

  attach() {
    const add = (method, fn) => {
      const off = this.root.on(method, (p, sid) => { if (sid === this.sid) fn(p || {}); });
      this.offs.push(off);
      return off;
    };
    add('Network.requestWillBeSent', (p) => {
      const url = String((p.request && p.request.url) || '');
      if (!url || /^(data|blob|chrome-extension):/i.test(url)) return;
      let origin = '';
      try { origin = new URL(url).origin; } catch { return; }
      if (this.baseOrigin && origin !== this.baseOrigin) return;
      const rec = {
        id: p.requestId, url, type: String(p.type || (p.request && p.request.type) || 'Other'),
        start: p.timestamp, wallStart: Date.now(), status: null, mime: '', bytes: 0, end: null,
      };
      this.req.set(p.requestId, rec);
      this.byId.set(p.requestId, rec);
    });
    add('Network.responseReceived', (p) => {
      const rec = this.byId.get(p.requestId);
      if (!rec) return;
      const resp = p.response || {};
      rec.status = Number(resp.status) || 0;
      rec.mime = String(resp.mimeType || '');
      if (p.type) rec.type = String(p.type);
    });
    add('Network.loadingFinished', (p) => {
      const rec = this.byId.get(p.requestId);
      if (!rec) return;
      rec.bytes = Number(p.encodedDataLength) || 0;
      rec.end = p.timestamp;
    });
    add('Network.loadingFailed', (p) => {
      const rec = this.byId.get(p.requestId);
      this.failed.push({ url: rec ? rec.url : '', type: rec ? rec.type : '', error: String(p.errorText || '') });
    });
    return this;
  }

  summary() {
    const byType = {};
    const countByType = {};
    let totalBytes = 0;
    const json = [];
    for (const rec of this.req.values()) {
      const type = rec.type || 'Other';
      const bytes = rec.bytes || 0;
      totalBytes += bytes;
      byType[type] = (byType[type] || 0) + bytes;
      countByType[type] = (countByType[type] || 0) + 1;
      const isJson = /json/i.test(rec.mime) || /\.json(\?|#|$)/i.test(rec.url);
      if (isJson) {
        const durationMs = rec.end && rec.start ? (rec.end - rec.start) * 1000 : null;
        let rel = rec.url;
        try { const u = new URL(rec.url); rel = u.pathname + u.search; } catch { /* ignore */ }
        json.push({ url: rec.url, path: rel, bytes, status: rec.status, durationMs: round(durationMs, 2) });
      }
    }
    return {
      totalRequests: this.req.size,
      totalBytes,
      byType: roundAll(byType, 0),
      countByType,
      jsBytes: byType.Script || 0,
      cssBytes: byType.Stylesheet || 0,
      imgBytes: byType.Image || 0,
      jsonBytes: byType.Fetch || byType.XHR || 0,
      imageRequests: countByType.Image || 0,
      documentRequests: countByType.Document || 0,
      failedRequests: this.failed.slice(0, 10),
      jsonRequests: json.slice(0, 40),
    };
  }

  stop() {
    for (const off of this.offs) { try { off(); } catch { /* ignore */ } }
    this.offs = [];
  }
}

class Session {
  constructor({ root, targetId, sid, page, net, errors }) {
    this.root = root; this.targetId = targetId; this.sid = sid;
    this.page = page; this.net = net; this.errors = errors;
  }
}

class Browser {
  constructor() {
    this.launch = null;
    this.root = null;
    this.handlers = [];
  }

  async start() {
    this.launch = launchChrome({ width: VIEWPORT.width, height: VIEWPORT.height });
    // 慢场景（S8 移动+4x CPU）单次 evaluate/导航可能 >30s，放宽 CDP 超时
    this.root = await withTimeout(CDP.connect(await this.launch.wsUrl, { timeout: 120000 }), 60000, 'CDP.connect');
    return this.root;
  }

  async newSession({ coldCache = false, mobile = false, cpuThrottle = 1, baseOrigin = '' } = {}) {
    dbg('newSession: createTarget');
    const created = await withTimeout(this.root.send('Target.createTarget', { url: 'about:blank' }), 20000, 'Target.createTarget');
    dbg('newSession: attachToTarget');
    const attached = await withTimeout(this.root.send('Target.attachToTarget', { targetId: created.targetId, flatten: true }), 20000, 'Target.attachToTarget');
    const sid = attached.sessionId;
    const send = (m, p = {}) => this.root.send(m, p, sid);
    const errors = [];
    const page = new Page(send);
    const net = new NetCollector(this.root, sid);
    net.baseOrigin = baseOrigin;
    const handlers = [];
    const on = (method, fn) => {
      const off = this.root.on(method, (p, s) => { if (s === sid) fn(p || {}); });
      handlers.push(off);
    };
    on('Runtime.consoleAPICalled', (p) => {
      if (p.type === 'error' || p.type === 'assert') {
        const text = (p.args || []).map((a) => a.value ?? a.description ?? a.type).join(' ');
        errors.push({ kind: p.type, text: String(text).slice(0, 400) });
      }
    });
    on('Runtime.exceptionThrown', (p) => {
      const d = p.exceptionDetails || {};
      const desc = (d.exception && (d.exception.description || d.exception.value)) || d.text || '未知异常';
      errors.push({ kind: 'exception', text: String(desc).slice(0, 600) });
    });
    dbg('newSession: enable domains');
    for (const fn of ['Page.enable', 'Runtime.enable', 'Network.enable', 'Log.enable', 'Performance.enable', 'HeapProfiler.enable']) {
      await withTimeout(send(fn), 15000, fn).catch(() => {});
    }
    dbg('newSession: emulation');
    await withTimeout(send('Emulation.setDeviceMetricsOverride', mobile ? MOBILE : VIEWPORT), 15000, 'setDeviceMetricsOverride').catch(() => {});
    await withTimeout(send('Emulation.setEmulatedMedia', { features: THEME_FEATURE }), 15000, 'setEmulatedMedia').catch(() => {});
    if (cpuThrottle && cpuThrottle !== 1) {
      await withTimeout(send('Emulation.setCPUThrottlingRate', { rate: cpuThrottle }), 15000, 'setCPUThrottlingRate').catch(() => {});
    }
    await withTimeout(send('Page.addScriptToEvaluateOnNewDocument', { source: PAGE_SRC }), 15000, 'addScriptToEvaluateOnNewDocument').catch(() => {});
    if (coldCache) {
      await withTimeout(send('Network.setCacheDisabled', { cacheDisabled: true }), 15000, 'setCacheDisabled').catch(() => {});
      await withTimeout(send('Network.clearBrowserCache'), 20000, 'clearBrowserCache').catch(() => {});
    } else {
      await withTimeout(send('Network.setCacheDisabled', { cacheDisabled: true }), 15000, 'setCacheDisabled').catch(() => {});
    }
    net.attach();
    const session = new Session({ root: this.root, targetId: created.targetId, sid, page, net, errors });
    session.handlers = handlers;
    return session;
  }

  async closeSession(session) {
    for (const off of session.handlers || []) { try { off(); } catch { /* ignore */ } }
    try { session.net.stop(); } catch { /* ignore */ }
    await withTimeout(this.root.send('Target.closeTarget', { targetId: session.targetId }), 15000, 'Target.closeTarget').catch(() => {});
  }

  async version() {
    try {
      const v = await withTimeout(this.root.send('Browser.getVersion'), 15000, 'Browser.getVersion');
      return v.product || '';
    } catch { return ''; }
  }

  /** S8 结束后显式恢复：清设备模拟 + CPU 限速归 1（每 session 独立，这里用探针 session 证明已复位） */
  async resetEmulation() {
    let probe = null;
    try {
      probe = await withTimeout(this.newSession(), 60000, 'resetEmulation.newSession');
      await withTimeout(probe.page.send('Emulation.setCPUThrottlingRate', { rate: 1 }), 15000, 'reset CPU rate').catch(() => {});
      await withTimeout(probe.page.send('Emulation.clearDeviceMetricsOverride'), 15000, 'clear metrics').catch(() => {});
      return true;
    } catch { return false; } finally {
      if (probe) await this.closeSession(probe);
    }
  }

  stop() {
    // 尽量保证不留 Chrome 进程：Windows 杀整棵进程树，再走 cdp 库清理临时 profile
    try {
      const pid = this.launch?.child?.pid;
      if (process.platform === 'win32' && pid) {
        spawnSync('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore', timeout: 10000 });
      }
    } catch { /* ignore */ }
    try { this.root?.close?.(); } catch { /* ignore */ }
    if (this.launch) cleanupChrome({ child: this.launch.child, profile: this.launch.profile });
  }
}

class Page {
  constructor(send, { timeout = 60000 } = {}) { this.send = send; this.timeout = timeout; }

  async ev(expression, { awaitPromise = false, timeout } = {}) {
    const ms = timeout || this.timeout;
    const r = await withTimeout(this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise }), ms, 'Runtime.evaluate');
    if (r.exceptionDetails) throw new Error('页面异常：' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
    return r.result ? r.result.value : undefined;
  }

  async waitDoc(timeout = 30000) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
      try {
        if (await this.ev(`document.readyState === 'complete' && !!window.__perf`, { timeout: 15000 })) return true;
      } catch { /* 导航中 */ }
      await sleep(40);
    }
    throw new Error(`等待文档就绪超时（${timeout}ms）`);
  }

  async waitFor(expr, timeout = 30000, interval = 60) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
      const ok = await this.ev(`(() => { try { return !!(${expr}); } catch (e) { return false; } })()`, { timeout: 15000 }).catch(() => false);
      if (ok) return true;
      await sleep(interval);
    }
    return false;
  }

  async navigate(url, timeout = 60000) {
    await withTimeout(this.send('Page.navigate', { url }), timeout, 'Page.navigate');
    await this.waitDoc(timeout);
  }

  async metrics(timeout = 20000) {
    const m = await withTimeout(this.send('Performance.getMetrics'), timeout, 'Performance.getMetrics').catch(() => null);
    if (!m) return {};
    const out = {};
    for (const row of m.metrics || []) out[row.name] = row.value;
    return out;
  }

  async gc(timeout = 30000) {
    await withTimeout(this.send('HeapProfiler.collectGarbage'), timeout, 'HeapProfiler.collectGarbage').catch(() => {});
    await sleep(120);
  }
}

/* ------------------------------ 领域就绪选择器 ------------------------------ */
const READY_SEL = {
  items: '#view-root .lib-root .card',
  lab: '#view-root .lab-page .lab-rec__status',
  builds: '#view-root .builds-root .bcard',
  codex: '#view-root .codex-root .codex-toc__item',
};
const ROUTES = {
  items: '#/items',
  lab: '#/lab',
  builds: '#/builds',
  codex: '#/codex',
};

async function waitRouteReady(page, domain, timeout = 60000) {
  const ok = await page.waitFor(
    `document.querySelectorAll(${JSON.stringify(READY_SEL[domain])}).length > 0
     && document.querySelectorAll('#view-root > .view').length === 1`,
    timeout,
  );
  if (!ok) throw new Error(`等待 ${domain} 就绪超时（${timeout}ms）`);
  return true;
}

function jsonStats(summary) {
  const json = summary.json || [];
  const parsed = json.filter((r) => r.parse);
  const parsedBeforeView = (summary.firstViewAt == null)
    ? parsed
    : parsed.filter((r) => r.parse.end <= summary.firstViewAt);
  const parseDoneAt = parsedBeforeView.length ? Math.max(...parsedBeforeView.map((r) => r.parse.end)) : null;
  const jsonFetchMs = json.reduce((s, r) => s + Math.max(0, (r.responseEnd || 0) - (r.start || 0)), 0);
  const jsonParseMs = parsed.reduce((s, r) => s + r.parse.ms, 0);
  const parseAfterViewMs = parsed
    .filter((r) => summary.firstViewAt != null && r.parse.end > summary.firstViewAt)
    .reduce((s, r) => s + r.parse.ms, 0);
  return {
    jsonRequests: json.length,
    jsonFetchMs: round(jsonFetchMs, 1),
    jsonParseMs: round(jsonParseMs, 1),
    jsonParseCount: summary.jsonParse ? summary.jsonParse.count : 0,
    allJsonParseMs: round(summary.allParse ? summary.allParse.totalMs : 0, 1),
    allJsonParseCount: summary.allParse ? summary.allParse.count : 0,
    parseDoneAt,
    parseDoneToFirstViewMs: (parseDoneAt != null && summary.firstViewAt != null)
      ? round(summary.firstViewAt - parseDoneAt, 1) : null,
    parseAfterViewMs: round(parseAfterViewMs, 1),
  };
}

/* ------------------------------ S1 冷启 ------------------------------ */
const S1_MEDIAN_KEYS = [
  'firstViewMs', 'domContentLoadedMs', 'fcpMs', 'wallMs',
  'totalRequests', 'totalBytes', 'jsBytes', 'cssBytes', 'imgBytes', 'jsonBytes', 'imageRequests',
  'jsonRequests', 'jsonFetchMs', 'jsonParseMs', 'jsonParseCount', 'parseDoneToFirstViewMs',
  'renderedCards', 'visibleCards', 'imgElements',
];

async function measureColdPage(browser, domain, { mobile = false, cpuThrottle = 1 } = {}) {
  const session = await browser.newSession({ coldCache: true, mobile, cpuThrottle, baseOrigin: new URL(SERVER_BASE).origin });
  const { page } = session;
  try {
    const t0 = Date.now();
    await page.navigate(`${SERVER_BASE}/${ROUTES[domain]}`);
    const tNav = Date.now();
    const firstOk = await page.waitFor('window.__perf && window.__perf.firstViewAt != null', 60000);
    if (!firstOk) throw new Error(`${domain} 首屏 .view 未出现（60s）`);
    const tFirst = Date.now();
    await waitRouteReady(page, domain, 60000);
    const tReady = Date.now();
    await page.waitFor(`document.readyState === 'complete'`, 30000);
    const tLoad = Date.now();
    await sleep(300); // 让图片/字体等首屏请求落地，字节统计稳定
    const summary = await page.ev('window.__perf.summary()');
    const screen = await page.ev('window.__perf.screen()');
    const net = session.net.summary();
    const jsonBytes = (net.jsonRequests || []).reduce((sum, r) => sum + (Number(r.bytes) || 0), 0);
    const wallMs = Date.now() - t0;
    const js = jsonStats(summary);
    const jsonResources = (summary.json || []).map((r) => {
      let rel = r.url;
      try { const u = new URL(r.url); rel = u.pathname + u.search; } catch { /* ignore */ }
      return {
        path: rel,
        status: r.status,
        fetchMs: round((r.responseEnd || 0) - (r.start || 0), 1),
        parseMs: r.parse ? round(r.parse.ms, 1) : null,
        parseStart: r.parse ? round(r.parse.start, 1) : null,
        parseEnd: r.parse ? round(r.parse.end, 1) : null,
      };
    });
    return {
      route: domain,
      firstViewMs: round(summary.firstViewAt, 1),
      domContentLoadedMs: round(summary.domContentLoadedMs, 1),
      loadMs: round(summary.loadMs, 1),
      fcpMs: round(summary.fcpMs, 1),
      responseEndMs: round(summary.responseEndMs, 1),
      wallMs: round(wallMs, 0),
      phases: { navigateMs: tNav - t0, firstViewWaitMs: tFirst - tNav, readyMs: tReady - tFirst, loadWaitMs: tLoad - tReady },
      theme: summary.theme,
      viewport: mobile ? '390x844' : '1440x1000',
      cpuThrottle,
      requests: {
        total: net.totalRequests,
        byType: net.countByType,
        bytesByType: net.byType,
        totalBytes: net.totalBytes,
        jsBytes: net.jsBytes,
        cssBytes: net.cssBytes,
        imgBytes: net.imgBytes,
        imageRequests: net.imageRequests,
        failed: net.failedRequests.length,
      },
      jsonResources: net.jsonRequests,
      jsonBytes,
      totalRequests: net.totalRequests,
      totalBytes: net.totalBytes,
      jsBytes: net.jsBytes,
      cssBytes: net.cssBytes,
      imgBytes: net.imgBytes,
      imageRequests: net.imageRequests,
      ...js,
      jsonResources,
      ...screen,
      consoleErrors: session.errors.length,
      errorSamples: session.errors.slice(0, 3),
    };
  } finally {
    await browser.closeSession(session);
  }
}

function medianSample(samples, keys) {
  const out = {};
  for (const k of keys) out[k] = round(median(samples.map((s) => s[k])), 1);
  return out;
}

async function runS1(browser, repeat) {
  const routes = {};
  const routeList = (opts.routes && opts.routes.length) ? opts.routes : ['items', 'lab', 'builds', 'codex'];
  // 预热：首个冷启会带上 OS 文件缓存/Chrome 首次编译等一次性成本，丢弃一轮保证可重复
  log(`  S1 预热（丢弃一轮冷启：${routeList.join(',')}）…`);
  for (const domain of routeList) await measureColdPage(browser, domain);
  for (const domain of routeList) {
    const samples = [];
    for (let i = 0; i < repeat; i += 1) {
      log(`  S1 ${domain} 第 ${i + 1}/${repeat} 次冷启…`);
      samples.push(await measureColdPage(browser, domain));
    }
    routes[domain] = {
      samples,
      median: medianSample(samples, S1_MEDIAN_KEYS),
      spreadPct: {
        firstViewMs: spreadPct(samples.map((s) => s.firstViewMs)),
        wallMs: spreadPct(samples.map((s) => s.wallMs)),
      },
    };
  }
  return {
    methods: '每次采样新建 target + Network.clearBrowserCache + cacheDisabled（冷缓存）；采样前先丢弃一轮 4 路由预热（OS 文件缓存/Chrome 首次编译成本）；导航到领域根路由；firstView=第一个 .view 插入（页面内 MutationObserver），DCL/FCP 取 PerformanceNavigationTiming/PerformancePaintTiming；字节取 Network.loadingFinished.encodedDataLength，按 responseReceived.type 归集；请求窗口=导航→load+300ms。',
    routes,
  };
}

/* ------------------------------ S2（由 S1 采样派生） ------------------------------ */
function deriveS2(s1) {
  const routes = {};
  for (const [domain, data] of Object.entries(s1.routes)) {
    const samples = data.samples;
    const keys = ['jsonRequests', 'jsonFetchMs', 'jsonParseMs', 'jsonParseCount', 'allJsonParseMs', 'allJsonParseCount', 'parseDoneToFirstViewMs', 'firstViewMs'];
    routes[domain] = {
      median: medianSample(samples, keys),
      jsonRequests: samples[0].jsonRequests,
      jsonResources: samples[0].jsonResources,
    };
  }
  return {
    methods: '页面注入：fetch 包装记录 JSON 请求起止；Response.prototype.json 记录每资源解析耗时；JSON.parse 包装记录全局解析总量；parseDoneToFirstView = 首个 .view 时间 − 最后一次数据 JSON 解析完成时间（boot 的 api.ready 之后才有首屏，故通常为正）。字段由 S1 同一批冷启样本派生，不额外启动浏览器。',
    routes,
  };
}

/* ------------------------------ S3 各领域首开（warm 页面） ------------------------------ */
async function measureWarmFirstOpenSequence(browser, repeat) {
  const samples = [];

  async function oneRound(i, total) {
    // 页面 A：先冷开 items，再 warm 首开 builds/codex/lab
    const a = await browser.newSession({ coldCache: true, baseOrigin: new URL(SERVER_BASE).origin });
    const out = {};
    try {
      await a.page.navigate(`${SERVER_BASE}/${ROUTES.items}`);
      await waitRouteReady(a.page, 'items', 60000);
      const evNum = (expr) => a.page.ev(expr, { awaitPromise: true });
      out.builds = round(await evNum(`window.__perf.navTo('#/builds', ${JSON.stringify(READY_SEL.builds)})`), 1);
      out.codex = round(await evNum(`window.__perf.navTo('#/codex', ${JSON.stringify(READY_SEL.codex)})`), 1);
      out.lab = round(await evNum(`window.__perf.navTo('#/lab', ${JSON.stringify(READY_SEL.lab)})`), 1);
    } finally { await browser.closeSession(a); }
    // 页面 B：先冷开 builds，再 warm 首开 items（保证四个领域都有"首开"样本）
    const b = await browser.newSession({ coldCache: true, baseOrigin: new URL(SERVER_BASE).origin });
    try {
      await b.page.navigate(`${SERVER_BASE}/${ROUTES.builds}`);
      await waitRouteReady(b.page, 'builds', 60000);
      out.items = round(await b.page.ev(`window.__perf.navTo('#/items', ${JSON.stringify(READY_SEL.items)})`, { awaitPromise: true }), 1);
    } finally { await browser.closeSession(b); }
    if (i > 0) log(`  S3 第 ${i}/${total} 轮：items=${out.items}ms lab=${out.lab}ms builds=${out.builds}ms codex=${out.codex}ms`);
    return out;
  }

  log('  S3 预热（丢弃一轮首开序列）…');
  await oneRound(0, repeat);
  for (let i = 0; i < repeat; i += 1) samples.push(await oneRound(i + 1, repeat));
  const med = {};
  for (const key of ['items', 'lab', 'builds', 'codex']) med[key] = round(median(samples.map((s) => s[key])), 1);
  return {
    methods: '同一页面 warm 切换：页面 A 冷开 #/items 后依次首开 builds/codex/lab；页面 B 冷开 #/builds 后首开 items（四个领域各取到一次真正首开）。耗时=location.hash 变更→领域就绪选择器出现（单 .view），含懒加载 module/style/data。采样前丢弃一轮预热。',
    samples,
    median: med,
    spreadPct: Object.fromEntries(['items', 'lab', 'builds', 'codex'].map((k) => [k, spreadPct(samples.map((s) => s[k]))])),
  };
}

/* ------------------------------ S4 页面切换 ------------------------------ */
async function runS4(browser, repeat, { cycles = 6, mobile = false, cpuThrottle = 1 } = {}) {
  const samples = [];
  const ORDER = ['items', 'lab', 'builds', 'codex'];
  for (let i = 0; i < repeat; i += 1) {
    const session = await browser.newSession({ coldCache: true, mobile, cpuThrottle, baseOrigin: new URL(SERVER_BASE).origin });
    const switches = [];
    try {
      await session.page.navigate(`${SERVER_BASE}/${ROUTES.items}`);
      await waitRouteReady(session.page, 'items', 90000);
      for (let c = 0; c < cycles; c += 1) {
        for (let idx = 0; idx < ORDER.length; idx += 1) {
          const from = ORDER[idx];
          const to = ORDER[(idx + 1) % ORDER.length];
          const ms = await session.page.ev(`window.__perf.navTo('#/${to}', ${JSON.stringify(READY_SEL[to])})`, { awaitPromise: true });
          switches.push({ from, to, ms: round(ms, 1) });
        }
      }
    } finally { await browser.closeSession(session); }
    const durations = switches.map((s) => s.ms);
    samples.push({ switches, medianMs: round(median(durations), 1), p95Ms: round(percentile(durations, 95), 1), wallMs: round(durations.reduce((a, b) => a + b, 0), 0) });
    log(`  S4 第 ${i + 1}/${repeat} 轮：${switches.length} 次切换 median=${samples[i].medianMs}ms p95=${samples[i].p95Ms}ms`);
  }
  return {
    methods: '单页面 warm 切换，items→lab→builds→codex 循环 N 轮；每次耗时=location.hash 变更→目标领域就绪选择器出现（含懒加载/数据缓存）。',
    cyclesPerSample: cycles,
    switchesPerSample: cycles * 4,
    samples,
    medianMs: round(median(samples.map((s) => s.medianMs)), 1),
    p95Ms: round(median(samples.map((s) => s.p95Ms)), 1),
    spreadPct: spreadPct(samples.map((s) => s.medianMs)),
  };
}

/* ------------------------------ S5 搜索/筛选 ------------------------------ */
const S5_PAGE_JS = String.raw`(async () => {
  const P = window.__perf;
  const $ = (s) => document.querySelector(s);
  const input = $('#libSearch');
  const setInput = (v) => { input.value = v; input.dispatchEvent(new Event('input', { bubbles: true })); };
  const chips = () => Array.from(document.querySelectorAll('.lib-cats .chip'));
  const reset = async () => {
    setInput('');
    const all = chips().find((b) => (b.textContent || '').trim().startsWith('全部'));
    if (all) all.click();
    const sel = $('.lib-sort');
    if (sel && sel.value !== 'default') { sel.value = 'default'; sel.dispatchEvent(new Event('change', { bubbles: true })); }
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  };
  await reset();
  const out = {};
  out.input2 = await P.measureAction(() => setInput('暴击'));
  out.input4 = await P.measureAction(() => setInput('暴击伤害'));
  await reset();
  const weapon = chips().find((b) => /武器/.test(b.textContent || '')) || chips()[1] || chips()[0];
  out.catChip = await P.measureAction(() => weapon.click());
  await reset();
  const sel = $('.lib-sort');
  const opt = Array.from(sel.options).find((o) => o.value === 'name') || Array.from(sel.options).find((o) => o.value !== 'default') || sel.options[0];
  out.sort = await P.measureAction(() => { sel.value = opt.value; sel.dispatchEvent(new Event('change', { bubbles: true })); });
  await reset();
  out.combo = await P.measureAction(() => {
    setInput('护甲');
    const armor = chips().find((b) => /护甲/.test(b.textContent || ''));
    if (armor) armor.click();
    const s = $('.lib-sort');
    const v = Array.from(s.options).find((o) => o.value === 'armor') || Array.from(s.options).find((o) => o.value !== 'default');
    if (v) { s.value = v.value; s.dispatchEvent(new Event('change', { bubbles: true })); }
  });
  const cards = document.querySelectorAll('#view-root .card, #view-root .lib-row').length;
  return {
    input2Ms: out.input2 && out.input2.ms, input4Ms: out.input4 && out.input4.ms,
    catChipMs: out.catChip && out.catChip.ms, sortMs: out.sort && out.sort.ms,
    comboMs: out.combo && out.combo.ms, cardsAfter: cards,
    frames: { input2: out.input2 && out.input2.frames, combo: out.combo && out.combo.frames },
  };
})()`;

async function runS5(browser, repeat) {
  const samples = [];
  async function oneSample(i, total) {
    const session = await browser.newSession({ coldCache: true, baseOrigin: new URL(SERVER_BASE).origin });
    try {
      await session.page.navigate(`${SERVER_BASE}/${ROUTES.items}`);
      await waitRouteReady(session.page, 'items', 90000);
      await sleep(200);
      const r = await session.page.ev(S5_PAGE_JS, { awaitPromise: true });
      if (i > 0) log(`  S5 第 ${i}/${total} 轮：input2=${round(r.input2Ms)}ms input4=${round(r.input4Ms)}ms cat=${round(r.catChipMs)}ms sort=${round(r.sortMs)}ms combo=${round(r.comboMs)}ms`);
      return { ...r, consoleErrors: session.errors.length };
    } finally { await browser.closeSession(session); }
  }
  log('  S5 预热（丢弃一轮）…');
  await oneSample(0, repeat);
  for (let i = 0; i < repeat; i += 1) samples.push(await oneSample(i + 1, repeat));
  const keys = ['input2Ms', 'input4Ms', 'catChipMs', 'sortMs', 'comboMs', 'cardsAfter'];
  return {
    methods: '资料库事件→DOM 更新（同步 handler 后下一帧）：输入 2 字「暴击」、4 字「暴击伤害」、分类 chip「武器」、排序 select（name/首个非默认）、组合筛选（搜索+分类+排序，一次动作内串行触发，统计整组）。每项先用「全部 + 空搜索 + 默认排序」复位。',
    samples,
    median: medianSample(samples, keys),
    spreadPct: Object.fromEntries(keys.map((k) => [k, spreadPct(samples.map((s) => s[k]))])),
  };
}

/* ------------------------------ S6 内存 ------------------------------ */
async function runS6(browser, repeat) {
  const samples = [];
  const ORDER = ['lab', 'builds', 'codex', 'items'];
  for (let i = 0; i < repeat; i += 1) {
    const session = await browser.newSession({ coldCache: true, baseOrigin: new URL(SERVER_BASE).origin });
    let out = null;
    try {
      const { page } = session;
      await page.navigate(`${SERVER_BASE}/${ROUTES.items}`);
      await waitRouteReady(page, 'items', 90000);
      await sleep(500);
      await page.gc();
      const m1 = await page.metrics();
      const s1 = await page.ev('window.__perf.screen()');
      const first = {
        jsHeapMB: round((m1.JSHeapUsedSize || 0) / 1024 / 1024, 2),
        nodes: m1.Nodes ?? null,
        documents: m1.Documents ?? null,
        images: s1.imgElements,
        domNodes: s1.renderedCards,
      };
      const t0 = Date.now();
      for (let n = 0; n < 20; n += 1) {
        const to = ORDER[n % ORDER.length];
        dbg(`S6 switch ${n + 1}/20 -> ${to}`);
        await page.ev(`window.__perf.navTo('#/${to}', ${JSON.stringify(READY_SEL[to])})`, { awaitPromise: true });
      }
      dbg('S6 switches done, gc/metrics');
      await sleep(300);
      await page.gc();
      const m2 = await page.metrics();
      const s2 = await page.ev('window.__perf.screen()');
      const after = {
        jsHeapMB: round((m2.JSHeapUsedSize || 0) / 1024 / 1024, 2),
        nodes: m2.Nodes ?? null,
        documents: m2.Documents ?? null,
        images: s2.imgElements,
        domNodes: s2.renderedCards,
      };
      out = {
        first, after, switches: 20, wallMs: Date.now() - t0,
        growth: {
          jsHeapMB: round(after.jsHeapMB - first.jsHeapMB, 2),
          nodes: (after.nodes != null && first.nodes != null) ? after.nodes - first.nodes : null,
          documents: (after.documents != null && first.documents != null) ? after.documents - first.documents : null,
          images: after.images - first.images,
        },
        consoleErrors: session.errors.length,
      };
    } finally { await browser.closeSession(session); }
    samples.push(out);
    log(`  S6 第 ${i + 1}/${repeat} 轮：heap ${samples[i].first.jsHeapMB}→${samples[i].after.jsHeapMB}MB（Δ${samples[i].growth.jsHeapMB}）nodes Δ${samples[i].growth.nodes}`);
  }
  const medOf = (get) => round(median(samples.map(get)), 2);
  return {
    methods: '首屏（items）GC 后 vs 20 次页面切换后 GC：Performance.getMetrics 的 JSHeapUsedSize/Nodes/Documents；图片数=document.images.length。每轮新 target，GC 用 HeapProfiler.collectGarbage。',
    samples,
    median: {
      firstHeapMB: medOf((s) => s.first.jsHeapMB),
      afterHeapMB: medOf((s) => s.after.jsHeapMB),
      heapGrowthMB: medOf((s) => s.growth.jsHeapMB),
      nodesGrowth: medOf((s) => s.growth.nodes),
      documentsGrowth: medOf((s) => s.growth.documents),
      imagesFirst: medOf((s) => s.first.images),
      imagesAfter: medOf((s) => s.after.images),
    },
  };
}

/* ------------------------------ S7 实验室穷举 ------------------------------ */
async function runS7(browser, repeat) {
  const samples = [];
  for (let i = 0; i < repeat; i += 1) {
    const session = await browser.newSession({ coldCache: true, baseOrigin: new URL(SERVER_BASE).origin });
    try {
      const { page } = session;
      await page.navigate(`${SERVER_BASE}/#/lab?panel=recommend`);
      await waitRouteReady(page, 'lab', 120000);
      // 首次进入会自动跑一轮；等按钮可点（非运行态）再点「重新穷举」获得可对比样本
      const ready = await page.waitFor(`(() => { const b = Array.from(document.querySelectorAll('.lab-panel[data-panel="recommend"] button')).find((x) => (x.textContent || '').includes('重新穷举')); return !!(b && !b.disabled); })()`, 180000);
      if (!ready) throw new Error('实验室穷举按钮 180s 内不可用');
      const r = await page.ev('window.__perf.runEnumeration()', { awaitPromise: true });
      if (r.error) throw new Error('穷举失败：' + r.error);
      const raf = r.raf || {};
      samples.push({
        wallMs: round(r.wallMs, 0),
        reportedMs: r.reportedMs,
        frames: raf.frames ?? null,
        p95GapMs: raf.p95GapMs ?? null,
        maxGapMs: raf.maxGapMs ?? null,
        longFrames: raf.longFrames ?? null,
        longTasks: raf.longTasks ?? null,
        avgFps: raf.frames && r.wallMs ? round((raf.frames / (r.wallMs / 1000)), 1) : null,
        statusText: r.statusText,
        consoleErrors: session.errors.length,
      });
    } finally { await browser.closeSession(session); }
    const s = samples[samples.length - 1];
    log(`  S7 第 ${i + 1}/${repeat} 轮：墙钟 ${s.wallMs}ms / 状态栏 ${s.reportedMs}ms / ${s.frames} 帧 / rAF p95 ${s.p95GapMs}ms max ${s.maxGapMs}ms / longTask ${s.longTasks}`);
  }
  return {
    methods: '进入 #/lab?panel=recommend，等自动穷举完成、按钮可点后点「重新穷举」；墙钟=click→状态栏出现「用时 N 毫秒」；同时 rAF 采样帧数/帧间隔 p95/max（>50ms 记 longFrame）并用 PerformanceObserver 统计 longtask 数。',
    samples,
    median: {
      wallMs: round(median(samples.map((s) => s.wallMs)), 0),
      reportedMs: round(median(samples.map((s) => s.reportedMs)), 0),
      frames: round(median(samples.map((s) => s.frames)), 0),
      p95GapMs: round(median(samples.map((s) => s.p95GapMs)), 1),
      maxGapMs: round(median(samples.map((s) => s.maxGapMs)), 1),
      longFrames: round(median(samples.map((s) => s.longFrames)), 0),
      longTasks: round(median(samples.map((s) => s.longTasks)), 0),
      avgFps: round(median(samples.map((s) => s.avgFps)), 1),
    },
  };
}

/* ------------------------------ S8 低性能/移动 ------------------------------ */
async function runS8(browser, repeat) {
  const rounds = Math.min(2, repeat);
  log('  S8 预热（丢弃一轮 items mobile+4x 冷启）…');
  await measureColdPage(browser, 'items', { mobile: true, cpuThrottle: 4 });
  const s1Samples = [];
  for (let i = 0; i < rounds; i += 1) {
    log(`  S8 S1(items) mobile+4x 第 ${i + 1}/${rounds} 次…`);
    s1Samples.push(await measureColdPage(browser, 'items', { mobile: true, cpuThrottle: 4 }));
  }
  const s3Samples = [];
  for (let i = 0; i < rounds; i += 1) {
    log(`  S8 S3 第 ${i + 1}/${rounds} 轮（mobile+4x 冷开 items）…`);
    const session = await browser.newSession({ coldCache: true, mobile: true, cpuThrottle: 4, baseOrigin: new URL(SERVER_BASE).origin });
    try {
      const tStart = Date.now();
      await session.page.navigate(`${SERVER_BASE}/${ROUTES.items}`);
      await waitRouteReady(session.page, 'items', 180000);
      log(`  S8 S3 items 就绪 ${Date.now() - tStart}ms，开始 warm 首开…`);
      const out = {};
      for (const [hash, sel, key] of [
        ['#/lab', READY_SEL.lab, 'lab'],
        ['#/builds', READY_SEL.builds, 'builds'],
        ['#/codex', READY_SEL.codex, 'codex'],
      ]) {
        const t0 = Date.now();
        out[key] = round(await session.page.ev(`window.__perf.navTo(${JSON.stringify(hash)}, ${JSON.stringify(sel)})`, { awaitPromise: true }), 1);
        log(`  S8 S3 ${key}: ${out[key]}ms（墙钟 ${Date.now() - t0}ms）`);
      }
      out.items = round(await session.page.ev(`window.__perf.navTo('#/items', ${JSON.stringify(READY_SEL.items)})`, { awaitPromise: true }), 1);
      s3Samples.push(out);
    } finally { await browser.closeSession(session); }
  }
  const s4 = await runS4(browser, rounds, { cycles: 2, mobile: true, cpuThrottle: 4 });
  const s3Median = {};
  for (const key of ['items', 'lab', 'builds', 'codex']) s3Median[key] = round(median(s3Samples.map((s) => s[key])), 1);
  return {
    methods: 'Emulation.setDeviceMetricsOverride(390×844, mobile) + Emulation.setCPUThrottlingRate(4)；S1(items) 冷启、S3 warm 首开、S4 2 轮切换复用同口径。样本数=min(2, repeat)。',
    viewport: '390x844',
    cpuThrottle: 4,
    samples: rounds,
    S1: { items: { samples: s1Samples, median: medianSample(s1Samples, S1_MEDIAN_KEYS) } },
    S3: { samples: s3Samples, median: s3Median },
    S4: { medianMs: s4.medianMs, p95Ms: s4.p95Ms, samples: s4.samples.map((s) => ({ medianMs: s.medianMs, p95Ms: s.p95Ms })) },
  };
}

/* ------------------------------ 环境 / 基线 ------------------------------ */
function sha256File(file, limit = 0) {
  try {
    const buf = fs.readFileSync(file);
    return crypto.createHash('sha256').update(limit ? buf.subarray(0, limit) : buf).digest('hex').slice(0, 16);
  } catch { return null; }
}

function gitInfo() {
  try {
    const head = spawnSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: REPO, encoding: 'utf8', windowsHide: true });
    const status = spawnSync('git', ['status', '--porcelain'], { cwd: REPO, encoding: 'utf8', windowsHide: true });
    return {
      head: String(head.stdout || '').trim() || null,
      dirtyFiles: String(status.stdout || '').trim().split('\n').filter(Boolean).length,
    };
  } catch { return { head: null, dirtyFiles: null }; }
}

/** 当前系统 CPU 负载（%）：Windows 用 CIM 瞬时值，其它平台用 loadavg/核数；失败返回 null */
function systemLoadPct() {
  try {
    if (process.platform === 'win32') {
      const r = spawnSync('powershell', ['-NoProfile', '-Command',
        '(Get-CimInstance Win32_Processor | Measure-Object -Property LoadPercentage -Average).Average'],
      { encoding: 'utf8', windowsHide: true, timeout: 10000 });
      const v = Number(String(r.stdout || '').trim());
      return Number.isFinite(v) ? Math.round(v) : null;
    }
    const la = os.loadavg();
    return Number.isFinite(la[0]) ? Math.round((la[0] / Math.max(1, os.cpus().length)) * 100) : null;
  } catch { return null; }
}

/** 系统负载快照（LoadPercentage 平均值 + CPU 时间 top5 进程），用于证明采集窗口是否安静；只写 perf.json，不写基线 */
function systemLoadMonitor(note = '') {
  const at = new Date().toISOString();
  try {
    const ps = [
      '$p=(Get-CimInstance Win32_Processor | Measure-Object -Property LoadPercentage -Average).Average;',
      '$top=Get-Process | Sort-Object CPU -Descending | Select-Object -First 5 Name,CPU;',
      '[pscustomobject]@{load=[math]::Round([double]$p);top=@($top | ForEach-Object { [pscustomobject]@{name=$_.Name;cpuSec=[math]::Round([double]$_.CPU,1)} })}|ConvertTo-Json -Compress -Depth 4',
    ].join(' ');
    const r = spawnSync('powershell', ['-NoProfile', '-Command', ps], { encoding: 'utf8', windowsHide: true, timeout: 15000 });
    const text = String(r.stdout || '').trim();
    const parsed = text ? JSON.parse(text) : {};
    return { at, note, loadPct: Number.isFinite(Number(parsed.load)) ? Number(parsed.load) : null, top: parsed.top || [] };
  } catch (err) {
    return { at, note, loadPct: systemLoadPct(), top: [], error: String(err && err.message || err) };
  }
}

function collectEnv(base, browserVersion, durationMs, loadSamples, loadMonitor) {
  const cpus = os.cpus() || [];
  const dataFiles = {
    items: sha256File(path.join(REPO, 'data', 'items.json')),
    itemEffects: sha256File(path.join(REPO, 'data', 'item_effects.json')),
    iconIndex: sha256File(path.join(REPO, 'data', 'icon_index.json')),
    siteData: sha256File(path.join(REPO, 'data', 'site_data.json')),
    builds: sha256File(path.join(REPO, 'data', 'builds.json')),
    codex: sha256File(path.join(REPO, 'data', 'codex', 'index.json')),
  };
  const git = gitInfo();
  return {
    node: process.version,
    chrome: browserVersion,
    os: `${os.platform()} ${os.release()} ${os.arch()}`,
    cpu: cpus.length ? cpus[0].model.trim() : '',
    cpuCount: cpus.length,
    totalMemGB: round(os.totalmem() / 1024 ** 3, 1),
    loadPct: (loadSamples || []).filter((s) => s.loadBefore != null || s.loadAfter != null),
    loadMonitor: loadMonitor || null,
    base,
    server: opts.base ? 'external(--base)' : 'auto: python serve.py --host 127.0.0.1 --port 0',
    viewport: `${VIEWPORT.width}x${VIEWPORT.height}`,
    theme: 'dark(prefers-color-scheme emulated + localStorage r2.v2.ui.theme=dark)',
    cache: '每次采样 Network.clearBrowserCache + Network.setCacheDisabled(true)（冷缓存）',
    repeat: opts.repeat,
    dataSha256_16: dataFiles,
    git,
    durationMs,
  };
}

/* ------------------------------ 基线/对比 ------------------------------ */
function slimBaseline(result) {
  const s = result.scenarios;
  // 基线要入库：env 只保留可复现的稳定字段（去掉临时端口/绝对路径/本轮负载/耗时，避免污染 diff）
  const env = { ...(result.env || {}) };
  env.base = '<auto>';
  env.server = 'auto: python serve.py --host 127.0.0.1 --port 0（随机端口，不写入基线）';
  delete env.durationMs;
  delete env.loadPct;
  delete env.loadMonitor;
  if (env.git) env.git = { head: env.git.head };
  const slim = {
    _说明: '遗迹2 · 遗物档案 性能基线（qa/perf.mjs --update-baseline 生成）。只保留各场景中位数与少量结构字段，供 --compare 对比；样本明细见同轮 qa/results/perf.json（gitignored）。环境/数据哈希见 env，换机器/数据后请重采基线。',
    schema: result.schema,
    generatedAt: result.generatedAt,
    env,
    scenarios: {},
  };
  if (s.S1) {
    slim.scenarios.S1 = {
      routes: Object.fromEntries(Object.entries(s.S1.routes).map(([k, v]) => [k, v.median])),
    };
  }
  if (s.S2) {
    slim.scenarios.S2 = {
      routes: Object.fromEntries(Object.entries(s.S2.routes).map(([k, v]) => [k, v.median])),
    };
  }
  if (s.S3) slim.scenarios.S3 = { median: s.S3.median };
  if (s.S4) slim.scenarios.S4 = { medianMs: s.S4.medianMs, p95Ms: s.S4.p95Ms, switchesPerSample: s.S4.switchesPerSample };
  if (s.S5) slim.scenarios.S5 = { median: s.S5.median };
  if (s.S6) slim.scenarios.S6 = { median: s.S6.median };
  if (s.S7) slim.scenarios.S7 = { median: s.S7.median };
  if (s.S8) {
    slim.scenarios.S8 = {
      S1: { items: s.S8.S1.items.median },
      S3: { median: s.S8.S3.median },
      S4: { medianMs: s.S8.S4.medianMs, p95Ms: s.S8.S4.p95Ms },
    };
  }
  return slim;
}

function flattenNumbers(obj, prefix = '', out = {}) {
  for (const [k, v] of Object.entries(obj || {})) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === 'number' && Number.isFinite(v)) out[key] = v;
    else if (v && typeof v === 'object' && !Array.isArray(v)) flattenNumbers(v, key, out);
  }
  return out;
}

function printCompare(baselinePath, current) {
  if (!fs.existsSync(baselinePath)) {
    console.log(`[perf] 找不到基线文件：${path.relative(REPO, baselinePath)}（先跑 --update-baseline）`);
    return;
  }
  let baseline;
  try { baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8')); } catch (e) {
    console.log(`[perf] 基线文件解析失败：${e.message}`);
    return;
  }
  // 基线 slim 把 routes 的中位数压平成 `S1.routes.items.firstViewMs`，而结果 JSON 是
  // `S1.routes.items.median.firstViewMs`；归一化 `.median` 段后再对比，旧基线也能对齐。
  const canon = (obj) => {
    const flat = flattenNumbers(obj);
    const out = {};
    for (const [k, v] of Object.entries(flat)) out[k.replace(/\.median(?=\.|$)/g, '')] = v;
    return out;
  };
  const before = canon(baseline.scenarios);
  const after = canon(current.scenarios);
  const keys = Object.keys(after).filter((k) => Number.isFinite(before[k]));
  console.log(`\n[perf] 基线对比  before=${path.relative(REPO, baselinePath)}（${baseline.generatedAt || '?'}）`);
  console.log('─'.repeat(78));
  console.log(`${'指标'.padEnd(42)}${'before'.padStart(11)}${'after'.padStart(11)}${'变化'.padStart(10)}`);
  for (const key of keys) {
    const b = before[key];
    const a = after[key];
    const delta = b === 0 ? null : ((a - b) / b) * 100;
    const flag = delta != null && Math.abs(delta) >= 15 ? ' ⚠' : '';
    console.log(`${key.padEnd(42)}${String(round(b, 1)).padStart(11)}${String(round(a, 1)).padStart(11)}${(delta == null ? '—' : `${delta >= 0 ? '+' : ''}${round(delta, 1)}%`).padStart(10)}${flag}`);
  }
  console.log('─'.repeat(78));
  console.log('[perf] 说明：变慢不判失败（P2 基线用途）；⚠ 表示 |变化|≥15%，先看机器负载/抖动再看代码。');
}

/* ------------------------------ 中文摘要 ------------------------------ */
function printSummary(result) {
  const s = result.scenarios;
  const line = '─'.repeat(78);
  console.log(`\n遗迹2 · 遗物档案 — 性能基准结果（${result.generatedAt}）`);
  console.log(line);
  console.log(`环境：${result.env.os} · Node ${result.env.node} · ${result.env.cpuCount} 核 · ${result.env.cpu}`);
  console.log(`      ${result.env.chrome} · repeat=${result.env.repeat} · ${result.env.viewport} · dark · 冷缓存`);
  console.log(line);
  if (s.S1) {
    console.log('S1 首次访问（冷启，中位数）');
    console.log(`  ${'领域'.padEnd(8)}${'首屏ms'.padStart(9)}${'DCL'.padStart(9)}${'FCP'.padStart(9)}${'请求'.padStart(7)}${'总KB'.padStart(9)}${'JS KB'.padStart(8)}${'图片'.padStart(6)}${'可见卡'.padStart(7)}`);
    for (const [k, v] of Object.entries(s.S1.routes)) {
      const m = v.median;
      console.log(`  ${k.padEnd(8)}${String(m.firstViewMs).padStart(9)}${String(m.domContentLoadedMs).padStart(9)}${String(m.fcpMs).padStart(9)}${String(m.totalRequests).padStart(7)}${String(round(m.totalBytes / 1024, 1)).padStart(9)}${String(round(m.jsBytes / 1024, 1)).padStart(8)}${String(m.imageRequests).padStart(6)}${String(m.visibleCards).padStart(7)}`);
    }
    // P2-2 证据：每领域「首屏 / 请求数 / 传输字节」逐条列出
    console.log('  S1 证据明细（P2-2：每领域 首屏 / 请求数 / 传输字节）');
    for (const [k, v] of Object.entries(s.S1.routes)) {
      const m = v.median;
      console.log(`    ${k.padEnd(7)} 首屏 ${String(m.firstViewMs).padStart(8)}ms · 请求 ${String(m.totalRequests).padStart(3)} 个 · 传输 ${String(round(m.totalBytes / 1024, 1)).padStart(9)}KB`
        + `（JS ${round(m.jsBytes / 1024, 1)}KB / CSS ${round(m.cssBytes / 1024, 1)}KB / 图片 ${m.imageRequests} 个 ${round(m.imgBytes / 1024, 1)}KB）· JSON ${m.jsonRequests} 个 · 可见卡 ${m.visibleCards}`);
    }
  }
  if (s.S2) {
    console.log('S2 JSON 解析/归一化（中位数）');
    console.log(`  ${'领域'.padEnd(8)}${'JSON数'.padStart(8)}${'fetch ms'.padStart(10)}${'解析 ms'.padStart(10)}${'解析次数'.padStart(9)}${'解析→首屏ms'.padStart(13)}`);
    for (const [k, v] of Object.entries(s.S2.routes)) {
      const m = v.median;
      console.log(`  ${k.padEnd(8)}${String(m.jsonRequests).padStart(8)}${String(m.jsonFetchMs).padStart(10)}${String(m.jsonParseMs).padStart(10)}${String(m.jsonParseCount).padStart(9)}${String(m.parseDoneToFirstViewMs).padStart(13)}`);
    }
  }
  if (s.S3) {
    console.log(`S3 各领域首开（warm 页面）：items=${s.S3.median.items}ms lab=${s.S3.median.lab}ms builds=${s.S3.median.builds}ms codex=${s.S3.median.codex}ms`);
  }
  if (s.S4) console.log(`S4 页面切换：中位 ${s.S4.medianMs}ms / p95 ${s.S4.p95Ms}ms（每轮 ${s.S4.switchesPerSample} 次）`);
  if (s.S5) {
    const m = s.S5.median;
    console.log(`S5 搜索/筛选：input2=${m.input2Ms}ms input4=${m.input4Ms}ms cat=${m.catChipMs}ms sort=${m.sortMs}ms combo=${m.comboMs}ms`);
  }
  if (s.S6) {
    const m = s.S6.median;
    console.log(`S6 内存：首屏 ${m.firstHeapMB}MB → 20 次切换后 ${m.afterHeapMB}MB（Δ${m.heapGrowthMB}MB / nodes Δ${m.nodesGrowth} / docs Δ${m.documentsGrowth}）图片 ${m.imagesFirst}→${m.imagesAfter}`);
  }
  if (s.S7) {
    const m = s.S7.median;
    console.log(`S7 实验室穷举：穷举墙钟 ${m.wallMs}ms / 状态栏用时 ${m.reportedMs}ms / rAF p95 ${m.p95GapMs}ms · max ${m.maxGapMs}ms / longTask ${m.longTasks} 个 / longFrame ${m.longFrames} 个 / ${m.frames} 帧`);
  }
  if (s.S8) {
    const m = s.S8.S1.items.median;
    console.log(`S8 移动+4x CPU：S1(items) 首屏 ${m.firstViewMs}ms / ${m.totalRequests} 请求 / ${round(m.totalBytes / 1024, 1)}KB；S3 items=${s.S8.S3.median.items}ms lab=${s.S8.S3.median.lab}ms builds=${s.S8.S3.median.builds}ms codex=${s.S8.S3.median.codex}ms；S4 中位 ${s.S8.S4.medianMs}ms p95 ${s.S8.S4.p95Ms}ms`);
  }
  console.log(line);
  const warns = [];
  if (s.S1) for (const [k, v] of Object.entries(s.S1.routes)) if (v.spreadPct.firstViewMs != null && v.spreadPct.firstViewMs > 15) warns.push(`S1.${k}.firstView 抖动 ${v.spreadPct.firstViewMs}% > 15%`);
  if (s.S3) for (const [k, v] of Object.entries(s.S3.spreadPct)) if (v != null && v > 15) warns.push(`S3.${k} 抖动 ${v}% > 15%`);
  if (s.S4 && s.S4.spreadPct != null && s.S4.spreadPct > 15) warns.push(`S4 median 抖动 ${s.S4.spreadPct}% > 15%`);
  if (warns.length) {
    console.log('[perf] ⚠ 稳定性警告（同轮重复样本波动 >15%，结果参考性下降）：');
    for (const w of warns) console.log(`  - ${w}`);
  } else {
    console.log('[perf] 稳定性：同轮重复样本波动均 <15%');
  }
}

/* ------------------------------ 主流程 ------------------------------ */
let SERVER_BASE = '';
let server = null;
let browser = null;
let exitCode = 0;

/** 单个场景失败（多为瞬时的 CDP/Chrome 抖动）重试一次，避免整轮基准白跑；超时不重试（避免翻倍挂起） */
async function withRetry(label, fn, tries = 2) {
  let lastErr = null;
  for (let attempt = 1; attempt <= tries; attempt += 1) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const isTimeout = err instanceof PerfTimeoutError;
      if (attempt < tries && !isTimeout) {
        console.error(`[perf] ${label} 第 ${attempt} 次失败，重试一次：${err && err.message ? err.message : err}`);
        await sleep(800);
      } else {
        break;
      }
    }
  }
  throw lastErr;
}

async function main() {
  const started = Date.now();
  // --compare-only：读取已产出的结果 JSON 与基线对比，不启动 Chrome/服务（after 报告复用）
  if (opts.compareOnly) {
    let current = null;
    try { current = JSON.parse(fs.readFileSync(opts.json, 'utf8')); } catch (e) {
      throw new Error(`--compare-only 读取结果失败：${opts.json}（${e.message}）`);
    }
    printCompare(opts.comparePath || BASELINE_DEFAULT, current);
    console.log(`[perf] compare-only 完成（未运行测量）：${path.relative(REPO, opts.json)}`);
    return;
  }
  fs.mkdirSync(path.dirname(opts.json), { recursive: true });
  log(`[perf] 场景：${SELECTED.join(',')} · repeat=${opts.repeat} · 视口 ${VIEWPORT.width}x${VIEWPORT.height} · dark · 冷缓存`);

  server = new LocalServer({ base: opts.base });
  SERVER_BASE = await server.start();
  log(`[perf] 站点：${SERVER_BASE}（${opts.base ? '外部 --base' : '自动 serve.py --port 0'}）`);

  browser = new Browser();
  await browser.start();
  const chromeVersion = await browser.version();
  log(`[perf] Chrome：${chromeVersion}`);

  // 中断也要清理：SIGINT/SIGTERM → 杀 Chrome + 关 serve 后退出
  const onSignal = (sig) => {
    console.error(`[perf] 收到 ${sig}，清理 Chrome/服务进程后退出…`);
    try { browser?.stop(); } catch { /* ignore */ }
    try { server?.stop(); } catch { /* ignore */ }
    process.exit(130);
  };
  process.once('SIGINT', () => onSignal('SIGINT'));
  process.once('SIGTERM', () => onSignal('SIGTERM'));
  // 整轮看门狗：极端情况下也不允许无限挂（25min 上限）
  const watchdog = setTimeout(() => {
    console.error('[perf] 整轮看门狗超时（25min），清理退出');
    try { browser?.stop(); } catch { /* ignore */ }
    try { server?.stop(); } catch { /* ignore */ }
    process.exit(1);
  }, 25 * 60_000);
  if (watchdog.unref) watchdog.unref();

  const result = {
    schema: 'r2-perf/1',
    generatedAt: new Date().toISOString(),
    scenarios: {},
  };
  const loadSamples = [];
  const loadMonitor = [systemLoadMonitor('start')];
  log(`[perf] 采集开始负载：${loadMonitor[0].loadPct}%`);

  /** 场景包装：硬预算超时 + 记录场景前后系统 CPU 负载（污染窗口取证），失败自动重试一次 */
  async function scenarioRun(id, fn) {
    const loadBefore = systemLoadPct();
    log(`[perf] ${id} 开始${loadBefore != null ? `（系统负载 ${loadBefore}%）` : ''}…`);
    const budget = SCENARIO_BUDGET_MS[id] || 6 * 60_000;
    const value = await withTimeout(withRetry(id, fn), budget, `场景 ${id} 硬预算`);
    const loadAfter = systemLoadPct();
    loadSamples.push({ id, loadBefore, loadAfter, at: new Date().toISOString() });
    const snap = systemLoadMonitor(id);
    loadMonitor.push(snap);
    log(`[perf] ${id} 结束（系统负载 ${snap.loadPct}%）`);
    return value;
  }

  if (SELECTED.includes('S1')) result.scenarios.S1 = await scenarioRun('S1', () => runS1(browser, opts.repeat));
  if (SELECTED.includes('S2')) {
    if (result.scenarios.S1) {
      result.scenarios.S2 = deriveS2(result.scenarios.S1);
      log('[perf] S2 JSON 解析/归一化（由 S1 冷启样本派生）…');
    } else {
      log('[perf] S2 需要 S1 样本，自动补跑 S1 …');
      const s1 = await scenarioRun('S1', () => runS1(browser, opts.repeat));
      result.scenarios.S2 = deriveS2(s1);
    }
  }
  if (SELECTED.includes('S3')) result.scenarios.S3 = await scenarioRun('S3', () => measureWarmFirstOpenSequence(browser, opts.repeat));
  if (SELECTED.includes('S4')) result.scenarios.S4 = await scenarioRun('S4', () => runS4(browser, opts.repeat));
  if (SELECTED.includes('S5')) result.scenarios.S5 = await scenarioRun('S5', () => runS5(browser, opts.repeat));
  if (SELECTED.includes('S6')) result.scenarios.S6 = await scenarioRun('S6', () => runS6(browser, opts.repeat));
  if (SELECTED.includes('S7')) result.scenarios.S7 = await scenarioRun('S7', () => runS7(browser, opts.repeat));
  if (SELECTED.includes('S8')) {
    result.scenarios.S8 = await scenarioRun('S8', () => runS8(browser, opts.repeat));
    const reset = await browser.resetEmulation(); // 显式恢复 CPU/设备模拟（探针 session 证明）
    result.scenarios.S8.emulationReset = reset;
    log(`[perf] S8 结束：已复位 CPU 限速/设备模拟（${reset ? 'ok' : '探针失败'}）`);
  }

  result.env = collectEnv(SERVER_BASE, chromeVersion, Date.now() - started, loadSamples, loadMonitor);
  if (!opts.quiet) printSummary(result);
  fs.writeFileSync(opts.json, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  log(`[perf] 结果 → ${path.relative(REPO, opts.json)}`);

  if (opts.updateBaseline) {
    const slim = slimBaseline(result);
    fs.writeFileSync(BASELINE_DEFAULT, `${JSON.stringify(slim, null, 2)}\n`, 'utf8');
    log(`[perf] 基线已更新 → ${path.relative(REPO, BASELINE_DEFAULT)}`);
  }
  if (opts.compare) {
    printCompare(opts.comparePath || BASELINE_DEFAULT, result);
  }

  const elapsed = ((Date.now() - started) / 1000).toFixed(1);
  console.log(`[perf] 完成：${SELECTED.join(',')} · repeat=${opts.repeat} · 用时 ${elapsed}s · ${path.relative(REPO, opts.json)}`);
  exitCode = 0;
}

main().catch((err) => {
  console.error('[perf] 致命错误：', err && err.stack ? err.stack : err);
  exitCode = 1;
}).finally(() => {
  try { browser?.stop(); } catch { /* ignore */ }
  try { server?.stop(); } catch { /* ignore */ }
  setTimeout(() => process.exit(exitCode), 120);
});
