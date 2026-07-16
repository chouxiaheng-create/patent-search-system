# scripts/start-pm2.ps1
# 用 PM2 启动 frontend (生产模式) + worker (生产模式)
# PM2 通过 npx -y pm2 全局拉起（不需要预先 npm i -g）
#
# 兼容性：PowerShell 5.1+（Windows 10/11 自带）

$ErrorActionPreference = 'Stop'
$ProjectRoot = 'D:\Claude Code Files\Project_Patent search system_v1'
Set-Location $ProjectRoot

# 0. 确保 logs 目录存在
New-Item -ItemType Directory -Force -Path "$ProjectRoot\logs" | Out-Null
New-Item -ItemType Directory -Force -Path "$ProjectRoot\worker\logs" | Out-Null

Write-Host "[1/5] 停掉旧的 pm2 进程..." -ForegroundColor Cyan
$prev = $ErrorActionPreference
$ErrorActionPreference = 'Continue'
npx -y pm2 delete all 2>&1 | Out-Null
$ErrorActionPreference = $prev

Write-Host "[2/5] 启动 frontend + worker..." -ForegroundColor Cyan
npx -y pm2 start pm2.config.js
if ($LASTEXITCODE -ne 0) {
    throw "pm2 start 失败 (exit=$LASTEXITCODE)"
}

Write-Host "[3/5] 等待进程就绪..." -ForegroundColor Cyan
$ready = $false
$i = 0
while ($i -lt 30) {
    Start-Sleep -Seconds 1
    $i = $i + 1
    $list = npx -y pm2 jlist 2>$null | Out-String
    if ($list -match 'patent-frontend' -and $list -match 'patent-worker' -and $list -match 'online') {
        $ready = $true
        break
    }
}

if (-not $ready) {
    Write-Host "[!] 进程未在 30s 内 online" -ForegroundColor Red
    Write-Host "看日志: npx pm2 logs --lines 50 --nostream" -ForegroundColor Yellow
    exit 1
}

Write-Host "[4/5] 保存进程列表..." -ForegroundColor Cyan
npx -y pm2 save | Out-Null

Write-Host "[5/5] 当前状态：" -ForegroundColor Cyan
npx -y pm2 list

Write-Host ""
Write-Host "[OK] PM2 已启动" -ForegroundColor Green
Write-Host "常用命令：" -ForegroundColor Gray
Write-Host "  npx pm2 monit           实时监控" -ForegroundColor Gray
Write-Host "  npx pm2 logs            看日志" -ForegroundColor Gray
Write-Host "  npx pm2 reload all      不中断重载" -ForegroundColor Gray
Write-Host "  npx pm2 restart all     重启" -ForegroundColor Gray
Write-Host "  npx pm2 stop all        停止" -ForegroundColor Gray
Write-Host ""
Write-Host "开机自启: npx pm2 startup  (按提示粘一条管理员命令)" -ForegroundColor Yellow