#!/usr/bin/env pwsh
# =============================================================================
# 遗迹2 · 遗物档案 — 统一验收入口（PowerShell 7）
#
# 只是 node qa/gate.mjs 的薄包装：找到仓库根、转发全部参数、透传退出码。
# 所有检查清单/门禁逻辑都在 qa/gate/，这里不复制任何规则。
#
# 用法（在仓库任意位置都可以）：
#   .\verify.ps1 quick          # 快速自检（无浏览器，<10 秒）
#   .\verify.ps1 related        # 按 git 改动跑相关回归
#   .\verify.ps1 full           # 完整回归（真实 Chrome）
#   .\verify.ps1 data           # 数据链路
#   .\verify.ps1 deploy         # 发布前（含 deploy.py 预检，不推送）
#   .\verify.ps1 list full      # 看 full 会跑哪些检查
#   .\verify.ps1 quick --verbose
#   .\verify.ps1 full --only nav,components
#
# 退出码：0 通过 / 1 有失败 / 2 用法错误 / 3 关键检查环境不具备
# =============================================================================
[CmdletBinding()]
param(
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]] $GateArgs
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Error '未找到 node：请安装 Node 22+ 并加入 PATH（项目零依赖，只需 Node + Python + Chrome）'
    exit 2
}

Push-Location $root
try {
    & node 'qa/gate.mjs' @GateArgs
    exit $LASTEXITCODE
}
finally {
    Pop-Location
}
