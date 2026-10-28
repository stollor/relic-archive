/* =============================================================================
   遗迹2 · 遗物档案 — QA 站点地址/子路径工具（CJS，零依赖）
   被 interactions.js 与 gate 复用：GitHub Pages 部署在 /relic-archive/ 子路径，
   页面内 import('/js/...') / fetch('/data/...') 这类根绝对路径在子路径下会 404，
   必须统一带部署前缀（prefixOf）。

   prefixOf('http://127.0.0.1:8777')                      → ''
   prefixOf('http://127.0.0.1:8793/relic-archive')       → '/relic-archive'
   prefixOf('http://127.0.0.1:8793/relic-archive/')      → '/relic-archive'
   prefixOf('https://stollor.github.io/relic-archive/')  → '/relic-archive'
   pageUrl('http://127.0.0.1:8793/relic-archive', '#/x') → 'http://127.0.0.1:8793/relic-archive/#/x'
   ========================================================================== */
'use strict';

/**
 * 从站点地址里取出部署前缀（无尾斜杠；根部署返回 ''）。
 * @param {string} base 绝对 URL，如 http://127.0.0.1:8777 或 …/relic-archive
 * @returns {string}  '' | '/relic-archive' | '/a/b'
 */
function prefixOf(base) {
  const raw = String(base == null ? '' : base).trim();
  if (!raw) return '';
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new TypeError(`无效的站点地址：${raw}（示例：http://127.0.0.1:8777 或 http://127.0.0.1:8777/relic-archive）`);
  }
  return url.pathname.replace(/\/+$/, '');
}

/**
 * 拼页面 URL：base（可含前缀）+ hash 路由。
 * @param {string} base 站点地址（有无尾斜杠均可）
 * @param {string} [hash] '#/items' | '/items' | 'items' | ''（空 = 首页）
 * @returns {string}
 */
function pageUrl(base, hash = '') {
  const root = String(base == null ? '' : base).trim().replace(/\/+$/, '');
  if (!root) throw new TypeError('pageUrl(base, hash)：base 不能为空');
  const raw = String(hash == null ? '' : hash).trim();
  if (!raw || raw === '#') return `${root}/`;
  const suffix = raw.startsWith('#') ? raw : `#${raw.startsWith('/') ? raw : `/${raw}`}`;
  return `${root}/${suffix}`;
}

module.exports = { prefixOf, pageUrl };
