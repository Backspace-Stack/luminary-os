@echo off
setlocal EnableExtensions
chcp 65001 >nul 2>&1
title Luminary OS Memories

REM -- Read-only view of Lumen's memory: the curated MEMORIES.md in full,
REM    plus stats for the semantic memory database. Writes nothing.
REM    This launcher lives in the "Other" folder, so the
REM    project root is its parent.
set "PROJECT_DIR=%~dp0..\"
cd /d "%PROJECT_DIR%"

where node >nul 2>&1
if errorlevel 1 (
    echo.
    echo   [ERROR] Node.js is not on your PATH.
    echo   Install from: https://nodejs.org
    echo.
    pause
    exit /b 1
)

node "%PROJECT_DIR%scripts\memories.js"
set "EXITCODE=%errorlevel%"

echo.
pause
endlocal
