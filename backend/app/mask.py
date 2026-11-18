"""B4：服务端字段掩码。

为什么必须在服务端：前端 `D.field()` 只是「怎么显示」，一旦接真实库，
它拿到的仍是明文 —— 等于假脱敏。掩码只能发生在**离开数据库之后、出网之前**。

模式来源：`field_policy.mask`（9 字段 × 9 角色）取值只有
明 / 掩 / 申（需申请）/ 隐 / 本部门 / 辖区明 六种，本模块只负责执行，不做判断。

返回值约定（与 B5 前端契约一致）：
- 明 → 原值，不进 `maskedFields`
- 掩 / 申 / 辖区明（越界时）→ 掩码串，进 `maskedFields[mode]`（申额外带 `needApply: true`）
- 隐 / 本部门（越界时）→ `None`，进 `maskedFields[mode]`

**隐藏字段给的是 null 而不是「—」**：`—` 是个字符串，一旦前端拿去做导出/检索就会
被当成真实值参与统计；null 才是「这个字段不该给你看」。
"""
from __future__ import annotations

import re

from app.auth import CurrentUser

MODES = ("明", "掩", "申", "隐", "本部门", "辖区明")

# 密级字段 → 掩码算法类别（person 上真实承载的列名与策略键同名，reason/basis/visit/special
# 在库里分别落在 level_change.reason / person.no_basis / visit.result / person_tag.over_limit 等处，
# 由调用方按实际字段名传入 kind）
FIELD_KIND = {
    "name": "name", "idNo": "idNo", "phone": "phone",
    "addr": "addr", "domicile": "addr",
    "reason": "text", "basis": "text", "visit": "text", "special": "text",
}


def mask_name(v: str) -> str:
    return v if len(v) <= 1 else v[0] + "*" * (len(v) - 1)


def mask_id(v: str) -> str:
    return (v[:6] + "********" + v[-4:]) if len(v) >= 12 else "*" * len(v)


def mask_phone(v: str) -> str:
    return (v[:3] + "****" + v[7:]) if len(v) >= 11 else "*" * len(v)


def mask_addr(v: str) -> str:
    """保留到社区，楼栋门牌截断。"""
    out = re.sub(r"\s*\d+\s*号楼.*$", " ****", v)
    if out != v:
        return out
    return (v[:8] + "****") if len(v) > 8 else "****"


def mask_text(v: str) -> str:
    """业务敏感长文本（列入原因 / 评估依据 / 走访内容）：留前 6 字。"""
    return (v[:6] + "****") if len(v) > 6 else "****"


_MASKERS = {"name": mask_name, "idNo": mask_id, "phone": mask_phone,
            "addr": mask_addr, "text": mask_text}


def _mask(kind: str, raw: str) -> str:
    return _MASKERS.get(kind, mask_text)(raw)


def apply_mode(mode: str, kind: str, raw, ctx: dict) -> tuple[object, dict | None]:
    """返回 (出网值, maskedFields 条目)。maskedFields 为 None 表示明文放行。"""
    if raw is None or raw == "":
        return raw, None
    if mode == "明":
        return raw, None
    if mode == "隐":
        return None, {"mode": "隐"}
    if mode == "本部门":
        if ctx.get("dept") and ctx.get("dept") == ctx.get("user_dept"):
            return raw, None
        return None, {"mode": "本部门", "why": "out_of_dept"}
    if mode == "辖区明":
        if ctx.get("town") and ctx.get("town") == ctx.get("user_town"):
            return raw, None
        return _mask(kind, str(raw)), {"mode": "辖区明", "why": "out_of_area"}
    if mode == "申":
        return _mask(kind, str(raw)), {"mode": "申", "needApply": True}
    # 未知模式按「掩」处理：新增模式没登记时宁可少给，不肯多给
    return _mask(kind, str(raw)), {"mode": mode or "掩"}


def apply_person(out: dict, user: CurrentUser, dept: str | None, town: str | None) -> dict:
    """就地改写 person 出参，并附 `maskedFields`。"""
    ctx = {"dept": dept, "town": town, "user_dept": user.dept, "user_town": user.town}
    masked: dict[str, dict] = {}
    for key in ("name", "idNo", "phone", "addr"):
        if key not in out:
            continue
        mode = user.field_mode(key)
        value, info = apply_mode(mode, FIELD_KIND[key], out.get(key), ctx)
        out[key] = value
        if info:
            masked[key] = info
    if masked:
        out["maskedFields"] = masked
    else:
        out["maskedFields"] = {}
    return out


def apply_field(mode: str, kind: str, raw, ctx: dict) -> tuple[object, dict | None]:
    """给非 person 结构（变动原因、走访内容、预警对象姓名）复用。"""
    return apply_mode(mode, kind, raw, ctx)
