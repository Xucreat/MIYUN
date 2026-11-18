# 后端（B1–B6：建库 + 种子 + 只读 API + 鉴权 / 掩码 / 审计 / 写 API + 前端接链路 + 走访读端 + 首次字段迁移）

设计依据：`docs/prototype-v2/BACKEND-数据模型-20261118.md`（从 `data.js` 41 个顶层键反推的准 schema）。

## 现状

| 阶段 | 内容 | 状态 |
|---|---|---|
| B1 | 34 张表 + 3 视图 + Alembic 首版迁移 | ✅ |
| B2 | 种子导入器 + 行数/口径对账 | ✅ |
| B3 | 只读 API（persons / level-changes / alerts / stats / dicts / rules） | ✅ |
| B4 | 登录鉴权 + 服务端掩码 + 服务端审计 + 写 API（等级变动 / 走访 / 预警处置） | ✅ |
| B5 | 前端接只读链路（`assets/api.js` + `data.js hydrate()`，页面代码零改动） | ✅ |
| B6-1 | 走访读端 `GET /api/visits` + 写回填 `srvId` + 乐观行两段式去重 | ✅ |
| B6-2 | `alert.dept_raw` 加列（责任单位原文入库）—— **本项目第一次真正的 schema 变更** | ✅ |

B4 **没有新增任何表、列或迁移**：权限用 `role_perm`、字段密级用 `field_policy.mask`（本来就是
9 字段 × 9 角色的矩阵）、审计用 `audit_log`、范围用 `sys_account.unit`，全部是 B1 已建好的。

B5 同样**零迁移**，只给 `/api/persons` 出参补了一个 `visitTotal`（子查询数 `visit` 表）。

B6-1 也**零迁移**：新端点读的是 B1 就建好的 `visit` 表；修的两个缺陷都是前端合并逻辑与缺读端，不是模型问题。

B6-2 **有迁移**（`0002_alert_dept_raw`）：`alert` 加 `dept_raw`。原因不是设计变，是 B1 建表时把
「责任单位」只存成了外键 `dept_id` —— 而 18 条预警里 13 条的责任单位是「鼓楼街道综治中心」这类镇街机构，
`dept` 表（区级部门表）里没有对应 code，于是只能为 NULL，原文无处可存，前端只能回落本地。
迁移只回填得了 `dept_id` 非空的 5 条，其余 13 条由 `python -m app.seed` 重灌补齐 ——
**跑迁移不等于补完数据，升级后必须重灌或自查**：

```sql
SELECT count(*) FILTER (WHERE dept_raw IS NULL) AS missing FROM alert;  -- 必须为 0
```

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

## 登录与鉴权（B4）

除 `/api/health`、`/api/auth/login` 外，**所有端点都要 Bearer 令牌**。

```bash
# 登录取令牌（演示口令默认 miyun@2026，见 DEMO_PASSWORD）
curl -X POST http://127.0.0.1:8001/api/auth/login \
     -H "Content-Type: application/json" -d "{\"account\":\"chenzhiyuan\"}"

# 带令牌访问
curl http://127.0.0.1:8001/api/persons -H "Authorization: Bearer <token>"
```

| 端点 | 权限位 |
|---|---|
| `GET/POST /api/audit` | `sys:audit:view` / 登录即可（只读动作白名单） |
| `GET /api/persons`、`/api/persons/{id}` | `person:list` / `person:view` |
| `GET /api/stats/*` | `dashboard:view` |
| `GET /api/level-changes` | `risk:history:view` |
| `GET /api/alerts` | `alert:view`（出参 `dept` 是可映射的部门 code，`deptRaw` 是责任单位原文，前端优先用 `deptRaw`） |
| `GET /api/visits` | `visit:view`（R1/R7-R9 无此权限 → 403） |
| `POST /api/level-changes` | `risk:adjust:up`（风险升高）/ `risk:adjust:down`（风险降低），按变动方向判定 |
| `POST /api/persons/{id}/visits` | `visit:create` |
| `POST /api/alerts/{id}/dispose` | `alert:handle` / `alert:ignore` / `alert:assign`，按处置动作判定 |

9 个演示账号（口令同一套）：`liguodong`(R1) `chenzhiyuan`(R2) `zhoumin`(R3) `liqiang`(R4)
`wanghf`(R5) `wangzg`(R6) `liujg`(R7) `guolx`(R8) `yangfan`(R9)。

## 掩码与数据范围

- **掩码在服务端**：按 `field_policy.mask`（明 / 掩 / 申 / 隐 / 本部门 / 辖区明）执行，
  出参统一带 `maskedFields`，例如 `{"idNo": {"mode": "申", "needApply": true}}`。
  被「隐」的字段给的是 `null` 而不是 `—`（`—` 是字符串，会被下游当真实值参与统计）。
- **数据范围**：由 `sys_account.unit` 解析成 dept / town 再做行过滤（R4 只看本部门、
  R5 只看本镇街）。**解析不出来就拒绝**（403 `scope_unresolved`），不做「解析失败即放行」的兜底。

## 自检

```bash
cd backend
python -m app.seed --verify    # 只对账不写库：28 张表行数 + 5 项口径
python -m tools.api_checks     # B3 口径回归 45 条（用 R2 全区账号跑）
python -m tools.api_checks_b4  # B4 安全断言 74 条（9 个角色逐一试越权）
python -m tools.api_checks_b6  # B6 走访读端 18 条（权限 / 范围 / 写→读往返 / 还原）
```

四份都必须全绿。都用 TestClient 进程内跑，不用起服务；`api_checks_b4` 与 `api_checks_b6`
会写库，但**结束时整体还原**，跑完 `--verify` 仍应全绿。

前端侧回归在 `docs/prototype-v2/tools/`：
`smoke-b5.js`（14 页 + mock↔live 对账）、`check-live-role.js`（R1/R2/R4/R5 范围与掩码）、
`check-live-write.js`（请求体契约）、`check-live-dedupe.js`（B6 回填与去重）、
`check-live-authority.js`（B6-2 服务端权威性：改快照里的 `deptRaw`，页面必须跟着变；不写库）、
`check-live-e2e.js`（真 HTTP 端到端，需 PG + API + 静态站三件套同时在线）。

`check-live-e2e.js` 真写库，**跑前库必须是种子态、跑后必须 `python -m app.seed` 还原**；
不满足前置时它在第 1b 步打印实际行数并以 exit 2 中止（不写库），不再误报成断言失败。
2026-11-18 复测：此前记录的「Chrome 渲染进程请求 8001 即崩」已不复现，该脚本可正常跑完全部断言。

## 数据库

默认连 `backend/.pgdata`（`initdb` 出来的独立实例，端口 **55433**，role `miyun`，库 `miyun`）。
不去动本机 5432 上那个舆情系统的库。

想换成自己的 PG，只改环境变量即可（见 `.env.example`）：

```bash
set DATABASE_URL=postgresql+psycopg://user:pass@127.0.0.1:5432/miyun
set SECRET_KEY=<换掉>          # 换密钥 = 所有已签发令牌立即失效
set DEMO_PASSWORD=<换掉>
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
    auth.py       B4：无状态令牌、权限门控、数据范围解析
    mask.py       B4：服务端字段掩码（按 field_policy 执行）
    audit.py      B4：审计落库（服务端填身份/时间/IP）
    api.py        读路由 + 登录 / me / audit
    api_write.py  B4：写路由（等级变动 / 走访 / 预警处置）
    main.py       FastAPI 入口
  alembic/        迁移（0001_init 以模型元数据为唯一源；0002 加 alert.dept_raw；B4/B5/B6-1 无新迁移）
  seed/data/      从 data.js 导出的种子 JSON（1.8 MB，随仓库走，免装 node 也能跑）
  tools/
    export_seed.js  前端 data.js → seed/data/*.json
    api_checks.py   B3 自检
    api_checks_b4.py B4 自检
```

## 三条硬约束（改代码前先读）

1. `level_change` **没有审批状态机**，只有 `status='已生效'` + `notified`（会议决议 D4）。
   DB 层有 `CheckConstraint("status = '已生效'")` 兜底。
2. `dual_confirm` 与 `person_tag` **不做任何联动**——两者交叉 50、并集 245，含在一起会连锁改掉盲区 887。
3. `person.primary_dept_id`（单值主责，486）与 `person_tag.dept_id`（多值归属，667 人次）**并存**，
   聚合 SQL 分开写；`?dept=` 与 `?deptTag=` 是两个口径。

## 已知边界

- **明细只有 1,098 行**：高风险 486 + 待核实 612。中 2,284 / 低 2,646 只有计数，由
  `metric_snapshot` 承载。预警指向这些无明细人员时，`person_id` 为空、`person_ref` 留原编号。
- **登录是演示级**：账号来自 `sys_account`，口令是全局 `DEMO_PASSWORD`，没有真实 IdP、
  没有密码哈希、没有失败锁定。上线前必须替换为统一身份认证。
- **`role_perm` 只存「允许」**：前端的 half（受限需申请，如明文导出、减册）没有入库，
  因此服务端一律按**拒绝**处理（fail-closed）。要做明文导出申请流，得先给 `role_perm` 加
  「受限」取值 —— 属 B5 之后的事。
- **`field_policy` 有 9 个字段，person 上只承载 4 个**（姓名/证件/电话/住址）。
  `reason` / `visit` 已分别映射到 `level_change.reason`、`visit.result` 并生效；
  `basis`（评估依据）、`special`（特殊类别明细）、`domicile`（户籍地址）在库里没有独立列，
  掩码先按「明」以外的策略空转，等接入真实数据源补列。
- **等级变动 id 用 `max+1` 生成**（`CHG-202611-###`）：单实例演示够用，多实例并发需换成序列。
- 前端已接只读链路（B5），写路径是「本地先行 + 服务端留痕」；B6 起服务端回的 id 会回填成 `srvId`，
  合并时按 id 精确认领、业务键只作兜底（`mergeOptimistic`），同日同向两次登记不再互相吞。
  仍不干净的一点：本地乐观行的 `id` 不改写成服务端 id —— 改 id 会打断 `changeNotes` 与 `?focus=` 深链。

## 前端接入（B5）自检

前端在 `docs/prototype-v2`，切服务端数据源有两种方式：登录页选「服务端 API」，或地址栏加 `?live=1`；
回到本地演示用 `?live=0`，或数据源弹窗里的「切回本地演示」。演示角色 → 真实账号的映射写在 `login.html`：
区领导 `liguodong`（R1）、政法委主管 `chenzhiyuan`（R2）、公安经办 `liqiang`（R4）。

```bash
# 静态站（仓库根执行）
python -m http.server 8081 -d docs/prototype-v2

# 快照导出：按 /api 载荷生成前端快照（浏览器连不上 8001 时用它验映射）
cd backend && python -m tools.dump_snapshot chenzhiyuan ../docs/prototype-v2/tools/snapshot-r2.json

# 四支前端脚本（在 docs/prototype-v2 下跑）
node tools/smoke-b5.js                          # 本地演示：14 页零 pageerror + 口径不漂
node tools/smoke-b5.js tools/snapshot-r2.json   # 服务端快照：mock↔live 逐项对账
node tools/check-live-role.js tools/snapshot-r1.json R1   # 角色视角：范围 / 掩码 / 权限位
node tools/check-live-write.js tools/snapshot-r2.json     # 写回请求体契约 + 故障降级
node tools/check-live-e2e.js                    # 真 PG + 真 HTTP 全链路（会改库，跑完必须还原）
```

`check-live-e2e.js` 会真的处置一条预警、登记一条等级变动，**跑完必须还原**：
`cd backend && python -m app.seed`（幂等，先 TRUNCATE 再灌）。
