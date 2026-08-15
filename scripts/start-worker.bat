@echo off
chcp 65001 >nul
REM Patent Search - Worker autostart (idempotent: skips if port 3001 busy)
cd /d "D:\Claude Code Files\Project_Patent search system_v1\worker"
if not exist "..\logs" mkdir "..\logs"
netstat -ano | findstr /R ":3001 " | findstr "LISTENING" >nul
if not errorlevel 1 (
  echo [%date% %time%] Port 3001 busy - worker already running, skip >> "..\logs\worker.log"
  exit /b 0
)
echo [%date% %time%] Starting worker on port 3001 >> "..\logs\worker.log"
call npm run dev >> "..\logs\worker.log" 2>&1
