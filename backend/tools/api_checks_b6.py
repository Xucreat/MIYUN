"""B6 自检：走访读端 `GET /api/visits` + 写→读往返。

要证明的缺陷（B5 遗留）：
    走访登记能写进 `visit` 表，但没有读端 → 页面刷新后只能回落到本地生成的历史走访，
    表现为「登记成功、刷新看不见」。B6 加了 /visits 读端，本文件就是它的回归。

与其它脚本的分工：
- `api_checks.py`（B3，45 条）：口径没漂；
- `api_checks_b4.py`（B4，74 条）：越权被拒 + 掩码 + 审计；
- 本文件（B6）：走访读端的权限 / 范围 / 往返，**不需要浏览器**。

写操作会改库，跑完整体还原（新插的 visit 按 id 差集删除、person.last_visit 回滚）。
用法：cd backend && python -m tools.api_checks_b6
"""
from __future__ import annotations

from fastapi.testclient import TestClient
from sqlalchemy import text

from app.config import settings
from app.db import SessionLocal
from app.main import app

client = TestClient(app)
db = SessionLocal()
fail = 0
total = 0
SNAP: dict = {}


def ok(cond: bool, msg: str) -> None:
    global fail, total
    total += 1
    print(("  PASS " if cond else "  FAIL ") + msg)
    if not cond:
        fail += 1


def login(account: str) -> str:
    r = client.post("/api/auth/login", json={"account": account,
                                             "password": settings.demo_password})
    r.raise_for_status()
    return r.json()["token"]


def hdr(tok: str) -> dict:
    return {"Authorization": f"Bearer {tok}"}


def q(sql: str, **p):
    return db.execute(text(sql), p).fetchall()


def scalar(sql: str, **p):
    return db.execute(text(sql), p).scalar_one_or_none()


def snapshot() -> None:
    SNAP["visit_ids"] = {r[0] for r in q("SELECT id FROM visit")}
    SNAP["p0433"] = q("SELECT last_visit FROM person WHERE id = 'P0433'")[0][0]
    SNAP["audit_max"] = scalar("SELECT COALESCE(max(id), 0) FROM audit_log")


def restore() -> None:
    for vid in {r[0] for r in q("SELECT id FROM visit")} - SNAP["visit_ids"]:
        db.execute(text("DELETE FROM visit WHERE id = :i"), {"i": vid})
    db.execute(text("UPDATE person SET last_visit = :v WHERE id = 'P0433'"), {"v": SNAP["p0433"]})
    db.execute(text("DELETE FROM audit_log WHERE id > :m"), {"m": SNAP["audit_max"]})
    db.commit()


def main() -> None:
    snapshot()
    try:
        run()
    finally:
        restore()
        verify_restored()
    print(f"\n===== 断言 {total} 条，失败 {fail} =====")
    raise SystemExit(1 if fail else 0)


def verify_restored() -> None:
    print("\n[D] 还原校验")
    db.expire_all()
    n_p0433 = scalar("SELECT count(*) FROM visit WHERE person_id = :p", p="P0433")
    ok(scalar("SELECT count(*) FROM visit") == 2916,
       f"visit 回到 2916 行（实际 {scalar('SELECT count(*) FROM visit')}）")
    ok(n_p0433 == 6, f"P0433 回到 6 条（实际 {n_p0433}）")
    ok(q("SELECT last_visit FROM person WHERE id = 'P0433'")[0][0] == SNAP["p0433"],
       f"P0433.last_visit 回滚为 {SNAP['p0433']}")


def run() -> None:
    print("[A] 权限：visit:view 有/无")
    r1, r2, r4, r5, r7 = (login(a) for a in
                          ("liguodong", "chenzhiyuan", "liqiang", "wanghf", "liujg"))
    r = client.get("/api/visits", headers=hdr(r1))
    ok(r.status_code == 403, f"R1（区委书记/区长）无 visit:view → 403（实际 {r.status_code}）")
    r = client.get("/api/visits", headers=hdr(r7))
    ok(r.status_code == 403, f"R7（三员分立）无业务数据权限 → 403（实际 {r.status_code}）")

    print("\n[B] 范围：条数随身份收敛")
    expect = {"R2": 2916, "R4": 1140, "R5": 156}
    got = {}
    for k, tok in (("R2", r2), ("R4", r4), ("R5", r5)):
        d = client.get("/api/visits", headers=hdr(tok), params={"size": 1}).json()
        got[k] = d["total"]
        ok(d["total"] == expect[k], f"{k} 可见走访 {d['total']} 条（期望 {expect[k]}）")
    d = client.get("/api/visits", headers=hdr(r4), params={"size": 200}).json()
    bad = [i for i in d["items"]
           if i["personId"] not in {row[0] for row in q(
               "SELECT id FROM person WHERE primary_dept_id = :d", d="公安分局")}]
    ok(not bad, f"R4 出参全部落在公安分局（越界 {len(bad)} 条）")
    d5 = client.get("/api/visits", headers=hdr(r5), params={"size": 200}).json()
    towns = {row[0] for row in q("SELECT id FROM person WHERE town_code = :t", t="溪翁庄镇")}
    ok(all(i["personId"] in towns for i in d5["items"]),
       f"R5 出参全部落在溪翁庄镇（抽查 {len(d5['items'])} 条）")

    print("\n[C] 写 → 读往返：登记一条，立刻能在读端取到（且只一条）")
    marker = "B6 往返验证 · 入库即可读"
    before = client.get("/api/visits", headers=hdr(r2),
                        params={"personId": "P0433", "size": 50}).json()["total"]
    r = client.post("/api/persons/P0433/visits", headers=hdr(r2),
                    json={"way": "入户走访", "result": marker, "date": "2026-11-18"})
    ok(r.status_code == 200 and (r.json().get("visit") or {}).get("id"), "登记走访 → 200 且回传服务端 id")
    new_id = (r.json().get("visit") or {}).get("id")
    d = client.get("/api/visits", headers=hdr(r2),
                   params={"personId": "P0433", "size": 50}).json()
    hits = [i for i in d["items"] if i["result"] == marker]
    ok(d["total"] == before + 1, f"该人走访 {before} → {d['total']}（读端立刻可见）")
    ok(len(hits) == 1 and hits[0]["id"] == new_id,
       f"命中 1 条且 id = {new_id}（实际 {len(hits)} 条：{[h['id'] for h in hits]}）")
    ok(hits and hits[0]["by"], f"走访人由服务端填（{hits[0]['by'] if hits else '—'}）")
    ok(scalar("SELECT last_visit FROM person WHERE id = 'P0433'") is not None,
       "person.last_visit 同时被回写（档案页「最近走访」跟着动）")
    # 排序：新登记日期 2026-11-18 应排在最前（date DESC）
    ok(d["items"][0]["id"] == new_id, f"读端按 date DESC，新登记排在首位（实际 {d['items'][0]['id']}）")

    print("\n[C2] 重复登记不去重（同一天同人两次都要留痕）")
    r = client.post("/api/persons/P0433/visits", headers=hdr(r2),
                    json={"way": "入户走访", "result": marker, "date": "2026-11-18"})
    ok(r.status_code == 200, "第二次登记同样 200（不因同日同内容去重）")
    d = client.get("/api/visits", headers=hdr(r2),
                   params={"personId": "P0433", "size": 50}).json()
    ok(len([i for i in d["items"] if i["result"] == marker]) == 2,
       f"两条都留存（实际 {len([i for i in d['items'] if i['result'] == marker])} 条）")

    print("\n[E] alert.dept_raw：责任单位原文入库（B6-2，零前端依赖）")
    d = client.get("/api/alerts", headers=hdr(r2), params={"size": 200}).json()
    items = d["items"]
    ok(len(items) == 18, f"18 条预警（实际 {len(items)}）")
    ok(all(a.get("deptRaw") for a in items),
       f"每条都带 deptRaw（实际 {sum(1 for a in items if a.get('deptRaw'))}/{len(items)}）")
    mapped = [a for a in items if a.get("dept")]
    ok(len(mapped) == 5 and all(a["deptRaw"] == a["dept"] for a in mapped),
       f"dept_id 可映射的 {len(mapped)} 条：deptRaw 与 dept_id 同值（区级部门名）")
    orphan = [a for a in items if not a.get("dept")]
    ok(len(orphan) == 13 and all(a.get("deptRaw") for a in orphan),
       f"dept_id 为空的 {len(orphan)} 条（镇街综治中心）原文仍在 —— 外键映射不上不等于没有责任单位")
    ok(scalar("SELECT count(*) FROM alert WHERE dept_raw IS NULL") == 0,
       "库里 dept_raw 无 NULL（迁移 + 重灌后应全量有值）")


if __name__ == "__main__":
    main()
