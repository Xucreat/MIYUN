@echo off
REM ============================================================
REM  ZDR Demo - DEV preview server (port 8081)
REM  Dev copy: D:\code files\miyunSystem\miyunDemo-dev
REM  Production (untouched): miyunDemo on port 8080 via scheduled task
REM ============================================================
cd /d "%~dp0deploy\zdr-prototype"
set PORT=8081
echo [DEV] starting preview on http://127.0.0.1:8081
echo [DEV] watch source: %~dp0docs\prototype-v2
node server.js
pause
