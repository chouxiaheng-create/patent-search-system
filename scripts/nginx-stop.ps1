# scripts/nginx-stop.ps1
# 停 Nginx

$ErrorActionPreference = 'Stop'
$NginxDir = 'D:\nginx'
if (Test-Path "$NginxDir\nginx.exe") {
    & "$NginxDir\nginx.exe" -s stop
    Write-Host "[OK] Nginx 已停" -ForegroundColor Green
} else {
    Write-Host "[!] 找不到 nginx.exe" -ForegroundColor Red
}