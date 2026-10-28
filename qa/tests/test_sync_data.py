#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""pipeline/sync-data.py 的回归测试（Python 标准库 unittest，零依赖）。

设计要点：
- **不碰真实仓库**：每个用例在临时目录里搭一套 site/workspace fixture，
  用 importlib.util.spec_from_file_location 动态加载脚本，并把模块级
  SITE / WORKSPACE 替换到临时目录（脚本所有读写都经由这两个路径）。
- 覆盖：图标 append 崩溃（修复前必红）、新增/更新/相同、--check 严格只读、
  源文件缺失 vs 快照漂移的退出码区分、失败回滚、重复执行幂等、--no-icons/--quiet。

运行（仓库根目录）：
    python -m unittest discover -s qa/tests -p "test_*.py" -v
"""
from __future__ import annotations

import contextlib
import hashlib
import importlib.util
import io
import itertools
import os
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
SCRIPT = REPO_ROOT / "pipeline" / "sync-data.py"

# 与 pipeline/sync-data.py 的清单保持一致的「同步契约」（重复声明是为了让测试能独立断言）
DATA_FILES = [
    "items.json", "icon_index.json", "site_data.json", "terms.json",
    "acq.json", "archetypes.json", "item_effects.json",
]
CODEX_REL = "data/codex/index.json"
SOURCE_FILES = ["build/ui_data.json", "build/loadouts.json", "build/builds.json"]

# 退出码契约
EXIT_OK = 0
EXIT_DRIFT = 1
EXIT_ENV = 2
EXIT_SYNC_FAILED = 3

_LOAD_COUNTER = itertools.count()


def source_pairs() -> list[tuple[str, str]]:
    """(工作区源相对路径, 仓库目标相对路径)，顺序与 sync-data.py 的同步计划一致。"""
    pairs = [(f"data/{name}", f"data/{name}") for name in DATA_FILES]
    pairs.append((CODEX_REL, CODEX_REL))
    pairs.extend((rel, f"pipeline/_source/{Path(rel).name}") for rel in SOURCE_FILES)
    return pairs


def load_sync_module():
    """动态加载 pipeline/sync-data.py，返回新模块对象（不写 __pycache__）。"""
    if not SCRIPT.is_file():
        raise AssertionError(f"找不到被测脚本：{SCRIPT}")
    name = f"relic_sync_data_{os.getpid()}_{next(_LOAD_COUNTER)}"
    spec = importlib.util.spec_from_file_location(name, str(SCRIPT))
    if spec is None or spec.loader is None:  # pragma: no cover - 环境异常
        raise AssertionError(f"无法加载脚本：{SCRIPT}")
    mod = importlib.util.module_from_spec(spec)
    # dataclass 装饰器要求类所属模块已在 sys.modules 中（动态加载的标准做法）
    sys.modules[name] = mod
    old_flag = sys.dont_write_bytecode
    sys.dont_write_bytecode = True
    try:
        spec.loader.exec_module(mod)
    finally:
        sys.dont_write_bytecode = old_flag
        sys.modules.pop(name, None)
    return mod


class SyncDataTestBase(unittest.TestCase):
    maxDiff = None

    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory(prefix="sync-data-test-")
        self.addCleanup(self._tmp.cleanup)
        self.root = Path(self._tmp.name)
        self.site = self.root / "site"
        self.workspace = self.root / "workspace"
        self.mod = load_sync_module()
        self.mod.SITE = self.site
        self.mod.WORKSPACE = self.workspace
        self._build_fixture()

    # ---- fixture / helpers ----

    def _build_fixture(self, icons=("icon_a.png", "icon_b.png")) -> None:
        for src_rel, dst_rel in source_pairs():
            data = self._content_for(src_rel)
            self.write(self.workspace / src_rel, data)
            self.write(self.site / dst_rel, data)
        for name in icons:
            data = b"PNG:" + name.encode("ascii")
            self.write(self.workspace / "assets" / "icons" / name, data)
            self.write(self.site / "assets" / "icons" / name, data)

    @staticmethod
    def _content_for(rel: str) -> bytes:
        return ('{"fixture": "%s"}\n' % rel).encode("utf-8")

    @staticmethod
    def write(path: Path, data) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        if isinstance(data, str):
            data = data.encode("utf-8")
        path.write_bytes(data)

    def run_main(self, *args):
        """进程内调用 main()，返回 (退出码, stdout, stderr)。"""
        stdout, stderr = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(stdout), contextlib.redirect_stderr(stderr):
            rc = self.mod.main(list(args))
        return rc, stdout.getvalue(), stderr.getvalue()

    @staticmethod
    def tree_state(root: Path) -> dict:
        """文件树快照：路径 → (类型, 大小, mtime_ns, sha256)。目录只记录存在性。"""
        state = {}
        if not root.exists():
            return state
        for path in sorted(root.rglob("*")):
            rel = path.relative_to(root).as_posix()
            if path.is_dir():
                state[rel] = ("dir",)
            else:
                st = path.stat()
                state[rel] = (
                    "file",
                    st.st_size,
                    st.st_mtime_ns,
                    hashlib.sha256(path.read_bytes()).hexdigest(),
                )
        return state

    def assert_site_unchanged(self, before: dict) -> None:
        self.assertEqual(self.tree_state(self.site), before, "站点快照被改动了（应严格只读/已回滚）")


class TestIconCrashRegression(SyncDataTestBase):
    """修复前必红：rows.append(字符串, status, size) 只允许 1 个参数。"""

    def test_new_icon_sync_does_not_crash(self):
        self.write(self.workspace / "assets/icons/new_icon.png", b"PNG:new")
        rc, out, err = self.run_main()
        self.assertEqual(rc, EXIT_OK, err)
        self.assertEqual((self.site / "assets/icons/new_icon.png").read_bytes(), b"PNG:new")
        self.assertIn("assets/icons/new_icon.png", out)
        self.assertIn("图标", out)

    def test_updated_icon_sync_does_not_crash(self):
        self.write(self.workspace / "assets/icons/icon_a.png", b"PNG:icon-a-v2")
        rc, out, err = self.run_main()
        self.assertEqual(rc, EXIT_OK, err)
        self.assertEqual((self.site / "assets/icons/icon_a.png").read_bytes(), b"PNG:icon-a-v2")
        self.assertIn("assets/icons/icon_a.png", out)

    def test_check_new_icon_drift_does_not_crash(self):
        self.write(self.workspace / "assets/icons/new_icon.png", b"PNG:new")
        before = self.tree_state(self.site)
        rc, out, err = self.run_main("--check")
        self.assertEqual(rc, EXIT_DRIFT, err)
        self.assert_site_unchanged(before)
        self.assertIn("assets/icons/new_icon.png", out)
        self.assertIn("存在差异", out)


class TestPlanAndSync(SyncDataTestBase):
    def test_data_new_and_updated_files(self):
        (self.site / "data/terms.json").unlink()
        self.write(self.workspace / "data/items.json", b'{"fixture": "items-v2"}\n')
        rc, out, err = self.run_main()
        self.assertEqual(rc, EXIT_OK, err)
        self.assertEqual(
            (self.site / "data/terms.json").read_bytes(), self._content_for("data/terms.json"))
        self.assertEqual(
            (self.site / "data/items.json").read_bytes(), b'{"fixture": "items-v2"}\n')
        self.assertIn("新增 1", out)
        self.assertIn("更新 1", out)

    def test_source_snapshot_is_synced(self):
        self.write(self.workspace / "build/ui_data.json", b'{"fixture": "ui-v2"}\n')
        rc, out, err = self.run_main()
        self.assertEqual(rc, EXIT_OK, err)
        self.assertEqual(
            (self.site / "pipeline/_source/ui_data.json").read_bytes(),
            b'{"fixture": "ui-v2"}\n')

    def test_second_run_is_idempotent(self):
        self.write(self.workspace / "assets/icons/new_icon.png", b"PNG:new")
        self.write(self.workspace / "data/items.json", b'{"fixture": "items-v2"}\n')
        rc1, _, err1 = self.run_main()
        self.assertEqual(rc1, EXIT_OK, err1)
        after_first = self.tree_state(self.site)
        rc2, out2, err2 = self.run_main()
        self.assertEqual(rc2, EXIT_OK, err2)
        self.assert_site_unchanged(after_first)  # 第二次内容与 mtime 都不变
        self.assertIn("新增 0", out2)
        self.assertIn("更新 0", out2)
        self.assertIn("相同", out2)


class TestCheckMode(SyncDataTestBase):
    def test_check_clean_returns_zero(self):
        before = self.tree_state(self.site)
        rc, out, err = self.run_main("--check")
        self.assertEqual(rc, EXIT_OK, err)
        self.assert_site_unchanged(before)
        self.assertIn("快照已是最新", out)

    def test_check_reports_drift_without_writing(self):
        self.write(self.workspace / "data/items.json", b'{"fixture": "items-v2"}\n')
        before = self.tree_state(self.site)
        rc, out, err = self.run_main("--check")
        self.assertEqual(rc, EXIT_DRIFT, err)
        self.assert_site_unchanged(before)  # 不写文件、不 mkdir、不改 mtime
        self.assertIn("存在差异", out)

    def test_check_does_not_create_missing_destination_dir(self):
        (self.site / "data/codex/index.json").unlink()
        (self.site / "data/codex").rmdir()
        rc, out, err = self.run_main("--check")
        self.assertEqual(rc, EXIT_DRIFT, err)
        self.assertFalse((self.site / "data/codex").exists(), "--check 不得 mkdir")

    def test_check_quiet_suppresses_stdout(self):
        self.write(self.workspace / "data/items.json", b'{"fixture": "items-v2"}\n')
        rc, out, err = self.run_main("--check", "--quiet")
        self.assertEqual(rc, EXIT_DRIFT, err)
        self.assertEqual(out, "")


class TestLineEndingNormalization(SyncDataTestBase):
    """文本换行归一：CRLF/LF 仅换行差异不算漂移；同步文本统一按 LF 落盘。"""

    def test_check_crlf_source_vs_lf_snapshot_is_not_drift(self):
        lf = self._content_for("data/items.json")
        self.write(self.workspace / "data/items.json", lf.replace(b"\n", b"\r\n"))
        before = self.tree_state(self.site)
        rc, out, err = self.run_main("--check")
        self.assertEqual(rc, EXIT_OK, err)
        self.assert_site_unchanged(before)
        self.assertIn("仅换行差异 1", out)
        self.assertIn("按内容相同处理", out)

    def test_crlf_new_text_file_is_written_as_lf_then_idempotent(self):
        (self.site / "data/terms.json").unlink()
        crlf = self._content_for("data/terms.json").replace(b"\n", b"\r\n")
        self.write(self.workspace / "data/terms.json", crlf)
        rc, out, err = self.run_main()
        self.assertEqual(rc, EXIT_OK, err)
        written = (self.site / "data/terms.json").read_bytes()
        self.assertEqual(written, self._content_for("data/terms.json"))  # 落盘统一 LF
        self.assertNotIn(b"\r", written)
        after_first = self.tree_state(self.site)
        rc2, out2, err2 = self.run_main("--check")
        self.assertEqual(rc2, EXIT_OK, err2)  # 源 CRLF、快照 LF 不算漂移
        self.assert_site_unchanged(after_first)
        self.assertIn("仅换行差异 1", out2)

    def test_crlf_updated_text_is_written_as_lf(self):
        self.write(self.workspace / "data/items.json", b'{"fixture": "items-v2"}\r\n')
        rc, out, err = self.run_main()
        self.assertEqual(rc, EXIT_OK, err)
        written = (self.site / "data/items.json").read_bytes()
        self.assertEqual(written, b'{"fixture": "items-v2"}\n')
        self.assertNotIn(b"\r", written)


class TestEnvironmentErrors(SyncDataTestBase):
    def test_missing_workspace_returns_env_error(self):
        self.mod.WORKSPACE = self.root / "absent-workspace"
        before = self.tree_state(self.site)
        for args in ((), ("--check",)):
            with self.subTest(args=args):
                rc, out, err = self.run_main(*args)
                self.assertEqual(rc, EXIT_ENV)
                self.assert_site_unchanged(before)
                self.assertIn("工作区", err)

    def test_missing_required_source_keeps_snapshot_and_returns_env_error(self):
        (self.workspace / "data/terms.json").unlink()
        before = self.tree_state(self.site)
        for args in ((), ("--check",)):
            with self.subTest(args=args):
                rc, out, err = self.run_main(*args)
                self.assertEqual(rc, EXIT_ENV)
                self.assert_site_unchanged(before)  # 不移除、不改写快照
                self.assertIn("terms.json", err)
                self.assertIn("源文件缺失", err)
                self.assertIn("未删除", err)

    def test_missing_icons_dir_returns_env_error_unless_no_icons(self):
        shutil.rmtree(self.workspace / "assets/icons")
        before = self.tree_state(self.site)
        rc, out, err = self.run_main()
        self.assertEqual(rc, EXIT_ENV)
        self.assert_site_unchanged(before)
        self.assertIn("图标", err)
        rc, out, err = self.run_main("--no-icons")
        self.assertEqual(rc, EXIT_OK, err)
        self.assert_site_unchanged(before)

    def test_empty_icons_dir_is_not_silently_zero(self):
        shutil.rmtree(self.workspace / "assets/icons")
        (self.workspace / "assets/icons").mkdir(parents=True)
        before = self.tree_state(self.site)
        rc, out, err = self.run_main()
        self.assertEqual(rc, EXIT_ENV)
        self.assert_site_unchanged(before)
        self.assertIn("图标", err)

    def test_quiet_still_reports_environment_errors(self):
        self.mod.WORKSPACE = self.root / "absent-workspace"
        rc, out, err = self.run_main("--quiet")
        self.assertEqual(rc, EXIT_ENV)
        self.assertEqual(out, "")
        self.assertNotEqual(err, "")

    def test_no_icons_skips_icon_sync(self):
        self.write(self.workspace / "assets/icons/new_icon.png", b"PNG:new")
        before = self.tree_state(self.site)
        rc, out, err = self.run_main("--no-icons")
        self.assertEqual(rc, EXIT_OK, err)
        self.assert_site_unchanged(before)
        self.assertNotIn("assets/icons/new_icon.png", out)


class TestSnapshotOnly(SyncDataTestBase):
    """上游删除、快照仍存在的图标：默认不删、要报告；--check 不计为漂移。"""

    def test_snapshot_only_icon_is_kept_and_reported(self):
        self.write(self.site / "assets/icons/stale.png", b"PNG:stale")
        before = self.tree_state(self.site)
        rc, out, err = self.run_main("--check")
        self.assertEqual(rc, EXIT_OK, err)  # 不计为漂移，避免既有门禁误红
        self.assert_site_unchanged(before)
        self.assertIn("快照独有", out)
        self.assertIn("未删除", out)

        rc, out, err = self.run_main()
        self.assertEqual(rc, EXIT_OK, err)
        self.assertTrue((self.site / "assets/icons/stale.png").is_file())
        self.assertIn("快照独有", out)


class TestFailureRollback(SyncDataTestBase):
    def test_failure_rolls_back_partial_updates(self):
        # 计划里至少两个变更：先更新 items.json，再新增图标；让第 2 次写盘抛错。
        self.write(self.workspace / "data/items.json", b'{"fixture": "items-v2"}\n')
        self.write(self.workspace / "assets/icons/new_icon.png", b"PNG:new")
        before = self.tree_state(self.site)

        real_write = self.mod._write_change
        calls = {"n": 0}

        def flaky_write(change):
            calls["n"] += 1
            if calls["n"] == 2:
                raise OSError("injected failure")
            return real_write(change)

        self.mod._write_change = flaky_write
        try:
            rc, out, err = self.run_main()
        finally:
            self.mod._write_change = real_write

        self.assertGreaterEqual(calls["n"], 2)
        self.assertNotEqual(rc, EXIT_OK, "写盘失败必须返回非 0")
        self.assertEqual(rc, EXIT_SYNC_FAILED, err)
        # 已更新文件恢复原内容+mtime、新增文件已删除、无临时文件残留
        self.assert_site_unchanged(before)
        combined = out + err
        self.assertIn("回滚", combined)
        self.assertIn("injected failure", combined)

    def test_failure_on_first_write_leaves_no_state(self):
        self.write(self.workspace / "data/items.json", b'{"fixture": "items-v2"}\n')
        before = self.tree_state(self.site)

        real_write = self.mod._write_change
        calls = {"n": 0}

        def failing_write(change):
            calls["n"] += 1
            raise OSError("injected failure")

        self.mod._write_change = failing_write
        try:
            rc, out, err = self.run_main()
        finally:
            self.mod._write_change = real_write

        self.assertEqual(calls["n"], 1)
        self.assertEqual(rc, EXIT_SYNC_FAILED, err)
        self.assert_site_unchanged(before)
        self.assertIn("回滚", out + err)

    def test_failure_inside_atomic_replace_rolls_back_and_cleans_temp(self):
        # 第 1 个文件(os.replace #1)写入成功，第 2 个文件在 os.replace 抛错：
        # 验证真实「临时文件 + replace」路径失败时临时文件被清理、已写入文件被回滚。
        self.write(self.workspace / "data/items.json", b'{"fixture": "items-v2"}\n')
        self.write(self.workspace / "data/terms.json", b'{"fixture": "terms-v2"}\n')
        before = self.tree_state(self.site)

        real_replace = self.mod.os.replace
        calls = {"n": 0}

        def flaky_replace(src, dst):
            calls["n"] += 1
            if calls["n"] == 2:
                raise OSError("injected replace failure")
            return real_replace(src, dst)

        self.mod.os.replace = flaky_replace
        try:
            rc, out, err = self.run_main()
        finally:
            self.mod.os.replace = real_replace

        self.assertGreaterEqual(calls["n"], 2)
        self.assertEqual(rc, EXIT_SYNC_FAILED, err)
        self.assert_site_unchanged(before)  # 含「无临时文件残留」
        self.assertIn("injected replace failure", out + err)
        self.assertIn("回滚", out + err)


class TestP13SyncRobustness(SyncDataTestBase):
    """P1-3 追加：源 JSON 完整性、--check 连续一致、同步后无漂移、重复同步幂等。

    只追加用例，不改上方已有 23 个用例。
    """

    def test_missing_source_file_returns_env_error_with_path(self):
        (self.workspace / "build/ui_data.json").unlink()
        before = self.tree_state(self.site)
        rc, out, err = self.run_main()
        self.assertEqual(rc, EXIT_ENV)
        self.assert_site_unchanged(before)
        self.assertIn("源文件缺失", err)
        self.assertIn("ui_data.json", err)
        self.assertIn("未写入任何文件", err)

    def test_corrupted_source_json_returns_env_error_with_path_and_line(self):
        self.write(self.workspace / "data/items.json", '{"broken": [1, 2,\n')
        before = self.tree_state(self.site)
        for args in ((), ("--check",)):
            with self.subTest(args=args):
                rc, out, err = self.run_main(*args)
                self.assertEqual(rc, EXIT_ENV, err)
                self.assert_site_unchanged(before)  # 一个字节都不写、无半成品
                self.assertIn("items.json", err)
                self.assertRegex(err, r"items\.json:\d+:\d+")  # 路径:行:列

    def test_corrupted_non_sentinel_source_json_detected_in_check_mode(self):
        # 非 items.json 哨兵文件的损坏同样必须在 --check 下被发现（不能靠漂移检查蒙混）
        self.write(
            self.workspace / "data/site_data.json",
            '{\n  "meta": {},\n  "pieces": [\n}\n',
        )
        before = self.tree_state(self.site)
        rc, out, err = self.run_main("--check")
        self.assertEqual(rc, EXIT_ENV, err)
        self.assert_site_unchanged(before)
        self.assertIn("site_data.json", err)
        self.assertRegex(err, r"site_data\.json:\d+:\d+")

    def test_missing_workspace_suggests_mimocode_workspace(self):
        self.mod.WORKSPACE = self.root / "absent-workspace"
        rc, out, err = self.run_main("--check")
        self.assertEqual(rc, EXIT_ENV)
        self.assertIn(".mimocode", err)
        self.assertIn("单独 clone", err)
        self.assertIn("退出码 2", err)

    def test_repeated_check_is_consistent(self):
        before = self.tree_state(self.site)
        rc1, out1, err1 = self.run_main("--check")
        rc2, out2, err2 = self.run_main("--check")
        self.assertEqual((rc1, rc2), (EXIT_OK, EXIT_OK), err1 + err2)
        self.assertEqual(out1, out2)  # 两次输出完全一致
        self.assertEqual(err2, "")
        self.assert_site_unchanged(before)  # --check 只读

    def test_sync_then_check_has_no_drift(self):
        self.write(self.workspace / "data/items.json", b'{"fixture": "items-v2"}\n')
        self.write(self.workspace / "assets/icons/new_icon.png", b"PNG:new")
        rc1, out1, _ = self.run_main("--check")
        self.assertEqual(rc1, EXIT_DRIFT)
        self.assertIn("存在差异", out1)

        rc2, out2, err2 = self.run_main()
        self.assertEqual(rc2, EXIT_OK, err2)
        after_sync = self.tree_state(self.site)

        rc3, out3, err3 = self.run_main("--check")
        self.assertEqual(rc3, EXIT_OK, err3)
        self.assertIn("快照已是最新", out3)
        self.assert_site_unchanged(after_sync)  # 同步后再 check 不得再写盘

    def test_repeated_sync_produces_no_extra_changes(self):
        self.write(self.workspace / "data/items.json", b'{"fixture": "items-v2"}\n')
        self.write(self.workspace / "assets/icons/new_icon.png", b"PNG:new")
        rc1, out1, err1 = self.run_main()
        self.assertEqual(rc1, EXIT_OK, err1)
        after_first = self.tree_state(self.site)

        rc2, out2, err2 = self.run_main()
        self.assertEqual(rc2, EXIT_OK, err2)
        self.assertEqual(self.tree_state(self.site), after_first)  # 内容 + mtime 都不变
        self.assertIn("新增 0", out2)
        self.assertIn("更新 0", out2)


if __name__ == "__main__":  # pragma: no cover
    unittest.main(verbosity=2)
