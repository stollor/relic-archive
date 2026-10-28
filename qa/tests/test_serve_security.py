#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""qa/tests/test_serve_security.py — serve.py 站点白名单 / 信息泄露回归（stdlib unittest）

P2-4 修复前实测证据（2026-10-28，`python serve.py --port 0`，全部 HTTP 200）：
  /.git/config         200   /.git/HEAD             200   /AGENTS.md        200
  /serve.py            200   /.github/workflows/qa.yml 200 /docs/DEPLOY.md 200
  /qa/shot.js          200   /pipeline/deploy.py    200   /.gitignore       200
  /data/README.md      200   /api/health 返回本机绝对路径（web_dir.path / items_json.path / tools.cli_*）
修复目标（本地开发服务器收敛，不改变 GitHub Pages 静态部署形态）：
  · 只服务站点运行时资源：/（index.html）、/index.html、/lab.html、/favicon.(svg|ico)、
    /css/*.css、/js/*.js、/data/*.json|*.jsonl（含 codex/index.json）、/assets/ 图片字体、/api/health；
    其余（仓库内部文件、dot 文件/目录、目录列表、穿越变体）一律 404。
  · /api/health 只保留 exists/size/mtime 等状态字段，不返回任何本机绝对路径；404 错误体同样不泄露绝对路径。
  · --prefix 子路径模式语义不变（由 test_serve_prefix.py 继续覆盖）。
运行：python -m unittest discover -s qa/tests -p "test_*.py" -v
      python -m unittest qa.tests.test_serve_security -v
"""

from __future__ import annotations

import http.client
import json
import os
import re
import subprocess
import sys
import threading
import time
import unittest
from pathlib import Path
from urllib.parse import urlsplit

REPO = Path(__file__).resolve().parents[2]
SERVE = REPO / "serve.py"
URL_IN_BANNER = re.compile(r"访问地址\s*:\s*(http://[^\s]+)")
ANY_HTTP_URL = re.compile(r"(http://[^\s]+)")
ABS_PATH_RE = re.compile(r"[A-Za-z]:\\\\|\\\\[A-Za-z0-9_.-]+\\\\")


class ServeSecurityTest(unittest.TestCase):
    """起一个真实的根路径 serve.py（随机端口），逐项断言白名单与信息泄露边界。"""

    proc: subprocess.Popen | None = None
    base: str = ""
    host: str = ""
    port: int = 0
    output: list[str] = []
    _reader: threading.Thread | None = None

    # ------------------------------ 生命周期 ------------------------------
    @classmethod
    def setUpClass(cls) -> None:
        if not SERVE.is_file():
            raise unittest.SkipTest(f"serve.py 不存在：{SERVE}")
        cls.output = []
        cls.proc = subprocess.Popen(
            [sys.executable, str(SERVE), "--host", "127.0.0.1", "--port", "0"],
            cwd=str(REPO),
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            encoding="utf-8",
            errors="replace",
            bufsize=1,
            env={**os.environ, "PYTHONIOENCODING": "utf-8", "PYTHONUNBUFFERED": "1"},
        )
        cls._reader = threading.Thread(target=cls._pump_output, daemon=True)
        cls._reader.start()

        url = cls._wait_for_url(timeout=25.0)
        if not url:
            cls._kill()
            raise AssertionError(
                "serve.py 未在 25s 内打印可解析的「访问地址」（或进程提前退出）。\n"
                f"exit={cls.proc.poll()}\n----- 输出 -----\n{''.join(cls.output)[-3000:]}"
            )
        cls.base = url.rstrip("/")
        parts = urlsplit(cls.base)
        cls.host, cls.port = parts.hostname or "127.0.0.1", parts.port or 0
        if not cls.port:
            raise AssertionError(f"banner 未报告实际端口（仍是 --port 0）：{cls.base}")
        cls._wait_until_listening(timeout=10.0)

    @classmethod
    def _pump_output(cls) -> None:
        assert cls.proc is not None and cls.proc.stdout is not None
        for line in cls.proc.stdout:
            cls.output.append(line)

    @classmethod
    def _wait_for_url(cls, timeout: float) -> str | None:
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            text = "".join(cls.output)
            m = URL_IN_BANNER.search(text) or ANY_HTTP_URL.search(text)
            if m:
                return m.group(1)
            if cls.proc is not None and cls.proc.poll() is not None:
                return None
            time.sleep(0.05)
        return None

    @classmethod
    def _wait_until_listening(cls, timeout: float) -> None:
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            try:
                status, _, _ = cls._request("/api/health")
                if status == 200:
                    return
            except OSError:
                pass
            time.sleep(0.05)
        raise AssertionError(f"serve.py 进程已启动但 {timeout}s 内端口不可连接：{cls.host}:{cls.port}")

    @classmethod
    def _kill(cls) -> None:
        proc = cls.proc
        if not proc:
            return
        try:
            proc.terminate()
        except OSError:
            pass
        try:
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            try:
                proc.kill()
            except OSError:
                pass
            try:
                proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                pass
        try:
            if proc.stdout:
                proc.stdout.close()
        except OSError:
            pass
        cls.proc = None

    @classmethod
    def tearDownClass(cls) -> None:
        cls._kill()

    # ------------------------------ HTTP 工具 ------------------------------
    @classmethod
    def _request(cls, path: str, method: str = "GET") -> tuple[int, dict[str, str], bytes]:
        """http.client 直发原始 path（不规范化 ../，不跟随重定向）。"""
        conn = http.client.HTTPConnection(cls.host, cls.port, timeout=15)
        try:
            conn.putrequest(method, path, skip_host=False, skip_accept_encoding=True)
            conn.putheader("Host", f"{cls.host}:{cls.port}")
            conn.putheader("Connection", "close")
            conn.endheaders()
            resp = conn.getresponse()
            body = resp.read()
            headers = {k.lower(): v for k, v in resp.getheaders()}
            return resp.status, headers, body
        finally:
            conn.close()

    def assertStatus(self, path: str, expected: int, detail: str = "") -> tuple[dict[str, str], bytes]:
        status, headers, body = self._request(path)
        self.assertEqual(
            status, expected,
            f"{detail or path}：状态码 {status} ≠ {expected}；body={body[:300]!r}",
        )
        return headers, body

    def assertNotFoundJson(self, path: str) -> bytes:
        headers, body = self.assertStatus(path, 404, f"应 404：{path}")
        self.assertIn("application/json", headers.get("content-type", "").lower(), f"{path} 的 404 应为 JSON")
        err = json.loads(body.decode("utf-8"))
        self.assertIs(err.get("ok"), False, f"{path} 的 404 响应 ok 应为 false")
        return body

    # -------------------------------- 用例 --------------------------------
    def test_internal_repo_files_are_404(self) -> None:
        """仓库内部/开发文件不得通过本地服务器暴露（修复前全部 200，见文件头证据）。"""
        for path in (
            "/AGENTS.md",
            "/README.md",
            "/CHANGELOG.md",
            "/serve.py",
            "/verify.ps1",
            "/start.cmd",
            "/.gitignore",
            "/.gitattributes",
            "/.nojekyll",
            "/.git/config",
            "/.git/HEAD",
            "/.github/workflows/qa.yml",
            "/docs/DEPLOY.md",
            "/docs/ARCHITECTURE.md",
            "/qa/shot.js",
            "/qa/interactions.js",
            "/pipeline/deploy.py",
            "/pipeline/sync-data.py",
            "/data/README.md",
            "/js/.hidden.js",
            "/data/.env.json",
            "/assets/icons/.hidden.png",
        ):
            with self.subTest(path=path):
                body = self.assertNotFoundJson(path)
                self.assertNotIn(b"# AGENTS.md", body)
                self.assertNotIn("给 AI 的入口".encode("utf-8"), body)
                self.assertNotIn(b"#!/usr/bin/env python", body)

    def test_query_string_cannot_bypass_whitelist(self) -> None:
        """带 query 的请求也不能绕过白名单（修复前 /AGENTS.md?x=1 会 200）。"""
        for path in ("/AGENTS.md?x=1", "/serve.py?raw=1", "/.git/config?x=1"):
            with self.subTest(path=path):
                self.assertNotFoundJson(path)

    def test_traversal_and_encoded_variants_are_rejected(self) -> None:
        """目录穿越/编码变体必须拒绝，且不泄露被保护文件内容。"""
        for path in (
            "/a/../AGENTS.md",
            "/js/../AGENTS.md",
            "/assets/../AGENTS.md",
            "/%2e%2e/AGENTS.md",
            "/..%2FAGENTS.md",
            "/js/%2e%2e/AGENTS.md",
            "/js/..%5cAGENTS.md",
            "/..%5cAGENTS.md",
            "/js/%2e%2e%2fAGENTS.md",
        ):
            with self.subTest(path=path):
                status, headers, body = self._request(path)
                self.assertIn(status, (403, 404), f"穿越变体未被拒绝：{path} → {status}")
                self.assertIn("application/json", headers.get("content-type", "").lower())
                self.assertNotIn(b"# AGENTS.md", body)
                self.assertNotIn("给 AI 的入口".encode("utf-8"), body)

    def test_runtime_assets_are_served(self) -> None:
        """站点运行时资源必须 200：页面/JS/CSS/数据/图标/health。"""
        for path, ctype in (
            ("/", "text/html"),
            ("/index.html", "text/html"),
            ("/lab.html", "text/html"),
            ("/favicon.svg", "image/svg"),
            ("/js/main.js", "javascript"),
            ("/js/core/router.js", "javascript"),
            ("/css/base.css", "text/css"),
            ("/data/items.json", "application/json"),
            ("/data/builds.json", "application/json"),
            ("/data/item_effects.json", "application/json"),
            ("/data/codex/index.json", "application/json"),
            ("/api/health", "application/json"),
        ):
            with self.subTest(path=path):
                headers, body = self.assertStatus(path, 200, f"运行时资源应 200：{path}")
                self.assertIn(ctype, headers.get("content-type", "").lower(), f"{path} Content-Type 异常")
                self.assertTrue(body, f"{path} 响应体不应为空")

        icons = sorted((REPO / "assets" / "icons").glob("*.png"))
        if not icons:
            self.skipTest("assets/icons 下没有 PNG（独立 clone 可能缺失），跳过图片断言")
        path = f"/assets/icons/{icons[0].name}"
        headers, body = self.assertStatus(path, 200, f"图标应 200：{path}")
        self.assertIn("image/png", headers.get("content-type", "").lower())
        self.assertEqual(body[:8], b"\x89PNG\r\n\x1a\n", "PNG 魔数不匹配")

    def test_health_has_no_absolute_paths(self) -> None:
        """/api/health 保留状态字段，但不得泄露本机绝对路径。"""
        _, body = self.assertStatus("/api/health", 200)
        text = body.decode("utf-8")
        health = json.loads(text)
        self.assertIs(health.get("ok"), True)
        self.assertEqual(health.get("service"), "remnant2-item-archive")
        self.assertTrue(health.get("web_dir", {}).get("exists"))
        self.assertTrue(health.get("items_json", {}).get("exists"))
        self.assertIn("item_effects", health.get("extra_data", {}), "health.extra_data 缺 item_effects")
        self.assertIn("builds", health.get("extra_data", {}), "health.extra_data 缺 builds")
        self.assertIn("/data/items.json", health.get("endpoints", {}))
        self.assertIsInstance(health.get("png_count"), int)
        # 绝对路径泄露判定：仓库绝对路径 + Windows 盘符 + JSON 里不允许再出现 path 字段
        self.assertNotIn(str(REPO), text, "health 泄露了仓库绝对路径")
        self.assertIsNone(ABS_PATH_RE.search(text), "health 泄露了盘符/UNC 绝对路径")
        self.assertNotIn('"path"', text, 'health 不应再返回 "path" 字段')
        for key in ("web_dir", "data_dir", "assets_dir", "items_json", "icon_index"):
            self.assertNotIn("path", health.get(key, {}), f"health.{key} 不应含 path 字段")
        for name, info in (health.get("extra_data") or {}).items():
            self.assertNotIn("path", info, f"health.extra_data.{name} 不应含 path 字段")

    def test_error_bodies_have_no_absolute_paths(self) -> None:
        """404 错误体不得泄露磁盘绝对路径（修复前 404 会带 extra.file 绝对路径）。"""
        for path in ("/data/nope.json", "/js/nope.js", "/css/nope.css", "/assets/icons/nope.png"):
            with self.subTest(path=path):
                body = self.assertNotFoundJson(path)
                text = body.decode("utf-8", "replace")
                self.assertNotIn(str(REPO), text, f"{path} 错误体泄露仓库绝对路径")
                self.assertIsNone(ABS_PATH_RE.search(text), f"{path} 错误体泄露盘符绝对路径")

    def test_directories_are_not_listed(self) -> None:
        """目录不得可浏览：/data、/js、/assets、/assets/icons、/.git 等目录请求 404。"""
        for path in ("/data", "/data/", "/js", "/js/", "/css/", "/assets/", "/assets/icons/", "/docs/", "/qa/", "/pipeline/", "/.git/", "/.github/"):
            with self.subTest(path=path):
                self.assertNotFoundJson(path)

    def test_head_and_favicon_contract(self) -> None:
        """HEAD 正常（无 body）；/favicon.ico 302 → /favicon.svg；query 不影响正常资源。"""
        status, headers, body = self._request("/js/main.js", method="HEAD")
        self.assertEqual(status, 200)
        self.assertEqual(body, b"")
        self.assertIn("javascript", headers.get("content-type", "").lower())

        headers, body = self.assertStatus("/favicon.ico", 302)
        self.assertEqual(headers.get("location"), "/favicon.svg")
        self.assertEqual(body, b"")

        self.assertStatus("/js/main.js?v=2026", 200)


if __name__ == "__main__":
    unittest.main(verbosity=2)
