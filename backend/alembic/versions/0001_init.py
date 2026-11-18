"""初始结构：33 张表 + 3 个视图

Revision ID: 0001_init
Revises:
Create Date: 2026-11-18

说明：本迁移以 `app.models` 的元数据为唯一定义源（single source of truth），
用 create_all 建表，避免 SQLAlchemy 模型与迁移脚本两处漂移。
后续字段变更仍走常规 `alembic revision --autogenerate`。

三条硬约束（改这里之前先读 docs/prototype-v2/DECISION-统计口径裁决-20261118.md）：
1. level_change 没有审批状态机，只有「已生效 + 是否知会」；
2. dual_confirm 与 person_tag 不做任何联动；
3. person.primary_dept_id（单值）与 person_tag.dept_id（多值）并存，聚合分开写。
"""
from __future__ import annotations

from alembic import op
from sqlalchemy import text

from app.models import Base
from app.views import VIEWS_SQL

revision = "0001_init"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    Base.metadata.create_all(bind=op.get_bind())
    conn = op.get_bind()
    for sql in VIEWS_SQL:
        conn.execute(text(sql))


def downgrade() -> None:
    conn = op.get_bind()
    for name in ("v_dual_cross", "v_dept_stats", "v_person_full"):
        conn.execute(text(f"DROP VIEW IF EXISTS {name}"))
    Base.metadata.drop_all(bind=conn)
