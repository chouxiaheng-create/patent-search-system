# scripts/install-autostart.ps1
# Register Windows Task Scheduler entries for PM2 (frontend + worker) + Nginx
# so they start on user logon.
#
# Run as Administrator ONCE.

$ErrorActionPreference = 'Stop'
chcp 65001 | Out-Null

$ProjectRoot = 'D:\Claude Code Files\Project_Patent search system_v1'
$NginxExe    = 'D:\nginx\nginx.exe'

function Register-AtLogonTask {
    param(
        [string]$TaskName,
        [string]$Description,
        [string]$Command,
        [string]$WorkingDir
    )
    $existing = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    if ($existing) {
        Write-Host "[!] removing existing task: $TaskName" -ForegroundColor Yellow
        Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
    }
    $action = New-ScheduledTaskAction `
        -Execute $Command `
        -WorkingDirectory $WorkingDir
    $trigger = New-ScheduledTaskTrigger -AtLogOn
    $settings = New-ScheduledTaskSettingsSet `
        -AllowStartIfOnBatteries `
        -DontStopIfGoingOnBatteries `
        -StartWhenAvailable `
        -ExecutionTimeLimit (New-TimeSpan -Hours 0)
    Register-ScheduledTask `
        -TaskName $TaskName `
        -Description $Description `
        -Action $action `
        -Trigger $trigger `
        -Settings $settings `
        -RunLevel Highest | Out-Null
    Write-Host "[OK] registered: $TaskName" -ForegroundColor Green
}

# 1. PM2 resurrect: resurrects the saved process list
Register-AtLogonTask `
    -TaskName 'PatentSearch-PM2-Resurrect' `
    -Description 'Start PM2 and resurrect saved processes on user logon' `
    -Command 'cmd.exe' `
    -WorkingDir $ProjectRoot
# The trigger command: cmd /c "npx -y pm2 resurrect"

# Actually we need to set the argument string properly:
$task = Get-ScheduledTask -TaskName 'PatentSearch-PM2-Resurrect'
$task.Actions[0].Arguments = '/c "npx -y pm2 resurrect"'
Set-ScheduledTask -InputObject $task | Out-Null
Write-Host "    cmd: npx -y pm2 resurrect" -ForegroundColor Gray

# 2. Nginx standalone start
Register-AtLogonTask `
    -TaskName 'PatentSearch-Nginx' `
    -Description 'Start Nginx reverse proxy on user logon' `
    -Command $NginxExe `
    -WorkingDir 'D:\nginx'
Write-Host "    exe: $NginxExe" -ForegroundColor Gray

Write-Host ""
Write-Host "Tasks registered. They will start on next user logon." -ForegroundColor Cyan
Write-Host "Test now: " -ForegroundColor Yellow
Write-Host "  Start-ScheduledTask -TaskName 'PatentSearch-PM2-Resurrect'" -ForegroundColor Yellow
Write-Host "  Start-ScheduledTask -TaskName 'PatentSearch-Nginx'" -ForegroundColor Yellow