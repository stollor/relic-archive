#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""qa/tests/test_serve_prefix.py — serve.py 子路径（模拟 GitHub Pages /relic-archive/）验收

用真实 CLI 起服务器（`python serve.py --port 0 --prefix /relic-archive`），
从 banner 的「访问地址」解析随机端口，再用标准库 http.client 发原始请求断言：
  - /relic-archive/                        200 index.html
  - /relic-archive/js/main.js              200 text/javascript
  - /relic-archive/data/items.json         200 application/json
  - /relic-archive/assets/icons/*.png      200 image/png
  - /js/main.js 等缺前缀资源                404（本地提前暴露绝对路径 bug）
  - /                                      302 → /relic-archive/
  - /relic-archive/api/health              200 且字段正常
  - /relic-archive/../AGENTS.md            被拒绝（403/404，且不泄露文件内容）

只依赖标准库；端口用 0（随机空闲端口），不与他人服务器冲突。
运行：python -m unittest qa.tests.test_serve_prefix -v
      python -m unittest discover -s qa/tests -p "test_*.py" -v
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
PREFIX = "/relic-archive"
URL_IN_BANNER = re.compile(r"访问地址\s*:\s*(http://[^\s]+)")
ANY_HTTP_URL = re.compile(r"(http://[^\s]+)")


class ServePrefixTest(unittest.TestCase):
    """起一个真实的带前缀 serve.py，逐项断言 HTTP 契约。"""

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
            [sys.executable, str(SERVE), "--host", "127.0.0.1", "--port", "0", "--prefix", PREFIX],
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
        # 断言 banner 契约：--port 0 时打印的是实际端口，且 URL 带前缀
        if not cls.port:
            raise AssertionError(f"banner 未报告实际端口（仍是 --port 0）：{cls.base}")
        if not parts.path.rstrip("/") == PREFIX:
            raise AssertionError(f"banner URL 未带 --prefix={PREFIX}：{cls.base}")
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
        """http.client 直接发原始 path（不规范化 ../，也不跟随重定向）。"""
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
            f"{detail or path}：状态码 {status} ≠ {expected}；body={body[:400]!r}",
        )
        return headers, body

    # -------------------------------- 用例 --------------------------------
    def test_banner_reports_prefixed_actual_port(self) -> None:
        """--port 0 + --prefix：banner 必须给出真实随机端口与带前缀地址。"""
        self.assertNotEqual(self.port, 0)
        self.assertEqual(urlsplit(self.base).path, PREFIX)
        self.assertTrue(self.base.startswith(f"http://{self.host}:"), self.base)

    def test_index_served_under_prefix(self) -> None:
        """GET /relic-archive/ → 200 index.html（Content-Type text/html）。"""
        headers, body = self.assertStatus(f"{PREFIX}/", 200)
        self.assertIn("text/html", headers.get("content-type", ""))
        text = body.decode("utf-8", "replace")
        self.assertIn("<!doctype html", text.lower())
        self.assertIn("遗物档案", text)

    def test_static_assets_under_prefix(self) -> None:
        """JS / JSON / PNG 都在前缀下 200，且 Content-Type 正确。"""
        js_headers, js_body = self.assertStatus(f"{PREFIX}/js/main.js", 200)
        self.assertIn("javascript", js_headers.get("content-type", "").lower())
        self.assertIn(b"import", js_body)

        data_headers, data_body = self.assertStatus(f"{PREFIX}/data/items.json", 200)
        self.assertIn("application/json", data_headers.get("content-type", "").lower())
        payload = json.loads(data_body.decode("utf-8"))
        self.assertIn("items", payload)
        self.assertTrue(payload["items"])

        icons = sorted((REPO / "assets" / "icons").glob("*.png"))
        if not icons:
            self.skipTest("assets/icons 下没有 PNG（独立 clone 可能缺失），跳过图片 Content-Type 断言")
        png_name = icons[0].name
        png_headers, png_body = self.assertStatus(f"{PREFIX}/assets/icons/{png_name}", 200)
        self.assertIn("image/png", png_headers.get("content-type", "").lower())
        self.assertEqual(png_body[:8], b"\x89PNG\r\n\x1a\n", "PNG 魔数不匹配")

    def test_missing_prefix_is_404(self) -> None:
        """缺前缀的绝对路径必须 404（提前暴露 Pages 子路径 404 bug）。"""
        for path in ("/js/main.js", "/data/items.json", "/css/base.css"):
            with self.subTest(path=path):
                headers, body = self.assertStatus(path, 404, f"缺前缀资源 {path}")
                self.assertIn("application/json", headers.get("content-type", "").lower())
                err = json.loads(body.decode("utf-8"))
                self.assertIs(err.get("ok"), False)
                self.assertIn("hint", err)

    def test_root_redirects_to_prefix(self) -> None:
        """GET / → 302，Location 指向 /relic-archive/（不跟随重定向）。"""
        headers, body = self.assertStatus("/", 302)
        self.assertEqual(headers.get("location"), f"{PREFIX}/")
        self.assertEqual(body, b"")

    def test_health_under_prefix(self) -> None:
        """GET /relic-archive/api/health → 200 且关键字段正常。"""
        headers, body = self.assertStatus(f"{PREFIX}/api/health", 200)
        self.assertIn("application/json", headers.get("content-type", "").lower())
        health = json.loads(body.decode("utf-8"))
        self.assertIs(health.get("ok"), True)
        self.assertEqual(health.get("prefix"), PREFIX)
        self.assertEqual(health.get("service"), "remnant2-item-archive")
        self.assertIsInstance(health.get("time"), str)
        self.assertTrue(health.get("web_dir", {}).get("exists"), "web_dir.exists 应为 True")
        self.assertTrue(health.get("items_json", {}).get("exists"), "items_json.exists 应为 True")
        self.assertIn("/data/items.json", health.get("endpoints", {}))
        self.assertIsInstance(health.get("png_count"), int)
        self.assertGreaterEqual(health.get("png_count", 0), 0)

    def test_traversal_rejected(self) -> None:
        """前缀内目录穿越必须被拒绝（403/404），且不能泄露仓库文件内容。"""
        status, headers, body = self._request(f"{PREFIX}/../AGENTS.md")
        self.assertIn(status, (403, 404), f"目录穿越未被拒绝：status={status} body={body[:200]!r}")
        ctype = headers.get("content-type", "").lower()
        self.assertIn("application/json", ctype, f"拒绝响应应为 JSON 错误，实际 {ctype}")
        err = json.loads(body.decode("utf-8"))
        self.assertIs(err.get("ok"), False)
        text = body.decode("utf-8", "replace")
        self.assertNotIn("给 AI 的入口", text, "目录穿越响应泄露了 AGENTS.md 内容")
        self.assertNotIn("# AGENTS.md", text, "目录穿越响应泄露了 AGENTS.md 内容")


if __name__ == "__main__":
    unittest.main(verbosity=2)
