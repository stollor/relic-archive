# CHANGELOG — 站点演进记录

> 只记「形态/能力」级变更与关键数字；细枝末节的改动见 `git log`。
> 早期里程碑来自 `.mimocode` 工作区历史（站点曾是工作区内的 `web/`）。

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
