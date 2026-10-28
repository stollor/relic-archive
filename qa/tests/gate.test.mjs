/* =============================================================================
   qa/tests/gate.test.mjs — 统一门禁自身的回归（防止「门禁静默失效」）
   覆盖：
     · 各测试输出解析器（TAP / unittest / 计数行）在真实样例上的行为；
     · 环境跳过判定（Chrome/Python/工作区缺失 → required 与否）；
     · 改动文件 → 模块 → 检查的映射（related 模式的核心）；
     · registry / plan / 文档三者的完整性守卫（新增检查忘了挂模式、文档漏写会红）；
     · 基线文件只引用真实存在的检查 id。
   运行：node --test qa/tests/gate.test.mjs
   ========================================================================== */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseNodeTest, parseUnittest, parseCounts } from '../gate/report.mjs';
import { missingRequirements } from '../gate/env.mjs';
import { CHECKS, CHECK_ORDER, checkIds } from '../gate/registry.mjs';
import { MODE_CHECKS, MODULE_CHECKS, modulesForFiles, planRelated, FILE_RULES } from '../gate/plan.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');

/* ------------------------------- 解析器 ------------------------------- */
test('parseNodeTest：从 TAP 输出读出总数/通过/失败/跳过与失败用例名', () => {
  const tap = [
    'TAP version 13',
    'ok 1 - 通过用例',
    'not ok 2 - 失败用例：router.parse 空 hash',
    '  ---',
    '  error: |',
    '    AssertionError',
    '  ...',
    '# tests 3',
    '# suites 0',
    '# pass 2',
    '# fail 1',
    '# cancelled 0',
    '# skipped 0',
    '# todo 0',
  ].join('\n');
  const r = parseNodeTest(tap);
  assert.equal(r.total, 3);
  assert.equal(r.pass, 2);
  assert.equal(r.fail, 1);
  assert.equal(r.skip, 0);
  assert.deepEqual(r.failed, ['失败用例：router.parse 空 hash']);
});

test('parseNodeTest：不可解析输出返回 null（交给上层按退出码判失败）', () => {
  assert.equal(parseNodeTest('Could not find \'qa/tests/nope.test.mjs\''), null);
  assert.equal(parseNodeTest(''), null);
});

test('parseUnittest：OK 与失败摘要都能正确归一', () => {
  const ok = '....\n----------------------------------------------------------------------\nRan 29 tests in 0.052s\n\nOK\n';
  const a = parseUnittest(ok);
  assert.deepEqual([a.total, a.pass, a.fail, a.skip], [29, 29, 0, 0]);

  const bad = [
    'F..E',
    '======================================================================',
    'FAIL: test_check_detects_drift (qa.tests.test_sync_data.TestSyncData)',
    '----------------------------------------------------------------------',
    'AssertionError: 1 != 0',
    '',
    'Ran 3 tests in 0.100s',
    '',
    'FAILED (failures=1, errors=1)',
  ].join('\n');
  const b = parseUnittest(bad);
  assert.equal(b.total, 3);
  assert.equal(b.fail, 2);
  assert.equal(b.pass, 1);
  assert.match(b.failed.join(' '), /test_check_detects_drift/);
});

test('parseCounts：浏览器用例的 PASS=/FAIL=/TOTAL= 与 PASS n FAIL n 两种格式', () => {
  assert.deepEqual(parseCounts('[navigation] PASS=8 FAIL=0 SKIP=1 TOTAL=9'), {
    total: 9, pass: 8, fail: 0, skip: 1, failed: [],
  });
  const alt = parseCounts('=== lifecycle 汇总：PASS 25 / FAIL 0 / PEND 0（3.2s）===');
  assert.equal(alt.pass, 25);
  assert.equal(alt.fail, 0);
  assert.equal(parseCounts('一句无关的话'), null);
});

/* ----------------------------- 环境跳过判定 ----------------------------- */
const ENV_HEALTHY = {
  python: { available: true, tried: [{ cmd: 'python' }] },
  chrome: { ok: true, error: '' },
  workspace: { available: true, reason: 'ok' },
};
const ENV_NO_PY = { ...ENV_HEALTHY, python: { available: false, tried: [{ cmd: 'python' }, { cmd: 'py' }] } };
const ENV_NO_CHROME = { ...ENV_HEALTHY, chrome: { ok: false, error: '未找到 chrome.exe' } };
const ENV_NO_WS = { ...ENV_HEALTHY, workspace: { available: false, reason: '独立 clone 无上游工作区' } };

test('missingRequirements：环境齐全时不跳过', () => {
  assert.equal(missingRequirements({ requires: ['chrome', 'python'] }, ENV_HEALTHY), null);
  assert.equal(missingRequirements({ requires: [] }, ENV_NO_CHROME), null);
});

test('missingRequirements：缺 Python/Chrome 是关键阻断（required=true）', () => {
  const py = missingRequirements({ requires: ['python'] }, ENV_NO_PY);
  assert.equal(py.required, true);
  assert.match(py.error, /Python 不可用/);
  assert.match(py.hint, /PYTHON/);

  const chrome = missingRequirements({ requires: ['chrome'] }, ENV_NO_CHROME);
  assert.equal(chrome.required, true);
  assert.match(chrome.error, /Chrome 未探测到/);
});

test('missingRequirements：--allow-missing-chrome 降级为允许跳过，但只影响浏览器检查', () => {
  const relaxed = missingRequirements({ requires: ['chrome'] }, ENV_NO_CHROME, { allowMissingChrome: true });
  assert.equal(relaxed.required, false);
  const stillRequired = missingRequirements({ requires: ['python'] }, ENV_NO_PY, { allowMissingChrome: true });
  assert.equal(stillRequired.required, true);
});

test('missingRequirements：缺上游工作区的可选检查不算阻断（独立 clone / CI 预期）', () => {
  const sync = missingRequirements({ requires: ['python', 'workspace'], optional: true }, ENV_NO_WS);
  assert.equal(sync.required, false);
  assert.match(sync.error, /独立 clone 无上游工作区/);
  // 非 optional 的 workspace 依赖仍然是关键检查（不允许静默跳过）
  const required = missingRequirements({ requires: ['workspace'] }, ENV_NO_WS);
  assert.equal(required.required, true);
});

/* --------------------------- 改动文件 → 检查映射 --------------------------- */
test('modulesForFiles：按行为域分派（编解码/大小写/反斜杠路径都能识别）', () => {
  assert.ok(modulesForFiles(['js/core/router.js']).includes('shell'));
  assert.ok(modulesForFiles(['js\\views\\lab.js']).includes('lab'));
  assert.ok(modulesForFiles(['js/lab/recommend.js']).includes('lab'));
  assert.ok(modulesForFiles(['css/tokens.css']).includes('css'));
  assert.ok(modulesForFiles(['data/items.json']).includes('data'));
  assert.ok(modulesForFiles(['docs/LESSONS.md']).includes('docs'));
  assert.ok(modulesForFiles(['文件/未知.xyz']).includes('shell'), '未知文件应按 shell 兜底而不是漏跑');
});

test('planRelated：quick 基线 + 相关模块增量；文档改动不额外拉浏览器', () => {
  const lab = planRelated(['js/lab/recommend.js', 'js/views/lab.js']);
  for (const id of MODE_CHECKS.quick) assert.ok(lab.ids.includes(id), `related 应包含 quick 基线 ${id}`);
  assert.ok(lab.ids.includes('lab-async'));
  assert.ok(lab.ids.includes('interactions-lab'));

  const docs = planRelated(['docs/LESSONS.md', 'README.md']);
  for (const id of docs.ids) {
    assert.ok(MODE_CHECKS.quick.includes(id), `纯文档改动不应额外跑 ${id}`);
  }

  const css = planRelated(['css/tokens.css']);
  assert.ok(css.ids.includes('contrast'));
  assert.ok(css.ids.includes('audit'));
  assert.ok(css.ids.includes('shot-dark'));
});

test('FILE_RULES：规则优先匹配，且每条映射到已声明的模块标签', () => {
  const known = new Set(Object.keys(MODULE_CHECKS));
  for (const [, mods] of FILE_RULES) {
    for (const m of mods) assert.ok(known.has(m), `FILE_RULES 映射了未声明的模块标签：${m}`);
  }
});

/* ------------------------- registry / 文档 一致性守卫 ------------------------- */
test('registry：CHECK_ORDER 与 CHECKS 完全一致（没有漏登记/漏排序的检查）', () => {
  assert.deepEqual([...CHECK_ORDER].sort(), Object.keys(CHECKS).sort());
  for (const id of checkIds()) {
    const c = CHECKS[id];
    assert.equal(c.id, id, `registry 中 ${id}.id 不一致`);
    assert.ok(c.label, `${id} 缺少 label`);
    assert.ok(typeof c.run === 'function', `${id} 缺少 run()`);
    for (const req of c.requires || []) {
      assert.ok(['python', 'chrome', 'workspace'].includes(req), `${id} 声明了未知环境依赖 ${req}`);
    }
    // manual = 只手动跑（性能基准这类参考指标），不参与常规门禁
    assert.ok(['fast', 'medium', 'slow', 'manual'].includes(c.cost), `${id} cost 非法`);
  }
});

test('plan：所有模式的检查 id 都已在 registry 注册（防止拼错 id 静默漏跑）', () => {
  for (const [mode, ids] of Object.entries(MODE_CHECKS)) {
    for (const id of ids) assert.ok(CHECKS[id], `模式 ${mode} 引用了不存在的检查 ${id}`);
  }
  for (const [tag, ids] of Object.entries(MODULE_CHECKS)) {
    for (const id of ids) assert.ok(CHECKS[id], `模块 ${tag} 引用了不存在的检查 ${id}`);
  }
});

test('baselines：只引用真实存在的检查，且 min_pass/max_skip 合法', () => {
  const p = path.join(REPO, 'qa', 'baselines.json');
  if (!fs.existsSync(p)) return; // 首次生成前允许缺失（生成后本用例会自动开始守卫）
  const b = JSON.parse(fs.readFileSync(p, 'utf8'));
  for (const [id, rule] of Object.entries(b.checks || {})) {
    assert.ok(CHECKS[id], `baseline 里有没有注册的检查：${id}`);
    if (rule.min_pass != null) assert.ok(Number.isInteger(rule.min_pass) && rule.min_pass >= 0, `${id}.min_pass 非法`);
    if (rule.max_skip != null) assert.ok(Number.isInteger(rule.max_skip) && rule.max_skip >= 0, `${id}.max_skip 非法`);
  }
});

test('文档一致性：qa/README.md 逐一列出所有检查 id（避免新增检查后文档静默过期）', () => {
  const readme = fs.readFileSync(path.join(REPO, 'qa', 'README.md'), 'utf8');
  for (const id of checkIds()) {
    assert.ok(readme.includes(id), `qa/README.md 缺少检查 ${id} 的说明（新增检查请同步文档）`);
  }
});
