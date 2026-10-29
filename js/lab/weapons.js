/* =============================================================================
   遗迹2 · 遗物档案 — lab/weapons.js（v2）
   武器改装：按工作台当前武器槽（长枪 / 手枪 / 近战）给「突变因子」与「改装」前 5 名，
   含效果原文、适配流派与武器契合；行内可写入 meta.attachments（突变因子）或 store.build.mods（改装）。
   流派继承全局 meta.playstyle（与饰品组合面板共享）。
   URL：wslot（武器槽）/ ps（流派，可深链）。
   ========================================================================== */
import { h, clear, fmt } from '../core/dom.js';
import { icon } from '../core/icons.js';
import { store } from '../core/store.js';
import { ui } from '../core/ui.js';
import { openItemDetail } from '../components/item-detail.js';
import { createScope } from '../core/task.js';
import * as S from './state.js';
import { panel, emptyState, emptyLine, itemMedia, SLOT_ICON } from './parts.js';
import { SLOT_LABEL } from './model.js';
import { createScorer } from './score.js';
import { createFit } from './fit.js';

const WEAPON_SLOTS = ['longGun', 'handGun', 'melee'];
const TOP = 5;
const WEAPON_ZH = { ranged: '远程武器', melee: '近战武器', any: '通用' };

export function createWeapons(model, deps = {}) {
  const gear = model.gear;
  const setQuery = typeof deps.setQuery === 'function' ? deps.setQuery : null;
  const gearReady = () => gear.mutator.length > 0;

  const root = h('div', { class: 'lab-wp' });
  const bar = h('div', { class: 'lab-wp__bar' });
  const curHost = h('div', { class: 'lab-wp__cur' });
  const mutHost = h('div', { class: 'lab-wp__rows' });
  const modHost = h('div', { class: 'lab-wp__rows' });

  const state = {
    slot: 'longGun',
    playstyle: S.playstyleId(),
  };

  const scope = createScope();
  let destroyed = false;

  /* ---------------------- 适配模块（懒装配） ---------------------- */
  let scorer = null;
  let fit = null;
  let fitError = '';
  function ensureEngines() {
    if (fit || fitError) return;
    try {
      scorer = createScorer(gear);
      // 传整模型：fit 需要武器元数据才能算「与武器标签契合」加成（lab-score 兼容整模型）
      fit = createFit(model, scorer);
    } catch (err) {
      fitError = String((err && err.message) || err || '未知错误');
      console.error('[lab:weapons] 适配模块初始化失败', err);
    }
  }

  /* ---------------------- 工具 ---------------------- */
  function currentWeaponId() { return store.build.get(state.slot) || null; }
  function currentWeaponName() {
    const id = currentWeaponId();
    return id ? (model.nameOf(id) || id) : '';
  }
  function syncQuery(extra = {}) {
    if (!setQuery) return;
    setQuery({
      wslot: state.slot,
      ps: state.playstyle === 'general' ? '' : state.playstyle,
      ...extra,
    });
  }
  function chooseSlot(slot) {
    if (slot === state.slot) return;
    state.slot = slot;
    syncQuery();
    renderBar();
    renderCurrent();
    renderLists();
  }
  function choosePlaystyle(id) {
    if (id === state.playstyle) return;
    state.playstyle = id;
    if (S.playstyleId() !== id) S.setPlaystyle(id);
    syncQuery();
    renderBar();
    renderLists();
  }

  /* ---------------------- 当前武器 / 挂件 ---------------------- */
  function renderCurrent() {
    clear(curHost);
    const id = currentWeaponId();
    const att = S.attachmentOf(state.slot);
    const mut = att.mutator ? (gear.of(att.mutator) || {}).zh || model.nameOf(att.mutator) || att.mutator : '';
    const mod = att.mod ? (gear.of(att.mod) || {}).zh || model.nameOf(att.mod) || att.mod : '';
    curHost.append(
      h('div', { class: 'lab-wp__currow' },
        h('span', { class: 'lab-wp__curk', text: '当前武器' }),
        id
          ? h('span', { class: 'lab-wp__curv' }, itemMedia(model.iconOf(id), { size: 22 }), h('span', { text: currentWeaponName() }))
          : h('span', { class: 'muted', text: '未选择（去上方工作台选一把）' }),
      ),
      h('div', { class: 'lab-wp__currow' },
        h('span', { class: 'lab-wp__curk', text: '突变因子' }),
        mut ? h('span', { class: 'lab-wp__curv', text: mut }) : h('span', { class: 'muted', text: '未设置' }),
        h('span', { class: 'lab-wp__curk', text: '改装' }),
        state.slot === 'melee'
          ? h('span', { class: 'muted', text: '近战无改装槽' })
          : (mod ? h('span', { class: 'lab-wp__curv', text: mod }) : h('span', { class: 'muted', text: '未设置' })),
      ),
    );
  }

  /* ---------------------- 顶栏 ---------------------- */
  function renderBar() {
    clear(bar);
    const slotWrap = h('div', { class: 'lab-wp__slots' },
      h('span', { class: 'lab-wp__barlabel' }, icon('longgun', { size: 12 }), h('span', { text: '武器槽' })),
    );
    for (const slot of WEAPON_SLOTS) {
      slotWrap.append(h('button', {
        class: `chip chip--sm${state.slot === slot ? ' is-on' : ''}`, type: 'button',
        attrs: { title: `查看 ${SLOT_LABEL[slot] || slot} 的突变因子与改装` },
        on: { click: () => chooseSlot(slot) },
      }, icon(SLOT_ICON[slot] || 'longgun', { size: 12 }), h('span', { text: SLOT_LABEL[slot] || slot })));
    }
    bar.append(slotWrap);

    const psWrap = h('div', { class: 'lab-wp__ps' },
      h('span', { class: 'lab-wp__barlabel' }, icon('target', { size: 12 }), h('span', { text: '流派' })),
    );
    for (const p of gear.playstyles) {
      psWrap.append(h('button', {
        class: `chip chip--sm${state.playstyle === p.id ? ' is-on' : ''}`, type: 'button',
        attrs: p.desc ? { title: p.desc } : undefined,
        on: { click: () => choosePlaystyle(p.id) },
      }, h('span', { text: p.zh })));
    }
    if (!gear.playstyles.length) {
      psWrap.append(h('span', { class: 'muted', attrs: { style: 'font-size:11.5px' }, text: '流派表尚未载入' }));
    }
    bar.append(psWrap);
  }

  /* ---------------------- 行 ---------------------- */
  function scoreBadge(item) {
    return h('span', { class: 'lab-score' },
      h('span', { class: 'lab-score__k', text: '适配分' }),
      h('b', { text: fmt.pct(item.score, 1) }));
  }

  function weaponBadge(weapon) {
    const zh = WEAPON_ZH[weapon] || WEAPON_ZH.any;
    return h('span', { class: 'badge badge--neutral', attrs: { title: '该突变因子可装的武器类型' }, text: zh });
  }

  function row(item, kind) {
    const g = gear.of(item.id) || {};
    const zh = item.zh || g.zh || model.nameOf(item.id) || item.id;
    const en = g.en || '';
    // 中文效果句缺失时回退英文原文（原文属允许的英文内容，不改译）
    const effectZh = g.effectZh || '';
    const effectEn = g.effectEn || '';
    const effect = effectZh || effectEn;
    const known = !!model.itemOf(item.id);
    const curId = kind === 'mutator' ? S.mutatorOf(state.slot) : S.modOf(state.slot);
    const isCur = curId === item.id;
    const nameEl = known
      ? h('button', {
        class: 'lab-wp__name', type: 'button', attrs: { title: `${zh}${en ? `（${en}）` : ''} · 打开物品详情` },
        on: { click: () => openItemDetail(item.id, { from: 'lab' }) },
      }, h('span', { text: zh }))
      : h('span', { class: 'lab-wp__name', text: zh });
    return h('div', { class: `lab-wp__row${isCur ? ' is-cur' : ''}` },
      h('div', { class: 'lab-wp__rowhead' },
        nameEl,
        en ? h('span', { class: 'lab-wp__en', text: en }) : '',
        kind === 'mutator' ? weaponBadge(item.weapon) : '',
        scoreBadge(item),
        isCur ? h('span', { class: 'badge badge--gold', text: '当前' }) : '',
        h('div', { class: 'grow' }),
        isCur
          ? h('button', { class: 'btn btn--quiet btn--sm', type: 'button', disabled: true }, icon('check', { size: 12 }), h('span', { text: '已写入' }))
          : h('button', {
            class: 'btn btn--ghost btn--sm', type: 'button',
            attrs: { title: `写入${state.slot === 'melee' ? '近战武器' : (SLOT_LABEL[state.slot] || '')}的${kind === 'mutator' ? '突变因子' : '改装'}槽` },
            on: {
              click: () => {
                if (kind === 'mutator') S.setMutator(state.slot, item.id);
                else S.setModOf(state.slot, item.id);
                ui.toast(`已写入${kind === 'mutator' ? '突变因子' : '改装'}：${zh}`, 'ok');
              },
            },
          }, icon('flask', { size: 12 }), h('span', { text: '写入' })),
      ),
      h('div', { class: `lab-wp__eff${effectZh ? '' : ' is-en'}`, attrs: effect ? { title: effect } : undefined },
        effect || h('span', { class: 'muted', text: '效果原文待验证' })),
      h('div', { class: 'lab-wp__why' },
        icon('target', { size: 11 }),
        h('span', { text: `适配流派：${Array.isArray(item.why) && item.why.length ? item.why.join(' · ') : '维度命中较少'}` }),
      ),
    );
  }

  function columnShell(iconName, title, sub) {
    return h('div', { class: 'lab-wp__colhead' },
      icon(iconName, { size: 13 }), h('span', { class: 'lab-wp__coltitle', text: title }),
      sub ? h('span', { class: 'lab-wp__colsub', text: sub }) : '');
  }

  function renderLists() {
    clear(mutHost);
    clear(modHost);
    if (!gearReady()) {
      mutHost.append(emptyState('info', '装备目录尚未生成',
        '突变因子 / 改装列表需要 data/lab_gear.json。数据生成链产出后本面板会自动接上。'));
      modHost.append(emptyLine('等待装备目录。', 'info'));
      return;
    }
    ensureEngines();
    if (!fit) {
      mutHost.append(emptyLine(`适配模块未就绪：${fitError || '未知原因'}`, 'warning'));
      modHost.append(emptyLine('适配模块未就绪。', 'warning'));
      return;
    }

    const weaponId = currentWeaponId();
    let mutators = [];
    let mods = [];
    try {
      mutators = fit.recommendMutators({
        weaponType: state.slot,
        weaponId,
        playstyleId: state.playstyle,
        limit: TOP,
      });
    } catch (err) {
      mutHost.append(emptyLine(`突变因子适配失败：${String((err && err.message) || err || '未知错误')}`, 'warning'));
    }
    if (state.slot === 'melee') {
      modHost.append(emptyLine('近战武器没有可更换的改装槽；固有改装数据待验证。', 'info'));
    } else {
      try {
        mods = fit.recommendMods({
          weaponType: state.slot,
          weaponId,
          playstyleId: state.playstyle,
          limit: TOP,
        });
      } catch (err) {
        modHost.append(emptyLine(`改装适配失败：${String((err && err.message) || err || '未知错误')}`, 'warning'));
      }
    }

    const mutList = Array.isArray(mutators) ? mutators : [];
    if (!mutList.length) {
      mutHost.append(emptyLine('当前武器类型下没有可用的突变因子候选（或全部被缺件排除）。', 'filter'));
    } else {
      for (const item of mutList) mutHost.append(row(item, 'mutator'));
      if (mutators && mutators.note) mutHost.append(h('div', { class: 'lab-wp__note muted', text: String(mutators.note) }));
    }

    if (state.slot !== 'melee') {
      const modList = Array.isArray(mods) ? mods : [];
      if (!modList.length) {
        modHost.append(emptyLine('当前武器类型下没有可用的改装候选。', 'filter'));
      } else {
        for (const item of modList) modHost.append(row(item, 'mod'));
        if (mods && mods.note) modHost.append(h('div', { class: 'lab-wp__note muted', text: String(mods.note) }));
      }
    }
  }

  /* ---------------------- URL ---------------------- */
  function applyParams(p) {
    if (destroyed || !p) return;
    const nextSlot = WEAPON_SLOTS.includes(p.wslot) ? p.wslot : state.slot;
    const validPs = gear.playstyleById.has(p.ps) ? p.ps : null;
    const nextPs = validPs || state.playstyle;
    const changed = nextSlot !== state.slot || nextPs !== state.playstyle;
    if (!changed) return;
    const slotChanged = nextSlot !== state.slot;
    state.slot = nextSlot;
    state.playstyle = nextPs;
    if (nextPs !== S.playstyleId()) S.setPlaystyle(nextPs);
    renderBar();
    renderCurrent();
    if (slotChanged || validPs) renderLists();
  }

  /* ---------------------- 组装 ---------------------- */
  const shell = panel('武器改装', {
    iconName: 'metagem',
    sub: '突变因子 / 改装 · 按武器类型与流派适配',
    flush: true,
  });
  shell.body.append(
    bar,
    curHost,
    h('div', { class: 'lab-wp__cols' },
      h('section', { class: 'lab-wp__col' }, columnShell('metagem', '突变因子', `前 ${TOP} · 含效果原文`), mutHost),
      h('section', { class: 'lab-wp__col' }, columnShell('mod', '改装', `前 ${TOP} · 远程武器可换`), modHost),
    ),
    h('div', { class: 'lab-note' }, icon('info', { size: 12 }),
      h('span', { text: '突变因子按武器类型过滤（通用因子任何武器可用）；改装只有远程武器能换。适配分复用饰品组合的维度口径，并对「与武器标签契合」的候选项小幅加成；写入后随配装一起存档。' })),
  );
  root.append(shell.el);

  scope.add(S.on((reason) => {
    if (reason === 'playstyle') {
      const id = S.playstyleId();
      if (id !== state.playstyle) {
        state.playstyle = id;
        renderBar();
        renderLists();
      }
      return;
    }
    if (reason === 'attachment' || reason === 'missing') {
      renderCurrent();
      renderLists();
    }
  }));
  scope.add(store.on('build', () => {
    renderCurrent();
    renderBar();
    if (gearReady()) renderLists();
  }));

  function renderAll() {
    renderBar();
    renderCurrent();
    renderLists();
  }

  renderAll();

  return {
    el: root,
    refresh: renderAll,
    applyParams,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      scope.dispose();
    },
  };
}

export default createWeapons;
