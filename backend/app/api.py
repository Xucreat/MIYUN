"""只读 API（阶段 B3）+ 鉴权 / 掩码 / 审计（阶段 B4）。

约定：
- 响应字段用 **camelCase**，与前端 `DATA` / `STORE` 的字段同名，B5 换数据源时不用改页面。
- 聚合都走视图或 SQL，不在 Python 里二次计算，方便与前端数字对账。
- B4 起：**每个业务端点都必须过权限门控**，个人敏感字段由服务端按 `field_policy` 掩码，
  行级范围由 `sys_account.unit` 解析出的 dept / town 过滤。掩码与权限不再交给前端。
- 掩码后的出参统一带 `maskedFields`：`{"idNo": {"mode": "申", "needApply": true}}`；
  值为 `null` 表示该字段被「隐」掉，前端请显示占位符而不是把 null 当空串。
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.orm import Session

from app import mask
from app.audit import CLIENT_ACTS, write_anonymous, write_audit
from app.auth import (
    CurrentUser, encode_token, ensure_data_scope, get_user, load_user,
    need, optional_user, person_scope_sql,
)
from app.config import settings
from app.db import get_db

router = APIRouter(prefix="/api")

LEVEL_NAME = {"high2": "极高风险", "high": "高风险", "mid": "中风险", "low": "低风险", "unknown": "待核实"}


def _rows(db: Session, sql: str, **params) -> list[dict]:
    return [dict(r._mapping) for r in db.execute(text(sql), params).all()]


def _one(db: Session, sql: str, **params) -> dict | None:
    r = db.execute(text(sql), params).first()
    return dict(r._mapping) if r else None


def _page(page: int, size: int, total: int, items: list[dict]) -> dict:
    return {"total": total, "page": page, "size": size, "pages": (total + size - 1) // size, "items": items}


def _ip(request: Request) -> str | None:
    return request.client.host if request.client else None


# ------------------------------------------------------------------ 登录与身份
class LoginIn(BaseModel):
    account: str = Field(..., description="账号（sys_account.account），如 liguodong")
    password: str | None = Field(None, description="演示口令，默认取 DEMO_PASSWORD")


@router.post("/auth/login", summary="登录，签发 Bearer 令牌")
def login(body: LoginIn, request: Request, db: Session = Depends(get_db)) -> dict:
    ip = _ip(request)
    pwd = body.password if body.password is not None else settings.demo_password
    if pwd != settings.demo_password:
        write_anonymous(db, "登录失败", by=body.account, role=None,
                        target="系统入口", detail="口令错误", ip=ip)
        db.commit()
        raise HTTPException(401, {"code": "unauthorized", "reason": "账号或口令错误"})
    try:
        user = load_user(db, body.account, ip)
    except HTTPException:
        write_anonymous(db, "登录失败", by=body.account, role=None,
                        target="系统入口", detail="账号不存在或已停用", ip=ip)
        db.commit()
        raise
    token, exp = encode_token(user.id)
    write_audit(db, user, "登录", "系统入口",
                f"以「{user.role_name}」身份登录系统", ip=ip)
    db.commit()
    return {"token": token, "expiresAt": exp, "user": user.as_dict(),
            "district": settings.demo_district}


@router.get("/me", summary="当前身份：角色 / 权限位 / 字段密级 / 数据范围")
def me(user: CurrentUser = Depends(get_user)) -> dict:
    return {"user": user.as_dict(), "district": settings.demo_district}


# ------------------------------------------------------------------ 基础信息
@router.get("/health")
def health(request: Request, db: Session = Depends(get_db),
           user: CurrentUser | None = Depends(optional_user)) -> dict:
    db.execute(text("SELECT 1"))
    out = {"ok": True, "version": "0.4.0", "district": settings.demo_district,
           "authenticated": user is not None}
    if user is not None:   # 台账规模只对登录用户可见
        out["persons"] = db.execute(text("SELECT count(*) FROM person")).scalar_one()
        out["role"] = user.role_key
    return out


@router.get("/meta")
def meta(db: Session = Depends(get_db), user: CurrentUser = Depends(get_user)) -> dict:
    snap = _one(db, "SELECT * FROM metric_snapshot ORDER BY as_of DESC LIMIT 1")
    period = _one(db, "SELECT id, title, name, start, end, level_key FROM wartime_period WHERE active LIMIT 1")
    return {"district": settings.demo_district, "asOf": (snap or {}).get("as_of"),
            "wartime": period, "scope": user.scope.as_dict()}


# ------------------------------------------------------------------ 统计
@router.get("/stats/overview")
def stats_overview(db: Session = Depends(get_db),
                   user: CurrentUser = Depends(need("dashboard:view"))) -> dict:
    """五个核心数：在册 6028 / 高风险及以上 486 / 双在册 127 / 多重标签 214 / 待核实 612。

    高风险及以上与极高风险是**实时口径**（`recalcStats` 语义）：从 person 直接数，
    这样登记等级变动后立刻反映。其余（在册 / 中 / 低 / 双在册 / 多标 / 待核实）
    仍取 `metric_snapshot`：中低两档没有逐人明细，属冻结快照口径。
    """
    s = _one(db, "SELECT * FROM metric_snapshot ORDER BY as_of DESC LIMIT 1")
    if not s:
        raise HTTPException(503, "metric_snapshot 为空，请先执行 python -m app.seed")
    detail = _one(db, """
        SELECT count(*) FILTER (WHERE NOT is_unrated) AS high_detail,
               count(*) FILTER (WHERE is_unrated) AS unrated_detail,
               count(*) AS total_detail,
               count(*) FILTER (WHERE level IN ('high', 'high2')) AS high_plus_live,
               count(*) FILTER (WHERE level = 'high2') AS high2_live
        FROM person
    """)
    high_plus = int(detail["high_plus_live"])
    high2 = int(detail["high2_live"])
    return {
        "inRegister": s["in_register"], "highPlus": high_plus, "high2": high2,
        "mid": s["mid"], "low": s["low"], "unknown": s["unknown"],
        "dual": s["dual"], "multi": s["multi"], "multi2": s["multi2"], "multi3": s["multi3"],
        "noBasis": s["no_basis"], "noVisit30": s["no_visit30"], "noVisit30High": s["no_visit30_high"],
        "offRegister": s["off_register"], "monthAdd": s["month_add"], "monthSub": s["month_sub"],
        "ledgerRecords": s["ledger_records"],
        "percentHigh": round(high_plus / s["in_register"] * 100, 1) if s["in_register"] else 0.0,
        "detail": detail,          # 明细实际行数（1098），与快照的口径差异在此显式暴露
        "asOf": s["as_of"],
        "liveFields": ["highPlus", "high2", "percentHigh"],   # 哪些数是实时算的，写清楚
        "scope": user.scope.as_dict(),
    }


@router.get("/stats/dept")
def stats_dept(
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(need("dashboard:view")),
    unrated: bool = Query(False, description="是否把待核实人员计入；默认 False = 与前端「486 高风险及以上」同口径"),
) -> dict:
    """部门两套口径（裁决 B1）+ 重合（裁决 A1）。两条 SQL 分开，不合并成一个参数。

    部门分布本身是全区统计口径（R3/R4/R5 的账号 scope 是「本部门 / 本辖区」，
    但部门对比需要全区才能看），因此此处**不按 scope 过滤**；个案明细才过滤。
    """
    ur = "" if unrated else " AND NOT p.is_unrated"
    primary = _rows(db, f"""
        SELECT p.primary_dept_id AS dept_id, count(*)::int AS persons
        FROM person p WHERE p.primary_dept_id IS NOT NULL{ur}
        GROUP BY 1 ORDER BY persons DESC
    """)
    tag = _rows(db, f"""
        SELECT t.dept_id, count(DISTINCT t.person_id)::int AS persons
        FROM person_tag t JOIN person p ON p.id = t.person_id
        WHERE t.dept_id IS NOT NULL{ur}
        GROUP BY 1 ORDER BY persons DESC
    """)
    pairs = _rows(db, f"""
        SELECT a.dept_id AS a, b.dept_id AS b, count(DISTINCT a.person_id)::int AS persons
        FROM person_tag a JOIN person_tag b
          ON a.person_id = b.person_id AND a.dept_id < b.dept_id
        JOIN person p ON p.id = a.person_id
        WHERE TRUE{ur}
        GROUP BY 1, 2 ORDER BY persons DESC
    """)
    multi = _one(db, f"""
        SELECT count(*) FILTER (WHERE n > 1) AS multi_persons,
               count(*) FILTER (WHERE n = 2) AS two,
               count(*) FILTER (WHERE n = 3) AS three,
               sum(n) AS person_times
        FROM (
            SELECT t.person_id, count(DISTINCT t.dept_id) AS n
            FROM person_tag t JOIN person p ON p.id = t.person_id
            WHERE TRUE{ur}
            GROUP BY 1
        ) s
    """)
    cross = _one(db, "SELECT * FROM v_dual_cross")
    return {
        "scope": "all" if unrated else "highPlus",
        "primary": primary, "tag": tag, "pairs": pairs,
        "multiPersons": int(multi["multi_persons"] or 0), "two": int(multi["two"] or 0),
        "three": int(multi["three"] or 0), "personTimes": int(multi["person_times"] or 0),
        "dual": {"dualPersons": cross["dual_n"], "crossDeptPersons": cross["cross_n"],
                 "intersection": cross["inter"], "union": cross["uni"]},
    }


# ------------------------------------------------------------------ 人员台账
PERSON_SELECT = """
    SELECT p.id, p.no, p.name, p.gender, p.birth, p.id_no, p.phone,
           p.town_code, p.village, p.addr, p.primary_dept_id, p.dept_raw, p.level,
           p.source, p.status, p.since, p.watch, p.no_basis, p.last_visit,
           p.officer, p.officer_title, p.is_unrated,
           (SELECT count(*) FROM visit v WHERE v.person_id = p.id)::int AS visit_total
    FROM person p
"""


def _person_out(r: dict, tags: list[str] | None = None, dual: bool | None = None) -> dict:
    return {
        "id": r["id"], "no": r["no"], "name": r["name"], "gender": r["gender"],
        "birth": r["birth"].isoformat() if r["birth"] else None,
        "idNo": r["id_no"], "phone": r["phone"],
        "town": r["town_code"], "village": r["village"], "addr": r["addr"],
        "dept": r["primary_dept_id"], "level": r["level"],
        "levelName": LEVEL_NAME.get(r["level"], r["level"]),
        "tags": tags if tags is not None else [],
        "multi": len(tags or []) > 1,
        "dual": bool(dual),
        "officer": r["officer"], "officerTitle": r["officer_title"],
        "source": r["source"], "status": r["status"], "since": r["since"],
        "lastVisit": r["last_visit"].isoformat() if r["last_visit"] else None,
        "visitTotal": r.get("visit_total", 0),
        "watch": r["watch"], "noBasis": r["no_basis"], "unrated": r["is_unrated"],
    }


@router.get("/persons")
def list_persons(
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(need("person:list")),
    q: str | None = Query(None, description="姓名 / 档案号 / 身份证后四位"),
    level: str | None = Query(None, description="high2 / high / mid / low / unknown，可逗号分隔"),
    town: str | None = None,
    dept: str | None = Query(None, description="主责部门口径（对应前端 ?dept=）"),
    deptTag: str | None = Query(None, description="类别归属口径（对应前端 ?deptTag=），可逗号分隔"),
    tag: str | None = None,
    unrated: bool | None = None,
    page: int = 1,
    size: int = Query(20, le=200),
) -> dict:
    ensure_data_scope(user)
    scope_sql, scope_params = person_scope_sql(user, "p")
    where, params = ["1=1", scope_sql], dict(scope_params)
    if q:
        where.append("(p.name LIKE :q OR p.no LIKE :q OR p.id_no LIKE :q)")
        params["q"] = f"%{q}%"
    if level:
        where.append("p.level = ANY(:levels)")
        params["levels"] = [x.strip() for x in level.split(",") if x.strip()]
    if town:
        where.append("p.town_code = :town")
        params["town"] = town
    if dept:
        where.append("p.primary_dept_id = :dept")          # 主责口径：单值
        params["dept"] = dept
    if deptTag:
        # 类别归属口径：标签映射到部门，要求命中全部所选部门（与前端 ?deptTag= 的 AND 语义一致）
        tags = [x.strip() for x in deptTag.split(",") if x.strip()]
        where.append("""p.id IN (
            SELECT person_id FROM person_tag WHERE dept_id = ANY(:dept_tags)
            GROUP BY person_id HAVING count(DISTINCT dept_id) = :dept_tag_n)""")
        params["dept_tags"] = tags
        params["dept_tag_n"] = len(tags)
    if tag:
        where.append("p.id IN (SELECT person_id FROM person_tag WHERE tag_code = :tag)")
        params["tag"] = tag
    if unrated is not None:
        where.append("p.is_unrated = :unrated")
        params["unrated"] = unrated

    w = " WHERE " + " AND ".join(where)
    total = db.execute(text("SELECT count(*) FROM person p" + w), params).scalar_one()
    rows = _rows(db, PERSON_SELECT + w + " ORDER BY p.id LIMIT :lim OFFSET :off",
                 **params, lim=size, off=(page - 1) * size)
    ids = [r["id"] for r in rows]
    tags = _tags_of(db, ids) if ids else {}
    duals = _dual_of(db, ids) if ids else set()
    items = [mask.apply_person(_person_out(r, tags.get(r["id"], []), r["id"] in duals),
                               user, r["primary_dept_id"], r["town_code"]) for r in rows]
    return _page(page, size, total, items)


def _tags_of(db: Session, ids: list[str]) -> dict[str, list[str]]:
    out: dict[str, list[str]] = {}
    for r in _rows(db, "SELECT person_id, tag_code FROM person_tag WHERE person_id = ANY(:ids) "
                       "ORDER BY person_id, tag_code", ids=ids):
        out.setdefault(r["person_id"], []).append(r["tag_code"])
    return out


def _dual_of(db: Session, ids: list[str]) -> set[str]:
    return {r["person_id"] for r in
            _rows(db, "SELECT DISTINCT person_id FROM dual_confirm WHERE person_id = ANY(:ids)", ids=ids)}


@router.get("/persons/{pid}")
def get_person(pid: str, db: Session = Depends(get_db),
               user: CurrentUser = Depends(need("person:view"))) -> dict:
    ensure_data_scope(user)
    r = _one(db, PERSON_SELECT + " WHERE p.id = :pid", pid=pid)
    if not r:
        raise HTTPException(404, f"人员不存在：{pid}")
    if not user.scope.allows(r["primary_dept_id"], r["town_code"]):
        # 越权访问：403 而不是 404，便于前端提示「不在你的数据范围」，也便于审计取到拒绝事件
        raise HTTPException(403, {"code": "out_of_scope", "reason": "该人员不在你的数据范围内",
                                 "scope": user.scope.as_dict()})
    tags = _tags_of(db, [pid]).get(pid, [])
    dual = pid in _dual_of(db, [pid])
    out = mask.apply_person(_person_out(r, tags, dual), user, r["primary_dept_id"], r["town_code"])
    ctx = {"dept": r["primary_dept_id"], "town": r["town_code"],
           "user_dept": user.dept, "user_town": user.town}

    visits = []
    for v in _rows(db, "SELECT * FROM visit WHERE person_id = :pid ORDER BY date DESC", pid=pid):
        result, info = mask.apply_field(user.field_mode("visit"), "text", v["result"], ctx)
        visits.append({"id": v["id"], "date": v["date"].isoformat() if v["date"] else None,
                       "way": v["way"], "result": result, "by": v["by"],
                       **({"masked": info} if info else {})})
    out["visits"] = visits

    changes = []
    for c in _rows(db, "SELECT * FROM level_change WHERE person_id = :pid "
                       "ORDER BY occurred_at DESC NULLS LAST", pid=pid):
        reason, info = mask.apply_field(user.field_mode("reason"), "text", c["reason"], ctx)
        changes.append({"id": c["id"], "from": c["from_level"], "to": c["to_level"],
                        "date": c["occurred_at"], "reason": reason, "rule": c["rule_label"],
                        "by": c["approver"], "notified": c["notified"],
                        **({"masked": info} if info else {})})
    out["levelChanges"] = changes
    out["dualDepts"] = [x["dept_id"] for x in
                        _rows(db, "SELECT dept_id FROM dual_confirm WHERE person_id = :pid", pid=pid)]
    return out


# ------------------------------------------------------------------ 等级变动
@router.get("/level-changes")
def list_level_changes(
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(need("risk:history:view")),
    personId: str | None = None,
    dept: str | None = None,
    town: str | None = None,
    page: int = 1,
    size: int = Query(20, le=200),
) -> dict:
    ensure_data_scope(user)
    where, params = ["1=1"], {}
    if user.scope.kind == "dept":
        where.append("(c.dept_id = :_sd OR c.person_id IN "
                     "(SELECT id FROM person WHERE primary_dept_id = :_sd))")
        params["_sd"] = user.scope.value
    elif user.scope.kind == "town":
        where.append("c.town_code = :_st")
        params["_st"] = user.scope.value
    if personId:
        where.append("c.person_id = :pid")
        params["pid"] = personId
    if dept:
        where.append("c.dept_id = :dept")
        params["dept"] = dept
    if town:
        where.append("c.town_code = :town")
        params["town"] = town
    w = " WHERE " + " AND ".join(where)
    total = db.execute(text("SELECT count(*) FROM level_change c" + w), params).scalar_one()
    rows = _rows(db, "SELECT * FROM level_change c" + w +
                 " ORDER BY occurred_at DESC NULLS LAST, id LIMIT :lim OFFSET :off",
                 **params, lim=size, off=(page - 1) * size)
    ctx = {"dept": None, "town": None, "user_dept": user.dept, "user_town": user.town}
    items = []
    for r in rows:
        name, n_info = mask.apply_field(user.field_mode("name"), "name", r["name"], ctx)
        reason, r_info = mask.apply_field(user.field_mode("reason"), "text", r["reason"], ctx)
        items.append({
            "id": r["id"], "personId": r["person_id"], "name": name, "town": r["town_code"],
            "dept": r["dept_id"], "from": r["from_level"], "to": r["to_level"],
            "fromName": LEVEL_NAME.get(r["from_level"]), "toName": LEVEL_NAME.get(r["to_level"]),
            "reason": reason, "rule": r["rule_label"], "approver": r["approver"],
            "at": r["occurred_at"], "status": r["status"], "notified": r["notified"],
            "maskedFields": {k: v for k, v in (("name", n_info), ("reason", r_info)) if v},
        })
    up_down = _one(db, """
        SELECT count(*) FILTER (WHERE lt."order" < lf."order")::int AS up,
               count(*) FILTER (WHERE lt."order" > lf."order")::int AS down
        FROM level_change c
        JOIN level_dict lf ON lf.key = c.from_level
        JOIN level_dict lt ON lt.key = c.to_level
    """) or {"up": 0, "down": 0}
    return {**_page(page, size, total, items), "upDown": up_down}


# ------------------------------------------------------------------ 预警
@router.get("/alerts")
def list_alerts(
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(need("alert:view")),
    status: str | None = None,
    town: str | None = None,
    page: int = 1,
    size: int = Query(20, le=200),
) -> dict:
    ensure_data_scope(user)
    where, params = ["1=1"], {}
    if user.scope.kind == "dept":
        where.append("(a.dept_id = :_sd OR a.person_id IN "
                     "(SELECT id FROM person WHERE primary_dept_id = :_sd))")
        params["_sd"] = user.scope.value
    elif user.scope.kind == "town":
        where.append("a.town_code = :_st")
        params["_st"] = user.scope.value
    if status:
        where.append("a.status = :status")
        params["status"] = status
    if town:
        where.append("a.town_code = :town")
        params["town"] = town
    w = " WHERE " + " AND ".join(where)
    total = db.execute(text("SELECT count(*) FROM alert a" + w), params).scalar_one()
    rows = _rows(db, "SELECT * FROM alert a" + w + " ORDER BY a.created_at DESC LIMIT :lim OFFSET :off",
                 **params, lim=size, off=(page - 1) * size)
    ctx = {"dept": None, "town": None, "user_dept": user.dept, "user_town": user.town}
    items = []
    for r in rows:
        who, info = mask.apply_field(user.field_mode("name"), "name", r["person_name"], ctx)
        items.append({
            "id": r["id"], "rule": r["rule_code"], "urgency": r["urgency"],
            "personId": r["person_id"], "who": who, "town": r["town_code"],
            "levelName": r["level_name"], "metric": r["metric"], "dept": r["dept_id"],
            # B6-2：dept 是能对上 dept 表的 code（镇街综治中心这类为 null），
            # deptRaw 才是责任单位原文，前端优先用它。
            "deptRaw": r["dept_raw"],
            "owner": r["owner"], "desc": r["desc"], "created": r["created_at"], "status": r["status"],
            "maskedFields": {"who": info} if info else {},
        })
    stat = _one(db, "SELECT count(*) FILTER (WHERE status='待处置') AS open, count(*) AS total FROM alert")
    return {**_page(page, size, total, items), "stats": stat}


# ------------------------------------------------------------------ 走访
@router.get("/visits")
def list_visits(
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(need("visit:view")),
    personId: str | None = None,
    town: str | None = None,
    page: int = 1,
    size: int = Query(20, le=200),
) -> dict:
    """走访记录（B6 新增）。

    为什么要有这个端点：走访登记是写进 `visit` 表的，但没有读口时前端刷新后
    只能回落到本地生成的历史走访 —— 等于「登记成功、页面看不见」。
    范围过滤走 `person`（visit 表本身没有部门/镇街列），掩码落在 `result`
    （field_policy 的 `visit` 字段：R1 掩、R5 辖区明、R7-R9 隐）。
    """
    ensure_data_scope(user)
    where, params = ["1=1"], {}
    if user.scope.kind == "dept":
        where.append("p.primary_dept_id = :_sd")
        params["_sd"] = user.scope.value
    elif user.scope.kind == "town":
        where.append("p.town_code = :_st")
        params["_st"] = user.scope.value
    if personId:
        where.append("v.person_id = :pid")
        params["pid"] = personId
    if town:
        where.append("p.town_code = :town")
        params["town"] = town
    w = " WHERE " + " AND ".join(where)
    base = " FROM visit v JOIN person p ON p.id = v.person_id"
    total = db.execute(text("SELECT count(*)" + base + w), params).scalar_one()
    rows = _rows(db, "SELECT v.id, v.person_id, v.date, v.way, v.result, v.by, v.at,"
                     "       p.primary_dept_id, p.town_code" + base + w +
                 " ORDER BY v.date DESC NULLS LAST, v.id DESC LIMIT :lim OFFSET :off",
                 **params, lim=size, off=(page - 1) * size)
    mode = user.field_mode("visit")
    items = []
    for r in rows:
        ctx = {"dept": r["primary_dept_id"], "town": r["town_code"],
               "user_dept": user.dept, "user_town": user.town}
        result, info = mask.apply_field(mode, "text", r["result"], ctx)
        items.append({
            "id": r["id"], "personId": r["person_id"],
            "date": r["date"].isoformat() if r["date"] else None,
            "way": r["way"], "result": result, "by": r["by"], "at": r["at"],
            "maskedFields": {"result": info} if info else {},
        })
    return _page(page, size, total, items)


# ------------------------------------------------------------------ 审计
@router.get("/audit")
def list_audit(
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(need("sys:audit:view")),
    act: str | None = None,
    q: str | None = None,
    limit: int = Query(50, le=500),
) -> dict:
    where, params = ["1=1"], {}
    if act:
        where.append("act = :act")
        params["act"] = act
    if q:
        where.append('(target LIKE :q OR detail LIKE :q OR "by" LIKE :q)')
        params["q"] = f"%{q}%"
    w = " WHERE " + " AND ".join(where)
    total = db.execute(text('SELECT count(*) FROM audit_log' + w), params).scalar_one()
    rows = _rows(db, 'SELECT id, at, act, target, detail, "by" AS by_, role, ip, mode '
                     'FROM audit_log' + w + ' ORDER BY id DESC LIMIT :lim', **params, lim=limit)
    return {"total": total, "items": rows}


class AuditIn(BaseModel):
    act: str
    target: str | None = None
    detail: str | None = None


@router.post("/audit", summary="前端上报只读类动作（写操作由服务端自行留痕，不用这个口）")
def post_audit(body: AuditIn, request: Request, db: Session = Depends(get_db),
               user: CurrentUser = Depends(get_user)) -> dict:
    if body.act not in CLIENT_ACTS:
        raise HTTPException(400, {"code": "act_not_allowed", "reason": "该动作由服务端自行记录",
                                  "allowed": sorted(CLIENT_ACTS)})
    rec = write_audit(db, user, body.act, body.target, body.detail, ip=_ip(request))
    db.commit()
    return {"ok": True, "id": rec.id, "at": rec.at, "by": rec.by}


# ------------------------------------------------------------------ 字典与配置
@router.get("/towns")
def list_towns(db: Session = Depends(get_db), user: CurrentUser = Depends(get_user)) -> list[dict]:
    rows = _rows(db, "SELECT * FROM town ORDER BY code")
    villages = _rows(db, "SELECT town_code, name FROM village ORDER BY code")
    by_town: dict[str, list[str]] = {}
    for v in villages:
        by_town.setdefault(v["town_code"], []).append(v["name"])
    for r in rows:
        r["villages"] = by_town.get(r["code"], [])
    return rows


@router.get("/dicts")
def list_dicts(db: Session = Depends(get_db), user: CurrentUser = Depends(get_user)) -> list[dict]:
    return _rows(db, "SELECT * FROM dict_type ORDER BY key")


@router.get("/dicts/{key}")
def get_dict(key: str, db: Session = Depends(get_db),
             user: CurrentUser = Depends(get_user)) -> dict:
    t = _one(db, "SELECT * FROM dict_type WHERE key = :k", k=key)
    if not t:
        raise HTTPException(404, f"字典不存在：{key}")
    t["rows"] = [r["extra"] for r in
                 _rows(db, "SELECT extra FROM dict_item WHERE type_key = :k ORDER BY sort", k=key)]
    return t


@router.get("/rules")
def list_rules(db: Session = Depends(get_db), user: CurrentUser = Depends(get_user)) -> dict:
    return {
        "rules": _rows(db, "SELECT * FROM rule ORDER BY code"),
        "dqRules": _rows(db, "SELECT * FROM dq_rule ORDER BY code"),
        "routes": _rows(db, "SELECT * FROM level_route ORDER BY target_level"),
    }


@router.get("/params")
def list_params(db: Session = Depends(get_db), user: CurrentUser = Depends(get_user)) -> list[dict]:
    return _rows(db, "SELECT * FROM system_param ORDER BY key")


@router.get("/responders")
def list_responders(db: Session = Depends(get_db),
                    user: CurrentUser = Depends(get_user)) -> list[dict]:
    return _rows(db, "SELECT * FROM responder ORDER BY id")


@router.get("/roles")
def list_roles(db: Session = Depends(get_db), user: CurrentUser = Depends(get_user)) -> dict:
    roles = _rows(db, "SELECT * FROM sys_role ORDER BY key")
    perms = _rows(db, "SELECT role_key, perm_code, mode FROM role_perm ORDER BY role_key, perm_code")
    by_role: dict[str, list[str]] = {}
    modes_of: dict[str, dict[str, str]] = {}
    for p in perms:
        by_role.setdefault(p["role_key"], []).append(p["perm_code"])
        modes_of.setdefault(p["role_key"], {})[p["perm_code"]] = p["mode"] or "on"
    for r in roles:
        # perms 保持「字符串数组」不变（兼容既有消费方）；modes 是 B6-3 新增的三态映射。
        # 表里没行 = 禁止，所以 modes 里不会出现 'off'。
        r["perms"] = by_role.get(r["key"], [])
        r["modes"] = modes_of.get(r["key"], {})
    return {"roles": roles, "permTotal": db.execute(text("SELECT count(*) FROM perm")).scalar_one(),
            "permCodes": [x["code"] for x in _rows(db, "SELECT code FROM perm ORDER BY code")]}
