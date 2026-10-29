/* =============================================================================
   遗迹2 · 遗物档案 — lab/wb-assembly.js（装配台 v3 外壳）
   把配装拆成 6 个分类页（CATS）：护甲 / 武器与改装 / 职业与技能 / 饰品 / 特性 / 圣物与碎片。
   本文件只负责：工具栏（流派 / 场景 / 档位 / 缺件 / 一键配齐）、分类 tab、
   懒加载分类模块（wb-cat-*.js，模块契约见 docs/ASSEMBLY_V3.md）、
   把当前分类的推荐渲染到下方推荐面板（recHost）。

   分类模块契约：
     createXxxTab(ctx) -> { el, refresh(), renderRec?(host), destroy?() }
   大改分类内容只动 js/lab/wb-cat-*.js；本文件不改。
   ========================================================================== */
import { h, clear } from '../core/dom.js';
import { icon } from '../core/icons.js';
import { router } from '../core/router.js';
import { store } from '../core/store.js';
import { ui } from '../core/ui.js';
import * as S from './state.js';
import { CLASS_ZH } from './engine.js';
import { CATS, CAT_BY_ID, emptyTab } from './wb-parts.js';
import { pickForSlot, removeSlot, ARMOR_SLOTS, TRINKET_SLOTS, WEAPON_SLOTS, ARCH_SLOTS } from './wb-slots.js';
import { applyRecommendedAll, oneclickToast } from './wb-oneclick.js';

/** 分类 → 懒加载工厂（动态 import：某一页出错不拖垮整个实验室） */
const FACTORIES = {
  armor: () => import('./wb-cat-armor.js'),
  weapons: () => import('./wb-cat-weapons.js'),
  archetype: () => import('./wb-cat-archetype.js'),
  trinkets: () => import('./wb-cat-trinkets.js'),
  traits: () => import('./wb-cat-traits.js'),
  relic: () => import('./wb-cat-relic.js'),
};
const MOD_KEY = {
  armor: 'createArmorTab', weapons: 'createWeaponsTab', archetype: 'createArchetypeTab',
  trinkets: 'createTrinketsTab', traits: 'createTraitsTab', relic: 'createRelicTab',
};
const DEFAULT_CAT = 'armor';

/** 当前分类写进 URL（?tab=），可分享 / 可复现；用 replaceSilently 避免触发路由重派发。
 *  以地址栏 hash 为准解析（replaceState 不会更新 router 的 currentCtx，用它拼会丢别的参数）。 */
function syncTabQuery(id) {
  const hash = String(location.hash || '');
  const raw = hash.replace(/^#/, '');
  const qi = raw.indexOf('?');
  const path = (qi >= 0 ? raw.slice(0, qi) : raw).replace(/\/+$/, '') || '/lab';
  const q = new URLSearchParams(qi >= 0 ? raw.slice(qi + 1) : '');
  if (id === DEFAULT_CAT) q.delete('tab'); else q.set('tab', id);
  const s = q.toString();
  router.replaceSilently(`${path}${s ? `?${s}` : ''}`);
}

function initialCategory() {
  const hash = String(location.hash || '');
  const qi = hash.indexOf('?');
  const q = new URLSearchParams(qi >= 0 ? hash.slice(qi + 1) : '');
  const id = q.get('tab');
  if (CAT_BY_ID.has(id)) return id;
  const cur = router.getRoute();
  const fromRoute = cur && cur.query ? cur.query.get('tab') : '';
  return CAT_BY_ID.has(fromRoute) ? fromRoute : DEFAULT_CAT;
}

/** 各分类已填槽位 / 上限（tab 上的小计数） */
function countsOf() {
  const b = store.build.slots();
  const filled = (slots) => slots.filter((s) => b[s]).length;
  return {
    armor: `${filled(ARMOR_SLOTS)}/4`,
    weapons: `${filled(WEAPON_SLOTS)}/3`,
    archetype: `${filled(ARCH_SLOTS)}/2`,
    trinkets: `${filled(TRINKET_SLOTS)}/5`,
    traits: `${S.traitUsed()}/10`,
    relic: `${filled(['relic']) + S.fragmentSlots().filter(Boolean).length}/4`,
  };
}

/**
 * @param {object} ctx 工作台上下文（model/E/S/store/ui/refresh/... 见 docs/ASSEMBLY_V3.md）
 * @param {{recHost:HTMLElement, onCategoryChange?:(id:string)=>void}} opts
 */
export function createAssembly(ctx, { recHost, onCategoryChange = null } = {}) {
  const { model, E } = ctx;
  const root = h('div', { class: 'lab-asm' });

  /* ----------------------------- 工具栏 ----------------------------- */
  const playstyleSel = h('select', { class: 'select select--sm', attrs: { 'aria-label': '流派' } },
    model.gear.playstyles.map((p) => h('option', { value: p.id, text: p.zh })));
  playstyleSel.addEventListener('change', () => {
    S.setPlaystyle(playstyleSel.value);
    ui.toast(`流派：${(model.gear.playstyleById.get(playstyleSel.value) || {}).zh || playstyleSel.value}`, 'ok');
  });

  const scenarioSel = h('select', { class: 'select select--sm', attrs: { 'aria-label': '场景' } },
    E.scenarios.map((s) => h('option', { value: s.id, text: s.zh })));
  scenarioSel.addEventListener('change', () => {
    S.setScenario(scenarioSel.value);
    ui.toast(`场景：${E.scenarioById(scenarioSel.value).zh}`, 'ok');
  });

  const classSel = h('select', { class: 'select select--sm', attrs: { 'aria-label': '档位目标' } },
    [{ id: 'free', zh: '档位不限' }, ...E.CLASS_ORDER.map((c) => ({ id: c, zh: `目标 ${CLASS_ZH[c]}` }))]
      .map((o) => h('option', { value: o.id, text: o.zh })));
  classSel.addEventListener('change', () => {
    S.setClassTarget(classSel.value);
    ui.toast(classSel.value === 'free' ? '档位目标：不限' : `档位目标：${CLASS_ZH[classSel.value] || classSel.value}`, 'ok');
  });

  const missingBtn = h('button', {
    class: 'chip chip--sm', type: 'button',
    attrs: { 'aria-label': '缺件清单' },
    title: '缺件 = 你没有的装备；推荐默认排除',
  });
  missingBtn.addEventListener('click', openMissingDrawer);

  const oneclickBtn = h('button', {
    class: 'btn btn--primary btn--sm', type: 'button', title: '按当前流派 / 场景自动填护甲、饰品、特性、碎片与武器挂件',
    on: { click: () => runOneclick() },
  }, icon('sparkle', { size: 13 }), h('span', { text: '按流派配齐' }));

  /* 工具栏只留两个动作：设置（抽屉承载全部选项）+ 主动作「按流派配齐」 */
  const settingsBtn = h('button', {
    class: 'btn btn--quiet btn--sm lab-asm__settings', type: 'button',
    attrs: { 'aria-label': '配装设置', title: '流派 / 场景 / 档位 / 缺件 / 消耗品 / 预设种子' },
    on: { click: () => openSettings() },
  }, icon('filter', { size: 13 }), h('span', { class: 'lab-asm__settings-txt' }));
  const tools = h('div', { class: 'lab-asm__tools' }, settingsBtn, oneclickBtn);

  /* ----------------------------- 设置抽屉 ----------------------------- */
  function openSettings() {
    syncToolbar();
    const n = S.missingCount();
    ui.openDrawer({
      title: '配装设置', subtitle: '流派 / 场景 / 档位 / 缺件 / 消耗品 · 立即生效', iconName: 'filter',
      body: h('div', { class: 'stack-3 lab-settings' },
        h('div', { class: 'lab-fieldrow' },
          h('div', { class: 'field' }, h('label', { class: 'field__label', text: '流派（推荐权重）' }), playstyleSel),
          h('div', { class: 'field' }, h('label', { class: 'field__label', text: '场景（减伤权重）' }), scenarioSel),
          h('div', { class: 'field' }, h('label', { class: 'field__label', text: '档位目标（推荐 / 重算用）' }), classSel),
          h('div', { class: 'field' }, h('label', { class: 'field__label', text: '缺件（推荐默认排除）' }), missingBtn),
        ),
        ...(Array.isArray(ctx.settingsBody) ? ctx.settingsBody : []),
      ),
      foot: h('div', { class: 'row row--spread grow' },
        h('span', { class: 'muted', attrs: { style: 'font-size:11.5px' }, text: '设置写入当前具名存档的 meta；「按流派配齐」会按这里的选择计算。' }),
        h('button', { class: 'btn btn--primary btn--sm', type: 'button', text: '完成', on: { click: () => ui.closeDrawer() } }),
      ),
    });
  }

  /* ----------------------------- 分类 tab ----------------------------- */
  const tabBar = h('div', { class: 'lab-asm__tabs', attrs: { role: 'tablist', 'aria-label': '装配分类' } });
  const tabBtns = new Map();
  for (const cat of CATS) {
    const count = h('span', { class: 'lab-atab__count' });
    const btn = h('button', {
      class: 'lab-atab', type: 'button', dataset: { cat: cat.id },
      attrs: { role: 'tab', 'aria-selected': 'false' },
      on: { click: () => { if (currentCat !== cat.id) activate(cat.id, { user: true }); } },
    }, icon(cat.icon, { size: 15 }), h('span', { class: 'lab-atab__zh', text: cat.zh }), count);
    tabBtns.set(cat.id, { btn, count });
    tabBar.append(btn);
  }

  const host = h('div', { class: 'lab-asm__host' });
  const loadingEl = h('div', { class: 'lab-asm__loading' }, icon('refresh', { size: 14 }), h('span', { text: '正在准备装配台…' }));
  host.append(loadingEl);

  root.append(
    h('div', { class: 'lab-asm__bar' }, tabBar, tools),
    host,
  );

  /* ----------------------------- 状态 ----------------------------- */
  let currentCat = initialCategory();
  let currentMod = null;
  let loadToken = 0;
  let destroyed = false;
  const modCache = new Map();   // catId -> { module } 或 { error }
  const pending = new Set();    // 正在加载的分类

  function syncToolbar() {
    playstyleSel.value = S.playstyleId();
    scenarioSel.value = S.scenarioId();
    classSel.value = S.classTarget();
    const n = S.missingCount();
    clear(missingBtn);
    missingBtn.classList.toggle('is-on', n > 0);
    missingBtn.append(icon('x-circle', { size: 12 }), h('span', { text: n ? `缺件 ${n} 件` : '无缺件' }));
    missingBtn.title = n ? `已标记 ${n} 件缺件（推荐默认排除）；点击查看` : '全库可用：推荐不排除任何装备；缺件在道具行标记';
    const ps = (model.gear.playstyleById.get(S.playstyleId()) || {}).zh || '通用';
    const sc = E.scenarioById(S.scenarioId()).zh;
    const cls = S.classTarget() === 'free' ? '档位不限' : `目标 ${CLASS_ZH[S.classTarget()] || S.classTarget()}`;
    const txt = settingsBtn.querySelector('.lab-asm__settings-txt');
    if (txt) txt.textContent = `${ps} · ${sc} · ${cls}`;
    settingsBtn.title = `当前：${ps} · ${sc} · ${cls}；点击修改流派 / 场景 / 档位 / 缺件 / 消耗品`;
  }

  function syncTabCounts() {
    const counts = countsOf();
    for (const [id, { btn, count }] of tabBtns) {
      count.textContent = counts[id] || '';
      const on = id === currentCat;
      btn.classList.toggle('is-on', on);
      btn.setAttribute('aria-selected', on ? 'true' : 'false');
    }
  }

  /* ----------------------------- 分类加载 ----------------------------- */
  function showLoading(text) {
    clear(host);
    host.append(h('div', { class: 'lab-asm__loading' }, icon('refresh', { size: 14 }), h('span', { text })));
  }

  function showError(text) {
    clear(host);
    host.append(emptyTab(text));
  }

  async function loadTab(id) {
    if (modCache.has(id)) return modCache.get(id);
    if (pending.has(id)) return null;
    pending.add(id);
    try {
      const mod = await FACTORIES[id]();
      const create = mod[MOD_KEY[id]] || mod.default;
      if (typeof create !== 'function') throw new Error(`分类模块缺少导出 ${MOD_KEY[id]}`);
      const inst = create(ctx);
      modCache.set(id, { inst });
      return modCache.get(id);
    } catch (err) {
      console.error(`[lab:assembly] 分类 ${id} 加载失败`, err);
      modCache.set(id, { error: err });
      return modCache.get(id);
    } finally {
      pending.delete(id);
    }
  }

  async function activate(id, { user = false } = {}) {
    if (destroyed) return;
    currentCat = id;
    syncTabCounts();
    syncToolbar();
    if (user) syncTabQuery(id);
    onCategoryChange?.(id);
    const token = ++loadToken;
    const cached = modCache.get(id);
    if (!cached) showLoading('正在准备本页…');
    const entry = cached || (await loadTab(id));
    if (destroyed || token !== loadToken || currentCat !== id) return;
    clear(host);
    if (!entry || entry.error || !entry.inst) {
      showError(entry && entry.error ? '本页模块加载失败，已记录错误；其余分类可用。' : '本页暂无数据。');
      renderRec(null);
      return;
    }
    currentMod = entry.inst;
    try { currentMod.refresh?.(); } catch (err) { console.error('[lab:assembly] 分类刷新失败', err); }
    host.append(currentMod.el);
    renderRec(currentMod);
  }

  /* ----------------------------- 推荐面板 ----------------------------- */
  function renderRec(mod) {
    if (!recHost) return;
    clear(recHost);
    if (!mod || typeof mod.renderRec !== 'function') {
      recHost.append(emptyTab('本类暂无推荐；切换分类或直接在上方装配。'));
      return;
    }
    try {
      mod.renderRec(recHost);
    } catch (err) {
      console.error('[lab:assembly] 推荐渲染失败', err);
      recHost.append(emptyTab('推荐渲染失败；装配与效果不受影响。'));
    }
  }

  /* ----------------------------- 缺件抽屉 ----------------------------- */
  function openMissingDrawer() {
    const ids = S.missingIds();
    const body = h('div', { class: 'stack-2' });
    if (!ids.length) {
      body.append(emptyTab('当前没有标记缺件；所有装备都视为可用。'));
    } else {
      body.append(h('div', { class: 'lab-note' }, icon('info', { size: 12 }),
        h('span', { text: '缺件 = 你还没有的装备。推荐、组合、一键配齐都会默认排除这些件。' })));
      for (const id of ids) {
        body.append(h('div', { class: 'lab-missrow' },
          h('span', { class: 'lab-missrow__name', text: model.nameOf(id) }),
          h('button', {
            class: 'btn btn--quiet btn--sm', type: 'button', text: '取消标记',
            on: { click: () => { S.toggleMissing(id); ui.toast(`已取消缺件：${model.nameOf(id)}`, 'ok'); ui.closeDrawer(); } },
          }),
        ));
      }
    }
    ui.openDrawer({
      title: '缺件清单', subtitle: `共 ${ids.length} 件 · 推荐默认排除`, iconName: 'x-circle',
      body,
      foot: ids.length
        ? h('div', { class: 'row row--spread grow' },
          h('span', { class: 'muted', attrs: { style: 'font-size:11.5px' }, text: '清空后推荐恢复为全库可用。' }),
          h('button', {
            class: 'btn btn--quiet btn--sm', type: 'button', text: '清空缺件',
            on: { click: () => { S.clearMissing(); ui.toast('已清空缺件标记', 'ok'); ui.closeDrawer(); } },
          }),
        )
        : null,
    });
  }

  /* ----------------------------- 一键配齐 ----------------------------- */
  let oneclickBusy = false;
  function runOneclick() {
    if (oneclickBusy) return;
    oneclickBusy = true;
    oneclickBtn.disabled = true;
    ui.toast('正在按流派配齐…', 'ok');
    const token = loadToken;
    setTimeout(() => {
      if (destroyed || token !== loadToken) { oneclickBusy = false; oneclickBtn.disabled = false; return; }
      try {
        const res = applyRecommendedAll(ctx);
        oneclickToast(res, ui);
      } finally {
        oneclickBusy = false;
        oneclickBtn.disabled = false;
        refresh();
      }
    }, 40);
  }

  /* ----------------------------- 刷新 ----------------------------- */
  function refresh() {
    if (destroyed) return;
    syncToolbar();
    syncTabCounts();
    if (currentMod) {
      try { currentMod.refresh?.(); } catch (err) { console.error('[lab:assembly] 分类刷新失败', err); }
      renderRec(currentMod);
    }
  }

  /* ----------------------------- 启动 ----------------------------- */
  syncToolbar();
  syncTabCounts();
  activate(currentCat);

  return {
    el: root,
    refresh,
    get category() { return currentCat; },
    setCategory(id) { if (CAT_BY_ID.has(id) && id !== currentCat) activate(id, { user: true }); },
    destroy() {
      destroyed = true;
      loadToken += 1;
      for (const { inst } of modCache.values()) {
        try { inst?.destroy?.(); } catch (err) { console.error('[lab:assembly] 分类销毁失败', err); }
      }
      modCache.clear();
    },
  };
}

export default createAssembly;
