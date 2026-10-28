# CHANGELOG — 站点演进记录

> 只记「形态/能力」级变更与关键数字；细枝末节的改动见 `git log`。
> 早期里程碑来自 `.mimocode` 工作区历史（站点曾是工作区内的 `web/`）。

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
