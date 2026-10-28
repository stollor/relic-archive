/* =============================================================================
   遗迹2 · 遗物档案 — lab/engine.js
   实验室纯计算引擎（无 DOM / 无 fetch）。语义逐字对齐 build/armor_tool/SPEC.md §2
   与 build/armor_tool/site/lab.js（旧页引擎，已与 Python 对拍 330/330）。

   公式（唯一来源 site_data.meta.formula）：
     WEIGHT    = max(0, Σw × (1+Σweight_pct) + Σweight_flat)
     THRESH    = [25,50,75] + Σweight_threshold_flat，clamp [5,98]
     CLASS     = w ≤ T1 轻装 / ≤ T2 中装 / ≤ T3 重装 / 其余 超重（全部 + WEIGHT_EPS）
     ARMOR     = (Σarmor + Σarmor_flat) × (1+Σarmor_efficacy)
     ARMOR_DR  = ARMOR / (ARMOR + 200)
     RES_i     = (Σres_i + Σres_flat_i) × (1+Σres_pct_i)
     FLAT_DR   = clamp(Σflat_dr, -0.95, 0.95)（BULWARK 层数查表 7/13/18/22/25/27%）
     TOTAL_i   = min(0.8, 1-(1-ARMOR_DR)(1-FLAT_DR)(1-RES_i/100))
     elemental_dr 独立乘区，只作用 fire / shock / corrosive
     EFF_i     = 1-(1-TOTAL_i)(1-Σenemy_damage_reduction)
     STAM      = (100+Σstamina_max) × (1+Σstamina_pct)
     EVADE     = 25 × (1+档位惩罚+Σstamina_cost_pct)
     REGEN     = 33+Σstamina_regen
   ========================================================================== */

export const CLASSES = ['LIGHT', 'MEDIUM', 'HEAVY', 'ULTRA'];
export const CLASS_ZH = { LIGHT: '轻装', MEDIUM: '中装', HEAVY: '重装', ULTRA: '超重' };
export const RES_KEYS = ['bleed', 'fire', 'shock', 'corrosive', 'blight'];
export const ALL_KEYS = ['physical', ...RES_KEYS];
export const SLOT_KEYS = ['head', 'body', 'legs', 'gloves'];
// 护甲槽中文名只在 lab/model.js 的 SLOT_LABEL 一处维护（这里不重复定义，避免两套翻译漂移）
export const TYPE_ZH = {
  physical: '物理', bleed: '流血', fire: '火焰', shock: '电击', corrosive: '腐蚀', blight: '枯萎',
};

/** 与 Python 对齐的浮点容差：25.000000000000004 应判为 ≤25 */
export const WEIGHT_EPS = 1e-6;

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const num = (v, d) => (isNum(v) ? v : d);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

/** 从 site_data.meta.formula 取常数；缺字段时用旧引擎默认值兜底 */
export function constantsFromMeta(meta) {
  const f = (meta && meta.formula) || {};
  return {
    K: num(f.armor_k, 200),
    CAP: num(f.max_total_dr, 0.8),
    EPS: num(f.weight_eps, WEIGHT_EPS),
    THR_BASE: Array.isArray(f.base_thresh) && f.base_thresh.length === 3 ? f.base_thresh.map((x) => num(x, 0)) : [25, 50, 75],
    THR_MIN: num(f.thresh_min, 5),
    THR_MAX: num(f.thresh_max, 98),
    FDR_MIN: num(f.flat_dr_min, -0.95),
    FDR_MAX: num(f.flat_dr_max, 0.95),
    EDR_MIN: num(f.enemy_dr_min, 0),
    EDR_MAX: num(f.enemy_dr_max, 0.99),
    BULWARK: Array.isArray(f.bulwark_table) && f.bulwark_table.length
      ? f.bulwark_table.map((x) => num(x, 0))
      : [0.07, 0.13, 0.18, 0.22, 0.25, 0.27],
    PENALTY: f.class_penalty || { LIGHT: 0, MEDIUM: 0.25, HEAVY: 0.5, ULTRA: 0.75 },
    IFRAMES: f.class_iframes || { LIGHT: 12, MEDIUM: 11, HEAVY: 10, ULTRA: 15 },
    RECOVERY: f.class_recovery || { LIGHT: 22, MEDIUM: 22, HEAVY: 30, ULTRA: 65 },
    N_IFRAMES: f.neutral_iframes || { LIGHT: 8, MEDIUM: 8, HEAVY: 8, ULTRA: 9 },
    N_RECOVERY: f.neutral_recovery || { LIGHT: 13, MEDIUM: 13, HEAVY: 13, ULTRA: 39 },
    SPRINT: f.class_sprint || { LIGHT: 8, MEDIUM: 10, HEAVY: 12, ULTRA: 14 },
    STAM_BASE: num(f.base_stamina, 100),
    REGEN_BASE: num(f.base_stamina_regen, 33),
    EVADE_BASE: num(f.base_evade_cost, 25),
    MIN_EVADE: num(f.min_evade_stamina, 5),
    MAX_WEIGHT: num(f.max_weight, 100),
    FRAME_RATE: num(f.frame_rate, 30),
    ELEMENTAL: Array.isArray(f.elemental_types) && f.elemental_types.length ? f.elemental_types.slice() : ['fire', 'shock', 'corrosive'],
    CLASSES: Array.isArray(f.class_order) && f.class_order.length ? f.class_order.slice() : CLASSES,
    RES_KEYS: Array.isArray(f.res_types) && f.res_types.length ? f.res_types.slice() : RES_KEYS,
  };
}

/* ----------------------------- 累加器 ----------------------------- */
function emptyAcc() {
  return {
    ae: 0, armorFlat: 0, wPct: 0, wFlat: 0, thrFlat: 0,
    resFlat: [0, 0, 0, 0, 0], resPct: [0, 0, 0, 0, 0],
    flatDR: 0, edr: 0, stamMax: 0, stamPct: 0, stamRegen: 0, stamCost: 0,
    elementalDR: 0, typeDR: [0, 0, 0, 0, 0], drScale: [],
    evadeWin: 0, evadeDist: 0, evadeSpd: 0, hpMax: 0, hpPct: 0, shieldPct: 0, hpRegen: 0,
    lifesteal: 0,
  };
}

function scaleObj(o, f) {
  const r = {};
  for (const [k, v] of Object.entries(o || {})) r[k] = typeof v === 'number' ? v * f : scaleObj(v, f);
  return r;
}

/* ----------------------------- 引擎工厂 ----------------------------- */
/**
 * createEngine(site) → 引擎实例。site 即 api.site() 的 site_data.json。
 * 所有计算都从 site 数据推导，不在 UI 里写魔法数字。
 */
export function createEngine(site) {
  const S = site || {};
  const META = S.meta || {};
  const C = constantsFromMeta(META);
  const { K, CAP, EPS } = C;
  const RES = C.RES_KEYS;
  const ELEMENTAL = C.ELEMENTAL;
  const CLASS_ORDER = C.CLASSES;

  const pieces = (S.pieces || []).map((p, i) => ({
    id: p.id, zh: p.zh || p.id, en: p.en || '',
    slot: p.slot, set: p.set || '', armor: num(p.armor, 0), weight: num(p.weight, 0),
    res: Array.isArray(p.res) && p.res.length === 5 ? p.res.map((x) => num(x, 0)) : [0, 0, 0, 0, 0],
    icon: p.icon || '', dobt: Array.isArray(p.dobtain) ? p.dobtain.slice() : [],
    dlc: p.dlc || '基础', idx: i,
  }));
  const pieceById = new Map(pieces.map((p) => [p.id, p]));
  const slotsOf = { head: [], body: [], legs: [], gloves: [] };
  for (const p of pieces) if (slotsOf[p.slot]) slotsOf[p.slot].push(p);

  const MODS = S.modifiers || {};
  const traits = MODS.traits || [];
  const rings = MODS.rings || [];
  const amulets = MODS.amulets || [];
  const fragments = MODS.fragments || [];
  const perks = MODS.perks || [];
  const consumables = MODS.consumables || [];
  const modById = new Map();
  for (const list of [traits, rings, amulets, fragments, perks, consumables]) {
    for (const m of list) if (m && m.id) modById.set(m.id, m);
  }

  const scenarios = S.scenarios || [];
  const profiles = S.profiles || [];
  const profileById = new Map(profiles.map((p) => [p.id, p]));

  /* -------------------- 修饰符展开 -------------------- */
  function traitPerLevel(t) {
    if (t.effect_per_level) return t.effect_per_level;
    if (t.effect_at_max) return scaleObj(t.effect_at_max, 1 / num(t.max_level, 10));
    return {};
  }

  function applyEffect(a, eff, factor, mod) {
    if (!eff) return;
    const dmgTypes = mod && mod.damage_types && mod.damage_types.length ? mod.damage_types : null;
    for (const [k, v] of Object.entries(eff)) {
      if (k === 'resistance_flat' || k === 'resistance_pct') {
        if (!v || typeof v !== 'object') continue;
        for (const [rk, raw] of Object.entries(v)) {
          const val = num(raw, 0) * factor;
          const idxs = rk === 'all' ? [0, 1, 2, 3, 4] : [RES.indexOf(rk)];
          for (const i of idxs) {
            if (i < 0) continue;
            if (k === 'resistance_flat') a.resFlat[i] += val; else a.resPct[i] += val;
          }
        }
        continue;
      }
      if (typeof v !== 'number') continue;
      const val = v * factor;
      switch (k) {
        case 'armor_efficacy': a.ae += val; break;
        case 'armor_flat': a.armorFlat += val; break;
        case 'weight_flat': a.wFlat += val; break;
        case 'weight_pct': a.wPct += val; break;
        case 'weight_threshold_flat': a.thrFlat += val; break;
        case 'elemental_dr': a.elementalDR += val; break;
        case 'flat_dr':
          if (dmgTypes) {
            for (const t of dmgTypes) {
              const i = RES.indexOf(t);
              if (i >= 0) a.typeDR[i] += val;
            }
          } else if (mod && mod.weight_class_dr_scaling) {
            a.drScale.push({
              v: val,
              step: num(mod.weight_class_dr_scaling.step_pct, 0),
              max: num(mod.weight_class_dr_scaling.max_steps, 3),
            });
          } else {
            a.flatDR += val;
          }
          break;
        case 'enemy_damage_reduction': a.edr += val; break;
        case 'stamina_max': a.stamMax += val; break;
        case 'stamina_pct': a.stamPct += val; break;
        case 'stamina_regen': a.stamRegen += val; break;
        case 'stamina_cost_pct': a.stamCost += val; break;
        case 'evade_window_pct': a.evadeWin += val; break;
        case 'evade_distance_pct': a.evadeDist += val; break;
        case 'evade_speed_pct': a.evadeSpd += val; break;
        case 'health_max': a.hpMax += val; break;
        case 'health_pct': a.hpPct += val; break;
        case 'shield_pct': a.shieldPct += val; break;
        case 'health_regen': a.hpRegen += val; break;
        case 'lifesteal':
        case 'health_leech': a.lifesteal += val; break;
        default: break;
      }
    }
  }

  /** picks: {traits:{id:lv}, rings:{id:true}|[id], amulet:id|null, perks, fragments, consumables} */
  function expandMods(picks) {
    const a = emptyAcc();
    const P = picks || {};
    for (const t of traits) {
      const lv = num(P.traits && P.traits[t.id], 0);
      if (lv <= 0) continue;
      applyEffect(a, traitPerLevel(t), lv, t);
    }
    const pickList = (list, sel) => {
      if (!sel) return;
      for (const m of list) {
        if (!m || !m.id) continue;
        if (!sel[m.id]) continue;
        const uptime = m.uptime == null ? 1 : num(m.uptime, 1);
        if (m.bulwark || (m.effect && m.effect.bulwark)) {
          const st = clamp(Math.round(num(m.stacks, 1)), 1, C.BULWARK.length);
          a.flatDR += C.BULWARK[st - 1] * uptime;
          continue;
        }
        applyEffect(a, m.effect || {}, num(m.stacks, 1) * uptime, m);
      }
    };
    pickList(rings, P.rings);
    pickList(fragments, P.fragments);
    pickList(perks, P.perks);
    pickList(consumables, P.consumables);
    for (const m of amulets) {
      if (!P.amulet || P.amulet !== m.id) continue;
      applyEffect(a, m.effect || {}, num(m.stacks, 1) * (m.uptime == null ? 1 : num(m.uptime, 1)), m);
    }
    return a;
  }

  /** profile → picks（含饰品，用于对照 330 预设） */
  function picksFromProfile(profile) {
    const p = typeof profile === 'string' ? profileById.get(profile) : profile;
    if (!p) return { traits: {}, rings: [], amulet: null, perks: [], fragments: [], consumables: [] };
    const toMap = (arr) => {
      const m = {};
      for (const id of arr || []) m[id] = true;
      return m;
    };
    return {
      traits: { ...(p.traits || {}) },
      rings: toMap(p.rings),
      amulet: p.amulet || null,
      perks: toMap(p.perks),
      fragments: toMap(p.fragments),
      consumables: toMap(p.consumables),
    };
  }

  /** profile 中「非装备增益」= 特性 + 职业专长 + 遗物碎片 + 消耗品 */
  function picksNonGear(profile) {
    const p = typeof profile === 'string' ? profileById.get(profile) : profile;
    if (!p) return { traits: {}, rings: {}, amulet: null, perks: {}, fragments: {}, consumables: {} };
    const toMap = (arr) => {
      const m = {};
      for (const id of arr || []) m[id] = true;
      return m;
    };
    return {
      traits: { ...(p.traits || {}) },
      rings: {}, amulet: null,
      perks: toMap(p.perks),
      fragments: toMap(p.fragments),
      consumables: toMap(p.consumables),
    };
  }

  /** 把一批饰品/装备 id 并成 picks 的饰品部分（只收有防御词条的） */
  function picksFromGear(ids) {
    const ringsMap = {};
    let amulet = null;
    for (const id of ids || []) {
      if (!id) continue;
      const m = modById.get(id);
      if (!m) continue;
      if (m.category === 'ring') ringsMap[id] = true;
      else if (m.category === 'amulet') amulet = id;
    }
    return { rings: ringsMap, amulet };
  }

  /* -------------------- 阈值 / 档位 / 场景 -------------------- */
  function thresholds(a) {
    const T = C.THR_BASE.map((t) => clamp(t + ((a && a.thrFlat) || 0), C.THR_MIN, C.THR_MAX));
    // 与 optimize.py 的 Prepared.thresh 一致：兜底保持单调
    T[1] = Math.max(T[1], T[0]);
    T[2] = Math.max(T[2], T[1]);
    return T;
  }
  function classIdx(w, T) {
    return w <= T[0] + EPS ? 0 : w <= T[1] + EPS ? 1 : w <= T[2] + EPS ? 2 : 3;
  }
  function scenarioById(id) {
    for (const s of scenarios) if (s.id === id) return s;
    return scenarios[0] || { id: 'general', zh: '通用', weights: { physical: 1 } };
  }
  function scoreOf(effs, sc) {
    if (!sc) return effs.physical;
    if (sc.mode === 'maxmin') {
      let m = 1;
      for (const t of ALL_KEYS) m = Math.min(m, effs[t] || 0);
      return m;
    }
    let sum = 0;
    const w = sc.weights || {};
    for (const [t, weight] of Object.entries(w)) sum += num(weight, 0) * (effs[t] || 0);
    return sum;
  }
  function scaleAdj(a, ci) {
    let s = 0;
    for (const d of a.drScale || []) s += d.v + Math.min(ci, d.max) * d.step;
    return s;
  }
  function typeRemainders(a) {
    const el = clamp(a.elementalDR, -0.95, 0.95);
    const out = [];
    for (let i = 0; i < 5; i += 1) {
      let rem = 1 - clamp(a.typeDR[i], -0.95, 0.95);
      if (ELEMENTAL.includes(RES[i])) rem *= (1 - el);
      out.push(rem);
    }
    return out;
  }

  /* -------------------- 核心：输入 → 面板数值 -------------------- */
  /**
   * statsFor(sumA, sumW, sumR, acc, sc)
   *   sumA 四件基础护甲合计；sumW 四件基础负重合计；sumR 五类抗性合计
   *   acc expandMods() 的累加器；sc 场景对象
   */
  function statsFor(sumA, sumW, sumR, a, sc) {
    const weight = Math.max(0, sumW * (1 + a.wPct) + a.wFlat);
    const T = thresholds(a);
    const ci = classIdx(weight, T);
    const cls = CLASS_ORDER[ci];
    const armor = (sumA + a.armorFlat) * (1 + a.ae);
    const adr = armor / (armor + K);
    const fdr = clamp(a.flatDR + scaleAdj(a, ci), C.FDR_MIN, C.FDR_MAX);
    const edr = clamp(a.edr, C.EDR_MIN, C.EDR_MAX);
    const rem = typeRemainders(a);
    const res = [];
    const totals = {};
    const effs = {};
    const base = (1 - adr) * (1 - fdr);
    const tphys = Math.min(CAP, 1 - base);
    totals.physical = tphys;
    effs.physical = 1 - (1 - tphys) * (1 - edr);
    for (let i = 0; i < 5; i += 1) {
      res[i] = (sumR[i] + a.resFlat[i]) * (1 + a.resPct[i]);
      const t0 = Math.min(CAP, 1 - base * (1 - res[i] / 100));
      // 80% 上限只作用于「护甲 × 固定 × 抗性」三类乘算；elemental_dr 是独立第 4 乘区，
      // 按 SPEC §2 与 Python 引擎口径在封顶之后再乘，因此结果可超过 80%。
      const tot = 1 - (1 - t0) * rem[i];
      totals[RES[i]] = tot;
      effs[RES[i]] = 1 - (1 - tot) * (1 - edr);
    }
    const stam = (C.STAM_BASE + a.stamMax) * (1 + a.stamPct);
    const evade = C.EVADE_BASE * (1 + (C.PENALTY[cls] || 0) + a.stamCost);
    const dodges = Math.max(1, Math.floor((stam - C.MIN_EVADE) / evade) + 1);
    // 生存派生：以基础生命 100 为假设（口径与 site_data.meta.formula 一致，不写死其它数值）
    const hpMax = 100 + a.hpMax;
    const hpTotal = hpMax * (1 + a.hpPct);
    const phys = Math.min(0.999, totals.physical);
    const worst = ALL_KEYS.reduce((m, k) => Math.min(m, totals[k] || 0), 1);
    return {
      weight, cls, ci, T,
      armor, adr, fdr, edr, res,
      totals, effs, score: scoreOf(effs, sc),
      worst,
      stam, evade, dodges,
      regen: C.REGEN_BASE + a.stamRegen,
      iframes: C.IFRAMES[cls], recovery: C.RECOVERY[cls],
      neutralIframes: C.N_IFRAMES[cls], neutralRecovery: C.N_RECOVERY[cls],
      sprint: C.SPRINT[cls],
      hpAdd: a.hpMax, hpPct: a.hpPct, hpMax, hpTotal,
      shieldPct: a.shieldPct, hpRegen: a.hpRegen,
      lifesteal: a.lifesteal > 0 ? a.lifesteal : null,
      ehp: hpTotal / (1 - phys),
      ehpShield: (hpTotal * (1 + a.shieldPct)) / (1 - phys),
      evadeWindow: a.evadeWin, evadeDist: a.evadeDist, evadeSpeed: a.evadeSpd,
    };
  }

  /** 四件护甲 id（head/body/legs/gloves）→ 面板数值 */
  function comboStats(ids, a, sc) {
    let sumA = 0; let sumW = 0; let ok = true;
    const sumR = [0, 0, 0, 0, 0];
    const parts = [];
    for (const id of ids) {
      if (!id) { ok = false; continue; }
      const p = pieceById.get(id);
      if (!p) { ok = false; continue; }
      parts.push(p);
      sumA += p.armor; sumW += p.weight;
      for (let i = 0; i < 5; i += 1) sumR[i] += p.res[i];
    }
    const st = statsFor(sumA, sumW, sumR, a, sc || scenarioById('general'));
    st.ok = ok; st.sumA = sumA; st.sumW = sumW; st.sumR = sumR; st.parts = parts;
    st.filled = parts.length;
    return st;
  }

  /** 按 profile + class 约束穷举最高护甲（用于「档位极限」与诊断） */
  function frontier(Tin) {
    const T = Tin && Tin.length === 3 ? Tin : thresholds(expandMods({}));
    const key = T.join(',');
    if (frontierCache && frontierCache.key === key) return frontierCache.value;
    const best = [null, null, null, null];
    const H = slotsOf.head; const B = slotsOf.body; const L = slotsOf.legs; const G = slotsOf.gloves;
    for (const p0 of H) {
      for (const p1 of B) {
        const a1 = p0.armor + p1.armor; const w1 = p0.weight + p1.weight;
        for (const p2 of L) {
          const a2 = a1 + p2.armor; const w2 = w1 + p2.weight;
          for (const p3 of G) {
            const wt = w2 + p3.weight;
            const ci = classIdx(wt, T);
            const ar = a2 + p3.armor;
            if (!best[ci] || ar > best[ci].armor) {
              best[ci] = { armor: ar, weight: wt, ids: [p0.id, p1.id, p2.id, p3.id], cls: CLASS_ORDER[ci] };
            }
          }
        }
      }
    }
    frontierCache = { key, value: best };
    return best;
  }
  let frontierCache = null;

  /* -------------------- 缺件重算：排除池 + 812,224 组合穷举 -------------------- */
  /**
   * class_target 语义与 optimize.py 的 class_cap 完全一致：
   * free=不限 / LIGHT|MEDIUM|HEAVY=对应负重阈值 / ULTRA=MAX_WEIGHT。
   */
  function classCap(target, T) {
    const t = String(target || 'free').toUpperCase();
    if (t === 'FREE' || t === 'ANY' || t === '') return Infinity;
    if (t === 'LIGHT') return T[0];
    if (t === 'MEDIUM') return T[1];
    if (t === 'HEAVY') return T[2];
    if (t === 'ULTRA') return C.MAX_WEIGHT;
    return Infinity;
  }

  const nowMs = () => (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now());

  /** 场景 → 归一化权重 / maxmin 类型下标（与 optimize.py prep_scenario 一致） */
  function prepScenario(sc) {
    if (sc && String(sc.mode || '').toLowerCase() === 'maxmin') {
      const types = Array.isArray(sc.types) && sc.types.length ? sc.types : ALL_KEYS;
      const idx = types.map((t) => ALL_KEYS.indexOf(t)).filter((i) => i >= 0);
      return { mode: 'maxmin', idx: idx.length ? idx : ALL_KEYS.map((_, i) => i) };
    }
    const w = ALL_KEYS.map((k) => num(sc && sc.weights && sc.weights[k], 0));
    const sum = w.reduce((a, b) => a + b, 0);
    const norm = sum > 0 ? w.map((x) => x / sum) : [1, 0, 0, 0, 0, 0];
    return { mode: 'weighted', w: norm };
  }

  /**
   * createEnumeration(opts) → 可分片推进的穷举器：
   *   opts = { picks|acc, scenario|scenarioId, classTarget='free', exclude:Set, owned:Set, top=5 }
   *   en.step(budgetMs)  推进一帧（返回 true=还有）
   *   en.result()        { top:[{ids,stats,key}], feasible, total, poolSize, excluded, elapsedMs }
   *
   * 排除集合 = 「可用池」：exclude（缺件）∩ owned（仅用已拥有，可选），
   * 不修改 store 的 owned / build 本身。排序/剪枝/评分与 optimize.py search() 逐条对齐。
   */
  function createEnumeration(opts = {}) {
    const acc = opts.acc || expandMods(opts.picks || {});
    const sc = (opts.scenario && opts.scenario.id)
      ? opts.scenario
      : scenarioById(opts.scenario || opts.scenarioId || 'general');
    const spec = prepScenario(sc);
    const T = thresholds(acc);
    const cap = classCap(opts.classTarget || 'free', T);
    const topN = Math.max(1, opts.top || 5);
    const exclude = opts.exclude && opts.exclude.has ? opts.exclude : null;
    const owned = opts.owned && opts.owned.has ? opts.owned : null;

    const pools = SLOT_KEYS.map((slot) => {
      const list = slotsOf[slot].filter((p) => (!exclude || !exclude.has(p.id)) && (!owned || owned.has(p.id)));
      // 与 optimize.py pieces_by_slot 一致：(weight, -armor, id)
      list.sort((x, y) => (x.weight - y.weight) || (y.armor - x.armor) || (x.id < y.id ? -1 : x.id > y.id ? 1 : 0));
      return list;
    });
    const poolSize = pools.reduce((n, l) => n + l.length, 0);
    const total = pools.reduce((n, l) => n * l.length, 1);
    const ns = pools.map((l) => l.length);

    const wScale = 1 + acc.wPct;
    const wConst = acc.wFlat;
    const aScale = 1 + acc.ae;
    const aConst = acc.armorFlat * aScale;
    const flat = clamp(acc.flatDR, C.FDR_MIN, C.FDR_MAX);
    const flatC = 1 - flat;
    // 与 optimize.py 对齐：enemy_dr / elemental_dr 都 clamp 到 0~0.95
    const enemyC = 1 - clamp(acc.edr, 0, 0.95);
    const elemC = 1 - clamp(acc.elementalDR, 0, 0.95);
    const rScale = acc.resPct.map((x) => 1 + x);
    const rConst = acc.resFlat.map((x, i) => x * rScale[i]);
    const isElem = RES.map((k) => ELEMENTAL.includes(k));
    const prune = wScale > 0 && cap !== Infinity;
    const capEps = cap + EPS;

    const A = []; const W = []; const R = [];
    for (let si = 0; si < 4; si += 1) {
      const ps = pools[si]; const n = ps.length;
      const a = new Float64Array(n); const w = new Float64Array(n);
      const r = [new Float64Array(n), new Float64Array(n), new Float64Array(n), new Float64Array(n), new Float64Array(n)];
      for (let i = 0; i < n; i += 1) {
        const pc = ps[i]; a[i] = pc.armor; w[i] = pc.weight;
        for (let q = 0; q < 5; q += 1) r[q][i] = pc.res[q];
      }
      A.push(a); W.push(w); R.push(r);
    }

    const state = { i0: 0, results: [], feasible: 0, seq: 0, done: false, elapsedMs: 0, t0: nowMs() };
    /** 二分插入（并列时排在等值之后 = 先出现者优先，保持与 top5 旧语义一致） */
    function insertEntry(entry) {
      const arr = state.results;
      let lo = 0; let hi = arr.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (arr[mid].key > entry.key) lo = mid + 1; else hi = mid;
      }
      arr.splice(lo, 0, entry);
    }
    function offer(key, ids) {
      const entry = { key, ids, seq: state.seq };
      state.seq += 1;
      const arr = state.results;
      if (arr.length < topN) { insertEntry(entry); return; }
      if (key > arr[arr.length - 1].key) {
        arr.pop();
        insertEntry(entry);
      }
    }

    function runHead(i0) {
      const a0 = A[0][i0]; const w0 = W[0][i0];
      const r00 = R[0][0][i0]; const r01 = R[0][1][i0]; const r02 = R[0][2][i0]; const r03 = R[0][3][i0]; const r04 = R[0][4][i0];
      const H = pools[0][i0];
      if (prune && w0 * wScale + wConst > capEps) return;
      for (let i1 = 0; i1 < ns[1]; i1 += 1) {
        const w1 = w0 + W[1][i1];
        if (prune && w1 * wScale + wConst > capEps) break;
        const a1 = a0 + A[1][i1];
        const s0 = r00 + R[1][0][i1]; const s1 = r01 + R[1][1][i1]; const s2 = r02 + R[1][2][i1]; const s3 = r03 + R[1][3][i1]; const s4 = r04 + R[1][4][i1];
        for (let i2 = 0; i2 < ns[2]; i2 += 1) {
          const w2 = w1 + W[2][i2];
          if (prune && w2 * wScale + wConst > capEps) break;
          const a2 = a1 + A[2][i2];
          const q0 = s0 + R[2][0][i2]; const q1 = s1 + R[2][1][i2]; const q2 = s2 + R[2][2][i2]; const q3 = s3 + R[2][3][i2]; const q4 = s4 + R[2][4][i2];
          for (let i3 = 0; i3 < ns[3]; i3 += 1) {
            const gw = w2 + W[3][i3];
            if (prune && gw * wScale + wConst > capEps) break;
            let weight = gw * wScale + wConst;
            if (weight < 0) weight = 0;
            if (weight > capEps) continue;

            const aSum = a2 + A[3][i3];
            const armor = aSum * aScale + aConst;
            const adr = armor > 0 ? armor / (armor + K) : 0;
            const p = (1 - adr) * flatC;
            const b0 = q0 + R[3][0][i3]; const b1 = q1 + R[3][1][i3]; const b2 = q2 + R[3][2][i3]; const b3 = q3 + R[3][3][i3]; const b4 = q4 + R[3][4][i3];
            const base = [b0, b1, b2, b3, b4];
            let key;
            if (spec.mode === 'maxmin') {
              let maxQ = p > 0.2 ? p : 0.2;
              for (let i = 0; i < 5; i += 1) {
                if (!spec.idx.includes(i + 1)) continue;
                const res = base[i] * rScale[i] + rConst[i];
                let x = p * (1 - res * 0.01);
                if (x < 0.2) x = 0.2;
                if (isElem[i]) x *= elemC;
                if (x > maxQ) maxQ = x;
              }
              key = 1 - enemyC * maxQ;
            } else {
              const qp = p > 0.2 ? p : 0.2;
              let sc0 = spec.w[0] * qp;
              for (let i = 0; i < 5; i += 1) {
                const res = base[i] * rScale[i] + rConst[i];
                let x = p * (1 - res * 0.01);
                if (x < 0.2) x = 0.2;
                if (isElem[i]) x *= elemC;
                sc0 += spec.w[i + 1] * x;
              }
              key = 1 - enemyC * sc0;
            }
            state.feasible += 1;
            offer(key, [H.id, pools[1][i1].id, pools[2][i2].id, pools[3][i3].id]);
          }
        }
      }
    }

    function step(budgetMs = 8) {
      if (state.done) return false;
      const t0 = nowMs();
      while (state.i0 < ns[0]) {
        runHead(state.i0);
        state.i0 += 1;
        if (nowMs() - t0 > budgetMs) return true;
      }
      state.done = true;
      state.elapsedMs = Math.round(nowMs() - state.t0);
      return false;
    }
    function runAll() { while (step(1e9)) { /* run to end */ } return state; }
    function result() {
      const top = state.results.map((e) => ({ ids: e.ids, key: e.key, stats: comboStats(e.ids, acc, sc) }));
      return {
        top, scenario: sc, classTarget: opts.classTarget || 'free',
        feasible: state.feasible, total, poolSize, excluded: pieces.length - poolSize,
        pools: ns.slice(), elapsedMs: state.elapsedMs, done: state.done,
      };
    }
    function progress() { return ns[0] ? Math.min(1, state.i0 / ns[0]) : 1; }
    return { step, runAll, result, progress, acc, scenario: sc, poolSize, total };
  }

  /** 候选排序指标（推荐面板 6 种排序共用；全部来自引擎字段，无视图魔法数） */
  function candidateMetrics(st) {
    return {
      score: st.score,
      phys: st.totals.physical,
      worst: st.worst,
      armor: st.armor,
      ehp: st.ehp,
      weight: st.weight,
    };
  }

  /** 反向：目标物理减伤需要的护甲值（计算器用）；这里只提供 EHP 口径说明 */
  function effectiveHP(st) { return st.ehp; }

  /** 同步版（node 对拍/测试用）；UI 用 createEnumeration 分片推进 */
  function enumerateTop(opts = {}) {
    const en = createEnumeration(opts);
    en.runAll();
    return en.result();
  }

  /* -------------------- 预设（330） -------------------- */
  const presetIndex = new Map();
  for (const cell of S.presets || []) {
    const key = `${cell.p || cell.profile}|${cell.c || cell.class}|${cell.s || cell.scenario}`;
    presetIndex.set(key, cell);
  }
  function getPreset(profile, cls, scenario) {
    return presetIndex.get(`${profile}|${cls}|${scenario}`) || presetIndex.get(`${profile}|${cls}|general`) || null;
  }
  function presetIds(build) {
    if (!build || !Array.isArray(build.parts)) return [];
    return build.parts.map((i) => (pieces[i] ? pieces[i].id : null));
  }
  /** 预设记录 → 面板数值（用引擎重算，保证与卡片口径一致） */
  function presetComputed(build, profile, scenario) {
    const ids = presetIds(build);
    const acc = expandMods(picksFromProfile(profile));
    const sc = scenarioById(scenario);
    const st = comboStats(ids, acc, sc);
    return { ids, st };
  }

  /* -------------------- 情况矩阵 A / B / C -------------------- */
  const tableCache = {};
  /** 表 A：档位 × 特性档（数据取 presets 的 ba=极限护甲 / best=通用最优） */
  function tableA() {
    if (tableCache.a) return tableCache.a;
    const profs = [
      { id: 'base', zh: '裸装（无特性）' },
      { id: 'fortify', zh: '只坚韧' },
      { id: 'strongback', zh: '只强壮脊背' },
      { id: 'fortify_sb', zh: '坚韧 + 强壮脊背' },
    ];
    const out = [];
    for (const pf of profs) {
      const acc = expandMods(picksFromProfile(pf.id));
      const T = thresholds(acc);
      const rows = [];
      for (const cls of CLASS_ORDER) {
        const cell = getPreset(pf.id, cls, 'general');
        if (!cell || !cell.ba) { rows.push({ cls, missing: true }); continue; }
        const baIds = presetIds(cell.ba);
        const ba = cell.ba;
        const bestIds = presetIds(cell.best);
        rows.push({
          cls,
          ids: baIds,
          armor: round1(baIds.reduce((s, id) => s + ((pieceById.get(id) || {}).armor || 0), 0)),
          armorEff: round1(num(ba.a, 0)),
          dr: round4(num(ba.adr, 0)),
          weight: round1(num(ba.w, 0)),
          clsOfBuild: ba.cl || cls,
          best: cell.best ? {
            ids: bestIds,
            armor: round1(bestIds.reduce((s, id) => s + ((pieceById.get(id) || {}).armor || 0), 0)),
            armorEff: round1(num(cell.best.a, 0)),
            dr: round4(num(cell.best.adr, 0)),
            weight: round1(num(cell.best.w, 0)),
            score: num(cell.best.sc, 0),
          } : null,
        });
      }
      out.push({ id: pf.id, zh: pf.zh, thresholds: T.map((x) => round1(x)), rows });
    }
    tableCache.a = out;
    return out;
  }

  /** 表 B：场景 × 抗性特化（坚韧满级口径，穷举 812,224 组合取该类型最高总减伤） */
  function tableB() {
    if (tableCache.b) return tableCache.b;
    const acc = expandMods(picksFromProfile('fortify'));
    const T = thresholds(acc);
    const ae = 1 + acc.ae;
    const A = [slotsOf.head, slotsOf.body, slotsOf.legs, slotsOf.gloves];
    const best = RES.map(() => null);
    for (const p0 of A[0]) {
      const a0 = p0.armor;
      for (const p1 of A[1]) {
        const a1 = a0 + p1.armor;
        for (const p2 of A[2]) {
          const a2 = a1 + p2.armor;
          const w2 = p2.weight + p1.weight + p0.weight;
          for (const p3 of A[3]) {
            const wt = w2 + p3.weight;
            const armor = (a2 + p3.armor) * ae;
            const adr = armor / (armor + K);
            const ci = classIdx(wt, T);
            for (let i = 0; i < 5; i += 1) {
              const resSum = p0.res[i] + p1.res[i] + p2.res[i] + p3.res[i];
              const total = Math.min(CAP, 1 - (1 - adr) * (1 - resSum / 100));
              const cur = best[i];
              if (!cur || total > cur.total + 1e-12) {
                best[i] = {
                  type: RES[i], zh: TYPE_ZH[RES[i]], ids: [p0.id, p1.id, p2.id, p3.id],
                  weight: wt, cls: CLASS_ORDER[ci], armor: round1(armor), adr: round4(adr),
                  total: round4(total), res: round1(resSum),
                };
              }
            }
          }
        }
      }
    }
    tableCache.b = best.filter(Boolean);
    return tableCache.b;
  }

  /** 表 C：没有任何 DLC 时的降级版（坚韧 + 强壮脊背，按档求护甲极限） */
  function tableC() {
    if (tableCache.c) return tableCache.c;
    const basePieces = pieces.filter((p) => p.dlc === '基础');
    const by = { head: [], body: [], legs: [], gloves: [] };
    for (const p of basePieces) if (by[p.slot]) by[p.slot].push(p);
    const acc = expandMods(picksFromProfile('fortify_sb'));
    const T = thresholds(acc);
    const ae = 1 + acc.ae;
    const best = [null, null, null, null];
    if (by.head.length && by.body.length && by.legs.length && by.gloves.length) {
      for (const p0 of by.head) {
        for (const p1 of by.body) {
          const a1 = p0.armor + p1.armor;
          for (const p2 of by.legs) {
            const a2 = a1 + p2.armor;
            const w2 = p0.weight + p1.weight + p2.weight;
            for (const p3 of by.gloves) {
              const wt = w2 + p3.weight;
              const ci = classIdx(wt, T);
              const armor = (a2 + p3.armor) * ae;
              if (!best[ci] || armor > best[ci].armorEff) {
                best[ci] = {
                  cls: CLASS_ORDER[ci], ids: [p0.id, p1.id, p2.id, p3.id],
                  armor: round1(a2 + p3.armor), armorEff: round1(armor),
                  dr: round4(armor / (armor + K)), weight: round1(wt),
                };
              }
            }
          }
        }
      }
    }
    tableCache.c = { thresholds: T.map(round1), rows: best.map((b, i) => b || { cls: CLASS_ORDER[i], missing: true }) };
    return tableCache.c;
  }

  /* -------------------- 逐槽替代 top3 -------------------- */
  /**
   * substitutesFor(ids, acc, sc, {exclude, limit})
   * 保持其余三件不变，逐槽枚举替代件，按 Δ场景分 排序。
   */
  function substitutesFor(ids, acc, sc, opts = {}) {
    const exclude = opts.exclude || null;
    const limit = opts.limit || 3;
    const st0 = comboStats(ids, acc, sc);
    const out = [];
    for (let s = 0; s < 4; s += 1) {
      const slot = SLOT_KEYS[s];
      const orig = pieceById.get(ids[s]);
      const rows = [];
      for (const p of slotsOf[slot]) {
        if (p.id === ids[s]) continue;
        if (exclude && exclude.has && exclude.has(p.id)) continue;
        const next = ids.slice();
        next[s] = p.id;
        const st = comboStats(next, acc, sc);
        rows.push({
          id: p.id, zh: p.zh, set: p.set, icon: p.icon, dobt: p.dobt, dlc: p.dlc,
          dScore: st.score - st0.score,
          dArmor: st.armor - st0.armor,
          dWeight: st.weight - st0.weight,
          dRes: st.res.map((r, i) => r - st0.res[i]),
          st,
        });
      }
      rows.sort((x, y) => y.dScore - x.dScore || y.dArmor - x.dArmor);
      out.push({ slot, cur: orig ? orig.id : null, rows: rows.slice(0, limit) });
    }
    return out;
  }

  /* -------------------- 工具 -------------------- */
  function round1(v) { return Math.round(v * 10) / 10; }
  function round4(v) { return Math.round(v * 10000) / 10000; }

  function pieceOf(id) { return pieceById.get(id) || null; }

  /** 反算：目标护甲减伤 → 需要护甲值（A = K·DR/(1-DR)） */
  function reverseDR(dr) {
    const x = clamp(dr, 0.01, 0.95);
    return (K * x) / (1 - x);
  }
  /** 正算：护甲值 → 护甲减伤 */
  function armorDR(armor) { return armor / (armor + K); }

  /** 负重档位对应的闪避代价（不依赖具体组合） */
  function classTraits(cls) {
    return {
      cls,
      penalty: C.PENALTY[cls] || 0,
      iframes: C.IFRAMES[cls], recovery: C.RECOVERY[cls],
      neutralIframes: C.N_IFRAMES[cls], neutralRecovery: C.N_RECOVERY[cls],
      sprint: C.SPRINT[cls],
    };
  }

  return {
    site: S, meta: META, C,
    pieces, pieceById, slotsOf, pieceOf,
    traits, rings, amulets, fragments, perks, consumables, modById,
    scenarios, profiles, profileById, presets: S.presets || [], substitutes: S.substitutes || {},
    CLASS_ORDER, RES, ELEMENTAL,
    emptyAcc, expandMods, picksFromProfile, picksNonGear, picksFromGear, traitPerLevel,
    thresholds, classIdx, scenarioById, scoreOf, typeRemainders,
    statsFor, comboStats, frontier,
    getPreset, presetIds, presetComputed, presetIndex,
    tableA, tableB, tableC,
    substitutesFor,
    classCap, prepScenario, createEnumeration, enumerateTop,
    candidateMetrics, effectiveHP,
    reverseDR, armorDR, classTraits,
    K, CAP, EPS,
  };
}

export default createEngine;
