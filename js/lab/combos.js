/* =============================================================================
   遗迹2 · 遗物档案 — lab/combos.js（v2）
   饰品组合搜索：1 项链 + 4 戒指，按流派维度评分（无 DOM / 无 fetch / 无 store）。

   口径（docs/LAB_V2.md §2.2）：
     候选池  ring 按 itemScore 取前 24、amulet 取前 12（同分 score↓→命中维度数↓→id 序）；
     固定件  先占位，剩余槽从池里枚举（12 × C(24,4) = 126,720 组，固定件多时更少）；
     戒指    不可重复（游戏规则）；项链与戒指不混淆；excludeIds（缺件）过滤候选池；
     固定件非法（重复 / 类型不符 / 不存在）→ 返回空结果 + error 字符串，不抛异常；
     评分    复用 score.js 的 loadoutScore（0.7·avg + 0.3·coverage），排序同分同 §2.1 口径。

   入参 gear：优先传模型层 model.gear（.ring/.amulet/.playstyles/.kindOf/.byId）；
   也兼容整份 lab_gear 文档（.gear.ring）或整模型（.gear 为 model.gear）。
   空数据 / 缺字段一律降级为空结果，不抛异常。

   性能：快路径只做「预取分数 + 覆盖位掩码」的纯算术（127k 组约几十毫秒），
   仅对最终前 N 个组合调用 loadoutScore 取 dims/avg/coverage 与逐件 why。
   若 scorer 没暴露 weightsOf（非本仓库 score.js 实例），退回逐组 loadoutScore。
   ========================================================================== */

const RING_POOL = 24;
const AMULET_POOL = 12;
const RING_SLOTS = 4;
const REMAIN_TOP = 5;
const DEFAULT_LIMIT = 10;
/** 与 score.js 的 COVERAGE_WEIGHT 同一口径（零依赖模块各自持有常量，改动须同步） */
const COVERAGE_WEIGHT = 0.6;
const KINDS = ['ring', 'amulet', 'mutator', 'mod', 'fragment', 'trait', 'relic'];
const SLOT_ORDER = ['amulet', 'ring1', 'ring2', 'ring3', 'ring4'];

const isStr = (v) => typeof v === 'string' && v !== '';
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

function roundTo(value, digits) {
  if (!isNum(value)) return 0;
  const factor = 10 ** digits;
  const rounded = Math.round(value * factor) / factor;
  return Object.is(rounded, -0) ? 0 : rounded;
}

function cmpId(a, b) {
  const left = isStr(a) ? a : '';
  const right = isStr(b) ? b : '';
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function popcount(bits) {
  let x = bits >>> 0;
  let count = 0;
  while (x) {
    x &= x - 1;
    count += 1;
  }
  return count;
}

function toIdSet(value) {
  const out = new Set();
  if (value instanceof Set) {
    for (const id of value) if (isStr(id)) out.add(id);
  } else if (Array.isArray(value)) {
    for (const id of value) if (isStr(id)) out.add(id);
  } else if (isStr(value)) {
    out.add(value);
  }
  return out;
}

function toIdList(value) {
  if (Array.isArray(value)) return value.filter((id) => isStr(id));
  if (value instanceof Set) return [...value].filter((id) => isStr(id));
  if (isStr(value)) return [value];
  return [];
}

function normLimit(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.floor(n));
}

/** fixed 支持 {amulet, rings} / rings 数组 / Set */
function normalizeFixed(fixed) {
  if (!fixed) return { amulet: null, rings: [] };
  if (Array.isArray(fixed)) return { amulet: null, rings: fixed.filter((id) => isStr(id)) };
  if (fixed instanceof Set) return { amulet: null, rings: [...fixed].filter((id) => isStr(id)) };
  if (isObj(fixed)) {
    return {
      amulet: isStr(fixed.amulet) ? fixed.amulet : null,
      rings: toIdList(fixed.rings),
    };
  }
  return { amulet: null, rings: [] };
}

/** 从 gear（model.gear / 文档 / 整模型）建立只读索引 */
function createGearContext(gear) {
  const src = isObj(gear) ? gear : {};
  const doc = isObj(src.doc) ? src.doc : src;
  const rawGear = isObj(doc.gear) ? doc.gear : {};

  const lists = new Map();
  for (const kind of KINDS) {
    let list = [];
    if (Array.isArray(src[kind])) list = src[kind];
    else if (Array.isArray(doc[kind])) list = doc[kind];
    else if (Array.isArray(rawGear[kind])) list = rawGear[kind];
    lists.set(kind, list);
  }

  const byId = new Map();
  const idByKind = new Map(KINDS.map((kind) => [kind, new Map()]));
  const kindById = new Map();
  for (const kind of KINDS) {
    const index = idByKind.get(kind);
    for (const item of lists.get(kind)) {
      if (!isObj(item) || !isStr(item.id)) continue;
      if (!index.has(item.id)) index.set(item.id, item);
      if (!byId.has(item.id)) byId.set(item.id, item);
      if (!kindById.has(item.id)) kindById.set(item.id, kind);
    }
  }
  const extraIndexes = [src.byId, src.itemsById, rawGear.byId, isObj(src.gear) ? src.gear.byId : null];
  for (const extra of extraIndexes) {
    if (!(extra instanceof Map)) continue;
    for (const [id, item] of extra) {
      if (!isStr(id) || !isObj(item) || byId.has(id)) continue;
      byId.set(id, item);
      if (isStr(item.kind) && !kindById.has(id)) kindById.set(id, item.kind);
    }
  }

  function kindOf(id) {
    if (!isStr(id)) return null;
    for (const holder of [src, rawGear]) {
      if (typeof holder.kindOf !== 'function') continue;
      try {
        const kind = holder.kindOf(id);
        if (isStr(kind)) return kind;
      } catch { /* 防御：外部 kindOf 抛错时走本地索引 */ }
    }
    return kindById.get(id) || null;
  }

  function itemOf(id, kind) {
    if (!isStr(id)) return null;
    // 指定 kind 时只查该 kind：避免「项链 id 恰好是戒指」这类跨类型混淆
    if (isStr(kind) && idByKind.has(kind)) return idByKind.get(kind).get(id) || null;
    const hit = byId.get(id);
    if (hit) return hit;
    for (const holder of [src, rawGear]) {
      if (typeof holder.of !== 'function') continue;
      try {
        const item = holder.of(id);
        if (isObj(item) && isStr(item.id)) return item;
      } catch { /* 防御 */ }
    }
    return null;
  }

  const playstyles = Array.isArray(src.playstyles) ? src.playstyles
    : Array.isArray(doc.playstyles) ? doc.playstyles
      : Array.isArray(rawGear.playstyles) ? rawGear.playstyles : [];

  return { src, doc, rawGear, lists, byId, kindOf, itemOf, playstyles };
}

/**
 * createComboSearch(gear, scorer) → 组合搜索实例。
 * @param {object} gear  模型层 model.gear（或 lab_gear 文档 / 整模型）
 * @param {object} scorer createScorer() 的实例
 */
export function createComboSearch(gear, scorer) {
  const G = createGearContext(gear);
  const S = scorer && typeof scorer.itemScore === 'function' ? scorer : null;
  const fast = !!(S && typeof S.weightsOf === 'function');

  const weightCache = new Map();
  function weightsOf(playstyleId) {
    const psId = isStr(playstyleId) ? playstyleId : '';
    if (weightCache.has(psId)) return weightCache.get(psId);
    const out = {};
    if (S && typeof S.weightsOf === 'function') {
      try {
        const weights = S.weightsOf(psId);
        if (isObj(weights)) {
          for (const [dimId, weight] of Object.entries(weights)) {
            if (isStr(dimId) && isNum(weight) && weight > 0) out[dimId] = weight;
          }
        }
      } catch { /* 防御：回落到 gear.playstyles */ }
    }
    if (!Object.keys(out).length) {
      const ps = G.playstyles.find((row) => isObj(row) && row.id === psId) || null;
      if (ps && isObj(ps.dims)) {
        for (const [dimId, weight] of Object.entries(ps.dims)) {
          if (isStr(dimId) && isNum(weight) && weight > 0) out[dimId] = weight;
        }
      }
    }
    weightCache.set(psId, out);
    return out;
  }

  /** 一个道具的评分摘要：分数 / 命中维度数 / 命中维度键 / why（维度中文名） */
  function entryOf(kind, item, playstyleId) {
    const target = isObj(item) ? item : null;
    let result = null;
    if (S && target) {
      try { result = S.itemScore(kind, target, playstyleId); } catch { result = null; }
    }
    const dims = result && isObj(result.dims) ? result.dims : {};
    const dimKeys = Object.keys(dims);
    return {
      id: target && isStr(target.id) ? target.id : null,
      item: target,
      score: result && isNum(result.score) ? result.score : 0,
      hits: dimKeys.length,
      dimKeys,
      dims,
      why: result && Array.isArray(result.why) ? result.why.slice(0, 3) : [],
    };
  }

  function cmpEntry(a, b) {
    if (a.score !== b.score) return b.score - a.score;
    if (a.hits !== b.hits) return b.hits - a.hits;
    return cmpId(a.id, b.id);
  }

  /** 候选池：同分排序后取前 cap，过滤 skip 集合 */
  function selectPool(kind, playstyleId, cap, skip) {
    const rows = [];
    for (const item of G.lists.get(kind) || []) {
      if (!isObj(item) || !isStr(item.id) || skip.has(item.id)) continue;
      rows.push(entryOf(kind, item, playstyleId));
    }
    rows.sort(cmpEntry);
    return rows.slice(0, cap);
  }

  /** 用 loadoutScore（缺方法时按同一公式本地兜底）求 5 件口径分数 */
  function loadoutOf(ids, playstyleId) {
    const list = Array.isArray(ids) ? ids : ids == null ? [] : [ids];
    if (S && typeof S.loadoutScore === 'function') {
      try {
        const result = S.loadoutScore(list, playstyleId);
        if (result && isNum(result.score)) {
          return {
            score: result.score,
            avg: isNum(result.avg) ? result.avg : 0,
            coverage: isNum(result.coverage) ? result.coverage : 0,
            dims: isObj(result.dims) ? result.dims : {},
          };
        }
      } catch { /* 防御：走本地兜底 */ }
    }
    return fallbackLoadout(list, playstyleId);
  }

  function fallbackLoadout(ids, playstyleId) {
    const weights = weightsOf(playstyleId);
    const high = Object.keys(weights).filter((dimId) => weights[dimId] >= COVERAGE_WEIGHT);
    const seen = new Set();
    const entries = [];
    for (const raw of ids) {
      const id = isStr(raw) ? raw : isObj(raw) && isStr(raw.id) ? raw.id : null;
      if (!id || seen.has(id)) continue;
      const kind = G.kindOf(id);
      const item = G.itemOf(id, kind);
      if (!item) continue;
      seen.add(id);
      entries.push(entryOf(kind, item, playstyleId));
    }
    const n = entries.length;
    const avgRaw = n ? entries.reduce((sum, entry) => sum + entry.score, 0) / n : 0;
    const covered = new Set();
    for (const entry of entries) for (const dimId of entry.dimKeys) covered.add(dimId);
    const covRaw = high.length ? high.filter((dimId) => covered.has(dimId)).length / high.length : 0;
    const dims = {};
    for (const entry of entries) {
      for (const [dimId, value] of Object.entries(entry.dims)) {
        dims[dimId] = roundTo((dims[dimId] || 0) + value, 4);
      }
    }
    return {
      score: roundTo(0.7 * avgRaw + 0.3 * covRaw, 3),
      avg: roundTo(avgRaw, 3),
      coverage: roundTo(covRaw, 3),
      dims,
    };
  }

  /** 固定件合法性：返回中文错误串或 null（重复 / 类型不符 / 不存在 / 超额） */
  function checkFixed(amulet, rings) {
    if (!Array.isArray(rings)) rings = [];
    if (rings.length > RING_SLOTS) return `固定戒指超过 ${RING_SLOTS} 个`;
    if (rings.some((id) => !isStr(id))) return '固定戒指列表含非法 id';
    const seen = new Set();
    for (const id of rings) {
      if (seen.has(id)) return `固定戒指重复：${id}`;
      seen.add(id);
      const item = G.itemOf(id, 'ring');
      if (!item) {
        const kind = G.kindOf(id);
        return kind ? `固定件类型不符：${id} 不是戒指` : `固定戒指不存在：${id}`;
      }
    }
    if (amulet != null) {
      if (!isStr(amulet)) return '固定项链 id 非法';
      const item = G.itemOf(amulet, 'amulet');
      if (!item) {
        const kind = G.kindOf(amulet);
        return kind ? `固定件类型不符：${amulet} 不是项链` : `固定项链不存在：${amulet}`;
      }
    }
    return null;
  }

  function emptyStats(playstyleId, fixedRings, need) {
    return {
      playstyleId,
      ringPool: 0,
      amuletPool: 0,
      fixedRings: fixedRings.length,
      need,
      evaluated: 0,
      returned: 0,
    };
  }

  /* ----------------------------- 组合枚举 ----------------------------- */
  function forEachCombination(rows, k, cb) {
    const n = rows.length;
    if (k <= 0) {
      cb([]);
      return;
    }
    if (k > n) return;
    const picked = new Array(k);
    const walk = (start, depth) => {
      if (depth === k) {
        cb(picked);
        return;
      }
      const maxStart = n - (k - depth);
      for (let i = start; i <= maxStart; i += 1) {
        picked[depth] = i;
        walk(i + 1, depth + 1);
      }
    };
    walk(0, 0);
  }

  function cmpRecord(a, b) {
    if (a.score !== b.score) return b.score - a.score;
    if (a.hits !== b.hits) return b.hits - a.hits;
    return cmpId(a.key, b.key);
  }

  /* ----------------------------- recommendTrinkets ----------------------------- */
  function recommendTrinkets(options) {
    const opts = isObj(options) ? options : {};
    const psId = isStr(opts.playstyleId) ? opts.playstyleId : 'general';
    const fixedAmulet = isStr(opts.fixedAmulet) ? opts.fixedAmulet : null;
    const fixedRings = toIdList(opts.fixedRings);
    const limit = normLimit(opts.limit, DEFAULT_LIMIT);
    const exclude = toIdSet(opts.excludeIds);
    const need = RING_SLOTS - fixedRings.length;
    const fixedError = checkFixed(fixedAmulet, fixedRings);
    if (fixedError) {
      return { combos: [], stats: emptyStats(psId, fixedRings, need), error: fixedError };
    }

    const stats = emptyStats(psId, fixedRings, need);
    if (limit <= 0) return { combos: [], stats };

    const skipRings = new Set([...exclude, ...fixedRings]);
    const ringPool = selectPool('ring', psId, RING_POOL, skipRings);
    stats.ringPool = ringPool.length;

    let amuletRows;
    if (fixedAmulet) {
      const item = G.itemOf(fixedAmulet, 'amulet');
      amuletRows = item ? [entryOf('amulet', item, psId)] : [];
    } else {
      amuletRows = selectPool('amulet', psId, AMULET_POOL, exclude);
    }
    stats.amuletPool = amuletRows.length;

    if (!amuletRows.length || need > ringPool.length) return { combos: [], stats };

    const weights = weightsOf(psId);
    const high = Object.keys(weights).filter((dimId) => weights[dimId] >= COVERAGE_WEIGHT);
    const highBit = new Map(high.map((dimId, i) => [dimId, i]));
    const toBits = (entry) => {
      let mask = 0;
      for (const dimId of entry.dimKeys) {
        const bit = highBit.get(dimId);
        if (bit !== undefined) mask |= 1 << bit;
      }
      return mask;
    };
    const fixedPreps = fixedRings.map((id) => {
      const entry = entryOf('ring', G.itemOf(id, 'ring'), psId);
      return { id, score: entry.score, hits: entry.hits, mask: fast ? toBits(entry) : 0 };
    });
    const ringPreps = ringPool.map((entry) => ({ id: entry.id, score: entry.score, hits: entry.hits, mask: fast ? toBits(entry) : 0 }));

    const top = [];
    let evaluated = 0;

    function consider(score, hits, amuletId, picked) {
      const last = top.length >= limit ? top[top.length - 1] : null;
      if (last && (score < last.score || (score === last.score && hits < last.hits))) return;
      const ringIds = fixedRings.slice();
      for (let i = 0; i < picked.length; i += 1) ringIds.push(ringPreps[picked[i]].id);
      const record = {
        key: `${amuletId}\u0000${ringIds.join('\u0000')}`,
        score,
        hits,
        amuletId,
        ringIds,
      };
      if (last && top.length >= limit && cmpRecord(record, last) >= 0) return;
      let lo = 0;
      let hi = top.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (cmpRecord(record, top[mid]) < 0) hi = mid;
        else lo = mid + 1;
      }
      top.splice(lo, 0, record);
      if (top.length > limit) top.pop();
    }

    const partCount = fixedPreps.length + 1 + need;

    for (const amuletEntry of amuletRows) {
      const amuletId = amuletEntry.id;
      if (fast) {
        let baseSum = amuletEntry.score;
        let baseMask = toBits(amuletEntry);
        let baseHits = amuletEntry.hits;
        for (const prep of fixedPreps) {
          baseSum += prep.score;
          baseMask |= prep.mask;
          baseHits += prep.hits;
        }
        forEachCombination(ringPreps, need, (picked) => {
          evaluated += 1;
          let sum = baseSum;
          let mask = baseMask;
          let hits = baseHits;
          for (let i = 0; i < need; i += 1) {
            const prep = ringPreps[picked[i]];
            sum += prep.score;
            mask |= prep.mask;
            hits += prep.hits;
          }
          const avg = sum / partCount;
          const coverage = high.length ? popcount(mask) / high.length : 0;
          consider(roundTo(0.7 * avg + 0.3 * coverage, 3), hits, amuletId, picked);
        });
      } else {
        // 兜底：scorer 没有 weightsOf 时逐组调用 loadoutScore（结果一致，速度慢一档）
        forEachCombination(ringPreps, need, (picked) => {
          evaluated += 1;
          const ringIds = fixedRings.slice();
          let hits = amuletEntry.hits;
          for (let i = 0; i < need; i += 1) {
            const prep = ringPreps[picked[i]];
            ringIds.push(prep.id);
            hits += prep.hits;
          }
          const full = loadoutOf([amuletId, ...ringIds], psId);
          consider(full.score, hits, amuletId, picked);
        });
      }
    }

    const combos = top.map((record) => {
      const ids = [record.amuletId, ...record.ringIds];
      const full = loadoutOf(ids, psId);
      const why = [];
      const pieces = [['amulet', record.amuletId], ...record.ringIds.map((id) => ['ring', id])];
      for (const [kind, id] of pieces) {
        const label = entryOf(kind, G.itemOf(id, kind), psId).why[0];
        if (isStr(label) && !why.includes(label)) why.push(label);
      }
      return {
        amulet: record.amuletId,
        rings: record.ringIds.slice(),
        score: full.score,
        avg: full.avg,
        coverage: full.coverage,
        dims: full.dims,
        why,
        key: record.key,
        hits: record.hits,
      };
    });
    combos.sort(cmpRecord);

    stats.evaluated = evaluated;
    stats.returned = combos.length;
    return {
      combos: combos.map(({ key, hits, ...rest }) => rest),
      stats,
    };
  }

  /* ----------------------------- recommendRemaining ----------------------------- */
  /** 空槽推断：项链槽 + 未占用的戒指槽；emptySlots 可传数字（取前 N）或槽名数组（取交集） */
  function resolveEmptySlots(emptySlots, fixed) {
    const inferred = [];
    if (!fixed.amulet) inferred.push('amulet');
    for (let i = fixed.rings.length; i < RING_SLOTS; i += 1) inferred.push(`ring${i + 1}`);
    if (Array.isArray(emptySlots)) {
      const wanted = new Set(emptySlots.filter((slot) => isStr(slot) && SLOT_ORDER.includes(slot)));
      return inferred.filter((slot) => wanted.has(slot));
    }
    const count = Number(emptySlots);
    if (Number.isFinite(count)) return inferred.slice(0, Math.max(0, Math.floor(count)));
    return inferred;
  }

  function recommendRemaining(options) {
    const opts = isObj(options) ? options : {};
    const psId = isStr(opts.playstyleId) ? opts.playstyleId : 'general';
    const exclude = toIdSet(opts.excludeIds);
    const fixed = normalizeFixed(opts.fixed);
    const fixedError = checkFixed(fixed.amulet, fixed.rings);
    if (fixedError) return { slots: [], error: fixedError };

    const baseIds = [fixed.amulet, ...fixed.rings].filter((id) => isStr(id));
    const base = loadoutOf(baseIds, psId);
    const slots = resolveEmptySlots(opts.emptySlots, fixed);
    if (!slots.length) return { slots: [], base };

    const ringPool = selectPool('ring', psId, RING_POOL, new Set([...exclude, ...fixed.rings]));
    const amuletPool = selectPool('amulet', psId, AMULET_POOL, new Set(exclude));

    // 每个空槽的候选是同一池，边际增益按「放入该槽后的 loadoutScore − 当前」计算
    const out = [];
    for (const slot of slots) {
      const isAmulet = slot === 'amulet';
      const pool = isAmulet ? amuletPool : ringPool;
      const items = [];
      for (const row of pool) {
        const nextIds = isAmulet ? [row.id, ...fixed.rings] : [...baseIds, row.id];
        const next = loadoutOf(nextIds, psId);
        items.push({
          id: row.id,
          kind: isAmulet ? 'amulet' : 'ring',
          score: roundTo(next.score - base.score, 3),
          why: row.why,
          itemScore: row.score,
        });
      }
      items.sort((a, b) => (a.score === b.score
        ? (a.itemScore === b.itemScore ? cmpId(a.id, b.id) : b.itemScore - a.itemScore)
        : b.score - a.score));
      out.push({
        slot,
        items: items.slice(0, REMAIN_TOP).map(({ itemScore, ...rest }) => rest),
      });
    }
    return { slots: out, base };
  }

  /* ----------------------------- recommendSwap ----------------------------- */
  function recommendSwap(options) {
    const result = [];
    const opts = isObj(options) ? options : {};
    const psId = isStr(opts.playstyleId) ? opts.playstyleId : 'general';
    const exclude = toIdSet(opts.excludeIds);
    const current = normalizeFixed(opts.current);
    const fixedError = checkFixed(current.amulet, current.rings);
    if (fixedError) {
      result.error = fixedError;
      return result;
    }
    const baseIds = [current.amulet, ...current.rings].filter((id) => isStr(id));
    if (!baseIds.length) return result;
    const base = loadoutOf(baseIds, psId);

    const slotPlans = [];
    if (current.amulet) {
      slotPlans.push({
        slot: 'amulet',
        kind: 'amulet',
        from: current.amulet,
        pool: selectPool('amulet', psId, AMULET_POOL, new Set([...exclude, current.amulet])),
      });
    }
    current.rings.forEach((id, index) => {
      slotPlans.push({
        slot: `ring${index + 1}`,
        kind: 'ring',
        from: id,
        pool: selectPool('ring', psId, RING_POOL, new Set([...exclude, ...current.rings])),
      });
    });

    for (const plan of slotPlans) {
      let best = null;
      for (const row of plan.pool) {
        let nextIds;
        if (plan.kind === 'amulet') {
          nextIds = [row.id, ...current.rings];
        } else {
          const index = Number(plan.slot.slice(4)) - 1;
          const rings = current.rings.slice();
          rings[index] = row.id;
          nextIds = [current.amulet, ...rings].filter((id) => isStr(id));
        }
        const next = loadoutOf(nextIds, psId);
        const gain = roundTo(next.score - base.score, 3);
        if (gain <= 0) continue;
        const better = !best
          || gain > best.gain
          || (gain === best.gain && (row.score > best.itemScore
            || (row.score === best.itemScore && cmpId(row.id, best.to) < 0)));
        if (better) {
          best = { slot: plan.slot, from: plan.from, to: row.id, gain, itemScore: row.score, why: row.why };
        }
      }
      if (best) {
        result.push({ slot: best.slot, from: best.from, to: best.to, gain: best.gain, why: best.why });
      }
    }

    result.sort((a, b) => (a.gain === b.gain
      ? (SLOT_ORDER.indexOf(a.slot) === SLOT_ORDER.indexOf(b.slot)
        ? cmpId(a.to, b.to)
        : SLOT_ORDER.indexOf(a.slot) - SLOT_ORDER.indexOf(b.slot))
      : b.gain - a.gain));
    return result;
  }

  return {
    recommendTrinkets,
    recommendRemaining,
    recommendSwap,
  };
}

export default createComboSearch;
