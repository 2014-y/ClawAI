@echo off
setlocal

:: === SCRIPT DIR ===
set "SCRIPT_DIR=%~dp0"
set "NODE_HOME=%SCRIPT_DIR%.node-sandbox"

:: === CHECK node.exe ===
if not exist "%NODE_HOME%\node.exe" (
    echo.
    echo ========================================
    echo  ERROR: Node not found!
    echo ========================================
    echo.
    echo Please run init.bat first.
    echo.
    pause
    exit /b 1
)

:: === Ensure .openclaw dir exists ===
if not exist "%USERPROFILE%\.openclaw" (
    mkdir "%USERPROFILE%\.openclaw"
)

:: === Copy config template ===
set "CONFIG_FILE=%USERPROFILE%\.openclaw\openclaw.json"
if not exist "%CONFIG_FILE%" (
    if exist "%SCRIPT_DIR%config\openclaw.json.example" (
        copy /Y "%SCRIPT_DIR%config\openclaw.json.example" "%CONFIG_FILE%" >nul
    )
)

:: === Kill existing gateway process ===
for /f "tokens=*" %%a in ('netstat -ano 2^>nul ^| findstr ":18789.*LISTENING"') do (
    for /f "tokens=5" %%p in ("%%a") do (
        taskkill /F /PID %%p >nul 2>&1
    )
)
timeout /t 2 /nobreak >nul

:: === Find openclaw path ===
set "OC_INDEX="

:: Try project local node_modules first
if exist "%SCRIPT_DIR%node_modules\openclaw\dist\index.js" (
    set "OC_INDEX=%SCRIPT_DIR%node_modules\openclaw\dist\index.js"
) else (
    :: Fallback to global NVM or Node.js directory
    set "NVM_DIR=%USERPROFILE%\AppData\Roaming\nvm"
    set "NVM_MODS="
    if exist "%NVM_DIR%" (
        for /d %%d in ("%NVM_DIR%\v*") do set "NVM_MODS=%%d\node_modules"
    )
    if not defined NVM_MODS if exist "C:\Program Files\nodejs\node_modules" set "NVM_MODS=C:\Program Files\nodejs\node_modules"
    
    if defined NVM_MODS (
        for /d %%d in ("%NVM_MODS%\openclaw\dist") do set "OC_INDEX=%%d\index.js"
    )
    if not defined OC_INDEX if exist "C:\Program Files\nodejs\node_modules\openclaw\dist\index.js" set "OC_INDEX=C:\Program Files\nodejs\node_modules\openclaw\dist\index.js"
)

if not defined OC_INDEX (
    echo ERROR: openclaw not found!
    echo Please install openclaw: npm install -g openclaw
    pause
    exit /b 1
)

:: === RUN ===
cd /d "%USERPROFILE%\.openclaw"
echo ========================================
echo  OpenClaw Gateway Launcher
echo ========================================
echo.
echo Node: %NODE_HOME%\node.exe
echo Modules: %NVM_MODS%
echo.
echo Starting...
echo.

"%NODE_HOME%\node.exe" --preserve-symlinks-main "%OC_INDEX%" gateway run --allow-unconfigured --force

echo.
echo Gateway exited.
pause