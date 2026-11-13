/* ============================================================
   Shell · 侧栏导航 + 顶栏（全站统一注入）
   用法：<body data-page="dashboard" data-crumb="态势总览"> ... </body>
   依赖：assets/data.js → store.js → fileparse.js → ui.js → shell.js
   ============================================================ */
(function () {
  const I = {
    shield: '<path d="M12 3l7 3v6c0 4.2-2.9 7.6-7 9-4.1-1.4-7-4.8-7-9V6l7-3z"/><path d="M9.2 11.8l2.1 2.1 3.6-3.9"/>',
    dashboard: '<rect x="3" y="3" width="7.5" height="7.5" rx="2"/><rect x="13.5" y="3" width="7.5" height="7.5" rx="2"/><rect x="3" y="13.5" width="7.5" height="7.5" rx="2"/><rect x="13.5" y="13.5" width="7.5" height="7.5" rx="2"/>',
    screen: '<rect x="2.5" y="4" width="19" height="13" rx="2.5"/><path d="M9 20.5h6M12 17v3.5"/>',
    users: '<circle cx="9" cy="8" r="3.2"/><path d="M3 20c0-3.3 2.7-5.6 6-5.6s6 2.3 6 5.6"/><path d="M16 4.6a3 3 0 010 5.8M17.6 14.8c2 .7 3.4 2.4 3.4 4.6"/>',
    file: '<path d="M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8l-5-5z"/><path d="M14 3v5h5M9 13h6M9 17h4"/>',
    upload: '<path d="M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5"/><path d="M4 15v3a2 2 0 002 2h12a2 2 0 002-2v-3"/>',
    bell: '<path d="M18 9a6 6 0 10-12 0c0 5-2 6-2 6h16s-2-1-2-6z"/><path d="M10.5 19.5a2 2 0 003 0"/>',
    approve: '<path d="M4 12.5l4.5 4.5L20 6"/><path d="M3 20h18" opacity=".35"/>',
    shield2: '<path d="M12 3l7 3v6c0 4.2-2.9 7.6-7 9-4.1-1.4-7-4.8-7-9V6l7-3z"/>',
    search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5L21 21"/>',
    chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2" opacity=".9"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.6 1.6 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.6 1.6 0 00-2.7 1.1V21a2 2 0 11-4 0v-.1A1.6 1.6 0 007 19.4l-.1.1a2 2 0 11-2.8-2.8l.1-.1A1.6 1.6 0 003 15H3a2 2 0 110-4h.1A1.6 1.6 0 004.6 8.7l-.1-.1a2 2 0 112.8-2.8l.1.1A1.6 1.6 0 0010 4.6V4a2 2 0 114 0v.1A1.6 1.6 0 0016.7 5.6l.1-.1a2 2 0 112.8 2.8l-.1.1A1.6 1.6 0 0021 11h.1a2 2 0 010 4H21z"/>',
    log: '<path d="M4 5h16M4 12h16M4 19h10"/>',
    blind: '<circle cx="12" cy="12" r="8.5"/><path d="M12 3.5v3M12 17.5v3M3.5 12h3M17.5 12h3"/><circle cx="12" cy="12" r="2.6"/>',
    board: '<rect x="3" y="4" width="18" height="16" rx="2.5"/><path d="M3 9h18M9 9v11"/>',
    dict: '<path d="M4 5.5A1.5 1.5 0 015.5 4H11v16H5.5A1.5 1.5 0 014 18.5v-13z"/><path d="M11 4h7.5A1.5 1.5 0 0120 5.5v13a1.5 1.5 0 01-1.5 1.5H11"/><path d="M14.5 9.5h2.5M14.5 13h2.5"/>',
    slider: '<path d="M4 7h9M17 7h3M4 12h3M11 12h9M4 17h9M17 17h3"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="15" cy="17" r="2"/>',
    chevron: '<path d="M6 9l6 6 6-6"/>',
    enter: '<path d="M9 5l7 7-7 7"/>',
    lock: '<rect x="4.5" y="10.5" width="15" height="10" rx="2.5"/><path d="M8 10.5V7a4 4 0 118 0v3.5"/>',
    help: '<circle cx="12" cy="12" r="9"/><path d="M9.6 9.4a2.5 2.5 0 113.2 2.9c-.6.2-.8.7-.8 1.4"/><circle cx="12" cy="17" r=".9" fill="currentColor" stroke="none"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7.5V12l3 2"/>',
    swap: '<path d="M4 8h13l-3-3M20 16H7l3 3"/>'
  };
  const svg = (n, cls) => `<svg class="${cls || ''}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${I[n] || ''}</svg>`;

  const ROLE = window.STORE ? STORE.role() : (window.DATA ? DATA.ROLES.admin : null);
  /* 导航项可带 perm：对应角色 can[perm] 为真才显示。
     三员分立下「数据导入」需 import 权限、「系统管理」需 config 权限、
     「调整审批」需 approve 权限——区领导 / 公安经办无审批权，
     对应侧栏入口直接隐藏，避免进得去却处处被拦。 */
  const NAV = [
    { label: '态势总览', items: [
      { id: 'dashboard', t: '态势驾驶舱', i: 'dashboard', href: 'dashboard.html' },
      { id: 'board', t: '数据看板', i: 'board', href: 'board.html', isNew: true },
      { id: 'bigscreen', t: '大屏模式', i: 'screen', href: 'bigscreen.html', ext: true }
    ]},
    { label: '台账管理', items: [
      { id: 'persons', t: '人员台账', i: 'users', href: 'persons.html' },
      { id: 'person', t: '一人一档', i: 'file', href: 'person.html' },
      { id: 'import', t: '数据导入', i: 'upload', href: 'import.html', perm: 'import' }
    ]},
    { label: '风险与预警', items: [
      { id: 'alerts', t: '预警待办', i: 'bell', href: 'alerts.html', badge: window.STORE ? STORE.alertStats().open : 18 },
      { id: 'blind', t: '盲区人群', i: 'blind', href: 'blind.html', badge: 3 },
      { id: 'risk', t: '调整审批', i: 'approve', href: 'risk.html', perm: 'approve', badge: window.STORE ? STORE.approvalStats().pending : 5 },
      { id: 'wartime', t: '重点时期管控', i: 'shield2', href: 'wartime.html' }
    ]},
    { label: '查询统计', items: [
      { id: 'query', t: '组合查询', i: 'search', href: 'persons.html?tab=query' },
      { id: 'analytics', t: '统计分析', i: 'chart', href: 'analytics.html' }
    ]},
    { label: '系统管理', items: [
      { id: 'system', t: '系统管理', i: 'settings', href: 'system.html', perm: 'config' }
    ]}
  ];
  const canSee = it => !it.perm || (window.STORE ? STORE.can(it.perm) : true);
  const NAV_VISIBLE = NAV
    .map(g => Object.assign({}, g, { items: g.items.filter(canSee) }))
    .filter(g => g.items.length);

  const page = document.body.dataset.page || '';
  const crumb = document.body.dataset.crumb || '';
  const title = document.body.dataset.title || '';
  /* 组合查询为「人员台账」内的二级面板，按 ?tab=query 高亮导航 */
  const tabQ = (new URLSearchParams(location.search).get('tab') || '').toLowerCase();
  const activeKey = (page === 'persons' && tabQ === 'query') ? 'query' : page;
  const titleShown = (activeKey === 'query') ? '组合查询' : title;
  const crumbShown = (activeKey === 'query') ? '台账管理' : crumb;
  /* 二级横向导航：所在分组（一级）+ 当前页面（二级），分组可回到组内首屏 */
  const navGroup = NAV.find(g => g.label === crumbShown);
  const grpHref = navGroup ? ((navGroup.items.find(x => !x.ext) || navGroup.items[0]).href) : '';

  /* ---- 侧栏 ---- */
  const sidebar = document.getElementById('sidebar');
  if (sidebar) {
    sidebar.innerHTML = `
      <div class="brand">
        <div class="brand-mark">${svg('shield')}</div>
        <div class="brand-txt">
          <b>重点风险人员台账</b>
          <span>密云区委政法委 · 管理与预警</span>
        </div>
      </div>
      <nav class="nav">
        ${NAV_VISIBLE.map(g => `
          <div class="nav-group">
            <div class="nav-label">${g.label}</div>
            ${g.items.map(it => `
              <a class="nav-item ${it.id === activeKey ? 'active' : ''}" href="${it.href}" ${it.ext ? 'target="_blank"' : ''}>
                ${svg(it.i)}<span>${it.t}</span>
                ${it.isNew ? '<span class="nnew">新</span>' : ''}
                ${it.badge ? `<span class="nbadge">${it.badge}</span>` : ''}
              </a>`).join('')}
          </div>`).join('')}
      </nav>
      <div class="nav-foot">
        <div class="nf-user">
          <a class="nu-me" href="javascript:;" id="nuMe" title="切换演示角色">
            <span class="avatar">${ROLE ? ROLE.avatar : '陈'}</span>
            <span class="nu-box"><b>${ROLE ? ROLE.user : '陈志远'}</b><i>${ROLE ? ROLE.title : '政法委主管 · 全区'}</i></span>
          </a>
          <span class="nu-acts">
            <a class="nu-ic" href="alerts.html" title="通知中心 · ${window.STORE ? STORE.alertStats().open : 3} 条未读">
              ${svg('bell')}<i class="nu-dot">${window.STORE ? STORE.alertStats().open : 3}</i>
            </a>
            <a class="nu-ic" href="javascript:;" id="nuHelp" title="帮助与口径说明">${svg('help')}</a>
          </span>
        </div>
        <div class="sec-flag"><i></i> 等保三级 · 数据不出域</div>
        <div class="ver-line"><span>内网 第 1.0.0 版</span><span>演示数据</span></div>
      </div>`;
  }

  /* ---- 顶栏：左侧二级横向导航 → 搜索 → 右侧演示标识与页内按钮 ---- */
  const topbar = document.getElementById('topbar');
  if (topbar) {
    const showGrp = crumbShown && crumbShown !== titleShown;
    const subnav = (crumbShown || titleShown) ? `
      <nav class="tb-nav" aria-label="当前位置">
        ${showGrp
          ? (grpHref ? `<a class="tn-grp" href="${grpHref}">${crumbShown}</a>` : `<span class="tn-grp">${crumbShown}</span>`)
            + '<span class="tn-sep">/</span>'
          : ''}
        <span class="tn-on">${titleShown}</span>
      </nav>` : '';

    topbar.innerHTML = `
      ${subnav}
      <div class="top-search" id="tbSearch">${svg('search')}<input id="tbSearchInput" placeholder="搜索姓名 / 身份证后四位" autocomplete="off" spellcheck="false"><kbd>/</kbd></div>
      <a class="tag tag-blue" id="tbImp" href="persons.html?quick=imported" hidden style="cursor:pointer;text-decoration:none" title="本次会话导入的人员已并入台账，点击查看"></a>
      <div class="top-acts" id="topActs"></div>`;
  }

  /* ---- 页头操作按钮 → 顶栏；页头标题 / 说明移除 ---- */
  const topActs = document.getElementById('topActs');
  document.querySelectorAll('.page-head').forEach(ph => {
    const acts = ph.querySelector('.page-actions');
    if (acts && topActs) {
      const set = document.createElement('div');
      set.className = 'ta-set';
      set.dataset.set = ph.dataset.topact || 'main';
      while (acts.firstChild) set.appendChild(acts.firstChild);
      topActs.appendChild(set);
    }
    ph.remove();
  });

  // key: 需要显示的按钮组；不传 = 显示默认（main）组
  window.showTopActs = function (key) {
    if (!topActs) return;
    const sets = topActs.querySelectorAll('.ta-set');
    let on = false;
    sets.forEach(s => {
      const hit = (key == null) ? s.dataset.set === 'main' : s.dataset.set === key;
      s.classList.toggle('on', hit);
      if (hit) on = true;
    });
    topActs.classList.toggle('has', on);
  };
  window.showTopActs(null);

  /* ============================================================
     交互补全
     ============================================================ */

  /* ---- 顶栏搜索：真实检索 486 条台账（按角色掩码） ---- */
  const searchIn = document.getElementById('tbSearchInput');
  const searchBox = document.getElementById('tbSearch');
  if (searchIn && searchBox && window.DATA) {
    const pop = document.createElement('div');
    pop.className = 'ui-pop';
    pop.style.display = 'none';
    pop.style.minWidth = '308px';
    document.body.appendChild(pop);
    let list = [], cur = -1;

    function close() { pop.style.display = 'none'; cur = -1; }
    function run() {
      const q = searchIn.value.trim();
      if (!q) { close(); return; }
      const scoped = STORE ? STORE.scopedRole ? STORE.scopedRole() : DATA.scoped(STORE.role().key, DATA.persons) : DATA.persons;
      list = scoped.filter(p =>
        p.name.indexOf(q) >= 0 ||
        p.idNo.slice(-4) === q ||
        p.no.toUpperCase().indexOf(q.toUpperCase()) >= 0
      ).slice(0, 8);
      if (!list.length) {
        pop.innerHTML = '<div class="op" style="color:var(--t3);cursor:default">未匹配到人员 · 试试姓名或身份证后四位</div>';
      } else {
        pop.innerHTML = list.map((p, i) =>
          `<div class="op" data-i="${i}" style="gap:8px">
             <span style="font-weight:600;min-width:52px">${UI.esc(DATA.field(STORE.role().key, 'name', p).text)}</span>
             <span style="color:var(--t3);font-size:11px">${UI.esc(p.town)}</span>
             <span class="cnt">${UI.esc(p.idNo.slice(-4))} · ${UI.esc(DATA.levelOf(STORE.levelOf(p)).name)}</span>
           </div>`).join('');
      }
      const r = searchBox.getBoundingClientRect();
      pop.style.display = 'block';
      pop.style.left = r.left + 'px';
      pop.style.top = (r.bottom + 5) + 'px';
      pop.onclick = e => {
        const op = e.target.closest('.op');
        if (!op || op.dataset.i == null) return;
        const p = list[Number(op.dataset.i)];
        close();
        location.href = 'person.html?id=' + p.id;
      };
    }
    searchIn.addEventListener('input', run);
    searchIn.addEventListener('focus', () => { if (searchIn.value.trim()) run(); });
    searchIn.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        const p = list[cur >= 0 ? cur : 0];
        if (p) { close(); location.href = 'person.html?id=' + p.id; }
      } else if (e.key === 'Escape') { close(); searchIn.blur(); }
      else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        if (!list.length) return;
        e.preventDefault();
        cur = e.key === 'ArrowDown' ? Math.min(list.length - 1, cur + 1) : Math.max(0, cur - 1);
        pop.querySelectorAll('.op').forEach((n, i) => { n.style.background = i === cur ? 'var(--surface-3)' : ''; });
      }
    });
    document.addEventListener('click', e => { if (!pop.contains(e.target) && !searchBox.contains(e.target)) close(); });
    document.addEventListener('keydown', e => {
      if (e.key === '/' && document.activeElement.tagName !== 'INPUT' && document.activeElement.tagName !== 'TEXTAREA') {
        e.preventDefault(); searchIn.focus();
      }
    });
  }

  /* ---- 角色切换 / 帮助 ---- */
  function roleSwitchDialog() {
    const list = Object.values(DATA.ROLES);
    const cur = STORE.role().key;
    UI.modal({
      title: '切换演示角色',
      sub: '不同岗位的数据范围与字段密级不同，切换后全站立即生效（同一会话内保持）',
      width: 520,
      okText: '以该角色继续',
      body: '<div class="ui-radio" id="roleRadios">' + list.map(r =>
        `<label class="${r.key === cur ? 'on' : ''}" data-k="${r.key}">
           <input type="radio" name="role" ${r.key === cur ? 'checked' : ''} style="margin-top:2px">
           <span style="flex:1"><b>${r.roleName} · ${r.user}</b><br><span>${r.scopeText} · ${r.can.approve ? '可审批' : '不可审批'} · ${r.can.exportPlain ? '可导出明文' : '导出脱敏'}</span></span>
         </label>`).join('') + '</div>',
      onMount: dlg => {
        dlg.querySelectorAll('#roleRadios label').forEach(l => {
          l.onclick = () => {
            dlg.querySelectorAll('#roleRadios label').forEach(x => x.classList.remove('on'));
            l.classList.add('on');
            l.querySelector('input').checked = true;
          };
        });
      },
      onOk: dlg => {
        const on = dlg.querySelector('#roleRadios label.on');
        if (!on) return false;
        const k = on.dataset.k;
        if (k === cur) { UI.toast('仍为当前角色'); return true; }
        STORE.setRole(k);
        UI.toast.ok('已切换为「' + DATA.ROLES[k].roleName + '」，页面即将刷新');
        setTimeout(() => location.reload(), 480);
        return false;
      }
    });
  }

  function helpDialog() {
    const r = STORE.role();
    UI.modal({
      title: '演示说明与口径定义',
      sub: '本系统为演示环境，全部数据为虚拟生成的脱敏数据，不接入任何真实台账',
      width: 560,
      okText: '知道了',
      cancelText: '切换角色',
      body: `
        <div class="sect-title">当前角色</div>
        <div style="margin:4px 0 10px">${UI.roleTip()}</div>
        <div class="sect-title">关键口径</div>
        <table class="tb compact" style="margin-top:4px">
          <tbody>
            <tr><td style="width:104px;color:var(--t2)">在册总数</td><td>${DATA.fmt(DATA.stats.inRegister)} 人 · 台账 7,112 人次（同一人多部门在册只计 1 人）</td></tr>
            <tr><td style="color:var(--t2)">高风险及以上</td><td>${DATA.stats.highPlus} 人 = 极高 ${DATA.stats.high2} + 高 ${DATA.stats.highPlus - DATA.stats.high2}，占在册 ${DATA.stats.percentHigh}%</td></tr>
            <tr><td style="color:var(--t2)">双在册</td><td>同一身份证在两个及以上部门台账在册，${DATA.stats.dual} 人</td></tr>
            <tr><td style="color:var(--t2)">多重标签</td><td>2 标 ${DATA.stats.multi2} 人 + 3 标 ${DATA.stats.multi3} 人 = ${DATA.stats.multi} 人</td></tr>
            <tr><td style="color:var(--t2)">待核实</td><td>已建档未定级或依据缺失，${DATA.fmt(DATA.stats.unknown)} 人，不计入高风险统计</td></tr>
            <tr><td style="color:var(--t2)">走访超期</td><td class="tiny dim">高风险人员连续 30 日无有效走访（电话联系不计入有效走访）</td></tr>
          </tbody>
        </table>
        <div class="sect-title" style="margin-top:12px">快捷操作</div>
        <div class="tiny dim" style="line-height:1.9">
          · 顶栏搜索框输入姓名或身份证后四位，回车直达一人一档（快捷键 <b>/</b>）<br>
          · 侧栏底部头像可随时切换岗位，观察字段掩码与数据范围变化<br>
          · 所有处置、审批、导入、查看明文操作都会写入审计流水（系统管理 → 审计日志）
        </div>`,
      /* 「切换角色」按钮：关闭说明并直接打开角色切换弹窗，避免按钮文案承诺了动作却不响应 */
      onCancel: () => { setTimeout(roleSwitchDialog, 60); }
    });
  }

  const nuMe = document.getElementById('nuMe');
  if (nuMe) nuMe.onclick = e => { e.preventDefault(); roleSwitchDialog(); };
  const nuHelp = document.getElementById('nuHelp');
  if (nuHelp) nuHelp.onclick = e => { e.preventDefault(); helpDialog(); };
  document.querySelectorAll('.ver-line span:last-child').forEach(n => {
    n.style.cursor = 'pointer';
    n.onclick = () => {
      UI.confirm({
        title: '重置演示状态？',
        sub: '会清空本会话内的处置、审批、走访、导入与审计记录，数据恢复初始状态',
        danger: true,
        okText: '重置',
        onOk: () => { STORE.reset(); UI.toast.ok('已重置，正在刷新'); setTimeout(() => location.reload(), 420); }
      });
    };
  });

  /* ---- 权限闸门：页面调用 window.guard('approve', '审批') ----
     文案必须自洽：当前角色本身就具备该权限位时不再提示「切换为…」，
     而是指向授权路径；只有「别的角色有、当前没有」时才给切换建议。 */
  window.guard = function (perm, actionText) {
    if (STORE.can(perm)) return true;
    const cur = STORE.role();
    const act = actionText || '该';
    let tip;
    if ((cur.can || {})[perm] === undefined) {
      /* 权限位根本未定义：属于配置缺失，直接指向系统管理 */
      tip = '无' + act + '权限 · 请到 系统管理 → 账号与角色 确认权限位配置';
    } else if (cur.key === 'admin') {
      tip = '无' + act + '权限 · 请到 系统管理 → 账号与角色 为当前角色授权';
    } else {
      const holder = Object.keys(DATA.ROLES)
        .map(k => DATA.ROLES[k])
        .filter(r => (r.can || {})[perm] && r.key !== cur.key)
        .sort((a, b) => (b.can.approve ? 1 : 0) - (a.can.approve ? 1 : 0))[0];
      tip = holder
        ? '无' + act + '权限 · 请切换为「' + holder.roleName + '」'
        : '无' + act + '权限 · 请到 系统管理 → 账号与角色 申请授权';
    }
    UI.toast.err('当前角色「' + cur.roleName + '」' + tip);
    return false;
  };

  /* ---- 跨页跳转统一带对象参数 ---- */
  window.openPerson = function (id, hash) {
    location.href = 'person.html?id=' + encodeURIComponent(id) + (hash ? '#' + hash : '');
  };

  /* ---- 指标联动：页面里标了 data-metric 的数字统一由 DATA.stats 供给 ----
     用法：<b data-metric="inRegister"></b>、<b data-metric="highPlus" data-unit="人"></b>
     导入 / 审批改级后 DATA.stats 会被重算，所有页面刷新即同步。 */
  window.SYNC_METRICS = function (root) {
    const D = window.DATA;
    if (!D) return;
    const map = {
      inRegister: D.stats.inRegister,
      highPlus: D.stats.highPlus,
      high2: D.stats.high2,
      percentHigh: D.stats.percentHigh,
      imported: window.STORE ? STORE.importedPersons().length : 0
    };
    (root || document).querySelectorAll('[data-metric]').forEach(n => {
      const k = n.dataset.metric;
      if (map[k] == null) return;
      const dec = n.dataset.dec != null ? Number(n.dataset.dec) : 0;
      const v = dec ? Number(map[k]).toFixed(dec) : D.fmt(map[k]);
      if (n.dataset.unit) n.innerHTML = v + '<span class="unit">' + n.dataset.unit + '</span>';
      else n.textContent = v;
    });
    /* 本次导入增量提示：有导入才出现，避免无导入时页面多出空文案 */
    const imp = map.imported;
    (root || document).querySelectorAll('[data-import-note]').forEach(n => {
      if (!imp) { n.hidden = true; n.textContent = ''; return; }
      n.hidden = false;
      n.innerHTML = n.dataset.importNote === 'excl'
        ? '（不含本次导入 <b>+' + imp + '</b> 人）'
        : ' · 含本次导入 <b>+' + imp + '</b> 人（已入台账，分档于次日 06:00 重算）';
    });
    /* 顶栏常驻徽标：.page-head 会被外壳摘除，页面内提示可能不落在可见区，
       故在顶栏固定挂一枚「本次导入 +N 人」，点进即到台账的本次导入视图。 */
    const badge = document.getElementById('tbImp');
    if (badge) {
      if (imp) {
        badge.hidden = false;
        badge.textContent = '本次导入 +' + imp + ' 人';
      } else {
        badge.hidden = true;
        badge.textContent = '';
      }
    }
  };
  window.SYNC_METRICS();
})();

/* 顶栏搜索框样式（沿用 .top-search 容器） */
(function () {
  const s = document.createElement('style');
  s.textContent = `
  .top-search input { border: 0; background: transparent; outline: 0; font: inherit; color: var(--t1); flex: 1 1 auto; min-width: 0; padding: 0; }
  .top-search input::placeholder { color: var(--t3); }
  .top-search:focus-within { background: #fff; border-color: var(--blue-soft-2); box-shadow: 0 0 0 3px rgba(0,113,227,.10); }
  `;
  document.head.appendChild(s);
})();

/* ---------- 按钮级权限门控 ----------
   约定：<button data-perm="approve">…</button>
   无权限时置灰 + title 说明，点击仍走 window.guard 兜底提示。
   之所以不隐藏按钮：三员分立演示需要让使用者看到"有该动作但本岗无权"，
   否则区领导看不到审批按钮，会误以为系统没有审批功能。 */
(function () {
  if (!window.STORE || !window.DATA) return;
  const PERM_TXT = {
    approve: '审批', export: '导出', exportPlain: '明文导出', edit: '处置与登记',
    import: '数据导入', disclosure: '明文查看申请', config: '系统配置变更'
  };
  function lockTip(perm) {
    const cur = STORE.role();
    const holder = Object.keys(DATA.ROLES).map(k => DATA.ROLES[k])
      .filter(r => (r.can || {})[perm] && r.key !== cur.key)
      .sort((a, b) => (b.can.approve ? 1 : 0) - (a.can.approve ? 1 : 0))[0];
    return '「' + cur.roleName + '」无' + (PERM_TXT[perm] || '该') + '权限' +
      (holder ? ' · 由「' + holder.roleName + '」执行' : '');
  }
  window.applyPermGates = function (root) {
    (root || document).querySelectorAll('[data-perm]').forEach(el => {
      const perm = el.dataset.perm;
      if (!perm) return;
      if (el.dataset.permOk === undefined) el.dataset.permOk = el.getAttribute('title') || '';
      const ok = STORE.can(perm);
      el.classList.toggle('is-locked', !ok);
      el.setAttribute('aria-disabled', ok ? 'false' : 'true');
      el.title = ok ? (el.dataset.permOk || '') : lockTip(perm);
      if (!el.dataset.gated) {
        el.dataset.gated = '1';
        /* capture 阶段拦截：早于页面自己绑的 onclick，保证置灰态不会被穿透 */
        el.addEventListener('click', e => {
          if (STORE.can(el.dataset.perm)) return;
          e.preventDefault(); e.stopImmediatePropagation();
          window.guard(el.dataset.perm, PERM_TXT[el.dataset.perm] || '该操作');
        }, true);
      }
    });
  };
  window.applyPermGates();
  /* 动态渲染出来的按钮（列表行、弹窗）也要跟上，用一个轻量 debounce 观察器 */
  let gateTimer = null;
  new MutationObserver(() => {
    if (gateTimer) return;
    gateTimer = setTimeout(() => { gateTimer = null; window.applyPermGates(); }, 60);
  }).observe(document.body, { childList: true, subtree: true });
})();

/* ---------- 页面级权限门：body[data-page-perm] ----------
   侧栏导航已按 can[perm] 过滤入口，但直达 URL（书签 / 手输）仍会进到页面本体。
   命中时把 .content 原内容整体隐藏（不删除，页面脚本照常初始化，避免
   getElementById 报错），插一条无权限占位：说明缺哪项权限、由谁负责，
   并提供「切换角色」与「返回驾驶舱」。覆盖 system（config）与 import（import）。 */
(function () {
  if (!window.STORE || !window.DATA) return;
  const perm = document.body.dataset.pagePerm;
  if (!perm || STORE.can(perm)) return;
  document.body.classList.add('page-denied');
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const PERM_TXT = { approve: '审批', export: '导出', exportPlain: '明文导出', edit: '处置与登记',
    import: '数据导入', disclosure: '明文查看申请', config: '系统配置变更' };
  const label = PERM_TXT[perm] || '该';
  const cur = STORE.role();
  const holder = Object.keys(DATA.ROLES).map(k => DATA.ROLES[k])
    .filter(r => (r.can || {})[perm])
    .sort((a, b) => (b.can.approve ? 1 : 0) - (a.can.approve ? 1 : 0))[0];
  const box = document.createElement('div');
  box.className = 'page-deny';
  box.innerHTML =
    '<div class="pd-ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="4.5" y="10.5" width="15" height="9.5" rx="2.5"/><path d="M8 10.5V7.5a4 4 0 118 0v3"/><path d="M12 14.5v2"/></svg></div>' +
    '<div class="pd-tt">无权访问 · ' + esc(label) + '模块</div>' +
    '<div class="pd-sub">当前角色「' + esc(cur.roleName) + '」（' + esc(cur.user) + '）不具备本页所需的 ' + esc(label) + ' 权限' +
    (holder ? '，该模块由「' + esc(holder.roleName) + '」（' + esc(holder.user) + '）负责' : '') + '。</div>' +
    '<div class="pd-sub dim">三员分立：系统配置由系统管理员执行，审计由审计员执行，业务处置由主管与经办执行。</div>' +
    '<div class="pd-acts"><button class="btn btn-primary" id="pdSwitch">切换角色</button>' +
    '<a class="btn" href="dashboard.html">返回态势驾驶舱</a></div>';
  const content = document.querySelector('.content');
  if (content) {
    content.prepend(box);
    box.querySelector('#pdSwitch').onclick = () => {
      const me = document.getElementById('nuMe');   /* 复用顶栏的角色切换弹窗 */
      if (me) me.click();
    };
  }
})();

/* ---------- 一屏填满模式（body.fit）的自适应开关 ----------
   fit 模式把 .content 锁成 calc(100vh - 顶栏) 且 overflow:hidden，
   好处是大屏一屏看全，坏处是窗口一小就有内容被裁掉且无法滚动。
   这里按视口尺寸自动进出 fit：放得下就用 fit，放不下就退回整页纵向滚动，
   卡片高度回到内容高度，一个字都不会被裁。 */
(function () {
  const body = document.body;
  if (!body.classList.contains('fit')) return;   // 非 fit 页面（统计分析等）本来就会整页滚动
  const MIN_W = 1340, MIN_H = 860;
  let timer = 0;
  function sync() {
    const want = window.innerWidth >= MIN_W && window.innerHeight >= MIN_H;
    if (want === body.classList.contains('fit')) return;
    body.classList.toggle('fit', want);
    /* 布局切换后让页面内的图表 / 表格按新尺寸重算一次 */
    window.dispatchEvent(new Event('resize'));
  }
  window.addEventListener('resize', () => {
    clearTimeout(timer);
    timer = setTimeout(sync, 120);
  });
  sync();
})();
