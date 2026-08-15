@echo off
chcp 65001 >nul
REM Patent Search - Frontend autostart (idempotent: skips if port 3000 busy)
cd /d "D:\Claude Code Files\Project_Patent search system_v1"
if not exist "logs" mkdir "logs"
netstat -ano | findstr /R ":3000 " | findstr "LISTENING" >nul
if not errorlevel 1 (
  echo [%date% %time%] Port 3000 busy - frontend already running, skip >> "logs\frontend.log"
  exit /b 0
)
echo [%date% %time%] Starting frontend on port 3000 >> "logs\frontend.log"
call npm run dev >> "logs\frontend.log" 2>&1
