# 实验室 v2（配装规划器）— 实现契约

> 状态：第一批（实验室 2/3/4/5/6/7/8）已实现（2026-10-30，站点 v3.7）。第二批（知识站数据）另立文档。
> 事实源：代码 > 本文 > 其它 docs。本文只描述**本批新增的契约**，不重复 UX_SPEC / ARCHITECTURE。

## 0. 目标与硬约束

把实验室从「防御数值计算器」升级为「配装规划器」：

| 需求 | 落点 |
|---|---|
| 2 健全特性 | 全量 43 条真特性进实验室（`cat=trait` 的 85 行里 42 行是 `*_Stats` 数值表分支；等级 0–10、总上限 10 个、维度分、数值特性仍并入防御引擎） |
| 3 饰品组合 + 武器突变因子/改装 | 新增「饰品组合」「武器改装」面板；以 1 项链 + 4 戒指组合为核心 |
| 4 圣物碎片 | 45 碎片（红/黄/蓝各 15）进「圣物碎片」面板；圣物 3 碎片槽；棱晶机制说明 |
| 5 结果面板输出 | 复制 Markdown / 复制 JSON / 下载 .md / 打印 |
| 6 tab 分组 | 面板注册表加 `group`，视图渲染「一级分组 tab + 二级面板 tab」 |
| 7 默认全部可用 | 实验室可用池 = 全库 − 缺件；不再以「已拥有」为门槛；缺件可在选择器/详情/结果行标记 |
| 8 按已装备推荐剩余 | 组合搜索支持固定已选槽位，对空槽做边际最优推荐 |

硬约束（违反 = 返工）：

1. 不新增依赖 / 构建步骤 / 外部字体 / CDN；不加 npm。
2. 颜色只用 `css/tokens.css` 变量；视图 CSS 禁止颜色字面量。
3. 数据只经 `js/core/api.js`；视图/面板禁止 `fetch`。
4. 状态只经 `js/core/store.js`；不新增 localStorage key（meta 走 `store.build.setMeta`，缺件走 `store.ui['lab.missing']`）。
5. 不编造数据：无来源写「待验证」；维度分必须能回溯到 `tags` / 词条关键词（`evidence` 字段）。
6. 共享能力唯一实现：空态 `components/states.js`、面板 `components/panel.js`、词表 `core/labels.js`、异步 `core/task.js`。
7. 门禁绿才提交；数字只看门禁输出。
8. 本批不做：知识库文章（第二批）、构建/依赖、把 `data/builds.json` 迁出站点。

## 1. 新数据文件：`data/lab_gear.json`（schema 1）

生成链（工作区）：

```
.mimocode/data/items.json                     （道具：id/中文名/filter_tags/数值/来源）
.mimocode/data/wiki_items.jsonl               （wiki 结构化：tags/type/require_dlc/acquisition）
.mimocode/data/item_effects.json              （官方效果句 zh/en）
.mimocode/build/ref/{ring,amulet,meta_gem,mod,trait,relic,fragment}.md （人工整理 wiki 效果 EN + 中文派生）
.mimocode/data/site_data.json modifiers       （防御向数值效果，已有 141 条）
        │
        ├─ .mimocode/build/mk_lab_gear.py  →  .mimocode/data/lab_gear.json
        └─ pipeline/sync-data.py           →  relic-archive/data/lab_gear.json
```

### 1.1 结构

```jsonc
{
  "meta": {
    "schema": 1,
    "generated": "2026-10-30T12:00:00+08:00",
    "generator": "build/mk_lab_gear.py",
    "sources": ["items.json", "wiki_items.jsonl", "item_effects.json",
                "build/ref/*.md", "site_data.json#modifiers", "locres_zh-Hans.json"],
    "notes": ["维度分来自游戏 filter_tags 与词条关键词的映射，用于同一口径下比较，不是游戏内精确数值。"],
    "counts": { "dimensions": 15, "playstyles": 9, "ring": 0, "amulet": 0, "mutator": 0,
                "mod": 0, "fragment": 44, "trait": 0, "relic": 0 }
  },
  "dimensions": [ { "id": "dmg", "zh": "通用伤害", "order": 1 } ],
  "playstyles": [ { "id": "general", "zh": "通用", "en": "General", "desc": "…",
                    "dims": { "dmg": 0.5, "armor": 0.4 }, "order": 1 } ],
  "gear": {
    "ring":     [ Item ], "amulet": [ Item ], "mutator": [ Mutator ],
    "mod":      [ Item ], "fragment": [ Fragment ], "trait": [ Trait ], "relic": [ Item ]
  }
}
```

`Item`（ring / amulet / mod / relic 共用，字段可缺省但键名固定）：

```jsonc
{
  "id": "Ring_Example",          // 必填，全局唯一；与 items.json / site_data.modifiers 对齐
  "zh": "示例戒指", "en": "Example Ring",   // 必填中文；无来源时 zh=id 并 confidence=low
  "dlc": "base|dlc1|dlc2|dlc3|dlc4",         // 缺省 base
  "tags": ["CritChance", "Ranged"],          // 原始标签（保留英文原样，去重）
  "dims": { "crit": 1, "ranged": 1 },        // 维度分 0.5/1，键必须是 dimensions[].id
  "effectZh": "…", "effectEn": "…",
  "effectSrc": "official|derived|wiki|none",  // 中文效果句来源
  "effectKeys": ["armor_flat"],               // 可选：site_data.modifiers 里的数值键（有防御口径时）
  "hard": false,                              // 获取难度（Boss/解谜/随机=hard）
  "confidence": "high|mid|low",
  "evidence": ["tag:CritChance", "kw:暴击"],  // 维度分依据；空数组表示未匹配
  "note": "可选：口径说明"
}
```

`Mutator` 额外：`"weapon": "ranged" | "melee" | "any"`（来自 wiki filepath `MetaGem_Melee/_Ranged`，其次 tags 的 Melee/Ranged；都无 → any）。

`Fragment` 额外：

```jsonc
{ "id": "Fragment_ArmorBonus", "zh": "护甲加成", "en": "Armor Bonus",
  "color": "red|yellow|blue",        // wiki fields.type；Blue=蓝、Yellow=黄、Red=红
  "stat": "Armor Bonus",
  "dims": { "armor": 1 },
  "effectZh": "护甲效果 +10%", "effectEn": "Increases Armor Effectiveness by 10%.",
  "effectKeys": ["armor_efficacy"],  // 与 site_data.modifiers.fragments 对齐时填
  "confidence": "high" }
```

`Trait` 额外：`"maxLevel": 10`、`"perLevel": { "armor_efficacy": 0.05 }`（仅当 `site_data.modifiers.traits` 有数值时填）。

### 1.2 维度表（固定 15 项，`id` 不可改）

| id | zh | 标签/关键词映射（EN → id，中文同义） |
|---|---|---|
| dmg | 通用伤害 | Damage、All Damage、伤害 |
| ranged | 远程 | Ranged、远程 |
| melee | 近战 | Melee、近战 |
| crit | 暴击/弱点 | Critical Chance、Critical Damage、Weakspot、CritChance、暴击、弱点 |
| status | 状态/元素 | Status Effect(s)、Status、Elemental、状态、元素 |
| mod | 改装 | Mod、Mod Damage、Mod Generation、改装 |
| skill | 技能 | Skill、Skill Damage、技能 |
| firerate | 射速/装填 | Fire Rate、Reload Speed、Ammo Reserves、Charge、Firearm Charge Time、Firearm Swap Speed、Weapon Spread、Projectile Speed、射速、装填、弹匣 |
| explosive | 爆炸 | Explosive、爆炸 |
| armor | 护甲/减伤 | Armor、Armor Effectiveness、Defense、Damage Reduction、护甲、减伤、防御 |
| health | 生命/护盾 | Health、Max Health、Grey Health、Shield、生命、护盾、灰色生命 |
| heal | 治疗/吸血/圣物 | Healing、Health Regeneration、Lifesteal、Relic、Relic Efficacy、治疗、吸血、圣物 |
| stamina | 体力/闪避/移速 | Stamina、Evade、Movement Speed、Stamina Cost、体力、闪避、移动速度 |
| utility | 资源/功能 | Utility、Pickup、Consumable、Duration、Team、Scrap、资源、消耗品、拾取、持续时间、团队 |
| summon | 召唤 | Summon、召唤 |

另：`site_data.modifiers` 的数值键 → 维度（生成器统一处理）：`armor_flat/armor_efficacy/flat_dr/enemy_damage_reduction → armor`、`health_max/health_pct/shield_pct → health`、`health_regen/lifesteal/health_leech → heal`、`stamina_max/stamina_pct/stamina_regen/stamina_cost_pct/evade_* → stamina`、`weight_* → utility`。

### 1.3 流派表（固定 9 项，权重 0–1）

| id | zh | dims 权重 |
|---|---|---|
| general | 通用 | dmg .5 / armor .4 / health .4 / utility .2 |
| ranged_crit | 远程暴击 | dmg .6 / ranged .8 / crit .9 / firerate .4 |
| ranged_sustain | 远程续航 | dmg .4 / ranged .7 / firerate .8 / utility .3 |
| melee | 近战 | dmg .5 / melee .9 / crit .5 / stamina .3 |
| status | 状态流 | dmg .3 / status .9 / ranged .4 / mod .3 |
| caster | 改装/技能 | dmg .3 / mod .9 / skill .8 / utility .3 |
| tank | 生存坦克 | armor .9 / health .8 / heal .5 / stamina .2 |
| support | 辅助/召唤 | heal .7 / utility .8 / summon .6 / armor .3 |
| summoner | 召唤流 | summon .9 / skill .6 / utility .4 / heal .3 |

## 2. 纯计算模块（`js/lab/`，无 DOM、无 fetch、可 `node --test`）

### 2.1 `score.js`

```js
export function createScorer(gearDoc) -> {
  itemScore(kind, item, playstyleId) -> { score, dims, why: [zh…] }   // 0–1，3 位小数
  itemScores(kind, playstyleId) -> Map<id, number>                     // 预算缓存
  loadoutScore(ids, playstyleId) -> { score, avg, coverage, dims }     // 饰品 5 件口径
  topDims(dims, n) -> [{ id, zh, v }]
  playstylesFor(kind, item) -> [{ id, zh, score }]                     // 前 2 个
}
```

- `itemScore = Σ dims[d]·w[d] / Σ w[d]`，`dims` 只取 `0<v≤1`；无匹配 → 0。
- `loadoutScore`：`avg = 平均 itemScore`；`coverage = 覆盖的「权重≥0.6 的维度」占比`；`score = 0.7·avg + 0.3·coverage`。
- 同分排序：score ↓ → dims 命中和 ↓ → id 字典序（保证确定性）。

### 2.2 `combos.js`

```js
export function createComboSearch(gear, scorer) -> {
  recommendTrinkets({ playstyleId, fixedAmulet, fixedRings, excludeIds, limit }) 
    -> { combos: [{ amulet, rings: [4], score, avg, coverage, dims, why }], stats }
  recommendRemaining({ playstyleId, fixed, emptySlots, excludeIds })
    -> { slots: [{ slot, items: [{ id, kind, score, why }] }] }               // 每空槽前 5
  recommendSwap({ playstyleId, current: { amulet, rings }, excludeIds })
    -> [{ slot, from, to, gain, why }]                                        // 同槽更优替换
}
```

- 候选池：`ring` 按 itemScore 取前 24，`amulet` 取前 12；过滤 `excludeIds`（缺件）与固定件重复。
- 固定件（已装备）先占位，剩余槽从池里取；固定件不满足唯一性时返回空 + error 字符串。
- 遍历 12 × C(24,4) = 126,720 组（固定件多时更少），纯算术；面板用 `createTaskRunner` 分帧，单帧 ≤ 8ms。
- 戒指不可重复（游戏规则）；项链与戒指不混淆。
- 返回按 `score` 降序，`why` 取组合内各件 top1 维度。

### 2.3 `fit.js`

```js
export function createFit(gear, scorer) -> {
  recommendMutators({ weaponType, weaponId, playstyleId, limit }) -> [{ id, zh, score, why, weapon }]
  recommendMods({ weaponType, weaponId, playstyleId, limit }) -> [{ id, zh, score, why }]
  recommendFragments({ playstyleId, limit }) -> [{ id, zh, color, score, why, effectZh }]
  recommendTraits({ playstyleId, limit }) -> [{ id, zh, score, why, maxLevel }]
}
```

- 突变因子：`weapon === 'any'` 或与 `weaponType` 相同（longGun/handGun → ranged；melee → melee）。
- 改装：仅远程武器可换改装；近战武器只显示固有改装（无数据时给「待验证」）。改装候选排除 tags 含 `MeleeWeaponMod`/`Notify`/`SharedPickup` 的资产行。
- 武器原生契合：武器 `tags` 与候选 `dims` 每命中 1 个维度 +0.05（上限 +0.15），并在 `why` 里注明「与武器标签契合」。
- 碎片：按 itemScore 降序，颜色均衡提示（红/黄/蓝），返回前 N；`effectZh` 直接展示。
- 特性：全量 43 条按 itemScore 降序返回；数值特性额外带 `perLevel`（供「全满」与防御合计）。

## 3. 模型 / 状态 / API（Lead 负责，先落地）

### 3.1 `js/core/api.js`
新增 `api.labGear()`：加载 `./data/lab_gear.json`，缓存，失败时抛错（实验室显示可重试失败态）。可选同步读 `api.labGearSync()`。

### 3.2 `js/lab/model.js`
`loadLabModel()` 并行加载 site / itemList / archetypes / labGear / icons，返回新增：

```js
model.gear = {
  doc, dimensions, dimensionById, dimZh(id),
  playstyles, playstyleById,
  ring, amulet, mutator, mod, fragment, trait, relic,     // 数组（已按 zh 排序或按数据顺序）
  byId,                                                  // Map<id, item+{kind}>
  kindOf(id),
}
```
`slotPools` 不变；职业 / 护甲兜底不变。

### 3.3 `js/lab/state.js`
- `playstyleId()` / `setPlaystyle(id)`：写 `meta.playstyle`，默认 `general`，非法值回退。
- 碎片槽：`fragmentSlots()` → `[id|null ×3]`，写 `meta.fragmentSlots`；旧 `meta.fragments: string[]` 首次读取迁移到前三槽并清空旧键（迁移只跑一次）。`setFragmentSlot(i,id)` / `clearFragmentSlot(i)`。
- 武器挂件：`mutatorOf(slot)` / `setMutator(slot,id)` / `modOf(slot)` / `setMod(slot,id)`；写 `meta.attachments = { [slot]: { mutator, mod } }`；slot ∈ longGun/handGun/melee。
- `workbenchPicks()`：`fragments` 由碎片槽派生（非空槽 → `{id:true}`）；不变其它。
- 移除 `ownedOnly` 依赖：`ownedSet/ownedCount` 保留给资料库，但实验室不再使用（可用池 = 全库 − 缺件）。

### 3.4 `js/views/lab.js` 面板注册表（tab 分组）
`PANELS` 每项新增 `group`：`plan`（推荐方案 / 饰品组合 / 武器改装）· `gear`（特性 / 圣物碎片 / 逐槽替换）· `data`（档位对照 / 计算器 / 存档导出）。
视图渲染两级 tab：一级 group（3 个），二级该 group 的 panel；`?panel=` 深链语义不变，旧路由重定向不变。

### 3.5 面板实例契约（不变）
`{ el, mount?, refresh?, applyParams?(params), activate?, destroy? }`；创建依赖 `deps = { setQuery, openPanel, query }`。

## 4. 面板（`js/lab/<panel>.js`）

### 4.1 `trinkets.js` — 饰品组合（需求 3 核心）
- 顶部：流派选择（9 个 seg/chip）；说明「1 项链 + 4 戒指，按流派维度组合评分；口径见页脚」。
- 主区：组合列表（每页 10）：编号 / 组合评分 / 覆盖 / 5 件 miniPiece（可点详情）/ 「写入饰品槽」/「标记缺件」。
- 侧栏/折叠：「剩余槽位推荐」——当前已装备的项链/戒指固定，列出每个空槽前 5（含 +分）；「同槽替换」——对已装备的 5 件给出更优替代与增益。
- URL 参数：`ps`（流派）、`page`、`fixed`（可选，逗号分隔已固定 id，用于分享）。

### 4.2 `weapons.js` — 武器改装（需求 3）
- 顶部：武器槽选择（长枪/手枪/近战，取工作台当前武器）；流派继承全局。
- 两块：「突变因子」列表（适配当前武器类型 + 流派前 5，显示效果原文与适配流派）；「改装」列表（远程武器可换，前 5；近战显示固有改装/待验证）。
- 每行可「写入」到该武器的挂件（写 `meta.attachments`），行内显示「当前」标记。

### 4.3 `traits.js` — 特性（需求 2）
- 全量 43 特性列表：中文名 / 维度标签 / 效果原文（官方）/ 等级步进器（0–10）/ 已用 10 上限提示。
- 顶栏：流派推荐前 10（一键设为满级）；清空；按维度筛选 chip。
- 数值特性（site_data.modifiers 有 perLevel）在等级>0 时显示折算效果，并参与结果面板防御数值。

### 4.4 `fragments.js` — 圣物碎片（需求 4）
- 顶部说明：圣物 3 碎片槽；碎片按颜色（红/黄/蓝）；颜色加成与棱晶机制出处 = locres（置信 mid），未证实部分写「待验证」。
- 3 个槽位卡片（空/已选）+ 全部 45 碎片列表（颜色 badge / 效果 / 维度 / 「放入槽 n」）。
- 顶栏：「按流派推荐 3 件」（一键填入）。

### 4.5 `wb-result.js` — 结果面板输出（需求 5）
- 保持现有防御/生存/机动数值不动；新增工具条：
  - 「复制 Markdown」：当前 15 槽 + 特性 + 碎片 + 挂件 + 关键数值 + 流派/场景，表格化。
  - 「复制 JSON」：`{ meta, slots, traits, fragments, attachments, stats }`。
  - 「下载 .md」：同上 Markdown 落盘（Blob + a[download]）。
  - 「打印」：`window.print()`（配套 print CSS 隐藏交互按钮）。
- 文案明确：输出内容含「口径说明」一段。

### 4.6 缺件标记（需求 7）
- 选择器行、结果行、组合行提供「标记缺件」开关（复用 `S.toggleMissing`）。
- 工作台槽位已有「缺件」badge；保持不变。
- 推荐/组合/替换一律默认排除缺件；开关「包含缺件」保留（默认关）。

## 5. CSS
- 新样式全部落在 `css/view-lab.css`，颜色只用 token；新 tab 组用 `.lab-tabs`/`.lab-tabs__group`。
- 移动端：两级 tab 可横向滚动；组合列表单列。

## 6. 验收
- 改完先 `node qa/gate.mjs quick`；面板/样式改动 `related`；提交前 `full`。
- 新增单测：`qa/tests/lab-score.test.mjs`（score/combos/fit 纯函数：确定性、上限、固定件、缺件排除）。
- 数据契约：`qa/lib/data-schema.mjs` 增加 `labGear` 文件与结构校验（error 只锁必填键，未知额外字段忽略）。
- 文档：`docs/DATA.md` 增一行；`CHANGELOG.md` 记本批；`docs/UX_SPEC.md` 增「实验室 v2」节。

## 7. 写域与协作（多 Agent）

| 角色 | 只写这些 |
|---|---|
| Lead | `js/core/api.js`、`js/lab/model.js`、`js/lab/state.js`、`js/lab/workbench.js`、`js/views/lab.js`、`js/lab/wb-result.js`、`js/core/store.js`、`js/views/library.js`、`css/view-lab.css`（若面板作者未占用）、`docs/*`、`CHANGELOG.md` |
| gear-data | `.mimocode/build/mk_lab_gear.py`、`.mimocode/data/lab_gear.json`、`data/lab_gear.json`、`pipeline/sync-data.py`、`qa/lib/data-schema.mjs`、`qa/tests/data-schema.test.mjs`、`.mimocode/build/lab_gear_README.md` |
| lab-score | `js/lab/score.js`、`js/lab/combos.js`、`js/lab/fit.js`、`qa/tests/lab-score.test.mjs` |
| lab-panels | `js/lab/traits.js`、`js/lab/trinkets.js`、`js/lab/weapons.js`、`js/lab/fragments.js`、`css/view-lab.css` |

规则：不跨域改文件；共享文件只由 Lead 改；改完各自跑 `node --test qa/tests/*.test.mjs` 相关用例；不 commit；由 Lead 统一跑门禁与提交。
