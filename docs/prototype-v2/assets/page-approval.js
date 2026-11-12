/* ============================================================
   page-approval.js · 审批中心 · 明文导出页签
   ------------------------------------------------------------
   承接组合查询页「提交明文导出申请」生成的申请单：
   列表（待审批优先）→ 详情（批次 / 用途 / 有效期 / 条件 / 审批链）
   → 审批通过或驳回 → 通过后可下载（脱敏文件 + 审计留痕）。
   审批链规则与「明文导出审批规则」卡片一致：
     count < 50  单人审批（政法委主管）
     count ≥ 50  双人复核（政法委主管 → 保密专员）
   依赖：data.js → store.js → ui.js（本文件只读写 STORE，不改页面其它逻辑）
   ============================================================ */
(function () {
  'use strict';
  const D = window.DATA, S = window.STORE, esc = UI.esc;
  const $ = s => document.querySelector(s);
  const $$ = s => Array.prototype.slice.call(document.querySelectorAll(s));
  if (!D || !S || !$('#plList')) return;

  const STATUS = {
    pending: { t: '审批中', cls: 'tag-amber' },
    approved: { t: '已通过', cls: 'tag-green' },
    rejected: { t: '已驳回', cls: 'tag-red' }
  };
  const STEP = {
    wait: { t: '待流转', cls: 'tag-line' },
    pending: { t: '待审批', cls: 'tag-amber' },
    approved: { t: '已通过', cls: 'tag-green' },
    rejected: { t: '已驳回', cls: 'tag-red' }
  };

  let curId = null;

  function qs() { return new URLSearchParams(location.search); }
  function reqs() { return S.plainReqs(); }
  function byId(id) { return reqs().find(x => x.id === id) || null; }
  /* 待审批优先，其次按提交时间倒序 */
  function sorted() {
    const rank = { pending: 0, rejected: 1, approved: 2 };
    return reqs().sort((a, b) => (rank[a.status] - rank[b.status]) || String(b.at).localeCompare(String(a.at)));
  }

  /* ---------- 左栏：申请单列表 ---------- */
  function renderList() {
    const list = sorted();
    const pend = list.filter(x => x.status === 'pending').length;
    const set = (id, v) => { const n = document.getElementById(id); if (n) n.textContent = v; };
    set('plCnt', pend + ' 待审批');
    set('navExpCnt', pend);
    set('plStat', '共 ' + list.length + ' 单 · 待审批 ' + pend);

    if (!list.length) {
      $('#plList').innerHTML = UI.empty('暂无明文导出申请', '在组合查询页勾选「明文导出」并提交申请');
      return;
    }
    if (!curId || !byId(curId)) {
      curId = (list.find(x => x.status === 'pending') || list[0]).id;
    }
    $('#plList').innerHTML = list.map(it => {
      const st = STATUS[it.status] || STATUS.pending;
      return `<div class="appr-item${it.id === curId ? ' on' : ''}${it.status !== 'pending' ? ' done' : ''}" data-id="${esc(it.id)}">
        <div class="row"><b>${esc(it.id)}</b><span class="spacer"></span><span class="tag ${st.cls}">${st.t}</span></div>
        <div class="tiny dim mt4">${esc(it.by)} · ${it.count} 人 · ${esc(it.purpose)}</div>
        <div class="tiny dim mt4">${esc(it.at)} · ${it.mode === 'double' ? '双人复核' : '单人审批'}</div>
      </div>`;
    }).join('');
    $('#plList').querySelectorAll('.appr-item').forEach(n => {
      n.onclick = () => {
        curId = n.dataset.id;
        renderList();
        renderDetail();
        const u = new URL(location.href);
        u.searchParams.set('id', curId);
        history.replaceState(null, '', u);
      };
    });
  }

  /* ---------- 右栏：申请详情 + 审批链 + 操作 ---------- */
  function renderDetail() {
    const it = byId(curId);
    const box = $('#plDetail');
    if (!it) {
      box.innerHTML = `<div class="card-bd">${UI.empty('请选择左侧一条申请', '右侧展示批次信息、数据范围、审批链与审批操作')}</div>`;
      return;
    }
    const st = STATUS[it.status] || STATUS.pending;
    const role = S.role();
    const selfApplied = it.by === role.user;
    const isPending = it.status === 'pending';
    const canApprove = window.STORE.can('approve');

    const chainHTML = (it.chain || []).map((a, i) => {
      const sp = STEP[a.status] || STEP.wait;
      return `<div class="pl-step${a.status === 'pending' ? ' cur' : ''}">
        <span class="pl-dot" data-s="${a.status}"></span>
        <div class="pl-step-main">
          <div class="row"><b>${i + 1}. ${esc(a.role)}</b><span class="spacer"></span>
            <span class="tag ${sp.cls}">${sp.t}</span></div>
          <div class="tiny dim">${a.status === 'wait' ? '等待前序审批通过' :
            (a.status === 'pending' ? '等待 ' + esc(a.name || '') + ' 处理'
              : esc(a.by || a.name || '系统') + ' · ' + esc(a.at || '') + (a.note ? ' · ' + esc(a.note) : ''))}</div>
        </div>
      </div>`;
    }).join('');

    box.innerHTML = `
      <div class="card-hd">
        <div class="card-title">申请详情 · ${esc(it.id)}</div>
        <div class="right"><span class="tag ${st.cls}">${st.t}</span>
          ${it.mode === 'double' ? '<span class="tag tag-red">双人复核</span>' : '<span class="tag tag-line">单人审批</span>'}</div>
      </div>
      <div class="card-bd" style="padding:12px 16px">
        <table class="tb compact" style="font-size:11.5px">
          <tbody>
            <tr><td class="dim" style="width:82px">申请人</td><td>${esc(it.by)} <span class="tiny dim">${esc(it.role || '')}</span></td></tr>
            <tr><td class="dim">提交时间</td><td>${esc(it.at)}</td></tr>
            <tr><td class="dim">批次规模</td><td><b>${it.count}</b> 条 · ${it.count >= 50 ? '≥ 50 需双人复核' : '< 50 单人审批'}</td></tr>
            <tr><td class="dim">用途 / 有效期</td><td>${esc(it.purpose)} · ${esc(it.valid)}</td></tr>
            <tr><td class="dim">数据范围</td><td>${esc(it.scope || '—')}</td></tr>
          </tbody>
        </table>
        <div class="banner banner-warn mt10" style="padding:7px 10px;font-size:11px">
          <span>${selfApplied ? '当前登录账号即申请人：审批按钮已禁用（申请人不得审批本人申请）'
            : '文件含明文姓名与身份证号，下载行为全程留痕；有效期 ' + esc(it.valid) + '，到期自动失效。'}</span>
        </div>
        <div class="pl-chain">${chainHTML}</div>
      </div>
      <div class="card-ft" style="gap:8px">
        ${!canApprove ? '<span class="tiny dim">当前角色无审批权限</span>'
            : selfApplied && isPending ? '<span class="tiny dim">申请人回避，需由其他审批人处理</span>'
              : isPending ? `<button class="btn btn-sm" id="plReject">驳回</button>
                   <button class="btn btn-sm btn-primary" id="plPass">审批通过</button>`
                : (it.status === 'approved' && it.downloadable
                  ? `<button class="btn btn-sm btn-primary" id="plDown">下载明文文件（${it.count} 条）</button>`
                  : `<span class="tiny dim">${it.status === 'rejected' ? '已驳回，需重新发起申请' : '审批完成后可下载'}</span>`)}

      </div>`;

    const pass = box.querySelector('#plPass');
    if (pass) pass.onclick = () => {
      if (!window.guard('approve', '审批明文导出')) return;
      const cur = (it.chain || []).find(a => a.status === 'pending');
      UI.confirm({
        title: '确认通过本批次明文导出？',
        sub: it.id + ' · ' + it.count + ' 人 · ' + it.purpose,
        body: `<div style="line-height:1.9">通过后该申请${it.mode === 'double' ? '还需保密专员复核，全部通过后' : '立即可'}下载明文文件；
               下载与审批都会写入审计日志。</div>`,
        okText: '确认通过',
        onOk: () => {
          S.plainReqDecide(it.id, 'approve', '通过' + (cur ? '（' + cur.role + '）' : ''));
          return true;
        }
      }).then(ok => {
        if (!ok) return;
        renderAll();
        UI.toast.ok('已通过 ' + it.id + (it.mode === 'double' ? '，转保密专员复核' : '，现在可以下载'));
      });
    };

    const rej = box.querySelector('#plReject');
    if (rej) rej.onclick = () => {
      if (!window.guard('approve', '驳回明文导出')) return;
      UI.modal({
        title: '驳回明文导出申请',
        sub: it.id + ' · 须填写驳回原因，申请人可据此重新提交',
        okText: '确认驳回',
        body: `<div class="fld"><label>驳回原因</label>
                 <textarea id="plReason" placeholder="例如：批次范围过大，请缩至本部门人员；用途说明不充分"></textarea></div>`,
        onOk: dlg => {
          const txt = (dlg.querySelector('#plReason').value || '').trim();
          if (txt.length < 4) { UI.toast.err('请填写至少 4 个字的驳回原因'); return false; }
          S.plainReqDecide(it.id, 'reject', txt);
          setTimeout(() => { renderAll(); UI.toast.warn('已驳回 ' + it.id + '，原因已写入审计'); }, 0);
          return true;
        }
      });
    };

    const down = box.querySelector('#plDown');
    if (down) down.onclick = () => {
      if (!window.guard('export', '下载明文文件')) return;
      downloadPlain(it);
    };
  }

  /* 下载明文文件：真实 CSV，首行落水印，审计留痕 */
  function downloadPlain(it) {
    if (!S.plainReqDownload(it.id)) { UI.toast.err('该申请未通过审批，无法下载'); return; }
    const day = S.wtToday ? S.wtToday() : '2026-11-10';
    const wm = `明文导出已审批 ｜ 申请单 ${it.id} ｜ 申请人 ${it.by} ｜ 审批 ${(it.chain || []).map(a => a.role).join(' → ')} ｜ ` +
      `${day} 09:45 ｜ 共 ${it.count} 条 ｜ 用途 ${it.purpose} ｜ 有效期 ${it.valid}`;
    const head = ['序号', '姓名', '档案号', '身份证号', '责任镇街', '管控等级', '类别标签', '包联干部', '未走访天数'];
    /* 原型未保存申请时的命中快照，这里按当前台账前 N 条还原（条数与被审批的批次一致） */
    const list = D.persons.slice(0, it.count);
    const data = list.map((p, i) => [i + 1, p.name, p.no, p.idNo, p.town,
      D.levelOf(S.levelOf(p)).name, (p.tags || []).join('/'), p.officer || '', p.visitGap]);
    UI.downloadCSV('明文导出_' + it.id + '.csv', [[wm], [], head].concat(data));
    renderAll();
    UI.toast.ok('已下载 ' + it.id + '（' + data.length + ' 条 · 全程留痕）');
  }

  /* ---------- 我的申请 ---------- */
  function renderMine() {
    const body = $('#plMineBody');
    if (!body) return;
    const me = S.role().user;
    const list = reqs().filter(x => x.by === me);
    const sub = $('#plMineSub');
    if (sub) sub.textContent = list.length ? list.length + ' 单' : '暂无';
    body.innerHTML = list.map(it => {
      const st = STATUS[it.status] || STATUS.pending;
      return `<tr><td><b>${esc(it.id)}</b><div class="tiny dim">${esc(it.at)}</div></td>
        <td>${it.count} 人<div class="tiny dim">${esc(it.purpose)}</div></td>
        <td class="r"><span class="tag ${st.cls}">${st.t}</span></td></tr>`;
    }).join('') || `<tr><td colspan="3"><div class="ui-empty"><b>还没有提交过明文导出申请</b>在组合查询页勾选「明文导出」后提交</div></td></tr>`;
  }

  function renderAll() { renderList(); renderDetail(); renderMine(); }

  /* ---------- 页签 ---------- */
  function initTabs() {
    const btns = $$('#apprNav button[data-tab]');
    const panels = $$('[data-panel]');
    const hint = $('#navHint');
    function go(key) {
      panels.forEach(p => { p.style.display = p.dataset.panel === key ? '' : 'none'; });
      btns.forEach(b => b.classList.toggle('on', b.dataset.tab === key));
      if (hint) hint.textContent = key === 'export' ? '待审批优先 · 通过后可下载' : '按超时与风险序排序';
      const u = new URL(location.href);
      u.searchParams.set('tab', key);
      history.replaceState(null, '', u);
      if (key === 'export') renderAll();
    }
    btns.forEach(b => { b.onclick = () => go(b.dataset.tab); });
    const q = qs();
    const init = q.get('tab');
    const wantId = q.get('id');
    if (wantId) curId = wantId;
    go(init === 'export' ? 'export' : 'level');
  }

  initTabs();
  renderAll();
  if (S.on) S.on(renderAll);
})();
