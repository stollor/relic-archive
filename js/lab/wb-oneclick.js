/* =============================================================================
   遗迹2 · 遗物档案 — lab/wb-oneclick.js（装配台：一键配齐）
   按当前流派 / 场景把可计算的槽位一次填好：四件护甲（引擎穷举 Top1）→ 饰品组合 Top1
   → 特性推荐 Top10（满级）→ 圣物碎片推荐 3 槽 → 已选武器的突变因子 / 改装。
   口径与各分类推荐一致：维度分是近似比较值，不是游戏内精确数值；未建模的槽位（职业 / 圣物）不动。
   ========================================================================== */
import * as S from './state.js';
import { createScorer } from './score.js';
import { createComboSearch } from './combos.js';
import { createFit } from './fit.js';
import { TRINKET_SLOTS, WEAPON_SLOTS } from './wb-slots.js';

/** 已选武器是否远程（长枪 / 手枪 → ranged；近战 → melee） */
function weaponTypeOf(slot) { return slot === 'melee' ? 'melee' : 'ranged'; }

/**
 * 一键配齐。同步执行，调用方负责先给用户「计算中」反馈（建议 setTimeout 让出一帧）。
 * @returns {{filled:string[], skipped:string[], error?:string}}
 */
export function applyRecommendedAll(ctx) {
  const { model, E, S: St, store, ui } = ctx;
  const filled = [];
  const skipped = [];
  const playstyleId = St.playstyleId();
  const missing = [...St.missingSet()].sort().join(',');
  void missing;
  try {
    /* 1) 四件护甲：当前设置下场景分 Top1 */
    const armorRes = E.enumerateTop({
      picks: St.workbenchPicks(model),
      scenarioId: St.scenarioId(),
      classTarget: St.classTarget(),
      exclude: St.missingSet(),
      top: 1,
    });
    const armorIds = armorRes && armorRes.top && armorRes.top[0] ? armorRes.top[0].ids : [];
    if (armorIds.length === 4) { St.writeArmor(armorIds); filled.push('护甲四件'); } else skipped.push('护甲');

    /* 2) 饰品：按流派组合 Top1（不覆盖已固定件：直接整组推荐） */
    try {
      const scorer = createScorer(model.gear);
      const combos = createComboSearch(model.gear, scorer);
      const res = combos.recommendTrinkets({
        playstyleId,
        excludeIds: St.missingSet(),
        limit: 1,
      });
      const combo = res && res.combos && res.combos[0];
      if (combo) {
        if (combo.amulet) store.build.set('amulet', combo.amulet);
        const rings = Array.isArray(combo.rings) ? combo.rings.slice(0, 4) : [];
        rings.forEach((id, i) => store.build.set(`ring${i + 1}`, id));
        TRINKET_SLOTS.slice(rings.length + 1).forEach((slot) => store.build.remove(slot));
        filled.push('饰品组合');
      } else skipped.push('饰品');

      /* 3) 特性：推荐前 10 满级；4) 碎片：推荐前 3 槽；5) 已选武器挂件 */
      const fit = createFit(model, scorer);
      const cap = St.TRAIT_CAP || 10;
      const traits = fit.recommendTraits({ playstyleId, limit: cap });
      St.clearTraits();
      let traitN = 0;
      for (const t of traits) {
        const r = St.setTraitLevel(t.id, St.TRAIT_MAX_LEVEL || 10);
        if (r && r.ok) traitN += 1;
      }
      if (traitN) filled.push(`特性 ${traitN} 个`);

      const frags = fit.recommendFragments({ playstyleId, limit: 12 });
      const picked = (Array.isArray(frags) ? frags : []).slice(0, 3);
      for (let i = 0; i < 3; i += 1) St.setFragmentSlot(i, picked[i] ? picked[i].id : null);
      if (picked.length) filled.push(`碎片 ${picked.length} 槽`);

      let attachN = 0;
      for (const slot of WEAPON_SLOTS) {
        const weaponId = store.build.get(slot);
        if (!weaponId) continue;
        const type = weaponTypeOf(slot);
        const mut = fit.recommendMutators({ weaponType: type, weaponId, playstyleId, limit: 1 })[0];
        if (mut && St.setMutator(slot, mut.id)) attachN += 1;
        if (type !== 'melee') {
          const mod = fit.recommendMods({ weaponType: type, weaponId, playstyleId, limit: 1 })[0];
          if (mod && St.setModOf(slot, mod.id)) attachN += 1;
        }
      }
      if (attachN) filled.push(`武器挂件 ${attachN} 件`);
    } catch (err) {
      console.error('[lab:oneclick]', err);
      return { filled, skipped, error: '饰品 / 特性 / 碎片推荐失败' };
    }

    skipped.push('职业', '圣物');
    return { filled, skipped };
  } catch (err) {
    console.error('[lab:oneclick] 护甲推荐失败', err);
    return { filled, skipped, error: '护甲推荐失败' };
  }
}

/** 一键配齐的 toast 文案（统一口径） */
export function oneclickToast(result, ui) {
  if (!result) { ui.toast('一键配齐失败', 'warn'); return; }
  if (result.error) { ui.toast(`${result.error}（已完成的槽位保留）`, 'warn'); return; }
  const done = result.filled.length ? `已配齐：${result.filled.join('、')}` : '没有可自动配齐的槽位';
  const skip = result.skipped.length ? `；未建模：${result.skipped.join('、')}` : '';
  ui.toast(done + skip, 'ok');
}

export default { applyRecommendedAll, oneclickToast };
