#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""一键发布：推送 → 等 GitHub Pages 自动重建 → 线上冒烟验收。

本仓库是零构建静态站点：**推送 `main` 即触发 GitHub Pages（legacy，无 CI）自动重建**。
本脚本负责把这条链路做成可重复、可验证的一步操作，避免「推了但没确认线上真的换了」：

    1) 预检：分支必须是 main、工作树必须干净（防止推半截）
    2) 推送：优先用系统 Git（本机 ucrt64 git 上传会卡死，见 docs/LESSONS.md #3）
    3) 校验：远端 main 的 sha 必须等于本地 HEAD
    4) 等发布：轮询线上站点的「内容指纹」（对本次改动涉及的站点资源做换行归一后的 sha256），
              直到与本地一致或超时；这是判断「新版本真的上线了」最硬的信号（不依赖 Actions/API）
    5) 冒烟：关键资源全部 200；可选跑 `node qa/shot.js --base <线上地址>` 做真实浏览器验收

用法（在站点仓库根执行）：
    python pipeline/deploy.py                     # 推送 + 等发布 + 冒烟
    python pipeline/deploy.py --dry-run           # 只看计划，不做任何写操作/网络推送
    python pipeline/deploy.py --verify-only       # 不推送，只等发布并冒烟（手动 push 后重跑）
    python pipeline/deploy.py --skip-browser      # 跳过 shot.js 浏览器门禁（更快）
    python pipeline/deploy.py --timeout 600       # 发布等待上限（秒，默认 300）
    python pipeline/deploy.py --base https://stollor.github.io/relic-archive

退出码：
    0 成功（已发布且线上冒烟通过）
    1 冒烟失败
    2 预检拒绝（分支不对 / 工作树不干净 / 不是 git 仓库）
    3 推送失败
    4 等待发布超时（线上内容仍不是本次提交）
    5 远端 sha 与本地不一致

不改仓库内容、不写任何凭据；只用标准库 + 本机 git / node。
"""
from __future__ import annotations

import argparse
import hashlib
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

SITE = Path(__file__).resolve().parent.parent
DEFAULT_BASE = 'https://stollor.github.io/relic-archive'
DEFAULT_REMOTE = 'origin'

# 判断「线上是否已是新版本」只看站点运行时资源（文档/测试变化不影响线上行为）
SITE_ASSET_PREFIXES = ('js/', 'css/', 'data/', 'assets/')
SITE_ASSET_ROOT_FILES = ('index.html', 'lab.html', 'favicon.svg', 'serve.py')

# 线上冒烟必过资源（全部应 200）
SMOKE_PATHS = (
    '/',
    '/lab.html',
    '/js/main.js',
    '/js/domains.js',
    '/js/core/api.js',
    '/css/tokens.css',
    '/data/items.json',
    '/data/builds.json',
    '/data/codex/index.json',
    '/assets/icons/T_UI_Ring_BraidedThorns_Icon.png',
)

SYSTEM_GIT_CANDIDATES = (
    r'C:\Program Files\Git\cmd\git.exe',
    r'C:\Program Files (x86)\Git\cmd\git.exe',
)


def out(msg: str = '') -> None:
    print(msg, flush=True)


def step(msg: str) -> None:
    out(f'[deploy] {msg}')


def fail(msg: str, code: int) -> int:
    out(f'[x] {msg}')
    return code


def normalize_bytes(data: bytes) -> bytes:
    """换行归一（仓库约定 LF；Windows 检出的工作树可能是 CRLF）"""
    return data.replace(b'\r\n', b'\n').replace(b'\r', b'\n')


def digest(data: bytes) -> str:
    return hashlib.sha256(normalize_bytes(data)).hexdigest()


def pick_git() -> tuple[str, bool]:
    """返回 (git 可执行文件, 是否系统 Git)。系统 Git 优先（LESSONS #3）。"""
    for cand in SYSTEM_GIT_CANDIDATES:
        if Path(cand).is_file():
            return cand, True
    found = shutil.which('git')
    return (found, False) if found else ('git', False)


def run(args: list[str], *, timeout: int = 120, cwd: Path = SITE) -> subprocess.CompletedProcess:
    return subprocess.run(
        args, cwd=str(cwd), capture_output=True, text=True,
        encoding='utf-8', errors='replace', timeout=timeout,
    )


def git_output(git: str, *args: str, timeout: int = 120) -> str:
    proc = run([git, *args], timeout=timeout)
    if proc.returncode != 0:
        raise RuntimeError(f'git {" ".join(args)} 失败：{(proc.stderr or proc.stdout).strip()}')
    return proc.stdout.strip()


def is_site_asset(path: str) -> bool:
    p = path.lstrip('./')
    return p in SITE_ASSET_ROOT_FILES or p.startswith(SITE_ASSET_PREFIXES)


def pick_marker(changed: list[str]) -> str | None:
    """从改动文件里挑一个线上可验证的内容指纹（优先 js/css/html，其次 data/assets）。"""
    assets = [p for p in changed if is_site_asset(p)]
    if not assets:
        return None
    def rank(p: str) -> tuple[int, int]:
        if p.startswith('js/'):
            return (0, len(p))
        if p.startswith('css/'):
            return (1, len(p))
        if p in ('index.html', 'lab.html'):
            return (2, len(p))
        return (3, len(p))
    return sorted(assets, key=rank)[0]


def remote_sha(git: str, remote: str, branch: str) -> str | None:
    proc = run([git, 'ls-remote', '--heads', remote, branch], timeout=60)
    if proc.returncode != 0:
        return None
    for line in proc.stdout.splitlines():
        parts = line.split()
        if len(parts) == 2 and parts[1] == f'refs/heads/{branch}':
            return parts[0]
    return None


def fetch_path(base: str, rel: str, timeout: int = 30) -> tuple[int, bytes]:
    url = base.rstrip('/') + '/' + rel.lstrip('/')
    sep = '&' if '?' in url else '?'
    req = urllib.request.Request(
        f'{url}{sep}cb={int(time.time() * 1000)}',
        headers={'User-Agent': 'relic-archive-deploy/1.0', 'Cache-Control': 'no-cache'},
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.status, resp.read()
    except urllib.error.HTTPError as err:
        return err.code, b''
    except Exception:  # noqa: BLE001 - 网络抖动按「还没更新」处理
        return 0, b''


def wait_for_deploy(base: str, marker: str | None, expect: bytes | None,
                    timeout_s: int, interval_s: int = 6) -> tuple[bool, str]:
    if not marker:
        # 本次提交只改了文档/测试：线上内容指纹不可用，退化为「等一会儿 + 冒烟」
        settle = min(45, timeout_s)
        step(f'本次提交未改动站点资源，无法用内容指纹判断；等待 {settle}s 后做冒烟')
        time.sleep(settle)
        return True, 'no-marker'

    step(f'等待线上发布：marker={marker}（上限 {timeout_s}s，每 {interval_s}s 轮询）')
    deadline = time.time() + timeout_s
    attempt = 0
    while time.time() < deadline:
        attempt += 1
        status, body = fetch_path(base, marker)
        if status == 200 and expect is not None and digest(body) == digest(expect):
            return True, f'{marker} 内容已与本地一致（第 {attempt} 次轮询）'
        time.sleep(interval_s)
    return False, f'{marker} 在 {timeout_s}s 内仍未与本地一致（最后状态 {status}）'


def smoke(base: str, *, skip_browser: bool) -> tuple[bool, list[str]]:
    problems: list[str] = []
    step('线上资源探活：')
    for rel in SMOKE_PATHS:
        status, _ = fetch_path(base, rel)
        ok = status == 200
        out(f'    {"PASS" if ok else "FAIL"}  {status:<3} {rel}')
        if not ok:
            problems.append(f'{rel} → HTTP {status}')

    if skip_browser:
        step('已跳过浏览器门禁（--skip-browser）')
        return not problems, problems

    node = shutil.which('node')
    if not node:
        problems.append('找不到 node，无法跑 qa/shot.js（可用 --skip-browser 跳过）')
        return False, problems
    step('线上浏览器门禁：node qa/shot.js --base … --theme dark --desktop-only')
    proc = run([node, 'qa/shot.js', '--base', base, '--theme', 'dark', '--desktop-only'],
               timeout=900)
    tail = [ln for ln in (proc.stdout or '').splitlines() if ln.strip()][-3:]
    for ln in tail:
        out(f'    {ln}')
    if proc.returncode != 0:
        problems.append(f'qa/shot.js 退出码 {proc.returncode}')
        if proc.stderr.strip():
            out(f'    {proc.stderr.strip()[-400:]}')
    return not problems, problems


def main(argv: list[str] | None = None) -> int:
    try:
        sys.stdout.reconfigure(encoding='utf-8')  # type: ignore[attr-defined]
    except Exception:  # noqa: BLE001 - 非 tty/老 Python 忽略
        pass

    ap = argparse.ArgumentParser(description='一键发布：推送 → 等 Pages 重建 → 线上冒烟')
    ap.add_argument('--branch', default='main')
    ap.add_argument('--remote', default=DEFAULT_REMOTE)
    ap.add_argument('--base', default=DEFAULT_BASE, help='线上站点地址（Pages 子路径）')
    ap.add_argument('--timeout', type=int, default=300, help='等待发布上限（秒）')
    ap.add_argument('--marker', default='', help='手动指定内容指纹文件（相对仓库根）')
    ap.add_argument('--dry-run', action='store_true', help='只打印计划，不推送')
    ap.add_argument('--verify-only', action='store_true', help='不推送，只等发布并冒烟')
    ap.add_argument('--skip-browser', action='store_true', help='跳过 qa/shot.js 浏览器门禁')
    args = ap.parse_args(argv)

    git, is_system = pick_git()
    if not Path(git).is_file() and not shutil.which(git):
        return fail('找不到 git', 2)
    hint = '' if is_system else '（警告：不是系统 Git，上传可能卡死，见 docs/LESSONS.md #3）'
    step(f'git = {git}{hint}')

    # ---------------- 预检 ----------------
    proc = run([git, 'rev-parse', '--show-toplevel'])
    if proc.returncode != 0:
        return fail('当前目录不是 git 仓库', 2)
    branch = git_output(git, 'rev-parse', '--abbrev-ref', 'HEAD')
    if branch != args.branch:
        return fail(f'当前分支是 {branch}，只允许从 {args.branch} 发布', 2)
    dirty = git_output(git, 'status', '--porcelain')
    if dirty:
        return fail(f'工作树不干净，先提交再发布：\n{dirty}', 2)

    local = git_output(git, 'rev-parse', 'HEAD')
    step(f'本地 HEAD = {local[:12]}（{branch}）')
    remote = remote_sha(git, args.remote, args.branch)
    step(f'远端 {args.remote}/{args.branch} = {(remote or "?")[:12]}')

    if remote and remote != local:
        changed = git_output(git, 'diff', '--name-only', f'{remote}..{local}').splitlines()
        step(f'待推送提交涉及的站点资源：{sum(1 for p in changed if is_site_asset(p))} 个 / 共 {len(changed)} 个文件')
    elif remote == local:
        step('本地与远端一致：无需推送，仅校验线上是否已是该版本')
        changed = []
    else:
        changed = git_output(git, 'show', '--name-only', '--format=', local).splitlines()

    marker = args.marker or pick_marker(changed)
    if marker:
        local_file = SITE / marker
        if not local_file.is_file():
            return fail(f'marker 文件不存在：{marker}', 2)
        expect = local_file.read_bytes()
        step(f'内容指纹 marker = {marker}（sha256={digest(expect)[:12]}）')
    else:
        expect = None
        step('没有可用的站点资源改动作为内容指纹')

    if args.dry_run:
        step('--dry-run：不会执行推送 / 轮询 / 浏览器门禁')
        if remote != local:
            out(f'    将执行：{git} -c http.version=HTTP/1.1 push {args.remote} {args.branch}')
        out(f'    将等待：{args.base}/{marker or "(固定等待)"}')
        out(f'    将冒烟：{len(SMOKE_PATHS)} 个资源' + ('（跳过浏览器）' if args.skip_browser else ' + qa/shot.js dark 桌面'))
        return 0

    # ---------------- 推送 ----------------
    if not args.verify_only and remote != local:
        step(f'推送 {remote}/{args.branch} …')
        push_cmd = [git, '-c', 'http.version=HTTP/1.1', 'push', args.remote, args.branch]
        proc = run(push_cmd, timeout=600)
        if proc.returncode != 0:
            step('首次推送失败，去掉 HTTP/1.1 强制参数重试一次')
            proc = run([git, 'push', args.remote, args.branch], timeout=600)
        if proc.returncode != 0:
            return fail(f'推送失败：\n{(proc.stderr or proc.stdout).strip()[-600:]}', 3)
        for ln in [ln for ln in (proc.stderr or '').splitlines() if ln.strip()][-3:]:
            out(f'    {ln}')

        pushed = remote_sha(git, args.remote, args.branch)
        if pushed != local:
            return fail(f'推送后远端 sha={str(pushed)[:12]} 与本地 {local[:12]} 不一致', 5)
        step(f'远端已更新为 {local[:12]}；GitHub Pages 将自动重建（无需 CI）')

    # ---------------- 等发布 ----------------
    ok, detail = wait_for_deploy(args.base, marker, expect, args.timeout)
    out(f'    {detail}')
    if not ok:
        return fail('等待发布超时：线上仍是旧版本（可稍后重跑 --verify-only 复验）', 4)

    # ---------------- 冒烟 ----------------
    step(f'线上冒烟：{args.base}')
    ok, problems = smoke(args.base, skip_browser=args.skip_browser)
    if not ok:
        return fail('冒烟失败：\n' + '\n'.join(f'  - {p}' for p in problems), 1)

    step(f'完成：{args.branch}@{local[:12]} 已发布并通过线上验收')
    return 0


if __name__ == '__main__':
    sys.exit(main())
