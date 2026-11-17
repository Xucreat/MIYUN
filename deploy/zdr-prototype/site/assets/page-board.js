/* ============================================================
 * page-board.js — 数据看板交互控制器
 * 原则：所有与其它页面对账的数字一律同源取数（STORE / DATA），
 *       不在 board 内硬编码口径。
 * ============================================================ */
(function () {
  const D = window.DATA, ST = window.STORE, UIx = window.UI;
  const $ = id => document.getElementById(id);
  const esc = UIx.esc;
  const SHORT = { high2: '极高', high: '高', mid: '中', low: '低', unknown: '待核' };
  const TAGCLS = { high2: 'tag-red', high: 'tag-red', mid: 'tag-orange', low: 'tag-slate', unknown: 'tag-amber' };
  const lvTag = k => `<span class="tag ${TAGCLS[k] || 'tag-slate'}">${SHORT[k] || k}</span>`;
  const fld = (p, f) => D.field(ST.role().key, f, p).text;

  /* ---------- 数据范围：公安经办（scope=dept）仅见本部门数据 ----------
     leader / admin 走全区口径不变；dept 把人员明细、待办计数、
     审批单、风险告警等收敛为本部门（与人员台账 / 预警页同一 view 口径）。
     全区统筹叙事（重点时期进度、跨镇街流动、报送质量）保留并注明口径。 */
  const SCOPED = ST.role().scope === 'dept';
  const DEPT_NAME = ST.role().dept || '';
  const MINE = SCOPED ? ST.view(D.persons) : null;
  const inScope = p => !SCOPED || (p && p.dept === DEPT_NAME);

  /* dept 视角口径说明条：shell 会把 .page-head 移出 DOM，直接挂到 .content 顶部 */
  if (SCOPED) {
    const content = document.querySelector('.content');
    if (content) {
      const banner = document.createElement('div');
      banner.className = 'banner banner-info mb10';
      banner.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 8v.2M12 11v5"/></svg>' +
        '<span>当前以「' + ST.role().roleName + ' · ' + DEPT_NAME + '」身份查看：待办、人员明细、审批单与风险告警为<b>本部门口径</b>；重点时期进度、人员流动与报送质量为全区统筹口径。</span>';
      content.prepend(banner);
    }
  }

  /* ---------- 通用浮动 tooltip（fixed，不被卡片裁切） ---------- */
  const tip = document.createElement('div');
  tip.style.cssText = 'position:fixed;z-index:99;pointer-events:none;opacity:0;transition:opacity .08s;' +
    'background:rgba(12,43,77,.95);color:#fff;border-radius:9px;padding:8px 10px;font-size:11px;line-height:1.55;' +
    'min-width:150px;max-width:290px;box-shadow:0 8px 22px rgba(10,40,80,.28);backdrop-filter:blur(6px)';
  document.body.appendChild(tip);
  function showTip(html, e) {
    tip.innerHTML = html; tip.style.opacity = 1;
    const w = tip.offsetWidth, h = tip.offsetHeight;
    let x = e.clientX + 14, y = e.clientY + 12;
    if (x + w > innerWidth - 8) x = e.clientX - w - 14;
    if (y + h > innerHeight - 8) y = e.clientY - h - 12;
    tip.style.left = Math.max(6, x) + 'px'; tip.style.top = Math.max(6, y) + 'px';
  }
  function hideTip() { tip.style.opacity = 0; }
  function bindTip(el, html) {
    el.addEventListener('mousemove', e => showTip(typeof html === 'function' ? html() : html, e));
    el.addEventListener('mouseleave', hideTip);
  }
  const tipRow = (k, v, c) => `<div style="display:flex;justify-content:space-between;gap:14px"><span style="opacity:.78">${k}</span><b style="${c ? 'color:' + c : ''}">${v}</b></div>`;

  /* ---------- SVG 图表重绘（柱与悬浮数据同源） ---------- */
  function drawBars(svg, rows, opt) {
    const W = +svg.getAttribute('viewBox').split(' ')[2];
    const H = +svg.getAttribute('viewBox').split(' ')[3];
    const base = opt.base, unit = opt.unit, bw = opt.bw, gap = opt.gapIn, x0 = opt.x0;
    const max = Math.max(...rows.map(r => Math.max(r.a, r.b)));
    let html = `<line x1="${x0 - 14}" y1="${base}" x2="${W - 14}" y2="${base}" stroke="#e7eaee"/>`;
    for (let i = 0; i <= opt.yMax; i += opt.yStep) {
      const y = base - i * unit;
      html += `<line x1="${x0 - 14}" y1="${y}" x2="${W - 14}" y2="${y}" stroke="#eef0f3"/><text x="${x0 - 20}" y="${y + 3}" font-size="8.5" fill="#aeb4bc" text-anchor="end">${i}${opt.ySuffix || ''}</text>`;
    }
    rows.forEach((r, i) => {
      const x = x0 + i * (bw * 2 + gap + 12);
      const ha = r.a * unit, hb = r.b * unit;
      html += `<rect class="bd-bar" data-i="${i}" data-k="a" x="${x}" y="${base - ha}" width="${bw}" height="${ha}" rx="2" fill="${opt.cA}" opacity=".78"/>`;
      html += `<rect class="bd-bar" data-i="${i}" data-k="b" x="${x + bw + 2}" y="${base - hb}" width="${bw}" height="${hb}" rx="2" fill="${opt.cB}" opacity=".62"/>`;
      if (opt.line) {
        const nx = x + bw + 1, ny = base - (r.a - r.b) * unit;
        if (i === 0) opt._pts = `M${nx},${ny}`; else opt._pts += ` L${nx},${ny}`;
        if (i === rows.length - 1) {
          html += `<circle cx="${nx}" cy="${ny}" r="3" fill="#fff" stroke="${opt.cLine}" stroke-width="2"/>`;
        }
      }
      if (opt.every || i === rows.length - 1) {
        if (i % opt.every === 0 || i === rows.length - 1)
          html += `<text x="${x + bw + 1}" y="${base + 14}" font-size="8.5" fill="#aeb4bc" text-anchor="middle" ${i === rows.length - 1 ? 'fill="#0071e3" font-weight="600"' : ''}>${r.m}</text>`;
      }
    });
    if (opt.line) html = html.replace('</svg>', '') /* noop */, html += `<polyline points="${(function () {
      let pts = '';
      rows.forEach((r, i) => { pts += (i ? ' ' : '') + (x0 + i * (bw * 2 + gap + 12) + bw + 1) + ',' + (base - (r.a - r.b) * unit); });
      return pts;
    })()}" fill="none" stroke="${opt.cLine}" stroke-width="2" stroke-linejoin="round"/>`;
    svg.innerHTML = html;
    svg.querySelectorAll('.bd-bar').forEach(rect => {
      const r = rows[+rect.dataset.i];
      const isA = rect.dataset.k === 'a';
      bindTip(rect, () =>
        `<div style="font-weight:650;margin-bottom:3px">${r.full || r.m}</div>` +
        tipRow(opt.lA, (isA ? r.a : r.a) + ' ' + opt.uA, opt.cA) +
        tipRow(opt.lB, r.b + ' ' + opt.uB, opt.cB) +
        tipRow(opt.lNet || '净变化', (r.a - r.b >= 0 ? '+' : '') + (r.a - r.b) + (opt.uNet || ''), (r.a - r.b) >= 0 ? '#7dd87d' : '#ff9c9c'));
    });
  }

  /* ============================================================
   * 实时总览：待我处理（计数取自 STORE，跳转带过滤上下文）
   * ============================================================ */
  function renderTodo() {
    const box = $('todoList'); if (!box) return;
    /* dept：预警与审批按本部门人员收敛（口径与预警页 / 审批单一致） */
    const alertN = SCOPED
      ? ST.alerts().filter(a => inScope(D.personById(a.personId)) && a.status === '待处置').length
      : ST.alertStats().open;
    const apprRows = (() => {
      const rows = ST.approvals();
      return SCOPED ? rows.filter(a => inScope(D.personById(a.personId))) : rows;
    })();
    const apprN = SCOPED ? apprRows.filter(a => a.status === '待审批').length : ST.approvalStats().pending;
    const dualOver = SCOPED
      ? MINE.filter(p => p.dual).length   /* 与盲区页 dept 视角「双在册」口径一致 */
      : 9; /* 与 blind.html CONF 生成逻辑同参：前 9 条超 7 日未确认 */
    const wts = ST.wtStats();
    const notRep = ST.wtTasks().filter(t => !t.reported);
    const items = [
      { c: 'var(--red)', t: `双在册${SCOPED ? '待确认' : '确认超期'} ${dualOver} 条`, m: SCOPED ? `本部门双在册 · 跨部门责任交叉待确认` : '最长超期 6 天 · 不老屯 3 条', b: '处理', href: 'blind.html?type=dual&st=over' },
      { c: 'var(--orange)', t: `预警待处置 ${alertN} 条`, m: SCOPED ? `本部门人员相关预警 · 待处置` : `超期 7 条 · 今日新增 ${alertN} 条`, b: '处理', href: 'alerts.html' },
      SCOPED
        ? { c: 'var(--blue)', t: `本部门调整申请在途 ${apprN} 条`, m: '审批由「政法委主管」执行，此处跟踪进度', b: '查看', href: 'persons.html?tab=query' }
        : { c: 'var(--blue)', t: `等级调整待审批 ${apprN} 条`, m: '上调 2 · 下调 3', b: '处理', href: 'risk.html' },
      { c: 'var(--amber)', t: `未零报告镇街 ${notRep.length} 个`, m: `${notRep.slice(0, 2).map(t => t.town.replace(/(街道|地区|镇)$/, '')).join('、')}${notRep.length > 2 ? ' 等 ' + notRep.length + ' 个' : ''} · 20:00 截止`, b: '查看明细', href: 'wartime.html' }
    ];
    box.innerHTML = items.map(it => `<div class="li" style="padding:7px 0">
      <span class="lvl" style="width:4px;height:26px;border-radius:2px;background:${it.c};flex:0 0 4px"></span>
      <div style="min-width:0"><div style="font-size:12px;font-weight:600">${it.t}</div><div class="tiny dim">${it.m}</div></div>
      <span class="spacer"></span><a class="btn btn-sm" href="${it.href}">${it.b}</a></div>`).join('');
  }

  /* ============================================================
   * 实时总览：实时动态（点击跳转/弹窗 + 自动滚动轮播，悬浮暂停）
   * ============================================================ */
  const FEED = [
    { t: '10:52', tag: '预警', tc: 'var(--red-soft)', fc: 'var(--red)', html: '鼓楼街道 <b>任玉荣</b> 触发「超期未走访」（33 天未走访），已指派 王振国', act: { type: 'link', href: 'alerts.html', btn: '去预警处置', note: '对应预警 AL-20261110-020 · 规则 RG-01 走访超期 · 预警待办置顶可查' } },
    { t: '10:48', tag: '回填', tc: 'var(--green-soft)', fc: 'var(--green)', html: '果园街道提交走访记录 <b>8 条</b>，其中见面 7 条', act: { type: 'link', href: 'wartime.html', btn: '看重点时期台账', note: '回填计入重点时期「20 镇街见面进度」（果园街道 应见 60 / 已见 54）' } },
    { t: '10:41', tag: '查阅', tc: 'var(--blue-soft)', fc: 'var(--blue-ink)', html: '区卫健委 李春燕 查阅档案 <b>3 次</b>（本部门数据）', act: { type: 'modal', title: '查阅留痕详情', rows: [['查阅人', '区卫健委 · 李春燕'], ['时间', '10:38 — 10:41'], ['对象', '本部门在册档案 3 份（姓名已按权限脱敏）'], ['途径', '档案检索 + 一人一档页'], ['留痕', '审计日志 AUD-2026…已记录']] } },
    { t: '10:35', tag: '警示', tc: 'var(--amber-soft)', fc: '#8a6100', html: '越权尝试 <b>1 次</b>：属地经办访问非本辖区档案，已拦截', act: { type: 'link', href: 'system.html?tab=audit', btn: '查审计日志', note: '拦截详情见系统管理-审计日志' } },
    { t: '10:26', tag: '审批', tc: 'var(--purple-soft)', fc: 'var(--purple)', html: '等级调整申请 <b>中 → 低</b>（周文斌 · 巨各庄镇）待政法委主管审批', act: { type: 'link', href: 'risk.html', btn: '去审批', note: '对应申请单 APP-20261111-001 ·「待我审批」列表第一条' } },
    { t: '10:18', tag: '回填', tc: 'var(--green-soft)', fc: 'var(--green)', html: '冯家峪镇 补报昨日数据 <b>12 条</b>（此前接口超时），今日零报告已提交', act: { type: 'link', href: 'wartime.html', btn: '看零报告状态', note: '冯家峪镇今日零报告已提交，见重点时期管控 20 镇街进度' } },
    { t: '10:05', tag: '入库', tc: 'var(--blue-soft)', fc: 'var(--blue-ink)', html: '公安分局增量推送 <b>4 人</b>，查重后新增 4、合并 0', act: { type: 'link', href: 'import.html', btn: '看导入批次', note: '对应导入批次 IM-20261111-01（今日 10:05 · 已完成）' } },
    { t: '09:47', tag: '预警', tc: 'var(--red-soft)', fc: 'var(--red)', html: '果园街道 <b>韦振华</b> 双在册确认超期（公安+卫健），已标记需督办', act: { type: 'link', href: 'blind.html?type=dual&st=over', btn: '去盲区核查', note: '已过滤「双在册 + 超 7 日未确认」，韦振华为清单第 1 条' } }
  ];
  function feedModal(item) {
    const a = item.act;
    if (a.type === 'link') {
      UIx.modal({
        title: '动态详情', width: 420,
        body: `<div class="tiny dim mb8">${item.t} · ${item.tag}</div>
               <div style="font-size:12.5px;line-height:1.7">${item.html}</div>
               <div class="tiny dim" style="margin-top:8px">${a.note || ''}</div>`,
        okText: a.btn,
        onOk: () => { setTimeout(() => { location.href = a.href; }, 60); return true; },
        cancelText: '关闭'
      });
    } else {
      UIx.modal({
        title: a.title, width: 460,
        body: a.rows.map(r => `<div class="row" style="font-size:12px;padding:4px 0;border-bottom:1px dashed var(--line)"><span class="dim" style="flex:0 0 72px">${r[0]}</span><span>${esc(r[1])}</span></div>`).join(''),
        okText: null, cancelText: '关闭'
      });
    }
  }
  function renderFeed() {
    const box = $('feedList'); if (!box) return;
    const one = FEED.map(f => `<div class="feed-item" data-fi="${FEED.indexOf(f)}" style="cursor:pointer" title="点击查看详情"><div class="feed-t">${f.t}</div><div class="feed-d"><span class="feed-tag" style="background:${f.tc};color:${f.fc}">${f.tag}</span>${f.html}</div></div>`).join('');
    box.innerHTML = `<div class="feed-track">${one}${one}</div>`;
    box.querySelectorAll('.feed-item').forEach(el => { el.onclick = () => feedModal(FEED[+el.dataset.fi]); });
  }

  /* ============================================================
   * 重点盯控（与 wartime 完全同源）
   * ============================================================ */
  /* 24 小时活跃与操作：透明 hover 列 + tooltip（数据由静态 SVG 柱高/折线反推，保证与图形一致） */
  function renderRtChart() {
    const svg = document.querySelector('[data-panel="rt"] .split-73 > .card > .card-bd > svg');
    if (!svg || svg.dataset.tipBound) return;
    svg.dataset.tipBound = '1';
    const qMap = {}, fMap = {};
    svg.querySelectorAll('g[fill="#8fb0cd"] rect').forEach(rc => {
      const h = Math.round((+rc.getAttribute('x') - 36) / 25);
      qMap[h] = Math.max(1, Math.round(+rc.getAttribute('height') * 2));
    });
    svg.querySelectorAll('g[fill="#1f8a53"] rect').forEach(rc => {
      const i = Math.round((+rc.getAttribute('x') - 44) / 50);
      fMap[i * 2] = Math.max(1, Math.round(+rc.getAttribute('height') * 2.4));
    });
    const poly = svg.querySelector('polyline');
    const pts = poly ? poly.getAttribute('points').trim().split(/\s+/).map(str => str.split(',').map(Number)) : [];
    const online = h => {
      const pt = pts[Math.min(Math.round(h / 2), pts.length - 1)];
      return pt ? Math.round((156 - pt[1]) * 0.53) : null;
    };
    const NS = 'http://www.w3.org/2000/svg';
    for (let h = 0; h < 24; h++) {
      const r = document.createElementNS(NS, 'rect');
      r.setAttribute('x', 33 + h * 25); r.setAttribute('y', 8);
      r.setAttribute('width', 25); r.setAttribute('height', 164);
      r.setAttribute('fill', 'transparent');
      r.style.cursor = 'crosshair';
      r.addEventListener('mousemove', e => {
        const hh = String(h).padStart(2, '0');
        const rows = [];
        const ol = online(h);
        if (ol != null && ol > 0) rows.push(tipRow('在线人数', ol + ' 人'));
        rows.push(tipRow('查询 / 查阅', qMap[h] != null ? qMap[h] + ' 次' : '数据聚合中'));
        if (h % 2 === 0) rows.push(tipRow('走访回填', fMap[h] != null ? fMap[h] + ' 条' : '—'));
        showTip('<div style="font-weight:650;margin-bottom:3px">今日 ' + hh + ':00 — ' + hh + ':59</div>' + rows.join(''), e);
      });
      r.addEventListener('mouseleave', hideTip);
      svg.appendChild(r);
    }
  }

  function renderWatch() {
    const tasks = ST.wtTasks(), st = ST.wtStats();
    /* KPI 五卡 */
    const kp = $('watchKpis');
    if (kp) {
      const notRep = tasks.filter(t => !t.reported);
      kp.innerHTML = `
        <div class="card kpi"><div class="kpi-label">应见名单</div><div class="kpi-val">${st.should}<span class="unit">人</span></div><div class="kpi-meta">重点时期第 ${D.wartime.dayNow} 天</div></div>
        <div class="card kpi k-green"><div class="kpi-label">已见面</div><div class="kpi-val">${st.met}<span class="unit">人</span></div><div class="kpi-meta">见面率 ${(st.met / st.should * 100).toFixed(1)}%</div></div>
        <div class="card kpi k-red"><div class="kpi-label">未报告</div><div class="kpi-val">${st.missing}<span class="unit">人</span></div><div class="kpi-meta">超 3 日未报 12 人</div></div>
        <div class="card kpi k-amber"><div class="kpi-label">未零报告镇街</div><div class="kpi-val">${notRep.length}<span class="unit">个</span></div><div class="kpi-meta">${notRep.slice(0, 2).map(t => t.town.replace(/(街道|地区|镇)$/, '')).join('、')}${notRep.length > 2 ? ' 等' + notRep.length + '个' : ''} · 20:00 截止</div></div>
        <div class="card kpi k-slate"><div class="kpi-label">今日走访待回填</div><div class="kpi-val">36<span class="unit">条</span></div><div class="kpi-meta">昨日已回填 126 条</div></div>`;
    }
    /* 20 镇街表 */
    const tb = $('watchTownBody');
    if (tb) {
      tb.innerHTML = tasks.map(t => {
        const rate = t.should ? t.met / t.should * 100 : 0;
        const low = rate < 80;
        return `<tr>
          <td class="cell-main">${esc(t.town)}</td>
          <td class="r num">${t.should}</td><td class="r num">${t.met}</td>
          <td><div class="bar thin"><i style="width:${rate.toFixed(0)}%;background:${low ? 'var(--orange)' : ''}"></i></div></td>
          <td class="r num" ${low ? 'style="color:var(--red);font-weight:600"' : ''}>${rate.toFixed(1)}%</td>
          <td class="r num">${t.missing}</td>
          <td><span class="tag ${t.reported ? 'tag-green' : 'tag-red'}">${t.reported ? '已提交' : '未提交'}</span></td>
        </tr>`;
      }).join('');
    }
    const foot = $('watchFoot');
    if (foot) foot.innerHTML = `全区应见 <b>${st.should}</b> / 已见 <b>${st.met}</b> / 未报 <b>${st.missing}</b> / 见面率 <b>${(st.met / st.should * 100).toFixed(1)}%</b>（数据与「重点时期管控」同源${SCOPED ? ' · 全区统筹口径' : ''}）`;
    /* 今日零报告 */
    const zg = $('zgGrid');
    if (zg) {
      zg.innerHTML = tasks.map(t => `<div class="zg-item ${t.reported ? 'ok' : 'no'}"><div class="zw"><span>${t.town.replace(/(街道|地区|镇)$/, '')}</span><i class="dot"></i></div><div class="zt">${t.reported ? t.reportAt : '未提交'}</div></div>`).join('');
      const rep = tasks.filter(t => t.reported).length;
      const sub = $('zgSub'), tag = $('zgTag');
      if (sub) sub.textContent = `已提交 ${rep} / ${tasks.length}`;
      if (tag) { tag.textContent = `${tasks.length - rep} 镇街未报`; tag.className = 'tag ' + (rep === tasks.length ? 'tag-green' : 'tag-red'); }
    }
    /* 最久未见面 TOP5（DATA.wartimeUnseenAll，与 wartime 督办口径一致；dept 仅本部门） */
    const lg = $('longestList');
    if (lg) {
      const REASONS = ['应见未见面 · 长期拒访', '外出务工 · 电话未接通', '长期住院 · 已协调卫健代访', '居住地存疑 · 正在核查', '已约本周五见面', '家属陪同走访 2 次未接触'];
      const rows = D.wartimeUnseenAll().filter(r => inScope(r.person)).slice(0, 5);
      lg.innerHTML = rows.map((r, i) => {
        const p = r.person, gap = p.visitGap;
        const stTag = gap > 30 ? '<span class="tag tag-red">超期</span>' : gap > 14 ? '<span class="tag tag-amber">跟进中</span>' : '<span class="tag tag-blue">已约</span>';
        return `<div class="li" style="padding:6px 0">
          <div style="min-width:0"><div style="font-size:12px;font-weight:600">${esc(fld(p, 'name'))} <span class="tiny dim">${esc(r.town)} · ${D.levelOf(p.level).name}</span></div>
          <div class="tiny dim">${REASONS[i % REASONS.length]} · 距上次见面 ${gap} 天</div></div>
          <span class="spacer"></span>${stTag}</div>`;
      }).join('');
      lg.querySelectorAll('.li').forEach((el, i) => {
        el.style.cursor = 'pointer';
        el.onclick = () => { location.href = 'person.html?id=' + encodeURIComponent(rows[i].person.id); };
      });
    }
  }

  /* ============================================================
   * 人员流动
   * ============================================================ */
  const MV12 = [
    { m: '25-12', full: '2025年12月', a: 50, b: 10 }, { m: '26-01', full: '2026年1月', a: 52, b: 11 },
    { m: '26-02', full: '2026年2月', a: 46, b: 9 }, { m: '26-03', full: '2026年3月', a: 54, b: 12 },
    { m: '26-04', full: '2026年4月', a: 48, b: 10 }, { m: '26-05', full: '2026年5月', a: 57, b: 13 },
    { m: '26-06', full: '2026年6月', a: 50, b: 11 }, { m: '26-07', full: '2026年7月', a: 53, b: 12 },
    { m: '26-08', full: '2026年8月', a: 55, b: 13 }, { m: '26-09', full: '2026年9月', a: 52, b: 12 },
    { m: '26-10', full: '2026年10月', a: 44, b: 14 }, { m: '26-11', full: '2026年11月（本月）', a: 43, b: 12 }
  ];
  const SRC_ROWS = [
    { nm: '公安 · 新列管', n: 26, bar: '#0071e3', pct: 100, detail: '公安分局本月推送新增列管，全部附《列管审批表》' },
    { nm: '卫健 · 新增评估', n: 9, bar: '#e8830c', pct: 35, detail: '精防医生季度评估新判定，附评估结论书' },
    { nm: '信访 · 新登记', n: 5, bar: '#6b56c9', pct: 19, detail: '信访事项标记涉稳人员新登记' },
    { nm: '司法 · 新接收', n: 3, bar: '#1f8a53', pct: 12, detail: '社区矫正 / 安置帮教新接收' }
  ];
  const MOVE_ALERTS = [
    { c: 'var(--orange)', t: '鼓楼街道单月流入 9 人，为近 6 个月峰值', m: '主要为涉访关注与严重精神障碍，建议核实列管依据', focus: '鼓楼街道',
      detail: { rows: [['构成', '涉访关注 4 · 严重精神障碍 3 · 六失一偏 2'], ['主要来源', '公安列管 6 · 卫健评估 3'], ['凭证', '9 人均有列管 / 评估材料，2 件材料待补传'], ['建议', '由鼓楼街道综治中心 5 个工作日内逐人核实列管依据']] },
      acts: [{ b: '去分析', href: 'analytics.html?focus=鼓楼街道' }, { b: '查台账', href: 'persons.html' }] },
    { c: 'var(--red)', t: '石城镇 3 人迁出未附迁出证明', m: '撤管原因填写为「其他」，需补充材料后重新核定', focus: '石城镇',
      detail: { rows: [['涉及', '石城镇 3 人（姓名按权限显示）'], ['问题', '撤管原因 =「其他」，缺迁出证明或审批'], ['时限', '3 个工作日内补正，逾期计入报送质量'], ['入口', '可在导入页更换附件重新报送']] },
      acts: [{ b: '去导入补件', href: 'import.html' }, { b: '标记已核', mark: true }] },
    { c: 'var(--blue)', t: '同一人 30 日内二次迁入（密云镇 ↔ 果园）', m: '已并档，需确认属地责任划分', focus: '密云镇',
      detail: { rows: [['人员', '1 人（两址往返，已并档为主档案）'], ['轨迹', '密云镇 → 果园街道 → 密云镇（30 日内 2 次）'], ['责任', '并档期间由现居住地属地负责走访'], ['风险', '若再发生将触发 RG-08 跨区流动预警']] },
      acts: [{ b: '看该预警人员明细', secondMove: true }] }
  ];
  function renderMove() {
    /* 12 月流入 / 流出图 */
    const mv = $('mvChart');
    if (mv) drawBars(mv, MV12, { base: 144, unit: 2, yMax: 60, yStep: 20, bw: 12, gapIn: 16, x0: 42, cA: '#1f8a53', cB: '#d92d20', cLine: '#0071e3', line: true, every: 2, lA: '流入', lB: '流出', lNet: '净流入', uA: '人', uB: '人', uNet: '人' });
    /* 流入来源：点击弹窗 */
    const sc = $('srcCat');
    if (sc) {
      sc.querySelectorAll('.cat-row').forEach((row, i) => {
        row.style.cursor = 'pointer';
        bindTip(row, () => `<div style="font-weight:650;margin-bottom:3px">${SRC_ROWS[i].nm}</div>` + tipRow('本月流入', SRC_ROWS[i].n + ' 人') + tipRow('占比', (SRC_ROWS[i].n / 43 * 100).toFixed(0) + '%') + `<div style="opacity:.78;margin-top:4px">点击看认定材料与代表人员</div>`);
        row.onclick = () => {
          UIx.modal({
            title: '流入来源 · ' + SRC_ROWS[i].nm, width: 480,
            body: tipRow('本月流入', SRC_ROWS[i].n + ' 人（' + (SRC_ROWS[i].n / 43 * 100).toFixed(0) + '%）').replace(/opacity/, 'class') +
              `<div class="tiny dim" style="margin:7px 0">${SRC_ROWS[i].detail}</div>
               <div class="sect-title" style="margin-bottom:4px">代表人员（按角色脱敏${SCOPED ? ' · 本部门' : ''}）</div>` +
              (SCOPED ? MINE.filter(p => p.dept && p.town) : D.persons.filter(p => p.dept && p.town)).slice(i * 3, i * 3 + 3).map(p => `<div class="li" style="padding:4px 0"><span class="mono tiny">${esc(fld(p, 'idNo'))}</span><span style="margin-left:8px">${esc(fld(p, 'name'))}</span><span class="spacer"></span><span class="tiny dim">${esc(p.town)}</span></div>`).join(''),
            okText: null, cancelText: '关闭'
          });
        };
      });
    }
    /* 流动预警：点击弹窗 + 带上下文深链 */
    const ma = $('moveAlertList');
    if (ma) {
      ma.innerHTML = MOVE_ALERTS.map((a, i) => `<div class="li" style="padding:8px 0;cursor:pointer" data-mi="${i}">
        <span class="lvl" style="width:4px;height:28px;border-radius:2px;background:${a.c};flex:0 0 4px"></span>
        <div style="min-width:0"><div style="font-size:12px;font-weight:600">${a.t}</div><div class="tiny dim">${a.m}</div></div></div>`).join('');
      ma.querySelectorAll('.li').forEach(el => {
        const a = MOVE_ALERTS[+el.dataset.mi];
        bindTip(el, () => `<div style="font-weight:650;margin-bottom:3px">${a.t}</div><div style="opacity:.78">点击查看详情与处理入口</div>`);
        el.onclick = () => {
          const x = (a.acts || [])[0];
          const doAct = () => {
            if (x.mark) { ST.audit('流动预警核查', a.t, '数据看板-人员流动'); UIx.toast.ok('已标记核查完成并留痕'); return; }
            if (x.href) { setTimeout(() => { location.href = x.href; }, 60); return; }
            if (x.secondMove) { setTimeout(secondMoveModal, 80); return; }
            if (x.scroll) { const t = $(x.scroll); if (t) { const card = t.closest('.card'); card.scrollIntoView({ behavior: 'smooth', block: 'center' }); card.classList.remove('bd-flash'); void card.offsetWidth; card.classList.add('bd-flash'); UIx.toast.ok('已定位到「跨镇街流动明细」'); } }
          };
          UIx.modal({
            title: '流动预警详情', width: 500,
            body: `<div style="font-size:12.5px;font-weight:600;margin-bottom:6px">${esc(a.t)}</div>` +
              a.detail.rows.map(r => `<div class="row" style="font-size:12px;padding:4px 0;border-bottom:1px dashed var(--line)"><span class="dim" style="flex:0 0 60px">${r[0]}</span><span>${esc(r[1])}</span></div>`).join(''),
            okText: x ? x.b : '关闭', cancelText: '关闭',
            onOk: () => { doAct(); return true; }
          });
        };
      });
    }
    /* 分类别流动：数据行 + 行点击弹明细（合计与卡脚 7,087→7,118 / 流入 43 / 流出 12 对账） */
    const cf = $('catFlowBody');
    if (cf) {
      const CATF = [
        ['极高', 1254, 12, 2, '↗ ↗ →'],
        ['高', 2367, 15, 3, '↗ ↗ →'],
        ['中', 2486, 10, 4, '↗ → →'],
        ['低', 980, 6, 3, '→ ↗ →']
      ];
      cf.innerHTML = CATF.map(r => {
        const end = r[1] + r[2] - r[3], net = r[2] - r[3];
        return `<tr><td class="cell-main">${r[0]}</td><td class="r num">${r[1].toLocaleString()}</td><td class="r num" style="color:#1f8a53">${r[2]}</td><td class="r num" style="color:#d92d20">${r[3]}</td><td class="r num">${end.toLocaleString()}</td><td class="r num" style="color:${net > 0 ? '#d92d20' : '#1f8a53'};font-weight:600">${net > 0 ? '+' : ''}${net}</td><td class="tiny dim" style="text-align:center;letter-spacing:3px">${r[4]}</td></tr>`;
      }).join('');
      const rows = Array.from(cf.rows);
      rows.forEach(tr => {
        tr.style.cursor = 'pointer';
        const name = tr.cells[0].textContent.trim();
        bindTip(tr, () => `<div style="font-weight:650;margin-bottom:3px">${name}</div><div style="opacity:.78">点击查看该类流动明细</div>`);
        tr.onclick = () => catFlowModal(name);
      });
    }
    const bcd = $('btnCatDetail');
    if (bcd) bcd.onclick = () => catFlowModal(null);
    function catFlowModal(name) {
      const all = Array.from(cf.rows).map(tr => Array.from(tr.cells).map(c => c.textContent.trim()));
      const list = name ? all.filter(r => r[0] === name) : all;
      const CAT_META = {
        '极高': { key: 'high2', inSrc: '涉访升级 5 · 公安列管 4 · 评估上调 3', out: '撤管 0 · 迁出 2 · 死亡 0', act: '24 小时监护 · 每日见面（重点时期口径）', req: '等级调整须经政法委主管审批，材料附评估结论书' },
        '高': { key: 'high', inSrc: '评估上调 6 · 双在册转入 5 · 新列管 4', out: '撤管 1 · 迁出 2 · 死亡 0', act: '30 日走访时限 · 每周电话回访', req: '下调须附季度评估与走访记录，双向留痕' },
        '中': { key: 'mid', inSrc: '新列管 5 · 下调转入 3 · 区内迁入 2', out: '撤管 2 · 迁出 1 · 死亡 1', act: '月度走访 · RG-05 联动回访', req: '上调 / 下调均在「调整审批」追溯' },
        '低': { key: 'low', inSrc: '下调转入 4 · 新列管 2', out: '撤管 2 · 迁出 1 · 死亡 0', act: '季度走访 · 属地网格员日常关注', req: '连续 3 个月无异常可提请撤管' }
      };
      const lvTagHtml = k => { const L = D.levelOf(k); return '<span class="tag ' + L.cls.replace('tag-', 'tag-') + '">' + L.name + '</span>'; };
      const secHtml = r => {
        const m = CAT_META[r[0]] || null;
        if (!m) return '';
        const ps = (SCOPED ? MINE : D.persons).filter(p => p.level === m.key).slice(0, 3);
        return `<div style="margin:10px 0 0;padding-top:9px;border-top:1px dashed var(--line)">
          <div style="font-size:12.5px;font-weight:650;margin-bottom:5px">${esc(r[0])} · 本月流动构成</div>
          ${tipRow('流入来源', m.inSrc)}${tipRow('流出去向', m.out)}${tipRow('管控动作', m.act)}${tipRow('口径说明', m.req)}
          <div class="sect-title" style="margin:7px 0 4px">在册代表人员（按角色脱敏）</div>` +
          (ps.length ? ps.map(p => `<div class="li" style="padding:4px 0"><span class="mono tiny">${esc(fld(p, 'idNo'))}</span><span style="margin-left:8px">${esc(fld(p, 'name'))}</span><span class="spacer"></span><span class="tiny dim">${esc(p.town)} · ${esc(D.levelOf(p.level).name)}</span></div>`).join('') : '<div class="tiny dim">—</div>') +
          `<div class="row" style="margin-top:8px"><span class="spacer"></span><a class="btn btn-sm btn-ghost" href="persons.html?level=${encodeURIComponent(m.key)}" style="text-decoration:none">去人员台账（仅看${esc(r[0])}）›</a></div>
        </div>`;
      };
      UIx.modal({
        title: name ? '分类别流动明细 · ' + name : '分类别流动 · 全量明细', width: 640,
        body: `<table class="tb compact mini-tb"><thead><tr><th>类别</th><th class="r">期初</th><th class="r">流入</th><th class="r">流出</th><th class="r">期末</th><th class="r">净变化</th></tr></thead>
          <tbody>${list.map(r => `<tr><td class="cell-main">${esc(r[0])}</td><td class="r num">${r[1]}</td><td class="r num" style="color:var(--green)">${r[2]}</td><td class="r num" style="color:var(--red)">${r[3]}</td><td class="r num">${r[4]}</td><td class="r num" style="color:${String(r[5]).indexOf('-') === 0 ? 'var(--green)' : 'var(--red)'};font-weight:600">${r[5]}</td></tr>`).join('')}</tbody></table>
          ${list.map(secHtml).join('')}
          <div class="tiny dim" style="margin-top:8px">口径：流入 = 本月新增建档 / 转入；流出 = 撤管 / 迁出 / 死亡；区内迁移计入人次不计入净增。合计与左侧「本月净增 +31」一致。</div>`,
        okText: null, cancelText: '关闭'
      });
    }
    /* 跨镇街明细：行点击 + 全量弹窗 */
    const CROSS = [
      ['鼓楼街道', '果园街道', 5, '购房迁居', '已完成'], ['檀营地区', '鼓楼街道', 3, '租住变更', '已完成'],
      ['密云镇', '檀营地区', 2, '家庭并户', '移交中'], ['果园街道', '密云镇', 2, '工作调动', '已完成'],
      ['十里堡镇', '鼓楼街道', 2, '户籍迁移', '待确认'], ['河南寨镇', '巨各庄镇', 2, '投亲靠友', '已完成'],
      ['鼓楼街道', '西田各庄镇', 2, '回迁安置', '待确认']
    ];
    const cb = $('crossBody');
    if (cb) {
      cb.innerHTML = CROSS.map(r => `<tr>
        <td class="cell-main">${r[0]}</td><td>${r[1]}</td><td class="r num">${r[2]}</td><td class="dim">${r[3]}</td>
        <td class="c"><span class="tag ${r[4] === '已完成' ? 'tag-green' : r[4] === '移交中' ? 'tag-blue' : 'tag-amber'}">${r[4]}</span></td></tr>`).join('');
      cb.querySelectorAll('tr').forEach((tr, i) => {
        tr.style.cursor = 'pointer';
        const r = CROSS[i];
        bindTip(tr, () => `<div style="font-weight:650;margin-bottom:3px">${r[0]} → ${r[1]}</div>` + tipRow('人数', r[2] + ' 人') + tipRow('事由', r[3]) + tipRow('移交状态', r[4]) + `<div style="opacity:.78;margin-top:4px">点击看人员与移交时间线</div>`);
        tr.onclick = () => crossModal(r);
      });
    }
    function crossModal(r) {
      const ppl = (SCOPED ? MINE : D.persons).filter(p => p.town === r[0]).slice(0, r[2]);
      UIx.modal({
        title: `跨镇街流动 · ${r[0]} → ${r[1]}`, width: 500,
        body: tipRow('人数', r[2] + ' 人') + tipRow('主要事由', r[3]) + tipRow('移交状态', r[4]) +
          `<div class="sect-title" style="margin:9px 0 4px">涉及人员（按角色脱敏${SCOPED ? ' · 本部门' : ''}）</div>` +
          (ppl.length ? ppl.map(p => `<div class="li" style="padding:4px 0"><span>${esc(fld(p, 'name'))}</span><span class="mono tiny" style="margin-left:8px">${esc(fld(p, 'idNo'))}</span><span class="spacer"></span><span class="tiny dim">${D.levelOf(p.level).name}</span></div>`).join('') : '<div class="tiny dim">本部门暂无涉及该流动的人员记录</div>') +
          `<div class="sect-title" style="margin:9px 0 4px">移交时间线</div>
           <div class="tiny" style="line-height:1.8">① ${r[0]} 发起迁移申请 → ② 材料审核通过 → ③ ${r[1]} ${r[4] === '已完成' ? '已确认接收（走访任务已重派）' : r[4] === '移交中' ? '确认中（确认前仍由 ' + r[0] + ' 负责走访）' : '待确认（超 3 日将升级督办）'}</div>`,
        okText: null, cancelText: '关闭'
      });
    }
    /* 同一人 30 日内二次迁入：直接展示该预警涉及的逐人跨镇街明细
       —— 数据来自 D.movesOf()，与一人一档「跨镇街迁移」卡完全同源 */
    function secondMoveModal() {
      const list = (SCOPED ? MINE : D.persons).filter(p => D.hasSecondMove(p)).slice(0, 3);
      UIx.modal({
        title: '同一人 30 日内二次迁入 · 逐人明细', width: 780,
        sub: '预警口径：同一自然人在 30 天内发生 2 次及以上跨镇街迁入，需确认属地责任划分与并档结果 · 与一人一档「跨镇街迁移」卡同源',
        body: `<table class="tb compact mini-tb"><thead><tr><th>人员 / 属地</th><th>证件号</th><th>迁入链（按时间正序）</th><th class="r">最近间隔</th><th class="c">并档 / 移交</th></tr></thead>
          <tbody>${list.length ? list.map(p => {
            const ms = D.movesOf(p);
            const last = ms[ms.length - 1];
            const chain = ms.map(m => `<div class="tiny" style="line-height:1.75;white-space:nowrap"><span class="dim">${esc(m.outDate.slice(5))}</span> ${esc(m.from)} → <b>${esc(m.to)}</b><span class="dim"> · 迁入 ${esc(m.inDate.slice(5))}</span></div>`).join('');
            return `<tr>
              <td class="cell-main"><a href="person.html?id=${encodeURIComponent(p.id)}" style="color:var(--blue)">${esc(fld(p, 'name'))}</a><span class="cell-sub">${esc(p.town)}</span></td>
              <td class="mono tiny">${esc(fld(p, 'idNo'))}</td>
              <td>${chain}</td>
              <td class="r num">${last.gapFromPrev} 天</td>
              <td class="c"><span class="tag ${last.status === '已并档' ? 'tag-green' : last.status === '移交中' ? 'tag-blue' : 'tag-amber'}">${esc(last.status)}</span></td></tr>`;
          }).join('') : '<tr><td colspan="5" class="dim" style="text-align:center;padding:14px 0">本部门暂无 30 日内二次迁入记录</td></tr>'}</tbody></table>
          <div class="tiny dim" style="margin-top:8px;line-height:1.7">并档规则：以身份证号为唯一键，迁入即合并为同一档案，历史走访记录随档迁移；第二次迁入的属地责任由迁入地 3 个工作日内确认，确认前仍由迁出地负责走访。点击姓名进入一人一档，可在「跨镇街迁移」卡查看该人完整迁移链、移交单号与并档结果。</div>`,
        okText: '去人员台账核对', cancelText: '关闭',
        onOk: () => { setTimeout(() => { location.href = 'persons.html'; }, 60); return true; }
      });
    }

    const bca = $('btnCrossAll');
    if (bca) bca.onclick = () => {
      const all = SCOPED ? D.moveRows().filter(r => inScope(r.person)) : D.moveRows();
      if (SCOPED && !all.length) { UIx.toast.ok('本部门暂无跨镇街迁移记录'); return; }
      const rows = all.slice(0, 40);
      UIx.modal({
        title: `跨镇街流动 · 全量明细（${all.length} 人次${SCOPED ? ' · 本部门' : ''}）`, width: 800,
        sub: '与一人一档「跨镇街迁移」卡同源 · 姓名与证件号按当前角色脱敏',
        body: `<table class="tb compact mini-tb"><thead><tr><th>人员</th><th>证件号</th><th>迁出属地</th><th>迁出日</th><th>迁入属地</th><th>迁入日</th><th>事由</th><th class="c">移交状态</th></tr></thead>
          <tbody>${rows.map(({ p, m }) => `<tr>
            <td class="cell-main"><a href="person.html?id=${encodeURIComponent(p.id)}" style="color:var(--blue)">${esc(fld(p, 'name'))}</a></td>
            <td class="mono tiny">${esc(fld(p, 'idNo'))}</td>
            <td>${esc(m.from)}</td><td class="dim nowrap">${esc(m.outDate.slice(5))}</td>
            <td><b>${esc(m.to)}</b></td><td class="dim nowrap">${esc(m.inDate.slice(5))}</td>
            <td class="dim">${esc(m.reason)}</td>
            <td class="c"><span class="tag ${m.status === '已并档' ? 'tag-green' : m.status === '移交中' ? 'tag-blue' : 'tag-amber'}">${esc(m.status)}</span></td></tr>`).join('')}</tbody></table>
          <div class="tiny dim" style="margin-top:8px">共 ${all.length} 人次，此处展示前 ${rows.length} 条；点击姓名进入一人一档查看该人完整迁移链、移交单号与并档结果。</div>`,
        okText: null, cancelText: '关闭'
      });
    };
    /* 流动倾向洞察：点击弹窗 */
    const INSIGHT = [
      { tag: '吸聚', cls: 'tag-blue', t: '流入集中于果园（净 +3），单点承接 5 人', m: '城区片合计承接 66.7% 的区内迁移，需同步核实走访力量配比', rows: [['指数', '城区吸聚指数 1.42（＞1 为净吸聚）'], ['构成', '果园净 +3 · 鼓楼迁入 5 · 檀营迁入 2'], ['动因', '保障房交付 + 户政迁移，事由可解释度 100%'], ['建议', '果园街道 12 月前完成新增人员首轮见面']] },
      { tag: '外流', cls: 'tag-amber', t: '鼓楼（净 −2）、十里堡（净 −2）为主要净流出地', m: '鼓楼迁出主要转向果园与西田各庄，移交须双向确认，避免出现责任空档', rows: [['净流出', '鼓楼 −2 · 十里堡 −2'], ['去向', '果园 5 · 西田各庄 2'], ['风险', '移交待确认 2 件（鼓楼 → 西田等）'], ['建议', '11-15 前完成双向确认，逾期升级督办']] },
      { tag: '稳定', cls: 'tag-green', t: '密云镇由净流出转为进出持平（迁入 2 / 迁出 2）', m: '与 9 月安置房交付及户政迁移相关，属可解释波动', rows: [['现状', '迁入 2 / 迁出 2，净 0'], ['对照', '9 月净流出 −3 → 本月持平'], ['判定', '可解释波动，无需干预'], ['观察', '继续跟踪 12 月走向']] }
    ];
    const il = $('insightList');
    if (il) {
      il.innerHTML = INSIGHT.map((x, i) => `<div class="li" style="padding:6px 0;cursor:pointer" data-ii="${i}"><span class="tag ${x.cls}">${x.tag}</span>
        <div style="min-width:0"><div style="font-size:12px;font-weight:600">${x.t}</div><div class="tiny dim">${x.m}</div></div></div>`).join('');
      il.querySelectorAll('.li').forEach(el => {
        const x = INSIGHT[+el.dataset.ii];
        bindTip(el, () => `<div style="font-weight:650;margin-bottom:3px">${x.t}</div><div style="opacity:.78">点击看归纳依据与建议动作</div>`);
        el.onclick = () => UIx.modal({
          title: '流动倾向洞察 · ' + x.tag, width: 480,
          body: `<div style="font-size:12.5px;font-weight:600;margin-bottom:6px">${esc(x.t)}</div>` +
            x.rows.map(r => `<div class="row" style="font-size:12px;padding:4px 0;border-bottom:1px dashed var(--line)"><span class="dim" style="flex:0 0 52px">${r[0]}</span><span>${esc(r[1])}</span></div>`).join(''),
          okText: null, cancelText: '关闭'
        });
      });
    }
  }

  /* ============================================================
   * 区域迁徙
   * ============================================================ */
  function renderRegion() {
    /* 流向图：7 条 path 依序对应 */
    const FLOWS = [
      { from: '鼓楼街道', to: '果园街道', n: 5, why: '购房迁居', st: '已完成', c: '#0071e3' },
      { from: '鼓楼街道', to: '西田各庄镇', n: 2, why: '回迁安置', st: '待确认', c: '#0071e3' },
      { from: '檀营地区', to: '鼓楼街道', n: 3, why: '租住变更', st: '已完成', c: '#e8830c' },
      { from: '密云镇', to: '檀营地区', n: 2, why: '家庭并户', st: '移交中', c: '#e8830c' },
      { from: '果园街道', to: '密云镇', n: 2, why: '工作调动', st: '已完成', c: '#8f9aa8' },
      { from: '十里堡镇', to: '鼓楼街道', n: 2, why: '户籍迁移', st: '待确认', c: '#e8830c' },
      { from: '河南寨镇', to: '巨各庄镇', n: 2, why: '投亲靠友', st: '已完成', c: '#0071e3' }
    ];
    const fs = $('flowSvg');
    if (fs) {
      const paths = fs.querySelectorAll('path');
      paths.forEach((path, i) => {
        const f = FLOWS[i]; if (!f) return;
        path.style.cursor = 'pointer';
        path.addEventListener('mouseenter', () => { path.style.opacity = '1'; path.style.filter = 'drop-shadow(0 0 3px rgba(0,80,160,.5))'; });
        path.addEventListener('mouseleave', () => { path.style.opacity = ''; path.style.filter = ''; hideTip(); });
        bindTip(path, () => `<div style="font-weight:650;margin-bottom:3px">${f.from} → ${f.to}</div>` +
          tipRow('人数', f.n + ' 人') + tipRow('事由', f.why) + tipRow('移交', f.st) +
          `<div style="opacity:.78;margin-top:4px">点击看人员与时间线</div>`);
        path.onclick = () => { flowModal(f); };
      });
      function flowModal(f) {
        UIx.modal({
          title: `区域流动 · ${f.from} → ${f.to}`, width: 480,
          body: tipRow('人数', f.n + ' 人（近 30 天）') + tipRow('主要事由', f.why) + tipRow('移交状态', f.st) +
            `<div class="tiny dim" style="margin-top:8px">逐人明细见「人员流动 → 跨镇街流动明细」卡片，点击对应行可看人员与移交时间线。</div>`,
          okText: null, cancelText: '关闭'
        });
      }
    }
    /* 迁移类型与去向：hover tooltip */
    const MIG = [
      ['城区内部流动', 12, '两街道 + 檀营之间互迁，占 66.7%', '走访任务随属地即时重派'],
      ['城区 → 乡镇', 2, '鼓楼 → 西田各庄（回迁安置）', '移交待确认，确认前原属地负责'],
      ['乡镇 → 城区', 2, '十里堡 → 鼓楼（户籍迁移）', '移交待确认'],
      ['乡镇之间', 2, '河南寨 → 巨各庄（投亲靠友）', '已完成移交']
    ];
    const mc = $('migCat');
    if (mc) {
      mc.querySelectorAll('.cat-row').forEach((row, i) => {
        const m = MIG[i]; if (!m) return;
        bindTip(row, () => `<div style="font-weight:650;margin-bottom:3px">${m[0]}</div>` +
          tipRow('人数', m[1] + ' 人（' + (m[1] / 18 * 100).toFixed(0) + '%）') +
          tipRow('典型流向', m[2]) + `<div style="opacity:.78;margin-top:4px">${m[3]}</div>`);
      });
    }
    /* 近 12 周迁移人数：逐周悬浮明细（数值与柱高同源） */
    const WEEKS = [1, 3, 0, 2, 1, 2, 1, 0, 3, 2, 1, 2];
    const WNOTE = [
      '鼓楼 → 果园 1', '鼓楼 → 果园 3', '本周无迁移登记', '鼓楼 → 西田各庄 2（回迁安置）',
      '果园 → 密云镇 1', '檀营 → 鼓楼 2', '密云镇 → 檀营 1', '本周无迁移登记',
      '鼓楼 → 果园 2 · 十里堡 → 鼓楼 1', '河南寨 → 巨各庄 2', '果园 → 密云镇 1', '鼓楼 → 果园 1 · 十里堡 → 鼓楼 1'
    ];
    document.querySelectorAll('[data-panel="region"] .mm-c').forEach((el, i) => {
      const v = WEEKS[i] != null ? WEEKS[i] : 0;
      const prev = i > 0 ? WEEKS[i - 1] : null;
      const delta = prev == null ? '首周' : (v === prev ? '持平' : (v > prev ? '+' + (v - prev) : String(v - prev)));
      el.style.cursor = 'crosshair';
      bindTip(el, () => `<div style="font-weight:650;margin-bottom:3px">第 ${i + 1} 周（近 12 周）</div>` +
        tipRow('迁入登记', v + ' 人') +
        tipRow('环比', delta) +
        tipRow('主要流向', WNOTE[i] || '—') +
        `<div style="opacity:.78;margin-top:4px">近 12 周合计 18 人 · 峰值 3 人（第 2 / 9 周）</div>`);
    });

    /* 净流动排行：悬浮看迁入 / 迁出拆解与移交状态 */
    const RANKS = [
      { nm: '果园街道', net: 3, inN: 5, outN: 2, flow: '迁入自鼓楼 5 人（购房迁居）', st: '5 人移交已完成' },
      { nm: '西田各庄镇', net: 2, inN: 2, outN: 0, flow: '迁入自鼓楼 2 人（回迁安置）', st: '2 人移交待确认' },
      { nm: '巨各庄镇', net: 2, inN: 2, outN: 0, flow: '迁入自河南寨 2 人（投亲靠友）', st: '2 人移交已完成' },
      { nm: '檀营地区', net: -1, inN: 2, outN: 3, flow: '迁出至鼓楼 3 人 · 迁入自密云镇 2 人', st: '2 人移交中' },
      { nm: '鼓楼街道', net: -2, inN: 5, outN: 7, flow: '迁出至果园 5 · 西田各庄 2', st: '1 人次超期待确认' },
      { nm: '十里堡镇', net: -2, inN: 0, outN: 2, flow: '迁出至鼓楼 2 人（户籍迁移）', st: '2 人移交待确认' }
    ];
    document.querySelectorAll('[data-panel="region"] .rank-row').forEach((el, i) => {
      const r = RANKS[i]; if (!r) return;
      bindTip(el, () => `<div style="font-weight:650;margin-bottom:3px">${r.nm} · 净 ${r.net > 0 ? '+' : ''}${r.net}</div>` +
        tipRow('迁入', r.inN + ' 人') + tipRow('迁出', r.outN + ' 人') +
        tipRow('主要流向', r.flow) + tipRow('移交状态', r.st) +
        `<div style="opacity:.78;margin-top:4px">净流动 = 迁入 − 迁出（近 30 天）</div>`);
    });
  }

  /* ============================================================
   * 风险变化
   * ============================================================ */
  const LV12 = [
    { m: '25-12', a: 7, b: 6 }, { m: '26-01', a: 9, b: 8 }, { m: '26-02', a: 6, b: 5 },
    { m: '26-03', a: 11, b: 10 }, { m: '26-04', a: 8, b: 7 }, { m: '26-05', a: 6, b: 6 },
    { m: '26-06', a: 10, b: 9 }, { m: '26-07', a: 7, b: 7 }, { m: '26-08', a: 9, b: 10 },
    { m: '26-09', a: 5, b: 6 }, { m: '26-10', a: 8, b: 9 }, { m: '26-11', a: 19, b: 27 }
  ];
  const RISK_MIG = [
    { name: '高风险', from: 480, to: 486, segs: [['留高', 96, 'var(--red)'], ['转中', 2.5, 'var(--orange)'], ['转低', 1, 'var(--slate)'], ['转待核', 0.5, 'var(--amber)']] },
    { name: '中风险', from: 1716, to: 1704, segs: [['转高', 0.8, 'var(--red)'], ['留中', 96.3, 'var(--orange)'], ['转低', 2.2, 'var(--slate)'], ['转待核', 0.7, 'var(--amber)']] },
    { name: '低风险', from: 3203, to: 3226, segs: [['转高', 0.1, 'var(--red)'], ['转中', 0.8, 'var(--orange)'], ['留低', 98.3, 'var(--slate)'], ['转待核', 0.8, 'var(--amber)']] },
    { name: '待核实', from: 598, to: 612, segs: [['转高', 1.3, 'var(--red)'], ['转中', 2.3, 'var(--orange)'], ['转低', 5.7, 'var(--slate)'], ['留待核', 90.7, 'var(--amber)']] }
  ];
  const HI_SRC = [
    ['评估结论变更（卫健）', 8, '精防医生季度评估上调，附结论书', '8 人均附评估结论书 PDF', 'var(--red)', 100],
    ['涉访行为升级（信访）', 5, '信访事项中扬言 / 行为升级认定', '5 人附事件记录与派出所意见', 'var(--orange)', 63],
    ['新列管定级（公安）', 3, '本月新列管直接定级高风险', '3 人附《列管审批表》', '#0071e3', 38],
    ['矫正期间违规（司法）', 2, '社区矫正期间违规上调', '2 人附司法所违规记录', '#6b56c9', 25],
    ['其他 / 补录更正', 1, '历史数据补录更正', '1 人经政法委核准补录', 'var(--slate)', 13]
  ];
  function renderRisk() {
    const lc = $('lvlChart');
    if (lc) drawBars(lc, LV12, { base: 106.8, unit: 3, yMax: 30, yStep: 10, bw: 10, gapIn: 18, x0: 44, cA: '#d92d20', cB: '#1f8a53', line: false, every: 2, lA: '上调', lB: '下调', lNet: '净（升−降）', uA: '人', uB: '人', uNet: '人' });
    /* 风险序迁移 */
    const rm = $('riskMig');
    if (rm) {
      rm.innerHTML = RISK_MIG.map((r, i) => `
        <div class="row" style="font-size:11.5px;margin-bottom:6px"><span class="risk risk-${i + (i >= 1 ? 0 : 0)}">${r.name} ${r.from.toLocaleString()}</span><span class="spacer"></span><span class="risk risk-${i}">${r.to.toLocaleString()}</span></div>
        <div class="dv-bar" style="height:14px;margin-bottom:9px" data-rm="${i}">
          ${r.segs.map(s => `<i style="width:${s[1]}%;background:${s[2]}"></i>`).join('')}
        </div>`).join('');

      rm.querySelectorAll('.dv-bar').forEach(bar => {
        const r = RISK_MIG[+bar.dataset.rm];
        bar.querySelectorAll('i').forEach((seg, j) => {
          const s = r.segs[j];
          const n = Math.round(r.from * s[1] / 100);
          bindTip(seg, () => `<div style="font-weight:650;margin-bottom:3px">${r.name}（上月 ${r.from.toLocaleString()} 人）</div>` +
            tipRow(s[0], n + ' 人（' + s[1] + '%）'));
        });
      });
    }
    /* 高风险新增来源：渲染数据行 + hover + 点击 */
    const hs = $('hiSrcCat');
    if (hs) {
      hs.innerHTML = HI_SRC.map(h => `<div class="cat-row"><span class="nm">${h[0]}</span><span class="bar"><i style="width:${h[5]}%;background:${h[4]}"></i></span><span class="vl">${h[1]}</span></div>`).join('');
      hs.querySelectorAll('.cat-row').forEach((row, i) => {
        const h = HI_SRC[i]; if (!h) return;
        row.style.cursor = 'pointer';
        bindTip(row, () => `<div style="font-weight:650;margin-bottom:3px">${h[0]}</div>` + tipRow('人数', h[1] + ' 人') + `<div style="opacity:.78;margin-top:4px">${h[3]} · 点击看构成说明</div>`);
        row.onclick = () => UIx.modal({
          title: '高风险新增 · ' + h[0], width: 460,
          body: tipRow('本月上调', h[1] + ' 人（占 19 人的 ' + (h[1] / 19 * 100).toFixed(0) + '%）') +
            `<div class="tiny dim" style="margin:7px 0">认定口径：${h[2]}。${h[3]}。</div>
             <div class="tiny dim">全部经政法委主管审批后生效，可在「调整审批」页追溯对应申请单。</div>`,
          okText: '去审批台账', cancelText: '关闭',
          onOk: () => { setTimeout(() => { location.href = 'risk.html'; }, 60); return true; }
        });
      });
    }
    /* 风险变化告警：hover + 点击 + 深链（dept：未定级 90 天仅本部门） */
    const G90_LIST = D.unrated.filter(p => p.visitGap > 90 && inScope(p));
        const G90N = G90_LIST.length;
        const G90_DEPT = Object.entries(G90_LIST.reduce((m, p) => { m[p.dept] = (m[p.dept] || 0) + 1; return m; }, {}))
          .sort((a, b) => b[1] - a[1]).map(function (kv) { return kv[0] + ' ' + kv[1]; }).join(' · ') || '\u2014';
        const RISK_ALERTS = [
      { c: 'var(--red)', t: '鼓楼街道高风险月增 6 人，增幅 6.9%', m: '为全区最高，建议纳入下月重点督导', detail: [['口径', '高风险在册 87 → 93（+6）'], ['构成', '评估上调 3 · 涉访升级 2 · 新列管 1'], ['对照', '全区高风险本月净 ' + (486 - 480 >= 0 ? '+' : '') + (486 - 480)], ['建议', '纳入 12 月重点督导清单']], acts: [{ b: '去分析', href: 'analytics.html?focus=鼓楼街道' }] },
      { c: 'var(--orange)', t: '檀营地区 2 人连续上调，需核验评估材料', m: '两个月内中→高→极高，评估机构相同', detail: [['涉及', '马春霞（11-10 高→极高，待审批）· 陈志刚（11-05 中→高，已生效）'], ['疑点', '连续两月上调且评估机构相同，材料需复核'], ['已办', '已生成核验任务，政法委主管牵头'], ['关联', '点击「去核查」在变动台账高亮同名记录']], acts: [{ b: '去核查', href: 'risk.html?focus=檀营地区' }] },
      { c: 'var(--amber)', t: '未定级超 90 天 ' + G90N + ' 人', m: '集中在' + (G90_DEPT.split(' · ')[0] || '卫健') + '（拒访为主）', detail: [['规模', G90N + ' 人（全部在册 > 90 天未定级）'], ['分布', G90_DEPT], ['处置', '已全部进入盲区人群-未定级清单'], ['时限', '12 月底前完成定级或标注拒访']], acts: [{ b: '去盲区核查', href: 'blind.html?type=unknown&g90=90&sort=visit' }] }
    ];
    const ra = $('riskAlertList');
    if (ra) {
      ra.innerHTML = RISK_ALERTS.map((a, i) => `<div class="li" style="padding:7px 0;cursor:pointer" data-ri="${i}">
        <span class="lvl" style="width:4px;height:26px;border-radius:2px;background:${a.c};flex:0 0 4px"></span>
        <div style="min-width:0"><div style="font-size:12px;font-weight:600">${a.t}</div><div class="tiny dim">${a.m}</div></div></div>`).join('');
      ra.querySelectorAll('.li').forEach(el => {
        const a = RISK_ALERTS[+el.dataset.ri];
        bindTip(el, () => `<div style="font-weight:650;margin-bottom:3px">${a.t}</div><div style="opacity:.78">点击看数据构成与处理入口</div>`);
        el.onclick = () => UIx.modal({
          title: '风险变化告警 · 详情', width: 500,
          body: `<div style="font-size:12.5px;font-weight:600;margin-bottom:6px">${esc(a.t)}</div>` +
            a.detail.map(r => `<div class="row" style="font-size:12px;padding:4px 0;border-bottom:1px dashed var(--line)"><span class="dim" style="flex:0 0 52px">${r[0]}</span><span>${esc(r[1])}</span></div>`).join(''),
          okText: a.acts[0].b, cancelText: '关闭',
          onOk: () => { setTimeout(() => { location.href = a.acts[0].href; }, 60); return true; }
        });
      });
    }
    /* 等级调整明细：与 risk.html「待我审批」完全同源（同一排序、同一字段、同一 badge 口径） */
    const lb = $('lvlChgBody');
    if (lb) {
      const ORDER = { '待审批': 0, '退回补充': 1, '已通过': 2, '已驳回': 3 };
      const rows = STORE.approvals().slice()
        .filter(a => inScope(D.personById(a.personId)) || (!SCOPED && !a.personId))
        .sort((a, b) => (ORDER[a.status] - ORDER[b.status]) || b.time.localeCompare(a.time))
        .map(a => {
          const p = D.personById(a.personId);
          const up = D.levelOf(a.toLevel).order < D.levelOf(a.curLevel).order;
          const badge = a.status === '待审批'
            ? (a.urgent ? '<span class="tag tag-red">需双人复核</span>' : '<span class="tag tag-green">依据齐全</span>')
            : `<span class="tag ${a.status === '已通过' ? 'tag-green' : a.status === '已驳回' ? 'tag-red' : 'tag-amber'}">${esc(a.status)}</span>`;
          return {
            a, up, badge,
            name: a.name,
            town: a.town || (p && p.town) || '—',
            tag0: (p && p.tags && p.tags[0]) || '',
            dept: a.applicantDept || '—',
            time: (a.time || '').slice(5),
            from: a.curLevel, to: a.toLevel,
            why: (a.reason || '属地申请').slice(0, 18) + ((a.reason || '').length > 18 ? '…' : '')
          };
        });
      lb.innerHTML = rows.map((r, i) => `<tr data-lr="${i}">
        <td class="cell-main">${esc(r.name)}<span class="cell-sub">${esc(r.town)}${r.tag0 ? ' · ' + esc(r.tag0) : ''}</span></td>
        <td class="tiny">${esc(r.dept)}<span class="cell-sub">${esc(r.time)} · ${r.up ? '上调' : '下调'}</span></td>
        <td class="c">${lvTag(r.from)} <span class="tiny dim">→</span> ${lvTag(r.to)}</td>
        <td class="dim">${esc(r.why)}</td>
        <td class="c">${r.badge}</td></tr>`).join('');
      lb.querySelectorAll('tr').forEach((tr, i) => {
        tr.style.cursor = 'pointer';
        const r = rows[i];
        bindTip(tr, () => `<div style="font-weight:650;margin-bottom:3px">${esc(r.name)} · ${esc(r.town)}</div>` +
          tipRow('调整', SHORT[r.from] + ' → ' + SHORT[r.to]) + tipRow('申请', r.dept + ' · ' + r.time) +
          tipRow('依据', r.a.reason || '—') + tipRow('状态', r.a.status) + `<div style="opacity:.78;margin-top:4px">点击看申请单详情（与审批台账同源）</div>`);
        tr.onclick = () => {
          const a = r.a;
          UIx.modal({
            title: '等级调整申请 · ' + a.id, width: 520,
            body: tipRow('人员', esc(a.name) + '（' + esc(r.town) + '）') + tipRow('调整', SHORT[a.curLevel] + ' → ' + SHORT[a.toLevel]) +
              tipRow('申请人', esc(a.applicant || '—') + ' · ' + esc(a.applicantDept || '—')) + tipRow('时间', esc(a.time || '—')) +
              `<div class="sect-title" style="margin:8px 0 4px">申请理由</div><div class="tiny" style="line-height:1.7">${esc(a.reason || '—')}</div>
               <div class="sect-title" style="margin:8px 0 4px">附件（${(a.evidence || []).length}）</div><div class="tiny dim">${(a.evidence || []).map(esc).join(' · ') || '—'}</div>`,
            okText: '去审批处理', cancelText: '关闭',
            onOk: () => { setTimeout(() => { location.href = 'risk.html'; }, 60); return true; }
          });
        };
      });
    }
    /* 调整后 30 日跟踪：点击弹窗 */
    const TRACK = [
      { tag: '上调', cls: 'tag-red', t: '19 人中 17 人已完成上调后首次见面', m: '未完成 2 人（檀营、石城各 1）已标记需督办，限 3 日内完成', rows: [['完成率', '17 / 19（89.5%）'], ['未完成', '檀营 1 人（拒访）· 石城 1 人（外出务工）'], ['需督办', '2 人（仅呈现，不下发）'], ['口径', '与重点时期「20 镇街见面进度」同源']] },
      { tag: '下调', cls: 'tag-green', t: '27 人中 25 人走访频次已由月度调整为季度', m: '余 2 人因缓刑考验期内，维持月度走访', rows: [['完成率', '25 / 27（92.6%）'], ['维持月度', '缓刑考验期内 2 人（司法所要求）'], ['回访', '下调后 7 日内随访由 RG-05 监控'], ['口径', '与预警规则 RG-05 联动']] }
    ];
    const tl = $('trackList');
    if (tl) {
      tl.innerHTML = TRACK.map((x, i) => `<div class="li" style="padding:6px 0;cursor:pointer" data-ti="${i}"><span class="tag ${x.cls}">${x.tag}</span>
        <div style="min-width:0"><div style="font-size:12px;font-weight:600">${x.t}</div><div class="tiny dim">${x.m}</div></div></div>`).join('');
      tl.querySelectorAll('.li').forEach(el => {
        const x = TRACK[+el.dataset.ti];
        bindTip(el, () => `<div style="font-weight:650;margin-bottom:3px">${x.t}</div><div style="opacity:.78">点击看跟踪明细</div>`);
        el.onclick = () => UIx.modal({
          title: '调整后 30 日跟踪 · ' + x.tag, width: 480,
          body: `<div style="font-size:12.5px;font-weight:600;margin-bottom:6px">${esc(x.t)}</div>` +
            x.rows.map(r => `<div class="row" style="font-size:12px;padding:4px 0;border-bottom:1px dashed var(--line)"><span class="dim" style="flex:0 0 64px">${r[0]}</span><span>${esc(r[1])}</span></div>`).join(''),
          okText: null, cancelText: '关闭'
        });
      });
    }
  }

  /* ============================================================
   * 报送质量：数据质量规则（与 system?tab=config 同源 DATA.DQ_RULES）
   * ============================================================ */
  function renderQuality() {
    const dq = $('dqBody');
    if (dq) {
      dq.innerHTML = STORE.dqRules().map(r => `<tr data-dq="${r.code}" style="cursor:pointer">
        <td class="mono tiny">${r.code}</td><td>${esc(r.desc)}</td>
        <td class="num" style="color:${r.hit ? (r.act === '拦截' ? 'var(--red);font-weight:600' : 'var(--orange)') : 'inherit'}">${r.hit}</td>
        <td><span class="tag ${r.hit ? (r.act === '拦截' ? 'tag-red' : 'tag-amber') : 'tag-green'}">${r.hit ? r.act : '通过'}</span></td></tr>`).join('');
      dq.querySelectorAll('tr').forEach(tr => {
        const r = STORE.dqRules().find(x => x.code === tr.dataset.dq);
        bindTip(tr, () => `<div style="font-weight:650;margin-bottom:3px">${r.code} ${r.name}</div>` + tipRow('本期命中', r.hit + ' 条') + tipRow('处置', r.act) + `<div style="opacity:.78;margin-top:4px">点击看命中明细 · 参数在系统管理可配</div>`);
        tr.onclick = () => UIx.modal({
          title: r.code + ' ' + r.name, width: 460,
          body: tipRow('校验内容', esc(r.desc)) + tipRow('本期命中', r.hit + ' 条') + tipRow('处置方式', r.act) +
            `<div class="sect-title" style="margin:8px 0 4px">命中明细（模拟${SCOPED ? ' · 本部门' : ''}）</div>` +
            (r.hit ? (SCOPED ? MINE : D.persons).slice(0, r.hit).map(p => `<div class="li" style="padding:4px 0"><span class="mono tiny">${esc(fld(p, 'idNo'))}</span><span class="tiny dim" style="margin-left:8px">${esc(p.town)} · 待修正队列</span></div>`).join('') : '<div class="tiny dim">本期无命中记录</div>'),
          okText: '去规则参数', cancelText: '关闭',
          onOk: () => { setTimeout(() => { location.href = 'system.html?tab=config'; }, 60); return true; }
        });
      });
    }
  }

  /* ---------- 启动 ---------- */
  const style = document.createElement('style');
  style.textContent = `
    /* 实时动态自动滚动（悬浮暂停） */
    .feed-track { display: flex; flex-direction: column; animation: bdFeedScroll 32s linear infinite; }
    .feed:hover .feed-track { animation-play-state: paused; }
    @keyframes bdFeedScroll { from { transform: translateY(0); } to { transform: translateY(-50%); } }

    /* ===== 消除卡片底部空白：卡片纵向 flex 化，内容区自适应撑满 ===== */
    body.fit [data-panel] > .split-73 > .card,
    body.fit [data-panel] > .split-64 > .card,
    body.fit [data-panel] > .split-46 > .card,
    body.fit [data-panel] .stack > .card,
    body.fit [data-panel] > .split-64 > .stack > .card { display: flex; flex-direction: column; min-height: 0; }
    body.fit [data-panel] .card > .card-bd { flex: 1 1 0; min-height: 0; overflow: auto; }
    body.fit [data-panel] .card > .card-ft { flex: 0 0 auto; }
    /* 列表类内容纵向均布 */
    body.fit [data-panel="rt"] .split-64 .card-bd { display: flex; flex-direction: column; justify-content: space-evenly; }
    /* watch 右列：内容贴标题、条目均分撑满（消除最久未见面顶部空白） */
    body.fit [data-panel="watch"] .stack .card-bd { display: flex; flex-direction: column; justify-content: flex-start; }
    body.fit [data-panel="watch"] #longestList { flex: 1 1 0; min-height: 0; display: flex; flex-direction: column; }
    body.fit [data-panel="watch"] #longestList > .li { flex: 1 1 0; min-height: 0; display: flex; flex-direction: row; align-items: center; justify-content: flex-start; }
    body.fit [data-panel="watch"] #zgGrid { flex: 0 0 auto; }
    /* 表格高度拉伸占满（20 镇街进度 20 行均分） */
    body.fit [data-panel="watch"] > .split-73 > .card table.mini-tb { height: 100%; }
    /* move 小表：行距加大 + 表格拉伸填满（消除上方 / 底部空白，行高均分） */
    body.fit [data-panel="move"] table.mini-tb td { padding: 8px 9px; }
    body.fit [data-panel="move"] table.mini-tb th { padding: 6px 9px; }
    body.fit [data-panel="move"] .card.c-cat > .card-bd { display: flex; flex-direction: column; justify-content: stretch; overflow: auto; }
    body.fit [data-panel="move"] .card.c-cat > .card-bd > table { margin: 0; height: 100%; flex: 1 1 auto; }
    /* 表格类：表体内部滚动，卡头卡脚固定 */
    body.fit [data-panel="watch"] > .split-73 > .card .card-bd { display: flex; flex-direction: column; }
    body.fit [data-panel="watch"] > .split-73 > .card .table-wrap { flex: 1 1 0; min-height: 0; overflow: auto; }
    /* 图表类 SVG 随卡高度拉伸（viewBox + none/keep 已按需设置） */
    body.fit [data-panel="rt"] .split-73 > .card > .card-bd > svg,
    body.fit [data-panel="move"] .c-chart > .card-bd > svg,
    body.fit [data-panel="risk"] .split-64 > .card > .card-bd > svg { height: 100%; width: 100%; min-height: 140px; }
    body.fit [data-panel="region"] #flowSvg { height: 100%; min-height: 0; flex: 1 1 0; }
    /* region：内容均布填满 + 防溢出 */
    body.fit [data-panel="region"] .card > .card-bd { display: flex; flex-direction: column; justify-content: space-evenly; overflow: auto; }
    body.fit [data-panel="region"] .card > .card-bd > svg { flex: 1 1 0; min-height: 0; }
    body.fit [data-panel="region"] .rank-row { flex: 0 0 auto; }
    /* move：列表卡均布填满（流入来源/流动预警/洞察） */
    body.fit [data-panel="move"] .split-64 .card > .card-bd,
    body.fit [data-panel="move"] .c-src > .card-bd { display: flex; flex-direction: column; justify-content: space-evenly; overflow: auto; }
    body.fit [data-panel="move"] #srcCat > .cat-row { flex: 0 0 auto; }
    /* rt：系统与任务状态 4 stat 拉伸填满 */
    body.fit [data-panel="rt"] .split-64 .card:last-child > .card-bd { display: flex; }
    body.fit [data-panel="rt"] .split-64 .card:last-child .grid.g2 { flex: 1 1 0; height: 100%; grid-template-rows: 1fr 1fr; align-content: stretch; }
    body.fit [data-panel="rt"] .mini-stat { display: flex; flex-direction: column; justify-content: center; }
    body.fit [data-panel="risk"] .card.c-lvlchg > .card-bd { overflow-y: auto; }
    body.fit [data-panel="risk"] .card.c-lvlchg > .card-bd thead th { position: sticky; top: 0; z-index: 2; background: #fff; }
    /* 深链定位闪烁高亮 */
    @keyframes bdFlash { 0%,100% { box-shadow: 0 0 0 0 rgba(0,113,227,0); } 30% { box-shadow: 0 0 0 3px rgba(0,113,227,.45); } }
    .bd-flash { animation: bdFlash 1.6s ease 2; border-radius: 10px; }
    body.fit [data-panel="quality"] .split-46 > .card > .card-bd > svg { height: 100%; min-height: 110px; }
    /* 实时总览右列三卡与左列图表等高 */
    body.fit [data-panel="rt"] > .split-73 { min-height: 0; }
    body.fit [data-panel="rt"] > .split-64 { min-height: 0; }
    body.fit [data-panel="rt"] .split-73 > .card > .card-bd { display: flex; flex-direction: column; }
    body.fit [data-panel="rt"] .feed { flex: 1 1 0; min-height: 0; max-height: none; overflow: hidden; }
    body.fit [data-panel="rt"] #rtHeat { align-content: space-evenly; flex: 0 0 auto; }
  `;
  document.head.appendChild(style);

  renderTodo(); renderFeed(); renderRtChart(); renderWatch(); renderMove(); renderRegion(); renderRisk(); renderQuality();
})();
