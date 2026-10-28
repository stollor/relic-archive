# LESSONS — 经验沉淀、设计决策与踩坑记录

> 这份文档记录**为什么这样做**、**哪些坑踩过**、**以后怎么避免**。
> 新人/AI 接手先读 [`../AGENTS.md`](../AGENTS.md)，再读本文件；改设计前请先看 §1 的决策记录。
> 最近更新：2026-10-28（站点仓库化 + GitHub Pages 发布之后）

---

## 0. 怎么用这份文档

- **改代码前**：看 §1（设计决策）确认你不会破坏既定形态；看 §4（反模式）确认不是已知错误。
- **遇到怪问题**：先搜 §2（踩坑记录），每条都有「现象 / 根因 / 修复 / 规则」。
- **做回归**：对照 §5（数字基线），任何一项变红都是回归。

---

## 1. 设计决策（ADR 风格）

### ADR-1 单一静态 SPA + hash 路由，零构建

- **背景**：本地离线知识站，需要双击/任意静态托管可用，不能依赖 Node 构建链。
- **决策**：原生 ES module + 原生 CSS；路由用 `#/items`、`#/builds/<key>` 这类 hash。
- **原因**：`file://`/静态托管/子路径都能跑；无需服务端 rewrite；刷新/深链天然可用。
- **后果**：不能直接换成 History API（需要服务器 404 重写）；所有页面必须在站点根（否则相对路径会错）。

### ADR-2 双主题用 `tokens.css` 两套变量 + `html[data-theme]`

- **决策**：`:root` = 暗色默认，`html[data-theme="light"]` = 亮色整套覆盖；变量名只增不改不删。
- **原因**：组件 CSS 只需写 `var(--x)`；视图不关心主题；对比度可脚本化校验。
- **后果**：**禁止**在组件/视图 CSS 或 JS 里写颜色字面量；新增色必须两套成对给值，否则亮色会糊。
- **验证**：`python qa/audit.py`（硬编码色 FAIL）+ `node qa/theme-contrast.mjs`（130 组 AA）。

### ADR-3 数据两处：工作区权威 + 仓库发布快照

- **背景**：站点要能单独 clone 发布；上游解包链依赖数 GB 原始资产，不可能入 git。
- **决策**：`.mimocode/data/`（+ `assets/icons/`）是上游权威工作副本；`relic-archive/data/`（+ `assets/icons/`）是发布快照。
- **原因**：既保证仓库自包含，又不打断上游工具链（它读 `../data`、`../assets`）。
- **后果**：改数据必须走 `pipeline/sync-data.py`（sha256 比对，只复制变化的文件），**不要手工双写**。
  `data/builds.json` 例外：只在仓库内维护（`pipeline/mk_builds_json.py` 生成），工作区不再保留副本。

### ADR-4 站点独立仓库，上游工具链不进 git

- **决策**：`relic-archive/` 独立 git；`tools/`、`build/`、`extract/`、`archive/` 留在工作区。
- **原因**：仓库 70 MB 可发布（图标 58 MB + 数据 9 MB）；上游工具链 + 原始资产 3.7 GB 只适合本地。
- **后果**：GitHub 上 clone 的人只能跑站点与数据生成脚本，不能重跑解包；文档里已明确标注。

### ADR-5 GitHub Pages 用 legacy 构建 + `.nojekyll`，不引入 CI workflow

- **决策**：Pages source = `main / (root)`，`build_type=legacy`，仓库根放空 `.nojekyll`。
- **原因**：站点无构建步骤，不需要 Actions；`.nojekyll` 让 Pages 直接静态下发，规避 Jekyll 忽略 `_` 前缀目录
  （`pipeline/_source/` 会被 Jekyll 排除，虽然运行时不用，但保留完整性更省心）。
- **后果**：推送后 20–60 秒自动重建；不要改 `build_type=workflow` 除非真的加 CI。

### ADR-6 资产一律相对路径（兼容根路径与子路径部署）

- **背景**：Pages 项目站点在 `/relic-archive/` 子路径下；早期实现用 `/data/*`、`/assets/*`，上线会全 404。
- **决策**：`js/core/api.js` 的 `URLS` 用 `./data/*`，图标路径 `./assets/icons/*.png`。
- **原因**：页面都在站点根 + hash 路由不改文档 URL，`./` 解析在根路径与子路径都正确。
- **后果**：新增资产引用必须用相对路径；`qa/interactions.js` 的页面内 `import('/js/...')` 是绝对路径，
  只适合对本地根路径跑（线上只跑 `qa/shot.js --base`）。

### ADR-7 QA 用零依赖 Chrome CDP，而不是 Playwright/Puppeteer

- **决策**：`qa/lib/cdp.js` 手写 CDP 客户端（Node 22+ 原生 WebSocket），`shot.js`/`interactions.js` 复用。
- **原因**：项目不允许引入 npm 依赖；CDP 足够覆盖「真实点击/键盘/截图/console/网络」。
- **后果**：脚本要自己做等待/重试；新增断言优先复用 `Page` 助手（`ev/goto/waitFor/click/key/state`）。

### ADR-8 截图策略：发布图入库，QA 截图不入库

- **决策**：`docs/screenshots/`（8 张，1.6 MB）进 git 供 README/发布用；`qa/shots/` 被 `.gitignore` 排除。
- **原因**：截图可重跑生成；仓库不该被 15 MB 逐路由截图撑大；同时避免「截图散落多处」的老问题。
- **后果**：README 引用的图必须在 `docs/screenshots/` 且真实存在（提交前 grep 检查 md 链接）。

---

## 2. 踩坑记录（现象 / 根因 / 修复 / 规则）

### 2.1 部署与发布

#### #1 GitHub Pages 子路径导致数据/图标全 404
- **现象**：线上页面能开，但道具列表空、图标全是占位；console 里 `/data/items.json 404`。
- **根因**：`api.js` 用绝对路径 `/data/*`、`/assets/*`，在 `/relic-archive/` 子路径下解析到域名根。
- **修复**：改成 `./data/*`、`./assets/icons/*`；本地根路径同样成立。
- **规则**：新增任何 fetch/img 路径，必须以「站点根页面 + hash 路由」为前提用相对路径。

#### #2 Jekyll 会忽略下划线前缀目录
- **现象**：`pipeline/_source/*` 在 Pages 上 404（本地 `serve.py` 正常）。
- **根因**：GitHub Pages legacy 构建默认走 Jekyll，`_` 开头文件/目录被排除。
- **修复**：仓库根加空 `.nojekyll`（已加），Pages 直接静态下发。
- **规则**：不要把运行时要用的文件放在 `_` 前缀目录；放 `_source` 这类只作开发快照。

#### #3 本机 `git push` 卡死（DSH 自带 ucrt64 git 上传坏）
- **现象**：`git push` 无任何进度、远端 refs 一直为空；进程 `git-remote-https` 常驻；`git push --dry-run` 却秒过。
  小分支（2 个对象）也会卡；换系统 Git 后 **70 MB 5 秒推完**。
- **根因**：本机 PATH 里的 `@dsh-ops/.../ucrt64` git（2.56 windows）上传阶段异常（协商/下载正常，上传卡住），
  与仓库大小、代理无关（直连/代理都复现）。
- **修复**：用系统 Git：`C:\Program Files\Git\cmd\git.exe`（2.54 windows.1），可配 `-c http.version=HTTP/1.1`。
- **规则**：本机推送/拉取统一用系统 Git；若又卡住：`git push --dry-run` 先验证认证，再 `GIT_TRACE_CURL=1` 看重试在哪一步。

#### #4 新建仓库的默认分支是「第一个推上去的分支」
- **现象**：为探测连通性先推了 `probe` 分支，结果它变成默认分支，`probe` 删不掉（`refusing to delete the current branch`）。
- **修复**：`PATCH /repos/{owner}/{repo}` 设 `default_branch=main` → 再 `DELETE /repos/{owner}/{repo}/git/refs/heads/probe`。
- **规则**：空仓库**第一推就是 main**；探测分支不要先于 main 推送。

#### #5 凭据处理
- **规则**：token 只放临时文件/环境变量，用完删除；不写进 `.git/config`、remote URL、提交内容或文档。
- **应急**：若 token 曾出现在聊天/日志里，立即到 GitHub 撤销/轮换；日常改用 SSH key 或凭据管理器。

### 2.2 路径与目录重构

#### #6 迁移站点目录会打断三类隐式路径
- **现象**：把 `web/` 搬进 `relic-archive/` 后，审计脚本找不到根、上游脚本读不到站点源码、旧文档链接失效。
- **必须同步改的三类**：
  1. **运行时服务**：`serve.py` 的 `SITE_DIR/DATA_DIR/ASSETS_DIR`（站点自包含后 `./data`、`./assets`）；
  2. **QA/工具**：`qa/audit.py` 的根推断（`parents[1]`）、扫描 glob（`js/`、`css/`、`index.html`）、
     白名单/结果输出路径；`theme-contrast.mjs`（`__dirname/../css/tokens.css`）；
  3. **上游脚本**：`build/mk_archetypes.py` 读 `js/core/labels.js`、`js/core/icons.js`；旧 QA 脚本读 `js/lab/engine.js`、`qa/lib/cdp.js`。
- **规则**：搬目录前先 `grep -rIn "旧路径前缀"` 全量找引用；搬完 `grep` 确认 0 残留 + 跑四套门禁 + 全新 clone 复验。

#### #7 「数据只有一处」和「仓库自包含」是冲突的，要靠同步脚本调和
- **教训**：最初把运行时数据放在站点仓库内 → 上游脚本要改 15+ 处路径；直接改上游 → 发布仓库不自包含。
- **结论**：工作区权威 + 仓库快照 + `sync-data.py`（sha256 比对、幂等、`--check` 可做提交前自检）。
- **规则**：绝不同时手改两处；发现 `sync-data.py --check` 报差异，先判断是「上游更新」还是「仓库被手改」。

#### #8 空目录残留会骗过 `ls`
- **现象**：搬完 `web/` 后还剩 `web/css`、`web/js`、`web/qa` 空壳，`ls` 看起来还在。
- **规则**：用 `find web -type f | wc -l` 判断是否真空再删；删完再确认根目录列表。

### 2.3 数据

#### #9 纯文本实体没有 id，不要为了「能点」而伪造
- **现象**：流派详情里 29 个条目（遗物碎片 / 棱镜传奇词条 / wiki-only 名称）点不开详情。
- **根因**：它们来自 wiki 文本，本地解包无对应资产 id；`builds.json` 的 `i18n` 只存中文效果说明。
- **规则**：保持只读 chip + 中文效果提示（`data-tip`）；不许编造 id；`mk_builds_json.py --check` 会列出无法解析的引用。

#### #10 源数据的重复词不要「顺手修」
- **现象**：`builds.json` 的 `armor.weight_class` 有「轻 轻量」「超重 超重」这类重复。
- **决策**：视图侧归一化显示（`weightClassZh()`），**数据保持原语义**；生成器只做结构归一。
- **规则**：数据问题优先在渲染层兜底并在 `docs/DATA.md` 记「已知限制」，改数据必须同步改生成器与来源。

#### #11 评分/乘区是模型估算，页面上必须写口径
- **规则**：任何评分、饰品乘区、EHP 之类的派生值，页面必须写明「口径/假设」，不得伪装成游戏内精确数值。

### 2.4 主题与视觉

#### #12 硬编码颜色是亮色主题的最大敌人
- **现象**：初版 `base/components` 里有 52 处 `rgba(255,255,255,…)`、`#141414` 之类，暗色正常、亮色一片糊。
- **修复**：全部收敛为语义 token（`--on-gold`、`--glass-1`、`--scroll-thumb`、`--ambient-*`…），
  `tokens.css` 之外 0 处颜色字面量；`audit.py` 把硬编码色设成 FAIL 门禁。
- **规则**：新增样式先想「这个颜色在亮色下是什么」→ 加 token；不要写死。

#### #13 首屏主题闪白/闪黑
- **现象**：默认跟随系统亮色时，先渲染暗色再跳亮色。
- **修复**：`js/theme-boot.js` 经典脚本放在 CSS **之前**同步执行，先落 `html[data-theme]`；
  运行时行为（三态切换/Alt+T/系统监听）在 `js/core/theme.js`。
- **规则**：不要用 `<script type="module">` 做首屏主题；module 是 defer，会晚于首次绘制。

#### #14 内联脚本会被「裸英文」审计误伤
- **现象**：`audit.py` 把 `index.html` 里的多行内联 `<script>` 当用户文案，报 10 条裸英文 FAIL。
- **修复**：首屏脚本外置成 `js/theme-boot.js`（同时更利于缓存/审查），审计恢复 0 FAIL。
- **规则**：HTML 里不写大段内联 JS；如需内联，行数控制在一行或同步改 `audit.py` 的 script 剥离逻辑。

#### #15 移动端 4 个领域入口的点击区
- **现象**：390 宽下 nav 收窄后按钮只有 30×32，`interactions M5`（≥32px 抽检）FAIL。
- **修复**：移动端 `.domnav__link{min-width:32px;min-height:32px;justify-content:center}`。
- **规则**：压缩顶部空间时保持触控目标 ≥32×32；改顶栏后必跑 `--mobile-only` 门禁。

### 2.5 QA 与验证

#### #16 只看 HTTP 200 不算验收
- **教训**：路径错误/数据加载失败时页面照样返回 200（只是数据空、图标占位）。
- **正解**：用 `qa/shot.js`（headless Chrome）判 `#view-root` 有内容 + console/异常/4xx 全 0；关键页再看图。
- **规则**：改完 UI 至少跑 `shot --theme dark|light`；改数据加跑 `mk_builds_json.py --check`。

#### #17 截图必须人眼复核一次
- **教训**：自动化判定「有内容」不等于「排版对」；某次卡片网格在 390 下溢出/图标错位，PASS 但肉眼可见。
- **规则**：每个大改轮次至少抽看 3 张：列表页、详情页、404（暗色 + 亮色各一张）。

#### #18 全新 clone 是最终集成测试
- **做法**：`git clone <repo> /tmp/x && cd /tmp/x && python serve.py` → 查 `/api/health`、页面、`audit.py`。
- **价值**：一次就暴露「漏提交、绝对路径、仓库不自包含、gitignore 误伤」四类问题。发布前必做。

#### #19 门禁是数字化的，回归要对比数字
- 基线：`shot 54/54 × 2`、`interactions 67/67`、`audit 0 FAIL`、`contrast 130/130`（见 §5）。
- 数量变化是信号：新增路由/用例要同步更新基线并写进 `qa/REPORT.md`。

### 2.6 文件与协作

#### #20 行尾与 `.gitattributes`
- **决策**：仓库内统一 LF；`.cmd`/`.ps1` 强制 CRLF（cmd.exe 对 LF-only 批处理有解析坑）。
- **规则**：新增脚本不要手写 CRLF/LF 混合；提交时看 `git` 的 `will be replaced by LF` 警告是正常的。

#### #21 大文件与二进制不要进 git
- `extract/` 2.4 GB、`extract_icons/` 398 MB、`archive/` 633 MB 只在本地；`qa/shots/` 忽略；
  单文件最大 `data/items.json` 7 MB，远低于 GitHub 限制。

#### #22 多人/多 Agent 并行写同一仓库要有边界
- **教训**：本轮 3 个 Agent 并行（视图 / 主题 / 清理），靠「写域清单 + 共享任务 + 依赖顺序」避免了互相踩。
- **规则**：并行改同一仓库时，先列文件级写域（谁写哪些文件），共享文件（`index.html`/`tokens.css`/文档）只给一个人；
  合并后由 Lead 跑总门禁 + 看 diff。

#### #23 删除/移动前先备份、先核查引用
- **做法**：`tar` 备份脚本与文档（`archive/pre-cleanup-scripts.tar.gz`）；每项删除前 `grep` 引用、`ls` 确认绝对路径。
- **教训**：项目无 git 时误删不可回滚；本轮靠清单 + 引用核查安全释放 1.44 GB。

### 2.7 可靠性 / 异步 / 持久化（2026-10-28 第一阶段治理）

#### #24 同步脚本不能「先写一半再崩」
- **现象**：`sync-data.py` 图标分支 `rows.append(a, b, c)` 传了 3 个参数（list.append 只收 1 个）；
  只要有图标新增/更新就抛 TypeError，而此前 data 已复制 → 未说明的部分更新；`--check` 同样崩。
- **根因**：易错分支没有回归测试；写盘与报告逻辑耦合、无计划阶段。
- **修复/规则**：先完整**计划 + 校验**（源缺失、状态、换行归一）→ 再落盘；单文件临时文件 + `os.replace`；
  中途失败**回滚**（新增删、更新恢复字节 + mtime）并返回独立退出码；`--check` 严格只读。
  退出码约定：0 成功/已最新、1 `--check` 漂移、2 工作区缺失/不完整、3 写盘失败已回滚。

#### #25 `--check` 的字节比对先把换行归一，否则会假红
- **现象**：`sync-data.py --check` 长期报 5 个文件漂移；内容其实完全一致，差异 100% 是 CRLF/LF
  （工作区 CRLF × 仓库 `.gitattributes eol=lf`）。
- **根因**：用原始字节 sha256 比对文本；git 换行归一化让「字节不同 = 内容更新」的假设不成立。
- **规则**：文本 JSON 先 `\r\n`/孤立 `\r` → `\n` 再比较，仅换行差异按「相同」并统计；同步文本一律 LF 落盘，
  二进制原样复制。**不要**用 `git add` 掩盖换行差异。

#### #26 分帧任务必须有「代际 / 取消」，`state.running` 不能当锁
- **现象**：实验室推荐穷举运行中改条件，`start()` 被 `if (state.running) return` 静默丢弃 →
  最终结果对应旧条件；完成回调无版本检查，旧结果可覆盖新条件；离开页面后 rAF 链继续跑、继续写已卸载 DOM。
- **修复/规则**：用 `js/core/task.js` 的 `createTaskRunner`（run 自动让上一次任务失效、cancel 停帧）
  + `createEpoch`（完成回调落地前校验代际）。条件一变就重启，不做「丢弃新请求」式防抖。
  禁用长任务（>1s 的分帧循环 / 定时器 / Observer）时，先想「销毁路径怎么取消它」。

#### #27 async 路由派发必须代际化，否则旧页面后挂载
- **现象**：快速 A→B→C 切换时多个 `dispatch()` 并发 await 动态 import，晚返回的旧派发再次 mount：
  `#view-root` 出现多个 `.view`、nav 与内容不一致、旧视图未 unmount。
- **修复/规则**：`main.js` 用 `createEpoch` 给每次派发发 token，await 后与 mount 后各校验一次；
  进入错误态前先 unmount + 丢弃 `mounted`（否则重试会把已卸载视图当活的）。
  视图侧异步回调（`load().then/.catch`、`setTimeout`、`queueMicrotask`）都要用实例代号校验，
  unmount 后不得再写 DOM / 绑监听；重复订阅（如 codex 自己再 `router.onChange`）直接删掉，路由只走 main 派发。

#### #28 localStorage 读取必须白名单归一，坏数据不能炸启动
- **现象**：`new Set(readJSON('r2.v2.owned', []))` 遇到合法 JSON 但不是数组（对象/数字）直接在模块初始化
  `TypeError: not iterable` → 整站白屏；字符串会被拆成单字符 Set。build/mods/traits/meta 脏数据会让
  配装静默不可写或抛错；迁移只判断「新 key 存在」导致损坏新数据挡住有效旧档。
- **修复/规则**：读 localStorage 一律 assume corrupted：逐字段白名单 + 类型/范围校验，非法值回退默认、
  合法项保留（**不得整份清空用户 owned/fav/saved**）；迁移只在「新键缺失或归一后为空」时发生；
  写入失败必须可见（`store` emit `storage-error`，main 弹 toast），不能静默假装保存。

---

## 3. 有效工作法（推荐 AI 采用）

1. **先契约后代码**：动 UI 前读 `docs/UX_SPEC.md`，动数据前读 `docs/DATA.md`，动发布前读 `docs/DEPLOY.md`。
2. **小步验证**：改一个文件跑一次对应门禁，不要攒一整天再跑；`shot.js --only builds` 可以只跑 10 个路由。
3. **用数据说话**：结论里带数字（54/54、67/67、130/130、70 MB、1084 files），不要只写「已修复」。
4. **失败先复现再猜**：先 `--check`/`--dry-run`/单路由最小用例，再改代码。
5. **互斥工具不混用**：本机推送用系统 Git；截图/审计用仓库脚本；不要临时装 playwright/puppeteer 替代。
6. **文档与代码同改**：改契约同步 `UX_SPEC`，改数据格式同步 `DATA`，改部署同步 `DEPLOY`。
7. **提交前自检三件套**：`git status`（只含预期文件）→ 四套门禁 → 全新 clone 冒烟（发布前）。

---

## 4. 反模式（明确不要做）

| 反模式 | 为什么不行 |
|---|---|
| 引入 npm / Vite / React / Tailwind / 外部字体 | 破坏「无构建 + 离线可用」形态；Pages 也不需要构建 |
| 在视图 CSS 写死颜色、或用 `filter: invert()` 凑亮色 | 对比度/层次全崩；`audit.py` 会 FAIL |
| 视图直接 `fetch('/data/...')` | 绕过 api.js 的规范化/缓存/相对路径；子路径部署必挂 |
| 新增 localStorage key 存主题 | 破坏 store 唯一入口约定；主题在 `r2.v2.ui.theme` |
| 手改 `data/items.json` 的语义字段 | 与上游数据链漂移；`sync-data.py --check` 会暴露 |
| 为纯文本实体伪造 id | 数据造假；详情页会打开空内容 |
| 把 `qa/shots/`、`__pycache__`、token 提交上去 | 仓库膨胀/泄密 |
| 把 `build/site` 旧独立站再塞回来 | 已被 `#/builds` 取代，只留在 `archive/site-legacy/` |
| 空仓库先推探测分支 | 会变成默认分支，删不掉（见 #4） |
| 只 curl 200 就宣布上线成功 | 数据/图标可能全 404（见 #16） |

---

## 5. 数字基线（2026-10-28，发布后）

| 指标 | 数值 |
|---|---|
| 仓库文件 / 体积 | ≈1088 files（git 追踪）/ 工作树约 70 MB（图标 58 MB + 数据 9 MB） |
| 页面数据 | 1126 件真道具（1894 条记录）/ 16 职业 / 43 护甲套装 / 13 篇知识库 / 7 套流派 |
| 图标 | 1004 张 PNG（`assets/icons/`） |
| `shot.js --theme dark` | 54/54 PASS（27 路由 × 1440/390） |
| `shot.js --theme light` | 54/54 PASS |
| `interactions.js` | 67/67 PASS（资料库 17 / 实验室 18 / 流派 7 / 知识库 4 / 全站 11 / 移动 6） |
| `audit.py` | 0 FAIL / 0 WARN / 65 INFO |
| `theme-contrast.mjs` | 130/130 PASS（正文最低 4.91，强调最低 4.60） |
| `node --test "qa/tests/*.test.mjs"` | 29/29 PASS（core/task 6 + core/store 23） |
| `qa/tests/lifecycle.browser.mjs` | 25/25 PASS（快速切换 / 延迟数据 / 前进后退 / 深链 / 损坏 localStorage） |
| `qa/tests/lab-async.browser.mjs` | 8/8 PASS（运行中改条件取最后条件 / 离开页面 / 耗时无退化） |
| `qa/tests/test_sync_data.py` | 23 tests OK（同步语义 / 只读 check / 换行归一 / 回滚 / 幂等） |
| 线上 | https://stollor.github.io/relic-archive/（Pages legacy + `.nojekyll`） |
| 线上门禁 | dark 桌面 25/25、light 移动 15/15 全 PASS，0 console error |

> 基线勘误（2026-10-28）：`qa/REPORT.md` 头部命令表仍是 v2.1 口径（「18 路由 = 36 张」「59 项交互」），
> 与当前 `shot 54 项（27 路由 × 2 视口）/ 双主题 = 108 张`、`interactions 67/67` 不一致；
> 该文件正文 §9 已是 v3 数字，以本表与门禁脚本输出为准。另：`sync-data.py --check` 曾长期为红，
> 原因是文本换行归一缺失（见 #25），本轮已修。
