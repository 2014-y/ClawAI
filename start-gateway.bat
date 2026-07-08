@echo off
setlocal

set "SCRIPT_DIR=%~dp0"
set "NODE_HOME=%SCRIPT_DIR%.node-sandbox"

if not exist "%NODE_HOME%\node.exe" (
    echo ERROR: node.exe not found at %NODE_HOME%
    pause
    exit /b 1
)

if not exist "%NODE_HOME%\node_modules\openclaw\dist\index.js" (
    echo ERROR: index.js not found at %NODE_HOME%\node_modules\openclaw\dist\index.js
    pause
    exit /b 1
)

if not exist "%USERPROFILE%\.openclaw" (
    mkdir "%USERPROFILE%\.openclaw"
)

for /f "tokens=*" %%a in ('netstat -ano 2^>nul ^| findstr ":18789.*LISTENING"') do (
    for /f "tokens=5" %%p in ("%%a") do (
        taskkill /F /PID %%p >nul 2>&1
    )
)
timeout /t 2 /nobreak >nul

cd /d "%USERPROFILE%\.openclaw"
echo ========================================
echo  OpenClaw Gateway Launcher
echo ========================================
echo.
echo NODE_HOME=%NODE_HOME%
echo.
echo Executing: "%NODE_HOME%\node.exe" "%NODE_HOME%\node_modules\openclaw\dist\index.js" gateway run --force
echo.

:: ??????? start/VBS
"%NODE_HOME%\node.exe" "%NODE_HOME%\node_modules\openclaw\dist\index.js" gateway run --force

echo.
echo Gateway exited.
pause
