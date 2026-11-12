/* ============================================================
   page-person.js · 一人一档
   ------------------------------------------------------------
   ?id=P0123 定位到具体人员（缺省取第一条），全部字段按角色密级输出：
     区领导 → 姓名/身份证掩码、住址门牌掩码
     政法委主管 → 全字段明文
     公安经办 → 仅本部门来源人员可见，身份证掩码但可申请明文
   ============================================================ */
(function () {
  'use strict';
  const D = window.DATA;
  const esc = UI.esc;
  const RK = () => STORE.role().key;

  const params = new URLSearchParams(location.search);
  const id = params.get('id');
  const p = id ? D.personById(id) : D.persons[0];

  const hero = document.getElementById('hero');
  const banner = document.getElementById('heroBanner');
  const tagCard = document.getElementById('tagCard');
  const baseCard = document.getElementById('baseCard');
  const visitCard = document.getElementById('visitCard');
  const plainCard = document.getElementById('plainCard');
  const traceCard = document.getElementById('traceCard');
  const lvlChgCard = document.getElementById('lvlChgCard');
  /* 跨镇街迁移卡由 renderSide 挂到右列第三位（与看板「跨镇街流动明细」同源） */
  const moveCard = document.createElement('div');
  moveCard.className = 'card';
  moveCard.id = 'moveCard';
  const sideCards = document.getElementById('sideCards');

  const lv = () => D.levelOf(STORE.levelOf(p));
  const f = (name) => D.field(RK(), name, p);

  /* ---------- 标签持久化：DATA 每次加载重建，追加的标签写 localStorage 并回填 ---------- */
  const TAG_KEY = 'yq.person.tags';
  function loadTagStore() {
    try { const o = JSON.parse(localStorage.getItem(TAG_KEY) || '{}'); return (o && typeof o === 'object') ? o : {}; }
    catch (e) { return {}; }
  }
  function saveTagStore(o) { try { localStorage.setItem(TAG_KEY, JSON.stringify(o)); } catch (e) { /* 隐私模式忽略 */ } }
  (function applySavedTags() {
    const saved = loadTagStore()[p.id];
    if (Array.isArray(saved) && saved.length) {
      saved.forEach(t => { if (p.tags.indexOf(t) < 0) p.tags.push(t); });
      p.multi = p.tags.length > 1;
    }
  })();

  /* ---------- 档案头 ---------- */
  function renderHero() {
    // 注：.page-head 会被 shell.js 摘除（标题进面包屑、按钮进顶栏），故档案编号统一在 hero 内展示
    const level = lv();
    const tags = p.tags.map(t => {
      const meta = D.TAGS.find(x => x.name === t) || { cls: 'tag-line' };
      return `<span class="tag ${meta.cls}">${esc(t)}</span>`;
    }).join('');
    hero.innerHTML = `
      <div class="bigava" style="background:${f('name').masked ? 'var(--surface-3);color:var(--t2)' : ''}">${esc(p.name.slice(0, 1))}</div>
      <div style="min-width:0">
        <div class="h-name">
          <b>${esc(f('name').text)}</b>
          ${p.dual ? '<span class="flag dual">' + esc(p.dept) + '·双在册</span>' : ''}
          ${p.multi ? `<span class="flag multi">多重标签 ${p.tags.length}</span>` : ''}
          ${p.watch ? '<span class="flag">重点关注</span>' : ''}
          ${p.noBasis ? '<span class="flag">依据缺失</span>' : ''}
          <span class="tag tag-green">${esc(p.status)}</span>
        </div>
        <div class="h-meta">
          <span class="mono" style="color:var(--t2);font-size:11px">${esc(p.no)}</span><i></i>
          <span>${esc(p.gender)} · ${p.age} 岁</span><i></i>
          <span>${esc(p.birth)}</span><i></i>
          <span class="mask">${esc(f('idNo').text)}${f('idNo').masked ? ' <span class="tiny" style="color:var(--blue);cursor:pointer" id="inlinePlain">申请明文</span>' : ''}</span><i></i>
          <span>${esc(p.town)} · ${esc(p.village)}</span><i></i>
          <span>列管时间 ${esc(p.since)}-18</span>
        </div>
        <div class="row mt10" style="gap:6px;flex-wrap:wrap">
          <span class="tag tag-line">主责：${esc(p.dept)}</span>
          <span class="tag tag-line">包联干部：${esc(p.officer)}（${esc(p.officerTitle)}）</span>
          <span class="tag tag-line">最近走访：${D.dateRel(p.visitGap)}</span>
          <span class="tag tag-line">数据来源：${esc(p.source)}</span>
        </div>
      </div>
      <div class="grade-box">
        <div class="grade-badge">
          <div class="g" style="color:${p.level === 'high2' ? 'var(--red)' : 'var(--t1)'}">${level.name}</div>
          <div class="s">管控等级 · 统一风险序 ${level.order + 1}</div>
        </div>
        <div class="rank-compare">
          <div class="tiny dim" style="margin-bottom:2px">各标签归一风险序（越短越高）</div>
          ${p.tags.slice(0, 3).map((t, i) => {
            const order = 2 + ((i * 2 + p.name.charCodeAt(0)) % 4);
            const color = order <= 2 ? 'var(--red)' : order <= 4 ? 'var(--orange)' : '#8fb0cd';
            return `<div class="rc-row"><span class="nm">${esc(t)}</span>
              <span class="rc-bar"><i style="width:${Math.min(90, order * 11)}%;background:${color}"></i></span>
              <b style="color:${color === '#8fb0cd' ? '#3e5f80' : color}">${order}</b></div>`;
          }).join('') || '<div class="tiny dim">暂无标签</div>'}
        </div>
      </div>`;

    const inline = document.getElementById('inlinePlain');
    if (inline) inline.onclick = requestPlain;
  }

  /* ---------- 双在册 / 依据缺失 提示 ---------- */
  function renderBanner() {
    const items = [];
    if (p.dual) {
      items.push(`<div class="banner banner-error mb10" style="margin-bottom:8px">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M12 4v10M12 18.5v.5"/><circle cx="12" cy="12" r="9"/></svg>
        <span><b>双在册未确认：</b>该人员同时由 ${esc(p.dept)} 与其他部门列入台账，确认任务自 2026-11-06 起<b>待确认 4 天</b>；管控标准按两部门中较高等级执行，不因一方未确认而降低。</span>
        <a class="act" href="alerts.html">去处理 ›</a></div>`);
    }
    if (p.noBasis) {
      items.push(`<div class="banner banner-warn mb10" style="margin-bottom:8px">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M12 4v10M12 18.5v.5"/><path d="M10.3 3.2L2.6 17a2 2 0 001.7 3h15.4a2 2 0 001.7-3L13.7 3.2a2 2 0 00-3.4 0z"/></svg>
        <span><b>评估依据缺失：</b>「${esc(p.tags[p.tags.length - 1])}」标签缺少诊断证明或法律文书，按规则不得据此上调等级，需主责部门补录。</span>
        <a class="act" href="import.html">去补录 ›</a></div>`);
    }
    banner.innerHTML = items.join('');
  }

  /* ---------- 标签 ---------- */
  function renderTags() {
    tagCard.innerHTML = `
      <div class="card-hd">
        <div class="card-title">类别标签 <span class="sub">${p.tags.length} 个 · 上限 3 个，第 4 个需主管审批</span></div>
        <div class="right"><button class="btn btn-sm" id="btnAddTag">新增标签</button></div>
      </div>
      <div class="card-bd" style="padding:10px 14px 11px">
        <div class="tagstack" style="gap:6px">
          ${p.tags.map(t => {
            const meta = D.TAGS.find(x => x.name === t) || { cls: 'tag-line', dept: '—' };
            return `<span class="tag ${meta.cls}" style="height:21px;padding:0 8px;font-size:10.8px">${esc(t)} <span style="opacity:.65;margin-left:4px">${esc(meta.dept)}</span></span>`;
          }).join('')}
        </div>
        <div class="grid g3 mt10" style="gap:8px">
          <div class="mini-stat mini-sm"><div class="v">${p.tags.length}</div><div class="l">标签数</div></div>
          <div class="mini-stat mini-sm"><div class="v" style="color:${p.multi ? 'var(--orange)' : 'var(--t1)'}">${p.multi ? '是' : '否'}</div><div class="l">多重标签</div></div>
          <div class="mini-stat mini-sm"><div class="v" style="color:${p.noBasis ? 'var(--red)' : 'var(--green)'}">${p.noBasis ? '缺失' : '齐全'}</div><div class="l">依据完整性</div></div>
        </div>
      </div>`;

    document.getElementById('btnAddTag').onclick = () => {
      if (!window.guard('edit', '新增标签')) return;
      UI.modal({
        title: '新增标签 · ' + f('name').text,
        sub: '追加标签不覆盖原有标签；同一人第 4 个标签需政法委主管审批',
        body: `<div class="fld"><label>选择标签</label><div class="ui-radio" id="tagList">
          ${D.TAGS.map((t, i) => `<label data-v="${esc(t.name)}" class="${p.tags.indexOf(t.name) >= 0 ? 'on' : ''}">
            <input type="radio" name="tg" style="margin-top:2px">
            <span style="flex:1"><b>${esc(t.name)}</b><br><span>${esc(t.dept)}${p.tags.indexOf(t.name) >= 0 ? ' · 已存在' : ''}</span></span></label>`).join('')}
          </div></div>
          <div class="fld"><label>依据说明（必填 · 至少 2 字）</label><input type="text" id="tagNote" placeholder="例如：11 月核查新增，附推送截图"></div>`,
        okText: '确认追加',
        onMount: dlg => {
          dlg.querySelectorAll('#tagList label').forEach(l => {
            l.onclick = () => {
              dlg.querySelectorAll('#tagList label').forEach(x => x.classList.remove('on'));
              l.classList.add('on'); l.querySelector('input').checked = true;
            };
          });
        },
        onOk: dlg => {
          const on = dlg.querySelector('#tagList label.on');
          const note = dlg.querySelector('#tagNote').value.trim();
          if (!on) { UI.toast.warn('请选择标签'); return false; }
          if (note.length < 2) { UI.toast.warn('请填写依据说明（至少 2 字）'); return false; }
          if (p.tags.indexOf(on.dataset.v) >= 0) { UI.toast.warn('该标签已存在'); return false; }
          const is4th = p.tags.length >= 3;
          if (is4th && !(STORE.role().can && STORE.role().can.approve)) { UI.toast.err('已达 3 个标签上限，第 4 个需政法委主管审批'); return false; }
          p.tags.push(on.dataset.v);
          p.multi = p.tags.length > 1;
          const tstore = loadTagStore(); tstore[p.id] = p.tags.slice(); saveTagStore(tstore);
          STORE.audit('追加标签', p.name + ' 新增「' + on.dataset.v + '」' + (is4th ? '（第 4 个标签 · 政法委主管现场审批）' : '') + '：' + note, p.no);
          UI.toast.ok(is4th ? '已追加（第 4 个标签 · 主管审批已记录）' : '已追加标签');
          renderAll();
          return true;
        }
      });
    };
  }

  /* ---------- 基本信息 ---------- */
  function renderBase() {
    const row = (k, v, opt) => `<dl class="kv"><dt>${k}</dt><dd${opt && opt.raw ? '' : ''}>${v}</dd></dl>`;
    baseCard.innerHTML = `
      <div class="card-hd">
        <div class="card-title">基本信息 <span class="sub">22 项主干字段 · 按密级脱敏</span></div>
        <div class="right">${UI.roleTip()}</div>
      </div>
      <div class="card-bd" style="padding:10px 16px 12px">
        <div class="grid g4" style="gap:2px 16px">
          ${row('姓名', esc(f('name').text))}
          ${row('性别', esc(p.gender))}
          ${row('出生日期', esc(p.birth))}
          ${row('年龄', p.age + ' 岁')}
          ${row('身份证号', `<span class="mask">${esc(f('idNo').text)}</span>${f('idNo').masked ? ' <span class="ui-lock">掩码</span>' : ''}`)}
          ${row('联系电话', `<span class="mask">${esc(f('phone').text)}</span>`)}
          ${row('民族', '汉族')}
          ${row('文化程度', p.age > 55 ? '初中' : '高中')}
          ${row('户籍地址', esc(f('addr').text))}
          ${row('现住址', esc(f('addr').text))}
          ${row('责任镇街', esc(p.town))}
          ${row('社区 / 村', esc(p.village))}
          ${row('主责单位', esc(p.dept))}
          ${row('列管状态', `<span class="tag tag-green">${esc(p.status)}</span>`)}
          ${row('列管时间', esc(p.since) + '-18')}
          ${row('危险度评估', (p.level === 'high2' ? '4' : p.level === 'high' ? '3' : '2') + ' 级（0—5 级）')}
          ${row('监护人', '李某某（配偶）<span class="mask">139****3082</span>')}
          ${row('档案创建', '2026-09-02 14:22')}
          ${row('最近更新', '2026-11-07 10:15')}
          ${row('数据来源', esc(p.source))}
          ${row('数据质量', p.noBasis ? '<span class="tag tag-amber">1 项待补</span>' : '<span class="tag tag-green">完整</span>')}
          ${row('负责民警', '张海涛（' + esc(p.town) + '派出所）')}
        </div>
      </div>`;
  }

  /* ---------- 走访记录 ---------- */
  function renderVisits() {
    const list = STORE.visits(p);
    visitCard.innerHTML = `
      <div class="card-hd">
        <div class="card-title">走访与沟通记录 <span class="sub">共 ${list.length} 条</span></div>
        <div class="right"><button class="btn btn-sm" id="btnVisit2">登记走访</button></div>
      </div>
      <div class="card-bd" style="padding:12px 16px 12px">
        ${list.length ? `<div class="timeline">${list.slice(0, 5).map((v, i) => `
          <div class="tl-item">
            <div class="tl-time">${esc(v.date)} · ${esc(v.way)}</div>
            <div class="tl-txt">${esc(v.result)}</div>
            <div class="tl-meta">走访人：${esc(v.by)} · ${i === 0 ? '最近一次' : '已核验'}${v.at ? ' · 本次新增 ' + esc(v.at) : ''}</div>
          </div>`).join('')}</div>` : UI.empty('暂无走访记录', '该人员尚未登记走访，将触发「走访超期」规则')}
      </div>
      <div class="card-ft"><button class="btn btn-sm btn-ghost" id="btnVisitAll">查看全部 ${list.length} 条 ›</button></div>`;
    const b = document.getElementById('btnVisit2');
    if (b) b.onclick = openVisit;
    const all = document.getElementById('btnVisitAll');
    if (all) all.onclick = () => {
      UI.modal({
        title: '全部走访与沟通记录 · ' + f('name').text, width: 560,
        body: list.length ? `<div style="max-height:420px;overflow:auto;padding-right:4px"><div class="timeline">${list.map(v => `
          <div class="tl-item">
            <div class="tl-time">${esc(v.date)} · ${esc(v.way)}</div>
            <div class="tl-txt">${esc(v.result)}</div>
            <div class="tl-meta">走访人：${esc(v.by)}${v.at ? ' · 本次新增 ' + esc(v.at) : ''}</div>
          </div>`).join('')}</div></div>` : UI.empty('暂无走访记录', '该人员尚未登记走访'),
        okText: null, cancelText: '关闭'
      });
    };
  }

  /* ---------- 右列 ---------- */
  function renderSide() {
    const duty = D.dutyOf(p);
    const alerts = STORE.alerts().filter(a => a.personId === p.id);
    sideCards.innerHTML = `
      <div class="card">
        <div class="card-hd"><div class="card-title">责任链路 <span class="sub">一人一责任人 · 缺位将触发「未指定包联」规则</span></div></div>
        <div class="card-bd" style="padding:8px 14px">
          ${duty.map(d => `<div class="li" style="padding:4px 0;gap:6px">
            <span class="tiny dim" style="flex:0 0 54px">${esc(d.role)}</span>
            <span class="sm" style="flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${esc(d.dept)} · ${esc(d.title)}"><b>${esc(d.name)}</b> <span class="tiny dim">${esc(d.dept)} · ${esc(d.title)}</span></span>
          </div>`).join('')}
        </div>
      </div>

      <div class="card">
        <div class="card-hd"><div class="card-title">风险预警 <span class="sub">同档案合并</span></div>
          <div class="right"><span class="tag ${alerts.filter(a => a.status === '待处置').length ? 'tag-red' : 'tag-line'}">${alerts.length} 条</span></div></div>
        <div class="card-bd" style="padding:8px 14px 10px">
          ${alerts.length ? alerts.map(a => `<div class="li" style="padding:6px 0">
            <span class="tag ${a.urgency === 'high' ? 'tag-red' : 'tag-orange'}">${esc(a.rule)}</span>
            <span class="sm" style="flex:1">${esc(a.metric)}</span>
            <span class="tag ${a.status === '已闭环' ? 'tag-green' : 'tag-line'}">${esc(a.status)}</span>
          </div>`).join('') : '<div class="tiny dim" style="padding:6px 0">暂无预警</div>'}
          <a class="btn btn-sm btn-ghost" href="alerts.html" style="margin-top:4px">去预警待办 ›</a>
        </div>
      </div>
    `;
    sideCards.appendChild(moveCard);   // 第三卡：跨镇街迁移，由 renderMove 填充
  }

  /* ---------- 底部同排：等级变动记录 ---------- */
  function renderLvlChg() {
    const rows = STORE.approvals().filter(a => a.personId === p.id && a.status === '已通过');
    lvlChgCard.innerHTML = `
      <div class="card-hd"><div class="card-title">等级变动记录 <span class="sub">只增不改</span></div>
        <div class="right"><span class="tag tag-line">${rows.length + 2} 条</span></div></div>
      <div class="card-bd" style="padding:8px 14px 10px">
        ${rows.map(a => `<div class="li" style="padding:5px 0;gap:6px">
          <span class="tiny dim" style="flex:0 0 40px">${esc((a.at || '').slice(5, 10))}</span>
          <span class="sm" style="flex:1;min-width:0"><span class="${D.levelOf(a.curLevel).cls}">${D.levelOf(a.curLevel).name}</span> <span class="dim">→</span> <span class="${D.levelOf(a.toLevel).cls}">${D.levelOf(a.toLevel).name}</span><span class="cell-sub">审批人 ${esc(a.by || '—')}</span></span>
        </div>`).join('')}
        <div class="li" style="padding:5px 0;gap:6px">
          <span class="tiny dim" style="flex:0 0 40px">11-12</span>
          <span class="sm" style="flex:1;min-width:0"><span class="risk risk-2">中风险</span> <span class="dim">→</span> <span class="${lv().cls}">${lv().name}</span><span class="cell-sub">审批人 陈志远</span></span>
        </div>
        <div class="li" style="padding:5px 0;gap:6px">
          <span class="tiny dim" style="flex:0 0 40px">2024</span>
          <span class="sm" style="flex:1;min-width:0"><span class="dim">首次定级 →</span> <span class="${lv().cls}">${lv().name}</span><span class="cell-sub">系统导入</span></span>
        </div>
      </div>
`;
  }

  /* ---------- 底部同排：跨镇街迁移（与看板「跨镇街流动明细」同源） ---------- */
  function renderMove() {
    const ms = D.movesOf(p);
    const second = D.hasSecondMove(p);
    const last = ms[ms.length - 1];
    moveCard.innerHTML = `
      <div class="card-hd"><div class="card-title">跨镇街迁移 <span class="sub">迁移 ${ms.length} 次</span></div>
        <div class="right">${second ? '<span class="tag tag-amber">30 日内二次迁入</span>' : '<span class="tag tag-line">无异常</span>'}</div></div>
      <div class="card-bd" style="padding:8px 14px 10px">
        ${ms.map(m => `<div class="li" style="padding:6px 0;align-items:flex-start;gap:7px">
          <span class="tag ${m.status === '已并档' ? 'tag-green' : m.status === '移交中' ? 'tag-blue' : 'tag-amber'}" style="height:16px;flex:0 0 auto">第${m.seq}次</span>
          <span class="sm" style="flex:1;min-width:0"><b>${esc(m.from)}</b> <span class="dim">→</span> <b>${esc(m.to)}</b>
            <span class="cell-sub">迁出 ${esc(m.outDate.slice(5))} · 迁入 ${esc(m.inDate.slice(5))} · 移交 ${m.gapDays} 天${m.gapFromPrev ? ' · 距上次 ' + m.gapFromPrev + ' 天' : ''}</span>
            <span class="cell-sub">${esc(m.reason)} · ${esc(m.status)} · 移交单 ${esc(m.taskNo)}</span>
          </span>
        </div>`).join('')}
      </div>
      <div class="card-ft"><a class="btn btn-sm btn-ghost" href="board.html?tab=move">看板明细 ›</a></div>`;
  }

  /* ---------- 底部同排：明文查看授权 / 访问留痕 ---------- */
  function renderPlain() {
    const dis = STORE.disclosures(p.id);
    plainCard.innerHTML = `
      <div class="card-hd"><div class="card-title">明文查看授权 <span class="sub">一次一授权 · 留痕</span></div>
        <div class="right"><span class="tag tag-line">${dis.length} 次</span></div></div>
      <div class="card-bd" style="padding:8px 14px 10px">
        ${dis.length ? dis.slice(0, 6).map(d => `<div class="li" style="padding:5px 0">
          <span class="tiny dim" style="width:76px">${esc(d.at)}</span>
          <span class="sm" style="flex:1">${esc(d.applicant)} · ${esc(d.purpose)}</span>
          <span class="tag tag-blue" style="height:16px">${esc(d.code.slice(-3))}</span>
        </div>`).join('') : '<div class="tiny dim" style="padding:6px 0">本次会话暂无明文查看记录</div>'}
      </div>
      <div class="card-ft"><button class="btn btn-sm btn-ghost" id="btnPlain2">申请查看明文 ›</button></div>`;
    const b2 = document.getElementById('btnPlain2');
    if (b2) b2.onclick = requestPlain;
  }

  function renderTrace() {
    const rows = STORE.auditOf(80).filter(a => a.target === p.no || (a.detail || '').indexOf(p.name) >= 0);
    traceCard.innerHTML = `
      <div class="card-hd"><div class="card-title">访问留痕 <span class="sub">不可删除</span></div>
        <div class="right"><span class="tag tag-blue">${rows.length} 条</span></div></div>
      <div class="card-bd" style="padding:8px 14px 10px">
        ${rows.length ? rows.slice(0, 10).map(a => `<div class="li" style="padding:5px 0">
          <span class="tiny dim" style="width:76px">${esc(a.at.slice(5))}</span>
          <span class="sm" style="flex:1">${esc(a.by)} · ${esc(a.act)}<span class="cell-sub">${esc(a.detail).slice(0, 26)}</span></span>
        </div>`).join('') : '<div class="tiny dim" style="padding:6px 0">暂无本人操作记录</div>'}
      </div>
      <div class="card-ft"><a class="btn btn-sm btn-ghost" href="system.html?tab=audit">查看完整日志 ›</a></div>`;
  }

  /* ---------- 交互 ---------- */
  function requestPlain() {
    if (!STORE.can('disclosure')) {
      UI.toast.err('当前角色无申请权限');
      return;
    }
    if (!f('idNo').masked) { UI.toast('当前角色已是明文可见，无需申请'); return; }
    UI.modal({
      title: '申请查看明文 · ' + p.name,
      sub: '一次一授权，仅对本次查阅有效；申请与查阅均写入审计日志，不可删除',
      okText: '提交申请',
      body: `<div class="fld"><label>查阅用途（必填，不少于 6 字）</label><input type="text" id="purpose" placeholder="例如：重点时期管控名单核对，需核对身份证号"></div>
        <div class="fld"><label>授权方式</label>
          <div class="ui-radio"><label class="on"><input type="radio" checked style="margin-top:2px"><span style="flex:1"><b>双人复核</b><br><span>本人申请 + 另一名主管复核，5 分钟内生效</span></span></label></div>
        </div>
`,
      onOk: dlg => {
        const purpose = dlg.querySelector('#purpose').value.trim();
        if (purpose.length < 6) { UI.toast.warn('请填写查阅用途（不少于 6 字）'); return false; }
        const rec = STORE.disclosure(p.id, purpose);
        UI.toast.ok('已授权 · 授权码 ' + rec.code + '（本次会话有效）');
        renderAll();
        return true;
      }
    });
  }

  function openVisit() {
    if (!window.guard('edit', '登记走访')) return;
    UI.modal({
      title: '登记走访 · ' + f('name').text,
      sub: '登记后立即刷新「最近走访」与「走访超期」规则判定，写入不可修改的走访记录',
      width: 520,
      okText: '提交登记',
      body: `<div class="fld"><label>走访方式</label><div class="select" id="vWay" style="height:30px">入户走访</div></div>
        <div class="fld"><label>走访结果</label><div class="select" id="vResult" style="height:30px">情况稳定，已宣传政策</div></div>
        <div class="fld"><label>走访说明</label><textarea id="vNote" placeholder="例如：11-10 入户走访，本人在家，情绪稳定、服药规律；嘱托家属持续关注。"></textarea></div>
        <div class="fld"><label>附件（可选）</label><label class="tag tag-line" style="cursor:pointer">+ 选择走访照片/记录<input type="file" id="vFile" hidden></label>
          <div class="tiny dim" id="vFileName" style="margin-top:4px"></div></div>`,
      onMount: dlg => {
        let way = '入户走访', result = '情况稳定，已宣传政策';
        UI.select(dlg.querySelector('#vWay'), {
          items: ['入户走访', '电话联系', '联合面视', '社区见面', '视频通话'], value: way, onChange: v => { way = v; }
        });
        UI.select(dlg.querySelector('#vResult'), {
          items: ['情况稳定，已宣传政策', '情绪波动，已疏导并上报', '本人不在家，预约再访', '拒访，已记录并升级', '已落实监护措施'], value: result, onChange: v => { result = v; }
        });
        dlg.querySelector('#vFile').onchange = e => {
          const fl = e.target.files[0];
          if (fl) dlg.querySelector('#vFileName').textContent = '已选择：' + fl.name + ' · ' + FILEPARSE.sizeText(fl.size);
        };
        dlg._get = () => ({ way, result, note: dlg.querySelector('#vNote').value.trim() });
      },
      onOk: dlg => {
        const { way, result, note } = dlg._get();
        if (way === '入户走访' && note.length < 6) { UI.toast.warn('入户走访需填写说明（不少于 6 字）'); return false; }
        STORE.addVisit(p.id, { way, result: result + (note ? '。' + note : ''), by: STORE.role().user });
        UI.toast.ok('走访已登记 · 最近走访刷新为今天');
        renderAll();
        return true;
      }
    });
  }

  function exportFile() {
    if (!window.guard('exportPlain', '导出档案')) return;
    const roleKey = RK();
    const rows = [
      ['字段', '值'],
      ['档案号', p.no], ['姓名', p.name], ['身份证号', D.field(roleKey, 'idNo', p).text],
      ['性别', p.gender], ['出生日期', p.birth], ['联系电话', p.phone],
      ['责任镇街', p.town], ['社区/村', p.village], ['住址', D.field(roleKey, 'addr', p).text],
      ['类别标签', p.tags.join(' / ')], ['管控等级', lv().name], ['主责单位', p.dept],
      ['包联干部', p.officer + '（' + p.officerTitle + '）'], ['最近走访', D.dateBefore(p.visitGap)],
      ['走访次数', p.visitTotal]
    ];
    UI.downloadCSV('一人一档_' + p.no + '_' + p.name + '.csv', rows);
    STORE.addExport('一人一档 ' + p.no, 1, '明文导出');
    UI.toast.ok('档案已导出（带水印与操作人标识）· 已留痕');
  }

  /* ---------- 页头按钮 ---------- */
  document.getElementById('btnVisit').onclick = openVisit;
  document.getElementById('btnPlain').onclick = requestPlain;
  document.getElementById('btnExportFile').onclick = exportFile;

  function renderAll() {
    renderHero(); renderBanner(); renderTags(); renderBase(); renderVisits(); renderSide();
    renderLvlChg(); renderMove(); renderPlain(); renderTrace();
  }
  STORE.audit('查看档案', '打开一人一档 · ' + p.no + '（访问留痕实时记录）', p.no);
  renderAll();
})();
