/* =============================================================================
   qa/gate/report.mjs — 各测试输出的统一解析 + 机器可读/中文摘要渲染
   约定：每个检查最终都归一为 { total, pass, fail, skip, failed[] }；
        失败时额外带 error / hint / artifacts / log，供 AI 直接定位。
   ========================================================================== */

import fs from 'node:fs';
import path from 'node:path';

export const STATUS = { PASS: 'PASS', FAIL: 'FAIL', SKIP: 'SKIP' };

/* ------------------------------- 文本工具 ------------------------------- */
export function tailLines(text, n = 40, maxChars = 12000) {
  const lines = String(text || '').replace(/\r\n/g, '\n').split('\n');
  const tail = lines.slice(-n).join('\n');
  return tail.length > maxChars ? `…${tail.slice(-maxChars)}` : tail;
}

export function firstMatch(text, regex, group = 1) {
  const m = String(text || '').match(regex);
  return m ? Number(m[group]) : null;
}

/* ------------------------------- 解析器 -------------------------------- */
/** Node TAP 输出：`# tests 69` / `# pass 69` / `# fail 0` + `not ok 3 - 名称` */
export function parseNodeTest(stdout) {
  const text = String(stdout || '');
  const total = firstMatch(text, /^# tests\s+(\d+)/m) ?? firstMatch(text, /^# pass\s+(\d+)/m);
  const pass = firstMatch(text, /^# pass\s+(\d+)/m);
  const fail = firstMatch(text, /^# fail\s+(\d+)/m);
  const skip = firstMatch(text, /^# skipped\s+(\d+)/m) ?? 0;
  const failed = [...text.matchAll(/^not ok\s+\d+\s+-\s+(.*)$/gm)].map((m) => m[1].trim()).slice(0, 20);
  if (total == null && pass == null) return null;
  return {
    total: total ?? (pass || 0) + (fail || 0) + skip,
    pass: pass ?? 0,
    fail: fail ?? 0,
    skip,
    failed,
  };
}

/** Python unittest：`Ran 29 tests` + `OK` / `FAILED (failures=1, errors=2)` */
export function parseUnittest(stdout) {
  const text = String(stdout || '');
  const ran = firstMatch(text, /Ran (\d+) tests?/);
  if (ran == null) return null;
  const ok = /^OK\b/m.test(text);
  const failedLine = text.match(/^FAILED \((.*)\)$/m);
  let fail = 0;
  let skip = 0;
  if (failedLine) {
    fail = (firstMatch(failedLine[1], /failures=(\d+)/) ?? 0) + (firstMatch(failedLine[1], /errors=(\d+)/) ?? 0);
    if (fail === 0) fail = 1;
    skip = firstMatch(failedLine[1], /skipped=(\d+)/) ?? 0;
  } else if (!ok) {
    fail = 1;
  }
  const failed = [...text.matchAll(/^(?:FAIL|ERROR):\s+(.+)$/gm)].map((m) => m[1].trim()).slice(0, 20);
  return { total: ran, pass: Math.max(0, ran - fail - skip), fail, skip, failed };
}

/** `PASS=12 FAIL=0 TOTAL=12` / `PASS 3 FAIL 1 SKIP 0` 兼容写法 */
export function parseCounts(stdout) {
  const text = String(stdout || '');
  const pass = firstMatch(text, /PASS\s*[=:]\s*(\d+)/) ?? firstMatch(text, /PASS\s+(\d+)/);
  const fail = firstMatch(text, /FAIL\s*[=:]\s*(\d+)/) ?? firstMatch(text, /FAIL\s+(\d+)/);
  const skip = firstMatch(text, /SKIP\s*[=:]\s*(\d+)/) ?? firstMatch(text, /SKIP\s+(\d+)/) ?? 0;
  const total = firstMatch(text, /TOTAL\s*[=:]\s*(\d+)/) ?? (pass != null && fail != null ? pass + fail + skip : null);
  if (pass == null && fail == null) return null;
  return { total: total ?? 0, pass: pass ?? 0, fail: fail ?? 0, skip, failed: [] };
}

/* ------------------------------ 读取产物 -------------------------------- */
export function readJsonSafe(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

export function rel(root, p) {
  if (!p) return '';
  const r = path.relative(root, p);
  return r.split(path.sep).join('/');
}

/* -------------------------------- 渲染 ---------------------------------- */
const fmtMs = (ms) => (ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`);

export function renderHeader(report) {
  const { mode, env, started_at: startedAt, checks } = report;
  const out = [];
  out.push('');
  out.push(`遗迹2 · 遗物档案 —— 统一验收门禁（mode=${mode}）`);
  out.push('─'.repeat(78));
  const chromeTxt = env.chrome.ok ? `Chrome=${env.chrome.path}` : 'Chrome 未探测到';
  const pyTxt = (env.python && (env.python.label || env.python.version)) || '未探测到';
  out.push(`环境：Node ${env.node} · Python ${pyTxt} · ${chromeTxt}`);
  out.push(`      ${env.os} · ${env.ci ? 'CI ' : ''}工作区${env.workspace.available ? '可用' : '缺失'}`);
  const gitTxt = env.git.available
    ? `git ${env.git.sha}@${env.git.branch || '(detached)'}${env.git.clean ? '·干净' : `·脏(${env.git.dirtyFiles.length} 个文件)`}`
    : 'git 不可用';
  const baseTxt = [env.base && `本地基址 ${env.base}`, env.prefix_base && `子路径基址 ${env.prefix_base}`].filter(Boolean).join(' · ');
  out.push(`      ${gitTxt}${baseTxt ? ` · ${baseTxt}` : ''}`);
  out.push(`开始：${startedAt}    计划 ${(report.plan && report.plan.ids ? report.plan.ids.length : checks.length)} 项`);
  out.push('─'.repeat(78));
  return out.join('\n');
}

export function renderCheckLine(check) {
  const status = check.status.padEnd(4);
  const counts = check.total ? `${check.pass}/${check.total}${check.skip ? ` skip=${check.skip}` : ''}` : '—';
  const extra = check.note ? `  ${check.note}` : '';
  return `  ${status} ${check.id.padEnd(20)} ${counts.padEnd(12)} ${fmtMs(check.duration_ms).padStart(7)}${extra}`;
}

export function renderFailures(checks) {
  const out = [];
  const fails = checks.filter((c) => c.status === STATUS.FAIL);
  const requiredSkips = checks.filter((c) => c.status === STATUS.SKIP && c.required);
  const optionalSkips = checks.filter((c) => c.status === STATUS.SKIP && !c.required);
  if (fails.length) {
    out.push('');
    out.push(`失败定位（${fails.length} 项）`);
    fails.forEach((c, i) => {
      out.push(`  ${i + 1}) ${c.id}  ·  ${c.module || c.kind}  ·  ${fmtMs(c.duration_ms)}`);
      if (c.error) out.push(`     原因：${String(c.error).replace(/\n/g, '\n           ')}`);
      if (c.failed && c.failed.length) {
        out.push(`     失败用例：${c.failed.slice(0, 8).join(' | ')}${c.failed.length > 8 ? ` …(+${c.failed.length - 8})` : ''}`);
      }
      if (c.log) out.push(`     日志：${c.log}`);
      if (c.artifacts && c.artifacts.length) out.push(`     证据：${c.artifacts.join(' · ')}`);
      if (c.hint) out.push(`     排查：${c.hint}`);
      if (c.repro) out.push(`     复跑：${c.repro}`);
    });
  }
  if (requiredSkips.length) {
    out.push('');
    out.push(`环境不具备（${requiredSkips.length} 项 · 关键检查，默认算失败）`);
    for (const c of requiredSkips) out.push(`  - ${c.id}：${c.error || '环境缺失'}${c.hint ? `　→ ${c.hint}` : ''}`);
  }
  if (optionalSkips.length) {
    out.push('');
    out.push(`按环境跳过（${optionalSkips.length} 项 · 不阻断）`);
    for (const c of optionalSkips) out.push(`  - ${c.id}：${c.error || '环境不具备'}${c.hint ? `　→ ${c.hint}` : ''}`);
  }
  return out.join('\n');
}

export function renderVerdict(report) {
  const { summary, elapsed_ms: elapsed, json_path: jsonPath, checks } = report;
  const ok = summary.fail === 0 && summary.required_skip === 0;
  const out = [];
  out.push('');
  out.push('─'.repeat(78));
  out.push(`${ok ? '门禁结果：PASS' : '门禁结果：FAIL'}   PASS ${summary.pass} · FAIL ${summary.fail} · SKIP ${summary.skip}（环境阻断 ${summary.required_skip}）  用时 ${fmtMs(elapsed)}`);
  out.push(`报告：${jsonPath}`);
  if (!ok) out.push(`下一步：按上面「失败定位」逐项修复；只想复跑某几项：node qa/gate.mjs <mode> --only ${(checks || []).filter((c) => c.status === STATUS.FAIL).map((c) => c.id).join(',') || '<id>'}`);
  out.push('─'.repeat(78));
  return out.join('\n');
}
