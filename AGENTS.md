# AGENTS.md — 给 AI 的入口（先读这一页）

> 本仓库是《遗迹2》本地离线知识站 **遗物档案 · RELIC ARCHIVE**：纯静态、零构建、无 npm 依赖；数据与图标随仓库分发。
> 在线：https://stollor.github.io/relic-archive/ · 仓库：https://github.com/stollor/relic-archive
>
> **默认只读两页就能开工**：本页（规则 + 任务路径）→ [`docs/AI_MAP.md`](docs/AI_MAP.md)（模块在哪、改哪、依赖谁、跑什么）。
> 遇到报错先查 [`docs/TROUBLESHOOTING.md`](docs/TROUBLESHOOTING.md)。契约细节按 §2 链接按需读，**不要先通读全部 docs**。

## 0. 30 秒速览

- 是什么：四领域静态 SPA —— `#/items` 资料库 / `#/lab` 实验室 / `#/builds` 流派 / `#/codex` 知识库；亮暗双主题。
- 技术栈：原生 ES module + 原生 CSS + Python 标准库（`serve.py`）。**无打包器、无框架、无 npm、无联网请求、无外部 CDN/字体。**
- 数据：`data/` 9 个 JSON + `assets/icons/*.png` 随仓库分发，页面用相对路径 `./data/*`、`./assets/*` 读取。
- 入口：`index.html`（SPA 外壳）+ `serve.py`（本地服务）+ `verify.ps1`（pwsh 包装）/ `node qa/gate.mjs`（验收）。
- 环境：Node 22+、Python 3.10+、Chrome（仅浏览器检查需要）；无 `npm install`，改完刷新即可。
- 关键入口文件：`js/main.js`（启动/派发）、`js/domains.js`（领域表）、`js/core/api.js`（数据）、`js/core/store.js`（状态）、`qa/gate.mjs`（验收）。
- 目录：`js/`（core/components/views + 领域目录 library/builds/lab + domains.js/main.js）· `css/` · `data/` · `pipeline/` · `qa/` · `docs/`。
- **硬禁止**：引入依赖/构建步骤；写死颜色（只允许 `css/tokens.css`）；视图直接 `fetch`/`localStorage`；新增领域绕过 `js/domains.js`。
- **事实源**：代码 > [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)（分层规则）> [`qa/README.md`](qa/README.md)（门禁清单）。测试数字只在 `qa/baselines.json`，本页不抄。

## 1. 统一验收（只有一个入口，不要再背/拼命令）

| 何时 | 命令 | 说明 |
|---|---|---|
| 改完先跑 | `.\verify.ps1 quick`（或 `node qa/gate.mjs quick`） | 无浏览器；单元 + 审计 + 对比度 + 数据契约 |
| 小步验收 | `.\verify.ps1 related` | 按改动文件自动挑相关检查 |
| 提交前 | `.\verify.ps1 full` | 完整回归，含真实 Chrome 截图/交互/竞态/子路径 |
| 只改数据/生成链 | `.\verify.ps1 data` | Schema/引用/工作区漂移/数据脚本单测 |
| 发布前 | `.\verify.ps1 deploy` | full + `deploy.py --dry-run` 预检（不推送） |
| 性能前后对比 | `.\verify.ps1 perf`（或 `node qa/perf.mjs --all --compare`） | S1–S8 基准；**参考指标不设阈值、不进 full**；基线 `qa/perf-baseline.json`，口径见 [`docs/PERF.md`](docs/PERF.md) |
| 看某模式会跑什么 | `node qa/gate.mjs --list full` / `node qa/gate.mjs --help` | 检查清单唯一来源：`qa/gate/registry.mjs` |

- `verify.ps1` 是 `node qa/gate.mjs` 的 PowerShell 7 薄包装；任意 shell 直接 `node qa/gate.mjs <mode>`。门禁自己起 `serve.py`（随机端口），不需要预先起服务。
- 退出码：`0` 通过 / `1` 有失败 / `2` 用法或致命错误 / `3` 关键检查因环境不具备被跳过（**不算通过**）。
- 判定：`quick` 必须 PASS 才继续；`related`/`full` 全绿才提交；`deploy` 全绿才发布。SKIP 必须读原因（独立 clone 缺上游工作区属预期；缺 Chrome 属环境阻断）。
- 基线：通过数/跳过数只看门禁输出与 `qa/baselines.json`（本页不写死数字）。**禁止**为通过而删测试/放宽断言；有意增减用例用 `--update-baseline` 并在提交信息说明。
- 提交：`git status` 只含预期文件；一次只做一件事；提交信息中文 + conventional 前缀（`feat:`/`fix:`/`docs:`/`data:`/`deploy:`/`chore:`）。发布见 [`docs/DEPLOY.md`](docs/DEPLOY.md) §2。
- 失败怎么读：门禁控制台已给「检查 → 模块 → 失败用例 → 日志尾部 → 复跑命令」；机器可读结果在 `qa/results/gate.json`，单检查完整日志在 `qa/results/logs/<id>.log`（生成物不入库）。
- 只想复跑一部分：`node qa/gate.mjs <mode> --only a,b` / `--skip a,b`；`--list` 看 id，`--verbose` 看实时输出。
- 生成物：`qa/results/*`（gate.json/logs）与 `qa/shots/*` 均 gitignored，可随时重跑；不要提交。

### 1.1 改动类型 → 最少验收（AI 必跑）

| 你改了什么 | 最少验收 | 提交前 |
|---|---|---|
| UI / 布局 / 组件 / CSS | `related`（审计/对比度/截图/对应交互） | `full` |
| 状态 / 持久化 | `related`（单元 + lifecycle） | `full` |
| 数据 / 生成链 | `data` | `full` |
| 路由 / 导航 / 领域 | `related`（nav + lifecycle + 深链） | `full` |
| 计算引擎 / 实验室 | `related`（lab-engine 单测 + lab-async） | `full` |
| 测试设施本身 | `related`（unit-js/unit-py 自检） | `full` |
| 发布 | `deploy` | — |

## 2. 任务 → 最小阅读路径（只读这 1–2 个文件就能正确开工）

| 任务 | 先读（1–2 个文件） | 最短操作 | 验收 |
|---|---|---|---|
| 改资料库 UI / 筛选 / 排序 | `docs/UX_SPEC.md` 对应节 + [`js/library/query.js`](js/library/query.js) | 改 query 纯函数 → [`js/views/library.js`](js/views/library.js) 接线 → 补 `qa/tests/library-query.test.mjs` | `related` |
| 改道具详情 / 共享组件 | [`js/components/item-detail-sections.js`](js/components/item-detail-sections.js) + [`js/core/labels.js`](js/core/labels.js) | 只改对应 `xxxSection()`；词表进 labels；不要新建第二份浮层 | `related` |
| 改流派页 | [`js/builds/list.js`](js/builds/list.js) 或 [`js/builds/detail.js`](js/builds/detail.js) + [`js/views/builds.js`](js/views/builds.js) | 区块在 list/detail，装配留在 view | `related` |
| 改实验室页 / 加面板 | [`js/views/lab.js`](js/views/lab.js) + [`js/lab/workbench.js`](js/lab/workbench.js) | `PANELS` 加一项 + 新建 `js/lab/<panel>.js`（实例契约见 ARCHITECTURE §5.5） | `related` |
| 新领域 | [`js/domains.js`](js/domains.js) | 加一项 + 新 `js/views/<id>.js` + `css/view-<id>.css`；**不改** main/router/index | `related` |
| 改状态 / 持久化 | [`js/core/store.js`](js/core/store.js)（+ [`js/lab/state.js`](js/lab/state.js)） | 白名单归一到 store；订阅成对释放；写失败走 `storage-error` | `related` |
| 改路由 / 应用壳 | [`js/main.js`](js/main.js) + [`js/core/router.js`](js/core/router.js) | 只有 main 订阅 `router.onChange`；导航用 `router.go`/`replaceSilently` | `related` |
| 改数据 / 生成链 | [`docs/DATA.md`](docs/DATA.md) §4 + `pipeline/_source/` | `sync-data --check` / `mk_builds_json --check` → 生成 → `data` | `data` |
| 加 / 改测试 | [`qa/README.md`](qa/README.md) §6 + [`qa/gate/registry.mjs`](qa/gate/registry.mjs) | 加测试 → registry → plan → `--update-baseline` | `related` |
| 发布 | [`docs/DEPLOY.md`](docs/DEPLOY.md) §2 | `deploy` → 提交 → `python pipeline/deploy.py` | `deploy` |
| 新人 / 新 AI 接手 | 本页 + [`docs/AI_MAP.md`](docs/AI_MAP.md) | 先跑 `quick` 建立环境基线；按本表找落点 | `quick` |

阅读策略：先在本表找到「任务行」→ 只读该行「先读」的 1–2 个文件与 `docs/AI_MAP.md` 对应模块行 → 动手 → 跑该行验收命令。
不要预读 `docs/UX_SPEC.md`/`docs/LESSONS.md` 全文；只有当任务落在对应契约（交互/踩坑/发布）时再读对应章节。规则冲突时以代码与 `docs/ARCHITECTURE.md` 为准，本文只做导航。

## 3. 不变量（12 条；违反 = 返工；分层细则与守卫见 [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) §1/§4）

1. **无构建**：不引入 npm/打包器/框架/外部字体/CDN——新增依赖即破坏项目形态。
2. **颜色只来自 `css/tokens.css`**：视图 CSS 禁止颜色字面量。
3. **数据只经 `js/core/api.js`**：视图禁止直接 `fetch`。
4. **状态只经 `js/core/store.js`**：不新增 localStorage key（主题在 `r2.v2.ui.theme`）。
5. **组件唯一**：详情/抽屉/弹窗/Toast/选择器不得在视图重复实现。
6. **中文优先**：用户可见文案简体中文；英文仅限道具英文名、证据/原文折叠区、代码标识符。
7. **不编造数据**：无来源写「待验证」；纯文本实体（碎片/传奇词条）保持无 id。
8. **不提交二进制噪音**：`qa/shots/`、`__pycache__/`、日志在 `.gitignore`；发布图放 `docs/screenshots/`。
9. **不提交凭据**：token/密钥永不入库。
10. **路由只分发一次**：只有 `js/main.js` 订阅 `router.onChange`；视图只实现 `onRoute(ctx)`。
11. **地址栏只有 `js/core/router.js` 能写**：导航用 `router.go`，装饰性同步用 `router.replaceSilently`；详情组件不拥有 URL。
12. **共享能力只有一个实现**：空态 `js/components/states.js`、面板 `js/components/panel.js`、文本规则 `js/core/labels.js`、异步/清理 `js/core/task.js`、领域表 `js/domains.js`；`qa/tests/architecture.test.mjs` 自动守卫。

## 4. 模块地图（职责/入口/依赖/必跑测试的详表见 [`docs/AI_MAP.md`](docs/AI_MAP.md)）

| 路径 | 作用 |
|---|---|
| `js/main.js` + `js/domains.js` | 应用壳：启动、领域表、路由派发（代际化）、导航/标题/快捷键、错误边界 |
| `js/core/*` | 基础能力：`router` `api` `store` `ui` `dom` `labels` `task` `icons` `theme`（**core 只能依赖 core**） |
| `js/components/*` | 唯一共享 UI：`item-detail(+sections)` `picker` `item-card` `states` `panel` |
| `js/views/*.js` | 四个领域视图的**装配**（业务逻辑在领域目录） |
| `js/library/*` `js/builds/*` | 领域模块（纯函数优先，可直接 `node --test`） |
| `js/lab/*` | 实验室引擎/状态/工作台（`wb-*`）/五个面板 |
| `css/*` | `css/tokens.css` 唯一色值来源；`css/base.css`/`css/components.css`/`css/view-*.css` 分层 |
| `data/*` + `assets/icons/*` | 运行时数据与图标（结构契约 `qa/lib/data-schema.mjs`） |
| `pipeline/*` | `pipeline/sync-data.py` 快照同步、`pipeline/mk_builds_json.py` 流派生成、`pipeline/deploy.py` 一键发布 |
| `qa/*` | 统一门禁 `qa/gate.mjs` + `qa/gate/*` + 测试能力 + `qa/baselines.json` |
| `serve.py` `verify.ps1` `index.html` | 本地服务 / pwsh 验收包装 / 站点入口 |
| `docs/*` | 契约与经验：UX_SPEC·ARCHITECTURE·DATA·DEPLOY·LESSONS·AI_MAP·TROUBLESHOOTING |

新增顶层文件/目录前：先在 [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) §1 的分层表与 `qa/tests/architecture.test.mjs` 的层规则里登记，否则架构守卫会红。

## 5. 已知坑（只会立刻踩到的 8 条；完整清单见 [`docs/TROUBLESHOOTING.md`](docs/TROUBLESHOOTING.md) → [`docs/LESSONS.md`](docs/LESSONS.md) §2）

- 必须经本地服务器访问：`file://` 会拦 ES module / `fetch`；启动用 `python serve.py`。
- GitHub Pages 部署在子路径 `/relic-archive/`：所有资源必须相对路径（`./data/`、`./assets/`）；本地用 `python serve.py --prefix /relic-archive` 提前暴露绝对路径 404。
- Chrome 路径不要硬编码：系统探测 → `CHROME_PATH` → `node qa/shot.js --chrome <path>`。
- `node --test qa/tests/`（目录参数）在 Node 24+ 报 `Cannot find module`；用 glob：`node --test "qa/tests/*.test.mjs"`。
- 数据两处、方向唯一：只改上游工作区，用 `pipeline/sync-data.py` 同步；`--check` 报漂移先分清「真实内容差异」与「CRLF/LF 换行差异」（见排障 T8/T9）。
- localStorage 读到的都当脏数据：store 白名单归一/迁移守卫；写失败必须通过 `storage-error` 可见。
- 不要造第二套共享能力：空态/面板/文本规则/异步清理/领域表各有唯一权威，`qa/tests/architecture.test.mjs` 会红。
- 本机 `git push` 卡死是 ucrt64 git 上传问题：用系统 Git `C:\Program Files\Git\cmd\git.exe`（或 `python pipeline/deploy.py`，它已自动优先系统 Git）。

## 6. 与 `.mimocode` 工作区的关系

本仓库是**发布快照**；上游解包/配装工具链与权威数据在仓库外 `.mimocode/`（不进 git、不在 GitHub）——同步流程与命令见 [`pipeline/README.md`](pipeline/README.md) 与 [`../AGENTS.md`](../AGENTS.md)（工作区入口）。
独立 clone（无 `.mimocode/`）时：站点、`node qa/gate.mjs quick|full` 可跑；`sync-data` 相关检查会 SKIP（预期，不算失败）。
