# scripts/nginx-start.ps1
# Start Nginx (standalone, not as a Windows service)
# Expects Nginx at D:\nginx\nginx.exe

$ErrorActionPreference = 'Stop'
$NginxDir = 'D:\nginx'
$ConfFile = 'D:\nginx\conf\conf.d\patent.conf'

# Switch to UTF-8 to handle Chinese characters in conf
chcp 65001 | Out-Null

if (-not (Test-Path "$NginxDir\nginx.exe")) {
    Write-Host "[!] $NginxDir\nginx.exe not found" -ForegroundColor Red
    Write-Host "    Please download Nginx for Windows and extract to D:\nginx\" -ForegroundColor Yellow
    Write-Host "    https://nginx.org/en/download.html" -ForegroundColor Yellow
    exit 1
}

# 1. Ensure logs/conf.d dirs exist + junction D:\patent -> project root
#    (nginx on Windows can't parse log paths with spaces; junction is the workaround)
New-Item -ItemType Directory -Force -Path "D:\Claude Code Files\Project_Patent search system_v1\logs" | Out-Null
New-Item -ItemType Directory -Force -Path "$NginxDir\conf\conf.d" | Out-Null
if (-not (Test-Path 'D:\patent')) {
    Write-Host "[!] Creating junction D:\patent -> project root..." -ForegroundColor Yellow
    New-Item -ItemType Junction -Path 'D:\patent' -Target 'D:\Claude Code Files\Project_Patent search system_v1' | Out-Null
}

# 2. Read template, replace placeholders with nginx variables, then write
$confTemplate = Get-Content "D:\Claude Code Files\Project_Patent search system_v1\scripts\nginx.conf" -Raw
$confTemplate = $confTemplate.Replace('__HOST__', '$host')
$confTemplate = $confTemplate.Replace('__REMOTE_ADDR__', '$remote_addr')
$confTemplate = $confTemplate.Replace('__PROXY_ADD_X_FORWARDED_FOR__', '$proxy_add_x_forwarded_for')
$confTemplate = $confTemplate.Replace('__SCHEME__', '$scheme')
$confTemplate = $confTemplate.Replace('__HTTP_UPGRADE__', '$http_upgrade')
Set-Content -Path $ConfFile -Value $confTemplate -Encoding ASCII

# 3. Patch main nginx.conf to include conf.d/*.conf (idempotent)
$MainConf = "$NginxDir\conf\nginx.conf"
$mainContent = Get-Content $MainConf -Raw
if ($mainContent -notmatch 'conf\.d/\*\.conf') {
    Write-Host "[!] main nginx.conf missing include conf.d/*.conf, patching..." -ForegroundColor Yellow
    $mainContent = $mainContent -replace '(\s*#?\s*include\s+mime\.types;\s*\n)', "`$1    include conf.d/*.conf;`n"
    if ($mainContent -notmatch 'include conf\.d/\*\.conf') {
        # fallback: append before final brace
        $mainContent = $mainContent -replace '(\s*\})\s*$', "    include conf.d/*.conf;`n}`n"
    }
    Set-Content -Path $MainConf -Value $mainContent -Encoding ASCII
}

# 4. Test config (must run from Nginx dir so it finds conf/nginx.conf)
Write-Host "[1/3] Testing config..." -ForegroundColor Cyan
Push-Location $NginxDir
& "$NginxDir\nginx.exe" -t 2>&1 | Tee-Object -Variable testOut | Out-Null
$testExit = $LASTEXITCODE
Pop-Location
if ($testExit -ne 0) {
    Write-Host $testOut -ForegroundColor Red
    throw "nginx -t failed"
}

# 5. Start (also from Nginx dir)
Write-Host "[2/3] Starting..." -ForegroundColor Cyan
Push-Location $NginxDir
& "$NginxDir\nginx.exe" -s stop 2>$null | Out-Null
Start-Sleep -Seconds 1
& "$NginxDir\nginx.exe"
Pop-Location
Start-Sleep -Seconds 2

Write-Host "[3/3] Verifying port 80..." -ForegroundColor Cyan
$ok = Test-NetConnection -ComputerName 127.0.0.1 -Port 80 -WarningAction SilentlyContinue -InformationLevel Quiet
if ($ok) {
    Write-Host "[OK] Nginx listening on port 80" -ForegroundColor Green
    Write-Host ""
    Write-Host "Colleagues can now access http://192.168.184.29/ (no port needed)" -ForegroundColor Cyan
} else {
    Write-Host "[!] Port 80 not listening. Check log: D:\nginx\logs\error.log" -ForegroundColor Red
    exit 1
}