# 遗迹 2 · 遗物档案 —— QA 验收报告（v3「流派 + 亮暗双主题」· 最新）

> **最新一轮（2026-10-28，v3）：三套门禁 + 主题对比度全绿 —— 见文末 [§9](#9-v3-轮流派--亮暗双主题2026-10-28)。**
> 本报告由 `qa/` 下门禁脚本自动产出数据、人工整理结论。
> 契约：`docs/UX_SPEC.md` §0 / §2 / §3 / §7 / §8 / §10 + **§11 v2 修订（优先）** + 本轮「效果原文优先」口径。

- **验收日期**：2026-10-27（效果原文优先轮快照 23:1x；各结果 JSON 内有 `generated_at`）
- **验收环境**：Windows + bash；Node **v26.2.0**；Chrome **156.0.8078.48**（headless / CDP，零依赖）；服务 `http://127.0.0.1:8777/`（既有 `serve.py`，QA 不重启、不改）
- **写入范围**：仅 `qa/**`（脚本、截图、结果 JSON、本报告）；未改任何产品文件
- **结论：三套门禁全绿，无阻断项。**

---

## 0. 一条命令跑完全部验收

```bash
# 在 .mimocode 目录下执行；三条全过 = 门禁绿，任一非 0 即为红
node qa/shot.js --all && node qa/interactions.js && python qa/audit.py
echo "EXIT=$?"   # 0 = PASS；非 0 = 有 FAIL
```

| 脚本 | 作用 | 退出码 |
|---|---|---|
| `node qa/shot.js --all` | 18 条路由 × 1440×1000 / 390×844 = 36 张截图；收集 console/异常/4xx | `0` 全 PASS；`1` 有错误；`2` 启动失败 |
| `node qa/interactions.js` | **59 项真实交互**（CDP 真实鼠标+键盘），按 §2 + §11.7 + 效果原文优先口径 | `0` 全 PASS；`1` 有 FAIL；`2` 启动失败 |
| `python qa/audit.py` | 静态审计：硬编码色值 / 裸英文 / 重复标题 / a11y / 禁用词 / 外链 | `0` 无 FAIL；`1` 有 FAIL；`2` 路径错误 |

---

## 1. 最终结论速览

| 门禁 | 最终结果 | 明细 |
|---|---|---|
| `shot.js` | **PASS 36 / 36**（exit 0；23:2x 用最终数据 323 条复跑，同为 36/36） | 18 路由 × 2 视口；**0 console error / 0 未捕获异常 / 0 个 4xx-5xx** |
| `interactions.js` | **PASS 59 / FAIL 0 / SKIP 0**（exit 0） | 资料库 22 + 实验室 18 + 知识库 4 + 全站 10 + 移动端 6；**0 console error** |
| `audit.py` | **PASS 0 FAIL / 0 WARN / 75 INFO**（exit 0） | 硬编码色值 0、裸英文 0、重复标题 0、a11y 0、禁用词 0、外链 0 |
| 实验室 · 引擎对拍（复跑） | **PASS** | `lab_presets_check` `11885/0`；`lab_enum_cmp` 交叉 `264/0` + **3/3 CLI `allOk:true`**；`lab_matrix_cmp` `diffs: []` |
| 旧路由兼容 | **PASS** | `#/lab/builds|matrix|calc` → `?panel=recommend|classes|calc` 自动重定向 |
| 移动端 390×844 | **PASS 6 / 6** | 无横向滚动、抽屉全屏、图 120px、筛选可用、点击目标 ≥32px、列表描述非空 |
| 阻断项 | **无** | — |

---

## 2. 本轮「效果原文优先」断言变更（I5 / I5b / I5c / I5d / L6 / D1）

| 编号 | 变更 | 断言内容 | 结果 |
|---|---|---|---|
| **I5（改写）** | 旧断言「详情含描述区块」已过期（效果类目不再渲染描述）→ 改为**按 cat 判定首块** | `Ring_PanMageSigil`（ring，有 `effectZh`）首块 =「效果」；`.detail-effect` 原文块含「状态效果」；首块**不含「据说」**；「背景」区块存在且保留风味段 | PASS |
| **I5b（新增）** | 无 `effectZh` 的效果类目 | `Amulet_AbrasiveWhetstone` 详情**无「描述」区块**，首块 =「效果」数值行；**不存在 `.detail-effect`** | PASS |
| **I5c（新增）** | 非效果类目回归保护 | `Weapon_BladeOfGul` 首块仍是「描述」（区块=描述/属性/获取途径/背景故事） | PASS |
| **I5d（新增）** | `effectZh` 并入 haystack | `api.item('Ring_PanMageSigil').effectZh` 非空；`haystack` 含「状态效果」；全库 29 条可被该词命中 | PASS |
| **I6（顺带修正）** | 旧 I6 依赖前序用例留下的详情 | 改为自包含：打开 `Ring_PanMageSigil` 后断言 `.eff-row` ≥1 且含中文+数值（例「伤害加成每状态效果 +5」） | PASS |
| **L6（新增）** | 列表行显示效果原文 | `#/items?view=list&q=阿哈内` → 「阿哈内水晶」行 `.lib-row__desc` 含「状态效果」、带 `lib-row__desc--effect` 类、**不含「据说」** | PASS |
| **D1（新增，数据门禁）** | 数据端点 | `GET /data/item_effects.json` → **HTTP 200，items=323（≥300）**；`/api/health.extra_data` **6 项且含 `item_effects`** | PASS |

> 编号接在既有用例之后：资料库新增 I5b/I5c/I5d/L6（I5 改写），全站新增 D1；总交互数 54 → **59**。

---

## 3. 逐项 PASS/FAIL（全量）

### 3.1 资料库（22 项，全 PASS）

| ID | 检查项 | 结果 | 证据 |
|---|---|---|---|
| I1 | 卡片列表渲染 | PASS | 首屏 60 张卡（共 1,126 件） |
| I2 | 桌面点卡片 → 居中弹窗 `#modal`、`#drawer` 隐藏、路由写 `#/items/<id>` | PASS | modal「物品详情」；hash `#/items/Amulet_AbrasiveWhetstone` |
| I3 | 弹窗宽 ≤1040 且居中 | PASS | 1040px，centerX=720 |
| I4 | 桌面详情大图 ≥240px | PASS | 240px |
| **I5** | **效果类目首块按新契约**（有 effectZh → 原文；无 → 数值行） | PASS | Ring_PanMageSigil：区块 效果/数值明细/获取途径/背景；原文「目标每承受一种不同的状态效果，对其造成的伤害额外增加 5%。」 |
| **I5b** | 无 effectZh 效果类目不渲染「描述」 | PASS | Amulet_AbrasiveWhetstone：区块 效果/获取途径/背景，`.detail-effect`=0 |
| **I5c** | 武器首块仍「描述」 | PASS | Weapon_BladeOfGul：区块 描述/属性/获取途径/背景故事 |
| **I5d** | effectZh 并入 haystack | PASS | 搜索关键词命中 Ring_PanMageSigil，29 条命中 |
| I6 | 详情「效果」行 ≥1，含中文+数值 | PASS | 「伤害加成每状态效果 +5」 |
| I7 | Esc 关闭 → hash 回列表 | PASS | `#/items` |
| I8 | 深链 `#/items/<id>` 直达弹窗 | PASS | 自动打开、标题非空 |
| I9 | 弹窗内拥有/收藏独立于配装 | PASS | owned 0→1；build 未变 |
| I10 | 装备写槽；同件不重复 | PASS | ring1；按钮「已装备」；二次仍 1 槽 |
| I11 | 加入特性：重复 info、第 11 warn | PASS | 保持 10 |
| I12 | 侧栏无「部位族」、效果标签 3 组中文 | PASS | 23 标签 / 23 tooltip |
| I13 | 标签 chip → 结果数变化 + 写 URL | PASS | 1,126→114；`?tag=Health` |
| I14 | 武器 damage 排序严格递减 | PASS | 250 > 200 > 150 > 130 > 125 > 120 > 120 > 115 > 115 > 105 |
| I15 | 列表视图每行有描述 | PASS | 60 行；2 件数据缺口（官方描述/摘要/效果均无） |
| I16 | `?owned=1`/`?fav=1` 真筛选、计数一致 | PASS | 2 件 / 2 件 |
| I17 | `/` 聚焦搜索 | PASS | `input[type=search]` |
| **L6** | **列表行显示效果原文** | PASS | 阿哈内水晶行「目标每承受一种不同的状态效果…」带 `--effect` 类，非风味段 |

### 3.2 实验室（18 项，全 PASS）

| ID | 检查项 | 结果 | 证据 |
|---|---|---|---|
| B1 | 15 槽含主/副职业 | PASS | 15 槽（archetype1/2） |
| B2 | 五面板 seg 齐全 | PASS | recommend/replace/classes/calc/saved |
| B3 | 空槽→选择器→点行装备 | PASS | 「孢子喷射」→ longGun |
| B4 | 选择器详情 ⓘ → 弹窗且不装备 | PASS | `#modal`；build 未变 |
| B5 | × 移除 → 槽清空、owned 不变 | PASS | Toast「已移除」 |
| B6 | 清空配装 → 确认框（取消不改） | PASS | saved 面板确认框 |
| B7 | 职业槽可选（≥14）→ 写入 | PASS | 16 条（14 可选 + 2 置灰） |
| B8 | 特性 stepper +1 → 徽章/合计变化 | PASS | 护甲值 180.8 → 189.8；已用 1/10 |
| B9 | 结果面板防御/生存/机动 + 有效生命 EHP | PASS | 生存组含「有效生命 EHP」 |
| B10 | 推荐 6 种排序，切换行序变化 | PASS | score→weight 后 #1 变化 |
| B11 | 切场景后推荐重算 | PASS | #1 数值变化 |
| B12–B15 | replace / classes / calc / saved 面板深链 | PASS | 四面板均可见且有内容（classes 含表格） |
| B16 | 旧路由重定向 | PASS | builds→recommend；matrix→classes；calc→calc |
| B17 | 缺件重算 → 推荐面板 10 行 + 摘要 + 写入四件跳过缺件 | PASS | 可用池/已排除/穷举摘要；跳过缺件、owned 不变 |
| B18 | 选择器标签多选 + 槽位动态排序 | PASS | 饰品 23 标签；护甲排序 armor/weight/name |

### 3.3 知识库（4 项）与全站（10 项）

| ID | 检查项 | 结果 |
|---|---|---|
| C1–C4 | 目录直达 / 深链单 h1 / 目录换文 / 公式块 | PASS |
| G1–G9 | Alt 切域 / title 同步 / 计数联动 / 刷新保持 / 0 console error / 离线 / 可访问名称 / img alt / 无重复标题 | PASS |
| **D1** | `/data/item_effects.json` 200 + items 323 + health.extra_data 含 item_effects | PASS |

### 3.4 移动端（6 项，全 PASS）

M1 无横向滚动 · M2 点卡片→全屏抽屉（宽=390，modal 隐藏）· M3 详情图 120px · M4 筛选可用 · M5 10 个点击目标 ≥32px · M6 列表行描述非空 —— 全部 PASS。

---

## 4. 证据索引

- 截图：`qa/shots/`（36 张路由截图 + 7 张交互证据，历史归档 `shots/history/`）。本轮详情截图（`item-detail-*.png`）已反映**效果原文优先**版式。
- 结果 JSON：`qa/results/interactions.json`（59 项 + console_errors/external_requests）、`qa/results/audit.json`、`qa/shots/_summary.json`。
- 数据门禁：D1 断言内联输出（HTTP 200 / items 323 / extra_data 6 项含 item_effects）。

---

## 5. 审计白名单变更

**无新增豁免。** 新类名（`.detail-effect`、`.lib-row__desc--effect` 等）仅为 class，不影响「硬编码色 / 裸英文 / 重复 h1」三条硬性检查；`audit.py` 本轮仍为 **0 FAIL / 0 WARN / 75 INFO**，未放宽任何规则。

---

## 6. 需要 Lead 注意的数据问题

| # | 问题 | 影响 | 建议 |
|---|---|---|---|
| 1 | ~~3 条 `effectZh` 是风味文本~~ **已修**：`Consumable_DransDream` / `HuntersDream` / `RootWalkerDream`（命中的就是道具自己的 `Description` key） | 已从数据中剔除，现回退数值行 | build 脚本已加「命中 key == 道具自身文本 key 则丢弃」守卫 |
| 2 | **效果原文覆盖缺口**：`metagem 0/68`、`mod 7/81`、`material 2/87`、`gem 0/2` 无 `effectZh`（另有 ring 181/225、amulet 85/104、consumable 25/57、relic 23/28；总计 323 件）。武器/护甲按设计不生成 | 这些效果类目详情走「数值行/效果数据待核实」，列表行显示数值摘要或「待核实」 | 数据侧后续补齐；当前界面已按契约降级，不阻塞 |
| 3 | 17 条 `match: fuzzy`（官方模板模糊匹配，已收紧：仅当原文与原句 ≥0.95 一致才按位置填值，否则只认同名数值键；Threshold/Scalar 归一化小数已 ×100 换算） | 句子本身来自官方模板，风险是「对错条目」 | 已输出 `build/effect_review.json`（17 条低置信度清单）供人工复核 |
| 4 | 列表描述数据缺口 2 件：`Amulet_BrazenAlloy` / `Amulet_DeathSoakedIdol` | 列表行显示「—」 | 数据缺口，非渲染缺陷 |

---

## 7. 审计规则与豁免（未变）

1. 硬编码色值：`tokens.css` / `components.css` / `base.css` / `components-picker.css` 设计系统层豁免；FAIL 仅扫 `view-*.css` 与 `js/views/**` → 0。
2. button a11y：静态只对单行构造判 FAIL，真实判定由 interactions G7 负责 → 全 PASS。
3. 禁用词：`core/labels.js`（英文→中文词典）整文件豁免。
4. 公式块：`pre.formula` 内符号公式不算裸英文。

---

## 8. 工具用法 / 未覆盖项

```bash
node qa/shot.js --help && node qa/interactions.js --help && python qa/audit.py --help
node qa/shot.js --all && node qa/interactions.js && python qa/audit.py
```

未覆盖：Firefox/Safari/真机；`.tip` 悬浮与 `prefers-reduced-motion`；Tab 全链路焦点顺序；内容语义与游戏真实性（仅验证数值与引擎一致）；Lighthouse/首屏量化。本报告为 2026-10-27 23:1x 快照，产品文件再改请重跑第 0 节命令。

---

## 9. v3 轮：流派 + 亮暗双主题（2026-10-28）
> 2026-10-28 11:5x：站点整体迁入自包含仓库 `relic-archive/` 后原位复跑同一套门禁，结果一致（shot 54/54 × 暗/亮、interactions 67/67、audit 0 FAIL、contrast 130/130）；本文档中路径已改为本仓库相对路径（`qa/`、`css/`、`js/`、`data/`）。


> 本轮新增第四个领域 **流派**（`#/builds`，7 套推荐配装从旧独立站 `build/site` 并入）与 **黑夜/白天双主题**；门禁脚本同步扩展。

### 9.1 最终结论（全绿）

| 门禁 | 结果 | 明细 |
|---|---|---|
| `node qa/shot.js --theme dark` | **PASS 54 / 54**（exit 0） | 27 路由 × 1440/390；含 `#/builds`、7 套详情、404；实际落地 `data-theme=dark / mode=auto`（跟随系统） |
| `node qa/shot.js --theme light` | **PASS 54 / 54**（exit 0） | 同上；实际落地 `data-theme=light / mode=auto` |
| `node qa/interactions.js` | **PASS 67 / FAIL 0 / SKIP 0**（exit 0） | 资料库 17 + 实验室 18 + **流派 7** + 知识库 4 + 全站 11 + 移动端 6；**0 console error** |
| `python qa/audit.py` | **0 FAIL / 0 WARN / 65 INFO**（exit 0） | 硬编码色值 0（tokens.css 之外，含 view-*.css / js）、裸英文 0、重复标题 0、a11y 0 |
| `node qa/theme-contrast.mjs` | **130 / 130 PASS**（exit 0） | 两套主题 token 组合 WCAG AA；正文最低 4.91（暗 t3×bg-3）、强调最低 4.60（亮 on-gold×btn-gold-1） |
| `/api/health` | OK | `extra_data` 7 项（含 `builds`），`png_count=1004`，`cli_ready=true` |

### 9.2 流派断言（interactions P1–P7，全 PASS）

| ID | 检查项 | 证据 |
|---|---|---|
| P1 | `#/builds` 列表：7 张卡片 + 6 张目标卡 + 7 行对比表 + 单 h1 | 7 套名：满暴弱点狙击 / 改装能量引擎 / 改装速切·星辰穿刺 / 状态效果持续伤害流 / 吸血·回复生存流 / 黑巨剑·蓄力爆发流 / 双召·伙伴齐射流 |
| P2 | 点卡片进详情：11+ 分区齐全、单 h1、面包屑可回 | 「满暴弱点狙击」14 个分区 / 50 个可点道具 |
| P3 | 7 套详情全部可开且内容非空（深链直达） | 3,662–4,317 字 / 50–71 个可点道具 |
| P4 | 点真实道具 → 全站统一详情弹窗（桌面）；Esc 可关 | modal「物品详情」 |
| P5 | 「装入实验室」→ 写 15 槽并跳 `#/lab` | 15 槽：longGun/handGun/melee/head/body/legs/gloves/amulet/ring1-4/relic/archetype1/archetype2 |
| P6 | 无效 key → 友好 404 + 返回列表 | `#/builds/__no_such_build__` |
| P7 | 页面内链接无坏链 | 39 条站内链接，0 坏链 |

### 9.3 主题断言（interactions G10，PASS）

- 三态循环 `auto → light → dark → auto`；每次落 `localStorage["r2.v2.ui"].theme`（唯一 r2 key），`data-theme` / `data-themeMode` / `style.colorScheme` / 按钮 title·data-mode 同步；
- `auto` 跟随系统（CDP `Emulation.setEmulatedMedia` 亮/暗热切即时生效）；刷新保持上次选择；`Alt+T` 生效且输入框内不触发；`<meta name="theme-color">` 随主题更新（从 tokens `--bg-0` 读取）。

### 9.4 截图与证据

- `qa/shots/<route>-<1440|390>[-dark|-light].png`：本轮最终 108 张（27 路由 × 2 视口 × 2 主题），人工抽查列表/详情/404/浮层均正常；历史 `history/` 已随目录整理清理，逐步截图不再堆积。
- `qa/shots/_summary-dark.json`、`_summary-light.json`：两次门禁的逐路由 console/异常/4xx 记录（全 0）。
- `qa/results/interactions.json`（67 项）、`results/audit.json`。

### 9.6 线上（GitHub Pages）验证（2026-10-28 发布后）

| 项 | 结果 |
|---|---|
| 部署形态 | `main / (root)`、legacy 构建 + 根目录 `.nojekyll`（文件原样下发） |
| 地址 | https://stollor.github.io/relic-archive/ |
| 资源探活 | `/`、`/data/builds.json`、`/data/items.json`、`/js/theme-boot.js`、`/css/tokens.css`、`/assets/icons/*.png`、`/lab.html` 全 **200** |
| 真实浏览器门禁 | `node qa/shot.js --base https://stollor.github.io/relic-archive`：**dark 桌面 25/25 PASS**、**light 移动 15/15 PASS**；0 console error / 0 异常 / 0 个 4xx |
| 结论 | 子路径部署 + 相对路径方案有效；线上与本地表现一致 |

> 注意：`qa/interactions.js` 的页面内 import 是根路径，只适合本地根路径；线上只跑 `qa/shot.js --base`。

### 9.5 已知非阻断

1. 流派详情里 29 个「纯文本实体」（遗物碎片 / 棱镜传奇词条 / wiki-only 名称）无本地 id，显示为只读 chip（带中文效果 tip），不可点开详情 —— 数据本身如此，符合「不编造 id」。
2. `builds.json` 的 `armor.weight_class` 源数据有重复词（如「轻 轻量」），视图侧已归一化显示，未改数据。
3. 「装入实验室」按设计整套覆盖现有 15 槽（附带 toast），仅跳过改装/变异器/天赋/碎片等非工作台槽位；未加二次确认框。
