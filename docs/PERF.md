# PERF — 性能基准与优化记录（第四阶段）

> 原则：**有证据才优化，有收益才保留**。本文记录可重复的测量方法、基线数字、每项优化的前后对比，
> 以及「评估后决定不做」的候选（附原因）。
>
> 工具：`qa/perf.mjs`（零依赖，复用 `qa/lib/cdp.js`）；机器可读结果 `qa/results/perf.json`（gitignored）；
> 基线快照 `qa/perf-baseline.json`（入库，`--update-baseline` 维护）。

---

## 1. 怎么测（可重复）

```bash
node qa/perf.mjs --all --update-baseline   # 采一轮基线（会自己起 serve.py --port 0）
node qa/perf.mjs --all                     # 只测量、不写基线
node qa/perf.mjs --scenario S1,S3,S4       # 只跑指定场景
node qa/perf.mjs --compare                 # 与 qa/perf-baseline.json 对比（只打印，不判失败）
node qa/perf.mjs --base http://127.0.0.1:8777   # 复用已运行的服务
```

固定条件：
- 视口 1440×1000、dark（`prefers-color-scheme` 模拟 + `r2.v2.ui.theme=dark`）；
- 每次采样新 Chrome profile + `Network.setCacheDisabled(true)` + `clearBrowserCache`（冷缓存）；
- 固定数据集（结果里记录 `env.dataSha256_16`，数据或代码版本变了要重采基线）；
- 每个场景默认 3 次取**中位数**（`--repeat` 可调）；同一台机器上对比前后才有意义。

场景定义（详见 `qa/perf.mjs` 文件头）：

| 场景 | 测什么 |
|---|---|
| S1 | 首次访问（冷启）四个领域：firstView / DOMContentLoaded / FCP / 请求数 / 传输字节 / JSON 耗时 |
| S2 | JSON fetch + parse + 归一化：注入 `fetch`/`JSON.parse` 计时，拆出解析与「解析完成→首屏」 |
| S3 | 同一页面内各领域首开（懒加载 module/css/data） |
| S4 | 页面切换 items→lab→builds→codex 循环 6 次 |
| S5 | 搜索 / 分类 / 排序 / 组合筛选：事件→DOM 更新（下一帧） |
| S6 | 内存：首屏 GC 后 vs 20 次切换后 GC（JSHeapUsedSize / Nodes / Documents / 图片数） |
| S7 | 实验室穷举：状态栏「用时」+ 墙钟 + rAF 帧间隔（是否卡 UI） |
| S8 | 低性能/移动：390×844 + CPU 4× 节流（S1 items / S3 / S4 子集） |

口径说明（避免误读）：
- 本地 `serve.py` **不做 gzip/brotli**。传输字节与线上 Pages（有压缩）不同，但同一本机前后对比有效；
- 首屏 `firstView` = 导航开始 → `#view-root` 出现对应领域内容且导航高亮；含数据加载与渲染；
- 内存是 `Performance.getMetrics` 的 JSHeapUsedSize（GC 后），非进程 RSS；
- 结果包含机器信息（CPU/内存/Chrome/Node），换机器请重采基线并在报告里注明。

---

## 2. 基线（2026-10-28，优化前）

<!-- PERF-BASELINE:START -->
采集：2026-10-28，`node qa/perf.mjs --all --repeat 3 --update-baseline`，**git worktree @ `14653ce`（优化前 HEAD）**；
机器 i7-12700F / 32GB / Chrome 156 / Win11；视口 1440×1000 dark；冷缓存。
**注意**：采集时本机同时在跑游戏 + IDE（脚本记录 loadMonitor 43–69%），S1/S3 绝对值偏高且波动大；
字节数/请求数/内存/重复计算次数等结构性指标稳定，**优化判断以结构性指标 + 同口径相对变化为准**。

### S1 首次访问（冷启，每领域中位数）

| 领域 | 请求数 | 总传输 | JSON 请求 | JSON 字节 | 首屏 firstView | DCL | FCP | 图片请求 | 可见卡 |
|---|---|---|---|---|---|---|---|---|---|
| items | 76 | 11.32 MB | 3 | 7.82 MB | 211.9 ms | 55.4 | 60 | 46 | 18 |
| lab | 55 | 9.90 MB | 5 | 8.58 MB | 228.9 ms | 59.2 | 60 | 10 | 0 |
| builds | 33 | 8.65 MB | 5 | 8.15 MB | 220.7 ms | 58.5 | 60 | 0 | 7 |
| codex | 25 | 8.31 MB | 4 | 7.90 MB | 202.4 ms | 62.3 | 64 | 0 | 0 |

> 关键异常（P2-2 的入口）：**codex 首屏只依赖 `data/codex/index.json`（78 KB），却因为 boot 无条件
> `await api.ready()` 先下载 items 7.33 MB + effects 0.15 MB + icons 0.52 MB**，共 8.31 MB。

### 其他场景

| 场景 | 指标（中位数） |
|---|---|
| S2 JSON fetch/parse | items fetch 34.7ms / parse 123.9ms（3 个 JSON）；codex parse 127.9ms；解析完成→首屏 43–70ms |
| S3 各领域首开（warm 页面） | items 34.2ms · lab 54.9ms · builds 76.3ms · codex 26.5ms |
| S4 页面切换（24 次） | median 14.4ms · p95 40.4ms |
| S5 搜索/筛选 | 输入 2 字 57.5ms · 4 字 36.8ms · 分类 chip 64.7ms · 排序 96.7ms · 组合筛选 112.1ms |
| S6 内存 | 首屏 heap 11.26 MB → 20 次切换后 13.65 MB（增长 2.40 MB）；DOM 节点 +3；图片 51→51 |
| S7 实验室穷举 | 墙钟 104ms / 状态栏 93ms；6 帧；rAF p95=17.1ms；long task 0 |
| S8 低性能/移动（390×844 + CPU 4×） | items 首屏 729.6ms；S3 items/lab/builds/codex 291.5/353.8/199.4/95.2ms；切换 median 100.8ms、p95 294ms |
<!-- PERF-BASELINE:END -->

---

## 3. 每项优化：证据 → 改动 → 前后对比

<!-- PERF-OPTIMIZATIONS:START -->
每项都按「问题与证据 → 改动 → 前后对比 → 回归」记录；**前后对比用同一份 `qa/perf.mjs`、同一数据哈希**
（before = worktree @`14653ce`；after = 当前工作树）。

### 3.1 按领域启动：boot 不再无条件加载全量 items（P2-2，核心收益）

**问题与证据**：`boot()` 在 `router.start()` 前 `await api.ready()`（items 7.33MB + effects 0.15MB + icons 0.52MB）。
四领域直链首视图前都下载 8.0MB；而 `#/codex` 首屏只依赖 `codex/index.json`（78KB）。S2 实测 codex JSON 解析 127.9ms。

**改动**（`js/main.js` + `js/domains.js` +3 行）：
- `boot()` 立即 `router.start()`，数据由各视图按需加载；页脚统计改为首屏后异步填充（失败不写 0/空）；
- `dispatch()` 并行「模块/CSS 加载」与「数据 ready」；领域表新增 `codex.bootstrap=false`（注册表仍是唯一来源），
  其余领域在 mount 前 `await api.ready()`（含 icons，避免图标占位闪替）；
- 从 codex 点进 items/lab/builds 时同一分支保证数据就位；失败走既有 `failDispatch`（可重试错误态）；
- `api.js` 未改（保持 `cache:'no-cache'` + Map 去重 + 数据哈希由 perf 记录，不引入 IndexedDB/分片）。

**前后对比（S1 冷启，同负载窗口 ~60%）：**

| 领域 | 请求数 | 总传输 | JSON 请求 | JSON 字节 | firstView |
|---|---|---|---|---|---|
| **codex** | **25 → 22（-12%）** | **8111.9 → 298.8 KB（-96.3%）** | **4 → 1** | **7899.5 → 77.3 KB（-99.0%）** | **202.4 → 77.7 ms（-61.6%）** |
| items | 76 → 76 | 11056.1 → 11069.2 KB（+0.1%） | 3 → 3 | 7822.5 → 7823.2 | 211.9 → 200.1（-5.6%） |
| lab | 55 → 55 | 9677.4 → 9690.7 KB（+0.1%） | 5 → 5 | 8583.2 → 8584.5 | 228.9 → 220.4（-3.7%） |
| builds | 33 → 33 | 8444.6 → 8454.7 KB（+0.1%） | 5 → 5 | 8144.0 → 8145.3 | 220.7 → 189.7（-14.0%） |

S2 佐证：codex 解析请求 4→1、parse 127.9→1.7ms；`解析完成→首屏` 在三个数据领域 56.6/69.8/49.8 → 26.4/35.8/22.0ms
（模块/CSS 与数据改为并行），codex 无数据解析（null）。
**回归**：`boot.test.mjs` 8/8；`nav`、`nav-subpath`、`components` 全绿；四深链手测（含 items loading→内容、codex 不请求 items）。
**代价**：JS 传输 +约 13KB（新增并行/兜底逻辑），FCP 持平；codex 直链页脚在进入数据领域前显示「—」（设计选择）。

### 3.2 资料库排序池缓存 + 同结果集跳过重建（P2-3）

**问题与证据**（lib-split 探针）：排序每次重建 pool 并逐项 `localeCompare`（199ms/1894 项）；排序切换 129–145ms；
名称排序下搜索逐字 68.7ms；重复点同一 chip 仍全量 `clear(grid)+重建 60 卡`（19.7ms、100 条 mutation）。

**改动**：
- `js/library/query.js`：单例 `Intl.Collator('zh-Hans-CN',{numeric:true,sensitivity:'base'})`；排序池缓存
  `WeakMap(items) → Map('cat|assets|sort' → 已排序池)`（FIFO 上限 24），过滤改为「按缓存顺序线性过滤」；
- `js/views/library.js`：`renderAll({force})` + 状态签名；同签名重复触发直接返回（仅 grid 且 owned/fav 筛选关闭时），
  store 的 owned/fav 事件在筛选激活时传 force；`renderEmpty`/`unmount` 重置签名；
- 新增 4 条单测（冷/热等价、全量顺序快照、混合池、快照隔离/回落）。

**前后对比**（探针，同机）：排序切换 129–145 → **约 25–30ms**；名称排序下搜索逐字 68.7 → **约 8–10ms**；
重复点同 chip 19.7 → **约 1ms（0 mutation）**。S5 全量基准中 `sort` 96.7→49.6ms（-48.7%，含噪声）；`input2` -23.8%、`cat` -22.1%。
**回归**：`library-query` 25/25；`interactions --only items` 21/21；`shot dark/light` 54/54 ×2。

### 3.3 实验室：同条件去重 + 空更新早退 + tableB 跨挂载缓存（P2-3）

**问题与证据**（lab-async 探针）：一次场景变更触发 **2 次全量穷举**（S.on 立即 + store 220ms 防抖各一次）；
每次完成 bar/status/list 各渲染 **2 次**；完成帧 longtask 50–55ms（4× 节流下 275ms）；离开 `#/lab` 再回来
tableB 重新算 105–190ms + 100ms+ 长任务；隐藏面板仍在重算。

**改动**：
- `js/lab/recommend.js`：`conditionKey(picks)` 指纹（场景/档位/筛选/特性/碎片/消耗品/缺件/拥有集），同指纹且已有结果或
  正在跑 → 跳过第二次穷举；只有「重新穷举」按钮 `force=true`；`applyParams` 全字段未变时提前返回不重渲染；
- `js/lab/model.js`：模块级 `WeakMap<site, engine>` 缓存枚举引擎（tableA/B/C/frontier 随挂载复用；
  `api.site()` 同会话同引用，页面刷新/数据替换自动失效；engine.js 算法 0 改动）；
- 未做 workbench 按原因增量刷新（成本中/漏刷风险，见 §4）。

**前后对比**（探针）：
| 项 | before | after |
|---|---|---|
| 场景变更穷举次数 | 2 | **1** |
| 该路径 bar/status/list 渲染 | 6/6/6 | **2/2/2** |
| 完成帧 longtask / 最长帧 | 50–55ms / 33–50ms | **0 / 16.8ms** |
| 排序切换 / 翻页 / 切面板多余渲染 | 1–2 轮 | **0** |
| tableB 首次→重挂载 | 112ms（longtask 95ms）→ 重新 104.7ms | **112ms → 16ms（0 长任务，缓存命中）** |

**回归**：`lab-engine` 16/16（660 预设对账 + top300 逐字节快照 A/B IDENTICAL）；`lab-async` 8/8；
`lab-ui-semantics` 13/13（3 场景×4 排序×筛选/档位/翻页与引擎现算逐项一致）；`interactions` 67/67。

### 3.4 壳层与实验室缺陷修复（P2-6，行为正确性优先）

lab-arch 审计发现并修复（均有探针证据与像素级 A/B）：
- **跨域导航浮层残留 + body 滚动锁死**：`ui.closeOverlays({silent})`，`main.dispatch`（卸载旧视图前）与 `failDispatch` 调用；
- **toast 悬停后不消失**：mouseleave 重启计时，容量 3 不变；
- **缺件状态双副本漂移**：lab `missingState` 改为按数组引用记忆化读穿透（外部 `store.ui.set` 后归零/生效）；
- **矩阵 B 展开态被 build 变更破坏**：保留展开态并复用已算表（不重复穷举）；
- **replace 冗余 owned 订阅**、calc/replace 死 root 容器 + 对应 7 条死 CSS（像素 sha 前后相同，零视觉变化）；
- 修复后 `quick` 5/5、`interactions` 67/67、`components` 20/20、`shot-dark` 54/54。

### 3.5 死代码删除（P2-6，维护成本）

第一批净删 **60 行**（零引用导出/死常量/未用 import，见提交 `3e1895e`）；清单与证据见 `qa/_tmp` 审计脚本与
最终报告 §「删除或简化的无效代码」。
**教训（真实回归）**：`js/lab/text.js` 的 `RES_ZH` 被判定零引用删除，但它在**模板字符串** `${RES_ZH[rk]}` 里被使用，
`node --check`/单元测试均不报错，直到真实浏览器进 `#/lab` 才炸（`ReferenceError`）。已恢复并修复，
且把「删运行时符号后必须跑真实浏览器 lab/详情路径」写入 LESSONS；后续审计需把模板字符串引用计入。
<!-- PERF-OPTIMIZATIONS:END -->

---

## 4. 评估后不做（及原因）

<!-- PERF-REJECTED:START -->
每一项都先测量/阅读证据再决定；以下为**评估后明确不做**（避免「为优化而优化」）：

| 候选 | 证据/代价 | 结论 |
|---|---|---|
| `item_effects.json` 延后加载 | 与 items 并发、gzip 仅 40KB、不在关键路径；卡片效果句/搜索 haystack 依赖它，延迟会造成搜索/显示不一致 | 不做（回归风险 > 收益） |
| `icon_index.json` 延后 | 与 items 并发、gzip 34KB；`hasIcon` 参与资料库排序，延迟会导致顺序变化 | 不做 |
| 其它领域数据「跨域预取」 | items 首屏后 idle 只值得预取 codex(21KB)/archetypes(5KB)；增加带宽与一致性成本 | 不做 |
| `index.html` 按初始 hash preload items | 收益约 1 RTT；需改 HTML 并兼顾子路径，本轮性价比不足 | 不做（后续可选） |
| items.json 拆分「列表/详情」两份 | 列表字段可减 24%（gzip 0.73 vs 0.96MB），但需 pipeline+api+views 联动、数据契约双份 | 不做（后续专项） |
| 图标按显示尺寸生成缩略图 / 压缩 PNG | 真实大头：图标 ~65KB 显示 74px、首屏 46 张 ~2.9MB；属发布资产管线，非运行时优化 | 不做（后续建议，见 §5） |
| Web Worker 跑穷举 | 单次枚举 45–90ms、已被分帧到每帧 ≤10ms；4× 节流的卡顿主因是同帧 workbench 全量重建 + 完成双渲染 + 软件光栅 layout，Worker 省不掉主线程渲染 | 不做（先做去重/早退/缓存后已消除） |
| `statsFor` memo / 枚举剪枝 | 热路径已内联，无重复调用；现有 classTarget 剪枝已把 LIGHT 降到 0.6ms；进一步剪枝有改变 top 顺序风险 | 不做（不得改变数值/排序） |
| 资料库图标 IO 控 src / 尺寸属性 | 已 `loading=lazy`+`decoding=async`，滚动 900 卡只发 222 个唯一请求、0 重复；CI 不应引入新观察器 | 不做 |
| 事件委托 / 虚拟列表 | 每卡 5 listener 全滚约 5600 个，收益小；虚拟列表改变滚动/深链行为，风险高 | 不做 |
| 未用 CSS 类删除 | 启发式 43 个候选里 13 个是动态拼接误报，剩余视觉风险 > 维护收益 | 不做（本轮） |
| 删除 21 个 `export default`、机械收敛导出面 | 零消费者但 diff 噪声大、几乎全模块受影响；维护收益≈0 | 不做（文档说明「默认导出不是契约」） |
| 合并重复工具（isNum/clamp/isPlainObject/deferTitle） | 真重复但分散在 api/dom/engine/store/state/views，跨 10+ 文件、收益≈行数 | 不做（只记录） |
| 重复配置合并（护甲四槽数组 14 处、RES_KEYS 2 处、领域中文名 2 处） | 同上，且易与数据生成链耦合 | 不做（写入 `docs/AI_MAP.md` 的重复清单，后续专项） |
| 开发服务器加 ETag/Last-Modified | 只影响本地开发二次加载（serve.py 现在每个请求全量 7.3MB）；不影响线上 Pages（有 ETag+max-age） | 不做（收益仅在开发体验，列为建议） |
| IndexedDB / 数据分片 / 额外缓存层 | 无证据表明需要；现有 Map 去重 + 浏览器 HTTP 缓存已足够 | 不做 |
<!-- PERF-REJECTED:END -->

---

## 5. 回归验证

- 每项优化后跑 `node qa/gate.mjs quick`，提交前 `node qa/gate.mjs full`；
- 涉及计算引擎的改动必须通过 `qa/tests/lab-engine.test.mjs`（660 预设对账）与 `lab-async`（T1–T7）；
- 涉及渲染的改动必须通过 `interactions`（67 项）与 `shot`（54×2）——性能不能以行为回归为代价。
