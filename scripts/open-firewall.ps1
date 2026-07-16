# scripts/open-firewall.ps1
# Allow inbound 80 (Nginx) + 3001 (Worker health) from 192.168.0.0/16
# Run as Administrator

$ErrorActionPreference = 'Stop'
chcp 65001 | Out-Null

$rules = @(
    @{ Name = 'Patent Search - HTTP 80';  Port = 80   },
    @{ Name = 'Patent Search - Worker 3001'; Port = 3001 }
)

foreach ($r in $rules) {
    $existing = Get-NetFirewallRule -DisplayName $r.Name -ErrorAction SilentlyContinue
    if ($existing) {
        Write-Host "[!] removing existing rule: $($r.Name)" -ForegroundColor Yellow
        Remove-NetFirewallRule -DisplayName $r.Name
    }
    New-NetFirewallRule `
        -DisplayName $r.Name `
        -Direction Inbound `
        -Protocol TCP `
        -LocalPort $r.Port `
        -Action Allow `
        -Profile Private `
        -RemoteAddress 192.168.0.0/16 | Out-Null
    Write-Host "[OK] rule added: $($r.Name) port=$($r.Port) (192.168.0.0/16)" -ForegroundColor Green
}

Write-Host ""
Write-Host "Colleagues can now access:" -ForegroundColor Cyan
Write-Host "  http://<your-IP>/              (Nginx -> Next.js)" -ForegroundColor Cyan
Write-Host "  http://<your-IP>:3001/health   (Worker health)" -ForegroundColor Cyan
Write-Host ""
Write-Host "Your IPv4:" -ForegroundColor Yellow
ipconfig | Select-String 'IPv4'