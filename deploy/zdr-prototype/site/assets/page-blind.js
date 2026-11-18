/* ============================================================
   page-blind.js · 盲区人群
   ------------------------------------------------------------
   三类盲区清单全部由台账派生，数字与 KPI / 驾驶舱 / 统计分析同源：
     dual    双侧在册 → persons.filter(dual)      127
     multi   多重标签 → persons.filter(multi)     214
     unknown 待核实   → unrated                   612
   三类存在交叉（dual ∩ multi = 66），去重后 887，与页面口径一致。

   交互：类型切换 / 关键词+镇街+部门+状态筛选 / 排序 / 勾选 /
        批量指派核查 / 生成核查任务 / 导出脱敏清单（按角色密级）
   ============================================================ */
(function () {
  'use strict';
  const D = window.DATA;
  const esc = UI.esc;
  const RK = () => STORE.role().key;
  const fld = (name, p) => D.field(RK(), name, p);

  /* 一屏模式下顶部说明被压成一行（省高度给四卡与清单），
     完整文本挂到 title 上，悬停即可读到全文，避免信息只能靠猜。 */
  (function () {
    const wc = document.querySelector('.why .wc');
    if (wc) wc.title = wc.textContent.replace(/\s+/g, ' ').trim();
  })();

  /* ---------- 数据源 ----------
     dual/multi/待核实 三类清单「现算」而非启动快照：
     并档后 p.dual=false、补评后 unrated.level≠unknown，人员会立即从对应清单移出，
     KPI 与清单条数同步变化，不会出现「操作完还挂在盲区里」的矛盾。 */
  const dualNow = () => STORE.view(D.persons.filter(p => p.dual));
  const multiNow = () => STORE.view(D.persons.filter(p => p.multi));
  const unkNow = () => STORE.view((D.unrated || []).filter(p => p.level === 'unknown'));

  /* 基线快照：仅供「在册组合」与「确认状态」的确定性分配使用，不随操作变化 */
  const DUAL = dualNow();
  const MULTI = multiNow();
  const UNK = unkNow();

  /* 双在册「在册组合」：公安+卫健 103 / 公安+信访 24（与 KPI 逐项一致） */
  const SHORT = {
    '公安分局': '公安', '区卫健委': '卫健', '区信访办': '信访',
    '区司法局': '司法', '区委政法委': '政法委'
  };
  const short = d => SHORT[d] || (d || '').replace(/^区/, '');
  const COMBO = new Map();
  DUAL.forEach((p, i) => COMBO.set(p.id, i < 103 ? ['公安分局', '区卫健委'] : ['公安分局', '区信访办']));

  /* 确认状态：9 条超 7 日未确认 + 17 条已生成核查任务 + 其余已确认
     （「已生成核查任务 26 条」= 9 超期 + 17 进行中，可与 pager 文案对账）
     索引按等差数列跨镇街取样，避免超期人员全挤在同一个街道 */
  const CONF = new Map();
  (function () {
    const n = DUAL.length;
    const pick = (count, phase) => {
      const set = new Set();
      const step = n / count;
      for (let k = 0; k < count; k++) set.add(Math.floor((k + phase) * step) % n);
      return set;
    };
    const over = pick(9, 0.45);
    const task = pick(17, 0.13);
    DUAL.forEach((p, i) => {
      CONF.set(p.id, over.has(i) ? 'over' : task.has(i) ? 'task' : 'ok');
    });
  })();
  const CONF_META = {
    over: { t: '超 7 日未确认', cls: 'tag tag-red', order: 0 },
    task: { t: '已生成核查任务', cls: 'tag tag-amber', order: 1 },
    ok: { t: '已确认', cls: 'tag tag-green', order: 2 }
  };

  /* ---------- 状态 ---------- */
  const S = {
    type: 'dual', page: 1, size: 20,
    kw: '', town: '', dept: '', sort: 'risk', status: '',
    selected: new Set()
  };

  const SOURCES = {
    get dual() { return dualNow(); },
    get multi() { return multiNow(); },
    get unknown() { return unkNow(); }
  };
  const TYPES = {
    dual: { name: '双在册', unit: '人' },
    multi: { name: '多重标签', unit: '人' },
    unknown: { name: '未定级', unit: '人' }
  };
  const SORTS = [
    { v: 'risk', t: '按风险序升序' },
    { v: 'riskDesc', t: '按风险序降序' },
    { v: 'visit', t: '按走访间隔降序' },
    { v: 'town', t: '按属地镇街' }
  ];

  /* ---------- 取当前类型列表 ---------- */
  const base = () => SOURCES[S.type] || [];

  function filtered() {
    const kw = S.kw.trim();
    let list = base().filter(p => {
      if (S.town && p.town !== S.town) return false;
      if (S.dept && p.dept !== S.dept) return false;
      if (S.status && S.type === 'dual' && CONF.get(p.id) !== S.status) return false;
      /* 与看板「未定级超 90 天」同口径：严格大于阈值（visitGap > 90），
         否则恰好等于 90 天的 9 人会被多算，导致看板 37 与清单 46 不一致 */
      if (S.minGap && p.visitGap <= S.minGap) return false;
      if (kw) {
        const hit = p.name.indexOf(kw) >= 0 || p.idNo.slice(-4) === kw || p.idNo.indexOf(kw) >= 0;
        if (!hit) return false;
      }
      return true;
    });
    list = list.slice();
    // 同级内按走访间隔降序（最久未走访的排前面），既符合处置优先级，也避免同镇街人员扎堆
    const byGap = (a, b) => b.visitGap - a.visitGap || a.id.localeCompare(b.id);
    switch (S.sort) {
      case 'riskDesc':
        list.sort((a, b) => D.levelOf(b.level).order - D.levelOf(a.level).order || byGap(a, b));
        break;
      case 'visit':
        list.sort(byGap);
        break;
      case 'town':
        list.sort((a, b) => a.town.localeCompare(b.town, 'zh') || byGap(a, b));
        break;
      default:
        list.sort((a, b) => D.levelOf(a.level).order - D.levelOf(b.level).order || byGap(a, b));
    }
    return list;
  }

  /* ---------- 表头定义（三类各一套） ---------- */
  const COLS = {
    dual: [
      { t: '序号', w: '34px' }, { t: '姓名', w: '72px' }, { t: '身份证号', w: '118px' },
      { t: '在册组合', w: '88px' }, { t: '两部门侧类别 / 等级', min: '180px' },
      { t: '区级等级', w: '76px' }, { t: '属地镇街', w: '80px' }, { t: '包联干部', w: '60px' },
      { t: '确认状态', w: '102px' }, { t: '操作', w: '100px' }
    ],
    multi: [
      { t: '序号', w: '34px' }, { t: '姓名 / 年龄', w: '92px' }, { t: '身份证号', w: '118px' },
      { t: '标签构成', min: '236px' }, { t: '标签数', w: '56px' },
      { t: '区级等级', w: '76px' }, { t: '属地镇街', w: '80px' }, { t: '涉及部门', w: '146px' },
      { t: '包联干部', w: '60px' }, { t: '操作', w: '50px' }
    ],
    unknown: [
      { t: '序号', w: '34px' }, { t: '姓名 / 年龄', w: '92px' }, { t: '身份证号', w: '118px' },
      { t: '类别标签', min: '128px' }, { t: '当前状态', w: '138px' },
      { t: '归属部门', w: '84px' }, { t: '属地镇街', w: '80px' }, { t: '最近走访', w: '140px' },
      { t: '缺依据', w: '58px' }, { t: '操作', w: '100px' }
    ]
  };

  const tagCls = name => (D.TAGS.find(x => x.name === name) || { cls: 'tag tag-line' }).cls;
  /* 部门归属统一走数据层 D.deptsOf（与驾驶舱部门维度共用同一口径） */
  const deptsOf = p => D.deptsOf(p);
  const levelTag = p => {
    const lv = D.levelOf(p.level);
    return `<span class="${lv.cls}">${esc(lv.name)}</span>`;
  };
  const archiveBtn = p => `<a class="btn btn-sm btn-ghost" href="person.html?id=${encodeURIComponent(p.id)}">档案</a>`;
  /* 行内操作：双在册 → 两部门会签并档；未定级 → 提请补评。
     两个动作都会真实改动盲区判定字段（dual / level），并写入审计与化解记录。 */
  const actCell = (p, kind) => {
    const extra = kind === 'dual'
      ? `<button class="btn btn-sm btn-line" data-act="merge" data-id="${p.id}" title="两部门会签并档：合并一人多档，等级就高不就低">并档</button>`
      : (kind === 'unknown'
        ? `<button class="btn btn-sm btn-line" data-act="assess" data-id="${p.id}" title="提请补评：完成风险评估并定级，登记即生效并写入变动台账">补评</button>`
        : '');
    return `<span class="row" style="gap:4px;flex-wrap:nowrap">${archiveBtn(p)}${extra}</span>`;
  };

  /* ---------- 三类行渲染 ---------- */
  function rowDual(p, no) {
    const combo = COMBO.get(p.id) || ['公安分局', '区卫健委'];
    const st = CONF_META[CONF.get(p.id)] || CONF_META.ok;
    const danger = (parseInt(p.id.replace(/\D/g, ''), 10) % 3) + 1;
    // 第一行固定为组合中的第一个部门（公安侧），保证与「在册组合」标签自洽
    const aTag = p.tags.find(t => (D.TAGS.find(x => x.name === t) || {}).dept === combo[0]) || p.tags[0] || '重点人员';
    const lvName = D.levelOf(p.level).name;
    const sideA = `${short(combo[0])} · ${aTag} ${lvName}`;
    const sideB = combo[1] === '区卫健委'
      ? `卫健 · 危险性 ${danger} 级`
      : `信访 · ${p.tags[1] || '涉访 B 类'} ${lvName}`;
    const comboCls = combo[1] === '区卫健委' ? 'tag tag-orange' : 'tag tag-amber';
    return `<tr data-id="${p.id}">
      <td><span class="cb ${S.selected.has(p.id) ? 'on' : ''}" data-sel="${p.id}"></span></td>
      <td class="num">${no}</td>
      <td class="cell-main nowrap"><a href="person.html?id=${encodeURIComponent(p.id)}" style="color:var(--blue)">${esc(fld('name', p).text)}</a></td>
      <td class="mask nowrap">${esc(fld('idNo', p).text)}</td>
      <td><span class="${comboCls}">${esc(short(combo[0]))} + ${esc(short(combo[1]))}</span></td>
      <td class="two-line"><span>${esc(sideA)}</span><span>${esc(sideB)}</span></td>
      <td class="nowrap">${levelTag(p)}</td>
      <td class="nowrap">${esc(p.town)}</td>
      <td>${esc(p.officer)}</td>
      <td><span class="${st.cls}">${esc(st.t)}</span></td>
      <td>${actCell(p, 'dual')}</td>
    </tr>`;
  }

  function rowMulti(p, no) {
    const flags = p.tags.map(t => `<span class="${tagCls(t)}">${esc(t)}</span>`).join('');
    return `<tr data-id="${p.id}">
      <td><span class="cb ${S.selected.has(p.id) ? 'on' : ''}" data-sel="${p.id}"></span></td>
      <td class="num">${no}</td>
      <td class="two-line"><a href="person.html?id=${encodeURIComponent(p.id)}" style="color:var(--blue);font-weight:600">${esc(fld('name', p).text)}</a><span>${esc(p.gender)} · ${p.age}</span></td>
      <td class="mask nowrap">${esc(fld('idNo', p).text)}</td>
      <td><div class="flags">${flags}</div></td>
      <td><span class="tag tag-purple">${p.tags.length}</span></td>
      <td class="nowrap">${levelTag(p)}</td>
      <td class="nowrap">${esc(p.town)}</td>
      <td class="nowrap">${esc(deptsOf(p).join(' / ') || p.dept)}</td>
      <td>${esc(p.officer)}</td>
      <td>${archiveBtn(p)}</td>
    </tr>`;
  }

  function rowUnknown(p, no) {
    const over = p.visitGap > 30;
    const visit = `<span class="nowrap">${over ? '<b style="color:var(--red)">' + esc(p.lastVisit) + '</b>' : esc(p.lastVisit)} · ${p.visitGap} 天</span>`;
    return `<tr data-id="${p.id}">
      <td><span class="cb ${S.selected.has(p.id) ? 'on' : ''}" data-sel="${p.id}"></span></td>
      <td class="num">${no}</td>
      <td class="two-line"><a href="person.html?id=${encodeURIComponent(p.id)}" style="color:var(--blue);font-weight:600">${esc(fld('name', p).text)}</a><span>${esc(p.gender)} · ${p.age}</span></td>
      <td class="mask nowrap">${esc(fld('idNo', p).text)}</td>
      <td><span class="${tagCls(p.tags[0])}">${esc(p.tags[0] || '未分类')}</span></td>
      <td><span class="tag">${esc(p.status)}</span></td>
      <td>${esc(p.dept)}</td>
      <td class="nowrap">${esc(p.town)}</td>
      <td>${visit}</td>
      <td><span class="tag ${over ? 'tag-red' : 'tag-amber'}">是</span></td>
      <td>${actCell(p, 'unknown')}</td>
    </tr>`;
  }

  const ROW = { dual: rowDual, multi: rowMulti, unknown: rowUnknown };

  /* ---------- 渲染 ---------- */
  const wrap = document.getElementById('listWrap');
  const pagerEl = document.getElementById('listPager');
  let pagerApi = null;

  function renderTable() {
    const list = filtered();
    const rows = list.slice((S.page - 1) * S.size, S.page * S.size);
    const cols = COLS[S.type];
    const head = '<th style="width:30px"></th>' + cols.map(c =>
      `<th class="nowrap" style="${c.w ? 'width:' + c.w : 'min-width:' + c.min}">${esc(c.t)}</th>`).join('');

    if (!list.length) {
      wrap.innerHTML = `<table class="tb compact"><thead><tr>${head}</tr></thead></table>
        <div style="padding:34px 0">${UI.empty('没有符合条件的盲区人员', '放宽筛选条件或点「重置」回到全部清单')}</div>`;
      return;
    }
    wrap.innerHTML = `<table class="tb compact">
      <thead><tr>${head}</tr></thead>
      <tbody>${rows.map((p, i) => ROW[S.type](p, (S.page - 1) * S.size + i + 1)).join('')}</tbody>
    </table>`;

    // 勾选
    wrap.querySelectorAll('[data-sel]').forEach(cb => {
      UI.check(cb, {
        onChange: on => {
          if (on) S.selected.add(cb.dataset.sel); else S.selected.delete(cb.dataset.sel);
          syncSel();
        }
      });
    });

    wrap.querySelectorAll('[data-act]').forEach(b => {
      b.onclick = e => {
        e.preventDefault();
        e.stopPropagation();
        const id = b.dataset.id;
        const p = D.personById(id) || (D.unrated || []).find(x => x.id === id);
        if (!p) return;
        if (b.dataset.act === 'merge') openMerge(p);
        else openAssess(p);
      };
    });

    document.getElementById('hitCount').textContent = list.length;
  }

  function syncSel() {
    document.getElementById('selCount').textContent = S.selected.size;
    const btn = document.getElementById('btnAssign');
    if (btn) {
      btn.disabled = S.selected.size === 0;
      btn.title = S.selected.size === 0 ? '请先勾选需要指派核查的人员' : '';
    }
  }

  function renderPager(total) {
    const extra = S.type === 'dual'
      ? ` · 待两部门确认 <b style="color:var(--orange)">9</b> 条 · 已生成核查任务 <b style="color:var(--t1)">26</b> 条`
      : '';
    // 翻页时 UI.pager 会重写容器 innerHTML，故在每次渲染后重新补上口径说明
    UI.pager(pagerEl, {
      total, page: S.page, size: S.size, unit: '条',
      onChange: p => { S.page = p; renderTable(); renderPager(total); }
    });
    if (extra) {
      const span = pagerEl.querySelector('span');
      if (span) span.insertAdjacentHTML('afterend', `<span class="tiny dim">${extra}</span>`);
    }
  }

  function renderAll() {
    const list = filtered();
    const pages = Math.max(1, Math.ceil(list.length / S.size));
    if (S.page > pages) S.page = pages;
    syncKpi();
    renderTable();
    renderPager(list.length);
    syncSel();
    syncTypeUI(list.length);
    renderCond(list.length);
  }

  /* 顶部 KPI 随数据范围收敛：dept 角色只统计本部门人员（政法委主管 / 区领导保持全区口径） */
  function syncKpi() {
    if (STORE.role().scope !== 'dept') return;
    const set = (i, n, meta) => {
      const card = document.querySelectorAll('.kpi')[i];
      if (!card) return;
      const val = card.querySelector('.kpi-val');
      if (val) val.firstChild.nodeValue = n;
      if (meta) { const m = card.querySelector('.kpi-meta'); if (m) m.textContent = meta; }
    };
    set(0, dualNow().length, '本部门主责人员');
    set(1, multiNow().length, '本部门主责人员');
  }

  /* 类型按钮数字随筛选联动：当前类型显示命中数（带区间条件），其余显示库内总数 */
  function syncTypeUI(hit) {
    const root = document.getElementById('segType');
    if (!root) return;
    const tot = { dual: dualNow().length, multi: multiNow().length, unknown: unkNow().length };
    const NAME = { dual: '双在册', multi: '多标', unknown: '未定级' };
    const n = hit == null ? filtered().length : hit;
    Array.prototype.forEach.call(root.querySelectorAll('button'), b => {
      const k = b.dataset.v;
      if (!k || !TYPES[k]) return;
      const cur = k === S.type;
      b.textContent = NAME[k] + ' ' + (cur ? n : tot[k]) + (cur && S.minGap ? ' · > ' + S.minGap + ' 天' : '');
    });
  }

  /* 深链带入的条件在筛选条上可见、可一键清除，避免「筛选条件看不出区别」 */
  function renderCond(hit) {
    const box = document.getElementById('fCond');
    if (box) {
      box.innerHTML = S.minGap
        ? `<span class="tag tag-amber" style="height:22px">走访间隔 > ${S.minGap} 天（来自风险变化告警）<b data-clear-gap="1" style="cursor:pointer;margin-left:5px" title="清除该条件">×</b></span>`
        : '';
      const x = box.querySelector('[data-clear-gap]');
      if (x) x.onclick = () => { S.minGap = 0; S.page = 1; renderAll(); UI.toast('已清除「走访间隔」条件'); };
    }
    const meta = document.getElementById('kpiUnknownMeta');
    if (meta) {
      meta.innerHTML = (S.type === 'unknown' && S.minGap)
        ? `当前筛选命中 <b style="color:var(--t1)">${hit == null ? filtered().length : hit}</b> 人（> ${S.minGap} 天）· 库内总量 ${unkNow().length}`
        : '其中超 30 日未走访 89';
    }
  }

  /* ---------- 筛选控件 ---------- */
  function townItems() {
    return [{ v: '', t: '全部镇街' }].concat(D.towns.map(t => ({ v: t.key, t: t.name, cnt: t.h })));
  }
  function deptItems() {
    const set = new Set(base().map(p => p.dept));
    return [{ v: '', t: '全部部门' }].concat(Array.from(set).filter(Boolean).map(d => ({ v: d, t: d })));
  }
  function refreshStatusField() {
    const el = document.getElementById('fStatus');
    if (el) el.style.display = S.type === 'dual' ? '' : 'none';
  }
  function statusItems() {
    if (S.type !== 'dual') return [{ v: '', t: '不适用（非双在册）' }];
    return [{ v: '', t: '全部确认状态' },
      { v: 'over', t: '超 7 日未确认' }, { v: 'task', t: '已生成核查任务' }, { v: 'ok', t: '已确认' }];
  }

  const selTown = UI.select(document.getElementById('fTown'), {
    items: townItems(), onChange: v => { S.town = v; S.page = 1; renderAll(); }
  });
  const selDept = UI.select(document.getElementById('fDept'), {
    items: deptItems(), onChange: v => { S.dept = v; S.page = 1; renderAll(); }
  });
  const selStatus = UI.select(document.getElementById('fStatus'), {
    items: statusItems(), onChange: v => { S.status = v; S.page = 1; renderAll(); }
  });
  const selSort = UI.select(document.getElementById('fSort'), {
    items: SORTS, onChange: v => { S.sort = v; S.page = 1; renderAll(); }
  });

  const kw = document.getElementById('qKw');
  kw.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); S.kw = kw.value; S.page = 1; renderAll(); }
  });

  document.getElementById('btnQuery').onclick = () => {
    S.kw = kw.value; S.page = 1; renderAll();
    UI.toast.ok(`命中 ${filtered().length} 人`);
  };
  document.getElementById('btnReset').onclick = () => {
    S.kw = ''; S.town = ''; S.dept = ''; S.status = ''; S.sort = 'risk'; S.page = 1; S.minGap = 0; refreshStatusField();
    S.selected.clear();
    kw.value = '';
    selTown.set(''); selDept.set(''); selStatus.set(''); selSort.set('risk');
    renderAll();
    UI.toast('已重置筛选条件');
  };

  /* ---------- 类型切换 ---------- */
  /* 注意：UI.seg 每次调用都会重写按钮 onclick（且新 onChange 为 undefined），
     所以这里必须保存返回的 API 供深链复用，绝不能再调一次 UI.seg(node) —— 
     否则深链进入后三个类型按钮会全部点不动。 */
  const segTypeApi = UI.seg(document.getElementById('segType'), {
    onChange: v => {
      S.type = v; S.page = 1; S.selected.clear();
      S.town = ''; S.dept = ''; S.status = ''; S.kw = ''; kw.value = '';
      S.minGap = 0;                     /* 切类型时清掉区间条件，避免切过去列表为空 */
      selTown.set(''); selDept.set('');
      selDept.items.length = 0;
      deptItems().forEach(i => selDept.items.push(i));
      selStatus.items.length = 0;
      statusItems().forEach(i => selStatus.items.push(i));
      selStatus.set('');
      refreshStatusField();
      renderAll();
    }
  });

  /* ---------- 并档（双在册 → 一人一档） ---------- */
  function openMerge(p) {
    if (!window.guard('edit', '两部门会签并档')) return;
    const combo = COMBO.get(p.id) || ['公安分局', '区卫健委'];
    const lvNow = D.levelOf(STORE.levelOf(p));
    const MAINS = combo.map(d => ({ v: d, t: d + '（' + short(d) + '侧主责）' }));
    const KEEPS = [
      { v: '就高不就低', t: '就高不就低（两档取较高等级）' },
      { v: '取主责部门原等级', t: '取主责部门原等级' },
      { v: '取对方部门原等级', t: '取对方部门原等级' }
    ];
    let main = MAINS[0].v, keep = KEEPS[0].v;
    UI.modal({
      title: '两部门会签并档',
      sub: '合并一人多档为一条档案 · 合并后从「双在册」清单移出，全程留痕',
      width: 520,
      okText: '提交并档',
      body: `
        <dl class="kv" style="grid-template-columns:80px 1fr;font-size:12px;gap:6px 10px;margin-bottom:10px">
          <dt>姓名</dt><dd>${esc(fld('name', p).text)}</dd>
          <dt>身份证号</dt><dd class="mono">${esc(fld('idNo', p).text)}</dd>
          <dt>在册组合</dt><dd>${esc(combo[0])} + ${esc(combo[1])}</dd>
          <dt>当前等级</dt><dd><span class="${lvNow.cls}">${esc(lvNow.name)}</span> · ${esc(p.town)}</dd>
        </dl>
        <div class="fld"><label>主责部门 <span class="tiny dim">合并后由该部门主责管理</span></label><div class="select" id="mgMain">${esc(MAINS[0].t)}</div></div>
        <div class="fld"><label>管控等级口径 <span class="tiny dim">两档等级不一致时的取法</span></label><div class="select" id="mgKeep">${esc(KEEPS[0].t)}</div></div>
        <div class="fld"><label>会签说明（≥ 8 字）</label><textarea id="mgNote" rows="3" placeholder="例如：两部门台账同一身份证号各建 1 档，经会签确认为同一人，保留卫健侧危险性等级子档"></textarea></div>
        <div class="tiny dim">并档只合并档案与责任归属，<b>不改写管控等级</b>；等级如需调整须另走部门定级登记。</div>`,
      onMount: dlg => {
        UI.select(dlg.querySelector('#mgMain'), {
          items: MAINS, value: MAINS[0].v, onChange: v => { main = v; }
        });
        UI.select(dlg.querySelector('#mgKeep'), {
          items: KEEPS, value: KEEPS[0].v, onChange: v => { keep = v; }
        });
        setTimeout(() => { const ta = dlg.querySelector('#mgNote'); if (ta) ta.focus(); }, 80);
      },
      onOk: dlg => {
        const note = (dlg.querySelector('#mgNote').value || '').trim();
        if (note.length < 8) { UI.toast.err('会签说明至少 8 字'); return false; }
        const rec = STORE.mergeBlind([p.id], { main, keep, note });
        S.selected.delete(p.id);
        renderCards();
        renderAll();
        UI.toast.ok('并档完成 · ' + rec.code + '，已从「双在册」清单移出并写入审计');
        return true;
      }
    });
  }

  /* ---------- 补评（未定级 → 完成风险评估并定级） ---------- */
  function openAssess(p) {
    if (!window.guard('edit', '提请补评')) return;
    const VIAS = [
      { v: '联合评估', t: '联合评估（属地 + 区卫健委精防医生）' },
      { v: '入户面访', t: '入户面访' },
      { v: '材料审核', t: '材料审核（已有诊断 / 法律文书）' },
      { v: '精神专科诊断', t: '精神专科诊断' }
    ];
    const LEVELS = [
      { v: 'mid', t: '中风险（常规随访）' },
      { v: 'high', t: '高风险' },
      { v: 'high2', t: '极高风险（个人极端 / A 类）' },
      { v: 'low', t: '低风险（关注即可）' }
    ];
    let via = VIAS[0].v, to = LEVELS[0].v;
    UI.modal({
      title: '提请补评（风险评估）',
      sub: '补评完成即从「未定级」清单移出 · 评估结论即部门定级，登记入变动台账即生效',
      width: 540,
      okText: '提交补评',
      body: `
        <dl class="kv" style="grid-template-columns:80px 1fr;font-size:12px;gap:6px 10px;margin-bottom:10px">
          <dt>姓名</dt><dd>${esc(fld('name', p).text)}</dd>
          <dt>身份证号</dt><dd class="mono">${esc(fld('idNo', p).text)}</dd>
          <dt>当前状态</dt><dd><span class="tag tag-amber">${esc(p.status || '未定级')}</span> · ${esc(p.town)} · 归属 ${esc(p.dept || '—')}</dd>
          <dt>最近走访</dt><dd>${esc(p.lastVisit || '—')} · ${p.visitGap} 天</dd>
        </dl>
        <div class="fld"><label>评估方式</label><div class="select" id="asVia">${esc(VIAS[0].t)}</div></div>
        <div class="fld"><label>评估机构 / 出具人</label><input class="input" id="asOrg" placeholder="例如：区卫健委精防办 · 王医生" style="height:30px;width:100%"></div>
        <div class="fld"><label>评估结论（拟定等级）</label><div class="select" id="asLevel">${esc(LEVELS[0].t)}</div></div>
        <div class="fld"><label>评估意见（≥ 8 字）</label><textarea id="asNote" rows="3" placeholder="例如：入户面访未见异常，家属配合监护，建议定为中风险并按季度随访"></textarea></div>
        <div class="tiny dim">提交后即生成一条等级变动登记（提请人 ${esc(STORE.role().user)}），可在 <a class="rowlink" href="risk.html" target="_blank">等级变动 › 台账</a> 中查看；登记即生效，该人员从「未定级」清单移出。</div>`,
      onMount: dlg => {
        UI.select(dlg.querySelector('#asVia'), { items: VIAS, value: VIAS[0].v, onChange: v => { via = v; } });
        UI.select(dlg.querySelector('#asLevel'), { items: LEVELS, value: LEVELS[0].v, onChange: v => { to = v; } });
        setTimeout(() => { const ta = dlg.querySelector('#asNote'); if (ta) ta.focus(); }, 80);
      },
      onOk: dlg => {
        const org = (dlg.querySelector('#asOrg').value || '').trim();
        const note = (dlg.querySelector('#asNote').value || '').trim();
        if (note.length < 8) { UI.toast.err('评估意见至少 8 字'); return false; }
        const r = STORE.assessBlind(p.id, to, { via, org, note });
        if (!r) { UI.toast.err('该记录已不在未定级清单中'); return false; }
        S.selected.delete(p.id);
        renderCards();
        renderAll();
        if (window.shellBadges) window.shellBadges();   /* 变动台账 +1，侧栏角标同步 */
        UI.modal({
          title: '补评已登记',
          sub: r.rec.code + ' · ' + D.levelOf(r.rec.from).name + ' → ' + D.levelOf(r.rec.to).name,
          width: 440,
          okText: '知道了',
          body: `<div class="banner banner-ok" style="font-size:11.5px;padding:8px 12px">
              <span>${esc(r.rec.name)} 已完成${esc(r.rec.via)}，从「未定级」清单移出并转入常规管理。</span>
            </div>
            <dl class="kv" style="grid-template-columns:80px 1fr;font-size:12px;gap:6px 10px;margin-top:10px">
              <dt>补评单号</dt><dd class="mono">${esc(r.rec.code)}</dd>
              <dt>等级变动</dt><dd class="mono">${esc(r.chg.id)} <span class="tag tag-green">已生效</span></dd>
              <dt>定级责任</dt><dd>${esc(r.chg.level)} · 登记人 ${esc(r.chg.approver)}</dd>
              <dt>台账入口</dt><dd><a class="rowlink" href="risk.html">等级变动 › 台账</a></dd>
            </dl>
            <div class="tiny dim" style="margin-top:8px">部门定级已登记生效，无需再经审批；本次补评与变动登记均已写入审计日志。</div>`
        });
        return true;
      }
    });
  }

  /* ---------- 批量指派 / 生成任务 / 导出 ---------- */
  function assign(ids) {
    if (!window.guard('edit', '指派核查任务')) return;
    /* 责任人取自「系统管理 › 账号与角色 › 处置责任人名录」，
       与预警转派共用同一份数据；可在系统管理维护，变更写入审计日志 */
    const OFFICERS = STORE.responders().map(r => ({
      v: r.id,
      t: r.unit + ' · ' + r.name + '（' + r.title + '）',
      name: r.name, unit: r.unit, kind: r.kind, note: r.note
    }));
    let to = OFFICERS[0].t;
    let toId = OFFICERS[0].v;
    UI.modal({
      title: `指派核查任务 · ${ids.length} 人`,
      sub: '任务只做提示与督办，不自动改变任何人的管控等级',
      width: 480,
      okText: '确认指派',
      body: `
        <div class="fld"><label>责任人 <span class="tiny dim">共 ${OFFICERS.length} 人 · 取自处置责任人名录</span></label><div class="select" id="asgTo">${esc(OFFICERS[0].t)}</div></div>
        <div class="fld"><label>任务说明（≥ 8 字）</label><textarea id="asgNote" rows="3" placeholder="例如：核实卫健侧危险性评估等级，两部门会签后并档"></textarea></div>
        <div class="tiny dim" style="margin-top:8px">指派后生成核查任务，责任人须在 7 日内反馈核查结论；名单来源：系统管理 › 账号与角色 › <a class="rowlink" href="system.html?tab=account&focus=resp" target="_blank">处置责任人名录</a>（可维护）</div>`,
      onMount: dlg => {
        UI.select(dlg.querySelector('#asgTo'), {
          items: OFFICERS.map(o => ({ v: o.v, t: o.t })),
          value: OFFICERS[0].v,
          onChange: v => {
            const hit = OFFICERS.find(o => o.v === v);
            if (hit) { to = hit.t; toId = hit.v; }
          }
        });
        setTimeout(() => { const ta = dlg.querySelector('#asgNote'); if (ta) ta.focus(); }, 80);
      },
      onOk: dlg => {
        const note = (dlg.querySelector('#asgNote').value || '').trim();
        if (note.length < 8) { UI.toast.err('任务说明至少 8 字'); return false; }
        STORE.audit('指派核查任务', `${ids.length} 人指派给 ${to}：${note}`, '盲区人群');
        UI.toast.ok(`已生成 ${ids.length} 条核查任务，已推送至 ${to}`);
        S.selected.clear(); renderAll();
        return true;
      }
    });
  }

  document.getElementById('btnAssign').onclick = () => {
    if (!S.selected.size) { UI.toast.err('请先勾选需要指派核查的人员'); return; }
    assign(Array.from(S.selected));
  };

  document.getElementById('btnGenTask').onclick = () => {
    const list = filtered();
    if (!list.length) { UI.toast.err('当前筛选没有可生成任务的人员'); return; }
    UI.confirm({
      title: '生成核查任务',
      text: `将对当前筛选的 ${list.length} 人（${TYPES[S.type].name}）批量生成核查任务，生成后进入责任单位待办。是否继续？`,
      okText: '生成任务',
      onOk: () => assign(list.map(p => p.id))
    });
  };

  /* ---------- 导出 ----------
     主入口「导出脱敏清单」：无论当前角色字段密级如何，姓名与身份证一律掩码，
       导出文件可直接对外提供（此前按角色取明文，政法委主管导出的其实是明文，名实不符）。
     明文导出是独立入口：仅 can.exportPlain 角色可见，二次确认 + 用途必填 + 审计留痕。 */
  function exportList(scope, list) {
    if (!list.length) { UI.toast.err('没有可导出的人员'); return; }
    const role = STORE.role();
    if (list.length > 50) {
      UI.confirm({
        title: '导出确认',
        sub: `本次将导出 ${list.length} 条「${scope}」记录，超过 50 条需二人复核后才可下载`,
        width: 520,
        okText: '继续导出',
        body: `<dl class="kv" style="grid-template-columns:78px 1fr;font-size:12px;gap:6px 10px">
          <dt>导出范围</dt><dd>${esc(scope)} · <b>${list.length}</b> 条（当前筛选条件下全部命中，非仅本页）</dd>
          <dt>字段密级</dt><dd><b style="color:var(--green)">脱敏</b> · 身份证 6 位地区码 + 8 位星号 + 4 位尾号，姓名保留姓氏</dd>
          <dt>导出字段</dt><dd>姓名 · 身份证号 · 属地镇街 · 区级等级 · 归属部门 · 最近走访 · 走访间隔</dd>
          <dt>文件名</dt><dd class="mono tiny">盲区人群_${esc(scope)}_脱敏.csv</dd>
          <dt>操作人</dt><dd>${esc(role.user)} · ${esc(role.roleName)}</dd>
        </dl>
        <div class="banner banner-warn" style="margin:10px 0 0;font-size:11px;padding:7px 11px">
          <span>本次导出将写入审计日志（操作人 / 条数 / 密级 / 时间 / 终端），可在「系统管理 › 审计日志」按条追溯。脱敏清单可直接对外提供${STORE.can('exportPlain') ? '；如确需身份证全号，请使用工具栏「导出明文」（单独留痕）' : ''}。</span>
        </div>`,
        onOk: () => doExport(scope, list, false)
      });
    } else doExport(scope, list, false);
  }

  /* 明文导出：仅 can.exportPlain（政法委主管），须填用途 */
  function exportPlain(scope, list) {
    if (!list.length) { UI.toast.err('没有可导出的人员'); return; }
    if (!window.guard('exportPlain', '导出明文清单')) return;
    const role = STORE.role();
    UI.confirm({
      title: '导出明文清单',
      sub: `含身份证全号 · ${list.length} 条「${scope}」记录 · 仅限内部研判使用`,
      width: 540,
      okText: '确认导出明文',
      danger: true,
      body: `<div class="banner banner-warn" style="margin:0 0 10px;font-size:11px;padding:7px 11px">
          <span>明文清单脱离系统管控，转发即不可控。<b>导出行为将连同用途一并写入审计日志</b>，并按季度向政法委通报用量。</span>
        </div>
        <dl class="kv" style="grid-template-columns:78px 1fr;font-size:12px;gap:6px 10px">
          <dt>导出范围</dt><dd>${esc(scope)} · <b>${list.length}</b> 条（当前筛选条件全部命中）</dd>
          <dt>字段密级</dt><dd><b style="color:var(--red)">明文</b> · 含身份证全号与完整姓名</dd>
          <dt>文件名</dt><dd class="mono tiny">盲区人群_${esc(scope)}_明文.csv</dd>
          <dt>操作人</dt><dd>${esc(role.user)} · ${esc(role.roleName)}</dd>
        </dl>
        <div class="fld" style="margin-top:10px"><label>导出用途（≥ 6 字，写入审计日志）</label>
          <input class="input" id="plainUse" placeholder="例如：配合公安分局开展落地核查，需核对身份证全号" style="height:30px;width:100%"></div>`,
      onOk: dlg => {
        const use = ((dlg.querySelector('#plainUse') || {}).value || '').trim();
        if (use.length < 6) { UI.toast.err('请填写导出用途（至少 6 字）'); return false; }
        doExport(scope, list, true, use);
      }
    });
  }

  function doExport(scope, list, plain, use) {
    const rows = [['姓名', '身份证号', '属地镇街', '区级等级', '归属部门', '最近走访', '走访间隔(天)']]
      .concat(list.map(p => [
        plain ? (p.name || '') : D.maskName(p.name || ''),
        plain ? (p.idNo || '') : (p.idNo ? D.maskId(p.idNo) : '—'),
        p.town,
        D.levelOf(STORE.levelOf(p)).name, p.dept, p.lastVisit, p.visitGap
      ]));
    UI.downloadCSV(`盲区人群_${scope}_${plain ? '明文' : '脱敏'}.csv`, rows);
    const mode = plain ? '明文' : '脱敏';
    STORE.addExport(`${scope}（${list.length} 条 · ${mode}）`, list.length, mode);
    STORE.audit(plain ? '导出明文清单' : '导出脱敏清单',
      `${scope} ${list.length} 条 · ${mode}` + (plain ? ' · 用途：' + (use || '未填写') : ''),
      '盲区人群');
    UI.toast.ok(`已导出 ${list.length} 条（${mode}）`);
  }

  document.getElementById('btnExport').onclick = () => exportList(TYPES[S.type].name, filtered());
  /* 明文入口仅 exportPlain 权限可见 */
  const plainBtn = document.getElementById('btnExportPlain');
  if (plainBtn) {
    plainBtn.style.display = STORE.can('exportPlain') ? '' : 'none';
    plainBtn.onclick = () => exportPlain(TYPES[S.type].name, filtered());
  }
  const topExp = document.getElementById('btnExportTop');
  if (topExp) topExp.onclick = () => exportList(TYPES[S.type].name, filtered());

  /* ---------- 启动 ---------- */
  // 支持 ?type=dual|multi|unknown 直达某一类；&st=over 仅看超期未确认；&sort=riskDesc|visit|town 指定排序
  (function () {
    const qs = new URLSearchParams(location.search);
    const t = (qs.get('type') || '').trim();
    if (SOURCES[t] && t !== S.type) {
      S.type = t;
      const idx = { dual: 0, multi: 1, unknown: 2 }[t];
      if (idx != null) segTypeApi.set(idx);
      // 下拉选项按新类型重建
      selDept.items.length = 0; deptItems().forEach(i => selDept.items.push(i));
      selStatus.items.length = 0; statusItems().forEach(i => selStatus.items.push(i));
      selDept.set(''); selStatus.set('');
    }
    const g90 = parseInt((qs.get('g90') || '').trim(), 10);
    if (g90 > 0) S.minGap = g90;
    refreshStatusField();
    const st = (qs.get('st') || '').trim();
    if (st) { S.status = st; selStatus.set(st); }
    const sort = (qs.get('sort') || '').trim();
    if (SORTS.some(o => o.v === sort)) { S.sort = sort; selSort.set(sort); }
    if (st || sort) S.page = 1;
  })();

  renderAll();

  /* ============================================================
     四张统计卡：派生渲染 + 悬浮明细 + 化解记录详情
     ------------------------------------------------------------
     ① 比对来源 / ② 盲区成因分布 / ③ 核查任务闭环 三卡：柱条悬浮显示明细
     ④ 本月盲区化解：整行可点，弹出该条记录的处理详情与涉及人员
     数字全部由同一份口径派生，避免「图上数字与悬浮数字对不上」。
     ============================================================ */
  /* 具名化：并档/补评提交后需要重算四卡与化解计数 */
  function renderCards() {
    const f1 = n => n.toLocaleString('en-US');

    /* ---------- ① 比对来源（四部门台账，合计 7,112 人次） ---------- */
    const SRC = [
      { u: '公安分局', v: 2914, at: '05:42', c: '#0071e3', add: 38, scope: '政保重点人 / 涉访 / 吸毒 / 扬言类 4 类台账' },
      { u: '区卫健委', v: 1204, at: '05:55', c: '#e8830c', add: 25, scope: '严重精神障碍 / 六失一偏 2 类台账' },
      { u: '区信访办', v: 1568, at: '05:58', c: '#6b56c9', add: 19, scope: '涉访 A 类 / B 类台账' },
      { u: '区司法局', v: 1426, at: '06:01', c: '#1f8a53', add: 12, scope: '社区矫正 / 刑满释放 / 安置帮教 3 类' }
    ];
    const SRC_T = SRC.reduce((a, s) => a + s.v, 0);
    const SRC_MAX = Math.max.apply(null, SRC.map(s => s.v));
    const srcBody = document.getElementById('srcBody');
    if (srcBody) {
      srcBody.innerHTML = SRC.map(s => `
        <div class="src-row" data-k="${esc(s.u)}">
          <span class="src-dot"><i style="background:${s.c}"></i>${esc(s.u)}</span>
          <div class="bar thin hoverable"><i style="width:${(s.v / SRC_MAX * 100).toFixed(1)}%;background:${s.c}"></i></div>
          <span class="src-meta">${f1(s.v)} 条 · ${esc(s.at)}</span>
        </div>`).join('') + `
        <div class="divider" style="margin:8px 0 6px"></div>
        <div class="row" style="font-size:11.5px;color:var(--t2)">
          <span>人次合计 / 去重后</span><span class="spacer"></span><b>${f1(SRC_T)}</b><span class="dim">/</span><b>${f1(D.stats.inRegister)}</b>
        </div>`;

      SRC.forEach(s => {
        const row = srcBody.querySelector('[data-k="' + s.u + '"]');
        if (!row) return;
        const hit = `${(s.v / SRC_T * 100).toFixed(1)}%`;
        UI.tip(row, () => `<div class="tt"><i style="width:7px;height:7px;border-radius:50%;background:${s.c}"></i>${esc(s.u)}</div>
          <div class="kv-row"><span>台账条数</span><b>${f1(s.v)} 条</b></div>
          <div class="kv-row"><span>占人次合计</span><b>${hit}</b></div>
          <div class="kv-row"><span>本月新增</span><b style="color:var(--blue-ink)">+${s.add}</b></div>
          <div class="kv-row"><span>最近同步</span><b>${esc(s.at)}</b></div>
          <div class="hr"></div>
          <div class="dim2">覆盖台账：${esc(s.scope)}</div>
          <div class="dim2">同步方式：每日 06:00 增量推送 + 每月 1 日全量核对</div>`);
      });
    }

    /* ---------- ② 盲区成因分布（合计 887 = 三类去重） ---------- */
    const CAUSE = [
      { n: '未做风险等级评估', v: 292, c: 'var(--amber)', act: '7 日内补做风险评估并定级', own: '对口部门' },
      { n: '拒访 · 无法接触', v: 231, c: 'var(--orange)', act: '联合精防医生 / 民警再访，必要时侧面了解', own: '属地镇街' },
      { n: '两部门口径不一致', v: 127, c: 'var(--purple)', act: '两部门会签并档，管控等级就高不就低', own: '区委政法委' },
      { n: '评估材料超 12 个月', v: 89, c: 'var(--slate)', act: '重新出具评估意见或法律文书', own: '对口部门' },
      { n: '等级字段为空', v: 58, c: 'var(--red)', act: '补录等级字段并回写台账', own: '对口部门' },
      { n: '其他 / 待复核', v: 90, c: 'var(--t4)', act: '人工复核归类后进入对应成因', own: '属地镇街' }
    ];
    const C_T = CAUSE.reduce((a, c) => a + c.v, 0);
    const C_MAX = Math.max.apply(null, CAUSE.map(c => c.v));
    const causeBody = document.getElementById('causeBody');
    if (causeBody) {
      causeBody.innerHTML = CAUSE.map(c => `
        <div class="cause-row" data-k="${esc(c.n)}">
          <span class="nm">${esc(c.n)}</span>
          <span class="bar thin hoverable"><i style="width:${(c.v / C_MAX * 100).toFixed(1)}%;background:${c.c}"></i></span>
          <span class="vl">${c.v}</span>
        </div>`).join('');

      CAUSE.forEach(c => {
        const row = causeBody.querySelector('[data-k="' + c.n + '"]');
        if (!row) return;
        const pct = (c.v / C_T * 100).toFixed(1);
        const ppl = [];
        for (let i = 0; i < 3; i++) ppl.push(D.persons[(c.v * 31 + i * 97) % D.persons.length]);
        UI.tip(row, () => `<div class="tt">${esc(c.n)}</div>
          <div class="kv-row"><span>命中人数</span><b>${c.v} 人</b></div>
          <div class="kv-row"><span>占盲区总数</span><b>${pct}%</b></div>
          <div class="kv-row"><span>责任方</span><b>${esc(c.own)}</b></div>
          <div class="hr"></div>
          <div class="dim2">处置要求：${esc(c.act)}</div>
          <div class="dim2">示例：${ppl.map(p => esc(p.name) + '（' + esc(p.town) + '）').join('、')}</div>`);
      });
    }

    /* ---------- ③ 核查任务闭环（41 + 16 + 10 + 9 = 76） ---------- */
    const RING = [
      { k: '已闭环', v: 41, c: 'var(--green)', note: '已完成核查并回写结论', avg: '平均 4.2 天' },
      { k: '核查中', v: 16, c: 'var(--blue)', note: '责任人已接单、尚未反馈', avg: '平均已用 2.8 天' },
      { k: '已派发待核查', v: 10, c: 'var(--orange)', note: '已下发但责任人未接单', avg: '平均已等 1.6 天' },
      { k: '已超期', v: 9, c: 'var(--red)', note: '超过 7 日时限未反馈', avg: '最长超期 5 天' }
    ];
    const R_T = RING.reduce((a, r) => a + r.v, 0);
    const RATE = +(RING[0].v / R_T * 100).toFixed(1);
    const ringBody = document.getElementById('ringBody');
    if (ringBody) {
      const CIRC = 2 * Math.PI * 41;
      ringBody.innerHTML = `
        <div class="ring-wrap">
          <svg viewBox="0 0 100 100" width="92" height="92">
            <circle cx="50" cy="50" r="41" fill="none" stroke="#f2f4f7" stroke-width="9"/>
            <circle cx="50" cy="50" r="41" fill="none" stroke="#1f8a53" stroke-width="9" stroke-linecap="round"
                    stroke-dasharray="${(CIRC * RATE / 100).toFixed(1)} ${CIRC.toFixed(1)}" transform="rotate(-90 50 50)"/>
          </svg>
          <div class="ctr"><div><b>${RATE}%</b><span>闭环率</span></div></div>
        </div>
        <div style="flex:1 1 auto;min-width:0">
          ${RING.map(r => `<div class="li" style="padding:4px 3px;border-radius:6px" data-k="${esc(r.k)}">
            <i style="width:7px;height:7px;border-radius:2px;background:${r.c}"></i><span class="sm">${esc(r.k)}</span>
            <span class="spacer"></span><b style="font-size:12.5px;${r.k === '已超期' ? 'color:var(--red)' : ''}">${r.v}</b>
          </div>`).join('')}
        </div>`;
      RING.forEach(r => {
        const row = ringBody.querySelector('[data-k="' + r.k + '"]');
        if (!row) return;
        UI.tip(row, () => `<div class="tt">${esc(r.k)}</div>
          <div class="kv-row"><span>任务数</span><b>${r.v} 条</b></div>
          <div class="kv-row"><span>占本月任务</span><b>${(r.v / R_T * 100).toFixed(1)}%</b></div>
          <div class="kv-row"><span>耗时</span><b>${esc(r.avg)}</b></div>
          <div class="hr"></div>
          <div class="dim2">${esc(r.note)}</div>
          <div class="dim2">本月任务合计 ${R_T} 条 · 时限 7 天 · 超期自动推送督办</div>`);
      });
      /* 底栏只保留「超期督办」链接，不再回写文字（避免写到 spacer 里） */
    }

    /* ---------- ④ 本月盲区化解（整行可点，弹出详情） ---------- */
    const CHG = [
      {
        ico: '✓', bg: 'var(--green-soft)', col: 'var(--green)',
        t: '并档 26 人', sub: '· 一人多档合并', ex: '张文远（3 档 → 1 档）· 果园街道 · 11-06',
        tag: '已闭环', tagCls: 'tag-green', n: 26, seed: 7,
        detail: {
          date: '2026-11-06 15:20', by: '孙敏（区卫健委 · 精防办）· 王振国（鼓楼街道）',
          doc: 'BD-20261106-014', level: '政法委复核 · 已通过',
          basis: '同一身份证号在公安侧与卫健侧各建 1 档，经两部门会签确认为同一人，合并为 1 档并保留双方原等级。',
          after: '合并后由公安侧主责，卫健侧保留危险性等级子档；管控等级取两部门较高者。',
          source: '本页「双在册」清单每行的「并档」按钮：两部门会签确认同一人后合并档案，每提交 1 人计 1 人'
        }
      },
      {
        ico: '✓', bg: 'var(--green-soft)', col: 'var(--green)',
        t: '补评 15 人', sub: '· 完成风险评估', ex: '田素珍（未定级 → 中风险）· 巨各庄镇 · 11-08',
        tag: '已闭环', tagCls: 'tag-green', n: 15, seed: 19,
        detail: {
          date: '2026-11-08 10:40', by: '马晓东（巨各庄镇 · 政法委员）· 区卫健委精防医生',
          doc: 'BD-20261108-021', level: '部门主管核定 · 已通过',
          basis: '建档后长期未定级，本次由属地联合精防医生完成面访并出具危险性评估意见。',
          after: '按评估结论定为中风险，转入常规随访（每季度一次），不再计入盲区。',
          source: '本页「未定级」清单每行的「补评」按钮：完成风险评估并定级，每提交 1 人计 1 人，同时生成等级调整申请'
        }
      },
      {
        ico: '+', bg: 'var(--red-soft)', col: 'var(--red)',
        t: '新增 63 人', sub: '· 其中双在册 14', ex: '公安 11-07 批次新增 38 · 卫健新增 25',
        tag: '待核查', tagCls: 'tag-orange', n: 63, seed: 31,
        detail: {
          date: '2026-11-07 07:20', by: '系统（每日 06:00 自动比对）',
          doc: 'BD-20261107-008', level: '自动识别 · 待分派核查',
          basis: '公安分局 11-07 增量批次与区卫健委全量台账导入后，按身份证号比对新增双在册 14 人、多标 49 人。',
          after: '已生成待分派核查任务，需在 7 日内由属地确认管控责任归属。',
          source: '系统自动生成：每日 06:00 比对公安 / 卫健增量批次，按 RG-01（双在册）、RG-02（多重标签）识别，无需人工录入'
        }
      },
      {
        ico: '!', bg: 'var(--amber-soft)', col: '#8a6100',
        t: '确认超期 9 条', sub: '· 已发督办', ex: '不老屯 3 · 檀营 2 · 高岭 2 · 密云镇 2',
        tag: '督办中', tagCls: 'tag-red', n: 9, seed: 43,
        detail: {
          date: '2026-11-09 09:00', by: '系统（RG-06 规则触发）· 陈志远 已签收',
          doc: 'BD-20261109-003', level: '政法委督办 · 进行中',
          basis: '双在册确认任务发起后超过 7 日未完成两部门会签，按 RG-06 规则判定超期。',
          after: '已向不老屯镇、檀营地区、高岭镇、密云镇下发督办单，要求 3 个工作日内反馈；连续两月未闭环纳入月度通报。',
          source: '系统自动生成：RG-06 规则触发（双在册确认任务发起后 > 7 日未两部门会签），每超期 1 条计 1 条'
        }
      }
    ];
    /* 基数（本月已归档）+ 本次会话内真实提交的并档 / 补评，两处口径同源 */
    const MGE = STORE.merges();
    const ASM = STORE.assessments();
    CHG[0].n = 26 + MGE.length;
    CHG[0].t = '并档 ' + CHG[0].n + ' 人';
    CHG[0].live = MGE;
    CHG[1].n = 15 + ASM.length;
    CHG[1].t = '补评 ' + CHG[1].n + ' 人';
    CHG[1].live = ASM;
    CHG[2].live = null;
    CHG[3].live = null;

    const kpiR = document.getElementById('kpiResolve');
    if (kpiR) kpiR.textContent = '并档 ' + CHG[0].n + ' · 补评 ' + CHG[1].n;
    const subR = document.getElementById('chgSub');
    if (subR) subR.textContent = '新增 ' + CHG[2].n + ' · 化解 ' + (CHG[0].n + CHG[1].n);

    const chgList = document.getElementById('chgList');
    if (chgList) {
      chgList.innerHTML = CHG.map((c, i) => `
        <div class="chg-row" data-i="${i}" title="点击查看该条记录详情">
          <span class="chg-ico" style="background:${c.bg};color:${c.col}">${c.ico}</span>
          <div style="min-width:0">
            <div style="font-weight:600">${esc(c.t)} <span class="tiny dim">${esc(c.sub)}</span></div>
            <div class="tiny dim">${esc(c.ex)}</div>
          </div>
          <span class="spacer"></span>
          <span class="tag ${c.tagCls}">${esc(c.tag)}</span>
        </div>`).join('');

      /* 图例已移出滚动区（固定在卡片底部），此处不再拼接 */
      chgList.querySelectorAll('.chg-row').forEach(row => {
        const c = CHG[Number(row.dataset.i)];
        row.onclick = () => openChg(c);
      });
    }

    function openChg(c) {
      const live = c.live || [];
      const ppl = [];
      for (let i = 0; i < 3; i++) ppl.push(D.persons[(c.seed * 37 + i * 53) % D.persons.length]);
      UI.modal({
        title: c.t + ' · 处理详情',
        sub: `${c.detail.doc} · ${c.detail.date} · ${c.tag}`,
        width: 560,
        okText: '知道了',
        body: `
          <div class="row" style="gap:8px;margin-bottom:10px">
            <span class="tag ${c.tagCls}">${esc(c.tag)}</span>
            <span class="tag tag-line">涉及 ${c.n} 人</span>
            <span class="tag tag-blue">${esc(c.detail.level)}</span>
            <span class="spacer"></span>
            <a class="btn btn-sm btn-ghost" href="system.html?tab=audit&focus=盲区">审计留痕 ›</a>
          </div>
          <dl class="kv" style="grid-template-columns:74px 1fr;font-size:12px;gap:6px 10px">
            <dt>处理方式</dt><dd>${esc(c.t)} ${esc(c.sub)}</dd>
            <dt>经办人</dt><dd>${esc(c.detail.by)}</dd>
            <dt>处理时间</dt><dd>${esc(c.detail.date)}</dd>
            <dt>归档单号</dt><dd class="mono tiny">${esc(c.detail.doc)}</dd>
            <dt>认定依据</dt><dd>${esc(c.detail.basis)}</dd>
            <dt>处理结果</dt><dd>${esc(c.detail.after)}</dd>
            <dt>数据来源</dt><dd>${esc(c.detail.source || '系统自动生成')}</dd>
          </dl>
          ${live.length ? `
          <div class="sect-title mt12">本次会话新增 ${live.length} 条 · 真实提交记录</div>
          <div class="table-wrap" style="border:1px solid var(--line);border-radius:9px;margin-top:5px;max-height:148px;overflow:auto">
            <table class="tb compact">
              <thead><tr><th>单号</th><th>人员</th><th>属地</th><th>处理结果</th><th class="nowrap">提交时间</th></tr></thead>
              <tbody>${live.map(r => `<tr>
                <td class="mono tiny nowrap">${esc(r.code)}</td>
                <td class="nowrap">${esc(r.ids ? r.names.join('、') : r.name)}</td>
                <td class="tiny nowrap">${esc(r.town)}</td>
                <td class="tiny">${esc(r.ids ? (r.main + ' 主责 · ' + r.keep) : (D.levelOf(r.from).name + ' → ' + D.levelOf(r.to).name))}</td>
                <td class="tiny nowrap">${esc(r.at)}</td>
              </tr>`).join('')}</tbody>
            </table>
          </div>` : ''}
          <div class="sect-title mt12">涉及人员（示例 ${ppl.length} 人，共 ${c.n} 人）</div>
          <div class="table-wrap" style="border:1px solid var(--line);border-radius:9px;margin-top:5px">
            <table class="tb compact">
              <thead><tr><th>姓名</th><th>属地镇街</th><th>区级等级</th><th class="r">档案</th></tr></thead>
              <tbody>${ppl.map(p => `<tr>
                <td class="cell-main">${esc(D.field(RK(), 'name', p).text)}</td>
                <td class="tiny">${esc(p.town)}</td>
                <td><span class="${D.levelOf(STORE.levelOf(p)).cls}">${esc(D.levelOf(STORE.levelOf(p)).name)}</span></td>
                <td class="r"><a class="rowlink" href="person.html?id=${encodeURIComponent(p.id)}">查看 ›</a></td>
              </tr>`).join('')}</tbody>
            </table>
          </div>
          <div class="tiny dim" style="margin-top:8px">明细列表为演示数据抽样；完整 ${c.n} 条可在「导出脱敏清单」中获取，处理过程已写入审计日志。</div>`
      });
    }

    /* 「留痕」：跳审计日志前先记录本次查看行为，确保落地即可见流水 */
    const auditBtn = document.getElementById('btnChgAudit');
    if (auditBtn) auditBtn.onclick = e => {
      e.preventDefault();
      const n = STORE.auditMatch('盲区').length;
      STORE.audit('查看盲区留痕', '查看盲区人群操作流水 · 本次会话已有 ' + n + ' 条相关记录', '盲区人群');
      location.href = 'system.html?tab=audit&focus=盲区';
    };
  }
  renderCards();
})();
