/* =============================================================================
   遗迹2 · 遗物档案 — lab/saved.js（v2）
   存档导出面板：具名配装保存/载入（含 meta：特性/碎片/消耗品/场景/档位）、
   导出给 AI、清空当前配装；以及缺件与可用池摘要。
   ========================================================================== */
import { h, clear, fmt, copyText, downloadText } from '../core/dom.js';
import { icon } from '../core/icons.js';
import { store } from '../core/store.js';
import { ui } from '../core/ui.js';
import * as S from './state.js';
import { createScope } from '../core/task.js';
import { panel, emptyLine } from './parts.js';
import { SLOT_LABEL } from './model.js';

const SLOT_ORDER = [
  'longGun', 'handGun', 'melee', 'head', 'body', 'legs', 'gloves',
  'amulet', 'ring1', 'ring2', 'ring3', 'ring4', 'relic', 'archetype1', 'archetype2',
];
export function createSaved(model) {
  const E = model.engine;
  const host = h('div');
  const nameOf = (id) => model.nameOf(id);
  const fmtTime = (ts) => {
    try { return new Date(ts).toLocaleString('zh-CN', { hour12: false, month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }); }
    catch { return ''; }
  };

  function slotsRows() {
    const slots = store.build.slots();
    return SLOT_ORDER.map((slot) => {
      const id = slots[slot] || null;
      if (!id) return { slot, label: SLOT_LABEL[slot], id: null, zh: null };
      const row = { slot, label: SLOT_LABEL[slot], id, zh: nameOf(id) };
      const p = model.pieceById.get(id);
      if (p) { row.armor = p.armor; row.weight = p.weight; }
      const m = E.modById.get(id);
      if (m && m.effect) row.effect = m.effect;
      return row;
    }).filter((r) => r.id);
  }

  function exportPayload() {
    const st = S.workbenchSummary(model);
    const m = S.meta();
    return {
      schema: 'r2-lab-build/v2',
      generated: new Date().toISOString(),
      name: store.state.build.name || '未命名配装',
      scenario: { id: S.scenarioId(), zh: E.scenarioById(S.scenarioId()).zh },
      classTarget: S.classTarget(),
      settings: {
        traitLevels: m.traitLevels || {},
        traitUsed: S.traitUsed(),
        traitCap: 10,
        fragments: S.fragments(),
        consumables: S.consumables(),
        seedProfile: S.seedProfile(),
        seedPerks: S.seedPerks(),
      },
      slots: slotsRows().map((r) => ({ slot: r.slot, slotZh: r.label, id: r.id, zh: r.zh, armor: r.armor, weight: r.weight })),
      computed: {
        filledArmor: st.filled,
        armor: fmt.round(st.armor, 1), armorBase: fmt.round(st.sumA, 1), armorDR: fmt.round(st.adr, 4),
        flatDR: fmt.round(st.fdr, 4), enemyDR: fmt.round(st.edr, 4),
        totals: Object.fromEntries(E.RES.map((t) => [t, fmt.round(st.totals[t], 4)])),
        worstDR: fmt.round(st.worst, 4),
        resistances: Object.fromEntries(E.RES.map((t, i) => [t, fmt.round(st.res[i], 1)])),
        score: fmt.round(st.score, 4),
        weight: fmt.round(st.weight, 1), weightClass: st.cls, thresholds: st.T.map((x) => fmt.round(x, 1)),
        stamina: fmt.round(st.stam, 1), evadeCost: fmt.round(st.evade, 1), dodges: st.dodges,
        staminaRegen: fmt.round(st.regen, 1), iframes: st.iframes, recovery: st.recovery, sprint: st.sprint,
        ehp: fmt.round(st.ehp, 1), hpMax: fmt.round(st.hpTotal, 1), shieldPct: fmt.round(st.shieldPct, 4),
        hpRegen: fmt.round(st.hpRegen, 1), lifesteal: st.lifesteal,
      },
      missing: S.missingIds().map((id) => ({ id, zh: nameOf(id) })),
      ownedCount: S.ownedCount(),
      formula: {
        armorDR: `A/(A+${E.K})`, cap: E.C.CAP, ehpAssumption: '基础生命 100',
        note: '推荐枚举 key=场景分，前 300 候选内排序',
      },
    };
  }
  
  function openSaveModal() {
    const input = h('input', { class: 'input', type: 'text', value: store.state.build.name || '', placeholder: '例如：护卫者重装 · 洛斯曼', attrs: { maxlength: '40' } });
    const { close } = ui.openModal({
      title: '保存当前配装',
      body: h('div', { class: 'stack-3' },
        h('div', { class: 'field' }, h('label', { class: 'field__label', text: '配装名称' }), input),
        h('div', { class: 'muted', attrs: { style: 'font-size:11.5px' } },
          '保存 15 槽装备 + meta（特性等级 / 碎片 / 消耗品 / 场景 / 档位目标）；同名覆盖，最多 40 条。'),
      ),
      foot: [
        h('button', { class: 'btn btn--quiet', type: 'button', text: '取消', on: { click: () => close() } }),
        h('button', {
          class: 'btn btn--primary', type: 'button', text: '保存',
          on: {
            click: () => {
              const rec = store.saved.save(input.value || `配装 ${fmtTime(Date.now())}`);
              store.build.setName(rec.name);
              close();
              ui.toast(`已保存配装「${rec.name}」`, 'ok');
              render();
            },
          },
        }),
      ],
    });
    setTimeout(() => input.focus({ preventScroll: true }), 80);
  }

  function openLoadModal() {
    const list = store.saved.list();
    const body = h('div', { class: 'stack-2' });
    if (!list.length) body.append(emptyLine('还没有存档；点「保存当前配装」把 15 槽与设置存成具名配装。', 'save'));
    for (const rec of list) {
      const slots = (rec.build && rec.build.slots) || {};
      const filled = Object.values(slots).filter(Boolean).length;
      const meta = (rec.build && rec.build.meta) || {};
      const traitN = Object.keys(meta.traitLevels || {}).filter((k) => meta.traitLevels[k] > 0).length;
      body.append(h('div', { class: 'lab-savedrow' },
        h('div', { class: 'grow' },
          h('div', { class: 'lab-savedrow__name', text: rec.name }),
          h('div', { class: 'muted', attrs: { style: 'font-size:11px' }, text: `${fmtTime(rec.ts)} · ${filled} 槽 · 特性 ${traitN} 个 · 场景 ${E.scenarioById(meta.scenario || 'general').zh}` }),
        ),
        h('button', {
          class: 'btn btn--ghost btn--sm', type: 'button', text: '载入',
          on: { click: () => { store.saved.load(rec.id); ui.closeModal(); ui.toast(`已载入配装「${rec.name}」`, 'ok'); render(); } },
        }),
        h('button', {
          class: 'iconbtn iconbtn--sm iconbtn--danger', type: 'button', title: '删除存档', 'aria-label': '删除存档',
          on: {
            click: async () => {
              const ok = await ui.confirm({ title: '删除存档', body: `将删除「${rec.name}」这条配装存档（不影响当前配装）。`, ok: '删除', danger: true });
              if (!ok) return;
              store.saved.remove(rec.id);
              ui.closeModal();
              ui.toast('已删除存档', 'ok');
              render();
            },
          },
        }, icon('trash', { size: 14 })),
      ));
    }
    ui.openModal({
      title: `配装存档（${list.length} 条）`, body,
      foot: h('button', { class: 'btn btn--quiet', type: 'button', text: '关闭', on: { click: () => ui.closeModal() } }),
    });
  }

  function openExportModal() {
    const payload = exportPayload();
    const json = JSON.stringify(payload, null, 2);
    const prompt = [
      '你是《遗迹2》的配装顾问。下面是我在本地实验室里搭的 15 槽配装（含职业与特性等级），',
      '以及按游戏公式算出的防御 / 生存 / 机动面板。请基于这些数值回答：',
      '1) 这套在所列场景下的主要短板；2) 三个最值得换的槽位与替代理由；',
      '3) 如果要打更高难度，优先补哪项属性。请用简体中文，先给结论再给依据。',
      '', '```json', json, '```',
    ].join('\n');
    const area = h('textarea', { class: 'input lab-export', attrs: { readonly: 'readonly', spellcheck: 'false', rows: '12', 'aria-label': '导出内容' } });
    area.value = prompt;
    ui.openModal({
      title: '导出配装给 AI', kicker: '复制整段粘贴给任意 AI 助手', wide: true,
      body: h('div', { class: 'stack-3' },
        h('p', { class: 'muted', attrs: { style: 'font-size:12px' } },
          '内容 = 中文提问 + 15 槽清单 + meta（特性/碎片/消耗品/场景/档位）+ 防御/生存/机动面板 + 缺件标记。不含任何游戏文件读写。'),
        area,
      ),
      foot: [
        h('button', { class: 'btn btn--ghost', type: 'button', text: '下载 JSON', on: { click: () => { downloadText(`r2-lab-build-${Date.now()}.json`, json); ui.toast('已下载配装 JSON', 'ok'); } } }),
        h('button', { class: 'btn btn--quiet', type: 'button', text: '关闭', on: { click: () => ui.closeModal() } }),
        h('button', {
          class: 'btn btn--primary', type: 'button', text: '复制给 AI',
          on: { click: async () => { const ok = await copyText(prompt); ui.toast(ok ? '已复制，去粘贴给 AI 吧' : '复制失败，请手动全选复制', ok ? 'ok' : 'warn'); } },
        }),
      ],
    });
    setTimeout(() => { area.focus(); area.select(); }, 80);
  }

  function render() {
    clear(host);
    const list = store.saved.list();
    host.append(h('div', { class: 'lab-actions' },
      h('button', { class: 'btn btn--ghost', type: 'button', on: { click: openSaveModal } }, icon('save', { size: 14 }), h('span', { text: '保存当前配装' })),
      h('button', { class: 'btn btn--ghost', type: 'button', on: { click: openLoadModal } }, icon('clipboard', { size: 14 }), h('span', { text: `载入存档${list.length ? `（${list.length}）` : ''}` })),
      h('button', { class: 'btn btn--ghost', type: 'button', on: { click: openExportModal } }, icon('external', { size: 14 }), h('span', { text: '导出给 AI' })),
      h('button', {
        class: 'btn btn--danger btn--sm', type: 'button',
        on: {
          click: async () => {
            // confirm(string) 按纯文本渲染；需要强调时显式传 Node（勿拼 HTML 字符串）
            const ok = await ui.confirm({ title: '清空当前配装', body: h('p', { class: 'dim' }, '将移除 15 个槽位里的全部装备，并清空特性/碎片/消耗品设置。', h('b', { text: '不影响' }), '「已拥有」「收藏」与具名存档。'), ok: '清空', danger: true });
            if (!ok) return;
            store.build.clear();
            store.build.setMeta({ traitLevels: {}, fragments: [], consumables: [], seedPerks: [], seedProfile: null });
            ui.toast('已清空当前配装', 'ok');
            render();
          },
        },
      }, icon('trash', { size: 14 }), h('span', { text: '清空当前配装' })),
    ));

    // 可用池摘要
    const missingIds = S.missingIds();
    host.append(h('div', { class: 'lab-bar-title', attrs: { style: 'margin-top:14px' } }, '缺件与可用池'),
      h('div', { class: 'lab-pool' },
        h('span', { class: 'badge badge--neutral', text: `已拥有 ${S.ownedCount()} 件` }),
        h('span', { class: 'badge badge--low', text: `缺件 ${missingIds.length} 件` }),
        missingIds.length ? h('button', { class: 'btn btn--quiet btn--sm', type: 'button', text: '清空缺件', on: { click: () => { S.clearMissing(); ui.toast('已清空缺件标记', 'ok'); } } }) : '',
      ),
    );
    if (missingIds.length) {
      host.append(h('div', { class: 'lab-chips' }, missingIds.map((id) => h('span', { class: 'pill' },
        h('span', { text: nameOf(id) }),
        h('button', {
          type: 'button', title: '取消缺件标记', 'aria-label': '取消缺件标记',
          on: { click: () => { S.toggleMissing(id); ui.toast(`已取消缺件：${nameOf(id)}`, 'ok'); } },
        }, icon('x', { size: 10 })),
      ))));
    } else {
      host.append(h('div', { class: 'lab-note' }, icon('info', { size: 12 }),
        h('span', { text: '缺件独立于「已拥有」：标记后可从推荐/逐槽替换的候选池排除，但不影响拥有状态。' })));
    }

    host.append(h('div', { class: 'lab-bar-title', attrs: { style: 'margin-top:14px' } }, '说明'),
      h('div', { class: 'lab-note' }, icon('info', { size: 12 }),
        h('span', { text: '存档与设置都只写本机浏览器；增益档（预设）只是起点，真正的状态是「特性等级 / 碎片 / 消耗品 / 场景 / 档位目标」，随配装存档一起走。' })),
    );
  }

  const shell = panel('存档导出', { iconName: 'save', sub: '15 槽 + 设置一起保存' });
  shell.body.append(host);
  const scope = createScope();
  scope.add(store.on('saved', render));
  scope.add(store.on('owned', render));
  scope.add(S.on((reason) => { if (reason === 'missing') render(); }));
  render();
  return { el: shell.el, refresh: render, applyParams() {}, destroy() { scope.dispose(); } };
}

export default createSaved;
