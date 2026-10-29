#!/usr/bin/env node
/* =============================================================================
   components.browser.mjs — 共享组件浏览器契约（真实 Chrome CDP，零依赖）

   覆盖 P1-2「共享组件」两个唯一权威实现：
     js/components/states.js  emptyBody / emptyState / loadingState / errorState
     js/components/panel.js   panel / panelHead
   断言的是结构与行为契约（class 层级 / 文本安全 / actions / padTop / titleTag /
   retry 绑定次数 / flush / 自定义 tag / 确定性 outerHTML / 图标），不是「元素存在」。

   页面内用相对 URL 动态 import（`new URL('js/components/states.js', location.href)`），
   因此对 GitHub Pages 子路径部署同样成立——禁止写死根路径 `/js/...`。

   用法：
     node qa/tests/components.browser.mjs
     node qa/tests/components.browser.mjs --base http://127.0.0.1:8791
     QA_BASE=http://127.0.0.1:8791/ node qa/tests/components.browser.mjs
   退出码：0 全 PASS（SKIP 不算失败）；1 有 FAIL；2 启动/连接/导航失败
   结果：qa/_tmp/components-result.json（gitignored）
   ========================================================================== */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { CDP, launchChrome, cleanupChrome, sleep } = require('../lib/cdp.js');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const QA_DIR = path.resolve(__dirname, '..');
const REPO = path.resolve(QA_DIR, '..');
const TMP_DIR = path.join(QA_DIR, '_tmp');
const RESULT_FILE = path.join(TMP_DIR, 'components-result.json');

const argv = process.argv.slice(2);
if (argv.includes('--help') || argv.includes('-h')) {
  console.log([
    '用法：node qa/tests/components.browser.mjs [--base <url>]',
    '',
    '  共享组件浏览器契约：components/states.js + components/panel.js',
    '  --base   站点地址（默认取 QA_BASE，否则 http://127.0.0.1:8777）',
    '  退出码：0=全 PASS，1=有 FAIL，2=启动/连接/导航失败',
    '  结果：qa/_tmp/components-result.json',
  ].join('\n'));
  process.exit(0);
}
function arg(name, def) {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : def;
}
const BASE = String(arg('base', process.env.QA_BASE || 'http://127.0.0.1:8777')).replace(/\/+$/, '');

/* ------------------------------ 记录 ------------------------------ */
const rows = [];
let consoleErrors = [];
function j(v) { return JSON.stringify(v); }

function record(id, name, status, detail) {
  rows.push({ id, name, status, detail: String(detail == null ? '' : detail).slice(0, 1600) });
  const tag = status === 'PASS' ? 'PASS' : status === 'SKIP' ? 'SKIP' : 'FAIL';
  console.log(`${tag} ${id} ${name}${detail ? ` — ${String(detail).slice(0, 220)}` : ''}`);
}

async function check(id, name, fn) {
  try {
    const detail = await fn();
    record(id, name, 'PASS', detail);
    return true;
  } catch (err) {
    record(id, name, 'FAIL', String((err && err.message) || err));
    return false;
  }
}

/* --------------------------- 页面侧小助手 --------------------------- */
const PAGE_SOURCE = String.raw`(() => {
  const one = (s, r) => (r || document).querySelector(s);
  const txt = (el) => (el ? String(el.textContent || '').replace(/\s+/g, ' ').trim() : '');
  window.__qaC = {
    /** 相对页面地址导入模块（子路径部署安全，禁止根路径 /js/...） */
    load(rel) { return import(new URL(rel, location.href).href); },
    one,
    txt,
  };
})()`;

/* ------------------------------ 主流程 ------------------------------ */
async function main() {
  fs.mkdirSync(TMP_DIR, { recursive: true });
  const started = Date.now();
  console.log(`[components] BASE=${BASE}`);

  const { child, wsUrl, profile } = launchChrome({ width: 1440, height: 1000 });
  let fatal = null;
  let root = null;
  let targetId = null;
  let sid = null;

  try {
    root = await CDP.connect(await wsUrl, { timeout: 25000 });
    const created = await root.send('Target.createTarget', { url: 'about:blank' });
    targetId = created.targetId;
    sid = (await root.send('Target.attachToTarget', { targetId, flatten: true })).sessionId;

    root.on('Runtime.consoleAPICalled', (p, s) => {
      if (s !== sid || (p.type !== 'error' && p.type !== 'assert')) return;
      consoleErrors.push({ kind: p.type, text: (p.args || []).map((a) => a.value ?? a.description ?? a.type).join(' ').slice(0, 500) });
    });
    root.on('Runtime.exceptionThrown', (p, s) => {
      if (s !== sid) return;
      const d = p.exceptionDetails || {};
      consoleErrors.push({ kind: 'exception', text: String((d.exception && (d.exception.description || d.exception.value)) || d.text || '未知异常').slice(0, 500) });
    });

    const page = {
      send: (method, params = {}) => root.send(method, params, sid),
    };
    await page.send('Page.enable');
    await page.send('Runtime.enable');
    await page.send('Network.enable');
    await page.send('Log.enable').catch(() => {});
    await page.send('Network.setCacheDisabled', { cacheDisabled: true }).catch(() => {});

    const ev = async (expression, { awaitPromise = false } = {}) => {
      const r = await page.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise });
      if (r.exceptionDetails) {
        throw new Error('页面异常：' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
      }
      return r.result ? r.result.value : undefined;
    };

    /* 打开站点根（任意可服务页面即可；组件为纯 DOM 构造，不依赖路由） */
    await page.send('Page.navigate', { url: `${BASE}/` });
    let ready = false;
    const dl = Date.now() + 25000;
    while (Date.now() < dl) {
      ready = await ev(`document.readyState === 'complete'`).catch(() => false);
      if (ready) break;
      await sleep(100);
    }
    if (!ready) throw new Error(`页面未就绪：${BASE}/`);
    await ev(PAGE_SOURCE);
    // 页面内确认相对 URL 解析正常（模块可加载）
    const importProbe = await ev(`(async () => {
      const url = new URL('js/components/states.js', location.href).href;
      const mod = await import(url);
      return { url, ok: typeof mod.emptyState === 'function' };
    })()`, { awaitPromise: true });
    assert(importProbe && importProbe.ok, `相对 URL 导入 states.js 失败：${j(importProbe)}`);

    /* =============================== states.js =============================== */

    await check('C01', 'emptyState：容器 class=empty、title/hint 文本正确', async () => {
      const r = await ev(`(async () => {
        const { emptyState } = await window.__qaC.load('js/components/states.js');
        const el = emptyState({ title: '空标题', hint: '空提示' });
        return {
          tag: el.tagName, cls: el.className,
          titleCls: (el.querySelector('.empty__title') || {}).className,
          title: window.__qaC.txt(el.querySelector('.empty__title')),
          hint: window.__qaC.txt(el.querySelector('.empty__hint')),
          ico: !!el.querySelector('.empty__ico'),
        };
      })()`, { awaitPromise: true });
      assert.equal(r.tag, 'DIV', `emptyState 容器应为 DIV，实际 ${r.tag}`);
      assert.ok(String(r.cls).split(/\s+/).includes('empty'), `容器 class 应含 empty，实际「${r.cls}」`);
      assert.equal(r.titleCls, 'empty__title', '标题节点 class 应为 empty__title');
      assert.equal(r.title, '空标题', `标题文本不符：「${r.title}」`);
      assert.equal(r.hint, '空提示', `说明文本不符：「${r.hint}」`);
      assert.equal(r.ico, false, '未传 icon 时不应渲染 .empty__ico');
      return `class="${r.cls}" title="${r.title}" hint="${r.hint}"`;
    });

    await check('C02', 'emptyState：HTML 特殊字符按文本渲染，不注入元素/不执行脚本', async () => {
      const r = await ev(`(async () => {
        const { emptyState } = await window.__qaC.load('js/components/states.js');
        const titlePayload = '<img src=x onerror="window.__qaPwned=1">安全标题';
        const hintPayload = '<b>粗体</b> & <script>window.__qaPwned=2<\\/script>';
        const el = emptyState({ icon: 'warning', title: titlePayload, hint: hintPayload });
        document.body.append(el);
        const titleEl = el.querySelector('.empty__title');
        const hintEl = el.querySelector('.empty__hint');
        const out = {
          titleText: titleEl ? titleEl.textContent : null,
          titleEquals: titleEl ? titleEl.textContent === titlePayload : false,
          titleChildElements: titleEl ? titleEl.children.length : -1,
          hintEquals: hintEl ? hintEl.textContent === hintPayload : false,
          hintChildElements: hintEl ? hintEl.children.length : -1,
          imgCount: el.querySelectorAll('img').length,
          scriptCount: el.querySelectorAll('script').length,
          pwned: window.__qaPwned === undefined ? null : window.__qaPwned,
        };
        el.remove();
        return out;
      })()`, { awaitPromise: true });
      assert.equal(r.titleEquals, true, '标题应按纯文本渲染（textContent 等于原始字符串）');
      assert.equal(r.titleChildElements, 0, `标题内不得生成子元素（实际 ${r.titleChildElements} 个）`);
      assert.equal(r.hintEquals, true, '说明应按纯文本渲染');
      assert.equal(r.hintChildElements, 0, `说明内不得生成子元素（实际 ${r.hintChildElements} 个）`);
      assert.equal(r.imgCount, 0, '不得注入 <img>');
      assert.equal(r.scriptCount, 0, '不得注入 <script>');
      assert.equal(r.pwned, null, '注入的 onerror/script 不得被执行');
      return `title/hint 均为纯文本（无子元素、img=${r.imgCount}、script=${r.scriptCount}）`;
    });

    await check('C03', 'emptyState：actions 被 append（顺序保持、跳过空值）', async () => {
      const r = await ev(`(async () => {
        const { emptyState } = await window.__qaC.load('js/components/states.js');
        const a1 = document.createElement('button');
        a1.textContent = '动作一';
        a1.dataset.qa = 'a1';
        const a2 = document.createElement('a');
        a2.textContent = '动作二';
        a2.href = '#qa';
        const el = emptyState({ title: 't', actions: [a1, null, a2] });
        const acts = [...el.querySelectorAll('button, a')];
        return {
          acts: acts.map((n) => window.__qaC.txt(n)),
          lastIsA2: el.lastElementChild === a2,
          firstIsA1: acts[0] === a1,
          count: acts.length,
        };
      })()`, { awaitPromise: true });
      assert.deepEqual(r.acts, ['动作一', '动作二'], `actions 顺序不符：${j(r.acts)}`);
      assert.equal(r.count, 2, `actions 数量应为 2（实际 ${r.count}）`);
      assert.equal(r.lastIsA2, true, '最后一个 action 应是传入的 a2 节点本身');
      assert.equal(r.firstIsA1, true, '第一个 action 应是传入的 a1 节点本身');
      return `${because(r.acts)}；节点身份保持`;
    });

    await check('C04', 'emptyState：padTop 生效（有值写内联 padding-top，无值不写）', async () => {
      const r = await ev(`(async () => {
        const { emptyState } = await window.__qaC.load('js/components/states.js');
        const withPad = emptyState({ title: 't', padTop: 120 });
        const noPad = emptyState({ title: 't' });
        document.body.append(withPad, noPad);
        const out = {
          inlinePad: withPad.style.paddingTop,
          inlineNone: noPad.style.paddingTop,
          computed: getComputedStyle(withPad).paddingTop,
          computedNone: getComputedStyle(noPad).paddingTop,
        };
        withPad.remove(); noPad.remove();
        return out;
      })()`, { awaitPromise: true });
      assert.equal(r.inlinePad, '120px', `padTop:120 应写内联 padding-top:120px，实际「${r.inlinePad}」`);
      assert.equal(r.computed, '120px', `计算样式 padding-top 应被内联值覆盖为 120px，实际「${r.computed}」`);
      assert.equal(r.inlineNone, '', '未传 padTop 不应写内联 padding-top（容器间距交给 CSS）');
      assert.notEqual(r.computedNone, '120px', `未传 padTop 时不应得到 120px，实际「${r.computedNone}」`);
      return `padTop → inline/${r.inlinePad} computed/${r.computed}；无 padTop → 内联空、CSS 默认 ${r.computedNone}`;
    });

    await check('C05', 'emptyState：titleTag 支持 h3（保留标题层级语义）', async () => {
      const r = await ev(`(async () => {
        const { emptyState } = await window.__qaC.load('js/components/states.js');
        const el = emptyState({ title: '区块标题', titleTag: 'h3' });
        const t = el.querySelector('.empty__title');
        return {
          tag: t ? t.tagName : null,
          hasH3: !!el.querySelector('h3.empty__title'),
          hasDivTitle: !!el.querySelector('div.empty__title'),
          text: window.__qaC.txt(t),
        };
      })()`, { awaitPromise: true });
      assert.equal(r.tag, 'H3', `titleTag:'h3' 应生成 H3，实际 ${r.tag}`);
      assert.equal(r.hasH3, true, '应存在 h3.empty__title');
      assert.equal(r.hasDivTitle, false, '不应再生成 div.empty__title');
      assert.equal(r.text, '区块标题');
      return 'h3.empty__title 生成正确';
    });

    await check('C06', 'emptyBody：返回节点数组（无容器），空参数返回空数组', async () => {
      const r = await ev(`(async () => {
        const { emptyBody } = await window.__qaC.load('js/components/states.js');
        const btn = document.createElement('button');
        btn.textContent = '动作';
        const nodes = emptyBody({ icon: 'filter', title: 'x', hint: 'y', actions: [btn] });
        const bare = emptyBody({});
        return {
          isArray: Array.isArray(nodes),
          count: nodes.length,
          isFragment: nodes.some((n) => n.nodeType === 11),
          hasEmptyContainer: nodes.some((n) => n.classList && n.classList.contains('empty')),
          classes: nodes.filter((n) => n.classList).map((n) => n.className),
          bare: bare.length,
          actionIsNode: nodes.includes(btn),
        };
      })()`, { awaitPromise: true });
      assert.equal(r.isArray, true, 'emptyBody 应返回数组');
      assert.equal(r.count, 4, `icon+title+hint+action 应 4 个节点（实际 ${r.count}）`);
      assert.equal(r.hasEmptyContainer, false, 'emptyBody 不应自带 .empty 容器（容器由 emptyState 负责）');
      assert.equal(r.isFragment, false, '不应返回 DocumentFragment');
      assert.equal(r.actionIsNode, true, 'actions 应原样包含传入节点');
      for (const cls of ['empty__ico', 'empty__title', 'empty__hint']) {
        assert.ok(r.classes.includes(cls), `节点 class 缺 ${cls}：${j(r.classes)}`);
      }
      assert.equal(r.bare, 0, 'emptyBody({}) 应返回空数组');
      return `nodes=${r.count} classes=${r.classes.join(' / ')}`;
    });

    await check('C07', 'loadingState：含「正在载入数据」+ .empty，支持自定义文案', async () => {
      const r = await ev(`(async () => {
        const { loadingState } = await window.__qaC.load('js/components/states.js');
        const def = loadingState();
        const custom = loadingState({ text: '自定义载入中…', hint: '自定义提示' });
        return {
          wrapCls: def.className,
          hasEmpty: !!def.querySelector('.empty'),
          text: def.textContent || '',
          title: window.__qaC.txt(def.querySelector('.empty__title')),
          hint: window.__qaC.txt(def.querySelector('.empty__hint')),
          pad: def.querySelector('.empty').style.paddingTop,
          customText: custom.textContent || '',
        };
      })()`, { awaitPromise: true });
      assert.ok(String(r.wrapCls).split(/\s+/).includes('wrap'), `loadingState 外层应带 wrap class，实际「${r.wrapCls}」`);
      assert.equal(r.hasEmpty, true, 'loadingState 应含 .empty 容器');
      assert.match(r.text, /正在载入数据/, '默认文案应含「正在载入数据」');
      assert.equal(r.hint, '数据来自本地 data/，不联网。', `默认 hint 不符：「${r.hint}」`);
      assert.equal(r.pad, '120px', `默认 padTop 应为 120px，实际「${r.pad}」`);
      assert.match(r.customText, /自定义载入中/, '自定义 text 应生效');
      return `「${r.title}」/「${r.hint}」pad=${r.pad}`;
    });

    await check('C08', 'errorState：warning 图标 + 默认标题 + err.message 渲染', async () => {
      const r = await ev(`(async () => {
        const { errorState } = await window.__qaC.load('js/components/states.js');
        const { icon } = await window.__qaC.load('js/core/icons.js');
        const el = errorState({ err: new Error('BOOM-ERR') });
        const ico = el.querySelector('.empty__ico svg');
        const expected = icon('warning', { size: 40 });
        return {
          wrapCls: el.className,
          hasEmpty: !!el.querySelector('.empty'),
          title: window.__qaC.txt(el.querySelector('.empty__title')),
          hint: window.__qaC.txt(el.querySelector('.empty__hint')),
          hasIco: !!ico,
          icoSame: ico ? ico.outerHTML === expected.outerHTML : false,
          buttons: el.querySelectorAll('button').length,
        };
      })()`, { awaitPromise: true });
      assert.ok(String(r.wrapCls).split(/\s+/).includes('wrap'), `errorState 外层应带 wrap class，实际「${r.wrapCls}」`);
      assert.equal(r.title, '页面载入失败', `默认标题不符：「${r.title}」`);
      assert.match(r.hint, /BOOM-ERR/, `说明应含 err.message，实际「${r.hint}」`);
      assert.equal(r.hasIco, true, 'errorState 应渲染 .empty__ico 图标');
      assert.equal(r.icoSame, true, '图标应是 warning@40（与 icons.js 输出结构完全一致）');
      assert.equal(r.buttons, 0, '未传 onRetry 时不应渲染按钮');
      return `title="${r.title}" hint="${r.hint}" icon=warning@40`;
    });

    await check('C09', 'errorState：hint 优先于 err.message', async () => {
      const r = await ev(`(async () => {
        const { errorState } = await window.__qaC.load('js/components/states.js');
        const withHint = errorState({ err: new Error('ERR-TEXT'), hint: 'HINT-TEXT' });
        const errOnly = errorState({ err: new Error('ERR-ONLY') });
        return {
          hint: window.__qaC.txt(withHint.querySelector('.empty__hint')),
          errOnly: window.__qaC.txt(errOnly.querySelector('.empty__hint')),
        };
      })()`, { awaitPromise: true });
      assert.equal(r.hint, 'HINT-TEXT', `传 hint 时应优先显示 hint，实际「${r.hint}」`);
      assert.ok(!r.hint.includes('ERR-TEXT'), 'hint 优先时不应出现 err.message');
      assert.match(r.errOnly, /ERR-ONLY/, '无 hint 时应回退到 err.message');
      return `hint 优先「${r.hint}」；无 hint 回退「${r.errOnly}」`;
    });

    await check('C10', 'errorState：点击「重试」调用 onRetry 恰一次（每次点击）', async () => {
      const r = await ev(`(async () => {
        const { errorState } = await window.__qaC.load('js/components/states.js');
        window.__qaRetryN = 0;
        const el = errorState({ err: new Error('x'), onRetry: () => { window.__qaRetryN += 1; } });
        document.body.append(el);
        const btn = el.querySelector('button');
        const label = window.__qaC.txt(btn);
        const cls = btn ? btn.className : '';
        btn.click();
        const afterFirst = window.__qaRetryN;
        btn.click();
        const afterSecond = window.__qaRetryN;
        el.remove();
        return { label, cls, afterFirst, afterSecond, buttons: el.querySelectorAll('button').length };
      })()`, { awaitPromise: true });
      assert.equal(r.buttons, 1, `传 onRetry 时应恰好 1 个按钮（实际 ${r.buttons}）`);
      assert.equal(r.label, '重试', `按钮文案应为「重试」，实际「${r.label}」`);
      assert.equal(r.afterFirst, 1, `一次点击应恰好调用 onRetry 1 次（实际 ${r.afterFirst}）`);
      assert.equal(r.afterSecond, 2, `第二次点击后应累计 2 次（实际 ${r.afterSecond}）`);
      return `按钮「${r.label}」class="${r.cls}"：点击 1→${r.afterFirst}，2→${r.afterSecond}`;
    });

    await check('C11', 'errorState：retryText 可自定义；无 onRetry 不渲染按钮', async () => {
      const r = await ev(`(async () => {
        const { errorState } = await window.__qaC.load('js/components/states.js');
        const custom = errorState({ onRetry: () => {}, retryText: '再试一次' });
        const none = errorState({ err: new Error('没有重试') });
        return {
          customText: window.__qaC.txt(custom.querySelector('button')),
          noneButtons: none.querySelectorAll('button').length,
        };
      })()`, { awaitPromise: true });
      assert.equal(r.customText, '再试一次', `retryText 未生效：「${r.customText}」`);
      assert.equal(r.noneButtons, 0, `无 onRetry 时不应有按钮（实际 ${r.noneButtons}）`);
      return 'retryText 生效；无 onRetry 无按钮';
    });

    /* =============================== panel.js =============================== */

    await check('C12', 'panel：结构 .panel > .panel__head + .panel__body（直系两子节点）', async () => {
      const r = await ev(`(async () => {
        const { panel } = await window.__qaC.load('js/components/panel.js');
        const p = panel({ title: '面板标题', body: '正文' });
        const kids = [...p.el.children].map((n) => ({ tag: n.tagName, cls: n.className }));
        return {
          tag: p.el.tagName,
          cls: p.el.className,
          kids,
          childCount: p.el.children.length,
          headFirst: p.el.children[0] === p.head,
          bodySecond: p.el.children[1] === p.body,
          directHead: !!p.el.querySelector(':scope > .panel__head'),
          directBody: !!p.el.querySelector(':scope > .panel__body'),
        };
      })()`, { awaitPromise: true });
      assert.equal(r.tag, 'SECTION', `panel 默认容器应为 section，实际 ${r.tag}`);
      assert.ok(String(r.cls).split(/\s+/).includes('panel'), `容器 class 应含 panel，实际「${r.cls}」`);
      assert.equal(r.childCount, 2, `panel 应恰有 2 个直系子节点（实际 ${r.childCount}，${j(r.kids)}）`);
      assert.equal(r.kids[0].cls, 'panel__head', `第 1 个子节点应为 .panel__head，实际「${r.kids[0].cls}」`);
      assert.equal(r.kids[1].cls, 'panel__body', `第 2 个子节点应为 .panel__body，实际「${r.kids[1].cls}」`);
      assert.equal(r.headFirst, true, 'children[0] 应就是返回的 head 引用');
      assert.equal(r.bodySecond, true, 'children[1] 应就是返回的 body 引用');
      assert.equal(r.directHead, true);
      assert.equal(r.directBody, true);
      return `${r.tag}.panel > ${r.kids.map((k) => k.cls).join(' + ')}`;
    });

    await check('C13', 'panel：标题在 .panel__head h2.panel__title，tools 进 .panel__tools', async () => {
      const r = await ev(`(async () => {
        const { panel } = await window.__qaC.load('js/components/panel.js');
        const btn = document.createElement('button');
        btn.textContent = '工具';
        btn.dataset.qa = 'tool';
        const p = panel({ title: '标题甲', tools: [btn], body: 'x' });
        return {
          titleTag: p.title.tagName,
          titleCls: p.title.className,
          titleText: window.__qaC.txt(p.title),
          inHeadH2: !!p.el.querySelector('.panel__head h2.panel__title'),
          toolsCls: p.tools.className,
          toolsInHead: !!p.el.querySelector('.panel__head .panel__tools'),
          toolIdentity: p.el.querySelector('.panel__tools button') === btn,
          toolsCount: p.tools.children.length,
        };
      })()`, { awaitPromise: true });
      assert.equal(r.titleTag, 'H2', `panel 标题应为 h2，实际 ${r.titleTag}`);
      assert.ok(String(r.titleCls).split(/\s+/).includes('panel__title'), `标题 class 应含 panel__title，实际「${r.titleCls}」`);
      assert.equal(r.inHeadH2, true, '标题应位于 .panel__head 下的 h2.panel__title');
      assert.equal(r.titleText, '标题甲');
      assert.equal(r.toolsCls, 'panel__tools', `工具区 class 应为 panel__tools，实际「${r.toolsCls}」`);
      assert.equal(r.toolsInHead, true, '工具区应位于 .panel__head 内');
      assert.equal(r.toolIdentity, true, 'tools 节点应原样进入 .panel__tools');
      assert.equal(r.toolsCount, 1, `工具区子节点数应为 1（实际 ${r.toolsCount}）`);
      return `h2.panel__title「${r.titleText}」+ .panel__tools×${r.toolsCount}`;
    });

    await check('C14', 'panel：body 节点挂载、flush 类、返回引用与 DOM 一致', async () => {
      const r = await ev(`(async () => {
        const { panel } = await window.__qaC.load('js/components/panel.js');
        const bodyNode = document.createElement('div');
        bodyNode.textContent = '主体内容';
        const p = panel({ title: 't', body: bodyNode });
        const pf = panel({ title: 't', body: 'x', flush: true });
        return {
          bodyCls: p.body.className,
          bodyHasNode: p.body.contains(bodyNode),
          bodyText: window.__qaC.txt(p.body),
          flushCls: pf.body.className,
          noFlush: String(p.body.className).includes('--flush'),
          refs: {
            body: p.body === p.el.querySelector('.panel__body'),
            head: p.head === p.el.children[0],
            title: p.title === p.el.querySelector('.panel__title'),
            tools: p.tools === p.el.querySelector('.panel__tools'),
          },
        };
      })()`, { awaitPromise: true });
      assert.equal(r.bodyCls, 'panel__body', `默认 body class 应为 panel__body，实际「${r.bodyCls}」`);
      assert.equal(r.bodyHasNode, true, '传入的 body 节点应挂进 .panel__body');
      assert.equal(r.bodyText, '主体内容');
      assert.equal(r.flushCls, 'panel__body panel__body--flush', `flush 时 body class 应为「panel__body panel__body--flush」，实际「${r.flushCls}」`);
      assert.equal(r.noFlush, false, '非 flush 时不得带 --flush 类');
      for (const [k, ok] of Object.entries(r.refs)) assert.equal(ok, true, `panel 返回的 ${k} 引用应与 DOM 节点一致`);
      return `body="${r.bodyCls}"；flush="${r.flushCls}"；4 个引用一致`;
    });

    await check('C15', 'panel：自定义 tag 与 sub 说明', async () => {
      const r = await ev(`(async () => {
        const { panel } = await window.__qaC.load('js/components/panel.js');
        const p = panel({ title: 't', tag: 'article', sub: '说明文字', body: 'x' });
        const noSub = panel({ title: 't' });
        return {
          tag: p.el.tagName,
          cls: p.el.className,
          sub: window.__qaC.txt(p.el.querySelector('.panel__sub')),
          subInHead: !!p.el.querySelector('.panel__head .panel__sub'),
          noSubHas: !!noSub.el.querySelector('.panel__sub'),
        };
      })()`, { awaitPromise: true });
      assert.equal(r.tag, 'ARTICLE', `tag:'article' 应生成 article，实际 ${r.tag}`);
      assert.ok(String(r.cls).split(/\s+/).includes('panel'), '自定义 tag 容器仍应带 panel 类');
      assert.equal(r.sub, '说明文字', `sub 文案不符：「${r.sub}」`);
      assert.equal(r.subInHead, true, '.panel__sub 应位于 .panel__head 内');
      assert.equal(r.noSubHas, false, '未传 sub 时不应渲染 .panel__sub');
      return `${r.tag}.panel + .panel__sub「${r.sub}」`;
    });

    await check('C16', 'panel：同输入两次 outerHTML 完全一致（确定性，含 icon/tools）', async () => {
      const r = await ev(`(async () => {
        const { panel } = await window.__qaC.load('js/components/panel.js');
        const mk = () => {
          const btn = document.createElement('button');
          btn.className = 'btn btn--ghost';
          btn.textContent = '按钮';
          btn.dataset.qa = 'tool';
          return panel({ title: '同标题', icon: 'flask', sub: '同说明', tools: [btn], body: '内容' });
        };
        const a = mk();
        const b = mk();
        return { same: a.el.outerHTML === b.el.outerHTML, len: a.el.outerHTML.length, html: a.el.outerHTML.slice(0, 120) };
      })()`, { awaitPromise: true });
      assert.equal(r.same, true, '同输入两次 panel().el.outerHTML 应完全一致');
      assert.ok(r.len > 100, `outerHTML 长度异常：${r.len}`);
      return `两次 outerHTML 一致（${r.len} chars）`;
    });

    await check('C17', 'panel：标题图标渲染为 svg（与 icons.js 输出一致），无 icon 不渲染', async () => {
      const r = await ev(`(async () => {
        const { panel } = await window.__qaC.load('js/components/panel.js');
        const { icon } = await window.__qaC.load('js/core/icons.js');
        const withIcon = panel({ title: '带图标', icon: 'flask', body: 'x' });
        const noIcon = panel({ title: '无图标', body: 'x' });
        const svg = withIcon.el.querySelector('.panel__head .panel__title svg');
        const expected = icon('flask', { size: 15 });
        return {
          hasSvg: !!svg,
          svgSame: svg ? svg.outerHTML === expected.outerHTML : false,
          svgCount: withIcon.el.querySelectorAll('.panel__title svg').length,
          noIconSvg: noIcon.el.querySelectorAll('.panel__title svg').length,
        };
      })()`, { awaitPromise: true });
      assert.equal(r.hasSvg, true, '带 icon 时标题内应有 svg');
      assert.equal(r.svgSame, true, '标题图标应与 icon(\'flask\',{size:15}) 结构一致');
      assert.equal(r.svgCount, 1, `标题内应恰有 1 个 svg（实际 ${r.svgCount}）`);
      assert.equal(r.noIconSvg, 0, `无 icon 时不应渲染 svg（实际 ${r.noIconSvg}）`);
      return 'flask@15 svg 正确；无 icon → 0 svg';
    });

    await check('C18', 'panelHead：返回 {head,title,tools} 契约 + titleId + sub', async () => {
      const r = await ev(`(async () => {
        const { panelHead } = await window.__qaC.load('js/components/panel.js');
        const btn = document.createElement('button');
        btn.textContent = '工具';
        const h = panelHead({ title: '头标题', sub: '副说明', tools: [btn], titleId: 'qa-panel-title' });
        return {
          headTag: h.head.tagName,
          headCls: h.head.className,
          headClassList: h.head.classList.contains('panel__head'),
          titleTag: h.title.tagName,
          titleCls: h.title.className,
          titleId: h.title.id,
          titleText: window.__qaC.txt(h.title),
          toolsCls: h.tools.className,
          toolIn: h.tools.contains(btn),
          sub: window.__qaC.txt(h.head.querySelector('.panel__sub')),
          headChildren: h.head.children.length,
        };
      })()`, { awaitPromise: true });
      assert.equal(r.headTag, 'DIV', `panelHead 头部应为 div，实际 ${r.headTag}`);
      assert.equal(r.headCls, 'panel__head', `头部 class 应为 panel__head，实际「${r.headCls}」`);
      assert.equal(r.headClassList, true);
      assert.equal(r.titleTag, 'H2', `标题应为 h2，实际 ${r.titleTag}`);
      assert.equal(r.titleCls, 'panel__title');
      assert.equal(r.titleId, 'qa-panel-title', `titleId 未落到标题 id：「${r.titleId}」`);
      assert.equal(r.titleText, '头标题');
      assert.equal(r.toolsCls, 'panel__tools');
      assert.equal(r.toolIn, true, 'tools 节点应位于返回的 tools 容器内');
      assert.equal(r.sub, '副说明');
      assert.equal(r.headChildren, 3, `head 应有 3 个子节点（title/sub/tools），实际 ${r.headChildren}`);
      return `div.panel__head(h2#${r.titleId} + .panel__sub + .panel__tools)`;
    });

    await check('C19', '导入方式：相对 location.href 解析，子路径部署同样成立（无根路径 /js/）', async () => {
      const r = await ev(`(() => {
        const hrefOf = (rel, base) => new URL(rel, base).href;
        return {
          rootBase: hrefOf('js/components/states.js', location.href),
          pageDir: new URL('.', location.href).href,
          subpath: hrefOf('js/components/states.js', 'https://user.github.io/relic-archive/#/items'),
          rootPath: hrefOf('js/components/states.js', 'https://user.github.io/relic-archive/'),
        };
      })()`);
      assert.equal(r.rootBase, `${r.pageDir}js/components/states.js`,
        `实际导入应基于页面目录：${r.rootBase} ≠ ${r.pageDir}js/components/states.js`);
      const rootPath = new URL(r.rootBase).pathname;
      const pagePath = new URL(r.pageDir).pathname;
      assert.equal(rootPath, `${pagePath}js/components/states.js`,
        `导入路径应相对页面目录（子路径部署）：${rootPath} 不等于 ${pagePath}js/components/states.js`);
      assert.equal(r.subpath, 'https://user.github.io/relic-archive/js/components/states.js',
        `子路径下解析错误：${r.subpath}`);
      assert.equal(r.rootPath, 'https://user.github.io/relic-archive/js/components/states.js',
        `站点根下的相对解析错误：${r.rootPath}`);
      return `pageDir=${r.pageDir}；import=${r.rootBase}`;
    });

    await check('C20', 'API 面：states.js / panel.js 必需导出齐全（重命名会红）', async () => {
      const r = await ev(`(async () => {
        const states = await window.__qaC.load('js/components/states.js');
        const panel = await window.__qaC.load('js/components/panel.js');
        return {
          states: ['emptyBody', 'emptyState', 'loadingState', 'errorState'].map((k) => typeof states[k]),
          panel: ['panel', 'panelHead'].map((k) => typeof panel[k]),
        };
      })()`, { awaitPromise: true });
      assert.deepEqual(r.states, ['function', 'function', 'function', 'function'],
        `states.js 导出契约不符：${j(r.states)}`);
      assert.deepEqual(r.panel, ['function', 'function'], `panel.js 导出契约不符：${j(r.panel)}`);
      return 'states: emptyBody/emptyState/loadingState/errorState；panel: panel/panelHead';
    });
    await check('C21', 'ui：confirm 被 closeOverlays({silent}) 关闭时按取消 resolve（不挂起）', async () => {
      const r = await ev(`(async () => {
        const { confirm, closeOverlays } = await window.__qaC.load('js/core/ui.js');
        let settled = null;
        confirm({ title: 'QA 确认框', body: '关闭后应 resolve false' }).then((v) => { settled = v; });
        await new Promise((res) => setTimeout(res, 30));
        const modalBefore = !document.querySelector('#modal').hidden;
        const closed = closeOverlays({ silent: true });
        await new Promise((res) => setTimeout(res, 60));
        return { modalBefore, modalAfter: !document.querySelector('#modal').hidden, closed, settled };
      })()`, { awaitPromise: true });
      assert.equal(r.modalBefore, true, 'confirm 应打开弹窗');
      assert.equal(r.modalAfter, false, 'closeOverlays 后弹窗应关闭');
      assert.equal(r.closed.modal, true, 'closeOverlays 应报告关闭了 modal');
      assert.equal(r.settled, false, 'confirm Promise 应以 false 结算（不能永久挂起）');
      return 'modal 关闭 + Promise resolve(false)';
    });

    await check('C22', 'item-detail-sections：效果原文回退只在官方中文缺失时出现（wiki 英文独立区块）', async () => {
      const r = await ev(`(async () => {
        const m = await window.__qaC.load('js/components/item-detail-sections.js');
        const T = window.__qaC.txt;
        const EN = 'Increases All Damage by 10%.';
        const wiki = m.effectWikiSection({ effectZh: '', effectEn: EN, effectSrc: 'wiki', effectMatch: 'wiki-only' });
        const official = m.effectWikiSection({ effectZh: '所有伤害提高 10%。', effectEn: EN, effectSrc: 'official', effectMatch: 'exact' });
        const empty = m.effectWikiSection({ effectZh: '', effectEn: '', effectSrc: '', effectMatch: '' });
        const em = wiki ? wiki.querySelector('.detail-wiki em') : null;
        const badge = wiki ? wiki.querySelector('.detail-sec__head .badge') : null;
        return {
          wikiTitle: wiki ? T(wiki.querySelector('.detail-sec__title')) : '',
          enTag: em ? em.tagName : '',
          enText: em ? T(em) : '',
          badgeText: badge ? T(badge) : '',
          badgeClass: badge ? badge.className : '',
          hasRawEffectCls: wiki ? !!wiki.querySelector('.detail-effect') : true,
          srcLine: wiki ? T(wiki.querySelector('.detail-src')) : '',
          official, empty,
        };
      })()`, { awaitPromise: true });
      assert.ok(r, 'effectWikiSection 未返回结果');
      assert.equal(r.wikiTitle, '效果原文（wiki 整理）', `wiki 回退区块标题异常：「${r.wikiTitle}」`);
      assert.equal(r.enTag, 'EM', `英文原文应为 <em>（斜体由语义标签给出，不写死样式），实际 ${r.enTag}`);
      assert.equal(r.enText, 'Increases All Damage by 10%.', `英文原文被改写：「${r.enText}」`);
      assert.equal(r.badgeText, '来源：wiki', `来源 badge 文本异常：「${r.badgeText}」`);
      assert.ok(/badge--neutral/.test(r.badgeClass), `badge 应复用既有颜色 token 类：${r.badgeClass}`);
      assert.equal(r.hasRawEffectCls, false, 'wiki 回退区块不得复用 .detail-effect（官方中文原文契约）');
      assert.ok(/wiki/.test(r.srcLine), `缺少来源说明行：「${r.srcLine}」`);
      assert.equal(r.official, null, '有官方中文效果句时不应出现 wiki 英文区块（中文优先）');
      assert.equal(r.empty, null, '中英文都没有时不应渲染区块');
      return `wiki 区块「${r.wikiTitle}」+ ${r.badgeText}；官方中文优先 / 空文本不渲染`;
    });

  } catch (err) {
    fatal = err;
    console.error('[components] 致命错误:', err && err.stack ? err.stack : err);
  } finally {
    try { await new Promise((r) => { setTimeout(r, 80); }); } catch { /* ignore */ }
    if (root && targetId) await root.send('Target.closeTarget', { targetId }).catch(() => {});
    root?.close?.();
    cleanupChrome({ child, profile });
  }

  /* ------------------------------ 汇总 ------------------------------ */
  const pass = rows.filter((r) => r.status === 'PASS').length;
  const fail = rows.filter((r) => r.status === 'FAIL').length;
  const skip = rows.filter((r) => r.status === 'SKIP').length;
  const elapsed = ((Date.now() - started) / 1000).toFixed(1);
  console.log(`[components] PASS=${pass} FAIL=${fail} SKIP=${skip}（${elapsed}s，BASE=${BASE}）`);
  if (fatal) console.log(`[components] 环境/启动失败（退出码 2）：${fatal.message || fatal}`);
  if (fail) {
    for (const r of rows.filter((x) => x.status === 'FAIL')) console.log(`  FAIL ${r.id}: ${r.detail}`);
  }
  try {
    fs.writeFileSync(RESULT_FILE, JSON.stringify({
      base: BASE, pass, fail, skip, elapsedSeconds: Number(elapsed),
      fatal: fatal ? String((fatal && fatal.message) || fatal) : null,
      consoleErrors, rows,
    }, null, 2) + '\n', 'utf8');
    console.log(`[components] 结果已写入 ${path.relative(REPO, RESULT_FILE)}`);
  } catch (err) {
    console.error('[components] 结果写入失败:', err && err.message);
  }

  if (fatal) return 2;
  return fail > 0 ? 1 : 0;
}

/* 小工具：结果展示用 */
function because(list) { return `actions=${j(list)}`; }

main().then((code) => process.exit(code)).catch((err) => {
  console.error('[components] 未捕获:', err && err.stack ? err.stack : err);
  process.exit(2);
});
