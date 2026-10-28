# DEPLOY — 发布与部署手册（GitHub Pages / 静态托管）

> 目标：把 `relic-archive/` 这个**零构建静态站点**发布出去，并能在发布后验证「真的能用」。
> 当前线上：**https://stollor.github.io/relic-archive/** · 仓库 **https://github.com/stollor/relic-archive**

---

## 1. 当前发布形态（已生效）

| 项 | 值 |
|---|---|
| 仓库 | `stollor/relic-archive`（公开） |
| 默认分支 | `main` |
| Pages source | `main` / `(root)`，构建类型 `legacy`（无 CI） |
| Jekyll | 关闭（仓库根有 `.nojekyll`，文件原样下发） |
| 站点根 | `index.html`（SPA）+ `lab.html`（旧链接跳转页） |
| 资源路径 | 相对路径 `./data/*`、`./assets/*`（兼容根路径与 `/relic-archive/` 子路径） |
| HTTPS | `*.github.io` 默认 HTTPS |
| 构建耗时 | 通常 20–60 秒 |
| 发布方式 | `git push origin main` 自动触发 |

> 为什么部署不用 GitHub Actions：站点没有构建步骤，`push` 触发 legacy 构建即可。
> **测试**用 `.github/workflows/qa.yml`（quick / data / full）在 PR 与 push 时跑门禁——CI 只测试，不改变部署方式。
> 为什么加 `.nojekyll`：legacy 构建默认走 Jekyll，会忽略 `_` 前缀目录（如 `pipeline/_source/`），
> 且无谓加工静态文件；`.nojekyll` 让它原样下发。

---

## 2. 日常发布流程

```bash
cd .mimocode/relic-archive

# 1) 发布前门禁（一个入口；自动起服务、自动判环境）
.erify.ps1 deploy        # = full（真实 Chrome 全量）+ deploy.py --dry-run 预检；不推送
# 任意 shell：node qa/gate.mjs deploy
# 只想快速确认：.erify.ps1 quick / related（见 AGENTS.md §1）

# 2) 提交（一次只做一件事）
git status                                          # 只应有预期文件
git add -A
git commit -m "feat: ..."                           # 中文 + conventional 前缀

# 3) 一键发布：推送 → 等 Pages 自动重建 → 线上冒烟（推荐）
python pipeline/deploy.py
```

### 2.1 `pipeline/deploy.py` 做了什么

GitHub Pages（legacy 构建）**推送即自动重建**，无需 CI；脚本负责把「推送 → 重建 → 线上真的换了」做成可验证的一步：

| 步骤 | 动作 | 失败码 |
|---|---|---|
| 预检 | 分支必须是 `main`、工作树必须干净（防止推半截） | 2 |
| 推送 | 优先用系统 Git（本机 ucrt64 git 上传会卡死）；自动带 `http.version=HTTP/1.1`，失败再重试一次 | 3 |
| 校验 | 远端 `main` 的 sha 必须等于本地 `HEAD` | 5 |
| 等发布 | 用本次改动涉及的站点资源做「内容指纹」（换行归一后 sha256）轮询线上，直到一致 | 4（超时可用 `--verify-only` 复验） |
| 冒烟 | 关键资源全部 200；再跑 `node qa/shot.js --base … --theme dark --desktop-only` | 1 |

常用参数：`--dry-run`（只看计划）、`--verify-only`（不推送，手动 push 后复验）、`--skip-browser`（跳过浏览器门禁）、
`--timeout 600`（发布等待上限）、`--base`（换线上地址）。推送失败时也可手动用系统 Git 后跑 `--verify-only`。

**推送用系统 Git**（重要）：本机 PATH 里的 `@dsh-ops/.../ucrt64` git 在上传阶段会卡死；
用 `C:\Program Files\Git\cmd\git.exe`（Git for Windows）：

```powershell
& 'C:\Program Files\Git\cmd\git.exe' push origin main
# 若网络抖动：追加 -c http.version=HTTP/1.1
```

---

## 3. 首次发布（已完成，留作复现记录）

```bash
# 0) 仓库内初始化（已完成，历史见 `git log`；作者 stollor <youwanyuyu@gmail.com>）
git init -b main
git add -A && git commit -m "站点仓库初始化：..."

# 1) 创建公开仓库（API 或网页）
#    https://github.com/new → 名称 relic-archive → Public → 不要勾 README/license

# 2) 推送（首次可在 URL 内带 token，推完把 remote 改回干净地址）
git remote add origin https://github.com/<user>/relic-archive.git
git -c http.version=HTTP/1.1 push origin main

# 3) 开启 Pages（API 等价于网页操作）
#    POST /repos/<user>/relic-archive/pages
#    {"source":{"branch":"main","path":"/"},"build_type":"legacy"}
#    网页：Settings → Pages → Source: Deploy from a branch → main / (root) → Save

# 4) 等构建：GET /repos/<user>/relic-archive/pages/builds/latest → status=built
```

---

## 4. 线上验收（发布后必做）

**推荐**：`python pipeline/deploy.py` 已包含本节 4.1 + 4.2 的全部检查（失败会给出具体资源/退出码）。
需要手动复验时：

```bash
BASE=https://stollor.github.io/relic-archive

# 4.1 关键资源探活（全部应为 200）
for u in / /data/builds.json /data/items.json /js/theme-boot.js /css/tokens.css /assets/icons/T_UI_Ring_BraidedThorns_Icon.png /lab.html; do
  curl -s -o /dev/null -w "%{http_code}  $u\n" "$BASE$u"
done

# 4.2 真实浏览器门禁（会渲染页面、抓 console/异常/4xx）
node qa/shot.js --base "$BASE" --theme dark  --desktop-only --only items,builds,codex,lab
node qa/shot.js --base "$BASE" --theme light --mobile-only  --only items,builds

# 4.3 人工看一眼截图
#    qa/shots/builds-status_dot-1440-dark.png 等
```

判定标准：`shot` 全 PASS、`0 console error / 0 异常 / 0 个 4xx`、截图排版正常。

> 注意：`qa/interactions.js` 页面内 `import('/js/...')` 是根路径，**不适合**对子路径线上站点跑；
> 线上只跑 `qa/shot.js --base`（它按 `--base` 拼绝对 URL）。

---

## 5. 常见故障排查

| 现象 | 根因 | 处理 |
|---|---|---|
| 页面能开但列表空、图标占位；console 404 `/data/...` | 资产用了绝对路径，子路径部署挂 | 改 `js/core/api.js` 的 `URLS` 与图标路径为 `./data/`、`./assets/`（已改） |
| `pipeline/_source/*` 线上 404 | Jekyll 忽略 `_` 目录 | 仓库根加空 `.nojekyll`（已加） |
| Pages 构建 `errored` | 仓库超限/分支不对/`.nojekyll` 之外的文件问题 | 查 `pages/builds/latest` 的 `error.message`；确认 source 是 `main /` |
| 页面是旧内容 | Pages 缓存/未构建完 | 等 60s；带 `?v=` 或硬刷新；查最新构建 commit 是否等于本地 HEAD |
| `git push` 卡住无进度 | 本机 ucrt64 git 上传异常 | 换系统 Git（§2）；先 `--dry-run` 验证认证 |
| 提交里出现 58 MB 图标以外的巨物 | 误加 `extract/`、`archive/`、`qa/shots/` | 从仓库移出并加入 `.gitignore`；`git rm --cached` |
| token 泄漏 | 曾写进 remote/配置/提交 | 立即撤销 token；清理 remote URL 与历史；改用 SSH/凭据管理器 |

---

## 6. 其他托管方式（都能直接跑）

| 方式 | 要点 |
|---|---|
| 本地 | `python serve.py`（唯一入口；`file://` 不行，ESM/fetch 会被拦） |
| GitHub Pages | 见上；根目录即站点根 |
| Netlify / Vercel / Cloudflare Pages | 直接连仓库，构建命令留空，发布目录填根（`/`） |
| Nginx / 任意静态服务器 | 指向仓库根；无需 rewrite（hash 路由）；`.nojekyll` 无副作用 |
| 自定义域名 | Pages Settings → Custom domain（会生成 CNAME 文件，需一并提交） |

子路径 vs 根路径：站点内部全相对路径，**两种都支持**；只有 `qa/interactions.js` 这类仅本地用的脚本假设根路径。

---

## 7. 回滚

```bash
git revert <bad-commit>          # 或 git reset --hard <good-commit> + 强推（谨慎）
git push origin main             # Pages 自动重建
# 线上复验：qa/shot.js --base https://stollor.github.io/relic-archive
```

---

## 8. 安全与凭据

- **不要把 PAT/token 写进仓库、`.git/config`、remote URL、文档或截图**。
- 需要命令行推送时：优先 SSH key；或用凭据管理器（Git Credential Manager）登录一次。
- 若 token 出现在聊天/日志里：**视为已泄漏**，立即到 GitHub 撤销并轮换；本项目曾用临时 token 完成首次发布，已删除本地临时文件并确认仓库无残留。
- 仓库为公开站点；不要提交任何本机路径以外的隐私内容（游戏目录、账号信息、转储文件）。
