"""B4 自检：鉴权 / 权限门控 / 数据范围 / 服务端掩码 / 写 API / 服务端审计。

与 `tools/api_checks.py`（B3 口径回归，45 条）互补：
- B3 那份证明「加了鉴权后数字没漂」，用 R2 全区账号跑；
- 本文件证明「越权真的被服务端拒」，用 9 个角色账号逐一试。

写操作会改库，因此**每步都记录前值并在最后整体还原**，跑完 `app.seed --verify` 仍应全绿。

用法：cd backend && python -m tools.api_checks_b4
"""
from __future__ import annotations

import sys

from fastapi.testclient import TestClient
from sqlalchemy import text

from app.config import settings
from app.db import SessionLocal
from app.main import app

client = TestClient(app)
fail = 0
total = 0
db = SessionLocal()

# 清理用：记录写库前状态
SNAP: dict = {}


def ok(cond: bool, msg: str) -> None:
    global fail, total
    total += 1
    print(("  PASS " if cond else "  FAIL ") + msg)
    if not cond:
        fail += 1


def login(account: str, password: str | None = None) -> dict:
    r = client.post("/api/auth/login", json={"account": account,
                                             "password": password or settings.demo_password})
    return {"code": r.status_code, "body": r.json(), "token": r.json().get("token")}


def hdr(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def q(sql: str, **p):
    return db.execute(text(sql), p).fetchall()


def scalar(sql: str, **p):
    return db.execute(text(sql), p).scalar_one_or_none()


def snapshot() -> None:
    SNAP["lc_ids"] = {r[0] for r in q("SELECT id FROM level_change")}
    SNAP["visit_ids"] = {r[0] for r in q("SELECT id FROM visit")}
    SNAP["audit_max"] = scalar("SELECT COALESCE(max(id), 0) FROM audit_log")
    SNAP["audit_count"] = scalar("SELECT count(*) FROM audit_log")
    SNAP["persons"] = {r[0]: (r[1], r[2]) for r in
                       q("SELECT id, level, last_visit FROM person WHERE id IN "
                         "('P0102', 'P0576', 'P0105')")}
    SNAP["alerts"] = {r[0]: r[1] for r in q("SELECT id, status FROM alert")}


def restore() -> None:
    for pid, (level, last_visit) in SNAP["persons"].items():
        db.execute(text("UPDATE person SET level = :l, last_visit = :v WHERE id = :i"),
                   {"l": level, "v": last_visit, "i": pid})
    for aid, status in SNAP["alerts"].items():
        db.execute(text("UPDATE alert SET status = :s WHERE id = :i"), {"s": status, "i": aid})
    for lid in {r[0] for r in q("SELECT id FROM level_change")} - SNAP["lc_ids"]:
        db.execute(text("DELETE FROM level_change WHERE id = :i"), {"i": lid})
    for vid in {r[0] for r in q("SELECT id FROM visit")} - SNAP["visit_ids"]:
        db.execute(text("DELETE FROM visit WHERE id = :i"), {"i": vid})
    db.execute(text("DELETE FROM audit_log WHERE id > :m"), {"m": SNAP["audit_max"]})
    db.commit()


def main() -> None:
    snapshot()
    try:
        _run()
    finally:
        restore()
        _verify_restored()
    print(f"\n===== 断言 {total} 条，失败 {fail} =====")
    raise SystemExit(1 if fail else 0)


def _verify_restored() -> None:
    print("\n[I] 还原校验（跑完应与 B3 种子状态一致）")
    db.expire_all()
    n_lc = scalar("SELECT count(*) FROM level_change")
    n_audit = scalar("SELECT count(*) FROM audit_log")
    n_h2 = scalar("SELECT count(*) FROM person WHERE level = 'high2'")
    n_open = scalar("SELECT count(*) FROM alert WHERE status = '待处置'")
    ok(n_lc == 46, f"level_change 回到 46（实际 {n_lc}）")
    ok(n_audit == SNAP["audit_count"],
       f"audit_log 回到跑测前（实际 {n_audit}，期望 {SNAP['audit_count']}；含 B3 自检留下的登录行）")
    ok(n_h2 == 44, f"极高风险回到 44（实际 {n_h2}）")
    ok(n_open == 18, f"预警待处置回到 18（实际 {n_open}）")


def _run() -> None:
    print("\n[A] 鉴权：没有令牌一律 401")
    r = client.get("/api/persons")
    ok(r.status_code == 401, f"无令牌访问 /api/persons → 401（实际 {r.status_code}）")
    ok(r.json()["detail"]["code"] == "unauthorized", "401 错误体 code=unauthorized")
    bad = login("chenzhiyuan", "wrong-password")
    ok(bad["code"] == 401, f"错误口令 → 401（实际 {bad['code']}）")
    ok(scalar("SELECT count(*) FROM audit_log WHERE act = :a", a="登录失败") >= 1,
       "登录失败已由服务端写入审计（不依赖前端）")

    tok = login("chenzhiyuan")["token"]
    forged = tok[:-3] + ("abc" if not tok.endswith("abc") else "xyz")
    r = client.get("/api/persons", headers=hdr(forged))
    ok(r.status_code == 401, f"篡改签名的令牌 → 401（实际 {r.status_code}）")
    r = client.get("/api/health")
    ok(r.status_code == 200 and "persons" not in r.json(), "health 匿名可用但不暴露台账规模")
    r = client.get("/api/health", headers=hdr(tok))
    ok(r.json().get("persons") == 1098, "health 带令牌可看到 persons = 1098")

    print("\n[B] 9 个角色账号都能登录，身份由服务端判定")
    ACC = {"R1": "liguodong", "R2": "chenzhiyuan", "R3": "zhoumin", "R4": "liqiang",
           "R5": "wanghf", "R6": "wangzg", "R7": "liujg", "R8": "guolx", "R9": "yangfan"}
    TOK: dict[str, str] = {}
    for role, acc in ACC.items():
        res = login(acc)
        ok(res["code"] == 200 and res["body"]["user"]["roleKey"] == role,
           f"{acc} → {role}（实际 {res['code']} / {res['body'].get('user', {}).get('roleKey')}）")
        TOK[role] = res["token"]
    me = client.get("/api/me", headers=hdr(TOK["R2"])).json()["user"]
    ok(len(me["perms"]) == 36, f"R2 权限位 36（实际 {len(me['perms'])}）")
    ok(me["scope"]["kind"] == "all", "R2 数据范围 = all")
    ok(me["fields"]["idNo"] == "申" and me["fields"]["phone"] == "明", "字段密级来自 field_policy 表")

    print("\n[C] 权限门控：越权被服务端拒（403，且请求体不可绕过）")
    r = client.get("/api/persons", headers=hdr(TOK["R7"]))
    ok(r.status_code == 403 and r.json()["detail"]["code"] == "forbidden",
       "R7 系统管理员 访问人员台账 → 403（三员分立，不触业务）")
    r = client.get("/api/persons", headers=hdr(TOK["R9"]))
    ok(r.status_code == 403, "R9 安全审计员 访问人员台账 → 403")
    r = client.get("/api/audit", headers=hdr(TOK["R9"]))
    ok(r.status_code == 200 and r.json()["total"] >= 1, "R9 能查审计日志")
    r = client.get("/api/audit", headers=hdr(TOK["R2"]))
    ok(r.status_code == 403, "R2 查审计日志 → 403（无 sys:audit:view）")
    r = client.get("/api/persons", headers=hdr(TOK["R1"]))
    ok(r.status_code == 200, "R1 可看台账（person:list）")
    r = client.post("/api/level-changes", headers=hdr(TOK["R1"]),
                    json={"personId": "P0102", "to": "high2", "reason": "越权尝试"})
    ok(r.status_code == 403 and "risk:adjust:up" in r.json()["detail"]["need"],
       f"R1 登记等级变动 → 403，缺 risk:adjust:up（实际 {r.status_code}）")

    print("\n[D] 数据范围：由 sys_account.unit 解析，解析不出就拒绝")
    r = client.get("/api/persons", headers=hdr(TOK["R4"]), params={"size": 200})
    body = r.json()
    ok(body["total"] == 435, f"R4 公安分局 仅见 435 人（实际 {body['total']}）")
    ok(all(i["dept"] == "公安分局" for i in body["items"]), "返回行 dept 全为 公安分局")
    ok(body["items"][0]["maskedFields"].get("idNo", {}).get("mode") == "掩",
       "R4 身份证为「掩」（field_policy: R4 idNo=掩）")
    r = client.get("/api/persons", headers=hdr(TOK["R5"]), params={"size": 200})
    ok(r.json()["total"] == 61, f"R5 溪翁庄镇 仅见 61 人（实际 {r.json()['total']}）")
    ok(all(i["town"] == "溪翁庄镇" for i in r.json()["items"]), "返回行 town 全为 溪翁庄镇")
    r = client.get("/api/persons", headers=hdr(TOK["R3"]), params={"size": 1})
    ok(r.json()["total"] == 204, f"R3 区信访办 仅见 204 人（实际 {r.json()['total']}）")
    # 属地账号的单位是「城关派出所」，不是镇街名 → 解析不出 → 必须拒绝，不能放行全区
    zht = login("zhanght")
    r = client.get("/api/persons", headers=hdr(zht["token"]))
    ok(r.status_code == 403 and r.json()["detail"]["code"] == "scope_unresolved",
       f"城关派出所（单位非镇街名）→ 403 scope_unresolved（实际 {r.status_code}）")
    r = client.get("/api/persons/P0105", headers=hdr(TOK["R4"]))
    ok(r.status_code == 403 and r.json()["detail"]["code"] == "out_of_scope",
       "R4 直接按 id 取外部门人员 → 403 out_of_scope")

    print("\n[E] 服务端掩码：库里明文，出网掩码")
    real = scalar("SELECT id_no FROM person WHERE id = :i", i="P0102")
    r = client.get("/api/persons/P0102", headers=hdr(TOK["R1"])).json()
    ok("*" in (r["name"] or "") and "*" in (r["idNo"] or "") and "*" in (r["phone"] or ""),
       f"R1 姓名/证件/电话均掩码（{r['name']} / {r['idNo']} / {r['phone']}）")
    ok(r["idNo"] != real, "出网证件号 ≠ 库内明文（掩码在服务端完成）")
    ok((r["addr"] or "").endswith("****"), f"R1 现住址截断到社区（{r['addr']}）")
    ok(set(r["maskedFields"]) >= {"name", "idNo", "phone", "addr"}, "maskedFields 标明四个字段被掩")
    r2 = client.get("/api/persons/P0102", headers=hdr(TOK["R2"])).json()
    ok(r2["name"] == "赵德海" and r2["phone"] == "13592596364" and "*" not in (r2["addr"] or ""),
       "R2 姓名/电话/住址明文（field_policy: 明）")
    ok("*" in (r2["idNo"] or "") and r2["maskedFields"]["idNo"].get("needApply") is True,
       "R2 身份证为「申」：仍掩码 + needApply=true（B4 未做申请流，宁可少给）")
    r4 = client.get("/api/persons/P0102", headers=hdr(TOK["R4"])).json()
    ok(r4["phone"] == "13592596364" and "*" in (r4["idNo"] or ""), "R4 电话明文、证件掩码")
    lc = client.get("/api/level-changes", headers=hdr(TOK["R1"]))
    ok(lc.status_code == 403 and "risk:history:view" in lc.json()["detail"]["need"],
       "R1 无 risk:history:view → 变动台账 403（会议决议 D4 后仍是「查看调整历史」权限位）")
    lc4 = client.get("/api/level-changes", headers=hdr(TOK["R4"]), params={"size": 200}).json()
    ok(lc4["total"] < 46 and all(i["dept"] == "公安分局" for i in lc4["items"]),
       f"R4 变动台账按部门过滤（{lc4['total']} 条，全部 公安分局）")
    al = client.get("/api/alerts", headers=hdr(TOK["R1"])).json()
    ok(all("*" in (i["who"] or "*") for i in al["items"]), "R1 预警对象姓名同样掩码")

    print("\n[F] 写：登记等级变动（D4 无审批，服务端生成定级责任与登记人）")
    before = client.get("/api/stats/overview", headers=hdr(TOK["R2"])).json()
    r = client.post("/api/level-changes", headers=hdr(TOK["R2"]),
                    json={"personId": "P0102", "to": "high2", "reason": "出现明显被害妄想并拒服药",
                          "rule": "伪造定级责任", "approver": "伪造登记人", "by": "伪造"})
    ok(r.status_code == 200, f"R2 登记 high → high2（实际 {r.status_code} {r.text[:80]}）")
    ch = r.json()["change"]
    ok(ch["status"] == "已生效" and ch["from"] == "high" and ch["to"] == "high2", "台账记录已生效")
    ok(ch["rule"] == "部门集体会商 + 双签", f"定级责任由服务端判定（{ch['rule']}）")
    ok(ch["approver"].startswith("王立"), f"登记人=部门主管姓名+责任后缀（{ch['approver']}）")
    ok("伪造" not in str(ch), "请求体里的 rule/approver/by 全部被忽略")
    ok(scalar("SELECT level FROM person WHERE id = :i", i="P0102") == "high2", "档案等级已同步")
    after = client.get("/api/stats/overview", headers=hdr(TOK["R2"])).json()
    ok(after["high2"] == before["high2"] + 1, f"极高风险实时 +1（{before['high2']} → {after['high2']}）")
    ok(after["highPlus"] == before["highPlus"], "高及以上总数不变（high→high2 仍在档内）")
    need = client.post("/api/level-changes", headers=hdr(TOK["R2"]),
                       json={"personId": "P0102", "to": "high2", "reason": "重复"})
    ok(need.status_code == 400 and need.json()["detail"]["code"] == "level_unchanged", "同级变动 → 400")
    bad = client.post("/api/level-changes", headers=hdr(TOK["R2"]),
                      json={"personId": "P0102", "to": "nope", "reason": "瞎填"})
    ok(bad.status_code == 400 and bad.json()["detail"]["code"] == "bad_level", "未知等级 → 400")
    down = client.post("/api/level-changes", headers=hdr(TOK["R4"]),
                       json={"personId": "P0102", "to": "mid", "reason": "R4 无下调权限"})
    ok(down.status_code == 403 and "risk:adjust:down" in down.json()["detail"]["need"],
       "R4 只有 risk:adjust:up → 下调被拒（403）")
    out = client.post("/api/level-changes", headers=hdr(TOK["R4"]),
                      json={"personId": "P0105", "to": "high2", "reason": "跨部门尝试"})
    ok(out.status_code == 403 and out.json()["detail"]["code"] == "out_of_scope",
       "R4 给外部门人员登记 → 403 out_of_scope")

    print("\n[G] 写：走访登记（属地经办主场景）")
    v_before = scalar("SELECT count(*) FROM visit WHERE person_id = :p", p="P0576")
    r = client.post("/api/persons/P0576/visits", headers=hdr(TOK["R5"]),
                    json={"way": "入户走访", "result": "情况稳定，已落实监护"})
    ok(r.status_code == 200, f"R5 对本镇人员登记走访（实际 {r.status_code} {r.text[:80]}）")
    ok(scalar("SELECT count(*) FROM visit WHERE person_id = :p", p="P0576") == v_before + 1,
       "走访记录 +1")
    ok(str(scalar("SELECT last_visit FROM person WHERE id = :i", i="P0576")) >= "2026-11-01",
       "档案 last_visit 已前滚")
    r = client.post("/api/persons/P0105/visits", headers=hdr(TOK["R5"]),
                    json={"way": "入户走访", "result": "越界"})
    ok(r.status_code == 403, "R5 给辖区外人员登记走访 → 403")
    r = client.post("/api/persons/P0576/visits", headers=hdr(TOK["R6"]),
                    json={"way": "入户走访", "result": "R6 无 visit:create"})
    ok(r.status_code == 403, "R6 属地负责人 无 visit:create → 403")

    print("\n[H] 写：预警处置 + 服务端审计")
    open_a = q("SELECT id FROM alert WHERE status = '待处置' ORDER BY id DESC LIMIT 1")[0][0]
    r = client.post(f"/api/alerts/{open_a}/dispose", headers=hdr(TOK["R2"]),
                    json={"status": "已处置", "note": "已电话核实并补录走访"})
    ok(r.status_code == 200 and r.json()["alert"]["status"] == "已处置", f"R2 处置预警 {open_a} 成功")
    outside = q("""SELECT a.id FROM alert a JOIN person p ON p.id = a.person_id
                    WHERE p.primary_dept_id <> '公安分局' AND a.status = '待处置'
                    ORDER BY a.id LIMIT 1""")
    if outside:
        r = client.post(f"/api/alerts/{outside[0][0]}/dispose", headers=hdr(TOK["R4"]),
                        json={"status": "已处置", "note": "跨范围"})
        ok(r.status_code == 403, f"R4 处置外部门预警 {outside[0][0]} → 403")
    else:
        ok(False, "找不到外部门预警用于范围测试")
    rows = {r0[0]: r0[1] for r0 in q("SELECT act, \"by\" FROM audit_log WHERE id > :m",
                                     m=SNAP["audit_max"])}
    ok("登记等级变动" in rows, "写 API 自动落审计：登记等级变动")
    ok("走访登记" in rows, "写 API 自动落审计：走访登记")
    ok("预警处置" in rows, "写 API 自动落审计：预警处置")
    ok(all(v for v in rows.values()), "审计 by 全部非空（服务端填身份）")
    last = q("SELECT \"by\", role, ip, mode FROM audit_log ORDER BY id DESC LIMIT 1")[0]
    ok(last[0] == "陈志远" and last[1].startswith("R2") and last[2] in ("testclient", "127.0.0.1"),
       f"审计含 by/role/ip（{last[0]} / {last[1]} / {last[2]}）")
    r = client.post("/api/audit", headers=hdr(TOK["R1"]),
                    json={"act": "导出台账", "target": "台账导出", "detail": "R1 脱敏导出 486 条",
                          "by": "陈志远", "role": "R2"})
    ok(r.status_code == 200 and r.json()["by"] == "李国栋",
       f"前端上报审计时伪造 by 无效（落库 {r.json().get('by')}）")
    r = client.post("/api/audit", headers=hdr(TOK["R1"]), json={"act": "等级变更", "detail": "x"})
    ok(r.status_code == 400 and r.json()["detail"]["code"] == "act_not_allowed",
       "写类动作不许前端上报审计（400）")
    r = client.get("/api/audit", headers=hdr(TOK["R9"]), params={"act": "登记等级变动"})
    ok(r.json()["total"] >= 1, "R9 能按动作检索审计")


if __name__ == "__main__":
    sys.exit(main())
