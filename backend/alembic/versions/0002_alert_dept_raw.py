"""alert 增加责任单位原文 dept_raw

Revision ID: 0002_alert_dept_raw
Revises: 0001_init
Create Date: 2026-11-18

为什么加这一列：`alert.dept_id` 是外键，只存能对上 `dept` 表的 code；
而 18 条预警里有 13 条的责任单位是「鼓楼街道综治中心」这类镇街机构，
`dept` 表里没有对应 code（它是区级部门表），于是 `dept_id` 为 NULL。
之前前端只能从本地演示数据补这个字段 —— 服务端的预警配本地的责任单位，两套口径。

回填策略（有损的那一半要说清楚）：
- `dept_id` 非空的 5 条：原文就是部门名，`dept_raw = dept_id`，可直接回填；
- `dept_id` 为空的 13 条：原文在导入源里、库里从未存过，迁移**无法**推出，
  由 `python -m app.seed` 重灌补上（种子已带 `dept_raw`）。
  这意味着「只跑迁移不重灌」的库会有 13 行 NULL —— 前端映射按 NULL 回落本地，不会炸。
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision = "0002_alert_dept_raw"
down_revision = "0001_init"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("alert", sa.Column("dept_raw", sa.String(64), nullable=True))
    op.execute("UPDATE alert SET dept_raw = dept_id WHERE dept_raw IS NULL AND dept_id IS NOT NULL")


def downgrade() -> None:
    op.drop_column("alert", "dept_raw")
