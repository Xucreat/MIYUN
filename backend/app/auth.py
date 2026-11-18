"""B4：登录令牌、权限门控与数据范围判定。

四条设计决定（都在 §10 文档里写明理由，改之前先读）：

1. **无状态令牌**：HMAC-SHA256 签名，载荷只有「账号 id + 过期时间」。
   不建会话表 → B4 不需要任何迁移；换密钥即全量失效。
2. **权限唯一来源是 `role_perm` 表**，代码里不写死任何角色权限。
   `role_perm` 只存「允许」：前端的 half（受限需申请）权限**没有入库**，
   因此一律按**拒绝**处理 —— fail-closed，不会误放行明文导出这类敏感操作。
3. **数据范围**由 `sys_account.unit` 解析成 dept / town。
   解析不出来就 **fail-closed**（403 `scope_unresolved`），绝不「解析失败就放行」。
4. **字段密级**直接读 `field_policy.mask`（已经是 9 字段 × 9 角色的矩阵），
   代码里不重复维护一份，避免前后端两份口径漂移。
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import time
from dataclasses import dataclass
from datetime import datetime

from fastapi import Depends, HTTPException, Request
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.config import settings
from app.db import get_db

# ---------------------------------------------------------------- 令牌
_TOKEN_SEP = "."


def _secret() -> bytes:
    return settings.secret_key.encode("utf-8")


def _b64e(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")


def _b64d(raw: str) -> bytes:
    return base64.urlsafe_b64decode(raw + "=" * (-len(raw) % 4))


def encode_token(account_id: str, ttl_min: int | None = None) -> tuple[str, str]:
    """返回 (token, 过期时间 ISO)。"""
    exp = int(time.time()) + (ttl_min or settings.token_ttl_min) * 60
    body = _b64e(json.dumps({"a": account_id, "exp": exp}, separators=(",", ":")).encode("utf-8"))
    sig = _b64e(hmac.new(_secret(), body.encode("ascii"), hashlib.sha256).digest())
    return f"{body}{_TOKEN_SEP}{sig}", datetime.fromtimestamp(exp).isoformat(timespec="seconds")


def decode_token(token: str) -> str:
    """校验签名与有效期，返回账号 id。任何异常都抛 ValueError。"""
    body, _, sig = (token or "").partition(_TOKEN_SEP)
    if not body or not sig:
        raise ValueError("令牌格式错误")
    expect = _b64e(hmac.new(_secret(), body.encode("ascii"), hashlib.sha256).digest())
    if not hmac.compare_digest(sig, expect):
        raise ValueError("令牌签名不匹配")
    try:
        payload = json.loads(_b64d(body))
    except Exception as exc:  # noqa: BLE001
        raise ValueError("令牌载荷损坏") from exc
    if int(payload.get("exp", 0)) < int(time.time()):
        raise ValueError("令牌已过期")
    acc = payload.get("a")
    if not acc:
        raise ValueError("令牌缺少账号")
    return str(acc)


# ---------------------------------------------------------------- 身份与范围
@dataclass(frozen=True)
class Scope:
    """数据范围。kind 只有四种，unresolved 表示单位解析不出来（= 拒绝）。"""

    kind: str                      # all | dept | town | none | unresolved
    value: str | None = None
    unit: str | None = None

    def allows(self, dept: str | None, town: str | None) -> bool:
        if self.kind == "all":
            return True
        if self.kind == "dept":
            return dept is not None and dept == self.value
        if self.kind == "town":
            return town is not None and town == self.value
        return False

    def as_dict(self) -> dict:
        return {"kind": self.kind, "value": self.value, "unit": self.unit}


@dataclass
class CurrentUser:
    id: str
    name: str
    account: str
    role_key: str | None
    role_name: str
    unit: str | None
    perms: frozenset[str]
    fields: dict[str, str]          # 字段 → 明 / 掩 / 申 / 隐 / 本部门 / 辖区明
    scope: Scope
    ip: str | None = None
    login: str | None = None

    @property
    def dept(self) -> str | None:
        return self.scope.value if self.scope.kind == "dept" else None

    @property
    def town(self) -> str | None:
        return self.scope.value if self.scope.kind == "town" else None

    @property
    def role_label(self) -> str:
        return f"{self.role_key} {self.role_name}".strip()

    def can(self, *codes: str) -> bool:
        return all(c in self.perms for c in codes)

    def can_any(self, *codes: str) -> bool:
        return any(c in self.perms for c in codes)

    def field_mode(self, key: str) -> str:
        # 表里没有的字段一律按「隐」处理（新增字段不会因为漏配而意外明文）
        return self.fields.get(key, "隐")

    def as_dict(self) -> dict:
        return {
            "id": self.id, "name": self.name, "account": self.account,
            "roleKey": self.role_key, "roleName": self.role_name, "roleLabel": self.role_label,
            "unit": self.unit, "login": self.login,
            "perms": sorted(self.perms), "permCount": len(self.perms),
            "fields": self.fields, "scope": self.scope.as_dict(),
        }


# 单位 → 部门的别名（账号表写「区公安分局」，部门字典的 code 是「公安分局」）
DEPT_UNIT_ALIAS = {"区公安分局": "公安分局"}
TRIO_ROLES = {"R7", "R8", "R9"}     # 三员分立：不触业务数据
ALL_SCOPE_ROLES = {"R1", "R2"}


def _resolve_scope(db: Session, role_key: str | None, unit: str | None) -> Scope:
    unit = (unit or "").strip() or None
    if role_key in ALL_SCOPE_ROLES:
        return Scope("all", None, unit)
    if role_key in TRIO_ROLES:
        return Scope("none", None, unit)
    if not unit:
        return Scope("unresolved", None, unit)
    cand = {unit}
    if unit in DEPT_UNIT_ALIAS:
        cand.add(DEPT_UNIT_ALIAS[unit])
    if unit.startswith("区"):
        cand.add(unit[1:])
    cand = sorted(cand)
    if role_key in ("R3", "R4"):
        row = db.execute(text("SELECT code FROM dept WHERE code = ANY(:c) OR name = ANY(:c)"),
                         {"c": cand}).first()
        return Scope("dept", row[0], unit) if row else Scope("unresolved", None, unit)
    if role_key in ("R5", "R6"):
        row = db.execute(text("SELECT code FROM town WHERE name = ANY(:c) OR short = ANY(:c)"),
                         {"c": cand}).first()
        return Scope("town", row[0], unit) if row else Scope("unresolved", None, unit)
    return Scope("unresolved", None, unit)


def _unauth(reason: str) -> HTTPException:
    return HTTPException(401, {"code": "unauthorized", "reason": reason},
                         headers={"WWW-Authenticate": "Bearer"})


def load_user(db: Session, account_id: str, ip: str | None = None) -> CurrentUser:
    row = db.execute(text("""
        SELECT a.id, a.name, a.account, a.role_key, a.unit, a.login, a.status,
               r.name AS role_name, r.scope AS role_scope
        FROM sys_account a LEFT JOIN sys_role r ON r.key = a.role_key
        WHERE a.id = :id OR a.account = :id
    """), {"id": account_id}).first()
    if not row:
        raise _unauth("账号不存在")
    if (row.status or "") and "停用" in row.status:
        raise _unauth("账号已停用")

    perms = frozenset(r[0] for r in db.execute(
        text("SELECT perm_code FROM role_perm WHERE role_key = :r"),
        {"r": row.role_key}).all())
    fields = {r[0]: (r[1] or {}).get(row.role_key, "隐") for r in db.execute(
        text("SELECT field_key, mask FROM field_policy")).all()}
    return CurrentUser(
        id=row.id, name=row.name, account=row.account, role_key=row.role_key,
        role_name=row.role_name or "—", unit=row.unit,
        perms=perms, fields=fields,
        scope=_resolve_scope(db, row.role_key, row.unit),
        ip=ip, login=row.login,
    )


def _client_ip(request: Request) -> str | None:
    return request.client.host if request.client else None


def get_user(request: Request, db: Session = Depends(get_db)) -> CurrentUser:
    scheme, _, token = (request.headers.get("authorization") or "").partition(" ")
    if scheme.lower() != "bearer" or not token.strip():
        raise _unauth("缺少 Bearer 令牌")
    try:
        account = decode_token(token.strip())
    except ValueError as exc:
        raise _unauth(str(exc)) from exc
    return load_user(db, account, _client_ip(request))


def optional_user(request: Request, db: Session = Depends(get_db)) -> CurrentUser | None:
    try:
        return get_user(request, db)
    except HTTPException:
        return None


# ---------------------------------------------------------------- 门控
def _forbidden(need: list[str], u: CurrentUser, reason: str = "缺少权限") -> HTTPException:
    return HTTPException(403, {
        "code": "forbidden", "reason": reason,
        "need": need, "have": sorted(u.perms), "role": u.role_key,
    })


def require(u: CurrentUser, *codes: str) -> None:
    """处理器内部按业务方向动态判权时用（如按上调/下调区分权限位）。"""
    if not u.can(*codes):
        raise _forbidden(list(codes), u)


def need(*codes: str, any_of: bool = False):
    """路由依赖：`Depends(need('person:list'))`。"""
    def dep(u: CurrentUser = Depends(get_user)) -> CurrentUser:
        ok = u.can_any(*codes) if any_of else u.can(*codes)
        if not ok:
            raise _forbidden(list(codes), u)
        return u
    return dep


def ensure_data_scope(u: CurrentUser) -> None:
    """业务数据端点入口统一调用：范围解析不出来就拒绝，不做放行兜底。"""
    if u.scope.kind == "unresolved":
        raise HTTPException(403, {
            "code": "scope_unresolved", "reason": "账号单位无法解析为部门或镇街，已拒绝",
            "unit": u.scope.unit, "role": u.role_key,
        })
    if u.scope.kind == "none":
        raise HTTPException(403, {
            "code": "no_data_scope", "reason": "该角色不触业务数据（三员分立）",
            "role": u.role_key,
        })


def person_scope_sql(u: CurrentUser, alias: str = "p") -> tuple[str, dict]:
    """人员表的行级过滤条件。调用前必须先 `ensure_data_scope`。"""
    if u.scope.kind == "all":
        return "1=1", {}
    if u.scope.kind == "dept":
        return f"{alias}.primary_dept_id = :_scope_dept", {"_scope_dept": u.scope.value}
    if u.scope.kind == "town":
        return f"{alias}.town_code = :_scope_town", {"_scope_town": u.scope.value}
    raise HTTPException(403, {"code": "no_data_scope", "role": u.role_key})
