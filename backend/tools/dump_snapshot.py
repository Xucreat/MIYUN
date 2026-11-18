"""B5 快照导出：按 assets/api.js 的 sync() 逻辑，把同一份快照落到本地文件。

为什么要这个脚本：沙箱内浏览器访问不到 127.0.0.1 的 HTTP 服务，
但 B5 要验证的其实是「服务端载荷 → DATA.hydrate 映射 → 页面数字」这一段，
所以用 TestClient 进程内取数、写快照，再由前端冒烟脚本把它塞进 sessionStorage 就能验。

用法：cd backend && python -m tools.dump_snapshot [账号] [输出路径]
默认账号 chenzhiyuan（R2 政法委主管，全区全字段）。
"""
from __future__ import annotations

import json
import sys
from datetime import datetime, timezone, timedelta
from pathlib import Path

from fastapi.testclient import TestClient

from app.main import app
from app.config import settings

client = TestClient(app)
ACCOUNT = sys.argv[1] if len(sys.argv) > 1 else "chenzhiyuan"
OUT = Path(sys.argv[2]) if len(sys.argv) > 2 else Path("../docs/prototype-v2/tools/snapshot-r2.json")


def paged(path: str, token: str) -> list[dict]:
    out: list[dict] = []
    page = 1
    while True:
        r = client.get(path, headers={"Authorization": f"Bearer {token}"},
                       params={"page": page, "size": 200})
        if r.status_code in (401, 403):
            # 该角色没有这个权限（如 R1 无 risk:history:view / R7-R9 无业务数据权限）：
            # 快照里留空，前端会保留本地演示数据 —— 这本身就是权限生效的证据。
            print(f"[snapshot] {path} → {r.status_code}，该角色无此权限，留空")
            return out
        r.raise_for_status()
        d = r.json()
        items = d.get("items") or []
        out.extend(items)
        if not items or len(out) >= (d.get("total") or 0) or page >= 40:
            return out
        page += 1


def main() -> None:
    r = client.post("/api/auth/login", json={"account": ACCOUNT})
    r.raise_for_status()
    token = r.json()["token"]
    hdr = {"Authorization": f"Bearer {token}"}

    me = client.get("/api/me", headers=hdr)
    me.raise_for_status()
    me = me.json()
    rs = client.get("/api/stats/overview", headers=hdr)
    if rs.status_code in (401, 403):
        print(f"[snapshot] /stats/overview → {rs.status_code}，该角色无 dashboard:view，statistics 留空")
        stats = {}
    else:
        rs.raise_for_status()
        stats = rs.json()
    persons = paged("/api/persons", token)
    changes = paged("/api/level-changes", token)
    alerts = paged("/api/alerts", token)

    snap = {
        "v": 1,
        "at": datetime.now(timezone(timedelta(hours=8))).isoformat(timespec="seconds"),
        "base": "http://127.0.0.1:8001/api",
        "district": settings.demo_district,
        "user": me["user"],
        "stats": stats,
        "persons": persons,
        "changes": changes,
        "alerts": alerts,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(snap, ensure_ascii=False), encoding="utf-8")

    rated = [p for p in persons if not p.get("unrated")]
    unrated = [p for p in persons if p.get("unrated")]
    print(f"[snapshot] 账号 {ACCOUNT} → {me['user']['roleKey']} {me['user']['name']}")
    print(f"[snapshot] persons {len(persons)}（在册明细 {len(rated)} / 待核实 {len(unrated)}）"
          f" · changes {len(changes)} · alerts {len(alerts)}")
    if stats:
        print(f"[snapshot] stats inRegister={stats['inRegister']} highPlus={stats['highPlus']} "
              f"dual={stats['dual']} multi={stats['multi']} unknown={stats['unknown']}")
    print(f"[snapshot] 写出 {OUT.resolve()}")


if __name__ == "__main__":
    main()
