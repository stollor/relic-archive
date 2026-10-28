# 数据说明（`data/` 与 `assets/`）

本仓库是**自包含站点**：`data/` 与 `assets/icons/` 随仓库分发，`python serve.py` 即可运行。
本文件说明这些数据是什么、从哪来、怎么更新，以及已知限制。

---

## 1. 数据从哪来（离线解包 + 公开 wiki）

```
本机《遗迹2》游戏文件（UE5 IoStore，91 GB）
   │  retoc / repak 只读抽取（不启动游戏、不注入、不改存档）
   ├─→ extract/         原始 .uasset/.uexp（数 GB，不在本仓库）
   ├─→ data/locres/     官方本地化 en / zh-Hans / zh-Hant（官方中文来源）
   ├─→ extract_icons/   原始纹理 → assets/icons/*.png（1004 张，BC7/DXT5 解码）
   ▼
上游解析与配装工具链（.mimocode/tools、.mimocode/build，不在本仓库）
   ├─ tools/build_items.py → enrich_v14.py     → data/items.json（schema v1.4）
   ├─ build/armor_tool/optimize.py             → data/site_data.json
   ├─ build/mk_archetypes.py / mk_acq_json.py / mk_item_effects.py
   └─ build/80…97 配装链 → ui_data.json / loadouts.json / builds.json
   │
   │  pipeline/sync-data.py（快照同步）+ pipeline/mk_builds_json.py（合并）
   ▼
本仓库 data/  ← 运行时最小数据集（见 §2）
```

- 数值/文本优先取**游戏文件与官方 locres**；wiki（[remnant2.wiki.gg](https://remnant2.wiki.gg/)）只用于补充人工整理的效果文本与获取途径。
- 武器/护甲在游戏内本就没有「机制效果句」，只有数值与风味描述，因此不生成 `effectZh`（不是缺失）。

---

## 2. 仓库内数据清单

| 文件 | 大小 | 内容 | 谁读 |
|---|---:|---|---|
| `data/items.json` | 7.0 MB | 主数据集，schema v1.4，**1894 条**（其中 `is_item=true` 的 1126 件真道具） | `js/core/api.js`、`serve.py` |
| `data/builds.json` | 291 KB | **流派** 7 套：评分 / 伤害链条 / 槽位 / 循环 / 替换 / 清群 / 难点 / 饰品乘区 + 200 条道具 UI 摘要 + 护甲套装混搭 + 规则口径 + i18n 文本实体 | `api.js`（`#/builds`） |
| `data/site_data.json` | 730 KB | 实验室数据：护甲 121 件、饰品效果 141 条、6 场景、11 增益档、330 组预设、缺件替代 | `js/lab/*` |
| `data/archetypes.json` | 30 KB | 16 个职业（14 实装 + DLC4 未实装 2 个），官方译名 | `js/lab/*` |
| `data/terms.json` | 17 KB | 术语、伤害类型、槽位、获取难度、23 个游戏标签、7 类效果分类 | 全站文案 |
| `data/acq.json` | 52 KB | 获取途径文本 + 难度标签 + DLC；未收录留空，不编造 | 资料库详情 |
| `data/item_effects.json` | 151 KB | **官方效果句** 323 条（游戏内 tooltip 的机制原文，不是风味描述） | 资料库详情/列表/搜索 |
| `data/codex/index.json` | 77 KB | 知识库 13 篇（分类/结论/公式/表格/证据/来源） | `#/codex` |
| `data/icon_index.json` | 525 KB | 道具资产 → PNG 相对路径 | `api.js` |
| `assets/icons/*.png` | 58 MB / 1004 张 | 256px RGBA 图标 | 全站 |

`pipeline/_source/` 另存三份**配装源数据快照**（`ui_data.json` / `loadouts.json` / `builds.json`），
只被 `pipeline/mk_builds_json.py` 读取，不参与运行时。

---

## 3. 关键 schema

### `items.json`

```jsonc
{
  "meta": { "schema": "1.4.0", "generated_at": "...", "counts": { ... } },
  "items": [{
    "id": "Ring_BraidedThorns",          // 游戏资产 ID
    "pkg": ".../World_Base/...",         // 资产包路径
    "kind": "item", "is_item": true,     // 只有 is_item=true 才是可浏览道具
    "cat": "ring", "slot": "ring",
    "display": { "name_zh": "编织棘刺", "name_en": "Braided Thorns" },
    "text": { "description": { "zh": "...", "en": "..." }, "flavor": { ... } },
    "stats_flat": { "crit_chance": 10, ... },
    "numbers": { ... }, "base_stats": { "values": { ... } },
    "set": { "key": "...", "name_zh": "..." },   // 护甲套装（无套装效果，仅分组）
    "icon_asset": "T_UI_Ring_BraidedThorns_Icon",
    "filter_tags": ["Critical Chance"], "flags": { "confidence": "high" }
  }]
}
```

### `builds.json`（流派）

```jsonc
{
  "meta": { "counts": { "builds": 7, "items": 200, "rules": 8 } },
  "builds": [{
    "key": "crit_weakspot", "order": 1, "name_zh": "满暴弱点狙击",
    "tagline": "...", "role": "远程输出", "chain_zh": "...",    // 伤害链条
    "ratings": { "single": 5, "aoe": 1.5, "survival": 2, "difficulty": 5, "gear": 4 },
    "archetypes": [{ "name_en": "Hunter", "name_zh": "猎人", "role": "主", "why": "..." }],
    "armor": { "weight_class": "...", "total_armor": 62.5, "total_weight": 25.0 },
    "armor_parts": ["Armor_Head_Army", "..."],                  // 4 件
    "slots": { "long_gun": ["Weapon_SniperRifle"], "ring": ["Ring_...", "..."], "fragment": ["Weakspot Damage"] },
    "loop": ["..."], "alts": ["..."], "trash_plan": ["..."], "trash_fix": ["..."],
    "difficulty_notes": ["..."], "trinket": { "multiplier": 1.57, "lines": ["..."] },
    "loadout": { "weapons": { "long_gun": { "id": "...", "mod": "Mod_...", "mutator": "MetaGem_..." } } },
    "eval": { "composite": 2.55, "trinket_mult": 1.57, "trinket_share": 0.363 }
  }],
  "items": { "Weapon_SniperRifle": { "name_zh": "寡妇制造者", "effect_zh": "..." } },
  "i18n": { "Critical Situation": "轻量级时全部暴击几率 +35%" },   // 无本地 id 的纯文本实体
  "archetype_zh": { "Hunter": "猎人" },
  "armor": { "sets": [...], "mix_builds": [...], "set_bonus_answer": {...} },
  "rules": [...], "weight_thresholds": {...}, "trinket_principles": [...],
  "underrated": [...], "data_notes": [...], "eval_notes": [...]
}
```

流派视图解析规则：`api.buildEntity(ref)` 依次尝试 `items.json` 真实 id → `builds.items` 摘要 →
`builds.i18n` 文本实体 → 原样显示。**纯文本实体**（遗物碎片 / 棱镜传奇词条 / wiki-only 名称）没有本地 id，
显示为只读 chip（带中文效果提示），点不开详情。

---

## 4. 更新数据

```bash
# 1) 上游工具链产出新数据后，把快照同步进本仓库（开发机，.mimocode 工作区存在时）
python pipeline/sync-data.py --check      # 看有哪些变化
python pipeline/sync-data.py              # data/ 8 个运行时文件 + codex + 图标 + _source

# 2) 重新生成流派数据（改了配装源数据时）
python pipeline/mk_builds_json.py --check # 校验所有引用可解析
python pipeline/mk_builds_json.py         # 写 data/builds.json

# 3) 跑门禁再提交（见 README「验收」）
```

`pipeline/sync-data.py` 可反复运行（幂等）：文本 JSON 按换行归一后比较、统一 LF 落盘，二进制原样复制；
只有真正的内容差异才会复制。退出码：0 成功/已最新、1 `--check` 有漂移、2 工作区缺失/不完整、3 写盘失败（已回滚）；
`--check` 严格只读。单独 clone 本仓库时不需要它（详见 [`../pipeline/README.md`](../pipeline/README.md)）。

---

## 5. 部署（根路径 / 子路径都可用）

站点的数据与图标请求使用**相对路径**：`js/core/api.js` 的 `URLS` 是 `./data/*`，
图标由 `api.iconUrl()` 拼成 `./assets/icons/*.png`。页面都在站点根（`index.html`、`lab.html`），
hash 路由不改变文档 URL，因此：

- **本地 / 根路径部署**（`http://127.0.0.1:8777/`、`https://example.com/`）：开箱即用（`python serve.py`）。
- **子路径部署**（GitHub Pages 项目站点 `https://<user>.github.io/relic-archive/`）：同样开箱即用，
  无需改任何路径（`./data/...` 会解析到 `/relic-archive/data/...`）。
- 在线版本：**https://stollor.github.io/relic-archive/**（GitHub Pages，`main` 分支根目录）。
- 注意：`qa/` 里的门禁脚本用绝对 URL 访问本机 `serve.py`（开发用）；对线上子路径跑 QA 时
  只适合 `qa/shot.js`（它按 `--base` 拼接 URL），`qa/interactions.js` 的页面内 import 是根路径。

---

## 6. 已知限制（不编造、不补全）

| 项 | 现状 |
|---|---|
| 效果句覆盖 | 323/1126 件道具有官方效果句；其余走「数值 + 风味描述」兜底，详情会标注「效果数据待核实」 |
| 改装 / 消耗品效果句 | 覆盖偏低（游戏文本被拆成多段，单条匹配不到） |
| 人工 19 条 | 旧手写摘要，已在详情标注「人工整理，非游戏原文」 |
| 武器 / 护甲 | 游戏内本就没有机制效果句，按设计不生成 |
| 「饰品乘区 / 评分」 | 是模型估算（同一乘区加算、不同乘区相乘，条件类按覆盖率折算），不是游戏内精确公式；页面内均写明口径 |
| 护甲套装 | 本作**没有套装效果**（wiki 120/120 effect 为空、30 万资产路径无 ArmorSet/SetBonus 资产），套装只是外观分组 |
| 碎片 / 棱镜传奇词条 | wiki-only 数据，本地无 id，只能作为纯文本实体显示 |

---

## 7. 版权与免责

《遗迹2》（Remnant II）及其素材版权归 Gunfire Games / Gearbox Publishing 所有。
本仓库为**非官方**玩家资料整理，数据来自本机游戏文件的离线只读解包与公开 wiki 文本，
仅用于个人学习与查询，请勿商用。上游解包/配装工具链与原始游戏资产不包含在本仓库。
