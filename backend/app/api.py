"""只读 API（阶段 B3）。

约定：
- 响应字段用 **camelCase**，与前端 `DATA` / `STORE` 的字段同名，B5 换数据源时不用改页面。
- 本阶段**不做鉴权与掩码**（B4 才做）。当前返回的是演示数据，本身就是虚拟脱敏的。
- 所有聚合都走视图或 SQL，不在 Python 里二次计算，方便与前端数字对账。
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import text
from sqlalchemy.orm import Session

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


# ------------------------------------------------------------------ 基础信息
@router.get("/health")
def health(db: Session = Depends(get_db)) -> dict:
    db.execute(text("SELECT 1"))
    n = db.execute(text("SELECT count(*) FROM person")).scalar_one()
    return {"ok": True, "persons": n, "district": settings.demo_district}


@router.get("/meta")
def meta(db: Session = Depends(get_db)) -> dict:
    snap = _one(db, "SELECT * FROM metric_snapshot ORDER BY as_of DESC LIMIT 1")
    period = _one(db, "SELECT id, title, name, start, end, level_key FROM wartime_period WHERE active LIMIT 1")
    return {"district": settings.demo_district, "asOf": (snap or {}).get("as_of"), "wartime": period}


# ------------------------------------------------------------------ 统计
@router.get("/stats/overview")
def stats_overview(db: Session = Depends(get_db)) -> dict:
    """五个核心数：在册 6028 / 高风险及以上 486 / 双在册 127 / 多重标签 214 / 待核实 612。

    前两个与后三个来自 metric_snapshot（承载没有逐人明细的中/低两档），
    明细侧同时给出实际行数，便于一眼看出「快照 vs 明细」的边界。
    """
    s = _one(db, "SELECT * FROM metric_snapshot ORDER BY as_of DESC LIMIT 1")
    if not s:
        raise HTTPException(503, "metric_snapshot 为空，请先执行 python -m app.seed")
    detail = _one(db, """
        SELECT count(*) FILTER (WHERE NOT is_unrated) AS high_detail,
               count(*) FILTER (WHERE is_unrated) AS unrated_detail,
               count(*) AS total_detail
        FROM person
    """)
    return {
        "inRegister": s["in_register"], "highPlus": s["high_plus"], "high2": s["high2"],
        "mid": s["mid"], "low": s["low"], "unknown": s["unknown"],
        "dual": s["dual"], "multi": s["multi"], "multi2": s["multi2"], "multi3": s["multi3"],
        "noBasis": s["no_basis"], "noVisit30": s["no_visit30"], "noVisit30High": s["no_visit30_high"],
        "offRegister": s["off_register"], "monthAdd": s["month_add"], "monthSub": s["month_sub"],
        "ledgerRecords": s["ledger_records"], "percentHigh": float(s["percent_high"]),
        "detail": detail,          # 明细实际行数（1098），与快照的口径差异在此显式暴露
        "asOf": s["as_of"],
    }


@router.get("/stats/dept")
def stats_dept(
    db: Session = Depends(get_db),
    unrated: bool = Query(False, description="是否把待核实人员计入；默认 False = 与前端「486 高风险及以上」同口径"),
) -> dict:
    """部门两套口径（裁决 B1）+ 重合（裁决 A1）。两条 SQL 分开，不合并成一个参数。"""
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
           p.town_code, p.village, p.addr, p.primary_dept_id, p.level,
           p.source, p.status, p.since, p.watch, p.no_basis, p.last_visit,
           p.officer, p.officer_title, p.is_unrated
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
        "watch": r["watch"], "noBasis": r["no_basis"], "unrated": r["is_unrated"],
    }


@router.get("/persons")
def list_persons(
    db: Session = Depends(get_db),
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
    where, params = ["1=1"], {}
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
    items = [_person_out(r, tags.get(r["id"], []), r["id"] in duals) for r in rows]
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
def get_person(pid: str, db: Session = Depends(get_db)) -> dict:
    r = _one(db, PERSON_SELECT + " WHERE p.id = :pid", pid=pid)
    if not r:
        raise HTTPException(404, f"人员不存在：{pid}")
    tags = _tags_of(db, [pid]).get(pid, [])
    dual = pid in _dual_of(db, [pid])
    out = _person_out(r, tags, dual)

    out["visits"] = [
        {"id": v["id"], "date": v["date"].isoformat() if v["date"] else None,
         "way": v["way"], "result": v["result"], "by": v["by"]}
        for v in _rows(db, "SELECT * FROM visit WHERE person_id = :pid ORDER BY date DESC", pid=pid)
    ]
    out["levelChanges"] = [
        {"id": c["id"], "from": c["from_level"], "to": c["to_level"], "date": c["occurred_at"],
         "reason": c["reason"], "rule": c["rule_label"], "by": c["approver"],
         "notified": c["notified"]}
        for c in _rows(db, "SELECT * FROM level_change WHERE person_id = :pid "
                           "ORDER BY occurred_at DESC NULLS LAST", pid=pid)
    ]
    out["dualDepts"] = [x["dept_id"] for x in
                        _rows(db, "SELECT dept_id FROM dual_confirm WHERE person_id = :pid", pid=pid)]
    return out


# ------------------------------------------------------------------ 等级变动
@router.get("/level-changes")
def list_level_changes(
    db: Session = Depends(get_db),
    personId: str | None = None,
    dept: str | None = None,
    town: str | None = None,
    page: int = 1,
    size: int = Query(20, le=200),
) -> dict:
    where, params = ["1=1"], {}
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
    items = [{
        "id": r["id"], "personId": r["person_id"], "name": r["name"], "town": r["town_code"],
        "dept": r["dept_id"], "from": r["from_level"], "to": r["to_level"],
        "fromName": LEVEL_NAME.get(r["from_level"]), "toName": LEVEL_NAME.get(r["to_level"]),
        "reason": r["reason"], "rule": r["rule_label"], "approver": r["approver"],
        "at": r["occurred_at"], "status": r["status"], "notified": r["notified"],
    } for r in rows]
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
    status: str | None = None,
    town: str | None = None,
    page: int = 1,
    size: int = Query(20, le=200),
) -> dict:
    where, params = ["1=1"], {}
    if status:
        where.append("status = :status")
        params["status"] = status
    if town:
        where.append("town_code = :town")
        params["town"] = town
    w = " WHERE " + " AND ".join(where)
    total = db.execute(text("SELECT count(*) FROM alert" + w), params).scalar_one()
    rows = _rows(db, "SELECT * FROM alert" + w + " ORDER BY created_at DESC LIMIT :lim OFFSET :off",
                 **params, lim=size, off=(page - 1) * size)
    items = [{
        "id": r["id"], "rule": r["rule_code"], "urgency": r["urgency"],
        "personId": r["person_id"], "who": r["person_name"], "town": r["town_code"],
        "levelName": r["level_name"], "metric": r["metric"], "dept": r["dept_id"],
        "owner": r["owner"], "desc": r["desc"], "created": r["created_at"], "status": r["status"],
    } for r in rows]
    stat = _one(db, "SELECT count(*) FILTER (WHERE status='待处置') AS open, count(*) AS total FROM alert")
    return {**_page(page, size, total, items), "stats": stat}


# ------------------------------------------------------------------ 字典与配置
@router.get("/towns")
def list_towns(db: Session = Depends(get_db)) -> list[dict]:
    rows = _rows(db, "SELECT * FROM town ORDER BY code")
    villages = _rows(db, "SELECT town_code, name FROM village ORDER BY code")
    by_town: dict[str, list[str]] = {}
    for v in villages:
        by_town.setdefault(v["town_code"], []).append(v["name"])
    for r in rows:
        r["villages"] = by_town.get(r["code"], [])
    return rows


@router.get("/dicts")
def list_dicts(db: Session = Depends(get_db)) -> list[dict]:
    return _rows(db, "SELECT * FROM dict_type ORDER BY key")


@router.get("/dicts/{key}")
def get_dict(key: str, db: Session = Depends(get_db)) -> dict:
    t = _one(db, "SELECT * FROM dict_type WHERE key = :k", k=key)
    if not t:
        raise HTTPException(404, f"字典不存在：{key}")
    t["rows"] = [r["extra"] for r in
                 _rows(db, "SELECT extra FROM dict_item WHERE type_key = :k ORDER BY sort", k=key)]
    return t


@router.get("/rules")
def list_rules(db: Session = Depends(get_db)) -> dict:
    return {
        "rules": _rows(db, "SELECT * FROM rule ORDER BY code"),
        "dqRules": _rows(db, "SELECT * FROM dq_rule ORDER BY code"),
        "routes": _rows(db, "SELECT * FROM level_route ORDER BY target_level"),
    }


@router.get("/params")
def list_params(db: Session = Depends(get_db)) -> list[dict]:
    return _rows(db, "SELECT * FROM system_param ORDER BY key")


@router.get("/responders")
def list_responders(db: Session = Depends(get_db)) -> list[dict]:
    return _rows(db, "SELECT * FROM responder ORDER BY id")


@router.get("/roles")
def list_roles(db: Session = Depends(get_db)) -> dict:
    roles = _rows(db, "SELECT * FROM sys_role ORDER BY key")
    perms = _rows(db, "SELECT role_key, perm_code FROM role_perm ORDER BY role_key, perm_code")
    by_role: dict[str, list[str]] = {}
    for p in perms:
        by_role.setdefault(p["role_key"], []).append(p["perm_code"])
    for r in roles:
        r["perms"] = by_role.get(r["key"], [])
    return {"roles": roles, "permTotal": db.execute(text("SELECT count(*) FROM perm")).scalar_one()}
