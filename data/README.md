# `data/` — 站点运行时数据

本目录是**站点唯一的数据源**（随仓库分发，clone 即可跑）。字段与来源、已知限制见
[`../docs/DATA.md`](../docs/DATA.md)；生成与同步见 [`../pipeline/README.md`](../pipeline/README.md)。

| 文件 | 大小 | 内容 |
|---|---:|---|
| `items.json` | 7.0 MB | 主数据集 schema v1.4，1894 条（其中 `is_item=true` 1126 件真道具） |
| `builds.json` | 291 KB | 流派 7 套（评分 / 槽位 / 循环 / 替换 / 清群 / 饰品乘区 / 装配说明）+ 200 条道具摘要 + 规则口径 |
| `site_data.json` | 730 KB | 实验室数据（护甲 121 / 饰品效果 141 / 6 场景 / 11 增益档 / 330 预设 / 缺件替代） |
| `archetypes.json` | 30 KB | 16 个职业（官方译名；含 2 个 DLC4 未实装） |
| `terms.json` | 17 KB | 术语 / 伤害类型 / 槽位 / 获取难度 / 23 个游戏标签 / 7 类效果分类 |
| `acq.json` | 52 KB | 获取途径文本 + 难度 + DLC（未收录留空，不编造） |
| `item_effects.json` | 151 KB | 官方效果句 323 条（游戏内 tooltip 机制原文） |
| `icon_index.json` | 525 KB | 道具资产 → `assets/icons/*.png` 的索引 |
| `codex/index.json` | 77 KB | 知识库 13 篇（分类/结论/公式/表格/证据/来源） |

图标本体在 [`../assets/icons/`](../assets/icons/)（1004 张 PNG）。

## 从哪来 / 怎么更新

- 上游 `.mimocode` 工具链生成 → `python pipeline/sync-data.py` 快照进本目录；
- `builds.json` 只在本仓库维护：`python pipeline/mk_builds_json.py`（源数据在 `pipeline/_source/`）；
- 改完跑 `pipeline/mk_builds_json.py --check` 与 `qa/` 门禁再提交。

> 本目录的 `README.md` 会在上游 `tools/enrich_v14.py` 重写 `../data/README.md` 时不受影响；
> 站点数据更新请走 `pipeline/sync-data.py`，不要手工覆盖。
