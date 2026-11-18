"""种子导入：backend/seed/data/*.json → PostgreSQL。

对应阶段 B2。设计要点：
- **幂等**：先 TRUNCATE 再灌，重复执行结果一致（本地演示库，不做增量合并）。
- **不造假**：只导入有明细的 1,098 人；中/低风险两档走 metric_snapshot。
- 时间字段前端有 'MM-DD HH:MM' 这种不带年份的写法，这里统一补 2026 年。

用法：
    python -m app.seed            # 灌库
    python -m app.seed --verify   # 只做行数对账，不写库
"""
from __future__ import annotations

import json
import re
import sys
from datetime import date, datetime
from pathlib import Path

from sqlalchemy import text

from app.db import SessionLocal, engine
from app.models import (
    Alert,
    AuditLog,
    Base,
    Dept,
    DictItem,
    DictType,
    DqRule,
    DualConfirm,
    FieldPolicy,
    ImportBatch,
    ImportRow,
    LevelChange,
    LevelDict,
    LevelRoute,
    MetricSnapshot,
    Perm,
    Person,
    PersonTag,
    PlainExportReq,
    ReportMonthly,
    Responder,
    RolePerm,
    Rule,
    SecurityEvent,
    SysAccount,
    SysRole,
    SystemParam,
    TagDict,
    Town,
    Village,
    Visit,
    WartimePeriod,
    WartimeReport,
    WartimeTask,
    WtLevel,
)
from app.views import VIEWS_SQL

SEED_DIR = Path(__file__).resolve().parent.parent / "seed" / "data"
DEMO_YEAR = 2026

# 与迁移脚本保持同一份清单：灌库前按依赖倒序清空
TRUNCATE_ORDER = [
    "import_row", "import_batch", "visit", "alert", "plain_export_req",
    "level_change", "dual_confirm", "person_tag", "person", "wartime_report",
    "wartime_task", "wartime_period", "report_monthly", "dict_item", "dict_type",
    "role_perm", "perm", "sys_account", "sys_role", "field_policy", "responder",
    "level_route", "rule", "dq_rule", "system_param", "audit_log", "security_event",
    "metric_snapshot", "wt_level", "village", "town", "tag_dict", "level_dict", "dept",
]

# 对账基线：这些数字必须与 docs/prototype-v2 前端完全一致
EXPECT = {
    "person": 1098, "person_tag": 1340, "dual_confirm": 127, "visit": 2916,
    "level_change": 46, "level_route": 4, "alert": 18, "import_batch": 6,
    "report_monthly": 5, "wartime_task": 20, "responder": 26, "sys_role": 9,
    "sys_account": 47, "perm": 48, "role_perm": 106, "field_policy": 9,
    "dict_type": 13, "dict_item": 124, "system_param": 7, "rule": 13,
    "dq_rule": 6, "security_event": 6, "town": 20, "village": 108,
    "tag_dict": 11, "level_dict": 5, "dept": 5, "wt_level": 3,
}

_DATE_RE = re.compile(r"^(\d{4})-(\d{2})-(\d{2})$")
_TS_RE = re.compile(r"^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})")
_MD_RE = re.compile(r"^(\d{2})-(\d{2})\s+(\d{2}):(\d{2})$")


def pdate(v) -> date | None:
    if not v:
        return None
    m = _DATE_RE.match(str(v).strip())
    return date(int(m.group(1)), int(m.group(2)), int(m.group(3))) if m else None


def pts(v) -> datetime | None:
    if not v:
        return None
    s = str(v).strip()
    m = _TS_RE.match(s)
    if m:
        return datetime(*(int(x) for x in m.groups()))
    m = _MD_RE.match(s)
    if m:
        mm, dd, hh, mi = (int(x) for x in m.groups())
        return datetime(DEMO_YEAR, mm, dd, hh, mi)
    d = pdate(s)
    return datetime(d.year, d.month, d.day) if d else None


def load(name: str) -> list[dict]:
    f = SEED_DIR / f"{name}.json"
    if not f.exists():
        raise SystemExit(f"缺少种子文件：{f}\n先执行 node backend/tools/export_seed.js")
    return json.loads(f.read_text(encoding="utf-8"))


def rows(name: str) -> list[dict]:
    return load(name)


def truncate(session) -> None:
    session.execute(text("SET session_replication_role = 'replica'"))  # 关外键校验，避免清空顺序纠结
    for t in TRUNCATE_ORDER:
        session.execute(text(f"TRUNCATE TABLE {t} RESTART IDENTITY CASCADE"))
    session.execute(text("SET session_replication_role = 'origin'"))


def seed(session) -> dict[str, int]:
    counts: dict[str, int] = {}

    def put(model, items: list[dict]) -> None:
        # 逐表 flush：外键依赖靠插入顺序保证（Alert → Person 这类没有 relationship 的引用
        # 不写 flush 时，UOW 的排序不保证先插 person）
        session.add_all([model(**it) for it in items])
        session.flush()
        counts[model.__tablename__] = len(items)

    # --- 字典 ---
    put(Dept, rows("dept"))
    put(LevelDict, rows("level_dict"))
    put(TagDict, rows("tag_dict"))
    towns = rows("town")
    put(Town, [{k: v for k, v in t.items() if k != "villages"} for t in towns])
    put(Village, [{"code": v["code"], "town_code": v["town"], "name": v["name"]} for v in rows("village")])
    put(WtLevel, rows("wt_level"))

    # --- 人员（tags 拆到 person_tag） ---
    persons = rows("person")
    put(Person, [{
        "id": p["id"], "no": p["no"], "name": p["name"], "gender": p["gender"],
        "birth": pdate(p["birth"]), "id_no": p["id_no"], "phone": p["phone"],
        "town_code": p["town"], "village": p["village"], "addr": p["addr"],
        "primary_dept_id": p["primary_dept"], "dept_raw": p["dept_raw"],
        "level": p["level"], "source": p["source"], "status": p["status"],
        "since": p["since"], "watch": p["watch"], "no_basis": p["no_basis"],
        "last_visit": pdate(p["last_visit"]), "officer": p["officer"],
        "officer_title": p["officer_title"], "is_unrated": p["is_unrated"],
    } for p in persons])
    # 预警 / 变动可能指向未建明细的人员（中/低风险两档只有计数），
    # 外键有值才落 person_id，否则留 person_ref 追溯，不为外键去造 4,930 行假数据
    known = {p["id"] for p in persons}
    put(PersonTag, rows("person_tag"))
    put(DualConfirm, [{"person_id": d["person_id"], "dept_id": d["dept"],
                       "marked_at": d["marked_at"], "by": d["by"], "note": d["note"]}
                      for d in rows("dual_confirm")])

    # --- 走访 ---
    put(Visit, [{**v, "date": pdate(v["date"])} for v in rows("visit")])

    # --- 等级变动（无审批字段） ---
    put(LevelChange, [{
        "id": c["id"],
        "person_id": c["person_id"] if c["person_id"] in known else None,
        "name": c["name"],
        "town_code": c["town"], "dept_id": c["dept_id"], "from_level": c["from_level"],
        "to_level": c["to_level"], "reason": c["reason"], "rule_label": c["rule_label"],
        "approver": c["approver"], "occurred_at": pts(c["occurred_at"]),
        "status": c["status"], "notified": c["notified"], "notified_at": pts(c["notified_at"]),
    } for c in rows("level_change")])
    put(LevelRoute, rows("level_route"))

    # --- 预警 / 导入 / 报送 ---
    put(Alert, [{
        "id": a["id"], "rule_code": a["rule_code"], "urgency": a["urgency"],
        "person_id": a["person_id"] if a["person_id"] in known else None,
        "person_ref": a["person_id"], "person_name": a["person_name"],
        "town_code": a["town"], "level_name": a["level_name"], "metric": a["metric"],
        "dept_id": a["dept_id"], "owner": a["owner"], "desc": a["desc"],
        "created_at": pts(a["created_at"]), "status": a["status"],
    } for a in rows("alert")])
    put(ImportBatch, [{**b, "time": pts(b["time"])} for b in rows("import_batch")])
    put(ReportMonthly, [{"month": r["month"], "dept_id": r["dept_id"], "should": r["should"],
                         "real": r["real"], "late": r["late"], "prev_should": r["prev_should"],
                         "prev_real": r["prev_real"], "prev_late": r["prev_late"],
                         "note": r["note"]} for r in rows("report_monthly")])

    # --- 重点时期 ---
    put(WartimePeriod, [{"id": w["id"], "title": w["title"], "name": w["name"],
                         "start": pdate(w["start"]), "end": pdate(w["end"]),
                         "level_key": w["level_key"], "cfg": w["cfg"], "active": w["active"]}
                        for w in rows("wartime_period")])
    put(WartimeTask, [{"period_id": t["period_id"], "town_code": t["town"], "should": t["should"],
                       "met": t["met"], "missing": t["missing"], "officer": t["officer"]}
                      for t in rows("wartime_task")])

    # --- 责任人 / 权限 / 账号 / 字段策略 ---
    put(Responder, rows("responder"))
    put(SysRole, rows("sys_role"))
    put(SysAccount, rows("sys_account"))
    put(Perm, rows("perm"))
    put(RolePerm, rows("role_perm"))
    put(FieldPolicy, rows("field_policy"))

    # --- 字典 / 参数 / 规则 / 安全事件 ---
    put(DictType, rows("dict_type"))
    put(DictItem, rows("dict_item"))
    put(SystemParam, rows("system_param"))
    put(Rule, rows("rule"))
    put(DqRule, rows("dq_rule"))
    put(SecurityEvent, rows("security_event"))

    # --- 指标快照 ---
    snaps = rows("metric_snapshot")
    put(MetricSnapshot, snaps)

    session.commit()
    return counts


def create_schema() -> None:
    Base.metadata.create_all(engine)
    with engine.begin() as conn:
        for sql in VIEWS_SQL:
            conn.execute(text(sql))


def verify(session) -> int:
    """行数对账 + 口径对账。返回失败项数量。"""
    bad = 0
    for table, want in EXPECT.items():
        got = session.execute(text(f"SELECT count(*) FROM {table}")).scalar_one()
        flag = "OK " if got == want else "FAIL"
        if got != want:
            bad += 1
        print(f"  [{flag}] {table:<16} {got:>6} / 期望 {want}")

    v = session.execute(text("SELECT dual_n, cross_n, inter, uni FROM v_dual_cross")).one()
    print(f"  [{'OK ' if v.inter == 50 else 'FAIL'}] 双在册交叉 {v.inter} / 期望 50 "
          f"（双在册 {v.dual_n} · 跨部门 {v.cross_n} · 并集 {v.uni}）")
    bad += 0 if v.inter == 50 else 1

    prim = dict(session.execute(text(
        "SELECT dept_id, persons FROM v_dept_stats WHERE scope='primary' AND NOT is_unrated")).all())
    tag = dict(session.execute(text(
        "SELECT dept_id, persons FROM v_dept_stats WHERE scope='tag' AND NOT is_unrated")).all())
    print(f"  [{'OK ' if prim.get('公安分局') == 190 else 'FAIL'}] 主责口径 公安分局 {prim.get('公安分局')} / 期望 190")
    print(f"  [{'OK ' if tag.get('公安分局') == 246 else 'FAIL'}] 标签口径 公安分局 {tag.get('公安分局')} / 期望 246")
    bad += (prim.get("公安分局") != 190) + (tag.get("公安分局") != 246)

    multi = session.execute(text(
        "SELECT count(*) FROM (SELECT person_id FROM person_tag GROUP BY 1 "
        "HAVING count(DISTINCT dept_id) > 1) t")).scalar_one()
    print(f"  [{'OK ' if multi == 168 else 'FAIL'}] 跨部门共管 {multi} / 期望 168")
    bad += 0 if multi == 168 else 1

    dual = session.execute(text("SELECT count(DISTINCT person_id) FROM dual_confirm")).scalar_one()
    print(f"  [{'OK ' if dual == 127 else 'FAIL'}] 双在册 {dual} / 期望 127")
    bad += 0 if dual == 127 else 1

    lc = session.execute(text("SELECT count(*) FROM level_change WHERE status='已生效'")).scalar_one()
    print(f"  [{'OK ' if lc == 46 else 'FAIL'}] 等级变动（已生效）{lc} / 期望 46")
    bad += 0 if lc == 46 else 1
    return bad


def main() -> None:
    create_schema()
    if "--verify" in sys.argv:
        with SessionLocal() as s:
            bad = verify(s)
        print("\n对账结果：" + ("全部通过" if bad == 0 else f"{bad} 项不一致"))
        raise SystemExit(1 if bad else 0)

    with SessionLocal() as s:
        truncate(s)
        s.commit()
        counts = seed(s)
        print(f"导入完成：{len(counts)} 张表")
        bad = verify(s)
    print("\nB2 结果：" + ("行数与口径全部对上" if bad == 0 else f"{bad} 项不一致"))
    raise SystemExit(1 if bad else 0)


if __name__ == "__main__":
    main()
