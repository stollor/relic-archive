#!/usr/bin/env node
/* =============================================================================
   lifecycle.browser.mjs — P0-3 页面生命周期与竞态浏览器回归（CDP 零依赖）
   覆盖：
     G1 同一 tick 快速 hash A→B→C（过期 dispatch 不得覆盖新视图）
     G2 CDP Fetch 延迟 builds 模块：旧 dispatch 不得后挂载
     G3 history 前进/后退后 DOM 与 hash/nav 一致
     G4 深链直开 #/builds/<key> #/codex/<id> #/items/<itemId>：内容正确 + 仅 1 个 h1
     G5 异步数据加载中途离开（Fetch 延迟 builds.json / items.json / codex/index.json）
     G6 视图异步回调在 unmount 后不得再写 DOM（library / codex）
     G7 错误恢复：builds.json 500 后「重新加载」；main.js 错误边界重试不重复实例
     G8 document 级监听成对释放（无重复订阅）
     G9 实验室旧路由 setTimeout 不得在卸载后劫持路由
     G10 P0-4 浏览器级验收：损坏 localStorage 后应用仍能启动/渲染
     G11 P0-4 storage-error → main.js toast 契约
   运行：node qa/tests/lifecycle.browser.mjs
   退出码：0 全 PASS（PEND 不算失败）；1 有 FAIL；2 启动/连接失败
   临时产物：qa/_tmp/lifecycle-result.json（不写 qa/results）
   ========================================================================== */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { CDP, launchChrome, cleanupChrome, sleep } = require('../lib/cdp.js');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const QA_DIR = path.resolve(__dirname, '..');
const REPO = path.resolve(QA_DIR, '..');
const TMP_DIR = path.join(QA_DIR, '_tmp');
const RESULT_FILE = path.join(TMP_DIR, 'lifecycle-result.json');
const BASE = (process.env.QA_BASE || 'http://127.0.0.1:8777').replace(/\/+$/, '');
const STORE_SRC = path.join(REPO, 'js/core/store.js');
const MAIN_SRC = path.join(REPO, 'js/main.js');
const STORE_HAS_EVENT = /storage-error/.test(fs.readFileSync(STORE_SRC, 'utf8'));
const MAIN_HAS_EVENT = /storage-error/.test(fs.readFileSync(MAIN_SRC, 'utf8'));

const DOM_SEL = {
  items: '#view-root .lib-root',
  lab: '#view-root .lab-page',
  builds: '#view-root .builds-root',
  codex: '#view-root .codex-root',
};
const DOMAIN_ZH = { items: '资料库', lab: '实验室', builds: '流派', codex: '知识库' };

const rows = [];
let phase = '';
let errors = [];
function noteError(kind, text) {
  errors.push({ phase, kind, text: String(text || '').slice(0, 600) });
}
function takeErrors() { const out = errors; errors = []; return out; }

function assert(cond, msg) { if (!cond) throw new Error(msg); }
function j(v) { return JSON.stringify(v); }

function record(id, name, status, detail) {
  rows.push({ id, name, status, detail: String(detail == null ? '' : detail).slice(0, 1600) });
  const tag = status === 'PASS' ? 'PASS' : status === 'PEND' ? 'PEND' : 'FAIL';
  console.log(`${tag} ${id} ${name}${detail ? ` — ${String(detail).slice(0, 240)}` : ''}`);
}

async function check(id, name, fn, { allowErrors = [], pendingIf = false } = {}) {
  phase = id;
  const before = errors.length;
  try {
    const detail = await fn();
    const got = errors.slice(before);
    errors.length = before;
    const unexpected = got.filter((e) => !allowErrors.some((re) => re.test(e.text)));
    if (unexpected.length) {
      throw new Error(`出现未预期 console error / 异常：${unexpected.map((e) => `[${e.kind}] ${e.text}`).join(' | ')}`);
    }
    const allowed = got.filter((e) => allowErrors.some((re) => re.test(e.text)));
    record(id, name, 'PASS', `${detail || ''}${allowed.length ? `（白名单 ${allowed.length} 条：${allowed.map((e) => e.kind).join(',')}）` : ''}`);
    return true;
  } catch (err) {
    const got = errors.slice(before);
    errors.length = before;
    const status = pendingIf ? 'PEND' : 'FAIL';
    record(id, name, status, String((err && err.message) || err).slice(0, 1200));
    return false;
  }
}

/* ------------------------------ 页面注入 ------------------------------ */
const LISTENER_SOURCE = String.raw`(() => {
  if (window.__qaListenerNet) return;
  const net = Object.create(null);
  const AEL = EventTarget.prototype.addEventListener;
  const REL = EventTarget.prototype.removeEventListener;
  const keyOf = (t, type) => (t === document ? 'document:' : t === window ? 'window:' : 'other:') + type;
  EventTarget.prototype.addEventListener = function (type, fn, opts) {
    const k = keyOf(this, type); net[k] = (net[k] || 0) + 1; return AEL.call(this, type, fn, opts);
  };
  EventTarget.prototype.removeEventListener = function (type, fn, opts) {
    const k = keyOf(this, type);
    if (typeof fn === 'function') net[k] = (net[k] || 0) - 1;
    return REL.call(this, type, fn, opts);
  };
  window.__qaListenerNet = (k) => net[k] || 0;
})()`;

const PAGE_SOURCE = String.raw`(() => {
  if (window.__qa && window.__qa.version === 3) return;
  const one = (s, r) => (r || document).querySelector(s);
  const all = (s, r) => Array.from((r || document).querySelectorAll(s));
  const qsa = (s) => document.querySelectorAll(s).length;
  const txt = (el) => (el ? String(el.textContent || '').replace(/\s+/g, ' ').trim() : '');
  const viewsOf = () => {
    const root = one('#view-root');
    if (!root) return [];
    return Array.from(root.children).filter((c) => c.classList && c.classList.contains('view'));
  };
  window.__qa = {
    version: 3,
    one, all, txt, qsa,
    ready() { return !!one('#view-root'); },
    state() {
      const root = one('#view-root');
      const views = viewsOf();
      const modal = one('#modal');
      const drawer = one('#drawer');
      return {
        hash: location.hash,
        docTitle: document.title,
        rootChildren: root ? root.children.length : -1,
        views: views.length,
        viewClasses: views.map((v) => v.className),
        dom: {
          items: qsa('#view-root .lib-root'),
          lab: qsa('#view-root .lab-page'),
          builds: qsa('#view-root .builds-root'),
          codex: qsa('#view-root .codex-root'),
        },
        nav: all('.domnav__link.is-on').map((a) => a.dataset.domain),
        navLinks: qsa('.domnav__link'),
        h1: qsa('h1'),
        errPanel: !!root && /页面载入失败/.test(root.textContent || ''),
        loading: !!root && /正在载入数据|正在读取|正在读取 site_data/.test(root.textContent || ''),
        text: root ? txt(root).slice(0, 500) : '',
        modalOpen: !!modal && !modal.hidden,
        drawerOpen: !!drawer && !drawer.hidden && drawer.classList.contains('is-open'),
        modalTitle: txt(one('#modal .modal__title')),
        drawerTitle: txt(one('#drawer .drawer__title')),
        toasts: all('#toasts .toast').map((t) => txt(t)),
        scrollY: Math.round(window.scrollY || 0),
      };
    },
    listeners(type) {
      const fn = window.__qaListenerNet;
      return fn ? fn('document:' + type) : -1;
    },
    /** 找按钮文字并点击（用于错误态「重新加载 / 重试」） */
    clickByText(scopeSel, text) {
      const scope = one(scopeSel) || document;
      const el = Array.from(scope.querySelectorAll('button, a')).find((b) => txt(b).includes(text));
      if (!el) return false;
      el.click();
      return true;
    },
  };
})()`;

/* ------------------------------ Page 助手 ------------------------------ */
class Page {
  constructor(root, sid) { this.root = root; this.sid = sid; }
  send(method, params = {}) { return this.root.send(method, params, this.sid); }

  async ev(expression, { awaitPromise = false } = {}) {
    const r = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise });
    if (r.exceptionDetails) {
      throw new Error('页面异常：' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
    }
    return r.result ? r.result.value : undefined;
  }

  async waitDoc(timeout = 15000) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
      try {
        if (await this.ev(`document.readyState === 'complete' && !!window.__qa`)) return true;
      } catch { /* 导航中 */ }
      await sleep(40);
    }
    throw new Error(`等待文档就绪超时（${timeout}ms）`);
  }

  async waitFor(expr, timeout = 8000, interval = 80) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
      const ok = await this.ev(`(() => { try { return !!(${expr}); } catch (e) { return false; } })()`).catch(() => false);
      if (ok) return true;
      await sleep(interval);
    }
    return false;
  }

  async state() { return this.ev('window.__qa.state()'); }
  async count(sel) { return this.ev(`document.querySelectorAll(${JSON.stringify(sel)}).length`); }
  async text(sel) { return this.ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); return e ? (e.textContent || '').replace(/\\s+/g, ' ').trim() : ''; })()`); }

  /** 等待 DOM/标题/URL 静默 quietMs，返回稳定后的 state */
  async waitStable({ quietMs = 320, timeout = 12000, interval = 80 } = {}) {
    const t0 = Date.now();
    let last = '';
    let lastChange = Date.now();
    while (Date.now() - t0 < timeout) {
      const snap = await this.ev(`(() => {
        const r = document.querySelector('#view-root');
        return [location.hash, document.title, r ? r.innerHTML.length : -1,
          r ? r.querySelectorAll(':scope > .view').length : -1].join('|');
      })()`).catch(() => '');
      if (snap !== last) { last = snap; lastChange = Date.now(); }
      else if (Date.now() - lastChange >= quietMs) return this.state();
      await sleep(interval);
    }
    return this.state();
  }

  /** 打开新文档（about:blank → 目标），避免同 URL 只做 hash 导航 */
  async fresh(hash = '#/items', { expectView = true, timeout = 30000 } = {}) {
    await this.send('Page.navigate', { url: 'about:blank' });
    await this.waitDoc();
    await this.send('Page.navigate', { url: `${BASE}/${hash}` });
    await this.waitDoc();
    if (expectView) {
      const ok = await this.waitFor(`document.querySelectorAll('#view-root > .view').length === 1`, timeout);
      if (!ok) {
        const st = await this.state().catch(() => null);
        throw new Error(`视图未挂载：hash=${st && st.hash} root=${j(st && st.dom)} errPanel=${st && st.errPanel}`);
      }
      await this.waitStable();
    }
    return this.state();
  }

  async reload(hash) {
    if (hash != null) {
      await this.send('Page.navigate', { url: `${BASE}/${hash}` });
    } else {
      await this.send('Page.reload', { ignoreCache: true });
    }
    await this.waitDoc();
  }
}

/** 等待目标领域成为唯一视图并稳定 */
async function waitDomain(page, domain, timeout = 30000) {
  const ok = await page.waitFor(
    `document.querySelectorAll('#view-root > .view').length === 1
     && document.querySelectorAll(${JSON.stringify(DOM_SEL[domain])}).length === 1`,
    timeout,
  );
  if (!ok) {
    const st = await page.state().catch(() => null);
    throw new Error(`等待领域 ${domain} 失败：views=${st && st.views} dom=${j(st && st.dom)} hash=${st && st.hash}`);
  }
  await page.waitStable({ quietMs: 220, timeout: 15000 });
  return page.state();
}

function assertDomain(st, domain) {
  assert(st.views === 1, `#view-root 内 .view 数量=${st.views}（期望 1），classes=${j(st.viewClasses)}`);
  assert(st.nav.length === 1 && st.nav[0] === domain, `nav is-on=${j(st.nav)}（期望 ${domain}）`);
  for (const key of ['items', 'lab', 'builds', 'codex']) {
    const want = key === domain ? 1 : 0;
    assert(st.dom[key] === want, `领域根节点 ${key}=${st.dom[key]}（期望 ${want}），dom=${j(st.dom)}`);
  }
  assert(st.h1 === 1, `h1 数量=${st.h1}（期望 1）`);
  assert(st.docTitle.includes(DOMAIN_ZH[domain]), `document.title「${st.docTitle}」未包含「${DOMAIN_ZH[domain]}」`);
  assert(!st.errPanel, '出现了「页面载入失败」错误面板');
  return `views=1 dom=${j(st.dom)} nav=${st.nav[0]} h1=${st.h1} title=${st.docTitle}`;
}

function hashDomain(hash) {
  const seg = String(hash || '').replace(/^#?\/?/, '').split(/[/?]/)[0];
  return DOM_SEL[seg] ? seg : 'items';
}

/* ------------------------------ Fetch 拦截 ------------------------------ */
class Interceptor {
  constructor(root, sid) {
    this.root = root;
    this.sid = sid;
    this.holds = [];
    this.responds = [];
    this.paused = [];
    this.enabled = false;
    this.handler = (p, s) => {
      if (s !== this.sid) return;
      this._onPaused(p);
    };
    root.on('Fetch.requestPaused', this.handler);
  }

  async enable() {
    if (this.enabled) return;
    this.enabled = true;
    await this.root.send('Fetch.enable', { patterns: [{ urlPattern: '*', requestStage: 'Request' }] }, this.sid);
  }

  _continue(requestId) {
    this.root.send('Fetch.continueRequest', { requestId }, this.sid).catch(() => {});
  }

  _fulfill(resp, requestId) {
    this.root.send('Fetch.fulfillRequest', {
      requestId,
      responseCode: resp.status || 200,
      responseHeaders: [
        { name: 'Content-Type', value: resp.contentType || 'application/json; charset=utf-8' },
        { name: 'Cache-Control', value: 'no-store' },
      ],
      body: Buffer.from(String(resp.body || ''), 'utf8').toString('base64'),
    }, this.sid).catch(() => {});
  }

  _onPaused(p) {
    if (!this.enabled) return;
    const url = String((p.request && p.request.url) || '');
    const hold = this.holds.find((h) => !h.released && h.match(url));
    if (hold) {
      hold.hits.push(url);
      this.paused.push({ requestId: p.requestId, url, hold });
      return;
    }
    const respond = this.responds.find((r) => r.hits.length < (r.once ? 1 : Infinity) && r.match(url));
    if (respond) {
      respond.hits.push(url);
      this._fulfill(respond, p.requestId);
      return;
    }
    this._continue(p.requestId);
  }

  hold(match) {
    const h = { match, hits: [], released: false };
    this.holds.push(h);
    return h;
  }

  async waitHeld(h, timeout = 10000) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
      if (h.hits.length) return true;
      await sleep(50);
    }
    return false;
  }

  release(h) {
    if (!h || h.released) return;
    h.released = true;
    const left = [];
    for (const item of this.paused) {
      if (item.hold === h) this._continue(item.requestId);
      else left.push(item);
    }
    this.paused = left;
  }

  respond(match, resp) {
    const r = { match, hits: [], once: true, status: 200, contentType: 'application/json; charset=utf-8', body: '', ...resp };
    this.responds.push(r);
    return r;
  }

  async reset() {
    for (const h of this.holds) this.release(h);
    this.holds = [];
    this.responds = [];
    this.paused = [];
    if (this.enabled) {
      this.enabled = false;
      await this.root.send('Fetch.disable', {}, this.sid).catch(() => {});
    }
  }
}

/* ------------------------------ 主流程 ------------------------------ */
async function main() {
  fs.mkdirSync(TMP_DIR, { recursive: true });
  const started = Date.now();
  console.log(`[lifecycle] BASE=${BASE}  store-storage-error=${STORE_HAS_EVENT ? 'yes' : 'no(P0-4 未完成)'}`);

  const { child, wsUrl, profile } = launchChrome({ width: 1440, height: 1000 });
  let fatal = null;
  let root = null;
  let targetId = null;
  let sid = null;
  try {
    root = await CDP.connect(await wsUrl, { timeout: 25000 });
    const created = await root.send('Target.createTarget', { url: 'about:blank' });
    targetId = created.targetId;
    const attached = await root.send('Target.attachToTarget', { targetId, flatten: true });
    sid = attached.sessionId;
    const page = new Page(root, sid);
    const interceptor = new Interceptor(root, sid);

    root.on('Runtime.consoleAPICalled', (p, s) => {
      if (s !== sid) return;
      if (p.type === 'error' || p.type === 'assert') {
        const text = (p.args || []).map((a) => a.value ?? a.description ?? a.type).join(' ');
        noteError(p.type, text);
      }
    });
    root.on('Runtime.exceptionThrown', (p, s) => {
      if (s !== sid) return;
      const d = p.exceptionDetails || {};
      const desc = (d.exception && (d.exception.description || d.exception.value)) || d.text || '未知异常';
      noteError('exception', desc);
    });
    root.on('Log.entryAdded', (p, s) => {
      if (s !== sid) return;
      const e = p.entry || {};
      if (e.level === 'error') noteError('log', e.text);
    });

    await page.send('Page.enable');
    await page.send('Runtime.enable');
    await page.send('Network.enable');
    await page.send('Log.enable').catch(() => {});
    await page.send('Network.setCacheDisabled', { cacheDisabled: true }).catch(() => {});
    await page.send('Page.addScriptToEvaluateOnNewDocument', { source: LISTENER_SOURCE });
    await page.send('Page.addScriptToEvaluateOnNewDocument', { source: PAGE_SOURCE });
    await page.send('Runtime.evaluate', { expression: PAGE_SOURCE }).catch(() => {});

    /* ---------------- G0 基线 ---------------- */
    await check('G0', '基线：#/items 正常渲染、单一 .view/nav/title', async () => {
      const st = await page.fresh('#/items');
      const detail = assertDomain(st, 'items');
      const cards = await page.count('#view-root .card');
      assert(cards >= 20, `资料库首屏卡片=${cards}（期望 ≥20）`);
      return `${detail} cards=${cards}`;
    });

    /* ---------------- G1 同一 tick 快速 A→B→C ---------------- */
    await check('G1-A', '同一 tick：#/items→#/lab→#/builds→#/items 只留 items', async () => {
      await page.fresh('#/items');
      await page.ev(`(() => { location.hash='#/lab'; location.hash='#/builds'; location.hash='#/items'; return location.hash; })()`);
      await sleep(1800);
      const st = await waitDomain(page, 'items');
      assert(st.hash === '#/items', `最终 hash=${st.hash}（期望 #/items）`);
      return `${assertDomain(st, 'items')} hash=${st.hash}`;
    });

    await check('G1-B', '同一 tick：#/items→#/codex→#/lab→#/builds→#/codex 只留 codex', async () => {
      await page.fresh('#/items');
      await page.ev(`(() => { location.hash='#/codex'; location.hash='#/lab'; location.hash='#/builds'; location.hash='#/codex'; return location.hash; })()`);
      await sleep(1800);
      const st = await waitDomain(page, 'codex');
      assert(st.hash === '#/codex', `最终 hash=${st.hash}（期望 #/codex）`);
      return `${assertDomain(st, 'codex')} hash=${st.hash}`;
    });

    await check('G1-C', '同一 tick 切换后滚动回顶且 DOM 与 hash/nav 一致', async () => {
      await page.fresh('#/items');
      await page.ev('window.scrollTo(0, 1200)');
      await page.ev(`(() => { location.hash='#/lab'; location.hash='#/builds'; return location.hash; })()`);
      await sleep(1500);
      const st = await waitDomain(page, 'builds');
      assert(st.hash === '#/builds', `最终 hash=${st.hash}`);
      assert(st.scrollY === 0, `切换领域后 scrollY=${st.scrollY}（期望 0）`);
      return `${assertDomain(st, 'builds')} scrollY=0`;
    });

    /* ---------------- G2 CDP Fetch 延迟模块：过期 dispatch 必须放弃 ---------------- */
    await check('G2', '延迟 builds.js 模块返回：旧 dispatch 不得覆盖 #/codex 视图', async () => {
      await page.fresh('#/items');
      await interceptor.enable();
      const hold = interceptor.hold((u) => u.includes('/js/views/builds.js'));
      await page.ev(`location.hash='#/builds'`);
      const held = await interceptor.waitHeld(hold, 10000);
      assert(held, '未拦到 js/views/builds.js 模块请求（检查 Fetch/缓存）');
      await page.ev(`location.hash='#/codex'`);
      await waitDomain(page, 'codex');
      interceptor.release(hold);
      await sleep(1400);
      const st = await page.waitStable({ quietMs: 400 });
      assert(st.hash === '#/codex', `最终 hash=${st.hash}（期望 #/codex）`);
      const detail = assertDomain(st, 'codex');
      await interceptor.reset();
      return `${detail}（builds 模块延迟放行后仍未被后挂载）`;
    });

    /* ---------------- G3 history 前进/后退 ---------------- */
    await check('G3', 'history.back/forward 2~3 次后 DOM 与 hash/nav 一致', async () => {
      await page.fresh('#/items');
      for (const d of ['lab', 'builds', 'codex']) {
        await page.ev(`location.hash='#/${d}'`);
        await waitDomain(page, d);
      }
      const seq = [['back', 'builds'], ['back', 'lab'], ['forward', 'builds'], ['forward', 'codex']];
      const seen = [];
      for (const [op, expect] of seq) {
        await page.ev(`history.${op}()`);
        const st = await waitDomain(page, expect);
        assert(hashDomain(st.hash) === expect, `${op} 后 hash=${st.hash}（期望 ${expect}）`);
        assertDomain(st, expect);
        seen.push(`${op}→${expect}`);
      }
      return seen.join(' / ');
    });

    /* ---------------- G4 深链 ---------------- */
    let meta = null;
    await check('G4-0', '取真实深链数据（build key / codex id / itemId）', async () => {
      await page.fresh('#/items');
      meta = await page.ev(`(async () => {
        const { api } = await import('/js/core/api.js');
        const items = api.itemsSync();
        const it = items.find((i) => i.isItem && i.cat === 'weapon') || items.find((i) => i.isItem);
        const b = (await api.builds()).builds[0];
        const c = await api.codex();
        return { itemId: it.id, itemZh: it.zh, buildKey: b.key, buildName: b.name_zh,
                 codexId: c.articles[0].id, codexTitle: c.articles[0].title };
      })()`, { awaitPromise: true });
      assert(meta && meta.buildKey && meta.codexId && meta.itemId, `深链数据不完整：${j(meta)}`);
      return `build=${meta.buildKey} codex=${meta.codexId} item=${meta.itemId}`;
    });

    await check('G4-A', '深链直开 #/builds/<key>：内容正确 + 仅 1 个 h1', async () => {
      await page.fresh(`#/builds/${encodeURIComponent(meta.buildKey)}`, { expectView: false });
      const ok = await page.waitFor(`document.querySelectorAll('#view-root .builds-root').length === 1
        && /${meta.buildName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/.test(document.querySelector('#view-root').textContent || '')`, 20000);
      assert(ok, '流派详情内容未出现');
      const st = await page.waitStable();
      const detail = assertDomain(st, 'builds');
      assert(decodeURIComponent(st.hash).includes(meta.buildKey), `hash=${st.hash} 未包含 key`);
      return `${detail} hash=${st.hash}`;
    });

    await check('G4-B', '深链直开 #/codex/<id>：内容正确 + 仅 1 个 h1', async () => {
      await page.fresh(`#/codex/${encodeURIComponent(meta.codexId)}`, { expectView: false });
      const ok = await page.waitFor(`document.querySelectorAll('#view-root .codex-root').length === 1
        && document.querySelectorAll('#view-root .codex-title').length === 1`, 20000);
      assert(ok, '知识库条目内容未出现');
      const st = await page.waitStable();
      const detail = assertDomain(st, 'codex');
      const title = await page.text('#view-root .codex-title');
      assert(title.includes(meta.codexTitle), `h1「${title}」不含「${meta.codexTitle}」`);
      return `${detail} h1=${title}`;
    });

    await check('G4-C', '深链直开 #/items/<itemId>：详情打开 + 仅 1 个 h1', async () => {
      await page.fresh(`#/items/${encodeURIComponent(meta.itemId)}`, { expectView: false });
      const ok = await page.waitFor(`(() => { const m = document.querySelector('#modal');
        const d = document.querySelector('#drawer');
        const modal = !!m && !m.hidden; const drawer = !!d && !d.hidden && d.classList.contains('is-open');
        return modal || drawer; })()`, 20000);
      assert(ok, '道具详情未打开');
      const st = await page.waitStable();
      const detail = assertDomain(st, 'items');
      // 详情标题是通用「物品详情」，具体道具名在详情正文首屏
      const shown = st.modalOpen
        ? await page.text('#modal')
        : await page.text('#drawer');
      assert(shown.includes(meta.itemZh), `详情内容不含「${meta.itemZh}」：${shown.slice(0, 120)}`);
      return `${detail} 详情含「${meta.itemZh}」`;
    });

    /* ---------------- G5 异步数据加载中途离开 ---------------- */
    await check('G5-A', 'Fetch 延迟 /data/builds.json → 进 #/builds 后立刻切 #/items，放行后无残留', async () => {
      await page.fresh('#/items');
      await interceptor.enable();
      const hold = interceptor.hold((u) => u.includes('/data/builds.json'));
      await page.ev(`location.hash='#/builds'`);
      assert(await interceptor.waitHeld(hold, 10000), '未拦到 /data/builds.json');
      const loading = await page.state();
      assert(loading.dom.builds === 1, `延迟期间 builds 骨架未挂载：${j(loading.dom)}`);
      await page.ev(`location.hash='#/items'`);
      await waitDomain(page, 'items');
      interceptor.release(hold);
      await sleep(1200);
      const st = await page.waitStable({ quietMs: 350 });
      assert(st.hash === '#/items', `最终 hash=${st.hash}`);
      const detail = assertDomain(st, 'items');
      await interceptor.reset();
      return `${detail}（builds 请求放行后无 library 残留/无异常）`;
    });

    await check('G5-B', 'Fetch 延迟启动期 /data/items.json，期间改 hash → 只挂载最终领域', async () => {
      await interceptor.enable();
      const hold = interceptor.hold((u) => u.includes('/data/items.json'));
      await page.send('Page.navigate', { url: 'about:blank' });
      await page.waitDoc();
      await page.send('Page.navigate', { url: `${BASE}/#/items` });
      await page.waitDoc();
      assert(await interceptor.waitHeld(hold, 15000), '启动期未拦到 /data/items.json');
      await page.ev(`(() => { location.hash='#/lab'; location.hash='#/builds'; return location.hash; })()`);
      interceptor.release(hold);
      const st = await waitDomain(page, 'builds', 40000);
      assert(st.hash === '#/builds', `最终 hash=${st.hash}（期望 #/builds）`);
      assert(st.dom.items === 0, `存在 library 残留：${j(st.dom)}`);
      const detail = assertDomain(st, 'builds');
      await interceptor.reset();
      return `${detail}（启动期 hash 抖动只产生一次最终挂载）`;
    });

    await check('G5-C', 'Fetch 延迟 /data/codex/index.json → 离开 codex 后放行：不得有未捕获异常', async () => {
      await page.fresh('#/items');
      await interceptor.enable();
      const hold = interceptor.hold((u) => u.includes('/data/codex/index.json'));
      await page.ev(`location.hash='#/codex'`);
      assert(await interceptor.waitHeld(hold, 10000), '未拦到 /data/codex/index.json');
      await page.ev(`location.hash='#/items'`);
      await waitDomain(page, 'items');
      interceptor.release(hold);
      await sleep(1400);
      const st = await page.waitStable({ quietMs: 350 });
      assert(st.hash === '#/items', `最终 hash=${st.hash}`);
      assert(st.dom.codex === 0, `codex 残留：${j(st.dom)}`);
      const detail = assertDomain(st, 'items');
      await interceptor.reset();
      return `${detail}（codex 延迟数据放行后无异常）`;
    });

    /* ---------------- G6 library 异步加载中途离开 / 重挂载 ---------------- */
    await check('G6', 'items 数据延迟返回期间离开 #/items：bootView 不得在卸载后执行', async () => {
      await page.fresh('#/items');
      // 首次 ready 已缓存 items/sets；在 api 层注入「同一份数据的延迟返回」，模拟慢网络
      await page.ev(`(async () => {
        const { api } = await import('/js/core/api.js');
        if (!api.__qaOrigItems) {
          api.__qaOrigItems = api.items.bind(api);
          api.items = async function (...args) {
            if (window.__qaDelayItems) await new Promise((res) => { window.__qaReleaseItems = res; });
            return api.__qaOrigItems(...args);
          };
        }
        window.__qaDelayItems = true; window.__qaReleaseItems = null;
        return true;
      })()`, { awaitPromise: true });
      await page.ev(`location.hash='#/builds'`);
      await waitDomain(page, 'builds');
      await page.ev(`location.hash='#/items'`);
      await page.waitFor(`document.querySelectorAll('#view-root .lib-root').length === 1`, 10000);
      await sleep(220);
      await page.ev(`location.hash='#/builds'`);
      await waitDomain(page, 'builds');
      const released = await page.ev(`(() => { const fn = window.__qaReleaseItems; window.__qaDelayItems = false; window.__qaReleaseItems = null; if (fn) fn(); return !!fn; })()`);
      assert(released, '延迟的 api.items 未被挂起（注入失效）');
      await sleep(1200);
      const st = await page.waitStable({ quietMs: 350 });
      assert(st.hash === '#/builds', `最终 hash=${st.hash}`);
      assert(st.dom.items === 0, `library 残留：${j(st.dom)}`);
      return `${assertDomain(st, 'builds')}（过期 bootView 未执行）`;
    });

    /* ---------------- G7 错误恢复 ---------------- */
    await check('G7-A', '/data/builds.json 500 → 错误面板 → 取消拦截点「重新加载」→ 内容正常且仅 1 个 .builds-root', async () => {
      await interceptor.enable();
      interceptor.respond((u) => u.includes('/data/builds.json'), {
        status: 500, contentType: 'application/json; charset=utf-8', body: '{"qa":"forced-500"}',
      });
      await page.fresh('#/builds', { expectView: false });
      const ok = await page.waitFor(`(() => { const t = (document.querySelector('#view-root') || {}).textContent || '';
        return t.includes('流派数据没加载出来'); })()`, 20000);
      assert(ok, '500 后未出现流派错误面板');
      const errSt = await page.state();
      assert(errSt.dom.builds === 1, `错误态 .builds-root=${errSt.dom.builds}`);
      await interceptor.reset();
      const clicked = await page.ev(`window.__qa.clickByText('.builds-root', '重新加载')`);
      assert(clicked, '找不到「重新加载」按钮');
      const done = await page.waitFor(`(() => { const b = document.querySelector('#view-root .builds-body');
        if (!b) return false; const t = b.textContent || '';
        return t.length > 200 && !t.includes('流派数据没加载出来'); })()`, 25000);
      assert(done, '点击重新加载后流派内容未恢复');
      const st = await page.waitStable({ quietMs: 300 });
      assert(st.dom.builds === 1, `.builds-root 数量=${st.dom.builds}（期望 1）`);
      return `${assertDomain(st, 'builds')}（错误恢复后单实例）`;
    }, { allowErrors: [/数据加载失败/, /\[builds\]/, /Failed to load resource/] });

    // 故障注入：把 codex.js 换成一个「onRoute 首次抛错」的模块，验证 main.js 错误边界可干净重试
    const FAKE_CODEX = `
let thrown = false;
export function mount(rootEl) {
  rootEl.classList.add('codex-root', 'qa-fake-codex');
  rootEl.innerHTML = '<div class="codex-body" id="codex-main"><p class="fake-marker">qa-fake-codex</p></div>';
  return {
    onRoute() { if (!thrown) { thrown = true; throw new Error('qa-onroute-boom'); } },
    unmount() { rootEl.classList.remove('qa-fake-codex'); },
  };
}
`;
    await check('G7-B', 'main.js 错误边界：onRoute 抛错后「重试」从干净状态重挂，不残留错误面板', async () => {
      await page.fresh('#/items');
      await interceptor.enable();
      interceptor.respond((u) => u.includes('/js/views/codex.js'), {
        status: 200, contentType: 'application/javascript; charset=utf-8', body: FAKE_CODEX,
      });
      await page.ev(`location.hash='#/codex'`);
      const mountedFake = await page.waitFor(`document.querySelectorAll('#view-root .fake-marker').length === 1`, 15000);
      assert(mountedFake, '故障模块未挂载');
      await page.ev(`location.hash='#/codex?qa=1'`);
      const gotErr = await page.waitFor(`(() => { const r = document.querySelector('#view-root');
        return !!r && /页面载入失败/.test(r.textContent || ''); })()`, 12000);
      assert(gotErr, 'onRoute 抛错后未进入 main.js 错误面板');
      const errSt = await page.state();
      assert(errSt.views === 0, `错误态残留 .view=${errSt.views}`);
      await interceptor.reset();
      const clicked = await page.ev(`window.__qa.clickByText('#view-root', '重试')`);
      assert(clicked, '找不到「重试」按钮');
      await sleep(1200);
      const st = await page.waitStable({ quietMs: 350 });
      assert(!st.errPanel, '重试后仍残留「页面载入失败」错误面板');
      assert(st.views === 1, `重试后 .view 数量=${st.views}（期望 1）`);
      assert(await page.count('#view-root .fake-marker') === 1, '重试后视图未重新挂载');
      return `重试后 views=${st.views} errPanel=false（错误态已清理，视图从干净状态重新 mount）`;
    }, { allowErrors: [/\[dispatch\]/, /qa-onroute-boom/] });

    /* ---------------- G8 监听成对释放 ---------------- */
    await check('G8', 'document 级监听成对释放：切页/重挂后无重复订阅', async () => {
      await page.fresh('#/items');
      const L = async () => page.ev(`({ click: window.__qa.listeners('click'), keydown: window.__qa.listeners('keydown') })`);
      const items0 = await L();
      await page.ev(`location.hash='#/lab'`);
      await waitDomain(page, 'lab');
      const lab = await L();
      await page.ev(`location.hash='#/codex'`);
      await waitDomain(page, 'codex');
      const codex = await L();
      await page.ev(`location.hash='#/builds'`);
      await waitDomain(page, 'builds');
      const builds = await L();
      await page.ev(`location.hash='#/items'`);
      await waitDomain(page, 'items');
      const back = await L();
      // library unmount 释放 1 个 document click + 1 个 keydown；codex mount 新增 1+1
      assert(lab.click === items0.click - 1, `离开资料库后 click 监听 ${lab.click}（期望 ${items0.click - 1}）`);
      assert(lab.keydown === items0.keydown - 1, `离开资料库后 keydown 监听 ${lab.keydown}（期望 ${items0.keydown - 1}）`);
      assert(codex.click === lab.click + 1, `进入知识库后 click 监听 ${codex.click}（期望 ${lab.click + 1}）`);
      assert(codex.keydown === lab.keydown + 1, `进入知识库后 keydown 监听 ${codex.keydown}（期望 ${lab.keydown + 1}）`);
      assert(builds.click === lab.click, `离开知识库后 click 监听 ${builds.click}（期望 ${lab.click}）`);
      assert(back.click === items0.click, `回到资料库后 click 监听 ${back.click}（期望 ${items0.click}）`);
      assert(back.keydown === items0.keydown, `回到资料库后 keydown 监听 ${back.keydown}（期望 ${items0.keydown}）`);
      // 快速切换后再验证一次
      await page.ev(`(() => { location.hash='#/codex'; location.hash='#/builds'; location.hash='#/items'; return location.hash; })()`);
      await sleep(1500);
      await waitDomain(page, 'items');
      const again = await L();
      assert(again.click === items0.click, `快速切换后 click 监听 ${again.click}（期望 ${items0.click}）`);
      assert(again.keydown === items0.keydown, `快速切换后 keydown 监听 ${again.keydown}（期望 ${items0.keydown}）`);
      return `items=${j(items0)} lab=${j(lab)} codex=${j(codex)} builds=${j(builds)} back=${j(back)} churn=${j(again)}`;
    });

    /* ---------------- G9 实验室旧路由 setTimeout ---------------- */
    await check('G9', '卸载后实验室旧路由 setTimeout 不得劫持路由', async () => {
      await page.fresh('#/items');
      await page.ev(`location.hash='#/lab'`);
      await waitDomain(page, 'lab');
      await page.ev(`location.hash='#/items'`);
      await waitDomain(page, 'items');
      await page.ev(`(() => { location.hash='#/lab/calc'; location.hash='#/items'; return location.hash; })()`);
      await sleep(1500);
      const st = await page.waitStable({ quietMs: 350 });
      assert(hashDomain(st.hash) === 'items', `被旧路由重定向劫持：hash=${st.hash}（期望 #/items）`);
      return assertDomain(st, 'items');
    });

    /* ---------------- G10 P0-4 损坏 localStorage ---------------- */
    const storePending = !STORE_HAS_EVENT;
    const storeCases = [
      ['owner-not-array', 'r2.v2.owned', '{"a":1}'],
      ['fav-not-array', 'r2.v2.fav', '123'],
      ['build-null', 'r2.v2.build', 'null'],
      ['build-bad-shape', 'r2.v2.build', '{"slots":"x","mods":null,"traits":"y","meta":"z"}'],
      ['saved-partial', 'r2.v2.saved', '[{"id":1},{"id":"ok","name":"n","ts":1,"build":null}]'],
    ];
    for (const [id, key, val] of storeCases) {
      await check(`G10-${id}`, `损坏 localStorage（${key}=${val}）后 reload：应用仍可渲染`, async () => {
        await page.ev(`(() => { localStorage.clear(); localStorage.setItem(${JSON.stringify(key)}, ${JSON.stringify(val)}); return true; })()`);
        takeErrors();
        await page.send('Page.reload', { ignoreCache: true });
        await page.waitDoc();
        const okView = await page.waitFor(`document.querySelectorAll('#view-root > .view').length === 1`, 20000);
        const st = await page.waitStable({ quietMs: 250 });
        assert(okView, `启动失败：views=${st.views} errPanel=${st.errPanel} text=${String(st.text).slice(0, 160)}`);
        assert(!st.errPanel, '出现「页面载入失败」错误面板');
        assert(st.dom.items === 1, `资料库未渲染：dom=${j(st.dom)}`);
        assert(st.navLinks === 4, `导航链接数=${st.navLinks}（期望 4）`);
        assert(st.docTitle.length > 0, 'document.title 为空');
        return `views=1 dom=${j(st.dom)} title=${st.docTitle}`;
      }, { pendingIf: storePending });
    }

    // 损坏数据下导航仍可用（只跑一例，避免过多 reload）
    await check('G10-nav', '损坏 localStorage（owned）后导航到 #/builds 仍可用', async () => {
      await page.ev(`(() => { localStorage.clear(); localStorage.setItem('r2.v2.owned', '{"a":1}'); return true; })()`);
      takeErrors();
      await page.send('Page.reload', { ignoreCache: true });
      await page.waitDoc();
      await page.waitFor(`document.querySelectorAll('#view-root > .view').length === 1`, 20000);
      const clicked = await page.ev(`(() => { const a = document.querySelector('.domnav__link[data-domain="builds"]'); if (!a) return false; a.click(); return true; })()`);
      assert(clicked, '找不到 nav 流派链接');
      const st = await waitDomain(page, 'builds', 30000);
      return assertDomain(st, 'builds');
    }, { pendingIf: storePending });

    /* ---------------- G11 storage-error → toast ---------------- */
    await check('G11', 'main.js 已订阅 storage-error 并在写入失败时 toast', async () => {
      assert(MAIN_HAS_EVENT, 'js/main.js 未订阅 storage-error');
      await page.ev(`(() => { localStorage.clear(); return true; })()`);
      takeErrors();
      await page.send('Page.reload', { ignoreCache: true });
      await page.waitDoc();
      await page.waitFor(`document.querySelectorAll('#view-root > .view').length === 1`, 20000);
      const toasts = await page.ev(`(async () => {
        const { ui } = await import('/js/core/ui.js');
        const { store } = await import('/js/core/store.js');
        const seen = [];
        const orig = ui.toast;
        ui.toast = function (msg, kind, opts) { seen.push({ msg: String(msg), kind: String(kind || '') }); return orig.call(ui, msg, kind, opts); };
        const proto = Object.getPrototypeOf(localStorage);
        const desc = Object.getOwnPropertyDescriptor(proto, 'setItem') || Object.getOwnPropertyDescriptor(Storage.prototype, 'setItem');
        const origSet = Storage.prototype.setItem;
        Storage.prototype.setItem = function () { throw new Error('QuotaExceededError(qa)'); };
        try {
          store.ui.set('density', 'list');
          store.build.set('longGun', 'qa-non-existent-id');
        } finally {
          Storage.prototype.setItem = origSet;
          ui.toast = orig;
        }
        return seen;
      })()`, { awaitPromise: true });
      const hit = (toasts || []).find((t) => /本地存储写入失败/.test(t.msg));
      assert(hit, `未收到 storage-error toast，实际=${j(toasts)}`);
      return `toast=${hit.msg} kind=${hit.kind}`;
    }, { pendingIf: !STORE_HAS_EVENT });

    /* ---------------- 汇总 ---------------- */
  } catch (err) {
    fatal = err;
    console.error('[lifecycle] 致命错误:', err && err.stack ? err.stack : err);
  } finally {
    try { await new Promise((r) => { setTimeout(r, 100); }); } catch { /* ignore */ }
    if (root && targetId) await root.send('Target.closeTarget', { targetId }).catch(() => {});
    root?.close?.();
    cleanupChrome({ child, profile });
  }

  const pass = rows.filter((r) => r.status === 'PASS').length;
  const pend = rows.filter((r) => r.status === 'PEND').length;
  const fail = rows.filter((r) => r.status === 'FAIL').length;
  const elapsed = ((Date.now() - started) / 1000).toFixed(1);
  console.log(`\n=== lifecycle 汇总：PASS ${pass} / FAIL ${fail} / PEND ${pend}（${elapsed}s）===`);
  if (pend) console.log('[lifecycle] PEND 组：P0-4 store-state 尚未完成（store.js 无 storage-error），待其完成后重跑。');
  if (fail) {
    for (const r of rows.filter((x) => x.status === 'FAIL')) console.log(`  FAIL ${r.id}: ${r.detail}`);
  }
  fs.writeFileSync(RESULT_FILE, JSON.stringify({
    base: BASE,
    storeHasStorageError: STORE_HAS_EVENT,
    mainHasStorageError: MAIN_HAS_EVENT,
    pass, fail, pend,
    elapsedSeconds: Number(elapsed),
    rows,
  }, null, 2) + '\n', 'utf8');
  console.log(`[lifecycle] 结果已写入 ${path.relative(REPO, RESULT_FILE)}`);

  if (fatal) { console.error('[lifecycle] 运行致命错误，退出码 2'); return 2; }
  return fail > 0 ? 1 : 0;
}

main().then((code) => process.exit(code)).catch((err) => {
  console.error('[lifecycle] 未捕获:', err && err.stack ? err.stack : err);
  process.exit(2);
});
