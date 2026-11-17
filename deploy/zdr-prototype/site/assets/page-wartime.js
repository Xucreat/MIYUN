/* ============================================================
   page-wartime.js · 重点时期管控
   ------------------------------------------------------------
   数据链（单一来源，逐人可下钻）：
     DATA.wartime.tasks      镇街应见/已见/未见面基线（应见 = 该镇街台账全员封顶，合计 408）
     DATA.wartimeRows(town)  逐人基线行（前 missing 人为未见面，原因按 14/9/8/6/7 确定性分配）
     STORE.wtRows(town)      叠加本会话回填结果
     STORE.wtReasons()       未见面原因分布（卡片 / 悬浮 / 点击弹窗 / 导出共用）
     STORE.wtStats()         页头 KPI 与页脚合计
   所有数字都从同一份人员集合推导：回填一个人 → 已见 +1、未见面 -1、原因分布 -1，无第二份账。
   ============================================================ */
(function () {
  'use strict';
  const esc = UI.esc;
  const D = window.DATA;
  const S = window.STORE;
  const body = document.getElementById('streetBody');
  if (!body || !S) return;

  const roleKey = () => S.role().key;
  const nmOf = p => D.field(roleKey(), 'name', p).text;
  const UNSEEN_SIZE = 6;
  let unseenPage = 1;
  let CUT = { overdue: false, due: '08:00' };   // 零报告截止判定（renderTable 每次刷新）

  /* ---------- 页头时期横幅：起止 / 天数 / 响应等级全部取 STORE.wtCfg ---------- */
  function paintHero() {
    const c = S.wtCfg();
    const per = S.wtPeriod();
    const eff = S.wtEffective();
    const set = (id, v) => { const n = document.getElementById(id); if (n && v != null) n.textContent = v; };
    set('phTitle', c.title);
    set('phBadge', eff.levelName + '响应 · 进行中');
    const visitTxt = eff.visitLimit === 1 ? '每日见面' : '每 ' + eff.visitLimit + ' 日见面';
    set('phSub', per.start + ' 至 ' + per.end + ' · 共 ' + per.days + ' 天 · 第 ' + per.dayNow + ' 天 · ' +
      visitTxt + ' · 零报告截止 ' + eff.reportDue);
    const pct = per.days ? (per.dayNow / per.days * 100) : 0;
    set('phProgTxt', per.dayNow + ' / ' + per.days + ' 天（' + pct.toFixed(1) + '%）');
    const bar = document.getElementById('phProgBar');
    if (bar) bar.style.width = pct.toFixed(1) + '%';
  }

  /* ---------- 镇街回填表 ---------- */
  function rateColor(r) {
    return r >= 95 ? 'var(--green)' : r >= 86 ? 'var(--blue)' : r >= 80 ? 'var(--orange)' : 'var(--red)';
  }

  function rowHTML(t, i) {
    const rate = t.should ? (t.met / t.should) * 100 : 0;
    /* 回填列只看「逐人明细是否提交」，与零报告是否上报互不影响 */
    const fillCell = t.filled
      ? `<span class="zero-chip"><i></i><a href="javascript:;" data-view="${esc(t.town)}" style="color:var(--blue)">已回填 ${esc(t.fillAt || '')}</a></span>` +
        `<a href="javascript:;" data-fill="${esc(t.town)}" class="tiny dim" style="margin-left:4px">修正</a>`
      : `<span class="zero-chip ${t.reported ? 'warn' : 'miss'}"><i></i>` +
        `<a href="javascript:;" data-fill="${esc(t.town)}" style="color:${t.reported ? '#8a6100' : 'var(--blue)'};margin-left:2px">` +
        `${t.reported ? '待补明细' : '未填报'}</a></span>`;
    /* 零报告列只看零报告是否上报，与逐人明细是否回填互不影响。
       已过「零报告截止」仍未报 → 直接标逾期，这是截止时刻的真实联动。 */
    const zeroCell = t.reported
      ? `<span class="zero-chip"><i></i>已报${t.reportAt ? ' ' + esc(t.reportAt) : ''}</span>`
      : (CUT.overdue
        ? `<span class="zero-chip miss"><i></i><a href="javascript:;" data-zero="${esc(t.town)}" style="color:var(--red)">未报 · 已逾期</a></span>`
        : `<span class="zero-chip miss"><i></i><a href="javascript:;" data-zero="${esc(t.town)}" style="color:var(--red)">未报</a></span>`);
    return `<tr data-town="${esc(t.town)}">
      <td class="dim num">${i + 1}</td>
      <td>${esc(t.town)}</td>
      <td class="r num">${t.should}</td>
      <td class="r num strong">${t.met}</td>
      <td class="r num"${t.missing > 0 ? ' style="color:var(--red)"' : ''}>${t.missing}</td>
      <td><div class="rate"><span class="bar"><i style="width:${rate.toFixed(1)}%;background:${rateColor(rate)}"></i></span><span class="tiny num">${rate.toFixed(1)}%</span></div></td>
      <td>${fillCell}</td>
      <td>${zeroCell}</td>
    </tr>`;
  }

  function renderTable() {
    const list = S.wtTasks();
    CUT = S.wtCutoff();
    body.innerHTML = list.map(rowHTML).join('');
    body.querySelectorAll('[data-fill]').forEach(a => { a.onclick = e => { e.stopPropagation(); openFill(a.dataset.fill); }; });
    body.querySelectorAll('[data-view]').forEach(a => { a.onclick = e => { e.stopPropagation(); openDetail(a.dataset.view); }; });
    body.querySelectorAll('[data-zero]').forEach(a => {
      a.onclick = e => {
        e.stopPropagation();
        const town = a.dataset.zero;
        if (!window.guard('edit', '补报零报告')) return;
        const rec = S.wtSetZero(town, true);
        render();
        UI.toast.ok(town + ' 零报告已补报' + (rec && rec.rows
          ? '（逐人明细保持原样）'
          : '（仅补报零报告，「回填」列仍需提交逐人明细）'));
      };
    });
    body.querySelectorAll('tr[data-town]').forEach(tr => {
      tr.style.cursor = 'pointer';
      tr.onclick = () => openFill(tr.dataset.town);
    });
  }

  function paintStats() {
    const s = S.wtStats();
    const set = (id, v) => { const n = document.getElementById(id); if (n) n.textContent = v; };
    set('phShould', s.should);
    set('phMet', s.met);
    set('phMiss', s.missing);
    set('phRate', s.rate.toFixed(1) + '%');
    set('phZero', `${s.reported} / ${s.total} 个镇街`);
    const bar = document.getElementById('phZeroBar');
    if (bar) bar.style.width = (s.reported / s.total * 100).toFixed(0) + '%';

    const tag = document.getElementById('wtNotRep');
    if (tag) {
      if (s.notReported === 0) { tag.className = 'tag tag-green'; tag.textContent = '全部镇街已报'; }
      else { tag.className = 'tag tag-red'; tag.textContent = `${s.notReported} 镇街未报`; }
    }
    const foot = document.getElementById('wtFoot');
    if (foot) foot.textContent = `合计：应见 ${s.should} · 已见 ${s.met} · 未见面 ${s.missing} · 见面率 ${s.rate.toFixed(1)}%（已逐人回填 ${s.filled} / ${s.total} 镇街）`;

    set('wtZeroTag', `${s.reported} / ${s.total}`);
    set('wtRepN', `${s.reported} 个镇街`);
    set('wtNotN', `${s.notReported} 个镇街`);
    const repBar = document.getElementById('wtRepBar');
    if (repBar) repBar.style.width = (s.reported / s.total * 100).toFixed(0) + '%';
    const notBar = document.getElementById('wtNotBar');
    if (notBar) notBar.style.width = (s.notReported / s.total * 100).toFixed(0) + '%';
    const chips = document.getElementById('wtChips');
    if (chips) {
      const miss = S.wtTasks().filter(t => !t.reported).map(t => t.town);
      chips.innerHTML = miss.length
        ? miss.map(n => `<span class="tag tag-amber" style="height:19px">${esc(n)}</span>`).join('')
        : '<span class="tag tag-green" style="height:19px">全部镇街已提交</span>';
    }
    ['btnPush', 'btnPush2', 'btnSecPush'].forEach(id => {
      const b = document.getElementById(id);
      if (b) b.disabled = s.notReported === 0 && id !== 'btnSecPush';
    });
  }

  /* ---------- 未见面原因分布：悬浮看口径 + 点击看人 ---------- */
  function renderReasons() {
    const box = document.getElementById('reasonBox');
    if (!box) return;
    const list = S.wtReasons();
    const total = list.reduce((a, r) => a + r.count, 0);
    const max = Math.max(1, ...list.map(r => r.count));
    const set = (id, v) => { const n = document.getElementById(id); if (n) n.textContent = v; };
    set('rsTotal', total + ' 人');

    const refuse = list.find(r => r.key === 'refuse') || { count: 0 };
    const lost = list.find(r => r.key === 'lost') || { count: 0 };
    const hosp = list.find(r => r.key === 'hospital') || { count: 0 };
    const overdue = list.reduce((a, r) => a + r.overdue, 0);
    const sup = list.reduce((a, r) => a + r.supervise, 0);

    box.innerHTML = list.map(r => `
      <div class="cat-row" data-rs="${r.key}" title="点击查看该原因下的人员明细"
           style="grid-template-columns:66px 1fr 34px">
        <span class="nm">${esc(r.name)}</span>
        <span class="bar"><i style="width:${(r.count / max * 100).toFixed(0)}%;background:${r.color}"></i></span>
        <span class="vl">${r.count}</span>
      </div>`).join('') +
      `<div class="divider" style="margin:9px 0 7px"></div>
       <div class="note">拒访 + 失联合计 <b>${refuse.count + lost.count}</b> 人，已纳入「失访/拒访」预警统计供统筹研判；
       住院治疗 <b>${hosp.count}</b> 人凭诊断材料视同已见面；复访已到期 <b>${overdue}</b> 人，其中需督办 <b>${sup}</b> 人。
       点击任一原因可查看具体人员。</div>`;

    box.querySelectorAll('[data-rs]').forEach(n => {
      const r = list.find(x => x.key === n.dataset.rs);
      if (!r) return;
      UI.tip(n, () => `<div class="tt">${esc(r.name)} · ${r.count} 人（${r.pct}%）</div>
        <div class="dim2" style="margin-bottom:4px">${esc(r.desc)}</div>
        <div class="kv-row"><span>涉及镇街</span><b>${r.towns.length} 个</b></div>
        <div class="kv-row"><span>人数最多</span><b>${r.towns.slice(0, 3).map(t => t.town + ' ' + t.n).join('、') || '—'}</b></div>
        <div class="kv-row"><span>复访已到期</span><b>${r.overdue} 人</b></div>
        <div class="kv-row"><span>需督办</span><b>${r.supervise} 人</b></div>
        <div class="hr"></div><div class="dim2">点击查看该原因下的人员明细与联系方式</div>`);
      n.onclick = () => openReason(r.key);
    });
  }

  /* ---------- 响应等级 ---------- */
  function renderLevels() {
    const cur = S.wtLevel();
    const list = S.wtLevels();
    const tb = document.getElementById('lvBody');
    if (tb) {
      tb.innerHTML = list.map(l => `<tr${l.key === cur.key ? ' style="background:var(--blue-soft)"' : ''}>
        <td><span class="tag ${l.color}">${esc(l.name)}</span></td>
        <td>${esc(l.visit)} · ${esc(l.report)}</td>
        <td class="r tiny">${esc(l.scopeText)}</td>
      </tr>`).join('');
    }
    const tag = document.getElementById('lvTag');
    if (tag) { tag.className = 'tag ' + cur.color; tag.textContent = cur.name + '响应'; }
    /* 生效等级的具体参数：让「勾选生效 → 全站按该等级计算」看得见 */
    const note = document.getElementById('lvNote');
    if (note) {
      const eff = S.wtEffective();
      note.textContent = `当前生效：${eff.levelName}响应 · 见面每 ${eff.visitLimit} 日 · 报告每 ${eff.reportEvery} 日 · ` +
        `截止 ${eff.reportDue} · 催办 ${eff.escalateHours} 小时`;
    }
  }

  /* ---------- 应见未见清单 ---------- */
  function unseenList() {
    return S.wtAllRows().filter(r => r.status === 'miss').map(r => {
      const p = D.personById(r.personId);
      const reason = D.WT_REASON_OF[r.reason] || D.WT_REASONS[4];
      return { row: r, person: p, town: r.town, reason };
    }).sort((a, b) => b.person.visitGap - a.person.visitGap);
  }

  function renderUnseen(page) {
    const tb = document.getElementById('unseenBody');
    if (!tb) return [];
    const list = unseenList();
    const eff = S.wtEffective();
    const pages = Math.max(1, Math.ceil(list.length / UNSEEN_SIZE));
    const cur = Math.min(Math.max(1, page), pages);
    unseenPage = cur;
    tb.innerHTML = list.slice((cur - 1) * UNSEEN_SIZE, cur * UNSEEN_SIZE).map(r => {
      const p = r.person;
      const lv = D.levelOf(S.levelOf(p));
      /* 见面时限取自当前生效等级/时期：超过时限的才算超期，不再是写死的 30 天 */
      const over = p.visitGap - eff.visitLimit;
      const tag0 = (p.tags && p.tags[0] ? p.tags[0] : '重点人员').split('·')[0].trim();
      const riskCls = lv.order <= 1 ? 'risk-1' : lv.order === 2 ? 'risk-3' : 'risk-4';
      return `<tr data-pid="${esc(p.id)}">
        <td><span class="cell-main">${esc(nmOf(p))}</span></td>
        <td><span class="tag tag-slate">${esc(tag0)}</span></td>
        <td><span class="risk ${riskCls}">${esc(lv.name)}</span></td>
        <td>${esc(r.town)}</td>
        <td class="r" style="color:${over > 0 ? 'var(--red)' : 'var(--t3)'};font-weight:${over > 0 ? 600 : 400}">${over > 0 ? '超期 ' + over + ' 天' : '未超期'}</td>
        <td class="dim">${esc(r.reason.name)} · 距上次见面 ${p.visitGap} 天（时限 ${eff.visitLimit} 天） · 复访 ${esc(r.row.due || '—')}</td>
        <td class="r">${r.row.supervise ? '<span class="tag tag-red" style="height:17px">需督办</span>' : '<span class="dim">—</span>'}</td>
      </tr>`;
    }).join('') || `<tr><td colspan="7"><div class="ui-empty"><b>本期无未见面人员</b>全部应见人员均已回填为已见面</div></td></tr>`;

    tb.querySelectorAll('tr[data-pid]').forEach(tr => {
      tr.style.cursor = 'pointer';
      tr.onclick = () => openPerson(tr.dataset.pid);
    });

    const card = tb.closest('.card');
    const pager = card ? card.querySelector('.pager') : null;
    if (pager) {
      let btns = `<button class="pg-btn" data-p="${cur - 1}" ${cur === 1 ? 'disabled' : ''}>‹</button>`;
      for (let i = 1; i <= pages; i++) btns += `<button class="pg-btn${i === cur ? ' on' : ''}" data-p="${i}">${i}</button>`;
      btns += `<button class="pg-btn" data-p="${cur + 1}" ${cur === pages ? 'disabled' : ''}>›</button>`;
      pager.innerHTML = `<span>共 ${list.length} 条 · 第 ${cur}/${pages} 页</span><span class="spacer"></span>${btns}`;
    }
    const cnt = document.getElementById('unseenCount');
    if (cnt) cnt.textContent = list.length + ' 人';
    return list;
  }

  function render() {
    paintHero();
    renderTable();
    paintStats();
    renderReasons();
    renderLevels();
    renderUnseen(unseenPage);
  }

  /* ============================================================
     逐人回填
     ============================================================ */
  function openFill(town) {
    if (!window.guard('edit', '回填见面情况')) return;
    const task = S.wtTasks().find(t => t.town === town);
    if (!task) return;
    const draft = {};
    S.wtRows(town).forEach(r => { draft[r.personId] = Object.assign({}, r); });
    const persons = {};
    S.wtRows(town).forEach(r => { persons[r.personId] = D.personById(r.personId); });

    const Q = { filter: 'all', kw: '' };

    function visible() {
      return Object.keys(draft).filter(id => {
        const r = draft[id];
        if (Q.filter === 'met' && r.status !== 'met') return false;
        if (Q.filter === 'miss' && r.status !== 'miss') return false;
        if (Q.kw && (persons[id].name + persons[id].no).indexOf(Q.kw) < 0) return false;
        return true;
      });
    }

    function trHTML(id, i) {
      const r = draft[id], p = persons[id];
      const lv = D.levelOf(S.levelOf(p));
      const met = r.status === 'met';
      const tags = (p.tags || []).map(t => `<span class="tag tag-line" style="height:16px;font-size:10px">${esc(t)}</span>`).join(' ');
      const metBox = met
        ? `<div class="fill-grid">
             <div class="select sm" data-f="way">${esc(r.way || D.WT_WAYS[0])}</div>
             <div class="select sm" data-f="target">${esc(r.target || D.WT_TARGETS[0])}</div>
             <input class="tin" data-f="at" value="${esc(r.at || '')}" placeholder="见面时间">
             <div class="select sm" data-f="result">${esc(r.result || D.WT_RESULTS[0])}</div>
           </div>`
        : `<div class="fill-grid">
             <div class="select sm" data-f="reason">${esc((D.WT_REASON_OF[r.reason] || D.WT_REASONS[0]).name)}</div>
             <input class="tin" data-f="due" value="${esc(r.due || '')}" placeholder="预计复访日期">
             <label class="tiny" style="display:flex;align-items:center;gap:4px;color:var(--t2)">
               <span class="cb ${r.supervise ? 'on' : ''}" data-f="supervise"></span>标记需督办</label>
             <input class="tin" data-f="memo" value="${esc(r.memo || '')}" placeholder="原因说明（其他必填）">
           </div>`;
      return `<tr data-pid="${esc(id)}">
        <td class="dim num">${i + 1}</td>
        <td><span class="cell-main">${esc(nmOf(p))}</span><span class="cell-sub">${esc(lv.name)} · ${esc(p.village || '')}</span></td>
        <td class="tiny">${tags}</td>
        <td><div class="seg mini" data-st>
          <button class="${met ? 'on' : ''}" data-s="met">已见面</button>
          <button class="${met ? '' : 'on'}" data-s="miss">未见面</button>
        </div></td>
        <td>${metBox}</td>
        <td class="tiny dim">${esc(p.officer || '')}</td>
      </tr>`;
    }

    function paint(dlg) {
      const wrap = dlg.querySelector('#fillWrap');
      const ids = visible();
      wrap.innerHTML = `<table class="tb compact fill-tb">
        <thead><tr>
          <th style="width:26px">#</th><th style="width:118px">姓名 / 等级</th><th style="width:120px">类别标签</th>
          <th style="width:104px">见面状态</th><th>见面详情（已见面） / 未见面原因</th><th style="width:60px">包联</th>
        </tr></thead>
        <tbody>${ids.map((id, i) => trHTML(id, i)).join('')}</tbody></table>`;
      if (!ids.length) wrap.innerHTML = UI.empty('没有符合条件的记录', '试试切换筛选或清空搜索');

      const met = Object.keys(draft).filter(id => draft[id].status === 'met').length;
      const miss = Object.keys(draft).length - met;
      const cMet = dlg.querySelector('#cMet');
      const cMiss = dlg.querySelector('#cMiss');
      if (cMet) cMet.textContent = met;
      if (cMiss) cMiss.textContent = miss;

      wrap.querySelectorAll('tr[data-pid]').forEach(tr => {
        const rec = draft[tr.dataset.pid];
        tr.querySelectorAll('[data-st] button').forEach(b => {
          b.onclick = () => {
            const st = b.dataset.s;
            if (rec.status === st) return;
            rec.status = st;
            if (st === 'met') {
              rec.reason = ''; rec.due = ''; rec.supervise = false;
              if (!rec.way) rec.way = D.WT_WAYS[0];
              if (!rec.target) rec.target = D.WT_TARGETS[0];
              if (!rec.result) rec.result = D.WT_RESULTS[0];
              if (!rec.at) rec.at = '2026-11-10 09:30';
            } else if (!rec.reason) {
              rec.reason = 'away';
            }
            paint(dlg);
          };
        });
        tr.querySelectorAll('[data-f]').forEach(node => {
          const f = node.dataset.f;
          if (node.classList.contains('select')) {
            const opt = f === 'reason'
              ? { items: D.WT_REASONS.map(x => ({ v: x.key, t: x.name })), value: rec.reason, onChange: v => { rec.reason = v; } }
              : f === 'way' ? { items: D.WT_WAYS, value: rec.way, onChange: v => { rec.way = v; } }
              : f === 'target' ? { items: D.WT_TARGETS, value: rec.target, onChange: v => { rec.target = v; } }
              : { items: D.WT_RESULTS, value: rec.result, onChange: v => { rec.result = v; } };
            UI.select(node, opt);
          } else if (f === 'supervise') {
            UI.check(node, { onChange: on => { rec.supervise = on; } });
          } else {
            node.oninput = () => { rec[f] = node.value.trim(); };
          }
        });
      });
    }

    UI.modal({
      title: '回填见面情况 · ' + town,
      sub: `应见 ${task.should} 人 · 包联干部 ${task.officer} · 逐人填报后自动重算「未见面原因分布」与页头 KPI`,
      width: 960,
      okText: '提交回填',
      body: `
        <div class="row" style="gap:6px;align-items:center;margin-bottom:8px">
          <div class="seg" id="fillSeg">
            <button class="on" data-v="all">全部 ${task.should}</button>
            <button data-v="met">已见面 <b id="cMet">-</b></button>
            <button data-v="miss">未见面 <b id="cMiss">-</b></button>
          </div>
          <span class="spacer"></span>
          <input type="text" id="fillKw" placeholder="搜索姓名 / 档案号"
                 style="height:26px;width:150px;border:1px solid var(--line-2);border-radius:7px;padding:0 8px;font:inherit;font-size:11.5px;outline:0">
          <button class="btn btn-sm" data-act="allmet">全部标为已见面</button>
          <button class="btn btn-sm" data-act="bulkreason">批量套用原因</button>
        </div>
        <div class="table-wrap" id="fillWrap" style="max-height:400px;overflow:auto;border:1px solid var(--line);border-radius:9px"></div>
        <div class="fld"><label>镇街整体说明（选填，≤ 80 字，随审计流水留痕）</label>
          <input type="text" id="fillNote" placeholder="例如：2 人外出务工已电话联系，1 人住院由精防医生代为见面"></div>
        <div class="tiny dim" style="margin-top:6px">提交后：页头「已见面 / 未见面 / 见面率」、右列「未见面原因分布」、下方「应见未见清单」同时更新，并写入审计流水；<b>不会自动调整任何人的管控等级</b>。</div>`,
      onMount: dlg => {
        paint(dlg);
        UI.seg(dlg.querySelector('#fillSeg'), {
          onChange: v => { Q.filter = v; paint(dlg); }
        });
        const kw = dlg.querySelector('#fillKw');
        kw.oninput = () => { Q.kw = kw.value.trim(); paint(dlg); };
        dlg.querySelector('[data-act=allmet]').onclick = () => {
          const miss = Object.keys(draft).filter(id => draft[id].status === 'miss').length;
          if (!miss) { UI.toast('当前没有未见面人员'); return; }
          UI.confirm({
            title: '全部标为已见面？',
            sub: `将把 ${town} 应见 ${task.should} 人全部记为已见面（未见面 ${miss} 人清零）`,
            okText: '确认'
          }).then(ok => {
            if (!ok) return;
            Object.keys(draft).forEach(id => {
              const r = draft[id];
              r.status = 'met'; r.reason = ''; r.due = ''; r.supervise = false;
              if (!r.way) r.way = D.WT_WAYS[0];
              if (!r.target) r.target = D.WT_TARGETS[0];
              if (!r.result) r.result = D.WT_RESULTS[0];
              if (!r.at) r.at = '2026-11-10 09:30';
            });
            paint(dlg);
          });
        };
        dlg.querySelector('[data-act=bulkreason]').onclick = () => {
          const missIds = Object.keys(draft).filter(id => draft[id].status === 'miss');
          if (!missIds.length) { UI.toast('当前没有未见面人员'); return; }
          UI.modal({
            title: '批量套用未见面原因',
            sub: `将把 ${missIds.length} 名未见面人员的原因统一设为所选值（可在表格中逐人微调）`,
            width: 420, okText: '套用',
            body: `<div class="fld"><label>未见面原因</label><div class="select" id="bulkReason" style="height:30px"></div></div>
              <div class="tiny dim" style="margin-top:8px">${D.WT_REASONS.map(r => '· ' + r.name + '：' + r.desc).join('<br>')}</div>`,
            onMount: d2 => UI.select(d2.querySelector('#bulkReason'), { items: D.WT_REASONS.map(x => ({ v: x.key, t: x.name })), value: 'away' }),
            onOk: d2 => {
              const v = d2.querySelector('#bulkReason').textContent.trim();
              const hit = D.WT_REASONS.find(r => r.name === v) || D.WT_REASONS[0];
              missIds.forEach(id => { draft[id].reason = hit.key; });
              paint(dlg);
              UI.toast.ok('已套用「' + hit.name + '」到 ' + missIds.length + ' 人');
              return true;
            }
          });
        };
      },
      onOk: dlg => {
        const ids = Object.keys(draft);
        const bad = ids.filter(id => draft[id].status === 'miss' && draft[id].reason === 'other' && !(draft[id].memo || '').trim());
        if (bad.length) {
          UI.toast.err('「其他」原因须填写原因说明（' + bad.length + ' 人未填）');
          return false;
        }
        const note = (dlg.querySelector('#fillNote').value || '').trim().slice(0, 80);
        S.wtFill(town, ids.map(id => draft[id]), note);
        const mine = S.wtTasks().find(t => t.town === town);
        render();
        UI.toast.ok(`${town} 回填已提交：已见 ${mine.met} / 应见 ${mine.should}，全区未见面 ${S.wtStats().missing} 人`);
        return true;
      }
    });
  }

  /* ---------- 查阅已回填明细（只读） ---------- */
  function openDetail(town) {
    const rows = S.wtRows(town).map(r => ({ r, p: D.personById(r.personId) }));
    const hist = S.wtHist(town);
    const met = rows.filter(x => x.r.status === 'met').length;
    const miss = rows.length - met;
    UI.modal({
      title: '回填明细 · ' + town,
      sub: `应见 ${rows.length} · 已见面 ${met} · 未见面 ${miss} · 最近提交 ${hist.length ? hist[0].at + ' · ' + hist[0].by : '—'}`,
      width: 880,
      okText: null,
      cancelText: '关闭',
      footLeft: '<button class="btn btn-sm" data-act="csv">导出明细 CSV</button>',
      body: `
        <div class="table-wrap" style="max-height:330px;overflow:auto;border:1px solid var(--line);border-radius:9px">
          <table class="tb compact fill-tb">
            <thead><tr><th style="width:34px">#</th><th style="width:110px">姓名</th><th style="width:88px">等级</th>
              <th style="width:74px">状态</th><th style="width:150px">见面方式 / 对象</th><th style="width:118px">时间</th>
              <th>结果 / 未见面原因</th></tr></thead>
            <tbody>${rows.map((x, i) => {
              const lv = D.levelOf(S.levelOf(x.p));
              const m = x.r.status === 'met';
              return `<tr>
                <td class="dim num">${i + 1}</td>
                <td>${esc(nmOf(x.p))}</td>
                <td class="tiny">${esc(lv.name)}</td>
                <td>${m ? '<span class="tag tag-green" style="height:17px">已见面</span>' : '<span class="tag tag-red" style="height:17px">未见面</span>'}</td>
                <td class="tiny">${m ? esc(x.r.way + ' · ' + x.r.target) : '—'}</td>
                <td class="tiny num">${m ? esc(x.r.at || '—') : esc('复访 ' + (x.r.due || '—'))}</td>
                <td class="tiny">${m ? esc(x.r.result || '—') : esc((D.WT_REASON_OF[x.r.reason] || D.WT_REASONS[4]).name + (x.r.memo ? '：' + x.r.memo : ''))}</td>
              </tr>`;
            }).join('')}</tbody>
          </table>
        </div>
        <div class="sect-title" style="margin-top:10px">历次提交</div>
        <div class="tiny dim" style="line-height:1.9">${hist.length
          ? hist.map(h => `· ${h.at} · ${h.by} · 已见 ${h.met} / ${h.should}${h.note ? ' · ' + esc(h.note) : ''}`).join('<br>')
          : '· 尚无提交记录（当前展示系统基线数据）'}</div>`,
      onMount: dlg => {
        const b = dlg.querySelector('[data-act=csv]');
        if (b) b.onclick = () => {
          if (!window.guard('export', '导出回填明细')) return;
          const head = ['序号', '姓名', '等级', '状态', '见面方式', '见面对象', '见面时间', '结果', '未见面原因', '复访日期', '需督办', '说明'];
          const data = rows.map((x, i) => {
            const lv = D.levelOf(S.levelOf(x.p));
            const m = x.r.status === 'met';
            return [i + 1, nmOf(x.p), lv.name, m ? '已见面' : '未见面', x.r.way || '', x.r.target || '', x.r.at || '',
              m ? (x.r.result || '') : '', m ? '' : (D.WT_REASON_OF[x.r.reason] || D.WT_REASONS[4]).name,
              x.r.due || '', x.r.supervise ? '是' : '否', x.r.memo || ''];
          });
          UI.downloadCSV('重点时期_回填明细_' + town + '_2026-11.csv', [head].concat(data));
          S.addExport('回填明细 · ' + town, data.length, '脱敏');
          UI.toast.ok('回填明细已导出');
        };
      }
    });
  }

  /* ---------- 按原因看人 ---------- */
  function openReason(key) {
    const r = S.wtReasons().find(x => x.key === key);
    if (!r) return;
    const rows = r.list.slice().sort((a, b) => b.person.visitGap - a.person.visitGap);
    UI.modal({
      title: '未见面人员 · ' + r.name,
      sub: `${r.count} 人（占未见面 ${r.pct}%）· 涉及 ${r.towns.length} 个镇街 · 复访已到期 ${r.overdue} 人`,
      width: 780,
      okText: null,
      cancelText: '关闭',
      footLeft: '<button class="btn btn-sm" data-act="csv">导出该原因人员</button>',
      body: `
        <div class="banner banner-warn" style="padding:8px 11px;font-size:11.5px;margin-bottom:9px">
          <span>口径：${esc(r.desc)}</span>
        </div>
        <div class="table-wrap" style="max-height:320px;overflow:auto;border:1px solid var(--line);border-radius:9px">
          <table class="tb compact">
            <thead><tr><th style="width:34px">#</th><th style="width:104px">姓名</th><th style="width:96px">责任镇街</th>
              <th style="width:84px">等级</th><th style="width:70px" class="r">距上次</th><th style="width:96px">复访日期</th><th>说明 / 操作</th></tr></thead>
            <tbody>${rows.map((x, i) => {
              const lv = D.levelOf(S.levelOf(x.person));
              return `<tr>
                <td class="dim num">${i + 1}</td>
                <td><a href="javascript:;" data-goto="${esc(x.person.id)}" style="color:var(--blue)">${esc(nmOf(x.person))}</a></td>
                <td>${esc(x.town)}</td>
                <td class="tiny">${esc(lv.name)}</td>
                <td class="r" style="color:var(--red)">${x.person.visitGap} 天</td>
                <td class="tiny num">${esc(x.row.due || '—')}</td>
                <td class="tiny dim">${esc(x.row.memo || (x.row.supervise ? '需督办' : '待属地补充说明'))}</td>
              </tr>`;
            }).join('')}</tbody>
          </table>
        </div>`,
      onMount: (dlg, close) => {
        dlg.querySelectorAll('[data-goto]').forEach(a => {
          a.onclick = () => { close(null); openPerson(a.dataset.goto); };
        });
        const b = dlg.querySelector('[data-act=csv]');
        if (b) b.onclick = () => {
          if (!window.guard('export', '导出未见面人员')) return;
          const head = ['序号', '姓名', '责任镇街', '管控等级', '距上次见面(天)', '未见面原因', '复访日期', '需督办', '说明'];
          const data = rows.map((x, i) => [i + 1, nmOf(x.person), x.town, D.levelOf(S.levelOf(x.person)).name,
            x.person.visitGap, r.name, x.row.due || '', x.row.supervise ? '是' : '否', x.row.memo || '']);
          UI.downloadCSV('未见面人员_' + r.name + '_2026-11.csv', [head].concat(data));
          S.addExport('未见面人员 · ' + r.name, data.length, '脱敏');
          UI.toast.ok('已导出 ' + data.length + ' 人');
        };
      }
    });
  }

  function openPerson(id) {
    location.href = 'person.html?id=' + encodeURIComponent(id);
  }

  /* ---------- 督办：仅展示"需督办"标识，不下发（按 2026-11-13 会议决议 D2） ---------- */
  /* 原 openSupervise / doPush / openPush / doSelect 四个下发动作已按 D2 移除：
     不向镇街下发督办单、催办单、推送或圈选名单；仅保留"需督办"标识与明细导出。 */

  /* ---------- 时期配置 ---------- */
  function openPeriodCfg() {
    if (!window.guard('config', '修改时期参数')) return;
    const c = S.wtCfg();
    const per = S.wtPeriod();
    UI.modal({
      title: '重点时期配置',
      sub: `当前：${c.title} · 第 ${per.dayNow} / ${per.days} 天 · ${S.wtLevel().name}响应 · 上次修改 ${c.updatedAt}（${c.updatedBy}）`,
      width: 560,
      okText: '保存并同步',
      body: `
        <div class="fld"><label>时期名称</label><input type="text" id="cfgTitle" value="${esc(c.title)}"></div>
        <div class="grid g2" style="gap:8px">
          <div class="fld"><label>起始日期</label><input type="text" id="cfgStart" value="${esc(c.start)}"></div>
          <div class="fld"><label>结束日期</label><input type="text" id="cfgEnd" value="${esc(c.end)}"></div>
        </div>
        <div class="fld"><label>响应级别</label><div class="select" id="cfgLevel" style="height:30px"></div>
          <div class="tiny dim" id="cfgLevelHint" style="margin-top:5px;line-height:1.7"></div></div>
        <div class="grid g2" style="gap:8px">
          <div class="fld"><label>见面时限（日）</label><input type="text" id="cfgVisit" value="${c.visitLimit}" inputmode="numeric"></div>
          <div class="fld"><label>零报告截止</label><input type="text" id="cfgDue" value="${esc(c.reportDue)}"></div>
        </div>
        <div class="fld"><label>催办升级（未提交超时小时）</label><input type="text" id="cfgEsc" value="${c.escalateHours}" inputmode="numeric"></div>
        <div class="fld"><label>应见名单圈选规则</label>
          <div class="chips" id="cfgRule">${['高风险及以上', '双在册', '三重标签', '待核实', '未指定包联'].map(r =>
            `<span class="chip-select ${c.rosterRule.indexOf(r) > -1 ? 'on' : ''}" data-v="${r}">${r}</span>`).join('')}</div>
        </div>
        <div class="banner banner-warn mt10" style="padding:8px 10px;font-size:11px">
          <span>时期参数由区委政法委统一设定（需 config 权限）；保存后页头天数与进度、镇街见面时限、零报告截止、催办升级全部按新参数重算。</span>
        </div>`,
      onMount: dlg => {
        const duePicker = UI.timePicker(dlg.querySelector('#cfgDue'), { value: c.reportDue });
        const visitNode = dlg.querySelector('#cfgVisit');
        const hint = dlg.querySelector('#cfgLevelHint');

        /* 切换响应级别时即时告知该等级默认值，并提供一键套用（不静默覆盖已填值） */
        const paintHint = key => {
          const dft = S.wtLevelDefaults(key);
          const same = Number(visitNode.value) === dft.visitLimit && duePicker.value === dft.reportDue;
          hint.innerHTML = '该等级默认：' + (dft.visitLimit === 1 ? '每日见面' : '每 ' + dft.visitLimit + ' 日见面') +
            ' · 报告截止 ' + dft.reportDue + ' · 适用 ' + esc(dft.scopeText) +
            (same ? ' · <b style="color:var(--green)">已一致</b>'
              : ' · <a href="javascript:;" data-usedft style="color:var(--blue)">套用默认值</a>');
          const btn = hint.querySelector('[data-usedft]');
          if (btn) btn.onclick = () => {
            visitNode.value = dft.visitLimit;
            duePicker.set(dft.reportDue);
            paintHint(key);
            UI.toast.ok('已套用「' + dft.name + '响应」默认参数，保存后生效');
          };
        };

        UI.select(dlg.querySelector('#cfgLevel'), {
          items: S.wtLevels().map(l => ({ v: l.key, t: l.name + '响应 · ' + l.visit })),
          value: c.level,
          onChange: v => paintHint(v)
        });
        paintHint(c.level);
        /* 日期 / 时间一律走组件，禁止手输非规范格式 */
        UI.datePicker(dlg.querySelector('#cfgStart'), { value: c.start });
        UI.datePicker(dlg.querySelector('#cfgEnd'), { value: c.end });
        UI.chips(dlg.querySelector('#cfgRule'));
      },
      onOk: dlg => {
        const val = id => (dlg.querySelector('#' + id).value || '').trim();
        const iso = /^\d{4}-\d{2}-\d{2}$/;
        const start = val('cfgStart'), end = val('cfgEnd');
        if (!iso.test(start) || !iso.test(end)) { UI.toast.err('起止日期须为 YYYY-MM-DD'); return false; }
        if (start > end) { UI.toast.err('起始日期不能晚于结束日期'); return false; }
        if (!/^\d+$/.test(val('cfgVisit'))) { UI.toast.err('见面时限须为整数天数'); return false; }
        if (!/^\d{2}:\d{2}$/.test(val('cfgDue'))) { UI.toast.err('零报告截止须为 HH:MM'); return false; }
        if (!/^\d+$/.test(val('cfgEsc'))) { UI.toast.err('催办升级须为整数小时'); return false; }
        const rule = Array.from(dlg.querySelectorAll('#cfgRule .chip-select.on')).map(n => n.dataset.v);
        const lvText = dlg.querySelector('#cfgLevel').textContent;
        const lv = S.wtLevels().find(l => lvText.indexOf(l.name + '响应') === 0);
        S.wtSetCfg({
          title: val('cfgTitle') || c.title,
          start, end,
          level: lv ? lv.key : c.level,
          visitLimit: Number(val('cfgVisit')),
          reportDue: val('cfgDue'),
          escalateHours: Number(val('cfgEsc')),
          rosterRule: rule.length ? rule : c.rosterRule
        });
        render();
        UI.toast.ok('时期参数已保存并同步：' + start + ' ~ ' + end + '，共 ' + S.wtPeriod().days + ' 天');
        return true;
      }
    });
  }

  /* ---------- 响应等级配置 ----------
     结构化字段（visitEvery / reportEvery / reportDue / scope）是唯一真相：
     下拉给规范档位，选「自定义」才出现数字输入；切换生效等级时先确认，
     确认后把时期配置的「见面时限 / 零报告截止」重置为该等级默认值。 */
  const CUSTOM = '__custom';

  function lvStepItems(steps, cur) {
    const list = steps.map(s => ({ v: s.v, t: s.t }));
    list.push({ v: CUSTOM, t: '自定义…' });
    return { list, isCustom: !steps.some(s => s.v === Number(cur)) };
  }

  function askLevelReset(newKey) {
    const dft = S.wtLevelDefaults(newKey);
    const c = S.wtCfg();
    const diff = [];
    if (Number(c.visitLimit) !== dft.visitLimit) {
      diff.push('见面时限：<b>' + c.visitLimit + ' 日</b> → <b>' + dft.visitLimit + ' 日</b>');
    }
    if (c.reportDue !== dft.reportDue) {
      diff.push('零报告截止：<b>' + c.reportDue + '</b> → <b>' + dft.reportDue + '</b>');
    }
    if (!diff.length) {
      S.wtSetLevel(newKey);
      render();
      UI.toast.ok('已切换为「' + dft.name + '响应」，时期参数无需调整');
      return;
    }
    /* 等级切换在「保存等级配置」时已确定；这里只决定是否顺带重置时期参数。
       UI.confirm 不转发 onClose，结果一律在 then 里处理。 */
    UI.confirm({
      title: '切换为「' + dft.name + '响应」并重置时期参数？',
      sub: '该等级默认「' + (dft.visitLimit === 1 ? '每日见面' : '每 ' + dft.visitLimit + ' 日见面') +
        ' · 报告截止 ' + dft.reportDue + '」',
      body: '<div style="line-height:2">' + diff.join('<br>') +
        '</div><div class="tiny dim" style="margin-top:8px">选择「仅切换等级」则保留本期已自定义的参数。</div>',
      okText: '确认重置',
      cancelText: '仅切换等级',
      onOk: () => {
        S.wtSetLevel(newKey);
        S.wtSetCfg({ visitLimit: dft.visitLimit, reportDue: dft.reportDue });
        return true;
      }
    }).then(ok => {
      if (!ok) S.wtSetLevel(newKey);
      render();
      UI.toast.ok(ok
        ? '已切换为「' + dft.name + '响应」并重置为等级默认参数（见面 ' + dft.visitLimit + ' 日 / 截止 ' + dft.reportDue + '）'
        : '已切换为「' + dft.name + '响应」，保留本期自定义参数');
    });
  }

  function openLevelCfg() {
    if (!window.guard('config', '配置响应等级')) return;
    const list = S.wtLevels();
    const cur = S.wtLevel();

    const rowHTML = l => {
      const v = lvStepItems(D.WT_VISIT_STEPS, l.visitEvery);
      const r = lvStepItems(D.WT_REPORT_STEPS, l.reportEvery);
      const scopeAll = D.WT_SCOPES.concat((l.scope || []).filter(s => D.WT_SCOPES.indexOf(s) < 0));
      return `<div class="lv-row ${l.key === cur.key ? 'on' : ''}" data-k="${l.key}">
        <div class="lv-hd">
          <label class="tiny" style="display:flex;align-items:center;gap:5px">
            <span class="cb ${l.key === cur.key ? 'on' : ''}" data-lvck></span>生效</label>
          <span class="tag ${l.color}">${esc(l.name)}响应</span>
          <span class="spacer"></span>
          <span class="tiny dim" data-sum>${esc(l.visit)} · ${esc(l.report)}</span>
        </div>
        <div class="lv-bd">
          <div class="fld"><label>见面频次</label><div class="select sm" data-f="visit"></div></div>
          <div class="fld"><label>报告节奏</label><div class="select sm" data-f="report"></div></div>
          <div class="fld"><label>报告截止</label><input class="tin" data-f="due" value="${esc(l.reportDue)}"></div>
        </div>
        <div class="lv-bd" style="grid-template-columns:1fr 1fr 108px;margin-top:6px">
          <div class="fld" data-custom-wrap style="display:${v.isCustom ? '' : 'none'}">
            <label>自定义见面间隔（日）</label>
            <input class="tin" data-f="visitCustom" inputmode="numeric" value="${v.isCustom ? l.visitEvery : ''}"></div>
          <div class="fld" data-custom-wrap style="display:${r.isCustom ? '' : 'none'}">
            <label>自定义报告间隔（日）</label>
            <input class="tin" data-f="reportCustom" inputmode="numeric" value="${r.isCustom ? l.reportEvery : ''}"></div>
          <div class="fld"></div>
        </div>
        <div class="lv-scope"><label>适用时期</label>
          <div class="chips" data-f="scope">${scopeAll.map(s =>
            `<span class="chip-select ${(l.scope || []).indexOf(s) > -1 ? 'on' : ''}" data-v="${esc(s)}">${esc(s)}</span>`).join('')}</div>
        </div>
      </div>`;
    };

    let pendingPick = null;
    UI.modal({
      title: '响应等级配置',
      sub: '频次与节奏改为规范档位（可自定义）；勾选「生效」并保存后，全站按该等级计算见面时限、零报告截止与催办',
      width: 760,
      okText: '保存',
      body: list.map(rowHTML).join('') +
        `<div class="banner banner-warn" style="padding:8px 10px;font-size:11px">
           <span>等级只影响「见面频次 / 报告节奏 / 零报告截止 / 催办口径」，不改变任何人员的管控等级。
           切换生效等级时会先确认一次，确认后时期配置里的「见面时限 / 零报告截止」重置为该等级默认值。</span>
         </div>`,
      onMount: dlg => {
        let pick = cur.key;
        const syncSum = tr => {
          const sum = tr.querySelector('[data-sum]');
          if (!sum) return;
          const ve = lvRead(tr, 'visit'), re = lvRead(tr, 'report'), due = tr.querySelector('[data-f=due]').value || '08:00';
          const txt = D.wtLevelText({ visitEvery: ve, reportEvery: re, reportDue: due });
          sum.textContent = txt.visit + ' · ' + txt.report;
        };
        list.forEach(l => {
          const tr = dlg.querySelector('.lv-row[data-k="' + l.key + '"]');
          const vNode = tr.querySelector('[data-f=visit]');
          const rNode = tr.querySelector('[data-f=report]');
          const vCus = tr.querySelector('[data-f=visitCustom]');
          const rCus = tr.querySelector('[data-f=reportCustom]');
          const v = lvStepItems(D.WT_VISIT_STEPS, l.visitEvery);
          const r = lvStepItems(D.WT_REPORT_STEPS, l.reportEvery);

          vNode.__ui = UI.select(vNode, {
            items: v.list, value: v.isCustom ? CUSTOM : Number(l.visitEvery),
            onChange: val => {
              vCus.parentNode.style.display = val === CUSTOM ? '' : 'none';
              if (val === CUSTOM) { vCus.value = String(l.visitEvery); vCus.focus(); }
              syncSum(tr);
            }
          });
          rNode.__ui = UI.select(rNode, {
            items: r.list, value: r.isCustom ? CUSTOM : Number(l.reportEvery),
            onChange: val => {
              rCus.parentNode.style.display = val === CUSTOM ? '' : 'none';
              if (val === CUSTOM) { rCus.value = String(l.reportEvery); rCus.focus(); }
              syncSum(tr);
            }
          });
          UI.timePicker(tr.querySelector('[data-f=due]'), {
            value: l.reportDue,
            onChange: () => syncSum(tr)
          });
          vCus.oninput = () => syncSum(tr);
          rCus.oninput = () => syncSum(tr);
          UI.chips(tr.querySelector('[data-f=scope]'));
        });
        dlg.querySelectorAll('[data-lvck]').forEach(n => {
          UI.check(n, {
            onChange: on => {
              if (!on) { n.classList.add('on'); UI.toast('必须保留一个生效等级'); return; }
              pick = n.closest('.lv-row').dataset.k;
              dlg.querySelectorAll('[data-lvck]').forEach(x => { if (x !== n) x.classList.remove('on'); });
              dlg.querySelectorAll('.lv-row').forEach(r => r.classList.toggle('on', r.dataset.k === pick));
            }
          });
        });
        dlg.__pick = () => pick;
      },
      onOk: dlg => {
        let bad = '';
        const next = [];
        for (let i = 0; i < list.length; i++) {
          const l = list[i];
          const tr = dlg.querySelector('.lv-row[data-k="' + l.key + '"]');
          const ve = lvRead(tr, 'visit');
          const re = lvRead(tr, 'report');
          const due = (tr.querySelector('[data-f=due]').value || '').trim();
          const scope = Array.from(tr.querySelectorAll('[data-f=scope] .chip-select.on')).map(n => n.dataset.v);
          if (!(ve >= 1) || !(re >= 1)) { bad = l.name + '响应：见面频次与报告节奏须为 ≥1 的整数天'; break; }
          if (!/^\d{2}:\d{2}$/.test(due)) { bad = l.name + '响应：报告截止须为 HH:MM'; break; }
          if (!scope.length) { bad = l.name + '响应：至少选择一个适用时期'; break; }
          next.push({ key: l.key, name: l.name, color: l.color, visitEvery: ve, reportEvery: re, reportDue: due, scope });
        }
        if (bad) { UI.toast.err(bad); return false; }
        S.wtSetLevels(next);
        pendingPick = dlg.__pick();
        return true;
      },
      onClose: () => {
        if (!pendingPick) return;
        const key = pendingPick;
        pendingPick = null;
        if (key !== cur.key) { askLevelReset(key); return; }
        render();
        UI.toast.ok('响应等级已保存，当前生效：' + S.wtLevel().name + '响应');
      }
    });
  }

  /* 读一行等级配置里的「天数」（下拉值或自定义输入框） */
  function lvRead(tr, kind) {
    const node = tr.querySelector('[data-f=' + kind + ']');
    const cus = tr.querySelector('[data-f=' + kind + 'Custom]');
    const customShown = cus && cus.parentNode.style.display !== 'none' && String(cus.value).trim() !== '';
    if (customShown) {
      const n = parseInt(String(cus.value).replace(/[^\d]/g, ''), 10);
      return isNaN(n) ? 0 : n;
    }
    const v = node.__ui ? node.__ui.value : node.textContent;
    if (v === CUSTOM) {
      const n = parseInt(String(cus.value).replace(/[^\d]/g, ''), 10);
      return isNaN(n) ? 0 : n;
    }
    const n = parseInt(String(v).replace(/[^\d]/g, ''), 10);
    return isNaN(n) ? 0 : n;
  }

  /* ---------- 导出（真实 CSV + 审计 + 导出流水） ---------- */
  function guardExport(name) { return window.guard('export', name); }

  function exportRoster() {
    if (!guardExport('导出应见名单')) return;
    const head = ['序号', '责任镇街', '姓名', '档案号', '管控等级', '类别标签', '包联干部', '见面状态', '未见面原因', '见面方式', '见面时间', '复访日期'];
    const data = [];
    S.wtTasks().forEach(t => {
      S.wtRows(t.town).forEach(r => {
        const p = D.personById(r.personId);
        data.push([data.length + 1, t.town, nmOf(p), p.no, D.levelOf(S.levelOf(p)).name,
          (p.tags || []).join('/'), p.officer || '', r.status === 'met' ? '已见面' : '未见面',
          r.status === 'met' ? '' : (D.WT_REASON_OF[r.reason] || D.WT_REASONS[4]).name,
          r.way || '', r.at || '', r.due || '']);
      });
    });
    UI.downloadCSV('重点时期_应见名单_2026-11-10.csv', [head].concat(data));
    S.addExport('重点时期应见名单', data.length, '脱敏');
    S.audit('导出应见名单', '应见 ' + data.length + ' 人（20 镇街）', '重点时期管控');
    UI.toast.ok('应见名单已导出（' + data.length + ' 人）');
  }

  function exportReport() {
    if (!guardExport('导出报送单')) return;
    const st = S.wtStats();
    const per = S.wtPeriod();
    const head = ['责任镇街', '应见', '已见面', '未见面', '见面率(%)', '零报告', '回填时间', '回填人'];
    const data = S.wtTasks().map(t => [t.town, t.should, t.met, t.missing,
      t.should ? (t.met / t.should * 100).toFixed(1) : '0.0', t.reported ? '已报' : '未报', t.reportAt || '', t.by || '基线']);
    data.push(['全区合计', st.should, st.met, st.missing, st.rate.toFixed(1), st.reported + '/' + st.total, '', '']);
    data.push([]);
    data.push(['时期', per.start + ' ~ ' + per.end, '共 ' + per.days + ' 天', '第 ' + per.dayNow + ' 天',
      '响应 ' + S.wtEffective().levelName, '零报告截止 ' + S.wtEffective().reportDue]);
    UI.downloadCSV('重点时期_今日报送单_2026-11-10.csv', [head].concat(data));
    S.addExport('今日零报告与见面进度报送单', data.length, '脱敏');
    S.audit('导出报送单', `应见 ${st.should} · 已见 ${st.met} · 未见面 ${st.missing}`, '重点时期管控');
    UI.toast.ok('报送单已导出');
  }

  function exportUnseen() {
    if (!guardExport('导出未见面清单')) return;
    const head = ['序号', '姓名', '档案号', '责任镇街', '管控等级', '超期(天)', '未见面原因', '复访日期', '需督办', '包联干部'];
    const data = unseenList().map((x, i) => [i + 1, nmOf(x.person), x.person.no, x.town,
      D.levelOf(S.levelOf(x.person)).name, Math.max(1, x.person.visitGap - 30), x.reason.name,
      x.row.due || '', x.row.supervise ? '是' : '否', x.person.officer || '']);
    UI.downloadCSV('重点时期_未见面清单_2026-11-10.csv', [head].concat(data));
    S.addExport('未见面清单', data.length, '脱敏');
    S.audit('导出未见面清单', '未见面 ' + data.length + ' 人', '重点时期管控');
    UI.toast.ok('未见面清单已导出（' + data.length + ' 人）');
  }

  /* ---------- 事件绑定 ---------- */
  const bind = (id, fn) => { const n = document.getElementById(id); if (n) n.onclick = fn; };
  bind('btnPeriod', openPeriodCfg);
  bind('btnLvCfg', openLevelCfg);
  bind('btnExpRoster', exportRoster);
  bind('btnExpRpt', exportReport);
  bind('btnExpDb', exportUnseen);
  bind('btnRsExport', () => {
    if (!guardExport('导出未见面明细')) return;
    const head = ['序号', '姓名', '责任镇街', '管控等级', '未见面原因', '复访日期', '需督办', '距上次见面(天)'];
    const data = [];
    S.wtReasons().forEach(r => r.list.forEach(x => data.push([
      data.length + 1, nmOf(x.person), x.town, D.levelOf(S.levelOf(x.person)).name, r.name,
      x.row.due || '', x.row.supervise ? '是' : '否', x.person.visitGap
    ])));
    UI.downloadCSV('重点时期_未见面原因明细_2026-11-10.csv', [head].concat(data));
    S.addExport('未见面原因明细', data.length, '脱敏');
    S.audit('导出未见面明细', data.length + ' 人 · 5 类原因', '重点时期管控');
    UI.toast.ok('未见面明细已导出（' + data.length + ' 人）');
  });

  /* 应见未见清单分页（按钮由 renderUnseen 动态生成） */
  const pgWrap = document.getElementById('unseenBody');
  if (pgWrap) {
    const card = pgWrap.closest('.card');
    if (card) {
      card.addEventListener('click', e => {
        const b = e.target.closest('.pg-btn');
        if (!b || b.disabled) return;
        renderUnseen(Number(b.dataset.p));
      });
    }
  }

  render();
})();
