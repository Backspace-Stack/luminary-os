@echo off
setlocal EnableExtensions
chcp 65001 >nul 2>&1
title Luminary OS Doctor

REM -- This launcher lives in the "Other" folder, so the
REM    project root is its parent. Everything below is unchanged.
set "PROJECT_DIR=%~dp0..\"
cd /d "%PROJECT_DIR%"

REM -- The full purple LUMINARY banner is printed once, by Node
REM    (scripts/lib/banner.js), right after the Node.js check
REM    below — not here in plain, uncolored batch echo.

where node >nul 2>&1
if errorlevel 1 (
    echo.
    echo   [ERROR] Node.js is not on your PATH.
    echo   Install from: https://nodejs.org
    echo.
    pause
    exit /b 1
)

node "%PROJECT_DIR%scripts\doctor.js"
set "EXITCODE=%errorlevel%"

echo.
pause
endlocal
