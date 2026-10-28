/* =============================================================================
   QA 共用：零依赖 Chrome CDP 客户端（Node 22+ 原生 WebSocket）
   被 shot.js / interactions.js 复用；不依赖任何 npm 包。
   ========================================================================== */
'use strict';

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const CHROME_DEFAULT = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

/** 启动 headless Chrome，返回 { child, wsUrl, profile }（wsUrl 为 Promise） */
function launchChrome({ chromePath = CHROME_DEFAULT, width = 1440, height = 1000, extraArgs = [] } = {}) {
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
  const child = spawn(chromePath, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  const wsUrl = new Promise((resolve, reject) => {
    let buf = '';
    const timer = setTimeout(() => reject(new Error('等待 Chrome DevTools 端点超时（25s）')), 25000);
    child.stderr.on('data', (chunk) => {
      buf += chunk.toString();
      const m = buf.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (m) { clearTimeout(timer); resolve(m[1]); }
    });
    child.on('exit', (code) => { clearTimeout(timer); reject(new Error(`Chrome 提前退出 code=${code}\n${buf.slice(-800)}`)); });
    child.on('error', (e) => { clearTimeout(timer); reject(e); });
  });
  return { child, wsUrl, profile };
}

function cleanupChrome({ child, profile }) {
  try { child?.kill(); } catch { /* ignore */ }
  setTimeout(() => { try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* ignore */ } }, 300).unref?.();
}

module.exports = { CDP, launchChrome, cleanupChrome, sleep, CHROME_DEFAULT };
