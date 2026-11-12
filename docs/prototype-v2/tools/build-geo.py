#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
build-geo.py · 生成 assets/miyun-geo.js（密云区 20 个镇街真实行政边界 → SVG 路径）

数据源：OpenStreetMap（Overpass API，admin_level=6 区界 / admin_level=8 镇街界）
投影：等距圆柱 + cos(中心纬度) 校正，等比缩放至 viewBox 0 0 600 462
抽稀：Douglas–Peucker，镇街 0.65px、区界 0.5px 容差
说明：仅供演示原型使用，不作为测绘成果。

用法：
  python tools/build-geo.py                 # 联网抓取（需可访问 Overpass 镜像）
  python tools/build-geo.py --raw geo.json  # 复用已下载的 Overpass 响应
"""
import argparse
import json
import math
import os
import subprocess
import sys

ENDPOINTS = [
    "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
    "https://overpass-api.de/api/interpreter",
]
QUERY = ('[out:json][timeout:90];'
         'area["name"="密云区"]->.a;'
         'rel(area.a)["boundary"="administrative"]["admin_level"~"^(6|8)$"];'
         'out geom;')

# OSM 名称 → 业务口径名称
NAME_FIX = {"檀营乡": "檀营地区"}

# 城区 6 个单元面积过小、标签会互相压盖 → 拉到图幅西南空白处做引线标注
CALLOUT = {
    "十里堡镇":  (10, 356),
    "密云镇":    (10, 374),
    "果园街道":  (10, 392),
    "鼓楼街道":  (10, 410),
    "檀营地区":  (10, 428),
    "河南寨镇":  (128, 446),
}

W, H, PAD = 600, 462, 14


def fetch():
    for ep in ENDPOINTS:
        try:
            out = subprocess.run(
                ["curl", "-s", "-m", "120", "-X", "POST", ep,
                 "--data-urlencode", "data=" + QUERY],
                capture_output=True, timeout=150)
            if out.returncode == 0 and out.stdout[:1] == b"{":
                return json.loads(out.stdout.decode("utf-8"))
        except Exception as exc:  # noqa: BLE001
            print("skip %s: %s" % (ep, exc), file=sys.stderr)
    raise SystemExit("所有 Overpass 端点均不可用")


def stitch(segs):
    segs = [list(s) for s in segs]
    out = []
    while segs:
        cur = segs.pop(0)
        moved = True
        while moved and segs:
            moved = False
            for i, s in enumerate(segs):
                if close(cur[-1], s[0]):
                    cur += s[1:]
                elif close(cur[-1], s[-1]):
                    cur += list(reversed(s))[1:]
                elif close(cur[0], s[-1]):
                    cur = s[:-1] + cur
                elif close(cur[0], s[0]):
                    cur = list(reversed(s))[:-1] + cur
                else:
                    continue
                segs.pop(i)
                moved = True
                break
        out.append(cur)
    return out


def close(a, b):
    return abs(a[0] - b[0]) < 1e-7 and abs(a[1] - b[1]) < 1e-7


def rings_of(rel):
    outer, inner = [], []
    for m in rel.get("members", []):
        if m.get("type") != "way":
            continue
        pts = [(p["lon"], p["lat"]) for p in (m.get("geometry") or [])]
        if len(pts) < 2:
            continue
        (inner if m.get("role") == "inner" else outer).append(pts)
    return stitch(outer), stitch(inner)


def area(pts):
    a = 0.0
    for i in range(len(pts)):
        x1, y1 = pts[i]
        x2, y2 = pts[(i + 1) % len(pts)]
        a += x1 * y2 - x2 * y1
    return a / 2


def inpoly(pt, pts):
    x, y = pt
    inside = False
    for i in range(len(pts)):
        x1, y1 = pts[i]
        x2, y2 = pts[(i + 1) % len(pts)]
        if (y1 > y) != (y2 > y):
            if x1 + (y - y1) * (x2 - x1) / (y2 - y1) > x:
                inside = not inside
    return inside


def dist_seg(p, a, b):
    px, py = p
    ax, ay = a
    bx, by = b
    dx, dy = bx - ax, by - ay
    if dx == 0 and dy == 0:
        return math.hypot(px - ax, py - ay)
    t = max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)))
    return math.hypot(px - (ax + t * dx), py - (ay + t * dy))


def pole(ring):
    """极点（pole of inaccessibility）：网格搜索离边界最远的内部点，用作标签锚点"""
    xs = [p[0] for p in ring]
    ys = [p[1] for p in ring]
    x0, x1, y0, y1 = min(xs), max(xs), min(ys), max(ys)
    best, bp = -1.0, None
    for i in range(20):
        for j in range(20):
            p = (x0 + (x1 - x0) * (i + .5) / 20, y0 + (y1 - y0) * (j + .5) / 20)
            if not inpoly(p, ring):
                continue
            d = min(dist_seg(p, ring[k], ring[(k + 1) % len(ring)]) for k in range(len(ring)))
            if d > best:
                best, bp = d, p
    return bp or ((x0 + x1) / 2, (y0 + y1) / 2)


def dp(pts, eps):
    if len(pts) < 3:
        return pts
    dmax, idx = 0.0, 0
    for i in range(1, len(pts) - 1):
        d = dist_seg(pts[i], pts[0], pts[-1])
        if d > dmax:
            dmax, idx = d, i
    if dmax > eps:
        return dp(pts[:idx + 1], eps)[:-1] + dp(pts[idx:], eps)
    return [pts[0], pts[-1]]


def simplify(ring, eps):
    closed = ring + [ring[0]] if ring[0] != ring[-1] else ring
    s = dp(closed, eps)
    if s[0] != s[-1]:
        s.append(s[0])
    return s[:-1]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--raw", help="已下载的 Overpass JSON")
    ap.add_argument("--out", default=os.path.join("assets", "miyun-geo.js"))
    args = ap.parse_args()

    data = json.load(open(args.raw, encoding="utf-8")) if args.raw else fetch()

    feats = []
    for el in data["elements"]:
        tags = el.get("tags", {})
        name = tags.get("name")
        if not name:
            continue
        outer, inner = rings_of(el)
        outer = [r for r in outer if len(r) >= 4]
        if not outer:
            continue
        outer.sort(key=lambda r: -abs(area(r)))
        feats.append({"name": NAME_FIX.get(name, name), "lvl": tags.get("admin_level"),
                      "outer": outer, "inner": inner})

    district = next(f for f in feats if f["lvl"] == "6")
    pts = [p for r in district["outer"] for p in r]
    lon0, lon1 = min(p[0] for p in pts), max(p[0] for p in pts)
    lat0, lat1 = min(p[1] for p in pts), max(p[1] for p in pts)
    k = math.cos(math.radians((lat0 + lat1) / 2))
    span_x, span_y = (lon1 - lon0) * k, (lat1 - lat0)
    sx, sy = W - PAD * 2, H - PAD * 2
    sc = min(sx / span_x, sy / span_y)
    ox = PAD + (sx - span_x * sc) / 2
    oy = PAD + (sy - span_y * sc) / 2

    def proj(p):
        return (ox + (p[0] - lon0) * k * sc, oy + (lat1 - p[1]) * sc)

    def mkpath(rings, eps):
        parts = []
        for r in rings:
            d = simplify([proj(p) for p in r], eps)
            if len(d) < 3:
                continue
            ar = abs(sum(d[i][0] * d[(i + 1) % len(d)][1] - d[(i + 1) % len(d)][0] * d[i][1]
                          for i in range(len(d)))) / 2
            if ar < 2.0:
                continue
            parts.append("M" + "L".join("%.1f %.1f" % (x, y) for x, y in d) + "Z")
        return "".join(parts)

    towns = []
    for f in feats:
        if f["lvl"] != "8":
            continue
        cx, cy = proj(pole(f["outer"][0]))
        rec = {"n": f["name"], "c": [round(cx, 1), round(cy, 1)], "d": mkpath(f["outer"], 0.65)}
        if f["name"] in CALLOUT:
            rec["lb"] = list(CALLOUT[f["name"]])
        towns.append(rec)
    towns.sort(key=lambda t: t["n"])

    lines = [
        "/* 密云区 § 20 个镇街真实行政边界（数据源：OpenStreetMap，admin_level=8）",
        "   投影：等距圆柱 + cos(lat) 校正；线段按 0.65px 容差抽稀；viewBox 0 0 600 462。",
        "   c = 标签锚点；带 lb 的为城区小单元，图幅西南侧引线标注。",
        "   仅供演示原型使用，不作为测绘成果。生成脚本：tools/build-geo.py */",
        "window.MIYUN_GEO = {",
        '  viewBox: "0 0 600 462",',
        '  district: "%s",' % mkpath(district["outer"], 0.5),
        "  towns: [",
    ]
    for t in towns:
        extra = (', lb: [%d, %d]' % tuple(t["lb"])) if "lb" in t else ""
        lines.append('    { n: "%s", c: [%s, %s]%s, d: "%s" },' % (t["n"], t["c"][0], t["c"][1], extra, t["d"]))
    lines += ["  ]", "};", ""]

    out = "\n".join(lines)
    with open(args.out, "w", encoding="utf-8", newline="\n") as fh:
        fh.write(out)
    print("写入 %s · %d 个镇街 · %.1f KB" % (args.out, len(towns), len(out.encode("utf-8")) / 1024))


if __name__ == "__main__":
    main()
