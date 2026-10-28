# AGENTS.md — 给 AI 的入口（先读这个）

> 本仓库是《遗迹2》本地离线知识站 **遗物档案 · RELIC ARCHIVE**。
> 纯静态、无构建步骤、无 npm 依赖；数据与图标随仓库分发。
> 在线：https://stollor.github.io/relic-archive/ · 仓库：https://github.com/stollor/relic-archive

如果你是接手的 AI：按下面顺序读，5 分钟内能开始正确干活。

---

## 0. 30 秒速览

```
relic-archive/
├─ index.html lab.html      两个静态页（SPA 外壳 + 旧链接跳转页）
├─ css/ js/                 站点源码：tokens/base/components + 4 个 view；domains.js + core/ + components/ + views/ + 领域模块（library/builds/lab）
├─ data/                    运行时数据（8 个 JSON + codex/）——页面 fetch ./data/*.json
├─ assets/icons/            1004 张 PNG（页面经 api.iconUrl 用 ./assets/icons/*.png）
├─ docs/                    UX_SPEC（交互）/ ARCHITECTURE（分层与配方）/ DATA / DEPLOY / LESSONS / screenshots
├─ pipeline/                builds.json 生成器 + 工作区数据同步（开发用）
├─ qa/                      零依赖验收（截图/交互/审计/对比度）+ REPORT.md
├─ serve.py start.cmd       本地静态服务器（Python 标准库）/ Windows 启动脚本
└─ README.md CHANGELOG.md
```

- 技术栈：原生 ES module + 原生 CSS + Python 标准库 HTTP server。**没有任何打包器**。
- 四个领域：`#/items` 资料库、`#/lab` 实验室、`#/builds` 流派、`#/codex` 知识库。
- 两套主题：`html[data-theme="dark"|"light"]`；颜色只有一个来源 `css/tokens.css`。
- 工作区（另一个目录 `.mimocode/`）放解包工具链与原始资产，**不在本仓库**；见 §7。

---

## 1. 必跑命令

```bash
# 本地跑起来
python serve.py                    # → http://127.0.0.1:8777/
python serve.py --port 8780

# 四套门禁（改完代码/数据必须全绿再提交）
node qa/shot.js --theme dark       # 54 项：27 路由 × 1440/390，含 console/异常/4xx 门禁
node qa/shot.js --theme light      # 54 项：同上，亮色
node qa/interactions.js            # 67 项真实交互（含流派 7 项、主题三态、移动端）
python qa/audit.py                 # 静态审计：硬编码色/裸英文/重复标题/a11y
node qa/theme-contrast.mjs         # 130 组 WCAG AA 对比度

# 数据侧自检
python pipeline/mk_builds_json.py --check    # 流派数据引用完整性
python pipeline/sync-data.py --check         # 仓库快照 vs .mimocode 工作区 是否有漂移（只读）

# 回归测试（零依赖；浏览器用例需先 python serve.py）
node --test "qa/tests/*.test.mjs"            # JS 单元 + 架构守卫（依赖方向/循环/单一实现）
node qa/tests/lifecycle.browser.mjs          # 页面生命周期/竞态/损坏 localStorage 恢复
node qa/tests/lab-async.browser.mjs          # 实验室分帧计算：版本控制/取消/最后条件生效
python -m unittest discover -s qa/tests -p "test_*.py" -v   # sync-data.py 同步语义
```

期望结果：`54/54 × 2`、`67/67`、`0 FAIL`、`130/130`；回归测试 `node --test` 全绿、
两个浏览器用例 `PASS=n FAIL=0`、Python `OK`。任何一项红的都 **不要提交**。
注意 `node --test qa/tests/`（目录参数）在 Node 24+ 会报 MODULE_NOT_FOUND，用上面的 glob 写法。

---

## 2. 修改前先读的契约

| 你要改什么 | 先读 | 关键约束 |
|---|---|---|
| 页面布局 / 交互 / 组件 | [`docs/UX_SPEC.md`](docs/UX_SPEC.md) | 一个动作一种意图；详情/抽屉/弹窗/Toast/选择器全站唯一组件 |
| **代码怎么分层 / 加功能改哪里** | [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | 依赖方向、路由归属、共享能力、六类高频任务的扩展配方 |
| 数据字段 / 数据来源 | [`docs/DATA.md`](docs/DATA.md) | 不编造数据；无来源标「待验证」；纯文本实体不许伪造 id |
| 部署 / 发布 / 域名路径 | [`docs/DEPLOY.md`](docs/DEPLOY.md) | GitHub Pages 子路径；相对路径规则；推送用系统 Git |
| 踩过的坑 / 为什么这样设计 | [`docs/LESSONS.md`](docs/LESSONS.md) | 先看再动，能省掉重复踩坑 |
| 验收标准 / 历史结果 | [`qa/REPORT.md`](qa/REPORT.md) | 门禁脚本与断言清单 |

---

## 3. 高频任务配方

### 3.1 加一件道具 / 改道具数据（不改代码）
数据来自上游解包链，本仓库只保存快照。**不要手改 `data/items.json` 的语义字段**；
如果只是本地验证，改完后跑 `python pipeline/sync-data.py --check` 会发现"快照与工作区不一致"，
说明真正的数据源在 `.mimocode/data/`（见 §7）。正确流程见 [`docs/DATA.md`](docs/DATA.md) §4。

### 3.2 改/加一篇知识库文章
直接编辑 `data/codex/index.json`（内容与视图分离，刷新即生效）。
字段：`categories[]`、`articles[]`（`id/cat/title/order/lede/blocks[]`，block 类型见 `js/views/codex.js`）。

### 3.3 改流派（7 套配装）
源数据在 `pipeline/_source/{ui_data,loadouts,builds}.json` → 生成 `data/builds.json`：

```bash
python pipeline/mk_builds_json.py --check   # 先校验
python pipeline/mk_builds_json.py           # 写 data/builds.json
node qa/shot.js --theme dark --only builds  # 看 7 套详情是否还正常
```

引用规则：槽位里的每个引用要么能在 `data/items.json` 找到真实 id，要么在 `_source/builds.json`
的 `i18n` 里登记过（纯文本实体：遗物碎片 / 棱镜传奇词条）。`--check` 会逐条列出坏引用。

### 3.4 新增主题色 / 调整配色
只改 `css/tokens.css`：暗色在 `:root`，亮色在 `html[data-theme="light"]`，**同名变量成对给值**。
不要在别的 CSS/JS 里写 `#hex`/`rgba()`（`audit.py` 会报 FAIL + `theme-contrast.mjs` 管对比度）。

### 3.5 加一个图标
`js/core/icons.js` 的 `ICONS` 登记一条 24×24 内联 SVG（`path` 片段），全站可用；`icon('名字', {size})`。

### 3.6 新页面 / 新领域 / 加筛选排序 / 改详情区块 / 加实验室面板
**先读 [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) §5「六类高频任务配方」**，那里有逐步的「改哪里 → 复用什么 → 跑哪些测试」。

最短版：
- **新领域**：`js/domains.js` 加一项 → 新建 `js/views/<id>.js`（导出 `mount(rootEl, ctx)`）+ `css/view-<id>.css`。
  **不用改** `index.html` / `js/core/router.js` / `js/main.js`（导航、标题、快捷键、样式注入自动生效）。
- **加筛选 / 加排序**：`js/library/query.js`（状态 + 序列化 + 匹配 / `SORT_DEFS`+`NUM_SORT`）→ `js/views/library.js` 接线 → `qa/tests/library-query.test.mjs`。
- **改详情区块**：`js/components/item-detail-sections.js` 的对应 `xxxSection()`（词表在 `js/core/labels.js`）。
- **加实验室面板**：`js/views/lab.js` 的 `PANELS` 加一项 + 新建 `js/lab/<panel>.js`（实例契约见 ARCHITECTURE §5.5）。
- **加用户偏好**：只走 `js/core/store.js`（不新增 localStorage key），并补 `qa/tests/store.test.mjs` 用例。

### 3.7 发布
```bash
git add -A && git commit -m "feat: ..."
python pipeline/deploy.py        # 推送 + 等 Pages 自动重建 + 线上冒烟（推荐）
```
GitHub Pages 会自动重建（约 20–60 秒，legacy 构建，无 CI）。`deploy.py` 会校验远端 sha、轮询线上内容指纹确认真的换了版本，
再跑线上 `qa/shot.js`；失败给出退出码（2 预检 / 3 推送 / 4 发布超时 / 5 sha 不一致 / 1 冒烟）。
手动等价：用系统 Git `push origin main` 后执行 `python pipeline/deploy.py --verify-only`。
⚠️ 本机推送必须用系统 Git（见 LESSONS #3），脚本已自动优先选它。

---

## 4. 不变量（违反即返工）

1. **无构建**：不引入 npm/打包器/框架/外部字体/CDN；新增依赖等于破坏项目形态。
2. **颜色只来自 `css/tokens.css`**；视图 CSS 禁止颜色字面量。
3. **数据只能经 `js/core/api.js`**；视图禁止直接 `fetch`。
4. **状态只能经 `js/core/store.js`**；不新增 `localStorage` key（主题在 `r2.v2.ui.theme`）。
5. **组件唯一**：详情、抽屉、弹窗、Toast、选择器不得在视图里重复实现。
6. **中文优先**：用户可见文案简体中文；英文仅限道具英文名副标题、证据/原文折叠区、代码标识符。
7. **不编造数据**：无来源写「待验证」；纯文本实体（碎片/传奇词条）保持无 id。
8. **不提交二进制噪音**：`qa/shots/`、`__pycache__/`、日志已在 `.gitignore`；发布图放 `docs/screenshots/`。
9. **不提交凭据**：token/密钥永不入库；推送用凭据管理器或 SSH。
10. **路由只分发一次**：只有 `js/main.js` 订阅 `router.onChange`；视图只实现 `onRoute(ctx)`，不得自行再订阅。
11. **地址栏只有 `js/core/router.js` 能写**：导航用 `router.go`，装饰性同步（如详情深链）用 `router.replaceSilently`；
    详情组件不拥有 URL，浮层打开/关闭的地址栏同步归调用方视图。
12. **共享能力只有一个实现**：空态用 `js/components/states.js`、面板骨架用 `js/components/panel.js`、
    道具文本规则用 `js/core/labels.js`、异步/清理用 `js/core/task.js`；领域清单只在 `js/domains.js`。
    这四条由 `qa/tests/architecture.test.mjs` 自动守卫，红了不要绕过。

---

## 5. 代码地图（按改动频率）

| 路径 | 作用 |
|---|---|
| `js/main.js` | 启动、导航渲染、路由派发、视图生命周期、错误边界 |
| `js/domains.js` | **领域注册表（唯一来源）**：导航/标题/快捷键/视图与样式加载 |
| `js/core/router.js` | hash 路由（不认识具体领域；`go` / `setQuery` / `replaceSilently`） |
| `js/core/api.js` | 唯一数据入口：`items/builds/codex/site_data/…` + 派生（套装/图标/实体解析） |
| `js/core/store.js` | 唯一 localStorage 入口（owned/fav/build/saved/ui） |
| `js/core/theme.js` + `js/theme-boot.js` | 三态主题、Alt+T、meta theme-color；首屏防闪 |
| `js/core/ui.js` | Toast / 确认框 / 抽屉 / 弹窗 / 悬浮说明 |
| `js/core/icons.js` | 内联 SVG 图标库（唯一来源） |
| `js/core/labels.js` | 中文词表 + 道具展示文本规则（`zhDisplay`/`EFFECT_CATS`/`FAMILY_GROUPS`） |
| `js/core/task.js` | 代际 / 分帧任务 / 合并刷新 / 清理域 |
| `js/components/states.js` `panel.js` | 空态/错误/载入、面板骨架（唯一实现） |
| `js/components/item-detail.js` + `item-detail-sections.js` | 全站唯一道具详情（外壳 / 各内容区块） |
| `js/components/picker.js` | 全站唯一装备选择器 |
| `js/views/{library,lab,builds,codex}.js` | 四个领域视图的**装配**（逻辑在领域目录） |
| `js/library/{query,present,export}.js` | 资料库纯函数：状态+过滤排序 / 展示模型 / CLI 导出 |
| `js/builds/{ui,list,detail}.js` | 流派：共用小件 / 列表页 / 详情页 |
| `js/lab/*` | 实验室引擎（engine/model/state）+ 工作台（workbench/wb-*）+ 各面板 |
| `css/tokens.css` | 设计变量（双主题唯一色值来源） |
| `data/` | 运行时数据（见 `docs/DATA.md` §2） |
| `pipeline/` | 数据生成/同步（开发用，不参与运行时） |
| `qa/` | 验收脚本与报告（不参与运行时） |

---

## 6. 已知坑速查（完整版见 [`docs/LESSONS.md`](docs/LESSONS.md)）

- GitHub Pages 部署在 **子路径** `/relic-archive/`：所有资产必须用相对路径（`./data/`、`./assets/`）；绝对 `/data/` 会 404。
- Pages 用 **legacy + `.nojekyll`**：否则 Jekyll 会忽略 `_` 开头的目录（如 `pipeline/_source/`）。
- 本机 `git push` 用 **`C:\Program Files\Git\cmd\git.exe`**；DSH 自带 ucrt64 git 上传会卡死（dry-run 却正常）。
- `qa/interactions.js` 的页面内 import 是根路径（`/js/...`），只适合对本地根路径跑；线上子路径只能跑 `qa/shot.js --base`。
- `data/builds.json` 的 `armor.weight_class` 有源数据重复词（「轻 轻量」），视图侧归一化显示，**不要回写数据**。
- 29 个纯文本实体（碎片/棱镜传奇词条）没有本地 id：显示只读 chip，点不开详情，这是正确行为。
- 移动端顶栏 4 个领域入口必须保持 ≥32×32 点击区（`interactions M5` 会抽检）。

---

## 7. 与 `.mimocode` 工作区的关系

本仓库是**发布快照**；上游解包/配装工具链在 `.mimocode/`（不在本仓库、也不在 GitHub）。

```
.mimocode/
├─ relic-archive/   ← 本仓库（数据/图标快照 + 页面 + QA + 数据生成脚本）
├─ data/            ← 工作区权威数据（生成源数据 / 生成物 / rmn2.db）
├─ assets/icons/    ← 图标工作副本
├─ build/           ← 配装/护甲流水线（产出 ui_data.json / loadouts.json / builds.json）
├─ tools/           ← 解包/解码/CLI
├─ extract/ extract_icons/ archive/   ← 原始资产与历史（数 GB，不进 git）
└─ AGENTS.md        ← 工作区级的 AI 入口（怎么更新站点数据、跑上游链）
```

站点数据更新：上游产出 → `python pipeline/sync-data.py` → `python pipeline/mk_builds_json.py` → 门禁 → 提交。
详见 [`pipeline/README.md`](pipeline/README.md) 与 `.mimocode/AGENTS.md`。

---

## 8. 提交与发布约定

- 提交信息用中文 + conventional 前缀：`feat:` / `fix:` / `docs:` / `data:` / `deploy:` / `chore:`。
- 一次提交只做一件事；数据更新与页面改动分开提交。
- 改 UI/交互必须同步更新 `docs/UX_SPEC.md`；改数据格式必须同步更新 `docs/DATA.md`。
- 发布 = `git push origin main`；Pages 自动重建；线上跑一遍 `qa/shot.js --base`.
