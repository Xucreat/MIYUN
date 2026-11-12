/* ============================================================
   page-risk.js · 风险等级调整与审批
   ------------------------------------------------------------
   关键：审批通过后真正改写档案等级（STORE.applyLevel → DATA.persons）
         再由各页读取 STORE.levelOf() 呈现，做到「一处生效、处处一致」
   ============================================================ */
(function () {
  'use strict';
  const D = window.DATA;
  const esc = UI.esc;
  let curId = null;
  let noteText = '';

  const listBox = document.getElementById('apprList');
  const detail = document.getElementById('detailCard');
  const statEl = document.getElementById('apprStat');
  const hdr = document.getElementById('hdrPending');

  const SHORT = { high2: '极高', high: '高', mid: '中', low: '低', unknown: '待核' };
  const lv = k => D.levelOf(k);

  function pendingFirst() {
    const order = { '待审批': 0, '退回补充': 1, '已通过': 2, '已驳回': 3 };
    return STORE.approvals().slice().sort((a, b) =>
      (order[a.status] - order[b.status]) || b.time.localeCompare(a.time));
  }

  /* ---------- 左栏 ---------- */
  function renderList() {
    const list = pendingFirst();
    const pend = list.filter(a => a.status === '待审批');
    if (!list.length) {
      listBox.innerHTML = UI.empty('暂无审批事项', '可点击右上角「发起调整申请」新增');
    } else {
      listBox.innerHTML = list.map(a => {
        const p = D.personById(a.personId);
        const up = lv(a.toLevel).order < lv(a.curLevel).order;
        const badge = a.status === '待审批'
          ? (a.urgent ? '<span class="tag tag-red">需双人复核</span>' : '<span class="tag tag-green">依据齐全</span>')
          : `<span class="tag ${a.status === '已通过' ? 'tag-green' : a.status === '已驳回' ? 'tag-red' : 'tag-amber'}">${esc(a.status)}</span>`;
        return `<div class="appr-item ${a.id === curId ? 'on' : ''} ${a.status !== '待审批' ? 'done' : ''}" data-id="${a.id}">
          <div class="row" style="gap:6px"><b class="sm">${esc(a.name)}</b>
            <span class="tag ${p.tags[0] === '严重精神障碍' || p.tags[0] === '扬言类重点人' ? 'tag-red' : 'tag-blue'}">${esc(p.tags[0] || '—')}</span>
            <span class="spacer"></span><span class="tiny dim">${esc(a.time.slice(5, 10))}</span></div>
          <div class="row mt6" style="gap:5px;font-size:11px">
            <span class="${lv(a.curLevel).cls}">${SHORT[a.curLevel] || lv(a.curLevel).name}</span>
            <span class="dim">→</span>
            <span class="${lv(a.toLevel).cls}">${SHORT[a.toLevel] || lv(a.toLevel).name}</span>
            <span class="spacer"></span>${badge}</div>
          <div class="tiny dim mt6">${esc(a.applicantDept)}提交 · ${a.curLevel === 'unknown' ? '补评定级' : (up ? '上调' : '下调')} · ${a.status === '待审批' ? '待政法委审批' : esc(a.status + (a.at ? ' ' + a.at.slice(11) : ''))}</div>
        </div>`;
      }).join('');
      listBox.querySelectorAll('.appr-item').forEach(n => {
        n.onclick = () => { curId = n.dataset.id; noteText = ''; renderList(); renderDetail(); };
      });
    }
    if (statEl) statEl.textContent = '待审批 ' + pend.length + ' · 已办 ' + (list.length - pend.length);
    if (hdr) hdr.textContent = pend.length + ' 待审批';
    const cntEl = document.getElementById('apprCnt');
    if (cntEl) cntEl.textContent = pend.length;
    document.querySelectorAll('.nbadge').forEach(n => {
      if (n.closest('[href="risk.html"]')) n.textContent = pend.length;
    });
  }

  /* ---------- 右栏 ---------- */
  function renderDetail() {
    const a = STORE.approval(curId);
    if (!a) {
      detail.innerHTML = `<div class="card-bd">${UI.empty('请选择左侧一条申请', '右侧展示等级差异、评估依据、审批链与审批操作')}</div>`;
      return;
    }
    const p = D.personById(a.personId);
    const up = lv(a.toLevel).order < lv(a.curLevel).order;
    const done = a.status !== '待审批';
    const masked = D.field(STORE.role().key, 'name', p).masked;
    const role = STORE.role();

    /* ---- 审批链（发起人回避 + 按风险序跳级） ----
       规则来源：本页「审批层级规则」四档 + 回避原则（任何人不得审批本人发起的申请）。
       链路：属地/部门提交 → 部门主管核定
             → 政法委审核（发起人本人则跳过，标「发起人回避」）
             → 上级终审（回避或需双人复核时出现）
             → 生效留痕 */
    const selfApplied = a.applicant === role.user;
    const needDouble = !!a.urgent
      || a.toLevel === 'high2'
      || (a.curLevel === 'high2' && a.toLevel !== 'high2')
      || (a.curLevel === 'high' && a.toLevel === 'low');
    const UPPER = { name: '李国栋', role: '区领导 · 政法委书记' };
    const stamp = s => String(s || '').slice(5);
    const chain = [];
    chain.push({ t: '属地提交', m: `${esc(a.applicant)} ${esc(stamp(a.time))}`, st: 'done' });
    chain.push({ t: '部门主管', m: `${esc(a.deptLevel)}核定 · 同意`, st: 'done' });
    if (selfApplied) {
      chain.push({ t: '政法委审核', m: '发起人回避 · 跳过', st: 'skip' });
      chain.push({
        t: '上级终审',
        m: done ? `${esc(a.by || UPPER.name)} ${esc(stamp(a.at))}` : `${esc(UPPER.name)} · 待处理`,
        st: done ? 'done' : 'cur'
      });
    } else {
      chain.push({
        t: '政法委审批',
        m: done ? `${esc(a.by || role.user)} ${esc(stamp(a.at))}` : `${esc(role.user)} · 待处理`,
        st: done ? 'done' : 'cur'
      });
      if (needDouble) {
        chain.push({
          t: '区领导复核',
          m: done ? `${esc(UPPER.name)} · 同意` : `${esc(UPPER.name)} · 待复核`,
          st: done ? 'done' : ''
        });
      }
    }
    chain.push({ t: '生效留痕', m: done ? '档案等级已变更' : '系统自动', st: done ? 'done' : '' });
    const chainHint = '按风险序自动路由 · '
      + (selfApplied ? '发起人回避（上级终审）' : needDouble ? 'L2 层级（政法委 + 双人复核）' : 'L1 层级')
      + ' · 共 ' + chain.length + ' 个节点';

    detail.innerHTML = `
      <div class="card-hd">
        <div class="card-title">申请详情 · ${esc(D.field(role.key, 'name', p).text)} <span class="sub">${esc(a.id)}</span></div>
        <div class="right">
          ${done ? `<span class="tag ${a.status === '已通过' ? 'tag-green' : 'tag-red'}">${esc(a.status)}</span>`
                 : (a.urgent ? '<span class="tag tag-red">需双人复核</span>' : '<span class="tag tag-green">依据齐全</span>')}
        </div>
      </div>
      <div class="card-bd" style="padding:13px 16px">
        <div class="diff-box">
          <div class="diff-side">
            <div class="lbl">部门原等级 / 管控等级</div>
            <div class="val" style="color:var(--orange)">${lv(a.curLevel).name}</div>
            <div class="lbl mt6">统一风险序 ${lv(a.curLevel).order + 1}</div>
          </div>
          <div class="diff-arrow">
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M4 12h15m0 0l-5-5m5 5l-5 5"/></svg>
          </div>
          <div class="diff-side">
            <div class="lbl">申请调整后</div>
            <div class="val" style="color:var(--green)">${lv(a.toLevel).name}</div>
            <div class="lbl mt6">统一风险序 ${lv(a.toLevel).order + 1}</div>
          </div>
          <div style="width:1px;height:38px;background:var(--line-2);margin:0 6px"></div>
          <div class="diff-note">
            <div><span class="dim">当前标签：</span>${esc(p.tags.join(' · '))}</div>
            <div><span class="dim">调整方向：</span>${up ? '上调（风险升高，不设限）' : '下调（须依据充分）'}</div>
            <div><span class="dim">影响范围：</span>${up ? '高风险及以上 +1' : '高风险及以上 -1（次日快照纳入统计）'}</div>
          </div>
        </div>

        <div class="grid g2 mt12" style="gap:10px 20px">
          <dl class="kv" style="grid-template-columns:62px 1fr;gap:7px 10px">
            <dt>申请人</dt><dd>${esc(a.applicant)} · ${esc(a.applicantDept)}</dd>
            <dt>申请时间</dt><dd>${esc(a.time)}</dd>
            <dt>调整类型</dt><dd>${up ? '上调（风险升高）' : '下调（风险降低）'}</dd>
            <dt>责任镇街</dt><dd>${esc(a.town)}</dd>
          </dl>
          <dl class="kv" style="grid-template-columns:62px 1fr;gap:7px 10px">
            <dt>主责单位</dt><dd>${esc(p.dept)}</dd>
            <dt>最近走访</dt><dd>${D.dateBefore(p.visitGap)}（${p.visitGap} 天前）</dd>
            <dt>包联干部</dt><dd>${esc(p.officer)} · ${esc(p.officerTitle)}</dd>
            <dt>档案</dt><dd><a class="rowlink" href="person.html?id=${p.id}">${esc(p.no)} 查看 ›</a></dd>
          </dl>
        </div>

        <div class="sect-title mt12">评估依据（申请材料）</div>
        <div class="row" style="gap:9px;background:var(--surface-2);border:1px solid var(--line);border-radius:9px;padding:10px 12px;align-items:flex-start">
          <span class="ico-round" style="background:var(--blue-soft);color:var(--blue)">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8l-5-5z"/><path d="M14 3v5h5"/></svg>
          </span>
          <div style="flex:1 1 auto">
            <div class="sm"><b>${esc(a.evidence[0] || '评估意见')}</b> <span class="tiny dim">· ${(88 + a.id.length * 7)} KB</span></div>
            <div class="tiny dim" style="margin-top:2px">${esc(a.reason)}</div>
            <div class="tiny dim" style="margin-top:3px;color:var(--t4)">附：${a.evidence.slice(1).map(esc).join(' · ') || '无其他附件'}</div>
          </div>
          <span class="tag tag-green">已核验</span>
        </div>

        <div class="divider" style="margin:12px 0"></div>
        <div class="sect-title">审批链 <span style="font-weight:400;color:var(--t4)">${chainHint}</span></div>
        <div class="flow">
          ${chain.map((n, i) => `<div class="fs ${n.st}">
            <div class="dot">${n.st === 'done' ? '✓' : (n.st === 'skip' ? '—' : (i + 1))}</div>
            <div class="ft">${esc(n.t)}</div>
            <div class="fm">${n.m}</div>
          </div>`).join('')}
        </div>
        ${selfApplied && !done ? `
        <div class="banner banner-warn" style="margin:8px 0 0;padding:5px 10px;font-size:10.5px">
          <span>本单由您（${esc(role.user)}）发起：按「发起人回避」不能自审，政法委审核节点跳过，改由 <b>${esc(UPPER.name)}（${esc(UPPER.role)}）</b> 终审。</span>
        </div>` : ''}
      </div>
      ${done ? `
      <div class="card-ft" style="display:block;padding:11px 16px">
        <div class="banner ${a.status === '已通过' ? 'banner-ok' : 'banner-warn'}" style="margin:0">
          <span>${a.status === '已通过' ? '审批已通过' : '审批已驳回'}：${esc(a.note || '（无意见）')} · 操作人 ${esc(a.by || '')} ${esc((a.at || '').slice(5))}</span>
        </div>
      </div>` : `
      <div class="card-ft acts-ft">
        <div class="acts-row">
          <span class="acts-lb">审批意见</span>
          <textarea class="textarea" id="apprNote" style="flex:1;min-height:34px;padding:5px 9px" placeholder="同意/驳回理由，将写入不可修改的变动记录">${esc(noteText)}</textarea>
        </div>
        <div class="acts-row">
          <input class="input" style="flex:1;height:26px;font-size:11.5px" id="rejectReason" placeholder="驳回 / 退回补充理由（驳回时必填）">
          <button class="btn btn-sm" id="btnReject">驳回</button>
          <button class="btn btn-sm" id="btnBack2">退回补充</button>
          <button class="btn btn-sm btn-primary" id="btnPass">${selfApplied ? '提交上级终审' : '同意并生效'}</button>
        </div>
        <div class="tiny dim" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${selfApplied ? '发起人回避：本单将提交 ' + esc(UPPER.name) + '（' + esc(UPPER.role) + '）终审 · ' : ''}生效后：档案等级即时变更 · 驾驶舱指标同步刷新 · 生成不可修改的变动记录 · 申请人收到通知</div>
      </div>`}`;

    if (done) return;

    const noteEl = document.getElementById('apprNote');
    noteEl.oninput = () => { noteText = noteEl.value; };

    document.getElementById('btnPass').onclick = () => {
      if (!window.guard('approve', '审批')) return;
      const opinion = (noteText || noteEl.value || '').trim();
      UI.confirm({
        title: selfApplied ? '提交上级终审并生效？' : '确认同意并生效？',
        sub: selfApplied
          ? `${a.name} 等级由「${lv(a.curLevel).name}」变更为「${lv(a.toLevel).name}」；本单由您发起，按回避规则提交 ${UPPER.name}（${UPPER.role}）终审`
          : `${a.name} 等级由「${lv(a.curLevel).name}」变更为「${lv(a.toLevel).name}」，档案立即变更且不可撤销`,
        body: `<dl class="kv" style="grid-template-columns:66px 1fr;font-size:12px">
          <dt>申请单号</dt><dd>${esc(a.id)}</dd>
          <dt>发起人</dt><dd>${esc(a.applicant)} · ${esc(a.applicantDept)}</dd>
          <dt>${selfApplied ? '终审人' : '审批人'}</dt><dd>${selfApplied
            ? `<b>${esc(UPPER.name)}</b> · ${esc(UPPER.role)} <span class="tag tag-amber" style="height:16px">发起人回避</span>`
            : `${esc(role.user)} · ${esc(role.roleName)}`}</dd>
          <dt>审批意见</dt><dd>${esc(opinion || '（未填写）')}</dd>
        </dl>
        ${selfApplied ? '<div class="tiny dim" style="margin-top:8px">演示环境下由系统以终审人身份完成本次终审，审计日志将记录「发起人回避 · 上级终审」，可追溯。</div>' : ''}`,
        okText: selfApplied ? '提交终审' : '同意并生效',
        onOk: () => {
          if (selfApplied) {
            STORE.decide(a.id, true, opinion || '发起人回避，提交上级终审同意', { by: UPPER.name, byRole: UPPER.role, upper: true });
            UI.toast.ok('已由 ' + UPPER.name + ' 终审通过并生效 · 档案等级变更为「' + lv(a.toLevel).name + '」');
          } else {
            STORE.decide(a.id, true, opinion);
            UI.toast.ok('已生效 · 档案等级变更为「' + lv(a.toLevel).name + '」');
          }
          renderAll();
        }
      });
    };

    document.getElementById('btnReject').onclick = () => {
      if (!window.guard('approve', '审批')) return;
      const reason = (document.getElementById('rejectReason').value || '').trim();
      if (reason.length < 5) { UI.toast.warn('驳回理由不少于 5 字'); return; }
      UI.confirm({
        title: '确认驳回该申请？', sub: a.name + ' ' + a.id, danger: true, okText: '驳回',
        body: `<div class="tiny" style="line-height:1.8">驳回理由：${esc(reason)}<br>驳回后申请人可补充材料后重新提交；本次操作写入审计流水。</div>`,
        onOk: () => { STORE.decide(a.id, false, reason); UI.toast.ok('已驳回'); renderAll(); }
      });
    };

    document.getElementById('btnBack2').onclick = () => {
      if (!window.guard('approve', '审批')) return;
      const reason = (document.getElementById('rejectReason').value || '').trim();
      if (reason.length < 5) { UI.toast.warn('请填写需补充的材料说明（不少于 5 字）'); return; }
      STORE.audit('退回补充', a.id + '：' + reason, a.personId);
      UI.toast.ok('已退回补充材料');
    };
  }

  /* ---------- 变动台账（DATA.CHG_FULL 46 条 + 本次会话通过项，四处同源） ----------
     同源关系：卡片小表 / 「全部 N 条」弹窗 / 导出变动台账 CSV / 月度报送汇总，
     全部读 allChanges()，不再出现「弹窗说 46 条、实际只列 4 条」的断裂。 */
  function allChanges() {
    const passed = STORE.approvals().filter(a => a.status === '已通过');
    const live = passed.map(a => ({
      id: a.id, name: a.name, town: a.town || '', dept: '',
      personId: a.personId, date: (a.at || '').slice(5, 10),
      from: a.curLevel, to: a.toLevel,
      reason: a.note || '本次会话审批通过',
      level: '政法委主管（本次会话）', approver: a.by || STORE.role().user,
      at: a.at || '', status: '已生效', live: true
    }));
    return live.concat(D.CHG_FULL);
  }
  function chgStat(list) {
    const up = list.filter(r => D.levelOf(r.to).order < D.levelOf(r.from).order).length;
    return { total: list.length, up: up, down: list.length - up };
  }

  function renderChanges() {
    const body = document.getElementById('chgBody');
    if (!body) return;
    const list = allChanges();
    const st = chgStat(list);
    body.innerHTML = list.map(r => `<tr data-id="${esc(r.id)}" data-town="${esc(r.town)}" data-name="${esc(r.name)}">
      <td><span class="cell-main">${esc(r.name)}</span><span class="cell-sub">${esc(r.date)} · ${esc(r.town || '—')}</span></td>
      <td><span class="${lv(r.from).cls}">${SHORT[r.from]}</span> <span class="dim">→</span> <span class="${lv(r.to).cls}">${SHORT[r.to]}</span></td>
      <td class="r"><span class="tag ${r.live ? 'tag-blue' : 'tag-green'}">${r.live ? '本次生效' : '已生效'}</span></td>
    </tr>`).join('');
    const sub = document.getElementById('chgSub');
    if (sub) sub.textContent = st.total + ' 条';
    const upEl = document.getElementById('chgUp');
    const downEl = document.getElementById('chgDown');
    if (upEl) upEl.textContent = '上调 ' + st.up;
    if (downEl) downEl.textContent = '下调 ' + st.down;
    const all = document.getElementById('btnChgAll');
    if (all) all.textContent = '全部 ' + st.total + ' 条 ›';

    /* 层级规则「本月」列与台账同源派生（原先硬编码 12/21/9/4，与 46 条对不上） */
    const byKey = k => list.filter(r => (r.from + '>' + r.to) === k).length;
    const setNum = (id, v) => { const n = document.getElementById(id); if (n) n.textContent = v; };
    setNum('ruleLowMid', byKey('low>mid') + byKey('mid>low'));
    setNum('ruleMidHigh', byKey('mid>high'));
    setNum('ruleHighDown', byKey('high>mid'));
    setNum('ruleDouble', byKey('high>high2') + byKey('high2>high') + byKey('high2>mid'));
  }

  /* ---------- 页头按钮 ---------- */
  function initButtons() {
    document.getElementById('btnNew').onclick = () => {
      if (!window.guard('approve', '发起')) return;
      const pool = D.persons.slice(0, 40);
      UI.modal({
        title: '发起等级调整申请',
        sub: '须人工发起、填写评估依据、逐级审批后生效；AI 不参与定级',
        width: 520,
        okText: '提交申请',
        body: `
          <div class="fld"><label>选择人员</label><div class="select" id="newPerson" style="height:30px">请选择人员</div></div>
          <div class="fld"><label>调整后等级</label><div class="select" id="newLevel" style="height:30px">请选择等级</div></div>
          <div class="fld"><label>评估依据 / 调整理由（不少于 15 字）</label><textarea id="newReason" placeholder="例如：社区矫正期满，连续 6 个月无违规记录，建议下调为中风险并转入常规随访。"></textarea></div>`,
        onMount: dlg => {
          let pick = null, lvlPick = null;
          const selP = UI.select(dlg.querySelector('#newPerson'), {
            items: pool.map(p => ({ v: p.id, t: p.name + ' · ' + p.town + ' · ' + D.levelOf(STORE.levelOf(p)).name })),
            value: pool[0].id, onChange: v => { pick = v; }
          });
          pick = pool[0].id;
          const selL = UI.select(dlg.querySelector('#newLevel'), {
            items: D.LEVELS.map(l => ({ v: l.key, t: l.name })),
            value: 'high', onChange: v => { lvlPick = v; }
          });
          lvlPick = 'high';
          dlg._get = () => ({ pick, lvlPick });
        },
        onOk: dlg => {
          const { pick, lvlPick } = dlg._get();
          const reason = dlg.querySelector('#newReason').value.trim();
          if (reason.length < 15) { UI.toast.warn('评估依据不少于 15 字'); return false; }
          const p = D.personById(pick);
          const cur = STORE.levelOf(p);
          if (cur === lvlPick) { UI.toast.warn('调整后等级与原等级相同'); return false; }
          const id = 'APP-' + new Date().getFullYear() + String(new Date().getMonth() + 1).padStart(2, '0') + String(new Date().getDate()).padStart(2, '0') + '-0' + (90 + STORE.approvals().length);
          STORE.addApproval({
            id, personId: p.id, name: p.name, town: p.town,
            deptLevel: D.levelOf(cur).name, curLevel: cur, toLevel: lvlPick,
            applicant: STORE.role().user, applicantDept: STORE.role().title,
            time: STORE.now(), reason, evidence: ['评估意见（本次提交）.pdf'],
            status: '待审批', urgent: lvlPick === 'high2'
          });
          UI.toast.ok('已提交 · 等待政法委审批');
          curId = id;
          renderAll();
        }
      });
    };

    /* 导出台账：与「本月变动台账 / 全部 N 条」完全同源，条数一致 */
    document.getElementById('btnExport').onclick = () => {
      if (!window.guard('exportPlain', '导出')) return;
      const list = allChanges();
      const rows = [['序号', '变动单号', '人员', '属地镇街', '主责部门', '变动日期', '原等级', '调整后等级', '调整方向', '调整依据', '审批层级', '审批人', '状态']];
      list.forEach((r, i) => rows.push([
        i + 1, r.id, r.name, r.town || '—', r.dept || '委办局侧调整', r.date,
        D.levelOf(r.from).name, D.levelOf(r.to).name,
        D.levelOf(r.from).key === 'unknown'
          ? '补评定级'
          : (D.levelOf(r.to).order < D.levelOf(r.from).order ? '上调' : '下调'),
        r.reason, r.level, r.approver, r.status
      ]));
      UI.downloadCSV('等级调整变动台账_2026-11.csv', rows);
      STORE.addExport('等级调整变动台账', list.length, '明文导出');
      UI.toast.ok('已导出 ' + list.length + ' 条变动记录，操作已留痕');
    };

    /* 月度报送预览：按报送文书结构呈现，导出为「报送表」而非逐条台账 */
    document.getElementById('btnMonthly').onclick = () => {
      if (!window.guard('exportPlain', '月度报送')) return;
      const list = allChanges();
      const st = chgStat(list);
      const ap = STORE.approvalStats();
      const dbl = list.filter(r => String(r.level).indexOf('双人复核') > -1).length;
      const over = list.filter(r => r.live && r.reason && r.reason.indexOf('超时') > -1).length + 1;
      const highNow = D.stats.highPlus;
      const depts = {};
      list.forEach(r => {
        const k = r.dept || '委办局侧调整';
        depts[k] = depts[k] || { up: 0, down: 0, n: 0 };
        depts[k].n++;
        if (D.levelOf(r.to).order < D.levelOf(r.from).order) depts[k].up++; else depts[k].down++;
      });

      UI.modal({
        title: '月度报送预览 · 2026 年 11 月',
        sub: '中共北京市密云区委政法委员会 · 重点风险人员等级调整月度报送（供政法委月度报送，导出后加盖电子印章）',
        width: 660,
        okText: '导出报送表 CSV',
        body: `
          <div style="border:1px solid var(--line);border-radius:11px;padding:16px 18px 14px;background:#fff">
            <div style="text-align:center;border-bottom:2px solid var(--t1);padding-bottom:9px;margin-bottom:11px">
              <div style="font-size:16px;font-weight:700;letter-spacing:.5px;color:var(--t1)">密云区重点风险人员等级调整月度报送表</div>
              <div class="tiny dim" style="margin-top:4px">报送期间：2026-11-01 至 2026-11-30（截至 11-10）· 编制单位：区委政法委 · 编号：MYB-2026-11</div>
            </div>
            <table class="tb compact" style="width:100%">
              <thead><tr><th style="width:132px">报送项</th><th class="r" style="width:78px">本月</th><th class="r" style="width:78px">上月</th><th>口径说明</th></tr></thead>
              <tbody>
                <tr><td class="cell-main">审批事项总量</td><td class="r num"><b>${st.total + ap.pending}</b> 件</td><td class="r num dim">42 件</td><td class="tiny">含待审批 ${ap.pending} 件、已办结 ${st.total} 件</td></tr>
                <tr><td class="cell-main">等级上调</td><td class="r num" style="color:var(--red)"><b>${st.up}</b> 件</td><td class="r num dim">17 件</td><td class="tiny">风险升高，上调不设限，须附评估依据</td></tr>
                <tr><td class="cell-main">等级下调</td><td class="r num" style="color:var(--green)"><b>${st.down}</b> 件</td><td class="r num dim">25 件</td><td class="tiny">风险降低，下调须依据充分、逐级审批</td></tr>
                <tr><td class="cell-main">双人复核事项</td><td class="r num"><b>${dbl}</b> 件</td><td class="r num dim">3 件</td><td class="tiny">极高风险上调、一级 / A 类降级须双人复核</td></tr>
                <tr><td class="cell-main">超时办结</td><td class="r num" style="color:var(--orange)"><b>${over}</b> 件</td><td class="r num dim">0 件</td><td class="tiny">超过 5 个工作日未办结，已在页面标注</td></tr>
                <tr><td class="cell-main">期末高风险及以上</td><td class="r num"><b>${highNow}</b> 人</td><td class="r num dim">480 人</td><td class="tiny">与驾驶舱、人员台账同源，含本次变动</td></tr>
              </tbody>
            </table>

            <div class="sect-title mt12">分部门调整构成</div>
            <table class="tb compact" style="width:100%;margin-top:4px">
              <thead><tr><th>主责部门</th><th class="r" style="width:70px">上调</th><th class="r" style="width:70px">下调</th><th class="r" style="width:70px">合计</th></tr></thead>
              <tbody>
                ${Object.keys(depts).map(k => `<tr><td>${esc(k)}</td><td class="r num" style="color:var(--red)">${depts[k].up}</td><td class="r num" style="color:var(--green)">${depts[k].down}</td><td class="r num"><b>${depts[k].n}</b></td></tr>`).join('')}
                <tr class="tot"><td>合计</td><td class="r num">${st.up}</td><td class="r num">${st.down}</td><td class="r num">${st.total}</td></tr>
              </tbody>
            </table>

            <div class="row mt12" style="align-items:flex-end;gap:16px">
              <div style="flex:1 1 auto">
                <div class="tiny dim" style="line-height:1.9">
                  编制人：${esc(STORE.role().user)}（${esc(STORE.role().roleName)}）<br>
                  审核人：李国栋（区委常委 · 政法委书记）<br>
                  报送日期：${esc(STORE.now().slice(0, 10))}
                </div>
              </div>
              <div style="width:132px;height:66px;border:1.5px dashed var(--line-3);border-radius:8px;display:grid;place-items:center;text-align:center;color:var(--t4);font-size:10.5px;line-height:1.5">
                中共北京市密云区委<br>政法委员会（电子印章）
              </div>
            </div>
          </div>
          <div class="tiny dim" style="margin-top:9px">导出为报送表格式（汇总口径），与「变动台账」逐条明细不同；正式报送时由政法委加盖电子印章后报送市委政法委。</div>`,
        onOk: () => {
          const rows = [
            ['密云区重点风险人员等级调整月度报送表'],
            ['报送期间', '2026-11-01 至 2026-11-30（截至 11-10）'],
            ['编制单位', '中共北京市密云区委政法委员会'],
            ['报送编号', 'MYB-2026-11'],
            [],
            ['报送项', '本月', '上月', '口径说明'],
            ['审批事项总量', st.total + ap.pending, 42, `含待审批 ${ap.pending} 件、已办结 ${st.total} 件`],
            ['等级上调', st.up, 17, '风险升高，上调不设限，须附评估依据'],
            ['等级下调', st.down, 25, '风险降低，下调须依据充分、逐级审批'],
            ['双人复核事项', dbl, 3, '极高风险上调、一级 / A 类降级须双人复核'],
            ['超时办结', over, 0, '超过 5 个工作日未办结'],
            ['期末高风险及以上', highNow, 480, '与驾驶舱、人员台账同源'],
            [],
            ['分部门构成', '上调', '下调', '合计'],
            ['主责部门', '上调', '下调', '合计']
          ];
          Object.keys(depts).forEach(k => rows.push([k, depts[k].up, depts[k].down, depts[k].n]));
          rows.push(['合计', st.up, st.down, st.total]);
          rows.push([]);
          rows.push(['编制人', STORE.role().user + '（' + STORE.role().roleName + '）']);
          rows.push(['审核人', '李国栋（区委常委 · 政法委书记）']);
          rows.push(['报送日期', STORE.now().slice(0, 10)]);
          rows.push(['印章', '中共北京市密云区委政法委员会（电子印章）']);
          UI.downloadCSV('密云区等级调整月度报送_2026-11.csv', rows);
          STORE.addExport('月度报送表（汇总口径）', st.total, '报送导出');
          UI.toast.ok('报送表已导出 · 汇总口径，与变动台账明细不同');
        }
      });
    };

    /* 「全部 N 条 ›」：本月变动完整清单（与导出、卡片、月报同源，不再截断） */
    const btnChgAll = document.getElementById('btnChgAll');
    if (btnChgAll) btnChgAll.onclick = e => {
      e.preventDefault();
      const list = allChanges().slice().sort((a, b) =>
        (b.live ? 1 : 0) - (a.live ? 1 : 0) || String(b.at).localeCompare(String(a.at)));
      const st = chgStat(list);
      UI.modal({
        title: '本月等级变动 · ' + st.total + ' 条',
        sub: `上调 ${st.up} · 下调 ${st.down} · 本次会话新增 ${list.filter(r => r.live).length} 条；表格内可滚动查看全部`,
        width: 620,
        okText: '导出台账',
        body: `
          <div class="row mb8" style="gap:6px">
            <span class="tag tag-orange">上调 ${st.up}</span>
            <span class="tag tag-green">下调 ${st.down}</span>
            <span class="tag tag-blue">本次会话生效 ${list.filter(r => r.live).length}</span>
            <span class="spacer"></span>
            <span class="tag tag-line">共 ${st.total} 条</span>
          </div>
          <div class="table-wrap" style="border:1px solid var(--line);border-radius:9px;max-height:360px;overflow:auto">
            <table class="tb compact">
              <thead><tr><th style="width:118px">人员 / 镇街</th><th style="width:52px">日期</th><th style="width:88px">变动</th><th>依据 / 审批层级</th><th class="r" style="width:66px">状态</th></tr></thead>
              <tbody>${list.map(r => `<tr>
                <td><span class="cell-main">${esc(r.name)}</span><span class="cell-sub">${esc(r.town || '—')}</span></td>
                <td class="dim num tiny">${esc(r.date)}</td>
                <td><span class="${lv(r.from).cls}">${SHORT[r.from]}</span> <span class="dim">→</span> <span class="${lv(r.to).cls}">${SHORT[r.to]}</span></td>
                <td class="tiny"><span style="color:var(--t2)">${esc(r.reason)}</span><br><span class="dim">${esc(r.level)} · ${esc(r.approver || '—')} · ${esc(r.id)}</span></td>
                <td class="r"><span class="tag ${r.live ? 'tag-blue' : 'tag-green'}">${r.live ? '本次生效' : '已生效'}</span></td>
              </tr>`).join('')}</tbody>
            </table>
          </div>
          <div class="tiny dim" style="margin-top:9px">共 ${st.total} 条全部列示（含委办局侧调整），每条均附评估依据与变动单号；导出为脱敏 CSV，与「月度报送表」的汇总口径区分。</div>`,
        onOk: () => document.getElementById('btnExport').click()
      });
    };
  }

  function renderAll() {
    if (!curId) { const f = pendingFirst()[0]; if (f) curId = f.id; }
    renderList(); renderDetail(); renderChanges();
  }

  initButtons();
  renderAll();

  /* ?focus= 深链定位：在「本月变动台账」里高亮匹配（属地或人名）的行，并滚动到可视区 */
  (function () {
    const focus = (new URLSearchParams(location.search).get('focus') || '').trim();
    if (!focus) return;
    const body = document.getElementById('chgBody');
    if (!body) return;
    const hit = Array.from(body.querySelectorAll('tr')).filter(tr =>
      (tr.dataset.town || '').indexOf(focus) > -1 || (tr.dataset.name || '').indexOf(focus) > -1);
    if (!hit.length) { UI.toast(`未在变动台账中找到「${focus}」相关记录，已显示全量`); return; }
    hit.forEach(tr => {
      tr.style.background = 'var(--blue-soft)';
      tr.style.outline = '1px solid var(--blue)';
      tr.style.outlineOffset = '-1px';
    });
    const card = body.closest('.card');
    if (card) card.scrollIntoView({ behavior: 'smooth', block: 'center' });
    /* 台账容器定高内滚，需把命中行滚到容器可视区（否则高亮行可能停在滚动窗之外） */
    try { hit[0].scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (e) {}
    UI.toast.ok(`已定位「${focus}」相关 ${hit.length} 条变动记录（高亮显示）`);
  })();
})();
