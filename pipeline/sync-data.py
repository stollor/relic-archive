#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""站点运行时数据同步（开发用）：从 `.mimocode` 工作区把「站点需要的数据」快照进本仓库。

本仓库是**自包含站点**：data/ 与 assets/ 都在仓库内，clone 下来 `python serve.py` 即可跑。
上游解包/配装工具链在 `.mimocode`（不在本仓库），它生成/更新数据后，用它把新快照同步进来：

    python pipeline/sync-data.py            # 同步运行时数据 + 图标（默认都做）
    python pipeline/sync-data.py --check    # 只比对，不写盘（CI/提交前自检）
    python pipeline/sync-data.py --no-icons # 只同步 data/（图标没变时更快）

数据流向：
    .mimocode/data/*.json          → data/*.json            （7 个运行时文件 + codex/index.json）
    .mimocode/assets/icons/*.png   → assets/icons/*.png     （1004 张，仅复制有变化的）
    .mimocode/build/ui_data.json 等 → pipeline/_source/     （配装源快照，供 mk_builds_json.py）

注意：`data/builds.json` 不在同步范围内，它只由 `pipeline/mk_builds_json.py`
从 `_source/` 生成（站点是唯一权威副本）。
"""
from __future__ import annotations

import argparse
import hashlib
import shutil
import sys
from pathlib import Path

SITE = Path(__file__).resolve().parent.parent
WORKSPACE = SITE.parent                      # .mimocode

# 运行时数据（前端直接 fetch 的）——builds.json 不在其中：它是站点自己的生成物
# （python pipeline/mk_builds_json.py），上游工作区不再保留副本。
DATA_FILES = [
    "items.json", "icon_index.json", "site_data.json", "terms.json",
    "acq.json", "archetypes.json", "item_effects.json",
]
CODEX_FILES = [("data/codex/index.json", "data/codex/index.json")]
# 配装源快照（mk_builds_json.py 的输入）
SOURCE_FILES = [
    "build/ui_data.json", "build/loadouts.json", "build/builds.json",
]


def digest(p: Path) -> str:
    h = hashlib.sha256()
    with p.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def copy_if_changed(src: Path, dst: Path, *, dry: bool, label: str) -> tuple[str, int]:
    """返回 (状态, 字节数)：状态 ∈ 新增 / 更新 / 相同 / 缺失。"""
    if not src.is_file():
        return ("缺失", 0)
    size = src.stat().st_size
    if dst.is_file() and dst.stat().st_size == size and digest(src) == digest(dst):
        return ("相同", size)
    status = "更新" if dst.is_file() else "新增"
    if not dry:
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src, dst)
    return (status, size)


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="把 .mimocode 工作区的运行时数据/图标快照同步进站点仓库")
    ap.add_argument("--check", action="store_true", help="只比对不写盘（有差异时退出码 1）")
    ap.add_argument("--no-icons", action="store_true", help="跳过 assets/icons 同步")
    ap.add_argument("--quiet", action="store_true")
    args = ap.parse_args(argv)
    dry = args.check
    log = (lambda *a: None) if args.quiet else print

    if not (WORKSPACE / "data" / "items.json").is_file():
        print(f"[x] 找不到工作区数据：{WORKSPACE/'data/items.json'}", file=sys.stderr)
        print("    本脚本只用于从 .mimocode 工作区更新快照；单独 clone 的仓库不需要它。", file=sys.stderr)
        return 2

    totals = {"新增": 0, "更新": 0, "相同": 0, "缺失": 0}
    rows = []

    def run(pairs, group):
        for rel_src, rel_dst in pairs:
            status, size = copy_if_changed(
                WORKSPACE / rel_src, SITE / rel_dst, dry=dry, label=rel_dst)
            totals[status] = totals.get(status, 0) + 1
            if status in ("新增", "更新", "缺失"):
                rows.append((rel_dst, status, size))

    run([("data/" + rel, "data/" + rel) for rel in DATA_FILES], "data")
    run(CODEX_FILES, "data")
    run([(rel, "pipeline/_source/" + Path(rel).name) for rel in SOURCE_FILES], "pipeline/_source")

    icon_copied = 0
    if not args.no_icons:
        src_dir, dst_dir = WORKSPACE / "assets" / "icons", SITE / "assets" / "icons"
        icons = sorted(src_dir.glob("*.png")) if src_dir.is_dir() else []
        if not icons:
            print(f"[!] 工作区图标缺失：{src_dir}", file=sys.stderr)
        for p in icons:
            status, size = copy_if_changed(p, dst_dir / p.name, dry=dry, label=p.name)
            totals[status] = totals.get(status, 0) + 1
            if status in ("新增", "更新"):
                icon_copied += 1
                rows.append(f"assets/icons/{p.name}", status, size)
        log(f"[i] 图标：{len(icons)} 张，本次变化 {icon_copied} 张")

    for rel, status, size in rows[:40]:
        log(f"  {status:>2}  {rel}  ({size/1024:.0f} KB)")
    if len(rows) > 40:
        log(f"  … 其余 {len(rows)-40} 条省略")

    log(f"[i] 结果：新增 {totals['新增']} / 更新 {totals['更新']} / 相同 {totals['相同']} / 缺失 {totals['缺失']}")
    if dry:
        diff = totals["新增"] + totals["更新"] + totals["缺失"]
        log("[i] --check：未写盘" + ("，存在差异（退出码 1）" if diff else "，快照已是最新"))
        return 1 if diff else 0
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
