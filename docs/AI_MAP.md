# AI_MAP — 模块职责、真实依赖与「改它跑什么」

> 这是**导航图**，不是第二套规则：分层规则以 [`ARCHITECTURE.md`](ARCHITECTURE.md) §1/§4 为准，检查清单以 [`../qa/README.md`](../qa/README.md) 为准，基线以 `qa/baselines.json` 为准。
> 依赖方向由 `qa/tests/architecture.test.mjs` 用同一套 import 解析方式（静态/副作用/动态 import，相对路径）自动守卫；本表按真实 import 图核对，改代码后请重跑该测试。
> 用法：在 AGENTS.md §2 找到任务 → 本表定位具体模块与测试；报错查 [`TROUBLESHOOTING.md`](TROUBLESHOOTING.md)。

## 1. 真实依赖方向（违反即 `unit-js` 红）

```
js/main.js + js/domains.js        应用层：可依赖任意层
   └── js/views/*                 视图装配：可依赖 core / components / 本领域与其它领域模块
        └── js/{library,builds,lab}/*   领域模块：可依赖 core / components（lab 可用 components），不得依赖 views
             └── js/components/*  共享 UI：只能依赖 core / components
                  └── js/core/*   基础能力：只能依赖 core（永不向上）
```
- 本仓库无裸模块 import；新增 import 用相对路径且目标文件必须存在。`js/core` 只由 `router/api/store/ui/dom/labels/task/icons/theme` 组成。
- 只有 `js/main.js` 订阅 `router.onChange`；只有 `js/core/router.js` 写 `location.hash`/`history.*`；`js/components/item-detail.js` 不拥有 URL。
- 共享能力唯一实现：空态 `js/components/states.js`、面板 `js/components/panel.js`、文本规则 `js/core/labels.js`、异步/清理 `js/core/task.js`、领域表 `js/domains.js`。

## 2. 模块表（职责 / 对外入口 / 真实依赖 / 改它必跑）

| 模块 | 职责与主要入口 | 真实 import（仓库内） | 改它必跑 |
|---|---|---|---|
| `js/main.js` | 应用壳：启动、导航渲染、dispatch（`createEpoch` 代际化）、主题入口、`storage-error` toast、错误边界 | core/{router,api,store,ui,dom,icons,task}、components/states、domains | `related`（nav + lifecycle）；提交前 `full` |
| `js/domains.js` | 领域表唯一来源：id/标题/图标/路径/快捷键/styles/懒加载；`DOMAINS`/`domainById` | 四个 `views/*` 的 `load()` | `related`（nav + 架构守卫） |
| `js/core/router.js` | hash 解析与导航 API：`go`/`replaceSilently`/`setQuery`/`onChange`/`setTitle`；不认识具体领域 | 无 | `node --test qa/tests/router.test.mjs` + `related` |
| `js/core/api.js` | 唯一数据入口：`api` items/sets/builds/codex/archetypes/siteData/iconUrl/实体解析；相对路径 `./data/*` | `core/dom.js` | `related`（dataapi/nav）；数据改动加 `data` |
| `js/core/store.js` | 唯一 localStorage 入口：owned/fav/build/saved/ui；白名单归一、迁移守卫、`storage-error` | 无 | `node --test qa/tests/store.test.mjs` + `related` |
| `js/core/ui.js` | 浮层生命周期唯一实现：`toast`/`openDrawer`/`openModal`/`confirm`/`showTip` | dom、icons | `related`（interactions/components） |
| `js/core/dom.js` | DOM/格式化工具：`h`/`clear`/`fmt`/`stripTags`/`debounce`/`copyText` | 无 | `node --test "qa/tests/*.test.mjs"`（被大量间接覆盖） |
| `js/core/labels.js` | 中文词表 + 道具展示文本规则：`zhDisplay`/`effectZhSentence`/`EFFECT_CATS`/`FAMILY_GROUPS` | 无 | `related`（interactions-items） |
| `js/core/task.js` | 异步生命周期：`createEpoch`/`createTaskRunner`/`createRefresh`/`createScope` | 无 | `node --test qa/tests/task.test.mjs` + `related` |
| `js/core/icons.js` / `theme.js` / `theme-boot.js` | 内联 SVG 唯一来源 / 三态主题运行时 / 首屏防闪（CSS 之前同步执行） | theme→store；其余无 | `related`（contrast + 截图） |
| `js/components/states.js` `panel.js` | 空/错/载入态；面板骨架 `.panel`（唯一实现） | dom、icons | `related`（components）；架构守卫 |
| `js/components/item-detail.js` + `item-detail-sections.js` | 全站唯一道具详情外壳（弹窗/抽屉）+ 九个内容区块；只开浮层、不写 URL | core/*、item-card、states、labels | `related`（interactions + shot item-detail） |
| `js/components/item-card.js` / `picker.js` | 道具卡与图标元素 / 全站唯一装备选择器 | core/*、labels、item-detail | `related`（interactions） |
| `js/views/library.js` + `js/library/*` | 资料库装配 + 纯函数 `query`（状态/序列化/过滤排序）/`present`（展示规格）/`export`（CLI 导出） | core/*、components/*、library/* | `related`（library + nav） |
| `js/views/builds.js` + `js/builds/*` | 流派装配 + `ui`（共用小件）/`list`/`detail` | core/*、components/*、builds/* | `related`（builds + data-builds） |
| `js/views/lab.js` + `js/lab/*` | 实验室装配（`PANELS` 注册表）/ `engine`（纯计算，口径冻结）/ `model`/`state`/`parts`/`workbench`/`wb-*`/五个面板 | core/*、components/item-detail、picker、lab/* | `related`（lab-async + lab-engine 单测） |
| `js/views/codex.js` | 知识库装配：目录/条目/块渲染（`blocks[].t` 分支） | core/*、components/states、panel | `related`（interactions-codex） |
| `css/*` | `tokens.css` 唯一色值；`base/components/view-*` 分层；视图样式按领域懒注入 | 无 | `related`（audit + contrast + 截图） |
| `data/*` + `qa/lib/data-schema.mjs` | 9 个运行时 JSON（items/builds/site_data/archetypes/codex/terms/item_effects/icon_index/acq）的结构与跨文件引用契约 | `qa/lib/schema.mjs` | `data`（data-schema/data-builds/data-sync） |
| `pipeline/*` | `sync-data.py`（工作区→快照，只读 check/原子落盘/回滚）、`mk_builds_json.py`（`_source`→builds.json）、`deploy.py`（推送+等 Pages+线上冒烟） | 仅标准库 | `data`（数据脚本）；发布 `deploy` |
| `qa/*` | `gate.mjs`+`gate/*` 统一门禁；`lib/` 公共能力；`tests/` 回归；`shot/interactions/audit/contrast` 能力；`baselines.json` 基线 | 内部相对路径 | `related`（qa 改动）；提测 `full` |

> `related` 的「文件前缀 → 检查」映射在 `qa/gate/plan.mjs`（如 `js/lab/**` → lab-async/lab 交互，`qa/**` → unit-js/unit-py）；本表只列**相关测试文件/检查**，不复制清单。

## 3. 数据流（改数据的正确落点）

```
上游 .mimocode/{data,build,assets} ──(pipeline/sync-data.py)──> data/*.json + assets/icons
pipeline/_source/{ui_data,loadouts,builds}.json ──(pipeline/mk_builds_json.py)──> data/builds.json
data/*.json ──(js/core/api.js)──> js/views/* 与 js/{library,builds,lab}/*（页面只经 api 读取）
```
- 不要手改 `data/items.json` 等语义字段；数据契约与漂移检查分别由 `qa/tests/data-schema.test.mjs` 与 `pipeline/sync-data.py --check` 负责。
- 新增数据文件/字段：先改 `qa/lib/data-schema.mjs` 契约 → 再改 `js/core/api.js` 消费端 → 跑 `data`。

## 4. 最小测试映射（按改动挑；完整清单见 `qa/README.md` §3）

| 改动落点 | 优先单跑（调试用） | 提交前 |
|---|---|---|
| `js/core`（router/store/task/dom/labels/icons/theme） | `node --test qa/tests/{router,store,task,architecture}.test.mjs` | `related` → `full` |
| `js/components` `js/views` `css` | `node qa/tests/components.browser.mjs` / `node qa/tests/lifecycle.browser.mjs`（需 `QA_BASE`） | `related` → `full` |
| `js/lab` | `node --test qa/tests/lab-engine.test.mjs` + `node qa/tests/lab-async.browser.mjs`（需 `LAB_QA_BASE`） | `related` → `full` |
| `data/**` `pipeline/**` | `node qa/gate.mjs data`（含 data-schema/data-builds/data-sync/unit-py） | `data` → `full` |
| `qa/**`（测试设施） | `node --test "qa/tests/*.test.mjs"` + `python -m unittest discover -s qa/tests -p "test_*.py"` | `related` → `full` |
| 发布相关（`pipeline/deploy.py`/`.github/**`/Pages 配置） | `python pipeline/deploy.py --dry-run` | `deploy` |

> 浏览器用例若直接单跑，需先起服务：`python serve.py --port 8799`，再用环境变量把地址传给脚本（脚本头注释里有变量名）；更推荐 `node qa/gate.mjs full --only <id>`，门禁会自动起随机端口服务。
