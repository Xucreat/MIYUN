"""B3 只读 API 自检：用 FastAPI TestClient 打一遍，断言与前端口径一致。

不需要起服务（TestClient 进程内跑），但**需要数据库已灌种子**。
用法：cd backend && python -m tools.api_checks
"""
from __future__ import annotations

import sys

from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)
fail = 0


def ok(cond: bool, msg: str) -> None:
    global fail
    print(("  PASS " if cond else "  FAIL ") + msg)
    if not cond:
        fail += 1


def main() -> None:
    print("\n[A] 基础")
    h = client.get("/api/health").json()
    ok(h.get("ok") is True, f"health ok，persons = {h.get('persons')}")
    ok(h.get("persons") == 1098, f"明细行数 1098（实际 {h.get('persons')}）")

    print("\n[B] 统计口径（必须与前端 DATA.stats 逐项相等）")
    s = client.get("/api/stats/overview").json()
    expect = {"inRegister": 6028, "highPlus": 486, "high2": 44, "mid": 2284, "low": 2646,
              "unknown": 612, "dual": 127, "multi": 214, "multi2": 186, "multi3": 28,
              "noBasis": 358, "noVisit30": 213, "ledgerRecords": 7112}
    for k, v in expect.items():
        ok(s[k] == v, f"{k} = {s[k]}（期望 {v}）")
    ok(s["detail"]["high_detail"] == 486, f"高风险明细 486（实际 {s['detail']['high_detail']}）")
    ok(s["detail"]["unrated_detail"] == 612, f"待核实明细 612（实际 {s['detail']['unrated_detail']}）")

    print("\n[C] 部门两套口径（裁决 B1）与双在册关系（裁决 A1）")
    d = client.get("/api/stats/dept").json()
    prim = {r["dept_id"]: r["persons"] for r in d["primary"]}
    tag = {r["dept_id"]: r["persons"] for r in d["tag"]}
    ok(prim.get("公安分局") == 190, f"主责 公安分局 190（实际 {prim.get('公安分局')}）")
    ok(prim.get("区司法局") == 125, f"主责 区司法局 125（实际 {prim.get('区司法局')}）")
    ok(sum(prim.values()) == 486, f"主责合计 486（实际 {sum(prim.values())}）")
    ok(tag.get("公安分局") == 246, f"标签 公安分局 246（实际 {tag.get('公安分局')}）")
    ok(d["personTimes"] == 667, f"标签合计 667 人次（实际 {d['personTimes']}）")
    ok(d["multiPersons"] == 168, f"跨部门共管 168（实际 {d['multiPersons']}）")
    ok(d["dual"]["intersection"] == 50, f"双在册 ∩ 跨部门 = 50（实际 {d['dual']['intersection']}）")
    ok(d["dual"]["union"] == 245, f"并集 = 245（实际 {d['dual']['union']}）")

    print("\n[D] 人员台账筛选（主责 vs 标签两个口径不可混用）")
    p_dept = client.get("/api/persons", params={"dept": "公安分局", "unrated": "false", "size": 1}).json()
    ok(p_dept["total"] == 190, f"?dept=公安分局&unrated=false → 190（实际 {p_dept['total']}）")
    p_tag = client.get("/api/persons", params={"deptTag": "公安分局", "unrated": "false", "size": 1}).json()
    ok(p_tag["total"] == 246, f"?deptTag=公安分局&unrated=false → 246（实际 {p_tag['total']}）")
    p_all = client.get("/api/persons", params={"dept": "公安分局", "size": 1}).json()
    ok(p_all["total"] > 190, f"不带 unrated 参数 → 全量 {p_all['total']} 条（应大于 190，含待核实）")
    both = client.get("/api/persons", params={"deptTag": "公安分局,区司法局", "unrated": "false", "size": 1}).json()
    ok(both["total"] > 0 and both["total"] < 246, f"?deptTag=A,B → AND 语义 {both['total']} 条（<246）")
    hr = client.get("/api/persons", params={"level": "high,high2", "size": 1}).json()
    ok(hr["total"] == 486, f"?level=high,high2 → 486（实际 {hr['total']}）")
    un = client.get("/api/persons", params={"unrated": "true", "size": 1}).json()
    ok(un["total"] == 612, f"?unrated=true → 612（实际 {un['total']}）")

    print("\n[E] 一人一档")
    pid = client.get("/api/persons", params={"size": 1}).json()["items"][0]["id"]
    p = client.get(f"/api/persons/{pid}").json()
    ok(p["id"] == pid and p["tags"] is not None, f"{pid} 详情返回，标签 {p['tags']}")
    ok(len(p["visits"]) == 6, f"走访 6 条（实际 {len(p['visits'])}）")
    ok(isinstance(p["levelChanges"], list), f"等级变动 {len(p['levelChanges'])} 条")
    ok(client.get("/api/persons/NOPE").status_code == 404, "不存在的人员返回 404")

    print("\n[F] 等级变动台账")
    lc = client.get("/api/level-changes", params={"size": 200}).json()
    ok(lc["total"] == 46, f"台账 46 条（实际 {lc['total']}）")
    ok(lc["upDown"]["up"] == 22 and lc["upDown"]["down"] == 24,
       f"上调 22 / 下调 24（实际 {lc['upDown']['up']}/{lc['upDown']['down']}）")
    ok(all(i["status"] == "已生效" for i in lc["items"]), "全部为「已生效」（无审批状态位）")

    print("\n[G] 预警与配置")
    al = client.get("/api/alerts").json()
    ok(al["total"] == 18, f"预警 18 条（实际 {al['total']}）")
    ok(al["stats"]["open"] == 18, f"待处置 18（实际 {al['stats']['open']}）")
    ok(len(client.get("/api/towns").json()) == 20, "20 个镇街")
    ok(len(client.get("/api/dicts").json()) == 13, "13 部字典")
    ok(len(client.get("/api/rules").json()["routes"]) == 4, "定级流程 4 档")
    r = client.get("/api/roles").json()
    ok(r["permTotal"] == 48, f"权限位 48（实际 {r['permTotal']}）")
    ok(len(r["roles"]) == 9, f"角色 9 个（实际 {len(r['roles'])}）")

    print(f"\n===== 失败项 {fail} =====")
    raise SystemExit(1 if fail else 0)


if __name__ == "__main__":
    sys.exit(main())
