@echo off
setlocal EnableExtensions
chcp 65001 >nul 2>&1
title Luminary OS Setup

REM -- The full purple LUMINARY banner is printed once, by Node
REM    (scripts/lib/banner.js), right after the Node.js check
REM    below — not here in plain, uncolored batch echo.

REM -- This launcher lives in the "Other" folder, so the project root is
REM    its parent. Everything below is unchanged.
set "PROJECT_DIR=%~dp0..\"
cd /d "%PROJECT_DIR%"

where node >nul 2>&1
if errorlevel 1 (
    echo.
    echo   [ERROR] Node.js is not installed.
    echo.
    echo   Please install Node.js v24 or higher from:
    echo       https://nodejs.org/en/download
    echo.
    echo   After installing, run this script again.
    echo.
    pause
    exit /b 1
)

for /f "tokens=*" %%v in ('node --version') do set "NODE_VER=%%v"
echo   Found: Node.js %NODE_VER%
echo.
echo   Running setup (this installs all dependencies)...
echo.

node "%PROJECT_DIR%scripts\setup.js"
set "EXITCODE=%errorlevel%"

echo.
if not "%EXITCODE%"=="0" (
    echo   ==========================================
    echo     Setup failed. Scroll up for details.
    echo     Exit code: %EXITCODE%
    echo   ==========================================
    echo.
    echo   For a full diagnosis, run:
    echo       Other\doctor.bat
    echo.
) else (
    echo   ==========================================
    echo     Setup complete!
    echo   ==========================================
    echo.
    echo   To start Luminary OS:
    echo.
    echo     Double-click run.bat  (in the main folder)
    echo     - or -
    echo     Run: npm start
    echo.
)

pause
endlocal
