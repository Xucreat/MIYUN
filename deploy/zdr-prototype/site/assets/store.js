/* ============================================================
   store.js · 会话状态（sessionStorage）
   ------------------------------------------------------------
   解决三个问题：
   1. 演示角色登录后跨页保持（login → dashboard → persons → person）；
   2. 处置一条预警、通过一项审批、登记一次走访后，刷新不回滚、跨页可见；
   3. 所有写操作进入审计流水，档案页可查「谁在什么时候做了什么」。
   数据本体仍在 data.js，这里只存「对数据的改动（delta）」。
   ============================================================ */
window.STORE = (function () {
  'use strict';

  const KEY = 'miyun-demo-v2';
  const SYS_KEY = KEY + ':sys';
  const AUDIT_KEY = KEY + ':audit';
  /* 角色镜像：localStorage 跨标签页共享。
     sessionStorage 不随 target="_blank" 新标签页继承——
     大屏模式（新标签）点「返回工作台」、或从预警/盲区新开系统管理，
     都会在没有会话存档的新标签里把角色回退成默认政法委主管。 */
  const ROLE_KEY = KEY + ':role';
  /* 演示"今天"：全站时间口径统一为 2026-11-10（时分仍取真实时钟，保证有变化），
     避免真实系统日期与演示数据混排、审计日志出现 11-12 插在 11-10 前面 */
  const DEMO_TODAY = '2026-11-10';
  const D = window.DATA;
  const listeners = [];

  const blank = () => ({
    role: 'admin',
    loggedIn: false,
    alerts: {},        // id -> { status, note, at, by }
    approvals: {},     // id -> { status, note, at, by }
    newApprovals: [],  // 页面内新发起的申请
    newChanges: [],    // 页面内新登记的等级变动（部门自主定级，登记即生效）
    changeNotes: {},   // 变动 id -> { notified, at, by, note } 知会属地应答状态
    levels: {},        // personId -> levelKey（审批通过后生效的等级）
    visits: {},        // personId -> [ {date, way, result, by, at} ]
    disclosures: [],   // { personId, purpose, applicant, at, code, status }
    imports: [],       // { id, name, dept, time, total, ok, dup, fail, operator, status }
    importedPersons: [], // 导入落库的人员快照（跨页重放，保证人员台账可查）
    exports: [],       // { at, scope, count, mode, by }
    wartime: {},       // town -> { at, by, note, zero, rows, hist } 重点时期镇街逐人回填
    wtCfg: null,       // 时期参数覆盖（起止 / 响应级别 / 见面时限 / 零报告截止）
    wtLevels: null,    // 响应等级覆盖（三档可编辑）
    wtPush: [],        // 推送属地书记记录 { at, by, towns, channels, ok, fail, sms }
    plainReqs: [],     // 明文导出申请单 { id, at, by, role, count, purpose, valid, scope, chain, status }
    responders: {},    // id -> { name, unit, title, phone, note } 责任人名录覆盖
    merges: [],        // 并档记录（双在册 → 一人一档）
    assessments: [],   // 补评记录（未定级 → 完成评估并定级）
    sys: null,         // 系统管理配置态（权限矩阵 / 密级 / 阈值 / 规则 / 字典 / 账号 / 草稿 / 版本）
    permList: [],      // 生成的季度权限清单记录
    audit: []          // { at, act, target, detail, by, mode }
  });

  let state = blank();

  function load() {
    let raw = null;
    try {
      raw = sessionStorage.getItem(KEY);
      if (raw) state = Object.assign(blank(), JSON.parse(raw));
    } catch (e) { state = blank(); }
    /* 系统管理配置态额外落 localStorage：草稿与已改配置关掉标签页也不丢 */
    try {
      const sysRaw = localStorage.getItem(SYS_KEY);
      if (sysRaw) state.sys = JSON.parse(sysRaw);
    } catch (e) { /* 隐私模式忽略 */ }
    /* 本标签页没有会话存档（新开标签 / 大屏返回跳转）时，
       从 localStorage 镜像恢复登录角色，避免退回默认政法委主管 */
    if (!raw) {
      try {
        const rk = localStorage.getItem(ROLE_KEY);
        if (rk && D.ROLES[rk]) { state.role = rk; state.loggedIn = true; }
      } catch (e) { /* 隐私模式忽略 */ }
    }
    /* 审计流水镜像：sessionStorage 按标签页隔离，从别的页面 target="_blank"
       新开「系统管理 → 审计日志」时本标签页的 audit 是空的，看起来像"操作没记录"。
       与角色同法：落 localStorage 镜像，load 时合并（按 at+act+detail+target 去重）。 */
    try {
      const aRaw = localStorage.getItem(AUDIT_KEY);
      if (aRaw) {
        const arr = JSON.parse(aRaw) || [];
        const seen = {};
        state.audit.forEach(r => { seen[r.at + '|' + r.act + '|' + (r.detail || '') + '|' + (r.target || '')] = 1; });
        arr.forEach(r => {
          const k = r.at + '|' + r.act + '|' + (r.detail || '') + '|' + (r.target || '');
          if (!seen[k]) state.audit.push(r);
        });
        state.audit.sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')));
        if (state.audit.length > 300) state.audit.length = 300;
      }
    } catch (e) { /* 隐私模式忽略 */ }
  }
  function save() {
    try { sessionStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { /* 隐私模式忽略 */ }
    try { localStorage.setItem(SYS_KEY, JSON.stringify(state.sys || {})); } catch (e) { /* 隐私模式忽略 */ }
  }
  function saveAuditMirror() {
    try { localStorage.setItem(AUDIT_KEY, JSON.stringify(state.audit.slice(0, 300))); } catch (e) { /* 隐私模式忽略 */ }
  }
  function clearSysStore() {
    try { localStorage.removeItem(SYS_KEY); } catch (e) { /* ignore */ }
  }
  function emit() { listeners.forEach(fn => { try { fn(state); } catch (e) { console.error(e); } }); }
  function commit() { save(); emit(); }

  /* ---- 角色 ---- */
  function role() { return D.ROLES[state.role] || D.ROLES.admin; }
  function setRole(key) {
    if (!D.ROLES[key]) return;
    state.role = key;
    state.loggedIn = true;
    try { localStorage.setItem(ROLE_KEY, key); } catch (e) { /* 隐私模式忽略 */ }
    audit('登录', '以「' + D.ROLES[key].roleName + '」身份登录系统', '系统入口');
    commit();
  }
  function logout() { state.loggedIn = false; commit(); }
  function can(perm) {
    /* 权限矩阵覆盖优先（on=允许 / half=受限需审批 / off=禁止）：
       账号与角色页改了矩阵必须真实生效，否则「配置页关了、业务页还能点」两处口径打架 */
    const ov = (sysState().rolePerms[state.role] || {})[perm];
    if (ov === 'off') return false;
    if (ov === 'on' || ov === 'half') return true;
    return !!(role().can || {})[perm];
  }

  /* ---- 数据范围视图（scope=dept 时全站收敛到本部门） ----
     persons 页走 D.scoped(roleKey, list)；其余页面统一用本入口：
     · 元素本身是人员（有 dept）→ 直接比对主责部门；
     · 元素带 personId（预警 / 走访行）→ 按台账人员的部门比对；
     · 元素带 person 复合对象（wartime 未走访行）→ 按行内人员比对。
     无 personId/person 的记录（安全事件类待办）在 dept 视角不可见——
     账号安全类由安全管理员处置，本就不属于业务经办的数据范围。 */
  function view(list) {
    const r = role();
    if (r.scope !== 'dept') return list || [];
    const idx = {};
    D.persons.forEach(p => { idx[p.id] = p; });
    const ok = p => !!p && p.dept === r.dept;
    return (list || []).filter(x => ok(x) || ok(x.person) || ok(idx[x.personId]));
  }

  /* ---- 审计流水 ---- */
  function now() {
    const d = new Date();
    const p = n => String(n).padStart(2, '0');
    return DEMO_TODAY + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }
  function audit(act, detail, target, by) {
    state.audit.unshift({
      at: now(), act, target: target || '', detail: detail || '',
      by: by || role().user, role: by ? (by === '系统' ? '系统' : role().roleName) : role().roleName, mode: '演示环境'
    });
    if (state.audit.length > 300) state.audit.length = 300;
    commit();   /* 立即落盘 sessionStorage：跳转到系统管理-审计日志后仍可追溯 */
    /* 同步 localStorage 镜像（合并后再写，其他标签页写入的记录不丢） */
    try {
      const aRaw = localStorage.getItem(AUDIT_KEY);
      const other = aRaw ? (JSON.parse(aRaw) || []) : [];
      const seen = {};
      state.audit.forEach(r => { seen[r.at + '|' + r.act + '|' + (r.detail || '') + '|' + (r.target || '')] = 1; });
      other.forEach(r => {
        const k = r.at + '|' + r.act + '|' + (r.detail || '') + '|' + (r.target || '');
        if (!seen[k]) state.audit.push(r);
      });
      state.audit.sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')));
      if (state.audit.length > 300) state.audit.length = 300;
      saveAuditMirror();
    } catch (e) { /* 隐私模式忽略 */ }
  }
  function auditOf(limit) { return state.audit.slice(0, limit || 30); }
  /* 按操作类型 / 目标模糊匹配取审计流水（供「留痕」深链落地高亮） */
  function auditMatch(kw) {
    const k = String(kw || '').trim();
    if (!k) return [];
    return state.audit.filter(r => (r.act + r.target + r.detail).indexOf(k) > -1);
  }

  /* ---- 等级覆盖：审批通过后真正改变档案等级 ---- */
  function levelOf(person) {
    return state.levels[person.id] || person.level;
  }
  function applyLevel(personId, levelKey, detail, by) {
    state.levels[personId] = levelKey;
    const p = D.personById(personId);
    if (p) {
      p.level = levelKey;
      D.recalcStats();
      audit('等级变更', (p.name || '') + ' 等级调整为「' + D.levelOf(levelKey).name + '」' + (detail ? '，' + detail : ''), p.no, by);
    }
  }

  /* ---- 预警 ---- */
  function alerts() {
    /* 安全事件衍生待办（越权访问尝试 / 账号长期未用）与业务预警合并展示，
       这样在系统管理里看到的安全事件，在预警待办里也能被处置、留痕。 */
    const sec = SYS_ALERTS.map(a => Object.assign({}, a));
    return D.alerts.concat(sec).map(a => Object.assign({}, a, state.alerts[a.id] || {}));
  }
  function alert(id) { return alerts().find(a => a.id === id); }
  function handleAlert(id, status, note) {
    const a = alert(id);
    state.alerts[id] = Object.assign({}, state.alerts[id] || {}, { status, note: note || '', at: now(), by: role().user });
    audit('预警处置', '「' + (a ? a.rule : id) + '」' + status + (note ? '：' + note : ''), id);
    commit();
  }
  /* 转派：只改接收责任人，不改变处置状态（转派不等于已处置，记录仍留在待办列表） */
  function transferAlert(id, to) {
    const a = alert(id);
    state.alerts[id] = Object.assign({}, state.alerts[id] || {}, {
      assignee: to, assignAt: now(), assignBy: role().user
    });
    audit('预警转派', '「' + (a ? a.rule : id) + '」' + (a ? a.who : '') + ' 转派至 ' + to, id);
    commit();
  }
  function alertStats() {
    const list = alerts();
    const open = list.filter(a => a.status === '待处置').length;
    return { total: list.length, open, doing: list.filter(a => a.status === '处置中').length, done: list.filter(a => a.status === '已闭环').length };
  }

  /* ---- 审批 ---- */
  function approvals() {
    return D.approvals.concat(state.newApprovals || [])
      .map(a => Object.assign({}, a, state.approvals[a.id] || {}));
  }
  function addApproval(rec) {
    state.newApprovals = state.newApprovals || [];
    /* 新申请默认进入待审批：缺 status 会被列表判成「已办」，审批链也会整条标成已完成 */
    rec.status = rec.status || '待审批';
    state.newApprovals.unshift(rec);
    audit('发起等级调整', rec.name + '：' + D.levelOf(rec.curLevel).name + ' → ' + D.levelOf(rec.toLevel).name, rec.personId);
    commit();
    return rec;
  }
  function approval(id) { return approvals().find(a => a.id === id); }
  /* decide(id, pass, note, opt)
     opt.by / opt.byRole：按回避规则由上级代审时，记录真实审批人（审计可追溯）
     opt.chain：审批链快照，写入变动记录 */
  function decide(id, pass, note, opt) {
    const a = approval(id);
    if (!a) return false;
    const o = opt || {};
    const by = o.by || role().user;
    const byRole = o.byRole || role().roleName;
    state.approvals[id] = { status: pass ? '已通过' : '已驳回', note: note || '', at: now(), by, byRole };
    audit(pass ? '审批通过' : '审批驳回',
      a.name + ' ' + a.id + (o.upper ? '（发起人回避 · 上级终审）' : '') + (note ? '：' + note : ''),
      a.personId);
    if (pass) applyLevel(a.personId, a.toLevel, '来源审批单 ' + a.id + (o.upper ? ' · 上级终审' : ''), by);
    commit();
    return true;
  }
  function approvalStats() {
    const list = approvals();
    return {
      total: list.length,
      pending: list.filter(a => a.status === '待审批').length,
      passed: list.filter(a => a.status === '已通过').length,
      rejected: list.filter(a => a.status === '已驳回').length
    };
  }

  /* ---- 等级变动台账（会议决议 D4：政法委无审批职能） ----
     部门自主定级 → 登记留痕即生效 → 政法委侧只做知会/备案，不设审批关口。
     台账 = 本次会话新登记（newChanges，在前）+ data.js 的 46 条历史变动（CHG_FULL）。
     字段与 CHG_FULL 完全一致，故所有消费方（档案、看板、导出、月报）可同源读取。 */
  function changes() {
    return (state.newChanges || []).concat(D.CHG_FULL);
  }
  function change(id) { return changes().find(c => c.id === id); }
  /* 登记一条变动：立刻改写档案等级（部门已定级，无需再走审批），并写审计留痕。
     rec = { personId, name, town, dept, from, to, reason, level, approver } */
  function addChange(rec) {
    state.newChanges = state.newChanges || [];
    const today = now();
    const seq = String(200 + state.newChanges.length);
    const r = {
      id: 'CHG-' + today.slice(0, 4) + today.slice(5, 7) + '-' + seq,
      name: rec.name, town: rec.town || '', dept: rec.dept || '',
      personId: rec.personId, date: today.slice(5, 10),
      from: rec.from, to: rec.to, reason: rec.reason,
      level: rec.level || '部门主管核定',
      approver: rec.approver || role().user,
      at: today, status: '已生效', live: true,
      notified: !!rec.notified
    };
    state.newChanges.unshift(r);
    applyLevel(rec.personId, rec.to, '来源变动登记 ' + r.id, r.approver);
    audit('登记等级变动', r.name + '：' + D.levelOf(r.from).name + ' → ' + D.levelOf(r.to).name, rec.personId);
    commit();
    return r;
  }
  /* 知会属地（不是审批，只改应答状态）：待知会 → 已知会 */
  function notifyChange(id, note) {
    const r = change(id);
    if (!r) return false;
    state.changeNotes = state.changeNotes || {};
    state.changeNotes[id] = { notified: true, at: now(), by: role().user, note: note || '' };
    audit('变动知会属地', (r.name || '') + ' ' + id + '：已通知属地 ' + (r.town || '—'), r.personId);
    commit();
    return true;
  }
  /* notifiedOf：台账行是否已通知属地（历史 46 条视为已通知，新登记默认待通知） */
  function notifiedOf(r) {
    const o = (state.changeNotes || {})[r.id];
    if (o) return o;
    return { notified: r.live ? false : true, at: r.at || '', by: r.approver || '', note: '' };
  }
  function changeStats() {
    const list = changes();
    const up = list.filter(r => D.levelOf(r.to).order < D.levelOf(r.from).order).length;
    return {
      total: list.length, up: up, down: list.length - up,
      live: list.filter(r => r.live).length,
      waiting: list.filter(r => !notifiedOf(r).notified).length
    };
  }

  /* ---- 走访 ---- */
  function visits(person) {
    const extra = state.visits[person.id] || [];
    return extra.concat(D.visitsOf(person));
  }
  function addVisit(personId, rec) {
    const p = D.personById(personId);
    state.visits[personId] = state.visits[personId] || [];
    state.visits[personId].unshift(Object.assign({ at: now(), by: role().user }, rec));
    if (p) { p.visitGap = 0; p.lastVisit = '2026-11-10'; p.visitTotal = (p.visitTotal || 0) + 1; }
    audit('走访登记', (p ? p.name : '') + '：' + rec.way + '，' + rec.result, p ? p.no : personId);
    commit();
  }

  /* ---- 明文查看申请 ---- */
  function disclosure(personId, purpose) {
    const p = D.personById(personId);
    const code = 'DS-' + new Date().getFullYear() + String(new Date().getMonth() + 1).padStart(2, '0') + String(new Date().getDate()).padStart(2, '0') + '-' + String(100 + state.disclosures.length + 1);
    const rec = { personId, name: p ? p.name : '', purpose, applicant: role().user, at: now(), code, status: '已授权（演示）' };
    state.disclosures.unshift(rec);
    audit('申请查看明文', (p ? p.name : '') + ' · 用途：' + purpose + ' · 已留痕', p ? p.no : personId);
    commit();
    return rec;
  }
  function disclosures(personId) {
    return personId ? state.disclosures.filter(d => d.personId === personId) : state.disclosures.slice();
  }

  /* ---- 导入批次 ---- */
  function imports() {
    return state.imports.concat(D.imports);
  }
  function addImport(rec) {
    state.imports.unshift(rec);
    audit('数据导入', rec.name + '：新增 ' + rec.ok + ' · 重复 ' + rec.dup + ' · 失败 ' + rec.fail, rec.id);
    commit();
  }
  /* 导入落库的人员快照：写入会话，跳页/刷新后重放回 DATA.persons，
     从而人员台账、一人一档、驾驶舱指标都能看到本次导入结果 */
  function recordImported(list) {
    state.importedPersons = (state.importedPersons || []).concat(list);
    save();
  }
  function replayImported() {
    const list = state.importedPersons || [];
    if (!list.length) return 0;
    let n = 0;
    list.forEach(p => {
      if (!D.persons.some(x => x.id === p.id)) { D.persons.push(Object.assign({}, p, { imported: true })); n++; }
    });
    if (n) { D.stats.inRegister += n; }
    D.recalcStats();
    return n;
  }
  function importedPersons() { return (state.importedPersons || []).slice(); }

  /* ---- 处置责任人名录（基线 DATA.RESPONDERS + 会话内维护项） ---- */
  const KIND_ORDER = { '区级': 0, '部门': 1, '属地': 2 };
  function responders() {
    const base = (D.RESPONDERS || []).map(r => Object.assign({}, r, (state.responders || {})[r.id] || {}));
    const extra = Object.keys(state.responders || {})
      .filter(id => !base.some(b => b.id === id))
      .map(id => Object.assign({ id }, state.responders[id]));
    return base.concat(extra).sort((a, b) =>
      (KIND_ORDER[a.kind] - KIND_ORDER[b.kind]) || String(a.unit).localeCompare(String(b.unit), 'zh'));
  }
  function respondersOf(kind) {
    return responders().filter(r => !kind || r.kind === kind);
  }
  function updateResponder(id, patch) {
    state.responders = state.responders || {};
    state.responders[id] = Object.assign({}, state.responders[id] || {}, patch);
    const merged = responders().find(r => r.id === id) || {};
    audit('维护责任人', (merged.name || id) + '（' + (merged.unit || '') + ' · ' + (merged.title || '') + '）已更新',
      '责任人名录 · ' + id);
    commit();
    return merged;
  }

  /* ---- 盲区化解：并档（双在册→一人一档）/ 补评（未定级→完成评估） ----
     两条链路都会真实改变 DATA 里的盲区判定字段，并把记录写进会话 + 审计，
     因此「本月盲区化解」卡片的计数、清单条数、驾驶舱指标会同步变化。 */
  function docNo(prefix) {
    const d = new Date();
    const p = n => String(n).padStart(2, '0');
    const ymd = '' + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate());
    const n = (state.merges || []).length + (state.assessments || []).length + 14;
    return prefix + '-' + ymd + '-' + String(n).padStart(3, '0');
  }

  /* 并档：把一条双在册人员从「双在册」清单移出（dual=false），留下合并记录 */
  function mergeBlind(ids, opt) {
    const o = opt || {};
    const list = (ids || []).map(id => D.personById(id)).filter(Boolean);
    if (!list.length) return null;
    const rec = {
      at: now(), by: role().user, byRole: role().roleName,
      code: docNo('BD'),
      ids: list.map(p => p.id), names: list.map(p => p.name),
      town: list[0].town,
      fromDual: list.map(p => p.dept || '公安分局'),
      main: o.main || (list[0].dept || '公安分局'),
      keep: o.keep || '就高不就低',
      note: o.note || ''
    };
    list.forEach(p => { p.dual = false; });
    state.merges = state.merges || [];
    state.merges.unshift(rec);
    audit('并档合并',
      list.map(p => p.name).join('、') + '：' + rec.fromDual.join(' + ') + ' 两部门会签并档，主责 ' +
      rec.main + '，等级' + rec.keep + (rec.note ? '；' + rec.note : ''),
      rec.code);
    commit();
    return rec;
  }
  function merges() { return (state.merges || []).slice(); }

  /* 补评：未定级人员完成风险评估并定级 → 移出未定级清单 + 转入台账 + 生成等级调整申请（联动待审批） */
  function assessBlind(uid, toLevel, opt) {
    const o = opt || {};
    const pool = D.unrated || [];
    const u = pool.find(x => x.id === uid);
    if (!u) return null;
    const from = u.level;
    u.level = toLevel;
    u.noBasis = false;
    u.status = '已评估（' + (o.via || '联合评估') + '）';
    u.assessedAt = now();
    /* 转入台账：档案页可查、审批单可按 personId 关联 */
    if (!D.personById(u.id)) {
      D.persons.push(u);
      D.stats.inRegister += 1;
      D.stats.unknown = Math.max(0, (D.stats.unknown || 0) - 1);
    }
    D.recalcStats();
    const rec = {
      at: now(), by: role().user, byRole: role().roleName,
      code: docNo('PE'),
      uid: u.id, name: u.name, town: u.town,
      from, to: toLevel,
      via: o.via || '联合评估', org: o.org || '', note: o.note || ''
    };
    state.assessments = state.assessments || [];
    state.assessments.unshift(rec);
    /* 等级须经审批才算数：生成申请单进「调整审批 · 待我审批」 */
    const app = {
      id: 'APP-' + rec.code.replace('PE-', ''),
      personId: u.id, name: u.name, town: u.town,
      deptLevel: D.levelOf(toLevel).name,
      curLevel: from, toLevel,
      applicant: role().user, applicantDept: role().roleName + '（盲区补评）',
      time: rec.at,
      evidence: ['风险评估意见书.pdf', '入户（联合）面访记录.pdf', '评估机构意见 ' + (rec.org || '区卫健委精防办')],
      reason: '盲区补评：' + rec.via + (rec.org ? '（' + rec.org + '）' : '') + '完成风险评估，建议定为' + D.levelOf(toLevel).name + '。' + (rec.note || '')
    };
    addApproval(app);
    audit('盲区补评',
      u.name + '：' + D.levelOf(from).name + ' → ' + D.levelOf(toLevel).name + '，' + rec.via +
      (rec.org ? '（' + rec.org + '）' : '') + '；已生成调整申请 ' + app.id,
      rec.code);
    commit();
    return { rec, app };
  }
  function assessments() { return (state.assessments || []).slice(); }

  /* ---- 导出台账（模拟记录，真实生成 CSV 由页面完成） ---- */
  function addExport(scope, count, mode) {
    const rec = { at: now(), scope, count, mode, by: role().user };
    state.exports.unshift(rec);
    audit('导出台账', scope + ' · ' + count + ' 条 · ' + mode, '台账导出');
    commit();
    return rec;
  }
  function exports() { return state.exports.slice(); }

  /* ---- 重点时期镇街填报（逐人） ----
     state.wartime[town] = { at, by, note, zero, rows:{personId:{status,reason,...}}, hist:[] }
     未填报的镇街回落到 DATA.wartimeRows(town) 的基线（基线本身也逐人对应台账），
     因此「未见面原因分布」永远有人可选、可点、可导出，不再是一份孤立汇总数。 */
  /* 基线：20 个镇街中 6 个未提交零报告（与页面「6 镇街未报 / 14 20 镇街」口径一致） */
  const WT_NOT_REPORTED = ['檀营地区', '溪翁庄镇', '巨各庄镇', '不老屯镇', '东邵渠镇', '北庄镇'];

  function wtRows(town) {
    const base = D.wartimeRows(town);
    const delta = state.wartime[town];
    if (!delta || !delta.rows) return base;
    return base.map(r => Object.assign({}, r, delta.rows[r.personId] || {}));
  }
  function wtTasks() {
    const deptView = role().scope === 'dept';
    return D.wartime.tasks.map(t => {
      const rows = view(wtRows(t.town));
      if (deptView && !rows.length) return null;   /* 本部门人员未涉及的镇街任务行不显示 */
      const met = rows.filter(r => r.status === 'met').length;
      const miss = rows.length - met;
      const delta = state.wartime[t.town];
      const baseReport = WT_NOT_REPORTED.indexOf(t.town) < 0;
      const reported = delta ? (delta.zero == null ? true : !!delta.zero) : baseReport;
      /* 回填时间与零报告时间是两条独立的流水：
         「已报零报告」不等于「已回填逐人明细」，历史记录里两者曾共用 delta.at，
         这里按 fillAt / zeroAt 精确区分，旧结构回落到 at 保证兼容。 */
      const filled = !!(delta && delta.rows);
      const fillAt = delta
        ? (delta.fillAt || (delta.rows ? (delta.at || '') : ''))
        : '';
      const zeroAt = delta
        ? (delta.zeroAt || (delta.zero ? (delta.at || '') : ''))
        : '';
      return {
        town: t.town, should: rows.length, met, missing: miss, officer: t.officer,
        reported,
        reportAt: reported
          ? (zeroAt ? zeroAt.slice(11) : (baseReport ? (7 + (t.town.length % 2)) + ':' + String(10 + (t.town.length * 7) % 50).padStart(2, '0') : ''))
          : '',
        fillAt: fillAt ? fillAt.slice(11) : '',
        by: delta ? delta.by : '',
        edited: !!(delta && delta.rows),
        filled
      };
    }).filter(Boolean);
  }
  /* 逐人回填：rows 为整镇街的完整快照（含未改动行），note 为镇街整体说明 */
  function wtFill(town, rows, note) {
    const base = D.wartimeRows(town);
    if (!base.length) return null;
    const map = {};
    (rows || []).forEach(r => {
      if (!r || !r.personId) return;
      map[r.personId] = {
        personId: r.personId, status: r.status === 'met' ? 'met' : 'miss',
        reason: r.status === 'met' ? '' : (r.reason || 'other'),
        way: r.way || '', target: r.target || '', at: r.at || '',
        result: r.result || '', due: r.due || '', supervise: !!r.supervise, memo: r.memo || ''
      };
    });
    const prev = state.wartime[town] || {};
    const met = Object.keys(map).filter(id => map[id].status === 'met').length;
    const stamp = now();
    const rec = {
      at: stamp, fillAt: stamp, by: role().user, note: note || '', rows: map,
      /* 逐人明细提交即视为当日已报（零报告随之置真），zeroAt 同步落时间戳 */
      zero: true, zeroAt: prev.zeroAt || stamp,
      hist: (prev.hist || []).concat([{
        at: stamp, by: role().user, note: note || '', met, should: base.length
      }]).slice(-20)
    };
    state.wartime[town] = rec;
    audit('回填见面情况', `${town}：已见 ${met} / 应见 ${base.length}，未见面 ${base.length - met}${note ? '；说明：' + note : ''}`, '重点时期管控');
    commit();
    return rec;
  }
  /* 零报告单独提交/撤回（不等同于逐人回填：允许「已报零报告、明细待补」）
     注意：此操作只写 zeroAt，绝不改动 fillAt / rows，
     否则「未报」点一下就会连带把「回填」列标成已回填。 */
  function wtSetZero(town, on) {
    const prev = state.wartime[town] || {};
    const stamp = now();
    const p = Object.assign({ at: prev.at || stamp, by: role().user, note: prev.note || '', rows: prev.rows || null, hist: prev.hist || [] }, prev);
    p.zero = !!on;
    p.zeroAt = stamp;
    p.by = role().user;
    if (!p.rows) p.at = stamp;
    state.wartime[town] = p;
    audit(on ? '提交零报告' : '撤回零报告', town, '重点时期管控');
    commit();
    return p;
  }
  function wtStats() {
    const list = wtTasks();
    const should = list.reduce((a, t) => a + t.should, 0);
    const met = list.reduce((a, t) => a + t.met, 0);
    const reported = list.filter(t => t.reported).length;
    const filled = list.filter(t => t.filled).length;
    return {
      total: list.length, should, met,
      missing: should - met,
      rate: should ? +((met / should) * 100).toFixed(1) : 0,
      reported, notReported: list.length - reported, filled, unfilled: list.length - filled
    };
  }
  /* 未见面原因分布：按人聚合，卡片 / 悬浮 / 点击弹窗共用同一份数据 */
  function wtReasons() {
    const all = [];
    D.wartime.tasks.forEach(t => {
      wtRows(t.town).forEach(r => {
        if (r.status !== 'miss') return;
        all.push({ town: t.town, officer: t.officer, row: r, person: D.personById(r.personId) });
      });
    });
    const total = all.length;
    const today = '2026-11-10';
    return D.WT_REASONS.map(def => {
      const list = all.filter(x => x.row.reason === def.key);
      const towns = {};
      list.forEach(x => { towns[x.town] = (towns[x.town] || 0) + 1; });
      return {
        key: def.key, name: def.name, color: def.color, desc: def.desc,
        count: list.length,
        pct: total ? +((list.length / total) * 100).toFixed(1) : 0,
        towns: Object.keys(towns).map(k => ({ town: k, n: towns[k] })).sort((a, b) => b.n - a.n),
        overdue: list.filter(x => x.row.due && x.row.due <= today).length,
        supervise: list.filter(x => x.row.supervise).length,
        list
      };
    });
  }
  function wtAllRows() {
    const out = [];
    D.wartime.tasks.forEach(t => view(wtRows(t.town)).forEach(r => out.push(Object.assign({ town: t.town, officer: t.officer }, r))));
    return out;
  }
  function wtHist(town) {
    const d = state.wartime[town];
    return (d && d.hist ? d.hist : []).slice().reverse();
  }

  /* ---- 重点时期参数 / 响应等级 / 推送记录 ---- */
  function wtCfg() { return Object.assign({}, D.WT_CFG, state.wtCfg || {}); }
  function wtSetCfg(patch) {
    state.wtCfg = Object.assign({}, state.wtCfg || {}, patch, { updatedAt: now(), updatedBy: role().user });
    const c = wtCfg();
    audit('修改时期参数', `起止 ${c.start} ~ ${c.end} · 响应 ${c.level} · 见面时限 ${c.visitLimit} 日 · 零报告截止 ${c.reportDue}`, '重点时期管控');
    commit();
    return c;
  }
  /* 时期进度：起止日期唯一来源，避免 hero 天数与配置弹窗各说一套 */
  const WT_TODAY = '2026-11-10';   // 原型基准日（全站演示数据以此为「今天」）
  function wtToday() { return WT_TODAY; }
  function wtPeriod() {
    const c = wtCfg();
    const D0 = 86400000;
    const s = new Date(c.start + 'T00:00:00');
    const e = new Date(c.end + 'T00:00:00');
    const t = new Date(WT_TODAY + 'T00:00:00');
    const days = Math.max(1, Math.round((e - s) / D0) + 1);
    const dayNow = Math.min(days, Math.max(0, Math.round((t - s) / D0) + 1));
    return { start: c.start, end: c.end, days, dayNow, left: Math.max(0, days - dayNow), today: WT_TODAY };
  }
  /* 等级统一补派生文案：结构化字段是唯一真相，visit / report / scopeText 由它算 */
  function wtLevels() {
    return (state.wtLevels || D.WT_LEVELS).map(x => {
      const txt = D.wtLevelText(x);
      return Object.assign({}, x, {
        visitEvery: txt.visitEvery, reportEvery: txt.reportEvery,
        reportDue: txt.due, scope: txt.scope,
        visit: txt.visit, report: txt.report, scopeText: txt.scopeText
      });
    });
  }
  function wtSetLevels(list) {
    state.wtLevels = (list || []).map(x => Object.assign({}, x));
    commit();
    return wtLevels();
  }
  function wtSetLevel(key) {
    const lv = wtLevels().find(x => x.key === key);
    if (!lv) return null;
    wtSetCfg({ level: key });
    return lv;
  }
  function wtLevel() {
    const k = wtCfg().level;
    return wtLevels().find(x => x.key === k) || wtLevels()[0];
  }

  /* ---------- 等级 ↔ 时期参数的真实联动 ----------
     时期配置里的 visitLimit / reportDue 是「本期实际执行值」，等级提供默认值。
     切换生效等级时，由 UI 询问用户是否把这两个字段重置为该等级默认值。 */
  function wtLevelDefaults(key) {
    const lv = wtLevels().find(x => x.key === (key || wtCfg().level)) || wtLevels()[0];
    return {
      key: lv.key, name: lv.name,
      visitLimit: lv.visitEvery,          // 见面时限（日）
      reportDue: lv.reportDue,            // 零报告截止（HH:MM）
      reportEvery: lv.reportEvery,
      scopeText: lv.scopeText
    };
  }
  /* 全站统一取数入口：hero、镇街表、应见未见、督办单、报送单都读这里 */
  function wtEffective() {
    const c = wtCfg();
    const lv = wtLevel();
    const dft = wtLevelDefaults(lv.key);
    return {
      levelKey: lv.key, levelName: lv.name, levelColor: lv.color,
      visitLimit: Number(c.visitLimit) > 0 ? Number(c.visitLimit) : dft.visitLimit,
      reportDue: /^\d{2}:\d{2}$/.test(c.reportDue || '') ? c.reportDue : dft.reportDue,
      escalateHours: Number(c.escalateHours) > 0 ? Number(c.escalateHours) : 2,
      reportEvery: dft.reportEvery,
      scopeText: dft.scopeText,
      /* origin 供 UI 标注「继承自 X 级」还是「本期自定义」 */
      origin: {
        visit: Number(c.visitLimit) === dft.visitLimit ? 'level' : 'cfg',
        due: c.reportDue === dft.reportDue ? 'level' : 'cfg'
      },
      today: WT_TODAY
    };
  }
  /* 零报告截止判定：以基准日的当前时刻（固定 09:30）比对 reportDue */
  function wtCutoff() {
    const eff = wtEffective();
    const nowMin = 9 * 60 + 30;                        // 演示「当前时刻」
    const [h, m] = eff.reportDue.split(':').map(Number);
    const dueMin = h * 60 + m;
    return { due: eff.reportDue, nowMin, dueMin, overdue: nowMin > dueMin, leftMin: dueMin - nowMin };
  }
  /* 已过截止仍未报零报告的镇街 */
  function wtOverdueTowns() {
    const cut = wtCutoff();
    if (!cut.overdue) return [];
    return wtTasks().filter(t => !t.reported).map(t => t.town);
  }
  /* 见面时限判定：已见面人员的下次应见日期 = 见面日 + visitLimit；
     未见面人员以其「预计复访」为准。超过本期基准日的都算超期。 */
  function wtVisitOverdue(town) {
    const eff = wtEffective();
    const D0 = 86400000;
    const base = new Date(WT_TODAY + 'T00:00:00');
    return wtRows(town).filter(r => {
      if (r.status !== 'met') return false;
      const d = new Date(String(r.at).slice(0, 10) + 'T00:00:00');
      if (isNaN(d)) return false;
      return Math.round((base - d) / D0) >= eff.visitLimit;
    });
  }
  function wtPushLog() { return (state.wtPush || []).slice(); }
  function wtAddPush(rec) {
    state.wtPush = state.wtPush || [];
    state.wtPush.unshift(Object.assign({ at: now(), by: role().user }, rec));
    audit('推送属地书记', (rec.towns || '').toString() + ' · 渠道 ' + (rec.channels || '') + ' · 成功 ' + rec.ok + ' 失败 ' + rec.fail + (rec.sms ? ' · 短信 ' + rec.sms + ' 条' : ''), '重点时期管控');
    commit();
    return state.wtPush[0];
  }

  /* ============================================================
     明文导出申请单（审批中心 · 明文导出页签的数据源）
     ------------------------------------------------------------
     过去「明文导出申请已提交，审批通过后可下载」是空头承诺：
     没有申请单、没有审批人、没有可下载的凭据。此处把申请单落成
     真实对象，审批链按条数自动决定单人审批 / 双人复核。
     ============================================================ */
  const PLAIN_SEED = [
    {
      id: 'PE-20261110-02', at: '2026-11-10 09:12', by: '周敏', role: '区信访办 · 业务主管',
      count: 42, purpose: '重点时期盯控下发', valid: '24 小时',
      scope: '等级 高风险及以上，镇街 鼓楼街道/果园街道，近 30 日未走访',
      mode: 'single', status: 'pending',
      chain: [{ role: '政法委主管', name: '陈志远', status: 'pending', at: '', note: '' }]
    },
    {
      id: 'PE-20261109-01', at: '2026-11-09 16:40', by: '陈志远', role: '区委政法委 · 主管',
      count: 63, purpose: '重点时期盯控下发', valid: '24 小时',
      scope: '等级 高风险及以上，镇街 全区，近 7 日未走访',
      mode: 'double', status: 'approved', downloadable: true, approvedAt: '2026-11-09 17:05',
      chain: [
        { role: '政法委主管', name: '陈志远', status: 'approved', at: '2026-11-09 16:58', note: '同意' },
        { role: '保密专员', name: '李海涛', status: 'approved', at: '2026-11-09 17:05', note: '复核无异常' }
      ]
    }
  ];
  function plainReqs() {
    if (!state.plainSeeded) {
      state.plainSeeded = true;
      state.plainReqs = PLAIN_SEED.map(x => JSON.parse(JSON.stringify(x)));
      commit();
    }
    return (state.plainReqs || []).map(x => JSON.parse(JSON.stringify(x)));
  }
  /* 提交申请：按条数自动决定审批链（<50 单人审批 / ≥50 双人复核） */
  function plainReqAdd(rec) {
    const list = plainReqs();
    const day = WT_TODAY.replace(/-/g, '');
    /* 序号取当日已有编号的最大值 +1，避免与种子单撞号 */
    const maxSeq = list.reduce((mx, x) => {
      const m = new RegExp('^PE-' + day + '-(\\d+)$').exec(x.id || '');
      return m ? Math.max(mx, parseInt(m[1], 10)) : mx;
    }, 0);
    const seq = maxSeq + 1;
    const mode = (rec.count >= 50) ? 'double' : 'single';
    const chain = [{ role: '政法委主管', name: '陈志远', status: 'pending', at: '', note: '' }];
    if (mode === 'double') chain.push({ role: '保密专员', name: '李海涛', status: 'wait', at: '', note: '' });
    const item = Object.assign({
      id: 'PE-' + day + '-' + String(seq).padStart(2, '0'),
      at: now(), by: role().user, role: role().roleName,
      mode, status: 'pending', chain
    }, rec);
    state.plainReqs = [item].concat(state.plainReqs || []);
    audit('提交明文导出申请', `${item.id} · ${item.count} 人 · 用途 ${item.purpose} · 有效期 ${item.valid} · ${mode === 'double' ? '双人复核' : '单人审批'}`, '组合查询');
    commit();
    return item;
  }
  /* 审批推进：逐级通过，全部通过后才置为可下载 */
  function plainReqDecide(id, decision, note) {
    const list = plainReqs();
    const it = list.find(x => x.id === id);
    if (!it) return null;
    const chain = it.chain.slice();
    if (decision === 'reject') {
      const cur = chain.find(a => a.status === 'pending');
      if (cur) { cur.status = 'rejected'; cur.at = now(); cur.by = role().user; cur.note = note || ''; }
      it.status = 'rejected';
    } else {
      const idx = chain.findIndex(a => a.status === 'pending');
      if (idx < 0) return it;
      chain[idx].status = 'approved';
      chain[idx].at = now();
      chain[idx].by = role().user;
      chain[idx].note = note || '';
      if (chain[idx + 1] && chain[idx + 1].status === 'wait') chain[idx + 1].status = 'pending';
      it.status = chain.some(a => a.status === 'pending') ? 'pending' : 'approved';
      if (it.status === 'approved') { it.downloadable = true; it.approvedAt = now(); }
    }
    it.chain = chain;
    state.plainReqs = list;
    audit(decision === 'reject' ? '驳回明文导出申请' : '审批明文导出申请',
      `${id} · ${it.count} 人 · 当前状态 ${it.status === 'approved' ? '已通过' : it.status === 'rejected' ? '已驳回' : '审批中'}${note ? ' · ' + note : ''}`,
      '等级变动 · 明文导出');
    commit();
    return it;
  }
  /* 下载凭据：审批通过后由审计日志反查（原型只落一条导出流水） */
  function plainReqDownload(id) {
    const it = plainReqs().find(x => x.id === id);
    if (!it || !it.downloadable) return null;
    addExport('明文导出下载 · ' + id + ' · ' + it.count + ' 人', it.count, '明文');
    audit('下载明文导出', `${id} · ${it.count} 人 · 用途 ${it.purpose} · 有效期 ${it.valid}`, '组合查询');
    commit();
    return it;
  }

  /* ============================================================
     系统管理 · 可编辑后台（演示态）
     ------------------------------------------------------------
     权限矩阵 / 字段密级 / 脱敏策略 / 阈值参数 / 预警规则 / 数据质量规则 /
     账号 / 字典 / 发布版本 全部可在「系统管理」里改，改动落会话并写审计。
     规则定义只有一份：预警待办、数据看板、驾驶舱都读 rules()，
     所以在系统管理里新增/停用/改阈值，其它页面立刻跟着变。
     ============================================================ */
  const PERM_TXT = { on: '允许', half: '受限需审批', off: '禁止' };
  const DESENS_BASE = [
    { key: 'name', field: '姓名', mode: '明文', cond: '无需申请；脱敏导出保留姓氏' },
    { key: 'idNo', field: '身份证号', mode: '掩码', cond: '双人复核；禁止明文导出' },
    { key: 'phone', field: '联系电话', mode: '掩码', cond: '本部门可直接看；导出脱敏' },
    { key: 'addr', field: '现住址', mode: '到社区', cond: '属地经办可见；导出脱敏至社区' },
    { key: 'attach', field: '评估材料附件', mode: '需申请', cond: '对口部门 + 政法委；禁止导出' },
    { key: 'family', field: '家属联系人', mode: '掩码', cond: '属地经办可申请；禁止批量导出' }
  ];
  const DESENS_MODES = ['明文', '掩码', '到社区', '需申请', '禁止展示'];

  function sysState() {
    if (!state.sys) state.sys = {};
    const s = state.sys;
    s.rolePerms = s.rolePerms || {};
    s.fieldMask = s.fieldMask || {};
    s.desens = s.desens || {};
    s.params = s.params || {};
    s.rules = s.rules || {};
    s.newRules = s.newRules || [];
    s.dq = s.dq || {};
    s.newDq = s.newDq || [];
    s.accounts = s.accounts || {};
    s.newAccounts = s.newAccounts || [];
    s.dicts = s.dicts || {};
    s.events = s.events || {};
    s.draft = s.draft || null;
    s.ver = s.ver || null;
    return s;
  }

  /* ---- 角色权限矩阵 ---- */
  function rolePerms(roleKey) {
    const base = D.SYS_ROLE_PERMS[roleKey] || {};
    return Object.assign({}, base, sysState().rolePerms[roleKey] || {});
  }
  function setRolePerm(roleKey, code, val) {
    const s = sysState();
    s.rolePerms[roleKey] = Object.assign({}, s.rolePerms[roleKey] || {}, { [code]: val });
    const rn = (D.SYS_ROLE_OF[roleKey] || {}).name || roleKey;
    const pn = D.SYS_PERM_NAME[code] || code;
    markDraft('权限矩阵', rn + ' · ' + pn + ' → ' + (PERM_TXT[val] || val));
    audit('调整角色权限', rn + ' · ' + pn + ' 设为「' + (PERM_TXT[val] || val) + '」', '账号与角色');
    commit();
  }
  function resetRolePerm(roleKey) {
    const s = sysState();
    delete s.rolePerms[roleKey];
    const rn = (D.SYS_ROLE_OF[roleKey] || {}).name || roleKey;
    markDraft('权限矩阵', rn + ' 恢复为基线授权');
    audit('重置角色权限', rn + ' 恢复为基线授权', '账号与角色');
    commit();
  }
  function permStat(roleKey) {
    const m = rolePerms(roleKey);
    const on = Object.keys(m).filter(k => m[k] === 'on').length;
    const half = Object.keys(m).filter(k => m[k] === 'half').length;
    return { on, half, off: D.SYS_PERM_ALL.length - on - half, total: D.SYS_PERM_ALL.length };
  }

  /* ---- 字段密级 ---- */
  function maskMap() {
    const s = sysState();
    const out = {};
    Object.keys(D.SYS_MASK).forEach(f => {
      out[f] = Object.assign({}, D.SYS_MASK[f], s.fieldMask[f] || {});
    });
    return out;
  }
  function setFieldMask(roleKey, fieldKey, mode) {
    const s = sysState();
    s.fieldMask[fieldKey] = Object.assign({}, s.fieldMask[fieldKey] || {}, { [roleKey]: mode });
    const fn = (D.SYS_FIELDS.find(f => f.key === fieldKey) || {}).name || fieldKey;
    const rn = (D.SYS_ROLE_OF[roleKey] || {}).name || roleKey;
    markDraft('字段密级', fn + ' · ' + rn + ' → ' + mode);
    audit('调整字段密级', fn + ' · ' + rn + ' 设为「' + mode + '」', '账号与角色');
    commit();
  }

  /* ---- 脱敏与导出策略 ---- */
  function desens() {
    const s = sysState();
    return DESENS_BASE.map(b => Object.assign({}, b, s.desens[b.key] || {}));
  }
  function setDesens(key, patch) {
    const s = sysState();
    s.desens[key] = Object.assign({}, s.desens[key] || {}, patch);
    const row = desens().find(x => x.key === key) || {};
    markDraft('脱敏策略', row.field + '：' + (patch.mode ? '默认展示 → ' + patch.mode : '') + (patch.cond ? ' 条件已更新' : ''));
    audit('调整脱敏策略', row.field + (patch.mode ? ' · 默认展示 ' + patch.mode : '') + (patch.cond ? ' · 条件：' + patch.cond : ''), '规则与参数');
    commit();
  }

  /* ---- 阈值参数（与预警规则条件双向绑定） ---- */
  function paramsMap() {
    const s = sysState();
    const m = {};
    D.SYS_PARAMS.forEach(p => { m[p.key] = Object.assign({}, p, s.params[p.key] || {}); });
    return m;
  }
  function paramByKey(key) { return paramsMap()[key]; }
  function paramText(key) {
    const p = paramByKey(key);
    if (!p) return '';
    return String(p.value) + (p.unit ? ' ' + p.unit : '');
  }
  /* 参数 → 规则：重算引用该参数的规则阈值文案 */
  function setParam(key, value) {
    const s = sysState();
    const p = paramByKey(key);
    if (!p) return null;
    const old = p.value;
    s.params[key] = Object.assign({}, s.params[key] || {}, { value });
    const p2 = paramByKey(key);
    markDraft('阈值参数', p.label + '：' + old + ' → ' + value + (p2.unit ? ' ' + p2.unit : ''));
    audit('修改阈值参数', p.label + '：' + old + ' → ' + value + (p2.unit ? ' ' + p2.unit : '') + '，引用规则条件同步更新', '规则与参数');
    commit();
    return p2;
  }

  /* ---- 预警规则（全站唯一来源） ---- */
  function ruleThreshold(rule) {
    if (!rule.cond) return rule.threshold;
    const first = rule.cond.find(c => c.p);
    if (!first) return rule.threshold;
    return paramText(first.p) || rule.threshold;
  }
  function rules() {
    const s = sysState();
    const base = D.RULES.map(r => Object.assign({}, r, s.rules[r.code] || {}));
    const extra = s.newRules.map(r => Object.assign({}, r));
    return base.concat(extra).map(r => {
      const out = Object.assign({}, r);
      out.threshold = ruleThreshold(out);
      return out;
    });
  }
  function ruleOf(code) { return rules().find(r => r.code === code); }
  function setRule(code, patch) {
    const s = sysState();
    s.rules[code] = Object.assign({}, s.rules[code] || {}, patch);
    const r = ruleOf(code) || {};
    markDraft('预警规则', (code + ' ' + (r.name || '')).trim() + '：' + Object.keys(patch).map(k => k + '=' + patch[k]).join(' · '));
    audit('修改预警规则', (code + ' ' + (r.name || '')).trim(), '规则与参数');
    commit();
    return ruleOf(code);
  }
  function toggleRule(code, on) {
    const r = ruleOf(code);
    if (!r) return;
    /* 直接改状态并只写一条审计：此前借道 setRule() 会同时写「修改预警规则」+「停用/启用」两条 */
    const s = sysState();
    s.rules[code] = Object.assign({}, s.rules[code] || {}, { on: !!on });
    markDraft('预警规则', code + ' ' + (r.name || '') + '：' + (on ? '启用' : '停用'));
    audit(on ? '启用预警规则' : '停用预警规则', code + ' ' + r.name + '，明日 06:00 扫描起生效', '规则与参数');
    commit();
    return ruleOf(code);
  }
  function addRule(rec) {
    const s = sysState();
    const n = 14;
    const code = rec.code || ('RG-' + String(s.newRules.length + n).padStart(2, '0'));
    const item = Object.assign({
      code, name: '', desc: '', cond: [{ t: '' }], hit: 0, count: 0,
      on: true, level: 'mid', to: '政法委主管', isNew: true
    }, rec, { code });
    s.newRules.push(item);
    markDraft('预警规则', '新增 ' + code + ' ' + item.name);
    audit('新增预警规则', code + ' ' + item.name + '：' + ruleCondText(item), '规则与参数');
    commit();
    return item;
  }
  function ruleCondText(rule) {
    if (!rule.cond) return rule.threshold || '';
    return rule.cond.map(c => c.p ? paramText(c.p) : c.t).join('');
  }

  /* ---- 数据质量规则（与数据看板「报送质量」同源） ---- */
  function dqRules() {
    const s = sysState();
    const base = D.DQ_RULES.map(r => Object.assign({}, r, s.dq[r.code] || {}));
    return base.concat(s.newDq.map(r => Object.assign({}, r)));
  }
  function setDq(code, patch) {
    const s = sysState();
    const isNew = s.newDq.some(r => r.code === code);
    if (isNew) {
      s.newDq = s.newDq.map(r => r.code === code ? Object.assign({}, r, patch) : r);
    } else {
      s.dq[code] = Object.assign({}, s.dq[code] || {}, patch);
    }
    const r = dqRules().find(x => x.code === code) || {};
    markDraft('数据质量规则', code + ' ' + (r.name || '') + ' 已更新');
    audit('修改数据质量规则', code + ' ' + (r.name || ''), '规则与参数');
    commit();
    return dqRules().find(x => x.code === code);
  }
  function addDq(rec) {
    const s = sysState();
    const seq = D.DQ_RULES.length + s.newDq.length + 1;
    const code = rec.code || ('DQ-' + String(seq).padStart(2, '0'));
    const item = Object.assign({ code, name: '', desc: '', hit: 0, on: true, act: '告警', isNew: true }, rec, { code });
    s.newDq.push(item);
    markDraft('数据质量规则', '新增 ' + code + ' ' + item.name);
    audit('新增数据质量规则', code + ' ' + item.name + '：' + item.desc, '规则与参数');
    commit();
    return item;
  }

  /* ---- 账号 ---- */
  function accounts() {
    const s = sysState();
    const base = D.SYS_ACCOUNTS.map(a => Object.assign({}, a, s.accounts[a.id] || {}));
    return base.concat(s.newAccounts);
  }
  function accountsOf(roleKey) {
    const list = accounts();
    return roleKey ? list.filter(a => a.role === roleKey) : list;
  }
  function setAccount(id, patch) {
    const s = sysState();
    const isNew = s.newAccounts.some(a => a.id === id);
    if (isNew) {
      s.newAccounts = s.newAccounts.map(a => a.id === id ? Object.assign({}, a, patch) : a);
    } else {
      s.accounts[id] = Object.assign({}, s.accounts[id] || {}, patch);
    }
    const a = accounts().find(x => x.id === id) || {};
    markDraft('账号', (a.name || id) + ' 信息已更新');
    audit('编辑账号', (a.name || id) + '（' + (a.account || '') + '）' + (patch.role ? ' 角色 → ' + ((D.SYS_ROLE_OF[patch.role] || {}).name || patch.role) : '') + (patch.status ? ' 状态 → ' + patch.status : ''), '账号与角色');
    commit();
    return a;
  }
  function addAccount(rec) {
    const s = sysState();
    const seq = D.SYS_ACCOUNTS.length + s.newAccounts.length + 1;
    const item = Object.assign({
      id: 'ACC-' + String(seq).padStart(3, '0'), name: '', account: '', unit: '', role: 'R4',
      scope: '本部门来源人员', login: '尚未登录', status: '正常', isNew: true
    }, rec);
    s.newAccounts.push(item);
    markDraft('账号', '新增账号 ' + item.name + '（' + item.account + '）');
    audit('新建账号', item.name + '（' + item.account + '）· ' + item.unit + ' · ' + ((D.SYS_ROLE_OF[item.role] || {}).name || item.role), '账号与角色');
    commit();
    return item;
  }

  /* ---- 字典 ---- */
  function dictRows(key) {
    const s = sysState();
    const def = D.SYS_DICT_OF[key];
    if (!def) return [];
    const ov = s.dicts[key] || {};
    const base = def.rows.map(r => Object.assign({}, r, (ov.rows || {})[r.code] || {}));
    let list = base.concat(ov.added || []);
    const order = ov.order;
    if (order && order.length) {
      list = list.slice().sort((a, b) => {
        const ia = order.indexOf(a.code), ib = order.indexOf(b.code);
        return (ia < 0 ? 9999 : ia) - (ib < 0 ? 9999 : ib);
      });
    }
    return list;
  }
  function setDictOrder(key, codes) {
    const s = sysState();
    s.dicts[key] = s.dicts[key] || { rows: {}, added: [] };
    s.dicts[key].order = (codes || []).slice();
    const def = D.SYS_DICT_OF[key] || {};
    markDraft('字典', def.name + ' 排序已调整');
    audit('调整字典排序', def.name + '：' + (codes || []).slice(0, 3).join('、') + ((codes || []).length > 3 ? ' 等 ' + codes.length + ' 项' : ''), '数据字典');
    commit();
    return dictRows(key);
  }
  function setDictRow(key, code, patch) {
    const s = sysState();
    s.dicts[key] = s.dicts[key] || { rows: {}, added: [] };
    s.dicts[key].rows = s.dicts[key].rows || {};
    const def = D.SYS_DICT_OF[key] || {};
    const p2 = Object.assign({}, patch);
    /* 「最近变更」不由人工填写：保存即写当天 */
    if ((def.cols || []).some(c => c.k === 'changed')) p2.changed = DEMO_TODAY;
    s.dicts[key].rows[code] = Object.assign({}, s.dicts[key].rows[code] || {}, p2);
    markDraft('字典', def.name + ' · ' + code + ' 已更新');
    audit('修改字典项', def.name + ' · ' + code + (p2.name ? ' 名称 → ' + p2.name : '') + (p2.on != null ? (p2.on ? ' 启用' : ' 停用') : ''), '数据字典');
    commit();
    return dictRows(key).find(r => r.code === code);
  }
  function addDictRow(key, row) {
    const s = sysState();
    s.dicts[key] = s.dicts[key] || { rows: {}, added: [] };
    s.dicts[key].added = s.dicts[key].added || [];
    const def = D.SYS_DICT_OF[key] || {};
    const item = Object.assign({ on: true, refs: 0, changed: DEMO_TODAY, isNew: true }, row);
    s.dicts[key].added.push(item);
    markDraft('字典', def.name + ' · 新增 ' + item.code);
    audit('新增字典项', def.name + ' · ' + item.code + ' ' + (item.name || ''), '数据字典');
    commit();
    return item;
  }

  /* ---- 趋势 / 审批路由 ---- */
  function trend() { return D.SYS_TREND.map(d => Object.assign({}, d)); }
  function routes() { return D.SYS_ROUTES.map(r => Object.assign({}, r, { nodes: r.nodes.slice() })); }

  /* ---- 安全事件（含链路） ---- */
  function events() {
    const s = sysState();
    return D.SYS_EVENTS.map(e => Object.assign({}, e, s.events[e.id] || {}));
  }
  function setEventStatus(id, patch) {
    const s = sysState();
    s.events[id] = Object.assign({}, s.events[id] || {}, patch);
    const e = events().find(x => x.id === id) || {};
    audit('处置安全事件', (e.name || id) + ' · ' + (patch.status || ''), '审计日志');
    commit();
    return events().find(x => x.id === id);
  }

  /* ---- 越权告警待办（安全事件 → 预警待办的联动数据） ---- */
  const SYS_ALERTS = [
    { id: 'AL-2026SEC-001', rule: '越权访问尝试', urgency: 'high', who: '李强', town: '区公安分局', levelName: '—', metric: '3 次越权', dept: '区公安分局', owner: '郭立新', desc: 'R4 公安经办连续 3 次越权访问卫健来源档案，已被策略拦截并推送提醒；达 5 次将自动冻结账号。', created: '2026-11-10 08:58', status: '待处置', security: true },
    { id: 'AL-2026SEC-002', rule: '越权访问尝试', urgency: 'high', who: '王海峰', town: '溪翁庄镇', levelName: '—', metric: '3 次越权', dept: '溪翁庄镇综治中心', owner: '郭立新', desc: 'R5 属地经办越权查询巨各庄镇人员并尝试导出跨辖区名册，3 次均被拦截。', created: '2026-11-10 10:35', status: '待处置', security: true },
    { id: 'AL-2026SEC-003', rule: '账号长期未用', urgency: 'mid', who: '赵鹤', town: '檀营地区', levelName: '—', metric: '100 天未登录', dept: '檀营地区', owner: '刘建国', desc: '账号 100 天未登录已自动冻结，名下待办 2 条已转交属地负责人。', created: '2026-11-10 06:01', status: '处置中', security: true }
  ];

  /* ---- 发布版本 / 草稿 ---- */
  function ver() {
    const s = sysState();
    return s.ver || { no: 'V1.4', at: '2026-11-09 18:30', by: '周文涛', note: '阈值与规则例行修订' };
  }
  function draftOf() { return sysState().draft; }
  function markDraft(section, desc) {
    const s = sysState();
    s.draft = s.draft || { at: now(), by: role().user, savedAt: now(), items: [] };
    s.draft.items.push({ section, desc, at: now(), by: role().user });
    s.draft.at = now();
  }
  /* 显式保存草稿：写入 localStorage（关标签页不丢），并留一条审计 */
  function saveDraft() {
    const s = sysState();
    if (!s.draft) s.draft = { at: now(), by: role().user, savedAt: now(), items: [] };
    s.draft.savedAt = now();
    s.draft.by = role().user;
    audit('保存配置草稿', '草稿 ' + s.draft.items.length + ' 项 · 已存入本地（关闭标签页不丢失）', '规则与参数');
    commit();
    return s.draft;
  }
  function publish(note) {
    const s = sysState();
    const v = ver();
    const num = parseFloat(String(v.no).replace(/[^\d.]/g, '')) || 1.4;
    const next = 'V' + (Math.round((num + 0.1) * 10) / 10).toFixed(1);
    const items = (s.draft && s.draft.items) ? s.draft.items.slice() : [];
    s.ver = { no: next, at: now(), by: role().user, note: note || ('发布 ' + items.length + ' 项变更') };
    s.draft = null;
    audit('发布系统配置', next + ' · ' + s.ver.note + '（变更 ' + items.length + ' 项，次日 06:00 生效）', '规则与参数');
    commit();
    return { ver: s.ver, count: items.length };
  }
  function discardDraft() {
    const s = sysState();
    const n = (s.draft && s.draft.items) ? s.draft.items.length : 0;
    s.draft = null;
    audit('放弃配置草稿', '放弃 ' + n + ' 项未发布变更', '规则与参数');
    commit();
    return n;
  }

  /* ---- 权限清单生成记录 ---- */
  function permListAdd(rec) {
    state.permList = state.permList || [];
    state.permList.unshift(Object.assign({ at: now(), by: role().user }, rec));
    audit('生成权限清单', rec.period + ' · 覆盖 ' + rec.roles + ' 类角色 / ' + rec.accounts + ' 个账号', '账号与角色');
    commit();
    return state.permList[0];
  }
  function permList() { return (state.permList || []).slice(); }

  /* ---- 订阅 / 重置 ---- */
  function on(fn) { listeners.push(fn); return () => { const i = listeners.indexOf(fn); if (i > -1) listeners.splice(i, 1); }; }
  function reset() {
    state = blank();
    state.role = 'admin';
    try { localStorage.removeItem(ROLE_KEY); } catch (e) { /* ignore */ }
    clearSysStore();
    commit();
  }
  function dump() { return JSON.parse(JSON.stringify(state)); }

  load();
  replayImported();
  return {
    role, setRole, logout, can, view,
    audit, auditOf, auditMatch, now,
    levelOf, applyLevel,
    alerts, alert, handleAlert, transferAlert, alertStats,
    approvals, approval, decide, approvalStats, addApproval,
    changes, change, addChange, notifyChange, notifiedOf, changeStats,
    visits, addVisit,
    disclosure, disclosures,
    imports, addImport, recordImported, replayImported, importedPersons,
    responders, respondersOf, updateResponder,
    mergeBlind, merges, assessBlind, assessments,
    addExport, exports,
    wtTasks, wtRows, wtFill, wtSetZero, wtStats, wtReasons, wtAllRows, wtHist,
    wtCfg, wtSetCfg, wtPeriod, wtLevels, wtSetLevels, wtSetLevel, wtLevel,
    wtToday, wtEffective, wtLevelDefaults, wtCutoff, wtOverdueTowns, wtVisitOverdue,
    wtPushLog, wtAddPush,
    plainReqs, plainReqAdd, plainReqDecide, plainReqDownload,
    rolePerms, setRolePerm, resetRolePerm, permStat,
    maskMap, setFieldMask,
    desens, setDesens, DESENS_MODES, PERM_TXT,
    paramsMap, paramByKey, paramText, setParam,
    rules, ruleOf, setRule, toggleRule, addRule, ruleCondText, ruleThreshold,
    dqRules, setDq, addDq,
    accounts, accountsOf, setAccount, addAccount,
    dictRows, setDictRow, addDictRow, setDictOrder,
    trend, routes, events, setEventStatus,
    ver, draftOf, markDraft, saveDraft, publish, discardDraft, permListAdd, permList,
    on, reset, dump,
    get state() { return state; }
  };
})();
