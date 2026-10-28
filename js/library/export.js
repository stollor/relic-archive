/* =============================================================================
   遗迹2 · 遗物档案 — library/export.js
   资料库「导出查询串」：把当前筛选态翻译成 CLI 查询对象 / 可分发文本（纯函数）。
   契约：schema rmn2.cli/1-query、sortMap、limit 200 —— 与 CLI 侧逐字对齐，别改语义。
   ========================================================================== */
import { METRIC_BY_ID } from './query.js';

/** 页面排序 id → CLI 排序串 */
export const SORT_MAP = {
  name: 'zh', armor: '-armor', weight: '-weight', damage: '-damage', rate: '-rof',
  mag: '-stat:AmmoPerClip', maxammo: '-stat:MaxAmmo', crit: '-stat:CritChance',
  weakspot: '-stat:WeakSpotDamageMod', resist: '-base:ResistanceSum',
  value: '-value', dlc: 'dlc', order: 'id',
};

/**
 * 当前筛选 → rmn2 CLI 查询对象。
 * @param {object} state defaultState() 形状
 */
export function buildCliQuery(state) {
  const q = {};
  if (state.cat !== 'all') q.cat = [state.cat];
  if (state.assets) q.include_assets = true; else q.kind = ['item'];
  if (state.set) q.set = state.set;
  if (state.tags.length) q.tag = [...state.tags];
  if (state.confs.length) q.confidence = [...state.confs];
  if (state.icon) q.has_icon = true;
  if (state.stats) q.has_effect = true;
  if (state.q) q.text = state.q;
  const metric = METRIC_BY_ID.get(state.metric) || METRIC_BY_ID.get('armor');
  const baseStat = [];
  if (state.min !== '') baseStat.push(`${metric.key}>=${state.min}`);
  if (state.max !== '') baseStat.push(`${metric.key}<=${state.max}`);
  if (baseStat.length) q.base_stat = baseStat;
  if (SORT_MAP[state.sort]) q.sort = SORT_MAP[state.sort];
  q.limit = 200;
  return q;
}

/**
 * 可下载/可复制的完整导出对象（含当前 Web 筛选态与结果 id）。
 * @param {object} state 当前状态
 * @param {object[]} list 当前结果（已排序）
 */
export function exportPayload(state, list) {
  const query = buildCliQuery(state);
  return {
    schema: 'rmn2.cli/1-query',
    generated_at: new Date().toISOString(),
    from: 'web/items',
    web: Object.assign(JSON.parse(JSON.stringify(state)), {}),
    query,
    count: list.length,
    ids: list.slice(0, 400).map((it) => it.id),
  };
}

/** 菜单「复制 CLI JSON」的文本 */
export function cliJsonText(state, list) {
  return JSON.stringify(exportPayload(state, list), null, 2);
}

/** 菜单「复制 PowerShell」的文本 */
export function powershellText(state) {
  const json = JSON.stringify(buildCliQuery(state), null, 2);
  // 路径必须用 String.raw：普通字符串里的 \b / \r 会变成控制字符，复制出去的路径是坏的
  const cliPath = String.raw`.\mimocode\bin\rmn2.ps1`;
  return [
    '# 1) 把当前筛选写成 query.json（PowerShell）',
    "$json = @'",
    json,
    "'@",
    "Set-Content -Path query.json -Value $json -Encoding utf8",
    '',
    '# 2) 用本地 CLI 查询（默认只返回真道具，与页面默认一致）',
    `${cliPath} search --query-json @query.json --json`,
  ].join('\n');
}
