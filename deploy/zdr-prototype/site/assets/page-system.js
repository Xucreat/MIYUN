/* ============================================================
   page-system.js · 系统管理（账号与角色 / 数据字典 / 规则与参数 / 审计日志）
   ------------------------------------------------------------
   设计要点：
   1. 四个页签的右侧动作组按钮（新建账号 / 权限清单导出 / 角色模板 …）
      过去被 `#sysNav button` 一并当成页签，点击后 go(undefined) 把所有
      面板 display:none，表现为「整页空白」。此处按 data-tab 精确绑定。
   2. 所有内容由 DATA.SYS_* + STORE 配置态驱动，改一处即全站生效：
      预警规则 → 预警待办 / 数据看板 / 驾驶舱；数据质量规则 → 报送质量看板；
      阈值参数 ↔ 规则条件双向同步。
   3. 每个写操作都写审计流水，并在「提交发布」时生成版本快照。
   依赖：data.js → store.js → ui.js → shell.js
   ============================================================ */
(function () {
  'use strict';
  const D = window.DATA, S = window.STORE, U = window.UI;
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.prototype.slice.call((r || document).querySelectorAll(s));
  const esc = U.esc;
  const fmt = D.fmt;

  /* 页面态（不落盘，仅本页交互用） */
  const P = {
    role: 'R2',
    roleView: 'perm',
    dictKey: 'rcl',
    dictFilter: 'all',
    acctKw: '',
    acctPage: 1,
    acctSize: 10,
    ruleMode: 'all',
    trendPick: 6,
    auditRange: { start: '', end: '' },
    auditOp: '',
    auditRes: '',
    hashAt: '2026-11-10 06:00:03',
    hashOk: true,
    verified: []
  };

  const OK = () => window.guard('config', '系统配置变更');
  function bigNum(n) { return fmt(n); }

  /* ============================================================
     一、页签切换 + 动作组（空白页根因修复）
     ============================================================ */
  (function initTabs() {
    const panels = $$('[data-panel]');
    const btns = $$('#sysNav button[data-tab]');
    const acts = $$('#sysNav .acts');
    function go(key, silent) {
      panels.forEach(p => { p.style.display = p.dataset.panel === key ? '' : 'none'; });
      btns.forEach(b => b.classList.toggle('on', b.dataset.tab === key));
      acts.forEach(a => a.classList.toggle('on', a.dataset.for === key));
      const url = new URL(location.href);
      url.searchParams.set('tab', key);
      history.replaceState(null, '', url);
      if (!silent) refreshPanel(key);
    }
    btns.forEach(b => { b.addEventListener('click', () => go(b.dataset.tab)); });
    window.__sysGo = go;
    const init = new URLSearchParams(location.search).get('tab');
    if (init && $('[data-panel="' + init + '"]')) go(init, true);
  })();

  /* 页签切回时按当前数据重建，避免停留在首次加载的旧快照
     （历史 bug：发布配置后切到审计日志看不到记录，因为 DOM 从未重新渲染） */
  function refreshPanel(key) {
    if (key === 'audit') { renderAuditLogs(); renderHash(); renderEvents(); }
    else if (key === 'config') { renderConfig(); }
    else if (key === 'dict') { renderDictNav(); renderDict(); renderMapTable(); renderGeo(); }
    else if (key === 'account') { renderRoles(); renderRoleDetail(); }
  }
  function refreshVisiblePanel() {
    const on = $$('[data-panel]').find(el => el.offsetParent !== null);
    if (on) refreshPanel(on.dataset.panel);
  }

  /* ============================================================
     二、账号与角色
     ============================================================ */
  const ROLE_TAG = { R1: 'tag-line', R2: 'tag-blue', R3: 'tag-blue', R4: 'tag-blue', R5: 'tag-blue', R6: 'tag-blue', R7: 'tag-red', R8: 'tag-red', R9: 'tag-red' };
  function roleName(k) { return (D.SYS_ROLE_OF[k] || {}).name || k; }

  function renderRoles() {
    const box = $('#roleList');
    if (!box) return;
    const tiers = [];
    D.SYS_ROLES.forEach(r => {
      const last = tiers[tiers.length - 1];
      if (!last || last.t !== r.tier) tiers.push({ t: r.tier, tip: r.tierTip, list: [r] });
      else last.list.push(r);
    });
    box.innerHTML = tiers.map(t => `
      <div class="tier-t">${esc(t.t)} <span class="tg">${esc(t.tip || '')}</span></div>
      ${t.list.map(r => {
        const n = S.accountsOf(r.key).length;
        const st = S.permStat(r.key);
        return `<div class="role-item${P.role === r.key ? ' on' : ''}" data-role="${r.key}">
          <div class="row" style="gap:6px"><b class="sm">${esc(r.name)}</b><span class="role-code">${r.key}</span>
            <span class="spacer"></span>
            ${r.trio ? '<span class="tag tag-red" style="height:16px;font-size:9.5px">三员</span>' : '<span class="tiny dim">' + n + ' 人</span>'}
          </div>
          <div class="tiny dim" style="margin-top:2px">${esc(r.scope)} · 允许 ${st.on} 项</div>
        </div>`;
      }).join('')}`).join('');
    $('#roleCount').textContent = D.SYS_ROLES.length + ' 类';
    $$('.role-item', box).forEach(el => {
      el.onclick = () => {
        if (P.role === el.dataset.role) return;
        P.role = el.dataset.role;
        P.acctPage = 1;
        P.acctKw = '';
        renderRoles();
        renderRoleDetail();
      };
    });
    const on = $('.role-item.on', box);
    if (on) on.scrollIntoView({ block: 'nearest' });
  }

  function renderRoleDetail() {
    const r = D.SYS_ROLE_OF[P.role];
    if (!r) return;
    const st = S.permStat(P.role);
    const list = S.accountsOf(P.role);
    const title = $('#roleTitle');
    title.innerHTML = esc(r.name) + ' · 权限与账号 <span class="sub">' + r.key + ' · ' + list.length + ' 个账号 · 5 组 ' + st.total + ' 项</span>';
    $('#roleActs').innerHTML = `
      <span class="tag ${r.key === 'R1' ? 'tag-line' : 'tag-blue'}">数据范围 ${esc(r.scope)}</span>
      <button class="btn btn-sm" id="btnEditPerm">编辑权限</button>`;
    $('#btnEditPerm').onclick = openPermEditor;

    const body = $('#roleBody');
    const v = P.roleView || 'perm';
    const maskRows = D.SYS_FIELDS.length;
    body.innerHTML = `
      <div class="rv-bar" id="roleViews">
        <button data-rv="perm" class="${v === 'perm' ? 'on' : ''}">权限明细 <span class="cnt">${st.total}</span></button>
        <button data-rv="acct" class="${v === 'acct' ? 'on' : ''}">账号列表 <span class="cnt">${list.length}</span></button>
        <button data-rv="mask" class="${v === 'mask' ? 'on' : ''}">字段密级 <span class="cnt">${maskRows}</span></button>
        <span class="rv-note">三块内容互不遮挡 · 各自独立滚动</span>
      </div>

      <div class="rv-pane ${v === 'perm' ? 'on' : ''}" data-rv="perm">
        <div class="deck-h">权限明细 <span class="sub">只显示中文名称 · 悬停可看权限码与判定</span>
          <span class="right">
            <span class="perm-stat">允许 <b>${st.on}</b> · 受限 <b>${st.half}</b> · 禁止 <b>${st.off}</b></span>
            <span class="tag tag-line" style="height:17px;font-size:9.5px">服务端生效</span>
          </span>
        </div>
        <div class="rv-scroll" id="permGroups"></div>
      </div>

      <div class="rv-pane ${v === 'acct' ? 'on' : ''}" data-rv="acct">
        <div class="deck-h">账号列表 <span class="sub" id="acctSub"></span>
          <span class="right">
            <label class="input" style="height:24px;width:186px;font-size:11px;display:flex;align-items:center;gap:5px">
              <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.8" style="color:var(--t3);flex:0 0 12px"><circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5L21 21"/></svg>
              <input id="acctKw" placeholder="搜索姓名 / 账号 / 单位" style="border:0;outline:0;background:transparent;font:inherit;width:100%;color:var(--t1)">
            </label>
            <button class="btn btn-sm" id="btnAcctImport">导入</button>
          </span>
        </div>
        <div class="rv-scroll table-wrap"><table class="tb compact">
          <thead><tr><th style="width:132px">姓名 / 账号</th><th style="width:104px">单位</th><th style="width:104px">角色</th><th style="width:140px">数据范围</th><th style="width:88px">最近登录</th><th style="width:80px">状态</th><th class="r">操作</th></tr></thead>
          <tbody id="acctBody"></tbody>
        </table></div>
        <div class="pager" id="acctPager" style="border-top:1px solid var(--line)"></div>
      </div>

      <div class="rv-pane ${v === 'mask' ? 'on' : ''}" data-rv="mask">
        <div class="deck-h">字段密级 <span class="sub">按角色可见形态 · 默认拒绝 · 点击单元格可改</span>
          <span class="right"><span class="tag tag-line" style="height:17px;font-size:9.5px">当前角色列已高亮</span></span>
        </div>
        <div class="deck-box rv-scroll">
          <div class="db-hd">字段密级策略 <span class="sub">R1—R9</span>
            <span class="right">${trioTip()}</span>
          </div>
          <div style="overflow-x:auto"><table class="tb compact mask-tb" id="maskTable"></table></div>
          <div class="db-ft">掩码规则由后端返回，前端不硬编码；R1 姓名掩码 · 身份证仅前六后四。点击任一单元格可改本角色可见形态，改动写审计。</div>
        </div>
      </div>`;

    renderPermGroups();
    renderMaskTable();
    renderAcctTable();

    $$('#roleViews button[data-rv]').forEach(btn => {
      btn.onclick = () => {
        P.roleView = btn.dataset.rv;
        $$('#roleViews button[data-rv]').forEach(x => x.classList.toggle('on', x === btn));
        $$('.rv-pane', body).forEach(pn => pn.classList.toggle('on', pn.dataset.rv === P.roleView));
      };
    });
    $('#acctKw').addEventListener('input', e => {
      P.acctKw = e.target.value.trim();
      P.acctPage = 1;
      renderAcctTable();
    });
    $('#btnAcctImport').onclick = openAcctImport;
  }

  function trioTip() {
    const trio = ['R7', 'R8', 'R9'].map(k => (D.SYS_ROLE_OF[k] || {}).name).join(' / ');
    return '<span class="tag tag-line" style="height:16px;font-size:9px">' + esc(trio) + '</span>';
  }

  function renderPermGroups() {
    const box = $('#permGroups');
    if (!box) return;
    const m = S.rolePerms(P.role);
    box.innerHTML = D.SYS_PERMS.map((g, gi) => `
      <div class="perm-group"${gi === D.SYS_PERMS.length - 1 ? ' style="margin-bottom:6px"' : ''}>
        <div class="pg-t">${esc(g.g)}</div>
        <div class="perm-chips">${g.items.map(it => {
          const s = m[it.code] || 'off';
          const txt = s === 'on' ? '允许' : (s === 'half' ? '受限需审批' : '禁止');
          return `<span class="perm ${s}" title="${esc(it.code)} · ${txt}">${esc(it.name)}</span>`;
        }).join('')}</div>
      </div>`).join('');
  }

  function maskCellClass(v) {
    if (v === '明' || v === '辖区明') return 'm-ming';
    if (v === '掩') return 'm-yan';
    if (v === '申') return 'm-shen';
    return 'm-yin';
  }
  function renderMaskTable() {
    const tb = $('#maskTable');
    if (!tb) return;
    const map = S.maskMap();
    const cols = D.SYS_ROLES.map(r => r.key);
    tb.innerHTML = '<thead><tr><th class="nm" style="width:104px">字段</th>' +
      cols.map(k => `<th class="${k === P.role ? 'col-on' : ''}">${k}</th>`).join('') + '</tr></thead><tbody>' +
      D.SYS_FIELDS.map(f => `<tr><td class="nm">${esc(f.name)} <span class="tiny dim">${f.level}</span></td>` +
        cols.map(k => {
          const v = (map[f.key] || {})[k] || '隐';
          return `<td class="${maskCellClass(v)} editable${k === P.role ? ' col-on' : ''}" data-f="${f.key}" data-r="${k}" title="点击修改 ${esc(f.name)} · ${esc(roleName(k))}">${v}</td>`;
        }).join('') + '</tr>').join('') + '</tbody>';
    $$('td.editable', tb).forEach(td => {
      td.onclick = () => editMaskCell(td);
    });
  }
  function editMaskCell(td) {
    const f = td.dataset.f, rk = td.dataset.r;
    const cur = td.textContent.trim();
    const fname = (D.SYS_FIELDS.find(x => x.key === f) || {}).name || f;
    U.modal({
      title: '设置字段密级',
      sub: fname + ' · ' + roleName(rk) + '（当前：' + cur + '）',
      width: 420,
      okText: '保存',
      body: `<div class="tiny dim" style="line-height:1.6;margin-bottom:8px">
          明 = 直接可见；掩 = 掩码；申 = 需申请并留痕；隐 = 不可见；
          「本部门」「辖区明」为范围型可见，仅对 R3—R6 有意义。</div>
        <div class="row wrap" style="gap:6px" id="mkPick">${D.MASK_MODES.map(m =>
          `<button class="btn btn-sm${m === cur ? ' btn-primary' : ''}" data-m="${m}">${m}</button>`).join('')}</div>`,
      onMount: dlg => {
        let pick = cur;
        dlg.querySelectorAll('#mkPick button').forEach(b => {
          b.onclick = () => {
            pick = b.dataset.m;
            dlg.querySelectorAll('#mkPick button').forEach(x => x.classList.toggle('btn-primary', x === b));
          };
        });
        dlg.__pick = () => pick;
      },
      onOk: dlg => {
        const v = dlg.__pick();
        if (v === cur) return true;
        S.setFieldMask(rk, f, v);
        renderMaskTable();
        renderRoleDetail();
        U.toast.ok(fname + ' · ' + roleName(rk) + ' 已设为「' + v + '」，已写入审计');
        return true;
      }
    });
  }

  function acctFiltered() {
    const kw = P.acctKw.toLowerCase();
    return S.accountsOf(P.role).filter(a => {
      if (!kw) return true;
      return (a.name + a.account + a.unit + a.scope).toLowerCase().indexOf(kw) > -1;
    });
  }
  function renderAcctTable() {
    const body = $('#acctBody');
    if (!body) return;
    const list = acctFiltered();
    const pages = Math.max(1, Math.ceil(list.length / P.acctSize));
    P.acctPage = Math.min(P.acctPage, pages);
    const rows = list.slice((P.acctPage - 1) * P.acctSize, P.acctPage * P.acctSize);
    body.innerHTML = rows.length ? rows.map(a => {
      const frozen = a.status !== '正常';
      return `<tr data-id="${a.id}">
        <td><span class="cell-main">${esc(a.name)}</span><span class="cell-sub">${esc(a.account)}</span></td>
        <td>${esc(a.unit)}</td>
        <td><span class="tag ${ROLE_TAG[a.role] || 'tag-blue'}">${esc(roleName(a.role))}</span></td>
        <td>${esc(a.scope)}</td>
        <td class="num dim">${esc(a.login)}</td>
        <td><span class="tag ${frozen ? 'tag-amber' : 'tag-green'}">${esc(a.status)}</span></td>
        <td class="r"><a class="rowlink" href="#" data-act="edit">编辑</a>${frozen ? ' <a class="rowlink" href="#" data-act="active">激活</a>' : ''}</td>
      </tr>`;
    }).join('') : '<tr><td colspan="7" class="tiny dim" style="text-align:center;padding:14px">该角色下没有匹配的账号</td></tr>';
    $('#acctSub').textContent = '共 ' + list.length + ' 个 · 第 ' + P.acctPage + '/' + pages + ' 页';
    U.pager($('#acctPager'), {
      total: list.length, page: P.acctPage, size: P.acctSize, unit: '个账号',
      onChange: pg => { P.acctPage = pg; renderAcctTable(); }
    });
    $$('a.rowlink', body).forEach(a => {
      a.onclick = e => {
        e.preventDefault();
        const tr = a.closest('tr');
        const acc = S.accounts().find(x => x.id === tr.dataset.id);
        if (a.dataset.act === 'active') return activeAccount(acc);
        editAccount(acc);
      };
    });
  }

  function activeAccount(a) {
    U.confirm({
      title: '激活账号 · ' + a.name,
      sub: a.account + ' · ' + a.unit + ' · ' + a.login + ' 未登录被自动冻结',
      body: '<div class="tiny dim">激活后恢复原数据范围与权限；首次登录将强制重置口令并完成双因素绑定。</div>',
      okText: '确认激活',
      onOk: () => {
        S.setAccount(a.id, { status: '正常', login: '今天 ' + new Date().toTimeString().slice(0, 5) });
        renderAcctTable();
        renderRoles();
        U.toast.ok('账号「' + a.name + '」已激活，激活通知已发送至本人');
      }
    });
  }

  function editAccount(a) {
    if (!a) return;
    if (!OK()) return;
    const scopeOpts = ['全区 · 全字段', '全区概要 · 只读', '本部门来源人员', '本部门 + 本类别全区', '本辖区 · 可写走访', '本辖区审核', '无业务数据权限', '仅日志'];
    U.modal({
      title: '编辑账号 · ' + a.name,
      sub: a.account + ' · ' + a.unit,
      width: 470,
      okText: '保存变更',
      body: `
        <div class="field mb8"><label>角色</label><div class="select" id="acRole" style="height:32px"></div></div>
        <div class="field mb8"><label>数据范围</label><div class="select" id="acScope" style="height:32px"></div></div>
        <div class="field"><label>状态</label><div class="select" id="acSt" style="height:32px"></div></div>
        <div class="tiny dim" style="margin-top:9px">角色与数据范围变更即时生效并记入审计日志；降级前须完成该账号名下待办移交。</div>`,
      onMount: dlg => {
        let role = a.role, scope = a.scope, stat = a.status;
        U.select(dlg.querySelector('#acRole'), {
          items: D.SYS_ROLES.map(r => ({ v: r.key, t: r.name })), value: a.role,
          onChange: v => { role = v; }
        });
        U.select(dlg.querySelector('#acScope'), {
          items: scopeOpts.map(v => ({ v, t: v })), value: a.scope,
          onChange: v => { scope = v; }
        });
        U.select(dlg.querySelector('#acSt'), {
          items: [{ v: '正常', t: '正常' }, { v: '90 天未登录', t: '90 天未登录（冻结）' }, { v: '已停用', t: '已停用' }], value: a.status,
          onChange: v => { stat = v; }
        });
        dlg.__val = () => ({ role, scope, status: stat });
      },
      onOk: dlg => {
        const v = dlg.__val();
        S.setAccount(a.id, v);
        renderAcctTable();
        renderRoles();
        if (v.role !== a.role) { P.role = v.role; renderRoles(); renderRoleDetail(); }
        U.toast.ok('账号「' + a.name + '」已保存' + (v.role !== a.role ? '，角色变更为 ' + roleName(v.role) : ''));
        return true;
      }
    });
  }

  /* 批量导入账号：字段化表格逐行填写（姓名 / 登录账号 / 单位 / 角色），
     取代旧的整段逗号分隔文本框——自由文本难校验、易错列，
     字段填写后逐格读取：单位取字典、角色取下拉，与「新建账号」同源。 */
  function openAcctImport() {
    if (!OK()) return;
    const units = unitOptions();
    const roleItems = D.SYS_ROLES.map(r => ({ v: r.key, t: r.key + ' · ' + r.name }));
    const rows = [];
    U.modal({
      title: '批量导入账号',
      sub: '逐行填写，姓名与登录账号必填；重复账号自动跳过',
      width: 720,
      okText: '导入',
      body: `
        <div class="row" style="gap:8px;font-size:11px;color:var(--t3);font-weight:600;padding:0 0 4px">
          <span style="flex:1">姓名 *</span><span style="flex:1">登录账号 *</span>
          <span style="flex:1.35">单位</span><span style="flex:1.35">角色</span><span style="width:26px"></span>
        </div>
        <div id="aiRows"></div>
        <button class="btn btn-sm" id="aiAdd" type="button" style="margin-top:2px">＋ 添加一行</button>
        <div class="tiny dim" style="margin-top:8px">单位取自「责任部门 / 镇街」字典、角色取自角色目录，与「新建账号」同源；导入后立即出现在对应角色的账号列表，并写入审计。</div>`,
      onMount: dlg => {
        const box = dlg.querySelector('#aiRows');
        const inpCss = 'width:100%;border:1px solid var(--line);border-radius:8px;padding:6px 10px;font:inherit;font-size:12px;outline:none';
        function addRow(d) {
          const row = Object.assign({ name: '', acc: '', unit: '', role: 'R4' }, d || {});
          rows.push(row);
          const el = document.createElement('div');
          el.className = 'row';
          el.style.cssText = 'gap:8px;margin-bottom:8px';
          el.innerHTML = `
            <span style="flex:1"><input class="ai-name" placeholder="如：王小明" style="${inpCss}"></span>
            <span style="flex:1"><input class="ai-acc" placeholder="拼音，如：wangxm" style="${inpCss}"></span>
            <span style="flex:1.35"><div class="select ai-unit" style="height:32px"></div></span>
            <span style="flex:1.35"><div class="select ai-role" style="height:32px"></div></span>
            <button class="btn btn-sm ai-del" type="button" title="删除本行" style="width:26px;padding:0">✕</button>`;
          box.appendChild(el);
          el.querySelector('.ai-name').value = row.name;
          el.querySelector('.ai-acc').value = row.acc;
          el.querySelector('.ai-name').oninput = e => { row.name = e.target.value; };
          el.querySelector('.ai-acc').oninput = e => { row.acc = e.target.value; };
          U.select(el.querySelector('.ai-unit'), {
            items: units, value: row.unit, placeholder: '选择单位（可留空）',
            onChange: v => { row.unit = v; }
          });
          U.select(el.querySelector('.ai-role'), {
            items: roleItems, value: row.role,
            onChange: v => { row.role = v; }
          });
          el.querySelector('.ai-del').onclick = () => {
            const i = rows.indexOf(row);
            if (i > -1) rows.splice(i, 1);
            el.remove();
          };
        }
        addRow(); addRow();
        dlg.querySelector('#aiAdd').onclick = () => addRow();
        dlg.__rows = () => rows;
      },
      onOk: dlg => {
        const list = dlg.__rows() || [];
        const filled = list.filter(r => (r.name || '').trim() && (r.acc || '').trim());
        if (!filled.length) { U.toast.err('请至少完整填写一行：姓名与登录账号均为必填'); return false; }
        const exists = S.accounts().map(a => a.account);
        let ok = 0, skip = 0;
        filled.forEach(r => {
          const name = r.name.trim(), acc = r.acc.trim().toLowerCase();
          if (exists.indexOf(acc) > -1) { skip++; return; }
          S.addAccount({ name, account: acc, unit: r.unit || '未指定单位', role: D.SYS_ROLE_OF[r.role] ? r.role : 'R4', scope: '本部门来源人员' });
          exists.push(acc);
          ok++;
        });
        skip += list.length - filled.length;   /* 未填全的行 */
        P.acctPage = 1;
        renderRoles();
        renderRoleDetail();
        U.toast.ok('导入完成：新增 ' + ok + ' 个' + (skip ? '，跳过 ' + skip + ' 个（未填全 / 账号重复）' : ''));
        return true;
      }
    });
  }

  /* 单位下拉数据源：责任部门字典（按类型分组）+ 行政区划·镇街 */
  function unitOptions() {
    const out = [];
    const GROUP = { '区级': '区级部门', '成员单位': '成员单位', '支撑': '支撑单位' };
    S.dictRows('dept').forEach(r => {
      if (r.on === false) return;
      if (String(r.name).indexOf('属地镇街') > -1) return;   /* 该行是街镇汇总占位，真街镇取自 town 字典 */
      out.push({ v: r.name, t: r.name, g: GROUP[r.type] || '其他单位' });
    });
    S.dictRows('town').forEach(r => {
      if (r.on === false) return;
      out.push({ v: r.name, t: r.name, g: '街镇' });
    });
    return out;
  }

  function openAcctNew() {
    if (!OK()) return;
    const units = unitOptions();
    U.modal({
      title: '新建账号',
      sub: '账号由本人实名，一人一号；初始口令通过政务通下发',
      width: 520,
      okText: '创建账号',
      body: `
        <div class="row mb8" style="gap:10px">
          <div class="field" style="flex:1"><label>姓名</label><input id="naName" placeholder="例如：王小明" style="width:100%;border:1px solid var(--line);border-radius:8px;padding:6px 10px;font:inherit;outline:none"></div>
          <div class="field" style="flex:1"><label>登录账号</label><input id="naAcc" placeholder="拼音，如 wangxm" style="width:100%;border:1px solid var(--line);border-radius:8px;padding:6px 10px;font:inherit;outline:none"></div>
        </div>
        <div class="field mb8"><label>单位</label>
          <div class="select" id="naUnit" style="height:32px">请选择所在单位</div>
          <div class="tiny dim" style="margin-top:4px">取自「责任部门」与「行政区划·镇街」字典，不可自由填写；单位变更须走人事异动流程</div>
        </div>
        <div class="row mb8" style="gap:10px">
          <div class="field" style="flex:1"><label>角色</label><div class="select" id="naRole" style="height:32px"></div></div>
          <div class="field" style="flex:1"><label>数据范围</label><div class="select" id="naScope" style="height:32px"></div></div>
        </div>
        <div class="tiny dim">三员岗位（R7/R8/R9）须由不同自然人担任，系统会校验互斥授权。</div>`,
      onMount: dlg => {
        let role = 'R4', scope = '本部门来源人员', unit = '';
        const scopeOf = { R1: '全区概要 · 只读', R2: '全区 · 全字段', R3: '本部门 + 本类别全区', R4: '本部门来源人员', R5: '本辖区 · 可写走访', R6: '本辖区审核', R7: '无业务数据权限', R8: '无业务数据权限', R9: '仅日志' };
        U.select(dlg.querySelector('#naUnit'), {
          items: units, value: '', placeholder: '请选择所在单位',
          onChange: v => { unit = v; }
        });
        U.select(dlg.querySelector('#naRole'), {
          items: D.SYS_ROLES.map(r => ({ v: r.key, t: r.name })), value: role,
          onChange: v => { role = v; scope = scopeOf[v] || scope; U.select(dlg.querySelector('#naScope'), { items: [scope], value: scope }); }
        });
        U.select(dlg.querySelector('#naScope'), { items: [scope], value: scope });
        dlg.__val = () => ({ role, scope, unit });
      },
      onOk: dlg => {
        const name = (dlg.querySelector('#naName').value || '').trim();
        const acc = (dlg.querySelector('#naAcc').value || '').trim().toLowerCase();
        const v = dlg.__val();
        if (!name || !acc) { U.toast.err('姓名、登录账号均为必填'); return false; }
        if (!v.unit) { U.toast.err('请选择所在单位'); return false; }
        if (S.accounts().some(a => a.account === acc)) { U.toast.err('登录账号「' + acc + '」已存在'); return false; }
        const rec = S.addAccount({ name, account: acc, unit: v.unit, role: v.role, scope: v.scope });
        P.role = v.role; P.acctPage = 1; P.acctKw = '';
        renderRoles(); renderRoleDetail();
        U.toast.ok('账号「' + name + '」已创建，初始口令已通过政务通下发');
        return true;
      }
    });
  }

  /* ---- 编辑权限（5 组 48 项三态） ---- */
  function openPermEditor() {
    if (!OK()) return;
    /* B6-3b：矩阵是能被真的写进库的，所以入口要有门控 —— 只有 sys:perm:assign 能改。
       live 下 can() 读服务端 role_perm（R8 安全管理员），mock 下读本地矩阵，两边都成立。 */
    if (!S.can('sys:perm:assign')) {
      U.toast.warn('当前角色没有权限分配权（sys:perm:assign），仅可查看矩阵');
      return;
    }
    const r = D.SYS_ROLE_OF[P.role];
    const m = S.rolePerms(P.role);
    const draft = Object.assign({}, m);
    const chips = D.SYS_PERMS.map(g => `
      <div class="perm-group"><div class="pg-t">${esc(g.g)}</div>
        <div class="perm-chips">${g.items.map(it =>
          `<span class="perm ${draft[it.code]}" data-code="${it.code}" title="${esc(it.code)}">${esc(it.name)}</span>`).join('')}</div>
      </div>`).join('');
    U.modal({
      title: '编辑权限 · ' + r.name,
      sub: '点击切换三态：允许 → 受限需审批 → 禁止；保存后服务端即刻生效并写审计'
        + (window.API && API.live() ? '（当前矩阵来自服务端 role_perm）' : ''),
      width: 640,
      okText: '保存权限',
      body: `<div class="tiny dim" style="margin-bottom:8px">
          灰底 = 允许 · 黄底 = 受限需审批 · 划线 = 禁止。<b>系统管理</b>一组默认拒绝，仅三员可授。</div>
        <div style="max-height:52vh;overflow-y:auto;padding-right:4px" id="peBox">${chips}</div>`,
      onMount: dlg => {
        dlg.querySelectorAll('#peBox .perm').forEach(el => {
          el.style.cursor = 'pointer';
          el.onclick = () => {
            const c = el.dataset.code;
            const seq = ['on', 'half', 'off'];
            const cur = draft[c] || 'off';
            const next = seq[(seq.indexOf(cur) + 1) % 3];
            draft[c] = next;
            el.className = 'perm ' + next;
          };
        });
        dlg.__draft = () => draft;
      },
      onOk: dlg => {
        const nd = dlg.__draft();
        /* 一次提交整批变更：服务端一个事务、一条审计；逐项调用会变成 N 次往返。 */
        const changes = {};
        Object.keys(nd).forEach(c => { if ((nd[c] || 'off') !== (m[c] || 'off')) changes[c] = nd[c] || 'off'; });
        const n = Object.keys(changes).length;
        if (n) S.saveRolePerms(P.role, changes);
        renderRoles();
        renderRoleDetail();
        renderTrio();
        U.toast.ok(n ? '已保存 ' + r.name + ' 的 ' + n + ' 项权限变更，三员互斥已重算' : '权限未发生变化');
        return true;
      }
    });
  }

  /* ============================================================
     三、三员分立校验 + 处置责任人名录
     ============================================================ */
  const TRIPS = [
    { code: 'R7', text: '系统管理员不得查看业务明细', deny: ['person:list', 'person:view', 'person:idcard:plain', 'export:plain', 'query:execute', 'visit:create'] },
    { code: 'R8', text: '安全管理员不得运维、不得看明细', deny: ['sys:backup:exec', 'sys:user:manage', 'person:list', 'person:view', 'export:plain'] },
    { code: 'R9', text: '审计员只读日志、不改数据', deny: ['person:create', 'person:update', 'person:reduce', 'sys:user:manage', 'sys:perm:assign', 'sys:role:manage'] }
  ];
  function trioCheck() {
    const out = [];
    TRIPS.forEach(t => {
      const m = S.rolePerms(t.code);
      const bad = t.deny.filter(c => m[c] && m[c] !== 'off');
      out.push({ code: t.code, text: t.text, bad });
    });
    /* 互斥授权：同一角色不得同时持有两组互斥权限 */
    const PAIRS = [
      ['sys:user:manage', 'sys:perm:assign', '账号管理 × 权限分配'],
      ['sys:perm:assign', 'sys:audit:view', '权限分配 × 审计查看'],
      ['sys:user:manage', 'sys:audit:view', '账号管理 × 审计查看']
    ];
    const mutex = [];
    D.SYS_ROLES.forEach(r => {
      const m = S.rolePerms(r.key);
      PAIRS.forEach(p => {
        if (m[p[0]] && m[p[0]] !== 'off' && m[p[1]] && m[p[1]] !== 'off') {
          mutex.push({ role: r.name, text: p[2] });
        }
      });
    });
    return { trips: out, mutex };
  }
  function renderTrio() {
    const box = $('#trioBody');
    if (!box) return;
    const { trips, mutex } = trioCheck();
    const bad = trips.filter(t => t.bad.length).length + mutex.length;
    $('#trioTag').innerHTML = bad
      ? '<span class="tag tag-red">' + bad + ' 处冲突</span>'
      : '<span class="tag tag-green">无冲突</span>';
    box.innerHTML = trips.map(t => `
      <div class="check-row">
        <span class="tag tag-blue" style="height:16px;font-size:9.5px">${t.code}</span>
        <span style="flex:1">${esc(t.text)}</span>
        ${t.bad.length
          ? '<span class="tag tag-red" style="height:16px;font-size:9.5px">越界 ' + t.bad.length + ' 项</span>'
          : '<span class="tag tag-green" style="height:16px;font-size:9.5px">✓ 通过</span>'}
      </div>`).join('') + `
      <div class="check-row">
        <span class="tag tag-red" style="height:16px;font-size:9.5px">互斥</span>
        <span style="flex:1">账号管理 × 权限分配 不同授</span>
        ${mutex.filter(x => x.text.indexOf('账号管理 × 权限分配') > -1).length
          ? '<span class="tag tag-red" style="height:16px;font-size:9.5px">' + mutex.filter(x => x.text.indexOf('账号管理 × 权限分配') > -1).length + ' 冲突</span>'
          : '<span class="tag tag-green" style="height:16px;font-size:9.5px">0 冲突</span>'}
      </div>
      <div class="check-row">
        <span class="tag tag-red" style="height:16px;font-size:9.5px">互斥</span>
        <span style="flex:1">权限分配 × 审计查看 不同授</span>
        ${mutex.filter(x => x.text.indexOf('权限分配 × 审计查看') > -1).length
          ? '<span class="tag tag-red" style="height:16px;font-size:9.5px">' + mutex.filter(x => x.text.indexOf('权限分配 × 审计查看') > -1).length + ' 冲突</span>'
          : '<span class="tag tag-green" style="height:16px;font-size:9.5px">0 冲突</span>'}
      </div>
      <div class="divider" style="margin:7px 0 5px"></div>
      <div class="row" style="font-size:11px;color:var(--t2)"><span>90 天未登录自动停用</span><span class="spacer"></span><b id="trioIdle">—</b></div>
      <div class="row mt6" style="font-size:11px;color:var(--t2)"><span>本季度权限复核待确认</span><span class="spacer"></span><b style="color:var(--amber)">3 个部门</b></div>`;
    const idle = S.accounts().filter(a => a.status.indexOf('90 天') > -1).length;
    $('#trioIdle').textContent = idle + ' 个账号';
  }

  (function initResponders() {
    const body = $('#respBody');
    if (!body) return;
    const KIND = { '区级': 'tag-blue', '部门': 'tag-orange', '属地': 'tag-line' };
    function render() {
      const list = S.responders();
      body.innerHTML = list.map(r => `<tr data-id="${esc(r.id)}">
        <td><span class="cell-main">${esc(r.name)}</span></td>
        <td>${esc(r.unit)}</td>
        <td class="tiny">${esc(r.title)}</td>
        <td><span class="tag ${KIND[r.kind] || 'tag-line'}" style="height:17px">${esc(r.kind || '属地')}</span></td>
        <td class="mono tiny">${esc(r.phone || '—')}</td>
        <td class="tiny dim">${esc(r.note || '')}</td>
        <td class="r"><a class="rowlink" href="#" data-edit="${esc(r.id)}">编辑</a></td>
      </tr>`).join('');
      $('#respCnt').textContent = list.length + ' 人';
      $$('[data-edit]', body).forEach(a => {
        a.onclick = e => { e.preventDefault(); edit(list.find(x => x.id === a.dataset.edit)); };
      });
    }
    function edit(r) {
      if (!r || !OK()) return;
      openForm({ title: '编辑处置责任人', sub: r.id + ' · 变更将写入审计日志', data: r,
        onSave: patch => { S.updateResponder(r.id, patch); U.toast.ok('已保存 · ' + (patch.name || r.name)); render(); } });
    }
    function add() {
      if (!OK()) return;
      const seq = S.responders().filter(x => x.id.indexOf('RP-NEW-') === 0).length + 1;
      const id = 'RP-NEW-' + String(seq).padStart(2, '0');
      openForm({ title: '新增处置责任人', sub: '新增后可在预警转派与盲区指派中直接选择',
        data: { id, name: '', unit: '', title: '', kind: '部门', phone: '', note: '' },
        onSave: patch => {
          if (!patch.name || !patch.unit) return false;
          S.updateResponder(id, patch);
          U.toast.ok('已新增 · ' + patch.name + '（' + patch.unit + '）');
          render();
          return true;
        } });
    }
    function openForm(opt) {
      const d = opt.data;
      let kind = d.kind || '部门';
      U.modal({
        title: opt.title, sub: opt.sub, width: 480, okText: '保存',
        body: `
          <div class="fld"><label>姓名</label><input type="text" id="rpName" value="${esc(d.name || '')}" placeholder="例如：王振国"></div>
          <div class="fld"><label>单位</label><input type="text" id="rpUnit" value="${esc(d.unit || '')}" placeholder="例如：鼓楼街道 / 公安分局"></div>
          <div class="fld"><label>职务</label><input type="text" id="rpTitle" value="${esc(d.title || '')}" placeholder="例如：政法委员 / 政保大队"></div>
          <div class="row" style="gap:10px">
            <div class="fld" style="flex:1"><label>类别</label><div class="select" id="rpKind" style="height:32px"></div></div>
            <div class="fld" style="flex:1"><label>联系电话</label><input type="text" id="rpPhone" value="${esc(d.phone || '')}" placeholder="139****0000"></div>
          </div>
          <div class="fld"><label>备注</label><input type="text" id="rpNote" value="${esc(d.note || '')}" placeholder="例如：本部门台账主责 / 全区统筹"></div>
          <div class="tiny dim" style="margin-top:9px">类别决定转派列表的排序与筛选：区级统筹 → 部门主管 → 属地包联。</div>`,
        onMount: dlg => {
          U.select(dlg.querySelector('#rpKind'), {
            items: [{ v: '区级', t: '区级 · 政法委统筹' }, { v: '部门', t: '部门 · 四部门主管' }, { v: '属地', t: '属地 · 镇街包联' }],
            value: kind, onChange: v => { kind = v; }
          });
        },
        onOk: dlg => {
          const patch = {
            name: (dlg.querySelector('#rpName').value || '').trim(),
            unit: (dlg.querySelector('#rpUnit').value || '').trim(),
            title: (dlg.querySelector('#rpTitle').value || '').trim(),
            kind,
            phone: (dlg.querySelector('#rpPhone').value || '').trim(),
            note: (dlg.querySelector('#rpNote').value || '').trim()
          };
          if (!patch.name || !patch.unit) { U.toast.warn('姓名与单位为必填'); return false; }
          const ok = opt.onSave(patch);
          return ok === false ? false : true;
        }
      });
    }
    $('#btnRespAdd').onclick = add;
    /* 放大查看：卡片 → 弹窗完整名录（姓名/单位/职务/类别/电话/备注全量） */
    $('#btnRespExpand').onclick = () => {
      const list = S.responders();
      const byKind = { '区级': 0, '部门': 0, '属地': 0 };
      list.forEach(r => { byKind[r.kind] = (byKind[r.kind] || 0) + 1; });
      U.modal({
        title: '处置责任人名录 · 完整表格',
        sub: '预警转派 / 盲区指派 / 审批链接收人 共用 · 此页维护的变更写入审计日志',
        width: 1000,
        okText: null,
        cancelText: '关闭',
        body: `<div class="exp-lead">
            <span>共 <b>${list.length}</b> 人</span>
            <span class="dim">·</span>
            <span>区级 <b>${byKind['区级'] || 0}</b> · 部门 <b>${byKind['部门'] || 0}</b> · 属地 <b>${byKind['属地'] || 0}</b></span>
            <span class="spacer"></span>
            <span class="tiny dim">按类别排序：区级统筹 → 部门主管 → 属地包联</span>
          </div>
          <div class="exp-box">
            <table class="tb compact exp-tb exp-resp">
              <thead><tr><th>姓名</th><th>单位</th><th>职务</th><th>类别</th><th>联系电话</th><th>备注</th></tr></thead>
              <tbody>${list.slice().sort((a, b) => {
                const o = { '区级': 0, '部门': 1, '属地': 2 };
                return (o[a.kind] === undefined ? 3 : o[a.kind]) - (o[b.kind] === undefined ? 3 : o[b.kind]);
              }).map(r => `<tr>
                <td><span class="cell-main">${esc(r.name)}</span></td>
                <td>${esc(r.unit)}</td>
                <td class="tiny">${esc(r.title)}</td>
                <td><span class="tag ${KIND[r.kind] || 'tag-line'}" style="height:17px">${esc(r.kind || '属地')}</span></td>
                <td class="mono tiny">${esc(r.phone || '—')}</td>
                <td class="tiny dim">${esc(r.note || '')}</td></tr>`).join('')}</tbody>
            </table>
          </div>`
      });
    };
    $('#btnRespExport').onclick = () => {
      const rows = [['编号', '姓名', '单位', '职务', '类别', '联系电话', '备注']]
        .concat(S.responders().map(r => [r.id, r.name, r.unit, r.title, r.kind, r.phone, r.note]));
      U.downloadCSV('处置责任人名录_20261112.csv', rows);
      S.addExport('处置责任人名录', rows.length - 1, '脱敏导出');
      U.toast.ok('已导出 ' + (rows.length - 1) + ' 条');
    };
    render();
    window.__renderResp = render;
  })();

  /* ---- 权限清单：生成 / 导出 ---- */
  function permListRows() {
    const rows = [['角色编码', '角色名称', '数据范围', '账号数', '允许项', '受限项', '禁止项', '权限明细']];
    D.SYS_ROLES.forEach(r => {
      const st = S.permStat(r.key);
      const m = S.rolePerms(r.key);
      const on = D.SYS_PERM_ALL.filter(c => m[c] === 'on').map(c => D.SYS_PERM_NAME[c]).join('、');
      const half = D.SYS_PERM_ALL.filter(c => m[c] === 'half').map(c => D.SYS_PERM_NAME[c]).join('、');
      rows.push([r.key, r.name, r.scope, S.accountsOf(r.key).length, st.on, st.half, st.off,
        (on ? '允许：' + on : '') + (half ? '；受限：' + half : '')]);
    });
    return rows;
  }
  function quarterLabel() {
    const m = 11;
    return '2026 年第 ' + (m <= 3 ? 1 : m <= 6 ? 2 : m <= 9 ? 3 : 4) + ' 季度';
  }
  function openPermList() {
    const rows = permListRows();
    const period = quarterLabel();
    U.modal({
      title: '生成本季度权限清单',
      sub: period + ' · 覆盖 ' + D.SYS_ROLES.length + ' 类角色 / ' + S.accounts().length + ' 个账号',
      width: 660,
      okText: '导出清单',
      cancelText: '关闭',
      body: `<div class="tiny dim" style="margin-bottom:7px">
          清单按「角色 × 权限 × 数据范围」逐项列示，用于各部门季度确认；导出为 CSV 后随《权限复核表》一并归档。</div>
        <div style="max-height:46vh;overflow:auto"><table class="tb compact">
          <thead><tr><th style="width:56px">编码</th><th style="width:110px">角色</th><th>数据范围</th><th style="width:52px" class="r">账号</th><th style="width:44px" class="r">允许</th><th style="width:44px" class="r">受限</th></tr></thead>
          <tbody>${rows.slice(1).map(r => `<tr><td class="mono tiny">${r[0]}</td><td class="cell-main">${esc(r[1])}</td><td class="tiny">${esc(r[2])}</td><td class="num">${r[3]}</td><td class="num">${r[4]}</td><td class="num">${r[5]}</td></tr>`).join('')}</tbody>
        </table></div>`,
      onOk: () => {
        U.downloadCSV('权限清单_' + period.replace(/\s/g, '') + '.csv', rows);
        S.addExport('季度权限清单', rows.length - 1, '内部导出');
        S.permListAdd({ period, roles: D.SYS_ROLES.length, accounts: S.accounts().length });
        U.toast.ok('已生成并导出 ' + period + ' 权限清单');
        return true;
      }
    });
  }
  function openRoleTmpl() {
    const body = D.SYS_ROLES.map(r => {
      const st = S.permStat(r.key);
      return `<div class="tmpl-row">
        <div style="flex:1">
          <div class="tmpl-t">${esc(r.name)} <span class="role-code">${r.key}</span></div>
          <div class="tmpl-c">${esc(r.note)} · 允许 ${st.on} 项 / 受限 ${st.half} 项 · 数据范围 ${esc(r.scope)}</div>
        </div>
        <button class="btn btn-sm" data-tmpl="${r.key}">套用</button>
      </div>`;
    }).join('');
    U.modal({
      title: '角色模板',
      sub: '9 类标准岗位模板，套用后将该角色的权限恢复为模板基线（不影响其他角色）',
      width: 560, okText: null, cancelText: '关闭',
      body: body,
      onMount: dlg => {
        dlg.querySelectorAll('[data-tmpl]').forEach(b => {
          b.onclick = () => {
            const k = b.dataset.tmpl;
            if (!OK()) return;
            U.confirm({
              title: '套用模板 · ' + roleName(k),
              sub: '该角色当前的自定义权限将被模板覆盖',
              okText: '确认套用',
              onOk: () => {
                S.resetRolePerm(k);
                renderRoles(); renderRoleDetail(); renderTrio();
                U.toast.ok(roleName(k) + ' 已套用标准模板');
              }
            });
          };
        });
      }
    });
  }

  /* ============================================================
     四、数据字典（13 部 · 点击目录切换明细）
     ============================================================ */
  function dictCount(key) { return S.dictRows(key).length; }

  function renderDictNav() {
    const box = $('#dictNav');
    if (!box) return;
    const groups = [];
    D.SYS_DICTS.forEach(d => {
      const last = groups[groups.length - 1];
      if (!last || last.g !== d.group) groups.push({ g: d.group, list: [d] });
      else last.list.push(d);
    });
    box.innerHTML = groups.map(gr => `
      <div class="grp-t">${esc(gr.g)}</div>
      ${gr.list.map(d => {
        const on = d.key === P.dictKey;
        return `<div class="dict-item${on ? ' on' : ''}" data-key="${d.key}">
          <div class="di-l"><svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.8" style="color:${on ? 'var(--blue)' : 'currentColor'}"><path d="M4 7h16M4 12h16M4 17h10"/></svg>${esc(d.name)}<span class="cnt">${dictCount(d.key)}</span></div>
          <div class="di-s">${esc(d.sub)}</div>
        </div>`;
      }).join('')}`).join('');
    $$('.dict-item', box).forEach(el => {
      el.onclick = () => {
        if (P.dictKey === el.dataset.key) return;
        P.dictKey = el.dataset.key;
        P.dictFilter = 'all';
        renderDictNav();
        renderDict();
      };
    });
  }

  function dictCell(col, row) {
    const v = row[col.k];
    switch (col.type) {
      case 'code': return `<td class="code">${esc(v)}</td>`;
      case 'main': return `<td class="cell-main">${esc(v)}${row.pending ? ' <span class="tag tag-amber" style="height:15px;font-size:9px">待复核</span>' : ''}</td>`;
      case 'text': return `<td class="tiny">${esc(v == null ? '—' : v)}</td>`;
      case 'dept': return `<td class="tiny">${esc(v == null || v === '' ? '—' : v)}</td>`;
      case 'pills': return `<td style="white-space:nowrap">${(v || []).map(n => `<span class="risk-pill p${n >= 4 ? 3 : n}">${n}</span>`).join(' ')}</td>`;
      case 'num': return `<td class="num">${v == null ? '—' : fmt(v)}</td>`;
      case 'date': return `<td class="tiny dim">${esc(v)}</td>`;
      case 'tag': return `<td><span class="tag ${row.on ? 'tag-green' : 'tag-amber'}">${row.on ? '启用' : '停用'}</span></td>`;
      default: return `<td>${esc(v == null ? '—' : v)}</td>`;
    }
  }

  function renderDict() {
    const def = D.SYS_DICT_OF[P.dictKey];
    if (!def) return;
    const all = S.dictRows(P.dictKey);
    const onN = all.filter(r => r.on !== false).length;
    const offN = all.length - onN;
    const rows = all.filter(r => P.dictFilter === 'all' || (P.dictFilter === 'on' ? r.on !== false : r.on === false));
    const refsSum = all.reduce((a, r) => a + (Number(r.refs) || 0), 0);

    $('#dictTitle').innerHTML = esc(def.name) +
      ' <span class="sub">' + all.length + ' ' + (def.unit || '项') + (refsSum ? ' · 引用 ' + fmt(refsSum) + ' 人次' : '') + '</span>';
    $('#dictActs').innerHTML = `
      <div class="seg" id="dictSeg">
        <button data-v="all"${P.dictFilter === 'all' ? ' class="on"' : ''}>全部 ${all.length}</button>
        <button data-v="on"${P.dictFilter === 'on' ? ' class="on"' : ''}>启用 ${onN}</button>
        <button data-v="off"${P.dictFilter === 'off' ? ' class="on"' : ''}>停用 ${offN}</button>
      </div>
      <button class="btn btn-sm" id="btnDictSort">调整排序</button>`;

    const cols = def.cols.map(c => `<th${c.w ? ' style="width:' + c.w + 'px"' : ''}>${esc(c.t)}</th>`).join('');
    $('#dictBody').innerHTML = `<table class="tb compact dict-tb">
      <thead><tr>${cols}<th style="width:96px">操作</th></tr></thead>
      <tbody>${rows.length ? rows.map(r => `<tr data-code="${esc(r.code)}">
        ${def.cols.map(c => dictCell(c, r)).join('')}
        <td class="tiny"><a class="rowlink" href="#" data-op="edit">编辑</a>${refsSum ? ' · <a class="rowlink" href="#" data-op="ref">引用</a>' : ''}</td>
      </tr>`).join('') : `<tr><td colspan="${def.cols.length + 1}" class="tiny dim" style="text-align:center;padding:16px">当前筛选下没有字典项</td></tr>`}</tbody>
    </table>`;


    $$('#dictSeg button').forEach(b => {
      b.onclick = () => { P.dictFilter = b.dataset.v; renderDict(); };
    });
    $('#btnDictSort').onclick = openDictSort;
    $$('#dictBody a.rowlink').forEach(a => {
      a.onclick = e => {
        e.preventDefault();
        const code = a.closest('tr').dataset.code;
        if (a.dataset.op === 'edit') editDictRow(code);
        else dictRefs(code);
      };
    });
  }

  /* ---- 字典项表单：按列类型渲染控件（部门下拉 / 等级多选 / 文本） ---- */
  const DICT_SKIP = { code: 1, num: 1, tag: 1, date: 1 };   /* date=最近变更，由系统保存时自动写入 */

  function deptDictOptions() {
    const GROUP = { '区级': '区级部门', '成员单位': '成员单位', '支撑': '支撑单位' };
    return S.dictRows('dept').filter(r => r.on !== false && String(r.name).indexOf('属地镇街') === -1)
      .map(r => ({ v: r.name, t: r.name, g: GROUP[r.type] || '其他单位' }));
  }

  function dictFieldHtml(c, row, idPrefix) {
    const v = row[c.k];
    if (c.type === 'pills') {
      const arr = Array.isArray(v) ? v : [];
      return `<div class="field mb8"><label>${esc(c.t)}</label>
        <div class="pick-chips" data-pk="${c.k}">${[1, 2, 3, 4].map(n =>
          `<span class="pchip p${n}${arr.indexOf(n) > -1 ? ' on' : ''}" data-v="${n}">${n} 级</span>`).join('')}</div>
        <div class="tiny dim" style="margin-top:4px">可多选 · 1—4 对应「管控等级」统一风险序</div></div>`;
    }
    if (c.type === 'dept') {
      return `<div class="field mb8"><label>${esc(c.t)}</label>
        <div class="select" id="${idPrefix}${c.k}" style="height:32px"></div></div>`;
    }
    return `<div class="field mb8"><label>${esc(c.t)}</label>
      <input id="${idPrefix}${c.k}" value="${esc(v == null ? '' : (Array.isArray(v) ? v.join(' / ') : v))}"
        style="width:100%;border:1px solid var(--line);border-radius:8px;padding:6px 10px;font:inherit;outline:none"></div>`;
  }

  function bindDictFields(dlg, cols, row, idPrefix, holders) {
    cols.forEach(c => {
      if (c.type === 'dept') {
        const node = dlg.querySelector('#' + idPrefix + c.k);
        if (!node) return;
        holders[c.k] = row[c.k] || (deptDictOptions()[0] || {}).v || '';
        U.select(node, {
          items: deptDictOptions(), value: holders[c.k],
          onChange: v => { holders[c.k] = v; }
        });
      } else if (c.type === 'pills') {
        const box = dlg.querySelector('[data-pk="' + c.k + '"]');
        if (!box) return;
        holders[c.k] = (Array.isArray(row[c.k]) ? row[c.k].slice() : []);
        box.querySelectorAll('.pchip').forEach(ch => {
          ch.onclick = () => {
            const n = Number(ch.dataset.v);
            const i = holders[c.k].indexOf(n);
            if (i > -1) { holders[c.k].splice(i, 1); ch.classList.remove('on'); }
            else { holders[c.k].push(n); holders[c.k].sort(); ch.classList.add('on'); }
          };
        });
      }
    });
  }

  function collectDictFields(dlg, cols, idPrefix, holders) {
    const patch = {};
    cols.forEach(c => {
      if (c.type === 'pills') { patch[c.k] = (holders[c.k] || []).slice().sort(); return; }
      if (c.type === 'dept') { patch[c.k] = holders[c.k] || ''; return; }
      const el = dlg.querySelector('#' + idPrefix + c.k);
      if (el) patch[c.k] = el.value.trim();
    });
    return patch;
  }

  function editDictRow(code) {
    if (!OK()) return;
    const def = D.SYS_DICT_OF[P.dictKey];
    const row = S.dictRows(P.dictKey).find(r => r.code === code);
    if (!row) return;
    const fields = def.cols.filter(c => !DICT_SKIP[c.type]);
    const holders = {};
    U.modal({
      title: '编辑字典项 · ' + code,
      sub: def.name + ' · 编码不可修改，改动写入审计日志并触发受影响统计重算',
      width: 520, okText: '保存',
      body: fields.map(c => dictFieldHtml(c, row, 'dr_')).join('') +
        `<div class="field"><label>状态</label><div class="select" id="drOn" style="height:32px"></div></div>
         <div class="tiny dim" style="margin-top:8px">停用后该字典项不再出现在新建/导入的下拉中，已引用数据保持原值不变。
         「最近变更」由系统在保存时自动记录为当天日期。</div>`,
      onMount: dlg => {
        bindDictFields(dlg, fields, row, 'dr_', holders);
        U.select(dlg.querySelector('#drOn'), {
          items: [{ v: '1', t: '启用' }, { v: '0', t: '停用' }], value: row.on === false ? '0' : '1'
        });
      },
      onOk: dlg => {
        const patch = collectDictFields(dlg, fields, 'dr_', holders);
        patch.on = dlg.querySelector('#drOn').textContent.trim() === '启用';
        S.setDictRow(P.dictKey, code, patch);
        renderDictNav();
        renderDict();
        U.toast.ok(code + ' 已保存，受影响统计将于下次任务重算');
        return true;
      }
    });
  }

  function dictRefs(code) {
    const def = D.SYS_DICT_OF[P.dictKey];
    const row = S.dictRows(P.dictKey).find(r => r.code === code) || {};
    const refs = Number(row.refs) || 0;
    U.modal({
      title: '引用影响面 · ' + code,
      sub: (row.name || '') + ' · ' + def.name,
      width: 520, okText: null, cancelText: '关闭',
      body: `<div class="kv-row"><span class="muted" style="width:96px">人员档案</span><span>${fmt(refs)} 人次 · 去重 ${fmt(Math.round(refs * 0.848))} 人</span></div>
        <div class="kv-row"><span class="muted" style="width:96px">报表</span><span>14 张（月度报送 / 等级分布 / 属地汇总 等）</span></div>
        <div class="kv-row"><span class="muted" style="width:96px">预警规则</span><span>7 条（阈值与口径引用）</span></div>
        <div class="kv-row"><span class="muted" style="width:96px">导出模板</span><span>5 套（脱敏 / 明文 / 报送）</span></div>
        <div class="tiny dim" style="margin-top:9px">改名不影响历史数据；停用只影响新增与导入选项。编码一经引用不可修改。</div>`
    });
  }

  function openDictSort() {
    if (!OK()) return;
    const def = D.SYS_DICT_OF[P.dictKey];
    let list = S.dictRows(P.dictKey).slice();
    U.modal({
      title: '调整排序 · ' + def.name,
      sub: '顺序影响新建、导入与筛选下拉的呈现次序',
      width: 520, okText: '保存排序',
      body: '<div id="dsList" style="max-height:48vh;overflow:auto"></div>',
      onMount: dlg => {
        const box = dlg.querySelector('#dsList');
        const paint = () => {
          box.innerHTML = list.map((r, i) => `
            <div class="row" style="gap:8px;padding:5px 0;border-bottom:1px solid var(--line)">
              <span class="mono tiny" style="width:22px;color:var(--t4)">${i + 1}</span>
              <span class="mono tiny" style="width:74px;color:var(--t3)">${esc(r.code)}</span>
              <span style="flex:1;font-size:12px">${esc(r.name)}</span>
              <button class="btn btn-sm" data-up="${i}" ${i === 0 ? 'disabled' : ''}>↑</button>
              <button class="btn btn-sm" data-down="${i}" ${i === list.length - 1 ? 'disabled' : ''}>↓</button>
            </div>`).join('');
          box.querySelectorAll('[data-up]').forEach(b => {
            b.onclick = () => { const i = +b.dataset.up; const t = list[i - 1]; list[i - 1] = list[i]; list[i] = t; paint(); };
          });
          box.querySelectorAll('[data-down]').forEach(b => {
            b.onclick = () => { const i = +b.dataset.down; const t = list[i + 1]; list[i + 1] = list[i]; list[i] = t; paint(); };
          });
        };
        paint();
      },
      onOk: () => {
        S.setDictOrder(P.dictKey, list.map(r => r.code));
        renderDict();
        U.toast.ok(def.name + ' 排序已保存');
        return true;
      }
    });
  }

  function openDictAdd() {
    if (!OK()) return;
    let key = P.dictKey;
    let holders = {};
    const fieldCols = def => def.cols.filter(c => !DICT_SKIP[c.type] && c.type !== 'main');
    function paintFields(dlg) {
      const def = D.SYS_DICT_OF[key];
      const cols = fieldCols(def);
      holders = {};
      dlg.querySelector('#daFields').innerHTML = cols.map(c => dictFieldHtml(c, {}, 'da_')).join('');
      bindDictFields(dlg, cols, {}, 'da_', holders);
    }
    U.modal({
      title: '新增字典项',
      sub: '编码建议沿用现有前缀；新增后立即可被新建与导入使用',
      width: 520, okText: '新增',
      body: `<div class="field mb8"><label>归属字典</label><div class="select" id="daDict" style="height:32px"></div></div>
        <div class="row mb8" style="gap:10px">
          <div class="field" style="flex:0 0 160px"><label>编码</label><input id="daCode" placeholder="CODE-01" style="width:100%;border:1px solid var(--line);border-radius:8px;padding:6px 10px;font:inherit;outline:none"></div>
          <div class="field" style="flex:1"><label>名称</label><input id="daName" placeholder="字典项名称" style="width:100%;border:1px solid var(--line);border-radius:8px;padding:6px 10px;font:inherit;outline:none"></div>
        </div>
        <div id="daFields"></div>
        <div class="tiny dim">新增项默认启用；「最近变更」由系统在保存时自动记录为当天。若该字典参与统计口径，发布后需重跑受影响报表。</div>`,
      onMount: dlg => {
        U.select(dlg.querySelector('#daDict'), {
          items: D.SYS_DICTS.map(d => ({ v: d.key, t: d.name })), value: key,
          onChange: v => {
            key = v;
            dlg.querySelector('#daCode').placeholder = ((D.SYS_DICT_OF[key].rows[0] || {}).code) || 'CODE-01';
            paintFields(dlg);
          }
        });
        dlg.querySelector('#daCode').placeholder = ((D.SYS_DICT_OF[key].rows[0] || {}).code) || 'CODE-01';
        paintFields(dlg);
      },
      onOk: dlg => {
        const def2 = D.SYS_DICT_OF[key];
        const code = (dlg.querySelector('#daCode').value || '').trim();
        const name = (dlg.querySelector('#daName').value || '').trim();
        if (!code || !name) { U.toast.err('编码与名称均为必填'); return false; }
        if (S.dictRows(key).some(r => r.code === code)) { U.toast.err('编码「' + code + '」已存在'); return false; }
        const cols = fieldCols(def2);
        const patch = collectDictFields(dlg, cols, 'da_', holders);
        cols.forEach(c => {
          if (c.type === 'pills' && (!patch[c.k] || !patch[c.k].length)) patch[c.k] = [3];
        });
        S.addDictRow(key, Object.assign({ code, name, on: true }, patch));
        P.dictKey = key;
        renderDictNav();
        renderDict();
        U.toast.ok(def2.name + ' 已新增 ' + code + ' ' + name);
        return true;
      }
    });
  }

  /* ---- 部门原等级 → 统一风险序 映射（单行呈现） ---- */
  function renderMapTable() {
    const tb = $('#mapBody');
    if (!tb) return;
    const MAPS = [
      { dept: '公安分局', raw: '一级 / 二级 / 三级', pills: [['一级 → 1', 1], ['二级 → 2', 2], ['三级 → 3', 3]], note: '政保、涉访按内控标准并入' },
      { dept: '区卫健委', raw: '危险性评估 1—5 级', pills: [['≥3 级 → 1', 1], ['2 级 → 2', 2], ['1 级 → 3', 3]], note: '拒访记「不详」→ 4 待核实' },
      { dept: '区信访办', raw: '涉访 A / B / C 类', pills: [['A → 1', 1], ['B → 2', 2], ['C → 3', 3]], note: '扬言类并入 A 类' },
      { dept: '区司法局', raw: '社区矫正 严管 / 普管 / 宽管', pills: [['严管 → 2', 2], ['普管 → 3', 3], ['宽管 → 3', 3]], note: '安置帮教按普管处理' },
      { dept: '区委政法委', raw: '六失一偏 重点 / 一般', pills: [['重点 → 2', 2], ['一般 → 3', 3]], note: '须叠加部门等级取高' }
    ];
    tb.innerHTML = MAPS.map(m => `<tr>
      <td class="dept">${esc(m.dept)}</td>
      <td>${esc(m.raw)}</td>
      <td><div class="pill-row">${m.pills.map(p => `<span class="risk-pill p${p[1]}">${esc(p[0])}</span>`).join('')}</div></td>
      <td class="tiny dim">${esc(m.note)}</td>
    </tr>`).join('');
  }

  /* ---- 行政区划 ---- */
  function renderGeo() {
    const towns = S.dictRows('town');
    const comms = S.dictRows('community');
    $('#geoTownN').textContent = towns.length;
    $('#geoCommN').textContent = '372';
    $('#geoSub').textContent = towns.length + ' 镇街 · 372 社区村';
    $('#geoTowns').innerHTML = towns.map(t =>
      `<span class="tag tag-line" title="${esc(t.code)} · 在册 ${t.refs || 0} 人" style="cursor:pointer" data-town="${esc(t.name)}">${esc(t.name)}</span>`).join('');
    $('#geoComms').innerHTML = comms.map(c =>
      `<span class="tag tag-blue" title="${esc(c.code)} · ${esc(c.town)} · 在册 ${c.refs || 0} 人" style="cursor:pointer" data-comm="${esc(c.name)}">${esc(c.name)}</span>`).join('');
    $$('#geoTowns [data-town]').forEach(el => {
      el.onclick = () => {
        const t = el.dataset.town;
        const list = S.dictRows('community').filter(c => c.town === t);
        U.modal({
          title: t + ' · 社区 / 村',
          sub: '区划用于人员归属、地图下钻与属地权限（R5/R6 按辖区过滤）',
          width: 480, okText: null, cancelText: '关闭',
          body: list.length
            ? list.map(c => `<div class="kv-row"><span class="mono tiny" style="width:120px;color:var(--t3)">${esc(c.code)}</span><span style="flex:1">${esc(c.name)}</span><span class="num tiny">${c.refs || 0} 人</span></div>`).join('')
            : '<div class="tiny dim">该镇街社区明细由「导入区划」维护，当前演示数据仅覆盖鼓楼街道与檀营地区。</div>'
        });
      };
    });
    $$('#geoComms [data-comm]').forEach(el => {
      el.onclick = () => {
        const c = S.dictRows('community').find(x => x.name === el.dataset.comm);
        const owner = (S.respondersOf('属地').find(r => r.unit === c.town) || {}).name || '待指定';
        U.modal({
          title: c.name, sub: c.code + ' · ' + c.town,
          width: 440, okText: null, cancelText: '关闭',
          body: `<div class="kv-row"><span class="muted" style="width:88px">所属镇街</span><span>${esc(c.town)}</span></div>
            <div class="kv-row"><span class="muted" style="width:88px">在册人数</span><span class="num">${c.refs || 0} 人</span></div>
            <div class="kv-row"><span class="muted" style="width:88px">属地责任人</span><span>${esc(owner)}</span></div>`
        });
      };
    });
  }

  function openGeoImport() {
    if (!OK()) return;
    const towns = S.dictRows('town').filter(r => r.on !== false).map(r => ({ v: r.name, t: r.name }));
    const TOWN_CODE = {};
    S.dictRows('town').forEach(r => { TOWN_CODE[r.name] = r.code; });
    let town = towns.length ? towns[0].v : '鼓楼街道';
    let geoType = '社区';
    let rows = [{ code: '', name: '' }];
    const prefixOf = t => TOWN_CODE[t] || '110228001';
    /* 编码 = 镇街 9 位 + 3 位序号；切换镇街时把空编码与沿用旧前缀的编码一起改过来 */
    function reprefix(dlg, oldPrefix, newPrefix) {
      rows.forEach(r => { if (r.code && r.code.indexOf(oldPrefix) === 0) r.code = newPrefix + r.code.slice(oldPrefix.length); });
      paintRows(dlg);
    }
    function paintRows(dlg) {
      const box = dlg.querySelector('#geoRows');
      const pfx = prefixOf(town);
      box.innerHTML = rows.map((r, i) => `
        <div class="geo-row" data-i="${i}">
          <span class="gr-n">${i + 1}</span>
          <input class="gr-code" data-k="code" value="${esc(r.code)}" placeholder="${pfx}001" maxlength="12">
          <input class="gr-name" data-k="name" value="${esc(r.name)}" placeholder="社区 / 村名称">
          <button class="btn btn-sm btn-ghost gr-del" type="button" ${rows.length === 1 ? 'disabled' : ''}>删除</button>
        </div>`).join('');
      box.querySelectorAll('.geo-row').forEach(el => {
        const i = +el.dataset.i;
        el.querySelectorAll('input').forEach(inp => {
          inp.oninput = () => { rows[i][inp.dataset.k] = inp.value.trim(); };
        });
        el.querySelector('.gr-del').onclick = () => {
          if (rows.length === 1) return;
          rows.splice(i, 1); paintRows(dlg);
        };
      });
      const cnt = dlg.querySelector('#geoCount');
      if (cnt) cnt.textContent = rows.length + ' 条待导入';
    }
    U.modal({
      title: '导入区划 · 社区 / 村',
      sub: '按民政区划版本逐条录入；编码 12 位 = 镇街编码（9 位）+ 序号（3 位）',
      width: 620, okText: '校验并导入',
      body: `<div class="row mb8" style="gap:10px">
          <div class="field" style="flex:1"><label>上级镇街</label><div class="select" id="geoPickTown" style="height:32px"></div></div>
          <div class="field" style="flex:0 0 150px"><label>类型</label><div class="select" id="geoPickType" style="height:32px"></div></div>
        </div>
        <div class="geo-hd"><span>序号</span><span>区划编码</span><span>社区 / 村名称</span><span></span></div>
        <div id="geoRows"></div>
        <div class="row mt8" style="gap:8px;align-items:center">
          <button class="btn btn-sm" type="button" id="geoAddRow">＋ 再加一条</button>
          <span class="tiny dim" id="geoCount"></span>
          <span class="spacer"></span>
          <span class="tiny dim">编码须以 110228 开头，重复编码与同名项会被跳过</span>
        </div>`,
      onMount: dlg => {
        U.select(dlg.querySelector('#geoPickTown'), {
          items: towns, value: town,
          onChange: v => { const old = prefixOf(town); town = v; reprefix(dlg, old, prefixOf(v)); }
        });
        U.select(dlg.querySelector('#geoPickType'), {
          items: [{ v: '社区', t: '社区' }, { v: '村', t: '村' }], value: geoType,
          onChange: v => { geoType = v; }
        });
        paintRows(dlg);
        dlg.querySelector('#geoAddRow').onclick = () => { rows.push({ code: '', name: '' }); paintRows(dlg); };
      },
      onOk: dlg => {
        const pfx = prefixOf(town);
        const exist = S.dictRows('community');
        const seen = {};
        let ok = 0, dupCode = 0, dupName = 0, badPrefix = 0, blank = 0;
        rows.forEach(r => {
          const code = (r.code || '').trim(), name = (r.name || '').trim();
          if (!code || !name) { blank++; return; }
          if (code.indexOf('110228') !== 0 || code.length !== 12) { badPrefix++; return; }
          if (code.indexOf(pfx) !== 0) { badPrefix++; return; }
          if (seen[code] || exist.some(x => x.code === code)) { dupCode++; return; }
          if (seen['n:' + name] || exist.some(x => x.town === town && x.name === name)) { dupName++; return; }
          seen[code] = 1; seen['n:' + name] = 1;
          S.addDictRow('community', { code, name, town, type: geoType, refs: 0 });
          ok++;
        });
        if (!ok) {
          const why = [];
          if (blank) why.push(blank + ' 条未填全');
          if (badPrefix) why.push(badPrefix + ' 条编码不合规（须 12 位且以 ' + pfx + ' 开头）');
          if (dupCode) why.push(dupCode + ' 条编码重复');
          if (dupName) why.push(dupName + ' 条同镇街重名');
          U.toast.err('未导入任何区划：' + (why.join('；') || '请检查填写内容'));
          return false;
        }
        renderGeo();
        if (P.dictKey === 'community') { renderDictNav(); renderDict(); }
        const tail = [dupCode ? '编码重复 ' + dupCode : '', dupName ? '同名 ' + dupName : '', badPrefix ? '编码不合规 ' + badPrefix : '', blank ? '未填全 ' + blank : ''].filter(Boolean);
        U.toast.ok('已导入 ' + town + ' · ' + ok + ' 条' + (tail.length ? '，跳过 ' + tail.join(' / ') : ''));
        return true;
      }
    });
  }

  function exportDictPack() {
    const rows = [['字典', '编码', '名称', '字段2', '字段3', '字段4', '状态']];
    D.SYS_DICTS.forEach(d => {
      S.dictRows(d.key).forEach(r => {
        const cols = d.cols.filter(c => c.type !== 'code' && c.type !== 'main' && c.type !== 'tag');
        rows.push([d.name, r.code, r.name || '', cols[0] ? (Array.isArray(r[cols[0].k]) ? r[cols[0].k].join('/') : (r[cols[0].k] || '')) : '',
          cols[1] ? (r[cols[1].k] || '') : '', cols[2] ? (r[cols[2].k] || '') : '', r.on === false ? '停用' : '启用']);
      });
    });
    U.downloadCSV('字典包_' + new Date().toISOString().slice(0, 10) + '.csv', rows);
    S.addExport('字典包', rows.length - 1, '内部导出');
    U.toast.ok('已导出 ' + D.SYS_DICTS.length + ' 部字典、' + (rows.length - 1) + ' 个字典项');
  }

  /* ============================================================
     五、规则与参数
     ============================================================ */
  const TREND_BASE_PCT = 200;   /* 柱高基准（数值 / 200 = 百分比），与原型视觉一致 */

  function gkpi() {
    const rs = S.rules();
    const on = rs.filter(r => r.on).length;
    const hits = rs.reduce((a, r) => a + (r.hit || 0), 0);
    const prev = D.SYS_TREND[D.SYS_TREND.length - 2].total;
    const pend = Object.keys(S.paramsMap()).filter(k => S.paramByKey(k).pending).length;
    const v = S.ver();
    $('#kpiRules').innerHTML = on + '<span class="unit">条</span>';
    $('#kpiRulesMeta').textContent = '停用 ' + (rs.length - on) + ' · 共 ' + rs.length + ' 条';
    $('#kpiHit').innerHTML = hits + '<span class="unit">条</span>';
    $('#kpiHitDelta').textContent = (hits - prev >= 0 ? '+' : '') + (hits - prev);
    $('#kpiPending').innerHTML = pend + '<span class="unit">项</span>';
    $('#kpiVer').textContent = v.at.slice(5, 16);
    $('#kpiVerMeta').textContent = v.no + ' · 发布人 ' + v.by;
    $('#trendToday').textContent = '今日 ' + hits;
    $('#paramPending').textContent = pend + ' 项待复核';
    const draft = S.draftOf();
    const pb = $('#btnPublish');
    if (pb) pb.textContent = draft && draft.items.length ? '提交发布（' + draft.items.length + '）' : '提交发布';
  }

  function condHtml(rule) {
    if (!rule.cond) return esc(rule.threshold || '');
    return rule.cond.map(c => {
      if (!c.p) return esc(c.t);
      const p = S.paramByKey(c.p) || { value: '', unit: '' };
      return `<span class="param-val" title="引用阈值参数：${esc(p.label || '')}"><b data-p="${esc(c.p)}">${esc(p.value)}</b>${p.unit ? '<span class="u">' + esc(p.unit) + '</span>' : ''}</span>`;
    }).join('');
  }

  /* 行渲染抽成独立函数：卡片表格与「放大查看」弹窗共用，避免两处逻辑漂移 */
  function ruleRowHtml(r) {
    return `<tr data-code="${esc(r.code)}" class="${r.on ? '' : 'row-off'}">
      <td class="rid">${esc(r.code)}</td>
      <td class="cell-main">${esc(r.name)}${r.isNew ? ' <span class="tag tag-blue" style="height:15px;font-size:9px">新增</span>' : ''}</td>
      <td class="cond">${condHtml(r)}</td>
      <td class="num" style="color:${r.hit > 50 ? 'var(--red)' : (r.hit > 20 ? 'var(--orange)' : 'inherit')};${r.hit > 20 ? 'font-weight:600' : ''}">${r.hit || 0}</td>
      <td class="tiny">${esc(r.to || '—')}</td>
      <td><span class="sw-wrap" data-rule="${esc(r.code)}"><span class="sw${r.on ? '' : ' off'}"></span><span class="sw-t">${r.on ? '启用' : '停用'}</span></span></td>
    </tr>`;
  }

  /* 行内交互（开关 / 点阈值就地改）：redo 让「放大弹窗」与卡片表格双向同步 */
  function bindRuleRows(root, redo) {
    $$('.sw-wrap', root).forEach(el => {
      el.onclick = () => {
        if (!OK()) return;
        const code = el.dataset.rule;
        const r = S.ruleOf(code);
        S.toggleRule(code, !r.on);
        renderRules();
        gkpi();
        if (redo) redo();
        U.toast.ok((r.on ? '停用' : '启用') + ' ' + code + '「' + r.name + '」，明日 06:00 扫描起生效，预警待办同步更新');
      };
    });
    $$('.param-val b[data-p]', root).forEach(b => {
      b.onclick = () => editParamInline(b, redo);
    });
  }

  function renderRules() {
    const tb = $('#ruleBody');
    if (!tb) return;
    const all = S.rules();
    const on = all.filter(r => r.on).length;
    const rows = all.filter(r => P.ruleMode === 'all' || (P.ruleMode === 'on' ? r.on : !r.on));
    $('#ruleSeg').innerHTML = `<button class="${P.ruleMode === 'all' ? 'on' : ''}">全部 ${all.length}</button>
      <button class="${P.ruleMode === 'on' ? 'on' : ''}">启用 ${on}</button>
      <button class="${P.ruleMode === 'off' ? 'on' : ''}">停用 ${all.length - on}</button>`;
    tb.innerHTML = rows.map(ruleRowHtml).join('');
    $$('#ruleSeg button').forEach((b, i) => {
      b.onclick = () => { P.ruleMode = ['all', 'on', 'off'][i]; renderRules(); };
    });
    bindRuleRows(tb);
    gkpi();
  }

  function editParamInline(b, after) {
    if (!OK()) return;
    if (b.querySelector('input')) return;
    const key = b.dataset.p;
    const p = S.paramByKey(key);
    const old = b.textContent;
    b.innerHTML = '<input class="cell-ipt" value="' + esc(old) + '" style="width:' + (String(old).length * 11 + 18) + 'px;font-weight:600;text-align:center">';
    const inp = b.querySelector('input');
    inp.focus(); inp.select();
    let done = false;
    const save = () => {
      if (done) return;
      done = true;
      const v = inp.value.trim();
      if (!v || v === String(old)) { b.textContent = old; return; }
      S.setParam(key, v);
      renderRules();
      renderParams();
      if (after) after();
      U.toast.ok(p.label + ' 已改为 ' + v + (p.unit ? ' ' + p.unit : '') + '，引用该参数的规则条件同步更新');
    };
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') inp.blur(); if (e.key === 'Escape') { done = true; b.textContent = old; } });
    inp.addEventListener('blur', save);
  }

  function openRuleAdd() {
    if (!OK()) return;
    U.modal({
      title: '新增预警规则',
      sub: '命中后仅生成待办推送，不自动改动任何档案等级；保存后预警待办与驾驶舱同步可见',
      width: 500, okText: '创建规则',
      body: `
        <div class="field mb8"><label>规则名称</label><input id="nrName" placeholder="例如：异地就医记录未核对" style="width:100%;border:1px solid var(--line);border-radius:8px;padding:6px 10px;font:inherit;outline:none"></div>
        <div class="field mb8"><label>触发条件</label><input id="nrCond" placeholder="例如：距上次核对 &gt; 90 日" style="width:100%;border:1px solid var(--line);border-radius:8px;padding:6px 10px;font:inherit;outline:none"></div>
        <div class="row mb8" style="gap:8px">
          <div class="field" style="flex:1"><label>推送对象</label><input id="nrTo" value="政法委主管" style="width:100%;border:1px solid var(--line);border-radius:8px;padding:6px 10px;font:inherit;outline:none"></div>
          <div class="field" style="flex:0 0 120px"><label>状态</label><div class="select" id="nrOn" style="height:32px"></div></div>
        </div>
        <div class="tiny dim">新规则编号自动顺延，今日命中从 0 开始累计。</div>`,
      onMount: dlg => {
        U.select(dlg.querySelector('#nrOn'), { items: [{ v: '1', t: '启用' }, { v: '0', t: '停用' }], value: '1' });
      },
      onOk: dlg => {
        const name = (dlg.querySelector('#nrName').value || '').trim();
        const cond = (dlg.querySelector('#nrCond').value || '').trim();
        if (name.length < 4) { U.toast.err('规则名称至少 4 字'); return false; }
        if (cond.length < 4) { U.toast.err('触发条件至少 4 字'); return false; }
        const to = (dlg.querySelector('#nrTo').value || '').trim() || '政法委主管';
        const on = dlg.querySelector('#nrOn').textContent.trim() === '启用';
        const rec = S.addRule({ name, cond: [{ t: cond }], to, on, desc: cond });
        renderRules();
        U.toast.ok('规则 ' + rec.code + '「' + name + '」已创建，预警待办页同步可见');
        return true;
      }
    });
  }

  /* ---- 放大查看：预警规则完整表格（不受上方「全部/启用/停用」筛选影响） ---- */
  function openRuleExpand() {
    const paint = dlg => {
      const rows = S.rules();
      const box = $('#expRuleBody', dlg);
      box.innerHTML = rows.length
        ? rows.map(ruleRowHtml).join('')
        : '<tr><td colspan="6"><div class="exp-empty">暂无预警规则</div></td></tr>';
      $('#expRuleN', dlg).textContent = rows.length;
      $('#expRuleOn', dlg).textContent = rows.filter(r => r.on).length;
      $('#expRuleHit', dlg).textContent = rows.reduce((a, r) => a + (r.hit || 0), 0);
      bindRuleRows(box, () => paint(dlg));
    };
    U.modal({
      title: '预警规则 · 完整表格',
      sub: '每日 06:00 扫描 · 命中仅生成待办，不自动改等级；此处改启用状态或就地改阈值，与卡片表格、「时限与阈值」实时同步',
      width: 1060, okText: null, cancelText: '关闭',
      body: `<div class="exp-lead">
          <span>共 <b id="expRuleN">0</b> 条</span>
          <span class="dim">·</span>
          <span>启用 <b id="expRuleOn">0</b> 条</span>
          <span class="dim">·</span>
          <span>今日命中合计 <b id="expRuleHit">0</b> 条</span>
          <span class="spacer"></span>
          <span class="tiny dim">点击「触发条件」里的数值可就地修改，与阈值参数双向同步</span>
        </div>
        <div class="exp-box">
          <table class="tb compact rule-tb exp-tb exp-rule">
            <thead><tr>
              <th>编号</th><th>规则名称</th><th>触发条件（点击数值可改，与阈值参数双向同步）</th>
              <th>今日命中</th><th>推送对象</th><th>启用</th>
            </tr></thead>
            <tbody id="expRuleBody"></tbody>
          </table>
        </div>`,
      onMount: dlg => paint(dlg)
    });
  }

  /* ---- 趋势图 ---- */
  function trendMax() {
    const data = S.trend();
    return Math.max(TREND_BASE_PCT, Math.ceil(Math.max.apply(null, data.map(d => d.total)) * 1.12));
  }
  function trendAvg() {
    const data = S.trend();
    return Math.round(data.reduce((a, d) => a + d.total, 0) / data.length);
  }
  function renderTrend() {
    const data = S.trend();
    const max = trendMax();
    const avg = trendAvg();
    const rules = S.rules();
    const chart = $('#trendChart');
    chart.innerHTML = data.map((d, i) => {
      const h = Math.round(d.total / max * 100);
      const isToday = i === data.length - 1;
      const color = isToday ? 'var(--red)' : (d.total >= 150 ? '#a9cbec' : '#cfe3f8');
      return `<div class="tr-bar${i === P.trendPick ? ' on' : ''}" data-i="${i}">
        <span style="${isToday ? 'color:var(--red);font-weight:650' : ''}">${d.total}</span>
        <i style="height:${h}%;background:${color}"></i>
      </div>`;
    }).join('') + `<div class="tr-avg" style="bottom:${Math.round(avg / max * 100)}%"><em>均值 ${avg}</em></div>`;
    $('#trendX').innerHTML = data.map((d, i) => `<span data-i="${i}" style="${i === data.length - 1 ? 'color:var(--red)' : ''}">${esc(d.date)}</span>`).join('');
    $('#trendSub').textContent = '按日汇总 · 虚线为均值 ' + avg;
    $('#trendFoot').textContent = '均值为近 7 日（含当日）算术平均；点击柱条可下钻当日各规则命中明细';

    const d = data[P.trendPick] || data[data.length - 1];
    const list = Object.keys(d.rules).map(code => ({ code, name: (rules.find(r => r.code === code) || {}).name || code, n: d.rules[code] }))
      .filter(x => x.n > 0).sort((a, b) => b.n - a.n);
    $('#trendTop').innerHTML = list.slice(0, 3).map(x =>
      `<div class="impact-row"><span>${esc(x.code)} ${esc(x.name)}</span><span class="spacer"></span><b>${x.n}</b><span class="tiny dim">条</span></div>`).join('');
    $('#trendFoot').textContent = '均值为近 7 日（含当日）算术平均；其余 ' + Math.max(0, list.length - 3) + ' 条规则合计 ' +
      (d.total - list.slice(0, 3).reduce((a, x) => a + x.n, 0)) + ' 条 · 点击柱条下钻当日明细';

    $$('#trendChart .tr-bar').forEach(bar => {
      const i = +bar.dataset.i;
      const day = data[i];
      U.tip(bar, () => {
        const prev = i > 0 ? data[i - 1].total : null;
        const delta = prev == null ? '—' : (day.total - prev >= 0 ? '+' : '') + (day.total - prev);
        const top = Object.keys(day.rules).map(c => ({ c, n: day.rules[c] })).filter(x => x.n > 0).sort((a, b) => b.n - a.n).slice(0, 3);
        return `<div style="font-weight:650;margin-bottom:4px">${day.date} · 命中 ${day.total} 条</div>
          <div style="font-size:11px;line-height:1.7">环比 <b>${delta}</b> · 均值 <b>${avg}</b><br>
          ${top.map(x => (rules.find(r => r.code === x.c) || {}).name + ' <b>' + x.n + '</b> 条').join('<br>')}</div>
          <div style="font-size:10px;opacity:.7;margin-top:4px">点击查看当日明细</div>`;
      });
      bar.onclick = () => { P.trendPick = i; renderTrend(); openTrendDay(i); };
    });
    $$('#trendX span').forEach(s => {
      s.style.cursor = 'pointer';
      s.onclick = () => { P.trendPick = +s.dataset.i; renderTrend(); };
    });
  }

  function openTrendDay(i) {
    const data = S.trend();
    const day = data[i];
    const rules = S.rules();
    const avg = trendAvg();
    const list = Object.keys(day.rules).map(code => {
      const r = rules.find(x => x.code === code) || { name: code, to: '—' };
      return { code, name: r.name, to: r.to, n: day.rules[code] };
    }).filter(x => x.n > 0).sort((a, b) => b.n - a.n);
    const sum = list.reduce((a, x) => a + x.n, 0);
    U.modal({
      title: day.date + ' · 命中明细',
      sub: '合计 ' + day.total + ' 条 · 较均值 ' + (day.total - avg >= 0 ? '+' : '') + (day.total - avg) + ' 条',
      width: 560, okText: null, cancelText: '关闭',
      body: `<table class="tb compact">
        <thead><tr><th style="width:64px">编号</th><th>规则</th><th style="width:88px">推送对象</th><th style="width:56px" class="r">命中</th><th style="width:52px" class="r">占比</th></tr></thead>
        <tbody>${list.map(x => `<tr><td class="rid">${esc(x.code)}</td><td class="cell-main">${esc(x.name)}</td>
          <td class="tiny">${esc(x.to || '—')}</td><td class="num">${x.n}</td>
          <td class="num tiny dim">${sum ? Math.round(x.n / sum * 100) : 0}%</td></tr>`).join('')}</tbody>
      </table>
      <div class="tiny dim" style="margin-top:8px">与「${day.date}」当日预警待办同源；命中只生成待办，不自动改等级。</div>`,
      onMount: dlg => {
        dlg.querySelectorAll('tbody tr').forEach((tr, k) => {
          tr.style.cursor = 'pointer';
          tr.onclick = () => {
            U.toast.ok('已定位 ' + list[k].code + '「' + list[k].name + '」当日 ' + list[k].n + ' 条待办（演示环境）');
          };
        });
      }
    });
  }

  /* ---- 时限与阈值 ---- */
  function renderParams() {
    const box = $('#paramBody');
    if (!box) return;
    box.innerHTML = Object.keys(S.paramsMap()).map(k => {
      const p = S.paramByKey(k);
      return `<div class="param-row">
        <div class="param-l">${esc(p.label)}<span class="tiny dim" style="font-weight:400"> · ${esc(p.tip || '')}</span></div>
        <div class="param-val editable" data-p="${k}" title="点击修改${p.rule ? '，规则 ' + p.rule + ' 条件同步更新' : ''}">
          <b>${esc(p.value)}</b>${p.unit ? '<span class="u">' + esc(p.unit) + '</span>' : ''}
          ${p.pending ? '<span class="tag tag-amber" style="height:15px;font-size:9px">待复核</span>' : ''}
        </div>
      </div>`;
    }).join('');
    $$('#paramBody .param-val').forEach(el => {
      el.onclick = () => openParamEdit(el.dataset.p);
    });
  }
  function openParamEdit(key) {
    if (!OK()) return;
    const p = S.paramByKey(key);
    U.modal({
      title: '修改阈值 · ' + p.label,
      sub: p.rule ? '该参数被规则 ' + p.rule + ' 引用，保存后规则条件同步更新' : '保存后次日 06:00 生效',
      width: 440, okText: '保存',
      body: `<div class="row" style="gap:8px;align-items:center">
          <input id="pmVal" value="${esc(p.value)}" style="flex:1;border:1px solid var(--line);border-radius:8px;padding:7px 10px;font:inherit;outline:none">
          <span class="tiny dim">${esc(p.unit || '')}</span>
        </div>
        <div class="tiny dim" style="margin-top:8px">${esc(p.tip || '')}</div>`,
      onOk: dlg => {
        const v = (dlg.querySelector('#pmVal').value || '').trim();
        if (!v) { U.toast.err('请输入阈值'); return false; }
        S.setParam(key, v);
        renderParams();
        renderRules();
        U.toast.ok(p.label + ' 已改为 ' + v + (p.unit ? ' ' + p.unit : '') + (p.rule ? '，' + p.rule + ' 条件已同步' : ''));
        return true;
      }
    });
  }

  /* ---- 等级变动定级流程（会议决议 D4：部门内部定级，节点名对齐 risk.html 定级流程） ---- */
  function renderRoutes() {
    const box = $('#routeBody');
    if (!box) return;
    box.innerHTML = S.routes().map((r, i) => `<div style="${i === S.routes().length - 1 ? '' : 'margin-bottom:9px'}">
      <div class="row" style="font-size:11.5px;margin-bottom:4px"><span class="risk risk-${r.to}">${esc(r.name)}</span><span class="spacer"></span><span class="tiny dim">定级时限 ${r.days} 日</span></div>
      <div class="chain-row">${r.nodes.map((n, k) =>
        `<span class="chain-step${k === 0 ? ' first' : (k === r.nodes.length - 1 ? ' last' : '')}">${esc(n)}</span>` +
        (k < r.nodes.length - 1 ? '<span class="chain-ar">›</span>' : '')).join('')}</div>
    </div>`).join('') +
      `<div class="tiny dim" style="margin-top:2px;line-height:1.45">定级流程由本表生成：「等级变动」页按目标风险序取对应链路；末节点「报政法委备案」是知会留痕，不是审批关口。</div>`;
  }

  /* ---- 数据质量规则 ---- */
  function dqRowHtml(r) {
    return `<tr data-code="${esc(r.code)}" class="${r.on ? '' : 'row-off'}">
      <td class="rid">${esc(r.code)}</td>
      <td class="cell-main">${esc(r.name)}${r.isNew ? ' <span class="tag tag-blue" style="height:15px;font-size:9px">新增</span>' : ''}</td>
      <td class="tiny">${esc(r.desc)}</td>
      <td class="num" style="color:${r.hit ? (r.act === '拦截' ? 'var(--red)' : 'var(--orange)') : 'inherit'}">${r.hit || 0}</td>
      <td class="tiny">${esc(r.act)}</td>
      <td><span class="sw-wrap" data-dq="${esc(r.code)}"><span class="sw${r.on ? '' : ' off'}"></span><span class="sw-t">${r.on ? '启用' : '停用'}</span></span></td>
      <td class="r"><a class="rowlink" href="#" data-edit="${esc(r.code)}">编辑</a></td>
    </tr>`;
  }

  /* redo 让「放大弹窗」与卡片表格双向同步 */
  function bindDqRows(root, redo) {
    $$('.sw-wrap', root).forEach(el => {
      el.onclick = () => {
        if (!OK()) return;
        const code = el.dataset.dq;
        const r = S.dqRules().find(x => x.code === code);
        S.setDq(code, { on: !r.on });
        renderDq();
        if (redo) redo();
        U.toast.ok((r.on ? '停用' : '启用') + ' ' + code + '「' + r.name + '」，报送质量看板同步');
      };
    });
    $$('a[data-edit]', root).forEach(a => {
      a.onclick = e => { e.preventDefault(); editDq(a.dataset.edit, redo); };
    });
  }

  function renderDq() {
    const tb = $('#dqSysBody');
    if (!tb) return;
    tb.innerHTML = S.dqRules().map(dqRowHtml).join('');
    bindDqRows(tb);
  }

  /* ---- 放大查看：数据质量规则完整表格 ---- */
  function openDqExpand() {
    const paint = dlg => {
      const rows = S.dqRules();
      const box = $('#expDqBody', dlg);
      box.innerHTML = rows.length
        ? rows.map(dqRowHtml).join('')
        : '<tr><td colspan="7"><div class="exp-empty">暂无数据质量规则</div></td></tr>';
      $('#expDqN', dlg).textContent = rows.length;
      $('#expDqOn', dlg).textContent = rows.filter(r => r.on).length;
      $('#expDqHit', dlg).textContent = rows.reduce((a, r) => a + (r.hit || 0), 0);
      bindDqRows(box, () => paint(dlg));
    };
    U.modal({
      title: '数据质量规则 · 完整表格',
      sub: '导入与人工录入共用 · 与「报送质量」看板同源；此处改启用状态、改规则说明，卡片表格与看板实时同步',
      width: 1060, okText: null, cancelText: '关闭',
      body: `<div class="exp-lead">
          <span>共 <b id="expDqN">0</b> 条</span>
          <span class="dim">·</span>
          <span>启用 <b id="expDqOn">0</b> 条</span>
          <span class="dim">·</span>
          <span>今日命中合计 <b id="expDqHit">0</b> 条</span>
          <span class="spacer"></span>
          <span class="tiny dim">「拦截」动作命中不入库，仅留痕供追溯</span>
        </div>
        <div class="exp-box">
          <table class="tb compact mini-tb exp-tb exp-dq">
            <thead><tr>
              <th>编号</th><th>规则</th><th>校验说明</th>
              <th class="r">今日命中</th><th>动作</th><th>启用</th><th class="r">操作</th>
            </tr></thead>
            <tbody id="expDqBody"></tbody>
          </table>
        </div>`,
      onMount: dlg => paint(dlg)
    });
  }
  function editDq(code, after) {
    if (!OK()) return;
    const r = S.dqRules().find(x => x.code === code);
    U.modal({
      title: '编辑数据质量规则 · ' + code,
      sub: '与「报送质量」看板同源，保存后两页立即一致',
      width: 500, okText: '保存',
      body: `<div class="field mb8"><label>规则名称</label><input id="dqName" value="${esc(r.name)}" style="width:100%;border:1px solid var(--line);border-radius:8px;padding:6px 10px;font:inherit;outline:none"></div>
        <div class="field mb8"><label>校验说明</label><input id="dqDesc" value="${esc(r.desc)}" style="width:100%;border:1px solid var(--line);border-radius:8px;padding:6px 10px;font:inherit;outline:none"></div>
        <div class="row mb8" style="gap:10px">
          <div class="field" style="flex:1"><label>动作</label><div class="select" id="dqAct" style="height:32px"></div></div>
          <div class="field" style="flex:1"><label>状态</label><div class="select" id="dqOn" style="height:32px"></div></div>
        </div>`,
      onMount: dlg => {
        U.select(dlg.querySelector('#dqAct'), { items: [{ v: '拦截', t: '拦截（不入库）' }, { v: '告警', t: '告警（入库并标记）' }, { v: '通过', t: '仅记录' }], value: r.act });
        U.select(dlg.querySelector('#dqOn'), { items: [{ v: '1', t: '启用' }, { v: '0', t: '停用' }], value: r.on ? '1' : '0' });
      },
      onOk: dlg => {
        const name = (dlg.querySelector('#dqName').value || '').trim();
        const desc = (dlg.querySelector('#dqDesc').value || '').trim();
        if (name.length < 2) { U.toast.err('规则名称至少 2 字'); return false; }
        S.setDq(code, {
          name, desc,
          act: dlg.querySelector('#dqAct').textContent.trim().replace(/（.*）/, ''),
          on: dlg.querySelector('#dqOn').textContent.trim() === '启用'
        });
        renderDq();
        if (after) after();
        U.toast.ok(code + ' 已保存，报送质量看板同步生效');
        return true;
      }
    });
  }
  function openDqAdd() {
    if (!OK()) return;
    U.modal({
      title: '新增数据质量规则',
      sub: '新增后同时出现在「报送质量」看板；命中数从 0 起累计',
      width: 500, okText: '创建规则',
      body: `<div class="field mb8"><label>规则名称</label><input id="dqNewName" placeholder="例如：户籍地址与区划一致性" style="width:100%;border:1px solid var(--line);border-radius:8px;padding:6px 10px;font:inherit;outline:none"></div>
        <div class="field mb8"><label>校验说明</label><input id="dqNewDesc" placeholder="例如：户籍地址须落在已启用镇街内" style="width:100%;border:1px solid var(--line);border-radius:8px;padding:6px 10px;font:inherit;outline:none"></div>
        <div class="row" style="gap:10px">
          <div class="field" style="flex:1"><label>动作</label><div class="select" id="dqNewAct" style="height:32px"></div></div>
          <div class="field" style="flex:1"><label>状态</label><div class="select" id="dqNewOn" style="height:32px"></div></div>
        </div>`,
      onMount: dlg => {
        U.select(dlg.querySelector('#dqNewAct'), { items: [{ v: '拦截', t: '拦截（不入库）' }, { v: '告警', t: '告警（入库并标记）' }], value: '告警' });
        U.select(dlg.querySelector('#dqNewOn'), { items: [{ v: '1', t: '启用' }, { v: '0', t: '停用' }], value: '1' });
      },
      onOk: dlg => {
        const name = (dlg.querySelector('#dqNewName').value || '').trim();
        const desc = (dlg.querySelector('#dqNewDesc').value || '').trim();
        if (name.length < 2) { U.toast.err('规则名称至少 2 字'); return false; }
        if (desc.length < 4) { U.toast.err('校验说明至少 4 字'); return false; }
        const rec = S.addDq({
          name, desc,
          act: dlg.querySelector('#dqNewAct').textContent.trim().replace(/（.*）/, ''),
          on: dlg.querySelector('#dqNewOn').textContent.trim() === '启用',
          hit: 0
        });
        renderDq();
        U.toast.ok('规则 ' + rec.code + '「' + name + '」已创建，报送质量看板同步');
        return true;
      }
    });
  }

  /* ---- 脱敏与导出策略（可编辑） ---- */
  function renderDesens() {
    const tb = $('#desensBody');
    if (!tb) return;
    const modeTag = m => m === '明文' ? 'tag-blue' : (m === '需申请' ? 'tag-amber' : (m === '禁止展示' ? 'tag-red' : 'tag'));
    tb.innerHTML = S.desens().map(r => `<tr data-key="${esc(r.key)}">
      <td class="cell-main">${esc(r.field)}</td>
      <td><span class="tag ${modeTag(r.mode)} editable" data-mode="${esc(r.key)}" title="点击修改默认展示">${esc(r.mode)}</span></td>
      <td class="tiny editable" data-cond="${esc(r.key)}" title="点击编辑明文条件">${esc(r.cond)}</td>
    </tr>`).join('');
    $$('#desensBody [data-mode]').forEach(el => {
      el.onclick = () => {
        if (!OK()) return;
        const k = el.dataset.mode;
        const row = S.desens().find(x => x.key === k);
        U.modal({
          title: '默认展示 · ' + row.field,
          sub: '决定列表与详情页在无审批时的默认呈现形态',
          width: 420, okText: '保存',
          body: `<div class="row wrap" style="gap:6px" id="dmPick">${S.DESENS_MODES.map(m =>
            `<button class="btn btn-sm${m === row.mode ? ' btn-primary' : ''}" data-m="${m}">${m}</button>`).join('')}</div>
            <div class="tiny dim" style="margin-top:9px">改后与「字段密级」矩阵交叉校验：若矩阵为「隐」而此处为「明文」，发布时会提示冲突。</div>`,
          onMount: dlg => {
            let pick = row.mode;
            dlg.querySelectorAll('#dmPick button').forEach(b => {
              b.onclick = () => {
                pick = b.dataset.m;
                dlg.querySelectorAll('#dmPick button').forEach(x => x.classList.toggle('btn-primary', x === b));
              };
            });
            dlg.__pick = () => pick;
          },
          onOk: dlg => {
            const v = dlg.__pick();
            if (v !== row.mode) S.setDesens(k, { mode: v });
            renderDesens();
            U.toast.ok(row.field + ' 默认展示已设为「' + v + '」');
            return true;
          }
        });
      };
    });
    $$('#desensBody [data-cond]').forEach(el => {
      el.onclick = () => {
        if (!OK()) return;
        const k = el.dataset.cond;
        const row = S.desens().find(x => x.key === k);
        U.modal({
          title: '明文条件 / 导出限制 · ' + row.field,
          width: 480, okText: '保存',
          body: `<input id="dsCond" value="${esc(row.cond)}" style="width:100%;border:1px solid var(--line);border-radius:8px;padding:7px 10px;font:inherit;outline:none">
            <div class="tiny dim" style="margin-top:8px">示例：双人复核；禁止明文导出 / 本部门可直接看；导出脱敏</div>`,
          onOk: dlg => {
            const v = (dlg.querySelector('#dsCond').value || '').trim();
            if (!v) { U.toast.err('条件不能为空'); return false; }
            S.setDesens(k, { cond: v });
            renderDesens();
            U.toast.ok(row.field + ' 条件已更新');
            return true;
          }
        });
      };
    });
  }

  /* ---- 草稿 / 发布 ---- */
  /* ---- 草稿状态条：始终可见，说明草稿存在哪、有几项、能否查看/放弃 ---- */
  function renderDraftBar() {
    const bar = $('#draftBar');
    if (!bar) return;
    const d = S.draftOf();
    const items = (d && d.items) || [];
    const n = items.length;
    bar.classList.toggle('has', n > 0);
    $('#draftN').textContent = n;
    const at = d && (d.savedAt || d.at);
    $('#draftAt').textContent = n
      ? (at ? '改于 ' + String(at).slice(5) : '待发布')
      : '无未发布改动';
    const view = $('#draftView'), drop = $('#draftDrop');
    if (view) view.setAttribute('aria-disabled', n ? 'false' : 'true');
    if (drop) drop.setAttribute('aria-disabled', n ? 'false' : 'true');
    const pb = $('#btnPublish'), db = $('#btnDraft');
    if (pb) pb.textContent = n ? '提交发布（' + n + '）' : '提交发布';
    if (db) db.textContent = n ? '保存草稿（' + n + '）' : '保存草稿';
  }

  function openDraft() {
    const d = S.draftOf();
    const items = (d && d.items) || [];
    U.modal({
      title: '配置草稿',
      sub: items.length ? '共 ' + items.length + ' 项未发布变更 · 存于本机 localStorage（关闭标签页不丢失）' : '当前没有未发布的变更',
      width: 580, okText: items.length ? '保存到本机' : null, cancelText: '关闭',
      body: items.length ? `<div style="max-height:44vh;overflow:auto">${items.map((x, i) => `
        <div class="row" style="gap:8px;padding:5px 0;border-bottom:1px solid var(--line);font-size:11.5px">
          <span class="tiny dim" style="width:20px">${i + 1}</span>
          <span class="tag tag-line" style="height:17px;font-size:9.5px">${esc(x.section)}</span>
          <span style="flex:1">${esc(x.desc)}</span>
          <span class="tiny dim">${esc((x.at || '').slice(11))}</span>
        </div>`).join('')}</div>
        <div class="kv-row" style="margin-top:9px"><span class="muted" style="width:88px">最近保存</span><span>${esc((d.savedAt || d.at || '—'))}${d.by ? ' · ' + esc(d.by) : ''}</span></div>`
        : '<div class="tiny dim">在权限矩阵、字段密级、字典、规则、阈值、账号里做任何修改都会自动进入草稿，集中「提交发布」后生成版本快照并写审计。</div>',
      onOk: () => {
        const r = S.saveDraft();
        renderDraftBar();
        U.toast.ok('草稿已保存到本机（' + ((r.items || []).length) + ' 项），关闭标签页也不丢失');
      }
    });
  }
  function dropDraft() {
    const d = S.draftOf();
    const n = ((d && d.items) || []).length;
    if (!n) { U.toast.err('当前没有待放弃的草稿'); return; }
    U.confirm({
      title: '放弃配置草稿',
      sub: '将清空 ' + n + ' 项未发布变更，此操作写入审计日志',
      okText: '确认放弃',
      body: '<div class="tiny dim">放弃后配置回到上次发布版本；已生效的线上配置不受影响。</div>',
      onOk: () => {
        S.discardDraft();
        renderDraftBar();
        renderConfig();
        U.toast.ok('已放弃 ' + n + ' 项草稿，配置回到 ' + S.ver().no);
      }
    });
  }
  function openPublish() {
    if (!OK()) return;
    const d = S.draftOf();
    const items = (d && d.items) || [];
    const v = S.ver();
    const groups = {};
    items.forEach(x => { groups[x.section] = (groups[x.section] || 0) + 1; });
    U.confirm({
      title: '提交发布',
      sub: '发布后版本号升级、生成快照，配置于次日 06:00 生效（生效前可回滚）',
      okText: '确认发布',
      body: items.length
        ? `<div class="kv-row"><span class="muted" style="width:88px">当前版本</span><span><b>${v.no}</b> · ${esc(v.at)} · ${esc(v.by)}</span></div>
           <div class="kv-row"><span class="muted" style="width:88px">本次变更</span><span>${items.length} 项</span></div>
           <div class="kv-row"><span class="muted" style="width:88px">涉及模块</span><span>${Object.keys(groups).map(k => esc(k) + ' ' + groups[k] + ' 项').join(' · ')}</span></div>
           <div class="tiny dim" style="margin-top:8px">发布后预警待办、数据看板、驾驶舱读取到的规则与阈值同步更新。</div>`
        : '<div class="tiny dim">当前没有待发布变更，直接发布会生成一个空版本快照。</div>',
      onOk: () => {
        const r = S.publish();
        renderRules(); renderDesens(); renderDq(); renderParams(); gkpi();
        renderDraftBar();
        renderAuditLogs(); renderHash(); renderEvents();
        U.toast.ok('已发布 ' + r.ver.no + '（变更 ' + r.count + ' 项），次日 06:00 生效 · 已写入审计日志');
      }
    });
  }

  function renderConfig() {
    renderRules();
    renderTrend();
    renderParams();
    renderRoutes();
    renderDq();
    renderDesens();
    gkpi();
    renderDraftBar();
  }

  /* ============================================================
     六、审计日志（明细 / 完整性 / 安全事件）
     ============================================================ */
  const NOW_DATE = '2026-11-10';
  const HIST = [
    ['2026-11-10', '10:35:07', '王海峰', '五级 · 属地经办', '越权访问', '访问非本辖区档案（溪翁庄镇 3 份）· 策略拦截并告警', '10.20.44.19', '拦截'],
    ['2026-11-10', '09:52:14', '陈志远', '二级 · 政法委主管', '导出', '重点时期名单 37 人 · 脱敏 · 流水 EXP-20261110-0028', '10.20.31.45', '成功'],
    ['2026-11-10', '09:48:02', '王振国', '六级 · 属地负责人', '登记走访', '任玉荣（MY-2026-000118）· 入户走访', '10.20.44.12', '成功'],
    ['2026-11-10', '09:12:33', '郭立新', '八级 · 安全管理员', '权限分配', '角色「部门经办」新增 执行导入 · 变更单 AUTH-0091', '10.20.30.8', '成功'],
    ['2026-11-10', '09:05:41', '李强', '四级 · 部门经办', '查询', '涉访关注人员 128 条 · 条件：涉访 B 类 + 高风险', '10.20.41.66', '成功'],
    ['2026-11-10', '08:58:20', '李强', '四级 · 部门经办', '越权尝试', '请求卫健来源人员档案 · 无数据范围权限', '10.20.41.66', '拒绝'],
    ['2026-11-10', '08:52:10', '陈志远', '二级 · 政法委主管', '登录', '政务通双因子 · 内网 10.20.31.45', '10.20.31.45', '成功'],
    ['2026-11-10', '08:34:55', '杨帆', '九级 · 安全审计员', '日志导出', '2026-11-09 全量审计日志 · 1,714 条', '10.20.30.22', '成功'],
    ['2026-11-10', '08:20:12', '周敏', '三级 · 部门科长', '登记等级变动', '刘长江（MY-2026-000588）· 中风险 → 低风险 · 部门主管核定', '10.20.42.30', '成功'],
    ['2026-11-10', '07:42:30', '王振国', '六级 · 属地负责人', '零报告', '鼓楼街道 · 应见 68 / 已见 61 / 未报告 7', '10.20.44.12', '成功'],
    ['2026-11-10', '07:18:44', '张海涛', '五级 · 属地经办', '明文查看', '任玉荣 身份证号 · 审批单 MY-AP-2026-0871 · 有效期 24 小时', '10.20.44.88', '已授权'],
    ['2026-11-10', '06:00:02', '系统', '定时任务', '规则扫描', '十三类规则 · 扫描 6,028 人 · 新生成预警 4 条', '本机', '成功'],
    ['2026-11-10', '02:00:00', '系统', '定时任务', '备份', '全量备份 · 1.8 GB · 保留 30 天 · 校验通过', '本机', '成功'],
    ['2026-11-09', '17:22:05', '周敏', '三级 · 部门科长', '查询', '本部门涉访人员 214 条 · 导出受限', '10.20.42.30', '成功'],
    ['2026-11-09', '15:08:41', '孙敏', '三级 · 部门科长', '登记走访', '马春霞（MY-2026-000204）· 联合面访 · 精防医生同行', '10.20.33.18', '成功']
  ];
  /* 操作类型分桶：store 里每一个 audit() 的动作名都必须能落到某个桶，
     否则「操作类型」筛选一选就会把该记录丢掉（历史 bug） */
  const OP_MAP = {
    '查询': 'query', '查阅': 'query',
    '导出': 'export', '日志导出': 'export', '导出台账': 'export', '生成权限清单': 'export',
    '数据导入': 'import',
    '明文查看': 'approve', '零报告': 'approve', '提交零报告': 'approve',
    '撤回零报告': 'approve', '人工复核': 'approve', '双人复核': 'approve',
    '等级变更': 'approve', '登记等级变动': 'approve', '变动知会属地': 'approve',
    '追加标签': 'approve', '批量打标': 'approve',
    '预警处置': 'approve', '处置安全事件': 'approve',
    '盲区补评': 'approve', '申请查看明文': 'approve',
    '登记走访': 'visit', '走访登记': 'visit', '回填见面情况': 'visit',
    '越权访问': 'deny', '越权尝试': 'deny',
    '登录': 'login',
    '规则扫描': 'rule', '备份': 'rule', '权限分配': 'rule', '推送告警': 'rule', '规则命中': 'rule',
    '自动冻结': 'rule', '到期回收': 'rule', '推送通知': 'rule',
    '修改阈值参数': 'rule', '修改时期参数': 'rule', '修改规则阈值': 'rule',
    '修改预警规则': 'rule', '启停预警规则': 'rule', '新增预警规则': 'rule',
    '修改数据质量规则': 'rule', '新增数据质量规则': 'rule',
    '调整角色权限': 'rule', '重置角色权限': 'rule', '调整字段密级': 'rule', '调整脱敏策略': 'rule',
    '发布系统配置': 'publish', '保存配置草稿': 'publish', '放弃配置草稿': 'publish',
    '新建账号': 'account', '新增账号': 'account', '编辑账号': 'account', '激活账号': 'account', '维护责任人': 'account',
    '修改字典项': 'dict', '新增字典项': 'dict', '调整字典排序': 'dict',
    '并档合并': 'other', '推送属地书记': 'other'
  };
  const OP_LABEL = {
    query: '查询 / 查阅', export: '导出', import: '导入', approve: '安全审批 / 处置 / 变更', visit: '走访 / 见面',
    deny: '越权拦截', login: '登录', rule: '规则与权限', publish: '配置发布', account: '账号管理',
    dict: '字典维护', other: '其他'
  };
  const OP_CLS = {
    '查询': 'op-q', '查阅': 'op-q', '规则扫描': 'op-q', '备份': 'op-q',
    '导出': 'op-e', '日志导出': 'op-e', '明文查看': 'op-v', '登录': 'op-v',
    '登记走访': 'op-s', '权限分配': 'op-a', '登记等级变动': 'op-a', '零报告': 'op-s',
    '越权访问': 'op-d', '越权尝试': 'op-d', '规则命中': 'op-a', '自动冻结': 'op-d',
    '到期回收': 'op-q', '人工复核': 'op-a', '推送告警': 'op-a', '推送通知': 'op-a',
    '数据导入': 'op-e', '导出台账': 'op-e', '预警处置': 'op-s', '预警转派': 'op-a',
    '变动知会属地': 'op-a', '双人复核': 'op-a', '追加标签': 'op-a', '等级变更': 'op-a', '走访登记': 'op-s',
    '申请查看明文': 'op-v', '修改规则阈值': 'op-a', '启停预警规则': 'op-a', '新增预警规则': 'op-a',
    '激活账号': 'op-a', '编辑账号': 'op-a', '新建账号': 'op-a', '调整角色权限': 'op-a',
    '调整字段密级': 'op-a', '调整脱敏策略': 'op-a', '修改阈值参数': 'op-a', '修改预警规则': 'op-a',
    '新增数据质量规则': 'op-a', '修改数据质量规则': 'op-a', '修改字典项': 'op-a', '新增字典项': 'op-a',
    '调整字典排序': 'op-a', '生成权限清单': 'op-e', '发布系统配置': 'op-a', '处置安全事件': 'op-a',
    '新增账号': 'op-a', '重置角色权限': 'op-a', '放弃配置草稿': 'op-d', '维护责任人': 'op-a',
    '回填见面情况': 'op-s', '提交零报告': 'op-s', '撤回零报告': 'op-d', '修改时期参数': 'op-a',
    '保存配置草稿': 'op-a', '批量打标': 'op-a', '盲区补评': 'op-a', '并档合并': 'op-a', '推送属地书记': 'op-a'
  };
  function resCls(res) {
    if (res === '拦截' || res === '拒绝') return 'tag-red';
    if (res === '已授权' || res === '受限' || res === '待观察') return 'tag-amber';
    return 'tag-green';
  }

  function auditRows() {
    const out = [];
    /* 1) 本次会话流水（真实操作） */
    S.auditOf(80).forEach(r => {
      const t = String(r.at || '');
      out.push({
        date: t.slice(0, 10), time: t.slice(11), who: r.by, role: r.role || '',
        act: r.act, op: r.act, target: (r.detail || '') + (r.target ? ' · ' + r.target : ''),
        ip: '10.20.31.45', res: '成功', live: true
      });
    });
    /* 2) 安全事件链路（与安全事件卡逐节点对账） */
    S.events().forEach(e => {
      e.chain.forEach(c => {
        out.push({
          date: '2026-' + c.at.slice(0, 5), time: c.at.slice(6),
          who: e.name, role: (D.SYS_ROLE_OF[e.role] || {}).name || e.role,
          act: c.act, op: c.act, target: c.text, ip: '10.20.44.19',
          res: c.result === '拒绝' ? '拒绝' : (c.result === '拦截' ? '拦截' : (c.result === '待观察' || c.result === '受限' ? '已授权' : '成功')),
          event: e.id
        });
      });
    });
    /* 3) 历史基线 */
    HIST.forEach(h => {
      out.push({ date: h[0], time: h[1], who: h[2], role: h[3], act: h[4], op: h[4], target: h[5], ip: h[6], res: h[7] });
    });
    /* 按时间降序（同刻保持插入序：本次会话在前） */
    out.sort((a, b) => (b.date + ' ' + b.time).localeCompare(a.date + ' ' + a.time));
    return out;
  }

  function auditFiltered() {
    const R = P.auditRange;
    return auditRows().filter(r => {
      if (R.start && r.date < R.start) return false;
      if (R.end && r.date > R.end) return false;
      if (P.auditOp && (OP_MAP[r.op] || 'other') !== P.auditOp) return false;
      if (P.auditRes) {
        const k = r.res === '拦截' ? 'block' : (r.res === '拒绝' ? 'deny' : 'ok');
        if (k !== P.auditRes) return false;
      }
      return true;
    });
  }

  function renderAuditLogs() {
    const tb = $('#auditBody');
    if (!tb) return;
    const list = auditFiltered();
    tb.innerHTML = list.slice(0, 60).map(r => `<tr class="${r.live ? 'live-row' : ''}" data-date="${r.date}" data-op="${OP_MAP[r.op] || 'other'}" data-res="${r.res}">
      <td class="tm">${esc(r.time)}<span class="cell-sub">${esc(r.date.slice(5))}</span></td>
      <td>${esc(r.who)}<span class="cell-sub">${esc(r.role)}</span></td>
      <td><span class="op ${OP_CLS[r.act] || 'op-q'}">${esc(r.act)}</span>${r.event ? '<span class="cell-sub">安全事件</span>' : (r.live ? '<span class="cell-sub">本次会话</span>' : '')}</td>
      <td>${esc(r.target)}</td>
      <td class="mono tiny">${esc(r.ip)}</td>
      <td><span class="tag ${resCls(r.res)}">${esc(r.res)}</span></td>
    </tr>`).join('');
    const hint = $('#auditFilterHint');
    if (hint) hint.textContent = '命中 ' + list.length + ' 条';
    const total = 1842 + list.length;
    $('#auditToday').textContent = fmt(total);
    $('#auditLiveNum').textContent = S.auditOf(80).length;
    $('#auditLiveTag').textContent = '本次会话 ' + S.auditOf(80).length + ' 条';
    $('#auditPagerText').textContent = '共 ' + fmt(total) + ' 条 · 第 1/' + Math.max(1, Math.ceil(total / 20)) + ' 页';
    const deny = S.events().filter(e => e.kind === '越权访问').reduce((a, e) => a + e.count, 0);
    $('#kpiDeny').innerHTML = deny + '<span class="unit">次</span>';
    $('#kpiDenyMeta').textContent = '已拦截 · ' + S.events().filter(e => e.kind === '越权访问').length + ' 个账号告警';
  }

  function initAuditFilters() {
    const timeNode = $('#fAuditTime');
    const opNode = $('#fAuditOp');
    const resNode = $('#fAuditRes');
    if (!timeNode || !opNode) return;

    /* 自绘日历浮层（元素在正文中重建，逻辑与原原型一致） */
    if (!$('#datePop')) {
      const pop = document.createElement('div');
      pop.className = 'date-pop';
      pop.id = 'datePop';
      pop.innerHTML = `
        <div class="dp-hd">
          <button class="dp-nav" id="dpPrev" type="button" aria-label="上个月">‹</button>
          <b id="dpTitle">2026 年 11 月</b>
          <button class="dp-nav" id="dpNext" type="button" aria-label="下个月">›</button>
        </div>
        <div class="dp-grid" id="dpGrid"></div>
        <div class="dp-quick" id="dpQuick">
          <button type="button" data-q="today">今日</button>
          <button type="button" data-q="7d">近 7 天</button>
          <button type="button" data-q="30d">近 30 天</button>
          <button type="button" data-q="month">本月</button>
          <button type="button" data-q="all">全部时间</button>
        </div>
        <div class="dp-ft">
          <span class="rng" id="dpRange">请选择起始日</span>
          <button class="btn btn-sm btn-ghost" id="dpClear" type="button">清除</button>
          <button class="btn btn-sm btn-primary" id="dpApply" type="button">应用</button>
        </div>`;
      document.body.appendChild(pop);
    }
    const pop = $('#datePop'), grid = $('#dpGrid'), title = $('#dpTitle'), rngEl = $('#dpRange');
    const DP = { start: '', end: '', picking: 'start', y: 2026, m: 10 };
    const parseISO = s => { const a = s.split('-').map(Number); return new Date(a[0], a[1] - 1, a[2]); };
    const p2 = v => String(v).padStart(2, '0');
    const fmtISO = d => d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate());
    const TODAY = new Date(2026, 10, 10);
    const addDays = (d, n) => { const x = new Date(d.getTime()); x.setDate(x.getDate() + n); return x; };

    function paint() {
      title.textContent = DP.y + ' 年 ' + (DP.m + 1) + ' 月';
      const first = new Date(DP.y, DP.m, 1);
      const lead = (first.getDay() + 6) % 7;
      const days = new Date(DP.y, DP.m + 1, 0).getDate();
      let html = ['一', '二', '三', '四', '五', '六', '日'].map(w => '<div class="dw">' + w + '</div>').join('');
      for (let i = 0; i < lead; i++) html += '<div></div>';
      for (let d = 1; d <= days; d++) {
        const iso = fmtISO(new Date(DP.y, DP.m, d));
        let cls = 'dd';
        if (iso === DP.start || iso === DP.end) cls += ' edge';
        else if (DP.start && DP.end && iso > DP.start && iso < DP.end) cls += ' in';
        html += '<div class="' + cls + '" data-d="' + iso + '">' + d + '</div>';
      }
      grid.innerHTML = html;
      rngEl.textContent = DP.start && DP.end ? DP.start + ' ~ ' + DP.end
        : (DP.start ? '起始 ' + DP.start + '，请选择结束日' : '请选择起始日');
    }
    function open() {
      DP.start = P.auditRange.start; DP.end = P.auditRange.end; DP.picking = 'start';
      const anchor = P.auditRange.start ? parseISO(P.auditRange.start) : TODAY;
      DP.y = anchor.getFullYear(); DP.m = anchor.getMonth();
      paint();
      const r = timeNode.getBoundingClientRect();
      pop.style.left = Math.max(8, Math.min(r.left, window.innerWidth - 300)) + 'px';
      pop.style.top = (r.bottom + 6) + 'px';
      pop.classList.add('on');
    }
    function close() { pop.classList.remove('on'); }
    timeNode.style.cursor = 'pointer';
    timeNode.addEventListener('click', e => {
      e.stopPropagation();
      if (pop.classList.contains('on')) close(); else open();
    });
    document.addEventListener('click', e => {
      if (pop.classList.contains('on') && !pop.contains(e.target) && e.target !== timeNode) close();
    });
    grid.addEventListener('click', e => {
      e.stopPropagation();
      const el = e.target.closest('.dd');
      if (!el) return;
      const iso = el.dataset.d;
      if (DP.picking === 'start' || (DP.start && DP.end)) { DP.start = iso; DP.end = ''; DP.picking = 'end'; }
      else if (iso < DP.start) { DP.end = DP.start; DP.start = iso; DP.picking = 'start'; }
      else { DP.end = iso; DP.picking = 'start'; }
      paint();
    });
    $('#dpPrev').onclick = () => { DP.m--; if (DP.m < 0) { DP.m = 11; DP.y--; } paint(); };
    $('#dpNext').onclick = () => { DP.m++; if (DP.m > 11) { DP.m = 0; DP.y++; } paint(); };
    $('#dpQuick').addEventListener('click', e => {
      e.stopPropagation();
      const b = e.target.closest('button');
      if (!b) return;
      const q = b.dataset.q;
      const end = fmtISO(TODAY);
      if (q === 'all') { DP.start = ''; DP.end = ''; }
      else if (q === 'today') { DP.start = end; DP.end = end; }
      else if (q === '7d') { DP.start = fmtISO(addDays(TODAY, -6)); DP.end = end; }
      else if (q === '30d') { DP.start = fmtISO(addDays(TODAY, -29)); DP.end = end; }
      else if (q === 'month') { DP.start = fmtISO(new Date(TODAY.getFullYear(), TODAY.getMonth(), 1)); DP.end = end; }
      DP.picking = 'start';
      paint();
    });
    /* 改文案时保留右侧箭头图标 */
    const setTimeLabel = txt => {
      const icon = timeNode.querySelector('svg');
      timeNode.textContent = txt;
      if (icon) timeNode.appendChild(icon);
    };
    $('#dpApply').onclick = () => {
      if (DP.start && !DP.end) DP.end = DP.start;
      if (DP.start && DP.end && DP.start > DP.end) { U.toast.err('起始日期不能晚于结束日期'); return; }
      P.auditRange = { start: DP.start, end: DP.end };
      setTimeLabel(DP.start ? (DP.start + ' ~ ' + DP.end) : '全部时间');
      renderAuditLogs();
      close();
      U.toast.ok(DP.start ? '已按 ' + DP.start + ' ~ ' + DP.end + ' 过滤' : '已恢复全部时间');
    };
    $('#dpClear').onclick = () => {
      DP.start = ''; DP.end = '';
      P.auditRange = { start: '', end: '' };
      setTimeLabel('全部时间');
      paint(); renderAuditLogs(); close();
    };

    U.select(opNode, {
      items: [{ v: '', t: '全部操作' }].concat(
        Object.keys(OP_LABEL).map(k => ({ v: k, t: OP_LABEL[k] }))
      ),
      value: '', onChange: v => { P.auditOp = v; renderAuditLogs(); }
    });
    U.select(resNode, {
      items: [{ v: '', t: '全部结果' }, { v: 'ok', t: '成功' }, { v: 'block', t: '拦截' }, { v: 'deny', t: '拒绝' }],
      value: '', onChange: v => { P.auditRes = v; renderAuditLogs(); }
    });

    /* 深链：?op=export&res=ok 直接落地筛选（组合查询页「近期导出流水」使用） */
    const qs = new URLSearchParams(location.search);
    const op = qs.get('op'), res = qs.get('res');
    if (op && OP_LABEL[op]) {
      P.auditOp = op;
      U.select(opNode, { items: [{ v: op, t: OP_LABEL[op] }], value: op });
    }
    if (res && ['ok', 'block', 'deny'].indexOf(res) > -1) {
      P.auditRes = res;
      U.select(resNode, { items: [{ v: res, t: { ok: '成功', block: '拦截', deny: '拒绝' }[res] }], value: res });
    }
  }

  /* ---- 日志完整性 ---- */
  function renderHash() {
    const me = S.role();
    const isAuditor = me.roleName.indexOf('审计') > -1;
    const isAdmin = me.roleName.indexOf('政法委') > -1;
    const intro = isAuditor
      ? '每条日志都带前一条的哈希并被下一条引用，形成不可断的链。校验即逐条重算比对，任何改动、删除、插入都会让后续哈希对不上——这是审计结论可被采信的前提。'
      : (isAdmin
        ? '这是「日志防篡改」的自证机制：校验通过即说明追责所依赖的流水未被改动。日常无需操作；季度权限复核或发生争议时，可要求审计员出具校验报告作为附件。'
        : '这是日志防篡改的自证机制，由安全审计员执行校验并出具报告；此处仅展示最近一次校验结论。');
    $('#hashIntro').textContent = intro;
    $('#hashAt').textContent = P.hashAt;
    $('#hashTag').className = 'tag ' + (P.hashOk ? 'tag-green' : 'tag-red');
    $('#hashTag').textContent = P.hashOk ? '校验通过' : '校验异常';
    const parts = ['操作时间', '操作人', '角色', 'IP 地址', '终端', '操作类型', '对象类型', '对象编号', '变更前值', '变更后值', '结果', '追踪号'];
    $('#hashFields').innerHTML = '日志字段（' + parts.length + ' 项）：' + parts.join(' · ');
    const canVerify = S.can('config') || isAuditor;
    $('#btnHashVerify').disabled = !canVerify;
    $('#btnHashReport').disabled = !canVerify;
    if (!canVerify) {
      $('#btnHashVerify').title = '校验动作由安全审计员执行（R9），当前角色仅可查看结论';
      $('#btnHashVerify').style.opacity = '.55';
      $('#btnHashReport').style.opacity = '.55';
    }
  }
  function doHashVerify() {
    const ok = S.can('config') || S.role().roleName.indexOf('审计') > -1;
    if (!ok) { U.toast.err('当前角色「' + S.role().roleName + '」无校验权限 · 校验由安全审计员执行'); return; }
    const btn = $('#btnHashVerify');
    const old = btn.textContent;
    btn.disabled = true;
    btn.textContent = '校验中…';
    setTimeout(() => {
      btn.disabled = false;
      btn.textContent = old;
      const d = new Date();
      const p2 = n => String(n).padStart(2, '0');
      P.hashAt = d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate()) + ' ' + p2(d.getHours()) + ':' + p2(d.getMinutes()) + ':' + p2(d.getSeconds());
      P.hashOk = true;
      P.verified.unshift({ at: P.hashAt, from: '2026-09-01', to: NOW_DATE, total: 1284663, diff: 0, by: S.role().user });
      $('#hashBox').innerHTML = 'c71f0a4b9de80231…4f2a9c6d<br><span class="dim">前序哈希：a3f8c1d9e7b40256…9c4e7a1f</span>';
      S.audit('日志完整性校验', '区间 2026-09-01 ~ ' + NOW_DATE + ' · 1,284,663 条 · 逐条哈希比对 · 差异 0', '审计日志');
      renderHash();
      renderAuditLogs();
      U.toast.ok('校验完成：1,284,663 条逐条比对，差异 0，链完整');
    }, 900);
  }
  function openHashReport() {
    const ok = S.can('config') || S.role().roleName.indexOf('审计') > -1;
    if (!ok) { U.toast.err('当前角色无查看校验报告权限 · 报告由安全审计员出具'); return; }
    const rows = P.verified.length ? P.verified : [{ at: P.hashAt, from: '2026-09-01', to: NOW_DATE, total: 1284663, diff: 0, by: '杨帆' }];
    U.modal({
      title: '日志完整性校验报告',
      sub: '区间 2026-09-01 ~ ' + NOW_DATE + ' · 共 ' + rows.length + ' 次校验',
      width: 600, okText: '导出报告', cancelText: '关闭',
      body: `<div class="kv-row"><span class="muted" style="width:96px">校验方式</span><span>哈希链逐条重算比对（安全散列 256 位）</span></div>
        <div class="kv-row"><span class="muted" style="width:96px">分区范围</span><span>按日分区 71 个 · 归档表 3 个</span></div>
        <div class="kv-row"><span class="muted" style="width:96px">结论</span><span style="color:var(--green);font-weight:600">链完整，无篡改、无缺失、无越序</span></div>
        <div class="divider" style="margin:8px 0"></div>
        <table class="tb compact">
          <thead><tr><th style="width:150px">校验时间</th><th>覆盖区间</th><th style="width:88px" class="r">记录数</th><th style="width:52px" class="r">差异</th><th style="width:64px">执行人</th></tr></thead>
          <tbody>${rows.map(r => `<tr><td class="tm">${esc(r.at)}</td><td class="tiny">${esc(r.from)} ~ ${esc(r.to)}</td>
            <td class="num">${fmt(r.total)}</td><td class="num" style="color:var(--green)">${r.diff}</td><td class="tiny">${esc(r.by)}</td></tr>`).join('')}</tbody>
        </table>
        <div class="tiny dim" style="margin-top:8px">报告可随《权限复核表》一并归档；导出后自动加盖隐式水印，可按文件追溯至人。</div>`,
      onOk: () => {
        U.downloadCSV('日志完整性校验报告_' + NOW_DATE + '.csv', [['校验时间', '覆盖区间', '记录数', '差异', '执行人']]
          .concat(rows.map(r => [r.at, r.from + ' ~ ' + r.to, r.total, r.diff, r.by])));
        S.addExport('日志校验报告', rows.length, '内部导出');
        U.toast.ok('校验报告已导出');
        return true;
      }
    });
  }

  /* ---- 安全事件 ---- */
  function renderEvents() {
    const box = $('#seList');
    if (!box) return;
    const list = S.events();
    const pending = list.filter(e => e.status === '待复核' || e.status === '已提醒').length;
    $('#seTag').innerHTML = pending ? '<span class="tag tag-red">' + pending + ' 条待复核</span>' : '<span class="tag tag-green">全部已闭环</span>';
    box.innerHTML = list.map(e => `<div class="se-item" data-id="${esc(e.id)}">
      <span class="se-lvl ${e.level === 'high' ? '' : (e.level === 'mid' ? 'mid' : 'low')}"></span>
      <div style="flex:1;min-width:0">
        <div class="se-h">
          <b>${esc(e.name)}</b>
          <span class="tiny dim">${esc((D.SYS_ROLE_OF[e.role] || {}).name || e.role)} · ${esc(e.unit)}</span>
          <span class="spacer"></span>
          <span class="tag ${e.kind === '越权访问' ? 'tag-red' : (e.kind === '明文访问' ? 'tag-amber' : 'tag-line')}" style="height:16px;font-size:9px">${esc(e.kind)}</span>
          <span class="tag ${e.status === '待复核' ? 'tag-amber' : (e.status === '已闭环' ? 'tag-green' : 'tag-blue')}" style="height:16px;font-size:9px">${esc(e.status)}</span>
        </div>
        <div class="se-b">${e.count} 次 · 最新 ${esc(e.latest)} · 处置人 ${esc(e.owner)} · 链路 ${e.chain.length} 个节点</div>
      </div>
    </div>`).join('');
    $$('.se-item', box).forEach(el => {
      el.onclick = () => openEvent(el.dataset.id);
    });
  }

  function openEvent(id) {
    const e = S.events().find(x => x.id === id);
    if (!e) return;
    const cls = r => (r === '拒绝' || r === '拦截' ? 'red' : (r === '成功' || r === '已授权' || r === '已闭环' ? 'green' : ''));
    U.modal({
      title: e.name + ' · ' + e.kind,
      sub: (D.SYS_ROLE_OF[e.role] || {}).name + ' · ' + e.unit + ' · 共 ' + e.count + ' 次 · ' + e.status,
      width: 580, okText: e.status === '已闭环' ? null : '标记已复核', cancelText: '关闭',
      body: `<div class="se-tl">${e.chain.map(c => `<div class="n ${cls(c.result)}">
          <span class="t">${esc(c.at)}</span><b>${esc(c.act)}</b>
          <div style="color:var(--t2);font-size:11px;margin-top:1px">${esc(c.text)}
            <span class="tag ${cls(c.result) === 'red' ? 'tag-red' : (cls(c.result) === 'green' ? 'tag-green' : 'tag-amber')}" style="height:15px;font-size:9px;margin-left:4px">${esc(c.result)}</span>
          </div>
        </div>`).join('')}</div>
        <div class="tiny dim" style="margin-top:8px;line-height:1.5">
          该链路已同步写入「日志明细」（标记为安全事件），并与预警待办中的「${esc(e.kind === '越权访问' ? '越权访问尝试' : (e.kind === '明文访问' ? '明文访问' : '账号长期未用'))}」待办一一对应。</div>`,
      onOk: () => {
        S.setEventStatus(id, { status: '已闭环' });
        renderEvents();
        renderAuditLogs();
        U.toast.ok(e.name + ' · ' + e.kind + ' 已标记为复核闭环，处理记录写入审计');
        return true;
      }
    });
  }

  /* ============================================================
     七、顶部动作组 + 初始化
     ============================================================ */
  function bindTopActs() {
    const bind = (id, fn) => { const el = $('#' + id); if (el) el.onclick = fn; };
    bind('btnPermExport', openPermList);
    bind('btnPermList', openPermList);   /* 三员卡底部固定按钮 */
    bind('btnRoleTmpl', openRoleTmpl);
    bind('btnAcctNew', openAcctNew);
    bind('btnDictExport', exportDictPack);
    bind('btnDictAdd', openDictAdd);
    bind('btnDraft', openDraft);
    bind('btnPublish', openPublish);
    bind('draftView', e => { if (e) e.preventDefault(); openDraft(); });
    bind('draftDrop', e => { if (e) e.preventDefault(); dropDraft(); });
    bind('btnFullVerify', doHashVerify);
    bind('btnLogExport', () => {
      const list = auditFiltered();
      const rows = [['时间', '操作人', '角色', '操作类型', '操作对象', '终端 / IP', '结果']]
        .concat(list.map(r => [r.date + ' ' + r.time, r.who, r.role, r.act, r.target, r.ip, r.res]));
      U.downloadCSV('审计日志_' + NOW_DATE + '.csv', rows);
      S.addExport('审计日志', list.length, '脱敏导出');
      U.toast.ok('已导出 ' + list.length + ' 条日志（含本次会话流水）');
    });
    bind('btnAuditReport', () => {
      const list = auditFiltered();
      const ev = S.events();
      U.modal({
        title: '审计报告 · ' + NOW_DATE,
        sub: '自动汇总当日流水、安全事件与完整性结论',
        width: 620, okText: '导出报告', cancelText: '关闭',
        body: `<div class="kv-row"><span class="muted" style="width:96px">统计区间</span><span>${NOW_DATE} 00:00 ~ 24:00</span></div>
          <div class="kv-row"><span class="muted" style="width:96px">日志条数</span><span class="num">${fmt(1842 + list.length)} 条（本次筛选 ${list.length} 条）</span></div>
          <div class="kv-row"><span class="muted" style="width:96px">越权拦截</span><span>${ev.filter(e => e.kind === '越权访问').reduce((a, e) => a + e.count, 0)} 次 · ${ev.filter(e => e.kind === '越权访问').length} 个账号</span></div>
          <div class="kv-row"><span class="muted" style="width:96px">明文访问</span><span>128 次 · 100% 附审批单</span></div>
          <div class="kv-row"><span class="muted" style="width:96px">完整性</span><span style="color:var(--green);font-weight:600">校验通过（差异 0）</span></div>
          <div class="divider" style="margin:8px 0"></div>
          <div class="sect-title" style="margin-bottom:4px">安全事件（${ev.length} 条）</div>
          ${ev.map(e => `<div class="li" style="padding:4px 0"><span class="tag ${e.level === 'high' ? 'tag-red' : 'tag-amber'}" style="height:16px;font-size:9px">${esc(e.kind)}</span>
            <span style="flex:1;font-size:11.5px">${esc(e.name)}（${esc((D.SYS_ROLE_OF[e.role] || {}).name || e.role)}）· ${e.count} 次 · ${esc(e.status)}</span></div>`).join('')}
          <div class="tiny dim" style="margin-top:8px">报告含隐式水印，导出后可按文件追溯至账号。</div>`,
        onOk: () => {
          const rows = [['项目', '内容'], ['统计区间', NOW_DATE], ['日志条数', 1842 + list.length], ['越权拦截次数', ev.filter(e => e.kind === '越权访问').reduce((a, e) => a + e.count, 0)], ['完整性结论', '校验通过，差异 0'], ['安全事件条数', ev.length]];
          ev.forEach(e => rows.push(['安全事件', e.id + ' ' + e.name + ' · ' + e.kind + ' · ' + e.count + ' 次 · ' + e.status]));
          U.downloadCSV('审计报告_' + NOW_DATE + '.csv', rows);
          S.addExport('审计报告', 1, '内部导出');
          U.toast.ok('审计报告已导出');
          return true;
        }
      });
    });
    bind('btnRuleAdd', openRuleAdd);
    bind('btnDqAdd', openDqAdd);
    bind('btnRuleExpand', openRuleExpand);
    bind('btnDqExpand', openDqExpand);
    bind('btnGeoImport', openGeoImport);
    bind('btnHashVerify', doHashVerify);
    bind('btnHashReport', openHashReport);
  }

  /* ---- 启动 ---- */
  renderRoles();
  renderRoleDetail();
  renderTrio();
  renderDictNav();
  renderDict();
  renderMapTable();
  renderGeo();
  renderConfig();
  renderAuditLogs();
  initAuditFilters();
  renderHash();
  renderEvents();
  bindTopActs();

  /* 任意写操作后：草稿条、三员结论、完整性结论同步刷新；当前可见页签整体重绘
     （保证「改完就切过去能看到」——审计日志、规则、字典、账号都走这条链路） */
  if (S.on) S.on(() => { renderTrio(); renderHash(); renderDraftBar(); refreshVisiblePanel(); });

})();
