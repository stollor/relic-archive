#!/usr/bin/env node
/* =============================================================================
   遗迹2 · 遗物档案 — 真实交互验收 v2（Node 22 + Chrome CDP，零依赖）
   对照 docs/UX_SPEC.md §2 / §10 / §11.7（v2 修订），用真实鼠标点击 + 键盘事件驱动。

   用法：
     node qa/interactions.js                # 全部（桌面 1440 + 移动 390）
     node qa/interactions.js --only items,lab,mobile
     node qa/interactions.js --headful      # 有头调试
   输出：qa/results/interactions.json + qa/shots/interact-*.png + 控制台表
   退出码：0 全 PASS（SKIP 不算失败）；1 有 FAIL；2 启动失败

   一条命令跑完全部验收：
     node qa/shot.js --all && node qa/interactions.js && python qa/audit.py
   ========================================================================== */
'use strict';

const fsp = require('node:fs/promises');
const path = require('node:path');
const { CDP, launchChrome, cleanupChrome, sleep } = require('./lib/cdp.js');
const { prefixOf, pageUrl } = require('./lib/base.js');

const QA_DIR = __dirname;
const SHOTS = path.join(QA_DIR, 'shots');
const RESULTS_DIR = path.join(QA_DIR, 'results');
const argv = process.argv.slice(2);
if (argv.includes('--help') || argv.includes('-h')) {
  console.log([
    '用法：node qa/interactions.js [选项]',
    '',
    '  真实交互验收 v2（CDP 真实鼠标点击 + 键盘事件）：',
    '  items 资料库 / lab 实验室 / builds 流派 / codex 知识库 / global 全站（含主题） / mobile 移动端 390×844',
    '',
    '选项：--all（默认全部）｜--only a,b｜--base <url>｜--headful',
    '',
    '输出：qa/results/interactions.json；关键状态/失败截图在 qa/shots/interact-*.png',
    '退出码：0=全 PASS（SKIP 不算失败）；1=存在 FAIL；2=启动失败',
  ].join('\n'));
  process.exit(0);
}
const ALL_FLAG = argv.includes('--all'); void ALL_FLAG;
const BASE = (() => {
  const i = argv.indexOf('--base');
  return (i >= 0 ? argv[i + 1] : 'http://127.0.0.1:8777').replace(/\/+$/, '');
})();
/** 部署前缀：根部署 ''，GitHub Pages 子路径部署 '/relic-archive'（页面内 import/fetch 必须带） */
const PFX = prefixOf(BASE);
const ONLY = (() => {
  const i = argv.indexOf('--only');
  return i >= 0 ? String(argv[i + 1] || '').split(',').map((s) => s.trim()).filter(Boolean) : null;
})();
const HEADFUL = argv.includes('--headful');
const VIEW = { w: 1440, h: 1000 };
const MOBILE = { w: 390, h: 844 };

const AREAS = {
  items: '资料库 · §2/§11.1-11.3',
  lab: '实验室 · §11.4',
  builds: '流派 · 配装推荐（7 套 + 详情 + 装入实验室）',
  codex: '知识库 · §2',
  global: '全站 · 路由/计数/主题/控制台',
  mobile: '移动端 390×844',
};

const results = [];
const consoleErrors = [];
const externalRequests = [];
let currentTest = '';
let page = null;
let cdpRoot = null;
let session = null;

/* ------------------------------- 记录 ------------------------------- */
function record(area, id, name, status, detail, extra = {}) {
  const row = { area, id, name, status, detail: detail == null ? '' : String(detail).slice(0, 1400), ...extra };
  results.push(row);
  const tag = status === 'PASS' ? 'PASS' : status === 'SKIP' ? 'SKIP' : 'FAIL';
  console.log(`${tag} [${area}] ${id} ${name}${row.detail ? ` — ${String(row.detail).slice(0, 200)}` : ''}`);
  return row;
}

async function capture(name) {
  try {
    const shot = await cdpRoot.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }, session);
    const file = path.join(SHOTS, `${name}.png`);
    await fsp.mkdir(SHOTS, { recursive: true });
    await fsp.writeFile(file, Buffer.from(shot.data, 'base64'));
    return path.relative(QA_DIR, file);
  } catch { return null; }
}

/* ------------------------------ 页面侧助手 ------------------------------ */
const PAGE_HELPERS = String.raw`(() => {
  const one = (s, r) => (r || document).querySelector(s);
  const all = (s, r) => Array.from((r || document).querySelectorAll(s));
  const ls = (k, d) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } };
  const txt = (el) => (el ? String(el.textContent || '').replace(/\s+/g, ' ').trim() : '');
  window.__qa = {
    one, all, txt, ls,
    modalRect() { const m = one('#modal'); const c = one('#modal .modal__card');
      if (!m || m.hidden || !c) return null; const r = c.getBoundingClientRect();
      return { w: Math.round(r.width), h: Math.round(r.height), x: Math.round(r.left),
        cx: Math.round(r.left + r.width / 2) }; },
    drawerRect() { const d = one('#drawer'); if (!d || d.hidden) return null;
      const r = d.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height) }; },
    state() {
      const m = one('#modal'), d = one('#drawer'), root = one('#view-root');
      return {
        hash: location.hash, title: document.title,
        modal: { open: !!m && !m.hidden, title: txt(one('#modal .modal__title')) },
        drawer: { open: !!d && !d.hidden && d.classList.contains('is-open'), title: txt(one('#drawer .drawer__title')) },
        owned: ls('r2.v2.owned', []), fav: ls('r2.v2.fav', []), build: ls('r2.v2.build', {}),
        statOwned: txt(one('#statOwned b')), statFav: txt(one('#statFav b')),
        domnav: all('.domnav__link.is-on').map((a) => a.dataset.domain),
        counts: {
          cards: all('#view-root .card').length,
          rows: all('#view-root .lib-row').length,
          chips: all('#view-root .chip').length,
          tagGroups: all('.lib-filters .lib-taggroup').length,
          tagChips: all('.lib-filters .lib-taggroup .chip').length,
          slots: all('.slot').length,
          pickerRows: all('#drawer .picker-row').length,
          archRows: all('#drawer .lab-archrow').length,
          h1: all('h1').length,
        },
        activeTag: document.activeElement ? document.activeElement.tagName.toLowerCase() : '',
        activeType: document.activeElement ? String(document.activeElement.type || '') : '',
        activeLabel: document.activeElement ? (document.activeElement.getAttribute('aria-label') || '') : '',
        scroll: { sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth,
          iw: window.innerWidth, sh: document.documentElement.scrollHeight, ih: window.innerHeight },
        text: root ? txt(root) : '',
      };
    },
  };
})()`;

class Page {
  constructor(root, sid) { this.root = root; this.sid = sid; }

  async ev(expression, { awaitPromise = false } = {}) {
    const r = await this.root.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise }, this.sid);
    if (r.exceptionDetails) {
      throw new Error('页面异常：' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
    }
    return r.result ? r.result.value : undefined;
  }

  async goto(hash, { fresh = false } = {}) {
    const url = pageUrl(BASE, hash);
    if (fresh) await this.root.send('Page.navigate', { url: 'about:blank' }, this.sid).catch(() => {});
    await this.root.send('Page.navigate', { url }, this.sid);
    await this.waitReady();
    await this.waitLoaded();
  }

  async waitReady(timeout = 25000) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
      const ok = await this.ev(`(() => { const r = document.querySelector('#view-root');
        if (!r) return false;
        const t = (r.textContent || '').trim();
        const loading = /正在载入数据|正在读取 site_data/.test(t);
        return !!r.querySelector('.view') && !loading; })()`).catch(() => false);
      if (ok) { await sleep(220); return; }
      await sleep(120);
    }
    throw new Error(`等待视图就绪超时（${timeout}ms）`);
  }

  async waitLoaded(timeout = 15000) {
    await this.waitFor(`(() => { const r = document.querySelector('#view-root');
      if (!r) return false; const t = r.textContent || '';
      return !/正在读取|正在载入|载入中/.test(t) && !r.querySelector('.sk, .panel-loading'); })()`, timeout);
  }

  async waitFor(expr, timeout = 6000, interval = 120) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
      if (await this.ev(`(() => { try { return !!(${expr}); } catch (e) { return false; } })()`).catch(() => false)) return true;
      await sleep(interval);
    }
    return false;
  }

  async waitCount(sel, min = 1, timeout = 15000) {
    return this.waitFor(`document.querySelectorAll(${JSON.stringify(sel)}).length >= ${min}`, timeout);
  }

  async state() { return this.ev('window.__qa.state()'); }
  async count(sel) { return this.ev(`document.querySelectorAll(${JSON.stringify(sel)}).length`); }
  async text(sel) { return this.ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)});
    return e ? (e.textContent || '').replace(/\s+/g, ' ').trim() : ''; })()`); }

  async rect(expr) {
    return this.ev(`(() => { const el = ${expr}; if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2),
               w: Math.round(r.width * 10) / 10, h: Math.round(r.height * 10) / 10,
               left: Math.round(r.left), top: Math.round(r.top) }; })()`);
  }

  async click(expr, { label = '' } = {}) {
    await this.ev(`(() => { const el = ${expr}; if (el && el.scrollIntoView) el.scrollIntoView({ block: 'center', inline: 'nearest' }); return !!el; })()`).catch(() => {});
    await sleep(130);
    const r = await this.rect(expr);
    if (!r || r.w <= 0 || r.h <= 0) throw new Error(`点击目标不可见：${label || expr}`);
    const { x, y } = r;
    await this.root.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y }, this.sid);
    await this.root.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 }, this.sid);
    await this.root.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 }, this.sid);
    await sleep(300);
    return r;
  }

  async key(key, { alt = false, ctrl = false, meta = false } = {}) {
    let modifiers = 0;
    if (alt) modifiers |= 1;
    if (ctrl) modifiers |= 2;
    if (meta) modifiers |= 4;
    const codeMap = { Escape: 'Escape', '/': 'Slash', '1': 'Digit1', '2': 'Digit2', '3': 'Digit3', '4': 'Digit4', t: 'KeyT' };
    const vk = { Escape: 27, '/': 191, '1': 49, '2': 50, '3': 51, '4': 52, t: 84 }[key] || 0;
    const base = { key, code: codeMap[key] || key, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, modifiers };
    await this.root.send('Input.dispatchKeyEvent', { type: 'keyDown', text: key.length === 1 ? key : undefined, ...base }, this.sid);
    await this.root.send('Input.dispatchKeyEvent', { type: 'keyUp', ...base }, this.sid);
    await sleep(240);
  }

  async ensureClean() {
    for (let i = 0; i < 3; i++) {
      const st = await this.state();
      if (!st.modal.open && !st.drawer.open) return;
      await this.key('Escape');
      await sleep(280);
    }
  }

  async apiItems() {
    return this.ev(`(async () => { const { api } = await import('${PFX}/js/core/api.js');
      return api.itemsSync().map((i) => ({ id: i.id, cat: i.cat, family: i.family,
        damage: i.damage, armor: i.armor, weight: i.weight, zh: i.zh,
        descZh: i.descZh || '', summaryZh: i.summaryZh || '', effectPreview: i.effectPreview || '' })); })()`, { awaitPromise: true });
  }
}

/* ------------------------------ 测试工具 ------------------------------ */
async function step(area, id, name, fn) {
  currentTest = id;
  try {
    const r = await fn();
    const detail = r && typeof r === 'object' ? (r.detail ?? JSON.stringify(r)) : (r ?? '');
    return record(area, id, name, 'PASS', detail, r && typeof r === 'object' ? { data: r.data } : {});
  } catch (e) {
    const covered = e && e.message && /^BLOCKED:/.test(e.message);
    const shot = await capture(`fail-${id}`);
    return record(area, id, name, covered ? 'SKIP' : 'FAIL',
      covered ? e.message.replace(/^BLOCKED:\s*/, '') : String((e && e.message) || e),
      { shot });
  }
}

function assert(cond, msg) { if (!cond) throw new Error(msg); }
const CJK = /[\u4e00-\u9fff]/;

/* ============================== 资料库 ============================== */
async function openFirstCardModal() {
  await page.goto('#/items', { fresh: true });
  await page.waitCount('#view-root .card', 1);
  await page.click(`document.querySelector('#view-root .card')`, { label: '首个物品卡' });
  const ok = await page.waitFor(`!document.querySelector('#modal').hidden`, 6000);
  assert(ok, '点卡片后 #modal 未打开');
  await sleep(300);
}

async function runItems() {
  const A = 'items';
  await step(A, 'I1', '#/items 卡片列表渲染', async () => {
    await page.goto('#/items', { fresh: true });
    await page.waitCount('#view-root .card', 20);
    const n = await page.count('#view-root .card');
    assert(n >= 20, `卡片数 ${n} < 20`);
    return { detail: `首屏 ${n} 张卡` };
  });

  await step(A, 'I2', '桌面点卡片 → 居中弹窗 #modal（#drawer 不可见）+ 路由写 #/items/<id>', async () => {
    await page.ensureClean();
    await openFirstCardModal();
    const st = await page.state();
    assert(st.modal.open, '#modal 未可见');
    assert(!st.drawer.open, '#drawer 仍可见（桌面应为弹窗）');
    assert(/^#\/items\/.+/.test(st.hash), `路由未写详情：${st.hash}`);
    await capture('interact-detail-modal');
    return { detail: `modal「${st.modal.title}」；hash=${st.hash}` };
  });

  await step(A, 'I3', '弹窗宽度 ≤1040px 且水平居中（±16px）', async () => {
    const r = await page.ev('window.__qa.modalRect()');
    assert(r, '取不到弹窗尺寸');
    assert(r.w <= 1041, `弹窗宽 ${r.w} > 1040`);
    assert(Math.abs(r.cx - VIEW.w / 2) <= 16, `弹窗未居中：centerX=${r.cx} vs ${VIEW.w / 2}`);
    return { detail: `宽 ${r.w}px（≤1040），centerX=${r.cx}` };
  });

  await step(A, 'I4', '详情大图实际宽度 ≥ 240px', async () => {
    const info = await page.ev(`(() => {
      const m = document.querySelector('#modal');
      const img = m.querySelector('.detail-hero__media img, .detail-hero img, img');
      const hero = m.querySelector('.detail-hero, .detail-hero__media');
      return { imgW: img ? Math.round(img.getBoundingClientRect().width) : 0,
        heroW: hero ? Math.round(hero.getBoundingClientRect().width) : 0,
        src: img ? (img.src || '').split('/').pop() : '' }; })()`);
    assert(info.imgW >= 240, `详情图实际宽 ${info.imgW}px < 240px（容器 ${info.heroW}px，${info.src}）`);
    return { detail: `图片 ${info.imgW}px` };
  });

  // 读取当前详情（桌面 modal / 移动 drawer 统一）
  const readDetail = () => page.ev(`(() => {
    const m = (document.querySelector('#modal') && !document.querySelector('#modal').hidden)
      ? document.querySelector('#modal') : document.querySelector('#drawer');
    if (!m) return null;
    const secs = [...m.querySelectorAll('.detail-sec')].map((s) => ({
      title: ((s.querySelector('.detail-sec__title') || {}).textContent || '').trim(),
      text: (s.textContent || '').replace(/\s+/g, ' ').trim(),
      effectBlocks: s.querySelectorAll('.detail-effect').length,
    }));
    return { shell: m.id, titles: secs.map((x) => x.title), secs,
      effectBlocks: m.querySelectorAll('.detail-effect').length,
      detailEffectText: ((m.querySelector('.detail-effect') || {}).textContent || '').replace(/\s+/g, ' ').trim() }; })()`);

  const openDetailById = async (id) => {
    await page.ensureClean();
    await page.goto(`#/items/${encodeURIComponent(id)}`, { fresh: true });
    const ok = await page.waitFor(`(() => { const m = document.querySelector('#modal'); const d = document.querySelector('#drawer');
      return (m && !m.hidden) || (d && !d.hidden); })()`, 8000);
    assert(ok, `深链 ${id} 未打开详情`);
    await sleep(350);
    return readDetail();
  };

  await step(A, 'I5', '效果类目详情首块按新契约：有 effectZh → 首块「效果」(18px 原文)；无 → 首块「效果」(数值行)', async () => {
    const d = await openDetailById('Ring_PanMageSigil');
    assert(d, '详情未渲染');
    assert(d.titles[0] === '效果', `Ring_PanMageSigil 首块="${d.titles[0]}"（应为「效果」）；区块=${d.titles.join('/')}`);
    assert(d.effectBlocks >= 1, '缺少 .detail-effect 官方效果原文块');
    assert(/状态效果/.test(d.detailEffectText), `原文块不含「状态效果」：${d.detailEffectText.slice(0, 80)}`);
    const first = d.secs[0] || { text: '' };
    assert(!/据说/.test(first.text), `首块「效果」混入风味段落（含「据说」）：${first.text.slice(0, 80)}`);
    assert(d.titles.includes('背景'), `缺少「背景」区块；区块=${d.titles.join('/')}`);
    const bg = d.secs.find((s) => s.title === '背景') || { text: '' };
    assert(/据说|来自|传说|故事/.test(bg.text), `「背景」区块未保留风味段落：${bg.text.slice(0, 80)}`);
    return { detail: `Ring_PanMageSigil 区块=${d.titles.join('/')}；原文「${d.detailEffectText.slice(0, 30)}…」；背景保留风味` };
  });

  await step(A, 'I5b', '无 effectZh 的效果类目（Amulet_AbrasiveWhetstone）不渲染「描述」，首块为「效果」数值行', async () => {
    const d = await openDetailById('Amulet_AbrasiveWhetstone');
    assert(d, '详情未渲染');
    assert(!d.titles.includes('描述'), `仍渲染了「描述」区块：${d.titles.join('/')}`);
    assert(d.titles[0] === '效果', `首块="${d.titles[0]}"（应为「效果」数值行）`);
    assert(d.effectBlocks === 0, `不应存在 .detail-effect 原文块（实际 ${d.effectBlocks} 个）`);
    assert(/暴击|伤害|数值|\d/.test(d.secs[0].text), `首块「效果」无数值内容：${d.secs[0].text.slice(0, 60)}`);
    return { detail: `区块=${d.titles.join('/')}；无 detail-effect，首块为数值行` };
  });

  await step(A, 'I5c', '武器详情首块仍是「描述」（非效果类目回归保护）', async () => {
    const d = await openDetailById('Weapon_BladeOfGul');
    assert(d, '详情未渲染');
    assert(d.titles[0] === '描述', `Weapon_BladeOfGul 首块="${d.titles[0]}"（应保持「描述」）；区块=${d.titles.join('/')}`);
    const desc = d.secs[0] || { text: '' };
    assert(desc.text.length > 10 && CJK.test(desc.text), `「描述」内容异常：${desc.text.slice(0, 50)}`);
    return { detail: `区块=${d.titles.join('/')}；首块「描述」` };
  });

  await step(A, 'I5d', 'effectZh 并入 haystack：搜索「状态效果」可命中 Ring_PanMageSigil', async () => {
    const info = await page.ev(`(async () => { const { api } = await import('${PFX}/js/core/api.js');
      const it = api.item('Ring_PanMageSigil') || {};
      const hits = api.itemsSync().filter((x) => (x.haystack || '').includes('状态效果'));
      return { effectZh: it.effectZh || '', hayHit: (it.haystack || '').includes('状态效果'),
        hits: hits.length, hasPan: hits.some((x) => x.id === 'Ring_PanMageSigil') }; })()`, { awaitPromise: true });
    assert(info.effectZh.length > 0, 'Ring_PanMageSigil.effectZh 为空');
    assert(info.hayHit, 'haystack 未包含 effectZh 关键词「状态效果」');
    assert(info.hasPan, '搜索「状态效果」未命中 Ring_PanMageSigil');
    return { detail: `effectZh「${info.effectZh.slice(0, 24)}…」；haystack 命中；全库 ${info.hits} 条命中` };
  });

  await step(A, 'I6', '详情「效果」行：≥1 条，含中文与数值', async () => {
    const d = await openDetailById('Ring_PanMageSigil');
    const info = await page.ev(`(() => {
      const m = (document.querySelector('#modal') && !document.querySelector('#modal').hidden)
        ? document.querySelector('#modal') : document.querySelector('#drawer');
      return { n: m.querySelectorAll('.eff-row').length,
        rows: [...m.querySelectorAll('.eff-row')].slice(0, 4).map((r) => (r.textContent || '').replace(/\s+/g, ' ').trim()) }; })()`);
    assert(info.n >= 1, `效果行数 ${info.n}（应有 ≥1）`);
    assert(info.rows.some((t) => CJK.test(t) && /\d/.test(t)), `效果行缺中文或数值：${JSON.stringify(info.rows)}`);
    return { detail: `${info.n} 条，例「${info.rows[0] || ''}」` };
  });

  await step(A, 'I7', 'Esc 关闭弹窗 → hash 回到列表', async () => {
    await page.key('Escape');
    await sleep(450);
    const st = await page.state();
    assert(!st.modal.open, 'Esc 后弹窗仍打开');
    assert(st.hash === '#/items' || /^#\/items\?/.test(st.hash), `关闭后 hash=${st.hash}`);
    return { detail: `hash=${st.hash}` };
  });

  await step(A, 'I8', '深链 #/items/<id> 直达弹窗（标题匹配）', async () => {
    const id = await page.ev(`(async () => { const { api } = await import('${PFX}/js/core/api.js');
      const its = api.itemsSync().filter((i) => i.isItem && i.cat === 'amulet');
      return its[0] ? its[0].id : (api.itemsSync()[0] || {}).id; })()`, { awaitPromise: true });
    assert(id, '取不到 item id');
    await page.goto(`#/items/${encodeURIComponent(id)}`, { fresh: true });
    const ok = await page.waitFor(`!document.querySelector('#modal').hidden`, 6000);
    const st = await page.state();
    assert(ok, '深链未自动打开弹窗');
    assert(st.modal.title.length > 0, '弹窗标题为空');
    return { detail: `#/items/${id} → 弹窗「${st.modal.title}」` };
  });

  await step(A, 'I9', '弹窗内「拥有/收藏」独立于配装', async () => {
    const before = await page.state();
    const hasOwned = await page.ev(`[...document.querySelectorAll('#modal button')].some((x) => /未拥有|已拥有/.test(x.textContent || ''))`);
    assert(hasOwned, '弹窗内找不到拥有按钮');
    await page.click(`[...document.querySelectorAll('#modal button')].find((x) => /未拥有|已拥有/.test(x.textContent || ''))`, { label: '拥有' });
    await sleep(320);
    const hasFav = await page.ev(`[...document.querySelectorAll('#modal button')].some((x) => /收藏/.test(x.textContent || ''))`);
    if (hasFav) {
      await page.click(`[...document.querySelectorAll('#modal button')].find((x) => /收藏/.test(x.textContent || ''))`, { label: '收藏' });
      await sleep(320);
    }
    const after = await page.state();
    assert(JSON.stringify(after.owned) !== JSON.stringify(before.owned), 'owned 未变化');
    assert(JSON.stringify(before.build) === JSON.stringify(after.build), '配装被拥有/收藏切换影响');
    assert(String(after.statOwned) === String(after.owned.length), '顶栏已拥有计数不一致');
    return { detail: `owned ${before.owned.length}→${after.owned.length}；build 未变` };
  });

  await step(A, 'I10', '弹窗「装备」写槽；再点同一件不重复', async () => {
    await page.ensureClean();
    await page.goto('#/items?cat=ring', { fresh: true });
    await page.waitCount('#view-root .card', 1);
    await page.click(`document.querySelector('#view-root .card')`, { label: '首枚戒指卡' });
    await page.waitFor(`!document.querySelector('#modal').hidden`, 6000);
    const itemId = await page.ev(`(() => { const h = location.hash; const i = h.indexOf('/items/');
      return i >= 0 ? decodeURIComponent(h.slice(i + 7)) : ''; })()`);
    assert(itemId, '未取得详情 item id');
    await page.click(`[...document.querySelectorAll('#modal button')].find((x) => x.textContent.trim() === '装备')`, { label: '装备' });
    await sleep(400);
    const b1 = (await page.state()).build;
    const slots1 = Object.keys(b1.slots || {}).filter((k) => b1.slots[k] === itemId);
    assert(slots1.length === 1, `首次装备后占 ${slots1.length} 槽`);
    const label2 = await page.ev(`(() => { const b = [...document.querySelectorAll('#modal button')]
      .find((x) => /装备/.test(x.textContent.trim())); return b ? b.textContent.trim() : ''; })()`);
    assert(/已装备/.test(label2), `装备后按钮未变「已装备」（${label2}）`);
    await page.click(`[...document.querySelectorAll('#modal button')].find((x) => /装备/.test(x.textContent.trim()))`, { label: '已装备（第二次）' });
    await sleep(400);
    const b2 = (await page.state()).build;
    const slots2 = Object.keys(b2.slots || {}).filter((k) => b2.slots[k] === itemId);
    assert(slots2.length === 1, `二次点击后占 ${slots2.length} 槽（${slots2.join(',')}）`);
    await page.key('Escape');
    return { detail: `槽 ${slots1.join(',')}；按钮「${label2}」；未重复` };
  });

  await step(A, 'I11', '「加入特性」：重复 info、第 11 个 warn', async () => {
    await page.ensureClean();
    await page.goto('#/items?cat=trait', { fresh: true });
    await page.waitCount('#view-root .card', 1);
    await page.click(`document.querySelector('#view-root .card')`, { label: '首个特性卡' });
    await page.waitFor(`!document.querySelector('#modal').hidden`, 6000);
    const itemId = await page.ev(`(() => { const h = location.hash; const i = h.indexOf('/items/');
      return i >= 0 ? decodeURIComponent(h.slice(i + 7)) : ''; })()`);
    const hasAdd = await page.ev(`[...document.querySelectorAll('#modal button')].some((x) => /加入特性/.test(x.textContent || ''))`);
    assert(hasAdd, '弹窗内没有加入特性按钮');
    await page.ev(`(async () => { const { store } = await import('${PFX}/js/core/store.js'); store.build.setTraits([]); return 0; })()`, { awaitPromise: true });
    await page.click(`[...document.querySelectorAll('#modal button')].find((x) => /加入特性/.test(x.textContent || ''))`, { label: '加入特性' });
    await sleep(350);
    const n1 = await page.ev(`(async () => { const { store } = await import('${PFX}/js/core/store.js'); return store.build.traits().length; })()`, { awaitPromise: true });
    assert(n1 === 1, `首次加入后特性数 ${n1} ≠ 1`);
    await page.click(`[...document.querySelectorAll('#modal button')].find((x) => /加入特性/.test(x.textContent || ''))`, { label: '加入特性（重复）' });
    await sleep(350);
    const toastInfo = await page.ev(`(document.querySelector('#toasts') || {}).textContent || ''`);
    assert(/已在配装中/.test(toastInfo), `重复加入无 info 提示：${toastInfo.slice(0, 60)}`);
    const seeded = await page.ev(`(async () => { const { store } = await import('${PFX}/js/core/store.js');
      const { api } = await import('${PFX}/js/core/api.js');
      const ids = api.itemsSync().filter((i) => i.family === 'trait' && i.id !== ${JSON.stringify(itemId)}).slice(0, 10).map((i) => i.id);
      store.build.setTraits(ids); return store.build.traits().length; })()`, { awaitPromise: true });
    assert(seeded === 10, `灌满特性失败（${seeded}）`);
    await page.click(`[...document.querySelectorAll('#modal button')].find((x) => /加入特性/.test(x.textContent || ''))`, { label: '第 11 个特性' });
    await sleep(350);
    const toastWarn = await page.ev(`(document.querySelector('#toasts') || {}).textContent || ''`);
    const after = await page.ev(`(async () => { const { store } = await import('${PFX}/js/core/store.js'); return store.build.traits().length; })()`, { awaitPromise: true });
    assert(/已满|10/.test(toastWarn), `第 11 个无 warn：${toastWarn.slice(0, 60)}`);
    assert(after === 10, `第 11 个后数量 ${after} ≠ 10`);
    await page.key('Escape');
    return { detail: '重复→info；第 11 个→warn；保持 10' };
  });

  await step(A, 'I12', '侧栏无「部位族」；有「效果标签」3 组且中文', async () => {
    await page.ensureClean();
    await page.goto('#/items', { fresh: true });
    await page.waitCount('.lib-filters', 1);
    await page.waitFor(`document.querySelectorAll('.lib-filters .lib-taggroup .chip').length > 0`, 10000);
    const info = await page.ev(`(() => {
      const side = document.querySelector('.lib-filters');
      const t = (side.textContent || '').replace(/\s+/g, ' ');
      const groups = [...side.querySelectorAll('.lib-taggroup')];
      const chips = [...side.querySelectorAll('.lib-taggroup .chip')];
      return { hasBuwei: /部位族/.test(t), groupCount: groups.length,
        groupTitles: groups.map((g) => (g.querySelector('.lib-taggroup__t') || {}).textContent?.trim()),
        chipCount: chips.length,
        chips: chips.slice(0, 6).map((c) => c.textContent.replace(/\s+/g, ' ').trim().slice(0, 16)),
        tips: chips.filter((c) => c.getAttribute('data-tip')).length }; })()`);
    assert(!info.hasBuwei, '侧栏仍出现「部位族」');
    assert(info.chipCount >= 10, `效果标签 chip 仅 ${info.chipCount} 个`);
    assert(info.groupCount === 3, `标签分组 ${info.groupCount} 组（应为 3）`);
    assert(info.chips.every((t) => CJK.test(t)), `标签非中文：${JSON.stringify(info.chips)}`);
    assert(info.tips >= info.chipCount * 0.8, `data-tip 覆盖不足（${info.tips}/${info.chipCount}）`);
    return { detail: `${info.groupCount} 组「${info.groupTitles.join(' / ')}」，${info.chipCount} 标签（${info.tips} tooltip）` };
  });

  await step(A, 'I13', '点击效果标签 chip → 结果数变化且写入 URL', async () => {
    const before = await page.ev(`(() => ({ hash: location.hash,
      count: (document.querySelector('.lib-count__v') || {}).textContent }))()`);
    await page.click(`document.querySelector('.lib-filters .lib-taggroup .chip')`, { label: '首个效果标签' });
    await sleep(800);
    const after = await page.ev(`(() => ({ hash: location.hash,
      count: (document.querySelector('.lib-count__v') || {}).textContent }))()`);
    assert(after.count !== before.count, `点击标签后结果数未变（${before.count} → ${after.count}）`);
    assert(/[?&]tag=/.test(after.hash), `URL 未写 tag 参数：${after.hash}`);
    return { detail: `结果 ${before.count} → ${after.count}；hash=${after.hash}` };
  });

  await step(A, 'I14', '武器排序 damage：首项数值 > 次项，前 10 非递增', async () => {
    await page.goto('#/items?cat=weapon&sort=damage', { fresh: true });
    await page.waitCount('#view-root .card', 10);
    const ids = await page.ev(`[...document.querySelectorAll('#view-root .card')].slice(0, 10).map((c) => c.dataset.id)`);
    const items = await page.apiItems();
    const map = new Map(items.map((i) => [i.id, i]));
    const dmg = ids.map((id) => (map.get(id) || {}).damage);
    assert(dmg.every((d) => typeof d === 'number'), `存在无数值项：${ids.map((id, i) => `${id}:${dmg[i]}`).join(',')}`);
    assert(dmg[0] > dmg[1], `首项 ${dmg[0]} 未严格大于次项 ${dmg[1]}`);
    for (let i = 1; i < dmg.length; i += 1) assert(dmg[i - 1] >= dmg[i], `第 ${i} 项 ${dmg[i - 1]} < ${dmg[i]}（应降序）`);
    return { detail: `damage 前 10：${dmg.join(' > ')}` };
  });

  await step(A, 'I15', '列表视图每行有非空描述（2 行截断）', async () => {
    await page.goto('#/items', { fresh: true });
    await page.waitCount('#view-root .card', 1);
    await page.click(`document.querySelector('[aria-label="列表视图"]')`, { label: '列表视图' });
    await page.waitFor(`document.querySelectorAll('#view-root .lib-row').length >= 5`, 8000);
    const info = await page.ev(`(() => {
      const rows = [...document.querySelectorAll('#view-root .lib-row')].slice(0, 8);
      return { n: document.querySelectorAll('#view-root .lib-row').length,
        rows: rows.map((r) => ({ id: r.dataset.id, name: (r.querySelector('.lib-row__name') || {}).textContent || '',
          desc: (r.querySelector('.lib-row__desc') || {}).textContent?.trim() || '' })),
        hash: location.hash }; })()`);
    assert(info.n >= 5, `列表行数 ${info.n} < 5`);
    const empty = info.rows.filter((r) => !r.desc || r.desc === '—');
    // 允许「官方描述/摘要/效果预览全部缺失」的数据缺口，其余空描述一律算缺陷
    const items = await page.apiItems();
    const map = new Map(items.map((i) => [i.id, i]));
    const dataGap = empty.filter((r) => { const it = map.get(r.id) || {};
      return !it.descZh && !it.summaryZh && !it.effectPreview; });
    const offenders = empty.filter((r) => !dataGap.includes(r));
    assert(offenders.length === 0, `${offenders.length} 行有文本来源却显示空描述：${offenders.map((r) => r.id).join(',')}`);
    assert(info.rows.length - empty.length >= 7, `仅 ${info.rows.length - empty.length}/8 行有描述`);
    return { detail: `hash=${info.hash}；${info.n} 行；${empty.length} 行为数据缺口（${empty.map((r) => r.name).join('/') || '无'}），其余有描述` };
  });

  await step(A, 'I16', '#/items?owned=1 / ?fav=1 真筛选且计数一致', async () => {
    await page.goto('#/items', { fresh: true });
    await page.waitCount('#view-root .card', 3);
    for (const idx of [0, 1]) {
      await page.click(`document.querySelectorAll('#view-root .card')[${idx}]`, { label: `第 ${idx + 1} 张卡` });
      await page.waitFor(`!document.querySelector('#modal').hidden`, 5000);
      const own = await page.ev(`[...document.querySelectorAll('#modal button')].some((x) => /未拥有/.test(x.textContent || ''))`);
      if (own) {
        await page.click(`[...document.querySelectorAll('#modal button')].find((x) => /未拥有/.test(x.textContent || ''))`, { label: '拥有' });
        await sleep(280);
      }
      const fav = await page.ev(`[...document.querySelectorAll('#modal button')].some((x) => /^收藏$/.test(x.textContent.trim()))`);
      if (fav) {
        await page.click(`[...document.querySelectorAll('#modal button')].find((x) => /^收藏$/.test(x.textContent.trim()))`, { label: '收藏' });
        await sleep(280);
      }
      await page.key('Escape');
      await sleep(280);
    }
    const st0 = await page.state();
    await page.goto('#/items?owned=1', { fresh: true });
    await page.waitCount('#view-root .card', 1);
    const ownRes = await page.ev(`(() => ({ ids: [...document.querySelectorAll('#view-root .card')].map((c) => c.dataset.id),
      count: Number((document.querySelector('.lib-count__v') || {}).textContent || -1) }))()`);
    assert(ownRes.ids.every((id) => st0.owned.includes(id)), `?owned=1 含未拥有件`);
    assert(ownRes.ids.length === st0.owned.length && ownRes.count === st0.owned.length,
      `?owned=1 卡片 ${ownRes.ids.length}/计数 ${ownRes.count} ≠ 已拥有 ${st0.owned.length}`);
    if (st0.fav.length) {
      await page.goto('#/items?fav=1', { fresh: true });
      await page.waitCount('#view-root .card', 1);
      const favRes = await page.ev(`(() => ({ ids: [...document.querySelectorAll('#view-root .card')].map((c) => c.dataset.id),
        count: Number((document.querySelector('.lib-count__v') || {}).textContent || -1) }))()`);
      assert(favRes.ids.every((id) => st0.fav.includes(id)), '?fav=1 含未收藏件');
      assert(favRes.ids.length === st0.fav.length && favRes.count === st0.fav.length,
        `?fav=1 卡片 ${favRes.ids.length}/计数 ${favRes.count} ≠ 收藏 ${st0.fav.length}`);
    }
    return { detail: `?owned=1 → ${ownRes.ids.length} 件（计数 ${ownRes.count}）；?fav=1 → ${st0.fav.length} 件` };
  });

  await step(A, 'I17', '按 / 聚焦搜索框', async () => {
    await page.goto('#/items', { fresh: true });
    await page.key('Escape');
    await page.key('/');
    await sleep(350);
    const st = await page.state();
    const isSearch = st.activeTag === 'input' && (st.activeType === 'search' || /搜索/.test(st.activeLabel));
    assert(isSearch, `焦点未落到搜索框（active=${st.activeTag}/${st.activeType}/${st.activeLabel}）`);
    return { detail: `聚焦 ${st.activeTag}[type=${st.activeType}] ${st.activeLabel}` };
  });

  await step(A, 'L6', '列表视图搜索「阿哈内」：行内显示效果原文（含「状态效果」，不是风味段）', async () => {
    await page.goto('#/items?view=list&q=' + encodeURIComponent('阿哈内'), { fresh: true });
    await page.waitFor(`document.querySelectorAll('#view-root .lib-row').length >= 1`, 12000);
    // 搜索结果可能含多行（haystack 命中），等目标行出现并在全部行中定位
    const found = await page.waitFor(`[...document.querySelectorAll('#view-root .lib-row .lib-row__name')]
      .some((x) => /阿哈内/.test(x.textContent || ''))`, 8000);
    const rows = await page.ev(`[...document.querySelectorAll('#view-root .lib-row')].map((r) => ({
      name: ((r.querySelector('.lib-row__name') || {}).textContent || '').trim(),
      desc: ((r.querySelector('.lib-row__desc') || {}).textContent || '').trim(),
      descCls: ((r.querySelector('.lib-row__desc') || {}).className || '') }))`);
    assert(found, `搜索结果 ${rows.length} 行，未找到「阿哈内水晶」行：${rows.slice(0, 5).map((r) => r.name).join('/')}`);
    const pan = rows.find((r) => /阿哈内/.test(r.name));
    assert(/状态效果/.test(pan.desc), `行内描述不含效果原文：${pan.desc.slice(0, 60)}`);
    assert(/lib-row__desc--effect/.test(pan.descCls), `行内未使用 --effect 样式类：${pan.descCls}`);
    assert(!/据说/.test(pan.desc), `行内仍是风味段：${pan.desc.slice(0, 60)}`);
    return { detail: `「${pan.name}」→「${pan.desc.slice(0, 34)}…」（${pan.descCls}）；共 ${rows.length} 行命中` };
  });

}

async function runLab() {
  const A = 'lab';
  await step(A, 'B1', '#/lab 工作台 15 槽（含主/副职业）', async () => {
    await page.ensureClean();
    await page.goto('#/lab', { fresh: true });
    await page.waitCount('.slot', 15);
    const st = await page.state();
    const ids = await page.ev(`[...document.querySelectorAll('.slot')].map((s) => s.dataset.slot)`);
    assert(st.counts.slots === 15, `槽位数 ${st.counts.slots} ≠ 15`);
    assert(ids.includes('archetype1') && ids.includes('archetype2'), `缺职业槽：${ids.join(',')}`);
    return { detail: `15 槽：${ids.join(' / ')}` };
  });

  await step(A, 'B2', '五面板 seg 齐全（推荐/逐槽替换/档位对照/计算器/存档）', async () => {
    const panels = await page.ev(`[...document.querySelectorAll('.lab-panels__head .seg__btn')].map((b) => b.dataset.panel)`);
    const want = ['recommend', 'replace', 'classes', 'calc', 'saved'];
    assert(want.every((p) => panels.includes(p)), `面板缺项：${panels.join(',')}`);
    return { detail: panels.join(' / ') };
  });

  await step(A, 'B3', '空槽 → 选择器 → 点行装备进槽', async () => {
    await page.click(`document.querySelector('.slot--empty[data-slot="longGun"] .slot__pick') || document.querySelector('.slot--empty[data-slot="longGun"]')`, { label: '空槽 longGun' });
    const opened = await page.waitFor(`document.querySelectorAll('#drawer .picker-row').length > 0`, 6000);
    const st1 = await page.state();
    assert(opened, '选择器抽屉未出现');
    assert(/选择/.test(st1.drawer.title), `抽屉标题不是选择器：${st1.drawer.title}`);
    const rowName = await page.ev(`(() => { const r = document.querySelector('#drawer .picker-row .picker-row__name');
      return r ? r.textContent.trim() : ''; })()`);
    await page.click(`document.querySelector('#drawer .picker-row')`, { label: '选择器首行' });
    await sleep(700);
    const st = await page.state();
    assert(!st.drawer.open, '选择后抽屉未关闭');
    assert(st.build.slots.longGun, 'store.build.slots.longGun 未写入');
    await capture('interact-lab-picker');
    return { detail: `装备「${rowName}」→ longGun 写入` };
  });

  await step(A, 'B4', '选择器「详情」ⓘ → 桌面弹窗打开且不装备', async () => {
    await page.ensureClean();
    const before = (await page.state()).build;
    await page.click(`document.querySelector('.slot--empty[data-slot="handGun"] .slot__pick') || document.querySelector('.slot--empty[data-slot="handGun"]')`, { label: '空槽 handGun' });
    const opened = await page.waitFor(`document.querySelectorAll('#drawer .picker-row').length > 0`, 6000);
    assert(opened, '选择器未打开');
    await page.click(`document.querySelector('#drawer .picker-row__acts .iconbtn')`, { label: '行内详情 ⓘ' });
    const modalOpen = await page.waitFor(`!document.querySelector('#modal').hidden`, 5000);
    const after = await page.state();
    assert(modalOpen, '桌面端点详情未打开 #modal');
    assert(JSON.stringify(before) === JSON.stringify(after.build), '点详情不应装备');
    await page.key('Escape');
    await sleep(400);
    return { detail: `modal「${after.modal.title}」；build 未变` };
  });

  await step(A, 'B5', '× 移除 → 槽清空但 owned 不变 + Toast', async () => {
    await page.ensureClean();
    await page.goto('#/lab', { fresh: true });
    await page.waitCount('.slot:not(.slot--empty)', 1);
    const before = await page.state();
    await page.click(`document.querySelector('.slot:not(.slot--empty) .slot__acts .iconbtn--danger')
      || document.querySelector('.slot:not(.slot--empty) .iconbtn--danger')`, { label: '移除 ×' });
    await page.waitFor(`(() => { const t = document.querySelector('#toasts'); return t && /已移除/.test(t.textContent || ''); })()`, 3000);
    const after = await page.state();
    assert(JSON.stringify(before.owned) === JSON.stringify(after.owned), 'owned 被移除操作改变');
    assert(after.counts.slots === 15, `槽位总数被改变：${after.counts.slots}`);
    return { detail: `已移除；owned ${after.owned.length} 未变` };
  });

  await step(A, 'B6', '清空当前配装 → 确认框（取消不改动）', async () => {
    await page.ensureClean();
    await page.goto('#/lab?panel=saved', { fresh: true });
    const hasBtn = await page.waitFor(`[...document.querySelectorAll('#view-root button')].some((b) => /清空当前配装/.test(b.textContent))`, 12000);
    assert(hasBtn, '存档面板找不到「清空当前配装」按钮');
    await page.click(`[...document.querySelectorAll('#view-root button')].find((b) => /清空当前配装/.test(b.textContent))`, { label: '清空当前配装' });
    const ok = await page.waitFor(`!document.querySelector('#modal').hidden`, 4000);
    const st = await page.state();
    assert(ok, '点「清空当前配装」未出现确认框');
    const body = await page.text('#modal .modal__body');
    assert(/清空|移除/.test(st.modal.title + body), `确认框文案未说明后果：${st.modal.title} / ${body.slice(0, 60)}`);
    const before = (await page.state()).build;
    const hasCancel = await page.ev(`[...document.querySelectorAll('#modal button')].some((b) => /取消/.test(b.textContent))`);
    if (hasCancel) {
      await page.click(`[...document.querySelectorAll('#modal button')].find((b) => /取消/.test(b.textContent))`, { label: '取消' });
      await sleep(400);
    } else {
      await page.key('Escape');
    }
    const after = (await page.state()).build;
    assert(JSON.stringify(before) === JSON.stringify(after), '取消后配装被改动');
    return { detail: `确认框「${st.modal.title}」；取消后未改动` };
  });

  await step(A, 'B7', '职业槽：点主职业 → 职业选择器（≥14）→ 选中写入槽位', async () => {
    await page.ensureClean();
    await page.goto('#/lab', { fresh: true });
    await page.waitCount('.slot', 15);
    await page.click(`document.querySelector('.slot--empty[data-slot="archetype1"] .slot__pick') || document.querySelector('.slot--empty[data-slot="archetype1"]')`, { label: '主职业空槽' });
    const opened = await page.waitFor(`document.querySelectorAll('#drawer .lab-archrow').length >= 10`, 6000);
    const n = await page.count('#drawer .lab-archrow');
    assert(opened, `职业选择器未出现（行数 ${n}）`);
    assert(n >= 14, `职业可选 ${n} 条 < 14`);
    const firstName = await page.ev(`(() => { const r = document.querySelector('#drawer .lab-archrow .lab-archrow__name');
      return r ? r.textContent.trim() : ''; })()`);
    await page.click(`document.querySelector('#drawer .lab-archrow')`, { label: '第一个职业' });
    await sleep(800);
    const st = await page.state();
    const archTxt = await page.text('.slot[data-slot="archetype1"]');
    assert(st.build.slots.archetype1, 'store.build.slots.archetype1 未写入');
    assert(!/点击选择职业/.test(archTxt), `主职业槽未更新：${archTxt}`);
    await capture('interact-lab-archetype');
    return { detail: `可选 ${n} 个职业；选中「${firstName || archTxt.slice(0, 12)}」` };
  });

  await step(A, 'B8', '特性 stepper：+1 后等级/已用徽章/护甲值变化', async () => {
    await page.ensureClean();
    // 前置：直接写 store 放满四件护甲（v2 结果面板在空槽时只显示「—」）
    await page.ev(`(async () => { const { store } = await import('${PFX}/js/core/store.js');
      store.build.setTraits([]);
      [['head','Armor_Head_Leto1'],['body','Armor_Body_Leto1'],['legs','Armor_Legs_Leto1'],['gloves','Armor_Gloves_Leto1']]
        .forEach(([s, id]) => store.build.set(s, id)); return 1; })()`, { awaitPromise: true });
    await page.goto('#/lab', { fresh: true });
    await page.waitFor(`document.querySelectorAll('.lab-statgrid .statbox .statbox__v').length >= 4`, 15000);
    await page.waitFor(`document.querySelectorAll('.lab-trait').length >= 15`, 12000);
    await sleep(500);
    const readArmor = async () => page.ev(`(() => {
      const boxes = [...document.querySelectorAll('.lab-statgrid .statbox')];
      for (const b of boxes) {
        const k = (b.querySelector('.statbox__k') || {}).textContent || '';
        if (k.indexOf('护甲值') >= 0) {
          const v = (b.querySelector('.statbox__v') || {}).textContent || '';
          const n = parseFloat(String(v).replace(/[^0-9.]/g, ''));
          return Number.isFinite(n) ? n : null;
        }
      }
      return null; })()`);
    const armor0 = await readArmor();
    assert(armor0 != null, '读不到结果面板「护甲值」（.lab-statgrid .statbox）');
    await page.click(`[...document.querySelectorAll('.lab-stepper button')].find((b) => /坚韧 加一级/.test(b.getAttribute('aria-label') || ''))`, { label: '坚韧 +1' });
    await sleep(900);
    const info = await page.ev(`(() => ({ v: (document.querySelector('.lab-trait .lab-stepper__v') || {}).textContent,
      used: (document.querySelector('.lab-traits__count .badge') || {}).textContent,
      rows: document.querySelectorAll('.lab-trait').length }))()`);
    assert(info.v === '1', `stepper 值 ${info.v} ≠ 1`);
    assert(/1\/10/.test(info.used), `已用特性徽章 ${info.used} 未更新`);
    assert(info.rows === 15, `特性行 ${info.rows} ≠ 15`);
    const armor1 = await readArmor();
    assert(armor1 != null && armor0 !== armor1, `护甲值未随特性变化（${armor0} → ${armor1}）`);
    await capture('interact-lab-traits');
    return { detail: `15 行；坚韧 0→1（${info.used}）；护甲值 ${armor0} → ${armor1}` };
  });

  await step(A, 'B9', '结果面板分防御/生存/机动，生存含「有效生命 EHP」', async () => {
    const segs = await page.ev(`[...document.querySelectorAll('.lab-wb__side .seg__btn, .lab-wb__side button')]
      .map((b) => b.textContent.trim()).filter(Boolean)`);
    assert(segs.includes('防御') && segs.includes('生存') && segs.includes('机动'), `结果分组缺项：${JSON.stringify(segs)}`);
    await page.click(`[...document.querySelectorAll('.lab-wb__side button')].find((b) => b.textContent.trim() === '生存')`, { label: '生存分组' });
    await sleep(500);
    const info = await page.ev(`(() => { const side = document.querySelector('.lab-wb__side');
      const t = (side ? side.textContent : '').replace(/\s+/g, ' '); return { hasEhp: /有效生命|EHP/.test(t), txt: t.slice(0, 220) }; })()`);
    assert(info.hasEhp, `生存分组未见「有效生命/EHP」：${info.txt.slice(0, 160)}`);
    await capture('interact-lab-result');
    return { detail: `分组 ${segs.join('/')}；生存含有效生命` };
  });

  await step(A, 'B10', '推荐面板：排序 select 切换后行顺序变化', async () => {
    await page.ensureClean();
    await page.goto('#/lab?panel=recommend', { fresh: true });
    await page.waitFor(`document.querySelectorAll('.lab-rec__row').length > 0`, 25000);
    const rowsA = await page.ev(`[...document.querySelectorAll('.lab-rec__row')].slice(0, 3).map((r) => r.textContent.replace(/\s+/g, ' ').trim().slice(0, 50))`);
    const hasSort = await page.ev(`!!document.querySelector('select[aria-label="推荐排序"]')`);
    assert(hasSort, '推荐面板缺少排序 select');
    await page.ev(`(() => { const s = document.querySelector('select[aria-label="推荐排序"]');
      s.value = 'weight'; s.dispatchEvent(new Event('change', { bubbles: true })); return s.value; })()`);
    const changed = await page.waitFor(`(() => { const rows = [...document.querySelectorAll('.lab-rec__row')].slice(0, 3);
      return rows.length > 0 && rows[0].textContent.replace(/\s+/g, ' ').trim().slice(0, 50) !== ${JSON.stringify(rowsA[0] || '')}; })()`, 8000);
    const rowsB = await page.ev(`[...document.querySelectorAll('.lab-rec__row')].slice(0, 3).map((r) => r.textContent.replace(/\s+/g, ' ').trim().slice(0, 50))`);
    assert(changed, `切换排序后行顺序未变：${JSON.stringify(rowsA.slice(0, 2))}`);
    return { detail: `score→weight：#1「${rowsA[0] || ''}」→「${rowsB[0] || ''}」` };
  });

  await step(A, 'B11', '推荐面板：切换场景后重算（结果行变化）', async () => {
    const rowsA = await page.ev(`[...document.querySelectorAll('.lab-rec__row')].slice(0, 2).map((r) => r.textContent.replace(/\s+/g, ' ').trim().slice(0, 60))`);
    const changed = await page.ev(`(() => {
      const sel = [...document.querySelectorAll('select')].find((s) => /场景/.test(s.getAttribute('aria-label') || ''));
      if (!sel) return false;
      const opt = [...sel.options].find((o) => o.value && o.value !== sel.value);
      if (!opt) return false;
      sel.value = opt.value; sel.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
    assert(changed, '找不到场景 select 或无可切换项');
    const got = await page.waitFor(`(() => { const rows = [...document.querySelectorAll('.lab-rec__row')].slice(0, 2);
      return rows.length > 0 && rows[0].textContent.replace(/\s+/g, ' ').trim().slice(0, 60) !== ${JSON.stringify(rowsA[0] || '')}; })()`, 15000);
    const rowsB = await page.ev(`[...document.querySelectorAll('.lab-rec__row')].slice(0, 2).map((r) => r.textContent.replace(/\s+/g, ' ').trim().slice(0, 60))`);
    assert(got, `切换场景后推荐未重算：${JSON.stringify(rowsA)} → ${JSON.stringify(rowsB)}`);
    return { detail: `#1「${rowsA[0] || ''}」→「${rowsB[0] || ''}」` };
  });

  for (const [pid, zh, sel, ID] of [
    ['replace', '逐槽替换', '.lab-panel[data-panel="replace"]', 'B12'],
    ['classes', '档位对照', '.lab-panel[data-panel="classes"]', 'B13'],
    ['calc', '计算器', '.lab-panel[data-panel="calc"]', 'B14'],
    ['saved', '存档导出', '.lab-panel[data-panel="saved"]', 'B15'],
  ]) {
    await step(A, ID, `面板 ${pid}（${zh}）深链可见且有内容`, async () => {
      await page.ensureClean();
      await page.goto(`#/lab?panel=${pid}`, { fresh: true });
      const ok = await page.waitFor(`!!document.querySelector('${sel}') && !document.querySelector('${sel}').hidden`, 12000);
      assert(ok, `面板 ${pid} 未显示`);
      const txt = await page.text(sel);
      assert(txt.length > 20, `面板 ${pid} 内容过少：${txt.slice(0, 60)}`);
      if (pid === 'classes') {
        const tables = await page.count(`${sel} table`);
        assert(tables >= 1, `档位对照无表格（tables=${tables}）`);
      }
      return { detail: `${zh}：${txt.slice(0, 70)}` };
    });
  }

  await step(A, 'B16', '旧路由重定向：builds→recommend / matrix→classes / calc→calc', async () => {
    const map = [['#/lab/builds', 'panel=recommend'], ['#/lab/matrix', 'panel=classes'], ['#/lab/calc', 'panel=calc']];
    const out = [];
    for (const [old, want] of map) {
      await page.goto(old, { fresh: true });
      const ok = await page.waitFor(`location.hash.indexOf(${JSON.stringify(want)}) >= 0`, 8000);
      const hash = await page.ev('location.hash');
      out.push(`${old} → ${hash}`);
      assert(ok, `${old} 未重定向到 ${want}（当前 ${hash}）`);
    }
    return { detail: out.join('；') };
  });

  await step(A, 'B17', '缺件重算 → 推荐面板出 10 行 + 摘要（可用池/已排除/穷举）+ 写入四件跳过缺件', async () => {
    await page.ensureClean();
    await page.goto('#/lab?panel=replace', { fresh: true });
    await page.waitFor(`!!document.querySelector('.lab-panel[data-panel="replace"]:not([hidden])')`, 12000);
    const seeded = await page.ev(`(async () => { const S = await import('${PFX}/js/lab/state.js');
      S.clearMissing();
      if (!S.isMissing('Armor_Head_Leto1')) S.toggleMissing('Armor_Head_Leto1');
      if (!S.isMissing('Armor_Body_Leto2')) S.toggleMissing('Armor_Body_Leto2');
      return S.missingIds(); })()`, { awaitPromise: true });
    assert(Array.isArray(seeded) && seeded.length === 2, `缺件标记失败：${JSON.stringify(seeded)}`);
    await sleep(400);
    const beforeOwned = (await page.state()).owned;
    await page.click(`[...document.querySelectorAll('.lab-panel[data-panel="replace"] button')].find((b) => /按缺件重算最优/.test(b.textContent))`, { label: '按缺件重算最优' });
    const gotRows = await page.waitFor(`document.querySelectorAll('.lab-rec__row').length >= 10`, 30000);
    const panelTxt = await page.text('.lab-panel[data-panel="recommend"]');
    assert(gotRows, `重算后推荐面板行数 ${await page.count('.lab-rec__row')}（应 10/页）`);
    assert(/可用池\s*\d+\s*件/.test(panelTxt), `摘要缺「可用池 N 件」：${panelTxt.slice(0, 160)}`);
    assert(/已排除\s*\d+\s*件/.test(panelTxt), `摘要缺「已排除 N 件」：${panelTxt.slice(0, 160)}`);
    assert(/穷举\s*[\d,]+\s*\/\s*[\d,]+\s*组合/.test(panelTxt), `摘要缺「穷举 … 组合」：${panelTxt.slice(0, 160)}`);
    const firstRow = await page.text('.lab-rec__row');
    assert(!/莱托 1 型头盔/.test(firstRow), `首行仍含缺件「莱托 1 型头盔」：${firstRow.slice(0, 120)}`);
    assert(!/莱托 2 型护甲/.test(firstRow), `首行仍含缺件「莱托 2 型护甲」：${firstRow.slice(0, 120)}`);
    await page.click(`[...document.querySelectorAll('.lab-rec__row button')].find((b) => /写入四件/.test(b.textContent))`, { label: '写入四件' });
    await sleep(700);
    const after = await page.ev(`(async () => { const { store } = await import('${PFX}/js/core/store.js');
      return { slots: store.build.slots(), owned: [...store.state.owned] }; })()`, { awaitPromise: true });
    const armor = ['head', 'body', 'legs', 'gloves'].map((x) => after.slots[x]);
    assert(armor.every(Boolean), `写入四件后仍有空槽：${JSON.stringify(armor)}`);
    assert(after.slots.head !== 'Armor_Head_Leto1', 'head 写入的是缺件 Armor_Head_Leto1');
    assert(after.slots.body !== 'Armor_Body_Leto2', 'body 写入的是缺件 Armor_Body_Leto2');
    assert(JSON.stringify(after.owned) === JSON.stringify(beforeOwned), '写入四件改动了 owned');
    await capture('interact-lab-recalc');
    return { detail: `推荐面板 ${await page.count('.lab-rec__row')} 行；摘要含可用池/已排除/穷举；写入 ${armor.join(' / ')}（跳过缺件）` };
  });

  await step(A, 'B18', '选择器筛选：标签多选 + 按槽位动态排序，点行仍装备', async () => {
    await page.ensureClean();
    await page.ev(`(async () => { const { store } = await import('${PFX}/js/core/store.js'); store.build.clear(); return 0; })()`, { awaitPromise: true });
    await page.goto('#/lab', { fresh: true });
    // 饰品槽：标签候选最多（23 个 GAME_TAGS）
    await page.waitFor(`!!document.querySelector('.slot--empty[data-slot="amulet"]')`, 12000);
    await page.click(`document.querySelector('.slot--empty[data-slot="amulet"] .slot__pick') || document.querySelector('.slot--empty[data-slot="amulet"]')`, { label: '项链空槽' });
    await page.waitFor(`document.querySelectorAll('#drawer .picker-row').length > 0`, 8000);
    const info = await page.ev(`(() => { const d = document.querySelector('#drawer');
      const sort = d.querySelector('select[aria-label="排序方式"]');
      return { sortExists: !!sort, sortOpts: sort ? [...sort.options].map((o) => o.value) : [],
        tags: d.querySelectorAll('.picker-tagchip').length,
        switches: d.querySelectorAll('label.switch').length,
        rows: d.querySelectorAll('.picker-row').length }; })()`);
    assert(info.sortExists, '选择器缺少排序 select[aria-label="排序方式"]');
    assert(info.sortOpts.length >= 1, `排序项 ${info.sortOpts.length} < 1`);
    assert(info.tags >= 5, `选择器标签 chip ${info.tags} < 5`);
    assert(info.switches >= 2, `选择器开关 ${info.switches} < 2`);
    const tagLabel = await page.ev(`(() => { const t = document.querySelector('#drawer .picker-tagchip');
      if (!t) return ''; const s2 = t.textContent.trim(); t.click(); return s2; })()`);
    await sleep(700);
    const rowCountAfterTag = await page.count('#drawer .picker-row');
    assert(rowCountAfterTag > 0 && rowCountAfterTag <= info.rows, `标签筛选后行数异常 ${rowCountAfterTag}/${info.rows}`);
    await page.click(`document.querySelector('#drawer .picker-row')`, { label: '筛选后首行' });
    await sleep(700);
    const st = await page.state();
    assert(!st.drawer.open, '点行后抽屉未关闭');
    assert(st.build.slots.amulet, '筛选后点行未装备到 amulet');
    // 护甲槽：排序项应含「护甲值 / 负重」（按槽位动态）
    await page.waitFor(`!!document.querySelector('.slot--empty[data-slot="head"]')`, 8000);
    await page.click(`document.querySelector('.slot--empty[data-slot="head"] .slot__pick') || document.querySelector('.slot--empty[data-slot="head"]')`, { label: '头盔空槽' });
    await page.waitFor(`document.querySelectorAll('#drawer .picker-row').length > 0`, 8000);
    const armorSort = await page.ev(`(() => { const s2 = document.querySelector('#drawer select[aria-label="排序方式"]');
      return s2 ? [...s2.options].map((o) => o.value) : []; })()`);
    assert(armorSort.includes('armor') && armorSort.includes('weight'), `护甲槽排序项缺护甲值/负重：${JSON.stringify(armorSort)}`);
    await page.key('Escape');
    await sleep(400);
    return { detail: `饰品标签 ${info.tags} 个（排序 ${info.sortOpts.join('/')}），标签「${tagLabel}」→ ${rowCountAfterTag} 行；护甲槽排序 ${armorSort.join('/')}；已装备 amulet` };
  });
}

/* ============================== 知识库 ============================== */
let secondHref = '';
/** 流派详情首条深链（由 builds 组写入，供全站/移动端复用） */
let firstBuildHref = '';
async function runCodex() {
  const A = 'codex';
  await step(A, 'C1', '#/codex 分类目录可直达', async () => {
    await page.goto('#/codex', { fresh: true });
    await page.waitCount('.codex-toc__item', 1);
    const st = await page.state();
    const idx = await page.count('.codex-idxrow');
    assert(st.counts.h1 === 1, `h1 数量 ${st.counts.h1}（应 1）`);
    assert(idx > 0, '条目列表为空');
    return { detail: `目录 ${await page.count('.codex-toc__item')} 项 / 条目卡 ${idx}` };
  });

  await step(A, 'C2', '#/codex/<id> 深链直达（标题/文档标题同步、单 h1）', async () => {
    const hrefs = await page.ev(`[...document.querySelectorAll('.codex-toc__item')].map((a) => a.getAttribute('href'))`);
    assert(hrefs && hrefs.length > 1, '目录项不足');
    secondHref = hrefs[1];
    const expectTitle = await page.ev(`[...document.querySelectorAll('.codex-toc__item')][1].textContent.trim()`);
    await page.goto(secondHref, { fresh: true });
    const st = await page.state();
    const h1 = await page.ev(`(() => document.querySelectorAll('h1').length)()`);
    const title = await page.text('h1.codex-title');
    assert(h1 === 1, `h1 数量 ${h1}（应 1）`);
    assert(title && (title.includes(expectTitle) || expectTitle.includes(title)), `正文标题「${title}」≠ 目录「${expectTitle}」`);
    assert(st.title.includes(title), `document.title 未同步：${st.title}`);
    return { detail: `${secondHref} → h1「${title}」` };
  });

  await step(A, 'C3', '目录点击 → 切换条目', async () => {
    await page.goto('#/codex', { fresh: true });
    const before = await page.ev(`(() => ({ hash: location.hash, title: (document.querySelector('h1.codex-title') || {}).textContent || '' }))()`);
    const idx = await page.ev(`(() => { const items = [...document.querySelectorAll('.codex-toc__item')];
      return items.findIndex((a) => !a.classList.contains('is-on') && a.getAttribute('href') !== location.hash); })()`);
    assert(idx >= 0, '无可切换目录项');
    await page.click(`document.querySelectorAll('.codex-toc__item')[${idx}]`, { label: '目录项' });
    await sleep(600);
    const after = await page.ev(`(() => ({ hash: location.hash, title: (document.querySelector('h1.codex-title') || {}).textContent || '' }))()`);
    assert(after.hash !== before.hash, 'hash 未变化');
    assert(after.title !== before.title, '正文标题未变化');
    return { detail: `${before.hash} → ${after.hash}` };
  });

  await step(A, 'C4', '公式块 .formula 存在且可识别', async () => {
    const href = await page.ev(`(() => { const a = [...document.querySelectorAll('.codex-toc__item')].find((x) => /护甲/.test(x.textContent));
      return a ? a.getAttribute('href') : ''; })()`);
    assert(href, '目录里找不到「护甲」条目');
    await page.goto(href, { fresh: true });
    const n = await page.count('.formula');
    assert(n > 0, '无 .formula 公式块');
    return { detail: `${n} 个公式块，例：${(await page.text('.formula')).slice(0, 50)}` };
  });
}

/* ============================== 流派 ============================== */
/** 详情页必须出现的分区（与 js/views/builds.js 的 panel 标题对应） */
const DETAIL_PANELS = [
  '伤害链条', '武器', '护甲', '饰品', '职业与天赋', '装配说明',
  '输出循环', '替换方案', '清群诊断', '难点与注意事项', '饰品乘区', '口径与证据',
];
async function runBuilds() {
  const A = 'builds';

  await step(A, 'P1', '#/builds 列表：7 套卡片 + 按目标选 + 横向对比表 + 单 h1', async () => {
    await page.goto('#/builds', { fresh: true });
    await page.waitCount('#view-root .bcard', 7);
    const cards = await page.count('#view-root .bcard');
    const st = await page.state();
    assert(cards === 7, `流派卡片 ${cards} 张（应 7）`);
    assert(st.counts.h1 === 1, `h1 数量 ${st.counts.h1}（应 1）`);
    const goals = await page.count('#view-root .bgoal');
    assert(goals >= 4, `按目标选卡片 ${goals} 张（应 ≥4）`);
    const rows = await page.count('#view-root .btbl tbody tr');
    assert(rows === 7, `横向对比表行 ${rows}（应 7）`);
    const names = await page.ev(`[...document.querySelectorAll('#view-root .bcard__name')].map((e) => e.textContent.trim())`);
    assert(names.length === 7 && names.every(Boolean), `流派名缺失：${JSON.stringify(names)}`);
    assert(new Set(names).size === 7, `流派名重复：${JSON.stringify(names)}`);
    firstBuildHref = await page.ev(`document.querySelector('#view-root .bcard').getAttribute('href')`);
    return { detail: `${cards} 套 / 目标卡 ${goals} / 对比表 ${rows} 行：${names.join('、')}` };
  });

  await step(A, 'P2', '点卡片进详情：分区齐全、单 h1、面包屑可回', async () => {
    await page.goto('#/builds', { fresh: true });
    await page.waitCount('#view-root .bcard', 7);
    const firstName = await page.text('#view-root .bcard__name');
    await page.click(`document.querySelector('#view-root .bcard')`, { label: `卡片 ${firstName}` });
    await page.waitFor(`!!document.querySelector('.bhero__name')`, 8000);
    const st = await page.state();
    assert(/^#\/builds\/.+/.test(st.hash), `点卡片后 hash=${st.hash}`);
    assert(st.counts.h1 === 1, `详情页 h1 数量 ${st.counts.h1}（应 1）`);
    const heroName = await page.text('.bhero__name');
    assert(heroName === firstName, `详情标题「${heroName}」≠ 卡片「${firstName}」`);
    const panels = await page.ev(`[...document.querySelectorAll('#view-root .panel__title')].map((e) => e.textContent.trim())`);
    const missing = DETAIL_PANELS.filter((t) => !panels.some((p) => p.includes(t)));
    assert(missing.length === 0, `详情缺失分区：${missing.join('、')}（实际 ${panels.join('/')}）`);
    const chips = await page.count('#view-root button.bchip');
    assert(chips >= 10, `可点击道具 chip ${chips} 个（应 ≥10）`);
    await page.click(`document.querySelector('.bcrumb__a')`, { label: '面包屑返回' });
    await page.waitFor(`location.hash === '#/builds'`, 6000);
    return { detail: `「${heroName}」${panels.length} 个分区 / ${chips} 个可点道具；面包屑可回列表` };
  });

  await step(A, 'P3', '7 套详情全部可开且内容非空（深链直达）', async () => {
    await page.goto('#/builds', { fresh: true });
    await page.waitCount('#view-root .bcard', 7);
    const links = await page.ev(`[...document.querySelectorAll('#view-root .bcard')].map((a) => a.getAttribute('href'))`);
    assert(links.length === 7, `列表链接 ${links.length} 条（应 7）`);
    const out = [];
    for (const href of links) {
      await page.goto(href, { fresh: false });
      await page.waitFor(`!!document.querySelector('.bhero__name')`, 9000);
      const t = await page.ev(`(() => { const r = document.querySelector('#view-root');
        const h = document.querySelector('.bhero__name');
        return { name: h ? h.textContent.trim() : '', len: (r ? r.textContent : '').replace(/\\s+/g, '').length,
          chips: document.querySelectorAll('#view-root button.bchip').length }; })()`);
      assert(t.name, `${href} 没有标题`);
      assert(t.len > 800, `${href} 正文只有 ${t.len} 字`);
      assert(t.chips >= 8, `${href} 可点道具 ${t.chips} < 8`);
      out.push(`${t.name}(${t.len}字/${t.chips})`);
    }
    return { detail: out.join('、') };
  });

  await step(A, 'P4', '详情里点真实道具 → 打开全站统一详情弹窗（桌面）', async () => {
    await page.goto('#/builds', { fresh: true });
    await page.waitFor(`!!document.querySelector('.bcard')`, 9000);
    const href = await page.ev(`document.querySelector('#view-root .bcard').getAttribute('href')`);
    await page.goto(href);
    await page.waitFor(`document.querySelectorAll('#view-root button.bchip').length > 0`, 9000);
    await page.click(`document.querySelector('#view-root button.bchip')`, { label: '第一个道具 chip' });
    const ok = await page.waitFor(`!document.querySelector('#modal').hidden`, 6000);
    assert(ok, '点 chip 后详情弹窗没打开');
    const st = await page.state();
    assert(st.modal.open, '弹窗未处于打开态');
    assert(st.modal.title, '弹窗标题为空');
    await page.key('Escape');
    await page.waitFor(`document.querySelector('#modal').hidden`, 5000);
    return { detail: `弹窗标题「${st.modal.title}」，Esc 可关` };
  });

  await step(A, 'P5', '「装入实验室」：写入 15 槽配装并跳转 #/lab', async () => {
    await page.ev(`(async () => { const { store } = await import('${PFX}/js/core/store.js'); store.build.clear(); return 0; })()`, { awaitPromise: true });
    await page.goto('#/builds', { fresh: true });
    await page.waitFor(`!!document.querySelector('.bcard')`, 9000);
    const href = await page.ev(`document.querySelector('#view-root .bcard').getAttribute('href')`);
    const name = await page.ev(`document.querySelector('#view-root .bcard__name').textContent.trim()`);
    await page.goto(href);
    await page.waitFor(`!!document.querySelector('.bhero__acts .btn--primary')`, 9000);
    await page.click(`document.querySelector('.bhero__acts .btn--primary')`, { label: '装入实验室' });
    await page.waitFor(`location.hash.indexOf('#/lab') === 0`, 8000);
    const slots = await page.ev(`JSON.parse(localStorage.getItem('r2.v2.build') || '{}').slots || {}`);
    const filled = Object.entries(slots).filter(([, v]) => !!v);
    assert(filled.length >= 8, `装入后只填了 ${filled.length} 个槽（应 ≥8）：${JSON.stringify(slots)}`);
    // 抵抗后续用例受影响：清空
    await page.ev(`(async () => { const { store } = await import('${PFX}/js/core/store.js'); store.build.clear(); return 0; })()`, { awaitPromise: true });
    return { detail: `「${name}」→ ${filled.length} 槽：${filled.map(([k]) => k).join('/')}` };
  });

  await step(A, 'P6', '无效流派 key → 友好 404（不报错、可返回列表）', async () => {
    await page.goto('#/builds/__qa_no_such_build__', { fresh: true });
    const ok = await page.waitFor(`!!document.querySelector('#view-root .b404')`, 9000);
    assert(ok, '404 面板没渲染');
    const back = await page.count('#view-root .b404 a[href="#/builds"]');
    assert(back === 1, `404 缺少返回列表按钮（${back}）`);
    await page.click(`document.querySelector('#view-root .b404 a[href="#/builds"]')`, { label: '返回流派列表' });
    await page.waitFor(`location.hash === '#/builds'`, 6000);
    return { detail: '404 有说明与返回按钮；返回后台址 #/builds' };
  });

  await step(A, 'P7', '页面内链接无坏链（域名合法 + 流派 key 存在）', async () => {
    const domains = ['items', 'lab', 'builds', 'codex'];
    const keys = new Set(await page.ev(`(async () => (await (await fetch('${PFX}/data/builds.json')).json()).builds.map((b) => b.key))()`, { awaitPromise: true }));
    const pages = ['#/builds'];
    await page.goto('#/builds', { fresh: true });
    await page.waitFor(`document.querySelectorAll('#view-root .bcard').length === 7`, 9000);
    pages.push(await page.ev(`document.querySelector('#view-root .bcard').getAttribute('href')`));
    const bad = [];
    let checked = 0;
    for (const p of pages) {
      await page.goto(p);
      await sleep(400);
      const hrefs = await page.ev(`[...document.querySelectorAll('#view-root a[href^="#/"]')].map((a) => a.getAttribute('href'))`);
      for (const h of hrefs) {
        checked += 1;
        const segs = h.replace(/^#\//, '').split(/[?/]/).filter(Boolean);
        const dom = segs[0] || 'items';
        if (!domains.includes(dom)) { bad.push(`${p} → ${h}（未知领域 ${dom}）`); continue; }
        if (dom === 'builds' && segs[1] && !keys.has(decodeURIComponent(segs[1]))) bad.push(`${p} → ${h}（流派 key 不存在）`);
      }
    }
    assert(bad.length === 0, `坏链 ${bad.length} 条：${bad.slice(0, 6).join('; ')}`);
    return { detail: `检查 ${checked} 条站内链接，0 坏链` };
  });
}

/* ============================== 全站 ============================== */
async function runGlobal() {
  const A = 'global';
  await step(A, 'G1', 'Alt+1/2/3/4 切换四领域（hash + 顶部选中态）', async () => {
    await page.goto('#/items', { fresh: true });
    const logRows = [];
    for (const [k, dom] of [['2', 'lab'], ['3', 'builds'], ['4', 'codex'], ['1', 'items']]) {
      await page.key(k, { alt: true });
      await sleep(520);
      const st = await page.state();
      logRows.push(`${k}:${st.hash}/${st.domnav.join('|')}`);
      assert(st.hash.startsWith(`#/${dom}`), `Alt+${k} 后 hash=${st.hash}`);
      assert(st.domnav.includes(dom), `Alt+${k} 顶部选中态=${st.domnav}`);
    }
    return { detail: logRows.join(' → ') };
  });

  await step(A, 'G2', 'document.title 随路由同步（四领域）', async () => {
    const out = [];
    for (const [dom, zh] of [['items', '资料库'], ['lab', '实验室'], ['builds', '流派'], ['codex', '知识库']]) {
      await page.goto(`#/${dom}`, { fresh: true });
      await page.waitFor(`document.title.indexOf(${JSON.stringify(zh)}) >= 0`, 8000);
      const st = await page.state();
      out.push(`${dom}→「${st.title}」`);
      assert(st.title.includes(zh), `${dom} 的 title「${st.title}」不含「${zh}」`);
    }
    return { detail: out.join('; ') };
  });

  await step(A, 'G3', '顶栏「已拥有/收藏」计数随操作变化（自包含）', async () => {
    await page.goto('#/items', { fresh: true });
    await page.waitCount('#view-root .card', 2);
    const before = await page.state();
    const pick = await page.ev(`(() => {
      const owned = new Set(JSON.parse(localStorage.getItem('r2.v2.owned') || '[]'));
      const fav = new Set(JSON.parse(localStorage.getItem('r2.v2.fav') || '[]'));
      const card = [...document.querySelectorAll('#view-root .card')].find((c) => c.dataset.id && !owned.has(c.dataset.id) && !fav.has(c.dataset.id));
      return card ? card.dataset.id : ''; })()`);
    assert(pick, '找不到未拥有且未收藏的卡');
    await page.click(`document.querySelector('#view-root .card[data-id="${pick}"]')`, { label: `卡 ${pick}` });
    await page.waitFor(`!document.querySelector('#modal').hidden`, 6000);
    await page.click(`[...document.querySelectorAll('#modal button')].find((x) => /未拥有|已拥有/.test(x.textContent || ''))`, { label: '拥有' });
    await sleep(320);
    await page.click(`[...document.querySelectorAll('#modal button')].find((x) => /收藏/.test(x.textContent || ''))`, { label: '收藏' });
    await sleep(320);
    const after = await page.state();
    assert(after.owned.length === before.owned.length + 1, `owned 未 +1（${before.owned.length}→${after.owned.length}）`);
    assert(after.fav.length === before.fav.length + 1, `fav 未 +1`);
    assert(String(after.statOwned) === String(after.owned.length), '顶栏已拥有计数不一致');
    assert(String(after.statFav) === String(after.fav.length), '顶栏收藏计数不一致');
    return { detail: `已拥有 ${before.statOwned}→${after.statOwned}；收藏 ${before.statFav}→${after.statFav}` };
  });

  await step(A, 'G4', '刷新后状态保持（localStorage）', async () => {
    const before = await page.state();
    await page.goto('#/items', { fresh: true });
    await page.waitFor(`(() => { const b = document.querySelector('#statOwned b');
      return b && Number(b.textContent) === ${before.owned.length}; })()`, 8000);
    const after = await page.state();
    assert(after.owned.length === before.owned.length && after.fav.length === before.fav.length,
      `刷新后状态丢失（owned ${before.owned.length}→${after.owned.length}）`);
    return { detail: `刷新后 owned=${after.owned.length} / fav=${after.fav.length}` };
  });

  await step(A, 'G5', '全程 0 console error / 未捕获异常', async () => {
    assert(consoleErrors.length === 0, `${consoleErrors.length} 条：${consoleErrors.slice(0, 3).map((e) => e.text).join(' | ')}`);
    return { detail: '0 error / 0 未捕获异常' };
  });

  await step(A, 'G6', '无本机之外网络请求（纯离线）', async () => {
    assert(externalRequests.length === 0, `外部请求：${externalRequests.slice(0, 3).join(', ')}`);
    return { detail: '0 外链请求' };
  });

  await step(A, 'G7', '全站可交互元素均有可访问名称', async () => {
    const routes = ['#/items', '#/lab', '#/lab?panel=recommend', '#/codex', secondHref || '#/codex'];
    const bad = [];
    for (const r of routes) {
      await page.goto(r, { fresh: true });
      const rows = await page.ev(`(() => {
        const out = [];
        for (const el of document.querySelectorAll('button, a[href], [role="button"]')) {
          const cs = getComputedStyle(el);
          if (cs.display === 'none' || cs.visibility === 'hidden') continue;
          const name = (el.textContent || '').trim() || el.getAttribute('aria-label') || el.getAttribute('title') || '';
          if (!name) out.push({ tag: el.tagName.toLowerCase(), cls: String(el.className || '').slice(0, 40), html: el.outerHTML.slice(0, 80) });
          else if (el.classList.contains('iconbtn') && !el.getAttribute('aria-label')) {
            out.push({ tag: el.tagName.toLowerCase(), cls: String(el.className || '').slice(0, 40), html: 'iconbtn 缺 aria-label: ' + el.outerHTML.slice(0, 60) });
          }
        }
        return out; })()`);
      for (const x of rows) bad.push(`${r} ${x.tag}.${x.cls} ${x.html}`);
    }
    assert(bad.length === 0, `${bad.length} 个元素无可访问名称：${bad.slice(0, 4).join(' | ')}`);
    return { detail: `${routes.length} 条路由全部有可访问名称` };
  });

  await step(A, 'G8', '全站图片均有 alt 属性', async () => {
    const bad = [];
    for (const r of ['#/items', '#/lab', '#/codex']) {
      await page.goto(r, { fresh: true });
      const rows = await page.ev(`[...document.querySelectorAll('img')].filter((im) => !im.hasAttribute('alt'))
        .map((im) => (im.src || '').split('/').pop())`);
      for (const x of rows) bad.push(`${r} ${x}`);
    }
    assert(bad.length === 0, `${bad.length} 张图片缺 alt：${bad.slice(0, 6).join(', ')}`);
    return { detail: '3 条路由 img 全部带 alt' };
  });

  await step(A, 'G9', '无重复标题（每页 h1 ≤1、panel 标题不重复）', async () => {
    const routes = ['#/items', '#/items/sets', '#/lab', '#/lab?panel=replace', '#/lab?panel=classes', '#/lab?panel=calc', '#/codex', secondHref || '#/codex', '#/builds', firstBuildHref || '#/builds'];
    const bad = [];
    for (const r of routes) {
      await page.goto(r, { fresh: true });
      await sleep(500);
      const info = await page.ev(`(() => {
        const h1 = [...document.querySelectorAll('h1')].map((h) => (h.textContent || '').trim().slice(0, 24));
        const titles = [...document.querySelectorAll('.panel__title')].map((h) => (h.textContent || '').trim());
        const dup = {}; for (const t of titles) if (t) dup[t] = (dup[t] || 0) + 1;
        return { h1, reps: Object.keys(dup).filter((k) => dup[k] > 1) }; })()`);
      if (info.h1.length > 1) bad.push(`${r} h1=${info.h1.length}：${info.h1.join(' / ')}`);
      if (info.reps.length) bad.push(`${r} 重复 panel 标题：${info.reps.join(' / ')}`);
    }
    assert(bad.length === 0, bad.join(' ; '));
    return { detail: `${routes.length} 条路由 h1=1、无重复 panel 标题` };
  });

  await step(A, 'D1', '数据门禁：/data/item_effects.json 200 且 items ≥300；/api/health extra_data 含 item_effects', async () => {
    const info = await page.ev(`(async () => {
      const r = await fetch('${PFX}/data/item_effects.json', { cache: 'no-store' });
      let count = -1; let sample = ''; let shape = '';
      try { const j = await r.json(); const its = j.items || {};
        shape = Array.isArray(its) ? 'array' : typeof its;
        const keys = Object.keys(its);
        count = keys.length;
        const k = keys[0]; sample = k ? String((its[k] || {}).zh || '').slice(0, 24) : ''; } catch (e) { /* ignore */ }
      const h = await (await fetch('${PFX}/api/health', { cache: 'no-store' })).json();
      const extra = Object.keys((h && h.extra_data) || {});
      return { status: r.status, count, sample, extra, hasItemEffects: extra.includes('item_effects') }; })()`, { awaitPromise: true });
    assert(info.status === 200, `/data/item_effects.json HTTP ${info.status}`);
    assert(info.count >= 300, `item_effects items=${info.count} < 300`);
    assert(info.hasItemEffects, `/api/health.extra_data 缺 item_effects（实际 ${(info.extra || []).join(',')}）`);
    assert((info.extra || []).includes('builds'), `/api/health.extra_data 缺 builds（实际 ${(info.extra || []).join(',')}）`);
    return { detail: `HTTP 200；items=${info.count}；extra_data=${info.extra.length} 项（含 item_effects / builds）` };
  });

  await step(A, 'G10', '主题：三态循环 / Alt+T / localStorage 持久化 / 首屏属性一致', async () => {
    await page.goto('#/items', { fresh: true });
    const read = () => page.ev(`(() => { const r = document.documentElement;
      let ui = {}; try { ui = JSON.parse(localStorage.getItem('r2.v2.ui') || '{}') || {}; } catch (e) {}
      const btn = document.querySelector('#themeBtn');
      const meta = document.querySelector('meta[name="theme-color"]');
      return { theme: r.dataset.theme || '', mode: r.dataset.themeMode || '',
        stored: ui.theme || '', scheme: String(r.style.colorScheme || ''),
        btnTitle: btn ? String(btn.title || '') : '', btnMode: btn ? String(btn.dataset.mode || '') : '',
        metaColor: meta ? String(meta.getAttribute('content') || '') : '',
        sysLight: !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches) }; })()`);
    // 先归位到 auto
    await page.ev(`(async () => { const { theme } = await import('${PFX}/js/core/theme.js'); theme.set('auto'); return 0; })()`, { awaitPromise: true });
    await sleep(260);
    let st = await read();
    const seen = [`${st.mode}:${st.theme}`];
    assert(st.mode === 'auto', `初始 mode=${st.mode}`);
    assert(st.theme === (st.sysLight ? 'light' : 'dark'), `auto 未跟随系统（theme=${st.theme}, sysLight=${st.sysLight}）`);
    assert(st.btnMode === 'auto', `按钮 data-mode=${st.btnMode}`);
    // 点三次回到 auto：auto → light → dark → auto
    for (let i = 0; i < 3; i++) {
      await page.click(`document.querySelector('#themeBtn')`, { label: '主题按钮' });
      await sleep(340);
      st = await read();
      seen.push(`${st.mode}:${st.theme}`);
      assert(['auto', 'light', 'dark'].includes(st.mode), `mode=${st.mode} 非法`);
      assert(st.stored === st.mode, `localStorage r2.v2.ui.theme=${st.stored} ≠ mode=${st.mode}`);
      if (st.mode === 'light' || st.mode === 'dark') {
        assert(st.theme === st.mode, `mode=${st.mode} 但 data-theme=${st.theme}`);
      }
      assert(st.btnTitle.indexOf(st.mode === 'auto' ? '自动' : (st.mode === 'light' ? '白天' : '黑夜')) >= 0, `按钮 title 与 mode 不符：${st.btnTitle}`);
      assert(/^#[0-9a-fA-F]{3,8}$/.test(st.metaColor), `theme-color 不是十六进制：${st.metaColor}`);
    }
    assert(new Set(seen).size === 3, `三态循环异常：${seen.join(' → ')}`);
    // 持久化：显式设 light 后整页刷新
    await page.ev(`(async () => { const { theme } = await import('${PFX}/js/core/theme.js'); theme.set('light'); return 0; })()`, { awaitPromise: true });
    await page.goto('#/items', { fresh: true });
    st = await read();
    assert(st.mode === 'light' && st.theme === 'light', `刷新后 mode=${st.mode}/theme=${st.theme}（应 light/light）`);
    // Alt+T：light → dark
    await page.key('t', { alt: true });
    await sleep(360);
    const afterAlt = await read();
    assert(afterAlt.mode === 'dark' && afterAlt.theme === 'dark', `Alt+T 后 mode=${afterAlt.mode}/theme=${afterAlt.theme}（应 dark/dark）`);
    // 还原 auto，避免影响后续用例
    await page.ev(`(async () => { const { theme } = await import('${PFX}/js/core/theme.js'); theme.set('auto'); return 0; })()`, { awaitPromise: true });
    return { detail: `循环 ${seen.join(' → ')}；刷新保持 light；Alt+T→dark；theme-color 随主题更新` };
  });}

/* ============================== 移动端 ============================== */
async function setViewport(vp) {
  await page.root.send('Emulation.setDeviceMetricsOverride', {
    width: vp.w, height: vp.h, deviceScaleFactor: 1, mobile: vp.w < 760,
    screenWidth: vp.w, screenHeight: vp.h,
  }, page.sid);
  await page.root.send('Emulation.setTouchEmulationEnabled', { enabled: vp.w < 760, maxTouchPoints: 5 }, page.sid).catch(() => {});
}

async function runMobile() {
  const A = 'mobile';
  await page.ensureClean();
  await setViewport(MOBILE);
  await step(A, 'M1', '390×844 各路由无横向滚动', async () => {
    const routes = ['#/items', '#/items?view=list', '#/lab', '#/lab?panel=recommend', '#/lab?panel=calc', '#/codex', secondHref || '#/codex', '#/builds', firstBuildHref || '#/builds'];
    const bad = [];
    const out = [];
    for (const r of routes) {
      await page.goto(r, { fresh: true });
      const st = await page.state();
      out.push(`${r}: ${st.scroll.sw}/${st.scroll.cw}`);
      if (st.scroll.sw > st.scroll.cw + 1) bad.push(`${r} (scrollWidth ${st.scroll.sw} > clientWidth ${st.scroll.cw})`);
    }
    assert(bad.length === 0, `横向溢出：${bad.join('; ')}`);
    return { detail: out.join('; ') };
  });

  await step(A, 'M2', '移动点卡片 → 全屏抽屉（#drawer 可见、#modal 隐藏、宽=视口）', async () => {
    await page.ensureClean();
    await page.goto('#/items', { fresh: true });
    await page.waitCount('#view-root .card', 1);
    await page.click(`document.querySelector('#view-root .card')`, { label: '首个物品卡' });
    const ok = await page.waitFor(`(document.querySelector('#drawer') && !document.querySelector('#drawer').hidden)`, 6000);
    const info = await page.ev(`(() => { const d = document.querySelector('#drawer'); const m = document.querySelector('#modal');
      const r = d ? d.getBoundingClientRect() : null;
      return { drawerOpen: !!d && !d.hidden, modalHidden: !m || m.hidden, w: r ? Math.round(r.width) : 0, iw: innerWidth }; })()`);
    assert(ok, '移动端点卡片未打开 #drawer');
    assert(info.modalHidden, '移动端不应使用 #modal');
    assert(info.w === info.iw, `抽屉宽 ${info.w} ≠ 视口 ${info.iw}`);
    await capture('interact-mobile-drawer');
    return { detail: `抽屉 ${info.w}×视口 ${info.iw}；modal 隐藏` };
  });

  await step(A, 'M3', '移动详情图片 120–140px（§11.1）', async () => {
    const info = await page.ev(`(() => { const d = document.querySelector('#drawer');
      const img = d ? d.querySelector('.detail-hero__media img, .detail-hero img, img') : null;
      const hero = d ? d.querySelector('.detail-hero, .detail-hero__media') : null;
      return { imgW: img ? Math.round(img.getBoundingClientRect().width) : 0,
        heroW: hero ? Math.round(hero.getBoundingClientRect().width) : 0 }; })()`);
    assert(info.imgW >= 120, `移动详情图宽 ${info.imgW}px < 120px（§11.1 要求 120–140px）`);
    assert(info.imgW <= 140, `移动详情图宽 ${info.imgW}px > 140px（§11.1 要求 120–140px）`);
    return { detail: `图片 ${info.imgW}px（容器 ${info.heroW}px）` };
  });

  await step(A, 'M4', '移动端筛选可用（chip 可见可点）', async () => {
    await page.ensureClean();
    await page.goto('#/items', { fresh: true });
    await page.waitFor(`document.querySelectorAll('#view-root .chip').length > 0`, 10000);
    const chips = await page.count('#view-root .chip');
    const r = await page.rect(`document.querySelector('#view-root .chip')`);
    assert(chips > 0 && r && r.w > 0 && r.left >= 0 && r.left < 390, `首个 chip 不可见/越界：${JSON.stringify(r)}`);
    return { detail: `chip ${chips} 个，首个 ${r.w}×${r.h} @${r.left}` };
  });

  await step(A, 'M5', '抽样 10 个点击目标 ≥32px', async () => {
    await page.goto('#/lab', { fresh: true });
    const targets = await page.ev(`(() => {
      const els = [...document.querySelectorAll('button, a[href], [role="button"], .iconbtn, .chip, .seg__btn, .slot')];
      const out = [];
      for (const el of els) {
        const r = el.getBoundingClientRect();
        if (r.width <= 0 || r.height <= 0) continue;
        if (r.left < 0 || r.top < 0 || r.left > innerWidth || r.top > innerHeight) continue;
        const cs = getComputedStyle(el);
        if (cs.visibility === 'hidden' || cs.display === 'none') continue;
        out.push({ tag: el.tagName.toLowerCase(), cls: String(el.className || '').slice(0, 50),
          label: (el.getAttribute('aria-label') || el.getAttribute('title') || el.textContent || '').trim().slice(0, 26),
          w: Math.round(r.width * 10) / 10, h: Math.round(r.height * 10) / 10 });
        if (out.length >= 10) break;
      }
      return out; })()`);
    assert(targets.length >= 10, `可见目标不足 10 个（${targets.length}）`);
    const small = targets.filter((t) => t.w < 32 || t.h < 32);
    assert(small.length === 0, `存在 <32px 目标：${small.map((t) => `${t.tag}.${t.cls}(${t.label}) ${t.w}×${t.h}`).join('; ')}`);
    return { detail: targets.map((t) => `${t.w}×${t.h}`).join(' ') };
  });

  await step(A, 'M6', '移动列表视图每行有描述（1 行截断）', async () => {
    await page.goto('#/items', { fresh: true });
    await page.waitCount('#view-root .card', 1);
    await page.click(`document.querySelector('[aria-label="列表视图"]')`, { label: '列表视图' });
    await page.waitFor(`document.querySelectorAll('#view-root .lib-row').length >= 3`, 8000);
    const descs = await page.ev(`[...document.querySelectorAll('#view-root .lib-row .lib-row__desc')].slice(0, 5)
      .map((d) => (d.textContent || '').trim())`);
    assert(descs.length >= 3, `列表行描述元素 ${descs.length} < 3`);
    assert(descs.every((d) => d && d !== '—'), `存在空描述：${JSON.stringify(descs)}`);
    return { detail: `${descs.length} 行，例「${descs[0].slice(0, 20)}」` };
  });

  await setViewport(VIEW);
}

/* ------------------------------- 主流程 ------------------------------- */
async function main() {
  await fsp.mkdir(SHOTS, { recursive: true });
  await fsp.mkdir(RESULTS_DIR, { recursive: true });
  const groups = [['items', runItems], ['lab', runLab], ['builds', runBuilds], ['codex', runCodex], ['global', runGlobal], ['mobile', runMobile]];
  const selected = ONLY ? groups.filter(([k]) => ONLY.includes(k)) : groups;

  const { child, wsUrl, profile } = launchChrome({ width: VIEW.w, height: VIEW.h });
  let fatal = null;
  try {
    const root = await CDP.connect(await wsUrl, { timeout: 25000 });
    cdpRoot = root;
    const { targetId } = await root.send('Target.createTarget', { url: 'about:blank' });
    const attached = await root.send('Target.attachToTarget', { targetId, flatten: true });
    session = attached.sessionId;
    page = new Page(root, session);

    await root.send('Page.enable', {}, session);
    await root.send('Runtime.enable', {}, session);
    await root.send('Network.enable', {}, session);
    await root.send('Page.addScriptToEvaluateOnNewDocument', { source: PAGE_HELPERS }, session);
    await root.send('Runtime.evaluate', { expression: PAGE_HELPERS }, session).catch(() => {});

    root.on('Runtime.consoleAPICalled', (p, sid) => {
      if (sid !== session) return;
      if (p.type === 'error' || p.type === 'assert') {
        const text = (p.args || []).map((a) => a.value ?? a.description ?? a.type).join(' ');
        consoleErrors.push({ test: currentTest, type: p.type, text: String(text).slice(0, 400) });
      }
    });
    root.on('Runtime.exceptionThrown', (p, sid) => {
      if (sid !== session) return;
      const d = p.exceptionDetails || {};
      consoleErrors.push({ test: currentTest, type: 'exception',
        text: String((d.exception && (d.exception.description || d.exception.value)) || d.text || '').slice(0, 400) });
    });
    root.on('Network.requestWillBeSent', (p, sid) => {
      if (sid !== session) return;
      const u = String((p.request && p.request.url) || '');
      if (!u) return;
      try {
        const host = new URL(u).hostname;
        if (!['127.0.0.1', 'localhost', ''].includes(host)) externalRequests.push(u);
      } catch { /* ignore */ }
    });

    await root.send('Emulation.setDeviceMetricsOverride', {
      width: VIEW.w, height: VIEW.h, deviceScaleFactor: 1, mobile: false, screenWidth: VIEW.w, screenHeight: VIEW.h,
    }, session);

    for (const [key, fn] of selected) {
      console.log(`\n——— ${AREAS[key]} ———`);
      try { await fn(); } catch (e) {
        record(key, `${key.toUpperCase()}-GROUP`, '分组执行中断', 'FAIL', String((e && e.message) || e));
      }
    }
  } catch (e) {
    fatal = e;
    console.error('[interactions] 致命错误:', e && e.stack ? e.stack : e);
  } finally {
    try { cdpRoot?.close(); } catch { /* ignore */ }
    cleanupChrome({ child, profile });
  }

  const fails = results.filter((r) => r.status === 'FAIL');
  const pass = results.filter((r) => r.status === 'PASS');
  const skip = results.filter((r) => r.status === 'SKIP');
  const summary = {
    generated_at: new Date().toISOString(),
    base: BASE,
    pass: pass.length, fail: fails.length, skip: skip.length, total: results.length,
    console_errors: consoleErrors,
    external_requests: externalRequests,
    results,
  };
  await fsp.writeFile(path.join(RESULTS_DIR, 'interactions.json'), JSON.stringify(summary, null, 2));
  console.log(`\n[interactions] PASS=${pass.length} FAIL=${fails.length} SKIP=${skip.length}`
    + `  consoleError=${consoleErrors.length}  → qa/results/interactions.json`);
  if (consoleErrors.length) {
    console.log('[interactions] console 错误：');
    for (const e of consoleErrors.slice(0, 6)) console.log(`  - (${e.test}) ${e.type}: ${e.text}`);
  }
  if (fails.length) {
    console.log('[interactions] 失败项：');
    for (const f of fails) console.log(`  - [${f.area}] ${f.id} ${f.name}：${String(f.detail || '').slice(0, 200)}`);
  }
  if (fatal) return 2;
  return fails.length ? 1 : 0;
}

main().then((c) => { process.exitCode = c; }).catch((e) => {
  console.error('[interactions] 未捕获:', e);
  process.exitCode = 2;
});
