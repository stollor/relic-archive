# 实验室 v3：装配台（6 分类页）— 实现契约

> 状态：2026-10-30 实现（站点 v3.9）。**事实源：代码 > 本文 > 其它 docs。**
> 本文只描述 v3 新增/变更的契约；面板注册表、状态、数据契约仍以 `docs/LAB_V2.md` 与 `docs/ARCHITECTURE.md` 为准。

## 0. 目标

v2 的「配装槽位」是 15 槽网格（武器 3 + 护甲 4 + 饰品 6 + 职业 2），信息密度高、每件装备的属性只能挤在一行。
v3 把它拆成 **6 个分类页（Table）**，每个分类只放本类槽位与完整属性；下方固定「本套效果 + 本类推荐」，随槽位与分类切换实时更新：

| 分类 id | 名称 | 槽位 | 推荐来源 |
|---|---|---|---|
| `armor` | 护甲四件 | head / body / legs / gloves | 引擎穷举前 3 套（场景分），可一键写入四件 |
| `weapons` | 武器与改装 | longGun / handGun / melee + 变异器 / 改装 | `fit.recommendMutators/recommendMods` |
| `archetype` | 职业与技能 | archetype1 / archetype2 + 就业技能 3 选 1 | 防御贡献分 Top4（透明口径） |
| `trinkets` | 饰品 | amulet / ring1–4 | `combos.recommendRemaining/recommendSwap/recommendTrinkets` |
| `traits` | 特性 | 43 条特性，0–10 级，上限 10 个 | `fit.recommendTraits` |
| `relic` | 圣物与碎片 | relic + 3 碎片槽 | `fit.recommendFragments` |

「一键配齐」（`js/lab/wb-oneclick.js`）按当前流派 / 场景填：四件护甲（引擎 Top1）、饰品组合 Top1、特性推荐 10 个满级、碎片推荐 3 槽、已选武器的变异器 / 改装；职业与圣物不自动选，toast 明示「未建模」。

## 1. 布局与模块

```
workbench.js
└─ .lab-wb
   ├─ 装配台 panel（flush） ── wb-assembly.js
   │  ├─ .lab-asm__bar：6 个分类 tab + 工具栏（流派 / 场景 / 档位 / 缺件 / 按流派配齐）
   │  └─ .lab-asm__host：当前分类页（wb-cat-<id>.js）
   ├─ .lab-wb__bottom（2 列）
   │  ├─ 本套效果 panel（wb-result.js 原样搬入：防御 / 生存 / 机动 + 构成明细 + 输出）
   │  └─ 本类推荐 panel（分类模块的 renderRec(host)）
   └─ 配装设置 panel（wb-settings.js：只剩消耗品 / 预设种子；场景 / 档位 / 流派已上移工具栏）
```

`js/lab/wb-parts.js` 是分类页共用的渲染小件（`CATS` 分类表、`catShell/catBar/crow/slotCell/itemCell/statCell/effectCell/actsCell/emptyCrow/catSection/noteLine/recCard/recList/tag/fragColorBadge/iconAct/stepper/emptyTab`；v5 起新增 `slotCard/slotStrip/digest/digestRow/linkHover`，见 §8）。
样式全部在 `css/view-lab.css` 的「装配台 v3」段（v5 的槽位卡与效果汇总在同文件末尾「装配台 v5」段）；分类模块不写 CSS、不写颜色。

### 1.1 分类模块契约

```js
createXxxTab(ctx) -> { el, refresh(), renderRec?(host), destroy?() }
```

- `el`：分类页根节点（内部用 `.lab-cat` 骨架）。
- `refresh()`：状态变化时重建内容；模块内部筛选等局部状态保留在闭包里。
- `renderRec(host)`：把本类推荐渲染到右侧推荐面板；同步/异步均可，异步先渲染「计算中」占位。
- `destroy()`：取消订阅 / 定时器（可选）。

`TabCtx`（由 `wb-assembly.js` 注入）：
`model / E / S / store / ui / h / clear / fmt / icon / nameOf / iconOf / openDetail / pickForSlot / removeSlot / isMissing / toggleMissing / refresh / goCategory / openPanel / slotLabel`。

## 2. 新增状态

- `store.build.meta.skills = { archetype1: skillId, archetype2: skillId }`：职业技能选择（3 选 1，可空）。
  **不参与防御合计**，仅作配装记录；未知 / 非本职业技能 id 读取时忽略。
- 分类页当前 tab 写 URL `?tab=<id>`（默认 `armor` 省略），用 `router.replaceSilently` 同步，不触发路由重派发。

不新增 localStorage key；缺件仍走 `store.ui['lab.missing']`。

## 3. 数据口径

- 护甲数值：`site_data.pieces` → 引擎 `pieceById`（护甲值 / 负重 / 五类抗性 / 套装 / 获取难度）。
- 武器：`items.json` 的 `damage/rate/crit/ammoPerClip/maxAmmo/weakspot/spread/impact` 与 `effect.summary_zh`；改装 / 变异器候选来自 `lab_gear.json`。
- 技能：`js/lab/skills.js#deriveSkills(model)` 从 `items.json` 的 `cat=skill` 行按「职业目录 → 技能目录」推导，过滤 `_Action/_Aura/_Buff/...` 子对象与英文兜底名；每个已实装职业 3 条。**推导数据，非官方图鉴文本**，UI 标注「效果原文待验证」。
- 职业防御专长：`archetypes.json` → `site_data.modifiers.perks` 交集（非每职业全量），推荐用「防御贡献分」加权（右栏脚注写明口径，不冒充游戏数值）。
- 维度分 / 契合 / 推荐分：仍按 `docs/LAB_V2.md §1.2/1.3`，页面必须标注「近似比较值，不是游戏内精确数值」。

## 4. 与旧面板的关系

v2 的九面板保持不动（推荐方案 / 饰品组合 / 武器改装 / 特性 / 圣物碎片 / 逐槽替换 / 档位对照 / 计算器 / 存档导出），作为「进阶工具」保留在装配台下方。
装配台与面板共享同一份 `store.build` 状态：在装配台改的槽位 / 特性 / 碎片，面板立即可见，反之亦然（`store` 事件驱动）。

## 5. 验收

```powershell
node qa/gate.mjs quick     # 单元 + 审计 + 对比度 + 数据契约
node qa/interactions.js --only lab   # B1–B18 装配台交互
node qa/gate.mjs full      # 提交前：截图 / 交互 / 竞态 / 子路径
```

已覆盖的交互断言：6 分类页可达、槽位卡数与效果汇总行数（v5）、空槽卡 → 选择器 → 装备、选择器详情不装备、× 移除 + toast、清空确认、职业抽屉 ≥14 且写入、特性步进器改变合计、结果分组 / EHP、五面板深链、缺件重算、选择器筛选。

## 6. 已知缺口（如实标注，不编造）

- 武器 / 职业 / 圣物不进入防御合计（引擎不建模），装配台只做记录与推荐；「一键配齐」跳过并 toast 说明。
- 技能效果无官方中文效果句：显示解包数值 + 英文原文折叠区，标「待验证」。
- 套装加成（护甲套装效果）数据未收录：护甲行显示套装名与「本套 N/4」，套装加成标「待验证」。
- 碎片颜色加成 / 棱晶机制出处为 locres（置信 mid），未证实处标「待验证」。

## 7. v4 静默版（2026-10-30 同日迭代）— 降噪与渐进披露

用户反馈「信息太散、太杂、看着累」，v4 在不动数据与推荐口径的前提下重排信息层级（事实源仍以代码为准）：

1. **首屏只留三层**：装配台（分类 tab + 当前页）→ 本套效果（一行关键数值）→ 本类推荐（整行卡片网格）；九个进阶面板收进默认折叠的「高级工具」，配装设置收进装配台右上「设置」抽屉。
2. **行内渐进披露**：表格行只保留槽位 / 装备 / 2 个关键数值 / 单行效果 / 套装与来源；英文小字、次要说明默认隐藏；行内操作按钮改为行悬停才出现的浮层；完整属性走统一详情浮层（`components/item-detail.js`），不重复铺在行里。
3. **本套效果**：`S.workbenchSummary` 的 6 个关键值（场景分 / 护甲 / 护甲减伤 / 物理总减伤 / 负重档位 / EHP）压成一行大字；原 v2 结果面板完整内容（防御/生存/机动 + 构成明细 + 输出）放进「完整数值 / 构成明细 / 输出」折叠区。
4. **本类推荐**：从右侧 340px 竖栏改为整行 `auto-fill` 卡片网格（≥320px/卡），限高 330px 内部滚动；各分类仍由 `renderRec(host)` 提供内容与口径脚注。
5. **分类页内部**：武器挂件从「带标题的挂件区块 + 两行」压成武器行下的单行挂件条（名称 + 选择/更换 + 清除）；职业技能从 3 张大卡改为「已记录技能」单行 + 「选择/更换」打开抽取抽屉；特性表 43 条改为限高滚动 + 行内 × 悬停出现；护甲抗性从行内小图标改为数值 `title`（详情浮层有逐项）。
6. **移动端**：修掉 topbar 计数徽章溢出（≤420px 隐藏）与装配台工具栏纵向 flex 的 `flex-wrap` 语义坑（子项按 max-content 撑宽）；390px 无横向溢出。
7. 交互验收同步改造：B9 展开完整结果后断言分组/EHP；B11 改为从「设置」抽屉切换场景；其余 B1–B18 全部通过。

## 8. v5 槽位卡（2026-10-30 同日）— 游戏装备栏式：并排槽位卡 + 效果汇总

用户反馈「纯一行一行的表格，不如游戏里好看，交互效率也低」。v5 不改数据、不改推荐口径，只换分类页的呈现结构（事实源：代码）：

```
.lab-cat
├─ .lab-cat__head   分类标题 + 本类动作（清空四件 / 按流派补空槽）
├─ .lab-cat__body
│  └─ .lab-cat__pad
│     ├─ .lab-slots ── .lab-slot × N（并排槽位卡）
│     └─ .lab-digest ── .lab-digest__row × N + .lab-digest__foot（合计 chips）
└─ .lab-cat__foot   口径注释
```

1. **槽位并排成卡**：护甲 4 / 武器 3 / 职业 2 / 饰品 5 / 圣物与碎片 4。卡片内容 = 槽位名 + 大图标（空槽为虚线框 `+`）
   + 名称（+ 英文小字）+ 2 个关键数值 + 维度 / 套装 / 颜色小标签；缺件卡走红色描边。空槽与有件都是同一张卡，
   只是空槽显示「点击选择」。
2. **交互**：点卡片主体 = 选择 / 更换（空槽与有件同一个 `openPicker` / 职业抽屉 / 碎片抽屉）；
   卡角悬停（触屏常显）= 详情 / 缺件 / 移除；`linkHover(card, row)` 让卡片与它在汇总里的那一行双向高亮。
3. **效果汇总**：把本类已选件的效果逐条列在卡下方（槽位 | 图标 | 名称 + 标签 + 效果句，点行打开详情浮层），
   空槽占位行保证结构稳定；`sums` 是底部合计 chips（护甲：护甲值 / 护甲减伤 / 负重 / 档位；饰品：组合分 + 维度合计；
   碎片：颜色统计），口径与旧表尾合计一致。
4. **卡底附加区**（`.lab-slot__extra`）：武器卡的突变因子 / 改装选择、职业卡的技能记录条复用既有 `.lab-attachline` 结构，
   CSS 已把挂件条压成卡内两行小控件；卡内按钮点击不会冒泡成「更换武器」。
5. **特性页保留列表**：43 条特性是「勾选 + 0–10 级」清单，不是槽位，仍是 `.lab-trrow` 列表（限高滚动）。
6. **共享件**（`js/lab/wb-parts.js`，唯一实现，分类页只组合、不各写一套）：
   - `slotCard({ label, iconName, iconUrl, zh, en, stats, tags, extra, empty, missing, onOpen, actions })`
   - `slotStrip(cards)` — `.lab-slots` 网格（`auto-fit minmax(138px,1fr)`，窄屏自动收列）
   - `digest({ title, sub, iconName, actions, rows, sums, foot, empty })` / `digestRow({ label, iconUrl, zh, tags, effect, lines, extra, onClick, empty })`
   - `linkHover(a, b)` — 卡片 ↔ 汇总行双向高亮
7. **验收**：B1 断言「每类 `.lab-slot` 数 = 槽位上限、`.lab-digest__row` 数 = 卡数」，B3/B4/B5/B7/B18 选择器改为 `.lab-slot(.is-empty)`；
   截图路由与 390px 移动端（卡片列数自动收窄）纳入 `full`。
