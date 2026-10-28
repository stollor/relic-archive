/* =============================================================================
   qa/gate/plan.mjs — 模式与「改了什么 → 跑什么」的映射
   目的：AI 不用每次重新推导命令组合；改一个模块只跑相关回归（低成本），
        提交前/发布前才跑 full。
   ========================================================================== */

import path from 'node:path';

/**
 * 文件前缀 → 模块标签（越具体的放前面）。
 * 标签是「行为域」，不是目录：例如 js/main.js 与 router.js 同属 shell。
 */
export const FILE_RULES = [
  [/^(js\/core\/router\.js|js\/main\.js|js\/domains\.js)$/, ['shell']],
  [/^js\/core\/store\.js$/, ['state']],
  [/^js\/lab\/state\.js$/, ['state', 'lab']],
  [/^js\/core\/task\.js$/, ['async']],
  [/^js\/core\/api\.js$/, ['dataapi']],
  [/^js\/core\/ui\.js$/, ['ui']],
  [/^js\/core\/theme\.js$|^js\/theme-boot\.js$/, ['theme', 'ui']],
  [/^js\/core\/labels\.js$/, ['labels']],
  [/^js\/core\//, ['core']],
  [/^js\/components\//, ['components']],
  [/^js\/views\/library\.js$|^js\/library\//, ['library']],
  [/^js\/views\/lab\.js$|^js\/lab\//, ['lab']],
  [/^js\/views\/builds\.js$|^js\/builds\//, ['builds']],
  [/^js\/views\/codex\.js$/, ['codex']],
  [/^js\/views\//, ['shell']],
  [/^js\//, ['shell']],
  [/^css\//, ['css']],
  [/^data\//, ['data']],
  [/^pipeline\//, ['pipeline']],
  [/^qa\/tests\/([^/]+)\.(test\.mjs|py)$/, ['qa-test']],
  [/^qa\/tests\/([^/]+)\.browser\.mjs$/, ['qa-browser']],
  [/^qa\/(shot|interactions)\.js$/, ['qa-browser']],
  [/^qa\/lib\//, ['qa-lib']],
  [/^qa\//, ['qa']],
  [/^(index|lab)\.html$|^serve\.py$/, ['shell']],
  [/^(AGENTS|README|CHANGELOG)\.md$|^docs\//, ['docs']],
];

/** 模块标签 → 需要跑的检查（quick 基线之外的增量） */
export const MODULE_CHECKS = {
  shell: ['nav', 'lifecycle'],
  state: ['lifecycle'],
  async: ['lab-async', 'lifecycle'],
  dataapi: ['shot-dark'],
  ui: ['interactions-global', 'components'],
  theme: ['contrast', 'interactions-global'],
  labels: ['interactions-items'],
  core: ['unit-js', 'nav'],
  components: ['components', 'interactions'],
  library: ['interactions-items', 'nav'],
  lab: ['interactions-lab', 'lab-async'],
  builds: ['interactions-builds', 'data-builds'],
  codex: ['interactions-codex'],
  css: ['audit', 'contrast', 'shot-dark', 'shot-light'],
  data: ['data-schema', 'data-builds', 'data-sync', 'shot-dark'],
  pipeline: ['unit-py', 'data-builds', 'data-sync'],
  'qa-test': ['unit-js'],
  'qa-browser': ['nav', 'lifecycle'],
  'qa-lib': ['unit-js'],
  qa: ['unit-js', 'unit-py'],
  docs: [],
};

/** 各模式的基础检查集合（顺序即执行顺序，只说「跑哪些 id」） */
export const MODE_CHECKS = {
  // 快速：不启浏览器、不依赖工作区，开发中反复跑（目标 < 10s）
  quick: ['unit-js', 'audit', 'contrast', 'data-builds', 'data-schema'],
  // 完整：真实浏览器全量回归（提交前 / 发布前）
  full: [
    'unit-js', 'unit-py', 'audit', 'contrast', 'data-builds', 'data-schema', 'data-sync',
    'shot-dark', 'shot-light', 'shot-subpath',
    'interactions', 'lifecycle', 'lab-async', 'components', 'nav', 'nav-subpath',
  ],
  // 数据：只碰数据与数据脚本，不启浏览器
  data: ['data-builds', 'data-schema', 'data-sync', 'unit-py'],
  // 发布前：完整门禁 + 发布预检
  deploy: [
    'unit-js', 'unit-py', 'audit', 'contrast', 'data-builds', 'data-schema', 'data-sync',
    'shot-dark', 'shot-light', 'shot-subpath',
    'interactions', 'lifecycle', 'lab-async', 'components', 'nav', 'nav-subpath',
    'deploy-preflight',
  ],
  // related 由文件推导，见 planRelated()
  related: [],
};

export const MODE_DESC = {
  quick: '快速自检：单元测试 + 静态审计 + 对比度 + 数据契约（无浏览器，目标 <10s）',
  related: '按改动文件跑相关回归（默认 quick 基线 + 相关浏览器用例）',
  full: '完整回归：全部检查，含真实 Chrome 截图/交互/竞态/子路径',
  data: '数据链路：Schema 契约 + 流派引用 + 工作区漂移 + 数据脚本单元测试',
  deploy: '发布前：完整回归 + deploy.py 预检（不推送）',
};

/** 文件列表 → 模块标签集合 */
export function modulesForFiles(files) {
  const tags = new Set();
  for (const raw of files) {
    const f = String(raw || '').replace(/\\/g, '/').replace(/^\.\//, '');
    if (!f) continue;
    let matched = false;
    for (const [re, mods] of FILE_RULES) {
      if (re.test(f)) { mods.forEach((m) => tags.add(m)); matched = true; break; }
    }
    if (!matched) tags.add('shell');
  }
  return [...tags];
}

/** related 模式：quick 基线 + 模块对应增量（去重、保持注册表顺序之外的稳定顺序） */
export function planRelated(files) {
  const tags = modulesForFiles(files);
  const ids = new Set(MODE_CHECKS.quick);
  for (const tag of tags) for (const id of MODULE_CHECKS[tag] || []) ids.add(id);
  return { ids: [...ids], tags };
}

/** 把 id 数组排成稳定顺序（registry 的 CHECK_ORDER） */
export function sortIds(ids, order) {
  const idx = new Map(order.map((id, i) => [id, i]));
  return [...new Set(ids)].sort((a, b) => (idx.get(a) ?? 999) - (idx.get(b) ?? 999));
}

/** 人类可读：这个检查属于哪类成本 */
export function groupByCost(checks) {
  const g = { fast: [], medium: [], slow: [] };
  for (const c of checks) (g[c.cost] || g.fast).push(c);
  return g;
}

/** 报告里的模块路径提示（用于「对应模块」一栏） */
export function moduleOfFile(file) {
  const tags = modulesForFiles([file]);
  return tags.join('+') || 'unknown';
}

export const isDocOnly = (files) => files.length > 0 && files.every((f) => /^(AGENTS|README|CHANGELOG)\.md$|^docs\//.test(f));
export { path };
