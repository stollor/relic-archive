#!/usr/bin/env node
/* =============================================================================
   遗迹2 · 遗物档案 — 统一验收门禁（零依赖 / Node 22+）

   一条命令替代原来的一长串验收命令；自动起本地服务器、按环境跳过并说明原因、
   输出机器可读 JSON + 中文摘要 + 失败定位（模块/日志/复跑命令）。

   用法：
     node qa/gate.mjs quick               # 快速：单元 + 静态 + 数据契约（无浏览器，<10s）
     node qa/gate.mjs related             # 按 git 改动文件跑相关回归（默认 quick 基线 + 增量）
     node qa/gate.mjs full                # 完整回归（真实 Chrome：截图/交互/竞态/子路径）
     node qa/gate.mjs data                # 数据链路（Schema/引用/同步/脚本单测）
     node qa/gate.mjs deploy              # 发布前：full + deploy.py 预检（不推送）
     node qa/gate.mjs list                # 看本轮会跑哪些检查
     node qa/gate.mjs full --only nav,components
     node qa/gate.mjs related --changed origin/main
     node qa/gate.mjs quick --verbose
     node qa/gate.mjs full --update-baseline   # 有意增减用例后更新 qa/baselines.json

   退出码：0 全部通过；1 有检查失败；2 用法/致命错误；3 关键检查因环境不具备被跳过
   产物：qa/results/gate.json（机器可读）、qa/results/logs/<id>.log（逐检查日志）
   ========================================================================== */

import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';

import { REPO_ROOT, collectEnv, detectPython, ManagedServer, changedFiles, missingRequirements } from './gate/env.mjs';
import { CHECKS, CHECK_ORDER, checkIds } from './gate/registry.mjs';
import { MODE_CHECKS, MODE_DESC, MODULE_CHECKS, planRelated, sortIds } from './gate/plan.mjs';
import {
  STATUS, renderHeader, renderCheckLine, renderFailures, renderVerdict, tailLines, rel,
} from './gate/report.mjs';

process.chdir(REPO_ROOT);

const BASELINE_PATH = 'qa/baselines.json';
const DEFAULT_JSON = 'qa/results/gate.json';
const PREFIX = '/relic-archive';

/* ------------------------------- 参数解析 ------------------------------- */
function parseArgs(argv) {
  const opts = {
    mode: null, json: DEFAULT_JSON, only: null, skip: null, base: null, prefixBase: null,
    changed: undefined, module: null, verbose: false, updateBaseline: false,
    allowMissingChrome: false, list: false, help: false, timeoutScale: 1,
  };
  const die = (msg) => { console.error(`[gate] ${msg}`); printHelp(); process.exit(2); };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '-h' || a === '--help') opts.help = true;
    else if (a === '--list') opts.list = true;
    else if (a === '--json') opts.json = argv[++i];
    else if (a === '--only') opts.only = argv[++i];
    else if (a === '--skip') opts.skip = argv[++i];
    else if (a === '--base') opts.base = argv[++i];
    else if (a === '--prefix-base') opts.prefixBase = argv[++i];
    else if (a === '--module') opts.module = argv[++i];
    else if (a === '--verbose' || a === '-v') opts.verbose = true;
    else if (a === '--update-baseline') opts.updateBaseline = true;
    else if (a === '--allow-missing-chrome') opts.allowMissingChrome = true;
    else if (a === '--changed') {
      const next = argv[i + 1];
      opts.changed = next && !next.startsWith('-') ? (i += 1, next) : 'HEAD';
    } else if (a === '--timeout-scale') {
      const v = Number(argv[++i]);
      if (!Number.isFinite(v) || v <= 0) die('--timeout-scale 需要正数');
      opts.timeoutScale = v;
    } else if (a.startsWith('-')) die(`未知选项：${a}`);
    else if (a === 'list') opts.list = true;
    else if (!opts.mode) opts.mode = a;
    else die(`多余参数：${a}（模式只接受一个）`);
  }
  return opts;
}

function printHelp() {
  console.log([
    '遗迹2 · 遗物档案 — 统一验收门禁',
    '',
    '用法：node qa/gate.mjs <mode> [选项]',
    '',
    '模式：',
    ...Object.entries(MODE_DESC).map(([k, v]) => `  ${k.padEnd(9)} ${v}`),
    '',
    '常用选项：',
    '  --list              列出该模式会跑的检查（id/说明/成本/环境要求）',
    '  --only a,b          只跑指定检查（覆盖模式）',
    '  --skip a,b          排除指定检查',
    '  --base <url>        复用已在运行的站点（默认 gate 自动起 serve.py）',
    '  --prefix-base <url> 复用已运行、带子路径的站点（默认自动起 --prefix /relic-archive）',
    '  --changed [ref]     related 的改动基准（默认 git status 全部改动；可写 origin/main）',
    '  --module a,b        related 直接指定模块标签（不读 git）',
    '  --allow-missing-chrome  缺 Chrome 时把浏览器检查降级为「允许跳过」（默认算环境阻断）',
    '  --update-baseline   跑完后把通过数写入 qa/baselines.json（有意增减用例时用）',
    '  --timeout-scale n   放大/缩小各检查超时（慢机器用 2）',
    '  --verbose           实时打印每个检查的输出',
    '',
    '退出码：0 通过 · 1 有失败 · 2 用法错误 · 3 关键检查环境不具备',
    '',
    '示例：',
    '  node qa/gate.mjs quick                     # 改完代码先跑这个',
    '  node qa/gate.mjs related                   # 按改动自动选相关回归',
    '  node qa/gate.mjs full                      # 提交前 / 发布前',
    '  node qa/gate.mjs deploy                    # 发布前一键（含 deploy 预检）',
    '  PowerShell：.\\verify.ps1 quick            # 同一入口的 Windows 包装',
  ].join('\n'));
}

/* --------------------------------- 主流程 -------------------------------- */
const opts = parseArgs(process.argv.slice(2));
if (opts.help) { printHelp(); process.exit(0); }
if (opts.mode && !MODE_DESC[opts.mode]) {
  console.error(`[gate] 未知模式：${opts.mode}\n可选：${Object.keys(MODE_DESC).join(' / ')}`);
  process.exit(2);
}
const MODE = opts.mode || 'quick';

/* ------------------------------ 选检查清单 ------------------------------ */
function resolvePlan() {
  let ids;
  let modules = null;
  let files = null;
  if (MODE === 'related') {
    modules = opts.module ? String(opts.module).split(',').map((s) => s.trim()).filter(Boolean) : null;
    files = modules ? [] : changedFiles(opts.changed ?? null);
    if (modules) {
      ids = [...MODE_CHECKS.quick];
      for (const tag of modules) for (const id of MODULE_CHECKS[tag] || []) ids.push(id);
    } else {
      const planned = planRelated(files);
      ids = planned.ids;
      if (!files.length) {
        // 没有可识别改动：保留 quick 基线，并在报告里说明
        modules = [];
      } else {
        modules = planned.tags;
      }
    }
  } else {
    ids = [...MODE_CHECKS[MODE]];
  }
  if (opts.only) {
    const wanted = String(opts.only).split(',').map((s) => s.trim()).filter(Boolean);
    const unknown = wanted.filter((id) => !CHECKS[id]);
    if (unknown.length) {
      console.error(`[gate] 未知检查 id：${unknown.join(', ')}\n可用：${checkIds().join(', ')}`);
      process.exit(2);
    }
    // --only 保留模式内的相对顺序：先按注册表顺序，再补模式外的 id
    const inMode = new Set(ids);
    ids = [
      ...CHECK_ORDER.filter((id) => wanted.includes(id) && inMode.has(id)),
      ...CHECK_ORDER.filter((id) => wanted.includes(id) && !inMode.has(id)),
    ];
  }
  if (opts.skip) {
    const drop = new Set(String(opts.skip).split(',').map((s) => s.trim()).filter(Boolean));
    ids = ids.filter((id) => !drop.has(id));
  }
  ids = sortIds(ids, CHECK_ORDER);
  return { ids, modules, files };
}

const plan = resolvePlan();
if (!plan.ids.length) {
  console.error('[gate] 没有可跑的检查（检查 --only/--skip 或模式）');
  process.exit(2);
}

if (opts.list) {
  const checks = plan.ids.map((id) => CHECKS[id]);
  console.log(`模式 ${MODE}：${MODE_DESC[MODE]}`);
  if (MODE === 'related') console.log(`改动：${(plan.files || []).length} 个文件 → 模块 ${JSON.stringify(plan.modules || [])}`);
  console.log('');
  for (const c of checks) {
    const envs = [...(c.requires || [])];
    console.log(`  ${c.id.padEnd(20)} ${c.kind.padEnd(7)} ${String(c.cost || 'fast').padEnd(6)} ${c.label}`);
    console.log(`  ${''.padEnd(20)} 环境=${envs.length ? envs.join('+') : '无'}${c.server ? ` 服务器=${c.server}` : ''}  模块=${c.module || '—'}`);
  }
  process.exit(0);
}

/* -------------------------------- 执行 --------------------------------- */
const startedAt = Date.now();
const startedIso = new Date(startedAt).toISOString();
const env = collectEnv();
const python = detectPython();
const logDir = path.join(REPO_ROOT, 'qa', 'results', 'logs');
fs.mkdirSync(logDir, { recursive: true });

let rootServer = null;
let prefixServer = null;
async function serverFor(kind) {
  if (kind === 'root') {
    if (opts.base) return opts.base;
    if (!rootServer) { rootServer = new ManagedServer({ python }); await rootServer.start(); }
    return rootServer.base;
  }
  if (kind === 'prefixed') {
    if (opts.prefixBase) return opts.prefixBase;
    if (!prefixServer) { prefixServer = new ManagedServer({ python }); await prefixServer.start({ prefix: PREFIX }); }
    return prefixServer.base;
  }
  return null;
}
const cleanupServers = () => { try { rootServer?.stop(); } catch { /* ignore */ } try { prefixServer?.stop(); } catch { /* ignore */ } };
process.on('exit', cleanupServers);
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => { cleanupServers(); process.exit(130); });
}

/** 环境不满足时给出跳过原因（区分「关键」与「本就可选」；逻辑在 env.mjs，可单测） */
function skipReason(check) {
  return missingRequirements(check, env, { allowMissingChrome: opts.allowMissingChrome });
}

let activeChild = null;
function killTree(child) {
  if (!child || !child.pid) return;
  if (process.platform === 'win32') {
    try { spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }); } catch { /* ignore */ }
    return;
  }
  try { child.kill('SIGKILL'); } catch { /* ignore */ }
}

function runProcess({ command, args = [], cwd = REPO_ROOT, env: childEnv = {} }, { timeout, logFile }) {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(command, args, {
      cwd,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, ...childEnv, NO_COLOR: '1', FORCE_COLOR: '0' },
    });
    activeChild = child;
    const MAX = 4 * 1024 * 1024;
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; killTree(child); }, timeout);
    const push = (which) => (chunk) => {
      const s = chunk.toString();
      if (which === 'out') stdout = (stdout + s).slice(-MAX); else stderr = (stderr + s).slice(-MAX);
      if (opts.verbose) {
        for (const line of s.split(/\r?\n/)) if (line) console.log(`      │ ${line}`);
      }
    };
    child.stdout.on('data', push('out'));
    child.stderr.on('data', push('err'));
    const finish = (code, error) => {
      clearTimeout(timer);
      activeChild = null;
      const text = `$ ${command} ${args.join(' ')}\n${stdout}\n${stderr}`;
      try { fs.writeFileSync(logFile, text); } catch { /* ignore */ }
      resolve({ code: code == null ? (error ? 1 : 0) : code, stdout, stderr, timedOut, ms: Date.now() - started, error });
    };
    child.on('error', (err) => finish(1, err));
    child.on('close', (code) => finish(code, null));
  });
}

function applyBaseline(id, rec, baselines) {
  const b = baselines && baselines.checks ? baselines.checks[id] : null;
  if (!b || rec.status !== STATUS.PASS) return rec;
  const problems = [];
  if (b.min_pass != null && rec.pass < b.min_pass) problems.push(`通过数 ${rec.pass} < 基线 ${b.min_pass}（疑似用例被删除）`);
  if (b.max_skip != null && rec.skip > b.max_skip) problems.push(`跳过 ${rec.skip} > 允许 ${b.max_skip}（禁止静默跳过）`);
  if (rec.expected_total != null && rec.total !== rec.expected_total) {
    problems.push(`用例数 ${rec.total} ≠ 期望 ${rec.expected_total}（路由/用例被静默丢弃？）`);
  }
  if (problems.length) {
    rec.status = STATUS.FAIL;
    rec.error = problems.join('；');
    rec.failed = problems;
  }
  return rec;
}

function loadBaselines() {
  try { return JSON.parse(fs.readFileSync(path.join(REPO_ROOT, BASELINE_PATH), 'utf8')); } catch { return { checks: {} }; }
}

function artifactMtime(check) {
  const p = (check.artifacts || [])[0];
  if (!p) return null;
  try { return fs.statSync(path.join(REPO_ROOT, p)).mtimeMs; } catch { return null; }
}

async function runCheck(id, baselines) {
  const check = CHECKS[id];
  const t0 = Date.now();
  const base = { id, label: check.label, kind: check.kind, module: check.module, hint: check.hint, repro: check.repro, duration_ms: 0 };

  const skip = skipReason(check);
  if (skip) {
    const skipReq = skip.required && !check.optional;
    return {
      ...base, status: STATUS.SKIP, total: 0, pass: 0, fail: 0, skip: 0,
      required: skipReq, error: skip.error, hint: skip.hint || check.hint,
      duration_ms: Date.now() - t0,
    };
  }

  let checkBase = null;
  try {
    checkBase = check.server ? await serverFor(check.server) : null;
  } catch (err) {
    return {
      ...base, status: STATUS.FAIL, total: 0, pass: 0, fail: 1, skip: 0,
      error: `启动本地服务器失败：${err && err.message ? err.message : err}`,
      hint: '确认 python serve.py 能单独启动；gate 用 --port 0 随机端口，不需要手动起服务',
      duration_ms: Date.now() - t0,
    };
  }

  const prefixBase = check.server === 'prefixed' ? checkBase : (opts.prefixBase || null);
  const spec = check.run({ repoRoot: REPO_ROOT, env, python, base: checkBase, prefixBase, opts });
  const timeout = Math.round((check.timeout || 180000) * (opts.timeoutScale || 1));
  const logRel = `qa/results/logs/${id}.log`;
  const logAbs = path.join(REPO_ROOT, logRel);
  const beforeMtime = artifactMtime(check);

  const proc = await runProcess({ ...spec, command: spec.command || process.execPath }, { timeout, logFile: logAbs });
  let parsed = null;
  if (typeof check.parse === 'function') {
    try {
      parsed = await check.parse({
        code: proc.code, stdout: proc.stdout, stderr: proc.stderr, timedOut: proc.timedOut,
        ctx: { repoRoot: REPO_ROOT, base: checkBase, prefixBase, env, python, opts },
        base: checkBase, spec,
      });
    } catch (err) {
      parsed = null;
      proc.parseError = String(err && err.message ? err.message : err);
    }
  }

  // 产物新鲜度：脚本声称写了结果 JSON，但文件没更新 → 说明没跑到写结果就退出（不能读旧结果假装通过）
  let stale = false;
  if (beforeMtime != null) {
    const after = artifactMtime(check);
    if (after != null && after <= beforeMtime) stale = true;
  }

  const rec = {
    ...base,
    status: STATUS.PASS, total: 0, pass: 0, fail: 0, skip: 0,
    duration_ms: Date.now() - t0,
    log: logRel,
  };
  if (parsed) Object.assign(rec, parsed);

  let exitFail = proc.timedOut || proc.code !== 0;
  if (!parsed) {
    rec.total = rec.total || 1;
    rec.pass = 0; rec.fail = 1;
    rec.error = proc.timedOut
      ? `超时（${timeout}ms）`
      : `${proc.parseError ? `结果解析失败：${proc.parseError}` : `退出码 ${proc.code}，且没有可解析的结果`}`;
  }
  if (stale && !rec.fail) {
    rec.fail = 1; rec.pass = Math.max(0, rec.pass - 1);
    rec.error = '结果产物未更新（脚本在写结果前退出），拒绝把旧结果当作本轮通过';
  }
  if (rec.fail > 0 || exitFail) {
    rec.status = STATUS.FAIL;
    if (!rec.error) rec.error = proc.timedOut ? `超时（${timeout}ms）` : `退出码 ${proc.code}`;
    if (!rec.failed || !rec.failed.length) {
      rec.failed = [];
    }
    rec.log_tail = tailLines(`${proc.stdout}\n${proc.stderr}`, 30);
  } else {
    rec.status = STATUS.PASS;
  }
  if (rec.status === STATUS.FAIL) {
    const tail = tailLines(`${proc.stdout}\n${proc.stderr}`, 30);
    if (tail) rec.log_tail = tail;
    if (!rec.error) rec.error = tail.split('\n').filter(Boolean).slice(-1)[0] || '未知失败';
    rec.artifacts = (check.artifacts || []).filter((p) => fs.existsSync(path.join(REPO_ROOT, p)));
    try { rec.log = rel(REPO_ROOT, logAbs); } catch { /* ignore */ }
  }
  return applyBaseline(id, rec, baselines);
}

/* --------------------------------- 跑 TODO -------------------------------- */
async function main() {
  // 计划里需要服务器的检查，先起一次服务器（失败不阻塞静态检查，会逐项报错）
  const needsRoot = plan.ids.some((id) => CHECKS[id].server === 'root');
  const needsPrefixed = plan.ids.some((id) => CHECKS[id].server === 'prefixed');
  if (env.chrome.ok && python.available) {
    try { if (needsRoot) env.base = await serverFor('root'); } catch (err) { env.serverError = String(err && err.message ? err.message : err); }
    try { if (needsPrefixed) env.prefix_base = await serverFor('prefixed'); } catch (err) { env.prefixServerError = String(err && err.message ? err.message : err); }
  }

  const baselines = loadBaselines();
  const report = {
    schema_version: 1,
    tool: 'relic-archive-gate',
    mode: MODE,
    started_at: startedIso,
    finished_at: null,
    elapsed_ms: 0,
    plan: { ids: plan.ids, modules: plan.modules, changed_files: plan.files },
    env,
    checks: [],
    summary: { pass: 0, fail: 0, skip: 0, required_skip: 0 },
    json_path: rel(REPO_ROOT, path.join(REPO_ROOT, opts.json)),
  };
  console.log(renderHeader(report));
  console.log('');

  for (const id of plan.ids) {
    const rec = await runCheck(id, baselines);
    report.checks.push(rec);
    console.log(renderCheckLine(rec));
    if (rec.status === STATUS.FAIL && rec.log_tail) {
      // 失败即时给出尾部输出，省一次打开日志
      console.log(`      ┌─ ${rec.log}（末尾）`);
      for (const line of rec.log_tail.split('\n').slice(-12)) console.log(`      │ ${line}`);
      console.log('      └─');
    }
  }

  report.finished_at = new Date().toISOString();
  report.elapsed_ms = Date.now() - startedAt;
  report.summary.pass = report.checks.filter((c) => c.status === STATUS.PASS).length;
  report.summary.fail = report.checks.filter((c) => c.status === STATUS.FAIL).length;
  report.summary.skip = report.checks.filter((c) => c.status === STATUS.SKIP).length;
  report.summary.required_skip = report.checks.filter((c) => c.status === STATUS.SKIP && c.required).length;

  // 产物落盘
  const jsonAbs = path.join(REPO_ROOT, opts.json);
  fs.mkdirSync(path.dirname(jsonAbs), { recursive: true });
  fs.writeFileSync(jsonAbs, `${JSON.stringify(report, null, 2)}\n`);

  if (opts.updateBaseline) {
    const merged = loadBaselines();
    merged._说明 = '各检查的最低通过数与允许跳过数；有意增减用例后用 node qa/gate.mjs <mode> --update-baseline 更新。';
    merged.checks = merged.checks || {};
    for (const rec of report.checks) {
      // 只把「本轮真的通过」的检查写进基线；失败/跳过的不能成为下次的放水口径
      if (rec.status !== STATUS.PASS) continue;
      merged.checks[rec.id] = { min_pass: rec.pass, max_skip: rec.skip };
    }
    fs.writeFileSync(path.join(REPO_ROOT, BASELINE_PATH), `${JSON.stringify(merged, null, 2)}\n`);
    console.log(`\n[gate] 已更新基线 → ${BASELINE_PATH}`);
  }

  console.log(renderFailures(report.checks));
  console.log(renderVerdict(report));

  const code = report.summary.fail > 0 ? 1 : report.summary.required_skip > 0 ? 3 : 0;
  return code;
}

main()
  .then((code) => { cleanupServers(); process.exitCode = code; })
  .catch((err) => {
    cleanupServers();
    console.error('[gate] 致命错误：', err && err.stack ? err.stack : err);
    process.exitCode = 2;
  });
