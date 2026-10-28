/* =============================================================================
   qa/tests/lab-engine.test.mjs — 实验室计算引擎（js/lab/engine.js）确定性单元回归

   只读 data/site_data.json，纯 node:test，不启浏览器、不写仓库。
   覆盖（P1-2）：
     · 常数与 site_data.meta.formula 对齐；meta 缺字段时的兜底
     · 确定性：同输入两次 / 两个独立实例 / 多次调用不累积状态
     · 输入不被污染：计算前后 site_data 深拷贝快照不变
     · 公式不变量：护甲减伤单调且有界、封顶 CAP、CLASS 阈值边界（±1e-6）、
       总减伤 ≤ CAP / ≤1、EVADE / STAMINA 非负
     · 真实数据：presets[0] 完整计算字段类型；660 个预设单元与记录值对账
     · 纯计算：引擎源码不依赖 DOM / localStorage / fetch
   运行：node --test qa/tests/lab-engine.test.mjs

   口径说明 / 未覆盖风险（Lead 裁决：不改引擎）：
     引擎按公式 min(CAP, 1-(1-ARMOR_DR)(1-FLAT_DR)(1-RES/100)) 计算总减伤，**不对结果做 0 下限 clamp**。
     因此人为输入负抗性时 totals 可以为负（数学含义=易伤，EHP = HP/(1-DR) 仍自洽）。
     真实数据核查：660 个预设单元算出的总减伤最小值 0.17（全部非负）；data 中确有 18 条负抗性
     pieces 条目（最小 -6），但被护甲/其它抗性抵消，从未产生负总减伤。
     本文件因此断言：「负抗性输入 → 有限且 ≤1」+「真实 660 预设 → totals 全部非负」；
     若上游未来出现足以算出负 DR 的组合，真实数据用例会红（提示产品口径需复核），而不是静默通过。
   ========================================================================== */
import test from 'node:test';
import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';

import {
  createEngine, constantsFromMeta,
  CLASSES, ALL_KEYS, RES_KEYS, SLOT_KEYS, WEIGHT_EPS,
} from '../../js/lab/engine.js';

const site = JSON.parse(await fsp.readFile(
  new URL('../../data/site_data.json', import.meta.url), 'utf8',
));
const FORMULA = site.meta.formula;
const CAP = FORMULA.max_total_dr ?? 0.8;   // 封顶值以数据为准（meta.formula.max_total_dr）
const K = FORMULA.armor_k ?? 200;
const EPS = FORMULA.weight_eps ?? WEIGHT_EPS;

const E = createEngine(site);
const E2 = createEngine(site);            // 独立实例：用于实例间一致性
const ZERO_RES = [0, 0, 0, 0, 0];
const emptyAcc = () => E.emptyAcc();
const general = E.scenarioById('general');

const clone = (v) => structuredClone(v);
const near = (a, b, tol) => Math.abs(a - b) <= tol;

/** 遍历 site_data 的 660 个预设单元（best + best_armor） */
function* presetCells() {
  for (const cell of site.presets) {
    for (const key of ['best', 'ba']) {
      if (cell[key]) yield { cell, build: cell[key], key };
    }
  }
}

/* ------------------------------- 常数 / 工厂 ------------------------------- */

test('constantsFromMeta：常数与 site_data.meta.formula 对齐，缺字段时兜底', () => {
  const C = constantsFromMeta(site.meta);
  assert.equal(C.K, FORMULA.armor_k, 'armor_k 应取 meta.formula.armor_k');
  assert.equal(C.CAP, FORMULA.max_total_dr, 'max_total_dr 应取 meta.formula.max_total_dr');
  assert.equal(C.EPS, FORMULA.weight_eps, 'weight_eps 应取 meta.formula.weight_eps');
  assert.deepEqual(C.THR_BASE, FORMULA.base_thresh, 'CLASS 阈值应取 meta.formula.base_thresh');
  assert.deepEqual(C.RES_KEYS, FORMULA.res_types);
  assert.deepEqual(C.CLASSES, FORMULA.class_order);

  const fallback = constantsFromMeta({});
  assert.equal(fallback.K, 200, '缺 meta 时 K 兜底 200');
  assert.equal(fallback.CAP, 0.8, '缺 meta 时封顶兜底 0.8');
  assert.deepEqual(fallback.THR_BASE, [25, 50, 75], '缺 meta 时阈值兜底 [25,50,75]');

  // 工厂按数据取常数：这两个值必须直接来自 site_data
  assert.equal(E.K, K);
  assert.equal(E.CAP, CAP);
  assert.equal(E.EPS, EPS);
});

test('createEngine：同一输入连续两次计算 deepEqual（确定性）', () => {
  const p0 = site.presets[0];
  const a = E.presetComputed(p0.best, p0.p, p0.s);
  const b = E.presetComputed(p0.best, p0.p, p0.s);
  assert.deepEqual(b, a, 'presetComputed 两次结果应完全一致');

  const statsA = E.statsFor(120, 40, [10, 20, 5, 0, 30], E.expandMods({}), general);
  const statsB = E.statsFor(120, 40, [10, 20, 5, 0, 30], E.expandMods({}), general);
  assert.deepEqual(statsB, statsA, 'statsFor 两次结果应完全一致');

  const tableA = E.tableA();
  const tableB = E.tableA();
  assert.deepEqual(tableB, tableA, 'tableA 重复调用应一致（缓存不得改变内容）');
});

test('createEngine：两个独立实例对同一输入结果一致', () => {
  const p0 = site.presets[0];
  const r1 = E.presetComputed(p0.best, p0.p, p0.s);
  const r2 = E2.presetComputed(p0.best, p0.p, p0.s);
  assert.deepEqual(r2, r1, '不同实例的 presetComputed 应一致');

  assert.deepEqual(E2.tableA(), E.tableA(), '不同实例的 tableA 应一致');
  assert.deepEqual(E2.expandMods(E.picksFromProfile('fortify')), E.expandMods(E.picksFromProfile('fortify')));

  const enumerateOpts = () => ({
    picks: E.picksFromProfile(p0.p), scenarioId: p0.s, owned: new Set(E.presetIds(p0.best)), top: 3,
  });
  assert.deepEqual(E2.enumerateTop(enumerateOpts()), E.enumerateTop(enumerateOpts()), '不同实例的枚举应一致');
});

test('多次调用不累积状态（同一实例重复计算结果稳定）', () => {
  const p0 = site.presets[0];
  const first = E.presetComputed(p0.best, p0.p, p0.s);

  // 中间插入其它计算（含不同 profile / 场景），不得影响再算一次的结果
  E.presetComputed(site.presets[1].best, site.presets[1].p, site.presets[1].s);
  E.statsFor(999, 60, [0, 0, 0, 0, 0], E.expandMods(E.picksFromProfile('fortify_sb')), E.scenarioById('losomn'));
  E.tableC();
  E.enumerateTop({ picks: {}, scenarioId: 'general', owned: new Set(E.presetIds(p0.best)), top: 2 });

  const again = E.presetComputed(p0.best, p0.p, p0.s);
  assert.deepEqual(again, first, '多次调用后结果应保持稳定（无隐藏累积状态）');
  assert.deepEqual(E.thresholds(emptyAcc()), [25, 50, 75], '阈值不应被前序计算改写');

  const e1 = E.enumerateTop({ picks: {}, scenarioId: 'general', owned: new Set(E.presetIds(p0.best)), top: 2 });
  const e2 = E.enumerateTop({ picks: {}, scenarioId: 'general', owned: new Set(E.presetIds(p0.best)), top: 2 });
  assert.deepEqual(e2, e1, '重复枚举结果应一致');
});

test('计算不污染输入：site_data 深拷贝快照在全部计算后不变', () => {
  const snapshot = clone(site);
  const local = createEngine(site);

  local.presetComputed(site.presets[0].best, site.presets[0].p, site.presets[0].s);
  local.expandMods(local.picksFromProfile('fortify_sb'));
  local.thresholds(local.expandMods({}));
  local.tableA();
  local.tableB();
  local.tableC();
  local.frontier();
  local.enumerateTop({ picks: {}, scenarioId: 'general', owned: new Set(local.presetIds(site.presets[0].best)), top: 3 });

  assert.deepEqual(site, snapshot, '引擎计算不得修改传入的 site_data（含 presets/pieces/meta）');
});

/* ------------------------------- 公式不变量 ------------------------------- */

test('不变量：护甲减伤 armorDR 随护甲严格递增、有界，且 DR(K)=50%', () => {
  assert.equal(E.armorDR(0), 0, '0 护甲应 0 减伤');
  assert.equal(E.armorDR(K), 0.5, `护甲=${K} 时应正好 50% 减伤`);
  let prev = -1;
  for (let armor = 0; armor <= 2000; armor += 25) {
    const dr = E.armorDR(armor);
    assert.ok(Number.isFinite(dr), `armorDR(${armor}) 应为有限数`);
    assert.ok(dr > prev, `armorDR 应严格递增：armor=${armor} 时 ${dr} 未大于 ${prev}`);
    assert.ok(dr >= 0 && dr < 1, `armorDR(${armor})=${dr} 应落在 [0,1)`);
    prev = dr;
  }
  // 与 statsFor 的面板口径一致：adr 即 armorDR(armor)
  const st = E.statsFor(300, 0, ZERO_RES, emptyAcc(), general);
  assert.equal(st.armor, 300);
  assert.ok(near(st.adr, E.armorDR(300), 1e-12), 'statsFor.adr 应等于 armorDR(armor)');
});

test('不变量：物理减伤随护甲单调不减，且超过封顶值后收敛到 CAP', () => {
  let prev = -1;
  for (const sumA of [0, 25, 50, 100, 200, 300, 400, 600, 800, 1000, 2000]) {
    const st = E.statsFor(sumA, 0, ZERO_RES, emptyAcc(), general);
    const phys = st.totals.physical;
    assert.ok(Number.isFinite(phys), `sumA=${sumA} 的物理减伤应为有限数`);
    assert.ok(phys >= prev - 1e-12, `物理减伤应随护甲单调不减：sumA=${sumA} 时 ${phys} < ${prev}`);
    prev = phys;
  }
  // 800 护甲时 ARMOR_DR=0.8 已到封顶；再堆护甲不得突破 CAP
  const atCap = E.statsFor(800, 0, ZERO_RES, emptyAcc(), general);
  const overCap = E.statsFor(4000, 0, ZERO_RES, emptyAcc(), general);
  assert.ok(near(atCap.totals.physical, CAP, 1e-12), `800 护甲应正好封顶 ${CAP}`);
  assert.ok(near(overCap.totals.physical, CAP, 1e-12), `超过封顶后再加护甲仍应为 ${CAP}`);
});

test('不变量：总减伤受 CAP 约束（无额外乘区）且恒 ≤1', () => {
  const profiles = site.profiles.slice(0, 4);
  for (const pf of profiles) {
    const acc = E.expandMods(E.picksFromProfile(pf));
    const hasExtra = Math.abs(acc.elementalDR) > 1e-12;
    // 抗性输入取非负（游戏内护甲部件/词条不会给负抗性）：总减伤应落在 [0, CAP]
    for (const sumA of [0, 50, 200, 1000]) {
      for (const sr of [0, 30, 100, 400]) {
        const st = E.statsFor(sumA, 0, [sr, sr, sr, sr, sr], acc, general);
        for (const key of ALL_KEYS) {
          const v = st.totals[key];
          assert.ok(Number.isFinite(v), `totals.${key} 应为有限数（profile=${pf.id}, sumA=${sumA}, res=${sr}）`);
          assert.ok(v >= 0, `非负抗性下 totals.${key}=${v} 不得为负`);
          assert.ok(v <= 1 + 1e-12, `totals.${key}=${v} 不得超过 1`);
          if (!hasExtra) {
            assert.ok(v <= CAP + 1e-12, `无额外乘区时 totals.${key}=${v} 不得超过封顶 ${CAP}`);
          }
        }
        assert.ok(st.worst <= 1 + 1e-12, 'worst（最低减伤）应 ≤1');
      }
    }
    // 人为负抗性 = 易伤：公式允许总减伤为负，但必须仍是有限数且 ≤1（不得出现 NaN / 溢出）
    for (const sr of [-50, -200]) {
      const st = E.statsFor(0, 0, [sr, sr, sr, sr, sr], acc, general);
      for (const key of ALL_KEYS) {
        const v = st.totals[key];
        assert.ok(Number.isFinite(v), `负抗性下 totals.${key}=${v} 应仍为有限数`);
        assert.ok(v <= 1 + 1e-12, `负抗性下 totals.${key}=${v} 仍不得超过 1`);
      }
    }
  }
  // 空 acc 时六类减伤全部 ≤ CAP
  for (const sumA of [0, 100, 500, 1000]) {
    const st = E.statsFor(sumA, 0, [0, 50, 100, 200, 300], emptyAcc(), general);
    for (const key of ALL_KEYS) {
      assert.ok(st.totals[key] <= CAP + 1e-12, `空 acc 时 totals.${key}=${st.totals[key]} 应 ≤ ${CAP}`);
    }
  }
});

test('真实数据：660 个预设算出的总减伤全部非负（不会出现「负减伤」）', () => {
  let min = Infinity;
  let where = '';
  for (const { cell, build, key } of presetCells()) {
    const { st } = E.presetComputed(build, cell.p, cell.s);
    for (const k of ALL_KEYS) {
      const v = st.totals[k];
      assert.ok(Number.isFinite(v), `${cell.p}/${cell.c}/${cell.s}/${key}: totals.${k} 应为有限数`);
      if (v < min) { min = v; where = `${cell.p}/${cell.c}/${cell.s}/${key}:${k}`; }
    }
  }
  assert.ok(min >= 0, `真实预设出现负减伤 ${min}（${where}）：数据或公式需复核`);
  return;
});

test('不变量：CLASS 阈值 25/50/75 边界（含 1e-6 容差）', () => {
  const T = E.thresholds(emptyAcc());
  assert.deepEqual(T, [25, 50, 75], '基础阈值应来自 meta.formula.base_thresh');
  assert.equal(E.EPS, EPS, '引擎容差应取 meta.formula.weight_eps');

  // 浮点容差：阈值 + 半 EPS 仍算低一档；阈值 + 2×EPS 进入下一档
  const half = T[0] + EPS / 2;
  const over = T[0] + EPS * 2;
  assert.equal(E.classIdx(T[0], T), 0, 'w 恰为 25 应是轻装');
  assert.equal(E.classIdx(half, T), 0, 'w=25+0.5e-6 仍属轻装（容差内）');
  assert.equal(E.classIdx(over, T), 1, 'w=25+2e-6 应进入中装');
  assert.equal(E.classIdx(T[1], T), 1, 'w 恰为 50 应是中装');
  assert.equal(E.classIdx(T[1] + EPS / 2, T), 1, 'w=50+0.5e-6 仍属中装');
  assert.equal(E.classIdx(T[1] + EPS * 2, T), 2, 'w=50+2e-6 应进入重装');
  assert.equal(E.classIdx(T[2], T), 2, 'w 恰为 75 应是重装');
  assert.equal(E.classIdx(T[2] + EPS / 2, T), 2, 'w=75+0.5e-6 仍属重装');
  assert.equal(E.classIdx(T[2] + EPS * 2, T), 3, 'w=75+2e-6 应是超重');

  // 面板路径同样遵守容差：statsFor 的重量直接落到档位
  const stAt = E.statsFor(0, T[0], ZERO_RES, emptyAcc(), general);
  const stHalf = E.statsFor(0, T[0] + EPS / 2, ZERO_RES, emptyAcc(), general);
  const stOver = E.statsFor(0, T[0] + EPS * 2, ZERO_RES, emptyAcc(), general);
  assert.equal(stAt.cls, 'LIGHT');
  assert.equal(stHalf.cls, 'LIGHT', '阈值 +0.5e-6 不得被误判成中装');
  assert.equal(stOver.cls, 'MEDIUM', '阈值 +2e-6 应判中装');
  assert.deepEqual(CLASSES, ['LIGHT', 'MEDIUM', 'HEAVY', 'ULTRA']);
});

test('不变量：阈值随 weight_threshold_flat 单调、clamp 到 [5,98] 并保持三档有序', () => {
  const plus10 = emptyAcc(); plus10.thrFlat = 10;
  assert.deepEqual(E.thresholds(plus10), [35, 60, 85], '阈值应整体 +10');
  const huge = emptyAcc(); huge.thrFlat = 1000;
  assert.deepEqual(E.thresholds(huge), [98, 98, 98], '阈值上限应 clamp 到 98');
  const neg = emptyAcc(); neg.thrFlat = -100;
  const clamped = E.thresholds(neg);
  assert.deepEqual(clamped, [5, 5, 5], '阈值下限应 clamp 到 5');
  assert.ok(clamped[0] <= clamped[1] && clamped[1] <= clamped[2], '阈值必须保持三档有序');
});

/* ------------------------------- 真实数据 ------------------------------- */

test('真实用例：presets[0].best 完整计算字段类型、有限数、无 NaN/Infinity', () => {
  const p0 = site.presets[0];
  const { ids, st } = E.presetComputed(p0.best, p0.p, p0.s);

  assert.equal(ids.length, 4, '四件护甲应全部解析出 id');
  assert.ok(ids.every((id) => typeof id === 'string' && id.length > 0), `ids 应全为字符串：${JSON.stringify(ids)}`);
  assert.equal(ids.length, SLOT_KEYS.length, '槽位数应为 4');

  assert.equal(st.ok, true, '四件合法护甲组合 st.ok 应为 true');
  assert.equal(st.filled, 4, 'filled 应为 4');
  assert.equal(st.parts.length, 4, 'parts 应为 4 件');
  assert.ok(CLASSES.includes(st.cls), `cls=${st.cls} 应为已知档位`);
  assert.ok(Number.isInteger(st.ci) && st.ci >= 0 && st.ci <= 3, `ci=${st.ci} 应为 0..3`);

  // 面板数值：全部为有限数（无 NaN / Infinity）
  const numFields = [
    'weight', 'armor', 'adr', 'fdr', 'edr', 'score', 'worst',
    'stam', 'evade', 'dodges', 'regen', 'iframes', 'recovery',
    'neutralIframes', 'neutralRecovery', 'sprint',
    'hpAdd', 'hpPct', 'hpMax', 'hpTotal', 'shieldPct', 'hpRegen',
    'ehp', 'ehpShield', 'evadeWindow', 'evadeDist', 'evadeSpeed',
  ];
  for (const k of numFields) {
    assert.equal(typeof st[k], 'number', `st.${k} 应为数字（实际 ${typeof st[k]}）`);
    assert.ok(Number.isFinite(st[k]), `st.${k}=${st[k]} 应为有限数（不得 NaN/Infinity）`);
  }
  assert.ok(Number.isInteger(st.dodges) && st.dodges >= 1, `dodges=${st.dodges} 应为 ≥1 的整数`);

  // 六类总减伤：键齐全、值有限且在 [0,1]
  for (const key of ALL_KEYS) {
    assert.ok(key in st.totals, `totals 缺键 ${key}`);
    assert.ok(Number.isFinite(st.totals[key]), `totals.${key} 应为有限数`);
    assert.ok(st.totals[key] >= 0 && st.totals[key] <= 1, `totals.${key}=${st.totals[key]} 应在 [0,1]`);
  }
  assert.equal(st.res.length, RES_KEYS.length, 'res 应含 5 类抗性');
  assert.ok(st.res.every(Number.isFinite), 'res 应全为有限数');
  assert.equal(st.T.length, 3, 'T 应含三档阈值');
  assert.ok(st.T.every(Number.isFinite), 'T 应全为有限数');

  // 序列化兜底：整份面板数据里不得出现 NaN / Infinity 字面量
  const json = JSON.stringify(st);
  assert.doesNotMatch(json, /NaN|Infinity/, '面板数据序列化后不得含 NaN / Infinity');
  // lifesteal 允许 null（无吸血），其余数值字段不允许 null
  assert.ok(st.lifesteal === null || Number.isFinite(st.lifesteal), 'lifesteal 应为 null 或有限数');
});

test('真实用例：660 个预设单元与 site_data 记录对账（护甲/负重/减伤/档位）', () => {
  const cells = [...presetCells()];
  assert.equal(cells.length, 660, `预设单元数应为 660（实际 ${cells.length}）`);
  for (const { cell, build, key } of cells) {
    const { ids, st } = E.presetComputed(build, cell.p, cell.s);
    const where = `${cell.p}/${cell.c}/${cell.s}/${key}`;
    assert.equal(ids.length, 4, `${where}: 应解析出 4 件护甲`);
    assert.ok(ids.every((id) => typeof id === 'string' && id), `${where}: ids 应全为字符串`);
    assert.equal(st.ok, true, `${where}: 组合应合法`);
    assert.equal(st.cls, build.cl, `${where}: 档位 ${st.cls} ≠ 记录 ${build.cl}`);
    assert.ok(near(st.armor, build.a, 0.05), `${where}: 护甲 ${st.armor} ≠ 记录 ${build.a}（±0.05）`);
    assert.ok(near(st.weight, build.w, 1e-6), `${where}: 负重 ${st.weight} ≠ 记录 ${build.w}（±1e-6）`);
    if (typeof build.adr === 'number') {
      assert.ok(near(st.adr, build.adr, 1e-4), `${where}: 护甲减伤 ${st.adr} ≠ 记录 ${build.adr}（±1e-4，记录为 4 位小数）`);
    }
  }
});

test('真实用例：全部预设的 EVADE / STAMINA 非负且派生值有限', () => {
  let checked = 0;
  for (const { cell, build } of presetCells()) {
    const { st } = E.presetComputed(build, cell.p, cell.s);
    checked += 1;
    assert.ok(st.stam >= 0, `${cell.p}/${cell.c}/${cell.s}: 体力 ${st.stam} 不得为负`);
    assert.ok(st.evade >= 0, `${cell.p}/${cell.c}/${cell.s}: 闪避体力 ${st.evade} 不得为负`);
    assert.ok(st.regen >= 0, `${cell.p}/${cell.c}/${cell.s}: 体力回复 ${st.regen} 不得为负`);
    assert.ok(Number.isFinite(st.stam) && Number.isFinite(st.evade), '体力/闪避值应为有限数');
    assert.ok(st.ehp >= st.hpTotal - 1e-9, `EHP ${st.ehp} 不应小于生命 ${st.hpTotal}`);
    assert.ok(st.ehpShield >= st.ehp - 1e-9, '带盾 EHP 不应小于裸 EHP');
  }
  assert.equal(checked, 660, `应扫描 660 个预设单元（实际 ${checked}）`);
});

test('枚举：小池结果确定、结构正确、两次完全一致', () => {
  const p0 = site.presets[0];
  const ids = E.presetIds(p0.best);
  const opts = () => ({ picks: E.picksFromProfile(p0.p), scenarioId: p0.s, owned: new Set(ids), top: 3 });

  const r1 = E.enumerateTop(opts());
  const r2 = E.enumerateTop(opts());
  assert.deepEqual(r2, r1, '同一枚举两次结果应完全一致');
  assert.equal(r1.done, true, 'runAll 后 done 应为 true');
  assert.equal(r1.poolSize, 4, '仅拥有这 4 件时可用池应为 4');
  assert.equal(r1.total, 1, '可用池 4 件（每槽 1 件）应只有 1 种组合');
  assert.equal(r1.feasible, 1, '唯一组合应可行');
  assert.equal(r1.top.length, 1, 'top 应有 1 条');
  assert.deepEqual(r1.top[0].ids, ids, 'top 应就是这 4 件');
  assert.ok(Number.isFinite(r1.top[0].key), 'top.key 应为有限数');
  assert.equal(r1.top[0].stats.filled, 4);
  assert.equal(r1.top[0].stats.ok, true);
});

/* ------------------------------- 纯度守卫 ------------------------------- */

test('引擎保持纯计算：源码不依赖 DOM / localStorage / fetch（node 环境可直接跑）', async () => {
  const src = await fsp.readFile(new URL('../../js/lab/engine.js', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /\b(document|localStorage|fetch)\s*[.(]/, '引擎不得直接触 DOM / 存储 / 网络');
  assert.equal(typeof globalThis.document, 'undefined', 'node --test 环境没有 DOM（本文件全部用例已在此环境跑通）');
});
