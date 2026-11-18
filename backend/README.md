# 后端（B1–B3：建库 + 种子 + 只读 API）

设计依据：`docs/prototype-v2/BACKEND-数据模型-20261118.md`（从 `data.js` 41 个顶层键反推的准 schema）。
本阶段**只读**，无鉴权、无服务端掩码——那是 B4。

## 现状

| 阶段 | 内容 | 状态 |
|---|---|---|
| B1 | 34 张表 + 3 视图 + Alembic 首版迁移 | ✅ |
| B2 | 种子导入器 + 行数/口径对账 | ✅ |
| B3 | 只读 API（persons / level-changes / alerts / stats / dicts / rules） | ✅ |
| B4 | 写 API + 服务端审计 + 服务端掩码 | 待做 |
| B5 | 前端 `assets/data.js` 换数据源 | 待做 |

## 快速开始

```bash
# 1) 起库（自带实例，端口 55433）
backend\start-db.bat

# 2) 建表（首次或改了模型后）
cd backend
python -m alembic upgrade head

# 3) 灌种子（幂等，重复跑会先清空）
python -m app.seed

# 4) 起服务
backend\start-api.bat          # 或 python -m uvicorn app.main:app --port 8001
# 文档：http://127.0.0.1:8001/docs
```

## 自检

```bash
cd backend
python -m app.seed --verify   # 只对账不写库：行数 + 双在册交叉 + 部门两套口径
python -m tools.api_checks    # 45 条断言，覆盖统计口径与筛选语义
```

两者都必须全绿才算 B1–B3 通过。`api_checks` 用 FastAPI TestClient，进程内跑，不用起服务。

## 数据库

默认连 `backend/.pgdata`（`initdb` 出来的独立实例，端口 **55433**，role `miyun`，库 `miyun`）。
不去动本机 5432 上那个舆情系统的库。

想换成自己的 PG，只改环境变量即可（见 `.env.example`）：

```bash
set DATABASE_URL=postgresql+psycopg://user:pass@127.0.0.1:5432/miyun
```

## 目录

```
backend/
  app/
    config.py     配置（env）
    db.py         引擎与会话
    models.py     34 张表的 ORM 定义（含三条硬约束注释）
    views.py      3 个视图（人员全字段 / 部门两套口径 / 双在册交叉）
    seed.py       种子导入 + 行数口径对账
    api.py        只读路由
    main.py       FastAPI 入口
  alembic/        迁移（0001_init 以模型元数据为唯一源）
  seed/data/      从 data.js 导出的种子 JSON（1.8 MB，随仓库走，免装 node 也能跑）
  tools/
    export_seed.js  前端 data.js → seed/data/*.json
    api_checks.py   B3 自检
```

## 三条硬约束（改代码前先读）

1. `level_change` **没有审批状态机**，只有 `status='已生效'` + `notified`（会议决议 D4）。
2. `dual_confirm` 与 `person_tag` **不做任何联动**——两者交叉 50、并集 245，含在一起会连锁改掉盲区 887。
3. `person.primary_dept_id`（单值主责，486）与 `person_tag.dept_id`（多值归属，667 人次）**并存**，
   聚合 SQL 分开写；`?dept=` 与 `?deptTag=` 是两个口径。

## 已知边界

- **明细只有 1,098 行**：高风险 486 + 待核实 612。中 2,284 / 低 2,646 只有计数，由
  `metric_snapshot` 承载。预警指向这些无明细人员时，`person_id` 为空、`person_ref` 留原编号。
- 掩码目前在前端做（`D.field()`），接真实数据前必须移到服务端（B4），否则等于假脱敏。
- `approved`/写操作尚不存在，前端改动留到 B5。
