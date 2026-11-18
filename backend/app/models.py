"""ORM 模型：33 张表，逐项对应 docs/prototype-v2/BACKEND-数据模型-20261118.md。

三条硬约束（来自口径裁决，改代码前先读）：
1. `level_change` 只有「已生效 + 是否知会」两个状态位，**没有审批状态机**。
   不要加 approval_status / current_node / approver_chain。
2. `dual_confirm` 与 `person_tag` **不做任何联动**（无触发器、无物化、无外键到对方）。
   两者交集 50、并集 245 是两条独立路径的结果，含在一起会连锁改掉盲区 887。
3. `person.primary_dept_id` 单值与 `person_tag.dept_id` 多值**并存**，
   聚合 SQL 分开写；`?dept=` 与 `?deptTag=` 是两个口径，不许合并。
"""
from __future__ import annotations

from datetime import date, datetime

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


class Base(DeclarativeBase):
    pass


def _ts() -> Mapped[datetime]:
    return mapped_column(DateTime(timezone=False), server_default=func.now())


# ---------------------------------------------------------------- 0. 部门
class Dept(Base):
    """业务主管部门（裁决 B1：主责口径的锚点，与标签映射是两套）。"""

    __tablename__ = "dept"

    code: Mapped[str] = mapped_column(String(32), primary_key=True)
    name: Mapped[str] = mapped_column(String(64), nullable=False)
    head: Mapped[str | None] = mapped_column(String(32))
    sort: Mapped[int] = mapped_column(Integer, default=0)


# ---------------------------------------------------------------- 1. 人员与台账
class Person(Base):
    __tablename__ = "person"

    id: Mapped[str] = mapped_column(String(16), primary_key=True)
    no: Mapped[str] = mapped_column(String(32), unique=True, nullable=False)
    name: Mapped[str] = mapped_column(String(32), nullable=False)
    gender: Mapped[str | None] = mapped_column(String(8))
    birth: Mapped[date | None] = mapped_column(Date)
    id_no: Mapped[str] = mapped_column(String(32), unique=True, nullable=False)
    phone: Mapped[str | None] = mapped_column(String(32))
    town_code: Mapped[str | None] = mapped_column(ForeignKey("town.code"))
    village: Mapped[str | None] = mapped_column(String(64))
    addr: Mapped[str | None] = mapped_column(String(255))
    # 裁决 B1：单值主责部门；多值归属看 person_tag.dept_id
    primary_dept_id: Mapped[str | None] = mapped_column(ForeignKey("dept.code"))
    dept_raw: Mapped[str | None] = mapped_column(String(64))
    level: Mapped[str] = mapped_column(String(16), nullable=False)
    source: Mapped[str | None] = mapped_column(String(64))
    status: Mapped[str | None] = mapped_column(String(16))
    since: Mapped[str | None] = mapped_column(String(16))
    watch: Mapped[bool] = mapped_column(Boolean, default=False)
    no_basis: Mapped[bool] = mapped_column(Boolean, default=False)
    last_visit: Mapped[date | None] = mapped_column(Date)
    officer: Mapped[str | None] = mapped_column(String(32))
    officer_title: Mapped[str | None] = mapped_column(String(32))
    # 待核实人员（前端 unrated 集合）与高风险明细同表，靠此位区分
    is_unrated: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    created_at: Mapped[datetime] = _ts()

    tags: Mapped[list["PersonTag"]] = relationship(back_populates="person", lazy="selectin")
    visits: Mapped[list["Visit"]] = relationship(back_populates="person", lazy="noload")


class PersonTag(Base):
    """一人多标签（裁决 B1 的「类别归属」维度）。超 3 个只置 over_limit，不阻断。"""

    __tablename__ = "person_tag"
    __table_args__ = (UniqueConstraint("person_id", "tag_code", name="uq_person_tag"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    person_id: Mapped[str] = mapped_column(ForeignKey("person.id", ondelete="CASCADE"), index=True)
    tag_code: Mapped[str] = mapped_column(ForeignKey("tag_dict.code"), index=True)
    dept_id: Mapped[str | None] = mapped_column(ForeignKey("dept.code"), index=True)
    created_at: Mapped[str | None] = mapped_column(String(32))
    created_by: Mapped[str | None] = mapped_column(String(32))
    note: Mapped[str | None] = mapped_column(Text)
    over_limit: Mapped[bool] = mapped_column(Boolean, default=False)

    person: Mapped[Person] = relationship(back_populates="tags")


class TagDict(Base):
    __tablename__ = "tag_dict"

    code: Mapped[str] = mapped_column(String(32), primary_key=True)
    name: Mapped[str] = mapped_column(String(64), nullable=False)
    dept_id: Mapped[str | None] = mapped_column(ForeignKey("dept.code"))
    cls: Mapped[str | None] = mapped_column(String(32))
    on: Mapped[bool] = mapped_column(Boolean, default=True)


class LevelDict(Base):
    __tablename__ = "level_dict"

    key: Mapped[str] = mapped_column(String(16), primary_key=True)
    name: Mapped[str] = mapped_column(String(16), nullable=False)
    cls: Mapped[str | None] = mapped_column(String(32))
    order: Mapped[int] = mapped_column(Integer, nullable=False)  # 小 = 风险高


class Town(Base):
    __tablename__ = "town"

    code: Mapped[str] = mapped_column(String(32), primary_key=True)
    name: Mapped[str] = mapped_column(String(64), nullable=False)
    short: Mapped[str | None] = mapped_column(String(32))
    officer: Mapped[str | None] = mapped_column(String(32))
    title: Mapped[str | None] = mapped_column(String(32))
    registered: Mapped[int | None] = mapped_column(Integer)
    high: Mapped[int | None] = mapped_column(Integer)


class Village(Base):
    __tablename__ = "village"

    code: Mapped[str] = mapped_column(String(32), primary_key=True)
    town_code: Mapped[str] = mapped_column(ForeignKey("town.code"), index=True)
    name: Mapped[str] = mapped_column(String(64), nullable=False)


# ---------------------------------------------------------------- 2. 等级变动（无审批状态机）
class LevelChange(Base):
    __tablename__ = "level_change"
    __table_args__ = (
        CheckConstraint("status = '已生效'", name="ck_level_change_status"),
    )

    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    person_id: Mapped[str | None] = mapped_column(ForeignKey("person.id"), index=True)
    name: Mapped[str] = mapped_column(String(32), nullable=False)
    town_code: Mapped[str | None] = mapped_column(ForeignKey("town.code"))
    dept_id: Mapped[str | None] = mapped_column(ForeignKey("dept.code"))
    from_level: Mapped[str] = mapped_column(String(16), nullable=False)
    to_level: Mapped[str] = mapped_column(String(16), nullable=False)
    reason: Mapped[str | None] = mapped_column(Text)
    rule_label: Mapped[str | None] = mapped_column(String(64))   # 部门定级责任
    approver: Mapped[str | None] = mapped_column(String(64))     # 登记人 / 定级人
    occurred_at: Mapped[datetime | None] = mapped_column(DateTime, index=True)
    status: Mapped[str] = mapped_column(String(16), default="已生效")
    notified: Mapped[bool] = mapped_column(Boolean, default=True)
    notified_at: Mapped[datetime | None] = mapped_column(DateTime)


class LevelRoute(Base):
    """部门内部定级流程（末节点=报政法委备案，不是审批关口）。"""

    __tablename__ = "level_route"

    target_level: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(32))
    days: Mapped[int] = mapped_column(Integer)
    nodes: Mapped[list | None] = mapped_column(JSONB)


# ---------------------------------------------------------------- 3. 管控动作
class Visit(Base):
    __tablename__ = "visit"

    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    person_id: Mapped[str] = mapped_column(ForeignKey("person.id", ondelete="CASCADE"), index=True)
    date: Mapped[date | None] = mapped_column(Date)
    way: Mapped[str | None] = mapped_column(String(32))
    result: Mapped[str | None] = mapped_column(String(64))
    by: Mapped[str | None] = mapped_column(String(32))
    at: Mapped[str | None] = mapped_column(String(32))

    person: Mapped[Person] = relationship(back_populates="visits")


class Alert(Base):
    __tablename__ = "alert"

    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    rule_code: Mapped[str | None] = mapped_column(String(16), index=True)
    urgency: Mapped[str | None] = mapped_column(String(16))
    person_id: Mapped[str | None] = mapped_column(ForeignKey("person.id"), index=True)
    # 预警可能指向「无逐人明细」的人员（中/低风险两档只有计数），此时 person_id 为空，
    # 原始编号留在这里做追溯，不为了外键去造 4,930 行假人员。
    person_ref: Mapped[str | None] = mapped_column(String(16))
    person_name: Mapped[str | None] = mapped_column(String(32))
    town_code: Mapped[str | None] = mapped_column(ForeignKey("town.code"))
    level_name: Mapped[str | None] = mapped_column(String(16))
    metric: Mapped[str | None] = mapped_column(String(64))
    dept_id: Mapped[str | None] = mapped_column(ForeignKey("dept.code"))
    # B6-2：责任单位原文。dept_id 只存能对上 dept 表的 code，镇街综治中心这类
    # （如「鼓楼街道综治中心」，18 条预警里 13 条）映射不上就是 NULL，原文必须另存，
    # 否则前端只能回落本地数据 —— 那就成了「服务端有预警、责任单位取本地」的两套口径。
    dept_raw: Mapped[str | None] = mapped_column(String(64))
    owner: Mapped[str | None] = mapped_column(String(32))
    desc: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime | None] = mapped_column(DateTime)
    status: Mapped[str | None] = mapped_column(String(16), index=True)


class PlainExportReq(Base):
    """明文导出申请单：这一层审批**保留**（数据安全闸门，与 D4 无关）。"""

    __tablename__ = "plain_export_req"

    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    at: Mapped[datetime | None] = mapped_column(DateTime)
    by: Mapped[str | None] = mapped_column(String(32))
    role: Mapped[str | None] = mapped_column(String(64))
    count: Mapped[int] = mapped_column(Integer, default=0)
    purpose: Mapped[str | None] = mapped_column(Text)
    valid_until: Mapped[str | None] = mapped_column(String(32))
    scope: Mapped[str | None] = mapped_column(String(128))
    chain: Mapped[list | None] = mapped_column(JSONB)
    status: Mapped[str | None] = mapped_column(String(16))


class Responder(Base):
    __tablename__ = "responder"

    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    name: Mapped[str] = mapped_column(String(32))
    unit: Mapped[str | None] = mapped_column(String(64))
    title: Mapped[str | None] = mapped_column(String(32))
    kind: Mapped[str | None] = mapped_column(String(16))
    phone: Mapped[str | None] = mapped_column(String(32))
    note: Mapped[str | None] = mapped_column(String(64))


class DualConfirm(Base):
    """双在册确认（政府台账双重列管标记，127 人）。与 person_tag 无任何联动。"""

    __tablename__ = "dual_confirm"
    __table_args__ = (UniqueConstraint("person_id", "dept_id", name="uq_dual_confirm"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    person_id: Mapped[str] = mapped_column(ForeignKey("person.id", ondelete="CASCADE"), index=True)
    dept_id: Mapped[str | None] = mapped_column(ForeignKey("dept.code"))
    marked_at: Mapped[str | None] = mapped_column(String(32))
    by: Mapped[str | None] = mapped_column(String(32))
    note: Mapped[str | None] = mapped_column(Text)


# ---------------------------------------------------------------- 4. 重点时期
class WartimePeriod(Base):
    __tablename__ = "wartime_period"

    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    title: Mapped[str | None] = mapped_column(String(128))
    name: Mapped[str | None] = mapped_column(String(64))
    start: Mapped[date | None] = mapped_column(Date)
    end: Mapped[date | None] = mapped_column(Date)
    level_key: Mapped[str | None] = mapped_column(String(16))
    cfg: Mapped[dict | None] = mapped_column(JSONB)
    active: Mapped[bool] = mapped_column(Boolean, default=True)


class WartimeTask(Base):
    __tablename__ = "wartime_task"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    period_id: Mapped[str] = mapped_column(ForeignKey("wartime_period.id"), index=True)
    town_code: Mapped[str] = mapped_column(ForeignKey("town.code"), index=True)
    should: Mapped[int] = mapped_column(Integer, default=0)
    met: Mapped[int] = mapped_column(Integer, default=0)
    missing: Mapped[int] = mapped_column(Integer, default=0)
    officer: Mapped[str | None] = mapped_column(String(32))


class WartimeReport(Base):
    __tablename__ = "wartime_report"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    period_id: Mapped[str] = mapped_column(ForeignKey("wartime_period.id"), index=True)
    town_code: Mapped[str | None] = mapped_column(ForeignKey("town.code"))
    person_id: Mapped[str | None] = mapped_column(ForeignKey("person.id"))
    way: Mapped[str | None] = mapped_column(String(32))
    result: Mapped[str | None] = mapped_column(String(64))
    reason: Mapped[str | None] = mapped_column(String(32))
    at: Mapped[datetime | None] = mapped_column(DateTime)
    by: Mapped[str | None] = mapped_column(String(32))
    zero: Mapped[bool] = mapped_column(Boolean, default=False)


class WtLevel(Base):
    __tablename__ = "wt_level"

    key: Mapped[str] = mapped_column(String(16), primary_key=True)
    name: Mapped[str] = mapped_column(String(32))
    color: Mapped[str | None] = mapped_column(String(32))
    visit_every: Mapped[int | None] = mapped_column(Integer)
    report_every: Mapped[int | None] = mapped_column(Integer)
    report_due: Mapped[str | None] = mapped_column(String(16))
    scope: Mapped[str | None] = mapped_column(String(64))
    active: Mapped[bool] = mapped_column(Boolean, default=False)


# ---------------------------------------------------------------- 5. 报送与导入
class ReportMonthly(Base):
    __tablename__ = "report_monthly"
    __table_args__ = (UniqueConstraint("month", "dept_id", name="uq_report_monthly"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    month: Mapped[str] = mapped_column(String(16), index=True)
    dept_id: Mapped[str] = mapped_column(ForeignKey("dept.code"))
    should: Mapped[int] = mapped_column(Integer, default=0)
    real: Mapped[int] = mapped_column(Integer, default=0)
    late: Mapped[int] = mapped_column(Integer, default=0)
    prev_should: Mapped[int] = mapped_column(Integer, default=0)
    prev_real: Mapped[int] = mapped_column(Integer, default=0)
    prev_late: Mapped[int] = mapped_column(Integer, default=0)
    note: Mapped[str | None] = mapped_column(Text)


class ImportBatch(Base):
    __tablename__ = "import_batch"

    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    name: Mapped[str | None] = mapped_column(String(128))
    dept_id: Mapped[str | None] = mapped_column(ForeignKey("dept.code"))
    time: Mapped[datetime | None] = mapped_column(DateTime)
    total: Mapped[int] = mapped_column(Integer, default=0)
    ok: Mapped[int] = mapped_column(Integer, default=0)
    dup: Mapped[int] = mapped_column(Integer, default=0)
    fail: Mapped[int] = mapped_column(Integer, default=0)
    operator: Mapped[str | None] = mapped_column(String(32))
    status: Mapped[str | None] = mapped_column(String(16))


class ImportRow(Base):
    __tablename__ = "import_row"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    batch_id: Mapped[str] = mapped_column(ForeignKey("import_batch.id"), index=True)
    row_no: Mapped[int] = mapped_column(Integer)
    raw: Mapped[dict | None] = mapped_column(JSONB)
    result: Mapped[str | None] = mapped_column(String(16))
    reason: Mapped[str | None] = mapped_column(Text)


# ---------------------------------------------------------------- 6. 系统与权限
class SysRole(Base):
    __tablename__ = "sys_role"

    key: Mapped[str] = mapped_column(String(16), primary_key=True)
    name: Mapped[str] = mapped_column(String(64))
    tier: Mapped[str | None] = mapped_column(String(16))
    tier_tip: Mapped[str | None] = mapped_column(String(64))
    note: Mapped[str | None] = mapped_column(Text)
    scope: Mapped[str | None] = mapped_column(String(32))
    users: Mapped[int | None] = mapped_column(Integer)


class SysAccount(Base):
    __tablename__ = "sys_account"

    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    name: Mapped[str] = mapped_column(String(32))
    account: Mapped[str] = mapped_column(String(64), unique=True)
    unit: Mapped[str | None] = mapped_column(String(64))
    role_key: Mapped[str | None] = mapped_column(ForeignKey("sys_role.key"))
    scope: Mapped[str | None] = mapped_column(String(32))
    login: Mapped[str | None] = mapped_column(String(32))
    status: Mapped[str | None] = mapped_column(String(16))


class Perm(Base):
    __tablename__ = "perm"

    code: Mapped[str] = mapped_column(String(48), primary_key=True)
    grp: Mapped[str | None] = mapped_column(String(32))
    name: Mapped[str | None] = mapped_column(String(64))
    is_approve: Mapped[bool] = mapped_column(Boolean, default=False)  # 仅明文导出审批用


class RolePerm(Base):
    __tablename__ = "role_perm"
    __table_args__ = (UniqueConstraint("role_key", "perm_code", name="uq_role_perm"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    role_key: Mapped[str] = mapped_column(ForeignKey("sys_role.key"), index=True)
    perm_code: Mapped[str] = mapped_column(ForeignKey("perm.code"), index=True)


class FieldPolicy(Base):
    __tablename__ = "field_policy"

    field_key: Mapped[str] = mapped_column(String(32), primary_key=True)
    name: Mapped[str | None] = mapped_column(String(32))
    level: Mapped[str | None] = mapped_column(String(16))
    hint: Mapped[str | None] = mapped_column(String(128))
    mask: Mapped[dict | None] = mapped_column(JSONB)


class DictType(Base):
    __tablename__ = "dict_type"

    key: Mapped[str] = mapped_column(String(16), primary_key=True)
    grp: Mapped[str | None] = mapped_column(String(32))
    name: Mapped[str | None] = mapped_column(String(64))
    sub: Mapped[str | None] = mapped_column(String(128))
    unit: Mapped[str | None] = mapped_column(String(16))
    cols: Mapped[list | None] = mapped_column(JSONB)
    row_count: Mapped[int] = mapped_column(Integer, default=0)


class DictItem(Base):
    __tablename__ = "dict_item"
    __table_args__ = (UniqueConstraint("type_key", "code", name="uq_dict_item"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    type_key: Mapped[str] = mapped_column(ForeignKey("dict_type.key"), index=True)
    code: Mapped[str] = mapped_column(String(32))
    name: Mapped[str | None] = mapped_column(String(64))
    dept_id: Mapped[str | None] = mapped_column(String(64))
    extra: Mapped[dict | None] = mapped_column(JSONB)
    on: Mapped[bool] = mapped_column(Boolean, default=True)
    sort: Mapped[int] = mapped_column(Integer, default=0)


# ---------------------------------------------------------------- 7. 规则、参数与日志
class Rule(Base):
    __tablename__ = "rule"

    code: Mapped[str] = mapped_column(String(16), primary_key=True)
    name: Mapped[str | None] = mapped_column(String(64))
    threshold: Mapped[str | None] = mapped_column(String(32))
    hit: Mapped[int | None] = mapped_column(Integer)
    on: Mapped[bool] = mapped_column(Boolean, default=True)
    level: Mapped[str | None] = mapped_column(String(16))
    to: Mapped[str | None] = mapped_column(String(32))
    cond: Mapped[list | None] = mapped_column(JSONB)
    desc: Mapped[str | None] = mapped_column(Text)


class DqRule(Base):
    __tablename__ = "dq_rule"

    code: Mapped[str] = mapped_column(String(16), primary_key=True)
    name: Mapped[str | None] = mapped_column(String(64))
    desc: Mapped[str | None] = mapped_column(Text)
    hit: Mapped[int | None] = mapped_column(Integer)
    on: Mapped[bool] = mapped_column(Boolean, default=True)
    act: Mapped[str | None] = mapped_column(String(32))


class SystemParam(Base):
    __tablename__ = "system_param"

    key: Mapped[str] = mapped_column(String(32), primary_key=True)
    label: Mapped[str | None] = mapped_column(String(64))
    unit: Mapped[str | None] = mapped_column(String(16))
    value: Mapped[str | None] = mapped_column(String(64))
    rule: Mapped[str | None] = mapped_column(String(64))
    tip: Mapped[str | None] = mapped_column(Text)
    updated_at: Mapped[datetime | None] = mapped_column(DateTime)
    updated_by: Mapped[str | None] = mapped_column(String(32))


class AuditLog(Base):
    __tablename__ = "audit_log"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    at: Mapped[datetime | None] = mapped_column(DateTime, index=True)
    act: Mapped[str | None] = mapped_column(String(32), index=True)
    target: Mapped[str | None] = mapped_column(String(128))
    detail: Mapped[str | None] = mapped_column(Text)
    by: Mapped[str | None] = mapped_column(String(32))
    role: Mapped[str | None] = mapped_column(String(64))
    ip: Mapped[str | None] = mapped_column(String(32))
    mode: Mapped[str | None] = mapped_column(String(16))


class SecurityEvent(Base):
    __tablename__ = "security_event"

    id: Mapped[str] = mapped_column(String(16), primary_key=True)
    name: Mapped[str | None] = mapped_column(String(32))
    account: Mapped[str | None] = mapped_column(String(64))
    role: Mapped[str | None] = mapped_column(String(16))
    unit: Mapped[str | None] = mapped_column(String(64))
    kind: Mapped[str | None] = mapped_column(String(32))
    level: Mapped[str | None] = mapped_column(String(16))
    count: Mapped[int | None] = mapped_column(Integer)
    status: Mapped[str | None] = mapped_column(String(16))
    latest: Mapped[str | None] = mapped_column(String(32))
    owner: Mapped[str | None] = mapped_column(String(32))
    chain: Mapped[list | None] = mapped_column(JSONB)


# ---------------------------------------------------------------- 8. 指标快照
class MetricSnapshot(Base):
    """承载没有逐人明细的两档（中 2284 / 低 2646）与跨表口径（盲区 887 等）。

    唯一写入口是重算任务；页面只读。接真实数据源后逐项被明细聚合替代。
    """

    __tablename__ = "metric_snapshot"

    as_of: Mapped[str] = mapped_column(String(32), primary_key=True)
    in_register: Mapped[int] = mapped_column(Integer)
    high_plus: Mapped[int] = mapped_column(Integer)
    high2: Mapped[int] = mapped_column(Integer)
    mid: Mapped[int] = mapped_column(Integer)
    low: Mapped[int] = mapped_column(Integer)
    unknown: Mapped[int] = mapped_column(Integer)
    dual: Mapped[int] = mapped_column(Integer)
    multi: Mapped[int] = mapped_column(Integer)
    multi2: Mapped[int] = mapped_column(Integer)
    multi3: Mapped[int] = mapped_column(Integer)
    no_basis: Mapped[int] = mapped_column(Integer)
    no_visit30: Mapped[int] = mapped_column(Integer)
    no_visit30_high: Mapped[int] = mapped_column(Integer)
    off_register: Mapped[int] = mapped_column(Integer)
    month_add: Mapped[int] = mapped_column(Integer)
    month_sub: Mapped[int] = mapped_column(Integer)
    ledger_records: Mapped[int] = mapped_column(Integer)
    percent_high: Mapped[float] = mapped_column(Numeric(4, 1))
    dept_person_times: Mapped[int] = mapped_column(Integer)
    dept_multi_persons: Mapped[int] = mapped_column(Integer)
    dual_cross: Mapped[int] = mapped_column(Integer)
    dual_union: Mapped[int] = mapped_column(Integer)
