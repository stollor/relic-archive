/* =============================================================================
   遗迹2 · 遗物档案 — domains.js
   全站领域注册表（唯一来源）。

   新增一个领域 = 这里加一项 + 新建 js/views/<x>.js 与 css/view-<x>.css，不再改
   router.js / main.js / index.html。导航、文档标题、快捷键、视图模块与视图样式
   全部由这张表驱动；js/core/router.js 只解析 hash 形态，不认识任何具体领域。
   ========================================================================== */

/**
 * 领域字段：
 *   id        路由首段（#/<id>）与顶栏 data-domain
 *   zh        顶栏与帮助面板里的中文名
 *   title     文档标题名（router.setTitle 用）
 *   icon      js/core/icons.js 的图标名
 *   path      规范路径（未知领域重定向 / 导航 href）
 *   shortcut  Alt+<数字> 快捷键（可选，需唯一）
 *   badge     'build' = 顶栏挂「当前配装已填槽位」计数（可选）
 *   purpose   帮助面板里的一句话用途
 *   styles    进入该领域时注入的视图样式（相对路径，兼容 GitHub Pages 子路径部署）
 *   load      视图模块懒加载器
 *   bootstrap false = 该领域首屏不依赖全量 items（进入前不必等 api.ready()；默认 true）。
 *             目前只有 codex 为 false：它首屏只读 data/codex/index.json。
 */
export const DOMAINS = [
  {
    id: 'items', zh: '资料库', title: '资料库', icon: 'library', path: '/items', shortcut: '1',
    purpose: '这是什么、怎么获得',
    styles: ['css/view-library.css'],
    load: () => import('./views/library.js'),
  },
  {
    id: 'lab', zh: '实验室', title: '实验室', icon: 'flask', path: '/lab', shortcut: '2',
    badge: 'build', purpose: '组合起来怎样',
    styles: ['css/view-lab.css'],
    load: () => import('./views/lab.js'),
  },
  {
    id: 'builds', zh: '流派', title: '流派', icon: 'builds', path: '/builds', shortcut: '3',
    purpose: '成型的配装怎么玩',
    styles: ['css/view-builds.css'],
    load: () => import('./views/builds.js'),
  },
  {
    id: 'codex', zh: '知识库', title: '知识库', icon: 'book', path: '/codex', shortcut: '4',
    purpose: '机制为什么这样',
    bootstrap: false,
    styles: ['css/view-codex.css'],
    load: () => import('./views/codex.js'),
  },
];

/** 默认领域：地址未指定 / 领域未知时统一落到这里 */
export const DEFAULT_DOMAIN = 'items';

export const DOMAIN_IDS = DOMAINS.map((d) => d.id);

const BY_ID = new Map(DOMAINS.map((d) => [d.id, d]));

/** 是否是已注册的领域 id */
export function isDomain(id) {
  return BY_ID.has(id);
}

/** 按 id 取领域定义；找不到返回 null */
export function domainById(id) {
  return BY_ID.get(id) || null;
}

/** 领域中文名（文档标题/导航文案）；未知领域返回 fallback */
export function domainLabel(id, fallback = '') {
  const d = BY_ID.get(id);
  return d ? d.title || d.zh : fallback;
}

/** 快捷键表：[{ key, domain }]，domain 为完整领域定义，按 DOMAINS 顺序 */
export function shortcutDomains() {
  return DOMAINS.filter((d) => d.shortcut).map((d) => ({ key: String(d.shortcut), domain: d }));
}
