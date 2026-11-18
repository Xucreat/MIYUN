"""B4 写 API：等级变动登记 / 走访登记 / 预警处置。

三个写操作都遵守同一套规则：
1. **先判权限，再判范围，最后校验业务**；顺序不能反（否则 403 与 400 会互相掩盖）。
2. **身份、时间、定级责任、登记人全部由服务端生成**。请求体里的 `rule` / `approver` / `by`
   一律忽略 —— 否则「谁定级的」可由调用方随手填，台账就失去可信度。
3. 业务表与 `audit_log` 在**同一事务**提交，失败一起回滚。

会议决议 D4 的硬约束在这里落地：等级变动**没有审批状态机**。
只有 `status='已生效'`（DB 层还有 CheckConstraint 兜底）与 `notified` 两个状态位；
末节点是「报政法委备案」，不是审批关口，所以不存在 `approval_status` 这类字段。
"""
from __future__ import annotations

from datetime import date, datetime

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.audit import write_audit
from app.auth import CurrentUser, ensure_data_scope, get_user, require
from app.db import get_db
from app.models import LevelChange, Visit

router = APIRouter(prefix="/api")

# 部门内部定级责任（与 data.js LEVEL_RULE_OF 一一对应，四档 + 默认）
# 措辞是「部门侧责任」，不含任何政法委审批环节（D4）。
RULE_OF: dict[str, tuple[str, str]] = {
    "low>mid": ("部门主管核定", "部门主管"),
    "mid>low": ("部门主管核定", "部门主管"),
    "mid>high": ("部门主管 + 分管领导会商", "部门主管 + 分管领导"),
    "high>mid": ("分管领导核定", "分管领导"),
    "high>high2": ("部门集体会商 + 双签", "集体会商 · 双签"),
    "high2>high": ("部门集体会商 + 双签", "集体会商 · 双签"),
    "high2>mid": ("部门集体会商 + 双签", "集体会商 · 双签"),
}
RULE_DEFAULT = ("分管领导核定", "分管领导")

LEVEL_NAME = {"high2": "极高风险", "high": "高风险", "mid": "中风险", "low": "低风险", "unknown": "待核实"}


def _ip(request: Request) -> str | None:
    return request.client.host if request.client else None


def _rule_of(from_level: str, to_level: str) -> tuple[str, str]:
    return RULE_OF.get(f"{from_level}>{to_level}", RULE_DEFAULT)


def _approver(by: str, head: str | None) -> str:
    """登记人 = 部门侧责任人姓名 + 定级责任后缀（D4 后不再拼政法委审批人）。"""
    h = head or "部门主管"
    if by == "部门主管":
        return h
    if by.startswith("部门主管"):
        return f"{h} + 分管领导"
    if by == "分管领导":
        return f"{h} 报分管领导核定"
    return f"{h} · 集体会商双签"


def _out_of_scope(what: str, dept: str | None, town: str | None, user: CurrentUser) -> HTTPException:
    return HTTPException(403, {"code": "out_of_scope", "reason": f"{what}不在你的数据范围内",
                               "target": {"dept": dept, "town": town},
                               "scope": user.scope.as_dict()})


# ------------------------------------------------------------------ 等级变动登记
class LevelChangeIn(BaseModel):
    personId: str
    to: str = Field(..., description="目标等级 key：high2 / high / mid / low / unknown")
    reason: str = Field(..., min_length=2, description="定级理由（会进台账与档案）")
    notified: bool = Field(True, description="是否已知会属地")


@router.post("/level-changes", summary="登记等级变动（部门定级台账，无审批）")
def create_level_change(body: LevelChangeIn, request: Request, db: Session = Depends(get_db),
                        user: CurrentUser = Depends(get_user)) -> dict:
    ensure_data_scope(user)
    p = db.execute(text("SELECT id, no, name, level, primary_dept_id, town_code FROM person "
                        "WHERE id = :id FOR UPDATE"), {"id": body.personId}).first()
    if not p:
        raise HTTPException(404, f"人员不存在：{body.personId}")
    row = dict(p._mapping)
    if not user.scope.allows(row["primary_dept_id"], row["town_code"]):
        raise _out_of_scope("该人员", row["primary_dept_id"], row["town_code"], user)

    levels = {r[0]: r[1] for r in db.execute(text('SELECT key, "order" FROM level_dict')).all()}
    if body.to not in levels:
        raise HTTPException(400, {"code": "bad_level", "reason": "等级不存在", "allowed": sorted(levels)})
    frm, to = row["level"], body.to
    if frm == to:
        raise HTTPException(400, {"code": "level_unchanged", "reason": "目标等级与当前等级相同"})

    # 方向决定权限位：order 越小风险越高 → 变小是「上调等级」
    up = levels[to] < levels[frm]
    require(user, "risk:adjust:up" if up else "risk:adjust:down")

    label, by = _rule_of(frm, to)
    head = db.execute(text("SELECT head FROM dept WHERE code = :c"),
                      {"c": row["primary_dept_id"]}).scalar_one_or_none()
    now = datetime.now()
    seq = db.execute(text(
        "SELECT COALESCE(max((regexp_match(id, '(\\d+)$'))[1]::int), 100) FROM level_change")).scalar_one()
    rec = LevelChange(
        id=f"CHG-202611-{int(seq) + 1}", person_id=row["id"], name=row["name"],
        town_code=row["town_code"], dept_id=row["primary_dept_id"],
        from_level=frm, to_level=to, reason=body.reason,
        rule_label=label, approver=_approver(by, head),
        occurred_at=now, status="已生效", notified=body.notified,
        notified_at=now if body.notified else None,
    )
    db.add(rec)
    db.execute(text("UPDATE person SET level = :lv WHERE id = :id"), {"lv": to, "id": row["id"]})
    write_audit(db, user, "登记等级变动",
                target=row["no"],
                detail=f"{row['name']}：{LEVEL_NAME.get(frm, frm)} → {LEVEL_NAME.get(to, to)}"
                       f"（{label}）" + ("，已知会属地" if body.notified else "，未知会属地"),
                ip=_ip(request))
    db.commit()
    return {"ok": True, "change": {
        "id": rec.id, "personId": row["id"], "name": row["name"], "town": row["town_code"],
        "dept": row["primary_dept_id"], "from": frm, "to": to,
        "fromName": LEVEL_NAME.get(frm), "toName": LEVEL_NAME.get(to),
        "reason": rec.reason, "rule": rec.rule_label, "approver": rec.approver,
        "at": now, "status": "已生效", "notified": rec.notified,
    }, "person": {"id": row["id"], "level": to, "levelName": LEVEL_NAME.get(to)}}


# ------------------------------------------------------------------ 走访登记
class VisitIn(BaseModel):
    way: str = Field(..., description="入户走访 / 电话联系 / 联合面访 / 视频通话 / 社区见面")
    result: str = Field(..., description="走访结论")
    date: str | None = Field(None, description="YYYY-MM-DD，默认今天")


@router.post("/persons/{pid}/visits", summary="走访登记（属地经办的主要写操作）")
def create_visit(pid: str, body: VisitIn, request: Request, db: Session = Depends(get_db),
                 user: CurrentUser = Depends(get_user)) -> dict:
    ensure_data_scope(user)
    if not user.can("visit:create"):
        raise HTTPException(403, {"code": "forbidden", "reason": "缺少权限：新增走访",
                                  "need": ["visit:create"], "have": sorted(user.perms)})
    p = db.execute(text("SELECT id, no, name, primary_dept_id, town_code FROM person "
                        "WHERE id = :id FOR UPDATE"), {"id": pid}).first()
    if not p:
        raise HTTPException(404, f"人员不存在：{pid}")
    row = dict(p._mapping)
    if not user.scope.allows(row["primary_dept_id"], row["town_code"]):
        raise _out_of_scope("该人员", row["primary_dept_id"], row["town_code"], user)

    try:
        day = date.fromisoformat(body.date) if body.date else date.today()
    except ValueError:
        raise HTTPException(400, {"code": "bad_date", "reason": "日期格式应为 YYYY-MM-DD"}) from None
    seq = db.execute(text(
        "SELECT COALESCE(max((regexp_match(id, 'V(\\d+)$'))[1]::int), 0) FROM visit "
        "WHERE person_id = :p"), {"p": pid}).scalar_one()
    rec = Visit(id=f"{pid}-V{int(seq) + 1:02d}", person_id=pid, date=day,
                way=body.way, result=body.result, by=user.name,
                at=datetime.now().strftime("%Y-%m-%d %H:%M"))
    db.add(rec)
    db.execute(text("UPDATE person SET last_visit = :d WHERE id = :id"), {"d": day, "id": pid})
    write_audit(db, user, "走访登记", target=row["no"],
                detail=f"{row['name']}：{body.way}，{body.result}", ip=_ip(request))
    db.commit()
    return {"ok": True, "visit": {"id": rec.id, "personId": pid, "date": day.isoformat(),
                                  "way": rec.way, "result": rec.result, "by": rec.by, "at": rec.at},
            "person": {"id": pid, "lastVisit": day.isoformat()}}


# ------------------------------------------------------------------ 预警处置
class DisposeIn(BaseModel):
    status: str = Field(..., description="已处置 / 已忽略 / 转派")
    note: str | None = None
    to: str | None = Field(None, description="转派对象（status=转派 时必填）")


ACT_OF = {"已处置": ("alert:handle", "预警处置"),
          "已忽略": ("alert:ignore", "预警忽略"),
          "转派": ("alert:assign", "预警转派")}


@router.post("/alerts/{aid}/dispose", summary="预警处置 / 忽略 / 转派")
def dispose_alert(aid: str, body: DisposeIn, request: Request, db: Session = Depends(get_db),
                  user: CurrentUser = Depends(get_user)) -> dict:
    ensure_data_scope(user)
    if body.status not in ACT_OF:
        raise HTTPException(400, {"code": "bad_status", "reason": "状态不合法", "allowed": sorted(ACT_OF)})
    perm, act = ACT_OF[body.status]
    require(user, perm)
    if body.status == "转派" and not (body.to or "").strip():
        raise HTTPException(400, {"code": "need_target", "reason": "转派必须指定接收人"})

    a = db.execute(text("SELECT * FROM alert WHERE id = :id FOR UPDATE"), {"id": aid}).first()
    if not a:
        raise HTTPException(404, f"预警不存在：{aid}")
    row = dict(a._mapping)
    person_dept, person_town = None, row["town_code"]
    if row["person_id"]:
        pr = db.execute(text("SELECT primary_dept_id, town_code FROM person WHERE id = :id"),
                        {"id": row["person_id"]}).first()
        if pr:
            person_dept, person_town = pr[0], pr[1]
    if not (user.scope.allows(row["dept_id"], row["town_code"])
            or user.scope.allows(person_dept, person_town)):
        raise _out_of_scope("该预警", row["dept_id"] or person_dept, row["town_code"], user)

    db.execute(text("UPDATE alert SET status = :s WHERE id = :id"), {"s": body.status, "id": aid})
    detail = (f"「{row['rule_code']}」{row['person_name'] or ''} {body.status}"
              + (f"：{body.note}" if body.note else "")
              + (f" → {body.to}" if body.status == "转派" else ""))
    write_audit(db, user, act, target=aid, detail=detail, ip=_ip(request))
    db.commit()
    return {"ok": True, "alert": {"id": aid, "status": body.status, "owner": body.to or row["owner"]}}
