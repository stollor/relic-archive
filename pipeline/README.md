# pipeline — 站点数据生成与同步（开发用）

本仓库是**自包含站点**：`data/`、`assets/` 都在仓库内，`python serve.py` 就能跑，不需要任何外部工具。
本目录只负责「上游数据 → 仓库内快照」这一层，方便你改数据或复现。

```
pipeline/
├─ mk_builds_json.py   # 生成 data/builds.json（流派视图的唯一数据源）
├─ sync-data.py        # 从 .mimocode 工作区同步运行时数据/图标快照（开发用）
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

只复制有变化的文件（sha256 比对），可反复运行。单独 clone 本仓库时**不需要**它。

## 4. 改了数据之后必须做的

```bash
python pipeline/mk_builds_json.py --check      # 引用完整性
node qa/shot.js --theme dark && node qa/shot.js --theme light   # 截图/console 门禁
node qa/interactions.js                        # 交互契约（67 项）
python qa/audit.py                             # 静态审计（硬编码色/裸英文/a11y）
node qa/theme-contrast.mjs                     # 双主题对比度（130 组）
```

全部通过再提交。门禁说明见 `qa/REPORT.md`。
