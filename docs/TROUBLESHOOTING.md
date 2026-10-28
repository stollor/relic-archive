# TROUBLESHOOTING — 真实故障排查（症状 → 根因 → 定位 → 修复）

> 只收录**真实发生过**的问题（来源：[`LESSONS.md`](LESSONS.md) §2/§5、[`../qa/REPORT.md`](../qa/REPORT.md) §10–§12、`git log`）。命令默认在仓库根执行。
> 先按「症状」关键词搜本文件；找不到再查 [`LESSONS.md`](LESSONS.md) / `git log --oneline --all`。修完把根因补进本节（不要把一次性排查过程堆进 AGENTS.md）。

## 1. 服务 / 端口 / 浏览器

### T1 页面空白 / ES module、fetch 被浏览器拦截
- **症状**：双击 `index.html`（`file://`）打开是空白；控制台报 CORS / `Access to script ... from origin 'null' has been blocked`；或 `fetch` 失败。
- **根因**：ES module 与 `fetch` 不允许 `file://` 协议；本项目没有构建步骤，必须经 HTTP 服务访问。
- **定位**：看地址栏是否 `file:///...`；`python serve.py --help` 确认可用端口参数。
- **修复**：`python serve.py` → 打开 http://127.0.0.1:8777/ ；验收/回归用 `node qa/gate.mjs <mode>`（门禁自动起 `serve.py --port 0`，不占 8777）。

### T2 本地服务起不来 / 端口被占用
- **症状**：`python serve.py` 报 `OSError: [WinError 10048] 通常每个套接字地址(协议/网络地址/端口)只允许使用一次`；或请求打不开。
- **根因**：默认 8777 已被另一个 `serve.py`（例如 Lead 的常驻服务）占用；或上次进程未退出。
- **定位**：`Get-Process python | Select-Object Id,Path`；换端口试 `python serve.py --port 8799 --prefix /relic-archive`。
- **修复**：不要杀别人的 8777；自己换 `--port <其它>` 或直接用门禁（随机端口，`--port 0` 由 gate 管理并在结束时关闭）。

### T3 缺 Chrome / Chrome 探测失败（浏览器检查全 SKIP 或 FAIL）
- **症状**：`ChromeNotFoundError`（含搜索清单与 `CHROME_PATH` 建议）；或门禁退出码 3，`shot-*`/`interactions` 全部 SKIP。
- **根因**：Chrome 不在候选路径；测试脚本不写死路径，靠 `resolveChrome()` 探测（`qa/lib/cdp.js`）。
- **定位**：`node qa/shot.js --help` 看 `--chrome`；`node qa/gate.mjs --list full` 看 requires；`node --test qa/tests/env.test.mjs` 验证探测逻辑。
- **修复**：装 Chrome，或 `setx CHROME_PATH "C:\...\chrome.exe"` 后重开 shell；临时指定 `node qa/shot.js --chrome <path> --theme dark --only items`。**不要**把 Chrome 路径写进脚本。

### T4 子路径部署 404（本地根路径永远看不出来的那类）
- **症状**：线上页面能开但数据/图标空，console 报 `/data/items.json 404`、`/assets/icons/... 404`；本地根路径却正常。
- **根因**：GitHub Pages 部署在 `/relic-archive/` 子路径，绝对路径 `/data/*` 会解析到域名根；资源必须相对路径（`./data/*`、`./assets/*`）。
- **定位**：`python serve.py --port 8799 --prefix /relic-archive`，访问 `/relic-archive/data/items.json`（应 200）与 `/data/items.json`（应 404，这是**预期**）；页面内脚本 import 用 `new URL('js/…', location.href)` 或 `qa/lib/base.js` 的 `prefixOf(base)`。
- **修复**：把绝对路径改为相对路径/前缀工具；新增资源后跑 `node qa/gate.mjs full --only shot-subpath,nav-subpath`。

## 2. 门禁 / 测试

### T5 `node --test qa/tests/` 报 `Cannot find module`
- **症状**：`Error: Cannot find module '...\qa\tests'`（Node 24+ 不再把目录参数当测试入口）。
- **根因**：Node 测试运行器的目录参数行为变化；项目要求显式 glob/file。
- **定位**：复跑报错命令即可看到 `Cannot find module`。
- **修复**：用 glob：`node --test "qa/tests/*.test.mjs"`；或直接 `node qa/gate.mjs quick`（内部已用 glob）。

### T6 门禁 FAIL：通过数/用例数对不上（疑似被删除/跳过）
- **症状**：摘要出现 `通过数 N < 基线 M（疑似用例被删除）`、`跳过 X > 允许 Y（禁止静默跳过）` 或 `用例数 N ≠ 期望 M（路由/用例被静默丢弃？）`。
- **根因**：删/改了测试、路由表或截图路由；`qa/baselines.json` 是唯一基线（`qa/gate.mjs` 的 `applyBaseline`）。
- **定位**：看 `qa/results/gate.json` 的 `checks[].failed[]/log`，再点开 `qa/results/logs/<id>.log`；路由数异常先查 `qa/lib/routes.mjs` 与 `data/*.json`。
- **修复**：先还原/修好测试；**确属有意增减**才 `node qa/gate.mjs <mode> --update-baseline`，并在提交信息说明（baseline diff 即审计线索）。

### T7 门禁退出码 3：关键检查因环境被跳过
- **症状**：`0 PASS` 但进程退出码 3；摘要标 `SKIP(required)`；典型为缺 Chrome/Python。
- **根因**：关键检查被环境阻断（缺 Chrome），门禁设计上**不把 SKIP 当通过**（`qa/gate/registry.mjs` 的 `required` 标记）。
- **定位**：看摘要里的 SKIP 原因与 `qa/results/gate.json` 的 `env`；`node qa/gate.mjs --help` 的 `--allow-missing-chrome` 仅用于明确不跑浏览器时。
- **修复**：补齐环境（Chrome/Python）；独立 clone 缺上游 `.mimocode` 时 `data-sync` 的 SKIP 属预期，不是失败。

## 3. 数据 / 发布

### T8 `sync-data.py --check` 报漂移（exit 1）——先分清换行还是内容
- **症状**：`[i] --check：未写盘，存在差异（退出码 1）`，列出若干 `更新 data/*.json`；历史上长期 5 个文件假红。
- **根因**：①工作区数据真的更新（应同步）；②工作区文本是 CRLF、仓库是 LF（`.gitattributes eol=lf`），旧版按原始字节 sha256 比对会误判；③快照被手工改过。
- **定位**：`python pipeline/sync-data.py --check`；`git ls-files --eol data/items.json data/acq.json` 看行尾；`git status --short data/` 看是否手改。
- **修复**：真实内容漂移 → 在工作区跑 `python pipeline/sync-data.py`（只复制真实变化、文本统一 LF 落盘、失败回滚）；仅换行差异会被当作「相同」并统计「仅换行差异 N 个」。**不要**手工改 `data/` 两侧。

### T9 源 JSON 损坏：同步 exit 2（零写入）
- **症状**：`[x] 源 JSON 损坏：<路径>:<行>:<列>：Expecting value`；退出码 2，仓库文件一个都没动。
- **根因**：上游工作区生成的 JSON 不完整（生成链中断/写入失败）；`sync-data.py` 在 plan 阶段对全部 `.json` 源做语法校验，防止损坏数据进发布快照。
- **定位**：读取报错给出的 `路径:行:列`；检查上游生成链日志，必要时在编辑器定位该行。`--check` 同样会报（不会用「漂移检查」蒙混）。
- **修复**：修上游数据/重跑生成链；不要手改目标端。回归用例：`python -m unittest discover -s qa/tests -p "test_sync_data.py" -v`。

### T10 `mk_builds_json.py --check` 报坏引用 / 配装点不开
- **症状**：`[!] N 个引用既不在 items.json 也不在 i18n：` 逐条列出；或详情 chip 点不开、构建后引用悬空。
- **根因**：槽位/护甲/武器改装 id 变了，或纯文本实体（碎片/传奇词条）没在 `_source/builds.json` 的 `i18n` 登记。
- **定位**：`python pipeline/mk_builds_json.py --check`（脚本会逐条列出坏引用）；对照 `pipeline/_source/builds.json` 的 `i18n` 与 `data/items.json` 的 id。
- **修复**：真实 id 错误改 `_source` 源数据；纯文本实体补 `i18n`（不要把 id 编造给无 id 实体）；然后 `mk_builds_json.py` 重新生成 `data/builds.json`，跑 `node qa/gate.mjs data`。

### T11 Pages 发布后页面仍是旧内容
- **症状**：push 成功但线上还是旧版；或 `deploy.py` 失败（退出码 4 等待超时 / 5 远端 sha 不一致）。
- **根因**：Pages legacy 构建未完成/缓存；或推送没成功（本机 ucrt64 git 上传卡住）；或远端 commit ≠ 本地 HEAD。
- **定位**：`git log -1 --oneline`；`git rev-parse HEAD` 与远端比对；`python pipeline/deploy.py --verify-only --base https://stollor.github.io/relic-archive`（不推送，只等发布+冒烟）。
- **修复**：等 20–60s 后重跑 `--verify-only`；仍不一致用系统 Git 手动 `push` 再复验；必要时 `git revert` 回滚（`docs/DEPLOY.md` §7）。发布正确性以 `deploy.py` 的内容指纹/冒烟为准。

### T12 本机 `git push` 卡死无进度（dry-run 却秒过）
- **症状**：`git push` 一直无进度、`git-remote-https` 常驻；`git push --dry-run` 正常；小分支也卡。
- **根因**：本机 PATH 里的 `@dsh-ops/...` ucrt64 git（2.56）上传阶段异常，与仓库大小/代理无关（LESSONS #3）。
- **定位**：`git remote -v`；`& 'C:\Program Files\Git\cmd\git.exe' --version` 确认系统 Git 存在。
- **修复**：用系统 Git：`& 'C:\Program Files\Git\cmd\git.exe' push origin main`（可加 `-c http.version=HTTP/1.1`）；或 `python pipeline/deploy.py`（自动优先系统 Git）。

## 4. 前端运行时 / 持久化

### T13 整站白屏：`TypeError: ... is not iterable` / localStorage 脏数据
- **症状**：页面直接白屏；console 报 `TypeError: xxx is not iterable`（历史上 `new Set(readJSON('r2.v2.owned', []))` 遇到对象/数字）；或收藏/拥有变成奇怪值。
- **根因**：localStorage 里是合法 JSON 但不是预期类型（数组/对象/字符串混杂）；旧版读取无白名单/迁移只判「键存在」。
- **定位**：DevTools → Application → Local Storage 查看 `r2.v2.*`；`node --test qa/tests/store.test.mjs` 复现/验证归一逻辑。
- **修复**：已由 `js/core/store.js` 读取端白名单归一（非法字段回退默认、合法项保留）+ 迁移守卫 + 写失败 `storage-error` toast；不要新增 localStorage key，不要在视图直接读 localStorage。用户侧可清对应 key 后刷新，但**不得**在代码里整份清空 owned/fav/saved。

### T14 快速切页面出现双视图 / 旧页面后挂载 / nav 与内容不一致
- **症状**：同一 tick 连续改 hash（A→B→C）后 `#view-root` 里有多个 `.view`、旧视图未 unmount、标题/导航与内容对不上。
- **根因**：async dispatch 并发 await 动态 import，晚返回的旧派发再次 mount；错误分支未清 `mounted`。
- **定位**：`node qa/gate.mjs full --only nav,lifecycle`；或看 `qa/tests/navigation.browser.mjs` 的 N1/N2 用例。
- **修复**：`js/main.js` 用 `createEpoch` 给每次派发发 token，await 后/mount 前双重校验；错误态先 unmount + 丢弃 `mounted`；视图异步回调加实例代号，unmount 后不写 DOM、不新增监听（复用 `core/task.js`）。

### T15 实验室推荐结果对应旧条件 / 离开页面后仍在算
- **症状**：穷举运行中改条件，完成后结果仍是旧场景/旧数值；离开 `#/lab` 后仍占 CPU、控制台/页面出现过期写入。
- **根因**：旧实现用 `state.running` 把新请求静默丢弃；完成回调无代际检查；`requestAnimationFrame` 链无可取消路径。
- **定位**：`node qa/gate.mjs full --only lab-async`；或读 `qa/tests/lab-async.browser.mjs` 的 T1–T7 断言（脚本头注释含 `LAB_QA_BASE` 用法）。
- **修复**：用 `js/core/task.js` 的 `createTaskRunner`（run 自动失效上一任务、cancel 停帧）+ `createEpoch`；条件一变即从头重算，最终结果必须对应最后一次有效条件；`destroy()` 调 `runner.cancel()`。

### T16 截图/接口都 200，但页面其实是“空壳”
- **症状**：HTTP 200、无 4xx，但列表空、图标占位；或门禁 PASS 截图却明显排版错。
- **根因**：路径错误/数据加载失败时页面照样 200（只是空数据）；自动判定「有内容」不等于「排版对」（LESSONS #16/#17）。
- **定位**：`node qa/shot.js --theme dark --only items`（看 console/异常/4xx 与 `qa/shots/_summary.json`）；`node qa/gate.mjs full --only shot-dark`；人工抽看 3 张截图（列表/详情/404，暗亮各一张）。
- **修复**：先修资源路径/数据接口（T4/T8）；不要用截图 PASS 代替人工复核，发布前 `full` + `deploy`。

## 5. Windows / 行尾 / 编码

### T17 行尾告警与“假 diff”
- **症状**：`git` 提示 `warning: in the working copy of '...', CRLF will be replaced by LF the next time Git touches it`；或不同机器上同一文件显示全文件改动。
- **根因**：仓库 `.gitattributes` 约定文本 LF（`* text=auto eol=lf`，`*.cmd`/`*.ps1` 强制 CRLF）；Windows 工具默认写 CRLF。
- **定位**：`git ls-files --eol <file>`；`python pipeline/sync-data.py --check`（文本会做换行归一再比较）。
- **修复**：文本文件按 LF 保存（编辑器/脚本显式设置）；`.cmd`/`.ps1` 保持 CRLF；不要用 `git add` 掩盖换行差异。

### T18 文档里的命令“少了字符”（`.erify.ps1`）
- **症状**：`docs/DEPLOY.md` §2 与 `pipeline/README.md` §4 里 `.\verify.ps1` 显示/复制成 `erify.ps1`（前导 `.\v` 丢失），照抄命令会报「找不到命令」。
- **根因**：历史上用脚本写文档时把 `\v` 当转义字符吞掉（本仓库真实存在此文档缺陷，尚未修）。
- **定位**：`Select-String -Path docs/DEPLOY.md,pipeline/README.md -Pattern '^erify'` 可复现。
- **修复**：临时用等价命令 `node qa/gate.mjs <mode>`；文档修复本身需改这两个文件（当前不在 AI 入口重构写域内，已报 Lead）。
