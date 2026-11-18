"""FastAPI 应用入口（阶段 B3：只读 API）。

启动：
    cd backend
    uvicorn app.main:app --host 127.0.0.1 --port 8001 --reload
文档：http://127.0.0.1:8001/docs
"""
from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import router
from app.config import settings

app = FastAPI(
    title=settings.app_name,
    version="0.3.0",
    description=(
        "密云区重点风险人员台账管理与风险预警系统 · 只读 API（B3）。\n\n"
        "字段命名与前端 `DATA` 契约一致（camelCase），便于 B5 直接换数据源。\n"
        "本阶段未做鉴权与服务端掩码，属 B4 范围。"
    ),
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in settings.cors_origins.split(",") if o.strip()],
    allow_credentials=True,
    allow_methods=["GET"],
    allow_headers=["*"],
)

app.include_router(router)
