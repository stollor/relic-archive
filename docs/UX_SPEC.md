# 《遗迹2》数据库站点 · UX / IA / 视觉契约（v3 · 四领域 + 双主题）

> **本文件是唯一协作契约。** 所有视图、组件、文案必须服从这里；改契约先改本文件。
> 目标：一个站点、四个领域、一套组件、一套术语、一套双主题视觉。禁止各页面各自实现。
> 接手先读 [`../AGENTS.md`](../AGENTS.md)；**§13（v3 修订：流派 + 亮暗双主题）优先于前文**。

---

## 0. 不变量（违反即返工）

1. **只读游戏**：不启动 / 不注入 / 不读内存 / 不改存档或 pak。数据只来自 `.mimocode` 已有产物。
2. **中文优先**：用户可见文案一律简体中文。英文只允许出现在：① 道具英文名副标题（小字、次级）；② 「原文 / 证据」折叠区；③ 代码标识符。
3. **数值可溯源**：任何公式/数值必须有来源；无权威来源的写「待验证」，不编。
4. **一个动作一种意图**（见 §2）。同一动作在全站必须是同一组件 + 同一行为。
5. **无构建步骤**：原生 ESM + 原生 CSS，`python serve.py` 直接可用，无 CDN、无外部字体、无联网。
6. **删文案而不是加文案**：不为填满留白造卡片；同一信息在同一上下文只出现一次。

---

## 1. 信息架构与路由

三个领域，平级；互相**链接**而不是互相复制。

| 路由 | 领域 | 回答的问题 |
|---|---|---|
| `#/items` | **资料库** | 这是什么东西？有什么效果？怎么获得？ |
| `#/lab` | **实验室** | 这些组合起来会怎样？哪个更好？ |
| `#/codex` | **知识库** | 游戏为什么这样运作？规则是什么？ |

子路由（hash，单页）：

```
#/items                     道具（默认视图）
#/items/sets                套装
#/items/<itemId>            道具详情（抽屉状态，可分享/返回）
#/lab                       配装工作台（13 槽）
#/lab/builds                配装推荐（预设矩阵结果）
#/lab/matrix                护甲情况矩阵（A/B/C 三表）
#/lab/calc                  计算器
#/codex                     知识库首页（分类目录）
#/codex/<articleId>         知识条目
```

规则：
- **顶部只放三个领域**，不放功能按钮。领域内二级导航由各视图自己的 `.subnav` 渲染（`资料库：道具/套装`，`实验室：工作台/推荐/矩阵/计算器`，知识库用左侧目录）。
- 路由变化必须同步 `document.title`、`.subnav` 选中态、浏览器前进/后退。
- 深链必须可复现：`#/lab?profile=fortify_sb&class=HEAVY&scenario=losomn` 之类查询参数走 `URLSearchParams`，可用可分享。

---

## 2. 交互契约（全站唯一语义）

| 动作 | 统一行为 | 视觉/反馈 |
|---|---|---|
| 点物品**图标或名称** | 打开该物品**详情抽屉**（同一个组件，任何页面一致） | 抽屉右侧滑入；`Esc`/遮罩/返回键关闭；`#/items/<id>` 同步 |
| 点 **×** 按钮 | 从当前配装**移除**该槽（不影响拥有/收藏） | Toast「已移除」；槽位回到空态；可撤销（Toast 内「撤销」5s） |
| 点**拥有状态**按钮 | 切换「已拥有 / 未拥有」（**独立于**是否装备） | 图标+文案同步切换；Toast 一次；不弹窗、不移动布局 |
| 点**收藏**按钮 | 切换收藏（★），独立状态 | 同上 |
| 点**更换**按钮 / 空槽 | 打开**装备选择器**（抽屉式，同一组件） | 选择器内点物品=选中并装备；点「详情」小图标=看详情（不选中） |
| 点详情里的**关联内容**（套装部件 / 同类物品 / 机制词条） | 打开对应详情或跳对应条目 | 抽屉内前进，带面包屑返回 |
| 点**删除/清空** | 必须走**显式按钮 + 确认框**（危险色） | 确认框写明将删除什么、多少条 |
| 筛选 / 排序 / 搜索 | 即时生效，写 URL 参数（可分享），空白状态给「重置」 | 结果计数即时更新，不做整页 loading |
| 标签页 / 分类导航 | 同一组件 `.seg` / `.tab`；选中态唯一 | 键盘 ←→ 可切换 |
| 弹窗 / 抽屉 / 悬浮说明 | 全站同一套：抽屉=详情与选择器；弹窗=确认与导出；悬浮=补充说明（≤2 行） | 不允许页面自定义第三套 |

**状态模型（必须严格区分）**

```
owned   : Set<itemId>     玩家实际拥有（影响「仅已拥有」筛选与实验室可用池）
fav     : Set<itemId>     收藏（纯标记）
build   : { slotId -> itemId }   当前配装（实验室/工作台）
```

- 一件装备可以 `equipped && !owned`（理论配装）→ 卡片显示「未拥有」标记但仍在槽内。
- 移除 ≠ 未拥有。
- 「标记未拥有」不得删除配装；实验室结果如需排除，由「可用池」规则决定并在结果区明确提示。

---

## 3. 组件（CSS class 契约）

所有视图只能使用 §3 的 class；需要新组件先加到 `css/components.css` 并在本节登记。

| 组件 | 类名 | 说明 |
|---|---|---|
| 按钮 | `.btn` + `.btn--primary｜.btn--ghost｜.btn--quiet｜.btn--danger`，尺寸 `.btn--sm` | 主操作每屏 ≤1 个 primary |
| 图标按钮 | `.iconbtn`（32×32），`title`+`aria-label` 必填 | 只能放**单一语义**，删除类必须 `.iconbtn--danger` |
| 分段控件 | `.seg` > `button.seg__btn.is-on` | 互斥选择 |
| 标签页 | `.tabs` > `button.tab.is-on` + `.tab__count` | 视图内一级切换 |
| 筛选项 | `.chip` / `.chip.is-on` / `.chip__count` | 分类、标签多用 chip |
| 徽章 | `.badge` + `.badge--high｜--mid｜--low`（可信度）｜`.badge--easy｜--craft｜--boss｜--rng`（获取难度） | 只放一个词 |
| 类型标 | `.tag`（带图标 + 中文类型名） | 如 🗡近战 |
| 面板 | `.panel` > `.panel__head`（`h2.panel__title` + `.panel__tools`）+ `.panel__body` | 页面唯一容器层级 |
| 物品卡 | `.card` + `.card--grid｜.card--list`；内含 `.card__media｜.card__name｜.card__en｜.card__meta｜.card__badges` | 卡片整体可点=详情 |
| 装备槽 | `.slot`（`.slot--empty`）> `.slot__media｜.slot__body｜.slot__acts` | 空槽=选择；有件=详情 |
| 数值行 | `.stat` > `.stat__ico｜.stat__val｜.stat__unit` | 图标统一来自 §6 |
| 进度条 | `.meter` > `.meter__fill`（`--v` 0~1） | 抗性/减伤/负重共用 |
| 表格 | `.tbl`（`.tbl--dense`）、`.tbl__num` 右对齐等宽数字 | 长表包 `.tbl-scroll`，表头 sticky |
| 表单 | `.field` > `label.field__label` + `input/select.field__input` | label 必须可见 |
| 空状态 | `.empty` > `.empty__ico` + `.empty__title` + `.empty__hint` + 操作 | 文案≤2 行 |
| 骨架 | `.sk` / `.sk__line` | 首屏 loading |
| 抽屉 | `.drawer`（`#drawer`，全局单例） | JS `ui.openDrawer` |
| 弹窗 | `.modal`（`#modal`，全局单例） | JS `ui.openModal` |
| Toast | `#toasts` `.toast` `.toast--ok｜--warn｜--err` | 最多 3 条堆叠 |
| 悬浮说明 | `.tip`（`#tip`，全局单例） | `data-tip="…"` 自动绑定 |
| 公式块 | `.formula`（`pre` 风格，等宽、可复制） | 知识库/实验室共用 |
| 引用/证据 | `.evidence` > `.evidence__row` | 结论+置信度+依据 |


### 3.1 详情抽屉 / 选择器 / 折叠区（已实现，视图直接复用）

| 组件 | 类名 | 说明 |
|---|---|---|
| 详情头 | `.detail-hero` > `__media｜__ident｜__name｜__en｜__tags｜__acts` | 抽屉横排 / 弹窗左栏竖排；弹窗大图 236px、抽屉 116px |
| 详情容器 | `.detail`（`.detail--modal`）> `.detail__grid` + `.detail__main` | 桌面弹窗两栏（左 300px 媒体，右滚动正文）；移动单列 |
| 弹窗尺寸 | `.modal__card--xl` `.modal__card--detail` | 详情弹窗：宽 ≤1040px、max-height 88vh |
| 详情区块 | `.detail-sec` > `.detail-sec__head` + `__title` + `.detail-sec__body` | 描述 / 效果 / 属性 / 套装 / 获取 / 背景 |
| 效果行 | `.eff-list` > `.eff-row` > `.eff-row__ico｜__txt｜__val` | 三列：分类图标 / 效果文案 / 右对齐数值 |
| 键值表 | `.kv` > `.kv__k` + `.kv__v`（`.kv__v--wrap`） | 右对齐等宽数字 |
| 折叠区 | `details.fold` > `summary` + `.fold__body` | 原始数值、数据来源、原文 |
| 选择器 | `.picker-bar`（`__top`/`__switches`）｜`.picker-tagbox`｜`.picker-tagrow`｜`.picker-active`｜`.picker-list`｜`.picker-row`（`__media/__body/__name/__en/__facts/__tags/__acts`）｜`.picker-count` | 搜索 + 排序 + 标签多选 + 只看已拥有/有数值 |
| 长文本 | `.lore` / `.lore--flavor` | 官方描述 / 风味文本 |

图标风格补充：槽位/类型类图标（longgun/handgun/chest/legs/gloves 等）采用 **填充剪影**（`fill="currentColor"`），在 16–18px 下可辨识；其余为 1.6 线性描边。二者不可混用于同一语义。

---

## 4. JS API 契约（`js/**`，ESM，只读导出）

```js
// core/dom.js
h(tag, props?, ...children) -> Element      // props: class/style/text/html/on:click/dataset/attrs
$ (sel, root?), $$(sel, root?), on(el, type, sel?, fn), clear(el), esc(s)
fmt.num(v, d=0), fmt.pct(v, d=1), fmt.pp(v), fmt.kg(v), fmt.int(v)

// core/icons.js
icon(name, {size=16, cls='', title=''}) -> SVGElement     // 名称见 §6
// ICON_NAMES 已移除：图标名直接从 ICONS 的键派生，无需额外常量

// core/store.js  （持久化：localStorage key = r2.v2.*）
store.state = { owned:Set, fav:Set, build:Object, ui:Object }
store.ready: Promise
store.isOwned(id) / toggleOwned(id) / setOwned(id, v)
store.isFav(id)   / toggleFav(id)
store.build.get(slot) / set(slot, id) / remove(slot) / clear() / list()
store.ui.get(k) / set(k, v)            // density, nameLang, showAssets
store.on(event, fn) / off(event, fn)   // 'owned' 'fav' 'build' 'ui'

// core/ui.js
ui.toast(msg, kind='info')            // kind: ok|warn|err|info
ui.confirm({title, body, ok='确定', cancel='取消', danger=false}) -> Promise<boolean>
ui.openDrawer({title, subtitle, icon, headActs=[], body, foot, onClose, route?}) -> {close}
ui.closeDrawer()
ui.openModal({title, kicker, body, foot, wide=false}) -> {close}
ui.closeModal()
ui.tip(anchorEl, html) / ui.untip()

// core/router.js
router.go(path, {replace=false}) ; router.current() ; router.params()
router.onChange(fn) ; router.start()

// core/api.js （懒加载 + 缓存，失败给出可重试错误态）
api.items() -> Promise<Item[]>          // /data/items.json 规范化后
api.item(id) -> Item|null
api.sets() -> Promise<Set[]>            // 由 items 派生
api.icons() -> icon_index.json
api.iconUrl(item) -> string|null        // /assets/icons/xxx.png
api.site() -> site_data.json            // 实验室数据
api.codex() -> codex 数据
api.terms() -> terms.json

// components/item-detail.js
openItemDetail(id, {from='', onClose})  // 全站唯一详情入口
renderItemDetail(id) -> Element         // 内嵌用（选择器/卡片预览）

// components/item-card.js
itemCard(item, {mode='grid'|'list', onClick, showState=true}) -> Element

// components/picker.js
openPicker({title, slotId?, filter?, currentId?, onPick(item)})  // 全站唯一选择器
```

禁止：视图内直接 `fetch()`、直接读写 `localStorage`、自己实现 drawer/modal/toast/tooltip、复制 `item-detail` 逻辑。

---

## 5. 槽位与分类

**槽位 id（全站唯一）**：`longGun`(长枪) `handGun`(手枪) `melee`(近战) `head`(头盔) `body`(胸甲) `legs`(腿甲) `gloves`(手甲) `amulet`(项链) `ring1..ring4`(戒指) `relic`(遗物) `archetype1`(主职业) `archetype2`(副职业)

数据侧映射（`items.json` 的 `slot`）：

| data.slot | 槽位 | 中文 |
|---|---|---|
| long_gun | longGun | 长枪 |
| hand_gun | handGun | 手枪 |
| melee_weapon | melee | 近战武器 |
| head / body / legs / gloves | 同名 | 头盔 / 胸甲 / 腿甲 / 手甲 |
| amulet | amulet | 项链 |
| ring | ring1..4 | 戒指 |
| relic | relic | 遗物 |
| mod | （改装槽，长枪/手枪各 1） | 武器改装 |
| trait | （特性，最多 10） | 特性 |
| gem / meta_gem | （棱镜/宝石） | 棱镜宝石 |
| consumable | （消耗品，可选） | 消耗品 |

**分类（资料库 chip）** 按 `cat`：`weapon 武器 / armor 护甲 / ring 戒指 / amulet 项链 / mod 武器改装 / skill 技能 / perk 职业专长 / trait 特性 / relic 遗物 / consumable 消耗品 / gem 宝石 / metagem 棱镜宝石 / engram 职业解锁 / material 制作材料`，另有「全部」。分类必须带图标 + 计数。

---

## 6. 图标与语义色（唯一来源：`js/core/icons.js`）

线性 24×24、`stroke=currentColor`、`stroke-width 1.6`，填充仅用于状态点。

| 语义 | 图标名 | 色 token |
|---|---|---|
| 物理 / 护甲 | `phys` / `armor` | `--dmg-phys` / `--dmg-armor` |
| 流血 | `bleed`（血滴） | `--dmg-bleed` |
| 火焰 | `fire`（火焰） | `--dmg-fire` |
| 电击 | `shock`（闪电） | `--dmg-shock` |
| 腐蚀 | `corrode`（滴蚀） | `--dmg-corrode` |
| 枯萎 | `blight`（孢/枯萎） | `--dmg-blight` |
| 暴击 | `crit`（准星+星） | `--crit` |
| 弱点 | `weakspot`（靶心） | `--weakspot` |
| 抗性 | `resist`（盾+波纹） | `--dmg-resist` |
| 负重 | `weight`（砝码） | `--weight` |
| 体力 | `stamina`（肺/闪电环） | `--stamina` |
| 闪避 | `dodge`（翻滚箭） | `--dodge` |
| 已拥有 | `owned`（实心勾） | `--ok` |
| 未拥有 | `unowned`（空心圈） | `--text-3` |
| 收藏 | `star`（实/空） | `--gold` |
| 获取难度 | `shop` `pickup` `craft` `boss` `rng` | `--acq-*` |

规则：**颜色永不单独承载语义**（同时有形状差异或文字）；图标必须 `title`/`aria-label`；同一概念全站同一个图标，不得换用。

---

## 7. 术语表（权威中文，`data/terms.json` 为准）

必须使用（不得自创、不得中英混排）：

| 英文 | 中文 | 备注 |
|---|---|---|
| Armor | 护甲值 | 不是「护甲强度」 |
| Damage Reduction / DR | 减伤率 | 面板写作 `%`；不要写「减伤值」 |
| Armor Efficacy / Armor Effect | 护甲效果 | 坚韧/扭曲神像加的是这个 |
| Encumbrance / Weight | 负重 | |
| Weight Class | 负重档位 | 轻装 / 中装 / 重装 / 超重 |
| Stamina | 体力 | |
| Evade / Dodge | 闪避 | 无敌帧 = 闪避无敌时间 |
| Bulwark | 壁垒 | |
| Physical / Bleed / Fire / Shock / Corrosive / Blight | 物理 / 流血 / 火焰 / 电击 / 腐蚀 / 枯萎 | 均为 locres 官方用词 |
| Resistance | 抗性 | 「流血抗性」等 |
| Critical Hit / Chance / Damage | 暴击 / 暴击率 / 暴击伤害 | |
| Weakspot | 弱点 | 弱点伤害 |
| Status Effect | 状态效果 | 官方用词；社区常说「异常状态」，仅可作为说明 alias |
| Mod | 武器改装 | 固有改装 / 可换装改装 |
| Mutator | 突变因子 | 官方 locres 用词；社区旧称「变异器」仅可作 alias 说明 |
| Relic / Relic Fragment | 圣物 / 圣物碎片 | 官方 locres 用词；社区旧称「遗物 / 遗物碎片」仅可作 alias 说明 |
| Prism | 棱晶 | 官方 locres 用词；「棱镜」仅可作 alias 说明 |
| Trait | 特性 | |
| Archetype / Perk / Skill | 职业 / 职业专长 / 技能 | |
| Challenger / Medic / Hunter / Gunslinger / Engineer / Invader / Explorer / Handler / Alchemist / Summoner / Ritualist / Invoker / Warden / Archon | 挑战者 / 医务兵 / 猎人 / 枪手 / 工程师 / 入侵者 / 探索者 / 驯兽师 / 炼金术师 / 召唤师 / 祭祀者 / 祈求者 / 护卫者 / 执政官 | 以 `data/archetypes.json` 为准（locres 官方译名）；「守望者」是 Watcher（敌人），不是 Warden |
| Gambler / Paragon | 赌徒 / 英杰 | DLC4 数据未实装，UI 必须标注「未实装 / 待验证」 |
| Amulet / Ring / Consumable | 项链 / 戒指 / 消耗品 | |
| Ward 13 / Losomn / N'Erud / Yaesha / Root Earth / Labyrinth | 13 号实验区 / 洛斯曼 / 涅鲁德 / 耶莎 / 根蔓地球 / 迷宫 | 见 STYLE.md §5 |

获取难度：`商店` `固定拾取` `制作` `头目掉落` `解谜` `随机`（+`未知`），统一用这七个词。

---

## 8. 视觉规范（`css/tokens.css` 为唯一来源）

基调：暗色金属 + 金色遗物感 + 数据工具清晰度。**克制**：一层背景、一层面板、少量金色只用于主操作与选中。

```
背景 --bg-0 #080a0e   --bg-1 #0c1016   --bg-2 #11161e   --bg-3 #171d27
描边 --line   rgba(255,255,255,.075)   --line-2 rgba(255,255,255,.14)
文字 --t1 #e9edf4  --t2 #a7b2c2  --t3 #6d7889
强调 --gold #d9ac51  --gold-2 #f0c979  --gold-dim rgba(217,172,81,.14)
信息 --cyan #5bbcc6   危险 --red #d75b50   警告 --amber #d9a13c   成功 --green #63a86e

字号 --fs-micro 11  --fs-meta 12  --fs-body 13  --fs-title 15  --fs-h2 18  --fs-h1 24
行高 1.5（正文）/ 1.25（标题）；数字 font-variant-numeric: tabular-nums
间距 4/8/12/16/24/32（--sp-1..6）
圆角 --r-sm 4  --r-md 8  --r-lg 12
阴影 --shadow-1 0 1px 2px rgba(0,0,0,.4)   --shadow-2 0 12px 32px rgba(0,0,0,.45)
动效 --t-fast .12s  --t .2s  --ease cubic-bezier(.2,.7,.3,1)；尊重 prefers-reduced-motion
```

密度：桌面内容宽 ≤ 1560px 居中；卡片网格最小 168px；移动端（<760px）单列/双列、抽屉全屏、筛选变底部抽屉。

---

## 9. 文件归属（并行开发边界）

| 归属 | 文件 | 说明 |
|---|---|---|
| **Lead** | `index.html`、`css/tokens.css｜base.css｜components.css`、`js/main.js`、`js/core/*`、`js/components/*`、`serve.py`、`docs/*`、README | 只 Lead 改 |
| **lib-dev** | `js/views/library.js`、`css/view-library.css` | 资料库（道具 + 套装） |
| **lab-dev** | `js/views/lab.js`、`js/lab/*`、`css/view-lab.css` | 实验室（工作台/推荐/矩阵/计算器） |
| **codex-dev** | `js/views/codex.js`、`css/view-codex.css`、`data/codex/*.json` | 知识库 |
| **qa-dev** | `qa/*` | 验收脚本、截图、报告；不改产品文件 |

每个视图导出统一接口：

```js
export function mount(rootEl, params) -> { unmount?, onRoute?(route) }
```

---

## 10. 验收（每个视图都要过）

- [ ] 路由可直达、可返回、`title` 正确、刷新不丢状态。
- [ ] §2 交互表逐条可复现（点图标=详情 / ×=移除 / 拥有=独立 / 更换=选择器 / 删除=确认）。
- [ ] 无裸英文界面文案（`grep` 可查）；术语与 §7 一致。
- [ ] 无重复标题/说明卡；同一数值不在同屏出现两次以上。
- [ ] 桌面 1440 / 移动 390 截图无溢出、无遮挡、点击区域 ≥ 32px。
- [ ] 控制台 0 error；数值与旧引擎一致（实验室须对齐 `optimize.py` 结果）。
- [ ] 无网络请求出本机；无外部字体/CDN。

---

## 11. v2 修订（2026-10-27 用户反馈）

> 本节优先级高于 §1–§10 中与它冲突的旧描述；旧条目未被本节覆盖的仍然有效。

### 11.1 详情呈现（替代 §2「详情抽屉」的桌面形态；信息顺序已被 §11.8 修订）

| 视口 | 形态 | 要求 |
|---|---|---|
| 桌面 ≥ 900px | **居中弹窗** `#modal`（`ui.openModal({size:'xl', cardClass:'modal__card--detail'})`） | 宽 ≤1040px、`max-height:88vh`、正文内部滚动；左栏大图 **≥240px**；两栏：左=大图+中英名+类型/DLC/可信度+拥有/收藏/装备；右=内容区 |
| 移动 < 900px | 全屏抽屉 `#drawer`（保持 v1 行为） | 图片 120–140px，单栏 |

详情信息顺序（唯一）：
1. **描述**（`item.descZh` 官方文本；缺失时用清理后的摘要并标注「官方描述未收录」，不显示英文正文）
2. **效果**：每条 = 分类图标 + 效果文案（`effect.lines[].display_zh`，缺失回退「标签 + 数值」）+ 数值；已出现在「属性」的键不重复
3. 属性（护甲/负重/五类抗性/武器伤害/射速/弹匣/备弹/价值等）
4. 套装部件 → 获取途径 → 背景故事（flavor，仅风味文本）→ 数据来源（折叠）

路由同步不变：从 `#/items` 打开写 `#/items/<id>`，关闭恢复列表 hash；`route:false`（实验室/选择器/知识库）不写路由。`Esc` / 遮罩 / 关闭按钮均可关闭。

### 11.2 资料库：筛选、排序、列表描述

- **侧栏不得再出现类型/部位族**（长枪/头盔/戒指…）——那是顶部类型 chip 的重复。侧栏只保留：状态、**效果标签**、套装、可信度、资料片、数值范围、更多。
- **效果标签** = `items.json` 的 `filter_tags`（23 个游戏内标签），中文/分组/图标/释义的唯一来源是 `core/labels.js` 的 `GAME_TAGS`；按 `defense 防御与生存 / offense 输出与战斗 / utility 功能与特殊` 三组展示，带计数与 `data-tip` 释义。
- **排序按分类动态**（数值降序，同值按名称升序）：
  - 武器：伤害 / 射速 / 弹匣容量 / 弹药上限 / 暴击率 / 弱点伤害 / 名称
  - 护甲：护甲值 / 负重 / 抗性合计 / 名称
  - 饰品：价值 / 名称
  - 全部/其它：默认 / 名称 / 资料片
  - 切换分类时若当前排序不适用，回退 `default` 并同步 URL。
- **列表视图每行显示描述**：`descZh`（2 行截断），缺失时用 `effectPreview` / `summaryZh`；行内仍保留关键数值、拥有/收藏快捷按钮与未拥有标记。

### 11.3 选择器（v1 §2「更换=选择器」的能力补全）

`openPicker` 必须提供：搜索、类型 chip、**效果标签多选**（来自 `GAME_TAGS`，只展示候选集实际出现的标签+计数）、只看已拥有、有数值开关、排序（护甲值/负重/伤害/射速/名称，按槽位动态）。交互不变：**点行=选中装备；行内 ⓘ=只看详情不选中**。移动端筛选区可折叠/横滑，不得挤掉列表。

### 11.4 实验室：单页工作台（替代 v1 的推荐/矩阵子页）

实验室只有一个主页面，下方面板用 `.seg` 切换（`?panel=` 可分享）：

```
#/lab                          工作台（默认）
#/lab?panel=recommend          推荐方案
#/lab?panel=classes            逐槽替换 + 档位对照（原「护甲矩阵」）
#/lab?panel=calc               计算器
#/lab?panel=saved              存档与导出
#/lab/builds  → panel=recommend   （旧链接重定向）
#/lab/matrix  → panel=classes     （旧链接重定向）
#/lab/calc    → panel=calc        （旧链接重定向）
```

**工作台构成（15 槽）**：武器 3 + 护甲 4 + 饰品 6（项链/戒指×4/遗物）+ **职业 2**（`archetype1` 主职业 / `archetype2` 副职业）。空槽/更换 → 同一个 `openPicker`；点图标/名称 → 同一个详情。

**实验室 v2（2026-10-30 起，见 `docs/LAB_V2.md`）**：面板拆成 3 个一级 tab（推荐 / 装备 / 数据与存档），一级下再分二级面板；九面板：推荐方案/饰品组合/武器改装 · 特性/圣物碎片/逐槽替换 · 档位对照/计算器/存档导出。
- 装备默认**全库可用**：不再需要逐件标记「已拥有」；遇到没有的装备用「缺件」标记（槽位卡片 / 选择器 / 组合行 / 结果行均可），推荐/组合/替换默认排除缺件。
- 流派出 9 个（通用/远程暴击/远程续航/近战/状态流/改装技能/生存坦克/辅助召唤/召唤流），维度分口径 = 游戏 `filter_tags` + 词条关键词映射，**不是游戏内精确数值**，页面必须标注。
- 饰品组合：1 项链 + 4 戒指按流派维度组合评分（0.7·平均 + 0.3·覆盖），固定已装备件后对空槽做边际推荐、对同槽做替换推荐；组合可整组写入槽位 / 整组标记缺件。
- 武器改装：每把武器推荐突变因子（按远程/近战过滤）与改装（远程可换、近战只有固有改装），附效果原文与适配流派，可写入挂件。
- 特性：全量 43 条真特性（`cat=trait` 的 85 行里 42 行是 `*_Stats` 数值表分支），0–10 级、同时启用上限 10；数值特性并入防御合计，其余按维度分与效果原文展示。
- 圣物碎片：45 条（红/黄/蓝各 15），圣物 3 碎片槽；颜色加成/棱晶机制出处为 locres（置信 mid），未证实处标「待验证」。
- 结果面板新增输出：复制 Markdown / 复制 JSON / 下载 `.md` / 下载 `.json` / 打印；内容含槽位、挂件、特性、碎片与关键数值，并附口径说明。

**实验室 v3（2026-10-30 起，见 `docs/ASSEMBLY_V3.md`）**：v2 的 15 槽网格拆成 **6 个分类页（Table）** 的装配台——护甲四件 / 武器与改装 / 职业与技能 / 饰品 / 特性 / 圣物与碎片。
- 每个分类页只放本类槽位，逐行展示该件完整属性（护甲值·负重·抗性 / 伤害·射速·暴击·弹匣 / 维度·效果 / 等级步进 / 颜色·属性…）与操作（详情 / 缺件 / 更换 / 移除）；空槽为虚线行，整行可点开同一个选择器。
- 装配台下方固定「本套效果 + 本类推荐」：本套效果即 v2 结果面板（防御 / 生存 / 机动 + 构成明细 + 输出）；本类推荐随分类切换（四件套 / 挂件 / 防御向职业 / 饰品组合 / 特性 / 碎片），均带口径说明。
- 工具栏：流派 / 场景 / 档位 / 缺件清单 / **按流派配齐**（自动填护甲、饰品、特性、碎片与已选武器挂件；职业与圣物不建模，toast 明示）。
- 分类页深链 `#/lab?tab=armor|weapons|archetype|trinkets|traits|relic`（默认护甲省略）。
- 职业技能 3 选 1 写入 `meta.skills`，**不参与防御合计**，仅作配装记录；技能由解包数据推导，UI 标「待验证」。

**配装设置（显式，不再是一个「增益档」下拉）**：
- 职业：主/副两个职业槽，数据 `data/archetypes.json`；职业已收录的防御向专长并入合计；主职业首领专长不在防御口径内，必须标注。
- 消耗品：折叠多选，参与合计；场景 + **档位目标**（不限/轻装/中装/重装/超重）。
- 折叠区可「从预设增益档载入」（旧 11 个 profile 仅作起点）。

**结果面板（分三组，全部来自引擎）**：
- 防御：护甲值（基础→加成后）、护甲减伤、固定减伤、五类总减伤条、最坏情况减伤、场景分；
- 生存：**有效生命 EHP**（以基础生命 100 计，`(100+Σhealth)/(1-物理总减伤)`，必须标注假设）、生命上限加成、护盾%、生命回复、吸血、敌人减伤；
- 机动：负重/阈值/档位、体力上限、单次闪避消耗、可闪次数、体力回复、无敌帧/恢复帧、冲刺速度、闪避窗口/距离/速度加成；
- 构成明细（折叠）：四件护甲、职业专长、特性（等级+效果）、碎片/消耗品、饰品；缺件/未拥有标记。

**推荐方案**：基于当前工作台设置（特性/职业/碎片槽/消耗品/饰品/场景/档位目标/缺件）实时穷举，候选池 = 场景分前 300，排序：场景分 / 物理总减伤 / 最坏情况减伤 / 护甲值 / 有效生命 / 负重↑；每页 10 组，可「写入四件」。可用池 = 全库 − 缺件（默认开启「排除缺件」）。筛选与排序写 URL。

**逐槽替换 + 档位对照**：逐槽替代保持其余三件不变（top3，Δ场景分/Δ护甲/Δ负重，可应用+撤销）；档位对照给四档「极限护甲配置」（阈值/护甲/减伤/负重/与当前对比/载入），并折叠保留「场景×抗性特化」表。原矩阵 C（缺件怎么办）并入逐槽替换的空态与缺件提示。

**状态与存档**：职业写 `build.slots.archetype1/2`；特性等级/碎片槽/消耗品/场景/档位目标/流派/武器挂件写 `build.meta = {traitLevels, fragmentSlots, consumables, scenario, classTarget, playstyle, mutators}`（旧 `fragments` 数组读取时迁移到前三槽），武器改装沿用 `build.mods.longGun/handGun`，随存档一起保存/载入。`profileId` 不再是工作台主状态。

### 11.5 v2 新增 API（已实现，视图直接用）

```js
// core/api.js
api.archetypes() -> Promise<{archetypes:[{id,en,zh,dlc,role,trait,perks,...}]}>
api.archetypesSync() -> Archetype[] ; api.archetype(id) ; api.archetypeByEn(en)
// 规范化 item 新增：maxAmmo/ammoPerClip/impact/range/spread/procChance/isAutomatic

// core/ui.js
ui.openModal({..., size:'lg'|'xl', cardClass:'modal__card--detail'})

// core/labels.js
GAME_TAGS: [{id,zh,group,icon,desc}] ; GAME_TAG_BY_ID ; GAME_TAGS_BY_GROUP ; TAG_GROUP_ZH ; EFFECT_CAT_ZH
```

### 11.6 文件归属 v2

| 归属 | 文件 |
|---|---|
| **Lead** | `index.html`、`js/core/*`、`serve.py`、`docs/*`、README |
| **detail-dev** | `js/components/item-detail.js`、`css/components.css`（detail/modal 段） |
| **lib-dev** | `js/views/library.js`、`css/view-library.css` |
| **picker-dev** | `js/components/picker.js`、`css/components-picker.css`（新文件，index.html 已挂载） |
| **lab-dev** | `js/views/lab.js`、`js/lab/*`、`css/view-lab.css` |
| **data** | `data/archetypes.json`、`data/terms.json`（只加不改） |
| **qa-dev** | `qa/*`（不改产品文件） |

### 11.7 验收追加（在 §10 基础上）

- [ ] 桌面 1440：点卡片 → `.modal` 可见、`.drawer` 不可见、详情图片实际宽度 ≥240px；`Esc` 关闭后 hash 回到列表。
- [ ] 移动 390：点卡片 → `.drawer` 可见且宽度 = 视口宽；详情图片 ≥120px。
- [ ] 详情含「描述」区块且文本非空、纯中文；效果行带官方效果文案（含中文、含数值）。
- [ ] 资料库侧栏无「部位族」；有「效果标签」；标签 chip 为中文（无 Health/Defense 等英文 id 直出）；点击后结果数变化。
- [ ] 武器分类排序切换后首项数值严格递减；列表视图每行有非空描述。
- [ ] 选择器有标签筛选 + 排序；筛选后计数与结果一致；点行仍能装备。
- [ ] 实验室：15 槽存在；职业槽可选且合计变化；特性 stepper 改变合计；推荐面板有排序且切换后顺序变化；逐槽替换/档位对照面板存在；结果面板出现「有效生命」；旧交互（×/拥有收藏独立/删除确认/ⓘ 不选中）不回归。
- [ ] 旧引擎对拍不回归：330 预设与缺件重算结果仍与 `optimize.py` 一致。

---

## 12. 效果原文优先（2026-10-27 第六轮用户反馈）

> 本节优先级最高：与 §11.1（信息顺序）、§11.2（列表描述）冲突时以本节为准。

### 12.1 用户口径

- 用户说的「道具描述」= 游戏里的**效果句原文**（机制句），例：阿哈内水晶「目标每承受一种不同的状态效果，对其造成的伤害额外增加 5%。」。
- 游戏里的**风味/背景段落**（`Description`，如「据说对那些想驯服耶莎水晶之力的人来说……」）与**引号短句**（`FlavorText`）都要**保留**，但降级为「背景」，不再占据描述首位。
- **只引用游戏原文**，不自造变体、不追加「（4 种 = +20%）」这类折算注解；占位符按道具数值填充（等价游戏运行时行为）。

### 12.2 数据（`data/item_effects.json`）

```json
{ "meta": {"source":"...", "counts":{"official":304,"manual":19,"none":803}},
  "items": { "Ring_PanMageSigil": {
      "zh": "目标每承受一种不同的状态效果，对其造成的伤害额外增加 5%。",
      "zhTpl": "…{DamageModPerStatusEffect}%…", "en": "Deal …", "key": "<locres key>",
      "src": "official|manual", "confidence": "high|medium|low", "match": "exact|prefix|fuzzy|manual",
      "values": ["5"] } } }
```

生成脚本 `build/mk_item_effects.py`（可重跑）：

1. 本地化 `locres_en.json` / `locres_zh-Hans.json` 同 key，剔除 `<span>` 改装等级文本与名称为 `Level N/等级 N` 的条目，归一化（占位符与数字→`#`）；
2. wiki 英文 `effect`（`data/wiki_items.jsonl`）作桥，用 `item asset path` → 道具 id，按 exact → prefix → fuzzy(≥0.82 且数字个数一致) 匹配；
3. 填充按**占位符名字**对位（不是语序），值取 `numbers[占位符名]`，否则取 wiki 文本数字（要求个数与占位符数一致）；负数遇「提高/增加/提升」自动改动词取反（「提高 -25%」→「降低 25%」）；
4. 正则/格式不合格（残留 `{}`、成串英文）的丢弃，绝不显示半句；
5. `src=manual` 只用于 `ring/amulet/relic`（`build/zh_effect.json` 旧人工句），UI 标注「人工整理，非游戏原文」。

覆盖（2026-10-30 更新）：官方 304 + 人工 19 + **wiki 英文回退 350 = 673 件 / 1126 真道具（59.8%）**；饰品类（ring/amulet/relic）≈81%，消耗品≈44%，改装/材料较低（游戏文本拆成多段或缺失）。fuzzy 只在原文与原句 ≥0.95 一致时才按位置填值，其余只认同名数值键；低置信度清单见 `build/effect_review.json`。武器**不生成**（wiki 的 weapon `effect` 是风味描述，机制只有数值）；护甲 130 件 wiki 无 `effect`，这两类是覆盖率的**结构性缺口**，不拿风味描述冒充机制句。其余道具走降级路径，不编造。

**wiki 英文回退（`src=wiki` / `match=wiki-only`）**：官方中文句缺失、但 `wiki_items.jsonl` 有英文 `effect` 时，输出 `{zh:'', en:<清洗英文>, src:'wiki', confidence:'medium', match:'wiki-only'}`。详情页在**无中文句**时额外渲染「效果原文（wiki 整理）」区块：`<em>` 斜体英文 + `来源：wiki` badge + 「未经翻译」说明行（独立 class `.detail-wiki`，不复用 `.detail-effect`；中文优先，无英文不出现）。`effectEn` 同时并入搜索 haystack（可搜英文关键词）。英文不翻译、不改数字；tooltip 注入残留（`BLEEDINGBLEEDING`、`[sic]` 等）在生成器清理。

### 12.3 详情信息顺序（唯一）

| 情况 | 顺序 |
|---|---|
| 有 `effectZh` | **效果**（原文句，`--fs-h2`≈18px、`--t1`、行高 1.75、≤3 段；`manual` 加小字「人工整理，非游戏原文」）→ **数值明细**（`effectLines`）→ 属性 → 套装 → 获取 → **背景**（`descZh` 段落在前、`flavorZh` 引号在后）→ 数据来源 |
| 无 `effectZh` 且 `cat ∈ EFFECT_CATS` | **效果**（即数值行区块）→ 属性 → 套装 → 获取 → **背景**（descZh + flavor）→ 数据来源；**不出现「描述」区块** |
| 无 `effectZh` 且非 `EFFECT_CATS` | 旧行为：描述 → 效果 → 属性 → 套装 → 获取 → 背景故事（flavor）→ 数据来源 |

`EFFECT_CATS = ['ring','amulet','relic','consumable','mod','metagem','gem','material']`（判定用 `item.cat`，不是 `family`）。武器/护甲/特性/技能等在游戏内 tooltip 本就是「属性 + 风味」，保持描述在前。

> 2026-10-30 追加：`src=wiki` 的道具（中文句缺失、有英文原文）在「效果 / 数值明细」之后追加「效果原文（wiki 整理）」区块；它不改变上面的信息顺序，只是把原文补在数值之后。

### 12.4 资料库列表行

- `it.effectZh` 非空 → 显示效果句（`.lib-row__desc--effect`）；桌面 2 行、移动 1 行截断，`title` 放全文。
- 否则若 `cat ∈ EFFECT_CATS` → `effectPreview(it)` 数值摘要；仍空 → 「效果数据待核实（官方效果未收录）」。
- 其它类别 → 现有 `descZh → effectPreview` 兜底链。
- 搜索：`effectZh` 已并入 `item.haystack`（搜「状态效果」能命中阿哈内水晶）。

### 12.5 API / 文件

- `api.js`：`URLS.effects = '/data/item_effects.json'`；`loadItems()` 并行加载并挂 `item.effectZh / effectEn / effectSrc / effectMatch`；`S.effectMeta`。
- `serve.py`：`EXTRA_DATA['item_effects']`（健康检查 `/api/health` 的 `extra_data` 从 5 项变 6 项）。
- 归属：`build/mk_item_effects.py`、`data/item_effects.json`、`js/core/api.js`、`serve.py` = Lead；`item-detail.js` / `library.js` / 两个 CSS = site-dev；`qa/*` = qa-verifier。

### 12.6 验收追加

- [ ] 阿哈内水晶详情首块标题「效果」、文本 = 官方效果句（不得出现「据说……」）；「背景」区块保留风味段落 + 引号句。
- [ ] 列表视图阿哈内水晶行显示效果句；`Amulet_AbrasiveWhetstone`（无效果句）不得显示风味段落。
- [ ] 武器/护甲详情保持「描述」在前（回归不破）。
- [ ] 任一详情不出现未替换 `{占位符}`、不出现成串英文；`manual` 条目有小字标注。
- [ ] `/data/item_effects.json` 200；`/api/health` extra_data 含 `item_effects`。
- [ ] 全量回归：`node qa/shot.js --all`（36/36）、`node qa/interactions.js`（54/54）、`python qa/audit.py`（0 FAIL）。

---

# 13. v3 修订（2026-10-28）：流派领域 + 亮暗双主题

> 本节是 **优先于前文** 的增量修订；与 §2（三领域）冲突处以本节为准。

## 13.1 第四个领域「流派」

| 项 | 契约 |
|---|---|
| 导航 | 顶部导航四项：资料库 / 实验室 / **流派** / 知识库；`Alt+1/2/3/4` 对应；顺序固定 |
| 路由 | `#/builds`（列表，默认子路由）、`#/builds/<buildKey>`（详情）；`<buildKey>` 取自 `data/builds.json` 的 `builds[].key`；未知 key 走 404 空态 |
| 数据 | `data/builds.json`（`api.builds()/buildData()/build(key)/buildEntity(ref)`）；视图禁止直接 fetch |
| 列表 | 口径条 →「按目标选」（6 类，按对应评分排序取前三）→ 7 张卡片（序号/名称/定位/双职业/负重档/饰品乘区/5 项星级+数值/综合/饰品贡献/一句话）→ 横向对比表 → 配装规则 → 评分与数据口径 |
| 详情 | hero（面包屑/序号/名称/tagline/定位·负重·职业 tag/适用场景/综合·护甲·负重/「装入实验室」）+ 分区：伤害链条、武器、护甲、饰品、职业与天赋、装配说明、输出循环、替换方案、清群诊断、难点、饰品乘区、口径与证据 + 侧栏评分与上下套导航 |
| 道具引用 | 真实道具（`api.item(id)` 可解析）→ 可点 chip，打开全站统一详情（桌面弹窗 / 移动抽屉），不改详情 hash；纯文本实体（碎片/棱镜传奇/wiki-only）→ 只读 chip + `data-tip` 中文效果，不可点 |
| 装入实验室 | 只写 `store.build` 的 `ALL_SLOTS`：`armor_parts` → head/body/legs/gloves 顺序；`slots.ring[]` → ring1..4；`archetypes[0..1]` → archetype1/2（id 可解析才写）；其余（改装/变异器/天赋/碎片/传奇）跳过并在 toast 明示条数；写完 `router.go('/lab')` |
| 404 | `.b404` 空态：说明 + 「返回流派列表」链接；不得 console error |
| 一页一 h1 | 列表页 h1 由 subnav 提供；详情页 h1 = 套名，subnav 降级为非标题元素 |

## 13.2 亮 / 暗双主题

| 项 | 契约 |
|---|---|
| 唯一色值来源 | `css/tokens.css`：`:root` = 暗色（默认）；`html[data-theme="light"]` = 亮色整套覆盖；**变量名只增不改不删**（新增行尾标「新增」） |
| 首屏 | `js/theme-boot.js`（经典脚本，在 CSS 之前同步执行）读 `localStorage["r2.v2.ui"].theme` + `prefers-color-scheme`，写 `html[data-theme]` / `data-themeMode` / `style.colorScheme`，防闪白/闪黑 |
| 运行时 | `js/core/theme.js`：三态循环 `auto → light → dark → auto`；`#themeBtn` 点击；`Alt+T`（输入框/contenteditable 内忽略）；`auto` 监听系统变化即时生效；同步 `<meta id="themeColorMeta">`（值从 `--bg-0` 计算值读取，JS 不存色值）；View Transitions 可用则交叉淡入，`prefers-reduced-motion` 下直切 |
| 持久化 | 仅 `localStorage["r2.v2.ui"].theme`（`auto｜light｜dark`，默认 `auto`），经 `store` 读写；不新增 key |
| 按钮 | `#themeBtn`：三套内联 SVG（自动/白天/黑夜）+ `title`/`aria-label`「主题：自动（跟随系统）/白天/黑夜」+ `data-mode` |
| 组件 | `base/components/components-picker` **禁止**颜色字面量（`#hex`/`rgb()`/`hsl()`），一律 token；视图 CSS 同样只允许 token |
| 对比度 | 正文/强调 ≥4.5:1，UI/大字号 ≥3:1；`node qa/theme-contrast.mjs` 必须退出码 0 |

## 13.3 验收追加

- [ ] `node qa/shot.js --theme dark` / `--theme light` 各全 PASS，且 `_summary*.json` 的 `themeState.theme` 与 `--theme` 一致、`mode=auto`（证明跟随系统）。
- [ ] `node qa/interactions.js` 含流派 P1–P7 与主题 G10 全 PASS（67/67）。
- [ ] `python qa/audit.py` 0 FAIL（硬编码色 0、裸英文 0）。
- [ ] `node qa/theme-contrast.mjs` 130/130 PASS。
- [ ] `tokens.css` 之外 `grep -E "#[0-9a-fA-F]{3,8}|rgba?\(|hsla?\("` = 0 行（含 view-*.css 与 js）。

