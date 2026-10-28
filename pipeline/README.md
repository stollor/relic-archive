# pipeline — 站点数据生成与同步（开发用）

本仓库是**自包含站点**：`data/`、`assets/` 都在仓库内，`python serve.py` 就能跑，不需要任何外部工具。
本目录只负责「上游数据 → 仓库内快照」这一层，方便你改数据或复现。

```
pipeline/
├─ mk_builds_json.py   # 生成 data/builds.json（流派视图的唯一数据源）
├─ sync-data.py        # 从 .mimocode 工作区同步运行时数据/图标快照（开发用）
├─ deploy.py           # 一键发布：推送 → 等 GitHub Pages 自动重建 → 线上冒烟
├─ _source/            # 配装源数据快照（上游 build/ui_data.json、loadouts.json、builds.json）
└─ README.md
```

## 1. 目录里哪些是「上游产物」，哪些是「仓库内数据」

| 仓库内路径 | 内容 | 再生方式 |
|---|---|---|
| `data/items.json` | 1894 条道具主数据（1126 件真道具） | 上游解包+解析链 `.mimocode/tools/build_items.py` → `enrich_v14.py` |
| `data/icon_index.json` + `assets/icons/*.png` | 1004 张图标与索引 | 上游 `.mimocode/tools/tex_build.py` |
| `data/site_data.json` | 实验室数据（护甲/饰品/预设/矩阵） | 上游 `.mimocode/build/armor_tool/` |
| `data/archetypes.json` / `terms.json` / `acq.json` / `item_effects.json` | 职业 / 术语 / 获取途径 / 官方效果句 | 上游 `.mimocode/build/mk_*.py` |
| `data/codex/index.json` | 知识库 13 篇 | 人工整理（直接编辑） |
| `data/builds.json` | **流派 7 套** | `python pipeline/mk_builds_json.py`（本例程） |

上游工具链（解包、护甲优化、wiki 抓取等）体量大（数 GB 原始资产），**不包含在本仓库**；
本仓库保留的是「跑动站点所需的最小数据集」与「配装合并脚本」。

## 2. 重新生成流派数据

```bash
# 用仓库内 _source/ 快照（推荐，自包含）
python pipeline/mk_builds_json.py --check     # 只校验：所有引用能否解析
python pipeline/mk_builds_json.py             # 写 data/builds.json

# 直接读上游 .mimocode/build/（改了上游数据后）
python pipeline/mk_builds_json.py --source ../../build
```

校验项：每套配装的槽位/护甲/武器改装 id 必须能在 `data/items.json` 找到，或是
`_source/builds.json` 的 `i18n` 里登记过的纯文本实体（遗物碎片 / 棱镜传奇词条），
否则视为坏引用（脚本会逐条列出）。

## 3. 从工作区同步快照（仅开发机）

```bash
python pipeline/sync-data.py --check   # 只比对（有差异退出码 1，适合提交前自检）
python pipeline/sync-data.py           # 同步 data/ 8 个运行时文件 + codex + 图标 + _source
python pipeline/sync-data.py --no-icons
```

- 文本 JSON 按**换行归一**（`\r\n` / 孤立 `\r` → `\n`）后的内容比较：仅换行不同视为「相同」，
  不复制、不算漂移，输出会统计「仅换行差异 N 个」。同步文本文件时统一按 **LF 落盘**（仓库约定，
  见 `.gitattributes`），PNG 等二进制原样复制；上游 `.mimocode` 文件永不改写。
- `--check` **严格只读**（不写文件、不建目录、不改 mtime），只有按归一后内容判断的漂移
  （新增/更新）才退出码 1。
- 退出码：`0` 成功/已是最新；`1` `--check` 有漂移；`2` 环境缺失或不完整（单独 clone 没有
  `.mimocode` 工作区、必需源文件或图标源缺失，不写盘也不删快照）；`3` 写盘失败（已回滚本次
  已写入的文件：新增的删除、更新的恢复原内容与原 mtime）。
- 上游已删除、但快照里仍存在的图标默认**不删除**，输出「快照独有 N 个」提示（`--check`
  不计为漂移，避免门禁因历史残留误红）。
- 写盘前先做完整计划与源文件校验，单文件用「同目录临时文件 + `os.replace`」原子替换；
  可反复运行，第二次应全部「相同」。

单独 clone 本仓库时**不需要**它。

## 4. 改了数据之后必须做的

```bash
python pipeline/mk_builds_json.py --check      # 引用完整性
node qa/shot.js --theme dark && node qa/shot.js --theme light   # 截图/console 门禁
node qa/interactions.js                        # 交互契约（67 项）
python qa/audit.py                             # 静态审计（硬编码色/裸英文/a11y）
node qa/theme-contrast.mjs                     # 双主题对比度（130 组）
```

全部通过再提交。门禁说明见 `qa/REPORT.md`。

提交后发布用一键脚本（推送 + 等 Pages 自动重建 + 线上验收，详见 [`docs/DEPLOY.md`](../docs/DEPLOY.md) §2）：

```bash
python pipeline/deploy.py                    # 推送 main 并等到线上内容真的换成本次提交
python pipeline/deploy.py --dry-run          # 只看计划，不推送
python pipeline/deploy.py --verify-only      # 手动 push 后复验
python pipeline/deploy.py --skip-browser     # 跳过线上浏览器门禁（更快）
```
