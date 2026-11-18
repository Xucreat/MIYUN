/* ============================================================
   page-risk.js · 等级变动台账（会议决议 D4：政法委无审批职能）
   ------------------------------------------------------------
   降级口径：
   · 页签 A「等级变动台账」= 部门自主定级 + 登记留痕，**没有审批链、没有通过/驳回**；
     政法委侧只做「备案 + 知会属地」，知会状态是应答留痕，不阻断已生效的等级。
   · 页签 B「明文导出」原样保留（page-approval.js）——那是数据安全控制，不是业务审批。
   关键链路：
     登记（STORE.addChange）→ 立刻改写档案等级（applyLevel → DATA.persons）
     → 各页读 STORE.levelOf() 呈现 → 审计留痕 · 做到「一处生效、处处一致」
   台账同源：左栏列表 / 全部 N 条弹窗 / 导出 CSV / 月度报送，全部读 STORE.changes()。
   ============================================================ */
(function () {
  'use strict';
  const D = window.DATA;
  const esc = UI.esc;
  let curId = null;

  const listBox = document.getElementById('apprList');
  const detail = document.getElementById('detailCard');
  const statEl = document.getElementById('apprStat');
  /* 条数角标挂在页签上：.page-head 会被外壳整体摘除，放在页头里等于不显示 */
  const hdr = document.getElementById('navChgCnt');

  const SHORT = { high2: '极高', high: '高', mid: '中', low: '低', unknown: '待核' };
  const lv = k => D.levelOf(k);

  /* 登记时间倒序；同一时间按单号倒序（稳定排序，刷新不错位） */
  function rows() {
    return STORE.changes().slice().sort((a, b) =>
      String(b.at || '').localeCompare(String(a.at || '')) || String(b.id).localeCompare(String(a.id)));
  }
  const deptOf = r => r.dept || '委办局侧调整';

  /* ---------- 左栏：变动登记（全量逐条） ---------- */
  function renderList() {
    const list = rows();
    if (!list.length) {
      listBox.innerHTML = UI.empty('暂无等级变动记录', '可点击右上角「登记等级变动」补录一条');
    } else {
      listBox.innerHTML = list.map(r => {
        const up = lv(r.to).order < lv(r.from).order;
        const nt = STORE.notifiedOf(r);
        const tag = r.live
          ? '<span class="tag tag-blue">本次登记</span>'
          : (nt.notified ? '<span class="tag tag-green">已知会</span>' : '<span class="tag tag-amber">待知会</span>');
        return `<div class="appr-item ${r.id === curId ? 'on' : ''} ${r.live ? 'live' : ''}" data-id="${esc(r.id)}" data-town="${esc(r.town || '')}" data-name="${esc(r.name || '')}">
          <div class="row" style="gap:6px"><b class="sm">${esc(r.name)}</b>
            <span class="tag tag-line">${esc(deptOf(r))}</span>
            <span class="spacer"></span><span class="tiny dim">${esc(r.date)} ${esc(String(r.at || '').slice(11))}</span></div>
          <div class="row mt6" style="gap:5px;font-size:11px">
            <span class="${lv(r.from).cls}">${SHORT[r.from] || lv(r.from).name}</span>
            <span class="dim">→</span>
            <span class="${lv(r.to).cls}">${SHORT[r.to] || lv(r.to).name}</span>
            <span class="tiny dim">· ${up ? '上调' : '下调'}</span>
            <span class="spacer"></span>${tag}</div>
        </div>`;
      }).join('');
      listBox.querySelectorAll('.appr-item').forEach(n => {
        n.onclick = () => { curId = n.dataset.id; renderList(); renderDetail(); };
      });
    }

    const st = STORE.changeStats();
    if (statEl) statEl.textContent = '共 ' + st.total + ' 条 · 本次登记 ' + st.live + ' · 待知会 ' + st.waiting;
    if (hdr) hdr.textContent = st.total;
    document.querySelectorAll('.nbadge').forEach(n => {
      if (n.closest('[href="risk.html"]')) n.textContent = st.total;
    });
  }

  /* 等级 → 部门定级责任（定义在 data.js 的 LEVEL_RULE_OF，与历史台账同源） */
  const ruleOf = (from, to) => D.LEVEL_RULE_OF(from + '>' + to).lv;

  /* ---------- 右栏：登记详情（无审批链、无审批动作） ---------- */
  function renderDetail() {
    const r = STORE.change(curId);
    if (!r) {
      detail.innerHTML = `<div class="card-bd">${UI.empty('请选择左侧一条变动登记', '右侧展示等级差异、定级依据、部门定级流程与知会状态')}</div>`;
      return;
    }
    const p = D.personById(r.personId);
    const up = lv(r.to).order < lv(r.from).order;
    const nt = STORE.notifiedOf(r);
    const role = STORE.role();

    /* 部门内部定级流程：节点取自系统管理的「定级流程」（SYS_ROUTES），末节点「报政法委备案」
       的完成度由知会状态决定——备案是知会，不是审批关口。 */
    const route = D.SYS_ROUTES.find(x => x.to === lv(r.to).order + 1) || D.SYS_ROUTES[D.SYS_ROUTES.length - 1];
    const nodes = route.nodes.map(n => {
      const isFile = n.indexOf('备案') > -1;
      return {
        t: n,
        m: isFile ? (nt.notified ? '已知会 ' + esc(String(nt.at || '').slice(5)) : '待知会') : '已完成',
        st: isFile ? (nt.notified ? 'done' : 'cur') : 'done'
      };
    });

    detail.innerHTML = `
      <div class="card-hd">
        <div class="card-title">变动登记 · ${esc(D.field(role.key, 'name', p).text)} <span class="sub">${esc(r.id)}</span></div>
        <div class="right">
          ${r.live ? '<span class="tag tag-blue">本次登记</span>' : '<span class="tag tag-green">已生效</span>'}
        </div>
      </div>
      <div class="card-bd" style="padding:13px 16px">
        <div class="diff-box">
          <div class="diff-side">
            <div class="lbl">变动前等级</div>
            <div class="val" style="color:var(--orange)">${lv(r.from).name}</div>
            <div class="lbl mt6">统一风险序 ${lv(r.from).order + 1}</div>
          </div>
          <div class="diff-arrow">
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M4 12h15m0 0l-5-5m5 5l-5 5"/></svg>
          </div>
          <div class="diff-side">
            <div class="lbl">变动后等级</div>
            <div class="val" style="color:var(--green)">${lv(r.to).name}</div>
            <div class="lbl mt6">统一风险序 ${lv(r.to).order + 1}</div>
          </div>
          <div style="width:1px;height:38px;background:var(--line-2);margin:0 6px"></div>
          <div class="diff-note">
            <div><span class="dim">当前标签：</span>${esc((p.tags || []).join(' · ') || '—')}</div>
            <div><span class="dim">变动方向：</span>${up ? '上调（风险升高，不设限）' : '下调（须定级依据充分）'}</div>
            <div><span class="dim">定级责任：</span>${esc(r.level)}</div>
          </div>
        </div>

        <div class="grid g2 mt12" style="gap:10px 20px">
          <dl class="kv" style="grid-template-columns:62px 1fr;gap:7px 10px">
            <dt>登记人</dt><dd>${esc(r.approver || '—')}</dd>
            <dt>登记时间</dt><dd>${esc(r.at || '—')}</dd>
            <dt>来源部门</dt><dd>${esc(deptOf(r))}</dd>
            <dt>责任镇街</dt><dd>${esc(r.town || '—')}</dd>
          </dl>
          <dl class="kv" style="grid-template-columns:62px 1fr;gap:7px 10px">
            <dt>主责单位</dt><dd>${esc(p.dept || '—')}</dd>
            <dt>最近走访</dt><dd>${D.dateBefore(p.visitGap)}（${p.visitGap} 天前）</dd>
            <dt>包联干部</dt><dd>${esc(p.officer || '—')} · ${esc(p.officerTitle || '')}</dd>
            <dt>档案</dt><dd><a class="rowlink" href="person.html?id=${p.id}">${esc(p.no)} 查看 ›</a></dd>
          </dl>
        </div>

        <div class="sect-title mt12">定级依据（部门报送材料）</div>
        <div class="row" style="gap:9px;background:var(--surface-2);border:1px solid var(--line);border-radius:9px;padding:10px 12px;align-items:flex-start">
          <span class="ico-round" style="background:var(--blue-soft);color:var(--blue)">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8l-5-5z"/><path d="M14 3v5h5"/></svg>
          </span>
          <div style="flex:1 1 auto">
            <div class="sm"><b>${esc(r.level)}意见</b> <span class="tiny dim">· ${(88 + String(r.id).length * 7)} KB</span></div>
            <div class="tiny dim" style="margin-top:2px">${esc(r.reason || '—')}</div>
            <div class="tiny dim" style="margin-top:3px;color:var(--t4)">附：评估结论书 · 走访记录 · 部门定级会商纪要</div>
          </div>
          <span class="tag tag-green">已核验</span>
        </div>

        <div class="divider" style="margin:12px 0"></div>
        <div class="sect-title">部门内部定级流程 <span style="font-weight:400;color:var(--t4)">部门自主定级 · 政法委只做备案与知会，不设审批节点 · 共 ${route.nodes.length} 个节点</span></div>
        <div class="flow">
          ${nodes.map((n, i) => `<div class="fs ${n.st}">
            <div class="dot">${n.st === 'done' ? '✓' : (i + 1)}</div>
            <div class="ft">${esc(n.t)}</div>
            <div class="fm">${n.m}</div>
          </div>`).join('')}
        </div>
      </div>
      <div class="card-ft acts-ft">
        <div class="acts-row" style="justify-content:space-between">
          <span class="tiny dim">等级已生效 · 变更写入档案与审计流水，不可撤销${nt.notified ? ' · 属地已知会' : ' · 属地待知会'}</span>
          ${nt.notified
            ? '<span class="tag tag-green">已通知属地</span>'
            : `<button class="btn btn-sm btn-primary" id="btnNotify" data-perm="edit">通知属地</button>`}
        </div>
      </div>`;

    const btnNotify = document.getElementById('btnNotify');
    if (btnNotify) btnNotify.onclick = () => {
      if (!window.guard('edit', '知会')) return;
      UI.confirm({
        title: '通知属地已登记变动？',
        sub: `${r.name} ${r.id} · ${r.town || '—'}`,
        body: `<div class="tiny" style="line-height:1.8">知会是告知动作，不改变已生效的等级；告知记录写入审计流水，可倒查「谁在什么时候通知了哪个属地」。</div>`,
        okText: '通知属地',
        onOk: () => { STORE.notifyChange(r.id); UI.toast.ok('已通知属地 ' + (r.town || '') + ' · 留痕可查'); renderAll(); }
      });
    };
  }

  /* ---------- 右下：本月变动构成（按来源部门聚合） ---------- */
  function renderMix() {
    const body = document.getElementById('mixBody');
    if (!body) return;
    const list = STORE.changes();
    const st = STORE.changeStats();
    const map = {};
    list.forEach(r => {
      const k = deptOf(r);
      map[k] = map[k] || { up: 0, down: 0, n: 0 };
      map[k].n++;
      if (lv(r.to).order < lv(r.from).order) map[k].up++; else map[k].down++;
    });
    const keys = Object.keys(map).sort((a, b) => map[b].n - map[a].n);
    body.innerHTML = keys.map(k => `<tr data-dept="${esc(k)}" style="cursor:pointer">
      <td class="cell-main">${esc(k)}</td>
      <td class="r num" style="color:var(--red)">${map[k].up}</td>
      <td class="r num" style="color:var(--green)">${map[k].down}</td>
      <td class="r num"><b>${map[k].n}</b></td>
    </tr>`).join('') + `<tr class="tot"><td>合计</td><td class="r num">${st.up}</td><td class="r num">${st.down}</td><td class="r num">${st.total}</td></tr>`;
    /* 行点击 = 选中该来源部门最新一条变动，并把它滚到左栏可视区 */
    body.querySelectorAll('tr[data-dept]').forEach(tr => {
      tr.onclick = () => {
        const d = tr.dataset.dept;
        const hit = rows().filter(r => deptOf(r) === d);
        if (!hit.length) return;
        curId = hit[0].id;
        renderList(); renderDetail();
        const node = Array.from(listBox.querySelectorAll('.appr-item')).find(n => n.dataset.id === hit[0].id);
        if (node) { node.scrollIntoView({ block: 'center' }); }
        UI.toast(`已定位「${d}」${hit.length} 条变动（台账共 ${st.total} 条）`);
      };
    });
    const sub = document.getElementById('chgSub');
    if (sub) sub.textContent = st.total + ' 条';
    const upEl = document.getElementById('chgUp');
    const downEl = document.getElementById('chgDown');
    if (upEl) upEl.textContent = '上调 ' + st.up;
    if (downEl) downEl.textContent = '下调 ' + st.down;
    const mixTotal = document.getElementById('mixTotal');
    if (mixTotal) mixTotal.textContent = st.total + ' 条';
    const all = document.getElementById('btnChgAll');
    if (all) all.textContent = '全部 ' + st.total + ' 条 ›';

    /* 定级流程「本月」列与台账同源派生 */
    const byKey = k => list.filter(r => (r.from + '>' + r.to) === k).length;
    const setNum = (id, v) => { const n = document.getElementById(id); if (n) n.textContent = v; };
    setNum('ruleLowMid', byKey('low>mid') + byKey('mid>low'));
    setNum('ruleMidHigh', byKey('mid>high'));
    setNum('ruleHighDown', byKey('high>mid'));
    setNum('ruleDouble', byKey('high>high2') + byKey('high2>high') + byKey('high2>mid'));
  }

  /* ---------- 页头按钮 ---------- */
  function initButtons() {
    /* 登记等级变动：部门自主定级、填定级依据、登记即生效（无审批节点） */
    document.getElementById('btnNew').onclick = () => {
      if (!window.guard('edit', '登记')) return;
      const pool = D.persons.slice(0, 40);
      UI.modal({
        title: '登记等级变动',
        sub: '部门自主定级后登记，登记即生效；政法委侧只做备案与知会，不设审批节点',
        width: 520,
        okText: '登记并生效',
        body: `
          <div class="fld"><label>选择人员</label><div class="select" id="newPerson" style="height:30px">请选择人员</div></div>
          <div class="fld"><label>调整后等级</label><div class="select" id="newLevel" style="height:30px">请选择等级</div></div>
          <div class="fld"><label>定级依据 / 变动原因（不少于 15 字）</label><textarea id="newReason" placeholder="例如：社区矫正期满，连续 6 个月无违规记录，部门定级会商后下调为中风险并转入常规随访。"></textarea></div>
          <div class="tiny dim" style="margin-top:6px">提交后立即改写档案等级（无需审批），并生成不可修改的变动记录与审计流水。</div>`,
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
          if (reason.length < 15) { UI.toast.warn('定级依据不少于 15 字'); return false; }
          const p = D.personById(pick);
          const cur = STORE.levelOf(p);
          if (cur === lvlPick) { UI.toast.warn('调整后等级与原等级相同'); return false; }
          const rec = STORE.addChange({
            personId: p.id, name: p.name, town: p.town, dept: p.dept,
            from: cur, to: lvlPick, reason,
            level: ruleOf(cur, lvlPick),
            approver: D.DEPT_HEAD[p.dept] || STORE.role().user
          });
          UI.toast.ok('已登记并生效 · 档案等级变更为「' + D.levelOf(lvlPick).name + '」');
          curId = rec.id;
          renderAll();
        }
      });
    };

    /* 导出台账：与「变动登记 / 全部 N 条」完全同源，条数一致 */
    document.getElementById('btnExport').onclick = () => {
      if (!window.guard('exportPlain', '导出')) return;
      const list = STORE.changes();
      const rows = [['序号', '变动单号', '人员', '属地镇街', '来源部门', '变动日期', '原等级', '调整后等级', '调整方向', '定级依据', '部门定级责任', '登记人', '知会属地', '状态']];
      list.forEach((r, i) => rows.push([
        i + 1, r.id, r.name, r.town || '—', deptOf(r), r.date,
        D.levelOf(r.from).name, D.levelOf(r.to).name,
        D.levelOf(r.from).key === 'unknown'
          ? '补评定级'
          : (D.levelOf(r.to).order < D.levelOf(r.from).order ? '上调' : '下调'),
        r.reason, r.level, r.approver,
        STORE.notifiedOf(r).notified ? '已知会' : '待知会', r.status
      ]));
      UI.downloadCSV('等级变动台账_2026-11.csv', rows);
      STORE.addExport('等级变动台账', list.length, '明文导出');
      UI.toast.ok('已导出 ' + list.length + ' 条变动记录，操作已留痕');
    };

    /* 月度报送预览：按报送文书结构呈现，导出为「报送表」而非逐条台账。
       口径已按 D4 调整：政法委侧是「统筹备案 + 月度报送」，不是「审批」。 */
    document.getElementById('btnMonthly').onclick = () => {
      if (!window.guard('exportPlain', '月度报送')) return;
      const list = STORE.changes();
      const st = STORE.changeStats();
      const dbl = list.filter(r => String(r.level).indexOf('双签') > -1).length;
      const highNow = D.stats.highPlus;
      const depts = {};
      list.forEach(r => {
        const k = deptOf(r);
        depts[k] = depts[k] || { up: 0, down: 0, n: 0 };
        depts[k].n++;
        if (D.levelOf(r.to).order < D.levelOf(r.from).order) depts[k].up++; else depts[k].down++;
      });

      UI.modal({
        title: '月度报送预览 · 2026 年 11 月',
        sub: '中共北京市密云区委政法委员会 · 重点风险人员等级变动月度报送（政法委统筹备案后报送，导出后加盖电子印章）',
        width: 660,
        okText: '导出报送表 CSV',
        body: `
          <div style="border:1px solid var(--line);border-radius:11px;padding:16px 18px 14px;background:#fff">
            <div style="text-align:center;border-bottom:2px solid var(--t1);padding-bottom:9px;margin-bottom:11px">
              <div style="font-size:16px;font-weight:700;letter-spacing:.5px;color:var(--t1)">密云区重点风险人员等级变动月度报送表</div>
              <div class="tiny dim" style="margin-top:4px">报送期间：2026-11-01 至 2026-11-30（截至 11-10）· 编制单位：区委政法委 · 编号：MYB-2026-11</div>
            </div>
            <table class="tb compact" style="width:100%">
              <thead><tr><th style="width:132px">报送项</th><th class="r" style="width:78px">本月</th><th class="r" style="width:78px">上月</th><th>口径说明</th></tr></thead>
              <tbody>
                <tr><td class="cell-main">等级变动总量</td><td class="r num"><b>${st.total}</b> 件</td><td class="r num dim">42 件</td><td class="tiny">含本次会话新登记 ${st.live} 件；部门定级登记即生效</td></tr>
                <tr><td class="cell-main">等级上调</td><td class="r num" style="color:var(--red)"><b>${st.up}</b> 件</td><td class="r num dim">17 件</td><td class="tiny">风险升高，上调不设限，须附定级依据</td></tr>
                <tr><td class="cell-main">等级下调</td><td class="r num" style="color:var(--green)"><b>${st.down}</b> 件</td><td class="r num dim">25 件</td><td class="tiny">风险降低，下调须依据充分、经部门定级会商</td></tr>
                <tr><td class="cell-main">集体会商双签事项</td><td class="r num"><b>${dbl}</b> 件</td><td class="r num dim">3 件</td><td class="tiny">极高风险上调、一级 / A 类降级须部门集体会商 + 双签</td></tr>
                <tr><td class="cell-main">待知会属地</td><td class="r num" style="color:var(--orange)"><b>${st.waiting}</b> 件</td><td class="r num dim">0 件</td><td class="tiny">已登记生效但尚未告知属地，须尽快知会并留痕</td></tr>
                <tr><td class="cell-main">期末高风险及以上</td><td class="r num"><b>${highNow}</b> 人</td><td class="r num dim">480 人</td><td class="tiny">与驾驶舱、人员台账同源，含本次变动</td></tr>
              </tbody>
            </table>

            <div class="sect-title mt12">分部门变动构成</div>
            <table class="tb compact" style="width:100%;margin-top:4px">
              <thead><tr><th>来源部门</th><th class="r" style="width:70px">上调</th><th class="r" style="width:70px">下调</th><th class="r" style="width:70px">合计</th></tr></thead>
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
            ['密云区重点风险人员等级变动月度报送表'],
            ['报送期间', '2026-11-01 至 2026-11-30（截至 11-10）'],
            ['编制单位', '中共北京市密云区委政法委员会'],
            ['报送编号', 'MYB-2026-11'],
            [],
            ['报送项', '本月', '上月', '口径说明'],
            ['等级变动总量', st.total, 42, `含本次会话新登记 ${st.live} 件`],
            ['等级上调', st.up, 17, '风险升高，上调不设限，须附定级依据'],
            ['等级下调', st.down, 25, '风险降低，下调须依据充分、经部门定级会商'],
            ['集体会商双签事项', dbl, 3, '极高风险上调、一级 / A 类降级须部门集体会商 + 双签'],
            ['待知会属地', st.waiting, 0, '已登记生效但尚未告知属地'],
            ['期末高风险及以上', highNow, 480, '与驾驶舱、人员台账同源'],
            [],
            ['分部门构成', '上调', '下调', '合计']
          ];
          Object.keys(depts).forEach(k => rows.push([k, depts[k].up, depts[k].down, depts[k].n]));
          rows.push(['合计', st.up, st.down, st.total]);
          rows.push([]);
          rows.push(['编制人', STORE.role().user + '（' + STORE.role().roleName + '）']);
          rows.push(['审核人', '李国栋（区委常委 · 政法委书记）']);
          rows.push(['报送日期', STORE.now().slice(0, 10)]);
          rows.push(['印章', '中共北京市密云区委政法委员会（电子印章）']);
          UI.downloadCSV('密云区等级变动月度报送_2026-11.csv', rows);
          STORE.addExport('月度报送表（汇总口径）', st.total, '报送导出');
          UI.toast.ok('报送表已导出 · 汇总口径，与变动台账明细不同');
        }
      });
    };

    /* 「全部 N 条 ›」：变动登记完整清单（与导出、左栏、月报同源，不再截断） */
    const btnChgAll = document.getElementById('btnChgAll');
    if (btnChgAll) btnChgAll.onclick = e => {
      e.preventDefault();
      const list = STORE.changes().slice().sort((a, b) =>
        (b.live ? 1 : 0) - (a.live ? 1 : 0) || String(b.at).localeCompare(String(a.at)));
      const st = STORE.changeStats();
      UI.modal({
        title: '等级变动登记 · ' + st.total + ' 条',
        sub: `上调 ${st.up} · 下调 ${st.down} · 本次会话新登记 ${st.live} 条 · 待知会 ${st.waiting} 条；表格内可滚动查看全部`,
        width: 660,
        okText: '导出台账',
        body: `
          <div class="row mb8" style="gap:6px">
            <span class="tag tag-red">上调 ${st.up}</span>
            <span class="tag tag-green">下调 ${st.down}</span>
            <span class="tag tag-blue">本次登记 ${st.live}</span>
            <span class="tag tag-amber">待知会 ${st.waiting}</span>
            <span class="spacer"></span>
            <span class="tag tag-line">共 ${st.total} 条</span>
          </div>
          <div class="table-wrap" style="border:1px solid var(--line);border-radius:9px;max-height:360px;overflow:auto">
            <table class="tb compact">
              <thead><tr><th style="width:118px">人员 / 镇街</th><th style="width:52px">日期</th><th style="width:88px">变动</th><th>依据 / 部门定级责任</th><th class="r" style="width:66px">知会</th></tr></thead>
              <tbody>${list.map(r => `<tr>
                <td><span class="cell-main">${esc(r.name)}</span><span class="cell-sub">${esc(r.town || '—')}</span></td>
                <td class="dim num tiny">${esc(r.date)}</td>
                <td><span class="${lv(r.from).cls}">${SHORT[r.from]}</span> <span class="dim">→</span> <span class="${lv(r.to).cls}">${SHORT[r.to]}</span></td>
                <td class="tiny"><span style="color:var(--t2)">${esc(r.reason)}</span><br><span class="dim">${esc(r.level)} · ${esc(r.approver || '—')} · ${esc(r.id)}</span></td>
                <td class="r">${STORE.notifiedOf(r).notified ? '<span class="tag tag-green">已知会</span>' : '<span class="tag tag-amber">待知会</span>'}</td>
              </tr>`).join('')}</tbody>
            </table>
          </div>
          <div class="tiny dim" style="margin-top:9px">共 ${st.total} 条全部列示（含委办局侧调整），每条均附定级依据与变动单号；等级自登记即生效，政法委侧只做备案与知会。</div>`,
        onOk: () => document.getElementById('btnExport').click()
      });
    };
  }

  function renderAll() {
    if (!curId || !STORE.change(curId)) { const f = rows()[0]; if (f) curId = f.id; }
    renderList(); renderDetail(); renderMix();
  }

  initButtons();
  renderAll();

  /* ?focus= 深链定位：在「变动登记」左栏高亮匹配（属地或人名）的行，并滚动到可视区 */
  (function () {
    const focus = (new URLSearchParams(location.search).get('focus') || '').trim();
    if (!focus) return;
    const hit = Array.from(listBox.querySelectorAll('.appr-item')).filter(n =>
      (n.dataset.town || '').indexOf(focus) > -1 || (n.dataset.name || '').indexOf(focus) > -1);
    if (!hit.length) { UI.toast(`未在变动登记中找到「${focus}」相关记录，已显示全量`); return; }
    hit.forEach(tr => {
      tr.style.background = 'var(--blue-soft)';
      tr.style.outline = '1px solid var(--blue)';
      tr.style.outlineOffset = '-1px';
    });
    curId = hit[0].dataset.id;
    renderDetail();
    const card = listBox.closest('.card');
    if (card) card.scrollIntoView({ behavior: 'smooth', block: 'center' });
    try { hit[0].scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (e) {}
    UI.toast.ok(`已定位「${focus}」相关 ${hit.length} 条变动记录（高亮显示）`);
  })();
})();
