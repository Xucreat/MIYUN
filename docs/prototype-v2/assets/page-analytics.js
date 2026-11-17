/* ============================================================
   page-analytics.js · 统计分析
   ------------------------------------------------------------
   镇街对比表全部由 DATA.towns + DATA.persons 派生，与驾驶舱地图、
   人员台账、盲区人群同源：在册 = towns[].v（Σ 6,028）、
   高风险 = towns[].h（Σ 486）、双在册 = towns[].d（Σ 127）、
   多标 = persons 逐镇街实时统计（Σ 214）。

   交互：表头点击排序 / 「按高风险排序」快捷切换 / 导出报表 /
        月度报送预览
   ============================================================ */
(function () {
  'use strict';
  const D = window.DATA;
  const esc = UI.esc;
  /* 数据范围视图：dept 角色只统计本部门人员（政法委主管 / 区领导仍为全区口径） */
  const ALL = () => STORE.view(D.persons);

  const body = document.getElementById('townBody');
  if (!body) return;

  /* dept 角色进入时在页头声明数据范围：双在册/多标等实时统计已收敛到本部门，
     镇街「在册 / 高风险」两列是 DATA.towns 静态基线（全区口径），需说明避免口径误读 */
  const ROLE0 = window.STORE ? STORE.role() : null;
  if (ROLE0 && ROLE0.scope === 'dept') {
    const ph = document.querySelector('.page-head .ph-t p');
    if (ph) ph.textContent = '数据范围：仅本部门（' + ROLE0.dept + '）主责人员 · 镇街「在册 / 高风险」列为全区口径基线 · 可按月生成报送报表';
  }

  /* ---------- 行数据 ---------- */
  const multiByTown = {};
  const dualByTown = {};
  ALL().forEach(p => {
    if (p.multi) multiByTown[p.town] = (multiByTown[p.town] || 0) + 1;
    if (p.dual) dualByTown[p.town] = (dualByTown[p.town] || 0) + 1;
  });

  const rows = D.towns.map(t => ({
    key: t.key, name: t.name,
    v: t.v, h: t.h,
    dual: dualByTown[t.key] || 0,
    multi: multiByTown[t.key] || 0,
    m: t.m
  }));

  const SUM = {
    v: rows.reduce((a, r) => a + r.v, 0),
    h: rows.reduce((a, r) => a + r.h, 0),
    dual: rows.reduce((a, r) => a + r.dual, 0),
    multi: rows.reduce((a, r) => a + r.multi, 0)
  };

  /* ---------- 排序状态 ---------- */
  const S = { sort: 'v', dir: -1 };
  const KEYS = ['name', 'v', 'h', 'dual', 'multi', 'm', null];

  /* ---------- 趋势火花线（按镇街名做种子，刷新不变） ---------- */
  function seedOf(s) {
    let h = 20261110;
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return h;
  }
  function spark(name, m) {
    let x = seedOf(name);
    const rnd = () => { x ^= x << 13; x ^= x >>> 17; x ^= x << 5; x >>>= 0; return x / 4294967296; };
    const n = 6;
    const pts = [];
    let v = 6;
    for (let i = 0; i < n; i++) {
      v += (rnd() - 0.5) * 5;
      v = Math.max(2, Math.min(11, v));
      pts.push(v);
    }
    // 见面率越低，末段越往上（表示压力上升）
    const rising = m < 86;
    const color = rising ? '#d92d20' : (m >= 92 ? '#1f8a53' : '#e8830c');
    const coords = pts.map((y, i) => `${2 + i * 8.4},${y.toFixed(1)}`).join(' ');
    return `<svg width="46" height="14" viewBox="0 0 46 14"><polyline points="${coords}" fill="none" stroke="${color}" stroke-width="1.5" stroke-linecap="round"/></svg>`;
  }

  /* ---------- 渲染 ---------- */
  /* 排序：卡片表格与「放大查看」弹窗共用同一顺序 */
  function sortedRows() {
    return rows.slice().sort((a, b) => {
      const k = S.sort;
      if (k === 'name') return a.name.localeCompare(b.name, 'zh') * S.dir;
      return (a[k] - b[k]) * S.dir || a.name.localeCompare(b.name, 'zh');
    });
  }

  function render() {
    const list = sortedRows();

    body.innerHTML = list.map(r => `<tr data-town="${esc(r.key)}">
      <td class="${r.v >= 400 ? 'strong' : ''}">${esc(r.name)}</td>
      <td class="r num">${r.v.toLocaleString()}</td>
      <td class="r num"${r.h >= 30 ? ' style="color:var(--red)"' : ''}>${r.h}</td>
      <td class="r num">${r.dual}</td>
      <td class="r num">${r.multi}</td>
      <td class="r num"${r.m < 80 ? ' style="color:var(--red)"' : ''}>${r.m.toFixed(1)}%</td>
      <td>${spark(r.name, r.m)}</td>
    </tr>`).join('');

    // 合计行
    const foot = document.querySelector('tfoot .tot');
    if (foot) {
      const avgM = (rows.reduce((a, r) => a + r.m * r.v, 0) / SUM.v);
      foot.innerHTML = `<td>全区合计</td><td class="r num">${SUM.v.toLocaleString()}</td>
        <td class="r num" style="color:var(--red)">${SUM.h}</td>
        <td class="r num">${SUM.dual}</td><td class="r num">${SUM.multi}</td>
        <td class="r num">${avgM.toFixed(1)}%</td><td></td>`;
    }

    // 结论文案（原「镇街对比」卡片脚注）已按需求删除，此处不再回写
    markHead();
  }

  function markHead() {
    const ths = document.querySelectorAll('.split-64 table thead th');
    ths.forEach((th, i) => {
      const k = KEYS[i];
      if (!k) return;
      th.style.cursor = 'pointer';
      th.dataset.k = k;
      const base = th.textContent.replace(/[ ↑↓]/g, '');
      th.textContent = base + (S.sort === k ? (S.dir === 1 ? ' ↑' : ' ↓') : '');
      th.title = '点击按「' + base + '」排序';
      th.onclick = () => {
        if (S.sort === k) S.dir = -S.dir;
        else { S.sort = k; S.dir = k === 'name' ? 1 : -1; }
        render();
      };
    });
  }

  /* ---------- 导出报表 ---------- */
  function exportReport() {
    const header = ['镇街', '在册人数', '高风险及以上', '双在册', '多重标签', '见面率(%)'];
    const data = rows.slice()
      .sort((a, b) => b.v - a.v)
      .map(r => [r.name, r.v, r.h, r.dual, r.multi, r.m.toFixed(1)]);
    const avgM = (rows.reduce((a, r) => a + r.m * r.v, 0) / SUM.v).toFixed(1);
    data.push(['全区合计', SUM.v, SUM.h, SUM.dual, SUM.multi, avgM]);

    const btn = document.getElementById('btnExportRpt');
    UI.modal({
      title: '导出统计报表 · 镇街对比',
      sub: '口径与驾驶舱、人员台账一致，可直接用于月度报送',
      width: 470,
      okText: '导出 CSV',
      body: `<dl class="kv" style="grid-template-columns:84px 1fr;font-size:12px">
        <dt>范围</dt><dd>全区 20 个镇街 + 合计行</dd>
        <dt>字段</dt><dd>${header.join('、')}</dd>
        <dt>校验</dt><dd>在册 Σ ${SUM.v.toLocaleString()} · 高风险 Σ ${SUM.h} · 双在册 Σ ${SUM.dual} · 多标 Σ ${SUM.multi}</dd>
      </dl>`,
      onOk: () => {
        UI.downloadCSV('统计分析_镇街对比_2026-11.csv', [header].concat(data));
        STORE.addExport(`统计分析 · 镇街对比 ${rows.length} 行`);
        STORE.audit('导出统计报表', '镇街对比 20 行 + 合计', '统计分析');
        UI.toast.ok('报表已导出');
        return true;
      }
    });
    if (btn) btn.blur();
  }

  /* ---------- 月度报送预览 ---------- */
  function monthly() {
    const pay = [
      { k: '在册总数', v: SUM.v.toLocaleString() + ' 人', d: '去重后 · 台账 7,112 人次' },
      { k: '高风险及以上', v: SUM.h + ' 人', d: '占 ' + (SUM.h / SUM.v * 100).toFixed(1) + '%' },
      { k: '双在册人员', v: SUM.dual + ' 人', d: '需两部门会签确认' },
      { k: '多重标签', v: SUM.multi + ' 人', d: '按就高不就低统一等级' },
      { k: '风险未定级', v: D.stats.unknown + ' 人', d: '未纳入高风险统计' },
      { k: '本月变动', v: '+' + D.stats.monthDelta + ' 人', d: `新增 ${D.stats.monthAdd} · 消减 ${D.stats.monthSub}` }
    ];
    UI.modal({
      title: '月度报送预览 · 2026 年 11 月',
      sub: '报送对象：区委政法委 · 数据截至 2026-11-10 09:45',
      width: 520,
      okText: '确认并导出',
      body: `<div class="grid" style="grid-template-columns:repeat(3,1fr);gap:8px">
        ${pay.map(p => `<div style="border:1px solid var(--line);border-radius:9px;padding:9px 11px">
          <div class="tiny dim">${esc(p.k)}</div>
          <div style="font-size:17px;font-weight:650;letter-spacing:-.4px;margin:2px 0 1px">${esc(p.v)}</div>
          <div class="tiny dim" style="line-height:1.4">${esc(p.d)}</div>
        </div>`).join('')}
      </div>
      <div class="tiny" style="margin-top:11px;line-height:1.8;color:var(--t2)">
        报送口径：在册总数按身份证号去重；高风险及以上按管控等级统计，不含待核实；
        多标人员在各标签维度重复计入人次，不与人数混用。<b>本期不涉及任何等级自动变更</b>。
      </div>`,
      onOk: () => {
        const header = ['指标', '数值', '说明'];
        const data = pay.map(p => [p.k, p.v, p.d]);
        UI.downloadCSV('月度报送_2026-11.csv', [header].concat(data));
        STORE.addExport('月度报送 2026-11');
        STORE.audit('生成月度报送', '2026-11 月报 6 项指标', '统计分析');
        UI.toast.ok('月度报送已生成');
        return true;
      }
    });
  }

  /* ---------- 放大查看：镇街对比完整表格 ---------- */
  const SORT_LABEL = { name: '镇街名', v: '在册人数', h: '高风险及以上', dual: '双在册', multi: '多标人数', m: '见面率' };
  function sortLabel() {
    return (SORT_LABEL[S.sort] || '在册人数') + (S.dir === 1 ? ' ↑' : ' ↓');
  }

  function openTownExpand() {
    const list = sortedRows();
    const avgM = rows.reduce((a, r) => a + r.m * r.v, 0) / SUM.v;
    UI.modal({
      title: '镇街对比 · 完整表格',
      sub: `${list.length} 个镇街 + 全区合计 · 与驾驶舱地图、人员台账、盲区人群同源`,
      width: 880,
      okText: null,
      cancelText: '关闭',
      body: `<div class="exp-lead">
          <span>在册合计 <b>${SUM.v.toLocaleString()}</b> 人</span>
          <span class="dim">·</span>
          <span>高风险及以上 <b style="color:var(--red)">${SUM.h}</b> 人</span>
          <span class="dim">·</span>
          <span>双在册 <b>${SUM.dual}</b> 人 · 多标 <b>${SUM.multi}</b> 人</span>
          <span class="spacer"></span>
          <span class="tiny dim">当前排序：${sortLabel()}</span>
        </div>
        <div class="exp-box">
          <table class="tb compact exp-tb exp-town">
            <thead><tr><th>镇街</th><th class="r">在册</th><th class="r">高风险</th><th class="r">双在册</th>
              <th class="r">多标</th><th class="r">见面率</th><th class="c">趋势</th></tr></thead>
            <tbody>${list.map(r => `<tr>
              <td class="${r.v >= 400 ? 'strong' : ''}">${esc(r.name)}</td>
              <td class="r num">${r.v.toLocaleString()}</td>
              <td class="r num"${r.h >= 30 ? ' style="color:var(--red)"' : ''}>${r.h}</td>
              <td class="r num">${r.dual}</td>
              <td class="r num">${r.multi}</td>
              <td class="r num"${r.m < 80 ? ' style="color:var(--red)"' : ''}>${r.m.toFixed(1)}%</td>
              <td>${spark(r.name, r.m)}</td></tr>`).join('')}</tbody>
            <tfoot><tr class="tot"><td>全区合计</td><td class="r num">${SUM.v.toLocaleString()}</td>
              <td class="r num" style="color:var(--red)">${SUM.h}</td><td class="r num">${SUM.dual}</td>
              <td class="r num">${SUM.multi}</td><td class="r num">${avgM.toFixed(1)}%</td><td></td></tr></tfoot>
          </table>
        </div>`
    });
  }

  /* ---------- 事件绑定 ---------- */
  const btnSort = document.getElementById('btnSortRisk');
  if (btnSort) btnSort.onclick = () => {
    if (S.sort === 'h' && S.dir === -1) { S.dir = 1; btnSort.textContent = '按高风险升序'; }
    else { S.sort = 'h'; S.dir = -1; btnSort.textContent = '按高风险降序'; }
    render();
    UI.toast('已按高风险' + (S.dir === -1 ? '降序' : '升序') + '排列');
  };
  const btnExp = document.getElementById('btnExportRpt');
  if (btnExp) btnExp.onclick = exportReport;
  const btnMon = document.getElementById('btnMonthly');
  if (btnMon) btnMon.onclick = monthly;
  /* 放大查看：卡片 → 弹窗完整表格 */
  const btnTownExp = document.getElementById('btnTownExpand');
  if (btnTownExp) btnTownExp.onclick = openTownExpand;

  render();

  /* ?focus= 深链：高亮指定镇街行（board 告警「去分析」入口） */
  (function () {
    const focus = (new URLSearchParams(location.search).get('focus') || '').trim();
    if (!focus) return;
    const body = document.getElementById('townBody');
    if (!body) return;
    const hit = Array.from(body.querySelectorAll('tr')).filter(tr => tr.textContent.indexOf(focus) > -1);
    if (!hit.length) { UI.toast(`未找到「${focus}」相关行，已显示全量`); return; }
    hit.forEach(tr => { tr.style.background = 'var(--blue-soft)'; tr.style.outline = '1px solid var(--blue)'; tr.style.outlineOffset = '-1px'; });
    hit[0].scrollIntoView({ behavior: 'smooth', block: 'center' });
    UI.toast.ok(`已定位「${focus}」相关 ${hit.length} 行（高亮显示）`);
  })();
})();

/* ============================================================
   page-analytics.js · 第二部分（5 张卡片的下钻与交互）
   ------------------------------------------------------------
   ① 类别 × 管控等级：由 DATA.persons 实时派生（486 人 / 728 人次），单元格可下钻
   ② 风险等级月度变动：26-11 由 CHG_FULL 台账实算上调 / 下调（当前 22 / 24），不手写数字，
      避免与审批中心的变动台账角标漂移；
      26-06~26-10 无逐条台账，按月度报送汇总口径做种子确定性生成（悬浮卡已注明）
   ③ 标签组合前十：由 persons.tags 实时聚合，点击看该组合的人员
   ④ 月度报送情况：本月 vs 上月逐部门差异说明
   ============================================================ */
(function () {
  'use strict';
  const D = window.DATA, S = window.STORE, esc = UI.esc;
  if (!D || !S) return;
  /* 数据范围视图：dept 角色只统计本部门人员（与第一个 IIFE 的 ALL 同口径） */
  const ALL = () => S.view(D.persons);
  const roleKey = () => S.role().key;
  const nm = p => D.field(roleKey(), 'name', p).text;
  const lvOf = p => D.levelOf(S.levelOf(p));

  /* ---------- 通用：人员明细弹窗 ---------- */
  function personDialog(title, sub, list, opt) {
    const o = opt || {};
    const rows = list.slice();
    UI.modal({
      title,
      sub: sub + (o.note ? ' · ' + o.note : ''),
      width: 820,
      okText: null,
      cancelText: '关闭',
      footLeft: '<button class="btn btn-sm" data-act="csv">导出该清单</button>',
      body: rows.length ? `<div class="table-wrap" style="max-height:360px;overflow:auto;border:1px solid var(--line);border-radius:9px">
        <table class="tb compact">
          <thead><tr><th style="width:34px">#</th><th style="width:104px">姓名</th><th style="width:120px">档案号</th>
            <th style="width:96px">责任镇街</th><th style="width:84px">管控等级</th><th>类别标签</th>
            <th style="width:78px" class="r">未走访</th><th style="width:52px" class="r">档案</th></tr></thead>
          <tbody>${rows.map((p, i) => `<tr>
            <td class="dim num">${i + 1}</td>
            <td><span class="cell-main">${esc(nm(p))}</span></td>
            <td class="tiny num">${esc(p.no)}</td>
            <td>${esc(p.town)}</td>
            <td><span class="${lvOf(p).cls}">${esc(lvOf(p).name)}</span></td>
            <td class="tiny">${(p.tags || []).map(t => esc(t)).join(' / ')}</td>
            <td class="r tiny"${p.visitGap > 30 ? ' style="color:var(--red)"' : ''}>${p.visitGap} 天</td>
            <td class="r"><a href="javascript:;" data-go="${esc(p.id)}" style="color:var(--blue)">查看</a></td>
          </tr>`).join('')}</tbody>
        </table></div>`
        : UI.empty('该口径下暂无人员', '台账只收录高风险及以上人员，可切换其他条件查看'),
      onMount: (dlg, close) => {
        dlg.querySelectorAll('[data-go]').forEach(a => {
          a.onclick = () => { close(null); location.href = 'person.html?id=' + encodeURIComponent(a.dataset.go); };
        });
        const b = dlg.querySelector('[data-act=csv]');
        if (b) b.onclick = () => {
          if (!window.guard('export', '导出分析清单')) return;
          const head = ['序号', '姓名', '档案号', '责任镇街', '管控等级', '类别标签', '未走访天数'];
          const data = rows.map((p, i) => [i + 1, nm(p), p.no, p.town, lvOf(p).name, (p.tags || []).join('/'), p.visitGap]);
          UI.downloadCSV(o.file || '统计分析_清单_2026-11.csv', [head].concat(data));
          S.addExport(o.scope || '统计分析清单', data.length, '脱敏');
          S.audit('导出分析清单', title + ' · ' + data.length + ' 人', '统计分析');
          UI.toast.ok('已导出 ' + data.length + ' 条');
        };
      }
    });
  }

  /* ============================================================
     ① 类别 × 管控等级
     ============================================================ */
  const LEVEL_COLS = [
    { key: 'high2', name: '极高', cls: 'c1' },
    { key: 'high', name: '高', cls: 'c1' },
    { key: 'mid', name: '中', cls: 'c2' },
    { key: 'low', name: '低', cls: 'c3' },
    { key: 'unknown', name: '待核实', cls: 'c4' }
  ];
  function matrixRows() {
    return D.TAGS.map(t => {
      const cells = { high2: 0, high: 0, mid: 0, low: 0, unknown: 0 };
      let total = 0;
      ALL().forEach(p => {
        if ((p.tags || []).indexOf(t.name) < 0) return;
        const k = S.levelOf(p);
        cells[k] = (cells[k] || 0) + 1;
        total++;
      });
      return { tag: t.name, dept: t.dept, cells, total };
    }).sort((a, b) => b.total - a.total);
  }
  function renderMatrix() {
    const tb = document.getElementById('matrixBody');
    if (!tb) return;
    const rows = matrixRows();
    const sum = { high2: 0, high: 0, mid: 0, low: 0, unknown: 0 };
    let all = 0;
    rows.forEach(r => { LEVEL_COLS.forEach(c => { sum[c.key] += r.cells[c.key] || 0; }); all += r.total; });
    tb.innerHTML = rows.map(r => `<tr data-tag="${esc(r.tag)}">
      <td class="nm">${esc(r.tag)}<span class="tiny dim" style="margin-left:4px">${esc(r.dept)}</span></td>
      ${LEVEL_COLS.map(c => `<td class="${(r.cells[c.key] || 0) ? c.cls : 'c0'}" data-lv="${c.key}">${r.cells[c.key] || '—'}</td>`).join('')}
      <td class="tot">${r.total}</td></tr>`).join('') +
      `<tr class="tot"><td class="nm">合计</td>${LEVEL_COLS.map(c => `<td>${sum[c.key]}</td>`).join('')}<td>${all}</td></tr>`;

    tb.querySelectorAll('tr[data-tag]').forEach(tr => {
      tr.onclick = e => {
        const cell = e.target.closest('td[data-lv]');
        openMatrixCell(tr.dataset.tag, cell ? cell.dataset.lv : '');
      };
    });

    const sub = document.getElementById('matrixSub');
    if (sub) sub.textContent = `人员台账 ${ALL().length} 人 · ${all} 人次`;
  }
  function openMatrixCell(tag, lvKey) {
    const lvName = lvKey ? (LEVEL_COLS.find(c => c.key === lvKey) || {}).name : '';
    const list = ALL().filter(p => (p.tags || []).indexOf(tag) > -1 && (!lvKey || S.levelOf(p) === lvKey));
    personDialog(
      '类别明细 · ' + tag + (lvName ? ' × ' + lvName : ''),
      `台账 ${list.length} 人 · 该类别共 ${ALL().filter(p => (p.tags || []).indexOf(tag) > -1).length} 人次`,
      list,
      { scope: '类别明细 ' + tag, file: `类别明细_${tag}_2026-11.csv`, note: '按标签人次统计，多标人员在各标签行重复计入' }
    );
  }

  /* ============================================================
     ② 风险等级月度变动
     ============================================================ */
  /* 26-11 与等级变动台账（CHG_FULL）对账：上调 / 下调由台账实算（当前 22 / 24），
     不写死数字，改台账数据后本图自动跟随；其余月份无逐条台账，
     按月度报送汇总口径做种子确定性生成，悬浮卡注明来源 */
  const LV_ORD = { low: 1, mid: 2, high: 3, high2: 4 };
  const NOV = (D.CHG_FULL || []).reduce((a, c) => {
    const d = (LV_ORD[c.to] || 0) - (LV_ORD[c.from] || 0);
    if (d > 0) a.up += 1; else if (d < 0) a.down += 1;
    return a;
  }, { up: 0, down: 0 });
  const CHG = [
    { m: '26-06', up: 16, down: 22, days: 1.6, why: '中高考与暑期叠加，涉访类上调 9 人；矫正期满下调 14 人' },
    { m: '26-07', up: 18, down: 19, days: 1.5, why: '汛期入户受阻，见面率回落，评估结论变更导致双向调整' },
    { m: '26-08', up: 14, down: 25, days: 1.3, why: '精障患者专科复评集中下调 11 人' },
    { m: '26-09', up: 20, down: 21, days: 1.7, why: '开学季未成年人关注上调 6 人' },
    { m: '26-10', up: 21, down: 26, days: 1.5, why: '国庆前集中评估，双向调整均高于常年' },
    { m: '26-11', up: NOV.up, down: NOV.down, days: 1.4, real: true, why: '上调主要为新增关注标签或危险性评估升级，另有出现扬言、失联等情形；下调多为矫正期届满、病情稳定复评' }
  ];
  function renderChg() {
    const box = document.getElementById('chgBars');
    if (!box) return;
    const max = Math.max(...CHG.map(x => Math.max(x.up, x.down)));
    box.innerHTML = CHG.map((x, i) => `<div class="bp" data-m="${x.m}">
      <div class="bs">
        <i data-k="up" style="height:${(x.up / max * 100).toFixed(0)}%;background:#d92d20"></i>
        <i data-k="down" style="height:${(x.down / max * 100).toFixed(0)}%;background:#1f8a53"></i>
      </div>
      <span class="bl">${x.m}</span></div>`).join('');

    box.querySelectorAll('.bp').forEach(n => {
      const x = CHG.find(v => v.m === n.dataset.m);
      UI.tip(n, () => {
        const prev = CHG[CHG.indexOf(x) - 1];
        const dUp = prev ? x.up - prev.up : 0;
        const dDown = prev ? x.down - prev.down : 0;
        const sign = v => (v > 0 ? '+' + v : String(v));
        return `<div class="tt">${x.m}${x.real ? ' · 本月' : ''} 风险等级变动</div>
          <div class="kv-row"><span>上调（风险升高）</span><b style="color:#d92d20">${x.up} 人</b></div>
          <div class="kv-row"><span>下调（风险趋稳）</span><b style="color:#1f8a53">${x.down} 人</b></div>
          <div class="kv-row"><span>净变化</span><b>${sign(x.down - x.up)} 人</b></div>
          ${prev ? `<div class="kv-row"><span>环比（上调 / 下调）</span><b>${sign(dUp)} / ${sign(dDown)}</b></div>` : ''}
          <div class="kv-row"><span>平均审批时长</span><b>${x.days} 天</b></div>
          <div class="hr"></div>
          <div class="dim2">主要事由：${x.why}</div>
          <div class="dim2">数据来源：${x.real ? '等级变动台账 ' + (x.up + x.down) + ' 条（审批通过后生效）' : '月度报送汇总口径（该月无逐条台账，演示数据按种子生成）'}</div>`;
      });
    });

    const cur = CHG[CHG.length - 1], prev = CHG[CHG.length - 2];
    const set = (id, v) => { const n = document.getElementById(id); if (n) n.textContent = v; };
    set('chgUp', cur.up);
    set('chgDown', cur.down);
    const sgn = v => (v > 0 ? '+' + v : String(v));
    set('chgUpMeta', `本月上调 · 环比 ${sgn(cur.up - prev.up)}`);
    set('chgDownMeta', `本月下调 · 环比 ${sgn(cur.down - prev.down)}`);
    const note = document.getElementById('chgNote');
    if (note) note.textContent = `下调多于上调，说明多数人员风险趋于稳定；${cur.why}。26-06 至 26-10 无逐条变动台账，按月度报送汇总口径展示（悬浮可看每月口径）。`;
  }

  /* ============================================================
     ③ 标签组合前十
     ============================================================ */
  const SHORT = {
    '涉访 A 类': '涉访A', '涉访 B 类': '涉访B', '扬言类重点人': '扬言', '政保重点人': '政保',
    '吸毒人员': '吸毒', '严重精神障碍': '精障', '六失一偏': '六失一偏', '社区矫正': '矫正',
    '刑满释放': '刑释', '安置帮教': '帮教', '境外关联': '境外', '待归类': '待归类'
  };
  const shortOf = t => SHORT[t] || t;
  function comboStats() {
    const map = {};
    ALL().forEach(p => {
      const t = (p.tags || []);
      if (t.length < 2) return;
      const k = t.slice().sort().join('+');
      map[k] = (map[k] || 0) + 1;
    });
    const list = Object.keys(map).map(k => ({ key: k, tags: k.split('+'), n: map[k] }))
      .sort((a, b) => b.n - a.n || a.key.localeCompare(b.key));
    const multi = ALL().filter(p => (p.tags || []).length > 1).length;
    const triple = ALL().filter(p => (p.tags || []).length > 2).length;
    return { list, multi, triple };
  }
  function renderCombo() {
    const box = document.getElementById('comboBody');
    if (!box) return;
    const st = comboStats();
    const top = st.list.slice(0, 10);
    const topSum = top.reduce((a, x) => a + x.n, 0);
    const rest = st.multi - topSum;
    const max = Math.max(1, ...top.map(x => x.n));
    const COLOR = ['var(--red)', 'var(--orange)', 'var(--orange)', 'var(--purple)', 'var(--purple)', 'var(--slate)', 'var(--slate)', 'var(--slate)', 'var(--slate)', 'var(--slate)'];

    box.innerHTML = top.map((x, i) => `<div class="rank-row" data-combo="${esc(x.key)}">
      <span class="rank-no">${i + 1}</span>
      <span class="rank-nm"><span class="nm">${esc(x.tags.map(shortOf).join('+'))}</span>
        <span class="rank-bar"><i style="width:${(x.n / max * 100).toFixed(0)}%;background:${COLOR[i]}"></i></span></span>
      <span class="rank-val">${x.n} 人</span></div>`).join('') +
      `<div class="rank-row" data-combo="__rest">
        <span class="rank-no">·</span>
        <span class="rank-nm"><span class="nm">其他组合（${Math.max(0, st.list.length - 10)} 种）</span>
          <span class="rank-bar"><i style="width:${rest / max * 100 > 100 ? 100 : (rest / max * 100).toFixed(0)}%;background:var(--t4)"></i></span></span>
        <span class="rank-val">${rest} 人</span></div>`;

    box.querySelectorAll('[data-combo]').forEach(n => {
      n.onclick = () => openCombo(n.dataset.combo, top);
    });

    const sub = document.getElementById('comboSub');
    if (sub) sub.textContent = `${st.multi} 名多标人员 · ${st.list.length} 种组合`;
    const tag = document.getElementById('comboTag');
    if (tag) tag.textContent = `3 标 ${st.triple} 人`;
    const foot = document.getElementById('comboFoot');
    if (foot && top.length) {
      const top3 = top.slice(0, 3).reduce((a, x) => a + x.n, 0);
      foot.textContent = `前三位组合共 ${top3} 人，占多标人员 ${(top3 / st.multi * 100).toFixed(1)}%，均已纳入「重点关注」并在驾驶舱标识；点击任一组合可查看具体人员。`;
    }
  }
  /* ---------- 放大查看：标签组合完整表格 ---------- */
  function openComboExpand() {
    const st = comboStats();
    /* 每个组合涉及的镇街分布（用于「主要镇街」列） */
    const townOf = {};
    ALL().forEach(p => {
      const t = p.tags || [];
      if (t.length < 2) return;
      const k = t.slice().sort().join('+');
      const m = townOf[k] || (townOf[k] = {});
      m[p.town] = (m[p.town] || 0) + 1;
    });
    const base = st.multi || 1;
    const top10 = st.list.slice(0, 10).map(x => x.key);
    const topSum = st.list.slice(0, 10).reduce((a, x) => a + x.n, 0);
    UI.modal({
      title: '标签组合 · 完整表格',
      sub: `${st.list.length} 种组合 · 逐人多标聚合（标签数 ≥ 2 才计入）`,
      width: 860,
      okText: null,
      cancelText: '关闭',
      body: `<div class="exp-lead">
          <span>多标人员 <b>${st.multi}</b> 人（占台账人员 ${(st.multi / ALL().length * 100).toFixed(1)}%）</span>
          <span class="dim">·</span>
          <span>组合 <b>${st.list.length}</b> 种 · 其中 3 标及以上 <b>${st.triple}</b> 人</span>
          <span class="spacer"></span>
          <span class="tiny dim">前 10 组合共 ${topSum} 人，占 ${(topSum / base * 100).toFixed(1)}%</span>
        </div>
        <div class="exp-box">
          <table class="tb compact exp-tb exp-combo">
            <thead><tr><th class="r">#</th><th>标签组合</th><th class="r">人数</th>
              <th class="r">占多标人员</th><th>主要镇街（人数前 3）</th></tr></thead>
            <tbody>${st.list.map((x, i) => {
              const towns = Object.keys(townOf[x.key] || {})
                .sort((a, b) => townOf[x.key][b] - townOf[x.key][a]).slice(0, 3)
                .map(t => `${esc(t)} ${townOf[x.key][t]}`).join(' · ');
              const inTop = top10.indexOf(x.key) > -1;
              return `<tr>
                <td class="r num ${inTop ? 'strong' : 'dim'}">${i + 1}</td>
                <td><span class="cell-main">${x.tags.map(t => esc(t)).join(' / ')}</span></td>
                <td class="r num strong">${x.n}</td>
                <td class="r num">${(x.n / base * 100).toFixed(1)}%</td>
                <td class="tiny dim">${towns || '—'}</td></tr>`;
            }).join('')}</tbody>
            <tfoot><tr class="tot"><td></td><td>多标人员合计</td><td class="r num">${st.multi}</td>
              <td class="r num">100.0%</td><td></td></tr></tfoot>
          </table>
        </div>`
    });
  }

  function openCombo(key, top) {
    const st = comboStats();
    let list, title, note;
    if (key === '__rest') {
      const topKeys = top.map(x => x.key);
      list = ALL().filter(p => (p.tags || []).length > 1 && topKeys.indexOf((p.tags || []).slice().sort().join('+')) < 0);
      title = '标签组合 · 其他组合';
      note = `前 10 组合之外的 ${st.list.length - 10} 种组合`;
    } else {
      list = ALL().filter(p => (p.tags || []).slice().sort().join('+') === key);
      title = '标签组合 · ' + key.split('+').map(shortOf).join(' + ');
      note = key.split('+').join(' / ');
    }
    personDialog(title, `${list.length} 人（多标人员共 ${st.multi} 人）`, list, {
      scope: '标签组合明细', file: '标签组合明细_2026-11.csv', note: note
    });
  }

  /* ============================================================
     ⑤ 月度报送情况 + 差异说明
     ============================================================ */
  function renderMonthly() {
    const tb = document.getElementById('mReportBody');
    if (!tb) return;
    const m = D.reportMonthly;
    tb.innerHTML = m.rows.map(r => {
      const lack = r.should - r.real;
      let tag;
      if (lack > 0) tag = `<span class="tag tag-red">缺报 ${lack} 项</span>`;
      else if (r.late > 0) tag = `<span class="tag tag-amber">迟报 ${r.lateDays || 1} 天</span>`;
      else tag = '<span class="tag tag-green">已完成</span>';
      return `<tr><td>${esc(r.dept)}</td><td class="r num">${r.should}</td><td class="r num">${r.real}</td>
        <td class="r num"${r.late ? ' style="color:var(--orange)"' : ''}>${r.late}</td><td class="r">${tag}</td></tr>`;
    }).join('');
    const sub = document.getElementById('mReportSub');
    if (sub) sub.textContent = m.month;
  }

  function diffReport() {
    const m = D.reportMonthly;
    const sum = k => m.rows.reduce((a, r) => a + r[k], 0);
    const curS = sum('should'), curR = sum('real'), curL = sum('late');
    const preS = sum('prevShould'), preR = sum('prevReal'), preL = sum('prevLate');
    const d = (a, b) => (a - b > 0 ? '+' + (a - b) : String(a - b));
    const changes = [];
    m.rows.forEach(r => {
      const ds = r.should - r.prevShould, dr = r.real - r.prevReal, dl = r.late - r.prevLate;
      if (!ds && !dr && !dl) return;
      const parts = [];
      if (ds) parts.push(`应报 ${d(r.should, r.prevShould)}`);
      if (dr) parts.push(`实报 ${d(r.real, r.prevReal)}`);
      if (dl) parts.push(`迟报 ${d(r.late, r.prevLate)}`);
      changes.push(`· <b>${esc(r.dept)}</b>：${parts.join('、')}${r.note ? '；' + esc(r.note) : ''}`);
    });
    const lack = m.rows.filter(r => r.real < r.should);
    const body = `
      <div class="grid g4" style="gap:8px">
        ${[
          ['应报表块', curS, d(curS, preS)],
          ['实报', curR, d(curR, preR)],
          ['迟报', curL, d(curL, preL)],
          ['缺口', curS - curR, d(curS - curR, preS - preR)]
        ].map(x => `<div style="border:1px solid var(--line);border-radius:9px;padding:9px 11px">
          <div class="tiny dim">${x[0]}</div>
          <div style="font-size:18px;font-weight:650;letter-spacing:-.4px;margin:2px 0 1px">${x[1]}</div>
          <div class="tiny dim">环比上月 ${x[2]}</div></div>`).join('')}
      </div>
      <div class="sect-title" style="margin-top:12px">差异明细（${m.month} vs ${m.prev}）</div>
      <div class="tiny" style="line-height:1.9;color:var(--t2)">${changes.length ? changes.join('<br>') : '· 各指标与上月一致，无差异'}</div>
      <div class="sect-title" style="margin-top:12px">督办建议</div>
      <div class="tiny" style="line-height:1.9;color:var(--t2)">
        ${lack.length
          ? lack.map(r => `· <b>${esc(r.dept)}</b>：缺报 ${r.should - r.real} 项${r.note ? '（' + esc(r.note) + '）' : ''}，建议下发催报单并要求 3 个工作日内补齐`).join('<br>')
          : '· 本期无缺报，报请区委政法委按「已完成」归档'}
        <br>· 迟报 ${curL} 项，按《月度报送考核细则》计入部门数据质量评分
      </div>
      <div class="tiny dim" style="margin-top:9px">口径：应报/实报/迟报按部门报送表块计数，与本页「月度报送情况」逐行一致；数据截至 ${m.due}。</div>`;
    UI.modal({
      title: '月度报送差异说明 · ' + m.month,
      sub: '本月 vs 上月逐部门对比 · 可直接导出报送政法委',
      width: 620,
      okText: '导出差异说明',
      body,
      onOk: () => {
        if (!window.guard('export', '导出差异说明')) return false;
        const head = ['部门', '应报', '实报', '迟报', '状态', '上月应报', '上月实报', '上月迟报', '说明'];
        const data = m.rows.map(r => [r.dept, r.should, r.real, r.late,
          r.real < r.should ? '缺报 ' + (r.should - r.real) + ' 项' : (r.late ? '迟报' : '已完成'),
          r.prevShould, r.prevReal, r.prevLate, r.note || '']);
        data.push(['合计', curS, curR, curL, '缺口 ' + (curS - curR), preS, preR, preL, '']);
        UI.downloadCSV('月度报送差异说明_' + m.month + '.csv', [head].concat(data));
        S.addExport('月度报送差异说明 ' + m.month, data.length, '脱敏');
        S.audit('生成差异说明', `${m.month} vs ${m.prev}：应报 ${curS} · 实报 ${curR} · 迟报 ${curL} · 缺口 ${curS - curR}`, '统计分析');
        UI.toast.ok('差异说明已导出');
        return true;
      }
    });
  }

  /* ---------- KPI：见面率跟随重点时期实时数据 ---------- */
  function paintKpi() {
    const s = S.wtStats();
    const r = document.getElementById('kpiRate');
    if (r) r.textContent = s.rate.toFixed(1);
    const meta = document.getElementById('kpiRateMeta');
    if (meta) meta.textContent = `应见 ${s.should} · 已见 ${s.met}`;
  }

  /* ---------- 渲染入口 ---------- */
  renderMatrix();
  renderChg();
  renderCombo();
  renderMonthly();
  paintKpi();

  const bd = document.getElementById('btnDiffReport');
  if (bd) bd.onclick = diffReport;

  /* 放大查看：标签组合 → 弹窗完整表格 */
  const btnComboExp = document.getElementById('btnComboExpand');
  if (btnComboExp) btnComboExp.onclick = openComboExpand;

  /* 订阅：回填 / 审批改级后，卡片数值随之更新 */
  if (S.on) {
    S.on(() => { renderMatrix(); renderCombo(); paintKpi(); });
  }
})();
