#Requires -RunAsAdministrator
# 右键此文件 → "使用 PowerShell 运行" 即可（需要管理员权限）

$ErrorActionPreference = 'Stop'

$ruleName = 'Next.js Dev 3000'
$port     = 3000

# 如果同名规则已存在，先删掉，避免重复
$existing = Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue
if ($existing) {
    Write-Host "[!] 已存在同名规则，正在删除..." -ForegroundColor Yellow
    Remove-NetFirewallRule -DisplayName $ruleName
}

# 创建新规则：放宽到 192.168.0.0/16，覆盖大多数单位内网段
# 如果你的单位使用 10.x 或 172.16-31.x 内网，请把 -RemoteAddress 改成对应网段
New-NetFirewallRule `
    -DisplayName $ruleName `
    -Direction Inbound `
    -Protocol TCP `
    -LocalPort $port `
    -Action Allow `
    -Profile Private `
    -RemoteAddress 192.168.0.0/16

Write-Host ""
Write-Host "[OK] 防火墙规则已更新：$ruleName" -ForegroundColor Green
Write-Host "    端口: $port / TCP (入站)" -ForegroundColor Gray
Write-Host "    范围: 192.168.0.0/16（覆盖整个 192.168.x.x 内网段）" -ForegroundColor Gray
Write-Host ""
Write-Host "现在同事可以通过 http://<你的IP>:$port 访问你的 Next.js。" -ForegroundColor Cyan
Write-Host "查询本机内网 IP: ipconfig" -ForegroundColor Cyan

Read-Host "按回车键退出"