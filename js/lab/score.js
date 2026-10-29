/* =============================================================================
   遗迹2 · 遗物档案 — lab/score.js（v2）
   实验室 v2 纯评分层（无 DOM / 无 fetch / 无 store，可直接 node --test）。

   口径（docs/LAB_V2.md §2.1）：
     itemScore    = Σ dims[d]·w[d] / Σ w[d]（dims 只取 0<v≤1；无匹配 → 0）
     loadoutScore = 0.7·avg + 0.3·coverage
                    avg = 已解析饰品件 itemScore 的算术平均
                    coverage = 覆盖「权重≥0.6 的维度」占比
     同分排序     = score↓ → 命中维度数↓ → id 字典序（本模块的列表排序统一用此口径）

   输入是已装配的 lab_gear 文档（契约 §1.1：{dimensions, playstyles, gear}），也兼容模型层
   model.gear（含 dimensions / playstyles / 各 kind 数组 / byId / dimensionZh 等）。
   字段缺失、空数组、脏 dims 一律降级为 0，不抛异常。

   确定性：同一输入两次调用结果 deepEqual；分数按契约四舍五入到 3 位，维度贡献 4 位。
   缓存：itemScore 按 (kind, playstyleId, id) 缓存，itemScores 按 (kind, playstyleId) 缓存；
        返回的 Map / 对象只读，调用方不要原地修改。
   ========================================================================== */

/** coverage 只统计权重 ≥ 该值的维度（契约 §2.1） */
export const COVERAGE_WEIGHT = 0.6;
/** itemScore / loadoutScore 的小数位（契约：3 位） */
export const SCORE_DIGITS = 3;

const DIM_DIGITS = 4;
const WHY_TOP = 3;
const KINDS = ['ring', 'amulet', 'mutator', 'mod', 'fragment', 'trait', 'relic'];

const isStr = (v) => typeof v === 'string' && v !== '';
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

/** 四舍五入到 digits 位；-0 归一为 0（避免 deepEqual 因 -0 失败） */
function roundTo(value, digits) {
  if (!isNum(value)) return 0;
  const factor = 10 ** digits;
  const rounded = Math.round(value * factor) / factor;
  return Object.is(rounded, -0) ? 0 : rounded;
}

/** 字典序比较（不用 localeCompare，保证跨环境一致） */
function cmpId(a, b) {
  const left = isStr(a) ? a : '';
  const right = isStr(b) ? b : '';
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

/**
 * createScorer(gearDoc) → 评分器实例。
 * @param {object} gearDoc lab_gear.json 文档，或模型层 model.gear（字段同名）
 */
export function createScorer(gearDoc) {
  const src = isObj(gearDoc) ? gearDoc : {};
  const doc = isObj(src.doc) ? src.doc : src;
  const rawGear = isObj(doc.gear) ? doc.gear : {};

  const dimensions = Array.isArray(src.dimensions) ? src.dimensions
    : Array.isArray(doc.dimensions) ? doc.dimensions : [];
  const playstyles = Array.isArray(src.playstyles) ? src.playstyles : [];

  /* ----------------------------- 维度表 ----------------------------- */
  const dimById = new Map();
  if (src.dimensionById instanceof Map) {
    for (const [id, d] of src.dimensionById) if (isStr(id)) dimById.set(id, isObj(d) ? d : { id });
  }
  for (const d of dimensions) if (isObj(d) && isStr(d.id) && !dimById.has(d.id)) dimById.set(d.id, d);

  const dimensionZh = (id) => {
    if (typeof src.dimensionZh === 'function') {
      try {
        const zh = src.dimensionZh(id);
        if (isStr(zh)) return zh;
      } catch { /* 防御：外部 dimensionZh 抛错时走本地维度表 */ }
    }
    const dim = dimById.get(id);
    const zh = dim && (isStr(dim.zh) ? dim.zh : isStr(dim.name) ? dim.name : '');
    return zh || id;
  };

  /* ----------------------------- 道具池 ----------------------------- */
  const listOf = (kind) => {
    if (Array.isArray(src[kind])) return src[kind];
    if (Array.isArray(doc[kind])) return doc[kind];
    if (Array.isArray(rawGear[kind])) return rawGear[kind];
    return [];
  };
  const lists = new Map(KINDS.map((kind) => [kind, listOf(kind)]));
  const idByKind = new Map(KINDS.map((kind) => [kind, new Map()]));
  const kindById = new Map();
  const byId = new Map();

  for (const kind of KINDS) {
    const index = idByKind.get(kind);
    for (const item of lists.get(kind)) {
      if (!isObj(item) || !isStr(item.id)) continue;
      if (!index.has(item.id)) index.set(item.id, item);
      if (!byId.has(item.id)) byId.set(item.id, item);
      if (!kindById.has(item.id)) kindById.set(item.id, kind);
    }
  }
  // 模型层可能直接给 byId / itemsById（Map<id, item>），只补缺不覆盖
  for (const extra of [src.byId, src.itemsById]) {
    if (!(extra instanceof Map)) continue;
    for (const [id, item] of extra) {
      if (!isStr(id) || !isObj(item) || byId.has(id)) continue;
      byId.set(id, item);
      if (isStr(item.kind) && !kindById.has(id)) kindById.set(id, item.kind);
    }
  }

  function kindOf(id) {
    if (!isStr(id)) return null;
    if (typeof src.kindOf === 'function') {
      try {
        const kind = src.kindOf(id);
        if (isStr(kind)) return kind;
      } catch { /* 防御：外部 kindOf 抛错时走本地索引 */ }
    }
    return kindById.get(id) || null;
  }

  function itemOf(id, kind) {
    if (!isStr(id)) return null;
    // 指定 kind 时只查该 kind：避免项圈/戒指等跨类型同名 id 被误用
    if (isStr(kind) && idByKind.has(kind)) return idByKind.get(kind).get(id) || null;
    const hit = byId.get(id);
    if (hit) return hit;
    if (typeof src.of === 'function') {
      try {
        const item = src.of(id);
        if (isObj(item) && isStr(item.id)) return item;
      } catch { /* 防御 */ }
    }
    return null;
  }

  /* ----------------------------- 流派权重上下文 ----------------------------- */
  const playstyleById = new Map();
  if (src.playstyleById instanceof Map) {
    for (const [id, ps] of src.playstyleById) if (isStr(id)) playstyleById.set(id, isObj(ps) ? ps : { id });
  }
  for (const ps of playstyles) if (isObj(ps) && isStr(ps.id) && !playstyleById.has(ps.id)) playstyleById.set(ps.id, ps);

  const ctxCache = new Map();
  function ctxFor(playstyleId) {
    const key = isStr(playstyleId) ? playstyleId : '';
    if (ctxCache.has(key)) return ctxCache.get(key);
    const ps = playstyleById.get(key) || null;
    const weights = {};
    if (ps && isObj(ps.dims)) {
      const canValidate = dimById.size > 0;
      for (const [dimId, raw] of Object.entries(ps.dims)) {
        if (!isStr(dimId) || !isNum(raw) || raw <= 0) continue;
        if (canValidate && !dimById.has(dimId)) continue; // 维度表外的脏键忽略
        weights[dimId] = roundTo(raw, DIM_DIGITS);
      }
    }
    const entries = Object.entries(weights);
    const denom = entries.reduce((sum, [, w]) => sum + w, 0);
    const high = entries.filter(([, w]) => w >= COVERAGE_WEIGHT).map(([dimId]) => dimId);
    const ctx = { key, weights, entries, denom, high };
    ctxCache.set(key, ctx);
    return ctx;
  }

  /* ----------------------------- 维度排序 ----------------------------- */
  function topDims(dims, n) {
    const limit = Number.isFinite(n) ? Math.max(0, Math.floor(n)) : WHY_TOP;
    if (!limit) return [];
    const rows = [];
    if (Array.isArray(dims)) {
      for (const row of dims) {
        if (!isObj(row) || !isStr(row.id)) continue;
        rows.push({ id: row.id, v: isNum(row.v) ? row.v : 0 });
      }
    } else if (isObj(dims)) {
      for (const [id, v] of Object.entries(dims)) if (isNum(v) && v > 0) rows.push({ id, v });
    }
    rows.sort((a, b) => (a.v === b.v ? cmpId(a.id, b.id) : b.v - a.v));
    return rows.slice(0, limit).map((row) => ({
      id: row.id,
      zh: dimensionZh(row.id),
      v: roundTo(row.v, DIM_DIGITS),
    }));
  }

  /* ----------------------------- itemScore ----------------------------- */
  const scoreCache = new Map();
  const scoresCache = new Map();

  function itemScore(kind, item, playstyleId) {
    let itemKind = isStr(kind) ? kind : null;
    let target = item;
    if (isStr(item)) {
      if (!itemKind) itemKind = kindOf(item);
      target = itemOf(item, itemKind);
    }
    const itemId = isObj(target) && isStr(target.id) ? target.id : null;
    const psId = isStr(playstyleId) ? playstyleId : '';
    const cacheKey = itemId ? `${itemKind || ''}\u0000${psId}\u0000${itemId}` : '';
    if (cacheKey && scoreCache.has(cacheKey)) return scoreCache.get(cacheKey);

    const ctx = ctxFor(psId);
    const rawDims = isObj(target) && isObj(target.dims) ? target.dims : null;
    const contrib = {};
    let sum = 0;
    if (rawDims) {
      for (const [dimId, weight] of ctx.entries) {
        const raw = rawDims[dimId];
        if (!isNum(raw) || raw <= 0) continue;     // 只取 0<v（≤1；>1 视作 1，防御脏数据）
        const value = raw > 1 ? 1 : raw;
        const part = value * weight;
        sum += part;
        contrib[dimId] = roundTo(part, DIM_DIGITS);
      }
    }
    const score = ctx.denom > 0 ? roundTo(sum / ctx.denom, SCORE_DIGITS) : 0;
    const result = { score, dims: contrib, why: topDims(contrib, WHY_TOP).map((row) => row.zh) };
    if (cacheKey) scoreCache.set(cacheKey, result);
    return result;
  }

  function itemScores(kind, playstyleId) {
    const psId = isStr(playstyleId) ? playstyleId : '';
    const cacheKey = `${isStr(kind) ? kind : ''}\u0000${psId}`;
    if (scoresCache.has(cacheKey)) return scoresCache.get(cacheKey);
    const map = new Map();
    for (const item of lists.get(kind) || []) {
      if (isObj(item) && isStr(item.id)) map.set(item.id, itemScore(kind, item, psId).score);
    }
    scoresCache.set(cacheKey, map);
    return map;
  }

  /* ----------------------------- loadoutScore ----------------------------- */
  function loadoutScore(ids, playstyleId) {
    const list = Array.isArray(ids) ? ids : ids == null ? [] : [ids];
    const psId = isStr(playstyleId) ? playstyleId : '';
    const seen = new Set();
    const pieces = [];
    for (const entry of list) {
      const id = isStr(entry) ? entry : isObj(entry) && isStr(entry.id) ? entry.id : null;
      if (!id || seen.has(id)) continue;            // 同一 id 只算一次（戒指规则）
      const kind = kindOf(id);
      const item = itemOf(id, kind);
      if (!item) continue;                          // 数据缺件：不参与平均，也不伪造 0 分
      seen.add(id);
      pieces.push(itemScore(kind, item, psId));
    }

    const ctx = ctxFor(psId);
    const n = pieces.length;
    const avgRaw = n ? pieces.reduce((sum, piece) => sum + piece.score, 0) / n : 0;
    const covered = new Set();
    for (const piece of pieces) for (const dimId of Object.keys(piece.dims)) covered.add(dimId);
    const highCount = ctx.high.length;
    const covRaw = highCount ? ctx.high.filter((dimId) => covered.has(dimId)).length / highCount : 0;

    const dims = {};
    for (const piece of pieces) {
      for (const [dimId, value] of Object.entries(piece.dims)) {
        dims[dimId] = roundTo((dims[dimId] || 0) + value, DIM_DIGITS);
      }
    }
    return {
      score: roundTo(0.7 * avgRaw + 0.3 * covRaw, SCORE_DIGITS),
      avg: roundTo(avgRaw, SCORE_DIGITS),
      coverage: roundTo(covRaw, SCORE_DIGITS),
      dims,
    };
  }

  /* ----------------------------- playstylesFor ----------------------------- */
  function playstylesFor(kind, item) {
    const rows = [];
    for (const ps of playstyles) {
      if (!isObj(ps) || !isStr(ps.id)) continue;
      const result = itemScore(kind, item, ps.id);
      rows.push({
        id: ps.id,
        zh: isStr(ps.zh) ? ps.zh : ps.id,
        score: result.score,
        hits: Object.keys(result.dims).length,
      });
    }
    rows.sort((a, b) => (a.score === b.score ? (a.hits === b.hits ? cmpId(a.id, b.id) : b.hits - a.hits) : b.score - a.score));
    return rows.slice(0, 2).map(({ id, zh, score }) => ({ id, zh, score }));
  }

  /** 供 combos.js 复用同一份权重口径（避免两套权重来源漂移）；只读副本 */
  function weightsOf(playstyleId) {
    return { ...ctxFor(playstyleId).weights };
  }

  return {
    itemScore,
    itemScores,
    loadoutScore,
    topDims,
    playstylesFor,
    weightsOf,
  };
}

export default createScorer;
