/* =============================================================================
   qa/gate/registry.mjs — 检查清单（唯一来源）
   每个检查声明：怎么跑（run）、怎么判读（parse）、需要什么环境（requires/server）、
   失败该看哪里（module/hint/repro/artifacts）、预计成本（cost）。
   新增一个测试 = 在这里加一项，不需要改入口逻辑与文档的多处命令列表。

   注意：这里只做「调度 + 归一到 PASS/FAIL/SKIP」，不重新实现任何断言逻辑；
   真正的测试仍在 qa/tests、qa/shot.js、qa/interactions.js、qa/audit.py、pipeline/*。
   ========================================================================== */

import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT as ROOT } from './env.mjs';
import {
  parseNodeTest, parseUnittest, parseCounts, readJsonSafe, rel,
} from './report.mjs';

/** 工具函数：python / node 命令 */
const py = (ctx, args) => ({ command: ctx.python.cmd, args: [...ctx.python.args, ...args] });
const node = (args) => ({ command: process.execPath, args });

/** 读取一个 JSON 产物；不存在返回 null（多数场景说明脚本没跑到产出步骤） */
const artifact = (ctx, p) => readJsonSafe(path.join(ctx.repoRoot, p));

const relPath = (ctx, p) => rel(ctx.repoRoot, path.join(ctx.repoRoot, p));

/* ------------------------------ 通用检查模板 ------------------------------ */
/** 纯命令检查：只看退出码（可选再读产物补充统计） */
function commandCheck({
  id, label, kind = 'static', requires = [], server = null, cost = 'fast', timeout = 180000,
  module, hint, repro, artifacts = [], result = 'exit', baseline = null, optional = false,
  build,
}) {
  return {
    id, label, kind, requires, server, cost, timeout, module, hint, repro, artifacts,
    baseline, optional, result, build,
    run: build,
  };
}

/** node --test 检查（TAP 解析） */
function nodeTestCheck({ id, label, kind = 'unit', target = '"qa/tests/*.test.mjs"', module, hint, repro, cost = 'fast', baseline = null }) {
  const targetArg = target.replace(/^"|"$/g, '');
  return {
    id, label, kind, requires: [], server: null, cost,
    timeout: 300000, module, hint, repro, artifacts: [],
    baseline, optional: false,
    run: () => node(['--test', '--test-reporter=tap', targetArg]),
    parse: ({ stdout }) => {
      const parsed = parseNodeTest(stdout);
      return parsed ? { ...parsed, note: parsed.fail ? '' : `${parsed.pass} 项` } : null;
    },
  };
}

/* ------------------------------- 静态 / 单元 ------------------------------- */
const unitJs = nodeTestCheck({
  id: 'unit-js',
  label: 'JS 单元 + 架构守卫',
  target: 'qa/tests/*.test.mjs',
  module: 'js/** + qa/tests/*.test.mjs',
  hint: '失败用例名通常直接对应源文件（router/store/query/architecture…）；先单独复跑该文件',
  repro: 'node --test --test-reporter=spec qa/tests/*.test.mjs',
  baseline: { min_pass: 69, max_skip: 0 },
});

const unitPy = {
  id: 'unit-py', label: 'Python 单元（数据脚本）', kind: 'unit', requires: ['python'], server: null,
  cost: 'fast', timeout: 180000, module: 'pipeline/sync-data.py · mk_builds_json.py',
  hint: '看 FAIL/ERROR 行里的测试方法名与断言；数据脚本用例在 qa/tests/test_*.py',
  repro: 'python -m unittest discover -s qa/tests -p "test_*.py" -v',
  artifacts: [], baseline: null, optional: false,
  run: (ctx) => py(ctx, ['-m', 'unittest', 'discover', '-s', 'qa/tests', '-p', 'test_*.py']),
  parse: ({ stdout, stderr }) => {
    const parsed = parseUnittest(`${stdout}\n${stderr}`);
    return parsed ? { ...parsed, note: parsed.fail ? '' : `${parsed.pass} 项` } : null;
  },
};

const audit = {
  id: 'audit', label: '静态审计（色值/文案/a11y）', kind: 'static', requires: ['python'], server: null,
  cost: 'fast', timeout: 120000, module: 'css/ · js/views/ · js/lab/ · index.html',
  hint: 'audit 输出带 file:line：先改 FAIL（硬编码色/裸英文/重复标题/a11y），WARN 可评估后再决定',
  repro: 'python qa/audit.py',
  artifacts: ['qa/results/audit.json'], baseline: { min_pass: 1, max_skip: 0 }, optional: false,
  run: (ctx) => py(ctx, ['qa/audit.py', '--quiet']),
  parse: ({ code, ctx }) => {
    const j = artifact(ctx, 'qa/results/audit.json');
    const s = j && j.summary;
    if (!s) return { total: 1, pass: code === 0 ? 1 : 0, fail: code === 0 ? 0 : 1, skip: 0, failed: [] };
    const total = (s.fail || 0) + (s.warn || 0) + (s.info || 0);
    return {
      total, pass: total - (s.fail || 0), fail: s.fail || 0, skip: 0,
      failed: (j.items || []).filter((i) => i.severity === 'FAIL').slice(0, 20)
        .map((i) => `${i.title} @ ${i.file}${i.line ? `:${i.line}` : ''}`),
      note: `FAIL=${s.fail} WARN=${s.warn} INFO=${s.info}`,
    };
  },
};

const contrast = {
  id: 'contrast', label: '双主题 WCAG 对比度', kind: 'static', requires: [], server: null,
  cost: 'fast', timeout: 60000, module: 'css/tokens.css',
  hint: '按输出里的 token 对（fg × bg）查 tokens.css 对应变量；两套主题都要 ≥ AA',
  repro: 'node qa/theme-contrast.mjs',
  artifacts: [], baseline: { min_pass: 1, max_skip: 0 }, optional: false,
  run: () => node(['qa/theme-contrast.mjs']),
  parse: ({ code, stdout }) => {
    const m = String(stdout || '').match(/合计 (\d+) 项[^：]*：PASS (\d+)，FAIL (\d+)/);
    if (!m) return { total: 1, pass: code === 0 ? 1 : 0, fail: code === 0 ? 0 : 1, skip: 0, failed: [] };
    return { total: Number(m[1]), pass: Number(m[2]), fail: Number(m[3]), skip: 0, failed: [], note: `FAIL=${m[3]}` };
  },
};

/* --------------------------------- 数据 ---------------------------------- */
const dataBuilds = {
  id: 'data-builds', label: '流派数据引用完整性', kind: 'data', requires: ['python'], server: null,
  cost: 'fast', timeout: 120000, module: 'pipeline/_source/{ui_data,loadouts,builds}.json → data/builds.json',
  hint: '--check 会逐条列出坏引用（item id 找不到且未在 i18n 登记）；不要手改 data/builds.json',
  repro: 'python pipeline/mk_builds_json.py --check',
  artifacts: [], baseline: { min_pass: 1, max_skip: 0 }, optional: false,
  run: (ctx) => py(ctx, ['pipeline/mk_builds_json.py', '--check']),
  parse: ({ code, stdout }) => ({
    total: 1, pass: code === 0 ? 1 : 0, fail: code === 0 ? 0 : 1, skip: 0,
    failed: code === 0 ? [] : [String(stdout || '').trim().split('\n').slice(-6).join(' / ')],
  }),
};

const dataSchema = nodeTestCheck({
  id: 'data-schema',
  label: '数据 Schema 与引用契约',
  kind: 'data',
  target: 'qa/tests/data-schema.test.mjs',
  module: 'data/*.json + qa/lib/data-schema.mjs',
  hint: '失败会带 文件 + JSON Pointer（/items/12/id）：直接定位到具体条目；契约变更要同步 data-schema.mjs',
  repro: 'node --test --test-reporter=spec qa/tests/data-schema.test.mjs',
  baseline: { min_pass: 5, max_skip: 0 },
});

const dataSync = {
  id: 'data-sync', label: '上游工作区数据漂移（只读）', kind: 'data', requires: ['python', 'workspace'], server: null,
  cost: 'medium', timeout: 180000, module: '上游 .mimocode/data/* → data/*.json',
  hint: '漂移说明仓库快照与工作区不一致：先确认工作区数据是否已更新，再走 sync-data.py 同步流程（见 docs/DATA.md §4）',
  repro: 'python pipeline/sync-data.py --check',
  artifacts: [], baseline: null, optional: true,
  run: (ctx) => py(ctx, ['pipeline/sync-data.py', '--check']),
  parse: ({ code, stdout }) => ({
    total: 1, pass: code === 0 ? 1 : 0, fail: code === 0 ? 0 : 1, skip: 0,
    failed: code === 0 ? [] : [String(stdout || '').trim().split('\n').slice(-8).join(' / ')],
    note: code === 0 ? '无漂移' : '有漂移',
  }),
};

/* --------------------------------- 浏览器 -------------------------------- */
/** 截图检查：读 qa/shots/_summary.json；期望条数由真实路由推导（防静默丢路由） */
function shotCheck({ id, theme, extraArgs = [], server = 'root', label, module, cost = 'medium', baseline = null, note = '' }) {
  return {
    id, label, kind: 'browser', requires: ['chrome'], server, cost,
    timeout: 900000, module,
    hint: '先看 qa/shots/_summary.json 里失败路由的 errors（console / exception / HTTP / failed request），按 url 定位资源',
    repro: `node qa/shot.js --theme ${theme} --base <gate 启动的地址>`,
    artifacts: ['qa/shots/_summary.json'], baseline, optional: false, note,
    run: (ctx) => node(['qa/shot.js', '--theme', theme, '--base', ctx.base, ...extraArgs]),
    async parse({ ctx }) {
      const j = artifact(ctx, 'qa/shots/_summary.json');
      if (!j) return { total: 0, pass: 0, fail: 1, skip: 0, failed: ['未生成 qa/shots/_summary.json'] };
      let expected = null;
      try {
        const { deriveRoutes } = await import('../lib/routes.mjs');
        if (typeof deriveRoutes === 'function') {
          let routes = await deriveRoutes(ctx.base);
          // 与 shot.js 的 --only 语义保持一致（包含匹配），否则子集检查的期望条数会算多
          const onlyIdx = extraArgs.indexOf('--only');
          if (onlyIdx >= 0) {
            const pats = String(extraArgs[onlyIdx + 1] || '').split(',').map((x) => x.trim()).filter(Boolean);
            if (pats.length) routes = routes.filter((r) => pats.some((pat) => r.name.includes(pat)));
          }
          const viewports = extraArgs.includes('--desktop-only') || extraArgs.includes('--mobile-only') ? 1 : 2;
          expected = routes.length * viewports;
        }
      } catch { /* 路由推导不可用时不强求条数，仍看 pass/fail */ }
      const result = {
        total: j.total ?? (j.pass || 0) + (j.fail || 0),
        pass: j.pass || 0,
        fail: j.fail || 0,
        skip: 0,
        expected_total: expected,
        failed: (j.results || []).filter((r) => !r.ok).slice(0, 12).map((r) => {
          const errs = r.errors || {};
          const detail = ['console', 'exceptions', 'http', 'failed']
            .map((k) => ((errs[k] || []).length ? `${k}=${errs[k].length}` : '')).filter(Boolean).join(' ');
          return `${r.name}@${r.viewport}${detail ? ` ${detail}` : ''}`;
        }),
        note: `${theme}${extraArgs.includes('--desktop-only') ? ' 桌面' : ''}`,
      };
      return result;
    },
  };
}

const shotDark = shotCheck({
  id: 'shot-dark', theme: 'dark', label: '截图 + 错误门禁（暗色）',
  module: 'js/views/** + css/ + data/（路由与资源）',
});
const shotLight = shotCheck({
  id: 'shot-light', theme: 'light', label: '截图 + 错误门禁（亮色）',
  module: 'js/views/** + css/ + data/（路由与资源）',
});
const shotSubpath = shotCheck({
  id: 'shot-subpath', theme: 'dark', label: 'GitHub Pages 子路径资源（暗色·桌面）',
  server: 'prefixed', extraArgs: ['--desktop-only', '--only', 'items,builds,codex,lab'],
  module: 'js/core/api.js（相对路径）· css/url() · assets',
  note: '子路径',
});

/** 交互检查：读 qa/results/interactions.json；area 过滤用于 related 模式的低成本回归 */
function interactionsCheck({ id, label, area = null, module, baseline = { min_pass: 1, max_skip: 0 }, cost = 'slow' }) {
  const args = (ctx) => ['qa/interactions.js', '--base', ctx.base, ...(area ? ['--only', area] : [])];
  return {
    id, label, kind: 'browser', requires: ['chrome'], server: 'root', cost,
    timeout: 900000, module,
    hint: '按失败行首的 area/id（如 [items] I3）定位断言；qa/shots/interact-*.png 是当时的界面证据',
    repro: `node qa/interactions.js --base <gate 启动的地址>${area ? ` --only ${area}` : ''}`,
    artifacts: ['qa/results/interactions.json'], baseline, optional: false,
    run: (ctx) => node(args(ctx)),
    parse({ ctx }) {
      const j = artifact(ctx, 'qa/results/interactions.json');
      if (!j) return { total: 0, pass: 0, fail: 1, skip: 0, failed: ['未生成 qa/results/interactions.json'] };
      const rows = j.results || [];
      return {
        total: j.total ?? rows.length, pass: j.pass || 0, fail: j.fail || 0, skip: j.skip || 0,
        failed: rows.filter((r) => r.status === 'FAIL').slice(0, 12).map((r) => `[${r.area}] ${r.id} ${r.name} — ${String(r.detail || '').slice(0, 120)}`),
        note: rows.length ? '' : '未读到用例',
      };
    },
  };
}

const interactions = interactionsCheck({
  id: 'interactions',
  label: '真实交互验收（67 项）',
  module: 'js/views/** + js/components/** + js/core/ui.js',
  baseline: { min_pass: 67, max_skip: 0 },
});

/** 浏览器回归脚本（lifecycle / lab-async / components / navigation） */
function browserScriptCheck({
  id, label, script, module, hint, repro = '', cost = 'medium', baseline = { min_pass: 1, max_skip: 0 },
  server = 'root', pattern = /PASS\s*[=:]\s*(\d+)/, resultFile = null, countsFrom = 'stdout',
}) {
  return {
    id, label, kind: 'browser', requires: ['chrome'], server, cost,
    timeout: 900000, module, hint, repro, artifacts: resultFile ? [resultFile] : [], baseline, optional: false,
    run: (ctx) => ({
      command: process.execPath, args: [script, '--base', ctx.base],
      env: { QA_BASE: ctx.base },
    }),
    parse({ code, stdout, ctx }) {
      if (resultFile) {
        const j = artifact(ctx, resultFile);
        if (j) {
          const fail = j.fail ?? (j.rows || []).filter((r) => r.status === 'FAIL').length;
          const pass = j.pass ?? (j.rows || []).filter((r) => r.status === 'PASS').length;
          const skip = j.skip ?? j.pend ?? (j.rows || []).filter((r) => r.status === 'SKIP' || r.status === 'PEND').length;
          return {
            total: j.total ?? (j.rows || []).length, pass, fail, skip,
            failed: (j.rows || []).filter((r) => r.status === 'FAIL').slice(0, 10).map((r) => `${r.id} ${r.name || ''} — ${String(r.detail || '').slice(0, 140)}`),
          };
        }
      }
      const parsed = parseCounts(stdout);
      if (parsed) return { ...parsed, failed: [] };
      return { total: 1, pass: code === 0 ? 1 : 0, fail: code === 0 ? 0 : 1, skip: 0, failed: [] };
    },
  };
}

const lifecycle = browserScriptCheck({
  id: 'lifecycle', label: '页面生命周期与竞态（G1–G11）', script: 'qa/tests/lifecycle.browser.mjs',
  module: 'js/main.js · js/core/router.js · js/core/store.js · 视图 unmount',
  hint: 'PEND/FAIL 行里带 Gx 用例号；G1/G5 看 dispatch 代际，G10 看 store 损坏恢复',
  resultFile: 'qa/_tmp/lifecycle-result.json',
  baseline: { min_pass: 20, max_skip: 2 },
});

const labAsync = browserScriptCheck({
  id: 'lab-async', label: '实验室分帧计算竞态（T1–T7）', script: 'qa/tests/lab-async.browser.mjs',
  module: 'js/views/lab.js · js/lab/recommend.js · js/core/task.js',
  hint: 'T1/T2 失败多是代际版本控制或卸载取消没做好；T7 是全程 console 门禁',
  baseline: { min_pass: 7, max_skip: 0 },
});

const components = browserScriptCheck({
  id: 'components', label: '共享组件行为契约', script: 'qa/tests/components.browser.mjs',
  module: 'js/components/states.js · js/components/panel.js · js/core/dom.js',
  hint: '组件契约测试失败说明共享组件结构/语义被改；先看断言里的选择器与文本',
  baseline: { min_pass: 10, max_skip: 0 },
});

const navigation = browserScriptCheck({
  id: 'nav', label: '路由竞态/深链/卸载清理', script: 'qa/tests/navigation.browser.mjs',
  module: 'js/main.js · js/core/router.js · js/domains.js · js/views/library.js（详情 URL）',
  hint: 'N1/N2 失败看 dispatch 代际与 syncQuery；N3 看详情 URL 归属；N6 看卸载清理',
  baseline: { min_pass: 6, max_skip: 1 },
});

const navSubpath = {
  ...navigation,
  id: 'nav-subpath',
  label: '路由/深链/子路径（Pages 等价）',
  server: 'prefixed',
  note: '子路径',
  baseline: { min_pass: 3, max_skip: 1 },
  run: (ctx) => {
    const target = ctx.prefixBase || ctx.base;
    return { command: process.execPath, args: ['qa/tests/navigation.browser.mjs', '--base', target], env: { QA_BASE: target } };
  },
};

/* --------------------------------- 发布 ---------------------------------- */
const deployPreflight = {
  id: 'deploy-preflight', label: '发布预检（分支/工作树/远端）', kind: 'deploy', requires: ['python'], server: null,
  cost: 'fast', timeout: 180000, module: 'pipeline/deploy.py',
  hint: '预检失败会直说哪一步（2 预检/3 推送/5 sha）：先 git status / 切回 main 再发布',
  repro: 'python pipeline/deploy.py --dry-run',
  artifacts: [], baseline: null, optional: false,
  run: (ctx) => py(ctx, ['pipeline/deploy.py', '--dry-run']),
  parse: ({ code, stdout }) => ({
    total: 1, pass: code === 0 ? 1 : 0, fail: code === 0 ? 0 : 1, skip: 0,
    failed: code === 0 ? [] : [String(stdout || '').trim().split('\n').slice(-8).join(' / ')],
  }),
};

/* -------------------------------- 汇总导出 -------------------------------- */
export const CHECKS = {
  // 静态 / 单元（无浏览器，所有环境都能跑）
  'unit-js': unitJs,
  'unit-py': unitPy,
  audit,
  contrast,
  // 数据
  'data-builds': dataBuilds,
  'data-schema': dataSchema,
  'data-sync': dataSync,
  // 浏览器
  'shot-dark': shotDark,
  'shot-light': shotLight,
  'shot-subpath': shotSubpath,
  interactions,
  'interactions-items': interactionsCheck({
    id: 'interactions-items', label: '交互回归·资料库', area: 'items', cost: 'medium',
    module: 'js/views/library.js · js/library/** · js/components/item-detail*.js',
    baseline: null,
  }),
  'interactions-lab': interactionsCheck({
    id: 'interactions-lab', label: '交互回归·实验室', area: 'lab', cost: 'medium',
    module: 'js/views/lab.js · js/lab/**',
    baseline: null,
  }),
  'interactions-builds': interactionsCheck({
    id: 'interactions-builds', label: '交互回归·流派', area: 'builds', cost: 'medium',
    module: 'js/views/builds.js · js/builds/**',
    baseline: null,
  }),
  'interactions-codex': interactionsCheck({
    id: 'interactions-codex', label: '交互回归·知识库', area: 'codex', cost: 'medium',
    module: 'js/views/codex.js · data/codex/index.json',
    baseline: null,
  }),
  'interactions-global': interactionsCheck({
    id: 'interactions-global', label: '交互回归·全站（主题/计数/控制台）', area: 'global', cost: 'medium',
    module: 'js/main.js · js/core/ui.js · js/core/theme.js · js/core/store.js',
    baseline: null,
  }),
  lifecycle,
  'lab-async': labAsync,
  components,
  nav: navigation,
  'nav-subpath': navSubpath,
  // 发布
  'deploy-preflight': deployPreflight,
};

/** 检查的展示顺序（快 → 慢，失败要尽早暴露） */
export const CHECK_ORDER = [
  'unit-js', 'unit-py', 'audit', 'contrast', 'data-builds', 'data-schema', 'data-sync',
  'shot-dark', 'shot-light', 'shot-subpath', 'interactions', 'interactions-items', 'interactions-lab',
  'interactions-builds', 'interactions-codex', 'interactions-global',
  'lifecycle', 'lab-async', 'components', 'nav', 'nav-subpath',
  'deploy-preflight',
];

export function getCheck(id) {
  return CHECKS[id] || null;
}

export function checkIds() {
  return CHECK_ORDER.filter((id) => CHECKS[id]);
}

/** 该检查需要的产物/日志路径（失败时附在报告里） */
export function artifactsOf(check, ctx) {
  const list = [...(check.artifacts || []), `qa/results/logs/${check.id}.log`];
  return list.filter((p) => fs.existsSync(path.join(ctx.repoRoot, p)) || p.endsWith('.log'));
}

export { ROOT };
