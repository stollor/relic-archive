#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""REMNANT II · 遗物档案 —— 本地离线静态服务器（仅标准库）。

同源提供站点运行时资源（白名单，见 SITE_ROOT_FILES / SITE_ROUTES）：
  /              -> <站点根>/index.html（以及 lab.html / favicon.svg）
  /css/*.css     -> <站点根>/css/
  /js/*.js       -> <站点根>/js/（ES module）
  /data/*.json   -> <站点根>/data/（items.json、builds.json、icon_index.json、codex/index.json 等）
  /assets/*      -> <站点根>/assets/（icons/*.png 等图片/字体）
  /api/health    -> 服务状态 JSON（只含状态字段，不含本机绝对路径）

仓库内部文件（AGENTS.md / README.md / docs/ / qa/ / pipeline/ / .git/ / .github/ /
dotfiles / __pycache__ 等）不属于站点运行时，一律 404 —— 避免本地开发服务器把
仓库内部内容暴露给浏览器/扩展/误访问。GitHub Pages 线上暴露面由发布结构决定，不在此列。

用法：
  python serve.py                 # 默认 http://127.0.0.1:8777/
  python serve.py --port 8780
  python serve.py --host 0.0.0.0 --port 8777 --open
  python serve.py --prefix /relic-archive    # 模拟 GitHub Pages 子路径部署
  python serve.py --port 0                   # 随机端口（自动化测试用）

`--prefix` 会让站点只在前缀下可用（`/relic-archive/`、`/relic-archive/data/...`），
根路径 `/` 302 到前缀首页；缺前缀的资源请求返回 404——这样「页面对根路径写死绝对路径」
的 bug 在本地就会暴露，而不是等发布到 Pages 才发现。

额外提供 GET /api/health（JSON）：数据/图标/CLI 就绪状态，前端与自测共用。
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
import webbrowser
from datetime import datetime
from email.utils import formatdate
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlsplit

# 站点自包含：本文件所在目录 = 站点根；data/ 与 assets/ 都在站点内。
# WORKSPACE_DIR 只用于可选的 CLI（.mimocode 工作区里的 tools/ + data/rmn2.db），
# 单独 clone 本仓库时 CLI 会显示为不可用，但站点本身完全可用。
SITE_DIR = Path(__file__).resolve().parent
WORKSPACE_DIR = SITE_DIR.parent
WEB_DIR = SITE_DIR
DATA_DIR = SITE_DIR / "data"
ASSETS_DIR = SITE_DIR / "assets"
ITEMS_JSON = DATA_DIR / "items.json"
ICON_INDEX = DATA_DIR / "icon_index.json"
# 运行时数据（/data/ 下；页面按需加载）
EXTRA_DATA = {
    "site_data": DATA_DIR / "site_data.json",   # 实验室数据（护甲/饰品/预设/矩阵）
    "terms": DATA_DIR / "terms.json",           # 术语与语义映射
    "acq": DATA_DIR / "acq.json",               # 获取途径
    "codex": DATA_DIR / "codex" / "index.json",  # 知识库内容
    "archetypes": DATA_DIR / "archetypes.json",  # 职业表（主/副职业、防御向专长）
    "item_effects": DATA_DIR / "item_effects.json",  # 道具「效果原文」（游戏内效果句，非风味描述）
    "builds": DATA_DIR / "builds.json",             # 流派：7 套推荐配装（pipeline/mk_builds_json.py 生成）
}
# 可选 CLI（不在本仓库内；仅当从 .mimocode 工作区运行时可用）
CLI_SCRIPT = WORKSPACE_DIR / "tools" / "rmn2_cli.py"
CLI_DB = WORKSPACE_DIR / "data" / "rmn2.db"

DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 8777

MIME_TYPES = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".jsonl": "application/x-ndjson; charset=utf-8",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".gif": "image/gif",
    ".svg": "image/svg+xml",
    ".ico": "image/x-icon",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
    ".txt": "text/plain; charset=utf-8",
    ".md": "text/markdown; charset=utf-8",
    ".db": "application/octet-stream",
    ".wasm": "application/wasm",
}

# 站点白名单：只有运行时资源可被 HTTP 访问；其余路径 404。
# key = 首段目录，value = (磁盘根, 允许的扩展名集合)；根文件单独用 SITE_ROOT_FILES。
SITE_ROOT_FILES = {
    "/index.html": "index.html",
    "/lab.html": "lab.html",
    "/favicon.svg": "favicon.svg",
}
SITE_ROUTES = {
    "css": (lambda: SITE_DIR / "css", {".css"}),
    "js": (lambda: SITE_DIR / "js", {".js"}),
    "data": (lambda: DATA_DIR, {".json", ".jsonl"}),
    "assets": (lambda: ASSETS_DIR, {".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg", ".ico", ".woff", ".woff2"}),
}


def _mime(path: Path) -> str:
    ext = path.suffix.lower()
    if ext in MIME_TYPES:
        return MIME_TYPES[ext]
    guess, _ = __import__("mimetypes").guess_type(path.name)
    return guess or "application/octet-stream"


def _file_info(path: Path) -> dict:
    """文件/目录状态（只含状态字段；不返回本机绝对路径——/api/health 会直接下发）。"""
    try:
        st = path.stat()
        return {
            "exists": True,
            "size": st.st_size,
            "mtime": datetime.fromtimestamp(st.st_mtime).isoformat(timespec="seconds"),
        }
    except OSError:
        return {"exists": False}


def _png_inventory() -> dict:
    """统计 assets/icons 下的 PNG（每次调用实时统计，图标可能在服务启动后才生成）。"""
    icons_dir = ASSETS_DIR / "icons"
    result = {"exists": ASSETS_DIR.is_dir(), "png_count": 0}
    if icons_dir.is_dir():
        try:
            result["png_count"] = sum(1 for p in icons_dir.glob("*.png") if p.is_file())
        except OSError:
            pass
    return result


def build_health(prefix: str = "") -> dict:
    icons = _png_inventory()
    return {
        "ok": True,
        "service": "remnant2-item-archive",
        "version": "1.0.0",
        "time": datetime.now().isoformat(timespec="seconds"),
        "prefix": prefix,
        "web_dir": _file_info(WEB_DIR),
        "data_dir": _file_info(DATA_DIR),
        "assets_dir": _file_info(ASSETS_DIR),
        "items_json": _file_info(ITEMS_JSON),
        "icon_index": _file_info(ICON_INDEX),
        "extra_data": {k: _file_info(v) for k, v in EXTRA_DATA.items()},
        "png_count": icons["png_count"],
        "tools": {
            # 只暴露就绪状态，不下发本机绝对路径
            "cli_ready": CLI_SCRIPT.is_file() and CLI_DB.is_file(),
            "cli_script_exists": CLI_SCRIPT.is_file(),
            "cli_db_exists": CLI_DB.is_file(),
        },
        "endpoints": {
            "/": "前端页面",
            "/data/items.json": "主数据集",
            "/data/icon_index.json": "图标索引（可能尚未生成）",
            "/data/site_data.json": "实验室数据（护甲/饰品/预设/矩阵）",
            "/data/terms.json": "术语与语义映射",
            "/data/acq.json": "获取途径",
            "/data/codex/index.json": "知识库内容",
            "/data/builds.json": "流派：7 套推荐配装（含道具摘要与护甲/规则口径）",
            "/assets/icons/*.png": "图标文件（可能尚未生成）",
            "/api/health": "本状态接口",
        },
    }


class ArchiveServer(ThreadingHTTPServer):
    """带站点前缀的服务器：prefix='' 为根路径，'/relic-archive' 模拟 Pages 子路径。"""
    daemon_threads = True
    prefix = ""


class ArchiveHandler(BaseHTTPRequestHandler):
    server_version = "Remnant2Archive/1.0"
    protocol_version = "HTTP/1.1"

    # ---------- 基础设施 ----------
    def do_GET(self) -> None:  # noqa: N802
        self._serve(send_body=True)

    def do_HEAD(self) -> None:  # noqa: N802
        self._serve(send_body=False)

    @property
    def prefix(self) -> str:
        return getattr(self.server, "prefix", "") or ""

    def _serve(self, send_body: bool) -> None:
        started = time.perf_counter()
        parsed = urlsplit(self.path)
        raw_path = unquote(parsed.path)
        prefix = self.prefix

        # 子路径模式：只在前缀下提供站点；根路径给人留一个跳转，其余缺前缀的请求一律 404。
        if prefix:
            if raw_path in ("", "/"):
                self._send_redirect(f"{prefix}/", send_body)
                self._log_request(started, HTTPStatus.FOUND, 0)
                return
            if raw_path == "/api/health":
                # 根下的健康检查也保留：工具/脚本在被注入前缀前后都能探活。
                pass
            elif raw_path == prefix or raw_path.startswith(prefix + "/"):
                raw_path = raw_path[len(prefix):] or "/"
            else:
                self._send_error(HTTPStatus.NOT_FOUND, f"未知路由：{raw_path}", send_body,
                                 extra={"hint": f"子路径模式：资源必须以 {prefix}/ 开头"
                                                "（页面对根路径写死绝对路径会在 Pages 上 404）"})
                self._log_request(started, HTTPStatus.NOT_FOUND, 0)
                return

        if raw_path == "/api/health":
            payload = json.dumps(build_health(prefix), ensure_ascii=False, indent=1).encode("utf-8")
            self._send_bytes(HTTPStatus.OK, payload, "application/json; charset=utf-8",
                             cache="no-store", send_body=send_body)
            self._log_request(started, HTTPStatus.OK, len(payload))
            return

        if raw_path == "/favicon.ico":
            # 浏览器默认请求：指向 SVG 图标，避免 404 噪音
            self._send_redirect(f"{prefix}/favicon.svg", send_body)
            self._log_request(started, HTTPStatus.FOUND, 0)
            return

        try:
            target, root_name = self._resolve(raw_path)
        except PermissionError:
            self._send_error(HTTPStatus.FORBIDDEN, "路径越界，已拒绝访问", send_body)
            self._log_request(started, HTTPStatus.FORBIDDEN, 0)
            return

        if target is None:
            self._send_error(HTTPStatus.NOT_FOUND, f"未知路由：{raw_path[:200]}", send_body,
                             extra={"hint": "可用路由：/、/index.html、/lab.html、/css/*、/js/*、/data/*.json、/assets/*、/api/health"})
            self._log_request(started, HTTPStatus.NOT_FOUND, 0)
            return

        if root_name == "assets" and not ASSETS_DIR.is_dir():
            self._send_error(HTTPStatus.NOT_FOUND, "assets 目录尚未生成", send_body,
                             extra={"hint": "assets/icons/ 缺失；前端会自动降级为占位图。"})
            self._log_request(started, HTTPStatus.NOT_FOUND, 0)
            return

        if target.is_dir():
            index = target / "index.html"
            if index.is_file():
                target = index
            else:
                self._send_error(HTTPStatus.NOT_FOUND, "目录不可浏览", send_body)
                self._log_request(started, HTTPStatus.NOT_FOUND, 0)
                return

        if not target.is_file():
            self._send_error(HTTPStatus.NOT_FOUND, f"文件不存在：{raw_path[:200]}", send_body,
                             extra={"hint": "仅站点运行时资源可访问（白名单）"})
            self._log_request(started, HTTPStatus.NOT_FOUND, 0)
            return

        try:
            payload = target.read_bytes()
        except OSError as exc:  # pragma: no cover - 磁盘错误
            self._send_error(HTTPStatus.INTERNAL_SERVER_ERROR, f"读取失败：{exc}", send_body)
            self._log_request(started, HTTPStatus.INTERNAL_SERVER_ERROR, 0)
            return

        ctype = _mime(target)
        cache = "no-cache" if target.suffix.lower() in (".json", ".jsonl", ".html", ".js", ".css") else "public, max-age=60"
        # 协商缓存：内容指纹（mtime+size）→ 304，避免开发时每次刷新重下 7MB items.json
        try:
            st = target.stat()
            etag = f'"{st.st_mtime_ns:x}-{st.st_size:x}"'
            last_modified = formatdate(st.st_mtime, usegmt=True)
        except OSError:
            etag = last_modified = None
        if etag:
            inm = self.headers.get("If-None-Match")
            if inm and etag in [token.strip() for token in inm.split(",")]:
                self.send_response(HTTPStatus.NOT_MODIFIED)
                self.send_header("ETag", etag)
                self.send_header("Cache-Control", cache)
                self.end_headers()
                self._log_request(started, HTTPStatus.NOT_MODIFIED, 0)
                return
        self._send_bytes(HTTPStatus.OK, payload, ctype, cache=cache, send_body=send_body,
                         etag=etag, last_modified=last_modified)
        self._log_request(started, HTTPStatus.OK, len(payload))

    def _resolve(self, raw_path: str) -> tuple[Path | None, str]:
        """URL 路径 → 磁盘文件（站点白名单 + 目录穿越防护）。

        返回 (None, 首段) 表示不在白名单 → 404；越界/畸形路径抛 PermissionError → 403。
        只允许：/（index.html）、/index.html、/lab.html、/favicon.svg、
                /css/*.css、/js/*.js、/data/*.json|*.jsonl、/assets/*（图片/字体）。
        """
        if raw_path in ("", "/"):
            return WEB_DIR / "index.html", "web"
        # 先做路径形态拒绝（Windows 下反斜杠也是分隔符；NUL 截断；dot 段/隐藏文件）
        if "\x00" in raw_path or "\\" in raw_path:
            raise PermissionError(raw_path)
        parts = [seg for seg in raw_path.split("/") if seg not in ("", ".")]
        if not parts or any(seg == ".." for seg in parts):
            raise PermissionError(raw_path)
        if any(seg.startswith(".") for seg in parts):
            return None, parts[0]  # dotfile / 隐藏目录：404

        if len(parts) == 1 and raw_path in SITE_ROOT_FILES:
            return WEB_DIR / SITE_ROOT_FILES[raw_path], "web"

        head, rest = parts[0], parts[1:]
        route = SITE_ROUTES.get(head)
        if route is None or not rest:
            return None, head
        base, allowed_exts = route
        base_dir = base()
        filename = rest[-1]
        if Path(filename).suffix.lower() not in allowed_exts:
            return None, head
        base_resolved = base_dir.resolve()
        target = (base_resolved / Path(*rest)).resolve()
        if target != base_resolved and base_resolved not in target.parents:
            raise PermissionError(raw_path)
        return target, head

    def _send_bytes(self, status: HTTPStatus, payload: bytes, content_type: str,
                    cache: str = "no-cache", send_body: bool = True,
                    etag: str | None = None, last_modified: str | None = None) -> None:
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(payload)))
        self.send_header("Cache-Control", cache)
        if etag:
            self.send_header("ETag", etag)
        if last_modified:
            self.send_header("Last-Modified", last_modified)
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Access-Control-Allow-Origin", "same-origin")
        self.end_headers()
        if send_body:
            try:
                self.wfile.write(payload)
            except (BrokenPipeError, ConnectionResetError):
                pass

    def _send_redirect(self, location: str, send_body: bool) -> None:
        self.send_response(HTTPStatus.FOUND)
        self.send_header("Location", location)
        self.send_header("Content-Length", "0")
        self.end_headers()
        _ = send_body  # 302 无 body

    def _send_error(self, status: HTTPStatus, message: str, send_body: bool,
                    extra: dict | None = None) -> None:
        body = {"ok": False, "status": int(status), "error": message}
        if extra:
            body.update(extra)
        payload = json.dumps(body, ensure_ascii=False, indent=1).encode("utf-8")
        self._send_bytes(status, payload, "application/json; charset=utf-8",
                         cache="no-store", send_body=send_body)

    def _log_request(self, started: float, status: HTTPStatus, size: int) -> None:
        elapsed_ms = (time.perf_counter() - started) * 1000.0
        stamp = datetime.now().strftime("%H:%M:%S")
        print(f"[{stamp}] {int(status)} {self.command:<4} {self.path} "
              f"({size} B, {elapsed_ms:.1f} ms)", flush=True)

    def log_message(self, fmt: str, *args) -> None:  # 覆盖默认日志，统一走 _log_request
        pass


def print_banner(host: str, port: int, prefix: str = "") -> None:
    url = f"http://{host}:{port}{prefix}/"
    items = ITEMS_JSON
    items_state = f"{items.stat().st_size / 1024 / 1024:.2f} MB" if items.is_file() else "缺失！"
    index_state = "已生成" if ICON_INDEX.is_file() else "未生成 → 前端使用占位图"
    png_count = _png_inventory()["png_count"]
    assets_state = (f"{png_count} 张 PNG" if ASSETS_DIR.is_dir()
                    else "目录未生成 → 前端使用占位图")
    width = 64
    line = "─" * width
    print(line)
    print("  REMNANT II · 遗物档案  |  LOCAL ITEM ARCHIVE")
    print(line)
    print(f"  访问地址 : {url}")
    print(f"  健康检查 : {url}api/health")
    print(f"  前端目录 : {WEB_DIR}")
    print(f"  数据集   : {items_state}  {items}")
    print(f"  图标索引 : {index_state}")
    print(f"  图标目录 : {assets_state}")
    print(f"  停止服务 : Ctrl+C")
    print(line, flush=True)


def normalize_prefix(raw: str) -> str:
    """把 --prefix 归一为 ''（根）或 '/a/b'（无尾斜杠）。"""
    p = (raw or "").strip()
    if p in ("", "/"):
        return ""
    if not p.startswith("/"):
        p = "/" + p
    p = p.rstrip("/")
    if any(seg in ("", ".", "..") for seg in p.strip("/").split("/")):
        raise ValueError(f"非法前缀：{raw!r}（示例：/relic-archive）")
    return p


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="REMNANT II 遗物档案 · 本地静态服务器（标准库实现，同源提供 web/ + /data/ + /assets/）")
    parser.add_argument("--host", default=DEFAULT_HOST, help=f"监听地址（默认 {DEFAULT_HOST}）")
    parser.add_argument("--port", type=int, default=DEFAULT_PORT,
                        help=f"监听端口（默认 {DEFAULT_PORT}；0=随机空闲端口）")
    parser.add_argument("--prefix", default="",
                        help="站点前缀（模拟 GitHub Pages 子路径，如 /relic-archive；默认根路径）")
    parser.add_argument("--open", action="store_true", help="启动后在浏览器打开页面")
    args = parser.parse_args(argv)

    try:
        prefix = normalize_prefix(args.prefix)
    except ValueError as exc:
        print(f"[error] {exc}", file=sys.stderr)
        return 2

    if not (WEB_DIR / "index.html").is_file():
        print(f"[error] 找不到前端文件：{WEB_DIR / 'index.html'}", file=sys.stderr)
        return 2
    if not ITEMS_JSON.is_file():
        print(f"[warn] 数据集不存在：{ITEMS_JSON}（页面会显示加载错误）", file=sys.stderr)

    try:
        httpd = ArchiveServer((args.host, args.port), ArchiveHandler)
    except OSError as exc:
        print(f"[error] 无法监听 {args.host}:{args.port} -> {exc}", file=sys.stderr)
        print(f"[hint] 端口可能被占用，换一个：python serve.py --port {args.port + 1}", file=sys.stderr)
        return 1

    httpd.prefix = prefix
    actual_port = httpd.server_address[1]
    print_banner(args.host, actual_port, prefix)
    base = f"http://{args.host}:{actual_port}{prefix}/"
    if args.open:
        webbrowser.open(base)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n[stop] 服务已停止。", flush=True)
    finally:
        httpd.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
