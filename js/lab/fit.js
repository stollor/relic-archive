/* =============================================================================
   遗迹2 · 遗物档案 — lab/fit.js（v2）
   武器适配推荐：突变因子 / 改装 / 圣物碎片 / 特性（无 DOM / 无 fetch / 无 store）。

   口径（docs/LAB_V2.md §2.3）：
     突变因子：weapon === 'any' 或与武器类型相同（longGun/handGun → ranged；melee → melee）；
     改装    ：仅远程武器可换；近战返回空数组并挂 note（固有改装数据待验证）；
              候选排除 tags 含 MeleeWeaponMod / Notify / SharedPickup 的资产行；
     武器契合：武器 tags 与候选 dims 每命中 1 个维度 +0.05（上限 +0.15），why 注明「与武器标签契合」；
     碎片/特性：按 itemScore 降序（同分 score↓→命中维度数↓→id 序）；碎片带颜色计数提示。

   入参 gear：优先模型层 model.gear，也兼容 lab_gear 文档 / 整模型；weaponId 会依次在
   byId / itemsById / slotPools / of() 中解析，解析不到只影响契合加成（为 0），不报错。
   所有函数缺数据时返回空数组，不抛异常。
   ========================================================================== */

const DEFAULT_WEAPON_LIMIT = 5;
const BONUS_PER_DIM = 0.05;
const BONUS_CAP = 0.15;
const KINDS = ['ring', 'amulet', 'mutator', 'mod', 'fragment', 'trait', 'relic'];
const COLOR_KEYS = ['red', 'yellow', 'blue'];
const COLOR_ZH = { red: '红', yellow: '黄', blue: '蓝' };
/** 资产行里不属于「可更换改装」的标签（契约 §2.3） */
const MOD_TAG_BLACKLIST = ['MeleeWeaponMod', 'Notify', 'SharedPickup'];

/**
 * 武器原始 tags → 实验室维度（契约 §1.2 词表的运行时版本；生成器是映射的权威来源，
 * 这里只用于「武器原生契合」加成——拿不到武器 dims 时的兜底）。
 */
const TAG_DIM = [
  [/(ranged|远程)/i, 'ranged'],
  [/(melee|近战)/i, 'melee'],
  [/(crit|weakspot|暴击|弱点)/i, 'crit'],
  [/(status|elemental|状态|元素)/i, 'status'],
  [/(firearm|fire\s*rate|reload|ammo|charge|spread|projectile|射速|装填|弹匣)/i, 'firerate'],
  [/(mod|改装)/i, 'mod'],
  [/(skill|技能)/i, 'skill'],
  [/(explosive|爆炸)/i, 'explosive'],
  [/(armor|defense|damage reduction|护甲|减伤|防御)/i, 'armor'],
  [/(health|shield|grey health|生命|护盾)/i, 'health'],
  [/(healing|health regen|lifesteal|relic|治疗|吸血|圣物)/i, 'heal'],
  [/(stamina|evade|movement speed|体力|闪避|移动速度)/i, 'stamina'],
  [/(utility|pickup|consumable|duration|team|scrap|资源|消耗品|拾取|持续时间|团队)/i, 'utility'],
  [/(summon|召唤)/i, 'summon'],
  [/(damage|伤害)/i, 'dmg'],
];

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

function normLimit(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.floor(n));
}

/** 武器类型归一：槽位名 / family / 引擎口径都收敛到 ranged | melee | '' */
function normType(value) {
  if (!isStr(value)) return '';
  const s = value.trim().toLowerCase();
  if (!s) return '';
  if (s === 'longgun' || s === 'long gun' || s === 'handgun' || s === 'hand gun'
    || s === 'ranged' || s === 'ranged weapon') return 'ranged';
  if (s === 'melee') return 'melee';
  return '';
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

  return { src, doc, rawGear, lists, byId, kindOf, itemOf };
}

/**
 * createFit(gear, scorer) → 武器适配推荐实例。
 * @param {object} gear  模型层 model.gear（或 lab_gear 文档 / 整模型）
 * @param {object} scorer createScorer() 的实例
 */
export function createFit(gear, scorer) {
  const G = createGearContext(gear);
  const S = scorer && typeof scorer.itemScore === 'function' ? scorer : null;

  /** weaponId → 武器条目（lab_gear 没有武器表，额外兼容 itemsById / slotPools / of()） */
  function weaponOf(weaponId) {
    if (isObj(weaponId)) return weaponId;
    if (!isStr(weaponId)) return null;
    const known = G.itemOf(weaponId);
    if (known) return known;
    const bags = [];
    for (const extra of [G.src.itemsById, G.rawGear.itemsById]) {
      if (extra instanceof Map) bags.push([...extra.values()]);
    }
    const pools = isObj(G.src.slotPools) ? G.src.slotPools : isObj(G.rawGear.slotPools) ? G.rawGear.slotPools : null;
    if (pools) for (const list of Object.values(pools)) if (Array.isArray(list)) bags.push(list);
    for (const list of bags) {
      for (const item of list) if (isObj(item) && item.id === weaponId) return item;
    }
    return null;
  }

  /** 武器类型：显式 weaponType 优先，其次武器自身的 weapon / family / type / slot */
  function resolveWeaponType(weaponType, weapon) {
    const fromArg = normType(weaponType);
    if (fromArg) return fromArg;
    if (!weapon) return '';
    return normType(weapon.weapon) || normType(weapon.family) || normType(weapon.type) || normType(weapon.slot);
  }

  /** 武器 → 维度集合（dims 优先，tags 走 §1.2 词表兜底） */
  function weaponDimsOf(weapon) {
    const dims = new Set();
    if (!isObj(weapon)) return dims;
    if (isObj(weapon.dims)) {
      for (const [dimId, value] of Object.entries(weapon.dims)) {
        if (isStr(dimId) && isNum(value) && value > 0) dims.add(dimId);
      }
    }
    const tags = Array.isArray(weapon.tags) ? weapon.tags : [];
    for (const rawTag of tags) {
      if (!isStr(rawTag)) continue;
      for (const [pattern, dimId] of TAG_DIM) if (pattern.test(rawTag)) dims.add(dimId);
    }
    return dims;
  }

  /** 候选与武器每命中 1 个维度 +0.05，上限 +0.15 */
  function weaponBonusOf(item, weaponDims) {
    if (!weaponDims.size || !isObj(item) || !isObj(item.dims)) return 0;
    let matched = 0;
    for (const [dimId, value] of Object.entries(item.dims)) {
      if (!isStr(dimId) || !isNum(value) || value <= 0) continue;
      if (weaponDims.has(dimId)) matched += 1;
    }
    return Math.min(BONUS_CAP, matched * BONUS_PER_DIM);
  }

  function entryOf(kind, item, playstyleId) {
    const target = isObj(item) ? item : null;
    let result = null;
    if (S && target) {
      try { result = S.itemScore(kind, target, playstyleId); } catch { result = null; }
    }
    const dims = result && isObj(result.dims) ? result.dims : {};
    return {
      id: target && isStr(target.id) ? target.id : null,
      item: target,
      zh: target && isStr(target.zh) ? target.zh : target && isStr(target.id) ? target.id : '',
      score: result && isNum(result.score) ? result.score : 0,
      hits: Object.keys(dims).length,
      why: result && Array.isArray(result.why) ? result.why.slice(0, 3) : [],
    };
  }

  /** 统一排序：总分↓ → 命中维度数↓ → id 字典序 */
  function sortRows(rows) {
    rows.sort((a, b) => (a.total === b.total
      ? (a.entry.hits === b.entry.hits ? cmpId(a.entry.id, b.entry.id) : b.entry.hits - a.entry.hits)
      : b.total - a.total));
    return rows;
  }

  function clampUnit(value) {
    if (value < 0) return 0;
    if (value > 1) return 1;
    return value;
  }

  function withBonusWhy(entry, bonus) {
    const why = entry.why.slice();
    if (bonus > 0) why.push('与武器标签契合');
    return why;
  }

  /* ----------------------------- 突变因子 ----------------------------- */
  function recommendMutators(options) {
    const opts = isObj(options) ? options : {};
    const psId = isStr(opts.playstyleId) ? opts.playstyleId : 'general';
    const limit = normLimit(opts.limit, DEFAULT_WEAPON_LIMIT);
    if (limit <= 0) return [];
    const weapon = weaponOf(opts.weaponId);
    const type = resolveWeaponType(opts.weaponType, weapon);
    const weaponDims = weaponDimsOf(weapon);

    const rows = [];
    for (const item of G.lists.get('mutator') || []) {
      if (!isObj(item) || !isStr(item.id)) continue;
      const mutatorWeapon = normType(item.weapon) || 'any';
      if (type && mutatorWeapon !== 'any' && mutatorWeapon !== type) continue;
      const entry = entryOf('mutator', item, psId);
      const bonus = weaponBonusOf(item, weaponDims);
      rows.push({ entry, bonus, weapon: mutatorWeapon, total: roundTo(clampUnit(entry.score + bonus), 3) });
    }
    sortRows(rows);
    return rows.slice(0, limit).map((row) => ({
      id: row.entry.id,
      zh: row.entry.zh,
      score: row.total,
      why: withBonusWhy(row.entry, row.bonus),
      weapon: row.weapon,
    }));
  }

  /* ----------------------------- 改装 ----------------------------- */
  function recommendMods(options) {
    const opts = isObj(options) ? options : {};
    const psId = isStr(opts.playstyleId) ? opts.playstyleId : 'general';
    const limit = normLimit(opts.limit, DEFAULT_WEAPON_LIMIT);
    const weapon = weaponOf(opts.weaponId);
    const type = resolveWeaponType(opts.weaponType, weapon);
    if (type === 'melee') {
      const empty = [];
      empty.note = '近战武器不可更换改装；固有改装数据待验证。';
      empty.weaponType = type;
      return empty;
    }
    if (limit <= 0) return [];
    const weaponDims = weaponDimsOf(weapon);

    const rows = [];
    for (const item of G.lists.get('mod') || []) {
      if (!isObj(item) || !isStr(item.id)) continue;
      const tags = Array.isArray(item.tags) ? item.tags : [];
      const banned = tags.some((tag) => isStr(tag)
        && MOD_TAG_BLACKLIST.some((bad) => tag.toLowerCase().includes(bad.toLowerCase())));
      if (banned) continue;
      const entry = entryOf('mod', item, psId);
      const bonus = weaponBonusOf(item, weaponDims);
      rows.push({ entry, bonus, total: roundTo(clampUnit(entry.score + bonus), 3) });
    }
    sortRows(rows);
    return rows.slice(0, limit).map((row) => ({
      id: row.entry.id,
      zh: row.entry.zh,
      score: row.total,
      why: withBonusWhy(row.entry, row.bonus),
    }));
  }

  /* ----------------------------- 圣物碎片 ----------------------------- */
  function recommendFragments(options) {
    const opts = isObj(options) ? options : {};
    const psId = isStr(opts.playstyleId) ? opts.playstyleId : 'general';
    const limit = normLimit(opts.limit, Infinity);
    const rows = [];
    for (const item of G.lists.get('fragment') || []) {
      if (!isObj(item) || !isStr(item.id)) continue;
      const entry = entryOf('fragment', item, psId);
      rows.push({ entry, total: entry.score });
    }
    sortRows(rows);
    const picked = rows.slice(0, limit).map((row) => ({
      id: row.entry.id,
      zh: row.entry.zh,
      color: isStr(row.entry.item && row.entry.item.color) ? row.entry.item.color : '',
      score: row.total,
      why: row.entry.why.slice(),
      effectZh: isStr(row.entry.item && row.entry.item.effectZh) ? row.entry.item.effectZh : '',
    }));

    // 颜色均衡提示：统计返回集合的红/黄/蓝，缺色时给 note（面板可直接展示）
    const colorCounts = { red: 0, yellow: 0, blue: 0 };
    let unknown = 0;
    for (const item of picked) {
      if (colorCounts[item.color] !== undefined) colorCounts[item.color] += 1;
      else unknown += 1;
    }
    picked.colorCounts = colorCounts;
    const missing = COLOR_KEYS.filter((key) => colorCounts[key] === 0);
    if (picked.length && missing.length) {
      picked.note = `颜色均衡：红 ${colorCounts.red} · 黄 ${colorCounts.yellow} · 蓝 ${colorCounts.blue}`
        + `（缺少${missing.map((key) => COLOR_ZH[key]).join('、')}色碎片）`;
    }
    if (unknown) picked.unknownColor = unknown;
    return picked;
  }

  /* ----------------------------- 特性 ----------------------------- */
  function recommendTraits(options) {
    const opts = isObj(options) ? options : {};
    const psId = isStr(opts.playstyleId) ? opts.playstyleId : 'general';
    const limit = normLimit(opts.limit, Infinity);
    const rows = [];
    for (const item of G.lists.get('trait') || []) {
      if (!isObj(item) || !isStr(item.id)) continue;
      const entry = entryOf('trait', item, psId);
      rows.push({ entry, total: entry.score });
    }
    sortRows(rows);
    return rows.slice(0, limit).map((row) => {
      const item = row.entry.item || {};
      const output = {
        id: row.entry.id,
        zh: row.entry.zh,
        score: row.total,
        why: row.entry.why.slice(),
        maxLevel: isNum(item.maxLevel) && item.maxLevel > 0 ? item.maxLevel : 10,
      };
      if (isObj(item.perLevel) && Object.keys(item.perLevel).length) {
        output.perLevel = { ...item.perLevel };
      }
      return output;
    });
  }

  return {
    recommendMutators,
    recommendMods,
    recommendFragments,
    recommendTraits,
  };
}

export default createFit;
