@echo off
setlocal EnableExtensions
chcp 65001 >nul 2>&1
title Luminary OS

REM -- The full purple LUMINARY banner is printed once, by Node
REM    (scripts/lib/banner.js), right after the Node.js check
REM    below. Printing it here too — in plain, uncolored batch
REM    echo — would just show a colorless duplicate first.

REM -- Resolve this script's own directory so it works regardless of the
REM    current working directory (e.g. launched via a shortcut with a
REM    different "Start in" folder). This launcher sits at the project
REM    root, so its own folder IS the project root.
set "PROJECT_DIR=%~dp0"
cd /d "%PROJECT_DIR%"

REM -- Minimal check here: only confirm Node.js itself exists.
REM    Everything else (npm, npx, dependencies, ports, env files)
REM    gets a much richer, more accurate check inside
REM    scripts\start.js - duplicating that logic in batch would
REM    only make it less reliable, not more.
where node >nul 2>&1
if errorlevel 1 (
    echo.
    echo   [ERROR] Node.js was not found on your system PATH.
    echo.
    echo   Install Node.js version 18 or higher from:
    echo       https://nodejs.org
    echo.
    echo   IMPORTANT: If you just installed Node.js, close THIS
    echo   window completely and double-click run.bat again.
    echo   Windows only updates PATH for new windows opened after
    echo   installation finishes.
    echo.
    pause
    exit /b 1
)

node "%PROJECT_DIR%scripts\start.js"
set "EXITCODE=%errorlevel%"

echo.
if not "%EXITCODE%"=="0" (
    echo   ==========================================
    echo     Luminary OS exited with an error.
    echo     Scroll up to see detailed diagnostics.
    echo     Exit code: %EXITCODE%
    echo   ==========================================
    echo.
    echo   Quick checks:
    echo     - Run Other\setup.bat  if this is your first time
    echo     - Run Other\doctor.bat for a full diagnosis
    echo.
) else (
    echo   Luminary OS has stopped.
    echo.
)

pause
endlocal
