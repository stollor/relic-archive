/* =============================================================================
   qa/tests/lab-async.browser.mjs — 实验室「推荐方案」异步穷举回归（真实浏览器 / CDP）
   运行：node qa/tests/lab-async.browser.mjs --base http://127.0.0.1:8777   （或 QA_BASE=…）
   退出码：0 全绿 / 1 有 FAIL / 2 致命错误

   覆盖（P0-2）：
     T1 穷举运行中连续改条件（场景 ×2）→ 最终结果必须对应最后一次条件（旧结果的
        「完成回调无版本检查」若发生，这里会读到被覆盖前的旧场景签名）；
     T2 穷举运行中离开 #/lab → 已卸载的推荐面板不得再被写入（RAF 无取消会继续写
        detached DOM，并顺带把旧任务的 syncQuery 打到新页面），#view-root 静默；
     T3 非 active 面板只标 dirty，切回推荐面板时补算（activate 语义保持）；
     T4 完成回调 syncQuery→applyParams 重入不得反复重启（静置 1.2s 零 DOM 变更）；
     T5 单次穷举耗时相对基线无显著退化（读状态栏「用时 N 毫秒」）；
     T6 onStep 抛错要显示失败态、可恢复（下次条件变化能重试），不能卡死在「穷举中」。

   设计说明：
   - 「运行中改条件」用同一段页面内脚本完成（按钮 click + change 事件同步派发），
     否则 CDP 往返的 10~30ms 会让 100ms 级的穷举先跑完，测不到竞态；
     慢设备场景用 Emulation.setCPUThrottlingRate 放大该窗口（真实低端机等效）。
   - 结果正确性不依赖固定数值：用页面内同步穷举（engine.enumerateTop 等价物）
     对「最后一次条件」现算 ground truth，再比对首行签名（场景分 / 护甲 / 四件 id）。
   - 临时截图只写 qa/_tmp/。
   ========================================================================== */
import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { CDP, launchChrome, cleanupChrome, sleep } = require('../lib/cdp.js');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TMP = path.join(__dirname, '..', '_tmp');
// 站点地址：--base 优先，其次 QA_BASE / LAB_QA_BASE（兼容旧用法），默认本机 8777。
// gate 用随机端口起服务时必须靠这个传进来，否则会连到不存在的 8777 而「视图就绪超时」。
const ARGV = process.argv.slice(2);
const BASE_ARG = (() => { const i = ARGV.indexOf('--base'); return i >= 0 ? ARGV[i + 1] : null; })();
const BASE = `${String(BASE_ARG || process.env.QA_BASE || process.env.LAB_QA_BASE || 'http://127.0.0.1:8777/').replace(/\/+$/, '')}/`;

/* ------------------------------ 结果记录 ------------------------------ */
const results = [];
let currentId = '';
function record(id, name, status, detail) {
  results.push({ id, name, status, detail: String(detail || '') });
  const mark = status === 'PASS' ? 'PASS' : 'FAIL';
  console.log(`[${mark}] ${id} ${name}${detail ? ` —— ${String(detail).slice(0, 400)}` : ''}`);
}
function assert(cond, msg) { if (!cond) throw new Error(msg); }

/* ------------------------------ Page 助手 ------------------------------ */
class Page {
  constructor(root, sid) { this.root = root; this.sid = sid; this.consoleErrors = []; this.exceptions = []; this.fails = 0; }

  async ev(expression, { awaitPromise = false } = {}) {
    const r = await this.root.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise }, this.sid);
    if (r.exceptionDetails) {
      throw new Error('页面异常：' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
    }
    return r.result ? r.result.value : undefined;
  }

  async waitFor(expr, timeout = 10000, interval = 50) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
      if (await this.ev(`(() => { try { return !!(${expr}); } catch (e) { return false; } })()`).catch(() => false)) return true;
      await sleep(interval);
    }
    return false;
  }

  /** hash 导航 + 等 SPA 视图就绪（数据加载完成、非 loading 面板） */
  async goto(hash, { fresh = false } = {}) {
    if (fresh) await this.root.send('Page.navigate', { url: 'about:blank' }, this.sid).catch(() => {});
    await this.root.send('Page.navigate', { url: `${BASE}${hash}` }, this.sid);
    const ok = await this.waitFor(`(() => { const r = document.querySelector('#view-root');
      if (!r) return false; const t = (r.textContent || '').trim();
      return !!r.querySelector('.view') && !/正在载入数据|正在读取 site_data/.test(t); })()`, 25000);
    if (!ok) throw new Error(`视图就绪超时：${hash}`);
    await sleep(180);
  }

  async text(sel) {
    return this.ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)});
      return e ? (e.textContent || '').replace(/\\s+/g, ' ').trim() : ''; })()`);
  }

  async count(sel) { return this.ev(`document.querySelectorAll(${JSON.stringify(sel)}).length`); }

  async status() { return this.text('.lab-rec__status'); }

  /** 轮询到穷举结束并静置 quietMs（期间不再出现「穷举中」）；超时抛错 */
  async settle({ timeout = 30000, quietMs = 450 } = {}) {
    const t0 = Date.now();
    let quietSince = 0;
    while (Date.now() - t0 < timeout) {
      const st = await this.ev(`(document.querySelector('.lab-rec__status') || {}).textContent || ''`).catch(() => '');
      if (!/穷举中/.test(st)) {
        if (!quietSince) quietSince = Date.now();
        if (Date.now() - quietSince >= quietMs) return st;
      } else quietSince = 0;
      await sleep(25);
    }
    throw new Error(`等待穷举结束超时（${timeout}ms）：${(await this.status().catch(() => '?')).slice(0, 160)}`);
  }

  /** 结果首行签名：场景分 / 护甲 / 四件中文名 / 行数 */
  async fsig() {
    return this.ev(`(() => {
      const row = document.querySelector('.lab-rec__row');
      if (!row) return null;
      const vals = [...row.querySelectorAll('.lab-rec__nums .stat__val')].map((e) => e.textContent);
      return {
        score: (row.querySelector('.lab-score b') || {}).textContent || '',
        armor: vals[0] || '',
        names: [...row.querySelectorAll('.lab-mini__name')].map((e) => e.textContent),
        rows: document.querySelectorAll('.lab-rec__row').length,
      };
    })()`);
  }

  async labState() {
    return this.ev(`(() => {
      const btn = [...document.querySelectorAll('.lab-rec__bar button')].find((b) => b.textContent.includes('重新穷举'));
      // v4：场景选择在装配台「设置」抽屉里，不常驻 DOM → 状态以 store.build.meta 为准
      let scenario = 'general';
      try { scenario = (JSON.parse(localStorage.getItem('r2.v2.build') || '{}').meta || {}).scenario || 'general'; } catch (e) { scenario = 'general'; }
      return {
        hash: location.hash,
        status: (document.querySelector('.lab-rec__status') || {}).textContent || '',
        rows: document.querySelectorAll('.lab-rec__row').length,
        scenario,
        reshead: (document.querySelector('.lab-reshead') || {}).textContent || '',
        button: btn ? { disabled: btn.disabled, text: btn.textContent.trim() } : null,
        recVisible: document.querySelectorAll('#view-root .lab-rec').length,
      };
    })()`);
  }

  async setScenario(id) {
    // v4：设置收进抽屉。测试直接调用与下拉 onChange 同一条 state 路径（S.setScenario → 'scenario' 事件）
    return this.ev(`(async () => {
      const S = await import('/js/lab/state.js');
      S.setScenario(${JSON.stringify(id)});
      return S.scenarioId();
    })()`, { awaitPromise: true });
  }

  async clickRerun() {
    return this.ev(`(() => {
      const b = [...document.querySelectorAll('.lab-rec__bar button')].find((x) => x.textContent.includes('重新穷举'));
      if (!b) return null;
      b.click();
      return { disabled: b.disabled, status: (document.querySelector('.lab-rec__status') || {}).textContent || '' };
    })()`);
  }

  async shot(name) {
    try {
      const { data } = await this.root.send('Page.captureScreenshot', { format: 'png' }, this.sid);
      const file = path.join(TMP, `lab-async-${name}.png`);
      await fs.writeFile(file, Buffer.from(data, 'base64'));
      return file;
    } catch { return ''; }
  }
}

/* ------------------------------ 页面内工具 ------------------------------ */
const GT_JS = `(async () => {
  const model = await (await import('/js/lab/model.js')).loadLabModel();
  const S = await import('/js/lab/state.js');
  const { fmt } = await import('/js/core/dom.js');
  const out = {};
  for (const sc of ['general', 'losomn', 'nerud', 'root']) {
    const en = model.engine.createEnumeration({ picks: S.workbenchPicks(model), scenarioId: sc,
      classTarget: S.classTarget(), top: 300 });
    en.runAll();
    const r = en.result();
    const top = r.top[0];
    out[sc] = {
      score: fmt.pct(top.stats.score, 1), armor: fmt.num(top.stats.armor, 1),
      names: top.ids.map((id) => (model.pieceById.get(id) || {}).zh || id),
      ids: top.ids.slice(), feasible: r.feasible, total: r.total,
    };
  }
  return out;
})()`;

function sigMatch(sig, gt) {
  return !!sig && sig.score === gt.score && sig.armor === gt.armor
    && sig.names.length === gt.names.length && sig.names.join('|') === gt.names.join('|');
}

async function step(id, name, fn) {
  currentId = id;
  try {
    const detail = await fn();
    record(id, name, 'PASS', detail);
  } catch (e) {
    const msg = String((e && e.message) || e);
    const shot = await page.shot(id).catch(() => '');
    record(id, name, 'FAIL', msg + (shot ? `（截图 qa/_tmp/lab-async-${id}.png）` : ''));
  }
}

/* ------------------------------ 主流程 ------------------------------ */
let page = null;

async function main() {
  await fs.mkdir(TMP, { recursive: true });
  const { child, wsUrl, profile } = launchChrome({ width: 1440, height: 1000 });
  let root = null;
  let fatal = null;
  try {
    root = await CDP.connect(await wsUrl, { timeout: 25000 });
    const { targetId } = await root.send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await root.send('Target.attachToTarget', { targetId, flatten: true });
    page = new Page(root, sessionId);
    await root.send('Page.enable', {}, sessionId);
    await root.send('Runtime.enable', {}, sessionId);

    root.on('Runtime.consoleAPICalled', (p, sid) => {
      if (sid !== sessionId) return;
      if (p.type === 'error' || p.type === 'assert') {
        const text = (p.args || []).map((a) => a.value ?? a.description ?? a.type).join(' ');
        page.consoleErrors.push(String(text).slice(0, 300));
      }
    });
    root.on('Runtime.exceptionThrown', (p, sid) => {
      if (sid !== sessionId) return;
      const d = p.exceptionDetails || {};
      page.exceptions.push(String((d.exception && (d.exception.description || d.exception.value)) || d.text || '').slice(0, 300));
    });

    /* --------------------------- T0 基线 --------------------------- */
    let baseline = null;
    let gt = null;
    await step('T0', '#/lab 推荐面板首次穷举完成，记录基线耗时与 ground truth', async () => {
      await page.goto('#/lab', { fresh: true });
      const st = await page.settle();
      const elapsed = Number((st.match(/用时\s*(\d+)\s*毫秒/) || [])[1] || NaN);
      assert(Number.isFinite(elapsed) && elapsed > 0, `状态栏未读到「用时 N 毫秒」：${st.slice(0, 120)}`);
      assert(await page.count('.lab-rec__row') === 10, '首屏候选行数不是 10（PAGE=10）');
      gt = await page.ev(GT_JS, { awaitPromise: true });
      baseline = { elapsed, gt };
      // 填四件护甲，让工作台 .lab-reshead 出现场景名（结果头部断言用）
      await page.ev(`(async () => {
        const { store } = await import('/js/core/store.js');
        const slots = ['head', 'body', 'legs', 'gloves'];
        const ids = ${JSON.stringify(gt.general.ids)};
        slots.forEach((s, i) => store.build.set(s, ids[i]));
      })()`, { awaitPromise: true });
      await page.settle();
      const reshead = await page.ev(`(document.querySelector('.lab-reshead') || {}).textContent || ''`);
      assert(/通用/.test(reshead), `.lab-reshead 未显示当前场景（护甲已填 4 件）：${reshead.slice(0, 120)}`);
      console.log(`[info] 基线：首次穷举用时 ${elapsed}ms；ground truth general=${gt.general.score} losomn=${gt.losomn.score} nerud=${gt.nerud.score} root=${gt.root.score}`);
      return `基线 ${elapsed}ms；reshead=${reshead.trim().slice(0, 60)}`;
    });

    /* --------------------- T1 运行中改条件（A/B） --------------------- */
    await step('T1', '穷举运行中连续改场景 ×2 → 结果/结果头部对应最后一次选择', async () => {
      assert(gt, 'ground truth 未就绪（T0 失败）');
      assert(await page.labState().then((s) => s.scenario) === 'general', '起始场景不是 general');
      // 慢设备等效：4× CPU 降速把 100ms 级穷举拉长到 ~1s，稳定命中「运行中改条件」窗口
      await root.send('Emulation.setCPUThrottlingRate', { rate: 4 }, sessionId);
      const race = await page.ev(`(async () => {
        const S = await import('/js/lab/state.js');
        const btn = [...document.querySelectorAll('.lab-rec__bar button')].find((b) => b.textContent.includes('重新穷举'));
        if (!btn) return { error: 'missing ui' };
        btn.click(); // 同步进入穷举中
        S.setScenario('losomn');
        S.setScenario('nerud');
        return { running: (document.querySelector('.lab-rec__status') || {}).textContent || '', scenario: S.scenarioId() };
      })()`, { awaitPromise: true });
      assert(race && !race.error, `页面竞态脚本失败：${JSON.stringify(race)}`);
      assert(/穷举中/.test(race.running), `点击「重新穷举」后未进入穷举中：${race.running}`);
      assert(race.scenario === 'nerud', `两次场景切换后 select 应为 nerud，实际 ${race.scenario}`);
      const st = await page.settle();
      const state = await page.labState();
      const sig = await page.fsig();
      assert(state.scenario === 'nerud', `最终场景不是 nerud：${state.scenario}`);
      assert(state.rows === 10, `最终候选行数 ${state.rows} ≠ 10`);
      assert(!/穷举中/.test(state.status), `状态栏仍停在穷举中：${state.status.slice(0, 100)}`);
      assert(/用时\s*\d+\s*毫秒/.test(state.status), `状态栏缺少「用时 N 毫秒」：${state.status.slice(0, 120)}`);
      assert(sigMatch(sig, gt.nerud), `最终首行不是 nerud 条件的结果：显示 ${JSON.stringify(sig)}，期望 ${JSON.stringify(gt.nerud)}`);
      assert(!sigMatch(sig, gt.general), `最终结果仍是初始 general 条件（条件被丢弃/旧结果覆盖）：${JSON.stringify(sig)}`);
      assert(/涅鲁德/.test(state.reshead), `.lab-reshead 未对应最后一次选择（应为涅鲁德）：${state.reshead.slice(0, 100)}`);
      // 连续切回同一值（no-op）后结果稳定，不被二次覆盖
      await page.setScenario('nerud');
      await page.settle();
      const again = await page.fsig();
      assert(sigMatch(again, gt.nerud), `恢复同一条件后结果漂移：${JSON.stringify(again)}`);
      await root.send('Emulation.setCPUThrottlingRate', { rate: 1 }, sessionId);
      const elapsed = Number((st.match(/用时\s*(\d+)\s*毫秒/) || [])[1] || NaN);
      console.log(`[info] T1 最终条件 nerud 结果 ${sig.score} / ${sig.armor} / ${sig.names.join('、')}；用时 ${elapsed}ms`);
      return `最终场景 nerud；${sig.score} ${sig.armor}；${sig.names[0]}…`;
    });

    /* --------------------- T2 离开页面（C） --------------------- */
    await step('T2', '穷举运行中离开 #/lab → detached DOM 不再被写、#view-root 静默、无遗留 .lab-rec', async () => {
      await root.send('Emulation.setCPUThrottlingRate', { rate: 1 }, sessionId).catch(() => {});
      // 预热 builds（避免把 builds 首帧 DOM 变更误判为旧任务写入）
      await page.goto('#/builds');
      const warm = await page.waitFor(`document.querySelector('#builds-main') && document.querySelector('#builds-main').textContent.length > 500`, 12000);
      assert(warm, '#/builds 预热失败');
      await sleep(300);
      await page.goto('#/lab');
      await page.settle();
      // 4× 降速：旧实现的 RAF 循环会继续跑 ~1s 以上，足够观察已卸载 DOM 的写入
      await root.send('Emulation.setCPUThrottlingRate', { rate: 4 }, sessionId);
      const prep = await page.ev(`(() => {
        window.__labProbe = { detached: 0, view: 0 };
        const rec = document.querySelector('.lab-rec');
        const rootEl = document.querySelector('#view-root');
        if (!rec || !rootEl) return { error: 'missing dom' };
        new MutationObserver((rs) => { window.__labProbe.detached += rs.length; })
          .observe(rec, { subtree: true, childList: true, characterData: true, attributes: true });
        new MutationObserver((rs) => { window.__labProbe.view += rs.length; })
          .observe(rootEl, { subtree: true, childList: true, characterData: true, attributes: true });
        const btn = [...document.querySelectorAll('.lab-rec__bar button')].find((b) => b.textContent.includes('重新穷举'));
        btn.click();
        location.hash = '#/builds';
        return { status: (document.querySelector('.lab-rec__status') || {}).textContent || '' };
      })()`);
      assert(prep && !prep.error, `离开页面脚本失败：${JSON.stringify(prep)}`);
      const built = await page.waitFor(`document.querySelector('#builds-main') && document.querySelector('#builds-main').textContent.length > 500`, 12000);
      assert(built, '离开后 #/builds 未完成渲染');
      await sleep(250); // 等 builds 自身首帧稳定
      await page.ev(`(() => { window.__labProbe.detached = 0; window.__labProbe.view = 0; })()`);
      await sleep(600); // 观察窗：旧实现此时仍在分帧穷举 / 完成时写 detached DOM
      const probe = await page.ev(`(() => ({
        detached: window.__labProbe.detached,
        view: window.__labProbe.view,
        hash: location.hash,
        labRecVisible: document.querySelectorAll('#view-root .lab-rec').length,
        buildsLen: (document.querySelector('#builds-main') || {}).textContent ? document.querySelector('#builds-main').textContent.length : -1,
      }))()`);
      await root.send('Emulation.setCPUThrottlingRate', { rate: 1 }, sessionId);
      assert(probe.detached === 0, `离开后已卸载的推荐面板仍被写入：detached 子树 600ms 内变更 ${probe.detached} 次（RAF 未取消）`);
      assert(probe.view === 0, `离开后 #view-root 600ms 内仍有 ${probe.view} 次 DOM 变更（旧任务回写新页面）`);
      assert(probe.labRecVisible === 0, `#/builds 下仍存在可见的 .lab-rec 节点 ${probe.labRecVisible} 个`);
      assert(/^#\/builds/.test(probe.hash), `离开后 hash 被旧任务改写：${probe.hash}`);
      assert(probe.buildsLen > 500, '#/builds 内容丢失');
      return `detached=${probe.detached} view=${probe.view} hash=${probe.hash}`;
    });

    /* --------------------- T3 非 active 面板 dirty/activate --------------------- */
    await step('T3', '切换面板后改条件 → 切回推荐面板时结果对应最后一次条件（activate/dirty 语义）', async () => {
      await page.goto('#/lab');
      await page.settle();
      await page.ev(`(() => { const b = document.querySelector('.seg__btn[data-panel="replace"]'); if (b) b.click(); })()`);
      await sleep(250);
      assert(await page.waitFor(`document.querySelector('.lab-panel[data-panel="replace"]:not([hidden])')`, 4000), '未切到逐槽替换面板');
      const before = await page.labState();
      await page.setScenario('root');
      await sleep(600);
      const mid = await page.labState();
      assert(!/穷举中/.test(mid.status), `非 active 面板不应自己启动穷举：${mid.status.slice(0, 80)}`);
      assert(mid.rows === before.rows, `非 active 时面板行数不应变化（${before.rows} → ${mid.rows}）`);
      await page.ev(`(() => { const b = document.querySelector('.seg__btn[data-panel="recommend"]'); if (b) b.click(); })()`);
      await page.settle();
      const sig = await page.fsig();
      assert(sigMatch(sig, gt.root), `切回推荐面板后未按最后一次条件（root）补算：${JSON.stringify(sig)} 期望 ${JSON.stringify(gt.root)}`);
      return `${before.rows} 行保持 → 切回补算 root=${sig.score}`;
    });

    /* --------------------- T4 完成回调重入稳定性 --------------------- */
    await step('T4', '穷举完成后静置 1.2s：无重复启动 / DOM 零变更 / hash 稳定', async () => {
      await page.settle();
      await page.ev(`(() => {
        window.__labQuiet = { mut: 0 };
        const rec = document.querySelector('.lab-rec');
        if (rec) new MutationObserver((rs) => { window.__labQuiet.mut += rs.length; })
          .observe(rec, { subtree: true, childList: true, characterData: true, attributes: true });
      })()`);
      const before = await page.labState();
      await sleep(1200);
      const quiet = await page.ev(`window.__labQuiet || { mut: -1 }`);
      const after = await page.labState();
      assert(quiet.mut === 0, `静置 1.2s 内推荐面板仍发生 ${quiet.mut} 次 DOM 变更（疑似重入无限重启/闪烁）`);
      assert(!/穷举中/.test(after.status), `静置期间又进入穷举（重入重启）：${after.status.slice(0, 100)}`);
      assert(after.status === before.status, `状态栏文本漂移：${before.status.slice(0, 80)} → ${after.status.slice(0, 80)}`);
      assert(after.hash === before.hash, `hash 漂移：${before.hash} → ${after.hash}`);
      assert(after.hash === '#/lab', `hash 被写成 ${after.hash}（不应累积 query）`);
      assert(after.rows === 10, `行数 ${after.rows} ≠ 10`);
      return `静置 1.2s 零变更，hash=${after.hash}`;
    });

    /* --------------------- T5 耗时相对基线 --------------------- */
    await step('T5', '单次穷举耗时相对基线无显著退化（状态栏「用时」）', async () => {
      assert(baseline, '基线未就绪（T0 失败）');
      await page.settle();
      const click = await page.clickRerun();
      assert(click && !click.disabled, `「重新穷举」按钮不可点击：${JSON.stringify(click)}`);
      const st = await page.settle();
      const elapsed = Number((st.match(/用时\s*(\d+)\s*毫秒/) || [])[1] || NaN);
      assert(Number.isFinite(elapsed), `未读到用时：${st.slice(0, 120)}`);
      const ratio = elapsed / baseline.elapsed;
      assert(ratio < 2.0 + 0.0001, `耗时退化：基线 ${baseline.elapsed}ms → 本次 ${elapsed}ms（${ratio.toFixed(2)}×，阈值 2.0×）`);
      console.log(`[info] 性能对比：基线 ${baseline.elapsed}ms → 本次 ${elapsed}ms（${ratio.toFixed(2)}×；同机同条件，噪声约 ±30%）`);
      return `${baseline.elapsed}ms → ${elapsed}ms（${ratio.toFixed(2)}×）`;
    });

    /* --------------------- T6 onStep 抛错：失败态与恢复 --------------------- */
    await step('T6', 'onStep 抛错 → 显示失败态、不卡死；改条件后可重试', async () => {
      await page.settle();
      const inj = await page.ev(`(() => {
        window.__labOrigNow = performance.now.bind(performance);
        window.__labNowCalls = 0;
        // 第 1 次给 createEnumeration，第 2 次给 start() 的 t0，第 3 次起在 en.step 内抛错 → 命中 onStep
        performance.now = () => { window.__labNowCalls += 1;
          if (window.__labNowCalls > 2) throw new Error('INJECTED_BOOM');
          return window.__labOrigNow(); };
        const btn = [...document.querySelectorAll('.lab-rec__bar button')].find((b) => b.textContent.includes('重新穷举'));
        if (!btn) return { error: 'no button' };
        btn.click();
        return { ok: true, calls: window.__labNowCalls };
      })()`);
      assert(inj && inj.ok, `注入脚本失败：${JSON.stringify(inj)}`);
      await sleep(900); // 让分帧 tick 执行到抛错点（正常 ~16ms 一帧）
      await page.ev(`(() => { if (window.__labOrigNow) performance.now = window.__labOrigNow; })()`);
      const state = await page.labState();
      const calls = await page.ev(`window.__labNowCalls || 0`);
      assert(calls >= 3, `注入未走到 onStep（performance.now 仅调用 ${calls} 次），本用例无效`);
      assert(/失败/.test(state.status), `onStep 抛错后未显示失败态（卡在）：${state.status.slice(0, 160)}`);
      assert(!/穷举中/.test(state.status), `onStep 抛错后仍卡在「穷举中」：${state.status.slice(0, 120)}`);
      assert(state.button && !state.button.disabled, '失败后「重新穷举」按钮仍被禁用，无法重试');
      // 条件变化应能重试
      await page.setScenario('losomn');
      const st = await page.settle();
      const sig = await page.fsig();
      assert(/用时\s*\d+\s*毫秒/.test(st), `恢复后状态栏未显示成功：${st.slice(0, 120)}`);
      assert(sigMatch(sig, gt.losomn), `恢复后结果不是 losomn 条件：${JSON.stringify(sig)}`);
      return `失败态可读；losomn 重试成功（${sig.score}）`;
    });

    /* --------------------- T7 全程 console/异常门禁 --------------------- */
    await step('T7', '全程无 console error / 无未捕获异常（注入异常除外）', async () => {
      const errors = page.consoleErrors.filter((e) => !/INJECTED_BOOM/.test(e));
      const exceptions = page.exceptions.filter((e) => !/INJECTED_BOOM/.test(e));
      assert(errors.length === 0, `console error ${errors.length} 条：${errors.slice(0, 3).join(' | ')}`);
      assert(exceptions.length === 0, `未捕获异常 ${exceptions.length} 条：${exceptions.slice(0, 3).join(' | ')}`);
      return `console error=0；未捕获异常=0（另过滤注入异常 ${page.exceptions.length - exceptions.length} 条）`;
    });
  } catch (e) {
    fatal = e;
    console.error('[lab-async] 致命错误:', e && e.stack ? e.stack : e);
  } finally {
    try { root?.close(); } catch { /* ignore */ }
    cleanupChrome({ child, profile });
  }

  const fails = results.filter((r) => r.status === 'FAIL');
  const pass = results.filter((r) => r.status === 'PASS');
  console.log(`\n[lab-async] PASS=${pass.length} FAIL=${fails.length} TOTAL=${results.length}`);
  if (fails.length) {
    console.log('[lab-async] 失败项：');
    for (const f of fails) console.log(`  - ${f.id} ${f.name}：${f.detail.slice(0, 240)}`);
  }
  if (fatal) return 2;
  return fails.length ? 1 : 0;
}

main().then((code) => { process.exitCode = code; }).catch((e) => {
  console.error('[lab-async] 未捕获:', e && e.stack ? e.stack : e);
  process.exitCode = 2;
});
