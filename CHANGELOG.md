# CHANGELOG — 站点演进记录

> 只记「形态/能力」级变更与关键数字；细枝末节的改动见 `git log`。
> 早期里程碑来自 `.mimocode` 工作区历史（站点曾是工作区内的 `web/`）。

## v3.10 — 2026-10-30 · 实验室 v4：装配台降噪（首屏三层 + 渐进披露）

用户反馈「信息太散、太杂、看着累」。v4 不新增数据/推荐能力，只重排信息层级与视觉噪音：

- **首屏只留三层**：装配台（分类 tab + 当前页）→ 本套效果（一行 6 个关键值）→ 本类推荐（整行卡片网格，限高滚动）；
  九个进阶面板收进默认折叠的「高级工具」；流派 / 场景 / 档位 / 缺件 / 消耗品收进装配台「设置」抽屉（唯一入口）。
- **行内渐进披露**：行只留槽位 / 装备 / 2 个关键数值 / 单行效果 / 套装来源；英文小字与行内操作默认隐藏（hover/聚焦出现）；
  完整属性走统一详情浮层。护甲抗性改挂数值 `title`；武器挂件压成行下单行条；职业技能压成「已记录技能」单行 + 抽屉；
  特性表 43 条限高滚动、行内 × 悬停出现。
- **移动端**：修 topbar 计数徽章溢出（≤420px 隐藏）与装配台工具栏纵向 flex 的 wrap 语义坑；390px 无横向溢出。
- 交互验收同步（B9 先展开完整结果、B11 从设置抽屉切场景），B1–B18 全绿；文档新增 `docs/ASSEMBLY_V3.md` §7。

## v3.9 — 2026-10-30 · 实验室 v3：装配台拆成 6 个分类页

- **15 槽网格 → 6 个分类装配页**（`#/lab` 默认护甲页，`?tab=` 可深链）：
  护甲四件 / 武器与改装 / 职业与技能 / 饰品 / 特性 / 圣物与碎片。每页只放本类槽位，逐行给出该件完整属性
  （护甲值·负重·五类抗性 / 伤害·射速·暴击·弹匣 / 维度·效果 / 0–10 级步进 / 碎片颜色·属性）与操作
  （详情 / 缺件 / 更换 / 移除）；空槽为虚线行，整行点开同一个选择器。
- **下方固定「本套效果 + 本类推荐」**：本套效果 = 原结果面板（防御/生存/机动 + 构成明细 + 输出）原样搬入；
  本类推荐随分类切换——四件套穷举前 3（可一键写入）/ 武器挂件 Top5 / 防御向职业 Top4 / 饰品补齐·同槽·整组组合 /
  特性前 8 / 碎片前 6，全部带口径脚注。切换槽位或分类时实时刷新。
- **工具栏**：流派 / 场景 / 档位目标 / 缺件清单 / **按流派配齐**（护甲 Top1 + 饰品组合 Top1 + 特性 10 满级 +
  碎片 3 槽 + 已选武器挂件；职业与圣物不建模，toast 明示）。
- **职业技能（新增能力）**：`js/lab/skills.js` 从 `items.json` 的 `cat=skill` 行按「职业目录 → 技能目录」推导，
  过滤 `_Action/_Aura/...` 子对象与英文兜底名，14 个已实装职业各 3 条；选择写 `meta.skills`，
  **不参与防御合计**（页脚标注），技能效果显示解包数值 + 英文原文折叠并标「待验证」。
- 实现：`wb-parts.js`（装配页共享渲染件 + 分类登记表）/ `wb-assembly.js`（tab 外壳 + 缺件抽屉 + URL 同步）/
  `wb-cat-*.js`（6 个分类页，懒加载，单页失败不影响其它页）/ `wb-oneclick.js`；`wb-result.js` 逻辑不动，
  `wb-settings.js` 只留消耗品与预设种子（场景/档位/流派上移工具栏）。新增 `qa/tests/lab-skill.test.mjs`（9 项）。
- 交互验收（`interactions --only lab` B1–B18）改为按分类页断言：6 页可达、空槽→选择器→装备、详情不装备、
  × 移除、清空确认、职业抽屉 ≥14、特性步进改合计、结果分组/EHP、五面板深链、缺件重算、选择器筛选。
- 文档：新增 `docs/ASSEMBLY_V3.md`；`docs/UX_SPEC.md` §11.4、`docs/AI_MAP.md`、`AGENTS.md` 同步。

## v3.8 — 2026-10-30 · 知识站数据补全（系统机制 6 篇 + 效果句覆盖 28.7% → 59.8%）

- **知识库新增「系统机制」分类 + 6 篇来源可追溯文章**（`data/codex/index.json` 13→19 篇 / 4 分类）：
  圣物碎片与棱晶 / 突变因子 / 武器改装 / 特性 / 饰品组合与乘区 / 数据覆盖与置信度。
  每篇带 `confidence` 与「证据表」，数字尽量追溯到 locres 原文或工作区 ref；无法确证的（五档品质倍率、
  圣物碎片槽数为 3、特性上限 10、棱晶槽数/加成幅度、突变因子升级曲线、武器↔固有改装映射）明确标「待验证」。
  澄清一个常见误读：locres「根据棱晶内碎片的颜色获得加成」的主语是**棱晶**，不是圣物三碎片槽。
- **道具效果句覆盖 323 → 673（1126 真道具的 59.8%，+31.1pt）**：`build/mk_item_effects.py` 新增 wiki 英文回退
  （官方中文句未命中、但 wiki 有 effect 时输出 `{zh:'', en, src:'wiki', confidence:'medium', match:'wiki-only'}`；
  清洗 tooltip 注入/`[sic]`/重复词；已有 304 official + 19 manual 逐字段零改动）。结构性缺口如实保留：
  护甲 130 件 wiki 无 effect、武器 122 件 wiki 只有风味描述，**不拿风味冒充机制**。
- **详情页**：无中文效果句时追加「效果原文（wiki 整理）」区块（斜体英文 + `来源：wiki` badge + 「未经翻译」说明，
  独立 `.detail-wiki` class，不复用 `.detail-effect`）；`effectEn` 并入搜索 haystack。组件契约新增 C22 守卫。
- 数据契约：`item_effects` 允许 `zh` 为空、`src=wiki`、`match=wiki-only`、`counts.wiki`；新增不变量
  「wiki 回退条目 zh 必空、en 必非空」；`data-schema` 50 项全绿。
- 文档：`docs/DATA.md` 更新效果句/知识库条目；`docs/UX_SPEC.md` §12 补 wiki 回退口径、§7 术语表纠正为
  locres 官方「突变因子 / 棱晶」（社区「变异器 / 棱镜」只作 alias）。

## v3.7 — 2026-10-30 · 实验室 v2：从「防御计算器」到「配装规划器」

- **新数据文件 `data/lab_gear.json`（434 KB，schema 1）**：由工作区 `build/mk_lab_gear.py` 从
  `items.json + wiki_items.jsonl + item_effects.json + build/ref/*.md + site_data.modifiers + locres` 生成，
  **589 条**：戒指 225 / 项链 104 / 突变因子 66 / 改装 79 / 圣物碎片 45（红黄蓝各 15）/ 特性 43 / 圣物 27；
  字段含 `tags / dims（15 维度）/ effectZh / effectEn / effectKeys / evidence / confidence`。
  维度分是「游戏 filter_tags + 词条关键词」的映射，用于同口径比较，**不是游戏内精确数值**（页面与导出均标注）。
- **九面板 + 两级 tab**：`PANELS` 注册表加 `group`，一级分组（推荐 / 装备 / 数据与存档）+ 二级面板；
  新增「饰品组合」「武器改装」「特性」「圣物碎片」四个面板，旧「推荐/替换/档位/计算器/存档」保留。
- **饰品组合（需求核心）**：1 项链 + 4 戒指按 9 个流派（通用/远程暴击/远程续航/近战/状态/改装技能/生存坦克/辅助召唤/召唤流）
  的维度权重实时枚举（池 ring 前 24 × amulet 前 12，127,512 组约 16 ms；固定件先占位）；组合分 = 0.7·平均 + 0.3·覆盖；
  已装备件固定后可看空槽边际推荐与同槽更优替换，组合可整组写入/整组标记缺件。
- **武器改装**：按武器类型（远程/近战）推荐突变因子与改装（远程可换、近战仅固有改装），含效果原文、适配流派与武器标签契合加成；
  写入 `meta.mutators`（突变因子）与 `build.mods`（改装），武器槽卡片直接显示挂件。
- **特性**：全量 43 条真特性（`cat=trait` 85 行里 42 行是 `*_Stats` 数值表分支，不是独立特性），0–10 级、上限 10；
  「流派前 10 一键满级」；数值特性仍并入防御合计，其余按维度分与效果原文展示。
- **圣物碎片**：45 条全量（原先只有 12 条防御向）；圣物 3 碎片槽、红/黄/蓝 badge、按流派推荐 3 件；
  颜色加成/棱晶机制出处为 locres（置信 mid），未证实处标「待验证」；碎片数值计入结果面板。
- **结果面板输出**：复制 Markdown / 复制 JSON / 下载 `.md` / 下载 `.json` / 打印；输出含槽位、挂件、特性、碎片、
  关键数值与口径说明。
- **装备默认全库可用（需求 7）**：实验室不再要求逐件标「已拥有」，可用池 = 全库 − 缺件；缺件可在槽位卡片/选择器/
  组合行/结果行标记，推荐/组合/替换默认排除缺件；资料库的「已拥有」仍作为个人收藏保留。
- **回归**：`qa/tests/lab-score.test.mjs` 新增 27 例（评分/组合/适配纯函数 + 零依赖守卫）；
  `qa/lib/data-schema.mjs` 扩到 10 个运行时文件（labGear 结构/维度/跨文件引用校验）；
  `qa/lib/routes.mjs` 增加 4 条新面板截图路由；修掉 `lab-engine` 用例中 `elapsedMs` 非确定性假红。
- 文档：新增 [`docs/LAB_V2.md`](docs/LAB_V2.md)（实现契约）；`docs/DATA.md` / `docs/UX_SPEC.md` / `AGENTS.md` /
  `qa/README.md` / `qa/REPORT.md` 同步更新。

## v3.6 — 2026-10-28 · 遗留问题收口（特性单一事实源 / 图标压缩 / 事件与边界修复）

- **配装特性改为单一事实源**：`build.meta.traitLevels` 为唯一权威（id→1..10 级）；旧 `build.traits` 读取时迁移为 1 级、
  不再持久化；详情「加入特性」改走 `store.build.addTrait()`（1 级、上限 10），实验室立即可见并可调等级。
  实测修复前「详情加入后实验室仍 0/10」。守卫：store/build-state 单测 + interactions I11 断言。
- **图标压缩（资产管线）**：1004 张 PNG 长边 256→148px（页面最大显示 74px/2× DPR），仓库 54.98MB→24.15MB（**-56.1%**），
  items 首屏图片 2988→1217.7KB（**-59.2%**）、总传输 11321→9410.6KB（-16.9%）；新增 `pipeline/minify_icons.py`
  （同步 `icon_index.json` 的 w/h/png_bytes/max_side），上游 `tex_build.py` 的 `MAX_SIDE` 同步为 148，`sync-data --check` 无漂移。
- **事件/边界修复**：`ui.closeOverlays({silent})` 关闭未决 confirm 时按取消结算（`components` C21 守卫）；
  实验室新增 `watchMissingBridge()`，外部写 `store.ui['lab.missing']` 时 badge/面板立即刷新；
  `lab/model.js` 的 `SLOT_LABEL` 改为引用 `labels.SLOT_ZH`（去掉重复词表）；`serve.py` 增加 ETag/Last-Modified + 304
  （开发时刷新不再重下 7MB items.json，`test_serve_security` 新增 1 例）。
- 遗留评估后仍不做：items.json 拆分、Pages 隐藏仓库文件（需改发布结构）、像素回归、CSP、未用 CSS/export default 清理、
  隐藏面板脏标记（无实测收益）、死代码 `${SYMBOL}` 扫描守卫；理由见 `docs/PERF.md` §4 与 `qa/REPORT.md` §13.8。

## v3.5 — 2026-10-28 · 第四阶段：性能、安全与长期可维护性（不新增功能、不改视觉/数值）

- **性能基准（P2-1）**：新增 `qa/perf.mjs`（零依赖 CDP，S1–S8：四领域冷启/JSON 解析/领域首开/切换/搜索筛选/
  内存/实验室穷举+帧率/390×844+CPU 4×），固定视口/主题/冷缓存、重复取中位数、自动起停 `serve.py --port 0`；
  基线从 `git worktree @14653ce`（优化前 HEAD）采，入库 `qa/perf-baseline.json`（含数据 sha256，不含临时端口/绝对路径）；
  `node qa/gate.mjs perf` 为独立参考模式（不设阈值、不进 full）。基线：items 211.9ms / codex 202.4ms / codex 8.31MB。
- **按领域加载（P2-2）**：`boot()` 不再无条件 `await api.ready()`，改为 `router.start()` + dispatch 按需
  （领域表 `bootstrap:false` 标记 codex）；模块/CSS 与数据并行；页脚统计异步。**codex 冷启传输 8.11MB→298.8KB（-96.3%）、
  JSON 4→1、firstView 202.4→77.7ms（-61.6%）**；items/lab/builds 请求/字节不变、首屏不退化。
- **渲染与计算（P2-3）**：资料库排序池缓存（Intl.Collator + WeakMap）→ 排序切换 129–145→25–30ms、名称排序搜索
  68.7→8–10ms、重复同 chip 19.7→~1ms（0 mutation）；实验室同条件指纹去重 + applyParams 空更新早退 + tableB
  WeakMap 缓存 → 场景变更穷举 2→1、完成帧 longtask 50–55ms→0、重挂载 tableB 104.7→16ms。数值/排序零变化
  （660 预设对账 + top300 逐字节快照 A/B IDENTICAL + 13 组 UI 语义一致）。
- **安全边界（P2-4）**：修复 `ui.confirm` 存档名进入 innerHTML 的**存储型 XSS**（string 一律纯文本）、`showTip`
  白名单富文本渲染（244 个真实 data-tip 取证仅 b/br）、删除 `h()` 的 `html:` 入口、`href` 统一协议白名单
  （javascript:/data:/blob:/协议相对一律拒绝）、saved 名称上限 80；`serve.py` 站点白名单（`.git`/`AGENTS.md`/`qa/`/
  `pipeline/`/`docs/`/`.github/`/隐藏文件/穿越变体 由 200→403/404）、`/api/health` 与错误体不再暴露本机绝对路径。
  新增 `qa/tests/security.test.mjs`(8) 与 `test_serve_security.py`(8) 守卫（修复前 32 处失败）。
- **缺陷修复（P2-6 审计副产品）**：跨域导航浮层残留 + body 滚动锁死、toast 悬停后不消失、缺件状态双副本漂移、
  矩阵 B 展开态被 build 变更破坏、replace 冗余订阅、calc/replace 死 root + 7 条死 CSS（像素 A/B 相同）。
- **删减与文档（P2-5/P2-6）**：死代码第一批净删 60 行（零引用导出/死常量/未用 import，引用图 + Python AST 二遍复核）；
  `AGENTS.md` 253→120 行，新增 `docs/AI_MAP.md`（模块职责/真实 import/必跑测试）与 `docs/TROUBLESHOOTING.md`
  （18 条真实症状→根因→命令→修复）；最小定位上下文 -40%、排障 -51%；修正 `DEPLOY.md`/`pipeline README` 被转义吞掉的
  `verify.ps1`、`DATA.md` 过时说明、`README.md` 旧验收命令与手抄数字。
- **真实回归教训**：死代码清理误删 `js/lab/text.js` 的 `RES_ZH`（模板字符串引用），真实浏览器才暴露
  `ReferenceError`；已恢复并修复，写入 LESSONS `#45–#49`（基线/模板引用/启动 await/性能不进硬门禁/HTML 入口收敛）。

## v3.4 — 2026-10-28 · 第三阶段：自动化验收与 AI 开发流水线（不新增功能、不改视觉）

- **统一验收入口**：新增 `qa/gate.mjs`（PowerShell 包装 `verify.ps1`）与 `qa/gate/`（env/plan/registry/report），
  一条命令取代原来「先起服务再拼 8 条命令」：`quick`（单元+审计+对比度+数据契约，**5.9s**，无浏览器）、
  `related`（按 git 改动文件映射相关检查）、`full`（16 项，含真实 Chrome 截图/交互/竞态/子路径，**706.5s**）、
  `data`（数据链路）、`deploy`（full + `deploy.py --dry-run` 预检）。门禁自动起 `serve.py --port 0`（随机端口）、
  探测 Chrome/Python/上游工作区，区分「环境不具备 SKIP」与「真失败」（关键检查被跳过 → 退出码 3，不假装通过）。
- **结构化报告与失败定位**：`qa/results/gate.json`（mode/env/plan/checks/summary；每项含
  status/total/pass/fail/skip/module/error/failed[]/log/artifacts/hint/repro）+ `qa/results/logs/<id>.log`；
  控制台中文摘要给出实际执行环境、逐项耗时、失败用例、日志尾部与复跑命令。
- **新增工程回归测试**（零依赖，全部纳入门禁）：`router.test.mjs` 10（URL 解析/序列化/回退/地址栏归属）、
  `build-state.test.mjs` 7（配装 vs 拥有/收藏隔离）、`lab-engine.test.mjs` 16（计算确定性/不污染输入/公式不变量/
  660 预设对账）、`components.browser.mjs` 20（states/panel 真实 DOM 契约）、`navigation.browser.mjs` 7
  （同 tick 路由竞态/同路径参数快切/深链刷新/未知领域回退/卸载清理/子路径）、`env.test.mjs` 20
  （Chrome 探测/子路径工具/静态守卫）、`gate.test.mjs` 15（门禁自身：解析器/跳过判定/改动映射/registry-文档一致性）。
- **数据 Schema 与契约**：新增 `qa/lib/schema.mjs` + `qa/lib/data-schema.mjs`（9 个运行时 JSON 的结构/类型/唯一性/
  跨文件引用/版本兼容；RFC6901 Pointer 精确定位），`data-schema.test.mjs` 38（真实数据 errors=0 + 内存负向夹具）。
  真实数据仅 3 类已知 warning（icon_asset 23 条 / inherent_mod 6 条 / icon_index failures 4 条），**未改任何数据**。
- **数据同步异常处理**：`pipeline/sync-data.py` 在 plan 阶段校验源 JSON 语法，损坏 → `路径:行:列` + 退出码 2 + 零写入
  （`--check` 同样生效）；`test_sync_data.py` 23→30（缺失源/损坏/无工作区/连续 --check/重复同步幂等）。
- **环境自适应与子路径**：`qa/lib/cdp.js` 新增 `resolveChrome()`（CHROME_PATH → 平台候选 → where/which，
  失败给修复建议），`qa/shot.js` 删除硬编码 Chrome 路径；新增 `qa/lib/routes.mjs`（27 条路由唯一来源，
  shot 与 gate 共用，gate 用推导条数校验截图总数）；`serve.py` 新增 `--prefix /relic-archive` 本地复现 Pages 子路径
  （`/`→302、缺前缀 404）；`qa/interactions.js` 页面内根绝对路径全部改为 `prefixOf(base)`：
  **根路径 67/67、子路径 67/67 全真跑**；`test_serve_prefix.py` 7 例覆盖前缀/health/目录穿越。
- **CI 只测试不部署**：新增 `.github/workflows/qa.yml`（push/PR 跑 `quick`→`data`→`full`，失败也归档报告），
  GitHub Pages 仍是 legacy 静态零构建（ADR-5 修订）；CI 红只代表测试红，发布仍由 `pipeline/deploy.py` 验证线上内容指纹。
- **验收规则进入 AGENTS.md**：§1 一个入口 + §1.1「改动类型 → 最少验收」矩阵（UI/状态/数据/路由/计算/测试/发布），
  基线只认 `qa/baselines.json`（`--update-baseline` 维护，门禁拦截用例被静默删除/跳过，文档不再手抄数字）。
- **门禁结果**：`node qa/gate.mjs full` → **16 PASS / 0 FAIL / 0 SKIP（环境阻断 0），706.5s**：
  unit-js 175、unit-py 37、audit 0 FAIL、contrast 130、data-builds 1、data-schema 38、data-sync 无漂移、
  shot-dark/light 各 54、shot-subpath 25、interactions 67、lifecycle 25、lab-async 8、components 20、nav 6+1skip、nav-subpath 7。

## v3.3 — 2026-10-28 · 第二阶段：工程架构收口与开发工具化（不新增功能、不改视觉）

- **领域注册表**（新增 `js/domains.js`）：领域的 id / 中文名 / 标题 / 图标 / 路径 / 快捷键 / 顶栏角标 / 视图样式 /
  视图懒加载器收敛为一张表。导航、文档标题、Alt+数字、视图与样式加载、未知领域兜底全部数据驱动；
  `js/core/router.js` 不再认识具体领域，`index.html` 去掉硬编码导航与 4 个 view CSS link（改为进入领域时注入，
  且**样式先于挂载**，无样式首屏风险已用延迟 CSS 的 CDP 实验证伪）。新增领域从「改 4 个文件」降为
  「`domains.js` 加一项 + 新建视图与样式」。
- **大型视图拆分**（行为/视觉不变，均用旧代码冻结快照做逐叶子 DOM diff 验证）：
  - 资料库 `views/library.js` 1436→1077，新增纯函数 `library/query.js`（状态/序列化/过滤/排序，依赖注入）、
    `library/present.js`（展示模型）、`library/export.js`（CLI 查询导出）。
  - 流派 `views/builds.js` 908→172，新增 `builds/{ui,list,detail}.js`。
  - 道具详情 `components/item-detail.js` 605→219，九个内容区块移到 `item-detail-sections.js`（改某个区块只读一个函数）。
  - 实验室 `lab/workbench.js` 651→101，拆出 `wb-slots.js` / `wb-settings.js` / `wb-result.js`；
    `views/lab.js` 面板改为**单表注册**（`PANELS = {id,zh,icon,title,paramKeys,create}`），
    「新增一个实验室面板」从 5 处改动降为「新建面板模块（约 10 行）+ 注册 6 行」。
- **共享能力收口为唯一实现**：`components/states.js`（空/错误/载入，替换 8 处手写与 3 种标题标签）、
  `components/panel.js` + `panelHead()`（替换 3 份面板骨架）、`core/labels.js` 的道具文本规则
  （`zhDisplay`/`effectZhSentence`/`EFFECT_CATS`/`FAMILY_GROUPS`，替换 3 处重复）、`core/task.js` 新增
  `createRefresh()`（合并刷新 + 可取消）、`core/router.js` 新增 `replaceSilently()`（装饰性地址栏同步不派发）、
  `lab/model.js` 的身份解析（`nameOf`/`iconOf`，替换 3 处）、`fmt.round`、`createScope` 替换 6 处手写清理。
- **路由与交互归属统一**：详情组件不再写 URL（删除 `route` 开关与 `history.replaceState`/`router.go`），
  URL 归调用方视图（资料库：打开 `replaceSilently`、关闭 `router.go(detailReturnPath)`）；
  路由变化仍只由 `js/main.js` 单点分发；抽屉/弹窗/Toast 生命周期仍只在 `core/ui.js`。
- **顺手修掉的既有小问题**：资料库「套装部件行」打开详情时漏记 `detailOpenId`（关闭浮层时状态脱节）；
  菜单「复制 PowerShell」里的 CLI 路径因 JS 字符串 `\b`/`\r` 变成控制字符（改为 `String.raw`）；
  `ui.openDrawer` 的死参数（`route`/`closeOnScrim`）与「200ms 关闭过渡期间重开会被旧回调清掉」的竞态；
  `picker` 聚焦定时器无守卫；`codex` 手拼面板头。
- **架构守卫测试**（新增 `qa/tests/architecture.test.mjs`，16 条）：解析真实 import 图，断言分层方向、
  无循环依赖、只有 main 订阅路由、只有 router 写地址栏、详情组件无 URL、领域清单唯一、
  空态/面板/文本规则单一权威、纯计算模块不触 DOM。重构前 8/16 红 → 重构后 16/16 绿。
- **新回归测试**：`qa/tests/library-query.test.mjs`（21 例：状态往返/排序可用性/过滤组合/计数口径/导出）；
  同步更新 `AGENTS.md` 必跑命令与任务配方、新增 [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)（分层规则 + 模块地图 +
  六类高频任务配方）、`docs/LESSONS.md` §2.8（#29–#36）。
- **发布工具化**：新增 `pipeline/deploy.py`（一行 `python pipeline/deploy.py`）：预检分支/工作树 → 系统 Git 推送 →
  校验远端 sha = 本地 HEAD → 用本次改动的站点资源做内容指纹轮询，确认 GitHub Pages 真的重建完成 →
  关键资源探活 + 线上 `qa/shot.js` 冒烟。发布不再靠「等一会儿刷新看看」，也不引入 CI（Pages legacy 仍是推送即重建）。
- 门禁结果：`shot 54/54 × 2`、`interactions 67/67`、`audit 0 FAIL`、`contrast 130/130`、
  `node --test 69/69`、`lifecycle 25/25`、`lab-async 8/8`、`test_sync_data.py 23 OK`、
  `mk_builds_json.py --check` 与 `sync-data.py --check` 均 0；全新 clone 集成复验通过。

## v3.2 — 2026-10-28 · 第一阶段可靠性治理（不新增功能）

- **数据同步** `pipeline/sync-data.py`：修复图标同步 `rows.append()` 多参数导致的确定性崩溃（新增/更新图标必崩，
  且此前已写入部分文件）；改为「先完整计划/校验 → 再原子落盘（临时文件 + `os.replace`）→ 失败回滚」，
  退出码明确区分 `0 成功/已最新`、`1 --check 漂移`、`2 工作区缺失/不完整`、`3 写盘失败已回滚`；
  `--check` 严格只读；文本 JSON 按换行归一比较并统一 LF 落盘（修掉长期假红的 5 文件 CRLF 漂移）；
  上游已删除图标只报告「快照独有」不擅自删除。
- **实验室异步计算** `js/lab/recommend.js`：分帧穷举加代际版本控制——运行中改条件立即失效重算，
  完成回调只在「仍是当前代际」时落地（最终结果对应最后一次有效条件）；离开页面取消分帧，
  不再对卸载 DOM 产生过期写入；计算异常显示可重试失败态。
- **页面生命周期** `js/main.js` + 四个视图：异步 `dispatch` 代际化（快速 A→B→C 不再旧页面后挂载/双实例）；
  错误态重试从干净状态重挂；视图 `load().then/.catch`、`setTimeout`、`requestAnimationFrame`、document 监听
  在 unmount 后全部失效并成对释放；删除 codex 视图里与 main 重复的 `router.onChange` 订阅。
- **持久化状态** `js/core/store.js` + `js/lab/state.js`：localStorage 读取全量白名单归一（坏 JSON /
  错误类型不再导致启动白屏；owned/fav/build/saved/ui 非法字段降级、合法数据保留）；旧档迁移只在
  「新键缺失或归一后为空」时发生且绝不覆盖有效新数据；写入失败 emit `storage-error` 并在顶栏 toast
  提示（不再静默假装保存）。
- **新增基础设施** `js/core/task.js`（createEpoch / createTaskRunner / createScope，零依赖）。
- **回归测试**（零依赖，纳入 `AGENTS.md` 必跑命令）：`qa/tests/task.test.mjs` 6、`store.test.mjs` 23、
  `lifecycle.browser.mjs` 25、`lab-async.browser.mjs` 8、`test_sync_data.py` 23。
- 门禁结果：`shot 54/54 × 2`、`interactions 67/67`、`audit 0 FAIL`、`contrast 130/130`、`sync-data.py --check` 0。

## v3.1 — 2026-10-28 · 仓库化发布

- 站点整理成**自包含仓库** `.mimocode/relic-archive/`（git 追踪约 1088 个文件，工作树约 70 MB）；
  页面、运行时数据快照、1004 张图标、QA、数据生成脚本全部入库，clone 即跑。
- **GitHub Pages 发布**：https://stollor.github.io/relic-archive/
  （`main / (root)`、legacy 构建、`.nojekyll`；推送后 20–60s 自动重建）。
- 资源路径改为**相对路径**（`./data/*`、`./assets/*`），根路径与子路径部署通用。
- 数据分层：`.mimocode/data/` 权威工作副本 → `pipeline/sync-data.py` → `relic-archive/data/` 发布快照；
  `data/builds.json` 只在仓库内由 `pipeline/mk_builds_json.py` 生成。
- 文档沉淀：新增 `AGENTS.md`（AI 入口）、`docs/LESSONS.md`（经验与 ADR）、`docs/DEPLOY.md`（发布手册）、
  本 `CHANGELOG.md`；`README` 加文档地图。
- 线上验收：dark 桌面 25/25、light 移动 15/15 全 PASS，0 console error。

## v3.0 — 2026-10-28 · 流派 + 亮暗双主题

- 新增第四领域 **流派** `#/builds`：旧独立配装站（`build/site` 7 个 1.5 MB 页面）并入统一站点；
  列表（按目标选 / 7 卡 / 对比表 / 配装规则）+ 详情（伤害链条 / 武器 / 护甲 / 饰品 / 职业天赋 /
  装配说明 / 循环 / 替换 / 清群 / 难点 / 饰品乘区 / 口径），道具 chip 可点统一详情，「装入实验室」一键 15 槽。
- 流派数据 `data/builds.json`（7 套 + 200 条道具摘要 + 护甲混搭 + 规则口径 + i18n 文本实体），
  由 `pipeline/mk_builds_json.py` 生成，`--check` 校验引用完整性。
- **亮/暗双主题**（《遗迹2》气质）：`css/tokens.css` 双调色板（黑曜石/黄铜金/青瓷 ↔ 羊皮纸/深铜/锈红），
  `js/theme-boot.js` 首屏防闪 + `js/core/theme.js` 三态（自动/白天/黑夜）、`Alt+T`、持久化；
  52 处硬编码色收敛为 token，130 组 WCAG AA 全通过。
- 目录整理：`.mimocode` 5.0 GB → 3.7 GB（删 1.44 GB 开发期截图/缓存，归档 478 MB 旧站/视频/大文本）。
- 验收：shot 54/54 × 双主题、interactions 67/67、audit 0 FAIL、contrast 130/130。

## v2.1 — 2026-10-27 · 效果原文优先

- 新增 `data/item_effects.json`（323 条官方效果句）：详情/列表首位展示机制原文（不再只剩数值），
  风味描述保留为「背景」；搜索命中效果句。
- 术语收口：Relic → 圣物、GreyHealth → 灰色生命、Status → 状态效果、Summon → 召唤物。
- 验收：shot 36/36、interactions 59/59、audit 0 FAIL。

## v2.0 — 2026-10-27 · 单页应用 + 一套设计系统

- 旧「道具库 + 独立 lab.html」两套页面合并为**单页应用 + 一套设计系统**：
  `#/items` 资料库 / `#/lab` 实验室（15 槽工作台 + 推荐/替换/档位/计算器/存档）/ `#/codex` 知识库。
- 详情统一组件：桌面居中弹窗 / 移动全屏抽屉；全站唯一装备选择器；`store` 三层状态（owned/fav/build）。
- 视觉：`tokens.css` 唯一色值来源、100 个内联 SVG 图标、焦点环/减少动效/点击区 ≥32px。
- 验收：shot 22/22、interactions 40/40、audit 0 FAIL；引擎与 Python 实现 330/330 一致。

## v1.x — 2026-10-22 ~ 10-27 · 数据管线与早期站点

- 离线解包《遗迹2》IoStore → `items.json`（1894 条 / 1126 件真道具）→ 图标 1004 张。
- 护甲/体力公式与工具链（`A/(A+200)`、负重档位、闪避帧、60 万组合穷举）；
  早期独立护甲页 `lab.html`、独立配装站 `build/site`（已归档到 `archive/`）。
- CLI：`bin/rmn2.cmd search/show/build`（SQLite FTS5）。
