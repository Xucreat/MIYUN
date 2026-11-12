/* ============================================================
   page-alerts.js · 预警待办（18 条 · 处置闭环）
   ------------------------------------------------------------
   闭环链路：选预警 → 选处置方式 → 填写说明（必填）→ 提交
             → 状态写入 STORE（跨页/刷新可见）→ 审计留痕 → 列表与计数同步
   ============================================================ */
(function () {
  'use strict';
  const D = window.DATA;
  const esc = UI.esc;
  /* 每页 10 条：列表卡片按 body.fit 撑满视口，10 条铺满后若仍有超出，
     由 .alert-list 自身上下滚动承接（不再出现「7 条 + 大片空白」） */
  const PER = 10;
  const URG = { high: 0, mid: 1, low: 2 };
  const URG_CLS = { high: 'high', mid: 'mid', low: 'low' };

  let status = '待处置', fTown = '', fRule = '', pageNo = 1, curId = null;
  let dispo = '', atts = [];

  const listBox = document.getElementById('alertList');
  const pagerBox = document.getElementById('alertPager');
  const pane = document.getElementById('detailPane');
  const grid = document.getElementById('ruleGrid');
  const hdr = document.getElementById('hdrCount');

  /* ---------- 过滤 ---------- */
  function filtered() {
    let list = STORE.alerts();
    if (status) list = list.filter(a => a.status === status);
    if (fTown) list = list.filter(a => a.town === fTown);
    if (fRule) list = list.filter(a => a.rule === fRule);
    return list.sort((a, b) => (URG[a.urgency] - URG[b.urgency]) || a.id.localeCompare(b.id));
  }

  /* ---------- 规则统计 ----------
     顶部只铺「当前有待办来源」的规则（RG-01~07 人员风险 + RG-10 越权访问，合计 = 列表待处置数）；
     data.js 中标记 board:false 的规则（RG-08/RG-09 停用、RG-11~13 本期零待办的治理类）
     不在顶栏占位，仍可在「规则配置」弹窗查看与开关。列数按实际条数写入，保证始终一排。 */
  function visibleRules() {
    return STORE.rules().filter(r => r.board !== false);
  }

  function renderRules() {
    const all = STORE.alerts();
    const open = all.filter(a => a.status === '待处置');
    const list = visibleRules();
    grid.style.gridTemplateColumns = 'repeat(' + Math.max(1, list.length) + ', minmax(0,1fr))';
    grid.innerHTML = list.map(r => {
      const n = open.filter(a => a.rule === r.name).length;
      const hot = n > 0 && r.level === 'high';
      const color = n === 0 ? 'var(--t3)' : (r.level === 'high' ? 'var(--red)' : r.level === 'mid' ? 'var(--orange)' : 'var(--amber)');
      return `<div class="rule-card ${hot ? 'hot' : ''}" title="${esc(r.code + ' ' + r.name + ' · 阈值 ' + r.threshold + ' · ' + (r.on ? '已启用' : '未启用'))}">
        <div class="rc-t">${esc(r.name)}<span class="tiny dim">${r.code}</span></div>
        <div class="rc-v" style="color:${color}">${n}</div>
        <div class="rc-d">阈值 ${esc(r.threshold)} · ${r.on ? '已启用' : '未启用'}</div>
      </div>`;
    }).join('');
  }

  /* ---------- 列表 ---------- */
  function renderList() {
    const list = filtered();
    const pages = Math.max(1, Math.ceil(list.length / PER));
    if (pageNo > pages) pageNo = pages;
    const rows = list.slice((pageNo - 1) * PER, pageNo * PER);

    if (!rows.length) {
      listBox.innerHTML = UI.empty(status ? '当前筛选下没有预警' : '没有预警记录',
        status === '已闭环' ? '本次演示会话内尚未闭环预警，可在「待处置」中提交处置' : '可切换上方状态或清空筛选条件');
    } else {
      listBox.innerHTML = rows.map(a => `
        <div class="alert-item ${a.id === curId ? 'on' : ''}" data-id="${a.id}">
          <div class="row" style="gap:9px;align-items:flex-start">
            <span class="lvl ${URG_CLS[a.urgency]}"></span>
            <div style="flex:1;min-width:0">
              <div class="ai-top">
                <b>${esc(a.rule)}</b>
                <span class="tag ${a.urgency === 'high' ? 'tag-red' : a.urgency === 'mid' ? 'tag-orange' : 'tag-line'}">${esc(a.levelName)}</span>
                <span class="tag tag-line">${esc(a.metric)}</span>
                ${a.status !== '待处置' ? `<span class="tag ${a.status === '已闭环' ? 'tag-green' : 'tag-blue'}">${esc(a.status)}</span>` : ''}
                <span class="spacer"></span><span class="tiny dim num">${esc(a.id)}</span>
              </div>
              <div class="ai-desc">${esc(a.who)}（${esc(a.town)}）· ${esc(a.desc)}</div>
              <div class="ai-meta"><span>责任单位：${esc(a.dept)}</span><span>责任人：${esc(a.assignee || a.owner)}${a.assignee ? '（已转派）' : ''}</span><span>生成：${esc(a.created)}</span></div>
            </div>
          </div>
        </div>`).join('');
      listBox.querySelectorAll('.alert-item').forEach(n => {
        n.onclick = () => { curId = n.dataset.id; dispo = ''; atts = []; renderList(); renderDetail(); };
      });
    }

    UI.pager(pagerBox, {
      total: list.length, page: pageNo, size: PER, unit: '条',
      onChange: p => { pageNo = p; renderList(); }
    });

    const sub = document.getElementById('listSub');
    if (sub) sub.textContent = (status || '全部') + ' · 按紧急度排序 · 共 ' + list.length + ' 条';
  }

  /* ---------- 详情 / 处置 ---------- */
  function renderDetail() {
    const a = STORE.alert(curId);
    if (!a) {
      pane.innerHTML = `<div class="card"><div class="card-bd">${UI.empty('请选择左侧一条预警', '右侧将显示触发规则、责任链路与处置表单')}</div></div>`;
      return;
    }
    const p = D.personById(a.personId);
    const masked = D.field(STORE.role().key, 'name', p).masked;
    const others = STORE.alerts().filter(x => x.personId === a.personId && x.id !== a.id);
    const st = STORE.alertStats();
    const done = a.status === '已闭环';

    pane.innerHTML = `
      <div class="card">
        <div class="card-hd">
          <div class="card-title">处置 · ${esc(a.rule)} <span class="sub">${esc(a.id)}</span></div>
          <div class="right">
            <span class="tag ${URG_CLS[a.urgency] === 'high' ? 'tag-red' : URG_CLS[a.urgency] === 'mid' ? 'tag-orange' : 'tag-line'}">${URG_CLS[a.urgency] === 'high' ? '紧急' : URG_CLS[a.urgency] === 'mid' ? '一般' : '提示'}</span>
            ${a.status !== '待处置' ? `<span class="tag tag-green">${esc(a.status)}</span>` : ''}
          </div>
        </div>
        <div class="card-bd" style="padding:12px 14px">
          <dl class="kv" style="grid-template-columns:66px 1fr;gap:7px 10px">
            <dt>涉及人员</dt><dd><a class="rowlink" href="person.html?id=${p.id}">${esc(D.field(STORE.role().key, 'name', p).text)}</a> · ${esc(D.levelOf(STORE.levelOf(p)).name)} · ${p.tags.length} 标签</dd>
            <dt>触发规则</dt><dd>${esc(a.rule)} · ${esc(a.metric)}（${esc(a.desc.split('。')[0])}）</dd>
            <dt>风险叠加</dt><dd>${p.dual ? '<span class="flag dual">双在册</span> ' : ''}${p.multi ? '<span class="flag multi">' + p.tags.length + ' 标</span>' : ''}${!p.dual && !p.multi ? '<span class="tiny dim">无</span>' : ''}</dd>
            <dt>责任单位</dt><dd>${esc(a.dept)}</dd>
            <dt>责任人</dt><dd>${esc(a.assignee || a.owner)} · ${esc(p.officerTitle)}${a.assignee ? ` <span class="tag tag-blue" style="height:16px">${esc(a.assignAt || '')} 转派</span>` : ''}</dd>
            <dt>处置时限</dt><dd><span style="color:${done ? 'var(--green)' : 'var(--red)'};font-weight:600">${done ? '已完成 · ' + esc(a.at || '') : '剩余 2 天（生成后 5 日内）'}</span></dd>
          </dl>

          <div class="divider" style="margin:10px 0"></div>
          <div class="sect-title">处置方式 <span style="font-weight:400;color:var(--t4)">必选其一</span></div>
          <div class="opt-row" id="optRow">
            ${['已补走访', '已联系本人', '联合访视', '转派他部门', '申请忽略'].map(t =>
              `<span class="opt ${dispo === t ? 'on' : ''}" data-v="${t}">${t}</span>`).join('')}
          </div>

          <div class="sect-title mt12">处置说明 <span style="font-weight:400;color:var(--t4)">必填 · 不少于 10 字 · 写入走访记录与审计日志</span></div>
          <div class="textarea" id="dispoNote" contenteditable="true" data-ph="请填写处置过程，例如：11-10 已入户走访，本人情绪稳定、服药规律，约定 11-12 联合精防医生上门。">${done ? esc(a.note || '') : ''}</div>

          <div class="row mt10" style="gap:6px;flex-wrap:wrap" id="attRow">
            <label class="tag tag-line" style="cursor:pointer">+ 添加附件<input type="file" id="attInput" multiple hidden></label>
          </div>

          <div class="row mt12" style="gap:7px">
            <input class="input" style="flex:1" id="assignTo" value="指派给：${esc(a.assignee || a.owner)}（${esc(a.dept)}）" readonly>
            <button class="btn" id="btnTransfer">转派</button>
            <button class="btn btn-primary" id="btnSubmit" ${done ? 'disabled' : ''}>${done ? '已闭环' : '提交处置'}</button>
          </div>
          <div class="foot-note" style="padding-top:6px">提交后转为「已闭环」，责任人收到结果通知；操作不可撤销，如需更正请发起补充说明。演示环境下的处置结果保存在本次会话中。</div>
        </div>
      </div>

      <div class="card">
        <div class="card-hd"><div class="card-title">该人员其他预警 <span class="sub">同档案合并显示 · ${others.length} 条</span></div></div>
        <div class="card-bd" style="padding:8px 14px 10px">
          ${others.length ? others.map(o => `
            <div class="li" style="padding:6px 0">
              <span class="tag ${o.urgency === 'high' ? 'tag-red' : 'tag-orange'}">${esc(o.rule)}</span>
              <span class="sm" style="flex:1">${esc(o.metric)} · ${esc(o.created.slice(5, 10))}</span>
              <span class="tag ${o.status === '已闭环' ? 'tag-green' : 'tag-line'}">${esc(o.status)}</span>
            </div>`).join('') : '<div class="tiny dim" style="padding:6px 0">该人员无其他未闭环预警</div>'}
        </div>
        <div class="card-ft">
          <span>本次演示：生成 <b style="color:var(--t1)">${st.total}</b> · 闭环 <b style="color:var(--green)">${st.done}</b> · 待处置 <b style="color:var(--red)">${st.open}</b> · 本月历史闭环 196 条（91.6%）</span>
        </div>
      </div>`;

    /* 附件：真实文件选择 */
    const attInput = document.getElementById('attInput');
    const attRow = document.getElementById('attRow');
    if (attInput) attInput.onchange = () => {
      Array.prototype.forEach.call(attInput.files, f => atts.push(f));
      renderAtts();
    };
    function renderAtts() {
      attRow.querySelectorAll('.att-chip').forEach(n => n.remove());
      atts.forEach((f, i) => {
        const chip = UI.el('span', 'tag tag-line att-chip', `附件：${esc(f.name)} · ${FILEPARSE.sizeText(f.size)} <b style="cursor:pointer;margin-left:3px" data-i="${i}">✕</b>`);
        chip.querySelector('b').onclick = () => { atts.splice(i, 1); renderAtts(); };
        attRow.insertBefore(chip, attRow.lastElementChild);
      });
    }

    /* 处置方式单选 */
    document.querySelectorAll('#optRow .opt').forEach(o => {
      o.onclick = () => {
        dispo = o.dataset.v;
        document.querySelectorAll('#optRow .opt').forEach(x => x.classList.toggle('on', x === o));
      };
    });

    /* 占位提示 */
    const note = document.getElementById('dispoNote');
    if (note && !note.textContent.trim()) note.dataset.empty = '1';

    /* 转派 */
    document.getElementById('btnTransfer').onclick = () => {
      if (!window.guard('edit', '转派')) return;
      /* 接收人取自「系统管理 · 账号与角色 · 处置责任人名录」：
         先列本单位/本属地责任人，再补区级统筹人；名录可在系统管理维护，变更留痕 */
      const all = STORE.responders();
      const near = all.filter(r => r.unit === a.town || r.unit === a.dept);
      const top = all.filter(r => r.kind === '区级' && near.indexOf(r) < 0);
      const list = near.concat(top);
      let picked = list[0] ? (list[0].name + '（' + list[0].unit + '）') : '';
      UI.modal({
        title: '转派责任单位 / 责任人',
        sub: '转派后原责任人收到「已转派」通知，新责任人处置时限重新计算',
        body: `<div class="fld"><label>接收责任人 <span class="tiny dim">共 ${list.length} 人 · 同属地/同部门优先</span></label>
          <div class="ui-radio" id="tList" style="max-height:256px;overflow:auto">
          ${list.map((r, i) => `<label class="${i === 0 ? 'on' : ''}" data-v="${esc(r.name)}（${esc(r.unit)}）">
              <input type="radio" name="tt" ${i === 0 ? 'checked' : ''} style="margin-top:2px">
              <span style="flex:1"><b>${esc(r.name)}</b> · ${esc(r.title)}<br><span>${esc(r.unit)} · ${esc(r.note || '')}</span></span>
              <span class="tag ${r.kind === '区级' ? 'tag-blue' : r.kind === '部门' ? 'tag-orange' : 'tag-line'}" style="height:17px">${esc(r.kind)}</span>
            </label>`).join('')}
        </div></div>
        <div class="tiny dim" style="margin-top:8px">名单来源：系统管理 › 账号与角色 › <a class="rowlink" href="system.html?tab=account&focus=resp" target="_blank">处置责任人名录</a>（可维护，变更写入审计日志）</div>`,
        okText: '确认转派',
        onMount: dlg => {
          dlg.querySelectorAll('#tList label').forEach(l => {
            l.onclick = () => {
              dlg.querySelectorAll('#tList label').forEach(x => x.classList.remove('on'));
              l.classList.add('on'); l.querySelector('input').checked = true;
              picked = l.dataset.v;
            };
          });
        },
        onOk: dlg => {
          const on = dlg.querySelector('#tList label.on');
          const to = on ? on.dataset.v : picked;
          if (!to) { UI.toast.warn('请选择接收责任人'); return false; }
          STORE.transferAlert(a.id, to);
          UI.toast.ok('已转派至 ' + to + '，原责任人已收到通知，记录仍留在待办');
          renderAll();
        }
      });
    };

    /* 提交 */
    const btn = document.getElementById('btnSubmit');
    if (btn && !done) btn.onclick = () => {
      const text = (document.getElementById('dispoNote').textContent || '').trim();
      if (!dispo) { UI.toast.warn('请先选择处置方式'); return; }
      if (text.length < 10) { UI.toast.warn('处置说明不少于 10 字'); return; }
      UI.confirm({
        title: '提交处置结果？',
        sub: `预警 ${a.id}（${a.rule}）将转为「已闭环」，操作不可撤销`,
        body: `<dl class="kv" style="grid-template-columns:64px 1fr;font-size:12px">
          <dt>处置方式</dt><dd><b>${esc(dispo)}</b></dd>
          <dt>处置说明</dt><dd>${esc(text)}</dd>
          <dt>附件</dt><dd>${atts.length ? atts.map(f => esc(f.name)).join('、') : '无'}</dd>
          <dt>操作人</dt><dd>${esc(STORE.role().user)} · ${esc(STORE.role().roleName)}</dd>
        </dl>`,
        okText: '确认提交',
        onOk: () => {
          const note2 = text + (atts.length ? '（附件 ' + atts.length + ' 个）' : '');
          const WAY = { '已补走访': '入户走访', '已联系本人': '电话联系', '联合访视': '联合面访' };
          const via = WAY[dispo];
          STORE.handleAlert(a.id, '已闭环', dispo + '：' + note2);
          /* 与处置方式语义对齐：凡属实际接触的处置，同步写入该人员走访记录，
             转派 / 申请忽略不构成走访，不进走访台账 */
          if (via) {
            STORE.addVisit(a.personId, {
              way: via,
              result: '按预警要求完成' + via + '，' + (text.length > 30 ? text.slice(0, 30) + '…' : text)
            });
          }
          dispo = ''; atts = [];
          UI.toast.ok('已闭环 · ' + a.id + '，处置说明已写入审计日志' + (via ? '与走访记录' : ''));
          renderAll();
        }
      });
    };
  }

  /* ---------- 页头计数 & 状态切换 ---------- */
  function renderHead() {
    const st = STORE.alertStats();
    if (hdr) hdr.textContent = st.open + ' 待处置';
    const seg = document.getElementById('statusSeg');
    if (seg) {
      const btns = seg.querySelectorAll('button');
      btns[0].textContent = '待处置 ' + st.open;
      btns[1].textContent = '处置中 ' + st.doing;
      btns[2].textContent = '已闭环 ' + st.done;
      btns[3].textContent = '全部 ' + st.total;
      btns.forEach(b => {
        b.onclick = () => {
          btns.forEach(x => x.classList.toggle('on', x === b));
          status = b.dataset.v || '';
          pageNo = 1;
          renderList();
        };
      });
    }
    document.querySelectorAll('.nbadge').forEach(n => { if (n.closest('[href="alerts.html"]')) n.textContent = st.open; });
  }

  /* ---------- 筛选下拉 ---------- */
  function initSelects() {
    const towns = [{ v: '', t: '全部镇街' }].concat(
      Array.from(new Set(D.alerts.map(a => a.town))).map(t => ({ v: t, t: t }))
    );
    UI.select(document.getElementById('fTown'), {
      items: towns, value: '', onChange: v => { fTown = v; pageNo = 1; renderList(); }
    });
    const rules = [{ v: '', t: '全部规则' }].concat(STORE.rules().filter(r => r.on).map(r => ({ v: r.name, t: r.name })));
    UI.select(document.getElementById('fRule'), {
      items: rules, value: '', onChange: v => { fRule = v; pageNo = 1; renderList(); }
    });
  }

  /* ---------- 规则配置 ---------- */
  function initRulesBtn() {
    const btn = document.getElementById('btnRules');
    if (btn) btn.onclick = () => {
      UI.modal({
        title: '预警规则配置',
        sub: '阈值与开关仅由政法委主管维护；规则只做提示，不自动调整等级、不自动处置',
        width: 560,
        okText: '保存（演示）',
        body: `<table class="tb compact"><thead><tr><th style="width:58px">编号</th><th>规则</th><th style="width:86px">阈值</th><th style="width:56px">启用</th></tr></thead>
          <tbody>${STORE.rules().map(r => `<tr>
            <td class="tiny dim">${r.code}</td>
            <td><span class="cell-main">${esc(r.name)}</span><span class="cell-sub">${esc(r.desc)}</span></td>
            <td>${esc(r.threshold)}</td>
            <td><span class="cb ${r.on ? 'on' : ''}" data-rule="${r.code}"></span></td>
          </tr>`).join('')}</tbody></table>
          <div class="foot-note" style="padding-top:8px">开关状态仅在当前演示会话内可见，不会改动任何规则数据。</div>`,
        onMount: dlg => {
          dlg.querySelectorAll('.cb').forEach(cb => UI.check(cb, {
            onChange: on => STORE.audit('规则开关', cb.dataset.rule + (on ? ' 启用' : ' 停用'), cb.dataset.rule)
          }));
        }
      });
    };
  }

  /* ---------- 批量指派 ---------- */
  function initAssignBtn() {
    const btn = document.getElementById('btnAssign');
    if (btn) btn.onclick = () => {
      if (!window.guard('approve', '批量指派')) return;
      const list = filtered().filter(a => a.status === '待处置');
      const people = STORE.responders();
      let picked = people[0] ? people[0].name + '（' + people[0].unit + '）' : '';
      UI.modal({
        title: '批量指派责任单位',
        sub: '当前筛选下 ' + list.length + ' 条待处置预警将指派给同一责任人',
        body: `<div class="fld"><label>指派对象 <span class="tiny dim">取自处置责任人名录 · 共 ${people.length} 人</span></label>
          <div class="ui-radio" id="asg" style="max-height:250px;overflow:auto">
          ${people.map((r, i) => `<label class="${i === 0 ? 'on' : ''}" data-v="${esc(r.name)}（${esc(r.unit)}）">
            <input type="radio" name="asg" ${i === 0 ? 'checked' : ''} style="margin-top:2px">
            <span style="flex:1"><b>${esc(r.name)}</b> · ${esc(r.title)}<br><span>${esc(r.unit)} · ${esc(r.note || '')}</span></span>
            <span class="tag ${r.kind === '区级' ? 'tag-blue' : r.kind === '部门' ? 'tag-orange' : 'tag-line'}" style="height:17px">${esc(r.kind)}</span>
          </label>`).join('')}
          </div></div>
          <div class="fld"><label>指派说明</label><input type="text" id="asgNote" placeholder="例如：重点时期集中核查，3 个工作日内反馈"></div>
          <div class="tiny dim" style="margin-top:8px">名单来源：系统管理 › 账号与角色 › <a class="rowlink" href="system.html?tab=account&focus=resp" target="_blank">处置责任人名录</a></div>`,
        okText: '确认指派',
        onMount: dlg => {
          dlg.querySelectorAll('#asg label').forEach(l => {
            l.onclick = () => {
              dlg.querySelectorAll('#asg label').forEach(x => x.classList.remove('on'));
              l.classList.add('on'); l.querySelector('input').checked = true;
              picked = l.dataset.v;
            };
          });
        },
        onOk: dlg => {
          const on = dlg.querySelector('#asg label.on');
          const to = on ? on.dataset.v : picked;
          const note = dlg.querySelector('#asgNote').value.trim();
          if (!to) { UI.toast.warn('请选择指派对象'); return false; }
          list.forEach(a => STORE.handleAlert(a.id, '处置中', '指派至 ' + to + (note ? ' · ' + note : '')));
          UI.toast.ok('已指派 ' + list.length + ' 条预警，状态转为「处置中」');
          renderAll();
        }
      });
    };
  }

  function renderAll() {
    if (!curId) {
      const first = filtered()[0];
      if (first) curId = first.id;
    }
    renderHead(); renderRules(); renderList(); renderDetail();
  }

  initSelects();
  initRulesBtn();
  initAssignBtn();
  renderAll();
})();
