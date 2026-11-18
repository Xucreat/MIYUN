/*
 * 从 docs/prototype-v2/assets/data.js 导出后端种子数据（B2 阶段的输入）。
 *
 * 为什么从 data.js 导：前端的 41 个顶层键就是现成的准 schema，逐键导出比手写 fixture
 * 更准——数字天然对得上，不会出现「库里 486、页面 487」这类漂移。
 *
 * 用法（仓库根目录）：
 *   node backend/tools/export_seed.js
 * 输出：backend/seed/data/*.json
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const DATA_JS = path.join(ROOT, 'docs/prototype-v2/assets/data.js');
const OUT = path.join(ROOT, 'backend/seed/data');

global.window = {};
require(DATA_JS);
const D = global.window.DATA;

fs.mkdirSync(OUT, { recursive: true });
const write = (name, obj) => {
  const f = path.join(OUT, name + '.json');
  // 紧凑格式：这些是生成物，缩进只会让 diff 噪音和体积翻倍
  fs.writeFileSync(f, JSON.stringify(obj), 'utf8');
  const n = Array.isArray(obj) ? obj.length : Object.keys(obj).length;
  console.log((name + '.json').padEnd(26), String(n).padStart(6), '条');
};

/* ---- 部门口径归一：reportMonthly 里写「区公安分局」，persons 里写「公安分局」 ---- */
const DEPT_KEYS = Object.keys(D.DEPT_HEAD);
function normDept(s) {
  if (!s) return null;
  const t = String(s).trim();
  if (DEPT_KEYS.includes(t)) return t;
  const stripped = t.replace(/^区/, '');
  return DEPT_KEYS.includes(stripped) ? stripped : null;
}

/* ---- 1. 字典 ---- */
write('dept', DEPT_KEYS.map((name, i) => ({ code: name, name, head: D.DEPT_HEAD[name], sort: i })));
write('level_dict', D.LEVELS.map(l => ({ key: l.key, name: l.name, cls: l.cls, order: l.order })));
write('tag_dict', D.TAGS.map(t => ({
  code: t.name, name: t.name, dept_id: normDept(t.dept) || null, cls: t.cls, on: true
})));
write('town', D.towns.map(t => ({
  code: t.key, name: t.name, short: t.short, officer: t.officer, title: t.title,
  registered: t.v, high: t.h, villages: t.villages
})));
write('village', D.towns.flatMap(t => t.villages.map((v, i) => ({
  code: t.key + '-' + String(i + 1).padStart(2, '0'), town: t.key, name: v
}))));
write('wt_level', D.WT_LEVELS.map(l => ({
  key: l.key, name: l.name, color: l.color, visit_every: l.visitEvery,
  report_every: l.reportEvery, report_due: l.reportDue, scope: l.scope, active: !!l.active
})));

/* ---- 2. 人员（486 高风险及以上 + 612 待核实） ---- */
const personRow = (p, unrated) => ({
  id: p.id, no: p.no, name: p.name, gender: p.gender, birth: p.birth, id_no: p.idNo,
  phone: p.phone, town: p.town, village: p.village, addr: p.addr,
  primary_dept: normDept(p.dept), dept_raw: p.dept, level: p.level,
  source: p.source, status: p.status, since: p.since, watch: !!p.watch,
  no_basis: !!p.noBasis, last_visit: p.lastVisit, officer: p.officer,
  officer_title: p.officerTitle, is_unrated: unrated,
  dual: !!p.dual, multi: !!p.multi, tags: p.tags || []
});
write('person', D.persons.map(p => personRow(p, false)).concat(D.unrated.map(p => personRow(p, true))));

/* person_tag 单独展开：一人多标签 → 多行；超过 3 个置 over_limit */
const tagRows = [];
const dualRows = [];
D.persons.concat(D.unrated).forEach(p => {
  (p.tags || []).forEach((t, i) => {
    const meta = D.TAGS.find(x => x.name === t);
    tagRows.push({
      person_id: p.id, tag_code: t, dept_id: normDept(meta && meta.dept) || null,
      created_at: '2026-11-10 09:00', created_by: '系统导入',
      note: '来源于' + p.source, over_limit: i >= 3
    });
  });
  if (p.dual) {
    /* 双在册 = 政府台账双重列管标记（口径 A1，独立于标签映射），
       主责部门 + 任一其他部门共管，落一条确认记录 */
    const others = D.TAGS.filter(t => (p.tags || []).indexOf(t.name) > -1)
      .map(t => normDept(t.dept)).filter(d => d && d !== normDept(p.dept));
    const second = others[0] || (normDept(p.dept) === '公安分局' ? '区卫健委' : '公安分局');
    dualRows.push({ person_id: p.id, dept: second, marked_at: '2026-11-09 10:00', by: '台账双重列管标记', note: '' });
  }
});
write('person_tag', tagRows);
write('dual_confirm', dualRows);

/* ---- 3. 走访（与前端 visitsOf 同一套生成逻辑，直接调用现成函数保证一致） ---- */
const visits = [];
D.persons.forEach(p => {
  D.visitsOf(p).forEach((v, i) => {
    visits.push({
      id: p.id + '-V' + String(i + 1).padStart(2, '0'), person_id: p.id,
      date: v.date, way: v.way, result: v.result, by: v.by, at: v.date + ' 16:20'
    });
  });
});
write('visit', visits);

/* ---- 4. 等级变动（46 条，无审批字段） ---- */
write('level_change', D.CHG_FULL.map(c => ({
  id: c.id, person_id: c.personId || null, name: c.name, town: c.town,
  dept_id: normDept(c.dept) || null, from_level: c.from, to_level: c.to,
  reason: c.reason, rule_label: c.level, approver: c.approver,
  occurred_at: c.at, status: '已生效', notified: true, notified_at: c.at
})));
write('level_route', D.SYS_ROUTES.map(r => ({
  target_level: r.to, name: r.name, days: r.days, nodes: r.nodes
})));

/* ---- 5. 预警 / 导入 / 报送 ---- */
write('alert', D.alerts.map(a => ({
  id: a.id, rule_code: a.rule, urgency: a.urgency, person_id: a.personId || null,
  person_name: a.who, town: a.town, level_name: a.levelName, metric: a.metric,
  /* B6-2：dept_id 是能映射到 dept 表的 code，映射不上（如「鼓楼街道综治中心」）就是 NULL；
     责任单位原文必须另存，否则前端只能回落到本地数据。 */
  dept_id: normDept(a.dept) || null, dept_raw: a.dept || null, owner: a.owner, desc: a.desc,
  created_at: a.created, status: a.status
})));
write('import_batch', D.imports.map(i => ({
  id: i.id, name: i.name, dept_id: normDept(i.dept) || null, time: i.time,
  total: i.total, ok: i.ok, dup: i.dup, fail: i.fail, operator: i.operator, status: i.status
})));
write('report_monthly', D.reportMonthly.rows.map(r => ({
  month: D.reportMonthly.month, dept_id: normDept(r.dept) || null,
  should: r.should, real: r.real, late: r.late,
  prev_should: r.prevShould, prev_real: r.prevReal, prev_late: r.prevLate, note: r.note || ''
})));

/* ---- 6. 重点时期 ---- */
write('wartime_period', [{
  id: 'WP-202611', title: D.wartime.title, name: D.wartime.name,
  start: D.wartime.start, end: D.wartime.end, level_key: D.WT_CFG.level,
  cfg: D.WT_CFG, active: true
}]);
write('wartime_task', D.wartime.tasks.map(t => ({
  period_id: 'WP-202611', town: t.town, should: t.should, met: t.met,
  missing: t.missing, officer: t.officer
})));

/* ---- 7. 责任人 / 权限 / 账号 / 字段策略 ---- */
write('responder', D.RESPONDERS.map(r => ({
  id: r.id, name: r.name, unit: r.unit, title: r.title, kind: r.kind, phone: r.phone, note: r.note
})));
write('sys_role', D.SYS_ROLES.map(r => ({
  key: r.key, name: r.name, tier: r.tier, tier_tip: r.tierTip, note: r.note,
  scope: r.scope, users: r.users
})));
write('sys_account', D.SYS_ACCOUNTS.map(a => ({
  id: a.id, name: a.name, account: a.account, unit: a.unit,
  role_key: a.role, scope: a.scope, login: a.login, status: a.status
})));
/* SYS_PERMS = [{ g, items:[{code,name}] }]，SYS_ROLE_PERMS = { role: { code: 'on'|'off' } } */
const permMeta = {};
D.SYS_PERMS.forEach(g => g.items.forEach(it => { permMeta[it.code] = { grp: g.g, name: it.name }; }));
write('perm', D.SYS_PERM_ALL.map(code => ({
  code: code,
  grp: (permMeta[code] || {}).grp || '其他',
  name: (permMeta[code] || {}).name || D.SYS_PERM_NAME[code] || code,
  is_approve: code === 'approve'
})));
write('role_perm', Object.keys(D.SYS_ROLE_PERMS).flatMap(role => {
  const m = D.SYS_ROLE_PERMS[role] || {};
  return Object.keys(m).filter(c => m[c] === 'on').map(c => ({ role_key: role, perm_code: c }));
}));
write('field_policy', D.SYS_FIELDS.map(f => ({
  field_key: f.key, name: f.name, level: f.level, hint: f.hint,
  mask: D.SYS_MASK[f.key] || null
})));

/* ---- 8. 字典 / 参数 / 规则 / 安全事件 ---- */
write('dict_type', D.SYS_DICTS.map(d => ({
  key: d.key, grp: d.group, name: d.name, sub: d.sub, unit: d.unit,
  cols: d.cols, row_count: (d.rows || []).length
})));
write('dict_item', D.SYS_DICTS.flatMap(d => (d.rows || []).map((r, i) => ({
  type_key: d.key, code: r.code || (d.key + '-' + (i + 1)), name: r.name || '',
  dept_id: normDept(r.dept) || null, extra: r, on: r.on !== false, sort: i
}))));
write('system_param', D.SYS_PARAMS.map(p => ({
  key: p.key, label: p.label, unit: p.unit, value: String(p.value), rule: p.rule, tip: p.tip
})));
write('rule', D.RULES.map(r => ({
  code: r.code, name: r.name, threshold: r.threshold, hit: r.hit, on: !!r.on,
  level: r.level, to: r.to, cond: r.cond, desc: r.desc
})));
write('dq_rule', D.DQ_RULES.map(r => ({
  code: r.code, name: r.name, desc: r.desc, hit: r.hit, on: !!r.on, act: r.act
})));
write('security_event', D.SYS_EVENTS.map(e => ({
  id: e.id, name: e.name, account: e.account, role: e.role, unit: e.unit,
  kind: e.kind, level: e.level, count: e.count, status: e.status,
  latest: e.latest, owner: e.owner, chain: e.chain
})));

/* ---- 9. 指标快照：承载没有逐人明细的两档（中 2284 / 低 2646） ---- */
const ds = D.deptStats();
write('metric_snapshot', [{
  as_of: D.meta.asOf,
  in_register: D.stats.inRegister, high_plus: D.stats.highPlus, high2: D.stats.high2,
  mid: D.stats.mid, low: D.stats.low, unknown: D.stats.unknown,
  dual: D.stats.dual, multi: D.stats.multi, multi2: D.stats.multi2, multi3: D.stats.multi3,
  no_basis: D.stats.noBasis, no_visit30: D.stats.noVisit30, no_visit30_high: D.stats.noVisit30High,
  off_register: D.stats.offRegister, month_add: D.stats.monthAdd, month_sub: D.stats.monthSub,
  ledger_records: D.stats.ledgerRecords, percent_high: D.stats.percentHigh,
  dept_person_times: ds.personTimes, dept_multi_persons: ds.multiPersons,
  dual_cross: ds.dualCross, dual_union: ds.dualUnion
}]);

console.log('\n输出目录:', OUT);
console.log('对账基线：person', D.persons.length + D.unrated.length,
  '| level_change', D.CHG_FULL.length,
  '| dual_cross', ds.dualCross, '| dual_union', ds.dualUnion,
  '| dept 人次', ds.personTimes);
