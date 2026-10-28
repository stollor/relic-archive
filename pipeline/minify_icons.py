#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""把站点运行时图标压缩到显示尺寸（P2): 256px/56KB → ≤148px（2× 最大显示 74px），首屏约 -70% 传输。

背景（`docs/PERF.md` §4）：
  页面最大显示尺寸 74×74（桌面网格）、64×64（移动）、40×40（列表）；2× DPR 只需 148px。
  发布快照里的 PNG 由上游 tools/tex_build.py 生成到 ≤256px（无损 optimize），对 74px 显示过大。
  本脚本把 `assets/icons/*.png` 长边缩到 `--max`（默认 148），同步更新 `data/icon_index.json` 的
  w/h/png_bytes/max_side，保证「索引与实际文件一致」（`qa/lib/data-schema.mjs` 与 `gate data` 会校验）。

用法（在站点仓库根；需要 Pillow，仅发布数据时用；运行时/部署零依赖）：
  python pipeline/minify_icons.py --check     # 只报告将缩小多少（不写盘）
  python pipeline/minify_icons.py --apply     # 实际缩放并更新 icon_index.json
  python pipeline/minify_icons.py --apply --max 208   # 换目标尺寸（如 2.8× DPR 屏）

注意：
  · 只缩不放；已是 ≤max 的文件不改；
  · `src_w/src_h` 保留原始 cooked 纹理尺寸，`w/h` 表示当前 PNG 尺寸；
  · 重跑上游 `tools/tex_build.py` 后需再执行本脚本（或把 MAX_SIDE 调到 148 后重生成）。
退出码：0 成功 / 1 校验失败（索引与文件不一致） / 2 用法错误 / 3 缺少 Pillow。
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
INDEX = REPO / "data" / "icon_index.json"
ICONS = REPO / "assets" / "icons"


def human(n: int) -> str:
    return f"{n / 1024:.1f} KB" if n < 1024 * 1024 else f"{n / 1048576:.2f} MB"


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="压缩站点图标到显示尺寸并同步 icon_index.json")
    g = ap.add_mutually_exclusive_group()
    g.add_argument("--check", action="store_true", help="只报告（默认行为）")
    g.add_argument("--apply", action="store_true", help="实际缩放并写盘")
    ap.add_argument("--max", type=int, default=148, help="长边目标像素（默认 148 = 2× 74px 显示）")
    args = ap.parse_args(argv)
    if args.max < 40 or args.max > 256:
        print(f"[icons] --max 需在 40..256：{args.max}", file=sys.stderr)
        return 2
    try:
        from PIL import Image
    except ImportError:
        print("[icons] 缺少 Pillow（pip install pillow）——该脚本只在发布数据时需要", file=sys.stderr)
        return 3
    if not INDEX.is_file():
        print(f"[icons] 找不到索引：{INDEX}", file=sys.stderr)
        return 1
    doc = json.loads(INDEX.read_text(encoding="utf-8"))
    icons = doc.get("icons") or {}
    if not isinstance(icons, dict) or not icons:
        print("[icons] icon_index.json 中没有 icons", file=sys.stderr)
        return 1

    before = 0
    after = 0
    changed = 0
    missing = 0
    for name, rec in icons.items():
        path = ICONS / f"{name}.png"
        if not path.is_file():
            missing += 1
            continue
        before += path.stat().st_size
        with Image.open(path) as im:
            w, h = im.size
            if max(w, h) <= args.max:
                after += path.stat().st_size
                continue
            scale = args.max / max(w, h)
            size = (max(1, round(w * scale)), max(1, round(h * scale)))
            if not args.apply:
                changed += 1
                after += int(path.stat().st_size * (size[0] * size[1]) / (w * h))  # 粗估
                continue
            out = im.convert("RGBA").resize(size, Image.LANCZOS)
            out.save(path, "PNG", optimize=True)
            rec["w"], rec["h"] = size
            rec["png_bytes"] = path.stat().st_size
            after += rec["png_bytes"]
            changed += 1
    if missing:
        print(f"[icons] 警告：{missing} 条索引没有对应 PNG（失败项），跳过", file=sys.stderr)

    if args.apply:
        doc["max_side"] = args.max
        INDEX.write_text(json.dumps(doc, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")

    print(f"[icons] {'应用' if args.apply else '预计'}：{changed} 个文件 / {len(icons)} 条索引，"
          f"{human(before)} → {human(after)}（-{(1 - after / before) * 100:.1f}%），目标长边 {args.max}px")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
