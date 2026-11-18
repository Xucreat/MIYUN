@echo off
rem 启动 API（B4）：http://127.0.0.1:8001/docs
rem 除 /api/health、/api/auth/login 外都需要 Bearer 令牌（先 POST /api/auth/login 取）
rem 前置：先跑 start-db.bat，并已执行过 python -m app.seed
cd /d "%~dp0"
python -m uvicorn app.main:app --host 127.0.0.1 --port 8001 --reload
