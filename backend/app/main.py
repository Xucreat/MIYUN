"""FastAPI 应用入口（B3 只读 API + B4 鉴权 / 掩码 / 审计 / 写 API）。

启动：
    cd backend
    uvicorn app.main:app --host 127.0.0.1 --port 8001 --reload
文档：http://127.0.0.1:8001/docs
登录：POST /api/auth/login  {"account": "chenzhiyuan"}
"""
from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import router
from app.api_write import router as write_router
from app.config import settings

app = FastAPI(
    title=settings.app_name,
    version="0.4.0",
    description=(
        "密云区重点风险人员台账管理与风险预警系统 · API（B4）。\n\n"
        "字段命名与前端 `DATA` 契约一致（camelCase），便于 B5 直接换数据源。\n"
        "B4 起：除 `/api/health`、`/api/auth/login` 外**全部需要 Bearer 令牌**；\n"
        "个人敏感字段由服务端按 `field_policy` 掩码；写操作由服务端自行审计。"
    ),
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in settings.cors_origins.split(",") if o.strip()],
    allow_credentials=True,
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)

app.include_router(router)
app.include_router(write_router)
