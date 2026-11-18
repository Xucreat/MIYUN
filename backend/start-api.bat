@echo off
rem 启动只读 API（B3）：http://127.0.0.1:8001/docs
rem 前置：先跑 start-db.bat，并已执行过 python -m app.seed
cd /d "%~dp0"
python -m uvicorn app.main:app --host 127.0.0.1 --port 8001 --reload
