# 遗迹 2 · 遗物档案 —— QA 验收报告（v3「流派 + 亮暗双主题」· 最新）

> **最新一轮（2026-10-28，第三阶段自动化验收流水线）：`node qa/gate.mjs full` → 16 PASS / 0 FAIL / 0 SKIP（706.5s），见文末 [§12](#12-第三阶段自动化验收与-ai-开发流水线2026-10-28)。**
> 本报告由 `qa/` 下门禁脚本自动产出数据、人工整理结论；日常验收请直接用 `verify.ps1`（见 §0）。
> 契约：`docs/UX_SPEC.md` §0 / §2 / §3 / §7 / §8 / §10 + **§11 v2 修订（优先）** + 本轮「效果原文优先」口径。

- **验收日期**：2026-10-27（效果原文优先轮快照 23:1x；各结果 JSON 内有 `generated_at`）
- **验收环境**：Windows + bash；Node **v26.2.0**；Chrome **156.0.8078.48**（headless / CDP，零依赖）；服务 `http://127.0.0.1:8777/`（既有 `serve.py`，QA 不重启、不改）
- **写入范围**：仅 `qa/**`（脚本、截图、结果 JSON、本报告）；未改任何产品文件
- **结论：三套门禁全绿，无阻断项。**

---

## 0. 一条命令跑完全部验收（第三阶段起）

```powershell
.\verify.ps1 quick      # 快速自检：单元 + 静态审计 + 对比度 + 数据契约（无浏览器，<10s）
.\verify.ps1 related    # 按 git 改动文件挑相关回归
.\verify.ps1 full       # 完整回归：真实 Chrome 截图/交互/竞态/子路径
.\verify.ps1 data       # 数据链路：Schema/引用/同步/数据脚本单测
.\verify.ps1 deploy     # 发布前：full + deploy.py 预检（不推送）
```

`verify.ps1` 只是 `node qa/gate.mjs` 的 PowerShell 包装，任意 shell 可用后者。门禁会自动起本地服务器
（`serve.py --port 0`，随机端口）、探测 Node/Python/Chrome/上游工作区，按环境跳过并说明原因，
输出中文摘要 + 机器可读 `qa/results/gate.json` + 逐检查日志 `qa/results/logs/<id>.log`；
失败时给出模块、失败用例、日志尾部与复跑命令。设计、检查清单与扩展方式见 [`qa/README.md`](qa/README.md)。

| 模式 | 覆盖 | 何时用 |
|---|---|---|
| `quick` | unit-js、audit、contrast、data-builds、data-schema | 每次改完代码先跑 |
| `related` | quick + 按改动模块映射的检查（可能含浏览器） | 提交前小步验收 |
| `full` | 全部检查（含 Chrome 截图/交互/lifecycle/lab-async/导航/子路径） | 提交前、发布前 |
| `data` | data-schema、data-builds、data-sync、unit-py | 只改数据/生成链 |
| `deploy` | full + deploy-preflight | 发布前最后一道 |

> 历史基线不再手抄在文档里：`qa/baselines.json` 是唯一基线，门禁会拦住「用例被静默删除/跳过」；
> 本文 §1–§11 保留历次快照（其中 36/36、54/54、59 项等是当时的数字），当前数字以门禁输出为准。

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

---

## 10. 第一阶段可靠性治理回归（2026-10-28）

> 本轮目标：确定性 Bug / 竞态 / 状态可靠性 / 数据更新隐患。**不新增功能、不改数据与 UI 语义**。
> 详细经验见 [`docs/LESSONS.md`](../docs/LESSONS.md) §2.7 #24–#28；变更见 [`CHANGELOG.md`](../CHANGELOG.md) v3.2。

| 门禁 | 结果 |
|---|---|
| `node qa/shot.js --theme dark` | **54/54 PASS**（27 路由 × 1440/390；0 console error / 0 异常 / 0 4xx） |
| `node qa/shot.js --theme light` | **54/54 PASS** |
| `node qa/interactions.js` | **67/67 PASS**（0 console error） |
| `python qa/audit.py` | **0 FAIL / 0 WARN / 65 INFO**（exit 0） |
| `node qa/theme-contrast.mjs` | **130/130 PASS** |
| `python pipeline/mk_builds_json.py --check` | exit 0（引用完整性；历史 23 条 id 落空为既有 INFO） |
| `python pipeline/sync-data.py --check` | **exit 0**，录得「仅换行差异 5 个（按内容相同处理，不写盘）」，零写盘 |
| `node --test "qa/tests/*.test.mjs"` | **29/29 PASS**（core/task 6 + core/store 23） |
| `node qa/tests/lifecycle.browser.mjs` | **25/25 PASS**（快速 A→B→C / 延迟模块与数据 / 前进后退 / 深链 / 损坏 localStorage / storage-error toast） |
| `node qa/tests/lab-async.browser.mjs` | **8/8 PASS**（运行中连续改条件取最后条件 / 离开页面零过期写入 / 耗时无退化） |
| `python -m unittest discover -s qa/tests -p "test_*.py"` | **23 tests OK**（图标崩溃回归 / 幂等 / 只读 check / 换行归一 / 回滚 / 退出码） |

### 10.1 本轮确认并修复的问题（证据 → 修复）

| 编号 | 现象 / 根因 | 修复 |
|---|---|---|
| P0-1a | `pipeline/sync-data.py` 图标分支 `rows.append()` 传 3 参 → 新增/更新图标必抛 TypeError，且此前已复制部分文件（未说明的部分更新）；`--check` 同崩 | rows 改 tuple；两阶段计划/校验 → 原子落盘 + 失败回滚；退出码 0/1/2/3 |
| P0-1b | `--check` 长期假红：5 文件字节差异实为 CRLF/LF（工作区 CRLF × 仓库 `eol=lf`） | 文本 JSON 换行归一后比较、统一 LF 落盘；实测 `--check` 归零 |
| P0-2 | 推荐穷举运行中改条件被 `state.running` 丢弃 → 结果对应旧条件；完成回调无版本检查可覆盖新条件；离开页面 rAF 继续写已卸载 DOM | `core/task.js` 的 `createTaskRunner` + `createEpoch`：条件一变重启、过期回调不落地、destroy 取消分帧 |
| P0-3 | async `dispatch` 无代际 → 快速 A→B→C 旧页面后挂载/双实例；视图 `load().then` 卸载后仍写 DOM；codex 重复订阅 router；错误重试把已卸载视图当活的 | `main.js` 派发代际 + await/mount 双校验 + 干净错误态；四视图实例代号/幂等 unmount；删除 codex 冗余订阅 |
| P0-4 | 损坏 localStorage 使 `new Set(非数组)` 在模块初始化崩溃 → 整站白屏；build/saved/ui 脏数据不校验；迁移只判「键存在」；写失败静默 | 读取端白名单归一（合法数据保留）+ 迁移仅在「新键缺失/不可用」时 + `storage-error` 事件 → 顶栏 toast |

### 10.2 历史基线勘误

1. 本文件 §1–§9 是 v2.1/v3 历史快照，其中「36/36」「59 项交互」已过时；当前为 **54 项/单主题、67 项交互**。
2. 本轮开始时 `sync-data.py --check` 为 exit 1（5 文件 CRLF/LF 字节差异，内容一致），属长期假红，已修（见 P0-1b）。
3. `qa/results/*.json` 为门禁运行产物；本轮不提交其时间戳变化，保持仓库 diff 干净。

---

## 11. 第二阶段架构收口回归（2026-10-28）

本轮不改功能、不改视觉，只收敛职责与扩展入口。验收口径：**同一份源码在重构前后跑同一门禁，数字不退化**；
模块边界另由新增的架构守卫测试自动校验（不再只靠文档约定）。

### 11.1 门禁结果

| 命令 | 结果 |
|---|---|
| `node qa/shot.js --theme dark` | **54/54 PASS**（27 路由 × 1440/390） |
| `node qa/shot.js --theme light` | **54/54 PASS** |
| `node qa/interactions.js` | **67/67 PASS**（0 console error） |
| `python qa/audit.py` | **0 FAIL / 0 WARN / 60 INFO**（INFO 由 65 降到 60：手写空态/面板标记收口后少了提示项） |
| `node qa/theme-contrast.mjs` | **130/130 PASS** |
| `node --test "qa/tests/*.test.mjs"` | **69/69 PASS**（架构守卫 16 + 资料库纯函数 21 + core/task 9 + core/store 23） |
| `python -m unittest discover -s qa/tests -p "test_*.py"` | **23 tests OK** |
| `node qa/tests/lifecycle.browser.mjs` | **25/25 PASS** |
| `node qa/tests/lab-async.browser.mjs` | **8/8 PASS** |
| `python pipeline/mk_builds_json.py --check` | exit 0（引用完整性；历史 23 条落空 id 为既有 INFO） |
| `python pipeline/sync-data.py --check` | exit 0（仅换行差异 5，零写盘） |

### 11.2 架构守卫（新增，可执行的分层约定）

`qa/tests/architecture.test.mjs` 解析真实 import 图后断言 16 条。**重构前 8/16 红**，红了的部分正是本轮的整改点：

| 守卫 | 重构前 | 重构后 |
|---|---|---|
| core 不得依赖上层（components/views/lab/builds/library/应用层） | ✅ | ✅ |
| components 不得依赖 views/lab/builds/library | ✅ | ✅ |
| lab 不得依赖 views | ✅ | ✅ |
| 领域模块不得依赖 views、library 与 builds 不互相依赖 | ✅ | ✅ |
| 每个文件都在已知层内 | ✅ | ✅ |
| 无循环依赖 | ✅ | ✅ |
| 相对 import 均指向真实文件 | ✅ | ✅ |
| 只有 `js/main.js` 订阅 `router.onChange` | ✅ | ✅ |
| 只有 `js/core/router.js` 写 `location.hash`/`history` | ❌（item-detail、ui.js） | ✅ |
| 详情组件不拥有 URL（无 `router.*`/`location.hash`/`route`） | ❌ | ✅ |
| 领域清单只在 `js/domains.js`（应用壳无 VIEW_FILES/DOMAIN_ZH/DOMAIN_ORDER，router 无 DOMAINS） | ❌ | ✅ |
| `index.html` 不硬编码导航项与视图样式 | ❌ | ✅ |
| 空/错/载入状态只有 `components/states.js` | ❌（8 处手写） | ✅ |
| 面板骨架只有 `components/panel.js` | ❌（3 份） | ✅ |
| 道具展示文本规则只有 `core/labels.js` | ❌（`EFFECT_CATS`×3、`zhDisplay`×2、`plainText`） | ✅ |
| 纯计算模块不触 DOM/storage/网络 | ❌ | ✅ |

### 11.3 重构前后规模与改动成本

| 指标 | 重构前 | 重构后 |
|---|---|---|
| JS 文件数 / 行数 | 31 / 10,675 | 42 / 11,099（拆分出可单测模块，视图普遍变薄） |
| `views/library.js` | 1,436 | 1,077（+ `library/query.js` 321 / `present.js` 147 / `export.js` 76） |
| `views/builds.js` | 908 | 172（+ `builds/ui.js` 186 / `list.js` 172 / `detail.js` 429） |
| `components/item-detail.js` | 605 | 219（+ `item-detail-sections.js` 391） |
| `lab/workbench.js` | 651 | 101（+ `wb-slots.js` 237 / `wb-settings.js` 145 / `wb-result.js` 238） |
| 新增一个领域 | 改 4 个文件（router/main×3/index.html）+ 新视图与 CSS | `js/domains.js` 加一项 + 新视图与 CSS（其余自动） |
| 新增一个实验室面板 | 改 5 处（PANELS/ensurePanel/两处参数白名单/applyPanelQuery） | 新建面板模块（约 10 行）+ 注册 6 行 |
| 新增一种筛选/排序 | 视图内私有逻辑，无法单测 | `library/query.js` 加字段/排序项 + 纯函数用例 |
| 改详情某个区块 | 在 605 行文件里定位 | `item-detail-sections.js` 里对应 `xxxSection()` |

### 11.4 等价性证据（重构不改行为）

- 资料库：旧/新代码冻结快照 + 同一 CDP 探针，8 条路由 × 390/1440 逐叶子 DOM diff——12/16 完全一致，
  4 组差异仅为 `empty__hint` 由 `<div>` 改 `<p>`（统一到 `states.js` 的预期变化，class/文案/像素不变）。
- 流派：14/14 场景（列表 / 7 套详情 / 404 / modal×4 / drawer）结构完全一致；除面板标题包 `span` 与空 `.panel__tools` 外 diff=0。
- 实验室：33 个场景（5 面板深链 / 依次点击 / 8 组 URL 参数 / 3 个旧路由重定向 / 15 槽 / 3 结果分组 / 设置变更 / 面板切换）
  逐叶子 diff=0（含 `location.hash`、panel 顺序与 hidden、seg 选中态、表单值）。
- 详情 URL 归属：`#/items?cat=ring&view=list` 打开详情 → `#/items/<id>` → Esc → 原筛选 URL 原样恢复；
  `#/builds/<key>` 打开详情前后 hash 全程不变（两个领域互不污染）。

### 11.5 已知残留（下阶段可选）

1. 领域样例仍出现在 QA 夹具（`qa/shot.js` 路由表、`qa/interactions.js` G1/G2、`lifecycle.browser.mjs` 的 DOM 选择器）；
   新增领域时需手动补夹具（属测试数据，不进产品代码）。
2. 视图 CSS 改为按领域懒注入后，领域模块若误借他域 `view-*.css` 专属类会掉样式（本轮扫描无跨域依赖；
   如需强约束可在架构守卫里加类名白名单）。
3. `core/api.js` 里 `terms()/stats()/buildData()` 零调用；`core/theme.js` 的 `store.on('ui')` 常驻不退订（壳级，可接受）。
4. 实验室 `engine.js` 内部的 `round1/round4` 未并入 `fmt.round`（数据层口径冻结，避免动对拍基线）。

---

## 12. 第三阶段：自动化验收与 AI 开发流水线（2026-10-28）

> 目标：把已有零散测试能力组织成**统一、快速、可靠、可诊断**的自检体系；不新增业务功能、不引入依赖与构建步骤。
> 设计说明见 [`qa/README.md`](README.md)；AI 验收规则见 [`AGENTS.md`](../AGENTS.md) §1.1。

### 12.1 统一入口

`qa/gate.mjs`（PowerShell 包装 `verify.ps1`）是唯一入口；门禁自动起 `serve.py --port 0`（随机端口，含子路径）、
探测 Node/Python/Chrome/上游工作区、按环境 SKIP 并说明原因，输出 `qa/results/gate.json` + `qa/results/logs/<id>.log`。

| 模式 | 内容 | 实测耗时 | 用途 |
|---|---|---|---|
| `quick` | unit-js、audit、contrast、data-builds、data-schema | **5.9s** | 改完即跑（无浏览器） |
| `data` | data-schema、data-builds、data-sync、unit-py | **19.9s** | 只改数据/生成链 |
| `related` | quick 基线 + 按改动文件映射的相关检查 | 视改动（无浏览器改动≈6s；含浏览器≈30–200s） | 提交前小步验收 |
| `full` | 16 项全量（真实 Chrome：截图/交互/竞态/子路径） | **706.5s** | 提交前 / 发布前 |
| `deploy` | full + `deploy.py --dry-run` 预检 | full + ≈1s | 发布前最后一道 |

退出码：`0` 通过 / `1` 有失败 / `2` 用法错误 / `3` 关键检查因环境不具备被跳过（不允许静默跳过）。

### 12.2 全量门禁结果（`node qa/gate.mjs full`，2026-10-28）

| # | 检查 | 结果 | 耗时 | 判定口径 |
|---|---|---|---|---|
| 1 | `unit-js` | **175/175** | 2.7s | 纯函数单测 + 架构守卫 + 数据契约 + 门禁自检 |
| 2 | `unit-py` | **37/37** | 2.0s | sync-data 语义/异常/幂等（30）+ serve 子路径（7） |
| 3 | `audit` | **0 FAIL / 0 WARN / 60 INFO** | 0.2s | 硬编码色/裸英文/重复标题/a11y/外链 |
| 4 | `contrast` | **130/130** | 0.1s | 双主题 WCAG AA |
| 5 | `data-builds` | **1/1** | 0.2s | 流派引用完整性 |
| 6 | `data-schema` | **38/38** | 2.5s | 9 个 JSON 的结构/引用/版本契约 |
| 7 | `data-sync` | **1/1（无漂移）** | 1.3s | 仓库快照 vs 上游工作区（独立 clone 下 SKIP） |
| 8 | `shot-dark` | **54/54** | 109.5s | 27 路由 × 2 视口 + console/异常/4xx |
| 9 | `shot-light` | **54/54** | 93.9s | 同上（亮色） |
| 10 | `shot-subpath` | **25/25** | 54.2s | `/relic-archive/` 前缀下资源加载（桌面） |
| 11 | `interactions` | **67/67** | 179.2s | 真实鼠标/键盘交互 |
| 12 | `lifecycle` | **25/25** | 133.4s | dispatch 代际/卸载/损坏 localStorage |
| 13 | `lab-async` | **8/8** | 38.7s | 分帧计算版本控制/取消/失败恢复 |
| 14 | `components` | **20/20** | 2.2s | states/panel 行为契约（真实 DOM） |
| 15 | `nav` | **6/7（N7 设计性 SKIP）** | 30.8s | 路由快切/深链/回退/卸载清理 |
| 16 | `nav-subpath` | **7/7** | 55.3s | 同上 + 子路径资源归属 |

**汇总：16 PASS / 0 FAIL / 0 SKIP（环境阻断 0），706.5s。** 基线写入 `qa/baselines.json`（唯一基线来源）。

### 12.3 新增工程回归测试（P1-2）

| 场景（P1-2 清单） | 测试 | 用例数 | 类型 |
|---|---|---|---|
| ① 快速路由切换/异步竞态 | `navigation.browser.mjs` N1/N2 + 既有 `lifecycle` G1/G5 | 2 + 既有 | 浏览器 |
| ② 卸载后事件与任务清理 | `navigation.browser.mjs` N6 + 既有 `lifecycle` G6/G8 | 1 + 既有 | 浏览器 |
| ③ localStorage 损坏 / 旧档迁移 | 既有 `store.test.mjs` 23 + `build-state.test.mjs`「任一 key 损坏不影响其他」 | 23 + 7 | 纯函数 |
| ④ URL 查询解析/序列化/回退 | `router.test.mjs`（parse/setQuery/replaceSilently/回退）+ 既有 `library-query` | 10 | 纯函数 |
| ⑤ 共享组件行为契约 | `components.browser.mjs`（states/panel 结构/文本转义/确定性/重试） | 20 | 浏览器 |
| ⑥ 配装状态与拥有/收藏隔离 | `build-state.test.mjs`（跨 key 事件与持久化字节隔离） | 7 | 纯函数 |
| ⑦ 数据缺失/错误类型/重复 ID/失效引用 | `data-schema.test.mjs`（真实数据 errors=0 + 内存负向夹具） | 38 | 纯函数 |
| ⑧ GitHub Pages 子路径兼容 | `shot-subpath` + `nav-subpath` + `serve_prefix`（7） | 25 + 7 + 7 | 浏览器/Python |
| ⑨ 实验室计算确定性与过期结果保护 | `lab-engine.test.mjs`（16）+ 既有 `lab-async`（8） | 16 + 8 | 纯函数/浏览器 |
| ⑩ 数据同步异常处理与幂等 | `test_sync_data.py` 新增 7（缺失源/损坏 JSON/无工作区/连续 --check/重复同步） | 30（含原 23） | Python |

另：`env.test.mjs`（20）覆盖环境探测与子路径工具；`gate.test.mjs`（15）覆盖门禁自身（解析器/跳过判定/改动映射/
registry-plan-文档一致性），防止「门禁静默失效」。

### 12.4 数据 Schema 与契约（P1-3）

- 新增 `qa/lib/schema.mjs`（通用校验器：纯数据规则、RFC6901 JSON Pointer、`required` 必须带 why、
  `nullable`/`enum`/`uniqueBy`/`additionalProperties`）与 `qa/lib/data-schema.mjs`（9 个运行时文件的契约 +
  跨文件引用 + 版本策略 + 模块级缓存）。
- 契约覆盖：items（唯一 id/枚举/counts 对账/套装引用）、builds（槽位引用解析：items id ∪ i18n ∪ `_source`）、
  site_data（公式常数/preset 唯一/引用）、archetypes、codex（分类/block 类型与视图同步）、terms、
  item_effects（key ⊆ items）、icon_index（count 对账）、acq（标签/引用）。
- **真实数据 errors=0**；3 类已知缺口只报 warning（不改数据）：items 23 条 `icon_asset` 不在 icon_index、
  builds 6 条 `inherent_mod` 为英文显示名、icon_index 4 条 failures。
- `pipeline/sync-data.py` 增加最小 JSON 语法校验：源 JSON 损坏 → stderr 输出 `路径:行:列`、退出码 2、**零写入**
  （`--check` 同样生效），避免把损坏数据静默搬进发布快照。

### 12.5 环境自适应与发布门禁（P1-4）

- **Chrome 探测**：`qa/lib/cdp.js` 新增 `resolveChrome()`（`CHROME_PATH`/`CHROME_BIN` → 平台候选（含 Edge/Chromium）→
  `where`/`which`；失败抛 `ChromeNotFoundError` 含搜索清单与修复建议），`shot.js` 删除硬编码路径；
  `shot.js --chrome <path>` 可覆盖。
- **路由表唯一来源**：`qa/lib/routes.mjs`（27 条由真实数据推导）被 `shot.js` 与 gate 共用；gate 用推导条数
  校验截图总数（`54 = 27×2`），路由被静默丢弃会 FAIL。
- **子路径真机等价**：`serve.py` 新增 `--prefix /relic-archive`（`/` 302 到前缀首页；缺前缀资源 404 —— 本地即暴露
  根绝对路径 bug；健康检查带 `prefix` 字段）。`qa/interactions.js` 20 处页面内根路径改为 `prefixOf(base)` 拼接：
  **根路径 67/67、子路径 67/67（全部真跑，无排除）**。
- **独立 clone / CI**：`data-sync` 缺上游工作区时明确 SKIP（可选，不阻断），其他检查照常运行；`gate quick` 无浏览器依赖。
- **CI**：新增 `.github/workflows/qa.yml`（push/PR：`quick` → `data` → `full`），**只测试，不改变 Pages 静态部署**
  （legacy 构建仍是 push 自动重建）；失败也上传 `gate.json` + 日志为 artifact。
- **文档基线漂移**：删除文档中手抄的用例数字（`qa/REPORT.md` §0、`AGENTS.md` §1 改为「以门禁输出与
  `qa/baselines.json` 为准」），基线由 `--update-baseline` 维护；门禁会拦截用例被删除/跳过。

### 12.6 结构化报告与故障定位（P1-5）

`qa/results/gate.json` 每次运行落盘，字段：`mode/env/plan/checks[]/summary`；每个 check 含
`status/total/pass/fail/skip/duration_ms/module/error/failed[]/log/artifacts/hint/repro`。
控制台摘要同时给出：实际执行环境（Node/Python/Chrome 来源/git sha/工作区）、逐项 PASS/FAIL/SKIP 与耗时、
失败定位（模块 → 失败用例 → 日志尾部 12 行 → 证据文件 → 排查入口 → 复跑命令）。
单检查日志：`qa/results/logs/<id>.log`（含完整命令与 stdout/stderr）。

**定位实例（本轮真实发生）**：`lab-async` 在 gate 随机端口下报 `视图就绪超时：#/lab`，按日志与脚本头定位到
「只认 `LAB_QA_BASE`/8777、不读 `--base`」；修复后 8/8。若无模块/日志/复跑信息，这类问题会表现为 8 条无头绪红。

### 12.7 仍未覆盖的高风险行为

1. `lifecycle.browser.mjs` / `lab-async.browser.mjs` 页面内仍有根绝对路径 import（gate 只在根路径调度它们；
   子路径路径由 `nav-subpath`/`shot-subpath` 覆盖，但这两个脚本尚不能对子路径跑）。
2. GitHub Actions 工作流已写好并用**本地等价命令**验证（`quick`/`data`/`full` 同一脚本），但**尚未在 GitHub 上真实执行**
   （需推送后触发）；Linux 下 Chrome 版本/字体差异可能影响截图外观（门禁只判错误，不做像素比对）。
3. 真实线上发布未在本阶段重跑（`deploy.py` 未改；上一阶段已验证）。
4. 缺 Chrome 的端到端路径未实测（本机有 Chrome；`ChromeNotFoundError` 仅纯逻辑单测），退出码 3 的语义未真机验证。
5. 数据契约只校验**仓库快照**；上游工作区语义错误需同步后再由 `gate data` 暴露。
6. 交互用例仍是 67 项抽样，不覆盖每个面板/每种排序组合；截图门禁只判结构/错误，不做视觉回归（pixel diff）。
7. 实验室引擎对「负总减伤」不做 0 下限 clamp（真实数据安全，口径已写入测试头注释；未来出现更强负词条会红提示复核）。
8. `qa/baselines.json` 与当前用例清单绑定：有意增减用例必须 `--update-baseline`，否则门禁会拦（这是设计意图）。
