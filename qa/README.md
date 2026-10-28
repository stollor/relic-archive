# QA — 自动化验收与 AI 开发流水线

> 本目录是站点的**唯一验收体系**：所有测试能力（截图/交互/审计/对比度/单元/浏览器回归/数据契约）
> 都由一个入口调度，输出机器可读结果 + 中文摘要 + 失败定位。
> 零依赖：只用 Node 内置模块与 Python 标准库，没有测试框架、没有 npm。

---

## 1. 一条命令

```powershell
.\verify.ps1 quick      # 快速自检：单元 + 静态审计 + 对比度 + 数据契约（无浏览器，目标 <10s）
.\verify.ps1 related    # 按 git 改动文件挑相关回归（quick 基线 + 受影响模块的浏览器用例）
.\verify.ps1 full       # 完整回归：真实 Chrome 截图/交互/竞态/子路径
.\verify.ps1 data       # 数据链路：Schema/引用/工作区漂移/数据脚本单测
.\verify.ps1 deploy     # 发布前：full + deploy.py 预检（不推送）
.\verify.ps1 perf       # 性能基准：真实浏览器冷缓存 S1–S8（参考指标，与 qa/perf-baseline.json 对比）
.\verify.ps1 list full  # 看该模式会跑哪些检查
```

`verify.ps1` 只是 `node qa/gate.mjs` 的 PowerShell 7 包装；任意 shell 直接：

```bash
node qa/gate.mjs quick
node qa/gate.mjs related --changed origin/main
node qa/gate.mjs full --only nav,components
node qa/gate.mjs full --verbose
```

门禁会自己起 `serve.py`（`--port 0` 随机端口，不占用 8777、不需要手动起服务），
并在结束时关闭；`--base` / `--prefix-base` 可复用已在运行的站点。

---

## 2. 六种模式与判定

| 模式 | 内容 | 何时用 |
|---|---|---|
| `quick` | unit-js、audit、contrast、data-builds、data-schema | 每次改完代码先跑；红的不继续 |
| `related` | quick + 按改动文件映射的相关检查（可能含浏览器） | 提交前的小步验收 |
| `full` | 全部检查（含真实 Chrome 截图/交互/lifecycle/lab-async/导航/子路径） | 提交前、发布前 |
| `data` | data-schema、data-builds、data-sync、unit-py | 只改数据/生成链时 |
| `deploy` | full + deploy-preflight（`deploy.py --dry-run`） | 发布前最后一道 |
| `perf` | 性能基准 S1–S8（首屏四领域/JSON 解析/切换/搜索/内存/实验室帧率/4× 节流），与 `qa/perf-baseline.json` 对比；**参考指标不设阈值**，不进 full | 优化前后对比、性能回归排查（手动） |

退出码：`0` 全部通过；`1` 有检查失败；`2` 用法/致命错误；`3` **关键检查因环境不具备被跳过**（不算通过）。
SKIP 分两种：`required`（关键检查被环境阻断 → 退出码 3）与可选（如独立 clone 缺上游工作区 → 不阻断）。
`--allow-missing-chrome` 可把缺 Chrome 降级为允许跳过（只建议在明确不跑浏览器时用）。

---

## 3. 检查清单（registry 唯一来源）

| id | 内容 | 成本 | 依赖 |
|---|---|---|---|
| `unit-js` | `node --test qa/tests/*.test.mjs`：纯函数单测 + 架构守卫 + 数据契约 | fast | — |
| `unit-py` | `unittest discover qa/tests`：数据脚本语义/异常/幂等 | fast | Python |
| `audit` | 静态审计：硬编码色、裸英文、重复标题、a11y、外部网络 | fast | Python |
| `contrast` | 双主题 WCAG AA 对比度（130 组） | fast | — |
| `data-builds` | `mk_builds_json.py --check`：流派引用完整性 | fast | Python |
| `data-schema` | 9 个 JSON 的结构/类型/唯一性/跨文件引用/版本兼容 | fast | — |
| `data-sync` | `sync-data.py --check`：仓库快照 vs 上游工作区漂移 | medium | Python + 工作区（独立 clone 下 SKIP） |
| `shot-dark` / `shot-light` | 27 路由 × 2 视口截图 + console/异常/4xx 门禁 | medium | Chrome + 服务器 |
| `shot-subpath` | 子路径（`/relic-archive/`）下资源加载（Pages 等价） | medium | Chrome + 子路径服务器 |
| `interactions` | 67 项真实交互（桌面/移动/主题/流派/实验室） | slow | Chrome + 服务器 |
| `interactions-items` / `interactions-lab` / `interactions-builds` / `interactions-codex` / `interactions-global` | 分域交互回归（只有 `related` 会按改动挑用，降低单模块改动的验收成本） | medium | Chrome + 服务器 |
| `lifecycle` | 页面生命周期与竞态 G1–G11（dispatch 代际/卸载/损坏 localStorage） | medium | Chrome + 服务器 |
| `lab-async` | 实验室分帧计算 T1–T7（版本控制/取消/最后条件生效/错误恢复） | medium | Chrome + 服务器 |
| `components` | 共享组件行为契约（states/panel 的结构、文本、确定性） | medium | Chrome + 服务器 |
| `nav` / `nav-subpath` | 路由快切/深链刷新/未知领域回退/卸载清理/子路径 | medium | Chrome + 服务器 |
| `perf` | `qa/perf.mjs --all`：冷缓存 S1–S8 中位数（首屏/JSON 解析/切换/搜索/内存/实验室帧率/4× 节流） | manual | Chrome + 服务器（约 3–5 分钟） |
| `deploy-preflight` | 发布预检：分支/工作树/远端（不推送） | fast | Python + git |

`related` 的映射在 [`plan.mjs`](gate/plan.mjs)：文件前缀 → 模块标签 → 检查集合（如 `js/lab/**` → lab-async/lab 交互）。
`--only` / `--skip` 可精确控制；`--list` 会打印本轮计划与实际环境要求。

---

## 4. 目录结构

```
qa/
├─ gate.mjs              统一入口：参数/计划/执行/汇总（本目录唯一命令入口）
├─ gate/
│  ├─ env.mjs            环境探测（node/python/Chrome/git/上游工作区/端口/serve 管理）
│  ├─ registry.mjs       检查清单：怎么跑、怎么解析、失败看哪里、基线
│  ├─ plan.mjs           模式定义 + 改动文件 → 检查的映射
│  └─ report.mjs         TAP/unittest/计数解析 + 中文摘要/失败定位渲染
├─ baselines.json        各检查最低通过数/允许跳过数（防静默删除/跳过）
├─ lib/cdp.js            零依赖 Chrome CDP 客户端 + Chrome 路径探测（唯一实现）
├─ lib/routes.mjs        截图路由表（由真实数据推导；gate 用它算期望条数）
├─ lib/base.js           base URL/子路径前缀工具
├─ shot.js               截图 + 错误门禁（被 gate 调度，也可单跑）
├─ interactions.js       真实交互验收（被 gate 调度，也可单跑；支持子路径 --base）
├─ audit.py / theme-contrast.mjs   静态审计 / 对比度（被 gate 调度）
├─ tests/                纯函数单测（*.test.mjs）、浏览器回归（*.browser.mjs）、Python 用例（test_*.py）
├─ results/              报告产物（全部 gitignored，含时间戳不入库）：gate.json、logs/、audit.json、interactions.json
├─ shots/                截图产物（gitignored，可随时重跑）
└─ _tmp/                 回归测试临时结果/失败截图（gitignored）
```

---

## 5. 报告与失败定位

每次运行写 `qa/results/gate.json`：

```jsonc
{
  "mode": "full",
  "env": { "node": "...", "python": "...", "chrome": {"path": "...", "source": "..."},
           "git": {"sha": "...", "clean": true}, "workspace": {"available": true} },
  "checks": [{
    "id": "nav", "kind": "browser", "status": "FAIL",
    "module": "js/main.js · js/core/router.js · js/domains.js",
    "total": 8, "pass": 7, "fail": 1, "skip": 0,
    "failed": ["N3 …"], "error": "...", "log": "qa/results/logs/nav.log",
    "artifacts": ["qa/_tmp/navigation-result.json"], "hint": "...", "repro": "..."
  }],
  "summary": { "pass": 15, "fail": 1, "skip": 0, "required_skip": 0 }
}
```

控制台摘要同时给：环境（实际执行环境）、逐检查 PASS/FAIL/SKIP 与耗时、失败定位（模块/失败用例/日志/证据/排查入口/复跑命令）。
`qa/results/logs/<id>.log` 保存该检查的完整 stdout/stderr（含执行命令），失败时控制台会直接贴末尾 12 行。

---

## 6. 新增一个检查（保持入口简洁）

1. 在 `qa/tests/` 加测试（纯函数优先；需要浏览器时复用 `qa/lib/cdp.js`，支持 `--base`/`QA_BASE`，
   输出标准汇总行 `[名字] PASS=n FAIL=n SKIP=n` 并用退出码 0/1/2 表达结果）。
2. 在 `qa/gate/registry.mjs` 注册：`run()`（命令）、`parse()`（把输出归一到 total/pass/fail/skip）、
   `module`/`hint`/`repro`/`artifacts`（失败定位）、`cost`、`requires`（chrome/python/workspace）。
3. 在 `qa/gate/plan.mjs` 的 `MODE_CHECKS`（full/data/deploy 等）与 `MODULE_CHECKS`（related 映射）里挂上。
4. 跑 `node qa/gate.mjs full --update-baseline` 写入最低通过数。
5. 在 `qa/README.md` 的检查表与 `AGENTS.md` §1.1 的验收矩阵里各加一行（保持文档与 registry 一致）。

**禁止**：为了通过而删测试/放宽断言/改预期数字；关键测试不得静默跳过（缺环境要 SKIP 并让退出码反映）。

---

## 7. 环境与可移植性

| 能力 | 探测方式 | 缺失时 |
|---|---|---|
| Node | 运行 gate 的 `process.execPath` | 直接报错（gate 本身就需要） |
| Python | `PYTHON` 环境变量 → `python` → `python3` → `py -3`（逐个 `--version` 验证） | 依赖 Python 的检查 SKIP（required） |
| Chrome | `CHROME_PATH`/`CHROME_BIN` → 各平台候选路径（含 Edge/Chromium）→ `where`/`which` | 浏览器检查 SKIP（required，退出码 3；`--allow-missing-chrome` 降级） |
| 上游工作区 | 仓库父目录的 `AGENTS.md` + `data/items.json` | `data-sync` SKIP（可选，不阻断）——独立 clone / CI 的预期情况 |
| 本地服务器 | 自动起 `serve.py --port 0`（子路径用 `--prefix /relic-archive`） | 失败即检查 FAIL，并提示手动验证 `python serve.py` |
| git | `git rev-parse`（gate 只读探测；发布仍走 `pipeline/deploy.py`） | `related` 需要 git；其它模式不受影响 |

**可移植性约定**：测试脚本不得写死 Chrome 路径、不得用根路径 `import('/js/...')`（用 `new URL(...)` 或
`qa/lib/base.js` 的 `prefixOf`）、不得假设端口 8777、不得依赖本机工作区目录。

---

## 8. 一键复跑与常见问题

```bash
node qa/gate.mjs full --only nav                    # 只复跑一个检查
node qa/gate.mjs full --skip shot-light             # 排除慢检查（不建议提交前用）
node qa/gate.mjs related --module lab               # 直接指定模块标签
node qa/gate.mjs quick --verbose                    # 实时看子进程输出
node qa/gate.mjs full --timeout-scale 2             # 慢机器放大超时
```

- **缺 Chrome**：装 Chrome 或 `setx CHROME_PATH "C:\...\chrome.exe"`；CI runner 自带。
- **`data-sync` SKIP**：正常——独立 clone/CI 没有上游 `.mimocode` 工作区；在工作区里跑才会执行。
- **案例数比基线少**：门禁会 FAIL，提示「疑似用例被删除」；确属有意删改用 `--update-baseline` 并在提交信息说明。
- **截图条数不等于期望**：`shot` 会按真实数据推导路由数 × 视口数；少一条说明路由/数据被静默丢弃。
- **端口占用**：gate 用随机端口；手动跑 `serve.py` 才需要指定 `--port`。
