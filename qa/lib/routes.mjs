/* =============================================================================
   遗迹2 · 遗物档案 — QA 路由表（ESM，纯数据推导）
   默认截图/门禁路由由「线上数据」推导（资料库深链、知识库首篇、流派 7 套…），
   这样数据更新后不用手改列表。shot.js 与 gate 脚本共用这一份，避免两处漂移。

   用法：
     import { deriveRoutes } from './qa/lib/routes.mjs';
     const routes = await deriveRoutes('http://127.0.0.1:8777');
   返回：[{ name, path, waitFor? }]，path 为 hash 形态（'#/items'）。
   ========================================================================== */

const DEFAULT_BASE = 'http://127.0.0.1:8777';

/** 等详情浮层（桌面弹窗 / 移动抽屉）出现 */
const DETAIL_OVERLAY = `!!document.querySelector('#modal:not([hidden]), #drawer:not([hidden])')`;
/** 等实验室指定面板显示 */
const panelWait = (id) => `!!document.querySelector('.lab-panel[data-panel="${id}"]:not([hidden])')`;

/**
 * 由当前站点数据推导默认路由表。
 * @param {string} base 站点地址（可含部署前缀，如 http://127.0.0.1:8793/relic-archive）
 * @returns {Promise<Array<{name:string, path:string, waitFor?:string}>>}
 */
export async function deriveRoutes(base = DEFAULT_BASE) {
  const root = String(base || DEFAULT_BASE).replace(/\/+$/, '');
  // v2 路由：实验室单页 + ?panel=；旧 #/lab/builds|matrix|calc 保留（验证重定向）
  const routes = [
    { name: 'items', path: '#/items' },
    { name: 'items-sets', path: '#/items/sets' },
    { name: 'items-list', path: '#/items?view=list' },
    { name: 'items-weapon-sort', path: '#/items?cat=weapon&sort=damage' },
    { name: 'lab', path: '#/lab' },
    { name: 'lab-recommend', path: '#/lab?panel=recommend', waitFor: panelWait('recommend') },
    { name: 'lab-trinkets', path: '#/lab?panel=trinkets', waitFor: panelWait('trinkets') },
    { name: 'lab-weapons', path: '#/lab?panel=weapons', waitFor: panelWait('weapons') },
    { name: 'lab-traits', path: '#/lab?panel=traits', waitFor: panelWait('traits') },
    { name: 'lab-fragments', path: '#/lab?panel=fragments', waitFor: panelWait('fragments') },
    { name: 'lab-replace', path: '#/lab?panel=replace', waitFor: panelWait('replace') },
    { name: 'lab-classes', path: '#/lab?panel=classes', waitFor: panelWait('classes') },
    { name: 'lab-calc', path: '#/lab?panel=calc', waitFor: panelWait('calc') },
    { name: 'lab-saved', path: '#/lab?panel=saved', waitFor: panelWait('saved') },
    { name: 'lab-legacy-builds', path: '#/lab/builds', waitFor: panelWait('recommend') },
    { name: 'lab-legacy-matrix', path: '#/lab/matrix', waitFor: panelWait('classes') },
    { name: 'lab-legacy-calc', path: '#/lab/calc', waitFor: panelWait('calc') },
    { name: 'codex', path: '#/codex' },
  ];
  // 深链：从真实数据里取第一篇知识库文章
  try {
    const c = await (await fetch(`${root}/data/codex/index.json`)).json();
    const a = (c.articles || [])[0];
    if (a && a.id) routes.push({ name: 'codex-article', path: `#/codex/${encodeURIComponent(a.id)}` });
  } catch { /* 数据不可用不阻断截图 */ }
  // 深链：第一件护甲 / 第一把武器
  try {
    const items = (await (await fetch(`${root}/data/items.json`)).json()).items || [];
    const armor = items.find((i) => i && i.id && (i.cat === 'armor' || String(i.id).startsWith('Armor_')));
    const weapon = items.find((i) => i && i.id && i.cat === 'weapon');
    const pick = armor || weapon || items[0];
    if (pick && pick.id) routes.push({ name: 'item-detail', path: `#/items/${encodeURIComponent(pick.id)}`, waitFor: DETAIL_OVERLAY });
    const pick2 = weapon || pick;
    if (pick2 && pick2.id && pick2.id !== (pick && pick.id)) {
      routes.push({ name: 'item-detail-2', path: `#/items/${encodeURIComponent(pick2.id)}`, waitFor: DETAIL_OVERLAY });
    }
    routes.push({ name: 'items-owned', path: '#/items?owned=1' });
  } catch { /* 数据不可用不阻断截图 */ }
  // 流派（配装推荐）：列表 + 7 套详情 + 404（详情 key 全部来自 data/builds.json）
  try {
    const b = await (await fetch(`${root}/data/builds.json`)).json();
    routes.push({ name: 'builds', path: '#/builds' });
    for (const x of (b.builds || [])) {
      if (x && x.key) routes.push({ name: `builds-${x.key}`, path: `#/builds/${encodeURIComponent(x.key)}` });
    }
    routes.push({ name: 'builds-404', path: '#/builds/__no_such_build__' });
  } catch { /* 数据不可用不阻断截图 */ }
  return routes;
}

export default deriveRoutes;
