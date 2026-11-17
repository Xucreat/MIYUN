/* ============================================================
   page-query.js · 组合查询（人员台账 · ?tab=query）
   ------------------------------------------------------------
   独立查询状态 Q + 独立渲染：查询只重算右侧「命中结果」与统计，
   不再切换页面布局（旧实现把「查询」当成切到台账视图）。
   数据源：DATA.persons（含本会话导入），与人员台账、驾驶舱同源。
   ============================================================ */
(function () {
  'use strict';
  const D = window.DATA, S = window.STORE, esc = UI.esc;
  const panel = document.querySelector('[data-panel="query"]');
  if (!panel || !D || !S) return;

  const nm = p => D.field(S.role().key, 'name', p).text;
  const idOf = p => D.field(S.role().key, 'idNo', p).text;
  const lvOf = p => D.levelOf(S.levelOf(p));

  /* ---------- 选项 ---------- */
  const LV_OPTS = [
    { v: 'highPlus', t: '高风险及以上' },
    { v: 'high2', t: '极高风险' },
    { v: 'high', t: '高风险' },
    { v: 'mid', t: '中风险' },
    { v: 'low', t: '低风险' },
    { v: 'unknown', t: '待核实' }
  ];
  const VISIT_OPTS = [
    { v: '7d', t: '近 7 日未走访' },
    { v: '30d', t: '近 30 日未走访' },
    { v: 'lost', t: '失访 / 拒访（≥ 90 日）' }
  ];
  const FLAG_OPTS = [
    { v: 'dual', t: '双在册' },
    { v: 'multi', t: '多重标签' },
    { v: 'triple', t: '三重标签' },
    { v: 'noBasis', t: '依据缺失' },
    { v: 'noOfficer', t: '未指定包联' },
    { v: 'new', t: '本月新增' }
  ];
  const deptOpts = () => {
    const s = {};
    D.persons.forEach(p => { if (p.dept) s[p.dept] = 1; });
    return [{ v: '', t: '全部单位' }].concat(Object.keys(s).sort((a, b) => a.localeCompare(b, 'zh')).map(k => ({ v: k, t: k })));
  };
  const statusOpts = () => {
    const s = {};
    D.persons.forEach(p => { if (p.status) s[p.status] = 1; });
    return [{ v: '', t: '全部状态' }].concat(Object.keys(s).map(k => ({ v: k, t: k })));
  };

  const blankQ = () => ({
    kw: '', tags: [], sem: 'and', diffTag: '',
    levels: [], towns: [], dept: '', status: '',
    visit: [], flags: []
  });
  const Q = blankQ();
  const VIEW = { tagAll: false, townAll: false, page: 1, size: 20 };

  /* 默认条件：城区两街道 + 高风险及以上 + 近 30 日未走访（与旧界面口径一致，但数字为真实命中） */
  Q.levels = ['highPlus'];
  Q.towns = ['鼓楼街道', '果园街道'];
  Q.visit = ['30d'];

  /* ---------- 匹配 ---------- */
  function matchWith(p, q) {
    const kw = (q.kw || '').trim();
    if (kw) {
      const kwU = kw.toUpperCase();
      const hit = p.name.indexOf(kw) > -1 ||
        (p.no || '').toUpperCase().indexOf(kwU) > -1 ||
        (p.idNo || '').slice(-4) === kw ||
        (p.idNo || '').indexOf(kw) > -1;
      if (!hit) return false;
    }
    const tags = p.tags || [];
    if (q.tags.length) {
      if (q.sem === 'and') {
        if (!q.tags.every(t => tags.indexOf(t) > -1)) return false;
      } else if (q.sem === 'only') {
        if (tags.length !== q.tags.length || !q.tags.every(t => tags.indexOf(t) > -1)) return false;
      } else {
        if (tags.indexOf(q.tags[0]) < 0) return false;
        if (q.diffTag && tags.indexOf(q.diffTag) > -1) return false;
      }
    }
    if (q.levels.length) {
      const key = S.levelOf(p), order = D.levelOf(key).order;
      const ok = q.levels.some(v => v === 'highPlus' ? order <= 1 : key === v);
      if (!ok) return false;
    }
    if (q.towns.length && q.towns.indexOf(p.town) < 0) return false;
    if (q.dept && p.dept !== q.dept) return false;
    if (q.status && p.status !== q.status) return false;
    if (q.visit.length) {
      const ok = q.visit.some(v => v === '7d' ? p.visitGap > 7 : v === '30d' ? p.visitGap > 30 : p.visitGap >= 90);
      if (!ok) return false;
    }
    if (q.flags.length) {
      const ok = q.flags.every(f =>
        f === 'dual' ? !!p.dual :
        f === 'multi' ? tags.length > 1 :
        f === 'triple' ? tags.length > 2 :
        f === 'noBasis' ? !!p.noBasis :
        f === 'noOfficer' ? (!p.officer || p.officer === '待指派') :
        f === 'new' ? String(p.since || '') >= '2026-11' : true);
      if (!ok) return false;
    }
    return true;
  }
  const match = p => matchWith(p, Q);
  function results() {
    return STORE.view(D.persons).filter(match)   /* dept 角色只在本部门人员中查询 */
      .sort((a, b) => (lvOf(a).order - lvOf(b).order) || (b.visitGap - a.visitGap) || a.id.localeCompare(b.id));
  }

  /* ---------- 小工具 ---------- */
  function chipHTML(opts, sel, attr) {
    return opts.map(o => `<span class="chip-select${sel.indexOf(o.v) > -1 ? ' on' : ''}" data-${attr || 'v'}="${esc(o.v)}">${esc(o.t)}</span>`).join('');
  }
  function bindChips(box, onPick) {
    if (!box) return;
    box.querySelectorAll('.chip-select').forEach(n => {
      n.style.cursor = 'pointer';
      n.onclick = () => { n.classList.toggle('on'); onPick(n.dataset.v, getSel(box)); };
    });
  }
  function getSel(box) {
    return box ? Array.from(box.querySelectorAll('.chip-select.on')).map(n => n.dataset.v) : [];
  }

  /* ---------- 条件区渲染 ---------- */
  function renderConditions() {
    const tagBox = document.getElementById('qTagBox');
    if (tagBox) {
      const list = VIEW.tagAll ? D.TAGS : D.TAGS.slice(0, 6);
      tagBox.innerHTML = chipHTML(list.map(t => ({ v: t.name, t: t.name })), Q.tags);
      bindChips(tagBox, (v, sel) => { Q.tags = sel; if (Q.sem === 'diff' && !Q.diffTag) Q.diffTag = ''; run(); });
      const more = document.getElementById('qTagMore');
      if (more) {
        more.textContent = VIEW.tagAll ? '收起' : `展开全部 ${D.TAGS.length} 类 ›`;
        more.onclick = () => { VIEW.tagAll = !VIEW.tagAll; renderConditions(); };
      }
    }
    const lvBox = document.getElementById('qLevelBox');
    if (lvBox) {
      lvBox.innerHTML = chipHTML(LV_OPTS, Q.levels);
      bindChips(lvBox, (v, sel) => { Q.levels = sel; run(); });
    }
    const townBox = document.getElementById('qTownBox');
    if (townBox) {
      const all = D.towns.map(t => ({ v: t.key, t: t.key }));
      const list = VIEW.townAll ? all : all.filter((t, i) => i < 6 || Q.towns.indexOf(t.v) > -1);
      townBox.innerHTML = chipHTML(list, Q.towns);
      bindChips(townBox, (v, sel) => { Q.towns = sel; run(); });
      const more = document.getElementById('qTownMore');
      if (more) {
        more.textContent = VIEW.townAll ? '收起' : `展开全部 ${all.length} 个镇街 ›`;
        more.onclick = () => { VIEW.townAll = !VIEW.townAll; renderConditions(); };
      }
    }
    const visitBox = document.getElementById('qVisitBox');
    if (visitBox) {
      visitBox.innerHTML = chipHTML(VISIT_OPTS, Q.visit);
      bindChips(visitBox, (v, sel) => { Q.visit = sel; run(); });
    }
    const flagBox = document.getElementById('qFlagBox');
    if (flagBox) {
      flagBox.innerHTML = chipHTML(FLAG_OPTS, Q.flags);
      bindChips(flagBox, (v, sel) => { Q.flags = sel; run(); });
    }
    /* 语义 */
    const semBox = document.getElementById('qSem');
    if (semBox) {
      semBox.querySelectorAll('.sem').forEach(n => {
        n.classList.toggle('on', n.dataset.v === Q.sem);
        n.onclick = () => {
          Q.sem = n.dataset.v;
          semBox.querySelectorAll('.sem').forEach(x => x.classList.toggle('on', x === n));
          const wrap = document.getElementById('qDiffWrap');
          if (wrap) wrap.style.display = Q.sem === 'diff' ? '' : 'none';
          run();
        };
      });
      const wrap = document.getElementById('qDiffWrap');
      if (wrap) wrap.style.display = Q.sem === 'diff' ? '' : 'none';
    }
    /* 关键词 */
    const kw = document.getElementById('qKw');
    if (kw && kw.value !== Q.kw) kw.value = Q.kw;
    if (kw) kw.oninput = () => { Q.kw = kw.value; run(); };

    paintCondCount();
  }

  function paintCondCount() {
    let n = 0;
    if (Q.kw.trim()) n++;
    if (Q.tags.length) n++;
    if (Q.levels.length) n++;
    if (Q.towns.length) n++;
    if (Q.dept) n++;
    if (Q.status) n++;
    if (Q.visit.length) n++;
    if (Q.flags.length) n++;
    const el = document.getElementById('qCondCount');
    if (el) el.textContent = n ? n + ' 项已设' : '未设条件';
  }

  /* ---------- 当前条件回显（随选择实时变化，可单项移除） ---------- */
  function renderEcho() {
    const box = document.getElementById('qEcho');
    if (!box) return;
    const parts = [];
    const push = (k, label, text) => parts.push(`<span class="ec" data-k="${k}"><b>${label}</b> ${esc(text)} <span class="x" data-x="${k}" style="cursor:pointer">✕</span></span>`);
    if (Q.kw.trim()) push('kw', '关键词', Q.kw.trim());
    if (Q.tags.length) {
      const label = Q.sem === 'and' ? '交集' : Q.sem === 'only' ? '仅含' : '差集';
      push('tags', '标签·' + label, Q.tags.join(' + ') + (Q.sem === 'diff' && Q.diffTag ? ' 不含 ' + Q.diffTag : ''));
    }
    if (Q.levels.length) push('levels', '等级', Q.levels.map(v => (LV_OPTS.find(o => o.v === v) || {}).t || v).join('、'));
    if (Q.towns.length) push('towns', '镇街', Q.towns.join('、'));
    if (Q.dept) push('dept', '单位', Q.dept);
    if (Q.status) push('status', '状态', Q.status);
    if (Q.visit.length) push('visit', '走访', Q.visit.map(v => (VISIT_OPTS.find(o => o.v === v) || {}).t || v).join('、'));
    if (Q.flags.length) push('flags', '标识', Q.flags.map(v => (FLAG_OPTS.find(o => o.v === v) || {}).t || v).join('、'));

    box.innerHTML = parts.length
      ? `<span class="tiny dim">当前条件：</span>${parts.join('')}<span class="tiny dim">同时满足</span>`
      : '<span class="tiny dim">当前条件：未设任何条件（展示全部在册人员）</span>';

    box.querySelectorAll('[data-x]').forEach(n => {
      n.onclick = () => {
        const k = n.dataset.x;
        if (k === 'tags') { Q.tags = []; Q.diffTag = ''; }
        else if (k === 'levels') Q.levels = [];
        else if (k === 'towns') Q.towns = [];
        else if (k === 'visit') Q.visit = [];
        else if (k === 'flags') Q.flags = [];
        else if (k === 'kw') Q.kw = '';
        else if (k === 'dept') Q.dept = '';
        else if (k === 'status') Q.status = '';
        renderConditions();
        run();
      };
    });
  }

  /* ---------- 结果表 ---------- */
  const SEL = new Set();
  const COLS = ['name', 'tags', 'level', 'town', 'officer', 'visit', 'idNo'];
  const COLS_OFF = (function () {
    try { return JSON.parse(localStorage.getItem('miyun-q-cols') || '[]'); } catch (e) { return []; }
  })();

  function applyCols() {
    const head = document.getElementById('qHead');
    if (!head) return;
    head.querySelectorAll('th[data-col]').forEach(th => {
      const off = COLS_OFF.indexOf(th.dataset.col) > -1;
      th.style.display = off ? 'none' : '';
      const idx = Array.prototype.indexOf.call(head.children, th);
      document.querySelectorAll('#qBody tr').forEach(tr => {
        const td = tr.children[idx];
        if (td) td.style.display = off ? 'none' : '';
      });
    });
  }

  function renderResult() {
    const list = results();
    const total = STORE.view(D.persons).length;   /* 占比分母同口径：dept 视角为本部门总数 */
    const cnt = document.getElementById('qCount');
    if (cnt) cnt.textContent = list.length;
    const sub = document.getElementById('qSub');
    if (sub) sub.textContent = total ? `占在册 ${(list.length / total * 100).toFixed(1)}% · 按管控风险序排列` : '';

    const pages = Math.max(1, Math.ceil(list.length / VIEW.size));
    VIEW.page = Math.min(Math.max(1, VIEW.page), pages);
    const page = list.slice((VIEW.page - 1) * VIEW.size, VIEW.page * VIEW.size);
    const body = document.getElementById('qBody');
    if (body) {
      body.innerHTML = page.length ? page.map(p => {
        const lv = lvOf(p);
        const checked = SEL.has(p.id);
        return `<tr data-id="${esc(p.id)}">
          <td><span class="cb${checked ? ' on' : ''}" data-ck="${esc(p.id)}"></span></td>
          <td><span class="cell-main">${esc(nm(p))}</span><span class="cell-sub num">${esc(p.no)}</span></td>
          <td><div class="tagstack">${(p.tags || []).map(t => `<span class="tag tag-line" style="height:18px;font-size:10.5px">${esc(t)}</span>`).join('')}</div></td>
          <td><span class="${lv.cls}">${esc(lv.name)}</span></td>
          <td>${esc(p.town)}</td>
          <td class="tiny">${esc(p.officer || '—')}</td>
          <td class="tiny${p.visitGap > 30 ? ' warn-txt' : ''}">${p.visitGap ? p.visitGap + ' 天' : '未走访'}</td>
          <td class="tiny num">${esc(idOf(p))}</td>
        </tr>`;
      }).join('') : `<tr><td colspan="8">${UI.empty('没有命中记录', '试着放宽条件：减少标签、扩大镇街范围或取消走访状态限制')}</td></tr>`;

      body.querySelectorAll('[data-ck]').forEach(n => {
        n.onclick = e => {
          e.stopPropagation();
          const id = n.dataset.ck;
          if (SEL.has(id)) SEL.delete(id); else SEL.add(id);
          n.classList.toggle('on');
          paintBulk();
        };
      });
      body.querySelectorAll('tr[data-id]').forEach(tr => {
        tr.ondblclick = () => { location.href = 'person.html?id=' + encodeURIComponent(tr.dataset.id); };
      });
    }
    const pager = document.getElementById('qPager');
    if (pager) {
      UI.pager(pager, {
        total: list.length, page: VIEW.page, size: VIEW.size, unit: '条',
        onChange: pg => { VIEW.page = pg; renderResult(); }
      });
    }
    applyCols();
    paintBulk();
    return list;
  }

  function paintBulk() {
    const all = document.getElementById('qCheckAll');
    const list = results();
    if (all) {
      all.classList.toggle('on', list.length > 0 && list.every(p => SEL.has(p.id)));
      all.onclick = () => {
        const on = !all.classList.contains('on');
        list.forEach(p => { if (on) SEL.add(p.id); else SEL.delete(p.id); });
        renderResult();
      };
    }
    const n = SEL.size;
    const b = document.getElementById('qExport');
    if (b) b.textContent = n ? `脱敏导出（已选 ${n}）` : '脱敏导出';
  }

  function run() {
    VIEW.page = 1;
    SEL.clear();
    renderEcho();
    renderResult();
    paintCondCount();
    paintGate();
  }

  /* ---------- 常用方案 ---------- */
  const DEFAULT_SCHEMES = [
    { id: 's1', tag: '重点', cls: 'tag-red', name: '城区未走访高风险', q: { levels: ['highPlus'], towns: ['鼓楼街道', '果园街道'], visit: ['30d'] } },
    { id: 's2', tag: '盲区', cls: 'tag-orange', name: '双在册未确认', q: { flags: ['dual'] } },
    { id: 's3', tag: '盲区', cls: 'tag-purple', name: '三重标签叠加', q: { flags: ['triple'] } },
    { id: 's4', tag: '质量', cls: 'tag-amber', name: '依据缺失待补录', q: { flags: ['noBasis'] } },
    { id: 's5', tag: '报送', cls: 'tag-slate', name: '本月新增人员', q: { flags: ['new'] } }
  ];
  function loadSchemes() {
    let custom = [];
    try { custom = JSON.parse(sessionStorage.getItem('miyun-q-schemes') || '[]'); } catch (e) { custom = []; }
    return DEFAULT_SCHEMES.concat(custom);
  }
  function saveSchemes(list) {
    const custom = list.filter(x => x.id.indexOf('c') === 0);
    try { sessionStorage.setItem('miyun-q-schemes', JSON.stringify(custom)); } catch (e) { /* ignore */ }
  }
  function countOf(q) {
    const merged = Object.assign(blankQ(), q);
    return STORE.view(D.persons).filter(p => matchWith(p, merged)).length;
  }
  function renderSaved() {
    const box = document.getElementById('qSaved');
    if (!box) return;
    const list = loadSchemes();
    box.innerHTML = list.map(s => `<div class="saved-item" data-s="${esc(s.id)}" style="cursor:pointer">
      <span class="tag ${s.cls}" style="height:16px;font-size:10px">${esc(s.tag)}</span>${esc(s.name)}
      <span class="spacer"></span><span class="tiny dim">${countOf(s.q)}</span></div>`).join('');
    box.querySelectorAll('[data-s]').forEach(n => {
      const s = list.find(x => x.id === n.dataset.s);
      n.onclick = () => applyScheme(s);
    });
    const cnt = document.getElementById('qSavedCount');
    if (cnt) cnt.textContent = list.length + ' 套';
  }
  function applyScheme(s) {
    Object.assign(Q, blankQ(), s.q);
    /* 方案里的数组要做拷贝，避免与方案对象共享引用 */
    ['tags', 'levels', 'towns', 'visit', 'flags'].forEach(k => { Q[k] = (s.q[k] || []).slice(); });
    Q.kw = s.q.kw || '';
    Q.sem = s.q.sem || 'and';
    Q.diffTag = s.q.diffTag || '';
    Q.dept = s.q.dept || '';
    Q.status = s.q.status || '';
    SEL.clear();
    renderConditions();
    run();
    UI.toast.ok('已套用方案「' + s.name + '」：左侧条件已同步，右侧命中 ' + results().length + ' 人');
  }

  /* ---------- 导出 / 批量 ---------- */
  function targetList() {
    const list = results();
    if (!SEL.size) return { list, fromSel: false };
    return { list: list.filter(p => SEL.has(p.id)), fromSel: true };
  }
  function renderFlow() {
    const tb = document.getElementById('qFlow');
    if (!tb) return;
    const mine = S.exports().slice(0, 3);
    const base = [
      { at: '2026-11-10 09:52', by: '陈志远', scope: '重点时期名单 37 人', mode: '脱敏' },
      { at: '2026-11-09 16:20', by: '李强', scope: '公安涉访台账 128 人', mode: '明文' },
      { at: '2026-11-08 10:05', by: '周敏', scope: '信访月度报送 96 人', mode: '脱敏' }
    ];
    const rows = mine.concat(base).slice(0, 3);
    tb.innerHTML = rows.map(r => `<tr>
      <td><span class="cell-main num">${esc((r.at || '').slice(5))}</span><span class="cell-sub">${esc(r.by || '—')}</span></td>
      <td>${esc(r.scope || '')}</td>
      <td class="r"><span class="tag ${r.mode === '明文' ? 'tag-amber' : 'tag-blue'}" style="height:17px">${esc(r.mode || '脱敏')}</span></td>
    </tr>`).join('');
  }

  /* ---------- 脱敏导出 ----------
     关键点：导出文件一律脱敏，与「当前登录角色能看到什么」无关。
     过去直接用 nm()/idOf()，它们走 D.field(role,…)；admin 的 idNo='full'
     于是导出的 CSV 里是明文姓名 + 明文身份证，与按钮文案「脱敏」矛盾。
     这里改为固定调用 D.maskName / D.maskId，并在首行写水印。 */
  function watermarkLine(count, purpose) {
    const who = S.role();
    const day = (S.wtToday ? S.wtToday() : '2026-11-10');
    const seq = 'MZ-' + day.replace(/-/g, '') + '-' + String(Math.floor(Math.random() * 9000) + 1000);
    return '本文件为脱敏导出，禁止转发 ｜ 导出人 ' + who.user + '（' + who.roleName + '）｜ ' +
      day + ' 09:45 ｜ 共 ' + count + ' 条 ｜ 用途 ' + (purpose || '内部核实') + ' ｜ 水印编号 ' + seq;
  }

  function exportMasked() {
    if (!window.guard('export', '脱敏导出')) return;
    const t = targetList();
    if (!t.list.length) { UI.toast('当前无可导出的记录'); return; }
    const head = ['序号', '姓名（脱敏）', '档案号', '身份证号（脱敏）', '责任镇街', '管控等级', '类别标签', '包联干部', '未走访天数'];
    const data = t.list.map((p, i) => [
      i + 1,
      D.maskName(p.name),
      p.no,
      D.maskId(p.idNo),
      p.town,
      lvOf(p).name,
      (p.tags || []).join('/'),
      p.officer || '',
      p.visitGap
    ]);
    UI.downloadCSV('组合查询_命中名单_脱敏_2026-11-10.csv',
      [[watermarkLine(data.length)], [], head].concat(data));
    S.addExport('组合查询命中名单 ' + data.length + ' 人' + (t.fromSel ? '（已选）' : ''), data.length, '脱敏');
    S.audit('组合查询导出', `${data.length} 人 · 脱敏输出 · 条件：${echoText()}`, '组合查询');
    renderFlow();
    UI.toast.ok('已导出 ' + data.length + ' 人（姓名与身份证已脱敏 · 首行含水印）');
  }

  function echoText() {
    const p = [];
    if (Q.kw.trim()) p.push('关键词 ' + Q.kw.trim());
    if (Q.tags.length) p.push('标签 ' + Q.tags.join('+'));
    if (Q.levels.length) p.push('等级 ' + Q.levels.join('/'));
    if (Q.towns.length) p.push('镇街 ' + Q.towns.join('/'));
    if (Q.visit.length) p.push('走访 ' + Q.visit.join('/'));
    if (Q.flags.length) p.push('标识 ' + Q.flags.join('/'));
    return p.join('，') || '全量';
  }

  function batchAssign() {
    if (!window.guard('edit', '批量指派走访')) return;
    const t = targetList();
    if (!t.list.length) { UI.toast('当前无可指派的记录'); return; }
    const officers = S.respondersOf('属地');
    UI.modal({
      title: '批量指派走访 · ' + t.list.length + ' 人',
      sub: t.fromSel ? '仅对勾选记录生效' : '未勾选记录时对当前全部命中记录生效',
      width: 470,
      okText: '确认指派',
      body: `<div class="fld"><label>指派给（属地包联干部）</label><div class="select" id="qaTo" style="height:32px"></div></div>
        <div class="fld"><label>要求完成时限</label><div class="select" id="qaDue" style="height:32px"></div></div>
        <div class="fld"><label>指派说明</label><input type="text" id="qaNote" placeholder="例如：11 月重点时期，须 3 日内完成入户并回传照片"></div>`,
      onMount: dlg => {
        UI.select(dlg.querySelector('#qaTo'), { items: officers.map(o => ({ v: o.name, t: o.name + ' · ' + o.unit })), value: officers[0] && officers[0].name });
        UI.select(dlg.querySelector('#qaDue'), { items: [{ v: '3', t: '3 日内' }, { v: '7', t: '7 日内' }, { v: '24', t: '24 小时内' }] });
      },
      onOk: dlg => {
        const to = dlg.querySelector('#qaTo').textContent.split(' · ')[0].trim();
        const due = dlg.querySelector('#qaDue').textContent;
        const note = (dlg.querySelector('#qaNote').value || '').trim();
        t.list.forEach(p => { p.officer = to; });
        S.audit('批量指派走访', `${t.list.length} 人指派给 ${to}，限时 ${due}${note ? '：' + note : ''}（组合查询）`, '组合查询');
        run();
        UI.toast.ok('已指派 ' + t.list.length + ' 人给 ' + to);
        return true;
      }
    });
  }

  function watchList() {
    if (!window.guard('edit', '生成盯控名单')) return;
    const t = targetList();
    if (!t.list.length) { UI.toast('当前无可生成的记录'); return; }
    UI.modal({
      title: '生成盯控名单 · ' + t.list.length + ' 人',
      sub: '盯控名单生成为内部参考清单（供统筹研判与后续核查），名单口径与「重点时期管控」应见未见一致',
      width: 620,
      okText: '生成并导出',
      body: `<div class="tiny" style="line-height:1.8;color:var(--t2)">名单口径：${esc(echoText())}</div>
        <div class="table-wrap" style="max-height:230px;overflow:auto;border:1px solid var(--line);border-radius:9px;margin-top:8px">
          <table class="tb compact"><thead><tr><th style="width:34px">#</th><th>姓名</th><th style="width:96px">镇街</th><th style="width:80px">等级</th><th class="r" style="width:66px">未走访</th></tr></thead>
          <tbody>${t.list.slice(0, 60).map((p, i) => `<tr><td class="dim num">${i + 1}</td><td>${esc(nm(p))}</td><td>${esc(p.town)}</td>
            <td class="tiny">${esc(lvOf(p).name)}</td><td class="r tiny"${p.visitGap > 30 ? ' style="color:var(--red)"' : ''}>${p.visitGap} 天</td></tr>`).join('')}</tbody></table>
        </div>
        ${t.list.length > 60 ? '<div class="tiny dim" style="margin-top:6px">仅预览前 60 条，导出为全量 ' + t.list.length + ' 条</div>' : ''}`,
      onOk: () => {
        const head = ['序号', '姓名', '档案号', '责任镇街', '管控等级', '包联干部', '未走访天数'];
        const data = t.list.map((p, i) => [i + 1, nm(p), p.no, p.town, lvOf(p).name, p.officer || '', p.visitGap]);
        UI.downloadCSV('盯控名单_2026-11-10.csv', [head].concat(data));
        S.addExport('盯控名单 ' + data.length + ' 人', data.length, '脱敏');
        S.audit('生成盯控名单', `${data.length} 人 · 条件：${echoText()}`, '组合查询');
        renderFlow();
        UI.toast.ok('盯控名单已生成并导出（' + data.length + ' 人）');
        return true;
      }
    });
  }

  /* ---------- 列设置 / 我的导出记录 / 存为常用方案 ---------- */
  const COL_NAME = { name: '姓名 / 档案号', tags: '类别标签', level: '管控等级', town: '责任镇街', officer: '包联干部', visit: '最近走访', idNo: '身份证号' };
  function openCols() {
    UI.modal({
      title: '列设置',
      sub: '勾选需要显示的列，设置会记在本机（localStorage），下次进入自动生效',
      width: 420,
      okText: '保存',
      body: `<div class="chips" id="colChips">${COLS.map(c =>
        `<span class="chip-select${COLS_OFF.indexOf(c) > -1 ? '' : ' on'}" data-v="${c}">${COL_NAME[c]}</span>`).join('')}</div>
        <div class="tiny dim" style="margin-top:9px">姓名、身份证号按当前角色的字段密级展示；隐藏列后导出仍包含全部字段。</div>`,
      onMount: dlg => UI.chips(dlg.querySelector('#colChips')),
      onOk: dlg => {
        const on = Array.from(dlg.querySelectorAll('#colChips .chip-select.on')).map(n => n.dataset.v);
        if (!on.length) { UI.toast.err('至少保留一列'); return false; }
        COLS_OFF.length = 0;
        COLS.filter(c => on.indexOf(c) < 0).forEach(c => COLS_OFF.push(c));
        try { localStorage.setItem('miyun-q-cols', JSON.stringify(COLS_OFF)); } catch (e) { /* ignore */ }
        applyCols();
        UI.toast.ok('列设置已保存');
        return true;
      }
    });
  }

  function openMyExports() {
    const list = S.exports();
    UI.modal({
      title: '我的导出记录',
      sub: '仅显示当前账号在本会话内的导出，全部流水见「系统管理 → 审计日志」',
      width: 660,
      okText: null,
      cancelText: '关闭',
      footLeft: '<a class="btn btn-sm" href="system.html?tab=audit&op=export">前往审计日志</a>',
      body: list.length ? `<div class="table-wrap" style="max-height:320px;overflow:auto;border:1px solid var(--line);border-radius:9px">
        <table class="tb compact"><thead><tr><th style="width:130px">时间</th><th style="width:92px">操作人</th><th>内容</th><th class="r" style="width:70px">条数</th><th class="r" style="width:70px">方式</th></tr></thead>
        <tbody>${list.map(r => `<tr><td class="tiny num">${esc(r.at)}</td><td class="tiny">${esc(r.by || '')}</td>
          <td>${esc(r.scope || '')}</td><td class="r num">${r.count == null ? '—' : r.count}</td>
          <td class="r"><span class="tag ${r.mode === '明文' ? 'tag-amber' : 'tag-blue'}" style="height:17px">${esc(r.mode || '脱敏')}</span></td></tr>`).join('')}</tbody></table></div>`
        : UI.empty('本会话暂无导出记录', '在查询结果右上角点击「脱敏导出」即可生成第一条记录')
    });
  }

  function openSaveScheme() {
    UI.modal({
      title: '存为常用方案',
      sub: '当前查询条件会保存为常用方案，下次点击即可一键还原条件并重算结果',
      width: 440,
      okText: '保存方案',
      body: `<div class="fld"><label>方案名称</label><input type="text" id="schName" placeholder="如：城区未走访高风险（含精障）"></div>
        <div class="fld"><label>分类标签</label><div class="select" id="schTag" style="height:30px"></div></div>
        <div class="tiny" style="margin-top:8px;line-height:1.8;color:var(--t2)">当前条件：${esc(echoText())}<br>命中 <b>${results().length}</b> 人</div>`,
      onMount: dlg => UI.select(dlg.querySelector('#schTag'), {
        items: [{ v: '重点', t: '重点' }, { v: '盲区', t: '盲区' }, { v: '质量', t: '质量' }, { v: '报送', t: '报送' }, { v: '自定义', t: '自定义' }]
      }),
      onOk: dlg => {
        const name = (dlg.querySelector('#schName').value || '').trim();
        if (name.length < 2) { UI.toast.err('方案名称至少 2 个字'); return false; }
        const tag = dlg.querySelector('#schTag').textContent.trim();
        const CLS = { 重点: 'tag-red', 盲区: 'tag-purple', 质量: 'tag-amber', 报送: 'tag-slate', 自定义: 'tag-line' };
        const list = loadSchemes();
        list.push({
          id: 'c' + Date.now(), tag, cls: CLS[tag] || 'tag-line', name,
          q: {
            kw: Q.kw, tags: Q.tags.slice(), sem: Q.sem, diffTag: Q.diffTag,
            levels: Q.levels.slice(), towns: Q.towns.slice(), dept: Q.dept, status: Q.status,
            visit: Q.visit.slice(), flags: Q.flags.slice()
          }
        });
        saveSchemes(list);
        renderSaved();
        S.audit('保存查询方案', name + ' · 命中 ' + results().length + ' 人', '组合查询');
        UI.toast.ok('已保存常用方案「' + name + '」');
        return true;
      }
    });
  }

  /* ---------- 导出授权 ---------- */
  let plainOn = false;
  function paintGate() {
    const n = results().length;
    const el = document.getElementById('qPlainN');
    if (el) el.textContent = n;
    const note = document.getElementById('qGateNote');
    if (note) note.textContent = n >= 50
      ? `本批次 ${n} 条 ≥ 50，需双人复核（政法委主管 → 保密专员，申请人 ≠ 审批人）；文件含水印（账号 + 时间戳）`
      : `本批次 ${n} 条 < 50，由政法委主管单人审批；文件含水印（账号 + 时间戳）`;
    const tag = document.getElementById('qGateTag');
    if (tag) { tag.textContent = plainOn ? '明文导出（待审批）' : '脱敏默认'; tag.className = 'tag ' + (plainOn ? 'tag-amber' : 'tag-blue'); }
  }
  function initGate() {
    const mask = document.getElementById('qGateMask');
    const plain = document.getElementById('qGatePlain');
    if (mask) UI.check(mask, {
      onChange: on => {
        if (!on) { mask.classList.add('on'); UI.toast('脱敏导出为默认方式，不可关闭'); return; }
        plainOn = false;
        if (plain) plain.classList.remove('on');
        paintGate();
      }
    });
    if (plain) UI.check(plain, {
      onChange: on => {
        plainOn = on;
        paintGate();
        if (on) UI.toast('已切换为明文导出，需填写用途并提交审批');
      }
    });
    UI.select(document.getElementById('qPurpose'), {
      items: [{ v: 'p1', t: '重点时期盯控下发' }, { v: 'p2', t: '月度报送' }, { v: 'p3', t: '专项核查' }, { v: 'p4', t: '跨部门协查' }]
    });
    UI.select(document.getElementById('qValid'), {
      items: [{ v: '24', t: '24 小时' }, { v: '72', t: '72 小时' }, { v: '7d', t: '7 日' }]
    });
    const btn = document.getElementById('qSubmitPlain');
    if (btn) btn.onclick = () => {
      if (!plainOn) { UI.toast.err('请先勾选「明文导出」'); return; }
      if (!window.guard('disclosure', '明文导出申请')) return;
      const n = results().length;
      const purpose = (document.getElementById('qPurpose') || {}).textContent || '重点时期盯控下发';
      const valid = (document.getElementById('qValid') || {}).textContent || '24 小时';
      /* 真正生成申请单：落 STORE → 审批中心（risk.html?tab=export）可见、可审、可下载 */
      const req = S.plainReqAdd({
        count: n, purpose, valid,
        scope: echoText()
      });
      renderFlow();
      plainOn = false;
      const plain2 = document.getElementById('qGatePlain');
      if (plain2) plain2.classList.remove('on');
      paintGate();
      renderReqTip(req);
      const chainTxt = req.mode === 'double' ? '双人复核（政法委主管 → 保密专员）' : '单人审批（政法委主管）';
      UI.toast.ok(`申请单 ${req.id} 已提交（${n} 条 · ${purpose} · ${valid}）· ${chainTxt} · 审批通过后可下载`);
    };
  }

  /* 提交后给出可追踪的落点，而不是只弹一句 toast */
  function renderReqTip(req) {
    const box = document.getElementById('qReqTip');
    if (!box) return;
    box.style.display = '';
    box.innerHTML = `申请单 <b>${esc(req.id)}</b> 已进入审批队列（${req.mode === 'double' ? '双人复核' : '单人审批'}）· ` +
      `<a href="risk.html?tab=export&id=${encodeURIComponent(req.id)}" style="color:var(--blue)">前往审批中心查看 ›</a>`;
  }

  /* ---------- 事件绑定 ---------- */
  const bind = (id, fn) => { const n = document.getElementById(id); if (n) n.onclick = fn; };
  bind('qRun', () => { run(); UI.toast.ok('查询已执行，命中 ' + results().length + ' 人'); });
  bind('qReset', () => {
    Object.assign(Q, blankQ());
    SEL.clear();
    renderConditions();
    run();
    UI.toast.ok('条件已重置，当前展示全部在册人员');
  });
  bind('qExport', exportMasked);
  bind('qAssign', batchAssign);
  bind('qWatch', watchList);
  bind('qBtnCols', openCols);
  bind('qBtnExports', openMyExports);
  bind('qBtnSave', openSaveScheme);
  const flowAll = document.getElementById('qFlowAll');
  if (flowAll) flowAll.onclick = () => {
    /* href 已带 ?tab=audit&op=export，直接跳转即可（system.html 会预置「导出」筛选） */
    S.audit('查看导出流水', '跳转 系统管理 → 审计日志（筛选：导出）', '组合查询');
  };

  /* ---------- 初始化 ---------- */
  renderConditions();
  UI.select(document.getElementById('qDept'), {
    items: deptOpts(), value: '', onChange: v => { Q.dept = v; run(); }
  });
  UI.select(document.getElementById('qStatus'), {
    items: statusOpts(), value: '', onChange: v => { Q.status = v; run(); }
  });
  const diffNode = document.getElementById('qDiffTag');
  if (diffNode) UI.select(diffNode, {
    items: [{ v: '', t: '不含（未选）' }].concat(D.TAGS.map(t => ({ v: t.name, t: '不含 ' + t.name }))),
    value: '', onChange: v => { Q.diffTag = v; run(); }
  });
  initGate();
  renderSaved();
  renderFlow();
  run();
})();
