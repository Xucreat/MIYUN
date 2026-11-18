"""role_perm 增加三态 mode（on / half）

Revision ID: 0003_role_perm_mode
Revises: 0002_alert_dept_raw
Create Date: 2026-11-18

为什么加这一列：`role_perm` 一直只存「允许」，没有行就是禁止 —— 这个稀疏表示本身没错，
但前端的权限矩阵是**三态**：允许 / 受限（可看不可做、需申请审批）/ 禁止。
那 16 个「受限」在库里没有任何位置，于是页面按 `data.js` 的静态表渲染、
服务端按「有没有行」判定，两套口径：页面显示「受限需审批」，后端只认「允许 / 403」。

加 `mode` 后语义变成：
- 有行且 mode='on'   → 允许；
- 有行且 mode='half' → 受限（auth.py 的 `need()` 仍按「有行即放行」处理，
  受限的**执行**门槛由各端点自己判，例如 export:plain 走申请单）；
- 没有行             → 禁止。
保持稀疏：不为 9×48 的禁止位造 300+ 行空记录。

回填是有损的，和 0002 同一类问题：
- 迁移只能把现有 106 行默认成 'on'（`server_default='on'`，无需 UPDATE）；
- 另外 16 条 'half' 从未入库，迁移**推不出来**，必须 `python -m app.seed` 重灌补上
  （重灌后 role_perm = 122 行：106 on + 16 half）。
  自查：SELECT mode, count(*) FROM role_perm GROUP BY mode;  -- 应为 on=106, half=16
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision = "0003_role_perm_mode"
down_revision = "0002_alert_dept_raw"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("role_perm", sa.Column("mode", sa.String(4), nullable=False, server_default="on"))
    op.execute("UPDATE role_perm SET mode = 'on' WHERE mode IS NULL")


def downgrade() -> None:
    op.drop_column("role_perm", "mode")
