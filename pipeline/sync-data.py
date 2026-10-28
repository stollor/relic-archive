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

文本换行：仓库约定 LF（见 .gitattributes）。JSON 文本按「换行归一（\\r\\n / 孤立 \\r → \\n）
后的内容」比较；仅换行不同视为「相同」，不复制、不算漂移，并在输出中统计。非 --check
同步文本文件时按归一后的 LF 字节落盘，二进制（PNG）原样复制；绝不改写上游 .mimocode 文件。

写入语义：
    - 先完整规划、校验全部源文件，再落盘；单文件用「同目录临时文件 + os.replace」原子替换。
    - 落盘前对所有 .json 源做**语法层完整性校验**（解析失败报 路径:行:列 + 退出码 2，
      一个字节都不写）；字段/引用契约不在这里做（由 qa/lib/data-schema.mjs 负责）。
    - 中途失败会回滚本次已写入的文件（新增的删除、更新的恢复原内容与原 mtime），退出码 3。
    - `--check` 严格只读：只做 stat/读字节/比对，不写文件、不建目录、不改 mtime。
    - 上游已删除、但仓库快照里仍存在的图标：默认不删除，只统计并提示（快照独有）。
      必需的数据/配装源文件缺失视为工作区不完整（退出码 2），不静默当 0，也不删快照。

退出码：
    0 成功（含已是最新；`--check` 无漂移）
    1 `--check` 发现漂移（按换行归一后的内容判断；快照独有不计为漂移）
    2 环境缺失/不完整（单独 clone 没有 .mimocode 工作区、必需源文件缺失、图标源缺失、
      源 JSON 语法损坏）
    3 同步写盘失败（已尽力回滚；若回滚未完全成功会在信息中列出）

注意：`data/builds.json` 不在同步范围内，它只由 `pipeline/mk_builds_json.py`
从 `_source/` 生成（站点是唯一权威副本）。
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import sys
import tempfile
from dataclasses import dataclass
from pathlib import Path

SITE = Path(__file__).resolve().parent.parent
WORKSPACE = SITE.parent                      # .mimocode

EXIT_OK = 0
EXIT_DRIFT = 1
EXIT_ENV = 2
EXIT_SYNC_FAILED = 3

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


class SyncError(RuntimeError):
    """写盘阶段失败；消息中说明失败文件与回滚结果。"""


class _ApplyFailure(Exception):
    """单个文件写盘失败（内部异常，统一在 apply_changes 里回滚并转成 SyncError）。"""

    def __init__(self, rel_dst: str, cause: BaseException):
        super().__init__(f"写入 {rel_dst} 失败：{cause}")
        self.rel_dst = rel_dst
        self.cause = cause


@dataclass(frozen=True)
class Change:
    """一个待落盘的变更（新增 / 更新）。"""

    rel_dst: str
    src: Path
    dst: Path
    status: str
    size: int
    text: bool


def digest(p: Path) -> str:
    h = hashlib.sha256()
    with p.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def normalize_text(data: bytes) -> bytes:
    """换行归一：CRLF 与孤立 CR 都统一成 LF（仓库约定，见 .gitattributes）。"""
    return data.replace(b"\r\n", b"\n").replace(b"\r", b"\n")


def is_text(rel: str) -> bool:
    """同步清单里只有 JSON 文本按换行归一处理；PNG 等按二进制原样处理。"""
    return Path(rel).suffix.lower() == ".json"


def file_status(src: Path, dst: Path, *, text: bool) -> tuple[str, int, bool]:
    """返回 (状态, 落盘字节数, 是否仅换行差异)；状态 ∈ 新增 / 更新 / 相同。

    文本文件比较换行归一后的字节：仅换行不同时返回 ("相同", ..., True)。
    二进制文件按原始大小 + sha256 比较。
    """
    if text:
        raw_src = src.read_bytes()
        payload = normalize_text(raw_src)
        size = len(payload)
        if not dst.is_file():
            return "新增", size, False
        raw_dst = dst.read_bytes()
        if normalize_text(raw_dst) == payload:
            return "相同", size, raw_dst != raw_src
        return "更新", size, False

    size = src.stat().st_size
    if not dst.is_file():
        return "新增", size, False
    if dst.stat().st_size == size and digest(src) == digest(dst):
        return "相同", size, False
    return "更新", size, False


def _copy_atomic(src: Path, dst: Path) -> None:
    """二进制文件：同目录临时文件 + os.replace 原子替换。"""
    dst.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp_name = tempfile.mkstemp(
        dir=str(dst.parent), prefix=f".{dst.name}.sync-", suffix=".tmp")
    os.close(fd)
    tmp = Path(tmp_name)
    try:
        shutil.copy2(src, tmp)
        os.replace(tmp, dst)
    except BaseException:
        tmp.unlink(missing_ok=True)
        raise


def _write_bytes_atomic(dst: Path, data: bytes) -> None:
    """把字节原子写入 dst（同目录临时文件 → os.replace）。"""
    dst.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp_name = tempfile.mkstemp(
        dir=str(dst.parent), prefix=f".{dst.name}.sync-", suffix=".tmp")
    tmp = Path(tmp_name)
    try:
        with os.fdopen(fd, "wb") as f:
            f.write(data)
        os.replace(tmp, dst)
    except BaseException:
        tmp.unlink(missing_ok=True)
        raise


def _write_change(change: Change) -> None:
    """落盘单个变更：文本按 LF 归一后的字节写，二进制原样复制（绝不改上游文件）。"""
    if change.text:
        _write_bytes_atomic(change.dst, normalize_text(change.src.read_bytes()))
    else:
        _copy_atomic(change.src, change.dst)


def _ensure_parent(dst: Path, created_dirs: list[Path]) -> None:
    """创建 dst 缺失的父目录，并记录本次新建的目录（回滚时删空目录）。"""
    missing = []
    parent = dst.parent
    while not parent.exists():
        missing.append(parent)
        if parent.parent == parent:
            break
        parent = parent.parent
    for directory in reversed(missing):
        directory.mkdir()
        created_dirs.append(directory)


def _rollback(
    applied: list[Path],
    backups: dict[Path, tuple[bytes | None, os.stat_result | None]],
    created_dirs: list[Path],
) -> list[str]:
    """回滚本次已写入的文件：新增的删掉、更新的恢复原字节 + 原 mtime。返回回滚错误。"""
    errors = []
    for dst in reversed(applied):
        data, st = backups[dst]
        try:
            if data is None:
                dst.unlink(missing_ok=True)
            else:
                _write_bytes_atomic(dst, data)
                if st is not None:
                    os.utime(dst, ns=(st.st_atime_ns, st.st_mtime_ns))
        except OSError as exc:
            errors.append(f"{dst}：{exc}")
    for directory in reversed(created_dirs):
        try:
            directory.rmdir()
        except OSError:
            pass
    return errors


def apply_changes(changes: list[Change]) -> None:
    """按计划原子落盘；任一失败则回滚本次已写入的文件并抛 SyncError。"""
    backups: dict[Path, tuple[bytes | None, os.stat_result | None]] = {}
    for change in changes:
        if change.status == "更新":
            try:
                st = change.dst.stat()
                backups[change.dst] = (change.dst.read_bytes(), st)
            except OSError as exc:
                raise SyncError(f"读取目标快照失败（未写入任何文件）：{change.dst}：{exc}") from exc
        else:
            backups[change.dst] = (None, None)

    created_dirs: list[Path] = []
    applied: list[Path] = []
    try:
        for change in changes:
            _ensure_parent(change.dst, created_dirs)
            try:
                _write_change(change)
            except Exception as exc:
                raise _ApplyFailure(change.rel_dst, exc) from exc
            applied.append(change.dst)
    except Exception as exc:
        detail = str(exc) if isinstance(exc, _ApplyFailure) else f"同步中断：{exc}"
        rollback_errors = _rollback(applied, backups, created_dirs)
        if rollback_errors:
            raise SyncError(f"{detail}；回滚未完全成功：{'；'.join(rollback_errors)}") from exc
        raise SyncError(f"{detail}；已回滚本次已写入的 {len(applied)} 个文件") from exc


def validate_json_sources(pairs) -> bool:
    """落盘前对所有 .json 源做语法层校验（失败可定位到 路径:行:列），任何失败都不写盘。

    只校验 JSON 语法与 UTF-8 解码；字段/引用契约属于 qa/lib/data-schema.mjs，不在这里做。
    """
    for rel_src, _ in pairs:
        if not rel_src.endswith(".json"):
            continue
        path = WORKSPACE / rel_src
        try:
            text = path.read_text(encoding="utf-8")
        except UnicodeDecodeError as exc:
            print(f"[x] 源 JSON 不是合法 UTF-8：{path}（字节偏移 {exc.start}）", file=sys.stderr)
            return False
        except OSError as exc:
            print(f"[x] 读取源 JSON 失败：{path}：{exc}", file=sys.stderr)
            return False
        try:
            json.loads(text)
        except json.JSONDecodeError as exc:
            print(f"[x] 源 JSON 损坏：{path}:{exc.lineno}:{exc.colno}：{exc.msg}", file=sys.stderr)
            return False
    return True


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(
        description="把 .mimocode 工作区的运行时数据/图标快照同步进站点仓库",
        epilog="退出码：0 成功/已最新；1 --check 有漂移；2 工作区缺失或不完整；3 写盘失败（已回滚）",
    )
    ap.add_argument("--check", action="store_true", help="只比对不写盘（有差异时退出码 1）")
    ap.add_argument("--no-icons", action="store_true", help="跳过 assets/icons 同步")
    ap.add_argument("--quiet", action="store_true")
    args = ap.parse_args(argv)
    dry = args.check
    log = (lambda *a, **k: None) if args.quiet else print

    def err(*a):
        print(*a, file=sys.stderr)

    if not (WORKSPACE / "data" / "items.json").is_file():
        err(f"[x] 找不到工作区数据：{WORKSPACE / 'data' / 'items.json'}")
        err("    本脚本只用于从 .mimocode 工作区更新快照；单独 clone 的仓库不需要它。")
        err("[x] 退出码 2：工作区缺失，未写盘。")
        return EXIT_ENV

    # ---- 计划：先完整校验源文件，再决定是否落盘 ----
    pairs = [(f"data/{name}", f"data/{name}") for name in DATA_FILES]
    pairs += CODEX_FILES
    pairs += [(rel, f"pipeline/_source/{Path(rel).name}") for rel in SOURCE_FILES]

    missing_sources = [rel for rel, _ in pairs if not (WORKSPACE / rel).is_file()]

    icons: list[Path] = []
    missing_icon_source = ""
    icon_src_dir = WORKSPACE / "assets" / "icons"
    if not args.no_icons:
        if not icon_src_dir.is_dir():
            missing_icon_source = str(icon_src_dir)
        else:
            icons = sorted(icon_src_dir.glob("*.png"))
            if not icons:
                missing_icon_source = f"{icon_src_dir}（目录为空）"

    if missing_sources or missing_icon_source:
        for rel in missing_sources:
            err(f"[x] 工作区源文件缺失：{WORKSPACE / rel}（快照保留，未删除）")
        if missing_icon_source:
            err(f"[x] 工作区图标源缺失：{missing_icon_source}"
                f"（快照保留，未删除；确需跳过图标请用 --no-icons）")
        err("[x] 退出码 2：工作区数据不完整，未写入任何文件。")
        return EXIT_ENV

    # 语法层完整性：先全量校验源 JSON，再开始任何复制（保证损坏源不会搬进仓库）
    if not validate_json_sources(pairs):
        err("[x] 退出码 2：源 JSON 损坏/不可读，未写入任何文件。")
        return EXIT_ENV

    try:
        changes: list[Change] = []
        totals = {"新增": 0, "更新": 0, "相同": 0}
        eol_only = 0
        rows: list[tuple[str, str, int]] = []

        def plan(src: Path, dst: Path, rel_dst: str, *, text: bool) -> None:
            nonlocal eol_only
            status, size, only_eol = file_status(src, dst, text=text)
            totals[status] += 1
            if only_eol:
                eol_only += 1
            if status != "相同":
                changes.append(Change(rel_dst, src, dst, status, size, text))
                rows.append((rel_dst, status, size))

        for rel_src, rel_dst in pairs:
            plan(WORKSPACE / rel_src, SITE / rel_dst, rel_dst, text=is_text(rel_src))

        snapshot_only: list[str] = []
        icon_changed = 0
        if not args.no_icons:
            dst_icon_dir = SITE / "assets" / "icons"
            src_names = {p.name for p in icons}
            if dst_icon_dir.is_dir():
                snapshot_only = sorted(
                    p.name for p in dst_icon_dir.glob("*.png") if p.name not in src_names)
            for p in icons:
                before = len(changes)
                plan(p, dst_icon_dir / p.name, f"assets/icons/{p.name}", text=False)
                icon_changed += len(changes) - before
    except OSError as exc:
        err(f"[x] 读取源文件/快照失败，未写入任何文件：{exc}")
        err("[x] 退出码 2：环境或 I/O 异常。")
        return EXIT_ENV

    def report() -> None:
        if not args.no_icons:
            log(f"[i] 图标：{len(icons)} 张，本次变化 {icon_changed} 张")
        for rel_dst, status, size in rows[:40]:
            log(f"  {status:>2}  {rel_dst}  ({size/1024:.0f} KB)")
        if len(rows) > 40:
            log(f"  … 其余 {len(rows)-40} 条省略")
        if eol_only:
            log(f"[i] 仅换行差异 {eol_only} 个（按内容相同处理，不写盘）")
        if snapshot_only:
            log(f"[!] 快照独有 {len(snapshot_only)} 个图标（工作区已无对应文件，默认不删除）")
            for name in snapshot_only[:10]:
                log(f"      - assets/icons/{name}")
            if len(snapshot_only) > 10:
                log(f"      … 其余 {len(snapshot_only)-10} 个省略")
        log(f"[i] 结果：新增 {totals['新增']} / 更新 {totals['更新']} / 相同 {totals['相同']}"
            f" / 快照独有 {len(snapshot_only)}（未删除）")

    if dry:
        report()
        if changes:
            log("[i] --check：未写盘，存在差异（退出码 1）")
            return EXIT_DRIFT
        log("[i] --check：未写盘，快照已是最新（退出码 0）")
        return EXIT_OK

    if changes:
        try:
            apply_changes(changes)
        except SyncError as exc:
            err(f"[x] 同步失败：{exc}")
            err("[x] 退出码 3：本次写入已按上面说明回滚，未保留半成品。")
            return EXIT_SYNC_FAILED

    report()
    if changes:
        log(f"[i] 已原子写入 {len(changes)} 个文件；可安全重复执行（第二次应全部「相同」）")
    else:
        log("[i] 快照已是最新，无需写盘")
    return EXIT_OK


if __name__ == "__main__":
    raise SystemExit(main())
