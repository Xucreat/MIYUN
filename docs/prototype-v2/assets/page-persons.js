/* ============================================================
   page-persons.js · 人员台账（486 条真实分页 · 角色密级 · 导出留痕）
   ------------------------------------------------------------
   数据：DATA.persons（486 条高风险及以上，逐镇街与地图口径一致）
   权限：STORE.role() 决定数据范围（全区 / 仅本部门）与字段明暗
   导出：真实生成 CSV（脱敏 / 明文两条路径），并写入导出流水
   ============================================================ */
(function () {
  'use strict';
  const D = window.DATA;
  const esc = UI.esc;
  const ROLE = () => STORE.role();

  const S = {
    q: '', tag: '', level: '', town: '', dept: '', visit: '', status: '', village: '',
    /* deptTag：按「人员类别归属部门」筛选（可多部门 AND），与主责单位 dept 字段是两套口径：
       dept 取人员表的主责单位单值；deptTag 走 DATA.deptsOf(p)，一人可命中多个部门，
       驾驶舱「部门维度 / 重合矩阵」下钻用这个，命中数与卡片数字严格一致 */
    deptTag: [],
    quick: 'high', page: 1, size: 20, sort: 'level', dir: 1,
    selected: new Set()
  };
  const QUICKS = [
    { k: 'high', t: '高风险及以上' },
    { k: 'high2', t: '极高风险' },
    { k: 'imported', t: '本次导入' },
    { k: 'dual', t: '双在册' },
    { k: 'multi', t: '多重标签' },
    { k: 'nobasis', t: '依据缺失' },
    { k: 'novisit', t: '近 30 日未走访' },
    { k: 'all', t: '全部在册' }
  ];

  const bar = document.getElementById('filterBar');
  const qv = document.getElementById('quickViews');
  const res = document.getElementById('resultBar');
  const body = document.getElementById('listBody');
  const pagerBox = document.getElementById('listPager');

  /* ---------- 数据范围 ---------- */
  function scopedAll() {
    return D.scoped(ROLE().key, D.persons);
  }

  /* ---------- 筛选 ---------- */
  function matchQuick(p) {
    switch (S.quick) {
      /* 高风险及以上：仅含极高 + 高两档；导入进来的中风险 / 待核实人员不混入本口径 */
      case 'high': return D.levelOf(STORE.levelOf(p)).order <= 1;
      case 'high2': return p.level === 'high2';
      case 'imported': return !!p.imported;
      case 'dual': return p.dual;
      case 'multi': return p.multi;
      case 'nobasis': return p.noBasis;
      case 'novisit': return p.visitGap > 30;
      case 'all': return true;
      default: return true;
    }
  }
  function filtered() {
    const q = S.q.trim().toLowerCase();
    return scopedAll().filter(p => {
      if (!matchQuick(p)) return false;
      if (S.tag && p.tags.indexOf(S.tag) < 0) return false;
      if (S.level && STORE.levelOf(p) !== S.level) return false;
      if (S.town && p.town !== S.town) return false;
      if (S.village && p.village !== S.village) return false;
      if (S.dept && p.dept !== S.dept) return false;
      if (S.deptTag.length) {
        const ds = D.deptsOf(p);
        if (!S.deptTag.every(d => ds.indexOf(d) > -1)) return false;   /* 多部门为 AND：同时归属 */
      }
      if (S.visit === '30' && p.visitGap <= 30) return false;
      if (S.visit === '7' && p.visitGap > 7) return false;
      if (S.status === 'new' && p.since < '2025-11') return false;
      if (S.status === 'long' && p.since > '2023-11') return false;
      if (q) {
        if (p.name.toLowerCase().indexOf(q) < 0 && p.idNo.slice(-4) !== q && p.no.toLowerCase().indexOf(q) < 0) return false;
      }
      return true;
    }).sort((a, b) => {
      if (S.sort === 'level') {
        const oa = D.levelOf(STORE.levelOf(a)).order, ob = D.levelOf(STORE.levelOf(b)).order;
        return (oa - ob) * S.dir || a.name.localeCompare(b.name, 'zh-CN');
      }
      if (S.sort === 'visit') return (a.visitGap - b.visitGap) * S.dir;
      if (S.sort === 'name') return a.name.localeCompare(b.name, 'zh-CN') * S.dir;
      if (S.sort === 'town') return a.town.localeCompare(b.town, 'zh-CN') * S.dir;
      if (S.sort === 'no') return a.no.localeCompare(b.no) * S.dir;
      return 0;
    });
  }

  /* ---------- 常用方案（localStorage 持久化：存为常用后出现在台账顶部，刷新后仍在） ---------- */
  const SCHEME_KEY = 'yq.persons.schemes';
  function loadSchemes() {
    try { const a = JSON.parse(localStorage.getItem(SCHEME_KEY) || '[]'); return Array.isArray(a) ? a : []; }
    catch (e) { return []; }
  }
  function persistSchemes(list) {
    try { localStorage.setItem(SCHEME_KEY, JSON.stringify(list)); } catch (e) { /* 隐私模式忽略 */ }
  }
  function snapshotConds() {
    return { q: S.q, tag: S.tag, level: S.level, town: S.town, dept: S.dept, deptTag: S.deptTag.slice(), visit: S.visit, status: S.status, village: S.village, quick: S.quick };
  }
  function renderSchemes() {
    const barEl = document.getElementById('schemeBar');
    if (!barEl) return;
    const list = loadSchemes();
    if (!list.length) { barEl.style.display = 'none'; barEl.innerHTML = ''; return; }
    barEl.style.display = '';
    barEl.innerHTML = '<span class="tiny dim" style="flex:0 0 auto">常用方案</span>' +
      list.map((s, i) => `<span class="scheme-chip" data-si="${i}" title="点击应用该方案">${esc(s.name)} <span class="n">${s.count}</span><b class="del" data-del="${i}" title="删除该方案">×</b></span>`).join('') +
      '<span class="spacer"></span><span class="tiny dim">点击应用 · 存于本机（刷新/重开仍在）</span>';
    barEl.querySelectorAll('.scheme-chip').forEach(chip => {
      chip.onclick = e => {
        if (e.target && e.target.dataset && e.target.dataset.del != null) return;
        const s = loadSchemes()[+chip.dataset.si];
        if (!s) return;
        Object.keys(s.conds || {}).forEach(k => { S[k] = s.conds[k]; });
        S.page = 1; S.selected.clear();
        renderAll();
        UI.toast.ok('已应用方案「' + s.name + '」');
      };
      const del = chip.querySelector('.del');
      if (del) del.onclick = e => {
        e.stopPropagation();
        const l2 = loadSchemes();
        l2.splice(+del.dataset.del, 1);
        persistSchemes(l2);
        renderSchemes();
        UI.toast('已删除该方案');
      };
    });
  }

  /* ---------- 筛选条 ---------- */
  function renderFilterBar() {
    bar.innerHTML = `
      <div class="field" style="flex:0 0 190px">
        <label>姓名 / 身份证后四位 / 档案号</label>
        <div class="input"><svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.8" style="color:var(--t3)"><circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5L21 21"/></svg>
          <input id="fQ" placeholder="如 张 / 2417 / MY-2026" value="${esc(S.q)}" style="border:0;outline:0;background:transparent;font:inherit;flex:1;min-width:0">
        </div>
      </div>
      <div class="field" style="flex:0 0 132px"><label>类别标签</label><div class="select" id="fTag" style="height:28px">${esc(S.tag || '全部 11 类')}</div></div>
      <div class="field" style="flex:0 0 122px"><label>管控等级</label><div class="select" id="fLevel" style="height:28px">${esc(S.level ? D.levelOf(S.level).name : '全部等级')}</div></div>
      <div class="field" style="flex:0 0 116px"><label>责任镇街</label><div class="select" id="fTown" style="height:28px">${esc(S.town || '全部镇街')}</div></div>
      <div class="field" style="flex:0 0 104px"><label>主责单位</label><div class="select" id="fDept" style="height:28px">${esc(S.dept || '全部部门')}</div></div>
      <div class="field" style="flex:0 0 112px"><label>最近走访</label><div class="select" id="fVisit" style="height:28px">${S.visit === '30' ? '30 日以上' : S.visit === '7' ? '7 日内' : '不限'}</div></div>
      <div class="field" style="flex:0 0 118px"><label>列管状态</label><div class="select" id="fStatus" style="height:28px">${esc(S.status ? ({ new: '新列管（1 年内）', long: '列管 3 年以上' }[S.status] || '全部') : '全部')}</div></div>
      <div class="row" style="gap:6px;flex:0 0 auto">
        <button class="btn btn-primary" id="btnQuery">查询</button>
        <button class="btn" id="btnReset">重置</button>
        <button class="btn btn-ghost" id="btnSave">存为常用</button>
      </div>`;

    const input = document.getElementById('fQ');
    input.oninput = () => { S.q = input.value; S.page = 1; renderAll(false); };

    UI.select(document.getElementById('fTag'), {
      items: [{ v: '', t: '全部 11 类' }].concat(D.TAGS.map(t => ({ v: t.name, t: t.name, cnt: D.persons.filter(p => p.tags.indexOf(t.name) >= 0).length }))),
      value: S.tag, onChange: v => { S.tag = v; S.page = 1; renderAll(); }
    });
    UI.select(document.getElementById('fLevel'), {
      items: [{ v: '', t: '全部等级' }].concat(D.LEVELS.map(l => ({ v: l.key, t: l.name }))),
      value: S.level, onChange: v => { S.level = v; S.page = 1; renderAll(); }
    });
    UI.select(document.getElementById('fTown'), {
      items: [{ v: '', t: '全部镇街' }].concat(D.towns.map(t => ({ v: t.key, t: t.key, cnt: t.h }))),
      value: S.town, onChange: v => { S.town = v; S.page = 1; renderAll(); }
    });
    UI.select(document.getElementById('fDept'), {
      items: [{ v: '', t: '全部部门' }].concat(['公安分局', '区信访办', '区卫健委', '区司法局'].map(x => ({ v: x, t: x }))),
      value: S.dept, onChange: v => { S.dept = v; S.page = 1; renderAll(); }
    });
    UI.select(document.getElementById('fVisit'), {
      items: [{ v: '', t: '不限' }, { v: '30', t: '30 日以上' }, { v: '7', t: '7 日内' }],
      value: S.visit, onChange: v => { S.visit = v; S.page = 1; renderAll(); }
    });
    UI.select(document.getElementById('fStatus'), {
      items: [{ v: '', t: '全部' }, { v: 'new', t: '新列管（1 年内）', cnt: D.persons.filter(p => p.since >= '2025-11').length }, { v: 'long', t: '列管 3 年以上', cnt: D.persons.filter(p => p.since <= '2023-11').length }],
      value: S.status, onChange: v => { S.status = v; S.page = 1; renderAll(); }
    });

    document.getElementById('btnQuery').onclick = () => { S.page = 1; renderAll(); UI.toast.ok('已按 ' + filtered().length + ' 人筛选'); };
    document.getElementById('btnReset').onclick = () => {
      S.q = ''; S.tag = ''; S.level = ''; S.town = ''; S.dept = ''; S.visit = ''; S.status = '';
      S.deptTag = [];
      S.quick = 'high'; S.page = 1; S.selected.clear();
      renderAll();
    };
    document.getElementById('btnSave').onclick = () => {
      const conds = [
        S.q ? ['关键词', S.q] : null,
        S.tag ? ['类别标签', S.tag] : null,
        S.level ? ['管控等级', D.levelOf(S.level).name] : null,
        S.town ? ['责任镇街', S.town] : null,
        S.dept ? ['主责单位', S.dept] : null,
        S.deptTag.length ? ['部门归属（含共管）', S.deptTag.join(' + ')] : null,
        S.visit ? ['最近走访', S.visit === '30' ? '30 日以上' : '7 日内'] : null,
        S.status ? ['列管状态', S.status === 'new' ? '新列管（1 年内）' : '列管 3 年以上'] : null,
        ['快捷视图', { high: '全部重点关注', high2: '极高风险', dual: '双在册', multi: '多标', nobasis: '无依据' }[S.quick] || S.quick]
      ].filter(Boolean);
      UI.modal({
        title: '存为常用查询方案', width: 460,
        body: conds.map(c => '<div class="row" style="font-size:12px;padding:4px 0;border-bottom:1px dashed var(--line)"><span class="dim" style="flex:0 0 72px">' + c[0] + '</span><span>' + esc(String(c[1])) + '</span></div>').join('') +
          `<div class="fld" style="margin-top:10px"><label>方案名称</label><input type="text" id="schemeName" placeholder="例如：极高风险 · 30 日未走访" value="${esc(conds.slice(0, 2).map(c => c[1]).join(' · ') || ('方案 ' + (loadSchemes().length + 1)))}"></div>` +
          '<div class="tiny dim">当前条件命中 <b>' + filtered().length + '</b> 人。保存后出现在台账页顶部「常用方案」，本机保存，刷新或重开浏览器后仍在。</div>',
        okText: '保存方案',
        onOk: dlg => {
          const nmEl = dlg.querySelector('#schemeName');
          const nm = (nmEl && nmEl.value.trim()) || ('方案 ' + (loadSchemes().length + 1));
          const list2 = loadSchemes();
          list2.push({ name: nm, conds: snapshotConds(), count: filtered().length, at: new Date().toLocaleDateString('zh-CN') });
          persistSchemes(list2);
          STORE.audit('保存查询方案', '「' + nm + '」已存为常用方案（' + conds.length + ' 项条件 · 命中 ' + filtered().length + ' 人）', '人员台账');
          UI.toast.ok('常用方案已保存，可在台账顶部直接应用');
          renderSchemes();
          return true;
        }
      });
    };
  }

  /* ---------- 快捷视图 ---------- */
  function renderQuick() {
    const all = scopedAll();
    const count = k => {
      switch (k) {
        case 'high': return all.filter(p => D.levelOf(STORE.levelOf(p)).order <= 1).length;
        case 'high2': return all.filter(p => p.level === 'high2').length;
        case 'imported': return all.filter(p => p.imported).length;
        case 'dual': return all.filter(p => p.dual).length;
        case 'multi': return all.filter(p => p.multi).length;
        case 'nobasis': return all.filter(p => p.noBasis).length;
        case 'novisit': return all.filter(p => p.visitGap > 30).length;
        default: return D.stats.inRegister;
      }
    };
    qv.innerHTML = QUICKS.map(q => `<span class="qv ${S.quick === q.k ? 'on' : ''}" data-k="${q.k}" style="cursor:pointer">${q.t} <span class="n">${count(q.k).toLocaleString()}</span></span>`).join('');
    qv.querySelectorAll('.qv').forEach(n => {
      n.onclick = () => {
        S.quick = n.dataset.k; S.page = 1; S.selected.clear(); renderAll();
      };
    });
  }

  /* ---------- 结果条 ---------- */
  function renderResult(total) {
    const role = ROLE();
    const pct = (total / D.stats.inRegister * 100).toFixed(1);
    res.innerHTML = `
      <span>筛选结果 <b>${total}</b> 人<span class="dim">（占在册总数 ${pct}%${role.scope === 'dept' ? ' · 数据范围仅 ' + esc(role.dept) : ''}）</span></span>
      <span class="tag tag-line" style="height:20px">${S.level ? '管控等级：' + D.levelOf(S.level).name : (S.quick === 'high' ? '高风险及以上' : (QUICKS.find(q => q.k === S.quick) || {}).t)}${S.tag ? ' · ' + esc(S.tag) : ''}${S.village ? ' · ' + esc(S.village) : ''}${S.deptTag.length ? ' · 部门归属：' + esc(S.deptTag.join('+')) : ''} · 当前排序：${sortText()}</span>
      <span class="spacer"></span>
      <span class="dim">已选 <b style="color:var(--blue)">${S.selected.size}</b> 项</span>
      <button class="btn btn-sm" id="btnAssign" ${S.selected.size ? '' : 'disabled title="请先勾选人员后再批量指派"'}>批量指派</button>
      <button class="btn btn-sm" id="btnMark" ${S.selected.size ? '' : 'disabled title="请先勾选人员后再批量打标"'}>批量打标</button>
      <button class="btn btn-sm" id="btnExpSel" data-perm="export">导出选中</button>
      <button class="btn btn-sm btn-primary" id="btnExpAll" data-perm="export">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M12 4v12m0 0l-4.5-4.5M12 16l4.5-4.5"/><path d="M4 20h16"/></svg>脱敏导出
      </button>`;

    document.getElementById('btnExpSel').onclick = () => exportRows('选中人员', Array.from(S.selected).map(id => D.personById(id)), 'choose');
    document.getElementById('btnExpAll').onclick = () => exportRows('筛选结果', filtered(), 'mask');
    document.getElementById('btnAssign').onclick = batchAssign;
    document.getElementById('btnMark').onclick = batchMark;
  }
  function sortText() {
    return { level: '管控风险序 ↑', visit: '最近走访', name: '姓名', town: '镇街', no: '档案号' }[S.sort] || '管控风险序 ↑';
  }

  /* ---------- 表格 ---------- */
  function renderTable(list) {
    const pages = Math.max(1, Math.ceil(list.length / S.size));
    if (S.page > pages) S.page = pages;
    const rows = list.slice((S.page - 1) * S.size, S.page * S.size);
    const roleKey = ROLE().key;

    if (!rows.length) {
      body.innerHTML = `<tr><td colspan="10">${UI.empty('没有符合条件的人员', '可尝试放宽等级、镇街或走访条件，或切换快捷视图')}</td></tr>`;
    } else {
      body.innerHTML = rows.map(p => {
        const lv = D.levelOf(STORE.levelOf(p));
        const tags = p.tags.slice(0, 3).map(t => {
          const meta = D.TAGS.find(x => x.name === t) || { cls: 'tag-line' };
          return `<span class="tag ${meta.cls}">${esc(t)}</span>`;
        }).join('');
        const flags = [
          p.dual ? '<span class="flag dual">双在册</span>' : '',
          p.tags.length > 1 ? `<span class="flag multi">${p.tags.length} 标</span>` : '',
          p.noBasis ? '<span class="flag">依据缺失</span>' : '',
          p.watch ? '<span class="flag">重点关注</span>' : ''
        ].filter(Boolean).join('');
        return `<tr data-id="${p.id}">
          <td><span class="cb ${S.selected.has(p.id) ? 'on' : ''}" data-sel="${p.id}"></span></td>
          <td><div class="name-cell"><span class="ava">${esc(p.name.slice(0, 1))}</span>
            <div><span class="cell-main">${esc(D.field(roleKey, 'name', p).text)}</span><span class="cell-sub">${esc(p.no)}</span></div></div></td>
          <td><span class="mask">${esc(D.field(roleKey, 'idNo', p).text)}</span></td>
          <td><div class="tagstack">${tags}</div></td>
          <td><span class="${lv.cls}">${lv.name}</span></td>
          <td>${esc(p.town)}</td>
          <td>${esc(p.officer)}<span class="cell-sub">${esc(p.officerTitle)}</span></td>
          <td data-v="${p.visitGap}">${D.dateRel(p.visitGap)}</td>
          <td><div class="flags">${flags}</div></td>
          <td class="r"><a class="rowlink" href="person.html?id=${p.id}">查看档案</a></td>
        </tr>`;
      }).join('');
      body.querySelectorAll('[data-sel]').forEach(cb => UI.check(cb, {
        onChange: on => { on ? S.selected.add(cb.dataset.sel) : S.selected.delete(cb.dataset.sel); renderResult(list.length); }
      }));
      body.querySelectorAll('tr[data-id]').forEach(tr => {
        tr.addEventListener('dblclick', () => { location.href = 'person.html?id=' + tr.dataset.id; });
      });
    }

    /* 全选 */
    const cbAll = document.getElementById('cbAll');
    cbAll.classList.toggle('on', rows.length > 0 && rows.every(p => S.selected.has(p.id)));
    cbAll.onclick = () => {
      const allOn = rows.every(p => S.selected.has(p.id));
      rows.forEach(p => allOn ? S.selected.delete(p.id) : S.selected.add(p.id));
      renderTable(list); renderResult(list.length);
    };

    UI.pager(pagerBox, {
      total: list.length, page: S.page, size: S.size, unit: '条',
      onChange: p => { S.page = p; renderTable(list); }
    });

    /* 表头排序 */
    const ths = document.querySelectorAll('#listTable thead th');
    const map = { 1: 'name', 4: 'level', 5: 'town', 7: 'visit' };
    ths.forEach((th, i) => {
      const k = map[i];
      if (!k) return;
      th.style.cursor = 'pointer';
      th.onclick = () => {
        if (S.sort === k) S.dir = -S.dir; else { S.sort = k; S.dir = 1; }
        renderAll();
      };
    });

    const foot = document.getElementById('listFoot');
    if (foot) {
      const r = ROLE();
      foot.innerHTML = `· 当前角色「<b>${esc(r.roleName)}</b>」：姓名 ${r.fields.name === 'mask' ? '掩码' : '明文'}、身份证号 ${r.fields.idNo === 'mask' ? '仅显示前六后四' : '明文'}${r.scope === 'dept' ? '、数据范围仅 ' + esc(r.dept) : ''}；查看明文需发起申请并留痕。<br>
        · 列表默认按「管控风险序」升序；管控等级为「就高不就低」计算结果，点击表头可切换排序。<br>
        · 「依据缺失」「走访超期」等标识由系统按规则自动生成，不作为定级依据，仅提示补录。`;
    }
  }

  /* ---------- 导出 ---------- */
  /* intent: 'mask' 脱敏导出 | 'plain' 明文导出 | 'choose' 弹窗内二选一 */
  function exportRows(scope, list, intent) {
    if (!list.length) { UI.toast.warn('没有可导出的人员'); return; }
    const canPlain = !!(ROLE().can || {}).exportPlain;
    const doExport = mode => {
      const plain = mode === 'plain';
      const head = ['姓名', '档案号', '身份证号', '类别标签', '管控等级', '责任镇街', '包联干部', '最近走访', '标识'];
      /* 脱敏口径与角色无关：姓名保留首字、身份证前 6 后 4，绝不因当前角色字段权限而回落成明文 */
      const rows = [head].concat(list.map(p => [
        plain ? p.name : D.maskName(p.name),
        p.no,
        plain ? p.idNo : D.maskId(p.idNo),
        p.tags.join(' / '),
        D.levelOf(STORE.levelOf(p)).name,
        p.town,
        p.officer,
        D.dateBefore(p.visitGap),
        [p.dual ? '双在册' : '', p.tags.length > 1 ? p.tags.length + ' 标' : '', p.noBasis ? '依据缺失' : ''].filter(Boolean).join('、')
      ]));
      UI.downloadCSV(`人员台账_${scope}_${plain ? '明文' : '脱敏'}_20261110.csv`, rows);
      STORE.addExport(scope, list.length, plain ? '明文导出' : '脱敏导出');
      UI.toast.ok(`已导出 ${list.length} 条（${plain ? '明文' : '脱敏：姓名保留首字、身份证前 6 后 4'}）· 导出流水已留痕`);
    };

    const plainFlow = () => {
      if (!canPlain) { UI.toast.err('当前角色无明文导出权限，请走「明文导出申请」流程'); return; }
      if (list.length > 50) {
        UI.confirm({
          title: '提交双人复核',
          sub: '明文导出超过 50 条，需另一名主管复核后才会生成文件',
          body: `<div class="tiny" style="line-height:1.8">复核人：<b>王立</b>（区司法局 · 部门主管）<br>复核方式：演示环境自动通过并记录复核人<br>本次导出将记录申请人与复核人双签。</div>`,
          okText: '提交并导出',
          onOk: () => { STORE.audit('双人复核', scope + ' 明文导出 ' + list.length + ' 条，复核人 王立', '台账导出'); doExport('plain'); }
        });
      } else doExport('plain');
    };
    const kv = (mode) => `<dl class="kv" style="grid-template-columns:76px 1fr;font-size:12px">
        <dt>导出范围</dt><dd>${esc(scope)} · ${list.length} 条</dd>
        <dt>导出字段</dt><dd>${mode === 'plain'
          ? '姓名、身份证号（全字段明文）、档案号、标签、等级、镇街、包联干部、最近走访'
          : '姓名（保留首字 + *）、身份证号（前 6 位 + ********** + 后 4 位）、档案号、标签、等级、镇街、包联干部、最近走访'}</dd>
        <dt>脱敏口径</dt><dd>${mode === 'plain' ? '不脱敏（走明文流程并留痕）' : '与角色无关强制掩码，导出文件内不含完整身份证号'}</dd>
        <dt>当前角色</dt><dd>${esc(ROLE().roleName)} · ${canPlain ? '可导出全字段明文' : '仅可导出脱敏结果'}</dd>
      </dl>`;

    /* ① 脱敏导出：口径与按钮语义一致，不再走明文 */
    if (intent === 'mask') {
      UI.modal({
        title: '脱敏导出 · ' + scope + ' · ' + list.length + ' 条',
        sub: '姓名掩码、身份证仅显示前六后四、住址脱门牌；文件带水印与操作人标识',
        width: 480,
        okText: '脱敏导出',
        cancelText: '取消',
        body: kv('mask') + `<div class="tiny dim" style="margin-top:8px">脱敏导出可直接执行，无需审批；同样写入审计日志与导出流水。</div>`,
        onOk: () => { doExport('mask'); return true; }
      });
      return;
    }
    /* ② 明文导出 */
    if (intent === 'plain') {
      UI.modal({
        title: '明文导出 · ' + scope + ' · ' + list.length + ' 条',
        sub: '明文导出写入审计日志并记录申请人，单次 > 50 条需双人复核',
        width: 480,
        okText: '明文导出',
        cancelText: '取消',
        body: kv('plain') + (list.length > 50 ? '<div class="tiny" style="margin-top:8px;color:var(--orange);font-weight:600">单次明文导出 &gt; 50 条，需双人复核（申请人 ≠ 审批人）</div>' : ''),
        onOk: () => { plainFlow(); return true; }
      });
      return;
    }
    /* ③ 二选一：导出选中时让用户显式选择脱敏 / 明文 */
    UI.modal({
      title: '导出 ' + scope + ' · ' + list.length + ' 条',
      sub: '导出文件带水印与操作人标识，保留 7 天后自动清理；两种方式均写入审计日志',
      width: 480,
      okText: null,
      cancelText: '取消',
      body: kv('mask') + `
        <div class="row" style="margin-top:12px;gap:8px">
          <button class="btn" id="expMaskBtn" style="flex:1">脱敏导出</button>
          <button class="btn btn-primary" id="expPlainBtn" style="flex:1" ${canPlain ? '' : 'disabled'}>明文导出${canPlain ? '' : '（无权限）'}</button>
        </div>
        <div class="tiny dim" style="margin-top:7px">脱敏导出可随时执行；明文导出需权限，单次 &gt; 50 条另需双人复核后才能生成文件。</div>`,
      onMount: (dlg, close) => {
        dlg.querySelector('#expMaskBtn').onclick = () => { close(true); doExport('mask'); };
        const pb = dlg.querySelector('#expPlainBtn');
        pb.onclick = () => { if (pb.disabled) return; close(true); plainFlow(); };
      }
    });
  }

  /* ---------- 批量操作 ---------- */
  function batchAssign() {
    if (!window.guard('edit', '批量指派')) return;
    const ids = Array.from(S.selected);
    UI.modal({
      title: '批量指派包联干部',
      sub: `已选 ${ids.length} 人，指派后原包联干部收到变更通知`,
      body: `<div class="fld"><label>包联干部</label><div class="ui-radio" id="asgList">
        ${D.towns.slice(0, 4).map((t, i) => `<label class="${i === 0 ? 'on' : ''}" data-v="${esc(t.officer)}">
          <input type="radio" name="a" ${i === 0 ? 'checked' : ''} style="margin-top:2px">
          <span style="flex:1"><b>${esc(t.officer)}</b> · ${esc(t.title)}<br><span>${esc(t.name)} · 在册 ${t.v} 人</span></span></label>`).join('')}
        </div></div>
        <div class="fld"><label>指派说明</label><input type="text" id="asgNote" placeholder="例如：重点时期集中核查，10 个工作日内完成首访"></div>`,
      okText: '确认指派',
      onMount: dlg => {
        dlg.querySelectorAll('#asgList label').forEach(l => {
          l.onclick = () => {
            dlg.querySelectorAll('#asgList label').forEach(x => x.classList.remove('on'));
            l.classList.add('on'); l.querySelector('input').checked = true;
          };
        });
      },
      onOk: dlg => {
        const on = dlg.querySelector('#asgList label.on');
        const note = dlg.querySelector('#asgNote').value.trim();
        ids.forEach(id => {
          const p = D.personById(id);
          p.officer = on.dataset.v;
        });
        STORE.audit('批量指派', ids.length + ' 人指派给 ' + on.dataset.v + (note ? '：' + note : ''), '人员台账');
        UI.toast.ok('已指派 ' + ids.length + ' 人给 ' + on.dataset.v);
        renderAll();
      }
    });
  }

  function batchMark() {
    if (!window.guard('edit', '批量打标')) return;
    const ids = Array.from(S.selected);
    UI.modal({
      title: '批量打标',
      sub: `为 ${ids.length} 人追加标签（不覆盖原有标签，按唯一约束去重）`,
      body: `<div class="fld"><label>选择标签</label><div class="chips" id="markChips">
        ${D.TAGS.map(t => `<span class="chip-select" data-v="${esc(t.name)}">${esc(t.name)}</span>`).join('')}
        </div></div>
        <div class="fld"><label>打标依据（必填）</label><input type="text" id="markNote" placeholder="例如：11 月集中核查发现，已与主管部门确认"></div>`,
      okText: '确认打标',
      onMount: dlg => UI.chips(dlg.querySelector('#markChips')),
      onOk: dlg => {
        const picked = Array.from(dlg.querySelectorAll('#markChips .chip-select.on')).map(n => n.dataset.v);
        const note = dlg.querySelector('#markNote').value.trim();
        if (!picked.length) { UI.toast.warn('请至少选择一个标签'); return false; }
        if (note.length < 4) { UI.toast.warn('请填写打标依据'); return false; }
        ids.forEach(id => {
          const p = D.personById(id);
          picked.forEach(t => { if (p.tags.indexOf(t) < 0) p.tags.push(t); });
          p.multi = p.tags.length > 1;
        });
        STORE.audit('批量打标', ids.length + ' 人追加标签 ' + picked.join('/') + '：' + note, '人员台账');
        UI.toast.ok('已为 ' + ids.length + ' 人追加 ' + picked.length + ' 个标签');
        renderAll();
      }
    });
  }

  /* ---------- 组合查询面板 ----------
     面板逻辑已拆到 assets/page-query.js（独立查询状态 + 独立渲染），
     此处不再插手：旧实现会把「查询」当成切到台账视图，导致整页布局变化。 */
  function initQueryPanel() { /* no-op：见 page-query.js */ }

  /* ---------- 渲染入口 ---------- */
  function renderAll(withBar) {
    if (withBar !== false) renderFilterBar();
    renderQuick();
    renderSchemes();
    const list = filtered();
    renderResult(list.length);
    renderTable(list);
  }

  /* 深链：?quick= / ?level= / ?tag= / ?town= / ?village= / ?dept= / ?q=
     看板「去人员台账」按类别带上下文跳转，落地即应用对应筛选（而非默认全量） */
  (function () {
    const qs = new URLSearchParams(location.search);
    const qk = (qs.get('quick') || '').trim();
    if (qk && QUICKS.some(x => x.k === qk)) S.quick = qk;
    const lv = (qs.get('level') || '').trim();
    if (lv) { S.level = lv; S.quick = 'all'; }   /* 指定具体等级时不叠加「高风险及以上」门槛 */
    const tg = (qs.get('tag') || '').trim(); if (tg) S.tag = tg;
    const tw = (qs.get('town') || '').trim(); if (tw) S.town = tw;
    const dp = (qs.get('dept') || '').trim(); if (dp) S.dept = dp;
    /* ?deptTag=公安分局 或 ?deptTag=公安分局,区信访办（逗号=AND，同时归属）
       驾驶舱「部门维度 / 重合矩阵」下钻入口，命中数与卡片数字同源（DATA.deptsOf） */
    const dtg = (qs.get('deptTag') || '').trim();
    if (dtg) S.deptTag = dtg.split(',').map(s => s.trim()).filter(Boolean);
    const vg = (qs.get('village') || '').trim(); if (vg) S.village = vg;
    const kw = (qs.get('q') || '').trim(); if (kw) S.q = kw;
    if (lv || tg || tw || dp || dtg || vg || kw) S.page = 1;
  })();

  initQueryPanel();
  renderAll();
})();
