"""视图：把前端依赖的派生口径固化在库里，避免每处聚合各写一遍。

- `v_person_full`：还原前端 `p` 对象的派生字段（标签、双在册、走访数、年龄、多重标签）。
- `v_dept_stats`：裁决 B1 的两个维度分开列，并区分待核实人员
  （`scope='primary'` 主责 486 / `scope='tag'` 类别 667 人次；`is_unrated=false` 与前端 486 同口径）。
- `v_dual_cross`：裁决 A1 的交集与并集（交叉 50 / 并集 245），与 data.js deptStats() 同算法。

注意：列结构会演进，统一用 `DROP VIEW IF EXISTS ... ; CREATE VIEW ...`，
不用 `CREATE OR REPLACE`（后者在列顺序变化时会直接报错）。
"""
from __future__ import annotations

V_PERSON_FULL = """
CREATE VIEW v_person_full AS
SELECT p.id, p.no, p.name, p.gender, p.birth, p.id_no, p.phone,
       p.town_code, p.village, p.addr,
       p.primary_dept_id, p.dept_raw, p.level, p.source, p.status, p.since,
       p.watch, p.no_basis, p.last_visit, p.officer, p.officer_title, p.is_unrated,
       EXTRACT(YEAR FROM age(p.birth))::int AS age,
       COALESCE(t.tag_count, 0)::int AS tag_count,
       (COALESCE(t.tag_count, 0) > 1) AS multi,
       EXISTS (SELECT 1 FROM dual_confirm d WHERE d.person_id = p.id) AS dual,
       COALESCE(v.visit_total, 0)::int AS visit_total,
       COALESCE((CURRENT_DATE - p.last_visit), 0)::int AS visit_gap,
       COALESCE(t.tags, ARRAY[]::text[]) AS tags
FROM person p
LEFT JOIN (
    SELECT person_id, count(*) AS tag_count, array_agg(tag_code ORDER BY tag_code) AS tags
    FROM person_tag GROUP BY person_id
) t ON t.person_id = p.id
LEFT JOIN (
    SELECT person_id, count(*) AS visit_total FROM visit GROUP BY person_id
) v ON v.person_id = p.id
"""

V_DEPT_STATS = """
CREATE VIEW v_dept_stats AS
SELECT 'primary'::text AS scope, primary_dept_id AS dept_id, is_unrated,
       count(*)::int AS persons
  FROM person WHERE primary_dept_id IS NOT NULL GROUP BY 1, 2, 3
UNION ALL
SELECT 'tag'::text AS scope, t.dept_id, p.is_unrated,
       count(DISTINCT t.person_id)::int AS persons
  FROM person_tag t JOIN person p ON p.id = t.person_id
 WHERE t.dept_id IS NOT NULL GROUP BY 1, 2, 3
"""

# 注意：cross / dual 在 PG 里都是关键字或易冲突词，CTE 名统一加后缀
V_DUAL_CROSS = """
CREATE VIEW v_dual_cross AS
WITH cross_dept AS (
    SELECT person_id FROM person_tag GROUP BY 1 HAVING count(DISTINCT dept_id) > 1
), dual_p AS (
    SELECT DISTINCT person_id FROM dual_confirm
), inter AS (
    SELECT count(*)::int AS n FROM cross_dept c JOIN dual_p d USING (person_id)
)
SELECT (SELECT count(*)::int FROM dual_p) AS dual_n,
       (SELECT count(*)::int FROM cross_dept) AS cross_n,
       (SELECT n FROM inter) AS inter,
       ((SELECT count(*) FROM dual_p) + (SELECT count(*) FROM cross_dept)
        - (SELECT n FROM inter))::int AS uni
"""

_VIEWS = {
    "v_person_full": V_PERSON_FULL,
    "v_dept_stats": V_DEPT_STATS,
    "v_dual_cross": V_DUAL_CROSS,
}

VIEWS_SQL: list[str] = [
    f"DROP VIEW IF EXISTS {name} CASCADE" for name in _VIEWS
] + list(_VIEWS.values())
