# 工程架构与扩展配方（ARCHITECTURE）

> 目的：让「加一个筛选 / 加一个领域 / 加一个实验室面板」这类改动**知道该动哪 1–3 个文件**，
> 而不是先读完整套源码。这里的每条规则都有对应的自动守卫：`qa/tests/architecture.test.mjs`。
> 改动前先看 [`UX_SPEC.md`](UX_SPEC.md)（交互契约）与 [`LESSONS.md`](LESSONS.md)（踩过的坑）。

---

## 0. 一句话结构

**应用壳（`js/main.js`）+ 一张领域表（`js/domains.js`）+ 四个领域视图 + 一层共享能力（`js/core`、`js/components`）。**
没有打包器、没有框架、没有运行时插件系统；领域表就是唯一的「注册中心」。

```
index.html ──→ js/main.js ──→ js/domains.js ──→ js/views/<domain>.js
                   │                                  │
                   ├── js/core/*      基础能力（路由/数据/状态/UI/图标/文本/任务）
                   └── js/components/* 共享 UI（详情/选择器/卡片/空态/面板）
                                        │
                     js/builds/*  js/library/*  js/lab/*   ← 领域模块（纯逻辑 + 区块渲染）
```

---

## 1. 依赖方向（硬规则）

| 层 | 目录 | 可以 import |
|---|---|---|
| 应用层 | `js/main.js`、`js/domains.js` | 任意层（组装者） |
| 视图层 | `js/views/*` | core、components、本领域模块、其它领域模块（只读 API） |
| 领域模块 | `js/builds/*`、`js/library/*` | core、components（builds 用 item-card/detail）、同领域 |
| 实验室 | `js/lab/*` | core、components（详情/选择器）、同领域 |
| 共享组件 | `js/components/*` | core、components |
| 基础能力 | `js/core/*` | **只能 core**（永不向上依赖） |

规则（违反会被架构守卫测试报红）：

1. `core` 不得 import `components` / `views` / `lab` / `builds` / `library`。
2. `components` 不得 import `views` / `lab` / `builds` / `library`。
3. 领域模块（`builds` / `library` / `lab`）不得 import `views`。
4. 模块之间不得出现循环依赖（含动态 import）。
5. 只有 `js/main.js` 订阅 `router.onChange`；视图只实现 `onRoute(ctx)`。
6. 只有 `js/core/router.js` 写 `location.hash` / `history.*`。视图导航用 `router.go`，装饰性 URL 用 `router.replaceSilently`。
7. `js/components/item-detail.js` **不拥有 URL**（不读写 hash/history，不接受 `route` 开关）；打开/关闭详情时的地址栏同步归调用方视图。
8. 共享能力只有一个权威实现（见 §4）：空态/错误态、面板骨架、道具展示文本、任务与清理。

---

## 2. 模块地图

| 路径 | 职责 | 什么时候改它 |
|---|---|---|
| `js/domains.js` | **领域注册表**：id / 中文名 / 标题 / 图标 / 路径 / 快捷键 / 顶栏角标 / 视图样式 / 视图懒加载器 | 新增或调整领域（唯一入口） |
| `js/main.js` | 应用外壳：启动、导航渲染、路由派发（代际化）、视图生命周期、错误边界、顶栏计数、帮助面板 | 改派发/错误处理/全局快捷键语义 |
| `js/core/router.js` | hash 解析与导航 API（`go` / `setQuery` / `replaceSilently` / `onChange` / `setTitle`）。**不认识任何具体领域** | 改路由形态（少动） |
| `js/core/api.js` | 唯一数据入口：items / sets / builds / codex / archetypes / site_data / 图标 URL / 实体解析 | 加数据源、改规范化学段 |
| `js/core/store.js` | 唯一持久化入口：owned / fav / build / saved / ui（白名单归一 + 迁移 + `storage-error`） | 加用户偏好、改存储格式 |
| `js/core/ui.js` | Toast / 确认框 / 抽屉 / 弹窗 / 悬浮说明的生命周期 | 改浮层行为（全站唯一） |
| `js/core/dom.js` | `h()` 建元素、`fmt` 格式化、`stripTags`、`debounce`、拷贝/下载 | 加通用 DOM 小工具 |
| `js/core/labels.js` | 全站中文词表 + **道具展示文本规则**（`zhDisplay` / `effectZhSentence` / `EFFECT_CATS` / `FAMILY_GROUPS`） | 改分类/标签/数值标签/文本判定 |
| `js/core/task.js` | `createEpoch`（代际）/ `createTaskRunner`（分帧任务）/ `createRefresh`（合并刷新）/ `createScope`（清理域） | 异步生命周期（优先复用，不要手写） |
| `js/core/icons.js` | 内联 SVG 图标库（唯一来源） | 加图标 |
| `js/core/theme.js` + `js/theme-boot.js` | 三态主题、首屏防闪 | 改主题机制 |
| `js/components/item-detail.js` | 全站唯一道具详情：外壳 + 状态按钮 + 桌面弹窗 / 移动抽屉 | 改详情外壳、打开方式 |
| `js/components/item-detail-sections.js` | 详情的各个内容区块（描述/效果/属性/套装/获取/背景/来源） | **改详情某个区块就来这里** |
| `js/components/picker.js` | 全站唯一装备选择器（抽屉） | 改选择器筛选/排序/行样式 |
| `js/components/item-card.js` | 道具卡（网格）与图标元素 | 改卡片外观 |
| `js/components/states.js` | 空 / 错误 / 载入状态（唯一实现） | 改空态外观与文案结构 |
| `js/components/panel.js` | 面板骨架 `.panel`（唯一实现，返回 `{el,head,title,tools,body}`） | 改面板头/工具区结构 |
| `js/views/library.js` | 资料库装配：外壳、控件、列表/卡片分批渲染、套装抽屉、路由与生命周期 | 改页面组装与交互接线 |
| `js/library/query.js` | **纯函数**：状态 schema、URL 序列化、排序定义、过滤与计数（依赖注入 `deps`） | **加筛选条件 / 加排序** |
| `js/library/present.js` | **纯函数**：列表行文案与关键数值规格、套装合计/资料片 | 改列表行展示口径 |
| `js/library/export.js` | **纯函数**：CLI 查询串导出（`rmn2.cli/1-query`） | 改导出格式 |
| `js/views/builds.js` | 流派装配：数据加载、列表/详情切换、404/错误/载入、生命周期 | 改页面组装 |
| `js/builds/ui.js` | 流派领域共用小件与数据表（评分、槽位元信息、chip、星级） | 改流派共用口径 |
| `js/builds/list.js` | 流派列表页（目标榜、卡片、对比表、规则/口径） | 改列表页区块 |
| `js/builds/detail.js` | 流派详情页（英雄区 + 武器/护甲/饰品/职业/循环/难度…区块） | 改详情区块 |
| `js/views/lab.js` | 实验室装配：**面板注册表**（`PANELS`）、工作台、面板切换与 URL 参数 | **新增实验室面板** |
| `js/lab/workbench.js` | 工作台装配：上下文、刷新调度、订阅与销毁 | 改工作台组成 |
| `js/lab/wb-slots.js` | 15 个槽位渲染、分组、选择器分发、移除 | 改槽位交互 |
| `js/lab/wb-settings.js` | 配装设置区（场景/档位/特性/碎片/消耗品/种子） | 改设置区控件 |
| `js/lab/wb-result.js` | 结果面板（防御/生存/机动、构成明细、口径公式） | 改结果口径展示 |
| `js/lab/engine.js` | 护甲计算引擎（与 Python 对拍 330/330） | **只有数据口径变化才动** |
| `js/lab/model.js` / `state.js` | 数据装配 / 配装状态（`nameOf`、`iconOf` 身份解析唯一实现） | 改模型或配装 schema |
| `js/lab/{recommend,replace,tiers,calc,saved}.js` | 五个面板（枚举/逐槽替换/档位对照/计算器/存档） | 改对应面板 |
| `css/*` | `tokens.css` 是唯一色值来源；`base/components/view-*` 分层 | 改样式（不改其它层） |
| `data/` | 运行时数据（经 `api.js` 读取） | 不改代码的数据更新 |
| `pipeline/` | 数据生成/同步（开发用，不参与运行时） | 数据流 |
| `qa/` | 门禁与回归测试（不参与运行时） | 加测试 |

---

## 3. 路由与交互归属（一次动作只有一个负责人）

| 动作 | 唯一负责人 | 别人怎么做 |
|---|---|---|
| 监听路由变化 | `js/main.js`（`router.onChange(dispatch)`） | 视图实现 `onRoute(ctx)`；**不要**再 `router.onChange` |
| 决定挂载/卸载视图 | `js/main.js`（`dispatch`，代际化） | 视图导出 `mount()` / 返回 `{onRoute, unmount}`；`unmount` 幂等 |
| 导航（切领域/子路由） | 链接 `href="#/..."` 或 `router.go()` | 不要写 `location.hash =` |
| 筛选/排序态与地址栏同步 | 领域视图（资料库 `scheduleUrl`→`router.go`） | 用 `router.setQuery` / `router.go`，不要自己拼 `history` |
| 打开/关闭详情 + URL | **调用方视图** | 详情组件只开浮层；`onClose` 回调里由视图决定地址栏 |
| 抽屉 / 弹窗 / Toast / 悬浮说明 | `js/core/ui.js` | 视图只调用 `ui.openDrawer/openModal/toast`，不碰 scrim/body overflow |
| 用户操作状态（拥有/收藏/配装/偏好） | `js/core/store.js` | 视图只读写 store，并用 `store.on()` 订阅（**成对释放**） |
| 显示状态 | 视图从 store + 路由 ctx 派生 | 不把显示状态写进 store |
| 异步任务 / 帧调度 / 清理 | `js/core/task.js` | 不要手写 epoch/instance 守卫与裸 rAF |
| 领域清单（导航/标题/快捷键/样式） | `js/domains.js` | 不要在别处再列一遍领域 |

交互语义不变量（来自 `UX_SPEC §2`，重构不得改变）：
点物品**主体**开详情；`×` 是**独立移除控件**；「已拥有」与「是否装备」互不相干；空槽/更换开选择器。

---

## 4. 共享能力清单（唯一权威实现）

| 能力 | 权威实现 | 用法 |
|---|---|---|
| 空 / 错误 / 载入状态 | `js/components/states.js` | `emptyState({icon,title,hint,actions})`、`errorState({err,onRetry})`、`loadingState({text})`；往已有 `.empty` 容器塞内容用 `emptyBody(opts)` |
| 面板骨架 | `js/components/panel.js` | `const {el,body,tools} = panel({title,icon,sub,tools,body,flush})`；禁止再手写 `panel__head` |
| 道具展示文本 | `js/core/labels.js` | `zhDisplay(text)`（干净中文）、`effectZhSentence(item)`、`EFFECT_CATS`、`FAMILY_GROUPS`、`familyGroupOf(family)` |
| 通用名解析 | `js/lab/model.js` | `model.nameOf(id)` / `model.iconOf(id)`（items→archetype→piece） |
| 代际 / 分帧 / 合并刷新 / 清理 | `js/core/task.js` | `createEpoch()`、`createTaskRunner()`、`createRefresh(fn)`、`createScope()` |
| 元素 / 格式化 | `js/core/dom.js` | `h()`、`clear`、`fmt.*`、`stripTags`、`debounce`、`copyText` |
| 图标 | `js/core/icons.js` | `icon(name,{size})` |
| 领域表 | `js/domains.js` | `DOMAINS`、`domainById`、`domainLabel`、`isDomain`、`shortcutDomains` |
| 任务级验收 | `qa/tests/*` | 单元 + 浏览器回归 + 架构守卫 |

**不共享的东西**（留在领域内部，别抽）：实验室护甲口径/枚举参数、流派的评分数据表与详情区块、资料库的筛选控件实现、状态文案里的游戏口径。

---

## 5. 六类高频任务配方

> 每条都给出：**改哪里 → 复用什么 → 跑哪些测试**。

### 5.1 添加一种道具筛选条件

1. `js/library/query.js`：`defaultState()` 加字段 → `parseState()`（白名单校验 + URL 键）→ `serialize()`（只在非默认时写）→ `matches(item, state, deps)` 加判定 → `isActive()` 计入「有筛选」。
2. `js/views/library.js`：`buildShell` 里加控件（开关用 `switchRow`，多值用 `chip` + `toggleIn`）→ `syncControls()` 回填 → `renderPills()` 加可移除 pill（多值字段记得 `removeFrom`）。
3. `qa/tests/library-query.test.mjs` 加两条用例（命中 / 未命中 + 序列化往返）。
4. 跑：`node --test "qa/tests/*.test.mjs"` → `node qa/shot.js --only items --theme dark/light` → `node qa/interactions.js`。

### 5.2 新增一种排序

1. `js/library/query.js`：`SORT_DEFS[族]` 加 `[id, 中文名]`；数值排序在 `NUM_SORT` 加取值器（`availableSortIds` 会自动隐藏「当前分类池没有该数值」的排序，不需要手改 UI）。
2. 若字段名与排序 key 不同，只在 `NUM_SORT` 里做映射；`sortList` 的默认分支已处理「数值降序 + 中文名升序」。
3. 导出：`js/library/export.js` 的 `sortMap` 补 CLI 等价排序（仅当 CLI 支持）。
4. 跑：单测（`library-query.test.mjs` 的排序用例）→ `--only items` 截图。

### 5.3 修改详情里的某个区块

1. 只改 `js/components/item-detail-sections.js` 里对应的 `xxxSection()`（描述 / 效果 / 属性 / 套装 / 获取 / 背景 / 数据来源各一个函数）。
2. 新词表/数值标签 → `js/core/labels.js`（`NUM_ZH` / `NUM_NOTE` / `EFFECT_CAT_ZH`）；不要在区块里硬编码中文键名。
3. 新图标 → `js/core/icons.js` 登记。
4. 跑：`node qa/shot.js --only item-detail --theme dark/light` → `node qa/interactions.js` → `python qa/audit.py`。

### 5.4 添加一个独立领域

1. `js/domains.js` **加一项**（id / zh / title / icon / path / shortcut / styles / load / purpose）。
2. 新建 `js/views/<id>.js`：导出 `mount(rootEl, ctx)`，需要处理同领域路由时返回 `{ onRoute(ctx), unmount() }`（`unmount` 必须幂等）。
3. 新建 `css/view-<id>.css`：只引用 `css/tokens.css` 的变量，颜色不许写字面量。
4. **不需要改**：`index.html`、`js/core/router.js`、`js/main.js`（导航、标题、Alt+数字、样式注入、未知领域兜底全部自动）。
5. 跑：`node --test "qa/tests/*.test.mjs"`（含架构守卫）→ `node qa/shot.js --theme dark/light` → `node qa/interactions.js` → `python qa/audit.py`。

### 5.5 新增一个实验室面板

1. `js/views/lab.js` 的 `PANELS` **加一项** `{ id, zh, icon, title, paramKeys, create(model, deps) }`——seg 按钮、标题、懒创建、显隐、URL 参数清理都由注册表完成。
2. 新建 `js/lab/<panel>.js`，导出 `createXxx(model, deps)`，返回面板实例契约：
   `{ el, mount?(), refresh?(), applyParams?(params), activate?(), destroy?() }`（用 `createScope` 管订阅、`createRefresh` 管合并刷新）。
3. 样式写进 `css/view-lab.css`（沿用 `.lab-*` / `.panel` 既有类）；需要面板间跳转用 `deps.openPanel(id)`。
4. 跑：`node qa/shot.js --only lab --theme dark/light` → `node qa/interactions.js` → `LAB_QA_BASE=… node qa/tests/lab-async.browser.mjs`。

### 5.6 添加需要持久化的用户偏好

1. `js/core/store.js`：在 `KEY` 里加键或复用 `KEY.ui`（**不新增 localStorage key**，除确有必要）；读取走白名单归一（非法值回退默认，合法值保留），写入走 `writeJSON`（失败自动 emit `storage-error` → 顶栏 toast）。
2. 视图只通过 `store.ui` / store 方法读写，并用 `store.on('ui', …)` 订阅（返回退订函数，`unmount` 里释放）。
3. `qa/tests/store.test.mjs` 加一条「脏值不崩 + 合法值保留」用例。
4. 跑：`node --test "qa/tests/*.test.mjs"` → 相关视图截图。

---

## 6. 验收（改完必须全绿）

```bash
node --test "qa/tests/*.test.mjs"            # 单元 + 架构守卫（含依赖方向/循环/单一实现）
node qa/shot.js --theme dark                 # 54 项：路由×视口 + console/4xx 门禁
node qa/shot.js --theme light
node qa/interactions.js                      # 67 项真实交互
python qa/audit.py                           # 静态审计（硬编码色/裸英文/重复标题/a11y）
node qa/theme-contrast.mjs                   # 130 组 WCAG AA
node qa/tests/lifecycle.browser.mjs          # 生命周期/竞态/损坏 localStorage（25）
node qa/tests/lab-async.browser.mjs          # 实验室分帧计算版本控制（8）
```

浏览器用例需要先 `python serve.py`（默认 8777）。数据侧另跑 `python pipeline/mk_builds_json.py --check`、
`python pipeline/sync-data.py --check`。

---

## 7. 边界（明确不做）

- 不引入 TypeScript / React / Vue / 打包器 / 依赖注入框架 / 运行时插件系统。
- 不为「行数好看」拆文件：拆分的唯一理由是**减少耦合、缩小改动范围、能独立测试**。
- 不把实验室引擎口径、流派评分表、游戏数据语义抽成「通用抽象」。
- 不新增 localStorage key、不改 hash 路由形态、不改 GitHub Pages 子路径相对路径约定。
- 不在视图里直接 `fetch` / 读写 `localStorage` / 自己拼浮层。
