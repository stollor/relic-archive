/* =============================================================================
   qa/gate/env.mjs — 验收门禁的环境探测
   目标：不假设任何本机路径/命令存在；探测不到时给出可执行的修复建议，
        并让上层决定「这是 SKIP（环境不具备）还是 FAIL（关键能力缺失）」。
   探测项：node / python / Chrome / git / 上游 .mimocode 工作区。
   ========================================================================== */

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);

/** 仓库根（qa/gate/env.mjs → 上两级） */
export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export const exists = (p) => {
  try { return fs.existsSync(p); } catch { return false; }
};

/* --------------------------------- Python --------------------------------- */
const PY_CANDIDATES = [
  { cmd: process.env.PYTHON, args: [] },
  { cmd: 'python', args: [] },
  { cmd: 'python3', args: [] },
  { cmd: 'py', args: ['-3'] },
].filter((c) => c.cmd);

let pythonCache = null;

/** 探测可用的 Python（返回 {available, cmd, args, version, tried[]}） */
export function detectPython() {
  if (pythonCache) return pythonCache;
  const tried = [];
  for (const cand of PY_CANDIDATES) {
    const r = spawnSync(cand.cmd, [...cand.args, '-c', 'import sys;print(sys.version.split()[0])'], {
      encoding: 'utf8', timeout: 15000, windowsHide: true,
    });
    tried.push({ cmd: cand.cmd, args: cand.args, ok: r.status === 0, error: (r.stderr || '').trim().slice(0, 200) });
    if (r.status === 0) {
      pythonCache = {
        available: true, cmd: cand.cmd, args: cand.args,
        version: String(r.stdout || '').trim(), tried,
      };
      return pythonCache;
    }
  }
  pythonCache = { available: false, cmd: null, args: [], version: '', tried };
  return pythonCache;
}

/* --------------------------------- Chrome --------------------------------- */
/**
 * Chrome 探测（复用 qa/lib/cdp.js 的 resolveChrome，保持唯一实现）。
 * 返回 {ok, path, source, error, searched[]}。
 */
export function detectChrome() {
  try {
    const cdp = require('../lib/cdp.js');
    if (typeof cdp.resolveChrome !== 'function') {
      // 兼容还没升级 cdp.js 的旧版本：只认环境变量与默认路径。
      const fallback = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
      return exists(fallback)
        ? { ok: true, path: fallback, source: process.env.CHROME_PATH ? 'env' : 'default', searched: [fallback] }
        : { ok: false, path: null, source: null, error: 'qa/lib/cdp.js 尚未提供 resolveChrome()', searched: [fallback] };
    }
    const r = cdp.resolveChrome();
    return { ok: true, path: r.path, source: r.source, searched: r.searched || [r.path] };
  } catch (err) {
    return {
      ok: false, path: null, source: null,
      error: String(err && err.message ? err.message : err),
      searched: (err && err.searched) || [],
    };
  }
}

/* ---------------------------------- git ---------------------------------- */
export function detectGit() {
  const r = spawnSync('git', ['rev-parse', '--is-inside-work-tree'], { encoding: 'utf8', windowsHide: true, timeout: 15000 });
  if (r.status !== 0) return { available: false, sha: '', branch: '', dirtyFiles: [], error: (r.stderr || '').trim() };
  const sha = (spawnSync('git', ['rev-parse', '--short=7', 'HEAD'], { encoding: 'utf8', windowsHide: true }).stdout || '').trim();
  const branch = (spawnSync('git', ['branch', '--show-current'], { encoding: 'utf8', windowsHide: true }).stdout || '').trim();
  const porcelain = (spawnSync('git', ['status', '--porcelain'], { encoding: 'utf8', windowsHide: true }).stdout || '')
    .split(/\r?\n/).filter(Boolean);
  return { available: true, sha, branch, dirtyFiles: porcelain, clean: porcelain.length === 0 };
}

/** 自上次提交以来的改动文件（含未跟踪）；ref 可指定基准（如 origin/main） */
export function changedFiles(ref = null) {
  const args = ref ? ['diff', '--name-only', ref] : ['status', '--porcelain'];
  const r = spawnSync('git', args, { encoding: 'utf8', windowsHide: true, timeout: 20000 });
  if (r.status !== 0) return [];
  if (ref) return String(r.stdout || '').split(/\r?\n/).filter(Boolean);
  return String(r.stdout || '').split(/\r?\n/).filter(Boolean).map((line) => {
    // porcelain: "XY path" / "R  old -> new"
    const body = line.slice(3);
    const arrow = body.lastIndexOf(' -> ');
    return (arrow >= 0 ? body.slice(arrow + 4) : body).replace(/^"|"$/g, '');
  });
}

/* -------------------------------- 工作区 -------------------------------- */
/**
 * 上游 .mimocode 工作区（本仓库的父目录）是否可用。
 * 只有独立 clone / CI 环境才没有它——此时 sync-data 的漂移检查必须 SKIP 并说明原因，
 * 不能假装通过、也不能当作失败。
 */
export function detectWorkspace() {
  const root = path.resolve(REPO_ROOT, '..');
  const markers = {
    workspace: exists(path.join(root, 'AGENTS.md')) && exists(path.join(root, 'data')),
    data: exists(path.join(root, 'data', 'items.json')),
    build: exists(path.join(root, 'build')),
    icons: exists(path.join(root, 'assets', 'icons')),
  };
  const available = markers.workspace && markers.data;
  return {
    available,
    root,
    markers,
    reason: available
      ? `上游工作区可用：${root}`
      : `未检测到上游 .mimocode 工作区（${root} 缺少 AGENTS.md/data 等标记）；依赖工作区的检查会标记 SKIP`,
  };
}

/* ------------------------------ serve 管理 ------------------------------ */
/**
 * 启动本地静态服务器（site 根或子路径前缀），返回 {base, stop()}。
 * 端口随机（--port 0），因此并行/重复执行不会撞端口；退出时统一关闭。
 */
export class ManagedServer {
  constructor({ python, repoRoot = REPO_ROOT } = {}) {
    this.python = python;
    this.repoRoot = repoRoot;
    this.proc = null;
    this.base = null;
    this.logs = [];
  }

  async start({ prefix = '' } = {}) {
    if (!this.python || !this.python.available) throw new Error('Python 不可用，无法启动本地服务器');
    const args = [...this.python.args, 'serve.py', '--port', '0'];
    if (prefix) args.push('--prefix', prefix);
    const { spawn } = await import('node:child_process');
    const proc = spawn(this.python.cmd, args, {
      cwd: this.repoRoot, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    });
    this.proc = proc;
    const url = await new Promise((resolve, reject) => {
      let buf = '';
      const timer = setTimeout(() => {
        reject(new Error(`等待 serve.py 就绪超时（15s）。已输出：\n${buf.slice(-800)}`));
      }, 15000);
      const onData = (chunk) => {
        buf += chunk.toString();
        this.logs.push(chunk.toString());
        const m = buf.match(/访问地址\s*:\s*(http:\/\/[^\s]+)/);
        if (m) { clearTimeout(timer); resolve(m[1]); }
      };
      proc.stdout.on('data', onData);
      proc.stderr.on('data', (chunk) => { buf += chunk.toString(); this.logs.push(chunk.toString()); });
      proc.on('exit', (code) => {
        clearTimeout(timer);
        reject(new Error(`serve.py 提前退出 code=${code}\n${buf.slice(-800)}`));
      });
      proc.on('error', (err) => { clearTimeout(timer); reject(err); });
    });
    this.base = url.replace(/\/+$/, '');
    return this.base;
  }

  stop() {
    try { this.proc?.kill(); } catch { /* ignore */ }
    this.proc = null;
  }
}

/** 一次性汇总环境信息（写入报告 env 块，也用于控制台抬头） */
export function collectEnv() {
  const python = detectPython();
  const chrome = detectChrome();
  const git = detectGit();
  const workspace = detectWorkspace();
  return {
    os: `${process.platform} ${process.arch}`,
    node: process.version,
    python: { ...python, label: python.available ? `${python.cmd} ${python.version}` : '' },
    chrome,
    git,
    workspace,
    ci: !!(process.env.CI || process.env.GITHUB_ACTIONS),
    cwd: process.cwd(),
    repo_root: REPO_ROOT,
  };
}

/**
 * 判断一个检查是否因环境不具备而跳过（纯函数，供 gate 与单测共用）。
 * 关键原则：区分「环境不具备」与「测试失败」——缺 Python/Chrome 属于前者，
 * 但关键检查（required=true）被跳过时 gate 仍会以退出码 3 拒绝「假装通过」。
 *
 * @param {{requires?:string[], optional?:boolean}} check
 * @param {{python:{available:boolean,tried:Array}, chrome:{ok:boolean,error?:string}, workspace:{available:boolean,reason:string}}} env
 * @param {{allowMissingChrome?:boolean}} opts
 * @returns {null | {required:boolean, error:string, hint:string}}
 */
export function missingRequirements(check, env, opts = {}) {
  const req = (check && check.requires) || [];
  const optional = !!(check && check.optional);
  if (req.includes('python') && !(env.python && env.python.available)) {
    return {
      required: true,
      error: `Python 不可用（已尝试 ${((env.python && env.python.tried) || []).map((t) => t.cmd).join(' / ') || 'python'})`,
      hint: '安装 Python 3.12+ 并加入 PATH，或设置环境变量 PYTHON=<python.exe 路径>',
    };
  }
  if (req.includes('chrome') && !(env.chrome && env.chrome.ok)) {
    return {
      required: !opts.allowMissingChrome && !optional,
      error: `Chrome 未探测到${env.chrome && env.chrome.error ? `：${env.chrome.error}` : ''}`,
      hint: '安装 Chrome/Chromium 或设置 CHROME_PATH=<chrome.exe 路径>；CI runner 自带 Chrome',
    };
  }
  if (req.includes('workspace') && !(env.workspace && env.workspace.available)) {
    return {
      required: optional ? false : true,
      error: (env.workspace && env.workspace.reason) || '上游 .mimocode 工作区不可用',
      hint: '在 .mimocode 工作区根目录运行本仓库的 gate 可启用该检查；独立 clone / CI 下属预期跳过',
    };
  }
  return null;
}
