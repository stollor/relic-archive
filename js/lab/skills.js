/* =============================================================================
   遗迹2 · 遗物档案 — lab/skills.js
   从已加载的 items.json 推导「每个职业的 3 个技能」，供装配台「职业与技能」页。
   纯模块：无 DOM / 无网络 / 不依赖 store 与 core，可直接 node --test。

   数据口径（只过滤与选取，不改数据）：
     · 技能行 = cat === 'skill'；归属只看 pkg 的 /Archetypes/<ArchId>/Skills/<DirName>/
     · 同一技能目录下大量子对象（动作 / 光环 / 增益 / 投射物…，见 FX_SUFFIX）不是技能本体：
       组内优先「id 非特效后缀 + 中文名」的行，退化时取中文名最短 id 的行；
       每职业只留 3 条（数据不足照实输出，不补造）
     · 中文名必须含汉字：core/api.js 的 zh 会用英文名兜底，「zh 非空」判断不成立
     · 未实装职业（status === 'unreleased'）与 pkg 无法解析的行一律跳过
   ========================================================================== */

export const MAX_SKILLS = 3;
export const MAX_NUMS = 4;
export const SKILL_NOTE = '技能由解包数据按职业/技能目录推导，子对象已过滤；未收录处标注待验证';

/** pkg → 职业 id + 技能目录名（Gambler 用 /Archetype/ 单数，两种都收） */
const SKILL_PKG = /\/(?:Archetypes?)\/([^/]+)\/Skills\/([^/]+)(?:\/|$)/;
const CJK = /[\u4e00-\u9fff]/;
/** 特效子对象后缀：挂在技能目录下，不是技能本体；与 id 统一按小写比较（大小写不敏感） */
const FX_SUFFIX = [
  '_action', '_aura', '_buff', '_shield', '_field', '_hot', '_manager', '_visual',
  '_notarget', '_allybuff', '_selfbuff', '_enemyexplosion', '_creepingaoe', '_actor',
  '_charge', '_blast', '_projectile', '_tidalwave', '_command', '_ghost',
];
/** 关键数值：按优先级取前 MAX_NUMS 条（同标签只取第一条；解包数据里充能有 MaxCharges/Charges 两种写法） */
const NUM_FIELDS = [
  ['CooldownTime', '冷却', ' 秒'],
  ['MaxCharges', '充能', ' 次'],
  ['Charges', '充能', ' 次'],
  ['Damage', '伤害', ''],
  ['HoldTime', '蓄力', ' 秒'],
  ['Range', '范围', ''],
];

const str = (v) => (typeof v === 'string' ? v.trim() : '');
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const hasZh = (v) => CJK.test(str(v));
const round2 = (v) => Math.round(v * 100) / 100;
const byDirName = (a, b) => (a.dir < b.dir ? -1 : a.dir > b.dir ? 1 : 0);

function isFxBody(id) {
  const lower = id.toLowerCase();
  for (const suffix of FX_SUFFIX) {
    if (lower.endsWith(suffix) || lower.includes(`${suffix}_`)) return true;
  }
  return false;
}

/** 组内挑一条技能本体（id 最短、同长字典序）；只有无名子对象时返回 null */
function pickRow(rows) {
  const named = rows.filter((row) => hasZh(row.zh));
  if (!named.length) return null;
  const plain = named.filter((row) => !isFxBody(row.id));
  const pool = plain.length ? plain : named;
  return pool.reduce((best, row) => {
    if (row.id.length !== best.id.length) return row.id.length < best.id.length ? row : best;
    return row.id < best.id ? row : best;
  });
}

/** numbers → 中文标签的已格式化数值 */
function numRows(numbers) {
  const n = numbers && typeof numbers === 'object' ? numbers : {};
  const out = [];
  const labels = new Set();
  for (const [key, label, unit] of NUM_FIELDS) {
    if (!isNum(n[key]) || labels.has(label)) continue;
    labels.add(label);
    out.push({ label, value: `${round2(n[key])}${unit}` });
    if (out.length >= MAX_NUMS) break;
  }
  return out;
}

/** 中文效果摘要：summary_zh → effect.lines[].display_zh → 已格式化数值 → 待验证 */
function summaryOf(item, nums) {
  const effect = item.effect && typeof item.effect === 'object' ? item.effect : null;
  const lines = Array.isArray(effect && effect.lines)
    ? effect.lines.map((line) => str(line && line.display_zh)).filter(Boolean)
    : [];
  const text = str(item.summaryZh) || str(effect && effect.summary_zh) || lines.join('；');
  if (text) return text;
  if (nums.length) return nums.map((row) => `${row.label} ${row.value}`).join('、');
  return '效果待验证';
}

/** 英文原文只原样保留（UI 折叠区），不用于中文效果 */
function descEnOf(item) {
  const text = item.text && typeof item.text === 'object' ? item.text : null;
  const desc = text && text.description && typeof text.description === 'object' ? text.description : null;
  return str(item.descEn) || str(desc && desc.en) || str(item.description_en) || '';
}

function toSkill(item, arch, model) {
  const numbers = item.numbers && typeof item.numbers === 'object' ? item.numbers : {};
  const nums = numRows(numbers);
  const iconUrl = typeof model.itemIcon === 'function' ? (model.itemIcon(item) || null) : null;
  const charges = isNum(numbers.MaxCharges) ? numbers.MaxCharges
    : (isNum(numbers.Charges) ? numbers.Charges : null);
  return {
    id: str(item.id),
    zh: str(item.zh),
    en: str(item.en),
    archId: str(arch.id),
    archZh: str(arch.zh) || str(arch.id),
    cooldown: isNum(numbers.CooldownTime) ? numbers.CooldownTime : null,
    charges,
    damage: isNum(numbers.Damage) ? numbers.Damage : null,
    nums,
    summary: summaryOf(item, nums),
    descEn: descEnOf(item),
    iconUrl,
  };
}

/** cat==='skill' 的行按 职业 → 技能目录 分桶；pkg 解析不到的丢弃 */
function groupSkills(items) {
  const groups = new Map();
  for (const item of items) {
    if (!item || item.cat !== 'skill') continue;
    const match = SKILL_PKG.exec(str(item.pkg));
    if (!match) continue;
    const [, archId, dir] = match;
    let byDir = groups.get(archId);
    if (!byDir) groups.set(archId, (byDir = new Map()));
    let rows = byDir.get(dir);
    if (!rows) byDir.set(dir, (rows = []));
    rows.push({ id: str(item.id), zh: str(item.zh), item });
  }
  return groups;
}

/** 一个职业技能：组内选本体 → 同名去重 → 本体组优先 + 目录名固定序 → 截断 MAX_SKILLS */
function skillsOf(byDir, arch, model, seenIds) {
  const entries = [];
  for (const [dir, rows] of byDir) {
    const picked = pickRow(rows);
    if (picked) entries.push({ dir, base: !isFxBody(picked.id), item: picked.item, zh: picked.zh });
  }
  entries.sort((a, b) => (Number(b.base) - Number(a.base)) || byDirName(a, b));
  const skills = [];
  const seenZh = new Set();
  for (const entry of entries) {
    if (seenZh.has(entry.zh)) continue;
    const skill = toSkill(entry.item, arch, model);
    if (!skill.id || seenIds.has(skill.id)) continue;
    seenZh.add(entry.zh);
    seenIds.add(skill.id);
    skills.push(skill);
    if (skills.length >= MAX_SKILLS) break;
  }
  return skills;
}

/**
 * 从 loadLabModel() 的返回值推导每职业技能。
 * @param {object} model 需含 itemsById(Map) / archetypes / findArchetype / itemIcon
 * @returns {{byArchetype: Map<string, object[]>, all: object[], derived: number, note: string}}
 *   缺数据不抛异常：返回空 Map / 空数组 / derived 0。
 */
export function deriveSkills(model) {
  const source = model && typeof model === 'object' ? model : {};
  const archetypes = Array.isArray(source.archetypes) ? source.archetypes : [];
  const items = source.itemsById && typeof source.itemsById.values === 'function'
    ? Array.from(source.itemsById.values())
    : [];
  const archById = new Map();
  for (const arch of archetypes) {
    const id = str(arch && arch.id);
    if (id && !archById.has(id)) archById.set(id, arch);
  }
  const findArch = (id) => {
    const hit = archById.get(id);
    if (hit) return hit;
    const found = typeof source.findArchetype === 'function' ? source.findArchetype(id) : null;
    return found && typeof found === 'object' && str(found.id) ? found : null;
  };

  const groups = groupSkills(items);
  const byArchetype = new Map();
  const all = [];
  const seenIds = new Set();
  for (const arch of archetypes) {
    const archId = str(arch && arch.id);
    if (!archId || str(arch.status) === 'unreleased' || !groups.has(archId)) continue;
    const skilled = findArch(archId);
    if (!skilled) continue;
    const skills = skillsOf(groups.get(archId), skilled, source, seenIds);
    if (!skills.length) continue;
    byArchetype.set(archId, skills);
    all.push(...skills);
  }
  return { byArchetype, all, derived: byArchetype.size, note: SKILL_NOTE };
}

export default deriveSkills;
