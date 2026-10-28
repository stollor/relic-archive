#!/usr/bin/env node
/* =============================================================================
   navigation.browser.mjs — P1-2 导航与子路径 e2e 回归（CDP 零依赖）
   覆盖：
     N1 同一 tick 快速路由切换（items→builds→codex）后 DOM/nav/标题与最终 hash 一致
     N2 同路径仅查询参数快切（view=list/grid）后 UI 与最后一次参数一致（看 DOM 类）
     N3 详情深链契约：#/items/<真实 id> 打开详情、地址栏保持、刷新仍打开、关闭回 #/items
     N4 未知领域 #/nope 与空 # 落 #/items，且用 replace（历史不额外增长）
     N5 坏查询参数（不存在 cat/sort）回退默认列表、不空白、无 console error
     N6 实验室分帧穷举中离开：#/lab → #/codex 后无异步回写/不改 hash，返回无重复实例
     N7 子路径模式（QA_BASE 含前缀）下 N1/N3/N4 同样通过 + 所有资源都在前缀下；
        根路径模式明确 SKIP 并写原因
   用法：
     node qa/tests/navigation.browser.mjs
     node qa/tests/navigation.browser.mjs --base http://127.0.0.1:8795/relic-archive
   结果：qa/_tmp/navigation-result.json；失败截图 qa/_tmp/nav-fail-*.png
   汇总：`[navigation] PASS=n FAIL=n SKIP=n`
   退出码：0 全 PASS（SKIP 不算失败）；1 有 FAIL；2 启动/连接失败
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
const RESULT_FILE = path.join(TMP_DIR, 'navigation-result.json');
const ITEMS_FILE = path.join(REPO, 'data', 'items.json');

/* ------------------------------ 参数 / 配置 ------------------------------ */
function flagValue(name) {
  const argv = process.argv.slice(2);
  const i = argv.indexOf(name);
  if (i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--')) return argv[i + 1];
  const pref = `${name}=`;
  const hit = argv.find((a) => a.startsWith(pref));
  return hit ? hit.slice(pref.length) : null;
}
const BASE_RAW = (flagValue('--base') || process.env.QA_BASE || 'http://127.0.0.1:8777').trim();
const BASE = BASE_RAW.replace(/\/+$/, '');
let BASE_URL;
try {
  BASE_URL = new URL(BASE);
} catch {
  console.error(`[navigation] 致命错误：--base / QA_BASE 不是合法 URL：${JSON.stringify(BASE_RAW)}`
    + '（若由 gate 调用，检查 qa/gate/registry.mjs 是否把正确的 base 传进来）');
  process.exit(2);
}
const PREFIX = BASE_URL.pathname.replace(/\/+$/, ''); // '' = 根路径；'/relic-archive' = 子路径
const DOMAIN_ZH = { items: '资料库', lab: '实验室', builds: '流派', codex: '知识库' };
const DOM_SEL = {
  items: '#view-root .lib-root',
  lab: '#view-root .lab-page',
  builds: '#view-root .builds-root',
  codex: '#view-root .codex-root',
};

/* ------------------------------ 结果记录 ------------------------------ */
const rows = [];
let phase = '';
let errors = [];
function noteError(kind, text) {
  errors.push({ phase, kind, text: String(text || '').slice(0, 600) });
}
function assert(cond, msg) { if (!cond) throw new Error(msg); }
function j(v) { return JSON.stringify(v); }
function record(id, name, status, detail) {
  const row = { id, name, status, detail: String(detail == null ? '' : detail).slice(0, 1600) };
  rows.push(row);
  const tag = status === 'PASS' ? 'PASS' : status === 'SKIP' ? 'SKIP' : 'FAIL';
  console.log(`${tag} ${id} ${name}${detail ? ` — ${String(detail).slice(0, 240)}` : ''}`);
}

/* ============================ 页面侧助手 ============================ */
const PAGE_HELPERS = String.raw`(() => {
  if (window.__nav && window.__nav.version === 1) return;
  const qsa = (s) => document.querySelectorAll(s).length;
  const txt = (el) => (el ? String(el.textContent || '').replace(/\s+/g, ' ').trim() : '');
  const roots = {
    items: '#view-root .lib-root',
    lab: '#view-root .lab-page',
    builds: '#view-root .builds-root',
    codex: '#view-root .codex-root',
  };
  window.__nav = {
    version: 1,
    state() {
      const root = document.querySelector('#view-root');
      const views = root ? Array.from(root.children).filter((c) => c.classList && c.classList.contains('view')) : [];
      const modal = document.querySelector('#modal');
      const drawer = document.querySelector('#drawer');
      const grid = document.querySelector('.lib-grid');
      const dom = {};
      for (const k of Object.keys(roots)) dom[k] = qsa(roots[k]);
      return {
        hash: location.hash,
        path: location.pathname,
        title: document.title,
        views: views.length,
        viewClasses: views.map((v) => v.className),
        dom,
        nav: Array.from(document.querySelectorAll('.domnav__link.is-on')).map((a) => a.dataset.domain),
        navLinks: qsa('.domnav__link'),
        h1: qsa('h1'),
        historyLen: history.length,
        modalOpen: !!modal && !modal.hidden,
        drawerOpen: !!drawer && !drawer.hidden && drawer.classList.contains('is-open'),
        cards: qsa('#view-root .card'),
        rows: qsa('#view-root .lib-row'),
        listMode: !!grid && grid.classList.contains('is-list'),
        labStatus: txt(document.querySelector('.lab-rec__status')),
        recRunning: /穷举中/.test(txt(document.querySelector('.lab-rec__status'))),
        panels: qsa('.lab-page .lab-panel'),
        panelHosts: qsa('.lab-page__panel'),
        segs: qsa('.lab-page .seg'),
        errPanel: !!root && /页面载入失败|数据没有载入/.test(txt(root)),
        text: root ? txt(root).slice(0, 400) : '',
        modalText: modal ? txt(modal).slice(0, 600) : '',
      };
    },
    resources() {
      return performance.getEntriesByType('resource').map((e) => e.name);
    },
    clickText(scopeSel, text) {
      const scope = document.querySelector(scopeSel) || document;
      const el = Array.from(scope.querySelectorAll('button, a')).find((b) => txt(b).includes(text));
      if (!el) return false;
      el.click();
      return true;
    },
  };
})()`;

/* ============================== Page 助手 ============================== */
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

  async gotoAboutBlank() {
    await this.send('Page.navigate', { url: 'about:blank' });
    await this.waitDoc();
  }

  async navigate(url) {
    await this.send('Page.navigate', { url });
    await this.waitDoc();
  }

  async waitDoc(timeout = 20000) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
      try {
        if (await this.ev(`document.readyState === 'complete' && !!window.__nav`)) return true;
      } catch { /* 导航中 */ }
      await sleep(40);
    }
    throw new Error(`等待文档就绪超时（${timeout}ms）`);
  }

  async waitFor(expr, timeout = 10000, interval = 80) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
      const ok = await this.ev(`(() => { try { return !!(${expr}); } catch (e) { return false; } })()`).catch(() => false);
      if (ok) return true;
      await sleep(interval);
    }
    return false;
  }

  async state() { return this.ev('window.__nav.state()'); }

  /** 等待 DOM/标题/URL 静默 quietMs，返回稳定后的 state */
  async waitStable({ quietMs = 320, timeout = 15000, interval = 80 } = {}) {
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

  /** 新文档直开（about:blank → 目标），确保每次都是真实首屏启动 */
  async fresh(hash = '#/items', { expectView = true, timeout = 30000 } = {}) {
    await this.gotoAboutBlank();
    await this.navigate(`${BASE}/${hash}`);
    if (expectView) {
      const ok = await this.waitFor(`document.querySelectorAll('#view-root > .view').length === 1`, timeout);
      if (!ok) {
        const st = await this.state().catch(() => null);
        throw new Error(`视图未挂载：hash=${st && st.hash} dom=${j(st && st.dom)} errPanel=${st && st.errPanel}`);
      }
      await this.waitStable();
    }
    return this.state();
  }

  async screenshot(file) {
    try {
      const shot = await this.send('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync(file, Buffer.from(shot.data, 'base64'));
      return path.relative(REPO, file);
    } catch { return null; }
  }
}

/* ------------------------------ 断言助手 ------------------------------ */
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
  await page.waitStable({ quietMs: 200, timeout: 15000 });
  return page.state();
}

function assertDomain(st, domain) {
  assert(st.views === 1, `#view-root 内 .view 数量=${st.views}（期望 1），classes=${j(st.viewClasses)}`);
  assert(st.nav.length === 1 && st.nav[0] === domain, `nav is-on=${j(st.nav)}（期望 ${domain}）`);
  for (const key of Object.keys(DOM_SEL)) {
    const want = key === domain ? 1 : 0;
    assert(st.dom[key] === want, `领域根节点 ${key}=${st.dom[key]}（期望 ${want}），dom=${j(st.dom)}`);
  }
  assert(st.h1 === 1, `h1 数量=${st.h1}（期望 1）`);
  assert(st.title.includes(DOMAIN_ZH[domain]), `document.title「${st.title}」未包含「${DOMAIN_ZH[domain]}」`);
  assert(!st.errPanel, '出现了「页面载入失败 / 数据没有载入」错误态');
  return `views=1 dom=${j(st.dom)} nav=${st.nav[0]} h1=${st.h1} title=${st.title}`;
}

/* ------------------------------ 真实道具深链 ------------------------------ */
function loadRealItem() {
  const raw = JSON.parse(fs.readFileSync(ITEMS_FILE, 'utf8'));
  const list = raw.items || [];
  const item = list.find((it) => it && it.is_item === true && it.cat === 'weapon' && it.id)
    || list.find((it) => it && it.is_item === true && it.id);
  if (!item) throw new Error('data/items.json 中找不到真实道具 id');
  const zh = (item.display && item.display.name_zh) || item.zh_name || item.id;
  return { id: item.id, zh };
}

/* ------------------------------ 主流程 ------------------------------ */
async function main() {
  fs.mkdirSync(TMP_DIR, { recursive: true });
  const started = Date.now();
  console.log(`[navigation] BASE=${BASE} prefix=${PREFIX || '(root)'}`);

  let child = null;
  let profile = null;
  let root = null;
  let targetId = null;
  let sid = null;
  let page = null;
  let fatal = null;

  const launch = launchChrome({ width: 1440, height: 1000 });
  child = launch.child; profile = launch.profile;

  async function check(id, name, fn) {
    phase = id;
    const before = errors.length;
    try {
      const detail = await fn();
      const got = errors.slice(before);
      errors.length = before;
      if (got.length) {
        throw new Error(`出现 console error / 未捕获异常：${got.map((e) => `[${e.kind}] ${e.text}`).join(' | ')}`);
      }
      record(id, name, 'PASS', detail);
      return true;
    } catch (err) {
      errors.length = before;
      const file = page ? await page.screenshot(path.join(TMP_DIR, `nav-fail-${id}.png`)) : null;
      record(id, name, 'FAIL', `${String((err && err.message) || err)}${file ? `（截图 ${file}）` : ''}`);
      return false;
    }
  }
  function skip(id, name, reason) {
    record(id, name, 'SKIP', reason);
  }

  /* ---------------- N1 ---------------- */
  async function n1() {
    return check('N1', '同一 tick items→builds→codex：最终 DOM/nav/标题属 codex', async () => {
      await page.fresh('#/items');
      await page.ev(`(() => { location.hash='#/builds'; location.hash='#/codex'; return location.hash; })()`);
      const ok = await page.waitFor(`location.hash === '#/codex'
        && document.querySelectorAll('#view-root .codex-root').length === 1`, 25000);
      assert(ok, '快速切换后未稳定到 #/codex');
      await sleep(450); // 给任何过期 dispatch 一个后挂载窗口
      const st = await page.waitStable({ quietMs: 320 });
      assert(st.hash === '#/codex', `最终 hash=${st.hash}（期望 #/codex）`);
      return `${assertDomain(st, 'codex')} hash=${st.hash}`;
    });
  }

  /* ---------------- N2 ---------------- */
  async function n2() {
    return check('N2', '同路径查询参数快切 view=list/grid：UI 与最后一次参数一致', async () => {
      await page.fresh('#/items?view=list');
      const listOk = await page.waitFor(`document.querySelector('.lib-grid')?.classList.contains('is-list') === true`, 15000);
      assert(listOk, '首屏 #/items?view=list 未进入列表模式（.lib-grid.is-list）');
      const listSt = await page.waitStable();
      assert(listSt.listMode, `#/items?view=list 时 .lib-grid.is-list=${listSt.listMode}`);

      // 同一 tick：grid → list，最终应为 list（最后参数生效）
      await page.ev(`(() => { location.hash='#/items?view=grid'; location.hash='#/items?view=list'; return location.hash; })()`);
      await sleep(700);
      const stA = await page.waitStable({ quietMs: 300 });
      assert(stA.listMode === true, `grid→list 快切后 .lib-grid.is-list=${stA.listMode}（期望 true），hash=${stA.hash}`);
      assert(stA.hash === '#/items?view=list', `grid→list 快切后 hash=${stA.hash}（期望 #/items?view=list）`);

      // 同一 tick：list → grid，最终应为 grid（DOM 类必须回去）
      await page.ev(`(() => { location.hash='#/items?view=list'; location.hash='#/items?view=grid'; return location.hash; })()`);
      await sleep(700);
      const stB = await page.waitStable({ quietMs: 300 });
      assert(stB.listMode === false, `list→grid 快切后 .lib-grid.is-list=${stB.listMode}（期望 false），hash=${stB.hash}`);
      assert(stB.views === 1 && stB.dom.items === 1, `视图不唯一：views=${stB.views} dom=${j(stB.dom)}`);
      assert(stB.hash === '#/items', `list→grid 快切后 hash=${stB.hash}（期望 canonical #/items）`);
      return `list→grid 后 hash=${stB.hash} listMode=false；grid→list 后 hash=${stA.hash} listMode=true`;
    });
  }

  /* ---------------- N3 ---------------- */
  async function n3(item) {
    const deep = `#/items/${encodeURIComponent(item.id)}`;
    return check('N3', `详情深链 ${deep}：打开/刷新/关闭契约`, async () => {
      await page.fresh(deep, { expectView: false });
      const viewOk = await page.waitFor(`document.querySelectorAll('#view-root .lib-root').length === 1
        && document.querySelectorAll('#view-root > .view').length === 1`, 25000).catch(() => false);
      const openOk = await page.waitFor(`(() => { const m = document.querySelector('#modal');
        const d = document.querySelector('#drawer');
        const modal = !!m && !m.hidden; const drawer = !!d && !d.hidden && d.classList.contains('is-open');
        return modal || drawer; })()`, 25000);
      assert(viewOk, '详情深链下资料库视图未挂载');
      assert(openOk, `详情深链 ${deep} 未打开详情浮层`);
      await page.waitStable({ quietMs: 200 });
      const st1 = await page.state();
      assert(st1.hash === deep, `直开详情后地址栏=${st1.hash}（期望保持 ${deep}）`);
      assertDomain(st1, 'items');
      assert(st1.modalOpen || st1.drawerOpen, '详情浮层状态异常');
      const shown = st1.modalOpen ? st1.modalText : await page.ev('(document.querySelector("#drawer")?.textContent||"").replace(/\\s+/g," ").trim().slice(0,600)');
      assert(String(shown).includes(item.zh), `详情内容不含真实道具名「${item.zh}」：${String(shown).slice(0, 120)}`);

      // 刷新后详情仍打开
      await page.send('Page.reload', { ignoreCache: true });
      await page.waitDoc();
      const reopened = await page.waitFor(`(() => { const m = document.querySelector('#modal');
        return !!m && !m.hidden; })()`, 30000);
      assert(reopened, '刷新后详情未自动重新打开');
      const st2 = await page.waitStable({ quietMs: 250 });
      assert(st2.hash === deep, `刷新后地址栏=${st2.hash}（期望 ${deep}）`);
      assertDomain(st2, 'items');
      assert(st2.modalOpen, '刷新后 #modal 未可见');

      // 关闭详情 → 回列表且地址栏回 #/items
      const clicked = await page.ev(`(() => { const b = document.querySelector('#modal [data-modal-close]');
        if (!b) return false; b.click(); return true; })()`);
      assert(clicked, '找不到详情关闭按钮');
      const closed = await page.waitFor(`(() => { const m = document.querySelector('#modal');
        const hidden = !m || m.hidden; return hidden && location.hash === '#/items'; })()`, 10000);
      assert(closed, '关闭详情后地址栏未回到 #/items 或弹窗未关闭');
      const st3 = await page.waitStable({ quietMs: 250 });
      assert(st3.hash === '#/items', `关闭详情后 hash=${st3.hash}（期望 #/items）`);
      assert(!st3.modalOpen && !st3.drawerOpen, '关闭详情后浮层仍打开');
      assertDomain(st3, 'items');
      assert(st3.cards >= 20 || st3.rows >= 20, `关闭详情后列表未加载：cards=${st3.cards} rows=${st3.rows}`);
      return `id=${item.id} 直开/刷新保持 URL，关闭后 hash=#/items、列表 ${st3.cards} 卡`;
    });
  }

  /* ---------------- N4 ---------------- */
  async function n4() {
    return check('N4', '未知领域 #/nope 与空 # 落 #/items（replace，历史不额外增长）', async () => {
      await page.fresh('#/items');
      const base = await page.state();
      const L0 = base.historyLen;

      await page.ev(`location.hash='#/nope'`);
      const okNope = await page.waitFor(`location.hash === '#/items'
        && document.querySelectorAll('#view-root > .view').length === 1`, 15000);
      assert(okNope, '#/nope 未重定向到 #/items 或视图未挂载');
      await sleep(400);
      const stA = await page.waitStable({ quietMs: 250 });
      assertDomain(stA, 'items');
      assert(stA.historyLen === L0 + 1, `#/nope→#/items 历史增长=${stA.historyLen - L0}（期望 1，说明重定向用了 replace）`);

      const L1 = stA.historyLen;
      await page.ev(`location.hash=''`);
      const okEmpty = await page.waitFor(`location.hash === '#/items'
        && document.querySelectorAll('#view-root > .view').length === 1`, 15000);
      assert(okEmpty, '空 # 未重定向到 #/items 或视图未挂载');
      await sleep(400);
      const stB = await page.waitStable({ quietMs: 250 });
      assertDomain(stB, 'items');
      assert(stB.hash === '#/items', `空 # 处理完 hash=${stB.hash}（期望 #/items）`);
      assert(stB.historyLen === L1 + 1, `空 #→#/items 历史增长=${stB.historyLen - L1}（期望 1，说明重定向用了 replace）`);
      return `#/nope→#/items 增长 1；空 #→#/items 增长 1（replace，无额外历史）`;
    });
  }

  /* ---------------- N5 ---------------- */
  async function n5() {
    return check('N5', '坏查询参数（cat/sort 不存在）回退默认列表，不空白不报错', async () => {
      await page.fresh('#/items?cat=__nope__&sort=__nope__', { expectView: false });
      const ok = await page.waitFor(`document.querySelectorAll('#view-root .lib-root').length === 1
        && document.querySelectorAll('#view-root .card, #view-root .lib-row').length >= 20`, 25000);
      assert(ok, '坏参数下资料库列表未渲染');
      const st = await page.waitStable({ quietMs: 350 });
      assert(st.views === 1 && st.dom.items === 1, `视图不唯一：views=${st.views} dom=${j(st.dom)}`);
      assert(!st.errPanel, '坏参数触发错误态');
      assert(st.cards + st.rows >= 20, `列表为空：cards=${st.cards} rows=${st.rows}`);
      assert(st.hash === '#/items', `坏参数未被清理：hash=${st.hash}（期望 canonical #/items）`);
      assert(st.listMode === false, '坏参数下非预期列表模式');
      return `列表 ${st.cards} 卡 / ${st.rows} 行，hash 已清理为 #/items`;
    });
  }

  /* ---------------- N6 ---------------- */
  async function n6() {
    return check('N6', '实验室穷举中离开：#/codex 不被回写/改 hash，返回无重复实例', async () => {
      await page.fresh('#/lab');
      const labOk = await page.waitFor(`document.querySelectorAll('#view-root .lab-page').length === 1
        && !!document.querySelector('.lab-rec__status')`, 30000);
      assert(labOk, '实验室推荐面板未就绪');
      let running = await page.waitFor(`/穷举中/.test(document.querySelector('.lab-rec__status')?.textContent || '')`, 5000);
      if (!running) {
        const clicked = await page.ev(`window.__nav.clickText('.lab-page', '重新穷举')`);
        assert(clicked, '找不到「重新穷举」按钮');
        running = await page.waitFor(`/穷举中/.test(document.querySelector('.lab-rec__status')?.textContent || '')`, 8000);
      }
      assert(running, '推荐面板分帧穷举未进入运行态');

      await page.ev(`location.hash='#/codex'`);
      const codexOk = await page.waitFor(`location.hash === '#/codex'
        && document.querySelectorAll('#view-root .codex-root').length === 1`, 25000);
      assert(codexOk, '切到 #/codex 失败');
      await sleep(1500); // 等实验室异步任务若未取消则回写
      const st = await page.waitStable({ quietMs: 200 });
      assert(st.hash === '#/codex', `离开实验室后 hash 被改成 ${st.hash}（期望 #/codex）`);
      assert(st.dom.lab === 0, `离开实验室后仍有 .lab-page=${st.dom.lab}`);
      assert(st.dom.codex === 1 && st.views === 1, `codex 视图异常：views=${st.views} dom=${j(st.dom)}`);
      assert(st.title.includes('知识库'), `离开后标题=${st.title}（期望含「知识库」）`);
      assert(!/穷举中/.test(st.text), `#view-root 内仍出现实验室穷举状态文本：${st.text.slice(0, 120)}`);
      assert(st.h1 === 1, `h1 数量=${st.h1}`);

      // 返回实验室：只允许一个实例；连续快速点 nav 两次也不得重复挂载
      await page.ev(`location.hash='#/lab'`);
      await waitDomain(page, 'lab', 30000);
      let st2 = await page.state();
      assert(st2.dom.lab === 1 && st2.views === 1, `返回实验室后 views=${st2.views} lab=${st2.dom.lab}`);
      assert(st2.panels === 1, `返回实验室后 .lab-panel 数量=${st2.panels}（期望 1，避免重复实例）`);
      assert(st2.panelHosts === 1, `返回实验室后 .lab-page__panel 数量=${st2.panelHosts}（期望 1）`);
      await page.ev(`(() => { const a = document.querySelector('.domnav__link[data-domain="lab"]');
        if (a) { a.click(); a.click(); } return true; })()`);
      await sleep(700);
      st2 = await page.waitStable({ quietMs: 300 });
      assert(st2.views === 1 && st2.dom.lab === 1, `快速点 nav 两次后 views=${st2.views} lab=${st2.dom.lab}`);
      assert(st2.panels === 1, `快速点 nav 两次后 .lab-panel 数量=${st2.panels}（期望 1）`);
      assert(st2.panelHosts === 1, `快速点 nav 两次后 .lab-page__panel 数量=${st2.panelHosts}（期望 1）`);
      assert(st2.title.includes('实验室'), `快速点 nav 两次后标题=${st2.title}`);
      return `离开 1.5s 后 hash/标题/DOM 均未被回写；返回 lab 单实例（.lab-panel=1）`;
    });
  }

  /* ---------------- N7 ---------------- */
  async function n7() {
    if (!PREFIX) {
      skip('N7', '子路径模式：N1/N3/N4 + 资源前缀', '根路径模式跳过：需用 --prefix 的 base（如 http://127.0.0.1:8795/relic-archive）重跑');
      return false;
    }
    return check('N7', `子路径 ${PREFIX}：N1/N3/N4 已在该 base 通过 + 所有资源都在前缀下`, async () => {
      await page.fresh('#/items');
      const st = await page.state();
      assert(st.path === `${PREFIX}/`, `文档路径=${st.path}（期望 ${PREFIX}/）`);
      assert((await page.ev(`document.querySelectorAll('#view-root .card, #view-root .lib-row').length`)) >= 20, '子路径下资料库未渲染');

      // 触发四个领域的懒加载资源（样式/视图模块），全部必须落在前缀下
      for (const d of ['lab', 'builds', 'codex', 'items']) {
        await page.ev(`location.hash='#/${d}'`);
        await waitDomain(page, d, 30000);
      }
      await page.waitStable({ quietMs: 250 });
      const res = await page.ev('window.__nav.resources()');
      const sameOrigin = res.map((u) => {
        try { const x = new URL(u); return x.origin === BASE_URL.origin ? x : null; } catch { return null; }
      }).filter(Boolean);
      assert(sameOrigin.length >= 10, `资源条目过少（${sameOrigin.length}），无法验证子路径`);
      const bad = sameOrigin.filter((x) => !x.pathname.startsWith(`${PREFIX}/`));
      assert(bad.length === 0, `有 ${bad.length} 个资源不在前缀下（绝对路径 bug）：${bad.slice(0, 6).map((x) => x.pathname).join(', ')}`);
      const escaped = sameOrigin.filter((x) => x.pathname === '/' || x.pathname.startsWith('/js/') || x.pathname.startsWith('/data/') || x.pathname.startsWith('/assets/') || x.pathname.startsWith('/css/'));
      assert(escaped.length === 0, `发现根路径资源请求：${escaped.slice(0, 6).map((x) => x.pathname).join(', ')}`);
      return `文档路径 ${st.path}；${sameOrigin.length} 个同源资源全部在 ${PREFIX}/ 下（N1/N3/N4 已在该 base 跑过）`;
    });
  }

  try {
    root = await CDP.connect(await launch.wsUrl, { timeout: 30000 });
    const created = await root.send('Target.createTarget', { url: 'about:blank' });
    targetId = created.targetId;
    const attached = await root.send('Target.attachToTarget', { targetId, flatten: true });
    sid = attached.sessionId;
    page = new Page(root, sid);

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
    await page.send('Page.addScriptToEvaluateOnNewDocument', { source: PAGE_HELPERS });
    await page.send('Runtime.evaluate', { expression: PAGE_HELPERS }).catch(() => {});

    // 可达性预检：连不上服务器按启动失败处理（退出码 2）
    await page.navigate(`${BASE}/#/items`);
    const bootOk = await page.waitFor(`document.querySelectorAll('#view-root > .view').length === 1`, 30000);
    if (!bootOk) {
      const st = await page.state().catch(() => null);
      throw new Error(`BASE 不可用或首屏未启动：${BASE}（hash=${st && st.hash} errPanel=${st && st.errPanel}）`);
    }
    await page.waitStable();

    const item = loadRealItem();
    console.log(`[navigation] 真实道具：${item.id}（${item.zh}）`);

    await n1();
    await n2();
    await n3(item);
    await n4();
    await n5();
    await n6();
    await n7();
  } catch (err) {
    fatal = err;
    console.error('[navigation] 致命错误:', err && err.stack ? err.stack : err);
  } finally {
    if (root && targetId) await root.send('Target.closeTarget', { targetId }).catch(() => {});
    root?.close?.();
    cleanupChrome({ child, profile });
  }

  const pass = rows.filter((r) => r.status === 'PASS').length;
  const fail = rows.filter((r) => r.status === 'FAIL').length;
  const skips = rows.filter((r) => r.status === 'SKIP').length;
  const elapsed = ((Date.now() - started) / 1000).toFixed(1);
  console.log(`\n[navigation] PASS=${pass} FAIL=${fail} SKIP=${skips}（${elapsed}s, base=${BASE}）`);
  if (skips) {
    for (const r of rows.filter((x) => x.status === 'SKIP')) console.log(`  SKIP ${r.id}: ${r.detail}`);
  }
  if (fail) {
    for (const r of rows.filter((x) => x.status === 'FAIL')) console.log(`  FAIL ${r.id}: ${r.detail}`);
  }
  try {
    fs.writeFileSync(RESULT_FILE, JSON.stringify({
      base: BASE,
      prefix: PREFIX || null,
      pass, fail, skip: skips,
      elapsedSeconds: Number(elapsed),
      rows,
    }, null, 2) + '\n', 'utf8');
    console.log(`[navigation] 结果已写入 ${path.relative(REPO, RESULT_FILE)}`);
  } catch (e) {
    console.error('[navigation] 写结果失败:', e && e.message);
  }

  if (fatal) { console.error('[navigation] 运行致命错误，退出码 2'); return 2; }
  return fail > 0 ? 1 : 0;
}

main().then((code) => process.exit(code)).catch((err) => {
  console.error('[navigation] 未捕获:', err && err.stack ? err.stack : err);
  process.exit(2);
});
