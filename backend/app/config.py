"""应用配置：全部从环境变量读，默认值只服务本地演示。"""
from __future__ import annotations

import os

try:  # pydantic-settings 已装则用，缺了也能跑（容器里可能没装）
    from pydantic_settings import BaseSettings, SettingsConfigDict

    class Settings(BaseSettings):
        model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

        app_name: str = "密云区重点风险人员台账管理与风险预警系统 API"
        database_url: str = "postgresql+psycopg://miyun@127.0.0.1:55433/miyun"
        demo_district: str = "北京市密云区"
        cors_origins: str = "http://127.0.0.1:8081,http://localhost:8081"
        # B4：演示用令牌密钥与统一演示口令。上线前必须改（换密钥即全部令牌失效）
        secret_key: str = "miyun-demo-secret-change-me"
        token_ttl_min: int = 480
        demo_password: str = "miyun@2026"

    settings = Settings()
except Exception:  # pragma: no cover
    class _S:
        app_name = "密云区重点风险人员台账管理与风险预警系统 API"
        database_url = os.getenv("DATABASE_URL", "postgresql+psycopg://miyun@127.0.0.1:55433/miyun")
        demo_district = os.getenv("DEMO_DISTRICT", "北京市密云区")
        cors_origins = os.getenv("CORS_ORIGINS", "http://127.0.0.1:8081")
        secret_key = os.getenv("SECRET_KEY", "miyun-demo-secret-change-me")
        token_ttl_min = int(os.getenv("TOKEN_TTL_MIN", "480"))
        demo_password = os.getenv("DEMO_PASSWORD", "miyun@2026")

    settings = _S()
