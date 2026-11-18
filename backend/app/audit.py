"""B4：服务端审计。

原则：**审计不依赖前端**。
- 每个写操作在**同一事务**里落业务表 + `audit_log`：业务回滚则审计一起回滚，
  不存在「操作成功但没留痕」。
- `at` / `by` / `role` / `ip` 全部由服务端填，客户端即使传了也覆盖掉，
  因此伪造身份只在请求体里有效、落库无效。
- 前端只允许上报**只读类**动作（登录之外的导出、查看明文申请等），
  走白名单 `CLIENT_ACTS`；不在名单内直接 400，避免把审计表当普通日志写。
"""
from __future__ import annotations

from datetime import datetime

from sqlalchemy.orm import Session

from app.auth import CurrentUser
from app.models import AuditLog

# 前端可上报的动作（都是「只读行为」，真正的写操作由服务端自己记录）
CLIENT_ACTS = frozenset({
    "导出台账", "导出调整历史", "申请查看明文", "查看明文", "大屏模式", "查看审计", "查看档案",
})


def write_audit(db: Session, user: CurrentUser, act: str, target: str | None = None,
                detail: str | None = None, mode: str | None = None,
                ip: str | None = None) -> AuditLog:
    rec = AuditLog(
        at=datetime.now(), act=act, target=target, detail=detail,
        by=user.name, role=user.role_label, ip=ip or user.ip, mode=mode,
    )
    db.add(rec)
    db.flush()
    return rec


def write_anonymous(db: Session, act: str, by: str | None = None, role: str | None = None,
                    target: str | None = None, detail: str | None = None,
                    ip: str | None = None, mode: str | None = None) -> AuditLog:
    """尚未通过鉴权的动作（登录失败）也要留痕，此时没有 CurrentUser。"""
    rec = AuditLog(at=datetime.now(), act=act, target=target, detail=detail,
                   by=by, role=role, ip=ip, mode=mode)
    db.add(rec)
    db.flush()
    return rec
