#!/usr/bin/env node
/* =============================================================================
   遗迹2 · 遗物档案 — QA 截图 + 错误门禁（零依赖）
   用法：
     node qa/shot.js                       # 默认路由列表，双档截图
     node qa/shot.js --only lab,codex      # 只截部分（按 name 前缀/包含匹配）
     node qa/shot.js --desktop-only        # 只 1440×1000
     node qa/shot.js --base http://127.0.0.1:8777
     node qa/shot.js --urls routes.txt     # 每行 "name<TAB或空格>#/path"
   输出：
     qa/shots/<name>-<width>.png
     qa/shots/_summary.json                # 每路由的 console error / 异常 / 4xx
   退出码：0 无错误；1 有错误（可当门禁）；2 启动/致命失败
   ========================================================================== */
'use strict';

const fsp = require('node:fs/promises');
const path = require('node:path');

const QA_DIR = __dirname;
const SHOTS_DIR = path.join(QA_DIR, 'shots');

const argv = process.argv.slice(2);
if (argv.includes('--help') || argv.includes('-h')) {
  console.log([
    '用法：node qa/shot.js [选项]',
    '',
    '  截图 + 错误门禁：默认路由表由 data 推导（当前 27 条）× 1440×1000 / 390×844 两档，',
    '  等 #view-root 出内容再截；收集 console error / 未捕获异常 / 4xx-5xx / 失败请求。',
    '',
    '选项：',
    '  --all              全部路由 × 两档视口（默认行为，可显式写）',
    '  --base <url>       站点地址（默认 http://127.0.0.1:8777；子路径部署可写 …/relic-archive）',
    '  --chrome <path>    指定 Chrome/Chromium 可执行文件（默认自动探测：CHROME_PATH → 平台路径 → where/which）',
    '  --only a,b         只截指定 name（包含匹配，如 --only lab,codex,builds）',
    '  --theme auto|light|dark  模拟系统配色偏好（默认 auto；亮暗双跑用两次 --theme）',
    '  --desktop-only     只 1440×1000',
    '  --mobile-only      只 390×844',
    '  --urls <file>      自定义路由文件：每行 "name #/path"',
    '  --timeout <ms>     CDP 单命令超时（默认 20000）',
    '  --nav-timeout <ms> 等视图就绪上限（默认 25000）',
    '  --settle <ms>      截图前静置（默认 450）',
    '  --quiet            少打印',
    '',
    '输出：qa/shots/<name>-<width>[-light|-dark].png + qa/shots/_summary.json',
    '退出码：0=全部 PASS；1=存在 console/异常/HTTP 错误；2=Chrome 启动失败',
    '',
    '一条命令跑完全部验收：',
    '  node qa/shot.js --theme dark && node qa/shot.js --theme light && node qa/interactions.js && python qa/audit.py',
  ].join('\n'));
  process.exit(0);
}
const ALL = argv.includes('--all'); void ALL;   // 默认即全部，显式 --all 兼容
function arg(name, def = null) {
  const i = argv.indexOf(`--${name}`);
  if (i < 0) return def;
  const v = argv[i + 1];
  return v && !v.startsWith('--') ? v : true;
}
const BASE = String(arg('base', 'http://127.0.0.1:8777')).replace(/\/+$/, '');
const ONLY = arg('only', null);
const DESKTOP_ONLY = !!arg('desktop-only', false);
const MOBILE_ONLY = !!arg('mobile-only', false);
const TIMEOUT = Number(arg('timeout', 20000));
const NAV_TIMEOUT = Number(arg('nav-timeout', 25000));
const SETTLE = Number(arg('settle', 450));
const URLS_FILE = arg('urls', null);
const CHROME_ARG = arg('chrome', null);
const QUIET = !!arg('quiet', false);
/** 主题：auto（不模拟，跟随 OS 偏好）/ light / dark（用 CDP 模拟 prefers-color-scheme） */
const THEME = String(arg('theme', 'auto'));
const THEME_SUFFIX = THEME === 'auto' ? '' : `-${THEME}`;

const VIEWPORTS = [];
if (!MOBILE_ONLY) VIEWPORTS.push({ name: '1440', w: 1440, h: 1000, mobile: false });
if (!DESKTOP_ONLY) VIEWPORTS.push({ name: '390', w: 390, h: 844, mobile: true });

/* ------------------------------- 工具 ------------------------------- */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => { if (!QUIET) console.log(...a); };

async function readRoutesFile(file) {
  const txt = await fsp.readFile(file, 'utf8');
  return txt.split(/\r?\n/).map((line) => line.trim()).filter((l) => l && !l.startsWith('#'))
    .map((line) => {
      const [name, ...rest] = line.split(/\s+/);
      const p = rest.join(' ');
      if (!p) return { name: name.replace(/^[#/]+/, ''), path: name.startsWith('#') ? name : `#/${name}` };
      return { name, path: p };
    });
}

/* CDP 客户端 / Chrome 启动 / 路由表：复用 qa/lib/（零依赖） */
const { CDP, launchChrome, cleanupChrome, resolveChrome } = require('./lib/cdp.js');

/* --------------------------- 单路由 × 单视口 --------------------------- */
const READY_EXPR = `(() => {
  const r = document.querySelector('#view-root');
  if (!r) return { ok: false, why: 'no #view-root' };
  const txt = (r.textContent || '').replace(/\\s+/g, ' ').trim();
  const kids = r.children.length;
  const failed = /页面载入失败|无法读取/.test(txt);
  return { ok: kids > 0 && txt.length > 8 && !failed, failed,
           len: txt.length, kids, title: document.title,
           text: txt.slice(0, 160), ready: document.readyState,
           url: location.href };
})()`;

async function captureRoute(cdp, browserSession, route, vp) {
  const t0 = Date.now();
  const url = `${BASE}/${route.path}`;
  const errors = { console: [], exceptions: [], http: [], failed: [], other: [] };

  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' }, browserSession);
  let sessionId;
  try {
    const attached = await cdp.send('Target.attachToTarget', { targetId, flatten: true }, browserSession);
    sessionId = attached.sessionId;

    const isMain = (sid) => sid === sessionId;
    cdp.on('Runtime.consoleAPICalled', (p, sid) => {
      if (!isMain(sid)) return;
      if (p.type !== 'error' && p.type !== 'assert') return;
      const text = (p.args || []).map((a) => a.value ?? a.unserializableValue ?? a.description ?? a.type).join(' ');
      errors.console.push({ type: p.type, text: String(text).slice(0, 500) });
    });
    cdp.on('Runtime.exceptionThrown', (p, sid) => {
      if (!isMain(sid)) return;
      const d = p.exceptionDetails || {};
      const desc = (d.exception && (d.exception.description || d.exception.value)) || d.text || '未知异常';
      errors.exceptions.push(String(desc).slice(0, 800));
    });
    cdp.on('Network.responseReceived', (p, sid) => {
      if (!isMain(sid)) return;
      const r = p.response || {};
      if (r.status >= 400) errors.http.push({ status: r.status, url: r.url, type: p.type });
    });
    cdp.on('Network.loadingFailed', (p, sid) => {
      if (!isMain(sid)) return;
      if (p.type === 'Image' && /favicon/i.test(p.errorText || '')) return;
      errors.failed.push({ url: p.requestId, error: p.errorText, type: p.type, blocked: p.blockedReason });
    });

    await cdp.send('Page.enable', {}, sessionId);
    await cdp.send('Runtime.enable', {}, sessionId);
    await cdp.send('Network.enable', {}, sessionId);
    // 主题：模拟 OS 偏好（页面默认 theme=auto，跟随 prefers-color-scheme）
    if (THEME === 'light' || THEME === 'dark') {
      await cdp.send('Emulation.setEmulatedMedia', {
        features: [{ name: 'prefers-color-scheme', value: THEME }],
      }, sessionId).catch(() => {});
    }
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: vp.w, height: vp.h, deviceScaleFactor: 1, mobile: vp.mobile,
      screenWidth: vp.w, screenHeight: vp.h,
    }, sessionId);
    if (vp.mobile) {
      await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 }, sessionId).catch(() => {});
    }

    await cdp.send('Page.navigate', { url }, sessionId);
    // 等待 #view-root 有内容
    const deadline = Date.now() + NAV_TIMEOUT;
    let ready = null;
    while (Date.now() < deadline) {
      const r = await cdp.send('Runtime.evaluate', {
        expression: READY_EXPR, returnByValue: true, awaitPromise: false,
      }, sessionId);
      ready = r.result && r.result.value;
      if (ready && ready.ok) break;
      await sleep(150);
    }
    if (route.waitFor) {
      const dl = Date.now() + Math.max(6000, NAV_TIMEOUT);
      while (Date.now() < dl) {
        const okW = await cdp.send('Runtime.evaluate', {
          expression: `(() => { try { return ${route.waitFor}; } catch (e) { return false; } })()`,
          returnByValue: true,
        }, sessionId).then((r) => r.result && r.result.value).catch(() => false);
        if (okW) break;
        await sleep(150);
      }
    }
    await sleep(SETTLE);

    // 滚动到底触发懒加载图标（再回顶截图）
    await cdp.send('Runtime.evaluate', {
      expression: `(async () => {
        const step = 700; const H = document.documentElement.scrollHeight;
        for (let y = 0; y < H; y += step) { window.scrollTo(0, y); await new Promise(r => requestAnimationFrame(r)); }
        window.scrollTo(0, 0);
        if (document.fonts && document.fonts.ready) { try { await document.fonts.ready; } catch (e) {} }
        await new Promise(r => setTimeout(r, 120));
        return true;
      })()`, awaitPromise: true, returnByValue: true,
    }, sessionId).catch(() => {});

    // 移动端横向溢出（顺手采集，供移动端检查用）
    const metrics = await cdp.send('Runtime.evaluate', {
      expression: `(() => ({ scrollWidth: document.documentElement.scrollWidth,
        innerWidth: window.innerWidth, scrollHeight: document.documentElement.scrollHeight,
        title: document.title, hash: location.hash }))()`,
      returnByValue: true,
    }, sessionId);

    // 主题实况：实际落地的是 dark 还是 light（配合 --theme 验证切换是否生效）
    const themeNow = await cdp.send('Runtime.evaluate', {
      expression: `(() => ({ theme: document.documentElement.dataset.theme || '',
        mode: document.documentElement.dataset.themeMode || '',
        scheme: getComputedStyle(document.documentElement).colorScheme || '' }))()`,
      returnByValue: true,
    }, sessionId).catch(() => null);

    const shot = await cdp.send('Page.captureScreenshot', {
      format: 'png', captureBeyondViewport: false,
    }, sessionId);
    const file = path.join(SHOTS_DIR, `${route.name}-${vp.name}${THEME_SUFFIX}.png`);
    await fsp.writeFile(file, Buffer.from(shot.data, 'base64'));

    const errorCount = errors.console.length + errors.exceptions.length + errors.http.length + errors.failed.length;
    return {
      name: route.name, path: route.path, viewport: vp.name, theme: THEME, file: path.relative(QA_DIR, file),
      ok: errorCount === 0 && !(ready && ready.failed) && !!(ready && ready.ok),
      ready, metrics: metrics.result && metrics.result.value,
      themeState: themeNow && themeNow.result ? themeNow.result.value : null,
      errors, ms: Date.now() - t0,
    };
  } catch (e) {
    return {
      name: route.name, path: route.path, viewport: vp.name, file: null, ok: false,
      fatal: String(e && e.message ? e.message : e), errors, ms: Date.now() - t0,
    };
  } finally {
    await cdp.send('Target.closeTarget', { targetId }, browserSession).catch(() => {});
  }
}

/* -------------------------------- 主流程 -------------------------------- */
async function main() {
  await fsp.mkdir(SHOTS_DIR, { recursive: true });
  // 路由表与 gate 共用 qa/lib/routes.mjs（ESM，动态导入以兼容 CJS 入口）
  let routes;
  if (URLS_FILE) {
    routes = await readRoutesFile(path.resolve(String(URLS_FILE)));
  } else {
    const { deriveRoutes } = await import('./lib/routes.mjs');
    routes = await deriveRoutes(BASE);
  }
  if (ONLY) {
    const pats = String(ONLY).split(',').map((s) => s.trim()).filter(Boolean);
    routes = routes.filter((r) => pats.some((p) => r.name.includes(p)));
  }
  if (!routes.length) { console.error('[shot] 没有可截的 URL'); return 2; }

  // Chrome：--chrome 显式指定 → 否则自动探测（CHROME_PATH / CHROME_BIN / 平台候选 / where|which）
  let chromePath = CHROME_ARG && CHROME_ARG !== true ? String(CHROME_ARG) : '';
  let chromeSource = chromePath ? '--chrome' : '';
  if (!chromePath) {
    try {
      const found = resolveChrome();
      chromePath = found.path;
      chromeSource = found.source;
    } catch (e) {
      console.error(`[shot] ${e && e.message ? e.message : e}`);
      return 2;
    }
  }

  log(`[shot] base=${BASE}  主题=${THEME}  路由 ${routes.length} 条 × 视口 ${VIEWPORTS.map((v) => v.name).join('/')}`);
  log(`[shot] Chrome=${chromePath}（来源：${chromeSource}）`);
  const { child, wsUrl, profile } = launchChrome({ chromePath });
  let bg;
  let fatal = null;
  const results = [];
  try {
    bg = await CDP.connect(await wsUrl);
    const { sessions } = await bg.send('Target.getTargets').then(() => ({ sessions: true }));
    void sessions;
    // 浏览器级会话：直接用 root session（不带 sessionId）
    for (const route of routes) {
      for (const vp of VIEWPORTS) {
        const r = await captureRoute(bg, undefined, route, vp);
        results.push(r);
        const flag = r.ok ? 'PASS' : 'FAIL';
        const ec = r.errors
          ? r.errors.console.length + r.errors.exceptions.length + r.errors.http.length + r.errors.failed.length
          : 0;
        log(`${flag} ${route.name.padEnd(16)} ${vp.name.padEnd(5)} ${r.file || '-'}  ${r.ms}ms${ec ? `  errors=${ec}` : ''}`);
        for (const e of (r.errors && r.errors.console) || []) log(`      console: ${e.text}`);
        for (const e of (r.errors && r.errors.exceptions) || []) log(`      exception: ${e}`);
        for (const e of (r.errors && r.errors.http) || []) log(`      HTTP ${e.status} ${e.url}`);
      }
    }
    // 汇总
    const bad = results.filter((r) => !r.ok);
    const summary = {
      generated_at: new Date().toISOString(),
      base: BASE,
      theme: THEME,
      routes: routes.map((r) => r.path),
      viewports: VIEWPORTS.map((v) => `${v.w}x${v.h}`),
      total: results.length,
      pass: results.length - bad.length,
      fail: bad.length,
      results,
    };
    await fsp.writeFile(path.join(SHOTS_DIR, '_summary.json'), JSON.stringify(summary, null, 2));
    log(`\n[shot] ${summary.pass}/${summary.total} PASS，失败 ${summary.fail} → qa/shots/_summary.json`);
    if (bad.length) {
      log('[shot] 失败项（门禁）：');
      for (const b of bad) log(`  - ${b.name}@${b.viewport}: ${b.fatal || Object.keys(b.errors).filter((k) => b.errors[k].length).map((k) => `${k}=${b.errors[k].length}`).join(' ') || 'view-root 未就绪'}`);
    }
    return bad.length ? 1 : 0;
  } catch (e) {
    fatal = e;
    console.error('[shot] 致命错误:', e && e.stack ? e.stack : e);
    return 2;
  } finally {
    try { bg?.close(); } catch { /* ignore */ }
    cleanupChrome({ child, profile });
    if (fatal) process.exitCode = 2;
  }
}

main().then((code) => { process.exitCode = code; }).catch((e) => {
  console.error('[shot] 未捕获:', e);
  process.exitCode = 2;
});
