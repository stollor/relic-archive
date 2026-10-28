/* =============================================================================
   QA 共用：零依赖 Chrome CDP 客户端（Node 22+ 原生 WebSocket）
   被 shot.js / interactions.js / 回归浏览器用例复用；不依赖任何 npm 包。

   另外提供 Chrome/Chromium 可执行文件探测（resolveChrome）：
     CHROME_PATH / CHROME_BIN（存在才采用）→ 平台候选路径 → where/which
   这样在 Windows / macOS / Linux 上都能直接跑门禁，不再把某台机器的安装路径写死。
   ========================================================================== */
'use strict';

const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

/** 旧版 Windows 默认路径（仅为兼容旧引用保留；启动一律走 resolveChrome()） */
const CHROME_DEFAULT = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ============================ Chrome 探测 ============================ */

/**
 * 平台默认候选（按尝试顺序）。
 * @param {string} platform  process.platform 取值：win32 / darwin / linux
 * @param {Record<string,string>} env  用于还原 Program Files / LOCALAPPDATA 真实路径
 * @returns {string[]}
 */
function candidatesFor(platform = process.platform, env = process.env) {
  const out = [];
  const add = (p) => { if (p) out.push(p); };
  const e = env || {};
  if (platform === 'win32') {
    const pf = e.PROGRAMFILES || 'C:\\Program Files';
    const pf86 = e['PROGRAMFILES(X86)'] || e['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
    const local = e.LOCALAPPDATA || '';
    add(path.win32.join(pf, 'Google', 'Chrome', 'Application', 'chrome.exe'));
    add(path.win32.join(pf86, 'Google', 'Chrome', 'Application', 'chrome.exe'));
    if (local) add(path.win32.join(local, 'Google', 'Chrome', 'Application', 'chrome.exe'));
    // Microsoft Edge 兜底（Chromium 内核，CDP 与 headless 参数通用）
    add(path.win32.join(pf, 'Microsoft', 'Edge', 'Application', 'msedge.exe'));
    add(path.win32.join(pf86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'));
  } else if (platform === 'darwin') {
    add('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
    add('/Applications/Chromium.app/Contents/MacOS/Chromium');
    add('/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge');
    add('/usr/bin/google-chrome');
    add('/usr/bin/google-chrome-stable');
    add('/usr/bin/chromium');
    add('/usr/bin/chromium-browser');
    add('/snap/bin/chromium');
  } else {
    add('/usr/bin/google-chrome');
    add('/usr/bin/google-chrome-stable');
    add('/usr/bin/chromium');
    add('/usr/bin/chromium-browser');
    add('/snap/bin/chromium');
    add('/usr/bin/microsoft-edge');
  }
  return [...new Set(out)];
}

/** where/which 要查的可执行名（按尝试顺序） */
function commandNamesFor(platform = process.platform) {
  return platform === 'win32'
    ? ['chrome.exe', 'msedge.exe']
    : ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser'];
}

/** 默认 where/which 实现：返回 stdout（找不到返回空串） */
function defaultWhich(cmd, name) {
  try {
    const r = spawnSync(cmd, [name], { encoding: 'utf8', timeout: 4000, windowsHide: true });
    return r.status === 0 && r.stdout ? r.stdout : '';
  } catch {
    return '';
  }
}

/** 在 PATH 里找可执行文件；命中返回 { path, source }，找不到返回 null */
function findOnPath(platform = process.platform, which = defaultWhich) {
  const cmd = platform === 'win32' ? 'where' : 'which';
  for (const name of commandNamesFor(platform)) {
    const stdout = String(which(cmd, name) || '');
    const first = stdout.split(/\r?\n/).map((s) => s.trim()).filter(Boolean)[0];
    if (first) return { path: first, source: cmd };
  }
  return null;
}

/** 全平台都找不到可执行文件时抛出（含搜索清单与 CHROME_PATH 建议） */
class ChromeNotFoundError extends Error {
  constructor(searched = [], { platform = process.platform } = {}) {
    const list = searched.map((s) => `  - ${s.path}（${s.source}）`);
    super([
      `找不到可用的 Chrome / Chromium（平台：${platform}）。`,
      '已按以下顺序尝试：',
      ...(list.length ? list : ['  （没有可尝试的候选路径）']),
      '解决办法：安装 Chrome/Chromium，或设置环境变量 CHROME_PATH 指向可执行文件：',
      '  Windows PowerShell:  $env:CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"',
      '  macOS / Linux:       export CHROME_PATH="/usr/bin/google-chrome"',
      '  单次运行：            node qa/shot.js --chrome <可执行文件路径>',
    ].join('\n'));
    this.name = 'ChromeNotFoundError';
    this.code = 'CHROME_NOT_FOUND';
    this.platform = platform;
    this.searched = searched;
    this.searchPaths = searched.map((s) => s.path);
  }
}

/**
 * 探测 Chrome/Chromium 可执行文件。
 *   顺序：CHROME_PATH → CHROME_BIN（存在才采用）→ 平台候选 → where/which
 * @param {object} [opts]
 * @param {Record<string,string>} [opts.env]        环境变量（测试注入）
 * @param {string} [opts.platform]                  平台（测试注入）
 * @param {string[]} [opts.candidates]              候选路径（测试注入；省略则按平台生成）
 * @param {(p:string)=>boolean} [opts.existsSync]   存在性判断（测试注入）
 * @param {(cmd:string,name:string)=>string} [opts.which]  where/which 执行（测试注入；返回 '' 表示未找到）
 * @returns {{path:string, source:'CHROME_PATH'|'CHROME_BIN'|'candidates'|'where'|'which'}}
 * @throws {ChromeNotFoundError}
 */
function resolveChrome(opts = {}) {
  const {
    env = process.env,
    platform = process.platform,
    candidates,
    existsSync = fs.existsSync,
    which = defaultWhich,
  } = opts || {};
  const list = Array.isArray(candidates) ? candidates.slice() : candidatesFor(platform, env);
  const searched = [];
  const probe = (file, source) => {
    if (!file || typeof file !== 'string') return null;
    searched.push({ path: file, source });
    return existsSync(file) ? { path: file, source } : null;
  };

  // 1) 显式环境变量（存在才采用；设置但不存在会继续回退，并在错误信息里留下尝试记录）
  for (const key of ['CHROME_PATH', 'CHROME_BIN']) {
    const hit = probe(env && env[key], key);
    if (hit) return hit;
  }
  // 2) 平台候选
  for (const file of list) {
    const hit = probe(file, 'candidates');
    if (hit) return hit;
  }
  // 3) where（Windows）/ which（macOS、Linux）
  const fromPath = findOnPath(platform, which);
  if (fromPath) return fromPath;

  throw new ChromeNotFoundError(searched, { platform });
}

/* ================================ CDP ================================ */

class CDP {
  constructor(ws, { timeout = 20000 } = {}) {
    this.ws = ws;
    this.seq = 0;
    this.timeout = timeout;
    this.pending = new Map();
    this.handlers = new Map();
    ws.addEventListener('message', (ev) => this._onMessage(ev.data));
    ws.addEventListener('close', () => {
      for (const { reject } of this.pending.values()) reject(new Error('CDP 连接已关闭'));
      this.pending.clear();
    });
  }

  static async connect(url, opts) {
    const ws = new WebSocket(url);
    await new Promise((resolve, reject) => {
      ws.addEventListener('open', resolve, { once: true });
      ws.addEventListener('error', () => reject(new Error(`WebSocket 连接失败: ${url}`)), { once: true });
    });
    return new CDP(ws, opts);
  }

  _onMessage(data) {
    let msg;
    try { msg = JSON.parse(String(data)); } catch { return; }
    if (msg.id != null) {
      const p = this.pending.get(msg.id);
      if (!p) return;
      this.pending.delete(msg.id);
      if (msg.error) p.reject(new Error(`${p.method}: ${msg.error.message}${msg.error.data ? ' ' + msg.error.data : ''}`));
      else p.resolve(msg.result);
      return;
    }
    for (const fn of this.handlers.get(msg.method) || []) {
      try { fn(msg.params || {}, msg.sessionId); } catch (e) { console.error('[cdp handler]', e); }
    }
  }

  on(method, fn) {
    if (!this.handlers.has(method)) this.handlers.set(method, new Set());
    this.handlers.get(method).add(fn);
    return () => this.handlers.get(method).delete(fn);
  }

  send(method, params = {}, sessionId) {
    const id = ++this.seq;
    const payload = { id, method, params };
    if (sessionId) payload.sessionId = sessionId;
    this.ws.send(JSON.stringify(payload));
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, method });
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`${method} 超时`));
        }
      }, Math.max(this.timeout, 15000));
    });
  }

  close() { try { this.ws.close(); } catch { /* ignore */ } }
}

/**
 * 启动 headless Chrome，返回 { child, wsUrl, profile, exe }（wsUrl 为 Promise）。
 * chromePath 省略时自动探测（resolveChrome）；探测失败抛 ChromeNotFoundError。
 */
function launchChrome({ chromePath, width = 1440, height = 1000, extraArgs = [] } = {}) {
  const exe = chromePath || resolveChrome().path;
  const profile = path.join(os.tmpdir(), `r2qa-chrome-${process.pid}-${Date.now()}`);
  fs.mkdirSync(profile, { recursive: true });
  const args = [
    '--headless=new',
    '--disable-gpu',
    '--hide-scrollbars',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--disable-background-networking',
    '--disable-sync',
    '--disable-background-timer-throttling',
    '--force-device-scale-factor=1',
    `--window-size=${width},${height}`,
    `--user-data-dir=${profile}`,
    '--remote-debugging-port=0',
    ...extraArgs,
    'about:blank',
  ];
  const child = spawn(exe, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  const wsUrl = new Promise((resolve, reject) => {
    let buf = '';
    const timer = setTimeout(() => reject(new Error(`等待 Chrome DevTools 端点超时（25s）[${exe}]`)), 25000);
    child.stderr.on('data', (chunk) => {
      buf += chunk.toString();
      const m = buf.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (m) { clearTimeout(timer); resolve(m[1]); }
    });
    child.on('exit', (code) => { clearTimeout(timer); reject(new Error(`Chrome 提前退出 code=${code} [${exe}]\n${buf.slice(-800)}`)); });
    child.on('error', (e) => { clearTimeout(timer); reject(e); });
  });
  return { child, wsUrl, profile, exe };
}

function cleanupChrome({ child, profile }) {
  try { child?.kill(); } catch { /* ignore */ }
  setTimeout(() => { try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* ignore */ } }, 300).unref?.();
}

module.exports = {
  CDP,
  launchChrome,
  cleanupChrome,
  sleep,
  resolveChrome,
  candidatesFor,
  ChromeNotFoundError,
  CHROME_DEFAULT,
};
